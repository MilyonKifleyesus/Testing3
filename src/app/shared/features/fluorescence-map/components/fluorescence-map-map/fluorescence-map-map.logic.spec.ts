import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { signal } from '@angular/core';
import { FluorescenceMapMapComponent } from './fluorescence-map-map.component';
import { FluorescenceMapMathService } from './services/fluorescence-map-map-math.service';
import { WarRoomService } from '../../../../../shared/services/fluorescence-map.service';
import { AppStateService } from '../../../../../shared/services/app-state.service';
import { ToastrService } from 'ngx-toastr';

describe('FluorescenceMapMapComponent logic helpers', () => {
  let component: FluorescenceMapMapComponent;
  let mathService: FluorescenceMapMathService;
  let toastr: { success: jasmine.Spy; error: jasmine.Spy; info: jasmine.Spy; warning: jasmine.Spy };

  beforeEach(() => {
    const warRoomServiceMock = {
      panToEntity: signal(null),
      hoveredEntity: signal(null),
      manufacturerLocations: signal([]),
      setHoveredEntity: jasmine.createSpy('setHoveredEntity'),
    };

    const appStateServiceMock = {
      state$: new BehaviorSubject({
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
        backgroundImage: '',
      }),
    };

    const toastrMock = {
      success: jasmine.createSpy('success'),
      error: jasmine.createSpy('error'),
      info: jasmine.createSpy('info'),
      warning: jasmine.createSpy('warning'),
    };

    return TestBed.configureTestingModule({
      imports: [FluorescenceMapMapComponent],
      providers: [
        { provide: WarRoomService, useValue: warRoomServiceMock },
        { provide: AppStateService, useValue: appStateServiceMock },
        { provide: ToastrService, useValue: toastrMock },
      ],
    }).compileComponents();
  });

  beforeEach(() => {
    const fixture = TestBed.createComponent(FluorescenceMapMapComponent);
    component = fixture.componentInstance;
    mathService = TestBed.inject(FluorescenceMapMathService);
    toastr = TestBed.inject(ToastrService) as unknown as {
      success: jasmine.Spy;
      error: jasmine.Spy;
      info: jasmine.Spy;
      warning: jasmine.Spy;
    };
  });

  it('getPinLodState returns logo-only below the logo threshold', () => {
    const state = (component as any).getPinLodState(1.0, false);
    expect(state.isLogoOnly).toBeTrue();
    expect(state.isCompactLogo).toBeFalse();
    expect(state.isFullDetail).toBeFalse();
    expect(state.lodClass).toBe('lod-low');
  });

  it('getPinLodState returns compact between thresholds', () => {
    const state = (component as any).getPinLodState(1.5, false);
    expect(state.isLogoOnly).toBeFalse();
    expect(state.isCompactLogo).toBeTrue();
    expect(state.isFullDetail).toBeFalse();
    expect(state.lodClass).toBe('lod-medium');
  });

  it('getPinLodState returns full at or above full-detail threshold', () => {
    const state = (component as any).getPinLodState(3.0, false);
    expect(state.isLogoOnly).toBeFalse();
    expect(state.isCompactLogo).toBeFalse();
    expect(state.isFullDetail).toBeTrue();
    expect(state.lodClass).toBe('lod-high');
  });

  it('getPinLodState forces full detail when selected', () => {
    const state = (component as any).getPinLodState(1.0, true);
    expect(state.isFullDetail).toBeTrue();
    expect(state.lodClass).toBe('lod-high');
  });

  it('projectLatLngToMapSpace scales linearly with viewBox size', () => {
    const baseViewBox = { x: 0, y: 0, width: 950, height: 550 };
    const scaledViewBox = { x: 0, y: 0, width: 1900, height: 1100 };

    const basePoint = mathService.projectLatLngToMapSpace(10, 20, baseViewBox);
    const scaledPoint = mathService.projectLatLngToMapSpace(10, 20, scaledViewBox);

    expect(scaledPoint.x).toBeCloseTo(basePoint.x * 2, 4);
    expect(scaledPoint.y).toBeCloseTo(basePoint.y * 2, 4);
  });

  it('projectLatLngToMapSpace respects viewBox offsets', () => {
    const baseViewBox = { x: 0, y: 0, width: 950, height: 550 };
    const offsetViewBox = { x: -100, y: -50, width: 950, height: 550 };

    const basePoint = mathService.projectLatLngToMapSpace(10, 20, baseViewBox);
    const offsetPoint = mathService.projectLatLngToMapSpace(10, 20, offsetViewBox);

    expect(offsetPoint.x).toBeCloseTo(basePoint.x - 100, 4);
    expect(offsetPoint.y).toBeCloseTo(basePoint.y - 50, 4);
  });

  it('syncOverlays resolves transit route coordinates and defaults strokeWidth', async () => {
    const nodeA = {
      id: 'factory-1',
      name: 'Factory One',
      company: 'Factory One',
      companyId: 'factory-1',
      city: 'Alpha',
      coordinates: { latitude: 10, longitude: 20 },
      type: 'Factory',
      status: 'ACTIVE',
      level: 'factory',
    } as any;

    const nodeB = {
      id: 'factory-2',
      name: 'Factory Two',
      company: 'Factory Two',
      companyId: 'factory-2',
      city: 'Beta',
      coordinates: { latitude: 30, longitude: 40 },
      type: 'Factory',
      status: 'ACTIVE',
      level: 'factory',
    } as any;

    (component as any).nodes = signal([nodeA, nodeB]);
    (component as any).selectedEntity = signal({ level: 'factory', id: 'factory-1' });
    (component as any).projectRoutes = signal([]);
    (component as any).transitRoutes = signal([{
      id: 'route-1',
      from: 'factory-1',
      to: 'factory-2',
      fromCoordinates: { latitude: 10, longitude: 20 },
      toCoordinates: { latitude: 30, longitude: 40 },
    }]);

    (component as any).filterStatus = signal('all');
    (component as any).mapLoaded = true;
    (component as any).destroyed = false;
    (component as any).mapInstance = {
      getZoom: () => 4,
      project: ([lng, lat]: [number, number]) => ({ x: lng * 10, y: lat * 10 }),
      remove: () => undefined,
    };

    await (component as any).syncOverlays(false);

    const routes = (component as any).routesVm() as Array<{
      start: { x: number; y: number };
      end: { x: number; y: number };
      strokeWidth: number;
      highlighted: boolean;
    }>;

    expect(routes.length).toBe(1);
    expect(routes[0].start).toEqual({ x: 200, y: 100 });
    expect(routes[0].end).toEqual({ x: 400, y: 300 });
    expect(routes[0].strokeWidth).toBe(1.5);
    expect(routes[0].highlighted).toBeTrue();
  });

  it('syncOverlays prefers exact project-route endpoint coordinates over node/transit coordinates', async () => {
    const node = {
      id: 'factory-1',
      name: 'Factory One',
      company: 'Factory One',
      companyId: 'factory-1',
      city: 'Alpha',
      coordinates: { latitude: 10, longitude: 20 },
      type: 'Factory',
      status: 'ACTIVE',
      level: 'factory',
      factoryId: 'factory-1',
    } as any;

    (component as any).projectRoutes = signal([{
      id: 'project-route-1',
      projectId: 'p1',
      fromNodeId: 'client-1',
      toNodeId: 'factory-1',
      status: 'Open',
      fromCoordinates: { latitude: 1, longitude: 2 },
      toCoordinates: { latitude: 55.55, longitude: -77.77 },
    }]);
    (component as any).transitRoutes = signal([{
      id: 'transit-route-1',
      from: 'factory-1',
      to: 'other-node',
      fromCoordinates: { latitude: 88.88, longitude: 99.99 },
      toCoordinates: { latitude: 33.33, longitude: 44.44 },
    }]);

    (component as any).nodes = signal([node]);
    (component as any).selectedEntity = signal(null);
    (component as any).filterStatus = signal('all');
    (component as any).mapLoaded = true;
    (component as any).destroyed = false;
    (component as any).mapInstance = {
      getZoom: () => 4,
      project: ([lng, lat]: [number, number]) => ({ x: lng * 10, y: lat * 10 }),
      remove: () => undefined,
    };

    await (component as any).syncOverlays(false);

    const markers = (component as any).markersVm() as Array<{
      id: string;
      displayCoordinates?: { latitude: number; longitude: number };
    }>;
    expect(markers.length).toBe(1);
    expect(markers[0].id).toBe('factory-1');
    expect(markers[0].displayCoordinates).toEqual({ latitude: 55.55, longitude: -77.77 });
  });

  it('syncOverlays keeps route start/end locked to marker pixel coordinates when endpoint IDs resolve', async () => {
    const nodeA = {
      id: 'client-1',
      name: 'Client One',
      company: 'Client One',
      companyId: 'client-1',
      city: 'Alpha',
      coordinates: { latitude: 10, longitude: 20 },
      type: 'Terminal',
      status: 'ACTIVE',
      level: 'client',
      clientId: 'client-1',
    } as any;

    const nodeB = {
      id: 'factory-1',
      name: 'Factory One',
      company: 'Factory One',
      companyId: 'factory-1',
      city: 'Beta',
      coordinates: { latitude: 30, longitude: 40 },
      type: 'Factory',
      status: 'ACTIVE',
      level: 'factory',
      factoryId: 'factory-1',
    } as any;

    const projectRoute = {
      id: 'project-route-1',
      projectId: 'p1',
      fromNodeId: 'client-1',
      toNodeId: 'factory-1',
      status: 'Open',
      fromCoordinates: { latitude: 11, longitude: 21 },
      toCoordinates: { latitude: 12, longitude: 22 },
    };

    (component as any).nodes = signal([nodeA, nodeB]);
    (component as any).selectedEntity = signal(null);
    (component as any).projectRoutes = signal([projectRoute]);
    (component as any).transitRoutes = signal([]);
    (component as any).filterStatus = signal('all');
    (component as any).mapLoaded = true;
    (component as any).destroyed = false;
    (component as any).mapInstance = {
      getZoom: () => 4,
      project: ([lng, lat]: [number, number]) => ({ x: lng * 10, y: lat * 10 }),
      remove: () => undefined,
    };

    await (component as any).syncOverlays(false);

    const markerPixels = (component as any).markerPixelCoordinates() as Map<string, { x: number; y: number }>;
    const routes = (component as any).routesVm() as Array<{ start: { x: number; y: number }; end: { x: number; y: number } }>;

    const expectedStart = markerPixels.get('factory-1');
    const expectedEnd = markerPixels.get('client-1');
    expect(routes.length).toBe(1);
    expect(expectedStart).toBeTruthy();
    expect(expectedEnd).toBeTruthy();
    expect(routes[0].start).toEqual(expectedStart!);
    expect(routes[0].end).toEqual(expectedEnd!);
  });

  it('syncOverlays keeps parallel route endpoints locked to marker center', async () => {
    const nodeA = {
      id: 'client-1',
      name: 'Client One',
      company: 'Client One',
      companyId: 'client-1',
      city: 'Alpha',
      coordinates: { latitude: 10, longitude: 20 },
      type: 'Terminal',
      status: 'ACTIVE',
      level: 'client',
      clientId: 'client-1',
    } as any;

    const nodeB = {
      id: 'factory-1',
      name: 'Factory One',
      company: 'Factory One',
      companyId: 'factory-1',
      city: 'Beta',
      coordinates: { latitude: 30, longitude: 40 },
      type: 'Factory',
      status: 'ACTIVE',
      level: 'factory',
      factoryId: 'factory-1',
    } as any;

    const projectRoutes = [
      {
        id: 'project-route-1',
        projectId: 'p1',
        fromNodeId: 'client-1',
        toNodeId: 'factory-1',
        status: 'Open',
        fromCoordinates: { latitude: 11, longitude: 21 },
        toCoordinates: { latitude: 12, longitude: 22 },
      },
      {
        id: 'project-route-2',
        projectId: 'p2',
        fromNodeId: 'client-1',
        toNodeId: 'factory-1',
        status: 'Closed',
        fromCoordinates: { latitude: 11, longitude: 21 },
        toCoordinates: { latitude: 12, longitude: 22 },
      },
    ];

    (component as any).nodes = signal([nodeA, nodeB]);
    (component as any).selectedEntity = signal(null);
    (component as any).projectRoutes = signal(projectRoutes);
    (component as any).transitRoutes = signal([]);
    (component as any).filterStatus = signal('all');
    (component as any).mapLoaded = true;
    (component as any).destroyed = false;
    (component as any).mapInstance = {
      getZoom: () => 4,
      project: ([lng, lat]: [number, number]) => ({ x: lng * 10, y: lat * 10 }),
      remove: () => undefined,
    };

    await (component as any).syncOverlays(false);

    const markerPixels = (component as any).markerPixelCoordinates() as Map<string, { x: number; y: number }>;
    const routes = (component as any).routesVm() as Array<{
      start: { x: number; y: number };
      end: { x: number; y: number };
      path: string;
    }>;

    const expectedStart = markerPixels.get('factory-1');
    const expectedEnd = markerPixels.get('client-1');
    expect(routes.length).toBe(2);
    expect(expectedStart).toBeTruthy();
    expect(expectedEnd).toBeTruthy();
    routes.forEach((route) => {
      expect(route.start).toEqual(expectedStart!);
      expect(route.end).toEqual(expectedEnd!);
    });
    expect(routes[0].path).not.toBe(routes[1].path);
  });

  it('syncOverlays generates unique render keys for colliding API ids across node roles', async () => {
    const clientNode = {
      id: '21',
      name: 'Client One',
      company: 'Client One',
      companyId: '21',
      city: 'Alpha',
      coordinates: { latitude: 10, longitude: 20 },
      type: 'Terminal',
      status: 'ACTIVE',
      level: 'client',
      clientId: '21',
    } as any;

    const manufacturerNode = {
      id: '21',
      name: 'Factory One',
      company: 'Factory One',
      companyId: '21',
      city: 'Beta',
      coordinates: { latitude: 30, longitude: 40 },
      type: 'Factory',
      status: 'ACTIVE',
      level: 'manufacturer',
      manufacturerLocationId: '21',
      factoryId: '21',
    } as any;

    (component as any).nodes = signal([clientNode, manufacturerNode]);
    (component as any).selectedEntity = signal(null);
    (component as any).projectRoutes = signal([]);
    (component as any).transitRoutes = signal([]);
    (component as any).filterStatus = signal('all');
    (component as any).mapLoaded = true;
    (component as any).destroyed = false;
    (component as any).mapInstance = {
      getZoom: () => 4,
      project: ([lng, lat]: [number, number]) => ({ x: lng * 10, y: lat * 10 }),
      remove: () => undefined,
    };

    await (component as any).syncOverlays(false);

    const markers = (component as any).markersVm() as Array<{ renderKey: string }>;
    const renderKeys = markers.map((marker) => marker.renderKey);
    expect(markers.length).toBe(2);
    expect(new Set(renderKeys).size).toBe(2);
    expect(renderKeys).toContain('client:21');
    expect(renderKeys).toContain('manufacturer:21');
  });

  it('syncOverlays renders marker when node has no base coordinates but project route coordinates exist', async () => {
    const factoryNode = {
      id: 'factory-1',
      name: 'Factory One',
      company: 'Factory One',
      companyId: 'factory-1',
      city: 'Beta',
      coordinates: null,
      type: 'Factory',
      status: 'ACTIVE',
      level: 'factory',
      factoryId: 'factory-1',
    } as any;

    const projectRoute = {
      id: 'project-route-1',
      projectId: 'p1',
      fromNodeId: 'client-1',
      toNodeId: 'factory-1',
      status: 'Open',
      fromCoordinates: { latitude: 11, longitude: 21 },
      toCoordinates: { latitude: 12, longitude: 22 },
    };

    (component as any).nodes = signal([factoryNode]);
    (component as any).selectedEntity = signal(null);
    (component as any).projectRoutes = signal([projectRoute]);
    (component as any).transitRoutes = signal([]);
    (component as any).filterStatus = signal('all');
    (component as any).mapLoaded = true;
    (component as any).destroyed = false;
    (component as any).mapInstance = {
      getZoom: () => 4,
      project: ([lng, lat]: [number, number]) => ({ x: lng * 10, y: lat * 10 }),
      remove: () => undefined,
    };

    await (component as any).syncOverlays(false);

    const markers = (component as any).markersVm() as Array<{ id: string }>;
    const markerPixels = (component as any).markerPixelCoordinates() as Map<string, { x: number; y: number }>;

    expect(markers.length).toBe(1);
    expect(markers[0].id).toBe('factory-1');
    expect(markerPixels.get('factory-1')).toEqual({ x: 220, y: 120 });
  });

  it('syncOverlays resolves numeric project endpoint ids to loc-prefixed manufacturer nodes', async () => {
    const factoryNode = {
      id: 'loc-30',
      name: 'Factory Thirty',
      company: 'Factory Thirty',
      companyId: 'loc-30',
      city: 'Beta',
      coordinates: null,
      type: 'Factory',
      status: 'ACTIVE',
      level: 'manufacturer',
      manufacturerLocationId: 'loc-30',
      factoryId: 'loc-30',
    } as any;

    const projectRoute = {
      id: 'project-route-30',
      projectId: 'p30',
      fromNodeId: 'client-1',
      toNodeId: '30',
      status: 'Open',
      fromCoordinates: { latitude: 11, longitude: 21 },
      toCoordinates: { latitude: 12, longitude: 22 },
    };

    (component as any).nodes = signal([factoryNode]);
    (component as any).selectedEntity = signal(null);
    (component as any).projectRoutes = signal([projectRoute]);
    (component as any).transitRoutes = signal([]);
    (component as any).filterStatus = signal('all');
    (component as any).mapLoaded = true;
    (component as any).destroyed = false;
    (component as any).mapInstance = {
      getZoom: () => 4,
      project: ([lng, lat]: [number, number]) => ({ x: lng * 10, y: lat * 10 }),
      remove: () => undefined,
    };

    await (component as any).syncOverlays(false);

    const markers = (component as any).markersVm() as Array<{ id: string }>;
    const markerPixels = (component as any).markerPixelCoordinates() as Map<string, { x: number; y: number }>;

    expect(markers.length).toBe(1);
    expect(markers[0].id).toBe('loc-30');
    expect(markerPixels.get('loc-30')).toEqual({ x: 220, y: 120 });
  });

  it('dismissMapError sets mapErrorDismissed so overlay can be hidden', () => {
    (component as any).mapLoadError.set('Map failed');
    expect(component.mapErrorDismissed()).toBeFalse();
    component.dismissMapError();
    expect(component.mapErrorDismissed()).toBeTrue();
  });

  it('retryMapLoad does nothing when mapErrorUnrecoverable is true', () => {
    (component as any).mapLoadError.set('WebGL disabled');
    (component as any).mapErrorUnrecoverable.set(true);
    component.retryMapLoad();
    expect(component.mapLoadError()).toBe('WebGL disabled');
    expect(component.mapErrorUnrecoverable()).toBeTrue();
  });

  it('isUnrecoverableMapError detects GL_VENDOR disabled errors', () => {
    const fn = (component as any).isUnrecoverableMapError.bind(component);
    expect(fn('Error', 'GL_VENDOR is disabled')).toBeTrue();
    expect(fn('WebGL disabled', '')).toBeTrue();
    expect(fn('Could not create WebGL context', '')).toBeTrue();
    expect(fn('Network timeout', '')).toBeFalse();
  });

  it('emits userInteracted for user-originated map events but not for programmatic zoom', () => {
    const handlers = new Map<string, Array<(event?: unknown) => void>>();
    const mapStub = {
      on: (event: string, cb: (event?: unknown) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
        return mapStub;
      },
      once: (_event: string, _cb: (event?: unknown) => void) => mapStub,
      off: (_event: string, _cb: (event?: unknown) => void) => mapStub,
      remove: () => undefined,
      setStyle: () => undefined,
      getZoom: () => 4,
      getCenter: () => ({ lng: 0, lat: 0 }),
      flyTo: () => undefined,
      project: ([lng, lat]: [number, number]) => ({ x: lng * 10, y: lat * 10 }),
      getContainer: () => document.createElement('div'),
      easeTo: () => undefined,
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      zoomTo: () => undefined,
      fitBounds: () => undefined,
      triggerRepaint: () => undefined,
      getCanvas: () => document.createElement('canvas'),
    } as any;

    spyOn(component as any, 'isWebglSupported').and.returnValue(true);
    spyOn(component as any, 'getMapContainer').and.returnValue({
      getBoundingClientRect: () => ({ width: 320, height: 240 }),
    } as any);
    spyOn(component as any, 'createMap').and.returnValue(mapStub);
    const emitSpy = spyOn(component.userInteracted, 'emit');

    (component as any).initMap();
    handlers.get('movestart')?.[0]?.({ originalEvent: new Event('mousedown') });
    expect(emitSpy).toHaveBeenCalled();

    emitSpy.calls.reset();
    component.zoomToEntity('missing-node');
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('cancels scheduled initMap start timer on destroy', fakeAsync(() => {
    const initSpy = spyOn(component as any, 'initMap');
    spyOn(component as any, 'setupResizeObserver').and.stub();
    spyOn(component as any, 'setupFullscreenListeners').and.stub();

    component.ngAfterViewInit();
    component.ngOnDestroy();
    tick(1);

    expect(initSpy).not.toHaveBeenCalled();
  }));

  it('does not show blocking overlay for recoverable runtime map errors', () => {
    const handlers = new Map<string, Array<(event?: unknown) => void>>();
    const mapStub = {
      on: (event: string, cb: (event?: unknown) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
        return mapStub;
      },
      remove: () => undefined,
      getContainer: () => document.createElement('div'),
    } as any;

    spyOn(component as any, 'isWebglSupported').and.returnValue(true);
    spyOn(component as any, 'getMapContainer').and.returnValue({
      getBoundingClientRect: () => ({ width: 320, height: 240 }),
    } as any);
    spyOn(component as any, 'createMap').and.returnValue(mapStub);

    (component as any).initMap();
    (component as any).mapLoaded = true;
    handlers.get('error')?.[0]?.({ error: new Error('Network timeout') });

    expect(component.mapLoadError()).toBeNull();
    expect(component.mapErrorDismissed()).toBeFalse();
    expect(toastr.warning).toHaveBeenCalled();
  });

  it('shows blocking overlay for pre-load fatal map errors', () => {
    const handlers = new Map<string, Array<(event?: unknown) => void>>();
    const mapStub = {
      on: (event: string, cb: (event?: unknown) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
        return mapStub;
      },
      remove: () => undefined,
      getContainer: () => document.createElement('div'),
    } as any;

    spyOn(component as any, 'isWebglSupported').and.returnValue(true);
    spyOn(component as any, 'getMapContainer').and.returnValue({
      getBoundingClientRect: () => ({ width: 320, height: 240 }),
    } as any);
    spyOn(component as any, 'createMap').and.returnValue(mapStub);

    (component as any).initMap();
    (component as any).mapLoaded = false;
    handlers.get('error')?.[0]?.({ error: new Error('Could not create WebGL context') });

    expect(component.mapLoadError()).toBe('Could not create WebGL context');
    expect(component.mapErrorDismissed()).toBeFalse();
    expect(component.mapErrorUnrecoverable()).toBeTrue();
  });
});
