import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-fluorescence-map-map-controls',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fluorescence-map-map-controls.component.html',
  styleUrls: ['./fluorescence-map-map-controls.component.scss'],
})
export class FluorescenceMapMapControlsComponent {
  private static nextId = 0;
  readonly zoomSliderId = `war-room-zoom-slider-${FluorescenceMapMapControlsComponent.nextId++}`;

  fullscreen = input<boolean>(false);
  /** When true, the fullscreen (FS) button is hidden (e.g. when toolbar EXPAND MAP is used instead). */
  hideFullscreenButton = input<boolean>(false);
  /** Current zoom level (0.5-14) for slider. */
  zoomLevel = input<number>(1.8);
  zoomIn = output<void>();
  zoomOut = output<void>();
  /** Emitted when user changes zoom via slider. */
  zoomChange = output<number>();
  toggleFullscreen = output<void>();
}
