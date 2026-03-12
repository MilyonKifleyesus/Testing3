export interface LatLng {
  lat: number;
  lng: number;
}

export const MAX_MERCATOR_LATITUDE = 85;
export const MAX_WORLD_LONGITUDE = 179.999;
export const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-MAX_WORLD_LONGITUDE, -MAX_MERCATOR_LATITUDE],
  [MAX_WORLD_LONGITUDE, MAX_MERCATOR_LATITUDE],
];

export function hasUsableCoordinates(
  lat?: number | null,
  lng?: number | null,
): lat is number {
  return lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;
}

export function normalizeLongitude(lng: number): number {
  const normalized = ((((lng + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && lng > 0 ? 180 : normalized;
}

export function clampLatitudeToMercator(lat: number): number {
  return Math.min(MAX_MERCATOR_LATITUDE, Math.max(-MAX_MERCATOR_LATITUDE, lat));
}

export function clampLngLatToWorld([lng, lat]: [number, number]): [number, number] {
  return [
    Math.min(MAX_WORLD_LONGITUDE, Math.max(-MAX_WORLD_LONGITUDE, normalizeLongitude(lng))),
    clampLatitudeToMercator(lat),
  ];
}

export function toLngLat({ lat, lng }: LatLng): [number, number] {
  return clampLngLatToWorld([lng, lat]);
}
