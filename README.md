# Archive Beta

Archive is a site-first AI fashion broker. A user uploads an outfit photo or writes a style brief, receives a structured audit, and gets shoppable recommendations.

## Getting Started

Run the app locally:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

Minimum Gemini auth, choose one:

```bash
GEMINI_API_KEY=...
```

or Vertex AI service-account auth:

```bash
GOOGLE_APPLICATION_CREDENTIALS=./archive-494221-ae348152ea89.json
GOOGLE_CLOUD_PROJECT=archive-494221
GOOGLE_CLOUD_LOCATION=global
```

If `GOOGLE_APPLICATION_CREDENTIALS` is omitted locally, the server will also
look for a root-level `archiv*.json` service-account file and prefer it over
`GEMINI_API_KEY`.

Optional search providers:

```bash
BRAVE_SEARCH_API_KEY=...
```

Brave Search is the active live product discovery provider. Google Custom
Search JSON API is currently disabled in the product-search pipeline.

## Product Retrieval

The product pipeline is intentionally staged:

1. the audit model returns a structured `StyleAudit`
2. `shopping_intents` define the exact products worth searching
3. the server searches primary intent queries first, then optional alternate queries for the same item
4. the server discovers candidate product URLs from search providers
5. the server fetches those product pages directly
6. product metadata is extracted from canonical links, Open Graph tags, and JSON-LD `Product` data
7. weak candidates are discarded
8. curated catalog products backfill small gaps

This is more reliable than asking a model to invent final product cards directly.

## Shopping Intents

`shopping_intents` is the search contract between the audit and product retrieval. The model should return only as many intents as the outfit actually needs, not a fixed number of cards.

Each intent includes:

- `category` and `product_type`
- `display_label` for the audit/UI
- `search_query` for live retrieval
- optional `alternate_queries` for the same item
- `required_terms`, `optional_terms`, and `avoid_terms` for validation
- `replaces_visible_item` when the search replaces something already in the outfit

The older `missing_pieces`, `recommended_categories`, and `shopping_queries` arrays still exist for compatibility, but product search prefers `shopping_intents`.

## Recent Direction

The current product-search work focused on making the audit-to-shopping flow more intelligent:

- protect pieces that `what_works` says are already successful
- avoid shopping visible garments unless replacement is explicitly justified
- reject articles, guides, category pages, sewing patterns, and weak product pages
- avoid padding the grid with curated products when live results are limited
- stream real product-search progress to the UI instead of showing a static loader
- keep logs useful but compact enough to debug provider counts, rejection reasons, diversity, and final source mix

## Verification

Useful commands:

```bash
npm run lint
npx tsc --noEmit
npm run build
```
