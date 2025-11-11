# NewsNexus LLM Article Analyzer 04

This TypeScript micro service connects to the NewsNexus database and uses OpenAI's GPT-4o model to analyze articles.

## Requirements

We want to make a micro service that will be written in TypeScript and communicate with the News Nexus 10 platform. It wil connect directly to the NewsNexus10.db which is a sqlite database and the connection will occur using the NewsNexus10Db package. The details for using this package are in the docs/DATABASE_OVERVIEW.md file.

This service will analyze articles in the database by sending articles in a curated prompt to the ChatGPT API.

The service will loop over the articles in descending order by Article.id (The Articles table id). The service will run until it hits the approval goal determined by the .env variable called TARGET_APPROVED_ARTICLE_COUNT. TARGET_APPROVED_ARTICLE_COUNT is a number. If there are no more articles to analyze, based on the selction criteria, the service will exit.

To do this the service will:

### Step 1: Article Selection

The service will select articles in descending order by Article.id (The Articles table id). It will also filter on articles whose News Nexus Semantic rating is above .4. Also articles that have already been approved will be filtered out, by checking the ArticleApproveds or ArticlesApproved02 tables for the articleId.

To determine the News Nexus Semantic rating the service will query the ArticleEntityWhoCategorizedArticleContract table filter on the articleId and the entityWhoCategorizesId equal to the “NewsNexusSemanticScorer02”. To get the entityWhoCategorizesId value the service will use the relationship between the ArtificialIntelligences table and the EntityWhoCategorizedArticle table. I expect it to be “3” but in the case that it is not we want to use the “NewsNexusSemanticScorer02” because that is the entity that rates the articles for the News Nexus Semantic Score. In the ArticleEntityWhoCategorizedArticleContract table use the keywordRating field and verify the article has a score of above 0.40.

### Step 2: scrap content

Once the service has selected an article to analyze it will scrape for the article content using two methods the basic html using the cheerio package and the more in depth approach using the puppeteer package.

First the service will use cheerio to scrape. If this fails or returns less than 250 characters it will be treated as a fail and then scrape using the puppeteer package. The time out for each approach will be 10 seconds.

The scraped data will be placed in the ArticlesContent table. The scraped content will go in the content field.

### Step 3: save scraped content and create prompt

Once the scraping has been completed a message will be created using the src/tempaltes/prompt02.md file. The service will create a prompt for the ChatGPT model api request. This prompt02.md file has `<< ARTICLE_TITLE >>`, `<< ARTICLE_DESCRIPTION >>`, and `<< ARTICLE_SCRAPED_CONTENT >>` strings that should be replaced with the article title and description from the article being analzyed, then the scrapped content will replace the `<< ARTICLE_SCRAPED_CONTENT >>` string.

### Step 4: send ChatGPT api request

We want to send requests with the modified prompt to https://api.openai.com/v1/chat/completions and try the gpt-4o-mini, with max 100 tokens and temperature: 0. The request should be sent with the key from the .env file, KEY_OPEN_AI.

If the response is valid which means it takes the form of

```
{
"product": "string",
"state": "string",
"hazard": "string",
"relevance_score": 0,
"united_states_score": 0
}
```

Then we will use the relevance_score and the state values. If the relevance_score is not 7, 8, 9, or 10 then the article will be isApproved:false.

The state needs to be found in the State table (name column). We should make the state response in lowercase and lookup against the lowercase version of the State.name.

### Step 5: Record results

The service will use the response to determine if a new row should be added to the ArticlesApproved02, ArticleStateContract, and ArticleEntityWhoCategorizedArticleContracts02 tables.

#### Update ArticlesApproved02

If the response is a valid format and the relevance_score is 7, 8, 9, or 10 then we will create a new row in the ArticlesApproved02 table where isApproved is true. If otherwise, we will create a new row in the ArticlesApproved02 table where isApproved is false. If the format is not valid we will still create a row in the ArticlesApproved02 table where isApproved is false.

In the articleApprovedTextForPdfReport column, I want to place the scraped content, but if there is not scraped content then we should just place the description.

#### Update ArticleStateContract

If the article is approved then we will create a new row in the ArticleStateContract table where the articleId is the articleId from the article array received initially from the API for the current article and the stateId is the id determined by looking up the State name in the State table.

#### Update ArticleEntityWhoCategorizedArticleContracts02

This table is meant to handle responses from prompts like the one we are sending to ChatGPT. The table has a key column which is a string and is the name of the key in the response. We will have three other columns “valueString”, “valueNumber”, and “valueBoolean”, where these could be null. Depending on the resposne we will place the value in the appropriate column. "product", "state", and "hazard" will be stored in the “valueString” column. "relevance_score" and "united_states_score" will be stored in the “valueNumber” column.

Use the .env variable NAME_APP to determine the entityWhoCategorizesId which is needed to update a row in the ArticleEntityWhoCategorizedArticleContracts02 table’s entityWhoCategorizesId field. This process is just like when looking up the "NewsNexusSemanticScorer02”. You will find the value corresponding to NAME_APP in the ArtificialIntelligences table and then use the relationship to the EntityWhoCategorizedArticle to determine the entityWhoCategorizesId.

### use .env file

The .env file should have the following variables:

```
NAME_APP=NewsNexusLlmArticleAnalyzer04
NAME_DB=newsnexus10.db
PATH_DATABASE=/Users/nick/Documents/_databases/NewsNexus10/
KEY_OPEN_AI=sk-SECRET
TARGET_APPROVED_ARTICLE_COUNT=150
```
