import { Component, signal, computed, inject, input, output, effect, ElementRef, viewChild, AfterViewInit, OnDestroy } from '@angular/core';
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
export class WarRoomProjectHudComponent implements AfterViewInit, OnDestroy {
  private readonly projectService = inject(ProjectService);
  private readonly hostElement = inject(ElementRef);

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

  readonly collapsed = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly projects = signal<Project[]>([]);

  // Draggable state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private currentX = 0;
  private currentY = 0;

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

  ngAfterViewInit(): void {
    this.setupDraggable();
  }

  ngOnDestroy(): void {
    this.cleanupDraggable();
  }

  private setupDraggable(): void {
    const hudElement = this.hostElement.nativeElement.querySelector('.project-hud');
    const headerElement = this.hostElement.nativeElement.querySelector('.project-hud-header');
    
    if (!hudElement || !headerElement) return;

    headerElement.addEventListener('mousedown', this.onDragStart);
    headerElement.addEventListener('touchstart', this.onDragStart, { passive: false });
  }

  private cleanupDraggable(): void {
    const headerElement = this.hostElement.nativeElement.querySelector('.project-hud-header');
    if (headerElement) {
      headerElement.removeEventListener('mousedown', this.onDragStart);
      headerElement.removeEventListener('touchstart', this.onDragStart);
    }
    document.removeEventListener('mousemove', this.onDrag);
    document.removeEventListener('mouseup', this.onDragEnd);
    document.removeEventListener('touchmove', this.onDrag);
    document.removeEventListener('touchend', this.onDragEnd);
  }

  private onDragStart = (e: MouseEvent | TouchEvent): void => {
    const hudElement = this.hostElement.nativeElement.querySelector('.project-hud');
    if (!hudElement) return;

    // Don't drag if clicking on buttons
    const target = e.target as HTMLElement;
    if (target.classList.contains('project-hud-toggle') || target.closest('.project-hud-toggle')) {
      return;
    }

    this.isDragging = true;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    this.dragStartX = clientX - this.currentX;
    this.dragStartY = clientY - this.currentY;

    document.addEventListener('mousemove', this.onDrag);
    document.addEventListener('mouseup', this.onDragEnd);
    document.addEventListener('touchmove', this.onDrag, { passive: false });
    document.addEventListener('touchend', this.onDragEnd);

    hudElement.style.transition = 'none';
    e.preventDefault();
  };

  private onDrag = (e: MouseEvent | TouchEvent): void => {
    if (!this.isDragging) return;

    const hudElement = this.hostElement.nativeElement.querySelector('.project-hud');
    if (!hudElement) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    this.currentX = clientX - this.dragStartX;
    this.currentY = clientY - this.dragStartY;

    hudElement.style.transform = `translate(${this.currentX}px, ${this.currentY}px)`;
    e.preventDefault();
  };

  private onDragEnd = (): void => {
    if (!this.isDragging) return;

    this.isDragging = false;

    document.removeEventListener('mousemove', this.onDrag);
    document.removeEventListener('mouseup', this.onDragEnd);
    document.removeEventListener('touchmove', this.onDrag);
    document.removeEventListener('touchend', this.onDragEnd);
  };

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
