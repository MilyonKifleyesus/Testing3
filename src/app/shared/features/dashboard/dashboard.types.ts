import { DashboardWidget } from '../../models/client-dashboard.models';

export type DashboardRole = 'admin' | 'client';

export type DashboardResizeHandle = 'corner' | 'right' | 'bottom';

export interface DashboardStatCard {
  label: string;
  subtitle: string;
  value: string | number;
  trend: string;
  trendClass: string;
  iconClass: string;
}

export type DashboardWidgetLayoutItem = Pick<DashboardWidget, 'id' | 'width' | 'height' | 'order'>;
