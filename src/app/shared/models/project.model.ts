/**
 * Project model linking Client to Manufacturer Location
 * Used by Admin Project List and War Room Project HUD
 */
export type ProjectStatus = 'Open' | 'Closed' | 'Delayed';

export interface ProjectGeoLocation {
  id: number;
  latitude: number;
  longitude: number;
}

export function normalizeStatus(project: Pick<Project, 'status' | 'closed'>): ProjectStatus {
  if (project.closed === true) return 'Closed';
  if (project.closed === false) return 'Open';
  return project.status ?? 'Open';
}

export interface Project {
  id: string | number;
  projectName: string;
  clientId: string;
  clientName?: string;
  assessmentType: string; // e.g. New Build, Retrofit, Full Inspection
  /** Backend-native project type id (used for strict API create/update payloads) */
  projectTypeId?: string | number | null;
  /** Links to War Room FactoryLocation.id or Location id */
  manufacturerLocationId?: string;
  /** Backend-native location id (same semantic target as manufacturerLocationId) */
  locationId?: string | number | null;
  /** Canonical linked location ids from API v2. */
  locationIds?: number[];
  /** Canonical location coordinates from API v2. */
  locations?: ProjectGeoLocation[];
  location?: string; // Display label
  manufacturer?: string; // Display label
  status: ProjectStatus | null;
  /** Backend-native closed flag used as status source of truth */
  closed?: boolean;
  /** Backend-native update timestamp for sorting and diagnostics */
  lastUpdate?: string;
  /** Backend-native contract identifier */
  contract?: string;
  /** Backend-native road test flag */
  hasRoadTest?: boolean;
  totalAssets?: number;
  userAccess?: string[];
  /** 0-100 for mini-progress bar in Project HUD */
  progress?: number;
  /** Base64 data URL or blob URL for route preview image (Uber-style) */
  routePreviewImageUrl?: string;
}
