import { Injectable, OnDestroy, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  BehaviorSubject,
  Observable,
  Subject,
  catchError,
  forkJoin,
  from,
  map,
  mergeMap,
  of,
  shareReplay,
  takeUntil,
  toArray,
} from 'rxjs';
import { environment } from '../../../environments/environment';
import { ProjectInspector, ProjectStats, VehicleStats } from '../models/client-dashboard.models';
import { ClientService } from './client.service';
import { DashboardProjectsService } from './dashboard-projects.service';
import { DashboardTicketActivityResult } from '../features/dashboard/dashboard-ticket-activity.utils';

const CACHE_TTL_MS = 30_000;
const MAX_CONCURRENT = 4;

interface ProjectListItem {
  id: string;
  name: string;
  clientId?: string | null;
  clientName?: string | null;
  manufacturerName?: string | null;
  manufacturerLocationId?: string | null;
  locationIds?: string[];
  projectType?: string | null;
  status?: string | null;
  statusTone?: string | null;
}

interface RowCacheEntry {
  row: ProjectStats;
  expiresAt: number;
}

interface ClientBrandIndex {
  byId: Map<string, { name: string; logoUrl: string | null }>;
  byName: Map<string, { name: string; logoUrl: string | null }>;
}

interface ManufacturerBrandInfo {
  id: string;
  name: string;
  logoUrl: string | null;
  locationIds: string[];
}

interface ManufacturerBrandIndex {
  byId: Map<string, ManufacturerBrandInfo>;
  byName: Map<string, ManufacturerBrandInfo>;
  byLocationId: Map<string, ManufacturerBrandInfo>;
}

function asText(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function firstText(source: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = asText(source?.[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function firstNumber(source: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(source?.[key]);
    if (value != null) {
      return value;
    }
  }

  return null;
}

function normalizeTrendDirection(value: unknown): 'increased' | 'decreased' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['increased', 'increase', 'up', 'positive', 'higher', 'rise'].includes(normalized)) {
    return 'increased';
  }

  if (['decreased', 'decrease', 'down', 'negative', 'lower', 'fall'].includes(normalized)) {
    return 'decreased';
  }

  return null;
}

function normalizeStatusTone(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['critical', 'danger', 'error', 'severe'].includes(normalized)) {
    return 'critical';
  }

  if (['warning', 'watch', 'caution', 'amber'].includes(normalized)) {
    return 'warning';
  }

  if (['inactive', 'idle', 'closed', 'paused'].includes(normalized)) {
    return 'inactive';
  }

  if (['active', 'open', 'healthy', 'ok', 'success'].includes(normalized)) {
    return 'active';
  }

  return normalized;
}

function normalizeLookupKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
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

