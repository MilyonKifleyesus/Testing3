import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
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
import { UserListItem, UserManagementService } from '../../services/user-management.service';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TicketImageModalComponent } from './ticket-image-modal.component';

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
  assignedToId?: number;
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
  imageUrl?: string;
  project?: string;
  vehicle?: string;
  fleetNumber?: string;
  defectType?: string;
  station?: string;
  status?: string;
  client?: string;
  defectLocation?: string;
  serialNo?: string;
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
  imports: [CommonModule, FormsModule, RouterModule],
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
  private hasClientNameMap = false;
  isLoadingTickets = false;
  isExporting = false;
  currentPage = 1;
  readonly pageSize = 10;
  totalCount = 0;

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

  private userIdToName = new Map<number, string>();
  isPrintLoading = false;
  private allSelectedTickets: TicketRow[] = [];

  constructor(
    private route: ActivatedRoute,
    private dashboardProjectsService: DashboardProjectsService,
    private authService: AuthService,
    private clientService: ClientService,
    private clientDashboardService: ClientDashboardService,
    private userManagementService: UserManagementService,
    private modalService: NgbModal
  ) {}

  openImageModal(imageUrl: string): void {
    const modalRef = this.modalService.open(TicketImageModalComponent, {
      centered: true,
      size: 'lg',
      backdrop: 'static',
      windowClass: 'ticket-image-modal-window'
    });
    modalRef.componentInstance.imageUrl = imageUrl;
  }

  ngOnInit(): void {
    this.initialProjectIdFromRoute = this.normalizeRouteProjectId(
      this.route.snapshot.queryParamMap.get('projectId'),
    );
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
    this.currentPage = 1;
    this.resetVehiclesDropdown();
    this.loadProjectsFromApi(true, true);
  }

  private ensureRoleScopedFilters(): void {
    if (this.isAdminRole) {
      return;
    }

    const clientId = this.getCurrentUserClientId();
    this.filters.client = clientId ? String(clientId) : 'all';
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

  private resolveAssignedUserNames(): void {
    const toNumericId = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const userIds = Array.from(new Set(
      this.tickets.flatMap(t => [toNumericId(t.ticketAssignedBy), toNumericId(t.assignedToId)])
        .filter((id): id is number => id !== null)
    ));

    if (!userIds.length) return;

    const applyNames = () => {
      this.tickets = this.tickets.map(ticket => {
        const byId = toNumericId(ticket.ticketAssignedBy);
        const toId = toNumericId(ticket.assignedToId);
        return {
          ...ticket,
          assignedBy: byId && this.userIdToName.has(byId) ? this.userIdToName.get(byId)! : ticket.assignedBy,
          assignedTo: toId && this.userIdToName.has(toId) ? this.userIdToName.get(toId)! : ticket.assignedTo,
        };
      });
      this.applyFilters();
    };

    const uncachedIds = userIds.filter(id => !this.userIdToName.has(id));

    if (!uncachedIds.length) {
      applyNames();
      return;
    }

    forkJoin(
      uncachedIds.map(id => this.userManagementService.getUserById(id).pipe(catchError(() => of(null))))
    ).subscribe(users => {
      users.forEach((user, i) => {
        if (user) {
          this.userIdToName.set(uncachedIds[i], user.userName || user.name || String(uncachedIds[i]));
        }
      });
      applyNames();
    });
  }

  private applyClientNamesToTickets(): void {
    if (!this.tickets.length || !this.hasClientNameMap) return;

    this.tickets = this.tickets.map((ticket) => ({
      ...ticket,
      client: this.resolveClientDisplay(ticket.client),
    }));

    this.applyFilters();
  }


  private mapApiTicketToRow(item: any): TicketRow {
    const projectId = this.getFirstDefinedValue(item, ['projectId', 'project_id']);
    const vehicleId = this.getFirstDefinedValue(item, ['vehicleId', 'vehicle_id']);
    const defectTypeName = this.getFirstNonBlankValue(item, [
      'defectTypeName',
      'defectType',
      'defect_type_name',
      'defect_type',
      'DefectTypeName',
      'DefectType',
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

    const mappedClientFromTicket = this.getFirstDefinedValue(item, [
      'clientId',
      'client_id',
      'client',
      'clientName',
    ]);

    const rawClient =
      mappedClientFromTicket !== undefined && mappedClientFromTicket !== null
        ? String(mappedClientFromTicket).trim()
        : '';
    const effectiveClientFallback = this.getEffectiveClientId();
    const mappedClient = rawClient || (effectiveClientFallback ? String(effectiveClientFallback) : '');


    let imageUrl = undefined;
    if (Array.isArray(item.images) && item.images.length > 0) {
      imageUrl = item.images[0].imageUrl || item.images[0].fileName;
    }
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
      ticketAssignedBy: this.getFirstDefinedValue(item, ['ticketAssignedBy', 'assignedById', 'assignedByUserId', 'assignedBy']),
      assignedToId: this.getFirstDefinedValue(item, ['assignedToId', 'assignedToUserId', 'assignedUserId', 'assignedTo']),
      assignedBy: this.getFirstNameValue(item, ['assignedByName', 'assignByName', 'assignedByFullName', 'assignedByUserName', 'createdByName']) ?? '-',
      assignedTo: this.getFirstNameValue(item, ['assignedToName', 'assignToName', 'assignedToFullName', 'assignedToUserName', 'inspectorName', 'userName']) ?? '-',
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
      imageUrl: imageUrl,
      project: mappedProject.name,
      vehicle: mappedVehicle.name,
      fleetNumber: this.getFirstNonBlankValue(item, ['fleetNumber', 'fleet_number', 'fleetNo', 'fleet_no', 'vehicleFleetNumber']) ?? mappedVehicle.name ?? '-',
      defectType:
        defectTypeName ??
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
      serialNo: this.getFirstNonBlankValue(item, ['serialNo', 'serialNumber', 'serial_no', 'serial_number', 'SerialNo', 'SerialNumber']) ?? '-',
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

  /** Like getFirstNonBlankValue but rejects pure-numeric values (those are IDs, not display names). */
  private getFirstNameValue(source: any, keys: string[]): string | undefined {
    for (const key of keys) {
      const raw = this.getFirstDefinedValue(source, [key]);
      if (raw == null) continue;
      const str = String(raw).trim();
      if (!str || /^\d+$/.test(str)) continue; // skip empty or numeric-only
      return str;
    }
    return undefined;
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
    const clientId = this.getEffectiveClientId();

    const orderBy = this.sortColumn ? (this.sortColumnApiMap[this.sortColumn] ?? String(this.sortColumn)) : undefined;
    const orderDirection = this.sortColumn ? this.sortDirection : undefined;

    this.isLoadingTickets = true;
    this.clientDashboardService
      .getTickets({ projectId, userId: 0, vehicleId, clientId, page: this.currentPage, pageSize: this.pageSize, orderBy, orderDirection })
      .subscribe({
        next: (response: unknown) => {
          const { items, total } = this.normalizeTicketResponse(response);
          this.totalCount = total;
          this.tickets = items.map((item) => this.mapApiTicketToRow(item));
          this.applyClientNamesToTickets();
          this.resolveAssignedUserNames();
          this.applyFilters();
          this.isLoadingTickets = false;
        },
        error: (error) => {
          console.error('Tickets API request failed:', error);
          this.tickets = [];
          this.filteredTickets = [];
          this.totalCount = 0;
          this.isLoadingTickets = false;
        },
      });
  }

  private normalizeTicketResponse(raw: unknown): { items: any[]; total: number } {
    if (Array.isArray(raw)) return { items: raw, total: raw.length };
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const total = Number(obj['totalCount'] ?? obj['total'] ?? obj['totalItems'] ?? obj['count'] ?? 0);
      for (const key of ['items', 'tickets', 'results', 'data'] as const) {
        if (Array.isArray(obj[key])) return { items: obj[key] as any[], total };
      }
      if (obj['data'] && typeof obj['data'] === 'object' && !Array.isArray(obj['data'])) {
        const d = obj['data'] as Record<string, unknown>;
        const dt = Number(d['totalCount'] ?? d['total'] ?? total);
        for (const key of ['items', 'tickets', 'results'] as const) {
          if (Array.isArray(d[key])) return { items: d[key] as any[], total: dt };
        }
      }
    }
    return { items: [], total: 0 };
  }

  private loadProjectsFromApi(includeClosed: boolean, fetchTicketsAfterLoad = false): void {
    this.ensureRoleScopedFilters();

    this.dashboardProjectsService.getProjectOptions({
      clientId: this.getEffectiveClientId(),
      includeClosed,
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

        if (fetchTicketsAfterLoad && this.filters.project && this.filters.project !== 'all') {
          this.fetchTicketsFromApi();
        }
      },
      error: () => {
        this.projectOptions = [{ id: 'all', name: 'All Projects' }];
        this.resetVehiclesDropdown();
        if (fetchTicketsAfterLoad && this.filters.project && this.filters.project !== 'all') {
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

  get hasProjectSelected(): boolean {
    return !!this.filters.project && this.filters.project !== 'all';
  }

  onProjectFilterChange(projectId: string): void {
    this.filters.project = String(projectId ?? '').trim() || 'all';
    this.filters.vehicle = 'all';
    this.currentPage = 1;
    this.tickets = [];
    this.filteredTickets = [];
    this.totalCount = 0;

    if (!this.hasProjectSelected) {
      this.resetVehiclesDropdown();
      return;
    }

    this.loadVehiclesByProject(this.filters.project);
    this.fetchTicketsFromApi();
  }

  onVehicleFilterChange(vehicleId: string): void {
    if (!this.hasProjectSelected) return;
    this.filters.vehicle = String(vehicleId ?? '').trim() || 'all';
    this.currentPage = 1;
    this.fetchTicketsFromApi();
  }

  private readonly sortColumnApiMap: Partial<Record<keyof TicketRow, string>> = {
    id:             'id',
    createdDate:    'ticketCreatedDate',
    safetyCritical: 'safetyCritical',
    repeater:       'repeater',
    projectId:      'projectId',
    vehicleId:      'vehicleId',
    defectTypeId:   'defectTypeId',
    stationId:      'stationId',
    priority:       'priority',
    statusTicketId: 'statusTicketId',
    ticketAssignedBy: 'ticketAssignedBy',
    assignedToId:   'assignedToId',
  };

  sortTickets(column: keyof TicketRow): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.currentPage = 1;
    this.fetchTicketsFromApi();
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
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  get paginatedTickets(): TicketRow[] {
    return this.filteredTickets;
  }

  get visiblePages(): PaginationItem[] {
    return buildPaginationItems(this.totalPages, this.currentPage, 5);
  }

  isPaginationNumber(page: PaginationItem): page is number {
    return page !== this.paginationEllipsis;
  }

  get pageStartItem(): number {
    return this.totalCount ? (this.currentPage - 1) * this.pageSize + 1 : 0;
  }

  get pageEndItem(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalCount);
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.fetchTicketsFromApi();
  }

  previousPage(): void {
    this.changePage(this.currentPage - 1);
  }

  nextPage(): void {
    this.changePage(this.currentPage + 1);
  }

  get selectedTickets(): TicketRow[] {
    return this.tickets.filter((ticket) => ticket.selected);
  }

  get selectedCount(): number {
    return this.allSelectedTickets.length || this.selectedTickets.length;
  }

  get selectionSummary(): string {
    if (this.selectedCount === 0) {
      return 'Select rows to enable export';
    }

    return `${this.selectedCount} ${this.selectedCount === 1 ? 'row' : 'rows'} selected`;
  }

  get allSelected(): boolean {
    return this.paginatedTickets.length > 0 && this.paginatedTickets.every((ticket) => ticket.selected);
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.paginatedTickets.forEach((ticket) => ticket.selected = checked);
    this.updateSelection();
  }

  checkAll(): void {
    this.isPrintLoading = true;
    const projectId = this.filters.project === 'all' ? 0 : Number(this.filters.project) || 0;
    const vehicleId = this.filters.vehicle === 'all' ? 0 : Number(this.filters.vehicle) || 0;
    const clientId = this.getEffectiveClientId();
    this.clientDashboardService.getTickets({ projectId, userId: 0, vehicleId, clientId }).subscribe({
      next: (response: unknown) => {
        const { items } = this.normalizeTicketResponse(response);
        this.allSelectedTickets = items.map((item) => ({ ...this.mapApiTicketToRow(item), selected: true }));
        this.tickets.forEach(t => t.selected = true);
        this.filteredTickets.forEach(t => t.selected = true);
        this.isPrintLoading = false;
      },
      error: () => {
        this.tickets.forEach(t => t.selected = true);
        this.filteredTickets.forEach(t => t.selected = true);
        this.allSelectedTickets = [];
        this.isPrintLoading = false;
      },
    });
  }

  uncheckAll(): void {
    this.allSelectedTickets = [];
    this.tickets.forEach(t => t.selected = false);
    this.filteredTickets.forEach(t => t.selected = false);
  }

  updateSelection(): void {
    this.tickets = [...this.tickets];
  }

  async exportSelectedTickets(): Promise<void> {
    if (this.selectedCount === 0 || this.isExporting) {
      return;
    }

    this.isExporting = true;

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(
        this.selectedTickets.map((ticket) => this.buildExportRow(ticket)),
      );

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Selected Tickets');
      XLSX.writeFile(workbook, `tickets-selected-${this.getExportDateStamp()}.xlsx`);
    } catch (error) {
      console.error('Unable to export selected tickets.', error);
    } finally {
      this.isExporting = false;
    }
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

  private buildExportRow(ticket: TicketRow): Record<string, string | number> {
    return this.columns
      .filter((column) => column.visible)
      .reduce<Record<string, string | number>>((row, column) => {
        row[column.label] = this.getExportValue(ticket, column.key);
        return row;
      }, {});
  }

  private getExportValue(ticket: TicketRow, columnKey: string): string | number {
    switch (columnKey) {
      case 'id':
        return this.displayValue(ticket.id);
      case 'client':
        return this.displayValue(ticket.client);
      case 'status':
        return this.displayValue(ticket.status);
      case 'project':
        return this.displayValue(ticket.project);
      case 'vehicle':
        return this.displayValue(ticket.vehicle);
      case 'safetyCritical':
        return ticket.safetyCritical ? 'Yes' : 'No';
      case 'repeater':
        return ticket.repeater ? 'Yes' : 'No';
      case 'createdDate':
        return this.formatExportDate(ticket.createdDate);
      case 'defectType':
        return this.displayValue(ticket.defectType);
      case 'defectLocation':
        return this.displayValue(ticket.defectLocation);
      case 'description':
        return this.displayValue(ticket.description);
      case 'hasImages':
        return ticket.hasImages ? 'Yes' : 'No';
      case 'assignedBy':
        return this.displayValue(ticket.assignedBy);
      case 'assignedTo':
        return this.displayValue(ticket.assignedTo);
      case 'station':
        return this.displayValue(ticket.station);
      default:
        return this.displayValue((ticket as unknown as Record<string, unknown>)[columnKey]);
    }
  }

  private formatExportDate(value: unknown): string {
    const raw = this.displayValue(value);
    if (raw === '-') {
      return raw;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString();
  }

  private getExportDateStamp(): string {
    return new Date().toISOString().split('T')[0];
  }

  printSelectedTickets(): void {
    const selected = this.filteredTickets.filter(t => t.selected);
    const toPrint = this.allSelectedTickets.length ? this.allSelectedTickets : selected.length ? selected : this.filteredTickets;
    if (!toPrint.length) return;

    const toNumericId = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const uncachedIds = Array.from(new Set(
      toPrint.flatMap(t => [toNumericId(t.ticketAssignedBy), toNumericId(t.assignedToId)])
        .filter((id): id is number => id !== null && !this.userIdToName.has(id))
    ));

    const doPrint = async () => {
      this.isPrintLoading = true;

      const projectName = this.projectOptions.find(p => String(p.id) === this.filters.project)?.name || '—';
      const vehicleLabel = this.filters.vehicle !== 'all'
        ? (this.vehicleOptions.find(v => String(v.id) === this.filters.vehicle)?.name || '—')
        : 'All Vehicles';
      const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const resolveName = (idField: unknown, fallback: string) => {
        const id = toNumericId(idField);
        return (id && this.userIdToName.get(id)) || fallback;
      };

      const rows = toPrint.map((t, i) => {
        const statusColor: Record<string, string> = {
          open: '#2563eb', 'in-progress': '#d97706', resolved: '#0891b2', closed: '#16a34a'
        };
        const sColor = statusColor[String(t.status).toLowerCase()] || '#555';
        const imgCell = t.imageUrl
          ? `<img src="${esc(t.imageUrl)}" style="width:48px;height:32px;object-fit:cover;border-radius:2px;" />`
          : '—';
        return `<tr>
          <td class="center">${i + 1}</td>
          <td class="center">${t.safetyCritical ? '<span class="badge danger">Yes</span>' : '<span class="badge neutral">No</span>'}</td>
          <td class="center">${t.repeater ? '<span class="badge warn">Yes</span>' : '<span class="badge neutral">No</span>'}</td>
          <td class="nowrap">${t.createdDate ? new Date(t.createdDate).toLocaleDateString('en-GB') : '—'}</td>
          <td>${esc(t.defectType)}</td>
          <td>${esc(t.defectLocation)}</td>
          <td class="desc">${esc(t.description)}</td>
          <td class="center">${imgCell}</td>
          <td>${esc(resolveName(t.assignedToId, t.assignedTo || '—'))}</td>
          <td>${esc(t.station)}</td>
          <td class="center"><span style="color:${sColor};font-weight:600;">${esc(t.status)}</span></td>
          <td>—</td>
          <td>—</td>
        </tr>`;
      }).join('');

      const logoBase64 = await new Promise<string>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = 'assets/images/brand-logos/login-optimized.jpg';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) { ctx.drawImage(img, 0, 0); resolve(canvas.toDataURL('image/jpeg')); } else resolve('');
        };
        img.onerror = () => resolve('');
      });
      const logoHtml = logoBase64
        ? `<img src="${logoBase64}" alt="Logo" style="width:100px;height:50px;object-fit:contain;padding:5px;">`
        : `<div style="width:100px;height:50px;background:#ccc;display:flex;align-items:center;justify-content:center;font-size:10px;color:#666;">Logo</div>`;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#333;background:white;padding:20px}
  .page-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:15px;padding-bottom:10px;border-bottom:2px solid #000}
  .report-title{text-align:center;flex-grow:1}
  .report-title h1{font-size:16px;font-weight:bold;margin:0}
  .report-title p{font-size:11px;margin:2px 0}
  .project-info{font-size:11px;margin-bottom:15px;color:#333;padding:8px}
  .section-header{background:#1DB954 !important;padding:8px 10px;font-weight:bold;font-size:12px;color:white !important;border:2px solid #000;margin-bottom:3px;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:11px;background:white}
  thead tr{background:#1DB954 !important;border:2px solid #000;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
  th{padding:6px 4px;text-align:left;font-weight:bold;border:1px solid #000;color:white !important;font-size:10px;background:#1DB954 !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
  td{padding:6px 4px;border:1px solid #999;vertical-align:top;background:white;word-break:break-word;line-height:1.3}
  tbody tr:nth-child(even) td{background:#f9f9f9;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .center{text-align:center}
  .badge{display:inline-block;padding:1px 5px;border-radius:2px;font-size:9px;font-weight:700}
  .badge.danger{background:#fee2e2 !important;color:#b91c1c !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .badge.warn{background:#fef3c7 !important;color:#92400e !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .badge.neutral{background:#e2e8f0 !important;color:#475569 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .footer{display:flex;justify-content:space-between;align-items:center;padding-top:15px;border-top:1px solid #ccc;font-size:10px;color:#666;margin-top:20px}
  @page{size:297mm 210mm;margin:10mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:8px;font-family:Arial,sans-serif;color:#666;font-weight:600}}
  @media print{
    *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
    body{margin:0;padding:15px;background:white}
    table{page-break-inside:auto}
    thead{display:table-header-group}
    tr{page-break-inside:avoid;page-break-after:auto}
    .section-header{background:#1DB954 !important;color:white !important}
    thead tr{background:#1DB954 !important}
    th{background:#1DB954 !important;color:white !important}
  }
</style></head><body>
  <div class="page-header">
    <div>${logoHtml}</div>
    <div class="report-title">
      <h1>BusPulse Ticket Report</h1>
      <p>Ticket Summary</p>
    </div>
    <div>${logoHtml}</div>
  </div>
  <div class="project-info">
    <strong>Project: ${esc(projectName)}</strong> | <strong>Vehicle: ${esc(vehicleLabel)}</strong> | Generated: ${today}
  </div>
  <div class="section-header">Tickets</div>
  <table>
    <thead><tr>
      <th>Serial No.</th><th>Safety Critical</th><th>Repeater</th><th>Created Date</th>
      <th>Defect Type</th><th>Defect Location</th><th>Description</th><th>Images</th>
      <th>Assign To</th><th>Station</th><th>Status</th><th>Resolved Date</th>
      <th>Resolved Comment</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    <div>Total Tickets: ${toPrint.length} | Print Date: ${today}</div>
    <div></div>
  </div>
  <div id="bp-overlay" style="position:fixed;inset:0;background:rgba(255,255,255,0.95);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;font-family:Arial,sans-serif;">
    <div style="font-size:15px;font-weight:700;color:#1e3a5f;margin-bottom:10px;">Preparing print&hellip;</div>
    <div id="bp-prog-text" style="font-size:12px;color:#555;margin-bottom:14px;">Loading images&hellip;</div>
    <div style="width:220px;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
      <div id="bp-prog-bar" style="height:100%;background:#1DB954;width:0%;transition:width 0.2s;"></div>
    </div>
    <button onclick="document.getElementById('bp-overlay').style.display='none';window.print();" style="margin-top:18px;padding:7px 22px;background:#1e3a5f;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">Print Now</button>
  </div>
  <script>
    (function(){
      var overlay=document.getElementById('bp-overlay');
      var txt=document.getElementById('bp-prog-text');
      var bar=document.getElementById('bp-prog-bar');
      var imgs=Array.from(document.querySelectorAll('img'));
      var total=imgs.length;
      if(!total){overlay.style.display='none';window.print();return;}
      var done=0;
      var timer=setTimeout(function(){overlay.style.display='none';window.print();},12000);
      function settle(){
        done++;
        var pct=Math.round(done/total*100);
        txt.textContent='Loading images\u2026 '+done+' / '+total;
        bar.style.width=pct+'%';
        if(done===total){clearTimeout(timer);overlay.style.display='none';window.print();}
      }
      imgs.forEach(function(img){
        if(img.complete){settle();}
        else{img.addEventListener('load',settle);img.addEventListener('error',settle);}
      });
    })();
  </script>
</body></html>`;

      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      URL.revokeObjectURL(url);
      this.isPrintLoading = false;
    };

    if (!uncachedIds.length) {
      doPrint();
      return;
    }

    forkJoin(uncachedIds.map(id => this.userManagementService.getUserById(id).pipe(catchError(() => of(null))))).subscribe((results: (UserListItem | null)[]) => {
      results.forEach((user, i) => {
        if (user) this.userIdToName.set(uncachedIds[i], user.userName || user.name || String(uncachedIds[i]));
      });
      doPrint();
    });
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
