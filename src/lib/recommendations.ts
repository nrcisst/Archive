import type { Product, ShoppingIntent, StyleAudit } from "./types";
import { PRODUCT_CATALOG } from "@/data/products";
import {
  getStyleProfileFieldMatches,
  getStyleProfilePreferenceTerms,
} from "./style-profile";

interface RecommendationOptions {
  coveredProducts?: Product[];
}

const CATEGORY_TERMS: Record<string, string[]> = {
  outerwear: ["jacket", "coat", "blazer", "overshirt", "parka", "bomber"],
  tops: ["shirt", "tee", "tshirt", "sweater", "hoodie", "knit", "polo"],
  pants: ["pants", "pant", "trouser", "trousers", "jeans", "chino", "slacks"],
  shoes: [
    "footwear",
    "shoe",
    "shoes",
    "sneaker",
    "sneakers",
    "boot",
    "boots",
    "loafer",
  ],
  accessories: [
    "accessory",
    "accessories",
    "belt",
    "watch",
    "bracelet",
    "bag",
    "beanie",
    "cap",
    "hat",
    "headwear",
    "sling",
    "sunglasses",
    "jewelry",
    "jewellery",
    "necklace",
    "ring",
    "chain",
    "earring",
    "sock",
  ],
};

const INTENT_STOP_WORDS = new Set([
  "and",
  "are",
  "buy",
  "for",
  "from",
  "men",
  "mens",
  "more",
  "pair",
  "that",
  "the",
  "toned",
  "under",
  "with",
  "women",
  "womens",
]);

const GENERIC_IDENTITY_TERMS = new Set([
  "accessory",
  "accessories",
  "footwear",
  "outerwear",
  "product",
  "style",
  "tops",
]);

const WEAK_DESCRIPTOR_TERMS = new Set(["dark", "light", "men", "mens"]);

const TERM_ALIASES: Record<string, string[]> = {
  "chain necklace": ["chain necklace", "chain necklaces"],
  "corduroy pants": [
    "corduroy pants",
    "corduroy pant",
    "corduroy trousers",
    "corduroy trouser",
  ],
  "dark gray": ["dark gray", "dark grey"],
  "dark grey": ["dark grey", "dark gray"],
  "denim jacket": ["denim jacket", "denim jackets"],
  "skinny jeans": [
    "skinny jeans",
    "skinny jean",
    "black skinny jeans",
    "slim jeans",
    "slim fit jeans",
    "slim stretch jeans",
    "black slim jeans",
    "stretch jeans",
    "jeans",
  ],
  "slim jeans": [
    "slim jeans",
    "slim fit jeans",
    "black slim jeans",
    "skinny jeans",
    "stretch jeans",
    "jeans",
  ],
  "black jeans": [
    "black jeans",
    "clean black jeans",
    "black slim jeans",
    "black skinny jeans",
    "slim jeans",
    "skinny jeans",
    "jeans",
  ],
  "clean black jeans": [
    "clean black jeans",
    "black jeans",
    "black slim jeans",
    "black skinny jeans",
    "slim jeans",
    "skinny jeans",
    "jeans",
  ],
  "silver chain": ["silver chain", "sterling silver chain"],
  "straight leg": ["straight leg", "straight-leg"],
  gray: ["gray", "grey"],
  grey: ["grey", "gray"],
  sneaker: ["sneaker", "sneakers", "trainer", "trainers"],
  sneakers: ["sneaker", "sneakers", "trainer", "trainers"],
  trainer: ["sneaker", "sneakers", "trainer", "trainers"],
  trainers: ["sneaker", "sneakers", "trainer", "trainers"],
  necklace: ["necklace", "necklaces"],
  necklaces: ["necklace", "necklaces"],
  bracelet: ["bracelet", "bracelets"],
  bracelets: ["bracelet", "bracelets"],
  jacket: ["jacket", "jackets"],
  jackets: ["jacket", "jackets"],
  pants: ["pants", "pant", "trouser", "trousers"],
  pant: ["pants", "pant", "trouser", "trousers"],
  trouser: ["pants", "pant", "trouser", "trousers"],
  trousers: ["pants", "pant", "trouser", "trousers"],
};

