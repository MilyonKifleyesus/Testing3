export type PagedEnvelope<T> = {
  items?: T[];
  total?: number;
  page?: number;
  pageSize?: number;
};

export type NormalizedPagedResult<T> = {
  items: T[];
  total: number;
  page: number | null;
  pageSize: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveItems<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) {
    return raw as T[];
  }

  const record = asRecord(raw);
  if (!record) return [];

  const directCandidates: unknown[] = [
    record['items'],
    record['users'],
    record['clients'],
    record['projects'],
    record['vehicles'],
    record['locations'],
    record['manufacturers'],
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) return candidate as T[];
  }

  const data = asRecord(record['data']);
  if (data) {
    const nestedCandidates: unknown[] = [
      data['items'],
      data['users'],
      data['clients'],
      data['projects'],
      data['vehicles'],
      data['locations'],
      data['manufacturers'],
    ];
    for (const candidate of nestedCandidates) {
      if (Array.isArray(candidate)) return candidate as T[];
    }
  }

  const result = asRecord(record['result']);
  if (result) {
    const nestedCandidates: unknown[] = [
      result['items'],
      result['users'],
      result['clients'],
      result['projects'],
      result['vehicles'],
      result['locations'],
      result['manufacturers'],
    ];
    for (const candidate of nestedCandidates) {
      if (Array.isArray(candidate)) return candidate as T[];
    }
  }

  return [];
}

function resolveTotal(raw: unknown, fallback: number): number {
  const record = asRecord(raw);
  if (!record) return fallback;

  const data = asRecord(record['data']);
  const result = asRecord(record['result']);
  const pagination = asRecord(record['pagination']);
  const dataPagination = data ? asRecord(data['pagination']) : null;

  const candidates: unknown[] = [
    record['totalCount'],
    record['totalItems'],
    record['totalRecords'],
    record['total'],
    record['count'],
    data?.['totalCount'],
    data?.['totalItems'],
    data?.['totalRecords'],
    data?.['total'],
    data?.['count'],
    result?.['totalCount'],
    result?.['totalItems'],
    result?.['totalRecords'],
    result?.['total'],
    result?.['count'],
    pagination?.['totalCount'],
    pagination?.['totalItems'],
    pagination?.['totalRecords'],
    pagination?.['total'],
    pagination?.['count'],
    dataPagination?.['totalCount'],
    dataPagination?.['totalItems'],
    dataPagination?.['totalRecords'],
    dataPagination?.['total'],
    dataPagination?.['count'],
  ];

  for (const candidate of candidates) {
    const parsed = parseNullableNumber(candidate);
    // A valid total must be >= the number of items on the current page.
    // If it's less, it's likely a page number or page count, not a record count.
    if (parsed != null && parsed >= fallback) return parsed;
  }

  return fallback;
}

function resolvePage(raw: unknown): number | null {
  const record = asRecord(raw);
  if (!record) return null;

  const data = asRecord(record['data']);
  const result = asRecord(record['result']);
  const pagination = asRecord(record['pagination']);
  const dataPagination = data ? asRecord(data['pagination']) : null;

  const candidates: unknown[] = [
    record['page'],
    record['pageNumber'],
    data?.['page'],
    data?.['pageNumber'],
    result?.['page'],
    result?.['pageNumber'],
    pagination?.['page'],
    pagination?.['pageNumber'],
    dataPagination?.['page'],
    dataPagination?.['pageNumber'],
  ];

  for (const candidate of candidates) {
    const parsed = parseNullableNumber(candidate);
    if (parsed != null && parsed > 0) return parsed;
  }

  return null;
}

function resolvePageSize(raw: unknown): number | null {
  const record = asRecord(raw);
  if (!record) return null;

  const data = asRecord(record['data']);
  const result = asRecord(record['result']);
  const pagination = asRecord(record['pagination']);
  const dataPagination = data ? asRecord(data['pagination']) : null;

  const candidates: unknown[] = [
    record['pageSize'],
    data?.['pageSize'],
    result?.['pageSize'],
    pagination?.['pageSize'],
    dataPagination?.['pageSize'],
  ];

  for (const candidate of candidates) {
    const parsed = parseNullableNumber(candidate);
    if (parsed != null && parsed > 0) return parsed;
  }

  return null;
}

export function parsePagedResponse<T>(raw: unknown): NormalizedPagedResult<T> {
  const items = resolveItems<T>(raw);
  return {
    items,
    total: resolveTotal(raw, items.length),
    page: resolvePage(raw),
    pageSize: resolvePageSize(raw),
  };
}

