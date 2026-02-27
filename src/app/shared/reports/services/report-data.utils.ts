import { getFirstDefinedValue } from '../../utils/api-data.utils';

export function extractReportItems(response: unknown): any[] {
  const objectResponse = response as any;

  const candidates = [
    response,
    objectResponse?.$values,
    objectResponse?.data,
    objectResponse?.data?.$values,
    objectResponse?.data?.items,
    objectResponse?.data?.vehicles,
    objectResponse?.items,
    objectResponse?.results,
    objectResponse?.value,
    objectResponse?.value?.$values,
    objectResponse?.payload?.items,
    objectResponse?.vehicles,
  ].filter(Array.isArray) as any[][];

  if (!candidates.length) {
    return [];
  }

  return candidates.reduce((longest, current) =>
    current.length > longest.length ? current : longest,
  );
}

export function extractReportTotalCount(response: unknown, fallbackCount: number): number {
  const total = toPositiveNumber(
    firstDefined(response, ['totalCount', 'total', 'count', 'recordCount', 'recordsTotal']),
  );

  return total ?? fallbackCount;
}

export function firstDefined(source: unknown, keys: string[]): unknown {
  return getFirstDefinedValue(source, keys);
}

export function toPositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function toTextValue(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function toOptionalTextValue(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}
