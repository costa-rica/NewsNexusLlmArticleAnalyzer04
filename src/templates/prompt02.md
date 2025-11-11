# Prompt 01

## Instructions to the model

You are analyzing news articles to determine whether they describe **consumer product safety hazards** and if they occurred in the United States.

An article is relevant if it identifies a consumer product that has caused a hazard to a consumer either through adverse health, injury, or death.

### Your task

1. Read the article title, abstract, and content.
2. Decide:
   - Whether it is relevant to consumer product hazards.
   - Whether the event occurred in the United States. It is important that the aritcles identifies the state where the event occurred.
3. Respond **only** with a valid JSON object following the schema below.

### Output JSON format

{
"product": "string",
"state": "string",
"hazard": "string",
"relevance_score": 0,
"united_states_score": 0
}

### "product" value

The product name should be a single word or phrase that best describes the product. If the product is not mentioned, return "No product mentioned".

### "state" value

Can only be the exact name of one of the 50 US States and no other text, otherwise the response must be "No state mentioned" or "State cannot be determined".

### "hazard" value

The hazard name should be a single word or phrase that best describes the hazard. If the hazard is not mentioned, return "No hazard mentioned".

### "relevance_score" and "united_states_score" values

Both Relevance score and United States score range from 0 to 10, where 0 is definitely not relevant/in the US, 5 is uncertain, and 10 is highly relevant/in the US.

## Article

### Article Title

<< ARTICLE_TITLE >>

### Article Description

<< ARTICLE_DESCRIPTION >>

### Article Content

<< ARTICLE_SCRAPED_CONTENT >>
