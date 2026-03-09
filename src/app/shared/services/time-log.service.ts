import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  TimeLog,
  TimeLogListParams,
  TimeLogListResponse,
  TimeLogPayload,
  TypeOfTime,
} from '../models/time-log.model';
import { TIME_LOG_API_PATHS, buildApiUrl } from '../constants/time-log-api.constants';
import { normalizeId } from '../utils/id-normalizer.util';

export interface BulkSubmitResult {
  successCount: number;
  failureCount: number;
  errors: string[];
}

interface ApiTimeLog {
  id?: string | number;
  startDate?: string;
  dateStarted?: string;
  spentTimeHours?: number | string;
  timeSpent?: number | string;
  description?: string;
  projectId?: string | number;
  projectName?: string;
  vehicleId?: string | number;
  vehicleFleetNumber?: string;
  fleetNumber?: string;
  typeOfTime?: string;
  typeOfTimeId?: number | string;
  userId?: string | number;
  username?: string;
  userName?: string;
  createdAt?: string;
  dateUpdated?: string;
}

interface ApiTimeLogListResponse {
  items?: ApiTimeLog[];
  total?: number;
}

interface ApiCreateTimeLogRequest {
  projectId: number;
  vehicleId: number;
  userId: number;
  typeOfTimeId: number;
  timeSpent: number;
  description: string;
  dateStarted: string;
}

interface ApiUpdateTimeLogRequest {
  projectId?: number;
  vehicleId?: number;
  userId?: number;
  typeOfTimeId?: number;
  timeSpent?: number;
  description?: string;
  dateStarted?: string;
}

@Injectable({ providedIn: 'root' })
export class TimeLogService {
  private readonly baseUrl = environment.apiBaseUrl;
  private bulkEndpointUnavailable = false;

  constructor(private http: HttpClient) {}

  getTimeLog(id: string): Observable<TimeLog> {
    return this.fetchTimeLogFromApi(id);
  }

