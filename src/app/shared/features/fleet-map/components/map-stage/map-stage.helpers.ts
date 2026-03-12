import maplibregl from 'maplibre-gl';
import type { MapRouteFeature } from '../../utils/fleet-map-scene';
import { clampLngLatToWorld } from '../../utils/fleet-map-geo';

export type MapStyle = {
  layers?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type RouteLayerProperties = {
  id: string;
  status: 'active' | 'inactive';
  selected: boolean;
};

export type RoutePulseProperties = {
  id: string;
  status: 'active' | 'inactive';
  selected: boolean;
  radius: number;
  opacity: number;
  glowRadius: number;
  glowOpacity: number;
};

export type RouteSegmentProperties = {
  id: string;
  status: 'active' | 'inactive';
  selected: boolean;
  opacity: number;
};

export type RouteMotionState = {
  id: string;
  status: 'active' | 'inactive';
  selected: boolean;
  points: [number, number][];
  beginOffsetMs: number;
};

export const BASE_MAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
export const DARK_MAP_BACKGROUND = '#050608';
export const DARK_MAP_WATER = '#2B3542';
export const DARK_MAP_LINE = '#24303B';
export const DARK_MAP_LABEL = '#8EA0B3';
export const LIGHT_MAP_BACKGROUND = '#f5f7f8';
export const LIGHT_MAP_WATER = '#dfe8ee';
export const LIGHT_MAP_LINE = '#d4dde4';
export const LIGHT_MAP_LABEL = '#60707b';
export const DEFAULT_CENTER: [number, number] = [-20, 25];
export const DEFAULT_ZOOM = 1.8;
export const DEFAULT_PADDING = 80;
export const DATA_FIT_MAX_ZOOM = 6;
export const FOCUS_FIT_MAX_ZOOM = 6.5;
export const SINGLE_POINT_FOCUS_ZOOM = 4.8;
export const SINGLE_POINT_DATA_ZOOM = 3.6;
export const MIN_WORLD_ZOOM = 0.9;
export const ROUTE_SOURCE_ID = 'buspulse-project-routes';
export const ROUTE_PULSE_SOURCE_ID = 'buspulse-project-route-pulses';
export const ROUTE_SEGMENT_SOURCE_ID = 'buspulse-project-route-segments';
export const ROUTE_ACTIVE_LAYER_ID = 'buspulse-project-routes-active';
export const ROUTE_INACTIVE_LAYER_ID = 'buspulse-project-routes-inactive';
export const ROUTE_SEGMENT_ACTIVE_LAYER_ID = 'buspulse-project-routes-segment-active';
export const ROUTE_SEGMENT_INACTIVE_LAYER_ID = 'buspulse-project-routes-segment-inactive';
export const ROUTE_SEGMENT_GLOW_ACTIVE_LAYER_ID = 'buspulse-project-routes-segment-glow-active';
export const ROUTE_SEGMENT_GLOW_INACTIVE_LAYER_ID = 'buspulse-project-routes-segment-glow-inactive';
export const ROUTE_PULSE_GLOW_LAYER_ID = 'buspulse-project-route-pulse-glow';
export const ROUTE_PULSE_LAYER_ID = 'buspulse-project-route-pulse';
export const ROUTE_CURVE_SAMPLE_COUNT = 40;
export const ROUTE_PARALLEL_OFFSET_PIXELS = 6;
export const ROUTE_ANIMATION_DURATION_MS = 6000;

export const FALLBACK_STYLE: MapStyle = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': LIGHT_MAP_BACKGROUND,
      },
    },
  ],
};

function cloneStyle(style: MapStyle): MapStyle {
  return JSON.parse(JSON.stringify(style)) as MapStyle;
}

function isWaterLayer(layerId: string, sourceLayer?: string): boolean {
  return layerId.includes('water') || sourceLayer === 'water' || sourceLayer === 'waterway';
}

function isBoundaryLayer(layerId: string, sourceLayer?: string): boolean {
  return layerId.includes('boundary') || sourceLayer === 'boundary';
}

function isRoadLayer(layerId: string, sourceLayer?: string): boolean {
  return (
    layerId.includes('road') ||
    layerId.includes('transport') ||
    layerId.includes('tunnel') ||
    layerId.includes('bridge') ||
    layerId.includes('aeroway') ||
    sourceLayer === 'transportation' ||
    sourceLayer === 'transportation_name' ||
    sourceLayer === 'aeroway'
  );
}

function isPlaceLabelLayer(layerId: string, sourceLayer?: string): boolean {
  return layerId.includes('place') || sourceLayer === 'place';
}

function isPoiLayer(layerId: string, sourceLayer?: string): boolean {
  return layerId.includes('poi') || sourceLayer?.includes('poi') === true;
}

