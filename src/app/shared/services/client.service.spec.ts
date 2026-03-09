import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ClientService } from './client.service';

describe('ClientService', () => {
  let service: ClientService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ClientService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(ClientService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('always includes existing locationIds when update request omits locationIds', () => {
    let resolved = false;
    service.updateClient('7', { name: 'Updated Client' }).subscribe((client) => {
      expect(client.name).toBe('Updated Client');
      resolved = true;
    });

    const existingReq = httpMock.expectOne('/api/Clients/7');
    expect(existingReq.request.method).toBe('GET');
    existingReq.flush({
      id: 7,
      customerName: 'Original Client',
      customerLogo: null,
      customerLogoName: null,
      locations: [
        { id: 10, latitude: 43.7, longitude: -79.4 },
        { id: 11, latitude: 43.8, longitude: -79.5 },
      ],
    });

    const updateReq = httpMock.expectOne('/api/Clients/7');
    expect(updateReq.request.method).toBe('PUT');
    expect(updateReq.request.body).toEqual(
      jasmine.objectContaining({
        customerName: 'Updated Client',
        locationIds: [10, 11],
      })
    );
    updateReq.flush({});

    const verifyReq = httpMock.expectOne('/api/Clients/7');
    expect(verifyReq.request.method).toBe('GET');
    verifyReq.flush({
      id: 7,
      customerName: 'Updated Client',
      customerLogo: null,
      customerLogoName: null,
      locations: [
        { id: 10, latitude: 43.7, longitude: -79.4 },
        { id: 11, latitude: 43.8, longitude: -79.5 },
      ],
    });

    expect(resolved).toBeTrue();
  });

  it('sends explicit locationIds even when an empty array is provided', () => {
    service.updateClient('9', { customerName: 'Client Nine', locationIds: [] }).subscribe();

    const existingReq = httpMock.expectOne('/api/Clients/9');
    existingReq.flush({
      id: 9,
      customerName: 'Client Nine',
      customerLogo: null,
      customerLogoName: null,
      locations: [{ id: 99, latitude: 0, longitude: 0 }],
    });

    const updateReq = httpMock.expectOne('/api/Clients/9');
    expect(updateReq.request.method).toBe('PUT');
    expect(updateReq.request.body.locationIds).toEqual([]);
    updateReq.flush({});

    const verifyReq = httpMock.expectOne('/api/Clients/9');
    verifyReq.flush({
      id: 9,
      customerName: 'Client Nine',
      customerLogo: null,
      customerLogoName: null,
      locations: [],
    });
  });

  it('retries once with stripped raw base64 logo when backend rejects data URL format', () => {
    service.updateClient('11', {
      customerName: 'Logo Client',
      customerLogo: 'data:image/png;base64,QUJDRA==',
      customerLogoName: 'logo.png',
      locationIds: [101],
    }).subscribe();

    const existingReq = httpMock.expectOne('/api/Clients/11');
    existingReq.flush({
      id: 11,
      customerName: 'Logo Client',
      customerLogo: null,
      customerLogoName: null,
      locations: [{ id: 101, latitude: 1, longitude: 2 }],
    });

    const firstPut = httpMock.expectOne('/api/Clients/11');
    expect(firstPut.request.method).toBe('PUT');
    expect(firstPut.request.body.customerLogo).toBe('data:image/png;base64,QUJDRA==');
    firstPut.flush(
      { title: 'Invalid logo format' },
      { status: 400, statusText: 'Bad Request' }
    );

    const fallbackPut = httpMock.expectOne('/api/Clients/11');
    expect(fallbackPut.request.method).toBe('PUT');
    expect(fallbackPut.request.body.customerLogo).toBe('QUJDRA==');
    expect(fallbackPut.request.body.customerLogoName).toBe('logo.png');
    fallbackPut.flush({});

    const verifyReq = httpMock.expectOne('/api/Clients/11');
    verifyReq.flush({
      id: 11,
      customerName: 'Logo Client',
      customerLogo: 'QUJDRA==',
      customerLogoName: 'logo.png',
      locations: [{ id: 101, latitude: 1, longitude: 2 }],
    });
  });
});
