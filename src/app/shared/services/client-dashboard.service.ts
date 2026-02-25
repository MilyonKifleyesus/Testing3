import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ClientDashboardResponse } from '../models/client-dashboard.models';

@Injectable({ providedIn: 'root' })
export class ClientDashboardService {
  private readonly baseUrl = `${environment.apiBaseUrl}/client-dashboard`;
  private readonly apiBaseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  getClientDashboard(clientId: number): Observable<ClientDashboardResponse> {
    return this.http.get<ClientDashboardResponse>(`${this.baseUrl}/${clientId}`);
  }

  getProjects(params: { clientId?: number; includeClosed?: boolean; page?: number; pageSize?: number } = {}): Observable<any> {
    const httpParams = this.buildParams(params);
    return this.http.get<any>(`${this.apiBaseUrl}/Projects`, { params: httpParams });
  }

  getProjectVehicles(projectId: number, params: { clientId?: number; userId?: number; page?: number; pageSize?: number } = {}): Observable<any> {
    const httpParams = this.buildParams(params);
    return this.http.get<any>(`${this.apiBaseUrl}/projects/${projectId}/vehicles`, { params: httpParams });
  }

  getTickets(params: { clientId?: number; projectId?: number; userId?: number; vehicleId?: number; page?: number; pageSize?: number } = {}): Observable<any> {
    const httpParams = this.buildParams(params);
    return this.http.get<any>(`${this.apiBaseUrl}/Tickets`, { params: httpParams });
  }

  getTicketsDashboard(params: { projectId?: number; userId?: number; vehicleId?: number } = {}): Observable<any> {
    const httpParams = this.buildParams(params);
    return this.http.get<any>(`${this.apiBaseUrl}/tickets/dashboard`, { params: httpParams });
  }

  getVehicles(params: { clientId?: number; page?: number; pageSize?: number } = {}): Observable<any> {
    const httpParams = this.buildParams(params);
    return this.http.get<any>(`${this.apiBaseUrl}/Vehicles`, { params: httpParams });
  }

  private buildParams(params: Record<string, string | number | boolean | null | undefined>): HttpParams {
    let httpParams = new HttpParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        httpParams = httpParams.set(key, String(value));
      }
    });
    return httpParams;
  }
}