function isTransitLayer(layerId: string, sourceLayer?: string): boolean {
  return (
    layerId.includes('transit') ||
    layerId.includes('rail') ||
    sourceLayer === 'transit' ||
    sourceLayer === 'transportation_name'
  );
}

function isBuildingLayer(layerId: string, sourceLayer?: string): boolean {
  return layerId.includes('building') || sourceLayer === 'building';
}

export function createThemedMapStyle(baseStyle: MapStyle, isDark: boolean): MapStyle {
  const themedStyle = cloneStyle(baseStyle);
  themedStyle.layers = (themedStyle.layers ?? []).map((layer) => {
    const layerId = String(layer['id'] ?? '');
    const sourceLayer = typeof layer['source-layer'] === 'string'
      ? layer['source-layer']
      : undefined;
    const nextLayer = { ...layer };
    const paint = { ...(typeof layer['paint'] === 'object' && layer['paint'] ? layer['paint'] as Record<string, unknown> : {}) };
    const layout = { ...(typeof layer['layout'] === 'object' && layer['layout'] ? layer['layout'] as Record<string, unknown> : {}) };

    if (
      isPoiLayer(layerId, sourceLayer) ||
      isTransitLayer(layerId, sourceLayer) ||
      isBuildingLayer(layerId, sourceLayer) ||
      layerId.includes('housenumber')
    ) {
      layout['visibility'] = 'none';
      nextLayer['layout'] = layout;
      nextLayer['paint'] = paint;
      return nextLayer;
    }

    if (nextLayer['type'] === 'background') {
      paint['background-color'] = isDark ? DARK_MAP_BACKGROUND : LIGHT_MAP_BACKGROUND;
      paint['background-opacity'] = 1;
    }

    if (nextLayer['type'] === 'fill') {
      paint['fill-color'] = isWaterLayer(layerId, sourceLayer)
        ? (isDark ? DARK_MAP_WATER : LIGHT_MAP_WATER)
        : (isDark ? DARK_MAP_BACKGROUND : LIGHT_MAP_BACKGROUND);
      if (!isWaterLayer(layerId, sourceLayer)) {
        paint['fill-outline-color'] = isDark ? DARK_MAP_LINE : LIGHT_MAP_LINE;
        paint['fill-opacity'] = isDark ? 0.9 : 0.72;
      }
    }

    if (nextLayer['type'] === 'line') {
      paint['line-color'] = isDark ? DARK_MAP_LINE : LIGHT_MAP_LINE;
      if (isBoundaryLayer(layerId, sourceLayer)) {
        paint['line-opacity'] = isDark ? 0.42 : 0.22;
      } else if (isRoadLayer(layerId, sourceLayer)) {
        paint['line-opacity'] = isDark ? 0.24 : 0.12;
        paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 3, 0.4, 10, 1.1, 16, 2.4];
      } else {
        paint['line-opacity'] = isDark ? 0.18 : 0.1;
      }
    }

    if (nextLayer['type'] === 'symbol') {
      if (isPlaceLabelLayer(layerId, sourceLayer)) {
        paint['text-color'] = isDark ? DARK_MAP_LABEL : LIGHT_MAP_LABEL;
        paint['icon-color'] = isDark ? DARK_MAP_LABEL : LIGHT_MAP_LABEL;
        paint['text-opacity'] = isDark ? 0.86 : 0.72;
      } else {
        layout['visibility'] = 'none';
      }

      paint['text-halo-color'] = 'rgba(5, 6, 8, 0)';
      paint['text-halo-width'] = 0;
    }

    nextLayer['layout'] = layout;
    nextLayer['paint'] = paint;
    return nextLayer;
  });

  return themedStyle;
}

function normalizeMapPoints(points?: [number, number][]): [number, number][] {
  if (!Array.isArray(points)) return [];
  return points
    .filter((point): point is [number, number] => Array.isArray(point) && point.length === 2)
    .map((point) => clampLngLatToWorld(point));
}

function routeGroupKey(route: MapRouteFeature): string | null {
  const [from, to] = route.geometry.coordinates;
  if (!from || !to) return null;
  return `${from[0].toFixed(6)}:${from[1].toFixed(6)}|${to[0].toFixed(6)}:${to[1].toFixed(6)}`;
}

function buildRouteBeginOffsetMs(routeId: string, index: number): number {
  const seed = `${routeId || 'route'}-${index}`;
  let hash = 0;
  for (let position = 0; position < seed.length; position += 1) {
    hash = (hash * 31 + seed.charCodeAt(position)) % ROUTE_ANIMATION_DURATION_MS;
  }
  return hash % ROUTE_ANIMATION_DURATION_MS;
}

