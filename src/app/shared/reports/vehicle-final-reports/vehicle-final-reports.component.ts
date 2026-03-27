import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { forkJoin, map, of, switchMap } from 'rxjs';
import { VehicleReportService, VehicleFinalReport } from '../services/vehicle-report.service';
import { AuthService } from '../../services/auth.service';
import { resolveReportRouteContext } from '../report-route-context';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import { DashboardProjectOption, DashboardProjectsService } from '../../services/dashboard-projects.service';
import { ClientService } from '../../services/client.service';

interface FinalReportProject {
  id: number;
  name: string;
  code: string;
}

interface FinalReportClient {
  id: string;
  name: string;
  code?: string;
}

@Component({
  selector: 'app-vehicle-final-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './vehicle-final-reports.component.html',
  styleUrls: ['./vehicle-final-reports.component.scss']
})
export class VehicleFinalReportsComponent implements OnInit {
    // Sorting state
    sortColumn: string = '';
    sortDirection: 'asc' | 'desc' = 'asc';
    /**
     * Sort reports by column
     */
    sortReports(column: string) {
      if (this.sortColumn === column) {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortColumn = column;
        this.sortDirection = 'asc';
      }
      // Map column to VehicleFinalReport property
      const columnMap: { [key: string]: keyof VehicleFinalReport } = {
        idNumber: 'idNumber',
        clientName: 'clientName',
        projectName: 'projectName',
        fleetNumber: 'fleetNumber',
        vin: 'vin'
      };
      const prop = columnMap[column];
      if (!prop) return;
      this.filteredReports.sort((a, b) => {
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
  
  selectedClient: string = 'all';
  selectedProject: string = 'all';
  searchTerm: string = '';
  
  clients: FinalReportClient[] = [];
  projects: FinalReportProject[] = [];
  
  reports: VehicleFinalReport[] = [];
  filteredReports: VehicleFinalReport[] = [];
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

  get isClientScopedRole(): boolean {
    const role = (this.authService.currentUserValue?.role ?? '').toLowerCase().trim();
    return role === 'client' || role === 'user';
  }

  constructor(
    private vehicleReportService: VehicleReportService,
    private readonly clientDashboardService: ClientDashboardService,
    private readonly dashboardProjectsService: DashboardProjectsService,
    private readonly clientService: ClientService,
    private readonly authService: AuthService,
  ) {
    const context = resolveReportRouteContext(this.authService.currentUserValue);
    this.dashboardPath = context.dashboardPath;
  }

  ngOnInit() {
    this.loadFilterOptions();
  }

  get paginatedReports(): VehicleFinalReport[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredReports.slice(start, start + this.pageSize);
  }

  /**
   * Load clients and projects for filters
   */
  loadFilterOptions() {
    this.isLoadingFilters = true;

    this.clientService.getClients().subscribe({
      next: (clients) => {
        const mappedClients: FinalReportClient[] = clients
          .map((client) => ({
            id: String(client.id ?? '').trim(),
            name: String(client.name ?? '').trim(),
            code: client.code,
          }))
          .filter((client) => client.id.length > 0 && client.name.length > 0);

        if (this.isClientScopedRole) {
          const currentClientId = this.getCurrentUserClientIdString();
          this.clients = mappedClients.filter((client) => client.id === currentClientId);
          this.selectedClient = this.clients[0]?.id ?? 'all';
        } else {
          this.clients = mappedClients;
          this.selectedClient = 'all';
        }

        this.loadProjectsForCurrentScope();
      },
      error: (error) => {
        console.error('Error loading clients:', error);
        this.errorMessage = 'Failed to load clients';
        this.isLoadingFilters = false;
      },
    });
  }

  onClientChange(): void {
    if (this.isClientScopedRole) return;
    this.selectedProject = 'all';
    this.projects = [];
    this.reportGenerated = false;
    this.loadProjectsForCurrentScope();
  }

  private loadProjectsForCurrentScope(): void {
    const effectiveClientId = this.getEffectiveClientId();

    this.dashboardProjectsService.getProjectOptions({
      clientId: effectiveClientId,
      includeClosed: true,
      includeAllOption: false,
    }).subscribe({
      next: (projects) => {
        this.projects = projects
          .map((project) => this.mapProjectOption(project))
          .filter((project): project is FinalReportProject => project !== null);

        this.selectedProject = 'all';
        this.isLoadingFilters = false;
      },
      error: (error) => {
        console.error('Error loading projects:', error);
        this.errorMessage = 'Failed to load projects';
        this.projects = [];
        this.isLoadingFilters = false;
      },
    });
  }

  /**
   * Run report with current filters
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

    const request = {
      clientId: this.selectedClient !== 'all'
        ? this.toNumber(this.selectedClient) ?? undefined
        : this.getEffectiveClientId(),
      projectId: this.selectedProject !== 'all'
        ? this.toNumber(this.selectedProject) ?? undefined
        : undefined,
      page: 1,
      pageSize: 10000,
    };

    this.vehicleReportService.getVehicleFinalReports(request).subscribe({
      next: (response) => {
        if (response?.success && (response.data?.length ?? 0) > 0) {
          this.reports = response.data ?? [];
          this.applyFiltersToMappedReports();
          this.reportGenerated = true;
          this.isLoading = false;
          return;
        }

        this.loadReportFromProjectVehicles();
      },
      error: (error) => {
        console.error('Error fetching vehicle final reports:', error);
        this.loadReportFromProjectVehicles();
      }
    });
  }

  private loadReportFromProjectVehicles(): void {
    of(this.projects).pipe(
      map((projects) => {
        if (this.selectedProject === 'all') {
          return projects;
        }
        return projects.filter((project) => String(project.id) === this.selectedProject);
      }),
      switchMap((projects) => {
        if (!projects.length) {
          return of([] as VehicleFinalReport[]);
        }

        const effectiveClientId = this.getEffectiveClientId();

        const requests = projects.map((project) =>
          this.clientDashboardService.getProjectVehicles(project.id, {
            clientId: effectiveClientId,
            page: 1,
            pageSize: 10000,
          }).pipe(
            map((response) => ({ project, vehicles: this.extractItems(response) })),
          ),
        );

        return forkJoin(requests).pipe(
          map((projectVehicles) => this.mapProjectsAndVehiclesToReports(projectVehicles)),
        );
      }),
    ).subscribe({
      next: (mappedReports) => {
        this.reports = mappedReports;
        this.applyFiltersToMappedReports();
        this.reportGenerated = true;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error fetching projects/vehicles fallback:', error);
        this.errorMessage = 'Failed to load final reports. Please try again.';
        this.reports = [];
        this.filteredReports = [];
        this.totalCount = 0;
        this.reportGenerated = true;
        this.isLoading = false;
      }
    });
  }

  /**
   * Filter reports based on search term
   */
  filterReports() {
    this.currentPage = 1;
    this.applyFiltersToMappedReports();
  }

  private applyFiltersToMappedReports(): void {
    let rows = [...this.reports];

    if (this.selectedClient !== 'all') {
      rows = rows.filter((report) => String(report.clientId) === this.selectedClient);
    }

    if (this.selectedProject !== 'all') {
      rows = rows.filter((report) => String(report.projectId) === this.selectedProject);
    }

    const search = this.searchTerm.trim().toLowerCase();
    if (search) {
      rows = rows.filter((report) =>
        report.fleetNumber.toLowerCase().includes(search) ||
        report.vin.toLowerCase().includes(search) ||
        report.idNumber.toLowerCase().includes(search) ||
        report.projectName.toLowerCase().includes(search),
      );
    }

    this.filteredReports = rows;
    this.totalCount = rows.length;

    const totalPages = this.getTotalPages();
    if (this.currentPage > totalPages) {
      this.currentPage = totalPages;
    }

    if (this.sortColumn) {
      this.sortReports(this.sortColumn);
    }
  }

  private mapProjectsAndVehiclesToReports(
    projectVehicles: Array<{ project: FinalReportProject; vehicles: any[] }>,
  ): VehicleFinalReport[] {
    const generatedAt = new Date().toISOString();
    const effectiveClientId = this.getEffectiveClientId();

    return projectVehicles.flatMap(({ project, vehicles }) => {
      const safeVehicles = vehicles ?? [];

      return safeVehicles.map((vehicle, index) => {
        const vehicleIdRaw = this.getFirstDefinedValue(vehicle, ['id', 'vehicleId', 'vehicleID', 'VehicleId', 'VehicleID']);
        const fleetNumber = String(
          this.getFirstDefinedValue(vehicle, ['fleetNumber', 'vehicleNumber', 'name', 'title']) ?? `Vehicle-${index + 1}`,
        ).trim();
        const vin = String(this.getFirstDefinedValue(vehicle, ['vin', 'VIN']) ?? '-').trim() || '-';

        const vehicleClientIdRaw = this.getFirstDefinedValue(vehicle, ['clientId', 'client_id', 'ClientId', 'ClientID']);
        const resolvedClientId = this.toNumber(vehicleClientIdRaw)
          ?? effectiveClientId
          ?? this.toNumber(this.clients[0]?.id)
          ?? 0;

        const clientName = this.resolveClientNameById(resolvedClientId);

        const fallbackVehicleId = project.id * 1000 + index + 1;
        const numericVehicleId = this.toNumber(vehicleIdRaw) ?? fallbackVehicleId;

        return {
          id: numericVehicleId,
          idNumber: `${project.code || 'PRJ'}-${fleetNumber}`,
          clientId: resolvedClientId,
          clientName,
          projectId: project.id,
          projectName: project.name,
          vehicleId: numericVehicleId,
          fleetNumber,
          vin,
          reportGeneratedDate: generatedAt,
          reportStatus: 'Completed' as const,
          totalDefects: 0,
          criticalDefects: 0,
          resolvedDefects: 0,
          pendingDefects: 0,
        };
      });
    });
  }

  private mapProjectOption(project: DashboardProjectOption): FinalReportProject | null {
    const numericId = this.toNumber(project.id);
    if (numericId === null) {
      return null;
    }

    const name = String(project.name ?? '').trim();
    if (!name) {
      return null;
    }

    return {
      id: numericId,
      name,
      code: `PRJ${numericId}`,
    };
  }

  private getCurrentUserClientIdString(): string {
    const id = this.authService.currentUserValue?.clientId;
    return Number.isFinite(id) && Number(id) > 0 ? String(id) : '';
  }

  private getEffectiveClientId(): number | undefined {
    if (this.isClientScopedRole) {
      const current = this.toNumber(this.getCurrentUserClientIdString());
      return current ?? undefined;
    }

    if (this.selectedClient === 'all') {
      return undefined;
    }

    const parsed = this.toNumber(this.selectedClient);
    return parsed ?? undefined;
  }

  private resolveClientNameById(clientId: number): string {
    const key = String(clientId);
    const fromLoaded = this.clients.find((client) => client.id === key)?.name;
    if (fromLoaded) {
      return fromLoaded;
    }
    return this.clientService.resolveClientName(key, key);
  }

  private toNumber(value: unknown): number | null {
    const parsed = Number(String(value ?? '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  private extractItems(response: unknown): any[] {
    if (Array.isArray(response)) {
      return response;
    }

    if (!response || typeof response !== 'object') {
      return [];
    }

    const obj = response as Record<string, unknown>;
    if (Array.isArray(obj['items'])) return obj['items'] as any[];
    if (Array.isArray(obj['data'])) return obj['data'] as any[];
    if (Array.isArray(obj['results'])) return obj['results'] as any[];
    if (Array.isArray(obj['vehicles'])) return obj['vehicles'] as any[];

    if (obj['data'] && typeof obj['data'] === 'object') {
      const nested = obj['data'] as Record<string, unknown>;
      if (Array.isArray(nested['items'])) return nested['items'] as any[];
      if (Array.isArray(nested['vehicles'])) return nested['vehicles'] as any[];
    }

    return [];
  }

  private getFirstDefinedValue(source: any, keys: string[]): unknown {
    if (!source || typeof source !== 'object') return undefined;

    for (const key of keys) {
      const direct = source[key];
      if (direct !== undefined && direct !== null) {
        return direct;
      }
    }

    const lowered = Object.entries(source as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, value]) => {
      acc[key.toLowerCase()] = value;
      return acc;
    }, {});

    for (const key of keys) {
      const value = lowered[key.toLowerCase()];
      if (value !== undefined && value !== null) {
        return value;
      }
    }

    return undefined;
  }

  /**
   * Download vehicle health report
   */
  downloadReport(report: VehicleFinalReport) {
    this.vehicleReportService.downloadVehicleHealthReport(report.id).subscribe({
      next: (blob) => {
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Vehicle-Health-Report-${report.fleetNumber}.pdf`;
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
    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric'
    });
  }

  /**
   * Get CSS class for status badge
   */
  getStatusClass(status: string): string {
    const statusMap: { [key: string]: string } = {
      'draft': 'badge bg-secondary',
      'completed': 'badge bg-success',
      'approved': 'badge bg-primary',
      'pending review': 'badge bg-warning'
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
    }
  }

  /**
   * Go to previous page
   */
  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  /**
   * Go to specific page
   */
  goToPage(page: number): void {
    const maxPages = Math.ceil(this.totalCount / this.pageSize);
    if (page >= 1 && page <= maxPages) {
      this.currentPage = page;
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
    const totalPages = this.getTotalPages();
    const pages: number[] = [];
    const maxPagesToShow = 5;
    
    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      const startPage = Math.max(1, this.currentPage - 2);
      const endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
      
      if (startPage > 1) pages.push(1);
      if (startPage > 2) pages.push(-1);
      
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }
      
      if (endPage < totalPages - 1) pages.push(-1);
      if (endPage < totalPages) pages.push(totalPages);
    }
    
    return pages;
  }
}
