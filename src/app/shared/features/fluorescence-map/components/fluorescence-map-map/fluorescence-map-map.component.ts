import { Component, input, output, AfterViewInit, OnDestroy, inject, effect, signal, computed, ViewChild, ElementRef, isDevMode } from '@angular/core';
import { CommonModule } from '@angular/common';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import { Node as WarRoomNode, FleetSelection, TransitRoute, ProjectRoute } from '../../../../models/fluorescence-map.interface';
import { WarRoomService } from '../../../../services/fluorescence-map.service';
import { AppStateService } from '../../../../services/app-state.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { FluorescenceMapMapControlsComponent } from './controls/fluorescence-map-map-controls.component';
import { FluorescenceMapMapTooltipComponent, TooltipVm } from './tooltip/fluorescence-map-map-tooltip.component';
import { FluorescenceMapMathService } from './services/fluorescence-map-map-math.service';
import { WarRoomMapAssetsService } from './services/fluorescence-map-map-assets.service';
import {
  FluorescenceMapMapOverlayService,
  MapFactoryRef,
} from './services/fluorescence-map-map-overlay.service';
import { MarkerVm, MarkerNodeType } from './fluorescence-map-map.vm';
import { FluorescenceMapMapRoutesComponent, RouteVm } from './routes/fluorescence-map-map-routes.component';
import { FluorescenceMapMapMarkersComponent } from './markers/fluorescence-map-map-markers.component';
import { ToastrService } from 'ngx-toastr';
import { isValidCoordinates } from '../../../../utils/coordinate.utils';
import { environment } from '../../../../../../environments/environment';
import html2canvas from 'html2canvas';

type MapEnvironmentConfig = typeof environment & {
  mapStyles?: { light?: string; dark?: string };
  geocodeApiUrl?: string;
};

@Component({
  selector: 'app-fluorescence-map-map',
  imports: [
    CommonModule,
    FluorescenceMapMapControlsComponent,
    FluorescenceMapMapTooltipComponent,
    FluorescenceMapMapRoutesComponent,
    FluorescenceMapMapMarkersComponent,
  ],
  templateUrl: './fluorescence-map-map.component.html',
  styleUrls: ['./fluorescence-map-map.component.scss'],
})
export class FluorescenceMapMapComponent implements AfterViewInit, OnDestroy {
  private readonly envConfig = environment as MapEnvironmentConfig;
  // Inputs
  screenshotMode = input<boolean>(false);
  dashboardFullscreenMode = input<boolean>(false);
  dashboardFullscreen = input<boolean>(false);
  fullscreenContainerSelector = input<string | null>(null);
  nodes = input<WarRoomNode[]>([]);
  selectedEntity = input<FleetSelection | null>(null);
  transitRoutes = input<TransitRoute[]>([]);
  projectRoutes = input<ProjectRoute[]>([]);
  filterStatus = input<'all' | 'active' | 'inactive'>('all');

  // Outputs
  nodeSelected = output<WarRoomNode | undefined>();
  routeSelected = output<{ routeId: string; projectId?: string }>();
  zoomStable = output<number>();
  userInteracted = output<void>();
  dashboardFullscreenToggleRequested = output<void>();
  fullscreenChange = output<boolean>();
  zoomedToEntity = output<void>();
  previousViewRestored = output<void>();

  @ViewChild('mapContainer', { static: false }) mapContainerRef!: ElementRef<HTMLDivElement>;

  private mapInstance: MapLibreMap | null = null;
  private mapLoaded = false;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private pendingZoomEntityId: string | null = null;
  private readonly geocodedCoordinatesByNodeId = new Map<string, { latitude: number; longitude: number }>();
  private fullscreenHandler: (() => void) | null = null;
  private overlayUpdateRaf: number | null = null;
  private overlayEnsureCoords = false;
  private overlaySyncInFlight = false;
  private overlaySyncQueued = false;
  private initMapStartTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private selectionZoomTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private zoomStableTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private resizeTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private previousViewState: { center: [number, number]; zoom: number } | null = null;
  private initMapRetryCount = 0;
  private static readonly INIT_MAP_MAX_RETRIES = 10;

  private readonly defaultView = {
    center: [0, 0] as [number, number],
    zoom: 1.8,
    pitch: 45,
    bearing: 0,
  };

  /** Current map zoom level (0.5–14) for slider binding. */
  readonly currentZoomLevel = signal(1.8);

  private readonly LOD_LOGO_ONLY_THRESHOLD = 1.2;
  private readonly LOD_FULL_DETAIL_THRESHOLD = 2.5;
  /** Pin label shows when zoomFactor >= this. Lower = label appears earlier when zooming in; higher = only when more zoomed in. */
  private readonly LOD_PIN_LABEL_THRESHOLD = 1.8;

  /** Map style URLs by theme (from environment). */
  private readonly MAP_STYLE = this.envConfig.mapStyles;
  private readonly DEFAULT_MAP_STYLE = {
    light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  } as const;

  // ----- Marker size tuning (adjust these to change how big markers are) -----
  /** Overall marker size. Bigger number = bigger markers (e.g. 1.25). Smaller = smaller (e.g. 0.75). */
  private readonly MARKER_BASE_SCALE = 0.56;
  /** How much marker size reacts to zoom. 0 = same size at all zoom; 0.1 = mild; 0.2 = strong. */
  private readonly MARKER_ZOOM_SENSITIVITY = 0.1;
  /** Zoom divisor. Bigger (e.g. 5) = markers grow less when zooming out; smaller (e.g. 3) = grow more. */
  private readonly MARKER_ZOOM_DIVISOR = 5;
  /** Extra scale for HQ node markers (e.g. 1.25 = 25% bigger). */
  private readonly MARKER_HQ_FACTOR = 1.25;
  private readonly DEFAULT_MARKER_ANCHOR: MarkerVm['anchor'] = { width: 120, height: 180, centerX: 60, centerY: 90 };
  private readonly CLUSTER_MARKER_ANCHOR: MarkerVm['anchor'] = { width: 48, height: 48, centerX: 24, centerY: 24 };
  /** Pixel offset between parallel project routes sharing same client-factory pair */
  private readonly PARALLEL_ROUTE_OFFSET_PIXELS = 8;
  // --------------------------------------------------------------------------

  // Caches
  private geocodeCache = new Map<string, { latitude: number; longitude: number }>();
  private geocodeInFlight = new Map<string, Promise<{ latitude: number; longitude: number }>>();
  private logoFailureCache = new Map<string, Set<string>>();

