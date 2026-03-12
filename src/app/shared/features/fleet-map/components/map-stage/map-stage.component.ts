import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  ViewEncapsulation,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapOptions as MapLibreMapOptions,
  Marker as MapLibreMarker,
  StyleSpecification,
} from 'maplibre-gl';
import type { ApiClient, ApiLocation, ApiManufacturer, ApiProject, FleetMode, FleetSelectedEntity } from '../../models/fleet-map.models';
import { hasUsableCoordinates, clampLngLatToWorld, WORLD_BOUNDS } from '../../utils/fleet-map-geo';
import { getProjectStatusDisplayLabel } from '../../utils/fleet-map-status';
import { buildMapScene, type MapMarkerSpec } from '../../utils/fleet-map-scene';
import {
  BASE_MAP_STYLE_URL,
  DATA_FIT_MAX_ZOOM,
  DEFAULT_CENTER,
  DEFAULT_PADDING,
  DEFAULT_ZOOM,
  FALLBACK_STYLE,
  FOCUS_FIT_MAX_ZOOM,
  MIN_WORLD_ZOOM,
  ROUTE_ACTIVE_LAYER_ID,
  ROUTE_INACTIVE_LAYER_ID,
  ROUTE_PULSE_GLOW_LAYER_ID,
  ROUTE_PULSE_LAYER_ID,
  ROUTE_PULSE_SOURCE_ID,
  ROUTE_SEGMENT_ACTIVE_LAYER_ID,
  ROUTE_SEGMENT_GLOW_ACTIVE_LAYER_ID,
  ROUTE_SEGMENT_GLOW_INACTIVE_LAYER_ID,
  ROUTE_SEGMENT_INACTIVE_LAYER_ID,
  ROUTE_SEGMENT_SOURCE_ID,
  ROUTE_SOURCE_ID,
  SINGLE_POINT_DATA_ZOOM,
  SINGLE_POINT_FOCUS_ZOOM,
  buildAnchoredRouteState,
  buildRoutePulseCollection,
  buildRouteSegmentCollection,
  createThemedMapStyle,
  fitMapToPoints,
  removeLayerIfExists,
  removeSourceIfExists,
  type MapStyle,
  type RouteMotionState,
} from './map-stage.helpers';

interface DetailLine {
  label: string;
  value: string;
}

interface DetailCardLogo {
  key: string;
  kind: 'client' | 'manufacturer';
  name: string;
  src: string;
}

type MarkerInstance = {
  marker: MapLibreMarker;
  signature: string;
};

type BrowserNavigator = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

type BrowserWindow = Window & typeof globalThis & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type MapLibreRuntimeModule = Awaited<typeof import('maplibre-gl')> & {
  default?: Awaited<typeof import('maplibre-gl')>;
};

