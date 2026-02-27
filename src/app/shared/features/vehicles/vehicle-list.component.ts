import { catchError, forkJoin, map, of, take } from 'rxjs';
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Vehicle, VehicleFilter } from './models/vehicle.model';
import { VehicleUtilService } from './services/vehicle-util.service';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import { AuthService } from '../../services/auth.service';
import { ClientService } from '../../services/client.service';
import { resolveProjectManagementContext } from '../project-management/project-management-context';
import { extractArrayFromApiResponse, getFirstDefinedValue, toOptionalText, toText } from '../../utils/api-data.utils';
import { buildPaginationItems, PAGINATION_ELLIPSIS } from '../../utils/pagination.utils';

interface SelectOption {
  id: string;
  name: string;
}

function normalizeId(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Vehicle List Component
 * 
 * @description
 * Displays a searchable and filterable list of all vehicles in the fleet.
 * Features include:
 * - Real-time search across fleet number, VIN, make, and model
 * - Client and project filtering
 * - Status indicators
 * - Quick actions (View, Edit, Delete)
 * 
 * @example
 * <app-vehicle-list></app-vehicle-list>
 */
@Component({
  selector: 'app-vehicle-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './vehicle-list.component.html',
  styleUrl: './vehicle-list.component.scss'
})
export class VehicleListComponent implements OnInit {
        /** Called when client filter changes */
        onClientChange(): void {
          this.filterVehicles();
        }

        /** Called when project filter changes */
        onProjectChange(): void {
          this.filterVehicles();
        }
      projects: SelectOption[] = [];

      // Stub for admin client loading
      loadClientsForAdmin(): void {
        // TODO: Implement admin client loading logic
      }

      // Stub for vehicle loading
      loadVehicles(): void {
        // TODO: Implement vehicle loading logic
      }

      // Stub for client id selection
      getSelectedClientIdForRequest(): number | undefined {
        // TODO: Implement client id selection logic
        return undefined;
      }
    get isAdminPortal(): boolean {
      return this.portalPrefix === '/admin';
    }

    readonly portalPrefix: '/admin' | '/client';
    readonly scopedClientId: string | null;

    get vehicleViewPathPrefix(): string {
      return `${this.portalPrefix}/vehicles/view`;
    }

    get totalPages(): number {
      const total = Math.ceil(this.filteredVehicles.length / this.pageSize);
      return total > 0 ? total : 1;
    }

    get paginatedVehicles(): Vehicle[] {
      const start = (this.currentPage - 1) * this.pageSize;
      return this.filteredVehicles.slice(start, start + this.pageSize);
    }

    get visiblePages(): number[] {
      return buildPaginationItems(this.totalPages, this.currentPage, 5);
    }

    get pageStartItem(): number {
      if (!this.filteredVehicles.length) return 0;
      return (this.currentPage - 1) * this.pageSize + 1;
    }

    get pageEndItem(): number {
      if (!this.filteredVehicles.length) return 0;
      return Math.min(this.currentPage * this.pageSize, this.filteredVehicles.length);
    }
  /** Card stats */
  totalVehicles: number = 0;
  totalTickets: number = 0;
  ticketStatusFilter: 'all' | 'open' | 'closed' = 'all';
  statCards: Array<{ label: string; value: number; icon: string }> = [];

  ngOnInit(): void {
    if (this.isAdminPortal) {
      this.loadClientsForAdmin();
    } else {
      if (this.scopedClientId) {
        this.clientService.getClients().pipe(take(1)).subscribe((clients: any[]) => {
          const found = clients.find((c: any) => String(c.id) === String(this.scopedClientId));
          if (found) {
            this.clients = [{ id: String(found.id), name: found.name }];
            this.selectedClient = String(found.id);
            this.clientDashboardService.getProjects({ clientId: Number(found.id), page: 1, pageSize: 5000 })
              .pipe(
                map((response) => extractArrayFromApiResponse(response)),
                map((items: any[]) =>
                  items
                    .map((item: any): SelectOption | null => {
                      const id = String(
                        getFirstDefinedValue(item, ['id', 'projectId', 'projectID', 'ProjectId', 'ProjectID', 'project_id']) ?? '',
                      ).trim();
                      const name = String(getFirstDefinedValue(item, ['projectName', 'name', 'title', 'projectCode']) ?? '').trim();
                      if (!id || !name) return null;
                      return { id, name };
                    })
                    .filter((project: SelectOption | null): project is SelectOption => project !== null),
                ),
                catchError((error) => {
                  console.error('Failed to load projects for client:', error);
                  return of([] as SelectOption[]);
                }),
                take(1),
              )
              .subscribe((projects: SelectOption[]) => {
                const uniqueById = new Map<string, SelectOption>();
                projects.forEach((project: SelectOption) => {
                  if (!uniqueById.has(project.id)) {
                    uniqueById.set(project.id, project);
                  }
                });
                const validProjects = Array.from(uniqueById.values())
                  .filter(p => p.id !== 'all' && p.name && p.name !== '-')
                  .sort((a, b) => a.name.localeCompare(b.name));
                this.projects = [...validProjects];
                this.loadVehicles();
              });
          }
        });
      }
    }
    this.loadVehicles();
  }
  /** Update stats cards for dashboard */
  updateStatsCards(): void {
    // Fetch vehicles from API for accurate count
    const clientId = this.getSelectedClientIdForRequest();
    if (clientId) {
      this.clientDashboardService.getVehicles({ clientId, page: 1, pageSize: 5000 })
        .pipe(
          map((response) => extractArrayFromApiResponse(response)),
          map((vehicles) => Array.isArray(vehicles) ? vehicles : []),
          catchError((error) => {
            console.error('Failed to load vehicles:', error);
            return of([]);
          }),
          take(1),
        )
        .subscribe((vehicles) => {
          this.totalVehicles = vehicles.length;
        });
    } else {
      this.totalVehicles = 0;
    }
  }

  /** Fetch tickets and update card */
  private updateTicketsCard(clientId?: number): void {
    // Use projectId if selected, else fetch all tickets for client
    const projectId = this.selectedProject !== 'all' ? Number(this.selectedProject) : undefined;
    const ticketParams: any = {
      projectId: projectId ?? 0,
      userId: 0,
      vehicleId: 0,
      page: 1,
      pageSize: 5000,
      ...(clientId ? { clientId } : {}),
    };
    if (this.ticketStatusFilter !== 'all') {
      ticketParams.status = this.ticketStatusFilter;
    }
    this.clientDashboardService.getTickets(ticketParams)
      .pipe(
        map((response) => extractArrayFromApiResponse(response)),
        map((tickets) => Array.isArray(tickets) ? tickets : []),
        catchError((error) => {
          console.error('Failed to load tickets:', error);
          return of([]);
        }),
        take(1),
      )
      .subscribe((tickets) => {
        this.totalTickets = tickets.length;
      });
  }


  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  changePage(page: number): void {
    if (this.isPaginationNumber(page) && page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  private ensureValidPage(): void {
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }
    if (this.currentPage < 1) {
      this.currentPage = 1;
    }
  }

  isPaginationNumber(value: number): boolean {
    return value !== this.paginationEllipsis;
  }

  getInspectorName(inspector: string | any): string {
    return typeof inspector === 'string' ? inspector : (inspector?.name || 'Unknown');
  }

  getStatusClass(status: string): string {
    return this.vehicleUtil.getStatusBadgeClass(status as any);
  }

  getStatusIcon(status: string): string {
    return this.vehicleUtil.getStatusIcon(status as any);
  }

  getInspectorInitial(inspector: string | any): string {
    const name = typeof inspector === 'string' ? inspector : (inspector?.name || 'Unknown');
    return name.charAt(0).toUpperCase();
  }
    sortColumn: keyof Vehicle | '' = '';
    sortDirection: 'asc' | 'desc' = 'asc';
  readonly paginationEllipsis = PAGINATION_ELLIPSIS;

  /** All vehicles from the service */
  vehicles: Vehicle[] = [];
  
  /** Filtered vehicles based on current criteria */
  filteredVehicles: Vehicle[] = [];
  
  /** Current search term */
  searchTerm: string = '';

  currentPage: number = 1;
  readonly pageSize: number = 10;
  
  /** Selected client filter */
  selectedClient: string = 'all';
  
  /** Selected project filter */
  selectedProject: string = 'all';
  
  /** Available clients */
  clients: SelectOption[] = [];
  
  /** Available propulsion types */
  propulsionTypes: string[] = [];

  constructor(
    public vehicleUtil: VehicleUtilService,
    private readonly clientDashboardService: ClientDashboardService,
    private readonly authService: AuthService,
    private readonly clientService: ClientService,
    private readonly route: ActivatedRoute,
  ) {
    const context = resolveProjectManagementContext(
      this.authService.currentUserValue,
      this.route.snapshot.queryParamMap.get('clientId'),
    );

    this.portalPrefix = context.portalPrefix;
    this.scopedClientId = context.scopedClientId;
    this.initializeSampleData();
  }

  /**
   * Initialize with sample/demo data
   */
  private initializeSampleData(): void {
    this.vehicles = [
      {
        id: 1,
        client: 'BusPulse Fleet',
        fleetNumber: 'BUS-001',
        make: 'Volvo',
        model: 'B8R',
        vin: 'VLV1234567890123',
        mileageType: 'Kilometres',
        propulsion: 'Diesel',
        status: 'completed',
        imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=400',
        inspectionDate: new Date().toISOString().split('T')[0],
        inspector: 'John Doe'
      },
      {
        id: 2,
        client: 'BusPulse Fleet',
        fleetNumber: 'BUS-002',
        make: 'Mercedes',
        model: 'Citaro',
        vin: 'MER2345678901234',
        mileageType: 'Kilometres',
        propulsion: 'Diesel',
        status: 'in-progress',
        imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=400',
        inspectionDate: new Date().toISOString().split('T')[0],
        inspector: 'Jane Smith'
      },
      {
        id: 3,
        client: 'BusPulse Fleet',
        fleetNumber: 'BUS-003',
        make: 'Scania',
        model: 'K360',
        vin: 'SCA3456789012345',
        mileageType: 'Kilometres',
        propulsion: 'CNG',
        status: 'pending',
        imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=400',
        inspectionDate: new Date().toISOString().split('T')[0],
        inspector: 'Mike Johnson'
      },
      {
        id: 4,
        client: 'BusPulse Fleet',
        fleetNumber: 'BUS-004',
        make: 'Tata',
        model: 'LPO 1623',
        vin: 'TAT4567890123456',
        mileageType: 'Kilometres',
        propulsion: 'Diesel',
        status: 'completed',
        imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=400',
        inspectionDate: new Date().toISOString().split('T')[0],
        inspector: 'Sarah Brown'
      },
      {
        id: 5,
        client: 'BusPulse Fleet',
        fleetNumber: 'BUS-005',
        make: 'Ashok Leyland',
        model: 'Viking',
        vin: 'ASH5678901234567',
        mileageType: 'Kilometres',
        propulsion: 'Hybrid',
        status: 'completed',
        imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=400',
        inspectionDate: new Date().toISOString().split('T')[0],
        inspector: 'Tom Wilson'
      }
    ];
    this.filteredVehicles = [...this.vehicles];
  }

  /**
   * Load filter dropdown options
   */
  private loadFilterOptions(): void {
    if (this.isAdminPortal) {
      return;
    }

    const clientMap = new Map<string, string>();
    this.vehicles.forEach((vehicle) => {
      const name = String(vehicle.client ?? '').trim();
      if (!name) return;

      const id = String(vehicle.clientId ?? name).trim();
      if (!clientMap.has(id)) {
        clientMap.set(id, name);
      }
    });

    this.clients = Array.from(clientMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));

    // Do NOT repopulate this.projects from vehicle data. Only set this.projects from project API responses.
    // ...existing code...
  }

  /**
   * Apply filters to vehicle list
   */
  filterVehicles(): void {
    this.currentPage = 1;
    this.filteredVehicles = this.vehicles.filter((vehicle: Vehicle) => {
      if (!vehicle) return false;
      const matchesSearch = !this.searchTerm ||
        (vehicle.fleetNumber && vehicle.fleetNumber.toLowerCase().includes(this.searchTerm.toLowerCase())) ||
        (vehicle.vin && vehicle.vin.toLowerCase().includes(this.searchTerm.toLowerCase())) ||
        (vehicle.make && vehicle.make.toLowerCase().includes(this.searchTerm.toLowerCase())) ||
        (vehicle.model && vehicle.model.toLowerCase().includes(this.searchTerm.toLowerCase()));
      const selectedClientOption = this.clients.find((client: SelectOption) => normalizeId(client.id) === normalizeId(this.selectedClient));
      const selectedClientName = String(selectedClientOption?.name ?? '').toLowerCase();
      const matchesClient =
        this.selectedClient === 'all' ||
        (vehicle.clientId && normalizeId(vehicle.clientId) === normalizeId(this.selectedClient)) ||
        (selectedClientName && vehicle.client && vehicle.client.toLowerCase() === selectedClientName);
      const selectedProjectOption = this.projects.find((project: SelectOption) => normalizeId(project.id) === normalizeId(this.selectedProject));
      const selectedProjectName = String(selectedProjectOption?.name ?? '').toLowerCase();
      const matchesProject =
        this.selectedProject === 'all' ||
        (vehicle.projectId && normalizeId(vehicle.projectId) === normalizeId(this.selectedProject)) ||
        (selectedProjectName && String(vehicle.project ?? '').toLowerCase() === selectedProjectName);
      return matchesSearch && matchesClient && matchesProject;
    });
    // Sorting logic
    if (this.sortColumn !== '') {
      this.filteredVehicles.sort((a: Vehicle, b: Vehicle) => {
        if (this.sortColumn in a && this.sortColumn in b) {
          const aValue = a[this.sortColumn as keyof Vehicle] ?? '';
          const bValue = b[this.sortColumn as keyof Vehicle] ?? '';
          let aComp = aValue;
          let bComp = bValue;
          if (typeof aComp === 'string' && typeof bComp === 'string') {
            aComp = aComp.toLowerCase();
            bComp = bComp.toLowerCase();
          }
          if (aComp < bComp) return this.sortDirection === 'asc' ? -1 : 1;
          if (aComp > bComp) return this.sortDirection === 'asc' ? 1 : -1;
          return 0;
        }
        return 0;
      });
    }
    this.ensureValidPage();
  }

  sortVehicles(column: keyof Vehicle): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.filterVehicles();
  }
}
