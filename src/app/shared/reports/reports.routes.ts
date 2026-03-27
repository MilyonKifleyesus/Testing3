import { Routes } from '@angular/router';
import { roleGuard } from '../guards/auth.guard';

export const sharedReportsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./reports.component').then((m) => m.ReportsComponent),
  },
  {
    path: 'ticket-reports/daily',
    loadComponent: () => import('./ticket-reports/ticket-reports.component').then((m) => m.TicketReportsComponent),
  },
  {
    path: 'ticket-reports/weekly',
    loadComponent: () => import('./ticket-reports/ticket-reports.component').then((m) => m.TicketReportsComponent),
  },
  {
    path: 'ticket-reports',
    redirectTo: 'ticket-reports/daily',
    pathMatch: 'full',
  },
  {
    path: 'vehicle-reports',
    loadComponent: () => import('./vehicle-reports/vehicle-reports.component').then((m) => m.VehicleReportsComponent),
  },
  {
    path: 'vehicle-reports/ticket-report',
    loadComponent: () => import('./vehicle-ticket-report/vehicle-ticket-report.component').then((m) => m.VehicleTicketReportComponent),
  },
  {
    path: 'vehicle-reports/station-tracker',
    loadComponent: () => import('./vehicle-station-tracker/vehicle-station-tracker.component').then((m) => m.VehicleStationTrackerComponent),
  },
  {
    path: 'vehicle-reports/final-reports',
    loadComponent: () => import('./vehicle-final-reports/vehicle-final-reports.component').then((m) => m.VehicleFinalReportsComponent),
  },
  {
    path: 'administrative-reports',
    canActivate: [roleGuard],
    data: { roles: ['superadmin', 'admin'] },
    loadComponent: () => import('./administrative-reports/administrative-reports.component').then((m) => m.AdministrativeReportsComponent),
  },
  {
    path: 'administrative-reports/labour-reports',
    canActivate: [roleGuard],
    data: { roles: ['superadmin', 'admin'] },
    loadComponent: () => import('./administrative-reports/labour-reports/labour-reports.component').then((m) => m.LabourReportsComponent),
  },
  {
    path: 'administrative-reports/summary-time-logged',
    canActivate: [roleGuard],
    data: { roles: ['superadmin', 'admin'] },
    loadComponent: () => import('./administrative-reports/summary-time-logged/summary-time-logged.component').then((m) => m.SummaryTimeLoggedComponent),
  },
  {
    path: 'administrative-reports/inspector-active-assets',
    canActivate: [roleGuard],
    data: { roles: ['superadmin', 'admin'] },
    loadComponent: () => import('./administrative-reports/inspector-active-assets/inspector-active-assets.component').then((m) => m.InspectorActiveAssetsComponent),
  },
  {
    path: 'administrative-reports/vehicle-hour-report',
    canActivate: [roleGuard],
    data: { roles: ['superadmin', 'admin'] },
    loadComponent: () => import('./administrative-reports/vehicle-hour-report/vehicle-hour-report.component').then((m) => m.VehicleHourReportComponent),
  },
];
