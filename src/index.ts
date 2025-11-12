import * as dotenv from "dotenv";
import { Op } from "sequelize";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import axios from "axios";
import * as fs from "fs/promises";
import OpenAI from "openai";

// Load environment variables
dotenv.config();

// Import database models from NewsNexus10Db package
import {
  initModels,
  sequelize,
  Article,
  ArticleContent,
  ArticleEntityWhoCategorizedArticleContract,
  ArticleEntityWhoCategorizedArticleContracts02,
  ArticleStateContract,
  ArtificialIntelligence,
  EntityWhoCategorizedArticle,
  ArticleApproved,
  ArticlesApproved02,
  State,
} from "newsnexus10db";

// Environment variables
const NAME_APP = process.env.NAME_APP;
const KEY_OPEN_AI = process.env.KEY_OPEN_AI;
const TARGET_APPROVED_ARTICLE_COUNT = parseInt(
  process.env.TARGET_APPROVED_ARTICLE_COUNT || "0",
  10
);

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: KEY_OPEN_AI });

// Cached IDs looked up at startup
let semanticScorerEntityId: number;
let analyzerEntityId: number; // For this microservice's EntityWhoCategorizedArticle ID
let analyzerAiSystemId: number; // For this microservice's ArtificialIntelligence ID

/**
 * Look up the entityWhoCategorizesId for "NewsNexusSemanticScorer02"
 */
async function lookupSemanticScorerEntityId(): Promise<number> {
  console.log('\nLooking up "NewsNexusSemanticScorer02" entity...');

  // Find the AI system by name
  const aiSystem = await ArtificialIntelligence.findOne({
    where: { name: "NewsNexusSemanticScorer02" },
  });

  if (!aiSystem) {
    throw new Error(
      'Could not find AI system "NewsNexusSemanticScorer02" in ArtificialIntelligences table'
    );
  }

  console.log(`Found AI system: ${aiSystem.name} (ID: ${aiSystem.id})`);

  // Find the corresponding EntityWhoCategorizedArticle
  const entity = await EntityWhoCategorizedArticle.findOne({
    where: { artificialIntelligenceId: aiSystem.id },
  });

  if (!entity) {
    throw new Error(
      `Could not find EntityWhoCategorizedArticle for AI system ID ${aiSystem.id}`
    );
  }

  console.log(`Found EntityWhoCategorizedArticle ID: ${entity.id}`);

  return entity.id;
}

/**
 * Look up the entityWhoCategorizesId for this microservice (NAME_APP)
 */
async function lookupAnalyzerEntityId(): Promise<{
  entityId: number;
  aiSystemId: number;
}> {
  console.log(`\nLooking up "${NAME_APP}" entity...`);

  if (!NAME_APP) {
    throw new Error(
      "NAME_APP environment variable is not set. Cannot determine microservice identity."
    );
  }

  // Find the AI system by name
  const aiSystem = await ArtificialIntelligence.findOne({
    where: { name: NAME_APP },
  });

  if (!aiSystem) {
    throw new Error(
      `Could not find AI system "${NAME_APP}" in ArtificialIntelligences table. ` +
        `Please add an entry with name="${NAME_APP}" before running this service.`
    );
  }

  console.log(`Found AI system: ${aiSystem.name} (ID: ${aiSystem.id})`);

  // Find the corresponding EntityWhoCategorizedArticle
  const entity = await EntityWhoCategorizedArticle.findOne({
    where: { artificialIntelligenceId: aiSystem.id },
  });

  if (!entity) {
    throw new Error(
      `Could not find EntityWhoCategorizedArticle for AI system "${NAME_APP}" (ID: ${aiSystem.id}). ` +
        `Please create an EntityWhoCategorizedArticle entry for this AI system.`
    );
  }

  console.log(
    `Found EntityWhoCategorizedArticle ID: ${entity.id} (will be used for recording analysis results)`
  );

  return {
    entityId: entity.id,
    aiSystemId: aiSystem.id,
  };
}

