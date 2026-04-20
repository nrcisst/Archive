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

Minimum:

```bash
GEMINI_API_KEY=...
```

Optional search providers:

```bash
BRAVE_SEARCH_API_KEY=...
GOOGLE_SEARCH_API_KEY=...
GOOGLE_SEARCH_ENGINE_ID=...
```

Brave Search is the preferred live product discovery provider. Google Custom
Search JSON API only works for projects that already have access to that legacy
API.

## Product Retrieval

The product pipeline is intentionally staged:

1. the audit model returns `shopping_queries`, `recommended_categories`, and `missing_pieces`
2. the server discovers candidate product URLs from search providers
3. the server fetches those product pages directly
4. product metadata is extracted from canonical links, Open Graph tags, and JSON-LD `Product` data
5. weak candidates are discarded
6. curated catalog products backfill gaps

This is more reliable than asking a model to invent final product cards directly.

## Verification

Useful commands:

```bash
npm run lint
npm run build
```
