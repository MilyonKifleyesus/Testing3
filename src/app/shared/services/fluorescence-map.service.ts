import { Injectable, signal, computed, isDevMode } from '@angular/core';
import { Observable, of, delay, throwError } from 'rxjs';
import {
  Node,
  Hub,
  ActivityLog,
  NetworkMetrics,
  NetworkThroughput,
  GeopoliticalHeatmap,
  SatelliteStatus,
  ParentGroup,
  SubsidiaryCompany,
  FactoryLocation,
  FleetSelection,
  MapViewMode,
  TransitRoute,
  WarRoomState,
} from '../models/fluorescence-map.interface';

@Injectable({
  providedIn: 'root',
})
export class WarRoomService {
  private readonly legacyLogoAliases: Record<string, string> = {
    '/assets/images/NFI_Logo.png': '/assets/images/New-Flyer.jpg',
    '/assets/images/TEMSA_Logo_Black.svg': '/assets/images/tam-logo.png',
    '/assets/images/MCI_Logo.png': '/assets/images/svgs/user.svg',
    '/assets/images/Prevost_Logo.png': '/assets/images/svgs/user.svg',
    '/assets/images/FleetZero.png': '/assets/images/svgs/user.svg',
  };
  private readonly invalidLogoTokens = new Set(['string', 'null', 'undefined', '[object object]']);

  // Signal-based state management 
  private _parentGroups = signal<ParentGroup[]>([]);
  private _transitRoutes = signal<TransitRoute[]>([]);
  private _activityLogs = signal<ActivityLog[]>([]);
  private _networkMetrics = signal<NetworkMetrics | null>(null);
  private _networkThroughput = signal<NetworkThroughput | null>(null);
  private _geopoliticalHeatmap = signal<GeopoliticalHeatmap | null>(null);
  private _satelliteStatuses = signal<SatelliteStatus[]>([]);
  private _mapViewMode = signal<MapViewMode>('project');
  private _selectedEntity = signal<FleetSelection | null>(null);
  private _hoveredEntity = signal<FleetSelection | null>(null);
  private _factoryFilterSubsidiaryId = signal<string | null>(null);
  private _manufacturerFilterSubsidiaryId = signal<string | null>(null);
  private _panToEntity = signal<{ id: string; timestamp: number } | null>(null);
  private _initialized = signal(false);
  private _apiHierarchyLoaded = false;

  // Public readonly signals
  readonly parentGroups = this._parentGroups.asReadonly();
  readonly transitRoutes = this._transitRoutes.asReadonly();
  readonly activityLogs = this._activityLogs.asReadonly();
  readonly networkMetrics = this._networkMetrics.asReadonly();
  readonly networkThroughput = this._networkThroughput.asReadonly();
  readonly geopoliticalHeatmap = this._geopoliticalHeatmap.asReadonly();
  readonly satelliteStatuses = this._satelliteStatuses.asReadonly();
  readonly mapViewMode = this._mapViewMode.asReadonly();
  readonly selectedEntity = this._selectedEntity.asReadonly();
  readonly hoveredEntity = this._hoveredEntity.asReadonly();
  readonly panToEntity = this._panToEntity.asReadonly();
  readonly initialized = this._initialized.asReadonly();

  // Computed signals
  readonly subsidiaries = computed(() =>
    this._parentGroups().flatMap((group) => group.subsidiaries)
  );

  readonly factories = computed(() =>
    this.subsidiaries().flatMap((subsidiary) => subsidiary.manufacturerLocations ?? subsidiary.factories ?? [])
  );
  readonly manufacturerLocations = this.factories;

  readonly nodes = computed(() => {
    const viewMode = this._mapViewMode();
    const selection = this._selectedEntity();
    const factoryFilterSubsidiaryId =
      this._manufacturerFilterSubsidiaryId() ?? this._factoryFilterSubsidiaryId();
    return this.buildMapNodes(viewMode, selection, factoryFilterSubsidiaryId);
  });

  readonly selectedParentGroup = computed(() => {
    const selection = this._selectedEntity();
    if (!selection) return null;
    const parentId = selection.level === 'parent' ? selection.id : selection.parentGroupId;
    if (!parentId) return null;
    return this._parentGroups().find((group) => group.id === parentId) || null;
  });

  readonly selectedSubsidiary = computed(() => {
    const selection = this._selectedEntity();
    if (!selection) return null;
    if (selection.level === 'subsidiary') {
      return this.subsidiaries().find((sub) => sub.id === selection.id) || null;
    }
    if ((selection.level === 'factory' || selection.level === 'manufacturer') && selection.subsidiaryId) {
      return this.subsidiaries().find((sub) => sub.id === selection.subsidiaryId) || null;
    }
    return null;
  });

  constructor() {
    this._initialized.set(false);
    void this.initializeData();
  }

  /**
   * Replaces parent groups with API-built hierarchy.
   * Call this when API data is loaded to show manufacturers/sites from backend.
   * Once set, JSON-loaded parent groups will not overwrite (API takes precedence).
   */
  setParentGroupsFromApi(groups: ParentGroup[]): void {
    this._apiHierarchyLoaded = true;
    const normalized = this.normalizeParentGroups(groups);
    this._parentGroups.set(normalized);
    if (normalized.length > 0 && !this._selectedEntity()) {
      this._selectedEntity.set({
        level: 'parent',
        id: normalized[0].id,
        parentGroupId: normalized[0].id,
      });
    }
  }

  private logDebug(message: string, ...args: unknown[]): void {
    if (isDevMode()) {
      console.log(message, ...args);
    }
  }

