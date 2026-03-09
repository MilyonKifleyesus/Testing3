import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import * as busPulseData from '../data/bus-pulse-dashboard';
import { clientProjects, clientVehicles } from '../data/client-projects-vehicles';
import { defaultClientProfile } from '../data/client-profiles-dashboard';
import { projectStats } from '../data/client-tickets-assets';
import {
  ClientDashboardResponse,
  DashboardWidget,
  RecentActivity,
  TicketsByStatusData,
} from '../models/client-dashboard.models';

type ClientDashboardEnvironmentConfig = typeof environment & {
  useMockClientDashboard?: boolean;
};

@Injectable({ providedIn: 'root' })
export class ClientDashboardService {
  private readonly envConfig = environment as ClientDashboardEnvironmentConfig;
  private readonly baseUrl = `${environment.apiBaseUrl}/client-dashboard`;
  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly PROJECTS_ROUTE = 'projects';

  constructor(private http: HttpClient) {}

  getClientDashboard(clientId: number): Observable<ClientDashboardResponse> {
    if (this.envConfig.useMockClientDashboard === true) {
      return of(this.buildMockResponse(clientId));
    }

    return this.http.get<ClientDashboardResponse>(`${this.baseUrl}/${clientId}`);
  }

  getProjects(params: { clientId?: number; includeClosed?: boolean; page?: number; pageSize?: number } = {}): Observable<any> {
    if (this.envConfig.useMockClientDashboard === true) {
      return of({ items: clientProjects });
    }
    const httpParams = this.buildParams(params);
    return this.http.get<any>(`${this.apiBaseUrl}/${this.PROJECTS_ROUTE}`, { params: httpParams });
  }

  getProjectVehicles(projectId: number, params: { clientId?: number; userId?: number; page?: number; pageSize?: number } = {}): Observable<any> {
    if (this.envConfig.useMockClientDashboard === true) {
      return of({ items: clientVehicles });
    }
    const httpParams = this.buildParams(params);
    return this.http.get<any>(`${this.apiBaseUrl}/${this.PROJECTS_ROUTE}/${projectId}/vehicles`, { params: httpParams });
  }

  getTickets(params: { projectId?: number; userId?: number; vehicleId?: number; page?: number; pageSize?: number } = {}): Observable<any> {
    if (this.envConfig.useMockClientDashboard === true) {
      return of(projectStats);
    }
    const httpParams = this.buildParams(params);
    return this.http.get<any>(`${this.apiBaseUrl}/tickets`, { params: httpParams });
  }

  getTicketsDashboard(params: { projectId?: number; userId?: number; vehicleId?: number } = {}): Observable<any> {
    if (this.envConfig.useMockClientDashboard === true) {
      return of(projectStats);
    }
    const httpParams = this.buildParams(params);
    return this.http.get<any>(`${this.apiBaseUrl}/tickets/dashboard`, { params: httpParams });
  }

  getVehicles(params: { clientId?: number; page?: number; pageSize?: number } = {}): Observable<any> {
    if (this.envConfig.useMockClientDashboard === true) {
      return of({ items: clientVehicles });
    }
    const httpParams = this.buildParams(params);
    return this.http.get<any>(`${this.apiBaseUrl}/vehicles`, { params: httpParams });
  }

