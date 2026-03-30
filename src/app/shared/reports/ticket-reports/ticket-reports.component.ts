import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { ReportService, TicketReport, TicketReportRequest, Project, Inspector } from '../services/report.service';
import { AuthService } from '../../services/auth.service';
import { resolveReportRouteContext } from '../report-route-context';
import { buildPaginationItems } from '../../utils/pagination.utils';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-ticket-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './ticket-reports.component.html',
  styleUrls: ['./ticket-reports.component.scss']
})
export class TicketReportsComponent implements OnInit {
    // Sorting state
    sortColumn: string = '';
    sortDirection: 'asc' | 'desc' = 'asc';
    /**
     * Sort tickets by column
     */
    sortTickets(column: string) {
      if (this.sortColumn === column) {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortColumn = column;
        this.sortDirection = 'asc';
      }
      // Map column to TicketReport property
      const columnMap: { [key: string]: keyof TicketReport } = {
        ticketNumber: 'ticketNumber',
        clientName: 'clientName',
        projectName: 'projectName',
        vehicleIdentifier: 'vehicleIdentifier',
        safetyCritical: 'safetyCritical',
        createdDate: 'createdDate',
        defectType: 'defectType',
        description: 'description',
        hasImages: 'hasImages',
        assignedByName: 'assignedByName',
        assignedToName: 'assignedToName',
        stationName: 'stationName',
        status: 'status',
        resolvedDate: 'resolvedDate'
      };
      const prop = columnMap[column];
      if (!prop) return;
      this.filteredTickets.sort((a, b) => {
        if (prop === 'safetyCritical') {
          const aRank = a.safetyCritical ? 0 : 1;
          const bRank = b.safetyCritical ? 0 : 1;
          return this.sortDirection === 'asc' ? aRank - bRank : bRank - aRank;
        }

        let aValue = a[prop] ?? '';
        let bValue = b[prop] ?? '';
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }
        if (aValue < bValue) return this.sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return this.sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
  
  // Expose Math to template
  Math = Math;
  
  reportType: 'daily' | 'weekly' = 'daily';
  selectedProject: string = 'all';
  selectedInspector: string = 'all';
  selectedDate: string = '';
  startDate: string = '';
  endDate: string = '';
  searchTerm: string = '';
  
  projects: Project[] = [];
  inspectors: Inspector[] = [];
  
  allTickets: TicketReport[] = [];
  filteredTickets: TicketReport[] = [];
  reportGenerated: boolean = false;
  
  // Loading and error states
  isLoading: boolean = false;
  isLoadingFilters: boolean = false;
  errorMessage: string = '';
  
  // Pagination
  currentPage: number = 1;
  pageSize: number = 10;
  totalCount: number = 0;
  readonly dashboardPath: string;
  readonly reportsPath: string;
  private lastAutoRunSignature: string | null = null;

  constructor(
    private router: Router, 
    private route: ActivatedRoute,
    private reportService: ReportService,
    private readonly authService: AuthService,
  ) {
    const context = resolveReportRouteContext(this.authService.currentUserValue);
    this.dashboardPath = context.dashboardPath;
    this.reportsPath = context.reportsPath;
  }

  ngOnInit() {
    // Set default date to today
    const today = new Date();
    this.selectedDate = today.toISOString().split('T')[0];
    
    // Set default date range for weekly (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    this.startDate = weekAgo.toISOString().split('T')[0];
    this.endDate = today.toISOString().split('T')[0];

    this.route.url.subscribe(segments => {
      const lastSegment = segments[segments.length - 1]?.path;
      this.reportType = lastSegment === 'weekly' ? 'weekly' : 'daily';
      this.applyRouteFilters();
    });

    this.route.queryParamMap.subscribe(() => {
      this.applyRouteFilters();
    });

    this.loadFilterOptions();
  }

  /**
   * Load projects and inspectors for filter dropdowns
   * Ready for backend integration
   */
  loadFilterOptions() {
    this.isLoadingFilters = true;
    
    // Load projects
    this.reportService.getProjects().subscribe({
      next: (projects) => {
        this.projects = projects;
      },
      error: (error) => {
        console.error('Error loading projects:', error);
        this.errorMessage = 'Failed to load projects';
      }
    });
    
    // Load inspectors
    this.reportService.getInspectors().subscribe({
      next: (inspectors) => {
        this.inspectors = inspectors;
        this.isLoadingFilters = false;
      },
      error: (error) => {
        console.error('Error loading inspectors:', error);
        this.errorMessage = 'Failed to load inspectors';
        this.isLoadingFilters = false;
      }
    });
  }

  private applyRouteFilters(): void {
    const queryParams = this.route.snapshot.queryParamMap;
    const selectedProject = this.normalizeRouteValue(queryParams.get('projectId'));
    const selectedInspector = this.normalizeRouteValue(queryParams.get('inspectorId'));
    const selectedDate = this.normalizeDateValue(queryParams.get('date'));
    const startDate = this.normalizeDateValue(queryParams.get('startDate'));
    const endDate = this.normalizeDateValue(queryParams.get('endDate'));

    if (selectedProject) {
      this.selectedProject = selectedProject;
    }

    if (selectedInspector) {
      this.selectedInspector = selectedInspector;
    }

    if (this.reportType === 'daily') {
      if (selectedDate) {
        this.selectedDate = selectedDate;
      } else if (startDate) {
        this.selectedDate = startDate;
      }
    } else {
      if (startDate) {
        this.startDate = startDate;
      }
      if (endDate) {
        this.endDate = endDate;
      } else if (startDate) {
        this.endDate = startDate;
      }
    }

    const autoRun = queryParams.get('autoRun');
    if (autoRun !== '1' && autoRun?.toLowerCase() !== 'true') {
      return;
    }

    const signature = JSON.stringify({
      reportType: this.reportType,
      selectedProject: this.selectedProject,
      selectedInspector: this.selectedInspector,
      selectedDate: this.selectedDate,
      startDate: this.startDate,
      endDate: this.endDate,
    });

    if (signature === this.lastAutoRunSignature) {
      return;
    }

    this.lastAutoRunSignature = signature;
    queueMicrotask(() => this.runReport());
  }

  private normalizeRouteValue(value: string | null): string | null {
    const text = String(value ?? '').trim();
    return text ? text : null;
  }

  private normalizeDateValue(value: string | null): string | null {
    const text = String(value ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }

  switchReportType(type: 'daily' | 'weekly') {
    this.reportType = type;
    this.reportGenerated = false;
    this.errorMessage = '';
    
    // Reset date range for weekly
    if (type === 'weekly') {
      const today = new Date();
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      this.startDate = weekAgo.toISOString().split('T')[0];
      this.endDate = today.toISOString().split('T')[0];
    }
    
    // Navigate to appropriate route
    if (type === 'weekly') {
      this.router.navigate([`${this.reportsPath}/ticket-reports/weekly`]);
      this.router.navigate([`${this.reportsPath}/ticket-reports/weekly`]);
    } else {
      this.router.navigate([`${this.reportsPath}/ticket-reports/daily`]);
      this.router.navigate([`${this.reportsPath}/ticket-reports/daily`]);
    }
  }

  /**
   * Run report with current filters
   * Fetches data from backend via service
   */
  runReport() {
    this.currentPage = 1; // Reset to first page
    this.loadReport();
  }

  /**
   * Load report data with pagination
   */
  loadReport() {
    this.isLoading = true;
    this.errorMessage = '';
    
    const request: TicketReportRequest = {
      reportType: this.reportType,
      projectId: this.selectedProject !== 'all' ? this.selectedProject : undefined,
      inspectorId: this.selectedInspector !== 'all' ? this.selectedInspector : undefined,
      date: this.reportType === 'daily' ? this.selectedDate : undefined,
      startDate: this.reportType === 'weekly' ? this.startDate : undefined,
      endDate: this.reportType === 'weekly' ? this.endDate : undefined,
      searchTerm: this.searchTerm || undefined,
      page: this.currentPage,
      pageSize: this.pageSize
    };
    
    this.reportService.getTicketReports(request).subscribe({
      next: (response) => {
        console.log('Report API response:', response);
        if (response.success) {
          this.allTickets = response.data;
          this.filteredTickets = response.data;
          this.totalCount = response.totalCount;
          this.reportGenerated = true;
        } else {
          this.errorMessage = response.message || 'Failed to fetch reports';
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error fetching reports:', error);
        this.errorMessage = 'Failed to load report data. Please try again.';
        this.isLoading = false;
      }
    });
  }
  /**
   * Filter tickets based on search term
   * Applied client-side after fetching data
   */
  filterTickets() {
    this.currentPage = 1;

    if (!this.searchTerm) {
      this.filteredTickets = [...this.allTickets];
    } else {
      const search = this.searchTerm.toLowerCase();
      this.filteredTickets = this.allTickets.filter((ticket) =>
        this.toSearchText(ticket.ticketNumber).includes(search) ||
        this.toSearchText(ticket.description).includes(search) ||
        this.toSearchText(ticket.defectType).includes(search) ||
        this.toSearchText(ticket.projectName).includes(search) ||
        this.toSearchText(ticket.clientName).includes(search),
      );
    }

    if (this.sortColumn) {
      this.sortTickets(this.sortColumn);
    }
  }

  displayValue(value: unknown): string {
    const text = String(value ?? '').trim();
    return text || '-';
  }

  private toSearchText(value: unknown): string {
    return String(value ?? '').toLowerCase();
  }

  /**
   * Print current report
   */
  async printReport() {
    if (!this.reportGenerated || this.filteredTickets.length === 0) {
      alert('Please generate a report first before printing');
      return;
    }

    try {
      const allTickets = await this.fetchAllTicketsForPrint();
      const logoBase64 = await this.loadLogoAsBase64();
      const html = this.generateTicketReportHTML(allTickets, logoBase64, this.reportType, this.startDate, this.endDate, this.selectedDate);
      const printWindow = window.open('', '', 'height=900,width=1100');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 250);
      }
    } catch (err) {
      console.error('Error preparing print:', err);
      alert('Failed to prepare print report');
    }
  }

  private buildReportRequest(page: number, pageSize: number): TicketReportRequest {
    return {
      reportType: this.reportType,
      projectId: this.selectedProject !== 'all' ? this.selectedProject : undefined,
      inspectorId: this.selectedInspector !== 'all' ? this.selectedInspector : undefined,
      date: this.reportType === 'daily' ? this.selectedDate : undefined,
      startDate: this.reportType === 'weekly' ? this.startDate : undefined,
      endDate: this.reportType === 'weekly' ? this.endDate : undefined,
      searchTerm: this.searchTerm || undefined,
      page,
      pageSize,
    };
  }

  private async fetchAllTicketsForPrint(): Promise<TicketReport[]> {
    const requestPageSize = 200;
    const firstResponse = await firstValueFrom(this.reportService.getTicketReports(this.buildReportRequest(1, requestPageSize)));

    if (!firstResponse || !firstResponse.success) {
      return [...this.filteredTickets];
    }

    const allTickets: TicketReport[] = [...(firstResponse.data ?? [])];
    const totalCount = firstResponse.totalCount || allTickets.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / requestPageSize));

    for (let page = 2; page <= totalPages; page++) {
      const response = await firstValueFrom(this.reportService.getTicketReports(this.buildReportRequest(page, requestPageSize)));
      if (response?.success && response.data?.length) {
        allTickets.push(...response.data);
      }
    }

    return allTickets;
  }

