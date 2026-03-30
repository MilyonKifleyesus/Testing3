import { Injectable, computed } from '@angular/core';

import { ActivityLogTableService } from '../services/activity-log-table.service';
import {
  ActiveFilterItem,
  DerivedNodeIds,
  FilterStatus,
  FluorescenceMapBootstrapData,
  FluorescenceMapFilteredState,
  WarRoomFilters,
} from '../fluorescence-map.types';
import {
  ActivityLogRow,
  ClientManagementRow,
  LocationManagementRow,
  ManufacturerManagementRow,
} from '../models/fleet-vm.models';
import {
  selectActiveFilterCount,
  selectActiveFilters,
  selectFilteredNodesStrict,
  selectFilteredProjectRoutesStrict,
  selectMapViewModelStrict,
} from '../state/fluorescence-map.selectors';
import {
  buildCanonicalNodeIdCandidates,
  normalizeCanonicalId,
  normalizeCanonicalIdList,
} from '../state/fluorescence-map-normalization';
import { buildLifecycleCounts } from '../state/fluorescence-map-lifecycle';
import { MapViewMode } from '../../../models/fluorescence-map.interface';

interface NamedOption {
  id: string;
  name: string;
  count?: number;
}

interface FilterInputs {
  bootstrapData: () => FluorescenceMapBootstrapData;
  filters: () => WarRoomFilters;
  mapViewMode: () => MapViewMode;
  clientOptions: () => NamedOption[];
  manufacturerOptions: () => NamedOption[];
  projectTypeOptions: () => NamedOption[];
  projectOptions: () => NamedOption[];
  isPinnedClientMode: () => boolean;
}

@Injectable({ providedIn: 'root' })
export class FluorescenceMapFilterFacade {
  constructor(private readonly activityLogTableService: ActivityLogTableService) {}

