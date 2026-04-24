import { createHash } from "node:crypto";
import type {
  Product,
  ProductSearchProgressEvent,
  ShoppingIntent,
  ShoppingStyleProfile,
} from "./types";
import {
  buildStyleProfileSearchPhrase,
  getStyleProfilePreferenceTerms,
} from "./style-profile";
import { createGeminiModel, hasGeminiCredentials } from "./gemini";
import { normalizeMensSearchQuery } from "./search-query";

type SearchProviderName = "brave-search" | "google-cse" | "gemini-url-finder";
type ProductSearchProgressReporter = (
  event: ProductSearchProgressEvent
) => void;
type SearchQuerySource =
  | "shopping-intent"
  | "missing-piece"
  | "shopping-query"
  | "category";

interface SearchQuery {
  text: string;
  categoryHint: string;
  source: SearchQuerySource;
  sourceIndex: number;
  intentId?: string;
  productType?: string;
  displayLabel?: string;
  reason?: string;
  requiredTerms: string[];
  optionalTerms: string[];
  styleProfile?: ShoppingStyleProfile;
  avoidTerms: string[];
  replacesVisibleItem?: boolean;
  alternateQuery?: boolean;
}

interface ProductCandidate {
  url: string;
  candidateKind?: "product" | "discovery-page";
  discoveryParentUrl?: string;
  titleHint?: string;
  retailerHint?: string;
  imageHint?: string;
  priceHint?: number;
  categoryHint: string;
  intentText: string;
  querySource: SearchQuerySource;
  querySourceIndex: number;
  intentId?: string;
  productType?: string;
  displayLabel?: string;
  reason?: string;
  requiredTerms: string[];
  optionalTerms: string[];
  styleProfile?: ShoppingStyleProfile;
  avoidTerms: string[];
  replacesVisibleItem?: boolean;
  alternateQuery?: boolean;
  provider: SearchProviderName;
  rank: number;
}

type ProductCandidateRejectionEvidenceValue =
  | string
  | number
  | boolean
  | null
  | string[];

type ProductCandidateRejectionEvidence = Record<
  string,
  ProductCandidateRejectionEvidenceValue
>;

interface ProductCandidateRejectionLog {
  reason: string;
  provider: SearchProviderName;
  url: string;
  candidateKind?: "product" | "discovery-page";
  category: string;
  querySource: SearchQuerySource;
  querySourceIndex: number;
  intentId?: string;
  productType?: string;
  displayLabel?: string;
  intentText: string;
  rank: number;
  evidence?: ProductCandidateRejectionEvidence;
}

type ProductCandidateIntentMatch =
  | {
    quality: "exact" | "near";
    matchReasons: string[];
    missingPreferences: string[];
    matchedDescriptors: string[];
    descriptorTokens: string[];
  }
  | {
    quality: "reject";
    reason: string;
    matchedDescriptors: string[];
    descriptorTokens: string[];
  };

const CANDIDATE_REJECTION_LOG_SAMPLE_SIZE = 3;

interface ProductPageMetadata {
  canonicalUrl: string;
  title: string | null;
  brand: string | null;
  retailer: string | null;
  description: string | null;
  imageUrl: string | null;
  price: number | null;
  priceCurrency: string | null;
  isProduct: boolean;
  ogType: string | null;
  hasProductSchema: boolean;
  hasProductMeta: boolean;
  hasProductUrlSignal: boolean;
  hasCommerceSignals: boolean;
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
  "yelp.com",
  "linktr.ee",
  "attn.tv",
  "usablenet.com",
];

const EDITORIAL_HOST_SNIPPETS = [
  "bloggers.feedspot.com",
  "denimhunters.com",
  "darngoodyarn.com",
  "elpais.com",
  "esquire.com",
  "fashionbeans.com",
  "feedspot.com",
  "fiberartsy.com",
  "forbes.com",
  "gathered.how",
  "goldenlucycrafts.com",
  "goodhousekeeping.com",
  "gq.com",
  "handylittleme.com",
  "highsnobiety.com",
  "hookedonhomemadehappiness.com",
  "idiva.com",
  "blog.inspireuplift.com",
  "lovelifeyarn.com",
  "madefromyarn.com",
  "makeanddocrew.com",
  "menshealth.com",
  "mooglyblog.com",
  "muellerundsohn.com",
  "nimble-needles.com",
  "nytimes.com",
  "onlineclothingstudy.com",
  "primermagazine.com",
  "pouted.com",
  "rohnstrong.com",
  "ropedye.com",
  "rollingstone.com",
  "sewrella.com",
  "stylegirlfriend.com",
  "stylecaster.com",
  "themanual.com",
  "theguardian.com",
  "themomedit.com",
  "thecrochetcrowd.com",
  "vogue.com",
  "woolandthegang.com",
  "yarnspirations.com",
  "tipnut.com",
  "whowhatwear.com",
  "wildemasche.com",
];

const RETAILER_HOST_SNIPPETS = [
  "abercrombie.com",
  "adidas.com",
  "amazon.com",
  "asos.com",
  "aritzia.com",
  "bananarepublic.gap.com",
  "brooksbrothers.com",
  "bonobos.com",
  "bombas.com",
  "buckmason.com",
  "carhartt.com",
  "dickies.com",
  "ebay.com",
  "everlane.com",
  "etsy.com",
  "farfetch.com",
  "gap.com",
  "grailed.com",
  "hm.com",
  "huckberry.com",
  "jcpenney.com",
  "jcrew.com",
  "landsend.com",
  "lee.com",
  "levi.com",
  "luckybrand.com",
  "madewell.com",
  "makeyourownjeans.com",
  "mrporter.com",
  "mugsyjeans.com",
  "nike.com",
  "nordstrom.com",
  "oldnavy.gap.com",
  "pacsun.com",
  "shopbop.com",
  "ssense.com",
  "stance.com",
  "tommy.com",
  "uniqlo.com",
  "urbanoutfitters.com",
  "walmart.com",
  "zappos.com",
  "zara.com",
];

const FETCH_BLOCKED_HOST_SNIPPETS = [
  "levi.com",
  "nordstrom.com",
];

const RETAILER_SITE_OPERATORS_BY_CATEGORY: Record<string, string[]> = {
  outerwear: [
    "site:uniqlo.com",
    "site:jcrew.com",
    "site:everlane.com",
    "site:gap.com",
    "site:oldnavy.gap.com",
    "site:bananarepublic.gap.com",
    "site:abercrombie.com",
    "site:buckmason.com",
    "site:nordstrom.com",
    "site:ssense.com",
    "site:farfetch.com",
    "site:urbanoutfitters.com",
  ],
  tops: [
    "site:uniqlo.com",
    "site:jcrew.com",
    "site:everlane.com",
    "site:gap.com",
    "site:oldnavy.gap.com",
    "site:bananarepublic.gap.com",
    "site:abercrombie.com",
    "site:buckmason.com",
    "site:nordstrom.com",
    "site:ssense.com",
    "site:farfetch.com",
    "site:urbanoutfitters.com",
  ],
  pants: [
    "site:levi.com",
    "site:gap.com",
    "site:oldnavy.gap.com",
    "site:bananarepublic.gap.com",
    "site:madewell.com",
    "site:everlane.com",
    "site:abercrombie.com",
    "site:luckybrand.com",
    "site:lee.com",
    "site:mugsyjeans.com",
    "site:pacsun.com",
    "site:nordstrom.com",
    "site:farfetch.com",
    "site:ssense.com",
  ],
  shoes: [
    "site:zappos.com",
    "site:nike.com",
    "site:adidas.com",
    "site:nordstrom.com",
    "site:mrporter.com",
    "site:ssense.com",
    "site:farfetch.com",
    "site:asos.com",
    "site:urbanoutfitters.com",
    "site:zara.com",
  ],
  accessories: [
    "site:nordstrom.com",
    "site:mrporter.com",
    "site:ssense.com",
    "site:farfetch.com",
    "site:jcrew.com",
    "site:uniqlo.com",
    "site:urbanoutfitters.com",
    "site:asos.com",
    "site:bombas.com",
    "site:stance.com",
    "site:amazon.com",
    "site:walmart.com",
  ],
};

const MARKETPLACE_SITE_OPERATORS = [
  "site:grailed.com",
  "site:etsy.com",
  "site:depop.com",
  "site:ebay.com/itm/",
] as const;

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
  tops: ["shirt", "tee", "sweater", "polo", "hoodie", "knit", "tops"],
  pants: ["pants", "trouser", "trousers", "jeans", "chino", "slacks"],
  shoes: ["shoe", "sneaker", "boot", "loafer", "derby", "heel", "clog"],
  accessories: [
    "belt",
    "watch",
    "bracelet",
    "bag",
    "beanie",
    "cap",
    "hat",
    "headwear",
    "scarf",
    "sunglasses",
    "jewelry",
    "necklace",
    "ring",
    "chain",
    "sock",
  ],
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
  "/listing/",
  "/listings/",
  "/product/",
  "/products/",
  "/p/",
  "/dp/",
  "/item/",
  "/items/",
  "/sku/",
  "/prod/",
];

const LISTING_SEGMENT_PATTERN =
  /^(accessories|beanies|boots|caps|coats|denim-jackets|hats|hoodies|jackets|jeans|loafers|pants|shirts|sneakers|socks|sunglasses|sweaters|tees|trousers)(?:-\d+)?(?:\.aspx)?$/;

const DISCOVERY_LISTING_PATH_SNIPPETS = [
  "/browse/",
  "/brand/",
  "/brands/",
  "/c/",
  "/cat/",
  "/category/",
  "/categories/",
  "/collection/",
  "/collections/",
  "/designer/",
  "/designers/",
  "/facets/",
  "/market/",
  "/shop/",
  "/shops/",
];

