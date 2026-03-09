import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { parsePagedResponse } from './adapters/paged-response.adapter';

export interface DashboardProjectOption {
  id: string;
  name: string;
  status?: string;
  isClosed?: boolean;
}

export interface DashboardVehicleOption {
  id: string;
  name: string;
}

export interface DashboardVehicleOptionsResult {
  options: DashboardVehicleOption[];
  totalCount: number;
}

export interface DashboardTicketsDashboardResult {
  totalTickets?: number;
  repeatedTickets?: number;
  safetyCriticalTickets?: number;
  repeatedPercent?: number;
  safetyCriticalPercent?: number;
  [key: string]: unknown;
}

@Injectable({ providedIn: 'root' })
export class DashboardProjectsService {
  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly useApiV2 = environment.useApiV2 !== false;
  private readonly PROJECTS_ROUTE = 'Projects';
  private readonly PROJECTS_VEHICLES_ROUTE = 'projects';
  private readonly cacheTtlMs = 30000;
  private readonly projectsCache = new Map<
    string,
    { expiresAt: number; observable: Observable<DashboardProjectOption[]> }
  >();
  private readonly allVehiclesCache = new Map<
    string,
    { expiresAt: number; observable: Observable<DashboardVehicleOptionsResult> }
  >();
  private readonly projectVehiclesCache = new Map<
    string,
    { expiresAt: number; observable: Observable<DashboardVehicleOptionsResult> }
  >();

  constructor(private http: HttpClient) {}

  private mapVehicleItem = (item: any): DashboardVehicleOption => {
    const idCandidate = item?.id ?? item?.vehicleId ?? item?.vehicleID ?? item?.VehicleId ?? item?.VehicleID ?? '';
    return {
      id: String(idCandidate ?? ''),
      name:
        item?.name ??
        item?.vehicleName ??
        item?.VehicleName ??
        item?.displayName ??
        `Vehicle ${item?.id ?? item?.vehicleId ?? ''}`,
    };
  };

  getProjectOptions(params: {
    clientId?: number;
    projectTypeId?: number;
    locationId?: number;
    includeClosed?: boolean;
    page?: number;
    pageSize?: number;
    includeAllOption?: boolean;
  } = {}): Observable<DashboardProjectOption[]> {
    const {
      includeAllOption = true,
      clientId,
      projectTypeId,
      locationId,
      includeClosed,
      page,
      pageSize,
    } = params;

    let httpParams = new HttpParams();
    if (clientId !== undefined && clientId !== null) {
      httpParams = httpParams.set('clientId', String(clientId));
    }
    if (projectTypeId !== undefined && projectTypeId !== null) {
      httpParams = httpParams.set('projectTypeId', String(projectTypeId));
    }
    if (locationId !== undefined && locationId !== null) {
      httpParams = httpParams.set('locationId', String(locationId));
    }
    if (includeClosed !== undefined && includeClosed !== null) {
      httpParams = httpParams.set('includeClosed', String(includeClosed));
    }
    if (page !== undefined && page !== null) {
      httpParams = httpParams.set('page', String(page));
    }
    if (pageSize !== undefined && pageSize !== null) {
      httpParams = httpParams.set('pageSize', String(pageSize));
    }

    const cacheKey = JSON.stringify({
      includeAllOption,
      clientId: clientId ?? null,
      projectTypeId: projectTypeId ?? null,
      locationId: locationId ?? null,
      includeClosed: includeClosed ?? null,
      page: page ?? null,
      pageSize: pageSize ?? null,
    });

    return this.getCachedObservable(this.projectsCache, cacheKey, () =>
      this.http
        .get<unknown>(`${this.apiBaseUrl}/${this.PROJECTS_ROUTE}`, { params: httpParams })
        .pipe(
          map((response: any) => {
            const parsed = parsePagedResponse<any>(response);
            const items = parsed.items;

            const mapped: DashboardProjectOption[] = items
              .map((item: any) => ({
                id: String(item?.id ?? item?.projectId ?? item?.projectID ?? item?.ProjectId ?? item?.ProjectID ?? ''),
                name:
                  item?.name ??
                  item?.projectName ??
                  item?.ProjectName ??
                  item?.title ??
                  `Project ${item?.id ?? item?.projectId ?? ''}`,
                status: String(
                  item?.status ??
                  item?.Status ??
                  item?.projectStatus ??
                  item?.ProjectStatus ??
                  item?.state ??
                  item?.State ??
                  '',
                ).trim() || undefined,
                isClosed: this.inferProjectClosedState(item),
              }))
              .filter((project: DashboardProjectOption) => project.id);

            if (!includeAllOption) {
              return mapped;
            }

            return [{ id: 'all', name: 'All Projects' }, ...mapped];
          }),
        ),
    );
  }

