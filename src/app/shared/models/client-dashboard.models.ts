export type DashboardWidgetType =
  | 'chart'
  | 'stat'
  | 'gauge'
  | 'treemap'
  | 'heatmap'
  | 'timeline'
  | 'bar'
  | 'map';

export interface DashboardWidget {
  id: string;
  title: string;
  subtitle: string;
  type: DashboardWidgetType;
  chartOptions?: any;
  width: number;
  height: number;
  order: number;
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
  ticketsChangePercentage: number;
  assetsChangePercentage: number;
  ticketsStatus: 'increased' | 'decreased';
  assetsStatus: 'increased' | 'decreased';
}

export interface ProjectStats {
  projectId: string;
  projectName: string;
  totalTickets: number;
  totalAssets: number;
  ticketsChangePercentage: number;
  assetsChangePercentage: number;
  ticketsStatus: 'increased' | 'decreased';
  assetsStatus: 'increased' | 'decreased';
  vehicleName?: string;
  vehicles: VehicleStats[];
}

export interface TicketsByStatusData {
  categories: string[];
  values: number[];
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
