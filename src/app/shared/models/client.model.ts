/**
 * Client location from API (address, type)
 */
export interface ClientLocation {
  locationName: string;
  address: string;
  type: string;
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
  /** Required for map markers and project routes; seed from Company/Location or geocode */
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  /** Client locations from API */
  locations?: ClientLocation[];
}
