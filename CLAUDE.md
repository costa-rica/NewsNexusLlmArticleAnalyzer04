# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NewsNexus LLM Article Analyzer 04 is a TypeScript microservice that connects to the NewsNexus10 SQLite database to analyze news articles using OpenAI's GPT-4o model. The service identifies consumer product safety hazards in news articles, determining relevance and geographic location (US states).

## Core Architecture

### Database Integration

- Uses the **NewsNexus10Db** package for all database operations
- Database connection configured via environment variables (PATH_DATABASE, NAME_DB)
- All database models are provided by the NewsNexus10Db package - DO NOT create local model definitions
- See `docs/DATABASE_OVERVIEW.md` for complete schema and relationship documentation

### Article Processing Pipeline

The service implements a 5-step sequential pipeline:

1. **Article Selection**: Queries articles in descending order by Article.id with multiple filters:
   - NewsNexusSemanticScorer02 rating > 0.4 (via ArticleEntityWhoCategorizedArticleContract.keywordRating)
   - **Must NOT exist in ArticleApproveds OR ArticlesApproved02 tables** (prevents duplicate processing)
2. **Content Scraping**: Adaptive scraping strategy with quality thresholds:
   - **If existing content ≥ 400 chars**: Use existing content without re-scraping
   - **If existing content < 400 chars**: Attempt re-scraping to improve quality
     - Try cheerio first: Replace if result is ≥ 400 chars AND longer than existing
     - If cheerio < 400 chars: Try puppeteer, replace if result is longer than existing
     - If neither improves content: Keep existing content
   - **If no existing content**: Perform initial scraping (250 char minimum threshold)
     - Try cheerio first (10s timeout), fall back to puppeteer if < 250 chars or failure
   - **Scrape status tracking**: Updates scrapeStatusCheerio/scrapeStatusPuppeteer flags in ArticleContents
   - **Content replacement**: Deletes old ArticleContent row and creates new one when better content found
3. **Prompt Generation**: Template at `src/templates/prompt02.md` with placeholders: `<< ARTICLE_TITLE >>`, `<< ARTICLE_DESCRIPTION >>`, `<< ARTICLE_SCRAPED_CONTENT >>`
4. **LLM Analysis**: OpenAI API (gpt-4o-mini, max_tokens: 100, temperature: 0) returns structured JSON with product, state, hazard, relevance_score, united_states_score
5. **Result Recording**: Updates ArticlesApproved02, ArticleStateContract, and ArticleEntityWhoCategorizedArticleContracts02 based on relevance_score (approved if 7-10)

### Service Exit Conditions

The service runs in a loop until one of two conditions is met:

1. **Target Reached**: Number of approved articles (isApproved: true in ArticlesApproved02) reaches TARGET_APPROVED_ARTICLE_COUNT
2. **No More Articles**: No articles remain that match the selection criteria (semantic rating > 0.4, not previously processed)

### Key Business Rules

- Articles approved when relevance_score is 7, 8, 9, or 10
- State lookup is case-insensitive against State.name field
- Invalid API responses still create ArticlesApproved02 record with isApproved: false
- **ArticlesApproved02 PDF report fields** (only populated when isApproved=true):
  - headlineForPdfReport: article.title
  - publicationNameForPdfReport: article.publicationName
  - publicationDateForPdfReport: article.publishedDate
  - urlForPdfReport: article.url
  - textForPdfReport: scraped content (always populated, falls back to description)
- ArticleEntityWhoCategorizedArticleContracts02 stores API response with typed columns: valueString (product, state, hazard), valueNumber (relevance_score, united_states_score)

## Environment Configuration

Required variables in `.env`:

- NAME_APP: Application identifier
- NAME_DB: SQLite database filename (newsnexus10.db)
- PATH_DATABASE: Absolute path to database directory
- KEY_OPEN_AI: OpenAI API key
- TARGET_APPROVED_ARTICLE_COUNT: The target number of approved articles to process

## Database Tables Reference

### Primary Tables

- **Articles**: Core article storage with title, description, url, publishedDate
- **ArticleContents**: Scraped content with scrapeStatusCheerio and scrapeStatusPuppeteer flags
- **ArticleApproveds**: Human user approval decisions (userId FK, isApproved flag) - check for duplicate processing
- **ArticlesApproved02**: AI approval decisions (artificialIntelligenceId FK, isApproved flag) - check for duplicate processing
- **ArticleStateContract**: Article-to-State many-to-many junction
- **ArticleEntityWhoCategorizedArticleContract**: Links articles to categorizers with keyword and keywordRating (used for semantic score filtering)
- **ArticleEntityWhoCategorizedArticleContracts02**: Flexible key-value storage for AI responses
- **ArtificialIntelligences**: AI system registry (lookup NewsNexusSemanticScorer02 here)
- **EntityWhoCategorizedArticle**: Links AI systems to categorization actions
- **State**: US states (name, abbreviation)

### Important Relationships

- ArtificialIntelligences → EntityWhoCategorizedArticle (1:Many)
- EntityWhoCategorizedArticle → ArticleEntityWhoCategorizedArticleContract (1:Many)
- Article → ArticlesApproved02 via artificialIntelligenceId FK
- Article → ArticleStateContract → State (many-to-many)

## Development Commands

**Note**: No package.json or build configuration exists yet. When implementing:

- Use TypeScript with strict typing
- Install dependencies: cheerio, puppeteer, openai, dotenv, NewsNexus10Db package
- Consider nodemon for development
- Typical commands would be: `npm run dev`, `npm run build`, `npm start`

## LLM Prompt Template

Located at `src/templates/prompt02.md`. Instructs GPT-4o to analyze articles for consumer product safety hazards in the US, returning structured JSON with product, state, hazard, relevance_score (0-10), and united_states_score (0-10). State field must match exact US state names or use "No state mentioned"/"State cannot be determined".
