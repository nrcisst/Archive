import { GoogleGenerativeAI } from "@google/generative-ai";
import { createHash } from "node:crypto";
import type { Product } from "./types";

type SearchProviderName = "brave-search" | "google-cse" | "gemini-url-finder";

interface SearchQuery {
  text: string;
  categoryHint: string;
}

interface ProductCandidate {
  url: string;
  titleHint?: string;
  retailerHint?: string;
  imageHint?: string;
  priceHint?: number;
  categoryHint: string;
  provider: SearchProviderName;
  rank: number;
}

interface ProductPageMetadata {
  canonicalUrl: string;
  title: string | null;
  brand: string | null;
  retailer: string | null;
  imageUrl: string | null;
  price: number | null;
  priceCurrency: string | null;
  isProduct: boolean;
  ogType: string | null;
  hasProductSchema: boolean;
  hasProductMeta: boolean;
}

interface ProviderSearchResult {
  candidates: ProductCandidate[];
  provider: SearchProviderName;
}

const BLOCKED_HOST_SNIPPETS = [
  "google.",
  "googleusercontent.com",
  "pinterest.",
  "instagram.com",
  "facebook.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "reddit.com",
  "x.com",
  "twitter.com",
  "linktr.ee",
];

const FETCH_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
} as const;

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  outerwear: ["jacket", "coat", "blazer", "overshirt", "parka", "bomb", "outerwear"],
  tops: ["shirt", "tee", "sweater", "polo", "hoodie", "knit", "top"],
  pants: ["pants", "trouser", "trousers", "jeans", "chino", "slacks"],
  shoes: ["shoe", "sneaker", "boot", "loafer", "derby", "heel", "clog"],
  accessories: ["belt", "watch", "bracelet", "bag", "cap", "hat", "scarf", "sunglasses"],
};

const EDITORIAL_PATH_SNIPPETS = [
  "/article",
  "/articles",
  "/blog",
  "/blogs",
  "/editorial",
  "/feature",
  "/guide",
  "/guides",
  "/journal",
  "/magazine",
  "/news",
  "/review",
  "/reviews",
  "/story",
  "/stories",
];

const PRODUCT_PATH_SNIPPETS = [
  "/product/",
  "/products/",
  "/p/",
  "/dp/",
  "/item/",
  "/items/",
  "/sku/",
  "/prod/",
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized ? decodeHtmlEntities(normalized) : null;
}

function extractFirstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }

  return null;
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function toAbsoluteUrl(value: string | null, baseUrl: string): string | null {
  if (!value) {
    return null;
  }

  try {
    const resolved = new URL(value, baseUrl);
    return resolved.protocol === "https:" ? resolved.toString() : null;
  } catch {
    return null;
  }
}

function hasBlockedHost(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return BLOCKED_HOST_SNIPPETS.some((snippet) => hostname.includes(snippet));
  } catch {
    return true;
  }
}

function hasSearchLikePath(value: string): boolean {
  try {
    const url = new URL(value);
    const pathname = url.pathname.toLowerCase();

    return (
      pathname === "/" ||
      pathname.startsWith("/search") ||
      pathname.includes("/search/") ||
      pathname.startsWith("/s/") ||
      pathname === "/shop" ||
      pathname === "/shop/" ||
      url.searchParams.has("q") ||
      url.searchParams.has("query") ||
      url.searchParams.has("search")
    );
  } catch {
    return true;
  }
}

function hasEditorialPath(value: string): boolean {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return EDITORIAL_PATH_SNIPPETS.some((snippet) =>
      pathname.includes(snippet)
    );
  } catch {
    return true;
  }
}

function hasProductLikePath(value: string): boolean {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return PRODUCT_PATH_SNIPPETS.some((snippet) => pathname.includes(snippet));
  } catch {
    return false;
  }
}

