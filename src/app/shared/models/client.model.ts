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
}
