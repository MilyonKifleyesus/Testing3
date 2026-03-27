import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  EMPTY,
  Observable,
  catchError,
  concat,
  forkJoin,
  firstValueFrom,
  from,
  map,
  of,
  shareReplay,
  switchMap,
  take,
  throwError,
  timeout,
} from 'rxjs';
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
  organization?: string;
  clientId: string | number;
  client?: string;
  clientName?: string;
  manufacturerId: string | number;
  manufacturer?: string;
  manufacturerName?: string;
  isActive?: boolean;
  deleted?: boolean;
  updatedAt?: string;
  lastUpdate?: string | null;
  status?: string;
  createdDate?: string;
  phone?: string;
  address?: string;
  language?: string;
  firstName?: string;
  lastName?: string;
  picture?: string | null;
  username?: string;
}

export interface UserListResult {
  items: UserListItem[];
  totalCount: number;
}

export interface ManufacturerOption {
  id: string;
  name: string;
}

export interface SaveUserRequest {
  name: string;
  username: string;
  email: string;
  role: string;
  organization?: string | null;
  status?: string;
  clientId?: string | number | null;
  manufacturerId?: string | number | null;
  phone?: string | null;
  address?: string | null;
  language?: string | null;
  picture?: string | null;
  password?: string | null;
  confirmPassword?: string | null;
}

