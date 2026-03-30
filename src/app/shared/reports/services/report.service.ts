import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, catchError } from 'rxjs/operators';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import { Observable, of, shareReplay } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { fetchAllPages } from '../../services/adapters/pagination-fetch.util';
import { DashboardProjectsService } from '../../services/dashboard-projects.service';
import { AuthService } from '../../services/auth.service';
import { UserManagementService } from '../../services/user-management.service';

// API Request/Response Interfaces
export interface TicketReportRequest {
  reportType: 'daily' | 'weekly';
  projectId?: string;
  inspectorId?: string;
  clientId?: string;
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
  clientId?: number;
}

export interface Inspector {
  id: number;
  name: string;
  email: string;
}

export interface Client {
  id: number;
  name: string;
}

export interface Vehicle {
  id: number;
  fleetNumber: string;
  clientId: number;
}

export interface InspectorAsset {
  clientId: number;
  client: string;
  projectId: number;
  project: string;
  inspectorId: number;
  inspector: string;
  vehicleId: number;
  vehicle: string;
  ticketsOpen: number;
  ticketsClosed: number;
}

export interface InspectorAssetsResponse {
  items: InspectorAsset[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TimeLog {
  id: number;
  vehicleId: number;
  userId: number;
  projectId: number;
  typeOfTimeId: number;
  timeSpent: number; // hours (e.g. 1.2)
  description: string;
  dateStarted: string;
  dateUpdated: string;
}

export interface LabourReportItem {
  date: string;
  dateText: string;
  hours: number;
  clientId: number;
  client: string;
  inspectorId: number;
  inspector: string;
  projectId: number;
  project: string;
  vehicleId: number;
  vehicle: string;
  typeOfTimeId: number;
  typeOfTime: string;
  description: string;
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

  private apiBaseUrl = environment.apiBaseUrl;
  private readonly labourReportCache = new Map<string, Observable<LabourReportItem[]>>();
  private projectNameById = new Map<number, string>();
  private projectClientIdByProjectId = new Map<number, number>();

  constructor(
    private readonly http: HttpClient,
    private readonly clientDashboardService: ClientDashboardService,
    private readonly dashboardProjectsService: DashboardProjectsService,
    private readonly authService: AuthService,
    private readonly userManagementService: UserManagementService,
  ) {}


  /**
   * Fetch ticket reports from backend
   */
  getTicketReports(request: TicketReportRequest): Observable<TicketReportResponse> {
    const page = Math.max(1, Number(request.page ?? 1) || 1);
    const pageSize = Math.max(1, Number(request.pageSize ?? 10) || 10);
    const normalizedProjectId = this.toPositiveNumber(request.projectId);
    const normalizedInspectorId = this.toPositiveNumber(request.inspectorId);
    const normalizedClientId = this.resolveRequestClientId(request.clientId);
    const normalizedDate = this.normalizeDateText(request.date);
    const normalizedStartDate = this.normalizeDateText(request.startDate);
    const normalizedEndDate = this.normalizeDateText(request.endDate);
    const startDate = request.reportType === 'daily'
      ? normalizedDate
      : normalizedStartDate;
    const endDate = request.reportType === 'daily'
      ? normalizedDate
      : (normalizedEndDate ?? normalizedStartDate);

    return this.dashboardProjectsService.getAllTickets({
      clientId: normalizedClientId,
      projectId: normalizedProjectId,
      userId: normalizedInspectorId,
      includeClosed: true,
      startDate: startDate ?? undefined,
      endDate: endDate ?? undefined,
      maxItems: Number.MAX_SAFE_INTEGER,
      pageSize: 10000,
    }).pipe(
      map((items) => this.buildTicketReportsResponse(items, request, page, pageSize)),
      catchError((error) => {
        console.error('Error fetching ticket reports:', error);
        return of({
          success: false,
          data: [],
          totalCount: 0,
          page,
          pageSize,
          message: 'Failed to load ticket reports.',
        });
      }),
    );
  }

  private buildTicketReportsResponse(
    items: any[],
    request: TicketReportRequest,
    page: number,
    pageSize: number,
  ): TicketReportResponse {
    const normalizedProjectId = this.toPositiveNumber(request.projectId);
    const normalizedInspectorId = this.toPositiveNumber(request.inspectorId);
    const targetDate = request.reportType === 'daily'
      ? this.normalizeDateText(request.date)
      : null;
    const targetStartDate = request.reportType === 'weekly'
      ? this.normalizeDateText(request.startDate)
      : null;
    const targetEndDate = request.reportType === 'weekly'
      ? (this.normalizeDateText(request.endDate) ?? targetStartDate)
      : null;
    const normalizedSearchTerm = String(request.searchTerm ?? '').trim().toLowerCase();

    const filteredItems = this.normalizeTicketReports(items).filter((ticket) => {
      if (normalizedProjectId && ticket.projectId !== normalizedProjectId) {
        return false;
      }

      if (normalizedInspectorId && !this.ticketMatchesInspector(ticket, normalizedInspectorId)) {
        return false;
      }

      const ticketDay = this.extractDateKey(ticket.createdDate);
      if (targetDate && ticketDay !== targetDate) {
        return false;
      }

      if ((targetStartDate || targetEndDate) && !ticketDay) {
        return false;
      }

      if (targetStartDate && ticketDay && ticketDay < targetStartDate) {
        return false;
      }

      if (targetEndDate && ticketDay && ticketDay > targetEndDate) {
        return false;
      }

      if (!normalizedSearchTerm) {
        return true;
      }

      return [
        ticket.ticketNumber,
        ticket.clientName,
        ticket.projectName,
        ticket.vehicleIdentifier,
        ticket.defectType,
        ticket.description,
        ticket.assignedByName,
        ticket.assignedToName,
        ticket.stationName,
        ticket.status,
      ].some((value) => String(value ?? '').toLowerCase().includes(normalizedSearchTerm));
    });

    const totalCount = filteredItems.length;
    const startIndex = (page - 1) * pageSize;
    const data = filteredItems.slice(startIndex, startIndex + pageSize);

    return {
      success: true,
      data,
      totalCount,
      page,
      pageSize,
    };
  }

  private normalizeTicketReports(items: any[]): TicketReport[] {
    return (items ?? [])
      .map((item) => {
        const projectId = this.toPositiveNumber(this.first(item, ['projectId', 'ProjectId', 'projectID', 'project_id'])) ?? 0;
        const clientId = this.toPositiveNumber(this.first(item, ['clientId', 'ClientId', 'client_id'])) ??
          this.projectClientIdByProjectId.get(projectId) ??
          this.resolveRequestClientId(undefined) ??
          0;
        const stationName = this.toText(this.first(item, ['stationName', 'station', 'defectLocationName', 'defectLocation']), '-');

        return {
          id: this.toPositiveNumber(this.first(item, ['id', 'ticketId', 'ticketID'])) ?? 0,
          ticketNumber: this.toText(this.first(item, ['ticketNumber', 'ticketNo', 'uniqueId', 'id']), '-'),
          clientId,
          clientName: this.toText(this.first(item, ['clientName', 'clientNameText', 'client.name', 'customerName', 'client']), clientId > 0 ? `Client ${clientId}` : '-'),
          projectId,
          projectName: this.toText(
            this.first(item, ['projectName', 'ProjectName', 'project.name', 'project.title', 'project']),
            this.projectNameById.get(projectId) ?? (projectId > 0 ? `Project ${projectId}` : '-'),
          ),
          vehicleId: this.toPositiveNumber(this.first(item, ['vehicleId', 'VehicleId', 'assetId', 'AssetId'])) ?? 0,
          vehicleIdentifier: this.toText(
            this.first(item, ['vehicleIdentifier', 'fleetNumber', 'vehicleName', 'VehicleName', 'vehicle.name', 'vehicle']),
            '-',
          ),
          safetyCritical: Boolean(this.first(item, ['safetyCritical', 'isSafetyCritical']) ?? false),
          createdDate: this.toText(this.first(item, ['createdDate', 'createdAt', 'ticketCreatedDate', 'CreatedAt']), ''),
          defectType: this.toText(this.first(item, ['defectType', 'defectTypeName', 'defactTypeName', 'type']), '-'),
          defectLocation: stationName,
          description: this.toText(this.first(item, ['description', 'ticketDescription', 'ticketdescription']), '-'),
          hasImages: Boolean(
            this.first(item, ['hasImages']) ??
            (
              ((Number(this.first(item, ['imageCount']) ?? 0) || 0) > 0) ||
              (Array.isArray(item?.images) && item.images.length > 0)
            )
          ),
          imageCount: this.toPositiveNumber(this.first(item, ['imageCount'])),
          assignedById: this.toPositiveNumber(this.first(item, ['assignedById', 'ticketAssignedBy', 'assignedByUserId'])) ?? 0,
          assignedByName: this.toText(this.first(item, ['assignedByName', 'assignByName', 'createdByName']), '-'),
          assignedToId: this.toPositiveNumber(this.first(item, ['assignedToId', 'assignedToUserId', 'userId', 'inspectorId'])) ?? 0,
          assignedToName: this.toText(this.first(item, ['assignedToName', 'assignToName', 'inspectorName', 'userName']), '-'),
          stationId: this.toPositiveNumber(this.first(item, ['stationId', 'defectLocationId'])),
          stationName,
          status: this.toText(this.first(item, ['status', 'statusName', 'statusTicketName', 'ticketStatus']), 'Open'),
          resolvedDate: this.toOptionalDateText(this.first(item, ['resolvedDate', 'resolvedAt', 'closedAt', 'completedAt'])),
        };
      })
      .sort((left, right) => {
        const leftTime = Date.parse(left.createdDate ?? '');
        const rightTime = Date.parse(right.createdDate ?? '');
        if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && rightTime !== leftTime) {
          return rightTime - leftTime;
        }

        return String(right.ticketNumber ?? '').localeCompare(String(left.ticketNumber ?? ''));
      });
  }

  private ticketMatchesInspector(ticket: TicketReport, inspectorId: number): boolean {
    return ticket.assignedToId === inspectorId || ticket.assignedById === inspectorId;
  }

  private extractDateKey(value: string | undefined): string | null {
    const text = String(value ?? '').trim();
    const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1];
    }

    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) {
      return null;
    }

    return new Date(parsed).toISOString().slice(0, 10);
  }

  private normalizeDateText(value: any): string | null {
    const text = String(value ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }

  private toOptionalDateText(value: any): string | undefined {
    const text = String(value ?? '').trim();
    return text || undefined;
  }

  private resolveRequestClientId(explicitClientId?: string): number | undefined {
    const requestedClientId = this.toPositiveNumber(explicitClientId);
    if (requestedClientId) {
      return requestedClientId;
    }

    if (this.authService.hasRole(['admin', 'superadmin'])) {
      return undefined;
    }

    return this.toPositiveNumber(this.authService.currentUserValue?.clientId);
  }

  /**
   * Fetch list of projects for filter dropdown
   * TODO: Replace with actual HttpClient call
   */
  getProjects(): Observable<Project[]> {
    return this.http.get<any>(`${this.apiBaseUrl}/Projects?pageSize=10000&page=1&includeClosed=true`).pipe(
      map((response: any) => {
        console.log('[ReportService] /api/Projects raw response:', response);
        const items = this.extractItems(response);
        this.projectNameById.clear();
        this.projectClientIdByProjectId.clear();
        const mapped = items
          .map((item: any) => {
            const id = Number(item.id ?? 0);
            if (id <= 0) return null;
            const name = String(item.name ?? '').trim();
            if (!name) return null;
            const clientId = item.clientId ? Number(item.clientId) : undefined;
            if (clientId) this.projectClientIdByProjectId.set(id, clientId);
            this.projectNameById.set(id, name);
            return { id, name, code: name, clientId } as Project;
          })
          .filter((p): p is Project => p !== null);
        return mapped;
      }),
      catchError(() => of([])),
    );
  }

  /**
   * Fetch inspector assets data for filter dropdowns (combines projects, inspectors, clients, vehicles)
   */
  getInspectorAssetsForFilters(): Observable<InspectorAssetsResponse> {
    return this.http.get<InspectorAssetsResponse>(`${this.apiBaseUrl}/reports/inspector-assets`).pipe(
      map((response: InspectorAssetsResponse) => {
        console.log('[ReportService] /api/reports/inspector-assets response:', response);
        return response;
      }),
      catchError((error) => {
        console.error('[ReportService] Error fetching inspector assets:', error);
        return of({
          items: [],
          total: 0,
          page: 1,
          pageSize: 0
        });
      })
    );
  }

  // TODO: remove when real API is connected
  private readonly DEMO_INSPECTORS: Inspector[] = [
    { id: 1, name: 'Jordan Carter', email: 'jordan.carter@buspulse.com' },
    { id: 2, name: 'Anika Singh', email: 'anika.singh@buspulse.com' },
    { id: 3, name: 'Mei Chen', email: 'mei.chen@buspulse.com' },
    { id: 4, name: 'Diego Alvarez', email: 'diego.alvarez@buspulse.com' },
    { id: 5, name: 'Lena Okafor', email: 'lena.okafor@buspulse.com' },
    { id: 6, name: 'Sanjay Patel', email: 'sanjay.patel@buspulse.com' },
  ];

  /**
   * Fetch list of inspectors for filter dropdown
   */
  getInspectors(): Observable<Inspector[]> {
    const scopedClientId = this.resolveRequestClientId(undefined);

    return this.userManagementService.getUsers({
      page: 1,
      pageSize: 10000,
      role: 'Inspector',
      clientId: scopedClientId ? String(scopedClientId) : '0',
      manufacturerId: '0',
      sortBy: 'name',
      sortDirection: 'asc',
    }).pipe(
      map((result) => {
        const items = (result.items ?? [])
          .map((item) => ({
            id: this.toPositiveNumber(this.first(item, ['id', 'inspectorId', 'userId'])) ?? 0,
            name: this.toText(this.first(item, ['name', 'userName', 'username', 'inspectorName', 'fullName']), ''),
            email: this.toText(this.first(item, ['email', 'emailAddress']), ''),
          }))
          .filter((inspector: Inspector) => inspector.id > 0 && inspector.name.length > 0)
          .sort((left, right) => left.name.localeCompare(right.name));

        return items.length > 0 ? items : this.DEMO_INSPECTORS;
      }),
      catchError(() => of(this.DEMO_INSPECTORS)),
    );
  }

  /**
   * Fetch list of clients for filter dropdown
   * Response: { items: [{ id, clientName, ... }], total, page, pageSize }
   */
  getClients(): Observable<Client[]> {
    return this.http.get<any>(`${this.apiBaseUrl}/Clients`).pipe(
      map((response) => {
        const items = this.extractItems(response)
          .map((item: any) => ({
            id: this.toPositiveNumber(this.first(item, ['id'])) ?? 0,
            name: this.toText(this.first(item, ['clientName', 'name']), ''),
          }))
          .filter((client: Client) => client.id > 0 && client.name.length > 0);
        return items;
      }),
      catchError(() => of([])),
    );
  }

  /**
   * Fetch list of vehicles for filter dropdown
   * Response: { items: [{ id, fleetNumber, clientId, lastUpdate }], total, page, pageSize }
   */
  getVehicles(clientId?: number, projectId?: number): Observable<Vehicle[]> {
    const parts: string[] = [];
    if (clientId) parts.push(`clientId=${clientId}`);
    if (projectId) parts.push(`projectId=${projectId}`);
    const params = parts.length ? `?${parts.join('&')}` : '';
    return this.http.get<any>(`${this.apiBaseUrl}/Vehicles${params}`).pipe(
      map((response) => {
        return this.extractItems(response)
          .map((item: any) => ({
            id: this.toPositiveNumber(this.first(item, ['id'])) ?? 0,
            fleetNumber: this.toText(this.first(item, ['fleetNumber']), ''),
            clientId: this.toPositiveNumber(this.first(item, ['clientId'])) ?? 0,
          }))
          .filter((v: Vehicle) => v.id > 0 && v.fleetNumber.length > 0);
      }),
      catchError(() => of([])),
    );
  }

  /**
   * Fetch time logs for Vehicle Hour Report
   * Response: { items: [{ id, vehicleId, userId, projectId, typeOfTimeId, timeSpent, description, dateStarted, dateUpdated }], total, page, pageSize }
   */
  getTimeLogs(params?: { projectId?: number; vehicleId?: number }): Observable<TimeLog[]> {
    const parts: string[] = ['pageSize=10000', 'page=1'];
    if (params?.projectId) parts.push(`projectId=${params.projectId}`);
    if (params?.vehicleId) parts.push(`vehicleId=${params.vehicleId}`);
    const query = `?${parts.join('&')}`;
    return this.http.get<any>(`${this.apiBaseUrl}/TimeLogs${query}`).pipe(
      map((response) =>
        this.extractItems(response)
          .map((item: any) => ({
            id: Number(item.id ?? 0),
            vehicleId: Number(item.vehicleId ?? 0),
            userId: Number(item.userId ?? 0),
            projectId: Number(item.projectId ?? 0),
            typeOfTimeId: Number(item.typeOfTimeId ?? 0),
            timeSpent: Number(item.timeSpent ?? 0),
            description: String(item.description ?? ''),
            dateStarted: String(item.dateStarted ?? ''),
            dateUpdated: String(item.dateUpdated ?? ''),
          }))
          .filter((log: TimeLog) => log.vehicleId > 0),
      ),
      catchError(() => of([])),
    );
  }

  /**
   * Fetch labour report rows
   * Response: { items: [{ date, dateText, hours, inspectorId, inspector, projectId, project, vehicleId, vehicle, typeOfTimeId, typeOfTime, description }], total, page, pageSize }
   */
  getLabourReport(params?: { projectId?: number; inspectorId?: number; startDate?: string; endDate?: string }): Observable<LabourReportItem[]> {
    const cacheKey = JSON.stringify({
      projectId: params?.projectId ?? null,
      inspectorId: params?.inspectorId ?? null,
      startDate: params?.startDate ?? null,
      endDate: params?.endDate ?? null,
    });
    const cached = this.labourReportCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pageSize = Math.max(10000, Number(environment.apiPagedFetchPageSize ?? 10000) || 10000);
    const maxPages = Math.max(1, Number(environment.apiPagedFetchMaxPages ?? 200) || 200);
    const mapItems = (items: any[]) =>
      items.map((item: any) => ({
        date: String(item.date ?? ''),
        dateText: String(item.dateText ?? ''),
        hours: Number(item.hours ?? 0),
        clientId: Number(item.clientId ?? item.customerId ?? 0),
        client: String(item.client ?? item.customer ?? item.clientName ?? ''),
        inspectorId: Number(item.inspectorId ?? 0),
        inspector: String(item.inspector ?? ''),
        projectId: Number(item.projectId ?? 0),
        project: String(item.project ?? ''),
        vehicleId: Number(item.vehicleId ?? 0),
        vehicle: String(item.vehicle ?? ''),
        typeOfTimeId: Number(item.typeOfTimeId ?? 0),
        typeOfTime: String(item.typeOfTime ?? ''),
        description: String(item.description ?? ''),
      }));
    const request$ = fetchAllPages<any>(
      (page, resolvedPageSize) => {
        const parts: string[] = [`pageSize=${resolvedPageSize}`, `page=${page}`];
        if (params?.projectId) parts.push(`projectId=${params.projectId}`);
        if (params?.inspectorId) parts.push(`inspectorId=${params.inspectorId}`);
        if (params?.startDate) parts.push(`startDate=${params.startDate}`);
        if (params?.endDate) parts.push(`endDate=${params.endDate}`);
        const query = `?${parts.join('&')}`;
        return this.http.get<any>(`${this.apiBaseUrl}/reports/labour${query}`);
      },
      {
        pageSize,
        maxPages,
        startPage: 1,
      },
    ).pipe(
      map((response) =>
        mapItems(this.extractItems(response))
      ),
      catchError(() => of([])),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.labourReportCache.set(cacheKey, request$);
    return request$;
  }

  /**
   * Fetch inspector active asset rows
   * Response: { items: [{ clientId, client, projectId, project, inspectorId, inspector, vehicleId, vehicle, ticketsOpen, ticketsClosed }], total, page, pageSize }
   */
  getInspectorAssets(params?: { projectId?: number; inspectorId?: number }): Observable<any[]> {
    const parts: string[] = ['PageNumber=1', 'PageSize=10000'];
    if (params?.projectId) parts.push(`ProjectId=${params.projectId}`);
    if (params?.inspectorId) parts.push(`InspectorId=${params.inspectorId}`);
    const query = `?${parts.join('&')}`;
    return this.http.get<any>(`${this.apiBaseUrl}/reports/inspector-assets${query}`).pipe(
      map((response) => {
        console.log('[ReportService] /api/reports/inspector-assets response:', response);
        return this.extractItems(response);
      }),
      catchError((error) => {
        console.error('[ReportService] /api/reports/inspector-assets error:', error);
        return of([]);
      }),
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
