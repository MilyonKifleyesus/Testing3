import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, map, switchMap, catchError, Subject, startWith, combineLatest, forkJoin, throwError, timeout } from 'rxjs';
import { Project, ProjectStatus } from '../models/project.model';
import { Client } from '../models/client.model';
import {
  ProjectRoute,
  ParentGroup,
  SubsidiaryCompany,
  ManufacturerLocation,
  Hub,
  QuantumChartData,
} from '../models/fluorescence-map.interface';
import { ClientService } from './client.service';
import { LocationService, ApiLocation } from './location.service';
import { environment } from '../../../environments/environment';

type ProjectEnvironmentConfig = typeof environment & {
  apiBaseUrl?: string;
};

export interface ProjectFilters {
  clientId?: string;
  projectType?: string; // assessmentType value
  manufacturer?: string; // Project.manufacturer e.g. Nova Bus, New Flyer, ARBOC
  manufacturerLocationId?: string;
  status?: ProjectStatus;
  /** Project statuses to include (e.g. ['Open'] for active, ['Closed','Delayed'] for inactive). Takes precedence over status when set. */
  projectStatuses?: ProjectStatus[];
  /** Array filters (multi-select). Take precedence when non-empty. */
  clientIds?: string[];
  manufacturerIds?: string[];
  projectTypeIds?: string[];
  projectIds?: string[];
}

export interface FilterOptionWithCount {
  id: string;
  name: string;
  count: number;
}

export interface ProjectCounts {
  total: number;
  open: number;
  closed: number;
  delayed: number;
}

/** API response shape for projects (supports both snake_case and camelCase) */
export interface ApiProject {
  id?: number | string;
  project_id?: number | string;
  projectName?: string;
  project_name?: string;
  /** BusPulseApi ProjectListItemDto: project display name */
  name?: string | null;
  client?: string | null;
  clientId?: string | null;
  assessmentType?: string | null;
  assessment_type?: string | null;
  projectTypeName?: string | null;
  projectType?: string | null;
  projectTypeId?: number | null;
  location?: string | null;
  locationId?: number | string | null;
  status?: string | null;
  /** BusPulseApi: boolean, true = Closed, false = Open */
  closed?: boolean;
  lastUpdate?: string | null;
  manufacturer?: string | null;
  manufacturerLocationId?: string | null;
  manufacturer_id?: number | null;
  factory_id?: number | null;
}

