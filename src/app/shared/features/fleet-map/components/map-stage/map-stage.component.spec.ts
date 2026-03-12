import { ComponentFixture, TestBed } from '@angular/core/testing';
import maplibregl from 'maplibre-gl';
import type {
  ApiClient,
  ApiLocation,
  ApiManufacturer,
  FleetSelectedEntity,
} from '../../models/fleet-map.models';
import { MapStageComponent } from './map-stage.component';

class FakeMarker {
  private readonly element: HTMLElement;

  constructor(options?: { element?: HTMLElement }) {
    this.element = options?.element ?? document.createElement('div');
  }

  setLngLat(): this {
    return this;
  }

  addTo(): this {
    return this;
  }

  remove(): void {
    // No-op for tests.
  }

  getElement(): HTMLElement {
    return this.element;
  }
}

class FakeMap {
  readonly on = jasmine.createSpy('on');
  readonly off = jasmine.createSpy('off');
  readonly remove = jasmine.createSpy('remove');
  readonly setStyle = jasmine.createSpy('setStyle');
  readonly setRenderWorldCopies = jasmine.createSpy('setRenderWorldCopies');
  readonly setMaxBounds = jasmine.createSpy('setMaxBounds');
  readonly getSource = jasmine.createSpy('getSource').and.returnValue(undefined);
  readonly getLayer = jasmine.createSpy('getLayer').and.returnValue(undefined);
  readonly addSource = jasmine.createSpy('addSource');
  readonly addLayer = jasmine.createSpy('addLayer');
  readonly setPaintProperty = jasmine.createSpy('setPaintProperty');
  readonly easeTo = jasmine.createSpy('easeTo');
  readonly zoomIn = jasmine.createSpy('zoomIn');
  readonly zoomOut = jasmine.createSpy('zoomOut');
  readonly project = jasmine.createSpy('project').and.callFake(([lng, lat]: [number, number]) => ({ x: lng, y: lat }));
  readonly unproject = jasmine.createSpy('unproject').and.callFake(([x, y]: [number, number]) => ({ lng: x, lat: y }));
  readonly cameraForBounds = jasmine.createSpy('cameraForBounds').and.returnValue({
    center: { lng: -79.4, lat: 43.7 },
    zoom: 4,
  });
}

describe('MapStageComponent', () => {
  let fixture: ComponentFixture<MapStageComponent>;
  let component: MapStageComponent;
  let fakeMap: FakeMap;
  let originalMapCtor: typeof maplibregl.Map;
  let originalMarkerCtor: typeof maplibregl.Marker;
  let maplibreMutable: {
    Map: typeof maplibregl.Map;
    Marker: typeof maplibregl.Marker;
  };

  const client: ApiClient = {
    id: 'client-a',
    name: 'Client A',
    lat: 43.7,
    lng: -79.4,
    locationIds: ['location-a'],
  };

  const manufacturer: ApiManufacturer = {
    id: 'manufacturer-a',
    name: 'Manufacturer A',
    lat: 45.1,
    lng: -75.7,
    locationIds: ['location-a'],
  };

  const location: ApiLocation = {
    id: 'location-a',
    manufacturerId: 'manufacturer-a',
    name: 'Location A',
    lat: 45.1,
    lng: -75.7,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapStageComponent],
    }).compileComponents();

    fakeMap = new FakeMap();
    maplibreMutable = maplibregl as unknown as {
      Map: typeof maplibregl.Map;
      Marker: typeof maplibregl.Marker;
    };
    originalMapCtor = maplibreMutable.Map;
    originalMarkerCtor = maplibreMutable.Marker;
    (maplibreMutable as any).Map = jasmine.createSpy('Map').and.callFake(
      () => fakeMap as unknown as maplibregl.Map,
    );
    (maplibreMutable as any).Marker = jasmine.createSpy('Marker').and.callFake(
      (options?: { element?: HTMLElement }) => new FakeMarker(options) as unknown as maplibregl.Marker,
    );
    spyOn(window, 'fetch').and.returnValue(Promise.resolve({ ok: false } as Response));

    fixture = TestBed.createComponent(MapStageComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('mode', 'projects');
    fixture.componentRef.setInput('surface', 'page');
    fixture.componentRef.setInput('projects', []);
    fixture.componentRef.setInput('clients', [client]);
    fixture.componentRef.setInput('manufacturers', [manufacturer]);
    fixture.componentRef.setInput('locations', [location]);
    fixture.componentRef.setInput('isDark', false);
  });

  afterEach(() => {
    maplibreMutable.Map = originalMapCtor;
    maplibreMutable.Marker = originalMarkerCtor;
    fixture.destroy();
  });

  it('renders the selected entity details and emits null when the detail card is closed', async () => {
    const selection: FleetSelectedEntity = { kind: 'client', data: client };
    spyOn(component.selectEntity, 'emit');
    fixture.componentRef.setInput('selectedEntity', selection);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('Client A');
    expect(host.textContent).toContain('1/1 mapped locations');

    host.querySelector<HTMLButtonElement>('[aria-label="Close detail card"]')?.click();

    expect(component.selectEntity.emit).toHaveBeenCalledWith(null);
  });

  it('delegates zoom controls to the underlying map instance', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    (component as unknown as { map: FakeMap }).map = fakeMap;

    component.zoomIn();
    component.zoomOut();
    component.resetMapView();

    expect(fakeMap.zoomIn).toHaveBeenCalled();
    expect(fakeMap.zoomOut).toHaveBeenCalled();
    expect(fakeMap.easeTo).toHaveBeenCalled();
  });
});
