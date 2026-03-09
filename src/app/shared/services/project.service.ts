import { Injectable, isDevMode } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import {
  Observable,
  of,
  map,
  switchMap,
  catchError,
  Subject,
  startWith,
  combineLatest,
  forkJoin,
  throwError,
  timer,
  timeout,
  retry,
  shareReplay,
} from 'rxjs';
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
import { LocationService, ApiLocation } from '../services/location.service';
import { normalizeNumericLikeId } from '../utils/id-normalizer.util';
import { normalizeProjectTypeFilterKey } from '../features/fluorescence-map/state/fluorescence-map.selectors';
import { environment } from '../../../environments/environment';
import { fetchAllPages } from './adapters/pagination-fetch.util';
import { parsePagedResponse } from './adapters/paged-response.adapter';
import { adaptApiManufacturer, ApiManufacturerLike } from './adapters/manufacturer.adapter';
import { adaptApiProject } from './adapters/project.adapter';
import {
  LogoPayloadMode,
  isDataUrlBase64,
  prepareLogoForMode,
  shouldRetryWithRawBase64,
} from './adapters/logo-payload.adapter';

type ProjectEnvironmentConfig = typeof environment & {
  apiBaseUrl?: string;
  useApiV2?: boolean;
  apiPagedFetchPageSize?: number;
  apiPagedFetchMaxPages?: number;
  mapMaxLocationsPerProject?: number;
  mapMaxTotalRoutes?: number;
  logoPayloadMode?: LogoPayloadMode;
};

type ProjectLocationShape = {
  locationIds?: number[];
  locations?: Array<{ id?: number | string | null; latitude?: number | null; longitude?: number | null }>;
};

type ProjectApiOptionalShape = {
  contract?: string;
  hasRoadTest?: boolean;
};

type ProjectWithLocationLinks = Project & ProjectLocationShape & ProjectApiOptionalShape;
type ProjectUpsertInput = (Project | Omit<Project, 'id'>) & ProjectLocationShape & ProjectApiOptionalShape;

function extractApiErrorMessage(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse)) return null;
  const raw = err.error as unknown;

  if (typeof raw === 'string') return raw.trim() || null;
  if (raw && typeof raw === 'object') {
    const candidateKeys = ['message', 'title', 'detail', 'error', 'errors'];
    for (const key of candidateKeys) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }

  return err.message?.trim() || null;
}

function toApiError(prefix: string, err: unknown): Error {
  if (err instanceof HttpErrorResponse) {
    const msg = extractApiErrorMessage(err);
    const details = msg ? `: ${msg}` : '';
    return new Error(`${prefix} (${err.status} ${err.statusText || 'Error'})${details}`);
  }
  return err instanceof Error ? err : new Error(`${prefix}: ${String(err)}`);
}

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

/** API response shape for project type catalog */
export interface ApiProjectType {
  id?: number | string | null;
  projectTypeId?: number | string | null;
  name?: string | null;
  projectTypeName?: string | null;
  assessmentType?: string | null;
  active?: boolean | null;
  isActive?: boolean | null;
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
  locations?: Array<{ id?: number | string | null; latitude?: number | null; longitude?: number | null }> | null;
  status?: string | null;
  /** BusPulseApi: boolean, true = Closed, false = Open */
  closed?: boolean;
  lastUpdate?: string | null;
  manufacturer?: string | null;
  manufacturerLocationId?: string | null;
  manufacturer_id?: number | null;
  factory_id?: number | null;
  contract?: string | null;
  hasRoadTest?: boolean | null;
}

/** API response shape for manufacturers */
export interface ApiManufacturer {
  id: number;
  manufacturerName: string;
  manufacturerLogo?: string | null;
  manufacturerLogoName?: string | null;
  locations?: Array<{ id: number; latitude: number; longitude: number }>;
  locationIds?: number[];
  primaryLocationId?: number | null;
  locationId?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface ApiManufacturerDetail extends ApiManufacturer {
  uniqueId?: string | null;
  lastUpdate?: string | null;
}

export interface CreateManufacturerRequest {
  manufacturerName: string;
  manufacturerLogo?: string | null;
  manufacturerLogoName?: string | null;
  locationIds: number[];
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
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }

