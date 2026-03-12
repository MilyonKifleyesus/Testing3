import { HttpErrorResponse } from '@angular/common/http';

export type LogoPayloadMode = 'autoRetryRawBase64' | 'rawBase64' | 'dataUrl';

const DATA_URL_BASE64_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;

function asErrorString(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase();
  if (value == null) return '';
  if (typeof value !== 'object') return String(value).toLowerCase();
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

export function isDataUrlBase64(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return DATA_URL_BASE64_PATTERN.test(value.trim());
}

export function stripDataUrlPrefix(value: string): string {
  return value.replace(DATA_URL_BASE64_PATTERN, '').trim();
}

export function prepareLogoForMode(
  value: string | null | undefined,
  mode: LogoPayloadMode
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (mode === 'dataUrl') return trimmed;
  if (mode === 'rawBase64') {
    return isDataUrlBase64(trimmed) ? stripDataUrlPrefix(trimmed) : trimmed;
  }
  return trimmed;
}

export function shouldRetryWithRawBase64(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  if (error.status !== 400 && error.status !== 415) return false;

  const text = [
    asErrorString(error.message),
    asErrorString(error.error),
    asErrorString((error.error as Record<string, unknown> | null)?.['errors']),
    asErrorString((error.error as Record<string, unknown> | null)?.['title']),
    asErrorString((error.error as Record<string, unknown> | null)?.['detail']),
  ].join(' ');

  return (
    text.includes('logo') ||
    text.includes('base64') ||
    text.includes('image') ||
    text.includes('invalid') ||
    text.includes('format')
  );
}
