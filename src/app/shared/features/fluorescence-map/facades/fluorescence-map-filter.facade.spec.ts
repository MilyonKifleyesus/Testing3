import { signal } from '@angular/core';

import { FluorescenceMapFilterFacade } from './fluorescence-map-filter.facade';
import { ActivityLogTableService } from '../services/activity-log-table.service';
import { FluorescenceMapBootstrapData, WarRoomFilters, createDefaultFilters } from '../fluorescence-map.types';
import { Node } from '../../../models/fluorescence-map.interface';
import { ProjectVm } from '../models/fleet-vm.models';

describe('FluorescenceMapFilterFacade', () => {
  const buildProject = (overrides: Partial<ProjectVm> = {}): ProjectVm => ({
    id: 'project-1',
    projectName: 'Project 1',
    clientId: 'client-1',
    clientName: 'Client One',
    assessmentType: 'Inspection',
    projectTypeId: 'type-1',
    manufacturerLocationId: 'loc-30',
    locationId: '30',
    locationName: 'Arboc Plant',
    manufacturerName: 'ARBOC',
    status: 'Open',
    lastUpdate: '2026-01-05T00:00:00.000Z',
    closed: false,
    ...overrides,
  });

  const buildBootstrapData = (projects: ProjectVm[], nodes: Node[] = []): FluorescenceMapBootstrapData => ({
    projects,
    clients: [
      { id: 'client-1', name: 'Client One', locationId: '20', latitude: 43.7, longitude: -79.4 },
    ],
    manufacturers: [
      { id: 'manufacturer-1', name: 'ARBOC', locationId: '30', locationIds: [30], latitude: 41.6, longitude: -85.7 },
    ],
    locations: [
      { id: '30', name: 'Arboc Plant', latitude: 41.6, longitude: -85.7 },
      { id: '20', name: 'Client Yard', latitude: 43.7, longitude: -79.4 },
    ],
    regionValues: ['North America'],
    nodes,
    projectRoutes: [],
    transitRoutes: [],
    projectIds: projects.map((project) => String(project.id)),
    projectClientIdByProjectId: new Map(projects.map((project) => [String(project.id), String(project.clientId)])),
    projectTypeIdByProjectId: new Map(projects.map((project) => [String(project.id), String(project.projectTypeId)])),
    manufacturerIdsByProjectId: new Map(projects.map((project) => [String(project.id), ['manufacturer-1']])),
    manufacturerIdsByNodeId: new Map([['30', ['manufacturer-1']]]),
    projectRegionByProjectId: new Map(projects.map((project) => [String(project.id), 'North America'])),
  });

  const baseFilters = (): WarRoomFilters => createDefaultFilters();

  it('keeps status counts in parity with the status-neutral filtered project set', () => {
    const facade = new FluorescenceMapFilterFacade(new ActivityLogTableService());
    const filters = signal<WarRoomFilters>({
      ...baseFilters(),
      status: 'active',
    });
    const state = facade.createFilteredState({
      bootstrapData: signal(buildBootstrapData([
        buildProject({ id: 'open-project', status: 'Open', closed: false }),
        buildProject({ id: 'closed-project', status: 'Closed', closed: true }),
      ])),
      filters,
      mapViewMode: signal('project'),
      clientOptions: signal([]),
      manufacturerOptions: signal([{ id: 'manufacturer-1', name: 'ARBOC', count: 2 }]),
      projectTypeOptions: signal([{ id: 'type-1', name: 'Inspection', count: 2 }]),
      projectOptions: signal([
        { id: 'open-project', name: 'Project 1', count: 1 },
        { id: 'closed-project', name: 'Project 2', count: 1 },
      ]),
      isPinnedClientMode: signal(false),
    });

    expect(state().filteredProjects.map((project) => project.id)).toEqual(['open-project']);
    expect(state().statusCounts).toEqual({ total: 2, active: 1, inactive: 1 });
  });

  it('keeps coordinate-backed markers visible when filtered rows exist but project routes are sparse', () => {
    const facade = new FluorescenceMapFilterFacade(new ActivityLogTableService());
    const state = facade.createFilteredState({
      bootstrapData: signal(buildBootstrapData(
        [buildProject()],
        [
          {
            id: '30',
            companyId: 'manufacturer-1',
            company: 'ARBOC',
            name: 'Arboc Plant',
            city: 'Middlebury',
            coordinates: { latitude: 41.6, longitude: -85.7 },
            type: 'Facility',
            status: 'ACTIVE',
            level: 'manufacturer',
          } as Node,
        ],
      )),
      filters: signal(baseFilters()),
      mapViewMode: signal('project'),
      clientOptions: signal([]),
      manufacturerOptions: signal([{ id: 'manufacturer-1', name: 'ARBOC', count: 1 }]),
      projectTypeOptions: signal([{ id: 'type-1', name: 'Inspection', count: 1 }]),
      projectOptions: signal([{ id: 'project-1', name: 'Project 1', count: 1 }]),
      isPinnedClientMode: signal(false),
    });

    expect(state().filteredProjectRoutes.length).toBe(0);
    expect(state().activityTableRows.length).toBe(1);
    expect(state().filteredNodes.map((node) => node.id)).toEqual(['30']);
    expect(state().strictMapNodes.map((node) => node.id)).toEqual(['30']);
    expect(state().mapState.showEmptyState).toBeFalse();
  });
});
