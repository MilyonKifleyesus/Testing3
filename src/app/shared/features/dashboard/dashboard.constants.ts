import { RecentActivity } from '../../models/client-dashboard.models';
import { DashboardWidgetLayoutItem } from './dashboard.types';

export const DASHBOARD_LAYOUT_STORAGE_KEY = 'buspulse_common_dashboard_layout';

export const PROJECT_TYPE_LOOKUP: Record<number, string> = {
  1: 'New Build',
  2: 'Condition Assessment',
  3: 'PDI',
  4: 'Mid-Life Overhaul',
};

export const CLIENT_COMPACT_HIDDEN_WIDGET_IDS = ['widget-2', 'widget-10', 'widget-11', 'widget-12', 'widget-13'];

export const DEFAULT_WIDGET_LAYOUT: DashboardWidgetLayoutItem[] = [
  { id: 'widget-map', width: 12, height: 640, order: 1 },
  { id: 'widget-1', width: 4, height: 400, order: 2 },
  { id: 'widget-2', width: 4, height: 400, order: 3 },
  { id: 'widget-3', width: 4, height: 400, order: 4 },
  { id: 'widget-4', width: 9, height: 470, order: 5 },
  { id: 'widget-5', width: 3, height: 470, order: 6 },
  { id: 'widget-6', width: 12, height: 450, order: 7 },
  { id: 'widget-7', width: 3, height: 450, order: 9.5 },
  { id: 'widget-8', width: 9, height: 450, order: 9 },
  { id: 'widget-9', width: 4, height: 450, order: 10 },
  { id: 'widget-10', width: 8, height: 450, order: 11 },
  { id: 'widget-16', width: 12, height: 620, order: 12 },
  { id: 'widget-project-activities', width: 12, height: 620, order: 12.05 },
  { id: 'widget-14', width: 4, height: 500, order: 12.1 },
  { id: 'widget-11', width: 12, height: 500, order: 13 },
  { id: 'widget-12', width: 12, height: 450, order: 14 },
  { id: 'widget-15', width: 12, height: 450, order: 15 },
  { id: 'widget-13', width: 12, height: 450, order: 16 },
  { id: 'widget-wordcloud', width: 8, height: 450, order: 16.5 },
];

export const ADMIN_DEFAULT_WIDGET_LAYOUT: DashboardWidgetLayoutItem[] = [
  { id: 'widget-map', width: 12, height: 640, order: 1 },
  { id: 'widget-1', width: 4, height: 400, order: 2 },
  { id: 'widget-2', width: 4, height: 400, order: 3 },
  { id: 'widget-3', width: 4, height: 400, order: 4 },
  { id: 'widget-4', width: 9, height: 470, order: 5 },
  { id: 'widget-5', width: 3, height: 470, order: 6 },
  { id: 'widget-6', width: 12, height: 450, order: 7 },
  { id: 'widget-7', width: 3, height: 450, order: 9.5 },
  { id: 'widget-8', width: 9, height: 450, order: 9 },
  { id: 'widget-10', width: 12, height: 430, order: 11 },
  { id: 'widget-16', width: 12, height: 620, order: 12 },
  { id: 'widget-project-activities', width: 12, height: 620, order: 12.5 },
  { id: 'widget-14', width: 8, height: 430, order: 13 },
  { id: 'widget-9', width: 4, height: 430, order: 13.1 },
  { id: 'widget-11', width: 12, height: 500, order: 14 },
  { id: 'widget-12', width: 12, height: 450, order: 15 },
  { id: 'widget-15', width: 12, height: 450, order: 16 },
  { id: 'widget-13', width: 12, height: 450, order: 17 },
  { id: 'widget-wordcloud', width: 8, height: 450, order: 17.5 },
];

export const DEFAULT_RECENT_ACTIVITIES: RecentActivity[] = [
  { lastSync: '2026-01-26 10:30 AM', ticketsGenerated: 5, hoursWorked: 8, inspector: 'John Doe' },
  { lastSync: '2026-01-26 08:15 AM', ticketsGenerated: 2, hoursWorked: 6, inspector: 'Jane Smith' },
  { lastSync: '2026-01-25 06:45 AM', ticketsGenerated: 3, hoursWorked: 7, inspector: 'Carlos Ruiz' },
  { lastSync: '2026-01-25 04:20 AM', ticketsGenerated: 1, hoursWorked: 5, inspector: 'Emily Chen' },
  { lastSync: '2026-01-24 11:50 PM', ticketsGenerated: 4, hoursWorked: 9, inspector: 'Amit Patel' },
];
