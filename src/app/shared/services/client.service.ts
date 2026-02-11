import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, delay, map, catchError } from 'rxjs';
import { Client, ClientLocation } from '../models/client.model';
import { environment } from '../../../environments/environment';

/** API/client JSON shape */
export interface ApiClient {
  clientId: string;
  clientName: string;
  locations?: { locationName: string; address: string; type: string }[];
}

/** Coordinate fallbacks for map routes (known transit clients) */
const CLIENT_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  drt: { latitude: 43.8975, longitude: -78.9405 },
  ttc: { latitude: 43.6532, longitude: -79.3832 },
  yrt: { latitude: 43.8828, longitude: -79.4403 },
  translink: { latitude: 49.2827, longitude: -122.8368 },
  'oc-transpo': { latitude: 45.4215, longitude: -75.6972 },
  metrolinx: { latitude: 43.6532, longitude: -79.3832 },
  'halifax-transit': { latitude: 44.6488, longitude: -63.5752 },
  onorth: { latitude: 46.3092, longitude: -79.4608 },
};

/** Code derived from client name (first letters of words, or abbreviated) */
function deriveCode(name: string, id: string): string {
  const known: Record<string, string> = {
    yrt: 'YRT',
    ttc: 'TTC',
    drt: 'DRT',
    translink: 'TRN',
    metrolinx: 'MTLX',
    'oc-transpo': 'OC',
  };
  const fromKnown = known[id];
  if (fromKnown) return fromKnown;
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
  const coordinates = CLIENT_COORDINATES[id];
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
  private readonly mockClients: Client[] = [
    { id: 'ttc', name: 'TTC', code: 'TTC', coordinates: { latitude: 43.6532, longitude: -79.3832 } },
    { id: 'go-transit', name: 'GO Transit', code: 'GOT', coordinates: { latitude: 43.6426, longitude: -79.3871 } },
    { id: 'miway', name: 'MiWay', code: 'MIW', coordinates: { latitude: 43.589, longitude: -79.6441 } },
    { id: 'brampton-transit', name: 'Brampton Transit', code: 'BRT', coordinates: { latitude: 43.7315, longitude: -79.7624 } },
    { id: 'yrt', name: 'York Region Transit', code: 'YRT', coordinates: { latitude: 43.8828, longitude: -79.4403 } },
    { id: 'drt', name: 'DRT', code: 'DRT', coordinates: { latitude: 43.8975, longitude: -78.9405 } },
    { id: 'translink', name: 'TransLink', code: 'TRN', coordinates: { latitude: 49.2827, longitude: -122.8368 } },
  ];

  private readonly CLIENTS_JSON_PATH = 'assets/data/clients.json';

  constructor(private http: HttpClient) {}

  getClients(): Observable<Client[]> {
    if (!environment.useClientJson) {
      return of([...this.mockClients]).pipe(delay(200));
    }

    return this.http.get<{ clients: ApiClient[] }>(this.CLIENTS_JSON_PATH).pipe(
      map((raw) => {
        const apiClients = raw?.clients ?? [];
        return apiClients.map(mapApiClientToClient);
      }),
      catchError(() => of([...this.mockClients])),
      delay(150)
    );
  }

  getClientById(id: string): Observable<Client | null> {
    return this.getClients().pipe(
      map((clients) => clients.find((c) => c.id === id) ?? null)
    );
  }
}
