import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ViewEncapsulation, input, output } from '@angular/core';
import type { FleetMode } from '../../models/fleet-map.models';

export type FleetHeaderStatus = 'connected' | 'connecting' | 'fallback' | 'offline';

interface HeaderTab {
  id: FleetMode;
  label: string;
  iconClass: string;
}

interface StatusConfig {
  dotClass: string;
  pillClass: string;
  label: string;
}

const TABS: HeaderTab[] = [
  { id: 'projects', label: 'Projects', iconClass: 'bi bi-map' },
  { id: 'clients', label: 'Clients', iconClass: 'bi bi-people' },
  { id: 'manufacturers', label: 'Manufacturers', iconClass: 'bi bi-building' },
];

const STATUS_CONFIG: Record<FleetHeaderStatus, StatusConfig> = {
  connected: {
    dotClass: 'fleet-header__status-dot--connected',
    pillClass: 'fleet-header__status--connected',
    label: 'Live',
  },
  connecting: {
    dotClass: 'fleet-header__status-dot--connecting',
    pillClass: 'fleet-header__status--connecting',
    label: 'Connecting...',
  },
  fallback: {
    dotClass: 'fleet-header__status-dot--fallback',
    pillClass: 'fleet-header__status--fallback',
    label: 'Polling',
  },
  offline: {
    dotClass: 'fleet-header__status-dot--offline',
    pillClass: 'fleet-header__status--offline',
    label: 'Offline',
  },
};

@Component({
  selector: 'app-fleet-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fleet-header.component.html',
  styleUrl: './fleet-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class FleetHeaderComponent {
  readonly mode = input.required<FleetMode>();
  readonly status = input.required<FleetHeaderStatus>();
  readonly isDark = input.required<boolean>();

  readonly modeChange = output<FleetMode>();
  readonly refresh = output<void>();
  readonly toggleTheme = output<void>();

  readonly tabs = TABS;
  readonly statusConfig = STATUS_CONFIG;
}
