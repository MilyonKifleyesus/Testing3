import { signal } from '@angular/core';

import { FluorescenceMapSelectionFacade } from './fluorescence-map-selection.facade';
import { FluorescenceMapFilteredState } from '../fluorescence-map.types';
import { ActivityLogRow } from '../models/fleet-vm.models';
import { Node } from '../../../models/fluorescence-map.interface';

describe('FluorescenceMapSelectionFacade', () => {
  const buildRow = (overrides: Partial<ActivityLogRow> = {}): ActivityLogRow => ({
    id: 'project-1',
    entityType: 'project',
    entityId: 'project-1',
    entityName: 'Project 1',
    status: 'Active',
    projectTypeId: null,
    projectTypeName: null,
    contract: null,
    hasRoadTest: false,
    clientLocationId: null,
    clientName: 'Client One',
    clientCoordinates: null,
    manufacturerName: 'Manufacturer One',
    manufacturerCoordinates: null,
    locationName: 'Location One',
    locationCoordinates: null,
    startDate: null,
    endDate: null,
    updatedAt: null,
    coordinates: null,
    source: 'project_snapshot',
    projectId: 'project-1',
    clientId: 'client-1',
    manufacturerId: 'manufacturer-1',
    manufacturerLocationId: 'loc-30',
    locationId: '30',
    ...overrides,
  });

  const buildFilteredState = (overrides: Partial<FluorescenceMapFilteredState> = {}): FluorescenceMapFilteredState => ({
    filtersActive: true,
    filteredProjectIds: new Set(['project-1']),
    filteredProjects: [],
    activityTableRows: [buildRow()],
    clientTableRows: [],
    manufacturerTableRows: [],
    locationTableRows: [],
    availableRegions: [],
    statusCounts: { total: 1, active: 1, inactive: 0 },
    activeFilterCount: 1,
    activeFilters: [],
    filteredProjectRoutes: [],
    filteredNodes: [],
    derivedNodeIds: {
      fromNodeIds: new Set(['client-1']),
      toNodeIds: new Set(['loc-30']),
      allNodeIds: new Set(['client-1', 'loc-30']),
    },
    strictMapNodes: [
      {
        id: 'loc-30',
        companyId: 'manufacturer-1',
        company: 'Manufacturer One',
        name: 'Location One',
        level: 'manufacturer',
        type: 'Facility',
        status: 'ACTIVE',
        coordinates: { latitude: 43.7, longitude: -79.4 },
      } as Node,
    ],
    strictMapProjectRoutes: [],
    filteredTransitRoutes: [],
    mapViewModel: {
      mode: 'project',
      routes: [],
      markers: [],
      labels: [],
      bounds: null,
      emptyState: { show: false, message: null },
    },
    mapState: {
      showEmptyState: false,
      emptyMessage: null,
    },
    ...overrides,
  });

  it('invalidates selection when filters remove the current entity from the visible marker set', () => {
    const facade = new FluorescenceMapSelectionFacade();
    const selectedEntity = signal({
      level: 'manufacturer' as const,
      id: 'factory-99',
      manufacturerLocationId: 'loc-99',
      factoryId: 'loc-99',
    });
    const selectedRouteId = signal<string | null>(null);
    const filteredState = signal(buildFilteredState());

    const state = facade.createSelectionState({
      selectedEntity,
      selectedRouteId,
      filteredState,
    });

    expect(state().selectedEntityVisible).toBeFalse();
    expect(state().selectionInvalidated).toBeTrue();
    expect(state().noticeMessage).toBe('Current selection is outside applied filters');
  });

  it('derives selected project id from alias-normalized marker ids', () => {
    const facade = new FluorescenceMapSelectionFacade();

    const projectId = facade.deriveSelectedProjectIdFromNode(
      {
        id: 'source-30',
        companyId: 'manufacturer-1',
        company: 'Manufacturer One',
        name: 'Location One',
        manufacturerLocationId: 'loc-30',
        type: 'Facility',
        status: 'ACTIVE',
        coordinates: { latitude: 43.7, longitude: -79.4 },
      } as Node,
      [buildRow()],
    );

    expect(projectId).toBe('project-1');
  });
});
