import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, delay, map, of, switchMap } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../shared/services/auth.service';
import { ClientDashboardService } from '../../../../shared/services/client-dashboard.service';
import { DashboardProjectOption, DashboardProjectsService, DashboardVehicleOption } from '../../../../shared/services/dashboard-projects.service';
import { UserManagementService } from '../../../../shared/services/user-management.service';
import { getFirstDefinedValue, toOptionalText } from '../../../../shared/utils/api-data.utils';

export interface ProjectOption {
  id: number;
  name: string;
  clientId: number;
  clientName: string;
}

export interface VehicleOption {
  id: number;
  name: string;
  projectId: number;
}

export interface StationOption {
  id: number;
  name: string;
}

export interface DefectTypeOption {
  id: number;
  name: string;
}

export interface DefectLocationOption {
  id: number;
  name: string;
}

export interface UserOption {
  id: number;
  name: string;
  email?: string;
  role?: string;
}

export interface CreateTicketPayload {
  ticketDescription: string;
  projectId: number;
  vehicleId: number;
  stationId: number;
  defectTypeId: number;
  defectLocationId: number;
  assignedToId: number;
  safetyCritical: boolean;
  repeater: boolean;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  clientId: number;
  assignedById: number;
  resolvedDate?: string;
  attachments: File[];
}

export interface CreatedTicketResult {
  id: number;
  ticketNumber: string;
  createdDate: string;
  lastUpdate: string;
  resolvedDate?: string;
}

const MOCK_CURRENT_USER: UserOption = {
  id: 7,
  name: 'John Inspector',
  email: 'john.inspector@buspulse.local',
  role: 'Inspector',
};

const MOCK_PROJECTS: ProjectOption[] = [
  { id: 101, name: 'LF75-40FT-D', clientId: 501, clientName: 'Toronto Transit Group' },
  { id: 102, name: '54 Davies', clientId: 501, clientName: 'Toronto Transit Group' },
  { id: 103, name: 'AppReview', clientId: 502, clientName: 'Metro Transit Services' },
  { id: 104, name: 'Arboc QC TransPo-23 FT', clientId: 503, clientName: 'Quebec Fleet Operations' },
];

const MOCK_VEHICLES: VehicleOption[] = [
  { id: 2001, name: 'Bus 1107', projectId: 101 },
  { id: 2002, name: 'Bus 1108', projectId: 101 },
  { id: 2003, name: 'Bus 1201', projectId: 102 },
  { id: 2004, name: 'Bus 1305', projectId: 103 },
  { id: 2005, name: 'Bus 1402', projectId: 104 },
];

const MOCK_STATIONS: StationOption[] = [
  { id: 1, name: 'Station 01 - Chassis Prep' },
  { id: 2, name: 'Station 02 - Air Systems' },
  { id: 3, name: 'Station 03 - Cab Cut Out' },
  { id: 4, name: 'Station 04 - Frame and Shelling' },
  { id: 5, name: 'Station 05 - Rough Electric' },
  { id: 6, name: 'Station 20 - Inspector Testing & PDI' },
];

const MOCK_DEFECT_TYPES: DefectTypeOption[] = [
  { id: 11, name: 'Electrical' },
  { id: 12, name: 'Mechanical' },
  { id: 13, name: 'Cosmetic' },
  { id: 14, name: 'Body' },
  { id: 15, name: 'Accessibility' },
  { id: 16, name: 'Safety Equipment' },
];

const MOCK_DEFECT_LOCATIONS: DefectLocationOption[] = [
  { id: 21, name: "Driver's Area" },
  { id: 22, name: 'Wheelchair Ramp and Accessible Features' },
  { id: 23, name: 'Vehicle Interior' },
  { id: 24, name: 'Vehicle Exterior' },
  { id: 25, name: 'Engine Compartment' },
  { id: 26, name: 'Front Door Area' },
  { id: 27, name: 'Rear Door Area' },
  { id: 28, name: 'Roof' },
];

