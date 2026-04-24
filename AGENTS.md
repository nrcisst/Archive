<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Archive Beta Project Notes

Archive Beta is a site-first AI fashion broker. A user uploads an outfit photo or writes a style brief, receives a structured style audit, and gets shopping recommendations.

## Local Commands

```bash
npm run dev
npm run lint
npx tsc --noEmit
npm run build
```

Use `npm run lint` and `npx tsc --noEmit` after TypeScript or route-handler changes. `npm run build` can hit a local Turbopack sandbox/process-port limitation in this environment; if that happens, treat lint plus typecheck as the baseline verification unless elevated execution is approved.

## Environment Variables

Required Gemini auth, choose one:

```bash
GEMINI_API_KEY=...
```

or Vertex AI service-account auth:

```bash
GOOGLE_APPLICATION_CREDENTIALS=./archive-494221-ae348152ea89.json
GOOGLE_CLOUD_PROJECT=archive-494221
GOOGLE_CLOUD_LOCATION=global
```

If `GOOGLE_APPLICATION_CREDENTIALS` is omitted locally, the server also checks
for a root-level `archiv*.json` service-account file and prefers it over
`GEMINI_API_KEY`.

Preferred live search provider:

```bash
BRAVE_SEARCH_API_KEY=...
```

Google Custom Search JSON API is currently disabled in the product-search pipeline. Do not assume Google CSE is available.

## Core Flow

1. The client sends audit input to `src/app/api/audit/route.ts`.
2. Photo uploads start early through `src/app/api/uploads/route.ts`; `/api/audit` should prefer `image_upload_id` and fall back to inline `image_base64`.
3. Gemini returns a structured `StyleAudit` with variable-count `shopping_intents`.
4. The client sends `shopping_intents`, `shopping_queries`, `recommended_categories`, `missing_pieces`, `what_works`, and `what_to_fix` to `src/app/api/products/route.ts`.
5. `src/lib/product-search.ts` builds searches from `shopping_intents` first, discovers live product candidates, fetches candidate pages server-side, and rejects weak pages.
6. `src/lib/recommendations.ts` adds limited curated fallback products only when they match the actual shopping intent.

## Shopping Intent Contract

`shopping_intents` is the product-search source of truth. The legacy flat arrays still exist for UI/backward compatibility, but search should not infer intent from prose when a structured intent is available.

Each intent should describe one item worth shopping:

- `category`: one of `outerwear`, `tops`, `pants`, `shoes`, `accessories`
- `product_type`: non-negotiable product identity, such as `sneakers`, `chain necklace`, `beanie`, or `corduroy pants`
- `display_label`: human-readable card/audit label
- `search_query`: concise retail search phrase used first
- `alternate_queries`: 0-2 alternate retail phrases for the same item only
- `required_terms`: identity terms the validated product should satisfy
- `optional_terms`: style, fit, color, material, or vibe terms
- `avoid_terms`: obvious bad matches such as `pattern`, `tutorial`, `fabric`, `guide`, `article`, or `blog`
- `replaces_visible_item`: true only when the intent is replacing a visible garment

The model should return only as many intents as the outfit actually needs, usually 1-5. Do not add filler intents to reach a fixed card count.

## Product Search Principles

- Do not optimize for six cards at any cost. Fewer trustworthy cards are better than a full grid of weak results.
- Product cards must be honest about source:
  - `Live search result` for `source: "live"`
  - `Curated fallback` for `source: "curated"`
- Broad web search is noisy. Treat Brave as candidate discovery, not truth.
- Gemini should generate audit intent and fallback URL candidates only. It should not be trusted as the final product source.
- Use `what_works` as a protection signal. Do not shop for garments that are already working unless replacement is explicitly justified.
- Use `shopping_intents` as the primary shopping intent. Fall back to `shopping_queries` and `missing_pieces` only for older responses.
- Do not let one category dominate the grid. The current search code caps repeated category queries and diversifies final products.
- Search all primary intent queries first. Use `alternate_queries` only as extra retrieval coverage for the same exact item.

## Live Product Vetting

Live product results must pass server-side page validation before rendering. The validator should reject:

- HTTP errors and non-HTML responses
- soft 404 / page-not-found pages
- article, blog, review, guide, editorial, or magazine pages
- homepages, search pages, and broad category pages
- pages without product schema, product meta tags, product-like URL evidence, title, image, retailer, and page price
- declared non-USD prices

Useful log lines:

```text
[product-search] Brave Search starting
[product-search] Brave Search query complete
[product-search] Candidate discovery complete
[product-search] Candidate rejected after fetch
[product-search] Candidate accepted
[product-search] Live products before diversity
[product-search] Category diversity applied
[products] Product response ready
```

Every rejection should include a compact `reason`, provider, URL, intent/category context, and any currency/type evidence needed to tune search quality. Avoid noisy full candidate dumps unless actively debugging.

## Curated Fallback

Curated fallback lives in `src/data/products.ts` and is ranked by `src/lib/recommendations.ts`.

Rules:

- Fallback must be labeled as fallback in the UI.
- Fallback should match `shopping_intents` when present, not broad categories alone.
- Fallback should return a small number of high-intent products instead of padding to six.
- If live search returns at least one vetted product, curated backfill should stay small.
- Expanding the curated catalog is currently more valuable than trying to make open-web search perfect.

## Next.js Docs To Read Before Code Changes

Read the relevant local docs under `node_modules/next/dist/docs/` before editing Next-specific code. Common files:

- Route handlers: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- Fetch behavior: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/fetch.md`
- Config: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/`

## Current Quality Bar

Before calling the work done:

- Run `npm run lint`.
- Run `npx tsc --noEmit` for TypeScript or API changes.
- For product-search changes, run a real audit and inspect logs for provider counts, rejection reasons, live count, curated fallback count, and final returned count.
- Do not hide weak product matching by padding the UI.
