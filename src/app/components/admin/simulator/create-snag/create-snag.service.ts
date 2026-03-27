import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, delay, map, of, switchMap } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../shared/services/auth.service';
import { ClientDashboardService } from '../../../../shared/services/client-dashboard.service';
import { DashboardProjectsService } from '../../../../shared/services/dashboard-projects.service';
import { UserManagementService } from '../../../../shared/services/user-management.service';
import { getFirstDefinedValue, toOptionalText } from '../../../../shared/utils/api-data.utils';

export interface SnagProjectOption {
  id: number;
  name: string;
}

export interface SnagVehicleOption {
  id: number;
  name: string;
  projectId: number;
}

export interface SnagCategoryOption {
  id: number;
  name: string;
}

export interface SnagUserOption {
  id: number;
  name: string;
  email?: string;
  role?: string;
}

export interface CreateSnagPayload {
  projectId: number;
  vehicleId: number;
  userId: number;
  finalInspectionCategory: number;
  description: string;
  safetyCritical: boolean;
  repeater: boolean;
  images: File[];
}

export interface CreatedSnagResult {
  id: number;
  snagNumber: string;
  createdAt: string;
}

const MOCK_CURRENT_USER: SnagUserOption = {
  id: 7,
  name: 'John Inspector',
  email: 'john.inspector@buspulse.local',
  role: 'Inspector',
};

const MOCK_PROJECTS: SnagProjectOption[] = [
  { id: 101, name: 'LF75-40FT-D' },
  { id: 102, name: '54 Davies' },
  { id: 103, name: 'AppReview' },
  { id: 104, name: 'Arboc QC TransPo-23 FT' },
];


export const SNAG_CATEGORIES: SnagCategoryOption[] = [
  { id: 3,  name: 'UnderCarriage' },
  { id: 4,  name: 'Interior' },
  { id: 5,  name: 'Exterior' },
  { id: 6,  name: 'Roof' },
  { id: 7,  name: 'Function' },
  { id: 8,  name: 'Water' },
  { id: 9,  name: 'Road Test' },
  { id: 10, name: 'Engine' },
  { id: 12, name: 'Buybacks' },
  { id: 13, name: 'Final Walk' },
];

const MOCK_USERS: SnagUserOption[] = [
  { id: 301, name: 'Alice Brown',  email: 'alice@buspulse.local',  role: 'Inspector' },
  { id: 302, name: 'David Chen',   email: 'david@buspulse.local',  role: 'Inspector' },
  { id: 303, name: 'Maria Lopez',  email: 'maria@buspulse.local',  role: 'Lead Inspector' },
  { id: 304, name: 'Chris Evans',  email: 'chris@buspulse.local',  role: 'QA Manager' },
];

@Injectable({ providedIn: 'root' })
export class CreateSnagService {
  private readonly http                   = inject(HttpClient);
  private readonly authService            = inject(AuthService);
  private readonly clientDashboardService = inject(ClientDashboardService);
  private readonly dashboardProjectsService = inject(DashboardProjectsService);
  private readonly userManagementService  = inject(UserManagementService);
  private readonly apiBaseUrl             = environment.apiBaseUrl;

  getCurrentUser(): SnagUserOption {
    const u = this.authService.currentUserValue;
    return {
      id:    Number(u?.userId ?? MOCK_CURRENT_USER.id) || MOCK_CURRENT_USER.id,
      name:  String(u?.username ?? MOCK_CURRENT_USER.name).trim() || MOCK_CURRENT_USER.name,
      email: toOptionalText(u?.email) ?? MOCK_CURRENT_USER.email,
      role:  toOptionalText(u?.role) ?? MOCK_CURRENT_USER.role,
    };
  }

  isAdmin(): boolean {
    const role = String(this.authService.currentUserValue?.role ?? '').trim().toLowerCase();
    return role === 'admin' || role === 'superadmin';
  }

  getProjects(): Observable<SnagProjectOption[]> {
    const clientId = this.scopedClientId();
    return this.clientDashboardService.getProjects({ clientId, includeClosed: true, page: 1, pageSize: 10000 }).pipe(
      map((r) => this.mapProjects(r)),
      map((items) => items.length ? items : [...MOCK_PROJECTS]),
      catchError(() =>
        this.dashboardProjectsService.getProjectOptions({ clientId, includeClosed: true, includeAllOption: false }).pipe(
          map((ps) => this.sortByName(
            ps.filter(p => p.id && p.name).map(p => ({ id: Number(p.id), name: p.name }))
          )),
          map((items) => items.length ? items : [...MOCK_PROJECTS]),
          catchError(() => this.mock(MOCK_PROJECTS)),
        ),
      ),
    );
  }

  getVehiclesByProject(projectId: number): Observable<SnagVehicleOption[]> {
    if (!projectId) return of([]);
    const clientId = this.scopedClientId();
    const userId   = this.getCurrentUser().id;

    const allVehiclesFallback = (): Observable<SnagVehicleOption[]> =>
      this.dashboardProjectsService.getAllVehicleOptionsResult({ clientId, userId, includeAllOption: false }).pipe(
        map((result) => this.mapDashboardVehicles(result.options, projectId)),
        map((items) => items.length ? items : []),
        catchError(() => of([])),
      );

    return this.clientDashboardService.getProjectVehicles(projectId, { clientId, userId, page: 1, pageSize: 10000 }).pipe(
      map((r) => this.mapVehicles(r, projectId)),
      catchError(() =>
        this.dashboardProjectsService.getVehicleOptionsByProjectResult(String(projectId), {
          clientId, userId, includeAllOption: false, page: 1, pageSize: 10000,
        }).pipe(
          map((result) => this.mapDashboardVehicles(result.options, projectId)),
          catchError(() => of([])),
        ),
      ),
      switchMap((items) => items.length ? of(items) : allVehiclesFallback()),
    );
  }