  private logWarn(message: string, ...args: unknown[]): void {
    if (isDevMode()) {
      console.warn(message, ...args);
    }
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs: number = 5000
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private normalizeLogoPath(logo?: string | ArrayBuffer): string | ArrayBuffer | undefined {
    if (typeof logo !== 'string') return logo;
    const trimmed = logo.trim();
    if (trimmed === '') return undefined;
    if (this.invalidLogoTokens.has(trimmed.toLowerCase())) return undefined;

    const withLeadingSlash = trimmed.startsWith('assets/images/') ? `/${trimmed}` : trimmed;
    const asAssetPath = withLeadingSlash.includes('/') ? withLeadingSlash : `/assets/images/${withLeadingSlash}`;
    return (
      this.legacyLogoAliases[trimmed] ??
      this.legacyLogoAliases[withLeadingSlash] ??
      this.legacyLogoAliases[asAssetPath] ??
      asAssetPath
    );
  }

  private normalizeParentGroups(parentGroups: ParentGroup[]): ParentGroup[] {
    return parentGroups.map((group) => ({
      ...group,
      logo: this.normalizeLogoPath(group.logo),
      subsidiaries: (group.subsidiaries ?? []).map((subsidiary) => ({
        ...subsidiary,
        logo: this.normalizeLogoPath(subsidiary.logo),
        manufacturerLocations: (subsidiary.manufacturerLocations ?? subsidiary.factories ?? []).map((factory) => ({
          ...factory,
          logo: this.normalizeLogoPath(factory.logo),
        })),
        factories: (subsidiary.manufacturerLocations ?? subsidiary.factories ?? []).map((factory) => ({
          ...factory,
          logo: this.normalizeLogoPath(factory.logo),
        })),
      })),
    }));
  }

  /**
   * Initializes War Room state with an API-first empty baseline.
   * Runtime hierarchy/routes/logs are hydrated by API-backed services after component bootstrap.
   */
  private async initializeData(): Promise<void> {
    this.applyState(this.getEmptyState());
  }

  private applyState(data: WarRoomState): void {
    const normalizedParentGroups = this.normalizeParentGroups(data.parentGroups || []);
    this._transitRoutes.set(data.transitRoutes || []);
    this._activityLogs.set(data.activityLogs || []);
    this._networkMetrics.set(data.networkMetrics || this.getEmptyState().networkMetrics);
    this._networkThroughput.set(data.networkThroughput || this.getEmptyState().networkThroughput);
    this._geopoliticalHeatmap.set(data.geopoliticalHeatmap || this.getEmptyState().geopoliticalHeatmap);
    this._satelliteStatuses.set(data.satelliteStatuses || []);
    if (!this._apiHierarchyLoaded) {
      this._parentGroups.set(normalizedParentGroups);
    }
    this._mapViewMode.set(data.mapViewMode || 'project');

    if (data.selectedEntity) {
      this._selectedEntity.set(this.normalizeSelection(data.selectedEntity));
    } else if (data.selectedCompanyId) {
      const legacySubsidiary = this.subsidiaries().find((sub) => sub.id === data.selectedCompanyId);
      if (legacySubsidiary) {
        const fallbackFactory = legacySubsidiary.factories?.[0];
        const fallbackLocationId = fallbackFactory?.id;
        this._selectedEntity.set({
          level: 'manufacturer',
          id: fallbackLocationId ?? legacySubsidiary.id,
          parentGroupId: legacySubsidiary.parentGroupId,
          subsidiaryId: legacySubsidiary.id,
          manufacturerLocationId: fallbackLocationId ?? undefined,
          factoryId: fallbackLocationId ?? undefined,
        });
        this._mapViewMode.set('manufacturer');
        this._initialized.set(true);
        return;
      }
    } else if (normalizedParentGroups.length) {
      this._selectedEntity.set({
        level: 'parent',
        id: normalizedParentGroups[0].id,
        parentGroupId: normalizedParentGroups[0].id,
      });
    }
    this._initialized.set(true);
  }

  private getEmptyState(): WarRoomState {
    return {
      nodes: [],
      transitRoutes: [],
      activityLogs: [],
      networkMetrics: {
        dataFlowIntegrity: 0,
        fleetSyncRate: 0,
        networkLatency: 0,
        nodeDensity: 0,
        encryptionProtocol: '',
        encryptionStatus: '',
      },
      networkThroughput: {
        bars: [],
        channelStatus: '',
        throughput: '',
      },
      geopoliticalHeatmap: {
        grid: [],
        rows: 0,
        cols: 0,
      },
      satelliteStatuses: [],
      parentGroups: [],
      mapViewMode: 'project',
      selectedEntity: null,
    };
  }

  private buildMapNodes(
    viewMode: MapViewMode,
    selection: FleetSelection | null,
    factoryFilterSubsidiaryId: string | null
  ): Node[] {
    const parentGroups = this._parentGroups();
    if (viewMode === 'parent') {
      return parentGroups
        .map((group) => this.createParentNode(group))
        .filter((node): node is Node => node !== null);
    }

    if (viewMode === 'client') {
      return [];
    }

    if (viewMode === 'project') {
      let factories = this.factories();
      if (factoryFilterSubsidiaryId) {
        factories = factories.filter((factory) => factory.subsidiaryId === factoryFilterSubsidiaryId);
      }
      return factories.map((factory) => {
        const subsidiary = this.subsidiaries().find((sub) => sub.id === factory.subsidiaryId);
        return this.createFactoryNode(factory, subsidiary);
      });
    }

    let factories = this.factories();
    if (factoryFilterSubsidiaryId) {
      factories = factories.filter((factory) => factory.subsidiaryId === factoryFilterSubsidiaryId);
    }

    return factories.map((factory) => {
      const subsidiary = this.subsidiaries().find((sub) => sub.id === factory.subsidiaryId);
      return this.createFactoryNode(factory, subsidiary);
    });
  }

  private createParentNode(group: ParentGroup): Node | null {
    const factories = group.subsidiaries.flatMap((sub) => sub.manufacturerLocations ?? sub.factories ?? []);
    const coordinates = this.computeCenterOfGravity(factories);
    if (!this.isValidCoordinates(coordinates)) {
      this.logWarn(`[WarRoomService] Skipping parent node "${group.id}" due to invalid coordinates.`);
      return null;
    }

    return {
      id: group.id,
      name: this.slugify(group.name),
      company: group.name,
      companyId: group.id,
      city: 'Global Operations',
      description: group.description || `${group.name} command overview.`,
      logo: group.logo,
      country: '',
      coordinates,
      type: 'Center',
      status: this.mapOperationalStatus(group.status),
      isHub: true,
      hubCode: 'GRP',
      level: 'parent',
      parentGroupId: group.id,
    };
  }

  private createSubsidiaryNode(subsidiary: SubsidiaryCompany): Node | null {
    const coordinates = this.computeCenterOfGravity(subsidiary.factories ?? []);
    if (!this.isValidCoordinates(coordinates)) {
      this.logWarn(`[WarRoomService] Skipping subsidiary node "${subsidiary.id}" due to invalid coordinates.`);
      return null;
    }
    const fallbackCity = (subsidiary.factories ?? [])[0]?.city || subsidiary.name;

    return {
      id: subsidiary.id,
      name: this.slugify(subsidiary.name),
      company: subsidiary.name,
      companyId: subsidiary.id,
      city: subsidiary.location || fallbackCity,
      description: subsidiary.description || `${subsidiary.name} regional operations.`,
      logo: subsidiary.logo,
      country: (subsidiary.factories ?? [])[0]?.country || '',
      coordinates,
      type: 'Hub',
      status: this.mapOperationalStatus(subsidiary.status),
      isHub: true,
      hubCode: subsidiary.hubs[0]?.code,
      level: 'subsidiary',
      parentGroupId: subsidiary.parentGroupId,
      subsidiaryId: subsidiary.id,
    };
  }

  private createFactoryNode(factory: FactoryLocation, subsidiary?: SubsidiaryCompany): Node {
    const companyName = subsidiary?.name || 'Factory';
    const hubCode = subsidiary?.hubs[0]?.code;

    return {
      id: factory.id,
      name: this.slugify(factory.city || factory.name),
      company: companyName,
      companyId: factory.id,
      city: factory.city,
      description: factory.description,
      logo: factory.logo || subsidiary?.logo,
      country: factory.country,
      coordinates: factory.coordinates,
      type: 'Facility',
      status: factory.status,
      isHub: true,
      hubCode,
      level: 'manufacturer',
      parentGroupId: factory.parentGroupId,
      subsidiaryId: factory.subsidiaryId,
      manufacturerLocationId: factory.id,
      factoryId: factory.id,
      fullAddress: factory.fullAddress,
      facilityType: factory.facilityType,
      notes: factory.notes,
    };
  }

  private isValidCoordinates(coords?: { latitude: number; longitude: number } | null): boolean {
    if (!coords) return false;
    if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return false;
    if (coords.latitude === 0 && coords.longitude === 0) return false;
    return true;
  }

  private computeCenterOfGravity(factories: FactoryLocation[]): { latitude: number; longitude: number } | null {
    const validFactories = factories.filter((factory) => this.isValidCoordinates(factory.coordinates));
    if (validFactories.length === 0) {
      return null;
    }

    const getFactoryWeight = (factory: FactoryLocation): number =>
      (factory.assets == null ? 1 : factory.assets);
    const totalWeight = validFactories.reduce((sum, factory) => sum + getFactoryWeight(factory), 0);
    if (totalWeight === 0) {
      return null;
    }
    const weightedLat = validFactories.reduce(
      (sum, factory) => sum + factory.coordinates.latitude * getFactoryWeight(factory),
      0
    );
    const weightedLng = validFactories.reduce(
      (sum, factory) => sum + factory.coordinates.longitude * getFactoryWeight(factory),
      0
    );

    return {
      latitude: weightedLat / totalWeight,
      longitude: weightedLng / totalWeight,
    };
  }

  private mapOperationalStatus(status: string): Node['status'] {
    const s = String(status).toUpperCase().trim();
    return s === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private normalizeSelection(selection: FleetSelection): FleetSelection | null {
    if (selection.level === 'parent') {
      const parent = this._parentGroups().find((group) => group.id === selection.id);
      if (!parent) return null;
      return { level: 'parent', id: parent.id, parentGroupId: parent.id };
    }

    if (selection.level === 'subsidiary') {
      const subsidiary = this.subsidiaries().find((sub) => sub.id === selection.id);
      if (!subsidiary) return null;
      const fallbackFactory = subsidiary.factories?.[0];
      return {
        level: 'manufacturer',
        id: fallbackFactory?.id ?? subsidiary.id,
        parentGroupId: subsidiary.parentGroupId,
        subsidiaryId: subsidiary.id,
        manufacturerLocationId: fallbackFactory?.id ?? undefined,
        factoryId: fallbackFactory?.id ?? undefined,
      };
    }

    if (selection.level === 'factory' || selection.level === 'manufacturer') {
      const factory = this.factories().find((fac) => fac.id === selection.id);
      if (!factory) return null;
      return {
        level: 'manufacturer',
        id: factory.id,
        parentGroupId: factory.parentGroupId,
        subsidiaryId: factory.subsidiaryId,
        manufacturerLocationId: factory.id,
        factoryId: factory.id,
      };
    }

    if (selection.level === 'client') {
      return { level: 'client', id: selection.id };
    }

    return null;
  }

  private getFirstFactoryForSelection(selection: FleetSelection): FactoryLocation | null {
    if (selection.level === 'subsidiary') {
      const subsidiary = this.subsidiaries().find((sub) => sub.id === selection.id);
      return subsidiary?.factories?.[0] || null;
    }

    if (selection.level === 'parent') {
      const parentId = selection.parentGroupId || selection.id;
      const parent = this._parentGroups().find((group) => group.id === parentId);
      const subsidiary = parent?.subsidiaries[0];
      return subsidiary?.factories?.[0] || null;
    }

    return null;
  }

  private computeMetricsFromFactories(factories: FactoryLocation[]): { assetCount: number; incidentCount: number; syncStability: number } {
    const assetCount = factories.reduce((sum, factory) => sum + Number(factory.assets ?? 0), 0);
    const incidentCount = factories.reduce((sum, factory) => sum + Number(factory.incidents ?? 0), 0);
    const totalWeight = factories.reduce((sum, factory) => sum + (Number(factory.assets ?? 0) || 1), 0);
    const weightedSync = factories.reduce(
      (sum, factory) => sum + Number(factory.syncStability ?? 0) * (Number(factory.assets ?? 0) || 1),
      0
    );
    const syncStability = totalWeight > 0 ? Math.round((weightedSync / totalWeight) * 10) / 10 : 0;

    return { assetCount, incidentCount, syncStability };
  }

  private computeMetricsFromSubsidiaries(subsidiaries: SubsidiaryCompany[]): { assetCount: number; incidentCount: number; syncStability: number } {
    const assetCount = subsidiaries.reduce((sum, sub) => sum + sub.metrics.assetCount, 0);
    const incidentCount = subsidiaries.reduce((sum, sub) => sum + sub.metrics.incidentCount, 0);
    const totalWeight = subsidiaries.reduce((sum, sub) => sum + (sub.metrics.assetCount || 1), 0);
    const weightedSync = subsidiaries.reduce(
      (sum, sub) => sum + sub.metrics.syncStability * (sub.metrics.assetCount || 1),
      0
    );
    const syncStability = totalWeight > 0 ? Math.round((weightedSync / totalWeight) * 10) / 10 : 0;

    return { assetCount, incidentCount, syncStability };
  }

  /**
   * Get all nodes
   */
  getNodes(): Observable<Node[]> {
    return of(this.nodes()).pipe(delay(100));
  }

  /**
   * Get all transit routes
   */
  getTransitRoutes(): Observable<TransitRoute[]> {
    return of(this._transitRoutes()).pipe(delay(100));
  }

  /**
   * Get all activity logs
   */
  getActivityLogs(): Observable<ActivityLog[]> {
    return of(this._activityLogs()).pipe(delay(100));
  }

  /**
   * Get hub status for a specific company
   */
  getHubStatus(subsidiaryId: string): Hub[] {
    const subsidiary = this.subsidiaries().find((sub) => sub.id === subsidiaryId);
    return subsidiary?.hubs || [];
  }

  /**
   * Get network metrics
   */
  getNetworkMetrics(): Observable<NetworkMetrics> {
    const metrics = this._networkMetrics();
    if (!metrics) {
      return throwError(() => new Error('Network metrics not initialized'));
    }
    return of(metrics).pipe(delay(100));
  }

  /**
   * Get company data including quantum chart
   */
  getSubsidiaryData(subsidiaryId: string): SubsidiaryCompany | null {
    return this.subsidiaries().find((sub) => sub.id === subsidiaryId) || null;
  }

  /**
   * Select a company
   */
  setMapViewMode(viewMode: MapViewMode): void {
    this._mapViewMode.set(viewMode);
    this._factoryFilterSubsidiaryId.set(null);
    this._manufacturerFilterSubsidiaryId.set(null);

    const selection = this._selectedEntity();
    if (!selection || selection.level === viewMode) return;

    if (viewMode === 'parent') {
      const parentId = selection.parentGroupId || selection.id;
      if (parentId) {
        this._selectedEntity.set({ level: 'parent', id: parentId, parentGroupId: parentId });
      }
      return;
    }

    if (viewMode === 'factory' || viewMode === 'manufacturer') {
      const selectedLocationId = selection.manufacturerLocationId ?? selection.factoryId;
      if (selectedLocationId) {
        this._selectedEntity.set({
          level: 'manufacturer',
          id: selectedLocationId,
          parentGroupId: selection.parentGroupId,
          subsidiaryId: selection.subsidiaryId,
          manufacturerLocationId: selectedLocationId,
          factoryId: selectedLocationId,
        });
        return;
      }

      const fallbackFactory = this.getFirstFactoryForSelection(selection);
      if (fallbackFactory) {
        this._selectedEntity.set({
          level: 'manufacturer',
          id: fallbackFactory.id,
          parentGroupId: fallbackFactory.parentGroupId,
          subsidiaryId: fallbackFactory.subsidiaryId,
          manufacturerLocationId: fallbackFactory.id,
          factoryId: fallbackFactory.id,
        });
      }
    }
  }

  /**
   * Select an entity in the hierarchy (parent, subsidiary, or factory)
   */
  selectEntity(selection: FleetSelection | null): void {
    if (!selection) {
      this._selectedEntity.set(null);
      return;
    }

    const normalized = this.normalizeSelection(selection);
    this._selectedEntity.set(normalized);

    if (normalized) {
      const currentViewMode = this._mapViewMode();
      const validViewModes: MapViewMode[] = ['parent', 'manufacturer', 'factory'];
      if (
        validViewModes.includes(normalized.level as MapViewMode) &&
        (normalized.level === 'factory' || normalized.level === 'manufacturer' || normalized.level === 'parent')
      ) {
        this._mapViewMode.set(normalized.level as MapViewMode);
      }
    }
  }

  /**
   * Set hovered entity for cross-component highlighting
   */
  setHoveredEntity(selection: FleetSelection | null): void {
    this._hoveredEntity.set(selection);
  }

  /**
   * Request map to pan/zoom to a specific entity
   */
  requestPanToEntity(entityId: string): void {
    this._panToEntity.set({ id: entityId, timestamp: Date.now() });
  }

  setFactoryFilterSubsidiaryId(subsidiaryId: string | null): void {
    this._factoryFilterSubsidiaryId.set(subsidiaryId);
    this._manufacturerFilterSubsidiaryId.set(subsidiaryId);
  }

  setManufacturerFilterSubsidiaryId(subsidiaryId: string | null): void {
    this._manufacturerFilterSubsidiaryId.set(subsidiaryId);
    this._factoryFilterSubsidiaryId.set(subsidiaryId);
  }

  /**
   * Get selected company
   */
  getSelectedSubsidiary(): SubsidiaryCompany | null {
    return this.selectedSubsidiary();
  }

  /**
   * Add a new activity log entry
   * Keeps only the most recent entry per factory when `manufacturerLocationId` or legacy `factoryId` is present.
   * Logs missing both ids are accumulated (no deduplication).
   * Result is capped to the most recent 40 entries overall.
   */
  addActivityLog(log: ActivityLog): void {
    const currentLogs = this._activityLogs();
    const normalizeId = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    };
    const logLocationId = normalizeId(log.manufacturerLocationId) ?? normalizeId(log.factoryId);

    // Remove any existing entry for this manufacturer location to ensure only one entry per site
    const filteredLogs = logLocationId
      ? currentLogs.filter((l) => (normalizeId(l.manufacturerLocationId) ?? normalizeId(l.factoryId)) !== logLocationId)
      : currentLogs;

    // Add the new log at the beginning (most recent first)
    const updatedLogs = [log, ...filteredLogs];

    // Keep logs sorted by timestamp (most recent first) and cap the list
    const sortedLogs = updatedLogs
      .sort((a, b) => {
        const dateA = typeof a.timestamp === 'string' ? new Date(a.timestamp) : a.timestamp;
        const dateB = typeof b.timestamp === 'string' ? new Date(b.timestamp) : b.timestamp;
        return dateB.getTime() - dateA.getTime();
      })
      .slice(0, 40);

    this._activityLogs.set(sortedLogs);
  }

  /**
   * Add a new transit route (map connection line)
   */
  addTransitRoute(route: TransitRoute): void {
    this._transitRoutes.update((current) => [route, ...current]);
  }

  /**
   * Update factory description and latest log entry
   */
  updateFactoryDescription(factoryId: string, description: string): void {
    this.updateFactoryDetails(factoryId, { description });
  }

  updateManufacturerLocationDescription(manufacturerLocationId: string, description: string): void {
    this.updateFactoryDetails(manufacturerLocationId, { description });
  }

  /**
   * Update subsidiary name, location, and description.
   */
  updateSubsidiaryDetails(
    subsidiaryId: string,
    updates: { name?: string; location?: string; description?: string; status?: SubsidiaryCompany['status'] }
  ): void {
    const groups = this._parentGroups();
    let updated = false;

    const updatedGroups = groups.map((group) => {
      let groupChanged = false;
      const updatedSubsidiaries = group.subsidiaries.map((subsidiary) => {
        if (subsidiary.id !== subsidiaryId) return subsidiary;
        groupChanged = true;
        return {
          ...subsidiary,
          name: updates.name ?? subsidiary.name,
          location: updates.location ?? subsidiary.location,
          description: updates.description ?? subsidiary.description,
          status: updates.status ?? subsidiary.status,
        };
      });

      if (!groupChanged) return group;
      updated = true;
      return {
        ...group,
        subsidiaries: updatedSubsidiaries,
        metrics: this.computeMetricsFromSubsidiaries(updatedSubsidiaries),
      };
    });

    if (updated) {
      this._parentGroups.set(updatedGroups);
    }
  }

  /**
   * Update factory name, location, description, and coordinates.
   */
  updateFactoryDetails(
    factoryId: string,
    updates: {
      name?: string;
      city?: string;
      country?: string;
      description?: string;
      coordinates?: { latitude: number; longitude: number };
      locationLabel?: string;
      status?: FactoryLocation['status'];
    }
  ): void {
    const groups = this._parentGroups();
    let updated = false;

    const updatedGroups = groups.map((group) => {
      let groupChanged = false;
      const updatedSubsidiaries = group.subsidiaries.map((subsidiary) => {
        const factoryIndex = (subsidiary.factories ?? []).findIndex((factory) => factory.id === factoryId);
        if (factoryIndex === -1) return subsidiary;

        const existingFactory = (subsidiary.factories ?? [])[factoryIndex];
        const updatedFactory: FactoryLocation = {
          ...existingFactory,
          name: updates.name ?? existingFactory.name,
          city: updates.city ?? existingFactory.city,
          country: updates.country ?? existingFactory.country,
          description: updates.description ?? existingFactory.description,
          coordinates: updates.coordinates ?? existingFactory.coordinates,
          status: updates.status ?? existingFactory.status,
        };

        const updatedFactories = [...(subsidiary.factories ?? [])];
        updatedFactories[factoryIndex] = updatedFactory;
        groupChanged = true;

        return {
          ...subsidiary,
          manufacturerLocations: updatedFactories,
          factories: updatedFactories,
          metrics: this.computeMetricsFromFactories(updatedFactories),
        };
      });

      if (!groupChanged) return group;
      updated = true;
      return {
        ...group,
        subsidiaries: updatedSubsidiaries,
        metrics: this.computeMetricsFromSubsidiaries(updatedSubsidiaries),
      };
    });

    if (updated) {
      this._parentGroups.set(updatedGroups);
    }

    if (updates.description !== undefined || updates.locationLabel !== undefined) {
      this._activityLogs.update((logs) =>
        logs.map((log) => {
          const logLocationId = (log.manufacturerLocationId || log.factoryId || '').trim();
          if (!logLocationId || logLocationId !== factoryId) return log;
          const nextDescription = updates.description ?? log.description;
          const nextLocation = updates.locationLabel ?? log.location;
          if (nextDescription === log.description && nextLocation === log.location) {
            return log;
          }
          return {
            ...log,
            manufacturerLocationId: log.manufacturerLocationId ?? log.factoryId ?? factoryId,
            description: nextDescription,
            location: nextLocation,
          };
        })
      );
    }
  }

  updateManufacturerLocationDetails(
    manufacturerLocationId: string,
    updates: {
      name?: string;
      city?: string;
      country?: string;
      description?: string;
      coordinates?: { latitude: number; longitude: number };
      locationLabel?: string;
      status?: FactoryLocation['status'];
    }
  ): void {
    this.updateFactoryDetails(manufacturerLocationId, updates);
  }

  /**
   * Delete a subsidiary company and related factories/logs
   */
  deleteSubsidiary(subsidiaryId: string): void {
    const groups = this._parentGroups();
    const removedSubsidiary =
      this.subsidiaries().find((subsidiary) => subsidiary.id === subsidiaryId) || null;
    if (!removedSubsidiary) return;
    const parentGroupId = removedSubsidiary.parentGroupId;

    const updatedGroups = groups.map((group) => {
      const remainingSubsidiaries = group.subsidiaries.filter((subsidiary) => subsidiary.id !== subsidiaryId);
      if (remainingSubsidiaries.length === group.subsidiaries.length) return group;
      return {
        ...group,
        subsidiaries: remainingSubsidiaries,
        metrics: this.computeMetricsFromSubsidiaries(remainingSubsidiaries),
      };
    });
    this._parentGroups.set(updatedGroups);

    const removedFactoryIds = (removedSubsidiary.manufacturerLocations ?? removedSubsidiary.factories ?? []).map(
      (factory) => factory.id
    );
    this._activityLogs.update((logs) =>
      logs.filter((log) => {
        const logLocationId = (log.manufacturerLocationId || log.factoryId || '').trim();
        return log.subsidiaryId !== subsidiaryId && !removedFactoryIds.includes(logLocationId);
      })
    );

    const selection = this._selectedEntity();
    if (selection && (selection.subsidiaryId === subsidiaryId || selection.id === subsidiaryId)) {
      if (parentGroupId) {
        this._selectedEntity.set({ level: 'parent', id: parentGroupId, parentGroupId });
        this._mapViewMode.set('parent');
      } else {
        this._selectedEntity.set(null);
      }
    }
  }

  /**
   * Delete a factory location and related log entries
   */
  deleteFactory(factoryId: string): void {
    const groups = this._parentGroups();
    let parentGroupId: string | null = null;
    let subsidiaryId: string | null = null;
    let updated = false;

    const updatedGroups = groups.map((group) => {
      let groupChanged = false;
      const updatedSubsidiaries = group.subsidiaries.map((subsidiary) => {
        const factories = subsidiary.factories ?? [];
        const remainingFactories = factories.filter((factory) => factory.id !== factoryId);
        if (remainingFactories.length === factories.length) return subsidiary;
        groupChanged = true;
        parentGroupId = group.id;
        subsidiaryId = subsidiary.id;
        return {
          ...subsidiary,
          factories: remainingFactories,
          metrics: this.computeMetricsFromFactories(remainingFactories),
        };
      });

      if (!groupChanged) return group;
      updated = true;
      return {
        ...group,
        subsidiaries: updatedSubsidiaries,
        metrics: this.computeMetricsFromSubsidiaries(updatedSubsidiaries),
      };
    });

    if (!updated) return;
    this._parentGroups.set(updatedGroups);

    this._activityLogs.update((logs) =>
      logs.filter((log) => (log.manufacturerLocationId ?? log.factoryId) !== factoryId)
    );

    const selection = this._selectedEntity();
    if (selection && ((selection.manufacturerLocationId ?? selection.factoryId) === factoryId || selection.id === factoryId)) {
      if (subsidiaryId) {
        const siblingFactory = this.factories().find((factory) => factory.subsidiaryId === subsidiaryId);
        if (siblingFactory) {
          this._selectedEntity.set({
            level: 'manufacturer',
            id: siblingFactory.id,
            parentGroupId: siblingFactory.parentGroupId,
            subsidiaryId: siblingFactory.subsidiaryId,
            manufacturerLocationId: siblingFactory.id,
            factoryId: siblingFactory.id,
          });
          this._mapViewMode.set('manufacturer');
          return;
        }
      }
      if (parentGroupId) {
        this._selectedEntity.set({ level: 'parent', id: parentGroupId, parentGroupId });
        this._mapViewMode.set('parent');
      } else {
        this._selectedEntity.set(null);
      }
    }
  }

  deleteManufacturerLocation(manufacturerLocationId: string): void {
    this.deleteFactory(manufacturerLocationId);
  }

  /**
   * Update network metrics
   */
  updateNetworkMetrics(metrics: Partial<NetworkMetrics>): void {
    const current = this._networkMetrics();
    if (current) {
      this._networkMetrics.set({ ...current, ...metrics });
    }
  }

  /**
   * Update network throughput
   */
  updateNetworkThroughput(throughput: Partial<NetworkThroughput>): void {
    const current = this._networkThroughput();
    if (current) {
      this._networkThroughput.set({ ...current, ...throughput });
    }
  }

  /**
   * Update hub status for a company
   */
  updateHubStatus(subsidiaryId: string, hubCode: string, updates: Partial<Hub>): void {
    const groups = this._parentGroups();
    const parentIndex = groups.findIndex((group) =>
      group.subsidiaries.some((sub) => sub.id === subsidiaryId)
    );
    if (parentIndex === -1) return;

    const parent = groups[parentIndex];
    const subsidiaryIndex = parent.subsidiaries.findIndex((sub) => sub.id === subsidiaryId);
    if (subsidiaryIndex === -1) return;

    const subsidiary = parent.subsidiaries[subsidiaryIndex];
    const hubIndex = subsidiary.hubs.findIndex((hub) => hub.code === hubCode);
    if (hubIndex === -1) return;

    const updatedHubs = [...subsidiary.hubs];
    updatedHubs[hubIndex] = { ...updatedHubs[hubIndex], ...updates };

    const updatedSubsidiary: SubsidiaryCompany = {
      ...subsidiary,
      hubs: updatedHubs,
    };

    const updatedSubsidiaries = [...parent.subsidiaries];
    updatedSubsidiaries[subsidiaryIndex] = updatedSubsidiary;

    const updatedParent: ParentGroup = {
      ...parent,
      subsidiaries: updatedSubsidiaries,
      metrics: this.computeMetricsFromSubsidiaries(updatedSubsidiaries),
    };

    const updatedGroups = [...groups];
    updatedGroups[parentIndex] = updatedParent;
    this._parentGroups.set(updatedGroups);
  }

  /**
   * Get complete war room state
   */
  getWarRoomState(): WarRoomState {
    const networkMetrics = this._networkMetrics();
    const networkThroughput = this._networkThroughput();
    const geopoliticalHeatmap = this._geopoliticalHeatmap();

    // Provide fallback values if signals are not initialized
    return {
      nodes: this.nodes(),
      transitRoutes: this._transitRoutes(),
      activityLogs: this._activityLogs(),
      networkMetrics: networkMetrics || {
        dataFlowIntegrity: 0,
        fleetSyncRate: 0,
        networkLatency: 0,
        nodeDensity: 0,
        encryptionProtocol: '',
        encryptionStatus: '',
      },
      networkThroughput: networkThroughput || {
        bars: [],
        channelStatus: '',
        throughput: '',
      },
      geopoliticalHeatmap: geopoliticalHeatmap || {
        grid: [],
        rows: 0,
        cols: 0,
      },
      satelliteStatuses: this._satelliteStatuses(),
      parentGroups: this._parentGroups(),
      mapViewMode: this._mapViewMode(),
      selectedEntity: this._selectedEntity(),
    };
  }

  /**
   * Parse location input (coordinates or address)
   * Supports coordinate format: "latitude, longitude" or address search via geocoding API.
   */
  async parseLocationInput(input: string): Promise<{ latitude: number; longitude: number }> {
    const trimmed = input.trim();
    this.logDebug(`[WarRoomService] Parsing location input: "${trimmed}"`);

    // Try to parse as coordinates (format: "lat, lng" or "lat,lng")
    const coordinateMatch = trimmed.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (coordinateMatch) {
      const latitude = parseFloat(coordinateMatch[1]);
      const longitude = parseFloat(coordinateMatch[2]);

      // Validate coordinate ranges
      if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
        this.logDebug(`[WarRoomService] Parsed valid coordinates: ${latitude}, ${longitude}`);
        return { latitude, longitude };
      } else {
        this.logWarn(`[WarRoomService] Invalid coordinates range: ${latitude}, ${longitude}`);
        // Fall through to try geocoding if it looks like coordinate pairs but invalid range? 
        // Or just throw. Usually coordinates allow fallback to text search only if very weird.
        throw new Error('Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180');
      }
    }

    // Geocoding strategy
    // Open-Meteo works best with simple "City, Country" or "City, State". 
    // It sometimes struggles with full addresses or extra descriptions.

    // 1. First attempt: Use the input as is
    try {
      const result = await this.fetchGeocodingResult(trimmed);
      if (result) return result;
    } catch (e) {
      this.logWarn(`[WarRoomService] Geocoding attempt 1 failed:`, e);
    }

    // 2. Second attempt: Simplify input but check context
    if (trimmed.includes(',')) {
      const parts = trimmed.split(',');
      const simpleCity = parts[0].trim();
      const context = parts.slice(1).join(' ').toLowerCase(); // e.g. "quebec" or "quebec canada"

      this.logDebug(
        `[WarRoomService] Retrying with simplified city: "${simpleCity}" and context: "${context}"`
      );

      try {
        // We need to fetch multiple results for the city and filter by context
        // Re-implementing fetch here to allow filtering access to all results
        const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(simpleCity)}&count=10&language=en&format=json`;
        const response = await this.fetchWithTimeout(geocodeUrl, { cache: 'no-store' });

        if (response.ok) {
          const data = (await response.json()) as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string }> };

          if (data.results && data.results.length > 0) {
            // Filter for context matches in admin1 (region) or country
            const matches = data.results.filter(r => {
              const matchString = `${r.admin1 || ''} ${r.country || ''}`.toLowerCase();
              // Check if any part of the context (e.g. "quebec") appears in the result's region/country
              return context.split(' ').some(term => term.trim().length >= 2 && matchString.includes(term.trim()));
            });

            if (matches.length > 0) {
              this.logDebug(`[WarRoomService] Found context match:`, matches[0]);
              return { latitude: matches[0].latitude, longitude: matches[0].longitude };
            }

            this.logWarn(
              `[WarRoomService] Context "${context}" not found in results for "${simpleCity}". Falling back to first result.`
            );
            // If strictly matching context failed, we STILL default to the first result (legacy behavior) 
            // or we could throw error. For now, let's stick to first result but warn.
            return { latitude: data.results[0].latitude, longitude: data.results[0].longitude };
          }
        }
      } catch (e) {
        this.logWarn(`[WarRoomService] Geocoding attempt 2 failed:`, e);
      }
    }

    this.logWarn(`[WarRoomService] Geocoding failed for all attempts for input: "${input}"`);
    throw new Error('No geocoding results found for location.');
  }

  private async fetchGeocodingResult(query: string): Promise<{ latitude: number; longitude: number } | null> {
    const geocodeUrl =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
      `&count=10&language=en&format=json`; // Request more results to filter

    const response = await this.fetchWithTimeout(geocodeUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Geocoding request failed with status ${response.status}`);
    }

