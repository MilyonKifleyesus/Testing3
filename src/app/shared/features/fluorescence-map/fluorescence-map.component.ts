import { Component, OnInit, OnDestroy, signal, inject, viewChild, effect, computed, isDevMode, input, output } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { take, takeUntil, buffer, debounceTime, filter, share, map, distinctUntilChanged } from 'rxjs/operators';
import { of, switchMap, tap, catchError, timeout, startWith, Subject, EMPTY, Observable, combineLatest } from 'rxjs';
import { WarRoomService } from '../../services/fluorescence-map.service';
import { AuthService } from '../../../shared/services/auth.service';
import { AppStateService } from '../../../shared/services/app-state.service';
import { ClientService } from '../../../shared/services/client.service';
import { ProjectService } from '../../../shared/services/project.service';
import { LocationService, ApiLocation } from '../../services/location.service';
import { Client } from '../../../shared/models/client.model';
import { Node, ParentGroup, FleetSelection, MapViewMode, SubsidiaryCompany, FactoryLocation, ManufacturerLocation, NodeStatus, TransitRoute, ProjectRoute } from '../../models/fluorescence-map.interface';
import { Project } from '../../../shared/models/project.model';
import { FluorescenceMapMapComponent } from './components/fluorescence-map-map/fluorescence-map-map.component';
import { FleetActivityTableComponent } from './components/fleet-activity-table/fleet-activity-table.component';
import { ToastrService } from 'ngx-toastr';
import { RoutePreviewStorageService } from '../../../shared/services/route-preview-storage.service';
import { coerceCoordinateValue, coerceCoordinates, isValidCoordinates } from '../../../shared/utils/coordinate.utils';
import { normalizeNumericLikeId, normalizeNumericLikeIdList } from '../../../shared/utils/id-normalizer.util';
import {
  ActivityLogRow,
  ClientManagementCreateRequest,
  ClientManagementRow,
  ClientManagementSaveRequest,
  ClientVm,
  DataManagementSaveRequest,
  LocationManagementRow,
  LocationManagementCreateRequest,
  LocationManagementSaveRequest,
  LocationVm,
  ManufacturerManagementCreateRequest,
  ManufacturerManagementRow,
  ManufacturerManagementSaveRequest,
  ManufacturerVm,
  ProjectVm,
  ProjectManagementCreateRequest,
} from './models/fleet-vm.models';
import { ActivityLogProjectionFilters, ActivityLogTableService } from './services/activity-log-table.service';
import {
  ADD_PROJECT_PULSE_DURATION_MS,
  ADD_PROJECT_SEEN_KEY,
  ANNOUNCEMENT_CLEAR_DELAY_MS,
  API_TIMEOUT_MS,
  PROJECTS_COMBINED_TIMEOUT_MS,
  REQUIRED_DATA_TIMEOUT_MS,
  FIT_BOUNDS_DELAY_MS,
  LEGACY_STORAGE_KEY,
  MAP_EXPANDED_CLASS,
  MAP_EXPANDED_SCROLL_LOCK_STYLE,
  MARKER_STABILITY_MESSAGE_DURATION_MS,
  PREVIOUS_VIEW_BUTTON_DURATION_MS,
  RESTORE_FOCUS_DELAY_MS,
  STORAGE_KEY,
  TIPS_HINT_DURATION_MS,
  TIPS_HINT_SEEN_KEY,
  VALID_RESTORABLE_MAP_MODES,
  ZOOM_TO_ENTITY_DELAY_MS,
} from './fluorescence-map.constants';
import {
  ActiveFilterItem,
  MapViewModelStrict,
  EndpointStatus,
  FactoryEditPayload,
  FilterStatus,
  SubsidiaryEditPayload,
  WarRoomFilters,
  WarRoomPersistedState,
  createDefaultFilters,
} from './fluorescence-map.types';
import {
  selectActiveFilterCount,
  selectActiveFilters,
  selectAvailableRegions,
  selectDerivedNodeIdsFromRoutes,
  selectFilteredNodesStrict,
  selectFilteredProjectRoutesStrict,
  selectMapViewModelStrict,
  selectNodesWithClients,
  selectProjectRoutesForMap,
  selectStatusCounts,
} from './state/fluorescence-map.selectors';
import { ProjectWorkflowContext, ProjectWorkflowService } from './workflows/project-workflow.service';
import { CaptureWorkflowContext, CaptureWorkflowService } from './workflows/capture-workflow.service';
import { PanelActionsContext, PanelActionsWorkflowService } from './workflows/panel-actions-workflow.service';
import { MapRealtimeService } from './realtime/map-realtime.service';
import { MapPollingService } from './realtime/map-polling.service';
import { MapChangeEvent, RealtimeConnectionState } from './realtime/map-realtime.types';
import { environment } from '../../../../environments/environment';
import { DataManagementMutationService } from './services/data-management-mutation.service';
import { adaptApiClient } from '../../services/adapters/client.adapter';
import { adaptApiManufacturer } from '../../services/adapters/manufacturer.adapter';
import { adaptApiProject } from '../../services/adapters/project.adapter';
import { adaptApiLocation } from '../../services/adapters/location.adapter';

interface ManufacturerRuntimeRecord {
  id: number;
  name: string;
  logo?: string;
  locationId?: number | null;
  locationIds?: number[];
  locations?: Array<{ id: number; latitude: number; longitude: number }>;
}

interface ProjectFormData {
  projectName: string;
  clientId: string;
  clientName: string;
  assessmentType: string;
  manufacturerLocationId?: string | number | null;
  factoryId?: string | number | null;
  location?: string;
  manufacturerName: string;
  status: 'Active' | 'Inactive';
}

type ProjectDeltaPatch = Partial<Project> & {
  locationIds?: number[];
  locations?: Array<{ id: number; latitude: number; longitude: number }>;
  contract?: string;
  hasRoadTest?: boolean;
};

interface AddCompanyModalRef {
  closeAfterSuccess(): void;
  handleSuccess(message: string): void;
  handleError(message: string): void;
}

type RealtimeEnvironmentConfig = typeof environment & {
  mapPollingIntervalMs?: number;
  mapDisconnectGraceMs?: number;
};

@Component({
  selector: 'app-fluorescence-map',
  standalone: true,
  imports: [
    CommonModule,
    FluorescenceMapMapComponent,
    FleetActivityTableComponent,
  ],
  templateUrl: './fluorescence-map.component.html',
  styleUrl: './fluorescence-map.component.scss',
})
export class FluorescenceMapComponent implements OnInit, OnDestroy {
  private static nextShellId = 0;
  /** When true, map FS button is handled by a host dashboard fullscreen overlay (not browser requestFullscreen). */
  readonly dashboardFullscreenMode = input<boolean>(false);
  /** When true, this instance is rendered inside the dashboard fullscreen overlay. */
  readonly dashboardFullscreen = input<boolean>(false);
  /** When true, "Expand Map" triggers browser fullscreen (same as FS button) instead of in-place expand. */
  readonly expandMapTriggersBrowserFullscreen = input<boolean>(false);
  /** Render only the data-management table area (no map/filter chrome). */
  readonly dataManagementOnly = input<boolean>(false);
  /** Data management mode: view-only for War Room, editable for Admin wrapper. */
  readonly dataManagementMode = input<'view' | 'edit'>('view');
  /** Table layout mode: overlay on top of map or inline below map. */
  readonly tableLayout = input<'overlay' | 'inline'>('overlay');
  /** Requests that the host toggle its fullscreen overlay state for the map widget. */
  readonly dashboardFullscreenToggleRequested = output<void>();
  readonly shellElementId = `fluorescence-map-shell-${FluorescenceMapComponent.nextShellId++}`;
  readonly shellFullscreenSelector = `#${this.shellElementId}`;

  private readonly invalidLogoTokens = new Set(['string', 'null', 'undefined', '[object object]']);
  private addProjectPulseTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private tipsHintTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastFocusedElement: HTMLElement | null = null;
  private mapExpandedOwnsBodyOverflowLock = false;
  private mapExpandedPreviousBodyOverflow: string = '';
  private hasHydratedFromStorage = false;
  /**
   * Last external project value that was applied to local map filters.
   * Keeps external control one-way: only new external values resync the map.
   */
  private lastSyncedExternalProjectId: string | null | undefined = undefined;
  private readonly savedMapViewMode = signal<MapViewMode | null>(null);
  // Inject services
  private warRoomService = inject(WarRoomService);
  private authService = inject(AuthService);
  private appStateService = inject(AppStateService);
  private activityLogTableService = inject(ActivityLogTableService);
  private readonly currentUser = toSignal(this.authService.currentUser$, {
    initialValue: this.authService.currentUserValue,
  });
  private readonly appTheme = toSignal(this.appStateService.state$.pipe(map((state) => state.theme)), {
    initialValue: 'dark',
  });

  /** Restricted portal roles: hide Client View + edit/add controls. */
  readonly isClientOrUser = computed(() => {
    const role = (this.currentUser()?.role ?? '').toLowerCase().trim();
    return role === 'client' || role === 'user';
  });

  /** When set, the map UI is scoped to this signed-in client id (client/user roles only). */
  readonly pinnedClientId = computed(() => {
    if (!this.isClientOrUser()) return null;
    const raw = this.currentUser()?.clientId;
    const normalized = normalizeNumericLikeId(raw);
    return normalized ? normalized : null;
  });
  readonly isPinnedClientMode = computed(() => this.pinnedClientId() != null);
  readonly canSeeClientView = computed(() => !this.isClientOrUser());
  readonly canAddProject = computed(() => !this.isClientOrUser());
  readonly canEditWarRoom = computed(
    () => this.dataManagementMode() === 'edit' && !this.isClientOrUser()
  );
  private clientService = inject(ClientService);
  private projectService = inject(ProjectService);
  private locationService = inject(LocationService);
  private toastr = inject(ToastrService);
  private routePreviewStorage = inject(RoutePreviewStorageService);
  private projectWorkflow = inject(ProjectWorkflowService);
  private captureWorkflow = inject(CaptureWorkflowService);
  private panelActionsWorkflow = inject(PanelActionsWorkflowService);
  private mapRealtimeService = inject(MapRealtimeService);
  private mapPollingService = inject(MapPollingService);
  private dataManagementMutation = inject(DataManagementMutationService);
  private readonly envConfig = environment as RealtimeEnvironmentConfig;
  private readonly mapPollingIntervalMs = this.envConfig.mapPollingIntervalMs ?? 15000;
  private readonly mapDisconnectGraceMs = this.envConfig.mapDisconnectGraceMs ?? 10000;
  private pollingFallbackTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private pinnedLogModeInitialized = false;
  private readonly destroy$ = new Subject<void>();
  private readonly requiredReloadTrigger = signal(0);
  /** Tracks which requiredReloadTrigger we have already started ParentGroups load for (avoids duplicate in-flight requests). */
  private readonly parentGroupsLoadedForTrigger = signal(-1);
  readonly realtimeUiState = signal<RealtimeConnectionState>('disconnected');
  readonly realtimeStatusLabel = computed(() => {
    const state = this.realtimeUiState();
    if (state === 'connected') return 'Live updates';
    if (state === 'reconnecting') return 'Reconnecting...';
    if (state === 'polling') return 'Polling fallback';
    if (state === 'connecting') return 'Connecting...';
    return 'Realtime offline';
  });

  private readonly projectDeltaById = signal<Map<string, Partial<Project>>>(new Map());
  private readonly projectDeletedIds = signal<Set<string>>(new Set());
  private readonly clientDeltaById = signal<Map<string, Partial<Client>>>(new Map());
  private readonly clientDeletedIds = signal<Set<string>>(new Set());
  private readonly locationDeltaById = signal<Map<string, Partial<ApiLocation>>>(new Map());
  private readonly locationDeletedIds = signal<Set<string>>(new Set());
  private readonly manufacturerDeltaById = signal<Map<string, Partial<ManufacturerRuntimeRecord>>>(new Map());
  private readonly manufacturerDeletedIds = signal<Set<string>>(new Set());
  readonly clientsStatus = signal<EndpointStatus>('idle');
  readonly projectsStatus = signal<EndpointStatus>('idle');
  readonly manufacturersStatus = signal<EndpointStatus>('idle');
  readonly locationsStatus = signal<EndpointStatus>('idle');
  readonly parentGroupsStatus = signal<EndpointStatus>('idle');
  readonly endpointErrors = signal<Record<string, string | null>>({
    clients: null,
    projects: null,
    manufacturers: null,
    locations: null,
    parentGroups: null,
  });

  private setEndpointLoading(endpoint: 'clients' | 'projects' | 'manufacturers' | 'locations' | 'parentGroups'): void {
    if (endpoint === 'clients') this.clientsStatus.set('loading');
    if (endpoint === 'projects') this.projectsStatus.set('loading');
    if (endpoint === 'manufacturers') this.manufacturersStatus.set('loading');
    if (endpoint === 'locations') this.locationsStatus.set('loading');
    if (endpoint === 'parentGroups') this.parentGroupsStatus.set('loading');
    this.endpointErrors.update((e) => ({ ...e, [endpoint]: null }));
  }

  private setEndpointReady(endpoint: 'clients' | 'projects' | 'manufacturers' | 'locations' | 'parentGroups'): void {
    if (endpoint === 'clients') this.clientsStatus.set('ready');
    if (endpoint === 'projects') this.projectsStatus.set('ready');
    if (endpoint === 'manufacturers') this.manufacturersStatus.set('ready');
    if (endpoint === 'locations') this.locationsStatus.set('ready');
    if (endpoint === 'parentGroups') this.parentGroupsStatus.set('ready');
  }

  private setEndpointError(endpoint: 'clients' | 'projects' | 'manufacturers' | 'locations' | 'parentGroups', err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (endpoint === 'clients') this.clientsStatus.set('error');
    if (endpoint === 'projects') this.projectsStatus.set('error');
    if (endpoint === 'manufacturers') this.manufacturersStatus.set('error');
    if (endpoint === 'locations') this.locationsStatus.set('error');
    if (endpoint === 'parentGroups') this.parentGroupsStatus.set('error');
    this.endpointErrors.update((e) => ({ ...e, [endpoint]: msg }));
  }

  readonly hasRequiredEndpointError = computed(() =>
    this.clientsStatus() === 'error' ||
    this.projectsStatus() === 'error' ||
    this.manufacturersStatus() === 'error' ||
    this.locationsStatus() === 'error'
  );
  readonly requiredDataLoading = computed(() =>
    this.clientsStatus() === 'loading' ||
    this.projectsStatus() === 'loading' ||
    this.manufacturersStatus() === 'loading' ||
    this.locationsStatus() === 'loading'
  );
  readonly requiredDataReady = computed(() =>
    this.clientsStatus() === 'ready' &&
    this.projectsStatus() === 'ready' &&
    this.manufacturersStatus() === 'ready' &&
    this.locationsStatus() === 'ready'
  );
  readonly hasLoadedRequiredData = signal(false);
  /** True when map should receive node/route data: after required load or whenever we have filtered nodes (avoids blank map when filter is applied before hasLoadedRequiredData is set). */
  readonly shouldPassMapData = computed(
    () => this.hasLoadedRequiredData() || this.strictMapNodes().length > 0 || this.strictMapProjectRoutes().length > 0
  );
  readonly showBlockingRequiredDataLoading = computed(() =>
    this.requiredDataLoading() &&
    !this.hasRequiredEndpointError() &&
    !this.hasLoadedRequiredData()
  );
  readonly endpointErrorSummary = computed(() => {
    const errors = this.endpointErrors();
    const active = Object.entries(errors)
      .filter(([, value]) => !!value)
      .map(([key]) => key);
    if (active.length === 0) {
      return '';
    }
    const pretty = active.map((key) => key.charAt(0).toUpperCase() + key.slice(1));
    return `Affected endpoints: ${pretty.join(', ')}`;
  });

