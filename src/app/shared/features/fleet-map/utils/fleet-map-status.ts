import type { ApiProject } from '../models/fleet-map.models';

export function getProjectStatusDisplayLabel(status: ApiProject['status']): 'Open' | 'Closed' {
  return status === 'inactive' ? 'Closed' : 'Open';
}