    const data = (await response.json()) as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string }> };

    if (!data.results || data.results.length === 0) {
      return null;
    }

    // Prefer matches that look more like a city/place. 
    // Open-Meteo returns 'results' sorted by relevance usually.
    const result = data.results[0];
    return { latitude: result.latitude, longitude: result.longitude };
  }

  /**
   * Add a new subsidiary under an existing parent group
   */
  addSubsidiary(subsidiary: SubsidiaryCompany): void {
    const groups = this._parentGroups();
    const parentIndex = groups.findIndex((group) => group.id === subsidiary.parentGroupId);

    const normalizedSubsidiary: SubsidiaryCompany = {
      ...subsidiary,
      metrics: this.computeMetricsFromFactories(subsidiary.factories ?? []),
    };

    if (parentIndex === -1) {
      this.logWarn(`Parent group ${subsidiary.parentGroupId} not found. Creating new parent group.`);
      const newParent: ParentGroup = {
        id: subsidiary.parentGroupId,
        name: subsidiary.parentGroupId.toUpperCase(),
        status: 'ACTIVE',
        subsidiaries: [normalizedSubsidiary],
        metrics: this.computeMetricsFromSubsidiaries([normalizedSubsidiary]),
      };
      this._parentGroups.set([...groups, newParent]);
      return;
    }

    const parent = groups[parentIndex];
    const existingIndex = parent.subsidiaries.findIndex((sub) => sub.id === subsidiary.id);
    if (existingIndex !== -1) {
      this.logWarn(`Subsidiary ${subsidiary.id} already exists. Updating instead.`);
      this.updateSubsidiary(normalizedSubsidiary);
      return;
    }

    const updatedSubsidiaries = [...parent.subsidiaries, normalizedSubsidiary];
    const updatedParent: ParentGroup = {
      ...parent,
      subsidiaries: updatedSubsidiaries,
      metrics: this.computeMetricsFromSubsidiaries(updatedSubsidiaries),
    };

    const updatedGroups = [...groups];
    updatedGroups[parentIndex] = updatedParent;
    this._parentGroups.set(updatedGroups);
  }

  /**
   * Update an existing subsidiary
   */
  updateSubsidiary(subsidiary: SubsidiaryCompany): void {
    const groups = this._parentGroups();
    const parentIndex = groups.findIndex((group) => group.id === subsidiary.parentGroupId);
    if (parentIndex === -1) {
      this.logWarn(`Parent group ${subsidiary.parentGroupId} not found. Adding subsidiary instead.`);
      this.addSubsidiary(subsidiary);
      return;
    }

    const parent = groups[parentIndex];
    const subIndex = parent.subsidiaries.findIndex((sub) => sub.id === subsidiary.id);
    if (subIndex === -1) {
      this.logWarn(`Subsidiary ${subsidiary.id} not found. Adding instead.`);
      this.addSubsidiary(subsidiary);
      return;
    }

    const updatedSubsidiary: SubsidiaryCompany = {
      ...subsidiary,
      metrics: this.computeMetricsFromFactories(subsidiary.factories ?? []),
    };

    const updatedSubsidiaries = [...parent.subsidiaries];
    updatedSubsidiaries[subIndex] = updatedSubsidiary;

    const updatedParent: ParentGroup = {
      ...parent,
      subsidiaries: updatedSubsidiaries,
      metrics: this.computeMetricsFromSubsidiaries(updatedSubsidiaries),
    };

    const updatedGroups = [...groups];
    updatedGroups[parentIndex] = updatedParent;
    this._parentGroups.set(updatedGroups);
  }

  /**
   * Add a new factory location under a subsidiary
   */
  addFactory(factory: FactoryLocation): void {
    const groups = this._parentGroups();
    const parentIndex = groups.findIndex((group) => group.id === factory.parentGroupId);
    if (parentIndex === -1) {
      this.logWarn(`Parent group ${factory.parentGroupId} not found. Cannot add factory.`);
      return;
    }

    const parent = groups[parentIndex];
    const subIndex = parent.subsidiaries.findIndex((sub) => sub.id === factory.subsidiaryId);
    if (subIndex === -1) {
      this.logWarn(`Subsidiary ${factory.subsidiaryId} not found. Cannot add factory.`);
      return;
    }

    const subsidiary = parent.subsidiaries[subIndex];
    if ((subsidiary.factories ?? []).find((f) => f.id === factory.id)) {
      this.logWarn(`Factory ${factory.id} already exists. Updating instead.`);
      this.updateFactory(factory);
      return;
    }

    const updatedFactories = [...(subsidiary.factories ?? []), factory];
    const updatedSubsidiary: SubsidiaryCompany = {
      ...subsidiary,
      manufacturerLocations: updatedFactories,
      factories: updatedFactories,
      metrics: this.computeMetricsFromFactories(updatedFactories),
    };

    const updatedSubsidiaries = [...parent.subsidiaries];
    updatedSubsidiaries[subIndex] = updatedSubsidiary;

    const updatedParent: ParentGroup = {
      ...parent,
      subsidiaries: updatedSubsidiaries,
      metrics: this.computeMetricsFromSubsidiaries(updatedSubsidiaries),
    };

    const updatedGroups = [...groups];
    updatedGroups[parentIndex] = updatedParent;
    this._parentGroups.set(updatedGroups);
  }

  addManufacturerLocation(location: FactoryLocation): void {
    this.addFactory(location);
  }

  /**
   * Update an existing factory location
   */
  updateFactory(factory: FactoryLocation): void {
    const groups = this._parentGroups();
    const parentIndex = groups.findIndex((group) => group.id === factory.parentGroupId);
    if (parentIndex === -1) {
      this.logWarn(`Parent group ${factory.parentGroupId} not found. Cannot update factory.`);
      return;
    }

    const parent = groups[parentIndex];
    const subIndex = parent.subsidiaries.findIndex((sub) => sub.id === factory.subsidiaryId);
    if (subIndex === -1) {
      this.logWarn(`Subsidiary ${factory.subsidiaryId} not found. Cannot update factory.`);
      return;
    }

    const subsidiary = parent.subsidiaries[subIndex];
    const factoryIndex = (subsidiary.factories ?? []).findIndex((f) => f.id === factory.id);
    if (factoryIndex === -1) {
      this.logWarn(`Factory ${factory.id} not found. Adding instead.`);
      this.addFactory(factory);
      return;
    }

    const updatedFactories = [...(subsidiary.factories ?? [])];
    updatedFactories[factoryIndex] = factory;

    const updatedSubsidiary: SubsidiaryCompany = {
      ...subsidiary,
      manufacturerLocations: updatedFactories,
      factories: updatedFactories,
      metrics: this.computeMetricsFromFactories(updatedFactories),
    };

    const updatedSubsidiaries = [...parent.subsidiaries];
    updatedSubsidiaries[subIndex] = updatedSubsidiary;

    const updatedParent: ParentGroup = {
      ...parent,
      subsidiaries: updatedSubsidiaries,
      metrics: this.computeMetricsFromSubsidiaries(updatedSubsidiaries),
    };

    const updatedGroups = [...groups];
    updatedGroups[parentIndex] = updatedParent;
    this._parentGroups.set(updatedGroups);
  }

  updateManufacturerLocation(location: FactoryLocation): void {
    this.updateFactory(location);
  }

  private uniqueSuffix(): string {
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
    if (c?.getRandomValues) {
      const bytes = new Uint8Array(8);
      c.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Generate a unique subsidiary ID from subsidiary name
   */
  generateSubsidiaryId(subsidiaryName: string): string {
    const slug = subsidiaryName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${slug}-${this.uniqueSuffix()}`;
  }

  /**
   * Generate a unique factory ID from factory name (legacy format with timestamp)
   */
  generateFactoryId(factoryName: string): string {
    const slug = factoryName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `factory-${slug}-${this.uniqueSuffix()}`;
  }

  /**
   * Generate a manufacturer location ID compatible with Project.manufacturerLocationId
   * Format: company-slug-city (e.g. nova-st-eustache, new-flyer-winnipeg)
   */
  generateManufacturerLocationId(...parts: string[]): string {
    const slug = parts
      .filter(Boolean)
      .map((p) =>
        p
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      )
      .filter(Boolean)
      .join('-');
    return slug || `factory-${Date.now()}`;
  }

  /**
   * Backwards-compatible aliases
   */
  generateCompanyId(companyName: string): string {
    return this.generateSubsidiaryId(companyName);
  }

  generateNodeId(companyName: string): string {
    return this.generateFactoryId(companyName);
  }
}
