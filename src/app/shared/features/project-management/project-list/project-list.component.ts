import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, combineLatest, forkJoin, map, of, catchError } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { ClientService } from '../../../services/client.service';
import { DashboardProjectsService } from '../../../services/dashboard-projects.service';
import { ProjectService } from '../../../services/project.service';
import { buildPaginationItems, PAGINATION_ELLIPSIS } from '../../../utils/pagination.utils';
import { resolveProjectManagementContext } from '../project-management-context';

interface ProjectRow {
  id: string | number;
  projectName: string;
  client: string;
  assessmentType: string;
  location: string;
  manufacturer: string;
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
    // --- Added for template compatibility ---
    selectedClientId: string = 'all';
    isLoadingClients = false;
    clients: Array<{ id: string; name: string }> = [
      { id: 'all', name: 'All Clients' }
    ];

    get isClientPortal(): boolean {
      return this.portalPrefix === '/client';
    }
    sortColumn: string = '';
    sortDirection: 'asc' | 'desc' = 'asc';

    onClientFilterChange(): void {
      // TODO: Implement client filter logic
      // For now, just reload projects or filter as needed
      this.currentPage = 1;
    }

    sortProjects(column: string): void {
      if (this.sortColumn === column) {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortColumn = column;
        this.sortDirection = 'asc';
      }
      // TODO: Implement actual sorting logic
      // For now, just trigger change detection
      this.currentPage = 1;
    }
  readonly paginationEllipsis = PAGINATION_ELLIPSIS;
  readonly pageSize = 10;

  projects: ProjectRow[] = [];
  isLoadingProjects = false;
  searchTerm = '';
  currentPage = 1;

  private readonly subscriptions = new Subscription();
  private readonly portalPrefix: '/admin' | '/client';
  private readonly scopedClientId: string | null;

  get canManageProjects(): boolean {
    return this.portalPrefix === '/admin';
  }

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly authService: AuthService,
    private readonly projectService: ProjectService,
    private readonly clientService: ClientService,
    private readonly dashboardProjectsService: DashboardProjectsService,
  ) {
    const context = resolveProjectManagementContext(
      this.authService.currentUserValue,
      this.route.snapshot.queryParamMap.get('clientId'),
    );

    this.portalPrefix = context.portalPrefix;
    this.scopedClientId = context.scopedClientId;
  }

  ngOnInit(): void {
        // If logged in as client, auto-select and restrict client filter
        if (this.isClientPortal && this.scopedClientId) {
          this.selectedClientId = this.scopedClientId;
          this.clients = [{ id: this.scopedClientId, name: 'Your Client' }];
          this.isLoadingClients = false;
        }
    this.isLoadingProjects = true;
    const filters = this.scopedClientId ? { clientId: this.scopedClientId } : {};

    const sub = combineLatest([
      this.projectService.getProjectsWithRefresh(filters),
      this.clientService.getClientNameMap(),
    ]).subscribe({
      next: ([projects]) => {
        console.log('Loaded projects:', projects);
        const uniqueProjectIds = Array.from(new Set(
          projects
            .map((project) => String(project.id ?? '').trim())
            .filter((id) => id.length > 0),
        ));

        const assetCountRequests = uniqueProjectIds.map((projectId) =>
          this.dashboardProjectsService
            .getVehicleOptionsByProjectResult(projectId, {
              includeAllOption: false,
              page: 1,
              pageSize: 10000,
            })
            .pipe(
              map((result) => [projectId, result.totalCount] as const),
              catchError(() => of([projectId, null] as const)),
            ),
        );

        const counts$ = assetCountRequests.length
          ? forkJoin(assetCountRequests)
          : of([] as ReadonlyArray<readonly [string, number | null]>);

        const countsSub = counts$.subscribe({
          next: (pairs) => {
            const projectAssetCountMap = new Map<string, number | null>(pairs as Array<[string, number | null]>);

            this.projects = projects.map((project) => {
              const projectId = String(project.id ?? '').trim();
              const mappedAssetCount = projectAssetCountMap.get(projectId);
              const fallbackAssetCount =
                typeof project.totalAssets === 'number' && Number.isFinite(project.totalAssets)
                  ? project.totalAssets
                  : null;

              return {
                id: project.id,
                projectName: project.projectName?.trim() ? project.projectName : '-',
                client: this.clientService.resolveClientName(project.clientId, project.clientName ?? project.clientId ?? '-'),
                assessmentType: project.assessmentType,
                location: project.manufacturerLocationId ?? '-',
                manufacturer: project.manufacturer ?? '-',
                totalAssets: typeof mappedAssetCount === 'number' ? mappedAssetCount : fallbackAssetCount,
                userAccess: project.userAccess ?? [],
                status: project.status ?? 'Open',
              };
            });

            this.currentPage = 1;
            this.isLoadingProjects = false;
          },
          error: () => {
            this.isLoadingProjects = false;
          }
        });

        this.subscriptions.add(countsSub);
      },
      error: () => {
        this.isLoadingProjects = false;
      }
    });

    this.subscriptions.add(sub);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredProjects.length / this.pageSize));
  }

  get filteredProjects(): ProjectRow[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.projects;
    return this.projects.filter((project) =>
      (project.projectName ?? '').toLowerCase().includes(term)
    );
  }

  get paginatedProjects(): ProjectRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredProjects.slice(start, start + this.pageSize);
  }

  get visiblePages(): number[] {
    return buildPaginationItems(this.totalPages, this.currentPage, 5);
  }

  get pageStartItem(): number {
    if (!this.filteredProjects.length) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEndItem(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredProjects.length);
  }

  onSearchTermChange(): void {
    this.currentPage = 1;
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
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
      if (this.currentPage > this.totalPages) {
        this.currentPage = this.totalPages;
      }
    }
  }

}
