import { Component, input, output, AfterViewInit, OnDestroy, inject, effect, signal, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import { Node as WarRoomNode, FleetSelection, TransitRoute, ProjectRoute } from '../../../../models/fluorescence-map.interface';
import { WarRoomService } from '../../../../services/fluorescence-map.service';
import { AppStateService } from '../../../../services/app-state.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { WarRoomMapControlsComponent } from './controls/fluorescence-map-map-controls.component';
import { WarRoomMapTooltipComponent, TooltipVm } from './tooltip/fluorescence-map-map-tooltip.component';
import { WarRoomMapMathService } from './services/fluorescence-map-map-math.service';
import { WarRoomMapAssetsService } from './services/fluorescence-map-map-assets.service';
import { MarkerVm, MarkerNodeType } from './fluorescence-map-map.vm';
import { WarRoomMapRoutesComponent, RouteVm } from './routes/fluorescence-map-map-routes.component';
import { WarRoomMapMarkersComponent } from './markers/fluorescence-map-map-markers.component';
import { ToastrService } from 'ngx-toastr';
import { isValidCoordinates } from '../../../../utils/coordinate.utils';
import { environment } from '../../../../../../environments/environment';
import html2canvas from 'html2canvas';

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

@Component({
  selector: 'app-war-room-map',
  imports: [
    CommonModule,
    WarRoomMapControlsComponent,
    WarRoomMapTooltipComponent,
    WarRoomMapRoutesComponent,
    WarRoomMapMarkersComponent,
  ],
  templateUrl: './fluorescence-map-map.component.html',
  styleUrls: ['./fluorescence-map-map.component.scss'],
})
export class WarRoomMapComponent implements AfterViewInit, OnDestroy {
  // Inputs
  screenshotMode = input<boolean>(false);
  nodes = input<WarRoomNode[]>([]);
  selectedEntity = input<FleetSelection | null>(null);
  transitRoutes = input<TransitRoute[]>([]);
  projectRoutes = input<ProjectRoute[]>([]);
  filterStatus = input<'all' | 'active' | 'inactive'>('all');

  // Outputs
  nodeSelected = output<WarRoomNode | undefined>();
  routeSelected = output<{ routeId: string; projectId?: string }>();
  zoomStable = output<number>();
  addProjectRequested = output<void>();
  zoomedToEntity = output<void>();
  previousViewRestored = output<void>();

  @ViewChild('mapContainer', { static: false }) mapContainerRef!: ElementRef<HTMLDivElement>;

  private mapInstance: MapLibreMap | null = null;
  private mapLoaded = false;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private pendingZoomEntityId: string | null = null;
  private isFullscreen = false;
  private fullscreenHandler: (() => void) | null = null;
  private overlayUpdateRaf: number | null = null;
  private overlayEnsureCoords = false;
  private selectionZoomTimeoutId: any = null;
  private zoomStableTimeoutId: ReturnType<typeof setTimeout> | null = null;
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
  private readonly MAP_STYLE = environment.mapStyles;

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
  /** When true, user dismissed the error overlay; non-map UI remains usable. */
  readonly mapErrorDismissed = signal<boolean>(false);
  /** When true, retry will not help (e.g. WebGL unsupported); Retry is disabled. */
  readonly mapErrorUnrecoverable = signal<boolean>(false);
  private mapErrorToastShown = false;
  readonly contextMenuVisible = signal<boolean>(false);
  readonly contextMenuPosition = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  // Services
  private warRoomService = inject(WarRoomService);
  private appStateService = inject(AppStateService);
  private mathService = inject(WarRoomMapMathService);
  private assetsService = inject(WarRoomMapAssetsService);
  private toastr = inject(ToastrService);

  currentTheme = signal<'light' | 'dark'>('dark');

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
      const selected = this.selectedEntity();
      const container = document.querySelector('.war-room-map-container') as HTMLElement | null;
      if (container) {
        if (selected?.id) {
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
      const routes = this.transitRoutes();
      const projectRoutes = this.projectRoutes();
      const status = this.filterStatus();
      void selected;
      void hovered;
      void routes;
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
    setTimeout(() => this.initMap(), 0);
    this.setupResizeObserver();
    this.setupFullscreenListeners();
  }

  retryMapLoad(): void {
    if (this.mapErrorUnrecoverable()) return;
    this.mapLoadError.set(null);
    this.mapLoadErrorDetail.set(null);
    this.mapErrorDismissed.set(false);
    this.mapErrorUnrecoverable.set(false);
    this.mapLoading.set(true);
    this.initMapRetryCount = 0;
    this.initMap();
  }

  dismissMapError(): void {
    this.mapErrorDismissed.set(true);
  }

  ngOnDestroy(): void {
    this.destroyed = true;

    if (this.selectionZoomTimeoutId) {
      clearTimeout(this.selectionZoomTimeoutId);
      this.selectionZoomTimeoutId = null;
    }
    if (this.zoomStableTimeoutId) {
      clearTimeout(this.zoomStableTimeoutId);
      this.zoomStableTimeoutId = null;
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

    if (this.mapInstance) {
      this.mapInstance.remove();
      this.mapInstance = null;
    }
  }

  // Helper methods for template
  getSelectedNode(): WarRoomNode | undefined {
    const selectedId = this.selectedEntity()?.id;
    if (!selectedId) return undefined;
    return this.nodes().find(n => n.companyId === selectedId);
  }

  getSelectedNodePosition(): { top: number; left: number } {
    const node = this.getSelectedNode();
    if (!node) return { top: 0, left: 0 };
    return this.getNodePosition(node);
  }

  getSelectedNodeCity(): string {
    return this.getSelectedNode()?.city || '';
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
        if (isValidCoordinates(node.coordinates)) {
          return;
        }
        try {
          const coords = await this.geocodeLocation(label);
          if (isValidCoordinates(coords)) {
            node.coordinates = { latitude: coords.latitude, longitude: coords.longitude };
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

  private getNodesWithValidCoordinates(nodes: WarRoomNode[]): WarRoomNode[] {
    return nodes.filter((node) => isValidCoordinates(node.coordinates));
  }

  private async geocodeLocation(location: string): Promise<{ latitude: number; longitude: number }> {
    const cached = this.geocodeCache.get(location);
    if (cached) return cached;

    const inflight = this.geocodeInFlight.get(location);
    if (inflight) return inflight;

    const request = (async () => {
      const geocodeUrl =
        `${environment.geocodeApiUrl}?name=${encodeURIComponent(location)}` +
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
    this.contextMenuVisible.set(false);
  }

  onMapContextMenu(event: MouseEvent): void {
    if (this.screenshotMode()) return;
    event.preventDefault();
    this.contextMenuPosition.set({ x: event.clientX, y: event.clientY });
    this.contextMenuVisible.set(true);
  }

  onContextMenuAddProject(): void {
    this.contextMenuVisible.set(false);
    this.addProjectRequested.emit();
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
      const shouldEnsure = this.overlayEnsureCoords;
      this.overlayEnsureCoords = false;
      void this.syncOverlays(shouldEnsure);
    });
  }

  private getMapContainer(): HTMLElement | null {
    return this.mapContainerRef?.nativeElement ?? document.getElementById('war-room-map');
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
    this.mapErrorUnrecoverable.set(unrecoverable);
    if (showToast && !this.mapErrorToastShown) {
      this.mapErrorToastShown = true;
      this.toastr.error(msg, 'Map failed to load');
    }
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
      if (this.initMapRetryCount >= WarRoomMapComponent.INIT_MAP_MAX_RETRIES) {
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
      this.setMapError(msg, detail, unrecoverable, true);
    });

    this.mapInstance.on('load', () => {
      if (this.destroyed) return;
      this.mapLoading.set(false);
      this.mapLoadError.set(null);
      this.mapLoadErrorDetail.set(null);
      this.mapErrorDismissed.set(false);
      this.mapErrorUnrecoverable.set(false);
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
    return this.MAP_STYLE[theme];
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
    });
    // #region agent log
    fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-3',hypothesisId:'H9',location:'fluorescence-map-map.component.ts:createMap',message:'Map instance created for capture diagnostics',data:{theme:this.currentTheme(),style:this.getMapStyleUrl(this.currentTheme()),webgl:this.getWebGlContextInfo(map.getCanvas())},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
      // Use setTimeout to ensure map has finished resizing
      setTimeout(() => {
        if (!this.destroyed) {
          this.updateContainerRect();
          this.scheduleOverlayUpdate(false);
        }
      }, 50);
    });

    this.resizeObserver.observe(container);
  }

  private setupFullscreenListeners(): void {
    const handler = () => {
      const isFull = !!document.fullscreenElement;
      this.isFullscreen = isFull;
      this.fullscreenState.set(isFull);
      if (this.mapInstance) {
        setTimeout(() => this.mapInstance?.resize(), 50);
      }
    };
    this.fullscreenHandler = handler;
    document.addEventListener('fullscreenchange', handler);
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

    const allNodes = this.nodes();
    const zoom = this.mapInstance.getZoom();

    if (ensureCoords) {
      await this.ensureNodeCoordinates(allNodes);
    }

    const nodes = this.getNodesWithValidCoordinates(allNodes);

    const selected = this.selectedEntity();
    const hovered = this.warRoomService.hoveredEntity();
    const baseUrl = window.location.origin;

    const markerPixels = new Map<string, { x: number; y: number }>();
    const projectStatusByNodeId = this.buildProjectStatusByNodeId(this.projectRoutes());
    const markers: MarkerVm[] = [];

    nodes.forEach((node) => {
      const displayCoords = this.getEffectiveCoordinates(node, nodes);
      const point = this.mapInstance!.project([displayCoords.longitude, displayCoords.latitude]);
      markerPixels.set(node.id, { x: point.x, y: point.y });
      const projectStatusColor = this.getProjectStatusColor(node, projectStatusByNodeId);
      const vm = this.buildMarkerVm(node, zoom, selected, hovered, baseUrl, displayCoords, projectStatusColor);
      markers.push(vm);
    });

    const featureCollection = this.buildRouteFeatures(nodes);
    const routes: RouteVm[] = [];

    const projectRouteGroups = new Map<string, number[]>();
    featureCollection.features.forEach((f, idx) => {
      const fid = f.properties.fromNodeId;
      const tid = f.properties.toNodeId;
      if (fid && tid) {
        const key = `${fid}|${tid}`;
        const arr = projectRouteGroups.get(key) ?? [];
        arr.push(idx);
        projectRouteGroups.set(key, arr);
      }
    });

    featureCollection.features.forEach((feature, index) => {
      const coords = feature.geometry.coordinates;
      if (coords.length < 2) return;
      const fid = feature.properties.fromNodeId;
      const tid = feature.properties.toNodeId;
      // Resolve pixel from markerPixels; fallback to matching node when endpoint id differs (e.g. subsidiary vs factory)
      let startPixel = fid ? markerPixels.get(fid) : undefined;
      if (!startPixel && fid) {
        const fromNode = nodes.find((n) => this.nodeMatchesProjectRouteEndpoint(n, fid, true));
        if (fromNode) startPixel = markerPixels.get(fromNode.id);
      }
      let endPixel = tid ? markerPixels.get(tid) : undefined;
      if (!endPixel && tid) {
        const toNode = nodes.find((n) => this.nodeMatchesProjectRouteEndpoint(n, tid, false));
        if (toNode) endPixel = markerPixels.get(toNode.id);
      }
      let startPoint = startPixel
        ? { x: startPixel.x, y: startPixel.y }
        : this.mapInstance!.project(coords[0]);
      let endPoint = endPixel
        ? { x: endPixel.x, y: endPixel.y }
        : this.mapInstance!.project(coords[1]);
      let groupIndex = -1;
      let groupSize = 1;
      if (fid && tid) {
        const key = `${fid}|${tid}`;
        const indices = projectRouteGroups.get(key);
        if (indices && indices.length > 1) {
          groupIndex = indices.indexOf(index);
          groupSize = indices.length;
        }
        // Always align marker with route line endpoint (for both single and parallel routes)
        this.updateMarkerPixelsForRouteEndpoints(
          markerPixels,
          nodes,
          fid,
          tid,
          startPoint,
          endPoint,
          indices,
          index
        );
      }
      const path = this.createRoutePath(startPoint, endPoint, groupIndex, groupSize);
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

    this.markerPixelCoordinates.set(markerPixels);
    this.markersVm.set(markers);
    this.routesVm.set(routes);
  }

  private buildMarkerVm(
    node: WarRoomNode,
    zoom: number,
    selected: FleetSelection | null,
    hovered: FleetSelection | null,
    baseUrl: string,
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

    return {
      id: node.id,
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

    if (this.mapInstance && isValidCoordinates(node.coordinates)) {
      const point = this.mapInstance.project([node.coordinates.longitude, node.coordinates.latitude]);
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
    const container = document.querySelector('.war-room-map-container') as HTMLElement | null;
    if (!container) return;

    if (!this.isFullscreen) {
      if (container.requestFullscreen) {
        void container.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
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

    if (!target || !isValidCoordinates(target.coordinates)) {
      if (!this.mapInstance || !this.mapLoaded) {
        this.pendingZoomEntityId = entityId;
      }
      return;
    }

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
      center: [target.coordinates.longitude, target.coordinates.latitude],
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

  async captureRouteScreenshot(route: ProjectRoute): Promise<Blob> {
    return this.captureRoutesScreenshot([route]);
  }

  async captureRoutesScreenshot(routes: ProjectRoute[]): Promise<Blob> {
    if (!this.mapInstance || !this.mapLoaded) {
      throw new Error('Map is not ready to capture.');
    }
    // #region agent log
    fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix',hypothesisId:'H3',location:'fluorescence-map-map.component.ts:captureRoutesScreenshot:entry',message:'Capture route screenshot started',data:{routesCount:routes.length,mapLoaded:this.mapLoaded,isStyleLoaded:this.mapInstance.isStyleLoaded(),zoom:this.mapInstance.getZoom(),markersCount:this.markersVm().length,visiblePinLabels:this.markersVm().filter((m)=>m.showPinLabel).length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    this.fitBoundsToRoutes(routes);
    await this.waitForMapIdle(1800);
    await this.waitForOverlayPaint();
    // #region agent log
    fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix',hypothesisId:'H3',location:'fluorescence-map-map.component.ts:captureRoutesScreenshot:postWait',message:'Capture route screenshot after map settle',data:{isStyleLoaded:this.mapInstance.isStyleLoaded(),zoom:this.mapInstance.getZoom(),center:this.mapInstance.getCenter()},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return await this.captureCompositeMapAsBlob();
  }

  private waitForMapIdle(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.mapInstance) {
        resolve();
        return;
      }
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
      this.mapInstance.once('idle', onIdle);
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
    } catch (error) {
      console.warn('Falling back to canvas-only map capture:', error);
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

    try {
      const baseSnapshot = await this.captureBaseMapSnapshotCanvas(baseMapCanvas);
      const overlayCanvas = await this.captureOverlayOnlyCanvas(mapContainer, baseMapCanvas);
      const composite = document.createElement('canvas');
      composite.width = baseMapCanvas.width;
      composite.height = baseMapCanvas.height;
      const ctx = composite.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to initialize composite canvas context.');
      }

      ctx.drawImage(baseSnapshot, 0, 0, composite.width, composite.height);
      ctx.drawImage(overlayCanvas, 0, 0, composite.width, composite.height);
      // #region agent log
      fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix',hypothesisId:'H4',location:'fluorescence-map-map.component.ts:captureCompositeMapAsBlob',message:'Composite canvas built',data:{base:this.getCanvasSample(baseSnapshot),overlay:this.getCanvasSample(overlayCanvas),composite:this.getCanvasSample(composite)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return await this.canvasToBlob(composite);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix',hypothesisId:'H4',location:'fluorescence-map-map.component.ts:captureCompositeMapAsBlob:catch',message:'Composite capture failed',data:{error:error instanceof Error?error.message:String(error)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.warn('Falling back to container capture after composite failure:', error);
      return this.captureMapContainerAsBlob();
    }
  }

  private async captureOverlayOnlyCanvas(
    mapContainer: HTMLDivElement,
    baseMapCanvas: HTMLCanvasElement
  ): Promise<HTMLCanvasElement> {
    const routesHost = mapContainer.querySelector('app-war-room-map-routes') as HTMLElement | null;
    const markersHost = mapContainer.querySelector('app-war-room-map-markers') as HTMLElement | null;
    // #region agent log
    fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-2',hypothesisId:'H6',location:'fluorescence-map-map.component.ts:captureOverlayOnlyCanvas:hosts',message:'Overlay host presence and bounds',data:{routesHost:!!routesHost,markersHost:!!markersHost,routesRect:routesHost?this.getElementRect(routesHost):null,markersRect:markersHost?this.getElementRect(markersHost):null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
      // #region agent log
      fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-2',hypothesisId:'H6',location:'fluorescence-map-map.component.ts:captureOverlayOnlyCanvas:overlaySizes',message:'Overlay canvas sizes before draw',data:{routesCanvas:this.getCanvasSample(routesCanvas),markersCanvas:this.getCanvasSample(markersCanvas),targetWidth:composedOverlay.width,targetHeight:composedOverlay.height},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (routesCanvas.width > 0 && routesCanvas.height > 0) {
        composedCtx.drawImage(routesCanvas, 0, 0, composedOverlay.width, composedOverlay.height);
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'post-fix',hypothesisId:'H6',location:'fluorescence-map-map.component.ts:captureOverlayOnlyCanvas:skipRoutes',message:'Skipped route overlay draw due zero-sized canvas',data:{routesCanvas:this.getCanvasSample(routesCanvas)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      if (markersCanvas.width > 0 && markersCanvas.height > 0) {
        composedCtx.drawImage(markersCanvas, 0, 0, composedOverlay.width, composedOverlay.height);
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'post-fix',hypothesisId:'H6',location:'fluorescence-map-map.component.ts:captureOverlayOnlyCanvas:skipMarkers',message:'Skipped marker overlay draw due zero-sized canvas',data:{markersCanvas:this.getCanvasSample(markersCanvas)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      // #region agent log
      fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'post-fix',hypothesisId:'H6',location:'fluorescence-map-map.component.ts:captureOverlayOnlyCanvas:composedTransparent',message:'Overlay composed from route and marker hosts',data:{routes:this.getCanvasSample(routesCanvas),markers:this.getCanvasSample(markersCanvas),overlay:this.getCanvasSample(composedOverlay)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return composedOverlay;
    }

    const previousVisibility = baseMapCanvas.style.visibility;
    baseMapCanvas.style.visibility = 'hidden';
    try {
      const overlay = await html2canvas(mapContainer, {
        backgroundColor: null,
        useCORS: true,
        allowTaint: false,
        logging: false,
        scale: Math.max(window.devicePixelRatio || 1, 1),
      });
      // #region agent log
      fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix',hypothesisId:'H2',location:'fluorescence-map-map.component.ts:captureOverlayOnlyCanvas',message:'Overlay-only canvas captured',data:{baseVisibilityBeforeHide:previousVisibility,overlay:this.getCanvasSample(overlay)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return overlay;
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
    // #region agent log
    fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'post-fix',hypothesisId:'H8',location:'fluorescence-map-map.component.ts:captureElementCanvas:entry',message:'Capture element canvas entry',data:{hostTag:element.tagName.toLowerCase(),hostRect:this.getElementRect(element),targetTag:captureTarget.tagName.toLowerCase(),targetRect:this.getElementRect(captureTarget)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7245/ingest/ab8d750c-0ce1-4995-ad04-76d44750784f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-3',hypothesisId:'H9',location:'fluorescence-map-map.component.ts:captureBaseMapSnapshotCanvas',message:'Base map snapshot sampled',data:{webgl:this.getWebGlContextInfo(baseMapCanvas),baseCanvas:this.getCanvasCoverage(baseMapCanvas),snapshot:this.getCanvasCoverage(snapshot)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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

  private getCanvasSample(canvas: HTMLCanvasElement): {
    width: number;
    height: number;
    samplePixel: [number, number, number, number] | null;
  } {
    const width = canvas.width ?? 0;
    const height = canvas.height ?? 0;
    if (width <= 0 || height <= 0) {
      return { width, height, samplePixel: null };
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return { width, height, samplePixel: null };
    }
    const x = Math.max(0, Math.floor(width / 2));
    const y = Math.max(0, Math.floor(height / 2));
    try {
      const px = context.getImageData(x, y, 1, 1).data;
      return { width, height, samplePixel: [px[0], px[1], px[2], px[3]] };
    } catch {
      return { width, height, samplePixel: null };
    }
  }

  private getCanvasCoverage(canvas: HTMLCanvasElement): {
    width: number;
    height: number;
    samplePixel: [number, number, number, number] | null;
    alphaSamples: number[];
  } {
    const base = this.getCanvasSample(canvas);
    if (!base.samplePixel) {
      return { ...base, alphaSamples: [] };
    }
    const width = canvas.width ?? 0;
    const height = canvas.height ?? 0;
    const context = canvas.getContext('2d');
    if (!context || width <= 0 || height <= 0) {
      return { ...base, alphaSamples: [] };
    }
    const points: Array<[number, number]> = [
      [Math.floor(width * 0.2), Math.floor(height * 0.2)],
      [Math.floor(width * 0.5), Math.floor(height * 0.2)],
      [Math.floor(width * 0.8), Math.floor(height * 0.2)],
      [Math.floor(width * 0.2), Math.floor(height * 0.5)],
      [Math.floor(width * 0.5), Math.floor(height * 0.5)],
      [Math.floor(width * 0.8), Math.floor(height * 0.5)],
      [Math.floor(width * 0.2), Math.floor(height * 0.8)],
      [Math.floor(width * 0.5), Math.floor(height * 0.8)],
      [Math.floor(width * 0.8), Math.floor(height * 0.8)],
    ];
    const alphaSamples: number[] = [];
    for (const [x, y] of points) {
      try {
        alphaSamples.push(context.getImageData(x, y, 1, 1).data[3]);
      } catch {
        alphaSamples.push(-1);
      }
    }
    return { ...base, alphaSamples };
  }

  private getWebGlContextInfo(canvas: HTMLCanvasElement): {
    contextType: string | null;
    preserveDrawingBuffer: boolean | null;
    alpha: boolean | null;
  } {
    try {
      const gl2 = canvas.getContext('webgl2') as WebGLRenderingContext | null;
      if (gl2) {
        const attrs = gl2.getContextAttributes();
        return {
          contextType: 'webgl2',
          preserveDrawingBuffer: attrs?.preserveDrawingBuffer ?? null,
          alpha: attrs?.alpha ?? null,
        };
      }
      const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
      if (gl) {
        const attrs = gl.getContextAttributes();
        return {
          contextType: 'webgl',
          preserveDrawingBuffer: attrs?.preserveDrawingBuffer ?? null,
          alpha: attrs?.alpha ?? null,
        };
      }
    } catch {
      return { contextType: null, preserveDrawingBuffer: null, alpha: null };
    }
    return { contextType: null, preserveDrawingBuffer: null, alpha: null };
  }

  private getElementRect(element: HTMLElement): {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
    offsetWidth: number;
    offsetHeight: number;
  } {
    const rect = element.getBoundingClientRect();
    return {
      width: Number(rect.width.toFixed(2)),
      height: Number(rect.height.toFixed(2)),
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      offsetWidth: element.offsetWidth,
      offsetHeight: element.offsetHeight,
    };
  }

  private isHub(node: WarRoomNode): boolean {
    return node.type === 'Hub' || node.isHub === true;
  }

  /** Returns true if the node is the route endpoint identified by endpointId (route.from or route.to). */
  private nodeMatchesEndpointId(node: WarRoomNode, endpointId: string, nodes: WarRoomNode[]): boolean {
    const nid = endpointId.toLowerCase();
    if (node.id === endpointId || node.factoryId === endpointId || node.subsidiaryId === endpointId || node.parentGroupId === endpointId) {
      return true;
    }
    const factory = this.warRoomService.factories().find(f => f.id === endpointId);
    if (factory && (node.id === factory.subsidiaryId || node.id === factory.parentGroupId)) {
      return true;
    }
    if ((nid.includes('fleetzero') || nid.includes('fleet-zero')) && (node.id === 'fleetzero' || (node.name && node.name.toLowerCase().includes('fleetzero')))) {
      return true;
    }
    if (endpointId.startsWith('source-')) {
      const baseId = endpointId.replace('source-', '');
      if (node.id === baseId || node.factoryId === baseId || node.subsidiaryId === baseId) {
        return true;
      }
      const baseFactory = this.warRoomService.factories().find(f => f.id === baseId);
      if (baseFactory && (node.id === baseFactory.subsidiaryId || node.id === baseFactory.parentGroupId)) {
        return true;
      }
    }
    return (!!node.name && node.name.toLowerCase() === nid) || (!!node.company && node.company.toLowerCase().includes(nid));
  }

  /** Update marker pixel positions so they align exactly with route line endpoints. */
  private updateMarkerPixelsForRouteEndpoints(
    markerPixels: Map<string, { x: number; y: number }>,
    nodes: WarRoomNode[],
    fid: string,
    tid: string,
    startPoint: { x: number; y: number },
    endPoint: { x: number; y: number },
    indices: number[] | undefined,
    index: number
  ): void {
    const shouldUpdate =
      !indices || indices.length <= 1 || index === indices[Math.floor(indices.length / 2)];
    if (!shouldUpdate) return;
    markerPixels.set(fid, { x: startPoint.x, y: startPoint.y });
    markerPixels.set(tid, { x: endPoint.x, y: endPoint.y });
    nodes.forEach((n) => {
      if (this.nodeMatchesProjectRouteEndpoint(n, fid, true)) {
        markerPixels.set(n.id, { x: startPoint.x, y: startPoint.y });
      }
      if (this.nodeMatchesProjectRouteEndpoint(n, tid, false)) {
        markerPixels.set(n.id, { x: endPoint.x, y: endPoint.y });
      }
    });
  }

  /** True if node represents a project route endpoint (factory or client). */
  private nodeMatchesProjectRouteEndpoint(
    node: WarRoomNode,
    endpointId: string,
    isToNode: boolean
  ): boolean {
    if (node.id === endpointId) return true;
    if (node.factoryId === endpointId || node.subsidiaryId === endpointId) return true;
    const factory = this.warRoomService.factories().find((f) => f.id === endpointId);
    if (factory && (node.id === factory.subsidiaryId || node.id === factory.parentGroupId)) return true;
    if (node.clientId === endpointId) return true;
    return false;
  }

  /** Coordinates to use for marker position; prefer route endpoint coords when node is a route endpoint so marker aligns with the line. */
  private getEffectiveCoordinates(node: WarRoomNode, nodes: WarRoomNode[]): { longitude: number; latitude: number } {
    const projectRoutes = this.projectRoutes();
    if (projectRoutes?.length) {
      for (const route of projectRoutes) {
        if (this.nodeMatchesProjectRouteEndpoint(node, route.toNodeId, true) && isValidCoordinates(route.toCoordinates)) {
          return { longitude: route.toCoordinates.longitude, latitude: route.toCoordinates.latitude };
        }
        if (this.nodeMatchesProjectRouteEndpoint(node, route.fromNodeId, false) && isValidCoordinates(route.fromCoordinates)) {
          return { longitude: route.fromCoordinates.longitude, latitude: route.fromCoordinates.latitude };
        }
      }
    }

    const routes = this.transitRoutes();
    if (!routes?.length) {
      return node.coordinates;
    }
    for (const route of routes) {
      if (this.nodeMatchesEndpointId(node, route.from, nodes) && isValidCoordinates(route.fromCoordinates)) {
        return { longitude: route.fromCoordinates.longitude, latitude: route.fromCoordinates.latitude };
      }
      if (this.nodeMatchesEndpointId(node, route.to, nodes) && isValidCoordinates(route.toCoordinates)) {
        return { longitude: route.toCoordinates.longitude, latitude: route.toCoordinates.latitude };
      }
    }
    return node.coordinates;
  }

  /**
   * Build route path while preserving exact endpoint alignment to marker center.
   * Parallel routes are separated by offsetting only the curve control point.
   */
  private createRoutePath(
    start: { x: number; y: number },
    end: { x: number; y: number },
    indexInGroup: number,
    groupSize: number
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
      (indexInGroup - (groupSize - 1) / 2) * this.PARALLEL_ROUTE_OFFSET_PIXELS;

    const sx = Number(start.x.toFixed(4));
    const sy = Number(start.y.toFixed(4));
    const ex = Number(end.x.toFixed(4));
    const ey = Number(end.y.toFixed(4));
    const cx = Number((midX + offsetAmount * perpX).toFixed(4));
    const cy = Number((midY + offsetAmount * perpY).toFixed(4));
    return `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`;
  }

  private buildRouteFeatures(nodes: WarRoomNode[]): RouteFeatureCollection {
    const transitRoutes = this.transitRoutes();
    const rawProjectRoutes = this.projectRoutes();
    const selected = this.selectedEntity();
    const features: RouteFeature[] = [];

    const filterStatus = this.filterStatus();
    const projectRoutes =
      filterStatus === 'active'
        ? (rawProjectRoutes ?? []).filter((r) => r.status === 'Open')
        : filterStatus === 'inactive'
          ? (rawProjectRoutes ?? []).filter((r) => r.status === 'Closed' || r.status === 'Delayed')
          : rawProjectRoutes ?? [];

    const addProjectRouteFeatures = (): void => {
      if (!projectRoutes.length) return;
      for (const route of projectRoutes) {
        if (!isValidCoordinates(route.fromCoordinates) || !isValidCoordinates(route.toCoordinates)) continue;
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
            : this.getRouteColor();
        // Render project routes from manufacturer -> client (directional animation).
        const startCoords = route.toCoordinates;
        const endCoords = route.fromCoordinates;
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [startCoords.longitude, startCoords.latitude],
              [endCoords.longitude, endCoords.latitude]
            ]
          },
          properties: {
            strokeWidth: 2,
            highlighted,
            routeId: route.id,
            projectId: route.projectId,
            strokeColor,
            fromNodeId: route.toNodeId,
            toNodeId: route.fromNodeId,
          }
        });
      }
    };

    addProjectRouteFeatures();

    if (!transitRoutes || transitRoutes.length === 0) {
      return { type: 'FeatureCollection', features };
    }

    const routes = transitRoutes;

    const findMatches = (id: string): WarRoomNode[] => {
      const nid = id.toLowerCase();

      const direct = nodes.filter((n: WarRoomNode) =>
        n.id === id || n.factoryId === id || n.subsidiaryId === id || n.parentGroupId === id
      );
      if (direct.length > 0) return direct;

      const factory = this.warRoomService.factories().find(f => f.id === id);
      if (factory) {
        const resolved = nodes.filter(n => n.id === factory.subsidiaryId || n.id === factory.parentGroupId);
        if (resolved.length > 0) return resolved;
      }

      if (nid.includes('fleetzero') || nid.includes('fleet-zero')) {
        return nodes.filter(n => n.id === 'fleetzero' || (n.name && n.name.toLowerCase().includes('fleetzero')));
      }

      if (id.startsWith('source-')) {
        const baseId = id.replace('source-', '');
        const resolved = nodes.filter(n => n.id === baseId || n.factoryId === baseId || n.subsidiaryId === baseId);
        if (resolved.length > 0) return resolved;

        const baseFactory = this.warRoomService.factories().find(f => f.id === baseId);
        if (baseFactory) {
          return nodes.filter(n => n.id === baseFactory.subsidiaryId || n.id === baseFactory.parentGroupId);
        }
      }

      return nodes.filter((n: WarRoomNode) =>
        (!!n.name && n.name.toLowerCase() === nid) ||
        (!!n.company && n.company.toLowerCase().includes(nid))
      );
    };

    routes.forEach((route) => {
      const fromMatches = findMatches(route.from);
      const toMatches = findMatches(route.to);

      const fromNode = fromMatches.find((n: WarRoomNode) =>
        n.id === selected?.id || n.subsidiaryId === selected?.id || n.factoryId === selected?.id
      ) || fromMatches[0];

      const toNode = toMatches.find((n: WarRoomNode) =>
        n.id === selected?.id || n.subsidiaryId === selected?.id || n.factoryId === selected?.id
      ) || toMatches[0];

      let fromCoords = fromNode?.coordinates;
      let toCoords = toNode?.coordinates;

      if (!isValidCoordinates(fromCoords) && isValidCoordinates(route.fromCoordinates)) {
        fromCoords = route.fromCoordinates;
      }

      if (!isValidCoordinates(toCoords) && isValidCoordinates(route.toCoordinates)) {
        toCoords = route.toCoordinates;
      }

      if (!fromCoords || !toCoords) return;

      const highlighted = !!selected && (
        route.from === selected.id ||
        route.to === selected.id ||
        route.from === selected.subsidiaryId ||
        route.to === selected.subsidiaryId ||
        route.from === selected.factoryId ||
        route.to === selected.factoryId
      );

      const transitStrokeColor =
        filterStatus === 'inactive' ? '#ef4444' :
          filterStatus === 'active' ? '#5ad85a' :
            route.strokeColor;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [fromCoords.longitude, fromCoords.latitude],
            [toCoords.longitude, toCoords.latitude]
          ]
        },
        properties: {
          strokeWidth: route.strokeWidth || 1.5,
          dashArray: route.dashArray,
          highlighted,
          routeId: route.id,
          strokeColor: transitStrokeColor,
          fromNodeId: fromNode?.id,
          toNodeId: toNode?.id,
        }
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

  private getRouteColor(): string {
    const status = this.filterStatus();
    if (status === 'active') return '#00C853';
    if (status === 'inactive') return '#D50000';
    return '#00C853';
  }

  private buildProjectStatusByNodeId(routes: ProjectRoute[]): Map<string, 'active' | 'inactive'> {
    const result = new Map<string, 'active' | 'inactive'>();
    const applyStatus = (id: string | undefined, status: 'active' | 'inactive' | null): void => {
      if (!id || !status) return;
      const current = result.get(id);
      if (status === 'active' || current == null) {
        result.set(id, status);
        return;
      }
      if (current !== 'active') {
        result.set(id, status);
      }
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
    const nodeId = node.clientId ?? node.factoryId ?? node.id;
    const status = statusByNodeId.get(nodeId);
    if (status === 'active') return '#00C853';
    if (status === 'inactive') return '#D50000';
    return '#0ea5e9';
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
