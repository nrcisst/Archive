import { z } from "zod";
import { SchemaType, type ResponseSchema } from "@google/generative-ai";
import type {
  ProductCategory,
  ShoppingStyleProfile,
  ShoppingIntent,
  StyleAction,
  StyleActionCategory,
  StyleActionVerb,
  StyleActionVisibility,
} from "./types";
import {
  buildStyleProfileSearchPhrase,
  getStyleProfilePreferenceTerms,
  inferStyleProfileFromText,
  mergeStyleProfiles,
  normalizeStyleProfile,
} from "./style-profile";
import { normalizeMensSearchQuery } from "./search-query";

/**
 * Zod schema for validating the AI-generated style audit.
 * If the model returns malformed output, we catch it here
 * and fall back gracefully instead of showing raw JSON.
 */

const CanonicalCategorySchema = z.enum([
  "outerwear",
  "tops",
  "pants",
  "shoes",
  "accessories",
]);

const MAX_ALTERNATE_QUERIES = 2;
const MAX_REQUIRED_TERMS = 8;
const MAX_OPTIONAL_TERMS = 10;
const MAX_AVOID_TERMS = 12;
const MAX_STYLE_ACTIONS = 12;

const SHOPPABLE_ACTIONS = new Set<StyleActionVerb>(["add", "replace"]);

const stringListSchema = (): ResponseSchema => ({
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.STRING,
  },
});

const styleProfileResponseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    fit: { type: SchemaType.STRING },
    color: { type: SchemaType.STRING },
    rise: { type: SchemaType.STRING },
    leg: { type: SchemaType.STRING },
    material: { type: SchemaType.STRING },
    finish: { type: SchemaType.STRING },
    avoid_finish: stringListSchema(),
    neckline: { type: SchemaType.STRING },
    sleeve: { type: SchemaType.STRING },
    texture: { type: SchemaType.STRING },
    weight: { type: SchemaType.STRING },
    structure: { type: SchemaType.STRING },
    silhouette: { type: SchemaType.STRING },
    toe: { type: SchemaType.STRING },
    sole: { type: SchemaType.STRING },
    scale: { type: SchemaType.STRING },
    placement: { type: SchemaType.STRING },
  },
};

const shoppingIntentResponseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  required: [
    "category",
    "product_type",
    "style_profile",
    "display_label",
    "search_query",
    "reason",
  ],
  properties: {
    id: {
      type: SchemaType.STRING,
    },
    style_action_id: {
      type: SchemaType.STRING,
    },
    category: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["outerwear", "tops", "pants", "shoes", "accessories"],
    },
    product_type: {
      type: SchemaType.STRING,
    },
    style_profile: styleProfileResponseSchema,
    display_label: {
      type: SchemaType.STRING,
    },
    search_query: {
      type: SchemaType.STRING,
    },
    alternate_queries: stringListSchema(),
    reason: {
      type: SchemaType.STRING,
    },
    priority: {
      type: SchemaType.INTEGER,
    },
    required_terms: stringListSchema(),
    optional_terms: stringListSchema(),
    avoid_terms: stringListSchema(),
    replaces_visible_item: {
      type: SchemaType.BOOLEAN,
    },
  },
};

const styleActionResponseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  required: [
    "target_item",
    "target_category",
    "visibility",
    "action",
    "reason",
    "shoppable",
  ],
  properties: {
    id: {
      type: SchemaType.STRING,
    },
    target_item: {
      type: SchemaType.STRING,
    },
    target_category: {
      type: SchemaType.STRING,
      format: "enum",
      enum: [
        "outerwear",
        "tops",
        "pants",
        "shoes",
        "accessories",
        "non_shoppable",
      ],
    },
    visibility: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["visible", "missing", "unknown"],
    },
    action: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["keep", "remove", "replace", "add", "tailor", "avoid"],
    },
    reason: {
      type: SchemaType.STRING,
    },
    shoppable: {
      type: SchemaType.BOOLEAN,
    },
    shopping_intent_id: {
      type: SchemaType.STRING,
    },
  },
};

