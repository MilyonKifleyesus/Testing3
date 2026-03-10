import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, finalize, map, Observable, tap } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { LoginRequest, LoginResponse } from '../models/auth.models';

export interface CurrentUser {
  userId: number;
  username: string;
  email?: string;
  role: string;
  clientId: number;
  isGeneralAdmin: boolean;
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

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {
    this.pruneExpiredSession();
  }

  public showLoader = false;

  login(req: LoginRequest): Observable<LoginResponse> {
    this.showLoader = true;

    return this.http
      .post(`${environment.apiBaseUrl}/auth/login`, req, {
        responseType: 'text',
      })
      .pipe(
        map((raw) => this.parseLoginResponse(raw)),
        tap((res) => this.persistSession(res)),
        finalize(() => {
          this.showLoader = false;
        }),
      );
  }

  loginWithRole(username: string, password: string): Observable<CurrentUser> {
    const req: LoginRequest = { usernameOrEmail: username, password };
    return this.login(req).pipe(
      map(() => {
        const user = this.currentUserValue;
        if (!user) {
          throw new Error('Login response did not yield a current user.');
        }
        return user;
      }),
    );
  }

  loginWithEmail(email: string, password: string): Promise<CurrentUser | null> {
    const req: LoginRequest = { usernameOrEmail: email, password };
    return new Promise((resolve, reject) => {
      this.login(req).subscribe({
        next: () => {
          resolve(this.currentUserValue);
        },
        error: (err) => {
          reject(err);
        },
      });
    });
  }

  logout(): void {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_USER_LEGACY);
    this.currentUserSubject.next(null);
    this.router.navigate(['/custom/sign-in']);
  }

  get accessToken(): string | null {
    const token = localStorage.getItem(LS_TOKEN);
    if (!token) return null;
    if (!this.isJwtTokenValid(token)) {
      this.clearStoredAuth();
      return null;
    }
    return token;
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

    return false;
  }

  getRedirectUrlByRole(role?: string | null): string {
    const normalizedRole = (role ?? this.userRole ?? '').toLowerCase().trim();

    if (normalizedRole === 'admin' || normalizedRole === 'superadmin') {
      return '/admin/dashboard';
    }

    if (normalizedRole === 'client' || normalizedRole === 'user') {
      return '/client/dashboard';
    }

    return '/dashboard';
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

  private normalizeUser(value: any): CurrentUser {
    return {
      userId: Number(value?.userId ?? 0),
      username: String(value?.username ?? '').trim(),
      email: value?.email ? String(value.email).trim() : undefined,
      role: String(value?.role ?? '').trim(),
      clientId: Number(value?.clientId ?? 0),
      isGeneralAdmin: Boolean(value?.isGeneralAdmin),
    };
  }

  private persistSession(res: LoginResponse): void {
    localStorage.setItem(LS_TOKEN, res.accessToken);
    const user: CurrentUser = {
      userId: res.userId,
      username: res.username,
      email: res.email,
      role: res.role,
      clientId: res.clientId,
      isGeneralAdmin: res.isGeneralAdmin,
    };
    const serializedUser = JSON.stringify(this.normalizeUser(user));
    localStorage.setItem(LS_USER, serializedUser);
    localStorage.removeItem(LS_USER_LEGACY);
    this.currentUserSubject.next(this.normalizeUser(user));
  }

  private parseLoginResponse(raw: string): LoginResponse {
    const parsed = this.parseResponseBody(raw);
    const payload = this.unwrapPayload(parsed);

    const accessToken = this.readString(payload, ['accessToken', 'AccessToken', 'token', 'Token']);
    if (!accessToken) {
      throw new Error('Login response did not include an access token.');
    }

    return {
      accessToken,
      expiresInSeconds: this.readNumber(payload, ['expiresInSeconds', 'ExpiresInSeconds'], 0),
      role: this.readString(payload, ['role', 'Role']),
      type: this.readNumber(payload, ['type', 'Type'], 0),
      userId: this.readNumber(payload, ['userId', 'UserId', 'id', 'Id'], 0),
      username: this.readString(payload, ['username', 'Username']),
      email: this.readOptionalString(payload, ['email', 'Email']),
      clientId: this.readNumber(payload, ['clientId', 'ClientId'], 0),
      isGeneralAdmin: this.readBoolean(payload, ['isGeneralAdmin', 'IsGeneralAdmin'], false),
    };
  }

  private parseResponseBody(raw: string): Record<string, unknown> {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) {
      throw new Error('Login response was empty.');
    }

    const withoutBom = trimmed.charCodeAt(0) === 0xfeff ? trimmed.slice(1) : trimmed;
    const parsed = JSON.parse(withoutBom);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Login response was not a JSON object.');
    }

    return parsed as Record<string, unknown>;
  }

  private unwrapPayload(value: Record<string, unknown>): Record<string, unknown> {
    const nested = value['data'];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
    return value;
  }

  private readString(value: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === 'string') {
        return candidate.trim();
      }
    }
    return '';
  }

  private readOptionalString(value: Record<string, unknown>, keys: string[]): string | undefined {
    const result = this.readString(value, keys);
    return result || undefined;
  }

  private readNumber(value: Record<string, unknown>, keys: string[], fallback: number): number {
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
      if (typeof candidate === 'string' && candidate.trim() && Number.isFinite(Number(candidate))) {
        return Number(candidate);
      }
    }
    return fallback;
  }

  private readBoolean(value: Record<string, unknown>, keys: string[], fallback: boolean): boolean {
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === 'boolean') {
        return candidate;
      }
      if (typeof candidate === 'string') {
        const normalized = candidate.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
      }
    }
    return fallback;
  }

  private pruneExpiredSession(): void {
    const token = localStorage.getItem(LS_TOKEN);
    if (!token) return;
    if (this.isJwtTokenValid(token)) return;
    this.clearStoredAuth();
  }

  private clearStoredAuth(): void {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_USER_LEGACY);
    this.currentUserSubject.next(null);
  }

  private isJwtTokenValid(token: string): boolean {
    const expMs = this.tryGetJwtExpMs(token);
    if (expMs == null) return false;
    const skewMs = 30_000;
    return Date.now() + skewMs < expMs;
  }

  private tryGetJwtExpMs(token: string): number | null {
    const payload = this.tryDecodeJwtPayload(token);
    const exp = payload ? payload['exp'] : undefined;
    if (typeof exp === 'number' && Number.isFinite(exp)) return exp * 1000;
    if (typeof exp === 'string' && exp.trim() && Number.isFinite(Number(exp))) return Number(exp) * 1000;
    return null;
  }

  private tryDecodeJwtPayload(token: string): Record<string, unknown> | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const json = this.base64UrlDecodeToString(parts[1]);
      const parsed = JSON.parse(json);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private base64UrlDecodeToString(input: string): string {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);

    // Handle UTF-8 payloads safely.
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch {
      return binary;
    }
  }
}
