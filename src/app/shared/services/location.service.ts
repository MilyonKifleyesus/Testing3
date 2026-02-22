import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, map, catchError, throwError, switchMap, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';

type LocationEnvironmentConfig = typeof environment & {
  apiBaseUrl?: string;
};

/** API response shape for locations */
export interface ApiLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  uniqueId?: string;
  lastUpdate?: string;
}

export interface UpdateLocationRequest {
  name: string;
  latitude: number;
  longitude: number;
}

function normalizeLocationsResponse(raw: unknown): ApiLocation[] {
  if (raw && typeof raw === 'object' && 'items' in raw) {
    return (raw as { items: ApiLocation[] }).items ?? [];
  }
  if (Array.isArray(raw)) {
    return raw as ApiLocation[];
  }
  return [];
}

@Injectable({
  providedIn: 'root',
})
export class LocationService {
  private readonly envConfig = environment as LocationEnvironmentConfig;
  private readonly apiBaseUrl: string;

  constructor(private http: HttpClient) {
    const apiBaseUrl = this.envConfig.apiBaseUrl?.trim();
    if (!apiBaseUrl) {
      throw new Error('Missing required envConfig.apiBaseUrl');
    }
    this.apiBaseUrl = apiBaseUrl;
  }

  /**
   * Fetches locations from backend API for route coordinate resolution.
   * Excludes 0,0 placeholder coordinates by default.
   */
  getLocations(): Observable<ApiLocation[]> {
    return this.fetchLocations(false);
  }

  /**
   * Fetches all locations from API (including 0,0) for hierarchy building.
   * Used when building manufacturer/site hierarchy from API.
   */
  getAllLocations(): Observable<ApiLocation[]> {
    return this.fetchLocations(true);
  }

  private fetchLocations(includeZeroCoords: boolean): Observable<ApiLocation[]> {
    return this.http
      .get<unknown>(`${this.apiBaseUrl}/Locations`)
      .pipe(
        timeout(10000),
        map((raw) => {
          const locations = normalizeLocationsResponse(raw);
          if (includeZeroCoords) {
            return locations;
          }
          return locations.filter((location) => !(location.latitude === 0 && location.longitude === 0));
        })
      );
  }

  getLocationById(id: number | string): Observable<ApiLocation | null> {
    return this.http
      .get<ApiLocation>(`${this.apiBaseUrl}/Locations/${id}`)
      .pipe(
        catchError((err) => {
          console.warn(`Location API lookup failed for id=${id}:`, err);
          return of(null);
        })
      );
  }

  updateLocation(id: number | string, body: UpdateLocationRequest): Observable<ApiLocation> {
    return this.http
      .put<unknown>(`${this.apiBaseUrl}/Locations/${id}`, body)
      .pipe(
        switchMap(() => this.http.get<ApiLocation>(`${this.apiBaseUrl}/Locations/${id}`)),
        catchError((err) => {
          console.error(`Failed to update location id=${id}:`, err);
          return throwError(() => err);
        })
      );
  }
}