  getCategories(): SnagCategoryOption[] {
    return SNAG_CATEGORIES;
  }

  getInspectors(): Observable<SnagUserOption[]> {
    return this.userManagementService.getUsers({ page: 1, pageSize: 10000, role: '', clientId: '', manufacturerId: '' }).pipe(
      map((result) =>
        (result.items ?? [])
          .map((u): SnagUserOption | null => {
            const id   = Number(u.id ?? 0);
            const name = String(u.username || u.name || '').trim();
            return id > 0 && name ? { id, name, email: toOptionalText(u.email), role: toOptionalText(u.role) } : null;
          })
          .filter((u): u is SnagUserOption => u !== null),
      ),
      map((items) => this.withCurrentUser(items.length ? this.sortByName(items) : [...MOCK_USERS])),
      catchError(() => this.mock(this.withCurrentUser(MOCK_USERS))),
    );
  }

  createSnag(payload: CreateSnagPayload): Observable<CreatedSnagResult> {
    const form = new FormData();
    form.set('projectId',               String(payload.projectId));
    form.set('vehicleId',               String(payload.vehicleId));
    form.set('userId',                  String(payload.userId));
    form.set('finalInspectionCategory', String(payload.finalInspectionCategory));
    form.set('description',             payload.description);
    form.set('safetyCritical',          String(payload.safetyCritical));
    form.set('repeater',                String(payload.repeater));
    form.set('createdAt',               new Date().toISOString());
    payload.images.forEach((file) => form.append('images', file, file.name));

    return this.http.post<unknown>(`${this.apiBaseUrl}/Snags`, form).pipe(
      map((r) => this.mapCreatedSnag(r)),
      catchError(() => this.mock(this.buildMockSnag())),
    );
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private scopedClientId(): number | undefined {
    const u    = this.authService.currentUserValue;
    const role = String(u?.role ?? '').trim().toLowerCase();
    if (!u || role === 'admin' || role === 'superadmin') return undefined;
    return Number.isFinite(u.clientId) && u.clientId > 0 ? u.clientId : undefined;
  }

  private mapProjects(response: unknown): SnagProjectOption[] {
    return this.sortByName(
      this.extractItems(response)
        .map((item): SnagProjectOption | null => {
          const id   = this.pos(getFirstDefinedValue(item, ['id', 'projectId', 'ProjectId']));
          const name = toOptionalText(getFirstDefinedValue(item, ['name', 'projectName', 'ProjectName', 'title']));
          return id && name ? { id, name } : null;
        })
        .filter((p): p is SnagProjectOption => p !== null),
    );
  }

  private mapVehicles(response: unknown, projectId: number): SnagVehicleOption[] {
    return this.sortByName(
      this.extractItems(response)
        .map((item): SnagVehicleOption | null => {
          const id   = this.pos(getFirstDefinedValue(item, ['id', 'vehicleId', 'VehicleId']));
          const name = toOptionalText(getFirstDefinedValue(item, ['name', 'vehicleName', 'VehicleName', 'fleetNumber', 'displayName']));
          return id && name ? { id, name, projectId } : null;
        })
        .filter((v): v is SnagVehicleOption => v !== null),
    );
  }

  private mapDashboardVehicles(vehicles: any[], projectId: number): SnagVehicleOption[] {
    return this.sortByName(
      (vehicles ?? [])
        .map((v): SnagVehicleOption | null => {
          const id   = this.pos(v.id);
          const name = toOptionalText(v.name);
          return id && name ? { id, name, projectId } : null;
        })
        .filter((v): v is SnagVehicleOption => v !== null),
    );
  }

  private mapCreatedSnag(response: unknown): CreatedSnagResult {
    if (response && typeof response === 'object') {
      const id         = this.pos(getFirstDefinedValue(response, ['id', 'snagId']));
      const snagNumber = toOptionalText(getFirstDefinedValue(response, ['snagNumber', 'snagNo', 'uniqueId']));
      const createdAt  = toOptionalText(getFirstDefinedValue(response, ['createdAt', 'createdDate', 'dateCreated']));
      if (id && snagNumber && createdAt) return { id, snagNumber, createdAt };
    }
    return this.buildMockSnag();
  }

  private buildMockSnag(): CreatedSnagResult {
    const year   = new Date().getFullYear();
    const random = Math.floor(100000 + Math.random() * 900000);
    return {
      id:          Math.floor(10000 + Math.random() * 90000),
      snagNumber:  `SN-${year}-${random}`,
      createdAt:   new Date().toISOString(),
    };
  }

  private extractItems(response: unknown): any[] {
    if (Array.isArray(response)) return response;
    if (!response || typeof response !== 'object') return [];
    const obj  = response as Record<string, unknown>;
    const data = obj['data'] as Record<string, unknown> | undefined;
    return (
      [obj['$values'], obj['items'], obj['results'], obj['data'], obj['value'], obj['payload'],
       data?.['items'], data?.['results'], data?.['$values']].find(Array.isArray) as any[]
    ) ?? [];
  }

  private pos(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  private sortByName<T extends { name: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }

  private withCurrentUser(items: SnagUserOption[]): SnagUserOption[] {
    const me = this.getCurrentUser();
    return items.some(u => u.id === me.id) ? items : this.sortByName([...items, me]);
  }

  private mock<T>(value: T): Observable<T> {
    return of(value).pipe(delay(200));
  }
}
