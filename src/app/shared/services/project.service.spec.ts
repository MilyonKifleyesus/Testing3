import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ClientService } from './client.service';
import { LocationService } from './location.service';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
  let service: ProjectService;
  let httpMock: HttpTestingController;

  const clientServiceMock = {
    getClients: jasmine.createSpy('getClients').and.returnValue(
      of([
        {
          id: '12',
          name: 'Client One',
          code: 'C1',
          locationId: 30,
          locationIds: [30],
        },
      ])
    ),
  };

  const locationServiceMock = {
    getAllLocations: jasmine.createSpy('getAllLocations').and.returnValue(
      of([
        {
          id: 30,
          name: 'Winnipeg (New Flyer)',
          latitude: 49.8951,
          longitude: -97.1384,
        },
      ])
    ),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProjectService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ClientService, useValue: clientServiceMock },
        { provide: LocationService, useValue: locationServiceMock },
      ],
    });

    service = TestBed.inject(ProjectService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('sends clientId, locationId, projectTypeId, and includeClosed to /Projects when server-filterable filters are present', fakeAsync(() => {
    let resultLength = -1;

    service.getProjects({
      clientIds: ['12'],
      manufacturerLocationId: 'loc-30',
      projectTypeIds: ['7'],
      projectStatuses: ['Open'],
    }).subscribe((projects) => {
      resultLength = projects.length;
    });

    const manufacturersReq = httpMock.expectOne((req) => req.url.includes('/Manufacturers'));
    const projectsReq = httpMock.expectOne((req) => req.url.includes('/Projects'));

    expect(projectsReq.request.params.get('clientId')).toBe('12');
    expect(projectsReq.request.params.get('locationId')).toBe('30');
    expect(projectsReq.request.params.get('projectTypeId')).toBe('7');
    expect(projectsReq.request.params.get('includeClosed')).toBe('false');

    manufacturersReq.flush({ items: [], total: 0, page: 1, pageSize: 500 });
    projectsReq.flush({ items: [], total: 0, page: 1, pageSize: 500 });
    tick();

    expect(resultLength).toBe(0);
  }));

  it('separates /Projects requests when server-filterable params differ', () => {
    service.getProjects({ clientIds: ['12'] }).subscribe();
    service.getProjects({ clientIds: ['13'] }).subscribe();

    const manufacturerRequests = httpMock.match((req) => req.url.includes('/Manufacturers'));
    const projectRequests = httpMock.match((req) => req.url.includes('/Projects'));

    expect(manufacturerRequests.length).toBe(1);
    expect(projectRequests.length).toBe(2);
    expect(projectRequests.map((req) => req.request.params.get('clientId')).sort()).toEqual(['12', '13']);

    manufacturerRequests[0].flush({ items: [], total: 0, page: 1, pageSize: 500 });
    projectRequests.forEach((request) => request.flush({ items: [], total: 0, page: 1, pageSize: 500 }));
  });

  it('expands legacy location-based manufacturer filters through canonical manufacturer ids', fakeAsync(() => {
    let projectsLength = 0;

    service.getProjects({ manufacturerIds: ['30'] }).subscribe((projects) => {
      projectsLength = projects.length;
    });

    const manufacturersReq = httpMock.expectOne((req) => req.url.includes('/Manufacturers'));
    const projectsReq = httpMock.expectOne((req) => req.url.includes('/Projects'));

    manufacturersReq.flush({
      items: [
        {
          id: 8,
          manufacturerName: 'New Flyer',
          locationId: 30,
          locationIds: [30],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 500,
    });
    projectsReq.flush({
      items: [
        {
          id: 101,
          projectName: 'Project One',
          clientId: '12',
          clientName: 'Client One',
          assessmentType: 'Inspection',
          projectTypeId: 7,
          manufacturer: 'New Flyer',
          manufacturerLocationId: '30',
          locationId: 30,
          status: 'Open',
          closed: false,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 500,
    });
    tick();

    expect(projectsLength).toBe(1);
  }));
});
