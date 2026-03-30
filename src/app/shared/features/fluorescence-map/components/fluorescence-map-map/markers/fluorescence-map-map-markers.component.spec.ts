import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FluorescenceMapMapMarkersComponent } from './fluorescence-map-map-markers.component';
import { MarkerVm } from '../fluorescence-map-map.vm';
import { Node as WarRoomNode } from '../../../../../models/fluorescence-map.interface';

describe('FluorescenceMapMapMarkersComponent', () => {
  let fixture: ComponentFixture<FluorescenceMapMapMarkersComponent>;

  const baseNode: WarRoomNode = {
    id: 'node-1',
    name: 'Node One',
    company: 'Node One',
    companyId: 'node-1',
    city: 'Test City',
    coordinates: { latitude: 10, longitude: 20 },
    type: 'Facility',
    status: 'ACTIVE',
  };

  const buildMarker = (overrides: Partial<MarkerVm>): MarkerVm => ({
    id: 'node-1',
    renderKey: 'node-1',
    node: baseNode,
    nodeType: 'factory',
    isCluster: false,
    displayName: 'NODE ONE',
    shortName: 'NODE ONE',
    subLabel: 'Test City / ACTIVE',
    initials: 'NO',
    hasLogo: true,
    logoPath: '/assets/images/svgs/user.svg',
    isSelected: false,
    isHovered: false,
    isHub: false,
    isHQ: false,
    statusKey: 'online',
    statusColor: '#00FF41',
    statusGlow: 'rgba(0, 255, 65, 0.45)',
    projectStatusColor: '#00C853',
    statusIconPath: 'M 0 0',
    lodClass: 'lod-medium',
    isPinned: false,
    anchor: { width: 120, height: 180, centerX: 60, centerY: 90 },
    pinScale: 1,
    showPinLabel: true,
    ...overrides,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FluorescenceMapMapMarkersComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FluorescenceMapMapMarkersComponent);
  });

  it('applies LOD class to marker containers', () => {
    const pixelMap = new Map<string, { x: number; y: number }>();
    pixelMap.set('node-1', { x: 100, y: 200 });
    fixture.componentRef.setInput('markers', [buildMarker({ lodClass: 'lod-medium' })]);
    fixture.componentRef.setInput('pixelCoordinates', pixelMap);
    fixture.detectChanges();

    const pin = fixture.nativeElement.querySelector('.marker-group') as HTMLElement | null;
    expect(pin).toBeTruthy();
    expect(pin?.classList.contains('lod-medium')).toBeTrue();
  });

  it('renders fallback marker when logo is missing', () => {
    const pixelMap = new Map<string, { x: number; y: number }>();
    pixelMap.set('node-1', { x: 100, y: 200 });
    fixture.componentRef.setInput('markers', [buildMarker({ hasLogo: false })]);
    fixture.componentRef.setInput('pixelCoordinates', pixelMap);
    fixture.detectChanges();

    const fallback = fixture.nativeElement.querySelector('.marker-initials') as SVGTextElement | null;
    expect(fallback).toBeTruthy();
  });

  it('adds pinned class when marker is pinned', () => {
    const pixelMap = new Map<string, { x: number; y: number }>();
    pixelMap.set('node-1', { x: 100, y: 200 });
    fixture.componentRef.setInput('markers', [buildMarker({ isPinned: true })]);
    fixture.componentRef.setInput('pixelCoordinates', pixelMap);
    fixture.detectChanges();

    const pin = fixture.nativeElement.querySelector('.marker-group') as HTMLElement | null;
    expect(pin?.classList.contains('pinned')).toBeTrue();
  });

  it('uses clipPath for marker logo so logo does not drift on zoom', () => {
    const pixelMap = new Map<string, { x: number; y: number }>();
    pixelMap.set('node-1', { x: 100, y: 200 });
    fixture.componentRef.setInput('markers', [buildMarker({})]);
    fixture.componentRef.setInput('pixelCoordinates', pixelMap);
    fixture.detectChanges();

    const clipPath = fixture.nativeElement.querySelector('#logo-clip-node-1') as SVGClipPathElement | null;
    expect(clipPath).toBeTruthy();
    const circle = clipPath?.querySelector('circle');
    expect(circle).toBeTruthy();
    expect(circle?.getAttribute('cx')).toBe('0');
    expect(circle?.getAttribute('cy')).toBe('0');
    expect(circle?.getAttribute('r')).toBe('9.5');

    const markerLogo = fixture.nativeElement.querySelector('.marker-logo') as SVGGElement | null;
    expect(markerLogo).toBeTruthy();
  });

  it('renders markers with duplicate raw ids when render keys are unique', () => {
    const sharedId = '21';
    const pixelMap = new Map<string, { x: number; y: number }>([[sharedId, { x: 100, y: 200 }]]);
    const clientNode: WarRoomNode = {
      ...baseNode,
      id: sharedId,
      companyId: sharedId,
      name: 'Client Node',
      company: 'Client Node',
      level: 'client',
      clientId: sharedId,
    };
    const manufacturerNode: WarRoomNode = {
      ...baseNode,
      id: sharedId,
      companyId: sharedId,
      name: 'Manufacturer Node',
      company: 'Manufacturer Node',
      level: 'manufacturer',
      manufacturerLocationId: sharedId,
      factoryId: sharedId,
    };

    fixture.componentRef.setInput('markers', [
      buildMarker({ id: sharedId, renderKey: 'client:21', nodeType: 'client', node: clientNode }),
      buildMarker({ id: sharedId, renderKey: 'manufacturer:21', nodeType: 'factory', node: manufacturerNode }),
    ]);
    fixture.componentRef.setInput('pixelCoordinates', pixelMap);
    fixture.detectChanges();

    const containers = fixture.nativeElement.querySelectorAll('.marker-container');
    expect(containers.length).toBe(2);

    const clientClip = fixture.nativeElement.querySelector('[id="logo-clip-client-client-21"]') as SVGClipPathElement | null;
    const manufacturerClip = fixture.nativeElement.querySelector('[id="logo-clip-manufacturer-21"]') as SVGClipPathElement | null;
    expect(clientClip).toBeTruthy();
    expect(manufacturerClip).toBeTruthy();
    expect(clientClip?.id).not.toBe(manufacturerClip?.id);
  });

  it('computeTranslate uses marker anchor center for factory/client markers', () => {
    const component = fixture.componentInstance;
    const marker = buildMarker({ anchor: { width: 120, height: 180, centerX: 60, centerY: 90 } });

    const translate = component.computeTranslate(marker, { x: 453, y: 356 });
    expect(translate).toBe('translate(393px, 266px)');
  });

  it('computeTranslate uses marker anchor center for cluster markers', () => {
    const component = fixture.componentInstance;
    const marker = buildMarker({
      isCluster: true,
      anchor: { width: 48, height: 48, centerX: 24, centerY: 24 },
    });

    const translate = component.computeTranslate(marker, { x: 453, y: 356 });
    expect(translate).toBe('translate(429px, 332px)');
  });

  it('computePinScaleTransform keeps center anchored for non-cluster markers', () => {
    const component = fixture.componentInstance;
    const marker = buildMarker({ pinScale: 1.58 });

    const transform = component.computePinScaleTransform(marker);
    const match = transform.match(/^translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)$/);
    expect(match).toBeTruthy();
    expect(Number(match![1])).toBeCloseTo(17.4, 4);
    expect(Number(match![2])).toBeCloseTo(26.1, 4);
    expect(Number(match![3])).toBeCloseTo(1.58, 4);
  });

  it('computePinScaleTransform leaves clusters as plain scale', () => {
    const component = fixture.componentInstance;
    const marker = buildMarker({
      isCluster: true,
      anchor: { width: 48, height: 48, centerX: 24, centerY: 24 },
      pinScale: 1.58,
    });

    const transform = component.computePinScaleTransform(marker);
    expect(transform).toBe('scale(1.58)');
  });

  it('renders marker container transform at projected coordinate', () => {
    const target = { x: 453, y: 356 };
    const pixelMap = new Map<string, { x: number; y: number }>([['node-1', target]]);
    fixture.componentRef.setInput('markers', [buildMarker({ isHovered: true, pinScale: 1.58 })]);
    fixture.componentRef.setInput('pixelCoordinates', pixelMap);
    fixture.detectChanges();

    const container = fixture.nativeElement.querySelector('.marker-container') as HTMLElement | null;
    expect(container).toBeTruthy();
    const transform = container!.style.transform;
    expect(transform).toContain('translate(');
    const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    expect(match).toBeTruthy();
    expect(Number(match![1])).toBeCloseTo(target.x - 60, 3);
    expect(Number(match![2])).toBeCloseTo(target.y - 90, 3);
  });

  it('keeps label notch anchored in tag transform', () => {
    const target = { x: 453, y: 356 };
    const pixelMap = new Map<string, { x: number; y: number }>([['node-1', target]]);
    fixture.componentRef.setInput('markers', [buildMarker({ isHovered: true, pinScale: 1.58, showPinLabel: true })]);
    fixture.componentRef.setInput('pixelCoordinates', pixelMap);
    fixture.detectChanges();

    const tag = fixture.nativeElement.querySelector('.marker-tag') as SVGGElement | null;
    expect(tag).toBeTruthy();
    expect(tag!.getAttribute('transform')).toContain('translate(0, -20)');
  });
});
