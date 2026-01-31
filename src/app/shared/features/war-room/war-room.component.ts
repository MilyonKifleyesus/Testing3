import { Component, OnInit, OnDestroy, signal, inject, viewChild, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WarRoomService } from '../../../shared/services/war-room.service';
import { WarRoomRealtimeService } from '../../../shared/services/war-room-realtime.service';
import { Node, ActivityLog, FleetSelection, MapViewMode, SubsidiaryCompany, FactoryLocation, NodeStatus, ActivityStatus, TransitRoute } from '../../../shared/models/war-room.interface';
import { WarRoomMapComponent } from './components/war-room-map/war-room-map.component';
import { WarRoomActivityLogComponent } from './components/war-room-activity-log/war-room-activity-log.component';
import { WarRoomHubStatusComponent } from './components/war-room-hub-status/war-room-hub-status.component';
import { AddCompanyModalComponent, CompanyFormData } from './components/add-company-modal/add-company-modal.component';

type FilterStatus = 'all' | 'active' | 'inactive';

interface WarRoomFilters {
  parentCompanyIds: string[];
  status: FilterStatus;
  regions: string[];
}

const createDefaultFilters = (): WarRoomFilters => ({
  parentCompanyIds: [],
  status: 'all',
  regions: [],
});

@Component({
  selector: 'app-war-room',
  standalone: true,
  imports: [
    CommonModule,
    WarRoomMapComponent,
    WarRoomActivityLogComponent,
    WarRoomHubStatusComponent,
    AddCompanyModalComponent,
  ],
  templateUrl: './war-room.component.html',
  styleUrl: './war-room.component.scss',
})
export class WarRoomComponent implements OnInit, OnDestroy {
  // Inject services
  private warRoomService = inject(WarRoomService);
  private realtimeService = inject(WarRoomRealtimeService);

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

  // Activity log visibility - hidden by default
  readonly activityLogVisible = signal<boolean>(false);
  readonly activityLogEditMode = signal<boolean>(false);

  // Hub status visibility - hidden by default
  readonly hubStatusVisible = signal<boolean>(false);

  // Add company modal (over map)
  readonly addCompanyModalVisible = signal<boolean>(false);

  // Filters panel state
  readonly filtersPanelVisible = signal<boolean>(false);
  readonly filterDraft = signal<WarRoomFilters>(createDefaultFilters());
  readonly filterApplied = signal<WarRoomFilters>(createDefaultFilters());

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

  readonly activeFilterCount = computed(() => {
    const filters = this.filterApplied();
    let count = filters.parentCompanyIds.length + filters.regions.length;
    if (filters.status !== 'all') {
      count += 1;
    }
    return count;
  });

  readonly statusCounts = computed(() => {
    const filters = this.filterDraft();
    const subsidiaries = this.subsidiaries().filter((subsidiary) => {
      if (filters.parentCompanyIds.length > 0 && !filters.parentCompanyIds.includes(subsidiary.id)) {
        return false;
      }
      if (filters.regions.length > 0) {
        const regions = this.getRegionsForFactories(subsidiary.factories);
        if (regions.size === 0) return false;
        if (!filters.regions.some((region) => regions.has(region))) {
          return false;
        }
      }
      return true;
    });

    const factories = this.factories().filter((factory) => {
      if (filters.parentCompanyIds.length > 0 && !filters.parentCompanyIds.includes(factory.subsidiaryId)) {
        return false;
      }
      if (!this.matchesRegionsForFactory(factory, filters.regions)) {
        return false;
      }
      return true;
    });

    let active = 0;
    let inactive = 0;
    subsidiaries.forEach((subsidiary) => {
      if (this.matchesOperationalStatus(subsidiary.status, 'active')) {
        active += 1;
      } else {
        inactive += 1;
      }
    });
    factories.forEach((factory) => {
      if (this.matchesStatus(factory.status, 'active')) {
        active += 1;
      } else {
        inactive += 1;
      }
    });

    return {
      total: subsidiaries.length + factories.length,
      active,
      inactive,
    };
  });

