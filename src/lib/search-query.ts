const NON_MENS_AUDIENCE_PATTERNS = [
  /\bwomen's\b/gi,
  /\bwomens\b/gi,
  /\bwomen\b/gi,
  /\bladies\b/gi,
  /\blady\b/gi,
  /\bfemale\b/gi,
  /\bgirls\b/gi,
  /\bgirl's\b/gi,
  /\bgirl\b/gi,
  /\bboys\b/gi,
  /\bboy's\b/gi,
  /\bboy\b/gi,
  /\bkids\b/gi,
  /\bkid's\b/gi,
  /\bkid\b/gi,
  /\byouth\b/gi,
];

export function normalizeMensSearchQuery(value: string): string {
  let normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  for (const pattern of NON_MENS_AUDIENCE_PATTERNS) {
    normalized = normalized.replace(pattern, "men's");
  }

  normalized = normalized.replace(/\bmens\b/gi, "men's");
  normalized = normalized.replace(/\bmen(?:'s)?\b/gi, "men's");
  normalized = normalized.replace(/(?:\bmen's\b\s*){2,}/gi, "men's ");
  normalized = normalized.replace(/\s+/g, " ").trim();

  if (!/\bmen's\b/i.test(normalized)) {
    normalized = `men's ${normalized}`;
  }

  return normalized.replace(/\s+/g, " ").trim();
}