function normalizeLogoUrl(value: unknown): string | null {
  const raw = asText(value);
  if (!raw) {
    return null;
  }

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

function getUtcDayKey(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function shiftUtcDay(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getRecentTicketRange(days: number): { startDate: string; endDate: string } {
  const endDate = getUtcDayKey(new Date());
  const startDate = shiftUtcDay(endDate, -(Math.max(days, 2) - 1));
  return { startDate, endDate };
}

@Injectable({ providedIn: 'root' })
export class ProjectActivitiesDataService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly clientService = inject(ClientService);
  private readonly dashboardProjectsService = inject(DashboardProjectsService);
  private readonly apiBase = environment.apiBaseUrl;
  private readonly destroy$ = new Subject<void>();
  private activeLoadToken = 0;

  readonly rows$ = new BehaviorSubject<ProjectStats[]>([]);
  readonly totalCount$ = new BehaviorSubject<number>(0);
  readonly loading$ = new BehaviorSubject<boolean>(false);

  private readonly rowCache = new Map<string, RowCacheEntry>();
  private readonly clientBrandIndex$ = this.clientService.getClients().pipe(
    map((clients) => {
      const byId = new Map<string, { name: string; logoUrl: string | null }>();
      const byName = new Map<string, { name: string; logoUrl: string | null }>();

      for (const client of clients) {
        const id = asText(client.id);
        const name = asText(client.name);
        if (!name) {
          continue;
        }

        const brand = {
          name,
          logoUrl: normalizeLogoUrl(client.logoUrl),
        };

        if (id) {
          byId.set(id, brand);
        }

        byName.set(normalizeLookupKey(name), brand);
      }

      return { byId, byName } satisfies ClientBrandIndex;
    }),
    catchError(() => of({ byId: new Map(), byName: new Map() } satisfies ClientBrandIndex)),
    shareReplay({ bufferSize: 1, refCount: false }),
  );
  private readonly manufacturerBrandIndex$ = this.http.get<unknown>(`${this.apiBase}/Manufacturers`, {
    params: new HttpParams().set('locationId', '0'),
  }).pipe(
    map((response: any) => this.buildManufacturerBrandIndex(this.extractItems(response))),
    catchError(() => of({
      byId: new Map(),
      byName: new Map(),
      byLocationId: new Map(),
    } satisfies ManufacturerBrandIndex)),
    shareReplay({ bufferSize: 1, refCount: false }),
  );
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPage(params: {
    page: number;
    pageSize: number;
    clientId?: number | string;
    includeClosed?: boolean;
    projectId?: string;
    projectName?: string;
    projectTypeId?: number;
    vehicleId?: string;
  }): void {
    const loadToken = ++this.activeLoadToken;
    this.loading$.next(true);

    this.fetchProjectsPage(params).pipe(
      takeUntil(this.destroy$),
    ).subscribe({
      next: ({ items, totalCount }) => {
        if (loadToken !== this.activeLoadToken) {
          return;
        }

        this.totalCount$.next(totalCount);

        const phase1Rows = items.map((project) =>
          this.getCachedRow(project.id, {
            clientId: params.clientId,
            includeClosed: params.includeClosed,
            vehicleId: params.vehicleId,
          })?.row ?? this.makeSkeleton(project),
        );

        this.rows$.next(phase1Rows);
        this.loading$.next(false);

        const toEnrich = items.filter((project) => !this.getCachedRow(project.id, {
          clientId: params.clientId,
          includeClosed: params.includeClosed,
          vehicleId: params.vehicleId,
        }));

        if (toEnrich.length) {
          this.runEnrichmentPipeline(toEnrich, {
            clientId: params.clientId,
            includeClosed: params.includeClosed,
            vehicleId: params.vehicleId,
            loadToken,
          });
        }
      },
      error: () => {
        if (loadToken !== this.activeLoadToken) {
          return;
        }

        this.loading$.next(false);
      },
    });
  }

  clearCache(): void {
    this.rowCache.clear();
  }

  private runEnrichmentPipeline(
    projects: ProjectListItem[],
    options: {
      clientId?: number | string;
      includeClosed?: boolean;
      vehicleId?: string;
      loadToken: number;
    },
  ): void {
    from(projects).pipe(
      mergeMap(
        (project) => this.enrichProject(project, options.clientId, options.vehicleId, options.includeClosed),
        MAX_CONCURRENT,
      ),
      takeUntil(this.destroy$),
      toArray(),
    ).subscribe({
      next: (enrichedRows) => {
        if (options.loadToken !== this.activeLoadToken) {
          return;
        }

        const expiresAt = Date.now() + CACHE_TTL_MS;
        enrichedRows.forEach((row) => {
          this.rowCache.set(this.buildRowCacheKey(row.projectId, options), { row, expiresAt });
        });

        this.mergeRows(enrichedRows);
      },
    });
  }

  private enrichProject(
    project: ProjectListItem,
    clientId?: number | string,
    vehicleId?: string,
    includeClosed?: boolean,
  ): Observable<ProjectStats> {
    return forkJoin({
      ticketsDashboard: this.fetchTicketsDashboard(project.id, clientId, vehicleId),
      recentTicketActivity: this.fetchRecentTicketActivity(project.id, clientId, vehicleId, includeClosed),
      vehicleCount: this.fetchVehicleCount(project.id, clientId, vehicleId),
      station: this.fetchLatestStation(project.id, vehicleId),
      clientBrands: this.clientBrandIndex$,
      manufacturerBrands: this.manufacturerBrandIndex$,
    }).pipe(
      map(({ ticketsDashboard, recentTicketActivity, vehicleCount, station, clientBrands, manufacturerBrands }) => {
        const row = this.makeSkeleton(project);
        const dashboard: any = ticketsDashboard ?? {};
        const clientBrand = this.resolveClientBrand(project, clientBrands);
        const manufacturerBrand = this.resolveManufacturerBrand(project, manufacturerBrands);
        const activityFallback = this.buildTicketActivityFallback(recentTicketActivity);
        const totalTickets = firstNumber(dashboard, ['totalTickets', 'ticketCount'])
          ?? recentTicketActivity?.totalTickets
          ?? 0;
        const safetyCriticalTickets = firstNumber(dashboard, ['safetyCriticalTickets', 'criticalTickets']) ?? 0;
        const repeatedTickets = firstNumber(dashboard, ['repeatedTickets', 'repeatTickets']) ?? 0;
        const resolvedStatusTone = normalizeStatusTone(
          firstText(dashboard, ['statusTone', 'statusVariant', 'activityStatusTone']) ?? project.statusTone,
        ) ?? this.deriveStatusTone(safetyCriticalTickets, repeatedTickets, totalTickets);
        const resolvedStatus = firstText(dashboard, ['status', 'activityStatus'])
          ?? project.status
          ?? this.getDefaultStatusLabel(resolvedStatusTone);

        return {
          ...row,
          clientName: clientBrand?.name ?? project.clientName ?? null,
          clientLogoUrl: clientBrand?.logoUrl ?? null,
          manufacturerName: manufacturerBrand?.name ?? project.manufacturerName ?? null,
          manufacturerLogoUrl: manufacturerBrand?.logoUrl ?? null,
          totalTickets,
          totalAssets: vehicleCount,
          ticketsYesterday: firstNumber(dashboard, ['ticketsYesterday', 'yesterdayTickets', 'ticketCountYesterday'])
            ?? activityFallback.ticketsYesterday,
          ticketsChangePercentage: firstNumber(dashboard, ['ticketsChangePercentage', 'ticketChangePercentage', 'trendPercent'])
            ?? activityFallback.ticketsChangePercentage,
          ticketsStatus: normalizeTrendDirection(
            firstText(dashboard, ['ticketsStatus', 'trendDirection', 'ticketTrendDirection']),
          ) ?? activityFallback.ticketsStatus,
          safetyCriticalTickets,
          repeatedTickets,
          repeatedPercent: firstNumber(dashboard, ['repeatedPercent']),
          safetyCriticalPercent: firstNumber(dashboard, ['safetyCriticalPercent']),
          lastActivityDate: firstText(station, ['startDate', 'endDate', 'lastActivityDate']),
          lastStationName: firstText(station, ['stationName']) ?? firstText(station?.station, ['name']),
          sparklineHistory: this.extractSparklineHistory(dashboard) ?? activityFallback.sparklineHistory,
          vehicles: this.placeholderVehicles(vehicleCount),
          inspectors: this.extractInspectors(dashboard.inspectors),
          status: resolvedStatus,
          statusMeta: firstText(dashboard, ['statusMeta', 'activityStatusMeta']),
          statusTone: resolvedStatusTone,
        };
      }),
      catchError(() => of(this.makeSkeleton(project))),
    );
  }

  private fetchProjectsPage(params: {
    page: number;
    pageSize: number;
    clientId?: number | string;
    includeClosed?: boolean;
    projectId?: string;
    projectName?: string;
    projectTypeId?: number;
    vehicleId?: string;
  }): Observable<{ items: ProjectListItem[]; totalCount: number }> {
    if (params.projectId) {
      return of({
        items: [{
          id: String(params.projectId).trim(),
          name: params.projectName?.trim() || 'Selected Project',
        }],
        totalCount: 1,
      });
    }

    let httpParams = new HttpParams()
      .set('page', String(params.page + 1))
      .set('pageSize', String(params.pageSize));

    if (params.clientId != null) {
      httpParams = httpParams.set('clientId', String(params.clientId));
    }

    if (params.includeClosed != null) {
      httpParams = httpParams.set('includeClosed', String(params.includeClosed));
    }

    return this.http.get<unknown>(`${this.apiBase}/Projects`, { params: httpParams }).pipe(
      map((response: any) => {
        const items = this.extractItems(response)
          .map((item: any) => ({
            id: String(item?.id ?? item?.projectId ?? '').trim(),
            name: String(item?.name ?? item?.projectName ?? '').trim(),
            clientId: firstText(item, ['clientId', 'clientID']),
            clientName: firstText(item, ['clientName', 'client', 'customerName']),
            manufacturerName: firstText(item, ['manufacturerName', 'manufacturer']),
            manufacturerLocationId: firstText(item, ['manufacturerLocationId', 'factory_id']),
            locationIds: this.extractProjectLocationIds(item),
            projectType:
              firstText(item, ['projectTypeName', 'projectType', 'assessmentType', 'assessment_type']),
            status: firstText(item, ['status', 'projectStatus', 'state']),
            statusTone: normalizeStatusTone(firstText(item, ['statusTone', 'statusVariant'])),
          }))
          .filter((item: ProjectListItem) => !!item.id);

        return {
          items,
          totalCount: this.extractTotalCount(response, items.length),
        };
      }),
      catchError(() => of({ items: [], totalCount: 0 })),
    );
  }

  private fetchTicketsDashboard(
    projectId: string,
    clientId?: number | string,
    vehicleId?: string,
  ): Observable<unknown> {
    let httpParams = new HttpParams().set('projectId', projectId);
    if (clientId != null) {
      httpParams = httpParams.set('clientId', String(clientId));
    }
    if (vehicleId) {
      httpParams = httpParams.set('vehicleId', vehicleId);
    }

    return this.http.get<unknown>(`${this.apiBase}/tickets/dashboard`, { params: httpParams }).pipe(
      catchError(() => of(null)),
    );
  }

  private fetchRecentTicketActivity(
    projectId: string,
    clientId?: number | string,
    vehicleId?: string,
    includeClosed?: boolean,
  ): Observable<DashboardTicketActivityResult | null> {
    const { startDate, endDate } = getRecentTicketRange(10);
    return this.dashboardProjectsService.getTicketCreationActivity({
      projectId,
      clientId,
      vehicleId,
      includeClosed,
      startDate,
      endDate,
    }).pipe(
      catchError(() => of(null)),
    );
  }

  private fetchVehicleCount(
    projectId: string,
    clientId?: number | string,
    vehicleId?: string,
  ): Observable<number> {
    if (vehicleId) {
      return of(1);
    }

    let httpParams = new HttpParams().set('pageSize', '1').set('page', '1');
    if (clientId != null) {
      httpParams = httpParams.set('clientId', String(clientId));
    }

    return this.http
      .get<unknown>(`${this.apiBase}/projects/${encodeURIComponent(projectId)}/vehicles`, { params: httpParams })
      .pipe(
        map((response: any) => this.extractTotalCount(response, 0)),
        catchError(() => of(0)),
      );
  }

  private fetchLatestStation(projectId: string, vehicleId?: string): Observable<any | null> {
    let httpParams = new HttpParams()
      .set('projectId', projectId)
      .set('pageSize', '1')
      .set('orderBy', 'startDate')
      .set('orderDirection', 'desc');

    if (vehicleId) {
      httpParams = httpParams.set('vehicleId', vehicleId);
    }

    return this.http.get<unknown>(`${this.apiBase}/StationTrackers`, { params: httpParams }).pipe(
      map((response: any) => this.extractItems(response)[0] ?? null),
      catchError(() =>
        this.http.get<unknown>(`${this.apiBase}/stationtrackers`, { params: httpParams }).pipe(
          map((response: any) => this.extractItems(response)[0] ?? null),
          catchError(() => of(null)),
        ),
      ),
    );
  }

  private makeSkeleton(project: ProjectListItem): ProjectStats {
    return {
      projectId: project.id,
      projectName: project.name,
      clientName: project.clientName ?? null,
      clientLogoUrl: null,
      manufacturerName: project.manufacturerName ?? null,
      manufacturerLogoUrl: null,
      projectType: project.projectType ?? null,
      totalTickets: 0,
      totalAssets: 0,
      ticketsYesterday: null,
      ticketsChangePercentage: null,
      assetsChangePercentage: null,
      ticketsStatus: null,
      assetsStatus: 'decreased',
      vehicles: [],
      inspectors: [],
      status: project.status ?? null,
      statusTone: project.statusTone ?? null,
      statusMeta: null,
      repeatedPercent: null,
      safetyCriticalPercent: null,
      lastActivityDate: null,
      lastStationName: null,
      sparklineHistory: undefined,
    };
  }

  private placeholderVehicles(count: number): VehicleStats[] {
    return Array.from({ length: count }, (_, index) => ({
      vehicleId: String(index),
      vehicleName: '',
      totalTickets: 0,
      totalAssets: 0,
      ticketsChangePercentage: null,
      assetsChangePercentage: null,
      ticketsStatus: null,
      assetsStatus: 'decreased',
    }));
  }

  private extractInspectors(value: unknown): ProjectInspector[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .reduce<ProjectInspector[]>((inspectors, item: any) => {
        const name = firstText(item, ['name', 'fullName', 'userName']);
        if (!name) {
          return inspectors;
        }

        const initials = name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? '')
          .join('');

        inspectors.push({
          name,
          initials,
          avatarUrl:
            firstText(item, [
              'avatarUrl',
              'profilePictureUrl',
              'profileImageUrl',
              'photoUrl',
              'imageUrl',
              'pictureUrl',
            ]) ?? null,
        });

        return inspectors;
      }, []);
  }

  private extractSparklineHistory(source: any): { tickets?: number[]; assets?: number[] } | undefined {
    const ticketSeries = this.extractNumberArray(
      source?.sparklineHistory?.tickets ??
      source?.history?.tickets ??
      source?.ticketsHistory ??
      source?.ticketHistory,
    );

    const assetSeries = this.extractNumberArray(
      source?.sparklineHistory?.assets ??
      source?.history?.assets ??
      source?.assetsHistory ??
      source?.assetHistory,
    );

    if (!ticketSeries && !assetSeries) {
      return undefined;
    }

    return {
      ...(ticketSeries ? { tickets: ticketSeries } : {}),
      ...(assetSeries ? { assets: assetSeries } : {}),
    };
  }

  private extractNumberArray(value: unknown): number[] | null {
    if (!Array.isArray(value)) {
      return null;
    }

    const normalized = value
      .map((entry) => asNumber(entry))
      .filter((entry): entry is number => entry != null);

    return normalized.length ? normalized : null;
  }

  private getCachedRow(
    projectId: string,
    scope: {
      clientId?: number | string;
      includeClosed?: boolean;
      vehicleId?: string;
    },
  ): RowCacheEntry | null {
    const cached = this.rowCache.get(this.buildRowCacheKey(projectId, scope));
    return cached && cached.expiresAt > Date.now() ? cached : null;
  }

  private buildRowCacheKey(
    projectId: string,
    scope: {
      clientId?: number | string;
      includeClosed?: boolean;
      vehicleId?: string;
    },
  ): string {
    const clientKey = scope.clientId != null ? String(scope.clientId).trim() : 'all-clients';
    const vehicleKey = scope.vehicleId ? String(scope.vehicleId).trim() : 'all-vehicles';
    const closedKey = scope.includeClosed ? 'include-closed' : 'open-only';
    return `${projectId}|${clientKey}|${vehicleKey}|${closedKey}`;
  }

  private mergeRows(enriched: ProjectStats[]): void {
    const byId = new Map(enriched.map((row) => [row.projectId, row]));
    this.rows$.next(this.rows$.value.map((row) => byId.get(row.projectId) ?? row));
  }

  private buildTicketActivityFallback(
    activity: DashboardTicketActivityResult | null,
  ): {
    ticketsYesterday: number | null;
    ticketsChangePercentage: number | null;
    ticketsStatus: 'increased' | 'decreased' | null;
    sparklineHistory?: { tickets?: number[] };
  } {
    const points = activity?.points ?? [];
    if (!points.length) {
      return {
        ticketsYesterday: null,
        ticketsChangePercentage: null,
        ticketsStatus: null,
      };
    }

    const countsByDay = new Map(points.map((point) => [String(point.date).trim(), Number(point.count ?? 0) || 0]));
    const today = getUtcDayKey(new Date());
    const yesterday = shiftUtcDay(today, -1);
    const previousDay = shiftUtcDay(yesterday, -1);
    const yesterdayCount = countsByDay.get(yesterday) ?? 0;
    const previousDayCount = countsByDay.get(previousDay) ?? 0;
    const difference = yesterdayCount - previousDayCount;

    let ticketsChangePercentage: number | null = null;
    let ticketsStatus: 'increased' | 'decreased' | null = null;

    if (difference !== 0) {
      ticketsStatus = difference > 0 ? 'increased' : 'decreased';
      if (previousDayCount > 0) {
        ticketsChangePercentage = Number(((Math.abs(difference) / previousDayCount) * 100).toFixed(1));
      } else {
        ticketsChangePercentage = 100;
      }
    } else {
      ticketsChangePercentage = 0;
    }

    const sparklineSeries = points
      .slice(-10)
      .map((point) => Number(point.count ?? 0))
      .filter((count) => Number.isFinite(count));

    return {
      ticketsYesterday: yesterdayCount,
      ticketsChangePercentage,
      ticketsStatus,
      sparklineHistory: sparklineSeries.length ? { tickets: sparklineSeries } : undefined,
    };
  }

  private deriveStatusTone(
    safetyCriticalTickets: number,
    repeatedTickets: number,
    totalTickets: number,
  ): string {
    if (safetyCriticalTickets > 0) {
      return 'critical';
    }

    if (repeatedTickets > 0) {
      return 'warning';
    }

    if (totalTickets > 0) {
      return 'active';
    }

    return 'inactive';
  }

  private getDefaultStatusLabel(statusTone: string | null): string | null {
    if (statusTone === 'critical') {
      return 'Critical';
    }

    if (statusTone === 'warning') {
      return 'Warning';
    }

    if (statusTone === 'active') {
      return 'Active';
    }

    if (statusTone === 'inactive') {
      return 'Idle';
    }

    return null;
  }

  private buildManufacturerBrandIndex(items: any[]): ManufacturerBrandIndex {
    const byId = new Map<string, ManufacturerBrandInfo>();
    const byName = new Map<string, ManufacturerBrandInfo>();
    const byLocationId = new Map<string, ManufacturerBrandInfo>();

    items.forEach((item: any) => {
      const id = asText(item?.id);
      const name = firstText(item, ['manufacturerName', 'name']);
      if (!id || !name) {
        return;
      }

      const locationIds = this.extractProjectLocationIds(item);
      const singleLocationId = firstText(item, ['locationId', 'primaryLocationId']);
      if (singleLocationId && !locationIds.includes(singleLocationId)) {
        locationIds.push(singleLocationId);
      }

      const brand: ManufacturerBrandInfo = {
        id,
        name,
        logoUrl: normalizeLogoUrl(item?.manufacturerLogo),
        locationIds,
      };

      byId.set(id, brand);
      byName.set(normalizeLookupKey(name), brand);
      locationIds.forEach((locationId) => byLocationId.set(locationId, brand));
    });

    return { byId, byName, byLocationId };
  }

  private resolveClientBrand(project: ProjectListItem, index: ClientBrandIndex): { name: string; logoUrl: string | null } | null {
    const clientId = asText(project.clientId);
    if (clientId) {
      const match = index.byId.get(clientId);
      if (match) {
        return match;
      }
    }

    const clientName = asText(project.clientName);
    if (!clientName) {
      return null;
    }

    return index.byName.get(normalizeLookupKey(clientName)) ?? {
      name: clientName,
      logoUrl: null,
    };
  }

  private resolveManufacturerBrand(project: ProjectListItem, index: ManufacturerBrandIndex): ManufacturerBrandInfo | null {
    const manufacturerLocationId = asText(project.manufacturerLocationId);
    if (manufacturerLocationId) {
      const match = index.byLocationId.get(manufacturerLocationId);
      if (match) {
        return match;
      }
    }

    for (const locationId of project.locationIds ?? []) {
      const match = index.byLocationId.get(locationId);
      if (match) {
        return match;
      }
    }

    const manufacturerName = asText(project.manufacturerName);
    if (!manufacturerName) {
      return null;
    }

    return index.byName.get(normalizeLookupKey(manufacturerName)) ?? {
      id: '',
      name: manufacturerName,
      logoUrl: null,
      locationIds: [],
    };
  }

  private extractProjectLocationIds(source: any): string[] {
    const values = new Set<string>();
    const candidates = Array.isArray(source?.locationIds)
      ? source.locationIds
      : [];

    candidates.forEach((value: unknown) => {
      const normalized = asText(value);
      if (normalized) {
        values.add(normalized);
      }
    });

    if (Array.isArray(source?.locations)) {
      source.locations.forEach((location: any) => {
        const normalized = firstText(location, ['id', 'locationId']);
        if (normalized) {
          values.add(normalized);
        }
      });
    }

    [source?.locationId, source?.manufacturerLocationId, source?.factory_id].forEach((value) => {
      const normalized = asText(value);
      if (normalized) {
        values.add(normalized);
      }
    });

    return Array.from(values);
  }

  private extractItems(response: any): any[] {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.items)) return response.items;
    if (Array.isArray(response?.data?.items)) return response.data.items;
    if (Array.isArray(response?.data)) return response.data;
    return [];
  }

  private extractTotalCount(response: any, fallback: number): number {
    for (const value of [
      response?.totalCount,
      response?.TotalCount,
      response?.data?.totalCount,
      response?.data?.TotalCount,
      response?.total,
      response?.Total,
      response?.count,
      response?.Count,
    ]) {
      const normalized = Number(value);
      if (Number.isFinite(normalized) && normalized >= 0) {
        return normalized;
      }
    }

    return fallback;
  }
}