  readonly filteredNodes = computed(() => {
    const filters = this.filterApplied();
    const nodes = this.nodes();
    return nodes.filter((node) => {
      // Special case: FleetZero command hub is always visible
      if (node.id === 'fleetzero' || node.subsidiaryId === 'fleetzero' || node.name?.toLowerCase().includes('fleetzero')) {
        return true;
      }

      if (!this.matchesParentCompanyFilterForNode(node, filters.parentCompanyIds)) {
        return false;
      }

      if (!this.matchesStatus(node.status, filters.status)) {
        return false;
      }

      if (!this.matchesRegionsForNode(node, filters.regions)) {
        return false;
      }

      return true;
    });
  });

  readonly filteredParentGroups = computed(() => {
    const filters = this.filterApplied();
    return this.parentGroups().filter((group) => {
      if (!this.matchesParentCompanyFilterForGroup(group, filters.parentCompanyIds)) {
        return false;
      }

      if (!this.matchesOperationalStatus(group.status, filters.status)) {
        return false;
      }

      if (!this.matchesRegionsForParentGroup(group, filters.regions)) {
        return false;
      }

      return true;
    });
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
    const allNodes = this.nodes(); // All nodes for finding route endpoints
    const selected = this.selectedEntity();

    console.log('[Route Filtering] Starting filter with:', {
      totalRoutes: routes.length,
      filteredNodes: nodes.length,
      allNodes: allNodes.length,
      selectedEntity: selected?.id
    });

    // Create a set of filtered node IDs for fast lookup
    const filteredNodeIds = new Set(nodes.map(n => n.id));

    const filtered = routes.filter((route) => {
      // VALIDATION 1: Ensure both source and destination coordinates exist
      if (!route.fromCoordinates || !route.toCoordinates) {
        console.warn(`[Route Filtering] Route ${route.id} missing coordinates:`, {
          from: route.from,
          to: route.to,
          hasFromCoords: !!route.fromCoordinates,
          hasToCoords: !!route.toCoordinates
        });
        return false;
      }

      // VALIDATION 2: Validate that coordinates have required location fields
      const hasValidFromCoords =
        typeof route.fromCoordinates.latitude === 'number' &&
        typeof route.fromCoordinates.longitude === 'number' &&
        Number.isFinite(route.fromCoordinates.latitude) &&
        Number.isFinite(route.fromCoordinates.longitude);

      const hasValidToCoords =
        typeof route.toCoordinates.latitude === 'number' &&
        typeof route.toCoordinates.longitude === 'number' &&
        Number.isFinite(route.toCoordinates.latitude) &&
        Number.isFinite(route.toCoordinates.longitude);

      // VALIDATION 3: Prevent drawing lines when either endpoint is missing valid coordinates
      if (!hasValidFromCoords || !hasValidToCoords) {
        console.warn(`[Route Filtering] Route ${route.id} has invalid coordinates:`, {
          from: route.from,
          to: route.to,
          fromCoords: route.fromCoordinates,
          toCoordinates: route.toCoordinates,
          validFrom: hasValidFromCoords,
          validTo: hasValidToCoords
        });
        return false;
      }

      // Find the actual nodes that this route connects
      const findNodeForRouteEndpoint = (identifier: string) => {
        return allNodes.find(n =>
          n.id === identifier ||
          n.companyId === identifier ||
          (n.level === 'factory' && n.subsidiaryId === identifier) ||
          n.name === identifier ||
          n.city === identifier ||
          (!!n.company && n.company.toLowerCase() === identifier.toLowerCase())
        );
      };

      // Check if route endpoint is an external source or FleetZero
      const fromIsExternalSource = route.from.startsWith('source-');
      const toIsExternalSource = route.to.startsWith('source-');
      const fromIsFleetZero = route.from.toLowerCase() === 'fleetzero' || route.from.toLowerCase().includes('fleet-zero');
      const toIsFleetZero = route.to.toLowerCase() === 'fleetzero' || route.to.toLowerCase().includes('fleet-zero');

      // Find actual nodes for non-external/non-FleetZero endpoints
      const fromNode = fromIsExternalSource || fromIsFleetZero ? null : findNodeForRouteEndpoint(route.from);
      const toNode = toIsExternalSource || toIsFleetZero ? null : findNodeForRouteEndpoint(route.to);

      // Check if nodes are in the filtered list
      // External sources and FleetZero are always considered "filtered" since they're not real nodes
      const fromNodeIsFiltered = fromIsExternalSource || fromIsFleetZero ? true : (fromNode ? filteredNodeIds.has(fromNode.id) : false);
      const toNodeIsFiltered = toIsExternalSource || toIsFleetZero ? true : (toNode ? filteredNodeIds.has(toNode.id) : false);

      // Determine visibility based on endpoint types
      let shouldShow = false;

      if (fromIsExternalSource) {
        // External source: show if the 'to' endpoint is in filtered nodes
        shouldShow = toIsFleetZero || (toNode !== null && toNodeIsFiltered);
        if (!shouldShow) {
          console.log(`[Route Filtering] Filtered out ${route.id}: external source but 'to' not in filtered nodes`, {
            from: route.from,
            to: route.to,
            toNode: toNode?.id,
            toNodeIsFiltered,
            toNodeExists: toNode !== null
          });
        }
      } else if (toIsExternalSource) {
        // External destination: show if the 'from' endpoint is in filtered nodes
        shouldShow = fromIsFleetZero || (fromNode !== null && fromNodeIsFiltered);
        if (!shouldShow) {
          console.log(`[Route Filtering] Filtered out ${route.id}: external destination but 'from' not in filtered nodes`, {
            from: route.from,
            to: route.to,
            fromNode: fromNode?.id,
            fromNodeIsFiltered,
            fromNodeExists: fromNode !== null
          });
        }
      } else if (fromIsFleetZero || toIsFleetZero) {
        // FleetZero connection: show if the other endpoint is in filtered nodes
        shouldShow = fromIsFleetZero ? (toNode !== null && toNodeIsFiltered) : (fromNode !== null && fromNodeIsFiltered);
        if (!shouldShow) {
          console.log(`[Route Filtering] Filtered out ${route.id}: FleetZero connection but other endpoint not in filtered nodes`, {
            from: route.from,
            to: route.to,
            fromNode: fromNode?.id,
            toNode: toNode?.id,
            fromNodeIsFiltered,
            toNodeIsFiltered,
            fromNodeExists: fromNode !== null,
            toNodeExists: toNode !== null
          });
        }
      } else {
        // Node-to-node: both endpoints must be in filtered nodes
        shouldShow = fromNode !== null && toNode !== null && fromNodeIsFiltered && toNodeIsFiltered;
        if (!shouldShow) {
          console.log(`[Route Filtering] Filtered out ${route.id}: node-to-node but not both in filtered nodes`, {
            from: route.from,
            to: route.to,
            fromNode: fromNode?.id,
            toNode: toNode?.id,
            fromNodeIsFiltered,
            toNodeIsFiltered,
            fromNodeExists: fromNode !== null,
            toNodeExists: toNode !== null
          });
        }
      }

      if (!shouldShow) {
        return false;
      }

      // Selection filter: if an entity is selected, only show lines connecting to it
      if (selected) {
        const selId = selected.id;
        const selSubId = selected.subsidiaryId;

        let matchesSelection =
          route.from === selId ||
          route.to === selId ||
          (!!selSubId && (route.from === selSubId || route.to === selSubId)) ||
          (fromNode?.id === selId || toNode?.id === selId) ||
          (fromNode?.companyId === selId || toNode?.companyId === selId);

        // Check if external source connects to selected node
        if (!matchesSelection && (fromIsExternalSource || toIsExternalSource)) {
          matchesSelection = route.from.includes(selId) || route.to.includes(selId);
        }

        // If a parent group is selected, show routes for all its subsidiaries
        if (!matchesSelection && selected.level === 'parent') {
          const group = this.parentGroups().find((g) => g.id === selId);
          if (group) {
            const subIds = new Set(group.subsidiaries.map((s) => s.id));

            matchesSelection =
              subIds.has(route.from) ||
              subIds.has(route.to) ||
              (!!fromNode?.subsidiaryId && subIds.has(fromNode.subsidiaryId)) ||
              (!!toNode?.subsidiaryId && subIds.has(toNode.subsidiaryId));
          }
        }

        // Show the line if it matches the selection OR if it involves a FleetZero/External endpoint that connects to selection
        const isSystemConnectionToSelected =
          (fromIsFleetZero || fromIsExternalSource) ? (toNode?.id === selId || toNode?.companyId === selId || toNode?.subsidiaryId === selId || route.to === selId) :
            (toIsFleetZero || toIsExternalSource) ? (fromNode?.id === selId || fromNode?.companyId === selId || fromNode?.subsidiaryId === selId || route.from === selId) :
              false;

        if (!matchesSelection && !isSystemConnectionToSelected) {
          console.log(`[Route Filtering] Filtered out ${route.id}: doesn't match selection`, {
            from: route.from,
            to: route.to,
            selectedId: selId,
            isSystemConnectionToSelected
          });
          return false;
        }
      }

      console.log(`[Route Filtering] Keeping route ${route.id}`, {
        from: route.from,
        to: route.to,
        fromNode: fromNode?.id,
        toNode: toNode?.id,
        fromInFiltered: fromNodeIsFiltered,
        toInFiltered: toNodeIsFiltered,
        fromIsExternal: fromIsExternalSource,
        toIsExternal: toIsExternalSource,
        fromIsFleetZero,
        toIsFleetZero
      });
      return true;
    });

    console.log('[Route Filtering] Completed:', {
      totalRoutes: routes.length,
      filteredRoutes: filtered.length,
      filtered: filtered.map(r => ({ id: r.id, from: r.from, to: r.to }))
    });

    return filtered;
  });

