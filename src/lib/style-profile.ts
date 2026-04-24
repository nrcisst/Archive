import type { ProductCategory, ShoppingIntent, ShoppingStyleProfile } from "./types";

type StyleProfileField = Exclude<keyof ShoppingStyleProfile, "avoid_finish">;

const PROFILE_OPTIONS: Record<StyleProfileField, string[]> = {
  fit: ["skinny", "slim", "regular", "straight", "relaxed", "loose", "wide", "flared", "tapered", "boxy", "oversized", "cropped"],
  color: ["black", "blue", "indigo", "grey", "brown", "olive", "cream", "white", "navy", "charcoal", "silver", "gold"],
  rise: ["low", "mid", "high"],
  leg: ["straight", "tapered", "wide", "flared", "cropped"],
  material: ["denim", "corduroy", "wool", "cotton", "linen", "leather", "nylon", "suede", "canvas", "mesh", "silk", "cashmere", "knit", "silver", "gold"],
  finish: ["clean", "raw", "washed", "faded", "distressed", "pleated", "minimal", "polished", "matte", "textured", "technical"],
  neckline: ["crew", "v-neck", "mock neck", "turtleneck", "collared", "open collar"],
  sleeve: ["sleeveless", "short sleeve", "long sleeve"],
  texture: ["plain", "ribbed", "waffle", "textured", "sheer"],
  weight: ["lightweight", "midweight", "heavyweight"],
  structure: ["unstructured", "structured", "tailored", "utility", "technical"],
  silhouette: ["low-top", "high-top", "boot", "loafer", "derby", "runner", "trainer", "sneaker"],
  toe: ["round", "almond", "square", "pointed"],
  sole: ["thin", "chunky", "lug", "platform"],
  scale: ["thin", "medium", "chunky", "oversized"],
  placement: ["neck", "wrist", "waist", "head", "crossbody"],
};

const FIELD_BY_CATEGORY: Record<ProductCategory, StyleProfileField[]> = {
  pants: ["fit", "color", "rise", "leg", "material", "finish"],
  tops: ["fit", "color", "neckline", "sleeve", "material", "texture", "finish"],
  outerwear: ["fit", "color", "weight", "material", "structure", "finish"],
  shoes: ["color", "silhouette", "toe", "sole", "material", "finish"],
  accessories: ["color", "scale", "material", "finish", "placement"],
};

const TERM_ALIASES: Record<string, string> = {
  "dark gray": "charcoal",
  "dark grey": "charcoal",
  gray: "grey",
  "slim fit": "slim",
  "straight leg": "straight",
  flare: "flared",
  "low top": "low-top",
  "low-top": "low-top",
  "high top": "high-top",
  "high-top": "high-top",
  sterling: "silver",
  delicate: "thin",
  "no rips": "distressed",
  "no distressing": "distressed",
};

const AVOID_FINISH_TERMS = ["distressed", "ripped", "rips", "faded", "washed", "pleated"];

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

function normalizeProfileValue(field: StyleProfileField, value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeText(value);
  const aliased = TERM_ALIASES[normalized] || normalized;
  const option = PROFILE_OPTIONS[field].find((candidate) => candidate === aliased);

  return option;
}

function normalizeAvoidFinish(values?: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values || []) {
    const normalized = TERM_ALIASES[normalizeText(value)] || normalizeText(value);
    const option =
      AVOID_FINISH_TERMS.find((candidate) => candidate === normalized) ||
      (normalized === "ripped" || normalized === "rips" ? "distressed" : undefined);

    if (option && !seen.has(option)) {
      seen.add(option);
      result.push(option);
    }
  }

  return result;
}

export function normalizeStyleProfile(
  profile: Partial<ShoppingStyleProfile> | undefined,
  category: ProductCategory
): ShoppingStyleProfile {
  const normalized: ShoppingStyleProfile = {};

  for (const field of FIELD_BY_CATEGORY[category]) {
    const value = normalizeProfileValue(field, profile?.[field]);
    if (value) {
      normalized[field] = value;
    }
  }

  const avoidFinish = normalizeAvoidFinish(profile?.avoid_finish);
  if (avoidFinish.length > 0) {
    normalized.avoid_finish = avoidFinish;
  }

  return normalized;
}

export function inferStyleProfileFromText(
  value: string,
  category: ProductCategory
): ShoppingStyleProfile {
  const profile: ShoppingStyleProfile = {};

  for (const field of FIELD_BY_CATEGORY[category]) {
    for (const option of PROFILE_OPTIONS[field]) {
      if (hasTerm(value, option)) {
        profile[field] = option;
        break;
      }
    }
  }

  if (/\b(no|without)\s+(rips?|distress(?:ed|ing)?)\b/i.test(value)) {
    profile.avoid_finish = ["distressed"];
  }

  return normalizeStyleProfile(profile, category);
}

export function mergeStyleProfiles(
  fallbackProfile: ShoppingStyleProfile,
  preferredProfile: ShoppingStyleProfile,
  category: ProductCategory
): ShoppingStyleProfile {
  return normalizeStyleProfile(
    {
      ...fallbackProfile,
      ...preferredProfile,
      avoid_finish: [
        ...(fallbackProfile.avoid_finish || []),
        ...(preferredProfile.avoid_finish || []),
      ],
    },
    category
  );
}

export function getStyleProfilePreferenceTerms(
  profile: ShoppingStyleProfile | undefined
): string[] {
  if (!profile) {
    return [];
  }

  const terms: string[] = [];
  for (const [field, value] of Object.entries(profile)) {
    if (!value || field === "avoid_finish") {
      continue;
    }

    terms.push(String(value));
  }

  for (const finish of profile.avoid_finish || []) {
    terms.push(finish === "distressed" ? "no rips" : `no ${finish}`);
  }

  return Array.from(new Set(terms));
}

function getRetailSearchProfileTerms(intent: ShoppingIntent): string[] {
  const profile = intent.style_profile;
  if (!profile) {
    return [];
  }

  const productType = intent.product_type.toLowerCase();
  const terms: string[] = [];

  if (profile.color) {
    terms.push(profile.color);
  }

  if (profile.fit) {
    terms.push(profile.fit);
  }

  if (profile.leg && profile.leg !== profile.fit) {
    terms.push(profile.leg);
  }

  if (
    profile.material &&
    !(productType.includes("jean") && profile.material === "denim")
  ) {
    terms.push(profile.material);
  }

  if (
    profile.silhouette &&
    !productType.includes(profile.silhouette.replace(/-/g, " "))
  ) {
    terms.push(profile.silhouette);
  }

  if (profile.scale) {
    terms.push(profile.scale);
  }

  return Array.from(new Set(terms));
}

export function buildStyleProfileSearchPhrase(intent: ShoppingIntent): string {
  const terms = getRetailSearchProfileTerms(intent);
  const avoidTerms = (intent.style_profile?.avoid_finish || []).map((finish) =>
    finish === "distressed" ? "no rips" : `no ${finish}`
  );

  return ["men's", ...terms, intent.product_type, ...avoidTerms]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getStyleProfileFieldMatches(
  productProfile: ShoppingStyleProfile | undefined,
  intentProfile: ShoppingStyleProfile | undefined
): string[] {
  if (!productProfile || !intentProfile) {
    return [];
  }

  return Object.entries(intentProfile)
    .filter(([field, value]) => field !== "avoid_finish" && productProfile[field as StyleProfileField] === value)
    .map(([field, value]) => `${field}:${value}`);
}
