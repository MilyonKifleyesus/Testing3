import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, firstValueFrom, from, map, of, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface UserListQuery {
  page: number;
  pageSize: number;
  role: string;
  clientId: string;
  manufacturerId: string;
}

export interface UserListItem {
  id: number;
  name: string;
  username: string;
  email: string;
  role: string;
  clientId: string;
  client: string;
  manufacturerId: string;
  manufacturer: string;
  isActive?: boolean;
  updatedAt?: string;
  status?: string;
  createdDate?: string;
}

export interface UserListResult {
  items: UserListItem[];
  totalCount: number;
}

export interface ManufacturerOption {
  id: string;
  name: string;
}

interface ApiUser {
  id?: number;
  userId?: number;
  name?: string;
  fullName?: string;
  username?: string;
  userName?: string;
  email?: string;
  emailAddress?: string;
  role?: string;
  roleName?: string;
  clientId?: string | number;
  ClientId?: string | number;
  clientID?: string | number;
  clientName?: string;
  ClientName?: string;
  client?: string;
  manufacturerId?: string | number;
  ManufacturerId?: string | number;
  manufacturerID?: string | number;
  manufacturerName?: string;
  ManufacturerName?: string;
  manufacturer?: string;
  status?: string;
  createdDate?: string;
  isActive?: boolean;
  updatedAt?: string;
  firstName?: string;
  lastName?: string;
}

interface ApiManufacturer {
  id?: string | number;
  manufacturerId?: string | number;
  name?: string;
  manufacturerName?: string;
}

interface ApiUsersListResponse {
  items?: ApiUser[];
  total?: number;
  page?: number;
  pageSize?: number;
}

interface UsersPageResult {
  page: number;
  items: UserListItem[];
  totalCount: number;
  pageSize: number;
  hasExplicitTotal: boolean;
}