  getVehicleOptionsByProject(
    projectId: string,
    params: {
      clientId?: number;
      userId?: number;
      page?: number;
      pageSize?: number;
      includeAllOption?: boolean;
    } = {},
  ): Observable<DashboardVehicleOption[]> {
    const {
      includeAllOption = true,
      clientId,
      userId,
      page,
      pageSize,
    } = params;

    return this.getVehicleOptionsByProjectResult(projectId, params).pipe(
      map((result: DashboardVehicleOptionsResult) => {
        const options = result.options;
        return options.length ? options : (includeAllOption ? [{ id: 'all', name: 'All Vehicles' }] : []);
      }),
    );
  }

  getVehicleOptionsByProjectResult(
    projectId: string,
    params: {
      clientId?: number;
      userId?: number;
      page?: number;
      pageSize?: number;
      includeAllOption?: boolean;
    } = {},
  ): Observable<DashboardVehicleOptionsResult> {
    const {
      includeAllOption = true,
      clientId,
      userId,
      page,
      pageSize,
    } = params;

    if (!projectId || projectId === 'all') {
      return this.getAllVehicleOptionsResult({
        includeAllOption,
        clientId,
        userId,
        page,
        pageSize,
      });
    }

    const normalizedProjectId = this.normalizeProjectId(projectId);
    if (!normalizedProjectId) {
      return of({
        options: includeAllOption ? [{ id: 'all', name: 'All Vehicles' }] : [],
        totalCount: 0,
      });
    }

    let httpParams = new HttpParams();
    if (clientId !== undefined && clientId !== null) {
      httpParams = httpParams.set('clientId', String(clientId));
    }
    if (userId !== undefined && userId !== null) {
      httpParams = httpParams.set('userId', String(userId));
    }
    if (page !== undefined && page !== null) {
      httpParams = httpParams.set('page', String(page));
    }
    if (pageSize !== undefined && pageSize !== null) {
      httpParams = httpParams.set('pageSize', String(pageSize));
    }

    const encodedProjectId = encodeURIComponent(normalizedProjectId);
    const cacheKey = JSON.stringify({
      includeAllOption,
      normalizedProjectId,
      clientId: clientId ?? null,
      userId: userId ?? null,
      page: page ?? null,
      pageSize: pageSize ?? null,
    });

    return this.getCachedObservable(this.projectVehiclesCache, cacheKey, () =>
      (this.useApiV2
        ? this.http.get<unknown>(`${this.apiBaseUrl}/${this.PROJECTS_VEHICLES_ROUTE}/${encodedProjectId}/vehicles`, {
            params: httpParams,
          })
        : this.http
            .get<unknown>(`${this.apiBaseUrl}/${this.PROJECTS_VEHICLES_ROUTE}/${encodedProjectId}/vehicles`, {
              params: httpParams,
            })
            .pipe(
              catchError(() =>
                this.http.get<unknown>(`${this.apiBaseUrl}/Vehicles`, {
                  params: httpParams.set('projectId', String(normalizedProjectId)),
                })
              ),
              catchError(() =>
                this.http.get<unknown>(`${this.apiBaseUrl}/Vehicles`, {
                  params: httpParams.set('ProjectId', String(normalizedProjectId)),
                })
              )
            )).pipe(
          map((response: any) => {
            const parsed = parsePagedResponse<any>(response);
            const items = parsed.items;

            const mapped: DashboardVehicleOption[] = items
              .map(this.mapVehicleItem)
              .filter((vehicle: DashboardVehicleOption) => vehicle.id);

            const totalCount = parsed.total ?? mapped.length;

            return {
              options: includeAllOption ? [{ id: 'all', name: 'All Vehicles' }, ...mapped] : mapped,
              totalCount,
            };
          }),
        ),
    );
  }

  getAllVehicleOptions(params: {
    clientId?: number;
    userId?: number;
    page?: number;
    pageSize?: number;
    includeAllOption?: boolean;
  } = {}): Observable<DashboardVehicleOption[]> {
    const {
      includeAllOption = true,
      clientId,
      userId,
      page,
      pageSize,
    } = params;

    let httpParams = new HttpParams();
    if (clientId !== undefined && clientId !== null) {
      httpParams = httpParams.set('clientId', String(clientId));
    }
    if (userId !== undefined && userId !== null) {
      httpParams = httpParams.set('userId', String(userId));
    }
    if (page !== undefined && page !== null) {
      httpParams = httpParams.set('page', String(page));
    }
    if (pageSize !== undefined && pageSize !== null) {
      httpParams = httpParams.set('pageSize', String(pageSize));
    }

    return this.http
      .get<unknown>(`${this.apiBaseUrl}/Vehicles`, { params: httpParams })
      .pipe(
        map((response: any) => {
          const items = parsePagedResponse<any>(response).items;

          const mapped: DashboardVehicleOption[] = items
            .map(this.mapVehicleItem)
            .filter((vehicle: DashboardVehicleOption) => vehicle.id);

          if (!includeAllOption) {
            return mapped;
          }

          return [{ id: 'all', name: 'All Vehicles' }, ...mapped];
        }),
      );
  }