  // Signals
  readonly fullscreenState = signal<boolean>(false);
  readonly effectiveFullscreen = computed(() =>
    this.dashboardFullscreenMode() ? this.dashboardFullscreen() : this.fullscreenState()
  );
  private readonly hoveredNode = signal<WarRoomNode | null>(null);
  private readonly pinnedNodeId = signal<string | null>(null);
  readonly containerRect = signal<DOMRect | null>(null);
  readonly markerPixelCoordinates = signal<Map<string, { x: number; y: number }>>(new Map());
  private readonly logoFailureVersion = signal(0);
  readonly markersVm = signal<MarkerVm[]>([]);
  readonly routesVm = signal<RouteVm[]>([]);
  readonly routeStroke = computed(() => this.getRouteColor());
  readonly routeFill = computed(() => this.getRouteColor());
  readonly mapLoadError = signal<string | null>(null);
  readonly mapLoadErrorDetail = signal<string | null>(null);
  readonly mapLoading = signal<boolean>(true);
  readonly mapRuntimeWarning = signal<string | null>(null);
  /** When true, user dismissed the error overlay; non-map UI remains usable. */
  readonly mapErrorDismissed = signal<boolean>(false);
  /** When true, retry will not help (e.g. WebGL unsupported); Retry is disabled. */
  readonly mapErrorUnrecoverable = signal<boolean>(false);
  private mapErrorToastShown = false;
  private mapWarningToastShown = false;

  // Services
  private warRoomService = inject(WarRoomService);
  private appStateService = inject(AppStateService);
  private mathService = inject(FluorescenceMapMathService);
  private assetsService = inject(WarRoomMapAssetsService);
  private overlayService = inject(FluorescenceMapMapOverlayService);
  private toastr = inject(ToastrService);

  currentTheme = signal<'light' | 'dark'>('dark');
  readonly isDev = isDevMode();

  private appState = toSignal(this.appStateService.state$, {
    initialValue: {
      theme: 'light',
      direction: 'ltr',
      navigationStyles: 'vertical',
      menuStyles: '',
      layoutStyles: 'default',
      pageStyles: 'regular',
      widthStyles: 'fullwidth',
      menuPosition: 'fixed',
      headerPosition: 'fixed',
      menuColor: 'dark',
      headerColor: 'light',
      themePrimary: '',
      themeBackground: '',
      backgroundImage: ''
    }
  });

  constructor() {
    effect(() => {
      const theme = this.appState().theme === 'light' ? 'light' : 'dark';
      this.currentTheme.set(theme);
    });

    effect(() => {
      const inDashboardMode = this.dashboardFullscreenMode();
      const dashboardIsFullscreen = this.dashboardFullscreen();
      if (!inDashboardMode) return;
      this.setFullscreenState(dashboardIsFullscreen, true);
    });

    effect(() => {
      const selected = this.selectedEntity();
      const container = document.querySelector('.war-room-map-container') as HTMLElement | null;
      if (container) {
        // Parent-level default selection should not mute all route lines.
        const shouldMuteNonHighlightedRoutes = !!selected?.id && selected.level !== 'parent';
        if (shouldMuteNonHighlightedRoutes) {
          container.setAttribute('data-has-selection', 'true');
        } else {
          container.removeAttribute('data-has-selection');
        }
      }
    });

    effect(() => {
      const nodes = this.nodes();
      void nodes;
      if (this.mapInstance && this.mapLoaded && !this.destroyed) {
        this.scheduleOverlayUpdate(true);
      }
    });

    effect(() => {
      const selected = this.selectedEntity();
      const hovered = this.warRoomService.hoveredEntity();
      const projectRoutes = this.projectRoutes();
      const status = this.filterStatus();
      void selected;
      void hovered;
      void projectRoutes;
      void status;
      if (this.mapInstance && this.mapLoaded && !this.destroyed) {
        this.scheduleOverlayUpdate(false);
      }
    });

    effect(() => {
      const theme = this.currentTheme();
      void theme;
      if (this.mapInstance && this.mapLoaded && !this.destroyed) {
        const styleUrl = this.getMapStyleUrl(this.currentTheme());
        this.mapInstance.setStyle(styleUrl);
        const onStyleLoad = () => {
          this.mapInstance?.off('style.load', onStyleLoad);
          if (!this.destroyed) this.scheduleOverlayUpdate(false);
        };
        this.mapInstance.once('style.load', onStyleLoad);
      }
    });

    effect(() => {
      const hovered = this.warRoomService.hoveredEntity();
      if (!hovered) {
        this.hoveredNode.set(null);
        return;
      }
      const match = this.nodes().find((node) =>
        node.companyId === hovered.id || node.id === hovered.id
      );
      this.hoveredNode.set(match ?? null);
    });

    effect(() => {
      const panRequest = this.warRoomService.panToEntity();
      if (panRequest && this.mapInstance && this.mapLoaded && !this.destroyed) {
        this.zoomToEntity(panRequest.id, 8);
      }
    });

    effect((onCleanup) => {
      const selected = this.selectedEntity();
      if (selected && this.mapInstance && this.mapLoaded && !this.destroyed) {
        if (this.selectionZoomTimeoutId) {
          clearTimeout(this.selectionZoomTimeoutId);
        }
        this.selectionZoomTimeoutId = setTimeout(() => {
          if (!this.destroyed) {
            this.zoomToEntity(selected.id, 8);
          }
          this.selectionZoomTimeoutId = null;
        }, 200);
      }
      onCleanup(() => {
        if (this.selectionZoomTimeoutId) {
          clearTimeout(this.selectionZoomTimeoutId);
          this.selectionZoomTimeoutId = null;
        }
      });
    });

    effect(() => {
      const selected = this.selectedEntity();
      if (!selected && this.mapInstance && this.mapLoaded && !this.destroyed) {
        this.applyDefaultView();
      }
    });
  }

  ngAfterViewInit(): void {
    this.initMapStartTimeoutId = setTimeout(() => {
      this.initMapStartTimeoutId = null;
      this.initMap();
    }, 0);
    this.setupResizeObserver();
    this.setupFullscreenListeners();
  }

  retryMapLoad(): void {
    if (this.mapErrorUnrecoverable()) return;
    this.disposeMapInstance();
    this.mapErrorToastShown = false;
    this.mapWarningToastShown = false;
    this.mapLoadError.set(null);
    this.mapLoadErrorDetail.set(null);
    this.mapRuntimeWarning.set(null);
    this.mapErrorDismissed.set(false);
    this.mapErrorUnrecoverable.set(false);
    this.mapLoading.set(true);
    this.initMapRetryCount = 0;
    this.initMap();
  }

  dismissMapError(): void {
    this.mapErrorDismissed.set(true);
  }

  dismissMapRuntimeWarning(): void {
    this.mapRuntimeWarning.set(null);
  }

