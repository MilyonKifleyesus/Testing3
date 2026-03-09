/**
 * Canonical frontend ID policy for time-log features:
 * normalize any backend id shape (number/string/guid/mixed) to string.
 */
export function normalizeId(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function normalizeOptionalId(value: unknown): string | undefined {
  const normalized = normalizeId(value);
  return normalized ? normalized : undefined;
}

/**
 * Canonical ID policy for map/filter flows:
 * - numeric-like values are normalized to base-10 string ("001" -> "1")
 * - non-numeric values are trimmed but otherwise unchanged
 */
export function normalizeNumericLikeId(value: unknown): string {
  const normalized = normalizeId(value);
  if (!normalized) return '';
  if (/^\d+$/.test(normalized)) {
    return String(Number.parseInt(normalized, 10));
  }
  return normalized;
}

export function normalizeNumericLikeIdList(values: unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeNumericLikeId(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
