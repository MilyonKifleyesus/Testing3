import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TimeLogService } from './time-log.service';
import { TimeLogListParams, TimeLogPayload } from '../models/time-log.model';

describe('TimeLogService', () => {
  let service: TimeLogService;
  let httpMock: HttpTestingController;

  const listParams: TimeLogListParams = {
    page: 1,
    pageSize: 25,
    sortBy: 'startDate',
    sortDirection: 'desc',
    userId: '1004',
    typeOfTime: 'Road/Water Test',
  };

  const payload: TimeLogPayload = {
    projectId: '46',
    vehicleId: '1723',
    userId: '1004',
    typeOfTime: 'Road/Water Test',
    startDate: '2026-01-13T09:52:20',
    spentTimeHours: 3,
    description: 'R/t W/t and validation',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [TimeLogService],
    });
    service = TestBed.inject(TimeLogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('maps list API item to UI model and uses API query mapping', () => {
    let result: any;
    service.getTimeLogs(listParams).subscribe((res) => {
      result = res;
    });

    const req = httpMock.expectOne((r) => r.url === '/api/timelogs');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('sortBy')).toBe('dateStarted');
    expect(req.request.params.get('userId')).toBe('1004');
    expect(req.request.params.get('typeOfTimeId')).toBe('5');
    expect(req.request.url).not.toContain('assets/data/timelogs.json');

    req.flush({
      items: [
        {
          id: 10563,
          vehicleId: 1723,
          userId: 1004,
          projectId: 46,
          typeOfTimeId: 5,
          timeSpent: 3,
          description: 'R/t W/t and validation',
          dateStarted: '2026-01-13T09:52:20',
          dateUpdated: '2026-01-13T09:52:20',
        },
      ],
      total: 1,
    });

    expect(result.total).toBe(1);
    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe('10563');
    expect(result.items[0].userId).toBe('1004');
    expect(result.items[0].spentTimeHours).toBe(3);
    expect(result.items[0].startDate).toBe('2026-01-13T09:52:20');
    expect(result.items[0].typeOfTime).toBe('Road/Water Test');
  });

  it('maps create payload to backend API schema', () => {
    service.createTimeLog(payload).subscribe();

    const req = httpMock.expectOne('/api/timelogs');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      projectId: 46,
      vehicleId: 1723,
      userId: 1004,
      typeOfTimeId: 5,
      timeSpent: 3,
      description: 'R/t W/t and validation',
      dateStarted: '2026-01-13T09:52:20',
    });

    req.flush({
      id: 10563,
      vehicleId: 1723,
      userId: 1004,
      projectId: 46,
      typeOfTimeId: 5,
      timeSpent: 3,
      description: 'R/t W/t and validation',
      dateStarted: '2026-01-13T09:52:20',
    });
  });

  it('maps update payload to backend API schema', () => {
    service
      .updateTimeLog('10563', {
        projectId: '46',
        vehicleId: '1723',
        userId: '1004',
        typeOfTime: 'Road/Water Test',
        spentTimeHours: 3.5,
        description: 'Updated',
        startDate: '2026-01-13T09:52:20',
      })
      .subscribe();

    const req = httpMock.expectOne('/api/timelogs/10563');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      projectId: 46,
      vehicleId: 1723,
      userId: 1004,
      typeOfTimeId: 5,
      timeSpent: 3.5,
      description: 'Updated',
      dateStarted: '2026-01-13T09:52:20',
    });

    req.flush({
      id: 10563,
      vehicleId: 1723,
      userId: 1004,
      projectId: 46,
      typeOfTimeId: 5,
      timeSpent: 3.5,
      description: 'Updated',
      dateStarted: '2026-01-13T09:52:20',
    });
  });

  it('throws before request when create payload IDs are not numeric', () => {
    expect(() =>
      service.createTimeLog({
        ...payload,
        projectId: '',
      })
    ).toThrowError('Invalid projectId value');

    const reqs = httpMock.match('/api/timelogs');
    expect(reqs.length).toBe(0);
  });

  it('falls back to sequential submit and remembers bulk unsupported endpoints', () => {
    service.bulkCreateTimeLogs([payload, payload]).subscribe();

    const bulkReq = httpMock.expectOne('/api/timelogs/bulk');
    expect(bulkReq.request.method).toBe('POST');
    bulkReq.flush({}, { status: 405, statusText: 'Method Not Allowed' });

    const createReqs = httpMock.match('/api/timelogs');
    expect(createReqs.length).toBe(2);
    createReqs.forEach((req) => {
      expect(req.request.method).toBe('POST');
      req.flush({
        id: 10563,
        vehicleId: 1723,
        userId: 1004,
        projectId: 46,
        typeOfTimeId: 5,
        timeSpent: 3,
        description: 'ok',
        dateStarted: '2026-01-13T09:52:20',
      });
    });

    service.bulkCreateTimeLogs([payload]).subscribe();
    const secondBulk = httpMock.match('/api/timelogs/bulk');
    expect(secondBulk.length).toBe(0);
    const secondCreate = httpMock.expectOne('/api/timelogs');
    expect(secondCreate.request.method).toBe('POST');
    secondCreate.flush({
      id: 10564,
      vehicleId: 1723,
      userId: 1004,
      projectId: 46,
      typeOfTimeId: 5,
      timeSpent: 3,
      description: 'ok',
      dateStarted: '2026-01-13T09:52:20',
    });
  });
});
