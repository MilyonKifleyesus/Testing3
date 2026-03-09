import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { FluorescenceMapComponent } from './fluorescence-map.component';
import { FluorescenceMapMapComponent } from './components/fluorescence-map-map/fluorescence-map-map.component';
import { WarRoomService } from '../../services/fluorescence-map.service';
import { AuthService, CurrentUser } from '../../../shared/services/auth.service';
import { ProjectService } from '../../../shared/services/project.service';
import { MapRealtimeService } from './realtime/map-realtime.service';
import { MapPollingService } from './realtime/map-polling.service';
import { ToastrService } from 'ngx-toastr';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { adaptApiProject } from '../../services/adapters/project.adapter';
import {
  FactoryLocation,
  ParentGroup,
  SubsidiaryCompany,
  ProjectRoute,
  TransitRoute,
} from '../../models/fluorescence-map.interface';
import { selectProjectRoutesForMap } from './state/fluorescence-map.selectors';
import { MAP_EXPANDED_CLASS } from './fluorescence-map.constants';

describe('FluorescenceMapComponent (unit)', () => {
  let fixture: ComponentFixture<FluorescenceMapComponent>;
  let component: FluorescenceMapComponent;
  let warRoomService: WarRoomService;
  let httpMock: HttpTestingController;
  let realtimeStateSubject: BehaviorSubject<any>;
  let realtimeChangeSubject: Subject<any>;
  let pollingTickSubject: Subject<void>;
  let authUserSubject: BehaviorSubject<CurrentUser | null>;
  let authServiceMock: AuthService;

  let realtimeServiceMock: {
    state$: BehaviorSubject<any>;
    changes$: Subject<any>;
    connect: jasmine.Spy;
    disconnect: jasmine.Spy;
  };

  let pollingServiceMock: {
    tick$: Subject<void>;
    start: jasmine.Spy;
    stop: jasmine.Spy;
  };

  const toastrMock = {
    info: jasmine.createSpy('info'),
    warning: jasmine.createSpy('warning'),
    success: jasmine.createSpy('success'),
    error: jasmine.createSpy('error'),
  };

  const createMapStub = () => ({
    on: jasmine.createSpy('on').and.callFake((event: string, cb: () => void) => {
      if (event === 'load' && typeof cb === 'function') {
        cb();
      }
    }),
    project: jasmine.createSpy('project').and.returnValue({ x: 100, y: 100 }),
    resize: jasmine.createSpy('resize'),
    remove: jasmine.createSpy('remove'),
    getContainer: () => ({
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 } as DOMRect)
    }),
    getZoom: jasmine.createSpy('getZoom').and.returnValue(4),
    addSource: jasmine.createSpy('addSource'),
    addLayer: jasmine.createSpy('addLayer'),
    getSource: jasmine.createSpy('getSource').and.returnValue(null),
    getLayer: jasmine.createSpy('getLayer').and.returnValue(null),
    setPaintProperty: jasmine.createSpy('setPaintProperty'),
    easeTo: jasmine.createSpy('easeTo'),
    flyTo: jasmine.createSpy('flyTo'),
    zoomIn: jasmine.createSpy('zoomIn'),
    zoomOut: jasmine.createSpy('zoomOut'),
  });

  const emptyState = {
    parentGroups: [],
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
    mapViewMode: 'project',
    selectedEntity: null,
  };

  const computeMetricsFromFactories = (factories: FactoryLocation[]) => {
    const assetCount = factories.reduce((sum, factory) => sum + factory.assets, 0);
    const incidentCount = factories.reduce((sum, factory) => sum + factory.incidents, 0);
    const weightTotal = factories.reduce((sum, factory) => sum + (factory.assets || 1), 0);
    const weightedSync = factories.reduce(
      (sum, factory) => sum + factory.syncStability * (factory.assets || 1),
      0
    );
    const syncStability = weightTotal > 0 ? Math.round((weightedSync / weightTotal) * 10) / 10 : 0;
    return { assetCount, incidentCount, syncStability };
  };

  const computeMetricsFromSubsidiaries = (subsidiaries: SubsidiaryCompany[]) => {
    const assetCount = subsidiaries.reduce((sum, sub) => sum + sub.metrics.assetCount, 0);
    const incidentCount = subsidiaries.reduce((sum, sub) => sum + sub.metrics.incidentCount, 0);
    const weightTotal = subsidiaries.reduce((sum, sub) => sum + (sub.metrics.assetCount || 1), 0);
    const weightedSync = subsidiaries.reduce(
      (sum, sub) => sum + sub.metrics.syncStability * (sub.metrics.assetCount || 1),
      0
    );
    const syncStability = weightTotal > 0 ? Math.round((weightedSync / weightTotal) * 10) / 10 : 0;
    return { assetCount, incidentCount, syncStability };
  };

  const buildFactory = (overrides: Partial<FactoryLocation>): FactoryLocation => ({
    id: overrides.id || 'factory-a',
    parentGroupId: overrides.parentGroupId || 'group-1',
    subsidiaryId: overrides.subsidiaryId || 'sub-1',
    name: overrides.name || 'Factory A',
    city: overrides.city || 'Toronto',
    country: overrides.country || 'Canada',
    coordinates: overrides.coordinates || { latitude: 43.6532, longitude: -79.3832 },
    status: overrides.status || 'ACTIVE',
    syncStability: overrides.syncStability ?? 96,
    assets: overrides.assets ?? 10,
    incidents: overrides.incidents ?? 0,
    description: overrides.description,
    logo: overrides.logo,
  });

  const buildSubsidiary = (overrides: Partial<SubsidiaryCompany>): SubsidiaryCompany => {
    const factories = overrides.factories || [buildFactory({ subsidiaryId: overrides.id || 'sub-1' })];
    const id = overrides.id || 'sub-1';
    return {
      id,
      parentGroupId: overrides.parentGroupId || 'group-1',
      name: overrides.name || id.toUpperCase(),
      status: overrides.status || 'ACTIVE',
      manufacturerLocations: overrides.manufacturerLocations ?? factories,
      factories,
      metrics: computeMetricsFromFactories(factories),
      hubs: overrides.hubs || [
        {
          id: `hub-${id}`,
          code: id.substring(0, 3).toUpperCase(),
          companyId: id,
          companyName: id.toUpperCase(),
          status: 'ACTIVE',
          capacity: '100% CAP',
          capacityPercentage: 100,
          statusColor: 'text-ok',
          capColor: 'text-ok',
        },
      ],
      quantumChart: overrides.quantumChart || { dataPoints: [80, 82, 84, 86, 88, 90], highlightedIndex: 2 },
      description: overrides.description,
      location: overrides.location,
      logo: overrides.logo,
    };
  };

  const buildParentGroup = (subsidiaries: SubsidiaryCompany[]): ParentGroup => ({
    id: 'group-1',
    name: 'Group One',
    status: 'ACTIVE',
    subsidiaries,
    metrics: computeMetricsFromSubsidiaries(subsidiaries),
    description: 'Test group',
  });

  const flushIfOpen = <T>(requests: any[], body: T): void => {
    requests.forEach((req) => {
      if (!(req as any).cancelled) {
        req.flush(body);
      }
    });
  };

  beforeEach(async () => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
    spyOn(FluorescenceMapMapComponent.prototype as any, 'createMap').and.returnValue(createMapStub());
    spyOn(FluorescenceMapMapComponent.prototype as any, 'setupResizeObserver').and.stub();
    spyOn(FluorescenceMapMapComponent.prototype as any, 'setupFullscreenListeners').and.stub();
    spyOn(FluorescenceMapMapComponent.prototype as any, 'zoomToEntity').and.stub();
    spyOn(FluorescenceMapMapComponent.prototype as any, 'fitBoundsToNodes').and.stub();
    spyOn(FluorescenceMapMapComponent.prototype as any, 'fitBoundsToRoutes').and.stub();
    spyOn(FluorescenceMapMapComponent.prototype as any, 'getNodePosition').and.returnValue({ top: 100, left: 100 });

    spyOn(window, 'fetch').and.callFake(async () => {
      return new Response(JSON.stringify(emptyState), { status: 200 });
    });

    realtimeStateSubject = new BehaviorSubject('connected');
    realtimeChangeSubject = new Subject();
    pollingTickSubject = new Subject<void>();
    realtimeServiceMock = {
      state$: realtimeStateSubject,
      changes$: realtimeChangeSubject,
      connect: jasmine.createSpy('connect').and.returnValue(Promise.resolve()),
      disconnect: jasmine.createSpy('disconnect').and.returnValue(Promise.resolve()),
    };
    pollingServiceMock = {
      tick$: pollingTickSubject,
      start: jasmine.createSpy('start'),
      stop: jasmine.createSpy('stop'),
    };

    authUserSubject = new BehaviorSubject<CurrentUser | null>({
      userId: 1,
      username: 'test-admin',
      role: 'admin',
      clientId: 1,
      isGeneralAdmin: true,
    });
    authServiceMock = {
      currentUser$: authUserSubject.asObservable(),
      get currentUserValue() {
        return authUserSubject.value;
      },
    } as unknown as AuthService;

    await TestBed.configureTestingModule({
      imports: [FluorescenceMapComponent, BrowserAnimationsModule],
      providers: [
        WarRoomService,
        { provide: AuthService, useValue: authServiceMock },
        { provide: MapRealtimeService, useValue: realtimeServiceMock },
        { provide: MapPollingService, useValue: pollingServiceMock },
        { provide: ToastrService, useValue: toastrMock },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    localStorage.clear();
    localStorage.setItem('war-room-add-project-seen', '1');
    localStorage.setItem('war-room-tips-hint-seen', '1');
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(FluorescenceMapComponent);
    component = fixture.componentInstance;
    warRoomService = TestBed.inject(WarRoomService);
    const projectService = TestBed.inject(ProjectService);
    spyOn(projectService, 'getProjectsForMap').and.returnValue(of([]));
    spyOn(projectService, 'getProjectTypes').and.returnValue(of([]));
    spyOn(projectService, 'getManufacturers').and.returnValue(of([]));
    spyOn(projectService, 'getClientOptionsWithCounts').and.returnValue(of([]));
    spyOn(projectService, 'getManufacturerOptionsWithCounts').and.returnValue(of([]));
    spyOn(projectService, 'getProjectTypeOptionsWithCounts').and.returnValue(of([]));
    spyOn(projectService, 'getProjectOptionsWithCounts').and.returnValue(of([]));
    spyOn(projectService, 'getManufacturersForHierarchy').and.returnValue(of([]));
    fixture.detectChanges();
    // Flush required backend endpoint requests
    const clientsReq = httpMock.match((r) => r.url.toLowerCase().includes('/clients'));
    flushIfOpen(clientsReq, { items: [] });
    const projectsReq = httpMock.match(
      (r) => r.url.toLowerCase().includes('/projects')
    );
    flushIfOpen(projectsReq, { items: [] });
    const manufacturersReq = httpMock.match((r) => r.url.toLowerCase().includes('/manufacturers'));
    flushIfOpen(manufacturersReq, { items: [] });
    const locationsReq = httpMock.match((r) => r.url.toLowerCase().includes('/locations'));
    flushIfOpen(locationsReq, { items: [] });
  });

  afterEach(() => {
    document.body.classList.remove(MAP_EXPANDED_CLASS);
    document.body.style.overflow = '';
  });


  const setServiceState = (parentGroups: ParentGroup[], routes: TransitRoute[]) => {
    const serviceAny = warRoomService as any;
    serviceAny._parentGroups.set(parentGroups);
    serviceAny._transitRoutes.set(routes);
  };

  it('recomputes connections when companies list changes', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factoryA] });
    const parentGroup = buildParentGroup([subsidiary]);
    const route: TransitRoute = {
      id: 'route-a-b',
      from: 'factory-a',
      to: 'factory-b',
      fromCoordinates: { latitude: 43.6532, longitude: -79.3832 },
      toCoordinates: { latitude: 34.0522, longitude: -118.2437 },
      animated: true,
    };

    setServiceState([parentGroup], [route]);
    warRoomService.setMapViewMode('factory');
    fixture.detectChanges();

    expect(component.filteredTransitRoutes().length).toBe(0);

    const factoryB = buildFactory({ id: 'factory-b', subsidiaryId: 'sub-1', city: 'Los Angeles' });
    const updatedSubsidiary = buildSubsidiary({ id: 'sub-1', factories: [factoryA, factoryB] });
    const updatedGroup = buildParentGroup([updatedSubsidiary]);
    setServiceState([updatedGroup], [route]);
    fixture.detectChanges();

    expect(component.filteredTransitRoutes().length).toBe(1);
  });

  it('updates connections when filters change', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const factoryB = buildFactory({ id: 'factory-b', subsidiaryId: 'sub-2', city: 'Denver' });
    const subsidiaryA = buildSubsidiary({ id: 'sub-1', factories: [factoryA] });
    const subsidiaryB = buildSubsidiary({ id: 'sub-2', factories: [factoryB] });
    const parentGroup = buildParentGroup([subsidiaryA, subsidiaryB]);
    const route: TransitRoute = {
      id: 'route-a-b',
      from: 'factory-a',
      to: 'factory-b',
      fromCoordinates: factoryA.coordinates,
      toCoordinates: factoryB.coordinates,
      animated: true,
    };

    setServiceState([parentGroup], [route]);
    warRoomService.setMapViewMode('factory');
    fixture.detectChanges();

    expect(component.filteredTransitRoutes().length).toBe(1);

    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: ['unknown-manufacturer'],
      projectTypeIds: [],
      projectIds: [],
    });
    fixture.detectChanges();

    expect(component.filteredTransitRoutes().length).toBe(0);
  });

  it('toggleMapExpanded toggles mapExpanded and body class', () => {
    expect(component.mapExpanded()).toBeFalse();
    expect(document.body.classList.contains(MAP_EXPANDED_CLASS)).toBeFalse();

    component.toggleMapExpanded();
    expect(component.mapExpanded()).toBeTrue();
    expect(document.body.classList.contains(MAP_EXPANDED_CLASS)).toBeTrue();

    component.toggleMapExpanded();
    expect(component.mapExpanded()).toBeFalse();
    expect(document.body.classList.contains(MAP_EXPANDED_CLASS)).toBeFalse();
  });

  it('toggleMapExpanded hides panels when expanding', () => {
    component.panelVisible.set(true);
    component.toggleMapExpanded();
    expect(component.mapExpanded()).toBeTrue();
    expect(component.panelVisible()).toBeFalse();
  });

  it('does not clear body overflow when it was already hidden', () => {
    document.body.style.overflow = 'hidden';

    component.toggleMapExpanded(); // expand
    expect(document.body.style.overflow).toBe('hidden');

    component.toggleMapExpanded(); // collapse
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores previous body overflow when it applied the lock', () => {
    document.body.style.overflow = 'auto';

    component.toggleMapExpanded(); // expand
    expect(document.body.style.overflow).toBe('hidden');

    component.toggleMapExpanded(); // collapse
    expect(document.body.style.overflow).toBe('auto');
  });

  it('syncs external project input into applied and draft project filters', () => {
    fixture.componentRef.setInput('externalProjectId', 'project4');
    fixture.detectChanges();

    expect(component.filterApplied().projectIds).toEqual(['project4']);
    expect(component.filterDraft().projectIds).toEqual(['project4']);
    expect(component.selectedProjectId()).toBe('project4');

    fixture.componentRef.setInput('externalProjectId', null);
    fixture.detectChanges();

    expect(component.filterApplied().projectIds).toEqual([]);
    expect(component.filterDraft().projectIds).toEqual([]);
    expect(component.selectedProjectId()).toBeNull();
  });

  it('does not change map view when switching log panel mode to manufacturer', () => {
    warRoomService.setMapViewMode('factory');
    fixture.detectChanges();

    component.setLogPanelMode('manufacturer');
    fixture.detectChanges();

    expect(component.logPanelMode()).toBe('manufacturer');
    expect(component.mapViewMode()).toBe('factory');
  });

  it('returns empty connections when project filters remove all nodes', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factoryA] });
    const parentGroup = buildParentGroup([subsidiary]);
    const route: TransitRoute = {
      id: 'route-a',
      from: 'factory-a',
      to: 'factory-a',
      fromCoordinates: factoryA.coordinates,
      toCoordinates: factoryA.coordinates,
      animated: true,
    };

    setServiceState([parentGroup], [route]);
    warRoomService.setMapViewMode('factory');
    fixture.detectChanges();

    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: ['nonexistent'],
      projectTypeIds: [],
      projectIds: [],
    });
    fixture.detectChanges();

    expect(component.filteredNodes().length).toBe(0);
    expect(component.filteredTransitRoutes().length).toBe(0);
  });

  it('filters project routes when a project is selected', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'project-route-1',
        projectId: 'project-1',
        fromNodeId: 'client-a',
        toNodeId: 'factory-a',
        status: 'Open',
        fromCoordinates: { latitude: 43.7, longitude: -79.4 },
        toCoordinates: { latitude: 45.4, longitude: -75.7 },
      },
      {
        id: 'project-route-2',
        projectId: 'project-2',
        fromNodeId: 'client-b',
        toNodeId: 'factory-b',
        status: 'Closed',
        fromCoordinates: { latitude: 40.7, longitude: -74.0 },
        toCoordinates: { latitude: 34.0, longitude: -118.2 },
      },
    ];

    component.projectRoutes.set(routes);
    component.selectedProjectId.set('project-2');
    fixture.detectChanges();

    const filtered = selectProjectRoutesForMap(
      component.mapViewMode(),
      routes,
      component.selectedProjectId()
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].projectId).toBe('project-2');

    component.selectedProjectId.set(null);
    fixture.detectChanges();

    expect(
      selectProjectRoutesForMap(
        component.mapViewMode(),
        routes,
        component.selectedProjectId()
      ).length
    ).toBe(2);
  });

  it('hides project routes in manufacturer view', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'project-route-1',
        projectId: 'project-1',
        fromNodeId: 'client-a',
        toNodeId: 'factory-a',
        status: 'Open',
        fromCoordinates: { latitude: 43.7, longitude: -79.4 },
        toCoordinates: { latitude: 45.4, longitude: -75.7 },
      },
    ];

    component.projectRoutes.set(routes);
    warRoomService.setMapViewMode('manufacturer');
    fixture.detectChanges();

    const visibleRoutes = selectProjectRoutesForMap(
      component.mapViewMode(),
      routes,
      component.selectedProjectId()
    );
    expect(visibleRoutes.length).toBe(0);
  });

  it('hides project routes in factory view', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'project-route-1',
        projectId: 'project-1',
        fromNodeId: 'client-a',
        toNodeId: 'factory-a',
        status: 'Open',
        fromCoordinates: { latitude: 43.7, longitude: -79.4 },
        toCoordinates: { latitude: 45.4, longitude: -75.7 },
      },
    ];

    component.projectRoutes.set(routes);
    warRoomService.setMapViewMode('factory');
    fixture.detectChanges();

    expect(component.projectRoutesForMap().length).toBe(0);
  });

  it('hides project routes in client view', () => {
    const routes: ProjectRoute[] = [
      {
        id: 'project-route-1',
        projectId: 'project-1',
        fromNodeId: 'client-a',
        toNodeId: 'factory-a',
        status: 'Open',
        fromCoordinates: { latitude: 43.7, longitude: -79.4 },
        toCoordinates: { latitude: 45.4, longitude: -75.7 },
      },
    ];

    component.projectRoutes.set(routes);
    warRoomService.setMapViewMode('client');
    fixture.detectChanges();

    expect(component.projectRoutesForMap().length).toBe(0);
  });

  it('keeps current behavior: subsidiary selection is ignored in manufacturer mode', () => {
    warRoomService.setMapViewMode('manufacturer');
    warRoomService.selectEntity(null);
    fixture.detectChanges();

    component.onEntitySelected({
      level: 'subsidiary',
      id: 'sub-1',
      parentGroupId: 'group-1',
      subsidiaryId: 'sub-1',
    });

    expect(warRoomService.selectedEntity()).toBeNull();
  });

  it('auto-switches log panel to manufacturer mode when switching to manufacturer view', () => {
    component.setLogPanelMode('client');
    expect(component.logPanelMode()).toBe('client');

    component.setMapViewMode('manufacturer');

    expect(component.logPanelMode()).toBe('manufacturer');
  });

  it('blocks switching log panel to client while in manufacturer view', () => {
    component.setMapViewMode('manufacturer');
    expect(component.logPanelMode()).toBe('manufacturer');

    component.setLogPanelMode('client');

    expect(component.logPanelMode()).toBe('manufacturer');
  });

  it('clears client filters and selected project when switching to client view', () => {
    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: ['client-a'],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    component.filterDraft.set({
      status: 'all',
      regions: [],
      clientIds: ['client-a'],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    component.selectedProjectId.set('project-1');

    component.setMapViewMode('client');

    expect(component.filterApplied().clientIds).toEqual([]);
    expect(component.filterDraft().clientIds).toEqual([]);
    expect(component.selectedProjectId()).toBeNull();
  });

  it('does not force log panel mode when switching to client view', () => {
    component.setLogPanelMode('manufacturer');
    expect(component.logPanelMode()).toBe('manufacturer');

    component.setMapViewMode('client');
    expect(component.logPanelMode()).toBe('manufacturer');

    component.setLogPanelMode('client');
    expect(component.logPanelMode()).toBe('client');

    component.setMapViewMode('project');
    component.setMapViewMode('client');
    expect(component.logPanelMode()).toBe('client');
  });

  it('in project view without loaded client context, project routes can materialize factory markers', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const factoryB = buildFactory({ id: 'factory-b', subsidiaryId: 'sub-1', city: 'Dallas' });
    const factoryC = buildFactory({ id: 'factory-c', subsidiaryId: 'sub-1', city: 'Houston' });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factoryA, factoryB, factoryC] });
    const parentGroup = buildParentGroup([subsidiary]);

    setServiceState([parentGroup], []);
    warRoomService.setMapViewMode('project');
    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });

    const routes: ProjectRoute[] = [
      {
        id: 'project-route-1',
        projectId: 'project-1',
        fromNodeId: 'client-a',
        toNodeId: 'factory-a',
        status: 'Open',
        fromCoordinates: { latitude: 43.7, longitude: -79.4 },
        toCoordinates: { latitude: 45.4, longitude: -75.7 },
      },
      {
        id: 'project-route-2',
        projectId: 'project-2',
        fromNodeId: 'client-b',
        toNodeId: 'factory-b',
        status: 'Closed',
        fromCoordinates: { latitude: 40.7, longitude: -74.0 },
        toCoordinates: { latitude: 34.0, longitude: -118.2 },
      },
    ];
    component.projectRoutes.set(routes);
    fixture.detectChanges();

    const filtered = component.filteredNodes();
    const factoryIds = filtered
      .filter((n) => n.level === 'manufacturer' || n.level === 'factory')
      .map((n) => n.id);
    expect(factoryIds.length).toBeGreaterThan(0);
  });

  it('in project view with no routes, shows no factory markers', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factoryA] });
    const parentGroup = buildParentGroup([subsidiary]);

    setServiceState([parentGroup], []);
    warRoomService.setMapViewMode('project');
    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    component.projectRoutes.set([]);
    fixture.detectChanges();

    const filtered = component.filteredNodes();
    const factoryNodes = filtered.filter((n) => n.level === 'manufacturer' || n.level === 'factory');
    expect(factoryNodes.length).toBe(0);
  });

  it('showEmptyStateOverlay is false when no filters are active and no routes match', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factoryA] });
    const parentGroup = buildParentGroup([subsidiary]);
    setServiceState([parentGroup], []);
    warRoomService.setMapViewMode('project');
    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    component.projectRoutes.set([]);
    component.clientsStatus.set('ready');
    component.projectsStatus.set('ready');
    component.manufacturersStatus.set('ready');
    component.locationsStatus.set('ready');
    component.projectRoutesLoading.set(false);
    component.hasLoadedRequiredData.set(true);
    fixture.detectChanges();

    expect(component.filteredNodes().length).toBe(0);
    expect(component.showEmptyStateOverlay()).toBe(false);
  });

  it('showEmptyStateOverlay is true in project view when only client nodes exist and no routes', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factoryA] });
    const parentGroup = buildParentGroup([subsidiary]);
    setServiceState([parentGroup], []);
    warRoomService.setMapViewMode('project');
    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: ['client-boltbus'],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    component.projectRoutes.set([]);
    component.clientsStatus.set('ready');
    component.projectsStatus.set('ready');
    component.manufacturersStatus.set('ready');
    component.locationsStatus.set('ready');
    component.projectRoutesLoading.set(false);
    component.hasLoadedRequiredData.set(true);
    fixture.detectChanges();

    const nodes = component.filteredNodes();
    const hasNonClient = nodes.some((n) => n.level !== 'client');
    expect(component.projectRoutesForMap().length).toBe(0);
    expect(hasNonClient).toBe(false);
    expect(component.showEmptyStateOverlay()).toBe(true);
  });

  it('in manufacturer view, keeps full manufacturer hierarchy visible regardless of status filters', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1', status: 'INACTIVE' });
    const subsidiaryA = buildSubsidiary({ id: 'sub-1', name: 'New Flyer', factories: [factoryA], status: 'INACTIVE' });
    const parentGroup = buildParentGroup([subsidiaryA]);

    setServiceState([parentGroup], []);
    component.filterApplied.set({
      status: 'active',
      regions: ['Europe'],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    warRoomService.setMapViewMode('manufacturer');
    fixture.detectChanges();

    expect(component.filteredParentGroups().length).toBe(1);
    expect(component.filteredParentGroups()[0].subsidiaries.length).toBe(1);
    expect(component.filteredParentGroups()[0].subsidiaries[0].factories?.length).toBe(1);
    const visibleFactoryNodes = component
      .filteredNodes()
      .filter((n) => n.level === 'manufacturer' || n.level === 'factory');
    expect(visibleFactoryNodes.length).toBeGreaterThan(0);
  });

  it('in manufacturer view, excludes client nodes even when client filters are active', () => {
    const factory = buildFactory({
      id: 'factory-1',
      subsidiaryId: 'sub-1',
      city: 'Ottawa',
      coordinates: { latitude: 45.42, longitude: -75.69 },
    });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factory] });
    const parentGroup = buildParentGroup([subsidiary]);
    setServiceState([parentGroup], []);
    (component as any).clientDeltaById.set(
      new Map([
        [
          'client-1',
          {
            id: 'client-1',
            name: 'Client 1',
            code: 'CLIENT-1',
            coordinates: { latitude: 43.65, longitude: -79.38 },
          },
        ],
      ])
    );
    component.projectRoutes.set([
      {
        id: 'route-1',
        projectId: 'project-1',
        fromNodeId: 'client-1',
        toNodeId: 'factory-1',
        status: 'Open',
        fromCoordinates: { latitude: 43.65, longitude: -79.38 },
        toCoordinates: { latitude: 45.42, longitude: -75.69 },
        animated: true,
      },
    ]);
    component.filterApplied.set({
      status: 'active',
      regions: [],
      clientIds: ['client-1'],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });

    warRoomService.setMapViewMode('manufacturer');
    fixture.detectChanges();

    const filtered = component.filteredNodes();
    expect(filtered.some((node) => node.level === 'client')).toBeFalse();
    expect(filtered.some((node) => node.id === 'factory-1')).toBeTrue();
  });

  it('in manufacturer view, manufacturer filter matches equivalent manufacturer names', () => {
    const factory = buildFactory({
      id: 'factory-new-flyer',
      subsidiaryId: 'sub-new-flyer',
      coordinates: { latitude: 49.8951, longitude: -97.1384 },
    });
    const subsidiary = buildSubsidiary({
      id: 'sub-new-flyer',
      name: 'New Flyer of America Inc',
      factories: [factory],
    });
    const parentGroup = buildParentGroup([subsidiary]);
    setServiceState([parentGroup], []);

    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: ['New Flyer'],
      projectTypeIds: [],
      projectIds: [],
    });
    warRoomService.setMapViewMode('manufacturer');
    fixture.detectChanges();

    const filtered = component.filteredNodes();
    expect(filtered.some((node) => node.id === 'factory-new-flyer')).toBeTrue();
  });

  it('in manufacturer view, manufacturer filter ignores company suffixes like llc/inc', () => {
    const factory = buildFactory({
      id: 'factory-new-flyer-llc',
      subsidiaryId: 'sub-new-flyer-llc',
      coordinates: { latitude: 49.8951, longitude: -97.1384 },
    });
    const subsidiary = buildSubsidiary({
      id: 'sub-new-flyer-llc',
      name: 'New Flyer LLC',
      factories: [factory],
    });
    const parentGroup = buildParentGroup([subsidiary]);
    setServiceState([parentGroup], []);

    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: ['New Flyer'],
      projectTypeIds: [],
      projectIds: [],
    });
    warRoomService.setMapViewMode('manufacturer');
    fixture.detectChanges();

    const filtered = component.filteredNodes();
    expect(filtered.some((node) => node.id === 'factory-new-flyer-llc')).toBeTrue();
  });

  it('in manufacturer view, fallback manufacturer matching uses node company name', () => {
    setServiceState([], []);
    const originalNodesWithClients = (component as any).nodesWithClients;
    const orphanManufacturerNode = {
      id: 'factory-orphan',
      name: 'winnipeg',
      company: 'New Flyer',
      companyId: 'factory-orphan-company',
      city: 'Winnipeg',
      coordinates: { latitude: 49.8951, longitude: -97.1384 },
      type: 'Facility',
      status: 'ACTIVE',
      isHub: true,
      level: 'manufacturer',
    } as any;

    (component as any).nodesWithClients = () => [orphanManufacturerNode];
    try {
      component.filterApplied.set({
        status: 'all',
        regions: [],
        clientIds: [],
        manufacturerIds: ['New Flyer'],
        projectTypeIds: [],
        projectIds: [],
      });
      warRoomService.setMapViewMode('manufacturer');
      fixture.detectChanges();

      const filtered = component.filteredNodes();
      expect(filtered.some((node) => node.id === 'factory-orphan')).toBeTrue();
    } finally {
      (component as any).nodesWithClients = originalNodesWithClients;
    }
  });

  it('showEmptyStateOverlay is true when active filters leave only non-renderable coordinates', () => {
    const factory = buildFactory({
      id: 'factory-invalid-coords',
      subsidiaryId: 'sub-new-flyer',
      coordinates: { latitude: 123, longitude: 200 },
    });
    const subsidiary = buildSubsidiary({
      id: 'sub-new-flyer',
      name: 'New Flyer',
      factories: [factory],
    });
    const parentGroup = buildParentGroup([subsidiary]);
    setServiceState([parentGroup], []);

    component.hasLoadedRequiredData.set(false);
    component.clientsStatus.set('error');
    component.projectsStatus.set('ready');
    component.manufacturersStatus.set('ready');
    component.locationsStatus.set('ready');
    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: ['New Flyer'],
      projectTypeIds: [],
      projectIds: [],
    });
    warRoomService.setMapViewMode('manufacturer');
    fixture.detectChanges();

    expect(component.filteredNodes().length).toBeGreaterThan(0);
    expect(component.showEmptyStateOverlay()).toBeTrue();
  });

  it('showEmptyStateOverlay is true when a required endpoint errors and active filters produce no nodes', () => {
    setServiceState([], []);

    component.hasLoadedRequiredData.set(false);
    component.clientsStatus.set('error');
    component.projectsStatus.set('ready');
    component.manufacturersStatus.set('ready');
    component.locationsStatus.set('ready');
    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: ['Does Not Exist'],
      projectTypeIds: [],
      projectIds: [],
    });
    warRoomService.setMapViewMode('manufacturer');
    fixture.detectChanges();

    expect(component.filteredNodes().length).toBe(0);
    expect(component.showEmptyStateOverlay()).toBeTrue();
  });

  it('uses effective all-status filter in manufacturer view', () => {
    component.filterApplied.update((filters) => ({ ...filters, status: 'active' }));
    warRoomService.setMapViewMode('manufacturer');
    fixture.detectChanges();

    expect(component.effectiveStatusFilter()).toBe('all');
  });

  it('shows only client nodes in client view even when a manufacturer is selected', () => {
    const factory = buildFactory({
      id: 'factory-1',
      subsidiaryId: 'sub-1',
      city: 'Ottawa',
      coordinates: { latitude: 45.42, longitude: -75.69 },
    });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factory] });
    const parentGroup = buildParentGroup([subsidiary]);
    setServiceState([parentGroup], []);
    // Prevent the "required data ready" effect from clearing client deltas when we run detectChanges()
    spyOn(component as any, 'clearDeltaOverlays').and.stub();
    (component as any).clientDeltaById.set(
      new Map([
        [
          'client-1',
          {
            id: 'client-1',
            name: 'Client 1',
            code: 'CLIENT-1',
            coordinates: { latitude: 43.65, longitude: -79.38 },
          },
        ],
      ])
    );
    warRoomService.selectEntity({
      level: 'manufacturer',
      id: 'factory-1',
      manufacturerLocationId: 'factory-1',
      factoryId: 'factory-1',
    });

    component.setMapViewMode('client');
    fixture.detectChanges();

    const filtered = component.filteredNodes();
    expect(filtered.length).toBe(1);
    expect(filtered[0].level).toBe('client');
    expect(filtered[0].id).toBe('client-1');
  });

  it('returns no transit routes in client view', () => {
    const route: TransitRoute = {
      id: 'route-a-b',
      from: 'factory-a',
      to: 'factory-b',
      fromCoordinates: { latitude: 43.6532, longitude: -79.3832 },
      toCoordinates: { latitude: 45.4215, longitude: -75.6972 },
      animated: true,
    };
    setServiceState([], [route]);

    component.setMapViewMode('client');
    fixture.detectChanges();

    expect(component.filteredTransitRoutes().length).toBe(0);
  });

  it('shows manufacturer nodes again after switching back from client to manufacturer view', () => {
    const factory = buildFactory({
      id: 'factory-1',
      subsidiaryId: 'sub-1',
      city: 'Ottawa',
      coordinates: { latitude: 45.42, longitude: -75.69 },
    });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factory] });
    const parentGroup = buildParentGroup([subsidiary]);
    setServiceState([parentGroup], []);
    (component as any).clientDeltaById.set(
      new Map([
        [
          'client-1',
          {
            id: 'client-1',
            name: 'Client 1',
            code: 'CLIENT-1',
            coordinates: { latitude: 43.65, longitude: -79.38 },
          },
        ],
      ])
    );

    component.setMapViewMode('client');
    fixture.detectChanges();
    expect(component.filteredNodes().every((node) => node.level === 'client')).toBeTrue();

    component.setMapViewMode('manufacturer');
    fixture.detectChanges();
    const filtered = component.filteredNodes();
    expect(filtered.some((node) => node.id === 'factory-1')).toBeTrue();
    expect(filtered.some((node) => node.level === 'client')).toBeFalse();
  });

  it('selecting a factory sets selectedEntity', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factoryA] });
    const parentGroup = buildParentGroup([subsidiary]);
    setServiceState([parentGroup], []);
    warRoomService.setMapViewMode('factory');
    fixture.detectChanges();

    component.onEntitySelected({
      level: 'factory',
      id: factoryA.id,
      parentGroupId: factoryA.parentGroupId,
      subsidiaryId: factoryA.subsidiaryId,
      factoryId: factoryA.id,
    });

    expect(warRoomService.selectedEntity()?.id).toBe(factoryA.id);
  });

  it('onClientPanelSaveComplete triggers required data reload', () => {
    const retrySpy = spyOn(component, 'retryRequiredDataLoad');

    component.onClientPanelSaveComplete();

    expect(retrySpy).toHaveBeenCalled();
  });

  it('coalesces MapChanged bursts into one debounced refresh tick', fakeAsync(() => {
    const initialRefreshTrigger = component.projectRoutesRefreshTrigger();
    realtimeChangeSubject.next({
      entity: 'Project',
      action: 'Updated',
      id: 'p-1',
      payload: { id: 'p-1', projectName: 'A' },
      timestampUtc: '2026-02-24T00:00:00Z',
    });
    realtimeChangeSubject.next({
      entity: 'Project',
      action: 'Updated',
      id: 'p-2',
      payload: { id: 'p-2', projectName: 'B' },
      timestampUtc: '2026-02-24T00:00:01Z',
    });
    realtimeChangeSubject.next({
      entity: 'Project',
      action: 'Updated',
      id: 'p-3',
      payload: { id: 'p-3', projectName: 'C' },
      timestampUtc: '2026-02-24T00:00:02Z',
    });

    tick(251);
    expect(component.projectRoutesRefreshTrigger()).toBe(initialRefreshTrigger + 1);
  }));

  it('starts polling fallback after disconnect grace interval', fakeAsync(() => {
    realtimeStateSubject.next('disconnected');
    tick(9999);
    expect(pollingServiceMock.start).not.toHaveBeenCalled();

    tick(1);
    expect(pollingServiceMock.start).toHaveBeenCalledWith(15000);
    expect(component.realtimeUiState()).toBe('polling');
  }));

  it('stops polling when realtime reconnects', fakeAsync(() => {
    realtimeStateSubject.next('disconnected');
    tick(10000);
    expect(pollingServiceMock.start).toHaveBeenCalled();

    realtimeStateSubject.next('connected');
    tick(1);

    expect(pollingServiceMock.stop).toHaveBeenCalled();
    expect(component.realtimeUiState()).toBe('connected');
  }));

  it('disconnects realtime and polling on destroy', () => {
    component.ngOnDestroy();
    expect(realtimeServiceMock.disconnect).toHaveBeenCalled();
    expect(pollingServiceMock.stop).toHaveBeenCalled();
  });

  it('maps BusPulseApi project shape (name, closed, clientId) to Project adapter model', () => {
    const mapped = adaptApiProject({
      id: 123,
      name: 'Project Alpha',
      closed: true,
      clientId: 'client-1',
      assessmentType: 'New Build',
    });

    expect(mapped).toBeTruthy();
    expect(mapped?.projectName).toBe('Project Alpha');
    expect(mapped?.clientId).toBe('client-1');
    expect(mapped?.closed).toBeTrue();
    expect(mapped?.status).toBe('Closed');
  });

  it('resolves client coordinates from location fallback when direct coords are missing', () => {
    spyOn(component as any, 'clearDeltaOverlays').and.stub();
    (component as any).clientDeltaById.set(
      new Map([
        [
          '001',
          {
            id: '001',
            name: '54 Davies',
            code: '54D',
            locationId: '500',
          },
        ],
      ])
    );
    (component as any).locationDeltaById.set(
      new Map([
        [
          '500',
          {
            id: 500,
            name: 'Toronto',
            latitude: '43.6532' as unknown as number,
            longitude: '-79.3832' as unknown as number,
          },
        ],
      ])
    );

    warRoomService.setMapViewMode('client');
    fixture.detectChanges();

    const clientNode = component.filteredNodes().find((node) => node.level === 'client');
    expect(clientNode).toBeTruthy();
    expect(clientNode?.id).toBe('1');
    expect(clientNode?.coordinates).toEqual({ latitude: 43.6532, longitude: -79.3832 });
  });

  it('normalizes persisted client filter ids and keeps matching client nodes visible', fakeAsync(() => {
    fixture.destroy();
    localStorage.clear();
    localStorage.setItem('war-room-add-project-seen', '1');
    localStorage.setItem('war-room-tips-hint-seen', '1');
    localStorage.setItem(
      'war-room-state-v1',
      JSON.stringify({
        status: 'all',
        regions: [],
        clientIds: ['001'],
        manufacturerIds: [],
        projectTypeIds: [],
        projectIds: [],
        mapViewMode: 'project',
      })
    );

    fixture = TestBed.createComponent(FluorescenceMapComponent);
    component = fixture.componentInstance;
    warRoomService = TestBed.inject(WarRoomService);
    spyOn(component as any, 'clearDeltaOverlays').and.stub();
    fixture.detectChanges();
    flushIfOpen(httpMock.match((r) => r.url.toLowerCase().includes('/clients')), { items: [] });
    flushIfOpen(httpMock.match((r) => r.url.toLowerCase().includes('/projects')), { items: [] });
    flushIfOpen(httpMock.match((r) => r.url.toLowerCase().includes('/manufacturers')), { items: [] });
    flushIfOpen(httpMock.match((r) => r.url.toLowerCase().includes('/locations')), { items: [] });

    (component as any).clientDeltaById.set(
      new Map([
        [
          '001',
          {
            id: '001',
            name: 'Electromin',
            code: 'ELC',
            coordinates: { latitude: 43.7, longitude: -79.4 },
          },
        ],
      ])
    );
    warRoomService.setMapViewMode('project');
    component.projectRoutes.set([
      {
        id: 'route-persisted',
        projectId: 'project-9',
        fromNodeId: '1',
        toNodeId: 'factory-9',
        status: 'Open',
        fromCoordinates: { latitude: 43.7, longitude: -79.4 },
        toCoordinates: { latitude: 45.4, longitude: -75.7 },
      },
    ]);
    fixture.detectChanges();

    expect(component.filterApplied().clientIds).toEqual(['1']);
    expect(component.filterDraft().clientIds).toEqual(['1']);
    const clientNodes = component.filteredNodes().filter((node) => node.level === 'client');
    expect(clientNodes.length).toBe(1);
    expect(clientNodes[0].id).toBe('1');
  }));

  it('keeps filter changes in draft until apply', () => {
    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    component.filterDraft.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });

    component.toggleManufacturer('New Flyer');

    expect(component.filterDraft().manufacturerIds).toEqual(['New Flyer']);
    expect(component.filterApplied().manufacturerIds).toEqual([]);

    component.applyFilters();
    expect(component.filterApplied().manufacturerIds).toEqual(['New Flyer']);
  });

  it('cancelFiltersPanel discards unsaved draft changes', () => {
    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: ['1'],
      manufacturerIds: ['Nova'],
      projectTypeIds: [],
      projectIds: [],
    });
    component.openFiltersPanel();
    component.toggleManufacturer('New Flyer');

    expect(component.filterDraft().manufacturerIds).toContain('New Flyer');

    component.cancelFiltersPanel();

    expect(component.filtersPanelVisible()).toBeFalse();
    expect(component.filterDraft()).toEqual(component.filterApplied());
    expect(component.filterDraft().manufacturerIds).toEqual(['Nova']);
  });

  it('resetDraftFilters resets draft only and keeps applied filters', () => {
    const applied: any = {
      status: 'inactive',
      regions: ['North America'],
      clientIds: ['1'],
      manufacturerIds: ['Nova'],
      projectTypeIds: ['New Build'],
      projectIds: ['project-a'],
    };
    component.filterApplied.set(applied);
    component.filterDraft.set({
      status: 'active',
      regions: ['Europe'],
      clientIds: ['2'],
      manufacturerIds: ['New Flyer'],
      projectTypeIds: ['Condition Assessment'],
      projectIds: ['project-b'],
    });

    component.resetDraftFilters();

    expect(component.filterApplied()).toEqual(applied);
    expect(component.filterDraft()).toEqual({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
  });

  it('applies filters to activity table rows and keeps draft result preview separate', () => {
    spyOn(component as any, 'clearDeltaOverlays').and.stub();
    warRoomService.setMapViewMode('project');
    (component as any).projectDeltaById.set(
      new Map([
        [
          'project-1',
          {
            id: 'project-1',
            projectName: 'Project One',
            clientId: '1',
            clientName: 'Client One',
            assessmentType: 'New Build',
            projectTypeId: 'new-build',
            locationId: 'loc-1',
            manufacturerLocationId: 'loc-1',
            manufacturer: 'Nova',
            status: 'Open',
            closed: false,
            lastUpdate: '2026-01-01T00:00:00.000Z',
          },
        ],
        [
          'project-2',
          {
            id: 'project-2',
            projectName: 'Project Two',
            clientId: '2',
            clientName: 'Client Two',
            assessmentType: 'Condition Assessment',
            projectTypeId: 'condition',
            locationId: 'loc-2',
            manufacturerLocationId: 'loc-2',
            manufacturer: 'New Flyer',
            status: 'Open',
            closed: false,
            lastUpdate: '2026-01-02T00:00:00.000Z',
          },
        ],
      ])
    );

    component.filterApplied.set({
      status: 'all',
      regions: [],
      clientIds: ['1'],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    component.filterDraft.set({
      status: 'all',
      regions: [],
      clientIds: ['2'],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    fixture.detectChanges();

    expect(component.activityTableRows().length).toBe(1);
    expect(component.activityTableRows()[0].projectId).toBe('project-1');
    expect(component.draftResultCount()).toBe(1);
  });

  it('adding a company does not reset selection unless specified', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const subsidiaryA = buildSubsidiary({ id: 'sub-1', factories: [factoryA] });
    const parentGroup = buildParentGroup([subsidiaryA]);
    setServiceState([parentGroup], []);

    warRoomService.selectEntity({
      level: 'factory',
      id: factoryA.id,
      parentGroupId: factoryA.parentGroupId,
      subsidiaryId: factoryA.subsidiaryId,
      factoryId: factoryA.id,
    });

    const newFactory = buildFactory({ id: 'factory-b', subsidiaryId: 'sub-2', parentGroupId: 'group-1' });
    const subsidiaryB = buildSubsidiary({
      id: 'sub-2',
      parentGroupId: 'group-1',
      factories: [newFactory],
    });

    warRoomService.addSubsidiary(subsidiaryB);
    fixture.detectChanges();

    expect(warRoomService.selectedEntity()?.id).toBe(factoryA.id);
  });

  it('does not reject project save when manufacturer is derived as Multiple', fakeAsync(() => {
    (component as any).projectDeltaById.set(
      new Map([
        [
          '1',
          {
            id: '1',
            projectName: 'Project One',
            clientId: '100',
            assessmentType: 'Inspection',
            projectTypeId: 10,
            locationIds: [30, 31],
            locationId: '30',
            status: 'Open',
            closed: false,
          },
        ],
      ])
    );
    spyOn((component as any).dataManagementMutation, 'saveRowDraft').and.returnValue(
      Promise.resolve({
        changed: { project: false, location: false, client: false, manufacturer: false },
      })
    );

    const resolve = jasmine.createSpy('resolve');
    const reject = jasmine.createSpy('reject');

    component.onActivityRowSaveRequested({
      row: {
        id: 'project-1',
        entityType: 'project',
        entityId: '1',
        projectId: '1',
        projectTypeId: '10',
        projectTypeName: 'Inspection',
        contract: '',
        hasRoadTest: false,
        entityName: 'Project One',
        status: 'Active',
        clientId: null,
        clientName: 'Client One',
        clientLocationId: null,
        clientCoordinates: null,
        manufacturerId: null,
        manufacturerName: 'Multiple',
        manufacturerLocationId: '30',
        manufacturerCoordinates: null,
        locationId: '30',
        locationIds: [30, 31],
        locationName: 'Factory A',
        locationCoordinates: { latitude: 42.1, longitude: -80.2 },
        startDate: null,
        endDate: null,
        updatedAt: '2026-01-05T00:00:00.000Z',
        coordinates: { latitude: 42.1, longitude: -80.2 },
        source: 'project_snapshot',
      },
      draft: {
        projectDraft: {
          name: 'Project One',
          status: 'Active',
          type: 'Inspection',
          projectTypeId: '10',
          contract: '',
          hasRoadTest: false,
        },
        locationDraft: {
          name: 'Factory A',
          latitude: '42.100000',
          longitude: '-80.200000',
        },
        clientDraft: {
          name: 'Client One',
          locationIds: [30, 31],
        },
        manufacturerDraft: {
          name: 'Multiple',
          locationId: '30',
          locationIds: [30, 31],
          disabled: true,
        },
      },
      resolve,
      reject,
    });

    tick();

    expect((component as any).dataManagementMutation.saveRowDraft).toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalled();
  }));

  it('strict map vm uses filterApplied only; draft does not affect map until apply', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factoryA] });
    setServiceState([buildParentGroup([subsidiary])], []);
    warRoomService.setMapViewMode('project');

    component.projectRoutes.set([
      {
        id: 'project-route-1',
        projectId: 'project-1',
        fromNodeId: 'client-1',
        toNodeId: 'factory-a',
        status: 'Open',
        fromCoordinates: { latitude: 43.7, longitude: -79.4 },
        toCoordinates: { latitude: 45.4, longitude: -75.7 },
      },
    ]);
    fixture.detectChanges();

    expect(component.mapViewModelStrict().routes.length).toBe(1);

    component.filterDraft.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: ['other-project'],
    });
    fixture.detectChanges();

    expect(component.mapViewModelStrict().routes.length).toBe(1);

    component.applyFilters();
    fixture.detectChanges();

    expect(component.mapViewModelStrict().routes.length).toBe(0);
  });

  it('strict pipeline clears filtered-out selection and shows notice', () => {
    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factoryA] });
    setServiceState([buildParentGroup([subsidiary])], []);
    warRoomService.setMapViewMode('project');

    component.projectRoutes.set([
      {
        id: 'project-route-1',
        projectId: 'project-1',
        fromNodeId: 'client-1',
        toNodeId: 'factory-a',
        status: 'Open',
        fromCoordinates: { latitude: 43.7, longitude: -79.4 },
        toCoordinates: { latitude: 45.4, longitude: -75.7 },
      },
    ]);
    warRoomService.selectEntity({
      level: 'manufacturer',
      id: 'factory-a',
      manufacturerLocationId: 'factory-a',
      factoryId: 'factory-a',
    });
    component.onRouteSelected({ routeId: 'project-route-1', projectId: 'project-1' });
    fixture.detectChanges();

    component.filterDraft.set({
      status: 'all',
      regions: [],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: ['other-project'],
    });
    component.applyFilters();
    fixture.detectChanges();

    expect(warRoomService.selectedEntity()).toBeNull();
    expect(component.selectedRouteId()).toBeNull();
    expect(component.selectionOutsideFiltersNotice()).toBe('Current selection is outside applied filters');
  });

});
