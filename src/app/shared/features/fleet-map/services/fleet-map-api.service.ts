import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, timeout } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { fetchAllPages } from '../../../services/adapters/pagination-fetch.util';
import { parsePagedResponse } from '../../../services/adapters/paged-response.adapter';
import type {
  ApiClient,
  ApiLocation,
  ApiManufacturer,
  ApiProject,
  ApiProjectType,
} from '../models/fleet-map.models';
import { hasUsableCoordinates } from '../utils/fleet-map-geo';

type RawRecord = Record<string, unknown>;

type RawClient = {
  id?: number | string | null;
  clientId?: number | string | null;
  name?: string | null;
  clientName?: string | null;
  customerName?: string | null;
  clientLogo?: string | null;
  customerLogo?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  locationId?: number | string | null;
  locationIds?: Array<number | string | null> | null;
  locations?: unknown;
};

type RawManufacturer = {
  id?: number | string | null;
  manufacturerName?: string | null;
  name?: string | null;
  manufacturerLogo?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  locationId?: number | string | null;
  locationIds?: Array<number | string | null> | null;
  locations?: unknown;
};

type RawLocation = {
  id?: number | string | null;
  locationId?: number | string | null;
  manufacturerId?: number | string | null;
  name?: string | null;
  locationName?: string | null;
  type?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  uniqueId?: string | null;
  lastUpdate?: string | null;
};

type RawProject = {
  id?: number | string | null;
  project_id?: number | string | null;
  name?: string | null;
  projectName?: string | null;
  project_name?: string | null;
  clientId?: number | string | null;
  client?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  projectTypeName?: string | null;
  projectType?: string | null;
  assessmentType?: string | null;
  assessment_type?: string | null;
  projectTypeId?: number | string | null;
  locationId?: number | string | null;
  manufacturerLocationId?: number | string | null;
  factory_id?: number | string | null;
  locationIds?: Array<number | string | null> | null;
  locations?: unknown;
  status?: string | null;
  closed?: boolean | null;
  description?: string | null;
  lastUpdate?: string | null;
};

type NormalizedGeoLocation = {
  id: string;
  lat: number;
  lng: number;
};

function asRecord(value: unknown): RawRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseId(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value).trim() || null;
}

function parseText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function looksLikeRawBase64(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');
  return (
    normalized.length >= 64 &&
    normalized.length % 4 === 0 &&
    !/[/:]/.test(normalized) &&
    /^[A-Za-z0-9+/]+=*$/.test(normalized)
  );
}

function normalizeLogoUrl(value: unknown): string | undefined {
  const raw = parseText(value);
  if (!raw) return undefined;

  if (/^data:image\//i.test(raw) || /^blob:/i.test(raw)) {
    return raw;
  }

  if (/^\/\//.test(raw)) {
    return `https:${raw}`;
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (/^\//.test(raw)) {
    return new URL(raw, String(environment.apiBaseUrl ?? 'http://localhost')).toString();
  }

  if (
    String((environment as { logoPayloadMode?: string }).logoPayloadMode ?? '').trim() === 'autoRetryRawBase64' &&
    looksLikeRawBase64(raw)
  ) {
    return `data:image/png;base64,${raw.replace(/\s+/g, '')}`;
  }

  return raw;
}

function normalizeEntityLocations(raw: unknown): NormalizedGeoLocation[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;

      const id = parseId(record['id']);
      const lat = parseNullableNumber(record['latitude'] ?? record['lat']);
      const lng = parseNullableNumber(record['longitude'] ?? record['lng']);
      if (!id || !hasUsableCoordinates(lat, lng)) return null;

      return { id, lat, lng };
    })
    .filter((item): item is NormalizedGeoLocation => item !== null);
}

function normalizeEntityLocationIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const ids = new Set<string>();
  raw.forEach((item) => {
    const record = asRecord(item);
    if (!record) return;
    const id = parseId(record['id'] ?? record['locationId']);
    if (id) ids.add(id);
  });

  return Array.from(ids);
}

