import { Node, ProjectRoute } from '../../../models/fluorescence-map.interface';
import { MapViewMode } from '../../../models/fluorescence-map.interface';
import { Project } from '../../../models/project.model';
import { normalizeNumericLikeId } from '../../../utils/id-normalizer.util';
import {
  ActiveFilterItem,
  DerivedNodeIds,
  MapLabelStrictVm,
  MapMarkerStrictVm,
  MapRouteStrictVm,
  MapViewModelStrict,
  WarRoomFilters,
} from '../fluorescence-map.types';

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

interface StrictRegionLookup {
  getRegionForNodeId: (nodeId: string) => string | null;
}

interface StrictFilterLookup extends StrictRegionLookup {
  getClientIdForProjectId?: (projectId: string) => string | null;
  getManufacturerIdsForNodeId?: (nodeId: string) => string[];
}

const buildStrictNodeIdCandidates = (rawId: unknown): string[] => {
  const candidates: string[] = [];
  const pushCandidate = (value: unknown): void => {
    const normalized = String(value ?? '').trim();
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  const raw = String(rawId ?? '').trim();
  if (!raw) return [];

  pushCandidate(raw);

  const withoutSource = raw.replace(/^source-/i, '').trim();
  pushCandidate(withoutSource);

  const withoutLoc = raw.replace(/^loc-/i, '').trim();
  pushCandidate(withoutLoc);

  const numeric = normalizeNumericLikeId(withoutLoc);
  if (numeric && /^\d+$/.test(numeric)) {
    pushCandidate(numeric);
    pushCandidate(`loc-${numeric}`);
  }

  return candidates;
};

const normalizeStrictIdCandidates = (rawId: unknown): string[] => {
  const normalized = new Set<string>();
  buildStrictNodeIdCandidates(rawId).forEach((candidate) => {
    const normalizedCandidate = normalizeNumericLikeId(candidate);
    if (normalizedCandidate) normalized.add(normalizedCandidate);
  });
  return Array.from(normalized.values());
};

export const selectProjectRoutesForMap = (
  viewMode: string,
  routes: ProjectRoute[],
  selectedProjectId: string | null
): ProjectRoute[] => {
  if (viewMode === 'factory' || viewMode === 'manufacturer' || viewMode === 'client') {
    return [];
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
  projectOptions: NamedOption[],
  manufacturers: NamedOption[],
  projectTypes: NamedOption[]
): ActiveFilterItem[] => {
  const items: ActiveFilterItem[] = [];
  const clientsByNormalizedId = new Map<string, ClientLike>();
  clients.forEach((client) => {
    const normalizedId = normalizeNumericLikeId(client.id);
    if (!normalizedId) return;
    if (!clientsByNormalizedId.has(normalizedId)) {
      clientsByNormalizedId.set(normalizedId, client);
    }
  });

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
    const normalizedId = normalizeNumericLikeId(id);
    const client = normalizedId ? clientsByNormalizedId.get(normalizedId) : undefined;
    const fallbackId = normalizedId || String(id).trim();
    const name = client ? client.name : fallbackId;
    items.push({ type: 'client', label: `Client: ${name}`, value: fallbackId });
  });

  filters.manufacturerIds.forEach((id) => {
    const opt = manufacturers.find((m) => m.id === id);
    const name = opt?.name ?? id;
    items.push({ type: 'manufacturer', label: `Manufacturer: ${name}`, value: id });
  });

  filters.projectTypeIds.forEach((id) => {
    const opt = projectTypes.find((t) => t.id === id);
    const name = opt?.name ?? id;
    items.push({ type: 'projectType', label: `Project Type: ${name}`, value: id });
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
  clients: Array<{ id: string; name: string; city?: string; code?: string; coordinates?: { latitude: number; longitude: number } | null }>,
  routes: ProjectRoute[],
  clientOptions: Array<{ id: string }>,
  viewMode: string,
  filteredClientIds: Array<string | number> = []
): Node[] => {
  if (!clients?.length) return baseNodes;
  const baseIds = new Set(baseNodes.map((n) => normalizeNumericLikeId(n.id)).filter((id) => !!id));
  const normalizedClientIdsInRoutes = routes?.length
    ? new Set(
      routes
        .map((r) => normalizeNumericLikeId(r.fromNodeId))
        .filter((id) => !!id)
    )
    : new Set<string>();
  const normalizedClientIdsWithProjects = new Set(
    clientOptions
      .map((opt) => normalizeNumericLikeId(opt.id))
      .filter((id) => !!id)
  );
  const normalizedFilteredClientIds = new Set(
    filteredClientIds
      .map((id) => normalizeNumericLikeId(id))
      .filter((id) => !!id)
  );
  const clientIdsToAdd =
    viewMode === 'client'
      ? new Set(
        clients
          .filter((c) => c.coordinates)
          .map((c) => normalizeNumericLikeId(c.id))
          .filter((id) => !!id)
      )
      : new Set([
        ...normalizedClientIdsInRoutes,
        ...normalizedClientIdsWithProjects,
        ...normalizedFilteredClientIds,
      ]);
  const clientNodes: Node[] = clients
    .filter((c) => {
      const normalizedId = normalizeNumericLikeId(c.id);
      return !!c.coordinates && !!normalizedId && clientIdsToAdd.has(normalizedId) && !baseIds.has(normalizedId);
    })
    .map((c) => ({
      id: normalizeNumericLikeId(c.id),
      name: c.name,
      company: c.name,
      companyId: normalizeNumericLikeId(c.id),
      city: c.city ?? c.code ?? c.name,
      coordinates: c.coordinates!,
      type: 'Hub' as const,
      status: 'ACTIVE' as const,
      level: 'client' as const,
      clientId: normalizeNumericLikeId(c.id),
    }));
  return [...baseNodes, ...clientNodes];
};

export const selectFilteredProjectRoutesStrict = (
  routes: ProjectRoute[],
  filters: WarRoomFilters,
  nodeRegionLookup?: StrictFilterLookup
): ProjectRoute[] => {
  const normalizedProjectIds = new Set((filters.projectIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  const normalizedClientIds = new Set((filters.clientIds ?? []).map((id) => normalizeNumericLikeId(id)).filter(Boolean));
  const normalizedManufacturerIds = new Set((filters.manufacturerIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  const normalizedProjectTypeIds = new Set((filters.projectTypeIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  const selectedRegions = new Set((filters.regions ?? []).map((region) => String(region).trim()).filter(Boolean));

  const selectedStatus = filters.status ?? 'all';

  return (routes ?? []).filter((route) => {
    // 1) projectIds
    if (normalizedProjectIds.size > 0 && !normalizedProjectIds.has(String(route.projectId).trim())) {
      return false;
    }

    // 2) clientIds
    if (normalizedClientIds.size > 0) {
      const routeWithClient = route as ProjectRoute & { clientId?: string | number | null };
      const clientIdFromProject =
        nodeRegionLookup?.getClientIdForProjectId?.(String(route.projectId ?? '').trim()) ?? null;
      const clientCandidates = new Set<string>([
        ...normalizeStrictIdCandidates(routeWithClient.clientId),
        ...normalizeStrictIdCandidates(route.fromNodeId),
        ...normalizeStrictIdCandidates(clientIdFromProject),
      ]);
      const matchesClient = Array.from(clientCandidates).some((candidate) => normalizedClientIds.has(candidate));
      if (!matchesClient) {
        return false;
      }
    }

    // 3) manufacturerIds
    if (normalizedManufacturerIds.size > 0) {
      const manufacturerMeta = route as ProjectRoute & {
        manufacturerId?: string | number | null;
        manufacturerLocationId?: string | number | null;
        manufacturer?: string | null;
        manufacturerName?: string | null;
      };
      const manufacturerCandidates = [
        manufacturerMeta.manufacturerId,
        manufacturerMeta.manufacturerLocationId,
        manufacturerMeta.manufacturer,
        manufacturerMeta.manufacturerName,
        ...(nodeRegionLookup?.getManufacturerIdsForNodeId?.(route.toNodeId) ?? []),
      ]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean);

      if (manufacturerCandidates.length > 0) {
        const matchesManufacturer = manufacturerCandidates.some((candidate) => normalizedManufacturerIds.has(candidate));
        if (!matchesManufacturer) {
          return false;
        }
      } else if (nodeRegionLookup?.getManufacturerIdsForNodeId) {
        return false;
      }
    }

    // 4) projectTypeIds
    const routeProjectTypeId = String(
      (route as ProjectRoute & { projectTypeId?: string; assessmentType?: string }).projectTypeId ??
      (route as ProjectRoute & { projectTypeId?: string; assessmentType?: string }).assessmentType ??
      ''
    ).trim();
    if (normalizedProjectTypeIds.size > 0 && (!routeProjectTypeId || !normalizedProjectTypeIds.has(routeProjectTypeId))) {
      return false;
    }

    // 5) status
    if (selectedStatus !== 'all') {
      const routeStatusRaw = (route as ProjectRoute & { status?: string; closed?: boolean }).status;
      const routeStatus = routeStatusRaw ? routeStatusRaw.trim().toLowerCase() : null;
      const routeClosed = (route as ProjectRoute & { closed?: boolean; includeClosed?: boolean }).closed;
      const isActiveByStatus = routeStatus != null
        ? routeStatus === 'active' || routeStatus === 'open'
        : routeClosed != null
          ? !routeClosed
          : true;
      if (selectedStatus === 'active' && !isActiveByStatus) {
        return false;
      }
      if (selectedStatus === 'inactive' && isActiveByStatus) {
        return false;
      }
    }

    // 6) regions (endpoint OR)
    if (selectedRegions.size > 0) {
      const fromRegion = nodeRegionLookup?.getRegionForNodeId(route.fromNodeId) ?? null;
      const toRegion = nodeRegionLookup?.getRegionForNodeId(route.toNodeId) ?? null;
      const matches = (fromRegion != null && selectedRegions.has(fromRegion)) || (toRegion != null && selectedRegions.has(toRegion));
      if (!matches) {
        return false;
      }
    }

    return true;
  });
};

export const selectDerivedNodeIdsFromRoutes = (filteredRoutes: ProjectRoute[]): DerivedNodeIds => {
  const fromNodeIds = new Set<string>();
  const toNodeIds = new Set<string>();
  const allNodeIds = new Set<string>();
  (filteredRoutes ?? []).forEach((route) => {
    const fromCandidates = buildStrictNodeIdCandidates(route.fromNodeId);
    const toCandidates = buildStrictNodeIdCandidates(route.toNodeId);

    fromCandidates.forEach((id) => {
      fromNodeIds.add(id);
      allNodeIds.add(id);
    });
    toCandidates.forEach((id) => {
      toNodeIds.add(id);
      allNodeIds.add(id);
    });
  });
  return { fromNodeIds, toNodeIds, allNodeIds };
};

export const selectFilteredNodesStrict = (
  rawNodes: Node[],
  allNodeIds: Set<string>
): Node[] => {
  if (!rawNodes?.length || allNodeIds.size === 0) return [];
  return rawNodes.filter((node) =>
    buildStrictNodeIdCandidates(node.id).some((candidate) => allNodeIds.has(candidate))
  );
};

export const selectMapViewModelStrict = (params: {
  mode: MapViewMode;
  filteredRoutes: ProjectRoute[];
  filteredNodes: Node[];
  derivedNodeIds: DerivedNodeIds;
  filtersActive: boolean;
}): MapViewModelStrict => {
  const {
    mode,
    filteredRoutes,
    filteredNodes,
    derivedNodeIds,
    filtersActive,
  } = params;

  const visibleNodeIds =
    mode === 'client'
      ? derivedNodeIds.fromNodeIds
      : mode === 'manufacturer'
        ? derivedNodeIds.toNodeIds
        : derivedNodeIds.allNodeIds;

  const markerById = new Map<string, MapMarkerStrictVm>();
  (filteredNodes ?? []).forEach((node) => {
    const nodeId = String(node.id ?? '').trim();
    if (!nodeId || !visibleNodeIds.has(nodeId) || markerById.has(nodeId)) return;
    markerById.set(nodeId, { id: nodeId, nodeId, node });
  });
  const markers = Array.from(markerById.values());

  const labels: MapLabelStrictVm[] = markers.map((marker) => ({
    id: marker.nodeId,
    nodeId: marker.nodeId,
    text: marker.node.company || marker.node.name || marker.nodeId,
    subText: marker.node.city || undefined,
  }));

  const shouldRenderRoutes = mode === 'project';
  const routes: MapRouteStrictVm[] = shouldRenderRoutes
    ? (filteredRoutes ?? []).map((route) => ({ id: route.id, route }))
    : [];

  const bounds = markers.reduce<{
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  } | null>((acc, marker) => {
    const coords = marker.node.coordinates;
    if (!coords) return acc;
    const lat = Number(coords.latitude);
    const lng = Number(coords.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return acc;
    if (acc == null) {
      return { minLat: lat, minLng: lng, maxLat: lat, maxLng: lng };
    }
    return {
      minLat: Math.min(acc.minLat, lat),
      minLng: Math.min(acc.minLng, lng),
      maxLat: Math.max(acc.maxLat, lat),
      maxLng: Math.max(acc.maxLng, lng),
    };
  }, null);

  return {
    mode,
    routes,
    markers,
    labels,
    bounds,
    emptyState: {
      show: filtersActive && (filteredRoutes?.length ?? 0) === 0,
      message: filtersActive && (filteredRoutes?.length ?? 0) === 0
        ? 'No routes match the selected filters'
        : null,
    },
  };
};
