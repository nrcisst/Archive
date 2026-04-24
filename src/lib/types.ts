/**
 * Core types for Archive Beta
 */

export type ProductCategory =
  | "outerwear"
  | "tops"
  | "pants"
  | "shoes"
  | "accessories";

export type StyleActionCategory = ProductCategory | "non_shoppable";

export type StyleActionVerb =
  | "keep"
  | "remove"
  | "replace"
  | "add"
  | "tailor"
  | "avoid";

export type StyleActionVisibility = "visible" | "missing" | "unknown";

export interface ShoppingStyleProfile {
  fit?: string;
  color?: string;
  rise?: string;
  leg?: string;
  material?: string;
  finish?: string;
  avoid_finish?: string[];
  neckline?: string;
  sleeve?: string;
  texture?: string;
  weight?: string;
  structure?: string;
  silhouette?: string;
  toe?: string;
  sole?: string;
  scale?: string;
  placement?: string;
}

/** Atomic style decision produced by the audit before any shopping intent */
export interface StyleAction {
  id: string;
  target_item: string;
  target_category: StyleActionCategory;
  visibility: StyleActionVisibility;
  action: StyleActionVerb;
  reason: string;
  shoppable: boolean;
  shopping_intent_id?: string;
}

/** Structured product intent produced by the audit and consumed by search */
export interface ShoppingIntent {
  id: string;
  style_action_id?: string;
  category: ProductCategory;
  product_type: string;
  style_profile: ShoppingStyleProfile;
  display_label: string;
  search_query: string;
  alternate_queries: string[];
  reason: string;
  priority: number;
  required_terms: string[];
  optional_terms: string[];
  avoid_terms: string[];
  replaces_visible_item: boolean;
}

export type ProductMatchQuality = "exact" | "near";

export type ProductSource =
  | "catalog"
  | "affiliate"
  | "ebay"
  | "live"
  | "curated";

/** Structured style audit returned by the AI */
export interface StyleAudit {
  summary: string;
  score: number;
  aesthetic_read: string;
  what_works: string[];
  what_to_fix: string[];
  missing_pieces: string[];
  recommended_categories: string[];
  shopping_queries: string[];
  style_actions: StyleAction[];
  shopping_intents: ShoppingIntent[];
  tone: string;
}

/** A shoppable product recommendation */
export interface Product {
  id: string;
  title: string;
  brand: string;
  price: number;
  image_url: string;
  product_url: string;
  retailer: string;
  category: string;
  aesthetic: string;
  style_profile?: ShoppingStyleProfile;
  source?: ProductSource;
  provider_id?: string;
  provider_label?: string;
  match_quality?: ProductMatchQuality;
  match_reasons?: string[];
  missing_preferences?: string[];
  intent_id?: string;
  intent_label?: string;
}

export type ProductSearchStageId = "intent" | "discovery" | "vetting" | "fallback";

export interface ProductSearchProgressEvent {
  type: "progress";
  stage: ProductSearchStageId;
  status: "active" | "complete";
  detail: string;
  counts?: Record<string, number>;
}

/** The full response from the audit API */
export interface AuditResponse {
  audit: StyleAudit;
  products: Product[];
}

/** User input submitted to the audit endpoint */
export interface AuditRequest {
  prompt?: string;
  image_base64?: string;
  image_upload_id?: string;
  occasion?: string;
  budget?: string;
}
