import { Injectable } from '@angular/core';
import { Map as MapLibreMap } from 'maplibre-gl';
import {
  FleetSelection,
  Node as WarRoomNode,
  ProjectRoute,
  TransitRoute,
} from '../../../../../models/fluorescence-map.interface';
import { isValidCoordinates } from '../../../../../utils/coordinate.utils';
import { MarkerVm } from '../fluorescence-map-map.vm';
import { RouteVm } from '../routes/fluorescence-map-map-routes.component';
import { FluorescenceMapMathService } from './fluorescence-map-map-math.service';

interface RouteFeatureProperties {
  strokeWidth: number;
  dashArray?: string;
  highlighted: boolean;
  routeId: string;
  strokeColor?: string;
  projectId?: string;
  fromNodeId?: string;
  toNodeId?: string;
}

interface RouteFeature {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties: RouteFeatureProperties;
}

interface RouteFeatureCollection {
  type: 'FeatureCollection';
  features: RouteFeature[];
}

export interface MapFactoryRef {
  id: string;
  subsidiaryId?: string;
  parentGroupId?: string;
}

export interface OverlayBuildParams {
  nodes: WarRoomNode[];
  selected: FleetSelection | null;
  hovered: FleetSelection | null;
  projectRoutes: ProjectRoute[];
  transitRoutes: TransitRoute[];
  filterStatus: 'all' | 'active' | 'inactive';
  routeColor: string;
  map: MapLibreMap;
  factories: MapFactoryRef[];
  parallelRouteOffsetPixels: number;
  getNodeCoordinates: (node: WarRoomNode) => { latitude: number; longitude: number } | null;
  buildMarkerVm: (
    node: WarRoomNode,
    zoom: number,
    selected: FleetSelection | null,
    hovered: FleetSelection | null,
    displayCoordinates: { longitude: number; latitude: number },
    projectStatusColor: string
  ) => MarkerVm;
}

export interface OverlayBuildResult {
  markerPixels: Map<string, { x: number; y: number }>;
  markers: MarkerVm[];
  routes: RouteVm[];
}

@Injectable({ providedIn: 'root' })
export class FluorescenceMapMapOverlayService {
  constructor(private readonly mathService: FluorescenceMapMathService) {}

  buildOverlayModels(params: OverlayBuildParams): OverlayBuildResult {
    const {
      nodes,
      selected,
      hovered,
      projectRoutes,
      transitRoutes,
      filterStatus,
      routeColor,
      map,
      factories,
      parallelRouteOffsetPixels,
      getNodeCoordinates,
      buildMarkerVm,
    } = params;

    const zoom = map.getZoom();
    const endpointNodeIds = this.buildProjectEndpointNodeIds(nodes, factories);
    const projectCoordinatesByNodeId = this.buildProjectCoordinateOverridesByNodeId(
      projectRoutes,
      endpointNodeIds
    );

    const markerPixels = new Map<string, { x: number; y: number }>();
    const projectStatusByNodeId = this.buildProjectStatusByNodeId(projectRoutes, endpointNodeIds);
    const markers: MarkerVm[] = [];

    nodes.forEach((node) => {
      const displayCoords =
        projectCoordinatesByNodeId.get(node.id) ??
        this.getEffectiveCoordinatesFromTransitOrNode(node, transitRoutes, factories, getNodeCoordinates);
      if (!isValidCoordinates(displayCoords)) return;
      const safeDisplayCoords = displayCoords as { longitude: number; latitude: number };
      const point = map.project([safeDisplayCoords.longitude, safeDisplayCoords.latitude]);
      markerPixels.set(node.id, { x: point.x, y: point.y });
      const projectStatusColor = this.getProjectStatusColor(node, projectStatusByNodeId);
      const vm = buildMarkerVm(node, zoom, selected, hovered, safeDisplayCoords, projectStatusColor);
      markers.push(vm);
    });

    const featureCollection = this.buildRouteFeatures(
      nodes,
      projectRoutes,
      transitRoutes,
      filterStatus,
      selected,
      factories,
      routeColor
    );
    const routes: RouteVm[] = [];

    const projectRouteGroups = new Map<string, number[]>();
    featureCollection.features.forEach((feature, index) => {
      const fid = feature.properties.fromNodeId;
      const tid = feature.properties.toNodeId;
      if (!fid || !tid) return;
      const key = `${fid}|${tid}`;
      const arr = projectRouteGroups.get(key) ?? [];
      arr.push(index);
      projectRouteGroups.set(key, arr);
    });

    featureCollection.features.forEach((feature, index) => {
      const coords = feature.geometry.coordinates;
      if (coords.length < 2) return;
      const fid = feature.properties.fromNodeId;
      const tid = feature.properties.toNodeId;

      const startPixel = this.resolveMarkerPixelFromEndpoint(fid, markerPixels, endpointNodeIds);
      const endPixel = this.resolveMarkerPixelFromEndpoint(tid, markerPixels, endpointNodeIds);
      const startPoint = startPixel
        ? { x: startPixel.x, y: startPixel.y }
        : map.project(coords[0]);
      const endPoint = endPixel
        ? { x: endPixel.x, y: endPixel.y }
        : map.project(coords[1]);

      let groupIndex = -1;
      let groupSize = 1;
      let indices: number[] | undefined;
      if (fid && tid) {
        const key = `${fid}|${tid}`;
        indices = projectRouteGroups.get(key);
        if (indices && indices.length > 1) {
          groupIndex = indices.indexOf(index);
          groupSize = indices.length;
        }
        this.updateMarkerPixelsForRouteEndpoints(
          markerPixels,
          fid,
          tid,
          startPoint,
          endPoint,
          indices,
          index,
          endpointNodeIds
        );
      }

      const path = this.createRoutePath(
        startPoint,
        endPoint,
        groupIndex,
        groupSize,
        parallelRouteOffsetPixels
      );
      if (!path) return;

      const routeId = feature.properties.routeId || `route-${index}`;
      routes.push({
        id: routeId,
        path,
        start: { x: startPoint.x, y: startPoint.y },
        end: { x: endPoint.x, y: endPoint.y },
        index,
        beginOffset: this.getRouteBeginOffset(routeId, index),
        highlighted: feature.properties.highlighted,
        strokeWidth: feature.properties.strokeWidth || 1.5,
        dashArray: feature.properties.dashArray,
        strokeColor: feature.properties.strokeColor,
        projectId: feature.properties.projectId,
      });
    });

    return { markerPixels, markers, routes };
  }

