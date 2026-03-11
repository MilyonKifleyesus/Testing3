import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ClientService } from '../../services/client.service';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import {
  DashboardProjectOption,
  DashboardProjectsService,
  DashboardVehicleOption,
  DashboardVehicleOptionsResult,
} from '../../services/dashboard-projects.service';
import { buildPaginationItems, PAGINATION_ELLIPSIS } from '../../utils/pagination.utils';
import { map, Observable, take } from 'rxjs';
import { UserManagementService } from '../../services/user-management.service';

interface TicketRow {
  id: string | number;
  ticketNumber?: string;
  ticketDescription?: string;
  description?: string;
  safetyCritical: boolean;
  defectTypeId?: number;
  stationId?: number;
  ticketCreatedDate?: string;
  createdDate?: string;
  ticketUpdatedDate?: string;
  userId?: number;
  ticketAssignedBy?: number;
  assignedBy?: string;
  assignedTo?: string;
  projectId?: string | number;
  vehicleId?: string | number;
  inspectionTaskId?: number;
  deleted: boolean;
  priority?: number;
  statusTicketId?: number;
  uniqueId?: string;
  lastUpdate?: string;
  clientComment?: string;
  snagId?: number;
  repeater: boolean;
  hasImages?: boolean;
  project?: string;
  vehicle?: string;
  defectType?: string;
  station?: string;
  status?: string;
  client?: string;
  defectLocation?: string;
  selected?: boolean;
}

interface Column {
  key: string;
  label: string;
  visible: boolean;
}

type PaginationItem = number;

@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tickets.component.html',
  styleUrl: './tickets.component.scss'
})
export class TicketsComponent implements OnInit {
  readonly paginationEllipsis = PAGINATION_ELLIPSIS;
  showColumnMenu = false;
  sortColumn: keyof TicketRow | '' = '';
  sortDirection: 'asc' | 'desc' = 'asc';
  tickets: TicketRow[] = [];
  filteredTickets: TicketRow[] = [];
  private vehicleClientIdMap = new Map<string, string>();
  private hasClientNameMap = false;
  isLoadingTickets = false;
  private userNameMap = new Map<number, string>();
  currentPage = 1;
  readonly pageSize = 10;

  clientOptions: Array<{ id: string; name: string }> = [{ id: 'all', name: 'All Clients' }];
  projectOptions: DashboardProjectOption[] = [{ id: 'all', name: 'All Projects' }];
  vehicleOptions: DashboardVehicleOption[] = [{ id: 'all', name: 'Select project first' }];

  columns: Column[] = [
    { key: 'id', label: 'Ticket #', visible: true },
    { key: 'client', label: 'Client', visible: true },
    { key: 'status', label: 'Status', visible: true },
    { key: 'project', label: 'Project', visible: true },
    { key: 'vehicle', label: 'Vehicle', visible: true },
    { key: 'safetyCritical', label: 'Safety Critical', visible: true },
    { key: 'repeater', label: 'Repeater', visible: true },
    { key: 'createdDate', label: 'Created Date', visible: true },
    { key: 'defectType', label: 'Defect Type', visible: true },
    { key: 'defectLocation', label: 'Defect Location', visible: true },
    { key: 'description', label: 'Description', visible: true },
    { key: 'hasImages', label: 'Images', visible: true },
    { key: 'assignedBy', label: 'Assign By', visible: true },
    { key: 'assignedTo', label: 'Assign To', visible: true },
    { key: 'station', label: 'Station', visible: true }
  ];

  filters = {
    client: 'all',
    project: 'all',
    vehicle: 'all',
    search: ''
  };

