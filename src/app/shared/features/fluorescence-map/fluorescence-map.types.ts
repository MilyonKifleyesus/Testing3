import { MapViewMode, NodeStatus } from '../../../shared/models/fluorescence-map.interface';
import { OperationalStatus } from '../../../shared/models/fluorescence-map.interface';

export type FilterStatus = 'all' | 'active' | 'inactive';
export type EndpointStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ActiveFilterItem {
  type: 'status' | 'region' | 'client' | 'manufacturer' | 'projectType' | 'project';
  label: string;
  value: string;
}

export interface WarRoomFilters {
  status: FilterStatus;
  regions: string[];
  clientIds: string[];
  manufacturerIds: string[];
  projectTypeIds: string[];
  projectIds: string[];
}

export const createDefaultFilters = (): WarRoomFilters => ({
  status: 'all',
  regions: [],
  clientIds: [],
  manufacturerIds: [],
  projectTypeIds: [],
  projectIds: [],
});

/** Persisted state schema - supports both legacy filters-only and extended state */
export interface WarRoomPersistedState {
  mapViewMode?: MapViewMode;
  panelVisible?: boolean;
  status?: FilterStatus;
  regions?: string[];
  clientIds?: string[];
  manufacturerIds?: string[];
  projectTypeIds?: string[];
  projectIds?: string[];
  /** Legacy single-value fields for migration */
  clientId?: string;
  manufacturerId?: string;
  projectType?: string;
}

export interface CoordinateEditPayload {
  latitude?: number | null;
  longitude?: number | null;
}

export interface FactoryEditPayload extends CoordinateEditPayload {
  factoryId: string;
  name: string;
  location: string;
  description: string;
  status: NodeStatus;
}

export interface SubsidiaryEditPayload extends CoordinateEditPayload {
  subsidiaryId: string;
  name: string;
  location: string;
  description: string;
  status: OperationalStatus;
}
