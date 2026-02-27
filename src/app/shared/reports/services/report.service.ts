import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, catchError } from 'rxjs/operators';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import { DashboardProjectsService } from '../../services/dashboard-projects.service';
import { Observable, of, delay } from 'rxjs';

// API Request/Response Interfaces
export interface TicketReportRequest {
  reportType: 'daily' | 'weekly';
  projectId?: string;
  inspectorId?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  searchTerm?: string;
  page?: number;
  pageSize?: number;
}

export interface TicketReportResponse {
  success: boolean;
  data: TicketReport[];
  totalCount: number;
  page: number;
  pageSize: number;
  message?: string;
}

export interface TicketReport {
  id: number;
  ticketNumber: string;
  clientId: number;
  clientName: string;
  projectId: number;
  projectName: string;
  vehicleId: number;
  vehicleIdentifier: string;
  safetyCritical: boolean;
  createdDate: string;
  defectType: string;
  defectLocation: string;
  description: string;
  hasImages: boolean;
  imageCount?: number;
  assignedById: number;
  assignedByName: string;
  assignedToId: number;
  assignedToName: string;
  stationId?: number;
  stationName?: string;
  status: string;
  resolvedDate?: string;
}

export interface Project {
  id: number;
  name: string;
  code: string;
}

export interface Inspector {
  id: number;
  name: string;
  email: string;
}

export interface ReportExportRequest {
  reportType: 'daily' | 'weekly';
  format: 'csv' | 'pdf' | 'excel';
  filters: TicketReportRequest;
}

@Injectable({
  providedIn: 'root'
})
export class ReportService {
    private extractItems(response: any): any[] {
      const candidates: any[][] = [];

      if (Array.isArray(response)) candidates.push(response);
      if (Array.isArray(response?.$values)) candidates.push(response.$values);
      if (Array.isArray(response?.data)) candidates.push(response.data);
      if (Array.isArray(response?.data?.$values)) candidates.push(response.data.$values);
      if (Array.isArray(response?.data?.items)) candidates.push(response.data.items);
      if (Array.isArray(response?.items)) candidates.push(response.items);
      if (Array.isArray(response?.results)) candidates.push(response.results);
      if (Array.isArray(response?.value)) candidates.push(response.value);
      if (Array.isArray(response?.value?.$values)) candidates.push(response.value.$values);
      if (Array.isArray(response?.payload?.items)) candidates.push(response.payload.items);

      if (!candidates.length) {
        return [];
      }

      return candidates.reduce((longest, current) =>
        current.length > longest.length ? current : longest,
      );
    }

    private extractTotalCount(response: any, fallbackCount: number): number {
      const total = this.toPositiveNumber(
        this.first(response, ['totalCount', 'total', 'count', 'recordCount', 'recordsTotal']),
      );
      return total ?? fallbackCount;
    }

    private first(source: any, keys: string[]): any {
      for (const key of keys) {
        if (key.includes('.')) {
          const resolved = key.split('.').reduce((acc: any, part) => acc?.[part], source);
          if (resolved !== undefined && resolved !== null) {
            return resolved;
          }
          continue;
        }

        if (source?.[key] !== undefined && source?.[key] !== null) {
          return source[key];
        }
      }
      return undefined;
    }

