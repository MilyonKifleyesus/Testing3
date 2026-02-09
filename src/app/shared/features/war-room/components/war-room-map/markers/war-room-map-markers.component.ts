import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkerVm } from '../war-room-map.vm';
import { Node as WarRoomNode } from '../../../../../models/war-room.interface';

@Component({
  selector: 'app-war-room-map-markers',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './war-room-map-markers.component.html',
  styleUrls: ['./war-room-map-markers.component.scss'],
})
export class WarRoomMapMarkersComponent {
  markers = input<MarkerVm[]>([]);
  pixelCoordinates = input<Map<string, { x: number; y: number }>>(new Map());

  markerClick = output<WarRoomNode | undefined>();
  markerHover = output<WarRoomNode | null>();
  logoError = output<{ node: WarRoomNode; logoPath: string }>();

  getPosition(id: string): { x: number; y: number } {
    return this.pixelCoordinates().get(id) ?? { x: 0, y: 0 };
  }

  onMarkerClick(node: WarRoomNode | undefined): void {
    this.markerClick.emit(node);
  }

  onMarkerHover(node: WarRoomNode | null): void {
    this.markerHover.emit(node);
  }

  onLogoError(node: WarRoomNode, logoPath: string): void {
    this.logoError.emit({ node, logoPath });
  }
}
