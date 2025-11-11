import * as dotenv from "dotenv";
import { Op } from "sequelize";

// Load environment variables
dotenv.config();

// Import database models from NewsNexus10Db package
import {
  initModels,
  sequelize,
  Article,
  ArticleEntityWhoCategorizedArticleContract,
  ArtificialIntelligence,
  EntityWhoCategorizedArticle,
  ArticleApproved,
  ArticlesApproved02,
} from "newsnexus10db";

// Environment variables
const NAME_APP = process.env.NAME_APP;
const TARGET_APPROVED_ARTICLE_COUNT = parseInt(
  process.env.TARGET_APPROVED_ARTICLE_COUNT || "0",
  10
);

// Cached IDs looked up at startup
let semanticScorerEntityId: number;

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

    // TODO: Steps 2-5 will be implemented next
    // For now, we're just selecting and logging articles

    // Check if we've reached our target (in future, this will check actual approvals)
    if (articlesApproved >= TARGET_APPROVED_ARTICLE_COUNT) {
      console.log(
        `\n✓ Target reached: ${articlesApproved}/${TARGET_APPROVED_ARTICLE_COUNT} articles approved`
      );
      break;
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
