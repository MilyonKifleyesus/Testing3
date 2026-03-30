/**
 * Shared coordinate validation utility.
 */
export function coerceCoordinateValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function coerceCoordinates(
  latitude: unknown,
  longitude: unknown
): { latitude: number; longitude: number } | null {
  const lat = coerceCoordinateValue(latitude);
  const lng = coerceCoordinateValue(longitude);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

export function isValidCoordinates(
  coords?: { latitude: unknown; longitude: unknown } | null
): boolean {
  if (!coords) return false;
  return coerceCoordinates(coords.latitude, coords.longitude) != null;
}
