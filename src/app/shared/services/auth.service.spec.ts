import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('parses text login responses and stores the normalized session', () => {
    let currentUserRole = '';

    service.login({
      usernameOrEmail: 'demo',
      password: 'secret123',
    }).subscribe((response) => {
      currentUserRole = response.role;
    });

    const req = httpMock.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.responseType).toBe('text');
    expect(req.request.body).toEqual({
      usernameOrEmail: 'demo',
      password: 'secret123',
    });

    req.flush(JSON.stringify({
      accessToken: 'jwt-token',
      expiresInSeconds: 3600,
      role: 'Admin',
      type: 1,
      userId: 42,
      username: 'demo',
      email: 'demo@example.com',
      clientId: 7,
      isGeneralAdmin: true,
    }));

    expect(currentUserRole).toBe('Admin');
    expect(localStorage.getItem('bp_access_token')).toBe('jwt-token');
    expect(service.currentUserValue).toEqual(jasmine.objectContaining({
      userId: 42,
      username: 'demo',
      role: 'Admin',
      clientId: 7,
      isGeneralAdmin: true,
    }));
  });

  it('accepts pascal-case login payloads and returns the current user from loginWithRole', () => {
    let resolvedUserName = '';

    service.loginWithRole('demo', 'secret123').subscribe((user) => {
      resolvedUserName = user.username;
    });

    const req = httpMock.expectOne('/api/auth/login');
    expect(req.request.responseType).toBe('text');

    req.flush(JSON.stringify({
      AccessToken: 'jwt-token',
      ExpiresInSeconds: '3600',
      Role: 'Client',
      Type: '2',
      UserId: '108',
      Username: 'Demo User',
      Email: 'demo@example.com',
      ClientId: '14',
      IsGeneralAdmin: 'false',
    }));

    expect(resolvedUserName).toBe('Demo User');
    expect(service.currentUserValue).toEqual(jasmine.objectContaining({
      userId: 108,
      username: 'Demo User',
      role: 'Client',
      clientId: 14,
      isGeneralAdmin: false,
    }));
  });
});
