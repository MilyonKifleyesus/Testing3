import {
  normalizeEntityLocations,
  pickPrimaryCoordinates,
  pickPrimaryLocationId,
  NormalizedEntityLocation,
} from './location.adapter';

export interface ApiManufacturerLike {
  id?: number | string | null;
  manufacturerName?: string | null;
  manufacturerLogo?: string | null;
  manufacturerLogoName?: string | null;
  locationId?: number | string | null;
  latitude?: number | null;
  longitude?: number | null;
  locations?: unknown;
  locationIds?: Array<number | string | null> | null;
  uniqueId?: string | null;
  lastUpdate?: string | null;
}

export interface NormalizedManufacturer {
  id: number;
  manufacturerName: string;
  manufacturerLogo?: string | null;
  manufacturerLogoName?: string | null;
  locations: NormalizedEntityLocation[];
  locationIds: number[];
  primaryLocationId: number | null;
  locationId: number | null;
  latitude: number | null;
  longitude: number | null;
  uniqueId?: string | null;
  lastUpdate?: string | null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function adaptApiManufacturer(api: ApiManufacturerLike): NormalizedManufacturer | null {
  const id = parseNullableNumber(api.id);
  if (id == null) return null;

  const locations = normalizeEntityLocations(api.locations);
  const locationIdsFromArray = Array.isArray(api.locationIds)
    ? Array.from(new Set(api.locationIds
      .map((value) => parseNullableNumber(value))
      .filter((value): value is number => value != null)))
    : [];
  const locationIds = locationIdsFromArray.length > 0 ? locationIdsFromArray : locations.map((location) => location.id);
  const primaryLocationId = pickPrimaryLocationId(locations, api.locationId);
  const primaryCoordinates = pickPrimaryCoordinates(locations, api.latitude, api.longitude);

  return {
    id,
    manufacturerName: String(api.manufacturerName ?? '').trim(),
    manufacturerLogo: api.manufacturerLogo ?? null,
    manufacturerLogoName: api.manufacturerLogoName ?? null,
    locations,
    locationIds,
    primaryLocationId,
    locationId: primaryLocationId,
    latitude: primaryCoordinates?.latitude ?? null,
    longitude: primaryCoordinates?.longitude ?? null,
    uniqueId: api.uniqueId ?? null,
    lastUpdate: api.lastUpdate ?? null,
  };
}