export const GeminiAuditResponseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  required: [
    "summary",
    "score",
    "aesthetic_read",
    "what_works",
    "what_to_fix",
    "missing_pieces",
    "recommended_categories",
    "shopping_queries",
    "style_actions",
    "shopping_intents",
    "tone",
  ],
  properties: {
    summary: {
      type: SchemaType.STRING,
    },
    score: {
      type: SchemaType.NUMBER,
    },
    aesthetic_read: {
      type: SchemaType.STRING,
    },
    what_works: stringListSchema(),
    what_to_fix: stringListSchema(),
    missing_pieces: stringListSchema(),
    recommended_categories: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.STRING,
        format: "enum",
        enum: ["outerwear", "tops", "pants", "shoes", "accessories"],
      },
    },
    shopping_queries: stringListSchema(),
    style_actions: {
      type: SchemaType.ARRAY,
      items: styleActionResponseSchema,
    },
    shopping_intents: {
      type: SchemaType.ARRAY,
      items: shoppingIntentResponseSchema,
    },
    tone: {
      type: SchemaType.STRING,
    },
  },
};

function cappedStringArray(maxItems: number) {
  return z.preprocess(
    (value) => (Array.isArray(value) ? value.slice(0, maxItems) : value),
    z.array(z.string()).max(maxItems)
  );
}

const ShoppingIntentSchema = z.object({
  id: z.string().min(1).optional(),
  style_action_id: z.string().min(1).optional(),
  category: z.string().min(2),
  product_type: z.string().min(2),
  style_profile: z
    .object({
      fit: z.string().optional(),
      color: z.string().optional(),
      rise: z.string().optional(),
      leg: z.string().optional(),
      material: z.string().optional(),
      finish: z.string().optional(),
      avoid_finish: z.array(z.string()).default([]),
      neckline: z.string().optional(),
      sleeve: z.string().optional(),
      texture: z.string().optional(),
      weight: z.string().optional(),
      structure: z.string().optional(),
      silhouette: z.string().optional(),
      toe: z.string().optional(),
      sole: z.string().optional(),
      scale: z.string().optional(),
      placement: z.string().optional(),
    })
    .default({ avoid_finish: [] }),
  display_label: z.string().min(2),
  search_query: z.string().min(3),
  alternate_queries: cappedStringArray(MAX_ALTERNATE_QUERIES).default([]),
  reason: z.string().min(6),
  priority: z.coerce.number().min(1).max(8).optional(),
  required_terms: cappedStringArray(MAX_REQUIRED_TERMS).default([]),
  optional_terms: cappedStringArray(MAX_OPTIONAL_TERMS).default([]),
  avoid_terms: cappedStringArray(MAX_AVOID_TERMS).default([]),
  replaces_visible_item: z.boolean().default(false),
});

const StyleActionSchema = z.object({
  id: z.string().min(1).optional(),
  target_item: z.string().min(2),
  target_category: z
    .enum([
      "outerwear",
      "tops",
      "pants",
      "shoes",
      "accessories",
      "non_shoppable",
    ])
    .optional(),
  visibility: z.enum(["visible", "missing", "unknown"]).default("unknown"),
  action: z.enum(["keep", "remove", "replace", "add", "tailor", "avoid"]),
  reason: z.string().min(6),
  shoppable: z.boolean().default(false),
  shopping_intent_id: z.string().min(1).optional(),
});

const RawStyleAuditSchema = z.object({
  summary: z.string().min(10, "Summary too short"),
  score: z.number().min(0).max(10),
  aesthetic_read: z.string().min(2),
  what_works: z.array(z.string()).min(1).max(10),
  what_to_fix: z.array(z.string()).min(1).max(10),
  missing_pieces: z.array(z.string()).max(10).default([]),
  recommended_categories: z.array(z.string()).max(8).default([]),
  shopping_queries: z.array(z.string()).max(8).default([]),
  style_actions: z.array(StyleActionSchema).max(MAX_STYLE_ACTIONS).optional(),
  shopping_intents: z.array(ShoppingIntentSchema).max(8).default([]),
  tone: z.string().min(2),
});

