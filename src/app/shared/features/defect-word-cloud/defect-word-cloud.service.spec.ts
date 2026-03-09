import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DefectWordCloudService } from './defect-word-cloud.service';

describe('DefectWordCloudService', () => {
  let service: DefectWordCloudService;
  let httpMock: HttpTestingController;

  const sampleTickets = [
    {
      id: 1,
      ticketDescription: ' Engine  fire wire is loose. ',
      projectId: 7,
      vehicleId: 20,
      defectLocationId: 9,
      defectLocationName: 'Vehicle Understructure',
      createdAt: '2024-03-01T10:00:00Z',
    },
    {
      id: 2,
      ticketDescription: 'engine fire wire is loose.',
      projectId: 7,
      vehicleId: 20,
      defectLocationId: 9,
      defectLocationName: 'Vehicle Understructure',
      createdAt: '2024-03-03T10:00:00Z',
    },
    {
      id: 3,
      ticketDescription: '',
      projectId: 7,
      vehicleId: 20,
      defectLocationId: 9,
      defectLocationName: 'Vehicle Understructure',
      createdAt: '2024-03-03T10:00:00Z',
    },
    {
      id: 4,
      ticketDescription: 'Protect a/c lines better',
      projectId: 7,
      vehicleId: 20,
      defectLocationId: 9,
      defectLocationName: 'Vehicle Understructure',
      createdAt: '2024-03-04T10:00:00Z',
    },
    {
      id: 5,
      ticketDescription: 'Protect   a/c   lines better',
      projectId: 7,
      vehicleId: 20,
      defectLocationId: 9,
      defectLocationName: 'Vehicle Understructure',
      createdAt: '2024-03-05T10:00:00Z',
    },
    {
      id: 6,
      ticketDescription: 'Driver seat cushion torn',
      projectId: 14,
      vehicleId: 44,
      defectLocationId: 4,
      defectLocationName: 'Driver Area',
      createdAt: '2024-04-01T12:00:00Z',
    },
    {
      id: 7,
      ticketDescription: 'Stepwell light not working',
      projectId: 14,
      vehicleId: 45,
      defectLocationId: 18,
      defectLocationName: 'Electrical',
      createdAt: '2024-04-02T12:00:00Z',
    },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(DefectWordCloudService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads the sample dataset and aggregates normalized descriptions with frontend filters', () => {
    let result: any;

    service.getWordCloudData({
      projectId: '7',
      defectLocationId: '9',
      vehicleId: '20',
      dateFrom: '2024-03-01',
      dateTo: '2024-03-31',
    }).subscribe((value) => {
      result = value;
    });

    const request = httpMock.expectOne('/data/defect-word-cloud-tickets.json');
    request.flush(sampleTickets);

    expect(result.totalTickets).toBe(5);
    expect(result.validDescriptionCount).toBe(4);
    expect(result.uniqueDescriptionCount).toBe(2);
    expect(result.words).toEqual([
      {
        key: 'engine fire wire is loose.',
        text: 'Engine fire wire is loose.',
        value: 2,
      },
      {
        key: 'protect a/c lines better',
        text: 'Protect a/c lines better',
        value: 2,
      },
    ]);
  });

  it('reuses cached aggregated results for the same filter signature without refetching the sample file', () => {
    let firstResult: any;
    let secondResult: any;

    service.getWordCloudData({ projectId: '14' }).subscribe((value) => {
      firstResult = value;
    });

    const request = httpMock.expectOne('/data/defect-word-cloud-tickets.json');
    request.flush(sampleTickets);

    service.getWordCloudData({ projectId: '14' }).subscribe((value) => {
      secondResult = value;
    });

    httpMock.expectNone('/data/defect-word-cloud-tickets.json');
    expect(secondResult).toEqual(firstResult);
  });

  it('builds stable inspection area options scoped only by project id from the sample file', () => {
    let options: any;

    service.getInspectionAreaOptions('14').subscribe((value) => {
      options = value;
    });

    const request = httpMock.expectOne('/data/defect-word-cloud-tickets.json');
    request.flush(sampleTickets);

    expect(options).toEqual([
      { id: '4', name: 'Driver Area' },
      { id: '18', name: 'Electrical' },
    ]);

    service.getInspectionAreaOptions('14').subscribe();
    httpMock.expectNone('/data/defect-word-cloud-tickets.json');
  });

  it('applies inclusive date filtering using the date-only portion of createdAt', () => {
    let result: any;

    service.getWordCloudData({
      dateFrom: '2024-04-01',
      dateTo: '2024-04-01',
    }).subscribe((value) => {
      result = value;
    });

    const request = httpMock.expectOne('/data/defect-word-cloud-tickets.json');
    request.flush(sampleTickets);

    expect(result.totalTickets).toBe(1);
    expect(result.words.map((word: any) => word.text)).toEqual(['Driver seat cushion torn']);
  });

  it('fails cleanly when the sample payload is not a valid ticket array', () => {
    let thrownError: unknown;

    service.getWordCloudData({}).subscribe({
      error: (error) => {
        thrownError = error;
      },
    });

    const request = httpMock.expectOne('/data/defect-word-cloud-tickets.json');
    request.flush({ invalid: true });

    expect((thrownError as Error).message).toContain('valid ticket array format');
  });
});