const ASSET_URL_EXTENSION_PATTERN =
  /\.(?:avif|css|gif|ico|jpeg|jpg|js|json|map|png|svg|webp)(?:[?#]|$)/i;

const NON_WEARABLE_PRODUCT_PATTERNS = [
  /\bsewing\s+patterns?\b/i,
  /\bpdf\s+patterns?\b/i,
  /\bdigital\s+patterns?\b/i,
  /\bpatterns?\b/i,
  /\btemplates?\b/i,
  /\bfabric\b/i,
  /\bcrochet\b/i,
  /\bknitting\b/i,
  /\byarn\b/i,
  /\byardage\b/i,
  /\bnotions?\b/i,
  /\bdiy\b/i,
  /\btutorials?\b/i,
  /\bsewing\s+kit\b/i,
  /\bknitting\s+patterns?\b/i,
  /\bcrochet\s+patterns?\b/i,
];

const CATEGORY_MATCH_TERMS: Record<string, string[]> = {
  outerwear: [
    "outerwear",
    "jacket",
    "coat",
    "parka",
    "blazer",
    "overshirt",
    "bomber",
    "anorak",
    "shell",
    "vest",
  ],
  tops: [
    "shirt",
    "tee",
    "tops",
    "t-shirt",
    "tshirt",
    "sweater",
    "hoodie",
    "knit",
    "polo",
    "crewneck",
    "thermal",
  ],
  pants: [
    "pants",
    "pant",
    "trouser",
    "trousers",
    "jeans",
    "jean",
    "chino",
    "chinos",
    "slacks",
  ],
  shoes: [
    "footwear",
    "shoe",
    "shoes",
    "sneaker",
    "sneakers",
    "trainer",
    "trainers",
    "boot",
    "boots",
    "loafer",
    "loafers",
    "derby",
    "clog",
    "clogs",
  ],
  accessories: [
    "accessory",
    "accessories",
    "belt",
    "watch",
    "bracelet",
    "bag",
    "beanie",
    "sling",
    "cap",
    "hat",
    "headwear",
    "scarf",
    "sunglasses",
    "necklace",
    "jewelry",
    "jewellery",
    "ring",
    "rings",
    "chain",
    "chains",
    "earring",
    "earrings",
    "sock",
    "socks",
  ],
};

const CATEGORY_DETECTION_ORDER = [
  "shoes",
  "pants",
  "accessories",
  "outerwear",
  "tops",
] as const;

const PRODUCT_SUBTYPE_TERMS: Array<{ subtype: string; terms: string[] }> = [
  { subtype: "sneakers", terms: ["sneaker", "sneakers", "trainer", "trainers"] },
  { subtype: "boots", terms: ["boot", "boots"] },
  { subtype: "loafers", terms: ["loafer", "loafers"] },
  { subtype: "corduroy-pants", terms: ["corduroy pants", "corduroy trouser", "corduroy trousers"] },
  { subtype: "pants", terms: ["pants", "pant", "trouser", "trousers", "jeans", "chino", "chinos"] },
  { subtype: "beanies", terms: ["beanie", "beanies", "knit cap", "watch cap"] },
  { subtype: "hats", terms: ["hat", "cap", "headwear"] },
  { subtype: "belts", terms: ["belt", "belts"] },
  { subtype: "bags", terms: ["bag", "bags", "sling", "tote"] },
  { subtype: "jewelry", terms: ["jewelry", "jewellery", "necklace", "chain", "ring", "bracelet", "earring"] },
  { subtype: "socks", terms: ["sock", "socks"] },
  { subtype: "outerwear", terms: ["jacket", "coat", "parka", "blazer", "overshirt", "bomber"] },
  { subtype: "tops", terms: ["shirt", "tee", "t-shirt", "tshirt", "sweater", "hoodie", "knit", "polo"] },
];

const BRAVE_SEARCH_QUERY_MAX_LENGTH = 380;
const CANDIDATE_FETCH_TIMEOUT_MS = 5000;
const SELECTED_CANDIDATE_LIMIT = 48;
const DISCOVERY_PAGE_EXPANSION_LIMIT = 6;
const DISCOVERY_PAGE_LINK_LIMIT = 6;
const VALIDATION_CANDIDATE_LIMIT = 60;
const VALIDATION_CANDIDATE_HOST_LIMIT = 4;
const BRAVE_RESULTS_PER_QUERY = "20";
const MAX_SEARCH_QUERIES = 8;
const RETAILER_SITE_QUERY_LIMIT = 4;
const MARKETPLACE_SITE_QUERY_LIMIT = 2;
const PRODUCT_PATH_QUERY_OPERATORS = [
  "inurl:product",
  "inurl:products",
] as const;
// Reserved for future reactivation of Gemini URL finder.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MIN_PRIMARY_CANDIDATES_BEFORE_GEMINI = 3;
const GEMINI_URL_FINDER_TIMEOUT_MS = 8000;
const GOOGLE_CSE_TIMEOUT_MS = 8000;
let googleCseAvailable = false;
let googleCseDisabledReason: string | null = null;
let googleCseProbePromise: Promise<string | null> | null = null;
let googleCseDisabledExplanation: string | null = null;
let googleCseDisabledSuggestedFix: string | null = null;

interface GoogleApiErrorPayload {
  message: string | null;
  reason: string | null;
  domain: string | null;
  location: string | null;
}

interface GoogleCseFailureDescription {
  code: string;
  permanent: boolean;
  explanation: string;
  suggestedFix: string;
  googleMessage: string | null;
  googleReason: string | null;
  googleDomain: string | null;
  googleLocation: string | null;
}

function parseGoogleApiError(errorText: string): GoogleApiErrorPayload {
  try {
    const parsed = JSON.parse(errorText) as {
      error?: {
        message?: string;
        errors?: Array<{
          reason?: string;
          domain?: string;
          location?: string;
        }>;
      };
    };
    const firstError = parsed.error?.errors?.[0];

    return {
      message: parsed.error?.message || null,
      reason: firstError?.reason || null,
      domain: firstError?.domain || null,
      location: firstError?.location || null,
    };
  } catch {
    return {
      message: errorText.trim() || null,
      reason: null,
      domain: null,
      location: null,
    };
  }
}

function summarizeGoogleCseConfig(apiKey?: string, engineId?: string) {
  return {
    apiKeyPresent: Boolean(apiKey),
    engineIdPresent: Boolean(engineId),
    engineIdPrefix: engineId ? `${engineId.slice(0, 8)}...` : null,
    engineIdLength: engineId?.length || 0,
  };
}

function describeGoogleCseFailure(
  status: number,
  errorText: string
): GoogleCseFailureDescription {
  const parsed = parseGoogleApiError(errorText);
  const normalizedMessage = (parsed.message || errorText || "").toLowerCase();

  if (
    normalizedMessage.includes(
      "requests to this api customsearch method google.customsearch.v1.customsearchservice.list are blocked"
    )
  ) {
    return {
      code: "custom_search_list_method_blocked",
      permanent: true,
      explanation:
        "Google is blocking the Custom Search list method for this key/project combination. This usually points to API-key restrictions, org policy, or method-level access controls rather than a bad search query.",
      suggestedFix:
        "Temporarily remove API-key restrictions, verify the key and Programmable Search Engine belong to the intended project, then retry. If it still fails, treat Google CSE as unavailable for this project.",
      googleMessage: parsed.message,
      googleReason: parsed.reason,
      googleDomain: parsed.domain,
      googleLocation: parsed.location,
    };
  }

  if (
    normalizedMessage.includes(
      "this project does not have the access to custom search json api"
    ) ||
    normalizedMessage.includes(
      "this project does not have access to custom search json api"
    )
  ) {
    return {
      code: "project_lacks_custom_search_json_api_access",
      permanent: true,
      explanation:
        "Google is denying this project access to the legacy Custom Search JSON API itself. This is not caused by our search terms; it is a project-level access limitation.",
      suggestedFix:
        "Use an older approved Google project if you have one. Otherwise remove Google CSE from active providers and rely on Brave, eBay, and affiliate feeds.",
      googleMessage: parsed.message,
      googleReason: parsed.reason,
      googleDomain: parsed.domain,
      googleLocation: parsed.location,
    };
  }

  if (
    normalizedMessage.includes("api key not valid") ||
    normalizedMessage.includes("invalid api key")
  ) {
    return {
      code: "invalid_google_search_api_key",
      permanent: false,
      explanation:
        "The Google Search API key itself is invalid or malformed.",
      suggestedFix:
        "Generate a fresh key in the same project as the Programmable Search Engine and update GOOGLE_SEARCH_API_KEY.",
      googleMessage: parsed.message,
      googleReason: parsed.reason,
      googleDomain: parsed.domain,
      googleLocation: parsed.location,
    };
  }

  if (
    normalizedMessage.includes("api customsearch.googleapis.com has not been used") ||
    normalizedMessage.includes("custom search api has not been used") ||
    normalizedMessage.includes("is disabled") ||
    normalizedMessage.includes("enable it by visiting")
  ) {
    return {
      code: "custom_search_api_not_enabled",
      permanent: false,
      explanation:
        "The Custom Search API is not enabled, or Google has not finished propagating enablement for this project.",
      suggestedFix:
        "Enable the API in the same project as the key, wait a few minutes, then retry.",
      googleMessage: parsed.message,
      googleReason: parsed.reason,
      googleDomain: parsed.domain,
      googleLocation: parsed.location,
    };
  }

  if (
    normalizedMessage.includes("referer") ||
    normalizedMessage.includes("referrer") ||
    normalizedMessage.includes("ip address") ||
    normalizedMessage.includes("requests from this ios client application") ||
    normalizedMessage.includes("requests from this android client application")
  ) {
    return {
      code: "google_api_key_restriction_mismatch",
      permanent: false,
      explanation:
        "The key exists, but its application restrictions do not match how this Next.js server is calling the API.",
      suggestedFix:
        "For server-side testing, remove website/app/IP restrictions from the key, confirm the API restriction includes Custom Search API, then retry.",
      googleMessage: parsed.message,
      googleReason: parsed.reason,
      googleDomain: parsed.domain,
      googleLocation: parsed.location,
    };
  }

  if (
    status === 400 &&
    (normalizedMessage.includes("cx") ||
      normalizedMessage.includes("search engine id") ||
      parsed.location === "cx")
  ) {
    return {
      code: "invalid_google_search_engine_id",
      permanent: false,
      explanation:
        "The request reached Google, but the Programmable Search Engine ID (`cx`) appears invalid or incompatible with the request.",
      suggestedFix:
        "Copy the search engine ID again from Programmable Search Engine and update GOOGLE_SEARCH_ENGINE_ID.",
      googleMessage: parsed.message,
      googleReason: parsed.reason,
      googleDomain: parsed.domain,
      googleLocation: parsed.location,
    };
  }

  if (
    normalizedMessage.includes("quota") ||
    normalizedMessage.includes("daily limit exceeded") ||
    normalizedMessage.includes("rate limit exceeded") ||
    parsed.reason === "quotaExceeded"
  ) {
    return {
      code: "google_cse_quota_exceeded",
      permanent: false,
      explanation:
        "Google accepted the request but denied it because the project is out of Custom Search quota.",
      suggestedFix:
        "Wait for quota reset or reduce Google usage. Brave should remain the primary live-web provider.",
      googleMessage: parsed.message,
      googleReason: parsed.reason,
      googleDomain: parsed.domain,
      googleLocation: parsed.location,
    };
  }

  return {
    code:
      status === 403
        ? "google_cse_forbidden"
        : `google_cse_failed_status_${status}`,
    permanent: status === 403,
    explanation:
      "Google rejected the request, but the error does not match one of the known Custom Search failure patterns yet.",
    suggestedFix:
      "Check the raw Google message, confirm the API key and search engine ID belong to the same project, and verify API/key restrictions.",
    googleMessage: parsed.message,
    googleReason: parsed.reason,
    googleDomain: parsed.domain,
    googleLocation: parsed.location,
  };
}

async function getGoogleCseSkipReason(
  apiKey: string,
  engineId: string
): Promise<string | null> {
  if (googleCseDisabledReason) {
    return googleCseDisabledReason;
  }

  if (googleCseAvailable) {
    return null;
  }

  if (!googleCseProbePromise) {
    googleCseProbePromise = (async () => {
    const searchParams = new URLSearchParams({
        key: apiKey,
        cx: engineId,
        q: "test",
        num: "1",
        gl: "us",
        hl: "en",
      });

      try {
        const response = await fetch(
          `https://customsearch.googleapis.com/customsearch/v1?${searchParams.toString()}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(GOOGLE_CSE_TIMEOUT_MS),
          }
        );

        if (response.ok) {
          googleCseAvailable = true;
          return null;
        }

        const errorText = await response.text().catch(() => "");
        const description = describeGoogleCseFailure(
          response.status,
          errorText
        );
        const reason = description.permanent
          ? description.code
          : `google_cse_probe_failed_status_${response.status}`;

        if (description.permanent) {
          googleCseDisabledReason = description.code;
          googleCseDisabledExplanation = description.explanation;
          googleCseDisabledSuggestedFix = description.suggestedFix;
        }

        console.warn("[product-search] Google CSE unavailable", {
          reason,
          status: response.status,
          explanation: description.explanation,
          suggestedFix: description.suggestedFix,
          googleMessage: description.googleMessage,
          googleReason: description.googleReason,
          googleDomain: description.googleDomain,
          googleLocation: description.googleLocation,
          config: summarizeGoogleCseConfig(apiKey, engineId),
          body: errorText.slice(0, 240),
        });

        return reason;
      } catch (error) {
        const reason = `google_cse_probe_failed_${error instanceof Error ? error.name : typeof error
          }`;
        console.warn("[product-search] Google CSE unavailable", { reason });
        return reason;
      }
    })();
  }

  const skipReason = await googleCseProbePromise;

  if (!googleCseAvailable && !googleCseDisabledReason) {
    googleCseProbePromise = null;
  }

  return skipReason;
}

const CONFLICTING_CATEGORY_TERMS: Record<string, string[]> = {
  tops: ["jacket", "coat", "parka", "blazer", "overshirt", "bomber", "anorak"],
  pants: ["pattern", "fabric", "template"],
  shoes: ["pattern", "fabric", "template"],
  outerwear: ["pattern", "fabric", "template"],
  accessories: ["pattern", "fabric", "template"],
};

const INTENT_STOP_WORDS = new Set([
  "and",
  "are",
  "buy",
  "for",
  "from",
  "fashion",
  "men",
  "mens",
  "more",
  "page",
  "pair",
  "product",
  "shop",
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

const WEAK_DESCRIPTOR_TERMS = new Set(["dark", "light", "men", "mens", "mid"]);

const SEARCH_TERM_ALIASES: Record<string, string[]> = {
  "chain necklace": ["chain necklace", "chain necklaces"],
  "corduroy pants": [
    "corduroy pants",
    "corduroy pant",
    "corduroy trousers",
    "corduroy trouser",
  ],
  charcoal: ["charcoal", "dark gray", "dark grey"],
  dark: ["dark", "black", "charcoal", "navy", "dark gray", "dark grey"],
  "dark gray": ["dark gray", "dark grey", "charcoal"],
  "dark grey": ["dark grey", "dark gray", "charcoal"],
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
  "white sole": ["white sole", "white soles"],
  gray: ["gray", "grey"],
  grey: ["grey", "gray"],
  jacket: ["jacket", "jackets"],
  jackets: ["jacket", "jackets"],
  necklace: ["necklace", "necklaces"],
  necklaces: ["necklace", "necklaces"],
  pant: ["pants", "pant", "trouser", "trousers"],
  pants: ["pants", "pant", "trouser", "trousers"],
  sneaker: ["sneaker", "sneakers", "trainer", "trainers"],
  sneakers: ["sneaker", "sneakers", "trainer", "trainers"],
  trainer: ["sneaker", "sneakers", "trainer", "trainers"],
  trainers: ["sneaker", "sneakers", "trainer", "trainers"],
  trouser: ["pants", "pant", "trouser", "trousers"],
  trousers: ["pants", "pant", "trouser", "trousers"],
};

const IMPORTANT_DESCRIPTOR_TERMS = [
  "dark grey",
  "dark gray",
  "dark",
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
  "gold",
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
  "medium",
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
  "dark",
  "dark olive",
  "dark wash",
  "charcoal",
  "black",
  "grey",
  "gray",
  "olive",
  "indigo",
  "gold",
  "silver",
  "white",
  "navy",
  "brown",
  "cream",
]);

const FIT_DESCRIPTOR_CONFLICTS: Record<string, string[]> = {
  straight: ["skinny", "slim", "wide", "flared", "bootcut", "relaxed", "loose"],
  skinny: ["straight", "wide", "flared", "relaxed", "loose"],
  slim: ["wide", "flared", "relaxed", "loose"],
  tapered: ["wide", "flared", "bootcut"],
  wide: ["skinny", "slim", "straight", "tapered"],
  flared: ["skinny", "slim", "straight", "tapered"],
  relaxed: ["skinny", "slim"],
  loose: ["skinny", "slim"],
};

const MATERIAL_DESCRIPTOR_CONFLICTS: Record<string, string[]> = {
  denim: ["cotton twill", "leather", "nylon", "wool", "suede", "canvas"],
  leather: ["denim", "canvas", "nylon", "wool"],
  wool: ["denim", "leather", "nylon", "canvas"],
  nylon: ["denim", "leather", "wool", "suede"],
  suede: ["denim", "canvas", "nylon"],
};

const SCALE_DESCRIPTOR_CONFLICTS: Record<string, string[]> = {
  thin: ["medium", "chunky", "oversized"],
  medium: ["thin", "chunky", "oversized"],
  chunky: ["thin", "medium", "delicate"],
  delicate: ["chunky", "oversized"],
};

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

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForIntent(value: string): Set<string> {
  return new Set(
    normalizeSearchText(value)
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );
}

function containsSearchTerm(value: string, term: string): boolean {
  const normalizedValue = ` ${normalizeSearchText(value)} `;
  const normalizedTerm = normalizeSearchText(term);
  return normalizedTerm ? normalizedValue.includes(` ${normalizedTerm} `) : false;
}

function containsSearchTermWithAliases(value: string, term: string): boolean {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) {
    return false;
  }

  const aliases = SEARCH_TERM_ALIASES[normalizedTerm] || [normalizedTerm];
  return aliases.some((alias) => containsSearchTerm(value, alias));
}

function hasAnySearchTerm(value: string, terms: string[]): boolean {
  return terms.some((term) => containsSearchTermWithAliases(value, term));
}

function getNonWearableProductReason(value: string): string | null {
  for (const pattern of NON_WEARABLE_PRODUCT_PATTERNS) {
    if (pattern.test(value)) {
      return "non_wearable_pattern_or_material";
    }
  }

  return null;
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
    return [...BLOCKED_HOST_SNIPPETS, ...EDITORIAL_HOST_SNIPPETS].some(
      (snippet) => hostname.includes(snippet)
    );
  } catch {
    return true;
  }
}

function hasRetailerHost(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return RETAILER_HOST_SNIPPETS.some((snippet) => hostname.includes(snippet));
  } catch {
    return false;
  }
}

function hasKnownFetchBlockedHost(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return FETCH_BLOCKED_HOST_SNIPPETS.some((snippet) =>
      hostname.includes(snippet)
    );
  } catch {
    return false;
  }
}

function getCandidateHostname(value: string): string {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function hasSearchLikePath(value: string): boolean {
  try {
    const url = new URL(value);
    const pathname = url.pathname.toLowerCase();
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments.at(-1) || "";
    const hasProductPathSignal = PRODUCT_PATH_SNIPPETS.some((snippet) =>
      pathname.includes(snippet)
    );
    const listingPathSignal =
      pathname.endsWith(".zso") ||
      pathname.startsWith("/s/") ||
      DISCOVERY_LISTING_PATH_SNIPPETS.some((snippet) =>
        pathname.includes(snippet)
      );

    return (
      pathname === "/" ||
      pathname.startsWith("/search") ||
      pathname.includes("/search/") ||
      (pathname.includes("/shopping/") && pathname.endsWith("/items.aspx")) ||
      ((segments.includes("men") || segments.includes("mens")) &&
        LISTING_SEGMENT_PATTERN.test(lastSegment) &&
        !hasProductPathSignal) ||
      (!hasProductPathSignal && listingPathSignal) ||
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

function isDiscoveryListingPath(value: string): boolean {
  try {
    const url = new URL(value);
    const pathname = url.pathname.toLowerCase();
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments.at(-1) || "";

    if (
      pathname === "/" ||
      pathname === "/shop" ||
      pathname === "/shop/" ||
      pathname.startsWith("/search") ||
      pathname.includes("/search/") ||
      url.searchParams.has("q") ||
      url.searchParams.has("query") ||
      url.searchParams.has("search") ||
      hasProductLikePath(value)
    ) {
      return false;
    }

    return (
      pathname.endsWith(".zso") ||
      pathname.startsWith("/s/") ||
      (pathname.includes("/shopping/") && pathname.endsWith("/items.aspx")) ||
      DISCOVERY_LISTING_PATH_SNIPPETS.some((snippet) =>
        pathname.includes(snippet)
      ) ||
      ((segments.includes("men") || segments.includes("mens")) &&
        LISTING_SEGMENT_PATTERN.test(lastSegment))
    );
  } catch {
    return false;
  }
}

function hasEditorialPath(value: string): boolean {
  try {
    if (hasProductLikePath(value)) {
      return false;
    }

    const pathname = new URL(value).pathname.toLowerCase();
    return (
      EDITORIAL_PATH_SNIPPETS.some((snippet) => pathname.includes(snippet)) ||
      /(?:^|[-/])(best|blog|editorial|guide|guides|magazine|recommendations|review|reviews|shopping-guides|style|story|stories|where-to-buy)(?:[-/]|$)/.test(
        pathname
      )
    );
  } catch {
    return true;
  }
}

function hasProductLikePath(value: string): boolean {
  try {
    const url = new URL(value);
    const pathname = url.pathname.toLowerCase();
    return (
      PRODUCT_PATH_SNIPPETS.some((snippet) => pathname.includes(snippet)) ||
      hasRetailProductSlugPathSignal(url)
    );
  } catch {
    return false;
  }
}

function hasRetailProductSlugPathSignal(url: URL): boolean {
  const value = url.toString();
  if (!hasRetailerHost(value)) {
    return false;
  }

  const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
  const lastSegment = segments.at(-1) || "";
  if (!lastSegment || LISTING_SEGMENT_PATTERN.test(lastSegment)) {
    return false;
  }

  const normalizedPath = normalizeSearchText(url.pathname);
  const productTermSignal = [
    "anorak",
    "beanie",
    "blazer",
    "boot",
    "cap",
    "chain",
    "chino",
    "coat",
    "denim",
    "hat",
    "jacket",
    "jean",
    "jeans",
    "necklace",
    "pant",
    "pants",
    "ring",
    "shirt",
    "sneaker",
    "sock",
    "socks",
    "sweater",
    "tee",
    "trouser",
    "trousers",
  ].some((term) => containsSearchTerm(normalizedPath, term));
  const skuSignal =
    lastSegment
      .split(/[-_]/)
      .some((part) => /[a-z]/.test(part) && /\d/.test(part) && part.length >= 5) ||
    /(?:^|[-_])(?:[a-z]{1,5}\d{3,}|\d{4,}|[a-z0-9]*\d{3,}[a-z0-9]*)(?:$|[-_])/.test(
      lastSegment
    );
  const descriptiveSlugSignal = lastSegment.split(/[-_]/).length >= 3;

  return productTermSignal && skuSignal && descriptiveSlugSignal;
}

function hasUnavailableSignal(html: string, title: string | null): boolean {
  const titleText = title?.toLowerCase() || "";
  const textSample = html.slice(0, 80_000).toLowerCase();

  return (
    /\b(404|page not found|product not found|not available|no longer available|does not exist|we can't find|we could not find)\b/.test(titleText) ||
    /\b(page not found|product not found|this product is no longer available|this item is no longer available|sorry, we can't find|sorry, we could not find|does not exist)\b/.test(textSample)
  );
}

function hasBadProductTitleSignal(title: string | null): boolean {
  const normalized = normalizeSearchText(title || "");
  return (
    normalized === "flyouterror" ||
    normalized === "robot check" ||
    normalized === "captcha" ||
    normalized === "access denied" ||
    normalized === "forbidden" ||
    normalized === "request blocked"
  );
}

function hasEditorialTitleSignal(title: string | null): boolean {
  const normalized = normalizeSearchText(title || "");
  return (
    Boolean(normalized) &&
    (normalized.includes(" the journal ") ||
      normalized.endsWith(" the journal") ||
      /\b(?:how|ways?|what|when)\s+to\s+wear\b/.test(normalized) ||
      /\b(?:style|shopping|gift|trend)\s+guide\b/.test(normalized) ||
      /\b(?:review|reviews|editorial|magazine|article)\b/.test(normalized))
  );
}

function truncateSearchQuery(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
  return truncated || normalized.slice(0, maxLength).trim();
}

function buildProductDiscoveryQuery(query: SearchQuery): string {
  return buildProductDiscoveryQueries(query)[0];
}

function buildProductDiscoveryQueries(query: SearchQuery): string[] {
  const intentNegativeOperators = uniqueSearchTerms(query.avoidTerms)
    .filter((term) => /^[a-z0-9\s-]+$/i.test(term))
    .slice(0, 4)
    .map((term) => `-${term.replace(/\s+/g, "-")}`);
  const negativeOperators = [
    "-site:pinterest.com",
    "-site:instagram.com",
    "-site:facebook.com",
    "-site:tiktok.com",
    "-site:youtube.com",
    "-site:reddit.com",
    "-site:x.com",
    "-site:twitter.com",
    "-site:yelp.com",
    "-blog",
    "-best",
    "-crochet",
    "-diy",
    "-guide",
    "-knitting",
    "-pattern",
    "-pdf",
    "-tutorial",
    ...intentNegativeOperators,
  ].join(" ");
  const productType = query.productType || query.categoryHint;
  const baseSuffix = negativeOperators;
  const buySuffix = `buy online ${negativeOperators}`;
  const intentMaxLength = Math.max(
    80,
    BRAVE_SEARCH_QUERY_MAX_LENGTH - buySuffix.length - 1
  );
  const intent = truncateSearchQuery(query.text, intentMaxLength);
  const queries = [
    truncateSearchQuery(
      `${intent} ${baseSuffix}`,
      BRAVE_SEARCH_QUERY_MAX_LENGTH
    ),
    truncateSearchQuery(
      `${intent} ${buySuffix}`,
      BRAVE_SEARCH_QUERY_MAX_LENGTH
    ),
  ];

  const retailerSiteOperators =
    RETAILER_SITE_OPERATORS_BY_CATEGORY[query.categoryHint] || [];
  if (!query.alternateQuery && retailerSiteOperators.length > 0) {
    for (const siteOperator of retailerSiteOperators.slice(
      0,
      RETAILER_SITE_QUERY_LIMIT
    )) {
      queries.push(
        truncateSearchQuery(
          `${query.text} ${siteOperator}`,
          BRAVE_SEARCH_QUERY_MAX_LENGTH
        )
      );
    }

    for (const siteOperator of MARKETPLACE_SITE_OPERATORS.slice(
      0,
      MARKETPLACE_SITE_QUERY_LIMIT
    )) {
      queries.push(
        truncateSearchQuery(
          `${query.text} ${siteOperator} ${negativeOperators}`,
          BRAVE_SEARCH_QUERY_MAX_LENGTH
        )
      );
    }

    for (const productPathOperator of PRODUCT_PATH_QUERY_OPERATORS) {
      queries.push(
        truncateSearchQuery(
          `${query.text} ${productType} ${productPathOperator} ${negativeOperators}`,
          BRAVE_SEARCH_QUERY_MAX_LENGTH
        )
      );
    }
  }

  return queries;
}

function parseBudgetCap(budget?: string): number | null {
  if (!budget) {
    return null;
  }

  const numeric = Number.parseInt(budget.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeCategoryHint(value: string): string | null {
  for (const category of CATEGORY_DETECTION_ORDER) {
    const terms = CATEGORY_MATCH_TERMS[category] || [];
    if (hasAnySearchTerm(value, terms)) {
      return category;
    }
  }

  return null;
}

function inferCategoryHint(value: string): string {
  const lowered = value.toLowerCase();
  const directCategory = normalizeCategoryHint(value);

  if (directCategory) {
    return directCategory;
  }

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => containsSearchTerm(lowered, keyword))) {
      return category;
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

function inferReplacementCategoriesFromTexts(values: string[]): Set<string> {
  return inferCategoriesFromTexts(values.filter(hasReplacementIntent));
}

function hasReplacementIntent(value: string): boolean {
  return /\b(replace|replacement|swap|upgrade|better|sharper|sleeker|streamline|refine|improve|tailor|tailored|fix|missing|add|needs?|should)\b/i.test(value);
}

function getCategoryIntentTokens(category: string): Set<string> {
  return new Set(
    [
      category,
      ...(CATEGORY_MATCH_TERMS[category] || []),
      ...(CATEGORY_KEYWORDS[category] || []),
    ].flatMap((term) => Array.from(tokenizeForIntent(term)))
  );
}

function getIntentDescriptorTokens(intentText: string, category: string): string[] {
  const categoryTokens = getCategoryIntentTokens(category);

  return Array.from(tokenizeForIntent(intentText)).filter(
    (token) => !INTENT_STOP_WORDS.has(token) && !categoryTokens.has(token)
  );
}

function getImportantStructuredDescriptorTerms(candidate: ProductCandidate): string[] {
  const profilePreferenceTerms = getStyleProfilePreferenceTerms(
    candidate.styleProfile
  );
  const intentText = `${candidate.intentText} ${candidate.optionalTerms.join(" ")} ${profilePreferenceTerms.join(" ")}`;
  const identityTerms = new Set(
    uniqueSearchTerms([
      candidate.productType || "",
      ...candidate.requiredTerms,
    ]).map((term) => normalizeSearchText(term))
  );
  const knownDescriptorTerms = IMPORTANT_DESCRIPTOR_TERMS.filter((term) =>
    containsSearchTermWithAliases(intentText, term)
  );
  const softRequiredTerms = getSoftIdentitySearchTerms(candidate.requiredTerms);
  const optionalDescriptorTerms = candidate.optionalTerms.filter((term) => {
    const normalized = normalizeSearchText(term);
    return (
      normalized &&
      !identityTerms.has(normalized) &&
      !GENERIC_IDENTITY_TERMS.has(normalized) &&
      !WEAK_DESCRIPTOR_TERMS.has(normalized)
    );
  });

  return uniqueSearchTerms([
    ...knownDescriptorTerms,
    ...profilePreferenceTerms,
    ...softRequiredTerms,
    ...optionalDescriptorTerms,
  ]);
}

function getMissingSearchTerms(value: string, terms: string[]): string[] {
  const matched = new Set(
    getMatchedSearchTerms(value, terms).map((term) => normalizeSearchText(term))
  );

  return uniqueSearchTerms(terms).filter(
    (term) => !matched.has(normalizeSearchText(term))
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
  const requiredMatchCount =
    preferenceTerms.length === 1
      ? 1
      : Math.min(3, Math.max(2, Math.ceil(preferenceTerms.length * 0.5)));

  if (
    matchedPreferenceTerms.length >= requiredMatchCount &&
    (!hasColorPreference || hasColorMatch)
  ) {
    return "exact";
  }

  return "near";
}

function getMatchedConflictingDescriptorTerms(
  productText: string,
  titleText: string,
  preferenceTerms: string[]
): string[] {
  const conflicts: string[] = [];
  const normalizedPreferenceTerms = uniqueSearchTerms(preferenceTerms).map((term) =>
    normalizeSearchText(term)
  );
  const expectedColorTerms = normalizedPreferenceTerms.filter((term) =>
    COLOR_DESCRIPTOR_TERMS.has(term)
  );
  const matchedExpectedColor = expectedColorTerms.some((term) =>
    containsSearchTermWithAliases(productText, term)
  );

  if (!matchedExpectedColor && expectedColorTerms.length > 0) {
    for (const color of COLOR_DESCRIPTOR_TERMS) {
      if (
        !expectedColorTerms.includes(color) &&
        containsSearchTermWithAliases(titleText, color)
      ) {
        conflicts.push(color);
      }
    }
  }

  for (const expectedTerm of normalizedPreferenceTerms) {
    const conflictTerms = [
      ...(FIT_DESCRIPTOR_CONFLICTS[expectedTerm] || []),
      ...(MATERIAL_DESCRIPTOR_CONFLICTS[expectedTerm] || []),
      ...(SCALE_DESCRIPTOR_CONFLICTS[expectedTerm] || []),
    ];

    if (
      conflictTerms.length === 0 ||
      containsSearchTermWithAliases(productText, expectedTerm)
    ) {
      continue;
    }

    conflicts.push(
      ...conflictTerms.filter((term) =>
        containsSearchTermWithAliases(titleText, term)
      )
    );
  }

  return uniqueSearchTerms(conflicts);
}

function evaluateProductIntentMatch({
  candidate,
  title,
  brand,
  retailer,
  canonicalUrl,
}: {
  candidate: ProductCandidate;
  title: string;
  brand: string | null;
  retailer: string;
  canonicalUrl: string;
}): ProductCandidateIntentMatch {
  const expectedCategory =
    normalizeCategoryHint(candidate.categoryHint) || candidate.categoryHint.toLowerCase();
  const productText = `${title} ${brand || ""} ${retailer} ${canonicalUrl}`;
  const titleText = `${title} ${brand || ""}`;
  const nonWearableReason = getNonWearableProductReason(productText);

  if (nonWearableReason) {
    return {
      quality: "reject",
      reason: nonWearableReason,
      matchedDescriptors: [],
      descriptorTokens: [],
    };
  }

  const expectedCategoryTerms = CATEGORY_MATCH_TERMS[expectedCategory] || [];
  if (
    expectedCategoryTerms.length > 0 &&
    !hasAnySearchTerm(productText, expectedCategoryTerms)
  ) {
    return {
      quality: "reject",
      reason: "intent_category_mismatch",
      matchedDescriptors: [],
      descriptorTokens: getIntentDescriptorTokens(
        candidate.intentText,
        expectedCategory
      ),
    };
  }

  const conflictingTerms = CONFLICTING_CATEGORY_TERMS[expectedCategory] || [];
  if (
    conflictingTerms.length > 0 &&
    hasAnySearchTerm(titleText, conflictingTerms) &&
    !hasAnySearchTerm(candidate.intentText, conflictingTerms)
  ) {
    return {
      quality: "reject",
      reason: "conflicting_product_type",
      matchedDescriptors: [],
      descriptorTokens: getIntentDescriptorTokens(
        candidate.intentText,
        expectedCategory
      ),
    };
  }

  const matchedAvoidTerms = getMatchedSearchTerms(productText, candidate.avoidTerms);
  if (matchedAvoidTerms.length > 0) {
    return {
      quality: "reject",
      reason: "matched_structured_avoid_term",
      matchedDescriptors: matchedAvoidTerms,
      descriptorTokens: uniqueSearchTerms(candidate.avoidTerms),
    };
  }

  if (candidate.querySource === "shopping-intent") {
    const productTypeTerms = uniqueSearchTerms([candidate.productType || ""]);
    const matchedProductTypeTerms = getMatchedSearchTerms(
      productText,
      productTypeTerms
    );
    if (productTypeTerms.length > 0 && matchedProductTypeTerms.length === 0) {
      return {
        quality: "reject",
        reason: "missing_structured_product_type",
        matchedDescriptors: matchedProductTypeTerms,
        descriptorTokens: productTypeTerms.slice(0, 12),
      };
    }

    const rawRequiredTerms = uniqueSearchTerms(candidate.requiredTerms);
    const requiredTerms = getHardIdentitySearchTerms(candidate.requiredTerms);
    const matchedRequiredTerms = getMatchedSearchTerms(productText, requiredTerms);
    const missingRequiredTerms = getMissingSearchTerms(productText, requiredTerms);
    if (requiredTerms.length > 0 && missingRequiredTerms.length > 0) {
      return {
        quality: "reject",
        reason: "missing_structured_required_terms",
        matchedDescriptors: matchedRequiredTerms,
        descriptorTokens: missingRequiredTerms.slice(0, 12),
      };
    }

    const importantDescriptorTerms =
      getImportantStructuredDescriptorTerms(candidate);
    const matchedImportantDescriptorTerms = getMatchedSearchTerms(
      productText,
      importantDescriptorTerms
    );
    const missingPreferences = getMissingSearchTerms(
      productText,
      importantDescriptorTerms
    );
    const matchedConflictingDescriptorTerms =
      getMatchedConflictingDescriptorTerms(
        productText,
        titleText,
        importantDescriptorTerms
      );

    if (matchedConflictingDescriptorTerms.length > 0) {
      return {
        quality: "reject",
        reason: "conflicting_structured_preferences",
        matchedDescriptors: matchedConflictingDescriptorTerms,
        descriptorTokens: importantDescriptorTerms,
      };
    }

    if (
      importantDescriptorTerms.length >= 2 &&
      matchedImportantDescriptorTerms.length === 0
    ) {
      return {
        quality: "reject",
        reason: "missing_structured_preferences",
        matchedDescriptors: matchedImportantDescriptorTerms,
        descriptorTokens: importantDescriptorTerms,
      };
    }

    const quality = getPreferenceMatchQuality({
      preferenceTerms: importantDescriptorTerms,
      matchedPreferenceTerms: matchedImportantDescriptorTerms,
    });
    const matchReasons = [
      ...(matchedProductTypeTerms.length > 0
        ? [`identity:${matchedProductTypeTerms.join(", ")}`]
        : []),
      ...(matchedRequiredTerms.length > 0
        ? [`required:${matchedRequiredTerms.join(", ")}`]
        : []),
      ...(rawRequiredTerms.length > requiredTerms.length
        ? [
          `soft_required:${getSoftIdentitySearchTerms(
            candidate.requiredTerms
          ).join(", ")}`,
        ]
        : []),
      ...(matchedImportantDescriptorTerms.length > 0
        ? [`preferences:${matchedImportantDescriptorTerms.join(", ")}`]
        : []),
    ];

    if (
      importantDescriptorTerms.length > 0 &&
      matchedImportantDescriptorTerms.length === 0
    ) {
      matchReasons.push("identity_match_without_preference_match");
    }

    return {
      quality,
      matchReasons,
      missingPreferences,
      matchedDescriptors: matchedImportantDescriptorTerms,
      descriptorTokens: importantDescriptorTerms,
    };
  }

  const descriptorTokens = getIntentDescriptorTokens(
    candidate.intentText,
    expectedCategory
  );
  const matchedDescriptors = descriptorTokens.filter((token) =>
    containsSearchTerm(productText, token)
  );

  if (descriptorTokens.length > 0 && matchedDescriptors.length === 0) {
    return {
      quality: "reject",
      reason: "missing_intent_descriptors",
      matchedDescriptors,
      descriptorTokens,
    };
  }

  return {
    quality: "exact",
    matchReasons:
      matchedDescriptors.length > 0
        ? [`descriptors:${matchedDescriptors.join(", ")}`]
        : ["legacy_intent_match"],
    missingPreferences: [],
    matchedDescriptors,
    descriptorTokens,
  };
}

function buildMensSearchPhrase(
  terms: Array<string | undefined>,
  productType: string
): string {
  const productTypeKey = normalizeSearchText(productType);
  const seen = new Set<string>();
  const uniqueTerms = terms.filter((term): term is string => {
    const normalized = cleanText(term);
    const key = normalizeSearchText(normalized || "");
    if (!normalized || !key || key === productTypeKey || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  return ["men's", ...uniqueTerms, productType]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function addDescriptorTermsToSearchPhrase(
  base: string,
  descriptorTerms: string[],
  productType: string
): string {
  const normalizedBase = cleanText(base);
  const uniqueDescriptorTerms = uniqueSearchTerms(descriptorTerms).filter(
    (term) => !containsSearchTermWithAliases(normalizedBase || "", term)
  );

  if (!normalizedBase || uniqueDescriptorTerms.length === 0) {
    return normalizedBase || "";
  }

  const descriptorText = uniqueDescriptorTerms.join(" ");
  const productTypePattern = escapeRegex(productType.trim()).replace(/\s+/g, "\\s+");
  const productTypeAtEnd = new RegExp(`\\b${productTypePattern}\\b\\s*$`, "i");
  const productTypeMatch = normalizedBase.match(productTypeAtEnd);

  if (!productTypeMatch || typeof productTypeMatch.index !== "number") {
    return `${normalizedBase} ${descriptorText}`.replace(/\s+/g, " ").trim();
  }

  return [
    normalizedBase.slice(0, productTypeMatch.index).trim(),
    descriptorText,
    normalizedBase.slice(productTypeMatch.index).trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getOptionalSearchDescriptorTerms(intent: ShoppingIntent): string[] {
  const identityTerms = new Set(
    uniqueSearchTerms([intent.product_type, ...intent.required_terms]).map((term) =>
      normalizeSearchText(term)
    )
  );

  return uniqueSearchTerms([
    ...getStyleProfilePreferenceTerms(intent.style_profile),
    ...intent.optional_terms,
  ]).filter((term) => {
    const normalized = normalizeSearchText(term);
    return (
      normalized &&
      !identityTerms.has(normalized) &&
      !GENERIC_IDENTITY_TERMS.has(normalized) &&
      !WEAK_DESCRIPTOR_TERMS.has(normalized)
    );
  });
}

function buildIntentSearchPhrase(intent: ShoppingIntent): string {
  const base = buildStyleProfileSearchPhrase(intent) || intent.search_query;
  const missingDescriptorTerms = getOptionalSearchDescriptorTerms(intent).filter(
    (term) => !containsSearchTermWithAliases(base, term)
  );

  if (missingDescriptorTerms.length === 0) {
    return base;
  }

  return addDescriptorTermsToSearchPhrase(
    base,
    missingDescriptorTerms.slice(0, 3),
    intent.product_type
  );
}

function getProfileMaterialForSearch(intent: ShoppingIntent): string | undefined {
  const material = intent.style_profile?.material;
  if (!material) {
    return undefined;
  }

  const productType = normalizeSearchText(intent.product_type);
  if (productType.includes("jean") && material === "denim") {
    return undefined;
  }

  return material;
}

function getStyleProfileAvoidTerms(
  profile: ShoppingStyleProfile | undefined
): string[] {
  return uniqueSearchTerms(
    (profile?.avoid_finish || []).flatMap((finish) =>
      finish === "distressed" ? ["distressed", "ripped", "rips"] : [finish]
    )
  );
}

function buildDerivedIntentSearchQueries(intent: ShoppingIntent): string[] {
  const profile = intent.style_profile || {};
  const material = getProfileMaterialForSearch(intent);
  const shape = profile.leg && profile.leg !== profile.fit ? profile.leg : profile.fit;
  const silhouette = profile.silhouette;
  const scale = profile.scale;
  const optionalSearchTerms = getOptionalSearchDescriptorTerms(intent).slice(0, 3);
  const primary = buildIntentSearchPhrase(intent);
  const queries = [
    primary,
    buildMensSearchPhrase(
      [profile.color, shape, material, silhouette, scale, ...optionalSearchTerms],
      intent.product_type
    ),
    buildMensSearchPhrase(
      [profile.color, material, silhouette, scale, ...optionalSearchTerms],
      intent.product_type
    ),
    buildMensSearchPhrase(
      [shape, material, silhouette, scale, ...optionalSearchTerms],
      intent.product_type
    ),
    intent.search_query,
  ];

  return uniqueSearchTerms(queries);
}

function buildSearchQueries(
  shoppingQueries: string[],
  shoppingIntents: ShoppingIntent[],
  categories: string[],
  missingPieces: string[],
  budget?: string,
  whatWorks: string[] = [],
  whatToFix: string[] = []
): SearchQuery[] {
  const queries: SearchQuery[] = [];
  const seen = new Set<string>();
  const budgetSuffix = budget ? ` ${budget}` : "";
  const protectedCategories = inferCategoriesFromTexts(whatWorks);
  const allowedProtectedCategories = new Set([
    ...inferCategoriesFromTexts(missingPieces),
    ...inferReplacementCategoriesFromTexts(whatToFix),
  ]);
  const alignedCategories = categories.map((category) =>
    normalizeCategoryHint(category) || undefined
  );
  const queryCountsByCategory = new Map<string, number>();

  const addQuery = (
    value: string,
    categoryHint?: string,
    source: SearchQuerySource = "shopping-query",
    sourceIndex = 0,
    intent?: ShoppingIntent,
    alternateQuery = false
  ) => {
    const rawNormalized = cleanText(value);
    const normalized =
      source === "shopping-intent" ? normalizeMensSearchQuery(rawNormalized || "") : rawNormalized;
    if (!normalized) {
      return;
    }

    const inferredCategory =
      normalizeCategoryHint(normalized) || categoryHint || inferCategoryHint(normalized);
    const shouldAvoidProtectedCategory =
      protectedCategories.has(inferredCategory) &&
      !allowedProtectedCategories.has(inferredCategory);

    if (shouldAvoidProtectedCategory) {
      console.log("[product-search] Skipped protected search query", {
        source,
        sourceIndex,
        category: inferredCategory,
        text: normalized.slice(0, 120),
        protectedCategories: Array.from(protectedCategories),
        allowedProtectedCategories: Array.from(allowedProtectedCategories),
      });
      return;
    }

    const categoryQueryCount = queryCountsByCategory.get(inferredCategory) || 0;
    const maxQueriesPerCategory = source === "shopping-intent" ? 6 : 3;
    if (categoryQueryCount >= maxQueriesPerCategory) {
      console.log("[product-search] Skipped repeated category search query", {
        source,
        sourceIndex,
        category: inferredCategory,
        categoryQueryCount,
        maxQueriesPerCategory,
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
      source,
      sourceIndex,
      intentId: intent?.id,
      productType: intent?.product_type,
      displayLabel: intent?.display_label,
      reason: intent?.reason,
      requiredTerms: uniqueSearchTerms(intent?.required_terms || []),
      optionalTerms: uniqueSearchTerms(intent?.optional_terms || []),
      styleProfile: intent?.style_profile,
      avoidTerms: uniqueSearchTerms([
        ...getStyleProfileAvoidTerms(intent?.style_profile),
        ...(intent?.avoid_terms || []),
      ]),
      replacesVisibleItem: intent?.replaces_visible_item,
      alternateQuery,
    });
  };

  if (shoppingIntents.length > 0) {
    const sortedIntents = [...shoppingIntents].sort(
      (left, right) => (left.priority || 0) - (right.priority || 0)
    );

    for (const [index, intent] of sortedIntents.slice(0, MAX_SEARCH_QUERIES).entries()) {
      addQuery(
        buildIntentSearchPhrase(intent),
        intent.category,
        "shopping-intent",
        index,
        intent,
        false
      );
    }

    for (const [index, intent] of sortedIntents.entries()) {
      if (queries.length >= MAX_SEARCH_QUERIES) {
        break;
      }

      for (const derivedQuery of buildDerivedIntentSearchQueries(intent).slice(1)) {
        if (queries.length >= MAX_SEARCH_QUERIES) {
          break;
        }

        addQuery(
          derivedQuery,
          intent.category,
          "shopping-intent",
          index,
          intent,
          true
        );
      }
    }

    for (const [index, intent] of sortedIntents.entries()) {
      if (queries.length >= MAX_SEARCH_QUERIES) {
        break;
      }

      for (const alternateQuery of (intent.alternate_queries || []).slice(0, 2)) {
        if (queries.length >= MAX_SEARCH_QUERIES) {
          break;
        }

        addQuery(
          alternateQuery,
          intent.category,
          "shopping-intent",
          index,
          intent,
          true
        );
      }
    }

    return queries.slice(0, MAX_SEARCH_QUERIES);
  }

  for (const [index, query] of shoppingQueries.slice(0, MAX_SEARCH_QUERIES).entries()) {
    addQuery(query, alignedCategories[index], "shopping-query", index);
  }

  for (const [index, piece] of missingPieces.slice(0, 4).entries()) {
    if (queries.length >= MAX_SEARCH_QUERIES) {
      break;
    }

    addQuery(piece, alignedCategories[index], "missing-piece", index);
  }

  if (queries.length === 0) {
    for (const [index, category] of categories.slice(0, 3).entries()) {
      const normalizedCategory = normalizeCategoryHint(category) || category.toLowerCase();
      addQuery(
        `${normalizedCategory} fashion product`,
        normalizedCategory,
        "category",
        index,
        undefined
      );
    }
  }

  return queries.slice(0, MAX_SEARCH_QUERIES);
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

function extractLinkHref(html: string, rel: string): string | null {
  const escaped = escapeRegex(rel);
  const patterns = [
    new RegExp(
      `<link[^>]*rel=["'][^"']*${escaped}[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*${escaped}[^"']*["'][^>]*>`,
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
    new RegExp(
      `"(?:${escapedKeys})"\\s*:\\s*"?([0-9][0-9,]*(?:\\.\\d{1,2})?)"?`,
      "i"
    ),
    new RegExp(
      `'(?:${escapedKeys})'\\s*:\\s*'?([0-9][0-9,]*(?:\\.\\d{1,2})?)'?`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const numeric = Number.parseFloat(match[1].replace(/,/g, ""));
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }
  }

  return null;
}

function extractLooseUsdPriceFromHtml(html: string): number | null {
  const sample = decodeHtmlEntities(
    html
      .slice(0, 400_000)
      .replace(/\\u002[fF]/g, "/")
      .replace(/\\"/g, '"')
      .replace(/\\\//g, "/")
  ).replace(/\s+/g, " ");
  const contextualPatterns = [
    /(?:price|sale|current|regular|final|now|product-price|productPrice)[^$]{0,140}\$\s*([1-9][0-9]{1,3}(?:,[0-9]{3})?(?:\.[0-9]{1,2})?)/gi,
    /\$\s*([1-9][0-9]{1,3}(?:,[0-9]{3})?(?:\.[0-9]{1,2})?)[^$]{0,80}(?:price|sale|current|regular|final|now)/gi,
  ];

  for (const pattern of contextualPatterns) {
    for (const match of sample.matchAll(pattern)) {
      const price = extractPrice(match[1]);
      if (price && price >= 5 && price <= 1500) {
        return price;
      }
    }
  }

  const allPrices = Array.from(
    sample.matchAll(/\$\s*([1-9][0-9]{1,3}(?:,[0-9]{3})?(?:\.[0-9]{1,2})?)/g)
  )
    .map((match) => extractPrice(match[1]))
    .filter((price): price is number => Boolean(price && price >= 5 && price <= 1500));

  if (allPrices.length === 0) {
    return null;
  }

  return allPrices.sort((left, right) => left - right)[0];
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

function extractImageFromHtml(html: string, baseUrl: string): string | null {
  const matches = html.matchAll(
    /<img[^>]+(?:src|data-src|data-original|data-image|data-zoom-image)=["']([^"']+)["'][^>]*>/gi
  );

  for (const match of matches) {
    const raw = cleanText(match[1]);
    if (!raw) {
      continue;
    }

    const lower = raw.toLowerCase();
    if (
      lower.startsWith("data:") ||
      lower.endsWith(".svg") ||
      lower.includes("logo") ||
      lower.includes("icon") ||
      lower.includes("sprite") ||
      lower.includes("placeholder") ||
      lower.includes("avatar")
    ) {
      continue;
    }

    const imageUrl = toAbsoluteUrl(raw, baseUrl);
    if (imageUrl) {
      return imageUrl;
    }
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

function extractDescriptionFromHtml(html: string): string | null {
  return (
    extractMetaContent(html, "property", "og:description") ||
    extractMetaContent(html, "name", "twitter:description") ||
    extractMetaContent(html, "name", "description") ||
    extractMetaContent(html, "property", "product:description") ||
    extractItempropContent(html, "description") ||
    extractJsonStringField(html, [
      "description",
      "productDescription",
      "shortDescription",
      "metaDescription",
    ])
  );
}

function hasCommerceSignals(html: string): boolean {
  const textSample = html.slice(0, 150_000).toLowerCase();
  return /\b(add to (?:cart|bag)|buy now|shop pay|size guide|select size|choose size|product details|product description|sku|style #|shipping&returns|pickup)\b/.test(
    textSample
  );
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
    extractMetaContent(html, "property", "og:image:url") ||
    extractMetaContent(html, "property", "og:image");
  const twitterImage =
    extractMetaContent(html, "name", "twitter:image") ||
    extractMetaContent(html, "property", "twitter:image");
  const productImage =
    extractMetaContent(html, "property", "product:image") ||
    extractMetaContent(html, "name", "product:image");
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
  const itempropDescription = extractItempropContent(html, "description");
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
  const description =
    cleanText(String(productNode?.description || "")) ||
    extractDescriptionFromHtml(html) ||
    itempropDescription;
  const imageUrl =
    extractImage(productNode?.image, canonicalUrl) ||
    toAbsoluteUrl(ogImage, canonicalUrl) ||
    toAbsoluteUrl(twitterImage, canonicalUrl) ||
    toAbsoluteUrl(productImage, canonicalUrl) ||
    toAbsoluteUrl(itempropImage, canonicalUrl) ||
    toAbsoluteUrl(extractLinkHref(html, "image_src"), canonicalUrl) ||
    toAbsoluteUrl(
      extractJsonStringField(html, [
        "image",
        "imageUrl",
        "image_url",
        "imageURL",
        "featured_image",
        "featuredImage",
        "primary_image",
        "primaryImage",
        "thumbnail",
        "thumbnailUrl",
      ]),
      canonicalUrl
    ) ||
    extractImageFromHtml(html, canonicalUrl);
  const hasProductUrlSignal =
    hasProductLikePath(canonicalUrl) || hasProductLikePath(candidateUrl);
  const structuredPrice =
    extractPrice(productNode?.offers) ||
    extractPrice(metaPrice) ||
    extractPrice(itempropPrice) ||
    extractJsonPriceField(html, [
      "price",
      "priceValue",
      "salePrice",
      "sale_price",
      "currentPrice",
      "current_price",
      "regularPrice",
      "regular_price",
      "finalPrice",
      "priceAmount",
      "amount",
    ]);
  const price =
    structuredPrice ||
    (hasProductUrlSignal ? extractLooseUsdPriceFromHtml(html) : null);
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
  const commerceSignals = hasCommerceSignals(html);
  const isProduct =
    (hasProductSchema ||
      hasProductMeta ||
      hasProductOgType ||
      hasProductUrlSignal ||
      (Boolean(description) && commerceSignals)) &&
    Boolean(title && imageUrl && price && !hasSearchLikePath(canonicalUrl));

  return {
    canonicalUrl,
    title,
    brand,
    retailer,
    description,
    imageUrl,
    price,
    priceCurrency,
    isProduct,
    ogType,
    hasProductSchema,
    hasProductMeta,
    hasProductUrlSignal,
    hasCommerceSignals: commerceSignals,
  };
}

interface CandidateUrlSanitizeOptions {
  allowDiscoveryPages?: boolean;
}

function sanitizeCandidateUrl(
  value: string,
  options: CandidateUrlSanitizeOptions = {}
): string | null {
  const normalized = normalizeUrl(value);
  if (
    !normalized ||
    hasBlockedHost(normalized) ||
    hasEditorialPath(normalized)
  ) {
    return null;
  }

  if (hasSearchLikePath(normalized)) {
    if (!options.allowDiscoveryPages || !isDiscoveryListingPath(normalized)) {
      return null;
    }
  }

  return normalized;
}

function hasNoisyDiscoveryCandidateSignal({
  url,
  title,
  avoidTerms,
}: {
  url: string;
  title?: string;
  avoidTerms: string[];
}): boolean {
  const candidateText = `${url} ${title || ""}`;
  return (
    Boolean(getNonWearableProductReason(candidateText)) ||
    getMatchedSearchTerms(candidateText, avoidTerms).length > 0
  );
}

function getCandidateKindForUrl(
  value: string
): ProductCandidate["candidateKind"] {
  return isDiscoveryListingPath(value) ? "discovery-page" : "product";
}

function rankCandidateUrl(queryIndex: number, resultIndex: number, url: string): number {
  let rank = queryIndex * 40 + resultIndex;

  if (hasProductLikePath(url)) {
    rank -= 12;
  }

  if (hasRetailerHost(url)) {
    rank -= 8;
  }

  if (hasKnownFetchBlockedHost(url)) {
    rank += 25;
  }

  return Math.max(0, rank);
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

function buildCandidateRejectionLog(
  candidate: ProductCandidate,
  reason: string,
  evidence: ProductCandidateRejectionEvidence = {}
): ProductCandidateRejectionLog {
  const rejection: ProductCandidateRejectionLog = {
    reason,
    provider: candidate.provider,
    url: compactUrlForLog(candidate.url),
    candidateKind: candidate.candidateKind,
    category: candidate.categoryHint,
    querySource: candidate.querySource,
    querySourceIndex: candidate.querySourceIndex,
    intentId: candidate.intentId,
    productType: candidate.productType,
    displayLabel: candidate.displayLabel,
    intentText: candidate.intentText.slice(0, 120),
    rank: candidate.rank,
  };

  if (Object.keys(evidence).length > 0) {
    rejection.evidence = evidence;
  }

  return rejection;
}

function formatRejectionEvidenceValue(
  value: ProductCandidateRejectionEvidenceValue
): string | number | boolean | null {
  return Array.isArray(value) ? value.join(", ") || "none" : value;
}

function summarizeCandidateRejectionForLog(
  rejection: ProductCandidateRejectionLog
) {
  return {
    reason: rejection.reason,
    provider: rejection.provider,
    url: rejection.url,
    candidateKind: rejection.candidateKind,
    category: rejection.category,
    querySource: rejection.querySource,
    querySourceIndex: rejection.querySourceIndex,
    intentId: rejection.intentId,
    productType: rejection.productType,
    displayLabel: rejection.displayLabel,
    intentText: rejection.intentText,
    rank: rejection.rank,
    evidence: rejection.evidence
      ? Object.entries(rejection.evidence)
        .map(
          ([key, value]) => `${key}=${formatRejectionEvidenceValue(value)}`
        )
        .join("; ")
      : undefined,
  };
}

function countBy<T>(values: T[], keyForValue: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const value of values) {
    const key = keyForValue(value);
    counts[key] = (counts[key] || 0) + 1;
  }

  return counts;
}

function uniqueSearchTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const value of values) {
    const normalized = cleanText(value);
    const key = normalizeSearchText(normalized || "");
    if (!normalized || !key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    terms.push(normalized);
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

  return (
    HARD_IDENTITY_PHRASES.find((phrase) =>
      containsSearchTerm(normalized, phrase)
    ) || null
  );
}

function hardIdentityTermContains(term: string | null, descriptor: string): boolean {
  return Boolean(term && containsSearchTerm(term, descriptor));
}

function getSoftTermsFromRequiredTerm(term: string): string[] {
  const normalized = normalizeSearchText(term);
  if (!normalized) {
    return [];
  }

  const hardIdentityTerm = getEmbeddedHardIdentityTerm(term);
  const descriptorTerms = IMPORTANT_DESCRIPTOR_TERMS.filter(
    (descriptor) =>
      containsSearchTerm(normalized, descriptor) &&
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
    return uniqueSearchTerms([term, ...descriptorTerms, ...tokenTerms]);
  }

  return uniqueSearchTerms([...descriptorTerms, ...tokenTerms]);
}

function getHardIdentitySearchTerms(values: string[]): string[] {
  return uniqueSearchTerms(
    uniqueSearchTerms(values)
      .filter(isHardIdentityTerm)
      .map((term) => getEmbeddedHardIdentityTerm(term) || term)
  );
}

function getSoftIdentitySearchTerms(values: string[]): string[] {
  return uniqueSearchTerms(values).flatMap(getSoftTermsFromRequiredTerm);
}

function getMatchedSearchTerms(value: string, terms: string[]): string[] {
  return uniqueSearchTerms(terms).filter((term) =>
    containsSearchTermWithAliases(value, term)
  );
}

function extractJsonArrayText(value: string): string | null {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  const text = (fencedMatch?.[1] || value)
    .replace(/^```[a-zA-Z]*\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = text.indexOf("[");

  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
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

  if (hasBadProductTitleSignal(title)) {
    return "bad_product_title";
  }

  if (hasEditorialTitleSignal(title)) {
    return "editorial_title";
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
    !metadata.hasProductUrlSignal &&
    !hasProductLikePath(metadata.canonicalUrl) &&
    !metadata.hasCommerceSignals
  ) {
    return "weak_product_url_signal";
  }

  return null;
}

async function fetchProductMetadata(
  candidate: ProductCandidate,
  onRejection?: (rejection: ProductCandidateRejectionLog) => void
): Promise<Product | null> {
  const rejectCandidate = (
    reason: string,
    evidence: ProductCandidateRejectionEvidence = {}
  ) => {
    onRejection?.(buildCandidateRejectionLog(candidate, reason, evidence));
    return null;
  };

  try {
    const response = await fetch(candidate.url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(CANDIDATE_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return rejectCandidate("http_error", {
        status: response.status,
        contentType: response.headers.get("content-type")?.slice(0, 80) || null,
      });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return rejectCandidate("non_html_response", {
        contentType: contentType.slice(0, 80) || null,
      });
    }

    const html = await response.text();
    const metadata = extractMetadataFromHtml(html, candidate.url, response.url);
    const title =
      metadata.title && !hasBadProductTitleSignal(metadata.title)
        ? metadata.title
        : candidate.titleHint && !hasBadProductTitleSignal(candidate.titleHint)
          ? candidate.titleHint
          : metadata.title || candidate.titleHint || null;
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
      return rejectCandidate(rejectionReason, {
        canonicalUrl: compactUrlForLog(metadata.canonicalUrl),
        currency: metadata.priceCurrency,
        ogType: metadata.ogType,
        isProduct: metadata.isProduct,
        hasProductSchema: metadata.hasProductSchema,
        hasProductMeta: metadata.hasProductMeta,
        hasProductUrlSignal: metadata.hasProductUrlSignal,
        hasTitle: Boolean(title),
        hasImage: Boolean(imageUrl),
        hasPrice: Boolean(price),
        hasRetailer: Boolean(retailer),
      });
    }

    const productTitle = title as string;
    const productRetailer = retailer as string;
    const productImageUrl = imageUrl as string;
    const productPrice = price as number;
    const productBrand = metadata.brand || candidate.retailerHint || productRetailer;
    const intentMatch = evaluateProductIntentMatch({
      candidate,
      title: productTitle,
      brand: productBrand,
      retailer: productRetailer,
      canonicalUrl: metadata.canonicalUrl,
    });

    if (intentMatch.quality === "reject") {
      return rejectCandidate(intentMatch.reason, {
        canonicalUrl: compactUrlForLog(metadata.canonicalUrl),
        matchedDescriptors: intentMatch.matchedDescriptors.slice(0, 8),
        descriptorTokens: intentMatch.descriptorTokens.slice(0, 8),
        productType: candidate.productType || null,
        rawRequiredTerms: candidate.requiredTerms.slice(0, 8),
        hardRequiredTerms: getHardIdentitySearchTerms(candidate.requiredTerms).slice(
          0,
          8
        ),
        softRequiredTerms: getSoftIdentitySearchTerms(candidate.requiredTerms).slice(
          0,
          8
        ),
      });
    }

    return {
      id: createProductId(metadata.canonicalUrl),
      title: productTitle,
      brand: productBrand,
      price: productPrice,
      image_url: productImageUrl,
      product_url: metadata.canonicalUrl,
      retailer: productRetailer,
      category: normalizeCategoryHint(candidate.categoryHint) || candidate.categoryHint,
      aesthetic: "minimalist",
      source: "live",
      match_quality: intentMatch.quality,
      match_reasons: intentMatch.matchReasons,
      missing_preferences: intentMatch.missingPreferences,
      intent_id: candidate.intentId,
      intent_label: candidate.displayLabel,
    };
  } catch (error) {
    return rejectCandidate("fetch_failed", {
      error: error instanceof Error ? error.name : typeof error,
    });
  }
}

function decodeHtmlUrlValue(value: string): string {
  return value
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizeDiscoveredProductLink(
  value: string,
  baseUrl: string,
  avoidTerms: string[] = []
): string | null {
  const decoded = decodeHtmlUrlValue(value);

  if (
    !decoded ||
    decoded.startsWith("#") ||
    decoded.startsWith("mailto:") ||
    decoded.startsWith("tel:") ||
    decoded.startsWith("javascript:")
  ) {
    return null;
  }

  const absoluteUrl = toAbsoluteUrl(decoded, baseUrl);
  if (!absoluteUrl || ASSET_URL_EXTENSION_PATTERN.test(absoluteUrl)) {
    return null;
  }

  if (
    getNonWearableProductReason(absoluteUrl) ||
    getMatchedSearchTerms(absoluteUrl, avoidTerms).length > 0
  ) {
    return null;
  }

  const sanitizedUrl = sanitizeCandidateUrl(absoluteUrl);
  if (!sanitizedUrl || !hasProductLikePath(sanitizedUrl)) {
    return null;
  }

  return sanitizedUrl;
}

function extractProductLinksFromHtml(
  html: string,
  baseUrl: string,
  limit: number,
  avoidTerms: string[] = []
): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  const addLink = (value: string) => {
    if (links.length >= limit) {
      return;
    }

    const productUrl = normalizeDiscoveredProductLink(value, baseUrl, avoidTerms);
    if (!productUrl || seen.has(productUrl)) {
      return;
    }

    seen.add(productUrl);
    links.push(productUrl);
  };

  const htmlSample = html.slice(0, 700_000);
  const quotedHrefPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi;
  let quotedHrefMatch: RegExpExecArray | null;
  while (
    links.length < limit &&
    (quotedHrefMatch = quotedHrefPattern.exec(htmlSample))
  ) {
    addLink(quotedHrefMatch[2] || "");
  }

  const unquotedHrefPattern = /<a\b[^>]*\bhref\s*=\s*([^"'\s>]+)/gi;
  let unquotedHrefMatch: RegExpExecArray | null;
  while (
    links.length < limit &&
    (unquotedHrefMatch = unquotedHrefPattern.exec(htmlSample))
  ) {
    addLink(unquotedHrefMatch[1] || "");
  }

  const normalizedHtmlSample = htmlSample
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/");
  const embeddedProductUrlPattern =
    /https?:\/\/[^"'<>\\\s]+(?:\/listing\/|\/listings\/|\/product\/|\/products\/|\/p\/|\/dp\/|\/item\/|\/items\/|\/sku\/|\/prod\/)[^"'<>\\\s]*/gi;
  let embeddedUrlMatch: RegExpExecArray | null;
  while (
    links.length < limit &&
    (embeddedUrlMatch = embeddedProductUrlPattern.exec(normalizedHtmlSample))
  ) {
    addLink(embeddedUrlMatch[0] || "");
  }

  return links;
}

async function expandDiscoveryPageCandidate(
  candidate: ProductCandidate,
  onRejection?: (rejection: ProductCandidateRejectionLog) => void
): Promise<ProductCandidate[]> {
  const rejectDiscoveryPage = (
    reason: string,
    evidence: ProductCandidateRejectionEvidence = {}
  ) => {
    onRejection?.(buildCandidateRejectionLog(candidate, reason, evidence));
    return [];
  };

  try {
    const response = await fetch(candidate.url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(CANDIDATE_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return rejectDiscoveryPage("discovery_http_error", {
        status: response.status,
        contentType: response.headers.get("content-type")?.slice(0, 80) || null,
      });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return rejectDiscoveryPage("discovery_non_html_response", {
        contentType: contentType.slice(0, 80) || null,
      });
    }

    const html = await response.text();
    const responseUrl = response.url || candidate.url;
    const productUrls = extractProductLinksFromHtml(
      html,
      responseUrl,
      DISCOVERY_PAGE_LINK_LIMIT,
      candidate.avoidTerms
    );

    if (productUrls.length === 0) {
      return rejectDiscoveryPage("discovery_no_product_links", {
        responseUrl: compactUrlForLog(responseUrl),
        contentLength: html.length,
      });
    }

    return productUrls.map((productUrl, index) => ({
      ...candidate,
      url: productUrl,
      candidateKind: "product",
      discoveryParentUrl: candidate.url,
      titleHint: undefined,
      imageHint: undefined,
      priceHint: undefined,
      rank: candidate.rank + 0.25 + index / 100,
    }));
  } catch (error) {
    return rejectDiscoveryPage("discovery_fetch_failed", {
      error: error instanceof Error ? error.name : typeof error,
    });
  }
}

async function expandDiscoveryPageCandidates(
  candidates: ProductCandidate[],
  onRejection?: (rejection: ProductCandidateRejectionLog) => void
): Promise<{
  candidates: ProductCandidate[];
  discoveryPages: number;
  expandedDiscoveryPages: number;
  extractedProductLinks: number;
  skippedDiscoveryPages: number;
}> {
  const directCandidates = candidates.filter(
    (candidate) => candidate.candidateKind !== "discovery-page"
  );
  const discoveryCandidates = candidates.filter(
    (candidate) => candidate.candidateKind === "discovery-page"
  );
  const discoveryCandidatesToExpand = discoveryCandidates.slice(
    0,
    DISCOVERY_PAGE_EXPANSION_LIMIT
  );
  const expandedGroups = await Promise.all(
    discoveryCandidatesToExpand.map((candidate) =>
      expandDiscoveryPageCandidate(candidate, onRejection)
    )
  );
  const expandedCandidates = expandedGroups.flat();
  const validationCandidates = limitCandidatesByHost(
    dedupeCandidates([...directCandidates, ...expandedCandidates]),
    VALIDATION_CANDIDATE_HOST_LIMIT
  ).slice(0, VALIDATION_CANDIDATE_LIMIT);

  return {
    candidates: validationCandidates,
    discoveryPages: discoveryCandidates.length,
    expandedDiscoveryPages: expandedGroups.filter((group) => group.length > 0)
      .length,
    extractedProductLinks: expandedCandidates.length,
    skippedDiscoveryPages:
      discoveryCandidates.length - discoveryCandidatesToExpand.length,
  };
}

async function searchWithBrave(
  queries: SearchQuery[],
  onProgress?: ProductSearchProgressReporter
): Promise<ProviderSearchResult | null> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    return null;
  }

  onProgress?.({
    type: "progress",
    stage: "discovery",
    status: "active",
    detail: "Starting Brave candidate discovery.",
    counts: { queries: queries.length },
  });

  let completedQueries = 0;
  let acceptedCandidates = 0;
  const candidateGroups = await Promise.all(
    queries.map(async (query, queryIndex): Promise<ProductCandidate[]> => {
      const queryCandidates: ProductCandidate[] = [];

      try {
        const discoveryQueries = buildProductDiscoveryQueries(query);

        const variantCandidateGroups = await Promise.all(
          discoveryQueries.map(async (discoveryQuery, variantIndex) => {
            const variantCandidates: ProductCandidate[] = [];
            const searchParams = new URLSearchParams({
              q: discoveryQuery,
              count: BRAVE_RESULTS_PER_QUERY,
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
              console.warn("[product-search] Brave query failed", {
                query: discoveryQuery.slice(0, 120),
                status: response.status,
                body: errorText.slice(0, 240),
              });
              return variantCandidates;
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
              const sanitizedUrl = sanitizeCandidateUrl(String(result.url || ""), {
                allowDiscoveryPages: true,
              });
              if (!sanitizedUrl) {
                continue;
              }

              const titleHint =
                cleanText(result.title || undefined) || undefined;
              if (
                hasNoisyDiscoveryCandidateSignal({
                  url: sanitizedUrl,
                  title: titleHint,
                  avoidTerms: query.avoidTerms,
                })
              ) {
                continue;
              }

              variantCandidates.push({
                url: sanitizedUrl,
                candidateKind: getCandidateKindForUrl(sanitizedUrl),
                titleHint,
                retailerHint:
                  cleanText(result.profile?.name || result.meta_url?.hostname) ||
                  undefined,
                categoryHint: query.categoryHint,
                intentText: query.text,
                querySource: query.source,
                querySourceIndex: query.sourceIndex,
                intentId: query.intentId,
                productType: query.productType,
                displayLabel: query.displayLabel,
                reason: query.reason,
                requiredTerms: query.requiredTerms,
                optionalTerms: query.optionalTerms,
                styleProfile: query.styleProfile,
                avoidTerms: query.avoidTerms,
                replacesVisibleItem: query.replacesVisibleItem,
                alternateQuery: query.alternateQuery,
                provider: "brave-search",
                rank:
                  rankCandidateUrl(queryIndex, resultIndex, sanitizedUrl) +
                  variantIndex * 5,
              });
            }

            return variantCandidates;
          })
        );

        queryCandidates.push(...variantCandidateGroups.flat());
      } catch (error) {
        console.warn("[product-search] Brave query failed", {
          query: query.text.slice(0, 120),
          error: error instanceof Error ? error.name : typeof error,
        });
      } finally {
        completedQueries += 1;
        acceptedCandidates += queryCandidates.length;
        onProgress?.({
          type: "progress",
          stage: "discovery",
          status: "active",
          detail: `Brave checked ${query.categoryHint} candidates.`,
          counts: {
            completedQueries,
            totalQueries: queries.length,
            acceptedCandidates,
          },
        });
      }

      return queryCandidates;
    })
  );

  return { provider: "brave-search", candidates: candidateGroups.flat() };
}

// Reserved for future reactivation of Google CSE.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function searchWithGoogleCse(
  queries: SearchQuery[],
  onProgress?: ProductSearchProgressReporter
): Promise<ProviderSearchResult | null> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !engineId) {
    console.log("[product-search] Skipped Google CSE", {
      reason: !apiKey && !engineId
        ? "missing_google_search_api_key_and_engine_id"
        : !apiKey
          ? "missing_google_search_api_key"
          : "missing_google_search_engine_id",
      config: summarizeGoogleCseConfig(apiKey, engineId),
    });
    return null;
  }

  if (googleCseDisabledReason) {
    console.log("[product-search] Skipped Google CSE", {
      reason: googleCseDisabledReason,
      explanation: googleCseDisabledExplanation,
      suggestedFix: googleCseDisabledSuggestedFix,
    });
    return { provider: "google-cse", candidates: [] };
  }

  const skipReason = await getGoogleCseSkipReason(apiKey, engineId);
  if (skipReason) {
    console.log("[product-search] Skipped Google CSE", {
      reason: skipReason,
      explanation: googleCseDisabledExplanation,
      suggestedFix: googleCseDisabledSuggestedFix,
    });
    return { provider: "google-cse", candidates: [] };
  }

  onProgress?.({
    type: "progress",
    stage: "discovery",
    status: "active",
    detail: "Starting Google CSE candidate discovery.",
    counts: { queries: queries.length },
  });

  let completedQueries = 0;
  let acceptedCandidates = 0;
  let rawResultsSeen = 0;
  let filteredCandidates = 0;
  const candidateGroups = await Promise.all(
    queries.map(async (query, queryIndex): Promise<ProductCandidate[]> => {
      const queryCandidates: ProductCandidate[] = [];

      try {
        const discoveryQueries = buildProductDiscoveryQueries(query);

        const variantCandidateGroups = await Promise.all(
          discoveryQueries.map(async (discoveryQuery, variantIndex) => {
            const variantCandidates: ProductCandidate[] = [];
            const searchParams = new URLSearchParams({
              key: apiKey,
              cx: engineId,
              q: discoveryQuery,
              num: "10",
              gl: "us",
              hl: "en",
            });

            const response = await fetch(
              `https://customsearch.googleapis.com/customsearch/v1?${searchParams.toString()}`,
              {
                cache: "no-store",
                signal: AbortSignal.timeout(GOOGLE_CSE_TIMEOUT_MS),
              }
            );

            if (!response.ok) {
              const errorText = await response.text().catch(() => "");
              const description = describeGoogleCseFailure(
                response.status,
                errorText
              );
              const unavailableReason = description.permanent
                ? description.code
                : null;

              if (unavailableReason) {
                googleCseDisabledReason = unavailableReason;
                googleCseDisabledExplanation = description.explanation;
                googleCseDisabledSuggestedFix = description.suggestedFix;
                console.warn("[product-search] Google CSE unavailable", {
                  reason: unavailableReason,
                  status: response.status,
                  explanation: description.explanation,
                  suggestedFix: description.suggestedFix,
                  googleMessage: description.googleMessage,
                  googleReason: description.googleReason,
                  googleDomain: description.googleDomain,
                  googleLocation: description.googleLocation,
                  config: summarizeGoogleCseConfig(apiKey, engineId),
                  body: errorText.slice(0, 240),
                });
                return variantCandidates;
              }

              console.warn("[product-search] Google CSE query failed", {
                query: discoveryQuery.slice(0, 120),
                status: response.status,
                reason: description.code,
                explanation: description.explanation,
                suggestedFix: description.suggestedFix,
                googleMessage: description.googleMessage,
                googleReason: description.googleReason,
                googleDomain: description.googleDomain,
                googleLocation: description.googleLocation,
                config: summarizeGoogleCseConfig(apiKey, engineId),
                body: errorText.slice(0, 240),
              });

              return variantCandidates;
            }

            const data = (await response.json()) as {
              items?: Array<{ link?: string; title?: string; displayLink?: string }>;
            };
            const rawResults = data.items || [];
            rawResultsSeen += rawResults.length;

            for (const [resultIndex, result] of rawResults.entries()) {
              const sanitizedUrl = sanitizeCandidateUrl(String(result.link || ""), {
                allowDiscoveryPages: true,
              });
              if (!sanitizedUrl) {
                filteredCandidates += 1;
                continue;
              }

              const titleHint =
                cleanText(result.title || undefined) || undefined;
              if (
                hasNoisyDiscoveryCandidateSignal({
                  url: sanitizedUrl,
                  title: titleHint,
                  avoidTerms: query.avoidTerms,
                })
              ) {
                filteredCandidates += 1;
                continue;
              }

              variantCandidates.push({
                url: sanitizedUrl,
                candidateKind: getCandidateKindForUrl(sanitizedUrl),
                titleHint,
                retailerHint: cleanText(result.displayLink || undefined) || undefined,
                categoryHint: query.categoryHint,
                intentText: query.text,
                querySource: query.source,
                querySourceIndex: query.sourceIndex,
                intentId: query.intentId,
                productType: query.productType,
                displayLabel: query.displayLabel,
                reason: query.reason,
                requiredTerms: query.requiredTerms,
                optionalTerms: query.optionalTerms,
                styleProfile: query.styleProfile,
                avoidTerms: query.avoidTerms,
                replacesVisibleItem: query.replacesVisibleItem,
                alternateQuery: query.alternateQuery,
                provider: "google-cse",
                rank:
                  rankCandidateUrl(queryIndex, resultIndex, sanitizedUrl) +
                  variantIndex * 5,
              });
            }

            return variantCandidates;
          })
        );

        queryCandidates.push(...variantCandidateGroups.flat());
      } catch (error) {
        console.warn("[product-search] Google CSE query failed", {
          query: query.text.slice(0, 120),
          error: error instanceof Error ? error.name : typeof error,
        });
      } finally {
        completedQueries += 1;
        acceptedCandidates += queryCandidates.length;
        onProgress?.({
          type: "progress",
          stage: "discovery",
          status: "active",
          detail: `Google CSE checked ${query.categoryHint} candidates.`,
          counts: {
            completedQueries,
            totalQueries: queries.length,
            acceptedCandidates,
          },
        });
      }

      return queryCandidates;
    })
  );

  const candidates = candidateGroups.flat();
  console.log("[product-search] Google CSE complete", {
    rawResults: rawResultsSeen,
    filteredCandidates,
    acceptedCandidates: candidates.length,
  });

  return { provider: "google-cse", candidates };
}

// Reserved for future reactivation of Gemini URL finder.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function searchWithGeminiUrlFinder(
  queries: SearchQuery[],
  budget?: string,
  onProgress?: ProductSearchProgressReporter
): Promise<ProviderSearchResult | null> {
  if (!(await hasGeminiCredentials())) {
    return null;
  }

  onProgress?.({
    type: "progress",
    stage: "discovery",
    status: "active",
    detail: "Asking Gemini for direct product URL candidates.",
    counts: { queries: queries.length },
  });

  const model = createGeminiModel({
    model: "gemini-2.5-flash",
    tools: [{ googleSearch: {} }],
  });

  const budgetLine = budget ? `Budget: ${budget}\n` : "";
  const prompt = `Use web search to find direct retailer product page URLs for these fashion needs.

${budgetLine}Queries:
${queries
      .map(
        (query, index) =>
          `${index + 1}. ${query.text} [category=${query.categoryHint}; product_type=${query.productType || query.categoryHint}; required=${query.requiredTerms.join(", ") || "none"}; avoid=${query.avoidTerms.slice(0, 6).join(", ") || "none"}]`
      )
      .join("\n")}

Return a JSON array only.
Each item must be:
{
  "url": "direct https product page url",
  "title_hint": "short product title",
  "retailer_hint": "retailer or brand",
  "image_url_hint": "direct product image url if available",
  "price_hint": 99,
  "category": "outerwear | tops | pants | shoes | accessories",
  "query_index": 1
}

Rules:
- Only return direct product pages from real retailers
- No search result pages
- No category pages
- No homepages
- No social or editorial links
- No sewing patterns, PDF patterns, fabric, templates, or supplies
- Match query_index to the query that each candidate is meant to satisfy
- Return up to 10 candidates total
- Do not return markdown or explanations`;

  try {
    const result = await model.generateContent(prompt, {
      timeout: GEMINI_URL_FINDER_TIMEOUT_MS,
    });
    const responseText = result.response.text();
    const jsonText = extractJsonArrayText(responseText);
    if (!jsonText) {
      console.warn("[product-search] Gemini URL finder returned no JSON array");
      return { provider: "gemini-url-finder", candidates: [] };
    }

    const parsed = JSON.parse(jsonText) as Array<Record<string, unknown>>;

    if (!Array.isArray(parsed)) {
      return { provider: "gemini-url-finder", candidates: [] };
    }

    const candidates = parsed
      .map((entry, index) => {
        const sanitizedUrl = sanitizeCandidateUrl(String(entry.url || ""));
        if (!sanitizedUrl) {
          return null;
        }
        const titleHint =
          cleanText(String(entry.title_hint || "")) || undefined;

        const categoryHint = inferCategoryHint(
          String(entry.category || queries[0]?.categoryHint || "")
        );
        const queryIndex = Number(entry.query_index);
        const sourceQuery =
          Number.isInteger(queryIndex) && queries[queryIndex - 1]
            ? queries[queryIndex - 1]
            : queries.find((query) => query.categoryHint === categoryHint) ||
              queries[0];
        if (
          hasNoisyDiscoveryCandidateSignal({
            url: sanitizedUrl,
            title: titleHint,
            avoidTerms: sourceQuery?.avoidTerms || [],
          })
        ) {
          return null;
        }

        return {
          url: sanitizedUrl,
          candidateKind: "product" as const,
          titleHint,
          retailerHint: cleanText(String(entry.retailer_hint || "")) || undefined,
          imageHint:
            normalizeUrl(String(entry.image_url_hint || "")) || undefined,
          priceHint:
            Number.isFinite(Number(entry.price_hint)) &&
              Number(entry.price_hint) > 0
              ? Number(entry.price_hint)
              : undefined,
          categoryHint,
          intentText: sourceQuery?.text || categoryHint,
          querySource: sourceQuery?.source || "category",
          querySourceIndex: sourceQuery?.sourceIndex || 0,
          intentId: sourceQuery?.intentId,
          productType: sourceQuery?.productType,
          displayLabel: sourceQuery?.displayLabel,
          reason: sourceQuery?.reason,
          requiredTerms: sourceQuery?.requiredTerms || [],
          optionalTerms: sourceQuery?.optionalTerms || [],
          styleProfile: sourceQuery?.styleProfile,
          avoidTerms: sourceQuery?.avoidTerms || [],
          replacesVisibleItem: sourceQuery?.replacesVisibleItem,
          alternateQuery: sourceQuery?.alternateQuery,
          provider: "gemini-url-finder" as const,
          rank: 2000 + index,
        };
      })
      .filter((entry) => entry !== null);

    onProgress?.({
      type: "progress",
      stage: "discovery",
      status: "active",
      detail: "Gemini URL finder returned candidate product pages.",
      counts: {
        rawResults: parsed.length,
        acceptedCandidates: candidates.length,
      },
    });

    return { provider: "gemini-url-finder", candidates };
  } catch (error) {
    console.warn("[product-search] Gemini URL finder failed", {
      error: error instanceof Error ? error.name : typeof error,
      timeoutMs: GEMINI_URL_FINDER_TIMEOUT_MS,
    });
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

function limitCandidatesByHost(
  candidates: ProductCandidate[],
  maxPerHost: number
): ProductCandidate[] {
  const hostCounts = new Map<string, number>();
  const limited: ProductCandidate[] = [];

  for (const candidate of candidates) {
    const hostname = getCandidateHostname(candidate.url);
    const hostLimit = hasKnownFetchBlockedHost(candidate.url)
      ? Math.min(1, maxPerHost)
      : maxPerHost;
    const currentHostCount = hostCounts.get(hostname) || 0;

    if (currentHostCount >= hostLimit) {
      continue;
    }

    hostCounts.set(hostname, currentHostCount + 1);
    limited.push(candidate);
  }

  return limited;
}

function selectCandidatesByIntent(
  candidates: ProductCandidate[],
  limit: number
): ProductCandidate[] {
  const groups = new Map<string, ProductCandidate[]>();
  const selected: ProductCandidate[] = [];
  const selectedUrls = new Set<string>();
  const hostCounts = new Map<string, number>();
  let selectedDiscoveryPages = 0;

  const trySelectCandidate = (
    candidate: ProductCandidate,
    maxPerHost: number
  ): boolean => {
    if (selected.length >= limit || selectedUrls.has(candidate.url)) {
      return false;
    }

    if (
      candidate.candidateKind === "discovery-page" &&
      selectedDiscoveryPages >= DISCOVERY_PAGE_EXPANSION_LIMIT
    ) {
      return false;
    }

    const hostname = getCandidateHostname(candidate.url);
    const hostLimit = hasKnownFetchBlockedHost(candidate.url)
      ? Math.min(1, maxPerHost)
      : maxPerHost;
    const currentHostCount = hostCounts.get(hostname) || 0;

    if (currentHostCount >= hostLimit) {
      return false;
    }

    selectedUrls.add(candidate.url);
    hostCounts.set(hostname, currentHostCount + 1);
    selected.push(candidate);
    if (candidate.candidateKind === "discovery-page") {
      selectedDiscoveryPages += 1;
    }

    return true;
  };

  for (const candidate of candidates) {
    const key = candidate.intentId
      ? `intent:${candidate.intentId}`
      : `${candidate.querySource}:${candidate.querySourceIndex}:${candidate.categoryHint}`;
    const group = groups.get(key) || [];
    group.push(candidate);
    groups.set(key, group);
  }

  const groupedCandidates = Array.from(groups.values())
    .map((group) => group.sort((left, right) => left.rank - right.rank))
    .sort((left, right) => (left[0]?.rank || 0) - (right[0]?.rank || 0));

  for (const group of groupedCandidates) {
    if (selectedDiscoveryPages >= DISCOVERY_PAGE_EXPANSION_LIMIT) {
      break;
    }

    const discoveryCandidate = group.find(
      (candidate) => candidate.candidateKind === "discovery-page"
    );

    if (discoveryCandidate) {
      trySelectCandidate(discoveryCandidate, 2);
    }
  }

  const groupIndexes = new Array(groupedCandidates.length).fill(0) as number[];
  while (selected.length < limit) {
    let addedThisRound = false;

    for (const [groupIndex, group] of groupedCandidates.entries()) {
      while (groupIndexes[groupIndex] < group.length) {
        const candidate = group[groupIndexes[groupIndex]];
        groupIndexes[groupIndex] += 1;

        if (!candidate) {
          continue;
        }

        if (trySelectCandidate(candidate, 2)) {
          addedThisRound = true;
          break;
        }
      }

      if (selected.length === limit) {
        break;
      }
    }

    if (!addedThisRound) {
      break;
    }
  }

  if (selected.length < limit) {
    for (const group of groupedCandidates) {
      for (const candidate of group) {
        trySelectCandidate(candidate, 4);

        if (selected.length >= limit) {
          break;
        }
      }

      if (selected.length >= limit) {
        break;
      }
    }
  }

  return selected.sort((left, right) => left.rank - right.rank);
}

function sortProductsByBudget(products: Product[], budget?: string): Product[] {
  const budgetCap = parseBudgetCap(budget);

  return [...products].sort((left, right) => {
    const leftQualityScore = left.match_quality === "near" ? 1 : 0;
    const rightQualityScore = right.match_quality === "near" ? 1 : 0;

    if (leftQualityScore !== rightQualityScore) {
      return leftQualityScore - rightQualityScore;
    }

    const missingPreferenceDelta =
      (left.missing_preferences?.length || 0) -
      (right.missing_preferences?.length || 0);

    if (missingPreferenceDelta !== 0) {
      return missingPreferenceDelta;
    }

    if (!budgetCap) {
      return left.price - right.price;
    }

    const leftScore = left.price <= budgetCap ? 0 : 1;
    const rightScore = right.price <= budgetCap ? 0 : 1;

    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return left.price - right.price;
  });
}

function inferProductSubtype(product: Product): string {
  const text = `${product.title} ${product.brand} ${product.retailer} ${product.category}`;
  const match = PRODUCT_SUBTYPE_TERMS.find(({ terms }) =>
    hasAnySearchTerm(text, terms)
  );

  return match?.subtype || normalizeCategoryHint(product.category) || product.category;
}

function diversifyProductsByCategory(
  products: Product[],
  replacementCategories: Set<string>
): Product[] {
  const selected: Product[] = [];
  const countsByCategory = new Map<string, number>();
  const seenProductKeys = new Set<string>();
  const seenSubtypes = new Set<string>();
  const seenIntentIds = new Set<string>();
  const seenIntentRetailerKeys = new Set<string>();
  const availableCategories = new Set(
    products.map(
      (product) =>
        normalizeCategoryHint(product.category) || product.category.toLowerCase()
    )
  );

  const tryAddProduct = (
    product: Product,
    {
      maxPerCategory,
      requireNewSubtype,
    }: { maxPerCategory: number; requireNewSubtype: boolean }
  ) => {
    const category =
      normalizeCategoryHint(product.category) || product.category.toLowerCase();
    const currentCount = countsByCategory.get(category) || 0;
    const productKey = `${product.retailer.toLowerCase()}::${product.title.toLowerCase()}::${product.product_url}`;
    const subtypeKey = `${category}::${inferProductSubtype(product)}`;
    const intentRetailerKey = product.intent_id
      ? `${product.intent_id}::${product.retailer.toLowerCase()}`
      : null;

    if (
      selected.length >= 6 ||
      seenProductKeys.has(productKey) ||
      Boolean(intentRetailerKey && seenIntentRetailerKeys.has(intentRetailerKey)) ||
      currentCount >= maxPerCategory ||
      (requireNewSubtype && seenSubtypes.has(subtypeKey))
    ) {
      return;
    }

    seenProductKeys.add(productKey);
    seenSubtypes.add(subtypeKey);
    if (intentRetailerKey) {
      seenIntentRetailerKeys.add(intentRetailerKey);
    }
    countsByCategory.set(category, currentCount + 1);
    selected.push(product);
  };

  const tryAddIntentCoverageProduct = (product: Product) => {
    const intentId = product.intent_id;
    if (!intentId || selected.length >= 6 || seenIntentIds.has(intentId)) {
      return;
    }

    const category =
      normalizeCategoryHint(product.category) || product.category.toLowerCase();
    const productKey = `${product.retailer.toLowerCase()}::${product.title.toLowerCase()}::${product.product_url}`;
    const subtypeKey = `${category}::${inferProductSubtype(product)}`;
    const intentRetailerKey = `${intentId}::${product.retailer.toLowerCase()}`;

    if (seenProductKeys.has(productKey)) {
      return;
    }

    seenIntentIds.add(intentId);
    seenProductKeys.add(productKey);
    seenSubtypes.add(subtypeKey);
    seenIntentRetailerKeys.add(intentRetailerKey);
    countsByCategory.set(category, (countsByCategory.get(category) || 0) + 1);
    selected.push(product);
  };

  for (const product of products) {
    tryAddIntentCoverageProduct(product);

    if (selected.length === 6) {
      break;
    }
  }

  for (const product of products) {
    tryAddProduct(product, { maxPerCategory: 1, requireNewSubtype: true });

    if (selected.length === 6) {
      break;
    }
  }

  for (const product of products) {
    const category =
      normalizeCategoryHint(product.category) || product.category.toLowerCase();
    const isReplacementCategory = replacementCategories.has(category);
    const maxPerCategory = isReplacementCategory ? 2 : 2;
    tryAddProduct(product, {
      maxPerCategory,
      requireNewSubtype: !isReplacementCategory,
    });

    if (selected.length === 6) {
      break;
    }
  }

  if (selected.length < 3 && availableCategories.size <= 1) {
    for (const product of products) {
      const category =
        normalizeCategoryHint(product.category) || product.category.toLowerCase();
      const maxPerCategory = replacementCategories.has(category) ? 2 : 3;
      tryAddProduct(product, { maxPerCategory, requireNewSubtype: false });

      if (selected.length >= maxPerCategory) {
        break;
      }
    }
  }

  const selectedUrls = new Set(selected.map((product) => product.product_url));
  const droppedProducts = products
    .filter((product) => !selectedUrls.has(product.product_url))
    .map((product) => {
      const category =
        normalizeCategoryHint(product.category) || product.category.toLowerCase();
      return {
        title: product.title.slice(0, 120),
        retailer: product.retailer,
        category,
        subtype: inferProductSubtype(product),
        source: product.source || "unknown",
        reason: replacementCategories.has(category)
          ? "replacement_category_cap"
          : "category_or_subtype_cap",
        url: compactUrlForLog(product.product_url),
      };
    });

  console.log("[product-search] Category diversity applied", {
    inputProducts: products.length,
    selectedProducts: selected.length,
    replacementCategories: Array.from(replacementCategories),
    selectedByCategory: Object.fromEntries(countsByCategory),
    availableCategories: Array.from(availableCategories),
    selectedProductDetails: selected.slice(0, 6).map((product) => ({
      title: product.title.slice(0, 120),
      retailer: product.retailer,
      category:
        normalizeCategoryHint(product.category) || product.category.toLowerCase(),
      matchQuality: product.match_quality || "exact",
    })),
    droppedByReason: countBy(droppedProducts, (product) => product.reason),
  });

  return selected;
}

function dedupeProducts(products: Product[]): Product[] {
  const dedupedByKey = new Map<string, Product>();

  const shouldReplaceProduct = (current: Product, next: Product): boolean => {
    const currentQualityScore = current.match_quality === "near" ? 1 : 0;
    const nextQualityScore = next.match_quality === "near" ? 1 : 0;

    if (nextQualityScore !== currentQualityScore) {
      return nextQualityScore < currentQualityScore;
    }

    return (
      (next.missing_preferences?.length || 0) <
      (current.missing_preferences?.length || 0)
    );
  };

  for (const product of products) {
    const key = `${product.retailer.toLowerCase()}::${product.title.toLowerCase()}::${product.product_url}`;
    const currentProduct = dedupedByKey.get(key);

    if (currentProduct && !shouldReplaceProduct(currentProduct, product)) {
      continue;
    }

    dedupedByKey.set(key, product);
  }

  return Array.from(dedupedByKey.values());
}

async function discoverCandidates(
  queries: SearchQuery[],
  budget?: string,
  onProgress?: ProductSearchProgressReporter
): Promise<ProductCandidate[]> {
  const braveResult = await searchWithBrave(queries, onProgress);
  console.log("[product-search] Skipped Google CSE", {
    reason: "disabled_by_policy",
  });
  console.log("[product-search] Skipped Gemini URL finder", {
    reason: "disabled_by_policy",
  });

  const providerResults = [braveResult];

  const allCandidates = providerResults.flatMap(
    (result) => result?.candidates || []
  );
  const dedupedCandidates = dedupeCandidates(allCandidates);
  const selectedCandidates = selectCandidatesByIntent(
    dedupedCandidates,
    SELECTED_CANDIDATE_LIMIT
  );

  console.log("[product-search] Candidate discovery complete", {
    providers: providerResults.map((result) =>
      result
        ? { provider: result.provider, candidates: result.candidates.length }
        : null
    ),
    rawCandidates: allCandidates.length,
    dedupedCandidates: dedupedCandidates.length,
    selectedCandidates: selectedCandidates.length,
    rawByKind: countBy(
      allCandidates,
      (candidate) => candidate.candidateKind || "product"
    ),
    selectedByKind: countBy(
      selectedCandidates,
      (candidate) => candidate.candidateKind || "product"
    ),
    rawByCategory: countBy(allCandidates, (candidate) => candidate.categoryHint),
    selectedByCategory: countBy(
      selectedCandidates,
      (candidate) => candidate.categoryHint
    ),
    selectedByIntent: countBy(
      selectedCandidates,
      (candidate) => candidate.intentId || `${candidate.querySource}:${candidate.querySourceIndex}`
    ),
    selectedByHost: countBy(selectedCandidates, (candidate) =>
      getCandidateHostname(candidate.url)
    ),
  });
  onProgress?.({
    type: "progress",
    stage: "discovery",
    status: "complete",
    detail: "Candidate discovery finished.",
    counts: {
      rawCandidates: allCandidates.length,
      dedupedCandidates: dedupedCandidates.length,
      selectedCandidates: selectedCandidates.length,
    },
  });

  return selectedCandidates;
}

/**
 * Search for real, currently available products using provider-based discovery,
 * then fetch and validate the product page metadata server-side.
 */
export async function searchRealProducts(
  shoppingQueries: string[],
  shoppingIntents: ShoppingIntent[],
  categories: string[],
  budget?: string,
  missingPieces: string[] = [],
  whatWorks: string[] = [],
  whatToFix: string[] = [],
  onProgress?: ProductSearchProgressReporter
): Promise<Product[]> {
  onProgress?.({
    type: "progress",
    stage: "intent",
    status: "active",
    detail: "Building product searches from missing pieces and fix notes.",
    counts: {
      shoppingQueries: shoppingQueries.length,
      shoppingIntents: shoppingIntents.length,
      missingPieces: missingPieces.length,
      whatWorks: whatWorks.length,
      whatToFix: whatToFix.length,
    },
  });

  const queries = buildSearchQueries(
    shoppingQueries,
    shoppingIntents,
    categories,
    missingPieces,
    budget,
    whatWorks,
    whatToFix
  );

  console.log("[product-search] Built search queries", {
    count: queries.length,
    shoppingIntents: shoppingIntents.length,
    protectedCategories: Array.from(inferCategoriesFromTexts(whatWorks)),
    allowedProtectedCategories: Array.from(
      new Set([
        ...inferCategoriesFromTexts(missingPieces),
        ...inferReplacementCategoriesFromTexts(whatToFix),
      ])
    ),
    queries: queries.map((query) => ({
      text: query.text,
      category: query.categoryHint,
      source: query.source,
      sourceIndex: query.sourceIndex,
      intentId: query.intentId,
      productType: query.productType,
      requiredTerms: query.requiredTerms.join(", ") || "none",
      hardRequiredTerms:
        getHardIdentitySearchTerms(query.requiredTerms).join(", ") || "none",
      softRequiredTerms:
        getSoftIdentitySearchTerms(query.requiredTerms).join(", ") || "none",
      optionalTerms: query.optionalTerms.join(", ") || "none",
      styleProfile: query.styleProfile || {},
      alternateQuery: query.alternateQuery,
      discoveryQueryLength: buildProductDiscoveryQuery(query).length,
    })),
  });
  onProgress?.({
    type: "progress",
    stage: "intent",
    status: "complete",
    detail: "Search intent is ready.",
    counts: { queries: queries.length },
  });

  if (queries.length === 0) {
    console.warn("[product-search] No search queries built");
    return [];
  }

  const candidates = await discoverCandidates(queries, budget, onProgress);
  if (candidates.length === 0) {
    console.warn("[product-search] No product candidates discovered");
    return [];
  }

  const rejectedCandidates: ProductCandidateRejectionLog[] = [];
  const expandedCandidates = await expandDiscoveryPageCandidates(
    candidates,
    (rejection) => {
      rejectedCandidates.push(rejection);
    }
  );
  console.log("[product-search] Discovery-page expansion complete", {
    inputCandidates: candidates.length,
    discoveryPages: expandedCandidates.discoveryPages,
    expandedDiscoveryPages: expandedCandidates.expandedDiscoveryPages,
    extractedProductLinks: expandedCandidates.extractedProductLinks,
    skippedDiscoveryPages: expandedCandidates.skippedDiscoveryPages,
    validationCandidates: expandedCandidates.candidates.length,
    validationByKind: countBy(
      expandedCandidates.candidates,
      (candidate) => candidate.candidateKind || "product"
    ),
    validationByHost: countBy(expandedCandidates.candidates, (candidate) =>
      getCandidateHostname(candidate.url)
    ),
  });

  if (expandedCandidates.candidates.length === 0) {
    console.warn("[product-search] No product candidates available after expansion");
    return [];
  }

  onProgress?.({
    type: "progress",
    stage: "vetting",
    status: "active",
    detail: "Fetching and validating candidate product pages.",
    counts: { totalCandidates: expandedCandidates.candidates.length },
  });
  let vettedCandidates = 0;
  const resolved = await Promise.allSettled(
    expandedCandidates.candidates.map(async (candidate) => {
      const product = await fetchProductMetadata(candidate, (rejection) => {
        rejectedCandidates.push(rejection);
      });
      vettedCandidates += 1;
      onProgress?.({
        type: "progress",
        stage: "vetting",
        status: "active",
        detail: product
          ? product.match_quality === "near"
            ? "Accepted a near live product match."
            : "Accepted an exact live product match."
          : "Rejected a weak or mismatched candidate.",
        counts: {
          vettedCandidates,
          totalCandidates: expandedCandidates.candidates.length,
        },
      });
      return product;
    })
  );
  const failedFetches = resolved.filter(
    (result) => result.status === "rejected"
  ).length;

  const products = resolved
    .map((result) =>
      result.status === "fulfilled" ? result.value : null
    )
    .filter((product): product is Product => Boolean(product));

  if (rejectedCandidates.length > 0) {
    const includeFullRejections =
      process.env.PRODUCT_SEARCH_DEBUG === "1" ||
      process.env.PRODUCT_SEARCH_DEBUG?.toLowerCase() === "true";
    const rejectionLog = {
      totalRejected: rejectedCandidates.length,
      byReason: countBy(rejectedCandidates, (rejection) => rejection.reason),
      byProvider: countBy(rejectedCandidates, (rejection) => rejection.provider),
      byIntent: countBy(
        rejectedCandidates,
        (rejection) =>
          rejection.intentId ||
          `${rejection.querySource}:${rejection.querySourceIndex}`
      ),
      sampleRejections: rejectedCandidates
        .slice(0, CANDIDATE_REJECTION_LOG_SAMPLE_SIZE)
        .map(summarizeCandidateRejectionForLog),
      ...(includeFullRejections ? { rejections: rejectedCandidates } : {}),
    };

    console.log("[product-search] Candidate rejected after fetch", rejectionLog);
  }

  const dedupedProducts = dedupeProducts(products);
  const sortedProducts = sortProductsByBudget(dedupedProducts, budget);
  console.log("[product-search] Live products before diversity", {
    acceptedProducts: products.length,
    dedupedProducts: dedupedProducts.length,
    acceptedByIntent: countBy(
      products,
      (product) => product.intent_id || "unknown"
    ),
    acceptedByCategory: countBy(
      sortedProducts,
      (product) =>
        normalizeCategoryHint(product.category) || product.category.toLowerCase()
    ),
    acceptedByMatchQuality: countBy(
      sortedProducts,
      (product) => product.match_quality || "exact"
    ),
    sample: sortedProducts.slice(0, 6).map((product) => ({
      title: product.title.slice(0, 120),
      retailer: product.retailer,
      category:
        normalizeCategoryHint(product.category) || product.category.toLowerCase(),
      price: product.price,
      matchQuality: product.match_quality || "exact",
      missingPreferences: product.missing_preferences?.slice(0, 4) || [],
    })),
  });
  const diverseProducts = diversifyProductsByCategory(
    sortedProducts,
    new Set([
      ...inferCategoriesFromTexts(whatToFix),
      ...shoppingIntents.map((intent) => intent.category),
    ])
  );
  console.log("[product-search] Candidate validation complete", {
    fetchedCandidates: resolved.length,
    discoveryPages: expandedCandidates.discoveryPages,
    expandedDiscoveryPages: expandedCandidates.expandedDiscoveryPages,
    extractedProductLinks: expandedCandidates.extractedProductLinks,
    acceptedProducts: products.length,
    dedupedProducts: dedupedProducts.length,
    diversifiedProducts: diverseProducts.length,
    failedFetches,
    acceptedByIntent: countBy(
      products,
      (product) => product.intent_id || "unknown"
    ),
    acceptedByCategory: countBy(
      products,
      (product) =>
        normalizeCategoryHint(product.category) || product.category.toLowerCase()
    ),
    diversifiedByCategory: countBy(
      diverseProducts,
      (product) =>
        normalizeCategoryHint(product.category) || product.category.toLowerCase()
    ),
    diversifiedByMatchQuality: countBy(
      diverseProducts,
      (product) => product.match_quality || "exact"
    ),
  });
  console.log(
    "[product-search] Resolved",
    diverseProducts.length,
    "usable products from",
    expandedCandidates.candidates.length,
    "candidates"
  );
  onProgress?.({
    type: "progress",
    stage: "vetting",
    status: "complete",
    detail: "Live product page validation finished.",
    counts: {
      fetchedCandidates: resolved.length,
      acceptedProducts: products.length,
      diversifiedProducts: diverseProducts.length,
      exactLiveProducts: diverseProducts.filter(
        (product) => product.match_quality !== "near"
      ).length,
      nearLiveProducts: diverseProducts.filter(
        (product) => product.match_quality === "near"
      ).length,
    },
  });
  return diverseProducts;
}