const IMPORTANT_DESCRIPTOR_TERMS = [
  "dark grey",
  "dark gray",
  "dark olive",
  "dark wash",
  "white sole",
  "slim fit",
  "straight leg",
  "wide leg",
  "cuban link",
  "no distressing",
  "no rips",
  "charcoal",
  "black",
  "grey",
  "gray",
  "olive",
  "indigo",
  "silver",
  "white",
  "navy",
  "brown",
  "cream",
  "tapered",
  "skinny",
  "slim",
  "straight",
  "stretch",
  "clean",
  "thin",
  "delicate",
  "relaxed",
  "loose",
  "wide",
  "cropped",
  "oversized",
  "retro",
  "chunky",
  "minimal",
  "minimalist",
  "plain",
];

const COLOR_DESCRIPTOR_TERMS = new Set([
  "dark grey",
  "dark gray",
  "dark olive",
  "dark wash",
  "charcoal",
  "black",
  "grey",
  "gray",
  "olive",
  "indigo",
  "silver",
  "white",
  "navy",
  "brown",
  "cream",
]);

const HARD_IDENTITY_PHRASES = [
  "chain necklace",
  "corduroy pants",
  "corduroy trousers",
  "denim jacket",
  "skinny jeans",
  "slim jeans",
  "straight jeans",
  "straight leg jeans",
  "chelsea boots",
  "low top sneakers",
  "low-top sneakers",
  "jeans",
  "pants",
  "trousers",
  "sneakers",
  "trainers",
  "boots",
  "loafers",
  "beanie",
  "watch",
  "belt",
  "bag",
  "necklace",
  "chain",
  "bracelet",
  "ring",
  "jacket",
  "blazer",
  "coat",
  "shirt",
  "tee",
  "sweater",
  "polo",
].sort((left, right) => right.length - left.length);

const SOFT_IDENTITY_TERMS = new Set([
  ...IMPORTANT_DESCRIPTOR_TERMS.map((term) => normalizeSearchText(term)),
  "fit",
  "ripped",
  "rip",
  "rips",
  "distressed",
  "distressing",
]);

function normalizeCategory(value: string): string {
  const category = value.toLowerCase();

  if (
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
    category.includes("beanie") ||
    category.includes("cap") ||
    category.includes("hat") ||
    category.includes("headwear") ||
    category.includes("necklace") ||
    category.includes("ring") ||
    category.includes("chain") ||
    category.includes("earring") ||
    category.includes("sock")
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
    category.includes("tops") ||
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
      .replace(/[-_/]+/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTerm(value: string, term: string): boolean {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) {
    return false;
  }

  return ` ${normalizeSearchText(value)} `.includes(` ${normalizedTerm} `);
}

function uniqueTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const value of values) {
    const normalized = normalizeSearchText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    terms.push(value.trim());
  }

  return terms;
}

function isHardIdentityTerm(term: string): boolean {
  const normalized = normalizeSearchText(term);
  return (
    Boolean(normalized) &&
    !GENERIC_IDENTITY_TERMS.has(normalized) &&
    !SOFT_IDENTITY_TERMS.has(normalized)
  );
}

function getEmbeddedHardIdentityTerm(term: string): string | null {
  const normalized = normalizeSearchText(term);
  if (!normalized) {
    return null;
  }

  return HARD_IDENTITY_PHRASES.find((phrase) => containsTerm(normalized, phrase)) || null;
}

function hardIdentityTermContains(term: string | null, descriptor: string): boolean {
  return Boolean(term && containsTerm(term, descriptor));
}

function getSoftTermsFromRequiredTerm(term: string): string[] {
  const normalized = normalizeSearchText(term);
  if (!normalized) {
    return [];
  }

  const hardIdentityTerm = getEmbeddedHardIdentityTerm(term);
  const descriptorTerms = IMPORTANT_DESCRIPTOR_TERMS.filter(
    (descriptor) =>
      containsTerm(normalized, descriptor) &&
      !hardIdentityTermContains(hardIdentityTerm, descriptor)
  );
  const tokenTerms = normalized
    .split(/\s+/)
    .filter(
      (token) =>
        SOFT_IDENTITY_TERMS.has(token) &&
        !hardIdentityTermContains(hardIdentityTerm, token)
    );

  if (!isHardIdentityTerm(term)) {
    return uniqueTerms([term, ...descriptorTerms, ...tokenTerms]);
  }

  return uniqueTerms([...descriptorTerms, ...tokenTerms]);
}

