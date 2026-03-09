import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TimeLogUser } from '../models/time-log.model';
import { TIME_LOG_API_PATHS, buildApiUrl } from '../constants/time-log-api.constants';
import { normalizeId } from '../utils/id-normalizer.util';

/**
 * User options for time-log (list filters, manual entry, staging).
 * Source: GET /api/users.
 */
@Injectable({ providedIn: 'root' })
export class InspectorService {
  private readonly baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  /**
   * Fetch active users and normalize to { id, name }.
   */
  getInspectors(): Observable<TimeLogUser[]> {
    return this.fetchUsers().pipe(catchError(() => of([])));
  }

  private fetchUsers(): Observable<TimeLogUser[]> {
    const params = new HttpParams().set('page', '1').set('pageSize', '1000');
    return this.http
      .get<unknown>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.users), { params })
      .pipe(
        map((raw) => this.normalizeList(this.extractItems(raw))),
        catchError(() => of([]))
      );
  }

  private extractItems(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    const obj = raw as any;
    if (Array.isArray(obj?.items)) return obj.items;
    if (Array.isArray(obj?.data?.items)) return obj.data.items;
    if (Array.isArray(obj?.data)) return obj.data;
    if (Array.isArray(obj?.result?.items)) return obj.result.items;
    return [];
  }

  private normalizeList(raw: unknown[]): TimeLogUser[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item: any) => ({
        id: normalizeId(item?.userId ?? item?.userID ?? item?.UserId ?? item?.id),
        name: this.firstNonEmptyString(
          item?.username,
          item?.userName,
          item?.displayName,
          item?.fullName,
          [item?.firstName, item?.lastName]
            .map((part: unknown) => String(part ?? '').trim())
            .filter((part: string) => !!part)
            .join(' '),
          item?.name,
          item?.email
        ),
        email: item?.email,
        isActive: item?.isActive,
      }))
      .filter((i) => i.id && i.name)
      .filter((i: any) => i.isActive !== false)
      .map(({ isActive, ...rest }: any) => rest as TimeLogUser);
  }

  private firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) return text;
    }
    return '';
  }
}
