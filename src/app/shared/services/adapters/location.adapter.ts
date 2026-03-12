export interface ApiLocationLike {
  id?: number | string | null;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  uniqueId?: string | null;
  lastUpdate?: string | null;
}

export interface NormalizedEntityLocation {
  id: number;
  latitude: number;
  longitude: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeEntityLocations(raw: unknown): NormalizedEntityLocation[] {
  if (!Array.isArray(raw)) return [];

  const normalized: NormalizedEntityLocation[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;

    const id = parseNullableNumber(record['id']);
    const latitude = parseNullableNumber(record['latitude']);
    const longitude = parseNullableNumber(record['longitude']);
    if (id == null || latitude == null || longitude == null) continue;

    normalized.push({ id, latitude, longitude });
  }

  return normalized;
}

export function adaptApiLocation(raw: ApiLocationLike): {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  uniqueId?: string;
  lastUpdate?: string;
} | null {
  const id = parseNullableNumber(raw.id);
  if (id == null) return null;

  return {
    id,
    name: String(raw.name ?? '').trim(),
    latitude: parseNullableNumber(raw.latitude) ?? 0,
    longitude: parseNullableNumber(raw.longitude) ?? 0,
    uniqueId: raw.uniqueId ?? undefined,
    lastUpdate: raw.lastUpdate ?? undefined,
  };
}

export function pickPrimaryLocationId(
  locations: NormalizedEntityLocation[],
  fallbackRawLocationId?: unknown
): number | null {
  if (locations.length > 0) return locations[0].id;
  const fallback = parseNullableNumber(fallbackRawLocationId);
  return fallback != null ? fallback : null;
}

export function pickPrimaryCoordinates(
  locations: NormalizedEntityLocation[],
  fallbackLatitude?: unknown,
  fallbackLongitude?: unknown
): { latitude: number; longitude: number } | undefined {
  if (locations.length > 0) {
    return {
      latitude: locations[0].latitude,
      longitude: locations[0].longitude,
    };
  }

  const latitude = parseNullableNumber(fallbackLatitude);
  const longitude = parseNullableNumber(fallbackLongitude);
  if (latitude == null || longitude == null) return undefined;
  return { latitude, longitude };
}

