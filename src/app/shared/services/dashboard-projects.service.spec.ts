import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { DashboardProjectsService } from './dashboard-projects.service';
import { environment } from '../../../environments/environment';

describe('DashboardProjectsService', () => {
  let service: DashboardProjectsService;
  let httpMock: HttpTestingController;
  const originalApiPagedFetchPageSize = environment.apiPagedFetchPageSize;
  const originalApiPagedFetchMaxPages = environment.apiPagedFetchMaxPages;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DashboardProjectsService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(DashboardProjectsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    // Restore any environment mutations performed by specific tests.
    (environment as any).apiPagedFetchPageSize = originalApiPagedFetchPageSize;
    (environment as any).apiPagedFetchMaxPages = originalApiPagedFetchMaxPages;
  });

  it('getStationTrackersPage sends StationTrackers filters with pageNumber and pageSize', () => {
    let result: any;

    service.getStationTrackersPage({
      projectId: 12,
      vehicleId: 44,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      pageNumber: 3,
      pageSize: 250,
      refresh: true,
    }).subscribe((value) => {
      result = value;
    });

    const req = httpMock.expectOne((request) => request.url.endsWith('/StationTrackers'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('projectId')).toBe('12');
    expect(req.request.params.get('vehicleId')).toBe('44');
    expect(req.request.params.get('startDate')).toBe('2026-03-01');
    expect(req.request.params.get('endDate')).toBe('2026-03-31');
    expect(req.request.params.get('pageNumber')).toBe('3');
    expect(req.request.params.get('pageSize')).toBe('250');
    expect(req.request.params.has('page')).toBeFalse();

    req.flush({
      items: [{ id: 1 }],
      totalCount: 600,
      pageNumber: 3,
      pageSize: 250,
    });

    expect(result).toEqual({
      items: [{ id: 1 }],
      totalCount: 600,
      pageNumber: 3,
      pageSize: 250,
      hasMore: false,
    });
  });

  it('getAllStationTrackers fetches subsequent pages until the final page', async () => {
    const resultPromise = firstValueFrom(service.getAllStationTrackers({
      projectId: 12,
      vehicleId: 44,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      pageSize: 2,
      refresh: true,
    }));

    const page1 = httpMock.expectOne((request) =>
      request.url.endsWith('/StationTrackers') &&
      request.params.get('pageNumber') === '1' &&
      request.params.get('pageSize') === '2',
    );
    page1.flush({
      items: [{ id: 1 }, { id: 2 }],
      totalCount: 5,
      pageNumber: 1,
      pageSize: 2,
    });
    await Promise.resolve();

    const page2 = httpMock.expectOne((request) =>
      request.url.endsWith('/StationTrackers') &&
      request.params.get('pageNumber') === '2' &&
      request.params.get('pageSize') === '2',
    );
    page2.flush({
      items: [{ id: 3 }, { id: 4 }],
      totalCount: 5,
      pageNumber: 2,
      pageSize: 2,
    });
    await Promise.resolve();

    const page3 = httpMock.expectOne((request) =>
      request.url.endsWith('/StationTrackers') &&
      request.params.get('pageNumber') === '3' &&
      request.params.get('pageSize') === '2',
    );
    page3.flush({
      items: [{ id: 5 }],
      totalCount: 5,
      pageNumber: 3,
      pageSize: 2,
    });

    await expectAsync(resultPromise).toBeResolvedTo([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
    ]);
  });

  it('getTicketCreationActivity passes date filters into the /Tickets request', async () => {
    const firstPromise = firstValueFrom(service.getTicketCreationActivity({
      includeClosed: false,
      startDate: '2026-03-02',
      endDate: '2026-03-03',
    }));

    const req1 = httpMock.expectOne((request) => request.url.endsWith('/Tickets'));
    expect(req1.request.method).toBe('GET');
    expect(req1.request.params.get('includeClosed')).toBe('false');
    expect(req1.request.params.get('page')).toBe('1');
    expect(req1.request.params.get('startDate')).toBe('2026-03-02');
    expect(req1.request.params.get('endDate')).toBe('2026-03-03');

    req1.flush({
      items: [
        { projectId: 10, createdAt: '2026-03-02T09:00:00Z' },
        { projectId: 11, createdAt: '2026-03-03T09:00:00Z' },
      ],
      total: 2,
      page: 1,
      pageSize: 10000,
    });

    const firstResult = await firstPromise;
    expect(firstResult).toEqual(jasmine.objectContaining({
      totalTickets: 2,
      activeDays: 2,
      spanDays: 2,
      projectCount: 2,
    }));

    const secondPromise = firstValueFrom(service.getTicketCreationActivity({
      includeClosed: false,
      startDate: '2026-03-03',
      endDate: '2026-03-03',
    }));

    const req2 = httpMock.expectOne((request) => request.url.endsWith('/Tickets'));
    expect(req2.request.params.get('includeClosed')).toBe('false');
    expect(req2.request.params.get('page')).toBe('1');
    expect(req2.request.params.get('startDate')).toBe('2026-03-03');
    expect(req2.request.params.get('endDate')).toBe('2026-03-03');

    req2.flush({
      items: [
        { projectId: 11, createdAt: '2026-03-03T09:00:00Z' },
      ],
      total: 1,
      page: 1,
      pageSize: 10000,
    });

    const secondResult = await secondPromise;
    expect(secondResult).toEqual(jasmine.objectContaining({
      totalTickets: 1,
      activeDays: 1,
      spanDays: 1,
      projectCount: 1,
    }));
  });

  it('caps ticket activity pagination by apiPagedFetchMaxPages', async () => {
    // Force the service to only fetch 2 pages even though `total` implies more.
    (environment as any).apiPagedFetchMaxPages = 2;

    const resultPromise = firstValueFrom(service.getTicketCreationActivity({
      includeClosed: false,
      startDate: '2026-03-01',
      endDate: '2026-03-03',
    }));

    // total=30000 with pageSize=10000 implies 3 pages, but maxPages=2 should cap it.
    const page1 = httpMock.expectOne((request) => {
      return request.url.endsWith('/Tickets') && request.params.get('page') === '1';
    });
    expect(page1.request.params.get('includeClosed')).toBe('false');
    expect(page1.request.params.get('pageSize')).toBe('10000');
    // Provide only a couple items; the important part is that `total` implies more pages.
    page1.flush({
      items: [
        { projectId: 10, createdAt: '2026-03-01T09:00:00Z' },
        { projectId: 10, createdAt: '2026-03-02T09:00:00Z' },
      ],
      total: 30000,
      page: 1,
      pageSize: 10000,
    });
    await Promise.resolve();

    const page2 = httpMock.expectOne((request) => {
      return request.url.endsWith('/Tickets') && request.params.get('page') === '2';
    });
    page2.flush({
      items: [
        { projectId: 10, createdAt: '2026-03-02T10:00:00Z' },
        { projectId: 11, createdAt: '2026-03-03T10:00:00Z' },
      ],
      total: 30000,
      page: 2,
      pageSize: 10000,
    });

    const result = await resultPromise;

    // If a 3rd page were fetched, totalTickets would be larger than the 4 items provided above.
    expect(result.totalTickets).toBe(4);
    expect(result.activeDays).toBe(3);
    expect(result.projectCount).toBe(2);
  });

  it('retries transient ticket activity page failures once', fakeAsync(() => {
    let result: any;

    firstValueFrom(service.getTicketCreationActivity({
      includeClosed: false,
      startDate: '2026-03-01',
      endDate: '2026-03-02',
    })).then((value) => {
      result = value;
    });

    const page1 = httpMock.expectOne((request) =>
      request.url.endsWith('/Tickets') && request.params.get('page') === '1',
    );
    page1.flush({
      items: [
        { projectId: 10, createdAt: '2026-03-01T09:00:00Z' },
      ],
      total: 10001,
      page: 1,
      pageSize: 10000,
    });

    tick();

    const page2 = httpMock.expectOne((request) =>
      request.url.endsWith('/Tickets') && request.params.get('page') === '2',
    );
    page2.error(new ProgressEvent('error'));

    tick(300);

    const page2Retry = httpMock.expectOne((request) =>
      request.url.endsWith('/Tickets') && request.params.get('page') === '2',
    );
    page2Retry.flush({
      items: [
        { projectId: 11, createdAt: '2026-03-02T09:00:00Z' },
      ],
      total: 10001,
      page: 2,
      pageSize: 10000,
    });

    tick();

    expect(result).toEqual(jasmine.objectContaining({
      totalTickets: 2,
      activeDays: 2,
      projectCount: 2,
    }));
  }));

  it('getTicketsByVehicleData aggregates filtered ticket pages by vehicle status', async () => {
    (environment as any).apiPagedFetchPageSize = 200;

    const resultPromise = firstValueFrom(service.getTicketsByVehicleData({
      clientId: 7,
      projectId: '12',
      includeClosed: false,
    }));

    const page1 = httpMock.expectOne((request) =>
      request.url.endsWith('/Tickets') &&
      request.params.get('clientId') === '7' &&
      request.params.get('projectId') === '12' &&
      request.params.get('includeClosed') === 'false' &&
      request.params.get('page') === '1',
    );
    expect(page1.request.params.get('pageSize')).toBe('200');
    page1.flush({
      items: [
        { vehicleId: 1, fleetNumber: 'Bus-01', statusTicketName: 'Open' },
        ...Array.from({ length: 199 }, () => ({
          vehicleId: 2,
          fleetNumber: 'Bus-02',
          statusTicketName: 'Pending Review',
        })),
      ],
      total: 201,
      page: 1,
      pageSize: 200,
    });
    await Promise.resolve();

    const page2 = httpMock.expectOne((request) =>
      request.url.endsWith('/Tickets') &&
      request.params.get('page') === '2',
    );
    page2.flush({
      items: [
        { vehicleId: 1, fleetNumber: 'Bus-01', statusTicketName: 'Closed' },
      ],
      total: 201,
      page: 2,
      pageSize: 200,
    });

    await expectAsync(resultPromise).toBeResolvedTo({
      ticketsByVehicle: [
        { vehicleName: 'Bus-02', openCount: 199, closedCount: 0 },
        { vehicleName: 'Bus-01', openCount: 1, closedCount: 1 },
      ],
    });
  });

  it('retries transient tickets-by-vehicle page failures once', fakeAsync(() => {
    let result: any;
    (environment as any).apiPagedFetchPageSize = 200;

    firstValueFrom(service.getTicketsByVehicleData({
      clientId: 7,
      projectId: '12',
      includeClosed: false,
    })).then((value) => {
      result = value;
    });

    const page1 = httpMock.expectOne((request) =>
      request.url.endsWith('/Tickets') &&
      request.params.get('projectId') === '12' &&
      request.params.get('page') === '1',
    );
    page1.flush({
      items: [
        { vehicleId: 1, fleetNumber: 'Bus-01', statusTicketName: 'Open' },
        ...Array.from({ length: 199 }, () => ({
          vehicleId: 2,
          fleetNumber: 'Bus-02',
          statusTicketName: 'Pending Review',
        })),
      ],
      total: 201,
      page: 1,
      pageSize: 200,
    });

    tick();

    const page2 = httpMock.expectOne((request) =>
      request.url.endsWith('/Tickets') && request.params.get('page') === '2',
    );
    page2.error(new ProgressEvent('error'));

    tick(300);

    const page2Retry = httpMock.expectOne((request) =>
      request.url.endsWith('/Tickets') && request.params.get('page') === '2',
    );
    page2Retry.flush({
      items: [
        { vehicleId: 1, fleetNumber: 'Bus-01', statusTicketName: 'Closed' },
      ],
      total: 201,
      page: 2,
      pageSize: 200,
    });

    tick();

    expect(result).toEqual({
      ticketsByVehicle: [
        { vehicleName: 'Bus-02', openCount: 199, closedCount: 0 },
        { vehicleName: 'Bus-01', openCount: 1, closedCount: 1 },
      ],
    });
  }));
});
