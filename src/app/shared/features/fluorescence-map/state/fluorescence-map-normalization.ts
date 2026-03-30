import { normalizeNumericLikeId, normalizeNumericLikeIdList } from '../../../utils/id-normalizer.util';

export const buildCanonicalNodeIdCandidates = (rawId: unknown): string[] => {
  const candidates: string[] = [];
  const pushCandidate = (value: unknown): void => {
    const normalized = String(value ?? '').trim();
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  const raw = String(rawId ?? '').trim();
  if (!raw) return [];

  pushCandidate(raw);

  const withoutSource = raw.replace(/^source-/i, '').trim();
  pushCandidate(withoutSource);

  const withoutLoc = withoutSource.replace(/^loc-/i, '').trim();
  pushCandidate(withoutLoc);

  const numeric = normalizeNumericLikeId(withoutLoc);
  if (numeric && /^\d+$/.test(numeric)) {
    pushCandidate(numeric);
    pushCandidate(`loc-${numeric}`);
    pushCandidate(`source-${numeric}`);
    pushCandidate(`source-loc-${numeric}`);
  }

  return candidates;
};

export const normalizeCanonicalId = (value: unknown): string | null => {
  const normalized = normalizeNumericLikeId(value);
  if (normalized) {
    return normalized;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const aliasStripped = raw.replace(/^source-/i, '').replace(/^loc-/i, '').trim();
  return aliasStripped || null;
};

export const normalizeCanonicalIdList = (values: unknown[]): string[] => {
  const normalized = normalizeNumericLikeIdList(values);
  if (normalized.length > 0) {
    return normalized;
  }

  return values
    .map((value) => normalizeCanonicalId(value))
    .filter((value): value is string => !!value);
};

export const normalizeStrictIdCandidates = (rawId: unknown): string[] => {
  const normalized = new Set<string>();
  buildCanonicalNodeIdCandidates(rawId).forEach((candidate) => {
    const normalizedCandidate = normalizeCanonicalId(candidate);
    if (normalizedCandidate) normalized.add(normalizedCandidate);
  });
  return Array.from(normalized.values());
};

export const normalizeManufacturerKey = (rawValue: unknown): string | null => {
  const raw = String(rawValue ?? '').trim();
  if (!raw) return null;

  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(
      /\b(incorporated|inc|corporation|corp|company|co|limited|ltd|llc|gmbh|ag|plc)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim() || null;
};

export const manufacturerKeysEquivalent = (left: unknown, right: unknown): boolean => {
  const normalizedLeft = normalizeManufacturerKey(left);
  const normalizedRight = normalizeManufacturerKey(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return true;

  const leftTokens = new Set(normalizedLeft.split(' ').filter(Boolean));
  const rightTokens = new Set(normalizedRight.split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;

  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });

  const minimumOverlap = leftTokens.size === 1 || rightTokens.size === 1 ? 1 : 2;
  return overlap >= minimumOverlap;
};

export const normalizeManufacturerCandidates = (rawValue: unknown): string[] => {
  const raw = String(rawValue ?? '').trim();
  if (!raw) return [];

  const candidates = new Set<string>();
  const push = (value: string | null | undefined): void => {
    const normalized = String(value ?? '').trim();
    if (!normalized) return;
    candidates.add(normalized);
    candidates.add(normalized.toLowerCase());
    const numericLike = normalizeCanonicalId(normalized);
    if (numericLike) {
      candidates.add(numericLike);
    }
    const manufacturerKey = normalizeManufacturerKey(normalized);
    if (manufacturerKey) {
      candidates.add(manufacturerKey);
    }
  };

  push(raw);
  push(normalizeManufacturerKey(raw));

  const normalizedWords = normalizeManufacturerKey(raw);
  const tokens = (normalizedWords ?? '').split(' ').filter(Boolean);
  if (tokens.length >= 2) {
    push(tokens.slice(0, 2).join(' '));
  }
  if (tokens.length >= 3) {
    push(tokens.slice(0, 3).join(' '));
  }

  return Array.from(candidates.values());
};

export const normalizeProjectTypeFilterKey = (
  projectTypeId: unknown,
  assessmentType?: unknown
): string | null => {
  const primary = normalizeCanonicalId(projectTypeId);
  if (primary) return primary;

  const fallback = String(assessmentType ?? '').trim();
  return fallback || null;
};
