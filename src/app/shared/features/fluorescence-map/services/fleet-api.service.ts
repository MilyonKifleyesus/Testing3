import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { environment } from '../../../../../environments/environment';

export interface FleetApiError {
  status: number;
  message: string;
  endpoint: string;
}

type ApiEnvelope<T> = T | { items?: T };
type FleetEnvironmentConfig = typeof environment & { apiBaseUrl?: string };

@Injectable({ providedIn: 'root' })
export class FleetApiService {
  private readonly envConfig = environment as FleetEnvironmentConfig;
  private readonly baseUrl = this.envConfig.apiBaseUrl?.trim() ?? '';
  private readonly requestTimeoutMs = 10000;

  constructor(private readonly http: HttpClient) {}

  getProjects(includeClosed = true): Observable<unknown> {
    const params = new HttpParams().set('includeClosed', String(includeClosed));
    return this.get('/Projects', params);
  }

  updateProject(projectId: string, body: unknown): Observable<unknown> {
    return this.put(`/Projects/${projectId}`, body);
  }

  getClients(): Observable<unknown> {
    return this.get('/Clients');
  }

  updateClient(clientId: string, body: unknown): Observable<unknown> {
    return this.put(`/Clients/${clientId}`, body);
  }

  getLocations(): Observable<unknown> {
    return this.get('/Locations');
  }

  updateLocation(locationId: string, body: unknown): Observable<unknown> {
    return this.put(`/Locations/${locationId}`, body);
  }

  getManufacturers(): Observable<unknown> {
    return this.get('/Manufacturers');
  }

  updateManufacturer(manufacturerId: string, body: unknown): Observable<unknown> {
    return this.put(`/Manufacturers/${manufacturerId}`, body);
  }

  getVehicles(): Observable<unknown> {
    return this.get('/Vehicles');
  }

  getProjectTypesOptional(): Observable<unknown> {
    return this.get('/ProjectTypes');
  }

  getMapStatsOptional(): Observable<unknown> {
    return this.get('/Dashboard/MapStats');
  }

  private get<T>(path: string, params?: HttpParams): Observable<ApiEnvelope<T>> {
    return this.http
      .get<ApiEnvelope<T>>(`${this.baseUrl}${path}`, { params })
      .pipe(timeout(this.requestTimeoutMs), catchError((error) => this.handleError(path, error)));
  }

  private put<T>(path: string, body: unknown): Observable<ApiEnvelope<T>> {
    return this.http
      .put<ApiEnvelope<T>>(`${this.baseUrl}${path}`, body)
      .pipe(timeout(this.requestTimeoutMs), catchError((error) => this.handleError(path, error)));
  }

  private handleError(endpoint: string, error: unknown): Observable<never> {
    if (error instanceof HttpErrorResponse) {
      const apiError: FleetApiError = {
        status: error.status,
        message: error.message || 'API request failed',
        endpoint,
      };
      return throwError(() => apiError);
    }
    return throwError(() => ({
      status: 0,
      message: String(error),
      endpoint,
    } satisfies FleetApiError));
  }
}
