import { of } from 'rxjs';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent project duration filters', () => {
  function createComponent(stationTrackerItems: any[] = []): {
    component: DashboardComponent;
    getAllStationTrackers: jasmine.Spy;
    markForCheck: jasmine.Spy;
  } {
    const getAllStationTrackers = jasmine.createSpy('getAllStationTrackers')
      .and.returnValue(of(stationTrackerItems));
    const markForCheck = jasmine.createSpy('markForCheck');

    const component = new DashboardComponent(
      { userRole: 'admin', currentUserValue: null, currentUser$: of(null) } as any,
      { getAllStationTrackers } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { markForCheck } as any,
      {} as any,
      { snapshot: null } as any,
      { snapshot: { queryParams: {} } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    component.widgets = [
      {
        id: 'widget-18',
        title: 'Project Duration',
        subtitle: '',
        type: 'chart',
        chartOptions: null,
        loading: false,
        cols: 1,
        rows: 1,
        order: 1,
      } as any,
    ];
    component.projects = [
      { id: 'all', name: 'All Projects' } as any,
      { id: '101', name: 'SR2838', projectTypeName: 'New Build' } as any,
      { id: '102', name: 'LF79-40FT-CNG', projectTypeName: 'Condition Assessment' } as any,
    ];
    component.selectedProject = 'all';
    component.selectedVehicle = 'all';

    spyOn<any>(component, 'scheduleProjectDurationAxisSync');

    return { component, getAllStationTrackers, markForCheck };
  }

  it('passes the selected vehicle into the station tracker query', () => {
    const { component, getAllStationTrackers } = createComponent([
      { projectId: '101', vehicleId: 'V-A1', startDate: '2026-01-01', endDate: '2026-01-10' },
    ]);

    component.selectedVehicle = 'V-A1';
    component.loadProjectDurationData();

    expect(getAllStationTrackers).toHaveBeenCalledWith({
      projectId: undefined,
      vehicleId: 'V-A1',
    });
  });

  it('filters out tracker rows that are outside the visible project scope', () => {
    const { component } = createComponent([
      { projectId: '101', vehicleId: 'V-A1', startDate: '2026-01-01', endDate: '2026-01-10' },
      { projectId: '999', vehicleId: 'V-A1', startDate: '2026-01-01', endDate: '2026-01-15' },
    ]);

    component.selectedVehicle = 'V-A1';
    component.loadProjectDurationData();

    const widget = component.widgets.find((item) => item.id === 'widget-18');
    const categories = widget?.chartOptions?.xaxis?.categories ?? [];

    expect(categories).toEqual(['SR2838']);
  });

  it('rebuilds the widget for the vehicle-scoped project duration only', () => {
    const { component, markForCheck } = createComponent([
      { projectId: '101', vehicleId: 'V-A1', startDate: '2026-01-01', endDate: '2026-01-10' },
      { projectId: '101', vehicleId: 'V-A2', startDate: '2026-01-02', endDate: '2026-01-20' },
      { projectId: '102', vehicleId: 'V-B1', startDate: '2026-02-01', endDate: '2026-02-18' },
    ]);

    component.selectedVehicle = 'V-A1';
    component.loadProjectDurationData();

    const widget = component.widgets.find((item) => item.id === 'widget-18');
    const categories = widget?.chartOptions?.xaxis?.categories ?? [];
    const values = widget?.chartOptions?.series?.[0]?.data ?? [];

    expect(categories).toEqual(['SR2838']);
    expect(values).toEqual([9]);
    expect(markForCheck).toHaveBeenCalled();
  });
});
