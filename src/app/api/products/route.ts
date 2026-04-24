import { searchProductProviders } from "@/lib/product-providers";
import { getRecommendations } from "@/lib/recommendations";
import { MOCK_AUDIT } from "@/lib/mock-data";
import type {
  Product,
  ProductSearchProgressEvent,
  ShoppingIntent,
} from "@/lib/types";

type ProductSearchStreamEvent =
  | ProductSearchProgressEvent
  | {
      type: "result";
      products: Product[];
      summary: ProductSearchSummary;
    }
  | { type: "error"; message: string };

interface ProductSearchSummary {
  liveProducts: number;
  affiliateProducts: number;
  ebayProducts: number;
  externalProducts: number;
  curatedProducts: number;
  curatedBackfill: number;
  liveExactProducts: number;
  liveNearProducts: number;
  returnedLiveProducts: number;
  returnedAffiliateProducts: number;
  returnedEbayProducts: number;
  returnedExternalProducts: number;
  returnedCuratedProducts: number;
  returnedProducts: number;
  durationMs: number;
}

interface ProductSearchInput {
  shopping_queries: string[];
  shopping_intents: ShoppingIntent[];
  recommended_categories: string[];
  budget?: string;
  missing_pieces: string[];
  what_works: string[];
  what_to_fix: string[];
}

const MAX_RETURNED_PRODUCTS = 6;

function isExternalProduct(product: Product): boolean {
  return (
    product.source === "live" ||
    product.source === "affiliate" ||
    product.source === "ebay"
  );
}

function isCuratedProduct(product: Product): boolean {
  return product.source === "curated" || product.source === "catalog";
}

