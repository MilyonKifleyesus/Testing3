import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { resolveReportRouteContext } from '../../report-route-context';
import { ReportService, Project, Client, Vehicle } from '../../services/report.service';

export const TIME_TYPE_COLUMNS = [
  'Production',
  'First Property Inspection',
  'Road/Water Test',
  'Sign Off',
  'Buybacks',
  'Other-Use Description',
] as const;

export type TimeTypeColumn = typeof TIME_TYPE_COLUMNS[number];

export interface VehicleHourRow {
  client: string;
  project: string;
  vehicleNumber: string;
  hoursByType: Record<string, number>;
  totalHours: number;
}

@Component({
  selector: 'app-vehicle-hour-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="container-fluid">
      <!-- Page Header -->
      <div class="page-header" style="margin-top: 2rem;">
        <div>
          <h2 class="main-content-title tx-24 mg-b-5">Vehicle Time Summary Report</h2>
          <ol class="breadcrumb">
            <li class="breadcrumb-item"><a [routerLink]="[dashboardPath]">Home</a></li>
            <li class="breadcrumb-item"><a [routerLink]="[reportsPath]">Reports</a></li>
            <li class="breadcrumb-item active" aria-current="page">Vehicle Time Summary Report</li>
          </ol>
        </div>
      </div>

      <!-- Filters Card -->
      <div class="card custom-card mb-4">
        <div class="card-body">

          <!-- Row 1: Client | Project | Vehicle -->
          <div class="row g-4 mb-4">

            <!-- Client -->
            <div class="col-md-4">
              <label class="form-label fw-semibold mb-2">Clients</label>
              <div class="position-relative">
                <div class="report-select-box" (click)="showClientDropdown = !showClientDropdown; showProjectDropdown = false; showVehicleDropdown = false">
                  <span [class.text-muted]="!selectedClient">{{ selectedClient ? selectedClient.name : 'All clients' }}</span>
                  <i class="ti-angle-down ms-auto"></i>
                </div>
                <div class="report-dropdown-panel" *ngIf="showClientDropdown">
                  <div class="report-dropdown-search">
                    <input type="text" class="form-control form-control-sm" placeholder="Search clients..." [(ngModel)]="clientSearch" (input)="$event.stopPropagation()" (click)="$event.stopPropagation()" autofocus />
                  </div>
                  <div class="report-dropdown-list">
                    <div class="report-dropdown-item" [class.active]="!selectedClient" (click)="selectClient(null)">All clients</div>
                    <div class="report-dropdown-item" *ngFor="let c of filteredClients"
                      [class.active]="selectedClient?.id === c.id"
                      (click)="selectClient(c)">
                      {{ c.name }}
                    </div>
                    <div class="report-dropdown-empty" *ngIf="filteredClients.length === 0">No clients found</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Project -->
            <div class="col-md-4">
              <label class="form-label fw-semibold mb-2">Project</label>
              <div class="position-relative">
                <div class="report-select-box" (click)="showProjectDropdown = !showProjectDropdown; showClientDropdown = false; showVehicleDropdown = false">
                  <span [class.text-muted]="!selectedProject">{{ selectedProject ? selectedProject.name : 'All projects' }}</span>
                  <i class="ti-angle-down ms-auto"></i>
                </div>
                <div class="report-dropdown-panel" *ngIf="showProjectDropdown">
                  <div class="report-dropdown-search">
                    <input type="text" class="form-control form-control-sm" placeholder="Search projects..." [(ngModel)]="projectSearch" (input)="$event.stopPropagation()" (click)="$event.stopPropagation()" autofocus />
                  </div>
                  <div class="report-dropdown-list">
                    <div class="report-dropdown-item" [class.active]="!selectedProject" (click)="selectProject(null)">All projects</div>
                    <div class="report-dropdown-item" *ngFor="let p of filteredProjectOptions"
                      [class.active]="selectedProject?.id === p.id"
                      (click)="selectProject(p)">
                      {{ p.name }}
                    </div>
                    <div class="report-dropdown-empty" *ngIf="filteredProjectOptions.length === 0">No projects found</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Vehicle -->
            <div class="col-md-4">
              <label class="form-label fw-semibold mb-2">Vehicle</label>
              <div class="position-relative">
                <div class="report-select-box" (click)="showVehicleDropdown = !showVehicleDropdown; showClientDropdown = false; showProjectDropdown = false">
                  <span [class.text-muted]="!selectedVehicle">{{ selectedVehicle ? selectedVehicle.fleetNumber : 'All vehicles' }}</span>
                  <i class="ti-angle-down ms-auto"></i>
                </div>
                <div class="report-dropdown-panel" *ngIf="showVehicleDropdown">
                  <div class="report-dropdown-search">
                    <input type="text" class="form-control form-control-sm" placeholder="Search vehicles..." [(ngModel)]="vehicleSearch" (input)="$event.stopPropagation()" (click)="$event.stopPropagation()" autofocus />
                  </div>
                  <div class="report-dropdown-list">
                    <div class="report-dropdown-item" [class.active]="!selectedVehicle" (click)="selectVehicle(null)">All vehicles</div>
                    <div class="report-dropdown-item" *ngFor="let v of filteredVehicleOptions"
                      [class.active]="selectedVehicle?.id === v.id"
                      (click)="selectVehicle(v)">
                      {{ v.fleetNumber }}
                    </div>
                    <div class="report-dropdown-empty" *ngIf="filteredVehicleOptions.length === 0">No vehicles found</div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          <!-- Row 2: Buttons -->
          <div class="d-flex gap-3">
            <button class="btn btn-report-run px-4" (click)="runReport()" [disabled]="isLoading">
              <span *ngIf="isLoading" class="spinner-border spinner-border-sm me-2"></span>
              <i *ngIf="!isLoading" class="ti-control-play me-2"></i>
              Run Report
            </button>
            <button class="btn btn-report-print px-4" (click)="printReport()">
              <i class="ti-printer me-2"></i>Print Report
            </button>
            <button class="btn btn-report-download px-4" (click)="downloadReport()" [disabled]="!filteredRows.length">
              <i class="ti-download me-2"></i>Download Report
            </button>
          </div>

        </div>
      </div>

      <!-- Results -->
      <div class="row" *ngIf="reportRun">
        <div class="col-12">
          <div class="card custom-card">
            <div class="card-header border-bottom-0">
              <div class="card-title">Report Result</div>
            </div>
            <div class="card-body">

              <!-- Search Box -->
              <div class="row mb-3">
                <div class="col-md-4 ms-auto">
                  <div class="input-group">
                    <span class="input-group-text bg-transparent">
                      <i class="ti-search"></i>
                    </span>
                    <input type="text" class="form-control" placeholder="Search..." [(ngModel)]="searchTerm" (ngModelChange)="applySearch()" />
                  </div>
                </div>
              </div>

              <!-- Table -->
              <div class="table-responsive">
                <table class="vehicle-hour-table">
                  <thead>
                    <tr>
                      <th (click)="sort('client')">CLIENT <i [class]="sortIcon('client') + ' ms-1'"></i></th>
                      <th (click)="sort('project')">PROJECT <i [class]="sortIcon('project') + ' ms-1'"></i></th>
                      <th (click)="sort('vehicleNumber')">VEHICLE NUMBER <i [class]="sortIcon('vehicleNumber') + ' ms-1'"></i></th>
                      <th *ngFor="let col of timeTypeColumns" (click)="sortByType(col)">
                        {{ col | uppercase }} <i [class]="sortIconType(col) + ' ms-1'"></i>
                      </th>
                      <th (click)="sort('totalHours')">TOTAL HOURS <i [class]="sortIcon('totalHours') + ' ms-1'"></i></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of filteredRows">
                      <td>{{ row.client }}</td>
                      <td>{{ row.project }}</td>
                      <td>{{ row.vehicleNumber }}</td>
                      <td *ngFor="let col of timeTypeColumns">{{ (row.hoursByType[col] || 0) | number:'1.1-2' }}</td>
                      <td>{{ row.totalHours | number:'1.1-2' }}</td>
                    </tr>
                    <tr *ngIf="filteredRows.length === 0">
                      <td [attr.colspan]="3 + timeTypeColumns.length + 1" class="text-center py-5">
                        <p class="text-muted mb-0">No records found.</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

            </div>
          </div>
        </div>
      </div>

      <!-- Backdrop to close dropdowns -->
      <div *ngIf="showClientDropdown || showProjectDropdown || showVehicleDropdown"
        class="position-fixed top-0 start-0 w-100 h-100"
        style="z-index:1040;"
        (click)="showClientDropdown = false; showProjectDropdown = false; showVehicleDropdown = false;">
      </div>
    </div>
  `,
  styleUrls: ['./vehicle-hour-report.component.scss'],
})
export class VehicleHourReportComponent implements OnInit {
  readonly dashboardPath: string;
  readonly reportsPath: string;
  readonly timeTypeColumns = TIME_TYPE_COLUMNS;

  // Dropdown options
  clients: Client[] = [];
  allProjects: Project[] = [];
  projects: Project[] = [];
  vehicles: Vehicle[] = [];

  // Search state for dropdowns
  clientSearch = '';
  projectSearch = '';
  vehicleSearch = '';
  showClientDropdown = false;
  showProjectDropdown = false;
  showVehicleDropdown = false;

  // Filter values
  selectedClient: Client | null = null;
  selectedProject: Project | null = null;
  selectedVehicle: Vehicle | null = null;

  // Table state
  reportRun = false;
  isLoading = false;
  searchTerm = '';
  allRows: VehicleHourRow[] = [];
  filteredRows: VehicleHourRow[] = [];

  // Sorting
  sortColumn = '';
  sortDirection: 'asc' | 'desc' = 'asc';

  constructor(
    private readonly authService: AuthService,
    private readonly reportService: ReportService,
  ) {
    const context = resolveReportRouteContext(this.authService.currentUserValue);
    this.dashboardPath = context.dashboardPath;
    this.reportsPath = context.reportsPath;
  }

  ngOnInit(): void {
    this.reportService.getClients().subscribe(c => this.clients = c);
    this.reportService.getProjects().subscribe(p => {
      this.allProjects = p;
      this.projects = p;
    });
    this.reportService.getVehicles().subscribe(v => this.vehicles = v);
  }

  get filteredClients(): Client[] {
    const s = this.clientSearch.toLowerCase();
    return this.clients.filter(c => c.name.toLowerCase().includes(s));
  }

  get filteredProjectOptions(): Project[] {
    const s = this.projectSearch.toLowerCase();
    return this.projects
      .filter(p => !this.selectedClient || p.clientId === this.selectedClient.id)
      .filter(p => p.name.toLowerCase().includes(s));
  }

  get filteredVehicleOptions(): Vehicle[] {
    const s = this.vehicleSearch.toLowerCase();
    return this.vehicles
      .filter(v => !this.selectedClient || v.clientId === this.selectedClient.id)
      .filter(v => v.fleetNumber.toLowerCase().includes(s));
  }

  selectClient(c: Client | null): void {
    this.selectedClient = c;
    this.clientSearch = c ? c.name : '';
    this.showClientDropdown = false;
    this.selectedProject = null;
    this.projectSearch = '';
    this.selectedVehicle = null;
    this.vehicleSearch = '';
    this.projects = c ? this.allProjects.filter(p => p.clientId === c.id) : this.allProjects;
    this.reportService.getVehicles(c?.id ?? undefined).subscribe(v => this.vehicles = v);
  }

  selectProject(p: Project | null): void {
    this.selectedProject = p;
    this.projectSearch = p ? p.name : '';
    this.showProjectDropdown = false;
    this.selectedVehicle = null;
    this.vehicleSearch = '';
  }

  selectVehicle(v: Vehicle | null): void {
    this.selectedVehicle = v;
    this.vehicleSearch = v ? v.fleetNumber : '';
    this.showVehicleDropdown = false;
  }

  runReport(): void {
    this.isLoading = true;
    this.reportRun = false;

    const clients$ = this.clients.length ? of(this.clients) : this.reportService.getClients();
    const projects$ = this.allProjects.length ? of(this.allProjects) : this.reportService.getProjects();

    forkJoin({ items: this.reportService.getLabourReport(), clients: clients$, projects: projects$ }).subscribe({
      next: ({ items, clients, projects }) => {
        // Ensure local arrays are up to date in case they weren't loaded yet
        if (!this.clients.length) this.clients = clients;
        if (!this.allProjects.length) { this.allProjects = projects; this.allProjects = projects; }

        // Build a lookup: projectId → client name (used for filtering and display)
        const projectClientMap = new Map<number, string>();
        for (const p of projects) {
          const clientName = clients.find(c => c.id === p.clientId)?.name ?? '';
          projectClientMap.set(p.id, clientName);
        }

        // Apply filters
        let filtered = items;
        if (this.selectedClient) {
          filtered = filtered.filter(i => {
            const resolvedClient = i.client || projectClientMap.get(i.projectId) || '';
            return i.clientId > 0 ? i.clientId === this.selectedClient!.id : resolvedClient === this.selectedClient!.name;
          });
        }
        if (this.selectedProject) {
          filtered = filtered.filter(i => i.projectId === this.selectedProject!.id);
        }
        if (this.selectedVehicle) {
          filtered = filtered.filter(i => i.vehicleId === this.selectedVehicle!.id);
        }

        // Group by vehicleId + projectId, summing hours per type
        const grouped = new Map<string, { client: string; project: string; vehicleNumber: string; hoursByType: Record<string, number> }>();
        for (const item of filtered) {
          if (!item.vehicle) continue;
          const key = `${item.vehicleId}|${item.projectId}`;
          const clientName = item.client || projectClientMap.get(item.projectId) || '';
          if (!grouped.has(key)) {
            grouped.set(key, {
              client: clientName,
              project: item.project,
              vehicleNumber: item.vehicle,
              hoursByType: {},
            });
          }
          const entry = grouped.get(key)!;
          const type = item.typeOfTime || 'Other-Use Description';
          entry.hoursByType[type] = (entry.hoursByType[type] ?? 0) + item.hours;
        }

        // Build rows
        const rows: VehicleHourRow[] = [];
        for (const entry of grouped.values()) {
          const totalHours = Object.values(entry.hoursByType).reduce((sum, h) => sum + h, 0);
          rows.push({
            client: entry.client,
            project: entry.project,
            vehicleNumber: entry.vehicleNumber,
            hoursByType: entry.hoursByType,
            totalHours: Math.round(totalHours * 100) / 100,
          });
        }

        rows.sort((a, b) =>
          a.client.localeCompare(b.client) ||
          a.project.localeCompare(b.project) ||
          a.vehicleNumber.localeCompare(b.vehicleNumber)
        );

        this.allRows = rows;
        this.applySearch();
        this.isLoading = false;
        this.reportRun = true;
      },
      error: () => {
        this.allRows = [];
        this.filteredRows = [];
        this.isLoading = false;
        this.reportRun = true;
      },
    });
  }

  applySearch(): void {
    const s = this.searchTerm.toLowerCase();
    if (!s) {
      this.filteredRows = [...this.allRows];
    } else {
      this.filteredRows = this.allRows.filter(r =>
        r.client.toLowerCase().includes(s) ||
        r.project.toLowerCase().includes(s) ||
        r.vehicleNumber.toLowerCase().includes(s) ||
        String(r.totalHours).includes(s)
      );
    }
  }

  sort(column: string): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    this.filteredRows.sort((a, b) => {
      const aVal = (a as any)[column] ?? '';
      const bVal = (b as any)[column] ?? '';
      return aVal < bVal ? -dir : aVal > bVal ? dir : 0;
    });
  }

  sortByType(col: string): void {
    const key = `type:${col}`;
    if (this.sortColumn === key) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = key;
      this.sortDirection = 'asc';
    }
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    this.filteredRows.sort((a, b) => {
      const aVal = a.hoursByType[col] ?? 0;
      const bVal = b.hoursByType[col] ?? 0;
      return aVal < bVal ? -dir : aVal > bVal ? dir : 0;
    });
  }

  sortIcon(column: string): string {
    if (this.sortColumn !== column) return 'ti-arrows-vertical';
    return this.sortDirection === 'asc' ? 'ti-arrow-up' : 'ti-arrow-down';
  }

  sortIconType(col: string): string {
    const key = `type:${col}`;
    if (this.sortColumn !== key) return 'ti-arrows-vertical';
    return this.sortDirection === 'asc' ? 'ti-arrow-up' : 'ti-arrow-down';
  }

  printReport(): void {
    if (!this.filteredRows.length) return;
    this.loadLogoAsBase64().then(logo => {
      const html = this.generatePrintHTML(logo);
      const win = window.open('', '', 'height=900,width=1400');
      if (win) {
        win.document.write(html);
        win.document.close();
        setTimeout(() => win.print(), 250);
      }
    });
  }

  private loadLogoAsBase64(): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = 'assets/images/brand-logos/login-optimized.jpg';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) { ctx.drawImage(img, 0, 0); }
        resolve(canvas.toDataURL('image/jpeg'));
      };
      img.onerror = () => resolve('');
    });
  }

  private generatePrintHTML(logoBase64: string): string {
    const clientLabel = this.selectedClient ? this.selectedClient.name : 'All';
    const projectLabel = this.selectedProject ? this.selectedProject.name : 'All';
    const vehicleLabel = this.selectedVehicle ? this.selectedVehicle.fleetNumber : 'All';
    const logoTag = logoBase64
      ? `<img src="${logoBase64}" alt="BusPulse Logo" class="logo-img">`
      : '<div class="logo-placeholder">BusPulse</div>';

    const typeHeaders = TIME_TYPE_COLUMNS.map(c => `<th>${c}</th>`).join('');
    const rows = this.filteredRows.map(r => {
      const typeCells = TIME_TYPE_COLUMNS.map(c => `<td>${(r.hoursByType[c] || 0).toFixed(2)}</td>`).join('');
      return `<tr><td>${r.client}</td><td>${r.project}</td><td>${r.vehicleNumber}</td>${typeCells}<td><strong>${r.totalHours.toFixed(2)}</strong></td></tr>`;
    }).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>BusPulse Vehicle Time Summary Report</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #333; background: white; padding: 20px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #000; }
        .logo-section { display: flex; align-items: center; }
        .logo-img { width: 100px; height: 50px; object-fit: contain; padding: 5px; }
        .logo-placeholder { width: 100px; height: 50px; background: #2d7a4f !important; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; color: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .report-title { text-align: center; flex-grow: 1; }
        .report-title h1 { font-size: 16px; font-weight: bold; }
        .report-title p { font-size: 11px; margin-top: 2px; }
        .project-info { font-size: 11px; margin-bottom: 15px; padding: 8px; color: #333; }
        .section-header { background: #1DB954 !important; padding: 8px 10px; font-weight: bold; font-size: 12px; color: white !important; border: 2px solid #000; margin-bottom: 3px; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 10px; }
        table thead tr { background: #1DB954 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table th { padding: 5px 4px; text-align: left; font-weight: bold; border: 1px solid #000; color: white !important; font-size: 9px; background: #1DB954 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table td { padding: 5px 4px; border: 1px solid #999; vertical-align: top; }
        table tbody tr:nth-child(even) td { background: #f9f9f9; }
        .footer { border-top: 1px solid #ccc; padding-top: 12px; font-size: 10px; color: #666; margin-top: 20px; text-align: center; }
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body { margin: 0; padding: 15px; }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
          .section-header { background: #1DB954 !important; color: white !important; }
          table th { background: #1DB954 !important; color: white !important; }
        }
      </style>
    </head>
    <body>
      <div class="page-header">
        <div class="logo-section">${logoTag}</div>
        <div class="report-title">
          <h1>BusPulse Vehicle Time Summary Report</h1>
          <p>Hours by Vehicle and Time Type</p>
        </div>
        <div class="logo-section">${logoTag}</div>
      </div>

      <div class="project-info">
        <strong>Client: ${clientLabel}</strong> | <strong>Project: ${projectLabel}</strong> | <strong>Vehicle: ${vehicleLabel}</strong> | Generated: ${new Date().toLocaleString()}
      </div>

      <div class="section-header">Vehicle Time Summary Report</div>
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>Project</th>
            <th>Vehicle Number</th>
            ${typeHeaders}
            <th>Total Hours</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="footer">
        <p>This is an automated report generated by BusPulse Reporting System</p>
        <p>Generated on: ${new Date().toLocaleString()}</p>
      </div>
    </body>
    </html>`;
  }

  downloadReport(): void {
    if (!this.filteredRows.length) return;

    const clientLabel = this.selectedClient ? this.selectedClient.name : 'All';
    const projectLabel = this.selectedProject ? this.selectedProject.name : 'All';
    const vehicleLabel = this.selectedVehicle ? this.selectedVehicle.fleetNumber : 'All';
    const generated = new Date().toLocaleString();

    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;

    const metaRows = [
      [q('BusPulse Vehicle Time Summary Report')],
      [q('Hours by Vehicle and Time Type')],
      [],
      [q('Client:'), q(clientLabel), q('Project:'), q(projectLabel), q('Vehicle:'), q(vehicleLabel)],
      [q('Generated:'), q(generated)],
      [],
      [q('Vehicle Time Summary Report')],
      [],
    ];

    const tableHeaders = ['Client', 'Project', 'Vehicle Number', ...TIME_TYPE_COLUMNS, 'Total Hours'];
    const dataRows = this.filteredRows.map(r => [
      q(r.client),
      q(r.project),
      q(r.vehicleNumber),
      ...TIME_TYPE_COLUMNS.map(c => q((r.hoursByType[c] || 0).toFixed(2))),
      q(r.totalHours.toFixed(2)),
    ]);

    const footerRows = [
      [],
      [q('This is an automated report generated by BusPulse Reporting System')],
      [q(`Generated on: ${generated}`)],
    ];

    const csv = [
      ...metaRows.map(r => r.join(',')),
      tableHeaders.map(h => q(h)).join(','),
      ...dataRows.map(r => r.join(',')),
      ...footerRows.map(r => r.join(',')),
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vehicle-hour-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
