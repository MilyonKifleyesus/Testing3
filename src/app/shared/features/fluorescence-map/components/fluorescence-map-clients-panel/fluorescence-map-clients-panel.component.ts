import { Component, DestroyRef, effect, inject, input, output, signal, computed, isDevMode } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ClientService } from '../../../../services/client.service';
import { ProjectService } from '../../../../services/project.service';
import { WarRoomService } from '../../../../services/fluorescence-map.service';
import { LocationService } from '../../../../services/location.service';
import { RoutePreviewStorageService } from '../../../../services/route-preview-storage.service';
import { ToastrService } from 'ngx-toastr';
import { Project, ProjectStatus } from '../../../../models/project.model';
import { catchError, of, Observable, throwError, switchMap } from 'rxjs';
import { parseCoordinateInput, validateCoordinatePair } from '../../../../utils/coordinate-input.utils';

export interface ClientWithProjects {
  id: string;
  name: string;
  code?: string;
  logoUrl?: string;
  projectCount: number;
}

interface ProjectLocationRecord {
  name: string;
  latitude: number;
  longitude: number;
}

interface ProjectDraft {
  projectName: string;
  location: string;
  status: ProjectStatus;
  latitude: string;
  longitude: string;
}

interface ClientRecord {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

interface ClientDraft {
  name: string;
  latitude: string;
  longitude: string;
}

@Component({
  selector: 'app-fluorescence-map-clients-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fluorescence-map-clients-panel.component.html',
  styleUrls: ['./fluorescence-map-clients-panel.component.scss'],
})
export class FluorescenceMapClientsPanelComponent {
  private clientService = inject(ClientService);
  private projectService = inject(ProjectService);
  private warRoomService = inject(WarRoomService);
  private locationService = inject(LocationService);
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
  locationsById = input<Map<string, ProjectLocationRecord>>(new Map());
  clientsById = input<Map<string, ClientRecord>>(new Map());

  clientSelected = output<string>();
  projectSelected = output<Project>();
  saveComplete = output<void>();
  clientSaveComplete = output<void>();
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

  readonly projectDrafts = signal<Map<string, ProjectDraft>>(new Map());
  readonly clientDrafts = signal<Map<string, ClientDraft>>(new Map());
  readonly editingProjectId = signal<string | null>(null);
  readonly editingClientId = signal<string | null>(null);

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
    if (target.closest('button[data-client-edit-btn]')) return;
    this.toggleExpand(clientId);
    this.clientSelected.emit(clientId);
  }

  onCaptureAllClientProjects(clientId: string, event: Event): void {
    event.stopPropagation();
    this.clientCaptureRequested.emit(clientId);
  }

  isEditingClient(clientId: string): boolean {
    return this.editingClientId() === clientId;
  }

  startEditClient(clientId: string, event: Event): void {
    event.stopPropagation();
    const client = this.clientsById().get(clientId);
    const headerClient = this.clientsWithProjects().find((c) => c.id === clientId);
    const name = client?.name ?? headerClient?.name ?? '';
    const latitude = Number.isFinite(client?.latitude) ? String(client?.latitude) : '';
    const longitude = Number.isFinite(client?.longitude) ? String(client?.longitude) : '';
    this.editingClientId.set(clientId);
    this.clientDrafts.update((drafts) => {
      const next = new Map(drafts);
      next.set(clientId, { name, latitude, longitude });
      return next;
    });
  }

  cancelEditClient(clientId: string, event?: Event): void {
    event?.stopPropagation();
    this.clientDrafts.update((drafts) => {
      const next = new Map(drafts);
      next.delete(clientId);
      return next;
    });
    if (this.editingClientId() === clientId) {
      this.editingClientId.set(null);
    }
  }

  getClientDraft(clientId: string): ClientDraft | undefined {
    return this.clientDrafts().get(clientId);
  }

