import { ProjectStats } from '../../models/client-dashboard.models';
import { DashboardStatCard } from './dashboard.types';

// ─── Stats source ─────────────────────────────────────────────────────────────

interface DashboardStatsSource {
  totalProjects: number;
  totalVehicles: number;
  criticalDefects: number;
  repeatedDefects: number;
  /**
   * Optional sparkline history — wire this in when the backend exposes:
   *   GET /dashboard/stats/history?clientId={id}&projectId={id}&periods=10
   * Expected shape (oldest → newest, 10 data points each):
   *   { projects: number[], vehicles: number[], criticalIssues: number[], repeatedIssues: number[] }
   *
   * Until then, FALLBACK_SPARKLINES below is used automatically.
   */
  sparklineHistory?: {
    projects?: number[];
    vehicles?: number[];
    criticalIssues?: number[];
    repeatedIssues?: number[];
  };
}

// ─── Hardcoded fallback sparkline data ───────────────────────────────────────
// Realistic shapes that match the current trend direction for each metric.
// Remove / replace each array with the matching API field once available.

const FALLBACK_SPARKLINES = {
  // Rising: 35 → 42 (matches "55% Higher")
  projects:       [35, 36, 34, 37, 38, 36, 39, 40, 41, 42],
  // Slowly rising: 1010 → 1040 (matches "5% Increased")
  vehicles:       [1010, 1015, 1018, 1020, 1022, 1025, 1028, 1032, 1037, 1040],
  // Declining: 1620 → 1426 (matches "12% Decreased")
  criticalIssues: [1620, 1680, 1590, 1560, 1540, 1510, 1490, 1465, 1445, 1426],
  // Rising: 10400 → 11286 (matches "8% Increased")
  repeatedIssues: [10400, 10550, 10700, 10820, 10950, 11050, 11100, 11180, 11240, 11286],
};

// ─── Sparkline chart options builder ─────────────────────────────────────────

function buildSparklineOptions(data: number[], color: string): any {
  return {
    chart: {
      type: 'area',
      height: 54,
      sparkline: { enabled: true },
      animations: {
        enabled: true,
        // 'swing' gives a satisfying elastic overshoot as the line settles
        easing: 'swing',
        // Total draw duration — long enough to look deliberate
        speed: 1400,
        // Draws each data point one-by-one, left to right, like a real-time feed
        animateGradually: {
          enabled: true,
          delay: 120,   // ms between each point — slower = more dramatic "writing" effect
        },
        dynamicAnimation: {
          enabled: true,
          speed: 500,   // speed when data updates (filter change etc.)
        },
      },
    },
    series: [{ data }],
    stroke: {
      curve: 'smooth',
      width: 2.5,
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.45,
        opacityTo: 0.0,
        stops: [0, 95],
      },
    },
    colors: [color],
    // Tooltip disabled inside a stat card — card is too small
    tooltip: { enabled: false },
  };
}

// ─── Accent colors per card variant (must match SCSS --card-accent tokens) ───

const ACCENT = {
  success: '#16a34a',
  info:    '#2563eb',
  danger:  '#dc2626',
  warning: '#d97706',
} as const;

// ─── Admin stat cards ─────────────────────────────────────────────────────────

export function buildAdminStatCards(
  statsSource: DashboardStatsSource,
  totalProjects: number,
  totalVehiclesCount: number | null,
): DashboardStatCard[] {
  // Resolve sparkline data: API history wins, fallback is used when absent.
  const h = statsSource.sparklineHistory ?? {};
  const projectsLine       = h.projects       ?? FALLBACK_SPARKLINES.projects;
  const vehiclesLine       = h.vehicles       ?? FALLBACK_SPARKLINES.vehicles;
  const criticalIssuesLine = h.criticalIssues ?? FALLBACK_SPARKLINES.criticalIssues;
  const repeatedIssuesLine = h.repeatedIssues ?? FALLBACK_SPARKLINES.repeatedIssues;

  return [
    {
      label: 'Total Projects',
      subtitle: 'Active projects this month',
      value: totalProjects,
      trend: '55% Higher',
      trendClass: 'text-success',
      trendUp: true,
      iconClass: 'fas fa-project-diagram',
      cardVariant: 'success',
      sparklineOptions: buildSparklineOptions(projectsLine, ACCENT.success),
    },
    {
      label: 'Total Vehicles',
      subtitle: 'Fleet size this month',
      value: totalVehiclesCount ?? statsSource.totalVehicles,
      trend: '5% Increased',
      trendClass: 'text-info',
      trendUp: true,
      iconClass: 'fas fa-bus',
      cardVariant: 'info',
      sparklineOptions: buildSparklineOptions(vehiclesLine, ACCENT.info),
    },
    {
      label: 'Critical Issues',
      subtitle: 'Safety defects this month',
      value: statsSource.criticalDefects,
      trend: '12% Decreased',
      trendClass: 'text-danger',
      trendUp: false,
      iconClass: 'fas fa-exclamation-triangle',
      cardVariant: 'danger',
      sparklineOptions: buildSparklineOptions(criticalIssuesLine, ACCENT.danger),
    },
    {
      label: 'Repeated Issues',
      subtitle: 'Recurring defects this month',
      value: statsSource.repeatedDefects,
      trend: '8% Increased',
      trendClass: 'text-warning',
      trendUp: true,
      iconClass: 'fas fa-sync-alt',
      cardVariant: 'warning',
      sparklineOptions: buildSparklineOptions(repeatedIssuesLine, ACCENT.warning),
    },
  ];
}

