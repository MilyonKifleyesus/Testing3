import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { ClientService } from '../../../services/client.service';
import { ProjectService } from '../../../services/project.service';
import { buildPaginationItems, PAGINATION_ELLIPSIS } from '../../../utils/pagination.utils';
import { resolveProjectManagementContext } from '../project-management-context';

interface ProjectRow {
  id: string | number;
  projectName: string;
  client: string;
  assessmentType: string;
  location: string;
  totalAssets: number | null;
  userAccess: string[];
  status: 'Open' | 'Closed' | 'Delayed';
}

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './project-list.component.html',
  styleUrls: ['./project-list.component.scss']
})
export class ProjectListComponent implements OnInit, OnDestroy {
  readonly paginationEllipsis = PAGINATION_ELLIPSIS;
  readonly pageSize = 10;

  isLoadingClients = false;
  isLoadingProjects = false;
  clients: Array<{ id: string; name: string }> = [{ id: 'all', name: 'All Clients' }];
  selectedClientId = 'all';

  projects: ProjectRow[] = [];
  totalCount = 0;
  currentPage = 1;
  sortColumn = 'id';
  sortDirection: 'asc' | 'desc' = 'asc';
  searchTerm = '';

  private readonly subscriptions = new Subscription();
  private loadSub?: Subscription;
  private readonly portalPrefix: '/admin' | '/client';
  private readonly scopedClientId: string | null;

  get isClientPortal(): boolean {
    return this.portalPrefix === '/client';
  }

  get canManageProjects(): boolean {
    return this.portalPrefix === '/admin';
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  get filteredProjects(): ProjectRow[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.projects;
    return this.projects.filter((p) =>
      p.projectName.toLowerCase().includes(term) ||
      p.client.toLowerCase().includes(term)
    );
  }

  get paginatedProjects(): ProjectRow[] {
    return this.filteredProjects;
  }

  get visiblePages(): number[] {
    return buildPaginationItems(this.totalPages, this.currentPage, 5);
  }

  get pageStartItem(): number {
    if (!this.totalCount) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEndItem(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalCount);
  }

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly authService: AuthService,
    private readonly projectService: ProjectService,
    private readonly clientService: ClientService,
  ) {
    const context = resolveProjectManagementContext(
      this.authService.currentUserValue,
      this.route.snapshot.queryParamMap.get('clientId'),
    );
    this.portalPrefix = context.portalPrefix;
    this.scopedClientId = context.scopedClientId;
  }

  ngOnInit(): void {
    // Load clients for the dropdown filter
    this.isLoadingClients = true;
    const clientsSub = this.clientService.getClients().subscribe({
      next: (items) => {
        const mapped = items
          .map((c) => ({ id: String(c.id ?? '').trim(), name: String(c.name ?? '').trim() }))
          .filter((c) => c.id && c.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        this.clients = [{ id: 'all', name: 'All Clients' }, ...mapped];
        this.isLoadingClients = false;
      },
      error: () => {
        this.clients = [{ id: 'all', name: 'All Clients' }];
        this.isLoadingClients = false;
      },
    });
    this.subscriptions.add(clientsSub);

    // Pre-select scoped client for client portal
    if (this.scopedClientId) {
      this.selectedClientId = this.scopedClientId;
    }

    this.loadProjects();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private loadProjects(): void {
    this.isLoadingProjects = true;
    this.loadSub?.unsubscribe();

    const clientId = this.selectedClientId === 'all' ? 0 : Number(this.selectedClientId) || 0;

    this.loadSub = this.projectService.getProjectsPagedList({
      page: this.currentPage,
      pageSize: this.pageSize,
      sortBy: this.sortColumn,
      sortDirection: this.sortDirection,
      clientId,
      includeClosed: true,
    }).subscribe({
      next: ({ projects, totalCount }) => {
        this.projects = projects.map((project) => ({
          id: project.id,
          projectName: project.projectName?.trim() ? project.projectName : '-',
          client: this.clientService.resolveClientName(project.clientId, project.clientName ?? project.clientId ?? '-'),
          assessmentType: project.assessmentType,
          location: project.location ?? project.manufacturerLocationId ?? '-',
          totalAssets: typeof project.totalAssets === 'number' && Number.isFinite(project.totalAssets)
            ? project.totalAssets
            : null,
          userAccess: project.userAccess ?? [],
          status: project.status ?? 'Open',
        }));
        this.totalCount = totalCount;
        this.isLoadingProjects = false;
      },
      error: () => {
        this.isLoadingProjects = false;
      },
    });
    this.subscriptions.add(this.loadSub);
  }

  sortProjects(column: string): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.currentPage = 1;
    this.loadProjects();
  }

  onClientFilterChange(): void {
    this.currentPage = 1;
    this.loadProjects();
  }

  onSearchTermChange(): void {
    // Search filters the current page client-side
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.loadProjects();
  }

  previousPage(): void {
    this.changePage(this.currentPage - 1);
  }

  nextPage(): void {
    this.changePage(this.currentPage + 1);
  }

  createProject(): void {
    if (!this.canManageProjects) return;
    this.router.navigate([`${this.portalPrefix}/projects/new`]);
  }

  viewProjectDetails(projectId: string | number): void {
    this.router.navigate([`${this.portalPrefix}/projects/view`, projectId]);
  }

  goToTickets(projectId: string | number): void {
    this.router.navigate([`${this.portalPrefix}/tickets`], { queryParams: { projectId } });
  }

  closeProject(projectId: string | number): void {
    if (!this.canManageProjects) return;
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.status === 'Closed') return;
    if (confirm('Are you sure you want to close this project?')) {
      project.status = 'Closed';
    }
  }

  deleteProject(projectId: string | number): void {
    if (!this.canManageProjects) return;
    if (confirm('Are you sure you want to delete this project?')) {
      this.projects = this.projects.filter((item) => item.id !== projectId);
      this.totalCount = Math.max(0, this.totalCount - 1);
    }
  }
}
