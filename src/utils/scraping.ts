import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import axios from "axios";

/**
 * Scrape article content using cheerio (lightweight HTML parser)
 */
export async function scrapeWithCheerio(url: string): Promise<string | null> {
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
 * Scrape article content using puppeteer (headless browser)
 */
export async function scrapeWithPuppeteer(url: string): Promise<string | null> {
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
