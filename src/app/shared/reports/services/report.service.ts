import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, catchError } from 'rxjs/operators';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import { DashboardProjectsService } from '../../services/dashboard-projects.service';
import { ClientService } from '../../services/client.service';
import { AuthService } from '../../services/auth.service';
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
    private readonly clientService: ClientService,
    private readonly authService: AuthService,
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

  // Resolve client scope from logged-in user for report pages.
  private getScopedClientId(): string | undefined {
    if (!this.isClientScopedRole()) {
      return undefined;
    }

    const clientId = Number(this.authService.currentUserValue?.clientId ?? 0);
    return Number.isFinite(clientId) && clientId > 0 ? String(clientId) : undefined;
  }

  // Client/user roles should only see their own client projects.
  private isClientScopedRole(): boolean {
    const role = (this.authService.currentUserValue?.role ?? '').toLowerCase().trim();
    return role === 'client' || role === 'user' || role.includes('client');
  }

  // ...existing code...

  /**
   * Fetch ticket reports from backend
   * TODO: Replace with actual HttpClient call when backend is ready
   */
  getTicketReports(request: TicketReportRequest): Observable<TicketReportResponse> {
    const scopedClientId = this.getScopedClientId();
    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 10;
    const projectId = this.toPositiveNumber(request.projectId);

    return this.clientDashboardService
      .getTickets({
        clientId: scopedClientId ? Number(scopedClientId) : undefined,
        projectId: projectId ?? 0,
        userId: 0,
        vehicleId: 0,
        page,
        pageSize,
      } as any)
      .pipe(
        map((response: any) => {
          const items = this.extractItems(response);
          const mapped = items
            .map((item: any, index: number) => this.mapApiTicketReport(item, index))
            .filter((ticket): ticket is TicketReport => ticket !== null);

          const filtered = this.applyTicketReportFilters(mapped, request);

          return {
            success: true,
            data: filtered,
            totalCount: this.extractTotalCount(response, filtered.length),
            page,
            pageSize,
            message: response?.message ?? 'Ticket reports fetched successfully',
          } as TicketReportResponse;
        }),
        catchError(() =>
          of({
            success: false,
            data: [],
            totalCount: 0,
            page,
            pageSize,
            message: 'Failed to fetch ticket reports',
          } as TicketReportResponse),
        ),
      );
  }

  private applyTicketReportFilters(tickets: TicketReport[], request: TicketReportRequest): TicketReport[] {
    let filtered = [...tickets];

    const projectId = this.toPositiveNumber(request.projectId);
    if (projectId) {
      filtered = filtered.filter((ticket) => ticket.projectId === projectId);
    }

    if (request.searchTerm) {
      const search = request.searchTerm.toLowerCase();
      filtered = filtered.filter((ticket) =>
        ticket.ticketNumber.toLowerCase().includes(search) ||
        ticket.vehicleIdentifier.toLowerCase().includes(search) ||
        ticket.description.toLowerCase().includes(search) ||
        ticket.defectType.toLowerCase().includes(search) ||
        ticket.clientName.toLowerCase().includes(search),
      );
    }

    return filtered;
  }

  private mapApiTicketReport(item: any, index: number): TicketReport | null {
    const id = this.toPositiveNumber(this.first(item, ['id', 'ticketId', 'ticketID'])) ?? index + 1;
    const projectId = this.toPositiveNumber(this.first(item, ['projectId', 'ProjectId', 'project.id'])) ?? 0;
    const vehicleId = this.toPositiveNumber(this.first(item, ['vehicleId', 'VehicleId', 'vehicle.id'])) ?? 0;

    const ticketClientId = this.toPositiveNumber(
      this.first(item, ['clientId', 'ClientId', 'client.id', 'project.clientId', 'project.ClientId']),
    ) ?? 0;
    const projectClientId = projectId > 0 ? (this.projectClientIdByProjectId.get(projectId) ?? 0) : 0;
    const clientId = projectClientId || ticketClientId;

    const explicitClientName = this.toOptionalText(
      this.first(item, ['clientName', 'ClientName', 'customerName', 'client.name', 'client.displayName', 'client']),
    );

    const explicitProjectName = this.toOptionalText(
      this.first(item, ['projectName', 'ProjectName', 'project.name', 'project.title', 'project']),
    );

    const projectName = explicitProjectName && !/^\d+$/.test(explicitProjectName)
      ? explicitProjectName
      : (this.projectNameById.get(projectId) ?? (projectId > 0 ? `Project ${projectId}` : 'N/A'));

    const fleetNumber = this.toOptionalText(
      this.first(item, ['fleetNumber', 'FleetNumber', 'vehicleFleetNumber', 'vehicle.fleetNumber', 'vehicle.fleetNo', 'vehicle.unitNumber']),
    );

    return {
      id,
      ticketNumber: this.toText(this.first(item, ['ticketNumber', 'ticketNo', 'number', 'ticketCode']), `T${id}`),
      clientId,
      clientName: clientId > 0
        ? this.clientService.resolveClientName(clientId, explicitClientName ?? 'N/A')
        : (explicitClientName ?? 'N/A'),
      projectId,
      projectName,
      vehicleId,
      vehicleIdentifier: this.toText(
        vehicleId > 0
          ? String(vehicleId)
          : (fleetNumber ?? this.first(item, ['vehicleNumber', 'vehicleIdentifier', 'vehicle.vehicleNumber'])),
        vehicleId > 0 ? `Fleet ${vehicleId}` : 'N/A',
      ),
      safetyCritical: Boolean(this.first(item, ['safetyCritical', 'isSafetyCritical'])),
      createdDate: this.toText(this.first(item, ['createdDate', 'createdAt', 'date']), ''),
      defectType: this.toText(this.first(item, [
        'defectType',
        'defectTypeName',
        'issueType',
        'defectLocationName',
      ]), '-'),
      defectLocation: this.toText(this.first(item, ['defectLocationName', 'defectLocation', 'location', 'defect.locationName']), '-'),
      description: this.toText(this.first(item, ['ticketDescription', 'description', 'details', 'comment']), '-'),
      hasImages: Boolean(this.first(item, ['hasImages', 'hasAttachments', 'hasPhotos'])),
      imageCount: this.toPositiveNumber(this.first(item, ['imageCount', 'attachmentsCount'])) ?? 0,
      assignedById: this.toPositiveNumber(this.first(item, ['assignedById', 'ticketAssignedBy', 'createdById', 'userId'])) ?? 0,
      assignedByName: this.toText(this.first(item, ['assignedByName', 'ticketAssignedByName', 'createdByName', 'reportedBy']), '-'),
      assignedToId: this.toPositiveNumber(this.first(item, ['assignedToId', 'ownerId'])) ?? 0,
      assignedToName: this.toText(this.first(item, ['assignedToName', 'ownerName', 'assigneeName']), '-'),
      stationId: this.toPositiveNumber(this.first(item, ['stationId', 'StationId', 'station.id', 'station.stationId'])),
      stationName: this.toOptionalText(this.first(item, [
        'stationName',
        'StationName',
        'station_name',
        'stationname',
        'station',
        'station.title',
        'station.displayName',
        'station.name',
        'station.stationName',
        'station.station',
      ])),
      status: this.toText(this.first(item, ['statusTicketName', 'ticketStatusName', 'statusName', 'status', 'ticketStatus', 'state']), 'Pending'),
      resolvedDate: this.toOptionalText(this.first(item, ['resolvedDate', 'closedDate'])),
    };
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
