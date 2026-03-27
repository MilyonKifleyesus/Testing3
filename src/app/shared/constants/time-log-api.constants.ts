/**
 * Canonical API segments for the time-log domain.
 * Effective URLs use environment.apiBaseUrl (default: /api).
 *
 * TimeLogs is kept in PascalCase to match the backend route used elsewhere in the app
 * and avoid proxy/API-gateway authorization mismatches on the Azure-hosted API.
 */
export const TIME_LOG_API_PATHS = {
  projects: '/projects',
  vehicles: '/vehicles',
  vehiclesByProjectIds: '/vehicles/by-project-ids',
  inspectors: '/inspectors',
  users: '/users',
  userById: (id: string) => `/users/${encodeURIComponent(id)}`,
  usersByIds: '/users/by-ids',
  legacyUserById: (id: string) => `/user/${encodeURIComponent(id)}`,
  timeLogs: '/TimeLogs',
  timeLogsBulk: '/TimeLogs/bulk',
  timeLogById: (id: string) => `/TimeLogs/${encodeURIComponent(id)}`,
  projectVehicles: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/vehicles`,
} as const;

export function buildApiUrl(baseUrl: string, path: string): string {
  const base = (baseUrl || '/api').replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
