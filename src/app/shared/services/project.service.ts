import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import {
  Observable,
  of,
  map,
  switchMap,
  catchError,
  Subject,
  startWith,
  forkJoin,
  throwError,
  timer,
  timeout,
  retry,
  shareReplay,
} from 'rxjs';
import { Project, ProjectStatus } from '../models/project.model';
import { Client } from '../models/client.model';
import { ClientService } from './client.service';
import { LocationService, ApiLocation } from '../services/location.service';
import { normalizeNumericLikeId } from '../utils/id-normalizer.util';
import { normalizeProjectTypeFilterKey } from '../utils/project-type-filter.util';
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
type ServerProjectFilters = {
  clientId?: string;
  projectTypeId?: string;
  locationId?: string;
  includeClosed: boolean;
};

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

function firstSingleNumericArrayValue(values: unknown[] | undefined): number | null {
  if (!Array.isArray(values) || values.length !== 1) return null;
  return parseNumericId(values[0]);
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
    totalAssets: norm.totalAssets ?? undefined,
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
    result = result.filter((p) => {
      const normalizedProjectTypeId = normalizeProjectTypeFilterKey(p.projectTypeId, p.assessmentType);
      return !!normalizedProjectTypeId && filters.projectTypeIds!.includes(normalizedProjectTypeId);
    });
  } else if (filters?.projectType && filters.projectType !== 'all') {
    result = result.filter(
      (p) => normalizeProjectTypeFilterKey(p.projectTypeId, p.assessmentType) === filters!.projectType
    );
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
  private readonly logoPayloadMode: LogoPayloadMode;
  /**
   * Keep these PascalCase to match backend routes (/api/Projects, /api/ProjectTypes).
   * Some deployments (or reverse proxies) treat routes as case-sensitive.
   */
  private readonly PROJECTS_ROUTE = 'Projects';
  private readonly PROJECT_TYPES_ROUTE = 'ProjectTypes';

  private readonly projectsRefresh$ = new Subject<void>();
  private readonly projectsWithRefreshCache = new Map<string, Observable<Project[]>>();
  private readonly projectsApiCache = new Map<string, Observable<unknown>>();
  /** Last non-empty result per filter key; replayed when API returns [] (e.g. cooldown) so client list and panel stay populated */
  private readonly lastNonEmptyByKey = new Map<string, Project[]>();
  private projectsCooldownUntil = 0;
  private lastProjectsWarnAt = 0;
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

  private serverProjectsFiltersKey(filters?: ServerProjectFilters): string {
    return JSON.stringify({
      clientId: filters?.clientId ?? null,
      projectTypeId: filters?.projectTypeId ?? null,
      locationId: filters?.locationId ?? null,
      includeClosed: filters?.includeClosed ?? true,
    });
  }

  private normalizeServerProjectFilters(filters?: ProjectFilters): ServerProjectFilters {
    const explicitClientId = parseNumericId(filters?.clientId);
    const singleClientId = firstSingleNumericArrayValue(filters?.clientIds);
    const explicitProjectTypeId = parseNumericId(filters?.projectType);
    const singleProjectTypeId = firstSingleNumericArrayValue(filters?.projectTypeIds);
    const locationId = parseManufacturerLocationId(filters?.manufacturerLocationId);

    const includeClosed = (() => {
      if (filters?.projectStatuses?.length) {
        return filters.projectStatuses.some((status) => status !== 'Open');
      }
      if (filters?.status === 'Open') {
        return false;
      }
      return true;
    })();

    return {
      clientId:
        explicitClientId != null
          ? String(explicitClientId)
          : (singleClientId != null ? String(singleClientId) : undefined),
      projectTypeId:
        explicitProjectTypeId != null
          ? String(explicitProjectTypeId)
          : (singleProjectTypeId != null ? String(singleProjectTypeId) : undefined),
      locationId: locationId != null ? String(locationId) : undefined,
      includeClosed,
    };
  }

  private buildProjectsApiParams(filters?: ServerProjectFilters): HttpParams {
    let params = new HttpParams().set('includeClosed', filters?.includeClosed === false ? 'false' : 'true');

    if (filters?.clientId) {
      params = params.set('clientId', filters.clientId);
    }
    if (filters?.projectTypeId) {
      params = params.set('projectTypeId', filters.projectTypeId);
    }
    if (filters?.locationId) {
      params = params.set('locationId', filters.locationId);
    }

    return params;
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
    const params = new HttpParams().set('locationId', '0');
    return this.http.get<unknown>(`${this.API_BASE_URL}/Manufacturers`, { params });
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

  private parseLocationName(name: string | null | undefined): {
    city: string | null;
    stateProvince: string | null;
    country: string | null;
  } {
    const parts = String(name ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    return {
      city: parts[0] ?? null,
      stateProvince: parts[1] ?? null,
      country: parts[2] ?? null,
    };
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
    this.projectsApiCache.clear();
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

  private getProjectsApi$(filters?: ProjectFilters): Observable<unknown> {
    const now = Date.now();
    if (now < this.projectsCooldownUntil) return of([] as ApiProject[]);

    const serverFilters = this.normalizeServerProjectFilters(filters);
    const key = this.serverProjectsFiltersKey(serverFilters);
    const cached = this.projectsApiCache.get(key);
    if (cached) return cached;

    const url = `${this.API_BASE_URL}/${this.PROJECTS_ROUTE}`;
    const baseParams = this.buildProjectsApiParams(serverFilters);
    const request$ = this.useApiV2
      ? fetchAllPages<ApiProject>(
          (page, pageSize) => {
            const params = baseParams
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
      : this.http.get<unknown>(url, { params: baseParams }).pipe(timeout(30_000));

    const stream$ = request$.pipe(
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
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.projectsApiCache.set(key, stream$);
    return stream$;
  }

  getProjectsPagedList(params: {
    page: number;
    pageSize: number;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
    clientId?: string | number | null;
    includeClosed?: boolean;
  }): Observable<{ projects: Project[]; totalCount: number }> {
    const { page, pageSize, sortBy = 'id', sortDirection = 'asc', clientId, includeClosed = false } = params;

    const httpParams = new HttpParams()
      .set('clientId', String(clientId ?? 0))
      .set('projectTypeId', '0')
      .set('locationId', '0')
      .set('includeClosed', String(includeClosed))
      .set('page', String(page))
      .set('pageSize', String(pageSize))
      .set('SortBy', sortBy)
      .set('SortDirection', sortDirection);

    return this.http.get<unknown>(`${this.API_BASE_URL}/${this.PROJECTS_ROUTE}`, { params: httpParams })
      .pipe(
        timeout(30_000),
        map((raw) => {
          const paged = parsePagedResponse<ApiProject>(raw);
          const projects = paged.items
            .map((api) => mapApiProjectToProject(api, [], [], []))
            .filter((p): p is Project => p != null);
          return { projects, totalCount: paged.total };
        }),
        catchError(() => of({ projects: [], totalCount: 0 }))
      );
  }

  getProjects(filters?: ProjectFilters): Observable<Project[]> {
    return forkJoin({
      clients: this.clientService.getClients().pipe(catchError(() => of([]))),
      manufacturers: this.getManufacturersApi$(),
      locations: this.locationService.getAllLocations().pipe(catchError(() => of([]))),
      raw: this.getProjectsApi$(filters),
    }).pipe(
      map(({ clients, manufacturers, locations, raw }) => {
        const apiProjects = normalizeApiResponse(raw);
        const projects = apiProjects
          .map((api) => mapApiProjectToProject(api, clients, manufacturers, locations))
          .filter((p): p is Project => p != null);
        const effectiveFilters = this.expandManufacturerFilterIds(filters, manufacturers);
        return applyFilters(projects, effectiveFilters);
      })
    );
  }

  /**
   * Expands manufacturerIds so that numeric manufacturer ids also add the manufacturer's name,
   * allowing project filter matching when API projects use manufacturer name rather than id.
   */
  private expandManufacturerFilterIds(
    filters: ProjectFilters | undefined,
    manufacturers: ApiManufacturer[]
  ): ProjectFilters | undefined {
    if (!filters?.manufacturerIds?.length) return filters;
    const expanded = new Set<string>([...filters.manufacturerIds.map((id) => String(id ?? '').trim())]);
    for (const id of filters.manufacturerIds) {
      const idStr = String(id ?? '').trim();
      const manufacturer = manufacturers.find((m) => {
        if (String(m.id ?? '').trim() === idStr) return true;
        const locationIds = this.normalizeLocationIds([...(m.locationIds ?? []), m.locationId ?? null]);
        return locationIds.some((locationId) => String(locationId) === idStr);
      });
      const name = (manufacturer?.manufacturerName ?? '').trim();
      if (name) {
        expanded.add(name);
        expanded.add(String(manufacturer?.id ?? '').trim());
      }
    }
    return { ...filters, manufacturerIds: Array.from(expanded) };
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

  getProjectById(projectId: string | number): Observable<Project | null> {
    const normalizedProjectId = String(projectId ?? '').trim();
    return this.getProjectsWithRefresh({}).pipe(
      map((projects) =>
        projects.find((project) => String(project.id ?? '').trim() === normalizedProjectId) ?? null
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
}
