import { Observable, defer, firstValueFrom } from 'rxjs';
import { NormalizedPagedResult, parsePagedResponse } from './paged-response.adapter';

export type FetchPageFn<T> = (page: number, pageSize: number) => Observable<unknown>;

export interface FetchAllPagesOptions {
  pageSize: number;
  maxPages: number;
  startPage?: number;
}

export function fetchAllPages<T>(
  fetchPage: FetchPageFn<T>,
  options: FetchAllPagesOptions
): Observable<NormalizedPagedResult<T>> {
  const startPage = Math.max(1, options.startPage ?? 1);
  const pageSize = Math.max(1, options.pageSize);
  const maxPages = Math.max(1, options.maxPages);

  return defer(async () => {
    const merged: T[] = [];
    let total: number | null = null;
    let page = startPage;
    let pagesFetched = 0;

    while (pagesFetched < maxPages) {
      const raw = await firstValueFrom(fetchPage(page, pageSize));
      const parsed = parsePagedResponse<T>(raw);
      const pageItems = parsed.items;

      if (parsed.total >= 0) {
        total = parsed.total;
      }

      if (pageItems.length === 0) {
        break;
      }

      merged.push(...pageItems);
      pagesFetched += 1;

      if (total != null && merged.length >= total) {
        break;
      }

      page += 1;
    }

    return {
      items: merged,
      total: total ?? merged.length,
      page: startPage,
      pageSize,
    } satisfies NormalizedPagedResult<T>;
  });
}