export interface ChangeUserPasswordRequest {
  password: string;
  confirmPassword?: string;
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
  organization?: string;
  organisation?: string;
  organizationName?: string;
  organisationName?: string;
  company?: string;
  companyName?: string;
  clientId?: number;
  clientName?: string;
  manufacturerId?: number;
  manufacturerName?: string;
  ManufacturerName?: string;
  manufacturer?: string;
  status?: string;
  createdDate?: string;
  isActive?: boolean;
  deleted?: boolean;
  updatedAt?: string;
  lastUpdate?: string | null;
  firstName?: string;
  lastName?: string;
  phone?: string;
  phoneNumber?: string;
  mobile?: string;
  mobileNumber?: string;
  contactNumber?: string;
  address?: string;
  streetAddress?: string;
  language?: string;
  languageName?: string;
  preferredLanguage?: string;
  locale?: string;
  picture?: string | null;
  pictureUrl?: string;
  avatar?: string;
  avatarUrl?: string;
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

function toNullableIdString(value: unknown): string | null {
  const next = String(value ?? '').trim();
  return next && next !== '0' ? next : null;
}

function normalizeUserStatus(status: unknown, isActive?: boolean): string {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();
  if (normalizedStatus) {
    return normalizedStatus;
  }

  if (typeof isActive === 'boolean') {
    return isActive ? 'active' : 'inactive';
  }

  return 'active';
}

function mapApiUserToUser(item: ApiUser): UserListItem {
  const resolvedName = toNonEmptyString(item.name, 'N/A');
  return {
    id: Number(item.id ?? (item as any).userId ?? 0),
    name: resolvedName,
    userName: toNonEmptyString(item.userName ?? (item as any).username, 'N/A'),
    username: toNonEmptyString(item.userName ?? (item as any).username, 'N/A'),
    email: item.email ?? toNonEmptyString((item as any).emailAddress, '') ?? null,
    role: toNonEmptyString(item.role ?? (item as any).roleName, 'N/A'),
    organization: toNonEmptyString(
      item.organization ??
      item.organisation ??
      item.organizationName ??
      item.organisationName ??
      item.companyName ??
      item.company,
      '',
    ),
    clientId: toIdString(item.clientId ?? (item as any).ClientId ?? (item as any).clientID, '0'),
    client: toNonEmptyString(item.clientName ?? (item as any).ClientName ?? (item as any).client, ''),
    clientName: toNonEmptyString(item.clientName ?? (item as any).ClientName ?? (item as any).client, ''),
    manufacturerId: toIdString(item.manufacturerId ?? (item as any).ManufacturerId ?? (item as any).manufacturerID, '0'),
    manufacturer: toNonEmptyString(item.manufacturerName ?? item.ManufacturerName ?? item.manufacturer, ''),
    manufacturerName: toNonEmptyString(item.manufacturerName ?? item.ManufacturerName ?? item.manufacturer, ''),
    isActive: typeof item.isActive === 'boolean' ? item.isActive : undefined,
    deleted: item.deleted ?? false,
    updatedAt: toNonEmptyString(item.updatedAt, ''),
    lastUpdate: item.lastUpdate ?? null,
    status: normalizeUserStatus(item.status, item.isActive),
    createdDate: toNonEmptyString(item.createdDate, ''),
    phone: toNonEmptyString(
      item.phone ?? item.phoneNumber ?? item.mobile ?? item.mobileNumber ?? item.contactNumber,
      '',
    ),
    address: toNonEmptyString(item.address ?? item.streetAddress, ''),
    language: toNonEmptyString(item.language ?? item.languageName ?? item.preferredLanguage ?? item.locale, ''),
    firstName: toNonEmptyString(item.firstName, ''),
    lastName: toNonEmptyString(item.lastName, ''),
    picture: item.picture ?? toNonEmptyString(item.pictureUrl ?? item.avatar ?? item.avatarUrl, '') ?? null,
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
  private readonly defaultFetchPageSize = 500;
  private readonly requestTimeoutMs = 10_000;

  constructor(private readonly http: HttpClient) {}

  private buildUsersParams(query: UserListQuery): HttpParams {
    let params = new HttpParams()
      .set('page', String(query.page))
      .set('pageSize', String(query.pageSize))
      .set('clientId', String(query.clientId || '0'))
      .set('manufacturerId', String(query.manufacturerId || '0'))
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
      map((raw) => this.parseSingleUserResponse(raw)),
      catchError(() => of(null)),
    );
  }

  getUsersByIds(userIds: number[]): Observable<UserListItem[]> {
    const ids = Array.from(
      new Set(
        (userIds ?? [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    );

    if (!ids.length) {
      return of([]);
    }

    return this.fetchUsersByIdsQuery(ids, 'ids').pipe(
      catchError(() => this.fetchUsersByIdsQuery(ids, 'userIds')),
      map((raw) => {
        const items = extractCollection(raw).map((item) => mapApiUserToUser(item as ApiUser));
        const usersById = new Map(items.map((item) => [item.id, item]));
        return ids.map((id) => usersById.get(id)).filter((item): item is UserListItem => !!item);
      }),
      catchError(() =>
        forkJoin(
          ids.map((id) =>
            this.getUserById(id).pipe(
              catchError(() => of(null)),
            ),
          ),
        ).pipe(
          map((items) => items.filter((item): item is UserListItem => !!item)),
        ),
      ),
    );
  }

  createUser(body: SaveUserRequest): Observable<UserListItem> {
    return this.http.post<unknown>(this.usersApiUrl, this.buildSaveUserPayload(body)).pipe(
      timeout(this.requestTimeoutMs),
      switchMap((raw) => {
        const mapped = this.parseSingleUserResponse(raw);
        if (mapped) {
          return of(mapped);
        }

        const createdId = this.extractUserId(raw);
        if (createdId && createdId > 0) {
          return this.getUserById(createdId).pipe(
            map((createdUser) => {
              if (!createdUser) {
                throw new Error(`User ${createdId} not found after create.`);
              }
              return createdUser;
            }),
          );
        }

        return this.getUsers({
          page: 1,
          pageSize: this.defaultFetchPageSize,
          role: body.role,
          clientId: toNullableIdString(body.clientId) ?? '0',
          manufacturerId: toNullableIdString(body.manufacturerId) ?? '0',
        }).pipe(
          map((result) => {
            const expectedEmail = String(body.email ?? '').trim().toLowerCase();
            const expectedUsername = String(body.username ?? '').trim().toLowerCase();
            const matchedUser = result.items.find((user) =>
              (user.email ?? '').trim().toLowerCase() === expectedEmail ||
              (user.username ?? '').trim().toLowerCase() === expectedUsername,
            );

            if (!matchedUser) {
              throw new Error('User create succeeded but response could not be mapped.');
            }

            return matchedUser;
          }),
        );
      }),
      map((user) => {
        this.clearUsersCache();
        return user;
      }),
      catchError((error) => {
        console.error('Failed to create user:', error);
        return throwError(() => error);
      }),
    );
  }

  updateUser(userId: number, body: SaveUserRequest): Observable<UserListItem> {
    return this.http.put<unknown>(`${this.usersApiUrl}/${userId}`, this.buildSaveUserPayload(body)).pipe(
      timeout(this.requestTimeoutMs),
      switchMap((raw) => {
        const mapped = this.parseSingleUserResponse(raw);
        if (mapped) {
          return of(mapped);
        }

        return this.getUserById(userId).pipe(
          map((updatedUser) => {
            if (!updatedUser) {
              throw new Error(`User ${userId} not found after update.`);
            }
            return updatedUser;
          }),
        );
      }),
      map((user) => {
        this.clearUsersCache();
        return user;
      }),
      catchError((error) => {
        console.error(`Failed to update user id=${userId}:`, error);
        return throwError(() => error);
      }),
    );
  }

  changeUserPassword(userId: number, body: ChangeUserPasswordRequest): Observable<void> {
    const payload = {
      password: body.password,
      newPassword: body.password,
      confirmPassword: body.confirmPassword ?? body.password,
    };

    const attempts = [
      this.http.put<unknown>(`${this.usersApiUrl}/${userId}/password`, payload),
      this.http.post<unknown>(`${this.usersApiUrl}/${userId}/password`, payload),
      this.http.put<unknown>(`${this.usersApiUrl}/${userId}/change-password`, payload),
      this.http.post<unknown>(`${this.usersApiUrl}/${userId}/change-password`, payload),
      this.http.post<unknown>(`${this.usersApiUrl}/change-password`, { userId, ...payload }),
    ];

    return concat(
      ...attempts.map((request$, index) =>
        request$.pipe(
          timeout(this.requestTimeoutMs),
          catchError((error) => {
            if (index === attempts.length - 1) {
              return throwError(() => error);
            }

            return EMPTY;
          }),
        ),
      ),
    ).pipe(
      take(1),
      map(() => {
        this.clearUsersCache();
        return void 0;
      }),
      catchError((error) => {
        console.error(`Failed to change password for user id=${userId}:`, error);
        return throwError(() => error);
      }),
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

  private fetchUsersByIdsQuery(ids: number[], paramKey: 'ids' | 'userIds'): Observable<unknown> {
    const params = new HttpParams().set(paramKey, ids.join(','));
    return this.http.get<unknown>(this.usersApiUrl, { params });
  }

  private parseSingleUserResponse(raw: unknown): UserListItem | null {
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

    const nestedItem =
      asObject(obj['item']) ??
      asObject(obj['user']) ??
      asObject(obj['data']) ??
      asObject(obj['result']);

    if (nestedItem) {
      const nestedCollection = extractCollection(nestedItem);
      if (nestedCollection.length > 0) {
        return mapApiUserToUser(nestedCollection[0] as ApiUser);
      }

      return mapApiUserToUser(nestedItem as ApiUser);
    }

    return mapApiUserToUser(obj as ApiUser);
  }

  private extractUserId(raw: unknown): number | null {
    const record = asObject(raw);
    if (!record) {
      return null;
    }

    const candidate =
      record['id'] ??
      record['userId'] ??
      asObject(record['item'])?.['id'] ??
      asObject(record['item'])?.['userId'] ??
      asObject(record['user'])?.['id'] ??
      asObject(record['user'])?.['userId'];

    const parsed = Number(candidate);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private buildSaveUserPayload(body: SaveUserRequest): Record<string, unknown> {
    const organization = String(body.organization ?? '').trim() || null;
    const payload: Record<string, unknown> = {
      name: String(body.name ?? '').trim(),
      username: String(body.username ?? '').trim(),
      userName: String(body.username ?? '').trim(),
      email: String(body.email ?? '').trim(),
      emailAddress: String(body.email ?? '').trim(),
      role: String(body.role ?? '').trim(),
      organization,
      organisation: organization,
      organizationName: organization,
      companyName: organization,
      status: normalizeUserStatus(body.status),
      phone: String(body.phone ?? '').trim() || null,
      address: String(body.address ?? '').trim() || null,
      language: String(body.language ?? '').trim() || null,
      picture: String(body.picture ?? '').trim() || null,
      pictureUrl: String(body.picture ?? '').trim() || null,
      clientId: toNullableIdString(body.clientId),
      manufacturerId: toNullableIdString(body.manufacturerId),
    };

    const password = String(body.password ?? '').trim();
    if (password) {
      payload['password'] = password;
      payload['confirmPassword'] = String(body.confirmPassword ?? body.password ?? '').trim() || password;
    }

    return payload;
  }
}
