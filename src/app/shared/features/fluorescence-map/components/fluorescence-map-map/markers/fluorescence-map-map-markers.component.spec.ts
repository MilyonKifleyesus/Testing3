import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WarRoomMapMarkersComponent } from './fluorescence-map-map-markers.component';
import { MarkerVm } from '../fluorescence-map-map.vm';
import { Node as WarRoomNode } from '../../../../../models/fluorescence-map.interface';

describe('WarRoomMapMarkersComponent', () => {
  let fixture: ComponentFixture<WarRoomMapMarkersComponent>;

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
    node: baseNode,
    nodeType: 'factory',
    isCluster: false,
    displayName: 'NODE ONE',
    shortName: 'NODE ONE',
    subLabel: 'Test City / ACTIVE',
    initials: 'NO',
    hasLogo: true,
    logoPath: '/assets/images/logo.png',
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
      imports: [WarRoomMapMarkersComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WarRoomMapMarkersComponent);
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

  it('renders marker ring center at the exact projected coordinate', () => {
    const target = { x: 453, y: 356 };
    const pixelMap = new Map<string, { x: number; y: number }>([['node-1', target]]);
    fixture.componentRef.setInput('markers', [buildMarker({ isHovered: true, pinScale: 1.58 })]);
    fixture.componentRef.setInput('pixelCoordinates', pixelMap);
    fixture.detectChanges();

    const ring = fixture.nativeElement.querySelector('.marker-ring') as SVGCircleElement | null;
    expect(ring).toBeTruthy();

    const ringRect = ring!.getBoundingClientRect();
    const ringCenterX = ringRect.left + ringRect.width / 2;
    const ringCenterY = ringRect.top + ringRect.height / 2;

    expect(Math.abs(ringCenterX - target.x)).toBeLessThan(1.01);
    expect(Math.abs(ringCenterY - target.y)).toBeLessThan(1.01);
  });

  it('keeps label notch horizontally aligned with the projected endpoint', () => {
    const target = { x: 453, y: 356 };
    const pixelMap = new Map<string, { x: number; y: number }>([['node-1', target]]);
    fixture.componentRef.setInput('markers', [buildMarker({ isHovered: true, pinScale: 1.58, showPinLabel: true })]);
    fixture.componentRef.setInput('pixelCoordinates', pixelMap);
    fixture.detectChanges();

    const notch = fixture.nativeElement.querySelector('.tag-notch') as SVGPathElement | null;
    expect(notch).toBeTruthy();

    const notchRect = notch!.getBoundingClientRect();
    const notchCenterX = notchRect.left + notchRect.width / 2;
    expect(Math.abs(notchCenterX - target.x)).toBeLessThan(1.01);
  });
});
