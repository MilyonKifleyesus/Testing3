import { Node, ProjectRoute } from '../../../../shared/models/fluorescence-map.interface';
import { Project } from '../../../../shared/models/project.model';
import { ActiveFilterItem, WarRoomFilters } from '../fluorescence-map.types';

interface NamedOption {
  id: string;
  name: string;
  count?: number;
}

interface ClientLike {
  id: string;
  name: string;
}

interface FactoryLike {
  country?: string;
  city?: string;
}

export const selectProjectRoutesForMap = (
  viewMode: string,
  routes: ProjectRoute[],
  selection: { level?: string; id?: string } | null,
  selectedProjectId: string | null
): ProjectRoute[] => {
  if (viewMode === 'factory') {
    return [];
  }
  if (viewMode === 'client') {
    if (selection?.level === 'client' && selection.id) {
      return routes.filter((route) => route.fromNodeId === selection.id);
    }
    return routes;
  }
  if (!selectedProjectId) {
    return routes;
  }
  return routes.filter((route) => route.projectId === selectedProjectId);
};

export const selectStatusCounts = (projects: Project[]): { total: number; active: number; inactive: number } => {
  let active = 0;
  let inactive = 0;

  for (const p of projects) {
    const st = p.status ?? 'Open';
    if (st === 'Open') active++;
    else inactive++;
  }

  return {
    total: active + inactive,
    active,
    inactive,
  };
};

export const selectActiveFilterCount = (filters: WarRoomFilters): number => {
  let count = filters.regions.length;
  if (filters.status !== 'all') count += 1;
  count += filters.clientIds.length + filters.manufacturerIds.length + filters.projectTypeIds.length + filters.projectIds.length;
  return count;
};

export const selectActiveFilters = (
  filters: WarRoomFilters,
  clients: ClientLike[],
  projects: Project[],
  projectOptions: NamedOption[]
): ActiveFilterItem[] => {
  const items: ActiveFilterItem[] = [];

  if (filters.status !== 'all') {
    items.push({
      type: 'status',
      label: `Status: ${filters.status === 'active' ? 'Active Only' : 'Inactive Only'}`,
      value: filters.status,
    });
  }

  filters.regions.forEach((region) => {
    items.push({ type: 'region', label: `Region: ${region}`, value: region });
  });

  filters.clientIds.forEach((id) => {
    const client = clients.find((c) => c.id === id);
    const name = client ? client.name : id;
    items.push({ type: 'client', label: `Client: ${name}`, value: id });
  });

  filters.manufacturerIds.forEach((id) => {
    items.push({ type: 'manufacturer', label: `Manufacturer: ${id}`, value: id });
  });

  filters.projectTypeIds.forEach((id) => {
    items.push({ type: 'projectType', label: `Project Type: ${id}`, value: id });
  });

  filters.projectIds.forEach((id) => {
    const project = projects.find((p) => String(p.id) === id);
    const opt = projectOptions.find((o) => o.id === id);
    const name = project?.projectName ?? opt?.name ?? id;
    items.push({ type: 'project', label: `Project: ${name}`, value: id });
  });

  return items;
};

export const selectAvailableRegions = (
  factories: FactoryLike[],
  getRegionForFactory: (factory: FactoryLike) => string | null
): string[] => {
  const regionSet = new Set<string>();
  factories.forEach((factory) => {
    const region = getRegionForFactory(factory);
    if (region) {
      regionSet.add(region);
    }
  });

  const preferredOrder = ['North America', 'Europe', 'Asia Pacific', 'LATAM'];
  const orderedPreferred = preferredOrder.filter((region) => regionSet.has(region));
  const remaining = Array.from(regionSet)
    .filter((region) => !preferredOrder.includes(region))
    .sort((a, b) => a.localeCompare(b));
  return [...orderedPreferred, ...remaining];
};

export const selectNodesWithClients = (
  baseNodes: Node[],
  clients: Array<{ id: string; name: string; code?: string; coordinates?: { latitude: number; longitude: number } | null }>,
  routes: ProjectRoute[],
  clientOptions: Array<{ id: string }>,
  viewMode: string
): Node[] => {
  if (!clients?.length) return baseNodes;
  const clientIdsInRoutes = routes?.length ? new Set(routes.map((r) => r.fromNodeId)) : new Set<string>();
  const clientIdsWithProjects = new Set(clientOptions.map((opt) => opt.id));
  let clientIdsToAdd = new Set([...clientIdsInRoutes, ...clientIdsWithProjects]);
  if (clientIdsToAdd.size === 0 && viewMode === 'client') {
    clientIdsToAdd = new Set(clients.filter((c) => c.coordinates).map((c) => c.id));
  }
  const clientNodes: Node[] = clients
    .filter((c) => c.coordinates && clientIdsToAdd.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      company: c.name,
      companyId: c.id,
      city: c.code || c.name,
      coordinates: c.coordinates!,
      type: 'Hub' as const,
      status: 'ACTIVE' as const,
      level: 'client' as const,
      clientId: c.id,
    }));
  return [...baseNodes, ...clientNodes];
};
