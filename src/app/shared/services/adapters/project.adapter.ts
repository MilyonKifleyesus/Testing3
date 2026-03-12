import { normalizeEntityLocations } from './location.adapter';

export interface ApiProjectLike {
  id?: number | string | null;
  project_id?: number | string | null;
  name?: string | null;
  projectName?: string | null;
  project_name?: string | null;
  client?: string | null;
  clientId?: string | number | null;
  projectTypeName?: string | null;
  projectType?: string | null;
  assessmentType?: string | null;
  assessment_type?: string | null;
  projectTypeId?: number | string | null;
  locationIds?: Array<number | string | null> | null;
  locationId?: number | string | null;
  manufacturerLocationId?: string | number | null;
  factory_id?: number | string | null;
  locations?: unknown;
  closed?: boolean | null;
  status?: string | null;
  lastUpdate?: string | null;
  contract?: string | null;
  hasRoadTest?: boolean | null;
}

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface NormalizedProject {
  id: number | string;
  projectName: string;
  clientName: string | null;
  clientId: string | null;
  assessmentType: string;
  projectTypeId: number | null;
  projectTypeName: string | null;
  locationIds: number[];
  locationId: number | null;
  manufacturerLocationId: string | null;
  locations: Array<{ id: number; latitude: number; longitude: number }>;
  closed: boolean | null;
  status: string | null;
  lastUpdate: string | null;
  contract: string | null;
  hasRoadTest: boolean | null;
}

export function adaptApiProject(api: ApiProjectLike): NormalizedProject | null {
  const id = api.project_id ?? api.id;
  if (id == null || id === '') return null;

  const locations = normalizeEntityLocations(api.locations);
  const fallbackLocationId = parseNullableNumber(api.locationId);
  const locationIdsFromArray = Array.isArray(api.locationIds)
    ? Array.from(new Set(api.locationIds
      .map((value) => parseNullableNumber(value))
      .filter((value): value is number => value != null)))
    : [];
  const locationIds = locationIdsFromArray.length > 0 ? locationIdsFromArray : locations.map((location) => location.id);
  if (locationIds.length === 0 && fallbackLocationId != null) {
    locationIds.push(fallbackLocationId);
  }

  const primaryLocationId = locationIds.length > 0 ? locationIds[0] : null;
  const fallbackManufacturerLocationId =
    parseNullableNumber(api.manufacturerLocationId) ??
    parseNullableNumber(api.factory_id) ??
    primaryLocationId;

  const status =
    typeof api.closed === 'boolean'
      ? api.closed
        ? 'Closed'
        : 'Open'
      : (api.status ?? null);

  return {
    id,
    projectName: String(api.name ?? api.projectName ?? api.project_name ?? '').trim(),
    clientName: api.client != null ? String(api.client).trim() : null,
    clientId: api.clientId != null ? String(api.clientId).trim() : null,
    assessmentType: String(
      api.assessment_type ??
      api.assessmentType ??
      api.projectTypeName ??
      api.projectType ??
      ''
    ).trim(),
    projectTypeId: parseNullableNumber(api.projectTypeId),
    projectTypeName: api.projectTypeName != null ? String(api.projectTypeName).trim() : null,
    locationIds,
    locationId: primaryLocationId,
    manufacturerLocationId:
      fallbackManufacturerLocationId != null ? String(fallbackManufacturerLocationId) : null,
    locations,
    closed: typeof api.closed === 'boolean' ? api.closed : null,
    status,
    lastUpdate: api.lastUpdate ?? null,
    contract: api.contract ?? null,
    hasRoadTest: typeof api.hasRoadTest === 'boolean' ? api.hasRoadTest : null,
  };
}
