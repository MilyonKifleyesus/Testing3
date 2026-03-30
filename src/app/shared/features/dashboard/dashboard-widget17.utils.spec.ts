import { resolveTicketsByVehicleQueryScope } from './dashboard-widget17.utils';

describe('resolveTicketsByVehicleQueryScope', () => {
  it('uses the selected project when a concrete project is chosen', () => {
    expect(resolveTicketsByVehicleQueryScope({
      clientId: 7,
      includeClosed: false,
      selectedProject: '12',
      selectedVehicle: '99',
      visibleProjectIds: ['12', '13'],
    })).toEqual({
      kind: 'project',
      clientId: 7,
      includeClosed: false,
      projectId: '12',
      vehicleId: '99',
    });
  });

  it('uses a direct vehicle query when all projects are selected', () => {
    expect(resolveTicketsByVehicleQueryScope({
      clientId: 7,
      includeClosed: true,
      selectedProject: 'all',
      selectedVehicle: '99',
      visibleProjectIds: ['12', '13'],
    })).toEqual({
      kind: 'vehicle',
      clientId: 7,
      includeClosed: true,
      vehicleId: '99',
    });
  });

  it('uses a single all-projects query when no concrete vehicle is selected', () => {
    expect(resolveTicketsByVehicleQueryScope({
      clientId: 7,
      includeClosed: false,
      selectedProject: 'all',
      selectedVehicle: 'all',
      visibleProjectIds: ['all', '12', '13', ''],
    })).toEqual({
      kind: 'all',
      clientId: 7,
      includeClosed: false,
    });
  });
});