function countProductsBySource(products: Product[]): Record<string, number> {
  return products.reduce<Record<string, number>>((counts, product) => {
    const source = product.source || "unknown";
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {});
}

function compactProductUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`.slice(0, 140);
  } catch {
    return value.slice(0, 140);
  }
}

function summarizeProductForLog(product: Product) {
  return {
    title: product.title.slice(0, 120),
    retailer: product.retailer,
    category: product.category,
    source: product.source || "unknown",
    matchQuality: product.match_quality || "exact",
    missingPreferences: product.missing_preferences?.slice(0, 4) || [],
    intentId: product.intent_id || null,
    price: product.price,
    url: compactProductUrlForLog(product.product_url),
  };
}

function getIntentAwareFallbackProducts(input?: ProductSearchInput | null): Product[] {
  if (!input) {
    return getRecommendations(MOCK_AUDIT, undefined);
  }

  return getRecommendations(
    {
      ...MOCK_AUDIT,
      missing_pieces: input.missing_pieces,
      what_works: input.what_works,
      what_to_fix: input.what_to_fix,
      recommended_categories: input.recommended_categories,
      shopping_queries: input.shopping_queries,
      shopping_intents: input.shopping_intents,
    },
    input.budget
  );
}

async function runProductSearch(
  input: ProductSearchInput,
  onProgress?: (event: ProductSearchProgressEvent) => void
) {
  const startedAt = Date.now();
  const {
    shopping_queries,
    shopping_intents,
    recommended_categories,
    budget,
    missing_pieces,
    what_works,
    what_to_fix,
  } = input;

  console.log("[products] Search request", {
    shoppingQueries: shopping_queries.length,
    shoppingIntents: shopping_intents.length,
    recommendedCategories: recommended_categories,
    missingPieces: missing_pieces.length,
    whatWorks: what_works.length,
    whatToFix: what_to_fix.length,
    hasBudget: Boolean(budget),
    shoppingIntentsSummary: shopping_intents.map((intent) => ({
      id: intent.id,
      category: intent.category,
      productType: intent.product_type,
      query: intent.search_query,
      alternateQueries: intent.alternate_queries?.length || 0,
      priority: intent.priority,
    })),
  });

  const { products: providerProducts, providerRuns } = await searchProductProviders(
    {
      shopping_queries,
      shopping_intents,
      recommended_categories,
      budget,
      missing_pieces,
      what_works,
      what_to_fix,
    },
    onProgress
  );
  const fallbackProducts =
    providerProducts.length > 0 ? [] : getIntentAwareFallbackProducts(input);
  const products = [...providerProducts, ...fallbackProducts].slice(
    0,
    MAX_RETURNED_PRODUCTS
  );
  const liveProducts = products.filter((product) => product.source === "live");
  const affiliateProducts = products.filter(
    (product) => product.source === "affiliate"
  );
  const ebayProducts = products.filter((product) => product.source === "ebay");
  const externalProducts = products.filter(isExternalProduct);
  const curatedProducts = products.filter(isCuratedProduct);
  const returnedLiveProducts = liveProducts.length;
  const returnedAffiliateProducts = affiliateProducts.length;
  const returnedEbayProducts = ebayProducts.length;
  const returnedExternalProducts = externalProducts.length;
  const returnedCuratedProducts = curatedProducts.length;
  const returnedBySource = countProductsBySource(products);
  const providerProductsBySource = countProductsBySource(providerProducts);
  const liveExactProducts = liveProducts.filter(
    (product) => product.match_quality !== "near"
  ).length;
  const liveNearProducts = liveProducts.filter(
    (product) => product.match_quality === "near"
  );
  const liveNearProductCount = liveNearProducts.length;
  const curatedBackfill = returnedCuratedProducts;

  if (providerProducts.length === 0) {
    console.warn(
      "[products] Product providers returned no usable products, using fallback catalog"
    );
  }

  const summary = {
    liveProducts: liveProducts.length,
    affiliateProducts: affiliateProducts.length,
    ebayProducts: ebayProducts.length,
    externalProducts: externalProducts.length,
    curatedProducts: curatedProducts.length,
    curatedBackfill,
    liveExactProducts,
    liveNearProducts: liveNearProductCount,
    returnedLiveProducts,
    returnedAffiliateProducts,
    returnedEbayProducts,
    returnedExternalProducts,
    returnedCuratedProducts,
    returnedProducts: products.length,
    durationMs: Date.now() - startedAt,
  };

  onProgress?.({
    type: "progress",
    stage: "fallback",
    status: "complete",
    detail: "Final product grid is ready.",
    counts: summary,
  });

  console.log("[products] Provider results", {
    providerRuns: providerRuns.map((run) => ({
      provider: run.provider,
      products: run.products.length,
      skippedReason: run.skippedReason || null,
      durationMs: run.durationMs,
    })),
    providerProductsBySource,
    returnedBySource,
  });
  console.log("[products] Product response ready", summary);
  console.log("[products] Returned product details", {
    products: products.map(summarizeProductForLog),
  });

  return { products, summary };
}

function streamProductSearch(input: ProductSearchInput): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ProductSearchStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const result = await runProductSearch(input, send);
        send({ type: "result", ...result });
      } catch (error) {
        console.error("[products] Error:", error);
        const fallbackProducts = getIntentAwareFallbackProducts(input);
        send({
          type: "error",
          message: "Search failed; returning curated fallback.",
        });
        send({
          type: "result",
          products: fallbackProducts,
          summary: {
            liveProducts: 0,
            affiliateProducts: 0,
            ebayProducts: 0,
            externalProducts: 0,
            curatedProducts: fallbackProducts.length,
            curatedBackfill: fallbackProducts.length,
            liveExactProducts: 0,
            liveNearProducts: 0,
            returnedLiveProducts: 0,
            returnedAffiliateProducts: 0,
            returnedEbayProducts: 0,
            returnedExternalProducts: 0,
            returnedCuratedProducts: fallbackProducts.length,
            returnedProducts: fallbackProducts.length,
            durationMs: 0,
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export async function POST(request: Request) {
  let input: ProductSearchInput | null = null;

  try {
    const body = await request.json();
    const {
      shopping_queries,
      shopping_intents,
      recommended_categories,
      budget,
      missing_pieces,
      what_works,
      what_to_fix,
      stream,
    } = body as {
      shopping_queries?: string[];
      shopping_intents?: ShoppingIntent[];
      recommended_categories?: string[];
      budget?: string;
      missing_pieces?: string[];
      what_works?: string[];
      what_to_fix?: string[];
      stream?: boolean;
    };

    if (!shopping_queries || !recommended_categories) {
      return Response.json(
        { error: "Missing shopping queries or categories" },
        { status: 400 }
      );
    }

    input = {
      shopping_queries,
      shopping_intents: shopping_intents || [],
      recommended_categories,
      budget,
      missing_pieces: missing_pieces || [],
      what_works: what_works || [],
      what_to_fix: what_to_fix || [],
    };

    if (stream) {
      return streamProductSearch(input);
    }

    const { products } = await runProductSearch(input);
    return Response.json({ products });
  } catch (error) {
    console.error("[products] Error:", error);

    // Graceful fallback: return curated data instead of crashing
    const fallbackProducts = getIntentAwareFallbackProducts(input);
    return Response.json(
      { products: fallbackProducts, _fallback: true, _error: "Search failed" },
      { status: 200 }
    );
  }
}