/**
 * Get all previously processed article IDs (from both approval tables)
 */
async function getPreviouslyProcessedArticleIds(): Promise<number[]> {
  const [humanApproved, aiApproved] = await Promise.all([
    ArticleApproved.findAll({ attributes: ["articleId"] }),
    ArticlesApproved02.findAll({ attributes: ["articleId"] }),
  ]);

  const humanApprovedIds = humanApproved.map((a) => a.articleId);
  const aiApprovedIds = aiApproved.map((a) => a.articleId);

  // Combine and deduplicate
  const allProcessedIds = [...new Set([...humanApprovedIds, ...aiApprovedIds])];

  console.log(`Found ${allProcessedIds.length} previously processed articles`);

  return allProcessedIds;
}

/**
 * Get articles that match selection criteria
 */
async function getEligibleArticles(
  excludeArticleIds: number[]
): Promise<Article[]> {
  // Find articles with NewsNexusSemanticScorer02 rating > 0.4
  const articleContracts =
    await ArticleEntityWhoCategorizedArticleContract.findAll({
      where: {
        entityWhoCategorizesId: semanticScorerEntityId,
        keywordRating: { [Op.gt]: 0.4 },
        ...(excludeArticleIds.length > 0 && {
          articleId: { [Op.notIn]: excludeArticleIds },
        }),
      },
      attributes: ["articleId"],
      order: [["articleId", "DESC"]],
    });

  const articleIds = articleContracts.map((contract) => contract.articleId);

  if (articleIds.length === 0) {
    console.log("\nNo eligible articles found.");
    return [];
  }

  // Fetch the actual Article records
  const articles = await Article.findAll({
    where: { id: { [Op.in]: articleIds } },
    order: [["id", "DESC"]],
  });

  return articles;
}

/**
 * Step 2: Scrape article content using cheerio
 */
async function scrapeWithCheerio(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(response.data);

    // Remove script and style elements
    $("script, style").remove();

    // Try to find main content areas (common article selectors)
    let content = "";
    const selectors = [
      "article",
      '[role="main"]',
      ".article-content",
      ".post-content",
      ".entry-content",
      "main",
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        content = element.text();
        break;
      }
    }

    // Fallback to body if no content found
    if (!content) {
      content = $("body").text();
    }

    // Clean up whitespace
    content = content.replace(/\s+/g, " ").trim();

    return content.length >= 250 ? content : null;
  } catch (error) {
    console.log(`  Cheerio scraping failed: ${error}`);
    return null;
  }
}

/**
 * Step 2: Scrape article content using puppeteer
 */
async function scrapeWithPuppeteer(url: string): Promise<string | null> {
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { timeout: 10000, waitUntil: "domcontentloaded" });

    // Extract text content (runs in browser context)
    const content = await page.evaluate(() => {
      // @ts-expect-error - DOM types available in browser context
      const scripts = document.querySelectorAll("script, style");
      // @ts-expect-error - el type is Element in browser context
      scripts.forEach((el) => el.remove());

      const selectors = [
        "article",
        '[role="main"]',
        ".article-content",
        ".post-content",
        ".entry-content",
        "main",
        "body",
      ];

      for (const selector of selectors) {
        // @ts-expect-error - DOM types available in browser context
        const element = document.querySelector(selector);
        if (element) {
          return element.textContent || "";
        }
      }

      // @ts-expect-error - DOM types available in browser context
      return document.body.textContent || "";
    });

    // Clean up whitespace
    const cleanContent = content.replace(/\s+/g, " ").trim();

    await browser.close();
    return cleanContent.length >= 250 ? cleanContent : null;
  } catch (error) {
    console.log(`  Puppeteer scraping failed: ${error}`);
    if (browser) {
      await browser.close();
    }
    return null;
  }
}

/**
 * Step 2: Get or scrape article content
 */
