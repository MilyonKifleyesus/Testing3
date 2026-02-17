import { Component, input, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WarRoomService } from '../../../../services/fluorescence-map.service';
import { ClientService } from '../../../../services/client.service';
import { ProjectService } from '../../../../services/project.service';
import { RoutePreviewStorageService } from '../../../../services/route-preview-storage.service';
import { FleetSelection } from '../../../../models/fluorescence-map.interface';
import { Project } from '../../../../models/project.model';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-war-room-context-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fluorescence-map-context-panel.component.html',
  styleUrl: './fluorescence-map-context-panel.component.scss',
})
export class WarRoomContextPanelComponent {
  private readonly warRoomService = inject(WarRoomService);
  private readonly clientService = inject(ClientService);
  private readonly projectService = inject(ProjectService);
  private readonly routePreviewStorage = inject(RoutePreviewStorageService);

  selectedEntity = input<FleetSelection | null>(null);
  selectedProjectId = input<string | null>(null);
  routePreviewVersion = input<number>(0);

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
        const client = clients.find((c) => String(c.id) === String(project.clientId));
        const factory = factories.find((f) => String(f.id) === String(project.manufacturerLocationId));
        return {
          type: 'project' as const,
          project,
          client: client ?? null,
          factory: factory ?? null,
        };
      }
    }

    if (entity?.level === 'factory') {
      const factory = factories.find((f) => String(f.id) === String(entity.id));
      const linkedProjects = projects.filter((p) => String(p.manufacturerLocationId) === String(entity.id));
      return {
        type: 'factory' as const,
        factory: factory ?? null,
        linkedProjects,
      };
    }

    if (entity?.level === 'client') {
      const client = clients.find((c) => String(c.id) === String(entity.id));
      const linkedProjects = projects.filter((p) => String(p.clientId) === String(entity.id));
      return {
        type: 'client' as const,
        client: client ?? null,
        linkedProjects,
      };
    }

    return null;
  });

  readonly hasContent = computed(() => !!this.contextData());

  readonly routePreviewUrlByProjectId = computed(() => {
    this.routePreviewVersion();
    const map = new Map<string, string | null>();
    const data = this.contextData();
    if (data?.type === 'project') {
      const id = String(data.project.id);
      map.set(id, this.routePreviewStorage.get(id));
    }
    return map;
  });

  getRoutePreviewUrl(projectId: string | number): string | null {
    return this.routePreviewUrlByProjectId().get(String(projectId)) ?? null;
  }

  downloadRoutePreview(projectId: string | number, projectName?: string): void {
    this.routePreviewStorage.download(String(projectId), projectName);
  }
}
