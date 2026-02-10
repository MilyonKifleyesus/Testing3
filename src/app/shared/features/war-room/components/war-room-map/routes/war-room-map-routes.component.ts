import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface RouteVm {
  id: string;
  path: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  index: number;
  beginOffset: string;
  highlighted: boolean;
  strokeWidth: number;
  dashArray?: string;
  /** Per-route stroke color for project routes (energy conduit styling) */
  strokeColor?: string;
  /** Project ID for project routes (enables route click → select project) */
  projectId?: string;
}

@Component({
  selector: 'app-war-room-map-routes',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './war-room-map-routes.component.html',
  styleUrls: ['./war-room-map-routes.component.scss'],
})
export class WarRoomMapRoutesComponent {
  routes = input<RouteVm[]>([]);
  routeStroke = input<string>('#0ea5e9');
  routeFill = input<string>('#0ea5e9');
  routeSelected = output<{ routeId: string; projectId?: string }>();

  onRouteClick(route: RouteVm, event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.routeSelected.emit({ routeId: route.id, projectId: route.projectId });
  }
}