const MOCK_USERS: UserOption[] = [
  { id: 301, name: 'Alice Brown', email: 'alice@buspulse.local', role: 'Inspector' },
  { id: 302, name: 'David Chen', email: 'david@buspulse.local', role: 'Inspector' },
  { id: 303, name: 'Maria Lopez', email: 'maria@buspulse.local', role: 'Lead Inspector' },
  { id: 304, name: 'Chris Evans', email: 'chris@buspulse.local', role: 'QA Manager' },
];

@Injectable({ providedIn: 'root' })
export class CreateTicketService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly clientDashboardService = inject(ClientDashboardService);
  private readonly dashboardProjectsService = inject(DashboardProjectsService);
  private readonly userManagementService = inject(UserManagementService);
  private readonly apiBaseUrl = environment.apiBaseUrl;

  getCurrentUser(): UserOption {
    const currentUser = this.authService.currentUserValue;
    return {
      id: Number(currentUser?.userId ?? MOCK_CURRENT_USER.id) || MOCK_CURRENT_USER.id,
      name: String(currentUser?.username ?? MOCK_CURRENT_USER.name).trim() || MOCK_CURRENT_USER.name,
      email: toOptionalText(currentUser?.email) ?? MOCK_CURRENT_USER.email,
      role: this.toDisplayRole(currentUser?.role) ?? MOCK_CURRENT_USER.role,
    };
  }

  getProjects(): Observable<ProjectOption[]> {
    const clientId = this.getScopedClientId();

    return this.clientDashboardService.getProjects({
      clientId,
      includeClosed: true,
      page: 1,
      pageSize: 10000,
    }).pipe(
      map((response) => this.mapProjects(response)),
      map((items) => items.length ? items : [...MOCK_PROJECTS]),
      catchError(() =>
        this.dashboardProjectsService.getProjectOptions({
          clientId,
          includeClosed: true,
          includeAllOption: false,
          page: 1,
          pageSize: 10000,
        }).pipe(
          map((projects) => this.mapDashboardProjects(projects)),
          map((items) => items.length ? items : [...MOCK_PROJECTS]),
          catchError(() => this.returnMock(MOCK_PROJECTS)),
        ),
      ),
    );
  }

  getVehiclesByProject(projectId: number): Observable<VehicleOption[]> {
    if (!projectId) {
      return of([]);
    }

    const clientId = this.getScopedClientId();
    const userId = this.getCurrentUser().id;

    const resolveAllVehiclesFallback = (): Observable<VehicleOption[]> =>
      this.dashboardProjectsService.getAllVehicleOptionsResult({
        clientId,
        userId,
        includeAllOption: false,
        page: 1,
        pageSize: 10000,
      }).pipe(
        map((result) => this.mapDashboardVehicles(result.options, projectId)),
        map((items) => {
          if (items.length) {
            return items;
          }

          const mockByProject = this.filterMockVehicles(projectId);
          return mockByProject.length ? mockByProject : [...MOCK_VEHICLES];
        }),
        catchError(() => {
          const mockByProject = this.filterMockVehicles(projectId);
          return this.returnMock(mockByProject.length ? mockByProject : MOCK_VEHICLES);
        }),
      );

    return this.clientDashboardService.getProjectVehicles(projectId, {
      clientId,
      userId,
      page: 1,
      pageSize: 10000,
    }).pipe(
      map((response) => this.mapVehicles(response, projectId)),
      catchError(() =>
        this.dashboardProjectsService.getVehicleOptionsByProjectResult(String(projectId), {
          clientId,
          userId,
          includeAllOption: false,
          page: 1,
          pageSize: 10000,
        }).pipe(
          map((result) => this.mapDashboardVehicles(result.options, projectId)),
          catchError(() => of([])),
        ),
      ),
      switchMap((items) => {
        if (items.length) {
          return of(items);
        }

        return resolveAllVehiclesFallback();
      }),
    );
  }

  getStations(): Observable<StationOption[]> {
    return this.http.get<unknown>(`${this.apiBaseUrl}/vehicle-reports/stations`).pipe(
      map((response) => this.mapStations(response)),
      map((items) => items.length ? items : [...MOCK_STATIONS]),
      catchError(() => this.returnMock(MOCK_STATIONS)),
    );
  }

  getDefectTypes(): Observable<DefectTypeOption[]> {
    const clientId = this.getScopedClientId();
    return this.clientDashboardService.getDefectTypes({ clientId }).pipe(
      map((response) => this.mapDefectTypes(response)),
      map((items) => items.length ? items : [...MOCK_DEFECT_TYPES]),
      catchError(() => this.returnMock(MOCK_DEFECT_TYPES)),
    );
  }

  getDefectLocations(): Observable<DefectLocationOption[]> {
    return this.http.get<unknown>(`${this.apiBaseUrl}/DefectLocations`).pipe(
      map((response) => this.mapDefectLocations(response)),
      map((items) => items.length ? items : [...MOCK_DEFECT_LOCATIONS]),
      catchError(() => this.returnMock(MOCK_DEFECT_LOCATIONS)),
    );
  }

  getAssignableUsers(): Observable<UserOption[]> {
    return this.userManagementService.getUsers({
      page: 1,
      pageSize: 10000,
      role: '',
      clientId: '',
      manufacturerId: '',
    }).pipe(
      map((result) =>
        (result.items ?? [])
          .map((user) => ({
            id: Number(user.id ?? 0),
            name: String(user.username || user.name || '').trim(),
            email: toOptionalText(user.email),
            role: toOptionalText(user.role),
          }))
          .filter((user) => user.id > 0 && user.name.length > 0),
      ),
      map((items) => this.withCurrentUser(items.length ? this.sortByName(items) : [...MOCK_USERS])),
      catchError(() =>
        this.http.get<unknown>(`${this.apiBaseUrl}/Inspectors`).pipe(
          map((response) => this.mapUsers(response)),
          map((items) => this.withCurrentUser(items.length ? items : [...MOCK_USERS])),
          catchError(() => this.returnMock(this.withCurrentUser(MOCK_USERS))),
        ),
      ),
    );
  }

  createTicket(payload: CreateTicketPayload): Observable<CreatedTicketResult> {
    const formData = new FormData();
    formData.set('ticketDescription', payload.ticketDescription);
    formData.set('projectId', String(payload.projectId));
    formData.set('vehicleId', String(payload.vehicleId));
    formData.set('stationId', String(payload.stationId));
    formData.set('defectTypeId', String(payload.defectTypeId));
    formData.set('defectLocationId', String(payload.defectLocationId));
    formData.set('assignedToId', String(payload.assignedToId));
    formData.set('safetyCritical', String(payload.safetyCritical));
    formData.set('repeater', String(payload.repeater));
    formData.set('priority', payload.priority);
    formData.set('status', payload.status);
    formData.set('clientId', String(payload.clientId));
    formData.set('assignedById', String(payload.assignedById));

    if (payload.resolvedDate) {
      formData.set('resolvedDate', payload.resolvedDate);
    }

    payload.attachments.forEach((file) => formData.append('attachments', file, file.name));

    return this.http.post<unknown>(`${this.apiBaseUrl}/Tickets`, formData).pipe(
      map((response) => this.mapCreatedTicket(response, payload)),
      catchError(() => this.returnMock(this.buildMockCreatedTicket(payload))),
    );
  }

  private getScopedClientId(): number | undefined {
    const currentUser = this.authService.currentUserValue;
    const role = String(currentUser?.role ?? '').trim().toLowerCase();
    if (!currentUser || role === 'admin' || role === 'superadmin') {
      return undefined;
    }

    return Number.isFinite(currentUser.clientId) && currentUser.clientId > 0
      ? currentUser.clientId
      : undefined;
  }

  private mapProjects(response: unknown): ProjectOption[] {
    return this.sortByName(
      this.extractItems(response)
        .map((item) => {
          const id = this.toPositiveNumber(getFirstDefinedValue(item, ['id', 'projectId', 'ProjectId']));
          const name = toOptionalText(getFirstDefinedValue(item, ['name', 'projectName', 'ProjectName', 'title']));
          if (!id || !name) {
            return null;
          }

          return {
            id,
            name,
            clientId: this.toPositiveNumber(getFirstDefinedValue(item, ['clientId', 'ClientId', 'client.id'])) ?? 0,
            clientName: toOptionalText(getFirstDefinedValue(item, ['clientName', 'ClientName', 'client.name'])) ?? 'Unassigned Client',
          } satisfies ProjectOption;
        })
        .filter((project): project is ProjectOption => project !== null),
    );
  }

  private mapDashboardProjects(projects: DashboardProjectOption[]): ProjectOption[] {
    return this.sortByName(
      (projects ?? [])
        .map((project) => {
          const id = this.toPositiveNumber(project.id);
          const name = toOptionalText(project.name);
          if (!id || !name) {
            return null;
          }

          const mockProject = MOCK_PROJECTS.find((item) => item.id === id);
          return {
            id,
            name,
            clientId: mockProject?.clientId ?? 0,
            clientName: mockProject?.clientName ?? 'Unassigned Client',
          } satisfies ProjectOption;
        })
        .filter((project): project is ProjectOption => project !== null),
    );
  }

  private mapVehicles(response: unknown, projectId: number): VehicleOption[] {
    return this.sortByName(
      this.extractItems(response)
        .map((item) => {
          const id = this.toPositiveNumber(getFirstDefinedValue(item, ['id', 'vehicleId', 'VehicleId']));
          const name = toOptionalText(getFirstDefinedValue(item, ['name', 'vehicleName', 'VehicleName', 'fleetNumber', 'displayName']));
          if (!id || !name) {
            return null;
          }

          return {
            id,
            name,
            projectId: this.toPositiveNumber(getFirstDefinedValue(item, ['projectId', 'ProjectId'])) ?? projectId,
          } satisfies VehicleOption;
        })
        .filter((vehicle): vehicle is VehicleOption => vehicle !== null),
    );
  }

  private mapDashboardVehicles(vehicles: DashboardVehicleOption[], projectId: number): VehicleOption[] {
    return this.sortByName(
      (vehicles ?? [])
        .map((vehicle) => {
          const id = this.toPositiveNumber(vehicle.id);
          const name = toOptionalText(vehicle.name);
          if (!id || !name) {
            return null;
          }

          return { id, name, projectId } satisfies VehicleOption;
        })
        .filter((vehicle): vehicle is VehicleOption => vehicle !== null),
    );
  }

  private mapStations(response: unknown): StationOption[] {
    return this.sortByName(
      this.extractItems(response)
        .map((item) => {
          const id = this.toPositiveNumber(getFirstDefinedValue(item, ['id', 'stationId', 'StationId']));
          const name = toOptionalText(getFirstDefinedValue(item, ['name', 'stationName', 'StationName']));
          if (!id || !name) {
            return null;
          }

          return { id, name } satisfies StationOption;
        })
        .filter((station): station is StationOption => station !== null),
    );
  }

  private mapDefectTypes(response: unknown): DefectTypeOption[] {
    return this.sortByName(
      this.extractItems(response)
        .map((item) => {
          const id = this.toPositiveNumber(getFirstDefinedValue(item, ['id', 'defactTypeId', 'defectTypeId']));
          const name = toOptionalText(getFirstDefinedValue(item, ['name', 'defactTypeName', 'defectTypeName', 'defacttype', 'type']));
          if (!id || !name) {
            return null;
          }

          return { id, name } satisfies DefectTypeOption;
        })
        .filter((defectType): defectType is DefectTypeOption => defectType !== null),
    );
  }

  private mapDefectLocations(response: unknown): DefectLocationOption[] {
    return this.sortByName(
      this.extractItems(response)
        .map((item) => {
          const id = this.toPositiveNumber(getFirstDefinedValue(item, ['id', 'defectLocationId', 'DefectLocationId']));
          const name = toOptionalText(getFirstDefinedValue(item, ['name', 'defectLocationName', 'DefectLocationName', 'location']));
          if (!id || !name) {
            return null;
          }

          return { id, name } satisfies DefectLocationOption;
        })
        .filter((defectLocation): defectLocation is DefectLocationOption => defectLocation !== null),
    );
  }

  private mapUsers(response: unknown): UserOption[] {
    const users: UserOption[] = this.extractItems(response)
      .map((item): UserOption | null => {
        const id = this.toPositiveNumber(getFirstDefinedValue(item, ['id', 'inspectorId', 'userId']));
        const name = toOptionalText(getFirstDefinedValue(item, ['name', 'inspectorName', 'fullName', 'username', 'userName']));
        if (!id || !name) {
          return null;
        }

        return {
          id,
          name,
          email: toOptionalText(getFirstDefinedValue(item, ['email', 'emailAddress'])),
          role: this.toDisplayRole(getFirstDefinedValue(item, ['role', 'roleName'])),
        } as UserOption;
      })
      .filter((user): user is UserOption => user !== null);

    return this.sortByName(users);
  }

  private mapCreatedTicket(response: unknown, payload: CreateTicketPayload): CreatedTicketResult {
    if (response && typeof response === 'object') {
      const id = this.toPositiveNumber(getFirstDefinedValue(response, ['id', 'ticketId']));
      const ticketNumber = toOptionalText(getFirstDefinedValue(response, ['ticketNumber', 'uniqueId']));
      const createdDate = toOptionalText(getFirstDefinedValue(response, ['createdDate', 'createdAt', 'dateCreated']));
      const lastUpdate = toOptionalText(getFirstDefinedValue(response, ['lastUpdate', 'updatedDate', 'updatedAt']));
      const resolvedDate = toOptionalText(getFirstDefinedValue(response, ['resolvedDate', 'closedDate']));

      if (id && ticketNumber && createdDate && lastUpdate) {
        return {
          id,
          ticketNumber,
          createdDate,
          lastUpdate,
          resolvedDate: resolvedDate ?? payload.resolvedDate,
        };
      }
    }

    return this.buildMockCreatedTicket(payload);
  }

  private buildMockCreatedTicket(payload: CreateTicketPayload): CreatedTicketResult {
    const now = new Date();
    const year = now.getFullYear();
    const random = Math.floor(100000 + Math.random() * 900000);
    const isoNow = now.toISOString();

    return {
      id: Math.floor(10000 + Math.random() * 90000),
      ticketNumber: `T-${year}-${random}`,
      createdDate: isoNow,
      lastUpdate: isoNow,
      resolvedDate: payload.status === 'resolved' || payload.status === 'closed'
        ? (payload.resolvedDate || isoNow)
        : undefined,
    };
  }

  private extractItems(response: unknown): any[] {
    if (Array.isArray(response)) {
      return response;
    }
    if (!response || typeof response !== 'object') {
      return [];
    }

    const objectResponse = response as Record<string, unknown>;
    const data = objectResponse['data'] as Record<string, unknown> | undefined;
    const value = objectResponse['value'] as Record<string, unknown> | undefined;

    const candidates = [
      objectResponse['$values'],
      objectResponse['items'],
      objectResponse['results'],
      objectResponse['data'],
      objectResponse['value'],
      objectResponse['payload'],
      data?.['items'],
      data?.['results'],
      data?.['data'],
      data?.['$values'],
      value?.['items'],
      value?.['$values'],
    ];

    return (candidates.find(Array.isArray) as any[]) ?? [];
  }

  private toPositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private sortByName<T extends { name: string }>(items: T[]): T[] {
    return [...items].sort((left, right) => left.name.localeCompare(right.name));
  }

  private withCurrentUser(items: UserOption[]): UserOption[] {
    const currentUser = this.getCurrentUser();
    const hasCurrentUser = items.some((item) => item.id === currentUser.id);
    return hasCurrentUser ? items : this.sortByName([...items, currentUser]);
  }

  private filterMockVehicles(projectId: number): VehicleOption[] {
    return MOCK_VEHICLES.filter((vehicle) => vehicle.projectId === projectId);
  }

  private returnMock<T>(value: T): Observable<T> {
    return of(value).pipe(delay(250));
  }

  private toDisplayRole(value: unknown): string | undefined {
    const role = toOptionalText(value);
    if (!role) {
      return undefined;
    }

    return role
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }
}