  private fetchTimeLogFromApi(id: string): Observable<TimeLog> {
    return this.http
      .get<ApiTimeLog>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.timeLogById(id)))
      .pipe(map((log) => this.normalizeTimeLog(log)));
  }

  getTimeLogs(params: TimeLogListParams): Observable<TimeLogListResponse> {
    return this.fetchTimeLogsFromApi(params);
  }

  private fetchTimeLogsFromApi(params: TimeLogListParams): Observable<TimeLogListResponse> {
    let httpParams = new HttpParams()
      .set('page', String(params.page))
      .set('pageSize', String(params.pageSize))
      .set('sortBy', this.toApiSortField(params.sortBy))
      .set('sortDirection', params.sortDirection);
    if (params.projectId) httpParams = httpParams.set('projectId', params.projectId);
    if (params.vehicleId) httpParams = httpParams.set('vehicleId', params.vehicleId);
    if (params.userId) httpParams = httpParams.set('userId', params.userId);
    if (params.typeOfTime) {
      httpParams = httpParams.set('typeOfTimeId', String(this.toApiTypeOfTimeId(params.typeOfTime)));
    }
    if (params.fromDate) httpParams = httpParams.set('fromDate', params.fromDate);
    if (params.toDate) httpParams = httpParams.set('toDate', params.toDate);
    if (params.searchTerm) httpParams = httpParams.set('searchTerm', params.searchTerm);

    return this.http
      .get<ApiTimeLogListResponse | ApiTimeLog[]>(
        buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.timeLogs),
        {
        params: httpParams,
      }
      )
      .pipe(map((res) => this.normalizeListResponse(res, params)));
  }

  createTimeLog(payload: TimeLogPayload): Observable<TimeLog> {
    const apiPayload = this.toApiCreatePayload(payload);
    return this.http
      .post<ApiTimeLog>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.timeLogs), apiPayload)
      .pipe(map((log) => this.normalizeTimeLog(log)));
  }

  /**
   * Try POST /TimeLogs/bulk first; if not available, submit sequentially and report partial failures.
   */
  bulkCreateTimeLogs(payloads: TimeLogPayload[]): Observable<BulkSubmitResult> {
    if (this.bulkEndpointUnavailable) {
      return this.submitSequential(payloads);
    }

    const apiPayloads = payloads.map((payload) => this.toApiCreatePayload(payload));
    return this.http
      .post<void>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.timeLogsBulk), apiPayloads)
      .pipe(
        map(() => ({ successCount: payloads.length, failureCount: 0, errors: [] as string[] })),
        catchError((err: HttpErrorResponse) => {
          if (err?.status === 404 || err?.status === 405) {
            this.bulkEndpointUnavailable = true;
          }
          return this.submitSequential(payloads);
        })
      );
  }

  private submitSequential(payloads: TimeLogPayload[]): Observable<BulkSubmitResult> {
    if (payloads.length === 0) {
      return of({ successCount: 0, failureCount: 0, errors: [] });
    }
    const results$ = payloads.map((payload, index) =>
      this.createTimeLog(payload).pipe(
        map(() => ({ index, success: true as const, error: undefined })),
        catchError((err) =>
          of({
            index,
            success: false as const,
            error: this.formatBulkRowError(err, index + 1),
          })
        )
      )
    );
    return forkJoin(results$).pipe(
      map((results) => {
        const successCount = results.filter((r) => r.success).length;
        const failureCount = results.filter((r) => !r.success).length;
        const errors = results.filter((r) => !r.success).map((r) => r.error!);
        return { successCount, failureCount, errors };
      })
    );
  }

  deleteTimeLog(id: string): Observable<void> {
    return this.http.delete<void>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.timeLogById(id)));
  }

  updateTimeLog(id: string, payload: Partial<TimeLogPayload>): Observable<TimeLog> {
    const apiPayload = this.toApiUpdatePayload(payload);
    return this.http
      .put<ApiTimeLog>(buildApiUrl(this.baseUrl, TIME_LOG_API_PATHS.timeLogById(id)), apiPayload)
      .pipe(map((log) => this.normalizeTimeLog(log)));
  }

  private normalizeListResponse(
    res: ApiTimeLogListResponse | ApiTimeLog[],
    params: TimeLogListParams
  ): TimeLogListResponse {
    // Mock APIs (e.g., json-server) often return plain arrays instead of { items, total }.
    if (Array.isArray(res)) {
      const all = res.map((i) => this.normalizeTimeLog(i));
      const page = Number(params?.page ?? 1);
      const pageSize = Number(params?.pageSize ?? 25);
      const start = Math.max(0, (page - 1) * pageSize);
      return {
        total: all.length,
        items: all.slice(start, start + pageSize),
      };
    }

    const items = this.extractItems(res).map((i) => this.normalizeTimeLog(i));
    const totalRaw = Number(res?.total ?? items.length);
    const total = Number.isFinite(totalRaw) && totalRaw >= items.length ? totalRaw : items.length;

    return {
      total,
      items,
    };
  }

  private extractItems(raw: unknown): ApiTimeLog[] {
    if (Array.isArray(raw)) return raw as ApiTimeLog[];
    const obj = raw as any;
    if (Array.isArray(obj?.items)) return obj.items as ApiTimeLog[];
    if (Array.isArray(obj?.data?.items)) return obj.data.items as ApiTimeLog[];
    if (Array.isArray(obj?.data)) return obj.data as ApiTimeLog[];
    if (Array.isArray(obj?.result?.items)) return obj.result.items as ApiTimeLog[];
    return [];
  }

  private normalizeTimeLog(log: ApiTimeLog): TimeLog {
    const spent = Number(log?.spentTimeHours ?? log?.timeSpent ?? 0);
    const resolvedType = this.toUiTypeOfTime(log?.typeOfTime ?? log?.typeOfTimeId);
    const userId = normalizeId(log?.userId);
    const userName = this.firstNonEmptyString(log?.userName, log?.username);
    return {
      id: normalizeId(log?.id),
      startDate: String(log?.startDate ?? log?.dateStarted ?? ''),
      spentTimeHours: Number.isFinite(spent) ? spent : 0,
      description: String(log?.description ?? ''),
      projectId: normalizeId(log?.projectId),
      projectName: log?.projectName,
      vehicleId: normalizeId(log?.vehicleId),
      vehicleFleetNumber: log?.vehicleFleetNumber ?? log?.fleetNumber,
      typeOfTime: resolvedType,
      userId,
      userName,
      createdAt: log?.createdAt ?? log?.dateUpdated,
    };
  }

  private toApiCreatePayload(payload: TimeLogPayload): ApiCreateTimeLogRequest {
    return {
      projectId: this.toRequiredNumber(payload.projectId, 'projectId'),
      vehicleId: this.toRequiredNumber(payload.vehicleId, 'vehicleId'),
      userId: this.toRequiredNumber(payload.userId, 'userId'),
      typeOfTimeId: this.toApiTypeOfTimeId(payload.typeOfTime),
      timeSpent: Number(payload.spentTimeHours ?? 0),
      description: payload.description ?? '',
      dateStarted: payload.startDate,
    };
  }

  private toApiUpdatePayload(payload: Partial<TimeLogPayload>): ApiUpdateTimeLogRequest {
    const apiPayload: ApiUpdateTimeLogRequest = {};
    if (payload.projectId !== undefined) {
      apiPayload.projectId = this.toRequiredNumber(payload.projectId, 'projectId');
    }
    if (payload.vehicleId !== undefined) {
      apiPayload.vehicleId = this.toRequiredNumber(payload.vehicleId, 'vehicleId');
    }
    if (payload.userId !== undefined) {
      apiPayload.userId = this.toRequiredNumber(payload.userId, 'userId');
    }
    if (payload.typeOfTime !== undefined) {
      apiPayload.typeOfTimeId = this.toApiTypeOfTimeId(payload.typeOfTime);
    }
    if (payload.spentTimeHours !== undefined) {
      apiPayload.timeSpent = Number(payload.spentTimeHours);
    }
    if (payload.description !== undefined) {
      apiPayload.description = payload.description;
    }
    if (payload.startDate !== undefined) {
      apiPayload.dateStarted = payload.startDate;
    }
    return apiPayload;
  }

  private toRequiredNumber(value: string | number | undefined, fieldName: string): number {
    if (value === null || value === undefined) {
      throw new Error(`Invalid ${fieldName} value`);
    }
    if (typeof value === 'string' && value.trim() === '') {
      throw new Error(`Invalid ${fieldName} value`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid ${fieldName} value`);
    }
    return parsed;
  }

  private formatBulkRowError(err: unknown, rowNumber: number): string {
    const status = Number((err as any)?.status);
    const backendMessage = this.extractApiMessage(err);
    if (status >= 400 && status < 500) {
      return `Row ${rowNumber}: API validation failed (${status})${backendMessage ? `: ${backendMessage}` : ''}`;
    }
    if (status >= 500) {
      return `Row ${rowNumber}: Server error (${status})${backendMessage ? `: ${backendMessage}` : ''}`;
    }
    return backendMessage ? `Row ${rowNumber}: ${backendMessage}` : `Row ${rowNumber} failed`;
  }

  private extractApiMessage(err: unknown): string {
    const raw = (err as any)?.error;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (raw && typeof raw === 'object') {
      const candidate =
        (raw as any).message ??
        (raw as any).title ??
        (raw as any).detail ??
        (raw as any).error;
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    const message = (err as any)?.message;
    return typeof message === 'string' ? message : '';
  }

  private firstNonEmptyString(...values: unknown[]): string | undefined {
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) return text;
    }
    return undefined;
  }

  private toApiSortField(sortBy: string): string {
    switch (sortBy) {
      case 'startDate':
        return 'dateStarted';
      case 'spentTimeHours':
        return 'timeSpent';
      case 'userId':
      case 'userName':
        return 'userId';
      case 'typeOfTime':
        return 'typeOfTimeId';
      default:
        return sortBy;
    }
  }

  private toApiTypeOfTimeId(typeOfTime: unknown): number {
    const numeric = Number(typeOfTime);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }

    switch (String(typeOfTime ?? '').trim().toLowerCase()) {
      case 'production':
        return 3;
      case 'first property inspection':
        return 2;
      case 'buybacks':
        return 4;
      case 'road/water test':
        return 5;
      case 'sign off':
        return 6;
      default:
        return 7;
    }
  }

  private toUiTypeOfTime(typeOfTime: unknown): TypeOfTime {
    const raw = String(typeOfTime ?? '').trim().toLowerCase();
    switch (raw) {
      case 'production':
      case '3':
        return 'Production';
      case 'first property inspection':
      case '1':
      case '2':
        return 'First Property Inspection';
      case 'buybacks':
      case '4':
        return 'Buybacks';
      case 'road/water test':
      case '5':
        return 'Road/Water Test';
      case 'sign off':
      case '6':
        return 'Sign Off';
      default:
        return 'Other';
    }
  }
}
