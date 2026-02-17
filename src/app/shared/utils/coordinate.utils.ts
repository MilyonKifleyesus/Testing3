/**
 * Shared coordinate validation utility.
 */
export function isValidCoordinates(
  coords?: { latitude: number; longitude: number } | null
): boolean {
  if (!coords) return false;
  if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return false;
  if (coords.latitude === 0 && coords.longitude === 0) return false;
  return true;
}
