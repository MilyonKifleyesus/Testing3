import {
  selectActiveFilters,
  selectActiveFilterCount,
  selectDerivedNodeIdsFromRoutes,
  selectFilteredNodesStrict,
  selectFilteredProjectRoutesStrict,
  selectMapViewModelStrict,
  selectNodesWithClients,
  selectProjectRoutesForMap,
  selectStatusCounts,
} from './fluorescence-map.selectors';
import { WarRoomFilters } from '../fluorescence-map.types';
import { Node, ProjectRoute } from '../../../../shared/models/fluorescence-map.interface';
import { Project } from '../../../../shared/models/project.model';

describe('fluorescence-map selectors', () => {
  it('selectProjectRoutesForMap hides routes in manufacturer view', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'r1',
        projectId: 'p1',
        fromNodeId: 'c1',
        toNodeId: 'f1',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
    ];

    const result = selectProjectRoutesForMap('manufacturer', routes, null);
    expect(result.length).toBe(0);
  });

  it('selectProjectRoutesForMap hides routes in client view', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'r1',
        projectId: 'p1',
        fromNodeId: 'c1',
        toNodeId: 'f1',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
    ];

    const result = selectProjectRoutesForMap('client', routes, null);
    expect(result.length).toBe(0);
  });

  it('selectStatusCounts computes active/inactive totals', () => {
    const projects: Project[] = [
      { id: '1', status: 'Open' } as Project,
      { id: '2', status: 'Closed' } as Project,
    ];
    const result = selectStatusCounts(projects);
    expect(result).toEqual({ total: 2, active: 1, inactive: 1 });
  });

  it('selectActiveFilterCount counts all active dimensions', () => {
    const filters: WarRoomFilters = {
      status: 'inactive',
      regions: ['North America'],
      clientIds: ['c1'],
      manufacturerIds: ['m1'],
      projectTypeIds: [],
      projectIds: ['p1'],
    };
    expect(selectActiveFilterCount(filters)).toBe(5);
  });

  it('selectActiveFilters resolves client label using normalized id matching', () => {
    const filters: WarRoomFilters = {
      status: 'all',
      regions: [],
      clientIds: ['001'],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    };

    const items = selectActiveFilters(
      filters,
      [{ id: '1', name: 'Electromin' }],
      [],
      [],
      [],
      []
    );

    expect(items.length).toBe(1);
    expect(items[0].label).toBe('Client: Electromin');
    expect(items[0].value).toBe('1');
  });

  it('selectNodesWithClients includes all coordinate-backed clients in client view', () => {
    const baseNodes: Node[] = [];
    const clients = [
      { id: '10', name: 'York Region Transit', coordinates: { latitude: 43.85, longitude: -79.43 } },
      { id: '11', name: 'Metrolinx', coordinates: { latitude: 43.65, longitude: -79.38 } },
      { id: '12', name: 'No Coordinates', coordinates: null },
    ];
    const routes: ProjectRoute[] = [
      {
        id: 'r1',
        projectId: 'p1',
        fromNodeId: '11',
        toNodeId: 'f1',
        status: 'Open',
        fromCoordinates: { latitude: 43.65, longitude: -79.38 },
        toCoordinates: { latitude: 43.7, longitude: -79.4 },
      },
    ];
    const clientOptions = [{ id: '11' }];

    const result = selectNodesWithClients(baseNodes, clients, routes, clientOptions, 'client');
    const clientIds = result.filter((n) => n.level === 'client').map((n) => n.id);

    expect(clientIds).toContain('10');
    expect(clientIds).toContain('11');
    expect(clientIds).not.toContain('12');
  });

  it('selectNodesWithClients matches client ids across numeric-like formats', () => {
    const result = selectNodesWithClients(
      [],
      [{ id: '001', name: '54 Davies', coordinates: { latitude: 43.7, longitude: -79.4 } }],
      [
        {
          id: 'r-mixed',
          projectId: 'p-mixed',
          fromNodeId: '1',
          toNodeId: 'f1',
          status: 'Open',
          fromCoordinates: { latitude: 43.7, longitude: -79.4 },
          toCoordinates: { latitude: 43.8, longitude: -79.5 },
        },
      ],
      [],
      'project'
    );

    const clientNodes = result.filter((node) => node.level === 'client');
    expect(clientNodes.length).toBe(1);
    expect(clientNodes[0].id).toBe('1');
    expect(clientNodes[0].clientId).toBe('1');
  });

  it('selectNodesWithClients includes actively filtered clients in project view when routes are empty', () => {
    const result = selectNodesWithClients(
      [],
      [{ id: '001', name: 'Electromin', coordinates: { latitude: 43.7, longitude: -79.4 } }],
      [],
      [],
      'project',
      ['1']
    );

    const clientNodes = result.filter((node) => node.level === 'client');
    expect(clientNodes.length).toBe(1);
    expect(clientNodes[0].id).toBe('1');
  });

  it('selectFilteredProjectRoutesStrict applies union project filter and AND intersection', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'r-a',
        projectId: 'A',
        fromNodeId: 'TTC',
        toNodeId: 'SP+',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
      {
        id: 'r-b',
        projectId: 'B',
        fromNodeId: 'TTC',
        toNodeId: 'ARBOC',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 3, longitude: 3 },
      },
      {
        id: 'r-c',
        projectId: 'C',
        fromNodeId: 'OTHER',
        toNodeId: 'ARBOC',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 4, longitude: 4 },
      },
    ];

    const filtered = selectFilteredProjectRoutesStrict(routes, {
      status: 'all',
      regions: [],
      clientIds: ['TTC'],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: ['A', 'B'],
    });

    expect(filtered.map((route) => route.id)).toEqual(['r-a', 'r-b']);
  });

  it('selectFilteredProjectRoutesStrict resolves client filter through projectId -> clientId lookup', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'r-1',
        projectId: '101',
        fromNodeId: 'source-unknown-client',
        toNodeId: 'loc-30',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
      {
        id: 'r-2',
        projectId: '202',
        fromNodeId: 'source-unknown-client',
        toNodeId: 'loc-40',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 3, longitude: 3 },
      },
    ];

    const filtered = selectFilteredProjectRoutesStrict(
      routes,
      {
        status: 'all',
        regions: [],
        clientIds: ['1'],
        manufacturerIds: [],
        projectTypeIds: [],
        projectIds: [],
      },
      {
        getRegionForNodeId: () => null,
        getClientIdForProjectId: (projectId: string) => (projectId === '101' ? '001' : '2'),
      }
    );

    expect(filtered.map((route) => route.id)).toEqual(['r-1']);
  });

  it('selectFilteredProjectRoutesStrict applies endpoint OR region logic', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'r-1',
        projectId: 'A',
        fromNodeId: 'from-na',
        toNodeId: 'to-eu',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
      {
        id: 'r-2',
        projectId: 'B',
        fromNodeId: 'from-apac',
        toNodeId: 'to-latam',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
    ];
    const filtered = selectFilteredProjectRoutesStrict(
      routes,
      {
        status: 'all',
        regions: ['Europe'],
        clientIds: [],
        manufacturerIds: [],
        projectTypeIds: [],
        projectIds: [],
      },
      {
        getRegionForNodeId: (nodeId: string) => {
          if (nodeId === 'to-eu') return 'Europe';
          return null;
        },
      }
    );
    expect(filtered.map((route) => route.id)).toEqual(['r-1']);
  });

  it('selectFilteredProjectRoutesStrict treats Active/Open as active and non-active statuses as inactive', () => {
    const routes = [
      {
        id: 'r-active',
        projectId: 'A',
        fromNodeId: 'from-1',
        toNodeId: 'to-1',
        status: 'Active',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
      {
        id: 'r-open',
        projectId: 'B',
        fromNodeId: 'from-2',
        toNodeId: 'to-2',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
      {
        id: 'r-inactive',
        projectId: 'C',
        fromNodeId: 'from-3',
        toNodeId: 'to-3',
        status: 'Inactive',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
      {
        id: 'r-delayed',
        projectId: 'D',
        fromNodeId: 'from-4',
        toNodeId: 'to-4',
        status: 'Delayed',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
    ] as unknown as ProjectRoute[];

    const activeFiltered = selectFilteredProjectRoutesStrict(routes, {
      status: 'active',
      regions: [],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    expect(activeFiltered.map((route) => route.id)).toEqual(['r-active', 'r-open']);

    const inactiveFiltered = selectFilteredProjectRoutesStrict(routes, {
      status: 'inactive',
      regions: [],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    expect(inactiveFiltered.map((route) => route.id)).toEqual(['r-inactive', 'r-delayed']);
  });

  it('selectFilteredProjectRoutesStrict does not use toNodeId as manufacturer identity fallback', () => {
    const routes = [
      {
        id: 'r-no-manufacturer-meta',
        projectId: 'A',
        fromNodeId: 'client-1',
        toNodeId: 'location-123',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
      {
        id: 'r-matching-manufacturer-id',
        projectId: 'B',
        fromNodeId: 'client-2',
        toNodeId: 'location-456',
        status: 'Open',
        manufacturerId: 'New Flyer',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
      {
        id: 'r-non-matching-manufacturer-id',
        projectId: 'C',
        fromNodeId: 'client-3',
        toNodeId: 'location-789',
        status: 'Open',
        manufacturerId: 'NFI',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
    ] as unknown as ProjectRoute[];

    const filtered = selectFilteredProjectRoutesStrict(routes, {
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: ['New Flyer'],
      projectTypeIds: [],
      projectIds: [],
    });

    expect(filtered.map((route) => route.id)).toEqual([
      'r-no-manufacturer-meta',
      'r-matching-manufacturer-id',
    ]);
  });

  it('selectFilteredProjectRoutesStrict resolves manufacturer filter through toNodeId -> manufacturerId lookup', () => {
    const routes = [
      {
        id: 'r-lookup-match',
        projectId: 'A',
        fromNodeId: 'client-1',
        toNodeId: 'loc-30',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
      {
        id: 'r-lookup-no-match',
        projectId: 'B',
        fromNodeId: 'client-2',
        toNodeId: 'loc-40',
        status: 'Open',
        fromCoordinates: { latitude: 1, longitude: 1 },
        toCoordinates: { latitude: 2, longitude: 2 },
      },
    ] as unknown as ProjectRoute[];

    const filtered = selectFilteredProjectRoutesStrict(
      routes,
      {
        status: 'all',
        regions: [],
        clientIds: [],
        manufacturerIds: ['8'],
        projectTypeIds: [],
        projectIds: [],
      },
      {
        getRegionForNodeId: () => null,
        getManufacturerIdsForNodeId: (nodeId: string) => (nodeId === 'loc-30' ? ['8'] : ['12']),
      }
    );

    expect(filtered.map((route) => route.id)).toEqual(['r-lookup-match']);
  });

  it('strict selectors derive endpoint nodes and labels from markers only', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'r-1',
        projectId: 'A',
        fromNodeId: 'client-1',
        toNodeId: 'manu-1',
        status: 'Open',
        fromCoordinates: { latitude: 10, longitude: 10 },
        toCoordinates: { latitude: 20, longitude: 20 },
      },
    ];
    const nodes: Node[] = [
      {
        id: 'client-1',
        name: 'TTC',
        company: 'TTC',
        companyId: 'client-1',
        city: 'Toronto',
        coordinates: { latitude: 10, longitude: 10 },
        type: 'Hub',
        status: 'ACTIVE',
      },
      {
        id: 'manu-1',
        name: 'SP+',
        company: 'SP+',
        companyId: 'manu-1',
        city: 'Montreal',
        coordinates: { latitude: 20, longitude: 20 },
        type: 'Facility',
        status: 'ACTIVE',
      },
      {
        id: 'orphan',
        name: 'Orphan',
        company: 'Orphan',
        companyId: 'orphan',
        city: 'Ottawa',
        coordinates: { latitude: 30, longitude: 30 },
        type: 'Facility',
        status: 'ACTIVE',
      },
    ];

    const ids = selectDerivedNodeIdsFromRoutes(routes);
    expect(Array.from(ids.allNodeIds).sort()).toEqual(['client-1', 'manu-1']);

    const filteredNodes = selectFilteredNodesStrict(nodes, ids.allNodeIds);
    expect(filteredNodes.map((node) => node.id).sort()).toEqual(['client-1', 'manu-1']);

    const vm = selectMapViewModelStrict({
      mode: 'project',
      filteredRoutes: routes,
      filteredNodes,
      derivedNodeIds: ids,
      filtersActive: true,
    });

    expect(vm.markers.map((marker) => marker.nodeId).sort()).toEqual(['client-1', 'manu-1']);
    expect(vm.labels.map((label) => label.nodeId).sort()).toEqual(['client-1', 'manu-1']);
    expect(vm.routes.length).toBe(1);
    expect(vm.bounds).toEqual({
      minLat: 10,
      minLng: 10,
      maxLat: 20,
      maxLng: 20,
    });
  });

  it('strict selectors match loc-prefixed route endpoints to normalized node ids', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'r-loc',
        projectId: 'A',
        fromNodeId: 'client-1',
        toNodeId: 'loc-30',
        status: 'Open',
        fromCoordinates: { latitude: 10, longitude: 10 },
        toCoordinates: { latitude: 20, longitude: 20 },
      },
    ];
    const nodes: Node[] = [
      {
        id: 'client-1',
        name: 'Client One',
        company: 'Client One',
        companyId: 'client-1',
        city: 'Toronto',
        coordinates: { latitude: 10, longitude: 10 },
        type: 'Hub',
        status: 'ACTIVE',
      },
      {
        id: '30',
        name: 'Factory 30',
        company: 'Factory 30',
        companyId: '30',
        city: 'Concord',
        coordinates: { latitude: 20, longitude: 20 },
        type: 'Facility',
        status: 'ACTIVE',
      },
    ];

    const ids = selectDerivedNodeIdsFromRoutes(routes);
    const filteredNodes = selectFilteredNodesStrict(nodes, ids.allNodeIds);

    expect(filteredNodes.map((node) => node.id).sort()).toEqual(['30', 'client-1']);
  });
});
