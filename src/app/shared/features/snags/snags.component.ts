// ...existing code...
// ...existing imports and code...
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ClientService } from '../../services/client.service';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import {
  DashboardProjectOption,
  DashboardProjectsService,
  DashboardVehicleOption,
  DashboardVehicleOptionsResult,
} from '../../services/dashboard-projects.service';
import { UserManagementService } from '../../services/user-management.service';
import { buildPaginationItems, PAGINATION_ELLIPSIS } from '../../utils/pagination.utils';

interface SnagRow {
  id: string | number;
  snagNumber?: string;
  project?: string;
  projectId?: string | number;
  vehicle?: string;
  vehicleId?: string | number;
  category?: string;
  description?: string;
  inspector?: string;
  safetyCritical: boolean;
  repeater: boolean;
  hasImages: boolean;
  createdDate?: string;
  status?: string;
  selected?: boolean;
}

type SnagSortColumn = 'id' | 'project' | 'vehicle' | 'category' | 'inspector' | 'safetyCritical' | 'repeater';
type PaginationItem = number;

@Component({
  selector: 'app-snags',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="main-container container-fluid px-0">
      <!-- Page Header -->
      <div class="d-md-flex d-block align-items-center justify-content-between my-4 page-header-breadcrumb">
        <div>
          <h1 class="page-title fw-semibold fs-20 mb-1">Snags</h1>
          <p class="text-muted mb-0 fs-13">Monitor, triage, and act on snags across projects and vehicles.</p>
        </div>
        <div class="btn-list">
          <button class="btn btn-success-light btn-wave">
            <i class="ti ti-download me-2"></i>Export
          </button>
          <button class="btn btn-primary btn-wave">
            <i class="ti ti-plus me-2"></i>New Snag
          </button>
        </div>
      </div>

      <div class="row g-3">
        <!-- Filters -->
        <div class="col-xxl-8">
          <div class="card custom-card">
            <div class="card-body">
              <div class="row g-3">
                <div class="col-lg-6" *ngIf="showClientFilter">
                  <label class="form-label">Client</label>
                  <select class="form-select" [(ngModel)]="filters.client" (ngModelChange)="onClientFilterChange($event)">
                    <option *ngFor="let c of clientOptions" [value]="c.id">{{c.name}}</option>
                  </select>
                </div>
                <div [class]="showClientFilter ? 'col-lg-6' : 'col-lg-6'">
                  <label class="form-label">Project</label>
                  <select class="form-select" [(ngModel)]="filters.project" (ngModelChange)="onProjectFilterChange($event)">
                    <option *ngFor="let p of projectOptions" [value]="p.id">{{p.name}}</option>
                  </select>
                </div>
                <div class="col-lg-6">
                  <label class="form-label">Vehicle</label>
                  <select class="form-select" [(ngModel)]="filters.vehicle" (ngModelChange)="onVehicleFilterChange($event)">
                    <option *ngFor="let v of vehicleOptions" [value]="v.id">{{v.name}}</option>
                  </select>
                </div>
                <div class="col-lg-6">
                  <label class="form-label">Area</label>
                  <select class="form-select" [(ngModel)]="filters.area" (ngModelChange)="onAreaFilterChange($event)">
                    <option value="all">All Areas</option>
                    <option *ngFor="let a of areaOptions" [value]="a.id">{{a.name}}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Highlight Cards -->
        <div class="col-xxl-4">
          <div class="row g-3 h-100">
            <div class="col-sm-6 col-12">
              <div class="highlight-card bg-primary-01">
                <div class="d-flex justify-content-between align-items-center">
                  <div>
                    <p class="text-muted mb-1">Total Snags</p>
                    <h3 class="mb-0">{{totalCount}}</h3>
                  </div>
                  <div class="icon-badge bg-primary">
                    <i class="ti ti-alert-triangle"></i>
                  </div>
                </div>
              </div>
            </div>
            <div class="col-sm-6 col-12">
              <div class="highlight-card bg-danger-01">
                <div class="d-flex justify-content-between align-items-center">
                  <div>
                    <p class="text-muted mb-1">Safety Critical</p>
                    <h3 class="mb-0">{{safetyCriticalCount}}</h3>
                  </div>
                  <div class="icon-badge bg-danger">
                    <i class="ti ti-shield-lock"></i>
                  </div>
                </div>
              </div>
            </div>
            <div class="col-12">
              <div class="highlight-card bg-success-01">
                <div class="d-flex justify-content-between align-items-center">
                  <div>
                    <p class="text-muted mb-1">Selected</p>
                    <h3 class="mb-0">{{selectedCount}}</h3>
                  </div>
                  <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-success" (click)="checkAll()"><i class="ti ti-check me-1"></i>Check All</button>
                    <button class="btn btn-sm btn-outline-secondary" (click)="uncheckAll()">Uncheck</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Table Card -->
      <div class="row mt-3">
        <div class="col-xl-12">
          <div class="card custom-card">
            <div class="card-header justify-content-between">
              <div class="d-flex align-items-center gap-3">
                <div class="card-title">Snag Register</div>
                <span class="badge bg-primary-transparent">{{totalCount}} snags</span>
              </div>
              <div class="search-box">
                <input
                  type="text"
                  class="form-control"
                  placeholder="Search:"
                  [(ngModel)]="searchTerm"
                  (ngModelChange)="onSearchChange()">
              </div>
            </div>
            <div class="card-body project-table-body">
              <div *ngIf="isLoading" class="project-loader-overlay">
                <div class="d-flex flex-column align-items-center justify-content-center py-5">
                  <div class="spinner-border text-success" role="status">
                    <span class="visually-hidden">Loading...</span>
                  </div>
                  <p class="text-success mt-3 mb-0 fw-semibold">Loading snag data...</p>
                </div>
              </div>

              <ng-container *ngIf="!isLoading">
                <div class="table-responsive">
                  <table class="table text-nowrap table-hover border table-bordered">
                    <thead>
                      <tr>
                        <th style="width:48px;" class="text-center">
                          <input type="checkbox" class="form-check-input" [checked]="allSelected" (change)="toggleAll($event)">
                        </th>
                        <th scope="col" (click)="onSort('id')" style="cursor:pointer">
                          Snag # <span>{{getSortIndicator('id')}}</span>
                        </th>
                        <th scope="col" (click)="onSort('inspector')" style="cursor:pointer">
                          Inspector <span>{{getSortIndicator('inspector')}}</span>
                        </th>
                        <th scope="col" (click)="onSort('project')" style="cursor:pointer">
                          Project <span>{{getSortIndicator('project')}}</span>
                        </th>
                        <th scope="col" (click)="onSort('vehicle')" style="cursor:pointer">
                          Vehicle <span>{{getSortIndicator('vehicle')}}</span>
                        </th>
                        <th scope="col" (click)="onSort('category')" style="cursor:pointer">
                          Category <span>{{getSortIndicator('category')}}</span>
                        </th>
                        <th scope="col">Description</th>
                        <th scope="col" (click)="onSort('safetyCritical')" style="cursor:pointer">
                          Safety <span>{{getSortIndicator('safetyCritical')}}</span>
                        </th>
                        <th scope="col" (click)="onSort('repeater')" style="cursor:pointer">
                          Repeater <span>{{getSortIndicator('repeater')}}</span>
                        </th>
                        <th scope="col">Images</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr *ngIf="snags.length === 0">
                        <td colspan="11" class="text-center text-muted">No snags found.</td>
                      </tr>
                      <tr *ngFor="let snag of snags" [class.table-active]="snag.selected">
                        <td class="text-center">
                          <input type="checkbox" class="form-check-input" [(ngModel)]="snag.selected" (change)="updateSelection()">
                        </td>
                        <td class="fw-semibold">{{displayValue(snag.snagNumber)}}</td>
                        <td>{{displayValue(snag.inspector)}}</td>
                        <td><span class="badge bg-info-transparent">{{displayValue(snag.project)}}</span></td>
                        <td class="text-muted">{{displayValue(snag.vehicle)}}</td>
                        <td><span class="badge bg-secondary-transparent">{{displayValue(snag.category)}}</span></td>
                        <td class="text-truncate" style="max-width:260px;" [title]="displayValue(snag.description)">
                          {{displayValue(snag.description)}}
                        </td>
                        <td>
                          <span class="badge"
                            [class.bg-danger]="snag.safetyCritical"
                            [class.bg-light]="!snag.safetyCritical"
                            [style.color]="snag.safetyCritical ? 'white' : '#666'">
                            {{ snag.safetyCritical }}
                          </span>
                        </td>
                        <td>
                          <span class="badge"
                            [class.bg-danger]="snag.repeater"
                            [class.bg-light]="!snag.repeater"
                            [style.color]="snag.repeater ? 'white' : '#666'">
                            {{ snag.repeater }}
                          </span>
                        </td>
                        <td>
                          <i class="ti" [ngClass]="snag.hasImages ? 'ti-photo text-primary' : 'ti-photo-off text-muted'" style="cursor:pointer;"></i>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </ng-container>
            </div>
          </div>
        </div>
      </div>

      <!-- Pagination Card -->
      <div class="row">
        <div class="col-xl-12" *ngIf="!isLoading && totalCount > 0">
          <div class="card custom-card mt-3">
            <div class="card-footer">
              <div class="d-flex align-items-center">
                <div>Showing {{ pageStartItem }} to {{ pageEndItem }} of {{ totalCount }} Entries</div>
                <div class="ms-auto">
                  <nav aria-label="Page navigation" class="pagination-style-4" *ngIf="totalPages > 1">
                    <ul class="pagination mb-0">
                      <li class="page-item" [class.disabled]="currentPage === 1">
                        <a class="page-link" href="javascript:void(0);" (click)="previousPage()">Prev</a>
                      </li>
                      <li
                        class="page-item"
                        *ngFor="let page of visiblePages"
                        [class.active]="isPaginationNumber(page) && page === currentPage"
                        [class.disabled]="!isPaginationNumber(page)">
                        <a class="page-link" href="javascript:void(0);" (click)="isPaginationNumber(page) && changePage(page)">
                          {{ page === paginationEllipsis ? '...' : page }}
                        </a>
                      </li>
                      <li class="page-item" [class.disabled]="currentPage === totalPages">
                        <a class="page-link text-primary" href="javascript:void(0);" (click)="nextPage()">next</a>
                      </li>
                    </ul>
                  </nav>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .highlight-card {
      border-radius: 12px;
      padding: 14px;
      border: 1px solid var(--default-border);
      box-shadow: 0 8px 20px rgba(0,0,0,0.04);
    }
    .icon-badge {
      width: 40px; height: 40px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      box-shadow: 0 4px 10px rgba(0,0,0,0.12);
    }
    .bg-primary-01 { background: rgba(var(--primary-rgb), 0.08); }
    .bg-danger-01  { background: rgba(var(--danger-rgb),  0.08); }
    .bg-success-01 { background: rgba(var(--success-rgb), 0.08); }
  `]
})
export class SnagsComponent implements OnInit {
  readonly paginationEllipsis = PAGINATION_ELLIPSIS;

  snags: SnagRow[] = [];
  isLoading = false;
  totalCount = 0;
  safetyCriticalTotal = 0;
  currentPage = 1;
  readonly pageSize = 10;

  sortColumn: SnagSortColumn = 'id';
  sortDirection: 'asc' | 'desc' = 'desc';

  searchTerm = '';
  private searchDebounceTimer: any = null;

  filters = { client: 'all', project: 'all', vehicle: 'all', area: 'all' };
  areaOptions: Array<{ id: number; name: string }> = [
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

  clientOptions: Array<{ id: string; name: string }> = [{ id: 'all', name: 'All Clients' }];
  projectOptions: DashboardProjectOption[] = [{ id: 'all', name: 'All Projects' }];
  vehicleOptions: DashboardVehicleOption[] = [{ id: 'all', name: 'Select project first' }];

  private userMap = new Map<number, string>();
  private projectMap = new Map<string, string>();

  constructor(
    private authService: AuthService,
    private clientService: ClientService,
    private clientDashboardService: ClientDashboardService,
    private dashboardProjectsService: DashboardProjectsService,
    private userManagementService: UserManagementService,
  ) {}

  ngOnInit(): void {
    this.userManagementService.getUsers({ page: 1, pageSize: 10000, role: '', clientId: '0', manufacturerId: '0' })
      .subscribe({ next: (result) => result.items.forEach((u) => this.userMap.set(u.id, u.username)) });
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

  private getEffectiveClientId(): number | undefined {
    if (!this.isAdminRole) return this.getCurrentUserClientId();
    if (!this.filters.client || this.filters.client === 'all') return undefined;
    const parsed = Number(this.filters.client);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private loadClientFilterOptions(): void {
    if (!this.isAdminRole) {
      const userClientId = this.getCurrentUserClientId();
      this.filters.client = userClientId ? String(userClientId) : 'all';
      this.clientOptions = userClientId ? [{ id: String(userClientId), name: 'My Client' }] : [];
      this.loadProjectsFromApi();
      return;
    }
    this.clientService.getClients().subscribe({
      next: (clients) => {
        const mapped = clients
          .map((c) => ({ id: String(c.id ?? '').trim(), name: String(c.name ?? '').trim() }))
          .filter((c) => c.id && c.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        this.clientOptions = [{ id: 'all', name: 'All Clients' }, ...mapped];
        this.filters.client = 'all';
        this.loadProjectsFromApi();
      },
      error: () => {
        this.clientOptions = [{ id: 'all', name: 'All Clients' }];
        this.filters.client = 'all';
        this.loadProjectsFromApi();
      },
    });
  }

  onClientFilterChange(clientId: string): void {
    if (!this.isAdminRole) return;
    this.filters.client = clientId || 'all';
    this.filters.project = 'all';
    this.filters.vehicle = 'all';
    this.vehicleOptions = [{ id: 'all', name: 'Select project first' }];
    this.loadProjectsFromApi();
  }

  private loadProjectsFromApi(): void {
    this.dashboardProjectsService.getProjectOptions({
      clientId: this.getEffectiveClientId(),
      includeClosed: true,
      page: 1,
      pageSize: 10000,
    }).subscribe({
      next: (projects: DashboardProjectOption[]) => {
        this.projectOptions = projects.length ? projects : [{ id: 'all', name: 'All Projects' }];
        this.projectOptions.forEach((p) => { if (p.id !== 'all') this.projectMap.set(p.id, p.name); });
        const exists = this.projectOptions.some((p) => p.id === this.filters.project);
        if (!exists) this.filters.project = 'all';
        if (this.filters.project !== 'all') {
          this.loadVehiclesByProject(this.filters.project);
        } else {
          this.vehicleOptions = [{ id: 'all', name: 'Select project first' }];
          this.filters.vehicle = 'all';
        }
        this.currentPage = 1;
        this.fetchSnagsFromApi();
      },
      error: () => {
        this.projectOptions = [{ id: 'all', name: 'All Projects' }];
        this.vehicleOptions = [{ id: 'all', name: 'Select project first' }];
        this.filters.project = 'all';
        this.filters.vehicle = 'all';
        this.currentPage = 1;
        this.fetchSnagsFromApi();
      },
    });
  }

  private loadVehiclesByProject(projectId: string): void {
    const clientId = this.getEffectiveClientId();
    const userId = this.authService.currentUserValue?.userId;
    this.dashboardProjectsService.getVehicleOptionsByProjectResult(projectId, { clientId, userId })
      .subscribe({
        next: (result: DashboardVehicleOptionsResult) => {
          this.vehicleOptions = result.options.length ? result.options : [{ id: 'all', name: 'All Vehicles' }];
          const exists = this.vehicleOptions.some((v) => v.id === this.filters.vehicle);
          if (!exists) this.filters.vehicle = 'all';
        },
        error: () => {
          this.vehicleOptions = [{ id: 'all', name: 'All Vehicles' }];
          this.filters.vehicle = 'all';
        },
      });
  }

  onProjectFilterChange(projectId: string): void {
    this.filters.project = projectId || 'all';
    this.filters.vehicle = 'all';
    if (this.filters.project === 'all') {
      this.vehicleOptions = [{ id: 'all', name: 'Select project first' }];
    } else {
      this.loadVehiclesByProject(this.filters.project);
    }
    this.currentPage = 1;
    this.fetchSnagsFromApi();
  }

  onVehicleFilterChange(vehicleId: string): void {
    this.filters.vehicle = vehicleId || 'all';
    this.currentPage = 1;
    this.fetchSnagsFromApi();
  }

  // ── Sort ────────────────────────────────────────────────────────────────────

  onSort(column: SnagSortColumn): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.currentPage = 1;
    this.fetchSnagsFromApi();
  }

  getSortIndicator(column: SnagSortColumn): string {
    if (this.sortColumn !== column) return '';
    return this.sortDirection === 'asc' ? '▲' : '▼';
  }

  private columnToApiField(column: SnagSortColumn): string {
    const map: Record<SnagSortColumn, string> = {
      id: 'id',
      project: 'projectName',
      vehicle: 'vehicleName',
      category: 'categoryName',
      inspector: 'inspector',
      safetyCritical: 'safetyCritical',
      repeater: 'repeater',
    };
    return map[column] ?? 'id';
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  onSearchChange(): void {
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.currentPage = 1;
      this.fetchSnagsFromApi();
    }, 400);
  }

  // ── API fetch ───────────────────────────────────────────────────────────────

  private fetchSnagsFromApi(): void {
    const projectId = this.filters.project === 'all' ? undefined : Number(this.filters.project) || undefined;
    const vehicleId = this.filters.vehicle === 'all' ? undefined : Number(this.filters.vehicle) || undefined;
    const clientId = this.getEffectiveClientId();
    const categoryId = this.filters.area !== 'all' ? Number(this.filters.area) || undefined : undefined;

    this.isLoading = true;
    const params: any = {
      clientId,
      projectId,
      vehicleId,
      pageNumber: this.currentPage,
      pageSize: this.pageSize,
      orderBy: this.columnToApiField(this.sortColumn),
      orderDirection: this.sortDirection,
    };
    if (categoryId) params.finalInspectionCategory = categoryId;
    if (this.searchTerm?.trim()) params.search = this.searchTerm.trim();

    const scCountParams = { ...params, safetyCritical: true, pageSize: 1, pageNumber: 1 };

    this.clientDashboardService.getSnags(params).subscribe({
      next: (response: unknown) => {
        const { items, total, safetyCritical } = this.normalizeSnagResponse(response);
        this.snags = items.map((item: any) => this.mapApiSnagToRow(item));
        this.totalCount = total;
        if (safetyCritical >= 0) {
          this.safetyCriticalTotal = safetyCritical;
          this.isLoading = false;
        } else {
          this.clientDashboardService.getSnags(scCountParams).subscribe({
            next: (scResp: unknown) => {
              const { total: scTotal } = this.normalizeSnagResponse(scResp);
              this.safetyCriticalTotal = scTotal;
              this.isLoading = false;
            },
            error: () => { this.safetyCriticalTotal = 0; this.isLoading = false; },
          });
        }
      },
      error: () => {
        this.snags = [];
        this.totalCount = 0;
        this.safetyCriticalTotal = 0;
        this.isLoading = false;
      },
    });
  }

  // ── Area Filter ───────────────────────────────────────────────────────────
  onAreaFilterChange(area: string): void {
    this.filters.area = area || 'all';
    this.currentPage = 1;
    this.fetchSnagsFromApi();
  }

  private normalizeSnagResponse(raw: unknown): { items: any[]; total: number; safetyCritical: number } {
    const readSafetyCritical = (o: Record<string, unknown>) =>
      Number(o['safetyCriticalCount'] ?? o['safetyCriticalTotal'] ?? o['criticalCount'] ?? -1);

    if (Array.isArray(raw)) return { items: raw, total: raw.length, safetyCritical: -1 };
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const total = Number(obj['totalCount'] ?? obj['total'] ?? obj['totalItems'] ?? obj['count'] ?? 0);
      const sc = readSafetyCritical(obj);
      if (Array.isArray(obj['items']))   return { items: obj['items']   as any[], total, safetyCritical: sc };
      if (Array.isArray(obj['snags']))   return { items: obj['snags']   as any[], total, safetyCritical: sc };
      if (Array.isArray(obj['results'])) return { items: obj['results'] as any[], total, safetyCritical: sc };
      if (Array.isArray(obj['data']))    return { items: obj['data']    as any[], total, safetyCritical: sc };
      if (obj['data'] && typeof obj['data'] === 'object') {
        const data = obj['data'] as Record<string, unknown>;
        const dt = Number(data['totalCount'] ?? data['total'] ?? data['totalItems'] ?? total);
        const dsc = readSafetyCritical(data);
        if (Array.isArray(data['items']))   return { items: data['items']   as any[], total: dt, safetyCritical: dsc };
        if (Array.isArray(data['snags']))   return { items: data['snags']   as any[], total: dt, safetyCritical: dsc };
        if (Array.isArray(data['results'])) return { items: data['results'] as any[], total: dt, safetyCritical: dsc };
      }
    }
    return { items: [], total: 0, safetyCritical: -1 };
  }

  private getVal(source: any, keys: string[]): any {
    if (!source || typeof source !== 'object') return undefined;
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
    }
    const lower: Record<string, any> = {};
    for (const [k, v] of Object.entries(source as Record<string, any>)) lower[k.toLowerCase()] = v;
    for (const key of keys) {
      const v = lower[key.toLowerCase()];
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }

  private mapApiSnagToRow(item: any): SnagRow {
    return {
      id:          this.getVal(item, ['id', 'snagId', 'snagID']) ?? '-',
      snagNumber:  this.getVal(item, ['snagNumber', 'snagNo', 'uniqueId']),
      project:     this.projectMap.get(String(this.getVal(item, ['projectId']) ?? '')) ?? this.getVal(item, ['projectId']),
      projectId:   this.getVal(item, ['projectId']),
      vehicle:     this.getVal(item, ['vehicleId']),
      vehicleId:   this.getVal(item, ['vehicleId']),
      category:    this.getVal(item, ['finalInspectionCategoryName']),
      description: this.getVal(item, ['description', 'snagDescription', 'notes']) ?? '-',
      inspector:   this.userMap.get(Number(this.getVal(item, ['userId']))) ?? this.getVal(item, ['userId']),
      // area removed
      safetyCritical: Boolean(this.getVal(item, ['safetyCritical', 'isSafetyCritical', 'safety_critical']) ?? false),
      repeater:    Boolean(this.getVal(item, ['repeater', 'isRepeater', 'repeated']) ?? false),
      hasImages:   Boolean(this.getVal(item, ['hasImages', 'hasImage']) ?? Number(this.getVal(item, ['imageCount']) ?? 0) > 0),
      createdDate: this.getVal(item, ['createdDate', 'created_at', 'createdAt', 'dateCreated']),
      status:      this.getVal(item, ['status', 'snagStatus', 'statusName']),
      selected:    false,
    };
  }

  // ── Pagination ──────────────────────────────────────────────────────────────

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  get visiblePages(): PaginationItem[] {
    return buildPaginationItems(this.totalPages, this.currentPage, 5);
  }

  isPaginationNumber(page: PaginationItem): page is number {
    return page !== this.paginationEllipsis;
  }

  get pageStartItem(): number {
    if (!this.totalCount) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEndItem(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalCount);
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.fetchSnagsFromApi();
  }

  previousPage(): void { this.changePage(this.currentPage - 1); }
  nextPage():     void { this.changePage(this.currentPage + 1); }

  // ── Selection & stats ───────────────────────────────────────────────────────

  get selectedCount():       number  { return this.snags.filter((s) => s.selected).length; }
  get safetyCriticalCount(): number  { return this.safetyCriticalTotal; }
  get allSelected():         boolean { return this.snags.length > 0 && this.snags.every((s) => s.selected); }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.snags.forEach((s) => (s.selected = checked));
  }

  checkAll():        void { this.snags.forEach((s) => (s.selected = true));  this.snags = [...this.snags]; }
  uncheckAll():      void { this.snags.forEach((s) => (s.selected = false)); this.snags = [...this.snags]; }
  updateSelection(): void { this.snags = [...this.snags]; }

  displayValue(value: unknown): string {
    if (value === undefined || value === null) return '-';
    return String(value).trim() || '-';
  }
}
