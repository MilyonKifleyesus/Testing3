import { Signal, signal } from '@angular/core';
import { EndpointStatus, WarRoomFilters, WarRoomPersistedState } from '../fluorescence-map.types';

/**
 * Lightweight facade state container used as a seam for incremental extraction
 * from FluorescenceMapComponent without changing runtime behavior.
 */
export class FluorescenceMapFacadeState {
  readonly clientsStatus = signal<EndpointStatus>('idle');
  readonly projectsStatus = signal<EndpointStatus>('idle');
  readonly manufacturersStatus = signal<EndpointStatus>('idle');
  readonly locationsStatus = signal<EndpointStatus>('idle');

  readonly endpointErrors = signal<Record<string, string | null>>({
    clients: null,
    projects: null,
    manufacturers: null,
    locations: null,
  });

  readonly projectRoutesLoading = signal(false);
  readonly projectRoutesRefreshTrigger = signal(0);

  toPersistedState(filters: WarRoomFilters, mapViewMode: string, panelVisible: boolean): WarRoomPersistedState {
    return {
      ...filters,
      mapViewMode: mapViewMode as WarRoomPersistedState['mapViewMode'],
      panelVisible,
    };
  }

  loadPersistedState(raw: string | null): WarRoomPersistedState | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as WarRoomPersistedState;
    } catch {
      return null;
    }
  }
}

export interface FluorescenceMapFacade {
  clientsStatus: Signal<EndpointStatus>;
  projectsStatus: Signal<EndpointStatus>;
  manufacturersStatus: Signal<EndpointStatus>;
  locationsStatus: Signal<EndpointStatus>;
}