async function getArticleContent(article: Article): Promise<string> {
  console.log("  Step 2: Retrieving article content...");

  // Check if content already exists
  let articleContent = await ArticleContent.findOne({
    where: { articleId: article.id },
  });

  // If content exists and is >= 400 chars, use it
  if (articleContent && articleContent.content && articleContent.content.length >= 400) {
    console.log(`  ✓ Using existing content (${articleContent.content.length} chars)`);
    return articleContent.content;
  }

  // If content exists but < 400 chars, try to re-scrape
  if (articleContent && articleContent.content && articleContent.content.length < 400) {
    console.log(`  ⚠ Existing content is short (${articleContent.content.length} chars), attempting re-scrape...`);

    if (!article.url) {
      console.log("  ⚠ No URL available, keeping existing content");
      return articleContent.content;
    }

    const existingLength = articleContent.content.length;

    // Try cheerio first
    console.log("  Re-scraping with cheerio...");
    const cheerioContent = await scrapeWithCheerio(article.url);

    // If cheerio gets 400+ chars and is longer than existing, replace
    if (cheerioContent && cheerioContent.length >= 400 && cheerioContent.length > existingLength) {
      console.log(`  ✓ Cheerio got better content (${cheerioContent.length} chars), replacing...`);
      await articleContent.destroy();
      await ArticleContent.create({
        articleId: article.id,
        content: cheerioContent,
        scrapeStatusCheerio: true,
        scrapeStatusPuppeteer: null,
      });
      return cheerioContent;
    }

    // If cheerio didn't get 400+ chars, try puppeteer
    console.log("  Cheerio didn't reach 400 chars, trying puppeteer...");
    const puppeteerContent = await scrapeWithPuppeteer(article.url);

    // If puppeteer gets content longer than existing, replace
    if (puppeteerContent && puppeteerContent.length > existingLength) {
      console.log(`  ✓ Puppeteer got better content (${puppeteerContent.length} chars), replacing...`);
      await articleContent.destroy();
      await ArticleContent.create({
        articleId: article.id,
        content: puppeteerContent,
        scrapeStatusCheerio: cheerioContent ? false : null,
        scrapeStatusPuppeteer: true,
      });
      return puppeteerContent;
    }

    // Neither method improved the content, keep existing
    console.log("  ✗ Re-scraping didn't improve content, keeping existing");
    return articleContent.content;
  }

  // No content exists, perform initial scraping with 250 char threshold
  console.log("  No existing content, performing initial scrape...");

  // Check if article has a URL
  if (!article.url) {
    console.log("  ⚠ No URL available, using description");
    const fallbackContent = article.description || "";
    await ArticleContent.create({
      articleId: article.id,
      content: fallbackContent,
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: false,
    });
    return fallbackContent;
  }

  console.log("  Scraping with cheerio...");
  const cheerioContent = await scrapeWithCheerio(article.url);

  if (cheerioContent) {
    console.log(`  ✓ Cheerio successful (${cheerioContent.length} chars)`);
    await ArticleContent.create({
      articleId: article.id,
      content: cheerioContent,
      scrapeStatusCheerio: true,
      scrapeStatusPuppeteer: null,
    });
    return cheerioContent;
  }

  // Cheerio failed, try puppeteer
  console.log("  Cheerio failed, trying puppeteer...");
  const puppeteerContent = await scrapeWithPuppeteer(article.url);

  if (puppeteerContent) {
    console.log(`  ✓ Puppeteer successful (${puppeteerContent.length} chars)`);
    await ArticleContent.create({
      articleId: article.id,
      content: puppeteerContent,
      scrapeStatusCheerio: false,
      scrapeStatusPuppeteer: true,
    });
    return puppeteerContent;
  }

  // Both failed, use description as fallback
  console.log("  ✗ Both scraping methods failed");
  const fallbackContent = article.description || "";
  await ArticleContent.create({
    articleId: article.id,
    content: fallbackContent,
    scrapeStatusCheerio: false,
    scrapeStatusPuppeteer: false,
  });

  return fallbackContent;
}

