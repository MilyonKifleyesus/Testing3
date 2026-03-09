import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProjectService } from './project.service';
import { Project } from '../models/project.model';
import { ClientService } from './client.service';
import { LocationService } from './location.service';

describe('ProjectService.getProjectsForMap', () => {
  it('prefers `loc-<id>` when available in factory coordinates', (done) => {
    const service = new ProjectService({} as any, {} as any, {} as any);
    spyOn(service, 'getProjectsWithRefresh').and.returnValue(of([
      {
        id: 1,
        projectName: 'Project 1',
        clientId: '1',
        assessmentType: 'New Build',
        manufacturerLocationId: '123',
        status: 'Open',
      } satisfies Project,
    ]));

    const clientCoordinates = new Map([
      ['1', { latitude: 10, longitude: 20 }],
    ]);
    const factoryCoordinates = new Map<string, { latitude: number; longitude: number }>([
      ['123', { latitude: 30, longitude: 40 }],
      ['loc-123', { latitude: 50, longitude: 60 }],
    ]);

    service.getProjectsForMap(clientCoordinates, factoryCoordinates, {}).subscribe((routes) => {
      expect(routes.length).toBe(1);
      expect(routes[0].toNodeId).toBe('loc-123');
      expect(routes[0].toCoordinates).toEqual({ latitude: 50, longitude: 60 });
      done();
    });
  });

  it('falls back to raw numeric id when `loc-<id>` is not present', (done) => {
    const service = new ProjectService({} as any, {} as any, {} as any);
    spyOn(service, 'getProjectsWithRefresh').and.returnValue(of([
      {
        id: 2,
        projectName: 'Project 2',
        clientId: '1',
        assessmentType: 'New Build',
        manufacturerLocationId: '123',
        status: 'Open',
      } satisfies Project,
    ]));

    const clientCoordinates = new Map([
      ['1', { latitude: 10, longitude: 20 }],
    ]);
    const factoryCoordinates = new Map<string, { latitude: number; longitude: number }>([
      ['123', { latitude: 30, longitude: 40 }],
    ]);

    service.getProjectsForMap(clientCoordinates, factoryCoordinates, {}).subscribe((routes) => {
      expect(routes.length).toBe(1);
      expect(routes[0].toNodeId).toBe('123');
      expect(routes[0].toCoordinates).toEqual({ latitude: 30, longitude: 40 });
      done();
    });
  });

  it('creates one route per project location id with stable route ids', (done) => {
    const service = new ProjectService({} as any, {} as any, {} as any);
    spyOn(service, 'getProjectsWithRefresh').and.returnValue(of([
      {
        id: 7,
        projectName: 'Project Multi',
        clientId: '1',
        assessmentType: 'New Build',
        locationIds: [30, 31],
        status: 'Open',
      } satisfies Project,
    ]));

    const clientCoordinates = new Map([
      ['1', { latitude: 10, longitude: 20 }],
    ]);
    const factoryCoordinates = new Map<string, { latitude: number; longitude: number }>([
      ['loc-30', { latitude: 30, longitude: 40 }],
      ['loc-31', { latitude: 31, longitude: 41 }],
    ]);

    service.getProjectsForMap(clientCoordinates, factoryCoordinates, {}).subscribe((routes) => {
      expect(routes.length).toBe(2);
      const ids = routes.map((route) => route.id).sort();
      expect(ids).toEqual(['project-route-7-loc-30', 'project-route-7-loc-31']);
      done();
    });
  });

  it('normalizes client and factory ids when resolving coordinates', (done) => {
    const service = new ProjectService({} as any, {} as any, {} as any);
    spyOn(service, 'getProjectsWithRefresh').and.returnValue(of([
      {
        id: 3,
        projectName: 'Project 3',
        clientId: '001',
        assessmentType: 'Retrofit',
        manufacturerLocationId: 'source-loc-000123',
        status: 'Open',
      } satisfies Project,
    ]));

    const clientCoordinates = new Map([
      ['1', { latitude: 11, longitude: 22 }],
    ]);
    const factoryCoordinates = new Map<string, { latitude: number; longitude: number }>([
      ['loc-123', { latitude: 33, longitude: 44 }],
    ]);

    service.getProjectsForMap(clientCoordinates, factoryCoordinates, {}).subscribe((routes) => {
      expect(routes.length).toBe(1);
      expect(routes[0].fromNodeId).toBe('1');
      expect(routes[0].toNodeId).toBe('loc-123');
      expect(routes[0].fromCoordinates).toEqual({ latitude: 11, longitude: 22 });
      expect(routes[0].toCoordinates).toEqual({ latitude: 33, longitude: 44 });
      done();
    });
  });

  it('falls back to locationId when manufacturerLocationId points to manufacturer id', (done) => {
    const service = new ProjectService({} as any, {} as any, {} as any);
    spyOn(service, 'getProjectsWithRefresh').and.returnValue(of([
      {
        id: 4,
        projectName: 'Project 4',
        clientId: '1',
        assessmentType: 'Retrofit',
        manufacturerLocationId: '8',
        locationId: '30',
        status: 'Open',
      } satisfies Project,
    ]));

    const clientCoordinates = new Map([
      ['1', { latitude: 11, longitude: 22 }],
    ]);
    const factoryCoordinates = new Map<string, { latitude: number; longitude: number }>([
      ['loc-30', { latitude: 33, longitude: 44 }],
      ['30', { latitude: 34, longitude: 45 }],
    ]);

    service.getProjectsForMap(clientCoordinates, factoryCoordinates, {}).subscribe((routes) => {
      expect(routes.length).toBe(1);
      expect(routes[0].toNodeId).toBe('loc-30');
      expect(routes[0].toCoordinates).toEqual({ latitude: 33, longitude: 44 });
      done();
    });
  });

  it('applies client filters using numeric-like id normalization', (done) => {
    const service = new ProjectService({} as any, {} as any, {} as any);
    spyOn(service, 'getProjectsWithRefresh').and.returnValue(of([
      {
        id: 5,
        projectName: 'Project 5',
        clientId: '001',
        assessmentType: 'Retrofit',
        manufacturerLocationId: '123',
        status: 'Open',
      } satisfies Project,
    ]));

    const clientCoordinates = new Map([
      ['1', { latitude: 11, longitude: 22 }],
    ]);
    const factoryCoordinates = new Map<string, { latitude: number; longitude: number }>([
      ['123', { latitude: 33, longitude: 44 }],
    ]);

    service.getProjectsForMap(clientCoordinates, factoryCoordinates, { clientIds: ['1'] }).subscribe((routes) => {
      expect(routes.length).toBe(1);
      expect(routes[0].fromNodeId).toBe('1');
      done();
    });
  });

  it('getClientOptionsWithCounts consolidates numeric-equivalent ids', (done) => {
    const service = new ProjectService({} as any, {} as any, {} as any);
    spyOn(service, 'getProjectsWithRefresh').and.returnValue(of([
      {
        id: 20,
        projectName: 'Project A',
        clientId: '001',
        clientName: '',
        assessmentType: 'New Build',
        manufacturerLocationId: '10',
        status: 'Open',
      } satisfies Project,
      {
        id: 21,
        projectName: 'Project B',
        clientId: '1',
        clientName: 'Electromin',
        assessmentType: 'New Build',
        manufacturerLocationId: '11',
        status: 'Open',
      } satisfies Project,
      {
        id: 22,
        projectName: 'Project C',
        clientId: '2',
        clientName: '54 Davies',
        assessmentType: 'New Build',
        manufacturerLocationId: '12',
        status: 'Open',
      } satisfies Project,
    ]));

    service.getClientOptionsWithCounts().subscribe((options) => {
      const clientOne = options.find((option) => option.id === '1');
      expect(clientOne).toBeTruthy();
      expect(clientOne?.count).toBe(2);
      expect(clientOne?.name).toBe('Electromin');
      done();
    });
  });

  it('getProjectsByManufacturerLocation filters from refreshed project stream', (done) => {
    const service = new ProjectService({} as any, {} as any, {} as any);
    const getProjectsWithRefreshSpy = spyOn(service, 'getProjectsWithRefresh').and.returnValue(of([
      {
        id: 10,
        projectName: 'Project A',
        clientId: '1',
        assessmentType: 'New Build',
        manufacturerLocationId: '30',
        status: 'Open',
      } satisfies Project,
      {
        id: 11,
        projectName: 'Project B',
        clientId: '1',
        assessmentType: 'New Build',
        manufacturerLocationId: '31',
        status: 'Open',
      } satisfies Project,
    ]));

    service.getProjectsByManufacturerLocation('30').subscribe((projects) => {
      expect(getProjectsWithRefreshSpy).toHaveBeenCalledWith({});
      expect(projects.length).toBe(1);
      expect(String(projects[0].id)).toBe('10');
      done();
    });
  });
});