  // ViewChild reference to map component
  readonly mapComponent = viewChild.required(WarRoomMapComponent);

  readonly addCompanyModalRef = viewChild<AddCompanyModalComponent>('addCompanyModalRef');

  // Timeout for zoom effect
  private zoomTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private skipInitialAutoZoom = true;

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
  }

  ngOnInit(): void {
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

    // Show activity log when clicking activity log
    this.activityLogVisible.set(true);

    // Zoom is handled by the effect() when the selected entity changes
    // This prevents double-zooming and race conditions
    if (isSameSelection) {
      this.mapComponent().zoomToEntity(selection.id);
    }
  }

  /**
   * Toggle activity log visibility
   */
  toggleActivityLog(): void {
    this.activityLogVisible.update(visible => !visible);
  }

  /**
   * Toggle hub status visibility
   */
  toggleHubStatus(): void {
    this.hubStatusVisible.update(visible => !visible);
  }

  /**
   * Toggle filters panel visibility
   */
  toggleFiltersPanel(): void {
    const wasOpen = this.filtersPanelVisible();
    if (!wasOpen) {
      this.filterDraft.set({
        parentCompanyIds: [...this.filterApplied().parentCompanyIds],
        status: this.filterApplied().status,
        regions: [...this.filterApplied().regions],
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
      return { ...filters, parentCompanyIds: Array.from(nextIds) };
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
      return { ...filters, regions: Array.from(nextRegions) };
    });
  }

  setStatusFilter(status: FilterStatus): void {
    this.filterDraft.update((filters) => ({ ...filters, status }));
  }

  applyFilters(): void {
    this.filterApplied.set({
      parentCompanyIds: [...this.filterDraft().parentCompanyIds],
      status: this.filterDraft().status,
      regions: [...this.filterDraft().regions],
    });
    this.filtersPanelVisible.set(false);
  }

  resetFilters(): void {
    this.filterDraft.set(createDefaultFilters());
    this.filterApplied.set(createDefaultFilters());
  }

  /**
   * Switch map view mode (parent / subsidiary / factory)
   */
  setMapViewMode(mode: MapViewMode): void {
    this.warRoomService.setFactoryFilterSubsidiaryId(null);
    this.warRoomService.setMapViewMode(mode);
  }

  /**
   * Handle node selection from map
   */
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
    } else {
      this.warRoomService.selectEntity(null);
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

  private matchesStatus(status: NodeStatus | undefined, filter: FilterStatus): boolean {
    if (filter === 'all') return true;
    if (!status) return false;
    const isActive = status !== 'OFFLINE';
    return filter === 'active' ? isActive : !isActive;
  }

  private matchesOperationalStatus(status: string, filter: FilterStatus): boolean {
    if (filter === 'all') return true;
    if (filter === 'active') return status === 'ACTIVE';
    return status !== 'ACTIVE';
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
    if (node.level === 'subsidiary') {
      return !!node.subsidiaryId && selectedCompanyIds.includes(node.subsidiaryId);
    }
    if (node.level === 'factory') {
      return !!node.subsidiaryId && selectedCompanyIds.includes(node.subsidiaryId);
    }
    if (node.level === 'parent') {
      const parentId = node.parentGroupId || node.companyId;
      if (!parentId) return false;
      const group = this.parentGroups().find((item) => item.id === parentId);
      return group ? group.subsidiaries.some((sub) => selectedCompanyIds.includes(sub.id)) : false;
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
    if (node.level === 'factory' && node.factoryId) {
      const factory = this.factories().find((item) => item.id === node.factoryId);
      return factory ? this.getRegionsForFactories([factory]) : new Set();
    }

    if (node.level === 'subsidiary' && node.subsidiaryId) {
      const subsidiary = this.subsidiaries().find((item) => item.id === node.subsidiaryId);
      return subsidiary ? this.getRegionsForFactories(subsidiary.factories) : new Set();
    }

    if (node.level === 'parent') {
      const parentGroupId = node.parentGroupId || node.companyId;
      const group = this.parentGroups().find((item) => item.id === parentGroupId);
      return group ? this.getRegionsForFactories(group.subsidiaries.flatMap((sub) => sub.factories)) : new Set();
    }

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
    const normalized = value.toLowerCase();

    const northAmerica = [
      'canada',
      'united states',
      'usa',
      'u.s.',
      'us',
      'mexico',
    ];
    if (northAmerica.some((token) => normalized.includes(token))) {
      return 'North America';
    }

    const europe = [
      'france',
      'turkey',
      'germany',
      'italy',
      'spain',
      'sweden',
      'norway',
      'finland',
      'united kingdom',
      'uk',
      'england',
      'scotland',
      'wales',
      'ireland',
      'netherlands',
      'belgium',
      'poland',
      'czech',
      'austria',
      'switzerland',
      'romania',
      'greece',
      'portugal',
    ];
    if (europe.some((token) => normalized.includes(token))) {
      return 'Europe';
    }

    const asiaPacific = [
      'china',
      'japan',
      'korea',
      'south korea',
      'north korea',
      'india',
      'singapore',
      'malaysia',
      'indonesia',
      'philippines',
      'vietnam',
      'thailand',
      'australia',
      'new zealand',
      'taiwan',
      'hong kong',
    ];
    if (asiaPacific.some((token) => normalized.includes(token))) {
      return 'Asia Pacific';
    }

    const latam = [
      'brazil',
      'argentina',
      'chile',
      'colombia',
      'peru',
      'ecuador',
      'venezuela',
      'uruguay',
      'paraguay',
      'bolivia',
      'guatemala',
      'honduras',
      'el salvador',
      'nicaragua',
      'costa rica',
      'panama',
      'dominican',
      'puerto rico',
    ];
    if (latam.some((token) => normalized.includes(token))) {
      return 'LATAM';
    }

    return null;
  }

  private parseLocationParts(locationInput: string): { city: string; country?: string } {
    if (!locationInput) {
      return { city: '' };
    }
    const parts = locationInput
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const city = parts[0] || locationInput.trim();
    const country = parts.length > 1 ? parts.slice(1).join(', ') : undefined;
    return { city, country };
  }

  onAddCompanyRequested(): void {
    this.addCompanyModalVisible.set(true);
    this.hubStatusVisible.set(true);
  }

  onAddCompanyModalClose(): void {
    this.addCompanyModalVisible.set(false);
  }

  async onCompanyAdded(formData: CompanyFormData): Promise<void> {
    if (!formData.companyName?.trim() || !formData.location?.trim()) {
      console.warn('Company name and location are required.');
      return;
    }

    type SubLocationInput = NonNullable<CompanyFormData['subLocations']>[number];
    const mapSubLocationStatusToNode = (status?: SubLocationInput['status']): NodeStatus => {
      if (status === 'MAINTENANCE') return 'OFFLINE';
      if (status === 'PAUSED') return 'ONLINE';
      return 'ACTIVE';
    };
    const mapSubLocationStatusToLog = (status?: SubLocationInput['status']): ActivityStatus => {
      if (status === 'MAINTENANCE') return 'WARNING';
      if (status === 'PAUSED') return 'INFO';
      return 'ACTIVE';
    };
    const parseLocationParts = (locationInput: string): { city: string; country?: string; fullLocation: string } => {
      const parts = locationInput
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      const city = parts[0] || locationInput.trim();
      const country = parts.length > 1 ? parts.slice(1).join(', ') : undefined;
      return { city: city || 'Unknown', country, fullLocation: locationInput.trim() };
    };
    const isCoordinateInput = (value: string): boolean => {
      return /^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(value.trim());
    };
    const clampCoordinate = (value: number, min: number, max: number): number => {
      return Math.min(max, Math.max(min, value));
    };
    const buildFallbackCoordinates = (
      seed: string,
      base: { latitude: number; longitude: number } | null,
      index: number
    ): { latitude: number; longitude: number } => {
      const offsets = [
        { lat: 0.35, lng: 0.2 },
        { lat: -0.28, lng: 0.24 },
        { lat: 0.22, lng: -0.3 },
        { lat: -0.2, lng: -0.22 },
        { lat: 0.4, lng: -0.05 },
      ];
      if (base) {
        const step = offsets[index % offsets.length];
        const scale = 1 + Math.floor(index / offsets.length) * 0.35;
        const latitude = clampCoordinate(base.latitude + step.lat * scale, -85, 85);
        const longitude = clampCoordinate(base.longitude + step.lng * scale, -180, 180);
        return { latitude, longitude };
      }
      const hash = seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
      const latitude = clampCoordinate(((hash * 37) % 140) - 70, -85, 85);
      const longitude = clampCoordinate(((hash * 91) % 320) - 160, -180, 180);
      return { latitude, longitude };
    };

    let locationData: { latitude: number; longitude: number } | null = null;
    const mainLocationIsCoords = isCoordinateInput(formData.location);
    try {
      locationData = await this.warRoomService.parseLocationInput(formData.location);
    } catch (error) {
      console.warn('Failed to parse primary location. Using placeholder coordinates.', error);
      locationData = { latitude: 0, longitude: 0 };
    }
    if (!locationData || !Number.isFinite(locationData.latitude) || !Number.isFinite(locationData.longitude)) {
      console.warn('Primary location coordinates invalid. Using placeholder coordinates.');
      locationData = { latitude: 0, longitude: 0 };
    }
    if (locationData.latitude === 0 && locationData.longitude === 0 && !mainLocationIsCoords) {
      locationData = buildFallbackCoordinates(formData.location, null, 0);
    }
    const parentGroupId =
      this.selectedEntity()?.parentGroupId ||
      (this.selectedEntity()?.level === 'parent' ? this.selectedEntity()?.id : null) ||
      this.parentGroups()[0]?.id ||
      'global-group';

    const companyName = formData.companyName.trim();
    const subsidiaryId = this.warRoomService.generateSubsidiaryId(companyName);
    const factoryId = this.warRoomService.generateFactoryId(`${companyName}-${formData.location}`);

    const { city, country, fullLocation } = parseLocationParts(formData.location);
    const hubCode = this.generateHubCode(companyName);
    const logoValue = typeof formData.logo === 'string' ? formData.logo : undefined;

    // Parse source company location if provided
    let sourceLocationData: { latitude: number; longitude: number } | null = null;
    if (formData.sourceLocation?.trim()) {
      try {
        sourceLocationData = await this.warRoomService.parseLocationInput(formData.sourceLocation);
      } catch (error) {
        console.warn('Failed to parse source location. Using placeholder coordinates.', error);
        sourceLocationData = { latitude: 0, longitude: 0 };
      }
      if (!sourceLocationData || !Number.isFinite(sourceLocationData.latitude) || !Number.isFinite(sourceLocationData.longitude)) {
        console.warn('Source location coordinates invalid. Using placeholder coordinates.');
        sourceLocationData = { latitude: 0, longitude: 0 };
      }
    }

    // Create transit route from source company to target company
    const canCreateSourceRoute =
      sourceLocationData &&
      Number.isFinite(sourceLocationData.latitude) &&
      Number.isFinite(sourceLocationData.longitude) &&
      Number.isFinite(locationData.latitude) &&
      Number.isFinite(locationData.longitude);

    if (canCreateSourceRoute) {
      const sourceCompanyName = formData.sourceCompanyName?.trim() || 'Your Company';
      const transitRoute: TransitRoute = {
        id: `route-src-${factoryId}-${Date.now()}`,
        from: `source-${factoryId}`, // Use consistent identifier for external source
        to: factoryId,
        fromCoordinates: {
          latitude: sourceLocationData!.latitude,
          longitude: sourceLocationData!.longitude,
        },
        toCoordinates: {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
        },
        animated: true,
        strokeColor: '#6ee755',
        strokeWidth: 2,
      };

      this.warRoomService.addTransitRoute(transitRoute);
    }

    // Always create an automatic connection to FleetZero HQ
    if (Number.isFinite(locationData.latitude) && Number.isFinite(locationData.longitude)) {
      const fleetZeroRoute: TransitRoute = {
        id: `route-fleetzero-${factoryId}-${Date.now()}`,
        from: factoryId,
        to: 'fleetzero', // Targets the fleetzero hub
        fromCoordinates: {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
        },
        toCoordinates: {
          latitude: 43.6532, // Toronto HQ Latitude
          longitude: -79.3832, // Toronto HQ Longitude
        },
        animated: true,
        strokeColor: '#0ea5e9', // Blue connection for global sync
        strokeWidth: 1.5,
      };
      this.warRoomService.addTransitRoute(fleetZeroRoute);
    }

    const newFactory: FactoryLocation = {
      id: factoryId,
      parentGroupId,
      subsidiaryId,
      name: `${companyName} - ${city}`,
      city: city || 'Unknown',
      country,
      coordinates: { latitude: locationData.latitude, longitude: locationData.longitude },
      status: 'ONLINE',
      syncStability: 98,
      assets: 0,
      incidents: 0,
      description: formData.description?.trim() || undefined,
      logo: logoValue,
    };

    const subLocationEntries: SubLocationInput[] = (formData.subLocations ?? [])
      .map((location) => ({
        name: location.name?.trim() || '',
        location: location.location?.trim() || '',
        status: location.status,
      }))
      .filter((location) => location.name.length > 0 && location.location.length > 0);

    const additionalFactories: FactoryLocation[] = [];
    const additionalLogs: ActivityLog[] = [];

    for (const [index, subLocation] of subLocationEntries.entries()) {
      let subLocationCoords: { latitude: number; longitude: number } = { latitude: 0, longitude: 0 };
      const subLocationIsCoords = isCoordinateInput(subLocation.location);
      try {
        subLocationCoords = await this.warRoomService.parseLocationInput(subLocation.location);
      } catch (error) {
        console.warn(`Failed to parse sub-location "${subLocation.location}". Using placeholder coordinates.`, error);
      }
      if (subLocationCoords.latitude === 0 && subLocationCoords.longitude === 0 && !subLocationIsCoords) {
        subLocationCoords = buildFallbackCoordinates(
          subLocation.location,
          locationData ? { latitude: locationData.latitude, longitude: locationData.longitude } : null,
          index
        );
      }

      const { city: subCity, country: subCountry, fullLocation: subFullLocation } = parseLocationParts(subLocation.location);
      const subFactoryId = this.warRoomService.generateFactoryId(
        `${companyName}-${subLocation.name}-${subLocation.location}`
      );
      const factoryName = subLocation.name || `${companyName} - ${subCity}`;
      const factoryStatus = mapSubLocationStatusToNode(subLocation.status);

      const subFactory: FactoryLocation = {
        id: subFactoryId,
        parentGroupId,
        subsidiaryId,
        name: factoryName,
        city: subCity || 'Unknown',
        country: subCountry,
        coordinates: subLocationCoords,
        status: factoryStatus,
        syncStability: factoryStatus === 'OFFLINE' ? 72 : factoryStatus === 'ONLINE' ? 88 : 96,
        assets: 0,
        incidents: 0,
        description: formData.description?.trim() || undefined,
        logo: logoValue,
      };

      additionalFactories.push(subFactory);

      const logStatus = mapSubLocationStatusToLog(subLocation.status);
      const logTitle = `${companyName.toUpperCase()} | ${factoryName.toUpperCase()}`;
      const logDescription =
        logStatus === 'WARNING'
          ? 'SUB-LOCATION MAINTENANCE // CREW DISPATCHED'
          : logStatus === 'INFO'
            ? 'SUB-LOCATION PAUSED // STANDBY MODE'
            : 'SUB-LOCATION ONLINE // SYNC CONFIRMED';

      additionalLogs.push({
        id: `log-${subFactoryId}`,
        timestamp: new Date(),
        status: logStatus,
        title: logTitle,
        description: logDescription,
        parentGroupId,
        subsidiaryId,
        factoryId: subFactoryId,
        location: subFullLocation,
        logo: logoValue,
      });
    }

    const newSubsidiary: SubsidiaryCompany = {
      id: subsidiaryId,
      parentGroupId,
      name: companyName.toUpperCase(),
      status: 'ACTIVE',
      metrics: { assetCount: 0, incidentCount: 0, syncStability: 98 },
      factories: [newFactory, ...additionalFactories],
      hubs: [
        {
          id: `hub-${subsidiaryId}-${Date.now()}`,
          code: hubCode,
          companyId: subsidiaryId,
          companyName: companyName.toUpperCase(),
          status: 'ONLINE',
          capacity: '100% CAP',
          capacityPercentage: 100,
          statusColor: 'text-tactical-green',
          capColor: 'text-tactical-green',
        },
      ],
      quantumChart: { dataPoints: [85, 88, 90, 92, 89, 91], highlightedIndex: 3 },
      logo: logoValue,
      description: formData.description?.trim() || undefined,
      location: fullLocation || undefined,
    };

    this.warRoomService.addSubsidiary(newSubsidiary);

    const activityLog: ActivityLog = {
      id: `log-${factoryId}`,
      timestamp: new Date(),
      status: 'ACTIVE',
      title: `${companyName.toUpperCase()} | ${city.toUpperCase()}`,
      description: formData.description?.trim() || 'SYSTEM REGISTERED // FACTORY INITIALIZED',
      parentGroupId,
      subsidiaryId,
      factoryId,
      location: fullLocation,
      logo: logoValue,
    };

    this.warRoomService.addActivityLog(activityLog);
    additionalLogs.forEach((log) => this.warRoomService.addActivityLog(log));
    // Ensure filters don't hide the newly added locations.
    this.filterDraft.set(createDefaultFilters());
    this.filterApplied.set(createDefaultFilters());
    this.warRoomService.setFactoryFilterSubsidiaryId(null);
    this.warRoomService.setMapViewMode('factory');
    this.warRoomService.selectEntity({ level: 'factory', id: factoryId, parentGroupId, subsidiaryId, factoryId });
    this.activityLogVisible.set(true);
    this.addCompanyModalRef()?.closeAfterSuccess();
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
}
