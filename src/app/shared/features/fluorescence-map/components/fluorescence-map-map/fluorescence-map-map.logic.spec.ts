import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { signal } from '@angular/core';
import { WarRoomMapComponent } from './fluorescence-map-map.component';
import { WarRoomMapMathService } from './services/fluorescence-map-map-math.service';
import { WarRoomService } from '../../../../../shared/services/fluorescence-map.service';
import { AppStateService } from '../../../../../shared/services/app-state.service';
import { ToastrService } from 'ngx-toastr';

describe('WarRoomMapComponent logic helpers', () => {
  let component: WarRoomMapComponent;
  let mathService: WarRoomMapMathService;

  beforeEach(async () => {
    const warRoomServiceMock = {
      panToEntity: signal(null),
      hoveredEntity: signal(null),
      factories: signal([]),
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

    await TestBed.configureTestingModule({
      imports: [WarRoomMapComponent],
      providers: [
        { provide: WarRoomService, useValue: warRoomServiceMock },
        { provide: AppStateService, useValue: appStateServiceMock },
        { provide: ToastrService, useValue: toastrMock },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(WarRoomMapComponent);
    component = fixture.componentInstance;
    mathService = TestBed.inject(WarRoomMapMathService);
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

  it('buildRouteFeatures resolves coordinates and defaults strokeWidth', () => {
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
    (component as any).transitRoutes = signal([{
      id: 'route-1',
      from: 'factory-1',
      to: 'factory-2',
      fromCoordinates: { latitude: 10, longitude: 20 },
      toCoordinates: { latitude: 30, longitude: 40 },
    }]);

    const features = (component as any).buildRouteFeatures([nodeA, nodeB]);
    expect(features.features.length).toBe(1);
    expect(features.features[0].geometry.coordinates[0]).toEqual([20, 10]);
    expect(features.features[0].geometry.coordinates[1]).toEqual([40, 30]);
    expect(features.features[0].properties.strokeWidth).toBe(1.5);
    expect(features.features[0].properties.highlighted).toBeTrue();
  });

  it('getEffectiveCoordinates prefers exact project-route endpoint coordinates over node/transit coordinates', () => {
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

    const coords = (component as any).getEffectiveCoordinates(node, [node]);
    expect(coords).toEqual({ latitude: 55.55, longitude: -77.77 });
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
});
