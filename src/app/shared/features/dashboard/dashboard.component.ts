import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { NgSelectModule } from '@ng-select/ng-select';
import { NgApexchartsModule } from 'ng-apexcharts';
import { forkJoin, map, Observable, Subscription } from 'rxjs';
import { SpkApexChartsComponent } from '../../../@spk/reusable-charts/spk-apex-charts/spk-apex-charts.component';
import { FluorescenceMapComponent } from '../fluorescence-map/fluorescence-map.component';
import { SharedModule } from '../../shared.module';
import * as busPulseData from '../../data/bus-pulse-dashboard';
import { defaultClientProfile } from '../../data/client-profiles-dashboard';
import { projectStats } from '../../data/client-tickets-assets';
import { clientProjects, clientVehicles } from '../../data/client-projects-vehicles';
import {
  DashboardWidget,
  ProjectStats,
  RecentActivity,
} from '../../models/client-dashboard.models';
import { AuthService, CurrentUser } from '../../services/auth.service';
import { ClientService } from '../../services/client.service';
import {
  DashboardProjectOption,
  DashboardProjectsService,
  DashboardVehicleOption,
} from '../../services/dashboard-projects.service';
import {
  applyDefaultWidgetLayout,
  applyWidgetLayout,
  readWidgetLayout,
  saveWidgetLayout,
  sortWidgetsByOrder,
} from './dashboard-layout.utils';
import {
  CLIENT_COMPACT_HIDDEN_WIDGET_IDS,
  DASHBOARD_LAYOUT_STORAGE_KEY,
  DEFAULT_RECENT_ACTIVITIES,
  DEFAULT_WIDGET_LAYOUT,
} from './dashboard.constants';
import {
  buildAdminStatCards,
  buildClientStatCards,
  resolveClientProjectStats,
} from './dashboard-stats.utils';
import { buildProjectStatusChartOptions } from './dashboard-chart.utils';
import { DashboardResizeHandle, DashboardRole, DashboardStatCard } from './dashboard.types';
import { createDefaultDashboardWidgets } from './dashboard.widget-factory';
import {
  applyResizeDelta,
  createResizeSession,
  DashboardResizeSession,
  getNextFullscreenWidgetId,
  getResizeCursor,
} from './dashboard-interactions.utils';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    SharedModule,
    CommonModule,
    FormsModule,
    NgbModule,
    NgSelectModule,
    NgApexchartsModule,
    SpkApexChartsComponent,
    DragDropModule,
    FluorescenceMapComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit, OnDestroy {
  role: DashboardRole = 'client';
  title = 'BusPulse Dashboard';
  welcomeUserName = 'User';

  includeClosedProjects = false;
  showFilters = false;

  selectedProject = 'all';
  selectedVehicle = 'all';
  selectedClient = 'all';

  clients: Array<{ id: string; name: string }> = [{ id: 'all', name: 'All Clients' }];
  projects: DashboardProjectOption[] = [{ id: 'all', name: 'All Projects' }];
  vehicles: DashboardVehicleOption[] = [{ id: 'all', name: 'All Vehicles' }];

  statCards: DashboardStatCard[] = [];
  widgets: DashboardWidget[] = [];
  totalVehiclesCount: number | null = null;
  projectStatusChartOptions: unknown = busPulseData.openClosedProjectsChart;

  fullscreenWidgetId: string | null = null;
  showActivitiesModal = false;
  recentActivities: RecentActivity[] = DEFAULT_RECENT_ACTIVITIES;

  clientProfile = defaultClientProfile;
  customerLogoName = '';
  currentProjectStats: ProjectStats = projectStats[0];

  private readonly STORAGE_KEY = DASHBOARD_LAYOUT_STORAGE_KEY;
  private resizeSession: DashboardResizeSession | null = null;
  private projectsRequestVersion = 0;
  private vehiclesRequestVersion = 0;

  private readonly mouseMoveHandler = (event: MouseEvent) => this.onMouseMove(event);
  private readonly mouseUpHandler = (event: MouseEvent) => this.onMouseUp();
  private readonly keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.fullscreenWidgetId) {
      this.toggleFullscreen(this.fullscreenWidgetId);
    }
  };

  private userSubscription?: Subscription;

  constructor(
    private authService: AuthService,
    private dashboardProjectsService: DashboardProjectsService,
    private clientService: ClientService,
  ) {}

  ngOnInit(): void {
    this.applyRole(this.authService.userRole);

    this.userSubscription = this.authService.currentUser$.subscribe((user) => {
      this.applyRole(user?.role ?? null);
    });

    document.addEventListener('mousemove', this.mouseMoveHandler);
    document.addEventListener('mouseup', this.mouseUpHandler);
    document.addEventListener('keydown', this.keydownHandler);

    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
  }

  ngOnDestroy(): void {
    this.saveLayoutToStorage();
    this.userSubscription?.unsubscribe();
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    document.removeEventListener('mouseup', this.mouseUpHandler);
    document.removeEventListener('keydown', this.keydownHandler);
    document.body.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.overflow = 'auto';
    this.resizeSession = null;
  }

  get isAdminRole(): boolean {
    return this.role === 'admin';
  }

  toggleAdminOpenClosed(): void {
    this.selectedVehicle = 'all';
    this.loadProjects();
  }

  onClientFilterToggle(): void {
    if (!this.showFilters) {
      this.selectedProject = 'all';
      this.selectedVehicle = 'all';
    }

    this.refreshClientView();
  }

  trackByIndex(index: number): number {
    return index;
  }

  getStatIconClass(trendClass: string): string {
    if (trendClass.includes('danger')) {
      return 'stat-icon--danger';
    }

    if (trendClass.includes('warning')) {
      return 'stat-icon--warning';
    }

    if (trendClass.includes('info')) {
      return 'stat-icon--info';
    }

    return 'stat-icon--success';
  }

  onProjectChange(projectId: string): void {
    this.selectedProject = projectId;
    this.selectedVehicle = 'all';
    this.loadVehicles(projectId);

    if (!this.isAdminRole) {
      this.refreshClientView();
    }
  }

  onAdminClientChange(clientId: string): void {
    if (!this.isAdminRole) return;

    this.selectedClient = clientId;
    this.selectedProject = 'all';
    this.selectedVehicle = 'all';
    this.totalVehiclesCount = null;
    this.projects = [{ id: 'all', name: 'All Projects' }];
    this.vehicles = [{ id: 'all', name: 'All Vehicles' }];

    this.loadProjects();
  }

  onVehicleChange(vehicleId: string): void {
    this.selectedVehicle = vehicleId;

    if (!this.isAdminRole) {
      this.refreshClientView();
    }
  }

  onWidgetDrop(event: CdkDragDrop<DashboardWidget[]>): void {
    moveItemInArray(this.widgets, event.previousIndex, event.currentIndex);
    this.widgets.forEach((widget, index) => {
      widget.order = index + 1;
    });
    this.saveLayoutToStorage();
  }

  isWidgetVisible(widget: DashboardWidget): boolean {
    if (!this.showFilters || this.selectedProject === 'all') return true;
    if (this.isAdminRole) return true;
    return !CLIENT_COMPACT_HIDDEN_WIDGET_IDS.includes(widget.id);
  }

  getCompactWidgetHeight(widget: DashboardWidget): number {
    if (!(this.showFilters && this.selectedProject !== 'all')) {
      return widget.height;
    }
    const sameRowWidgets = this.widgets.filter(
      (item) => this.isWidgetVisible(item) && item.width === widget.width,
    );
    return Math.max(...sameRowWidgets.map((item) => item.height), widget.height);
  }

  getWidgetCardHeight(widget: DashboardWidget): number {
    return this.getCompactWidgetHeight(widget);
  }

  getWidgetGridSpan(widget: DashboardWidget): number {
    return widget.width;
  }

  deleteWidget(widgetId: string): void {
    const index = this.widgets.findIndex((widget) => widget.id === widgetId);
    if (index === -1) return;

    this.widgets.splice(index, 1);
    this.widgets.forEach((widget, itemIndex) => {
      widget.order = itemIndex + 1;
    });
    this.saveLayoutToStorage();
  }

  restoreAllWidgets(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    this.initializeWidgets();
  }

  toggleFullscreen(widgetId: string): void {
    this.fullscreenWidgetId = getNextFullscreenWidgetId(this.fullscreenWidgetId, widgetId);
    document.body.style.overflow = this.fullscreenWidgetId ? 'hidden' : 'auto';
  }

  get fullscreenWidget(): DashboardWidget | undefined {
    if (!this.fullscreenWidgetId) return undefined;
    return this.widgets.find((widget) => widget.id === this.fullscreenWidgetId);
  }

  onResizeStart(event: MouseEvent, widgetId: string, handle: 'corner' | 'right' | 'bottom'): void {
    event.preventDefault();
    event.stopPropagation();

    const widget = this.widgets.find((item) => item.id === widgetId);
    if (!widget) return;

    this.resizeSession = createResizeSession(widget, handle as DashboardResizeHandle, event);

    document.body.classList.add('is-resizing');
    document.body.style.cursor = getResizeCursor(handle as DashboardResizeHandle);
  }

  resetDashboardLayout(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    this.initializeWidgets();
    this.widgets = this.buildWidgets();
    this.saveLayoutToStorage();
    window.dispatchEvent(new Event('resize'));
  }

  openActivitiesModal(): void {
    this.showActivitiesModal = true;
    document.body.style.overflow = 'hidden';
  }

  closeActivitiesModal(): void {
    this.showActivitiesModal = false;
    if (!this.fullscreenWidgetId) {
      document.body.style.overflow = 'auto';
    }
  }

  private applyRole(roleValue: string | null): void {
    const normalizedRole = String(roleValue ?? '').trim().toLowerCase();
    const user = this.authService.currentUserValue;
    const userType = Number(user?.type ?? 0);
    const isClientByRoleType = normalizedRole === 'client' || (normalizedRole === 'user' && userType === 3);
    this.role = normalizedRole === 'admin' || normalizedRole === 'superadmin'
      ? 'admin'
      : (isClientByRoleType ? 'client' : 'client');
    this.showFilters = !this.isAdminRole;
    this.includeClosedProjects = false;

    this.welcomeUserName = String(user?.username ?? user?.email ?? 'User').split('@')[0] || 'User';
    this.title = this.isAdminRole ? 'BusPulse Fleet Dashboard' : 'BusPulse Client Dashboard';
    this.loadClientBranding(user);

    this.selectedProject = 'all';
    this.selectedVehicle = 'all';
    this.selectedClient = 'all';
    this.totalVehiclesCount = null;
    this.clients = this.isAdminRole ? [{ id: 'all', name: 'All Clients' }] : [];
    this.projects = this.isAdminRole ? [{ id: 'all', name: 'All Projects' }] : [...clientProjects];
    this.vehicles = this.isAdminRole ? [{ id: 'all', name: 'All Vehicles' }] : [...clientVehicles];

    if (this.isAdminRole) {
      this.loadClientOptions();
    }

    this.initializeWidgets();
    this.loadProjects();

    if (this.isAdminRole) {
      this.setAdminStatCards();
      return;
    }

    this.refreshClientView();
  }

  private loadProjects(): void {
    const effectiveClientId = this.getEffectiveClientId();
    const requestVersion = ++this.projectsRequestVersion;
    ++this.vehiclesRequestVersion;

    this.dashboardProjectsService.getProjectOptions({
      clientId: effectiveClientId,
      includeClosed: this.includeClosedProjects,
      page: 1,
      pageSize: 10000,
    }).subscribe({
      next: (items) => {
        if (requestVersion !== this.projectsRequestVersion) return;

        this.projects = items.length
          ? items
          : (this.isAdminRole
              ? [{ id: 'all', name: 'All Projects' }]
              : [...clientProjects]);

        const hasSelectedProject = this.projects.some((project) => project.id === this.selectedProject);
        if (!hasSelectedProject) {
          this.selectedProject = 'all';
        }

        this.updateProjectStatusChart(this.projects);

        this.loadVehicles(this.selectedProject);
        if (!this.isAdminRole) {
          this.refreshClientView();
        }
      },
      error: () => {
        if (requestVersion !== this.projectsRequestVersion) return;

        this.projects = this.isAdminRole ? [{ id: 'all', name: 'All Projects' }] : [...clientProjects];
        this.selectedProject = 'all';
        this.selectedVehicle = 'all';
        this.updateProjectStatusChart(this.projects);
        this.loadVehicles(this.selectedProject);
        if (!this.isAdminRole) {
          this.refreshClientView();
        }
      },
    });
  }

  private loadVehicles(projectId: string): void {
    const currentUser = this.authService.currentUserValue;
    const effectiveClientId = this.getEffectiveClientId();
    const requestVersion = ++this.vehiclesRequestVersion;

    let vehicleRequest$: Observable<{ options: DashboardVehicleOption[]; totalCount: number }>;

    if (projectId === 'all') {
      const visibleProjectIds = this.projects
        .map((project) => String(project.id ?? ''))
        .filter((id) => id && id.toLowerCase() !== 'all');

      vehicleRequest$ = forkJoin({
        scoped: this.dashboardProjectsService.getVehicleOptionsByProjectsResult(
          visibleProjectIds,
          {
            clientId: effectiveClientId,
            userId: currentUser?.userId ?? undefined,
            includeClosed: this.includeClosedProjects,
          },
        ),
        authoritative: this.dashboardProjectsService.getAllVehicleOptionsResult({
          clientId: effectiveClientId,
          userId: currentUser?.userId ?? undefined,
          includeClosed: this.includeClosedProjects,
        }),
      }).pipe(
        map(({ scoped, authoritative }) => ({
          options: scoped.options,
          totalCount: this.includeClosedProjects
            ? (Number(authoritative.totalCount ?? 0) > 0
                ? authoritative.totalCount
                : scoped.totalCount)
            : scoped.totalCount,
        })),
      );
    } else {
      vehicleRequest$ = this.dashboardProjectsService.getVehicleOptionsByProjectResult(projectId, {
        clientId: effectiveClientId,
        userId: currentUser?.userId ?? undefined,
        includeClosed: undefined,
      });
    }

    vehicleRequest$.subscribe({
      next: (result) => {
        if (requestVersion !== this.vehiclesRequestVersion) return;

        const options = result.options ?? [];
        this.vehicles = options.length ? options : [{ id: 'all', name: 'All Vehicles' }];

        const hasSelectedVehicle = this.vehicles.some((vehicle) => vehicle.id === this.selectedVehicle);
        if (!hasSelectedVehicle) {
          this.selectedVehicle = 'all';
        }

        const explicitTotal = Number(result.totalCount ?? 0);
        const derivedTotal = options.filter((vehicle) => vehicle.id !== 'all').length;
        this.totalVehiclesCount = Number.isFinite(explicitTotal) && explicitTotal > 0
          ? explicitTotal
          : derivedTotal;

        if (this.isAdminRole) {
          this.setAdminStatCards();
        } else {
          this.refreshClientView();
        }
      },
      error: () => {
        if (requestVersion !== this.vehiclesRequestVersion) return;

        this.vehicles = this.isAdminRole ? [{ id: 'all', name: 'All Vehicles' }] : [...clientVehicles];
        this.selectedVehicle = 'all';
        this.totalVehiclesCount = null;
      },
    });
  }

  private loadClientOptions(): void {
    this.clientService.getClients().subscribe({
      next: (items) => {
        const mapped = items
          .map((client) => ({
            id: String(client.id ?? '').trim(),
            name: String(client.name ?? '').trim(),
          }))
          .filter((client) => client.id && client.name)
          .sort((left, right) => left.name.localeCompare(right.name));

        this.clients = [{ id: 'all', name: 'All Clients' }, ...mapped];

        const hasSelectedClient = this.clients.some((client) => client.id === this.selectedClient);
        if (!hasSelectedClient) {
          this.selectedClient = 'all';
        }
      },
      error: () => {
        this.clients = [{ id: 'all', name: 'All Clients' }];
        this.selectedClient = 'all';
      },
    });
  }

  private loadClientBranding(user: CurrentUser | null): void {
    if (this.isAdminRole) {
      this.clientProfile = defaultClientProfile;
      this.customerLogoName = '';
      return;
    }

    const fallbackProfile = {
      ...defaultClientProfile,
      clientId: String(user?.clientId ?? defaultClientProfile.clientId),
      logoUrl: '',
    };
    this.clientProfile = fallbackProfile;
    this.customerLogoName = '';

    const clientId = String(user?.clientId ?? '').trim();
    if (!clientId) {
      return;
    }

    this.clientService.getClientById(clientId).subscribe({
      next: (client) => {
        if (!client) {
          return;
        }

        this.clientProfile = {
          ...fallbackProfile,
          name: client.name || fallbackProfile.name,
          clientId,
          logoUrl: client.logoUrl || '',
          vehicle: client.name || fallbackProfile.vehicle,
        };
        this.customerLogoName = client.logoName || client.name || '';
      },
      error: () => {
        this.clientProfile = fallbackProfile;
        this.customerLogoName = '';
      },
    });
  }

  private getEffectiveClientId(): number | undefined {
    if (this.isAdminRole) {
      if (this.selectedClient === 'all') {
        return undefined;
      }

      const parsed = Number(this.selectedClient);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return this.authService.currentUserValue?.clientId ?? undefined;
  }

  private setAdminStatCards(): void {
    const source = busPulseData.dashboardStats;
    const totalProjects = this.projects.filter((project) => project.id !== 'all').length || source.totalProjects;

    this.updateProjectStatusChart(this.projects);
    this.statCards = buildAdminStatCards(source, totalProjects, this.totalVehiclesCount);
  }

  private refreshClientView(): void {
    this.currentProjectStats = resolveClientProjectStats(
      projectStats,
      this.selectedProject,
      this.selectedVehicle,
    );

    this.statCards = buildClientStatCards(
      this.currentProjectStats,
      this.showFilters,
      this.selectedProject,
    );

    this.widgets = this.buildWidgets();
    this.loadLayoutFromStorage();
  }

  private initializeWidgets(): void {
    this.widgets = createDefaultDashboardWidgets();
    this.updateProjectStatusWidget(this.projectStatusChartOptions);

    this.loadLayoutFromStorage();
  }

  private updateProjectStatusChart(projects: DashboardProjectOption[]): void {
    this.projectStatusChartOptions = buildProjectStatusChartOptions(
      busPulseData.openClosedProjectsChart,
      projects,
    );

    this.updateProjectStatusWidget(this.projectStatusChartOptions);
  }

  private updateProjectStatusWidget(chartOptions: unknown): void {
    if (!this.widgets.length) return;

    this.widgets = this.widgets.map((widget) => (
      widget.id === 'widget-1'
        ? { ...widget, chartOptions }
        : widget
    ));
  }

  private buildWidgets(): DashboardWidget[] {
    const base = sortWidgetsByOrder(this.widgets).map((item) => ({ ...item }));

    if (!this.isAdminRole) {
      const clientBase = base.filter((widget) => widget.id !== 'widget-14');

      if (this.showFilters && this.selectedProject !== 'all') {
        return clientBase.filter((widget) => !CLIENT_COMPACT_HIDDEN_WIDGET_IDS.includes(widget.id));
      }

      return clientBase;
    }

    return base;
  }

  private loadLayoutFromStorage(): void {
    try {
      const parsedLayout = readWidgetLayout(this.STORAGE_KEY);
      if (!parsedLayout) return;

      this.widgets = sortWidgetsByOrder(applyWidgetLayout(this.widgets, parsedLayout));
    } catch {
      this.applyDefaultWidgetLayout();
    }
  }

  private saveLayoutToStorage(): void {
    try {
      saveWidgetLayout(this.STORAGE_KEY, this.widgets);
    } catch {
      // ignore storage write failures
    }
  }

  private applyDefaultWidgetLayout(): void {
    this.widgets = sortWidgetsByOrder(applyDefaultWidgetLayout(this.widgets, DEFAULT_WIDGET_LAYOUT));
    this.saveLayoutToStorage();
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.resizeSession) return;

    const resized = applyResizeDelta(this.widgets, this.resizeSession, event);
    if (!resized) return;

    window.dispatchEvent(new Event('resize'));
  }

  private onMouseUp(): void {
    if (!this.resizeSession) return;

    this.resizeSession = null;
    document.body.classList.remove('is-resizing');
    document.body.style.cursor = '';
    window.dispatchEvent(new Event('resize'));
    this.saveLayoutToStorage();
  }
}