function hasUnavailableSignal(html: string, title: string | null): boolean {
  const titleText = title?.toLowerCase() || "";
  const textSample = html.slice(0, 80_000).toLowerCase();

  return (
    /\b(404|page not found|product not found|not available|no longer available|does not exist|we can't find|we could not find)\b/.test(titleText) ||
    /\b(page not found|product not found|this product is no longer available|this item is no longer available|sorry, we can't find|sorry, we could not find|does not exist)\b/.test(textSample)
  );
}

function buildProductDiscoveryQuery(query: SearchQuery): string {
  const negativeOperators = [
    "-site:pinterest.com",
    "-site:instagram.com",
    "-site:facebook.com",
    "-site:tiktok.com",
    "-site:youtube.com",
    "-site:reddit.com",
    "-site:x.com",
    "-site:twitter.com",
    "-blog",
    "-article",
    "-review",
    "-guide",
    "-magazine",
    "-editorial",
  ].join(" ");

  return `${query.text} buy shop product page ${query.categoryHint} inurl:product OR inurl:products ${negativeOperators}`
    .replace(/\s+/g, " ")
    .trim();
}

function parseBudgetCap(budget?: string): number | null {
  if (!budget) {
    return null;
  }

  const numeric = Number.parseInt(budget.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeCategoryHint(value: string): string | null {
  const lowered = value.toLowerCase();

  if (
    lowered.includes("bottom") ||
    lowered.includes("pant") ||
    lowered.includes("trouser") ||
    lowered.includes("jean") ||
    lowered.includes("chino")
  ) {
    return "pants";
  }

  if (
    lowered.includes("footwear") ||
    lowered.includes("shoe") ||
    lowered.includes("sneaker") ||
    lowered.includes("boot") ||
    lowered.includes("loafer")
  ) {
    return "shoes";
  }

  if (
    lowered.includes("accessor") ||
    lowered.includes("jewelry") ||
    lowered.includes("jewellery") ||
    lowered.includes("belt") ||
    lowered.includes("watch") ||
    lowered.includes("bracelet") ||
    lowered.includes("necklace") ||
    lowered.includes("bag") ||
    lowered.includes("cap") ||
    lowered.includes("hat") ||
    lowered.includes("scarf") ||
    lowered.includes("sunglasses")
  ) {
    return "accessories";
  }

  if (
    lowered.includes("outerwear") ||
    lowered.includes("jacket") ||
    lowered.includes("coat") ||
    lowered.includes("blazer") ||
    lowered.includes("overshirt") ||
    lowered.includes("parka") ||
    lowered.includes("bomber")
  ) {
    return "outerwear";
  }

  if (
    lowered.includes("top") ||
    lowered.includes("shirt") ||
    lowered.includes("tee") ||
    lowered.includes("sweater") ||
    lowered.includes("hoodie") ||
    lowered.includes("knit") ||
    lowered.includes("polo")
  ) {
    return "tops";
  }

  return null;
}

function inferCategoryHint(value: string, categories: string[]): string {
  const lowered = value.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => lowered.includes(keyword))) {
      return category;
    }
  }

  for (const category of categories) {
    const normalized = normalizeCategoryHint(category);
    if (normalized) {
      return normalized;
    }
  }

  return "accessories";
}

function inferCategoriesFromTexts(values: string[]): Set<string> {
  const categories = new Set<string>();

  for (const value of values) {
    const normalized = normalizeCategoryHint(value);
    if (normalized) {
      categories.add(normalized);
    }
  }

  return categories;
}

function hasReplacementIntent(value: string): boolean {
  return /\b(replace|replacement|swap|upgrade|better|sharper|sleeker|streamline|refine|improve|tailor|tailored|fix|missing|add|needs?|should)\b/i.test(value);
}

function buildSearchQueries(
  shoppingQueries: string[],
  categories: string[],
  missingPieces: string[],
  budget?: string,
  whatWorks: string[] = []
): SearchQuery[] {
  const queries: SearchQuery[] = [];
  const seen = new Set<string>();
  const budgetSuffix = budget ? ` ${budget}` : "";
  const protectedCategories = inferCategoriesFromTexts(whatWorks);
  const explicitlyTargetedCategories = inferCategoriesFromTexts([
    ...missingPieces,
    ...shoppingQueries,
  ]);
  const queryCountsByCategory = new Map<string, number>();

  const addQuery = (
    value: string,
    categoryHint?: string,
    source: "missing-piece" | "shopping-query" | "category" = "shopping-query"
  ) => {
    const normalized = cleanText(value);
    if (!normalized) {
      return;
    }

    const inferredCategory = categoryHint || inferCategoryHint(normalized, categories);
    const shouldAvoidProtectedCategory =
      protectedCategories.has(inferredCategory) &&
      !explicitlyTargetedCategories.has(inferredCategory) &&
      !hasReplacementIntent(normalized);

    if (shouldAvoidProtectedCategory) {
      console.log("[product-search] Skipped protected search query", {
        source,
        category: inferredCategory,
        text: normalized.slice(0, 120),
      });
      return;
    }

    const categoryQueryCount = queryCountsByCategory.get(inferredCategory) || 0;
    if (categoryQueryCount >= 2) {
      console.log("[product-search] Skipped repeated category search query", {
        source,
        category: inferredCategory,
        text: normalized.slice(0, 120),
      });
      return;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    queryCountsByCategory.set(inferredCategory, categoryQueryCount + 1);
    queries.push({
      text: `${normalized}${budgetSuffix}`.trim(),
      categoryHint: inferredCategory,
    });
  };

  for (const piece of missingPieces.slice(0, 4)) {
    addQuery(piece, undefined, "missing-piece");
  }

  for (const query of shoppingQueries.slice(0, 6)) {
    addQuery(query, undefined, "shopping-query");
  }

  if (queries.length === 0) {
    for (const category of categories.slice(0, 3)) {
      const normalizedCategory = normalizeCategoryHint(category) || category.toLowerCase();
      addQuery(`${normalizedCategory} fashion product`, normalizedCategory, "category");
    }
  }

  return queries.slice(0, 6);
}

function extractMetaContent(
  html: string,
  attribute: "property" | "name",
  value: string
): string | null {
  const escaped = escapeRegex(value);
  const patterns = [
    new RegExp(
      `<meta[^>]*${attribute}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*${attribute}=["']${escaped}["'][^>]*>`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }

  return null;
}

function extractCanonicalHref(html: string): string | null {
  const patterns = [
    /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }

  return null;
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(match?.[1]);
}

function extractItempropContent(html: string, itemprop: string): string | null {
  const escaped = escapeRegex(itemprop);

  return extractFirstMatch(html, [
    new RegExp(
      `<meta[^>]*itemprop=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*itemprop=["']${escaped}["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<[^>]*itemprop=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<[^>]*itemprop=["']${escaped}["'][^>]*(?:src|href)=["']([^"']+)["'][^>]*>`,
      "i"
    ),
  ]);
}

function extractJsonStringField(html: string, keys: string[]): string | null {
  const escapedKeys = keys.map(escapeRegex).join("|");

  return extractFirstMatch(html, [
    new RegExp(`"(?:${escapedKeys})"\\s*:\\s*"([^"]+)"`, "i"),
    new RegExp(`'(?:${escapedKeys})'\\s*:\\s*'([^']+)'`, "i"),
  ]);
}

function extractJsonPriceField(html: string, keys: string[]): number | null {
  const escapedKeys = keys.map(escapeRegex).join("|");
  const patterns = [
    new RegExp(`"(?:${escapedKeys})"\\s*:\\s*"?(\\d+(?:\\.\\d{1,2})?)"?`, "i"),
    new RegExp(`'(?:${escapedKeys})'\\s*:\\s*'?(\\d+(?:\\.\\d{1,2})?)'?`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const numeric = Number.parseFloat(match[1]);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }
  }

  return null;
}

function extractJsonLdBlocks(html: string): unknown[] {
  const matches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  const blocks: unknown[] = [];

  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }

    try {
      blocks.push(JSON.parse(raw));
    } catch {
      continue;
    }
  }

  return blocks;
}

function findProductNodes(value: unknown, results: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      findProductNodes(item, results);
    }
    return results;
  }

  if (!value || typeof value !== "object") {
    return results;
  }

  const record = value as Record<string, unknown>;
  const typeValue = record["@type"];
  const typeNames = Array.isArray(typeValue) ? typeValue : [typeValue];
  const loweredTypes = typeNames
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.toLowerCase());

  if (
    loweredTypes.includes("product") ||
    loweredTypes.includes("productgroup")
  ) {
    results.push(record);
  }

  for (const child of Object.values(record)) {
    findProductNodes(child, results);
  }

  return results;
}

