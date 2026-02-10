import { Injectable } from '@angular/core';
import { Observable, of, delay } from 'rxjs';
import { Client } from '../models/client.model';

/**
 * Client service for War Room and project management
 * Merges mock from vehicle-report.service and client-profiles
 */
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

  getClients(): Observable<Client[]> {
    return of([...this.mockClients]).pipe(delay(200));
  }

  getClientById(id: string): Observable<Client | null> {
    const client = this.mockClients.find((c) => c.id === id) ?? null;
    return of(client).pipe(delay(100));
  }
}
