import { Component, DestroyRef, effect, inject, input, output, signal, computed, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ProjectService } from '../../../../services/project.service';
import { WarRoomService } from '../../../../services/fluorescence-map.service';
import { RoutePreviewStorageService } from '../../../../services/route-preview-storage.service';
import { ToastrService } from 'ngx-toastr';
import { Project, ProjectStatus } from '../../../../models/project.model';
import { catchError, of } from 'rxjs';

export interface ClientWithProjects {
  id: string;
  name: string;
  code?: string;
  logoUrl?: string;
  projectCount: number;
}

@Component({
  selector: 'app-war-room-clients-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fluorescence-map-clients-panel.component.html',
  styleUrl: './fluorescence-map-clients-panel.component.scss',
})
export class WarRoomClientsPanelComponent {
  private projectService = inject(ProjectService);
  private warRoomService = inject(WarRoomService);
  private routePreviewStorage = inject(RoutePreviewStorageService);
  private toastr = inject(ToastrService);
  private destroyRef = inject(DestroyRef);

  clientsWithProjects = input.required<ClientWithProjects[]>();
  editMode = input<boolean>(false);
  selectedEntity = input<{ level?: string; id?: string } | null>(null);
  /** When this changes, client project caches are invalidated (e.g. after adding a project) */
  projectsRefreshTrigger = input<number>(0);
  /** Increments when a route preview is saved; used to refresh thumbnails */
  routePreviewVersion = input<number>(0);

  clientSelected = output<string>();
  projectSelected = output<Project>();
  saveComplete = output<void>();
  routePreviewRequested = output<string>();
  clientCaptureRequested = output<string>();

  readonly expandedClientIds = signal<Set<string>>(new Set());
  readonly projectsByClientId = signal<Map<string, Project[]>>(new Map());
  readonly clientSearchQuery = signal<string>('');

  readonly filteredClientsForDisplay = computed(() => {
    const clients = this.clientsWithProjects();
    const q = this.clientSearchQuery().trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  });

  constructor() {
    effect(() => {
      const _trigger = this.projectsRefreshTrigger();
      if (_trigger > 0) this.projectsByClientId.set(new Map());
    });
  }
  readonly projectDrafts = signal<
    Map<string, { projectName: string; location: string; status: ProjectStatus }>
  >(new Map());
  readonly editingProjectId = signal<string | null>(null);

