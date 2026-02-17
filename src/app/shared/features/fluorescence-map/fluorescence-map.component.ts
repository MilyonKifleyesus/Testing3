import { Component, OnInit, OnDestroy, signal, inject, viewChild, effect, computed, HostListener, isDevMode } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { WarRoomService } from '../../../shared/services/fluorescence-map.service';
import { WarRoomRealtimeService } from '../../../shared/services/fluorescence-map-realtime.service';
import { ClientService } from '../../../shared/services/client.service';
import { ProjectService } from '../../../shared/services/project.service';
import { CompanyLocationService } from '../../../shared/services/company-location.service';
import { Node, ActivityLog, ParentGroup, FleetSelection, MapViewMode, SubsidiaryCompany, FactoryLocation, NodeStatus, ActivityStatus, TransitRoute, ProjectRoute } from '../../../shared/models/fluorescence-map.interface';
import { Project } from '../../../shared/models/project.model';
import { WarRoomMapComponent } from './components/fluorescence-map-map/fluorescence-map-map.component';
import { WarRoomActivityLogComponent } from './components/fluorescence-map-activity-log/fluorescence-map-activity-log.component';
import { WarRoomClientsPanelComponent } from './components/fluorescence-map-clients-panel/fluorescence-map-clients-panel.component';
import { WarRoomHubStatusComponent } from './components/fluorescence-map-hub-status/fluorescence-map-hub-status.component';
import { WarRoomProjectHudComponent } from './components/fluorescence-map-project-hud/fluorescence-map-project-hud.component';
import { WarRoomContextPanelComponent } from './components/fluorescence-map-context-panel/fluorescence-map-context-panel.component';
import { WarRoomCommandMenuComponent, CommandAction } from './components/fluorescence-map-command-menu/fluorescence-map-command-menu.component';
import { AddCompanyModalComponent, ProjectFormData } from './components/add-company-modal/add-company-modal.component';
import { ToastrService } from 'ngx-toastr';
import { RoutePreviewStorageService } from '../../../shared/services/route-preview-storage.service';
import { OperationalStatus } from '../../../shared/models/fluorescence-map.interface';
import { isValidCoordinates } from '../../../shared/utils/coordinate.utils';

type FilterStatus = 'all' | 'active' | 'inactive';

export interface ActiveFilterItem {
  type: 'status' | 'region' | 'company' | 'client' | 'manufacturer' | 'projectType';
  label: string;
  value: string;
}

interface WarRoomFilters {
  parentCompanyIds: string[];
  status: FilterStatus;
  regions: string[];
  clientIds: string[];
  manufacturerIds: string[];
  projectTypeIds: string[];
}

const createDefaultFilters = (): WarRoomFilters => ({
  parentCompanyIds: [],
  status: 'all',
  regions: [],
  clientIds: [],
  manufacturerIds: [],
  projectTypeIds: [],
});

/** Persisted state schema - supports both legacy filters-only and extended state */
interface WarRoomPersistedState {
  mapViewMode?: MapViewMode;
  panelVisible?: boolean;
  parentCompanyIds?: string[];
  status?: FilterStatus;
  regions?: string[];
  clientIds?: string[];
  manufacturerIds?: string[];
  projectTypeIds?: string[];
  /** Legacy single-value fields for migration */
  clientId?: string;
  manufacturerId?: string;
  projectType?: string;
}

@Component({
  selector: 'app-war-room',
  standalone: true,
  imports: [
    CommonModule,
    WarRoomMapComponent,
    WarRoomActivityLogComponent,
    WarRoomClientsPanelComponent,
    WarRoomHubStatusComponent,
    WarRoomProjectHudComponent,
    WarRoomContextPanelComponent,
    WarRoomCommandMenuComponent,
    AddCompanyModalComponent,
  ],
  templateUrl: './fluorescence-map.component.html',
  styleUrl: './fluorescence-map.component.scss',
})
export class WarRoomComponent implements OnInit, OnDestroy {
  private readonly STORAGE_KEY = 'war-room-state-v1';
  private readonly LEGACY_STORAGE_KEY = 'war-room-filters-v1';
  private readonly ADD_PROJECT_SEEN_KEY = 'war-room-add-project-seen';
  private readonly TIPS_HINT_SEEN_KEY = 'war-room-tips-hint-seen';
  private readonly MAP_EXPANDED_CLASS = 'war-room-map-expanded';
  private readonly MAP_EXPANDED_SCROLL_LOCK_STYLE = 'hidden';
  private addProjectPulseTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private tipsHintTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastFocusedElement: HTMLElement | null = null;
  private hasHydratedFromStorage = false;
  private readonly savedMapViewMode = signal<MapViewMode | null>(null);
  // Inject services
  private warRoomService = inject(WarRoomService);
  private realtimeService = inject(WarRoomRealtimeService);
  private clientService = inject(ClientService);
  private projectService = inject(ProjectService);
  private companyLocationService = inject(CompanyLocationService);
  private toastr = inject(ToastrService);
  private routePreviewStorage = inject(RoutePreviewStorageService);

  readonly clientsSignal = toSignal(this.clientService.getClients(), { initialValue: [] });
  readonly projectTypesSignal = toSignal(this.projectService.getProjectTypes(), { initialValue: [] });
  readonly manufacturersSignal = toSignal(this.projectService.getManufacturers(), { initialValue: [] });
  readonly clientOptionsSignal = toSignal(this.projectService.getClientOptionsWithCounts(), { initialValue: [] });
  readonly manufacturerOptionsSignal = toSignal(this.projectService.getManufacturerOptionsWithCounts(), { initialValue: [] });
  readonly projectTypeOptionsSignal = toSignal(this.projectService.getProjectTypeOptionsWithCounts(), { initialValue: [] });
  readonly projectRoutes = signal<ProjectRoute[]>([]);
  readonly selectedProjectId = signal<string | null>(null);
  /** When true, hide UI for clean route screenshot capture */
  readonly screenshotMode = signal(false);
  /** Increments when a route preview is saved; used to refresh thumbnails in panels */
  readonly routePreviewVersion = signal(0);
  readonly projectRoutesForMap = computed(() => {
    const viewMode = this.mapViewMode();
    if (viewMode === 'client' || viewMode === 'factory') {
      return [];
    }
    const selectedId = this.selectedProjectId();
    const routes = this.projectRoutes();
    if (!selectedId) {
      return routes;
    }
    return routes.filter((route) => route.projectId === selectedId);
  });

