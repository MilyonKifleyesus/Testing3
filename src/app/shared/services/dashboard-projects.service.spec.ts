import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { DashboardProjectsService } from './dashboard-projects.service';

describe('DashboardProjectsService', () => {
  let service: DashboardProjectsService;
  let httpMock: HttpTestingController;

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

  it('getTicketCreationActivity reuses the same ticket download across date-range filters', async () => {
    const firstPromise = firstValueFrom(service.getTicketCreationActivity({
      includeClosed: false,
      startDate: '2026-03-02',
      endDate: '2026-03-03',
    }));
    const secondPromise = firstValueFrom(service.getTicketCreationActivity({
      includeClosed: false,
      startDate: '2026-03-03',
      endDate: '2026-03-03',
    }));

    const req = httpMock.expectOne((request) => request.url.endsWith('/Tickets'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('includeClosed')).toBe('false');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.has('startDate')).toBeFalse();
    expect(req.request.params.has('endDate')).toBeFalse();

    req.flush({
      items: [
        { projectId: 10, createdAt: '2026-03-01T09:00:00Z' },
        { projectId: 10, createdAt: '2026-03-02T09:00:00Z' },
        { projectId: 11, createdAt: '2026-03-03T09:00:00Z' },
      ],
      total: 3,
      page: 1,
      pageSize: 10000,
    });

    httpMock.expectNone((request) => request.url.endsWith('/Tickets'));

    await expectAsync(firstPromise).toBeResolvedTo(jasmine.objectContaining({
      totalTickets: 2,
      activeDays: 2,
      spanDays: 2,
      projectCount: 2,
    }));
    await expectAsync(secondPromise).toBeResolvedTo(jasmine.objectContaining({
      totalTickets: 1,
      activeDays: 1,
      spanDays: 1,
      projectCount: 1,
    }));
  });
});