function pickPrimaryCoordinates(
  locations: NormalizedGeoLocation[],
  fallbackLat?: unknown,
  fallbackLng?: unknown,
): { lat: number | null; lng: number | null } {
  if (locations.length > 0) {
    return { lat: locations[0].lat, lng: locations[0].lng };
  }

  const lat = parseNullableNumber(fallbackLat);
  const lng = parseNullableNumber(fallbackLng);
  if (!hasUsableCoordinates(lat, lng)) {
    return { lat: null, lng: null };
  }

  return { lat, lng };
}

function normalizeLocationIds(
  explicitIds: Array<number | string | null> | null | undefined,
  locations: NormalizedGeoLocation[],
  fallbackId?: unknown,
  nestedIds?: string[],
): string[] {
  const ids = new Set<string>();

  if (Array.isArray(explicitIds)) {
    explicitIds.forEach((value) => {
      const id = parseId(value);
      if (id) ids.add(id);
    });
  }

  locations.forEach((location) => ids.add(location.id));
  nestedIds?.forEach((id) => ids.add(id));

  const fallback = parseId(fallbackId);
  if (fallback) ids.add(fallback);

  return Array.from(ids);
}

function normalizeProjectStatus(project: RawProject): 'active' | 'inactive' {
  if (typeof project.closed === 'boolean') {
    return project.closed ? 'inactive' : 'active';
  }

  const status = String(project.status ?? '').trim().toLowerCase();
  if (status === 'closed' || status === 'inactive' || status === 'delayed') {
    return 'inactive';
  }

  return 'active';
}

function mapClient(raw: RawClient): ApiClient | null {
  const id = parseId(raw.clientId ?? raw.id);
  if (!id) return null;

  const name = parseText(raw.clientName ?? raw.customerName ?? raw.name) ?? id;
  const locations = normalizeEntityLocations(raw.locations);
  const nestedLocationIds = normalizeEntityLocationIds(raw.locations);
  const { lat, lng } = pickPrimaryCoordinates(locations, raw.latitude ?? raw.lat, raw.longitude ?? raw.lng);

  return {
    id,
    name,
    logoUrl: normalizeLogoUrl(raw.clientLogo ?? raw.customerLogo),
    lat,
    lng,
    locationIds: normalizeLocationIds(raw.locationIds, locations, raw.locationId, nestedLocationIds),
  };
}

function mapManufacturer(raw: RawManufacturer): ApiManufacturer | null {
  const id = parseId(raw.id);
  if (!id) return null;

  const name = parseText(raw.manufacturerName ?? raw.name) ?? id;
  const locations = normalizeEntityLocations(raw.locations);
  const nestedLocationIds = normalizeEntityLocationIds(raw.locations);
  const { lat, lng } = pickPrimaryCoordinates(locations, raw.latitude ?? raw.lat, raw.longitude ?? raw.lng);

  return {
    id,
    name,
    logoUrl: normalizeLogoUrl(raw.manufacturerLogo),
    lat,
    lng,
    locationIds: normalizeLocationIds(raw.locationIds, locations, raw.locationId, nestedLocationIds),
  };
}

function mapLocation(raw: RawLocation): ApiLocation | null {
  const id = parseId(raw.id ?? raw.locationId);
  const lat = parseNullableNumber(raw.latitude ?? raw.lat);
  const lng = parseNullableNumber(raw.longitude ?? raw.lng);
  const name = parseText(raw.name ?? raw.locationName);

  if (!id || name == null) return null;

  return {
    id,
    manufacturerId: parseId(raw.manufacturerId) ?? undefined,
    name,
    lat: hasUsableCoordinates(lat, lng) ? lat : null,
    lng: hasUsableCoordinates(lat, lng) ? lng : null,
    type: parseText(raw.type) ?? undefined,
    uniqueId: parseText(raw.uniqueId) ?? undefined,
    lastUpdate: parseText(raw.lastUpdate) ?? undefined,
  };
}