    private toPositiveNumber(value: any): number | undefined {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    private toText(value: any, fallback: string): string {
      const text = String(value ?? '').trim();
      return text || fallback;
    }

    private toOptionalText(value: any): string | undefined {
      const text = String(value ?? '').trim();
      return text || undefined;
    }
  private apiUrl = '/api/reports'; // Backend API URL
  private apiBaseUrl = '/api'; // Stub value, update as needed
  private projectNameById = new Map<number, string>();
  private projectClientIdByProjectId = new Map<number, number>();

  constructor(
    private readonly http: HttpClient,
    private readonly clientDashboardService: ClientDashboardService,
    private readonly dashboardProjectsService: DashboardProjectsService,
  ) {}

  // Stub for getMockTicketReports
  private getMockTicketReports(request: TicketReportRequest): TicketReportResponse {
    return {
      success: true,
      data: [],
      totalCount: 0,
      page: request.page ?? 1,
      pageSize: request.pageSize ?? 10,
      message: 'Mock data',
    };
  }

  // Stub for getScopedClientId
  private getScopedClientId(): string | undefined {
    return undefined;
  }

  // Stub for isClientScopedRole
  private isClientScopedRole(): boolean {
    return false;
  }

  // ...existing code...

  /**
   * Fetch ticket reports from backend
   * TODO: Replace with actual HttpClient call when backend is ready
   */
  getTicketReports(request: TicketReportRequest): Observable<TicketReportResponse> {
    // Simulated API call - Replace with actual HTTP call
    // return this.http.post<TicketReportResponse>(`${this.apiUrl}/tickets`, request);
    
    return of(this.getMockTicketReports(request)).pipe(delay(500));
  }

  /**
   * Fetch list of projects for filter dropdown
   * TODO: Replace with actual HttpClient call
   */
  getProjects(): Observable<Project[]> {
    const scopedClientId = this.getScopedClientId();

    if (this.isClientScopedRole() && !scopedClientId) {
      return of([]);
    }

    const clientIdNum = scopedClientId ? Number(scopedClientId) : undefined;
    return this.clientDashboardService.getProjects({
      clientId: clientIdNum,
      includeClosed: true,
      page: 1,
      pageSize: 10000,
    }).pipe(
      map((response: any) => {
        const items = this.extractItems(response);

        this.projectNameById.clear();
        this.projectClientIdByProjectId.clear();

        const mapped = items
          .map((item: any) => {
            const id = this.toPositiveNumber(this.first(item, ['id', 'projectId', 'ProjectId']));
            if (!id) {
              return null;
            }

            const name = this.toOptionalText(this.first(item, ['name', 'projectName', 'ProjectName', 'title']));
            if (!name) {
              return null;
            }

            const clientId = this.toPositiveNumber(this.first(item, ['clientId', 'ClientId', 'client.id']));
            if (clientId) {
              this.projectClientIdByProjectId.set(id, clientId);
            }

            this.projectNameById.set(id, name);

            return {
              id,
              name,
              code: name,
            } as Project;
          })
          .filter((project): project is Project => project !== null);

        return mapped;
      }),
      catchError(() => this.dashboardProjectsService.getProjectOptions({
        clientId: clientIdNum,
        includeClosed: true,
        includeAllOption: false,
        page: 1,
        pageSize: 10000,
      }).pipe(
        map((projects) => {
          const mapped = projects
            .map((project) => {
              const id = Number(project.id);
              if (!Number.isFinite(id) || id <= 0) {
                return null;
              }

              const name = String(project.name ?? '').trim();
              if (!name) {
                return null;
              }

              return {
                id,
                name,
                code: name,
              } as Project;
            })
            .filter((project): project is Project => project !== null);

          this.projectNameById.clear();
          this.projectClientIdByProjectId.clear();
          mapped.forEach((project) => this.projectNameById.set(project.id, project.name));

          return mapped;
        }),
      )),
    );
  }

  /**
   * Fetch list of inspectors for filter dropdown
   * TODO: Replace with actual HttpClient call
   */
  getInspectors(): Observable<Inspector[]> {
    return this.http.get<any>(`${this.apiBaseUrl}/Inspectors`).pipe(
      map((response) => this.extractItems(response)
        .map((item: any) => ({
          id: this.toPositiveNumber(this.first(item, ['id', 'inspectorId', 'userId'])) ?? 0,
          name: this.toText(this.first(item, ['name', 'inspectorName', 'fullName']), ''),
          email: this.toText(this.first(item, ['email', 'emailAddress']), ''),
        }))
        .filter((inspector: Inspector) => inspector.id > 0 && inspector.name.length > 0),
      ),
      catchError(() => of([])),
    );
  }

  /**
   * Export report to file (CSV, PDF, Excel)
   * TODO: Replace with actual HttpClient call
   */
  exportReport(request: ReportExportRequest): Observable<Blob> {
    return this.http.post(`${this.apiBaseUrl}/reports/export`, request, { responseType: 'blob' });
  }

  /**
   * Get report statistics/summary
   * TODO: Replace with actual HttpClient call
   */
  getReportStatistics(request: TicketReportRequest): Observable<any> {
    const projectId = this.toPositiveNumber(request.projectId);
    return this.clientDashboardService.getTicketsDashboard({
      projectId,
    } as any).pipe(
      catchError(() => of({})),
    );
  }
}
