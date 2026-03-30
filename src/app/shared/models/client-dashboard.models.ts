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
  ticketsStatus: 'increased' | 'decreased' | null | undefined;
  assetsStatus: 'increased' | 'decreased';
}

export interface ProjectInspector {
  name: string;
  initials: string;
  avatarUrl?: string | null;
}

export type ProjectType = 'New Build' | 'Condition Assessment' | 'PDI' | 'Mid-Life Overhaul' | 'Audit';

export interface ProjectStats {
  projectId: string;
  projectName: string;
  clientName?: string | null;
  clientLogoUrl?: string | null;
  manufacturerName?: string | null;
  manufacturerLogoUrl?: string | null;
  projectType?: ProjectType | string | null;
  totalTickets: number;
  totalAssets: number;
  ticketsYesterday?: number | null;
  ticketsChangePercentage: number | null | undefined;
  assetsChangePercentage: number | null | undefined;
  ticketsStatus: 'increased' | 'decreased' | null | undefined;
  assetsStatus: 'increased' | 'decreased';
  vehicleName?: string;
  vehicles: VehicleStats[];
  // Enriched from GET /tickets/dashboard?projectId={id}
  safetyCriticalTickets?: number;
  repeatedTickets?: number;
  repeatedPercent?: number | null;
  safetyCriticalPercent?: number | null;
  // Enriched from GET /Projects?clientId={id}
  progress?: number;
  // Enriched from GET /StationTrackers?projectId={id}
  lastActivityDate?: string | null;
  lastStationName?: string | null;
  inspectors?: ProjectInspector[];
  status?: string | null;
  statusMeta?: string | null;
  statusTone?: string | null;
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

export interface TicketsByVehicleItem {
  vehicleId?: string;
  vehicleName: string;
  openCount: number;
  closedCount: number;
}

export interface TicketsByVehicleData {
  ticketsByVehicle?: TicketsByVehicleItem[];
}

export interface RecentActivity {
  lastSync: string;
  ticketsGenerated: number;
  hoursWorked: number;
  inspector: string;
}

export interface InspectorTimeEntry {
  id: number;
  name: string;
  avatarUrl?: string | null;
  hours: number;
  inspections: number;
  avgHoursPerInspection: number;
  trendPercent?: number;
  projectCount?: number;
}

export interface InspectionTimeData {
  title: string;
  dateRange: { start: string; end: string };
  totals: { hours: number; inspections: number };
  inspectors: InspectorTimeEntry[];
}

export interface ProjectDurationItem {
  projectId: string;
  projectName: string;
  projectType: string;
  durationDays: number;
  startDate: string | null;
  endDate: string | null;
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