/** API response shape for manufacturers */
export interface ApiManufacturer {
  id: number;
  manufacturerName: string;
  manufacturerLogo?: string | null;
  manufacturerLogoName?: string | null;
  locationId?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface ApiManufacturerDetail extends ApiManufacturer {
  uniqueId?: string | null;
  lastUpdate?: string | null;
}

/** API response shape for manufacturer locations */
export interface ApiManufacturerLocation {
  factory_id: number;
  manufacturer_id: number;
  factory_location_name: string;
  city?: string | null;
  state_province?: string | null;
  country?: string | null;
  full_address?: string | null;
  facility_type?: string | null;
  notes?: string | null;
}

export interface ManufacturerLocationMapping {
  manufacturerLocationIdToWarRoom?: Record<string, string>;
  /** @deprecated Use manufacturerLocationIdToWarRoom */
  factoryIdToWarRoom?: Record<string, string>;
  aliases?: Record<string, string>;
}

/** Manufacturer location option for Add Project modal dropdown */
export interface ManufacturerLocationOption {
  manufacturerLocationId: number;
  /** @deprecated Use manufacturerLocationId */
  factoryId?: number;
  manufacturerId: number;
  manufacturerName: string;
  label: string;
  factory_location_name: string;
  city?: string | null;
  state_province?: string | null;
  country?: string | null;
}

/** @deprecated Use ApiManufacturerLocation */
export type ApiFactory = ApiManufacturerLocation;
/** @deprecated Use ManufacturerLocationMapping */
export type FactoryIdMapping = ManufacturerLocationMapping;
/** @deprecated Use ManufacturerLocationOption */
export type FactoryOption = ManufacturerLocationOption;

function parseManufacturerLocationId(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function parseNumericId(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeApiResponse(raw: unknown): ApiProject[] {
  if (raw && typeof raw === 'object' && 'items' in raw) {
    return (raw as { items: ApiProject[] }).items ?? [];
  }
  if (raw && typeof raw === 'object' && 'projects' in raw) {
    return (raw as { projects: ApiProject[] }).projects;
  }
  if (Array.isArray(raw)) {
    return raw as ApiProject[];
  }
  return [];
}

function normalizeApiProject(api: ApiProject): {
  id: number | string | null;
  projectName: string;
  client: string | null;
  assessmentType: string;
  projectTypeId: number | null;
  locationId: number | null;
  closed: boolean | null;
  lastUpdate: string | null;
  status: string | null;
  manufacturerLocationId: number | null;
} {
  const id = api.project_id ?? api.id;
  const projectName =
    api.project_name ?? api.projectName ?? api.name ?? '';
  const client = api.client?.trim() ?? null;
  const assessmentType =
    api.assessment_type ??
    api.assessmentType ??
    api.projectTypeName ??
    api.projectType ??
    '';
  const projectTypeId = parseNumericId(api.projectTypeId);
  const locationId = parseNumericId(api.locationId);
  const closed = typeof api.closed === 'boolean' ? api.closed : null;
  const lastUpdate = api.lastUpdate ?? null;
  const manufacturerLocationId =
    parseManufacturerLocationId(api.manufacturerLocationId) ??
    parseManufacturerLocationId(api.factory_id) ??
    parseManufacturerLocationId(api.locationId);
  const status =
    typeof api.closed === 'boolean'
      ? api.closed
        ? 'Closed'
        : 'Open'
      : (api.status ?? null);
  return {
    id: id ?? null,
    projectName,
    client,
    assessmentType,
    projectTypeId,
    locationId,
    closed,
    lastUpdate,
    status,
    manufacturerLocationId,
  };
}

function resolveClientId(api: ApiProject, clients: Client[]): string | null {
  if (api.clientId != null && api.clientId !== '') return String(api.clientId);
  const cm = api.client?.trim();
  if (!cm) return null;
  const c = clients.find(
    (x) => x.code?.toLowerCase() === cm.toLowerCase() || x.name?.toLowerCase() === cm.toLowerCase()
  );
  return c?.id ?? null;
}

/**
 * Maps API status to UI status. Active/Inactive are normalized to Open/Closed for HUD badges and filters.
 */
function mapApiStatus(apiStatus: string | null | undefined): ProjectStatus | null {
  if (apiStatus === 'Closed' || apiStatus === 'Inactive') return 'Closed';
  if (apiStatus === 'Delayed') return 'Delayed';
  if (apiStatus === 'Open' || apiStatus === 'Active') return 'Open';
  return null;
}

function mapApiProjectToProject(
  api: ApiProject,
  clients: Client[],
  manufacturers: ApiManufacturer[] = [],
  locations: ApiLocation[] = []
): Project | null {
  const norm = normalizeApiProject(api);
  if (norm.id == null) return null;
  const clientId = resolveClientId(api, clients);
  if (!clientId) return null;

  const status = mapApiStatus(norm.status);
  const client = clients.find((c) => c.id === clientId);

  const manufacturerByLocation = norm.locationId != null
    ? manufacturers.find((m) => parseNumericId(m.locationId) === norm.locationId)
    : undefined;
  const locationById = norm.locationId != null
    ? locations.find((l) => l.id === norm.locationId)
    : undefined;

  const manufacturer = api.manufacturer ?? manufacturerByLocation?.manufacturerName ?? undefined;
  const location = api.location ?? locationById?.name ?? undefined;
  const manufacturerLocationId =
    api.manufacturerLocationId ??
    (norm.manufacturerLocationId != null
      ? String(norm.manufacturerLocationId)
      : (norm.locationId != null ? String(norm.locationId) : undefined));

  return {
    id: norm.id,
    projectName: norm.projectName,
    clientId,
    clientName: norm.client ?? client?.name ?? clientId,
    assessmentType: norm.assessmentType,
    projectTypeId: norm.projectTypeId ?? undefined,
    locationId: norm.locationId ?? undefined,
    location,
    manufacturer,
    manufacturerLocationId,
    closed: norm.closed ?? undefined,
    lastUpdate: norm.lastUpdate ?? undefined,
    status,
  };
}

function applyFilters(projects: Project[], filters?: ProjectFilters): Project[] {
  let result = [...projects];
  if (filters?.clientIds?.length) {
    result = result.filter((p) => p.clientId != null && filters.clientIds!.includes(p.clientId));
  } else if (filters?.clientId && filters.clientId !== 'all') {
    result = result.filter((p) => p.clientId === filters.clientId);
  }
  if (filters?.manufacturerLocationId) {
    result = result.filter((p) => p.manufacturerLocationId === filters.manufacturerLocationId);
  }
  if (filters?.manufacturerIds?.length) {
    result = result.filter((p) => p.manufacturer && filters.manufacturerIds!.includes(p.manufacturer));
  } else if (filters?.manufacturer && filters.manufacturer !== 'all') {
    result = result.filter((p) => p.manufacturer === filters!.manufacturer);
  }
  if (filters?.projectTypeIds?.length) {
    result = result.filter((p) => p.assessmentType && filters.projectTypeIds!.includes(p.assessmentType));
  } else if (filters?.projectType && filters.projectType !== 'all') {
    result = result.filter((p) => p.assessmentType === filters!.projectType);
  }
  if (filters?.projectIds?.length) {
    result = result.filter((p) => filters.projectIds!.includes(String(p.id)));
  }
  if (filters?.projectStatuses?.length) {
    result = result.filter(
      (p) => p.status != null && filters.projectStatuses!.includes(p.status)
    );
  } else if (filters?.status) {
    result = result.filter((p) => p.status === filters.status);
  }
  return result;
}

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  private readonly envConfig = environment as ProjectEnvironmentConfig;
  private readonly API_BASE_URL = this.envConfig.apiBaseUrl ?? 'https://api.fleetpulse.net/api';

  private readonly projectsRefresh$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    private clientService: ClientService,
    private locationService: LocationService
  ) {}

  private getManufacturersApi$(): Observable<ApiManufacturer[]> {
    return this.http
      .get<{ items?: ApiManufacturer[] }>(`${this.API_BASE_URL}/Manufacturers`)
      .pipe(
        timeout(10000),
        map((res) => res?.items ?? []),
        catchError((err) => {
          console.warn('Manufacturers API request failed, using empty fallback:', err);
          return of([] as ApiManufacturer[]);
        })
      );
  }

  private getManufacturerById(id: string | number): Observable<ApiManufacturerDetail | null> {
    return this.http
      .get<ApiManufacturerDetail>(`${this.API_BASE_URL}/Manufacturers/${id}`)
      .pipe(
        catchError((err) => {
          console.warn(`Manufacturer lookup failed for id=${id}:`, err);
          return of(null);
        })
      );
  }

  updateManufacturer(
    id: string | number,
    updates: Partial<Pick<ApiManufacturerDetail, 'manufacturerName' | 'manufacturerLogo' | 'manufacturerLogoName' | 'locationId'>>
  ): Observable<ApiManufacturerDetail | null> {
    return this.getManufacturerById(id).pipe(
      switchMap((existing) => {
        if (!existing) return of(null);
        const body = {
          manufacturerName: updates.manufacturerName ?? existing.manufacturerName,
          manufacturerLogo: updates.manufacturerLogo ?? existing.manufacturerLogo ?? null,
          manufacturerLogoName: updates.manufacturerLogoName ?? existing.manufacturerLogoName ?? null,
          locationId: updates.locationId ?? existing.locationId ?? 0,
        };
        return this.http.put<unknown>(`${this.API_BASE_URL}/Manufacturers/${id}`, body).pipe(
          switchMap(() => this.getManufacturerById(id)),
          catchError((err) => {
            console.error(`Failed to update manufacturer id=${id}:`, err);
            return throwError(() => err);
          })
        );
      })
    );
  }

  getManufacturerLocationsWithManufacturers(): Observable<ManufacturerLocationOption[]> {
    return forkJoin({
      manufacturers: this.getManufacturersApi$(),
      locations: this.locationService.getAllLocations(),
    }).pipe(
      map(({ manufacturers, locations }) => {
        const manufacturerByLocationId = new Map<number, ApiManufacturer>();
        for (const m of manufacturers) {
          const locId = parseNumericId(m.locationId);
          if (locId == null || manufacturerByLocationId.has(locId)) continue;
          manufacturerByLocationId.set(locId, m);
        }

        return locations
          .map((loc) => {
            const mfr = manufacturerByLocationId.get(loc.id);
            const mfrName = mfr?.manufacturerName ?? 'Unknown';
            const label = mfr
              ? `${mfrName} - ${loc.name}`
              : `Location - ${loc.name}`;
            return {
              manufacturerLocationId: loc.id,
              factoryId: loc.id,
              manufacturerId: mfr?.id ?? 0,
              manufacturerName: mfrName,
              label,
              factory_location_name: loc.name,
              city: this.parseLocationName(loc.name).city,
              state_province: null,
              country: null,
            } as ManufacturerLocationOption;
          })
          .sort((a, b) => a.label.localeCompare(b.label));
      }),
      catchError(() => of([]))
    );
  }

  getFactoriesWithManufacturers(): Observable<FactoryOption[]> {
    return this.getManufacturerLocationsWithManufacturers();
  }

  /** Resolve WarRoom factory id to FactoryOption for modal pre-selection */
  getManufacturerLocationOptionForWarRoomId(warRoomId: string): Observable<ManufacturerLocationOption | null> {
    return this.getManufacturerLocationsWithManufacturers().pipe(
      map((opts) =>
        opts.find((o) => String(o.manufacturerLocationId) === warRoomId) ??
        opts.find((o) => String(o.factoryId) === warRoomId) ??
        null
      ),
      catchError(() => of(null))
    );
  }

  /** Resolve WarRoom factory/manufacturer id to ManufacturerLocationOption for modal pre-selection */
  getFactoryOptionForWarRoomId(warRoomId: string): Observable<FactoryOption | null> {
    return this.getManufacturerLocationOptionForWarRoomId(warRoomId);
  }

  refreshProjects(): void {
    this.projectsRefresh$.next();
  }

  getProjectsWithRefresh(filters?: ProjectFilters): Observable<Project[]> {
    return this.projectsRefresh$.pipe(
      startWith(void 0),
      switchMap(() => this.getProjects(filters))
    );
  }

  private getProjectsApi$(): Observable<unknown> {
    const params = new HttpParams().set('includeClosed', 'true');
    return this.http
      .get<unknown>(`${this.API_BASE_URL}/Projects`, { params })
      .pipe(
        timeout(10000),
        catchError((err) => {
          console.warn('Projects API request failed, using empty fallback:', err);
          return of([] as ApiProject[]);
        })
      );
  }

  getProjects(filters?: ProjectFilters): Observable<Project[]> {
    return forkJoin({
      clients: this.clientService.getClients(),
      manufacturers: this.getManufacturersApi$(),
      locations: this.locationService.getAllLocations(),
      raw: this.getProjectsApi$(),
    }).pipe(
      map(({ clients, manufacturers, locations, raw }) => {
        const apiProjects = normalizeApiResponse(raw);
        const projects = apiProjects
          .map((api) => mapApiProjectToProject(api, clients, manufacturers, locations))
          .filter((p): p is Project => p != null);
        return applyFilters(projects, filters);
      })
    );
  }

  getProjectsByFactory(manufacturerLocationId: string): Observable<Project[]> {
    return this.getProjects({ manufacturerLocationId });
  }

  getProjectsByManufacturerLocation(manufacturerLocationId: string): Observable<Project[]> {
    return this.getProjects({ manufacturerLocationId });
  }

  getProjectsByClient(clientId: string): Observable<Project[]> {
    return this.getProjects({ clientId });
  }

  resolveProjectTypeIdByName(typeName: string): Observable<number | null> {
    const normalized = typeName.trim().toLowerCase();
    if (!normalized) return of(null);
    return this.getProjects({}).pipe(
      map((projects) => {
        const match = projects.find(
          (p) => p.assessmentType?.trim().toLowerCase() === normalized && p.projectTypeId != null
        );
        return match?.projectTypeId ?? null;
      }),
      catchError(() => of(null))
    );
  }

  private buildProjectUpsertPayload(project: Omit<Project, 'id'> | Project): {
    name: string;
    clientId: number;
    locationId: number;
    projectTypeId: number;
    contract: string;
    hasRoadTest: boolean;
  } {
    const clientId = parseNumericId(project.clientId);
    const locationId =
      parseNumericId(project.locationId) ??
      parseManufacturerLocationId(project.manufacturerLocationId);
    const projectTypeId = parseNumericId(project.projectTypeId);
    if (clientId == null || locationId == null || projectTypeId == null) {
      throw new Error('Missing required API fields: clientId, locationId, or projectTypeId.');
    }
    return {
      name: project.projectName,
      clientId,
      locationId,
      projectTypeId,
      contract: '',
      hasRoadTest: false,
    };
  }

  private mapProjectById(projectId: number, fallback: Omit<Project, 'id'> | Project): Observable<Project> {
    return forkJoin({
      clients: this.clientService.getClients(),
      manufacturers: this.getManufacturersApi$(),
      locations: this.locationService.getAllLocations(),
      raw: this.http.get<unknown>(`${this.API_BASE_URL}/Projects/${projectId}`).pipe(
        timeout(10000),
        catchError((err) => {
          console.warn(`Project lookup failed for id=${projectId}, using fallback:`, err);
          return of(null);
        })
      ),
    }).pipe(
      map(({ clients, manufacturers, locations, raw }) => {
        if (!raw) {
          return ({ ...fallback, id: projectId } as Project);
        }
        const api = raw as ApiProject;
        const mapped = mapApiProjectToProject(api, clients, manufacturers, locations);
        return mapped ?? ({ ...fallback, id: projectId } as Project);
      })
    );
  }

  addProject(project: Omit<Project, 'id'>): Observable<Project> {
    let body: {
      name: string;
      clientId: number;
      locationId: number;
      projectTypeId: number;
      contract: string;
      hasRoadTest: boolean;
    };
    try {
      body = this.buildProjectUpsertPayload(project);
    } catch (err) {
      return throwError(() => err);
    }

    return this.http
      .post<{ id?: number | string }>(`${this.API_BASE_URL}/Projects`, body)
      .pipe(
        switchMap((created) => {
          const createdId = parseNumericId(created?.id);
          if (createdId == null) {
            throw new Error('Project create response did not include id.');
          }
          return this.mapProjectById(createdId, project);
        }),
        catchError((err) => {
          console.error('Failed to add project:', err);
          return throwError(() => err);
        })
      );
  }

  updateProject(project: Project): Observable<Project> {
    const projectId = parseNumericId(project.id);
    if (projectId == null) {
      return throwError(() => new Error('Invalid project id for update.'));
    }

    let body: {
      name: string;
      clientId: number;
      locationId: number;
      projectTypeId: number;
      contract: string;
      hasRoadTest: boolean;
    };
    try {
      body = this.buildProjectUpsertPayload(project);
    } catch (err) {
      return throwError(() => err);
    }

    return this.http
      .put<unknown>(`${this.API_BASE_URL}/Projects/${projectId}`, body)
      .pipe(
        switchMap(() => this.mapProjectById(projectId, project)),
        catchError((err) => {
          console.error('Failed to update project:', err);
          return throwError(() => err);
        })
      );
  }

  getProjectCounts(clientId?: string): Observable<ProjectCounts> {
    return this.getProjects(clientId ? { clientId } : {}).pipe(
      map((projects) => ({
        total: projects.length,
        open: projects.filter((p) => (p.status ?? 'Open') === 'Open').length,
        closed: projects.filter((p) => p.status === 'Closed').length,
        delayed: projects.filter((p) => p.status === 'Delayed').length,
      }))
    );
  }

  getProjectTypes(): Observable<string[]> {
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) =>
        [...new Set(projects.map((p) => p.assessmentType).filter((v): v is string => !!v))].sort()
      )
    );
  }

  getManufacturers(): Observable<string[]> {
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) =>
        [...new Set(projects.map((p) => p.manufacturer).filter((v): v is string => !!v))].sort()
      )
    );
  }

  /**
   * Fetches manufacturers from backend API for filter dropdown.
   * API returns { items: [{ id, manufacturerName, manufacturerLogo, locationId }] }
   */
  getManufacturersFromApi(): Observable<FilterOptionWithCount[]> {
    return this.http
      .get<{ items?: { id: number; manufacturerName: string; manufacturerLogo?: string }[] }>(
        `${this.API_BASE_URL}/Manufacturers`
      )
      .pipe(
        map((res) => {
          const items = res?.items ?? [];
          return items.map((m) => ({
            id: m.manufacturerName,
            name: m.manufacturerName,
            count: 0,
          })).sort((a, b) => a.name.localeCompare(b.name));
        }),
        catchError((err) => {
          console.warn('Manufacturers API failed:', err);
          return of([]);
        })
      );
  }

  /**
   * Fetches manufacturers with logos for activity log enrichment.
   * API returns { items: [{ id, manufacturerName, manufacturerLogo }] }
   */
  getManufacturersWithLogos(): Observable<{ id: number; name: string; logo?: string }[]> {
    return this.http
      .get<{ items?: { id: number; manufacturerName: string; manufacturerLogo?: string }[] }>(
        `${this.API_BASE_URL}/Manufacturers`
      )
      .pipe(
        map((res) => {
          const items = res?.items ?? [];
          return items.map((m) => ({
            id: m.id,
            name: m.manufacturerName,
            logo: m.manufacturerLogo ?? undefined,
          })).sort((a, b) => a.name.localeCompare(b.name));
        }),
        catchError((err) => {
          console.warn('Manufacturers API failed:', err);
          return of([]);
        })
      );
  }

  getManufacturersForHierarchy(): Observable<ApiManufacturer[]> {
    return this.getManufacturersApi$();
  }

  /**
   * Builds the full manufacturer hierarchy (ParentGroup[]) from API.
   * Uses Manufacturers and Locations only (strict API mode).
   */
  buildParentGroupsFromApi(): Observable<ParentGroup[]> {
    return forkJoin({
      manufacturers: this.getManufacturersApi$(),
      locations: this.locationService.getAllLocations(),
    }).pipe(
      map(({ manufacturers, locations }) => {
        const parentGroupId = 'api-manufacturers';
        const subsidiaries: SubsidiaryCompany[] = manufacturers.map((mfr) => {
          const subsidiaryId = String(mfr.id);
          const locationsForMfr = this.getLocationsForManufacturer(mfr, locations);
          const manufacturerLocations: ManufacturerLocation[] = locationsForMfr.map((loc) => {
            const { city, country } = this.parseLocationName(loc.name);
            return {
              id: String(loc.id),
              parentGroupId,
              subsidiaryId,
              name: loc.name,
              city: city || loc.name,
              country: country || undefined,
              coordinates: { latitude: loc.latitude, longitude: loc.longitude },
              status: 'ACTIVE' as const,
              syncStability: 90,
              assets: 0,
              incidents: 0,
            };
          });
          const subsidiaryMetrics = this.deriveSubsidiaryMetrics(manufacturerLocations);
          const firstLoc = locationsForMfr[0];
          const firstCity = firstLoc ? this.parseLocationName(firstLoc.name).city : undefined;
          return {
            id: subsidiaryId,
            parentGroupId,
            name: mfr.manufacturerName,
            status: 'ACTIVE' as const,
            metrics: subsidiaryMetrics,
            manufacturerLocations,
            factories: manufacturerLocations,
            hubs: [] as Hub[],
            quantumChart: this.deriveQuantumChart(manufacturerLocations, subsidiaryMetrics),
            location: firstCity,
            logo: mfr.manufacturerLogo ?? undefined,
          };
        });
        const groupMetrics = subsidiaries.reduce(
          (acc, sub) => ({
            assetCount: acc.assetCount + (sub.metrics.assetCount ?? 0),
            incidentCount: acc.incidentCount + (sub.metrics.incidentCount ?? 0),
            syncStability: acc.syncStability + (sub.metrics.syncStability ?? 0),
          }),
          { assetCount: 0, incidentCount: 0, syncStability: 0 }
        );
        const subsidiaryCount = subsidiaries.length || 1;
        return [{
          id: parentGroupId,
          name: 'Manufacturers',
          status: 'ACTIVE' as const,
          metrics: {
            assetCount: groupMetrics.assetCount,
            incidentCount: groupMetrics.incidentCount,
            syncStability: Math.round((groupMetrics.syncStability / subsidiaryCount) * 10) / 10,
          },
          subsidiaries,
        }] as ParentGroup[];
      })
    );
  }

  private deriveSubsidiaryMetrics(locations: ManufacturerLocation[]): {
    assetCount: number;
    incidentCount: number;
    syncStability: number;
  } {
    const rawAssetCount = locations.reduce((sum, loc) => sum + Number(loc.assets ?? 0), 0);
    const assetCount = rawAssetCount > 0 ? rawAssetCount : locations.length;
    const incidentCount = locations.reduce((sum, loc) => sum + Number(loc.incidents ?? 0), 0);
    const weightedSync = locations.reduce(
      (sum, loc) => sum + Number(loc.syncStability ?? 0) * Math.max(1, Number(loc.assets ?? 0)),
      0
    );
    const totalWeight = locations.reduce((sum, loc) => sum + Math.max(1, Number(loc.assets ?? 0)), 0);
    const syncStability = totalWeight > 0 ? Math.round((weightedSync / totalWeight) * 10) / 10 : 0;
    return { assetCount, incidentCount, syncStability };
  }

  private deriveQuantumChart(
    locations: ManufacturerLocation[],
    metrics: { assetCount: number; incidentCount: number; syncStability: number }
  ): QuantumChartData {
    // TODO: Replace with backend metrics API when available (use locationsForMfr/manufacturerLocations).
    const base = Math.max(0, Math.min(100, Math.round(metrics.syncStability)));
    const spread = Math.min(12, Math.max(3, locations.length * 2));
    const points = [
      Math.max(0, base - spread),
      Math.max(0, base - Math.ceil(spread * 0.4)),
      base,
      Math.min(100, base + Math.ceil(spread * 0.3)),
      Math.min(100, base + spread),
      Math.max(0, base - Math.floor(spread * 0.2)),
    ];
    return { dataPoints: points, highlightedIndex: 4 };
  }

  private getLocationsForManufacturer(
    mfr: ApiManufacturer,
    locations: ApiLocation[]
  ): ApiLocation[] {
    const result: ApiLocation[] = [];
    const seen = new Set<number>();
    const mfrNameNorm = mfr.manufacturerName.trim().toLowerCase();
    const mfrNameInParens = `(${mfr.manufacturerName})`;
    const mfrNameInParensLower = mfrNameInParens.toLowerCase();

    for (const loc of locations) {
      if (seen.has(loc.id)) continue;
      const mfrLocationId = parseNumericId(mfr.locationId);
      const isPrimary = mfrLocationId != null && loc.id === mfrLocationId;
      const nameContainsMfr = loc.name.toLowerCase().includes(mfrNameInParensLower) ||
        loc.name.toLowerCase().includes(mfrNameNorm);
      if (isPrimary || nameContainsMfr) {
        result.push(loc);
        seen.add(loc.id);
      }
    }
    const mfrLocationId = parseNumericId(mfr.locationId);
    if (result.length === 0 && mfrLocationId != null) {
      const primary = locations.find((l) => l.id === mfrLocationId);
      if (primary) result.push(primary);
    }
    return result;
  }

  private parseLocationName(name: string): { city: string; country: string } {
    const match = name.match(/^([^(]+)\s*\([^)]+\)$/);
    if (match) {
      return { city: match[1].trim(), country: '' };
    }
    return { city: name.trim(), country: '' };
  }

  getClientOptionsWithCounts(): Observable<FilterOptionWithCount[]> {
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) => {
        const byId = new Map<string, { name: string; count: number }>();
        for (const p of projects) {
          if (!p.clientId) continue;
          const existing = byId.get(p.clientId);
          const name = p.clientName ?? p.clientId;
          if (existing) {
            existing.count++;
          } else {
            byId.set(p.clientId, { name, count: 1 });
          }
        }
        return Array.from(byId.entries())
          .map(([id, { name, count }]) => ({ id, name, count }))
          .sort((a, b) => a.name.localeCompare(b.name));
      })
    );
  }

  getManufacturerOptionsWithCounts(): Observable<FilterOptionWithCount[]> {
    return combineLatest([
      this.getManufacturersFromApi(),
      this.getProjectsWithRefresh({}),
    ]).pipe(
      map(([apiManufacturers, projects]) => {
        const countByManufacturer = new Map<string, number>();
        for (const p of projects) {
          if (p.manufacturer) {
            countByManufacturer.set(
              p.manufacturer,
              (countByManufacturer.get(p.manufacturer) ?? 0) + 1
            );
          }
        }
        return apiManufacturers.map((m) => ({
          ...m,
          count: countByManufacturer.get(m.name) ?? 0,
        }));
      })
    );
  }

  getProjectTypeOptionsWithCounts(): Observable<FilterOptionWithCount[]> {
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) => {
        const byId = new Map<string, number>();
        for (const p of projects) {
          if (!p.assessmentType) continue;
          byId.set(p.assessmentType, (byId.get(p.assessmentType) ?? 0) + 1);
        }
        return Array.from(byId.entries())
          .map(([id, count]) => ({ id, name: id, count }))
          .sort((a, b) => a.name.localeCompare(b.name));
      })
    );
  }

  getProjectOptionsWithCounts(): Observable<FilterOptionWithCount[]> {
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) =>
        projects
          .map((p) => ({
            id: String(p.id),
            name: p.projectName ?? String(p.id),
            count: 1,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      )
    );
  }

  /**
   * Returns projects with resolved coordinates for map route drawing.
   * Resolves client coords from ClientService, factory coords from War Room FactoryLocation.
   */
  getProjectsForMap(
    clientCoordinates: Map<string, { latitude: number; longitude: number }>,
    factoryCoordinates: Map<string, { latitude: number; longitude: number }>,
    filters?: ProjectFilters
  ): Observable<ProjectRoute[]> {
    return this.getProjects(filters ?? {}).pipe(
      map((projects) => {
        const routes: ProjectRoute[] = [];
        const skipped: { id: string; clientId: string | null; manufacturerLocationId: string | null; hasClient: boolean; hasFactory: boolean }[] = [];
        for (const p of projects) {
          const clientCoords = p.clientId && clientCoordinates.get(p.clientId);
          const factoryCoords =
            p.manufacturerLocationId && factoryCoordinates.get(p.manufacturerLocationId);
          if (clientCoords && factoryCoords) {
            const status = p.status ?? 'Open';
            routes.push({
              id: `project-route-${p.id}`,
              projectId: String(p.id),
              fromNodeId: p.clientId,
              toNodeId: p.manufacturerLocationId!,
              status,
              fromCoordinates: clientCoords,
              toCoordinates: factoryCoords,
              animated: status === 'Open',
              strokeColor:
                status === 'Open' ? '#5ad85a' : status === 'Delayed' ? '#ef4444' : '#94a3b8',
            });
          } else {
            skipped.push({
              id: String(p.id),
              clientId: p.clientId ?? null,
              manufacturerLocationId: p.manufacturerLocationId ?? null,
              hasClient: !!(p.clientId && clientCoordinates.get(p.clientId)),
              hasFactory: !!(p.manufacturerLocationId && factoryCoordinates.get(p.manufacturerLocationId)),
            });
          }
        }
        return routes;
      })
    );
  }
}