/**
 * Step 3: Generate prompt using template
 */
async function generatePrompt(
  article: Article,
  scrapedContent: string
): Promise<string> {
  console.log("  Step 3: Generating prompt...");

  const templatePath = "src/templates/prompt02.md";
  let template = await fs.readFile(templatePath, "utf-8");

  template = template.replace("<< ARTICLE_TITLE >>", article.title || "");
  template = template.replace(
    "<< ARTICLE_DESCRIPTION >>",
    article.description || ""
  );
  template = template.replace("<< ARTICLE_SCRAPED_CONTENT >>", scrapedContent);

  console.log("  ✓ Prompt generated");
  return template;
}

/**
 * Step 4: Send request to OpenAI API
 */
async function analyzeWithOpenAI(
  prompt: string
): Promise<{
  product: string;
  state: string;
  hazard: string;
  relevance_score: number;
  united_states_score: number;
} | null> {
  console.log("  Step 4: Sending request to OpenAI...");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.log("  ✗ No response from OpenAI");
      return null;
    }

    // Parse JSON response
    const parsed = JSON.parse(content);

    // Validate structure
    if (
      typeof parsed.product === "string" &&
      typeof parsed.state === "string" &&
      typeof parsed.hazard === "string" &&
      typeof parsed.relevance_score === "number" &&
      typeof parsed.united_states_score === "number"
    ) {
      console.log(`  ✓ OpenAI response: relevance_score=${parsed.relevance_score}`);
      return parsed;
    } else {
      console.log("  ✗ Invalid response format");
      return null;
    }
  } catch (error) {
    console.log(`  ✗ OpenAI error: ${error}`);
    return null;
  }
}

/**
 * Step 5: Record results to database
 */
async function recordResults(
  article: Article,
  scrapedContent: string,
  apiResponse: {
    product: string;
    state: string;
    hazard: string;
    relevance_score: number;
    united_states_score: number;
  } | null
): Promise<boolean> {
  console.log("  Step 5: Recording results...");

  const isApproved =
    apiResponse !== null &&
    [7, 8, 9, 10].includes(apiResponse.relevance_score);

  // Create ArticlesApproved02 record
  const approvalRecord: any = {
    articleId: article.id,
    artificialIntelligenceId: analyzerAiSystemId,
    isApproved,
    textForPdfReport: scrapedContent || article.description || "",
  };

  // If approved, populate PDF report fields
  if (isApproved) {
    approvalRecord.headlineForPdfReport = article.title;
    approvalRecord.publicationNameForPdfReport = article.publicationName;
    approvalRecord.publicationDateForPdfReport = article.publishedDate;
    approvalRecord.urlForPdfReport = article.url;
  }

  await ArticlesApproved02.create(approvalRecord);

  console.log(`  ✓ ArticlesApproved02 created (isApproved: ${isApproved})`);

  // If we have a valid API response, record the key-value pairs
  if (apiResponse) {
    const records = [
      { key: "product", valueString: apiResponse.product },
      { key: "state", valueString: apiResponse.state },
      { key: "hazard", valueString: apiResponse.hazard },
      { key: "relevance_score", valueNumber: apiResponse.relevance_score },
      {
        key: "united_states_score",
        valueNumber: apiResponse.united_states_score,
      },
    ];

    for (const record of records) {
      await ArticleEntityWhoCategorizedArticleContracts02.create({
        articleId: article.id,
        entityWhoCategorizesId: analyzerEntityId,
        key: record.key,
        valueString: record.valueString || null,
        valueNumber: record.valueNumber || null,
        valueBoolean: null,
      });
    }

    console.log("  ✓ ArticleEntityWhoCategorizedArticleContracts02 records created");

    // If approved, try to link the state
    if (isApproved && apiResponse.state) {
      const stateName = apiResponse.state.toLowerCase();
      const state = await State.findOne({
        where: sequelize.where(
          sequelize.fn("LOWER", sequelize.col("name")),
          stateName
        ),
      });

      if (state) {
        await ArticleStateContract.create({
          articleId: article.id,
          stateId: state.id,
        });
        console.log(`  ✓ ArticleStateContract created (state: ${state.name})`);
      } else {
        console.log(`  ⚠ State "${apiResponse.state}" not found in database`);
      }
    }
  }

  return isApproved;
}

