export interface ClientGeoLocation {
  id: number;
  latitude: number;
  longitude: number;
}

/**
 * Client location metadata.
 * Supports both legacy address-based payloads and API v2 coordinate locations.
 */
export interface ClientLocation {
  id?: number;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  address?: string;
  type?: string;
}

/**
 * Client model for War Room and project management
 * Merges concepts from ClientProfile and VehicleReportService Client
 */
export interface Client {
  id: string;
  name: string;
  code: string;
  logoUrl?: string;
  email?: string;
  phone?: string;
  /** Backend-native location id; can be used to resolve coordinates via Locations. */
  locationId?: string | number | null;
  /** Canonical linked location ids from API v2. */
  locationIds?: number[];
  /** Canonical linked geo locations from API v2. */
  geoLocations?: ClientGeoLocation[];
  /** Required for map markers and project routes; seed from Company/Location or geocode */
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  /** Client locations from API */
  locations?: ClientLocation[];
}