function getHardIdentityTerms(values: string[]): string[] {
  return uniqueTerms(
    uniqueTerms(values)
      .filter(isHardIdentityTerm)
      .map((term) => getEmbeddedHardIdentityTerm(term) || term)
  );
}

function getSoftIdentityTerms(values: string[]): string[] {
  return uniqueTerms(values).flatMap(getSoftTermsFromRequiredTerm);
}

function getProductText(product: Product): string {
  return `${product.title} ${product.brand} ${product.retailer} ${product.category} ${product.aesthetic} ${getStyleProfilePreferenceTerms(product.style_profile).join(" ")} ${product.product_url}`;
}

function hasIdentityTerm(productText: string, term: string): boolean {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) {
    return false;
  }

  const aliases = TERM_ALIASES[normalizedTerm] || [normalizedTerm];
  return aliases.some((alias) => containsTerm(productText, alias));
}

function getMatchedTerms(productText: string, terms: string[]): string[] {
  return uniqueTerms(terms).filter((term) => hasIdentityTerm(productText, term));
}

function getMissingTerms(productText: string, terms: string[]): string[] {
  const matchedTerms = new Set(
    getMatchedTerms(productText, terms).map((term) => normalizeSearchText(term))
  );

  return uniqueTerms(terms).filter(
    (term) => !matchedTerms.has(normalizeSearchText(term))
  );
}

function getPreferenceMatchQuality({
  preferenceTerms,
  matchedPreferenceTerms,
}: {
  preferenceTerms: string[];
  matchedPreferenceTerms: string[];
}): "exact" | "near" {
  if (preferenceTerms.length === 0) {
    return "exact";
  }

  const normalizedMatched = new Set(
    matchedPreferenceTerms.map((term) => normalizeSearchText(term))
  );
  const colorPreferenceTerms = preferenceTerms.filter((term) =>
    COLOR_DESCRIPTOR_TERMS.has(normalizeSearchText(term))
  );
  const hasColorPreference = colorPreferenceTerms.length > 0;
  const hasColorMatch = colorPreferenceTerms.some((term) =>
    normalizedMatched.has(normalizeSearchText(term))
  );
  const requiredMatchCount = Math.min(2, preferenceTerms.length);

  if (
    matchedPreferenceTerms.length >= requiredMatchCount &&
    (!hasColorPreference || hasColorMatch)
  ) {
    return "exact";
  }

  return "near";
}

function categoryFromText(value: string): string | null {
  const category = normalizeCategory(value);
  return ["outerwear", "tops", "pants", "shoes", "accessories"].includes(category)
    ? category
    : null;
}

function inferCategoriesFromTexts(values: string[]): Set<string> {
  const categories = new Set<string>();

  for (const value of values) {
    const category = categoryFromText(value);
    if (category) {
      categories.add(category);
    }
  }

  return categories;
}

function hasReplacementIntent(value: string): boolean {
  return /\b(replace|replacement|swap|upgrade|better|sharper|sleeker|streamline|refine|improve|tailor|tailored|fix|missing|add|needs?|should)\b/i.test(value);
}

function inferReplacementCategoriesFromTexts(values: string[]): Set<string> {
  return inferCategoriesFromTexts(values.filter(hasReplacementIntent));
}

function getCategoryTokens(category: string): Set<string> {
  return new Set(
    [category, ...(CATEGORY_TERMS[category] || [])].flatMap((term) =>
      Array.from(tokenize(term))
    )
  );
}

function getIntentDescriptorTokens(intentText: string, category: string): string[] {
  const categoryTokens = getCategoryTokens(category);

  return Array.from(tokenize(intentText)).filter(
    (token) => !INTENT_STOP_WORDS.has(token) && !categoryTokens.has(token)
  );
}

