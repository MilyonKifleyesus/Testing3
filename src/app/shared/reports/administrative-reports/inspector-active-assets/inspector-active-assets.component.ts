import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { resolveReportRouteContext } from '../../report-route-context';
import { ReportService, Project, Inspector, Client, LabourReportItem } from '../../services/report.service';

export interface InspectorActiveAssetRow {
  inspector: string;
  client: string;
  project: string;
  vehicle: string;
  ticketsOpen: number;
  ticketsClosed: number;
}


@Component({
  selector: 'app-inspector-active-assets',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="container-fluid">
      <!-- Page Header -->
      <div class="page-header" style="margin-top: 2rem;">
        <div>
          <h2 class="main-content-title tx-24 mg-b-5">Inspector Active Asset Report</h2>
          <ol class="breadcrumb">
            <li class="breadcrumb-item"><a [routerLink]="[dashboardPath]">Home</a></li>
            <li class="breadcrumb-item"><a [routerLink]="[reportsPath]">Reports</a></li>
            <li class="breadcrumb-item active" aria-current="page">Inspector Active Asset Report</li>
          </ol>
        </div>
      </div>

      <!-- Filters Card -->
      <div class="card custom-card mb-4">
        <div class="card-body">

          <!-- Row 1: Project | Inspector -->
          <div class="row g-4 mb-4">

            <!-- Project -->
            <div class="col-md-4">
              <label class="form-label fw-semibold mb-2">Project</label>
              <div class="position-relative">
                <div class="report-select-box" (click)="showProjectDropdown = !showProjectDropdown; showInspectorDropdown = false">
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

            <!-- Inspector -->
            <div class="col-md-4">
              <label class="form-label fw-semibold mb-2">Inspector</label>
              <div class="position-relative">
                <div class="report-select-box" (click)="showInspectorDropdown = !showInspectorDropdown; showProjectDropdown = false">
                  <span [class.text-muted]="!selectedInspector">{{ selectedInspector ? selectedInspector.name : 'All inspectors' }}</span>
                  <i class="ti-angle-down ms-auto"></i>
                </div>
                <div class="report-dropdown-panel" *ngIf="showInspectorDropdown">
                  <div class="report-dropdown-search">
                    <input type="text" class="form-control form-control-sm" placeholder="Search inspectors..." [(ngModel)]="inspectorSearch" (input)="$event.stopPropagation()" (click)="$event.stopPropagation()" autofocus />
                  </div>
                  <div class="report-dropdown-list">
                    <div class="report-dropdown-item" [class.active]="!selectedInspector" (click)="selectInspector(null)">All inspectors</div>
                    <div class="report-dropdown-item" *ngFor="let i of filteredInspectorOptions"
                      [class.active]="selectedInspector?.id === i.id"
                      (click)="selectInspector(i)">
                      {{ i.name }}
                    </div>
                    <div class="report-dropdown-empty" *ngIf="filteredInspectorOptions.length === 0">No inspectors found</div>
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
              <div class="card-title">Inspector Active Asset Report</div>
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
                <table class="asset-table">
                  <thead>
                    <tr>
                      <th (click)="sort('inspector')">INSPECTOR <i [class]="sortIcon('inspector') + ' ms-1'"></i></th>
                      <th (click)="sort('client')">CLIENT <i [class]="sortIcon('client') + ' ms-1'"></i></th>
                      <th (click)="sort('project')">PROJECT <i [class]="sortIcon('project') + ' ms-1'"></i></th>
                      <th (click)="sort('vehicle')">VEHICLE <i [class]="sortIcon('vehicle') + ' ms-1'"></i></th>
                      <th (click)="sort('ticketsOpen')">TICKETS OPEN <i [class]="sortIcon('ticketsOpen') + ' ms-1'"></i></th>
                      <th (click)="sort('ticketsClosed')">TICKETS CLOSED <i [class]="sortIcon('ticketsClosed') + ' ms-1'"></i></th>
                      <th (click)="sort('status')">STATUS <i [class]="sortIcon('status') + ' ms-1'"></i></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of filteredRows">
                      <td>{{ row.inspector }}</td>
                      <td>{{ row.client }}</td>
                      <td>{{ row.project }}</td>
                      <td>{{ row.vehicle }}</td>
                      <td>
                        <span class="badge-tickets-open" *ngIf="row.ticketsOpen > 0">{{ row.ticketsOpen }}</span>
                        <span class="text-muted" *ngIf="row.ticketsOpen === 0">0</span>
                      </td>
                      <td>
                        <span class="badge-tickets-closed">{{ row.ticketsClosed }}</span>
                      </td>
                      <td>
                        <span [class]="assetStatus(row) === 'Open' ? 'badge-status-open' : 'badge-status-closed'">{{ assetStatus(row) }}</span>
                      </td>
                    </tr>
                    <tr *ngIf="filteredRows.length === 0">
                      <td colspan="7" class="text-center py-5">
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
      <div *ngIf="showProjectDropdown || showInspectorDropdown"
        class="position-fixed top-0 start-0 w-100 h-100"
        style="z-index:1040;"
        (click)="showProjectDropdown = false; showInspectorDropdown = false;">
      </div>
    </div>
  `,
  styleUrls: ['./inspector-active-assets.component.scss'],
})
export class InspectorActiveAssetsComponent implements OnInit {
  readonly dashboardPath: string;
  readonly reportsPath: string;

  // Dropdown options
  projects: Project[] = [];
  allProjects: Project[] = [];
  clients: Client[] = [];
  inspectors: Inspector[] = [];

  // Search state for dropdowns
  projectSearch = '';
  inspectorSearch = '';
  showProjectDropdown = false;
  showInspectorDropdown = false;

  // Filter values
  selectedProject: Project | null = null;
  selectedInspector: Inspector | null = null;

  // Table state
  reportRun = false;
  isLoading = false;
  searchTerm = '';
  allRows: InspectorActiveAssetRow[] = [];
  filteredRows: InspectorActiveAssetRow[] = [];

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
    this.reportService.getClients().subscribe(c => this.clients = c.sort((a, b) => a.name.localeCompare(b.name)));
    this.reportService.getProjects().subscribe(p => { this.allProjects = p; this.projects = p; });
    this.loadInspectors();
  }

  private loadInspectors(projectId?: number): void {
    const params = projectId ? { projectId } : undefined;
    this.reportService.getLabourReport(params).subscribe((items: LabourReportItem[]) => {
      const seen = new Set<number>();
      this.inspectors = items
        .filter(item => item.inspectorId > 0 && item.inspector)
        .reduce((acc: Inspector[], item) => {
          if (!seen.has(item.inspectorId)) {
            seen.add(item.inspectorId);
            acc.push({ id: item.inspectorId, name: item.inspector, email: '' });
          }
          return acc;
        }, [])
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  get filteredProjectOptions(): Project[] {
    const s = this.projectSearch.toLowerCase();
    return this.projects.filter(p => p.name.toLowerCase().includes(s));
  }

  get filteredInspectorOptions(): Inspector[] {
    const s = this.inspectorSearch.toLowerCase();
    return this.inspectors.filter(i => i.name.toLowerCase().includes(s));
  }

  selectProject(p: Project | null): void {
    this.selectedProject = p;
    this.projectSearch = p ? p.name : '';
    this.showProjectDropdown = false;
    // Reset inspector and reload options scoped to this project
    this.selectedInspector = null;
    this.inspectorSearch = '';
    this.loadInspectors(p?.id);
  }

  selectInspector(i: Inspector | null): void {
    this.selectedInspector = i;
    this.inspectorSearch = i ? i.name : '';
    this.showInspectorDropdown = false;
  }

  runReport(): void {
    this.isLoading = true;
    this.reportRun = false;

    const params: { projectId?: number; inspectorId?: number } = {};
    if (this.selectedProject) params.projectId = this.selectedProject.id;
    if (this.selectedInspector) params.inspectorId = this.selectedInspector.id;

    this.reportService.getInspectorAssets(params).subscribe({
      next: (items) => {
        this.allRows = items
          .filter(item => item.inspector && item.vehicle)
          .map(item => ({
            inspector: item.inspector,
            client: item.client,
            project: item.project,
            vehicle: item.vehicle,
            ticketsOpen: Number(item.ticketsOpen ?? 0),
            ticketsClosed: Number(item.ticketsClosed ?? 0),
          }))
          .sort((a, b) => a.inspector.localeCompare(b.inspector) || a.project.localeCompare(b.project));

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

  assetStatus(row: InspectorActiveAssetRow): 'Open' | 'Closed' {
    return row.ticketsOpen === 0 ? 'Closed' : 'Open';
  }

  applySearch(): void {
    const s = this.searchTerm.toLowerCase();
    if (!s) {
      this.filteredRows = [...this.allRows];
    } else {
      this.filteredRows = this.allRows.filter(r =>
        r.inspector.toLowerCase().includes(s) ||
        r.client.toLowerCase().includes(s) ||
        r.project.toLowerCase().includes(s) ||
        r.vehicle.toLowerCase().includes(s) ||
        String(r.ticketsOpen).includes(s) ||
        String(r.ticketsClosed).includes(s) ||
        this.assetStatus(r).toLowerCase().includes(s)
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
      const aVal = column === 'status' ? this.assetStatus(a) : ((a as any)[column] ?? '');
      const bVal = column === 'status' ? this.assetStatus(b) : ((b as any)[column] ?? '');
      return aVal < bVal ? -dir : aVal > bVal ? dir : 0;
    });
  }

  sortIcon(column: string): string {
    if (this.sortColumn !== column) return 'ti-arrows-vertical';
    return this.sortDirection === 'asc' ? 'ti-arrow-up' : 'ti-arrow-down';
  }

  printReport(): void {
    if (!this.filteredRows.length) return;
    this.loadLogoAsBase64().then(logo => {
      const html = this.generatePrintHTML(logo);
      const win = window.open('', '', 'height=900,width=1100');
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
    const projectLabel = this.selectedProject ? this.selectedProject.name : 'All';
    const inspectorLabel = this.selectedInspector ? this.selectedInspector.name : 'All';
    const logoTag = logoBase64
      ? `<img src="${logoBase64}" alt="BusPulse Logo" class="logo-img">`
      : '<div class="logo-placeholder">BusPulse</div>';

    const rows = this.filteredRows.map(r => `
      <tr>
        <td>${r.inspector}</td>
        <td>${r.client}</td>
        <td>${r.project}</td>
        <td>${r.vehicle}</td>
        <td>${r.ticketsOpen}</td>
        <td>${r.ticketsClosed}</td>
        <td>${r.ticketsOpen === 0 ? 'Closed' : 'Open'}</td>
      </tr>`).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>BusPulse Inspector Active Asset Report</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; color: #333; background: white; padding: 20px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #000; }
        .logo-section { display: flex; align-items: center; }
        .logo-img { width: 100px; height: 50px; object-fit: contain; padding: 5px; }
        .logo-placeholder { width: 100px; height: 50px; background: #2d7a4f !important; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; color: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .report-title { text-align: center; flex-grow: 1; }
        .report-title h1 { font-size: 16px; font-weight: bold; }
        .report-title p { font-size: 11px; margin-top: 2px; }
        .project-info { font-size: 11px; margin-bottom: 15px; padding: 8px; color: #333; }
        .section-header { background: #1DB954 !important; padding: 8px 10px; font-weight: bold; font-size: 12px; color: white !important; border: 2px solid #000; margin-bottom: 3px; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
        table thead tr { background: #1DB954 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table th { padding: 6px 6px; text-align: left; font-weight: bold; border: 1px solid #000; color: white !important; font-size: 10px; background: #1DB954 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table td { padding: 6px 6px; border: 1px solid #999; vertical-align: top; }
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
          <h1>BusPulse Inspector Active Asset Report</h1>
          <p>Active Asset Summary by Inspector</p>
        </div>
        <div class="logo-section">${logoTag}</div>
      </div>

      <div class="project-info">
        <strong>Project: ${projectLabel}</strong> | <strong>Inspector: ${inspectorLabel}</strong> | Generated: ${new Date().toLocaleString()}
      </div>

      <div class="section-header">Inspector Active Asset Report</div>
      <table>
        <thead>
          <tr>
            <th>Inspector</th>
            <th>Client</th>
            <th>Project</th>
            <th>Vehicle</th>
            <th>Tickets Open</th>
            <th>Tickets Closed</th>
            <th>Status</th>
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

    const projectLabel = this.selectedProject ? this.selectedProject.name : 'All';
    const inspectorLabel = this.selectedInspector ? this.selectedInspector.name : 'All';
    const generated = new Date().toLocaleString();

    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;

    const metaRows = [
      [q('BusPulse Inspector Active Asset Report')],
      [q('Active Asset Summary by Inspector')],
      [],
      [q('Project:'), q(projectLabel), q('Inspector:'), q(inspectorLabel)],
      [q('Generated:'), q(generated)],
      [],
      [q('Inspector Active Asset Report')],
      [],
    ];

    const tableHeaders = ['Inspector', 'Client', 'Project', 'Vehicle', 'Tickets Open', 'Tickets Closed', 'Status'];
    const dataRows = this.filteredRows.map(r => [
      q(r.inspector), q(r.client), q(r.project), q(r.vehicle),
      q(String(r.ticketsOpen)), q(String(r.ticketsClosed)), q(r.ticketsOpen === 0 ? 'Closed' : 'Open')
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
    a.download = 'inspector-active-asset-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
