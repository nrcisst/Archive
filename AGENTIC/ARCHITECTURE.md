# Archive Beta Architecture

## Technical Goal
Build a fast beta website that can accept image or text input, generate a structured fashion audit, and return product recommendations.

## Recommended Stack
### Frontend
- **Next.js**
- **TypeScript**
- **Tailwind CSS**
- **Vercel** for deployment

### AI Layer
- model API for:
  - vision + text interpretation
  - structured style audit generation
  - recommendation formatting

### Product Retrieval Layer
Use a staged retrieval pipeline for beta reliability:

1. structured audit fields produce shopping intent
2. search providers return candidate product URLs
3. Archive fetches those product pages directly
4. metadata extraction validates title / image / price / canonical URL
5. curated catalog products backfill gaps if live retrieval is weak

## Why this architecture
Because the hardest part of the beta is not rendering chat. It is returning answers that feel coherent and shoppable.

A staged retrieval layer is more defensible than letting the model fabricate product objects, while still preserving a curated fallback when live retrieval is weak.

## High-Level System Flow
1. user submits photo or text prompt
2. frontend sends request to server route
3. server prepares structured prompt
4. model returns style audit JSON
5. retrieval layer turns audit intent into product candidates, validates live pages, and backfills with curated products when needed
6. frontend renders:
   - audit
   - missing pieces
   - shopping cards
7. analytics logs product clicks

## Core Modules
### 1. UI Layer
Responsibilities:
- responsive layout
- input collection
- rendering response sections
- managing loading and error states

### 2. Prompt Builder
Responsibilities:
- normalize user input
- combine photo/text with context
- enforce consistent output schema

### 3. Audit Generator
Responsibilities:
- call model
- receive structured response
- validate output shape
- fall back gracefully if model output is malformed

### 4. Product Recommendation Layer
Responsibilities:
- turn audit intent into search queries and category hints
- discover candidate product URLs from search providers
- fetch product pages and extract metadata
- reject weak pages and preserve only usable products
- backfill with curated products when live search is insufficient

### 5. Analytics Layer
Responsibilities:
- track submissions
- track generated results
- track link clicks

## Suggested Output Schema
```json
{
  "summary": "",
  "score": 0,
  "aesthetic_read": "",
  "what_works": [""],
  "what_to_fix": [""],
  "missing_pieces": [""],
  "recommended_categories": [""],
  "shopping_queries": [""],
  "tone": ""
}
```

## Data Strategy for Beta
### Input data
- image upload
- text prompt
- budget
- occasion

### Output data
- audit object
- recommended product cards
- click events

### Persistence
For beta:
- no user accounts
- browser-local session state is enough
- optional server logs for analytics

## Product Recommendation Strategy
### Best beta path
Use a hybrid product strategy:
- structured audit output drives search intent
- live search discovers candidate product URLs
- server-side page parsing validates image / price / product page quality
- curated catalog fills any remaining gaps

Example categories:
- outerwear
- tops
- pants
- shoes
- accessories

This keeps the beta shoppable without trusting raw model output or depending entirely on fragile live search.

## Future Architecture Extensions
### Fit DNA
Later modules may include:
- user profile measurements
- body-shape inference
- garment measurement ingestion
- fit confidence layer

### Resale Arbitrage Agent
Later modules may include:
- trend monitoring pipeline
- price ingestion
- resale market history
- alerting layer

## Deployment
- host on Vercel
- environment variables for model API keys
- lightweight logging
- launch on custom domain if available

## Non-Functional Requirements
- fast first response
- mobile-friendly interaction
- graceful fallback on failed model calls
- no blocking on external services unless essential

## Engineering Rule
For beta, optimize for:
- demo reliability
- coherent outputs
- fast iteration

Do not optimize for:
- perfect personalization
- deep infra
- production-scale architecture
