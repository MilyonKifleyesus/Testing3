import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
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

  it('updateClient sends PUT then fetches client via GET', () => {
    let response: any;
    let error: any;

    service.updateClient('7', { name: 'Saskatoon Transit', latitude: 52.1579, longitude: -106.6702 }).subscribe({
      next: (value) => (response = value),
      error: (err) => (error = err),
    });

    const getBeforePutReq = httpMock.expectOne((req) => req.method === 'GET' && req.url.includes('/Clients/7'));
    getBeforePutReq.flush({
      id: 7,
      customerName: 'Old Name',
      customerLogo: 'logo-data',
      customerLogoName: 'logo.png',
      locationId: 21,
      latitude: 1,
      longitude: 2,
      locations: [],
    });

    const putReq = httpMock.expectOne((req) => req.method === 'PUT' && req.url.includes('/Clients/7'));
    expect(putReq.request.body).toEqual(
      jasmine.objectContaining({
        id: 7,
        clientId: '7',
        customerName: 'Saskatoon Transit',
        customerLogo: 'logo-data',
        customerLogoName: 'logo.png',
        locationId: 21,
        latitude: 52.1579,
        longitude: -106.6702,
      })
    );
    putReq.flush({});

    const getReq = httpMock.expectOne((req) => req.method === 'GET' && req.url.includes('/Clients/7'));
    getReq.flush({
      id: 7,
      customerName: 'Saskatoon Transit',
      latitude: 52.1579,
      longitude: -106.6702,
    });

    expect(error).toBeUndefined();
    expect(response.id).toBe('7');
    expect(response.name).toBe('Saskatoon Transit');
    expect(response.coordinates).toEqual({ latitude: 52.1579, longitude: -106.6702 });
  });

  it('updateClient propagates failure from API', () => {
    let response: any;
    let error: any;

    service.updateClient('8', { name: 'Client X', latitude: 1, longitude: 2 }).subscribe({
      next: (value) => (response = value),
      error: (err) => (error = err),
    });

    const getBeforePutReq = httpMock.expectOne((req) => req.method === 'GET' && req.url.includes('/Clients/8'));
    getBeforePutReq.flush({
      id: 8,
      customerName: 'Client X',
      customerLogo: null,
      customerLogoName: null,
      locationId: 30,
      latitude: 1,
      longitude: 2,
    });

    const putReq = httpMock.expectOne((req) => req.method === 'PUT' && req.url.includes('/Clients/8'));
    putReq.flush({ message: 'failed' }, { status: 500, statusText: 'Server Error' });

    expect(response).toBeUndefined();
    expect(error).toBeTruthy();
  });

  it('updateClient falls back to clients list when GET by id fails', () => {
    let response: any;
    let error: any;

    service.updateClient('10', { name: 'DRT', latitude: 43.8509, longitude: -79.0369 }).subscribe({
      next: (value) => (response = value),
      error: (err) => (error = err),
    });

    const getByIdReq = httpMock.expectOne((req) => req.method === 'GET' && req.url.includes('/Clients/10'));
    getByIdReq.flush({}, { status: 404, statusText: 'Not Found' });

    const getListReq = httpMock.expectOne((req) => req.method === 'GET' && req.url.endsWith('/Clients'));
    getListReq.flush({
      items: [
        {
          id: 10,
          customerName: 'Old DRT',
          customerLogo: 'logo-data',
          customerLogoName: 'drt.png',
          locationId: 55,
          latitude: 1,
          longitude: 2,
        },
      ],
    });

    const putReq = httpMock.expectOne((req) => req.method === 'PUT' && req.url.includes('/Clients/10'));
    expect(putReq.request.body).toEqual(
      jasmine.objectContaining({
        customerName: 'DRT',
        customerLogo: 'logo-data',
        customerLogoName: 'drt.png',
        locationId: 55,
        latitude: 43.8509,
        longitude: -79.0369,
      })
    );
    putReq.flush({});

    const getAfterPutReq = httpMock.expectOne((req) => req.method === 'GET' && req.url.includes('/Clients/10'));
    getAfterPutReq.flush({
      id: 10,
      customerName: 'DRT',
      latitude: 43.8509,
      longitude: -79.0369,
    });

    expect(error).toBeUndefined();
    expect(response?.name).toBe('DRT');
  });
});
