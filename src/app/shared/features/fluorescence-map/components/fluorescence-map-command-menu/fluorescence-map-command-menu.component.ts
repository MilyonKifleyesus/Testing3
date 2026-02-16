import { Component, input, signal, output, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

export type CommandAction = 'addCompany' | 'panels' | 'filters' | 'projectList' | 'tactical' | 'expandMap' | 'captureRoute' | 'captureClientProjects';

const FAB_SEEN_KEY = 'war-room-fab-seen';
const PULSE_DURATION_MS = 5000;

@Component({
  selector: 'app-war-room-command-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fluorescence-map-command-menu.component.html',
  styleUrl: './fluorescence-map-command-menu.component.scss',
})
export class WarRoomCommandMenuComponent implements OnInit, OnDestroy {
  readonly expanded = signal<boolean>(false);
  readonly showPulse = signal<boolean>(false);
  hasSelectedProject = input<boolean>(false);
  hasSelectedClient = input<boolean>(false);
  actionTriggered = output<CommandAction>();

  private pulseTimeoutId: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem(FAB_SEEN_KEY)) {
      this.showPulse.set(true);
      this.pulseTimeoutId = setTimeout(() => this.dismissPulse(), PULSE_DURATION_MS);
    }
  }

  ngOnDestroy(): void {
    if (this.pulseTimeoutId != null) {
      clearTimeout(this.pulseTimeoutId);
      this.pulseTimeoutId = null;
    }
  }

  private dismissPulse(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FAB_SEEN_KEY, '1');
    }
    this.showPulse.set(false);
    if (this.pulseTimeoutId != null) {
      clearTimeout(this.pulseTimeoutId);
      this.pulseTimeoutId = null;
    }
  }

  toggle(): void {
    if (this.showPulse()) {
      this.dismissPulse();
    }
    this.expanded.update((v) => !v);
  }

  onAction(action: CommandAction): void {
    this.actionTriggered.emit(action);
    this.expanded.set(false);
  }
}
