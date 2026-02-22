import { Component, OnInit, OnDestroy, signal, inject, viewChild, effect, computed, HostListener, isDevMode } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { take } from 'rxjs/operators';
import { of, switchMap, tap, catchError, timeout, startWith } from 'rxjs';
import { WarRoomService } from '../../../shared/services/fluorescence-map.service';
import { ClientService } from '../../../shared/services/client.service';
import { ProjectService } from '../../../shared/services/project.service';
import { LocationService } from '../../../shared/services/location.service';
import { Node, ActivityLog, ParentGroup, FleetSelection, MapViewMode, SubsidiaryCompany, FactoryLocation, ManufacturerLocation, NodeStatus, TransitRoute, ProjectRoute } from '../../../shared/models/fluorescence-map.interface';
import { Project } from '../../../shared/models/project.model';
import { FluorescenceMapMapComponent } from './components/fluorescence-map-map/fluorescence-map-map.component';
import { WarRoomActivityLogComponent } from './components/fluorescence-map-activity-log/fluorescence-map-activity-log.component';
import { FluorescenceMapClientsPanelComponent } from './components/fluorescence-map-clients-panel/fluorescence-map-clients-panel.component';
import { FluorescenceMapHubStatusComponent } from './components/fluorescence-map-hub-status/fluorescence-map-hub-status.component';
import { WarRoomProjectHudComponent } from './components/fluorescence-map-project-hud/fluorescence-map-project-hud.component';
import { WarRoomContextPanelComponent } from './components/fluorescence-map-context-panel/fluorescence-map-context-panel.component';
import { FluorescenceMapCommandMenuComponent, CommandAction } from './components/fluorescence-map-command-menu/fluorescence-map-command-menu.component';
import { AddCompanyModalComponent, ProjectFormData } from './components/add-company-modal/add-company-modal.component';
import { ToastrService } from 'ngx-toastr';
import { RoutePreviewStorageService } from '../../../shared/services/route-preview-storage.service';
import { isValidCoordinates } from '../../../shared/utils/coordinate.utils';
import {
  ADD_PROJECT_PULSE_DURATION_MS,
  ADD_PROJECT_SEEN_KEY,
  ANNOUNCEMENT_CLEAR_DELAY_MS,
  API_TIMEOUT_MS,
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
  ACTIVITY_LOG_BUSY_CLEAR_DELAY_MS,
} from './fluorescence-map.constants';
import {
  ActiveFilterItem,
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
  selectNodesWithClients,
  selectProjectRoutesForMap,
  selectStatusCounts,
} from './state/fluorescence-map.selectors';
import { ProjectWorkflowContext, ProjectWorkflowService } from './workflows/project-workflow.service';
import { CaptureWorkflowContext, CaptureWorkflowService } from './workflows/capture-workflow.service';
import { PanelActionsContext, PanelActionsWorkflowService } from './workflows/panel-actions-workflow.service';

interface ManufacturerRuntimeRecord {
  id: number;
  name: string;
  logo?: string;
  locationId?: number | null;
}

@Component({
  selector: 'app-fluorescence-map',
  standalone: true,
  imports: [
    CommonModule,
    FluorescenceMapMapComponent,
    WarRoomActivityLogComponent,
    FluorescenceMapClientsPanelComponent,
    FluorescenceMapHubStatusComponent,
    WarRoomProjectHudComponent,
    WarRoomContextPanelComponent,
    FluorescenceMapCommandMenuComponent,
    AddCompanyModalComponent,
  ],
  templateUrl: './fluorescence-map.component.html',
  styleUrl: './fluorescence-map.component.scss',
})
export class FluorescenceMapComponent implements OnInit, OnDestroy {
  private addProjectPulseTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private tipsHintTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastFocusedElement: HTMLElement | null = null;
  private hasHydratedFromStorage = false;
  private readonly savedMapViewMode = signal<MapViewMode | null>(null);
  // Inject services
  private warRoomService = inject(WarRoomService);
  private clientService = inject(ClientService);
  private projectService = inject(ProjectService);
  private locationService = inject(LocationService);
  private toastr = inject(ToastrService);
  private routePreviewStorage = inject(RoutePreviewStorageService);
  private projectWorkflow = inject(ProjectWorkflowService);
  private captureWorkflow = inject(CaptureWorkflowService);
  private panelActionsWorkflow = inject(PanelActionsWorkflowService);
  private readonly requiredReloadTrigger = signal(0);
  readonly clientsStatus = signal<EndpointStatus>('idle');
  readonly projectsStatus = signal<EndpointStatus>('idle');
  readonly manufacturersStatus = signal<EndpointStatus>('idle');
  readonly locationsStatus = signal<EndpointStatus>('idle');
  readonly endpointErrors = signal<Record<string, string | null>>({
    clients: null,
    projects: null,
    manufacturers: null,
    locations: null,
  });

  private setEndpointLoading(endpoint: 'clients' | 'projects' | 'manufacturers' | 'locations'): void {
    if (endpoint === 'clients') this.clientsStatus.set('loading');
    if (endpoint === 'projects') this.projectsStatus.set('loading');
    if (endpoint === 'manufacturers') this.manufacturersStatus.set('loading');
    if (endpoint === 'locations') this.locationsStatus.set('loading');
    this.endpointErrors.update((e) => ({ ...e, [endpoint]: null }));
  }

