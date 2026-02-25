import { CurrentUser } from '../services/auth.service';

export interface ReportRouteContext {
  portalPrefix: '/admin' | '/client';
  dashboardPath: string;
  reportsPath: string;
  vehicleReportsPath: string;
}

export function resolveReportRouteContext(user: CurrentUser | null | undefined): ReportRouteContext {
  const role = (user?.role ?? '').toLowerCase().trim();
  const portalPrefix: '/admin' | '/client' = role === 'client' || role === 'user' ? '/client' : '/admin';

  return {
    portalPrefix,
    dashboardPath: `${portalPrefix}/dashboard`,
    reportsPath: `${portalPrefix}/reports`,
    vehicleReportsPath: `${portalPrefix}/reports/vehicle-reports`,
  };
}
