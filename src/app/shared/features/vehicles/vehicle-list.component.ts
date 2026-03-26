import { catchError, map, of, take } from 'rxjs';
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
  private vehiclesRequestVersion = 0;

        /** Called when client filter changes */
        onClientChange(): void {
          const clientId = this.getSelectedClientIdForRequest();
          this.selectedProject = 'all';
          this.currentPage = 1;
          this.loadProjectsForDropdown(clientId);
        }

        /** Called when project filter changes */
        onProjectChange(): void {
          this.currentPage = 1;
          this.vehicles = [];
          this.filteredVehicles = [];
          this.totalVehicles = 0;
          if (this.hasProjectSelected) {
            this.loadVehicles();
          }
        }

        get hasProjectSelected(): boolean {
          return !!this.selectedProject && this.selectedProject !== 'all';
        }
      projects: SelectOption[] = [];

      loadClientsForAdmin(): void {
        this.clientService.getClients()
          .pipe(
            take(1),
            catchError((error) => {
              console.error('Failed to load clients for vehicle filters:', error);
              return of([] as Array<{ id: string; name: string }>);
            }),
          )
          .subscribe((clients) => {
            const mappedClients = clients
              .map((client) => ({
                id: String(client.id ?? '').trim(),
                name: String(client.name ?? '').trim(),
              }))
              .filter((client) => client.id.length > 0 && client.name.length > 0)
              .sort((left, right) => left.name.localeCompare(right.name));

            this.clients = mappedClients;
          });
      }

      loadVehicles(): void {
        const requestVersion = ++this.vehiclesRequestVersion;
        this.isLoadingVehicles = true;

        const clientId = this.getSelectedClientIdForRequest();
        const selectedProjectId = Number(String(this.selectedProject ?? '').trim());
        const projectId =
          this.selectedProject !== 'all' && Number.isFinite(selectedProjectId) && selectedProjectId > 0
            ? selectedProjectId
            : undefined;

        if (!projectId) {
          this.vehicles = [];
          this.filteredVehicles = [];
          this.totalVehicles = 0;
          this.isLoadingVehicles = false;
          return;
        }

        this.clientDashboardService
          .getProjectVehicles(projectId, {
            ...(clientId ? { clientId } : {}),
          })
          .pipe(
            take(1),
            catchError((err) => {
              console.error('Failed to load vehicles:', err);
              return of(null);
            }),
          )
          .subscribe((response) => {
            if (requestVersion !== this.vehiclesRequestVersion) return;
            const items = extractArrayFromApiResponse(response);
            this.vehicles = this.mapApiVehicles(Array.isArray(items) ? items : [], projectId);
            this.totalVehicles = this.extractTotal(response, this.vehicles.length);
            this.filterVehicles();
            this.isLoadingVehicles = false;
          });
      }

      private extractTotal(response: any, fallback: number): number {
        if (response && typeof response === 'object') {
          const raw = response['totalCount'] ?? response['total'] ?? response['totalRecords'] ?? response['count'];
          const num = Number(raw);
          if (Number.isFinite(num) && num >= 0) return num;
        }
        return fallback;
      }

      private mapApiVehicles(items: unknown[], forcedProjectId?: number): Vehicle[] {
        const projectNameById = new Map<string, string>();
        this.projects.forEach((project) => {
          const id = String(project.id ?? '').trim();
          const name = String(project.name ?? '').trim();
          if (id && name) {
            projectNameById.set(id, name);
          }
        });

        const mappedVehicles = items
          .map((item): Vehicle | null => {
            const id = Number(getFirstDefinedValue(item, ['id', 'vehicleId', 'vehicleID', 'assetId', 'AssetId']) ?? 0);
            if (!Number.isFinite(id) || id <= 0) {
              return null;
            }

            const clientId = String(getFirstDefinedValue(item, ['clientId', 'ClientId', 'clientID', 'client_id']) ?? '').trim();
            const rawProjectId = String(getFirstDefinedValue(item, ['projectId', 'ProjectId', 'projectID', 'project_id']) ?? '').trim();
            const projectId = rawProjectId || (typeof forcedProjectId === 'number' ? String(forcedProjectId) : '');

            const fallbackClientName = toText(getFirstDefinedValue(item, ['clientName', 'ClientName', 'client']), '-');
            const resolvedProjectName = projectNameById.get(projectId) ?? toOptionalText(getFirstDefinedValue(item, ['projectName', 'ProjectName', 'project'])) ?? '-';

            const statusRaw = String(getFirstDefinedValue(item, ['status', 'inspectionStatus']) ?? '').trim().toLowerCase();
            const status: Vehicle['status'] =
              statusRaw === 'completed' || statusRaw === 'complete' || statusRaw === 'closed'
                ? 'completed'
                : statusRaw === 'in-progress' || statusRaw === 'inprogress' || statusRaw === 'ongoing'
                ? 'in-progress'
                : 'pending';

            // Helper to ensure dash for empty/invalid values
            const dashIfEmpty = (val: any) => {
              const str = String(val ?? '').trim();
              return str && str !== 'undefined' && str !== 'null' ? str : '-';
            };

            return {
              id,
              clientId: clientId || undefined,
              client: dashIfEmpty(this.clientService.resolveClientName(clientId, fallbackClientName)),
              projectId: projectId || undefined,
              project: dashIfEmpty(resolvedProjectName),
              fleetNumber: dashIfEmpty(getFirstDefinedValue(item, ['fleetNumber', 'FleetNumber', 'fleetNo', 'vehicleNumber', 'assetNumber'])),
              make: dashIfEmpty(getFirstDefinedValue(item, ['make', 'Make', 'manufacturer'])),
              model: dashIfEmpty(getFirstDefinedValue(item, ['model', 'Model'])),
              vin: dashIfEmpty(getFirstDefinedValue(item, ['vin', 'VIN', 'vehicleVin'])),
              mileageType: dashIfEmpty(getFirstDefinedValue(item, ['mileageType', 'MileageType', 'odometerType'])),
              propulsion: dashIfEmpty(getFirstDefinedValue(item, ['propulsionTypeName', 'PropulsionTypeName', 'propulsion', 'Propulsion', 'fuelType', 'FuelType'])),
              status,
              imageUrl: dashIfEmpty(getFirstDefinedValue(item, ['imageUrl', 'vehicleImage', 'thumbnailUrl', 'photoUrl'])) === '-' ? 'assets/images/faces/1.jpg' : dashIfEmpty(getFirstDefinedValue(item, ['imageUrl', 'vehicleImage', 'thumbnailUrl', 'photoUrl'])),
              inspectionDate: dashIfEmpty(getFirstDefinedValue(item, ['inspectionDate', 'updatedAt', 'createdAt'])),
              inspector: dashIfEmpty(getFirstDefinedValue(item, ['inspectorName', 'inspector', 'assignedTo'])),
            };
          })
          .filter((vehicle): vehicle is Vehicle => vehicle !== null);

        const hasValue = (value: string | undefined): boolean => {
          const text = String(value ?? '').trim();
          return text.length > 0 && text !== '-';
        };

        const choose = (left: string | undefined, right: string | undefined): string | undefined => {
          if (hasValue(right)) {
            return right;
          }
          return left;
        };

        const uniqueById = new Map<number, Vehicle>();
        mappedVehicles.forEach((vehicle) => {
          const existing = uniqueById.get(vehicle.id);
          if (!existing) {
            uniqueById.set(vehicle.id, vehicle);
            return;
          }

          uniqueById.set(vehicle.id, {
            ...existing,
            ...vehicle,
            fleetNumber: choose(existing.fleetNumber, vehicle.fleetNumber) ?? '-',
            make: choose(existing.make, vehicle.make) ?? '-',
            model: choose(existing.model, vehicle.model) ?? '-',
            propulsion: choose(existing.propulsion, vehicle.propulsion) ?? '-',
            mileageType: choose(existing.mileageType, vehicle.mileageType) ?? '-',
            vin: choose(existing.vin, vehicle.vin) ?? '-',
          });
        });

        return Array.from(uniqueById.values());
      }

      getSelectedClientIdForRequest(): number | undefined {
        const selectedClientId = String(this.selectedClient ?? '').trim();
        if (selectedClientId && selectedClientId.toLowerCase() !== 'all') {
          const parsedSelected = Number(selectedClientId);
          return Number.isFinite(parsedSelected) && parsedSelected > 0 ? parsedSelected : undefined;
        }

        if (!this.isAdminPortal && this.scopedClientId) {
          const parsedScoped = Number(this.scopedClientId);
          return Number.isFinite(parsedScoped) && parsedScoped > 0 ? parsedScoped : undefined;
        }

        return undefined;
      }

      private loadProjectsForDropdown(clientId?: number): void {
        const effectiveClientId = this.isAdminPortal ? clientId : this.getSelectedClientIdForRequest();

        this.clientDashboardService
          .getProjects({
            ...(typeof effectiveClientId === 'number' ? { clientId: effectiveClientId } : {}),
          })
          .pipe(
            map((response) => extractArrayFromApiResponse(response)),
            map((items: unknown[]) =>
              items
                .map((item): SelectOption | null => {
                  const id = String(
                    getFirstDefinedValue(item, ['id', 'projectId', 'projectID', 'ProjectId', 'ProjectID', 'project_id']) ?? '',
                  ).trim();
                  const name = String(getFirstDefinedValue(item, ['projectName', 'name', 'title', 'projectCode']) ?? '').trim();
                  if (!id || !name) {
                    return null;
                  }

                  return { id, name };
                })
                .filter((project): project is SelectOption => project !== null),
            ),
            catchError((error) => {
              console.error('Failed to load projects for vehicle filters:', error);
              return of([] as SelectOption[]);
            }),
            take(1),
          )
          .subscribe((projects) => {
            const uniqueById = new Map<string, SelectOption>();
            projects.forEach((project) => {
              if (!uniqueById.has(project.id)) {
                uniqueById.set(project.id, project);
              }
            });

            this.projects = Array.from(uniqueById.values())
              .sort((left, right) => left.name.localeCompare(right.name));

            const selectedProjectExists =
              this.selectedProject === 'all' ||
              this.projects.some((project) => normalizeId(project.id) === normalizeId(this.selectedProject));

            if (!selectedProjectExists) {
              this.selectedProject = 'all';
            }

            if (this.hasProjectSelected) {
              this.loadVehicles();
            }
          });
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
      const total = Math.ceil(this.totalVehicles / this.pageSize);
      return total > 0 ? total : 1;
    }

    get paginatedVehicles(): Vehicle[] {
      return this.filteredVehicles;
    }

    get visiblePages(): number[] {
      return buildPaginationItems(this.totalPages, this.currentPage, 5);
    }

    get pageStartItem(): number {
      if (!this.totalVehicles) return 0;
      return (this.currentPage - 1) * this.pageSize + 1;
    }

    get pageEndItem(): number {
      if (!this.totalVehicles) return 0;
      return Math.min(this.currentPage * this.pageSize, this.totalVehicles);
    }
  /** Card stats */
  totalVehicles: number = 0;
  totalTickets: number = 0;
  ticketStatusFilter: 'all' | 'open' | 'closed' = 'all';
  statCards: Array<{ label: string; value: number; icon: string }> = [];
  isLoadingVehicles: boolean = false;

  ngOnInit(): void {
    if (this.isAdminPortal) {
      this.loadClientsForAdmin();
      this.loadProjectsForDropdown();
    } else {
      if (this.scopedClientId) {
        this.clientService
          .getClientById(String(this.scopedClientId))
          .pipe(
            take(1),
            catchError((error) => {
              console.error('Failed to load scoped client for vehicle filters:', error);
              return of(null);
            }),
          )
          .subscribe((client) => {
            if (client) {
              const clientId = String(client.id ?? '').trim();
              const clientName = String(client.name ?? '').trim();

              if (clientId && clientName) {
                this.clients = [{ id: clientId, name: clientName }];
                this.selectedClient = clientId;
              }
            }

            this.loadProjectsForDropdown();
          });
      } else {
        this.loadProjectsForDropdown();
      }
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.loadVehicles();
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadVehicles();
    }
  }

  changePage(page: number): void {
    if (this.isPaginationNumber(page) && page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.loadVehicles();
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

  getPropulsionBadgeClass(propulsion: string | undefined): string {
    const normalized = String(propulsion ?? '').trim().toLowerCase();

    if (normalized === 'electric' || normalized === 'hybrid') {
      return 'badge bg-success-transparent';
    }

    if (normalized === 'cng') {
      return 'badge bg-warning-transparent';
    }

    if (normalized === 'diesel') {
      return 'badge bg-secondary-transparent';
    }

    if (normalized === 'gas' || normalized === 'gasoline' || normalized === 'petrol' || normalized === 'lpg') {
      return 'badge bg-info-transparent';
    }

    return 'badge bg-primary-transparent';
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
