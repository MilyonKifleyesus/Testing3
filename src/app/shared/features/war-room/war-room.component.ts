import { Component, OnInit, OnDestroy, signal, inject, viewChild, effect, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { WarRoomService } from '../../../shared/services/war-room.service';
import { WarRoomRealtimeService } from '../../../shared/services/war-room-realtime.service';
import { ClientService } from '../../../shared/services/client.service';
import { ProjectService } from '../../../shared/services/project.service';
import { CompanyLocationService } from '../../../shared/services/company-location.service';
import { Node, ActivityLog, ParentGroup, FleetSelection, MapViewMode, SubsidiaryCompany, FactoryLocation, NodeStatus, ActivityStatus, TransitRoute, ProjectRoute } from '../../../shared/models/war-room.interface';
import { Project } from '../../../shared/models/project.model';
import { WarRoomMapComponent } from './components/war-room-map/war-room-map.component';
import { WarRoomActivityLogComponent } from './components/war-room-activity-log/war-room-activity-log.component';
import { WarRoomHubStatusComponent } from './components/war-room-hub-status/war-room-hub-status.component';
import { WarRoomProjectHudComponent } from './components/war-room-project-hud/war-room-project-hud.component';
import { WarRoomContextPanelComponent } from './components/war-room-context-panel/war-room-context-panel.component';
import { WarRoomCommandMenuComponent, CommandAction } from './components/war-room-command-menu/war-room-command-menu.component';
import { AddCompanyModalComponent, CompanyFormData } from './components/add-company-modal/add-company-modal.component';
import { ToastrService } from 'ngx-toastr';
import { OperationalStatus } from '../../../shared/models/war-room.interface';

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
  clientId: string;
  manufacturerId: string;
  projectType: string;
}

const createDefaultFilters = (): WarRoomFilters => ({
  parentCompanyIds: [],
  status: 'all',
  regions: [],
  clientId: 'all',
  manufacturerId: 'all',
  projectType: 'all',
});

@Component({
  selector: 'app-war-room',
  standalone: true,
  imports: [
    CommonModule,
    WarRoomMapComponent,
    WarRoomActivityLogComponent,
    WarRoomHubStatusComponent,
    WarRoomProjectHudComponent,
    WarRoomContextPanelComponent,
    WarRoomCommandMenuComponent,
    AddCompanyModalComponent,
  ],
  templateUrl: './war-room.component.html',
  styleUrl: './war-room.component.scss',
})
export class WarRoomComponent implements OnInit, OnDestroy {
  private readonly STORAGE_KEY = 'war-room-filters-v1';
  private readonly MAP_EXPANDED_CLASS = 'war-room-map-expanded';
  private lastFocusedElement: HTMLElement | null = null;
  // Inject services
  private warRoomService = inject(WarRoomService);
  private realtimeService = inject(WarRoomRealtimeService);
  private clientService = inject(ClientService);
  private projectService = inject(ProjectService);
  private companyLocationService = inject(CompanyLocationService);
  private toastr = inject(ToastrService);

  readonly clientsSignal = toSignal(this.clientService.getClients(), { initialValue: [] });
  readonly projectTypesSignal = toSignal(this.projectService.getProjectTypes(), { initialValue: [] });
  readonly manufacturersSignal = toSignal(this.projectService.getManufacturers(), { initialValue: [] });
  readonly projectRoutes = signal<ProjectRoute[]>([]);
  readonly selectedProjectId = signal<string | null>(null);

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

  // Overlay panel + expand state
  readonly panelVisible = signal<boolean>(false);
  readonly activePanel = signal<'log' | 'hub'>('log');
  readonly mapExpanded = signal<boolean>(false);

  // Activity log visibility - hidden by default (edit mode only)
  readonly activityLogEditMode = signal<boolean>(false);
  readonly activityLogBusy = signal<boolean>(false);

  // Add company modal (over map)
  readonly addCompanyModalVisible = signal<boolean>(false);

