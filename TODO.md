# TODO

## Current Priority

Make Archive feel trustworthy even when open-web product search is weak.

The app should not pretend every recommendation is live or exact. It should show fewer, better-vetted live products, clearly label curated fallback, and make the audit-to-shopping intent feel coherent.

## Done / Current State

- `GEMINI_API_KEY` drives audit generation.
- `BRAVE_SEARCH_API_KEY` is the preferred live candidate discovery provider.
- Google Custom Search JSON API is legacy only and may fail with project-access `403`.
- Photo pre-upload exists through `/api/uploads`.
- `/api/audit` can use `image_upload_id` and fall back to inline `image_base64`.
- `/api/products` receives:
  - `shopping_queries`
  - `recommended_categories`
  - `missing_pieces`
  - `what_works`
  - `what_to_fix`
  - `budget`
- Product cards now distinguish `Live search result` from `Curated fallback`.
- Live products are fetched and validated server-side before rendering.

## This Week Goals

### 1. Trustworthy Product Grid

- Do not pad to six cards with weak products.
- Keep fallback clearly labeled.
- Show fewer cards when only a few products are credible.
- Add a small UI summary such as:
  - `1 vetted live result`
  - `2 curated fallback picks`
  - `Search was strict this round`

### 2. Better Curated Catalog

Expand `src/data/products.ts` to 30-50 realistic fallback entries.

Prioritize:

- utilitarian streetwear
- minimalist basics
- elevated casual
- technical bags/slings
- tailored pants/trousers
- denim and lightweight outerwear
- shoes that match the common audit outputs

Each curated item should have:

- stable retailer/category/product URL
- useful title
- realistic price
- category
- aesthetic tag
- image URL that does not look wildly unrelated

### 3. Audit Intent Quality

The audit should not recommend buying what already works.

Improve and test prompts so:

- `what_works` names already-owned strengths
- `what_to_fix` describes issues without automatically forcing replacement shopping
- `missing_pieces` lists real next purchases
- `shopping_queries` are specific and buyable
- one category does not dominate all recommendations

### 4. Product Search Logging

Keep logs actionable.

Required signals:

```text
[products] Search request
[product-search] Built search queries
[product-search] Brave Search query complete
[product-search] Candidate discovery complete
[product-search] Candidate rejected after fetch
[product-search] Candidate accepted
[product-search] Category diversity applied
[products] Product response ready
```

Every rejected candidate should include:

- `reason`
- provider
- compact URL
- product evidence booleans
- currency if present

### 5. Demo Set

Create and repeatedly test 3 known demo flows:

- utilitarian streetwear outfit
- clean minimalist outfit
- elevated dinner/gallery outfit

For each, capture:

- expected `what_works`
- expected `missing_pieces`
- acceptable product categories
- unacceptable product categories
- sample logs from a good run

## Search Provider Notes

### Brave Search

Env var:

```bash
BRAVE_SEARCH_API_KEY=...
```

Docs:

- https://brave.com/search/api/
- https://api-dashboard.search.brave.com/
- https://api-dashboard.search.brave.com/app/documentation/web-search/codes

Brave should be treated as candidate discovery only. All results must still be fetched and audited server-side.

### Google Custom Search

Env vars:

```bash
GOOGLE_SEARCH_API_KEY=...
GOOGLE_SEARCH_ENGINE_ID=...
```

Docs:

- https://developers.google.com/custom-search/v1/introduction
- https://developers.google.com/custom-search/v1/overview
- https://programmablesearchengine.google.com/

Current status:

- Keep this as a legacy optional provider.
- Do not rely on it for new projects.
- If logs show `This project does not have the access to Custom Search JSON API`, move on.

### Gemini URL Finder

Current status:

- Last-resort fallback candidate source.
- Useful sometimes, but inconsistent.
- Never treat Gemini URL output as final product truth.

## Later Improvements

- Add retailer-specific integrations or affiliate/product feeds.
- Add source/provider badges and a search-quality status in the UI.
- Add persisted product-search fixtures for repeatable testing.
- Add automated tests for product URL rejection reasons.
- Replace broad curated fallback URLs with stronger exact product/category URLs.
- Track product source/provider in analytics.
