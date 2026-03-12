import { normalizeNumericLikeId } from './id-normalizer.util';

export function normalizeProjectTypeFilterKey(
  projectTypeId: unknown,
  assessmentType?: unknown
): string | null {
  const primary = normalizeNumericLikeId(projectTypeId);
  if (primary) {
    return primary;
  }

  const fallback = String(assessmentType ?? '').trim();
  return fallback || null;
}
