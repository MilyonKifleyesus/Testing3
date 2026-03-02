import {
  DashboardProjectOption,
  DashboardVehicleMakeModelDatum,
} from '../../services/dashboard-projects.service';

const CLOSED_STATUSES = new Set(['closed', 'inactive', 'completed', 'complete']);

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
