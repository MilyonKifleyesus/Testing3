import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ClientDashboardService } from '../../../shared/services/client-dashboard.service';
import { UserManagementService } from '../../../shared/services/user-management.service';

interface DropdownOption { id: number | string; name: string; }

interface SnagRow {
  id:             number | string;
  number:         string;
  projectId:      number | string;
  project:        string;
  vehicleId:      number | string;
  vehicle:        string;
  category:       string;
  description:    string;
  inspectorId?:   number;
  inspector:      string;
  safetyCritical: boolean;
  repeater:       boolean;
  hasImages:      boolean;
  selected?:      boolean;
}

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
                <div class="col-lg-6">
                  <label class="form-label">Project</label>
                  <select class="form-select" [(ngModel)]="filters.projectId" (ngModelChange)="onProjectChange($event)">
                    <option value="">All Projects</option>
                    <option *ngFor="let p of projectOptions" [value]="p.id">{{p.name}}</option>
                  </select>
                </div>
                <div class="col-lg-6">
                  <label class="form-label">Vehicle</label>
                  <select class="form-select" [(ngModel)]="filters.vehicleId" (ngModelChange)="onFilterChange()">
                    <option value="">All Vehicles</option>
                    <option *ngFor="let v of vehicleOptions" [value]="v.id">{{v.name}}</option>
                  </select>
                </div>
                <div class="col-lg-6">
                  <label class="form-label">Area</label>
                  <select class="form-select" [(ngModel)]="filters.areaId" (ngModelChange)="onFilterChange()">
                    <option value="">All Areas</option>
                    <option *ngFor="let a of areaOptions" [value]="a.id">{{a.name}}</option>
                  </select>
                </div>
                <div class="col-lg-6">
                  <label class="form-label">Inspector</label>
                  <select class="form-select" [(ngModel)]="filters.inspectorId" (ngModelChange)="onFilterChange()">
                    <option value="">All Inspectors</option>
                    <option *ngFor="let ins of inspectorOptions" [value]="ins.id">{{ins.name}}</option>
                  </select>
                </div>
                <div class="col-lg-6 d-flex align-items-center gap-3">
                  <div class="input-group input-group-sm">
                    <span class="input-group-text"><i class="ti ti-search"></i></span>
                    <input class="form-control" placeholder="Search snags..." [(ngModel)]="filters.search" (ngModelChange)="onSearchChange()">
                  </div>
                </div>
                <div class="col-lg-6 d-flex align-items-center">
                  <input class="form-check-input me-2" type="checkbox" id="includeImages" [(ngModel)]="filters.includeImages">
                  <label class="form-check-label" for="includeImages">Include Images</label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Highlights -->
        <div class="col-xxl-4">
          <div class="row g-3 h-100">
            <div class="col-12">
              <div class="highlight-card bg-success-01">
                <div class="d-flex justify-content-between align-items-center">
                  <div>
                    <p class="text-muted mb-1">Selected</p>
                    <h3 class="mb-0">{{selectedCount}}</h3>
                    <p class="text-muted mb-0 fs-12 mt-1">Total: {{isLoading ? '—' : totalCount}}</p>
                  </div>
                  <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-success" (click)="checkAll()" [disabled]="isPrintLoading">
                      <span *ngIf="isPrintLoading" class="spinner-border spinner-border-sm me-1" role="status"></span>
                      <i *ngIf="!isPrintLoading" class="ti ti-check me-1"></i>Check All
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" (click)="uncheckAll()" [disabled]="isPrintLoading">Uncheck</button>
                    <button class="btn btn-sm btn-primary" (click)="printSelectedSnags()" [disabled]="selectedCount === 0 || isPrintLoading">
                      <i class="ti ti-printer me-1"></i>Print
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Table Card -->
      <div class="card custom-card mt-3">
        <div class="card-header flex-wrap gap-2">