  getAllVehicleOptionsResult(params: {
    clientId?: number;
    userId?: number;
    page?: number;
    pageSize?: number;
    includeAllOption?: boolean;
  } = {}): Observable<DashboardVehicleOptionsResult> {
    const {
      includeAllOption = true,
      clientId,
      userId,
      page,
      pageSize,
    } = params;

    let httpParams = new HttpParams();
    if (clientId !== undefined && clientId !== null) {
      httpParams = httpParams.set('clientId', String(clientId));
    }
    if (userId !== undefined && userId !== null) {
      httpParams = httpParams.set('userId', String(userId));
    }
    if (page !== undefined && page !== null) {
      httpParams = httpParams.set('page', String(page));
    }
    if (pageSize !== undefined && pageSize !== null) {
      httpParams = httpParams.set('pageSize', String(pageSize));
    }

    const cacheKey = JSON.stringify({
      includeAllOption,
      clientId: clientId ?? null,
      userId: userId ?? null,
      page: page ?? null,
      pageSize: pageSize ?? null,
    });

    return this.getCachedObservable(this.allVehiclesCache, cacheKey, () =>
      this.http
        .get<unknown>(`${this.apiBaseUrl}/Vehicles`, { params: httpParams })
        .pipe(
          map((response: any) => {
            const parsed = parsePagedResponse<any>(response);
            const items = parsed.items;
            const mapped: DashboardVehicleOption[] = items
              .map(this.mapVehicleItem)
              .filter((vehicle: DashboardVehicleOption) => vehicle.id);

            const totalCount = parsed.total ?? mapped.length;

            return {
              options: includeAllOption ? [{ id: 'all', name: 'All Vehicles' }, ...mapped] : mapped,
              totalCount,
            };
          }),
        ),
    );
  }

  getTicketsDashboard(params: {
    projectId?: number | string;
    vehicleId?: number | string;
    userId?: number;
  } = {}): Observable<DashboardTicketsDashboardResult> {
    const httpParams = this.buildHttpParams(params);
    return this.http.get<DashboardTicketsDashboardResult>(`${this.apiBaseUrl}/tickets/dashboard`, {
      params: httpParams,
    });
  }

  private getCachedObservable<T>(
    cache: Map<string, { expiresAt: number; observable: Observable<T> }>,
    key: string,
    factory: () => Observable<T>,
  ): Observable<T> {
    this.evictExpiredEntries(cache);

    const cached = cache.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.observable;
    }

    const observable = factory().pipe(shareReplay({ bufferSize: 1, refCount: false }));
    cache.set(key, { expiresAt: now + this.cacheTtlMs, observable });

    return observable;
  }

  private buildHttpParams(
    params: Record<string, string | number | boolean | null | undefined>,
  ): HttpParams {
    let httpParams = new HttpParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        httpParams = httpParams.set(key, String(value));
      }
    });
    return httpParams;
  }

  private evictExpiredEntries<T>(
    cache: Map<string, { expiresAt: number; observable: Observable<T> }>,
  ): void {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
      if (value.expiresAt <= now) {
        cache.delete(key);
      }
    }
  }

  private normalizeProjectId(projectId: string): string {
    const trimmed = String(projectId ?? '').trim();
    if (!trimmed || trimmed === 'all') {
      return '';
    }

    const numericMatch = trimmed.match(/\d+/);
    if (numericMatch && trimmed.toLowerCase().startsWith('proj')) {
      return numericMatch[0];
    }

    return trimmed;
  }

  private inferProjectClosedState(item: any): boolean | undefined {
    const explicit = item?.isClosed ?? item?.IsClosed ?? item?.closed ?? item?.Closed;
    if (explicit !== undefined && explicit !== null && explicit !== '') {
      if (typeof explicit === 'boolean') {
        return explicit;
      }

      const explicitText = String(explicit).trim().toLowerCase();
      if (explicitText === 'true' || explicitText === '1') {
        return true;
      }
      if (explicitText === 'false' || explicitText === '0') {
        return false;
      }
    }

    const statusText = String(
      item?.status ??
      item?.Status ??
      item?.projectStatus ??
      item?.ProjectStatus ??
      item?.state ??
      item?.State ??
      '',
    )
      .trim()
      .toLowerCase();

    if (!statusText) {
      return undefined;
    }

    if (/(closed|complete|completed|inactive|archived|cancelled|canceled)/.test(statusText)) {
      return true;
    }

    if (/(open|active|in\s*progress|ongoing|running|planned|new)/.test(statusText)) {
      return false;
    }

    return undefined;
  }


}
