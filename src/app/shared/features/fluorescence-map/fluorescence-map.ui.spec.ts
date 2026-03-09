import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { FluorescenceMapComponent } from './fluorescence-map.component';
import { FluorescenceMapMapComponent } from './components/fluorescence-map-map/fluorescence-map-map.component';
import { WarRoomService } from '../../../shared/services/fluorescence-map.service';
import { AuthService, CurrentUser } from '../../../shared/services/auth.service';
import { MapRealtimeService } from './realtime/map-realtime.service';
import { MapPollingService } from './realtime/map-polling.service';
import { ProjectService } from '../../../shared/services/project.service';
import { ToastrService } from 'ngx-toastr';
import { ActivityLog, FactoryLocation, ParentGroup, SubsidiaryCompany } from '../../../shared/models/fluorescence-map.interface';
import { BehaviorSubject, Subject, of } from 'rxjs';

describe('FluorescenceMapComponent UI (responsive + a11y)', () => {
  let fixture: ComponentFixture<FluorescenceMapComponent>;
  let component: FluorescenceMapComponent;
  let warRoomService: WarRoomService;
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

  const buildLog = (factory: FactoryLocation, subsidiary: SubsidiaryCompany, index: number): ActivityLog => ({
    id: `log-${factory.id}-${index}`,
    timestamp: new Date(),
    status: 'ACTIVE',
    title: `${subsidiary.name.toUpperCase()} | ${factory.name.toUpperCase()}`,
    description: `LOG ${index}`,
    parentGroupId: factory.parentGroupId,
    subsidiaryId: factory.subsidiaryId,
    manufacturerLocationId: factory.id,
    factoryId: factory.id,
    location: `${factory.city}, ${factory.country}`,
  });

  const flushIfOpen = <T>(requests: any[], body: T): void => {
    requests.forEach((req) => {
      if (!(req as any).cancelled) {
        req.flush(body);
      }
    });
  };

  const setViewport = (width: number, height: number): void => {
    if (typeof window.resizeTo === 'function') {
      window.resizeTo(width, height);
    } else {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
    }
    window.dispatchEvent(new Event('resize'));
  };

  beforeEach(async () => {
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

    spyOn(FluorescenceMapMapComponent.prototype as any, 'createMap').and.returnValue(createMapStub());
    spyOn(FluorescenceMapMapComponent.prototype as any, 'setupResizeObserver').and.stub();
    spyOn(FluorescenceMapMapComponent.prototype as any, 'setupFullscreenListeners').and.stub();
    spyOn(FluorescenceMapMapComponent.prototype as any, 'zoomToEntity').and.stub();
    spyOn(FluorescenceMapMapComponent.prototype as any, 'getNodePosition').and.returnValue({ top: 100, left: 100 });

    spyOn(window, 'fetch').and.callFake(async () => {
      return new Response(JSON.stringify(emptyState), { status: 200 });
    });

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
    const httpMock = TestBed.inject(HttpTestingController);
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
    const clients = httpMock.match((req) => req.url.toLowerCase().includes('/clients'));
    flushIfOpen(clients, { items: [] });
    const projects = httpMock.match((req) => req.url.toLowerCase().includes('/projects'));
    flushIfOpen(projects, { items: [] });
    const manufacturers = httpMock.match((req) => req.url.toLowerCase().includes('/manufacturers'));
    flushIfOpen(manufacturers, { items: [] });
    const locations = httpMock.match((req) => req.url.toLowerCase().includes('/locations'));
    flushIfOpen(locations, { items: [] });
  });

  it('reflects fullscreen pressed state on toolbar button', () => {
    const fullscreenBtn = fixture.debugElement.query(By.css('.fleet-header-actions button[aria-label="Toggle fullscreen"]'))
      ?.nativeElement as HTMLButtonElement | null;
    expect(fullscreenBtn).toBeTruthy();
    expect(fullscreenBtn?.getAttribute('aria-pressed')).toBe('false');

    component.onMapFullscreenChange(true);
    fixture.detectChanges();
    expect(fullscreenBtn?.getAttribute('aria-pressed')).toBe('true');

    component.onMapFullscreenChange(false);
    fixture.detectChanges();
    expect(fullscreenBtn?.getAttribute('aria-pressed')).toBe('false');
  });

  it('opens filter overlay from toolbar and closes on cancel', () => {
    const filterBtn = fixture.debugElement.query(By.css('.fleet-header-actions button[aria-label="Toggle filters"]'))
      ?.nativeElement as HTMLButtonElement | null;
    expect(filterBtn).toBeTruthy();
    expect(fixture.debugElement.query(By.css('#war-room-filters-panel'))).toBeNull();

    filterBtn?.click();
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('#war-room-filters-panel'))).toBeTruthy();

    const cancelButton = fixture.debugElement.query(
      By.css('#war-room-filters-panel .fleet-filter-overlay-footer .btn.btn-outline-primary')
    )?.nativeElement as HTMLButtonElement | null;
    expect(cancelButton).toBeTruthy();
    cancelButton?.click();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('#war-room-filters-panel'))).toBeNull();
  });

  it('hides client-only war room controls for restricted roles', fakeAsync(() => {
    const assertRestricted = (): void => {
      // Top toolbar: Clients mode tab + add/edit controls hidden
      const modeTabLabels = Array.from(
        fixture.nativeElement.querySelectorAll('.fleet-mode-tabs button') as NodeListOf<HTMLButtonElement>
      ).map((el) => (el.textContent ?? '').trim());
      expect(modeTabLabels).not.toContain('Clients');
      expect(fixture.debugElement.query(By.css('.map-add-project-btn'))).toBeNull();

      // Sidebar: Edit Mode hidden
      expect(fixture.debugElement.query(By.css('.sidebar-edit-toggle'))).toBeNull();

      // Filters: Client filter section hidden
      component.openFiltersPanel();
      fixture.detectChanges();
      const filterLabels = Array.from(
        fixture.nativeElement.querySelectorAll('#war-room-filters-panel .filter-section-header .form-label') as NodeListOf<HTMLElement>
      ).map((el) => (el.textContent ?? '').trim());
      expect(filterLabels).not.toContain('Client');
    };

    authUserSubject.next({
      userId: 2,
      username: 'test-client',
      role: 'client',
      clientId: 2,
      isGeneralAdmin: false,
    });
    fixture.detectChanges();
    tick(0);
    fixture.detectChanges();
    assertRestricted();

    authUserSubject.next({
      userId: 3,
      username: 'test-user',
      role: 'user',
      clientId: 3,
      isGeneralAdmin: false,
    });
    fixture.detectChanges();
    tick(0);
    fixture.detectChanges();
    assertRestricted();
  }));

  it('forces project view when restoring client mode for restricted users', () => {
    fixture.destroy();
    localStorage.clear();
    // Persisted state with client view mode should be forced to project view for restricted roles.
    localStorage.setItem('war-room-state-v1', JSON.stringify({ mapViewMode: 'client' }));
    warRoomService.setMapViewMode('project');

    authUserSubject.next({
      userId: 4,
      username: 'restricted',
      role: 'client',
      clientId: 4,
      isGeneralAdmin: false,
    });

    fixture = TestBed.createComponent(FluorescenceMapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const httpMock = TestBed.inject(HttpTestingController);
    flushIfOpen(httpMock.match((req) => req.url.toLowerCase().includes('/clients')), { items: [] });
    flushIfOpen(httpMock.match((req) => req.url.toLowerCase().includes('/projects')), { items: [] });
    flushIfOpen(httpMock.match((req) => req.url.toLowerCase().includes('/manufacturers')), { items: [] });
    flushIfOpen(httpMock.match((req) => req.url.toLowerCase().includes('/locations')), { items: [] });

    expect(warRoomService.mapViewMode()).toBe('project');
  });

  const resetServiceState = (): void => {
    const serviceAny = warRoomService as any;
    serviceAny._parentGroups.set([]);
    serviceAny._activityLogs.set([]);
    serviceAny._transitRoutes.set([]);
    serviceAny._mapViewMode.set('project');
    serviceAny._selectedEntity.set(null);
  };

  it('opens add-company state on mobile and supports preselection', fakeAsync(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
    resetServiceState();
    setViewport(360, 640);
    tick(100);

    component.onAddCompanyRequested();
    fixture.detectChanges();
    expect(component.addCompanyModalVisible()).toBeTrue();
    expect(component.addCompanyModalPreselectedManufacturerLocationId()).toBeNull();

    component.onAddProjectForFactory({ factoryId: 'factory-mobile', subsidiaryId: 'sub-1' });
    fixture.detectChanges();
    expect(component.addCompanyModalVisible()).toBeTrue();
    expect(component.addCompanyModalPreselectedManufacturerLocationId()).toBe('factory-mobile');

    component.onAddCompanyModalClose();
    tick(100);
    fixture.detectChanges();
    expect(component.addCompanyModalVisible()).toBeFalse();
    expect(component.addCompanyModalPreselectedManufacturerLocationId()).toBeNull();
  }));

  it('handles responsive map panels and filter wrapping', fakeAsync(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
    resetServiceState();
    setViewport(480, 720);
    tick(100);

    const factories = Array.from({ length: 8 }).map((_, index) =>
      buildFactory({ id: `factory-${index}`, subsidiaryId: 'sub-1', city: `City ${index}` })
    );
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories });
    const parentGroup = buildParentGroup([subsidiary]);

    const serviceAny = warRoomService as any;
    serviceAny._parentGroups.set([parentGroup]);
    serviceAny._activityLogs.set(
      factories.flatMap((factory, index) => Array.from({ length: 3 }).map((_, logIndex) => buildLog(factory, subsidiary, index + logIndex)))
    );

    component.showPanel('log');
    component.filterApplied.set({
      status: 'active',
      regions: ['North America'],
      clientIds: [],
      manufacturerIds: [],
      projectTypeIds: [],
      projectIds: [],
    });
    fixture.detectChanges();

    const activeFilters = fixture.nativeElement.querySelector('.active-filters-bar') as HTMLElement;
    expect(getComputedStyle(activeFilters).flexWrap).toBe('wrap');

    document.body.style.zoom = '2';
    fixture.detectChanges();
    tick(0);

    const modeTabs = fixture.nativeElement.querySelector('.fleet-mode-tabs') as HTMLElement;
    expect(modeTabs).toBeTruthy();
    const toggleRect = modeTabs.getBoundingClientRect();
    expect(toggleRect.right).toBeLessThanOrEqual(window.innerWidth + 2);
    expect(modeTabs.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth + 2);

    document.body.style.zoom = '';
  }));

  it('exposes keyboard/screen reader attributes and restores focus after modal close', fakeAsync(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
    resetServiceState();
    setViewport(1024, 768);
    tick(100);

    const factoryA = buildFactory({ id: 'factory-a', subsidiaryId: 'sub-1' });
    const subsidiary = buildSubsidiary({ id: 'sub-1', factories: [factoryA] });
    const parentGroup = buildParentGroup([subsidiary]);

    const serviceAny = warRoomService as any;
    serviceAny._parentGroups.set([parentGroup]);
    serviceAny._activityLogs.set([buildLog(factoryA, subsidiary, 0)]);
    warRoomService.setMapViewMode('factory');

    component.showPanel('log');
    fixture.detectChanges();

    const announcer = fixture.nativeElement.querySelector('.visually-hidden[aria-live="polite"]');
    expect(announcer).toBeTruthy();

    const radiogroup = fixture.nativeElement.querySelector('.fleet-mode-tabs[role="tablist"]');
    expect(radiogroup).toBeTruthy();
    const tabs = fixture.nativeElement.querySelectorAll('.fleet-mode-tabs button');
    expect(tabs.length).toBeGreaterThanOrEqual(2);

    const mapControls = fixture.nativeElement.querySelectorAll('.map-control-btn');
    mapControls.forEach((btn: HTMLButtonElement) => {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    });

    const logEntry = fixture.nativeElement.querySelector('.subsidiary-entry') as HTMLElement;
    if (logEntry) {
      expect(logEntry.getAttribute('tabindex')).toBe('0');
    }

    const addButton = fixture.nativeElement.querySelector('.fleet-header-actions button[aria-label="Toggle filters"]') as HTMLButtonElement;
    expect(addButton).toBeTruthy();
    addButton.focus();
    component.onAddCompanyRequested();
    fixture.detectChanges();
    expect(component.addCompanyModalVisible()).toBeTrue();

    component.onAddCompanyModalClose();
    tick(100);
    fixture.detectChanges();

    expect(component.addCompanyModalVisible()).toBeFalse();
    expect(document.activeElement).toBe(addButton);
  }));
});