<div class="ms-auto d-flex gap-2 flex-wrap align-items-center">
            <span *ngIf="isLoading" class="spinner-border spinner-border-sm text-primary" role="status"></span>
          </div>
        </div>
        <div class="card-body p-0" style="position:relative;">
          <!-- Loading overlay -->
          <div *ngIf="isLoading" style="position:absolute;inset:0;background:rgba(255,255,255,0.6);z-index:10;display:flex;align-items:center;justify-content:center;">
            <div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div>
          </div>

          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th style="width:48px" class="text-center">
                    <input type="checkbox" class="form-check-input" [checked]="allSelected" (change)="toggleAll($event)">
                  </th>
                  <th (click)="onSort('id')" style="cursor:pointer">Snag # {{getSortIcon('id')}}</th>
                  <th (click)="onSort('userId')" style="cursor:pointer">Inspector {{getSortIcon('userId')}}</th>
                  <th (click)="onSort('projectId')" style="cursor:pointer">Project {{getSortIcon('projectId')}}</th>
                  <th (click)="onSort('vehicleId')" style="cursor:pointer">Vehicle {{getSortIcon('vehicleId')}}</th>
                  <th (click)="onSort('finalInspectionCategory')" style="cursor:pointer">Category {{getSortIcon('finalInspectionCategory')}}</th>
                  <th (click)="onSort('description')" style="cursor:pointer">Description {{getSortIcon('description')}}</th>
                  <th (click)="onSort('safetyCritical')" style="cursor:pointer">Safety {{getSortIcon('safetyCritical')}}</th>
                  <th (click)="onSort('repeater')" style="cursor:pointer">Repeater {{getSortIcon('repeater')}}</th>
                  <th>Images</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of displayedSnags" [class.table-active]="row.selected">
                  <td class="text-center">
                    <input type="checkbox" class="form-check-input" [(ngModel)]="row.selected" (change)="updateSelection(row)">
                  </td>
                  <td class="fw-semibold">{{row.number}}</td>
                  <td>{{row.inspector}}</td>
                  <td><span class="badge bg-info-transparent">{{row.project}}</span></td>
                  <td class="text-muted">{{row.vehicle}}</td>
                  <td><span class="badge bg-secondary-transparent">{{row.category}}</span></td>
                  <td class="text-truncate" style="max-width:260px" title="{{row.description}}">{{row.description}}</td>
                  <td>
                    <span class="badge" [class.bg-danger-transparent]="row.safetyCritical" [class.bg-success-transparent]="!row.safetyCritical">
                      {{row.safetyCritical ? 'Critical' : 'Normal'}}
                    </span>
                  </td>
                  <td>
                    <span class="badge" [class.bg-warning-transparent]="row.repeater" [class.bg-light]="!row.repeater">
                      {{row.repeater ? 'True' : 'False'}}
                    </span>
                  </td>
                  <td>
                    <i class="ti" [ngClass]="row.hasImages ? 'ti-photo text-primary' : 'ti-photo-off text-muted'"></i>
                  </td>
                </tr>
                <tr *ngIf="!isLoading && displayedSnags.length === 0">
                  <td colspan="10" class="text-center py-4 text-muted">No snags found.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Pagination -->
        <div class="card-footer" *ngIf="totalPages > 1">
          <div class="d-flex align-items-center">
            <div class="text-muted small">Showing {{pageStartItem}}–{{pageEndItem}} of {{totalCount}}</div>
            <div class="ms-auto">
              <nav>
                <ul class="pagination mb-0 pagination-style-4">
                  <li class="page-item" [class.disabled]="currentPage === 1">
                    <a class="page-link" href="javascript:void(0)" (click)="changePage(currentPage - 1)">Prev</a>
                  </li>
                  <li *ngFor="let p of visiblePages" class="page-item"
                      [class.active]="p === currentPage" [class.disabled]="p === '...'">
                    <a class="page-link" href="javascript:void(0)" (click)="p !== '...' && changePage(+p)">{{p}}</a>
                  </li>
                  <li class="page-item" [class.disabled]="currentPage === totalPages">
                    <a class="page-link text-primary" href="javascript:void(0)" (click)="changePage(currentPage + 1)">Next</a>
                  </li>
                </ul>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .highlight-card {
      border-radius: 12px; padding: 14px;
      border: 1px solid var(--default-border);
      box-shadow: 0 8px 20px rgba(0,0,0,0.04);
    }
    .icon-badge {
      width: 40px; height: 40px; border-radius: 12px;
      display: inline-flex; align-items: center; justify-content: center;
      color: #fff; box-shadow: 0 4px 10px rgba(0,0,0,0.12);
    }
    .bg-primary-01 { background: rgba(var(--primary-rgb), 0.08); }
    .bg-danger-01  { background: rgba(var(--danger-rgb),  0.08); }
    .bg-success-01 { background: rgba(var(--success-rgb), 0.08); }
    th[style*="cursor:pointer"]:hover { background: rgba(0,0,0,0.03); }
  `]
})
export class SnagsComponent implements OnInit, OnDestroy {

  readonly areaOptions: DropdownOption[] = [
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

  projectOptions: DropdownOption[] = [];
  vehicleOptions: DropdownOption[] = [];
  inspectorOptions: DropdownOption[] = [];

  private projectMap = new Map<number | string, string>();
  private vehicleMap = new Map<number | string, string>();
  private readonly areaMap = new Map<number | string, string>(
    this.areaOptions.map(a => [a.id, a.name])
  );

  filters = {
    projectId:     '' as string | number,
    vehicleId:     '' as string | number,
    areaId:        '' as string | number,
    inspectorId:   '' as string | number,
    search:        '',
    includeImages: false,
  };

  isLoading      = false;
  isPrintLoading = false;
  snags: SnagRow[] = [];
  totalCount     = 0;
  currentPage    = 1;
  readonly pageSize = 10;

  sortColumn:    string = 'id';
  sortDirection: 'asc' | 'desc' = 'desc';

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private selectedMap = new Map<string, SnagRow>();

  get displayedSnags(): SnagRow[] {
    return this.filters.includeImages ? this.snags.filter(s => s.hasImages) : this.snags;
  }

  get selectedCount():       number { return this.selectedMap.size; }

  get allSelected(): boolean {
    return this.snags.length > 0 && this.snags.every(s => s.selected);
  }

  get totalPages(): number { return Math.max(1, Math.ceil(this.totalCount / this.pageSize)); }

  get pageStartItem(): number { return this.totalCount ? (this.currentPage - 1) * this.pageSize + 1 : 0; }
  get pageEndItem():   number { return Math.min(this.currentPage * this.pageSize, this.totalCount); }

  get visiblePages(): (number | string)[] {
    const total = this.totalPages;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: (number | string)[] = [1];
    if (this.currentPage > 3) pages.push('...');
    for (let i = Math.max(2, this.currentPage - 1); i <= Math.min(total - 1, this.currentPage + 1); i++) pages.push(i);
    if (this.currentPage < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  }

  private userIdToName = new Map<number, string>();
  private vehicleIdToFleet = new Map<number, string>();

  constructor(private svc: ClientDashboardService, private userManagementService: UserManagementService) {}

  ngOnInit(): void {
    this.loadProjects();
    this.loadInspectors();
    this.fetchSnags();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  private loadProjects(): void {
    this.svc.getProjects({}).subscribe({
      next: (raw) => {
        const items = this.extractItems(raw);
        this.projectOptions = items.map((p: any) => ({
          id:   p.projectId ?? p.id,
          name: p.projectName ?? p.name ?? String(p.projectId ?? p.id),
        }));
        this.projectOptions.forEach(p => this.projectMap.set(p.id, p.name));
        // Re-apply project names to already-loaded snags (race condition fix)
        this.snags = this.snags.map(s => ({
          ...s,
          project: this.projectMap.get(s.projectId) ?? s.project,
        }));
      },
    });
  }

  private loadInspectors(): void {
    this.userManagementService.getUsers({ page: 1, pageSize: 1000, role: 'inspector', clientId: '', manufacturerId: '' }).subscribe({
      next: (result) => {
        this.inspectorOptions = result.items.map(u => ({ id: u.id, name: u.userName || u.name || String(u.id) }));
        result.items.forEach(u => this.userIdToName.set(u.id, u.userName || u.name || String(u.id)));
      },
    });
  }

  private loadVehicles(projectId: number | string): void {
    this.vehicleOptions = [];
    this.svc.getProjectVehicles(Number(projectId), { pageSize: 10000 }).subscribe({
      next: (raw) => {
        const items = this.extractItems(raw);
        this.vehicleOptions = items.map((v: any) => ({
          id:   v.vehicleId ?? v.id,
          name: v.fleetNumber ?? v.fleetNo ?? v.vehicleName ?? v.name ?? v.vehicleNumber ?? String(v.vehicleId ?? v.id),
        }));
        this.vehicleOptions.forEach(v => this.vehicleMap.set(v.id, v.name));
      },
    });
  }

  onProjectChange(projectId: string | number): void {
    this.filters.vehicleId = '';
    this.vehicleOptions    = [];
    if (projectId) this.loadVehicles(projectId);
    this.onFilterChange();
  }

  onFilterChange(): void {
    this.currentPage = 1;
    this.fetchSnags();
  }

  onSearchChange(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.currentPage = 1; this.fetchSnags(); }, 400);
  }

  private buildParams(page: number, size: number): Record<string, any> {
    const p: Record<string, any> = {
      pageNumber:     page,
      pageSize:       size,
      orderBy:        this.sortColumn,
      orderDirection: this.sortDirection,
    };
    if (this.filters.projectId)      p['projectId']               = Number(this.filters.projectId);
    if (this.filters.vehicleId)      p['vehicleId']               = Number(this.filters.vehicleId);
    if (this.filters.areaId)         p['finalInspectionCategory'] = Number(this.filters.areaId);
    if (this.filters.inspectorId)    p['userId']                  = Number(this.filters.inspectorId);
    if (this.filters.search?.trim()) p['snagNumber']              = this.filters.search.trim();
    return p;
  }

  private fetchSnags(): void {
    this.isLoading = true;
    this.svc.getSnags(this.buildParams(this.currentPage, this.pageSize)).subscribe({
      next: (raw) => {
        const { items, total } = this.normalizeResponse(raw);
        this.totalCount = total;
        this.snags = items.map((item: any) => this.mapToRow(item));
        this.snags.forEach(s => { if (this.selectedMap.has(String(s.id))) s.selected = true; });
        this.resolveInspectorNames();
        this.resolveVehicleFleetNumbers();
        this.isLoading = false;
      },
      error: () => { this.snags = []; this.totalCount = 0; this.isLoading = false; },
    });
  }

  onSort(col: string): void {
    this.sortDirection = this.sortColumn === col
      ? (this.sortDirection === 'asc' ? 'desc' : 'asc')
      : 'asc';
    this.sortColumn  = col;
    this.currentPage = 1;
    this.fetchSnags();
  }

  getSortIcon(col: string): string {
    return this.sortColumn !== col ? '' : this.sortDirection === 'asc' ? '▲' : '▼';
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.fetchSnags();
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.snags.forEach(s => {
      s.selected = checked;
      checked ? this.selectedMap.set(String(s.id), s) : this.selectedMap.delete(String(s.id));
    });
  }

  updateSelection(row: SnagRow): void {
    row.selected ? this.selectedMap.set(String(row.id), row) : this.selectedMap.delete(String(row.id));
  }

  checkAll(): void {
    this.isPrintLoading = true;
    this.svc.getSnags(this.buildParams(1, this.totalCount || 10000)).subscribe({
      next: (raw) => {
        const { items } = this.normalizeResponse(raw);
        items.forEach((item: any) => {
          const row = this.mapToRow(item);
          row.selected = true;
          this.selectedMap.set(String(row.id), row);
        });
        this.snags.forEach(s => s.selected = true);
        this.snags = [...this.snags];
        this.isPrintLoading = false;
      },
      error: () => {
        this.snags.forEach(s => { s.selected = true; this.selectedMap.set(String(s.id), s); });
        this.snags = [...this.snags];
        this.isPrintLoading = false;
      },
    });
  }

  uncheckAll(): void {
    this.selectedMap.clear();
    this.snags.forEach(s => s.selected = false);
    this.snags = [...this.snags];
  }

  printSelectedSnags(): void {
    const selected = Array.from(this.selectedMap.values());
    if (!selected.length) return;

    const grouped = new Map<string, SnagRow[]>();
    for (const snag of selected) {
      const cat = snag.category || '—';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(snag);
    }

    const inspectorName = selected[0]?.inspector || '—';
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });

    let tablesHtml = '';
    for (const [category, list] of grouped) {
      const rows = list.map((s, i) => `
        <tr>
          <td>${i + 1}</td>
          <td style="text-align:left">${s.description || '—'}</td>
          <td>${s.safetyCritical ? 'Yes' : 'No'}</td>
          <td></td><td></td><td></td><td></td>
        </tr>`).join('');
      tablesHtml += `
        <table>
          <thead><tr>
            <th>SR No.</th><th>${category} Description</th><th>Safety Critical</th>
            <th>Prod Sign Off</th><th>NG</th><th>Prod Sign Off</th><th>Inspector Buyoff</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    const html = `<!DOCTYPE html><html><head><title>Customer Identified Defects</title>
<style>
  body{font-family:Arial,sans-serif;margin:28px;font-size:12px}
  h1{text-align:center;font-size:22px;font-weight:bold;text-transform:uppercase;margin-bottom:24px}
  .meta p{margin:2px 0;font-size:12px} .meta strong{font-weight:bold}
  table{width:100%;border-collapse:collapse;margin-top:18px}
  th{border:1px solid #333;padding:5px 7px;background:#f5f5f5;font-size:11px;text-align:center;font-weight:bold}
  td{border:1px solid #333;padding:5px 7px;font-size:11px;text-align:center;vertical-align:top}
  @media print{@page{margin:15mm}}
</style></head><body>
  <h1>Customer Identified Defects</h1>
  <div class="meta">
    <p>Inspector: <strong>${inspectorName}</strong></p>
    <p><strong>Date: ${today} &nbsp; LF64 Fleet #: &nbsp; Frame #: &nbsp; VIN #:</strong></p>
  </div>
  ${tablesHtml}
</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (win) win.addEventListener('load', () => { win.print(); URL.revokeObjectURL(url); });
  }

  private resolveVehicleFleetNumbers(): void {
    const vehIds = Array.from(new Set(
      this.snags.map(s => s.vehicleId).filter((id): id is number => typeof id === 'number' && id > 0)
    ));
    if (!vehIds.length) return;

    const applyFleet = () => {
      this.snags = this.snags.map(s => ({
        ...s,
        vehicle: (typeof s.vehicleId === 'number' && this.vehicleIdToFleet.has(s.vehicleId))
          ? this.vehicleIdToFleet.get(s.vehicleId)!
          : s.vehicle,
      }));
    };

    const uncached = vehIds.filter(id => !this.vehicleIdToFleet.has(id));
    if (!uncached.length) { applyFleet(); return; }

    forkJoin(
      uncached.map(id => this.svc.getVehicleById(id).pipe(catchError(() => of(null))))
    ).subscribe(vehicles => {
      vehicles.forEach((v, i) => {
        if (v) {
          const fleet = v?.fleetNumber ?? v?.fleetNo ?? v?.vehicleFleetNumber ?? v?.vehicleName ?? v?.vehicleNumber ?? String(uncached[i]);
          this.vehicleIdToFleet.set(uncached[i], fleet);
          this.vehicleMap.set(uncached[i], fleet);
        }
      });
      applyFleet();
    });
  }

  private resolveInspectorNames(): void {
    const userIds = Array.from(new Set(
      this.snags.map(s => s.inspectorId).filter((id): id is number => typeof id === 'number' && id > 0)
    ));
    if (!userIds.length) return;

    const applyNames = () => {
      this.snags = this.snags.map(s => ({
        ...s,
        inspector: s.inspectorId && this.userIdToName.has(s.inspectorId)
          ? this.userIdToName.get(s.inspectorId)!
          : s.inspector,
      }));
    };

    const uncached = userIds.filter(id => !this.userIdToName.has(id));
    if (!uncached.length) { applyNames(); return; }

    forkJoin(
      uncached.map(id => this.userManagementService.getUserById(id).pipe(catchError(() => of(null))))
    ).subscribe(users => {
      users.forEach((user, i) => {
        if (user) this.userIdToName.set(uncached[i], user.userName || user.name || String(uncached[i]));
      });
      applyNames();
    });
  }

  private normalizeResponse(raw: unknown): { items: any[]; total: number } {
    if (Array.isArray(raw)) return { items: raw, total: raw.length };
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const total = Number(obj['totalCount'] ?? obj['total'] ?? obj['totalItems'] ?? obj['count'] ?? 0);
      for (const key of ['items', 'snags', 'results', 'data'] as const) {
        if (Array.isArray(obj[key])) return { items: obj[key] as any[], total };
      }
      if (obj['data'] && typeof obj['data'] === 'object' && !Array.isArray(obj['data'])) {
        const d = obj['data'] as Record<string, unknown>;
        const dt = Number(d['totalCount'] ?? d['total'] ?? total);
        for (const key of ['items', 'snags', 'results'] as const) {
          if (Array.isArray(d[key])) return { items: d[key] as any[], total: dt };
        }
      }
    }
    return { items: [], total: 0 };
  }

  private extractItems(raw: unknown): any[] { return this.normalizeResponse(raw).items; }

  private mapToRow(item: any): SnagRow {
    const id     = item?.id ?? item?.snagId ?? item?.snagID ?? '-';
    const projId = item?.projectId;
    const vehId  = item?.vehicleId;
    const areaId = item?.finalInspectionCategory ?? item?.finalInspectionCategoryId;
    return {
      id,
      number:         item?.snagNumber ?? item?.snagNo ?? item?.uniqueId ?? String(id),
      projectId:      projId,
      project:        this.projectMap.get(projId) ?? item?.projectName ?? String(projId ?? '—'),
      vehicleId:      vehId,
      vehicle:        this.vehicleMap.get(vehId)  ?? item?.fleetNumber ?? item?.fleetNo ?? item?.vehicleFleetNumber ?? item?.vehicleName ?? item?.vehicleNumber ?? String(vehId ?? '—'),
      category:       item?.finalInspectionCategoryName ?? this.areaMap.get(areaId) ?? '—',
      description:    item?.description ?? item?.snagDescription ?? '—',
      inspectorId:    typeof item?.userId === 'number' ? item.userId : undefined,
      inspector:      item?.userName ?? item?.inspectorName ?? item?.userFullName ?? '-',
      safetyCritical: Boolean(item?.safetyCritical ?? item?.isSafetyCritical ?? false),
      repeater:       Boolean(item?.repeater ?? item?.isRepeater ?? false),
      hasImages:      Boolean(item?.hasImages ?? item?.hasImage ?? Number(item?.imageCount ?? 0) > 0),
      selected:       this.selectedMap.has(String(id)),
    };
  }
}
