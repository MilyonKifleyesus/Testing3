import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FleetMapApiService } from './fleet-map-api.service';

describe('FleetMapApiService', () => {
  let service: FleetMapApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        FleetMapApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(FleetMapApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('requests projects with includeClosed=true so inactive projects are returned', fakeAsync(() => {
    let resultLength = -1;

    service.fetchProjects().subscribe((projects) => {
      resultLength = projects.length;
    });

    const request = httpMock.expectOne((req) => req.url.endsWith('/Projects'));
    expect(request.request.params.get('includeClosed')).toBe('true');

    request.flush({
      items: [
        {
          id: 101,
          name: 'Closed project',
          clientId: 22,
          locationId: 9,
          closed: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 500,
    });

    tick();

    expect(resultLength).toBe(1);
  }));
});