function createRouteControlPoint(
  start: { x: number; y: number },
  end: { x: number; y: number },
  indexInGroup: number,
  groupSize: number,
): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const lift = Math.max(24, Math.min(length * 0.12, 84));
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  if (length < 1e-6 || groupSize <= 1 || indexInGroup < 0) {
    return { x: midX, y: midY - lift };
  }

  const perpendicularX = -dy / length;
  const perpendicularY = dx / length;
  const offsetAmount = (indexInGroup - (groupSize - 1) / 2) * ROUTE_PARALLEL_OFFSET_PIXELS;

  return {
    x: midX + (offsetAmount * perpendicularX * 1.3),
    y: midY + (offsetAmount * perpendicularY * 1.3) - lift,
  };
}

function sampleQuadraticCurve(
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  sampleCount: number,
): Array<{ x: number; y: number }> {
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const t = index / sampleCount;
    const inverse = 1 - t;
    return {
      x: (inverse * inverse * start.x) + (2 * inverse * t * control.x) + (t * t * end.x),
      y: (inverse * inverse * start.y) + (2 * inverse * t * control.y) + (t * t * end.y),
    };
  });
}

export function buildAnchoredRouteState(
  map: maplibregl.Map,
  routes: MapRouteFeature[],
): {
  lineCollection: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteLayerProperties>;
  motionStates: RouteMotionState[];
} {
  const groupedRouteIndexes = new Map<string, number[]>();
  routes.forEach((route, index) => {
    const key = routeGroupKey(route);
    if (!key) return;
    const nextIndexes = groupedRouteIndexes.get(key) ?? [];
    nextIndexes.push(index);
    groupedRouteIndexes.set(key, nextIndexes);
  });

  const lineFeatures: Array<GeoJSON.Feature<GeoJSON.LineString, RouteLayerProperties>> = [];
  const motionStates: RouteMotionState[] = [];

  routes.forEach((route, index) => {
    const [from, to] = route.geometry.coordinates;
    if (!from || !to) return;

    const start = map.project([from[0], from[1]]);
    const end = map.project([to[0], to[1]]);
    const key = routeGroupKey(route);
    const groupedIndexes = key ? groupedRouteIndexes.get(key) : undefined;
    const groupIndex = groupedIndexes ? groupedIndexes.indexOf(index) : -1;
    const groupSize = groupedIndexes?.length ?? 1;
    const control = createRouteControlPoint(start, end, groupIndex, groupSize);
    const sampledPoints = sampleQuadraticCurve(start, control, end, ROUTE_CURVE_SAMPLE_COUNT);
    const coordinates = sampledPoints.map((point) => {
      const lngLat = map.unproject([point.x, point.y]);
      return clampLngLatToWorld([lngLat.lng, lngLat.lat]);
    });
    const id = String(route.properties?.id ?? `route-${index}`);
    const status = route.properties?.status ?? 'active';
    const selected = Boolean(route.properties?.selected);

    lineFeatures.push({
      type: 'Feature',
      properties: { id, status, selected },
      geometry: { type: 'LineString', coordinates },
    });

    motionStates.push({
      id,
      status,
      selected,
      points: coordinates,
      beginOffsetMs: buildRouteBeginOffsetMs(id, index),
    });
  });

  return {
    lineCollection: { type: 'FeatureCollection', features: lineFeatures },
    motionStates,
  };
}

function interpolateRouteProgress(cycleProgress: number): { progress: number; opacity: number } {
  if (cycleProgress <= 0.1) return { progress: 0, opacity: 0 };
  if (cycleProgress <= 0.15) {
    return { progress: (cycleProgress - 0.1) / 0.05 * 0.14, opacity: (cycleProgress - 0.1) / 0.05 };
  }
  if (cycleProgress <= 0.45) {
    return { progress: 0.14 + (((cycleProgress - 0.15) / 0.3) * 0.86), opacity: 1 };
  }
  if (cycleProgress <= 0.7) return { progress: 1, opacity: 1 };
  if (cycleProgress <= 1) {
    return { progress: 1, opacity: Math.max(0, 1 - ((cycleProgress - 0.7) / 0.3)) };
  }
  return { progress: 1, opacity: 0 };
}

