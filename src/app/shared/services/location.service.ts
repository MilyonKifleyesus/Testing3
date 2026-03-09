import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, map, catchError, throwError, switchMap, timeout, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';
import { adaptApiLocation, ApiLocationLike } from './adapters/location.adapter';
import { fetchAllPages } from './adapters/pagination-fetch.util';
import { parsePagedResponse } from './adapters/paged-response.adapter';

type LocationEnvironmentConfig = typeof environment & {
  apiBaseUrl?: string;
  useApiV2?: boolean;
  apiPagedFetchPageSize?: number;
  apiPagedFetchMaxPages?: number;
};

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

export interface CreateLocationRequest {
  name: string;
  latitude: number;
  longitude: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseLocationList(raw: unknown): ApiLocation[] {
  return parsePagedResponse<ApiLocationLike>(raw).items
    .map((item) => adaptApiLocation(item))
    .filter((item): item is ApiLocation => !!item);
}

function parseSingleLocation(raw: unknown): ApiLocation | null {
  if (Array.isArray(raw)) {
    const first = raw[0] as ApiLocationLike | undefined;
    return first ? adaptApiLocation(first) : null;
  }

  const record = asRecord(raw);
  if (!record) return null;

  const wrapped =
    record['item'] ??
    record['location'] ??
    (Array.isArray(record['items']) ? record['items'][0] : null) ??
    raw;

  return adaptApiLocation(wrapped as ApiLocationLike);
}

@Injectable({
  providedIn: 'root',
})
export class LocationService {
  private readonly envConfig = environment as LocationEnvironmentConfig;
  private readonly apiBaseUrl: string;
  private readonly useApiV2: boolean;
  private readonly pageSize: number;
  private readonly maxPages: number;

  private locationsAllCache$: Observable<ApiLocation[]> | null = null;
  private locationsAllCacheExpiresAt = 0;
  private locationsFilteredCache$: Observable<ApiLocation[]> | null = null;
  private locationsFilteredCacheExpiresAt = 0;
  private locationsCooldownUntil = 0;
  private lastLocationsWarnAt = 0;

  constructor(private http: HttpClient) {
    const apiBaseUrl = this.envConfig.apiBaseUrl?.trim();
    if (!apiBaseUrl) {
      throw new Error('Missing required envConfig.apiBaseUrl');
    }
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
    this.useApiV2 = this.envConfig.useApiV2 !== false;
    this.pageSize = Math.max(1, Number(this.envConfig.apiPagedFetchPageSize ?? 500));
    this.maxPages = Math.max(1, Number(this.envConfig.apiPagedFetchMaxPages ?? 200));
  }

  private warnLocationsApiOncePer(intervalMs: number, err: unknown): void {
    const now = Date.now();
    if (now - this.lastLocationsWarnAt < intervalMs) return;
    this.lastLocationsWarnAt = now;
    console.warn('Locations API failed:', err);
  }

  private locationsRequest$(): Observable<unknown> {
    const url = `${this.apiBaseUrl}/Locations`;
    if (!this.useApiV2) {
      return this.http.get<unknown>(url);
    }

    return fetchAllPages<ApiLocationLike>(
      (page, pageSize) => {
        const params = new HttpParams()
          .set('page', String(page))
          .set('pageSize', String(pageSize));
        return this.http.get<unknown>(url, { params });
      },
      {
        pageSize: this.pageSize,
        maxPages: this.maxPages,
        startPage: 1,
      }
    ).pipe(map((result) => result.items));
  }

  getLocations(): Observable<ApiLocation[]> {
    return this.fetchLocations(false);
  }

  getAllLocations(): Observable<ApiLocation[]> {
    return this.fetchLocations(true);
  }

  private fetchLocations(includeZeroCoords: boolean): Observable<ApiLocation[]> {
    const now = Date.now();
    if (now < this.locationsCooldownUntil) {
      return throwError(() => new Error('Locations API cooldown active'));
    }

    const cache$ = includeZeroCoords ? this.locationsAllCache$ : this.locationsFilteredCache$;
    const expiresAt = includeZeroCoords ? this.locationsAllCacheExpiresAt : this.locationsFilteredCacheExpiresAt;
    if (cache$ && now < expiresAt) return cache$;

    const request$ = this.locationsRequest$().pipe(
      timeout(10000),
      map((raw) => {
        const locations = parseLocationList(raw);
        if (includeZeroCoords) return locations;
        return locations.filter((location) => !(location.latitude === 0 && location.longitude === 0));
      }),
      catchError((err) => {
        this.warnLocationsApiOncePer(60_000, err);
        this.locationsCooldownUntil = Date.now() + 30_000;
        if (includeZeroCoords) {
          this.locationsAllCache$ = null;
          this.locationsAllCacheExpiresAt = 0;
        } else {
          this.locationsFilteredCache$ = null;
          this.locationsFilteredCacheExpiresAt = 0;
        }
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    const ttlMs = 5 * 60_000;
    if (includeZeroCoords) {
      this.locationsAllCache$ = request$;
      this.locationsAllCacheExpiresAt = now + ttlMs;
    } else {
      this.locationsFilteredCache$ = request$;
      this.locationsFilteredCacheExpiresAt = now + ttlMs;
    }

    return request$;
  }

  getLocationById(id: number | string): Observable<ApiLocation | null> {
    return this.http
      .get<unknown>(`${this.apiBaseUrl}/Locations/${id}`)
      .pipe(
        map((raw) => parseSingleLocation(raw)),
        catchError((err) => {
          console.warn(`Location API lookup failed for id=${id}:`, err);
          return of(null);
        })
      );
  }

  updateLocation(id: number | string, body: UpdateLocationRequest): Observable<ApiLocation> {
    return this.http.put<unknown>(`${this.apiBaseUrl}/Locations/${id}`, body).pipe(
      timeout(10000),
      catchError((err) => {
        console.error(`Failed to update location id=${id}:`, err);
        return throwError(() => err);
      }),
      switchMap(() =>
        this.http.get<unknown>(`${this.apiBaseUrl}/Locations/${id}`).pipe(
          timeout(10000),
          map((raw) => {
            const mapped = parseSingleLocation(raw);
            if (!mapped) throw new Error(`Failed to map location ${id} after update.`);
            return mapped;
          }),
          catchError((err) => {
            console.error(`Failed to re-fetch location after update id=${id}:`, err);
            return throwError(() => err);
          })
        )
      )
    );
  }

  createLocation(body: CreateLocationRequest): Observable<ApiLocation> {
    return this.http.post<unknown>(`${this.apiBaseUrl}/Locations`, body).pipe(
      timeout(10000),
      switchMap((raw) => {
        const mapped = parseSingleLocation(raw);
        if (mapped) return of(mapped);

        const record = asRecord(raw);
        const createdId = record?.['id'] ?? asRecord(record?.['item'])?.['id'];
        if (createdId == null || createdId === '') {
          throw new Error('Location create response did not include id.');
        }

        return this.getLocationById(String(createdId)).pipe(
          map((created) => {
            if (!created) throw new Error(`Location ${String(createdId)} not found after create.`);
            return created;
          })
        );
      }),
      map((created) => {
        this.locationsAllCache$ = null;
        this.locationsAllCacheExpiresAt = 0;
        this.locationsFilteredCache$ = null;
        this.locationsFilteredCacheExpiresAt = 0;
        return created;
      }),
      catchError((err) => {
        console.error('Failed to create location:', err);
        return throwError(() => err);
      })
    );
  }
}
