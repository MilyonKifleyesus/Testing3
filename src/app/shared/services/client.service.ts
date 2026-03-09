import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay, switchMap, throwError, timeout } from 'rxjs';
import { Client } from '../models/client.model';
import { environment } from '../../../environments/environment';
import { adaptApiClient, ApiClientLike } from './adapters/client.adapter';
import { fetchAllPages } from './adapters/pagination-fetch.util';
import { parsePagedResponse } from './adapters/paged-response.adapter';
import { normalizeEntityLocations } from './adapters/location.adapter';
import {
  LogoPayloadMode,
  isDataUrlBase64,
  prepareLogoForMode,
  shouldRetryWithRawBase64,
} from './adapters/logo-payload.adapter';

type ClientEnvironmentConfig = typeof environment & {
  useClientJson?: boolean;
  apiBaseUrl?: string;
  useApiV2?: boolean;
  apiPagedFetchPageSize?: number;
  apiPagedFetchMaxPages?: number;
  logoPayloadMode?: LogoPayloadMode;
};

interface UpdateClientPayload {
  customerName: string;
  customerLogo: string | null;
  customerLogoName: string | null;
  locationIds: number[];
}

interface ExistingClientForUpdate {
  customerName: string;
  customerLogo: string | null;
  customerLogoName: string | null;
  locationIds: number[];
}

/**
 * Input used by map/data-management flows.
 * Strict API payload is derived from this and never includes legacy fields.
 */
export interface UpdateClientRequest {
  name?: string;
  customerName?: string;
  customerLogo?: string | null;
  customerLogoName?: string | null;
  locationIds?: number[];
  // Legacy inputs still accepted by callers; ignored for client write payloads.
  latitude?: number;
  longitude?: number;
}

export interface CreateClientRequest {
  customerName: string;
  customerLogo?: string | null;
  customerLogoName?: string | null;
  locationIds: number[];
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLocationIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<number>();
  for (const item of value) {
    const parsed = parseNullableNumber(item);
    if (parsed != null) deduped.add(parsed);
  }
  return Array.from(deduped.values());
}

function normalizeClientArray(raw: unknown): ApiClientLike[] {
  return parsePagedResponse<ApiClientLike>(raw).items;
}

function mapSingleClientResponse(raw: unknown): Client | null {
  if (Array.isArray(raw)) {
    const first = raw[0] as ApiClientLike | undefined;
    return first ? adaptApiClient(first) : null;
  }

  const record = asRecord(raw);
  if (!record) return null;

  const wrapped =
    record['item'] ??
    record['client'] ??
    (Array.isArray(record['items']) ? record['items'][0] : null) ??
    raw;

  const mapped = adaptApiClient(wrapped as ApiClientLike);
  return mapped ?? null;
}

function extractClientId(raw: unknown): string | null {
  const record = asRecord(raw);
  if (!record) return null;
  const candidate =
    record['id'] ??
    record['clientId'] ??
    asRecord(record['item'])?.['id'] ??
    asRecord(record['item'])?.['clientId'] ??
    asRecord(record['client'])?.['id'] ??
    asRecord(record['client'])?.['clientId'];
  if (candidate == null || candidate === '') return null;
  return String(candidate);
}

function mapExistingClientForUpdate(raw: unknown): ExistingClientForUpdate | null {
  const record = asRecord(raw);
  if (!record) return null;

  const source =
    asRecord(record['item']) ??
    asRecord(record['client']) ??
    (Array.isArray(record['items']) ? asRecord(record['items'][0]) : null) ??
    record;

  if (!source) return null;

  const name =
    String(
      source['customerName'] ??
      source['clientName'] ??
      source['name'] ??
      ''
    ).trim();

  const geoLocations = normalizeEntityLocations(source['locations']);
  const locationIdsFromLocations = geoLocations.map((location) => location.id);
  const fallbackLocationId = parseNullableNumber(source['locationId']);
  const locationIds = locationIdsFromLocations.length > 0
    ? locationIdsFromLocations
    : (fallbackLocationId != null ? [fallbackLocationId] : []);

  return {
    customerName: name,
    customerLogo: typeof source['customerLogo'] === 'string' ? (source['customerLogo'] as string) : null,
    customerLogoName: typeof source['customerLogoName'] === 'string' ? (source['customerLogoName'] as string) : null,
    locationIds,
  };
}

@Injectable({
  providedIn: 'root',
})
export class ClientService {
  private readonly envConfig = environment as ClientEnvironmentConfig;
  private readonly apiBaseUrl: string;
  private readonly useApiV2: boolean;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly logoPayloadMode: LogoPayloadMode;