  toggleExpand(clientId: string): void {
    this.expandedClientIds.update((set) => {
      const next = new Set(set);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
        this.loadProjectsForClient(clientId);
      }
      return next;
    });
  }

  isExpanded(clientId: string): boolean {
    return this.expandedClientIds().has(clientId);
  }

  private loadProjectsForClient(clientId: string): void {
    const cached = this.projectsByClientId().get(clientId);
    if (cached) return;

    this.projectService
      .getProjectsByClient(clientId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((err) => {
          if (isDevMode()) {
            console.warn('Failed to load projects for client', clientId, err);
          }
          return of([] as Project[]);
        })
      )
      .subscribe((projects) => {
        this.projectsByClientId.update((m) => {
          const next = new Map(m);
          next.set(clientId, projects);
          return next;
        });
      });
  }

  getProjectsForClient(clientId: string): Project[] {
    return this.projectsByClientId().get(clientId) ?? [];
  }

  invalidateClientCache(clientId: string): void {
    this.projectsByClientId.update((m) => {
      const next = new Map(m);
      next.delete(clientId);
      return next;
    });
  }

  onClientClick(clientId: string, event: Event): void {
    const target = event.target as HTMLElement;
    if (target.closest('button[data-edit-btn]')) return;
    if (target.closest('.client-capture-btn')) return;
    this.toggleExpand(clientId);
    this.clientSelected.emit(clientId);
  }

  onCaptureAllClientProjects(clientId: string, event: Event): void {
    event.stopPropagation();
    this.clientCaptureRequested.emit(clientId);
  }

  onProjectClick(project: Project, event: Event): void {
    const target = event.target as HTMLElement;
    if (target.closest('button[data-edit-btn]')) return;
    this.projectSelected.emit(project);
  }

  getProjectLocation(project: Project): string {
    return project.location ?? project.manufacturer ?? 'Unknown';
  }

  getFactoryName(project: Project): string {
    const factoryId = project.manufacturerLocationId;
    if (!factoryId) return project.manufacturer ?? '';
    const factory = this.warRoomService.factories().find((f) => f.id === factoryId);
    return factory?.name ?? project.manufacturer ?? '';
  }

  getStatusLabel(status: ProjectStatus | null): string {
    if (status == null) return 'Active';
    if (status === 'Open') return 'Active';
    if (status === 'Closed') return 'Inactive';
    return 'Delayed';
  }

  getStatusPillClass(status: ProjectStatus | null): string {
    if (status == null) return 'status-open';
    if (status === 'Open') return 'status-open';
    if (status === 'Closed') return 'status-closed';
    return 'status-delayed';
  }

  startEditProject(project: Project, event: Event): void {
    event.stopPropagation();
    const id = String(project.id);
    this.editingProjectId.set(id);
    this.projectDrafts.update((m) => {
      const next = new Map(m);
      next.set(id, {
        projectName: project.projectName,
        location: project.location ?? project.manufacturer ?? '',
        status: project.status ?? 'Open',
      });
      return next;
    });
  }

  cancelEditProject(projectId: string): void {
    this.projectDrafts.update((m) => {
      const next = new Map(m);
      next.delete(String(projectId));
      return next;
    });
    this.editingProjectId.set(null);
  }

  isEditingProject(projectId: string | number): boolean {
    return this.editingProjectId() === String(projectId);
  }

  getDraft(projectId: string | number) {
    return this.projectDrafts().get(String(projectId));
  }

  updateDraft(
    projectId: string,
    updates: Partial<{
      projectName: string;
      location: string;
      status: ProjectStatus;
    }>
  ): void {
    this.projectDrafts.update((m) => {
      const next = new Map(m);
      const existing = next.get(projectId) ?? {
        projectName: '',
        location: '',
        status: 'Open' as ProjectStatus,
      };
      next.set(projectId, { ...existing, ...updates });
      return next;
    });
  }

  saveProject(project: Project): void {
    const draft = this.getDraft(project.id);
    if (!draft) {
      this.toastr.warning('No draft found for this project.', 'Cannot save');
      return;
    }
    const trimmedName = draft.projectName?.trim() ?? '';
    if (!trimmedName) {
      this.toastr.warning('Project name is required.', 'Cannot save');
      return;
    }

    const updated: Project = {
      ...project,
      projectName: trimmedName,
      location: draft.location?.trim() ?? '',
      status: draft.status,
    };

    this.projectService
      .updateProject(updated)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.cancelEditProject(String(project.id));
          this.invalidateClientCache(project.clientId);
          this.saveComplete.emit();
          this.routePreviewRequested.emit(String(project.id));
          this.toastr.success('Project saved.', 'SAVED');
        },
        error: () => {
          this.toastr.error('Failed to save project.', 'ERROR');
        },
      });
  }

  saveAllDrafts(): void {
    const drafts = this.projectDrafts();
    if (drafts.size === 0) return;

    const projectsMap = this.projectsByClientId();
    const projectById = new Map<string, Project>();
    for (const [, clientProjects] of projectsMap) {
      for (const p of clientProjects) {
        projectById.set(String(p.id), p);
      }
    }

    const clientIdsToInvalidate = new Set<string>();
    const toSave: { projectIdStr: string; project: Project; draft: { projectName: string; location: string; status: ProjectStatus } }[] = [];

    for (const [projectIdStr, draft] of drafts) {
      if (!draft.projectName?.trim()) continue;
      const project = projectById.get(projectIdStr);
      if (project) {
        toSave.push({ projectIdStr, project, draft });
      }
    }

    if (toSave.length === 0) {
      this.clearAllDrafts();
      return;
    }

    const total = toSave.length;
    let completed = 0;
    let successCount = 0;
    let failureCount = 0;
    const succeededIds = new Set<string>();

    const maybeFinish = () => {
      if (completed !== total) return;
      this.projectDrafts.update((m) => {
        const next = new Map(m);
        succeededIds.forEach((id) => next.delete(id));
        return next;
      });
      this.editingProjectId.set(null);
      clientIdsToInvalidate.forEach((id) => this.invalidateClientCache(id));
      this.saveComplete.emit();
      if (failureCount > 0) {
        this.toastr.error(
          failureCount === total
            ? 'All projects failed to save.'
            : `${successCount} saved, ${failureCount} failed.`,
          'ERROR'
        );
      } else {
        this.toastr.success(
          `${successCount} ${successCount === 1 ? 'project' : 'projects'} saved.`,
          'SAVED'
        );
      }
    };

    for (const { projectIdStr, project, draft } of toSave) {
      const updated: Project = {
        ...project,
        projectName: draft.projectName.trim(),
        location: draft.location?.trim() ?? '',
        status: draft.status,
      };
      this.projectService.updateProject(updated).subscribe({
        next: () => {
          clientIdsToInvalidate.add(project.clientId);
          succeededIds.add(projectIdStr);
          this.routePreviewRequested.emit(projectIdStr);
          successCount++;
          completed++;
          maybeFinish();
        },
        error: () => {
          failureCount++;
          completed++;
          maybeFinish();
        },
      });
    }
  }

  clearAllDrafts(): void {
    this.projectDrafts.set(new Map());
    this.editingProjectId.set(null);
  }

  hasDrafts(): boolean {
    return this.projectDrafts().size > 0;
  }

  idStr(id: string | number): string {
    return String(id);
  }

  getRoutePreviewUrl(projectId: string | number): string | null {
    void this.routePreviewVersion();
    return this.routePreviewStorage.get(String(projectId));
  }

  downloadRoutePreview(projectId: string | number, projectName?: string): void {
    const ok = this.routePreviewStorage.download(String(projectId), projectName);
    if (!ok) this.toastr.warning('No route preview to download.', 'Download');
  }
}
