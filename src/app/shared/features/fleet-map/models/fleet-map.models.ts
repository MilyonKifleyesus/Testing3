export interface ApiClient {
  id: string;
  name: string;
  logoUrl?: string;
  lat: number | null;
  lng: number | null;
  locationIds: string[];
}

export interface ApiManufacturer {
  id: string;
  name: string;
  logoUrl?: string;
  lat: number | null;
  lng: number | null;
  locationIds: string[];
}

export interface ApiLocation {
  id: string;
  manufacturerId?: string;
  name: string;
  lat: number | null;
  lng: number | null;
  type?: string;
  uniqueId?: string;
  lastUpdate?: string;
}

export interface ApiProject {
  id: string;
  name: string;
  clientId: string;
  lat: number | null;
  lng: number | null;
  locationId: string | null;
  locationIds: string[];
  type: string;
  typeId: string | null;
  status: 'active' | 'inactive';
  description?: string;
  lastUpdate?: string;
}

export interface ApiProjectType {
  id: string;
  name: string;
}

export type FleetMode = 'projects' | 'clients' | 'manufacturers';
export type FleetTab = 'projects' | 'clients' | 'manufacturers' | 'locations';
export type FleetStatus = 'connected' | 'connecting' | 'fallback' | 'offline';
export type FleetFilterKind = 'projects' | 'clients' | 'manufacturers' | 'types' | 'statuses';

export type FleetSelectedEntity =
  | { kind: 'project'; data: ApiProject }
  | { kind: 'client'; data: ApiClient }
  | { kind: 'manufacturer'; data: ApiManufacturer }
  | { kind: 'location'; data: ApiLocation };

export interface FleetFilterOption {
  id: string;
  label: string;
}

export interface FleetFilterChip {
  key: string;
  label: string;
  kind: FleetFilterKind;
  value: string;
}

export interface FleetStats {
  totalProjects: number;
  activeProjects: number;
  inactiveProjects: number;
  totalClients: number;
}
