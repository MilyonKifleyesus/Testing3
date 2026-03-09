import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private auth: AuthService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.auth.accessToken;

    const isApiCall = req.url.startsWith(environment.apiBaseUrl);
    const isLoginCall = isApiCall && req.url.startsWith(`${environment.apiBaseUrl}/auth/login`);

    const request = token && isApiCall && !isLoginCall
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

    return next.handle(request).pipe(
      catchError((err) => {
        if (!isLoginCall && isApiCall && err?.status === 401) {
          this.auth.logout();
        }
        return throwError(() => err);
      })
    );
  }
}