// ─── Client stat cards ────────────────────────────────────────────────────────

export function buildClientStatCards(
  currentProjectStats: ProjectStats,
  showFilters: boolean,
  selectedProject: string,
): DashboardStatCard[] {
  // Resolve sparkline data: API history (ProjectStats.sparklineHistory) wins,
  // fallback is used when absent.
  const h = currentProjectStats.sparklineHistory ?? {};

  // Client fallback shapes — generic rising/falling lines
  const FALLBACK_TICKETS = [820, 880, 910, 870, 930, 950, 980, 1010, 1040, 1080];
  const FALLBACK_ASSETS  = [200, 205, 208, 210, 212, 215, 218, 220, 222, 225];

  const ticketsLine = h.tickets ?? FALLBACK_TICKETS;
  const assetsLine  = h.assets  ?? FALLBACK_ASSETS;

  const ticketsUp = currentProjectStats.ticketsStatus === 'increased';
  const assetsUp  = currentProjectStats.assetsStatus  === 'increased';

  return [
    {
      label:    showFilters && selectedProject !== 'all' ? `${currentProjectStats.projectName} Tickets` : 'Total Tickets',
      subtitle: showFilters && selectedProject !== 'all' ? 'Project tickets this month' : 'All projects tickets this month',
      value:     currentProjectStats.totalTickets,
      trend:    `${currentProjectStats.ticketsChangePercentage}% ${ticketsUp ? 'Higher' : 'Lower'}`,
      trendClass: ticketsUp ? 'text-success' : 'text-danger',
      trendUp:   ticketsUp,
      iconClass: 'fas fa-ticket-alt',
      cardVariant: 'success',
      sparklineOptions: buildSparklineOptions(ticketsLine, ticketsUp ? ACCENT.success : ACCENT.danger),
    },
    {
      label:    showFilters && selectedProject !== 'all' ? `${currentProjectStats.projectName} Assets` : 'Total Assets',
      subtitle: showFilters && selectedProject !== 'all' ? 'Project assets this month' : 'Fleet size this month',
      value:     currentProjectStats.totalAssets,
      trend:    `${currentProjectStats.assetsChangePercentage}% ${assetsUp ? 'Higher' : 'Lower'}`,
      trendClass: assetsUp ? 'text-success' : 'text-danger',
      trendUp:   assetsUp,
      iconClass: 'fas fa-box',
      cardVariant: 'info',
      sparklineOptions: buildSparklineOptions(assetsLine, assetsUp ? ACCENT.success : ACCENT.danger),
    },
  ];
}

export function resolveClientProjectStats(
  stats: ProjectStats[],
  selectedProject: string,
  selectedVehicle: string,
): ProjectStats | undefined {
  if (!stats.length) return undefined;
  const selectedProjectStats = stats.find((project) => project.projectId === selectedProject) ?? stats[0];

  if (selectedVehicle === 'all') {
    return selectedProjectStats;
  }

  const selectedVehicleStats = selectedProjectStats.vehicles.find(
    (vehicle) => vehicle.vehicleId === selectedVehicle,
  );

  if (!selectedVehicleStats) {
    return selectedProjectStats;
  }

  return {
    ...selectedProjectStats,
    vehicleName:              selectedVehicleStats.vehicleName,
    totalTickets:             selectedVehicleStats.totalTickets,
    totalAssets:              selectedVehicleStats.totalAssets,
    ticketsChangePercentage:  selectedVehicleStats.ticketsChangePercentage,
    assetsChangePercentage:   selectedVehicleStats.assetsChangePercentage,
    ticketsStatus:            selectedVehicleStats.ticketsStatus,
    assetsStatus:             selectedVehicleStats.assetsStatus,
  };
}