  const raw = String(v).trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/^source-/i, '')
    .replace(/^loc-/i, '')
    .trim();

  if (/^\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseNumericId(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function extractManufacturerId(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const candidate =
    record['id'] ??
    record['manufacturerId'] ??
    (record['item'] as Record<string, unknown> | undefined)?.['id'] ??
    (record['manufacturer'] as Record<string, unknown> | undefined)?.['id'];
  return parseNumericId(candidate);
}

function normalizeApiResponse(raw: unknown): ApiProject[] {
  return parsePagedResponse<ApiProject>(raw).items;
}

function normalizeProjectTypesResponse(raw: unknown): ApiProjectType[] {
  if (raw && typeof raw === 'object' && 'items' in raw) {
    return (raw as { items: ApiProjectType[] }).items ?? [];
  }
  if (raw && typeof raw === 'object' && 'projectTypes' in raw) {
    return (raw as { projectTypes: ApiProjectType[] }).projectTypes ?? [];
  }
  if (raw && typeof raw === 'object' && 'types' in raw) {
    return (raw as { types: ApiProjectType[] }).types ?? [];
  }
  if (Array.isArray(raw)) {
    return raw as ApiProjectType[];
  }
  return [];
}

function resolveClientId(clientIdCandidate: unknown, clientNameCandidate: unknown, clients: Client[]): string | null {
  if (clientIdCandidate != null && clientIdCandidate !== '') return String(clientIdCandidate);
  const cm = String(clientNameCandidate ?? '').trim();
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
): ProjectWithLocationLinks | null {
  const norm = adaptApiProject(api);
  if (!norm) return null;

  const clientId = resolveClientId(norm.clientId, norm.clientName, clients);
  if (!clientId) return null;

  const status = mapApiStatus(norm.status);
  const client = clients.find((c) => c.id === clientId);
  const locationIds = norm.locationIds;
  const primaryLocationId = norm.locationId;
  const locationById = primaryLocationId != null ? locations.find((l) => l.id === primaryLocationId) : undefined;

  const manufacturerByLocation = locationIds.length > 0
    ? manufacturers.find((m) => {
      const manufacturerLocationIds = m.locationIds ?? [];
      return manufacturerLocationIds.some((locationId) => locationIds.includes(locationId));
    })
    : undefined;

  const manufacturer = api.manufacturer ?? manufacturerByLocation?.manufacturerName ?? undefined;
  const location = api.location ?? locationById?.name ?? undefined;
  const manufacturerLocationId = norm.manufacturerLocationId ??
    (primaryLocationId != null ? String(primaryLocationId) : undefined);

  return {
    id: norm.id,
    projectName: norm.projectName,
    clientId,
    clientName: norm.clientName ?? client?.name ?? clientId,
    assessmentType: norm.assessmentType,
    projectTypeId: norm.projectTypeId ?? undefined,
    locationId: primaryLocationId ?? undefined,
    locationIds: locationIds.length > 0 ? locationIds : undefined,
    locations: norm.locations.length > 0 ? norm.locations : undefined,
    location,
    manufacturer,
    manufacturerLocationId,
    closed: norm.closed ?? undefined,
    lastUpdate: norm.lastUpdate ?? undefined,
    contract: norm.contract ?? undefined,
    hasRoadTest: norm.hasRoadTest ?? undefined,
    status,
  };
}

function applyFilters(projects: ProjectWithLocationLinks[], filters?: ProjectFilters): ProjectWithLocationLinks[] {
  let result = [...projects];
  if (filters?.clientIds?.length) {
    const selectedClientIds = new Set(
      filters.clientIds
        .map((id) => normalizeNumericLikeId(id))
        .filter((id) => !!id)
    );
    result = result.filter((p) => {
      const normalizedClientId = normalizeNumericLikeId(p.clientId);
      return !!normalizedClientId && selectedClientIds.has(normalizedClientId);
    });
  } else if (filters?.clientId && filters.clientId !== 'all') {
    const normalizedClientId = normalizeNumericLikeId(filters.clientId);
    result = result.filter((p) => normalizeNumericLikeId(p.clientId) === normalizedClientId);
  }
  if (filters?.manufacturerLocationId) {
    const raw = String(filters.manufacturerLocationId ?? '').trim();
    const numeric =
      /^\d+$/.test(raw)
        ? raw
        : (raw.startsWith('loc-') && /^\d+$/.test(raw.slice(4)) ? raw.slice(4) : '');
    const loc = numeric ? `loc-${numeric}` : '';
    const candidates = new Set([raw, numeric, loc].filter((v) => !!v));
    result = result.filter((p) => {
      const projectLocationIds = (p.locationIds ?? [])
        .map((locationId) => String(locationId).trim())
        .filter((locationId) => !!locationId);
      const resolvedIds = [
        String(p.manufacturerLocationId ?? '').trim(),
        String(p.locationId ?? '').trim(),
        ...projectLocationIds,
        ...projectLocationIds.map((locationId) => `loc-${locationId}`),
      ].filter((id) => !!id);
      return resolvedIds.some((id) => candidates.has(id));
    });
  }
  if (filters?.manufacturerIds?.length) {
    const selectedManufacturers = new Set(
      filters.manufacturerIds
        .map((id) => String(id ?? '').trim().toLowerCase())
        .filter((id) => !!id)
    );
    result = result.filter((p) => {
      const manufacturerByName = String(p.manufacturer ?? '').trim().toLowerCase();
      const manufacturerById = String((p as ProjectWithLocationLinks & { manufacturerId?: string | number | null }).manufacturerId ?? '')
        .trim()
        .toLowerCase();
      const manufacturerByLocationId = String(p.manufacturerLocationId ?? '').trim().toLowerCase();
      return (
        (!!manufacturerByName && selectedManufacturers.has(manufacturerByName)) ||
        (!!manufacturerById && selectedManufacturers.has(manufacturerById)) ||
        (!!manufacturerByLocationId && selectedManufacturers.has(manufacturerByLocationId))
      );
    });
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
  private readonly API_BASE_URL: string;
  private readonly useApiV2: boolean;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly mapMaxLocationsPerProject: number;
  private readonly mapMaxTotalRoutes: number;
  private readonly logoPayloadMode: LogoPayloadMode;
  /**
   * Keep these PascalCase to match backend routes (/api/Projects, /api/ProjectTypes).
   * Some deployments (or reverse proxies) treat routes as case-sensitive.
   */
  private readonly PROJECTS_ROUTE = 'Projects';
  private readonly PROJECT_TYPES_ROUTE = 'ProjectTypes';
  private readonly nonManufacturerTokens: ReadonlyArray<string> = [
    'transit',
    'translink',
    'metrolinx',
    'transpo',
    'northland',
    'agency',
    'municipal',
    'city of',
    'county of',
  ];

  private readonly projectsRefresh$ = new Subject<void>();
  private readonly projectsWithRefreshCache = new Map<string, Observable<Project[]>>();
  /** Last non-empty result per filter key; replayed when API returns [] (e.g. cooldown) so client list and panel stay populated */
  private readonly lastNonEmptyByKey = new Map<string, Project[]>();
  private projectsCooldownUntil = 0;
  private lastProjectsWarnAt = 0;
  private readonly skippedRoutesLogMinIntervalMs = 15_000;
  private lastSkippedRoutesLogSignature = '';
  private lastSkippedRoutesLogAt = 0;
  private manufacturersCache$: Observable<ApiManufacturer[]> | null = null;
  private manufacturersCacheExpiresAt = 0;
  private manufacturersCooldownUntil = 0;
  private lastManufacturersWarnAt = 0;

  constructor(
    private http: HttpClient,
    private clientService: ClientService,
    private locationService: LocationService
  ) {
    const configuredApiBaseUrl = this.envConfig.apiBaseUrl?.trim();
    if (!configuredApiBaseUrl) {
      throw new Error('Missing required envConfig.apiBaseUrl');
    }
    this.API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, '');
    this.useApiV2 = this.envConfig.useApiV2 !== false;
    this.pageSize = Math.max(1, Number(this.envConfig.apiPagedFetchPageSize ?? 500));
    this.maxPages = Math.max(1, Number(this.envConfig.apiPagedFetchMaxPages ?? 200));
    this.mapMaxLocationsPerProject = Math.max(1, Number(this.envConfig.mapMaxLocationsPerProject ?? 20));
    this.mapMaxTotalRoutes = Math.max(1, Number(this.envConfig.mapMaxTotalRoutes ?? 3000));
    this.logoPayloadMode = this.resolveLogoPayloadMode(this.envConfig.logoPayloadMode);
  }

  private resolveLogoPayloadMode(mode: unknown): LogoPayloadMode {
    if (mode === 'rawBase64' || mode === 'dataUrl' || mode === 'autoRetryRawBase64') {
      return mode;
    }
    return 'autoRetryRawBase64';
  }

  private warnManufacturersApiOncePer(intervalMs: number, err: unknown): void {
    const now = Date.now();
    if (now - this.lastManufacturersWarnAt < intervalMs) return;
    this.lastManufacturersWarnAt = now;
    console.warn('Manufacturers API request failed, using empty fallback:', err);
  }

  private warnProjectsApiOncePer(intervalMs: number, err: unknown): void {
    const now = Date.now();
    if (now - this.lastProjectsWarnAt < intervalMs) return;
    this.lastProjectsWarnAt = now;
    console.warn('Projects API request failed, using empty fallback:', err);
  }

  private projectsFiltersKey(filters?: ProjectFilters): string {
    const f = filters ?? {};
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(f).sort()) {
      const value = (f as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        normalized[key] = [...value].map(String).sort();
      } else {
        normalized[key] = value;
      }
    }
    return JSON.stringify(normalized);
  }

  private mapManufacturersResponse(raw: unknown): ApiManufacturer[] {
    const apiManufacturers = parsePagedResponse<ApiManufacturerLike>(raw).items;
    return apiManufacturers
      .map((manufacturer) => adaptApiManufacturer(manufacturer))
      .filter((manufacturer): manufacturer is NonNullable<ReturnType<typeof adaptApiManufacturer>> => !!manufacturer)
      .map((manufacturer) => ({
        id: manufacturer.id,
        manufacturerName: manufacturer.manufacturerName,
        manufacturerLogo: manufacturer.manufacturerLogo ?? null,
        manufacturerLogoName: manufacturer.manufacturerLogoName ?? null,
        locations: manufacturer.locations,
        locationIds: manufacturer.locationIds,
        primaryLocationId: manufacturer.primaryLocationId,
        locationId: manufacturer.locationId,
        latitude: manufacturer.latitude,
        longitude: manufacturer.longitude,
      }));
  }

  private mapSingleManufacturerResponse(raw: unknown): ApiManufacturerDetail | null {
    if (Array.isArray(raw)) {
      const first = raw[0] as ApiManufacturerLike | undefined;
      const mapped = first ? adaptApiManufacturer(first) : null;
      return mapped ? ({ ...mapped } as ApiManufacturerDetail) : null;
    }

    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const wrapped = record['item'] ?? record['manufacturer'] ?? raw;
    const mapped = adaptApiManufacturer(wrapped as ApiManufacturerLike);
    return mapped ? ({ ...mapped } as ApiManufacturerDetail) : null;
  }

  private requestManufacturers$(): Observable<unknown> {
    const url = `${this.API_BASE_URL}/Manufacturers`;
    if (!this.useApiV2) {
      return this.http.get<unknown>(url);
    }

    return fetchAllPages<ApiManufacturerLike>(
      (page, pageSize) => {
        const params = new HttpParams()
          .set('page', String(page))
          .set('pageSize', String(pageSize));
        return this.http.get<unknown>(url, { params });
      },
      {
        pageSize: this.pageSize,
        maxPages: this.maxPages,
        startPage: 1,
      }
    ).pipe(map((result) => result.items));
  }

  private normalizeLocationIds(input: unknown): number[] {
    if (!Array.isArray(input)) return [];
    const deduped = new Set<number>();
    for (const item of input) {
      const parsed = parseNumericId(item);
      if (parsed != null) deduped.add(parsed);
    }
    return Array.from(deduped.values());
  }

  private getManufacturersApi$(): Observable<ApiManufacturer[]> {
    const now = Date.now();
    if (this.manufacturersCache$ && now < this.manufacturersCacheExpiresAt) return this.manufacturersCache$;
    if (now < this.manufacturersCooldownUntil) return of([] as ApiManufacturer[]);

    const request$ = this.requestManufacturers$().pipe(
      timeout(10000),
      map((raw) => this.mapManufacturersResponse(raw)),
      catchError((err) => {
        this.warnManufacturersApiOncePer(60_000, err);
        this.manufacturersCooldownUntil = Date.now() + 60_000;
        this.manufacturersCacheExpiresAt = Date.now() + 30_000;
        return of([] as ApiManufacturer[]);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.manufacturersCache$ = request$;
    this.manufacturersCacheExpiresAt = now + 5 * 60_000;
    return request$;
  }

  private getManufacturerById(id: string | number): Observable<ApiManufacturerDetail | null> {
    return this.http
      .get<unknown>(`${this.API_BASE_URL}/Manufacturers/${id}`)
      .pipe(
        map((raw) => this.mapSingleManufacturerResponse(raw)),
        catchError((err) => {
          console.warn(`Manufacturer lookup failed for id=${id}:`, err);
          return of(null);
        })
      );
  }

  updateManufacturer(
    id: string | number,
    updates: Partial<Pick<ApiManufacturerDetail, 'manufacturerName' | 'manufacturerLogo' | 'manufacturerLogoName'>> & {
      locationIds?: number[];
      locationId?: number | null;
    }
  ): Observable<ApiManufacturerDetail | null> {
    return this.getManufacturerById(id).pipe(
      switchMap((existing) => {
        if (!existing) return of(null);
        const hasRequestedLocationIds = Object.prototype.hasOwnProperty.call(updates, 'locationIds');
        const requestedLocationIds = this.normalizeLocationIds(updates.locationIds);
        const existingLocationIds = this.normalizeLocationIds(existing.locationIds);
        const requestedSingleLocationId = parseNumericId(updates.locationId);
        const existingSingleLocationId = parseNumericId(existing.locationId);
        const currentPrimaryLocationId =
          existingSingleLocationId ?? (existingLocationIds.length > 0 ? existingLocationIds[0] : null);

        let locationIds: number[] = [];
        if (hasRequestedLocationIds) {
          locationIds = requestedLocationIds;
        } else if (requestedSingleLocationId != null) {
          locationIds =
            existingLocationIds.length > 1 && currentPrimaryLocationId === requestedSingleLocationId
              ? existingLocationIds
              : [requestedSingleLocationId];
        } else if (existingLocationIds.length > 0) {
          locationIds = existingLocationIds;
        } else if (existingSingleLocationId != null) {
          locationIds = [existingSingleLocationId];
        }

        const baseBody = {
          manufacturerName: updates.manufacturerName ?? existing.manufacturerName,
          manufacturerLogo: updates.manufacturerLogo ?? existing.manufacturerLogo ?? null,
          manufacturerLogoName: updates.manufacturerLogoName ?? existing.manufacturerLogoName ?? null,
          locationIds,
        };

        const applyLogoPayloadMode = (
          body: typeof baseBody,
          mode: LogoPayloadMode
        ): typeof baseBody => ({
          ...body,
          manufacturerLogo: prepareLogoForMode(body.manufacturerLogo, mode),
        });

        const endpoint = `${this.API_BASE_URL}/Manufacturers/${id}`;
        const primaryBody = applyLogoPayloadMode(baseBody, this.logoPayloadMode);

        return this.http.put<unknown>(endpoint, primaryBody).pipe(
          timeout(10000),
          catchError((err) => {
            const shouldRetry =
              this.logoPayloadMode === 'autoRetryRawBase64' &&
              isDataUrlBase64(baseBody.manufacturerLogo) &&
              shouldRetryWithRawBase64(err);
            if (!shouldRetry) return throwError(() => err);
            const fallbackBody = applyLogoPayloadMode(baseBody, 'rawBase64');
            return this.http.put<unknown>(endpoint, fallbackBody).pipe(timeout(10000));
          }),
          switchMap(() => {
            this.manufacturersCache$ = null;
            this.manufacturersCacheExpiresAt = 0;
            return this.getManufacturerById(id);
          }),
          catchError((err) => {
            console.error(`Failed to update manufacturer id=${id}:`, err);
            return throwError(() => err);
          })
        );
      })
    );
  }

  createManufacturer(body: CreateManufacturerRequest): Observable<ApiManufacturerDetail | null> {
    const baseBody = {
      manufacturerName: String(body.manufacturerName ?? '').trim(),
      manufacturerLogo: body.manufacturerLogo ?? null,
      manufacturerLogoName: body.manufacturerLogoName ?? null,
      locationIds: this.normalizeLocationIds(body.locationIds),
    };

    if (!baseBody.manufacturerName) {
      return throwError(() => new Error('Manufacturer name is required.'));
    }

    const applyLogoPayloadMode = (
      payload: typeof baseBody,
      mode: LogoPayloadMode
    ): typeof baseBody => ({
      ...payload,
      manufacturerLogo: prepareLogoForMode(payload.manufacturerLogo, mode),
    });

    const endpoint = `${this.API_BASE_URL}/Manufacturers`;
    const primaryPayload = applyLogoPayloadMode(baseBody, this.logoPayloadMode);

    return this.http.post<unknown>(endpoint, primaryPayload).pipe(
      timeout(10000),
      catchError((err) => {
        const shouldRetry =
          this.logoPayloadMode === 'autoRetryRawBase64' &&
          isDataUrlBase64(baseBody.manufacturerLogo) &&
          shouldRetryWithRawBase64(err);
        if (!shouldRetry) return throwError(() => err);
        const fallbackPayload = applyLogoPayloadMode(baseBody, 'rawBase64');
        return this.http.post<unknown>(endpoint, fallbackPayload).pipe(timeout(10000));
      }),
      switchMap((created) => {
        this.manufacturersCache$ = null;
        this.manufacturersCacheExpiresAt = 0;

        const mapped = this.mapSingleManufacturerResponse(created);
        if (mapped) return of(mapped);

        const manufacturerId = extractManufacturerId(created);
        if (manufacturerId == null) return of(null);
        return this.getManufacturerById(manufacturerId);
      }),
      catchError((err) => {
        console.error('Failed to create manufacturer:', err);
        return throwError(() => err);
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
          const locationIds = this.normalizeLocationIds(m.locationIds)
            .concat((m.locations ?? []).map((location) => location.id))
            .concat(parseNumericId(m.locationId) != null ? [parseNumericId(m.locationId)!] : []);
          for (const locId of locationIds) {
            if (manufacturerByLocationId.has(locId)) continue;
            manufacturerByLocationId.set(locId, m);
          }
        }

        return locations
          .map((loc: ApiLocation) => {
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
          .sort((a: ManufacturerLocationOption, b: ManufacturerLocationOption) =>
            a.label.localeCompare(b.label)
          );
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
    this.projectsWithRefreshCache.clear();
    this.lastNonEmptyByKey.clear();
    this.projectsRefresh$.next();
  }

  getProjectsWithRefresh(filters?: ProjectFilters): Observable<Project[]> {
    const key = this.projectsFiltersKey(filters);
    const cached = this.projectsWithRefreshCache.get(key);
    if (cached) return cached;

    const stream$ = this.projectsRefresh$.pipe(
      startWith(void 0),
      switchMap(() => this.getProjects(filters)),
      map((projects) => {
        if (projects.length > 0) this.lastNonEmptyByKey.set(key, projects);
        return projects.length > 0 ? projects : (this.lastNonEmptyByKey.get(key) ?? []);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.projectsWithRefreshCache.set(key, stream$);
    return stream$;
  }

  private getProjectsApi$(): Observable<unknown> {
    const now = Date.now();
    if (now < this.projectsCooldownUntil) return of([] as ApiProject[]);

    const url = `${this.API_BASE_URL}/${this.PROJECTS_ROUTE}`;
    const request$ = this.useApiV2
      ? fetchAllPages<ApiProject>(
          (page, pageSize) => {
            const params = new HttpParams()
              .set('includeClosed', 'true')
              .set('page', String(page))
              .set('pageSize', String(pageSize));
            return this.http.get<unknown>(url, { params }).pipe(timeout(30_000));
          },
          {
            pageSize: this.pageSize,
            maxPages: this.maxPages,
            startPage: 1,
          }
        ).pipe(map((result) => result.items))
      : this.http.get<unknown>(url, { params: new HttpParams().set('includeClosed', 'true') }).pipe(timeout(30_000));

    return request$.pipe(
      retry({
        count: 1,
        delay: (err) => {
          this.warnProjectsApiOncePer(60_000, err);
          return timer(500);
        },
      }),
      catchError((err) => {
        this.warnProjectsApiOncePer(60_000, err);
        this.projectsCooldownUntil = Date.now() + 30_000;
        return of([] as ApiProject[]);
      })
    );
  }

  getProjects(filters?: ProjectFilters): Observable<Project[]> {
    return forkJoin({
      clients: this.clientService.getClients().pipe(catchError(() => of([]))),
      manufacturers: this.getManufacturersApi$(),
      locations: this.locationService.getAllLocations().pipe(catchError(() => of([]))),
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
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) => applyFilters(projects, { manufacturerLocationId }))
    );
  }

  getProjectsByManufacturerLocation(manufacturerLocationId: string): Observable<Project[]> {
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) => applyFilters(projects, { manufacturerLocationId }))
    );
  }

  getProjectsByClient(clientId: string): Observable<Project[]> {
    const normalizedClientId = normalizeNumericLikeId(clientId);
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) =>
        projects.filter((p) => normalizeNumericLikeId(p.clientId) === normalizedClientId)
      )
    );
  }

  private mapProjectTypeCatalogFromProjects(projects: Project[]): Array<{ id: number; name: string }> {
    const byName = new Map<string, { id: number; name: string }>();
    for (const project of projects) {
      const name = project.assessmentType?.trim() ?? '';
      const id = parseNumericId(project.projectTypeId);
      if (!name || id == null) continue;
      const key = name.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, { id, name });
      }
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private getProjectTypesCatalogFromProjects$(): Observable<Array<{ id: number; name: string }>> {
    return this.getProjects({}).pipe(
      map((projects) => this.mapProjectTypeCatalogFromProjects(projects)),
      catchError(() => of([]))
    );
  }

  private getProjectTypesCatalogApi$(): Observable<Array<{ id: number; name: string }>> {
    return this.http
      .get<unknown>(`${this.API_BASE_URL}/${this.PROJECT_TYPES_ROUTE}`)
      .pipe(
        timeout(10000),
        map((raw) => normalizeProjectTypesResponse(raw)),
        map((apiTypes) => {
          const byName = new Map<string, { id: number; name: string }>();
          for (const apiType of apiTypes) {
            const isActive =
              typeof apiType.active === 'boolean'
                ? apiType.active
                : (typeof apiType.isActive === 'boolean' ? apiType.isActive : true);
            if (!isActive) continue;

            const id = parseNumericId(apiType.id) ?? parseNumericId(apiType.projectTypeId);
            const name = (
              apiType.name ??
              apiType.projectTypeName ??
              apiType.assessmentType ??
              ''
            ).trim();
            if (!name || id == null) continue;

            const key = name.toLowerCase();
            if (!byName.has(key)) {
              byName.set(key, { id, name });
            }
          }
          return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
        }),
        catchError((err) => {
          if (err instanceof HttpErrorResponse && err.status === 404) {
            return of([]);
          }
          return throwError(() => err);
        })
      );
  }

  getProjectTypesCatalog(): Observable<Array<{ id: number; name: string }>> {
    return this.getProjectTypesCatalogApi$().pipe(
      switchMap((catalog) => {
        if (catalog.length > 0) return of(catalog);
        return this.getProjectTypesCatalogFromProjects$();
      }),
      catchError((err) => {
        console.warn('ProjectTypes API request failed, using Projects fallback:', err);
        return this.getProjectTypesCatalogFromProjects$();
      })
    );
  }

  resolveProjectTypeIdByName(typeName: string): Observable<number | null> {
    const normalized = typeName.trim().toLowerCase();
    if (!normalized) return of(null);
    return this.getProjectTypesCatalogApi$().pipe(
      map((catalog) => catalog.find((type) => type.name.trim().toLowerCase() === normalized)?.id ?? null),
      switchMap((resolvedId) => {
        if (resolvedId != null) return of(resolvedId);
        return this.getProjectTypesCatalogFromProjects$().pipe(
          map((catalog) => catalog.find((type) => type.name.trim().toLowerCase() === normalized)?.id ?? null),
          catchError(() => of(null))
        );
      }),
      catchError((err) => {
        console.warn('ProjectTypes API lookup failed, using Projects fallback:', err);
        return this.getProjectTypesCatalogFromProjects$().pipe(
          map((catalog) => catalog.find((type) => type.name.trim().toLowerCase() === normalized)?.id ?? null),
          catchError(() => of(null))
        );
      })
    );
  }

  private buildProjectUpsertPayload(project: ProjectUpsertInput): {
    name: string;
    clientId: number;
    projectTypeId: number;
    contract: string;
    hasRoadTest: boolean;
    locationIds: number[];
  } {
    const clientId = parseNumericId(project.clientId);
    const projectTypeId = parseNumericId(project.projectTypeId);

    const locationIds = this.normalizeLocationIds(project.locationIds);
    if (locationIds.length === 0 && Array.isArray(project.locations)) {
      locationIds.push(...this.normalizeLocationIds(project.locations.map((location) => location.id)));
    }
    if (locationIds.length === 0) {
      const fallbackLocationId =
        parseNumericId(project.locationId) ??
        parseManufacturerLocationId(project.manufacturerLocationId);
      if (fallbackLocationId != null) {
        locationIds.push(fallbackLocationId);
      }
    }

    if (clientId == null || locationIds.length === 0 || projectTypeId == null) {
      throw new Error('Missing required API fields: clientId, locationIds, or projectTypeId.');
    }

    const contract = (project as { contract?: string | null }).contract ?? '';
    const hasRoadTest = (project as { hasRoadTest?: boolean | null }).hasRoadTest ?? false;
    return {
      name: project.projectName,
      clientId,
      projectTypeId,
      contract,
      hasRoadTest,
      locationIds,
    };
  }

  private mapProjectById(projectId: number, fallback: Omit<Project, 'id'> | Project): Observable<Project> {
    return forkJoin({
      clients: this.clientService.getClients(),
      manufacturers: this.getManufacturersApi$(),
      locations: this.locationService.getAllLocations(),
      raw: this.http.get<unknown>(`${this.API_BASE_URL}/${this.PROJECTS_ROUTE}/${projectId}`).pipe(
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
      projectTypeId: number;
      contract?: string;
      hasRoadTest?: boolean;
      locationIds: number[];
    };
    try {
      body = this.buildProjectUpsertPayload(project);
    } catch (err) {
      return throwError(() => err);
    }

    return this.http
      .post<{ id?: number | string }>(`${this.API_BASE_URL}/${this.PROJECTS_ROUTE}`, body)
      .pipe(
        switchMap((created) => {
          const createdId = parseNumericId(created?.id);
          if (createdId == null) {
            throw new Error('Project create response did not include id.');
          }
          return this.mapProjectById(createdId, project);
        }),
        catchError((err) => {
          console.error('Failed to add project:', err, { body });
          return throwError(() => toApiError('Failed to add project', err));
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
      projectTypeId: number;
      contract?: string;
      hasRoadTest?: boolean;
      locationIds: number[];
    };
    try {
      body = this.buildProjectUpsertPayload(project);
    } catch (err) {
      return throwError(() => err);
    }

    return this.http
      .put<unknown>(`${this.API_BASE_URL}/${this.PROJECTS_ROUTE}/${projectId}`, body)
      .pipe(
        switchMap(() => this.mapProjectById(projectId, project)),
        catchError((err) => {
          console.error('Failed to update project:', err, { projectId, body });
          return throwError(() => toApiError('Failed to update project', err));
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
    return this.getManufacturersApi$()
      .pipe(
        map((items) => {
          const byName = new Map<string, FilterOptionWithCount>();
          for (const manufacturer of items) {
            const displayName = (manufacturer.manufacturerName ?? '').trim();
            if (!displayName) continue;
            const key = this.normalizeManufacturerOptionKey(displayName);
            if (byName.has(key)) continue;
            byName.set(key, {
              id: displayName,
              name: displayName,
              count: 0,
            });
          }
          return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
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
    return this.getManufacturersApi$()
      .pipe(
        map((items) => {
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
        const seenLocationIds = new Set<number>();
        const locationsById = new Map<number, ApiLocation>(
          locations.map((location: ApiLocation) => [location.id, location])
        );
        const manufacturerByLocationId = new Map<number, ApiManufacturer>();
        const manufacturerByNameKey = new Map<string, ApiManufacturer>();
        const groupsByManufacturerId = new Map<
          string,
          {
            manufacturer: ApiManufacturer;
            locations: Array<{ id: string; name: string; latitude: number; longitude: number }>;
            warnings: string[];
          }
        >();
        for (const manufacturer of manufacturers) {
          if (!this.isLikelyManufacturerName(manufacturer.manufacturerName)) continue;
          const manufacturerLocationIds = this.normalizeLocationIds(manufacturer.locationIds)
            .concat((manufacturer.locations ?? []).map((location) => location.id))
            .concat(parseNumericId(manufacturer.locationId) != null ? [parseNumericId(manufacturer.locationId)!] : []);
          for (const locationId of manufacturerLocationIds) {
            if (!manufacturerByLocationId.has(locationId)) {
              manufacturerByLocationId.set(locationId, manufacturer);
            }
          }
          const nameKey = this.normalizeManufacturerKey(manufacturer.manufacturerName);
          if (nameKey && !manufacturerByNameKey.has(nameKey)) {
            manufacturerByNameKey.set(nameKey, manufacturer);
          }
        }

        for (const loc of locations) {
          if (seenLocationIds.has(loc.id)) continue;
          seenLocationIds.add(loc.id);

          const parsedManufacturer = this.parseManufacturerFromLocationName(loc.name);
          if (!parsedManufacturer) continue;
          if (!this.isLikelyManufacturerName(parsedManufacturer)) continue;

          // Prefer name-based mapping ("City (Manufacturer)") over backend locationId mapping.
          // We have seen cases where `manufacturer.locationId === loc.id` points to the wrong entity,
          // which results in mis-labeled manufacturer sites in Project/Manufacturer views (e.g., "ENC" vs "New Flyer").
          const manufacturerByName = manufacturerByNameKey.get(this.normalizeManufacturerKey(parsedManufacturer));
          const manufacturerByLoc = manufacturerByLocationId.get(loc.id);
          const manufacturer = manufacturerByName ?? manufacturerByLoc;
          if (!manufacturer) continue;

          const manufacturerIdKey = String(manufacturer.id);
          if (!groupsByManufacturerId.has(manufacturerIdKey)) {
            groupsByManufacturerId.set(manufacturerIdKey, { manufacturer, locations: [], warnings: [] });
          }
          const group = groupsByManufacturerId.get(manufacturerIdKey)!;
          if (manufacturerByName && manufacturerByLoc && manufacturerByName.id !== manufacturerByLoc.id) {
            group.warnings.push(
              `Location ${loc.id} name indicates "${parsedManufacturer}" but backend links it to "${manufacturerByLoc.manufacturerName}" via locationIds; using name-based mapping.`
            );
          }
          const locationId = `loc-${loc.id}`;
          if (!group.locations.some((entry) => entry.id === locationId)) {
            group.locations.push({
              id: locationId,
              name: loc.name,
              latitude: loc.latitude,
              longitude: loc.longitude,
            });
          }
        }

        // Keep manufacturer rows visible even when location mapping is missing/invalid.
        // Strict API mode: do not synthesize fallback location entries.
        for (const manufacturer of manufacturers) {
          if (!this.isLikelyManufacturerName(manufacturer.manufacturerName)) continue;
          const manufacturerIdKey = String(manufacturer.id);
          if (!groupsByManufacturerId.has(manufacturerIdKey)) {
            groupsByManufacturerId.set(manufacturerIdKey, { manufacturer, locations: [], warnings: [] });
          }
          const group = groupsByManufacturerId.get(manufacturerIdKey)!;
          const manufacturerLocationIds = this.normalizeLocationIds(manufacturer.locationIds)
            .concat((manufacturer.locations ?? []).map((location) => location.id))
            .concat(parseNumericId(manufacturer.locationId) != null ? [parseNumericId(manufacturer.locationId)!] : []);

          if (manufacturerLocationIds.length === 0) {
            group.warnings.push('Missing location ID in backend manufacturer record.');
            continue;
          }

          for (const locationId of manufacturerLocationIds) {
            const mappedLocation = locationsById.get(locationId);
            if (!mappedLocation) {
              group.warnings.push(`Mapped location ID ${locationId} was not found in backend locations.`);
              continue;
            }

            const parsedManufacturer = this.parseManufacturerFromLocationName(mappedLocation.name);
            if (!parsedManufacturer) {
              group.warnings.push(
                `Mapped location ID ${locationId} is invalid for manufacturer view (expected \"City (Manufacturer)\").`
              );
              continue;
            }

            if (!this.isLikelyManufacturerName(parsedManufacturer)) {
              group.warnings.push(`Mapped location ID ${locationId} resolves to a non-manufacturer entity.`);
              continue;
            }
          }
        }

        const rawSubsidiaries: SubsidiaryCompany[] = Array.from(groupsByManufacturerId.values()).map(
          ({ manufacturer, locations: groupedLocations, warnings }) => {
            const subsidiaryId = String(manufacturer.id);
            const displayName = manufacturer.manufacturerName;
            const manufacturerLocations: ManufacturerLocation[] = groupedLocations
              .filter((loc) => this.hasValidCoordinates(loc.latitude, loc.longitude))
              .map((loc) => {
              const { city, country } = this.parseLocationName(loc.name);
              return {
                id: loc.id,
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
            const firstLoc = groupedLocations[0];
            const firstCity = firstLoc ? this.parseLocationName(firstLoc.name).city : undefined;
            return {
              id: subsidiaryId,
              parentGroupId,
              name: displayName,
              status: 'ACTIVE' as const,
              metrics: subsidiaryMetrics,
              manufacturerLocations,
              factories: manufacturerLocations,
              hubs: [] as Hub[],
              quantumChart: this.deriveQuantumChart(manufacturerLocations, subsidiaryMetrics),
              location: firstCity,
              logo: manufacturer.manufacturerLogo ?? undefined,
              description: Array.from(new Set(warnings)).join(' '),
            };
          }
        );
        const subsidiaries = this.mergeSubsidiariesByName(rawSubsidiaries, parentGroupId);
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
          subsidiaries: subsidiaries.sort((a, b) => a.name.localeCompare(b.name)),
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

  private normalizeManufacturerOptionKey(name: string): string {
    return name.trim().toLowerCase();
  }

  private normalizeManufacturerKey(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private isLikelyManufacturerName(name: string): boolean {
    const normalized = this.normalizeManufacturerKey(name);
    if (!normalized) return false;
    for (const token of this.nonManufacturerTokens) {
      if (normalized.includes(token)) return false;
    }
    return true;
  }

  private mergeSubsidiariesByName(subsidiaries: SubsidiaryCompany[], parentGroupId: string): SubsidiaryCompany[] {
    const mergedByName = new Map<string, SubsidiaryCompany>();
    for (const subsidiary of subsidiaries) {
      const key = this.normalizeManufacturerKey(subsidiary.name);
      const existing = mergedByName.get(key);
      if (!existing) {
        const normalizedFactories = (subsidiary.factories ?? []).map((factory) => ({
          ...factory,
          parentGroupId,
          subsidiaryId: subsidiary.id,
        }));
        mergedByName.set(key, {
          ...subsidiary,
          parentGroupId,
          factories: normalizedFactories,
          manufacturerLocations: normalizedFactories,
        });
        continue;
      }

      const allFactories = [...(existing.factories ?? []), ...(subsidiary.factories ?? [])].map((factory) => ({
        ...factory,
        parentGroupId,
        subsidiaryId: existing.id,
      }));
      const dedupedFactories = Array.from(new Map(allFactories.map((factory) => [factory.id, factory])).values());
      const metrics = this.deriveSubsidiaryMetrics(dedupedFactories);
      mergedByName.set(key, {
        ...existing,
        parentGroupId,
        name: existing.name.length >= subsidiary.name.length ? existing.name : subsidiary.name,
        logo: existing.logo ?? subsidiary.logo,
        location: existing.location ?? subsidiary.location,
        factories: dedupedFactories,
        manufacturerLocations: dedupedFactories,
        description: this.mergeDescriptions(existing.description, subsidiary.description),
        metrics,
        quantumChart: this.deriveQuantumChart(dedupedFactories, metrics),
      });
    }
    return Array.from(mergedByName.values());
  }

  private mergeDescriptions(left?: string, right?: string): string | undefined {
    const parts = [left?.trim(), right?.trim()].filter((part): part is string => !!part);
    if (parts.length === 0) return undefined;
    return Array.from(new Set(parts)).join(' ');
  }

  private parseManufacturerFromLocationName(locationName: string): string | null {
    const match = locationName.match(/\(([^)]+)\)\s*$/);
    if (!match) return null;
    const parsed = match[1].trim();
    return parsed ? parsed : null;
  }

  private parseLocationName(name: string): { city: string; country: string } {
    const match = name.match(/^([^(]+)\s*\([^)]+\)$/);
    if (match) {
      return { city: match[1].trim(), country: '' };
    }
    return { city: name.trim(), country: '' };
  }

  private hasValidCoordinates(latitude: number | null | undefined, longitude: number | null | undefined): boolean {
    if (latitude == null || longitude == null) return false;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    return !(latitude === 0 && longitude === 0);
  }

  private extractNumericId(rawId: string): string {
    const normalized = rawId.trim().replace(/^source-/i, '').replace(/^loc-/i, '');
    if (!/^\d+$/.test(normalized)) return '';
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? String(parsed) : '';
  }

  private buildIdLookupCandidates(rawId: unknown): string[] {
    if (rawId == null) return [];
    const candidates: string[] = [];
    const pushCandidate = (value: string | null | undefined): void => {
      if (!value) return;
      const normalized = value.trim();
      if (!normalized || candidates.includes(normalized)) return;
      candidates.push(normalized);
    };

    const raw = String(rawId).trim();
    if (!raw) return [];

    pushCandidate(raw);

    const withoutSource = raw.replace(/^source-/i, '').trim();
    pushCandidate(withoutSource);

    const withoutLoc = raw.replace(/^loc-/i, '').trim();
    pushCandidate(withoutLoc);

    const numeric = this.extractNumericId(raw);
    if (numeric) {
      pushCandidate(numeric);
      pushCandidate(`loc-${numeric}`);
    }

    return candidates;
  }

  private buildFactoryLookupCandidates(rawId: unknown): string[] {
    const candidates = this.buildIdLookupCandidates(rawId);
    if (rawId == null) return candidates;
    const numeric = this.extractNumericId(String(rawId));
    if (!numeric) return candidates;
    const preferredLocId = `loc-${numeric}`;
    if (!candidates.includes(preferredLocId)) {
      return [preferredLocId, ...candidates];
    }
    return [preferredLocId, ...candidates.filter((id) => id !== preferredLocId)];
  }

  private buildProjectFactoryLookupCandidates(project: Pick<Project, 'manufacturerLocationId' | 'locationId'>): string[] {
    const merged: string[] = [];
    const append = (candidates: string[]): void => {
      for (const candidate of candidates) {
        if (!merged.includes(candidate)) {
          merged.push(candidate);
        }
      }
    };

    // Prefer explicit manufacturer location id, but always fall back to location id.
    append(this.buildFactoryLookupCandidates(project.manufacturerLocationId));
    append(this.buildFactoryLookupCandidates(project.locationId));

    return merged;
  }

  private buildProjectLocationIds(
    project: Pick<Project, 'locationId' | 'manufacturerLocationId'> & ProjectLocationShape
  ): number[] {
    const deduped = new Set<number>();

    for (const locationId of this.normalizeLocationIds(project.locationIds)) {
      deduped.add(locationId);
    }

    if (Array.isArray(project.locations)) {
      for (const location of project.locations) {
        const parsed = parseNumericId(location?.id);
        if (parsed != null) deduped.add(parsed);
      }
    }

    const legacyLocationId = parseNumericId(project.locationId);
    if (legacyLocationId != null) deduped.add(legacyLocationId);

    const legacyManufacturerLocationId = parseManufacturerLocationId(project.manufacturerLocationId);
    if (legacyManufacturerLocationId != null) {
      if (legacyLocationId == null || legacyManufacturerLocationId === legacyLocationId) {
        deduped.add(legacyManufacturerLocationId);
      }
    }

    return Array.from(deduped.values()).sort((a, b) => a - b);
  }

  private buildProjectLocationCoordinateMap(
    project: ProjectLocationShape
  ): Map<number, { latitude: number; longitude: number }> {
    const mapByLocationId = new Map<number, { latitude: number; longitude: number }>();
    if (!Array.isArray(project.locations)) return mapByLocationId;

    for (const location of project.locations) {
      const locationId = parseNumericId(location?.id);
      if (locationId == null) continue;
      const latitude = Number((location as { latitude?: number }).latitude);
      const longitude = Number((location as { longitude?: number }).longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      mapByLocationId.set(locationId, { latitude, longitude });
    }

    return mapByLocationId;
  }

  private resolveCoordinatesByCandidates(
    coordinatesMap: Map<string, { latitude: number; longitude: number }>,
    candidates: string[]
  ): { key: string; coordinates: { latitude: number; longitude: number } } | null {
    for (const candidate of candidates) {
      const coords = coordinatesMap.get(candidate);
      if (coords) {
        return { key: candidate, coordinates: coords };
      }
    }
    return null;
  }

  getClientOptionsWithCounts(): Observable<FilterOptionWithCount[]> {
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) => {
        const byId = new Map<string, { name: string; count: number }>();
        for (const p of projects) {
          const normalizedClientId = normalizeNumericLikeId(p.clientId);
          if (!normalizedClientId) continue;
          const existing = byId.get(normalizedClientId);
          const candidateName = p.clientName?.trim();
          const name = candidateName || normalizedClientId;
          if (existing) {
            existing.count++;
            if (existing.name === normalizedClientId && candidateName) {
              existing.name = candidateName;
            }
          } else {
            byId.set(normalizedClientId, { name, count: 1 });
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
          if (p.manufacturer?.trim()) {
            const key = this.normalizeManufacturerOptionKey(p.manufacturer);
            countByManufacturer.set(
              key,
              (countByManufacturer.get(key) ?? 0) + 1
            );
          }
        }
        return apiManufacturers.map((m) => ({
          ...m,
          count: countByManufacturer.get(this.normalizeManufacturerOptionKey(m.name)) ?? 0,
        }));
      })
    );
  }

  getProjectTypeOptionsWithCounts(): Observable<FilterOptionWithCount[]> {
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) => {
        const byId = new Map<string, number>();
        for (const p of projects) {
          const key = normalizeProjectTypeFilterKey(p.projectTypeId, p.assessmentType);
          if (!key) continue;
          byId.set(key, (byId.get(key) ?? 0) + 1);
        }
        return Array.from(byId.entries())
          .map(([id, count]) => ({
            id,
            name: projects.find((project) => normalizeProjectTypeFilterKey(project.projectTypeId, project.assessmentType) === id)?.assessmentType ?? id,
            count,
          }))
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
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) => applyFilters(projects, filters)),
      map((filteredProjects) => {
        const routes: ProjectRoute[] = [];
        const skipped: { id: string; clientId: string | null; locationId: string | null; hasClient: boolean; hasFactory: boolean }[] = [];
        let cappedProjects = 0;
        let cappedTotalRoutes = false;

        for (const p of filteredProjects) {
          if (routes.length >= this.mapMaxTotalRoutes) {
            cappedTotalRoutes = true;
            break;
          }

          const clientCandidates = this.buildIdLookupCandidates(p.clientId);
          const resolvedClient = this.resolveCoordinatesByCandidates(clientCoordinates, clientCandidates);
          const projectLocationIds = this.buildProjectLocationIds(p);
          const projectLocationCoordinates = this.buildProjectLocationCoordinateMap(p);

          const limitedLocationIds = projectLocationIds.slice(0, this.mapMaxLocationsPerProject);
          if (projectLocationIds.length > limitedLocationIds.length) {
            cappedProjects += 1;
          }

          for (const locationId of limitedLocationIds) {
            if (routes.length >= this.mapMaxTotalRoutes) {
              cappedTotalRoutes = true;
              break;
            }

            const status = p.status ?? 'Open';
            const preferredLocationKey = `loc-${locationId}`;
            const fallbackLocationKey = String(locationId);
            const fallbackNodeKey = factoryCoordinates.has(preferredLocationKey)
              ? preferredLocationKey
              : (factoryCoordinates.has(fallbackLocationKey) ? fallbackLocationKey : preferredLocationKey);

            let resolvedFactory = this.resolveCoordinatesByCandidates(
              factoryCoordinates,
              this.buildFactoryLookupCandidates(locationId)
            );

            const explicitProjectCoordinates = projectLocationCoordinates.get(locationId);
            if (explicitProjectCoordinates) {
              resolvedFactory = {
                key: fallbackNodeKey,
                coordinates: explicitProjectCoordinates,
              };
            }

            if (!resolvedFactory) {
              resolvedFactory = this.resolveCoordinatesByCandidates(
                factoryCoordinates,
                this.buildProjectFactoryLookupCandidates(p)
              );
            }

            if (resolvedClient && resolvedFactory) {
              routes.push({
                id: `project-route-${p.id}-loc-${locationId}`,
                projectId: String(p.id),
                fromNodeId: resolvedClient.key,
                toNodeId: resolvedFactory.key,
                status,
                fromCoordinates: resolvedClient.coordinates,
                toCoordinates: resolvedFactory.coordinates,
                animated: status === 'Open',
                strokeColor:
                  status === 'Open' ? '#5ad85a' : status === 'Delayed' ? '#ef4444' : '#94a3b8',
              });
            } else {
              skipped.push({
                id: String(p.id),
                clientId: p.clientId ?? null,
                locationId: String(locationId),
                hasClient: !!resolvedClient,
                hasFactory: !!resolvedFactory,
              });
            }
          }
        }
        if ((skipped.length > 0 || cappedProjects > 0 || cappedTotalRoutes) && isDevMode()) {
          const signature = `${skipped.length}|${cappedProjects}|${cappedTotalRoutes ? 1 : 0}|${skipped
            .slice(0, 12)
            .map((item) => `${item.id}:${item.clientId ?? '-'}:${item.locationId ?? '-'}:${item.hasClient ? 1 : 0}:${item.hasFactory ? 1 : 0}`)
            .join('|')}`;
          const now = Date.now();
          if (
            signature !== this.lastSkippedRoutesLogSignature ||
            now - this.lastSkippedRoutesLogAt >= this.skippedRoutesLogMinIntervalMs
          ) {
            this.lastSkippedRoutesLogSignature = signature;
            this.lastSkippedRoutesLogAt = now;
            const preview = skipped.slice(0, 10);
            console.debug(
              `Skipped ${skipped.length} project routes due to missing coordinates. ` +
              `Capped projects=${cappedProjects}, total-route-cap-hit=${cappedTotalRoutes}.`,
              preview
            );
          }
        }
        return routes;
      })
    );
  }
}
