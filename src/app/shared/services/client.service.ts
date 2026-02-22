import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, throwError, timeout, switchMap, of } from 'rxjs';
import { Client, ClientLocation } from '../models/client.model';
import { environment } from '../../../environments/environment';

type ClientEnvironmentConfig = typeof environment & {
  useClientJson?: boolean;
  useClientsApi?: boolean;
  apiBaseUrl?: string;
};

/** API client response shape */
export interface ApiClient {
  id?: number | string;
  clientId?: string | number;
  name?: string | null;
  clientName?: string | null;
  customerName?: string | null;
  customerLogo?: string | null;
  customerLogoName?: string | null;
  locationId?: number | string | null;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  locations?: { locationName: string; address: string; type: string }[];
}

export interface UpdateClientRequest {
  name: string;
  latitude: number;
  longitude: number;
}

/** Normalize API response to array (handles array, { clients: [...] }, or { items: [...] }) */
function normalizeApiResponse(raw: unknown): ApiClient[] {
  if (raw && typeof raw === 'object' && 'items' in raw) {
    return (raw as { items: ApiClient[] }).items ?? [];
  }
  if (raw && typeof raw === 'object' && 'clients' in raw) {
    return (raw as { clients: ApiClient[] }).clients ?? [];
  }
  if (Array.isArray(raw)) {
    return raw as ApiClient[];
  }
  return [];
}

function toObjectOrNull(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** Code derived from client name (first letters of words, or abbreviated) */
function deriveCode(name: string, id: string): string {
  const fromName = name.replace(/\s*\([^)]*\)/g, '').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);
  return fromName || id.toUpperCase();
}

/** Map API client JSON to Client model */
function mapApiClientToClient(api: ApiClient): Client {
  const id = String(api.clientId ?? api.id ?? '');
  const name = (api.customerName ?? api.clientName ?? api.name ?? '').trim() || id;
  const locations: ClientLocation[] = (api.locations ?? []).map((loc) => ({
    locationName: loc.locationName,
    address: loc.address,
    type: loc.type,
  }));
  const lat = api.latitude ?? api.lat;
  const lng = api.longitude ?? api.lng;
  const coordinates =
    lat != null && lng != null
      ? { latitude: lat, longitude: lng }
      : undefined;
  return {
    id,
    name,
    code: deriveCode(name, id),
    coordinates,
    locations: locations.length > 0 ? locations : undefined,
  };
}

function mapSingleClientResponse(raw: unknown, fallbackId: string): Client | null {
  if (Array.isArray(raw)) {
    const first = raw[0];
    return first ? mapApiClientToClient(first as ApiClient) : null;
  }
  if (raw && typeof raw === 'object') {
    if ('item' in raw && (raw as { item?: ApiClient }).item) {
      return mapApiClientToClient((raw as { item: ApiClient }).item);
    }
    if ('client' in raw && (raw as { client?: ApiClient }).client) {
      return mapApiClientToClient((raw as { client: ApiClient }).client);
    }
    return mapApiClientToClient(raw as ApiClient);
  }
  if (fallbackId) {
    return { id: fallbackId, name: fallbackId, code: fallbackId.toUpperCase() };
  }
  return null;
}

@Injectable({
  providedIn: 'root',
})
export class ClientService {
  private readonly envConfig = environment as ClientEnvironmentConfig;
  private readonly apiBaseUrl: string;

  constructor(private http: HttpClient) {
    const configured = this.envConfig.apiBaseUrl?.trim();
    if (!configured) {
      throw new Error('Missing required envConfig.apiBaseUrl');
    }
    this.apiBaseUrl = configured.replace(/\/+$/, '');
  }

  /** Preferred live clients endpoint */
  private getClientsApiUrl(): string {
    return `${this.apiBaseUrl}/Clients`;
  }

  private mapClientsResponse(raw: unknown): Client[] {
    const apiClients = normalizeApiResponse(raw);
    return apiClients.map(mapApiClientToClient).filter((c) => c.id !== '');
  }

  getClients(): Observable<Client[]> {
    return this.http.get<unknown>(this.getClientsApiUrl()).pipe(
      timeout(10000),
      map((raw) => this.mapClientsResponse(raw)),
      catchError((err) => {
        console.warn('Clients API failed:', err);
        return throwError(() => err);
      })
    );
  }

  getClientById(id: string): Observable<Client | null> {
    return this.http.get<unknown>(`${this.getClientsApiUrl()}/${id}`).pipe(
      timeout(10000),
      map((raw) => {
        const mapped = mapSingleClientResponse(raw, String(id));
        return mapped && mapped.id !== '' ? mapped : null;
      }),
      catchError(() =>
        this.getClients().pipe(
          map((clients) => clients.find((c) => c.id === id) ?? null),
          catchError(() => of(null))
        )
      )
    );
  }

  private buildClientUpdatePayload(
    clientId: string,
    updates: UpdateClientRequest,
    existingRaw: unknown
  ): Record<string, unknown> {
    const base =
      existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw)
        ? ({ ...(existingRaw as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const existingCustomerName =
      (base['customerName'] as string | undefined) ??
      (base['clientName'] as string | undefined) ??
      (base['name'] as string | undefined) ??
      updates.name;
    const existingCustomerLogo = (base['customerLogo'] as string | null | undefined) ?? null;
    const existingCustomerLogoName = (base['customerLogoName'] as string | null | undefined) ?? null;
    const existingLocationId =
      (base['locationId'] as number | string | null | undefined) ??
      (base['LocationId'] as number | string | null | undefined) ??
      null;

    return {
      // Send strict contract fields expected by Clients PUT validation.
      id: base['id'] ?? clientId,
      clientId: base['clientId'] ?? clientId,
      customerName: updates.name || existingCustomerName,
      customerLogo: existingCustomerLogo,
      customerLogoName: existingCustomerLogoName,
      locationId: existingLocationId,
      latitude: updates.latitude,
      longitude: updates.longitude,
    };
  }

  private findClientRawById(raw: unknown, clientId: string): Record<string, unknown> | null {
    const items = normalizeApiResponse(raw);
    const found = items.find((item) => String(item.clientId ?? item.id ?? '') === clientId) ?? null;
    return found ? ({ ...(found as Record<string, unknown>) } as Record<string, unknown>) : null;
  }

  private getExistingClientRawForUpdate(clientId: string): Observable<Record<string, unknown> | null> {
    return this.http.get<unknown>(`${this.getClientsApiUrl()}/${clientId}`).pipe(
      timeout(10000),
      map((raw) => toObjectOrNull(raw)),
      catchError(() =>
        this.http.get<unknown>(this.getClientsApiUrl()).pipe(
          timeout(10000),
          map((raw) => this.findClientRawById(raw, clientId)),
          catchError(() => of(null))
        )
      )
    );
  }

  updateClient(id: string | number, body: UpdateClientRequest): Observable<Client> {
    const clientId = String(id);
    return this.getExistingClientRawForUpdate(clientId).pipe(
      map((existingRaw) => this.buildClientUpdatePayload(clientId, body, existingRaw)),
      switchMap((payload) =>
        this.http.put<unknown>(`${this.getClientsApiUrl()}/${clientId}`, payload).pipe(timeout(10000))
      ),
      switchMap(() => this.getClientById(clientId)),
      map((client) => {
        if (!client) {
          throw new Error(`Client ${clientId} not found after update.`);
        }
        return client;
      }),
      catchError((err) => {
        console.error(`Failed to update client id=${clientId}:`, err);
        return throwError(() => err);
      })
    );
  }
}