function extractBrand(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return cleanText(value);
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return cleanText(String(record.name || ""));
  }

  return null;
}

function extractImage(value: unknown, baseUrl: string): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return toAbsoluteUrl(value, baseUrl);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const image = extractImage(entry, baseUrl);
      if (image) {
        return image;
      }
    }
    return null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return extractImage(record.url || record.contentUrl, baseUrl);
  }

  return null;
}

function extractPrice(value: unknown): number | null {
  if (!value) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const numeric = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const price = extractPrice(entry);
      if (price) {
        return price;
      }
    }
    return null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      extractPrice(record.price) ||
      extractPrice(record.lowPrice) ||
      extractPrice(record.highPrice) ||
      extractPrice(record.offers) ||
      null
    );
  }

  return null;
}

function extractCurrency(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/[^A-Za-z]/g, "").toUpperCase();
    return cleaned.length === 3 ? cleaned : null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const currency = extractCurrency(entry);
      if (currency) {
        return currency;
      }
    }
    return null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      extractCurrency(record.priceCurrency) ||
      extractCurrency(record.currency) ||
      extractCurrency(record.offers) ||
      null
    );
  }

  return null;
}

function inferRetailerFromUrl(value: string): string | null {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, "");
    const retailer = hostname.split(".")[0];
    if (!retailer) {
      return null;
    }

    return retailer
      .split(/[-_]/g)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return null;
  }
}

