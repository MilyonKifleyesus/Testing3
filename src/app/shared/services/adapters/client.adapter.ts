import { Client } from '../../models/client.model';
import {
  normalizeEntityLocations,
  pickPrimaryCoordinates,
  pickPrimaryLocationId,
} from './location.adapter';

export interface ApiClientLike {
  id?: number | string;
  clientId?: number | string;
  name?: string | null;
  clientName?: string | null;
  customerName?: string | null;
  clientLogo?: string | null;
  clientLogoName?: string | null;
  customerLogo?: string | null;
  customerLogoName?: string | null;
  locationId?: number | string | null;
  locationIds?: Array<number | string | null> | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  locations?: unknown;
}

function deriveCode(name: string, id: string): string {
  const fromName = name
    .replace(/\s*\([^)]*\)/g, '')
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 4);
  return fromName || id.toUpperCase();
}

export function adaptApiClient(api: ApiClientLike): Client | null {
  const id = String(api.clientId ?? api.id ?? '').trim();
  if (!id) return null;

  const name = String(api.clientName ?? api.customerName ?? api.name ?? '').trim() || id;
  const geoLocations = normalizeEntityLocations(api.locations);
  const parsedLocationIds = Array.isArray(api.locationIds)
    ? Array.from(new Set(api.locationIds
      .map((value) => {
        if (value == null || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      })
      .filter((value): value is number => value != null)))
    : [];
  const locationIds = parsedLocationIds.length > 0 ? parsedLocationIds : geoLocations.map((location) => location.id);
  const locationId = pickPrimaryLocationId(geoLocations, api.locationId);
  const coordinates = pickPrimaryCoordinates(
    geoLocations,
    api.latitude ?? api.lat,
    api.longitude ?? api.lng
  );

  return {
    id,
    name,
    code: deriveCode(name, id),
    logoUrl: api.customerLogo ?? api.clientLogo ?? undefined,
    locationId,
    locationIds,
    geoLocations,
    coordinates,
    locations: geoLocations,
  };
}
