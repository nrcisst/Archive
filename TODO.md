# TODO

## Current Priority

Migrate Archive Beta from open-web product discovery to provider-first product discovery without relying on discontinued fashion APIs.

The product grid should treat eBay, affiliate/data feeds, and Brave live discovery as equal peer sources. The local catalog should sit at the bottom as final backfill only.

Target order:

1. eBay Browse API
2. Affiliate/data feeds
3. Brave web fallback
4. Local catalog fallback

## Done / Current State

- `GEMINI_API_KEY` drives audit generation.
- Photo pre-upload exists through `/api/uploads`.
- `/api/audit` can use `image_upload_id` and fall back to inline `image_base64`.
- Audit output now uses atomic `style_actions`.
- Only shoppable `add` / `replace` actions can become shopping intents.
- `shopping_intents` are the product-search source of truth.
- `product_type` is broad hard identity.
- `style_profile` carries soft preferences such as fit, color, material, finish, leg, scale, and placement.
- Product search supports `match_quality: "exact" | "near"`.
- Product cards show source labels and near-match missing preferences.
- `docs/product-provider-migration-plan.md` captures the provider-first migration plan.
- `src/lib/product-providers.ts` now orchestrates:
  - affiliate/data feed provider shell
  - eBay provider shell
  - Brave live web fallback
  - local catalog bottom backfill
- eBay, affiliate/data feeds, and live web results are ranked by match quality rather than source priority.
- Local catalog and curated fallback rank below peer provider results.
- `/api/products` uses the provider orchestrator.
- Existing web fallback still validates live product pages server-side before rendering.
- Google CSE and Gemini URL finder are disabled in product discovery for now.

## Needed From User

For live web discovery:

```bash
BRAVE_SEARCH_API_KEY=...
```

For the current temporary eBay implementation:

```bash
EBAY_BROWSE_API_ACCESS_TOKEN=...
EBAY_MARKETPLACE_ID=EBAY_US
```

For production eBay OAuth:

```bash
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
EBAY_MARKETPLACE_ID=EBAY_US
```

For affiliate/data feeds, choose the first source. Examples:

- Impact
- CJ
- Rakuten Advertising
- Awin
- Direct merchant product feed

The current generic feed shell can use:

```bash
AFFILIATE_FEED_URL=...
AFFILIATE_FEED_TOKEN=...
```

## Immediate Next Steps

### 1. eBay OAuth

- Add server-side eBay client credentials OAuth.
- Cache access tokens in memory with expiry.
- Replace manual `EBAY_BROWSE_API_ACCESS_TOKEN` dependency.
- Keep `EBAY_MARKETPLACE_ID` defaulting to `EBAY_US`.
- Log token failures without exposing secrets.

### 2. Pick Affiliate/Data Feed Source

- Decide the first affiliate network or direct merchant feed.
- Confirm whether the feed is JSON, CSV, XML, or API search.
- Map fields:
  - title/name
  - brand
  - retailer/merchant
  - price/sale price
  - currency
  - product URL/click URL
  - image URL
  - category
  - availability if present
- Replace the generic feed parser with provider-specific normalization when the source is known.

### 3. Provider Ranking

- Keep eBay, affiliate/data feeds, and Brave live web weighted equally.
- Prefer exact matches over near matches.
- Use missing preferences as the main tie-breaker.
- Keep local catalog as final backfill below live web fallback.
- Avoid returning six cards if only one or two are credible.
- Dedupe across providers by URL, title, retailer, and likely canonical product identity.

### 4. Web Fallback Budget

- Run Brave as the active web fallback source while validating every candidate server-side.
- Keep Google CSE and Gemini URL finder disabled unless we explicitly revisit them.
- Keep server-side validation for every web result.
- Keep host-spread logging so blocked retailers do not consume every fetch slot.

### 5. UI Source Labels

Current labels:

- `Affiliate feed`
- `eBay marketplace`
- `Live web fallback`
- `Near live match`
- `Local catalog fallback`
- `Curated fallback`

