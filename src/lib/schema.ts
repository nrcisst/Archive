import { z } from "zod";

/**
 * Zod schema for validating the AI-generated style audit.
 * If the model returns malformed output, we catch it here
 * and fall back gracefully instead of showing raw JSON.
 */
export const StyleAuditSchema = z.object({
  summary: z.string().min(10, "Summary too short"),
  score: z.number().min(0).max(10),
  aesthetic_read: z.string().min(2),
  what_works: z.array(z.string()).min(1).max(10),
  what_to_fix: z.array(z.string()).min(1).max(10),
  missing_pieces: z.array(z.string()).min(1).max(10),
  recommended_categories: z.array(z.string()).min(1).max(8),
  shopping_queries: z.array(z.string()).min(1).max(8),
  tone: z.string().min(2),
});

export type ValidatedStyleAudit = z.infer<typeof StyleAuditSchema>;

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
