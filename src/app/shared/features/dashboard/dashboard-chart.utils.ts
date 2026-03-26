import {
  DashboardProjectOption,
  DashboardVehicleMakeModelDatum,
  ProjectsByAreaPayload,
} from '../../services/dashboard-projects.service';

const CLOSED_STATUSES = new Set(['closed', 'inactive', 'completed', 'complete']);

// Maps variant/verbose area names to their canonical short form
const AREA_NAME_ALIASES: Record<string, string> = {
  'vehicle interior': 'Interior',
  'vehicle exterior': 'Exterior',
  'engine compartment': 'Engine',
  'vehicle understructure': 'UnderCarriage',
};

const DEFECT_LOCATION_PATTERN = /^defect\s+location\s+\d+$/i;

/**
 * Normalises a raw area name from the API:
 * - Returns null for placeholder/unknown values that should be hidden.
 * - Merges known aliases into their canonical name.
 */
export function normalizeAreaName(raw: string): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'unknown') return null;
  if (DEFECT_LOCATION_PATTERN.test(trimmed)) return null;
  return AREA_NAME_ALIASES[lower] ?? trimmed;
}

/**
 * Normalises and de-duplicates an array of area entries, summing counts
 * for any entries that map to the same canonical area name.
 */
export function normalizeAreaEntries(
  entries: Array<{ area: string; count: number }>,
): Array<{ area: string; count: number }> {
  const merged = new Map<string, number>();
  for (const entry of entries) {
    const name = normalizeAreaName(entry.area);
    if (!name) continue;
    merged.set(name, (merged.get(name) ?? 0) + entry.count);
  }
  return Array.from(merged.entries()).map(([area, count]) => ({ area, count }));
}

function isProjectClosed(project: DashboardProjectOption): boolean {
  if (project.isClosed === true) return true;

  const normalizedStatus = String(project.status ?? '').trim().toLowerCase();
  if (!normalizedStatus) return false;

  return CLOSED_STATUSES.has(normalizedStatus);
}

export function buildProjectStatusChartOptions(
  baseChartOptions: any,
  projects: DashboardProjectOption[],
): any {
  const projectItems = projects.filter((project) => String(project.id).trim().toLowerCase() !== 'all');

  if (!projectItems.length) {
    return {
      ...baseChartOptions,
      series: [0, 0],
      labels: ['Open Projects', 'Closed Projects'],
    };
  }

  const closedProjects = projectItems.filter(isProjectClosed).length;
  const openProjects = Math.max(0, projectItems.length - closedProjects);

  return {
    ...baseChartOptions,
    series: [openProjects, closedProjects],
    labels: ['Open Projects', 'Closed Projects'],
  };
}

export function buildVehiclesByMakeModelChartOptions(
  baseChartOptions: any,
  items: DashboardVehicleMakeModelDatum[],
): any {
  return buildVehicleDistributionChartOptions(baseChartOptions, items);
}

export function buildVehiclesByPropulsionTypeChartOptions(
  baseChartOptions: any,
  items: DashboardVehicleMakeModelDatum[],
): any {
  return buildVehicleDistributionChartOptions(baseChartOptions, items);
}

/**
 * Extracts the projectsByArea block from a tickets-dashboard API payload.
 * Handles three envelope shapes:
 *   payload.projectsByArea | payload.data.projectsByArea | payload.result.projectsByArea
 * Returns null when the field is absent or malformed.
 */
export function extractProjectsByAreaData(payload: any): ProjectsByAreaPayload | null {
  const raw: any =
    payload?.projectsByArea ??
    payload?.data?.projectsByArea ??
    payload?.result?.projectsByArea ??
    null;

  if (!raw) return null;

  const projectNames: string[] = Array.isArray(raw.projectNames)
    ? raw.projectNames
        .map((n: any) => String(n ?? '').trim())
        .filter((n: string) => n.length > 0)
    : [];

  const areas = Array.isArray(raw.areas)
    ? raw.areas
        .filter((a: any) => typeof a === 'object' && a !== null)
        .map((a: any) => ({
          name: String(a?.name ?? '').trim(),
          data: Array.isArray(a?.data)
            ? a.data.map((v: any) => {
                const n = Number(v ?? 0);
                return Number.isFinite(n) ? n : 0;
              })
            : [],
        }))
        .filter((a: { name: string; data: number[] }) => a.name.length > 0)
    : [];

  if (projectNames.length === 0 || areas.length === 0) return null;

  return { projectNames, areas };
}

/**
 * Builds stacked-bar chart options for widget-10 from a validated
 * ProjectsByAreaPayload. Merges into the provided base template so
 * colours, fonts and other visual settings are preserved.
 */
export function buildProjectsByAreaChartOptions(
  baseChartOptions: any,
  data: ProjectsByAreaPayload,
): any {
  return {
    ...baseChartOptions,
    xaxis: {
      ...(baseChartOptions?.xaxis ?? {}),
      categories: data.projectNames,
    },
    series: data.areas.map(area => ({ name: area.name, data: area.data })),
  };
}

function buildVehicleDistributionChartOptions(
  baseChartOptions: any,
  items: DashboardVehicleMakeModelDatum[],
): any {
  const validItems = (items ?? [])
    .filter((item) => !!String(item?.label ?? '').trim())
    .filter((item) => Number(item?.count ?? 0) > 0);

  if (!validItems.length) {
    return {
      ...baseChartOptions,
      series: [1],
      labels: ['No Vehicles'],
    };
  }

  return {
    ...baseChartOptions,
    series: validItems.map((item) => Number(item.count ?? 0)),
    labels: validItems.map((item) => String(item.label ?? '').trim()),
  };
}
