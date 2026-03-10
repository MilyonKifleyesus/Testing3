import { FilterStatus } from '../fluorescence-map.types';

export type NormalizedLifecycleStatus = 'active' | 'inactive';

export const normalizeLifecycleStatus = (
  status: unknown,
  closed?: boolean | null
): NormalizedLifecycleStatus => {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();
  if (normalizedStatus === 'active' || normalizedStatus === 'open') {
    return 'active';
  }
  if (normalizedStatus === 'closed' || normalizedStatus === 'delayed' || normalizedStatus === 'inactive') {
    return 'inactive';
  }
  if (closed != null) {
    return closed ? 'inactive' : 'active';
  }
  return 'active';
};

export const matchesLifecycleFilter = (
  filter: FilterStatus,
  status: unknown,
  closed?: boolean | null
): boolean => {
  if (filter === 'all') return true;
  return normalizeLifecycleStatus(status, closed) === filter;
};

export const buildLifecycleCounts = <T extends { status?: unknown; closed?: boolean | null }>(
  items: T[]
): { total: number; active: number; inactive: number } => {
  let active = 0;
  let inactive = 0;

  for (const item of items) {
    if (normalizeLifecycleStatus(item.status, item.closed) === 'active') active += 1;
    else inactive += 1;
  }

  return {
    total: active + inactive,
    active,
    inactive,
  };
};

export const mapProjectStatusToRowStatus = (
  status: unknown,
  closed?: boolean | null
): 'Active' | 'Closed' | 'Under Inspection' => {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();
  if (normalizedStatus === 'delayed') {
    return 'Under Inspection';
  }
  return normalizeLifecycleStatus(status, closed) === 'active' ? 'Active' : 'Closed';
};