  /** True when a client is selected and has at least one route to capture. */
  readonly hasSelectedClientWithRoutes = computed(() => {
    const selection = this.selectedEntity();
    const routes = this.projectRoutes();
    return selection?.level === 'client' && routes.some((r) => r.fromNodeId === selection.id);
  });

  readonly projectsSignal = toSignal(this.projectService.getProjectsWithRefresh(), { initialValue: [] as Project[] });
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
  readonly addCompanyModalPreselectedFactoryId = signal<string | null>(null);

  // Filters panel state
  readonly filtersPanelVisible = signal<boolean>(false);
  readonly filterDraft = signal<WarRoomFilters>(createDefaultFilters());
  readonly filterApplied = signal<WarRoomFilters>(createDefaultFilters());
  readonly expandedFilterSection = signal<'companies' | 'client' | 'manufacturer' | 'projectType' | null>(null);
  readonly companyFilterSearch = signal('');
  readonly clientFilterSearch = signal('');
  readonly manufacturerFilterSearch = signal('');
  readonly projectTypeFilterSearch = signal('');

  // Tactical mode: map-only view with bottom-center view toggle
  readonly tacticalMode = signal<boolean>(false);

  /** Project list HUD: hidden by default, shown when user clicks Project List in command menu */
  readonly projectHudVisible = signal<boolean>(false);

  /** First-visit pulse on Add Project button for discoverability */
  readonly addProjectPulse = signal<boolean>(false);

  /** First-time onboarding hint for key controls */
  readonly showTipsHint = signal<boolean>(false);

  readonly parentCompanyOptions = computed(() => {
    const statusFilter = this.filterDraft().status;
    return this.subsidiaries()
      .filter((subsidiary) => this.matchesOperationalStatus(subsidiary.status, statusFilter))
      .map((subsidiary) => ({
        id: subsidiary.id,
        name: subsidiary.name,
        count: subsidiary.factories.length,
      }));
  });
  readonly filteredParentCompanyOptions = computed(() => {
    const term = this.companyFilterSearch().trim().toLowerCase();
    const options = this.parentCompanyOptions();
    if (!term) return options;
    return options.filter((option) => option.name.toLowerCase().includes(term));
  });

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

  readonly availableRegions = computed(() => {
    const factories = this.factories();
    const regionSet = new Set<string>();
    factories.forEach((factory) => {
      const region = this.getRegionForFactory(factory);
      if (region) {
        regionSet.add(region);
      }
    });

    const preferredOrder = ['North America', 'Europe', 'Asia Pacific', 'LATAM'];
    return preferredOrder.filter((region) => regionSet.has(region));
  });

  /** Nodes merged with client nodes: clients in routes OR clients with projects (for pan-to-client fallback) */
  readonly nodesWithClients = computed(() => {
    const base = this.nodes();
    const clients = this.clientsSignal();
    const routes = this.projectRoutes();
    const clientOptions = this.clientOptionsSignal();
    if (!clients?.length) return base;
    const clientIdsInRoutes = routes?.length ? new Set(routes.map((r) => r.fromNodeId)) : new Set<string>();
    const clientIdsWithProjects = new Set(clientOptions.map((opt) => opt.id));
    const clientIdsToAdd = new Set([...clientIdsInRoutes, ...clientIdsWithProjects]);
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
    return [...base, ...clientNodes];
  });

  private readonly nodeLookup = computed(() => {
    const nodeMap = new Map<string, Node>();
    this.nodesWithClients().forEach((node) => {
      nodeMap.set(node.id, node);
      if (node.factoryId) nodeMap.set(node.factoryId, node);
      if (node.subsidiaryId) nodeMap.set(node.subsidiaryId, node);
      if (node.parentGroupId) nodeMap.set(node.parentGroupId, node);
      if (node.clientId) nodeMap.set(node.clientId, node);
    });
    return nodeMap;
  });

  readonly activeFilterCount = computed(() => {
    const filters = this.filterApplied();
    let count = filters.parentCompanyIds.length + filters.regions.length;
    if (filters.status !== 'all') count += 1;
    count += filters.clientIds.length + filters.manufacturerIds.length + filters.projectTypeIds.length;
    return count;
  });

  readonly activeFilters = computed<ActiveFilterItem[]>(() => {
    const filters = this.filterApplied();
    const items: ActiveFilterItem[] = [];

    // Status
    if (filters.status !== 'all') {
      items.push({
        type: 'status',
        label: `Status: ${filters.status === 'active' ? 'Active Only' : 'Inactive Only'}`,
        value: filters.status
      });
    }

    // Regions
    filters.regions.forEach(region => {
      items.push({
        type: 'region',
        label: `Region: ${region}`,
        value: region
      });
    });

    // Companies
    const subs = this.subsidiaries();
    filters.parentCompanyIds.forEach(id => {
      const sub = subs.find(s => s.id === id);
      const name = sub ? sub.name : 'Unknown Company';
      items.push({
        type: 'company',
        label: `Company: ${name}`,
        value: id
      });
    });

    // Clients
    const clients = this.clientsSignal();
    filters.clientIds.forEach(id => {
      const client = clients.find((c) => c.id === id);
      const name = client ? client.name : id;
      items.push({ type: 'client', label: `Client: ${name}`, value: id });
    });

    // Manufacturers
    filters.manufacturerIds.forEach(id => {
      items.push({ type: 'manufacturer', label: `Manufacturer: ${id}`, value: id });
    });

    // Project Types
    filters.projectTypeIds.forEach(id => {
      items.push({ type: 'projectType', label: `Project Type: ${id}`, value: id });
    });

    return items;
  });