  private initialProjectIdFromRoute: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private dashboardProjectsService: DashboardProjectsService,
    private authService: AuthService,
    private clientService: ClientService,
    private clientDashboardService: ClientDashboardService,
    private userManagementService: UserManagementService,
  ) {}

  ngOnInit(): void {
    this.initialProjectIdFromRoute = this.normalizeRouteProjectId(
      this.route.snapshot.queryParamMap.get('projectId'),
    );
    this.loadUsers();
    this.loadClientNames();
    this.loadClientFilterOptions();
  }

  get isAdminRole(): boolean {
    return this.authService.hasRole(['admin', 'superadmin']);
  }

  get showClientFilter(): boolean {
    return this.isAdminRole;
  }

  private getCurrentUserClientId(): number | undefined {
    const clientId = this.authService.currentUserValue?.clientId;
    return Number.isFinite(clientId) && Number(clientId) > 0 ? Number(clientId) : undefined;
  }

  private loadClientFilterOptions(): void {
    if (!this.isAdminRole) {
      const userClientId = this.getCurrentUserClientId();
      this.filters.client = userClientId ? String(userClientId) : 'all';
      this.clientOptions = userClientId
        ? [{ id: String(userClientId), name: 'My Client' }]
        : [];
      this.initializeDataForCurrentClient();
      return;
    }

    this.clientService.getClients().subscribe({
      next: (clients) => {
        const mapped = clients
          .map((client) => ({
            id: String(client.id ?? '').trim(),
            name: String(client.name ?? '').trim(),
          }))
          .filter((client) => client.id && client.name)
          .sort((left, right) => left.name.localeCompare(right.name));

        this.clientOptions = [{ id: 'all', name: 'All Clients' }, ...mapped];
        this.filters.client = 'all';
        this.initializeDataForCurrentClient();
      },
      error: () => {
        this.clientOptions = [{ id: 'all', name: 'All Clients' }];
        this.filters.client = 'all';
        this.initializeDataForCurrentClient();
      },
    });
  }

  private initializeDataForCurrentClient(): void {
    this.loadVehicleClientIds();
    this.loadProjectsFromApi(true, true);
  }

  private getEffectiveClientId(): number | undefined {
    if (!this.isAdminRole) {
      return this.getCurrentUserClientId();
    }

    if (!this.filters.client || this.filters.client === 'all') {
      return undefined;
    }

    const parsed = Number(this.filters.client);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  onClientFilterChange(clientId: string): void {
    if (!this.isAdminRole) return;

    this.filters.client = String(clientId ?? '').trim() || 'all';
    this.filters.project = 'all';
    this.filters.vehicle = 'all';
    this.resetVehiclesDropdown();
    this.loadVehicleClientIds();
    this.loadProjectsFromApi(true, true);
  }

  private ensureRoleScopedFilters(): void {
    if (this.isAdminRole) {
      return;
    }

    const clientId = this.getCurrentUserClientId();
    this.filters.client = clientId ? String(clientId) : 'all';
  }

  private loadUsers(): void {
    this.userManagementService.getUsers({ page: 1, pageSize: 500, role: '', clientId: '0', manufacturerId: '0' })
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          result.items.forEach((user) => {
            const display = user.username !== 'N/A' ? user.username : user.name;
            this.userNameMap.set(user.id, display);
          });
          this.resolveUserNamesOnTickets();
        },
        error: () => {},
      });
  }

  private resolveUserNamesOnTickets(): void {
    if (!this.tickets.length || this.userNameMap.size === 0) return;

    this.tickets = this.tickets.map((ticket) => {
      const assignedByResolved = this.resolveUserDisplay(ticket.ticketAssignedBy, ticket.assignedBy);
      const assignedToResolved = this.resolveUserDisplay(ticket.userId, ticket.assignedTo);
      return { ...ticket, assignedBy: assignedByResolved, assignedTo: assignedToResolved };
    });

    this.applyFilters();
  }

  private resolveUserDisplay(numericId: number | undefined, fallback: string | undefined): string {
    if (numericId && this.userNameMap.has(numericId)) {
      return this.userNameMap.get(numericId)!;
    }
    const parsed = Number(fallback);
    if (fallback && Number.isFinite(parsed) && parsed > 0 && this.userNameMap.has(parsed)) {
      return this.userNameMap.get(parsed)!;
    }
    return fallback ?? '-';
  }

  private loadClientNames(): void {
    this.clientService.getClientNameMap().subscribe({
      next: () => {
        this.hasClientNameMap = true;
        this.applyClientNamesToTickets();
      },
      error: () => {
        this.hasClientNameMap = false;
      },
    });
  }

  private resolveClientDisplay(value: unknown): string {
    if (value === undefined || value === null) return '-';
    const text = String(value).trim();
    if (!text) return '-';
    if (!this.hasClientNameMap) return text;
    return this.clientService.resolveClientName(text, text);
  }

  private applyClientNamesToTickets(): void {
    if (!this.tickets.length || !this.hasClientNameMap) return;

    this.tickets = this.tickets.map((ticket) => ({
      ...ticket,
      client: this.resolveClientDisplay(ticket.client),
    }));

    this.applyFilters();
  }

  private loadVehicleClientIds(): void {
    const clientId = this.getEffectiveClientId();

    this.clientDashboardService
      .getVehicles({ clientId, page: 1, pageSize: 5000 })
      .subscribe({
        next: (response: unknown) => {
          const items = this.normalizeTicketItems(response);
          const nextMap = new Map<string, string>();

          for (const item of items) {
            const vehicleId = this.getFirstDefinedValue(item, [
              'id',
              'vehicleId',
              'vehicle_id',
              'VehicleId',
              'VehicleID',
            ]);
            const clientIdValue = this.getFirstDefinedValue(item, [
              'clientId',
              'client_id',
              'ClientId',
              'ClientID',
              'customerId',
              'customer_id',
            ]);

            if (vehicleId !== undefined && vehicleId !== null && clientIdValue !== undefined && clientIdValue !== null) {
              const vehicleKey = String(vehicleId).trim();
              const clientText = String(clientIdValue).trim();
              if (vehicleKey && clientText) {
                nextMap.set(vehicleKey, clientText);
              }
            }
          }

          this.vehicleClientIdMap = nextMap;
          this.applyVehicleClientIdsToTickets();
        },
        error: () => {
          this.vehicleClientIdMap.clear();
        },
      });
  }

  private getClientIdByVehicle(vehicleId: string | number | undefined): string | undefined {
    if (vehicleId === undefined || vehicleId === null) return undefined;
    const key = String(vehicleId).trim();
    return key ? this.vehicleClientIdMap.get(key) : undefined;
  }

  private applyVehicleClientIdsToTickets(): void {
    if (!this.tickets.length || this.vehicleClientIdMap.size === 0) return;

    this.tickets = this.tickets.map((ticket) => {
      const mappedClientId = this.getClientIdByVehicle(ticket.vehicleId);
      if (!mappedClientId) return ticket;
      return { ...ticket, client: this.resolveClientDisplay(mappedClientId) };
    });

    this.applyFilters();
  }

  private normalizeTicketItems(raw: unknown): any[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj['items'])) return obj['items'] as any[];
      if (Array.isArray(obj['tickets'])) return obj['tickets'] as any[];
      if (Array.isArray(obj['results'])) return obj['results'] as any[];
      if (Array.isArray(obj['data'])) return obj['data'] as any[];
      if (obj['data'] && typeof obj['data'] === 'object') {
        const data = obj['data'] as Record<string, unknown>;
        if (Array.isArray(data['items'])) return data['items'] as any[];
        if (Array.isArray(data['tickets'])) return data['tickets'] as any[];
      }
    }
    return [];
  }

  private mapApiTicketToRow(item: any): TicketRow {
    const projectId = this.getFirstDefinedValue(item, ['projectId', 'project_id']);
    const vehicleId = this.getFirstDefinedValue(item, ['vehicleId', 'vehicle_id']);
    const defectTypeFromLocation = this.getFirstNonBlankValue(item, [
      'defectLocationName',
      'defect_location_name',
      'defectlocationname',
    ]);
    const stationName = this.getFirstNonBlankValue(item, ['stationName', 'station_name']);
    const statusTicketName = this.getFirstDefinedValue(item, ['statusTicketName', 'statusName', 'status']);

    const statusRaw = String(
      statusTicketName ?? this.getFirstDefinedValue(item, ['ticketStatus', 'Status']) ?? 'open'
    ).trim();

    const normalizedStatus = statusRaw.toLowerCase();

    const createdAtValue = this.getFirstDefinedValue(item, [
      'createdDate',
      'ticketCreatedDate',
      'created_at',
      'createdAt',
      'created_at',
      'CreatedDate',
      'dateCreated',
    ]);

    const projectRaw = String(
      this.getFirstDefinedValue(item, ['project', 'projectName', 'project_name']) ?? ''
    ).trim();
    const vehicleRaw = String(
      this.getFirstDefinedValue(item, ['vehicle', 'vehicleName', 'vehicle_name']) ?? ''
    ).trim();

    const mappedProjectBase = this.normalizeNameAndId(projectRaw, projectId);
    const mappedVehicleBase = this.normalizeNameAndId(vehicleRaw, vehicleId);

    const projectOptionName = this.projectOptions.find(
      (project) => String(project.id) === String(projectId ?? ''),
    )?.name;
    const vehicleOptionName = this.vehicleOptions.find(
      (vehicle) => String(vehicle.id) === String(vehicleId ?? ''),
    )?.name;

    const mappedProject = {
      ...mappedProjectBase,
      name:
        (projectOptionName && projectOptionName !== 'All Projects' ? projectOptionName : '') ||
        mappedProjectBase.name ||
        (mappedProjectBase.id != null ? `Project ${mappedProjectBase.id}` : '-'),
    };
    const mappedVehicle = {
      ...mappedVehicleBase,
      name:
        (vehicleOptionName && vehicleOptionName !== 'All Vehicles' && vehicleOptionName !== 'Select project first'
          ? vehicleOptionName
          : '') ||
        mappedVehicleBase.name ||
        (mappedVehicleBase.id != null ? `Vehicle ${mappedVehicleBase.id}` : '-'),
    };

    const mappedClientIdFromVehicle = this.getClientIdByVehicle(mappedVehicle.id ?? vehicleId);
    const mappedClientFromTicket = this.getFirstDefinedValue(item, [
      'clientId',
      'client_id',
      'client',
      'clientName',
    ]);
    const mappedClient =
      mappedClientIdFromVehicle ||
      (mappedClientFromTicket !== undefined && mappedClientFromTicket !== null
        ? String(mappedClientFromTicket).trim()
        : '');

    return {
      id: this.getFirstDefinedValue(item, ['id', 'ticketId', 'ticketID', 'ticketNumber']) ?? '-',
      ticketNumber: this.getFirstDefinedValue(item, ['ticketNumber', 'ticketNo', 'uniqueId']),
      ticketDescription: this.getFirstDefinedValue(item, ['ticketDescription', 'description']),
      description: this.getFirstDefinedValue(item, ['description', 'ticketDescription']) ?? '-',
      safetyCritical: Boolean(this.getFirstDefinedValue(item, ['safetyCritical', 'isSafetyCritical']) ?? false),
      defectTypeId: this.getFirstDefinedValue(item, ['defectTypeId', 'defect_type_id']),
      stationId: this.getFirstDefinedValue(item, ['stationId', 'station_id']),
      ticketCreatedDate: createdAtValue != null ? String(createdAtValue) : undefined,
      createdDate: createdAtValue != null ? String(createdAtValue) : undefined,
      ticketUpdatedDate: this.getFirstDefinedValue(item, ['ticketUpdatedDate', 'updatedDate', 'updated_at']),
      userId: this.getFirstDefinedValue(item, ['userId', 'user_id']),
      ticketAssignedBy: this.getFirstDefinedValue(item, ['ticketAssignedBy', 'assignedById']),
      assignedBy: this.getFirstDefinedValue(item, ['assignedBy', 'assignedByName']) ?? '-',
      assignedTo: this.getFirstDefinedValue(item, ['assignedTo', 'assignedToName']) ?? '-',
      projectId: mappedProject.id,
      vehicleId: mappedVehicle.id,
      inspectionTaskId: this.getFirstDefinedValue(item, ['inspectionTaskId', 'inspection_task_id']),
      deleted: Boolean(this.getFirstDefinedValue(item, ['deleted', 'isDeleted']) ?? false),
      priority: this.getFirstDefinedValue(item, ['priority']),
      statusTicketId: this.getFirstDefinedValue(item, ['statusTicketId', 'status_ticket_id']),
      uniqueId: this.getFirstDefinedValue(item, ['uniqueId']),
      lastUpdate: this.getFirstDefinedValue(item, ['lastUpdate', 'updatedDate', 'updated_at']),
      clientComment: this.getFirstDefinedValue(item, ['clientComment']),
      snagId: this.getFirstDefinedValue(item, ['snagId']),
      repeater: Boolean(this.getFirstDefinedValue(item, ['repeater', 'repeated', 'isRepeater']) ?? false),
      hasImages: Boolean(this.getFirstDefinedValue(item, ['hasImages']) ?? ((this.getFirstDefinedValue(item, ['imageCount']) ?? 0) > 0)),
      project: mappedProject.name,
      vehicle: mappedVehicle.name,
      defectType:
        defectTypeFromLocation ??
        this.getFirstNonBlankValue(item, ['defectType', 'defectTypeName']) ??
        '-',
      station:
        stationName ??
        this.getFirstNonBlankValue(item, ['stationname', 'station']) ??
        '-',
      defectLocation:
        this.getFirstNonBlankValue(item, ['defectLocationName', 'defect_location_name', 'defectlocationname', 'defectLocation']) ??
        '-',
      status: normalizedStatus || 'open',
      client: this.resolveClientDisplay(mappedClient || '-'),
      selected: false,
    };
  }

  private getFirstNonBlankValue(source: any, keys: string[]): any {
    const value = this.getFirstDefinedValue(source, keys);
    if (typeof value === 'string' && value.trim() === '') {
      return undefined;
    }
    return value;
  }

  private getFirstDefinedValue(source: any, keys: string[]): any {
    if (!source || typeof source !== 'object') return undefined;

    for (const key of keys) {
      const direct = source[key];
      if (direct !== undefined && direct !== null) {
        return direct;
      }
    }

    const loweredEntries = Object.entries(source as Record<string, any>).reduce<Record<string, any>>(
      (acc, [key, value]) => {
        acc[key.toLowerCase()] = value;
        return acc;
      },
      {},
    );

    for (const key of keys) {
      const value = loweredEntries[key.toLowerCase()];
      if (value !== undefined && value !== null) {
        return value;
      }
    }

    return undefined;
  }

  private normalizeNameAndId(
    nameRaw: string | undefined,
    idRaw: string | number | undefined,
  ): { name: string; id: string | number | undefined } {
    const nameText = String(nameRaw ?? '').trim();
    const hasId = idRaw !== undefined && idRaw !== null && String(idRaw).trim() !== '';
    const idFromField = hasId ? String(idRaw).trim() : '';

    const match = nameText.match(/^(.*)\(([^)]+)\)\s*$/);
    if (match) {
      const extractedName = match[1].trim();
      const extractedId = match[2].trim();
      return {
        name: extractedName,
        id: idFromField || extractedId || undefined,
      };
    }

    return {
      name: nameText,
      id: idFromField || undefined,
    };
  }

  private fetchTicketsFromApi(): void {
    this.ensureRoleScopedFilters();

    const projectId = this.filters.project === 'all' ? 0 : Number(this.filters.project) || 0;
    const vehicleId = this.filters.vehicle === 'all' ? 0 : Number(this.filters.vehicle) || 0;
    const userId = 0;
    const clientId = this.getEffectiveClientId();
    const requestParams = { projectId, userId, vehicleId, clientId };

    this.isLoadingTickets = true;
    this.fetchAllTickets(requestParams)
      .subscribe({
        next: (items: any[]) => {
          this.tickets = items.map((item) => this.mapApiTicketToRow(item));
          this.applyVehicleClientIdsToTickets();
          this.applyClientNamesToTickets();
          this.resolveUserNamesOnTickets();
          this.applyFilters();
          this.isLoadingTickets = false;
        },
        error: (error) => {
          console.error('Tickets API request failed:', error);
          this.tickets = [];
          this.filteredTickets = [];
          this.applyFilters();
          this.isLoadingTickets = false;
        },
      });
  }

  private fetchAllTickets(params: {
    projectId: number;
    userId: number;
    vehicleId: number;
    clientId?: number;
  }): Observable<any[]> {
    return this.clientDashboardService
      .getTickets({ ...params, page: 1, pageSize: 1000 })
      .pipe(
        map((response: unknown) => this.normalizeTicketItems(response)),
      );
  }

  private loadProjectsFromApi(includeClosed: boolean, fetchTicketsAfterLoad = false): void {
    this.ensureRoleScopedFilters();

    this.dashboardProjectsService.getProjectOptions({
      clientId: this.getEffectiveClientId(),
      includeClosed,
      page: 1,
      pageSize: 10000,
    }).subscribe({
      next: (projects: DashboardProjectOption[]) => {
        this.projectOptions = projects.length ? projects : [{ id: 'all', name: 'All Projects' }];

        if (this.initialProjectIdFromRoute) {
          const routeProjectExists = this.projectOptions.some(
            (project) => String(project.id) === this.initialProjectIdFromRoute,
          );

          if (routeProjectExists) {
            this.filters.project = this.initialProjectIdFromRoute;
          }

          this.initialProjectIdFromRoute = null;
        }

        const selectedProjectExists = this.projectOptions.some(
          (project) => project.id === this.filters.project,
        );
        if (!selectedProjectExists) {
          this.filters.project = 'all';
        }

        if (!this.filters.project || this.filters.project === 'all') {
          this.resetVehiclesDropdown();
        } else {
          this.loadVehiclesByProject(this.filters.project);
        }

        if (fetchTicketsAfterLoad) {
          this.fetchTicketsFromApi();
        }
      },
      error: () => {
        this.projectOptions = [{ id: 'all', name: 'All Projects' }];
        this.resetVehiclesDropdown();
        if (fetchTicketsAfterLoad) {
          this.fetchTicketsFromApi();
        }
      },
    });
  }

  private normalizeRouteProjectId(value: string | null): string | null {
    const projectId = String(value ?? '').trim();
    if (!projectId || projectId === 'all') {
      return null;
    }
    return projectId;
  }

  private resetVehiclesDropdown(): void {
    this.vehicleOptions = [{ id: 'all', name: 'Select project first' }];
    this.filters.vehicle = 'all';
  }

  private loadVehiclesByProject(projectId: string): void {
    const clientId = this.getEffectiveClientId();
    const userId = this.authService.currentUserValue?.userId;

    this.dashboardProjectsService
      .getVehicleOptionsByProjectResult(projectId, { clientId, userId })
      .subscribe({
        next: (result: DashboardVehicleOptionsResult) => {
          this.vehicleOptions = result.options.length
            ? result.options
            : [{ id: 'all', name: 'All Vehicles' }];

          const selectedVehicleExists = this.vehicleOptions.some(
            (vehicle) => vehicle.id === this.filters.vehicle,
          );
          if (!selectedVehicleExists) {
            this.filters.vehicle = 'all';
          }
        },
        error: () => {
          this.vehicleOptions = [{ id: 'all', name: 'All Vehicles' }];
          this.filters.vehicle = 'all';
        },
      });
  }

  onProjectFilterChange(projectId: string): void {
    this.filters.project = String(projectId ?? '').trim() || 'all';
    this.filters.vehicle = 'all';

    if (this.filters.project === 'all') {
      this.resetVehiclesDropdown();
      this.fetchTicketsFromApi();
      return;
    }

    this.loadVehiclesByProject(this.filters.project);
    this.fetchTicketsFromApi();
  }

  onVehicleFilterChange(vehicleId: string): void {
    this.filters.vehicle = String(vehicleId ?? '').trim() || 'all';
    this.fetchTicketsFromApi();
  }

  sortTickets(column: keyof TicketRow): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }

    this.applyFilters();
  }

  applyFilters(): void {
    this.filteredTickets = this.tickets.filter(t => {
      const search = this.filters.search?.toLowerCase() || '';
      const matchesSearch = !search ||
        String(t.id).toLowerCase().includes(search) ||
        (t.project?.toLowerCase().includes(search) || false) ||
        (t.vehicle?.toLowerCase().includes(search) || false) ||
        (t.description?.toLowerCase().includes(search) || false) ||
        (t.client?.toLowerCase().includes(search) || false);
      return matchesSearch;
    });

    if (this.sortColumn) {
      const column = this.sortColumn;
      this.filteredTickets.sort((left, right) => {
        const leftValue = left[column];
        const rightValue = right[column];

        const leftComparable = this.toComparableValue(leftValue);
        const rightComparable = this.toComparableValue(rightValue);

        if (leftComparable < rightComparable) {
          return this.sortDirection === 'asc' ? -1 : 1;
        }

        if (leftComparable > rightComparable) {
          return this.sortDirection === 'asc' ? 1 : -1;
        }

        return 0;
      });
    }

    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }
    if (this.currentPage < 1) {
      this.currentPage = 1;
    }
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredTickets.length / this.pageSize));
  }

  get paginatedTickets(): TicketRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredTickets.slice(start, start + this.pageSize);
  }

  get visiblePages(): PaginationItem[] {
    return buildPaginationItems(this.totalPages, this.currentPage, 5);
  }

  isPaginationNumber(page: PaginationItem): page is number {
    return page !== this.paginationEllipsis;
  }

  get pageStartItem(): number {
    if (!this.filteredTickets.length) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEndItem(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredTickets.length);
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  previousPage(): void {
    this.changePage(this.currentPage - 1);
  }

  nextPage(): void {
    this.changePage(this.currentPage + 1);
  }

  get selectedCount(): number {
    return this.filteredTickets.filter(t => t.selected).length;
  }

  get allSelected(): boolean {
    return this.filteredTickets.length > 0 && this.filteredTickets.every(t => t.selected);
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.filteredTickets.forEach(t => t.selected = checked);
  }

  checkAll(): void {
    this.filteredTickets.forEach(t => t.selected = true);
  }

  uncheckAll(): void {
    this.filteredTickets.forEach(t => t.selected = false);
  }

  updateSelection(): void {
    this.tickets = [...this.tickets];
  }

  getStatusBadgeClass(status: string): string {
    const classes: { [key: string]: string } = {
      'open': 'bg-primary-transparent text-primary',
      'in-progress': 'bg-warning-transparent text-warning',
      'resolved': 'bg-info-transparent text-info',
      'closed': 'bg-success-transparent text-success'
    };
    return classes[status] || 'bg-light';
  }

  toggleColumnMenu(): void {
    this.showColumnMenu = !this.showColumnMenu;
  }

  isColumnVisible(columnKey: string): boolean {
    const column = this.columns.find(c => c.key === columnKey);
    return column ? column.visible : true;
  }

  getVisibleColumnsCount(): number {
    return this.columns.filter(c => c.visible).length;
  }

  resetColumns(): void {
    this.columns.forEach(col => col.visible = true);
  }

  uncheckAllColumns(): void {
    this.columns.forEach(col => {
      if (col.key !== 'id') {
        col.visible = false;
      }
    });
  }

  displayValue(value: unknown): string {
    if (value === null || value === undefined) return '-';
    const text = String(value).trim();
    return text ? text : '-';
  }

  private toComparableValue(value: unknown): string | number {
    if (value === null || value === undefined) return '';

    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return date.getTime();
    }

    return String(value).toLowerCase();
  }
}