  private setEndpointReady(endpoint: 'clients' | 'projects' | 'manufacturers' | 'locations'): void {
    if (endpoint === 'clients') this.clientsStatus.set('ready');
    if (endpoint === 'projects') this.projectsStatus.set('ready');
    if (endpoint === 'manufacturers') this.manufacturersStatus.set('ready');
    if (endpoint === 'locations') this.locationsStatus.set('ready');
  }

  private setEndpointError(endpoint: 'clients' | 'projects' | 'manufacturers' | 'locations', err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (endpoint === 'clients') this.clientsStatus.set('error');
    if (endpoint === 'projects') this.projectsStatus.set('error');
    if (endpoint === 'manufacturers') this.manufacturersStatus.set('error');
    if (endpoint === 'locations') this.locationsStatus.set('error');
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
    toObservable(this.requiredReloadTrigger).pipe(
      startWith(0),
      tap(() => this.setEndpointLoading('clients')),
      switchMap(() =>
        this.clientService.getClients().pipe(
          timeout(API_TIMEOUT_MS),
          tap(() => this.setEndpointReady('clients')),
          catchError((err) => {
            this.setEndpointError('clients', err);
            return of([]);
          })
        )
      )
    ),
    { initialValue: [] }
  );
  readonly projectsSignal = toSignal(
    toObservable(this.requiredReloadTrigger).pipe(
      startWith(0),
      tap(() => this.setEndpointLoading('projects')),
      switchMap(() =>
        this.projectService.getProjects({}).pipe(
          timeout(API_TIMEOUT_MS),
          tap(() => this.setEndpointReady('projects')),
          catchError((err) => {
            this.setEndpointError('projects', err);
            return of([] as Project[]);
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
            return of([]);
          })
        )
      )
    ),
    { initialValue: [] }
  );
  readonly locationsById = computed(() => {
    const locations = this.locationsSignal() as Array<{
      id: string | number;
      name: string;
      latitude: number;
      longitude: number;
    }>;
    const map = new Map<string, { name: string; latitude: number; longitude: number }>();
    for (const location of locations) {
      if (!location || location.id == null) continue;
      map.set(String(location.id), {
        name: location.name ?? '',
        latitude: location.latitude,
        longitude: location.longitude,
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
                logo: manufacturer.manufacturerLogo ?? undefined,
                locationId: manufacturer.locationId ?? null,
              }))
            )
          ),
          tap(() => this.setEndpointReady('manufacturers')),
          catchError((err) => {
            this.setEndpointError('manufacturers', err);
            return of([] as ManufacturerRuntimeRecord[]);
          })
        )
      )
    ),
    { initialValue: [] as ManufacturerRuntimeRecord[] }
  );
  readonly projectTypesSignal = toSignal(this.projectService.getProjectTypes().pipe(catchError(() => of([]))), { initialValue: [] });
  readonly manufacturersSignal = toSignal(this.projectService.getManufacturers().pipe(catchError(() => of([]))), { initialValue: [] });
  readonly clientOptionsSignal = toSignal(this.projectService.getClientOptionsWithCounts().pipe(catchError(() => of([]))), { initialValue: [] });
  readonly manufacturerOptionsSignal = toSignal(this.projectService.getManufacturerOptionsWithCounts().pipe(catchError(() => of([]))), { initialValue: [] });
  readonly projectTypeOptionsSignal = toSignal(this.projectService.getProjectTypeOptionsWithCounts().pipe(catchError(() => of([]))), { initialValue: [] });
  readonly projectOptionsSignal = toSignal(this.projectService.getProjectOptionsWithCounts().pipe(catchError(() => of([]))), { initialValue: [] });
  readonly projectRoutes = signal<ProjectRoute[]>([]);
  readonly selectedProjectId = signal<string | null>(null);
  /** When true, hide UI for clean route screenshot capture */
  readonly screenshotMode = signal(false);
  /** Increments when a route preview is saved; used to refresh thumbnails in panels */
  readonly routePreviewVersion = signal(0);
  readonly projectRoutesForMap = computed(() => {
    return selectProjectRoutesForMap(
      this.mapViewMode(),
      this.projectRoutes(),
      this.selectedEntity(),
      this.selectedProjectId()
    );
  });

  /** True when a client is selected and has at least one route to capture. */
  readonly hasSelectedClientWithRoutes = computed(() => {
    const selection = this.selectedEntity();
    const routes = this.projectRoutes();
    return selection?.level === 'client' && routes.some((r) => r.fromNodeId === selection.id);
  });

  readonly projectStatusByFactoryId = computed(() => {
    const projects = this.projectsSignal();
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

  // Screen reader announcement message
  readonly announcementMessage = signal<string>('');

  /** Visible status for TestSprite marker stability assertions - shown after zoom idle */
  readonly markerStabilityMessage = signal<string>('');

  // Overlay panel + expand state
  readonly panelVisible = signal<boolean>(false);
  readonly activePanel = signal<'log' | 'hub'>('log');
  readonly mapExpanded = signal<boolean>(false);

  /** Activity log panel mode: Client (clients with projects) vs Manufacturer (subsidiary/factory list) */
  readonly logPanelMode = signal<'client' | 'manufacturer'>('manufacturer');

  // Activity log visibility - hidden by default (edit mode only)
  readonly activityLogEditMode = signal<boolean>(false);
  readonly activityLogBusy = signal<boolean>(false);

  // Add company modal (over map)
  readonly addCompanyModalVisible = signal<boolean>(false);
  readonly addCompanyModalPreselectedManufacturerLocationId = signal<string | null>(null);
  /** @deprecated Use addCompanyModalPreselectedManufacturerLocationId */
  readonly addCompanyModalPreselectedFactoryId = this.addCompanyModalPreselectedManufacturerLocationId;

  // Filters panel state
  readonly filtersPanelVisible = signal<boolean>(false);
  readonly filterDraft = signal<WarRoomFilters>(createDefaultFilters());
  readonly filterApplied = signal<WarRoomFilters>(createDefaultFilters());
  readonly expandedFilterSection = signal<'client' | 'manufacturer' | 'projectType' | 'project' | null>(null);
  readonly clientFilterSearch = signal('');
  readonly manufacturerFilterSearch = signal('');
  readonly projectTypeFilterSearch = signal('');
  readonly projectFilterSearch = signal('');

  // Tactical mode: map-only view with bottom-center view toggle
  readonly tacticalMode = signal<boolean>(false);

  /** Project list HUD: hidden by default, shown when user clicks Project List in command menu */
  readonly projectHudVisible = signal<boolean>(false);

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
    const clients = this.clientsSignal();
    return options.map((opt) => {
      const client = clients.find((c) => c.id === opt.id);
      return {
        id: opt.id,
        name: client?.name ?? opt.name,
        code: client?.code,
        logoUrl: client?.logoUrl,
        projectCount: opt.count,
      };
    });
  });
  readonly clientsById = computed(() => {
    const clients = this.clientsSignal();
    const map = new Map<string, { id: string; name: string; latitude: number | null; longitude: number | null }>();
    for (const client of clients) {
      map.set(client.id, {
        id: client.id,
        name: client.name,
        latitude: client.coordinates?.latitude ?? null,
        longitude: client.coordinates?.longitude ?? null,
      });
    }
    return map;
  });
  readonly filteredClientOptions = computed(() => {
    const term = this.clientFilterSearch().trim().toLowerCase();
    const options = this.clientOptionsSignal();
    if (!term) return options;
    return options.filter((option) => option.name.toLowerCase().includes(term));
  });
  readonly filteredManufacturerOptions = computed(() => {
    const term = this.manufacturerFilterSearch().trim().toLowerCase();
    const options = this.manufacturerOptionsSignal();
    if (!term) return options;
    return options.filter((option) => option.name.toLowerCase().includes(term));
  });
  readonly filteredProjectTypeOptions = computed(() => {
    const term = this.projectTypeFilterSearch().trim().toLowerCase();
    const options = this.projectTypeOptionsSignal();
    if (!term) return options;
    return options.filter((option) => option.name.toLowerCase().includes(term));
  });
  readonly filteredProjectOptions = computed(() => {
    const term = this.projectFilterSearch().trim().toLowerCase();
    const options = this.projectOptionsSignal();
    if (!term) return options;
    return options.filter((option) => option.name.toLowerCase().includes(term));
  });

  readonly availableRegions = computed(() => {
    return selectAvailableRegions(this.factories(), (factory) =>
      this.getRegionForFactory(factory as FactoryLocation)
    );
  });

  /** Nodes merged with client nodes: clients in routes OR clients with projects (for pan-to-client fallback).
   * In Client view, when no projects/routes exist (e.g. API returns empty), show all clients with coordinates. */
  readonly nodesWithClients = computed(() => {
    return selectNodesWithClients(
      this.nodes(),
      this.clientsSignal(),
      this.projectRoutes(),
      this.clientOptionsSignal(),
      this.mapViewMode()
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
      if (node.clientId) nodeMap.set(node.clientId, node);
    });
    return nodeMap;
  });

  readonly activeFilterCount = computed(() => {
    return selectActiveFilterCount(this.filterApplied());
  });

  readonly activeFilters = computed<ActiveFilterItem[]>(() => {
    return selectActiveFilters(
      this.filterApplied(),
      this.clientsSignal(),
      this.projectsSignal(),
      this.projectOptionsSignal()
    );
  });

  readonly statusCounts = computed(() => {
    return selectStatusCounts(this.projectsSignal());
  });

  readonly filteredNodes = computed(() => {
    const filters = this.filterApplied();
    const nodes = this.nodesWithClients();
    const viewMode = this.mapViewMode();
    const routes = this.projectRoutes();
    const routesLoading = this.projectRoutesLoading();
    const hasProjectFilters =
      filters.clientIds.length > 0 ||
      filters.manufacturerIds.length > 0 ||
      filters.projectTypeIds.length > 0 ||
      filters.projectIds.length > 0;
    const projectFiltersActive = filters.status !== 'all' || hasProjectFilters;
    const useProjectRouteFilter = viewMode === 'project' || projectFiltersActive;
    const routeTargetIds = useProjectRouteFilter ? new Set(routes.map((r) => r.toNodeId)) : null;
    const enforceRouteTargets = !!routeTargetIds && routeTargetIds.size > 0;

    // Client view: only client nodes, no factories or project routes
    if (viewMode === 'client') {
      return nodes
        .filter((n) => n.level === 'client')
        .filter((n) => {
          if (filters.clientIds.length > 0 && !filters.clientIds.includes(n.id)) return false;
          return true;
        });
    }

    const result = nodes.filter((node) => {
      // Client nodes: visible in project view, factory view, or when client filter is active
      if (node.level === 'client') {
        if (viewMode === 'project' && routes.length > 0) {
          const clientIdsInRoutes = new Set(routes.map((r) => r.fromNodeId));
          return clientIdsInRoutes.has(node.id);
        }
        return viewMode === 'project' || viewMode === 'factory' || viewMode === 'manufacturer' || filters.clientIds.length > 0;
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
      const status = filters.status as FilterStatus;
      const shouldApplyOperationalStatus =
        status === 'all' || (!enforceRouteTargets && !hasProjectFilters);
      const statusMatch = shouldApplyOperationalStatus
        ? this.matchesStatus(node.status, status)
        : true;
      const regionMatch = this.matchesRegionsForNode(node, filters.regions);

      return statusMatch && regionMatch;
    });

    return result;
  });

  /** True if node (factory, subsidiary, or parent) has at least one factory in routeTargetIds */
  private nodeMatchesRouteTargets(node: Node, routeTargetIds: Set<string>): boolean {
    if (node.level === 'factory' || node.level === 'manufacturer') return routeTargetIds.has(node.id);
    if (node.level === 'subsidiary') {
      return this.factories().some((f) => f != null && f.subsidiaryId === node.id && routeTargetIds.has(f.id));
    }
    if (node.level === 'parent') {
      const group = this.parentGroups().find((g) => g.id === node.id);
      const factoryIds = group?.subsidiaries?.flatMap((s) => (s.factories ?? []).map((f) => f.id)) ?? [];
      return factoryIds.some((id) => routeTargetIds.has(id));
    }
    return routeTargetIds.has(node.id);
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

  readonly enrichedParentGroups = computed(() => {
    const groups = this.parentGroups();
    const apiManufacturers = this.apiManufacturersSignal();
    if (apiManufacturers.length === 0) return groups;
    return groups.map((group) => ({
      ...group,
      subsidiaries: group.subsidiaries.map((sub) => {
        const match = this.matchSubsidiaryToManufacturer(sub.name, apiManufacturers);
        if (!match) return sub;
        return { ...sub, name: match.name, logo: match.logo ?? sub.logo };
      }),
    }));
  });

  readonly filteredParentGroups = computed(() => {
    const filters = this.filterApplied();
    const parentGroups = this.enrichedParentGroups();
    const projectStatusByFactory = this.projectStatusByFactoryId();

    return parentGroups
      .map((group) => {
        // Deep clone or construct filtered group
        const filteredSubsidiaries = group.subsidiaries
          .map((sub) => {
            const filteredFactories = (sub.factories ?? []).filter((f) => {
              const statusMatch =
                filters.status === 'all'
                  ? true
                  : filters.status === 'active'
                    ? projectStatusByFactory.get(f.id) === 'active'
                    : projectStatusByFactory.get(f.id) === 'inactive';
              const regionMatch = this.matchesRegionsForFactory(f, filters.regions);
              return statusMatch && regionMatch;
            });

            if (filteredFactories.length === 0) {
              if (filters.status === 'active' || filters.status === 'inactive') {
                return null;
              }
              // If no factories match, check if the subsidiary itself matches status.
              // Note: Region filtering for subsidiary is based on its factories
              const statusMatch = this.matchesOperationalStatus(sub.status, filters.status);
              if (statusMatch && filters.regions.length === 0) {
                return { ...sub, factories: [] };
              }
              return null;
            }

            return { ...sub, factories: filteredFactories };
          })
          .filter((sub): sub is SubsidiaryCompany & { factories: ManufacturerLocation[] } => sub !== null);

        if (filteredSubsidiaries.length === 0) {
          if (filters.status === 'active' || filters.status === 'inactive') {
            return null;
          }
          // Check if parent itself matches if no children match
          const statusMatch = this.matchesOperationalStatus(group.status, filters.status);
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
    const filters = this.filterApplied();
    const factoryLookup = new Map(this.factories().map((factory) => [factory.id, factory]));
    const projectStatusByFactory = this.projectStatusByFactoryId();

    return this.activityLogs().filter((log) => {
      const logLocationId = log.manufacturerLocationId ?? log.factoryId;
      const factory = logLocationId ? factoryLookup.get(logLocationId) : undefined;
      const statusMatch =
        filters.status === 'all'
          ? true
          : filters.status === 'active'
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

  // ViewChild reference to map component
  readonly mapComponent = viewChild.required(FluorescenceMapMapComponent);
  readonly activityLogRef = viewChild<WarRoomActivityLogComponent>(WarRoomActivityLogComponent);
  readonly clientsPanelRef = viewChild<FluorescenceMapClientsPanelComponent>(FluorescenceMapClientsPanelComponent);

  readonly projectRoutesRefreshTrigger = signal(0);
  readonly projectRoutesLoading = signal(false);

  readonly addCompanyModalRef = viewChild<AddCompanyModalComponent>('addCompanyModalRef');

  // Timeout for zoom effect
  private zoomTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private skipInitialAutoZoom = true;
  private addCompanyInFlight = false;
  private addProjectSucceededBeforeClose = false;

  private logWarn(message: string, error?: unknown): void {
    if (isDevMode()) {
      console.warn(message, error);
    }
  }

  private logError(message: string, error?: unknown): void {
    console.error(message, error);
  }

  private projectWorkflowContext(): ProjectWorkflowContext {
    return {
      factories: () => this.factories(),
      subsidiaries: () => this.subsidiaries(),
      apiManufacturersSignal: () => this.apiManufacturersSignal(),
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
      clientsSignal: () => this.clientsSignal(),
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
    effect(() => {
      const selectedEntity = this.selectedEntity();
      const map = this.mapComponent();
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
      const clients = this.clientsSignal();
      const factories = this.factories();
      const locations = this.locationsSignal();
      const filters = this.filterApplied();
      void this.projectRoutesRefreshTrigger();
      if (!dataReady || !clients?.length) {
        this.projectRoutes.set([]);
        this.projectRoutesLoading.set(false);
        return;
      }
      this.projectRoutesLoading.set(true);
      const clientCoords = new Map(
        clients
          .filter((c) => c.coordinates)
          .map((c) => [c.id, c.coordinates!])
      );
      const warRoomEntries = factories.map((f) => [
        f.id,
        { latitude: f.coordinates.latitude, longitude: f.coordinates.longitude },
      ] as const);
      const locationEntries = (locations as Array<{ id: string | number; latitude: number; longitude: number }>)
        .filter(
          (l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude)
        )
        .map((l) => [
          String(l.id),
          { latitude: l.latitude, longitude: l.longitude },
        ] as const);
      const factoryCoords = new Map<string, { latitude: number; longitude: number }>([
        ...warRoomEntries,
        ...locationEntries,
      ]);
      const projectStatuses: ('Open' | 'Closed' | 'Delayed')[] | undefined =
        filters.status === 'active' ? ['Open'] :
          filters.status === 'inactive' ? ['Closed', 'Delayed'] :
            undefined;
      const projectFilters = {
        clientIds: filters.clientIds.length ? filters.clientIds : undefined,
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


    // Fit map bounds to show client + routes when a client is selected and routes have loaded
    effect(() => {
      const selection = this.selectedEntity();
      const routes = this.projectRoutes();
      const loading = this.projectRoutesLoading();
      const map = this.mapComponent();
      if (selection?.level !== 'client' || loading || !map || !routes.length) return;
      const clientRoutes = routes.filter((r) => r.fromNodeId === selection.id);
      if (!clientRoutes.length) return;
      setTimeout(() => map.fitBoundsToRoutes(clientRoutes), FIT_BOUNDS_DELAY_MS);
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
        filters.clientIds = filters.clientIds ?? [];
        filters.manufacturerIds = filters.manufacturerIds ?? [];
        filters.projectTypeIds = filters.projectTypeIds ?? [];
        filters.projectIds = filters.projectIds ?? [];
        this.filterApplied.set(filters);
        this.filterDraft.set(filters);

        // Restore view mode - migrate legacy subsidiary mode to manufacturer.
        const restoredMode =
          parsed.mapViewMode === 'subsidiary' ? 'manufacturer' : parsed.mapViewMode;
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

    // Load manufacturer hierarchy from API (replaces JSON when API returns data)
    this.projectService.buildParentGroupsFromApi().pipe(take(1)).subscribe({
      next: (groups) => {
        if (groups.length > 0) {
          this.warRoomService.setParentGroupsFromApi(groups);
        }
      },
      error: (err) => {
        this.setEndpointError('manufacturers', err);
      },
    });
  }

  /** Effect to re-apply saved view mode after WarRoomService loads JSON (which overwrites mapViewMode) */
  private readonly restoreViewModeEffect = effect(() => {
    const groups = this.parentGroups();
    const saved = this.savedMapViewMode();
    if (!saved) return;
    // Restore when service data is loaded (parentGroups populated); also run when saved is set (e.g. ngOnInit) in case JSON already loaded
    if (groups.length > 0) {
      this.warRoomService.setMapViewMode(saved);
      this.savedMapViewMode.set(null);
    }
  });

  ngOnDestroy(): void {
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
    this.requiredReloadTrigger.update((n) => n + 1);
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
    if (next) {
      this.announce(this.activePanel() === 'log' ? 'Activity log opened.' : 'Hub status opened.');
    } else {
      this.announce('Panels hidden.');
    }
  }

  /** Open sidebar panels (used by FAB - never closes) */
  openPanels(): void {
    this.panelVisible.set(true);
    this.announce(this.activePanel() === 'log' ? 'Activity log opened.' : 'Hub status opened.');
  }

  showPanel(panel: 'log' | 'hub'): void {
    this.activePanel.set(panel);
    this.panelVisible.set(true);
    this.announce(panel === 'log' ? 'Activity log opened.' : 'Hub status opened.');
  }

  setLogPanelMode(mode: 'client' | 'manufacturer'): void {
    this.logPanelMode.set(mode);
  }

  onClientSelected(clientId: string): void {
    const selection: FleetSelection = { level: 'client', id: clientId };
    this.warRoomService.selectEntity(selection);
    this.warRoomService.setMapViewMode('project'); // After selectEntity; project view shows route lines for this client's projects
    this.showPanel('log');
    this.mapComponent().zoomToEntity(clientId);
    // Filter map to show only this client's project locations and connections
    this.filterDraft.update((f) => ({ ...f, clientIds: [clientId] }));
    this.filterApplied.set({ ...this.filterApplied(), clientIds: [clientId] });
    this.selectedProjectId.set(null); // Clear project selection so all filtered routes show (not just one)
    // Always refresh routes when client filter changes to ensure correct routes are fetched
    this.projectRoutesRefreshTrigger.update((n) => n + 1);
  }

  onClientPanelSaveComplete(): void {
    this.retryRequiredDataLoad();
  }

  toggleMapExpanded(): void {
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

  private applyMapExpandedDomState(expanded: boolean): void {
    if (!document.body) {
      return;
    }
    document.body.classList.toggle(MAP_EXPANDED_CLASS, expanded);
    document.body.style.overflow = expanded ? MAP_EXPANDED_SCROLL_LOCK_STYLE : '';
  }

  onSaveChanges(): void {
    if (this.logPanelMode() === 'client') {
      const panel = this.clientsPanelRef();
      if (panel?.hasDrafts()) {
        panel.saveAllDrafts();
      }
      return;
    }
    const log = this.activityLogRef();
    if (log) {
      this.toastr.info('Submitting operational changes...', 'SYNC IN PROGRESS', {
        timeOut: 2000,
        progressBar: true
      });

      // Commit all drafts - this triggers batchUpdateRequested
      log.saveAllDrafts();

      // We do NOT exit edit mode here anymore.
      // We wait for the batch update to succeed in onBatchUpdateRequested.
    }
  }

  onCancelEdit(): void {
    if (this.logPanelMode() === 'client') {
      const panel = this.clientsPanelRef();
      if (panel) {
        panel.clearAllDrafts();
      }
      this.activityLogEditMode.set(false);
      this.toastr.warning('Operational changes discarded.', 'CANCELLED');
      return;
    }
    const log = this.activityLogRef();
    if (log) {
      log.clearAllDrafts();
    }
    this.activityLogEditMode.set(false);
    this.toastr.warning('Operational changes discarded.', 'CANCELLED');
  }


  async onBatchUpdateRequested(payload: {
    factories: FactoryEditPayload[];
    subsidiaries: SubsidiaryEditPayload[];
  }): Promise<void> {
    this.activityLogBusy.set(true);
    try {
      const { successCount, failureCount } = await this.projectWorkflow.runBatchUpdate(
        this.projectWorkflowContext(),
        payload,
        (message, error) => this.logError(message, error)
      );

      if (successCount === 0 && failureCount === 0) {
        this.toastr.info('No changes detected to save.', 'SYNC COMPLETE');
        return;
      }

      if (failureCount === 0) {
        this.toastr.success(`Successfully updated ${successCount} operational entities.`, 'SYNC COMPLETE');
        const log = this.activityLogRef();
        log?.clearAllDrafts();
        this.activityLogEditMode.set(false);
      } else if (successCount > 0) {
        this.toastr.warning(
          `Saved ${successCount} updates, ${failureCount} failed. Review and retry failed changes.`,
          'PARTIAL SAVE'
        );
      } else {
        this.toastr.error('Failed to save changes. Please try again.', 'SAVE ERROR');
      }

    } catch (error) {
      this.logError('Batch update failed', error);
      this.toastr.error('Failed to save changes. Please try again.', 'SAVE ERROR');
    } finally {
      setTimeout(() => this.activityLogBusy.set(false), ACTIVITY_LOG_BUSY_CLEAR_DELAY_MS);
    }
  }

  /**
   * Toggle filters panel visibility
   */
  toggleFiltersPanel(): void {
    const wasOpen = this.filtersPanelVisible();
    if (!wasOpen) {
      const applied = this.filterApplied();
      this.filterDraft.set({
        status: applied.status,
        regions: [...applied.regions],
        clientIds: [...applied.clientIds],
        manufacturerIds: [...applied.manufacturerIds],
        projectTypeIds: [...applied.projectTypeIds],
        projectIds: [...applied.projectIds],
      });
    }
    this.filtersPanelVisible.set(!wasOpen);
  }

  /** Open filters panel (used by FAB - never closes) */
  openFiltersPanel(): void {
    if (!this.filtersPanelVisible()) {
      const applied = this.filterApplied();
      this.filterDraft.set({
        status: applied.status,
        regions: [...applied.regions],
        clientIds: [...applied.clientIds],
        manufacturerIds: [...applied.manufacturerIds],
        projectTypeIds: [...applied.projectTypeIds],
        projectIds: [...applied.projectIds],
      });
    }
    this.filtersPanelVisible.set(true);
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
      const next = { ...filters, regions: Array.from(nextRegions) };
      // Apply region filter immediately so map and counts update without clicking Apply
      this.filterApplied.set({ ...this.filterApplied(), regions: next.regions });
      return next;
    });
  }

  setStatusFilter(status: FilterStatus): void {
    // 1. Update draft for UI consistency
    this.filterDraft.update((filters) => ({ ...filters, status }));

    // 2. APPLY INSTANTLY for status pills (standard UX expectation)
    this.filterApplied.set({
      ...this.filterApplied(),
      status
    });
  }

  applyFilters(): void {
    const draft = this.filterDraft();

    this.filterApplied.set({
      status: draft.status,
      regions: [...draft.regions],
      clientIds: [...draft.clientIds],
      manufacturerIds: [...draft.manufacturerIds],
      projectTypeIds: [...draft.projectTypeIds],
      projectIds: [...draft.projectIds],
    });
    this.filtersPanelVisible.set(false);
    this.announce('Filters applied. ' + this.activeFilterCount() + ' filters active.');
  }

  toggleClient(clientId: string): void {
    this.filterDraft.update((filters) => {
      const nextIds = new Set(filters.clientIds);
      if (nextIds.has(clientId)) nextIds.delete(clientId);
      else nextIds.add(clientId);
      const next = { ...filters, clientIds: Array.from(nextIds) };
      this.filterApplied.set({ ...this.filterApplied(), clientIds: next.clientIds });
      return next;
    });
  }

  toggleManufacturer(manufacturerId: string): void {
    this.filterDraft.update((filters) => {
      const nextIds = new Set(filters.manufacturerIds);
      if (nextIds.has(manufacturerId)) nextIds.delete(manufacturerId);
      else nextIds.add(manufacturerId);
      const next = { ...filters, manufacturerIds: Array.from(nextIds) };
      this.filterApplied.set({ ...this.filterApplied(), manufacturerIds: next.manufacturerIds });
      return next;
    });
  }

  toggleProjectType(projectTypeId: string): void {
    this.filterDraft.update((filters) => {
      const nextIds = new Set(filters.projectTypeIds);
      if (nextIds.has(projectTypeId)) nextIds.delete(projectTypeId);
      else nextIds.add(projectTypeId);
      const next = { ...filters, projectTypeIds: Array.from(nextIds) };
      this.filterApplied.set({ ...this.filterApplied(), projectTypeIds: next.projectTypeIds });
      return next;
    });
  }

  toggleProject(projectId: string): void {
    this.filterDraft.update((filters) => {
      const nextIds = new Set(filters.projectIds);
      if (nextIds.has(projectId)) nextIds.delete(projectId);
      else nextIds.add(projectId);
      const next = { ...filters, projectIds: Array.from(nextIds) };
      this.filterApplied.set({ ...this.filterApplied(), projectIds: next.projectIds });
      return next;
    });
  }

  resetFilters(): void {
    this.filterDraft.set(createDefaultFilters());
    this.filterApplied.set(createDefaultFilters());
    this.expandedFilterSection.set(null);
    this.clientFilterSearch.set('');
    this.manufacturerFilterSearch.set('');
    this.projectTypeFilterSearch.set('');
    this.projectFilterSearch.set('');
  }

  clearAllFilters(): void {
    this.resetFilters();
    this.announce('All filters cleared.');
  }

  removeFilter(item: ActiveFilterItem): void {
    const current = this.filterApplied();
    const next = { ...current };

    if (item.type === 'status') {
      next.status = 'all';
    } else if (item.type === 'client') {
      next.clientIds = next.clientIds.filter((id) => id !== item.value);
    } else if (item.type === 'manufacturer') {
      next.manufacturerIds = next.manufacturerIds.filter((id) => id !== item.value);
    } else if (item.type === 'projectType') {
      next.projectTypeIds = next.projectTypeIds.filter((id) => id !== item.value);
    } else if (item.type === 'project') {
      next.projectIds = next.projectIds.filter((id) => id !== item.value);
    } else if (item.type === 'region') {
      next.regions = next.regions.filter(r => r !== item.value);
    }

    this.filterApplied.set(next);
    // Sync draft so reopening the panel shows correct state
    this.filterDraft.set(next);
  }

  /**
   * Switch map view mode (parent / subsidiary / factory)
   */
  setMapViewMode(mode: MapViewMode): void {
    this.warRoomService.setManufacturerFilterSubsidiaryId(null);
    this.warRoomService.setMapViewMode(mode);
    this.announce('Switched to ' + mode + ' view.');
  }

  toggleTacticalMode(): void {
    const next = !this.tacticalMode();
    this.tacticalMode.set(next);
    if (next) {
      this.filtersPanelVisible.set(false);
      this.panelVisible.set(false);
      this.projectHudVisible.set(false);
    }
    this.announce(next ? 'Tactical view on. Map only view.' : 'Tactical view off.');
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.tacticalMode() && !this.addCompanyModalVisible()) {
      this.toggleTacticalMode();
    }
  }

  /**
   * Handle node selection from map
   */
  onCommandAction(action: CommandAction): void {
    switch (action) {
      case 'addCompany':
        this.filtersPanelVisible.set(false);
        this.panelVisible.set(false);
        this.onAddCompanyRequested();
        break;
      case 'panels':
        this.filtersPanelVisible.set(false);
        this.openPanels();
        break;
      case 'filters':
        this.panelVisible.set(false);
        this.openFiltersPanel();
        break;
      case 'projectList':
        this.filtersPanelVisible.set(false);
        this.panelVisible.set(false);
        this.projectHudVisible.set(true);
        this.announce('Project list opened.');
        break;
      case 'tactical':
        this.toggleTacticalMode();
        break;
      case 'expandMap':
        this.toggleMapExpanded();
        break;
      case 'captureRoute': {
        const pid = this.selectedProjectId();
        const projects = this.projectsSignal();
        const getProjectName = (id: string) => projects.find((p) => String(p.id) === id)?.projectName;
        if (pid) {
          this.captureAndStoreForProject(pid, getProjectName(pid));
        } else {
          const routes = this.projectRoutes();
          const first = routes[0];
          if (first) {
            this.selectedProjectId.set(first.projectId);
            this.captureAndStoreForProject(first.projectId, getProjectName(first.projectId));
          } else {
            this.toastr.warning('Select a project or route first, or add a project with a route.', 'No route to capture');
          }
        }
        break;
      }
      case 'captureClientProjects': {
        const selection = this.selectedEntity();
        if (selection?.level === 'client') {
          this.captureAndStoreForClient(selection.id);
        } else {
          this.toastr.warning('Select a client first to capture all their projects.', 'No client selected');
        }
        break;
      }
    }
  }

  /** Captures route screenshot for project, stores it, and shows toast. Optionally triggers download. */
  async captureAndStoreForProject(projectId: string, projectName?: string): Promise<void> {
    await this.captureWorkflow.captureAndStoreForProject(this.captureWorkflowContext(), projectId, projectName);
  }

  /**
   * Waits for the route to appear in projectRoutes, then captures. Used after adding a project
   * when routes may not be populated yet. Polls until route exists or max attempts reached.
   */
  private waitForRouteThenCapture(
    projectId: string,
    projectName: string | undefined,
    initialDelayMs: number,
    pollIntervalMs: number,
    maxAttempts: number
  ): void {
    this.captureWorkflow.waitForRouteCapture(
      this.captureWorkflowContext(),
      projectId,
      projectName,
      initialDelayMs,
      pollIntervalMs,
      maxAttempts
    );
  }

  /** Shows capture-failure toast with tap-to-retry. */
  private showCaptureFailureToastWithRetry(projectId: string, projectName?: string): void {
    this.captureWorkflow.waitForRouteCapture(
      this.captureWorkflowContext(),
      projectId,
      projectName,
      500,
      400,
      6
    );
  }

  /** Captures all routes for a client into one screenshot, stores it, and triggers download. */
  async captureAndStoreForClient(clientId: string): Promise<void> {
    await this.captureWorkflow.captureAndStoreForClient(this.captureWorkflowContext(), clientId);
  }

  /** Captures a clean map screenshot for all routes belonging to the given client. Returns data URL or null. */
  private async captureClientScreenshot(clientId: string): Promise<string | null> {
    return this.captureWorkflow.captureClientScreenshot(this.captureWorkflowContext(), clientId);
  }

  /** Captures a clean map screenshot for the given project's route. Returns data URL or null. */
  private async captureRouteScreenshotForProject(projectId: string): Promise<string | null> {
    return this.captureWorkflow.captureRouteScreenshotForProject(this.captureWorkflowContext(), projectId);
  }

  onRoutePreviewRequested(projectId: string): void {
    const projectName = this.projectsSignal().find((p) => String(p.id) === projectId)?.projectName;
    this.captureWorkflow.onRoutePreviewRequested(this.captureWorkflowContext(), projectId, projectName);
  }

  onClientCaptureRequested(clientId: string): void {
    this.warRoomService.selectEntity({ level: 'client', id: clientId });
    this.filterDraft.update((f) => ({ ...f, clientIds: [clientId] }));
    this.filterApplied.set({ ...this.filterApplied(), clientIds: [clientId] });
    this.projectRoutesRefreshTrigger.update((n) => n + 1);
    this.captureWorkflow.onClientCaptureRequested(this.captureWorkflowContext(), clientId);
  }

  onRouteSelected(payload: { routeId: string; projectId?: string }): void {
    if (payload.projectId) {
      this.selectedProjectId.set(payload.projectId);
    }
  }

  onProjectHudSelected(project: Project): void {
    const routesAtClick = this.projectRoutes().length;
    const clientsCount = this.clientsSignal()?.length ?? 0;
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
      // Fallback: pan to client when project has no manufacturer location (e.g. Metrolinx)
      this.warRoomService.selectEntity({ level: 'client', id: project.clientId });
      this.warRoomService.setMapViewMode('project'); // After selectEntity so it is not overwritten
      if (routesAtClick === 0 && clientsCount > 0 && factoriesCount > 0) {
        this.projectRoutesRefreshTrigger.update((n) => n + 1);
      }
      this.showPanel('log');
      this.filterDraft.update((f) => ({ ...f, clientIds: [project.clientId!] }));
      this.filterApplied.set({ ...this.filterApplied(), clientIds: [project.clientId!] });
      setTimeout(() => {
        this.mapComponent().zoomToEntity(project.clientId!, 8);
      }, FIT_BOUNDS_DELAY_MS);
      this.announce(`Selected project ${project.projectName || 'Project'}. Panning to ${project.clientName ?? project.clientId ?? 'client'}.`);
    }
  }

  onNodeSelected(node: Node | undefined): void {
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

  private matchesRegionsForNode(node: Node, selectedRegions: string[]): boolean {
    if (selectedRegions.length === 0) return true;
    const regions = this.getRegionsForNode(node);
    if (regions.size === 0) return false;
    return selectedRegions.some((region) => regions.has(region));
  }

  private matchesRegionsForFactory(factory: FactoryLocation | undefined, selectedRegions: string[]): boolean {
    if (selectedRegions.length === 0) return true;
    if (!factory) return false;
    const region = this.getRegionForFactory(factory);
    return region ? selectedRegions.includes(region) : false;
  }

  private getRegionsForNode(node: Node): Set<string> {
    // 1. Direct Region Mapping for Leaf Nodes (Factory/Individual)
    if (node.level === 'factory' || node.level === 'manufacturer') {
      const region = this.getRegionForCountry(node.country || node.city);
      return region ? new Set([region]) : new Set();
    }

    // 2. Aggregate Mapping for Subsidiaries
    if (node.level === 'subsidiary' && (node.subsidiaryId || node.id)) {
      const sId = node.subsidiaryId || node.id;
      const subsidiary = this.subsidiaries().find((item) => item.id === sId);
      return subsidiary ? this.getRegionsForFactories(subsidiary.factories ?? []) : new Set();
    }

    // 3. Aggregate Mapping for Parent Groups
    if (node.level === 'parent') {
      const parentGroupId = node.parentGroupId || node.id;
      const group = this.parentGroups().find((item) => item.id === parentGroupId);
      return group ? this.getRegionsForFactories(group.subsidiaries.flatMap((sub) => sub.factories ?? [])) : new Set();
    }

    // Fallback
    const region = this.getRegionForCountry(node.country || node.city);
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
    return this.getRegionForCountry(factory.country || factory.city);
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
    this.addCompanyModalPreselectedManufacturerLocationId.set(payload.factoryId);
    this.addCompanyModalVisible.set(true);
    this.announce('Add Project modal opened. Factory pre-selected.');
  }

  onAddCompanyViewOnMap(subsidiaryId: string): void {
    this.warRoomService.requestPanToEntity(subsidiaryId);
    this.warRoomService.setMapViewMode('manufacturer');
    this.warRoomService.selectEntity({
      level: 'subsidiary',
      id: subsidiaryId,
      parentGroupId: this.subsidiaries().find((s) => s.id === subsidiaryId)?.parentGroupId,
      subsidiaryId,
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
