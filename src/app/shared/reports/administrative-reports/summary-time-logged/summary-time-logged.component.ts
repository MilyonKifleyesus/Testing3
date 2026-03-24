import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { resolveReportRouteContext } from '../../report-route-context';
import { ReportService, Project, Inspector, Client } from '../../services/report.service';

export type TimeType = string;
export const TIME_TYPES: TimeType[] = ['Regular', 'Overtime', 'Travel'];

export interface SummaryTimeRow {
  inspectorName: string;
  customer: string;
  project: string;
  busNumber: string;
  typeOfTime: string;
  date: string;
  hoursLogged: number;
  ticketsGenerated: number;
}

@Component({
  selector: 'app-summary-time-logged',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './summary-time-logged.component.html',
  styleUrls: ['./summary-time-logged.component.scss'],
})
export class SummaryTimeLoggedComponent implements OnInit {
  readonly dashboardPath: string;
  readonly reportsPath: string;

  // Dropdown options
  allProjects: Project[] = [];
  projects: Project[] = [];
  clients: Client[] = [];
  inspectors: Inspector[] = [];
  timeTypes: string[] = [];

  // Search state for dropdowns
  clientSearch = '';
  projectSearch = '';
  inspectorSearch = '';
  showClientDropdown = false;
  showProjectDropdown = false;
  showInspectorDropdown = false;
  showTimeTypeDropdown = false;

  // Filter values
  selectedClient: Client | null = null;
  selectedProject: Project | null = null;
  selectedInspector: Inspector | null = null;
  selectedTimeType: TimeType | null = null;
  fromDate = '';
  toDate = '';

