import { Component, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type CommandAction = 'addCompany' | 'panels' | 'filters' | 'tactical' | 'expandMap';

@Component({
  selector: 'app-war-room-command-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './war-room-command-menu.component.html',
  styleUrl: './war-room-command-menu.component.scss',
})
export class WarRoomCommandMenuComponent {
  readonly expanded = signal<boolean>(false);
  actionTriggered = output<CommandAction>();

  toggle(): void {
    this.expanded.update((v) => !v);
  }

  onAction(action: CommandAction): void {
    this.actionTriggered.emit(action);
    this.expanded.set(false);
  }
}
