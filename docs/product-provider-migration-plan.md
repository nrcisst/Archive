# Product Provider Migration Plan

## Goal

Move Archive Beta from open-web-only product discovery to provider-first product discovery without depending on discontinued fashion APIs.

The product pipeline should treat structured marketplace data, affiliate/data feeds, and Brave-discovered live products as peer sources. The local catalog should be the final backfill layer at the bottom of the grid, not the first source.

## Target Provider Strategy

Peer providers, weighted equally:

1. eBay Browse API
   - Structured marketplace data.
   - Best for resale, vintage, accessories, and hard-to-find items.
   - Current env: `EBAY_BROWSE_API_ACCESS_TOKEN`.
   - Production env target: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_MARKETPLACE_ID`.
2. Affiliate/data feeds
   - Structured product feeds from affiliate networks or direct merchant feeds.
   - Current generic feed env: `AFFILIATE_FEED_URL`.
   - Optional env: `AFFILIATE_FEED_TOKEN`.
3. Brave web fallback
   - Candidate discovery for uncovered live retail products.
   - Keeps server-side page validation.
   - Expected env: `BRAVE_SEARCH_API_KEY`.

Bottom backfill:

4. Local catalog
   - Uses `src/data/products.ts`.
   - Runs after peer providers.
   - Fills only when external/live coverage is sparse.

## Provider Contract

Each provider accepts normalized `shopping_intents` and returns normalized `Product` objects.

Core rules:

- `shopping_intents` stay the source of truth.
- `product_type` is hard identity.
- `style_profile` is soft matching/ranking.
- Providers should never infer shoppable intent from `what_to_fix` prose.
- Products must include source metadata so the UI can label them honestly.
- eBay, affiliate/data feeds, and Brave/live results should not be source-ranked above each other. Fit quality should decide.
- Local catalog and curated fallback should sort below peer provider results.

Provider output should include:

- `source`
- `provider_id`
- `provider_label`
- `match_quality`
- `match_reasons`
- `missing_preferences`
- `intent_id`
- `intent_label`

## API Credential Needs

Current useful env vars:

```bash
BRAVE_SEARCH_API_KEY=...
AFFILIATE_FEED_URL=...
AFFILIATE_FEED_TOKEN=...
EBAY_BROWSE_API_ACCESS_TOKEN=...
EBAY_MARKETPLACE_ID=EBAY_US
```

Production eBay env target:

```bash
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
EBAY_MARKETPLACE_ID=EBAY_US
```

## Migration Phases

### Phase 1: Provider Shell

- Add a provider interface.
- Add env-gated eBay provider.
- Add env-gated generic affiliate/data-feed provider.
- Keep Brave available as the active live discovery provider through existing live search code.
- Move local catalog to final backfill.
- Add provider count and skipped-reason logging.

### Phase 2: Provider Matching

- Normalize all provider results into `Product`.
- Score identity hard and style profile soft.
- Dedupe across providers by URL and title/retailer.
- Rank eBay, affiliate/data feeds, and Brave/live by fit quality instead of source.
- Rank local catalog after peer providers.

### Phase 3: eBay Hardening

- Add server-side client credentials OAuth.
- Cache access tokens in memory with expiry.
- Replace manual `EBAY_BROWSE_API_ACCESS_TOKEN` dependency.
- Keep `EBAY_MARKETPLACE_ID` defaulting to `EBAY_US`.
- Log token failures without exposing secrets.

### Phase 4: Feed Hardening

- Pick the first affiliate/data-feed partner.
- Replace the generic feed parser with provider-specific normalization.
- Add fixtures for the chosen feed shape.
- Add provider-specific price, image, retailer, and availability checks.

### Phase 5: Catalog Growth

- Expand local catalog into high-intent anchors for common categories.
- Add `style_profile` coverage for all catalog entries.
- Consider moving catalog data from TS to JSON or a lightweight database.

### Phase 6: UI Labels

- Show honest source labels:
  - `Affiliate feed`
  - `eBay marketplace`
  - `Live web fallback`
  - `Near live match`
  - `Local catalog fallback`
  - `Curated fallback`
- Keep `Near match` visible when preferences are missing.

## Success Criteria

- Useful products can come from eBay, affiliate/data feeds, Brave, or Google without one source always winning.
- Local catalog appears only below peer provider results.
- Category/editorial/search pages are not rendered.
- Product grid is smaller rather than padded with weak matches.