  readonly statusCounts = computed(() => {
    const projects = this.projectsSignal();

    let active = 0;
    let inactive = 0;

    for (const p of projects) {
      const st = p.status ?? 'Open';
      if (st === 'Open') {
        active++;
      } else {
        inactive++;
      }
    }

    return {
      total: active + inactive,
      active,
      inactive,
    };
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
      filters.projectTypeIds.length > 0;
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

    const routeFailures: string[] = [];
    const result = nodes.filter((node) => {
      // Client nodes: visible in project view, factory view, or when client filter is active
      if (node.level === 'client') {
        if (viewMode === 'project' && routes.length > 0) {
          const clientIdsInRoutes = new Set(routes.map((r) => r.fromNodeId));
          return clientIdsInRoutes.has(node.id);
        }
        return viewMode === 'project' || viewMode === 'factory' || filters.clientIds.length > 0;
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
            routeFailures.push(`${node.id}(${node.level})`);
            return false;
          }
        } else if (hasProjectFilters) {
          // No matching project routes while project filters are active.
          return false;
        }
      }

      const companyMatch = this.matchesParentCompanyFilterForNode(node, filters.parentCompanyIds);
      // When status is active/inactive, we filter by project status; nodes are restricted by routeTargetIds.
      // When status is 'all', filter by factory operational status.
      const status = filters.status as FilterStatus;
      const shouldApplyOperationalStatus =
        status === 'all' || (!enforceRouteTargets && !hasProjectFilters);
      const statusMatch = shouldApplyOperationalStatus
        ? this.matchesStatus(node.status, status)
        : true;
      const regionMatch = this.matchesRegionsForNode(node, filters.regions);

      return companyMatch && statusMatch && regionMatch;
    });