  ngOnDestroy(): void {
    this.destroyed = true;

    if (this.initMapStartTimeoutId) {
      clearTimeout(this.initMapStartTimeoutId);
      this.initMapStartTimeoutId = null;
    }

    if (this.selectionZoomTimeoutId) {
      clearTimeout(this.selectionZoomTimeoutId);
      this.selectionZoomTimeoutId = null;
    }
    if (this.zoomStableTimeoutId) {
      clearTimeout(this.zoomStableTimeoutId);
      this.zoomStableTimeoutId = null;
    }
    if (this.resizeTimeoutId) {
      clearTimeout(this.resizeTimeoutId);
      this.resizeTimeoutId = null;
    }

    if (this.fullscreenHandler) {
      document.removeEventListener('fullscreenchange', this.fullscreenHandler);
      this.fullscreenHandler = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.overlayUpdateRaf !== null) {
      cancelAnimationFrame(this.overlayUpdateRaf);
      this.overlayUpdateRaf = null;
    }

    this.disposeMapInstance();
  }

  private getCompanyLogoSource(node: WarRoomNode): string | null {
    const customLogo = typeof node.logo === 'string' ? node.logo.trim() : '';
    if (customLogo) {
      return customLogo;
    }
    return null;
  }

  private getCompanyDescription(node: WarRoomNode): string {
    return this.assetsService.getCompanyDescription(node);
  }

  private getCompanyDisplayName(node: WarRoomNode): string {
    return this.assetsService.getCompanyDisplayName(node);
  }

  /** Returns user-friendly status text for marker subLabel and descriptions */
  private getStatusDisplayText(status?: string | null): string {
    if (!status) return 'Inactive';
    const s = String(status).toUpperCase().trim();
    if (s === 'ACTIVE' || s === 'ONLINE') return 'Active';
    if (s === 'INACTIVE' || s === 'OFFLINE') return 'Inactive';
    return status;
  }

  getTypeLabel(node: WarRoomNode): string {
    return this.assetsService.getTypeLabel(node);
  }

  private async ensureNodeCoordinates(nodes: WarRoomNode[]): Promise<void> {
    const candidates = nodes
      .map((node) => ({ node, label: this.getLocationLabel(node) }))
      .filter((item) => !!item.label);
    if (candidates.length === 0) return;

    await Promise.all(
      candidates.map(async ({ node, label }) => {
        if (isValidCoordinates(this.getNodeCoordinates(node))) {
          return;
        }
        try {
          const coords = await this.geocodeLocation(label);
          if (isValidCoordinates(coords)) {
            this.geocodedCoordinatesByNodeId.set(String(node.id), {
              latitude: coords.latitude,
              longitude: coords.longitude,
            });
          }
        } catch {
          // Ignore geocode failures
        }
      })
    );
  }

  private getLocationLabel(node: WarRoomNode): string {
    const city = (node.city || '').trim();
    const country = (node.country || '').trim();
    if (city && country) return `${city}, ${country}`;
    return city || country || '';
  }

  private getNodeCoordinates(node: WarRoomNode): { latitude: number; longitude: number } | null {
    return this.geocodedCoordinatesByNodeId.get(String(node.id)) ?? node.coordinates;
  }

