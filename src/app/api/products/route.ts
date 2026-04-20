import { searchRealProducts } from "@/lib/product-search";
import { getRecommendations } from "@/lib/recommendations";
import { MOCK_AUDIT } from "@/lib/mock-data";
import type { Product } from "@/lib/types";

function mergeProducts(primary: Product[], fallback: Product[]): Product[] {
  const merged: Product[] = [];
  const seen = new Set<string>();

  for (const product of [...primary, ...fallback]) {
    const key = `${product.retailer.toLowerCase()}::${product.title.toLowerCase()}::${product.product_url}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(product);

    if (merged.length === 6) {
      break;
    }
  }

  return merged;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      shopping_queries,
      recommended_categories,
      budget,
      missing_pieces,
      what_works,
      what_to_fix,
    } = body as {
      shopping_queries?: string[];
      recommended_categories?: string[];
      budget?: string;
      missing_pieces?: string[];
      what_works?: string[];
      what_to_fix?: string[];
    };

    if (!shopping_queries || !recommended_categories) {
      return Response.json(
        { error: "Missing shopping queries or categories" },
        { status: 400 }
      );
    }

    const startedAt = Date.now();
    console.log("[products] Search request", {
      shoppingQueries: shopping_queries.length,
      recommendedCategories: recommended_categories,
      missingPieces: missing_pieces?.length || 0,
      whatWorks: what_works?.length || 0,
      whatToFix: what_to_fix?.length || 0,
      hasBudget: Boolean(budget),
    });

    const liveProducts = await searchRealProducts(
      shopping_queries,
      recommended_categories,
      budget,
      missing_pieces || [],
      what_works || [],
      what_to_fix || []
    );
    const curatedProducts = getRecommendations(
      {
        ...MOCK_AUDIT,
        missing_pieces: missing_pieces || [],
        recommended_categories,
        shopping_queries,
      },
      budget
    );
    const products = mergeProducts(liveProducts, curatedProducts);
    const curatedBackfill = Math.max(products.length - liveProducts.length, 0);

    if (liveProducts.length === 0) {
      console.warn(
        "[products] Live search returned no usable products, using curated catalog"
      );
    } else if (liveProducts.length < products.length) {
      console.warn(
        "[products] Backfilled live search with curated products",
        `(${liveProducts.length} live / ${products.length - liveProducts.length} curated)`
      );
    }

    console.log("[products] Product response ready", {
      liveProducts: liveProducts.length,
      curatedProducts: curatedProducts.length,
      curatedBackfill,
      returnedProducts: products.length,
      durationMs: Date.now() - startedAt,
    });

    return Response.json({ products });
  } catch (error) {
    console.error("[products] Error:", error);

    // Graceful fallback: return curated data instead of crashing
    const fallbackProducts = getRecommendations(MOCK_AUDIT, undefined);
    return Response.json(
      { products: fallbackProducts, _fallback: true, _error: "Search failed" },
      { status: 200 }
    );
  }
}