  createFilteredState(inputs: FilterInputs) {
    return computed<FluorescenceMapFilteredState>(() => {
      const bootstrapData = inputs.bootstrapData();
      const rawFilters = inputs.filters();
      const effectiveStatus: FilterStatus =
        inputs.mapViewMode() === 'manufacturer' ? 'all' : rawFilters.status;
      const filters: WarRoomFilters = {
        ...rawFilters,
        status: effectiveStatus,
      };

      const regionMatchedProjectIds = this.getRegionMatchedProjectIds(
        bootstrapData.projectRegionByProjectId,
        filters.regions,
      );
      const constrainedProjectIds = this.getConstrainedProjectIds(filters.projectIds, regionMatchedProjectIds);

      const filteredProjects = this.activityLogTableService.filterProjects(
        bootstrapData.projects,
        {
          status: effectiveStatus,
          clientIds: normalizeCanonicalIdList(filters.clientIds),
          manufacturerIds: [...filters.manufacturerIds],
          projectTypeIds: [...filters.projectTypeIds],
          projectIds: constrainedProjectIds,
        },
        bootstrapData.manufacturers,
      );
      const statusNeutralProjects = this.activityLogTableService.filterProjects(
        bootstrapData.projects,
        {
          status: 'all',
          clientIds: normalizeCanonicalIdList(filters.clientIds),
          manufacturerIds: [...filters.manufacturerIds],
          projectTypeIds: [...filters.projectTypeIds],
          projectIds: constrainedProjectIds,
        },
        bootstrapData.manufacturers,
      );
      const filteredProjectIds = new Set(filteredProjects.map((project) => String(project.id)));
      const activityTableRows = this.activityLogTableService.buildRows(
        filteredProjects,
        bootstrapData.clients,
        bootstrapData.manufacturers,
        bootstrapData.locations,
      );

      const routeFilteredByFallback = selectFilteredProjectRoutesStrict(bootstrapData.projectRoutes, filters, {
        getRegionForNodeId: () => null,
        getClientIdForProjectId: (projectId) => bootstrapData.projectClientIdByProjectId.get(projectId) ?? null,
        getManufacturerIdsForNodeId: (nodeId) =>
          bootstrapData.manufacturerIdsByNodeId.get(normalizeCanonicalId(nodeId) ?? String(nodeId).trim()) ?? [],
        getManufacturerIdsForProjectId: (projectId) => bootstrapData.manufacturerIdsByProjectId.get(projectId) ?? [],
        getProjectTypeIdForProjectId: (projectId) => bootstrapData.projectTypeIdByProjectId.get(projectId) ?? null,
      });
      const filteredProjectRoutes =
        filteredProjectIds.size > 0
          ? routeFilteredByFallback.filter((route) => filteredProjectIds.has(String(route.projectId).trim()))
          : routeFilteredByFallback;
      const derivedNodeIds = this.buildDerivedNodeIds(
        filteredProjectRoutes,
        activityTableRows,
        bootstrapData.projects.length === 0 && selectActiveFilterCount(filters) === 0
          ? bootstrapData.transitRoutes
          : [],
      );
      const filteredNodes = selectFilteredNodesStrict(bootstrapData.nodes, derivedNodeIds.allNodeIds);
      const mapViewModel = selectMapViewModelStrict({
        mode: inputs.mapViewMode(),
        filteredRoutes: filteredProjectRoutes,
        filteredNodes,
        derivedNodeIds,
        filtersActive: selectActiveFilterCount(filters) > 0,
      });
      const strictMapNodes = mapViewModel.markers.map((marker) => marker.node);
      const strictMapProjectRoutes = mapViewModel.routes.map((route) => route.route);
      const visibleNodeIds = new Set<string>();
      strictMapNodes.forEach((node) =>
        buildCanonicalNodeIdCandidates(node.id).forEach((candidate) => visibleNodeIds.add(candidate)),
      );
      const filteredTransitRoutes =
        inputs.mapViewMode() === 'client'
          ? []
          : bootstrapData.transitRoutes.filter((route) => {
              const fromMatches = buildCanonicalNodeIdCandidates(route.from).some((candidate) =>
                visibleNodeIds.has(candidate),
              );
              const toMatches = buildCanonicalNodeIdCandidates(route.to).some((candidate) =>
                visibleNodeIds.has(candidate),
              );
              return fromMatches && toMatches;
            });

      const statusCounts = buildLifecycleCounts(statusNeutralProjects);
      const activeFilters = this.getActiveFilters(inputs, filters, bootstrapData);
      const activeFilterCount = inputs.isPinnedClientMode()
        ? activeFilters.length
        : selectActiveFilterCount(filters);

      return {
        filtersActive: activeFilterCount > 0,
        filteredProjectIds,
        filteredProjects,
        activityTableRows,
        clientTableRows: this.buildClientTableRows(bootstrapData, filteredProjects),
        manufacturerTableRows: this.buildManufacturerTableRows(bootstrapData, activityTableRows),
        locationTableRows: this.buildLocationTableRows(bootstrapData, activityTableRows),
        availableRegions: bootstrapData.regionValues,
        statusCounts,
        activeFilterCount,
        activeFilters,
        filteredProjectRoutes,
        filteredNodes,
        derivedNodeIds,
        strictMapNodes,
        strictMapProjectRoutes,
        filteredTransitRoutes,
        mapViewModel,
        mapState: {
          showEmptyState: mapViewModel.emptyState.show,
          emptyMessage: mapViewModel.emptyState.message,
        },
      };
    });
  }

  private getActiveFilters(
    inputs: FilterInputs,
    filters: WarRoomFilters,
    bootstrapData: FluorescenceMapBootstrapData,
  ): ActiveFilterItem[] {
    const activeFilters = selectActiveFilters(
      filters,
      bootstrapData.clients,
      bootstrapData.projects.map((project) => ({
        id: project.id,
        projectName: project.projectName,
      })),
      inputs.projectOptions(),
      inputs.manufacturerOptions(),
      inputs.projectTypeOptions(),
    );

    if (!inputs.isPinnedClientMode()) {
      return activeFilters;
    }

    return activeFilters.filter((item) => item.type !== 'client');
  }

