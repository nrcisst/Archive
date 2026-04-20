import type { Product, StyleAudit } from "./types";
import { PRODUCT_CATALOG } from "@/data/products";

function normalizeCategory(value: string): string {
  const category = value.toLowerCase();

  if (
    category.includes("bottom") ||
    category.includes("pant") ||
    category.includes("trouser") ||
    category.includes("jean") ||
    category.includes("chino")
  ) {
    return "pants";
  }

  if (
    category.includes("footwear") ||
    category.includes("shoe") ||
    category.includes("sneaker") ||
    category.includes("boot") ||
    category.includes("loafer")
  ) {
    return "shoes";
  }

  if (
    category.includes("accessor") ||
    category.includes("jewelry") ||
    category.includes("jewellery") ||
    category.includes("belt") ||
    category.includes("watch") ||
    category.includes("bag") ||
    category.includes("hat")
  ) {
    return "accessories";
  }

  if (
    category.includes("outerwear") ||
    category.includes("jacket") ||
    category.includes("coat") ||
    category.includes("blazer")
  ) {
    return "outerwear";
  }

  if (
    category.includes("top") ||
    category.includes("shirt") ||
    category.includes("tee") ||
    category.includes("sweater") ||
    category.includes("knit") ||
    category.includes("polo")
  ) {
    return "tops";
  }

  return category;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4)
  );
}

function categoryFromText(value: string): string | null {
  const category = normalizeCategory(value);
  return ["outerwear", "tops", "pants", "shoes", "accessories"].includes(category)
    ? category
    : null;
}

function scoreProductForIntent(
  product: Product,
  intentText: string,
  targetCategories: Set<string>
): number {
  const productCategory = normalizeCategory(product.category);
  if (!targetCategories.has(productCategory)) {
    return 0;
  }

  const intentTokens = tokenize(intentText);
  const productTokens = tokenize(
    `${product.title} ${product.brand} ${product.retailer} ${product.category} ${product.aesthetic}`
  );
  let score = 4;

  for (const token of intentTokens) {
    if (productTokens.has(token)) {
      score += 3;
    }
  }

  if (intentText.toLowerCase().includes(product.aesthetic.toLowerCase())) {
    score += 2;
  }

  return score;
}

/**
 * Maps a style audit's recommended_categories and missing_pieces
 * to matching products from the curated catalog.
 *
 * Simple heuristic for beta:
 * 1. Match by category from recommended_categories
 * 2. Limit to a sensible number (3-6 products)
 * 3. Budget-aware filtering if budget is provided
 */
export function getRecommendations(
  audit: StyleAudit,
  budget?: string
): Product[] {
  const intentValues = [
    ...audit.missing_pieces,
    ...audit.shopping_queries,
  ];
  const targetCategories = new Set<string>();

  for (const value of intentValues) {
    const category = categoryFromText(value);
    if (category) {
      targetCategories.add(category);
    }
  }

  if (targetCategories.size === 0) {
    for (const category of audit.recommended_categories) {
      const normalized = categoryFromText(category);
      if (normalized) {
        targetCategories.add(normalized);
      }
    }
  }

  const intentText = intentValues.join(" ");

  // Filter by matching categories
  let matches = PRODUCT_CATALOG
    .map((product) => ({
      product,
      score: scoreProductForIntent(product, intentText, targetCategories),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => ({
      ...entry.product,
      source: "curated" as const,
    }));

  // Budget filtering: parse a number from the budget string
  if (budget) {
    const maxPrice = parseInt(budget.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(maxPrice) && maxPrice > 0) {
      const budgetFiltered = matches.filter((p) => p.price <= maxPrice);
      // Only apply budget filter if it leaves us with at least 2 results
      if (budgetFiltered.length >= 2) {
        matches = budgetFiltered;
      }
    }
  }

  // Deduplicate by category — pick the best match per category, then fill
  const seen = new Set<string>();
  const primary: Product[] = [];
  const secondary: Product[] = [];

  for (const product of matches) {
    const category = normalizeCategory(product.category);
    if (!seen.has(category)) {
      seen.add(category);
      primary.push(product);
    } else {
      secondary.push(product);
    }
  }

  // Return fewer high-intent fallbacks instead of padding the grid with weak picks.
  return [...primary, ...secondary].slice(0, 3);
}
