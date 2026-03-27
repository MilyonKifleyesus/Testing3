import { DashboardWidget } from '../../models/client-dashboard.models';

export type DashboardRole = 'admin' | 'client';

export type DashboardResizeHandle = 'corner' | 'right' | 'bottom';

export interface DashboardStatCard {
  label: string;
  subtitle: string;
  value: string | number;
  trend: string;
  trendClass: string;
  trendUp: boolean;
  iconClass: string;
  cardVariant: 'success' | 'info' | 'danger' | 'warning';
  /** Prebuilt ApexCharts sparkline config. Null = hide sparkline row. */
  sparklineOptions: any | null;
}

export type DashboardWidgetLayoutItem = Pick<DashboardWidget, 'id' | 'width' | 'height' | 'order'>;
