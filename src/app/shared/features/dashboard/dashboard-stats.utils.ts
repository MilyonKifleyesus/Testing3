import { ProjectStats } from '../../models/client-dashboard.models';
import { DashboardStatCard } from './dashboard.types';

interface DashboardStatsSource {
  totalProjects: number;
  totalVehicles: number;
  criticalDefects: number;
  repeatedDefects: number;
}

export function resolveClientProjectStats(
  stats: ProjectStats[],
  selectedProject: string,
  selectedVehicle: string,
): ProjectStats {
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
    vehicleName: selectedVehicleStats.vehicleName,
    totalTickets: selectedVehicleStats.totalTickets,
    totalAssets: selectedVehicleStats.totalAssets,
    ticketsChangePercentage: selectedVehicleStats.ticketsChangePercentage,
    assetsChangePercentage: selectedVehicleStats.assetsChangePercentage,
    ticketsStatus: selectedVehicleStats.ticketsStatus,
    assetsStatus: selectedVehicleStats.assetsStatus,
  };
}

export function buildAdminStatCards(
  statsSource: DashboardStatsSource,
  totalProjects: number,
  totalVehiclesCount: number | null,
): DashboardStatCard[] {
  return [
    {
      label: 'Total Projects',
      subtitle: 'Active projects this month',
      value: totalProjects,
      trend: '55% Higher',
      trendClass: 'text-success',
      iconClass: 'ti ti-layout-grid',
    },
    {
      label: 'Total Vehicles',
      subtitle: 'Fleet size this month',
      value: totalVehiclesCount ?? statsSource.totalVehicles,
      trend: '5% Increased',
      trendClass: 'text-info',
      iconClass: 'ti ti-bus',
    },
    {
      label: 'Critical Issues',
      subtitle: 'Safety defects this month',
      value: statsSource.criticalDefects,
      trend: '12% Decreased',
      trendClass: 'text-danger',
      iconClass: 'ti ti-alert-triangle',
    },
    {
      label: 'Repeated Issues',
      subtitle: 'Recurring defects this month',
      value: statsSource.repeatedDefects,
      trend: '8% Increased',
      trendClass: 'text-warning',
      iconClass: 'ti ti-refresh',
    },
  ];
}

export function buildClientStatCards(
  currentProjectStats: ProjectStats,
  showFilters: boolean,
  selectedProject: string,
): DashboardStatCard[] {
  return [
    {
      label: showFilters && selectedProject !== 'all' ? `${currentProjectStats.projectName} Tickets` : 'Total Tickets',
      subtitle: showFilters && selectedProject !== 'all' ? 'Project tickets this month' : 'All projects tickets this month',
      value: currentProjectStats.totalTickets,
      trend: `${currentProjectStats.ticketsChangePercentage}% ${currentProjectStats.ticketsStatus === 'increased' ? 'Higher' : 'Lower'}`,
      trendClass: currentProjectStats.ticketsStatus === 'increased' ? 'text-success' : 'text-danger',
      iconClass: 'ti ti-ticket',
    },
    {
      label: showFilters && selectedProject !== 'all' ? `${currentProjectStats.projectName} Assets` : 'Total Assets',
      subtitle: showFilters && selectedProject !== 'all' ? 'Project assets this month' : 'Fleet size this month',
      value: currentProjectStats.totalAssets,
      trend: `${currentProjectStats.assetsChangePercentage}% ${currentProjectStats.assetsStatus === 'increased' ? 'Higher' : 'Lower'}`,
      trendClass: currentProjectStats.assetsStatus === 'increased' ? 'text-success' : 'text-danger',
      iconClass: 'ti ti-package',
    },
  ];
}
