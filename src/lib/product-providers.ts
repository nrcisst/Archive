import { MOCK_AUDIT } from "./mock-data";
import { searchRealProducts } from "./product-search";
import { getRecommendations } from "./recommendations";
import { buildStyleProfileSearchPhrase, getStyleProfilePreferenceTerms } from "./style-profile";
import type {
  Product,
  ProductMatchQuality,
  ProductSearchProgressEvent,
  ProductSource,
  ShoppingIntent,
  StyleAudit,
} from "./types";

export interface ProductProviderInput {
  shopping_queries: string[];
  shopping_intents: ShoppingIntent[];
  recommended_categories: string[];
  budget?: string;
  missing_pieces: string[];
  what_works: string[];
  what_to_fix: string[];
}

export interface ProductProviderRun {
  provider: ProductSource | "web";
  label: string;
  products: Product[];
  skippedReason?: string;
  durationMs: number;
}

type ProductSearchProgressReporter = (
  event: ProductSearchProgressEvent
) => void;

interface ExternalProductCandidate {
  id: string;
  title: string;
  brand?: string;
  retailer: string;
  price: number;
  imageUrl: string;
  productUrl: string;
  category?: string;
  source: ProductSource;
  providerLabel: string;
  intent: ShoppingIntent;
}

const MAX_RETURNED_PRODUCTS = 6;
const EXTERNAL_RESULTS_PER_INTENT = 12;
const PROVIDER_TIMEOUT_MS = 6500;
const AFFILIATE_FEED_RECORD_LIMIT = 1000;

