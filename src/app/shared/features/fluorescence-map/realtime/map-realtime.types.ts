export type RealtimeConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'polling';

export type MapEntityType = 'Project' | 'Client' | 'Location' | 'Manufacturer';
export type MapChangeType = 'Created' | 'Updated' | 'Deleted';

export interface MapChangeEvent<T = unknown> {
  entity: MapEntityType;
  action: MapChangeType;
  id: string;
  payload: T | null;
  timestampUtc: string;
}

const ENTITY_BY_KEY: Record<string, MapEntityType> = {
  project: 'Project',
  client: 'Client',
  location: 'Location',
  manufacturer: 'Manufacturer',
};

const ACTION_BY_KEY: Record<string, MapChangeType> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getFirstProp(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function normalizeEntity(value: unknown): MapEntityType | null {
  if (typeof value !== 'string') return null;
  return ENTITY_BY_KEY[value.trim().toLowerCase()] ?? null;
}

function normalizeAction(value: unknown): MapChangeType | null {
  if (typeof value !== 'string') return null;
  return ACTION_BY_KEY[value.trim().toLowerCase()] ?? null;
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = (typeof value === 'number' ? String(value) : value).trim();
  return id.length > 0 ? id : null;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0 && !Number.isNaN(Date.parse(trimmed))) {
      return new Date(trimmed).toISOString();
    }
  }
  return new Date().toISOString();
}

export function normalizeMapChangeEvent(raw: unknown): MapChangeEvent | null {
  const record = asRecord(raw);
  if (!record) return null;

  const entity = normalizeEntity(getFirstProp(record, ['entity', 'Entity']));
  const action = normalizeAction(getFirstProp(record, ['action', 'Action']));
  const id = normalizeId(getFirstProp(record, ['id', 'Id']));
  if (!entity || !action || !id) return null;

  const payload = getFirstProp(record, ['payload', 'Payload']) ?? null;
  const timestampUtc = normalizeTimestamp(
    getFirstProp(record, ['timestampUtc', 'TimestampUtc', 'timestampUTC', 'TimestampUTC'])
  );

  return {
    entity,
    action,
    id,
    payload,
    timestampUtc,
  };
}
