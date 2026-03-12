import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { TimeLogPayload } from '../models/time-log.model';
import { TimeLogService } from './time-log.service';

describe('TimeLogService', () => {
  let service: TimeLogService;
  let httpMock: HttpTestingController;

  const basePayload: TimeLogPayload = {
    projectId: '10',
    vehicleId: '20',
    userId: '30',
    typeOfTime: 'Production',
    startDate: '2026-03-10T09:30',
    spentTimeHours: 2.5,
    description: 'Assembly support',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TimeLogService, provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(TimeLogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('maps list filters to API params and normalizes plain-array responses', () => {
    let actual: any;

    service
      .getTimeLogs({
        page: 2,
        pageSize: 1,
        sortBy: 'startDate',
        sortDirection: 'desc',
        projectId: '10',
        vehicleId: '20',
        userId: '30',
        typeOfTime: 'Road/Water Test',
        fromDate: '2026-03-01',
        toDate: '2026-03-31',
        searchTerm: 'axle',
      })
      .subscribe((result) => {
        actual = result;
      });

    const req = httpMock.expectOne((request) => request.url === '/api/timelogs');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('1');
    expect(req.request.params.get('sortBy')).toBe('dateStarted');
    expect(req.request.params.get('sortDirection')).toBe('desc');
    expect(req.request.params.get('projectId')).toBe('10');
    expect(req.request.params.get('vehicleId')).toBe('20');
    expect(req.request.params.get('userId')).toBe('30');
    expect(req.request.params.get('typeOfTimeId')).toBe('5');
    expect(req.request.params.get('fromDate')).toBe('2026-03-01');
    expect(req.request.params.get('toDate')).toBe('2026-03-31');
    expect(req.request.params.get('searchTerm')).toBe('axle');

    req.flush([
      {
        id: 1,
        dateStarted: '2026-03-01T08:00:00Z',
        timeSpent: '1.25',
        description: 'Prep',
        projectId: 10,
        projectName: 'Project A',
        vehicleId: 20,
        fleetNumber: 'V100',
        typeOfTime: 'Production',
        userId: 30,
        username: 'Taylor',
      },
      {
        id: 2,
        dateStarted: '2026-03-02T08:00:00Z',
        timeSpent: '3.5',
        description: 'Road test',
        projectId: 11,
        projectName: 'Project B',
        vehicleId: 21,
        fleetNumber: 'V200',
        typeOfTimeId: 5,
        userId: 31,
        username: 'Alex',
        dateUpdated: '2026-03-02T10:00:00Z',
      },
    ]);

    expect(actual.total).toBe(2);
    expect(actual.items.length).toBe(1);
    expect(actual.items[0]).toEqual(
      jasmine.objectContaining({
        id: '2',
        startDate: '2026-03-02T08:00:00Z',
        spentTimeHours: 3.5,
        vehicleFleetNumber: 'V200',
        typeOfTime: 'Road/Water Test',
        userId: '31',
        userName: 'Alex',
        createdAt: '2026-03-02T10:00:00Z',
      })
    );
  });

  it('normalizes nested envelope responses and guards invalid totals', () => {
    let actual: any;

    service
      .getTimeLogs({
        page: 1,
        pageSize: 25,
        sortBy: 'userName',
        sortDirection: 'asc',
      })
      .subscribe((result) => {
        actual = result;
      });

    const req = httpMock.expectOne((request) => request.url === '/api/timelogs');
    expect(req.request.params.get('sortBy')).toBe('userId');

    req.flush({
      data: {
        items: [
          { id: '7', startDate: '2026-03-03T12:00:00Z', spentTimeHours: 1, userName: 'Morgan' },
          { id: '8', startDate: '2026-03-04T12:00:00Z', spentTimeHours: '2', typeOfTimeId: 4 },
        ],
      },
      total: 1,
    });

    expect(actual.total).toBe(2);
    expect(actual.items[0].userName).toBe('Morgan');
    expect(actual.items[1].typeOfTime).toBe('Buybacks');
  });

  it('falls back to sequential create calls when bulk submit is unavailable and remembers the fallback', () => {
    const firstPayloads: TimeLogPayload[] = [
      basePayload,
      { ...basePayload, projectId: '11', vehicleId: '21', userId: '31', description: 'Rework' },
    ];
    let firstResult: any;

    service.bulkCreateTimeLogs(firstPayloads).subscribe((result) => {
      firstResult = result;
    });

    const bulkReq = httpMock.expectOne((request) => request.url === '/api/timelogs/bulk');
    expect(bulkReq.request.method).toBe('POST');
    bulkReq.flush({}, { status: 404, statusText: 'Not Found' });

    const createRequests = httpMock.match((request) => request.url === '/api/timelogs');
    expect(createRequests.length).toBe(2);
    expect(createRequests[0].request.body).toEqual(
      jasmine.objectContaining({
        projectId: 10,
        vehicleId: 20,
        userId: 30,
        typeOfTimeId: 3,
        timeSpent: 2.5,
      })
    );

    createRequests[0].flush({
      id: 1,
      dateStarted: '2026-03-10T09:30',
      timeSpent: 2.5,
      projectId: 10,
      vehicleId: 20,
      userId: 30,
      typeOfTimeId: 3,
    });
    createRequests[1].flush(
      { message: 'Bad row' },
      { status: 400, statusText: 'Bad Request' }
    );

    expect(firstResult).toEqual({
      successCount: 1,
      failureCount: 1,
      errors: ['Row 2: API validation failed (400): Bad row'],
    });

    let secondResult: any;
    service.bulkCreateTimeLogs([basePayload]).subscribe((result) => {
      secondResult = result;
    });

    httpMock.expectNone('/api/timelogs/bulk');
    const singleCreateReq = httpMock.expectOne((request) => request.url === '/api/timelogs');
    singleCreateReq.flush({
      id: 9,
      dateStarted: '2026-03-10T09:30',
      timeSpent: 2.5,
      projectId: 10,
      vehicleId: 20,
      userId: 30,
      typeOfTimeId: 3,
    });

    expect(secondResult).toEqual({
      successCount: 1,
      failureCount: 0,
      errors: [],
    });
  });

  it('throws before issuing HTTP requests when required ids are invalid', () => {
    expect(() =>
      service.createTimeLog({ ...basePayload, projectId: '' })
    ).toThrowError('Invalid projectId value');

    httpMock.expectNone('/api/timelogs');
  });
});
