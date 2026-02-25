import { DashboardProjectOption } from '../../services/dashboard-projects.service';

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