Next UI improvement:

- Show small source mix text above the grid:
  - `2 eBay marketplace`
  - `1 affiliate feed`
  - `1 live web fallback`
  - `1 local catalog fallback`

## Product Quality Rules

- Never infer shopping intent from critique-only prose.
- Do not shop for `keep` actions.
- Do not shop for `remove`, `tailor`, or `avoid` actions.
- Product identity is hard:
  - jeans
  - pants
  - chain necklace
  - sneakers
  - jacket
  - polo
- Style profile is soft:
  - black
  - slim
  - straight
  - clean
  - no rips
  - silver
  - thin
- Exact match means identity plus strong preference match.
- Near match means identity plus partial preference match.
- Reject means wrong identity, weak page, category/editorial/search page, or blocked/missing product evidence.

## Demo Test Set

Create and repeatedly test 3 known demo flows:

- utilitarian streetwear outfit
- clean minimalist outfit
- elevated dinner/gallery outfit

For each, capture:

- expected `style_actions`
- expected `shopping_intents`
- acceptable product categories
- unacceptable product categories
- expected provider order
- sample logs from a good run

## Logging Requirements

Keep logs actionable but compact.

Required signals:

```text
[products] Search request
[product-providers] Provider search complete
[products] Provider results
[product-search] Built search queries
[product-search] Candidate discovery complete
[product-search] Candidate rejected after fetch
[product-search] Live products before diversity
[product-search] Category diversity applied
[products] Product response ready
```

Provider logs should include:

- provider id
- product count
- skipped reason
- duration
- returned source mix

Rejected web candidates should include:

- `reason`
- provider
- compact URL
- intent/category context
- currency if present

Avoid dumping full candidate lists unless actively debugging a specific provider failure.

## Provider Notes

### eBay Browse API

Env vars:

```bash
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
EBAY_MARKETPLACE_ID=EBAY_US
```

Temporary env:

```bash
EBAY_BROWSE_API_ACCESS_TOKEN=...
```

Role:

- Peer structured provider.
- Useful for resale, vintage, accessories, and hard-to-find items.
- Needs OAuth token management before production use.

Docs:

- https://developer.ebay.com/api-docs/buy/static/api-browse.html
- https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search

### Affiliate/Data Feeds

Env vars for the generic shell:

```bash
AFFILIATE_FEED_URL=...
AFFILIATE_FEED_TOKEN=...
```

Role:

- Peer structured provider.
- Best long-term path for clean product cards without scraping.
- The first real implementation should be source-specific once the feed/network is chosen.

Candidate sources:

- Impact
- CJ
- Rakuten Advertising
- Awin
- Direct merchant feeds

### Brave Search

Env var:

```bash
BRAVE_SEARCH_API_KEY=...
```

Role:

- Peer live discovery fallback.
- Treat as candidate discovery, not product truth.
- All results must still be fetched and validated server-side.

Docs:

- https://brave.com/search/api/
- https://api-dashboard.search.brave.com/

### Google Custom Search

Env vars:

```bash
GOOGLE_SEARCH_API_KEY=...
GOOGLE_SEARCH_ENGINE_ID=...
```

Role:

- Peer live discovery fallback while testing the new shopping-intent schema.
- Do not rely on it as the only provider for new projects.
- If logs show `This project does not have the access to Custom Search JSON API`, move on.

Docs:

- https://developers.google.com/custom-search/v1/introduction
- https://developers.google.com/custom-search/v1/overview

### Local Catalog

Role:

- Bottom fallback only.
- Useful for known high-intent anchors while external providers are unavailable or sparse.
- Should not outrank eBay, affiliate/data feeds, Brave/live results, or Google/live results.

## Later Improvements

- Move local catalog from TS to JSON or a lightweight database.
- Expand local catalog to 50-100 high-intent anchor products.
- Add provider-specific fixtures for repeatable tests.
- Add automated tests for provider normalization and matching.
- Add source/provider analytics.
- Add provider health dashboard/log summary.
