import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  BehaviorSubject,
  Observable,
  catchError,
  forkJoin,
  from,
  map,
  mergeMap,
  of,
  retry,
  timer,
  toArray,
} from 'rxjs';
import { environment } from '../../../environments/environment';
import { TIME_LOG_API_PATHS, buildApiUrl } from '../constants/time-log-api.constants';
import {
  TimeLogUser,
  TimeLogProject,
  TimeLogVehicle,
} from '../models/time-log.model';
import { normalizeId, normalizeOptionalId } from '../utils/id-normalizer.util';

export interface LookupState {
  ready: boolean;
  loading: boolean;
  error?: string;
  projects: TimeLogProject[];
  vehicles: TimeLogVehicle[];
  users: TimeLogUser[];
  loadedAt?: number;
}

type RefreshReason = 'manual' | 'error' | 'ttl';

const TTL_MS = 5 * 60 * 1000;
const FAN_OUT_CONCURRENCY = 6;

@Injectable({ providedIn: 'root' })
export class TimeLogLookupAdapterService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly userByIdCache = new Map<string, TimeLogUser | null>();
  private readonly stateSubject = new BehaviorSubject<LookupState>({
    ready: false,
    loading: false,
    projects: [],
    vehicles: [],
    users: [],
  });
  private refreshInFlight = false;

  readonly lookups$: Observable<LookupState> = this.stateSubject.asObservable();

  constructor(private http: HttpClient) {}

  refresh(reason: RefreshReason = 'manual'): void {
    const current = this.stateSubject.value;
    const now = Date.now();
    const ttlValid = !!current.loadedAt && now - current.loadedAt < TTL_MS;
    if (ttlValid && reason !== 'manual') return;
    if (this.refreshInFlight) return;

    this.refreshInFlight = true;
    this.stateSubject.next({ ...current, loading: true, error: undefined });

    forkJoin({
      projects: this.fetchProjects(),
      users: this.fetchUsers(),
    })
      .pipe(
        mergeMap(({ projects, users }) =>
          this.fetchVehiclesWithFallback(projects).pipe(
            map(({ vehicles, warning }) => ({ projects, users, vehicles, warning }))
          )
        )
      )
      .subscribe({
        next: ({ projects, users, vehicles, warning }) => {
          const loadedAt = Date.now();
          this.stateSubject.next({
            ready: true,
            loading: false,
            error: warning,
            projects,
            vehicles,
            users,
            loadedAt,
          });
          this.refreshInFlight = false;
        },
        error: (err) => {
          const message = err?.message ?? 'Failed to load time-log lookups';
          this.stateSubject.next({
            ...this.stateSubject.value,
            ready: false,
            loading: false,
            error: message,
          });
          this.refreshInFlight = false;
        },
      });
  }

  getVehiclesForProject(projectId: string): TimeLogVehicle[] {
    const state = this.stateSubject.value;
    if (!projectId) return state.vehicles;
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return [];
    return state.vehicles.filter((v) => {
      if (v.clientId) return v.clientId === project.clientId;
      if (v.projectId) return v.projectId === project.id;
      return false;
    });
  }

  resolveUsersByIds(userIds: string[]): Observable<TimeLogUser[]> {
    const ids = Array.from(
      new Set((userIds ?? []).map((id) => String(id ?? '').trim()).filter((id) => !!id))
    );
    if (ids.length === 0) return of([]);

    const uncachedIds = ids.filter((id) => this.shouldFetchUserById(id));
    if (uncachedIds.length === 0) {
      return of(ids.map((id) => this.userByIdCache.get(id)).filter((u): u is TimeLogUser => !!u));
    }

    return forkJoin(
      uncachedIds.map((id) =>
        this.fetchUserById(id).pipe(
          catchError(() => of(null)),
          map((user) => ({ id, user }))
        )
      )
    ).pipe(
      map((results) => {
        for (const result of results) {
          this.userByIdCache.set(result.id, result.user);
        }
        return ids
          .map((id) => this.userByIdCache.get(id))
          .filter((user): user is TimeLogUser => !!user);
      })
    );
  }

  private fetchProjects(): Observable<TimeLogProject[]> {
    return this.http
      .get<unknown>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.projects))
      .pipe(map((raw) => this.normalizeProjects(raw)));
  }

  private fetchUsers(): Observable<TimeLogUser[]> {
    const params = new HttpParams().set('page', '1').set('pageSize', '1000');
    return this.http
      .get<unknown>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.users), { params })
      .pipe(
        map((raw) => this.normalizeUsers(raw, true)),
        mergeMap((users) => this.hydrateUsersNeedingNames(users)),
        catchError(() => of([]))
      );
  }

  private fetchUserById(userId: string): Observable<TimeLogUser | null> {
    return this.http
      .get<unknown>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.userById(userId)))
      .pipe(
        map((raw) => this.normalizeUser(raw, userId, true)),
        mergeMap((user) => {
          if (user) return of(user);
          return this.http
            .get<unknown>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.legacyUserById(userId)))
            .pipe(
              map((legacyRaw) => this.normalizeUser(legacyRaw, userId, true)),
              catchError(() => of(null))
            );
        }),
        catchError(() =>
          this.http
            .get<unknown>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.legacyUserById(userId)))
            .pipe(
              map((legacyRaw) => this.normalizeUser(legacyRaw, userId, true)),
              catchError(() => of(null))
            )
        )
      );
  }

  private fetchVehiclesWithFallback(
    projects: TimeLogProject[]
  ): Observable<{ vehicles: TimeLogVehicle[]; warning?: string }> {
    return this.http
      .get<unknown>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.vehicles))
      .pipe(
        map((raw) => this.normalizeVehicles(raw)),
        mergeMap((vehicles) => {
          const hasRelation = vehicles.some((v) => !!v.clientId || !!v.projectId);
          if (hasRelation || projects.length === 0) {
            return of({ vehicles: this.dedupeVehicles(vehicles) });
          }
          return this.tryBulkVehiclesByProjectIds(projects).pipe(
            mergeMap((bulkVehicles) => {
              const bulkHasRelation = bulkVehicles.some((v) => !!v.clientId || !!v.projectId);
              if (bulkHasRelation) {
                return of({ vehicles: this.dedupeVehicles(bulkVehicles) });
              }
              return this.fanOutVehiclesByProject(projects).pipe(
                map((res) => ({
                  vehicles: this.dedupeVehicles(res.vehicles),
                  warning:
                    res.failedCount > 0
                      ? `Vehicle lookup used project fan-out with partial failures (${res.failedCount} project request(s) failed).`
                      : undefined,
                }))
              );
            })
          );
        }),
        catchError(() =>
          this.fanOutVehiclesByProject(projects).pipe(
            map((res) => ({
              vehicles: this.dedupeVehicles(res.vehicles),
              warning:
                res.failedCount > 0
                  ? `Vehicle lookup fallback had partial failures (${res.failedCount} project request(s) failed).`
                  : 'Vehicle lookup fallback was used.',
            }))
          )
        )
      );
  }

  private tryBulkVehiclesByProjectIds(projects: TimeLogProject[]): Observable<TimeLogVehicle[]> {
    const projectIds = projects.map((p) => p.id).filter((id) => !!id);
    if (projectIds.length === 0) return of([]);
    return this.http
      .post<unknown>(
        buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.vehiclesByProjectIds),
        { projectIds }
      )
      .pipe(
        map((raw) => this.normalizeVehicles(raw)),
        catchError(() => of([]))
      );
  }

  private fanOutVehiclesByProject(
    projects: TimeLogProject[]
  ): Observable<{ vehicles: TimeLogVehicle[]; failedCount: number }> {
    if (projects.length === 0) {
      return of({ vehicles: [], failedCount: 0 });
    }

    return from(projects).pipe(
      mergeMap(
        (project) =>
          this.http
            .get<unknown>(
              buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.projectVehicles(project.id))
            )
            .pipe(
              retry({
                count: 2,
                delay: (_err, retryCount) => {
                  const base = retryCount === 1 ? 300 : 900;
                  const jitter = Math.floor(Math.random() * 120);
                  return timer(base + jitter);
                },
              }),
              map((raw) => ({
                failed: false,
                vehicles: this.normalizeVehicles(raw).map((v) => ({
                  ...v,
                  clientId: v.clientId ?? project.clientId,
                  projectId: v.projectId ?? project.id,
                })),
              })),
              catchError(() => of({ failed: true, vehicles: [] as TimeLogVehicle[] }))
            ),
        FAN_OUT_CONCURRENCY
      ),
      toArray(),
      map((results) => {
        const failedCount = results.filter((r) => r.failed).length;
        const vehicles = results.flatMap((r) => r.vehicles);
        return { vehicles, failedCount };
      })
    );
  }

  private dedupeVehicles(vehicles: TimeLogVehicle[]): TimeLogVehicle[] {
    const byId = new Map<string, TimeLogVehicle>();
    for (const vehicle of vehicles) {
      if (!vehicle.id) continue;
      const existing = byId.get(vehicle.id);
      if (!existing) {
        byId.set(vehicle.id, vehicle);
        continue;
      }
      byId.set(vehicle.id, {
        ...existing,
        ...vehicle,
        clientId: vehicle.clientId ?? existing.clientId,
        projectId: vehicle.projectId ?? existing.projectId,
      });
    }
    return Array.from(byId.values());
  }

  private extractItems(raw: unknown): any[] {
    if (Array.isArray(raw)) return raw;
    const obj = raw as any;
    if (Array.isArray(obj?.items)) return obj.items;
    if (Array.isArray(obj?.data?.items)) return obj.data.items;
    if (Array.isArray(obj?.data)) return obj.data;
    if (Array.isArray(obj?.result?.items)) return obj.result.items;
    if (Array.isArray(obj?.vehicles)) return obj.vehicles;
    if (Array.isArray(obj?.projects)) return obj.projects;
    return [];
  }

  private normalizeProjects(raw: unknown): TimeLogProject[] {
    return this.extractItems(raw)
      .map((item: any) => {
        const id = normalizeId(item?.id ?? item?.projectId ?? item?.projectID);
        const clientId = normalizeId(item?.clientId ?? item?.clientID);
        if (!id || !clientId) return null;
        return {
          id,
          name:
            String(item?.name ?? item?.projectName ?? item?.ProjectName ?? id).trim() || id,
          clientId,
          clientName: item?.clientName ?? item?.client,
        } as TimeLogProject;
      })
      .filter((p): p is TimeLogProject => !!p);
  }

  private normalizeVehicles(raw: unknown): TimeLogVehicle[] {
    return this.extractItems(raw)
      .map((item: any) => {
        const id = normalizeId(item?.id ?? item?.vehicleId ?? item?.vehicleID ?? item?.VehicleId);
        if (!id) return null;
        const fleetNumber =
          String(
            item?.fleetNumber ??
              item?.name ??
              item?.vehicleName ??
              item?.displayName ??
              id
          ).trim() || id;
        return {
          id,
          fleetNumber,
          clientId: normalizeOptionalId(item?.clientId ?? item?.clientID),
          projectId: normalizeOptionalId(item?.projectId ?? item?.projectID),
          description: item?.description,
        } as TimeLogVehicle;
      })
      .filter((v): v is TimeLogVehicle => !!v);
  }

  private normalizeUsers(raw: unknown, includeInactive: boolean = false): TimeLogUser[] {
    return this.extractItems(raw)
      .map((item: any) => this.normalizeUser(item, undefined, includeInactive))
      .filter((i): i is TimeLogUser => !!i);
  }

  private normalizeUser(
    raw: unknown,
    requestedId?: string,
    includeInactive: boolean = false
  ): TimeLogUser | null {
    const item = this.extractSingleItem(raw);
    if (!item) return null;

    const id = normalizeId(
      item?.userId ??
      item?.userID ??
      item?.UserId ??
      requestedId ??
      item?.id
    );
    const fullName = [item?.firstName, item?.lastName]
      .map((part) => String(part ?? '').trim())
      .filter((part) => !!part)
      .join(' ');
    const name = this.firstNonEmptyString(
      item?.username,
      item?.userName,
      item?.displayName,
      item?.fullName,
      fullName,
      item?.name,
      item?.email
    );
    if (!id || !name) return null;
    if (!includeInactive && item?.isActive === false) return null;
    return { id, name, email: item?.email } as TimeLogUser;
  }

  private hydrateUsersNeedingNames(users: TimeLogUser[]): Observable<TimeLogUser[]> {
    if (users.length === 0) return of([]);
    const needsHydrationIds = users
      .map((user) => user.id)
      .filter((id) => !this.hasMeaningfulUserName(this.userByIdCache.get(id) ?? users.find((u) => u.id === id), id));

    const uniqueIds = Array.from(new Set(needsHydrationIds));
    if (uniqueIds.length === 0) {
      users.forEach((user) => this.userByIdCache.set(user.id, user));
      return of(users);
    }

    return this.resolveUsersByIds(uniqueIds).pipe(
      map((hydratedUsers) => {
        const hydratedById = new Map(hydratedUsers.map((user) => [user.id, user]));
        const merged = users.map((user) => {
          const hydrated = hydratedById.get(user.id);
          if (!hydrated) return user;
          const shouldUseHydrated = this.hasMeaningfulUserName(hydrated, user.id);
          const nextUser = shouldUseHydrated
            ? {
                ...user,
                name: hydrated.name,
                email: hydrated.email ?? user.email,
              }
            : user;
          this.userByIdCache.set(nextUser.id, nextUser);
          return nextUser;
        });

        for (const user of users) {
          if (!this.userByIdCache.has(user.id)) {
            this.userByIdCache.set(user.id, user);
          }
        }
        return merged;
      })
    );
  }

  private shouldFetchUserById(userId: string): boolean {
    const cached = this.userByIdCache.get(userId);
    if (cached === undefined) return true;
    if (cached === null) return false;
    return !this.hasMeaningfulUserName(cached, userId);
  }

  private hasMeaningfulUserName(user: TimeLogUser | undefined, userId?: string): boolean {
    if (!user) return false;
    const name = String(user.name ?? '').trim();
    if (!name) return false;
    if (userId && name === userId) return false;
    if (this.isGuidLike(name)) return false;
    return true;
  }

  private isGuidLike(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(value ?? '').trim()
    );
  }

  private extractSingleItem(raw: unknown): any | null {
    if (!raw) return null;
    if (Array.isArray(raw)) return raw[0] ?? null;
    if (typeof raw !== 'object') return null;
    const listItems = this.extractItems(raw);
    if (listItems.length > 0) return listItems[0];
    return raw as any;
  }

  private firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) return text;
    }
    return '';
  }
}
