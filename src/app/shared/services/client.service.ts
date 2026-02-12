import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, delay, map, catchError } from 'rxjs';
import { Client, ClientLocation } from '../models/client.model';
import { environment } from '../../../environments/environment';

/** API/client JSON shape */
export interface ApiClient {
  clientId: string;
  clientName: string;
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
  const id = api.clientId;
  const name = api.clientName;
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
    coordinates,
    locations: locations.length > 0 ? locations : undefined,
  };
}

@Injectable({
  providedIn: 'root',
})
export class ClientService {
  private readonly CLIENTS_JSON_PATH = 'assets/data/clients.json';

  constructor(private http: HttpClient) {}

  getClients(): Observable<Client[]> {
    if (!environment.useClientJson) {
      return of([]).pipe(delay(200));
    }

    return this.http.get<{ clients: ApiClient[] }>(this.CLIENTS_JSON_PATH).pipe(
      map((raw) => {
        const apiClients = raw?.clients ?? [];
        return apiClients.map(mapApiClientToClient);
      }),
      catchError(() => of([])),
      delay(150)
    );
  }

  getClientById(id: string): Observable<Client | null> {
    return this.getClients().pipe(
      map((clients) => clients.find((c) => c.id === id) ?? null)
    );
  }
}
