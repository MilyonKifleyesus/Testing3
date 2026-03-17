import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, shareReplay, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { extractArrayFromApiResponse, getFirstDefinedValue, toOptionalText, toText } from '../utils/api-data.utils';

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

export interface DashboardVehicleMakeModelDatum {
  label: string;
  count: number;
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
  private readonly stationTrackersCache = new Map<
    string,
    { expiresAt: number; observable: Observable<any[]> }
  >();

  constructor(private http: HttpClient) {}

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
        .get<unknown>(`${this.apiBaseUrl}/Projects`, { params: httpParams })
        .pipe(
          map((response: any) => {
            const items = this.extractItems(response);

            const mapped: DashboardProjectOption[] = items
              .map((item: any) => ({
                id: String(
                  item?.id ??
                  item?.projectId ??
                  item?.projectID ??
                  item?.ProjectId ??
                  item?.ProjectID ??
                  item?.project_id ??
                  item?.Project_Id ??
                  '',
                ),
                name:
                  item?.name ??
                  item?.projectName ??
                  item?.ProjectName ??
                  item?.project_name ??
                  item?.Project_Name ??
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
      includeClosed?: boolean;
      page?: number;
      pageSize?: number;
      includeAllOption?: boolean;
    } = {},
  ): Observable<DashboardVehicleOption[]> {
    const {
      includeAllOption = true,
      clientId,
      userId,
      includeClosed,
      page,
      pageSize,
    } = params;

    return this.getVehicleOptionsByProjectResult(projectId, params).pipe(
      map((result: DashboardVehicleOptionsResult) => result.options),
      switchMap((vehicles) => of(vehicles.length ? vehicles : [{ id: 'all', name: 'All Vehicles' }])),
    );
  }

  getVehicleOptionsByProjectResult(
    projectId: string,
    params: {
      clientId?: number;
      userId?: number;
      includeClosed?: boolean;
      page?: number;
      pageSize?: number;
      includeAllOption?: boolean;
    } = {},
  ): Observable<DashboardVehicleOptionsResult> {
    const {
      includeAllOption = true,
      clientId,
      userId,
      includeClosed,
      page,
      pageSize,
    } = params;

    if (!projectId || projectId === 'all') {
      return this.getAllVehicleOptionsResult({
        includeAllOption,
        clientId,
        userId,
        includeClosed,
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
    if (includeClosed !== undefined && includeClosed !== null) {
      httpParams = httpParams.set('includeClosed', String(includeClosed));
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
      includeClosed: includeClosed ?? null,
      page: page ?? null,
      pageSize: pageSize ?? null,
    });

    return this.getCachedObservable(this.projectVehiclesCache, cacheKey, () =>
      this.http
        .get<unknown>(`${this.apiBaseUrl}/projects/${encodedProjectId}/vehicles`)
        .pipe(
          catchError(() =>
            this.http.get<unknown>(`${this.apiBaseUrl}/Projects/${encodedProjectId}/vehicles`, {
              params: httpParams,
            }),
          ),
          catchError(() =>
            this.http.get<unknown>(`${this.apiBaseUrl}/Vehicles`, {
              params: httpParams.set('projectId', String(normalizedProjectId)),
            }),
          ),
          catchError(() =>
            this.http.get<unknown>(`${this.apiBaseUrl}/Vehicles`, {
              params: httpParams.set('ProjectId', String(normalizedProjectId)),
            }),
          ),
          map((response: any) => {
            const items = this.extractItems(response);

            const mapped: DashboardVehicleOption[] = items
              .map((item: any) => ({
                id: String(
                  item?.id ??
                  item?.vehicleId ??
                  item?.vehicleID ??
                  item?.VehicleId ??
                  item?.VehicleID ??
                  item?.vehicle_id ??
                  item?.Vehicle_Id ??
                  '',
                ),
                name:
                  item?.name ??
                  item?.vehicleName ??
                  item?.VehicleName ??
                  item?.fleetNumber ??
                  item?.fleet_number ??
                  item?.displayName ??
                  `Vehicle ${item?.id ?? item?.vehicleId ?? ''}`,
              }))
              .filter((vehicle: DashboardVehicleOption) => vehicle.id);

            const totalCount = this.extractTotalCount(response, mapped.length);

            return {
              options: includeAllOption ? [{ id: 'all', name: 'All Vehicles' }, ...mapped] : mapped,
              totalCount,
            };
          }),
        ),
    );
  }

  getVehicleOptionsByProjectsResult(
    projectIds: string[],
    params: {
      clientId?: number;
      userId?: number;
      includeClosed?: boolean;
      page?: number;
      pageSize?: number;
      includeAllOption?: boolean;
    } = {},
  ): Observable<DashboardVehicleOptionsResult> {
    const {
      includeAllOption = true,
      clientId,
      userId,
      includeClosed,
      page,
      pageSize,
    } = params;

    const normalizedProjectIds = Array.from(new Set(
      (projectIds ?? [])
        .map((projectId) => this.normalizeProjectId(projectId))
        .filter((projectId) => !!projectId),
    ));

    if (!normalizedProjectIds.length) {
      return of({
        options: includeAllOption ? [{ id: 'all', name: 'All Vehicles' }] : [],
        totalCount: 0,
      });
    }

    return forkJoin(
      normalizedProjectIds.map((projectId) =>
        this.getVehicleOptionsByProjectResult(projectId, {
          clientId,
          userId,
          includeClosed,
          page,
          pageSize,
          includeAllOption: false,
        }),
      ),
    ).pipe(
      map((results) => {
        const uniqueVehicles = new Map<string, DashboardVehicleOption>();
        let aggregateTotalCount = 0;

        results.forEach((result) => {
          const resultTotal = Number(result.totalCount ?? 0);
          aggregateTotalCount += Number.isFinite(resultTotal) && resultTotal > 0
            ? resultTotal
            : (result.options ?? []).filter((vehicle) => String(vehicle.id ?? '').trim().toLowerCase() !== 'all').length;

          (result.options ?? []).forEach((vehicle) => {
            const vehicleId = String(vehicle.id ?? '').trim();
            if (!vehicleId || vehicleId === 'all') return;

            if (!uniqueVehicles.has(vehicleId)) {
              uniqueVehicles.set(vehicleId, {
                id: vehicleId,
                name: String(vehicle.name ?? '').trim() || `Vehicle ${vehicleId}`,
              });
            }
          });
        });

        const mergedOptions = Array.from(uniqueVehicles.values())
          .sort((left, right) => left.name.localeCompare(right.name));

        return {
          options: includeAllOption ? [{ id: 'all', name: 'All Vehicles' }, ...mergedOptions] : mergedOptions,
          totalCount: aggregateTotalCount,
        };
      }),
    );
  }

  getVehiclesByMakeModelData(params: {
    projectIds?: string[];
    clientId?: number;
    userId?: number;
    includeClosed?: boolean;
    page?: number;
    pageSize?: number;
    maxItems?: number;
  } = {}): Observable<DashboardVehicleMakeModelDatum[]> {
    return this.getVehiclesDistributionData(
      params,
      (vehicle) => this.resolveVehicleMakeLabel(vehicle),
      'All Makes & Models',
    );
  }

  getVehiclesByPropulsionTypeData(params: {
    projectIds?: string[];
    clientId?: number;
    userId?: number;
    includeClosed?: boolean;
    page?: number;
    pageSize?: number;
    maxItems?: number;
  } = {}): Observable<DashboardVehicleMakeModelDatum[]> {
    return this.getVehiclesDistributionData(
      params,
      (vehicle) => this.resolveVehiclePropulsionLabel(vehicle),
      'All Propulsion Types',
    );
  }

  getAllVehiclesForProjects(params: {
    projectIds?: string[];
    clientId?: number;
    includeClosed?: boolean;
  } = {}): Observable<any[]> {
    const { projectIds, clientId, includeClosed } = params;
    const normalizedProjectIds = Array.from(new Set(
      (projectIds ?? [])
        .map((id) => this.normalizeProjectId(id))
        .filter((id) => !!id),
    ));

    if (normalizedProjectIds.length >= 1) {
      return forkJoin(
        normalizedProjectIds.map((projectId) => {
          const encodedId = encodeURIComponent(projectId);
          return this.http
            .get<unknown>(`${this.apiBaseUrl}/projects/${encodedId}/vehicles`)
            .pipe(
              map((response) => extractArrayFromApiResponse(response)),
              catchError(() => of([] as any[])),
            );
        }),
      ).pipe(
        map((arrays) => arrays.flat()),
        catchError(() => of([] as any[])),
      );
    }

    let httpParams = new HttpParams().set('pageSize', '10000');
    if (clientId !== undefined && clientId !== null) {
      httpParams = httpParams.set('clientId', String(clientId));
    }
    if (includeClosed !== undefined && includeClosed !== null) {
      httpParams = httpParams.set('includeClosed', String(includeClosed));
    }
    return this.http.get<unknown>(`${this.apiBaseUrl}/Vehicles`, { params: httpParams }).pipe(
      map((response) => extractArrayFromApiResponse(response)),
      catchError(() => of([] as any[])),
    );
  }

  private getVehiclesDistributionData(
    params: {
      projectIds?: string[];
      clientId?: number;
      userId?: number;
      includeClosed?: boolean;
      page?: number;
      pageSize?: number;
      maxItems?: number;
    },
    resolveLabel: (vehicle: unknown) => string | null,
    aggregateLabel: string,
  ): Observable<DashboardVehicleMakeModelDatum[]> {
    const {
      projectIds,
      clientId,
      userId,
      includeClosed,
      page,
      pageSize,
      maxItems = 7,
    } = params;

    const normalizedProjectIds = Array.from(new Set(
      (projectIds ?? [])
        .map((projectId) => this.normalizeProjectId(projectId))
        .filter((projectId) => !!projectId),
    ));

    const projectIds$ = normalizedProjectIds.length
      ? of(normalizedProjectIds)
      : this.getProjectOptions({
        clientId,
        includeClosed,
        page: 1,
        pageSize: 10000,
        includeAllOption: false,
      }).pipe(
        map((projects) => Array.from(new Set(
          (projects ?? [])
            .map((project) => this.normalizeProjectId(project.id))
            .filter((projectId) => !!projectId),
        ))),
      );

    const flatVehicles$ = (): Observable<any[]> => {
      let httpParams = new HttpParams().set('pageSize', '10000');
      if (clientId !== undefined && clientId !== null) httpParams = httpParams.set('clientId', String(clientId));
      if (userId !== undefined && userId !== null) httpParams = httpParams.set('userId', String(userId));
      if (includeClosed !== undefined && includeClosed !== null) httpParams = httpParams.set('includeClosed', String(includeClosed));
      return this.http.get<unknown>(`${this.apiBaseUrl}/Vehicles`, { params: httpParams }).pipe(
        map((response) => this.extractItems(response)),
        catchError(() => of([] as any[])),
      );
    };

    return projectIds$.pipe(
      switchMap((resolvedProjectIds) => {
        if (!resolvedProjectIds.length) {
          return flatVehicles$().pipe(
            map((vehicles) => ({ resolvedProjectIds, vehicles })),
          );
        }

        return forkJoin(
          resolvedProjectIds.map((projectId) =>
            this.getProjectVehiclesRaw(projectId, {
              clientId,
              userId,
              includeClosed,
              page,
              pageSize,
            }),
          ),
        ).pipe(
          map((responses) => responses.flat()),
          switchMap((vehicles) => {
            if (vehicles.length > 0) {
              return of({ resolvedProjectIds, vehicles });
            }
            // Per-project calls returned nothing — fall back to flat /Vehicles endpoint
            return flatVehicles$().pipe(
              map((v) => ({ resolvedProjectIds, vehicles: v })),
            );
          }),
          catchError(() => flatVehicles$().pipe(map((vehicles) => ({ resolvedProjectIds, vehicles })))),
        );
      }),
      map(({ resolvedProjectIds, vehicles }) => {
        const filteredVehicles = this.filterVehiclesByProjectIds(vehicles, resolvedProjectIds);
        const seenVehicleKeys = new Set<string>();
        const countsByLabel = new Map<string, number>();

        filteredVehicles.forEach((vehicle) => {
          const vehicleIdentity = toOptionalText(getFirstDefinedValue(vehicle, [
            'id',
            'vehicleId',
            'vehicleID',
            'VehicleId',
            'VehicleID',
            'vehicle_id',
            'Vehicle_Id',
            'vin',
            'VIN',
            'vehicleVin',
            'fleetNumber',
            'fleet_number',
            'fleetNo',
            'vehicleNumber',
          ]));

          if (vehicleIdentity) {
            const dedupeKey = vehicleIdentity.toLowerCase();
            if (seenVehicleKeys.has(dedupeKey)) {
              return;
            }
            seenVehicleKeys.add(dedupeKey);
          }

          const label = resolveLabel(vehicle);
          if (!label) {
            return;
          }

          countsByLabel.set(label, (countsByLabel.get(label) ?? 0) + 1);
        });

        const sortedBuckets = Array.from(countsByLabel.entries())
          .map(([label, count]) => ({ label, count }))
          .sort((left, right) => {
            if (right.count !== left.count) {
              return right.count - left.count;
            }
            return left.label.localeCompare(right.label);
          });

        const normalizedMaxItems = Math.max(1, Math.floor(Number(maxItems) || 1));
        if (sortedBuckets.length <= normalizedMaxItems) {
          return sortedBuckets;
        }

        if (normalizedMaxItems === 1) {
          const total = sortedBuckets.reduce((sum, item) => sum + item.count, 0);
          return [{ label: aggregateLabel, count: total }];
        }

        const visibleItems = sortedBuckets.slice(0, normalizedMaxItems - 1);
        const othersCount = sortedBuckets
          .slice(normalizedMaxItems - 1)
          .reduce((sum, item) => sum + item.count, 0);

        return [
          ...visibleItems,
          { label: 'Others', count: othersCount },
        ];
      }),
    );
  }

  getAllVehicleOptions(params: {
    clientId?: number;
    userId?: number;
    includeClosed?: boolean;
    page?: number;
    pageSize?: number;
    includeAllOption?: boolean;
  } = {}): Observable<DashboardVehicleOption[]> {
    const {
      includeAllOption = true,
      clientId,
      userId,
      includeClosed,
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
    if (includeClosed !== undefined && includeClosed !== null) {
      httpParams = httpParams.set('includeClosed', String(includeClosed));
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
          const items = this.extractItems(response);

          const mapped: DashboardVehicleOption[] = items
            .map((item: any) => ({
              id: String(
                item?.id ??
                item?.vehicleId ??
                item?.vehicleID ??
                item?.VehicleId ??
                item?.VehicleID ??
                item?.vehicle_id ??
                item?.Vehicle_Id ??
                '',
              ),
              name:
                item?.name ??
                item?.vehicleName ??
                item?.VehicleName ??
                item?.fleetNumber ??
                item?.fleet_number ??
                item?.displayName ??
                `Vehicle ${item?.id ?? item?.vehicleId ?? ''}`,
            }))
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
    includeClosed?: boolean;
    page?: number;
    pageSize?: number;
    includeAllOption?: boolean;
  } = {}): Observable<DashboardVehicleOptionsResult> {
    const {
      includeAllOption = true,
      clientId,
      userId,
      includeClosed,
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
      userId: userId ?? null,
      includeClosed: includeClosed ?? null,
      page: page ?? null,
      pageSize: pageSize ?? null,
    });

    return this.getCachedObservable(this.allVehiclesCache, cacheKey, () =>
      this.http
        .get<unknown>(`${this.apiBaseUrl}/Vehicles`, { params: httpParams })
        .pipe(
          map((response: any) => {
            const items = this.extractItems(response);
            const mapped: DashboardVehicleOption[] = items
              .map((item: any) => ({
                id: String(
                  item?.id ??
                  item?.vehicleId ??
                  item?.vehicleID ??
                  item?.VehicleId ??
                  item?.VehicleID ??
                  item?.vehicle_id ??
                  item?.Vehicle_Id ??
                  '',
                ),
                name:
                  item?.name ??
                  item?.vehicleName ??
                  item?.VehicleName ??
                  item?.fleetNumber ??
                  item?.fleet_number ??
                  item?.displayName ??
                  `Vehicle ${item?.id ?? item?.vehicleId ?? ''}`,
              }))
              .filter((vehicle: DashboardVehicleOption) => vehicle.id);

            const totalCount = this.extractTotalCount(response, mapped.length);

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
    clientId?: number | string;
    includeClosed?: boolean;
  } = {}): Observable<DashboardTicketsDashboardResult> {
    // Normalize incoming ids so API receives numeric IDs when possible
    const normalizedParams: Record<string, string | number | boolean | null | undefined> = { ...params };

    if (normalizedParams['projectId'] !== undefined && normalizedParams['projectId'] !== null) {
      const asString = String(normalizedParams['projectId'] ?? '').trim();
      const normalizedProject = this.normalizeProjectId(asString);
      if (normalizedProject) {
        normalizedParams['projectId'] = normalizedProject;
      } else {
        const parsed = Number(asString);
        normalizedParams['projectId'] = Number.isFinite(parsed) ? parsed : asString;
      }
    }

    if (normalizedParams['vehicleId'] !== undefined && normalizedParams['vehicleId'] !== null) {
      const asString = String(normalizedParams['vehicleId'] ?? '').trim();
      // Only convert to a numeric vehicleId when the entire string is numeric.
      // Avoid extracting digit groups from alphanumeric external IDs
      // (e.g. "SR3054-2607") because that causes incorrect API queries.
      const parsed = Number(asString);
      normalizedParams['vehicleId'] = Number.isFinite(parsed) ? parsed : asString;
    }

    const httpParams = this.buildHttpParams(normalizedParams);
    return this.http.get<DashboardTicketsDashboardResult>(`${this.apiBaseUrl}/tickets/dashboard`, {
      params: httpParams,
    });
  }

  /**
   * Fetch station tracker entries for vehicles. Returns an array of items.
   * Supports filtering by projectId and vehicleId.
   */
  getStationTrackers(params: {
    projectId?: string | number;
    vehicleId?: string | number;
    orderBy?: string;
    orderDirection?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  } = {}): Observable<any[]> {
    // Do not enforce a client-side cap here; respect whatever `pageSize`
    // the caller provides. If `pageSize` is omitted we won't include it
    // in the HTTP params so the backend can decide the default behaviour
    // (including returning all matching records if supported).
    const pageSizeProvided = params.pageSize !== undefined && params.pageSize !== null;

    const cacheKey = JSON.stringify({
      projectId: params.projectId ?? null,
      vehicleId: params.vehicleId ?? null,
      orderBy: params.orderBy ?? null,
      orderDirection: params.orderDirection ?? null,
      page: params.page ?? null,
      pageSize: pageSizeProvided ? params.pageSize : null,
    });

    let httpParams = new HttpParams();
    if (params.projectId !== undefined && params.projectId !== null) httpParams = httpParams.set('projectId', String(params.projectId));
    if (params.vehicleId !== undefined && params.vehicleId !== null) httpParams = httpParams.set('vehicleId', String(params.vehicleId));
    if (params.orderBy) httpParams = httpParams.set('orderBy', params.orderBy);
    if (params.orderDirection) httpParams = httpParams.set('orderDirection', params.orderDirection);
    if (params.page !== undefined && params.page !== null) httpParams = httpParams.set('page', String(params.page));
    if (pageSizeProvided) httpParams = httpParams.set('pageSize', String(params.pageSize));

    return this.getCachedObservable(this.stationTrackersCache, cacheKey, () =>
      this.http.get<unknown>(`${this.apiBaseUrl}/StationTrackers`, { params: httpParams }).pipe(
        catchError(() => this.http.get<unknown>(`${this.apiBaseUrl}/stationtrackers`, { params: httpParams }).pipe(catchError(() => of([])))),
        map((response: any) => this.extractItems(response)),
        catchError(() => of([])),
      ),
    );
  }

  clearProjectsCache(): void {
    this.projectsCache.clear();
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

  private extractItems(response: any): any[] {
    if (Array.isArray(response)) {
      return response;
    }

    if (Array.isArray(response?.items)) {
      return response.items;
    }

    if (Array.isArray(response?.data?.items)) {
      return response.data.items;
    }

    if (Array.isArray(response?.data)) {
      return response.data;
    }

    if (Array.isArray(response?.data?.projects)) {
      return response.data.projects;
    }

    if (Array.isArray(response?.results)) {
      return response.results;
    }

    if (Array.isArray(response?.data?.results)) {
      return response.data.results;
    }

    if (Array.isArray(response?.vehicles)) {
      return response.vehicles;
    }

    if (Array.isArray(response?.data?.vehicles)) {
      return response.data.vehicles;
    }

    if (Array.isArray(response?.result)) {
      return response.result;
    }

    if (Array.isArray(response?.result?.items)) {
      return response.result.items;
    }

    if (Array.isArray(response?.result?.vehicles)) {
      return response.result.vehicles;
    }

    if (Array.isArray(response?.result?.data)) {
      return response.result.data;
    }

    if (Array.isArray(response?.result?.results)) {
      return response.result.results;
    }

    if (Array.isArray(response?.projects)) {
      return response.projects;
    }

    if (response && typeof response === 'object') {
      const hasVehicleIdentity =
        response?.vehicleId !== undefined ||
        response?.VehicleId !== undefined ||
        response?.id !== undefined ||
        response?.make !== undefined ||
        response?.manufacturer !== undefined;

      if (hasVehicleIdentity) {
        return [response];
      }
    }

    if (response?.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
      const hasVehicleIdentity =
        response.data?.vehicleId !== undefined ||
        response.data?.VehicleId !== undefined ||
        response.data?.id !== undefined ||
        response.data?.make !== undefined ||
        response.data?.manufacturer !== undefined;

      if (hasVehicleIdentity) {
        return [response.data];
      }
    }

    return [];
  }

  private getProjectVehiclesRaw(
    projectId: string,
    params: {
      clientId?: number;
      userId?: number;
      includeClosed?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ): Observable<any[]> {
    const normalizedProjectId = this.normalizeProjectId(projectId);
    if (!normalizedProjectId) {
      return of([]);
    }

    const { clientId, userId, includeClosed, page, pageSize } = params;
    let httpParams = new HttpParams();

    if (clientId !== undefined && clientId !== null) {
      httpParams = httpParams.set('clientId', String(clientId));
    }
    if (userId !== undefined && userId !== null) {
      httpParams = httpParams.set('userId', String(userId));
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

    const encodedProjectId = encodeURIComponent(normalizedProjectId);

    return this.http
      .get<unknown>(`${this.apiBaseUrl}/projects/${encodedProjectId}/vehicles`, {
        params: httpParams,
      })
      .pipe(
        catchError(() =>
          this.http.get<unknown>(`${this.apiBaseUrl}/projects/${encodedProjectId}/Vehicles`, {
            params: httpParams,
          }),
        ),
        catchError(() =>
          this.http.get<unknown>(`${this.apiBaseUrl}/Projects/${encodedProjectId}/vehicles`, {
            params: httpParams,
          }),
        ),
        catchError(() =>
          this.http.get<unknown>(`${this.apiBaseUrl}/Projects/${encodedProjectId}/Vehicles`, {
            params: httpParams,
          }),
        ),
        catchError(() =>
          this.http.get<unknown>(`${this.apiBaseUrl}/Vehicles`, {
            params: httpParams.set('projectId', String(normalizedProjectId)),
          }),
        ),
        catchError(() =>
          this.http.get<unknown>(`${this.apiBaseUrl}/Vehicles`, {
            params: httpParams.set('projectID', String(normalizedProjectId)),
          }),
        ),
        catchError(() =>
          this.http.get<unknown>(`${this.apiBaseUrl}/Vehicles`, {
            params: httpParams.set('ProjectID', String(normalizedProjectId)),
          }),
        ),
        catchError(() =>
          this.http.get<unknown>(`${this.apiBaseUrl}/Vehicles`, {
            params: httpParams.set('project_id', String(normalizedProjectId)),
          }),
        ),
        catchError(() =>
          this.http.get<unknown>(`${this.apiBaseUrl}/Vehicles`, {
            params: httpParams.set('ProjectId', String(normalizedProjectId)),
          }),
        ),
        map((response: unknown): any[] => this.extractItems(response)),
        catchError(() => of([] as any[])),
      ) as Observable<any[]>;
  }

  private resolveVehicleMakeLabel(vehicle: unknown): string | null {
    const make = toOptionalText(getFirstDefinedValue(vehicle, [
      'make',
      'Make',
      'manufacturer',
      'brand',
      'makeName',
      'manufacturerName',
      'vehicle.make',
      'vehicle.Make',
      'data.make',
      'data.Make',
    ]));

    const normalizedMake = toText(make, '').trim();
    return normalizedMake || null;
  }

  private resolveVehiclePropulsionLabel(vehicle: unknown): string | null {
    const propulsion = toOptionalText(getFirstDefinedValue(vehicle, [
      'propulsionTypeName',
      'PropulsionTypeName',
      'propulsionType',
      'PropulsionType',
      'propulsion',
      'fuelType',
      'engineType',
      'data.propulsionTypeName',
      'vehicle.propulsionTypeName',
    ]));

    const normalizedPropulsion = toText(propulsion, '').trim();
    return normalizedPropulsion || null;
  }

  private filterVehiclesByProjectIds(vehicles: any[], projectIds: string[]): any[] {
    const normalizedProjectIds = Array.from(new Set(
      (projectIds ?? [])
        .map((projectId) => this.normalizeProjectId(projectId))
        .filter((projectId) => !!projectId),
    ));

    if (!normalizedProjectIds.length) {
      return vehicles;
    }

    const projectIdSet = new Set(normalizedProjectIds.map((projectId) => String(projectId).trim().toLowerCase()));

    return (vehicles ?? []).filter((vehicle) => {
      const vehicleProjectId = toOptionalText(getFirstDefinedValue(vehicle, [
        'projectId',
        'ProjectId',
        'projectID',
        'ProjectID',
        'project_id',
        'Project_Id',
      ]));

      if (!vehicleProjectId) {
        return true;
      }

      const normalizedVehicleProjectId = this.normalizeProjectId(vehicleProjectId).trim().toLowerCase();
      return projectIdSet.has(normalizedVehicleProjectId);
    });
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

  private extractTotalCount(response: any, fallback: number): number {
    const candidates = [
      response?.totalCount,
      response?.TotalCount,
      response?.data?.totalCount,
      response?.data?.TotalCount,
      response?.result?.totalCount,
      response?.result?.TotalCount,
      response?.meta?.totalCount,
      response?.meta?.TotalCount,
      response?.pagination?.totalCount,
      response?.pagination?.TotalCount,
      response?.data?.pagination?.totalCount,
      response?.data?.pagination?.TotalCount,
      response?.totalItems,
      response?.TotalItems,
      response?.totalRecords,
      response?.TotalRecords,
      response?.recordsTotal,
      response?.RecordsTotal,
      response?.data?.totalItems,
      response?.data?.TotalItems,
      response?.data?.totalRecords,
      response?.data?.TotalRecords,
      response?.data?.recordsTotal,
      response?.data?.RecordsTotal,
      response?.result?.totalItems,
      response?.result?.TotalItems,
      response?.result?.totalRecords,
      response?.result?.TotalRecords,
      response?.result?.recordsTotal,
      response?.result?.RecordsTotal,
      response?.total,
      response?.Total,
      response?.meta?.total,
      response?.pagination?.total,
      response?.data?.total,
      response?.result?.total,
      response?.count,
      response?.Count,
      response?.result?.count,
      response?.pagination?.count,
      response?.data?.count,
    ];

    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value >= 0) {
        return value;
      }
    }

    return fallback;
  }
}