  readonly clientsSignal = toSignal(
    combineLatest([
      toObservable(this.requiredReloadTrigger).pipe(
        startWith(this.requiredReloadTrigger()),
        distinctUntilChanged(),
      ),
      toObservable(this.pinnedClientId).pipe(
        startWith(this.pinnedClientId()),
        distinctUntilChanged(),
      ),
    ]).pipe(
      tap(() => this.setEndpointLoading('clients')),
      switchMap(([, pinnedClientId]) => {
        const request$ = pinnedClientId
          ? this.clientService.getClientById(pinnedClientId).pipe(
            map((client) => (client ? [client] : [])),
          )
          : this.clientService.getClients();

        return request$.pipe(
          timeout(API_TIMEOUT_MS),
          tap(() => this.setEndpointReady('clients')),
          catchError((err) => {
            this.setEndpointError('clients', err);
            return EMPTY;
          }),
        );
      }),
    ),
    { initialValue: [] },
  );
  readonly projectsSignal = toSignal(
    toObservable(this.requiredReloadTrigger).pipe(
      startWith(0),
      tap(() => this.setEndpointLoading('projects')),
      switchMap(() =>
        this.projectService.getProjectsWithRefresh({}).pipe(
          timeout(PROJECTS_COMBINED_TIMEOUT_MS),
          tap(() => this.setEndpointReady('projects')),
          catchError((err) => {
            this.setEndpointError('projects', err);
            return EMPTY;
          })
        )
      )
    ),
    { initialValue: [] as Project[] }
  );
  readonly locationsSignal = toSignal(
    toObservable(this.requiredReloadTrigger).pipe(
      startWith(0),
      tap(() => this.setEndpointLoading('locations')),
      switchMap(() =>
        this.locationService.getAllLocations().pipe(
          timeout(API_TIMEOUT_MS),
          tap(() => this.setEndpointReady('locations')),
          catchError((err) => {
            this.setEndpointError('locations', err);
            return EMPTY;
          })
        )
      )
    ),
    { initialValue: [] }
  );
  readonly locationsById = computed(() => {
    const locations = this.effectiveLocations();
    const map = new Map<string, { name: string; latitude: number | null; longitude: number | null }>();
    for (const location of locations) {
      if (!location || location.id == null) continue;
      const locationId = this.normalizeEntityId(location.id);
      if (!locationId) continue;
      map.set(locationId, {
        name: location.name ?? '',
        latitude: coerceCoordinateValue(location.latitude),
        longitude: coerceCoordinateValue(location.longitude),
      });
    }
    return map;
  });
  readonly apiManufacturersSignal = toSignal(
    toObservable(this.requiredReloadTrigger).pipe(
      startWith(0),
      tap(() => this.setEndpointLoading('manufacturers')),
      switchMap(() =>
        this.projectService.getManufacturersForHierarchy().pipe(
          timeout(API_TIMEOUT_MS),
          switchMap((manufacturers) =>
            of(
              manufacturers.map((manufacturer) => ({
                id: manufacturer.id,
                name: manufacturer.manufacturerName,
                logo: this.sanitizeLogo(manufacturer.manufacturerLogo),
                locationId: manufacturer.primaryLocationId ?? manufacturer.locationId ?? null,
                locationIds: manufacturer.locationIds ?? [],
                locations: manufacturer.locations ?? [],
              })) as ManufacturerRuntimeRecord[]
            )
          ),
          tap(() => this.setEndpointReady('manufacturers')),
          catchError((err) => {
            this.setEndpointError('manufacturers', err);
            return EMPTY as Observable<ManufacturerRuntimeRecord[]>;
          })
        )
      )
    ),
    { initialValue: [] as ManufacturerRuntimeRecord[] }
  );
  readonly effectiveProjects = computed(() => {
    const merged = this.mergeEntitiesWithDelta<Project>(
      this.projectsSignal(),
      this.projectDeltaById(),
      this.projectDeletedIds(),
    );
    const pinnedClientId = this.pinnedClientId();
    if (!pinnedClientId) return merged;
    return merged.filter((project) => this.normalizeClientId(project.clientId) === pinnedClientId);
  });
  readonly effectiveClients = computed(() => {
    const merged = this.mergeEntitiesWithDelta<Client>(
      this.clientsSignal(),
      this.clientDeltaById(),
      this.clientDeletedIds(),
    );
    const pinnedClientId = this.pinnedClientId();
    if (!pinnedClientId) return merged;
    return merged.filter((client) => this.normalizeClientId(client.id) === pinnedClientId);
  });
  readonly effectiveLocations = computed(() =>
    this.mergeEntitiesWithDelta<ApiLocation>(
      this.locationsSignal() as ApiLocation[],
      this.locationDeltaById(),
      this.locationDeletedIds()
    )
  );
  /** Clients with coordinates resolved from location when missing (aligned with React reference app location fallback). */
  readonly effectiveClientsWithResolvedCoordinates = computed(() => {
    const clients = this.effectiveClients();
    const locationsById = this.locationsById();
    return clients.map((client) => {
      const direct = coerceCoordinates(client.coordinates?.latitude, client.coordinates?.longitude);
      if (direct) return { ...client, coordinates: direct };
      const locationId = this.normalizeEntityId(client.locationId);
      const loc = locationId ? locationsById.get(locationId) : null;
      const resolved = coerceCoordinates(loc?.latitude, loc?.longitude) ?? undefined;
      return resolved ? { ...client, coordinates: resolved } : { ...client, coordinates: undefined };
    });
  });
  readonly effectiveManufacturers = computed(() =>
    this.mergeEntitiesWithDelta<ManufacturerRuntimeRecord>(
      this.apiManufacturersSignal(),
      this.manufacturerDeltaById(),
      this.manufacturerDeletedIds()
    )
  );
  readonly projectTypesSignal = toSignal(this.projectService.getProjectTypes().pipe(catchError(() => of([]))), { initialValue: [] });
  readonly manufacturersSignal = toSignal(this.projectService.getManufacturers().pipe(catchError(() => of([]))), { initialValue: [] });
  private readonly clientOptionsSignalRaw = toSignal(this.projectService.getClientOptionsWithCounts().pipe(catchError(() => of([]))), { initialValue: [] });
  readonly clientOptionsSignal = computed(() => {
    const pinnedClientId = this.pinnedClientId();
    if (!pinnedClientId) return this.clientOptionsSignalRaw();
    const client = this.effectiveClients().find((c) => this.normalizeClientId(c.id) === pinnedClientId);
    return [{
      id: pinnedClientId,
      name: client?.name ?? pinnedClientId,
      count: this.effectiveProjects().length,
    }];
  });
  readonly manufacturerOptionsSignal = toSignal(this.projectService.getManufacturerOptionsWithCounts().pipe(catchError(() => of([]))), { initialValue: [] });
  private readonly projectTypeOptionsSignalRaw = toSignal(this.projectService.getProjectTypeOptionsWithCounts().pipe(catchError(() => of([]))), { initialValue: [] });
  readonly projectTypeOptionsSignal = computed(() => {
    const pinnedClientId = this.pinnedClientId();
    if (!pinnedClientId) return this.projectTypeOptionsSignalRaw();

    const byId = new Map<string, number>();
    for (const project of this.effectiveProjects()) {
      const type = (project.assessmentType ?? '').trim();
      if (!type) continue;
      byId.set(type, (byId.get(type) ?? 0) + 1);
    }

    return Array.from(byId.entries())
      .map(([id, count]) => ({ id, name: id, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
  private readonly projectOptionsSignalRaw = toSignal(this.projectService.getProjectOptionsWithCounts().pipe(catchError(() => of([]))), { initialValue: [] });
  readonly projectOptionsSignal = computed(() => {
    const pinnedClientId = this.pinnedClientId();
    if (!pinnedClientId) return this.projectOptionsSignalRaw();

    return this.effectiveProjects()
      .map((project) => ({
        id: String(project.id),
        name: project.projectName ?? String(project.id),
        count: 1,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
  readonly projectRoutes = signal<ProjectRoute[]>([]);
  /**
   * Optional external project filter (for host pages like Admin Dashboard).
   * `undefined` means uncontrolled (default map behavior/persistence).
   * `null` means clear external project filtering.
   */
  readonly externalProjectId = input<string | null | undefined>(undefined);
  readonly selectedProjectId = signal<string | null>(null);
  readonly selectedRouteId = signal<string | null>(null);
  readonly selectionOutsideFiltersNotice = signal<string | null>(null);
  /** When true, hide UI for clean route screenshot capture */
  readonly screenshotMode = signal(false);
  /** Increments when a route preview is saved; used to refresh thumbnails in panels */
  readonly routePreviewVersion = signal(0);
  readonly projectRoutesForMap = computed(() => {
    const viewMode = this.mapViewMode();
    const effectiveViewMode = viewMode === 'manufacturer' && this.isPinnedClientMode()
      ? 'project'
      : viewMode;
    const routes = selectProjectRoutesForMap(
      effectiveViewMode,
      this.projectRoutes(),
      this.selectedProjectId()
    );
    const selectedRegions = this.filterApplied().regions;
    if (selectedRegions.length === 0) {
      return routes;
    }
    return routes.filter((route) => this.matchesRegionsForRoute(route, selectedRegions));
  });

  readonly filtersActiveStrict = computed(() => {
    const filters = this.filterApplied();
    return filters.projectIds.length > 0
      || filters.clientIds.length > 0
      || filters.manufacturerIds.length > 0
      || filters.projectTypeIds.length > 0
      || filters.regions.length > 0
      || filters.status !== 'all';
  });

  readonly filteredProjectRoutesStrict = computed(() =>
    selectFilteredProjectRoutesStrict(this.projectRoutes(), this.filterApplied(), {
      getRegionForNodeId: (nodeId: string) => this.getRegionForNodeIdStrict(nodeId),
      getClientIdForProjectId: (projectId: string) => this.projectClientIdByProjectId().get(projectId) ?? null,
      getManufacturerIdsForNodeId: (nodeId: string) => {
        const manufacturerIds = new Set<string>();
        this.buildEndpointIdVariants(nodeId).forEach((candidate) => {
          const matches = this.manufacturerIdsByNodeId().get(candidate);
          if (!matches) return;
          matches.forEach((manufacturerId) => manufacturerIds.add(manufacturerId));
        });
        return Array.from(manufacturerIds.values());
      },
    })
  );

  readonly derivedNodeIdsStrict = computed(() =>
    selectDerivedNodeIdsFromRoutes(this.filteredProjectRoutesStrict())
  );

  readonly filteredNodesStrict = computed(() =>
    selectFilteredNodesStrict(this.nodesWithClients(), this.derivedNodeIdsStrict().allNodeIds)
  );

  readonly mapViewModelStrict = computed<MapViewModelStrict>(() =>
    selectMapViewModelStrict({
      mode: this.mapViewMode(),
      filteredRoutes: this.filteredProjectRoutesStrict(),
      filteredNodes: this.filteredNodesStrict(),
      derivedNodeIds: this.derivedNodeIdsStrict(),
      filtersActive: this.filtersActiveStrict(),
    })
  );

  readonly strictMapNodes = computed(() => this.mapViewModelStrict().markers.map((marker) => marker.node));
  readonly strictMapProjectRoutes = computed(() => this.mapViewModelStrict().routes.map((route) => route.route));

  /** True when a client is selected and has at least one route to capture. */
  readonly hasSelectedClientWithRoutes = computed(() => {
    const selection = this.selectedEntity();
    const routes = this.projectRoutes();
    const selectedClientId = selection?.level === 'client' ? this.normalizeClientId(selection.id) : null;
    return !!selectedClientId && routes.some((r) => this.normalizeClientId(r.fromNodeId) === selectedClientId);
  });

  readonly projectStatusByFactoryId = computed(() => {
    const projects = this.effectiveProjects();
    const map = new Map<string, 'active' | 'inactive' | 'none'>();
    for (const p of projects) {
      const fid = p.manufacturerLocationId;
      if (!fid) continue;
      const st = p.status ?? 'Open';
      const current = map.get(fid);
      if (st === 'Open') {
        map.set(fid, 'active');
      } else if (current !== 'active') {
        map.set(fid, 'inactive');
      }
    }
    return map;
  });

  // Signals from service
  readonly nodes = this.warRoomService.nodes;
  readonly activityLogs = this.warRoomService.activityLogs;
  readonly networkMetrics = this.warRoomService.networkMetrics;
  readonly parentGroups = this.warRoomService.parentGroups;
  readonly subsidiaries = this.warRoomService.subsidiaries;
  readonly manufacturerLocations = this.warRoomService.manufacturerLocations;
  /** @deprecated Use manufacturerLocations */
  readonly factories = this.warRoomService.factories;
  readonly mapViewMode = this.warRoomService.mapViewMode;
  readonly transitRoutes = this.warRoomService.transitRoutes;
  readonly selectedEntity = this.warRoomService.selectedEntity;
  readonly selectedSubsidiary = this.warRoomService.selectedSubsidiary;
  readonly isDarkTheme = computed(() => this.appTheme() !== 'light');
  readonly totalProjectsCount = computed(() => this.effectiveProjects().length);
  readonly totalShippedCount = computed(() =>
    this.effectiveProjects().filter((project) => this.normalizeProjectStatus(project) === 'Closed').length
  );
  readonly underInspectionCount = computed(() =>
    this.effectiveProjects().filter((project) => this.normalizeProjectStatus(project) === 'Delayed').length
  );

  // Screen reader announcement message
  readonly announcementMessage = signal<string>('');

  /** Visible status for TestSprite marker stability assertions - shown after zoom idle */
  readonly markerStabilityMessage = signal<string>('');

  // Overlay panel + expand state
  readonly panelVisible = signal<boolean>(false);
  readonly mapExpanded = signal<boolean>(false);
  /** True when map is in browser fullscreen (used for Expand Map button state when expandMapTriggersBrowserFullscreen). */
  readonly mapBrowserFullscreenActive = signal<boolean>(false);
  /** True when Expand Map shows "expanded" (local expand or browser fullscreen when expandMapTriggersBrowserFullscreen). */
  readonly expandButtonActive = computed(
    () =>
      this.mapExpanded() ||
      (this.expandMapTriggersBrowserFullscreen() && this.mapBrowserFullscreenActive())
  );

  /** Legacy table mode state retained for compatibility with existing tests and service flows. */
  readonly logPanelMode = signal<'client' | 'manufacturer'>('manufacturer');

  // Activity log visibility - hidden by default (edit mode only)
  readonly activityLogEditMode = signal<boolean>(false);

  // Add company modal (over map)
  readonly addCompanyModalVisible = signal<boolean>(false);
  readonly addCompanyModalPreselectedManufacturerLocationId = signal<string | null>(null);
  /** @deprecated Use addCompanyModalPreselectedManufacturerLocationId */
  readonly addCompanyModalPreselectedFactoryId = this.addCompanyModalPreselectedManufacturerLocationId;

  // Filters panel state
  readonly filtersPanelVisible = signal<boolean>(false);
  readonly filterDraft = signal<WarRoomFilters>(createDefaultFilters());
  readonly filterApplied = signal<WarRoomFilters>(createDefaultFilters());
  private readonly activityRowOverrides = signal<Map<string, Partial<ActivityLogRow>>>(new Map());
  private readonly tableProjectionData = computed(() => {
    const projectVms: ProjectVm[] = this.effectiveProjects().map((project) => {
      const projectLocationIdsRaw =
        (project as Project & { locationIds?: unknown[] }).locationIds ?? [];
      const projectLocationIds = Array.isArray(projectLocationIdsRaw)
        ? this.parseLocationIds(projectLocationIdsRaw)
        : [];

      return {
        ...(projectLocationIds.length
          ? { locationIds: projectLocationIds }
          : this.normalizeEntityId(project.locationId)
            ? { locationIds: this.parseLocationIds([project.locationId]) }
            : {}),
        id: String(project.id),
        projectName: project.projectName ?? String(project.id),
        clientId: this.normalizeClientId(project.clientId) ?? '',
        clientName: project.clientName ?? '',
        assessmentType: project.assessmentType ?? null,
        projectTypeId: project.projectTypeId != null ? String(project.projectTypeId) : null,
        manufacturerLocationId: project.manufacturerLocationId ?? null,
        locationId: project.locationId != null ? String(project.locationId) : null,
        locationName: project.location ?? null,
        manufacturerName: project.manufacturer ?? null,
        status: this.normalizeProjectStatus(project),
        lastUpdate: project.lastUpdate ?? null,
        closed: project.closed ?? null,
        contract: this.readProjectContract(project),
        hasRoadTest: this.readProjectRoadTest(project),
      };
    });
    const clientVms: ClientVm[] = this.effectiveClients().map((client) => ({
      id: this.normalizeClientId(client.id) ?? String(client.id),
      name: client.name ?? String(client.id),
      locationId: this.normalizeEntityId(client.locationId),
      latitude: client.coordinates?.latitude ?? null,
      longitude: client.coordinates?.longitude ?? null,
    }));
    const locationVms: LocationVm[] = this.effectiveLocations().map((location) => ({
      id: this.normalizeEntityId(location.id) ?? String(location.id),
      name: location.name ?? String(location.id),
      latitude: coerceCoordinateValue(location.latitude),
      longitude: coerceCoordinateValue(location.longitude),
    }));
    const locationVmById = new Map(locationVms.map((location) => [location.id, location]));
    const manufacturerVms: ManufacturerVm[] = this.effectiveManufacturers().map((manufacturer) => {
      const locationId = this.normalizeEntityId(manufacturer.locationId);
      const linkedLocation = locationId ? locationVmById.get(locationId) : null;
      const locationIds = this.parseLocationIds([
        ...(manufacturer.locationIds ?? []),
        manufacturer.locationId ?? null,
      ]);
      return {
        id: String(manufacturer.id),
        name: manufacturer.name ?? String(manufacturer.id),
        locationId,
        locationIds,
        latitude: linkedLocation?.latitude ?? null,
        longitude: linkedLocation?.longitude ?? null,
      };
    });

    return { projectVms, clientVms, manufacturerVms, locationVms };
  });
  readonly draftHasChanges = computed(() => !this.filtersEqual(this.filterDraft(), this.filterApplied()));
  readonly draftResultCount = computed(() => this.buildActivityProjectionRows(this.filterDraft()).length);
  readonly activityTableRows = computed<ActivityLogRow[]>(() => {
    const baseRows = this.buildActivityProjectionRows(this.filterApplied());
    const overrides = this.activityRowOverrides();
    if (overrides.size === 0) {
      return baseRows;
    }
    return baseRows.map((row) => {
      const patch = overrides.get(row.id);
      return patch ? { ...row, ...patch } : row;
    });
  });
  readonly clientTableRows = computed<ClientManagementRow[]>(() => {
    const projectCountByClient = new Map<string, number>();
    for (const project of this.effectiveProjects()) {
      const clientId = this.normalizeClientId(project.clientId) ?? '';
      if (!clientId) continue;
      projectCountByClient.set(clientId, (projectCountByClient.get(clientId) ?? 0) + 1);
    }
    const locationById = this.locationsById();

    return this.effectiveClients()
      .map((client) => {
        const clientId = this.normalizeClientId(client.id) ?? String(client.id);
        const locationId = this.normalizeEntityId(client.locationId);
        const locationIds = this.parseLocationIds([
          ...(client.locationIds ?? []),
          client.locationId ?? null,
        ]);
        const location = locationId ? locationById.get(locationId) : null;
        const linkedLocations = locationIds
          .map((id) => {
            const linked = locationById.get(String(id));
            if (!linked) return null;
            return { id, name: linked.name };
          })
          .filter((value): value is { id: number; name: string } => !!value);
        return {
          id: `client-${clientId}`,
          clientId,
          clientName: client.name ?? clientId,
          locationIds,
          linkedLocations,
          locationId,
          locationName: location?.name ?? '',
          latitude: client.coordinates?.latitude ?? location?.latitude ?? null,
          longitude: client.coordinates?.longitude ?? location?.longitude ?? null,
          projectCount: projectCountByClient.get(clientId) ?? 0,
        } satisfies ClientManagementRow;
      })
      .sort((a, b) => a.clientName.localeCompare(b.clientName));
  });
  readonly manufacturerTableRows = computed<ManufacturerManagementRow[]>(() => {
    const pinnedClientId = this.pinnedClientId();
    const allowedLocationIds = new Set<string>();
    const allowedManufacturerNames = new Set<string>();
    if (pinnedClientId) {
      for (const project of this.effectiveProjects()) {
        const locationId = this.normalizeEntityId(project.manufacturerLocationId ?? project.locationId);
        if (locationId) allowedLocationIds.add(locationId);
        const manufacturerName = (project.manufacturer ?? '').trim();
        if (manufacturerName) {
          allowedManufacturerNames.add(this.normalizeManufacturerFilterName(manufacturerName));
        }
      }
    }
    const locationById = this.locationsById();

    return this.effectiveManufacturers()
      .map((manufacturer) => {
        const manufacturerId = String(manufacturer.id);
        const locationId = this.normalizeEntityId(manufacturer.locationId);
        const locationIds = this.parseLocationIds([
          ...(manufacturer.locationIds ?? []),
          manufacturer.locationId ?? null,
        ]);
        const location = locationId ? locationById.get(locationId) : null;
        const linkedLocations = locationIds
          .map((id) => {
            const linked = locationById.get(String(id));
            if (!linked) return null;
            return { id, name: linked.name };
          })
          .filter((value): value is { id: number; name: string } => !!value);
        return {
          id: `manufacturer-${manufacturerId}`,
          manufacturerId,
          manufacturerName: manufacturer.name ?? manufacturerId,
          locationIds,
          linkedLocations,
          locationId,
          locationName: location?.name ?? '',
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
        } satisfies ManufacturerManagementRow;
      })
      .filter((row) => {
        if (!pinnedClientId) return true;
        if (row.locationId && allowedLocationIds.has(row.locationId)) return true;
        return allowedManufacturerNames.has(this.normalizeManufacturerFilterName(row.manufacturerName));
      })
      .sort((a, b) => a.manufacturerName.localeCompare(b.manufacturerName));
  });
  readonly locationTableRows = computed<LocationManagementRow[]>(() => {
    const pinnedClientId = this.pinnedClientId();
    const allowedLocationIds = new Set<string>();
    if (pinnedClientId) {
      for (const project of this.effectiveProjects()) {
        const locationId = this.normalizeEntityId(project.locationId ?? project.manufacturerLocationId);
        if (locationId) allowedLocationIds.add(locationId);
      }
      for (const client of this.effectiveClients()) {
        const clientLocationId = this.normalizeEntityId(client.locationId);
        if (clientLocationId) allowedLocationIds.add(clientLocationId);
      }
    }

    return this.effectiveLocations()
      .map((location) => {
        const locationId = String(location.id);
        return {
          id: `location-${locationId}`,
          locationId,
          locationName: location.name ?? locationId,
          latitude: location.latitude ?? null,
          longitude: location.longitude ?? null,
        } satisfies LocationManagementRow;
      })
      .filter((row) => !pinnedClientId || allowedLocationIds.has(this.normalizeEntityId(row.locationId) ?? row.locationId))
      .sort((a, b) => a.locationName.localeCompare(b.locationName));
  });
  readonly expandedFilterSection = signal<'client' | 'manufacturer' | 'projectType' | 'project' | null>(null);
  readonly clientFilterSearch = signal('');
  readonly manufacturerFilterSearch = signal('');
  readonly projectTypeFilterSearch = signal('');
  readonly projectFilterSearch = signal('');
  readonly showUnavailableClients = signal(false);
  readonly showUnavailableManufacturers = signal(false);
  readonly showUnavailableProjectTypes = signal(false);
  readonly showUnavailableProjects = signal(false);
  readonly tacticalMode = signal<boolean>(false);

  /** First-visit pulse on Add Project button for discoverability */
  readonly addProjectPulse = signal<boolean>(false);

  /** First-time onboarding hint for key controls */
  readonly showTipsHint = signal<boolean>(false);

  /** Show "Return to previous view" button after auto-zoom to entity */
  readonly showReturnToPreviousView = signal<boolean>(false);
  private returnToPreviousViewTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /** Clients that have at least one project, for the Client view in the activity log panel */
  readonly clientsWithProjects = computed(() => {
    const options = this.clientOptionsSignal();
    const clients = this.effectiveClients();
    return options.map((opt) => {
      const client = clients.find((c) => this.normalizeClientId(c.id) === this.normalizeClientId(opt.id));
      return {
        id: this.normalizeClientId(opt.id) ?? opt.id,
        name: client?.name ?? opt.name,
        code: client?.code,
        logoUrl: client?.logoUrl,
        projectCount: opt.count,
      };
    });
  });
  readonly clientsById = computed(() => {
    const clients = this.effectiveClientsWithResolvedCoordinates();
    const map = new Map<string, { id: string; name: string; latitude: number | null; longitude: number | null }>();
    for (const client of clients) {
      const clientId = this.normalizeClientId(client.id);
      if (!clientId) continue;
      map.set(clientId, {
        id: clientId,
        name: client.name,
        latitude: client.coordinates?.latitude ?? null,
        longitude: client.coordinates?.longitude ?? null,
      });
    }
    return map;
  });
  readonly manufacturersById = computed(() => {
    const map = new Map<string, { id: string; name: string; locationId: string | number | null; locationIds: number[] }>();
    for (const manufacturer of this.effectiveManufacturers()) {
      const locationIds = Array.from(
        new Set<number>(
          [...(manufacturer.locationIds ?? []), manufacturer.locationId ?? null]
            .map((value) => Number.parseInt(String(value ?? ''), 10))
            .filter((value) => Number.isFinite(value))
        )
      );
      map.set(String(manufacturer.id), {
        id: String(manufacturer.id),
        name: manufacturer.name ?? String(manufacturer.id),
        locationId: manufacturer.locationId ?? null,
        locationIds,
      });
    }
    return map;
  });
  readonly projectClientIdByProjectId = computed(() => {
    const map = new Map<string, string>();
    for (const project of this.effectiveProjects()) {
      const projectId = String(project.id ?? '').trim();
      const clientId = this.normalizeClientId(project.clientId);
      if (!projectId || !clientId) continue;
      map.set(projectId, clientId);
    }
    return map;
  });
  readonly manufacturerIdsByNodeId = computed(() => {
    const map = new Map<string, Set<string>>();
    const addMapping = (nodeKey: string, manufacturerId: string): void => {
      if (!nodeKey || !manufacturerId) return;
      const entry = map.get(nodeKey);
      if (entry) {
        entry.add(manufacturerId);
        return;
      }
      map.set(nodeKey, new Set([manufacturerId]));
    };

    for (const manufacturer of this.manufacturersById().values()) {
      const manufacturerId = String(manufacturer.id ?? '').trim();
      if (!manufacturerId) continue;
      addMapping(manufacturerId, manufacturerId);

      const locationKeys = new Set<string>();
      if (manufacturer.locationId != null) {
        locationKeys.add(String(manufacturer.locationId).trim());
      }
      manufacturer.locationIds.forEach((locationId) => locationKeys.add(String(locationId).trim()));

      locationKeys.forEach((locationKey) => {
        this.buildEndpointIdVariants(locationKey).forEach((variant) => addMapping(variant, manufacturerId));
      });
    }

    return map;
  });
  readonly filteredClientOptions = computed(() => {
    const term = this.clientFilterSearch().trim().toLowerCase();
    const showUnavailable = this.showUnavailableClients();
    const options = this.clientOptionsSignal();
    return options.filter((option) => {
      if (!showUnavailable && (option.count ?? 0) <= 0) return false;
      if (!term) return true;
      return option.name.toLowerCase().includes(term);
    });
  });
  readonly hiddenClientOptionsCount = computed(() => {
    const term = this.clientFilterSearch().trim().toLowerCase();
    return this.clientOptionsSignal().filter((option) => {
      const matchesTerm = !term || option.name.toLowerCase().includes(term);
      return matchesTerm && (option.count ?? 0) <= 0;
    }).length;
  });
  readonly filteredManufacturerOptions = computed(() => {
    const term = this.manufacturerFilterSearch().trim().toLowerCase();
    const showUnavailable = this.showUnavailableManufacturers();
    const options = this.manufacturerOptionsSignal();
    return options.filter((option) => {
      if (!showUnavailable && (option.count ?? 0) <= 0) return false;
      if (!term) return true;
      return option.name.toLowerCase().includes(term);
    });
  });
  readonly hiddenManufacturerOptionsCount = computed(() => {
    const term = this.manufacturerFilterSearch().trim().toLowerCase();
    return this.manufacturerOptionsSignal().filter((option) => {
      const matchesTerm = !term || option.name.toLowerCase().includes(term);
      return matchesTerm && (option.count ?? 0) <= 0;
    }).length;
  });
  readonly filteredProjectTypeOptions = computed(() => {
    const term = this.projectTypeFilterSearch().trim().toLowerCase();
    const showUnavailable = this.showUnavailableProjectTypes();
    const options = this.projectTypeOptionsSignal();
    return options.filter((option) => {
      if (!showUnavailable && (option.count ?? 0) <= 0) return false;
      if (!term) return true;
      return option.name.toLowerCase().includes(term);
    });
  });
  readonly hiddenProjectTypeOptionsCount = computed(() => {
    const term = this.projectTypeFilterSearch().trim().toLowerCase();
    return this.projectTypeOptionsSignal().filter((option) => {
      const matchesTerm = !term || option.name.toLowerCase().includes(term);
      return matchesTerm && (option.count ?? 0) <= 0;
    }).length;
  });
  readonly filteredProjectOptions = computed(() => {
    const term = this.projectFilterSearch().trim().toLowerCase();
    const showUnavailable = this.showUnavailableProjects();
    const options = this.projectOptionsSignal();
    return options.filter((option) => {
      if (!showUnavailable && (option.count ?? 0) <= 0) return false;
      if (!term) return true;
      return option.name.toLowerCase().includes(term);
    });
  });
  readonly hiddenProjectOptionsCount = computed(() => {
    const term = this.projectFilterSearch().trim().toLowerCase();
    return this.projectOptionsSignal().filter((option) => {
      const matchesTerm = !term || option.name.toLowerCase().includes(term);
      return matchesTerm && (option.count ?? 0) <= 0;
    }).length;
  });

  readonly availableRegions = computed(() => {
    return selectAvailableRegions(this.factories(), (factory) =>
      this.getRegionForFactory(factory as FactoryLocation)
    );
  });

  /** Nodes merged with client nodes: clients in routes OR clients with projects (for pan-to-client fallback).
   * In Client view, always show all clients with coordinates (resolved from location when missing). */
  readonly nodesWithClients = computed(() => {
    return selectNodesWithClients(
      this.nodes(),
      this.effectiveClientsWithResolvedCoordinates(),
      this.projectRoutes(),
      this.clientOptionsSignal(),
      this.mapViewMode(),
      this.filterApplied().clientIds
    );
  });

  private readonly nodeLookup = computed(() => {
    const nodeMap = new Map<string, Node>();
    this.nodesWithClients().forEach((node) => {
      nodeMap.set(node.id, node);
      const manufacturerLocationId = node.manufacturerLocationId ?? node.factoryId;
      if (manufacturerLocationId) nodeMap.set(manufacturerLocationId, node);
      if (node.subsidiaryId) nodeMap.set(node.subsidiaryId, node);
      if (node.parentGroupId) nodeMap.set(node.parentGroupId, node);
      const normalizedClientId = this.normalizeClientId(node.clientId);
      if (normalizedClientId) nodeMap.set(normalizedClientId, node);
    });
    return nodeMap;
  });

  readonly activeFilterCount = computed(() => {
    const filters = this.filterApplied();
    if (!this.isPinnedClientMode()) {
      return selectActiveFilterCount(filters);
    }
    return selectActiveFilterCount({ ...filters, clientIds: [] });
  });

  readonly activeFilters = computed<ActiveFilterItem[]>(() => {
    const items = selectActiveFilters(
      this.filterApplied(),
      this.effectiveClients(),
      this.effectiveProjects(),
      this.projectOptionsSignal(),
      this.manufacturerOptionsSignal(),
      this.projectTypeOptionsSignal()
    );

    if (!this.isPinnedClientMode()) {
      return items;
    }

    return items.filter((item) => item.type !== 'client');
  });

  readonly statusCounts = computed(() => {
    return selectStatusCounts(this.effectiveProjects());
  });
  readonly effectiveStatusFilter = computed<FilterStatus>(() => {
    return this.mapViewMode() === 'manufacturer' ? 'all' : this.filterApplied().status;
  });

  readonly filteredNodes = computed(() => {
    const filters = this.filterApplied();
    const normalizedClientFilterIds = new Set(this.normalizeClientIdList(filters.clientIds));
    const nodes = this.nodesWithClients();
    const selected = this.selectedEntity();
    const viewMode = this.mapViewMode();
    const status = this.effectiveStatusFilter();
    const routes = this.projectRoutesForMap();
    const routesForTargeting = viewMode === 'project' ? routes : this.projectRoutes();
    const routesLoading = this.projectRoutesLoading();
    const pinnedClientId = this.pinnedClientId();
    const hasRouteBasedProjectFilters =
      normalizedClientFilterIds.size > 0 ||
      filters.projectTypeIds.length > 0 ||
      filters.projectIds.length > 0;
    const hasManufacturerFilters = filters.manufacturerIds.length > 0;
    const hasProjectFilters = hasRouteBasedProjectFilters || hasManufacturerFilters;
    const selectedManufacturerKeys = new Set(
      filters.manufacturerIds
        .map((id) => this.normalizeManufacturerFilterName(id))
        .filter((id) => !!id)
    );
    const selectedManufacturerSubsidiaryIds = this.getSelectedManufacturerSubsidiaryIds(
      selectedManufacturerKeys
    );
    const shouldUseRouteFilterInManufacturerView = status !== 'all' || hasRouteBasedProjectFilters;
    const shouldUseRouteFilterInNonManufacturerView = status !== 'all' || hasProjectFilters;
    const useProjectRouteFilter =
      viewMode === 'project' ||
      (viewMode === 'manufacturer'
        ? shouldUseRouteFilterInManufacturerView
        : shouldUseRouteFilterInNonManufacturerView);
    const routeTargetIds = useProjectRouteFilter ? new Set(routesForTargeting.map((r) => r.toNodeId)) : null;
    const enforceRouteTargets = !!routeTargetIds && routeTargetIds.size > 0;

    // Client view: only client nodes, no factories or project routes.
    // Compare IDs with String() so filter works whether API returns number or string (aligned with
    // fleetpulse-map-dashboard React app, which normalizes ids via toId() at API boundary).
    if (viewMode === 'client') {
      const clientNodes = nodes
        .filter((n) => n.level === 'client')
        .filter((n) => {
          if (normalizedClientFilterIds.size > 0) {
            const nodeIdNorm = this.normalizeClientId(n.id);
            const match = !!nodeIdNorm && normalizedClientFilterIds.has(nodeIdNorm);
            if (!match) return false;
          }
          return true;
        });
      return clientNodes;
    }

    const result = nodes.filter((node) => {
      // Client nodes: visible in project view, factory view, or when client filter is active
      if (node.level === 'client') {
        const normalizedNodeClientId = this.normalizeClientId(node.id);
        if (pinnedClientId != null && normalizedNodeClientId !== pinnedClientId) {
          return false;
        }
        if (viewMode === 'manufacturer') {
          return pinnedClientId != null && normalizedNodeClientId === pinnedClientId;
        }
        if (viewMode === 'project' && routes.length > 0) {
          const clientIdsInRoutes = new Set(
            routes
              .map((r) => this.normalizeClientId(r.fromNodeId))
              .filter((id): id is string => !!id)
          );
          return !!normalizedNodeClientId && clientIdsInRoutes.has(normalizedNodeClientId);
        }
        return viewMode === 'project' || viewMode === 'factory' || normalizedClientFilterIds.size > 0;
      }

      if (viewMode === 'manufacturer') {
        // In manufacturer view, route-backed filters (client/project/project type) should narrow visible manufacturers.
        if (routeTargetIds !== null) {
          if (routeTargetIds.size > 0 && !this.nodeMatchesRouteTargets(node, routeTargetIds)) {
            return false;
          }
        }

        // Manufacturer checkboxes additionally constrain the already route-filtered set.
        if (selectedManufacturerKeys.size > 0) {
          let manufacturerMatch = false;

          if (node.level === 'parent') {
            const group = this.parentGroups().find((g) => g.id === node.id || g.id === node.companyId);
            const subsidiaries = group?.subsidiaries ?? [];
            manufacturerMatch = subsidiaries.some((sub) => selectedManufacturerSubsidiaryIds.has(sub.id));
          } else {
            const nodeSubsidiaryId =
              node.subsidiaryId ??
              (node.level === 'subsidiary' ? node.id : undefined) ??
              node.companyId;

            manufacturerMatch = !!nodeSubsidiaryId && selectedManufacturerSubsidiaryIds.has(nodeSubsidiaryId);
            if (!manufacturerMatch) {
              // Fallback to direct name match when a node lacks subsidiary linkage.
              const fallbackName = node.company ?? node.name;
              manufacturerMatch = selectedManufacturerKeys.has(
                this.normalizeManufacturerFilterName(fallbackName)
              );
            }
          }

          if (!manufacturerMatch) {
            return false;
          }
        }

        return true;
      }

      // When project filters are active or in project view, only show nodes that appear in filtered project routes.
      // Factory nodes: node.id = factory id. Subsidiary nodes: node.id = subsidiary id (routeTargetIds has factory ids).
      // Parent nodes: node.id = parent group id. Must check if any child factory is in routeTargetIds.
      if (routeTargetIds !== null) {
        if (viewMode === 'project' && routeTargetIds.size === 0) {
          // When routes are loading with client filter, don't hide factory nodes yet - allow them to show until fetch completes
          if (routesLoading && hasProjectFilters) return true;
          // In project view with no routes (and not loading), hide all factory/subsidiary/parent nodes
          return false;
        }
        if (enforceRouteTargets) {
          const matches = this.nodeMatchesRouteTargets(node, routeTargetIds);
          if (!matches) {
            return false;
          }
        } else if (hasProjectFilters) {
          // No matching project routes while project filters are active.
          return false;
        }
      }

      // When status is active/inactive, we filter by project status; nodes are restricted by routeTargetIds.
      // When status is 'all', filter by factory operational status.
      const shouldApplyOperationalStatus =
        status === 'all' || (!enforceRouteTargets && !hasProjectFilters);
      const statusMatch = shouldApplyOperationalStatus
        ? this.matchesStatus(node.status, status)
        : true;
      const regionMatch = this.matchesRegionsForNode(node, filters.regions);

      return statusMatch && regionMatch;
    });

    const keepSelectedVisible =
      !(viewMode === 'manufacturer' && selectedManufacturerKeys.size > 0);
    return keepSelectedVisible ? this.ensureSelectedNodeVisible(result, nodes, selected) : result;
  });

  private hasUsableParentGroupHierarchy(groups: ParentGroup[]): boolean {
    return groups.some((group) =>
      (group.subsidiaries ?? []).some((subsidiary) =>
        (subsidiary.manufacturerLocations ?? subsidiary.factories ?? []).some((location) =>
          isValidCoordinates(location.coordinates)
        )
      )
    );
  }

  private normalizeManufacturerFilterName(name: string): string {
    return (name ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(
        /\b(incorporated|inc|corporation|corp|company|co|limited|ltd|llc|gmbh|ag|plc)\b/g,
        ' '
      )
      .replace(/\s+/g, ' ');
  }

  private manufacturerNamesEquivalent(a: string, b: string): boolean {
    const normalizedA = this.normalizeManufacturerFilterName(a);
    const normalizedB = this.normalizeManufacturerFilterName(b);
    if (!normalizedA || !normalizedB) return false;
    if (normalizedA === normalizedB) return true;
    if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return true;

    const tokensA = new Set(normalizedA.split(' ').filter((token) => !!token));
    const tokensB = new Set(normalizedB.split(' ').filter((token) => !!token));
    if (tokensA.size === 0 || tokensB.size === 0) return false;

    let overlap = 0;
    tokensA.forEach((token) => {
      if (tokensB.has(token)) overlap += 1;
    });

    const minimumOverlap = tokensA.size === 1 || tokensB.size === 1 ? 1 : 2;
    return overlap >= minimumOverlap;
  }

  private getSelectedManufacturerSubsidiaryIds(selectedManufacturerKeys: Set<string>): Set<string> {
    if (selectedManufacturerKeys.size === 0) return new Set<string>();
    return new Set(
      this.enrichedParentGroups()
        .flatMap((group) => group.subsidiaries ?? [])
        .filter((subsidiary) => {
          const normalizedSubsidiaryName = this.normalizeManufacturerFilterName(subsidiary.name);
          return Array.from(selectedManufacturerKeys).some((selectedKey) =>
            this.manufacturerNamesEquivalent(selectedKey, normalizedSubsidiaryName)
          );
        })
        .map((subsidiary) => subsidiary.id)
    );
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

  private routeTargetSetHasCandidate(routeTargetIds: Set<string>, candidateId: string | null | undefined): boolean {
    if (!candidateId) return false;
    const variants = this.buildEndpointIdVariants(candidateId);
    return variants.some((variant) => routeTargetIds.has(variant));
  }

  /** True if node (factory/manufacturer or parent) has at least one factory in routeTargetIds */
  private nodeMatchesRouteTargets(node: Node, routeTargetIds: Set<string>): boolean {
    if (node.level === 'factory' || node.level === 'manufacturer') {
      return (
        this.routeTargetSetHasCandidate(routeTargetIds, node.id) ||
        this.routeTargetSetHasCandidate(routeTargetIds, node.manufacturerLocationId) ||
        this.routeTargetSetHasCandidate(routeTargetIds, node.factoryId)
      );
    }
    if (node.level === 'parent') {
      const group = this.parentGroups().find((g) => g.id === node.id);
      const factoryIds = group?.subsidiaries?.flatMap((s) => (s.factories ?? []).map((f) => f.id)) ?? [];
      return factoryIds.some((id) => this.routeTargetSetHasCandidate(routeTargetIds, id));
    }
    return (
      this.routeTargetSetHasCandidate(routeTargetIds, node.id) ||
      this.routeTargetSetHasCandidate(routeTargetIds, node.manufacturerLocationId) ||
      this.routeTargetSetHasCandidate(routeTargetIds, node.factoryId)
    );
  }

  /** Keep the actively selected entity visible even when route/project filters are narrowing map nodes. */
  private ensureSelectedNodeVisible(
    visibleNodes: Node[],
    allNodes: Node[],
    selection: FleetSelection | null
  ): Node[] {
    if (!selection) return visibleNodes;
    const selectedNode = allNodes.find((node) => this.nodeMatchesSelection(node, selection));
    if (!selectedNode) return visibleNodes;
    if (visibleNodes.some((node) => node.id === selectedNode.id)) return visibleNodes;
    return [...visibleNodes, selectedNode];
  }

  private nodeMatchesSelection(node: Node, selection: FleetSelection): boolean {
    const selectedLocationId = selection.manufacturerLocationId ?? selection.factoryId ?? selection.id;

    if (selection.level === 'client') {
      return (
        node.clientId === selection.id ||
        (node.level === 'client' && (node.id === selection.id || node.companyId === selection.id))
      );
    }

    if (selection.level === 'parent') {
      return node.id === selection.id || node.companyId === selection.id;
    }

    return (
      node.id === selection.id ||
      node.companyId === selection.id ||
      node.manufacturerLocationId === selectedLocationId ||
      node.factoryId === selectedLocationId
    );
  }

  /** Match subsidiary name to API manufacturer for enrichment. Returns name and logo when matched. */
  private matchSubsidiaryToManufacturer(
    subsidiaryName: string,
    apiManufacturers: { name: string; logo?: string }[]
  ): { name: string; logo?: string } | null {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const subNorm = norm(subsidiaryName);
    if (!subNorm) return null;
    for (const m of apiManufacturers) {
      const apiNorm = norm(m.name);
      if (!apiNorm) continue;
      if (subNorm === apiNorm) return { name: m.name, logo: m.logo };
      if (subNorm.includes(apiNorm) || apiNorm.includes(subNorm)) return { name: m.name, logo: m.logo };
      const subFirst = subNorm.split(/\s+/)[0];
      const apiFirst = apiNorm.split(/\s+/)[0];
      if (subFirst && apiFirst && subFirst.length >= 2 && subFirst === apiFirst) return { name: m.name, logo: m.logo };
    }
    return null;
  }

  private sanitizeLogo(logo?: string | null): string | undefined {
    const trimmed = (logo ?? '').trim();
    if (!trimmed) return undefined;
    if (this.invalidLogoTokens.has(trimmed.toLowerCase())) return undefined;
    return trimmed;
  }

  readonly enrichedParentGroups = computed(() => {
    const groups = this.parentGroups();
    const apiManufacturers = this.effectiveManufacturers();
    if (apiManufacturers.length === 0) return groups;
    return groups.map((group) => ({
      ...group,
      subsidiaries: group.subsidiaries.map((sub) => {
        const match = this.matchSubsidiaryToManufacturer(sub.name, apiManufacturers);
        if (!match) return sub;
        const matchedLogo = this.sanitizeLogo(match.logo);
        const existingLogo = typeof sub.logo === 'string' ? this.sanitizeLogo(sub.logo) : sub.logo;
        return { ...sub, name: match.name, logo: matchedLogo ?? existingLogo };
      }),
    }));
  });

  readonly filteredParentGroups = computed(() => {
    const filters = this.filterApplied();
    const parentGroups = this.enrichedParentGroups();
    const projectStatusByFactory = this.projectStatusByFactoryId();
    const viewMode = this.mapViewMode();
    const status = this.effectiveStatusFilter();

    if (viewMode === 'manufacturer') {
      return parentGroups;
    }

    return parentGroups
      .map((group) => {
        // Deep clone or construct filtered group
        const filteredSubsidiaries = group.subsidiaries
          .map((sub) => {
            const filteredFactories = (sub.factories ?? []).filter((f) => {
              const statusMatch =
                status === 'all'
                  ? true
                  : status === 'active'
                    ? projectStatusByFactory.get(f.id) === 'active'
                    : projectStatusByFactory.get(f.id) === 'inactive';
              const regionMatch = this.matchesRegionsForFactory(f, filters.regions);
              return statusMatch && regionMatch;
            });

            if (filteredFactories.length === 0) {
              if (status === 'active' || status === 'inactive') {
                return null;
              }
              // If no factories match, check if the subsidiary itself matches status.
              // Note: Region filtering for subsidiary is based on its factories
              const statusMatch = this.matchesOperationalStatus(sub.status, status);
              if (statusMatch && filters.regions.length === 0) {
                return { ...sub, factories: [] };
              }
              return null;
            }

            return { ...sub, factories: filteredFactories };
          })
          .filter((sub): sub is SubsidiaryCompany & { factories: ManufacturerLocation[] } => sub !== null);

        if (filteredSubsidiaries.length === 0) {
          if (status === 'active' || status === 'inactive') {
            return null;
          }
          // Check if parent itself matches if no children match
          const statusMatch = this.matchesOperationalStatus(group.status, status);
          if (statusMatch && filters.regions.length === 0) {
            return { ...group, subsidiaries: [] };
          }
          return null;
        }

        return { ...group, subsidiaries: filteredSubsidiaries };
      })
      .filter((group): group is ParentGroup & { subsidiaries: (SubsidiaryCompany & { factories: ManufacturerLocation[] })[] } => group !== null);
  });

  readonly filteredActivityLogs = computed(() => {
    if (this.mapViewMode() === 'manufacturer') {
      return this.activityLogs();
    }
    const filters = this.filterApplied();
    const status = this.effectiveStatusFilter();
    const factoryLookup = new Map(this.factories().map((factory) => [factory.id, factory]));
    const projectStatusByFactory = this.projectStatusByFactoryId();

    return this.activityLogs().filter((log) => {
      const logLocationId = log.manufacturerLocationId ?? log.factoryId;
      const factory = logLocationId ? factoryLookup.get(logLocationId) : undefined;
      const statusMatch =
        status === 'all'
          ? true
          : status === 'active'
            ? projectStatusByFactory.get(logLocationId ?? '') === 'active'
            : projectStatusByFactory.get(logLocationId ?? '') === 'inactive';
      if (!statusMatch) {
        return false;
      }

      if (!this.matchesRegionsForFactory(factory, filters.regions)) {
        return false;
      }

      return true;
    });
  });

  readonly filteredTransitRoutes = computed(() => {
    if (this.mapViewMode() === 'client') {
      return [];
    }
    const routes = this.transitRoutes();
    const nodes = this.filteredNodes();
    const filteredNodeIds = new Set(nodes.map(n => n.id));

    const lookup = this.nodeLookup();
    const findNode = (id: string): Node | undefined => {
      const nid = (id ?? '').toLowerCase();
      const match = lookup.get(id) ?? lookup.get(nid);
      if (match) return match;

      const factory = this.factories().find(f => f.id === id || (f.id && f.id.toLowerCase() === nid));
      if (factory) {
        return lookup.get(factory.subsidiaryId) ?? lookup.get(factory.parentGroupId);
      }

      if (nid.includes('fleetzero') || nid.includes('fleet-zero')) {
        return this.nodes().find(n =>
          n.id === 'fleetzero' ||
          n.subsidiaryId === 'fleetzero' ||
          (n.name != null && n.name.toLowerCase().includes('fleetzero'))
        );
      }

      if (id.startsWith('source-')) {
        return lookup.get(id.replace('source-', ''));
      }

      return undefined;
    };

    return routes.reduce<TransitRoute[]>((acc, route) => {
      const fromNode = findNode(route.from);
      const toNode = findNode(route.to);

      const fromCoordinates = fromNode?.coordinates ?? route.fromCoordinates;
      const toCoordinates = toNode?.coordinates ?? route.toCoordinates;

      if (!isValidCoordinates(fromCoordinates) || !isValidCoordinates(toCoordinates)) {
        return acc;
      }

      const isEndpointVisible = (node: Node | undefined) =>
        node != null && filteredNodeIds.has(node.id);

      const bothEndpointsVisible = isEndpointVisible(fromNode) && isEndpointVisible(toNode);

      if (!bothEndpointsVisible) return acc;

      acc.push({
        ...route,
        fromCoordinates: fromCoordinates!,
        toCoordinates: toCoordinates!,
      });

      return acc;
    }, []);
  });

  /**
   * True when the map should show the "No map entities match" overlay instead of a blank/dark map.
   * Show when: no nodes at all, or (in project view) no routes and only client nodes — so the map would otherwise look empty/black.
   */
  readonly showEmptyStateOverlay = computed(() => {
    if (this.requiredDataLoading()) return false;
    return this.mapViewModelStrict().emptyState.show;
  });

  // ViewChild reference to map component
  readonly mapComponent = viewChild.required(FluorescenceMapMapComponent);

  readonly projectRoutesRefreshTrigger = signal(0);
  readonly projectRoutesLoading = signal(false);

  readonly addCompanyModalRef = viewChild<AddCompanyModalRef>('addCompanyModalRef');

  // Timeout for zoom effect
  private zoomTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private skipInitialAutoZoom = true;
  private addCompanyInFlight = false;
  private addProjectSucceededBeforeClose = false;
  /** Client id we last called fitBounds for; avoids re-zooming on every route API refresh. */
  private lastFittedForClientId: string | null = null;
  /** Last node-id set we fitted to (for filter-result fit); avoids re-fitting on every run. */
  private lastFittedToFilteredKey: string | null = null;
  private fitBoundsToFilteredTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private logWarn(message: string, error?: unknown): void {
    if (isDevMode()) {
      console.warn(message, error);
    }
  }

  private logError(message: string, error?: unknown): void {
    console.error(message, error);
  }

  private mergeEntitiesWithDelta<T extends { id: string | number }>(
    baseEntities: T[],
    deltaById: Map<string, Partial<T>>,
    deletedIds: Set<string>
  ): T[] {
    const merged = new Map<string, T>();
    for (const entity of baseEntities) {
      if (!entity || entity.id == null) continue;
      merged.set(String(entity.id), entity);
    }

    for (const deletedId of deletedIds) {
      merged.delete(deletedId);
    }

    for (const [id, patch] of deltaById.entries()) {
      const existing = merged.get(id);
      const coerceKeyIfNeeded = (key: string): string | number => {
        if (typeof existing?.id === 'number') {
          const asNumber = Number(key);
          return Number.isFinite(asNumber) ? asNumber : key;
        }
        return key;
      };
      const nextId = (patch as { id?: T['id'] }).id ?? existing?.id ?? coerceKeyIfNeeded(id);
      merged.set(id, {
        ...(existing ?? ({ id: nextId } as T)),
        ...patch,
        id: nextId,
      } as T);
    }

    return Array.from(merged.values());
  }

  private clearDeltaOverlays(): void {
    this.projectDeltaById.set(new Map());
    this.projectDeletedIds.set(new Set());
    this.clientDeltaById.set(new Map());
    this.clientDeletedIds.set(new Set());
    this.locationDeltaById.set(new Map());
    this.locationDeletedIds.set(new Set());
    this.manufacturerDeltaById.set(new Map());
    this.manufacturerDeletedIds.set(new Set());
  }

  private schedulePollingFallback(): void {
    if (this.pollingFallbackTimeoutId != null) return;
    this.pollingFallbackTimeoutId = setTimeout(() => {
      this.pollingFallbackTimeoutId = null;
      this.mapPollingService.start(this.mapPollingIntervalMs);
      this.realtimeUiState.set('polling');
    }, this.mapDisconnectGraceMs);
  }

  private clearPollingFallbackTimer(): void {
    if (this.pollingFallbackTimeoutId != null) {
      clearTimeout(this.pollingFallbackTimeoutId);
      this.pollingFallbackTimeoutId = null;
    }
  }

  private startRealtimeBridge(): void {
    this.mapRealtimeService.state$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (state === 'connected' || state === 'connecting' || state === 'reconnecting') {
          this.clearPollingFallbackTimer();
          this.mapPollingService.stop();
          this.realtimeUiState.set(state);
          return;
        }

        this.realtimeUiState.set('disconnected');
        this.schedulePollingFallback();
      });

    const changes$ = this.mapRealtimeService.changes$.pipe(takeUntil(this.destroy$), share());
    changes$
      .pipe(
        buffer(changes$.pipe(debounceTime(250))),
        filter((events) => events.length > 0)
      )
      .subscribe((events) => {
        let needsFullRefresh = false;
        let needsRouteRefresh = false;
        for (const event of events) {
          const outcome = this.handleRealtimeMapChanged(event);
          if (outcome === 'full') needsFullRefresh = true;
          if (outcome === 'routes') needsRouteRefresh = true;
        }

        if (needsFullRefresh) {
          this.retryRequiredDataLoad();
          return;
        }
        if (needsRouteRefresh) {
          this.projectRoutesRefreshTrigger.update((n) => n + 1);
        }
      });

    this.mapPollingService.tick$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.refreshProjectStreamForPollingTick();
      });

    void this.mapRealtimeService.connect().catch((error) => {
      this.logWarn('Realtime hub connection failed', error);
      this.schedulePollingFallback();
    });
  }

  private stopRealtimeBridge(): void {
    this.clearPollingFallbackTimer();
    this.mapPollingService.stop();
    void this.mapRealtimeService.disconnect();
  }

  private handleRealtimeMapChanged(event: MapChangeEvent): 'none' | 'routes' | 'full' {
    if (!event?.entity || !event?.action || !event?.id) {
      this.logWarn('Ignoring malformed realtime event payload', event);
      return 'full';
    }

    let applied = false;
    if (event.entity === 'Project') {
      applied = this.applyProjectDeltaEvent(event);
      if (applied) return 'routes';
    }
    if (event.entity === 'Location') {
      applied = this.applyLocationDeltaEvent(event);
      if (applied) return 'routes';
    }
    if (event.entity === 'Client') {
      applied = this.applyClientDeltaEvent(event);
      if (applied) return 'routes';
    }
    if (event.entity === 'Manufacturer') {
      applied = this.applyManufacturerDeltaEvent(event);
      if (applied) return 'none';
    }

    if (!applied) {
      this.logWarn('Realtime event could not be applied as delta; falling back to full refresh.', event);
      return 'full';
    }

    return 'none';
  }

  private applyProjectDeltaEvent(event: MapChangeEvent): boolean {
    const id = event.id;
    if (event.action === 'Deleted') {
      this.projectDeltaById.update((entries) => {
        const next = new Map(entries);
        next.delete(id);
        return next;
      });
      this.projectDeletedIds.update((entries) => {
        const next = new Set(entries);
        next.add(id);
        return next;
      });
      return true;
    }

    if (!event.payload || typeof event.payload !== 'object') return false;
    const normalized = adaptApiProject(event.payload as Record<string, unknown>);
    if (!normalized) return false;
    const status =
      normalized.status === 'Open' || normalized.status === 'Closed' || normalized.status === 'Delayed'
        ? normalized.status
        : null;
    const payload: ProjectDeltaPatch = {
      id,
      projectName: normalized.projectName,
      clientId: normalized.clientId ?? '',
      clientName: normalized.clientName ?? undefined,
      assessmentType: normalized.assessmentType,
      projectTypeId: normalized.projectTypeId ?? undefined,
      locationId: normalized.locationId ?? undefined,
      locationIds: normalized.locationIds,
      locations: normalized.locations,
      manufacturerLocationId: normalized.manufacturerLocationId ?? undefined,
      closed: normalized.closed ?? undefined,
      status,
      contract: normalized.contract ?? undefined,
      hasRoadTest: normalized.hasRoadTest ?? undefined,
      lastUpdate: normalized.lastUpdate ?? undefined,
    };

    this.projectDeltaById.update((entries) => {
      const next = new Map(entries);
      next.set(id, {
        ...(next.get(id) ?? {}),
        ...payload,
        id,
      });
      return next;
    });
    this.projectDeletedIds.update((entries) => {
      const next = new Set(entries);
      next.delete(id);
      return next;
    });
    return true;
  }

  private applyClientDeltaEvent(event: MapChangeEvent): boolean {
    const id = event.id;
    if (event.action === 'Deleted') {
      this.clientDeltaById.update((entries) => {
        const next = new Map(entries);
        next.delete(id);
        return next;
      });
      this.clientDeletedIds.update((entries) => {
        const next = new Set(entries);
        next.add(id);
        return next;
      });
      return true;
    }

    if (!event.payload || typeof event.payload !== 'object') return false;
    const normalized = adaptApiClient(event.payload as Record<string, unknown>);
    if (!normalized) return false;
    const payload: Partial<Client> = { ...normalized, id };

    this.clientDeltaById.update((entries) => {
      const next = new Map(entries);
      next.set(id, {
        ...(next.get(id) ?? {}),
        ...payload,
        id,
      });
      return next;
    });
    this.clientDeletedIds.update((entries) => {
      const next = new Set(entries);
      next.delete(id);
      return next;
    });
    return true;
  }

  private applyLocationDeltaEvent(event: MapChangeEvent): boolean {
    const id = event.id;
    if (event.action === 'Deleted') {
      this.locationDeltaById.update((entries) => {
        const next = new Map(entries);
        next.delete(id);
        return next;
      });
      this.locationDeletedIds.update((entries) => {
        const next = new Set(entries);
        next.add(id);
        return next;
      });
      return true;
    }

    if (!event.payload || typeof event.payload !== 'object') return false;
    const normalized = adaptApiLocation(event.payload as Record<string, unknown>);
    if (!normalized) return false;
    const normalizedId = normalized.id;

    this.locationDeltaById.update((entries) => {
      const next = new Map(entries);
      next.set(id, {
        ...(next.get(id) ?? {}),
        ...normalized,
        id: normalizedId,
      });
      return next;
    });
    this.locationDeletedIds.update((entries) => {
      const next = new Set(entries);
      next.delete(id);
      return next;
    });
    return true;
  }

  private applyManufacturerDeltaEvent(event: MapChangeEvent): boolean {
    const id = event.id;
    if (event.action === 'Deleted') {
      this.manufacturerDeltaById.update((entries) => {
        const next = new Map(entries);
        next.delete(id);
        return next;
      });
      this.manufacturerDeletedIds.update((entries) => {
        const next = new Set(entries);
        next.add(id);
        return next;
      });
      return true;
    }

    if (!event.payload || typeof event.payload !== 'object') return false;
    const normalizedManufacturer = adaptApiManufacturer(event.payload as Record<string, unknown>);
    if (!normalizedManufacturer) return false;
    const payload: Partial<ManufacturerRuntimeRecord> = {
      id: normalizedManufacturer.id,
      name: normalizedManufacturer.manufacturerName,
      logo: this.sanitizeLogo(normalizedManufacturer.manufacturerLogo),
      locationId: normalizedManufacturer.primaryLocationId ?? null,
      locationIds: normalizedManufacturer.locationIds,
      locations: normalizedManufacturer.locations,
    };
    const normalizedId = payload.id ?? Number.parseInt(id, 10);
    if (!Number.isFinite(normalizedId)) return false;

    this.manufacturerDeltaById.update((entries) => {
      const next = new Map(entries);
      next.set(id, {
        ...(next.get(id) ?? {}),
        ...payload,
        id: normalizedId,
      });
      return next;
    });
    this.manufacturerDeletedIds.update((entries) => {
      const next = new Set(entries);
      next.delete(id);
      return next;
    });
    return true;
  }

  private projectWorkflowContext(): ProjectWorkflowContext {
    return {
      factories: () => this.factories(),
      subsidiaries: () => this.subsidiaries(),
      apiManufacturersSignal: () => this.effectiveManufacturers(),
      retryRequiredDataLoad: () => this.retryRequiredDataLoad(),
      projectRoutes: () => this.projectRoutes(),
      clearAllFilters: () => this.clearAllFilters(),
      setSelectedProjectId: (value) => this.selectedProjectId.set(value),
      mapFitBoundsToRoutes: (routes) => this.mapComponent().fitBoundsToRoutes(routes),
      announce: (message) => this.announce(message),
      closeModalAfterSuccess: () => this.addCompanyModalRef()?.closeAfterSuccess(),
      handleModalSuccess: (message) => {
        this.addProjectSucceededBeforeClose = true;
        this.addCompanyModalRef()?.handleSuccess(message);
      },
      handleModalError: (message) => this.addCompanyModalRef()?.handleError(message),
      waitForRouteThenCapture: (projectId, projectName, initialDelayMs, pollIntervalMs, maxAttempts) =>
        this.captureWorkflow.waitForRouteCapture(
          this.captureWorkflowContext(),
          projectId,
          projectName,
          initialDelayMs,
          pollIntervalMs,
          maxAttempts
        ),
    };
  }

  private captureWorkflowContext(): CaptureWorkflowContext {
    return {
      projectRoutes: () => this.projectRoutes(),
      selectedEntity: () => this.selectedEntity(),
      clientsSignal: () => this.effectiveClients(),
      setScreenshotMode: (value) => this.screenshotMode.set(value),
      setSelectedProjectId: (value) => this.selectedProjectId.set(value),
      mapCaptureRoutesScreenshot: (routes) => this.mapComponent().captureRoutesScreenshot(routes),
      mapCaptureRouteScreenshot: (route) => this.mapComponent().captureRouteScreenshot(route),
      refreshRoutePreviewVersion: () => this.routePreviewVersion.set(this.routePreviewStorage.previewSaved()),
    };
  }

  private panelActionsContext(): PanelActionsContext {
    return {
      mapViewMode: () => this.mapViewMode(),
      selectedEntity: () => this.selectedEntity(),
      setSelectedEntity: (selection) => this.warRoomService.selectEntity(selection),
      showPanel: (panel) => this.showPanel(panel),
      setManufacturerFilterSubsidiaryId: (id) => this.warRoomService.setManufacturerFilterSubsidiaryId(id),
      setMapViewMode: (mode) => this.warRoomService.setMapViewMode(mode),
      zoomToEntity: (id, zoom) => this.mapComponent().zoomToEntity(id, zoom),
      announce: (message) => this.announce(message),
    };
  }

  constructor() {
    // Safety: if the current user becomes restricted (client/user), force view mode and edit mode to safe defaults.
    effect(() => {
      if (this.isClientOrUser() && this.mapViewMode() === 'client') {
        this.warRoomService.setMapViewMode('project');
      }
    });

    effect(() => {
      if (this.isClientOrUser() && this.activityLogEditMode()) {
        this.activityLogEditMode.set(false);
      }
    });

    // Client/user accounts: pin map scope to signed-in client id.
    effect(
      () => {
        const pinnedClientId = this.pinnedClientId();
        if (!pinnedClientId) {
          return;
        }

        const applied = this.filterApplied();
        if (applied.clientIds.length !== 1 || applied.clientIds[0] !== pinnedClientId) {
          this.filterApplied.set({
            ...applied,
            clientIds: [pinnedClientId],
          });
        }

        const draft = this.filterDraft();
        if (draft.clientIds.length !== 1 || draft.clientIds[0] !== pinnedClientId) {
          this.filterDraft.set({
            ...draft,
            clientIds: [pinnedClientId],
          });
        }

        const selection = this.selectedEntity();
        const shouldSelectClient =
          selection == null ||
          (selection.level === 'client' && this.normalizeClientId(selection.id) !== pinnedClientId);
        if (shouldSelectClient) {
          this.warRoomService.selectEntity({ level: 'client', id: pinnedClientId });
        }

        if (!this.pinnedLogModeInitialized) {
          this.logPanelMode.set('client');
          this.pinnedLogModeInitialized = true;
        }

      }
    );

    effect(() => {
      const externalProjectId = this.externalProjectId();
      if (externalProjectId === undefined) {
        this.lastSyncedExternalProjectId = undefined;
        return;
      }

      const normalizedExternalProjectId =
        externalProjectId && externalProjectId !== 'all'
          ? String(externalProjectId)
          : null;

      if (this.lastSyncedExternalProjectId === normalizedExternalProjectId) {
        return;
      }

      this.lastSyncedExternalProjectId = normalizedExternalProjectId;
      const targetProjectIds = normalizedExternalProjectId ? [normalizedExternalProjectId] : [];

      this.filterApplied.update((current) => ({
        ...current,
        projectIds: targetProjectIds,
      }));
      this.filterDraft.update((current) => ({
        ...current,
        projectIds: [...targetProjectIds],
      }));
      this.selectedProjectId.set(normalizedExternalProjectId);
    });

    effect(() => {
      const selectedEntity = this.selectedEntity();
      const map = this.tryGetMapComponent();
      if (this.skipInitialAutoZoom) {
        this.skipInitialAutoZoom = false;
        return;
      }
      // Clear any existing timeout
      if (this.zoomTimeoutId) {
        clearTimeout(this.zoomTimeoutId);
      }
      if (selectedEntity && selectedEntity.level !== 'parent' && map) {
        this.zoomTimeoutId = setTimeout(() => {
          map.zoomToEntity(selectedEntity.id);
          this.zoomTimeoutId = null;
        }, ZOOM_TO_ENTITY_DELAY_MS);
      }
      // Cleanup function for effect
      return () => {
        if (this.zoomTimeoutId) {
          clearTimeout(this.zoomTimeoutId);
          this.zoomTimeoutId = null;
        }
      };
    });

    // Save filters, view mode, and panel visibility on change (after hydration to avoid overwriting)
    effect(() => {
      if (!this.hasHydratedFromStorage) return;
      const filters = this.filterApplied();
      const viewMode = this.mapViewMode();
      const panelVisible = this.panelVisible();
      const state: WarRoomPersistedState = {
        ...filters,
        mapViewMode: viewMode,
        panelVisible,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    });

    effect(() => {
      const dataReady = this.requiredDataReady();
      if (dataReady) {
        this.hasLoadedRequiredData.set(true);
        this.clearDeltaOverlays();
      }
    });

    // Load ParentGroups only after required data is ready so we reuse cached Manufacturers/Locations
    // and avoid showing "ParentGroups" in the error summary when the same endpoint failed for required data.
    effect((onCleanup) => {
      const trigger = this.requiredReloadTrigger();
      if (!this.requiredDataReady() || this.parentGroupsLoadedForTrigger() === trigger) return;
      this.parentGroupsLoadedForTrigger.set(trigger);
      this.setEndpointLoading('parentGroups');
      const sub = this.projectService
        .buildParentGroupsFromApi()
        .pipe(timeout(REQUIRED_DATA_TIMEOUT_MS), take(1))
        .subscribe({
          next: (groups: ParentGroup[]) => {
            if (groups.length > 0) {
              const currentGroups = this.parentGroups();
              const incomingUsable = this.hasUsableParentGroupHierarchy(groups);
              const currentUsable = this.hasUsableParentGroupHierarchy(currentGroups);
              // Avoid clobbering richer in-memory hierarchy with non-mappable fallback API results.
              if (incomingUsable || !currentUsable) {
                this.warRoomService.setParentGroupsFromApi(groups);
              }
            }
            this.setEndpointReady('parentGroups');
          },
          error: (err) => {
            this.setEndpointError('parentGroups', err);
          },
        });
      onCleanup(() => sub.unsubscribe());
    });

    // Routes fetch: depends on filterApplied + projectRoutesRefreshTrigger (not mapViewMode) so view switch is realtime without refetch.
    effect(() => {
      const dataReady = this.requiredDataReady();
      const dataLoading = this.requiredDataLoading();
      const clients = this.effectiveClients();
      const factories = this.factories();
      const locations = this.effectiveLocations();
      const filters = this.filterApplied();
      void this.projectRoutesRefreshTrigger();
      if (dataLoading) {
        this.projectRoutesLoading.set(true);
        return;
      }
      if (!dataReady) {
        this.projectRoutesLoading.set(false);
        return;
      }
      if (!clients?.length) {
        this.projectRoutes.set([]);
        this.projectRoutesLoading.set(false);
        return;
      }
      this.projectRoutesLoading.set(true);
      // Use resolved coordinates (client.coordinates or location fallback) so clients like "54 Davies"
      // with only locationId are included and the API can return routes when filtering by client.
      const clientsWithCoords = this.effectiveClientsWithResolvedCoordinates().filter(
        (c): c is typeof c & { coordinates: { latitude: number; longitude: number } } =>
          isValidCoordinates(c.coordinates)
      );
      const clientCoords = new Map<string, { latitude: number; longitude: number }>();
      clientsWithCoords.forEach((client) => {
        const clientId = this.normalizeClientId(client.id);
        if (!clientId) return;
        clientCoords.set(clientId, client.coordinates);
      });
      const warRoomEntries = factories.map((f) => [
        f.id,
        { latitude: f.coordinates.latitude, longitude: f.coordinates.longitude },
      ] as const);
      const locationEntries = (locations as Array<{ id: string | number; latitude: number; longitude: number }>)
        .flatMap((location) => {
          const coordinates = coerceCoordinates(location.latitude, location.longitude);
          if (!coordinates) return [];
          const rawId = String(location.id ?? '').trim();
          const normalizedId = this.normalizeEntityId(location.id);
          const entries: Array<readonly [string, { latitude: number; longitude: number }]> = [];
          if (rawId) entries.push([rawId, coordinates] as const);
          if (normalizedId && normalizedId !== rawId) {
            entries.push([normalizedId, coordinates] as const);
          }
          return entries;
        });
      const factoryCoords = new Map<string, { latitude: number; longitude: number }>([
        ...warRoomEntries,
        ...locationEntries,
      ]);
      const projectStatuses: ('Open' | 'Closed' | 'Delayed')[] | undefined =
        filters.status === 'active' ? ['Open'] :
          filters.status === 'inactive' ? ['Closed', 'Delayed'] :
            undefined;
      const normalizedClientIds = this.normalizeClientIdList(filters.clientIds);
      const projectFilters = {
        clientIds: normalizedClientIds.length ? normalizedClientIds : undefined,
        manufacturerIds: filters.manufacturerIds.length ? filters.manufacturerIds : undefined,
        projectTypeIds: filters.projectTypeIds.length ? filters.projectTypeIds : undefined,
        projectIds: filters.projectIds.length ? filters.projectIds : undefined,
        projectStatuses,
      };
      const sub = this.projectService
        .getProjectsForMap(clientCoords, factoryCoords, projectFilters)
        .pipe(
          catchError((err) => {
            this.logError('Failed to fetch project routes for map', err);
            return of([]);
          })
        )
        .subscribe((routes) => {
          this.projectRoutes.set(routes);
          this.projectRoutesLoading.set(false);
        });
      return () => {
        sub.unsubscribe();
        this.projectRoutesLoading.set(false);
      };
    });

    // Fit map bounds only when a client is first selected (or selection changes), not on every route API refresh
    effect(() => {
      const selection = this.selectedEntity();
      const routes = this.projectRoutes();
      const loading = this.projectRoutesLoading();
      const map = this.tryGetMapComponent();
      if (selection?.level !== 'client') {
        this.lastFittedForClientId = null;
        return;
      }
      if (loading || !map || !routes.length) return;
      const selectedClientId = this.normalizeClientId(selection.id);
      if (!selectedClientId) return;
      const clientRoutes = routes.filter((r) => this.normalizeClientId(r.fromNodeId) === selectedClientId);
      if (!clientRoutes.length) return;
      // Only fit when we haven't already fitted for this client (avoids weird zoom on every API call)
      if (this.lastFittedForClientId === selectedClientId) return;
      this.lastFittedForClientId = selectedClientId;
      setTimeout(() => map.fitBoundsToRoutes(clientRoutes), FIT_BOUNDS_DELAY_MS);
    });

    // When filters are applied and the filtered set is small, fit map to those nodes so the result is visible
    effect((onCleanup) => {
      const hasActiveFilters = this.filtersActiveStrict();
      const nodes = this.strictMapNodes();
      const shouldPass = this.shouldPassMapData();
      const map = this.tryGetMapComponent();
      const routesLoading = this.projectRoutesLoading();
      if (!hasActiveFilters) {
        this.lastFittedToFilteredKey = null;
        return;
      }
      if (!shouldPass || routesLoading || !map || nodes.length === 0 || nodes.length > 30) return;
      const key = nodes.map((n) => n.id).sort().join(',');
      if (this.lastFittedToFilteredKey === key) return;
      this.lastFittedToFilteredKey = key;
      if (this.fitBoundsToFilteredTimeoutId) clearTimeout(this.fitBoundsToFilteredTimeoutId);
      this.fitBoundsToFilteredTimeoutId = setTimeout(() => {
        this.fitBoundsToFilteredTimeoutId = null;
        map.fitBoundsToNodes(nodes);
      }, FIT_BOUNDS_DELAY_MS);
      onCleanup(() => {
        if (this.fitBoundsToFilteredTimeoutId) {
          clearTimeout(this.fitBoundsToFilteredTimeoutId);
          this.fitBoundsToFilteredTimeoutId = null;
        }
      });
    });

    // Strict map pipeline selection validation: filtered routes -> derived nodes -> validate selection.
    effect(() => {
      const viewModel = this.mapViewModelStrict();
      const filtersActive = this.filtersActiveStrict();
      const selected = this.selectedEntity();
      const selectedRouteId = this.selectedRouteId();
      const visibleMarkerIds = new Set(viewModel.markers.map((marker) => marker.nodeId));
      const visibleRouteIds = new Set(viewModel.routes.map((route) => route.id));

      if (!filtersActive) {
        return;
      }

      let cleared = false;

      if (selected) {
        const isNodeVisible = visibleMarkerIds.has(selected.id)
          || (selected.manufacturerLocationId != null && visibleMarkerIds.has(selected.manufacturerLocationId))
          || (selected.factoryId != null && visibleMarkerIds.has(selected.factoryId));
        if (!isNodeVisible) {
          this.warRoomService.selectEntity(null);
          cleared = true;
        }
      }

      if (selectedRouteId && !visibleRouteIds.has(selectedRouteId)) {
        this.selectedRouteId.set(null);
        cleared = true;
      }

      if (cleared) {
        const hasMatchingRoutes = this.filteredProjectRoutesStrict().length > 0;
        this.selectionOutsideFiltersNotice.set(
          hasMatchingRoutes ? null : 'Current selection is outside applied filters'
        );
      }
    });

    // Keep notice strictly tied to filtered route availability.
    effect(() => {
      const filtersActive = this.filtersActiveStrict();
      const hasMatchingRoutes = this.filteredProjectRoutesStrict().length > 0;
      if (!filtersActive || hasMatchingRoutes) {
        this.selectionOutsideFiltersNotice.set(null);
      } else {
        this.selectionOutsideFiltersNotice.set('Current selection is outside applied filters');
      }
    });

    // Dev-only diagnostics for strict filtering pipeline.
    effect(() => {
      if (!isDevMode()) return;
      const filters = this.filterApplied();
      const totalRoutes = this.projectRoutes().length;
      const filteredRoutes = this.filteredProjectRoutesStrict();
      const derived = this.derivedNodeIdsStrict();
      const markers = this.mapViewModelStrict().markers.length;
      if (!this.filtersActiveStrict()) return;
      console.debug('[FleetPulse][strict-filter]', {
        filters,
        totalRoutes,
        filteredRoutes: filteredRoutes.length,
        sampleFilteredRouteIds: filteredRoutes.slice(0, 6).map((route) => route.id),
        derivedFromNodeIds: derived.fromNodeIds.size,
        derivedToNodeIds: derived.toNodeIds.size,
        derivedAllNodeIds: derived.allNodeIds.size,
        markers,
      });
    });

    // Re-apply saved view mode after service JSON load overwrites mapViewMode.
    effect(() => {
      const groups = this.parentGroups();
      const saved = this.savedMapViewMode();
      if (!saved) return;
      if (groups.length > 0) {
        const restored = saved === 'client' && this.isClientOrUser() ? 'project' : saved;
        this.warRoomService.setMapViewMode(restored);
        this.savedMapViewMode.set(null);
      }
    });
  }

  ngOnInit(): void {
    // Load persisted state (filters + view mode) - support legacy key for migration
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as WarRoomPersistedState;
        const defaults = createDefaultFilters();
        const filters: WarRoomFilters = {
          ...defaults,
          status: parsed.status ?? defaults.status,
          regions: parsed.regions ?? defaults.regions,
          clientIds: parsed.clientIds ?? defaults.clientIds,
          manufacturerIds: parsed.manufacturerIds ?? defaults.manufacturerIds,
          projectTypeIds: parsed.projectTypeIds ?? defaults.projectTypeIds,
          projectIds: parsed.projectIds ?? defaults.projectIds,
        };
        // Migrate legacy single-string filters to arrays
        if (filters.clientIds.length === 0 && parsed.clientId != null && parsed.clientId !== 'all') {
          filters.clientIds = [parsed.clientId];
        }
        if (filters.manufacturerIds.length === 0 && parsed.manufacturerId != null && parsed.manufacturerId !== 'all') {
          filters.manufacturerIds = [parsed.manufacturerId];
        }
        if (filters.projectTypeIds.length === 0 && parsed.projectType != null && parsed.projectType !== 'all') {
          filters.projectTypeIds = [parsed.projectType];
        }
        filters.clientIds = this.normalizeClientIdList(filters.clientIds ?? []);
        filters.manufacturerIds = filters.manufacturerIds ?? [];
        filters.projectTypeIds = filters.projectTypeIds ?? [];
        filters.projectIds = filters.projectIds ?? [];
        this.filterApplied.set(filters);
        this.filterDraft.set(filters);

        // Restore view mode - migrate legacy subsidiary mode to manufacturer.
        const legacyMapMode = (parsed as { mapViewMode?: string }).mapViewMode;
        const restoredModeRaw = (legacyMapMode === 'subsidiary' ? 'manufacturer' : parsed.mapViewMode) as
          | MapViewMode
          | undefined;
        const restoredMode =
          restoredModeRaw === 'client' && this.isClientOrUser()
            ? 'project'
            : restoredModeRaw;
        if (restoredMode && VALID_RESTORABLE_MAP_MODES.includes(restoredMode)) {
          this.savedMapViewMode.set(restoredMode);
          this.warRoomService.setMapViewMode(restoredMode);
        }
        // Restore panel visibility from persisted state
        if (typeof parsed.panelVisible === 'boolean') {
          this.panelVisible.set(parsed.panelVisible);
        }
      } catch (e) {
        this.logWarn('Failed to parse saved state', e);
      }
    } else {
      // First-time user: show sidebar by default for better discoverability
      this.panelVisible.set(true);
    }

    // First-visit pulse on Add Project button
    if (typeof localStorage !== 'undefined' && !localStorage.getItem(ADD_PROJECT_SEEN_KEY)) {
      this.addProjectPulse.set(true);
      this.addProjectPulseTimeoutId = setTimeout(() => this.dismissAddProjectPulse(), ADD_PROJECT_PULSE_DURATION_MS);
    }

    // First-time onboarding hint for view modes, Panels, Tactical View, FAB
    if (typeof localStorage !== 'undefined' && !localStorage.getItem(TIPS_HINT_SEEN_KEY)) {
      this.showTipsHint.set(true);
      this.tipsHintTimeoutId = setTimeout(() => this.dismissTipsHint(), TIPS_HINT_DURATION_MS);
    }

    this.hasHydratedFromStorage = true;

    // ParentGroups is loaded in an effect when required data is ready (see loadParentGroupsWhenReadyEffect)
    // so we avoid duplicate dependency on Manufacturers/Locations and cascading failure in the error summary.

    this.startRealtimeBridge();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopRealtimeBridge();

    // Clear zoom timeout
    if (this.zoomTimeoutId) {
      clearTimeout(this.zoomTimeoutId);
      this.zoomTimeoutId = null;
    }

    if (this.addProjectPulseTimeoutId != null) {
      clearTimeout(this.addProjectPulseTimeoutId);
      this.addProjectPulseTimeoutId = null;
    }

    if (this.tipsHintTimeoutId != null) {
      clearTimeout(this.tipsHintTimeoutId);
      this.tipsHintTimeoutId = null;
    }

    this.applyMapExpandedDomState(false);
  }

  retryRequiredDataLoad(): void {
    if (this.requiredDataLoading()) {
      return;
    }
    this.requiredReloadTrigger.update((n) => n + 1);
    this.projectService.refreshProjects();
    this.projectRoutesRefreshTrigger.update((n) => n + 1);
  }

  /**
   * Polling fallback should refresh project-backed streams only.
   * Full required-data reload is reserved for explicit retry/hard refresh paths.
   */
  private refreshProjectStreamForPollingTick(): void {
    if (this.requiredDataLoading()) {
      return;
    }
    this.projectService.refreshProjects();
    this.projectRoutesRefreshTrigger.update((n) => n + 1);
  }

  private dismissAddProjectPulse(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ADD_PROJECT_SEEN_KEY, '1');
    }
    this.addProjectPulse.set(false);
    if (this.addProjectPulseTimeoutId != null) {
      clearTimeout(this.addProjectPulseTimeoutId);
      this.addProjectPulseTimeoutId = null;
    }
  }

  /** Called from template when user dismisses first-time tips */
  dismissTipsHint(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TIPS_HINT_SEEN_KEY, '1');
    }
    this.showTipsHint.set(false);
    if (this.tipsHintTimeoutId != null) {
      clearTimeout(this.tipsHintTimeoutId);
      this.tipsHintTimeoutId = null;
    }
  }

  /**
   * Handle entity selection from activity log
   */
  onEntitySelected(selection: FleetSelection): void {
    this.panelActionsWorkflow.onEntitySelected(this.panelActionsContext(), selection);
  }

  /**
   * Toggle overlay panels
   */
  togglePanels(): void {
    const next = !this.panelVisible();
    this.panelVisible.set(next);
    this.announce(next ? 'Data management panel opened.' : 'Data management panel collapsed.');
  }

  onTableOpenChange(open: boolean): void {
    this.panelVisible.set(open);
  }

  toggleMapFullscreen(): void {
    this.mapComponent()?.toggleFullscreen();
  }

  toggleTheme(): void {
    const nextTheme = this.isDarkTheme() ? 'light' : 'dark';
    this.appStateService.updateState({ theme: nextTheme });
  }

  onActivityRowView(row: ActivityLogRow): void {
    const project = this.effectiveProjects().find((candidate) => String(candidate.id) === row.projectId);
    if (!project) return;
    this.onProjectHudSelected(project);
  }

  onClientRowView(row: ClientManagementRow): void {
    const clientId = this.normalizeClientId(row.clientId);
    if (!clientId) {
      this.toastr.info('Client marker could not be resolved.', 'Data management');
      return;
    }
    this.warRoomService.selectEntity({ level: 'client', id: clientId });
    this.warRoomService.setMapViewMode('project');
    this.showPanel('log');
    this.mapComponent().zoomToEntity(clientId, 8);
  }

  onManufacturerRowView(row: ManufacturerManagementRow): void {
    const targetId = this.normalizeEntityId(row.locationId) ?? this.normalizeEntityId(row.manufacturerId);
    if (!targetId) {
      this.toastr.info('Manufacturer marker could not be resolved.', 'Data management');
      return;
    }
    this.warRoomService.selectEntity({
      level: 'manufacturer',
      id: targetId,
      manufacturerLocationId: targetId,
      factoryId: targetId,
    });
    this.warRoomService.setMapViewMode('manufacturer');
    this.showPanel('log');
    this.mapComponent().zoomToEntity(targetId, 8);
  }

  onLocationRowView(row: LocationManagementRow): void {
    const targetId = this.normalizeEntityId(row.locationId);
    if (!targetId) {
      this.toastr.info('Location marker could not be resolved.', 'Data management');
      return;
    }
    this.warRoomService.selectEntity({
      level: 'manufacturer',
      id: targetId,
      manufacturerLocationId: targetId,
      factoryId: targetId,
    });
    this.warRoomService.setMapViewMode('manufacturer');
    this.showPanel('log');
    this.mapComponent().zoomToEntity(targetId, 8);
  }

  onActivityRowSelected(projectId: string): void {
    this.selectedProjectId.set(projectId);
  }

  onActivityRowHovered(projectId: string | null): void {
    if (!projectId) {
      this.warRoomService.setHoveredEntity(null);
      return;
    }
    const project = this.effectiveProjects().find((candidate) => String(candidate.id) === projectId);
    if (!project) return;
    if (project.manufacturerLocationId) {
      this.warRoomService.setHoveredEntity({ level: 'manufacturer', id: project.manufacturerLocationId });
      return;
    }
    if (project.clientId) {
      this.warRoomService.setHoveredEntity({ level: 'client', id: project.clientId });
    }
  }

  private normalizeEntityId(value: string | number | null | undefined): string | null {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = raw.replace(/^source-/i, '').replace(/^loc-/i, '').trim();
    const canonical = normalizeNumericLikeId(normalized);
    return canonical || null;
  }

  private normalizeClientId(value: unknown): string | null {
    const normalized = normalizeNumericLikeId(value);
    return normalized || null;
  }

  private normalizeClientIdList(values: unknown[]): string[] {
    return normalizeNumericLikeIdList(values);
  }

  private tryGetMapComponent(): FluorescenceMapMapComponent | null {
    try {
      return this.mapComponent();
    } catch {
      return null;
    }
  }

  private parseLocationIds(rawValues: unknown[]): number[] {
    const deduped = new Set<number>();
    for (const value of rawValues) {
      const parsed = Number.parseInt(String(value ?? ''), 10);
      if (Number.isFinite(parsed)) {
        deduped.add(parsed);
      }
    }
    return Array.from(deduped.values());
  }

  private resolveRowManufacturer(
    row: ActivityLogRow
  ): { id: string; name: string; locationId: string | number | null; locationIds: number[] } | null {
    if (this.normalizeManufacturerFilterName(row.manufacturerName ?? '') === 'multiple') {
      return null;
    }

    const manufacturers = this.manufacturersById();
    if (row.manufacturerId) {
      const direct = manufacturers.get(String(row.manufacturerId)) ?? null;
      if (direct) return direct;
    }

    const rowCandidates = [row.manufacturerLocationId, row.locationId, ...(row.locationIds ?? []).map(String)]
      .map((value) => this.normalizeEntityId(value))
      .filter((value): value is string => !!value);

    if (rowCandidates.length > 0) {
      const matchedManufacturers = new Map<string, ReturnType<typeof manufacturers.get>>();
      for (const manufacturer of manufacturers.values()) {
        const manufacturerId = this.normalizeEntityId(manufacturer.id);
        const manufacturerLocationIds = [
          manufacturer.locationId,
          ...manufacturer.locationIds.map((locationId) => String(locationId)),
        ]
          .map((value) => this.normalizeEntityId(value))
          .filter((value): value is string => !!value);

        if (manufacturerId && rowCandidates.includes(manufacturerId)) {
          matchedManufacturers.set(manufacturer.id, manufacturer);
          continue;
        }

        if (manufacturerLocationIds.some((candidate) => rowCandidates.includes(candidate))) {
          matchedManufacturers.set(manufacturer.id, manufacturer);
        }
      }

      if (matchedManufacturers.size === 1) {
        return Array.from(matchedManufacturers.values())[0] ?? null;
      }
      if (matchedManufacturers.size > 1) {
        return null;
      }
    }

    const normalizedRowManufacturerName = this.normalizeManufacturerFilterName(row.manufacturerName ?? '');
    if (normalizedRowManufacturerName) {
      const exactNameMatches = Array.from(manufacturers.values()).filter((manufacturer) => {
        const normalizedManufacturerName = this.normalizeManufacturerFilterName(manufacturer.name ?? '');
        return normalizedManufacturerName === normalizedRowManufacturerName;
      });
      if (exactNameMatches.length > 0) {
        return exactNameMatches[0];
      }
    }

    return null;
  }

  onActivityRowSaveRequested(request: DataManagementSaveRequest): void {
    const row = request.row;
    const project = this.effectiveProjects().find((candidate) => String(candidate.id) === row.projectId);
    if (!project) {
      const message = `Cannot edit ${row.entityName} because the project is not available.`;
      this.toastr.warning(message, 'Edit');
      request.reject(message);
      return;
    }

    const client = row.clientId
      ? this.effectiveClients().find(
        (candidate) => this.normalizeClientId(candidate.id) === this.normalizeClientId(row.clientId)
      ) ?? null
      : null;
    const location = row.locationId
      ? this.effectiveLocations().find((candidate) => String(candidate.id) === row.locationId) ?? null
      : null;
    const manufacturer = this.resolveRowManufacturer(row);
    const requestedManufacturerLocationId = this.normalizeEntityId(request.draft.manufacturerDraft.locationId);
    const currentManufacturerLocationId = this.normalizeEntityId(row.manufacturerLocationId ?? row.locationId);

    if (isDevMode()) {
      console.info('[DataManagement] Project row save requested', {
        projectId: row.projectId,
        resolvedManufacturerId: manufacturer?.id ?? null,
        requestedManufacturerLocationId,
        currentManufacturerLocationId,
        manufacturerDraftDisabled: request.draft.manufacturerDraft.disabled,
      });
    }

    void this.dataManagementMutation
      .saveRowDraft({
        row,
        draft: request.draft,
        project,
        client,
        manufacturer,
        location,
      })
      .then((result) => {
        const hasChanges = Object.values(result.changed).some(Boolean);
        if (isDevMode()) {
          console.info('[DataManagement] Project row save result', {
            projectId: row.projectId,
            changed: result.changed,
            updatedManufacturerId: result.updatedManufacturer?.id ?? null,
            updatedManufacturerLocationId: result.updatedManufacturer?.locationId ?? null,
          });
        }

        if (!hasChanges) {
          this.toastr.info('No changes were saved.', 'Data management');
          request.resolve();
          return;
        }

        const normalizedUpdate = row.updatedAt ?? new Date().toISOString();
        this.activityRowOverrides.update((current) => {
          const next = new Map(current);
          next.set(row.id, {
            entityName: request.draft.projectDraft.name,
            locationName: request.draft.locationDraft.name,
            clientName: request.draft.clientDraft.name,
            manufacturerName: request.draft.manufacturerDraft.name,
            updatedAt: normalizedUpdate,
          });
          return next;
        });

        this.projectDeltaById.update((entries) => {
          const next = new Map(entries);
          const key = String(project.id);
          const previous = next.get(key) ?? {};
          const projectPatch = {
            ...previous,
            id: project.id,
            projectName: result.updatedProject?.projectName ?? request.draft.projectDraft.name,
            projectTypeId: this.asProjectTypeId(
              result.updatedProject?.projectTypeId ?? request.draft.projectDraft.projectTypeId
            ),
            contract: this.readProjectContract(result.updatedProject) ?? request.draft.projectDraft.contract,
            hasRoadTest: this.readProjectRoadTest(result.updatedProject) ?? request.draft.projectDraft.hasRoadTest,
            lastUpdate: result.updatedProject?.lastUpdate ?? normalizedUpdate,
            status: result.updatedProject?.status ?? project.status,
            closed: result.updatedProject?.closed ?? project.closed,
          } as Partial<Project>;
          next.set(key, projectPatch);
          return next;
        });

        if (result.updatedClient) {
          const updatedClient = result.updatedClient;
          this.clientDeltaById.update((entries) => {
            const next = new Map(entries);
            next.set(String(updatedClient.id), {
              id: updatedClient.id,
              name: updatedClient.name,
              locationId: updatedClient.locationId ?? null,
              coordinates: updatedClient.coordinates,
            });
            return next;
          });
        }

        if (result.updatedLocation) {
          const updatedLocation = result.updatedLocation;
          this.locationDeltaById.update((entries) => {
            const next = new Map(entries);
            next.set(String(updatedLocation.id), {
              id: updatedLocation.id,
              name: updatedLocation.name,
              latitude: updatedLocation.latitude,
              longitude: updatedLocation.longitude,
            });
            return next;
          });
        }

        if (result.updatedManufacturer?.id != null) {
          const manufacturerNumericId = Number.parseInt(String(result.updatedManufacturer.id), 10);
          const fallbackManufacturerNumericId = Number.parseInt(String(manufacturer?.id ?? ''), 10);
          const normalizedManufacturerId = Number.isFinite(manufacturerNumericId)
            ? manufacturerNumericId
            : (Number.isFinite(fallbackManufacturerNumericId) ? fallbackManufacturerNumericId : null);
          if (normalizedManufacturerId != null) {
            this.manufacturerDeltaById.update((entries) => {
              const next = new Map(entries);
              const updatedManufacturerLocationIdRaw =
                result.updatedManufacturer!.locationId ?? manufacturer?.locationId ?? null;
              const updatedManufacturerLocationId =
                updatedManufacturerLocationIdRaw == null
                  ? null
                  : Number.parseInt(String(updatedManufacturerLocationIdRaw), 10);
              next.set(String(result.updatedManufacturer!.id), {
                id: normalizedManufacturerId,
                name:
                  result.updatedManufacturer!.manufacturerName ??
                  request.draft.manufacturerDraft.name,
                locationId: Number.isFinite(updatedManufacturerLocationId)
                  ? updatedManufacturerLocationId
                  : null,
              });
              return next;
            });
          }
        }

        this.retryRequiredDataLoad();
        this.toastr.success(`Saved changes for ${row.entityName}.`, 'Data management');
        request.resolve();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to save row.';
        this.toastr.error(message, 'Data management');
        request.reject(message);
      });
  }

  onActivityRowCreateRequested(request: ProjectManagementCreateRequest): void {
    if (!this.canEditWarRoom()) {
      const message = 'Edit mode is unavailable for your account.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    const projectDraft = request.draft.projectDraft;
    const name = projectDraft.name.trim();
    const normalizedClientId = this.normalizeClientId(projectDraft.clientId);
    const projectTypeId = Number.parseInt(String(projectDraft.projectTypeId ?? '').trim(), 10);
    const locationIds = this.parseLocationIds(projectDraft.locationIds ?? []);

    if (!name) {
      const message = 'Project name is required.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }
    if (!normalizedClientId) {
      const message = 'Client is required.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }
    if (!Number.isFinite(projectTypeId)) {
      const message = 'Project type is required.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }
    if (locationIds.length === 0) {
      const message = 'Select at least one location.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    const selectedClient = this.effectiveClients().find(
      (candidate) => this.normalizeClientId(candidate.id) === normalizedClientId
    );

    void this.projectService.addProject({
      projectName: name,
      clientId: normalizedClientId,
      clientName: selectedClient?.name,
      assessmentType: projectDraft.type?.trim() || String(projectTypeId),
      projectTypeId: projectTypeId,
      locationIds,
      locationId: String(locationIds[0]),
      status: 'Open',
      contract: projectDraft.contract?.trim() ?? '',
      hasRoadTest: Boolean(projectDraft.hasRoadTest),
    }).subscribe({
      next: () => {
        this.retryRequiredDataLoad();
        this.toastr.success(`Created project ${name}.`, 'Data management');
        request.resolve();
      },
      error: (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to create project.';
        this.toastr.error(message, 'Data management');
        request.reject(message);
      },
    });
  }

  onClientRowSaveRequested(request: ClientManagementSaveRequest): void {
    if (!this.canEditWarRoom()) {
      const message = 'Edit mode is unavailable for your account.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    const row = request.row;
    const client = this.effectiveClients().find(
      (candidate) => this.normalizeClientId(candidate.id) === this.normalizeClientId(row.clientId)
    );
    if (!client) {
      const message = `Cannot edit ${row.clientName} because the client is not available.`;
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    const locationId = this.normalizeEntityId(row.locationId ?? client.locationId);
    const location = locationId
      ? this.effectiveLocations().find((candidate) => this.normalizeEntityId(candidate.id) === locationId) ?? null
      : null;

    void this.dataManagementMutation
      .saveClientEntityDraft({
        row,
        draft: request.draft,
        client,
        location,
      })
      .then((result) => {
        if (result.updatedClient) {
          const updatedClient = result.updatedClient;
          this.clientDeltaById.update((entries) => {
            const next = new Map(entries);
            next.set(String(updatedClient.id), {
              id: updatedClient.id,
              name: updatedClient.name,
              locationId: updatedClient.locationId ?? null,
              coordinates: updatedClient.coordinates,
            });
            return next;
          });
        }

        if (result.updatedLocation) {
          const updatedLocation = result.updatedLocation;
          this.locationDeltaById.update((entries) => {
            const next = new Map(entries);
            next.set(String(updatedLocation.id), {
              id: updatedLocation.id,
              name: updatedLocation.name,
              latitude: updatedLocation.latitude,
              longitude: updatedLocation.longitude,
            });
            return next;
          });
        }

        if (Object.values(result.changed).some(Boolean)) {
          this.retryRequiredDataLoad();
        }
        this.toastr.success(`Saved changes for ${row.clientName}.`, 'Data management');
        request.resolve();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to save client.';
        this.toastr.error(message, 'Data management');
        request.reject(message);
      });
  }

  onClientRowCreateRequested(request: ClientManagementCreateRequest): void {
    if (!this.canEditWarRoom()) {
      const message = 'Edit mode is unavailable for your account.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    const name = request.draft.name.trim();
    const locationIds = this.parseLocationIds(request.draft.locationIds ?? []);
    if (!name) {
      const message = 'Client name is required.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    void this.clientService.createClient({
      customerName: name,
      customerLogo: request.draft.customerLogo ?? null,
      customerLogoName: request.draft.customerLogoName ?? null,
      locationIds,
    }).subscribe({
      next: () => {
        this.retryRequiredDataLoad();
        this.toastr.success(`Created client ${name}.`, 'Data management');
        request.resolve();
      },
      error: (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to create client.';
        this.toastr.error(message, 'Data management');
        request.reject(message);
      },
    });
  }

  onManufacturerRowSaveRequested(request: ManufacturerManagementSaveRequest): void {
    if (!this.canEditWarRoom()) {
      const message = 'Edit mode is unavailable for your account.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    const row = request.row;
    const manufacturer = this.effectiveManufacturers().find(
      (candidate) => String(candidate.id) === row.manufacturerId
    );
    if (!manufacturer) {
      const message = `Cannot edit ${row.manufacturerName} because the manufacturer is not available.`;
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    const locationId = this.normalizeEntityId(row.locationId ?? manufacturer.locationId);
    const location = locationId
      ? this.effectiveLocations().find((candidate) => this.normalizeEntityId(candidate.id) === locationId) ?? null
      : null;

    void this.dataManagementMutation
      .saveManufacturerEntityDraft({
        row,
        draft: request.draft,
        manufacturer: {
          id: String(manufacturer.id),
          name: manufacturer.name ?? String(manufacturer.id),
          locationId: manufacturer.locationId ?? row.locationId,
        },
        location,
      })
      .then((result) => {
        if (result.updatedManufacturer?.id != null) {
          const numericId = Number.parseInt(String(result.updatedManufacturer.id), 10);
          const resolvedNumericId = Number.isFinite(numericId)
            ? numericId
            : Number.parseInt(String(manufacturer.id), 10);
          if (Number.isFinite(resolvedNumericId)) {
            this.manufacturerDeltaById.update((entries) => {
              const next = new Map(entries);
              const nextLocationIdRaw =
                result.updatedManufacturer?.locationId ?? manufacturer.locationId ?? row.locationId ?? null;
              const nextLocationId =
                nextLocationIdRaw == null ? null : Number.parseInt(String(nextLocationIdRaw), 10);
              next.set(String(result.updatedManufacturer!.id), {
                id: Number(resolvedNumericId),
                name: result.updatedManufacturer!.manufacturerName ?? request.draft.name,
                locationId: Number.isFinite(nextLocationId) ? nextLocationId : null,
              });
              return next;
            });
          }
        } else if (result.changed.manufacturer) {
          const numericId = Number.parseInt(String(manufacturer.id), 10);
          if (Number.isFinite(numericId)) {
            this.manufacturerDeltaById.update((entries) => {
              const next = new Map(entries);
              const nextLocationIdRaw = manufacturer.locationId ?? row.locationId ?? null;
              const nextLocationId =
                nextLocationIdRaw == null ? null : Number.parseInt(String(nextLocationIdRaw), 10);
              next.set(String(manufacturer.id), {
                id: numericId,
                name: request.draft.name,
                locationId: Number.isFinite(nextLocationId) ? nextLocationId : null,
              });
              return next;
            });
          }
        }

        if (result.updatedLocation) {
          const updatedLocation = result.updatedLocation;
          this.locationDeltaById.update((entries) => {
            const next = new Map(entries);
            next.set(String(updatedLocation.id), {
              id: updatedLocation.id,
              name: updatedLocation.name,
              latitude: updatedLocation.latitude,
              longitude: updatedLocation.longitude,
            });
            return next;
          });
        }

        if (Object.values(result.changed).some(Boolean)) {
          this.retryRequiredDataLoad();
        }
        this.toastr.success(`Saved changes for ${row.manufacturerName}.`, 'Data management');
        request.resolve();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to save manufacturer.';
        this.toastr.error(message, 'Data management');
        request.reject(message);
      });
  }

  onManufacturerRowCreateRequested(request: ManufacturerManagementCreateRequest): void {
    if (!this.canEditWarRoom()) {
      const message = 'Edit mode is unavailable for your account.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    const name = request.draft.name.trim();
    const locationIds = this.parseLocationIds(request.draft.locationIds ?? []);
    if (!name) {
      const message = 'Manufacturer name is required.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    void this.projectService.createManufacturer({
      manufacturerName: name,
      manufacturerLogo: request.draft.manufacturerLogo ?? null,
      manufacturerLogoName: request.draft.manufacturerLogoName ?? null,
      locationIds,
    }).subscribe({
      next: () => {
        this.retryRequiredDataLoad();
        this.toastr.success(`Created manufacturer ${name}.`, 'Data management');
        request.resolve();
      },
      error: (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to create manufacturer.';
        this.toastr.error(message, 'Data management');
        request.reject(message);
      },
    });
  }

  onLocationRowSaveRequested(request: LocationManagementSaveRequest): void {
    if (!this.canEditWarRoom()) {
      const message = 'Edit mode is unavailable for your account.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    const row = request.row;
    const location = this.effectiveLocations().find((candidate) => String(candidate.id) === row.locationId);
    if (!location) {
      const message = `Cannot edit ${row.locationName} because the location is not available.`;
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    void this.dataManagementMutation
      .saveLocationEntityDraft({
        row,
        draft: request.draft,
        location,
      })
      .then((result) => {
        if (result.updatedLocation) {
          const updatedLocation = result.updatedLocation;
          this.locationDeltaById.update((entries) => {
            const next = new Map(entries);
            next.set(String(updatedLocation.id), {
              id: updatedLocation.id,
              name: updatedLocation.name,
              latitude: updatedLocation.latitude,
              longitude: updatedLocation.longitude,
            });
            return next;
          });
        }

        if (result.changed.location) {
          this.retryRequiredDataLoad();
        }
        this.toastr.success(`Saved changes for ${row.locationName}.`, 'Data management');
        request.resolve();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to save location.';
        this.toastr.error(message, 'Data management');
        request.reject(message);
      });
  }

  onLocationRowCreateRequested(request: LocationManagementCreateRequest): void {
    if (!this.canEditWarRoom()) {
      const message = 'Edit mode is unavailable for your account.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    const name = request.draft.name.trim();
    if (!name) {
      const message = 'Location name is required.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    const latitude = Number(request.draft.latitude);
    const longitude = Number(request.draft.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      const message = 'Latitude and longitude must be numeric.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    if (latitude < -90 || latitude > 90) {
      const message = 'Latitude must be between -90 and 90.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }
    if (longitude < -180 || longitude > 180) {
      const message = 'Longitude must be between -180 and 180.';
      this.toastr.warning(message, 'Data management');
      request.reject(message);
      return;
    }

    void this.locationService.createLocation({
      name,
      latitude,
      longitude,
    }).subscribe({
      next: () => {
        this.retryRequiredDataLoad();
        this.toastr.success(`Created location ${name}.`, 'Data management');
        request.resolve();
      },
      error: (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to create location.';
        this.toastr.error(message, 'Data management');
        request.reject(message);
      },
    });
  }

  onActivityRowDelete(row: ActivityLogRow): void {
    this.toastr.warning(`Delete action for ${row.entityName} is not enabled in this pass.`, 'Not implemented');
  }

  showPanel(_panel: 'log'): void {
    this.panelVisible.set(true);
    this.announce('Data management panel opened.');
  }

  setLogPanelMode(mode: 'client' | 'manufacturer'): void {
    if (this.mapViewMode() === 'manufacturer' && mode === 'client') {
      return;
    }
    this.logPanelMode.set(mode);
  }

  onClientSelected(clientId: string): void {
    const normalizedClientId = this.normalizeClientId(clientId);
    if (!normalizedClientId) return;
    const selection: FleetSelection = { level: 'client', id: normalizedClientId };
    this.warRoomService.selectEntity(selection);
    this.warRoomService.setMapViewMode('project'); // After selectEntity; project view shows route lines for this client's projects
    this.showPanel('log');
    this.mapComponent().zoomToEntity(normalizedClientId);
    // Filter map to show only this client's project locations and connections
    this.filterDraft.update((f) => ({ ...f, clientIds: [normalizedClientId] }));
    this.filterApplied.set({ ...this.filterApplied(), clientIds: [normalizedClientId] });
    this.selectedProjectId.set(null); // Clear project selection so all filtered routes show (not just one)
    // Always refresh routes when client filter changes to ensure correct routes are fetched
    this.projectRoutesRefreshTrigger.update((n) => n + 1);
  }

  onClientPanelSaveComplete(): void {
    this.retryRequiredDataLoad();
  }

  toggleMapExpanded(): void {
    if (this.expandMapTriggersBrowserFullscreen()) {
      this.mapComponent()?.toggleFullscreen();
      return;
    }
    const next = !this.mapExpanded();
    this.mapExpanded.set(next);
    this.applyMapExpandedDomState(next);
    if (next) {
      this.panelVisible.set(false);
      this.announce('Map expanded.');
    } else {
      this.announce('Map returned to standard view.');
    }
  }

  onMapFullscreenChange(active: boolean): void {
    this.mapBrowserFullscreenActive.set(active);
  }

  private applyMapExpandedDomState(expanded: boolean): void {
    if (!document.body) {
      return;
    }
    document.body.classList.toggle(MAP_EXPANDED_CLASS, expanded);

    // Prevent overflow lock conflicts with host pages (e.g. Admin Dashboard fullscreen modal)
    // that also set `document.body.style.overflow = 'hidden'`.
    if (expanded) {
      this.mapExpandedPreviousBodyOverflow = document.body.style.overflow;
      if (this.mapExpandedPreviousBodyOverflow !== MAP_EXPANDED_SCROLL_LOCK_STYLE) {
        document.body.style.overflow = MAP_EXPANDED_SCROLL_LOCK_STYLE;
        this.mapExpandedOwnsBodyOverflowLock = true;
      } else {
        this.mapExpandedOwnsBodyOverflowLock = false;
      }
      return;
    }

    if (this.mapExpandedOwnsBodyOverflowLock) {
      document.body.style.overflow = this.mapExpandedPreviousBodyOverflow;
    }
    this.mapExpandedOwnsBodyOverflowLock = false;
  }

  /**
   * Toggle filters panel visibility.
   * Realtime: does not trigger full refresh or route refetch; only opens/closes the panel.
   */
  toggleFiltersPanel(): void {
    if (this.filtersPanelVisible()) {
      this.cancelFiltersPanel();
      return;
    }
    this.openFiltersPanel();
  }

  /** Open filters panel (used by FAB - never closes) */
  openFiltersPanel(): void {
    if (this.filtersPanelVisible()) return;
    this.syncDraftFromApplied();
    this.filtersPanelVisible.set(true);
  }

  cancelFiltersPanel(): void {
    this.syncDraftFromApplied();
    this.filtersPanelVisible.set(false);
  }

  resetDraftFilters(): void {
    const defaults = createDefaultFilters();
    const pinnedClientId = this.pinnedClientId();
    const next = pinnedClientId ? { ...defaults, clientIds: [pinnedClientId] } : defaults;
    this.filterDraft.set(next);
    this.resetFilterOverlayControls();
  }

  toggleFilterSection(section: 'client' | 'manufacturer' | 'projectType' | 'project'): void {
    const current = this.expandedFilterSection();
    this.expandedFilterSection.set(current === section ? null : section);
  }

  toggleRegion(region: string): void {
    this.filterDraft.update((filters) => {
      const nextRegions = new Set(filters.regions);
      if (nextRegions.has(region)) {
        nextRegions.delete(region);
      } else {
        nextRegions.add(region);
      }
      return { ...filters, regions: Array.from(nextRegions) };
    });
  }

  setStatusFilter(status: FilterStatus): void {
    this.filterDraft.update((filters) => ({ ...filters, status }));
  }

  applyFilters(): void {
    const draft = this.filterDraft();
    const nextApplied: WarRoomFilters = {
      status: draft.status,
      regions: [...draft.regions],
      clientIds: this.normalizeClientIdList(draft.clientIds),
      manufacturerIds: [...draft.manufacturerIds],
      projectTypeIds: [...draft.projectTypeIds],
      projectIds: [...draft.projectIds],
    };
    this.filterApplied.set(nextApplied);
    this.filterDraft.set(this.cloneFilters(nextApplied));
    this.selectionOutsideFiltersNotice.set(null);
    this.filtersPanelVisible.set(false);
    this.announce('Filters applied. ' + this.activeFilterCount() + ' filters active.');
  }

  toggleClient(clientId: string): void {
    const normalizedClientId = this.normalizeClientId(clientId);
    if (!normalizedClientId) return;
    this.filterDraft.update((filters) => {
      const nextIds = new Set(filters.clientIds);
      if (nextIds.has(normalizedClientId)) nextIds.delete(normalizedClientId);
      else nextIds.add(normalizedClientId);
      return { ...filters, clientIds: this.normalizeClientIdList(Array.from(nextIds)) };
    });
  }

  toggleManufacturer(manufacturerId: string): void {
    this.filterDraft.update((filters) => {
      const nextIds = new Set(filters.manufacturerIds);
      if (nextIds.has(manufacturerId)) nextIds.delete(manufacturerId);
      else nextIds.add(manufacturerId);
      return { ...filters, manufacturerIds: Array.from(nextIds) };
    });
  }

  toggleProjectType(projectTypeId: string): void {
    this.filterDraft.update((filters) => {
      const nextIds = new Set(filters.projectTypeIds);
      if (nextIds.has(projectTypeId)) nextIds.delete(projectTypeId);
      else nextIds.add(projectTypeId);
      return { ...filters, projectTypeIds: Array.from(nextIds) };
    });
  }

  toggleProject(projectId: string): void {
    this.filterDraft.update((filters) => {
      const nextIds = new Set(filters.projectIds);
      if (nextIds.has(projectId)) nextIds.delete(projectId);
      else nextIds.add(projectId);
      return { ...filters, projectIds: Array.from(nextIds) };
    });
  }

  resetFilters(): void {
    const defaults = createDefaultFilters();
    const pinnedClientId = this.pinnedClientId();
    const next = pinnedClientId ? { ...defaults, clientIds: [pinnedClientId] } : defaults;
    this.filterDraft.set(next);
    this.filterApplied.set(next);
    this.resetFilterOverlayControls();
  }

  clearAllFilters(): void {
    this.resetFilters();
    this.announce('All filters cleared.');
  }

  isClientSelectedInDraft(clientId: string): boolean {
    const normalizedClientId = this.normalizeClientId(clientId);
    if (!normalizedClientId) return false;
    return this.filterDraft().clientIds.some((id) => this.normalizeClientId(id) === normalizedClientId);
  }

  removeFilter(item: ActiveFilterItem): void {
    if (this.isPinnedClientMode() && item.type === 'client') {
      return;
    }
    const current = this.filterApplied();
    const next = { ...current };

    if (item.type === 'status') {
      next.status = 'all';
    } else if (item.type === 'client') {
      const targetClientId = this.normalizeClientId(item.value);
      next.clientIds = this.normalizeClientIdList(
        next.clientIds.filter((id) => this.normalizeClientId(id) !== targetClientId)
      );
    } else if (item.type === 'manufacturer') {
      next.manufacturerIds = next.manufacturerIds.filter((id) => id !== item.value);
    } else if (item.type === 'projectType') {
      next.projectTypeIds = next.projectTypeIds.filter((id) => id !== item.value);
    } else if (item.type === 'project') {
      next.projectIds = next.projectIds.filter((id) => id !== item.value);
      const currentSelectedProjectId = this.selectedProjectId();
      if (currentSelectedProjectId && !next.projectIds.includes(currentSelectedProjectId)) {
        this.selectedProjectId.set(next.projectIds[0] ?? null);
      }
    } else if (item.type === 'region') {
      next.regions = next.regions.filter(r => r !== item.value);
    }

    this.filterApplied.set(next);
    // Sync draft so reopening the panel shows correct state
    this.filterDraft.set(this.cloneFilters(next));
  }

  private buildActivityProjectionRows(filters: WarRoomFilters): ActivityLogRow[] {
    const data = this.tableProjectionData();
    const projectionFilters = this.toActivityProjectionFilters(filters);
    return this.activityLogTableService.buildRows(
      data.projectVms,
      data.clientVms,
      data.manufacturerVms,
      data.locationVms,
      projectionFilters
    );
  }

  private toActivityProjectionFilters(filters: WarRoomFilters): ActivityLogProjectionFilters {
    const normalizedClientIds = this.normalizeClientIdList(filters.clientIds);
    const effectiveStatus = this.mapViewMode() === 'manufacturer' ? 'all' : filters.status;
    let constrainedProjectIds = [...filters.projectIds];

    if (filters.regions.length > 0) {
      const regionProjectIds = this.getProjectIdsMatchingRegions(filters.regions);
      constrainedProjectIds = constrainedProjectIds.length > 0
        ? constrainedProjectIds.filter((id) => regionProjectIds.has(String(id)))
        : Array.from(regionProjectIds);
      if (constrainedProjectIds.length === 0) {
        constrainedProjectIds = ['__no_region_match__'];
      }
    }

    return {
      status: effectiveStatus,
      clientIds: normalizedClientIds,
      manufacturerIds: [...filters.manufacturerIds],
      projectTypeIds: [...filters.projectTypeIds],
      projectIds: constrainedProjectIds,
    };
  }

  private getProjectIdsMatchingRegions(selectedRegions: string[]): Set<string> {
    if (selectedRegions.length === 0) {
      return new Set(this.effectiveProjects().map((project) => String(project.id)));
    }

    const factoryByNormalizedId = new Map<string, FactoryLocation>();
    for (const factory of this.factories()) {
      const factoryId = this.normalizeEntityId(factory.id);
      if (!factoryId) continue;
      factoryByNormalizedId.set(factoryId, factory);
    }

    const locationsById = this.locationsById();
    const matchingProjectIds = new Set<string>();
    for (const project of this.effectiveProjects()) {
      const locationId = this.normalizeEntityId(project.manufacturerLocationId ?? project.locationId);
      const factory = locationId ? factoryByNormalizedId.get(locationId) : undefined;
      if (factory && this.matchesRegionsForFactory(factory, selectedRegions)) {
        matchingProjectIds.add(String(project.id));
        continue;
      }

      if (locationId) {
        const location = locationsById.get(locationId);
        const coords = coerceCoordinates(location?.latitude, location?.longitude);
        const region = this.resolveRegion(location?.name, coords ?? undefined);
        if (region && selectedRegions.includes(region)) {
          matchingProjectIds.add(String(project.id));
          continue;
        }
      }

      const directRegion = this.resolveRegion(project.location, undefined);
      if (directRegion && selectedRegions.includes(directRegion)) {
        matchingProjectIds.add(String(project.id));
      }
    }

    return matchingProjectIds;
  }

  private syncDraftFromApplied(): void {
    this.filterDraft.set(this.cloneFilters(this.filterApplied()));
    this.resetFilterOverlayControls();
  }

  private cloneFilters(filters: WarRoomFilters): WarRoomFilters {
    return {
      status: filters.status,
      regions: [...filters.regions],
      clientIds: [...filters.clientIds],
      manufacturerIds: [...filters.manufacturerIds],
      projectTypeIds: [...filters.projectTypeIds],
      projectIds: [...filters.projectIds],
    };
  }

  private resetFilterOverlayControls(): void {
    this.expandedFilterSection.set(null);
    this.clientFilterSearch.set('');
    this.manufacturerFilterSearch.set('');
    this.projectTypeFilterSearch.set('');
    this.projectFilterSearch.set('');
    this.showUnavailableClients.set(false);
    this.showUnavailableManufacturers.set(false);
    this.showUnavailableProjectTypes.set(false);
    this.showUnavailableProjects.set(false);
  }

  private filtersEqual(a: WarRoomFilters, b: WarRoomFilters): boolean {
    if (a.status !== b.status) return false;
    return this.areStringArraysEqualAsSets(a.regions, b.regions)
      && this.areStringArraysEqualAsSets(this.normalizeClientIdList(a.clientIds), this.normalizeClientIdList(b.clientIds))
      && this.areStringArraysEqualAsSets(a.manufacturerIds, b.manufacturerIds)
      && this.areStringArraysEqualAsSets(a.projectTypeIds, b.projectTypeIds)
      && this.areStringArraysEqualAsSets(a.projectIds, b.projectIds);
  }

  private areStringArraysEqualAsSets(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((value, index) => value === sortedB[index]);
  }

  /**
   * Switch map view mode (project / client / manufacturer).
   * Realtime: does not call retryRequiredDataLoad or projectRoutesRefreshTrigger; map re-renders from existing data via projectRoutesForMap().
   */
  setMapViewMode(mode: MapViewMode): void {
    if (this.isClientOrUser() && mode === 'client') {
      if (this.mapViewMode() !== 'project') {
        this.warRoomService.setMapViewMode('project');
      }
      this.announce('Client view is unavailable for your account.');
      return;
    }
    this.warRoomService.setManufacturerFilterSubsidiaryId(null);
    if (mode === 'manufacturer') {
      this.logPanelMode.set('manufacturer');
    }
    if (mode === 'client') {
      this.selectedProjectId.set(null);
      this.filterApplied.update((current) => ({ ...current, clientIds: [] }));
      this.filterDraft.update((current) => ({ ...current, clientIds: [] }));
    }
    this.warRoomService.setMapViewMode(mode);
    this.announce('Switched to ' + mode + ' view.');
  }

  toggleTacticalMode(): void {
    const next = !this.tacticalMode();
    this.tacticalMode.set(next);
    if (next) {
      this.filtersPanelVisible.set(false);
      this.panelVisible.set(false);
    }
    this.announce(next ? 'Tactical view on. Map only view.' : 'Tactical view off.');
  }

  /** Captures route screenshot for project, stores it, and shows toast. Optionally triggers download. */
  async captureAndStoreForProject(projectId: string, projectName?: string): Promise<void> {
    await this.captureWorkflow.captureAndStoreForProject(this.captureWorkflowContext(), projectId, projectName);
  }

  /** Captures all routes for a client into one screenshot, stores it, and triggers download. */
  async captureAndStoreForClient(clientId: string): Promise<void> {
    await this.captureWorkflow.captureAndStoreForClient(this.captureWorkflowContext(), clientId);
  }

  onRoutePreviewRequested(projectId: string): void {
    const projectName = this.effectiveProjects().find((p) => String(p.id) === projectId)?.projectName;
    this.captureWorkflow.onRoutePreviewRequested(this.captureWorkflowContext(), projectId, projectName);
  }

  onClientCaptureRequested(clientId: string): void {
    const normalizedClientId = this.normalizeClientId(clientId);
    if (!normalizedClientId) return;
    this.warRoomService.selectEntity({ level: 'client', id: normalizedClientId });
    this.filterDraft.update((f) => ({ ...f, clientIds: [normalizedClientId] }));
    this.filterApplied.set({ ...this.filterApplied(), clientIds: [normalizedClientId] });
    this.projectRoutesRefreshTrigger.update((n) => n + 1);
    this.captureWorkflow.onClientCaptureRequested(this.captureWorkflowContext(), normalizedClientId);
  }

  onRouteSelected(payload: { routeId: string; projectId?: string }): void {
    this.selectionOutsideFiltersNotice.set(null);
    this.selectedRouteId.set(payload.routeId ?? null);
    if (payload.projectId) {
      this.selectedProjectId.set(payload.projectId);
    }
  }

  onProjectHudSelected(project: Project): void {
    const routesAtClick = this.projectRoutes().length;
    const clientsCount = this.effectiveClients()?.length ?? 0;
    const factoriesCount = this.factories().length;
    this.selectedProjectId.set(String(project.id));
    if (project.manufacturerLocationId) {
      this.warRoomService.selectEntity({
        level: 'manufacturer',
        id: project.manufacturerLocationId,
        parentGroupId: undefined,
        subsidiaryId: undefined,
        manufacturerLocationId: project.manufacturerLocationId,
        factoryId: project.manufacturerLocationId,
      });
      this.warRoomService.setMapViewMode('project'); // After selectEntity so it is not overwritten by selectEntity's view-mode sync
      if (routesAtClick === 0 && clientsCount > 0 && factoriesCount > 0) {
        this.projectRoutesRefreshTrigger.update((n) => n + 1); // Only refresh when routes empty but data ready (avoids clearing routes on race)
      }
      this.warRoomService.requestPanToEntity(project.manufacturerLocationId);
      // Direct zoom after view updates (like onClientSelected) - handles timing
      setTimeout(() => {
        this.mapComponent().zoomToEntity(project.manufacturerLocationId!, 8);
      }, FIT_BOUNDS_DELAY_MS);
      this.announce(`Selected project ${project.projectName || 'Project'}. Panning to ${project.manufacturer ?? 'factory'}.`);
    } else if (project.clientId) {
      const normalizedClientId = this.normalizeClientId(project.clientId);
      if (!normalizedClientId) return;
      // Fallback: pan to client when project has no manufacturer location (e.g. Metrolinx)
      this.warRoomService.selectEntity({ level: 'client', id: normalizedClientId });
      this.warRoomService.setMapViewMode('project'); // After selectEntity so it is not overwritten
      if (routesAtClick === 0 && clientsCount > 0 && factoriesCount > 0) {
        this.projectRoutesRefreshTrigger.update((n) => n + 1);
      }
      this.showPanel('log');
      this.filterDraft.update((f) => ({ ...f, clientIds: [normalizedClientId] }));
      this.filterApplied.set({ ...this.filterApplied(), clientIds: [normalizedClientId] });
      setTimeout(() => {
        this.mapComponent().zoomToEntity(normalizedClientId, 8);
      }, FIT_BOUNDS_DELAY_MS);
      this.announce(`Selected project ${project.projectName || 'Project'}. Panning to ${project.clientName ?? project.clientId ?? 'client'}.`);
    }
  }

  onNodeSelected(node: Node | undefined): void {
    this.selectionOutsideFiltersNotice.set(null);
    if (node) {
      const selection = this.panelActionsWorkflow.onNodeSelected(node);
      if (selection) {
        this.onEntitySelected(selection);
      }

      // Sync selectedProjectId: factory → first matching project
      const manufacturerLocationId = node.manufacturerLocationId ?? node.factoryId;
      if (manufacturerLocationId) {
        this.projectService.getProjectsByManufacturerLocation(manufacturerLocationId).pipe(take(1)).subscribe((projects) => {
          const first = projects[0];
          this.selectedProjectId.set(first ? String(first.id) : null);
        });
      } else if (node.level === 'client' || node.clientId) {
        this.projectService.getProjectsByClient(node.companyId).pipe(take(1)).subscribe((projects) => {
          const first = projects[0];
          this.selectedProjectId.set(first ? String(first.id) : null);
        });
      } else {
        this.selectedProjectId.set(null);
      }
    } else {
      this.warRoomService.selectEntity(null);
      this.selectedProjectId.set(null);
    }
  }

  async onFactoryDetailsUpdated(payload: FactoryEditPayload): Promise<void> {
    await this.projectWorkflow.onFactoryDetailsUpdated(
      this.projectWorkflowContext(),
      payload,
      (message, error) => this.logError(message, error)
    );
  }

  async onSubsidiaryDetailsUpdated(payload: SubsidiaryEditPayload): Promise<void> {
    await this.projectWorkflow.onSubsidiaryDetailsUpdated(
      this.projectWorkflowContext(),
      payload,
      (message, error) => this.logError(message, error)
    );
  }

  onSubsidiaryDeleted(subsidiaryId: string): void {
    this.warRoomService.deleteSubsidiary(subsidiaryId);
  }

  onFactoryDeleted(factoryId: string): void {
    this.warRoomService.deleteFactory(factoryId);
  }

  /** Single source of truth: ACTIVE and ONLINE are active; everything else is inactive. */
  private isActiveStatus(status: string | undefined): boolean {
    if (!status) return false;
    const s = String(status).toUpperCase().trim();
    return s === 'ACTIVE' || s === 'ONLINE';
  }

  private matchesStatus(status: NodeStatus | undefined, filter: FilterStatus): boolean {
    if (filter === 'all') return true;
    const isActive = this.isActiveStatus(status);
    return filter === 'active' ? isActive : !isActive;
  }

  private matchesOperationalStatus(status: string | undefined, filter: FilterStatus): boolean {
    if (filter === 'all') return true;
    const isActive = this.isActiveStatus(status);
    return filter === 'active' ? isActive : !isActive;
  }

  private mapRowStatusToProjectStatus(status: ActivityLogRow['status']): Project['status'] {
    if (status === 'Closed') return 'Closed';
    if (status === 'Under Inspection') return 'Delayed';
    return 'Open';
  }

  private normalizeProjectStatus(project: Project): 'Open' | 'Closed' | 'Delayed' {
    const closed = (project as { closed?: boolean | null }).closed;
    if (closed === true) return 'Closed';
    if (closed === false) return 'Open';

    const status = (project as { status?: 'Open' | 'Closed' | 'Delayed' | null }).status;
    return status ?? 'Open';
  }

  private readProjectContract(project: Project | null | undefined): string | null {
    if (!project) return null;
    return (project as { contract?: string | null }).contract ?? null;
  }

  private readProjectRoadTest(project: Project | null | undefined): boolean | null {
    if (!project) return null;
    return (project as { hasRoadTest?: boolean | null }).hasRoadTest ?? null;
  }

  private asProjectTypeId(value: unknown): Project['projectTypeId'] {
    return value as Project['projectTypeId'];
  }

  private matchesRegionsForNode(node: Node, selectedRegions: string[]): boolean {
    if (selectedRegions.length === 0) return true;
    const regions = this.getRegionsForNode(node);
    if (regions.size === 0) return false;
    return selectedRegions.some((region) => regions.has(region));
  }

  private getRegionForNodeIdStrict(nodeId: string): string | null {
    const node = this.nodesWithClients().find((candidate) => candidate.id === nodeId);
    if (!node) {
      return null;
    }
    return this.resolveRegion(node.country || node.city, node.coordinates);
  }

  private matchesRegionsForFactory(factory: FactoryLocation | undefined, selectedRegions: string[]): boolean {
    if (selectedRegions.length === 0) return true;
    if (!factory) return false;
    const region = this.getRegionForFactory(factory);
    return region ? selectedRegions.includes(region) : false;
  }

  private matchesRegionsForRoute(route: ProjectRoute, selectedRegions: string[]): boolean {
    if (selectedRegions.length === 0) return true;
    const targetId = route.toNodeId;
    const factory = this.factories().find((f) => f.id === targetId);
    if (factory) {
      return this.matchesRegionsForFactory(factory, selectedRegions);
    }
    const region = this.resolveRegion(undefined, route.toCoordinates);
    return region ? selectedRegions.includes(region) : false;
  }

  private getRegionsForNode(node: Node): Set<string> {
    // 1. Direct Region Mapping for Leaf Nodes (Factory/Individual)
    if (node.level === 'factory' || node.level === 'manufacturer') {
      const region = this.resolveRegion(node.country || node.city, node.coordinates);
      return region ? new Set([region]) : new Set();
    }

    // 2. Aggregate Mapping for Parent Groups
    if (node.level === 'parent') {
      const parentGroupId = node.parentGroupId || node.id;
      const group = this.parentGroups().find((item) => item.id === parentGroupId);
      return group ? this.getRegionsForFactories(group.subsidiaries.flatMap((sub) => sub.factories ?? [])) : new Set();
    }

    // Fallback
    const region = this.resolveRegion(node.country || node.city, node.coordinates);
    return region ? new Set([region]) : new Set();
  }

  private getRegionsForFactories(factories: FactoryLocation[]): Set<string> {
    const regions = new Set<string>();
    factories.forEach((factory) => {
      const region = this.getRegionForFactory(factory);
      if (region) {
        regions.add(region);
      }
    });
    return regions;
  }

  private getRegionForFactory(factory: FactoryLocation): string | null {
    return this.resolveRegion(factory.country || factory.city, factory.coordinates);
  }

  private resolveRegion(
    value?: string,
    coordinates?: { latitude: number; longitude: number } | null
  ): string | null {
    return this.getRegionForCountry(value) ?? this.getRegionForCoordinates(coordinates);
  }

  private getRegionForCoordinates(
    coordinates?: { latitude: number; longitude: number } | null
  ): string | null {
    if (!coordinates) return null;
    const { latitude, longitude } = coordinates;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    // Conservative geo buckets used when backend country/city text is missing.
    // Order matters for overlap zones.
    if (latitude >= -60 && latitude <= 33 && longitude >= -120 && longitude <= -30) return 'LATAM';
    if (latitude >= 15 && latitude <= 85 && longitude >= -170 && longitude <= -30) return 'North America';
    if (latitude >= 35 && latitude <= 72 && longitude >= -25 && longitude <= 60) return 'Europe';
    if (latitude >= -50 && latitude <= 60 && (longitude >= 60 || longitude <= -150)) return 'Asia Pacific';
    return null;
  }

  private getRegionForCountry(value?: string): string | null {
    if (!value) return null;
    const normalized = value.toLowerCase().trim();

    // Helper for precise word-boundary matching to avoid "us" matching "austria"
    const matchesToken = (text: string, tokens: string[]): boolean => {
      // 1. Exact match
      if (tokens.includes(text)) return true;

      // 2. Match after comma (e.g. "Toronto, Canada")
      const lastPart = text.split(',').pop()?.trim();
      if (lastPart && tokens.includes(lastPart)) return true;

      // 3. Substring with word boundaries (for "United States of America")
      return tokens.some(token => {
        if (token.length < 3) return text === token || lastPart === token; // strict for short tokens like "us", "uk"
        return text.includes(token);
      });
    };

    const northAmerica = ['canada', 'united states', 'usa', 'u.s.a.', 'us', 'u.s.', 'mexico', 'toronto', 'quebec', 'montreal', 'winnipeg', 'alabama', 'florida', 'ontario'];
    if (matchesToken(normalized, northAmerica)) return 'North America';

    const europe = [
      'france', 'turkey', 'germany', 'italy', 'spain', 'sweden', 'norway', 'finland',
      'united kingdom', 'uk', 'england', 'scotland', 'wales', 'ireland', 'netherlands',
      'belgium', 'poland', 'czech', 'austria', 'switzerland', 'romania', 'greece', 'portugal',
      'istanbul', 'bursa', 'adana', 'ankara', 'le mans', 'london', 'berlin', 'paris', 'madrid', 'rome'
    ];
    if (matchesToken(normalized, europe)) return 'Europe';

    const asiaPacific = [
      'china', 'japan', 'korea', 'south korea', 'north korea', 'india', 'singapore', 'malaysia',
      'indonesia', 'philippines', 'vietnam', 'thailand', 'australia', 'new zealand', 'taiwan', 'hong kong',
      'beijing', 'shanghai', 'zhengzhou', 'tokyo', 'seoul', 'mumbai', 'delhi', 'sydney'
    ];
    if (matchesToken(normalized, asiaPacific)) return 'Asia Pacific';

    const latam = [
      'brazil', 'argentina', 'chile', 'colombia', 'peru', 'ecuador', 'venezuela', 'uruguay',
      'paraguay', 'bolivia', 'guatemala', 'honduras', 'el salvador', 'nicaragua', 'costa rica',
      'panama', 'dominican', 'puerto rico',
      'sao paulo', 'rio de janeiro', 'caxias do sul', 'buenos aires', 'lima', 'bogota'
    ];
    if (matchesToken(normalized, latam)) return 'LATAM';

    return null;
  }


  onAddCompanyRequested(): void {
    if (this.isClientOrUser()) {
      return;
    }
    if (this.addProjectPulse()) {
      this.dismissAddProjectPulse();
    }
    const active = document.activeElement;
    this.lastFocusedElement = active instanceof HTMLElement ? active : null;
    this.addCompanyModalPreselectedManufacturerLocationId.set(null);
    this.addCompanyModalVisible.set(true);
    this.announce('Add Company modal opened.');
  }

  onAddCompanyModalClose(): void {
    if (this.addProjectSucceededBeforeClose) {
      this.warRoomService.selectEntity(null);
      this.clearAllFilters();
      this.addProjectSucceededBeforeClose = false;
    }
    this.addCompanyModalVisible.set(false);
    this.addCompanyModalPreselectedManufacturerLocationId.set(null);
    this.restoreFocusAfterModalClose();
  }

  onAddProjectForFactory(payload: { factoryId: string; subsidiaryId: string }): void {
    if (this.isClientOrUser()) {
      return;
    }
    this.addCompanyModalPreselectedManufacturerLocationId.set(payload.factoryId);
    this.addCompanyModalVisible.set(true);
    this.announce('Add Project modal opened. Factory pre-selected.');
  }

  onAddCompanyViewOnMap(subsidiaryId: string): void {
    const firstFactory = this.subsidiaries().find((s) => s.id === subsidiaryId)?.factories?.[0];
    const manufacturerLocationId = firstFactory?.id ?? subsidiaryId;
    this.warRoomService.requestPanToEntity(subsidiaryId);
    this.warRoomService.setMapViewMode('manufacturer');
    this.warRoomService.selectEntity({
      level: 'manufacturer',
      id: manufacturerLocationId,
      parentGroupId: this.subsidiaries().find((s) => s.id === subsidiaryId)?.parentGroupId,
      subsidiaryId,
      manufacturerLocationId,
      factoryId: manufacturerLocationId,
    });
  }

  async onProjectAdded(formData: ProjectFormData): Promise<void> {
    if (this.addCompanyInFlight) {
      return;
    }
    await this.projectWorkflow.onProjectAdded(
      this.projectWorkflowContext(),
      formData,
      (value) => (this.addCompanyInFlight = value),
      (message, error) => this.logError(message, error)
    );
  }

  private announce(message: string): void {
    this.announcementMessage.set(message);
    // clear after a delay so it can be re-announced if needed
    setTimeout(() => this.announcementMessage.set(''), ANNOUNCEMENT_CLEAR_DELAY_MS);
  }

  /** Called when map zoom has been idle 2s - shows status for TestSprite marker stability assertions */
  onMapZoomedToEntity(): void {
    if (this.returnToPreviousViewTimeoutId) {
      clearTimeout(this.returnToPreviousViewTimeoutId);
    }
    this.showReturnToPreviousView.set(true);
    this.returnToPreviousViewTimeoutId = setTimeout(() => {
      this.showReturnToPreviousView.set(false);
      this.returnToPreviousViewTimeoutId = null;
    }, PREVIOUS_VIEW_BUTTON_DURATION_MS);
  }

  onPreviousViewRestored(): void {
    if (this.returnToPreviousViewTimeoutId) {
      clearTimeout(this.returnToPreviousViewTimeoutId);
      this.returnToPreviousViewTimeoutId = null;
    }
    this.showReturnToPreviousView.set(false);
  }

  onMapUserInteracted(): void {
    // If the user starts dragging/zooming, don't allow a pending programmatic zoomToEntity to "fight" them.
    if (this.zoomTimeoutId) {
      clearTimeout(this.zoomTimeoutId);
      this.zoomTimeoutId = null;
    }

    const map = this.mapComponent();
    if (!map || typeof map.hasPreviousView !== 'function' || !map.hasPreviousView()) {
      return;
    }

    if (this.returnToPreviousViewTimeoutId) {
      clearTimeout(this.returnToPreviousViewTimeoutId);
    }
    this.showReturnToPreviousView.set(true);
    this.returnToPreviousViewTimeoutId = setTimeout(() => {
      this.showReturnToPreviousView.set(false);
      this.returnToPreviousViewTimeoutId = null;
    }, PREVIOUS_VIEW_BUTTON_DURATION_MS);
  }

  onMapZoomStable(zoom: number): void {
    const nearInitial = Math.abs(zoom - 1.8) < 0.3;
    const msg = nearInitial
      ? 'Markers and logos restored to original coordinates'
      : 'Markers and logos remained aligned after zoom operations';
    this.markerStabilityMessage.set(msg);
    setTimeout(() => this.markerStabilityMessage.set(''), MARKER_STABILITY_MESSAGE_DURATION_MS);
  }

  private restoreFocusAfterModalClose(): void {
    const element = this.lastFocusedElement;
    this.lastFocusedElement = null;
    if (element && element.isConnected && typeof element.focus === 'function') {
      setTimeout(() => element.focus(), RESTORE_FOCUS_DELAY_MS);
    }
  }

}
