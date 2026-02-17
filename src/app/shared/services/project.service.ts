import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, delay, map, switchMap, catchError, Subject, startWith } from 'rxjs';
import { Project, ProjectStatus } from '../models/project.model';
import { Client } from '../models/client.model';
import { ProjectRoute } from '../models/fluorescence-map.interface';
import { ClientService } from './client.service';
import { environment } from '../../../environments/environment';

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
  projectName?: string;
  project_name?: string;
  client?: string | null;
  clientId?: string | null;
  assessmentType?: string | null;
  assessment_type?: string | null;
  location?: string | null;
  status?: string | null;
  manufacturer?: string | null;
  manufacturerLocationId?: string | null;
  manufacturer_id?: number | null;
  factory_id?: number | null;
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
  if (raw && typeof raw === 'object' && 'projects' in raw) {
    return (raw as { projects: ApiProject[] }).projects;
  }
  if (Array.isArray(raw)) {
    return raw as ApiProject[];
  }
  return [];
}

function normalizeApiProject(api: ApiProject): {
  id: number | string;
  projectName: string;
  client: string | null;
  assessmentType: string;
  status: string | null;
  manufacturerId: number | null;
  factoryId: number | null;
} {
  const id = api.project_id ?? api.id;
  const projectName = api.project_name ?? api.projectName ?? '';
  const client = api.client?.trim() ?? null;
  const assessmentType = api.assessment_type ?? api.assessmentType ?? '';
  const status = api.status ?? null;
  const manufacturerId = api.manufacturer_id ?? null;
  const factoryId = api.factory_id ?? null;
  return { id: id!, projectName, client, assessmentType, status, manufacturerId, factoryId };
}

