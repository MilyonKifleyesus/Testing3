import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import type {
  ApiClient,
  ApiLocation,
  ApiManufacturer,
  ApiProject,
  ApiProjectType,
} from '../models/fleet-map.models';
import { FleetMapApiService } from './fleet-map-api.service';
import { FleetMapStateService } from './fleet-map-state.service';
import { AppStateService } from '../../../services/app-state.service';

class FleetMapApiServiceStub {
  fetchClients = jasmine.createSpy<() => Observable<ApiClient[]>>('fetchClients').and.returnValue(of([]));
  fetchManufacturers = jasmine.createSpy<() => Observable<ApiManufacturer[]>>('fetchManufacturers').and.returnValue(of([]));
  fetchLocations = jasmine.createSpy<() => Observable<ApiLocation[]>>('fetchLocations').and.returnValue(of([]));
  fetchProjects = jasmine.createSpy<() => Observable<ApiProject[]>>('fetchProjects').and.returnValue(of([]));
  deriveProjectTypes = jasmine.createSpy<(projects: ApiProject[]) => ApiProjectType[]>('deriveProjectTypes')
    .and.callFake((projects) => projects.map((project) => ({ id: project.typeId ?? project.type, name: project.type })));
}

class AppStateServiceStub {
  readonly state$ = new BehaviorSubject({ theme: 'light' });
  readonly toggleTheme = jasmine.createSpy('toggleTheme');
}

describe('FleetMapStateService', () => {
  let service: FleetMapStateService;
  let api: FleetMapApiServiceStub;
  let appState: AppStateServiceStub;

  const projectA: ApiProject = {
    id: 'project-a',
    name: 'Project A',
    clientId: 'client-a',
    lat: null,
    lng: null,
    locationId: 'location-a',
    locationIds: ['location-a'],
    type: 'Assessment',
    typeId: 'type-a',
    status: 'active',
  };

  const projectB: ApiProject = {
    id: 'project-b',
    name: 'Project B',
    clientId: 'client-b',
    lat: null,
    lng: null,
    locationId: 'location-b',
    locationIds: ['location-b'],
    type: 'Warranty',
    typeId: 'type-b',
    status: 'inactive',
  };

  const clientA: ApiClient = {
    id: 'client-a',
    name: 'Client A',
    lat: 43.7,
    lng: -79.4,
    locationIds: ['location-a'],
  };

  const clientB: ApiClient = {
    id: 'client-b',
    name: 'Client B',
    lat: 43.8,
    lng: -79.5,
    locationIds: ['location-b'],
  };

  const manufacturerA: ApiManufacturer = {
    id: 'manufacturer-a',
    name: 'Manufacturer A',
    lat: 45.1,
    lng: -75.7,
    locationIds: ['location-a'],
  };

  const manufacturerB: ApiManufacturer = {
    id: 'manufacturer-b',
    name: 'Manufacturer B',
    lat: 46.1,
    lng: -76.7,
    locationIds: ['location-b'],
  };

  const locationA: ApiLocation = {
    id: 'location-a',
    manufacturerId: 'manufacturer-a',
    name: 'Location A',
    lat: 45.1,
    lng: -75.7,
  };

  const locationB: ApiLocation = {
    id: 'location-b',
    manufacturerId: 'manufacturer-b',
    name: 'Location B',
    lat: 46.1,
    lng: -76.7,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        FleetMapStateService,
        { provide: FleetMapApiService, useClass: FleetMapApiServiceStub },
        { provide: AppStateService, useClass: AppStateServiceStub },
      ],
    });

    service = TestBed.inject(FleetMapStateService);
    api = TestBed.inject(FleetMapApiService) as unknown as FleetMapApiServiceStub;
    appState = TestBed.inject(AppStateService) as unknown as AppStateServiceStub;
    localStorage.removeItem('buspulse-theme');
  });

  it('loads partial data and flags the feature as degraded when one request fails', () => {
    api.fetchClients.and.returnValue(throwError(() => new Error('clients failed')));
    api.fetchManufacturers.and.returnValue(of([manufacturerA]));
    api.fetchLocations.and.returnValue(of([locationA]));
    api.fetchProjects.and.returnValue(of([projectA]));

    service.load();

    expect(service.isLoading()).toBeFalse();
    expect(service.isError()).toBeTrue();
    expect(service.clients()).toEqual([]);
    expect(service.manufacturers()).toEqual([manufacturerA]);
    expect(service.locations()).toEqual([locationA]);
    expect(service.projects()).toEqual([projectA]);
    expect(service.projectTypes()).toEqual([{ id: 'type-a', name: 'Assessment' }]);
  });

  it('applies manufacturer filters through linked project locations and clears the current selection', () => {
    service.projects.set([projectA, projectB]);
    service.clients.set([clientA, clientB]);
    service.manufacturers.set([manufacturerA, manufacturerB]);
    service.locations.set([locationA, locationB]);
    service.selectedEntity.set({ kind: 'project', data: projectA });
    service.mapFocusEntity.set({ kind: 'project', data: projectA });

    service.openFilters();
    service.toggleDraftValue('manufacturers', 'manufacturer-b');
    service.applyFilters();

    expect(service.filteredProjects().map((project) => project.id)).toEqual(['project-b']);
    expect(service.filteredClients().map((client) => client.id)).toEqual(['client-b']);
    expect(service.filteredLocations().map((location) => location.id)).toEqual(['location-b']);
    expect(service.selectedEntity()).toBeNull();
    expect(service.mapFocusEntity()).toBeNull();
  });

  it('tracks theme changes through AppStateService and delegates theme toggles back to it', () => {
    expect(service.isDark()).toBeFalse();

    appState.state$.next({ theme: 'dark' });

    expect(service.isDark()).toBeTrue();
    service.toggleTheme();
    expect(appState.toggleTheme).toHaveBeenCalled();
  });
});