function extractMetadataFromHtml(
  html: string,
  candidateUrl: string,
  responseUrl: string
): ProductPageMetadata {
  const canonicalUrl =
    toAbsoluteUrl(extractCanonicalHref(html), responseUrl) ||
    normalizeUrl(responseUrl) ||
    candidateUrl;
  const ogType = extractMetaContent(html, "property", "og:type");
  const ogTitle = extractMetaContent(html, "property", "og:title");
  const ogImage =
    extractMetaContent(html, "property", "og:image:secure_url") ||
    extractMetaContent(html, "property", "og:image");
  const ogSiteName =
    extractMetaContent(html, "property", "og:site_name") ||
    extractMetaContent(html, "name", "application-name");
  const metaBrand =
    extractMetaContent(html, "property", "product:brand") ||
    extractMetaContent(html, "name", "brand");
  const metaPrice =
    extractMetaContent(html, "property", "product:price:amount") ||
    extractMetaContent(html, "property", "og:price:amount") ||
    extractMetaContent(html, "name", "price");
  const metaCurrency =
    extractMetaContent(html, "property", "product:price:currency") ||
    extractMetaContent(html, "property", "og:price:currency") ||
    extractMetaContent(html, "name", "priceCurrency") ||
    extractMetaContent(html, "name", "currency");
  const itempropName = extractItempropContent(html, "name");
  const itempropBrand = extractItempropContent(html, "brand");
  const itempropImage = extractItempropContent(html, "image");
  const itempropPrice = extractItempropContent(html, "price");
  const itempropCurrency = extractItempropContent(html, "priceCurrency");

  const productNodes = extractJsonLdBlocks(html).flatMap((block) =>
    findProductNodes(block)
  );
  const productNode = productNodes[0];

  const title =
    cleanText(String(productNode?.name || "")) ||
    ogTitle ||
    itempropName ||
    extractJsonStringField(html, ["productName", "name", "title"]) ||
    extractTitleTag(html);
  const brand =
    extractBrand(productNode?.brand) ||
    metaBrand ||
    itempropBrand ||
    extractJsonStringField(html, ["brand", "vendor", "manufacturer"]);
  const retailer = ogSiteName || inferRetailerFromUrl(canonicalUrl);
  const imageUrl =
    extractImage(productNode?.image, canonicalUrl) ||
    toAbsoluteUrl(ogImage, canonicalUrl) ||
    toAbsoluteUrl(itempropImage, canonicalUrl) ||
    toAbsoluteUrl(
      extractJsonStringField(html, [
        "image",
        "imageUrl",
        "image_url",
        "featured_image",
        "primary_image",
      ]),
      canonicalUrl
    );
  const price =
    extractPrice(productNode?.offers) ||
    extractPrice(metaPrice) ||
    extractPrice(itempropPrice) ||
    extractJsonPriceField(html, [
      "price",
      "salePrice",
      "currentPrice",
      "priceAmount",
      "amount",
    ]);
  const priceCurrency =
    extractCurrency(productNode?.offers) ||
    extractCurrency(metaCurrency) ||
    extractCurrency(itempropCurrency) ||
    extractJsonStringField(html, [
      "priceCurrency",
      "currency",
      "currencyCode",
    ]);
  const hasProductSchema = Boolean(productNode);
  const hasProductMeta = Boolean(
    metaBrand ||
      metaPrice ||
      itempropPrice ||
      itempropImage ||
      html.match(/itemtype=["']https?:\/\/schema\.org\/Product["']/i)
  );
  const hasProductOgType = ogType?.toLowerCase() === "product";
  const isProduct =
    (hasProductSchema || hasProductMeta || hasProductOgType) &&
    Boolean(title && imageUrl && price && !hasSearchLikePath(canonicalUrl));

  return {
    canonicalUrl,
    title,
    brand,
    retailer,
    imageUrl,
    price,
    priceCurrency,
    isProduct,
    ogType,
    hasProductSchema,
    hasProductMeta,
  };
}

function sanitizeCandidateUrl(value: string): string | null {
  const normalized = normalizeUrl(value);
  if (
    !normalized ||
    hasBlockedHost(normalized) ||
    hasSearchLikePath(normalized) ||
    hasEditorialPath(normalized)
  ) {
    return null;
  }

  return normalized;
}

function createProductId(url: string): string {
  return `live-${createHash("sha256").update(url).digest("base64url").slice(0, 16)}`;
}

function compactUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`.slice(0, 140);
  } catch {
    return value.slice(0, 140);
  }
}

function auditFetchedProductPage({
  html,
  metadata,
  title,
  imageUrl,
  price,
  retailer,
}: {
  html: string;
  metadata: ProductPageMetadata;
  title: string | null;
  imageUrl: string | null;
  price: number | null;
  retailer: string | null;
}): string | null {
  if (!title) {
    return "missing_title";
  }

  if (!imageUrl) {
    return "missing_image";
  }

  if (!metadata.price || !price) {
    return "missing_page_price";
  }

  if (!retailer) {
    return "missing_retailer";
  }

  if (metadata.priceCurrency && metadata.priceCurrency !== "USD") {
    return "non_usd_currency";
  }

  if (hasUnavailableSignal(html, title)) {
    return "unavailable_or_not_found_page";
  }

  if (metadata.ogType?.toLowerCase().includes("article")) {
    return "article_og_type";
  }

  if (hasEditorialPath(metadata.canonicalUrl)) {
    return "editorial_path";
  }

  if (hasSearchLikePath(metadata.canonicalUrl)) {
    return "search_category_or_homepage";
  }

  if (!metadata.isProduct) {
    return "missing_product_evidence";
  }

  if (
    !metadata.hasProductSchema &&
    metadata.ogType?.toLowerCase() !== "product" &&
    !hasProductLikePath(metadata.canonicalUrl)
  ) {
    return "weak_product_url_signal";
  }

  return null;
}

async function fetchProductMetadata(
  candidate: ProductCandidate
): Promise<Product | null> {
  try {
    const response = await fetch(candidate.url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn("[product-search] Candidate fetch returned non-OK", {
        provider: candidate.provider,
        status: response.status,
        url: compactUrlForLog(candidate.url),
      });
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      console.warn("[product-search] Candidate rejected non-HTML response", {
        provider: candidate.provider,
        contentType,
        url: compactUrlForLog(candidate.url),
      });
      return null;
    }

    const html = await response.text();
    const metadata = extractMetadataFromHtml(html, candidate.url, response.url);
    const title = metadata.title || candidate.titleHint || null;
    const retailer =
      metadata.retailer ||
      candidate.retailerHint ||
      inferRetailerFromUrl(metadata.canonicalUrl) ||
      null;
    const imageUrl = metadata.imageUrl || candidate.imageHint || null;
    const price = metadata.price || candidate.priceHint || null;
    const rejectionReason = auditFetchedProductPage({
      html,
      metadata,
      title,
      imageUrl,
      price,
      retailer,
    });

    if (rejectionReason) {
      console.warn("[product-search] Candidate rejected after fetch", {
        url: compactUrlForLog(metadata.canonicalUrl),
        provider: candidate.provider,
        reason: rejectionReason,
        hasTitle: Boolean(title),
        hasImage: Boolean(imageUrl),
        hasPrice: Boolean(metadata.price),
        priceCurrency: metadata.priceCurrency,
        hasRetailer: Boolean(retailer),
        ogType: metadata.ogType,
        hasProductSchema: metadata.hasProductSchema,
        hasProductMeta: metadata.hasProductMeta,
        hasProductLikePath: hasProductLikePath(metadata.canonicalUrl),
        isProduct: metadata.isProduct,
      });
      return null;
    }

    const productTitle = title as string;
    const productRetailer = retailer as string;
    const productImageUrl = imageUrl as string;
    const productPrice = metadata.price as number;

    console.log("[product-search] Candidate accepted", {
      provider: candidate.provider,
      retailer: productRetailer,
      price: productPrice,
      category: candidate.categoryHint,
      url: compactUrlForLog(metadata.canonicalUrl),
    });

    return {
      id: createProductId(metadata.canonicalUrl),
      title: productTitle,
      brand: metadata.brand || candidate.retailerHint || productRetailer,
      price: productPrice,
      image_url: productImageUrl,
      product_url: metadata.canonicalUrl,
      retailer: productRetailer,
      category: normalizeCategoryHint(candidate.categoryHint) || candidate.categoryHint,
      aesthetic: "minimalist",
      source: "live",
    };
  } catch (error) {
    console.warn("[product-search] Candidate fetch failed", {
      url: compactUrlForLog(candidate.url),
      provider: candidate.provider,
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

async function searchWithBrave(
  queries: SearchQuery[]
): Promise<ProviderSearchResult | null> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    console.warn("[product-search] Brave Search skipped", {
      hasApiKey: false,
    });
    return null;
  }

  const candidates: ProductCandidate[] = [];
  console.log("[product-search] Brave Search starting", {
    queries: queries.length,
  });

  for (const [queryIndex, query] of queries.entries()) {
    const candidateCountBeforeQuery = candidates.length;
    const searchParams = new URLSearchParams({
      q: buildProductDiscoveryQuery(query),
      count: "20",
      country: "us",
      search_lang: "en",
      ui_lang: "en-US",
      safesearch: "strict",
      spellcheck: "1",
    });

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${searchParams.toString()}`,
      {
        headers: {
          accept: "application/json",
          "accept-encoding": "gzip",
          "x-subscription-token": apiKey,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.warn("[product-search] Brave Search request failed", {
        queryIndex: queryIndex + 1,
        status: response.status,
        statusText: response.statusText,
        body: errorText.slice(0, 300),
      });

      if ([401, 403, 429].includes(response.status)) {
        break;
      }

      continue;
    }

    const data = (await response.json()) as {
      web?: {
        results?: Array<{
          url?: string;
          title?: string;
          profile?: { name?: string };
          meta_url?: { hostname?: string };
        }>;
      };
      query?: { more_results_available?: boolean };
    };
    const rawResults = data.web?.results || [];

    for (const [resultIndex, result] of rawResults.entries()) {
      const sanitizedUrl = sanitizeCandidateUrl(String(result.url || ""));
      if (!sanitizedUrl) {
        continue;
      }

      candidates.push({
        url: sanitizedUrl,
        titleHint: cleanText(result.title || undefined) || undefined,
        retailerHint:
          cleanText(result.profile?.name || result.meta_url?.hostname) ||
          undefined,
        categoryHint: query.categoryHint,
        provider: "brave-search",
        rank: queryIndex * 20 + resultIndex,
      });
    }

    console.log("[product-search] Brave Search query complete", {
      queryIndex: queryIndex + 1,
      category: query.categoryHint,
      rawResults: rawResults.length,
      acceptedCandidates: candidates.length - candidateCountBeforeQuery,
      moreResultsAvailable: Boolean(data.query?.more_results_available),
    });
  }

  console.log("[product-search] Brave Search complete", {
    candidates: candidates.length,
  });

  return { provider: "brave-search", candidates };
}

async function searchWithGoogleCse(
  queries: SearchQuery[]
): Promise<ProviderSearchResult | null> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !engineId) {
    console.warn("[product-search] Google CSE skipped", {
      hasApiKey: Boolean(apiKey),
      hasEngineId: Boolean(engineId),
    });
    return null;
  }

  const candidates: ProductCandidate[] = [];
  console.log("[product-search] Google CSE starting", {
    queries: queries.length,
  });

  for (const [queryIndex, query] of queries.entries()) {
    const candidateCountBeforeQuery = candidates.length;
    const searchParams = new URLSearchParams({
      key: apiKey,
      cx: engineId,
      q: query.text,
      num: "8",
      gl: "us",
      hl: "en",
    });

    const response = await fetch(
      `https://customsearch.googleapis.com/customsearch/v1?${searchParams.toString()}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const accessBlocked =
        response.status === 403 &&
        errorText.includes("does not have the access to Custom Search JSON API");

      console.warn("[product-search] Google CSE request failed", {
        queryIndex: queryIndex + 1,
        status: response.status,
        statusText: response.statusText,
        reason: accessBlocked
          ? "project_has_no_custom_search_json_api_access"
          : "request_failed",
        body: errorText.slice(0, 300),
      });

      if (accessBlocked) {
        console.warn("[product-search] Google CSE disabled for this request", {
          reason:
            "Google says this project does not have Custom Search JSON API access",
        });
        break;
      }

      continue;
    }

    const data = (await response.json()) as {
      items?: Array<{ link?: string; title?: string; displayLink?: string }>;
    };
    const rawResults = data.items || [];

    for (const [resultIndex, result] of rawResults.entries()) {
      const sanitizedUrl = sanitizeCandidateUrl(String(result.link || ""));
      if (!sanitizedUrl) {
        continue;
      }

      candidates.push({
        url: sanitizedUrl,
        titleHint: cleanText(result.title || undefined) || undefined,
        retailerHint: cleanText(result.displayLink || undefined) || undefined,
        categoryHint: query.categoryHint,
        provider: "google-cse",
        rank: 1000 + queryIndex * 10 + resultIndex,
      });
    }

    console.log("[product-search] Google CSE query complete", {
      queryIndex: queryIndex + 1,
      category: query.categoryHint,
      rawResults: rawResults.length,
      acceptedCandidates: candidates.length - candidateCountBeforeQuery,
    });
  }

  console.log("[product-search] Google CSE complete", {
    candidates: candidates.length,
  });

  return { provider: "google-cse", candidates };
}

async function searchWithGeminiUrlFinder(
  queries: SearchQuery[],
  budget?: string
): Promise<ProviderSearchResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[product-search] Gemini URL finder skipped", {
      hasApiKey: false,
    });
    return null;
  }

  console.log("[product-search] Gemini URL finder starting", {
    queries: queries.length,
  });

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    // The API requires "googleSearch" but the SDK types only define "googleSearchRetrieval"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ googleSearch: {} } as any],
  });

  const budgetLine = budget ? `Budget: ${budget}\n` : "";
  const prompt = `Use web search to find direct retailer product page URLs for these fashion needs.

${budgetLine}Queries:
${queries.map((query, index) => `${index + 1}. ${query.text} [category=${query.categoryHint}]`).join("\n")}

Return a JSON array only.
Each item must be:
{
  "url": "direct https product page url",
  "title_hint": "short product title",
  "retailer_hint": "retailer or brand",
  "image_url_hint": "direct product image url if available",
  "price_hint": 99,
  "category": "outerwear | tops | pants | shoes | accessories"
}

Rules:
- Only return direct product pages from real retailers
- No search result pages
- No category pages
- No homepages
- No social or editorial links
- Return up to 10 candidates total
- Do not return markdown or explanations`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = (codeBlockMatch?.[1] || responseText).trim();
    const parsed = JSON.parse(jsonText) as Array<Record<string, unknown>>;

    if (!Array.isArray(parsed)) {
      console.warn("[product-search] Gemini URL finder returned non-array JSON");
      return { provider: "gemini-url-finder", candidates: [] };
    }

    const candidates = parsed
      .map((entry, index) => {
        const sanitizedUrl = sanitizeCandidateUrl(String(entry.url || ""));
        if (!sanitizedUrl) {
          return null;
        }

        return {
          url: sanitizedUrl,
          titleHint: cleanText(String(entry.title_hint || "")) || undefined,
          retailerHint: cleanText(String(entry.retailer_hint || "")) || undefined,
          imageHint:
            normalizeUrl(String(entry.image_url_hint || "")) || undefined,
          priceHint:
            Number.isFinite(Number(entry.price_hint)) &&
              Number(entry.price_hint) > 0
              ? Number(entry.price_hint)
              : undefined,
          categoryHint: inferCategoryHint(
            String(entry.category || queries[0]?.categoryHint || ""),
            queries.map((query) => query.categoryHint)
          ),
          provider: "gemini-url-finder" as const,
          rank: 2000 + index,
        };
      })
      .filter((entry) => entry !== null);

    console.log("[product-search] Gemini URL finder complete", {
      rawResults: parsed.length,
      acceptedCandidates: candidates.length,
    });

    return { provider: "gemini-url-finder", candidates };
  } catch (error) {
    console.error("[product-search] Gemini URL finder failed:", error);
    return { provider: "gemini-url-finder", candidates: [] };
  }
}

function dedupeCandidates(candidates: ProductCandidate[]): ProductCandidate[] {
  const deduped: ProductCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const key = candidate.url;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped.sort((left, right) => left.rank - right.rank);
}

function sortProductsByBudget(products: Product[], budget?: string): Product[] {
  const budgetCap = parseBudgetCap(budget);
  if (!budgetCap) {
    return products;
  }

  return [...products].sort((left, right) => {
    const leftScore = left.price <= budgetCap ? 0 : 1;
    const rightScore = right.price <= budgetCap ? 0 : 1;

    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return left.price - right.price;
  });
}

function diversifyProductsByCategory(
  products: Product[],
  replacementCategories: Set<string>
): Product[] {
  const selected: Product[] = [];
  const countsByCategory = new Map<string, number>();

  for (const product of products) {
    const category =
      normalizeCategoryHint(product.category) || product.category.toLowerCase();
    const maxPerCategory = replacementCategories.has(category) ? 1 : 2;
    const currentCount = countsByCategory.get(category) || 0;

    if (currentCount >= maxPerCategory) {
      continue;
    }

    countsByCategory.set(category, currentCount + 1);
    selected.push(product);

    if (selected.length === 6) {
      break;
    }
  }

  console.log("[product-search] Category diversity applied", {
    inputProducts: products.length,
    selectedProducts: selected.length,
    replacementCategories: Array.from(replacementCategories),
    selectedByCategory: Object.fromEntries(countsByCategory),
  });

  return selected;
}

function dedupeProducts(products: Product[]): Product[] {
  const deduped: Product[] = [];
  const seen = new Set<string>();

  for (const product of products) {
    const key = `${product.retailer.toLowerCase()}::${product.title.toLowerCase()}::${product.product_url}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(product);
  }

  return deduped;
}

