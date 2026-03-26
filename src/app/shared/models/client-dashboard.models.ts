export type DashboardWidgetType =
  | 'chart'
  | 'map'
  | 'stat'
  | 'gauge'
  | 'treemap'
  | 'heatmap'
  | 'timeline'
  | 'bar'
  | 'wordcloud'
  | 'table';

export interface DashboardWidget {
  id: string;
  title: string;
  subtitle: string;
  type: DashboardWidgetType;
  chartOptions?: any;
  width: number;
  height: number;
  order: number;
  loading?: boolean;
}

export interface ClientProfile {
  id: string;
  name: string;
  clientId: string;
  vehicle: string;
  logoUrl: string;
  company?: string;
  email?: string;
  phone?: string;
}

export interface ClientProject {
  id: string;
  name: string;
}

export interface ClientVehicle {
  id: string;
  name: string;
}

export interface VehicleStats {
  vehicleId: string;
  vehicleName: string;
  totalTickets: number;
  totalAssets: number;
  ticketsChangePercentage: number | null | undefined;
  assetsChangePercentage: number | null | undefined;
  ticketsStatus: 'increased' | 'decreased';
  assetsStatus: 'increased' | 'decreased';
}

export interface ProjectInspector {
  name: string;
  initials: string;
  avatarUrl?: string | null;
}

export type ProjectType = 'New Build' | 'Condition Assessment' | 'PDI' | 'Mid-Life Overhaul';

export interface ProjectStats {
  projectId: string;
  projectName: string;
  projectType?: ProjectType | string | null;
  totalTickets: number;
  totalAssets: number;
  ticketsYesterday?: number | null;
  ticketsChangePercentage: number | null | undefined;
  assetsChangePercentage: number | null | undefined;
  ticketsStatus: 'increased' | 'decreased';
  assetsStatus: 'increased' | 'decreased';
  vehicleName?: string;
  vehicles: VehicleStats[];
  // Enriched from GET /tickets/dashboard?projectId={id}
  safetyCriticalTickets?: number;
  repeatedTickets?: number;
  repeatedPercent?: number;
  safetyCriticalPercent?: number;
  // Enriched from GET /Projects?clientId={id}
  progress?: number;
  // Enriched from GET /StationTrackers?projectId={id}
  lastActivityDate?: string | null;
  lastStationName?: string | null;
  inspectors?: ProjectInspector[];
  /**
   * Optional sparkline history — populated when
   * GET /dashboard/stats/history?projectId={id}&periods=10 is available.
   * Shape: last N data points ordered oldest → newest.
   * When absent, the stat card falls back to hardcoded demo data.
   */
  sparklineHistory?: {
    tickets?: number[];
    assets?: number[];
  };
}

export interface TicketStatusItem {
  name: string;
  value: number;
}

export interface TicketsByStatusData {
  categories?: string[];
  values?: number[];
  ticketsByStatus?: TicketStatusItem[];
}

export interface RecentActivity {
  lastSync: string;
  ticketsGenerated: number;
  hoursWorked: number;
  inspector: string;
}

export interface ClientDashboardResponse {
  clientProfile: ClientProfile;
  filters: {
    projects: ClientProject[];
    vehicles: ClientVehicle[];
  };
  projectStats: ProjectStats[];
  widgets: DashboardWidget[];
  ticketsByStatus: TicketsByStatusData;
  recentActivities: RecentActivity[];
}