  private getRegionMatchedProjectIds(
    projectRegionByProjectId: Map<string, string | null>,
    selectedRegions: string[],
  ): Set<string> {
    if (selectedRegions.length === 0) {
      return new Set(projectRegionByProjectId.keys());
    }

    const matchedProjectIds = new Set<string>();
    projectRegionByProjectId.forEach((region, projectId) => {
      if (region && selectedRegions.includes(region)) {
        matchedProjectIds.add(projectId);
      }
    });
    return matchedProjectIds;
  }

  private getConstrainedProjectIds(explicitProjectIds: string[], regionMatchedProjectIds: Set<string>): string[] {
    if (explicitProjectIds.length === 0) {
      return Array.from(regionMatchedProjectIds.values());
    }

    return explicitProjectIds.filter((projectId) => regionMatchedProjectIds.has(String(projectId)));
  }

  private buildDerivedNodeIds(
    filteredRoutes: FluorescenceMapBootstrapData['projectRoutes'],
    rows: ActivityLogRow[],
    transitRoutes: FluorescenceMapBootstrapData['transitRoutes'] = [],
  ): DerivedNodeIds {
    const fromNodeIds = new Set<string>();
    const toNodeIds = new Set<string>();
    const allNodeIds = new Set<string>();
    const addToSet = (target: Set<string>, value: unknown): void => {
      buildCanonicalNodeIdCandidates(value).forEach((candidate) => {
        target.add(candidate);
        allNodeIds.add(candidate);
      });
    };

    filteredRoutes.forEach((route) => {
      addToSet(fromNodeIds, route.fromNodeId);
      addToSet(toNodeIds, route.toNodeId);
    });

    rows.forEach((row) => {
      addToSet(fromNodeIds, row.clientId);
      addToSet(fromNodeIds, row.clientLocationId);
      addToSet(toNodeIds, row.manufacturerLocationId);
      addToSet(toNodeIds, row.locationId);
      addToSet(toNodeIds, row.manufacturerId);
      (row.locationIds ?? []).forEach((locationId) => addToSet(toNodeIds, locationId));
    });

    if (allNodeIds.size === 0) {
      transitRoutes.forEach((route) => {
        addToSet(fromNodeIds, route.from);
        addToSet(toNodeIds, route.to);
      });
    }

    return { fromNodeIds, toNodeIds, allNodeIds };
  }