function getIntentText(intent: ShoppingIntent): string {
  return [
    intent.display_label,
    intent.product_type,
    intent.search_query,
    ...intent.alternate_queries,
    ...intent.required_terms,
    ...intent.optional_terms,
    ...getStyleProfilePreferenceTerms(intent.style_profile),
  ].join(" ");
}

function getIdentityTerms(intent: ShoppingIntent): string[] {
  return uniqueTerms([intent.product_type, ...intent.required_terms]).filter(
    (term) => !GENERIC_IDENTITY_TERMS.has(normalizeSearchText(term))
  );
}

function productMatchesIntentIdentity(
  product: Product,
  intent: ShoppingIntent
): boolean {
  const productCategory = normalizeCategory(product.category);
  if (productCategory !== intent.category) {
    return false;
  }

  const productText = getProductText(product);
  const productType = normalizeSearchText(intent.product_type);
  if (productType && !hasIdentityTerm(productText, productType)) {
    return false;
  }

  const requiredTerms = getHardIdentityTerms(intent.required_terms);
  if (requiredTerms.length === 0) {
    return true;
  }

  return requiredTerms.some((term) => hasIdentityTerm(productText, term));
}

function getImportantDescriptorTerms(intent: ShoppingIntent): string[] {
  const intentText = getIntentText(intent);
  const identityTerms = new Set(
    getIdentityTerms(intent).map((term) => normalizeSearchText(term))
  );
  const knownDescriptorTerms = IMPORTANT_DESCRIPTOR_TERMS.filter((term) =>
    containsTerm(intentText, term)
  );
  const optionalDescriptorTerms = intent.optional_terms.filter((term) => {
    const normalized = normalizeSearchText(term);
    return (
      normalized &&
      !identityTerms.has(normalized) &&
      !GENERIC_IDENTITY_TERMS.has(normalized) &&
      !WEAK_DESCRIPTOR_TERMS.has(normalized)
    );
  });
  const softRequiredTerms = getSoftIdentityTerms(intent.required_terms);
  const profilePreferenceTerms = getStyleProfilePreferenceTerms(
    intent.style_profile
  );

  return uniqueTerms([
    ...knownDescriptorTerms,
    ...profilePreferenceTerms,
    ...softRequiredTerms,
    ...optionalDescriptorTerms,
  ]);
}

function getProductPreferenceMatch(
  product: Product,
  intent: ShoppingIntent
): {
  quality: "exact" | "near";
  matchedPreferences: string[];
  missingPreferences: string[];
  preferenceTerms: string[];
} {
  const preferenceTerms = getImportantDescriptorTerms(intent);
  const productText = getProductText(product);
  const profileMatches = getStyleProfileFieldMatches(
    product.style_profile,
    intent.style_profile
  ).map((match) => match.split(":").at(1) || match);
  const matchedPreferences = uniqueTerms([
    ...getMatchedTerms(productText, preferenceTerms),
    ...profileMatches,
  ]);
  const missingPreferences = getMissingTerms(productText, preferenceTerms);

  return {
    quality: getPreferenceMatchQuality({
      preferenceTerms,
      matchedPreferenceTerms: matchedPreferences,
    }),
    matchedPreferences,
    missingPreferences,
    preferenceTerms,
  };
}

function productFullyCoversIntent(
  product: Product,
  intent: ShoppingIntent
): boolean {
  if (!productMatchesIntentIdentity(product, intent)) {
    return false;
  }

  if (product.source === "live" && product.intent_id === intent.id) {
    return product.match_quality !== "near";
  }

  return getProductPreferenceMatch(product, intent).quality === "exact";
}

function productPartiallyCoversIntent(
  product: Product,
  intent: ShoppingIntent
): boolean {
  return (
    productMatchesIntentIdentity(product, intent) &&
    !productFullyCoversIntent(product, intent)
  );
}

