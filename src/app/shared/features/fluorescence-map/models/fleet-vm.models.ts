export interface ProjectVm {
  id: string;
  projectName: string;
  clientId: string;
  clientName: string;
  assessmentType: string | null;
  projectTypeId: string | null;
  manufacturerLocationId: string | null;
  locationId: string | null;
  locationIds?: number[];
  locationName: string | null;
  manufacturerName: string | null;
  status: 'Open' | 'Closed' | 'Delayed';
  lastUpdate: string | null;
  closed: boolean | null;
  contract?: string | null;
  hasRoadTest?: boolean | null;
}

export interface ClientVm {
  id: string;
  name: string;
  locationId: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ManufacturerVm {
  id: string;
  name: string;
  locationId: string | null;
  locationIds?: number[];
  latitude: number | null;
  longitude: number | null;
}

export interface LocationVm {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

export interface ActivityLogRow {
  id: string;
  entityType: 'project';
  entityId: string;
  projectId: string;
  projectTypeId: string | null;
  projectTypeName: string | null;
  contract: string | null;
  hasRoadTest: boolean;
  entityName: string;
  status: 'Active' | 'Closed' | 'Under Inspection';
  clientId: string | null;
  clientName: string;
  clientLocationId: string | null;
  clientCoordinates: { latitude: number; longitude: number } | null;
  manufacturerId: string | null;
  manufacturerName: string;
  manufacturerLocationId: string | null;
  manufacturerCoordinates: { latitude: number; longitude: number } | null;
  locationId: string | null;
  locationIds?: number[];
  locationName: string;
  locationCoordinates: { latitude: number; longitude: number } | null;
  startDate: string | null;
  endDate: string | null;
  updatedAt: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  source: 'project_snapshot';
}

export interface DataManagementProjectDraftSection {
  name: string;
  status: ActivityLogRow['status'];
  type: string;
  projectTypeId: string;
  contract: string;
  hasRoadTest: boolean;
  clientId?: string;
  locationIds?: number[];
  manufacturerDisplay?: string;
}

export interface DataManagementLocationDraftSection {
  name: string;
  latitude: string;
  longitude: string;
}

export interface DataManagementClientDraftSection {
  name: string;
  locationIds?: number[];
  customerLogo?: string | null;
  customerLogoName?: string | null;
}

export interface DataManagementManufacturerDraftSection {
  name: string;
  locationIds?: number[];
  locationId: string;
  manufacturerLogo?: string | null;
  manufacturerLogoName?: string | null;
  disabled: boolean;
}

export interface DataManagementRowDraft {
  projectDraft: DataManagementProjectDraftSection;
  locationDraft: DataManagementLocationDraftSection;
  clientDraft: DataManagementClientDraftSection;
  manufacturerDraft: DataManagementManufacturerDraftSection;
}

export interface DataManagementSaveRequest {
  row: ActivityLogRow;
  draft: DataManagementRowDraft;
  resolve: () => void;
  reject: (reason?: string) => void;
}

export type DataManagementTab = 'projects' | 'clients' | 'manufacturers' | 'locations';

export interface ClientManagementRow {
  id: string;
  clientId: string;
  clientName: string;
  locationIds?: number[];
  linkedLocations?: Array<{ id: number; name: string }>;
  locationId: string | null;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  projectCount: number;
}

export interface ManufacturerManagementRow {
  id: string;
  manufacturerId: string;
  manufacturerName: string;
  locationIds?: number[];
  linkedLocations?: Array<{ id: number; name: string }>;
  locationId: string | null;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
}

export interface LocationManagementRow {
  id: string;
  locationId: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
}

export interface ClientManagementDraft {
  name: string;
  locationIds?: number[];
  customerLogo?: string | null;
  customerLogoName?: string | null;
}

export interface ManufacturerManagementDraft {
  name: string;
  locationIds?: number[];
  manufacturerLogo?: string | null;
  manufacturerLogoName?: string | null;
}

export interface LocationManagementDraft {
  name: string;
  latitude: string;
  longitude: string;
}

export interface ClientManagementSaveRequest {
  row: ClientManagementRow;
  draft: ClientManagementDraft;
  resolve: () => void;
  reject: (reason?: string) => void;
}

export interface ManufacturerManagementSaveRequest {
  row: ManufacturerManagementRow;
  draft: ManufacturerManagementDraft;
  resolve: () => void;
  reject: (reason?: string) => void;
}

export interface LocationManagementSaveRequest {
  row: LocationManagementRow;
  draft: LocationManagementDraft;
  resolve: () => void;
  reject: (reason?: string) => void;
}

export interface ProjectManagementCreateRequest {
  draft: DataManagementRowDraft;
  resolve: () => void;
  reject: (reason?: string) => void;
}

export interface ClientManagementCreateRequest {
  draft: ClientManagementDraft;
  resolve: () => void;
  reject: (reason?: string) => void;
}

export interface ManufacturerManagementCreateRequest {
  draft: ManufacturerManagementDraft;
  resolve: () => void;
  reject: (reason?: string) => void;
}

export interface LocationManagementCreateRequest {
  draft: LocationManagementDraft;
  resolve: () => void;
  reject: (reason?: string) => void;
}
