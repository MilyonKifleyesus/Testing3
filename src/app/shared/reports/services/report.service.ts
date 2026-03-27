import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, catchError } from 'rxjs/operators';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import { Observable, of, delay } from 'rxjs';
import { environment } from '../../../../environments/environment';

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
  private projectNameById = new Map<number, string>();
  private projectClientIdByProjectId = new Map<number, number>();

  constructor(
    private readonly http: HttpClient,
    private readonly clientDashboardService: ClientDashboardService,
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
    return this.http.get<any>(`${this.apiBaseUrl}/Inspectors`).pipe(
      map((response) => {
        const items = this.extractItems(response)
          .map((item: any) => ({
            id: this.toPositiveNumber(this.first(item, ['id', 'inspectorId', 'userId'])) ?? 0,
            name: this.toText(this.first(item, ['name', 'inspectorName', 'fullName']), ''),
            email: this.toText(this.first(item, ['email', 'emailAddress']), ''),
          }))
          .filter((inspector: Inspector) => inspector.id > 0 && inspector.name.length > 0);
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
    const parts: string[] = ['pageSize=10000', 'page=1'];
    if (params?.projectId) parts.push(`projectId=${params.projectId}`);
    if (params?.inspectorId) parts.push(`inspectorId=${params.inspectorId}`);
    if (params?.startDate) parts.push(`startDate=${params.startDate}`);
    if (params?.endDate) parts.push(`endDate=${params.endDate}`);
    const query = `?${parts.join('&')}`;
    return this.http.get<any>(`${this.apiBaseUrl}/reports/labour${query}`).pipe(
      map((response) =>
        this.extractItems(response).map((item: any) => ({
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
        }))
      ),
      catchError(() => of([])),
    );
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