  private clientsCache$: Observable<Client[]> | null = null;
  private clientsCacheExpiresAt = 0;
  private clientsCooldownUntil = 0;
  private lastClientsWarnAt = 0;

  constructor(private http: HttpClient) {
    const configured = this.envConfig.apiBaseUrl?.trim();
    if (!configured) {
      throw new Error('Missing required envConfig.apiBaseUrl');
    }
    this.apiBaseUrl = configured.replace(/\/+$/, '');
    this.useApiV2 = this.envConfig.useApiV2 !== false;
    this.pageSize = Math.max(1, Number(this.envConfig.apiPagedFetchPageSize ?? 500));
    this.maxPages = Math.max(1, Number(this.envConfig.apiPagedFetchMaxPages ?? 200));
    this.logoPayloadMode = this.resolveLogoPayloadMode(this.envConfig.logoPayloadMode);
  }

  private resolveLogoPayloadMode(mode: unknown): LogoPayloadMode {
    if (mode === 'rawBase64' || mode === 'dataUrl' || mode === 'autoRetryRawBase64') {
      return mode;
    }
    return 'autoRetryRawBase64';
  }

  private warnClientsApiOncePer(intervalMs: number, err: unknown): void {
    const now = Date.now();
    if (now - this.lastClientsWarnAt < intervalMs) return;
    this.lastClientsWarnAt = now;
    console.warn('Clients API failed:', err);
  }

  private getClientsApiUrl(): string {
    return `${this.apiBaseUrl}/Clients`;
  }

  private mapClientsResponse(raw: unknown): Client[] {
    return normalizeClientArray(raw)
      .map((api) => adaptApiClient(api))
      .filter((client): client is Client => !!client && client.id !== '');
  }

  private clientsListRequest$(): Observable<unknown> {
    if (!this.useApiV2) {
      return this.http.get<unknown>(this.getClientsApiUrl());
    }

    return fetchAllPages<ApiClientLike>(
      (page, pageSize) => {
        const params = new HttpParams()
          .set('page', String(page))
          .set('pageSize', String(pageSize));
        return this.http.get<unknown>(this.getClientsApiUrl(), { params });
      },
      {
        pageSize: this.pageSize,
        maxPages: this.maxPages,
        startPage: 1,
      }
    ).pipe(map((result) => result.items));
  }

