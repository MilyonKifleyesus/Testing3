import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkerVm } from '../fluorescence-map-map.vm';
import { Node as WarRoomNode } from '../../../../../models/fluorescence-map.interface';

@Component({
  selector: 'app-fluorescence-map-map-markers',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fluorescence-map-map-markers.component.html',
  styleUrls: ['./fluorescence-map-map-markers.component.scss'],
})
export class FluorescenceMapMapMarkersComponent {
  markers = input<MarkerVm[]>([]);
  pixelCoordinates = input<Map<string, { x: number; y: number }>>(new Map());

  markerClick = output<WarRoomNode | undefined>();
  markerHover = output<WarRoomNode | null>();
  logoError = output<{ node: WarRoomNode; logoPath: string }>();

  getPosition(id: string): { x: number; y: number } {
    return this.pixelCoordinates().get(id) ?? { x: 0, y: 0 };
  }

  computeTranslate(marker: MarkerVm, pos: { x: number; y: number }): string {
    return `translate(${pos.x - marker.anchor.centerX}px, ${pos.y - marker.anchor.centerY}px)`;
  }

  /**
   * Keep ring center anchored while scaling:
   * for the non-cluster 60x90 viewBox, center is at (30,45) in SVG units.
   */
  computePinScaleTransform(marker: MarkerVm): string {
    if (marker.isCluster || marker.pinScale === 1) {
      return `scale(${marker.pinScale})`;
    }
    const tx = (marker.pinScale - 1) * 30;
    const ty = (marker.pinScale - 1) * 45;
    return `translate(${tx} ${ty}) scale(${marker.pinScale})`;
  }

  onMarkerClick(node: WarRoomNode | undefined): void {
    this.markerClick.emit(node);
  }

  onMarkerKeydown(node: WarRoomNode | undefined, event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ' || keyboardEvent.key === 'Spacebar') {
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      this.onMarkerClick(node);
    }
  }

  onMarkerHover(node: WarRoomNode | null): void {
    this.markerHover.emit(node);
  }

  onLogoError(node: WarRoomNode, logoPath: string): void {
    this.logoError.emit({ node, logoPath });
  }

  getTagTitle(value: string): string {
    return value?.trim() || '';
  }

  getMarkerDomKey(marker: MarkerVm): string {
    const raw = marker.renderKey || `${marker.nodeType}:${marker.id}`;
    return raw.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  truncateTag(value: string, maxLength: number): string {
    const v = value?.trim() || '';
    if (v.length <= maxLength) return v;
    if (maxLength <= 3) return v.slice(0, maxLength);
    return `${v.slice(0, Math.max(0, maxLength - 3))}...`;
  }
}
