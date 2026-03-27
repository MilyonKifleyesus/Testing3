import * as busPulseData from '../../data/bus-pulse-dashboard';
import { DashboardWidget } from '../../models/client-dashboard.models';

export function createDefaultDashboardWidgets(): DashboardWidget[] {
  return [
    { id: 'widget-1', title: 'Project Status', subtitle: 'Open vs Closed Projects', type: 'chart', chartOptions: null, width: 4, height: 400, order: 1, loading: true },
    { id: 'widget-2', title: 'Vehicles by Make & Model', subtitle: 'Fleet composition by manufacturer', type: 'chart', chartOptions: null, width: 4, height: 400, order: 2, loading: true },
    { id: 'widget-3', title: 'Propulsion Types', subtitle: 'Fleet fuel/energy distribution', type: 'chart', chartOptions: null, width: 4, height: 400, order: 3, loading: true },
    { id: 'widget-4', title: 'Overall Defects by Area', subtitle: 'Defects by vehicle inspection area', type: 'treemap', chartOptions: busPulseData.defectsByAreaTreemap, width:10, height: 450, order: 4, loading: true },
    { id: 'widget-5', title: 'Repeated Defects', subtitle: 'Recurring issues percentage', type: 'gauge', chartOptions: null, width: 2, height: 450, order: 5, loading: true },
    { id: 'widget-6', title: 'Average Defects by Station', subtitle: 'Inspection quality metrics', type: 'chart', chartOptions: busPulseData.defectsByStationChart, width: 12, height: 450, order: 6, loading: true },
    { id: 'widget-7', title: 'Safety Critical Percentage', subtitle: 'Safety-critical issue share', type: 'gauge', chartOptions: null, width: 3, height: 450, order: 8.5, loading: true },
    { id: 'widget-8', title: 'Repeated Defects by Area', subtitle: 'Areas with recurring issues', type: 'treemap', chartOptions: busPulseData.repeatedDefectsByAreaTreemap, width: 9, height: 450, order: 8, loading: true },
    { id: 'widget-9', title: 'Tickets by Status', subtitle: 'Distribution of support tickets', type: 'bar', chartOptions: busPulseData.buildTicketsByStatusBar(), width: 4, height: 450, order: 9, loading: true },
    { id: 'widget-10', title: 'Average Tickets per Area by Project', subtitle: 'Average tickets per project per area', type: 'chart', chartOptions: busPulseData.projectsByAreaStackedChart, width: 8, height: 450, order: 10, loading: true },
    { id: 'widget-16', title: 'Ticket Creation Activity', subtitle: 'Daily created tickets from first to last ticket date', type: 'chart', chartOptions: busPulseData.ticketCreationActivityChart, width: 12, height: 620, order: 11, loading: true },
    { id: 'widget-project-activities', title: 'Project Activities', subtitle: 'Live ticket volume, staffing, and sync status by project', type: 'table', width: 12, height: 620, order: 11.05, loading: false },
    { id: 'widget-14', title: 'Recent Activities', subtitle: 'Latest inspector sync activity', type: 'stat', width: 4, height: 500, order: 11.1, loading: false },
    { id: 'widget-11', title: 'Projects Comparison by Station Type', subtitle: 'Heatmap of StationTrackers count by station type and project', type: 'heatmap', chartOptions: busPulseData.projectsByStationHeatmap, width: 12, height: 500, order: 12, loading: true },
    { id: 'widget-12', title: 'Average Type of Time Comparison by Project', subtitle: 'Setup, inspection and reporting time', type: 'chart', chartOptions: busPulseData.stationTimeComparisonChart, width: 12, height: 450, order: 13, loading: true },
    { id: 'widget-15', title: 'Vehicle Station Tracking', subtitle: 'Vehicle station timeline', type: 'timeline', chartOptions: busPulseData.vehicleStationTrackingChart, width: 12, height: 450, order: 14, loading: true },
    { id: 'widget-13', title: 'Project Timeline', subtitle: 'Project schedules and milestones', type: 'timeline', chartOptions: busPulseData.projectTimelineChart, width: 12, height: 450, order: 15, loading: true },
    { id: 'widget-map', title: 'Fleet Map', subtitle: 'All mapped projects', type: 'map', width: 12, height: 500, order: 16, loading: true },
    { id: 'widget-wordcloud', title: 'Defect Word Cloud', subtitle: 'Common defect terms from tickets', type: 'wordcloud', width: 8, height: 450, order: 17, loading: false },
  ];
}
