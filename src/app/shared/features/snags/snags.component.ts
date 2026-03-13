import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface SnagRow {
  number: string;
  project: string;
  vehicle: string;
  category: string;
  description: string;
  inspector: string;
  area: string;
  safetyCritical: boolean;
  repeater: boolean;
  hasImages: boolean;
  selected?: boolean;
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
                  <select class="form-select" [(ngModel)]="filters.project">
                    <option value="">All projects</option>
                    <option *ngFor="let p of projects" [value]="p">{{p}}</option>
                  </select>
                </div>
                <div class="col-lg-6">
                  <label class="form-label">Vehicle</label>
                  <select class="form-select" [(ngModel)]="filters.vehicle">
                    <option value="">All vehicles</option>
                    <option *ngFor="let v of vehicles" [value]="v">{{v}}</option>
                  </select>
                </div>
                <div class="col-lg-6">
                  <label class="form-label">Inspector</label>
                  <select class="form-select" [(ngModel)]="filters.inspector">
                    <option value="">All inspectors</option>
                    <option *ngFor="let i of inspectors" [value]="i">{{i}}</option>
                  </select>
                </div>
                <div class="col-lg-6">
                  <label class="form-label">Area</label>
                  <select class="form-select" [(ngModel)]="filters.area">
                    <option value="">All areas</option>
                    <option *ngFor="let a of areas" [value]="a">{{a}}</option>
                  </select>
                </div>
                <div class="col-12 d-flex align-items-center mt-1">
                  <input class="form-check-input me-2" type="checkbox" id="includeImages" [(ngModel)]="filters.includeImages">
                  <label class="form-check-label" for="includeImages">Include images only</label>
                  <div class="ms-auto" style="max-width: 260px;">
                    <div class="input-group">
                      <span class="input-group-text"><i class="ti ti-search"></i></span>
                      <input class="form-control" placeholder="Search snag, vehicle, project..." [(ngModel)]="filters.search">
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Highlights -->
        <div class="col-xxl-4">
          <div class="row g-3 h-100">
            <div class="col-sm-6 col-12">
              <div class="highlight-card bg-primary-01">
                <div class="d-flex justify-content-between align-items-center">
                  <div>
                    <p class="text-muted mb-1">Total Snags</p>
                    <h3 class="mb-0">{{filteredSnags.length}}</h3>
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
                    <button class="btn btn-sm btn-success" (click)="checkAll()" [disabled]="isPrintLoading">
                      <span *ngIf="isPrintLoading" class="spinner-border spinner-border-sm me-1" role="status"></span>
                      <i *ngIf="!isPrintLoading" class="ti ti-check me-1"></i>
                      Check All
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
          <div class="card-title mb-0">Snag Register</div>
          <div class="ms-auto d-flex gap-2 flex-wrap">
            <button class="btn btn-sm btn-light" (click)="uncheckAll()">Uncheck All</button>
            <button class="btn btn-sm btn-success" (click)="checkAll()">Check All</button>
            <button class="btn btn-sm btn-outline-primary"><i class="ti ti-printer me-1"></i>Print</button>
          </div>
        </div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th style="width: 48px;" class="text-center"><input type="checkbox" class="form-check-input" [checked]="allSelected" (change)="toggleAll($event)"></th>
                  <th>Snag #</th>
                  <th>Inspector</th>
                  <th>Project</th>
                  <th>Vehicle</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Area</th>
                  <th>Safety</th>
                  <th>Repeater</th>
                  <th>Images</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of filteredSnags" [class.table-active]="row.selected">
                  <td class="text-center">
                    <input type="checkbox" class="form-check-input" [(ngModel)]="row.selected" (change)="updateSelection()">
                  </td>
                  <td class="fw-semibold">{{row.number}}</td>
                  <td>{{row.inspector}}</td>
                  <td><span class="badge bg-info-transparent">{{row.project}}</span></td>
                  <td class="text-muted">{{row.vehicle}}</td>
                  <td><span class="badge bg-secondary-transparent">{{row.category}}</span></td>
                  <td class="text-truncate" style="max-width: 260px;" title="{{row.description}}">{{row.description}}</td>
                  <td>{{row.area}}</td>
                  <td>
                    <span class="badge" [class.bg-danger-transparent]="row.safetyCritical" [class.bg-success-transparent]="!row.safetyCritical">
                      {{row.safetyCritical ? 'Critical' : 'Normal'}}
                    </span>
                  </td>
                  <td>
                    <span class="badge" [class.bg-warning-transparent]="row.repeater" [class.bg-light]="!row.repeater">
                      {{row.repeater ? 'Repeater' : 'First' }}
                    </span>
                  </td>
                  <td>
                    <i class="ti" [ngClass]="row.hasImages ? 'ti-photo text-primary' : 'ti-photo-off text-muted'"></i>
                  </td>
                </tr>
                <tr *ngIf="filteredSnags.length === 0">
                  <td colspan="11" class="text-center py-4 text-muted">No snags match your filters.</td>
                </tr>
              </tbody>
            </table>
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
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      box-shadow: 0 4px 10px rgba(0,0,0,0.12);
    }
    .bg-primary-01 { background: rgba(var(--primary-rgb), 0.08); }
    .bg-danger-01 { background: rgba(var(--danger-rgb), 0.08); }
    .bg-success-01 { background: rgba(var(--success-rgb), 0.08); }
  `]
})
export class SnagsComponent {
  projects = ['Arboc 23FT', 'Metro X', 'Cargo Lite'];
  vehicles = ['5045-W784', '4098-K221', '3301-Z900'];
  inspectors = ['All inspectors', 'Lena Okafor', 'Jordan Carter', 'Mei Chen'];
  areas = ['UnderCarriage', 'Interior', 'Exterior', 'Roof', 'Function', 'Water', 'Road Test', 'Engine', 'Buybacks', 'Final Walk'];

  snags: SnagRow[] = [];
  isLoading = false;
  isPrintLoading = false;
  totalCount = 0;
  safetyCriticalTotal = 0;
  currentPage = 1;
  readonly pageSize = 10;

  sortColumn: SnagSortColumn = 'id';
  sortDirection: 'asc' | 'desc' = 'desc';

  searchTerm = '';
  private searchDebounceTimer: any = null;

  /** Tracks selected snags across all pages: snag.id → SnagRow */
  private crossPageSelected = new Map<string | number, SnagRow>();

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
        const exists = this.projectOptions.some((p) => p.id === this.filters.project && p.id !== 'all');
        if (!exists) {
          // For client users, auto-select the first real project instead of defaulting to 'all'
          const firstProject = !this.isAdminRole
            ? this.projectOptions.find((p) => p.id !== 'all')
            : undefined;
          this.filters.project = firstProject ? String(firstProject.id) : 'all';
        }
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
    const id = this.getVal(item, ['id', 'snagId', 'snagID']) ?? '-';
    return {
      id,
      snagNumber:  this.getVal(item, ['snagNumber', 'snagNo', 'uniqueId']),
      project:     this.projectMap.get(String(this.getVal(item, ['projectId']) ?? '')) ?? this.getVal(item, ['projectId']),
      projectId:   this.getVal(item, ['projectId']),
      vehicle:     this.getVal(item, ['vehicleId']),
      vehicleId:   this.getVal(item, ['vehicleId']),
      category:    this.getVal(item, ['finalInspectionCategoryName']),
      description: this.getVal(item, ['description', 'snagDescription', 'notes']) ?? '-',
      inspector:   this.userMap.get(Number(this.getVal(item, ['userId']))) ?? this.getVal(item, ['userId']),
      safetyCritical: Boolean(this.getVal(item, ['safetyCritical', 'isSafetyCritical', 'safety_critical']) ?? false),
      repeater:    Boolean(this.getVal(item, ['repeater', 'isRepeater', 'repeated']) ?? false),
      hasImages:   Boolean(this.getVal(item, ['hasImages', 'hasImage']) ?? Number(this.getVal(item, ['imageCount']) ?? 0) > 0),
      createdDate: this.getVal(item, ['createdDate', 'created_at', 'createdAt', 'dateCreated']),
      status:      this.getVal(item, ['status', 'snagStatus', 'statusName']),
      selected:    this.crossPageSelected.has(id),
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

  get selectedCount():       number  { return this.crossPageSelected.size; }
  get safetyCriticalCount(): number  { return this.safetyCriticalTotal; }
  get allSelected():         boolean { return this.snags.length > 0 && this.snags.every((s) => this.crossPageSelected.has(s.id)); }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.snags.forEach((s) => {
      s.selected = checked;
      if (checked) this.crossPageSelected.set(s.id, s);
      else this.crossPageSelected.delete(s.id);
    });
  }

  checkAll(): void {
    if (this.isPrintLoading) return;
    const projectId = this.filters.project === 'all' ? undefined : Number(this.filters.project) || undefined;
    const vehicleId = this.filters.vehicle === 'all' ? undefined : Number(this.filters.vehicle) || undefined;
    const clientId  = this.getEffectiveClientId();
    const categoryId = this.filters.area !== 'all' ? Number(this.filters.area) || undefined : undefined;
    const params: any = {
      clientId, projectId, vehicleId,
      pageNumber: 1,
      pageSize: this.totalCount > 0 ? this.totalCount : 10000,
      orderBy: this.columnToApiField(this.sortColumn),
      orderDirection: this.sortDirection,
    };
    if (categoryId) params.finalInspectionCategory = categoryId;
    if (this.searchTerm?.trim()) params.search = this.searchTerm.trim();

    this.isPrintLoading = true;
    this.clientDashboardService.getSnags(params).subscribe({
      next: (response: unknown) => {
        const { items } = this.normalizeSnagResponse(response);
        items.forEach((item: any) => {
          const row = this.mapApiSnagToRow(item);
          row.selected = true;
          this.crossPageSelected.set(row.id, row);
        });
        this.snags.forEach((s) => { s.selected = true; });
        this.snags = [...this.snags];
        this.isPrintLoading = false;
      },
      error: () => {
        this.snags.forEach((s) => { s.selected = true; this.crossPageSelected.set(s.id, s); });
        this.snags = [...this.snags];
        this.isPrintLoading = false;
      },
    });
  }

  uncheckAll(): void {
    this.crossPageSelected.clear();
    this.snags.forEach((s) => (s.selected = false));
    this.snags = [...this.snags];
  }

  updateSelection(): void {
    this.snags.forEach((s) => {
      if (s.selected) this.crossPageSelected.set(s.id, s);
      else this.crossPageSelected.delete(s.id);
    });
    this.snags = [...this.snags];
  }

  printSelectedSnags(): void {
    const selected = Array.from(this.crossPageSelected.values());
    if (!selected.length) return;

    // Group by category
    const grouped = new Map<string, SnagRow[]>();
    for (const snag of selected) {
      const cat = this.displayValue(snag.category);
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(snag);
    }

    const inspectorName = this.displayValue(selected[0]?.inspector);
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });

    let tablesHtml = '';
    for (const [category, snagsList] of grouped) {
      const rows = snagsList.map((s, i) => `
        <tr>
          <td>${i + 1}</td>
          <td style="text-align:left">${this.displayValue(s.description)}</td>
          <td>${s.safetyCritical ? 'Yes' : 'No'}</td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>`).join('');

      tablesHtml += `
        <table>
          <thead>
            <tr>
              <th>SR No.</th>
              <th>${category} Description</th>
              <th>Safety Critical</th>
              <th>Prod Sign Off</th>
              <th>NG</th>
              <th>Prod Sign Off</th>
              <th>Inspector Buyoff</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Customer Identified Defects</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 28px; font-size: 12px; }
    h1 { text-align: center; font-size: 22px; font-weight: bold; text-transform: uppercase; margin-bottom: 24px; }
    .meta p { margin: 2px 0; font-size: 12px; }
    .meta strong { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; margin-bottom: 4px; }
    th { border: 1px solid #333; padding: 5px 7px; background: #f5f5f5; font-size: 11px; text-align: center; font-weight: bold; }
    td { border: 1px solid #333; padding: 5px 7px; font-size: 11px; text-align: center; vertical-align: top; }
    @media print { @page { margin: 15mm; } }
  </style>
</head>
<body>
  <h1>Customer Identified Defects</h1>
  <div class="meta">
    <p>Inspector: <strong>${inspectorName}</strong></p>
    <p><strong>Date:${today} LF64 Fleet #: Frame #: VIN #:</strong></p>
  </div>
  ${tablesHtml}
</body>
</html>`;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 500);
    }
  }
}
