/**
 * Canonical lower-case API segments for time-log domain.
 * Effective URLs use environment.apiBaseUrl (default: /api).
 */
export const TIME_LOG_API_PATHS = {
  projects: '/projects',
  vehicles: '/vehicles',
  vehiclesByProjectIds: '/vehicles/by-project-ids',
  inspectors: '/inspectors',
  users: '/users',
  userById: (id: string) => `/users/${encodeURIComponent(id)}`,
  legacyUserById: (id: string) => `/user/${encodeURIComponent(id)}`,
  timeLogs: '/timelogs',
  timeLogsBulk: '/timelogs/bulk',
  timeLogById: (id: string) => `/timelogs/${encodeURIComponent(id)}`,
  projectVehicles: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/vehicles`,
} as const;

export function buildApiUrl(baseUrl: string, path: string): string {
  const base = (baseUrl || '/api').replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
