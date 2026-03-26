import { Injectable, OnDestroy } from '@angular/core';
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
  takeUntil,
  toArray,
} from 'rxjs';
import { environment } from '../../../environments/environment';
import { ProjectInspector, ProjectStats, VehicleStats } from '../models/client-dashboard.models';

// ── Constants ────────────────────────────────────────────────────────────────

const PROJECT_TYPE_MAP: Record<number, string> = {
  1: 'New Build',
  2: 'Condition Assessment',
  3: 'PDI',
  4: 'Mid-Life Overhaul',
};

/** Cache TTL for both rows and resolved users (30 seconds). */
const CACHE_TTL_MS = 30_000;

/** Max simultaneous per-project enrichment pipelines. */
const MAX_CONCURRENT = 4;

// ── Internal types ────────────────────────────────────────────────────────────

interface ProjectListItem {
  id: string;
  name: string;
  projectTypeId?: number;
}

interface RowCacheEntry {
  row: ProjectStats;
  /** User IDs still awaiting batch resolution (cleared after Phase 3). */
  pendingUserIds?: string[];
  expiresAt: number;
}

interface UserCacheEntry {
  inspector: ProjectInspector;
  expiresAt: number;
}

/** Intermediate result from Phase 2 enrichment — carries pending user IDs. */
type EnrichedRow = ProjectStats & { _pendingUserIds?: string[] };

interface PagedItemsResult<T> {
  items: T[];
  totalCount: number;
}

function formatLocalDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractTicketDayKey(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  const directMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) {
    return directMatch[1];
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return formatLocalDayKey(parsed);
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Data service for the "Project Activities" widget.
 *
 * Fetching strategy
 * -----------------
 * Phase 1  Emit skeleton rows immediately so the table renders without delay.
 * Phase 2  Concurrently enrich each row (max 4 at a time) using minimal API
 *          calls:
 *            • GET /api/tickets/dashboard?projectId=X  → aggregate metrics
 *            • GET /api/projects/{id}/vehicles?pageSize=1  → totalCount only
 *            • GET /api/StationTrackers?projectId=X&pageSize=1&orderBy=startDate&orderDirection=desc
 *                                                       → latest station entry
 *            • GET /api/Tickets?projectId=X&pageSize=5   → harvest user IDs
 * Phase 3  Single batch user resolution:
 *            • GET /api/Users?ids=id1,id2,...  (or ?userIds=... as fallback)
 *          All collected user IDs resolved in ONE request, then inspectors are
 *          merged into their respective rows.
 *
 * Caching: each resolved row is cached for 30 s.  Cached rows skip all
 * enrichment on pagination or resize.
 */
@Injectable({ providedIn: 'root' })
export class ProjectActivitiesDataService implements OnDestroy {
  private readonly apiBase = environment.apiBaseUrl;
  private readonly destroy$ = new Subject<void>();
  private activeLoadToken = 0;

  // ── Public reactive state ────────────────────────────────────────────────
  /** Current page of enriched project rows. */
  readonly rows$ = new BehaviorSubject<ProjectStats[]>([]);
  /** Total number of projects matching the current query (server total). */
  readonly totalCount$ = new BehaviorSubject<number>(0);
  /** True while the projects-list request is in flight. */
  readonly loading$ = new BehaviorSubject<boolean>(false);

  // ── Caches ───────────────────────────────────────────────────────────────
  private readonly rowCache = new Map<string, RowCacheEntry>();
  private readonly userCache = new Map<string, UserCacheEntry>();

  constructor(private readonly http: HttpClient) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Load a page of projects and start the three-phase enrichment pipeline.
   *
   * @param params.page      0-based page index
   * @param params.pageSize  Number of rows to display (should match viewport)
   */
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

        // Phase 1: render immediately using cache where available
        const phase1Rows = items.map((p) =>
          this.getCachedRow(p.id, {
            clientId: params.clientId,
            includeClosed: params.includeClosed,
            vehicleId: params.vehicleId,
          })?.row ?? this.makeSkeleton(p),
        );
        this.rows$.next(phase1Rows);
        this.loading$.next(false);

        // Phase 2 + 3: enrich rows not yet in cache
        const toEnrich = items.filter((p) => !this.getCachedRow(p.id, {
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

  /** Invalidate all cached rows and users. Call after a hard refresh. */
  clearCache(): void {
    this.rowCache.clear();
    this.userCache.clear();
  }

  // ── Phase 2 + 3 pipeline ─────────────────────────────────────────────────

  private runEnrichmentPipeline(
    projects: ProjectListItem[],
    options: {
      clientId?: number | string;
      includeClosed?: boolean;
      vehicleId?: string;
      loadToken: number;
    },
  ): void {
    const collectedUserIds: string[] = [];

    from(projects).pipe(
      // Limit simultaneous enrichments to avoid network saturation
      mergeMap(p => this.enrichProject(p, options.clientId, options.vehicleId), MAX_CONCURRENT),
      takeUntil(this.destroy$),
      toArray(),
    ).subscribe({
      next: (enriched) => {
        if (options.loadToken !== this.activeLoadToken) {
          return;
        }

        enriched.forEach(row => {
          if (row._pendingUserIds?.length) {
            collectedUserIds.push(...row._pendingUserIds);
          }
          // Cache phase-2 data (without resolved inspectors yet)
          this.rowCache.set(this.buildRowCacheKey(row.projectId, options), {
            row,
            pendingUserIds: row._pendingUserIds,
            expiresAt: Date.now() + CACHE_TTL_MS,
          });
        });
        // Merge phase-2 data into the live rows$
        this.mergeRows(enriched);
      },
      complete: () => {
        if (options.loadToken !== this.activeLoadToken || !collectedUserIds.length) {
          return;
        }

        // Phase 3: single batch request for ALL user IDs collected above
        const uniqueIds = Array.from(new Set(collectedUserIds));
        this.resolveUserBatch(uniqueIds, options.clientId).pipe(
          takeUntil(this.destroy$),
        ).subscribe(userMap => {
          if (options.loadToken !== this.activeLoadToken) {
            return;
          }

          const updated = this.rows$.value.map(row => {
            const entry = this.rowCache.get(this.buildRowCacheKey(row.projectId, options));
            if (!entry?.pendingUserIds?.length) return row;

            const inspectors = entry.pendingUserIds
              .map(id => userMap.get(id))
              .filter((u): u is ProjectInspector => !!u && !!u.name);

            const final: ProjectStats = { ...row, inspectors };
            // Cache the fully resolved row; clear pendingUserIds
            this.rowCache.set(this.buildRowCacheKey(row.projectId, options), {
              row: final,
              expiresAt: Date.now() + CACHE_TTL_MS,
            });
            return final;
          });
          this.rows$.next(updated);
        });
      },
    });
  }

  /**
   * Phase 2 — fetch all secondary data for one project in parallel.
   * Four requests per project, results merged into a single row update.
   */
  private enrichProject(
    project: ProjectListItem,
    clientId?: number | string,
    vehicleId?: string,
  ): Observable<EnrichedRow> {
    return forkJoin({
      td: this.fetchTicketsDashboard(project.id, clientId, vehicleId),
      vehicleCount: this.fetchVehicleCount(project.id, clientId, vehicleId),
      station: this.fetchLatestStation(project.id, vehicleId),
      recentTickets: this.fetchRecentProjectTickets(project.id, clientId, vehicleId),
      userIds: this.fetchTicketUserIds(project.id, clientId, vehicleId),
    }).pipe(
      map(({ td, vehicleCount, station, recentTickets, userIds }) => {
        const base = this.makeSkeleton(project);
        const recentTrend = this.buildRecentTicketMetrics(recentTickets);
        const row: EnrichedRow = {
          ...base,
          totalTickets: (td as any)?.totalTickets ?? 0,
          totalAssets: vehicleCount,
          ticketsYesterday: recentTrend.ticketsYesterday,
          ticketsChangePercentage: recentTrend.ticketsChangePercentage,
          ticketsStatus: recentTrend.ticketsStatus,
          safetyCriticalTickets: (td as any)?.safetyCriticalTickets ?? 0,
          repeatedTickets: (td as any)?.repeatedTickets ?? 0,
          repeatedPercent: (td as any)?.repeatedPercent ?? 0,
          safetyCriticalPercent: (td as any)?.safetyCriticalPercent ?? 0,
          lastActivityDate: (station as any)?.startDate ?? (station as any)?.endDate ?? null,
          lastStationName: (station as any)?.stationName ?? (station as any)?.station?.name ?? null,
          sparklineHistory: recentTrend.sparklineHistory,
          // Placeholder array whose .length === real vehicle count
          vehicles: this.placeholderVehicles(vehicleCount),
          inspectors: [],
          _pendingUserIds: userIds.length ? userIds : undefined,
        };
        return row;
      }),
      catchError(() => of(this.makeSkeleton(project) as EnrichedRow)),
    );
  }

  // ── Targeted API calls ────────────────────────────────────────────────────

  /**
   * GET /api/Projects — server-side pagination so only one page is fetched.
   */
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
          projectTypeId: params.projectTypeId,
        }],
        totalCount: 1,
      });
    }

    let p = new HttpParams()
      .set('page', String(params.page + 1))   // API is 1-based
      .set('pageSize', String(params.pageSize));
    if (params.clientId != null) p = p.set('clientId', String(params.clientId));
    if (params.includeClosed != null) p = p.set('includeClosed', String(params.includeClosed));

    return this.http.get<unknown>(`${this.apiBase}/Projects`, { params: p }).pipe(
      map((res: any) => ({
        items: this.extractItems(res)
          .map((item: any) => ({
            id: String(item?.id ?? item?.projectId ?? '').trim(),
            name: item?.name ?? item?.projectName ?? '',
            projectTypeId: Number(item?.projectTypeId ?? 0) || undefined,
          }))
          .filter((item) => !!item.id),
        totalCount: this.extractTotalCount(res, 0),
      })),
      catchError(() => of({ items: [], totalCount: 0 })),
    );
  }

  /**
   * GET /api/tickets/dashboard?projectId=X
   * Returns aggregate metrics (totalTickets, safetyCriticalTickets, …).
   * No individual ticket records are fetched.
   */
  private fetchTicketsDashboard(
    projectId: string,
    clientId?: number | string,
    vehicleId?: string,
  ): Observable<unknown> {
    let p = new HttpParams().set('projectId', projectId);
    if (clientId != null) p = p.set('clientId', String(clientId));
    if (vehicleId) p = p.set('vehicleId', vehicleId);
    return this.http.get<unknown>(`${this.apiBase}/tickets/dashboard`, { params: p }).pipe(
      catchError(() => of(null)),
    );
  }

  /**
   * GET /api/projects/{id}/vehicles?pageSize=1&page=1
   * Requests a single item so the response body is minimal.
   * Only totalCount from the envelope is used — items are discarded.
   */
  private fetchVehicleCount(
    projectId: string,
    clientId?: number | string,
    vehicleId?: string,
  ): Observable<number> {
    if (vehicleId) {
      return of(1);
    }

    let p = new HttpParams().set('pageSize', '1').set('page', '1');
    if (clientId != null) p = p.set('clientId', String(clientId));
    return this.http
      .get<unknown>(`${this.apiBase}/projects/${encodeURIComponent(projectId)}/vehicles`, { params: p })
      .pipe(
        map((res: any) => this.extractTotalCount(res, 0)),
        catchError(() => of(0)),
      );
  }

  /**
   * GET /api/StationTrackers?projectId=X&pageSize=1&orderBy=startDate&orderDirection=desc
   * Returns only the most recent station entry.
   */
  private fetchLatestStation(projectId: string, vehicleId?: string): Observable<unknown> {
    let p = new HttpParams()
      .set('projectId', projectId)
      .set('pageSize', '1')
      .set('orderBy', 'startDate')
      .set('orderDirection', 'desc');
    if (vehicleId) {
      p = p.set('vehicleId', vehicleId);
    }
    return this.http.get<unknown>(`${this.apiBase}/StationTrackers`, { params: p }).pipe(
      map((res: any) => this.extractItems(res)[0] ?? null),
      catchError(() => of(null)),
    );
  }

  /**
   * GET /api/Tickets?projectId=X&pageSize=25&page=1
   * Fetches the minimum number of tickets needed to harvest inspector user IDs.
   * The ticket records themselves are discarded after ID extraction.
   */
  private fetchTicketUserIds(
    projectId: string,
    clientId?: number | string,
    vehicleId?: string,
  ): Observable<string[]> {
    let p = new HttpParams().set('projectId', projectId).set('pageSize', '25').set('page', '1');
    if (clientId != null) p = p.set('clientId', String(clientId));
    if (vehicleId) p = p.set('vehicleId', vehicleId);
    return this.http.get<unknown>(`${this.apiBase}/Tickets`, { params: p }).pipe(
      map((res: any) => this.extractUserIds(this.extractItems(res))),
      catchError(() => of([])),
    );
  }

  private fetchRecentProjectTickets(
    projectId: string,
    clientId?: number | string,
    vehicleId?: string,
  ): Observable<any[]> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const start = new Date(yesterday);
    start.setDate(yesterday.getDate() - 6);

    const startDate = formatLocalDayKey(start);
    const endDate = formatLocalDayKey(yesterday);
    const pageSize = Math.max(200, Number(environment.apiPagedFetchPageSize ?? 500) || 500);
    const maxPages = Math.max(1, Math.min(20, Number(environment.apiPagedFetchMaxPages ?? 20) || 20));

    const fetchPage = (page: number): Observable<PagedItemsResult<any>> => {
      let params = new HttpParams()
        .set('projectId', projectId)
        .set('startDate', startDate)
        .set('endDate', endDate)
        .set('page', String(page))
        .set('pageSize', String(pageSize));

      if (clientId != null) {
        params = params.set('clientId', String(clientId));
      }

      if (vehicleId) {
        params = params.set('vehicleId', vehicleId);
      }

      return this.http.get<unknown>(`${this.apiBase}/Tickets`, { params }).pipe(
        map((response: any) => ({
          items: this.extractItems(response),
          totalCount: this.extractTotalCount(response, 0),
        })),
        catchError(() => of({ items: [], totalCount: 0 })),
      );
    };

    return fetchPage(1).pipe(
      mergeMap((firstPage) => {
        const totalPages = Math.min(
          maxPages,
          Math.max(1, Math.ceil((firstPage.totalCount || firstPage.items.length || 0) / pageSize)),
        );

        if (totalPages <= 1) {
          return of(firstPage.items);
        }

        const remainingRequests: Observable<PagedItemsResult<any>>[] = [];
        for (let page = 2; page <= totalPages; page += 1) {
          remainingRequests.push(fetchPage(page));
        }

        return forkJoin(remainingRequests).pipe(
          map((pages) => [firstPage, ...pages].flatMap((result) => result.items)),
        );
      }),
      catchError(() => of([])),
    );
  }

  /**
   * GET /api/Users?ids=id1,id2,...
   * Single request for ALL user IDs collected from every visible project.
   * Falls back to ?userIds= if the server does not recognise ?ids=.
   * Results are cached per-user for 30 s.
   */
  private resolveUserBatch(
    userIds: string[],
    clientId?: number | string,
  ): Observable<Map<string, ProjectInspector>> {
    const now = Date.now();
    const uncached = userIds.filter(id => {
      const e = this.userCache.get(id);
      return !e || e.expiresAt < now;
    });

    const buildMap = (): Map<string, ProjectInspector> => {
      const map = new Map<string, ProjectInspector>();
      const ts = Date.now();
      userIds.forEach(id => {
        const e = this.userCache.get(id);
        if (e && e.expiresAt > ts) map.set(id, e.inspector);
      });
      return map;
    };

    if (!uncached.length) return of(buildMap());

    const cacheItems = (items: any[]): void => {
      items.forEach((item: any) => {
        const id = String(item?.id ?? item?.userId ?? '').trim();
        const name = String(item?.name ?? item?.userName ?? item?.fullName ?? '').trim();
        if (!id || !name) return;
        this.userCache.set(id, {
          inspector: {
            name,
            initials: this.toInitials(name),
            avatarUrl:
              item?.picture ??
              item?.avatarUrl ??
              item?.profilePictureUrl ??
              item?.profileImageUrl ??
              item?.photoUrl ??
              item?.imageUrl ??
              item?.pictureUrl ??
              null,
          },
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      });
    };

    const tryBatch = (paramKey: string): Observable<Map<string, ProjectInspector>> => {
      let p = new HttpParams().set(paramKey, uncached.join(','));
      if (clientId != null) p = p.set('clientId', String(clientId));
      return this.http.get<unknown>(`${this.apiBase}/Users`, { params: p }).pipe(
        map((res: any) => { cacheItems(this.extractItems(res)); return buildMap(); }),
      );
    };

    return tryBatch('ids').pipe(
      catchError(() => tryBatch('userIds')),
      catchError(() => of(buildMap())),
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private makeSkeleton(p: ProjectListItem): ProjectStats {
    return {
      projectId: p.id,
      projectName: p.name,
      projectType: p.projectTypeId ? (PROJECT_TYPE_MAP[p.projectTypeId] ?? null) : null,
      totalTickets: 0,
      totalAssets: 0,
      vehicles: [],
      inspectors: [],
      ticketsChangePercentage: 0,
      assetsChangePercentage: 0,
      ticketsStatus: 'decreased',
      assetsStatus: 'decreased',
    };
  }

  /**
   * Create N minimal placeholder vehicles so that `row.vehicles.length`
   * correctly reflects the real vehicle count without fetching vehicle records.
   */
  private placeholderVehicles(count: number): VehicleStats[] {
    return Array.from({ length: count }, (_, i) => ({
      vehicleId: String(i),
      vehicleName: '',
      totalTickets: 0,
      totalAssets: 0,
      ticketsChangePercentage: 0,
      assetsChangePercentage: 0,
      ticketsStatus: 'decreased' as const,
      assetsStatus: 'decreased' as const,
    }));
  }

  private getCachedRow(
    projectId: string,
    scope: {
      clientId?: number | string;
      includeClosed?: boolean;
      vehicleId?: string;
    },
  ): RowCacheEntry | null {
    const e = this.rowCache.get(this.buildRowCacheKey(projectId, scope));
    return e && e.expiresAt > Date.now() ? e : null;
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

  /** Merge enriched rows into the current rows$ value by project ID. */
  private mergeRows(enriched: ProjectStats[]): void {
    const byId = new Map(enriched.map(r => [r.projectId, r]));
    const updated = this.rows$.value.map(row => byId.get(row.projectId) ?? row);
    this.rows$.next(updated);
  }

  private extractUserIds(tickets: any[]): string[] {
    const ids = new Set<string>();
    tickets.forEach((t: any) => {
      [
        t?.inspectorId,
        t?.inspector?.id,
        t?.inspector?.userId,
        t?.userId,
        t?.UserId,
        t?.createdBy,
        t?.createdById,
        t?.assignedBy,
        t?.assignedById,
        t?.AssignedById,
        t?.assignedUserId,
        t?.assignedTo,
        t?.assignedToId,
        t?.AssignedToId,
        t?.assignedTo?.id,
        t?.ownerId,
      ].forEach(v => {
        const id = String(v ?? '').trim();
        if (id && id !== '0' && !/^null$/i.test(id)) ids.add(id);
      });
    });
    return Array.from(ids);
  }

  private extractItems(response: any): any[] {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.items)) return response.items;
    if (Array.isArray(response?.data?.items)) return response.data.items;
    if (Array.isArray(response?.data)) return response.data;
    return [];
  }

  private extractTotalCount(response: any, fallback: number): number {
    for (const v of [
      response?.totalCount, response?.TotalCount,
      response?.data?.totalCount, response?.data?.TotalCount,
      response?.total, response?.Total,
      response?.count, response?.Count,
    ]) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return fallback;
  }

  private toInitials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
  }

  private buildRecentTicketMetrics(tickets: any[]): {
    ticketsYesterday: number;
    ticketsChangePercentage: number;
    ticketsStatus: 'increased' | 'decreased';
    sparklineHistory: { tickets: number[] };
  } {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const dayKeys = Array.from({ length: 7 }, (_, index) => {
      const current = new Date(yesterday);
      current.setDate(yesterday.getDate() - (6 - index));
      return formatLocalDayKey(current);
    });

    const countsByDay = new Map<string, number>(dayKeys.map((dayKey) => [dayKey, 0]));

    for (const ticket of tickets ?? []) {
      const dayKey = extractTicketDayKey(
        ticket?.createdAt ??
        ticket?.createdDate ??
        ticket?.dateCreated ??
        ticket?.CreatedAt ??
        ticket?.CreatedDate,
      );

      if (!dayKey || !countsByDay.has(dayKey)) {
        continue;
      }

      countsByDay.set(dayKey, (countsByDay.get(dayKey) ?? 0) + 1);
    }

    const series = dayKeys.map((dayKey) => countsByDay.get(dayKey) ?? 0);
    const ticketsYesterday = series[series.length - 1] ?? 0;
    const previousDayTickets = series[series.length - 2] ?? 0;

    let ticketsChangePercentage = 0;
    if (previousDayTickets > 0) {
      ticketsChangePercentage = Number(
        (Math.abs((ticketsYesterday - previousDayTickets) / previousDayTickets) * 100).toFixed(1),
      );
    } else if (ticketsYesterday > 0) {
      ticketsChangePercentage = 100;
    }

    return {
      ticketsYesterday,
      ticketsChangePercentage,
      ticketsStatus: ticketsYesterday >= previousDayTickets ? 'increased' : 'decreased',
      sparklineHistory: { tickets: series },
    };
  }
}
