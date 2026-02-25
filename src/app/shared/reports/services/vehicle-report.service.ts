import { Injectable } from '@angular/core';
import { Observable, of, map, catchError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { DashboardProjectsService } from '../../services/dashboard-projects.service';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import { ClientService } from '../../services/client.service';

// ==================== Vehicle Ticket Report Interfaces ====================

export interface VehicleTicketReportRequest {
  projectId?: number;
  projectName?: string;
  vehicleId?: number;
  vehicleNumber?: string;
  searchTerm?: string;
  page?: number;
  pageSize?: number;
}

export interface VehicleTicket {
  id: number;
  ticketNumber: string;
  clientId: number;
  clientName: string;
  projectId: number;
  projectName: string;
  vehicleId: number;
  vehicleNumber: string;
  vehicleVIN: string;
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

export interface VehicleTicketReportResponse {
  success: boolean;
  data: VehicleTicket[];
  totalCount: number;
  page: number;
  pageSize: number;
  message?: string;
}

// ==================== Vehicle Station Tracker Interfaces ====================

export interface VehicleStationTrackerRequest {
  projectId?: number;
  projectName?: string;
  searchTerm?: string;
  page?: number;
  pageSize?: number;
}

export interface StationCheckpoint {
  id: number;
  name: string;
  completedDate?: string;
}

export interface VehicleStationTracker {
  id: number;
  vehicleId: number;
  fleetNumber: string;
  vin: string;
  frameNumber: string;
  projectId: number;
  projectName: string;
  inspector?: string;
  // Main stations (shown in table columns)
  station01?: string; // Chassis Prep, AC Prep, Fire Suppression, Engine Dress
  station02?: string; // Modify Front End, Air Bags, Remove Brake Lines & Fuel Lines
  station03?: string; // Cab Cut Out, Modify Frame Kickups, Rear Axle, Bike Racks
  station04?: string; // RR Frame & Shelling, Birdcage, Ramp Support
  station05?: string; // Air Lines, Exhaust, Drive Shafts, Brake Lines, Rough Electric
  station06?: string; // Floor, Rear Wall, Roof, AC Mount, Hatches, Electrical
  station07?: string; // Floor Prep, Hoses, Electrical, Mirror Harness
  station08?: string; // Polyurea Spray
  station09?: string; // Front Cap & Seal, Ext Lights Interior, Electrical Upstairs, Prep Fiberglass
  station10?: string; // Interior Electrical, Ramps
  station11?: string; // Electrical Console, Interior Lights, Warning Buzzer, Mirrors
  // Additional checkpoints (shown when expanded)
  station12?: string; // Stanchions, Transitions, Speakers, Windows
  station13?: string; // Test, Bike Racks, Luggage Racks
  station14?: string; // Seats, Entry Door
  station15?: string; // ABS Plastics, Exterior Finish, Stanchions, Easy Stop Buttons, Fire Suppression
  station16?: string; // Underbody, Vacuum, Coolant, Headlights
  station17?: string; // Drys Box, Rub Rails, Clean & Detail
  station18?: string; // Alignment, Leak Down Test
  station19?: string; // Post Road Test Bay
  station20?: string; // Inspector Testing & PDI
  station21?: string; // Shipped to Client
  station22?: string;
  station23?: string;
  station24?: string;
  station25?: string;
  station26?: string;
  station27?: string;
  station28?: string;
  station29?: string;
  isExpanded?: boolean; // UI state for row expansion
}

export interface VehicleStationTrackerResponse {
  success: boolean;
  data: VehicleStationTracker[];
  totalCount: number;
  page: number;
  pageSize: number;
  message?: string;
}

// ==================== Vehicle Final Reports Interfaces ====================

export interface VehicleFinalReportRequest {
  clientId?: number;
  clientName?: string;
  projectId?: number;
  projectName?: string;
  searchTerm?: string;
  page?: number;
  pageSize?: number;
}

export interface VehicleFinalReport {
  id: number;
  idNumber: string;
  clientId: number;
  clientName: string;
  projectId: number;
  projectName: string;
  vehicleId: number;
  fleetNumber: string;
  vin: string;
  reportGeneratedDate: string;
  reportStatus: 'Draft' | 'Completed' | 'Approved' | 'Pending Review';
  totalDefects: number;
  criticalDefects: number;
  resolvedDefects: number;
  pendingDefects: number;
  inspectorName?: string;
  approvedBy?: string;
  approvalDate?: string;
  documentUrl?: string;
}

export interface VehicleFinalReportResponse {
  success: boolean;
  data: VehicleFinalReport[];
  totalCount: number;
  page: number;
  pageSize: number;
  message?: string;
}

// ==================== Common Interfaces ====================

export interface Vehicle {
  id: number;
  vehicleNumber: string;
  fleetNumber?: string;
  vin: string;
  projectId: number;
  projectName: string;
}

export interface Station {
  id: number;
  name: string;
  location?: string;
}

export interface Client {
  id: number;
  name: string;
  code: string;
}

@Injectable({
  providedIn: 'root'
})
export class VehicleReportService {
  private apiUrl = '/api/vehicle-reports'; // Backend API URL
  private readonly projectNameById = new Map<number, string>();
  private readonly projectClientIdByProjectId = new Map<number, number>();

  constructor(
    private readonly authService: AuthService,
    private readonly dashboardProjectsService: DashboardProjectsService,
    private readonly clientDashboardService: ClientDashboardService,
    private readonly clientService: ClientService,
    private readonly http: HttpClient,
  ) {}

  private isClientScopedRole(): boolean {
    const role = (this.authService.currentUserValue?.role ?? '').toLowerCase().trim();
    return role === 'client' || role === 'user';
  }

  private getScopedClientId(): number | undefined {
    if (!this.isClientScopedRole()) {
      return undefined;
    }

    const clientId = Number(this.authService.currentUserValue?.clientId ?? 0);
    return Number.isFinite(clientId) && clientId > 0 ? clientId : undefined;
  }

  // ==================== Vehicle Ticket Report Methods ====================

  /**
   * Fetch vehicle ticket reports from backend
   * TODO: Replace with actual HttpClient call when backend is ready
   */
  getVehicleTicketReports(request: VehicleTicketReportRequest): Observable<VehicleTicketReportResponse> {
    const scopedClientId = this.getScopedClientId();
    const page = request.page || 1;
    const pageSize = request.pageSize || 10;

    return this.clientDashboardService.getTickets({
      clientId: scopedClientId,
      projectId: request.projectId,
      vehicleId: request.vehicleId,
      page,
      pageSize,
    }).pipe(
      map((response: any) => {
        const items = this.extractItems(response);
        const mapped = items
          .map((item: any, index: number) => this.mapApiVehicleTicket(item, index))
          .filter((ticket): ticket is VehicleTicket => ticket !== null);

        const filtered = this.applyVehicleTicketFilters(mapped, request, scopedClientId);

        return {
          success: true,
          data: filtered,
          totalCount: this.extractTotalCount(response, filtered.length),
          page,
          pageSize,
          message: response?.message ?? 'Vehicle tickets fetched successfully',
        } as VehicleTicketReportResponse;
      }),
      catchError((error) => {
        console.warn('Vehicle ticket API failed.', error);
        return of({
          success: false,
          data: [],
          totalCount: 0,
          page,
          pageSize,
          message: 'Failed to fetch vehicle tickets',
        } as VehicleTicketReportResponse);
      }),
    );
  }

  private applyVehicleTicketFilters(
    tickets: VehicleTicket[],
    request: VehicleTicketReportRequest,
    scopedClientId?: number,
  ): VehicleTicket[] {
    let filtered = [...tickets];

    if (scopedClientId) {
      filtered = filtered.filter((ticket) => ticket.clientId === scopedClientId);
    }

    if (request.projectId !== undefined && request.projectId !== null) {
      filtered = filtered.filter((ticket) => ticket.projectId === request.projectId);
    }

    if (request.projectName) {
      const projectName = request.projectName.toLowerCase();
      filtered = filtered.filter((ticket) => ticket.projectName.toLowerCase() === projectName);
    }

    if (request.vehicleId !== undefined && request.vehicleId !== null) {
      filtered = filtered.filter((ticket) => ticket.vehicleId === request.vehicleId);
    }

    if (request.vehicleNumber) {
      const vehicleNumber = request.vehicleNumber.toLowerCase();
      filtered = filtered.filter((ticket) =>
        ticket.vehicleNumber.toLowerCase() === vehicleNumber ||
        String(ticket.vehicleId) === request.vehicleNumber,
      );
    }

    if (request.searchTerm) {
      const search = request.searchTerm.toLowerCase();
      filtered = filtered.filter((ticket) =>
        ticket.ticketNumber.toLowerCase().includes(search) ||
        ticket.vehicleNumber.toLowerCase().includes(search) ||
        ticket.description.toLowerCase().includes(search) ||
        ticket.defectType.toLowerCase().includes(search),
      );
    }

    return filtered;
  }

  private mapApiVehicleTicket(item: any, index: number): VehicleTicket | null {
    const id = this.toPositiveNumber(item?.id ?? item?.ticketId ?? item?.ticketID) ?? index + 1;
    const projectId = this.toPositiveNumber(this.first(item, ['projectId', 'ProjectId', 'project.id'])) ?? 0;
    const vehicleId = this.toPositiveNumber(this.first(item, ['vehicleId', 'VehicleId', 'vehicle.id'])) ?? 0;
    const ticketClientId = this.toPositiveNumber(this.first(item, ['clientId', 'ClientId', 'client.id', 'project.clientId', 'project.ClientId'])) ?? 0;
    const projectClientId = projectId > 0 ? (this.projectClientIdByProjectId.get(projectId) ?? 0) : 0;
    const clientId = projectClientId || ticketClientId;
    const explicitClientName = this.toOptionalText(
      this.first(item, ['clientName', 'ClientName', 'customerName', 'client.name', 'client.displayName', 'client']),
    );
    const fleetNumber = this.toOptionalText(
      this.first(item, ['fleetNumber', 'FleetNumber', 'vehicleFleetNumber', 'vehicle.fleetNumber', 'vehicle.fleetNo', 'vehicle.unitNumber']),
    );
    const explicitProjectName = this.toOptionalText(
      this.first(item, ['projectName', 'ProjectName', 'project.name', 'project.title', 'project']),
    );
    const projectName = explicitProjectName && !/^\d+$/.test(explicitProjectName)
      ? explicitProjectName
      : this.resolveProjectName(projectId, explicitProjectName ?? (projectId > 0 ? `Project ${projectId}` : 'N/A'));

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
      vehicleNumber: this.toText(
        vehicleId > 0
          ? String(vehicleId)
          : (fleetNumber ?? this.first(item, ['vehicleNumber', 'vehicleIdentifier', 'vehicle.vehicleNumber'])),
        vehicleId > 0 ? `Fleet ${vehicleId}` : 'N/A',
      ),
      vehicleVIN: this.toText(this.first(item, ['vehicleVIN', 'vin', 'VIN', 'vehicle.vin']), ''),
      safetyCritical: Boolean(this.first(item, ['safetyCritical', 'isSafetyCritical'])),
      createdDate: this.toText(this.first(item, ['createdDate', 'createdAt', 'date']), ''),
      defectType: this.toText(this.first(item, ['defectType', 'issueType']), '-'),
      defectLocation: this.toText(this.first(item, ['defectLocationName', 'defectLocation', 'location', 'defect.locationName']), '-'),
      description: this.toText(this.first(item, ['description', 'details', 'comment']), '-'),
      hasImages: Boolean(this.first(item, ['hasImages', 'hasAttachments', 'hasPhotos'])),
      imageCount: this.toPositiveNumber(this.first(item, ['imageCount', 'attachmentsCount'])) ?? 0,
      assignedById: this.toPositiveNumber(this.first(item, ['assignedById', 'createdById'])) ?? 0,
      assignedByName: this.toText(this.first(item, ['assignedByName', 'createdByName', 'reportedBy']), '-'),
      assignedToId: this.toPositiveNumber(this.first(item, ['assignedToId', 'ownerId'])) ?? 0,
      assignedToName: this.toText(this.first(item, ['assignedToName', 'ownerName', 'assigneeName']), '-'),
      stationId: this.toPositiveNumber(this.first(item, ['stationId', 'StationId', 'station.id', 'station.stationId'])),
      stationName: this.toText(this.first(item, [
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
      ]), ''),
      status: this.toText(this.first(item, ['statusTicketName', 'ticketStatusName', 'statusName', 'status', 'ticketStatus', 'state']), 'Pending'),
      resolvedDate: this.toOptionalText(this.first(item, ['resolvedDate', 'closedDate'])),
    };
  }

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

  private resolveProjectName(projectId: number, fallback: string): string {
    if (projectId > 0) {
      return this.projectNameById.get(projectId) ?? fallback;
    }
    return fallback;
  }

  /**
   * Fetch vehicles for dropdown filter
   * TODO: Replace with actual HttpClient call
   */
  getVehiclesByProject(projectId: number): Observable<Vehicle[]> {
    const scopedClientId = this.getScopedClientId();

    if (this.isClientScopedRole() && !scopedClientId) {
      return of([]);
    }

    return this.dashboardProjectsService.getVehicleOptionsByProject(String(projectId), {
      clientId: scopedClientId,
      includeClosed: true,
      includeAllOption: false,
      page: 1,
      pageSize: 10000,
    }).pipe(
      map((vehicles) => vehicles
        .map((vehicle) => {
          const id = Number(vehicle.id);
          const name = String(vehicle.name ?? '').trim();
          if (!Number.isFinite(id) || id <= 0 || !name) {
            return null;
          }

          return {
            id,
            vehicleNumber: name,
            fleetNumber: name,
            vin: '',
            projectId,
            projectName: '',
          } as Vehicle;
        })
        .filter((vehicle): vehicle is Vehicle => vehicle !== null),
      ),
    );
  }

  // ==================== Vehicle Station Tracker Methods ====================

  /**
   * Fetch vehicle station tracker reports from backend
   * TODO: Replace with actual HttpClient call
   */
  getVehicleStationTracker(request: VehicleStationTrackerRequest): Observable<VehicleStationTrackerResponse> {
    const page = request.page || 1;
    const pageSize = request.pageSize || 50;

    return this.http.post<any>(`${this.apiUrl}/station-tracker`, request).pipe(
      map((response) => {
        const data = this.extractItems(response)
          .map((item: any, index: number) => this.mapApiStationTracker(item, index))
          .filter((item): item is VehicleStationTracker => item !== null);

        return {
          success: true,
          data,
          totalCount: this.extractTotalCount(response, data.length),
          page,
          pageSize,
          message: response?.message ?? 'Station tracker data fetched successfully',
        } as VehicleStationTrackerResponse;
      }),
      catchError(() => of({
        success: false,
        data: [],
        totalCount: 0,
        page,
        pageSize,
        message: 'Failed to fetch station tracker data',
      } as VehicleStationTrackerResponse)),
    );
  }

  /**
   * Fetch stations for dropdown filter
   * TODO: Replace with actual HttpClient call
   */
  getStations(): Observable<Station[]> {
    return this.http.get<any>(`${this.apiUrl}/stations`).pipe(
      map((response) => this.extractItems(response)
        .map((item: any) => ({
          id: this.toPositiveNumber(this.first(item, ['id', 'stationId', 'StationId'])) ?? 0,
          name: this.toText(this.first(item, ['name', 'stationName', 'StationName']), ''),
          location: this.toOptionalText(this.first(item, ['location', 'stationLocation'])),
        }))
        .filter((station: Station) => station.id > 0 && station.name.length > 0),
      ),
      catchError(() => of([])),
    );
  }

  // ==================== Vehicle Final Reports Methods ====================

  /**
   * Fetch vehicle final reports from backend
   * TODO: Replace with actual HttpClient call
   */
  getVehicleFinalReports(request: VehicleFinalReportRequest): Observable<VehicleFinalReportResponse> {
    const scopedClientId = this.getScopedClientId();

    return this.http.post<any>(`${this.apiUrl}/final-reports`, {
      ...request,
      clientId: scopedClientId ?? request.clientId,
    }).pipe(
      map((response) => {
        const rawData = this.extractItems(response)
          .map((item: any, index: number) => this.mapApiFinalReport(item, index))
          .filter((item): item is VehicleFinalReport => item !== null);

        if (!scopedClientId) {
          return {
            success: true,
            data: rawData,
            totalCount: this.extractTotalCount(response, rawData.length),
            page: request.page || 1,
            pageSize: request.pageSize || 50,
            message: response?.message ?? 'Final reports fetched successfully',
          } as VehicleFinalReportResponse;
        }

        const filteredData = rawData.filter((item) => item.clientId === scopedClientId);
        return {
          success: true,
          data: filteredData,
          totalCount: filteredData.length,
          page: request.page || 1,
          pageSize: request.pageSize || 50,
          message: response?.message ?? 'Final reports fetched successfully',
        } as VehicleFinalReportResponse;
      }),
      catchError(() => of({
        success: false,
        data: [],
        totalCount: 0,
        page: request.page || 1,
        pageSize: request.pageSize || 50,
        message: 'Failed to fetch final reports',
      } as VehicleFinalReportResponse)),
    );
  }

  /**
   * Download vehicle health report
   * TODO: Replace with actual HttpClient call
   */
  downloadVehicleHealthReport(reportId: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/final-reports/${reportId}/download`, { responseType: 'blob' });
  }

  /**
   * Fetch clients for dropdown filter
   * TODO: Replace with actual HttpClient call
   */
  getClients(): Observable<Client[]> {
    const scopedClientId = this.getScopedClientId();

    return this.clientService.getClients().pipe(
      map((clients) => {
        const mapped = clients.map((client) => ({
          id: Number(client.id),
          name: String(client.name ?? '').trim(),
          code: String(client.code ?? '').trim(),
        })).filter((client) => Number.isFinite(client.id) && client.id > 0 && client.name.length > 0);

        return scopedClientId
          ? mapped.filter((client) => client.id === scopedClientId)
          : mapped;
      }),
      catchError(() => of([])),
    );
  }

  private mapApiStationTracker(item: any, index: number): VehicleStationTracker | null {
    const id = this.toPositiveNumber(this.first(item, ['id', 'trackerId', 'vehicleTrackerId'])) ?? index + 1;
    const vehicleId = this.toPositiveNumber(this.first(item, ['vehicleId', 'VehicleId', 'vehicle.id'])) ?? 0;
    const projectId = this.toPositiveNumber(this.first(item, ['projectId', 'ProjectId', 'project.id'])) ?? 0;

    return {
      id,
      vehicleId,
      fleetNumber: this.toText(this.first(item, ['fleetNumber', 'vehicleNumber', 'vehicle.fleetNumber', 'vehicle.vehicleNumber']), '-'),
      vin: this.toText(this.first(item, ['vin', 'VIN', 'vehicle.vin']), '-'),
      frameNumber: this.toText(this.first(item, ['frameNumber', 'vehicle.frameNumber']), '-'),
      projectId,
      projectName: this.toText(this.first(item, ['projectName', 'ProjectName', 'project.name']), this.resolveProjectName(projectId, '-')),
      inspector: this.toOptionalText(this.first(item, ['inspector', 'inspectorName', 'assignedInspector'])),
      station01: this.toOptionalText(this.first(item, ['station01', 'station1'])),
      station02: this.toOptionalText(this.first(item, ['station02', 'station2'])),
      station03: this.toOptionalText(this.first(item, ['station03', 'station3'])),
      station04: this.toOptionalText(this.first(item, ['station04', 'station4'])),
      station05: this.toOptionalText(this.first(item, ['station05', 'station5'])),
      station06: this.toOptionalText(this.first(item, ['station06', 'station6'])),
      station07: this.toOptionalText(this.first(item, ['station07', 'station7'])),
      station08: this.toOptionalText(this.first(item, ['station08', 'station8'])),
      station09: this.toOptionalText(this.first(item, ['station09', 'station9'])),
      station10: this.toOptionalText(this.first(item, ['station10'])),
      station11: this.toOptionalText(this.first(item, ['station11'])),
      station12: this.toOptionalText(this.first(item, ['station12'])),
      station13: this.toOptionalText(this.first(item, ['station13'])),
      station14: this.toOptionalText(this.first(item, ['station14'])),
      station15: this.toOptionalText(this.first(item, ['station15'])),
      station16: this.toOptionalText(this.first(item, ['station16'])),
      station17: this.toOptionalText(this.first(item, ['station17'])),
      station18: this.toOptionalText(this.first(item, ['station18'])),
      station19: this.toOptionalText(this.first(item, ['station19'])),
      station20: this.toOptionalText(this.first(item, ['station20'])),
      station21: this.toOptionalText(this.first(item, ['station21'])),
      station22: this.toOptionalText(this.first(item, ['station22'])),
      station23: this.toOptionalText(this.first(item, ['station23'])),
      station24: this.toOptionalText(this.first(item, ['station24'])),
      station25: this.toOptionalText(this.first(item, ['station25'])),
      station26: this.toOptionalText(this.first(item, ['station26'])),
      station27: this.toOptionalText(this.first(item, ['station27'])),
      station28: this.toOptionalText(this.first(item, ['station28'])),
      station29: this.toOptionalText(this.first(item, ['station29'])),
      isExpanded: false,
    };
  }

  private mapApiFinalReport(item: any, index: number): VehicleFinalReport | null {
    const id = this.toPositiveNumber(this.first(item, ['id', 'reportId'])) ?? index + 1;
    const projectId = this.toPositiveNumber(this.first(item, ['projectId', 'ProjectId', 'project.id'])) ?? 0;
    const vehicleId = this.toPositiveNumber(this.first(item, ['vehicleId', 'VehicleId', 'vehicle.id'])) ?? 0;
    const clientId = this.toPositiveNumber(this.first(item, ['clientId', 'ClientId', 'client.id'])) ?? 0;
    const statusText = this.toText(this.first(item, ['reportStatus', 'statusName', 'status']), 'Draft');
    const reportStatus = (['Draft', 'Completed', 'Approved', 'Pending Review'] as const)
      .find((value) => value.toLowerCase() === statusText.toLowerCase()) ?? 'Draft';

    return {
      id,
      idNumber: this.toText(this.first(item, ['idNumber', 'reportNumber']), String(id)),
      clientId,
      clientName: clientId > 0
        ? this.clientService.resolveClientName(clientId, this.toText(this.first(item, ['clientName', 'client.name']), '-'))
        : this.toText(this.first(item, ['clientName', 'client.name']), '-'),
      projectId,
      projectName: this.toText(this.first(item, ['projectName', 'project.name']), this.resolveProjectName(projectId, '-')),
      vehicleId,
      fleetNumber: this.toText(this.first(item, ['fleetNumber', 'vehicleNumber', 'vehicle.fleetNumber']), '-'),
      vin: this.toText(this.first(item, ['vin', 'VIN', 'vehicle.vin']), '-'),
      reportGeneratedDate: this.toText(this.first(item, ['reportGeneratedDate', 'generatedDate', 'createdDate']), ''),
      reportStatus,
      totalDefects: this.toPositiveNumber(this.first(item, ['totalDefects', 'defectCount'])) ?? 0,
      criticalDefects: this.toPositiveNumber(this.first(item, ['criticalDefects', 'criticalCount'])) ?? 0,
      resolvedDefects: this.toPositiveNumber(this.first(item, ['resolvedDefects', 'resolvedCount'])) ?? 0,
      pendingDefects: this.toPositiveNumber(this.first(item, ['pendingDefects', 'pendingCount'])) ?? 0,
      inspectorName: this.toOptionalText(this.first(item, ['inspectorName', 'inspector'])),
      approvedBy: this.toOptionalText(this.first(item, ['approvedBy', 'approverName'])),
      approvalDate: this.toOptionalText(this.first(item, ['approvalDate', 'approvedDate'])),
      documentUrl: this.toOptionalText(this.first(item, ['documentUrl', 'url', 'downloadUrl'])),
    };
  }

  /**
   * Fetch projects for dropdown filter
   * TODO: Replace with actual HttpClient call
   */
  getProjects(): Observable<any[]> {
    const scopedClientId = this.getScopedClientId();

    if (this.isClientScopedRole() && !scopedClientId) {
      return of([]);
    }

    return this.clientDashboardService.getProjects({
      clientId: scopedClientId,
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
            };
          })
          .filter((project): project is { id: number; name: string; code: string } => project !== null);

        return mapped;
      }),
      catchError(() => this.dashboardProjectsService.getProjectOptions({
        clientId: scopedClientId,
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
              };
            })
            .filter((project): project is { id: number; name: string; code: string } => project !== null);

          this.projectNameById.clear();
          this.projectClientIdByProjectId.clear();
          mapped.forEach((project) => this.projectNameById.set(project.id, project.name));

          return mapped;
        }),
      )),
    );
  }

}
