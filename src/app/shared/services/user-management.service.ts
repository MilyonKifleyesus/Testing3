import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';
import { parsePagedResponse } from './adapters/paged-response.adapter';

export interface UserListQuery {
  page: number;
  pageSize: number;
  search?: string;
  role?: string;
  clientId: string;
  manufacturerId: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface UserListItem {
  id: number;
  userName: string;
  name: string;
  email: string | null;
  role: string;
  clientId: number;
  clientName: string;
  manufacturerId: number;
  manufacturerName: string;
  deleted: boolean;
  picture: string | null;
  lastUpdate: string | null;
}

export interface UserListResult {
  items: UserListItem[];
  totalCount: number;
}

export interface ManufacturerOption {
  id: string;
  name: string;
}

export interface InspectorStatistics {
  busesInspected: number;
  busesAssigned: number;
  roadTests: number;
  waterTests: number;
  totalSnags: number;
  safetyCriticalSnags: number;
  snagsByArea: string;
  rating: number;
}

interface ApiUser {
  id?: number;
  userName?: string;
  name?: string;
  email?: string | null;
  role?: string;
  clientId?: number;
  clientName?: string;
  manufacturerId?: number;
  manufacturerName?: string;
  deleted?: boolean;
  picture?: string | null;
  lastUpdate?: string | null;
}

interface ApiManufacturer {
  id?: string | number;
  manufacturerId?: string | number;
  name?: string;
  manufacturerName?: string;
}


function mapInspectorStats(raw: unknown): InspectorStatistics {
  const obj = asObject(raw) ?? {};
  return {
    busesInspected: Number(obj['busesInspected'] ?? obj['totalInspected'] ?? obj['inspectedCount'] ?? obj['totalVehiclesInspected'] ?? 0),
    busesAssigned:  Number(obj['busesAssigned']  ?? obj['assignedBuses'] ?? obj['assignedCount']  ?? obj['totalAssigned']         ?? 0),
    roadTests:      Number(obj['roadTests']      ?? obj['road']          ?? obj['roadTestCount']  ?? 0),
    waterTests:     Number(obj['waterTests']     ?? obj['water']         ?? obj['waterTestCount'] ?? 0),
    totalSnags:     Number(obj['totalSnags']     ?? obj['snags']         ?? obj['snagCount']      ?? obj['totalDefects']          ?? 0),
    safetyCriticalSnags: Number(obj['safetyCriticalSnags'] ?? obj['criticalSnags'] ?? obj['safetyCritical'] ?? obj['criticalDefects'] ?? 0),
    snagsByArea: String(obj['snagsByArea'] ?? obj['topSnagAreas'] ?? obj['areaBreakdown'] ?? obj['defectAreas'] ?? ''),
    rating: Number(obj['rating'] ?? obj['averageRating'] ?? obj['performanceRating'] ?? 0),
  };
}


function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
}

function extractCollection(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    if (raw.length === 1) {
      const first = asObject(raw[0]);
      if (first) {
        const wrappedKeys = ['items', 'results', 'data', 'users'];
        for (const key of wrappedKeys) {
          const value = first[key];
          if (Array.isArray(value)) {
            return value;
          }

          const nested = asObject(value);
          if (nested) {
            for (const nestedKey of wrappedKeys) {
              const nestedValue = nested[nestedKey];
              if (Array.isArray(nestedValue)) {
                return nestedValue;
              }
            }
          }
        }
      }
    }

    return raw;
  }

  const obj = asObject(raw);
  if (!obj) {
    return [];
  }

  const wrappedKeys = ['items', 'results', 'data', 'users'];
  for (const key of wrappedKeys) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}



