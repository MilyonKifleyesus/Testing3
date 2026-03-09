import { Injectable, computed, signal } from '@angular/core';
import { ActivityLogRow } from '../models/fleet-vm.models';

export type FleetMapViewMode = 'project' | 'client' | 'manufacturer';

@Injectable({ providedIn: 'root' })
export class FleetMapStateService {
  private readonly mapViewModeSignal = signal<FleetMapViewMode>('project');
  private readonly filtersOpenSignal = signal(false);
  private readonly tableOpenSignal = signal(true);
  private readonly selectedEntityIdSignal = signal<string | null>(null);
  private readonly activityRowsSignal = signal<ActivityLogRow[]>([]);

  readonly mapViewMode = computed(() => this.mapViewModeSignal());
  readonly filtersOpen = computed(() => this.filtersOpenSignal());
  readonly tableOpen = computed(() => this.tableOpenSignal());
  readonly selectedEntityId = computed(() => this.selectedEntityIdSignal());
  readonly activityRows = computed(() => this.activityRowsSignal());

  setMapViewMode(mode: FleetMapViewMode): void {
    this.mapViewModeSignal.set(mode);
  }

  setFiltersOpen(open: boolean): void {
    this.filtersOpenSignal.set(open);
  }

  setTableOpen(open: boolean): void {
    this.tableOpenSignal.set(open);
  }

  setSelectedEntityId(entityId: string | null): void {
    this.selectedEntityIdSignal.set(entityId);
  }

  setActivityRows(rows: ActivityLogRow[]): void {
    this.activityRowsSignal.set(rows);
  }
}
