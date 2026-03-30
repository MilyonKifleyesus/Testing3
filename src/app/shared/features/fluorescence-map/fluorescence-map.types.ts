import { FleetSelection, MapViewMode, NodeStatus, TransitRoute } from '../../../shared/models/fluorescence-map.interface';
import { OperationalStatus } from '../../../shared/models/fluorescence-map.interface';
import { Node, ProjectRoute } from '../../../shared/models/fluorescence-map.interface';
import {
  ActivityLogRow,
  ClientManagementRow,
  ClientVm,
  LocationManagementRow,
  LocationVm,
  ManufacturerManagementRow,
  ManufacturerVm,
  ProjectVm,
} from './models/fleet-vm.models';

export type FilterStatus = 'all' | 'active' | 'inactive';
export type EndpointStatus = 'idle' | 'loading' | 'ready' | 'error';
export type FluorescenceMapLayoutPreset = 'default' | 'admin';

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

export interface FluorescenceMapManufacturerRecord {
  id: number;
  name: string;
  logo?: string;
  locationId?: number | null;
  locationIds?: number[];
  locations?: Array<{ id: number; latitude: number; longitude: number }>;
}

export interface FluorescenceMapBootstrapData {
  projects: ProjectVm[];
  clients: ClientVm[];
  manufacturers: ManufacturerVm[];
  locations: LocationVm[];
  regionValues: string[];
  nodes: Node[];
  projectRoutes: ProjectRoute[];
  transitRoutes: TransitRoute[];
  projectIds: string[];
  projectClientIdByProjectId: Map<string, string | null>;
  projectTypeIdByProjectId: Map<string, string | null>;
  manufacturerIdsByProjectId: Map<string, string[]>;
  manufacturerIdsByNodeId: Map<string, string[]>;
  projectRegionByProjectId: Map<string, string | null>;
}

export interface FluorescenceMapFilteredState {
  filtersActive: boolean;
  filteredProjectIds: Set<string>;
  filteredProjects: ProjectVm[];
  activityTableRows: ActivityLogRow[];
  clientTableRows: ClientManagementRow[];
  manufacturerTableRows: ManufacturerManagementRow[];
  locationTableRows: LocationManagementRow[];
  availableRegions: string[];
  statusCounts: { total: number; active: number; inactive: number };
  activeFilterCount: number;
  activeFilters: ActiveFilterItem[];
  filteredProjectRoutes: ProjectRoute[];
  filteredNodes: Node[];
  derivedNodeIds: DerivedNodeIds;
  strictMapNodes: Node[];
  strictMapProjectRoutes: ProjectRoute[];
  filteredTransitRoutes: TransitRoute[];
  mapViewModel: MapViewModelStrict;
  mapState: {
    showEmptyState: boolean;
    emptyMessage: string | null;
  };
}

export interface FluorescenceMapSelectionState {
  selectedEntityVisible: boolean;
  selectedRouteVisible: boolean;
  selectionInvalidated: boolean;
  noticeMessage: string | null;
  selectedProjectIdFromSelection: string | null;
}

export interface MapOverlaySnapshot {
  nodes: Node[];
  projectRoutes: ProjectRoute[];
  transitRoutes: TransitRoute[];
  selected: FleetSelection | null;
  hovered: FleetSelection | null;
  filterStatus: FilterStatus;
  emptyMessage?: string | null;
}
