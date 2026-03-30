import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { InspectorService } from './inspector.service';

describe('InspectorService', () => {
  let service: InspectorService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [InspectorService],
    });
    service = TestBed.inject(InspectorService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('uses /api/users as the user source for time logs', () => {
    let result: any[] = [];
    service.getInspectors().subscribe((items) => (result = items));

    const usersReq = httpMock.expectOne((req) => req.url === '/api/users');
    expect(usersReq.request.method).toBe('GET');
    expect(usersReq.request.params.get('page')).toBe('1');
    expect(usersReq.request.params.get('pageSize')).toBe('1000');
    usersReq.flush({
      items: [{ id: 1004, username: 'Stephane', email: 's@fleetpulse.net', isActive: true }],
    });

    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1004');
    expect(result[0].name).toBe('Stephane');
  });

  it('keeps active users only', () => {
    let result: any[] = [];
    service.getInspectors().subscribe((items) => (result = items));

    const usersReq = httpMock.expectOne((req) => req.url === '/api/users');
    expect(usersReq.request.method).toBe('GET');
    expect(usersReq.request.params.get('page')).toBe('1');
    expect(usersReq.request.params.get('pageSize')).toBe('1000');
    usersReq.flush({
      items: [
        { id: 1004, username: 'stephane', email: 's@fleetpulse.net', isActive: true },
        { id: 1005, username: 'inactive-user', email: 'x@fleetpulse.net', isActive: false },
        { id: 1006, displayName: 'Display User', email: 'd@fleetpulse.net' },
      ],
    });

    expect(result.map((i) => i.id)).toEqual(['1004', '1006']);
    expect(result.map((i) => i.name)).toEqual(['stephane', 'Display User']);
  });
});
