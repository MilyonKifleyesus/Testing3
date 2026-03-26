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
    service['bulkEndpointUnavailable'] = false;
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

  // ─── getTimeLog ──────────────────────────────────────────────────────────────

  it('getTimeLog fetches a single log and normalizes field names', () => {
    let result: any;
    service.getTimeLog('101').subscribe((r) => (result = r));

    const req = httpMock.expectOne('/api/timelogs/101');
    expect(req.request.method).toBe('GET');

    req.flush({
      id: 101,
      dateStarted: '2026-03-10T08:00:00Z',
      timeSpent: 8.5,
      description: 'Inspection work',
      projectId: 5,
      projectName: 'SR2838',
      vehicleId: 12,
      fleetNumber: 'Bus-12',
      typeOfTimeId: 3,
      userId: 7,
      username: 'Taylor',
      dateUpdated: '2026-03-10T09:00:00Z',
    });

    expect(result).toEqual(
      jasmine.objectContaining({
        id: '101',
        startDate: '2026-03-10T08:00:00Z',
        spentTimeHours: 8.5,
        description: 'Inspection work',
        projectId: '5',
        projectName: 'SR2838',
        vehicleId: '12',
        vehicleFleetNumber: 'Bus-12',
        typeOfTime: 'Production',
        userId: '7',
        userName: 'Taylor',
        createdAt: '2026-03-10T09:00:00Z',
      })
    );
  });

  // ─── createTimeLog ───────────────────────────────────────────────────────────

  it('createTimeLog posts mapped payload and normalizes the response', () => {
    let result: any;
    service.createTimeLog(basePayload).subscribe((r) => (result = r));

    const req = httpMock.expectOne('/api/timelogs');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      projectId: 10,
      vehicleId: 20,
      userId: 30,
      typeOfTimeId: 3,
      timeSpent: 2.5,
      description: 'Assembly support',
      dateStarted: '2026-03-10T09:30',
    });

    req.flush({ id: 55, dateStarted: '2026-03-10T09:30', timeSpent: 2.5, projectId: 10, vehicleId: 20, userId: 30, typeOfTimeId: 3 });
    expect(result.id).toBe('55');
    expect(result.typeOfTime).toBe('Production');
  });

  it('createTimeLog throws when vehicleId is empty', () => {
    expect(() => service.createTimeLog({ ...basePayload, vehicleId: '' })).toThrowError('Invalid vehicleId value');
    httpMock.expectNone('/api/timelogs');
  });

  it('createTimeLog throws when userId is empty', () => {
    expect(() => service.createTimeLog({ ...basePayload, userId: '' })).toThrowError('Invalid userId value');
    httpMock.expectNone('/api/timelogs');
  });

  // ─── updateTimeLog ───────────────────────────────────────────────────────────

  it('updateTimeLog sends only the fields present in the partial payload', () => {
    let result: any;
    service.updateTimeLog('101', { description: 'Updated desc', spentTimeHours: 4 }).subscribe((r) => (result = r));

    const req = httpMock.expectOne('/api/timelogs/101');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ description: 'Updated desc', timeSpent: 4 });
    expect(req.request.body.projectId).toBeUndefined();

    req.flush({ id: 101, dateStarted: '2026-03-10T08:00:00Z', timeSpent: 4, projectId: 5, vehicleId: 12, userId: 7, typeOfTimeId: 6, description: 'Updated desc' });
    expect(result.typeOfTime).toBe('Sign Off');
    expect(result.spentTimeHours).toBe(4);
  });

  it('updateTimeLog maps all fields when all are provided', () => {
    service.updateTimeLog('99', {
      projectId: '5',
      vehicleId: '12',
      userId: '7',
      typeOfTime: 'Buybacks',
      startDate: '2026-04-01T08:00',
      spentTimeHours: 3,
      description: 'Rework',
    }).subscribe();

    const req = httpMock.expectOne('/api/timelogs/99');
    expect(req.request.body).toEqual({
      projectId: 5,
      vehicleId: 12,
      userId: 7,
      typeOfTimeId: 4,
      timeSpent: 3,
      description: 'Rework',
      dateStarted: '2026-04-01T08:00',
    });

    req.flush({ id: 99, dateStarted: '2026-04-01T08:00', timeSpent: 3, projectId: 5, vehicleId: 12, userId: 7, typeOfTimeId: 4 });
  });

  // ─── deleteTimeLog ───────────────────────────────────────────────────────────

  it('deleteTimeLog sends DELETE to the correct endpoint', () => {
    let completed = false;
    service.deleteTimeLog('101').subscribe(() => (completed = true));

    const req = httpMock.expectOne('/api/timelogs/101');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);

    expect(completed).toBeTrue();
  });

  // ─── bulkCreateTimeLogs – success path ───────────────────────────────────────

  it('returns all-success result when the bulk endpoint responds with 200', () => {
    let result: any;
    service.bulkCreateTimeLogs([basePayload, { ...basePayload, projectId: '11' }]).subscribe((r) => (result = r));

    const req = httpMock.expectOne('/api/timelogs/bulk');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.length).toBe(2);
    req.flush(null);

    expect(result).toEqual({ successCount: 2, failureCount: 0, errors: [] });
  });

  it('falls back to sequential when bulk returns 405', () => {
    let result: any;
    service.bulkCreateTimeLogs([basePayload]).subscribe((r) => (result = r));

    const bulkReq = httpMock.expectOne('/api/timelogs/bulk');
    bulkReq.flush({}, { status: 405, statusText: 'Method Not Allowed' });

    const singleReq = httpMock.expectOne((r) => r.url === '/api/timelogs');
    singleReq.flush({ id: 200, dateStarted: '2026-03-10T09:30', timeSpent: 2.5, projectId: 10, vehicleId: 20, userId: 30, typeOfTimeId: 3 });

    expect(result).toEqual({ successCount: 1, failureCount: 0, errors: [] });
  });

  it('returns zero counts and empty errors for an empty payload array', () => {
    let result: any;
    // When bulk endpoint is unavailable (remembered from prior test runs), empty array goes straight to sequential
    service.bulkCreateTimeLogs([]).subscribe((r) => (result = r));

    // bulk endpoint may or may not be called depending on state; handle both:
    const bulkPending = httpMock.match('/api/timelogs/bulk');
    if (bulkPending.length) {
      bulkPending[0].flush({});
    }
    httpMock.expectNone((r) => r.url === '/api/timelogs' && r.method === 'POST');

    expect(result).toEqual({ successCount: 0, failureCount: 0, errors: [] });
  });

  it('formats server-error rows correctly in sequential fallback', () => {
    let result: any;
    // Use a fresh service state where bulk is unknown
    service.bulkCreateTimeLogs([basePayload]).subscribe((r) => (result = r));

    const bulkPending = httpMock.match('/api/timelogs/bulk');
    if (bulkPending.length) {
      bulkPending[0].flush({}, { status: 404, statusText: 'Not Found' });
    }

    const singleReq = httpMock.expectOne((r) => r.url === '/api/timelogs' && r.method === 'POST');
    singleReq.flush({ message: 'Internal failure' }, { status: 500, statusText: 'Server Error' });

    expect(result.failureCount).toBe(1);
    expect(result.errors[0]).toMatch(/^Row 1: Server error \(500\)/);
  });

  // ─── Sort-field mapping ───────────────────────────────────────────────────────

  it('maps spentTimeHours → timeSpent sort param', () => {
    service.getTimeLogs({ page: 1, pageSize: 25, sortBy: 'spentTimeHours', sortDirection: 'asc' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/timelogs');
    expect(req.request.params.get('sortBy')).toBe('timeSpent');
    req.flush([]);
  });

  it('maps typeOfTime → typeOfTimeId sort param', () => {
    service.getTimeLogs({ page: 1, pageSize: 25, sortBy: 'typeOfTime', sortDirection: 'asc' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/timelogs');
    expect(req.request.params.get('sortBy')).toBe('typeOfTimeId');
    req.flush([]);
  });

  it('maps projectName → projectName (passes through unchanged)', () => {
    service.getTimeLogs({ page: 1, pageSize: 25, sortBy: 'projectName', sortDirection: 'asc' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/timelogs');
    expect(req.request.params.get('sortBy')).toBe('projectName');
    req.flush([]);
  });

  // ─── typeOfTime ID mapping ────────────────────────────────────────────────────

  it('maps all typeOfTime labels to their correct API typeOfTimeId values', () => {
    const cases: [string, string][] = [
      ['First Property Inspection', '2'],
      ['Production', '3'],
      ['Buybacks', '4'],
      ['Road/Water Test', '5'],
      ['Sign Off', '6'],
      ['Other', '7'],
    ];

    for (const [label, expectedId] of cases) {
      service.getTimeLogs({ page: 1, pageSize: 25, sortBy: 'startDate', sortDirection: 'asc', typeOfTime: label }).subscribe();
      const req = httpMock.expectOne((r) => r.url === '/api/timelogs');
      expect(req.request.params.get('typeOfTimeId')).withContext(`${label}`).toBe(expectedId);
      req.flush([]);
    }
  });

  it('maps typeOfTimeId numbers in responses back to UI labels', () => {
    let result: any;
    service.getTimeLogs({ page: 1, pageSize: 25, sortBy: 'startDate', sortDirection: 'asc' }).subscribe((r) => (result = r));
    const req = httpMock.expectOne((r) => r.url === '/api/timelogs');
    req.flush([
      { id: '1', typeOfTimeId: 2 },
      { id: '2', typeOfTimeId: 3 },
      { id: '3', typeOfTimeId: 4 },
      { id: '4', typeOfTimeId: 5 },
      { id: '5', typeOfTimeId: 6 },
      { id: '6', typeOfTimeId: 99 },
    ]);

    expect(result.items[0].typeOfTime).toBe('First Property Inspection');
    expect(result.items[1].typeOfTime).toBe('Production');
    expect(result.items[2].typeOfTime).toBe('Buybacks');
    expect(result.items[3].typeOfTime).toBe('Road/Water Test');
    expect(result.items[4].typeOfTime).toBe('Sign Off');
    expect(result.items[5].typeOfTime).toBe('Other');
  });

  // ─── extractItems envelope variants ──────────────────────────────────────────

  it('extracts items from { data: { items: [...] } } envelope', () => {
    let result: any;
    service.getTimeLogs({ page: 1, pageSize: 25, sortBy: 'startDate', sortDirection: 'asc' }).subscribe((r) => (result = r));
    const req = httpMock.expectOne((r) => r.url === '/api/timelogs');
    req.flush({ data: { items: [{ id: '9', dateStarted: '2026-01-01T00:00:00Z', timeSpent: 1 }] }, total: 1 });

    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe('9');
  });

  it('extracts items from { data: [...] } envelope', () => {
    let result: any;
    service.getTimeLogs({ page: 1, pageSize: 25, sortBy: 'startDate', sortDirection: 'asc' }).subscribe((r) => (result = r));
    const req = httpMock.expectOne((r) => r.url === '/api/timelogs');
    req.flush({ data: [{ id: '10', dateStarted: '2026-01-02T00:00:00Z', timeSpent: 2 }], total: 1 });

    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe('10');
  });

  it('extracts items from { result: { items: [...] } } envelope', () => {
    let result: any;
    service.getTimeLogs({ page: 1, pageSize: 25, sortBy: 'startDate', sortDirection: 'asc' }).subscribe((r) => (result = r));
    const req = httpMock.expectOne((r) => r.url === '/api/timelogs');
    req.flush({ result: { items: [{ id: '11', dateStarted: '2026-01-03T00:00:00Z', timeSpent: 3 }] }, total: 1 });

    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe('11');
  });

  // ─── clientId filter param ────────────────────────────────────────────────────

  it('sends clientId as a query param when provided in the filter', () => {
    service.getTimeLogs({ page: 1, pageSize: 25, sortBy: 'startDate', sortDirection: 'asc', clientId: '42' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/timelogs');
    expect(req.request.params.get('clientId')).toBe('42');
    req.flush([]);
  });

  it('omits clientId from query params when not provided', () => {
    service.getTimeLogs({ page: 1, pageSize: 25, sortBy: 'startDate', sortDirection: 'asc' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/timelogs');
    expect(req.request.params.has('clientId')).toBeFalse();
    req.flush([]);
  });
});