function readTotal(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
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

function toApiUsersListResponse(raw: unknown): ApiUsersListResponse {
  const unwrap = (value: unknown): Record<string, unknown> | null => {
    if (Array.isArray(value) && value.length === 1) {
      return asObject(value[0]);
    }
    return asObject(value);
  };

  const root = unwrap(raw);
  if (!root) {
    return {};
  }

  const directItems = root['items'];
  if (Array.isArray(directItems)) {
    return {
      items: directItems as ApiUser[],
      total: readTotal(root['total']) ?? readTotal(root['Total']),
      page: Number(root['page'] ?? 0),
      pageSize: Number(root['pageSize'] ?? directItems.length),
    };
  }

  const nestedData = asObject(root['data']);
  if (nestedData && Array.isArray(nestedData['items'])) {
    const nestedItems = nestedData['items'] as ApiUser[];
    return {
      items: nestedItems,
      total:
        readTotal(nestedData['total']) ??
        readTotal(nestedData['Total']) ??
        readTotal(root['total']) ??
        readTotal(root['Total']),
      page: Number(nestedData['page'] ?? root['page'] ?? 0),
      pageSize: Number(nestedData['pageSize'] ?? root['pageSize'] ?? nestedItems.length),
    };
  }

  const nestedResult = asObject(root['result']);
  if (nestedResult && Array.isArray(nestedResult['items'])) {
    const nestedItems = nestedResult['items'] as ApiUser[];
    return {
      items: nestedItems,
      total:
        readTotal(nestedResult['total']) ??
        readTotal(nestedResult['Total']) ??
        readTotal(root['total']) ??
        readTotal(root['Total']),
      page: Number(nestedResult['page'] ?? root['page'] ?? 0),
      pageSize: Number(nestedResult['pageSize'] ?? root['pageSize'] ?? nestedItems.length),
    };
  }

  return {
    items: extractCollection(raw) as ApiUser[],
    total: readTotal(root['total']) ?? readTotal(root['Total']),
  };
}

function normalizeTotal(total: unknown, fallbackLength: number): number {
  const parsed = Number(total);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackLength;
}

function readTotalFromHeaders(response: HttpResponse<unknown>): number | undefined {
  const directCandidates = [
    response.headers.get('x-total-count'),
    response.headers.get('X-Total-Count'),
    response.headers.get('total'),
    response.headers.get('Total'),
  ];

  for (const candidate of directCandidates) {
    const parsed = readTotal(candidate);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  const xPaginationRaw = response.headers.get('x-pagination') ?? response.headers.get('X-Pagination');
  if (!xPaginationRaw) {
    return undefined;
  }

  try {
    const parsedJson = JSON.parse(xPaginationRaw) as Record<string, unknown>;
    return (
      readTotal(parsedJson['total']) ??
      readTotal(parsedJson['Total']) ??
      readTotal(parsedJson['totalCount']) ??
      readTotal(parsedJson['TotalCount'])
    );
  } catch {
    return undefined;
  }
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
  const fullName = [item.firstName, item.lastName]
    .map((part) => String(part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ')
    .trim();

  const name =
    toNonEmptyString(item.name) ||
    toNonEmptyString(item.fullName) ||
    fullName ||
    toNonEmptyString(item.userName) ||
    toNonEmptyString(item.username) ||
    'N/A';

  return {
    id: Number(item.id ?? item.userId ?? 0),
    name,
    username: toNonEmptyString(item.userName ?? item.username, 'N/A'),
    email: toNonEmptyString(item.email ?? item.emailAddress, ''),
    role: toNonEmptyString(item.role ?? item.roleName, 'N/A'),
    clientId: toIdString(item.clientId ?? item.ClientId ?? item.clientID, '0'),
    client: toNonEmptyString(item.clientName ?? item.ClientName ?? item.client, ''),
    manufacturerId: toIdString(item.manufacturerId ?? item.ManufacturerId ?? item.manufacturerID, '0'),
    manufacturer: toNonEmptyString(item.manufacturerName ?? item.ManufacturerName ?? item.manufacturer, ''),
    isActive: typeof item.isActive === 'boolean' ? item.isActive : undefined,
    updatedAt: toNonEmptyString(item.updatedAt, ''),
    status: toNonEmptyString(item.status, ''),
    createdDate: toNonEmptyString(item.createdDate, ''),
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

function mapInspectorStats(raw: unknown): InspectorStatistics {
  const obj = asObject(raw) ?? {};
  return {
    busesInspected: Number(obj['busesInspected'] ?? obj['totalInspected'] ?? obj['inspectedCount'] ?? obj['totalVehiclesInspected'] ?? 0),
    busesAssigned: Number(obj['busesAssigned'] ?? obj['assignedBuses'] ?? obj['assignedCount'] ?? obj['totalAssigned'] ?? 0),
    roadTests: Number(obj['roadTests'] ?? obj['road'] ?? obj['roadTestCount'] ?? 0),
    waterTests: Number(obj['waterTests'] ?? obj['water'] ?? obj['waterTestCount'] ?? 0),
    totalSnags: Number(obj['totalSnags'] ?? obj['snags'] ?? obj['snagCount'] ?? obj['totalDefects'] ?? 0),
    safetyCriticalSnags: Number(obj['safetyCriticalSnags'] ?? obj['criticalSnags'] ?? obj['safetyCritical'] ?? obj['criticalDefects'] ?? 0),
    snagsByArea: String(obj['snagsByArea'] ?? obj['topSnagAreas'] ?? obj['areaBreakdown'] ?? obj['defectAreas'] ?? ''),
    rating: Number(obj['rating'] ?? obj['averageRating'] ?? obj['performanceRating'] ?? 0),
  };
}

@Injectable({
  providedIn: 'root',
})
export class UserManagementService {
  private readonly usersApiUrl = `${environment.apiBaseUrl}/Users`;
  private readonly manufacturersApiUrl = `${environment.apiBaseUrl}/Manufacturers`;
  private readonly usersQueryCache = new Map<string, Observable<UserListResult>>();
  private readonly parallelPageConcurrency = 12;
  private readonly defaultFetchPageSize = 200;
  private readonly maxFetchPageSize = 500;
  private readonly rolesFetchPageSize = 100;

  constructor(private readonly http: HttpClient) {}

  private resolveFetchPageSize(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return this.defaultFetchPageSize;
    }

    return Math.min(this.maxFetchPageSize, Math.floor(parsed));
  }

  private buildUsersParams(query: UserListQuery, page?: number, pageSize?: number): HttpParams {
    let params = new HttpParams();

    if (typeof page === 'number' && Number.isFinite(page) && page > 0) {
      params = params.set('page', String(page));
    }

    const resolvedPageSize = this.resolveFetchPageSize(pageSize ?? query.pageSize);
    if (resolvedPageSize > 0) {
      params = params.set('pageSize', String(resolvedPageSize));
    }

    const role = String(query.role ?? '').trim();
    if (role.length > 0 && role.toLowerCase() !== 'all') {
      params = params.set('role', role);
    }

    const clientId = String(query.clientId ?? '').trim();
    const normalizedClientId = Number(clientId);
    const shouldSendClientId =
      clientId.length > 0 &&
      clientId.toLowerCase() !== 'all' &&
      !(Number.isFinite(normalizedClientId) && normalizedClientId <= 0);
    if (shouldSendClientId) {
      params = params.set('clientId', clientId);
    }

    const manufacturerId = String(query.manufacturerId ?? '').trim();
    const normalizedManufacturerId = Number(manufacturerId);
    const shouldSendManufacturerId =
      manufacturerId.length > 0 &&
      manufacturerId.toLowerCase() !== 'all' &&
      !(Number.isFinite(normalizedManufacturerId) && normalizedManufacturerId <= 0);
    if (shouldSendManufacturerId) {
      params = params.set('manufacturerId', manufacturerId);
    }

    return params;
  }

  private fetchUsersPage(query: UserListQuery, page: number, pageSize?: number): Observable<UsersPageResult> {
    const params = this.buildUsersParams(query, page, pageSize);
    return this.http.get<unknown>(this.usersApiUrl, { params, observe: 'response' }).pipe(
      map((httpResponse) => {
        const response = toApiUsersListResponse(httpResponse.body);
        const rows = (response.items ?? []).map((item) => mapApiUserToUser(item));
        const headerTotal = readTotalFromHeaders(httpResponse);
        const explicitTotal = readTotal(response.total) ?? headerTotal;
        const totalCount = normalizeTotal(explicitTotal, rows.length);
        const pageSize = Number(response.pageSize ?? rows.length);

        return {
          page,
          items: rows,
          totalCount,
          pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : Math.max(rows.length, 1),
          hasExplicitTotal: explicitTotal !== undefined,
        };
      }),
    );
  }

  private async fetchAllUsersPages(query: UserListQuery): Promise<UserListResult> {
    const maxPages = 500;
    const fetchPageSize = this.resolveFetchPageSize(query.pageSize || this.defaultFetchPageSize);
    const usersById = new Map<number, UserListItem>();
    const firstPageResult = await firstValueFrom(this.fetchUsersPage(query, 1, fetchPageSize));

    const mergePage = (pageResult: UsersPageResult): number => {
      const before = usersById.size;
      pageResult.items.forEach((user) => usersById.set(user.id, user));
      return usersById.size - before;
    };

    let totalHint = firstPageResult.totalCount;
    let hasExplicitTotal = firstPageResult.hasExplicitTotal;
    mergePage(firstPageResult);

    const effectivePageSize = Math.max(
      1,
      firstPageResult.pageSize || firstPageResult.items.length || fetchPageSize || this.defaultFetchPageSize,
    );
    let totalPagesFromMeta = totalHint > 0 ? Math.ceil(totalHint / effectivePageSize) : 1;
    totalPagesFromMeta = Math.min(maxPages, Math.max(1, totalPagesFromMeta));

    if (totalPagesFromMeta > 1) {
      for (let startPage = 2; startPage <= totalPagesFromMeta; startPage += this.parallelPageConcurrency) {
        const endPage = Math.min(totalPagesFromMeta, startPage + this.parallelPageConcurrency - 1);
        const pages: number[] = [];
        for (let page = startPage; page <= endPage; page++) {
          pages.push(page);
        }

        const batchResults = await Promise.all(
          pages.map((page) =>
            firstValueFrom(
              this.fetchUsersPage(query, page, fetchPageSize).pipe(
                catchError(() =>
                  of({
                    page,
                    items: [],
                    totalCount: totalHint,
                    pageSize: effectivePageSize,
                    hasExplicitTotal: false,
                  }),
                ),
              ),
            ),
          ),
        );

        batchResults.forEach((result) => {
          totalHint = Math.max(totalHint, result.totalCount);
          hasExplicitTotal = hasExplicitTotal || result.hasExplicitTotal;
          mergePage(result);
        });
      }
    }

    let probePage = totalPagesFromMeta + 1;
    let noGrowthCount = 0;
    while (probePage <= maxPages) {
      const pageResult = await firstValueFrom(
        this.fetchUsersPage(query, probePage, fetchPageSize).pipe(
          catchError(() =>
            of({
              page: probePage,
              items: [],
              totalCount: totalHint,
              pageSize: effectivePageSize,
              hasExplicitTotal: false,
            }),
          ),
        ),
      );

      totalHint = Math.max(totalHint, pageResult.totalCount);
      hasExplicitTotal = hasExplicitTotal || pageResult.hasExplicitTotal;
      const added = mergePage(pageResult);
      if (added === 0) {
        noGrowthCount += 1;
      } else {
        noGrowthCount = 0;
      }

      if (pageResult.items.length === 0 || pageResult.items.length < effectivePageSize || noGrowthCount >= 2) {
        break;
      }

      probePage += 1;
    }

    const mergedUsers = Array.from(usersById.values());
    return {
      items: mergedUsers,
      totalCount: totalHint > 0 ? Math.max(totalHint, mergedUsers.length) : mergedUsers.length,
    };
  }

  getUsers(query: UserListQuery): Observable<UserListResult> {
    const cacheKey = JSON.stringify({
      role: String(query.role ?? '').trim().toLowerCase(),
      clientId: String(query.clientId ?? '').trim(),
      manufacturerId: String(query.manufacturerId ?? '').trim(),
      pageSize: this.resolveFetchPageSize(query.pageSize),
    });

    const existing = this.usersQueryCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const request$ = from(this.fetchAllUsersPages(query)).pipe(shareReplay(1));
    this.usersQueryCache.set(cacheKey, request$);
    return request$;
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

  getInspectorStatistics(inspectorId: number): Observable<InspectorStatistics | null> {
    return this.http.get<unknown>(`${environment.apiBaseUrl}/inspector/${inspectorId}/statistics`).pipe(
      map((raw) => mapInspectorStats(raw)),
      catchError(() => of(null)),
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