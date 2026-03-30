import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom, of } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import { UserManagementService } from '../../services/user-management.service';
import { ReportService } from './report.service';

describe('ReportService', () => {
  let service: ReportService;
  let httpMock: HttpTestingController;
  const originalApiPagedFetchPageSize = environment.apiPagedFetchPageSize;
  const originalApiPagedFetchMaxPages = environment.apiPagedFetchMaxPages;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ReportService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ClientDashboardService,
          useValue: {
            getTicketsDashboard: jasmine.createSpy('getTicketsDashboard').and.returnValue(of({})),
          },
        },
        {
          provide: UserManagementService,
          useValue: {
            getUsers: jasmine.createSpy('getUsers').and.returnValue(of({ items: [], totalCount: 0 })),
          },
        },
      ],
    });

    service = TestBed.inject(ReportService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    (environment as any).apiPagedFetchPageSize = originalApiPagedFetchPageSize;
    (environment as any).apiPagedFetchMaxPages = originalApiPagedFetchMaxPages;
  });

  it('fetches all labour report pages instead of stopping at the first 10000 rows', async () => {
    (environment as any).apiPagedFetchPageSize = 10000;

    const resultPromise = firstValueFrom(service.getLabourReport({
      projectId: 35,
    }));

    const page1 = httpMock.expectOne((request) =>
      request.urlWithParams.includes('/reports/labour?pageSize=10000&page=1&projectId=35'),
    );
    page1.flush({
      items: [
        { date: '2026-03-01', hours: 3.5, inspectorId: 1, inspector: 'DQ', projectId: 35, project: 'SR2838', vehicleId: 10, vehicle: 'Bus-10', typeOfTimeId: 1, typeOfTime: 'Inspection', description: 'Row 1' },
      ],
      total: 10001,
      page: 1,
      pageSize: 10000,
    });
    await Promise.resolve();

    const page2 = httpMock.expectOne((request) =>
      request.urlWithParams.includes('/reports/labour?pageSize=10000&page=2&projectId=35'),
    );
    page2.flush({
      items: [
        { date: '2026-03-02', hours: 1.5, inspectorId: 2, inspector: 'Remi', projectId: 35, project: 'SR2838', vehicleId: 11, vehicle: 'Bus-11', typeOfTimeId: 1, typeOfTime: 'Inspection', description: 'Row 2' },
      ],
      total: 2,
      page: 2,
      pageSize: 10000,
    });

    await expectAsync(resultPromise).toBeResolvedTo([
      jasmine.objectContaining({ description: 'Row 1', hours: 3.5 }),
      jasmine.objectContaining({ description: 'Row 2', hours: 1.5 }),
    ]);
  });
});