export const StyleAuditSchema = RawStyleAuditSchema.transform((audit) => {
  const styleActions = normalizeStyleActions(audit);
  const shoppingIntents = normalizeShoppingIntents(audit, styleActions);
  const alignedStyleActions = alignShoppableActionCategories(
    styleActions,
    shoppingIntents
  );
  const shouldDeriveShoppingFields = Boolean(audit.style_actions?.length);

  return {
    ...audit,
    style_actions: alignedStyleActions,
    missing_pieces: shouldDeriveShoppingFields
      ? shoppingIntents.map((intent) => intent.display_label)
      : audit.missing_pieces,
    recommended_categories: shouldDeriveShoppingFields
      ? shoppingIntents.map((intent) => intent.category)
      : audit.recommended_categories,
    shopping_queries: shouldDeriveShoppingFields
      ? shoppingIntents.map((intent) => intent.search_query)
      : audit.shopping_queries,
    shopping_intents: shoppingIntents,
  };
});

export type ValidatedStyleAudit = z.infer<typeof StyleAuditSchema>;

const CATEGORY_TERMS: Record<ProductCategory, string[]> = {
  outerwear: ["outerwear", "jacket", "coat", "parka", "blazer", "overshirt"],
  tops: ["top", "shirt", "tee", "t-shirt", "sweater", "hoodie", "knit", "polo"],
  pants: ["pants", "pant", "trouser", "trousers", "jeans", "chino", "corduroy"],
  shoes: ["shoe", "shoes", "sneaker", "sneakers", "boot", "boots", "loafer"],
  accessories: [
    "accessory",
    "accessories",
    "belt",
    "watch",
    "bracelet",
    "necklace",
    "chain",
    "ring",
    "beanie",
    "cap",
    "hat",
    "bag",
    "sunglasses",
    "sock",
  ],
};

const PRODUCT_TYPE_TERMS = [
  "corduroy pants",
  "tapered pants",
  "skinny jeans",
  "slim jeans",
  "straight leg jeans",
  "trousers",
  "pants",
  "jeans",
  "high-top sneakers",
  "low-top sneakers",
  "chunky sneakers",
  "sneakers",
  "boots",
  "loafers",
  "chain necklace",
  "necklace",
  "socks",
  "sock",
  "scarf",
  "bracelet",
  "ring",
  "watch",
  "beanie",
  "cap",
  "hat",
  "belt",
  "bag",
  "sunglasses",
  "blazer",
  "jacket",
  "overshirt",
  "shirt",
  "knit polo",
  "polo",
  "hoodie",
  "sweater",
];

const IMPLIED_MATERIAL_BY_PRODUCT_TYPE: Record<string, string[]> = {
  jeans: ["denim"],
};

const DISPLAY_PROFILE_FIELDS: Array<keyof ShoppingStyleProfile> = [
  "color",
  "fit",
  "leg",
  "material",
  "silhouette",
  "scale",
  "finish",
];

