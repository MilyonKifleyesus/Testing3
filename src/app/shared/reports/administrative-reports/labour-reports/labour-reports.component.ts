import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { resolveReportRouteContext } from '../../report-route-context';
import { ReportService, Project, Inspector } from '../../services/report.service';

export interface LabourReportRow {
  date: string;
  project: string;
  vehicle: string;
  typeOfTime: string;
  inspector: string;
  description: string;
  hours: number;
}

@Component({
  selector: 'app-labour-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './labour-reports.component.html',
  styleUrls: ['./labour-reports.component.scss']
})
export class LabourReportsComponent implements OnInit {
  readonly dashboardPath: string;
  readonly reportsPath: string;

  // Dropdown options
  projects: Project[] = [];
  inspectors: Inspector[] = [];
  typeOfTimeOptions: string[] = [];

  // Search state for dropdowns
  projectSearch = '';
  inspectorSearch = '';
  showProjectDropdown = false;
  showInspectorDropdown = false;
  showTypeOfTimeDropdown = false;

  // Filter values
  selectedProject: Project | null = null;
  selectedInspector: Inspector | null = null;
  selectedTypeOfTime: string | null = null;
  fromDate = '';
  toDate = '';

  // Table state
  reportRun = false;
  isLoading = false;
  searchTerm = '';
  allRows: LabourReportRow[] = [];
  filteredRows: LabourReportRow[] = [];

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
    this.reportService.getProjects().subscribe(p => this.projects = p);
    this.loadDropdownOptions();
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
    // Reset inspector selection and reload options scoped to this project
    this.selectedInspector = null;
    this.inspectorSearch = '';
    this.selectedTypeOfTime = null;
    this.loadDropdownOptions(p ? { projectId: p.id } : undefined);
  }
  selectInspector(i: Inspector | null): void {
    this.selectedInspector = i;
    this.inspectorSearch = i ? i.name : '';
    this.showInspectorDropdown = false;
  }

  selectTypeOfTime(t: string | null): void {
    this.selectedTypeOfTime = t;
    this.showTypeOfTimeDropdown = false;
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

      this.typeOfTimeOptions = items
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

  runReport(): void {
    this.isLoading = true;
    this.reportRun = false;

    const params: { projectId?: number; inspectorId?: number; startDate?: string; endDate?: string } = {};
    if (this.selectedProject) params.projectId = this.selectedProject.id;
    if (this.selectedInspector) params.inspectorId = this.selectedInspector.id;
    if (this.fromDate) params.startDate = this.fromDate;
    if (this.toDate) params.endDate = this.toDate;

    this.reportService.getLabourReport(params).subscribe({
      next: (items) => {
        // Client-side filters (API may not filter server-side)
        let filtered = items;
        if (this.selectedInspector) {
          filtered = filtered.filter(i => i.inspectorId === this.selectedInspector!.id);
        }
        if (this.fromDate) {
          filtered = filtered.filter(i => i.date.substring(0, 10) >= this.fromDate);
        }
        if (this.toDate) {
          filtered = filtered.filter(i => i.date.substring(0, 10) <= this.toDate);
        }

        let rows: LabourReportRow[] = filtered.map(item => ({
          date: item.dateText || item.date.substring(0, 10),
          project: item.project,
          vehicle: item.vehicle,
          typeOfTime: item.typeOfTime,
          inspector: item.inspector,
          description: item.description,
          hours: item.hours,
        }));

        // Client-side typeOfTime filter
        if (this.selectedTypeOfTime) {
          rows = rows.filter(r => r.typeOfTime === this.selectedTypeOfTime);
        }

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
        r.date.includes(s) ||
        r.project.toLowerCase().includes(s) ||
        r.vehicle.toLowerCase().includes(s) ||
        r.typeOfTime.toLowerCase().includes(s) ||
        r.inspector.toLowerCase().includes(s) ||
        r.description.toLowerCase().includes(s) ||
        String(r.hours).includes(s)
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
    const projectLabel = this.selectedProject ? this.selectedProject.name : 'All';
    const inspectorLabel = this.selectedInspector ? this.selectedInspector.name : 'All';
    const typeLabel = this.selectedTypeOfTime ?? 'All';
    const fromLabel = this.fromDate || '-';
    const toLabel = this.toDate || '-';
    const logoTag = logoBase64
      ? `<img src="${logoBase64}" alt="BusPulse Logo" class="logo-img">`
      : '<div class="logo-placeholder">BusPulse</div>';

    const rows = this.filteredRows.map(r => `
      <tr>
        <td>${r.date}</td>
        <td>${r.project}</td>
        <td>${r.vehicle}</td>
        <td>${r.typeOfTime}</td>
        <td>${r.inspector}</td>
        <td>${r.description}</td>
        <td>${r.hours}</td>
      </tr>`).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>BusPulse Labour Report</title>
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
          <h1>BusPulse Labour Report</h1>
          <p>Labour Summary</p>
        </div>
        <div class="logo-section">${logoTag}</div>
      </div>

      <div class="project-info">
        <strong>Start Date: ${fromLabel}</strong> | <strong>End Date: ${toLabel}</strong> | <strong>Project: ${projectLabel}</strong> | <strong>Inspector: ${inspectorLabel}</strong> | <strong>Type of Time: ${typeLabel}</strong> | Generated: ${new Date().toLocaleString()}
      </div>

      <div class="section-header">Labour Report</div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Project</th>
            <th>Fleet Number</th>
            <th>Type of Time</th>
            <th>Inspector</th>
            <th>Description</th>
            <th>Hours</th>
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

    const projectLabel = this.selectedProject ? this.selectedProject.name : 'All';
    const inspectorLabel = this.selectedInspector ? this.selectedInspector.name : 'All';
    const typeLabel = this.selectedTypeOfTime ?? 'All';
    const fromLabel = this.fromDate ? this.formatDateForCSV(this.fromDate) : '-';
    const toLabel = this.toDate ? this.formatDateForCSV(this.toDate) : '-';
    const generated = new Date().toLocaleString();

    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const qDate = (v: string) => `"=""${v}"""`;

    const metaRows = [
      [q('BusPulse Labour Report')],
      [q('Labour Summary')],
      [],
      [q('Start Date:'), q(fromLabel), q('End Date:'), q(toLabel), q('Project:'), q(projectLabel), q('Inspector:'), q(inspectorLabel), q('Type of Time:'), q(typeLabel)],
      [q('Generated:'), q(generated)],
      [],
      [q('Labour Report')],
      [],
    ];

    const tableHeaders = ['Date', 'Project', 'Fleet Number', 'Type of Time', 'Inspector', 'Description', 'Hours'];
    const dataRows = this.filteredRows.map(r => [
      qDate(this.formatDateForCSV(r.date)), q(r.project), q(r.vehicle),
      q(r.typeOfTime), q(r.inspector), q(r.description), q(String(r.hours))
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
    a.download = 'labour-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
