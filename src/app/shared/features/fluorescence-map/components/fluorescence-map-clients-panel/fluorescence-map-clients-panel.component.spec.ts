import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { FluorescenceMapClientsPanelComponent } from './fluorescence-map-clients-panel.component';
import { ClientService } from '../../../../services/client.service';
import { ProjectService } from '../../../../services/project.service';
import { WarRoomService } from '../../../../services/fluorescence-map.service';
import { LocationService } from '../../../../services/location.service';
import { RoutePreviewStorageService } from '../../../../services/route-preview-storage.service';
import { ToastrService } from 'ngx-toastr';
import { Project } from '../../../../models/project.model';

describe('FluorescenceMapClientsPanelComponent', () => {
  let fixture: ComponentFixture<FluorescenceMapClientsPanelComponent>;
  let component: FluorescenceMapClientsPanelComponent;

  const projectServiceMock = {
    getProjectsByClient: jasmine.createSpy('getProjectsByClient').and.returnValue(of([] as Project[])),
    updateProject: jasmine.createSpy('updateProject').and.returnValue(of({ id: 1 } as Project)),
  };

  const clientServiceMock = {
    updateClient: jasmine.createSpy('updateClient').and.returnValue(
      of({
        id: 'c1',
        name: 'Client 1',
        code: 'C1',
        coordinates: { latitude: 43.6532, longitude: -79.3832 },
      })
    ),
  };

  const warRoomServiceMock = {
    manufacturerLocations: jasmine.createSpy('manufacturerLocations').and.returnValue([]),
  };

  const locationServiceMock = {
    updateLocation: jasmine
      .createSpy('updateLocation')
      .and.returnValue(of({ id: 10, name: 'Toronto', latitude: 43.65, longitude: -79.38 })),
  };

  const routePreviewStorageMock = {
    get: jasmine.createSpy('get').and.returnValue(null),
    download: jasmine.createSpy('download').and.returnValue(true),
  };

  const toastrMock = {
    warning: jasmine.createSpy('warning'),
    success: jasmine.createSpy('success'),
    error: jasmine.createSpy('error'),
  };

  const baseProject: Project = {
    id: '1',
    projectName: 'Project A',
    clientId: 'c1',
    assessmentType: 'Type A',
    locationId: 10,
    location: 'Toronto',
    status: 'Open',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FluorescenceMapClientsPanelComponent],
      providers: [
        { provide: ClientService, useValue: clientServiceMock },
        { provide: ProjectService, useValue: projectServiceMock },
        { provide: WarRoomService, useValue: warRoomServiceMock },
        { provide: LocationService, useValue: locationServiceMock },
        { provide: RoutePreviewStorageService, useValue: routePreviewStorageMock },
        { provide: ToastrService, useValue: toastrMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FluorescenceMapClientsPanelComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('clientsWithProjects', [
      { id: 'c1', name: 'Client 1', projectCount: 1 },
    ]);
    fixture.componentRef.setInput('locationsById', new Map([
      ['10', { name: 'Toronto', latitude: 43.6532, longitude: -79.3832 }],
    ]));
    fixture.detectChanges();

    projectServiceMock.updateProject.calls.reset();
    projectServiceMock.getProjectsByClient.calls.reset();
    clientServiceMock.updateClient.calls.reset();
    locationServiceMock.updateLocation.calls.reset();
    toastrMock.warning.calls.reset();
    toastrMock.success.calls.reset();
    toastrMock.error.calls.reset();
  });

  it('initializes draft latitude/longitude from linked location', () => {
    component.startEditProject(baseProject, new Event('click'));

    const draft = component.getDraft(baseProject.id);
    expect(draft?.latitude).toBe('43.6532');
    expect(draft?.longitude).toBe('-79.3832');
  });

  it('blocks save when only latitude is provided', () => {
    component.startEditProject(baseProject, new Event('click'));
    component.updateDraft(String(baseProject.id), { latitude: '43.7', longitude: '' });

    component.saveProject(baseProject);

    expect(locationServiceMock.updateLocation).not.toHaveBeenCalled();
    expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
    expect(toastrMock.warning).toHaveBeenCalled();
  });

  it('blocks save for out-of-range coordinates', () => {
    component.startEditProject(baseProject, new Event('click'));
    component.updateDraft(String(baseProject.id), { latitude: '100', longitude: '-79.3' });

    component.saveProject(baseProject);

    expect(locationServiceMock.updateLocation).not.toHaveBeenCalled();
    expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
    expect(toastrMock.warning).toHaveBeenCalled();
  });

  it('saves location first and then project when coordinates are valid', () => {
    component.startEditProject(baseProject, new Event('click'));
    component.updateDraft(String(baseProject.id), {
      location: 'Toronto Updated',
      latitude: '43.7001',
      longitude: '-79.4002',
    });

    component.saveProject(baseProject);

    expect(locationServiceMock.updateLocation).toHaveBeenCalledWith(10, {
      name: 'Toronto Updated',
      latitude: 43.7001,
      longitude: -79.4002,
    });
    expect(projectServiceMock.updateProject).toHaveBeenCalled();
    expect(locationServiceMock.updateLocation).toHaveBeenCalledBefore(projectServiceMock.updateProject);
  });

  it('blocks coordinate save when project has no linked location id', () => {
    const unlinkedProject: Project = {
      ...baseProject,
      id: '2',
      locationId: undefined,
      manufacturerLocationId: undefined,
    };

    component.startEditProject(unlinkedProject, new Event('click'));
    component.updateDraft(String(unlinkedProject.id), {
      latitude: '43.7',
      longitude: '-79.4',
    });

    component.saveProject(unlinkedProject);

    expect(locationServiceMock.updateLocation).not.toHaveBeenCalled();
    expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
    expect(toastrMock.warning).toHaveBeenCalledWith(
      'This project is not linked to an API Location; coordinates cannot be saved.',
      'Cannot save'
    );
  });
});
