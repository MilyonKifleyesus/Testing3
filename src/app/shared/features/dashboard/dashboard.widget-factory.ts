import * as busPulseData from '../../data/bus-pulse-dashboard';
import { DashboardWidget } from '../../models/client-dashboard.models';

export function createDefaultDashboardWidgets(): DashboardWidget[] {
  return [
    { id: 'widget-1', title: 'Project Status', subtitle: 'Open vs Closed Projects', type: 'chart', chartOptions: busPulseData.openClosedProjectsChart, width: 4, height: 400, order: 1 },
    { id: 'widget-2', title: 'Vehicles by Make & Model', subtitle: 'Fleet composition by manufacturer', type: 'chart', chartOptions: busPulseData.vehiclesByMakeModelChart, width: 4, height: 400, order: 2 },
    { id: 'widget-3', title: 'Propulsion Types', subtitle: 'Fleet fuel/energy distribution', type: 'chart', chartOptions: busPulseData.vehiclesByPropulsionChart, width: 4, height: 400, order: 3 },
    { id: 'widget-4', title: 'Overall Defects by Area', subtitle: 'Defects by vehicle inspection area', type: 'treemap', chartOptions: busPulseData.defectsByAreaTreemap, width: 8, height: 450, order: 4 },
    { id: 'widget-5', title: 'Repeated Defects', subtitle: 'Recurring issues percentage', type: 'gauge', chartOptions: busPulseData.repeatedDefectsGauge, width: 4, height: 450, order: 5 },
    { id: 'widget-6', title: 'Average Defects by Station', subtitle: 'Inspection quality metrics', type: 'chart', chartOptions: busPulseData.defectsByStationChart, width: 8, height: 450, order: 6 },
    { id: 'widget-7', title: 'Safety Critical Defects', subtitle: 'Safety-critical issues percentage', type: 'gauge', chartOptions: busPulseData.safetyCriticalDefectsGauge, width: 4, height: 450, order: 7 },
    { id: 'widget-8', title: 'Repeated Defects by Area', subtitle: 'Areas with recurring issues', type: 'treemap', chartOptions: busPulseData.repeatedDefectsByAreaTreemap, width: 8, height: 450, order: 8 },
    { id: 'widget-9', title: 'Tickets by Status', subtitle: 'Distribution of support tickets', type: 'bar', chartOptions: busPulseData.buildTicketsByStatusBar(), width: 4, height: 450, order: 9 },
    { id: 'widget-10', title: 'Comparison of Projects by Area', subtitle: 'Average defects per project across areas', type: 'chart', chartOptions: busPulseData.projectsByAreaStackedChart, width: 8, height: 450, order: 10 },
    { id: 'widget-14', title: 'Recent Activities', subtitle: 'Latest inspector sync activity', type: 'stat', width: 4, height: 450, order: 10.1 },
    { id: 'widget-11', title: 'Projects Comparison by Station', subtitle: 'Heatmap of average defects by station', type: 'heatmap', chartOptions: busPulseData.projectsByStationHeatmap, width: 12, height: 500, order: 11 },
    { id: 'widget-12', title: 'Average Station Time Comparison', subtitle: 'Setup, inspection and reporting time', type: 'chart', chartOptions: busPulseData.stationTimeComparisonChart, width: 12, height: 450, order: 12 },
    { id: 'widget-13', title: 'Project Timeline', subtitle: 'Project schedules and milestones', type: 'timeline', chartOptions: busPulseData.projectTimelineChart, width: 12, height: 450, order: 13 },
  ];
}