function toNonEmptyString(value: unknown, fallback = ''): string {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function toIdString(value: unknown, fallback = '0'): string {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function mapApiUserToUser(item: ApiUser): UserListItem {
  return {
    id: Number(item.id ?? 0),
    userName: toNonEmptyString(item.userName, 'N/A'),
    name: toNonEmptyString(item.name, 'N/A'),
    email: item.email ?? null,
    role: toNonEmptyString(item.role, 'N/A'),
    clientId: Number(item.clientId ?? 0),
    clientName: toNonEmptyString(item.clientName, ''),
    manufacturerId: Number(item.manufacturerId ?? 0),
    manufacturerName: toNonEmptyString(item.manufacturerName, ''),
    deleted: item.deleted ?? false,
    picture: item.picture ?? null,
    lastUpdate: item.lastUpdate ?? null,
  };
}

function mapApiManufacturer(item: ApiManufacturer): ManufacturerOption {
  const id = toIdString(item.manufacturerId ?? item.id, '0');
  const name = toNonEmptyString(item.manufacturerName ?? item.name, '').trim();

  return {
    id,
    name,
  };
}

@Injectable({
  providedIn: 'root',
})
export class UserManagementService {
  private readonly usersApiUrl = `${environment.apiBaseUrl}/Users`;
  private readonly manufacturersApiUrl = `${environment.apiBaseUrl}/Manufacturers`;
  private readonly usersQueryCache = new Map<string, Observable<UserListResult>>();
  private readonly inspectorStatsCache = new Map<number, Observable<InspectorStatistics | null>>();
  private readonly rolesFetchPageSize = 100;

  constructor(private readonly http: HttpClient) {}

  private buildUsersParams(query: UserListQuery): HttpParams {
    let params = new HttpParams()
      .set('page', String(query.page))
      .set('pageSize', String(query.pageSize))
      .set('clientId', String(query.clientId ?? '0'))
      .set('manufacturerId', String(query.manufacturerId ?? '0'))
      .set('SortBy', String(query.sortBy ?? 'id'))
      .set('SortDirection', String(query.sortDirection ?? 'asc'));

    const search = String(query.search ?? '').trim();
    if (search.length > 0) {
      params = params.set('search', search);
    }

    const role = String(query.role ?? '').trim();
    if (role.length > 0 && role.toLowerCase() !== 'all') {
      params = params.set('role', role);
    }

    return params;
  }


  clearUsersCache(): void {
    this.usersQueryCache.clear();
  }

  getUsers(query: UserListQuery): Observable<UserListResult> {
    const cacheKey = JSON.stringify({
      page: query.page,
      pageSize: query.pageSize,
      search: String(query.search ?? '').trim().toLowerCase(),
      role: String(query.role ?? '').trim().toLowerCase(),
      clientId: String(query.clientId ?? '').trim(),
      manufacturerId: String(query.manufacturerId ?? '').trim(),
      sortBy: String(query.sortBy ?? 'id').trim().toLowerCase(),
      sortDirection: String(query.sortDirection ?? 'asc').trim().toLowerCase(),
    });

    const existing = this.usersQueryCache.get(cacheKey);
    if (existing) return existing;

    const params = this.buildUsersParams(query);
    const request$ = this.http.get<unknown>(this.usersApiUrl, { params, observe: 'response' }).pipe(
      map((response) => {
        const body = response.body;
        const paged = parsePagedResponse<ApiUser>(body);
        const items = paged.items.map((item) => mapApiUserToUser(item));
        // The API returns the real total user count in the 'pageSize' field of the response body.
        const totalCount = paged.pageSize ?? items.length;
        return { items, totalCount } as UserListResult;
      }),
      catchError(() => of({ items: [], totalCount: 0 } as UserListResult)),
      shareReplay(1),
    );

    this.usersQueryCache.set(cacheKey, request$);
    return request$;
  }

  getInspectorStatistics(inspectorId: number): Observable<InspectorStatistics | null> {
    const cached = this.inspectorStatsCache.get(inspectorId);
    if (cached) return cached;
    const obs$ = this.http.get<unknown>(`${environment.apiBaseUrl}/inspector/${inspectorId}/statistics`).pipe(
      map((raw) => mapInspectorStats(raw)),
      catchError(() => of(null)),
      shareReplay(1),
    );
    this.inspectorStatsCache.set(inspectorId, obs$);
    return obs$;
  }

  getUserById(userId: number): Observable<UserListItem | null> {
    return this.http.get<unknown>(`${this.usersApiUrl}/${userId}`).pipe(
      map((raw) => {
        if (Array.isArray(raw)) {
          const first = raw[0] as ApiUser | undefined;
          return first ? mapApiUserToUser(first) : null;
        }

        const obj = asObject(raw);
        if (!obj) {
          return null;
        }

        const wrapped = extractCollection(raw);
        if (wrapped.length > 0) {
          return mapApiUserToUser(wrapped[0] as ApiUser);
        }

        return mapApiUserToUser(obj as ApiUser);
      }),
      catchError(() => of(null)),
    );
  }

  getManufacturers(locationId = 0): Observable<ManufacturerOption[]> {
    const params = new HttpParams({ fromObject: { locationId: String(locationId) } });
    return this.http.get<unknown>(this.manufacturersApiUrl, { params }).pipe(
      map((raw) => extractCollection(raw).map((item) => mapApiManufacturer(item as ApiManufacturer))),
      map((items) => items.filter((item) => item.id !== '0' && item.name.length > 0)),
    );
  }

  getRoles(): Observable<string[]> {
    return this.getUsers({
      page: 1,
      pageSize: this.rolesFetchPageSize,
      role: '',
      clientId: '0',
      manufacturerId: '0',
    }).pipe(
      map((result) => [...new Set(result.items.map((user) => user.role).filter((role) => role.length > 0))].sort()),
      catchError(() => of(['Admin', 'Client User', 'Inspector', 'Manager', 'Viewer'])),
    );
  }
}