@Component({
  selector: 'app-map-stage',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map-stage.component.html',
  styleUrl: './map-stage.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class MapStageComponent implements AfterViewInit, OnDestroy {
  readonly mode = input.required<FleetMode>();
  readonly surface = input<'page' | 'widget'>('page');
  readonly projects = input.required<ApiProject[]>();
  readonly clients = input.required<ApiClient[]>();
  readonly manufacturers = input.required<ApiManufacturer[]>();
  readonly locations = input.required<ApiLocation[]>();
  readonly isDark = input.required<boolean>();
  readonly viewedProject = input<ApiProject | null>(null);
  readonly selectedEntity = input<FleetSelectedEntity | null>(null);
  readonly focusedEntity = input<FleetSelectedEntity | null>(null);

  readonly selectEntity = output<FleetSelectedEntity | null>();

  @ViewChild('mapContainer') private mapContainer?: ElementRef<HTMLDivElement>;

  readonly clientById = computed(() => new Map(this.clients().map((client) => [client.id, client])));
  readonly manufacturerById = computed(() => new Map(this.manufacturers().map((manufacturer) => [manufacturer.id, manufacturer])));
  readonly locationById = computed(() => new Map(this.locations().map((location) => [location.id, location])));
  readonly scene = computed(() => buildMapScene({
    mode: this.mode(),
    projects: this.projects(),
    clients: this.clients(),
    manufacturers: this.manufacturers(),
    locations: this.locations(),
    selectedEntity: this.selectedEntity(),
    focusedEntity: this.focusedEntity(),
    viewedProject: this.viewedProject(),
    clientById: this.clientById(),
    locationById: this.locationById(),
  }));
  readonly projectIsolationKey = computed(() => (
    this.mode() === 'projects' && this.viewedProject() ? this.viewedProject()!.id : ''
  ));
  readonly mapReady = signal(false);
  readonly mapActivated = signal(false);
  readonly failedLogoKeys = signal<Set<string>>(new Set());
  readonly showLinkedLocations = computed(() => (
    this.mode() === 'manufacturers' && this.scene().markers.some((marker) => marker.type === 'location')
  ));

  readonly relatedProjectClient = computed(() => {
    const selection = this.selectedEntity();
    if (selection?.kind !== 'project') return null;
    return this.clientById().get(selection.data.clientId) ?? null;
  });

  readonly relatedProjectLocations = computed(() => {
    const selection = this.selectedEntity();
    if (selection?.kind !== 'project') return [];
    return selection.data.locationIds
      .map((locationId) => this.locationById().get(locationId))
      .filter((location): location is ApiLocation => !!location);
  });

  readonly relatedProjectManufacturers = computed(() => {
    const selection = this.selectedEntity();
    if (selection?.kind !== 'project') return [];
    const locationIds = new Set(selection.data.locationIds);
    return this.manufacturers().filter((manufacturer) => manufacturer.locationIds.some((locationId) => locationIds.has(locationId)));
  });

  readonly relatedLocationClients = computed(() => {
    const selection = this.selectedEntity();
    if (selection?.kind !== 'location') return [];
    return this.clients().filter((client) => client.locationIds.includes(selection.data.id));
  });

  readonly relatedLocationManufacturers = computed(() => {
    const selection = this.selectedEntity();
    if (selection?.kind !== 'location') return [];

    const related = new Map<string, ApiManufacturer>();
    const directManufacturer = selection.data.manufacturerId
      ? this.manufacturerById().get(selection.data.manufacturerId)
      : null;

    if (directManufacturer) related.set(directManufacturer.id, directManufacturer);
    this.manufacturers().forEach((manufacturer) => {
      if (manufacturer.locationIds.includes(selection.data.id)) {
        related.set(manufacturer.id, manufacturer);
      }
    });
    return Array.from(related.values());
  });

  readonly detailLines = computed<DetailLine[]>(() => {
    const selection = this.selectedEntity();
    if (!selection) return [];

    switch (selection.kind) {
      case 'project':
        return [
          { label: 'Client', value: this.relatedProjectClient()?.name ?? selection.data.clientId },
          { label: 'Project Type', value: selection.data.type },
          { label: 'Linked Sites', value: String(this.relatedProjectLocations().length || selection.data.locationIds.length) },
          { label: 'Status', value: getProjectStatusDisplayLabel(selection.data.status) },
        ];
      case 'client':
        return [
          { label: 'Entity', value: 'Client' },
          { label: 'Mapped Sites', value: `${this.countMappedLocations(selection.data.locationIds)}/${selection.data.locationIds.length}` },
          { label: 'Coordinates', value: this.coordinateLabel(selection.data.lat, selection.data.lng) },
        ];
      case 'manufacturer':
        return [
          { label: 'Entity', value: 'Manufacturer' },
          { label: 'Mapped Sites', value: `${this.countMappedLocations(selection.data.locationIds)}/${selection.data.locationIds.length}` },
          { label: 'Coordinates', value: this.coordinateLabel(selection.data.lat, selection.data.lng) },
        ];
      case 'location':
        return [
          { label: 'Entity', value: selection.data.type ?? 'Location' },
          { label: 'Coordinates', value: this.coordinateLabel(selection.data.lat, selection.data.lng) },
          { label: 'Identifier', value: selection.data.uniqueId ?? selection.data.id },
        ];
    }
  });

  readonly relatedLogos = computed<DetailCardLogo[]>(() => {
    const selection = this.selectedEntity();
    if (!selection) return [];

    const seen = new Set<string>();
    const logos: DetailCardLogo[] = [];
    const addLogo = (kind: 'client' | 'manufacturer', item: ApiClient | ApiManufacturer | null | undefined): void => {
      if (!item?.logoUrl) return;
      const key = `${kind}:${item.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      logos.push({ key, kind, name: item.name, src: item.logoUrl });
    };

    if (selection.kind === 'project') {
      addLogo('client', this.relatedProjectClient());
      this.relatedProjectManufacturers().forEach((manufacturer) => addLogo('manufacturer', manufacturer));
    }

    if (selection.kind === 'location') {
      this.relatedLocationClients().forEach((client) => addLogo('client', client));
      this.relatedLocationManufacturers().forEach((manufacturer) => addLogo('manufacturer', manufacturer));
    }

    return logos;
  });

  private map: MapLibreMap | null = null;
  private maplibreModule: Awaited<typeof import('maplibre-gl')> | null = null;
  private markers = new Map<string, MarkerInstance>();
  private baseStyle: MapStyle = FALLBACK_STYLE;
  private hasInitialViewport = false;
  private lastFocusedKey = '';
  private lastProjectIsolationKey = '';
  private routeAnimationFrame: number | null = null;
  private routeSyncFrame: number | null = null;
  private routeMotionStates: RouteMotionState[] = [];
  private mapIntersectionObserver: IntersectionObserver | null = null;
  private idleCallbackHandle: number | null = null;
  private prefersReducedMotion = false;
  private documentVisible = true;

  private readonly handleVisibilityChange = (): void => {
    this.documentVisible = document.visibilityState !== 'hidden';
    if (!this.documentVisible) {
      this.stopRouteAnimation();
      return;
    }

    this.requestRouteSync();
  };

  private readonly handleStyleLoad = (): void => {
    this.mapReady.set(true);
    this.requestRouteSync();
    this.syncMarkersAndViewport();
  };

  private readonly handleMapMotion = (): void => {
    this.requestRouteSync();
  };

  constructor() {
    effect(() => {
      const dark = this.isDark();
      if (!this.map) return;
      this.mapReady.set(false);
      this.map.setStyle(createThemedMapStyle(this.baseStyle, dark) as StyleSpecification);
    });

    effect(() => {
      this.scene();
      this.focusedEntity();
      this.projectIsolationKey();
      if (!this.map || !this.mapReady()) return;
      this.syncMarkersAndViewport();
      this.requestRouteSync();
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const container = this.mapContainer?.nativeElement;
    if (!container || this.map) return;

    this.documentVisible = document.visibilityState !== 'hidden';
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.deferMapInitialization(container);
  }

  ngOnDestroy(): void {
    if (this.idleCallbackHandle != null) {
      (window as BrowserWindow).cancelIdleCallback?.(this.idleCallbackHandle);
      this.idleCallbackHandle = null;
    }
    this.mapIntersectionObserver?.disconnect();
    this.mapIntersectionObserver = null;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    if (this.routeSyncFrame != null) {
      cancelAnimationFrame(this.routeSyncFrame);
    }
    this.stopRouteAnimation();
    this.markers.forEach(({ marker }) => marker.remove());
    this.markers.clear();

    if (this.map) {
      this.map.off('style.load', this.handleStyleLoad);
      this.map.off('move', this.handleMapMotion);
      this.map.off('zoom', this.handleMapMotion);
      this.map.off('resize', this.handleMapMotion);
      this.map.off('rotate', this.handleMapMotion);
      this.map.off('pitch', this.handleMapMotion);
      this.map.remove();
      this.map = null;
    }
  }

  private syncMarkersAndViewport(): void {
    if (!this.map) return;

    const scene = this.scene();
    const projectIsolationKey = this.projectIsolationKey();

    if (this.lastProjectIsolationKey !== projectIsolationKey) {
      this.markers.forEach(({ marker }) => marker.remove());
      this.markers.clear();
      this.clearRouteRendering(this.map);
      this.lastProjectIsolationKey = projectIsolationKey;
    }

    if (projectIsolationKey && !scene.projectIsolationReady) {
      this.markers.forEach(({ marker }) => marker.remove());
      this.markers.clear();
      this.clearRouteRendering(this.map);
      return;
    }

    const nextMarkerKeys = new Set(scene.markers.map((marker) => marker.key));
    this.markers.forEach((markerInstance, markerKey) => {
      if (!nextMarkerKeys.has(markerKey)) {
        markerInstance.marker.remove();
        this.markers.delete(markerKey);
      }
    });

    scene.markers.forEach((markerSpec) => {
      const nextSignature = this.markerSignature(markerSpec);
      const existing = this.markers.get(markerSpec.key);
      if (existing?.signature === nextSignature) return;
      existing?.marker.remove();
      const nextMarker = this.createMarker(markerSpec);
      if (nextMarker) this.markers.set(markerSpec.key, nextMarker);
    });

    const focused = this.focusedEntity();
    const focusedKey = focused ? `${focused.kind}:${focused.data.id}` : '';
    const focusChanged = this.lastFocusedKey !== focusedKey;

    if (!this.hasInitialViewport && scene.allBounds.length > 0) {
      fitMapToPoints(this.map, scene.allBounds, {
        padding: DEFAULT_PADDING,
        maxZoom: DATA_FIT_MAX_ZOOM,
        singlePointZoom: SINGLE_POINT_DATA_ZOOM,
      });
      this.hasInitialViewport = true;
    } else if (focusChanged && focused && scene.focusBounds.length > 0) {
      fitMapToPoints(this.map, scene.focusBounds, {
        padding: 90,
        maxZoom: FOCUS_FIT_MAX_ZOOM,
        singlePointZoom: SINGLE_POINT_FOCUS_ZOOM,
      });
    }

    this.lastFocusedKey = focusedKey;
  }

  private requestRouteSync(): void {
    if (this.routeSyncFrame != null) {
      cancelAnimationFrame(this.routeSyncFrame);
    }

    this.routeSyncFrame = requestAnimationFrame(() => {
      this.routeSyncFrame = null;
      this.syncRouteRendering();
    });
  }

  private syncRouteRendering(): void {
    if (!this.map || !this.mapReady() || this.mode() !== 'projects') {
      this.clearRouteRendering(this.map);
      return;
    }

    const scene = this.scene();
    this.ensureRouteLayers(this.map);
    const { lineCollection, motionStates } = buildAnchoredRouteState(this.map, scene.routes);
    this.routeMotionStates = motionStates;

    const routeSource = this.map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
    routeSource?.setData(lineCollection);

    const segmentSource = this.map.getSource(ROUTE_SEGMENT_SOURCE_ID) as GeoJSONSource | undefined;
    segmentSource?.setData(buildRouteSegmentCollection(motionStates, performance.now()));

    const pulseSource = this.map.getSource(ROUTE_PULSE_SOURCE_ID) as GeoJSONSource | undefined;
    pulseSource?.setData(buildRoutePulseCollection(motionStates, performance.now()));

    if (motionStates.length > 0) {
      this.startRouteAnimation();
    } else {
      this.stopRouteAnimation();
    }
  }

  private stopRouteAnimation(): void {
    if (this.routeAnimationFrame != null) {
      cancelAnimationFrame(this.routeAnimationFrame);
      this.routeAnimationFrame = null;
    }
  }

  private clearRouteRendering(map: MapLibreMap | null): void {
    this.stopRouteAnimation();
    this.routeMotionStates = [];
    if (!map) return;

    removeLayerIfExists(map, ROUTE_PULSE_LAYER_ID);
    removeLayerIfExists(map, ROUTE_PULSE_GLOW_LAYER_ID);
    removeLayerIfExists(map, ROUTE_SEGMENT_GLOW_INACTIVE_LAYER_ID);
    removeLayerIfExists(map, ROUTE_SEGMENT_GLOW_ACTIVE_LAYER_ID);
    removeLayerIfExists(map, ROUTE_SEGMENT_INACTIVE_LAYER_ID);
    removeLayerIfExists(map, ROUTE_SEGMENT_ACTIVE_LAYER_ID);
    removeLayerIfExists(map, ROUTE_INACTIVE_LAYER_ID);
    removeLayerIfExists(map, ROUTE_ACTIVE_LAYER_ID);
    removeSourceIfExists(map, ROUTE_PULSE_SOURCE_ID);
    removeSourceIfExists(map, ROUTE_SEGMENT_SOURCE_ID);
    removeSourceIfExists(map, ROUTE_SOURCE_ID);
  }

  private ensureRouteLayers(map: MapLibreMap): void {
    if (!map.getSource(ROUTE_SOURCE_ID)) {
      map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
    }

    if (!map.getLayer(ROUTE_ACTIVE_LAYER_ID)) {
      map.addLayer({
        id: ROUTE_ACTIVE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        filter: ['==', ['get', 'status'], 'active'],
        paint: {
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#00ff88', 1, '#00d46a'],
          'line-width': ['case', ['boolean', ['get', 'selected'], false], 3, 2.2],
          'line-opacity': 0.92,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
    }

    if (!map.getLayer(ROUTE_INACTIVE_LAYER_ID)) {
      map.addLayer({
        id: ROUTE_INACTIVE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        filter: ['==', ['get', 'status'], 'inactive'],
        paint: {
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#ff2a2a', 1, '#ff0000'],
          'line-width': ['case', ['boolean', ['get', 'selected'], false], 2.3, 1.5],
          'line-opacity': 0.9,
        },
        layout: { 'line-cap': 'butt', 'line-join': 'round', 'line-round-limit': 1 },
      });
      map.setPaintProperty(ROUTE_INACTIVE_LAYER_ID, 'line-dasharray', [3, 3]);
    }

    if (!map.getSource(ROUTE_SEGMENT_SOURCE_ID)) {
      map.addSource(ROUTE_SEGMENT_SOURCE_ID, { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
    }

    const segmentLayerSpecs: Array<{ id: string; status: 'active' | 'inactive'; glow: boolean; width: number; opacity: number }> = [
      { id: ROUTE_SEGMENT_GLOW_ACTIVE_LAYER_ID, status: 'active', glow: true, width: 7, opacity: 0.18 },
      { id: ROUTE_SEGMENT_ACTIVE_LAYER_ID, status: 'active', glow: false, width: 3.6, opacity: 1 },
      { id: ROUTE_SEGMENT_GLOW_INACTIVE_LAYER_ID, status: 'inactive', glow: true, width: 5.8, opacity: 0.14 },
      { id: ROUTE_SEGMENT_INACTIVE_LAYER_ID, status: 'inactive', glow: false, width: 2.8, opacity: 1 },
    ];

    segmentLayerSpecs.forEach((spec) => {
      if (map.getLayer(spec.id)) return;
      map.addLayer({
        id: spec.id,
        type: 'line',
        source: ROUTE_SEGMENT_SOURCE_ID,
        filter: ['==', ['get', 'status'], spec.status],
        paint: {
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, spec.status === 'active' ? '#00ff88' : '#ff2a2a', 1, spec.status === 'active' ? '#00d46a' : '#ff0000'],
          'line-width': ['case', ['boolean', ['get', 'selected'], false], spec.width, Math.max(spec.width - 0.7, 2.1)],
          'line-opacity': spec.glow ? ['*', ['coalesce', ['get', 'opacity'], 0], spec.opacity] : ['coalesce', ['get', 'opacity'], 0],
          ...(spec.glow ? { 'line-blur': 0.7 } : {}),
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
    });

    if (!map.getSource(ROUTE_PULSE_SOURCE_ID)) {
      map.addSource(ROUTE_PULSE_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (!map.getLayer(ROUTE_PULSE_GLOW_LAYER_ID)) {
      map.addLayer({
        id: ROUTE_PULSE_GLOW_LAYER_ID,
        type: 'circle',
        source: ROUTE_PULSE_SOURCE_ID,
        paint: {
          'circle-color': ['match', ['get', 'status'], 'inactive', '#ff0000', '#00e676'],
          'circle-radius': ['coalesce', ['get', 'glowRadius'], 0],
          'circle-opacity': ['coalesce', ['get', 'glowOpacity'], 0],
          'circle-blur': 0.55,
        },
      });
    }

    if (!map.getLayer(ROUTE_PULSE_LAYER_ID)) {
      map.addLayer({
        id: ROUTE_PULSE_LAYER_ID,
        type: 'circle',
        source: ROUTE_PULSE_SOURCE_ID,
        paint: {
          'circle-color': ['match', ['get', 'status'], 'inactive', '#ff0000', '#00e676'],
          'circle-radius': ['coalesce', ['get', 'radius'], 0],
          'circle-opacity': ['coalesce', ['get', 'opacity'], 0],
          'circle-stroke-width': 0,
        },
      });
    }
  }

  private startRouteAnimation(): void {
    if (!this.map || this.prefersReducedMotion || !this.documentVisible) return;
    this.stopRouteAnimation();

    const tick = (timestamp: number): void => {
      if (!this.map) return;
      if (!this.documentVisible) {
        this.routeAnimationFrame = null;
        return;
      }
      const segmentSource = this.map.getSource(ROUTE_SEGMENT_SOURCE_ID) as GeoJSONSource | undefined;
      segmentSource?.setData(buildRouteSegmentCollection(this.routeMotionStates, timestamp));
      const pulseSource = this.map.getSource(ROUTE_PULSE_SOURCE_ID) as GeoJSONSource | undefined;
      pulseSource?.setData(buildRoutePulseCollection(this.routeMotionStates, timestamp));
      this.routeAnimationFrame = requestAnimationFrame(tick);
    };

    this.routeAnimationFrame = requestAnimationFrame(tick);
  }

  private markerSignature(markerSpec: MapMarkerSpec): string {
    return `${markerSpec.type}:${markerSpec.appearance}:${markerSpec.accent}:${markerSpec.selected ? '1' : '0'}:${markerSpec.lngLat[0]}:${markerSpec.lngLat[1]}`;
  }

  private createMarker(markerSpec: MapMarkerSpec): MarkerInstance | null {
    const maplibre = this.resolveMaplibreModule();
    if (!this.map || !maplibre) return null;
    const marker = new maplibre.Marker({
      anchor: 'center',
      element: this.makeMarkerElement(markerSpec),
    }).setLngLat(markerSpec.lngLat).addTo(this.map);

    marker.getElement().addEventListener('click', () => this.selectEntity.emit(markerSpec.entity));
    return { marker, signature: this.markerSignature(markerSpec) };
  }

  private makeMarkerElement(markerSpec: MapMarkerSpec): HTMLButtonElement {
    const host = document.createElement('button');
    host.type = 'button';
    host.className = 'fleet-map-marker';
    host.setAttribute('aria-label', this.markerAriaLabel(markerSpec));
    host.setAttribute('aria-pressed', markerSpec.selected ? 'true' : 'false');
    host.title = this.markerAriaLabel(markerSpec);

    const accentClass = markerSpec.accent === 'inactive'
      ? ' fleet-map-marker__visual--inactive'
      : markerSpec.accent === 'mixed'
        ? ' fleet-map-marker__visual--mixed'
        : '';
    const visual = document.createElement('span');
    visual.className = `fleet-map-marker__visual ${markerSpec.type === 'client' ? 'fleet-map-marker__visual--client' : 'fleet-map-marker__visual--origin'}${accentClass}${markerSpec.selected ? ' fleet-map-marker__visual--selected' : ''}`;

    const icon = document.createElement('span');
    icon.className = 'fleet-map-marker__icon';
    if (markerSpec.type === 'client') {
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    } else if (markerSpec.type === 'manufacturer') {
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/></svg>';
    } else if (markerSpec.type === 'project') {
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';
    } else {
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
    }

    visual.appendChild(icon);
    host.appendChild(visual);
    return host;
  }

  resetMapView(): void {
    if (!this.map) return;
    const scene = this.scene();
    if (scene.allBounds.length > 0) {
      fitMapToPoints(this.map, scene.allBounds, {
        padding: DEFAULT_PADDING,
        maxZoom: DATA_FIT_MAX_ZOOM,
        singlePointZoom: SINGLE_POINT_DATA_ZOOM,
      });
      return;
    }

    this.map.easeTo({
      center: clampLngLatToWorld(DEFAULT_CENTER),
      zoom: DEFAULT_ZOOM,
      bearing: 0,
      pitch: 0,
      duration: 450,
      essential: true,
    });
  }

  zoomIn(): void {
    this.map?.zoomIn();
  }

  zoomOut(): void {
    this.map?.zoomOut();
  }

  closeSelection(): void {
    this.selectEntity.emit(null);
  }

  selectionTitle(): string {
    return this.selectedEntity()?.data.name ?? '';
  }

  selectionBadge(): string {
    const selection = this.selectedEntity();
    if (!selection) return '';

    switch (selection.kind) {
      case 'project':
        return getProjectStatusDisplayLabel(selection.data.status);
      case 'client':
        return `${this.countMappedLocations(selection.data.locationIds)}/${selection.data.locationIds.length} mapped locations`;
      case 'manufacturer':
        return `${this.countMappedLocations(selection.data.locationIds)}/${selection.data.locationIds.length} mapped sites`;
      case 'location':
        return selection.data.type ?? 'Location';
    }
  }

  primaryLogoUrl(): string | undefined {
    const selection = this.selectedEntity();
    if (!selection) return undefined;
    if (selection.kind === 'client' || selection.kind === 'manufacturer') {
      return selection.data.logoUrl;
    }
    return undefined;
  }

  selectionIconClass(): string {
    const selection = this.selectedEntity();
    switch (selection?.kind) {
      case 'project':
        return 'bi bi-box-seam';
      case 'client':
        return 'bi bi-person';
      case 'manufacturer':
        return 'bi bi-building';
      case 'location':
        return 'bi bi-geo-alt';
      default:
        return 'bi bi-box';
    }
  }

  countMappedLocations(locationIds: string[]): number {
    const locationById = this.locationById();
    return locationIds.reduce((count, locationId) => {
      const location = locationById.get(locationId);
      return location && hasUsableCoordinates(location.lat, location.lng) ? count + 1 : count;
    }, 0);
  }

  coordinateLabel(lat?: number | null, lng?: number | null): string {
    if (!hasUsableCoordinates(lat, lng)) {
      return 'No valid coordinates';
    }

    const safeLat = lat as number;
    const safeLng = lng as number;
    return `${safeLat.toFixed(4)}, ${safeLng.toFixed(4)}`;
  }

  detailLogoVisible(key: string, src?: string): boolean {
    return !!src && !this.failedLogoKeys().has(`${key}:${src}`);
  }

  markDetailLogoFailed(key: string, src?: string): void {
    if (!src) return;
    const next = new Set(this.failedLogoKeys());
    next.add(`${key}:${src}`);
    this.failedLogoKeys.set(next);
  }

  private deferMapInitialization(container: HTMLDivElement): void {
    const activate = (): void => {
      this.mapIntersectionObserver?.disconnect();
      this.mapIntersectionObserver = null;
      this.scheduleMapInitialization(container);
    };

    if (!('IntersectionObserver' in window)) {
      activate();
      return;
    }

    this.mapIntersectionObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        activate();
      }
    }, { rootMargin: '200px' });

    this.mapIntersectionObserver.observe(container);
  }

  private scheduleMapInitialization(container: HTMLDivElement): void {
    if (this.map || this.mapActivated()) return;
    this.mapActivated.set(true);

    const start = (): void => {
      this.idleCallbackHandle = null;
      void this.initializeMap(container);
    };

    const browserWindow = window as BrowserWindow;
    if (this.surface() === 'page' && typeof browserWindow.requestIdleCallback === 'function') {
      this.idleCallbackHandle = browserWindow.requestIdleCallback(() => start(), { timeout: 700 });
      return;
    }

    setTimeout(start, 0);
  }

  private async initializeMap(container: HTMLDivElement): Promise<void> {
    if (this.map) return;

    this.maplibreModule ??= await import('maplibre-gl');
    const maplibre = this.resolveMaplibreModule();
    if (!maplibre) return;
    const mapOptions: MapLibreMapOptions = {
      container,
      style: createThemedMapStyle(this.baseStyle, this.isDark()) as StyleSpecification,
      center: clampLngLatToWorld(DEFAULT_CENTER),
      zoom: DEFAULT_ZOOM,
      minZoom: MIN_WORLD_ZOOM,
      maxBounds: WORLD_BOUNDS,
      renderWorldCopies: false,
      attributionControl: false,
    };

    const map = new maplibre.Map(mapOptions);
    this.map = map;
    map.setRenderWorldCopies(false);
    map.setMaxBounds(WORLD_BOUNDS);
    map.on('style.load', this.handleStyleLoad);
    map.on('move', this.handleMapMotion);
    map.on('zoom', this.handleMapMotion);
    map.on('resize', this.handleMapMotion);
    map.on('rotate', this.handleMapMotion);
    map.on('pitch', this.handleMapMotion);

    if (this.shouldReduceNetworkUsage()) {
      return;
    }

    try {
      const response = await fetch(BASE_MAP_STYLE_URL);
      if (!response.ok || !this.map) return;
      this.baseStyle = await response.json() as MapStyle;
      this.mapReady.set(false);
      this.map.setStyle(createThemedMapStyle(this.baseStyle, this.isDark()) as StyleSpecification);
    } catch {
      // Fallback style stays active when remote basemap is unavailable.
    }
  }

  private shouldReduceNetworkUsage(): boolean {
    const connection = (navigator as BrowserNavigator).connection;
    return !!connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g';
  }

  private resolveMaplibreModule(): Awaited<typeof import('maplibre-gl')> | null {
    if (!this.maplibreModule) return null;
    const runtimeModule = this.maplibreModule as MapLibreRuntimeModule;
    return runtimeModule.default ?? runtimeModule;
  }

  private markerAriaLabel(markerSpec: MapMarkerSpec): string {
    const entityName = markerSpec.entity.data.name || markerSpec.type;
    const stateLabel = markerSpec.type === 'project' && 'status' in markerSpec.entity.data
      ? `project, ${getProjectStatusDisplayLabel(markerSpec.entity.data.status).toLowerCase()}`
      : `${markerSpec.type} marker`;
    const selectedLabel = markerSpec.selected ? ', selected' : '';
    return `Open ${entityName}, ${stateLabel}${selectedLabel}`;
  }
}
