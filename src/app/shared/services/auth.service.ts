import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, catchError, finalize, Observable, of, Subject, tap } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { LoginRequest, LoginResponse } from '../models/auth.models';
import { resolveFleetMapPathByRole } from '../routes/fleet-map-route';

export interface CurrentUser {
  userId: number;
  username: string;
  email?: string;
  role: string;
  type: number;
  clientId: number;
  isGeneralAdmin: boolean;
  picture?: string;
}

const LS_TOKEN = 'bp_access_token';
const LS_USER = 'bp_current_user';
const LS_USER_LEGACY = 'currentUser';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSubject = new BehaviorSubject<CurrentUser | null>(
    this.readUser(),
  );
  currentUser$ = this.currentUserSubject.asObservable();

  /** Emits once on logout — used by the interceptor to cancel in-flight requests. */
  private logoutSubject = new Subject<void>();
  readonly logout$ = this.logoutSubject.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {}

  public showLoader = false;

  login(req: LoginRequest): Observable<LoginResponse> {
    this.showLoader = true;

    return this.http
      .post<LoginResponse>(`${environment.apiBaseUrl}/auth/login`, req)
      .pipe(
        tap((res) => {
          localStorage.setItem(LS_TOKEN, res.accessToken);
          const user: CurrentUser = {
            userId: res.userId,
            username: res.username,
            email: res.email,
            role: res.role,
            type: Number(res.type ?? 0),
            clientId: res.clientId,
            isGeneralAdmin: res.isGeneralAdmin,
          };
          const normalized = this.normalizeUser(user);
          const serializedUser = JSON.stringify(normalized);
          localStorage.setItem(LS_USER, serializedUser);
          localStorage.removeItem(LS_USER_LEGACY);
          this.currentUserSubject.next(normalized);
          // Fetch profile picture in the background and update the stored user
          this.fetchAndStorePicture(normalized.userId);
        }),
        finalize(() => {
          this.showLoader = false;
        }),
      );
  }

  loginWithRole(username: string, password: string): Observable<CurrentUser> {
    const req: LoginRequest = { usernameOrEmail: username, password };
    return this.login(req);
  }

  loginWithEmail(email: string, password: string): Promise<CurrentUser | null> {
    const req: LoginRequest = { usernameOrEmail: email, password };
    return new Promise((resolve, reject) => {
      this.login(req).subscribe({
        next: (_res) => {
          // Always resolve with normalized user object
          const user = this.normalizeUser(_res);
          resolve(user);
        },
        error: (err) => {
          reject(err);
        },
      });
    });
  }

  logout(): void {
    this.logoutSubject.next();           // cancel all in-flight HTTP requests
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_USER_LEGACY);
    this.currentUserSubject.next(null);
    this.router.navigateByUrl('/custom/sign-in', { replaceUrl: true });
  }

  get accessToken(): string | null {
    return localStorage.getItem(LS_TOKEN);
  }

  get currentUserValue(): CurrentUser | null {
    return this.currentUserSubject.value;
  }

  get userRole(): string | null {
    const role = this.currentUserSubject.value?.role ?? null;
    return role ? role.toLowerCase().trim() : null;
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  hasRole(roles: string[]): boolean {
    const userRole = this.userRole;
    if (!userRole) {
      return false;
    }

    const expected = roles.map((r) => (r ?? '').toLowerCase().trim());

    if (expected.includes(userRole)) {
      return true;
    }

    if (userRole === 'admin' && expected.includes('superadmin')) {
      return true;
    }

    if (userRole === 'superadmin' && expected.includes('admin')) {
      return true;
    }

    // Handle client role aliases (e.g. 'AdminClient', 'ClientUser', 'client user')
    if (userRole.includes('client') && expected.includes('client')) {
      return true;
    }

    return false;
  }

  getRedirectUrlByRole(role?: string | null): string {
    const normalizedRole = (role ?? this.userRole ?? '').toLowerCase().trim();

    if (normalizedRole === 'admin' || normalizedRole === 'superadmin') {
      return '/admin/dashboard';
    }

    if (
      normalizedRole === 'client' ||
      normalizedRole === 'user' ||
      normalizedRole.includes('client') ||
      normalizedRole === 'client user'
    ) {
      return '/client/dashboard';
    }

    return '/dashboard';
  }

  getFleetMapUrlByRole(role?: string | null): string {
    return resolveFleetMapPathByRole(role ?? this.userRole ?? '');
  }

  private readUser(): CurrentUser | null {
    const raw = localStorage.getItem(LS_USER) ?? localStorage.getItem(LS_USER_LEGACY);
    if (!raw) return null;
    try {
      const parsedUser = this.normalizeUser(JSON.parse(raw));
      const serializedUser = JSON.stringify(parsedUser);
      localStorage.setItem(LS_USER, serializedUser);
      localStorage.removeItem(LS_USER_LEGACY);
      return parsedUser;
    } catch {
      localStorage.removeItem(LS_USER);
      localStorage.removeItem(LS_USER_LEGACY);
      return null;
    }
  }

  /** Fetch the user's profile picture from the API and update the stored CurrentUser. */
  fetchAndStorePicture(userId: number): void {
    if (!userId) return;
    this.http.get<any>(`${environment.apiBaseUrl}/Users/${userId}`).pipe(
      catchError(() => of(null)),
    ).subscribe((data) => {
      const pictureUrl: string | undefined =
        typeof data?.picture === 'string' && data.picture ? data.picture : undefined;
      const current = this.currentUserSubject.value;
      if (current && pictureUrl && current.picture !== pictureUrl) {
        const updated: CurrentUser = { ...current, picture: pictureUrl };
        this.currentUserSubject.next(updated);
        localStorage.setItem(LS_USER, JSON.stringify(updated));
      }
    });
  }

  private normalizeUser(value: any): CurrentUser {
    // Defensive normalization for all fields
    let role = value?.role;
    if (typeof role !== 'string') {
      role = (role && typeof role === 'object' && 'name' in role) ? String(role.name) : '';
    }
    let username = value?.username;
    if (typeof username !== 'string') {
      username = (username && typeof username === 'object' && 'name' in username) ? String(username.name) : '';
    }
    return {
      userId: Number(value?.userId ?? 0),
      username: String(username ?? '').trim() || 'User',
      email: value?.email ? String(value.email).trim() : undefined,
      role: String(role ?? '').trim() || 'client',
      type: Number(value?.type ?? 0),
      clientId: Number(value?.clientId ?? 0),
      isGeneralAdmin: Boolean(value?.isGeneralAdmin),
      picture: value?.picture ? String(value.picture) : undefined,
    };
  }
}
