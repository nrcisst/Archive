import type { StyleAudit } from "@/lib/types";

/** Hardcoded mock audit for development and demo purposes */
export const MOCK_AUDIT: StyleAudit = {
  summary:
    "Strong minimalist foundation with clean proportions. The neutral palette works well, but the outfit could use a stronger focal point and more intentional layering to elevate from casual to considered.",
  score: 7.2,
  aesthetic_read: "Quiet Luxury / Minimalist Casual",
  what_works: [
    "Clean color palette — neutrals are well-coordinated without feeling flat",
    "Fit on the trousers is excellent — tapered without being too slim",
    "Shoe choice grounds the outfit with a solid visual anchor",
  ],
  what_to_fix: [
    "Top half lacks structure — the t-shirt reads too casual for the quality of the pants",
    "No accessories — a watch or minimal bracelet would add dimension",
    "Missing a layer — an unstructured blazer or overshirt would complete the silhouette",
  ],
  missing_pieces: [
    "Lightweight unstructured blazer in navy or charcoal",
    "Minimal leather watch with a clean dial",
    "Textured knit polo as a t-shirt upgrade",
  ],
  recommended_categories: [
    "outerwear",
    "accessories",
    "tops",
  ],
  shopping_queries: [
    "unstructured linen blazer men",
    "minimal leather watch under 200",
    "textured knit polo neutral",
  ],
  tone: "direct",
};
