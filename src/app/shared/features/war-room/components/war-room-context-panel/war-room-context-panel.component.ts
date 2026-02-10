import { Component, input, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WarRoomService } from '../../../../services/war-room.service';
import { ClientService } from '../../../../services/client.service';
import { ProjectService } from '../../../../services/project.service';
import { FleetSelection } from '../../../../models/war-room.interface';
import { Project } from '../../../../models/project.model';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-war-room-context-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './war-room-context-panel.component.html',
  styleUrl: './war-room-context-panel.component.scss',
})
export class WarRoomContextPanelComponent {
  private readonly warRoomService = inject(WarRoomService);
  private readonly clientService = inject(ClientService);
  private readonly projectService = inject(ProjectService);

  selectedEntity = input<FleetSelection | null>(null);
  selectedProjectId = input<string | null>(null);
  selectedRouteId = input<string | null>(null);

  private readonly clientsSignal = toSignal(this.clientService.getClients(), { initialValue: [] });

  private readonly projectsSignal = toSignal(this.projectService.getProjects({}), { initialValue: [] });

  readonly contextData = computed(() => {
    const entity = this.selectedEntity();
    const projectId = this.selectedProjectId();
    const projects = this.projectsSignal();
    const clients = this.clientsSignal();
    const factories = this.warRoomService.factories();

    if (projectId) {
      const project = projects.find((p) => String(p.id) === projectId);
      if (project) {
        const client = clients.find((c) => c.id === project.clientId);
        const factory = factories.find((f) => f.id === project.manufacturerLocationId);
        return {
          type: 'project' as const,
          project,
          client: client ?? null,
          factory: factory ?? null,
        };
      }
    }

    if (entity?.level === 'factory') {
      const factory = factories.find((f) => f.id === entity.id);
      const linkedProjects = projects.filter((p) => p.manufacturerLocationId === entity.id);
      return {
        type: 'factory' as const,
        factory: factory ?? null,
        linkedProjects,
      };
    }

    if (entity?.level === 'client') {
      const client = clients.find((c) => c.id === entity.id);
      const linkedProjects = projects.filter((p) => p.clientId === entity.id);
      return {
        type: 'client' as const,
        client: client ?? null,
        linkedProjects,
      };
    }

    return null;
  });

  readonly hasContent = computed(() => !!this.contextData());
}
