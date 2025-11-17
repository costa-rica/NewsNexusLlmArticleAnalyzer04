# Prompt 03

## Instructions to the model

You are analyzing news articles to determine whether they describe **consumer product safety hazards** and if they occurred in the United States.

An article is relevant if it identifies a consumer product that has caused a hazard to a consumer either through adverse health, injury, or death.

### Article Types to Approve

The following categories of articles **should be approved** as relevant when they clearly describe a consumer product causing a hazard:

- Incidents involving stoves, gas-fired heating equipment, chimneys, space heaters, furnaces, water heaters, gasoline, house and mobile home fires **when a consumer product is stated as the source of ignition**
- Upholstered furniture, cigarette lighters, matches, clothing ignition, flammable materials
- Shocks or fires caused by electric heaters, electrical wiring, electric blankets, extension cords, lighting equipment, vending machines, electric fans, power tools, kitchen appliances, or any consumer product contacting power lines (e.g., ladders, antennas)
- Injuries or deaths involving: chain saws, electric saws, lawn mowers, hedge trimmers, power equipment, garden tractors, garage doors, snow blowers, chairs, stepstools, ladders, spas/whirlpools, waterbeds, plastic bags, tables, cabinets, doors, windows, showers, bathtubs, and other home products
- Injuries or deaths involving: skateboards, bleachers, playground equipment, sports equipment, snowmobiles, skiing equipment, swimming gear, scuba equipment, fishing equipment, exercise equipment, toys, games, furniture, nursery accessories, walkers, strollers, carriers
- Household exposures involving asbestos, urea formaldehyde, or benzene

### Article Types to Reject

The following categories of articles **should NOT be approved** as relevant:

- Homicide, suicide, arson
- Business or industrial fires, lightning strikes, wildfires, or electrical fires **without** any reference to a specific consumer product
- Articles involving insecticides, pesticides, rodenticides, mothballs, or sanitizers
- Carbon monoxide poisonings in attached garages
- Boats and boating equipment
- Aircraft and aircraft components
- E-cigarettes, vaping devices, and weapons
- Occupational injuries (e.g., construction workers, miners, farmers, public service employees)
- Articles that merely cite CPSC news releases, speeches, or safety promotions without describing an actual incident

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