async function discoverCandidates(
  queries: SearchQuery[],
  budget?: string
): Promise<ProductCandidate[]> {
  const providerResults = await Promise.all([
    searchWithBrave(queries),
    searchWithGoogleCse(queries),
    searchWithGeminiUrlFinder(queries, budget),
  ]);
  const allCandidates = providerResults.flatMap(
    (result) => result?.candidates || []
  );
  const dedupedCandidates = dedupeCandidates(allCandidates);
  const selectedCandidates = dedupedCandidates.slice(0, 30);

  console.log("[product-search] Candidate discovery complete", {
    providers: providerResults.map((result) =>
      result
        ? { provider: result.provider, candidates: result.candidates.length }
        : null
    ),
    rawCandidates: allCandidates.length,
    dedupedCandidates: dedupedCandidates.length,
    selectedCandidates: selectedCandidates.length,
  });

  return selectedCandidates;
}

/**
 * Search for real, currently available products using provider-based discovery,
 * then fetch and validate the product page metadata server-side.
 */
export async function searchRealProducts(
  shoppingQueries: string[],
  categories: string[],
  budget?: string,
  missingPieces: string[] = [],
  whatWorks: string[] = [],
  whatToFix: string[] = []
): Promise<Product[]> {
  const queries = buildSearchQueries(
    shoppingQueries,
    categories,
    missingPieces,
    budget,
    whatWorks
  );

  console.log("[product-search] Built search queries", {
    count: queries.length,
    protectedCategories: Array.from(inferCategoriesFromTexts(whatWorks)),
    explicitlyTargetedCategories: Array.from(
      inferCategoriesFromTexts([...missingPieces, ...whatToFix])
    ),
    queries: queries.map((query) => ({
      text: query.text,
      category: query.categoryHint,
    })),
  });

  if (queries.length === 0) {
    console.warn("[product-search] No search queries built");
    return [];
  }

  const candidates = await discoverCandidates(queries, budget);
  if (candidates.length === 0) {
    console.warn("[product-search] No product candidates discovered");
    return [];
  }

  const resolved = await Promise.allSettled(
    candidates.map((candidate) => fetchProductMetadata(candidate))
  );
  const failedFetches = resolved.filter(
    (result) => result.status === "rejected"
  ).length;

  const products = resolved
    .map((result) =>
      result.status === "fulfilled" ? result.value : null
    )
    .filter((product): product is Product => Boolean(product));

  const dedupedProducts = dedupeProducts(products);
  const sortedProducts = sortProductsByBudget(dedupedProducts, budget);
  const diverseProducts = diversifyProductsByCategory(
    sortedProducts,
    inferCategoriesFromTexts(whatToFix)
  );
  console.log("[product-search] Candidate validation complete", {
    fetchedCandidates: resolved.length,
    acceptedProducts: products.length,
    dedupedProducts: dedupedProducts.length,
    diversifiedProducts: diverseProducts.length,
    failedFetches,
  });
  console.log(
    "[product-search] Resolved",
    diverseProducts.length,
    "usable products from",
    candidates.length,
    "candidates"
  );
  return diverseProducts;
}