  private loadLogoAsBase64(): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = 'assets/images/brand-logos/login-optimized.jpg';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
            return;
          }
        } catch (e) {
        }
        resolve('');
      };
      img.onerror = () => resolve('');
    });
  }

  private generateTicketReportHTML(tickets: any[], logoBase64: string = '', reportType: 'daily' | 'weekly' = 'daily', startDate?: string, endDate?: string, selectedDate?: string): string {
    const today = new Date();
    const timestamp = today.toLocaleString();
    let html = `<!doctype html><html><head><meta charset="utf-8"><title>Daily Ticket Report</title><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,Helvetica,sans-serif;padding:20px;color:#222}
      .header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:12px}
      .logo{width:110px;height:50px;object-fit:contain}
      .title{flex:1;text-align:center}
      .title h1{font-size:16px;margin-bottom:4px}
      .meta{font-size:12px;color:#333}
      .section{background:#1DB954;color:#fff;padding:8px;border:2px solid #000;margin:12px 0}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{background:#1DB954;color:#fff;padding:6px;border:1px solid #000;text-align:left}
      td{padding:6px;border:1px solid #999;vertical-align:top}
      tr:nth-child(even){background:#f9f9f9}
      .footer{margin-top:12px;border-top:1px solid #ccc;padding-top:8px;font-size:11px;color:#666}
      @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important} th{background:#1DB954!important;color:#fff!important}}
    </style></head><body>`;

    html += `<div class="header">`;
    html += logoBase64 ? `<img src="${logoBase64}" class="logo" alt="Client Logo">` : `<div style="width:110px;height:50px;background:#eee"></div>`;
    const titleText = reportType === 'weekly' ? 'Weekly Report' : 'Daily Ticket Report';
    const projectDisplay = this.getSelectedProjectName();
    let metaText = `Project: ${projectDisplay} | Generated: ${timestamp}`;
    if (reportType === 'weekly') {
      const s = startDate || this.startDate || '';
      const e = endDate || this.endDate || '';
      metaText = `Start Date *: ${s} - End Date: ${e} | Project: ${projectDisplay}`;
    } else if (reportType === 'daily') {
      const d = selectedDate || this.selectedDate || '';
      metaText = `Date: ${d} | Project: ${projectDisplay}`;
    }
    html += `<div class="title"><h1>${titleText}</h1><div class="meta">${metaText}</div></div>`;
    html += logoBase64 ? `<img src="${logoBase64}" class="logo" alt="BusPulse">` : `<div style="width:110px;height:50px;background:#eee"></div>`;
    html += `</div>`;

    html += `<div class="section">Tickets</div>`;

    html += `<table><thead><tr>`;
    const cols = ['Ticket #', 'Vehicle', 'Safety Critical', 'Created Date', 'Defect Type', 'Description', 'Images', 'Assign To', 'Station', 'Status', 'Resolved Date', 'Resolved Comment'];
    cols.forEach(c => html += `<th>${c}</th>`);
    html += `</tr></thead><tbody>`;

    tickets.forEach((t: any) => {
      html += `<tr>`;
      html += `<td>${t.ticketNumber || '-'}</td>`;
      html += `<td>${t.vehicleIdentifier || t.vehicleNumber || '-'}</td>`;
      html += `<td>${t.safetyCritical ? 'Yes' : 'No'}</td>`;
      html += `<td>${t.createdDate ? this.formatDate(t.createdDate) : '-'}</td>`;
      html += `<td>${t.defectType || '-'}</td>`;
      html += `<td>${(t.description || '-').replace(/</g, '&lt;')}</td>`;
      html += `<td>${t.hasImages ? '✓' : '-'}</td>`;
      html += `<td>${t.assignedToName || '-'}</td>`;
      html += `<td>${t.stationName || '-'}</td>`;
      html += `<td>${t.status || '-'}</td>`;
      html += `<td>${t.resolvedDate ? this.formatDate(t.resolvedDate) : '-'}</td>`;
      html += `<td>${(t.resolvedComment || '-')}</td>`;
      html += `</tr>`;
    });

    html += `</tbody></table>`;
    html += `<div class="footer">Total Tickets: ${tickets.length} | Print Date: ${timestamp}</div>`;
    html += `</body></html>`;
    return html;
  }

  private getSelectedProjectName(): string {
    if (this.selectedProject === 'all') {
      return 'All';
    }

    const project = this.projects.find((item) => String(item.id) === this.selectedProject);
    return project?.name ?? this.selectedProject;
  }

  /**
   * Download report as CSV/PDF
   * Ready for backend integration
   */
  downloadReport() {
    const request = {
      reportType: this.reportType,
      format: 'csv' as const,
      filters: {
        reportType: this.reportType,
        projectId: this.selectedProject !== 'all' ? this.selectedProject : undefined,
        inspectorId: this.selectedInspector !== 'all' ? this.selectedInspector : undefined,
        date: this.reportType === 'daily' ? this.selectedDate : undefined,
        startDate: this.reportType === 'weekly' ? this.startDate : undefined,
        endDate: this.reportType === 'weekly' ? this.endDate : undefined
      }
    };
    
    this.reportService.exportReport(request).subscribe({
      next: (blob) => {
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ticket-report-${this.reportType}-${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
      },
      error: (error) => {
        console.error('Error downloading report:', error);
        alert('Failed to download report. Please try again.');
      }
    });
  }

  /**
   * Format date for display
   */
  formatDate(dateString: string): string {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  /**
   * Get CSS class for safety critical badge
   */
  getSafetyCriticalClass(isCritical: boolean): string {
    return isCritical ? 'badge bg-danger' : 'badge bg-secondary';
  }

  /**
   * Get CSS class for status badge
   */
  getStatusClass(status: string): string {
    const statusMap: { [key: string]: string } = {
      'open': 'badge bg-info',
      'in progress': 'badge bg-warning',
      'closed': 'badge bg-success',
      'pending': 'badge bg-secondary'
    };
    return statusMap[status.toLowerCase()] || 'badge bg-secondary';
  }

  /**
   * Go to next page
   */
  nextPage(): void {
    const maxPages = Math.ceil(this.totalCount / this.pageSize);
    if (this.currentPage < maxPages) {
      this.currentPage++;
      this.loadReport();
    }
  }

  /**
   * Go to previous page
   */
  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadReport();
    }
  }

  /**
   * Go to specific page
   */
  goToPage(page: number): void {
    const maxPages = Math.ceil(this.totalCount / this.pageSize);
    if (page >= 1 && page <= maxPages) {
      this.currentPage = page;
      this.loadReport();
    }
  }

  /**
   * Get total number of pages
   */
  getTotalPages(): number {
    return Math.ceil(this.totalCount / this.pageSize);
  }

  /**
   * Get page numbers array for pagination display
   */
  getPageNumbers(): number[] {
    return buildPaginationItems(this.getTotalPages(), this.currentPage, 5);
    return buildPaginationItems(this.getTotalPages(), this.currentPage, 5);
  }
}