  getClients(): Observable<Client[]> {
    const now = Date.now();
    if (this.clientsCache$ && now < this.clientsCacheExpiresAt) return this.clientsCache$;
    if (now < this.clientsCooldownUntil) return of([]);

    const request$ = this.clientsListRequest$().pipe(
      timeout(10000),
      map((raw) => this.mapClientsResponse(raw)),
      catchError((err) => {
        this.warnClientsApiOncePer(60_000, err);
        this.clientsCooldownUntil = Date.now() + 60_000;
        this.clientsCacheExpiresAt = Date.now() + 30_000;
        return of([] as Client[]);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.clientsCache$ = request$;
    this.clientsCacheExpiresAt = now + 5 * 60_000;
    return request$;
  }

  getClientById(id: string): Observable<Client | null> {
    return this.http.get<unknown>(`${this.getClientsApiUrl()}/${id}`).pipe(
      timeout(10000),
      map((raw) => {
        const mapped = mapSingleClientResponse(raw);
        return mapped && mapped.id !== '' ? mapped : null;
      }),
      catchError(() =>
        this.getClients().pipe(
          map((clients) => clients.find((client) => client.id === id) ?? null),
          catchError(() => of(null))
        )
      )
    );
  }

  private getExistingClientForUpdate(clientId: string): Observable<ExistingClientForUpdate | null> {
    return this.http.get<unknown>(`${this.getClientsApiUrl()}/${clientId}`).pipe(
      timeout(10000),
      map((raw) => mapExistingClientForUpdate(raw)),
      catchError(() =>
        this.getClientById(clientId).pipe(
          map((client) => {
            if (!client) return null;
            const locationIds = parseLocationIds(client.locationIds);
            const fallbackLocationId = parseNullableNumber(client.locationId);
            if (locationIds.length === 0 && fallbackLocationId != null) {
              locationIds.push(fallbackLocationId);
            }
            return {
              customerName: client.name,
              customerLogo: client.logoUrl ?? null,
              customerLogoName: null,
              locationIds,
            } satisfies ExistingClientForUpdate;
          }),
          catchError(() => of(null))
        )
      )
    );
  }

  private buildClientUpdatePayload(
    clientId: string,
    updates: UpdateClientRequest,
    existing: ExistingClientForUpdate | null
  ): UpdateClientPayload {
    const hasRequestedLocationIds = Object.prototype.hasOwnProperty.call(updates, 'locationIds');
    const requestedLocationIds = parseLocationIds(updates.locationIds);
    const existingLocationIds = existing?.locationIds ?? [];

    const customerName =
      String(
        updates.customerName ??
        updates.name ??
        existing?.customerName ??
        clientId
      ).trim() || clientId;

    return {
      customerName,
      customerLogo: updates.customerLogo ?? existing?.customerLogo ?? null,
      customerLogoName: updates.customerLogoName ?? existing?.customerLogoName ?? null,
      locationIds: hasRequestedLocationIds ? requestedLocationIds : existingLocationIds,
    };
  }

  private applyLogoPayloadMode(payload: UpdateClientPayload, mode: LogoPayloadMode): UpdateClientPayload {
    return {
      ...payload,
      customerLogo: prepareLogoForMode(payload.customerLogo, mode),
    };
  }

  updateClient(id: string | number, body: UpdateClientRequest): Observable<Client> {
    const clientId = String(id);
    return this.getExistingClientForUpdate(clientId).pipe(
      map((existing) => this.buildClientUpdatePayload(clientId, body, existing)),
      switchMap((payload) => {
        const endpoint = `${this.getClientsApiUrl()}/${clientId}`;
        const primaryPayload = this.applyLogoPayloadMode(payload, this.logoPayloadMode);
        return this.http.put<unknown>(endpoint, primaryPayload).pipe(
          timeout(10000),
          catchError((err) => {
            const shouldRetry =
              this.logoPayloadMode === 'autoRetryRawBase64' &&
              isDataUrlBase64(payload.customerLogo) &&
              shouldRetryWithRawBase64(err);
            if (!shouldRetry) return throwError(() => err);
            const fallbackPayload = this.applyLogoPayloadMode(payload, 'rawBase64');
            return this.http.put<unknown>(endpoint, fallbackPayload).pipe(timeout(10000));
          })
        );
      }),
      switchMap(() => this.getClientById(clientId)),
      map((client) => {
        if (!client) {
          throw new Error(`Client ${clientId} not found after update.`);
        }
        this.clientsCache$ = null;
        this.clientsCacheExpiresAt = 0;
        return client;
      }),
      catchError((err) => {
        console.error(`Failed to update client id=${clientId}:`, err);
        return throwError(() => err);
      })
    );
  }

  createClient(body: CreateClientRequest): Observable<Client> {
    const payload: UpdateClientPayload = {
      customerName: String(body.customerName ?? '').trim(),
      customerLogo: body.customerLogo ?? null,
      customerLogoName: body.customerLogoName ?? null,
      locationIds: parseLocationIds(body.locationIds),
    };

    if (!payload.customerName) {
      return throwError(() => new Error('Client name is required.'));
    }

    const endpoint = this.getClientsApiUrl();
    const primaryPayload = this.applyLogoPayloadMode(payload, this.logoPayloadMode);

    return this.http.post<unknown>(endpoint, primaryPayload).pipe(
      timeout(10000),
      catchError((err) => {
        const shouldRetry =
          this.logoPayloadMode === 'autoRetryRawBase64' &&
          isDataUrlBase64(payload.customerLogo) &&
          shouldRetryWithRawBase64(err);
        if (!shouldRetry) return throwError(() => err);
        const fallbackPayload = this.applyLogoPayloadMode(payload, 'rawBase64');
        return this.http.post<unknown>(endpoint, fallbackPayload).pipe(timeout(10000));
      }),
      switchMap((created) => {
        this.clientsCache$ = null;
        this.clientsCacheExpiresAt = 0;

        const mapped = mapSingleClientResponse(created);
        if (mapped) return of(mapped);

        const createdId = extractClientId(created);
        if (createdId) {
          return this.getClientById(createdId).pipe(
            map((client) => {
              if (!client) {
                throw new Error(`Client ${createdId} not found after create.`);
              }
              return client;
            })
          );
        }

        return this.getClients().pipe(
          map((clients) => {
            const match = clients.find((client) => client.name.trim() === payload.customerName);
            if (!match) {
              throw new Error('Client create succeeded but response could not be mapped.');
            }
            return match;
          })
        );
      }),
      catchError((err) => {
        console.error('Failed to create client:', err);
        return throwError(() => err);
      })
    );
  }
}