describe('ProjectService.buildParentGroupsFromApi', () => {
  it('prefers manufacturer parsed from location name over manufacturer.locationId mapping', (done) => {
    const locationService = {
      getAllLocations: () =>
        of([
          {
            id: 13,
            name: 'Winnipeg-Crookston (New Flyer)',
            latitude: 47.77,
            longitude: -96.61,
          },
        ]),
    } as any;

    const service = new ProjectService({} as any, {} as any, locationService);

    spyOn(service as any, 'getManufacturersApi$').and.returnValue(
      of([
        {
          id: 2,
          manufacturerName: 'New Flyer',
          manufacturerLogo: null,
          locationId: 999,
          latitude: null,
          longitude: null,
        },
        {
          id: 77,
          manufacturerName: 'ENC',
          manufacturerLogo: null,
          locationId: 13,
          latitude: null,
          longitude: null,
        },
      ])
    );

    service.buildParentGroupsFromApi().subscribe((groups) => {
      expect(groups.length).toBe(1);
      const subsidiaries = groups[0].subsidiaries ?? [];
      const newFlyer = subsidiaries.find((s: any) => s.name === 'New Flyer');
      const enc = subsidiaries.find((s: any) => s.name === 'ENC');

      expect(newFlyer).toBeTruthy();
      expect((newFlyer as any).manufacturerLocations?.some((l: any) => l.id === 'loc-13')).toBeTrue();
      expect(enc?.manufacturerLocations?.some((l: any) => l.id === 'loc-13')).toBeFalse();
      done();
    });
  });
});

