import { MapViewMode, NodeStatus } from '../../../shared/models/fluorescence-map.interface';
import { OperationalStatus } from '../../../shared/models/fluorescence-map.interface';
import { Node, ProjectRoute } from '../../../shared/models/fluorescence-map.interface';

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
  coordinates?: { latitude: number; longitude: number } | null;
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

export interface DerivedNodeIds {
  fromNodeIds: Set<string>;
  toNodeIds: Set<string>;
  allNodeIds: Set<string>;
}

export interface MapRouteStrictVm {
  id: string;
  route: ProjectRoute;
}

export interface MapMarkerStrictVm {
  id: string; // markerId = nodeId
  nodeId: string;
  node: Node;
}

export interface MapLabelStrictVm {
  id: string; // labelId = nodeId
  nodeId: string;
  text: string;
  subText?: string;
}

export interface MapEmptyStateVm {
  show: boolean;
  message: string | null;
}

export interface MapViewModelStrict {
  mode: MapViewMode;
  routes: MapRouteStrictVm[];
  markers: MapMarkerStrictVm[];
  labels: MapLabelStrictVm[];
  bounds: {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  } | null;
  emptyState: MapEmptyStateVm;
}
