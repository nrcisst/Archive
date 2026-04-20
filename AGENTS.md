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

Required:

```bash
GEMINI_API_KEY=...
```

Preferred live search provider:

```bash
BRAVE_SEARCH_API_KEY=...
```

Legacy optional provider:

```bash
GOOGLE_SEARCH_API_KEY=...
GOOGLE_SEARCH_ENGINE_ID=...
```

Google Custom Search JSON API is legacy for this project. New Google Cloud projects may return `403` with `This project does not have the access to Custom Search JSON API.` Do not assume Google CSE is available.

## Core Flow

1. The client sends audit input to `src/app/api/audit/route.ts`.
2. Photo uploads start early through `src/app/api/uploads/route.ts`; `/api/audit` should prefer `image_upload_id` and fall back to inline `image_base64`.
3. Gemini returns a structured `StyleAudit`.
4. The client sends `shopping_queries`, `recommended_categories`, `missing_pieces`, `what_works`, and `what_to_fix` to `src/app/api/products/route.ts`.
5. `src/lib/product-search.ts` discovers live product candidates, fetches candidate pages server-side, and rejects weak pages.
6. `src/lib/recommendations.ts` adds limited curated fallback products only when they match the actual shopping intent.

## Product Search Principles

- Do not optimize for six cards at any cost. Fewer trustworthy cards are better than a full grid of weak results.
- Product cards must be honest about source:
  - `Live search result` for `source: "live"`
  - `Curated fallback` for `source: "curated"`
- Broad web search is noisy. Treat Brave as candidate discovery, not truth.
- Gemini should generate audit intent and fallback URL candidates only. It should not be trusted as the final product source.
- Use `what_works` as a protection signal. Do not shop for garments that are already working unless replacement is explicitly justified.
- Use `missing_pieces` and `shopping_queries` as the primary shopping intent.
- Do not let one category dominate the grid. The current search code caps repeated category queries and diversifies final products.

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
[product-search] Candidate rejected after fetch
[product-search] Candidate accepted
[product-search] Category diversity applied
[products] Product response ready
```

Every rejection should include a `reason` so search quality can be tuned from logs.

## Curated Fallback

Curated fallback lives in `src/data/products.ts` and is ranked by `src/lib/recommendations.ts`.

Rules:

- Fallback must be labeled as fallback in the UI.
- Fallback should match `missing_pieces` and `shopping_queries`, not broad categories alone.
- Fallback should return a small number of high-intent products instead of padding to six.
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
