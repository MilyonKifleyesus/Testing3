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
    statusIconPath: 'M 0 0',
    lodClass: 'lod-medium',
    isPinned: false,
    pinTransform: 'translate(100, 200)',
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
});
