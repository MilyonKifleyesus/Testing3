import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, delay, map, catchError, throwError, shareReplay, tap } from 'rxjs';
import { Client, ClientLocation } from '../models/client.model';
import { environment } from '../../../environments/environment';

type ClientEnvironmentConfig = typeof environment & {
  useClientJson?: boolean;
};

/** API/client JSON shape */
export interface ApiClient {
  clientId?: string | number;
  id?: string | number;
  clientName?: string;
  name?: string;
  title?: string;
  customerLogo?: string;
  customerLogoName?: string;
  logo?: string;
  logoUrl?: string;
  logoName?: string;
  latitude?: number;
  longitude?: number;
  locations?: { locationName: string; address: string; type: string }[];
}

/** Code derived from client name (first letters of words, or abbreviated) */
function deriveCode(name: string, id: string): string {
  const fromName = name.replace(/\s*\([^)]*\)/g, '').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);
  return fromName || id.toUpperCase();
}

function mapApiClientToClient(api: ApiClient): Client {
  const id = String(api.clientId ?? api.id ?? '').trim();
  const name = String(api.clientName ?? api.name ?? api.title ?? id).trim();
  const logoUrl = String(
    api.customerLogo ??
    api.logoUrl ??
    api.logo ??
    '',
  ).trim();
  const logoName = String(
    api.customerLogoName ??
    api.logoName ??
    '',
  ).trim();
  const locations: ClientLocation[] = (api.locations ?? []).map((loc) => ({
    locationName: loc.locationName,
    address: loc.address,
    type: loc.type,
  }));
  const coordinates =
    api.latitude != null && api.longitude != null
      ? { latitude: api.latitude, longitude: api.longitude }
      : undefined;
  return {
    id,
    name,
    code: deriveCode(name, id),
    logoUrl: logoUrl || undefined,
    logoName: logoName || undefined,
    coordinates,
    locations: locations.length > 0 ? locations : undefined,
  };
}

@Injectable({
  providedIn: 'root',
})
export class ClientService {
  private readonly CLIENTS_JSON_PATH = 'assets/data/clients.json';
  private readonly CLIENTS_API_PATH = `${environment.apiBaseUrl}/Clients`;
  private readonly envConfig = environment as ClientEnvironmentConfig;
  private clientsCache$?: Observable<Client[]>;
  private readonly clientNameById = new Map<string, string>();
  private readonly fallbackClientNameById = new Map<string, string>([
    ['2', 'BoltBus'],
    ['3', 'TTC'],
    ['8', 'Metrolinx'],
    ['9', 'YRT'],
    ['10', 'DRT'],
    ['11', 'Translink'],
    ['15', 'Halifax Transit'],
    ['16', 'BusPulse'],
    ['17', 'Saskatoon Transit'],
    ['18', 'SP+'],
    ['19', 'TOK Group'],
    ['20', 'OC Transpo'],
    ['21', 'Electromin'],
    ['22', '54 Davies'],
    ['23', 'Ontario Northland'],
    ['24', 'Kingston Transit'],
    ['25', 'DefaultClient'],
  ]);

  constructor(private http: HttpClient) {}

  getClients(): Observable<Client[]> {
    if (this.clientsCache$) {
      return this.clientsCache$;
    }

    const apiClients$ = this.http.get<unknown>(this.CLIENTS_API_PATH).pipe(
      map((response) => this.extractApiClients(response).map(mapApiClientToClient)),
    );

    const jsonClients$ = this.http.get<{ clients: ApiClient[] }>(this.CLIENTS_JSON_PATH).pipe(
      map((raw) => (raw?.clients ?? []).map(mapApiClientToClient)),
    );

    const source$ = this.envConfig.useClientJson === false
      ? apiClients$
      : apiClients$.pipe(catchError(() => jsonClients$));

    this.clientsCache$ = source$.pipe(
      tap((clients) => {
        this.clientNameById.clear();
        clients.forEach((client) => {
          const key = String(client.id ?? '').trim();
          const name = String(client.name ?? '').trim();
          if (key && name) {
            this.clientNameById.set(key, name);
          }
        });
      }),
      catchError((err) => {
        console.error('Failed to load clients', err);
        return throwError(() => err);
      }),
      delay(150),
      shareReplay(1),
    );

    return this.clientsCache$;
  }

  private extractApiClients(raw: unknown): ApiClient[] {
    if (Array.isArray(raw)) {
      return raw as ApiClient[];
    }

    if (!raw || typeof raw !== 'object') {
      return [];
    }

    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj['items'])) return obj['items'] as ApiClient[];
    if (Array.isArray(obj['clients'])) return obj['clients'] as ApiClient[];
    if (Array.isArray(obj['results'])) return obj['results'] as ApiClient[];
    if (Array.isArray(obj['data'])) return obj['data'] as ApiClient[];

    if (obj['data'] && typeof obj['data'] === 'object') {
      const nested = obj['data'] as Record<string, unknown>;
      if (Array.isArray(nested['items'])) return nested['items'] as ApiClient[];
      if (Array.isArray(nested['clients'])) return nested['clients'] as ApiClient[];
    }

    return [];
  }

  getClientNameMap(): Observable<Map<string, string>> {
    return this.getClients().pipe(
      map(() => new Map(this.clientNameById)),
    );
  }

  resolveClientName(clientId: string | number | null | undefined, fallback: string = '-'): string {
    if (clientId === null || clientId === undefined) {
      return fallback;
    }

    const key = String(clientId).trim();
    if (!key) {
      return fallback;
    }

    return this.clientNameById.get(key) ?? this.fallbackClientNameById.get(key) ?? key;
  }

  getClientById(id: string): Observable<Client | null> {
    return this.getClients().pipe(
      map((clients) => clients.find((c) => c.id === id) ?? null)
    );
  }
}
