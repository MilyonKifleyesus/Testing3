import { Injectable, signal } from '@angular/core';
import { combineLatest, Observable, Subject, timer } from 'rxjs';
import { catchError, map, shareReplay, switchMap, takeUntil, tap } from 'rxjs/operators';
import { FleetApiService } from './fleet-api.service';

export interface FleetSnapshot {
  projects: unknown;
  clients: unknown;
  locations: unknown;
  manufacturers: unknown;
  vehicles: unknown;
  projectTypes: unknown | null;
  mapStats: unknown | null;
}

@Injectable({ providedIn: 'root' })
export class FleetSnapshotService {
  private readonly stopPolling$ = new Subject<void>();
  readonly refreshing = signal(false);

  constructor(private readonly fleetApiService: FleetApiService) {}

  loadInitialSnapshot(): Observable<FleetSnapshot> {
    this.refreshing.set(true);
    return this.fetchSnapshot().pipe(
      tap(() => this.refreshing.set(false)),
      catchError((error) => {
        this.refreshing.set(false);
        throw error;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  startPolling(intervalMs = 15000): Observable<FleetSnapshot> {
    return timer(0, intervalMs).pipe(
      tap(() => this.refreshing.set(true)),
      switchMap(() => this.fetchSnapshot()),
      tap(() => this.refreshing.set(false)),
      takeUntil(this.stopPolling$),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  stopPolling(): void {
    this.stopPolling$.next();
    this.refreshing.set(false);
  }

  private fetchSnapshot(): Observable<FleetSnapshot> {
    return combineLatest([
      this.fleetApiService.getProjects(true),
      this.fleetApiService.getClients(),
      this.fleetApiService.getLocations(),
      this.fleetApiService.getManufacturers(),
      this.fleetApiService.getVehicles(),
      this.fleetApiService.getProjectTypesOptional().pipe(catchError(() => [null])),
      this.fleetApiService.getMapStatsOptional().pipe(catchError(() => [null])),
    ]).pipe(
      map(([projects, clients, locations, manufacturers, vehicles, projectTypes, mapStats]) => ({
        projects,
        clients,
        locations,
        manufacturers,
        vehicles,
        projectTypes,
        mapStats,
      }))
    );
  }
}
