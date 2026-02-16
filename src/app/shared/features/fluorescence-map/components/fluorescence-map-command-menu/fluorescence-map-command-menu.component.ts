import { Component, input, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type CommandAction = 'addCompany' | 'panels' | 'filters' | 'projectList' | 'tactical' | 'expandMap' | 'captureRoute' | 'captureClientProjects';

@Component({
  selector: 'app-war-room-command-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fluorescence-map-command-menu.component.html',
  styleUrl: './fluorescence-map-command-menu.component.scss',
})
export class WarRoomCommandMenuComponent {
  readonly expanded = signal<boolean>(false);
  hasSelectedProject = input<boolean>(false);
  hasSelectedClient = input<boolean>(false);
  actionTriggered = output<CommandAction>();

  toggle(): void {
    this.expanded.update((v) => !v);
  }

  onAction(action: CommandAction): void {
    this.actionTriggered.emit(action);
    this.expanded.set(false);
  }
}