  private buildEndpointIdVariants(rawId: string | null | undefined): string[] {
    if (!rawId) return [];
    const variants: string[] = [];
    const push = (value: string | null | undefined): void => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed || variants.includes(trimmed)) return;
      variants.push(trimmed);
    };

    const raw = rawId.trim();
    if (!raw) return [];
    push(raw);

    const withoutSource = raw.replace(/^source-/i, '').trim();
    push(withoutSource);

    const withoutLoc = withoutSource.replace(/^loc-/i, '').trim();
    push(withoutLoc);

    if (/^\d+$/.test(withoutLoc)) {
      const numeric = String(Number.parseInt(withoutLoc, 10));
      push(numeric);
      push(`loc-${numeric}`);
      push(`source-${numeric}`);
      push(`source-loc-${numeric}`);
    }

    return variants;
  }

  private nodeMatchesEndpointId(
    node: WarRoomNode,
    endpointId: string,
    factories: MapFactoryRef[]
  ): boolean {
    const endpointVariants = new Set(this.buildEndpointIdVariants(endpointId));
    const normalizedId = endpointId.toLowerCase();
    const matchesEndpoint = (value: string | null | undefined): boolean =>
      !!value && endpointVariants.has(value.trim());

    if (
      matchesEndpoint(node.id) ||
      matchesEndpoint(node.factoryId) ||
      matchesEndpoint(node.manufacturerLocationId) ||
      matchesEndpoint(node.subsidiaryId) ||
      matchesEndpoint(node.parentGroupId)
    ) {
      return true;
    }

    const factory = factories.find((item) => matchesEndpoint(item.id));
    if (factory && (node.id === factory.subsidiaryId || node.id === factory.parentGroupId)) {
      return true;
    }

    if (
      (normalizedId.includes('fleetzero') || normalizedId.includes('fleet-zero')) &&
      (node.id === 'fleetzero' || !!node.name?.toLowerCase().includes('fleetzero'))
    ) {
      return true;
    }

    return (
      (!!node.name && node.name.toLowerCase() === normalizedId) ||
      (!!node.company && node.company.toLowerCase().includes(normalizedId))
    );
  }

  private buildProjectEndpointNodeIds(
    nodes: WarRoomNode[],
    factories: MapFactoryRef[]
  ): Map<string, string[]> {
    const endpointToNodeIds = new Map<string, Set<string>>();
    const register = (endpointId: string | null | undefined, nodeId: string | null | undefined): void => {
      if (!endpointId || !nodeId) return;
      const endpointKeys = this.buildEndpointIdVariants(endpointId);
      const resolvedNodeId = nodeId.trim();
      if (!endpointKeys.length || !resolvedNodeId) return;
      endpointKeys.forEach((endpointKey) => {
        const current = endpointToNodeIds.get(endpointKey) ?? new Set<string>();
        current.add(resolvedNodeId);
        endpointToNodeIds.set(endpointKey, current);
      });
    };

    nodes.forEach((node) => {
      register(node.id, node.id);
      register(node.factoryId, node.id);
      register(node.manufacturerLocationId, node.id);
      register(node.subsidiaryId, node.id);
      register(node.parentGroupId, node.id);
      register(node.clientId, node.id);
    });

    factories.forEach((factory) => {
      register(factory.id, factory.subsidiaryId);
      register(factory.id, factory.parentGroupId);
    });

    const result = new Map<string, string[]>();
    endpointToNodeIds.forEach((nodeIds, endpointId) => {
      result.set(endpointId, Array.from(nodeIds));
    });
    return result;
  }

  private buildProjectCoordinateOverridesByNodeId(
    projectRoutes: ProjectRoute[],
    endpointNodeIds: Map<string, string[]>
  ): Map<string, { longitude: number; latitude: number }> {
    const overrides = new Map<string, { longitude: number; latitude: number }>();
    const assignOverride = (
      endpointId: string | undefined,
      coordinates: { longitude: number; latitude: number } | undefined
    ): void => {
      if (!endpointId || !isValidCoordinates(coordinates)) return;
      const safeCoordinates = coordinates as { longitude: number; latitude: number };
      this.buildEndpointIdVariants(endpointId).forEach((endpointKey) => {
        const relatedNodeIds = endpointNodeIds.get(endpointKey);
        if (!relatedNodeIds?.length) return;
        relatedNodeIds.forEach((nodeId) => {
          if (!overrides.has(nodeId)) {
            overrides.set(nodeId, {
              longitude: safeCoordinates.longitude,
              latitude: safeCoordinates.latitude,
            });
          }
        });
      });
    };

    projectRoutes.forEach((route) => {
      assignOverride(route.toNodeId, route.toCoordinates);
      assignOverride(route.fromNodeId, route.fromCoordinates);
    });

    return overrides;
  }

  private resolveMarkerPixelFromEndpoint(
    endpointId: string | undefined,
    markerPixels: Map<string, { x: number; y: number }>,
    endpointNodeIds: Map<string, string[]>
  ): { x: number; y: number } | undefined {
    if (!endpointId) return undefined;

    for (const endpointKey of this.buildEndpointIdVariants(endpointId)) {
      const directPixel = markerPixels.get(endpointKey);
      if (directPixel) return directPixel;

      const relatedNodeIds = endpointNodeIds.get(endpointKey);
      if (!relatedNodeIds?.length) continue;
      for (const nodeId of relatedNodeIds) {
        const pixel = markerPixels.get(nodeId);
        if (pixel) return pixel;
      }
    }

    return undefined;
  }

  private updateMarkerPixelsForRouteEndpoints(
    markerPixels: Map<string, { x: number; y: number }>,
    fid: string,
    tid: string,
    startPoint: { x: number; y: number },
    endPoint: { x: number; y: number },
    indices: number[] | undefined,
    index: number,
    endpointNodeIds: Map<string, string[]>
  ): void {
    const shouldUpdate =
      !indices || indices.length <= 1 || index === indices[Math.floor(indices.length / 2)];
    if (!shouldUpdate) return;

    const applyEndpointPoint = (endpointId: string, point: { x: number; y: number }): void => {
      this.buildEndpointIdVariants(endpointId).forEach((endpointKey) => {
        markerPixels.set(endpointKey, { x: point.x, y: point.y });
        const relatedNodeIds = endpointNodeIds.get(endpointKey);
        if (!relatedNodeIds?.length) return;
        relatedNodeIds.forEach((nodeId) => {
          markerPixels.set(nodeId, { x: point.x, y: point.y });
        });
      });
    };

    applyEndpointPoint(fid, startPoint);
    applyEndpointPoint(tid, endPoint);
  }

  private getEffectiveCoordinatesFromTransitOrNode(
    node: WarRoomNode,
    transitRoutes: TransitRoute[],
    factories: MapFactoryRef[],
    getNodeCoordinates: (node: WarRoomNode) => { latitude: number; longitude: number } | null
  ): { longitude: number; latitude: number } | null {
    if (!transitRoutes?.length) {
      return getNodeCoordinates(node);
    }
    for (const route of transitRoutes) {
      if (this.nodeMatchesEndpointId(node, route.from, factories) && isValidCoordinates(route.fromCoordinates)) {
        return { longitude: route.fromCoordinates.longitude, latitude: route.fromCoordinates.latitude };
      }
      if (this.nodeMatchesEndpointId(node, route.to, factories) && isValidCoordinates(route.toCoordinates)) {
        return { longitude: route.toCoordinates.longitude, latitude: route.toCoordinates.latitude };
      }
    }
    return getNodeCoordinates(node);
  }

  private createRoutePath(
    start: { x: number; y: number },
    end: { x: number; y: number },
    indexInGroup: number,
    groupSize: number,
    parallelRouteOffsetPixels: number
  ): string {
    if (groupSize <= 1 || indexInGroup < 0) {
      return this.mathService.createCurvedPath(start, end);
    }

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) {
      return this.mathService.createCurvedPath(start, end);
    }

    const midX = (start.x + end.x) / 2;
    const midY = Math.min(start.y, end.y) - 50;
    const perpX = -dy / len;
    const perpY = dx / len;
    const offsetAmount =
      (indexInGroup - (groupSize - 1) / 2) * parallelRouteOffsetPixels;

    const sx = Number(start.x.toFixed(4));
    const sy = Number(start.y.toFixed(4));
    const ex = Number(end.x.toFixed(4));
    const ey = Number(end.y.toFixed(4));
    const cx = Number((midX + offsetAmount * perpX).toFixed(4));
    const cy = Number((midY + offsetAmount * perpY).toFixed(4));
    return `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`;
  }

  private buildRouteFeatures(
    nodes: WarRoomNode[],
    rawProjectRoutes: ProjectRoute[],
    transitRoutes: TransitRoute[],
    filterStatus: 'all' | 'active' | 'inactive',
    selected: FleetSelection | null,
    factories: MapFactoryRef[],
    routeColor: string
  ): RouteFeatureCollection {
    const features: RouteFeature[] = [];

    const projectRoutes =
      filterStatus === 'active'
        ? (rawProjectRoutes ?? []).filter((route) => route.status === 'Open')
        : filterStatus === 'inactive'
          ? (rawProjectRoutes ?? []).filter(
              (route) => route.status === 'Closed' || route.status === 'Delayed'
            )
          : rawProjectRoutes ?? [];

    projectRoutes.forEach((route) => {
      if (!isValidCoordinates(route.fromCoordinates) || !isValidCoordinates(route.toCoordinates)) return;
      const highlighted = !!selected && (
        route.fromNodeId === selected.id ||
        route.toNodeId === selected.id ||
        route.fromNodeId === selected.factoryId ||
        route.toNodeId === selected.factoryId
      );
      const strokeColor =
        filterStatus === 'all'
          ? route.status === 'Open'
            ? '#00C853'
            : '#D50000'
          : routeColor;
      const startCoords = route.toCoordinates;
      const endCoords = route.fromCoordinates;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [startCoords.longitude, startCoords.latitude],
            [endCoords.longitude, endCoords.latitude],
          ],
        },
        properties: {
          strokeWidth: 2,
          highlighted,
          routeId: route.id,
          projectId: route.projectId,
          strokeColor,
          fromNodeId: route.toNodeId,
          toNodeId: route.fromNodeId,
        },
      });
    });

    return { type: 'FeatureCollection', features };
  }

  private getRouteBeginOffset(routeId: string, index: number): string {
    const seed = `${routeId || 'route'}-${index}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) % 6000;
    }
    const seconds = (hash % 6000) / 1000;
    return `${seconds.toFixed(2)}s`;
  }

  private buildProjectStatusByNodeId(
    routes: ProjectRoute[],
    endpointNodeIds?: Map<string, string[]>
  ): Map<string, 'active' | 'inactive'> {
    const result = new Map<string, 'active' | 'inactive'>();
    const setStatus = (id: string, status: 'active' | 'inactive'): void => {
      const current = result.get(id);
      if (status === 'active' || current == null) {
        result.set(id, status);
        return;
      }
      if (current !== 'active') {
        result.set(id, status);
      }
    };

    const applyStatus = (id: string | undefined, status: 'active' | 'inactive' | null): void => {
      if (!id || !status) return;
      this.buildEndpointIdVariants(id).forEach((endpointKey) => {
        setStatus(endpointKey, status);
        const relatedNodeIds = endpointNodeIds?.get(endpointKey);
        if (relatedNodeIds?.length) {
          relatedNodeIds.forEach((nodeId) => {
            setStatus(nodeId, status);
          });
        }
      });
    };

    routes.forEach((route) => {
      let status: 'active' | 'inactive' | null = null;
      if (route.status === 'Open') status = 'active';
      if (route.status === 'Closed' || route.status === 'Delayed') status = 'inactive';
      applyStatus(route.toNodeId, status);
      applyStatus(route.fromNodeId, status);
    });

    return result;
  }

  private getProjectStatusColor(
    node: WarRoomNode,
    statusByNodeId: Map<string, 'active' | 'inactive'>
  ): string {
    const candidates = [
      node.clientId,
      node.factoryId,
      node.manufacturerLocationId,
      node.subsidiaryId,
      node.parentGroupId,
      node.id,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const status = statusByNodeId.get(candidate);
      if (status === 'active') return '#00C853';
      if (status === 'inactive') return '#D50000';
    }
    return '#0ea5e9';
  }
}
