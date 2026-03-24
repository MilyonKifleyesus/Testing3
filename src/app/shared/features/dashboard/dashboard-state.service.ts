import { Injectable } from '@angular/core';
import { DashboardWidget } from '../../models/client-dashboard.models';
import { DashboardProjectOption, DashboardVehicleOption } from '../../services/dashboard-projects.service';
import { DashboardRole, DashboardStatCard } from './dashboard.types';
import type { ApiClient, ApiLocation, ApiManufacturer, ApiProject } from '../fleet-map/models/fleet-map.models';

export interface DashboardSnapshot {
  role: DashboardRole;
  widgets: DashboardWidget[];
  statCards: DashboardStatCard[];
  projects: DashboardProjectOption[];
  vehicles: DashboardVehicleOption[];
  clients: { id: string; name: string }[];
  totalVehiclesCount: number | null;
  allClientVehicles: any[];
  allClientTickets: any[];
  userIdToUsername: { [id: number]: string };
  allMapProjects: ApiProject[];
  allMapClients: ApiClient[];
  allMapManufacturers: ApiManufacturer[];
  allMapLocations: ApiLocation[];
  dashboardMapDataLoaded: boolean;
  welcomeUserName: string;
  vehicleStationLabels: string[];
  clientProfile: any;
  customerLogoName: string;
  showFilters: boolean;
  includeClosedProjects: boolean;
  selectedProject: string;
  selectedVehicle: string;
  selectedClient: string;
  currentProjectStats: any;
  stationTypeHeatmapPage: number;
  stationTypeHeatmapHasNextPage: boolean;
  stationTimeComparisonPage: number;
  stationTimeComparisonHasNextPage: boolean;
}

/**
 * Singleton service that preserves dashboard state across in-app navigation.
 * Data lives in memory only — cleared automatically on browser refresh.
 */
@Injectable({ providedIn: 'root' })
export class DashboardStateService {
  snapshot: DashboardSnapshot | null = null;
}