  private async geocodeLocation(location: string): Promise<{ latitude: number; longitude: number }> {
    const cached = this.geocodeCache.get(location);
    if (cached) return cached;

    const inflight = this.geocodeInFlight.get(location);
    if (inflight) return inflight;

    const request = (async () => {
      const geocodeUrl =
        `${this.envConfig.geocodeApiUrl ?? 'https://geocoding-api.open-meteo.com/v1/search'}?name=${encodeURIComponent(location)}` +
        `&count=1&language=en&format=json`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(geocodeUrl, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Geocoding request failed with status ${response.status}`);
        }
        const data = (await response.json()) as { results?: Array<{ latitude: number; longitude: number }> };
        const result = data.results?.[0];
        if (!result) {
          throw new Error('No geocoding results found for location.');
        }
        const coords = { latitude: result.latitude, longitude: result.longitude };
        this.geocodeCache.set(location, coords);
        return coords;
      } finally {
        clearTimeout(timeoutId);
      }
    })();

    this.geocodeInFlight.set(location, request);
    try {
      return await request;
    } finally {
      this.geocodeInFlight.delete(location);
    }
  }

  private getTooltipBounds(): { left: number; right: number; top: number; bottom: number } {
    const padding = 12;
    const viewportBounds = {
      left: padding,
      top: padding,
      right: window.innerWidth - padding,
      bottom: window.innerHeight - padding
    };

    const containerRect = this.containerRect();
    if (!containerRect) {
      return viewportBounds;
    }

    const bounds = {
      left: Math.max(viewportBounds.left, containerRect.left + padding),
      top: Math.max(viewportBounds.top, containerRect.top + padding),
      right: Math.min(viewportBounds.right, containerRect.right - padding),
      bottom: Math.min(viewportBounds.bottom, containerRect.bottom - padding)
    };

    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
      return viewportBounds;
    }

    return bounds;
  }

  onMarkerHovered(node: WarRoomNode | null): void {
    this.hoveredNode.set(node);
    if (node) {
      const selection: FleetSelection = {
        level: node.level ?? 'factory',
        id: node.companyId,
        parentGroupId: node.parentGroupId,
        subsidiaryId: node.subsidiaryId,
        factoryId: node.factoryId,
      };
      this.warRoomService.setHoveredEntity(selection);
    } else {
      this.warRoomService.setHoveredEntity(null);
    }
  }

  clearPinned(): void {
    this.pinnedNodeId.set(null);
  }

  onRouteSelected(payload: { routeId: string; projectId?: string }): void {
    this.routeSelected.emit(payload);
  }

  onMarkerLogoError(event: { node: WarRoomNode; logoPath: string }): void {
    const logoSource = this.getCompanyLogoSource(event.node);
    if (!logoSource || !event.logoPath) return;
    this.recordLogoFailure(logoSource, event.logoPath);
  }

  onTooltipLogoError(event: { nodeId: string; logoPath: string }): void {
    const node = this.nodes().find((n) => n.id === event.nodeId);
    if (!node) return;
    const logoSource = this.getCompanyLogoSource(node);
    if (!logoSource || !event.logoPath) return;
    this.recordLogoFailure(logoSource, event.logoPath);
  }

  private recordLogoFailure(logoSource: string, logoPath: string): void {
    const failures = this.logoFailureCache.get(logoSource) ?? new Set<string>();
    failures.add(logoPath);
    this.logoFailureCache.set(logoSource, failures);
    this.logoFailureVersion.update((value) => value + 1);
  }

  private scheduleOverlayUpdate(ensureCoords: boolean): void {
    if (ensureCoords) {
      this.overlayEnsureCoords = true;
    }
    if (this.overlayUpdateRaf !== null) return;

    this.overlayUpdateRaf = requestAnimationFrame(() => {
      this.overlayUpdateRaf = null;
      if (this.overlaySyncInFlight) {
        this.overlaySyncQueued = true;
        return;
      }
      this.runOverlaySync();
    });
  }

  private runOverlaySync(): void {
    if (this.overlaySyncInFlight || this.destroyed) return;
    const shouldEnsure = this.overlayEnsureCoords;
    this.overlayEnsureCoords = false;
    this.overlaySyncInFlight = true;
    void this.syncOverlays(shouldEnsure)
      .catch((err) => {
        console.warn('Map overlay sync failed:', err);
      })
      .finally(() => {
        this.overlaySyncInFlight = false;
        if (this.destroyed) return;
        if (this.overlaySyncQueued || this.overlayEnsureCoords) {
          this.overlaySyncQueued = false;
          this.scheduleOverlayUpdate(false);
        }
      });
  }

  private getMapContainer(): HTMLElement | null {
    return this.mapContainerRef?.nativeElement ?? document.getElementById('war-room-map');
  }

  private disposeMapInstance(): void {
    if (!this.mapInstance) return;
    this.mapInstance.remove();
    this.mapInstance = null;
    this.mapLoaded = false;
  }

  /**
   * Preflight check: WebGL must be available for MapLibre. Returns false when
   * WebGL is disabled (e.g. GL_VENDOR disabled) or unsupported.
   */
  private isWebglSupported(): boolean {
    if (typeof window === 'undefined' || !window.WebGLRenderingContext) return false;
    const canvas = document.createElement('canvas');
    try {
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      return !!(gl && typeof (gl as WebGLRenderingContext).getParameter === 'function');
    } catch {
      return false;
    }
  }

  private setMapError(msg: string, detail: string | null, unrecoverable: boolean, showToast: boolean): void {
    this.mapLoadError.set(msg);
    this.mapLoadErrorDetail.set(detail);
    this.mapLoading.set(false);
    this.mapRuntimeWarning.set(null);
    this.mapErrorUnrecoverable.set(unrecoverable);
    if (this.isDev && detail) {
      console.error('Map fatal error detail:', detail);
    }
    if (showToast && !this.mapErrorToastShown) {
      this.mapErrorToastShown = true;
      this.toastr.error(msg, 'Map failed to load');
    }
  }

  private setRecoverableMapWarning(msg: string): void {
    this.mapRuntimeWarning.set(msg);
    this.mapLoading.set(false);
    this.mapErrorUnrecoverable.set(false);
    this.mapErrorDismissed.set(false);
    if (!this.mapWarningToastShown) {
      this.mapWarningToastShown = true;
      this.toastr.warning(msg, 'Map warning');
    }
  }

  private getFactoriesSafe(): MapFactoryRef[] {
    const factoriesSource =
      (this.warRoomService as unknown as {
        factories?: () => MapFactoryRef[];
      }).factories;
    if (typeof factoriesSource !== 'function') {
      return [];
    }
    return factoriesSource.call(this.warRoomService) ?? [];
  }

  /** Detect errors that indicate WebGL is disabled or unsupported; retry will not help. */
  private isUnrecoverableMapError(msg: string, detail: string): boolean {
    const combined = `${msg} ${detail}`.toLowerCase();
    return (
      combined.includes('gl_vendor') ||
      (combined.includes('webgl') && combined.includes('disabled')) ||
      (combined.includes('context') && combined.includes('lost')) ||
      combined.includes('not supported') ||
      combined.includes('could not create webgl')
    );
  }

  private initMap(): void {
    if (this.destroyed) return;
    const container = this.getMapContainer();
    if (!container) {
      this.setMapError(
        'Map container not found',
        'Map container element was not found in the DOM.',
        true,
        true
      );
      return;
    }

    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      if (this.initMapRetryCount >= FluorescenceMapMapComponent.INIT_MAP_MAX_RETRIES) {
        this.setMapError(
          'Map container has no dimensions. Please refresh the page.',
          `Container rect: ${rect.width}x${rect.height}`,
          false,
          true
        );
        this.initMapRetryCount = 0;
        return;
      }
      this.initMapRetryCount++;
      requestAnimationFrame(() => {
        setTimeout(() => this.initMap(), 50);
      });
      return;
    }
    this.initMapRetryCount = 0;

    if (!this.isWebglSupported()) {
      this.setMapError(
        'WebGL is not available. The map requires hardware-accelerated graphics.',
        'Try enabling hardware acceleration in your browser settings, or use a different browser.',
        true,
        true
      );
      return;
    }

    try {
      this.mapLoading.set(true);
      this.mapInstance = this.createMap(container);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Map initialization failed';
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      const unrecoverable = this.isUnrecoverableMapError(msg, detail);
      this.setMapError(msg, detail, unrecoverable, true);
      return;
    }

    this.mapInstance.on('error', (e) => {
      const msg = (e.error as Error)?.message ?? 'Map failed to load';
      const errorObj = e.error as Error | undefined;
      const detail = errorObj?.stack ?? errorObj?.message ?? null;
      const unrecoverable = this.isUnrecoverableMapError(msg, String(detail ?? ''));
      const isRecoverableRuntime = this.mapLoaded && !unrecoverable;
      if (isRecoverableRuntime) {
        this.setRecoverableMapWarning(msg);
        return;
      }
      this.setMapError(msg, detail, unrecoverable, true);
    });

    this.mapInstance.on('load', () => {
      if (this.destroyed) return;
      this.mapLoading.set(false);
      this.mapLoadError.set(null);
      this.mapLoadErrorDetail.set(null);
      this.mapRuntimeWarning.set(null);
      this.mapErrorDismissed.set(false);
      this.mapErrorUnrecoverable.set(false);
      this.mapErrorToastShown = false;
      this.mapWarningToastShown = false;
      this.mapLoaded = true;
      this.updateContainerRect();
      this.scheduleOverlayUpdate(true);

      const pending = this.pendingZoomEntityId;
      this.pendingZoomEntityId = null;
      if (pending) {
        this.zoomToEntity(pending, 8);
      }
    });

    this.mapInstance.on('move', () => {
      if (!this.mapLoaded) return;
      this.scheduleOverlayUpdate(false);
    });

    this.mapInstance.on('movestart', (event: { originalEvent?: Event }) => {
      if (!event?.originalEvent) return;
      this.userInteracted.emit();
    });

    this.mapInstance.on('zoom', () => {
      if (!this.mapLoaded) return;
      this.currentZoomLevel.set(this.mapInstance!.getZoom());
      this.scheduleOverlayUpdate(false);
      this.scheduleZoomStableEmit();
    });

    this.mapInstance.on('moveend', () => {
      if (!this.mapLoaded) return;
      this.scheduleOverlayUpdate(false);
    });

    this.mapInstance.on('idle', () => {
      if (!this.mapLoaded) return;
      this.scheduleOverlayUpdate(false);
    });
  }

  private getMapStyleUrl(theme: 'light' | 'dark'): string {
    return this.MAP_STYLE?.[theme]
      ?? this.MAP_STYLE?.dark
      ?? this.DEFAULT_MAP_STYLE[theme]
      ?? this.DEFAULT_MAP_STYLE.dark;
  }

  private createMap(container: HTMLElement): MapLibreMap {
    const map = new maplibregl.Map({
      container,
      style: this.getMapStyleUrl(this.currentTheme()),
      center: this.defaultView.center,
      zoom: this.defaultView.zoom,
      pitch: this.defaultView.pitch,
      bearing: this.defaultView.bearing,
      minZoom: 0.5,
      maxZoom: 14,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    this.currentZoomLevel.set(this.defaultView.zoom);
    return map;
  }

  private scheduleZoomStableEmit(): void {
    if (this.zoomStableTimeoutId) {
      clearTimeout(this.zoomStableTimeoutId);
    }
    this.zoomStableTimeoutId = setTimeout(() => {
      if (!this.mapInstance || this.destroyed) return;
      this.zoomStable.emit(this.mapInstance.getZoom());
      this.zoomStableTimeoutId = null;
    }, 2000);
  }

  private setupResizeObserver(): void {
    const container = this.getMapContainer();
    if (!container) return;

    this.resizeObserver = new ResizeObserver(() => {
      if (this.destroyed || !this.mapInstance) return;
      // Resize map first, then update overlays
      this.mapInstance.resize();
      if (this.resizeTimeoutId) {
        clearTimeout(this.resizeTimeoutId);
      }
      // Use a small debounce to avoid overlay churn while resizing continuously.
      this.resizeTimeoutId = setTimeout(() => {
        if (!this.destroyed) {
          this.updateContainerRect();
          this.scheduleOverlayUpdate(false);
        }
        this.resizeTimeoutId = null;
      }, 50);
    });

    this.resizeObserver.observe(container);
  }

  private setupFullscreenListeners(): void {
    const handler = () => {
      const fullscreenEl = document.fullscreenElement;
      const container = this.getFullscreenContainer();
      const active = !!fullscreenEl && !!container && fullscreenEl === container;
      this.setFullscreenState(active, true);
    };
    this.fullscreenHandler = handler;
    document.addEventListener('fullscreenchange', handler);
  }

  private setFullscreenState(active: boolean, emit = false): void {
    this.fullscreenState.set(active);
    if (emit) {
      this.fullscreenChange.emit(active);
    }
    if (this.mapInstance) {
      setTimeout(() => this.mapInstance?.resize(), 50);
    }
  }

  private getFullscreenContainer(): HTMLElement | null {
    const selector = this.fullscreenContainerSelector()?.trim();
    if (selector) {
      const selected = document.querySelector(selector);
      if (selected instanceof HTMLElement) {
        return selected;
      }
    }

    const localContainer =
      this.mapContainerRef?.nativeElement?.closest('.war-room-map-container') ?? null;
    if (localContainer instanceof HTMLElement) {
      return localContainer;
    }

    const fallback = document.querySelector('.war-room-map-container');
    return fallback instanceof HTMLElement ? fallback : null;
  }

  private updateContainerRect(): void {
    if (!this.mapInstance) return;
    const container = this.mapInstance.getContainer();
    if (container) {
      this.containerRect.set(container.getBoundingClientRect());
    }
  }

  private async syncOverlays(ensureCoords = false): Promise<void> {
    if (!this.mapInstance || !this.mapLoaded || this.destroyed) return;
    // Defensive check for initialization state (rare but possible in some test/mock scenarios)
    if (!this.routesVm || !this.markersVm) return;

    const nodes = this.nodes();
    if (ensureCoords) {
      await this.ensureNodeCoordinates(nodes);
    }

    const overlays = this.overlayService.buildOverlayModels({
      nodes,
      selected: this.selectedEntity(),
      hovered: this.warRoomService.hoveredEntity(),
      projectRoutes: this.projectRoutes(),
      transitRoutes: [],
      filterStatus: this.filterStatus(),
      routeColor: this.getRouteColor(),
      map: this.mapInstance,
      factories: this.getFactoriesSafe(),
      parallelRouteOffsetPixels: this.PARALLEL_ROUTE_OFFSET_PIXELS,
      getNodeCoordinates: (node) => this.getNodeCoordinates(node),
      buildMarkerVm: (
        node,
        zoom,
        selected,
        hovered,
        displayCoordinates,
        projectStatusColor
      ) =>
        this.buildMarkerVm(
          node,
          zoom,
          selected,
          hovered,
          displayCoordinates,
          projectStatusColor
        ),
    });

    this.markerPixelCoordinates.set(overlays.markerPixels);
    this.markersVm.set(overlays.markers);
    this.routesVm.set(overlays.routes);
  }

  private buildMarkerVm(
    node: WarRoomNode,
    zoom: number,
    selected: FleetSelection | null,
    hovered: FleetSelection | null,
    displayCoordinates: { longitude: number; latitude: number } | undefined,
    projectStatusColor: string
  ): MarkerVm {
    let displayName = this.getCompanyDisplayName(node).toUpperCase();
    if (displayName.includes('NOVA')) displayName = 'NOVA BUS';
    if (displayName.includes('KARZAN') || displayName.includes('KARSAN')) displayName = 'KARSAN';
    const shortName = displayName.length > 18 ? `${displayName.slice(0, 15)}...` : displayName;
    const statusDisplayText = this.getStatusDisplayText(node.status);
    const rawSubLabel = `${node.city || 'Station'} / ${statusDisplayText}`;
    const subLabel = rawSubLabel.length > 28 ? `${rawSubLabel.slice(0, 25)}...` : rawSubLabel;
    const cleanedName = displayName.replace(/[^A-Z0-9 ]/g, ' ');
    const initialsParts = cleanedName.split(' ').filter(Boolean);
    let initials = initialsParts.slice(0, 2).map((part) => part[0]).join('');
    if (!initials) {
      initials = displayName.slice(0, 2);
    }

    const logoSource = this.getCompanyLogoSource(node);
    const failures = logoSource ? this.logoFailureCache.get(logoSource) : undefined;
    const baseUrl = window.location.origin;
    const logoPath = logoSource
      ? this.assetsService.getPreferredLogoPath(logoSource, baseUrl, failures)
      : '';
    const fallbackLogoPath = this.assetsService.getLogoFallbackPath();
    const hasLogo = !!logoPath && logoPath !== fallbackLogoPath;

    const nodeLevel = node.level ?? 'factory';
    const isHQ = node.id === 'fleetzero' || node.name?.toLowerCase().includes('fleetzero');
    const isSelected = !!selected && node.companyId === selected.id && selected.level === nodeLevel;
    const isHovered = !!hovered && (
      node.companyId === hovered.id ||
      node.id === hovered.id ||
      (hovered.level === 'subsidiary' && node.subsidiaryId === hovered.id)
    );
    const isPinned = this.pinnedNodeId() === node.id;

    const zoomFactor = this.getZoomFactor(zoom);
    const lod = this.getPinLodState(zoomFactor, isSelected);

    const adaptiveFactor = 1 + (zoomFactor - 1) * this.MARKER_ZOOM_SENSITIVITY;
    const hqFactor = isHQ ? this.MARKER_HQ_FACTOR : 1.0;
    const invZoom = 1 / zoomFactor;
    const scaleRaw = (adaptiveFactor * hqFactor) * invZoom * this.MARKER_BASE_SCALE;
    const scale = Number.isFinite(scaleRaw) ? Number(scaleRaw.toFixed(4)) : 1;
    const isCluster = false;
    const anchor = isCluster ? this.CLUSTER_MARKER_ANCHOR : this.DEFAULT_MARKER_ANCHOR;
    // Derive status from project (projectStatusColor): active #00C853, inactive #D50000, default #0ea5e9
    const statusColor = projectStatusColor;
    const statusGlow = this.getProjectStatusGlow(projectStatusColor);
    const isInactive = projectStatusColor === '#D50000';
    const statusKey: 'online' | 'offline' = isInactive ? 'offline' : 'online';
    const statusIconPath = isInactive ? 'M 6,6 L 18,18 M 18,6 L 6,18' : 'M 5,13 L 10,18 L 19,7';


    const nodeType: MarkerNodeType =
      node.level === 'client' || node.clientId
        ? 'client'
        : (node.level ?? 'factory') as MarkerNodeType;
    const renderKey = `${node.level ?? nodeType}:${node.id}`;

    return {
      id: node.id,
      renderKey,
      node,
      nodeType,
      isCluster,
      displayName,
      shortName,
      subLabel,
      initials,
      hasLogo,
      logoPath,
      isSelected,
      isHovered,
      isHub: this.isHub(node),
      isHQ,
      statusKey,
      statusColor,
      statusGlow,
      projectStatusColor,
      statusIconPath,
      lodClass: lod.lodClass,
      isPinned,
      anchor,
      pinScale: scale,
      // During screenshot capture, force labels on even when fit-bounds zoom is low.
      showPinLabel: this.screenshotMode() || zoomFactor >= this.LOD_PIN_LABEL_THRESHOLD,
      displayCoordinates,
    };
  }

  private getZoomFactor(zoom: number): number {
    return Math.max(0.5, zoom / this.MARKER_ZOOM_DIVISOR);
  }

  private getPinLodState(
    zoomFactor: number,
    isSelected: boolean
  ): { isLogoOnly: boolean; isCompactLogo: boolean; isFullDetail: boolean; lodClass: 'lod-low' | 'lod-medium' | 'lod-high' } {
    if (isSelected) {
      return { isLogoOnly: false, isCompactLogo: false, isFullDetail: true, lodClass: 'lod-high' };
    }

    if (zoomFactor < this.LOD_LOGO_ONLY_THRESHOLD) {
      return { isLogoOnly: true, isCompactLogo: false, isFullDetail: false, lodClass: 'lod-low' };
    }

    if (zoomFactor < this.LOD_FULL_DETAIL_THRESHOLD) {
      return { isLogoOnly: false, isCompactLogo: true, isFullDetail: false, lodClass: 'lod-medium' };
    }

    return { isLogoOnly: false, isCompactLogo: false, isFullDetail: true, lodClass: 'lod-high' };
  }

  handleMarkerClick(node?: WarRoomNode): void {
    if (!node) {
      this.nodeSelected.emit(undefined);
      return;
    }
    const selected = this.selectedEntity();
    const nodeLevel = node.level ?? 'factory';
    if (selected && node.companyId === selected.id && selected.level === nodeLevel) {
      this.nodeSelected.emit(undefined);
    } else {
      this.nodeSelected.emit(node);
    }

    const currentPinned = this.pinnedNodeId();
    if (currentPinned === node.id) {
      this.pinnedNodeId.set(null);
    } else {
      this.pinnedNodeId.set(node.id);
    }
  }

  getNodePosition(node: WarRoomNode): { top: number; left: number } {
    const cached = this.markerPixelCoordinates().get(node.id);
    if (cached) {
      return { top: cached.y, left: cached.x };
    }

    const coordinates = this.getNodeCoordinates(node);
    if (this.mapInstance && isValidCoordinates(coordinates)) {
      const safeCoordinates = coordinates as { latitude: number; longitude: number };
      const point = this.mapInstance.project([safeCoordinates.longitude, safeCoordinates.latitude]);
      return { top: point.y, left: point.x };
    }

    return { top: 0, left: 0 };
  }

  private applyDefaultView(): void {
    if (!this.mapInstance) return;
    this.mapInstance.easeTo({
      center: this.defaultView.center,
      zoom: this.defaultView.zoom,
      pitch: this.defaultView.pitch,
      bearing: this.defaultView.bearing,
      duration: 800,
    });
  }

  toggleFullscreen(): void {
    if (this.dashboardFullscreenMode()) {
      this.dashboardFullscreenToggleRequested.emit();
      return;
    }

    const container = this.getFullscreenContainer();
    if (!container) return;

    const fullscreenEl = document.fullscreenElement;

    if (!fullscreenEl) {
      if (container.requestFullscreen) {
        void container.requestFullscreen();
      }
    } else {
      if (fullscreenEl === container && document.exitFullscreen) {
        void document.exitFullscreen();
      }
    }
  }

  zoomIn(): void {
    if (this.mapInstance) {
      const next = Math.min(14, this.mapInstance.getZoom() + 1);
      this.currentZoomLevel.set(next);
      this.mapInstance.zoomIn();
    }
  }

  zoomOut(): void {
    if (this.mapInstance) {
      const next = Math.max(0.5, this.mapInstance.getZoom() - 1);
      this.currentZoomLevel.set(next);
      this.mapInstance.zoomOut();
    }
  }

  /** Set map zoom to a specific level (e.g. from slider). */
  setZoomTo(level: number): void {
    if (this.mapInstance) {
      const clamped = Math.max(0.5, Math.min(14, level));
      this.currentZoomLevel.set(clamped);
      this.mapInstance.zoomTo(clamped);
    }
  }

  public zoomToEntity(entityId: string, zoom: number = 8): void {
    const nodes = this.nodes();
    const target = nodes.find((node) =>
      node.companyId === entityId ||
      node.id === entityId ||
      node.factoryId === entityId ||
      node.subsidiaryId === entityId ||
      node.parentGroupId === entityId
    );

    const targetCoordinates = target ? this.getNodeCoordinates(target) : null;
    if (!target || !isValidCoordinates(targetCoordinates)) {
      if (!this.mapInstance || !this.mapLoaded) {
        this.pendingZoomEntityId = entityId;
      }
      return;
    }
    const safeTargetCoordinates = targetCoordinates as { latitude: number; longitude: number };

    if (!this.mapInstance || !this.mapLoaded) {
      this.pendingZoomEntityId = entityId;
      return;
    }

    const map = this.mapInstance;
    const center = map.getCenter();
    const currentZoom = map.getZoom();
    this.previousViewState = {
      center: [center.lng, center.lat],
      zoom: currentZoom,
    };

    map.flyTo({
      center: [safeTargetCoordinates.longitude, safeTargetCoordinates.latitude],
      zoom,
      duration: 1000,
      essential: true,
    });

    this.zoomedToEntity.emit();
  }

  restorePreviousView(): void {
    if (!this.previousViewState || !this.mapInstance || !this.mapLoaded) return;
    const { center, zoom } = this.previousViewState;
    this.previousViewState = null;
    this.mapInstance.flyTo({ center, zoom, duration: 600, essential: true });
    this.previousViewRestored.emit();
  }

  hasPreviousView(): boolean {
    return this.previousViewState !== null;
  }

  fitBoundsToRoutes(routes: ProjectRoute[]): void {
    if (!this.mapInstance || !this.mapLoaded || !routes?.length) return;
    const bounds = new maplibregl.LngLatBounds();
    let hasBounds = false;
    for (const route of routes) {
      if (isValidCoordinates(route.fromCoordinates)) {
        bounds.extend([route.fromCoordinates.longitude, route.fromCoordinates.latitude]);
        hasBounds = true;
      }
      if (isValidCoordinates(route.toCoordinates)) {
        bounds.extend([route.toCoordinates.longitude, route.toCoordinates.latitude]);
        hasBounds = true;
      }
    }
    if (!hasBounds) return;
    this.mapInstance.fitBounds(bounds, { padding: 80, duration: 800, maxZoom: 10 });
  }

  /** Fit map view to include all given nodes (e.g. after applying filters so the result is visible). */
  fitBoundsToNodes(nodes: WarRoomNode[]): void {
    if (!this.mapInstance || !this.mapLoaded || !nodes?.length) return;
    const bounds = new maplibregl.LngLatBounds();
    let hasBounds = false;
    for (const node of nodes) {
      const coords = this.getNodeCoordinates(node);
      if (coords && isValidCoordinates(coords)) {
        bounds.extend([coords.longitude, coords.latitude]);
        hasBounds = true;
      }
    }
    if (!hasBounds) return;
    this.mapInstance.fitBounds(bounds, { padding: 80, duration: 800, maxZoom: 10 });
  }

  async captureRouteScreenshot(route: ProjectRoute): Promise<Blob> {
    return this.captureRoutesScreenshot([route]);
  }

  async captureRoutesScreenshot(routes: ProjectRoute[]): Promise<Blob> {
    if (!this.mapInstance || !this.mapLoaded) {
      throw new Error('Map is not ready to capture.');
    }
    this.fitBoundsToRoutes(routes);
    await this.ensureMapIsReady();
    await this.waitForOverlayPaint();
    return await this.captureCompositeMapAsBlob();
  }

  private async ensureMapIsReady(): Promise<void> {
    const map = this.mapInstance;
    if (!map) return;
    await new Promise<void>((resolve) => {
      const timeoutMs = 1800;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.mapInstance?.off('idle', onIdle);
        resolve();
      }, timeoutMs);
      const onIdle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      map.once('idle', onIdle);
    });
    const mapAfterIdle = this.mapInstance;
    if (!mapAfterIdle) return;
    mapAfterIdle.triggerRepaint();
    await new Promise<void>((resolve) => {
      mapAfterIdle.once('render', () => resolve());
    });
  }

  private captureCanvasAsBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const canvas = this.mapInstance?.getCanvas();
      if (!canvas) {
        reject(new Error('Map canvas not available.'));
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to create image from map canvas.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  }

  private async captureMapContainerAsBlob(): Promise<Blob> {
    const mapContainer = this.mapContainerRef?.nativeElement;
    if (!mapContainer) {
      return this.captureCanvasAsBlob();
    }

    try {
      const canvas = await html2canvas(mapContainer, {
        backgroundColor: null,
        useCORS: true,
        allowTaint: false,
        logging: false,
        scale: Math.max(window.devicePixelRatio || 1, 1),
      });

      return await this.canvasToBlob(canvas);
    } catch {
      return this.captureCanvasAsBlob();
    }
  }

  /**
   * Capture map canvas (tiles/labels) and DOM overlays (routes/markers) separately,
   * then composite them into one image so both render reliably in exports.
   */
  private async captureCompositeMapAsBlob(): Promise<Blob> {
    const baseMapCanvas = this.mapInstance?.getCanvas();
    const mapContainer = this.mapContainerRef?.nativeElement;
    if (!baseMapCanvas || !mapContainer) {
      return this.captureCanvasAsBlob();
    }

    const maxRetries = 3;
    let baseSnapshot: HTMLCanvasElement | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      baseSnapshot = await this.captureBaseMapSnapshotCanvas(baseMapCanvas);
      if (!this.isCanvasBlank(baseSnapshot)) break;
      if (attempt < maxRetries - 1) {
        this.mapInstance?.triggerRepaint();
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    try {
      const overlayCanvas = await this.captureOverlayOnlyCanvas(mapContainer, baseMapCanvas);
      const composite = document.createElement('canvas');
      composite.width = baseMapCanvas.width;
      composite.height = baseMapCanvas.height;
      const ctx = composite.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to initialize composite canvas context.');
      }

      if (baseSnapshot && !this.isCanvasBlank(baseSnapshot)) {
        ctx.drawImage(baseSnapshot, 0, 0, composite.width, composite.height);
      } else {
        this.toastr.warning(
          'Basemap capture failed. Exporting overlays only. Please try again or refresh if the issue persists.',
          'Capture Warning'
        );
        const bg = this.currentTheme() === 'dark' ? '#1a1a1a' : '#f5f5f5';
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, composite.width, composite.height);
      }
      ctx.drawImage(overlayCanvas, 0, 0, composite.width, composite.height);
      return await this.canvasToBlob(composite);
    } catch {
      return this.captureMapContainerAsBlob();
    }
  }

  private isCanvasBlank(canvas: HTMLCanvasElement): boolean {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width <= 0 || canvas.height <= 0) return true;
    const samples: Array<[number, number]> = [
      [canvas.width / 2, canvas.height / 2],
      [canvas.width / 4, canvas.height / 4],
      [3 * canvas.width / 4, canvas.height / 4],
      [canvas.width / 4, 3 * canvas.height / 4],
      [3 * canvas.width / 4, 3 * canvas.height / 4],
    ];
    for (const [x, y] of samples) {
      try {
        const pixel = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        if (pixel[3] > 0) return false;
      } catch {
        return true;
      }
    }
    return true;
  }

  private async captureOverlayOnlyCanvas(
    mapContainer: HTMLDivElement,
    baseMapCanvas: HTMLCanvasElement
  ): Promise<HTMLCanvasElement> {
    const routesHost = mapContainer.querySelector('app-fluorescence-map-map-routes') as HTMLElement | null;
    const markersHost = mapContainer.querySelector('app-fluorescence-map-map-markers') as HTMLElement | null;
    if (routesHost && markersHost) {
      const composedOverlay = document.createElement('canvas');
      composedOverlay.width = baseMapCanvas.width;
      composedOverlay.height = baseMapCanvas.height;
      const composedCtx = composedOverlay.getContext('2d');
      if (!composedCtx) {
        throw new Error('Failed to initialize overlay composition context.');
      }

      const routesCanvas = await this.captureElementCanvas(routesHost);
      const markersCanvas = await this.captureElementCanvas(markersHost);
      if (routesCanvas.width > 0 && routesCanvas.height > 0) {
        composedCtx.drawImage(routesCanvas, 0, 0, composedOverlay.width, composedOverlay.height);
      }
      if (markersCanvas.width > 0 && markersCanvas.height > 0) {
        composedCtx.drawImage(markersCanvas, 0, 0, composedOverlay.width, composedOverlay.height);
      }
      return composedOverlay;
    }

    const previousVisibility = baseMapCanvas.style.visibility;
    baseMapCanvas.style.visibility = 'hidden';
    try {
      return await html2canvas(mapContainer, {
        backgroundColor: null,
        useCORS: true,
        allowTaint: false,
        logging: false,
        scale: Math.max(window.devicePixelRatio || 1, 1),
      });
    } finally {
      baseMapCanvas.style.visibility = previousVisibility;
    }
  }

  private captureElementCanvas(element: HTMLElement): Promise<HTMLCanvasElement> {
    let captureTarget = element;
    const hostRect = element.getBoundingClientRect();
    if ((hostRect.width === 0 || hostRect.height === 0) && element.firstElementChild instanceof HTMLElement) {
      const childRect = element.firstElementChild.getBoundingClientRect();
      if (childRect.width > 0 && childRect.height > 0) {
        captureTarget = element.firstElementChild;
      }
    }
    return html2canvas(captureTarget, {
      backgroundColor: null,
      useCORS: true,
      allowTaint: false,
      logging: false,
      scale: Math.max(window.devicePixelRatio || 1, 1),
    });
  }

  private async captureBaseMapSnapshotCanvas(baseMapCanvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    const snapshot = document.createElement('canvas');
    snapshot.width = baseMapCanvas.width;
    snapshot.height = baseMapCanvas.height;
    const snapshotCtx = snapshot.getContext('2d');
    if (!snapshotCtx) {
      throw new Error('Failed to initialize base snapshot canvas context.');
    }
    snapshotCtx.drawImage(baseMapCanvas, 0, 0, snapshot.width, snapshot.height);
    return snapshot;
  }

  private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to create image from rendered map container.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  }

  private waitForOverlayPaint(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  private isHub(node: WarRoomNode): boolean {
    return node.type === 'Hub' || node.isHub === true;
  }
  private getRouteColor(): string {
    const status = this.filterStatus();
    if (status === 'active') return '#00C853';
    if (status === 'inactive') return '#D50000';
    return '#00C853';
  }

  private getProjectStatusGlow(color: string): string {
    if (color === '#00C853') return 'rgba(0, 200, 83, 0.45)';
    if (color === '#D50000') return 'rgba(213, 0, 0, 0.45)';
    return 'rgba(14, 165, 233, 0.45)';
  }

  readonly tooltipVm = computed<TooltipVm | null>(() => {
    const hovered = this.hoveredNode();
    const pinned = this.pinnedNodeId();
    const node = hovered || (pinned ? this.nodes().find((n) => n.id === pinned) || null : null);
    if (!node) return null;

    const pixel = this.markerPixelCoordinates().get(node.id);
    if (!pixel) return null;

    this.logoFailureVersion();

    const containerRect = this.containerRect();
    const anchorLeft = containerRect ? containerRect.left + pixel.x : pixel.x;
    const anchorTop = containerRect ? containerRect.top + pixel.y : pixel.y;

    const bounds = this.getTooltipBounds();
    const availableWidth = Math.max(120, bounds.right - bounds.left);
    const availableHeight = Math.max(120, bounds.bottom - bounds.top);
    const tooltipWidth = Math.min(420, Math.max(260, Math.floor(availableWidth * 0.92)));
    const tooltipHeight = Math.min(360, Math.max(180, Math.floor(availableHeight * 0.6)));
    const anchor = { left: anchorLeft, top: anchorTop, width: 16, height: 16 };
    const position = this.mathService.computeTooltipPosition(anchor, bounds, { width: tooltipWidth, height: tooltipHeight });

    const baseUrl = window.location.origin;
    const displayName = this.getCompanyDisplayName(node);
    const description = this.getCompanyDescription(node);
    const logoSource = this.getCompanyLogoSource(node);
    const failures = logoSource ? this.logoFailureCache.get(logoSource) : undefined;
    const logoPath = logoSource
      ? this.assetsService.getPreferredLogoPath(logoSource, baseUrl, failures)
      : '';
    const locationLabel = node.country ? `${node.city}, ${node.country}` : (node.city || '');
    const statusLabel = this.getStatusDisplayText(node.status);
    const statusClass = this.assetsService.getTooltipStatusClass(node.status);
    const typeLabel = this.getTypeLabel(node);

    return {
      visible: true,
      nodeId: node.id,
      top: position.top,
      left: position.left,
      flipped: position.flipped,
      displayName,
      description,
      logoPath,
      typeLabel,
      locationLabel,
      statusLabel,
      statusClass,
      fullAddress: node.fullAddress,
      notes: node.notes,
    };
  });

}
