import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, shareReplay, throwError } from 'rxjs';
import {
  AggregatedWordCloudResult,
  DefectWordCloudBackendFilters,
  InspectionAreaOption,
  TicketApiItem,
  WordCloudDatum,
} from './defect-word-cloud.models';

@Injectable({ providedIn: 'root' })
export class DefectWordCloudService {
  private readonly http = inject(HttpClient);
  private readonly sampleDataUrl = '/data/defect-word-cloud-tickets.json';

  private sampleTickets$?: Observable<TicketApiItem[]>;
  private readonly wordCloudCache = new Map<string, Observable<AggregatedWordCloudResult>>();
  private readonly inspectionAreaCache = new Map<string, Observable<InspectionAreaOption[]>>();

  getWordCloudData(
    filters: DefectWordCloudBackendFilters,
    options: { forceRefresh?: boolean } = {},
  ): Observable<AggregatedWordCloudResult> {
    const normalizedFilters = this.normalizeBackendFilters(filters);
    const cacheKey = this.createBackendSignature(normalizedFilters);

    if (options.forceRefresh) {
      this.clearCaches();
    }

    const cached = this.wordCloudCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const request$ = this.getSampleTickets().pipe(
      map((tickets) => this.filterTickets(tickets, normalizedFilters)),
      map((tickets) => this.aggregateDescriptions(tickets)),
      catchError((error) => {
        this.wordCloudCache.delete(cacheKey);
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.wordCloudCache.set(cacheKey, request$);
    return request$;
  }

  getInspectionAreaOptions(
    projectId?: string | null,
    options: { forceRefresh?: boolean } = {},
  ): Observable<InspectionAreaOption[]> {
    const normalizedProjectId = this.normalizeProjectId(projectId);
    const cacheKey = normalizedProjectId ?? 'all-projects';

    if (options.forceRefresh) {
      this.clearCaches();
    }

    const cached = this.inspectionAreaCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const request$ = this.getSampleTickets().pipe(
      map((tickets) => this.filterTickets(tickets, { projectId: normalizedProjectId })),
      map((tickets) => this.extractInspectionAreas(tickets)),
      catchError((error) => {
        this.inspectionAreaCache.delete(cacheKey);
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.inspectionAreaCache.set(cacheKey, request$);
    return request$;
  }

  createBackendSignature(filters: DefectWordCloudBackendFilters): string {
    const normalizedFilters = this.normalizeBackendFilters(filters);
    return JSON.stringify(normalizedFilters);
  }

  normalizeDescriptionKey(description: string | null | undefined): string | null {
    const display = this.normalizeDescriptionDisplay(description);
    return display ? display.toLowerCase() : null;
  }

  normalizeDescriptionDisplay(description: string | null | undefined): string | null {
    if (typeof description !== 'string') {
      return null;
    }

    const collapsed = description.replace(/\s+/g, ' ').trim();
    return collapsed ? collapsed : null;
  }

  toUserMessage(error: unknown): string {
    const status = (error as { status?: number } | null)?.status;
    const message = (error as { message?: string } | null)?.message;

    if (typeof status === 'number' && status > 0) {
      return `Request failed (${status}).`;
    }

    return message && message.trim() ? message : 'Unable to load defect data.';
  }

  private getSampleTickets(): Observable<TicketApiItem[]> {
    if (this.sampleTickets$) {
      return this.sampleTickets$;
    }

    this.sampleTickets$ = this.http.get<unknown>(this.sampleDataUrl).pipe(
      map((response) => this.parseTickets(response)),
      catchError((error) => {
        this.sampleTickets$ = undefined;
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    return this.sampleTickets$;
  }

  private clearCaches(): void {
    this.sampleTickets$ = undefined;
    this.wordCloudCache.clear();
    this.inspectionAreaCache.clear();
  }

  private parseTickets(response: unknown): TicketApiItem[] {
    if (Array.isArray(response)) {
      return response as TicketApiItem[];
    }

    if (
      response
      && typeof response === 'object'
      && Array.isArray((response as { items?: unknown[] }).items)
    ) {
      return (response as { items: TicketApiItem[] }).items;
    }

    throw new Error('Sample defect word cloud data is not in a valid ticket array format.');
  }

  private filterTickets(
    tickets: TicketApiItem[],
    filters: DefectWordCloudBackendFilters,
  ): TicketApiItem[] {
    const normalizedFilters = this.normalizeBackendFilters(filters);

    return tickets.filter((ticket) => {
      if (
        normalizedFilters.projectId
        && this.normalizeId(ticket.projectId == null ? undefined : String(ticket.projectId)) !== normalizedFilters.projectId
      ) {
        return false;
      }

      if (
        normalizedFilters.defectLocationId
        && this.normalizeId(ticket.defectLocationId == null ? undefined : String(ticket.defectLocationId)) !== normalizedFilters.defectLocationId
      ) {
        return false;
      }

      if (
        normalizedFilters.vehicleId
        && this.normalizeId(ticket.vehicleId == null ? undefined : String(ticket.vehicleId)) !== normalizedFilters.vehicleId
      ) {
        return false;
      }

      const createdDate = this.extractDateOnly(ticket.createdAt);
      if (normalizedFilters.dateFrom && (!createdDate || createdDate < normalizedFilters.dateFrom)) {
        return false;
      }

      if (normalizedFilters.dateTo && (!createdDate || createdDate > normalizedFilters.dateTo)) {
        return false;
      }

      return true;
    });
  }

  private normalizeBackendFilters(filters: DefectWordCloudBackendFilters): DefectWordCloudBackendFilters {
    return {
      projectId: this.normalizeProjectId(filters.projectId),
      defectLocationId: this.normalizeId(filters.defectLocationId),
      vehicleId: this.normalizeId(filters.vehicleId),
      dateFrom: this.normalizeDate(filters.dateFrom),
      dateTo: this.normalizeDate(filters.dateTo),
    };
  }

  private normalizeProjectId(projectId?: string | null): string | undefined {
    const normalized = this.normalizeId(projectId);
    if (!normalized || normalized === 'all') {
      return undefined;
    }
    return normalized;
  }

  private normalizeId(value?: string | null): string | undefined {
    if (value == null) {
      return undefined;
    }

    const normalized = String(value).trim();
    return normalized ? normalized : undefined;
  }

  private normalizeDate(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
  }

  private aggregateDescriptions(tickets: TicketApiItem[]): AggregatedWordCloudResult {
    const descriptionMap = new Map<string, WordCloudDatum>();
    let validDescriptionCount = 0;

    for (const ticket of tickets) {
      const display = this.normalizeDescriptionDisplay(ticket.ticketDescription);
      const key = this.normalizeDescriptionKey(ticket.ticketDescription);
      if (!display || !key) {
        continue;
      }

      validDescriptionCount += 1;
      const existing = descriptionMap.get(key);
      if (existing) {
        existing.value += 1;
        continue;
      }

      descriptionMap.set(key, {
        key,
        text: display,
        value: 1,
      });
    }

    const words = Array.from(descriptionMap.values()).sort((left, right) => {
      if (right.value !== left.value) {
        return right.value - left.value;
      }
      return left.text.localeCompare(right.text);
    });

    return {
      words,
      totalTickets: tickets.length,
      validDescriptionCount,
      uniqueDescriptionCount: words.length,
    };
  }

  private extractInspectionAreas(tickets: TicketApiItem[]): InspectionAreaOption[] {
    const optionsMap = new Map<string, InspectionAreaOption>();

    for (const ticket of tickets) {
      const id = this.normalizeId(ticket.defectLocationId == null ? undefined : String(ticket.defectLocationId));
      const name = typeof ticket.defectLocationName === 'string'
        ? ticket.defectLocationName.trim()
        : '';

      if (!id || !name || optionsMap.has(id)) {
        continue;
      }

      optionsMap.set(id, { id, name });
    }

    return Array.from(optionsMap.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  private extractDateOnly(value?: string | null): string | null {
    if (!value) {
      return null;
    }

    const raw = String(value).trim();
    if (!raw) {
      return null;
    }

    const dateOnly = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      return dateOnly;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString().slice(0, 10);
  }
}