  // Filters panel state
  readonly filtersPanelVisible = signal<boolean>(false);
  readonly filterDraft = signal<WarRoomFilters>(createDefaultFilters());
  readonly filterApplied = signal<WarRoomFilters>(createDefaultFilters());

  // Tactical mode: map-only view with bottom-center view toggle
  readonly tacticalMode = signal<boolean>(false);

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

  /** Nodes merged with client nodes when project routes exist */
  readonly nodesWithClients = computed(() => {
    const base = this.nodes();
    const clients = this.clientsSignal();
    const routes = this.projectRoutes();
    if (!routes?.length || !clients?.length) return base;
    const clientIdsInRoutes = new Set(routes.map((r) => r.fromNodeId));
    const clientNodes: Node[] = clients
      .filter((c) => c.coordinates && clientIdsInRoutes.has(c.id))
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
    if (filters.clientId !== 'all') count += 1;
    if (filters.manufacturerId !== 'all') count += 1;
    if (filters.projectType !== 'all') count += 1;
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

    // Client
    if (filters.clientId !== 'all') {
      const clients = this.clientsSignal();
      const client = clients.find((c) => c.id === filters.clientId);
      const name = client ? client.name : filters.clientId;
      items.push({ type: 'client', label: `Client: ${name}`, value: filters.clientId });
    }

    // Manufacturer
    if (filters.manufacturerId !== 'all') {
      items.push({ type: 'manufacturer', label: `Manufacturer: ${filters.manufacturerId}`, value: filters.manufacturerId });
    }

    // Project Type
    if (filters.projectType !== 'all') {
      items.push({ type: 'projectType', label: `Project Type: ${filters.projectType}`, value: filters.projectType });
    }

    return items;
  });

  readonly statusCounts = computed(() => {
    const filters = this.filterApplied();
    const nodes = this.nodes();

    let active = 0;
    let inactive = 0;

    nodes.forEach((node) => {
      // 1. Check Context (Company/Region only)
      if (!this.matchesParentCompanyFilterForNode(node, filters.parentCompanyIds)) return;
      if (!this.matchesRegionsForNode(node, filters.regions)) return;

      // 2. Count based on Status
      if (this.matchesStatus(node.status, 'active')) {
        active++;
      } else {
        inactive++;
      }
    });

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

    const result = nodes.filter((node) => {
      // Client nodes (from project routes) always visible in factory view
      if (node.level === 'client') {
        return viewMode === 'factory';
      }

      const companyMatch = this.matchesParentCompanyFilterForNode(node, filters.parentCompanyIds);
      const isFleetZero = node.id === 'fleetzero' || node.subsidiaryId === 'fleetzero';
      const statusMatch = isFleetZero || this.matchesStatus(node.status, filters.status);
      const regionMatch = this.matchesRegionsForNode(node, filters.regions);

      return companyMatch && statusMatch && regionMatch;
    });

    return result;
  });