  private buildParams(params: Record<string, string | number | boolean | null | undefined>): HttpParams {
    let httpParams = new HttpParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        httpParams = httpParams.set(key, String(value));
      }
    });
    return httpParams;
  }

  private buildMockResponse(_clientId: number): ClientDashboardResponse {
    const ticketsByStatus: TicketsByStatusData = {
      categories: [
        'Open Tickets',
        'In Progress',
        'Resolved',
        'Escalated',
        'Closed',
        'On Hold',
        'Reopened',
      ],
      values: [28.5, 22.3, 18.7, 12.4, 10.2, 5.1, 2.8],
    };

    const widgets: DashboardWidget[] = [
      {
        id: 'widget-1',
        title: 'Project Status',
        subtitle: 'Open vs Closed Projects',
        type: 'chart',
        chartOptions: busPulseData.openClosedProjectsChart,
        width: 4,
        height: 400,
        order: 1,
      },
      {
        id: 'widget-2',
        title: 'Vehicles by Make & Model',
        subtitle: 'Fleet composition by manufacturer',
        type: 'chart',
        chartOptions: busPulseData.vehiclesByMakeModelChart,
        width: 4,
        height: 400,
        order: 2,
      },
      {
        id: 'widget-3',
        title: 'Propulsion Types',
        subtitle: 'Fleet fuel/energy distribution',
        type: 'chart',
        chartOptions: busPulseData.vehiclesByPropulsionChart,
        width: 4,
        height: 400,
        order: 3,
      },
      {
        id: 'widget-4',
        title: 'Overall Defects by Area',
        subtitle: 'Total defects distributed by vehicle inspection area',
        type: 'treemap',
        chartOptions: busPulseData.defectsByAreaTreemap,
        width: 8,
        height: 450,
        order: 4,
      },
      {
        id: 'widget-5',
        title: 'Repeated Defects',
        subtitle: 'Recurring issues percentage',
        type: 'gauge',
        chartOptions: busPulseData.repeatedDefectsGauge,
        width: 4,
        height: 450,
        order: 5,
      },
      {
        id: 'widget-6',
        title: 'Average Defects by Station',
        subtitle: 'Inspection quality metrics across all stations',
        type: 'chart',
        chartOptions: busPulseData.defectsByStationChart,
        width: 8,
        height: 450,
        order: 6,
      },
      {
        id: 'widget-7',
        title: 'Safety Critical Defects',
        subtitle: 'Safety-critical issues percentage',
        type: 'gauge',
        chartOptions: busPulseData.safetyCriticalDefectsGauge,
        width: 4,
        height: 450,
        order: 7,
      },
      {
        id: 'widget-8',
        title: 'Repeated Defects by Area',
        subtitle: 'Areas with most recurring issues',
        type: 'treemap',
        chartOptions: busPulseData.repeatedDefectsByAreaTreemap,
        width: 8,
        height: 450,
        order: 8,
      },
      {
        id: 'widget-9',
        title: 'Tickets by Status',
        subtitle: 'Distribution of support tickets',
        type: 'bar',
        width: 4,
        height: 450,
        order: 9,
      },
      {
        id: 'widget-10',
        title: 'Comparison of Projects by Area',
        subtitle: 'Average defects per project across areas',
        type: 'chart',
        chartOptions: busPulseData.projectsByAreaStackedChart,
        width: 8,
        height: 450,
        order: 10,
      },
      {
        id: 'widget-11',
        title: 'Recent Activities',
        subtitle: 'Latest system activities and updates',
        type: 'stat',
        width: 4,
        height: 450,
        order: 11,
      },
      {
        id: 'widget-12',
        title: 'Projects Comparison by Station',
        subtitle: 'Color-range heatmap of average defects by project and station',
        type: 'heatmap',
        chartOptions: busPulseData.projectsByStationHeatmap,
        width: 12,
        height: 500,
        order: 12,
      },
      {
        id: 'widget-13',
        title: 'Average Station Time Comparison',
        subtitle: 'Setup, inspection, and reporting times by project',
        type: 'chart',
        chartOptions: busPulseData.stationTimeComparisonChart,
        width: 12,
        height: 450,
        order: 13,
      },
      {
        id: 'widget-14',
        title: 'Project Timeline',
        subtitle: 'Project schedules and milestones across 2024',
        type: 'timeline',
        chartOptions: busPulseData.projectTimelineChart,
        width: 12,
        height: 450,
        order: 14,
      },
    ];

    const recentActivities: RecentActivity[] = [
      {
        lastSync: '2026-01-26 10:30 AM',
        ticketsGenerated: 5,
        hoursWorked: 8,
        inspector: 'John Doe',
      },
      {
        lastSync: '2026-01-26 08:15 AM',
        ticketsGenerated: 2,
        hoursWorked: 6,
        inspector: 'Jane Smith',
      },
      {
        lastSync: '2026-01-25 06:45 AM',
        ticketsGenerated: 3,
        hoursWorked: 7,
        inspector: 'Carlos Ruiz',
      },
      {
        lastSync: '2026-01-25 04:20 AM',
        ticketsGenerated: 1,
        hoursWorked: 5,
        inspector: 'Emily Chen',
      },
      {
        lastSync: '2026-01-24 11:50 PM',
        ticketsGenerated: 4,
        hoursWorked: 9,
        inspector: 'Amit Patel',
      },
    ];

    return {
      clientProfile: defaultClientProfile,
      filters: {
        projects: clientProjects,
        vehicles: clientVehicles,
      },
      projectStats: projectStats,
      widgets,
      ticketsByStatus,
      recentActivities,
    };
  }
}
