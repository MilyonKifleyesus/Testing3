import { ActivityLogTableService } from './activity-log-table.service';
import { ClientVm, LocationVm, ManufacturerVm, ProjectVm } from '../models/fleet-vm.models';

describe('ActivityLogTableService', () => {
  let service: ActivityLogTableService;

  beforeEach(() => {
    service = new ActivityLogTableService();
  });

  const baseProject = (overrides: Partial<ProjectVm> = {}): ProjectVm => ({
    id: '1',
    projectName: 'Project One',
    clientId: '100',
    clientName: 'Client One',
    assessmentType: 'Inspection',
    projectTypeId: '10',
    manufacturerLocationId: '30',
    locationId: '30',
    locationName: 'Factory A',
    manufacturerName: 'OEM One',
    status: 'Open',
    lastUpdate: '2026-01-05T00:00:00.000Z',
    closed: false,
    ...overrides,
  });

  const clients: ClientVm[] = [
    {
      id: '100',
      name: 'Client One',
      locationId: '20',
      latitude: 43.7,
      longitude: -79.4,
    },
  ];

  const locations: LocationVm[] = [
    {
      id: '30',
      name: 'Factory A',
      latitude: 42.1,
      longitude: -80.2,
    },
  ];

  const manufacturers: ManufacturerVm[] = [
    {
      id: '8',
      name: 'OEM One',
      locationId: '30',
      latitude: 42.1,
      longitude: -80.2,
    },
  ];

  it('resolves manufacturer by location id when manufacturerLocationId is missing', () => {
    const rows = service.buildRows(
      [baseProject({ manufacturerLocationId: null, locationId: '30' })],
      clients,
      manufacturers,
      locations,
      { status: 'all' }
    );

    expect(rows.length).toBe(1);
    expect(rows[0].manufacturerId).toBe('8');
    expect(rows[0].manufacturerName).toBe('OEM One');
  });

  it('normalizes loc-prefixed manufacturerLocationId when resolving manufacturer', () => {
    const rows = service.buildRows(
      [baseProject({ manufacturerLocationId: 'loc-30', locationId: '30' })],
      clients,
      manufacturers,
      locations,
      { status: 'all' }
    );

    expect(rows.length).toBe(1);
    expect(rows[0].manufacturerId).toBe('8');
  });

  it('displays "Multiple" when multiple manufacturers match project locationIds', () => {
    const rows = service.buildRows(
      [
        baseProject({
          manufacturerLocationId: null,
          locationId: '30',
          locationIds: [30, 31],
        }),
      ],
      clients,
      [
        {
          id: '8',
          name: 'OEM One',
          locationId: '30',
          locationIds: [30],
          latitude: 42.1,
          longitude: -80.2,
        },
        {
          id: '9',
          name: 'OEM Two',
          locationId: '31',
          locationIds: [31],
          latitude: 42.2,
          longitude: -80.1,
        },
      ],
      [
        ...locations,
        {
          id: '31',
          name: 'Factory B',
          latitude: 42.2,
          longitude: -80.1,
        },
      ],
      { status: 'all' }
    );

    expect(rows.length).toBe(1);
    expect(rows[0].manufacturerName).toBe('Multiple');
    expect(rows[0].manufacturerId).toBeNull();
  });
});