describe('ProjectService.updateManufacturer', () => {
  let service: ProjectService;
  let httpMock: HttpTestingController;
  let clientServiceSpy: jasmine.SpyObj<ClientService>;
  let locationServiceSpy: jasmine.SpyObj<LocationService>;

  beforeEach(() => {
    clientServiceSpy = jasmine.createSpyObj<ClientService>('ClientService', ['getClients']);
    locationServiceSpy = jasmine.createSpyObj<LocationService>('LocationService', ['getAllLocations']);
    clientServiceSpy.getClients.and.returnValue(of([] as any));
    locationServiceSpy.getAllLocations.and.returnValue(of([] as any));

    TestBed.configureTestingModule({
      providers: [
        ProjectService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ClientService, useValue: clientServiceSpy },
        { provide: LocationService, useValue: locationServiceSpy },
      ],
    });

    service = TestBed.inject(ProjectService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('keeps existing multi-locationIds when unchanged single locationId is provided', () => {
    service.updateManufacturer(25, {
      manufacturerName: 'OEM Updated',
      locationId: 500,
    }).subscribe((result) => {
      expect(result?.manufacturerName).toBe('OEM Updated');
    });

    const lookupReq = httpMock.expectOne('/api/Manufacturers/25');
    expect(lookupReq.request.method).toBe('GET');
    lookupReq.flush({
      id: 25,
      manufacturerName: 'OEM Existing',
      manufacturerLogo: null,
      manufacturerLogoName: null,
      locationId: 500,
      locations: [
        { id: 500, latitude: 10, longitude: 20 },
        { id: 501, latitude: 11, longitude: 21 },
      ],
    });

    const updateReq = httpMock.expectOne('/api/Manufacturers/25');
    expect(updateReq.request.method).toBe('PUT');
    expect(updateReq.request.body.locationIds).toEqual([500, 501]);
    updateReq.flush({});

    const verifyReq = httpMock.expectOne('/api/Manufacturers/25');
    expect(verifyReq.request.method).toBe('GET');
    verifyReq.flush({
      id: 25,
      manufacturerName: 'OEM Updated',
      manufacturerLogo: null,
      manufacturerLogoName: null,
      locationId: 500,
      locations: [
        { id: 500, latitude: 10, longitude: 20 },
        { id: 501, latitude: 11, longitude: 21 },
      ],
    });
  });

  it('updates to a new single locationId when location changes', () => {
    service.updateManufacturer(26, {
      manufacturerName: 'OEM Shifted',
      locationId: 700,
    }).subscribe((result) => {
      expect(result?.manufacturerName).toBe('OEM Shifted');
    });

    const lookupReq = httpMock.expectOne('/api/Manufacturers/26');
    lookupReq.flush({
      id: 26,
      manufacturerName: 'OEM Existing',
      manufacturerLogo: null,
      manufacturerLogoName: null,
      locationId: 600,
      locations: [
        { id: 600, latitude: 12, longitude: 22 },
        { id: 601, latitude: 13, longitude: 23 },
      ],
    });

    const updateReq = httpMock.expectOne('/api/Manufacturers/26');
    expect(updateReq.request.body.locationIds).toEqual([700]);
    updateReq.flush({});

    const verifyReq = httpMock.expectOne('/api/Manufacturers/26');
    verifyReq.flush({
      id: 26,
      manufacturerName: 'OEM Shifted',
      manufacturerLogo: null,
      manufacturerLogoName: null,
      locationId: 700,
      locations: [{ id: 700, latitude: 15, longitude: 25 }],
    });
  });

  it('retries manufacturer update once with stripped raw base64 logo when backend rejects data URL', () => {
    service.updateManufacturer(27, {
      manufacturerName: 'OEM Logo',
      manufacturerLogo: 'data:image/png;base64,UVdF',
      manufacturerLogoName: 'oem.png',
      locationIds: [700],
    }).subscribe();

    const lookupReq = httpMock.expectOne('/api/Manufacturers/27');
    lookupReq.flush({
      id: 27,
      manufacturerName: 'OEM Existing',
      manufacturerLogo: null,
      manufacturerLogoName: null,
      locationId: 700,
      locations: [{ id: 700, latitude: 15, longitude: 25 }],
    });

    const firstPut = httpMock.expectOne('/api/Manufacturers/27');
    expect(firstPut.request.body.manufacturerLogo).toBe('data:image/png;base64,UVdF');
    firstPut.flush(
      { title: 'Invalid logo format' },
      { status: 400, statusText: 'Bad Request' }
    );

    const fallbackPut = httpMock.expectOne('/api/Manufacturers/27');
    expect(fallbackPut.request.body.manufacturerLogo).toBe('UVdF');
    expect(fallbackPut.request.body.manufacturerLogoName).toBe('oem.png');
    fallbackPut.flush({});

    const verifyReq = httpMock.expectOne('/api/Manufacturers/27');
    verifyReq.flush({
      id: 27,
      manufacturerName: 'OEM Logo',
      manufacturerLogo: 'UVdF',
      manufacturerLogoName: 'oem.png',
      locationId: 700,
      locations: [{ id: 700, latitude: 15, longitude: 25 }],
    });
  });

  it('sends locationIds in project update payload', () => {
    service.updateProject({
      id: 101,
      projectName: 'Project API',
      clientId: '1000',
      assessmentType: 'Inspection',
      projectTypeId: 22,
      status: 'Open',
      locationIds: [30, 31],
    } as Project).subscribe();

    const updateReq = httpMock.expectOne('/api/Projects/101');
    expect(updateReq.request.method).toBe('PUT');
    expect(updateReq.request.body.locationIds).toEqual([30, 31]);
    updateReq.flush({});

    const manufacturersReq = httpMock.expectOne((request) =>
      request.url.toLowerCase() === '/api/manufacturers' ||
      request.url.toLowerCase().includes('/api/manufacturers?page=')
    );
    manufacturersReq.flush({ items: [] });

    const projectLookupReq = httpMock.expectOne('/api/Projects/101');
    projectLookupReq.flush({
      id: 101,
      name: 'Project API',
      clientId: 1000,
      projectTypeId: 22,
      projectTypeName: 'Inspection',
      locations: [{ id: 30, latitude: 40, longitude: -70 }],
      closed: false,
      lastUpdate: '2026-01-01T00:00:00Z',
    });
  });
});