function parseBudgetCap(budget?: string): number | null {
  if (!budget) {
    return null;
  }

  const value = Number.parseInt(budget.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTerm(value: string, term: string): boolean {
  const normalizedTerm = normalizeText(term);
  return normalizedTerm
    ? ` ${normalizeText(value)} `.includes(` ${normalizedTerm} `)
    : false;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    const key = normalizeText(normalized);
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function buildProviderQuery(intent: ShoppingIntent): string {
  return (
    buildStyleProfileSearchPhrase(intent) ||
    intent.search_query ||
    [intent.product_type, ...getStyleProfilePreferenceTerms(intent.style_profile)]
      .filter(Boolean)
      .join(" ")
  )
    .replace(/^men's\s+/i, "")
    .trim();
}

function getProductText(candidate: ExternalProductCandidate): string {
  return [
    candidate.title,
    candidate.brand || "",
    candidate.retailer,
    candidate.category || "",
    candidate.productUrl,
  ].join(" ");
}

function getIdentityTerms(intent: ShoppingIntent): string[] {
  return uniqueStrings([intent.product_type, ...intent.required_terms]).filter(
    (term) => !["accessory", "accessories", "outerwear", "tops"].includes(normalizeText(term))
  );
}

function scoreCandidateForIntent(
  candidate: ExternalProductCandidate,
  intent: ShoppingIntent
): {
  quality: ProductMatchQuality;
  score: number;
  matchReasons: string[];
  missingPreferences: string[];
} | null {
  const productText = getProductText(candidate);
  const identityTerms = getIdentityTerms(intent);
  const matchedIdentityTerms = identityTerms.filter((term) =>
    containsTerm(productText, term)
  );

  if (identityTerms.length > 0 && matchedIdentityTerms.length === 0) {
    return null;
  }

  const preferenceTerms = getStyleProfilePreferenceTerms(intent.style_profile);
  const matchedPreferences = preferenceTerms.filter((term) =>
    containsTerm(productText, term)
  );
  const missingPreferences = preferenceTerms.filter(
    (term) => !matchedPreferences.includes(term)
  );
  const colorRequired = Boolean(intent.style_profile.color);
  const colorMatched = intent.style_profile.color
    ? containsTerm(productText, intent.style_profile.color)
    : true;
  const quality =
    matchedPreferences.length >= Math.min(2, preferenceTerms.length) &&
    (!colorRequired || colorMatched)
      ? "exact"
      : "near";

  return {
    quality,
    score:
      20 +
      matchedIdentityTerms.length * 8 +
      matchedPreferences.length * 5 -
      missingPreferences.length * 2,
    matchReasons: [
      ...(matchedIdentityTerms.length > 0
        ? [`identity:${matchedIdentityTerms.join(", ")}`]
        : []),
      ...(matchedPreferences.length > 0
        ? [`preferences:${matchedPreferences.join(", ")}`]
        : ["identity_match_without_preference_match"]),
    ],
    missingPreferences,
  };
}

function toProduct(candidate: ExternalProductCandidate): Product | null {
  const match = scoreCandidateForIntent(candidate, candidate.intent);
  if (!match) {
    return null;
  }

  return {
    id: candidate.id,
    title: candidate.title,
    brand: candidate.brand || candidate.retailer,
    price: candidate.price,
    image_url: candidate.imageUrl,
    product_url: candidate.productUrl,
    retailer: candidate.retailer,
    category: candidate.intent.category,
    aesthetic: "catalog",
    source: candidate.source,
    provider_id: candidate.source,
    provider_label: candidate.providerLabel,
    match_quality: match.quality,
    match_reasons: match.matchReasons,
    missing_preferences: match.missingPreferences,
    intent_id: candidate.intent.id,
    intent_label: candidate.intent.display_label,
  };
}

function auditFromInput(input: ProductProviderInput): StyleAudit {
  return {
    ...MOCK_AUDIT,
    missing_pieces: input.missing_pieces,
    what_works: input.what_works,
    what_to_fix: input.what_to_fix,
    recommended_categories: input.recommended_categories,
    shopping_queries: input.shopping_queries,
    shopping_intents: input.shopping_intents,
  };
}

function withCatalogSource(product: Product): Product {
  return {
    ...product,
    source: "catalog",
    provider_id: "catalog",
    provider_label: "Local catalog fallback",
  };
}

async function runTimedProvider(
  provider: ProductProviderRun["provider"],
  label: string,
  run: () => Promise<Product[]>,
  skippedReason?: string
): Promise<ProductProviderRun> {
  const startedAt = Date.now();

  if (skippedReason) {
    return {
      provider,
      label,
      products: [],
      skippedReason,
      durationMs: 0,
    };
  }

  try {
    return {
      provider,
      label,
      products: await run(),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.warn("[product-providers] Provider failed", {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      provider,
      label,
      products: [],
      skippedReason: "provider_error",
      durationMs: Date.now() - startedAt,
    };
  }
}

async function catalogProvider(
  input: ProductProviderInput,
  coveredProducts: Product[] = []
): Promise<Product[]> {
  return getRecommendations(auditFromInput(input), input.budget, {
    coveredProducts,
  }).map(withCatalogSource);
}

function getNumber(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : NaN;

  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getFirstString(values: unknown[]): string | null {
  for (const value of values) {
    const result = getString(value);
    if (result) {
      return result;
    }
  }

  return null;
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getAffiliateFeedRecords(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }

  const record = getRecord(data);
  for (const key of ["products", "items", "results", "data"]) {
    const values = getArray(record[key]);
    if (values.length > 0) {
      return values;
    }
  }

  return [];
}

function getAffiliateImage(record: Record<string, unknown>): string | null {
  const image = getRecord(record.image);
  const images = getArray(record.images)
    .map(getRecord)
    .flatMap((entry) => [entry.url, entry.image_url, entry.imageUrl]);

  return getFirstString([
    record.image_url,
    record.imageUrl,
    record.image,
    image.url,
    image.image_url,
    image.imageUrl,
    ...images,
  ]);
}

function getAffiliateProductUrl(record: Record<string, unknown>): string | null {
  return getFirstString([
    record.product_url,
    record.productUrl,
    record.click_url,
    record.clickUrl,
    record.url,
    record.link,
  ]);
}

function getAffiliateRetailer(record: Record<string, unknown>): string | null {
  const retailer = getRecord(record.retailer);
  const merchant = getRecord(record.merchant);
  const advertiser = getRecord(record.advertiser);

  return getFirstString([
    record.retailer,
    retailer.name,
    record.merchant,
    merchant.name,
    record.advertiser,
    advertiser.name,
    record.store,
    record.seller,
  ]);
}

function getAffiliatePrice(record: Record<string, unknown>): number | null {
  const price = getRecord(record.price);
  const salePrice = getRecord(record.sale_price || record.salePrice);

  return (
    getNumber(record.sale_price) ||
    getNumber(record.salePrice) ||
    getNumber(salePrice.value) ||
    getNumber(record.price) ||
    getNumber(price.value) ||
    null
  );
}

function getAffiliateCurrency(record: Record<string, unknown>): string | null {
  const price = getRecord(record.price);
  const salePrice = getRecord(record.sale_price || record.salePrice);

  return getFirstString([
    record.currency,
    record.price_currency,
    record.priceCurrency,
    price.currency,
    salePrice.currency,
  ]);
}

async function affiliateFeedProvider(input: ProductProviderInput): Promise<Product[]> {
  const feedUrl = process.env.AFFILIATE_FEED_URL;
  if (!feedUrl || input.shopping_intents.length === 0) {
    return [];
  }

  const headers: Record<string, string> = {};
  const token = process.env.AFFILIATE_FEED_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(feedUrl, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Affiliate feed ${response.status}`);
  }

  const data = await response.json();
  const records = getAffiliateFeedRecords(data).slice(0, AFFILIATE_FEED_RECORD_LIMIT);
  const budgetCap = parseBudgetCap(input.budget);

  return input.shopping_intents
    .slice(0, 5)
    .flatMap((intent) =>
      records
        .map((entry, index): Product | null => {
          const record = getRecord(entry);
          const currency = getAffiliateCurrency(record);
          const price = getAffiliatePrice(record);
          const title = getFirstString([record.title, record.name]);
          const productUrl = getAffiliateProductUrl(record);
          const imageUrl = getAffiliateImage(record);
          const retailer = getAffiliateRetailer(record) || "Affiliate partner";
          const brand = getFirstString([
            record.brand,
            getRecord(record.brand).name,
            retailer,
          ]);

          if (
            !title ||
            !price ||
            !productUrl ||
            !imageUrl ||
            (currency && currency.toUpperCase() !== "USD") ||
            (budgetCap && price > budgetCap)
          ) {
            return null;
          }

          return toProduct({
            id: `affiliate-${String(record.id || record.sku || `${intent.id}-${index}`)}`,
            title,
            brand: brand || undefined,
            retailer,
            price,
            imageUrl,
            productUrl,
            category: getString(record.category) || intent.category,
            source: "affiliate",
            providerLabel: "Affiliate feed",
            intent,
          });
        })
        .filter((product): product is Product => Boolean(product))
        .slice(0, EXTERNAL_RESULTS_PER_INTENT)
    );
}

function getEbayImage(record: Record<string, unknown>): string | null {
  const image = getRecord(record.image);
  return getString(image.imageUrl);
}

async function ebayProvider(input: ProductProviderInput): Promise<Product[]> {
  const token = process.env.EBAY_BROWSE_API_ACCESS_TOKEN;
  if (!token || input.shopping_intents.length === 0) {
    return [];
  }

  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
  const budgetCap = parseBudgetCap(input.budget);
  const products = await Promise.all(
    input.shopping_intents.slice(0, 5).map(async (intent) => {
      const filters = ["priceCurrency:USD", "buyingOptions:{FIXED_PRICE}"];
      if (budgetCap) {
        filters.push(`price:[..${budgetCap}]`);
      }

      const params = new URLSearchParams({
        q: buildProviderQuery(intent),
        limit: String(EXTERNAL_RESULTS_PER_INTENT),
        filter: filters.join(","),
      });
      const response = await fetch(
        `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
          },
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        throw new Error(`eBay ${response.status}`);
      }

      const data = (await response.json()) as { itemSummaries?: unknown[] };
      return (data.itemSummaries || [])
        .map((entry, index): Product | null => {
          const record = getRecord(entry);
          const priceRecord = getRecord(record.price);
          const price = getNumber(priceRecord.value);
          const title = getString(record.title);
          const productUrl = getString(record.itemWebUrl);
          const imageUrl = getEbayImage(record);
          const seller = getRecord(record.seller);

          if (!title || !price || !productUrl || !imageUrl) {
            return null;
          }

          return toProduct({
            id: `ebay-${getString(record.itemId) || `${intent.id}-${index}`}`,
            title,
            brand: getString(record.brand) || undefined,
            retailer: getString(seller.username) || "eBay",
            price,
            imageUrl,
            productUrl,
            category: intent.category,
            source: "ebay",
            providerLabel: "eBay marketplace",
            intent,
          });
        })
        .filter((product): product is Product => Boolean(product));
    })
  );

  return products.flat();
}

function productKey(product: Product): string {
  return `${product.product_url.toLowerCase()}::${product.title.toLowerCase()}::${product.retailer.toLowerCase()}`;
}

function productSortScore(product: Product): number {
  const source = product.source || "live";
  const catalogPenalty =
    source === "catalog" || source === "curated" ? 100 : 0;
  const nearPenalty = product.match_quality === "near" ? 20 : 0;
  const missingPreferencePenalty = (product.missing_preferences?.length || 0) * 4;
  const matchReasonBonus = product.match_reasons?.length || 0;

  return catalogPenalty + nearPenalty + missingPreferencePenalty - matchReasonBonus;
}

function mergeProviderProducts(products: Product[]): Product[] {
  const deduped = new Map<string, Product>();

  for (const product of products) {
    const key = productKey(product);
    const current = deduped.get(key);
    if (
      !current ||
      productSortScore(product) < productSortScore(current) ||
      (productSortScore(product) === productSortScore(current) &&
        product.price < current.price)
    ) {
      deduped.set(key, product);
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => {
      const priorityDelta = productSortScore(left) - productSortScore(right);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return left.price - right.price;
    })
    .slice(0, MAX_RETURNED_PRODUCTS);
}

export async function searchProductProviders(
  input: ProductProviderInput,
  onProgress?: ProductSearchProgressReporter
): Promise<{
  products: Product[];
  providerRuns: ProductProviderRun[];
}> {
  onProgress?.({
    type: "progress",
    stage: "discovery",
    status: "active",
    detail: "Searching product providers and web fallback.",
    counts: {
      shoppingIntents: input.shopping_intents.length,
    },
  });

  const peerProviderRuns = await Promise.all([
    runTimedProvider(
      "affiliate",
      "Affiliate feed",
      () => affiliateFeedProvider(input),
      process.env.AFFILIATE_FEED_URL ? undefined : "missing_affiliate_feed_url"
    ),
    runTimedProvider(
      "ebay",
      "eBay marketplace",
      () => ebayProvider(input),
      process.env.EBAY_BROWSE_API_ACCESS_TOKEN
        ? undefined
        : "missing_ebay_browse_api_access_token"
    ),
    runTimedProvider("web", "Live web fallback", async () => {
      const products = await searchRealProducts(
        input.shopping_queries,
        input.shopping_intents,
        input.recommended_categories,
        input.budget,
        input.missing_pieces,
        input.what_works,
        input.what_to_fix,
        onProgress
      );

      return products.map((product) => ({
        ...product,
        provider_id: product.provider_id || "web",
        provider_label:
          product.provider_label ||
          (product.match_quality === "near"
            ? "Near live match"
            : "Live search result"),
      }));
    }),
  ]);
  const peerProducts = mergeProviderProducts(
    peerProviderRuns.flatMap((run) => run.products)
  );
  const catalogRun = await runTimedProvider(
    "catalog",
    "Local catalog fallback",
    () => catalogProvider(input, peerProducts),
    peerProducts.length < MAX_RETURNED_PRODUCTS
      ? undefined
      : "external_coverage_sufficient"
  );
  const providerRuns = [...peerProviderRuns, catalogRun];
  const products = mergeProviderProducts(
    providerRuns.flatMap((run) => run.products)
  );

  console.log("[product-providers] Provider search complete", {
    providerRuns: providerRuns.map((run) => ({
      provider: run.provider,
      products: run.products.length,
      skippedReason: run.skippedReason || null,
      durationMs: run.durationMs,
    })),
    peerProducts: peerProducts.length,
    returnedProducts: products.length,
    returnedBySource: products.reduce<Record<string, number>>((counts, product) => {
      const source = product.source || "unknown";
      counts[source] = (counts[source] || 0) + 1;
      return counts;
    }, {}),
  });

  onProgress?.({
    type: "progress",
    stage: "discovery",
    status: "complete",
    detail: "Structured provider search finished.",
    counts: Object.fromEntries(
      providerRuns.map((run) => [run.provider, run.products.length])
    ),
  });

  return { products, providerRuns };
}
