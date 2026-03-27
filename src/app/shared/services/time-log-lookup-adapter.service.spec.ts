import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';

import { TimeLogLookupAdapterService } from './time-log-lookup-adapter.service';
import { ClientService } from './client.service';

class MockClientService {
  getClientNameMap = jasmine.createSpy('getClientNameMap').and.returnValue(of(new Map<string, string>()));
}

describe('TimeLogLookupAdapterService', () => {
  let service: TimeLogLookupAdapterService;
  let httpMock: HttpTestingController;
  let mockClientService: MockClientService;

  beforeEach(() => {
    mockClientService = new MockClientService();

    TestBed.configureTestingModule({
      providers: [
        TimeLogLookupAdapterService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ClientService, useValue: mockClientService },
      ],
    });

    service = TestBed.inject(TimeLogLookupAdapterService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ─── refresh() — success path ─────────────────────────────────────────────

  it('refresh() fetches projects, users and vehicles and publishes ready state', () => {
    let state: any;
    service.lookups$.subscribe((s) => (state = s));

    service.refresh('manual');

    // projects
    const projectsReq = httpMock.expectOne('/api/projects');
    projectsReq.flush([
      { id: 1, name: 'SR2838', clientId: 42 },
      { id: 2, name: 'SR2839', clientId: 42 },
    ]);

    // users
    const usersReq = httpMock.expectOne((r) => r.url === '/api/users');
    usersReq.flush([
      { userId: 10, username: 'Taylor' },
      { userId: 11, username: 'Jordan' },
    ]);

    // vehicles (flat list with clientId relation — satisfies hasRelation check)
    const vehiclesReq = httpMock.expectOne('/api/vehicles');
    vehiclesReq.flush([
      { id: 101, name: 'Bus-101', clientId: 42 },
      { id: 102, name: 'Bus-102', clientId: 42 },
    ]);

    expect(state.ready).toBeTrue();
    expect(state.loading).toBeFalse();
    expect(state.projects.length).toBe(2);
    expect(state.projects[0]).toEqual(jasmine.objectContaining({ id: '1', name: 'SR2838', clientId: '42' }));
    expect(state.vehicles.length).toBe(2);
    expect(state.users.length).toBe(2);
    expect(state.users[0]).toEqual(jasmine.objectContaining({ id: '10', name: 'Taylor' }));
  });

  it('refresh() publishes an error state when the primary HTTP call fails', () => {
    let state: any;
    service.lookups$.subscribe((s) => (state = s));

    service.refresh('manual');

    const projectsReq = httpMock.expectOne('/api/projects');
    projectsReq.flush({}, { status: 500, statusText: 'Server Error' });

    // forkJoin cancels sibling requests when one errors — drain without flushing
    httpMock.match(() => true);

    expect(state.ready).toBeFalse();
    expect(state.loading).toBeFalse();
    expect(state.error).toBeTruthy();
  });

  it('refresh() is skipped when a request is already in-flight', () => {
    service.refresh('manual');

    // First call goes out
    httpMock.expectOne('/api/projects');
    httpMock.expectOne((r) => r.url === '/api/users');

    // Second call should not cause additional HTTP requests
    service.refresh('manual');

    // Flush the first call
    httpMock.match('/api/projects')[0]?.flush([]);
    httpMock.match('/api/users')[0]?.flush([]);
    httpMock.match('/api/vehicles').forEach((r) => r.flush([]));
  });

  it('refresh() with reason="ttl" is skipped when the cache is still valid', () => {
    // First seed the state with a loadedAt
    service.refresh('manual');
    httpMock.expectOne('/api/projects').flush([{ id: 1, name: 'P1', clientId: 1 }]);
    httpMock.expectOne((r) => r.url === '/api/users').flush([{ userId: 1, username: 'User1' }]);
    httpMock.expectOne('/api/vehicles').flush([{ id: 1, name: 'Bus-1', clientId: 1 }]);

    // Now attempt a TTL refresh — should be skipped since loadedAt is fresh
    service.refresh('ttl');

    httpMock.expectNone('/api/projects');
    httpMock.expectNone((r) => r.url === '/api/users');
    httpMock.expectNone('/api/vehicles');
  });

  // ─── getVehiclesForProject() ──────────────────────────────────────────────

  it('getVehiclesForProject() returns all vehicles when no projectId is given', () => {
    // Seed state
    service.refresh('manual');
    httpMock.expectOne('/api/projects').flush([{ id: 1, name: 'P1', clientId: 10 }]);
    httpMock.expectOne((r) => r.url === '/api/users').flush([]);
    httpMock.expectOne('/api/vehicles').flush([
      { id: 1, name: 'Bus-1', clientId: 10 },
      { id: 2, name: 'Bus-2', clientId: 10 },
    ]);

    const all = service.getVehiclesForProject('');
    expect(all.length).toBe(2);
  });

  it('getVehiclesForProject() returns vehicles matching clientId when project is found', () => {
    service.refresh('manual');
    httpMock.expectOne('/api/projects').flush([
      { id: 1, name: 'P1', clientId: 10 },
      { id: 2, name: 'P2', clientId: 20 },
    ]);
    httpMock.expectOne((r) => r.url === '/api/users').flush([]);
    httpMock.expectOne('/api/vehicles').flush([
      { id: 1, name: 'Bus-1', clientId: 10 },
      { id: 2, name: 'Bus-2', clientId: 20 },
      { id: 3, name: 'Bus-3', clientId: 10 },
    ]);

    const forProject1 = service.getVehiclesForProject('1');
    expect(forProject1.map((v) => v.id)).toEqual(jasmine.arrayContaining(['1', '3']));
    expect(forProject1.find((v) => v.id === '2')).toBeUndefined();
  });

  it('getVehiclesForProject() returns empty array when project is not in the list', () => {
    service.refresh('manual');
    httpMock.expectOne('/api/projects').flush([{ id: 1, name: 'P1', clientId: 10 }]);
    httpMock.expectOne((r) => r.url === '/api/users').flush([]);
    httpMock.expectOne('/api/vehicles').flush([{ id: 1, name: 'Bus-1', clientId: 10 }]);

    const result = service.getVehiclesForProject('999');
    expect(result).toEqual([]);
  });

  it('getVehiclesForProject() filters by projectId when vehicle has projectId but no clientId', () => {
    service.refresh('manual');
    httpMock.expectOne('/api/projects').flush([{ id: 1, name: 'P1', clientId: 10 }]);
    httpMock.expectOne((r) => r.url === '/api/users').flush([]);
    httpMock.expectOne('/api/vehicles').flush([
      { id: 1, name: 'Bus-1', projectId: 1 },  // no clientId — should match by projectId
      { id: 2, name: 'Bus-2', projectId: 2 },
    ]);

    const result = service.getVehiclesForProject('1');
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1');
  });

  // ─── resolveUsersByIds() ──────────────────────────────────────────────────

  it('resolveUsersByIds() returns empty observable for empty input', () => {
    let result: any;
    service.resolveUsersByIds([]).subscribe((r) => (result = r));
    expect(result).toEqual([]);
    httpMock.expectNone('/api/users/by-ids');
    httpMock.expectNone((r) => r.url === '/api/Users');
  });

  it('resolveUsersByIds() calls query endpoint and returns resolved users', () => {
    let result: any;
    service.resolveUsersByIds(['10', '11']).subscribe((r) => (result = r));

    const req = httpMock.expectOne((r) => r.url === '/api/Users' && r.params.get('ids') === '10,11');
    expect(req.request.method).toBe('GET');

    req.flush([
      { userId: 10, username: 'Taylor' },
      { userId: 11, username: 'Jordan' },
    ]);

    expect(result.length).toBe(2);
    expect(result.find((u: any) => u.id === '10')?.name).toBe('Taylor');
    expect(result.find((u: any) => u.id === '11')?.name).toBe('Jordan');
  });

  it('resolveUsersByIds() deduplicates repeated ids', () => {
    let result: any;
    service.resolveUsersByIds(['10', '10', '10']).subscribe((r) => (result = r));

    const req = httpMock.expectOne((r) => r.url === '/api/Users' && r.params.get('ids') === '10');

    req.flush([{ userId: 10, username: 'Taylor' }]);
    expect(result.length).toBe(1);
  });

  it('resolveUsersByIds() falls back to userIds query param when ids is rejected', () => {
    let result: any;
    service.resolveUsersByIds(['10']).subscribe((r) => (result = r));

    httpMock.expectOne((r) => r.url === '/api/Users' && r.params.get('ids') === '10')
      .flush({}, { status: 404, statusText: 'Not Found' });
    httpMock.expectOne((r) => r.url === '/api/users' && r.params.get('ids') === '10')
      .flush({}, { status: 404, statusText: 'Not Found' });

    const userIdsReq = httpMock.expectOne((r) => r.url === '/api/Users' && r.params.get('userIds') === '10');
    expect(userIdsReq.request.method).toBe('GET');
    userIdsReq.flush([{ userId: 10, username: 'Taylor' }]);

    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Taylor');
  });

  it('resolveUsersByIds() falls back to individual GET requests when batch endpoints fail', () => {
    let result: any;
    service.resolveUsersByIds(['10']).subscribe((r) => (result = r));

    httpMock.expectOne((r) => r.url === '/api/Users' && r.params.get('ids') === '10')
      .flush({}, { status: 404, statusText: 'Not Found' });
    httpMock.expectOne((r) => r.url === '/api/users' && r.params.get('ids') === '10')
      .flush({}, { status: 404, statusText: 'Not Found' });
    httpMock.expectOne((r) => r.url === '/api/Users' && r.params.get('userIds') === '10')
      .flush({}, { status: 404, statusText: 'Not Found' });
    httpMock.expectOne((r) => r.url === '/api/users' && r.params.get('userIds') === '10')
      .flush({}, { status: 404, statusText: 'Not Found' });
    httpMock.expectOne('/api/users/by-ids')
      .flush({}, { status: 404, statusText: 'Not Found' });

    const singleReq = httpMock.expectOne('/api/users/10');
    singleReq.flush({ userId: 10, username: 'Taylor' });

    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Taylor');
  });
});
