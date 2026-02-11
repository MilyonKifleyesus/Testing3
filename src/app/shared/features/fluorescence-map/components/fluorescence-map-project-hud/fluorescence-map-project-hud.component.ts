import { Component, signal, computed, inject, input, output, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Project } from '../../../../models/project.model';
import { ProjectService } from '../../../../services/project.service';

@Component({
  selector: 'app-war-room-project-hud',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fluorescence-map-project-hud.component.html',
  styleUrl: './fluorescence-map-project-hud.component.scss',
})
export class WarRoomProjectHudComponent {
  private readonly projectService = inject(ProjectService);

  /** Optional: pre-filtered projects. If not set, fetches from ProjectService */
  projectsInput = input<Project[] | null>(null);

  /** Filter by client IDs */
  clientIds = input<string[]>([]);

  /** Filter by manufacturers (Project.manufacturer) */
  manufacturerIds = input<string[]>([]);

  /** Filter by project types (assessmentType) */
  projectTypeIds = input<string[]>([]);

  /** Project ID to highlight (from map/HUD sync) */
  selectedProjectId = input<string | null>(null);

  projectSelected = output<Project>();
  closeRequested = output<void>();

  readonly collapsed = signal<boolean>(true);
  readonly searchQuery = signal<string>('');
  readonly projects = signal<Project[]>([]);

  readonly filteredProjects = computed(() => {
    const list = this.projects();
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.projectName.toLowerCase().includes(q) ||
        (p.clientName ?? '').toLowerCase().includes(q) ||
        (p.assessmentType ?? '').toLowerCase().includes(q) ||
        (p.manufacturer ?? '').toLowerCase().includes(q)
    );
  });

  constructor() {
    effect(
      (onCleanup) => {
        const inputProjects = this.projectsInput();
        if (inputProjects != null) {
          this.projects.set(inputProjects);
          return;
        }
        const clientIds = this.clientIds();
        const manufacturerIds = this.manufacturerIds();
        const projectTypeIds = this.projectTypeIds();
        const filters = {
          clientIds: clientIds.length ? clientIds : undefined,
          manufacturerIds: manufacturerIds.length ? manufacturerIds : undefined,
          projectTypeIds: projectTypeIds.length ? projectTypeIds : undefined,
        };
        const sub = this.projectService.getProjects(filters).subscribe((list) => this.projects.set(list));
        onCleanup(() => sub.unsubscribe());
      },
      { allowSignalWrites: true }
    );
  }

  onHeaderClick(): void {
    if (this.collapsed()) {
      this.expand();
    } else {
      this.collapsed.set(true);
    }
  }

  /** Expand the project list (used by command menu) */
  expand(): void {
    this.collapsed.set(false);
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
  }

  onProjectClick(project: Project): void {
    this.projectSelected.emit(project);
  }

  statusClass(status: Project['status']): string {
    if (status == null) return 'status-open';
    switch (status) {
      case 'Open':
        return 'status-open';
      case 'Closed':
        return 'status-closed';
      case 'Delayed':
        return 'status-delayed';
      default:
        return 'status-open';
    }
  }
}