/**
 * Main processing loop
 */
async function processArticles() {
  console.log("\n=== NewsNexus LLM Article Analyzer 04 ===");
  console.log(`Target approved articles: ${TARGET_APPROVED_ARTICLE_COUNT}`);

  // Initialize database models
  console.log("\nInitializing database connection...");
  initModels();
  await sequelize.authenticate();
  console.log("Database connected successfully!");

  // Lookup semantic scorer entity ID at startup
  semanticScorerEntityId = await lookupSemanticScorerEntityId();

  // Lookup this microservice's entity ID at startup (required for Step 5)
  const analyzerIds = await lookupAnalyzerEntityId();
  analyzerEntityId = analyzerIds.entityId;
  analyzerAiSystemId = analyzerIds.aiSystemId;

  // Get previously processed article IDs
  const excludeArticleIds = await getPreviouslyProcessedArticleIds();

  // Get eligible articles
  console.log("\nQuerying eligible articles...");
  const articles = await getEligibleArticles(excludeArticleIds);

  console.log(`Found ${articles.length} eligible articles to process\n`);

  if (articles.length === 0) {
    console.log("No more articles to process. Exiting.");
    return;
  }

  // Tracking counters
  let articlesAnalyzed = 0;
  let articlesApproved = 0;
  let consecutiveOpenAiFailures = 0;

  console.log("=== Starting Article Processing ===\n");

  // Loop through articles
  for (const article of articles) {
    articlesAnalyzed++;

    console.log(
      `\n[${articlesAnalyzed}/${articles.length}] Processing Article:`
    );
    console.log(`  ID: ${article.id}`);
    console.log(`  Title: ${article.title}`);
    console.log(
      `  Progress: ${articlesApproved}/${TARGET_APPROVED_ARTICLE_COUNT} approved`
    );

    try {
      // Step 2: Get article content (scrape or use existing)
      const scrapedContent = await getArticleContent(article);

      // Step 3: Generate prompt
      const prompt = await generatePrompt(article, scrapedContent);

      // Step 4: Analyze with OpenAI
      const apiResponse = await analyzeWithOpenAI(prompt);

      if (apiResponse === null) {
        // OpenAI failed
        consecutiveOpenAiFailures++;
        console.log(
          `  ⚠ OpenAI failure (${consecutiveOpenAiFailures}/3 consecutive)`
        );

        if (consecutiveOpenAiFailures >= 3) {
          throw new Error(
            "3 consecutive OpenAI failures. Exiting service."
          );
        }

        // Skip this article and continue to next
        continue;
      }

      // Reset consecutive failures on success
      consecutiveOpenAiFailures = 0;

      // Step 5: Record results
      const approved = await recordResults(article, scrapedContent, apiResponse);

      if (approved) {
        articlesApproved++;
        console.log(`  ✓ Article APPROVED (${articlesApproved}/${TARGET_APPROVED_ARTICLE_COUNT})`);
      } else {
        console.log("  ✗ Article not approved");
      }

      // Check if we've reached our target
      if (articlesApproved >= TARGET_APPROVED_ARTICLE_COUNT) {
        console.log(
          `\n✓ Target reached: ${articlesApproved}/${TARGET_APPROVED_ARTICLE_COUNT} articles approved`
        );
        break;
      }
    } catch (error) {
      console.error(`  ✗ Error processing article: ${error}`);
      throw error;
    }
  }

  console.log("\n=== Processing Complete ===");
  console.log(`Total articles analyzed: ${articlesAnalyzed}`);
  console.log(`Total articles approved: ${articlesApproved}`);
  console.log("Service exiting.");
}

// Run the service
processArticles()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  });
