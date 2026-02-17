/**
 * Shared coordinate validation utility.
 */
export function isValidCoordinates(
  coords?: { latitude: number; longitude: number } | null
): boolean {
  if (!coords) return false;
  if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return false;
  if (coords.latitude < -90 || coords.latitude > 90) return false;
  if (coords.longitude < -180 || coords.longitude > 180) return false;
  return true;
}
