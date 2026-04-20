/**
 * Core types for Archive Beta
 */

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
  source?: "live" | "curated";
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