  updateClientDraft(clientId: string, updates: Partial<ClientDraft>): void {
    this.clientDrafts.update((drafts) => {
      const next = new Map(drafts);
      const existing = next.get(clientId) ?? { name: '', latitude: '', longitude: '' };
      next.set(clientId, { ...existing, ...updates });
      return next;
    });
  }

  getClientLatitudeError(clientId: string): string | null {
    const draft = this.getClientDraft(clientId);
    if (!draft) return null;
    return validateCoordinatePair(draft.latitude, draft.longitude).latitudeError;
  }

  getClientLongitudeError(clientId: string): string | null {
    const draft = this.getClientDraft(clientId);
    if (!draft) return null;
    return validateCoordinatePair(draft.latitude, draft.longitude).longitudeError;
  }

  saveClient(clientId: string, event: Event): void {
    event.stopPropagation();
    const draft = this.getClientDraft(clientId);
    if (!draft) {
      this.toastr.warning('No draft found for this client.', 'Cannot save');
      return;
    }
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      this.toastr.warning('Client name is required.', 'Cannot save');
      return;
    }
    const validation = validateCoordinatePair(draft.latitude, draft.longitude);
    if (validation.hasErrors) {
      this.toastr.warning('Enter valid latitude/longitude values before saving.', 'Cannot save');
      return;
    }
    const latitude = parseCoordinateInput(draft.latitude);
    const longitude = parseCoordinateInput(draft.longitude);
    if (latitude == null || longitude == null) {
      this.toastr.warning('Latitude and longitude are required.', 'Cannot save');
      return;
    }

