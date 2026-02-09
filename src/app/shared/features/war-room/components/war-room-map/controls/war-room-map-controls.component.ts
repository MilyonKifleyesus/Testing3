import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-war-room-map-controls',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './war-room-map-controls.component.html',
  styleUrls: ['./war-room-map-controls.component.scss'],
})
export class WarRoomMapControlsComponent {
  fullscreen = input<boolean>(false);
  /** Current zoom level (0.5–14) for slider. */
  zoomLevel = input<number>(1.8);
  zoomIn = output<void>();
  zoomOut = output<void>();
  /** Emitted when user changes zoom via slider. */
  zoomChange = output<number>();
  toggleFullscreen = output<void>();
}