const DEFAULT_AVOID_TERMS = [
  "article",
  "blog",
  "editorial",
  "guide",
  "magazine",
  "pattern",
  "pdf pattern",
  "sewing",
  "tutorial",
  "fabric",
  "supplies",
  "women",
  "girls",
  "boys",
  "kids",
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTerm(value: string, term: string): boolean {
  const normalizedValue = ` ${normalizeText(value)} `;
  const normalizedTerm = normalizeText(term);
  return normalizedTerm ? normalizedValue.includes(` ${normalizedTerm} `) : false;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function inferCategory(value: string): ProductCategory {
  for (const [category, terms] of Object.entries(CATEGORY_TERMS)) {
    if (terms.some((term) => hasTerm(value, term))) {
      return category as ProductCategory;
    }
  }

  return "accessories";
}

function normalizeCategory(value: string | undefined, fallbackText: string): ProductCategory {
  const result = CanonicalCategorySchema.safeParse(value);
  return result.success ? result.data : inferCategory(fallbackText);
}

function inferProductType(value: string, category: ProductCategory): string {
  const productType = PRODUCT_TYPE_TERMS.find((term) => hasTerm(value, term));
  if (productType) {
    return productType;
  }

  const categoryTerm = CATEGORY_TERMS[category].find((term) => hasTerm(value, term));
  return categoryTerm || category;
}

function normalizeProductType(
  value: string,
  category: ProductCategory,
  profile: ShoppingStyleProfile
): string {
  const text = normalizeText(`${value} ${getStyleProfilePreferenceTerms(profile).join(" ")}`);

  if (category === "pants") {
    if (hasTerm(text, "jeans")) return "jeans";
    if (hasTerm(text, "trousers")) return "trousers";
    if (hasTerm(text, "chino") || hasTerm(text, "chinos")) return "chinos";
    return "pants";
  }

  if (category === "tops") {
    if (hasTerm(text, "polo")) return "polo";
    if (hasTerm(text, "sweater")) return "sweater";
    if (hasTerm(text, "hoodie")) return "hoodie";
    if (hasTerm(text, "tee") || hasTerm(text, "t-shirt")) return "tee";
    return "shirt";
  }

  if (category === "outerwear") {
    if (hasTerm(text, "blazer")) return "blazer";
    if (hasTerm(text, "overshirt")) return "overshirt";
    if (hasTerm(text, "coat")) return "coat";
    return "jacket";
  }

  if (category === "shoes") {
    if (hasTerm(text, "boot") || profile.silhouette === "boot") return "boots";
    if (hasTerm(text, "loafer") || profile.silhouette === "loafer") return "loafers";
    return "sneakers";
  }

  if (category === "accessories") {
    if (hasTerm(text, "necklace")) return "necklace";
    if (hasTerm(text, "chain")) return "chain necklace";
    if (hasTerm(text, "sock") || hasTerm(text, "socks")) return "socks";
    if (hasTerm(text, "scarf")) return "scarf";
    if (hasTerm(text, "bracelet")) return "bracelet";
    if (hasTerm(text, "ring")) return "ring";
    if (hasTerm(text, "watch")) return "watch";
    if (hasTerm(text, "belt")) return "belt";
    if (hasTerm(text, "bag")) return "bag";
    if (hasTerm(text, "beanie")) return "beanie";
    if (hasTerm(text, "cap")) return "cap";
    if (hasTerm(text, "hat")) return "hat";
    if (hasTerm(text, "sunglasses")) return "sunglasses";
  }

  return value.trim() || category;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function productTypeImpliesProfileTerm(
  productType: string,
  field: keyof ShoppingStyleProfile,
  value: string
): boolean {
  const normalizedProductType = normalizeText(productType);
  const normalizedValue = normalizeText(value);

  if (hasTerm(normalizedProductType, normalizedValue)) {
    return true;
  }

  if (field === "material") {
    return (IMPLIED_MATERIAL_BY_PRODUCT_TYPE[normalizedProductType] || []).some(
      (material) => material === normalizedValue
    );
  }

  return false;
}

function buildNormalizedDisplayLabel(
  productType: string,
  profile: ShoppingStyleProfile
): string {
  const profileTerms = DISPLAY_PROFILE_FIELDS.flatMap((field) => {
    const value = profile[field];
    if (
      !value ||
      Array.isArray(value) ||
      productTypeImpliesProfileTerm(productType, field, value)
    ) {
      return [];
    }

    return [value];
  });

  return titleCase(uniqueStrings([...profileTerms, productType.split(/\s+/).join(" ")]).join(" "));
}

function inferRequiredTerms(
  value: string,
  productType: string,
  category: ProductCategory
): string[] {
  const categoryTerms = CATEGORY_TERMS[category].filter((term) =>
    hasTerm(value, term)
  );
  const identityTerms = [productType, ...categoryTerms].filter(
    (term) => !["accessory", "accessories", "outerwear", "tops"].includes(term)
  );

  return uniqueStrings(identityTerms).slice(0, 4);
}

function getNormalizedIntentProfile({
  category,
  productType,
  searchQuery,
  displayLabel,
  requiredTerms,
  optionalTerms,
  styleProfile,
}: {
  category: ProductCategory;
  productType: string;
  searchQuery: string;
  displayLabel: string;
  requiredTerms: string[];
  optionalTerms: string[];
  styleProfile: ShoppingStyleProfile;
}): ShoppingStyleProfile {
  const inferredProfile = inferStyleProfileFromText(
    [
      displayLabel,
      productType,
      searchQuery,
      ...requiredTerms,
      ...optionalTerms,
    ].join(" "),
    category
  );

  return mergeStyleProfiles(
    inferredProfile,
    normalizeStyleProfile(styleProfile, category),
    category
  );
}

function buildOptionalTermsFromProfile(
  profile: ShoppingStyleProfile,
  existingTerms: string[]
): string[] {
  return uniqueStrings([
    ...getStyleProfilePreferenceTerms(profile),
    ...existingTerms,
  ]).slice(0, MAX_OPTIONAL_TERMS);
}

type RawStyleAudit = z.infer<typeof RawStyleAuditSchema>;
type RawStyleAction = z.infer<typeof StyleActionSchema>;

function slugifyId(value: string, fallback: string): string {
  const slug = normalizeText(value)
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function normalizeActionCategory(
  value: string | undefined,
  fallbackText: string,
  options?: {
    shoppable?: boolean;
    verb?: StyleActionVerb;
  }
): StyleActionCategory {
  if (value === "non_shoppable") {
    return options?.shoppable || options?.verb === "add" || options?.verb === "replace"
      ? normalizeCategory(undefined, fallbackText)
      : "non_shoppable";
  }

  return normalizeCategory(value, fallbackText);
}

function normalizeActionVerb(value: string): StyleActionVerb {
  if (
    value === "keep" ||
    value === "remove" ||
    value === "replace" ||
    value === "add" ||
    value === "tailor" ||
    value === "avoid"
  ) {
    return value;
  }

  return "avoid";
}

function normalizeVisibility(value: string): StyleActionVisibility {
  if (value === "visible" || value === "missing" || value === "unknown") {
    return value;
  }

  return "unknown";
}

function isShoppableAction(action: StyleAction): boolean {
  return action.shoppable && SHOPPABLE_ACTIONS.has(action.action);
}

function alignShoppableActionCategories(
  actions: StyleAction[],
  intents: ShoppingIntent[]
): StyleAction[] {
  return actions.map((action) => {
    if (!isShoppableAction(action)) {
      return action;
    }

    const linkedIntent = intents.find(
      (intent) =>
        intent.id.toLowerCase() === action.shopping_intent_id?.toLowerCase() ||
        intent.style_action_id?.toLowerCase() === action.id.toLowerCase()
    );

    if (!linkedIntent || action.target_category === linkedIntent.category) {
      return action;
    }

    return {
      ...action,
      target_category: linkedIntent.category,
    };
  });
}

function normalizeStyleAction(
  action: RawStyleAction,
  index: number
): StyleAction {
  const verb = normalizeActionVerb(action.action);
  const targetItem = action.target_item.trim();
  const shoppable = Boolean(action.shoppable && SHOPPABLE_ACTIONS.has(verb));
  const targetCategory = normalizeActionCategory(
    action.target_category,
    `${targetItem} ${action.reason}`.trim(),
    { shoppable, verb }
  );

  return {
    id: action.id || slugifyId(`${verb}-${targetItem}`, `action-${index + 1}`),
    target_item: targetItem,
    target_category: targetCategory,
    visibility: normalizeVisibility(action.visibility),
    action: verb,
    reason: action.reason.trim(),
    shoppable,
    shopping_intent_id: shoppable ? action.shopping_intent_id : undefined,
  };
}

function inferLegacyStyleActions(audit: RawStyleAudit): StyleAction[] {
  const actions: StyleAction[] = [];

  for (const [index, item] of audit.what_works.entries()) {
    actions.push({
      id: `legacy-keep-${index + 1}`,
      target_item: item,
      target_category: normalizeActionCategory(undefined, item),
      visibility: "visible",
      action: "keep",
      reason: item,
      shoppable: false,
    });
  }

  for (const [index, item] of audit.what_to_fix.entries()) {
    actions.push({
      id: `legacy-refine-${index + 1}`,
      target_item: item,
      target_category: normalizeActionCategory(undefined, item),
      visibility: "visible",
      action: "tailor",
      reason: item,
      shoppable: false,
    });
  }

  for (const [index, item] of audit.missing_pieces.entries()) {
    const linkedIntent = audit.shopping_intents[index];
    actions.push({
      id: `legacy-add-${index + 1}`,
      target_item: item,
      target_category: normalizeActionCategory(
        audit.recommended_categories[index],
        item
      ),
      visibility: "missing",
      action: "add",
      reason: linkedIntent?.reason || `Add ${item}.`,
      shoppable: true,
      shopping_intent_id: linkedIntent?.id || `intent-${index + 1}`,
    });
  }

  return actions.slice(0, MAX_STYLE_ACTIONS);
}

function normalizeStyleActions(audit: RawStyleAudit): StyleAction[] {
  if (!audit.style_actions?.length) {
    return inferLegacyStyleActions(audit);
  }

  return audit.style_actions
    .map((action, index) => normalizeStyleAction(action, index))
    .slice(0, MAX_STYLE_ACTIONS);
}

function hasActionIntentLink(action: StyleAction, intent: ShoppingIntent): boolean {
  return Boolean(
    action.shopping_intent_id &&
      action.shopping_intent_id.toLowerCase() === intent.id.toLowerCase()
  );
}

function intentText(intent: ShoppingIntent): string {
  return [
    intent.id,
    intent.display_label,
    intent.product_type,
    intent.search_query,
    ...intent.required_terms,
    ...intent.optional_terms,
  ].join(" ");
}

function intentMatchesAction(intent: ShoppingIntent, action: StyleAction): boolean {
  const actionText = `${action.target_item} ${action.reason}`;
  const normalizedIntent = normalizeText(intentText(intent));
  const normalizedAction = normalizeText(actionText);

  if (!normalizedIntent || !normalizedAction) {
    return false;
  }

  if (
    hasTerm(normalizedAction, intent.product_type) ||
    hasTerm(normalizedIntent, action.target_item)
  ) {
    return true;
  }

  const productType = inferProductType(normalizedAction, intent.category);
  return hasTerm(normalizedIntent, productType);
}

function filterShoppingIntentsByActions(
  intents: ShoppingIntent[],
  styleActions: StyleAction[],
  hasAtomicActions: boolean
): ShoppingIntent[] {
  if (!hasAtomicActions) {
    return intents;
  }

  const shoppableActions = styleActions.filter(isShoppableAction);
  if (shoppableActions.length === 0) {
    return [];
  }

  return intents.filter((intent) => {
    const linkedAction = styleActions.find((action) =>
      hasActionIntentLink(action, intent)
    );

    if (linkedAction) {
      return isShoppableAction(linkedAction);
    }

    if (intent.style_action_id) {
      const actionForIntent = styleActions.find(
        (action) => action.id.toLowerCase() === intent.style_action_id?.toLowerCase()
      );
      return Boolean(actionForIntent && isShoppableAction(actionForIntent));
    }

    return shoppableActions.some((action) => intentMatchesAction(intent, action));
  });
}

function normalizeShoppingIntents(
  audit: RawStyleAudit,
  styleActions: StyleAction[]
): ShoppingIntent[] {
  if (audit.shopping_intents.length) {
    const normalizedIntents = audit.shopping_intents.map((intent, index) => {
      const category = normalizeCategory(
        intent.category,
        `${intent.display_label} ${intent.search_query} ${intent.product_type}`
      );
      const rawProductType = intent.product_type.trim();
      const searchQuery = normalizeMensSearchQuery(intent.search_query.trim());
      const linkedAction = styleActions.find(
        (action) =>
          action.id === intent.style_action_id ||
          action.shopping_intent_id === intent.id
      );
      const styleProfile = getNormalizedIntentProfile({
        category,
        productType: rawProductType,
        searchQuery,
        displayLabel: intent.display_label,
        requiredTerms: intent.required_terms,
        optionalTerms: intent.optional_terms,
        styleProfile: intent.style_profile,
      });
      const productType = normalizeProductType(
        rawProductType,
        category,
        styleProfile
      );
      const displayLabel = buildNormalizedDisplayLabel(productType, styleProfile);
      const requiredTerms = uniqueStrings(
        inferRequiredTerms(searchQuery, productType, category)
      );
      const normalizedSearchQuery =
        normalizeMensSearchQuery(
          buildStyleProfileSearchPhrase({
            id: intent.id || `intent-${index + 1}`,
            style_action_id: linkedAction?.id || intent.style_action_id,
            category,
            product_type: productType,
            style_profile: styleProfile,
            display_label: displayLabel,
            search_query: searchQuery,
            alternate_queries: [],
            reason: intent.reason.trim(),
            priority: intent.priority || index + 1,
            required_terms: requiredTerms,
            optional_terms: [],
            avoid_terms: [],
            replaces_visible_item: intent.replaces_visible_item,
          }) || searchQuery
        );

      const normalizedAlternateQueries = uniqueStrings(
        (intent.alternate_queries || []).map((query) =>
          normalizeMensSearchQuery(query)
        )
      ).filter(
        (query) => query.toLowerCase() !== normalizedSearchQuery.toLowerCase()
      );

      return {
        id: intent.id || `intent-${index + 1}`,
        style_action_id: linkedAction?.id || intent.style_action_id,
        category,
        product_type: productType,
        style_profile: styleProfile,
        display_label: displayLabel,
        search_query: normalizedSearchQuery,
        alternate_queries: normalizedAlternateQueries,
        reason: intent.reason.trim(),
        priority: intent.priority || index + 1,
        required_terms: requiredTerms.slice(0, MAX_REQUIRED_TERMS),
        optional_terms: buildOptionalTermsFromProfile(
          styleProfile,
          intent.optional_terms
        ),
        avoid_terms: uniqueStrings([
          ...intent.avoid_terms,
          ...DEFAULT_AVOID_TERMS,
        ]).slice(0, MAX_AVOID_TERMS),
        replaces_visible_item: intent.replaces_visible_item,
      };
    });

    return filterShoppingIntentsByActions(
      normalizedIntents,
      styleActions,
      Boolean(audit.style_actions?.length)
    ).map((intent, index) => ({
      ...intent,
      priority: index + 1,
    }));
  }

  const count = Math.max(
    audit.missing_pieces.length,
    audit.shopping_queries.length,
    audit.recommended_categories.length
  );

  const inferredIntents = Array.from({ length: count })
    .map((_, index) => {
      const displayLabel =
        audit.missing_pieces[index] || audit.shopping_queries[index] || "";
      const searchQuery = normalizeMensSearchQuery(
        audit.shopping_queries[index] || audit.missing_pieces[index] || ""
      );
      const category = normalizeCategory(
        audit.recommended_categories[index],
        `${displayLabel} ${searchQuery}`
      );
      const inferredProductType = inferProductType(
        `${displayLabel} ${searchQuery}`,
        category
      );
      const styleProfile = getNormalizedIntentProfile({
        category,
        productType: inferredProductType,
        searchQuery,
        displayLabel,
        requiredTerms: [],
        optionalTerms: [],
        styleProfile: {},
      });
      const productType = normalizeProductType(
        inferredProductType,
        category,
        styleProfile
      );
      const normalizedDisplayLabel = buildNormalizedDisplayLabel(
        productType,
        styleProfile
      );
      const requiredTerms = inferRequiredTerms(searchQuery, productType, category);

      return {
        id: `intent-${index + 1}`,
        style_action_id: styleActions[index]?.id,
        category,
        product_type: productType,
        style_profile: styleProfile,
        display_label: normalizedDisplayLabel,
        search_query:
          normalizeMensSearchQuery(
            buildStyleProfileSearchPhrase({
              id: `intent-${index + 1}`,
              style_action_id: styleActions[index]?.id,
              category,
              product_type: productType,
              style_profile: styleProfile,
              display_label: normalizedDisplayLabel,
              search_query: searchQuery,
              alternate_queries: [],
              reason: `Search for ${displayLabel || searchQuery}.`,
              priority: index + 1,
              required_terms: requiredTerms,
              optional_terms: [],
              avoid_terms: [],
              replaces_visible_item: false,
            }) || searchQuery
          ),
        alternate_queries: [],
        reason: `Search for ${displayLabel || searchQuery}.`,
        priority: index + 1,
        required_terms: requiredTerms,
        optional_terms: buildOptionalTermsFromProfile(styleProfile, []),
        avoid_terms: DEFAULT_AVOID_TERMS,
        replaces_visible_item: false,
      };
    })
    .filter((intent) => intent.display_label && intent.search_query);

  return filterShoppingIntentsByActions(
    inferredIntents,
    styleActions,
    Boolean(audit.style_actions?.length)
  );
}

/**
 * Attempt to parse and validate a style audit from raw model output.
 * Returns the validated audit or null if parsing fails.
 */
export function parseAuditResponse(raw: string): ValidatedStyleAudit | null {
  try {
    // Try to extract JSON from the raw response
    // Models sometimes wrap JSON in markdown code blocks
    let jsonStr = raw;

    // Strip markdown code fences if present
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    const parsed = JSON.parse(jsonStr.trim());
    const result = StyleAuditSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    console.error("[schema] Validation failed:", result.error.issues);
    return null;
  } catch (err) {
    console.error("[schema] JSON parse failed:", err);
    return null;
  }
}
