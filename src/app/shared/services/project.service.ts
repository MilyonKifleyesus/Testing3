import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, map, switchMap, catchError, Subject, startWith } from 'rxjs';
import { Project, ProjectStatus } from '../models/project.model';
import { Client } from '../models/client.model';
import { ProjectRoute } from '../models/fluorescence-map.interface';
import { ClientService } from './client.service';
import { environment } from '../../../environments/environment';

type ProjectEnvironmentConfig = typeof environment & {
  useProjectApi?: boolean;
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
  projectId?: number | string;
  projectName?: string;
  project_name?: string;
  ProjectName?: string;
  name?: string;
  title?: string;
  contract?: string | null;
  contractNo?: string | null;
  contract_no?: string | null;
  contractNumber?: string | null;
  clientId?: string | number | null;
  client?: string | null;
  clientName?: string | null;
  assessmentType?: string | null;
  assessment_type?: string | null;
  projectTypeName?: string | null;
  project_type_name?: string | null;
  projectTypeId?: number | string | null;
  project_type_id?: number | string | null;
  project_type?: number | string | null;
  location?: string | null;
  status?: string | null;
  manufacturer?: string | null;
  manufacturerLocationId?: string | null;
  manufacturer_location_id?: string | number | null;
  locationId?: string | number | null;
  location_id?: string | number | null;
  LocationId?: string | number | null;
  manufacturer_id?: number | null;
  factory_id?: number | null;
  isClosed?: boolean | null;
  is_closed?: boolean | null;
  closed?: boolean | null;
}

function mapProjectTypeIdToAssessmentType(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const numericId = Number(value);
  if (!Number.isFinite(numericId)) return null;

  if (numericId === 1) return 'New Build';
  if (numericId === 2) return 'Condition Assessment';
  return null;
}

/** API response shape for manufacturers */
export interface ApiManufacturer {
  manufacturer_id: number;
  manufacturer_name: string;
}