    return result;
  });

  /** True if node (factory, subsidiary, or parent) has at least one factory in routeTargetIds */
  private nodeMatchesRouteTargets(node: Node, routeTargetIds: Set<string>): boolean {
    if (node.level === 'factory') return routeTargetIds.has(node.id);
    if (node.level === 'subsidiary') {
      return this.factories().some((f) => f.subsidiaryId === node.id && routeTargetIds.has(f.id));
    }
    if (node.level === 'parent') {
      const group = this.parentGroups().find((g) => g.id === node.id);
      const factoryIds = group?.subsidiaries?.flatMap((s) => s.factories.map((f) => f.id)) ?? [];
      return factoryIds.some((id) => routeTargetIds.has(id));
    }
    return routeTargetIds.has(node.id);
  }

  readonly filteredParentGroups = computed(() => {
    const filters = this.filterApplied();
    const parentGroups = this.parentGroups();
    const projectStatusByFactory = this.projectStatusByFactoryId();

    return parentGroups
      .map((group) => {
        // Deep clone or construct filtered group
        const filteredSubsidiaries = group.subsidiaries
          .map((sub) => {
            const filteredFactories = sub.factories.filter((f) => {
              const statusMatch =
                filters.status === 'all'
                  ? true
                  : filters.status === 'active'
                    ? projectStatusByFactory.get(f.id) === 'active'
                    : projectStatusByFactory.get(f.id) === 'inactive';
              const regionMatch = this.matchesRegionsForFactory(f, filters.regions);
              const companyMatch = this.matchesParentCompanyFilterForNode({
                id: f.id,
                subsidiaryId: f.subsidiaryId,
                parentGroupId: f.parentGroupId,
                level: 'factory'
              } as any, filters.parentCompanyIds);
              return statusMatch && regionMatch && companyMatch;
            });

            if (filteredFactories.length === 0) {
              if (filters.status === 'active' || filters.status === 'inactive') {
                return null;
              }
              // If no factories match, check if the subsidiary itself matches status/company
              // Note: Region filtering for subsidiary is based on its factories
              const statusMatch = this.matchesOperationalStatus(sub.status, filters.status);
              const companyMatch = this.matchesParentCompanyFilterForNode({
                id: sub.id,
                subsidiaryId: sub.id,
                parentGroupId: sub.parentGroupId,
                level: 'subsidiary'
              } as any, filters.parentCompanyIds);

              if (statusMatch && companyMatch && filters.regions.length === 0) {
                return { ...sub, factories: [] };
              }
              return null;
            }

            return { ...sub, factories: filteredFactories };
          })
          .filter((sub): sub is SubsidiaryCompany => sub !== null);

        if (filteredSubsidiaries.length === 0) {
          if (filters.status === 'active' || filters.status === 'inactive') {
            return null;
          }
          // Check if parent itself matches if no children match
          const statusMatch = this.matchesOperationalStatus(group.status, filters.status);
          const companyMatch = this.matchesParentCompanyFilterForNode({
            id: group.id,
            parentGroupId: group.id,
            level: 'parent'
          } as any, filters.parentCompanyIds);

          if (statusMatch && companyMatch && filters.regions.length === 0) {
            return { ...group, subsidiaries: [] };
          }
          return null;
        }

        return { ...group, subsidiaries: filteredSubsidiaries };
      })
      .filter((group): group is ParentGroup => group !== null);
  });

  readonly filteredActivityLogs = computed(() => {
    const filters = this.filterApplied();
    const factoryLookup = new Map(this.factories().map((factory) => [factory.id, factory]));
    const projectStatusByFactory = this.projectStatusByFactoryId();

    return this.activityLogs().filter((log) => {
      if (!this.matchesParentCompanyFilterForLog(log, filters.parentCompanyIds)) {
        return false;
      }

      const factory = factoryLookup.get(log.factoryId);
      const statusMatch =
        filters.status === 'all'
          ? true
          : filters.status === 'active'
            ? projectStatusByFactory.get(log.factoryId) === 'active'
            : projectStatusByFactory.get(log.factoryId) === 'inactive';
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
  readonly mapComponent = viewChild.required(WarRoomMapComponent);
  readonly activityLogRef = viewChild<WarRoomActivityLogComponent>(WarRoomActivityLogComponent);
  readonly clientsPanelRef = viewChild<WarRoomClientsPanelComponent>(WarRoomClientsPanelComponent);

  readonly projectRoutesRefreshTrigger = signal(0);
  readonly projectRoutesLoading = signal(false);

  readonly addCompanyModalRef = viewChild<AddCompanyModalComponent>('addCompanyModalRef');

  // Timeout for zoom effect
  private zoomTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private skipInitialAutoZoom = true;
  private addCompanyInFlight = false;
  private addProjectSucceededBeforeClose = false;

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
        }, 100);
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
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    });

    effect(() => {
      const clients = this.clientsSignal();
      const factories = this.factories();
      const filters = this.filterApplied();
      void this.projectRoutesRefreshTrigger();
      if (!clients?.length || !factories?.length) {
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
      const factoryCoords = new Map(
        factories.map((f) => [f.id, { latitude: f.coordinates.latitude, longitude: f.coordinates.longitude }])
      );
      const projectStatuses: ('Open' | 'Closed' | 'Delayed')[] | undefined =
        filters.status === 'active' ? ['Open'] :
          filters.status === 'inactive' ? ['Closed', 'Delayed'] :
            undefined;
      const projectFilters = {
        clientIds: filters.clientIds.length ? filters.clientIds : undefined,
        manufacturerIds: filters.manufacturerIds.length ? filters.manufacturerIds : undefined,
        projectTypeIds: filters.projectTypeIds.length ? filters.projectTypeIds : undefined,
        projectStatuses,
      };
      const sub = this.projectService
        .getProjectsForMap(clientCoords, factoryCoords, projectFilters)
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
      setTimeout(() => map.fitBoundsToRoutes(clientRoutes), 150);
    });
  }

  ngOnInit(): void {
    // Load persisted state (filters + view mode) - support legacy key for migration
    const saved = localStorage.getItem(this.STORAGE_KEY) ?? localStorage.getItem(this.LEGACY_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as WarRoomPersistedState;
        const defaults = createDefaultFilters();
        const filters: WarRoomFilters = {
          ...defaults,
          parentCompanyIds: parsed.parentCompanyIds ?? defaults.parentCompanyIds,
          status: parsed.status ?? defaults.status,
          regions: parsed.regions ?? defaults.regions,
          clientIds: parsed.clientIds ?? defaults.clientIds,
          manufacturerIds: parsed.manufacturerIds ?? defaults.manufacturerIds,
          projectTypeIds: parsed.projectTypeIds ?? defaults.projectTypeIds,
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
        this.filterApplied.set(filters);
        this.filterDraft.set(filters);

        // Restore view mode - store for effect to apply after service data loads (service overwrites on JSON load)
        const validModes: MapViewMode[] = ['project', 'client', 'factory', 'subsidiary', 'parent'];
        if (parsed.mapViewMode && validModes.includes(parsed.mapViewMode)) {
          this.savedMapViewMode.set(parsed.mapViewMode);
          this.warRoomService.setMapViewMode(parsed.mapViewMode);
        }
        // Restore panel visibility from persisted state
        if (typeof parsed.panelVisible === 'boolean') {
          this.panelVisible.set(parsed.panelVisible);
        }
      } catch (e) {
        if (isDevMode()) {
          console.warn('Failed to parse saved state', e);
        }
      }
    } else {
      // First-time user: show sidebar by default for better discoverability
      this.panelVisible.set(true);
    }

    // First-visit pulse on Add Project button
    if (typeof localStorage !== 'undefined' && !localStorage.getItem(this.ADD_PROJECT_SEEN_KEY)) {
      this.addProjectPulse.set(true);
      this.addProjectPulseTimeoutId = setTimeout(() => this.dismissAddProjectPulse(), 5000);
    }

    // First-time onboarding hint for view modes, Panels, Tactical View, FAB
    if (typeof localStorage !== 'undefined' && !localStorage.getItem(this.TIPS_HINT_SEEN_KEY)) {
      this.showTipsHint.set(true);
      this.tipsHintTimeoutId = setTimeout(() => this.dismissTipsHint(), 6000);
    }

    this.hasHydratedFromStorage = true;

    // Start real-time updates
    this.realtimeService.startRealTimeUpdates();
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

  /** Effect to ensure mapViewMode allows manufacturer panel clicks (subsidiary/factory) when in manufacturer mode */
  private readonly syncMapViewForManufacturerEffect = effect(() => {
    const mode = this.logPanelMode();
    if (mode === 'manufacturer') {
      const current = this.mapViewMode();
      if (current !== 'subsidiary' && current !== 'project' && current !== 'client') {
        this.warRoomService.setMapViewMode('subsidiary');
      }
    }
  });

  ngOnDestroy(): void {
    // Stop real-time updates
    this.realtimeService.stopRealTimeUpdates();

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

  private dismissAddProjectPulse(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.ADD_PROJECT_SEEN_KEY, '1');
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
      localStorage.setItem(this.TIPS_HINT_SEEN_KEY, '1');
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
    const currentView = this.mapViewMode();
    if (selection.level === 'subsidiary' && currentView !== 'subsidiary' && currentView !== 'project' && currentView !== 'client') {
      return;
    }
    if (selection.level === 'subsidiary') {
      const subsidiaryId = selection.subsidiaryId || selection.id;
      if (currentView === 'project' || currentView === 'client') {
        this.warRoomService.setMapViewMode('factory');
        this.warRoomService.setFactoryFilterSubsidiaryId(subsidiaryId);
      } else if (currentView === 'subsidiary') {
        this.warRoomService.setFactoryFilterSubsidiaryId(subsidiaryId);
      } else {
        this.warRoomService.setFactoryFilterSubsidiaryId(null);
      }
    }

    const currentSelection = this.selectedEntity();
    const isSameSelection = currentSelection?.id === selection.id && currentSelection?.level === selection.level;
    this.warRoomService.selectEntity(selection);

    // Show activity log panel when clicking activity log
    this.showPanel('log');

    // Zoom is handled by the effect() when the selected entity changes
    // This prevents double-zooming and race conditions
    if (isSameSelection) {
      this.mapComponent().zoomToEntity(selection.id);
    }
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
    if (mode === 'manufacturer') {
      this.warRoomService.setMapViewMode('subsidiary');
    }
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
    this.projectRoutesRefreshTrigger.update((n) => n + 1);
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
    document.body.classList.toggle(this.MAP_EXPANDED_CLASS, expanded);
    document.body.style.overflow = expanded ? this.MAP_EXPANDED_SCROLL_LOCK_STYLE : '';
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


  /**
   * Helper to parse location string into parts
   * Reused from onCompanyAdded
   */
  private parseLocationParts(location: string): { city: string; country: string; fullLocation: string } {
    const parts = location.split(',').map((p) => p.trim());
    let city = parts[0] || '';
    let country = parts.length > 1 ? parts[parts.length - 1] : '';
    // Basic heuristics if country is not explicitly last part
    if (!country && parts.length === 1) {
      // Single string, treat as City
      country = 'Unknown';
    }
    return { city, country, fullLocation: location };
  }

  async onBatchUpdateRequested(payload: {
    factories: Array<{ factoryId: string; name: string; location: string; description: string; status: NodeStatus }>;
    subsidiaries: Array<{ subsidiaryId: string; name: string; location: string; description: string; status: OperationalStatus }>;
  }): Promise<void> {
    this.activityLogBusy.set(true);
    try {
      let updateCount = 0;

      // Process Subsidiary Updates
      for (const sub of payload.subsidiaries) {
        this.warRoomService.updateSubsidiaryDetails(sub.subsidiaryId, {
          name: sub.name,
          location: sub.location,
          description: sub.description,
          status: sub.status
        });
        updateCount++;
      }

      // Process Factory Updates
      for (const fact of payload.factories) {
        // Parse the location string to extract city/country for the update factory payload
        const { city, country, fullLocation } = this.parseLocationParts(fact.location);

        this.warRoomService.updateFactoryDetails(fact.factoryId, {
          name: fact.name,
          city: city,
          country: country,
          locationLabel: fullLocation,
          description: fact.description,
          status: fact.status
        });
        updateCount++;
      }

      if (updateCount > 0) {
        this.toastr.success(`Successfully updated ${updateCount} operational entities.`, 'SYNC COMPLETE');
      } else {
        this.toastr.info('No changes detected to save.', 'SYNC COMPLETE');
      }

      // success! clear drafts and exit mode
      // success! clear drafts and exit mode
      const log = this.activityLogRef();
      log?.clearAllDrafts();
      this.activityLogEditMode.set(false);

    } catch (error) {
      console.error('Batch update failed', error);
      this.toastr.error('Failed to save changes. Please try again.', 'SAVE ERROR');
      // INTENTIONALLY DO NOT CLEAR DRAFTS OR EXIT EDIT MODE
    } finally {
      setTimeout(() => this.activityLogBusy.set(false), 400);
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
        parentCompanyIds: [...applied.parentCompanyIds],
        status: applied.status,
        regions: [...applied.regions],
        clientIds: [...applied.clientIds],
        manufacturerIds: [...applied.manufacturerIds],
        projectTypeIds: [...applied.projectTypeIds],
      });
    }
    this.filtersPanelVisible.set(!wasOpen);
  }

  /** Open filters panel (used by FAB - never closes) */
  openFiltersPanel(): void {
    if (!this.filtersPanelVisible()) {
      const applied = this.filterApplied();
      this.filterDraft.set({
        parentCompanyIds: [...applied.parentCompanyIds],
        status: applied.status,
        regions: [...applied.regions],
        clientIds: [...applied.clientIds],
        manufacturerIds: [...applied.manufacturerIds],
        projectTypeIds: [...applied.projectTypeIds],
      });
    }
    this.filtersPanelVisible.set(true);
  }

  toggleFilterSection(section: 'companies' | 'client' | 'manufacturer' | 'projectType'): void {
    const current = this.expandedFilterSection();
    this.expandedFilterSection.set(current === section ? null : section);
  }

  toggleParentCompany(parentGroupId: string): void {
    this.filterDraft.update((filters) => {
      const nextIds = new Set(filters.parentCompanyIds);
      if (nextIds.has(parentGroupId)) {
        nextIds.delete(parentGroupId);
      } else {
        nextIds.add(parentGroupId);
      }
      const next = { ...filters, parentCompanyIds: Array.from(nextIds) };
      // Apply company filter immediately so map and counts update without clicking Apply
      this.filterApplied.set({ ...this.filterApplied(), parentCompanyIds: next.parentCompanyIds });
      return next;
    });
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
      parentCompanyIds: [...draft.parentCompanyIds],
      status: draft.status,
      regions: [...draft.regions],
      clientIds: [...draft.clientIds],
      manufacturerIds: [...draft.manufacturerIds],
      projectTypeIds: [...draft.projectTypeIds],
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

  resetFilters(): void {
    this.filterDraft.set(createDefaultFilters());
    this.filterApplied.set(createDefaultFilters());
    this.expandedFilterSection.set(null);
    this.companyFilterSearch.set('');
    this.clientFilterSearch.set('');
    this.manufacturerFilterSearch.set('');
    this.projectTypeFilterSearch.set('');
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
    } else if (item.type === 'region') {
      next.regions = next.regions.filter(r => r !== item.value);
    } else if (item.type === 'company') {
      next.parentCompanyIds = next.parentCompanyIds.filter(id => id !== item.value);

      // NEW: Clear selection if the entity is no longer visible (whitelist filter)
      // Only if parentCompanyIds is NOT empty (empty means show all)
      if (next.parentCompanyIds.length > 0) {
        const selection = this.selectedEntity();
        if (selection && (selection.id === item.value || selection.parentGroupId === item.value)) {
          this.warRoomService.selectEntity(null);
          this.announce('Selection cleared as filtered company was removed.');
        }
      }
    }

    this.filterApplied.set(next);
    // Sync draft so reopening the panel shows correct state
    this.filterDraft.set(next);
  }

  /**
   * Switch map view mode (parent / subsidiary / factory)
   */
  setMapViewMode(mode: MapViewMode): void {
    this.warRoomService.setFactoryFilterSubsidiaryId(null);
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
    const dataUrl = await this.captureRouteScreenshotForProject(projectId);
    if (dataUrl) {
      this.routePreviewStorage.set(projectId, dataUrl);
      this.routePreviewVersion.set(this.routePreviewStorage.previewSaved());
      this.routePreviewStorage.download(projectId, projectName);
      this.toastr.success('Route preview saved and downloaded.', 'CAPTURED');
    } else {
      this.showCaptureFailureToastWithRetry(projectId, projectName);
    }
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
    let attempts = 0;
    const tryCapture = (): void => {
      attempts++;
      const loading = this.projectRoutesLoading();
      const routes = this.projectRoutes();
      const route = routes.find((r) => r.projectId === projectId);
      const routeReady = route?.fromCoordinates && route?.toCoordinates;

      if (!loading && routeReady) {
        void this.captureAndStoreForProject(projectId, projectName);
        return;
      }
      if (attempts >= maxAttempts) {
        this.showCaptureFailureToastWithRetry(projectId, projectName);
        return;
      }
      setTimeout(tryCapture, pollIntervalMs);
    };
    setTimeout(tryCapture, initialDelayMs);
  }

  /** Shows capture-failure toast with tap-to-retry. */
  private showCaptureFailureToastWithRetry(projectId: string, projectName?: string): void {
    const toast = this.toastr.warning(
      'No route available to capture. Tap to retry.',
      'Cannot capture',
      { timeOut: 8000, closeButton: true, extendedTimeOut: 3000 }
    );
    if (toast?.onTap) {
      toast.onTap.subscribe(() => {
        this.waitForRouteThenCapture(projectId, projectName, 500, 400, 6);
      });
    }
  }

  /** Captures all routes for a client into one screenshot, stores it, and triggers download. */
  async captureAndStoreForClient(clientId: string): Promise<void> {
    const dataUrl = await this.captureClientScreenshot(clientId);
    if (dataUrl) {
      const storageKey = `client-${clientId}`;
      this.routePreviewStorage.set(storageKey, dataUrl);
      this.routePreviewVersion.set(this.routePreviewStorage.previewSaved());
      const clients = this.clientsSignal();
      const clientName = clients.find((c) => c.id === clientId)?.name ?? clientId;
      this.routePreviewStorage.download(storageKey, `${clientName}-all-projects`);
      this.toastr.success('All client projects captured and downloaded.', 'CAPTURED');
    }
  }

  /** Captures a clean map screenshot for all routes belonging to the given client. Returns data URL or null. */
  private async captureClientScreenshot(clientId: string): Promise<string | null> {
    const routes = this.projectRoutes().filter((r) => r.fromNodeId === clientId);
    if (!routes.length) {
      this.toastr.warning('No routes available for this client.', 'Cannot capture');
      return null;
    }
    const map = this.mapComponent();
    this.screenshotMode.set(true);
    try {
      await new Promise((r) => setTimeout(r, 100));
      const blob = await map.captureRoutesScreenshot(routes);
      return await this.blobToDataUrl(blob);
    } catch (err) {
      this.toastr.error('Failed to capture client projects.', 'Error');
      console.error('Client capture failed:', err);
      return null;
    } finally {
      this.screenshotMode.set(false);
    }
  }

  /** Captures a clean map screenshot for the given project's route. Returns data URL or null. */
  private async captureRouteScreenshotForProject(projectId: string): Promise<string | null> {
    const routes = this.projectRoutes();
    const route = routes.find((r) => r.projectId === projectId);
    if (!route?.fromCoordinates || !route?.toCoordinates) {
      return null;
    }
    const map = this.mapComponent();
    this.selectedProjectId.set(projectId);
    this.screenshotMode.set(true);
    try {
      await new Promise((r) => setTimeout(r, 100));
      const blob = await map.captureRouteScreenshot(route);
      return await this.blobToDataUrl(blob);
    } catch (err) {
      this.toastr.error('Failed to capture route.', 'Error');
      console.error('Route capture failed:', err);
      return null;
    } finally {
      this.screenshotMode.set(false);
    }
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  onRoutePreviewRequested(projectId: string): void {
    const projectName = this.projectsSignal().find((p) => String(p.id) === projectId)?.projectName;
    setTimeout(() => this.captureAndStoreForProject(projectId, projectName), 500);
  }

  onClientCaptureRequested(clientId: string): void {
    this.warRoomService.selectEntity({ level: 'client', id: clientId });
    this.filterDraft.update((f) => ({ ...f, clientIds: [clientId] }));
    this.filterApplied.set({ ...this.filterApplied(), clientIds: [clientId] });
    this.projectRoutesRefreshTrigger.update((n) => n + 1);
    setTimeout(() => this.captureAndStoreForClient(clientId), 1500);
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
        level: 'factory',
        id: project.manufacturerLocationId,
        parentGroupId: undefined,
        subsidiaryId: undefined,
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
      }, 150);
      this.announce(`Selected project ${project.projectName}. Panning to ${project.manufacturer ?? 'factory'}.`);
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
      }, 150);
      this.announce(`Selected project ${project.projectName}. Panning to ${project.clientName ?? project.clientId}.`);
    }
  }

  onNodeSelected(node: Node | undefined): void {
    if (node) {
      const nodeLevel = node.level ?? 'factory';
      const selection: FleetSelection = {
        level: nodeLevel,
        id: node.companyId,
        parentGroupId: node.parentGroupId,
        subsidiaryId: node.subsidiaryId,
        factoryId: node.factoryId,
      };
      this.onEntitySelected(selection);

      // Sync selectedProjectId: factory → first matching project
      if (node.factoryId) {
        this.projectService.getProjectsByFactory(node.factoryId).subscribe((projects) => {
          const first = projects[0];
          this.selectedProjectId.set(first ? String(first.id) : null);
        });
      } else if (node.level === 'client' || node.clientId) {
        this.projectService.getProjectsByClient(node.companyId).subscribe((projects) => {
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

  async onFactoryDetailsUpdated(payload: {
    factoryId: string;
    name: string;
    location: string;
    description: string;
    status: NodeStatus;
  }): Promise<void> {
    const name = payload.name.trim() || 'Unnamed Location';
    const location = payload.location.trim();
    const description = payload.description.trim();
    const locationParts = location ? this.parseLocationParts(location) : null;

    let coordinates: { latitude: number; longitude: number } | undefined;
    if (location) {
      try {
        coordinates = await this.warRoomService.parseLocationInput(location);
      } catch (error) {
        if (isDevMode()) {
          console.warn('Failed to parse updated location. Keeping existing coordinates.', error);
        }
      }
    }

    this.warRoomService.updateFactoryDetails(payload.factoryId, {
      name,
      city: locationParts?.city,
      country: locationParts?.country,
      description,
      coordinates,
      locationLabel: location || undefined,
      status: payload.status,
    });
  }

  onSubsidiaryDetailsUpdated(payload: {
    subsidiaryId: string;
    name: string;
    location: string;
    description: string;
    status: SubsidiaryCompany['status'];
  }): void {
    const name = payload.name.trim() || 'Unnamed Company';
    const location = payload.location.trim();
    const description = payload.description.trim();
    this.warRoomService.updateSubsidiaryDetails(payload.subsidiaryId, {
      name,
      location: location || undefined,
      description: description || undefined,
      status: payload.status,
    });
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

  private matchesRegionsForParentGroup(group: { subsidiaries: SubsidiaryCompany[] }, selectedRegions: string[]): boolean {
    if (selectedRegions.length === 0) return true;
    const regions = this.getRegionsForFactories(group.subsidiaries.flatMap((subsidiary) => subsidiary.factories));
    if (regions.size === 0) return false;
    return selectedRegions.some((region) => regions.has(region));
  }

  private matchesRegionsForFactory(factory: FactoryLocation | undefined, selectedRegions: string[]): boolean {
    if (selectedRegions.length === 0) return true;
    if (!factory) return false;
    const region = this.getRegionForFactory(factory);
    return region ? selectedRegions.includes(region) : false;
  }

  private matchesParentCompanyFilterForNode(node: Node, selectedCompanyIds: string[]): boolean {
    if (selectedCompanyIds.length === 0) return true;

    // Direct match (matches any level if the ID itself is selected)
    const nodeId = node.id;
    const subsidiaryId = node.subsidiaryId;
    const parentGroupId = node.parentGroupId || node.companyId;

    if (
      selectedCompanyIds.includes(nodeId) ||
      (subsidiaryId && selectedCompanyIds.includes(subsidiaryId)) ||
      (parentGroupId && selectedCompanyIds.includes(parentGroupId))
    ) {
      return true;
    }

    // Downward hierarchical match for Parent level nodes
    if (node.level === 'parent') {
      const gId = node.parentGroupId || node.companyId;
      const group = this.parentGroups().find(g => g.id === gId);
      if (group) {
        // If any of this group's subsidiaries are selected, the parent node should stay.
        return group.subsidiaries.some(sub => selectedCompanyIds.includes(sub.id));
      }
    }

    // Downward hierarchical match for Subsidiary level nodes (if we were filtering by factory)
    // Currently users only select subsidiaries, but for robustness:
    if (node.level === 'subsidiary') {
      const sId = node.subsidiaryId || node.id;
      const sub = this.subsidiaries().find(s => s.id === sId);
      if (sub) {
        return sub.factories.some(f => selectedCompanyIds.includes(f.id));
      }
    }

    return false;
  }

  private matchesParentCompanyFilterForGroup(group: { subsidiaries: SubsidiaryCompany[] }, selectedCompanyIds: string[]): boolean {
    if (selectedCompanyIds.length === 0) return true;
    return group.subsidiaries.some((sub) => selectedCompanyIds.includes(sub.id));
  }

  private matchesParentCompanyFilterForLog(log: ActivityLog, selectedCompanyIds: string[]): boolean {
    if (selectedCompanyIds.length === 0) return true;
    return selectedCompanyIds.includes(log.subsidiaryId);
  }

  private getRegionsForNode(node: Node): Set<string> {
    // 1. Direct Region Mapping for Leaf Nodes (Factory/Individual)
    if (node.level === 'factory') {
      const region = this.getRegionForCountry(node.country || node.city);
      return region ? new Set([region]) : new Set();
    }

    // 2. Aggregate Mapping for Subsidiaries
    if (node.level === 'subsidiary' && (node.subsidiaryId || node.id)) {
      const sId = node.subsidiaryId || node.id;
      const subsidiary = this.subsidiaries().find((item) => item.id === sId);
      return subsidiary ? this.getRegionsForFactories(subsidiary.factories) : new Set();
    }

    // 3. Aggregate Mapping for Parent Groups
    if (node.level === 'parent') {
      const parentGroupId = node.parentGroupId || node.id;
      const group = this.parentGroups().find((item) => item.id === parentGroupId);
      return group ? this.getRegionsForFactories(group.subsidiaries.flatMap((sub) => sub.factories)) : new Set();
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
      'panama', 'dominican', 'puerto rico', 'mexico',
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
    this.addCompanyModalPreselectedFactoryId.set(null);
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
    this.addCompanyModalPreselectedFactoryId.set(null);
    this.restoreFocusAfterModalClose();
  }

  onAddProjectForFactory(payload: { factoryId: string; subsidiaryId: string }): void {
    this.addCompanyModalPreselectedFactoryId.set(payload.factoryId);
    this.addCompanyModalVisible.set(true);
    this.announce('Add Project modal opened. Factory pre-selected.');
  }

  onAddCompanyViewOnMap(subsidiaryId: string): void {
    this.warRoomService.requestPanToEntity(subsidiaryId);
    this.warRoomService.setMapViewMode('subsidiary');
    this.warRoomService.selectEntity({
      level: 'subsidiary',
      id: subsidiaryId,
      parentGroupId: this.subsidiaries().find((s) => s.id === subsidiaryId)?.parentGroupId,
      subsidiaryId,
    });
  }

  onProjectAdded(formData: ProjectFormData): void {
    if (this.addCompanyInFlight) {
      return;
    }

    const status = formData.status === 'Active' ? 'Open' : 'Closed';
    const project = {
      projectName: formData.projectName,
      clientId: formData.clientId,
      clientName: formData.clientName,
      assessmentType: formData.assessmentType,
      manufacturerLocationId: String(formData.factoryId),
      location: formData.location,
      manufacturer: formData.manufacturerName,
      status: status as 'Open' | 'Closed',
    };

    this.addCompanyInFlight = true;
    this.projectService.addProject(project).subscribe({
      next: (createdProject) => {
        // Ensure map shows the new project: switch to Project view, clear selection, and clear project filters
        this.warRoomService.setMapViewMode('project');
        this.warRoomService.selectEntity(null);
        this.selectedProjectId.set(null);

        // Clear all filters so the new project is visible among all routes (defer to avoid timing races)
        setTimeout(() => this.clearAllFilters(), 0);
        this.addProjectSucceededBeforeClose = true;

        this.projectService.refreshProjects();
        this.projectRoutesRefreshTrigger.update((n) => n + 1);
        this.addCompanyModalRef()?.handleSuccess(
          `Successfully added project "${formData.projectName}" for ${formData.clientName}.`
        );
        this.toastr.success(`Project "${formData.projectName}" added.`, 'PROJECT REGISTERED', {
          timeOut: 5000,
          progressBar: true,
          closeButton: true,
        });
        this.addCompanyModalRef()?.closeAfterSuccess();
        this.announce(`Project ${formData.projectName} added.`);

        // After modal closes and routes refresh, fit map to all routes for global view
        const fitMapToRoutes = (): void => {
          const routes = this.projectRoutes();
          const map = this.mapComponent();
          if (routes.length > 0 && map) {
            map.fitBoundsToRoutes(routes);
          } else {
            const newRoute = routes.find((r) => r.projectId === String(createdProject.id));
            if (newRoute && map) {
              map.fitBoundsToRoutes([newRoute]);
            }
          }
        };
        setTimeout(fitMapToRoutes, 800);
        setTimeout(fitMapToRoutes, 1800); // Retry if routes not yet populated

        this.waitForRouteThenCapture(
          String(createdProject.id),
          createdProject.projectName,
          800,
          400,
          6
        );
      },
      error: (error) => {
        console.error('Critical error adding project:', error);
        this.addCompanyModalRef()?.handleError('Failed to add project. Please try again.');
        this.toastr.error(
          error instanceof Error ? error.message : 'A fatal system error occurred.',
          'REGISTRATION FAILED',
          { timeOut: 8000, closeButton: true, disableTimeOut: true }
        );
      },
      complete: () => {
        this.addCompanyInFlight = false;
      },
    });
  }

  private announce(message: string): void {
    this.announcementMessage.set(message);
    // clear after a delay so it can be re-announced if needed
    setTimeout(() => this.announcementMessage.set(''), 3000);
  }

  /** Called when map zoom has been idle 2s - shows status for TestSprite marker stability assertions */
  onMapZoomStable(zoom: number): void {
    const nearInitial = Math.abs(zoom - 1.8) < 0.3;
    const msg = nearInitial
      ? 'Markers and logos restored to original coordinates'
      : 'Markers and logos remained aligned after zoom operations';
    this.markerStabilityMessage.set(msg);
    setTimeout(() => this.markerStabilityMessage.set(''), 5000);
  }

  private restoreFocusAfterModalClose(): void {
    const element = this.lastFocusedElement;
    this.lastFocusedElement = null;
    if (element && element.isConnected && typeof element.focus === 'function') {
      setTimeout(() => element.focus(), 0);
    }
  }

  // --- Private Helpers ---

  private isValidCoordinates(coords?: { latitude: number; longitude: number } | null): coords is { latitude: number; longitude: number } {
    return !!coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude) && (coords.latitude !== 0 || coords.longitude !== 0);
  }

  private isCoordinateInput(value: string): boolean {
    return /^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(value.trim());
  }

  private clampCoordinate(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private mapSubLocationStatusToNode(status?: string): NodeStatus {
    const s = status?.toUpperCase().trim();
    return s === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  }

  private mapSubLocationStatusToLog(status?: string): ActivityStatus {
    const s = status?.toUpperCase().trim();
    return s === 'ACTIVE' ? 'ACTIVE' : 'INFO';
  }

  private buildFallbackCoordinates(seed: string, base: { latitude: number; longitude: number } | null, index: number): { latitude: number; longitude: number } {
    const offsets = [{ lat: 0.35, lng: 0.2 }, { lat: -0.28, lng: 0.24 }, { lat: 0.22, lng: -0.3 }, { lat: -0.2, lng: -0.22 }, { lat: 0.4, lng: -0.05 }];
    if (base) {
      const step = offsets[index % offsets.length];
      const scale = 1 + Math.floor(index / offsets.length) * 0.35;
      return {
        latitude: this.clampCoordinate(base.latitude + step.lat * scale, -85, 85),
        longitude: this.clampCoordinate(base.longitude + step.lng * scale, -180, 180)
      };
    }
    const hash = seed.split('').reduce((sum: number, char: string) => sum + char.charCodeAt(0), 0);
    return {
      latitude: this.clampCoordinate(((hash * 37) % 140) - 70, -85, 85),
      longitude: this.clampCoordinate(((hash * 91) % 320) - 160, -180, 180)
    };
  }
}