function scoreProductForShoppingIntent(
  product: Product,
  intent: ShoppingIntent
): number {
  if (!productMatchesIntentIdentity(product, intent)) {
    return 0;
  }

  const productCategory = normalizeCategory(product.category);
  const productText = getProductText(product);
  const productTokens = tokenize(productText);
  const descriptorTokens = getIntentDescriptorTokens(
    getIntentText(intent),
    productCategory
  );
  const importantDescriptorTerms = getImportantDescriptorTerms(intent);
  const identityTerms = getIdentityTerms(intent);
  let score = 12;

  for (const term of identityTerms) {
    if (hasIdentityTerm(productText, term)) {
      score += 5;
    }
  }

  for (const token of descriptorTokens) {
    if (productTokens.has(token)) {
      score += 2;
    }
  }

  for (const term of importantDescriptorTerms) {
    if (hasIdentityTerm(productText, term)) {
      score += 6;
    }
  }

  if (getIntentText(intent).toLowerCase().includes(product.aesthetic.toLowerCase())) {
    score += 2;
  }

  return score;
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

  const productTokens = tokenize(
    getProductText(product)
  );
  const descriptorTokens = getIntentDescriptorTokens(intentText, productCategory);
  let score = 4;
  let matchedDescriptors = 0;

  for (const token of descriptorTokens) {
    if (productTokens.has(token)) {
      matchedDescriptors += 1;
      score += 3;
    }
  }

  if (descriptorTokens.length > 0 && matchedDescriptors === 0) {
    return 0;
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
  budget?: string,
  options: RecommendationOptions = {}
): Product[] {
  const budgetCap = budget ? parseInt(budget.replace(/[^0-9]/g, ""), 10) : null;
  const budgetAllows = (products: Product[]) => {
    if (!budgetCap || isNaN(budgetCap) || budgetCap <= 0) {
      return products;
    }

    const filtered = products.filter((product) => product.price <= budgetCap);
    return filtered.length > 0 ? filtered : products;
  };
  const intentValues =
    audit.shopping_intents.length > 0
      ? audit.shopping_intents.flatMap((intent) => [
          intent.display_label,
          intent.product_type,
          intent.search_query,
          ...intent.required_terms,
          ...intent.optional_terms,
        ])
      : [...audit.missing_pieces, ...audit.shopping_queries];
  const protectedCategories = inferCategoriesFromTexts(audit.what_works);
  const allowedProtectedCategories = new Set([
    ...inferCategoriesFromTexts(audit.missing_pieces),
    ...inferReplacementCategoriesFromTexts(audit.what_to_fix),
  ]);
  const coveredProducts = options.coveredProducts || [];

  if (audit.shopping_intents.length > 0) {
    const eligibleIntents = [...audit.shopping_intents]
      .sort((left, right) => (left.priority || 0) - (right.priority || 0))
      .filter(
        (intent) =>
          !protectedCategories.has(intent.category) ||
          allowedProtectedCategories.has(intent.category)
      );
    const fullyCoveredIntents = eligibleIntents.filter((intent) =>
      coveredProducts.some((product) =>
        productFullyCoversIntent(product, intent)
      )
    );
    const partiallyCoveredIntents = eligibleIntents.filter(
      (intent) =>
        !coveredProducts.some((product) =>
          productFullyCoversIntent(product, intent)
        ) &&
        coveredProducts.some((product) =>
          productPartiallyCoversIntent(product, intent)
        )
    );
    const uncoveredIntents = eligibleIntents.filter(
      (intent) =>
        !coveredProducts.some((product) =>
          productFullyCoversIntent(product, intent)
        ) &&
        !coveredProducts.some((product) =>
          productPartiallyCoversIntent(product, intent)
        )
    );
    const fallbackEligibleIntents = eligibleIntents.filter(
      (intent) =>
        !coveredProducts.some((product) =>
          productFullyCoversIntent(product, intent)
        )
    );
    const selectedProducts: Product[] = [];
    const seenProducts = new Set<string>();
    const intentCandidateDetails: Array<{
      intentId: string;
      label: string;
      productType: string;
      rawRequiredTerms: string;
      hardRequiredTerms: string;
      softRequiredTerms: string;
      candidateCount: number;
      topCandidate: string | null;
    }> = [];

    for (const intent of fallbackEligibleIntents) {
      const scoredCandidates = budgetAllows(
        PRODUCT_CATALOG.filter((product) => !seenProducts.has(product.id))
      )
        .map((product) => ({
          product,
          score: scoreProductForShoppingIntent(product, intent),
        }));
      const candidates = scoredCandidates
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score);
      const bestMatch = candidates[0]?.product;

      intentCandidateDetails.push({
        intentId: intent.id,
        label: intent.display_label,
        productType: intent.product_type,
        rawRequiredTerms: uniqueTerms(intent.required_terms).join(", ") || "none",
        hardRequiredTerms:
          getHardIdentityTerms(intent.required_terms).join(", ") || "none",
        softRequiredTerms:
          getSoftIdentityTerms(intent.required_terms).join(", ") || "none",
        candidateCount: candidates.length,
        topCandidate: candidates[0]
          ? `${candidates[0].product.title} (${candidates[0].score})`
          : null,
      });

      if (!bestMatch) {
        continue;
      }

      const preferenceMatch = getProductPreferenceMatch(bestMatch, intent);
      const identityTerms = getIdentityTerms(intent);
      seenProducts.add(bestMatch.id);
      selectedProducts.push({
        ...bestMatch,
        source: "curated" as const,
        match_quality: preferenceMatch.quality,
        match_reasons: [
          ...(identityTerms.length > 0
            ? [`identity:${identityTerms.join(", ")}`]
            : []),
          ...(preferenceMatch.matchedPreferences.length > 0
            ? [`preferences:${preferenceMatch.matchedPreferences.join(", ")}`]
            : ["identity_match_without_preference_match"]),
        ],
        missing_preferences: preferenceMatch.missingPreferences,
        intent_id: intent.id,
        intent_label: intent.display_label,
      });
    }

    console.log("[recommendations] Curated recommendations ranked", {
      targetCategories: eligibleIntents.map((intent) => intent.category),
      protectedCategories: Array.from(protectedCategories),
      allowedProtectedCategories: Array.from(allowedProtectedCategories),
      coveredIntentIds: fullyCoveredIntents.map((intent) => intent.id),
      partiallyCoveredIntentIds: partiallyCoveredIntents.map(
        (intent) => intent.id
      ),
      uncoveredIntentIds: uncoveredIntents.map((intent) => intent.id),
      fallbackEligibleIntentIds: fallbackEligibleIntents.map(
        (intent) => intent.id
      ),
      intentCandidateDetails,
      matchedProducts: selectedProducts.length,
      returnedProducts: selectedProducts.length,
      returnedProductDetails: selectedProducts.map((product) => ({
        title: product.title.slice(0, 120),
        retailer: product.retailer,
        category: product.category,
        source: product.source || "unknown",
        matchQuality: product.match_quality || "exact",
        missingPreferences: product.missing_preferences?.slice(0, 4) || [],
        price: product.price,
      })),
    });

    return selectedProducts.slice(0, 3);
  }

  const targetCategories = new Set<string>();

  for (const intent of audit.shopping_intents) {
    if (
      !protectedCategories.has(intent.category) ||
      allowedProtectedCategories.has(intent.category)
    ) {
      targetCategories.add(intent.category);
    }
  }

  if (targetCategories.size === 0) {
    for (const value of audit.missing_pieces) {
      const category = categoryFromText(value);
      if (category) {
        targetCategories.add(category);
      }
    }

    for (const value of audit.shopping_queries) {
      const category = categoryFromText(value);
      if (
        category &&
        (!protectedCategories.has(category) ||
          allowedProtectedCategories.has(category))
      ) {
        targetCategories.add(category);
      }
    }
  }

  if (targetCategories.size === 0) {
    for (const category of audit.recommended_categories) {
      const normalized = categoryFromText(category);
      if (
        normalized &&
        (!protectedCategories.has(normalized) ||
          allowedProtectedCategories.has(normalized))
      ) {
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
  const recommendations = [...primary, ...secondary].slice(0, 3);
  console.log("[recommendations] Curated recommendations ranked", {
    targetCategories: Array.from(targetCategories),
    protectedCategories: Array.from(protectedCategories),
    allowedProtectedCategories: Array.from(allowedProtectedCategories),
    matchedProducts: matches.length,
    returnedProducts: recommendations.length,
    returnedProductDetails: recommendations.map((product) => ({
      title: product.title.slice(0, 120),
      retailer: product.retailer,
      category: product.category,
      source: product.source || "unknown",
      price: product.price,
    })),
  });

  return recommendations;
}