  // Table state
  reportRun = false;
  isLoading = false;
  searchTerm = '';
  allRows: SummaryTimeRow[] = [];
  filteredRows: SummaryTimeRow[] = [];

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
    this.reportService.getClients().subscribe(clients => {
      this.clients = clients.sort((a, b) => a.name.localeCompare(b.name));
    });
    this.reportService.getProjects().subscribe(projects => {
      this.allProjects = projects;
      this.projects = projects;
    });
    this.loadDropdownOptions();
  }

  private loadDropdownOptions(params?: { projectId?: number }): void {
    this.reportService.getLabourReport(params).subscribe(items => {
      const seenInspectors = new Set<number>();
      const seenTypes = new Set<string>();
      this.inspectors = items
        .filter(item => item.inspectorId > 0 && item.inspector)
        .reduce((acc: Inspector[], item) => {
          if (!seenInspectors.has(item.inspectorId)) {
            seenInspectors.add(item.inspectorId);
            acc.push({ id: item.inspectorId, name: item.inspector, email: '' });
          }
          return acc;
        }, [])
        .sort((a, b) => a.name.localeCompare(b.name));
      this.timeTypes = items
        .filter(item => item.typeOfTime)
        .reduce((acc: string[], item) => {
          if (!seenTypes.has(item.typeOfTime)) {
            seenTypes.add(item.typeOfTime);
            acc.push(item.typeOfTime);
          }
          return acc;
        }, [])
        .sort();
    });
  }

  get filteredClientOptions(): Client[] {
    const s = this.clientSearch.toLowerCase();
    return this.clients.filter(c => c.name.toLowerCase().includes(s));
  }

  get filteredProjectOptions(): Project[] {
    const s = this.projectSearch.toLowerCase();
    return this.projects.filter(p => p.name.toLowerCase().includes(s));
  }

  get filteredInspectorOptions(): Inspector[] {
    const s = this.inspectorSearch.toLowerCase();
    return this.inspectors.filter(i => i.name.toLowerCase().includes(s));
  }

  selectClient(c: Client | null): void {
    this.selectedClient = c;
    this.clientSearch = c ? c.name : '';
    this.showClientDropdown = false;
    this.selectedProject = null;
    this.projectSearch = '';
    this.selectedInspector = null;
    this.inspectorSearch = '';
    this.selectedTimeType = null;
    this.projects = c ? this.allProjects.filter(p => p.clientId === c.id) : this.allProjects;
    this.loadDropdownOptions();
  }

  selectProject(p: Project | null): void {
    this.selectedProject = p;
    this.projectSearch = p ? p.name : '';
    this.showProjectDropdown = false;
    this.selectedInspector = null;
    this.inspectorSearch = '';
    this.selectedTimeType = null;
    this.loadDropdownOptions(p ? { projectId: p.id } : undefined);
  }

  selectInspector(i: Inspector | null): void {
    this.selectedInspector = i;
    this.inspectorSearch = i ? i.name : '';
    this.showInspectorDropdown = false;
  }

  selectTimeType(t: TimeType | null): void {
    this.selectedTimeType = t;
    this.showTimeTypeDropdown = false;
  }

  runReport(): void {
    this.isLoading = true;
    this.reportRun = false;

    const clients$ = this.clients.length ? of(this.clients) : this.reportService.getClients();
    const projects$ = this.allProjects.length ? of(this.allProjects) : this.reportService.getProjects();

    forkJoin({ items: this.reportService.getLabourReport(), clients: clients$, projects: projects$ }).subscribe(({ items, clients, projects }) => {
      // Ensure local arrays are up to date in case they weren't loaded yet
      if (!this.clients.length) this.clients = clients;
      if (!this.allProjects.length) { this.allProjects = projects; this.projects = projects; }

      const projectClientMap = new Map<number, string>();
      for (const p of projects) {
        const clientName = clients.find(c => c.id === p.clientId)?.name ?? '';
        projectClientMap.set(p.id, clientName);
      }

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
      if (this.selectedInspector) {
        filtered = filtered.filter(i => i.inspectorId === this.selectedInspector!.id);
      }
      if (this.fromDate) {
        filtered = filtered.filter(i => i.date.substring(0, 10) >= this.fromDate);
      }
      if (this.toDate) {
        filtered = filtered.filter(i => i.date.substring(0, 10) <= this.toDate);
      }
      if (this.selectedTimeType) {
        filtered = filtered.filter(i => i.typeOfTime === this.selectedTimeType);
      }
      this.allRows = filtered.map(i => ({
        inspectorName: i.inspector,
        customer: i.client || projectClientMap.get(i.projectId) || '',
        project: i.project,
        busNumber: i.vehicle,
        typeOfTime: i.typeOfTime,
        date: i.date.substring(0, 10),
        hoursLogged: i.hours,
        ticketsGenerated: 0,
      }));
      this.applySearch();
      this.isLoading = false;
      this.reportRun = true;
    });
  }

  applySearch(): void {
    const s = this.searchTerm.toLowerCase();
    if (!s) {
      this.filteredRows = [...this.allRows];
    } else {
      this.filteredRows = this.allRows.filter(r =>
        r.inspectorName.toLowerCase().includes(s) ||
        r.customer.toLowerCase().includes(s) ||
        r.project.toLowerCase().includes(s) ||
        r.busNumber.toLowerCase().includes(s) ||
        r.typeOfTime.toLowerCase().includes(s) ||
        r.date.includes(s) ||
        String(r.hoursLogged).includes(s) ||
        String(r.ticketsGenerated).includes(s)
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
    const clientLabel = this.selectedClient ? this.selectedClient.name : 'All';
    const projectLabel = this.selectedProject ? this.selectedProject.name : 'All';
    const inspectorLabel = this.selectedInspector ? this.selectedInspector.name : 'All';
    const timeTypeLabel = this.selectedTimeType ?? 'All';
    const fromLabel = this.fromDate || '-';
    const toLabel = this.toDate || '-';
    const logoTag = logoBase64
      ? `<img src="${logoBase64}" alt="BusPulse Logo" class="logo-img">`
      : '<div class="logo-placeholder">BusPulse</div>';

    const rows = this.filteredRows.map(r => `
      <tr>
        <td>${r.inspectorName}</td>
        <td>${r.customer}</td>
        <td>${r.project}</td>
        <td>${r.busNumber}</td>
        <td>${r.typeOfTime}</td>
        <td>${r.date}</td>
        <td>${r.hoursLogged}</td>
        <td>${r.ticketsGenerated}</td>
      </tr>`).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>BusPulse Summary Report for Time Logged</title>
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
          <h1>BusPulse Summary Report for Time Logged</h1>
          <p>Inspector Time Summary</p>
        </div>
        <div class="logo-section">${logoTag}</div>
      </div>

      <div class="project-info">
        <strong>Client: ${clientLabel}</strong> | <strong>Start Date: ${fromLabel}</strong> | <strong>End Date: ${toLabel}</strong> | <strong>Project: ${projectLabel}</strong> | <strong>Inspector: ${inspectorLabel}</strong> | <strong>Type of Time: ${timeTypeLabel}</strong> | Generated: ${new Date().toLocaleString()}
      </div>

      <div class="section-header">Summary Report for Time Logged</div>
      <table>
        <thead>
          <tr>
            <th>Inspector Name</th>
            <th>Customer</th>
            <th>Project</th>
            <th>Bus #</th>
            <th>Type of Time</th>
            <th>Date</th>
            <th>Hours Logged</th>
            <th># of Tickets Generated</th>
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

  private formatDateForCSV(dateStr: string): string {
    if (!dateStr) return '-';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const [year, month, day] = dateStr.split('-');
    const m = parseInt(month, 10);
    return `${day}-${months[m - 1]}-${year}`;
  }

  downloadReport(): void {
    if (!this.filteredRows.length) return;

    const clientLabel = this.selectedClient ? this.selectedClient.name : 'All';
    const projectLabel = this.selectedProject ? this.selectedProject.name : 'All';
    const inspectorLabel = this.selectedInspector ? this.selectedInspector.name : 'All';
    const timeTypeLabel = this.selectedTimeType ?? 'All';
    const fromLabel = this.fromDate ? this.formatDateForCSV(this.fromDate) : '-';
    const toLabel = this.toDate ? this.formatDateForCSV(this.toDate) : '-';
    const generated = new Date().toLocaleString();

    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const qDate = (v: string) => `"=""${v}"""`;

    const metaRows = [
      [q('BusPulse Summary Report for Time Logged')],
      [q('Inspector Time Summary')],
      [],
      [q('Client:'), q(clientLabel), q('Start Date:'), q(fromLabel), q('End Date:'), q(toLabel), q('Project:'), q(projectLabel), q('Inspector:'), q(inspectorLabel), q('Type of Time:'), q(timeTypeLabel)],
      [q('Generated:'), q(generated)],
      [],
      [q('Summary Report for Time Logged')],
      [],
    ];

    const tableHeaders = ['Inspector Name', 'Customer', 'Project', 'Bus #', 'Type of Time', 'Date', 'Hours Logged', '# of Tickets Generated'];
    const dataRows = this.filteredRows.map(r => [
      q(r.inspectorName), q(r.customer), q(r.project), q(r.busNumber),
      q(r.typeOfTime), qDate(this.formatDateForCSV(r.date)), q(String(r.hoursLogged)), q(String(r.ticketsGenerated))
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
    a.download = 'summary-time-logged.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