/** API response shape for factories */
export interface ApiFactory {
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

export interface FactoryIdMapping {
  factoryIdToWarRoom: Record<string, string>;
  aliases?: Record<string, string>;
}

/** Factory option for Add Project modal dropdown */
export interface FactoryOption {
  factoryId: number;
  manufacturerId: number;
  manufacturerName: string;
  label: string;
  factory_location_name: string;
  city?: string | null;
  state_province?: string | null;
  country?: string | null;
}

function normalizeApiResponse(raw: unknown): ApiProject[] {
  if (raw && typeof raw === 'object' && 'items' in raw && Array.isArray((raw as { items?: unknown }).items)) {
    return (raw as { items: ApiProject[] }).items;
  }
  if (raw && typeof raw === 'object' && 'data' in raw) {
    const data = (raw as { data?: unknown }).data;
    if (Array.isArray(data)) {
      return data as ApiProject[];
    }
    if (data && typeof data === 'object' && 'projects' in data) {
      return ((data as { projects?: ApiProject[] }).projects ?? []);
    }
  }
  if (raw && typeof raw === 'object' && 'results' in raw && Array.isArray((raw as { results?: unknown }).results)) {
    return (raw as { results: ApiProject[] }).results;
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
  contract: string | null;
  client: string | null;
  assessmentType: string;
  status: string | null;
  manufacturerId: number | null;
  factoryId: number | null;
} {
  const id = api.project_id ?? api.projectId ?? api.id;
  const projectName = api.project_name ?? api.projectName ?? api.ProjectName ?? api.name ?? api.title ?? '';
  const contract =
    api.contract ??
    api.contractNo ??
    api.contract_no ??
    api.contractNumber ??
    null;
  const client = api.client?.trim() ?? api.clientName?.trim() ?? null;
  const assessmentTypeFromTypeId = mapProjectTypeIdToAssessmentType(
    api.projectTypeId ?? api.project_type_id ?? api.project_type
  );
  const assessmentType =
    assessmentTypeFromTypeId ??
    api.projectTypeName ??
    api.project_type_name ??
    api.assessment_type ??
    api.assessmentType ??
    '';
  const status = api.status ?? null;
  const manufacturerId = api.manufacturer_id ?? null;
  const factoryId = api.factory_id ?? null;
  return { id: id ?? null, projectName, contract, client, assessmentType, status, manufacturerId, factoryId };
}

function normalizeSingleApiProjectResponse(raw: unknown): ApiProject | null {
  if (!raw) return null;

  if (Array.isArray(raw)) {
    return raw.length > 0 ? (raw[0] as ApiProject) : null;
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;

    if ('id' in obj || 'project_id' in obj || 'projectId' in obj) {
      return obj as ApiProject;
    }

    const data = obj['data'];
    if (data && typeof data === 'object') {
      const nested = data as Record<string, unknown>;
      if ('id' in nested || 'project_id' in nested || 'projectId' in nested) {
        return nested as ApiProject;
      }
      if (nested['project'] && typeof nested['project'] === 'object') {
        return nested['project'] as ApiProject;
      }
    }

    if (obj['project'] && typeof obj['project'] === 'object') {
      return obj['project'] as ApiProject;
    }
  }

  return null;
}

function resolveClientId(api: ApiProject, clients: Client[]): string | null {
  if (api.clientId !== null && api.clientId !== undefined) {
    const explicitClientId = String(api.clientId).trim();
    if (explicitClientId) return explicitClientId;
  }
  const cm = api.client?.trim();
  if (!cm) return null;
  const c = clients.find(
    (x) => x.code?.toLowerCase() === cm.toLowerCase() || x.name?.toLowerCase() === cm.toLowerCase()
  );
  return c?.id ?? cm.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Maps API status to UI status. Active/Inactive are normalized to Open/Closed for HUD badges and filters.
 */
function mapApiStatus(
  apiStatus: string | null | undefined,
  isClosed?: boolean | null
): ProjectStatus | null {
  if (isClosed === true) return 'Closed';
  if (apiStatus === 'Closed' || apiStatus === 'Inactive') return 'Closed';
  if (apiStatus === 'Delayed') return 'Delayed';
  if (apiStatus === 'Open' || apiStatus === 'Active') return 'Open';
  return null;
}

function mapApiProjectToProject(
  api: ApiProject,
  clients: Client[],
  manufacturers: ApiManufacturer[] = [],
  factories: ApiFactory[] = [],
  factoryIdToWarRoom: Record<string, string> = {}
): Project | null {
  const norm = normalizeApiProject(api);
  if (norm.id == null) return null;
  const clientId = resolveClientId(api, clients);
  if (!clientId) return null;

  const closedFlag = api.isClosed ?? api.is_closed ?? api.closed;
  const status = mapApiStatus(norm.status, closedFlag);
  const client = clients.find((c) => c.id === clientId);

  const apiLocationId =
    api.manufacturerLocationId ??
    api.manufacturer_location_id ??
    api.locationId ??
    api.location_id ??
    api.LocationId;

  let manufacturer: string | undefined;
  let location: string | undefined;
  let manufacturerLocationId: string | undefined;

  const hasExplicitManufacturer = api.manufacturer != null && String(api.manufacturer).trim() !== '';
  const hasExplicitLocation = api.location != null && String(api.location).trim() !== '';

  if (norm.factoryId != null) {
    const factory = factories.find((f) => f.factory_id === norm.factoryId);
    const factoryManufacturer = factory
      ? manufacturers.find((m) => m.manufacturer_id === factory.manufacturer_id)?.manufacturer_name
      : undefined;
    let factoryLocation: string | undefined;
    if (factory) {
      const parts = [factory.city, factory.state_province, factory.country].filter(Boolean);
      factoryLocation = parts.length > 0 ? parts.join(', ') : factory.factory_location_name;
    }

    manufacturer = hasExplicitManufacturer ? api.manufacturer! : (factoryManufacturer ?? api.manufacturer ?? undefined);
    location = hasExplicitLocation ? api.location! : (factoryLocation ?? api.location ?? undefined);
    manufacturerLocationId =
      factoryIdToWarRoom[String(norm.factoryId)] ??
      (apiLocationId != null ? String(apiLocationId) : undefined) ??
      String(norm.factoryId);
  } else {
    manufacturer = api.manufacturer ?? undefined;
    location = api.location ?? undefined;
    manufacturerLocationId = apiLocationId != null ? String(apiLocationId) : undefined;
  }

  return {
    id: norm.id,
    projectName: norm.projectName,
    contract: norm.contract ?? undefined,
    clientId,
    clientName: norm.client ?? client?.name ?? clientId,
    assessmentType: norm.assessmentType,
    location,
    manufacturer,
    manufacturerLocationId,
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
  private readonly FACTORIES_PATH = 'assets/data/factories.json';
  private readonly FACTORY_MAPPING_PATH = 'assets/data/factory-id-mapping.json';

  private readonly projectsRefresh$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    private clientService: ClientService
  ) {}

  getFactoriesWithManufacturers(): Observable<FactoryOption[]> {
    return this.http
      .get<{ manufacturers?: ApiManufacturer[]; factories?: ApiFactory[] }>(this.FACTORIES_PATH)
      .pipe(
        map((data) => {
          const manufacturers = data.manufacturers ?? [];
          const factories = data.factories ?? [];
          return factories.map((f) => {
            const mfr = manufacturers.find((m) => m.manufacturer_id === f.manufacturer_id);
            const mfrName = mfr?.manufacturer_name ?? 'Unknown';
            const parts = [f.city, f.country].filter(Boolean);
            const locSuffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
            const label = `${mfrName} - ${f.factory_location_name}${locSuffix}`;
            return {
              factoryId: f.factory_id,
              manufacturerId: f.manufacturer_id,
              manufacturerName: mfrName,
              label,
              factory_location_name: f.factory_location_name,
              city: f.city,
              state_province: f.state_province,
              country: f.country,
            } as FactoryOption;
          });
        }),
        catchError(() => of([]))
      );
  }

  /** Resolve WarRoom factory id to FactoryOption for modal pre-selection */
  getFactoryOptionForWarRoomId(warRoomId: string): Observable<FactoryOption | null> {
    return this.loadFactoryMapping().pipe(
      switchMap((mapping) =>
        this.getFactoriesWithManufacturers().pipe(
          map((opts) => {
            const factoryIdToWarRoom = mapping.factoryIdToWarRoom ?? {};
            const aliases = mapping.aliases ?? {};
            const normalizedId = (aliases[warRoomId] ?? warRoomId).toLowerCase();
            const entry = Object.entries(factoryIdToWarRoom).find(
              ([, wr]) => (wr ?? '').toLowerCase() === normalizedId
            );
            if (!entry) {
              return opts.find((o) => String(o.factoryId) === warRoomId) ?? null;
            }
            const apiId = entry[0];
            return opts.find((o) => String(o.factoryId) === apiId) ?? null;
          })
        )
      ),
      catchError(() => of(null))
    );
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

  private loadFactoryMapping(): Observable<FactoryIdMapping> {
    return this.http.get<FactoryIdMapping>(this.FACTORY_MAPPING_PATH).pipe(
      catchError((err) => {
        console.warn('Failed to load factory-id-mapping.json, using empty mapping:', err);
        return of({ factoryIdToWarRoom: {}, aliases: {} });
      })
    );
  }

  getProjects(filters?: ProjectFilters): Observable<Project[]> {
    const apiParams = new HttpParams()
      .set('page', '1')
      .set('pageSize', '1000')
      .set('includeClosed', 'true')
      .set('IncludeClosed', 'true');

    return this.clientService.getClients().pipe(
      switchMap((clients) =>
        this.loadFactoryMapping().pipe(
          switchMap((mapping) =>
            this.http.get<unknown>(`${this.API_BASE_URL}/projects`, { params: apiParams }).pipe(
              map((raw) => {
                const apiProjects = normalizeApiResponse(raw);
                const factoryIdToWarRoom = mapping.factoryIdToWarRoom ?? {};
                const projects = apiProjects
                  .map((api) =>
                    mapApiProjectToProject(api, clients, [], [], factoryIdToWarRoom)
                  )
                  .filter((p): p is Project => p != null);
                return applyFilters(projects, filters);
              }),
              catchError((err) => {
                console.warn('Projects API failed:', err);
                return of([] as Project[]);
              })
            )
          )
        )
      )
    );
  }

  getProjectsByClient(clientId: string): Observable<Project[]> {
    return this.getProjects({ clientId });
  }

  getProjectsByFactory(manufacturerLocationId: string): Observable<Project[]> {
    return this.getProjects({ manufacturerLocationId });
  }

  getProjectById(projectId: string | number): Observable<Project | null> {
    const id = String(projectId ?? '').trim();
    if (!id) return of(null);

    return this.clientService.getClients().pipe(
      switchMap((clients) =>
        this.http.get<unknown>(`${this.API_BASE_URL}/Projects/${id}`).pipe(
          map((raw) => normalizeSingleApiProjectResponse(raw)),
          map((apiProject) => {
            if (!apiProject) return null;
            return mapApiProjectToProject(apiProject, clients, [], []);
          }),
          catchError((err) => {
            console.warn(`Project by id API failed for ${id}:`, err);
            return of(null);
          }),
        )
      )
    );
  }

  addProject(project: Omit<Project, 'id'>): Observable<Project> {
    const body = {
      projectName: project.projectName,
      contract: project.contract,
      clientId: project.clientId,
      clientName: project.clientName,
      assessmentType: project.assessmentType,
      location: project.location,
      manufacturer: project.manufacturer,
      manufacturerLocationId: project.manufacturerLocationId,
      status: project.status ?? 'Open',
    };

    return this.http
      .post<ApiProject>(`${this.API_BASE_URL}/projects`, body)
      .pipe(
        switchMap((api) =>
          this.clientService.getClients().pipe(
            map((clients) => {
              const mapped = mapApiProjectToProject(api as ApiProject, clients, [], []);
              return mapped ?? ({ ...project, id: api.id ?? api.project_id } as Project);
            })
          )
        ),
        catchError((err) => {
          console.error('Failed to add project:', err);
          throw err;
        })
      );
  }

  updateProject(project: Project): Observable<Project> {
    const body = {
      projectName: project.projectName,
      contract: project.contract,
      clientId: project.clientId,
      clientName: project.clientName,
      assessmentType: project.assessmentType,
      location: project.location,
      manufacturer: project.manufacturer,
      manufacturerLocationId: project.manufacturerLocationId,
      status: project.status ?? 'Open',
    };

    return this.http
      .put<ApiProject>(`${this.API_BASE_URL}/projects/${project.id}`, body)
      .pipe(
        switchMap((api) =>
          this.clientService.getClients().pipe(
            map((clients) => {
              const mapped = mapApiProjectToProject(api as ApiProject, clients, [], []);
              return mapped ?? ({ ...project, id: api.id ?? api.project_id } as Project);
            })
          )
        ),
        catchError((err) => {
          console.error('Failed to update project:', err);
          throw err;
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
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) => {
        const byId = new Map<string, number>();
        for (const p of projects) {
          if (!p.manufacturer) continue;
          byId.set(p.manufacturer, (byId.get(p.manufacturer) ?? 0) + 1);
        }
        return Array.from(byId.entries())
          .map(([id, count]) => ({ id, name: id, count }))
          .sort((a, b) => a.name.localeCompare(b.name));
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