function resolveClientId(api: ApiProject, clients: Client[]): string | null {
  if (api.clientId) return api.clientId;
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
  factories: ApiFactory[] = [],
  factoryIdToWarRoom: Record<string, string> = {}
): Project | null {
  const norm = normalizeApiProject(api);
  const clientId = resolveClientId(api, clients);
  if (!clientId) return null;

  const status = mapApiStatus(norm.status);
  const client = clients.find((c) => c.id === clientId);

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
      factoryIdToWarRoom[String(norm.factoryId)] ?? api.manufacturerLocationId ?? String(norm.factoryId);
  } else {
    manufacturer = api.manufacturer ?? undefined;
    location = api.location ?? undefined;
    manufacturerLocationId = api.manufacturerLocationId ?? undefined;
  }

  return {
    id: norm.id,
    projectName: norm.projectName,
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
  /** Path to sample JSON when not using API */
  private readonly SAMPLE_JSON_PATH = 'assets/data/projects.json';
  private readonly FACTORIES_PATH = 'assets/data/factories.json';
  private readonly FACTORY_MAPPING_PATH = 'assets/data/factory-id-mapping.json';
  private readonly ADDED_PROJECTS_STORAGE_KEY = 'war-room-added-projects';

  private readonly projectsRefresh$ = new Subject<void>();

  /** In-memory cache for projects added when useProjectApi is false (JSON mode) */
  private addedProjectsCache: Project[] = [];
  private addedProjectsHydrated = false;

  constructor(
    private http: HttpClient,
    private clientService: ClientService
  ) {
    this.hydrateAddedProjectsFromStorage();
  }

  private hydrateAddedProjectsFromStorage(): void {
    if (this.addedProjectsHydrated || environment.useProjectApi) return;
    this.addedProjectsHydrated = true;
    try {
      const raw = localStorage.getItem(this.ADDED_PROJECTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        const arr = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && 'projects' in parsed ? (parsed as { projects: unknown[] }).projects : []);
        this.addedProjectsCache = (arr || []).filter(
          (p): p is Project => p != null && typeof p === 'object' && 'id' in p && 'clientId' in p
        );
      }
    } catch {
      // Ignore parse errors
    }
  }

  private persistAddedProjectsToStorage(): void {
    if (environment.useProjectApi) return;
    try {
      localStorage.setItem(this.ADDED_PROJECTS_STORAGE_KEY, JSON.stringify(this.addedProjectsCache));
    } catch {
      // Ignore quota or other storage errors
    }
  }

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

  private loadProjectsFromJson(
    clients: Client[],
    filters?: ProjectFilters
  ): Observable<Project[]> {
    const projects$ = this.http.get<unknown>(this.SAMPLE_JSON_PATH);
    const factoriesData$ = this.http
      .get<{ manufacturers?: ApiManufacturer[]; factories?: ApiFactory[] }>(
        this.FACTORIES_PATH
      )
      .pipe(catchError(() => of({ manufacturers: [], factories: [] })));

    return this.loadFactoryMapping().pipe(
      switchMap((mapping) =>
        projects$.pipe(
          switchMap((raw) =>
            factoriesData$.pipe(
              map((cf) => {
                const apiProjects = normalizeApiResponse(raw);
                const manufacturers = cf.manufacturers ?? [];
                const factories = cf.factories ?? [];
                const factoryIdToWarRoom = mapping.factoryIdToWarRoom ?? {};
                const projects = apiProjects
                  .map((api) =>
                    mapApiProjectToProject(api, clients, manufacturers, factories, factoryIdToWarRoom)
                  )
                  .filter((p): p is Project => p != null);
                return applyFilters(projects, filters);
              })
            )
          ),
          catchError(() => of([] as Project[])),
          delay(150)
        )
      ),
      catchError(() => of([] as Project[]).pipe(delay(150)))
    );
  }

  getProjects(filters?: ProjectFilters): Observable<Project[]> {
    if (!environment.useProjectApi) {
      return this.clientService.getClients().pipe(
        switchMap((clients) =>
          this.loadFactoryMapping().pipe(
            switchMap((mapping) =>
              this.loadProjectsFromJson(clients, filters).pipe(
                map((jsonProjects) => {
                  const factoryIdToWarRoom = mapping.factoryIdToWarRoom ?? {};
                  const merged = [...jsonProjects];
                  const cachedFiltered = applyFilters(this.addedProjectsCache, filters);
                  for (const p of cachedFiltered) {
                    if (merged.some((m) => String(m.id) === String(p.id))) continue;
                    const resolved = { ...p };
                    if (resolved.manufacturerLocationId && factoryIdToWarRoom[resolved.manufacturerLocationId]) {
                      resolved.manufacturerLocationId = factoryIdToWarRoom[resolved.manufacturerLocationId];
                    }
                    merged.push(resolved);
                  }
                  return merged;
                })
              )
            )
          )
        )
      );
    }

    return this.clientService.getClients().pipe(
      switchMap((clients) =>
        this.loadFactoryMapping().pipe(
          switchMap((mapping) =>
            this.http.get<unknown>(`${environment.apiBaseUrl}/projects`).pipe(
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
                return of([] as Project[]).pipe(delay(150));
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

  addProject(project: Omit<Project, 'id'>): Observable<Project> {
    if (!environment.useProjectApi) {
      return this.http.get<unknown>(this.SAMPLE_JSON_PATH).pipe(
        map((raw) => {
          const apiProjects = normalizeApiResponse(raw);
          const ids = apiProjects
            .map((p) => (p.project_id ?? p.id) as number | string)
            .filter((v): v is number => typeof v === 'number' || !isNaN(parseInt(String(v), 10)))
            .map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10)) || 0);
          const cacheIds = this.addedProjectsCache
            .map((p) => (typeof p.id === 'number' ? p.id : parseInt(String(p.id), 10)) || 0)
            .filter((v) => !isNaN(v));
          const allIds = [...ids, ...cacheIds];
          const nextId = allIds.length > 0 ? Math.max(0, ...allIds) + 1 : 1;
          const newProject = { ...project, id: nextId } as Project;
          this.addedProjectsCache.push(newProject);
          this.persistAddedProjectsToStorage();
          return newProject;
        }),
        catchError(() => {
          const newProject = { ...project, id: Date.now() } as Project;
          this.addedProjectsCache.push(newProject);
          this.persistAddedProjectsToStorage();
          return of(newProject);
        }),
        delay(100)
      );
    }

    const body = {
      projectName: project.projectName,
      clientId: project.clientId,
      clientName: project.clientName,
      assessmentType: project.assessmentType,
      location: project.location,
      manufacturer: project.manufacturer,
      manufacturerLocationId: project.manufacturerLocationId,
      status: project.status ?? 'Open',
    };

    return this.http
      .post<ApiProject>(`${environment.apiBaseUrl}/projects`, body)
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
    if (!environment.useProjectApi) {
      return this.getProjects({}).pipe(
        delay(100),
        map((projects) => {
          const idx = projects.findIndex((p) => String(p.id) === String(project.id));
          if (idx === -1) throw new Error(`Project not found: ${project.id}`);
          return { ...projects[idx], ...project };
        })
      );
    }

    const body = {
      projectName: project.projectName,
      clientId: project.clientId,
      clientName: project.clientName,
      assessmentType: project.assessmentType,
      location: project.location,
      manufacturer: project.manufacturer,
      manufacturerLocationId: project.manufacturerLocationId,
      status: project.status ?? 'Open',
    };

    return this.http
      .put<ApiProject>(`${environment.apiBaseUrl}/projects/${project.id}`, body)
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