export function buildRoutePulseCollection(
  motionStates: RouteMotionState[],
  now: number,
): GeoJSON.FeatureCollection<GeoJSON.Point, RoutePulseProperties> {
  const features = motionStates.flatMap((route) => {
    if (route.points.length === 0) return [];

    const cycleProgress = ((now + route.beginOffsetMs) % ROUTE_ANIMATION_DURATION_MS) / ROUTE_ANIMATION_DURATION_MS;
    const { progress, opacity } = interpolateRouteProgress(cycleProgress);
    if (opacity <= 0.01) return [];

    const scaledIndex = progress * (route.points.length - 1);
    const lowerIndex = Math.floor(scaledIndex);
    const upperIndex = Math.min(route.points.length - 1, lowerIndex + 1);
    const blend = scaledIndex - lowerIndex;
    const start = route.points[lowerIndex];
    const end = route.points[upperIndex];
    const lng = start[0] + ((end[0] - start[0]) * blend);
    const lat = start[1] + ((end[1] - start[1]) * blend);
    const radius = route.selected ? 5 : 4;

    return [{
      type: 'Feature' as const,
      properties: {
        id: route.id,
        status: route.status,
        selected: route.selected,
        radius,
        opacity,
        glowRadius: route.selected ? radius + 6 : radius + 5,
        glowOpacity: opacity * (route.status === 'inactive' ? 0.32 : 0.42),
      },
      geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
    }];
  });

  return { type: 'FeatureCollection', features };
}

export function buildRouteSegmentCollection(
  motionStates: RouteMotionState[],
  now: number,
): GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> {
  const features = motionStates.flatMap((route) => {
    if (route.points.length < 2) return [];

    const cycleProgress = ((now + route.beginOffsetMs) % ROUTE_ANIMATION_DURATION_MS) / ROUTE_ANIMATION_DURATION_MS;
    const { progress, opacity } = interpolateRouteProgress(cycleProgress);
    if (opacity <= 0.01 || progress <= 0.01) return [];

    const scaledIndex = progress * (route.points.length - 1);
    const lowerIndex = Math.floor(scaledIndex);
    const upperIndex = Math.min(route.points.length - 1, lowerIndex + 1);
    const blend = scaledIndex - lowerIndex;
    const interpolatedPoint: [number, number] = [
      route.points[lowerIndex][0] + ((route.points[upperIndex][0] - route.points[lowerIndex][0]) * blend),
      route.points[lowerIndex][1] + ((route.points[upperIndex][1] - route.points[lowerIndex][1]) * blend),
    ];
    const coordinates = [...route.points.slice(0, lowerIndex + 1), interpolatedPoint];
    if (coordinates.length < 2) return [];

    return [{
      type: 'Feature' as const,
      properties: { id: route.id, status: route.status, selected: route.selected, opacity },
      geometry: { type: 'LineString' as const, coordinates },
    }];
  });

  return { type: 'FeatureCollection', features };
}

export function removeLayerIfExists(map: maplibregl.Map, layerId: string): void {
  if (map.getLayer(layerId)) map.removeLayer(layerId);
}

export function removeSourceIfExists(map: maplibregl.Map, sourceId: string): void {
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

function boundsFromCoordinates(points?: [number, number][]): maplibregl.LngLatBounds | null {
  const normalizedPoints = normalizeMapPoints(points);
  if (normalizedPoints.length === 0) return null;

  const bounds = new maplibregl.LngLatBounds(normalizedPoints[0], normalizedPoints[0]);
  normalizedPoints.slice(1).forEach((point) => bounds.extend(point));
  return bounds;
}

function hasSingleCoordinate(points?: [number, number][]): boolean {
  if (!Array.isArray(points)) return false;
  if (points.length <= 1) return points.length === 1;
  const [firstLng, firstLat] = points[0];
  return points.every(([lng, lat]) => lng === firstLng && lat === firstLat);
}

function toLngLatTuple(lngLat: maplibregl.LngLatLike): [number, number] {
  if (Array.isArray(lngLat)) return [lngLat[0], lngLat[1]];
  if ('lng' in lngLat) return [lngLat.lng, lngLat.lat];
  return [lngLat.lon, lngLat.lat];
}

export function fitMapToPoints(
  map: maplibregl.Map,
  points: [number, number][] | undefined,
  options: { padding: number; maxZoom: number; singlePointZoom: number; duration?: number },
): void {
  const normalizedPoints = normalizeMapPoints(points);
  if (normalizedPoints.length === 0) return;

  if (hasSingleCoordinate(normalizedPoints)) {
    map.easeTo({
      center: normalizedPoints[0],
      zoom: Math.min(options.singlePointZoom, options.maxZoom),
      duration: options.duration ?? 450,
      essential: true,
    });
    return;
  }

  const bounds = boundsFromCoordinates(normalizedPoints);
  if (!bounds || bounds.isEmpty()) return;

  const camera = map.cameraForBounds(bounds, { padding: options.padding, maxZoom: options.maxZoom });
  if (!camera?.center || camera.zoom == null) return;

  map.easeTo({
    center: clampLngLatToWorld(toLngLatTuple(camera.center)),
    zoom: Math.max(MIN_WORLD_ZOOM, Math.min(camera.zoom, options.maxZoom)),
    bearing: 0,
    pitch: 0,
    duration: options.duration ?? 450,
    essential: true,
  });
}