function mapProject(raw: RawProject): ApiProject | null {
  const id = parseId(raw.project_id ?? raw.id);
  const clientId = parseId(raw.clientId);
  if (!id || !clientId) return null;

  const locations = normalizeEntityLocations(raw.locations);
  const nestedLocationIds = normalizeEntityLocationIds(raw.locations);
  const { lat, lng } = pickPrimaryCoordinates(locations, raw.latitude ?? raw.lat, raw.longitude ?? raw.lng);
  const locationIds = normalizeLocationIds(
    raw.locationIds,
    locations,
    raw.locationId ?? raw.manufacturerLocationId ?? raw.factory_id,
    nestedLocationIds,
  );

  return {
    id,
    name: parseText(raw.name ?? raw.projectName ?? raw.project_name) ?? id,
    clientId,
    lat,
    lng,
    locationId: locationIds[0] ?? null,
    locationIds,
    type:
      parseText(raw.projectTypeName ?? raw.projectType ?? raw.assessmentType ?? raw.assessment_type) ??
      'Unspecified',
    typeId: parseId(raw.projectTypeId),
    status: normalizeProjectStatus(raw),
    description: parseText(raw.description) ?? undefined,
    lastUpdate: parseText(raw.lastUpdate) ?? undefined,
  };
}

@Injectable({
  providedIn: 'root',
})
export class FleetMapApiService {
  private readonly apiBaseUrl: string;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly useApiV2: boolean;

  constructor(private readonly http: HttpClient) {
    const configuredApiBaseUrl = String(environment.apiBaseUrl ?? '').trim();
    if (!configuredApiBaseUrl) {
      throw new Error('Missing required environment.apiBaseUrl');
    }

    this.apiBaseUrl = configuredApiBaseUrl.replace(/\/+$/, '');
    this.pageSize = Math.max(1, Number(environment.apiPagedFetchPageSize ?? 500));
    this.maxPages = Math.max(1, Number(environment.apiPagedFetchMaxPages ?? 200));
    this.useApiV2 = environment.useApiV2 !== false;
  }

  deriveProjectTypes(projects: ApiProject[]): ApiProjectType[] {
    const byName = new Map<string, ApiProjectType>();

    projects.forEach((project) => {
      const name = project.type.trim();
      if (!name) return;

      const key = name.toLowerCase();
      if (byName.has(key)) return;

      byName.set(key, {
        id: project.typeId ?? key,
        name,
      });
    });

    return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  fetchClients(): Observable<ApiClient[]> {
    const params = new HttpParams().set('locationId', '0');
    return this.http.get<unknown>(`${this.apiBaseUrl}/Clients`, { params }).pipe(
      timeout(30_000),
      map((raw) => parsePagedResponse<RawClient>(raw).items.map(mapClient).filter((item): item is ApiClient => item !== null)),
    );
  }

  fetchManufacturers(): Observable<ApiManufacturer[]> {
    const params = new HttpParams().set('locationId', '0');
    return this.http.get<unknown>(`${this.apiBaseUrl}/Manufacturers`, { params }).pipe(
      timeout(30_000),
      map((raw) => parsePagedResponse<RawManufacturer>(raw).items.map(mapManufacturer).filter((item): item is ApiManufacturer => item !== null)),
    );
  }

  fetchLocations(): Observable<ApiLocation[]> {
    return this.http.get<unknown>(`${this.apiBaseUrl}/Locations`).pipe(
      timeout(30_000),
      map((raw) => parsePagedResponse<RawLocation>(raw).items.map(mapLocation).filter((item): item is ApiLocation => item !== null)),
    );
  }

  fetchProjects(): Observable<ApiProject[]> {
    return this.fetchAllPages<RawProject>('Projects', new HttpParams().set('includeClosed', 'true')).pipe(
      map((rows) => rows.map(mapProject).filter((item): item is ApiProject => item !== null)),
    );
  }

  private fetchAllPages<T>(path: string, extraParams?: HttpParams): Observable<T[]> {
    const url = `${this.apiBaseUrl}/${path.replace(/^\/+/, '')}`;

    if (!this.useApiV2) {
      return this.http.get<unknown>(url).pipe(
        timeout(30_000),
        map((raw) => parsePagedResponse<T>(raw).items),
      );
    }

    return fetchAllPages<T>(
      (page, pageSize) => {
        let params = new HttpParams()
          .set('page', String(page))
          .set('pageSize', String(pageSize));
        extraParams?.keys().forEach((key) => {
          const value = extraParams.get(key);
          if (value != null) {
            params = params.set(key, value);
          }
        });
        return this.http.get<unknown>(url, { params }).pipe(timeout(30_000));
      },
      {
        pageSize: this.pageSize,
        maxPages: this.maxPages,
        startPage: 1,
      },
    ).pipe(map((result) => result.items));
  }
}