  private buildClientTableRows(
    bootstrapData: FluorescenceMapBootstrapData,
    filteredProjects: FluorescenceMapBootstrapData['projects'],
  ): ClientManagementRow[] {
    const projectCountByClient = new Map<string, number>();
    filteredProjects.forEach((project) => {
      const clientId = normalizeCanonicalId(project.clientId) ?? String(project.clientId);
      projectCountByClient.set(clientId, (projectCountByClient.get(clientId) ?? 0) + 1);
    });
    const locationById = new Map(bootstrapData.locations.map((location) => [String(location.id), location]));

    return bootstrapData.clients
      .filter((client) => projectCountByClient.has(normalizeCanonicalId(client.id) ?? String(client.id)))
      .map((client) => {
        const clientId = normalizeCanonicalId(client.id) ?? String(client.id);
        const locationId = normalizeCanonicalId(client.locationId);
        const location = locationId ? locationById.get(locationId) : null;
        const locationIds = [locationId]
          .filter((value): value is string => !!value)
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isFinite(value));
        return {
          id: `client-${clientId}`,
          clientId,
          clientName: client.name ?? clientId,
          locationIds,
          linkedLocations: locationId && location ? [{ id: Number.parseInt(locationId, 10), name: location.name }] : [],
          locationId,
          locationName: location?.name ?? '',
          latitude: client.latitude ?? location?.latitude ?? null,
          longitude: client.longitude ?? location?.longitude ?? null,
          projectCount: projectCountByClient.get(clientId) ?? 0,
        } satisfies ClientManagementRow;
      })
      .sort((left, right) => left.clientName.localeCompare(right.clientName));
  }

  private buildManufacturerTableRows(
    bootstrapData: FluorescenceMapBootstrapData,
    rows: ActivityLogRow[],
  ): ManufacturerManagementRow[] {
    const visibleManufacturerIds = new Set<string>();
    const visibleLocationIds = new Set<string>();
    rows.forEach((row) => {
      const manufacturerId = normalizeCanonicalId(row.manufacturerId);
      if (manufacturerId) visibleManufacturerIds.add(manufacturerId);
      const locationCandidates = [row.manufacturerLocationId, row.locationId, ...(row.locationIds ?? [])];
      locationCandidates.forEach((locationId) => {
        const normalized = normalizeCanonicalId(locationId);
        if (normalized) visibleLocationIds.add(normalized);
      });
    });

    const locationById = new Map(bootstrapData.locations.map((location) => [String(location.id), location]));
    return bootstrapData.manufacturers
      .filter((manufacturer) => {
        const manufacturerId = normalizeCanonicalId(manufacturer.id) ?? String(manufacturer.id);
        if (visibleManufacturerIds.size === 0 && visibleLocationIds.size === 0) return true;
        if (visibleManufacturerIds.has(manufacturerId)) return true;
        const candidateLocationIds = [
          manufacturer.locationId,
          ...(manufacturer.locationIds ?? []),
        ]
          .map((locationId) => normalizeCanonicalId(locationId))
          .filter((value): value is string => !!value);
        return candidateLocationIds.some((locationId) => visibleLocationIds.has(locationId));
      })
      .map((manufacturer) => {
        const manufacturerId = String(manufacturer.id);
        const locationIds = [
          manufacturer.locationId,
          ...(manufacturer.locationIds ?? []),
        ]
          .map((locationId) => normalizeCanonicalId(locationId))
          .filter((value): value is string => !!value);
        const primaryLocationId = locationIds[0] ?? null;
        const location = primaryLocationId ? locationById.get(primaryLocationId) : null;
        return {
          id: `manufacturer-${manufacturerId}`,
          manufacturerId,
          manufacturerName: manufacturer.name ?? manufacturerId,
          locationIds: locationIds
            .map((locationId) => Number.parseInt(locationId, 10))
            .filter((value) => Number.isFinite(value)),
          linkedLocations: locationIds
            .map((locationId) => {
              const linkedLocation = locationById.get(locationId);
              if (!linkedLocation) return null;
              const id = Number.parseInt(locationId, 10);
              if (!Number.isFinite(id)) return null;
              return { id, name: linkedLocation.name };
            })
            .filter((value): value is { id: number; name: string } => !!value),
          locationId: primaryLocationId,
          locationName: location?.name ?? '',
          latitude: manufacturer.latitude ?? location?.latitude ?? null,
          longitude: manufacturer.longitude ?? location?.longitude ?? null,
        } satisfies ManufacturerManagementRow;
      })
      .sort((left, right) => left.manufacturerName.localeCompare(right.manufacturerName));
  }

  private buildLocationTableRows(
    bootstrapData: FluorescenceMapBootstrapData,
    rows: ActivityLogRow[],
  ): LocationManagementRow[] {
    const visibleLocationIds = new Set<string>();
    rows.forEach((row) => {
      [row.locationId, row.manufacturerLocationId, row.clientLocationId, ...(row.locationIds ?? [])].forEach((value) => {
        const normalized = normalizeCanonicalId(value);
        if (normalized) visibleLocationIds.add(normalized);
      });
    });

    return bootstrapData.locations
      .filter((location) => {
        if (visibleLocationIds.size === 0) return true;
        const locationId = normalizeCanonicalId(location.id) ?? String(location.id);
        return visibleLocationIds.has(locationId);
      })
      .map((location) => ({
        id: `location-${location.id}`,
        locationId: String(location.id),
        locationName: location.name,
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
      }))
      .sort((left, right) => left.locationName.localeCompare(right.locationName));
  }
}