  readonly filteredParentGroups = computed(() => {
    const filters = this.filterApplied();
    const parentGroups = this.parentGroups();

    return parentGroups
      .map((group) => {
        // Deep clone or construct filtered group
        const filteredSubsidiaries = group.subsidiaries
          .map((sub) => {
            const filteredFactories = sub.factories.filter((f) => {
              const statusMatch = this.matchesStatus(f.status, filters.status);
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
    return this.activityLogs().filter((log) => {
      if (!this.matchesParentCompanyFilterForLog(log, filters.parentCompanyIds)) {
        return false;
      }

      const factory = factoryLookup.get(log.factoryId);
      if (!this.matchesStatus(factory?.status, filters.status)) {
        return false;
      }

      if (!this.matchesRegionsForFactory(factory, filters.regions)) {
        return false;
      }

      return true;
    });
  });

  readonly filteredTransitRoutes = computed(() => {
    const routes = this.transitRoutes();
    const nodes = this.filteredNodes();
    const filteredNodeIds = new Set(nodes.map(n => n.id));

    const isValidCoordinates = (coords?: { latitude: number; longitude: number } | null): boolean => {
      if (!coords) return false;
      if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return false;
      if (coords.latitude === 0 && coords.longitude === 0) return false;
      return true;
    };

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

      // FleetZero is global – neither active nor inactive; always visible for route endpoints.
      const isFleetZero = (node: Node | undefined) =>
        node != null && (node.id === 'fleetzero' || node.subsidiaryId === 'fleetzero');
      const isEndpointVisible = (node: Node | undefined) =>
        node != null && (filteredNodeIds.has(node.id) || isFleetZero(node));

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

  readonly addCompanyModalRef = viewChild<AddCompanyModalComponent>('addCompanyModalRef');

  // Timeout for zoom effect
  private zoomTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private skipInitialAutoZoom = true;
  private addCompanyInFlight = false;

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

    // Save filters on change
    effect(() => {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.filterApplied()));
    });

    effect(() => {
      const clients = this.clientsSignal();
      const factories = this.factories();
      const filters = this.filterApplied();
      if (!clients?.length || !factories?.length) {
        this.projectRoutes.set([]);
        return;
      }
      const clientCoords = new Map(
        clients
          .filter((c) => c.coordinates)
          .map((c) => [c.id, c.coordinates!])
      );
      const factoryCoords = new Map(
        factories.map((f) => [f.id, { latitude: f.coordinates.latitude, longitude: f.coordinates.longitude }])
      );
      const projectFilters = {
        clientId: filters.clientId !== 'all' ? filters.clientId : undefined,
        projectType: filters.projectType !== 'all' ? filters.projectType : undefined,
        manufacturer: filters.manufacturerId !== 'all' ? filters.manufacturerId : undefined,
      };
      const sub = this.projectService
        .getProjectsForMap(clientCoords, factoryCoords, projectFilters)
        .subscribe((routes) => this.projectRoutes.set(routes));
      return () => sub.unsubscribe();
    });
  }

  ngOnInit(): void {
    // Load persisted filters (merge with defaults for backward compatibility)
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) {
      try {
        const defaults = createDefaultFilters();
        const parsed = { ...defaults, ...JSON.parse(saved) };
        parsed.clientId = parsed.clientId ?? 'all';
        parsed.manufacturerId = parsed.manufacturerId ?? 'all';
        parsed.projectType = parsed.projectType ?? 'all';
        this.filterApplied.set(parsed);
        this.filterDraft.set(parsed);
      } catch (e) {
        console.warn('Failed to parse saved filters', e);
      }
    }

    // Start real-time updates
    this.realtimeService.startRealTimeUpdates();
  }

  ngOnDestroy(): void {
    // Stop real-time updates
    this.realtimeService.stopRealTimeUpdates();

    // Clear zoom timeout
    if (this.zoomTimeoutId) {
      clearTimeout(this.zoomTimeoutId);
      this.zoomTimeoutId = null;
    }

    document.body?.classList.remove(this.MAP_EXPANDED_CLASS);
  }

  /**
   * Handle entity selection from activity log
   */
  onEntitySelected(selection: FleetSelection): void {
    if (selection.level === 'subsidiary' && this.mapViewMode() !== 'subsidiary') {
      return;
    }

    const currentSelection = this.selectedEntity();
    const isSameSelection = currentSelection?.id === selection.id && currentSelection?.level === selection.level;
    this.warRoomService.selectEntity(selection);
    const currentView = this.mapViewMode();
    if (selection.level === 'subsidiary' && currentView === 'subsidiary') {
      const subsidiaryId = selection.subsidiaryId || selection.id;
      this.warRoomService.setFactoryFilterSubsidiaryId(subsidiaryId);
    } else if (selection.level === 'subsidiary') {
      this.warRoomService.setFactoryFilterSubsidiaryId(null);
    }

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

  showPanel(panel: 'log' | 'hub'): void {
    this.activePanel.set(panel);
    this.panelVisible.set(true);
    this.announce(panel === 'log' ? 'Activity log opened.' : 'Hub status opened.');
  }

  toggleMapExpanded(): void {
    const next = !this.mapExpanded();
    this.mapExpanded.set(next);
    document.body?.classList.toggle(this.MAP_EXPANDED_CLASS, next);
    if (next) {
      this.panelVisible.set(false);
      this.announce('Map expanded.');
    } else {
      this.announce('Map returned to standard view.');
    }
  }

  onSaveChanges(): void {
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
        clientId: applied.clientId ?? 'all',
        manufacturerId: applied.manufacturerId ?? 'all',
        projectType: applied.projectType ?? 'all',
      });
    }
    this.filtersPanelVisible.set(!wasOpen);
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

    console.log(`[WarRoom] Status filter changed to: ${status} [Applied Instantly]`);
  }

  applyFilters(): void {
    const draft = this.filterDraft();
    console.log('[WarRoom] Applying Filters:', draft);

    this.filterApplied.set({
      parentCompanyIds: [...draft.parentCompanyIds],
      status: draft.status,
      regions: [...draft.regions],
      clientId: draft.clientId ?? 'all',
      manufacturerId: draft.manufacturerId ?? 'all',
      projectType: draft.projectType ?? 'all',
    });
    this.filtersPanelVisible.set(false);
    this.announce('Filters applied. ' + this.activeFilterCount() + ' filters active.');
  }

  setClientFilter(value: string): void {
    this.filterDraft.update((f) => ({ ...f, clientId: value }));
  }

  setManufacturerFilter(value: string): void {
    this.filterDraft.update((f) => ({ ...f, manufacturerId: value }));
  }

  setProjectTypeFilter(value: string): void {
    this.filterDraft.update((f) => ({ ...f, projectType: value }));
  }

  resetFilters(): void {
    this.filterDraft.set(createDefaultFilters());
    this.filterApplied.set(createDefaultFilters());
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
      next.clientId = 'all';
    } else if (item.type === 'manufacturer') {
      next.manufacturerId = 'all';
    } else if (item.type === 'projectType') {
      next.projectType = 'all';
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
    }
    this.announce(next ? 'Tactical mode on. Map only view.' : 'Tactical mode off.');
  }

  /**
   * Handle node selection from map
   */
  onCommandAction(action: CommandAction): void {
    switch (action) {
      case 'addCompany':
        this.onAddCompanyRequested();
        break;
      case 'panels':
        this.togglePanels();
        break;
      case 'filters':
        this.toggleFiltersPanel();
        break;
      case 'tactical':
        this.toggleTacticalMode();
        break;
      case 'expandMap':
        this.toggleMapExpanded();
        break;
    }
  }

  onRouteSelected(payload: { routeId: string; projectId?: string }): void {
    if (payload.projectId) {
      this.selectedProjectId.set(payload.projectId);
    }
  }

  onProjectHudSelected(project: Project): void {
    this.selectedProjectId.set(String(project.id));
    if (project.manufacturerLocationId) {
      this.warRoomService.setMapViewMode('factory');
      this.warRoomService.selectEntity({
        level: 'factory',
        id: project.manufacturerLocationId,
        parentGroupId: undefined,
        subsidiaryId: undefined,
        factoryId: project.manufacturerLocationId,
      });
      this.warRoomService.requestPanToEntity(project.manufacturerLocationId);
      this.announce(`Selected project ${project.projectName}. Panning to ${project.manufacturer ?? 'factory'}.`);
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
        console.warn('Failed to parse updated location. Keeping existing coordinates.', error);
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

  /** Single source of truth: only ACTIVE is active; everything else is inactive. */
  private isActiveStatus(status: string | undefined): boolean {
    if (!status) return false;
    return String(status).toUpperCase().trim() === 'ACTIVE';
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
    const active = document.activeElement;
    this.lastFocusedElement = active instanceof HTMLElement ? active : null;
    this.addCompanyModalVisible.set(true);
    this.showPanel('hub');
    this.announce('Add Company modal opened.');
  }

  onAddCompanyModalClose(): void {
    this.addCompanyModalVisible.set(false);
    this.restoreFocusAfterModalClose();
  }

  async onCompanyAdded(formData: CompanyFormData): Promise<void> {
    if (this.addCompanyInFlight) {
      return;
    }
    if (!formData.companyName?.trim() || !formData.location?.trim()) {
      console.warn('Company name and location are required.');
      this.addCompanyModalRef()?.handleError('Company name and location are required.');
      return;
    }

    try {
      this.addCompanyInFlight = true;

      // 1. Parallel Location Parsing
      const locationPromises: Promise<{ id: string, coords: { latitude: number, longitude: number } | null }>[] = [
        this.warRoomService.parseLocationInput(formData.location).then(c => ({ id: 'main', coords: c })),
      ];

      if (formData.sourceLocation?.trim()) {
        locationPromises.push(this.warRoomService.parseLocationInput(formData.sourceLocation).then(c => ({ id: 'source', coords: c })));
      }

      const subLocations = (formData.subLocations ?? []).filter(sl => sl.name?.trim() && sl.location?.trim());
      subLocations.forEach((sl, idx) => {
        locationPromises.push(this.warRoomService.parseLocationInput(sl.location).then(c => ({ id: `sub-${idx}`, coords: c })));
      });

      const parsedLocations = await Promise.all(locationPromises);
      const locationMap = new Map(parsedLocations.map(l => [l.id, l.coords]));

      // 2. Main Location Logic
      let locationData = locationMap.get('main') || { latitude: 0, longitude: 0 };
      if ((locationData.latitude === 0 && locationData.longitude === 0) && !this.isCoordinateInput(formData.location)) {
        locationData = this.buildFallbackCoordinates(formData.location, null, 0);
      }

      const parentGroupId = this.selectedEntity()?.parentGroupId ||
        (this.selectedEntity()?.level === 'parent' ? this.selectedEntity()?.id : null) ||
        this.parentGroups()[0]?.id || 'global-group';

      const companyName = formData.companyName.trim();
      const subsidiaryId = this.warRoomService.generateSubsidiaryId(companyName);
      const factoryId = this.warRoomService.generateFactoryId(`${companyName}-${formData.location}`);

      const { city, country, fullLocation } = this.parseLocationParts(formData.location);
      const hubCode = this.generateHubCode(companyName);
      const logoValue = typeof formData.logo === 'string' ? formData.logo : undefined;

      // 3. Transit Routes
      const sourceLocationData = locationMap.get('source');
      if (sourceLocationData && this.isValidCoordinates(sourceLocationData)) {
        this.warRoomService.addTransitRoute({
          id: `route-src-${factoryId}-${Date.now()}`,
          from: `source-${factoryId}`,
          to: factoryId,
          fromCoordinates: sourceLocationData,
          toCoordinates: locationData,
          animated: true,
          strokeColor: '#6ee755',
          strokeWidth: 2,
        });
      }

      // FleetZero HQ Connection
      if (this.isValidCoordinates(locationData)) {
        this.warRoomService.addTransitRoute({
          id: `route-fleetzero-${factoryId}-${Date.now()}`,
          from: factoryId,
          to: 'fleetzero',
          fromCoordinates: locationData,
          toCoordinates: { latitude: 43.6532, longitude: -79.3832 },
          animated: true,
          strokeColor: formData.status === 'ACTIVE' ? '#00C853' : '#D50000',
          strokeWidth: 1.5,
        });
      }

      // 4. Factory and Sub-locations
      const newFactory: FactoryLocation = {
        id: factoryId,
        parentGroupId,
        subsidiaryId,
        name: `${companyName} - ${city}`,
        city: city || 'Unknown',
        country,
        coordinates: locationData,
        status: formData.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
        syncStability: 98,
        assets: 0,
        incidents: 0,
        description: formData.description?.trim() || undefined,
        logo: logoValue,
      };

      const additionalFactories: FactoryLocation[] = [];
      const additionalLogs: ActivityLog[] = [];

      for (const [index, subLocation] of subLocations.entries()) {
        let subCoords = locationMap.get(`sub-${index}`) || { latitude: 0, longitude: 0 };
        if (subCoords.latitude === 0 && subCoords.longitude === 0 && !this.isCoordinateInput(subLocation.location)) {
          subCoords = this.buildFallbackCoordinates(subLocation.location, locationData, index);
        }

        const { city: subCity, country: subCountry, fullLocation: subFullLocation } = this.parseLocationParts(subLocation.location);
        const subFactoryId = this.warRoomService.generateManufacturerLocationId(companyName, subLocation.name || '', subCity || subLocation.location);
        const factoryName = subLocation.name || `${companyName} - ${subCity}`;
        const factoryStatus = this.mapSubLocationStatusToNode(subLocation.status);

        const subFactory: FactoryLocation = {
          id: subFactoryId,
          parentGroupId,
          subsidiaryId,
          name: factoryName,
          city: subCity || 'Unknown',
          country: subCountry,
          coordinates: subCoords,
          status: factoryStatus,
          syncStability: factoryStatus === 'INACTIVE' ? 72 : 96,
          assets: 0,
          incidents: 0,
          description: formData.description?.trim() || undefined,
          logo: logoValue,
        };

        additionalFactories.push(subFactory);

        // Connection to Hub
        if (this.isValidCoordinates(subCoords) && this.isValidCoordinates(locationData)) {
          this.warRoomService.addTransitRoute({
            id: `route-hub-${subFactoryId}-${Date.now()}`,
            from: subFactoryId,
            to: factoryId,
            fromCoordinates: subCoords,
            toCoordinates: locationData,
            animated: true,
            strokeColor: '#0ea5e9',
            strokeWidth: 1.5,
            dashArray: '3,3',
          });
        }

        const logStatus = this.mapSubLocationStatusToLog(subLocation.status);
        additionalLogs.push({
          id: `log-${subFactoryId}`,
          timestamp: new Date(),
          status: logStatus,
          title: `${companyName.toUpperCase()} | ${factoryName.toUpperCase()}`,
          description: logStatus === 'WARNING' ? 'INACTIVE // DISPATCHED' : 'ACTIVE',
          parentGroupId,
          subsidiaryId,
          factoryId: subFactoryId,
          location: subFullLocation,
          logo: logoValue,
        });
      }

      // 5. Finalize Subsidiary
      const newSubsidiary: SubsidiaryCompany = {
        id: subsidiaryId,
        parentGroupId,
        name: companyName.toUpperCase(),
        status: formData.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
        metrics: { assetCount: 0, incidentCount: 0, syncStability: 98 },
        factories: [newFactory, ...additionalFactories],
        hubs: [{
          id: `hub-${subsidiaryId}-${Date.now()}`,
          code: hubCode,
          companyId: subsidiaryId,
          companyName: companyName.toUpperCase(),
          status: 'ACTIVE',
          capacity: '100% CAP',
          capacityPercentage: 100,
          statusColor: 'text-tactical-green',
          capColor: 'text-tactical-green',
        }],
        quantumChart: { dataPoints: [85, 88, 90, 92, 89, 91], highlightedIndex: 3 },
        logo: logoValue,
        description: formData.description?.trim() || undefined,
        location: fullLocation || undefined,
      };

      this.warRoomService.addSubsidiary(newSubsidiary);

      // Sync to CompanyLocationService for address management and project linking
      this.companyLocationService.addCompany({
        name: companyName,
        description: formData.description?.trim(),
      }).subscribe({
        next: (company) => {
          this.companyLocationService.addLocation({
            companyId: company.id,
            fullStreetAddress: fullLocation || `${city}, ${country}`,
            city: city || 'Unknown',
            country: country || undefined,
            coordinates: this.isValidCoordinates(locationData) ? locationData : undefined,
            manufacturerLocationId: factoryId,
          }).subscribe();
          for (const [index, subLocation] of subLocations.entries()) {
            const { city: subCity, country: subCountry, fullLocation: subFullLocation } = this.parseLocationParts(subLocation.location);
            const subFactory = additionalFactories[index];
            if (subFactory) {
              this.companyLocationService.addLocation({
                companyId: company.id,
                fullStreetAddress: subFullLocation || `${subCity}, ${subCountry}`,
                city: subCity || 'Unknown',
                country: subCountry || undefined,
                manufacturerLocationId: subFactory.id,
              }).subscribe();
            }
          }
        },
      });

      this.warRoomService.addActivityLog({
        id: `log-${factoryId}`,
        timestamp: new Date(),
        status: 'ACTIVE',
        title: `${companyName.toUpperCase()} | ${city.toUpperCase()}`,
        description: formData.description?.trim() || 'SYSTEM INITIALIZED',
        parentGroupId,
        subsidiaryId,
        factoryId,
        location: fullLocation,
        logo: logoValue,
      });
      additionalLogs.forEach(log => this.warRoomService.addActivityLog(log));

      // Reset filters to show new data
      this.resetFilters();
      this.warRoomService.setFactoryFilterSubsidiaryId(null);

      // Signal success to modal
      this.addCompanyModalRef()?.handleSuccess(
        `Successfully connected ${formData.companyName} with ${1 + (formData.subLocations?.length || 0)} locations.`
      );

      // Show success notification
      const totalLocations = 1 + (formData.subLocations?.length || 0);
      this.toastr.success(`Successfully connected ${formData.companyName} with ${totalLocations} locations.`, 'BOOTSTRAP COMPLETE', {
        timeOut: 5000,
        progressBar: true,
        closeButton: true
      });

      this.warRoomService.setMapViewMode('factory');
      this.warRoomService.selectEntity({ level: 'factory', id: factoryId, parentGroupId, subsidiaryId, factoryId });
      this.warRoomService.requestPanToEntity(factoryId);
      this.showPanel('log');

      this.announce('Company ' + formData.companyName + ' added successfully.');

      // Delayed close
      this.addCompanyModalRef()?.closeAfterSuccess();
    } catch (error) {
      console.error('Critical error adding company:', error);
      const errorMsg = error instanceof Error ? error.message : 'A fatal system error occurred during registration.';
      this.addCompanyModalRef()?.handleError('Failed to add subsidiary. Please try again.');
      this.toastr.error(errorMsg, 'REGISTRATION FAILED', {
        timeOut: 8000,
        closeButton: true,
        disableTimeOut: true
      });
    } finally {
      this.addCompanyInFlight = false;
    }
  }

  private generateHubCode(companyName: string): string {
    const words = companyName.toUpperCase().split(/\s+/);
    if (words.length >= 2) {
      const firstChar = words[0][0] ?? '';
      const secondWord = words[1];
      const secondChar = secondWord.charAt(0) ?? '';
      const thirdChar = secondWord.length > 1 ? secondWord.charAt(1) : secondWord.charAt(0);
      return (firstChar + secondChar + thirdChar).substring(0, 3);
    }
    return companyName.toUpperCase().substring(0, 3).padEnd(3, 'X');
  }

  private announce(message: string): void {
    this.announcementMessage.set(message);
    // clear after a delay so it can be re-announced if needed
    setTimeout(() => this.announcementMessage.set(''), 3000);
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
    const hash = seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return {
      latitude: this.clampCoordinate(((hash * 37) % 140) - 70, -85, 85),
      longitude: this.clampCoordinate(((hash * 91) % 320) - 160, -180, 180)
    };
  }
}
