import { Component, signal, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Project } from '../../../../models/project.model';
import { ProjectService } from '../../../../services/project.service';

@Component({
  selector: 'app-war-room-project-hud',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './war-room-project-hud.component.html',
  styleUrl: './war-room-project-hud.component.scss',
})
export class WarRoomProjectHudComponent {
  private readonly projectService = inject(ProjectService);

  /** Optional: pre-filtered projects. If not set, fetches from ProjectService */
  projectsInput = input<Project[] | null>(null);

  /** Project ID to highlight (from map/HUD sync) */
  selectedProjectId = input<string | null>(null);

  projectSelected = output<Project>();

  readonly collapsed = signal<boolean>(false);
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
    this.loadProjects();
  }

  private loadProjects(): void {
    this.projectService.getProjects({}).subscribe((list) => this.projects.set(list));
  }

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
  }

  onProjectClick(project: Project): void {
    this.projectSelected.emit(project);
  }

  statusClass(status: Project['status']): string {
    switch (status) {
      case 'Open':
        return 'status-open';
      case 'Closed':
        return 'status-closed';
      case 'Delayed':
        return 'status-delayed';
      default:
        return '';
    }
  }
}
