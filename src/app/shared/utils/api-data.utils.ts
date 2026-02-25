export function extractArrayFromApiResponse(response: unknown): any[] {
  if (Array.isArray(response)) {
    return response;
  }
  if (!response || typeof response !== 'object') {
    return [];
  }

  const objectResponse = response as Record<string, unknown>;
  const dataObject = objectResponse['data'] as Record<string, unknown> | undefined;
  const candidates = [
    objectResponse['items'],
    objectResponse['data'],
    objectResponse['results'],
    objectResponse['vehicles'],
    dataObject?.['items'],
    dataObject?.['vehicles'],
  ];

  return (candidates.find(Array.isArray) as any[]) ?? [];
}

export function getFirstDefinedValue(source: unknown, keys: string[]): unknown {
  for (const key of keys) {
    const value = getNestedValue(source, key);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function getNestedValue(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object') {
    return undefined;
  }

  const segments = path.split('.');
  let current: any = source;

  for (const segment of segments) {
    if (current == null || typeof current !== 'object' || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

export function toText(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

export function toOptionalText(value: unknown): string | undefined {
  const normalized = toText(value, '').trim();
  return normalized ? normalized : undefined;
}