    this.clientService
      .updateClient(clientId, {
        name: trimmedName,
        latitude,
        longitude,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.cancelEditClient(clientId);
          this.clientSaveComplete.emit();
          this.toastr.success('Client saved.', 'SAVED');
        },
        error: (err: unknown) => {
          const message = this.getClientSaveErrorMessage(err);
          this.toastr.error(message, 'ERROR');
        },
      });
  }

  onProjectClick(project: Project, event: Event): void {
    const target = event.target as HTMLElement;
    if (target.closest('button[data-edit-btn]')) return;
    this.projectSelected.emit(project);
  }

  getProjectLocation(project: Project): string {
    return project.location ?? project.manufacturer ?? '-';
  }

  getProjectCoordinatesLabel(project: Project): string {
    const location = this.getProjectLocationRecord(project);
    if (!location) return 'Lat/Lng: -';
    return `Lat/Lng: ${this.formatCoordinate(location.latitude)}, ${this.formatCoordinate(location.longitude)}`;
  }

  getFactoryName(project: Project): string {
    const manufacturerLocationId = project.manufacturerLocationId;
    if (!manufacturerLocationId) return project.manufacturer ?? '';
    const manufacturerLocation = this.warRoomService
      .manufacturerLocations()
      .find((f) => f.id === manufacturerLocationId);
    return manufacturerLocation?.name ?? project.manufacturer ?? '';
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
    const location = this.getProjectLocationRecord(project);
    this.editingProjectId.set(id);
    this.projectDrafts.update((m) => {
      const next = new Map(m);
      next.set(id, {
        projectName: project.projectName,
        location: project.location ?? project.manufacturer ?? '',
        status: project.status ?? 'Open',
        latitude: location ? String(location.latitude) : '',
        longitude: location ? String(location.longitude) : '',
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

  getDraft(projectId: string | number): ProjectDraft | undefined {
    return this.projectDrafts().get(String(projectId));
  }

  updateDraft(
    projectId: string,
    updates: Partial<ProjectDraft>
  ): void {
    this.projectDrafts.update((m) => {
      const next = new Map(m);
      const existing = next.get(projectId) ?? {
        projectName: '',
        location: '',
        status: 'Open' as ProjectStatus,
        latitude: '',
        longitude: '',
      };
      next.set(projectId, { ...existing, ...updates });
      return next;
    });
  }

  getLatitudeError(projectId: string | number): string | null {
    const draft = this.getDraft(projectId);
    if (!draft) return null;
    return validateCoordinatePair(draft.latitude, draft.longitude).latitudeError;
  }

  getLongitudeError(projectId: string | number): string | null {
    const draft = this.getDraft(projectId);
    if (!draft) return null;
    return validateCoordinatePair(draft.latitude, draft.longitude).longitudeError;
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

    this.persistProjectChanges(project, draft, updated)
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
    const toSave: { projectIdStr: string; project: Project; draft: ProjectDraft }[] = [];

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
      this.persistProjectChanges(project, draft, updated).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  private getProjectLocationId(project: Project): string | null {
    const locationId = project.locationId != null ? String(project.locationId) : null;
    if (locationId && locationId.trim()) return locationId;
    const manufacturerLocationId = project.manufacturerLocationId != null ? String(project.manufacturerLocationId) : null;
    if (manufacturerLocationId && manufacturerLocationId.trim()) return manufacturerLocationId;
    return null;
  }

  private getProjectLocationRecord(project: Project): ProjectLocationRecord | null {
    const locationId = this.getProjectLocationId(project);
    if (!locationId) return null;
    return this.locationsById().get(String(locationId)) ?? null;
  }

  private formatCoordinate(value: number): string {
    return Number(value).toFixed(4);
  }

  private persistProjectChanges(project: Project, draft: ProjectDraft, updatedProject: Project): Observable<Project> {
    const coordinateValidation = validateCoordinatePair(draft.latitude, draft.longitude);
    if (coordinateValidation.hasErrors) {
      this.toastr.warning('Enter valid latitude/longitude values before saving.', 'Cannot save');
      return throwError(() => new Error('Coordinate validation failed.'));
    }

    const locationId = this.getProjectLocationId(project);
    const latitude = parseCoordinateInput(draft.latitude);
    const longitude = parseCoordinateInput(draft.longitude);
    const hasCoordinateInput = draft.latitude.trim().length > 0 || draft.longitude.trim().length > 0;
    const linkedLocation = locationId ? this.locationsById().get(String(locationId)) : null;
    const locationName =
      draft.location.trim() ||
      linkedLocation?.name ||
      project.location?.trim() ||
      project.manufacturer?.trim() ||
      'Unnamed Location';
    const locationNameChanged = locationName !== (linkedLocation?.name ?? '').trim();
    const shouldUpdateLocation = !!locationId && (hasCoordinateInput || locationNameChanged);

    if (hasCoordinateInput && !locationId) {
      this.toastr.warning('This project is not linked to an API Location; coordinates cannot be saved.', 'Cannot save');
      return throwError(() => new Error('Project is not linked to an API location.'));
    }

    if (!shouldUpdateLocation) {
      return this.projectService.updateProject(updatedProject);
    }

    const fallbackLatitude = linkedLocation?.latitude;
    const fallbackLongitude = linkedLocation?.longitude;
    const finalLatitude = latitude ?? fallbackLatitude;
    const finalLongitude = longitude ?? fallbackLongitude;

    if (!Number.isFinite(finalLatitude) || !Number.isFinite(finalLongitude)) {
      this.toastr.warning('Latitude and longitude are required to update this location.', 'Cannot save');
      return throwError(() => new Error('Missing coordinates for location update.'));
    }

    return this.locationService
      .updateLocation(locationId!, {
        name: locationName,
        latitude: finalLatitude!,
        longitude: finalLongitude!,
      })
      .pipe(switchMap(() => this.projectService.updateProject(updatedProject)));
  }

  private getClientSaveErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const details =
        (typeof err.error === 'string' && err.error) ||
        (err.error?.message as string | undefined) ||
        (Array.isArray(err.error?.errors) ? err.error.errors.join('; ') : undefined);
      if (details) return `Failed to save client: ${details}`;
      return `Failed to save client (HTTP ${err.status}).`;
    }
    if (err instanceof Error && err.message) {
      return `Failed to save client: ${err.message}`;
    }
    return 'Failed to save client.';
  }
}
