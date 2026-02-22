import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { FluorescenceMapClientsPanelComponent } from './fluorescence-map-clients-panel.component';
import { ClientService } from '../../../../services/client.service';
import { ProjectService } from '../../../../services/project.service';
import { WarRoomService } from '../../../../services/fluorescence-map.service';
import { LocationService } from '../../../../services/location.service';
import { RoutePreviewStorageService } from '../../../../services/route-preview-storage.service';
import { ToastrService } from 'ngx-toastr';

describe('FluorescenceMapClientsPanelComponent (client edit)', () => {
  let fixture: ComponentFixture<FluorescenceMapClientsPanelComponent>;
  let component: FluorescenceMapClientsPanelComponent;

  const clientServiceMock = {
    updateClient: jasmine.createSpy('updateClient').and.returnValue(
      of({
        id: 'c1',
        name: 'Saskatoon Transit',
        code: 'ST',
        coordinates: { latitude: 52.1579, longitude: -106.6702 },
      })
    ),
  };

  const projectServiceMock = {
    getProjectsByClient: jasmine.createSpy('getProjectsByClient').and.returnValue(of([])),
    updateProject: jasmine.createSpy('updateProject').and.returnValue(of(null)),
  };

  const warRoomServiceMock = {
    manufacturerLocations: jasmine.createSpy('manufacturerLocations').and.returnValue([]),
  };

  const locationServiceMock = {
    updateLocation: jasmine.createSpy('updateLocation').and.returnValue(of(null)),
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
      { id: 'c1', name: 'Saskatoon Transit', projectCount: 3 },
    ]);
    fixture.componentRef.setInput('clientsById', new Map([
      ['c1', { id: 'c1', name: 'Saskatoon Transit', latitude: 52.1579, longitude: -106.6702 }],
    ]));
    fixture.detectChanges();

    clientServiceMock.updateClient.and.returnValue(
      of({
        id: 'c1',
        name: 'Saskatoon Transit',
        code: 'ST',
        coordinates: { latitude: 52.1579, longitude: -106.6702 },
      })
    );
    clientServiceMock.updateClient.calls.reset();
    toastrMock.warning.calls.reset();
    toastrMock.success.calls.reset();
    toastrMock.error.calls.reset();
  });

  it('starts client draft with existing name and coordinates', () => {
    component.startEditClient('c1', new Event('click'));

    const draft = component.getClientDraft('c1');
    expect(draft).toEqual({
      name: 'Saskatoon Transit',
      latitude: '52.1579',
      longitude: '-106.6702',
    });
  });

  it('blocks save when name is missing', () => {
    component.startEditClient('c1', new Event('click'));
    component.updateClientDraft('c1', { name: '   ' });

    component.saveClient('c1', new Event('click'));

    expect(clientServiceMock.updateClient).not.toHaveBeenCalled();
    expect(toastrMock.warning).toHaveBeenCalledWith('Client name is required.', 'Cannot save');
  });

  it('blocks save on partial coordinate pair', () => {
    component.startEditClient('c1', new Event('click'));
    component.updateClientDraft('c1', { latitude: '52.2', longitude: '' });

    component.saveClient('c1', new Event('click'));

    expect(clientServiceMock.updateClient).not.toHaveBeenCalled();
    expect(toastrMock.warning).toHaveBeenCalled();
  });

  it('blocks save on out-of-range coordinate values', () => {
    component.startEditClient('c1', new Event('click'));
    component.updateClientDraft('c1', { latitude: '120', longitude: '-106.67' });

    component.saveClient('c1', new Event('click'));

    expect(clientServiceMock.updateClient).not.toHaveBeenCalled();
    expect(toastrMock.warning).toHaveBeenCalled();
  });

  it('saves valid client edits and emits clientSaveComplete', () => {
    const emitSpy = spyOn(component.clientSaveComplete, 'emit');
    component.startEditClient('c1', new Event('click'));
    component.updateClientDraft('c1', {
      name: 'Saskatoon Transit Updated',
      latitude: '52.2000',
      longitude: '-106.6000',
    });

    component.saveClient('c1', new Event('click'));

    expect(clientServiceMock.updateClient).toHaveBeenCalledWith('c1', {
      name: 'Saskatoon Transit Updated',
      latitude: 52.2,
      longitude: -106.6,
    });
    expect(emitSpy).toHaveBeenCalled();
    expect(component.isEditingClient('c1')).toBeFalse();
  });

  it('keeps edit mode when save fails', () => {
    clientServiceMock.updateClient.and.returnValue(throwError(() => new Error('fail')));
    component.startEditClient('c1', new Event('click'));

    component.saveClient('c1', new Event('click'));

    expect(component.isEditingClient('c1')).toBeTrue();
    expect(toastrMock.error).toHaveBeenCalledWith('Failed to save client.', 'ERROR');
  });

  it('does not toggle client expansion when edit button is clicked', () => {
    const click = {
      target: document.createElement('button'),
    } as unknown as Event;
    (click.target as HTMLElement).setAttribute('data-client-edit-btn', '');

    component.onClientClick('c1', click);

    expect(component.isExpanded('c1')).toBeFalse();
  });
});
