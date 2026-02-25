import { Routes } from '@angular/router';

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
];
