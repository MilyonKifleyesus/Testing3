import { buildMapScene } from './fleet-map-scene';
import type { ApiClient, ApiLocation, ApiManufacturer, ApiProject } from '../models/fleet-map.models';

describe('buildMapScene', () => {
  it('builds an inactive project route when a closed project has client and location coordinates', () => {
    const project: ApiProject = {
      id: '14',
      clientId: '3',
      name: 'NFI -SR2735 60FT',
      type: 'Condition Assessment',
      typeId: '2',
      status: 'inactive',
      lat: 47.77,
      lng: -96.61,
      locationId: '13',
      locationIds: ['13'],
      lastUpdate: '2023-06-29T22:22:58.697',
    };

    const client: ApiClient = {
      id: '3',
      name: 'TTC',
      lat: 43.65,
      lng: -79.38,
      locationIds: ['25'],
    };

    const manufacturer: ApiManufacturer = {
      id: '2',
      name: 'New Flyer',
      lat: null,
      lng: null,
      locationIds: ['11', '12', '13'],
    };

    const locations: ApiLocation[] = [
      {
        id: '13',
        name: 'Winnipeg-Crookston (New Flyer)',
        lat: 47.77,
        lng: -96.61,
        manufacturerId: '2',
      },
      {
        id: '25',
        name: 'TTC Depot',
        lat: 43.65,
        lng: -79.38,
      },
    ];

    const scene = buildMapScene({
      mode: 'projects',
      projects: [project],
      clients: [client],
      manufacturers: [manufacturer],
      locations,
      selectedEntity: null,
      focusedEntity: null,
      viewedProject: project,
      clientById: new Map([[client.id, client]]),
      locationById: new Map(locations.map((location) => [location.id, location])),
    });

    expect(scene.projectIsolationReady).toBeTrue();
    expect(scene.routes.length).toBe(1);
    expect(scene.routes[0].properties?.status).toBe('inactive');
    expect(scene.routes[0].geometry.coordinates[0][0]).toBeCloseTo(-96.61, 6);
    expect(scene.routes[0].geometry.coordinates[0][1]).toBeCloseTo(47.77, 6);
    expect(scene.routes[0].geometry.coordinates[1][0]).toBeCloseTo(-79.38, 6);
    expect(scene.routes[0].geometry.coordinates[1][1]).toBeCloseTo(43.65, 6);
  });
});
