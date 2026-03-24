import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, NgZone, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { NgSelectModule } from '@ng-select/ng-select';
import { NgApexchartsModule } from 'ng-apexcharts';
import { firstValueFrom, forkJoin, map, Observable, Subscription } from 'rxjs';
import { SpkApexChartsComponent } from '../../../@spk/reusable-charts/spk-apex-charts/spk-apex-charts.component';
import { SharedModule } from '../../shared.module';
import * as busPulseData from '../../data/bus-pulse-dashboard';
import { defaultClientProfile } from '../../data/client-profiles-dashboard';
import { projectStats } from '../../data/client-tickets-assets';
import {
  DashboardWidget,
  ProjectStats,
  RecentActivity,
} from '../../models/client-dashboard.models';
import { AuthService, CurrentUser } from '../../services/auth.service';
import { ClientService } from '../../services/client.service';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import {
  DashboardProjectOption,
  DashboardProjectsService,
  DashboardVehicleMakeModelDatum,
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
  ADMIN_DEFAULT_WIDGET_LAYOUT,
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
import {
  buildProjectStatusChartOptions,
  buildVehiclesByMakeModelChartOptions,
  buildVehiclesByPropulsionTypeChartOptions,
} from './dashboard-chart.utils';
import { DashboardResizeHandle, DashboardRole, DashboardStatCard } from './dashboard.types';
import { createDefaultDashboardWidgets } from './dashboard.widget-factory';
import { DashboardSnapshot, DashboardStateService } from './dashboard-state.service';
import {
  applyResizeDeltaToDom,
  createResizeSession,
  DashboardResizeSession,
  getNextFullscreenWidgetId,
  getResizeCursor,
} from './dashboard-interactions.utils';
import { ToastService } from '../../../components/elements/toast/toast.service';
import { MapStageComponent } from '../fleet-map/components/map-stage/map-stage.component';
import type {
  ApiClient,
  ApiLocation,
  ApiManufacturer,
  ApiProject,
  FleetMode,
  FleetSelectedEntity,
} from '../fleet-map/models/fleet-map.models';
import { FleetMapApiService } from '../fleet-map/services/fleet-map-api.service';
import { getProjectStatusDisplayLabel } from '../fleet-map/utils/fleet-map-status';
import { AppStateService } from '../../services/app-state.service';
import { UserManagementService } from '../../services/user-management.service';
import { extractArrayFromApiResponse } from '../../utils/api-data.utils';

type DashboardMapStatusFilter = 'all' | ApiProject['status'];

interface DashboardMapFilterOption {
  id: string;
  label: string;
}

type DashboardMapStatusOption = { id: DashboardMapStatusFilter; label: string };

const DASHBOARD_MAP_STATUS_OPTIONS: DashboardMapStatusOption[] = [
  { id: 'all', label: 'All Statuses' },
  { id: 'active', label: getProjectStatusDisplayLabel('active') },
  { id: 'inactive', label: getProjectStatusDisplayLabel('inactive') },
];

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
    MapStageComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit, OnDestroy {
      private debounceDashboardMapView(): void {
        if (this.dashboardFilterChangeTimeout) {
          clearTimeout(this.dashboardFilterChangeTimeout);
        }
        this.dashboardFilterChangeTimeout = setTimeout(() => {
          this.updateDashboardMapView();
        }, this.dashboardFilterDebounceMs);
      }
    // ...existing code...
      private dashboardFilterChangeTimeout: any = null;
      private readonly dashboardFilterDebounceMs = 150;
    userIdToUsername: { [id: number]: string } = {};

    constructor(
      private authService: AuthService,
      private dashboardProjectsService: DashboardProjectsService,
      private clientService: ClientService,
      @Inject(ClientDashboardService) private clientDashboardService: ClientDashboardService,
      private toastService: ToastService,
      private fleetMapApiService: FleetMapApiService,
      private appStateService: AppStateService,
      private userManagementService: UserManagementService,
      private location: Location,
      private route: ActivatedRoute,
      private cdr: ChangeDetectorRef,
      private ngZone: NgZone,
      private dashboardStateService: DashboardStateService,
    ) {}
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
  userPicture = '';

  allClientVehicles: any[] = [];
  allClientTickets: any[] = [];

  readonly dashboardMapMode: FleetMode = 'projects';

  dashboardMapLoading = true;
  dashboardMapError = '';
  dashboardMapIsDark = false;
  dashboardMapProjects: ApiProject[] = [];
  dashboardMapClients: ApiClient[] = [];
  dashboardMapManufacturers: ApiManufacturer[] = [];
  dashboardMapLocations: ApiLocation[] = [];
  dashboardMapViewedProject: ApiProject | null = null;
  dashboardMapSelectedEntity: FleetSelectedEntity | null = null;
  dashboardMapSelectedStatus: DashboardMapStatusFilter = 'all';
  dashboardMapSelectedManufacturerIds: string[] = [];
  dashboardMapManufacturerOptions: DashboardMapFilterOption[] = [];
  readonly dashboardMapStatusOptions = DASHBOARD_MAP_STATUS_OPTIONS;

  private allMapProjects: ApiProject[] = [];
  private allMapClients: ApiClient[] = [];
  private allMapManufacturers: ApiManufacturer[] = [];
  private allMapLocations: ApiLocation[] = [];
  private dashboardMapDataLoaded = false;

  private dataInitialized = false;
  private resizeSession: DashboardResizeSession | null = null;
  private projectsRequestVersion = 0;
  private vehiclesRequestVersion = 0;
  private makeModelRequestVersion = 0;
  private propulsionRequestVersion = 0;
  private vehicleStationRequestVersion = 0;
  private stationTypeHeatmapRequestVersion = 0;
  private stationTimeComparisonRequestVersion = 0;
  private ticketsDashboardRequestVersion = 0;
  // Labels shown in the left column of widget-15 (vehicle list)
  vehicleStationLabels: string[] = [];
  vehicleStationMergeByType = false;
  vehicleStationPage = 1;
  readonly vehicleStationPageSize = 500;
  vehicleStationHasNextPage = false;
  stationTypeHeatmapPage = 1;
  readonly stationTypeHeatmapPageSize = 500;
  stationTypeHeatmapHasNextPage = false;
  stationTimeComparisonPage = 1;
  readonly stationTimeComparisonPageSize = 500;
  stationTimeComparisonHasNextPage = false;
  private readonly stationTrackerFieldsForStationTypeHeatmap = [
    'stationTypeName',
    'station_type_name',
    'stationType',
    'vehicleId',
    'vehicleID',
    'vehicle_id',
  ];
  private readonly stationTrackerFieldsForStationTimeComparison = [
    'stationTypeName',
    'station_type_name',
    'stationType',
    'vehicleId',
    'vehicleID',
    'vehicle_id',
    'VehicleId',
    'VehicleID',
    'vehicle',
    'startDate',
    'dateStarted',
    'date_start',
    'start_date',
    'startedDate',
    'started_at',
    'endDate',
    'dateEnded',
    'date_end',
    'end_date',
    'completedDate',
    'dateCompleted',
    'ended_at',
  ];
  private readonly stationTrackerFieldsForVehicleStationTracking = [
    'vehicleId',
    'vehicleID',
    'vehicle_id',
    'startDate',
    'dateStarted',
    'endDate',
    'dateEnded',
    'stationTypeName',
    'station_type_name',
    'stationId',
    'stationID',
    'station_id',
    'stationNumber',
    'stationNo',
    'stationName',
    'description',
  ];

  private readonly stationTypeColorMap: Record<string, string> = {
    production: '#8fa89a',
    final: '#b7e4c7',
    shipped: '#1b5e20',
    client: '#2f855a',
    none: '#a3b86c',
    unspecified: '#a3b86c',
  };

  private readonly mouseMoveHandler = (event: MouseEvent) => this.onMouseMove(event);
  private readonly mouseUpHandler = () => this.ngZone.run(() => this.onMouseUp());
  private readonly keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.fullscreenWidgetId) {
      this.toggleFullscreen(this.fullscreenWidgetId);
    }
  };

  private userSubscription?: Subscription;
  private themeSubscription?: Subscription;


  ngOnInit(): void {
    try {
      this.syncDashboardTheme();
      const cached = this.dashboardStateService.snapshot;
      const currentRole = this.computeRole(this.authService.userRole);
      if (cached && cached.role === currentRole) {
        this.restoreFromSnapshot(cached);
      } else {
        this.dashboardStateService.snapshot = null;
        this.applyRole(this.authService.userRole);
        // On hard refresh, always start from default filters.
        // Keep URL in sync with defaults instead of restoring query params.
        this.updateQueryParams();
        this.fetchAllClientVehiclesAndTickets();
        this.loadDashboardMapData();
      }
    } catch (err) {
      this.toastService.show('Client dashboard initialization failed: ' + (typeof err === 'object' && err && 'message' in err ? (err as any).message : String(err)), { classname: 'bg-danger text-light', autohide: true });
    }

    this.userSubscription = this.authService.currentUser$.subscribe((user) => {
      // Always sync user picture (may arrive async after login)
      const newPicture = user?.picture || '';
      if (this.userPicture !== newPicture) {
        this.userPicture = newPicture;
        this.cdr.markForCheck();
      }
      // Skip full re-init if role hasn't changed â€” covers the immediate BehaviorSubject emit on subscribe
      if (this.isRoleMatch(user?.role ?? null)) {
        this.cdr.markForCheck();
        return;
      }
      // Role changed â€” invalidate cache and re-initialize
      this.dataInitialized = false;
      this.dashboardStateService.snapshot = null;
      try {
        this.applyRole(user?.role ?? null);
      } catch (err) {
        this.toastService.show('Client dashboard role error: ' + (typeof err === 'object' && err && 'message' in err ? (err as any).message : String(err)), { classname: 'bg-danger text-light', autohide: true });
      }
      this.cdr.markForCheck();
    });
    this.themeSubscription = this.appStateService.state$.subscribe((state) => {
      this.syncDashboardTheme(state?.theme);
      this.cdr.markForCheck();
    });

    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('mousemove', this.mouseMoveHandler);
      document.addEventListener('mouseup', this.mouseUpHandler);
    });
    document.addEventListener('keydown', this.keydownHandler);

    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
  }

  ngOnDestroy(): void {
    this.saveLayoutToStorage();
    // Persist dashboard state for next navigation (cleared on browser refresh).
    // Only save when widgets actually have chart data â€” skip if data never finished loading.
    const hasData = this.widgets.some(w => w.chartOptions);
    if (this.dataInitialized && hasData) {
      this.dashboardStateService.snapshot = {
        role: this.role,
        widgets: this.widgets.map(w => ({ ...w })),
        statCards: [...this.statCards],
        projects: [...this.projects],
        vehicles: [...this.vehicles],
        clients: [...this.clients],
        totalVehiclesCount: this.totalVehiclesCount,
        allClientVehicles: [...this.allClientVehicles],
        allClientTickets: [...this.allClientTickets],
        userIdToUsername: { ...this.userIdToUsername },
        allMapProjects: [...this.allMapProjects],
        allMapClients: [...this.allMapClients],
        allMapManufacturers: [...this.allMapManufacturers],
        allMapLocations: [...this.allMapLocations],
        dashboardMapDataLoaded: this.dashboardMapDataLoaded,
        welcomeUserName: this.welcomeUserName,
        vehicleStationLabels: [...this.vehicleStationLabels],
        clientProfile: this.clientProfile,
        customerLogoName: this.customerLogoName,
        showFilters: this.showFilters,
        includeClosedProjects: this.includeClosedProjects,
        selectedProject: this.selectedProject,
        selectedVehicle: this.selectedVehicle,
        selectedClient: this.selectedClient,
        currentProjectStats: this.currentProjectStats,
        stationTypeHeatmapPage: this.stationTypeHeatmapPage,
        stationTypeHeatmapHasNextPage: this.stationTypeHeatmapHasNextPage,
        stationTimeComparisonPage: this.stationTimeComparisonPage,
        stationTimeComparisonHasNextPage: this.stationTimeComparisonHasNextPage,
      } satisfies DashboardSnapshot;
    }
    this.userSubscription?.unsubscribe();
    this.themeSubscription?.unsubscribe();
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    document.removeEventListener('mouseup', this.mouseUpHandler);
    document.removeEventListener('keydown', this.keydownHandler);
    document.body.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.overflow = 'auto';
    this.resizeSession = null;
  }

  private computeRole(roleValue: string | null): DashboardRole {
    const normalized = String(roleValue ?? '').trim().toLowerCase();
    return normalized === 'admin' || normalized === 'superadmin' ? 'admin' : 'client';
  }

  /** Returns true if the given role string resolves to the same DashboardRole as currently active. */
  private isRoleMatch(roleValue: string | null): boolean {
    return this.computeRole(roleValue) === this.role;
  }

  /** Restores full dashboard state from a cached snapshot without any API fetches. */
  private restoreFromSnapshot(snapshot: DashboardSnapshot): void {
    this.role = snapshot.role;
    // Dashboard snapshot may be captured during in-flight loads; always clear stale loading flags.
    this.widgets = snapshot.widgets.map(w => ({ ...w, loading: false }));
    this.statCards = [...snapshot.statCards];
    this.projects = [...snapshot.projects];
    this.vehicles = [...snapshot.vehicles];
    this.clients = [...snapshot.clients];
    this.totalVehiclesCount = snapshot.totalVehiclesCount;
    this.allClientVehicles = [...snapshot.allClientVehicles];
    this.allClientTickets = [...snapshot.allClientTickets];
    this.userIdToUsername = { ...snapshot.userIdToUsername };
    this.allMapProjects = [...snapshot.allMapProjects];
    this.allMapClients = [...snapshot.allMapClients];
    this.allMapManufacturers = [...snapshot.allMapManufacturers];
    this.allMapLocations = [...snapshot.allMapLocations];
    this.dashboardMapDataLoaded = snapshot.dashboardMapDataLoaded;
    this.welcomeUserName = snapshot.welcomeUserName;
    this.vehicleStationLabels = [...snapshot.vehicleStationLabels];
    this.clientProfile = snapshot.clientProfile;
    this.customerLogoName = snapshot.customerLogoName;
    this.showFilters = snapshot.showFilters;
    this.includeClosedProjects = snapshot.includeClosedProjects;
    this.selectedProject = snapshot.selectedProject;
    this.selectedVehicle = snapshot.selectedVehicle;
    this.selectedClient = snapshot.selectedClient;
    this.currentProjectStats = snapshot.currentProjectStats;
    this.stationTypeHeatmapPage = Number.isFinite(snapshot.stationTypeHeatmapPage)
      ? Math.max(1, Math.round(snapshot.stationTypeHeatmapPage))
      : 1;
    this.stationTypeHeatmapHasNextPage = !!snapshot.stationTypeHeatmapHasNextPage;
    this.stationTimeComparisonPage = Number.isFinite(snapshot.stationTimeComparisonPage)
      ? Math.max(1, Math.round(snapshot.stationTimeComparisonPage))
      : 1;
    this.stationTimeComparisonHasNextPage = !!snapshot.stationTimeComparisonHasNextPage;
    this.title = this.isAdminRole ? 'BusPulse Fleet Dashboard' : 'BusPulse Client Dashboard';
    this.dashboardMapLoading = false;
    this.updateDashboardMapView();
    this.dataInitialized = true;
    this.cdr.markForCheck();
  }

  // Sync handlers for widget-15 scrollable chart/labels column
  onChartScroll(chartEl: HTMLElement, labelsEl: HTMLElement): void {
    try {
      if (labelsEl && chartEl) labelsEl.scrollTop = chartEl.scrollTop;
    } catch { /* ignore */ }
  }

  onLabelsScroll(labelsEl: HTMLElement, chartEl: HTMLElement): void {
    try {
      if (labelsEl && chartEl) chartEl.scrollTop = labelsEl.scrollTop;
    } catch { /* ignore */ }
  }

  get isAdminRole(): boolean {
    return this.role === 'admin';
  }

  toggleAdminOpenClosed(): void {
    this.selectedProject = 'all';
    this.selectedVehicle = 'all';
    this.dashboardProjectsService.clearProjectsCache();
    this.setDonutChartsLoading();
    this.updateDashboardMapView();
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

  trackByWidgetId(_index: number, widget: DashboardWidget): string {
    return widget.id;
  }

  trackByFilterOptionId(
    _index: number,
    option: DashboardMapFilterOption | DashboardMapStatusOption,
  ): string {
    return option.id;
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

  private updateQueryParams(): void {
    const projectId = this.selectedProject !== 'all' ? this.selectedProject : '0';
    const vehicleId = this.selectedVehicle !== 'all' ? this.selectedVehicle : '0';
    const currentPath = this.location.path(false).split('?')[0];
    const query = `projectId=${encodeURIComponent(projectId)}&userId=0&vehicleId=${encodeURIComponent(vehicleId)}`;
    this.location.replaceState(currentPath, query);
  }

  onProjectChange(projectId: string): void {
    this.selectedProject = projectId;
    this.selectedVehicle = 'all';
    this.resetVehicleStationTrackingPaging();
    this.resetStationTypeHeatmapPaging();
    this.resetStationTimeComparisonPaging();
    this.updateQueryParams();
    this.updateDashboardMapView();
    this.updateProjectStatusChart(this.projects);
    this.fetchAllVehiclesForSelectedProjects();
    this.loadVehicles(projectId);
    if (this.isAdminRole) {
      this.setAdminStatCards();
    } else {
      this.fetchAllClientVehiclesAndTickets();
      this.refreshClientView();
    }

    if (this.selectedProject === 'all') {
      const projectOptions = this.getVisibleProjectOptionsForStationTypeHeatmap();
      this.widgets = this.widgets.map((widget) => {
        if (widget.id === 'widget-11' || widget.id === 'widget-12') {
          return { ...widget, loading: true };
        }
        return widget;
      });
      this.refreshSharedStationComparisonWidgets(projectOptions);
    }


    // refresh vehicle station tracking when project changes
    this.refreshVehicleStationTrackingWidget();
  }

  private fetchAllVehiclesForSelectedProjects(): void {
    this.refreshVehiclesByMakeModelChart();
    this.refreshVehiclesByPropulsionTypesChart();
  }

  private refreshVehiclesByMakeModelChart(): void {
    this.refreshVehicleDistributionWidget(
      'widget-2',
      () => ++this.makeModelRequestVersion,
      () => this.makeModelRequestVersion,
      () => this.dashboardProjectsService.getVehiclesByMakeModelData({
        projectIds: this.getSelectedOrAllVisibleProjectIds(),
        clientId: this.getEffectiveClientId(),
        userId: undefined,
        includeClosed: this.includeClosedProjects,
        maxItems: 7,
      }),
      (items) => buildVehiclesByMakeModelChartOptions(
        busPulseData.vehiclesByMakeModelChart,
        items,
      ),
    );
  }

  private refreshVehiclesByPropulsionTypesChart(): void {
    this.refreshVehicleDistributionWidget(
      'widget-3',
      () => ++this.propulsionRequestVersion,
      () => this.propulsionRequestVersion,
      () => this.dashboardProjectsService.getVehiclesByPropulsionTypeData({
        projectIds: this.getSelectedOrAllVisibleProjectIds(),
        clientId: this.getEffectiveClientId(),
        userId: undefined,
        includeClosed: this.includeClosedProjects,
        maxItems: 7,
      }),
      (items) => buildVehiclesByPropulsionTypeChartOptions(
        busPulseData.vehiclesByPropulsionChart,
        items,
      ),
    );
  }

  onAdminClientChange(clientId: string): void {
    if (!this.isAdminRole) return;

    this.selectedClient = clientId;
    this.selectedProject = 'all';
    this.selectedVehicle = 'all';
    this.totalVehiclesCount = null;
    this.resetStationTypeHeatmapPaging();
    this.resetStationTimeComparisonPaging();
    this.projects = [{ id: 'all', name: 'All Projects' }];
    this.vehicles = [{ id: 'all', name: 'All Vehicles' }];

    // Reset all three donut charts to loading so stale data from the previous
    // client is not shown while the new client's data is being fetched.
    this.setDonutChartsLoading();
    this.updateDashboardMapView();
    this.loadProjects();
  }

  onVehicleChange(vehicleId: string): void {
    this.selectedVehicle = vehicleId;
    this.resetVehicleStationTrackingPaging();
    this.resetStationTimeComparisonPaging();
    this.updateQueryParams();
    if (this.isAdminRole) {
      this.setAdminStatCards();
      return;
    }

    if (!this.isAdminRole) {
      this.fetchAllClientVehiclesAndTickets();
      this.refreshClientView();
    }

    if (this.selectedProject === 'all') {
      if (this.selectedVehicle === 'all') {
        this.widgets = this.widgets.map((widget) => {
          if (widget.id === 'widget-11' || widget.id === 'widget-12') {
            return { ...widget, loading: true };
          }
          return widget;
        });
        this.refreshSharedStationComparisonWidgets(this.getVisibleProjectOptionsForStationTypeHeatmap());
      } else {
        this.refreshProjectsByStationTypeWidgetFromFilters();
      }
    }

    this.refreshVehicleStationTrackingWidget();
  }

  onDashboardMapSelect(entity: FleetSelectedEntity | null): void {
    this.dashboardMapSelectedEntity = entity;
  }

  get dashboardMapProjectCount(): number {
    return this.dashboardMapProjects.length;
  }

  get dashboardMapClientCount(): number {
    return this.dashboardMapClients.length;
  }

  get dashboardMapLocationCount(): number {
    return this.dashboardMapLocations.length;
  }

  get dashboardMapManufacturerCount(): number {
    return this.dashboardMapManufacturers.length;
  }

  get dashboardMapWidgetSubtitle(): string {
    if (this.selectedProject !== 'all') {
      return `Focused on ${this.getSelectedProjectName()}`;
    }

    if (this.isAdminRole && this.selectedClient !== 'all') {
      return `${this.getSelectedClientName()} project network`;
    }

    return 'All mapped projects';
  }

  get hasDashboardMapFilters(): boolean {
    return this.dashboardMapSelectedStatus !== 'all' || this.dashboardMapSelectedManufacturerIds.length > 0;
  }

  setDashboardMapStatus(status: DashboardMapStatusFilter): void {
    if (this.dashboardMapSelectedStatus === status) {
      return;
    }
    this.dashboardMapSelectedStatus = status;
    this.debounceDashboardMapView();
  }

  toggleDashboardMapManufacturer(manufacturerId: string): void {
    const normalizedId = String(manufacturerId ?? '').trim();
    if (!normalizedId) {
      return;
    }
    this.dashboardMapSelectedManufacturerIds = this.dashboardMapSelectedManufacturerIds.includes(normalizedId)
      ? this.dashboardMapSelectedManufacturerIds.filter((id) => id !== normalizedId)
      : [...this.dashboardMapSelectedManufacturerIds, normalizedId];
    this.debounceDashboardMapView();
  }

  isDashboardMapManufacturerSelected(manufacturerId: string): boolean {
    return this.dashboardMapSelectedManufacturerIds.includes(manufacturerId);
  }

  resetDashboardMapFilters(): void {
    if (!this.hasDashboardMapFilters) {
      return;
    }

    this.dashboardMapSelectedStatus = 'all';
    this.dashboardMapSelectedManufacturerIds = [];
    this.updateDashboardMapView();
  }

  clearDashboardMapManufacturers(): void {
    if (this.dashboardMapSelectedManufacturerIds.length === 0) {
      return;
    }

    this.dashboardMapSelectedManufacturerIds = [];
    this.updateDashboardMapView();
  }

  onWidgetDrop(event: CdkDragDrop<DashboardWidget[]>): void {
    moveItemInArray(this.widgets, event.previousIndex, event.currentIndex);
    this.widgets.forEach((widget, index) => {
      widget.order = index + 1;
    });
    this.saveLayoutToStorage();
    // After CDK drop animation completes (~300ms), force chart components to
    // re-read their container dimensions by creating new chartOptions references.
    // This triggers ngOnChanges â†’ updateChartOptionsInPlace with correct sizes.
    setTimeout(() => {
      this.widgets.forEach(w => { if (w.chartOptions) w.chartOptions = { ...w.chartOptions }; });
      this.cdr.markForCheck();
    }, 320);
  }

  isWidgetVisible(widget: DashboardWidget): boolean {
    if (widget.id === 'widget-15' && this.selectedProject === 'all') {
      return false;
    }

    if (widget.id === 'widget-11' && this.selectedProject !== 'all') {
      return false;
    }

    if (widget.id === 'widget-12' && (this.selectedProject !== 'all' || this.selectedVehicle !== 'all')) {
      return false;
    }

    // Admins always see all widgets
    if (this.isAdminRole) return true;

    // Hide fleet map and recent activities widgets for non-admin users
    if (widget.id === 'widget-map' || widget.id === 'widget-14') return false;

    // Preserve existing compact-mode behavior: when filters aren't shown or project is 'all', show widgets
    if (!this.showFilters || this.selectedProject === 'all') return true;

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
    localStorage.removeItem(this.getLayoutStorageKey());
    this.initializeWidgets();
    this.loadProjects();
    if (!this.isAdminRole) {
      this.fetchAllClientVehiclesAndTickets();
      this.fetchAllVehiclesForSelectedProjects();
    }
  }

  toggleFullscreen(widgetId: string): void {
    this.fullscreenWidgetId = getNextFullscreenWidgetId(this.fullscreenWidgetId, widgetId);
    document.body.style.overflow = this.fullscreenWidgetId ? 'hidden' : 'auto';
  }

  toggleVehicleStationMergeByType(): void {
    this.vehicleStationMergeByType = !this.vehicleStationMergeByType;
    this.refreshVehicleStationTrackingWidget();
  }

  get hasVehicleStationPreviousPage(): boolean {
    return this.vehicleStationPage > 1;
  }

  get hasStationTypeHeatmapPreviousPage(): boolean {
    return this.stationTypeHeatmapPage > 1;
  }

  get hasStationTimeComparisonPreviousPage(): boolean {
    return this.stationTimeComparisonPage > 1;
  }

  previousVehicleStationTrackingPage(): void {
    if (!this.hasVehicleStationPreviousPage) {
      return;
    }
    this.vehicleStationPage -= 1;
    this.refreshVehicleStationTrackingWidget();
  }

  nextVehicleStationTrackingPage(): void {
    if (!this.vehicleStationHasNextPage) {
      return;
    }
    this.vehicleStationPage += 1;
    this.refreshVehicleStationTrackingWidget();
  }

  previousStationTypeHeatmapPage(): void {
    if (!this.hasStationTypeHeatmapPreviousPage) {
      return;
    }

    this.stationTypeHeatmapPage -= 1;
    this.refreshProjectsByStationTypeWidget(this.getVisibleProjectOptionsForStationTypeHeatmap());
  }

  nextStationTypeHeatmapPage(): void {
    if (!this.stationTypeHeatmapHasNextPage) {
      return;
    }

    this.stationTypeHeatmapPage += 1;
    this.refreshProjectsByStationTypeWidget(this.getVisibleProjectOptionsForStationTypeHeatmap());
  }

  previousStationTimeComparisonPage(): void {
    if (!this.hasStationTimeComparisonPreviousPage) {
      return;
    }

    this.stationTimeComparisonPage -= 1;
    this.refreshAverageStationTimeComparisonWidget(this.getVisibleProjectOptionsForStationTypeHeatmap());
  }

  nextStationTimeComparisonPage(): void {
    if (!this.stationTimeComparisonHasNextPage) {
      return;
    }

    this.stationTimeComparisonPage += 1;
    this.refreshAverageStationTimeComparisonWidget(this.getVisibleProjectOptionsForStationTypeHeatmap());
  }

  private resetVehicleStationTrackingPaging(): void {
    this.vehicleStationPage = 1;
    this.vehicleStationHasNextPage = false;
  }

  private resetStationTypeHeatmapPaging(): void {
    this.stationTypeHeatmapPage = 1;
    this.stationTypeHeatmapHasNextPage = false;
  }

  private resetStationTimeComparisonPaging(): void {
    this.stationTimeComparisonPage = 1;
    this.stationTimeComparisonHasNextPage = false;
  }

  private getVisibleProjectOptionsForStationTypeHeatmap(): Array<{ id: string; name: string }> {
    const visibleProjects = this.projects.filter((project) => String(project.id ?? '').toLowerCase() !== 'all');

    if (this.selectedProject !== 'all') {
      return visibleProjects.filter((project) => String(project.id) === String(this.selectedProject));
    }

    return visibleProjects;
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

    const containerEl = document.getElementById('wc-' + widgetId) as HTMLElement;
    const cardEl = containerEl?.querySelector('.widget-card') as HTMLElement;
    if (!containerEl || !cardEl) return;

    this.resizeSession = createResizeSession(widget, handle as DashboardResizeHandle, event, containerEl, cardEl);

    document.body.classList.add('is-resizing');
    document.body.style.cursor = getResizeCursor(handle as DashboardResizeHandle);
  }

  resetDashboardLayout(): void {
    localStorage.removeItem(this.getLayoutStorageKey());
    // Restore any deleted widgets while preserving chart data in existing widgets
    const existingIds = new Set(this.widgets.map((w) => w.id));
    const missing = createDefaultDashboardWidgets().filter((w) => !existingIds.has(w.id));
    if (missing.length) {
      this.widgets = [...this.widgets, ...missing];
    }
    this.applyDefaultWidgetLayout();
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

  private getLayoutStorageKey(): string {
    return `${DASHBOARD_LAYOUT_STORAGE_KEY}_${this.isAdminRole ? 'admin' : 'client'}`;
  }

  private applyRole(roleValue: string | null): void {
    const user = this.authService.currentUserValue || { role: 'client', type: 0, username: 'User', email: '', clientId: 0, userId: 0, isGeneralAdmin: false };
    const normalizedRole = String(roleValue ?? user.role ?? '').trim().toLowerCase();
    const userType = Number(user?.type ?? 0);
    const isClientByRoleType = normalizedRole === 'client' || (normalizedRole === 'user' && userType === 3);
    this.role = (normalizedRole === 'admin' || normalizedRole === 'superadmin') ? 'admin' : (isClientByRoleType ? 'client' : 'client');
    this.showFilters = !this.isAdminRole;
    this.includeClosedProjects = false;

    // Defensive: always fallback to username/email/User
    let welcomeName = 'User';
    if (user?.username && typeof user.username === 'string') {
      welcomeName = user.username.split('@')[0] || 'User';
    } else if (user?.email && typeof user.email === 'string') {
      welcomeName = user.email.split('@')[0] || 'User';
    }
    this.welcomeUserName = welcomeName;
    this.title = this.isAdminRole ? 'BusPulse Fleet Dashboard' : 'BusPulse Client Dashboard';
    this.loadClientBranding(user);

    this.selectedProject = 'all';
    this.selectedVehicle = 'all';
    this.selectedClient = 'all';
    this.totalVehiclesCount = null;
    this.clients = this.isAdminRole ? [{ id: 'all', name: 'All Clients' }] : [];
    this.projects = [{ id: 'all', name: 'All Projects' }];
    this.vehicles = [{ id: 'all', name: 'All Vehicles' }];

    if (this.isAdminRole) {
      this.loadClientOptions();
    }

    this.initializeWidgets();
    this.loadProjects();
    this.updateDashboardMapView();

  }

  private loadProjects(): void {
    const effectiveClientId = this.getEffectiveClientId();
    const requestVersion = ++this.projectsRequestVersion;
    ++this.vehiclesRequestVersion;

    this.dashboardProjectsService.getProjectOptions({
      clientId: effectiveClientId ?? 0,
      includeClosed: this.includeClosedProjects,
    }).subscribe({
      next: (items) => {
        if (requestVersion !== this.projectsRequestVersion) return;

        this.projects = items.length
          ? items
          : [{ id: 'all', name: 'All Projects' }];

        const hasSelectedProject = this.projects.some((project) => project.id === this.selectedProject);
        if (!hasSelectedProject) {
          this.selectedProject = 'all';
        }

        this.updateProjectStatusChart(this.projects);
        this.updateProjectScopedComparisonWidgets();
        this.fetchAllVehiclesForSelectedProjects();

        this.syncMapProjectsFromLoaded();
        if (!this.dashboardMapDataLoaded) {
          this.loadDashboardMapData();
        }
        this.updateDashboardMapView();
        this.loadVehicles(this.selectedProject);
        if (this.isAdminRole) {
          this.setAdminStatCards();
        } else {
          this.refreshClientView();
        }
        this.dataInitialized = true;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (requestVersion !== this.projectsRequestVersion) return;
        this.projects = [{ id: 'all', name: 'All Projects' }];
        this.selectedProject = 'all';
        this.selectedVehicle = 'all';
        this.updateProjectStatusChart(this.projects);
        this.updateProjectScopedComparisonWidgets();
        this.fetchAllVehiclesForSelectedProjects();
        this.updateDashboardMapView();
        this.loadVehicles(this.selectedProject);
        this.toastService.show('Failed to load projects: ' + (err?.message || 'Unknown error'), { classname: 'bg-danger text-light', autohide: true });
        this.cdr.markForCheck();
      },
    });
  }

  private loadVehicles(projectId: string): void {
    const effectiveClientId = this.getEffectiveClientId();
    const requestVersion = ++this.vehiclesRequestVersion;

    let vehicleRequest$: Observable<{ options: DashboardVehicleOption[]; totalCount: number }>;

    if (projectId === 'all') {
      // Use the single flat /Vehicles call — avoids one HTTP request per project.
      vehicleRequest$ = this.dashboardProjectsService.getAllVehicleOptionsResult({
        clientId: effectiveClientId,
        includeClosed: this.includeClosedProjects,
      });
    } else {
      vehicleRequest$ = this.dashboardProjectsService.getVehicleOptionsByProjectResult(projectId, {
        clientId: effectiveClientId,
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
          this.fetchAllClientVehiclesAndTickets();
          this.refreshClientView();
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (requestVersion !== this.vehiclesRequestVersion) return;
        this.vehicles = [{ id: 'all', name: 'All Vehicles' }];
        this.selectedVehicle = 'all';
        this.totalVehiclesCount = null;
        this.toastService.show('Failed to load vehicles: ' + (err?.message || 'Unknown error'), { classname: 'bg-danger text-light', autohide: true });
        this.cdr.markForCheck();
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

        this.updateDashboardMapView();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.clients = [{ id: 'all', name: 'All Clients' }];
        this.selectedClient = 'all';
        this.updateDashboardMapView();
        this.toastService.show('Failed to load clients: ' + (err?.message || 'Unknown error'), { classname: 'bg-danger text-light', autohide: true });
        this.cdr.markForCheck();
      },
    });
  }

  /** Populate allMapProjects from the already-loaded project dropdown data, avoiding a second Projects API call. */
  private syncMapProjectsFromLoaded(): void {
    this.allMapProjects = this.projects
      .filter((p) => p.id !== 'all')
      .map((p) => ({
        id: p.id,
        name: p.name,
        clientId: p.clientId ?? '',
        lat: null,
        lng: null,
        locationId: null,
        locationIds: [],
        type: '',
        typeId: null,
        status: (p.isClosed || String(p.status ?? '').toLowerCase() === 'inactive') ? 'inactive' : 'active',
      } as import('../fleet-map/models/fleet-map.models').ApiProject));
  }

  private loadDashboardMapData(): void {
    this.dashboardMapLoading = true;
    this.dashboardMapError = '';
    this.updateDashboardMapWidgetState();

    forkJoin({
      clients: this.clientService.getClients(),
      manufacturers: this.fleetMapApiService.fetchManufacturers(),
      locations: this.fleetMapApiService.fetchLocations(),
    }).subscribe({
      next: ({ clients, manufacturers, locations }) => {
        this.allMapClients = clients.map((c) => ({
          id: c.id,
          name: c.name,
          logoUrl: c.logoUrl,
          lat: c.coordinates?.latitude ?? null,
          lng: c.coordinates?.longitude ?? null,
          locationIds: (c.locationIds ?? []).map(String),
        }));
        this.allMapManufacturers = manufacturers;
        this.allMapLocations = locations;
        this.dashboardMapDataLoaded = true;
        this.dashboardMapLoading = false;
        this.updateDashboardMapView();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.dashboardMapLoading = false;
        this.dashboardMapError = err?.message || 'Unable to load fleet map data.';
        this.dashboardMapProjects = [];
        this.dashboardMapClients = [];
        this.dashboardMapManufacturers = [];
        this.dashboardMapLocations = [];
        this.dashboardMapManufacturerOptions = [];
        this.updateDashboardMapWidgetState();
        this.cdr.markForCheck();
      },
    });
  }

  private updateDashboardMapView(): void {
    // ...existing code...
    // ...existing code...
    if (!this.dashboardMapDataLoaded) {
      return;
    }

    const effectiveClientId = this.getEffectiveClientId();
    const effectiveClientKey = effectiveClientId != null ? String(effectiveClientId) : null;
    const selectedProjectKey = String(this.selectedProject ?? '').trim().toLowerCase();

    const filteredProjects = this.allMapProjects.filter((project) => {
      if (effectiveClientKey && project.clientId !== effectiveClientKey) {
        return false;
      }
      if (selectedProjectKey && selectedProjectKey !== 'all') {
        return project.id === this.selectedProject;
      }
      return true;
    });

    const baseLocationIds = this.collectDashboardMapLocationIds(filteredProjects);
    const baseManufacturers = this.allMapManufacturers.filter((manufacturer) => (
      manufacturer.locationIds.some((locationId) => baseLocationIds.has(locationId))
    ));
    const availableManufacturerIds = new Set(baseManufacturers.map((manufacturer) => manufacturer.id));
    const nextSelectedManufacturerIds = this.dashboardMapSelectedManufacturerIds.filter((manufacturerId) => (
      availableManufacturerIds.has(manufacturerId)
    ));

    if (nextSelectedManufacturerIds.length !== this.dashboardMapSelectedManufacturerIds.length) {
      this.dashboardMapSelectedManufacturerIds = nextSelectedManufacturerIds;
    }

    this.dashboardMapManufacturerOptions = baseManufacturers
      .map((manufacturer) => ({ id: manufacturer.id, label: manufacturer.name }))
      .sort((left, right) => left.label.localeCompare(right.label));

    const selectedManufacturerLocationIds = new Set<string>();
    if (this.dashboardMapSelectedManufacturerIds.length > 0) {
      baseManufacturers.forEach((manufacturer) => {
        if (!this.dashboardMapSelectedManufacturerIds.includes(manufacturer.id)) {
          return;
        }
        manufacturer.locationIds.forEach((locationId) => selectedManufacturerLocationIds.add(locationId));
      });
    }

    const locationIds = new Set<string>();
    const clientIds = new Set<string>();

    const statusFilteredProjects = filteredProjects.filter((project) => {
      const statusMatch = this.dashboardMapSelectedStatus === 'all' || project.status === this.dashboardMapSelectedStatus;
      if (!statusMatch) {
        return false;
      }
      if (selectedManufacturerLocationIds.size === 0) {
        return true;
      }
      return this.projectMatchesDashboardMapManufacturerFilter(project, selectedManufacturerLocationIds);
    });

    statusFilteredProjects.forEach((project) => {
      clientIds.add(project.clientId);
      project.locationIds.forEach((locationId) => locationIds.add(locationId));
      if (project.locationId) {
        locationIds.add(project.locationId);
      }
    });

    const filteredLocations = this.allMapLocations.filter((location) => locationIds.has(location.id));
    const filteredManufacturers = baseManufacturers.filter((manufacturer) => (
      manufacturer.locationIds.some((locationId) => locationIds.has(locationId)) &&
      (this.dashboardMapSelectedManufacturerIds.length === 0 ||
        this.dashboardMapSelectedManufacturerIds.includes(manufacturer.id))
    ));
    const filteredClients = this.allMapClients.filter((client) => clientIds.has(client.id));

    this.dashboardMapProjects = statusFilteredProjects;
    this.dashboardMapClients = filteredClients;
    this.dashboardMapManufacturers = filteredManufacturers;
    this.dashboardMapLocations = filteredLocations;
    this.dashboardMapViewedProject = this.selectedProject !== 'all'
      ? statusFilteredProjects.find((project) => project.id === this.selectedProject) ?? null
      : null;

    if (
      this.dashboardMapSelectedEntity &&
      !this.isDashboardMapSelectionVisible(this.dashboardMapSelectedEntity)
    ) {
      this.dashboardMapSelectedEntity = null;
    }

    this.updateDashboardMapWidgetState();
  }

  private collectDashboardMapLocationIds(projects: ApiProject[]): Set<string> {
    const locationIds = new Set<string>();

    projects.forEach((project) => {
      project.locationIds.forEach((locationId) => locationIds.add(locationId));
      if (project.locationId) {
        locationIds.add(project.locationId);
      }
    });

    return locationIds;
  }

  private projectMatchesDashboardMapManufacturerFilter(
    project: ApiProject,
    selectedManufacturerLocationIds: Set<string>,
  ): boolean {
    if (selectedManufacturerLocationIds.size === 0) {
      return true;
    }

    if (project.locationId && selectedManufacturerLocationIds.has(project.locationId)) {
      return true;
    }

    return project.locationIds.some((locationId) => selectedManufacturerLocationIds.has(locationId));
  }

  private updateDashboardMapWidgetState(): void {
    if (!this.widgets.length) {
      return;
    }

    this.widgets = this.widgets.map((widget) => (
      widget.id === 'widget-map'
        ? {
            ...widget,
            subtitle: this.dashboardMapWidgetSubtitle,
            loading: this.dashboardMapLoading,
          }
        : widget
    ));
  }

  private syncDashboardTheme(theme?: string | null): void {
    const html = document.documentElement;
    const resolvedTheme = String(theme ?? html.getAttribute('data-theme-mode') ?? '').trim().toLowerCase();
    this.dashboardMapIsDark = resolvedTheme === 'dark' || html.classList.contains('dark');
  }

  private isDashboardMapSelectionVisible(entity: FleetSelectedEntity): boolean {
    switch (entity.kind) {
      case 'project':
        return this.dashboardMapProjects.some((project) => project.id === entity.data.id);
      case 'client':
        return this.dashboardMapClients.some((client) => client.id === entity.data.id);
      case 'manufacturer':
        return this.dashboardMapManufacturers.some((manufacturer) => manufacturer.id === entity.data.id);
      case 'location':
        return this.dashboardMapLocations.some((location) => location.id === entity.data.id);
    }
  }

  private getSelectedClientName(): string {
    return this.clients.find((client) => client.id === this.selectedClient)?.name ?? 'All Clients';
  }

  private getSelectedProjectName(): string {
    return this.projects.find((project) => project.id === this.selectedProject)?.name ?? 'All Projects';
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
        this.cdr.markForCheck();
      },
      error: () => {
        this.clientProfile = fallbackProfile;
        this.customerLogoName = '';
        this.cdr.markForCheck();
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
    const totalProjects = this.projects.filter((project) => project.id !== 'all').length || 0;
    const requestVersion = ++this.ticketsDashboardRequestVersion;

    if (totalProjects > 0 || this.projects.some((p) => p.id !== 'all')) {
      this.updateProjectStatusChart(this.projects);
    }

    this.dashboardProjectsService.getTicketsDashboard({
      projectId: this.selectedProject !== 'all' ? this.selectedProject : undefined,
      vehicleId: this.selectedVehicle !== 'all' ? this.selectedVehicle : undefined,
      clientId: this.getEffectiveClientId(),
      includeClosed: this.includeClosedProjects,
    }).subscribe({
      next: (res) => {
        if (requestVersion !== this.ticketsDashboardRequestVersion) return;
        const resolveCount = (candidates: any[]): number | null => {
          for (const c of candidates) {
            const n = Number(c);
            if (Number.isFinite(n) && n >= 0) return n;
          }
          return null;
        };
        const statsSource = {
          ...busPulseData.dashboardStats,
          repeatedDefects: resolveCount([res?.repeatedTickets, (res as any)?.RepeatedTickets, (res as any)?.repeatTickets, (res as any)?.RepeatTickets, (res as any)?.data?.repeatedTickets, (res as any)?.result?.repeatedTickets]) ?? busPulseData.dashboardStats.repeatedDefects,
          criticalDefects: resolveCount([res?.safetyCriticalTickets, (res as any)?.SafetyCriticalTickets, (res as any)?.criticalTickets, (res as any)?.CriticalTickets, (res as any)?.data?.safetyCriticalTickets, (res as any)?.result?.safetyCriticalTickets]) ?? busPulseData.dashboardStats.criticalDefects,
        };
        this.statCards = buildAdminStatCards(statsSource, totalProjects, this.totalVehiclesCount);
        this.updateTicketsByStatusWidgetFromApi(res);
        this.cdr.markForCheck();
      },
      error: () => {
        if (requestVersion !== this.ticketsDashboardRequestVersion) return;
        this.statCards = buildAdminStatCards(busPulseData.dashboardStats, totalProjects, this.totalVehiclesCount);
        this.updateTicketsByStatusWidgetFromApi([]);
        this.cdr.markForCheck();
      },
    });
  }

  private refreshClientView(): void {
    const requestVersion = ++this.ticketsDashboardRequestVersion;

    this.currentProjectStats = resolveClientProjectStats(
      projectStats,
      this.selectedProject,
      this.selectedVehicle,
    );

    {
      let totalAssets = Number(this.currentProjectStats.totalAssets ?? 0);

      if (this.selectedProject === 'all') {
        if (this.selectedVehicle && this.selectedVehicle !== 'all') {
          totalAssets = 1;
        } else {
          totalAssets = Array.isArray(this.allClientVehicles) ? this.allClientVehicles.filter((v) => v.id !== 'all').length : 0;
        }
      } else {
        // Specific project
        if (this.selectedVehicle && this.selectedVehicle !== 'all') {
          totalAssets = 1;
        } else {
          totalAssets = (Number.isFinite(this.totalVehiclesCount as number) && (this.totalVehiclesCount ?? 0) > 0)
            ? (this.totalVehiclesCount as number)
            : (this.vehicles ? this.vehicles.filter((v) => v.id !== 'all').length : 0);
        }
      }

      this.currentProjectStats = {
        ...this.currentProjectStats,
        totalAssets,
      };
    }

    // If a client has selected a specific project, fetch authoritative ticket totals
    // from the tickets dashboard API. Use project-level totals when "All Vehicles"
    // is selected, and vehicle-level totals when a single vehicle is selected.
    if (!this.isAdminRole && this.selectedProject !== 'all') {
      const projectIdParam = this.selectedProject;
      const clientIdParam = this.getEffectiveClientId();
      const params = this.selectedVehicle === 'all'
        ? { projectId: projectIdParam, clientId: clientIdParam }
        : { projectId: projectIdParam, vehicleId: this.selectedVehicle, clientId: clientIdParam };

      this.dashboardProjectsService.getTicketsDashboard(params).subscribe({
        next: (res) => {
          if (requestVersion !== this.ticketsDashboardRequestVersion) return;
          const result: any = res ?? {};
          this.currentProjectStats = {
            ...this.currentProjectStats,
            totalTickets: this.extractTicketTotal(result),
          };
          this.statCards = buildClientStatCards(this.currentProjectStats, this.showFilters, this.selectedProject);
          this.updateTicketsByStatusWidgetFromApi(result);
          this.cdr.markForCheck();
        },
        error: () => {
          if (requestVersion !== this.ticketsDashboardRequestVersion) return;
          this.updateTicketsByStatusWidgetFromApi([]);
          this.cdr.markForCheck();
        },
      });
    }
    // If All Projects is selected, either fetch vehicle-scoped totals (option A)
    // or aggregate per-project totals when no vehicle is selected.
    if (!this.isAdminRole && this.selectedProject === 'all') {
      const clientIdParam = this.getEffectiveClientId();
      const params = (this.selectedVehicle && this.selectedVehicle !== 'all')
        ? { vehicleId: this.selectedVehicle, clientId: clientIdParam }
        : { clientId: clientIdParam };

      this.dashboardProjectsService.getTicketsDashboard(params).subscribe({
        next: (res) => {
          if (requestVersion !== this.ticketsDashboardRequestVersion) return;
          const r: any = res ?? {};
          this.currentProjectStats = {
            ...this.currentProjectStats,
            totalTickets: this.extractTicketTotal(r),
          };
          this.statCards = buildClientStatCards(this.currentProjectStats, this.showFilters, this.selectedProject);
          this.updateTicketsByStatusWidgetFromApi(r);
          this.cdr.markForCheck();
        },
        error: () => {
          if (requestVersion !== this.ticketsDashboardRequestVersion) return;
          this.updateTicketsByStatusWidgetFromApi([]);
          this.statCards = buildClientStatCards(this.currentProjectStats, this.showFilters, this.selectedProject);
          this.cdr.markForCheck();
        },
      });
    } else {
      this.statCards = buildClientStatCards(
        this.currentProjectStats,
        this.showFilters,
        this.selectedProject,
      );
    }

    // Optionally update widgets or other UI with allClientVehicles/allClientTickets
    this.widgets = this.buildWidgets();
    this.loadLayoutFromStorage();
  }

  private initializeWidgets(): void {
    this.widgets = createDefaultDashboardWidgets();
    this.loadLayoutFromStorage();
  }

  private setDonutChartsLoading(): void {
    if (!this.widgets.length) return;
    const donutIds = new Set(['widget-1', 'widget-2', 'widget-3']);
    this.widgets = this.widgets.map((widget) =>
      donutIds.has(widget.id) ? { ...widget, loading: true, chartOptions: null } : widget,
    );
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
        ? { ...widget, chartOptions, loading: false }
        : widget
    ));
  }

  private updateProjectScopedComparisonWidgets(): void {
    if (!this.widgets.length) return;

    const projectOptions = this.getVisibleProjectOptionsForStationTypeHeatmap();

    const projectNames = projectOptions.map((project) => project.name);

    if (!projectNames.length) {
      this.stationTypeHeatmapHasNextPage = false;
      this.stationTimeComparisonHasNextPage = false;
      this.refreshProjectsByStationTypeWidget([]);
      this.refreshAverageStationTimeComparisonWidget([]);
      return;
    }

    const fitSeriesData = (template: any[], length: number): number[] => {
      if (!Array.isArray(template) || !template.length) {
        return Array.from({ length }, () => 0);
      }

      return Array.from({ length }, (_, index) => {
        const raw = Number(template[index % template.length] ?? 0);
        return Number.isFinite(raw) ? raw : 0;
      });
    };

    const widget10ProjectNames = projectNames.slice(0, 12);
    const widget13ProjectNames = projectNames.slice(0, 10);
    const widget15VehicleNames = (Array.isArray(this.vehicles) && this.vehicles.filter(v => String(v?.id ?? '').toLowerCase() !== 'all').map((v: any) => String(v.name ?? v.id)).slice(0, 10)) || widget13ProjectNames;

    const templateWidget10 = busPulseData.projectsByAreaStackedChart as any;
    const widget10Options = {
      ...templateWidget10,
      xaxis: {
        ...(templateWidget10?.xaxis ?? {}),
        categories: widget10ProjectNames,
      },
      series: Array.isArray(templateWidget10?.series)
        ? templateWidget10.series.map((seriesItem: any) => ({
            ...seriesItem,
            data: fitSeriesData(seriesItem?.data, widget10ProjectNames.length),
          }))
        : [],
    };
    const templateWidget13 = busPulseData.projectTimelineChart as any;
    const templateTimelineData = Array.isArray(templateWidget13?.series?.[0]?.data)
      ? templateWidget13.series[0].data
      : [];
    const timelineData = widget13ProjectNames.map((projectName, index) => {
      const templateItem = templateTimelineData[index % Math.max(templateTimelineData.length, 1)] ?? {};
      return {
        ...templateItem,
        x: projectName,
      };
    });
    const widget13Options = {
      ...templateWidget13,
      series: [{
        ...(templateWidget13?.series?.[0] ?? {}),
        data: timelineData,
      }],
    };

    // Build Vehicle Station Tracking widget options (widget-15) from template
    const templateWidget15 = (busPulseData as any).vehicleStationTrackingChart as any;
    const templateTimelineData15 = Array.isArray(templateWidget15?.series?.[0]?.data) ? templateWidget15.series[0].data : [];
    const vehicleTimelineData = widget15VehicleNames.map((vehicleName: string, index: number) => {
      const templateItem = templateTimelineData15[index % Math.max(templateTimelineData15.length, 1)] ?? {};
      return { ...templateItem, x: vehicleName };
    });
    const widget15Options = {
      ...templateWidget15,
      series: [{ ...(templateWidget15?.series?.[0] ?? {}), data: vehicleTimelineData }],
    };

    this.widgets = this.widgets.map((widget) => {
      if (widget.id === 'widget-10') return { ...widget, chartOptions: widget10Options, loading: false };
      if (widget.id === 'widget-11') return { ...widget, loading: true };
      if (widget.id === 'widget-12') return { ...widget, loading: true };
      if (widget.id === 'widget-13') return { ...widget, chartOptions: widget13Options, loading: false };
      if (widget.id === 'widget-15') return { ...widget, chartOptions: widget15Options, loading: false };
      return widget;
    });

    if (this.selectedProject === 'all' && this.selectedVehicle === 'all') {
      this.refreshSharedStationComparisonWidgets(projectOptions);
      return;
    }

    this.refreshProjectsByStationTypeWidget(projectOptions);
  }

  private refreshSharedStationComparisonWidgets(projects: Array<{ id: string; name: string }>): void {
    if (!projects.length) {
      this.refreshProjectsByStationTypeWidget([]);
      this.refreshAverageStationTimeComparisonWidget([]);
      return;
    }

    const isSamePaging = this.stationTypeHeatmapPage === this.stationTimeComparisonPage
      && this.stationTypeHeatmapPageSize === this.stationTimeComparisonPageSize;

    if (!isSamePaging) {
      this.refreshProjectsByStationTypeWidget(projects);
      this.refreshAverageStationTimeComparisonWidget(projects);
      return;
    }

    const heatmapRequestVersion = ++this.stationTypeHeatmapRequestVersion;
    const timeComparisonRequestVersion = ++this.stationTimeComparisonRequestVersion;
    const pageNumber = this.stationTypeHeatmapPage;
    const pageSize = this.stationTypeHeatmapPageSize;
    const sharedProjectionFields = this.getStationComparisonSharedProjectionFields();

    void (async () => {
      const projectResults = await this.fetchStationTrackerSetsForProjects(
        projects,
        (projectId) => this.fetchStationTrackerSetPage(projectId, pageNumber, pageSize, sharedProjectionFields),
      );

      const heatmapRequestStillCurrent = heatmapRequestVersion === this.stationTypeHeatmapRequestVersion;
      const timeRequestStillCurrent = timeComparisonRequestVersion === this.stationTimeComparisonRequestVersion;
      if (!heatmapRequestStillCurrent && !timeRequestStillCurrent) {
        return;
      }

      const recordsByProjectId = new Map<string, any[]>(
        projectResults.map((entry) => [entry.projectId, Array.isArray(entry.items) ? entry.items : []]),
      );
      const hasNextPage = projectResults.some((entry) => entry.hasNext);

      if (heatmapRequestStillCurrent) {
        this.stationTypeHeatmapHasNextPage = hasNextPage;
        const heatmapOptions = this.buildProjectsByStationTypeHeatmapOptions(projects, recordsByProjectId);
        this.widgets = this.widgets.map((widget) => (
          widget.id === 'widget-11'
            ? { ...widget, chartOptions: heatmapOptions, loading: false }
            : widget
        ));
      }

      if (timeRequestStillCurrent) {
        this.stationTimeComparisonHasNextPage = hasNextPage;
        const timeComparisonOptions = this.buildAverageStationTimeComparisonOptions(projects, recordsByProjectId);
        this.widgets = this.widgets.map((widget) => (
          widget.id === 'widget-12'
            ? { ...widget, chartOptions: timeComparisonOptions, loading: false }
            : widget
        ));
      }

      this.cdr.markForCheck();
    })().catch(() => {
      const heatmapRequestStillCurrent = heatmapRequestVersion === this.stationTypeHeatmapRequestVersion;
      const timeRequestStillCurrent = timeComparisonRequestVersion === this.stationTimeComparisonRequestVersion;
      if (!heatmapRequestStillCurrent && !timeRequestStillCurrent) {
        return;
      }

      if (heatmapRequestStillCurrent) {
        const fallbackOptions = this.buildProjectsByStationTypeHeatmapOptions(projects, new Map());
        this.stationTypeHeatmapHasNextPage = false;
        this.widgets = this.widgets.map((widget) => (
          widget.id === 'widget-11'
            ? { ...widget, chartOptions: fallbackOptions, loading: false }
            : widget
        ));
      }

      if (timeRequestStillCurrent) {
        const fallbackOptions = this.buildAverageStationTimeComparisonOptions(projects, new Map());
        this.stationTimeComparisonHasNextPage = false;
        this.widgets = this.widgets.map((widget) => (
          widget.id === 'widget-12'
            ? { ...widget, chartOptions: fallbackOptions, loading: false }
            : widget
        ));
      }

      try {
        this.toastService.show('Failed to load shared station comparison data', { classname: 'bg-warning text-dark', autohide: true });
      } catch { }
      this.cdr.markForCheck();
    });
  }

  private refreshProjectsByStationTypeWidget(projects: Array<{ id: string; name: string }>): void {
    const requestVersion = ++this.stationTypeHeatmapRequestVersion;

    if (!projects.length) {
      const fallbackOptions = this.buildProjectsByStationTypeHeatmapOptions([], new Map());
      this.stationTypeHeatmapHasNextPage = false;
      this.widgets = this.widgets.map((widget) => (
        widget.id === 'widget-11'
          ? { ...widget, chartOptions: fallbackOptions, loading: false }
          : widget
      ));
      this.cdr.markForCheck();
      return;
    }

    const pageSize = this.stationTypeHeatmapPageSize;
    const pageNumber = this.stationTypeHeatmapPage;

    void (async () => {
      const projectResults = await this.fetchStationTrackerSetsForProjects(
        projects,
        (projectId) => this.fetchStationTrackerSetForProject(projectId, pageNumber, pageSize, requestVersion),
      );

      if (requestVersion !== this.stationTypeHeatmapRequestVersion) {
        return;
      }

      const recordsByProjectId = new Map<string, any[]>(
        projectResults.map((entry) => [entry.projectId, Array.isArray(entry.items) ? entry.items : []]),
      );
      this.stationTypeHeatmapHasNextPage = projectResults.some((entry) => entry.hasNext);

      const chartOptions = this.buildProjectsByStationTypeHeatmapOptions(projects, recordsByProjectId);
      this.widgets = this.widgets.map((widget) => (
        widget.id === 'widget-11'
          ? { ...widget, chartOptions, loading: false }
          : widget
      ));
      this.cdr.markForCheck();
    })().catch(() => {
      if (requestVersion !== this.stationTypeHeatmapRequestVersion) {
        return;
      }

      const fallbackOptions = this.buildProjectsByStationTypeHeatmapOptions(projects, new Map());
      this.stationTypeHeatmapHasNextPage = false;
      this.widgets = this.widgets.map((widget) => (
        widget.id === 'widget-11'
          ? { ...widget, chartOptions: fallbackOptions, loading: false }
          : widget
      ));
      try {
        this.toastService.show('Failed to load station type comparison data', { classname: 'bg-warning text-dark', autohide: true });
      } catch { }
      this.cdr.markForCheck();
    });
  }

  private refreshProjectsByStationTypeWidgetFromFilters(): void {
    // Re-run widget-11 loading and paging state after filter changes that return to All Projects.
    this.widgets = this.widgets.map((widget) => (
      widget.id === 'widget-11'
        ? { ...widget, loading: true }
        : widget
    ));

    this.refreshProjectsByStationTypeWidget(this.getVisibleProjectOptionsForStationTypeHeatmap());
  }

  private refreshAverageStationTimeComparisonWidgetFromFilters(): void {
    if (this.selectedProject !== 'all' || this.selectedVehicle !== 'all') {
      this.stationTimeComparisonHasNextPage = false;
      this.widgets = this.widgets.map((widget) => (
        widget.id === 'widget-12'
          ? { ...widget, loading: false }
          : widget
      ));
      this.cdr.markForCheck();
      return;
    }

    this.widgets = this.widgets.map((widget) => (
      widget.id === 'widget-12'
        ? { ...widget, loading: true }
        : widget
    ));

      this.refreshAverageStationTimeComparisonWidget(this.getVisibleProjectOptionsForStationTypeHeatmap());
  }

  private refreshAverageStationTimeComparisonWidget(projects: Array<{ id: string; name: string }>): void {
    const requestVersion = ++this.stationTimeComparisonRequestVersion;

    if (!projects.length) {
      const fallbackOptions = this.buildAverageStationTimeComparisonOptions([], new Map());
      this.stationTimeComparisonHasNextPage = false;
      this.widgets = this.widgets.map((widget) => (
        widget.id === 'widget-12'
          ? { ...widget, chartOptions: fallbackOptions, loading: false }
          : widget
      ));
      this.cdr.markForCheck();
      return;
    }

    const pageSize = this.stationTimeComparisonPageSize;
    const pageNumber = this.stationTimeComparisonPage;

    void (async () => {
      const projectResults = await this.fetchStationTrackerSetsForProjects(
        projects,
        (projectId) => this.fetchStationTrackerSetForStationTimeComparison(projectId, pageNumber, pageSize, requestVersion),
      );

      if (requestVersion !== this.stationTimeComparisonRequestVersion) {
        return;
      }

      const recordsByProjectId = new Map<string, any[]>(
        projectResults.map((entry) => [entry.projectId, Array.isArray(entry.items) ? entry.items : []]),
      );
      this.stationTimeComparisonHasNextPage = projectResults.some((entry) => entry.hasNext);

      const chartOptions = this.buildAverageStationTimeComparisonOptions(projects, recordsByProjectId);
      this.widgets = this.widgets.map((widget) => (
        widget.id === 'widget-12'
          ? { ...widget, chartOptions, loading: false }
          : widget
      ));
      this.cdr.markForCheck();
    })().catch(() => {
      if (requestVersion !== this.stationTimeComparisonRequestVersion) {
        return;
      }

      const fallbackOptions = this.buildAverageStationTimeComparisonOptions(projects, new Map());
      this.stationTimeComparisonHasNextPage = false;
      this.widgets = this.widgets.map((widget) => (
        widget.id === 'widget-12'
          ? { ...widget, chartOptions: fallbackOptions, loading: false }
          : widget
      ));
      try {
        this.toastService.show('Failed to load average station time comparison data', { classname: 'bg-warning text-dark', autohide: true });
      } catch { }
      this.cdr.markForCheck();
    });
  }

  private async fetchStationTrackerSetForStationTimeComparison(
    projectId: string,
    pageNumber: number,
    pageSize: number,
    requestVersion: number,
  ): Promise<{ items: any[]; hasNext: boolean }> {
    if (requestVersion !== this.stationTimeComparisonRequestVersion) {
      return { items: [], hasNext: false };
    }

    return this.fetchStationTrackerSetPage(
      projectId,
      pageNumber,
      pageSize,
      this.stationTrackerFieldsForStationTimeComparison,
    );
  }

  private buildAverageStationTimeComparisonOptions(
    projects: Array<{ id: string; name: string }>,
    recordsByProjectId: Map<string, any[]>,
  ): unknown {
    const template = busPulseData.stationTimeComparisonChart as any;
    const msPerDay = 24 * 60 * 60 * 1000;
    const minVisibleDurationDays = 0.35;
    const minVisibleNoDurationDays = 0.5;
    const preferredStationTypeOrder = ['Client', 'Production', 'Shipped', 'Final', 'None', 'Unspecified'];
    const stationTypeSet = new Set<string>();
    const valuesByProjectId = new Map<string, Map<string, number>>();
    const vehicleCountsByProjectId = new Map<string, Map<string, number>>();
    const recordCountsByProjectId = new Map<string, Map<string, number>>();
    const boundsByProjectId = new Map<string, Map<string, { earliestStartMs: number | null; latestEndMs: number | null }>>();

    const parseDate = (value: unknown): number | null => {
      if (value == null) return null;
      const ms = new Date(String(value)).getTime();
      return Number.isFinite(ms) ? ms : null;
    };

    const getFirstValidDateMs = (record: any, keys: string[]): number | null => {
      for (const key of keys) {
        const parsed = parseDate(record?.[key]);
        if (parsed !== null) {
          return parsed;
        }
      }
      return null;
    };

    const startDateKeys = ['startDate', 'dateStarted', 'date_start', 'start_date', 'startedDate', 'started_at'];
    const endDateKeys = ['endDate', 'dateEnded', 'date_end', 'end_date', 'completedDate', 'dateCompleted', 'ended_at'];

    projects.forEach((project) => {
      const records = recordsByProjectId.get(project.id) ?? [];
      const perTypeTotalDays = new Map<string, number>();
      const perTypeVehiclesWithDuration = new Map<string, Set<string>>();
      const perTypeRecordCount = new Map<string, number>();
      const perTypeBounds = new Map<string, { earliestStartMs: number | null; latestEndMs: number | null }>();

      records.forEach((record, recordIndex) => {
        const stationType = this.normalizeStationTypeName(
          record?.stationTypeName ?? record?.station_type_name ?? record?.stationType,
        );
        // Keep station type visible at project-level even when timeline fields are partially missing.
        stationTypeSet.add(stationType);
        perTypeRecordCount.set(stationType, (perTypeRecordCount.get(stationType) ?? 0) + 1);

        const startMs = getFirstValidDateMs(record, startDateKeys);
        const endMs = getFirstValidDateMs(record, endDateKeys);

        const nextBounds = perTypeBounds.get(stationType) ?? { earliestStartMs: null, latestEndMs: null };
        if (startMs !== null) {
          nextBounds.earliestStartMs = nextBounds.earliestStartMs === null
            ? startMs
            : Math.min(nextBounds.earliestStartMs, startMs);
        }
        if (endMs !== null) {
          nextBounds.latestEndMs = nextBounds.latestEndMs === null
            ? endMs
            : Math.max(nextBounds.latestEndMs, endMs);
        }
        perTypeBounds.set(stationType, nextBounds);

        if (startMs === null || endMs === null) {
          return;
        }

        // Use date-only math (ignore time-of-day) and enforce a 1-day minimum for valid pairs.
        const startDateOnly = new Date(startMs);
        const endDateOnly = new Date(endMs);
        const startDayMs = new Date(startDateOnly.getFullYear(), startDateOnly.getMonth(), startDateOnly.getDate()).getTime();
        const endDayMs = new Date(endDateOnly.getFullYear(), endDateOnly.getMonth(), endDateOnly.getDate()).getTime();
        const durationDays = Math.max(1, Math.abs(endDayMs - startDayMs) / msPerDay);
        const vehicleId = String(
          record?.vehicleId ?? record?.vehicleID ?? record?.vehicle_id ?? record?.VehicleId ?? record?.VehicleID ?? record?.vehicle ?? '',
        ).trim() || `record-${recordIndex}`;
        perTypeTotalDays.set(stationType, (perTypeTotalDays.get(stationType) ?? 0) + durationDays);
        if (!perTypeVehiclesWithDuration.has(stationType)) {
          perTypeVehiclesWithDuration.set(stationType, new Set<string>());
        }
        perTypeVehiclesWithDuration.get(stationType)?.add(vehicleId);
      });

      const perTypeTotal = new Map<string, number>();
      const perTypeVehicleCount = new Map<string, number>();

      perTypeTotalDays.forEach((totalDays, stationType) => {
        const safeTotalDays = Number.isFinite(totalDays) && totalDays >= 0 ? totalDays : 0;
        perTypeTotal.set(stationType, safeTotalDays);
        perTypeVehicleCount.set(stationType, perTypeVehiclesWithDuration.get(stationType)?.size ?? 0);
      });

      valuesByProjectId.set(project.id, perTypeTotal);
      vehicleCountsByProjectId.set(project.id, perTypeVehicleCount);
      recordCountsByProjectId.set(project.id, perTypeRecordCount);
      boundsByProjectId.set(project.id, perTypeBounds);
    });

    const orderedStationTypes = preferredStationTypeOrder.filter((name) => stationTypeSet.has(name));
    const extraStationTypes = Array.from(stationTypeSet)
      .filter((name) => !preferredStationTypeOrder.includes(name))
      .sort((a, b) => a.localeCompare(b));
    const stationTypes = [...orderedStationTypes, ...extraStationTypes];
    const safeStationTypes = stationTypes.length ? stationTypes : ['Unspecified'];
    const safeProjects = projects.length ? projects : [{ id: 'no-project-data', name: 'No Project Data' }];

    const formatDateOnly = (epochMs: number | null): string => {
      if (epochMs === null || !Number.isFinite(epochMs)) {
        return 'N/A';
      }

      try {
        return new Date(epochMs).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
        });
      } catch {
        return 'N/A';
      }
    };

    const formatTotalDurationDays = (value: number): string => {
      if (!Number.isFinite(value) || value < 0) {
        return '0';
      }

      // Keep useful precision but avoid forcing trailing .00.
      return Number(value.toFixed(2)).toString();
    };

    const series = safeStationTypes.map((stationType) => ({
      name: stationType,
      data: safeProjects.map((project) => {
        const valueFromDurations = valuesByProjectId.get(project.id)?.get(stationType);
        const hasValidDuration = typeof valueFromDurations === 'number' && Number.isFinite(valueFromDurations);
        const value = hasValidDuration ? Math.max(0, Number(valueFromDurations)) : 0;
        const rawRecordCount = Number(recordCountsByProjectId.get(project.id)?.get(stationType) ?? 0);
        const recordCount = Number.isFinite(rawRecordCount) ? Math.max(0, Math.round(rawRecordCount)) : 0;
        const renderedValue = hasValidDuration
          ? (recordCount > 0 && value <= 0
            ? minVisibleDurationDays
            : (value > 0 && value < minVisibleDurationDays ? minVisibleDurationDays : value))
          : (recordCount > 0 ? minVisibleNoDurationDays : 0);
        const vehicleCountRaw = Number(vehicleCountsByProjectId.get(project.id)?.get(stationType) ?? 0);
        const vehicleCount = Number.isFinite(vehicleCountRaw) ? Math.max(0, Math.round(vehicleCountRaw)) : 0;
        const bounds = boundsByProjectId.get(project.id)?.get(stationType) ?? { earliestStartMs: null, latestEndMs: null };

        return {
          // For horizontal bars, `x` is the category label rendered on Y-axis.
          x: project.name,
          y: renderedValue,
          metaProjectName: project.name,
          metaTotalDurationDays: hasValidDuration ? value : null,
          metaHasValidDuration: hasValidDuration,
          metaRecordCount: recordCount,
          metaVehicleCount: vehicleCount,
          metaEarliestStart: formatDateOnly(bounds.earliestStartMs),
          metaLatestEnd: formatDateOnly(bounds.latestEndMs),
        };
      }),
    }));

    return {
      ...template,
      colors: safeStationTypes.map((stationType) => this.resolveStationTypeColor(stationType)),
      xaxis: {
        ...(template?.xaxis ?? {}),
        type: 'numeric',
        title: {
          ...(template?.xaxis?.title ?? {}),
          text: 'Time (days)',
        },
        labels: {
          ...(template?.xaxis?.labels ?? {}),
          formatter: (value: number) => {
            const numeric = Number(value ?? 0);
            return Number.isFinite(numeric) ? numeric.toFixed(1) : '0.0';
          },
        },
      },
      yaxis: {
        ...(template?.yaxis ?? {}),
        title: {
          ...(template?.yaxis?.title ?? {}),
          text: 'Projects',
        },
      },
      tooltip: {
        ...(template?.tooltip ?? {}),
        fixed: {
          ...(template?.tooltip?.fixed ?? {}),
          enabled: false,
          position: 'topRight',
          offsetX: 0,
          offsetY: 0,
        },
        followCursor: true,
        intersect: true,
        shared: false,
        custom: ({ seriesIndex, dataPointIndex, w }: any) => {
          const point = w?.config?.series?.[seriesIndex]?.data?.[dataPointIndex];
          const stationType = String(w?.config?.series?.[seriesIndex]?.name ?? 'Station Type').trim() || 'Station Type';
          const projectName = String(point?.metaProjectName ?? point?.x ?? 'Project').trim() || 'Project';
          const hasValidDuration = point?.metaHasValidDuration !== false;
          const rawDuration = Number(point?.metaTotalDurationDays ?? point?.y ?? 0);
          const totalDuration = Number.isFinite(rawDuration) ? Math.max(0, rawDuration) : 0;
          const rawVehicleCount = Number(point?.metaVehicleCount ?? 0);
          const vehicleCount = Number.isFinite(rawVehicleCount) ? Math.max(0, Math.round(rawVehicleCount)) : 0;
          const earliestStart = String(point?.metaEarliestStart ?? 'N/A');
          const latestEnd = String(point?.metaLatestEnd ?? 'N/A');
          const averageRoundedUp = vehicleCount > 0
            ? Math.ceil(totalDuration / vehicleCount)
            : null;
          const durationLine = hasValidDuration
            ? `<div><strong>Total Duration (All vehicles):</strong> ${formatTotalDurationDays(totalDuration)} days</div>`
            : `<div><strong>Total Duration (All vehicles):</strong> N/A</div>`;
          const averageLine = hasValidDuration && averageRoundedUp !== null
            ? `<div><strong>Average Duration (rounded up):</strong> ${averageRoundedUp} days</div>`
            : `<div><strong>Average Duration (rounded up):</strong> N/A</div>`;

          return `<div class="apexcharts-tooltip-rangebar" style="padding:8px 10px;">` +
            `<div><strong>Project:</strong> ${projectName}</div>` +
            `<div><strong>Station Type:</strong> ${stationType}</div>` +
            `<div><strong>Earliest Start (across all vehicles):</strong> ${earliestStart}</div>` +
            `<div><strong>Latest End (across all vehicles):</strong> ${latestEnd}</div>` +
            durationLine +
            averageLine +
            `<div><strong>Unique Vehicles:</strong> ${vehicleCount}</div>` +
            `</div>`;
        },
      },
      series,
    };
  }

  private async fetchStationTrackerSetForProject(
    projectId: string,
    pageNumber: number,
    pageSize: number,
    requestVersion: number,
  ): Promise<{ items: any[]; hasNext: boolean }> {
    if (requestVersion !== this.stationTypeHeatmapRequestVersion) {
      return { items: [], hasNext: false };
    }

    return this.fetchStationTrackerSetPage(
      projectId,
      pageNumber,
      pageSize,
      this.stationTrackerFieldsForStationTypeHeatmap,
    );
  }

  private async fetchStationTrackerSetPage(
    projectId: string,
    pageNumber: number,
    pageSize: number,
    projectionFields?: string[],
  ): Promise<{ items: any[]; hasNext: boolean }> {
    const pageItems = await firstValueFrom(this.dashboardProjectsService.getStationTrackers({
      projectId,
      page: pageNumber,
      pageSize,
      orderBy: 'id',
      orderDirection: 'desc',
      fields: projectionFields,
    }));

    const normalizedPageItems = Array.isArray(pageItems) ? pageItems : [];
    return {
      items: normalizedPageItems,
      hasNext: normalizedPageItems.length >= pageSize,
    };
  }

  private async fetchStationTrackerSetsForProjects(
    projects: Array<{ id: string; name: string }>,
    fetchSetForProject: (projectId: string) => Promise<{ items: any[]; hasNext: boolean }>,
  ): Promise<Array<{ projectId: string; items: any[]; hasNext: boolean }>> {
    const maxConcurrentRequests = 3;
    const projectResults: Array<{ projectId: string; items: any[]; hasNext: boolean }> = [];

    for (let start = 0; start < projects.length; start += maxConcurrentRequests) {
      const batch = projects.slice(start, start + maxConcurrentRequests);
      const batchResults = await Promise.all(batch.map(async (project) => {
        const setResult = await fetchSetForProject(project.id);
        return {
          projectId: project.id,
          items: setResult.items,
          hasNext: setResult.hasNext,
        };
      }));

      projectResults.push(...batchResults);

      // Yield to the browser between batches so chart rendering and input stay responsive.
      if (start + maxConcurrentRequests < projects.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    return projectResults;
  }

  private getStationComparisonSharedProjectionFields(): string[] {
    return Array.from(new Set([
      ...this.stationTrackerFieldsForStationTypeHeatmap,
      ...this.stationTrackerFieldsForStationTimeComparison,
    ]));
  }

  private buildProjectsByStationTypeHeatmapOptions(
    projects: Array<{ id: string; name: string }>,
    recordsByProjectId: Map<string, any[]>,
  ): unknown {
    const template = busPulseData.projectsByStationHeatmap as any;
    const preferredStationTypeOrder = ['Client', 'Production', 'Shipped', 'Final', 'None', 'Unspecified'];
    const yAxisLabelColorRaw = template?.yaxis?.labels?.style?.colors;
    const xAxisLabelColorRaw = template?.xaxis?.labels?.style?.colors;
    const yAxisLabelColor = Array.isArray(yAxisLabelColorRaw) ? yAxisLabelColorRaw[0] : yAxisLabelColorRaw;
    const xAxisLabelColor = Array.isArray(xAxisLabelColorRaw) ? xAxisLabelColorRaw[0] : xAxisLabelColorRaw;
    const heatmapCountLabelColor = String(yAxisLabelColor ?? xAxisLabelColor ?? '#5b7e2f');
    const countsByProject = new Map<string, Map<string, number>>();
    const vehiclesByProject = new Map<string, Map<string, Set<string>>>();
    const stationTypeSet = new Set<string>();

    projects.forEach((project) => {
      const nextCounts = new Map<string, number>();
      const nextVehicles = new Map<string, Set<string>>();
      countsByProject.set(project.id, nextCounts);
      vehiclesByProject.set(project.id, nextVehicles);

      const records = recordsByProjectId.get(project.id) ?? [];
      records.forEach((record) => {
        const stationTypeName = this.normalizeStationTypeName(
          record?.stationTypeName ?? record?.station_type_name ?? record?.stationType,
        );
        const vehicleId = String(
          record?.vehicleId ?? record?.vehicleID ?? record?.vehicle_id ?? '',
        ).trim();

        stationTypeSet.add(stationTypeName);
        nextCounts.set(stationTypeName, (nextCounts.get(stationTypeName) ?? 0) + 1);

        if (!nextVehicles.has(stationTypeName)) {
          nextVehicles.set(stationTypeName, new Set<string>());
        }
        if (vehicleId) {
          nextVehicles.get(stationTypeName)?.add(vehicleId);
        }
      });
    });

    const orderedStationTypes = preferredStationTypeOrder.filter((name) => stationTypeSet.has(name));
    const extraStationTypes = Array.from(stationTypeSet)
      .filter((name) => !preferredStationTypeOrder.includes(name))
      .sort((a, b) => a.localeCompare(b));
    const stationTypes = [...orderedStationTypes, ...extraStationTypes];
    const heatmapCategories = stationTypes.length ? stationTypes : ['No Data'];
    const maxDisplayCount = projects.reduce((maxValue, project) => {
      const projectCounts = countsByProject.get(project.id) ?? new Map<string, number>();
      const projectMax = heatmapCategories.reduce((innerMax, stationType) => {
        const nextValue = Number(projectCounts.get(stationType) ?? 0);
        return Number.isFinite(nextValue) ? Math.max(innerMax, nextValue) : innerMax;
      }, 0);
      return Math.max(maxValue, projectMax);
    }, 0);

    let pointColorKey = 1;
    const pointColorRanges: Array<{ from: number; to: number; color: string; name: string }> = [];

    const series = projects.map((project) => {
      const projectCounts = countsByProject.get(project.id) ?? new Map<string, number>();
      return {
        name: project.name,
        data: heatmapCategories.map((stationType) => {
          const count = Number(projectCounts.get(stationType) ?? 0);
          const projectVehicles = vehiclesByProject.get(project.id) ?? new Map<string, Set<string>>();
          const vehicleCount = projectVehicles.get(stationType)?.size ?? 0;
          const baseColor = this.resolveStationTypeColor(stationType);
          const colorStrength = this.resolveStationTypeCellStrength(count, maxDisplayCount);
          const encodedColorValue = pointColorKey++;

          pointColorRanges.push({
            from: encodedColorValue,
            to: encodedColorValue,
            // Use opaque shades (not alpha) so low/high counts are visibly different in Apex heatmap.
            color: this.blendHexWithWhite(baseColor, colorStrength),
            name: stationType,
          });

          return {
            x: stationType,
            // Encode y as a per-cell key so colorScale can apply per-point opacity.
            y: encodedColorValue,
            metaCount: Number.isFinite(count) ? count : 0,
            metaVehicleCount: Number.isFinite(vehicleCount) ? vehicleCount : 0,
          };
        }),
      };
    });

    return {
      ...template,
      colors: heatmapCategories.map((stationType) => this.resolveStationTypeColor(stationType)),
      xaxis: {
        ...(template?.xaxis ?? {}),
        categories: heatmapCategories,
        title: {
          ...(template?.xaxis?.title ?? {}),
          text: 'Station Type',
        },
      },
      yaxis: {
        ...(template?.yaxis ?? {}),
        title: {
          ...(template?.yaxis?.title ?? {}),
          text: 'Projects',
        },
      },
      plotOptions: {
        ...(template?.plotOptions ?? {}),
        heatmap: {
          ...(template?.plotOptions?.heatmap ?? {}),
          shadeIntensity: 0,
          enableShades: false,
          distributed: false,
          useFillColorAsStroke: true,
          colorScale: {
            ...(template?.plotOptions?.heatmap?.colorScale ?? {}),
            inverse: false,
            ranges: pointColorRanges,
          },
        },
      },
      fill: {
        ...(template?.fill ?? {}),
        opacity: 1,
      },
      dataLabels: {
        ...(template?.dataLabels ?? {}),
        enabled: true,
        formatter: (_value: number, opts: any) => {
          const point = opts?.w?.config?.series?.[opts?.seriesIndex]?.data?.[opts?.dataPointIndex];
          const rawCount = Number(point?.metaCount ?? 0);
          return Number.isFinite(rawCount) ? String(rawCount) : '0';
        },
        style: {
          ...(template?.dataLabels?.style ?? {}),
          colors: [heatmapCountLabelColor],
        },
      },
      tooltip: {
        ...(template?.tooltip ?? {}),
        custom: ({ seriesIndex, dataPointIndex, w }: any) => {
          const point = w?.config?.series?.[seriesIndex]?.data?.[dataPointIndex];
          const projectName = String(w?.config?.series?.[seriesIndex]?.name ?? 'Project').trim() || 'Project';
          const stationType = String(point?.x ?? 'Station Type').trim() || 'Station Type';
          const rawCount = Number(point?.metaCount ?? 0);
          const rawVehicleCount = Number(point?.metaVehicleCount ?? 0);
          const count = Number.isFinite(rawCount) ? rawCount : 0;
          const vehicleCount = Number.isFinite(rawVehicleCount) ? rawVehicleCount : 0;

          return `<div class="apexcharts-tooltip-rangebar" style="padding:8px 10px;">` +
            `<div><strong>Project:</strong> ${projectName}</div>` +
            `<div><strong>Station Type:</strong> ${stationType}</div>` +
            `<div><strong>Number of Station Tracker Records:</strong> ${count}</div>` +
            `<div><strong>Unique Vehicles in This Station Type:</strong> ${vehicleCount}</div>` +
            `</div>`;
        },
      },
      legend: {
        ...(template?.legend ?? {}),
        show: true,
        customLegendItems: heatmapCategories,
        markers: {
          ...(template?.legend?.markers ?? {}),
          fillColors: heatmapCategories.map((stationType) => this.resolveStationTypeColor(stationType)),
        },
      },
      series,
    };
  }

  private normalizeStationTypeName(value: unknown): string {
    const stationTypeName = String(value ?? '').trim();
    return stationTypeName || 'Unspecified';
  }

  private resolveStationTypeColor(stationTypeName: string): string {
    const key = String(stationTypeName ?? '').trim().toLowerCase();
    return this.stationTypeColorMap[key] ?? '#95c097';
  }

  private resolveStationTypeCellStrength(count: number, maxCount: number): number {
    const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
    const safeMax = Number.isFinite(maxCount) ? Math.max(0, maxCount) : 0;
    const minStrength = 0.3;

    if (safeMax <= 0) {
      return minStrength;
    }

    const normalized = Math.min(1, safeCount / safeMax);
    return minStrength + (0.7 * normalized);
  }

  private blendHexWithWhite(hexColor: string, strength: number): string {
    const normalizedHex = String(hexColor ?? '').trim().replace('#', '');
    const safeStrength = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1));

    if (!/^[0-9a-fA-F]{6}$/.test(normalizedHex)) {
      return '#95c097';
    }

    const r = Number.parseInt(normalizedHex.slice(0, 2), 16);
    const g = Number.parseInt(normalizedHex.slice(2, 4), 16);
    const b = Number.parseInt(normalizedHex.slice(4, 6), 16);

    const blend = (channel: number): number => Math.round(255 - ((255 - channel) * safeStrength));
    const toHex = (channel: number): string => blend(channel).toString(16).padStart(2, '0');

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }


  private refreshVehicleDistributionWidget(
    widgetId: 'widget-2' | 'widget-3',
    nextRequestVersion: () => number,
    currentRequestVersion: () => number,
    loadData: () => Observable<DashboardVehicleMakeModelDatum[]>,
    buildChartOptions: (items: DashboardVehicleMakeModelDatum[]) => unknown,
  ): void {
    const requestVersion = nextRequestVersion();

    loadData().subscribe({
      next: (items: DashboardVehicleMakeModelDatum[]) => {
        if (requestVersion !== currentRequestVersion()) {
          return;
        }

        this.updateVehicleDistributionWidget(widgetId, buildChartOptions(items));
        this.cdr.markForCheck();
      },
      error: () => {
        if (requestVersion !== currentRequestVersion()) {
          return;
        }

        this.updateVehicleDistributionWidget(widgetId, buildChartOptions([]));
        this.cdr.markForCheck();
      },
    });
  }

  private refreshVehicleStationTrackingWidget(): void {
    const hasVehicleStationWidget = this.widgets.some((widget) => widget.id === 'widget-15');
    if (!hasVehicleStationWidget) {
      this.vehicleStationHasNextPage = false;
      return;
    }

    // Widget-15 is hidden when All Projects is selected, so skip heavy timeline fetches.
    if (this.selectedProject === 'all') {
      this.vehicleStationHasNextPage = false;
      this.widgets = this.widgets.map((w) => (w.id === 'widget-15' ? { ...w, loading: false } : w));
      this.cdr.markForCheck();
      return;
    }

    const requestVersion = ++this.vehicleStationRequestVersion;

    const projectIdParam = this.selectedProject !== 'all' ? this.selectedProject : undefined;
    const vehicleIdParam = this.selectedVehicle !== 'all' ? this.selectedVehicle : undefined;
    const isProjectScoped = !!projectIdParam;

    // set loading flag for widget-15
    this.widgets = this.widgets.map((w) => (w.id === 'widget-15' ? { ...w, loading: true } : w));

    const stationTrackerPageSize = this.vehicleStationPageSize;
    this.dashboardProjectsService.getStationTrackers({
      projectId: projectIdParam,
      vehicleId: vehicleIdParam,
      page: this.vehicleStationPage,
      pageSize: stationTrackerPageSize,
      orderBy: 'id',
      orderDirection: 'desc',
      fields: this.stationTrackerFieldsForVehicleStationTracking,
    }).subscribe({
      next: (items) => {
        if (requestVersion !== this.vehicleStationRequestVersion) return;

        const stationTrackerItems = Array.isArray(items) ? items : [];
        this.vehicleStationHasNextPage = stationTrackerItems.length >= stationTrackerPageSize;

        // If user navigates past the final page, step back one page automatically.
        if (this.vehicleStationPage > 1 && stationTrackerItems.length === 0) {
          this.vehicleStationPage -= 1;
          this.vehicleStationHasNextPage = false;
          this.refreshVehicleStationTrackingWidget();
          return;
        }

        // group by vehicleId
        const grouped = new Map<string, any[]>();
        for (const it of stationTrackerItems) {
          const vid = String(it?.vehicleId ?? it?.vehicleID ?? it?.vehicle_id ?? 'unknown');
          if (!grouped.has(vid)) grouped.set(vid, []);
          grouped.get(vid)!.push(it);
        }

        const palette = ['#1b5e20', '#2e7d32', '#388e3c', '#4caf50', '#66bb6a', '#81c784', '#50c878', '#83bc96'];
        const minVisibleDurationMs = 6 * 60 * 60 * 1000;
        const seriesData: any[] = [];
        let colorIndex = 0;
        const getStationTypeColor = (stationTypeName: string): string => {
          const fromMap = this.resolveStationTypeColor(stationTypeName);
          return fromMap || palette[(colorIndex++) % palette.length];
        };

        // Determine the authoritative list of vehicles to display on the Y axis.
        // Prefer the currently-loaded vehicle options when project-scoped; fall
        // back to allClientVehicles or the IDs returned by the tracker API.
        let vehicleIdsToShow: string[] = [];

        if (vehicleIdParam) {
          vehicleIdsToShow = [String(vehicleIdParam)];
        } else if (isProjectScoped) {
          // For a selected project, keep only vehicles that actually have
          // tracker records so the timeline auto-fits that project's data.
          vehicleIdsToShow = Array.from(grouped.keys());
        } else if (Array.isArray(this.vehicles) && this.vehicles.length > 1) {
          vehicleIdsToShow = (this.vehicles || [])
            .map((v: any) => String(v?.id ?? ''))
            .filter((id: string) => id && id.toLowerCase() !== 'all');
        } else if (Array.isArray(this.allClientVehicles) && this.allClientVehicles.length) {
          vehicleIdsToShow = (this.allClientVehicles || []).map((v: any) => String(v?.id ?? '')).filter((id: string) => id);
        } else {
          vehicleIdsToShow = Array.from(grouped.keys());
        }

        // Ensure unique ordering and then populate series for each vehicle id.
        vehicleIdsToShow = Array.from(new Set(vehicleIdsToShow));

        // Build a single lookup map to avoid repeated .find() calls per vehicle
        const vehicleLookup = new Map<string, any>([
          ...(this.vehicles || []).map((v: any) => [String(v.id), v] as [string, any]),
          ...(this.allClientVehicles || []).map((v: any) => [String(v.id), v] as [string, any]),
        ]);
        const getVehicleLabel = (vid: string): string => {
          const opt = vehicleLookup.get(vid);
          return opt ? String(opt.name ?? opt.id) : `Vehicle ${vid}`;
        };

        // Prepare left-column labels (exposed to template) based on ordered ids
        this.vehicleStationLabels = vehicleIdsToShow.map(getVehicleLabel);

        const parseIsoToMs = (value: unknown): number | null => {
          if (value == null) {
            return null;
          }
          const ms = new Date(String(value)).getTime();
          return Number.isFinite(ms) ? ms : null;
        };

        // Build a safe timeline range from API timestamps without falling back to "now",
        // which can make merged bars look artificially longer.
        const buildTimelineRange = (rec: any): {
          startMs: number;
          endMs: number;
          startIso: string | null;
          endIso: string | null;
        } | null => {
          const rawStartIso = rec?.startDate ?? rec?.dateStarted ?? null;
          const rawEndIso = rec?.endDate ?? rec?.dateEnded ?? null;
          const parsedStartMs = parseIsoToMs(rawStartIso);
          const parsedEndMs = parseIsoToMs(rawEndIso);

          if (parsedStartMs === null && parsedEndMs === null) {
            return null;
          }

          const resolvedStartMs = parsedStartMs ?? parsedEndMs!;
          const resolvedEndMs = parsedEndMs ?? parsedStartMs!;

          return {
            startMs: Math.min(resolvedStartMs, resolvedEndMs),
            endMs: Math.max(resolvedStartMs, resolvedEndMs),
            startIso: parsedStartMs !== null ? String(rawStartIso) : (rawEndIso != null ? String(rawEndIso) : null),
            endIso: parsedEndMs !== null ? String(rawEndIso) : (rawStartIso != null ? String(rawStartIso) : null),
          };
        };

        let timelineMinMs = Number.POSITIVE_INFINITY;
        let timelineMaxMs = Number.NEGATIVE_INFINITY;

        for (const vid of vehicleIdsToShow) {
          const records = grouped.get(vid) ?? [];
          const vehicleLabel = getVehicleLabel(vid);

          if (!records.length) {
            // Do not add a time placeholder here because it distorts x-axis range.
            continue;
          }

          if (this.vehicleStationMergeByType) {
            const mergedByType = new Map<string, {
              stationTypeName: string;
              startMs: number;
              endMs: number;
              startDate: string | null;
              endDate: string | null;
              recordCount: number;
            }>();

            for (const rec of records) {
              const timeline = buildTimelineRange(rec);
              if (!timeline) {
                continue;
              }
              const startMs = timeline.startMs;
              const endMs = timeline.endMs;
              timelineMinMs = Math.min(timelineMinMs, startMs, endMs);
              timelineMaxMs = Math.max(timelineMaxMs, startMs, endMs);

              const stationTypeName = String(rec?.stationTypeName ?? rec?.station_type_name ?? '').trim() || 'Unspecified';
              const existing = mergedByType.get(stationTypeName);

              if (!existing) {
                mergedByType.set(stationTypeName, {
                  stationTypeName,
                  startMs,
                  endMs,
                  startDate: timeline.startIso,
                  endDate: timeline.endIso,
                  recordCount: 1,
                });
                continue;
              }

              existing.recordCount += 1;
              if (startMs < existing.startMs) {
                existing.startMs = startMs;
                existing.startDate = timeline.startIso;
              }
              if (endMs > existing.endMs) {
                existing.endMs = endMs;
                existing.endDate = timeline.endIso;
              }
            }

            Array.from(mergedByType.values())
              .sort((left, right) => left.startMs - right.startMs)
              .forEach((item) => {
                const color = getStationTypeColor(item.stationTypeName);
                const renderEndMs = (item.endMs - item.startMs) >= minVisibleDurationMs
                  ? item.endMs
                  : item.startMs + minVisibleDurationMs;
                timelineMaxMs = Math.max(timelineMaxMs, renderEndMs);
                seriesData.push({
                  x: vehicleLabel,
                  y: [item.startMs, renderEndMs],
                  fillColor: color,
                  meta: {
                    stationId: null,
                    stationNumber: '',
                    stationName: `Merged timeline (${item.recordCount} entries)`,
                    stationTypeName: item.stationTypeName,
                    raw: null,
                    label: item.stationTypeName,
                    startDate: item.startDate,
                    endDate: item.endDate,
                    mergedCount: item.recordCount,
                    isMergedByType: true,
                  },
                });
              });
            continue;
          }

          for (const rec of records) {
            const timeline = buildTimelineRange(rec);
            if (!timeline) {
              continue;
            }
            const startMs = timeline.startMs;
            const endMs = timeline.endMs;
            timelineMinMs = Math.min(timelineMinMs, startMs, endMs);
            const renderEndMs = (endMs - startMs) >= minVisibleDurationMs
              ? endMs
              : startMs + minVisibleDurationMs;
            timelineMaxMs = Math.max(timelineMaxMs, startMs, endMs, renderEndMs);
            const stationId = rec?.stationId ?? rec?.stationID ?? rec?.station_id ?? null;
            const stationNumber = String(rec?.stationNumber ?? rec?.stationNo ?? '').trim();
            const stationName = String(rec?.stationName ?? '').trim();
            const stationTypeName = String(rec?.stationTypeName ?? rec?.station_type_name ?? '').trim();
            const label = stationNumber || stationName || (stationId ? `Station ${stationId}` : String(rec?.description ?? ''));
            const color = palette[(colorIndex++) % palette.length];
            seriesData.push({ x: vehicleLabel, y: [startMs, renderEndMs], fillColor: color, meta: { stationId, stationNumber, stationName, stationTypeName, raw: rec, label, startDate: timeline.startIso, endDate: timeline.endIso } });
          }
        }

        if (!seriesData.length) {
          // Keep chart stable in no-data cases without introducing synthetic date ranges.
          this.vehicleStationLabels = ['No Timeline Data'];
          const now = Date.now();
          seriesData.push({ x: 'No Timeline Data', y: [now, now + 1], fillColor: 'rgba(0,0,0,0)', meta: { stationId: null, stationNumber: '', stationName: '', raw: null, label: '' } });
          timelineMinMs = now;
          timelineMaxMs = now + 1;
        }

        const hasTimeline = Number.isFinite(timelineMinMs) && Number.isFinite(timelineMaxMs) && timelineMaxMs >= timelineMinMs;
        const timeSpan = hasTimeline ? Math.max(timelineMaxMs - timelineMinMs, 24 * 60 * 60 * 1000) : 24 * 60 * 60 * 1000;
        const timelinePadding = Math.max(Math.round(timeSpan * 0.08), 6 * 60 * 60 * 1000);
        const xaxisMin = hasTimeline ? (timelineMinMs - timelinePadding) : undefined;
        const xaxisMax = hasTimeline ? (timelineMaxMs + timelinePadding) : undefined;

        const template = (busPulseData as any).vehicleStationTrackingChart ?? {};

        // Compute chart height so Y-axis labels have room. This will be applied
        // both to Apex options and to the chart host element so the wrapper
        // measures the correct height.
        // Increase per-row pixel allocation and minimum height so vehicle names
        // aren't cramped when many rows are shown.
        const perRowPx = 30; // pixels per vehicle row (increased for readability)
        const minHeight = 480; // raise minimum to afford readable labels
        const maxHeight = 2500;
        const calculatedHeight = Math.min(Math.max(minHeight, (vehicleIdsToShow.length * perRowPx) + 120), maxHeight);

        // Compute width so timeline spacing increases with vehicle count.
        const perVehicleWidth = 60; // px added per vehicle to spread timeline
        const minWidth = 1200;
        const maxWidth = 6000;
        const calculatedWidth = Math.min(Math.max(minWidth, (vehicleIdsToShow.length * perVehicleWidth) + 800), maxWidth);

        const axisTitleColor = template?.yaxis?.title?.style?.color ?? '#1b5e20';
        const groupedHoverFilter = this.vehicleStationMergeByType
          ? { ...(template?.states?.hover?.filter ?? {}), type: 'darken', value: 0.35 }
          : (template?.states?.hover?.filter ?? {});

        const chartOptions = {
          ...(template ?? {}),
          chart: {
            ...(template?.chart ?? {}),
            height: calculatedHeight,
            width: calculatedWidth,
            zoom: { ...(template?.chart?.zoom ?? {}), enabled: false },
            toolbar: { ...(template?.chart?.toolbar ?? {}), show: false },
          },
          plotOptions: {
            ...(template?.plotOptions ?? {}),
            bar: {
              ...(template?.plotOptions?.bar ?? {}),
              barHeight: template?.plotOptions?.bar?.barHeight ?? '60%',
              rangeBarGroupRows: template?.plotOptions?.bar?.rangeBarGroupRows ?? false,
            },
          },
          xaxis: {
            ...(template?.xaxis ?? {}),
            type: 'datetime',
            min: xaxisMin,
            max: xaxisMax,
            tickAmount: 6,
            title: template?.xaxis?.title ?? {
              text: 'Date',
              style: { fontSize: '13px', fontFamily: 'Poppins, sans-serif', color: axisTitleColor },
            },
            labels: {
              ...(template?.xaxis?.labels ?? {}),
              rotate: -30,
              hideOverlappingLabels: true,
              style: { ...(template?.xaxis?.labels?.style ?? {}), fontSize: '11px' },
              formatter: (val: any) => {
                const d = new Date(val);
                try {
                  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
                } catch {
                  return String(val);
                }
              },
            },
          },
          yaxis: {
            ...(template?.yaxis ?? {}),
            title: {
              ...(template?.yaxis?.title ?? {}),
              style: { ...(template?.yaxis?.title?.style ?? {}), color: axisTitleColor },
            },
            labels: {
              ...(template?.yaxis?.labels ?? {}),
              offsetY: template?.yaxis?.labels?.offsetY ?? 0,
              style: {
                ...(template?.yaxis?.labels?.style ?? {}),
                fontSize: '12px',
                lineHeight: '20px',
              },
              formatter: (val: any) => {
                const s = String(val ?? '');
                return s.length > 30 ? s.slice(0, 27) + '\u2026' : s;
              },
            },
          },
          tooltip: {
            ...(template?.tooltip ?? {}),
            custom: ({ seriesIndex, dataPointIndex, w }: any) => {
              const point = w?.config?.series?.[seriesIndex]?.data?.[dataPointIndex];
              const meta = point?.meta ?? {};
              const vehicle = String(point?.x ?? '').trim() || 'Vehicle';
              const stationNumber = String(meta?.stationNumber ?? '').trim();
              const stationName = String(meta?.stationName ?? '').trim();
              const stationTypeName = String(meta?.stationTypeName ?? meta?.raw?.stationTypeName ?? '').trim();
              const stationValue = stationName || stationNumber || String(meta?.label ?? 'Station').trim();
              const stationLine = stationValue ? `<div><strong>Station Name:</strong> ${stationValue}</div>` : '';
              const stationNumberLine = stationNumber ? `<div><strong>Station Number:</strong> ${stationNumber}</div>` : '';
              const stationTypeLine = stationTypeName ? `<div><strong>Station Type:</strong> ${stationTypeName}</div>` : '';

              const fmtDateOnly = (iso?: string | null) => {
                if (!iso) return '';
                try {
                  const d = new Date(iso);
                  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
                } catch (e) {
                  return String(iso);
                }
              };

              const startIso = meta?.startDate ?? null;
              const endIso = meta?.endDate ?? null;
              const startLine = startIso ? `<div><strong>Start:</strong> ${fmtDateOnly(startIso)}</div>` : '';
              const endLine = endIso ? `<div><strong>End:</strong> ${fmtDateOnly(endIso)}</div>` : '';

              return `<div class="apexcharts-tooltip-rangebar" style="padding:8px 10px;">` +
                  `<div><strong>Vehicle:</strong> ${vehicle}</div>` +
                  stationLine +
                  stationNumberLine +
                  stationTypeLine +
                  startLine +
                  endLine +
                  `</div>`;
            },
          },
          states: {
            ...(template?.states ?? {}),
            hover: {
              ...(template?.states?.hover ?? {}),
              filter: groupedHoverFilter,
            },
          },
          series: [{ ...(template?.series?.[0] ?? {}), data: seriesData }],
        };

        // Attach calculated sizes for the host element to consume
        (chartOptions as any).__calculatedHostHeight = calculatedHeight;
        (chartOptions as any).__calculatedHostWidth = calculatedWidth;

        this.widgets = this.widgets.map((w) => (w.id === 'widget-15' ? { ...w, chartOptions, loading: false } : w));
        this.cdr.markForCheck();
      },
      error: () => {
        if (requestVersion !== this.vehicleStationRequestVersion) return;
        this.vehicleStationHasNextPage = false;
        this.widgets = this.widgets.map((w) => (w.id === 'widget-15' ? { ...w, chartOptions: (busPulseData as any).vehicleStationTrackingChart, loading: false } : w));
        try { this.toastService.show('Failed to load Vehicle Station Tracking data', { classname: 'bg-warning text-dark', autohide: true }); } catch { }
        this.cdr.markForCheck();
      }
    });
  }

  private updateVehicleDistributionWidget(widgetId: 'widget-2' | 'widget-3', chartOptions: unknown): void {
    if (!this.widgets.length) return;

    this.widgets = this.widgets.map((widget) => (
      widget.id === widgetId
        ? { ...widget, chartOptions, loading: false }
        : widget
    ));
  }

  private updateTicketsByStatusWidgetFromApi(payload: any | any[]): void {
    if (!this.widgets.length) return;

    let combined: Array<{ name: string; value: number }> = [];
    if (Array.isArray(payload)) {
      for (const p of payload) {
        const items = this.normalizeTicketsByStatusShape(p?.ticketsByStatus ?? p?.data?.ticketsByStatus ?? p?.ticketsByStatus?.items ?? null);
        combined = combined.concat(items.map((it: any) => ({ name: String(it?.name ?? ''), value: Number(it?.value ?? 0) || 0 })));
      }
    } else {
      const items = this.normalizeTicketsByStatusShape(payload?.ticketsByStatus ?? payload?.data?.ticketsByStatus ?? payload?.ticketsByStatus?.items ?? null);
      combined = items.map((it: any) => ({ name: String(it?.name ?? ''), value: Number(it?.value ?? 0) || 0 }));
    }

    // Compute all chart options and apply in a single widgets pass
    this.applyWidgetUpdates({
      'widget-7': { chartOptions: this.computeSafetyCriticalGaugeOptions(payload), loading: false },
      'widget-5': { chartOptions: this.computeRepeatedDefectsGaugeOptions(payload), loading: false },
      'widget-4': { chartOptions: this.computeOverallDefectsByAreaOptions(payload), loading: false },
      'widget-8': { chartOptions: this.computeRepeatedDefectsByAreaOptions(payload), loading: false },
      'widget-6': { chartOptions: this.computeDefectsByStationOptions(payload), loading: false, width: 12 },
      'widget-9': { chartOptions: busPulseData.buildTicketsByStatusBar({ ticketsByStatus: combined }), loading: false },
    });

    if (this.isAdminRole) {
      this.updateStatCardCountsFromPayload(payload);
    }
  }

  private updateStatCardCountsFromPayload(payload: any | any[]): void {
    if (!this.statCards.length) return;

    const source = Array.isArray(payload) ? payload[0] : payload;
    if (!source) return;

    const resolveCount = (candidates: any[]): number | null => {
      for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n) && n >= 0) return n;
      }
      return null;
    };

    const criticalCount = resolveCount([
      source?.safetyCriticalTickets, source?.SafetyCriticalTickets,
      source?.criticalTickets, source?.CriticalTickets,
      source?.data?.safetyCriticalTickets, source?.result?.safetyCriticalTickets,
    ]);

    const repeatedCount = resolveCount([
      source?.repeatedTickets, source?.RepeatedTickets,
      source?.repeatTickets, source?.RepeatTickets,
      source?.data?.repeatedTickets, source?.result?.repeatedTickets,
    ]);

    if (criticalCount === null && repeatedCount === null) return;

    this.statCards = this.statCards.map((card) => {
      if (card.label === 'Critical Issues' && criticalCount !== null) {
        return { ...card, value: criticalCount };
      }
      if (card.label === 'Repeated Issues' && repeatedCount !== null) {
        return { ...card, value: repeatedCount };
      }
      return card;
    });
  }

  private computeOverallDefectsByAreaOptions(payload: any | any[]): unknown {

    const totalsByArea = new Map<string, number>();

    const mergeEntries = (entries: Array<{ area: string; count: number }>) => {
      for (const entry of entries) {
        const area = String(entry.area ?? '').trim();
        const count = Number(entry.count ?? 0);
        if (!area || !Number.isFinite(count) || count < 0) {
          continue;
        }

        totalsByArea.set(area, (totalsByArea.get(area) ?? 0) + count);
      }
    };

    if (Array.isArray(payload)) {
      for (const item of payload) {
        mergeEntries(this.extractOverallByAreaEntries(item));
      }
    } else {
      mergeEntries(this.extractOverallByAreaEntries(payload));
    }

    const merged = Array.from(totalsByArea.entries())
      .map(([area, count]) => ({ area, count }))
      .sort((left, right) => right.count - left.count);

    const readableEntries = this.makeTreemapEntriesReadable(merged);
    const visualSeriesData = this.buildReadableTreemapSeries(readableEntries);

    const fallbackSeries = (busPulseData.defectsByAreaTreemap as any)?.series ?? [];
    const chartOptions = {
      ...(busPulseData.defectsByAreaTreemap as any),
      dataLabels: {
        ...((busPulseData.defectsByAreaTreemap as any)?.dataLabels ?? {}),
        formatter: (text: string, opts: any) => {
          const seriesIndex = Number(opts?.seriesIndex ?? 0);
          const dataPointIndex = Number(opts?.dataPointIndex ?? 0);
          const point = opts?.w?.config?.series?.[seriesIndex]?.data?.[dataPointIndex];
          const rawValue = Number(point?.rawValue ?? point?.y ?? opts?.value ?? 0);
          const safeValue = Number.isFinite(rawValue) ? rawValue : 0;
          return [text, safeValue.toLocaleString()];
        },
      },
      tooltip: {
        ...((busPulseData.defectsByAreaTreemap as any)?.tooltip ?? {}),
        y: {
          ...((busPulseData.defectsByAreaTreemap as any)?.tooltip?.y ?? {}),
          formatter: (_value: number, opts: any) => {
            const seriesIndex = Number(opts?.seriesIndex ?? 0);
            const dataPointIndex = Number(opts?.dataPointIndex ?? 0);
            const point = opts?.w?.config?.series?.[seriesIndex]?.data?.[dataPointIndex];
            const rawValue = Number(point?.rawValue ?? point?.y ?? 0);
            return Number.isFinite(rawValue) ? rawValue.toLocaleString() : '0';
          },
        },
      },
      series: visualSeriesData.length > 0
        ? [
            {
              data: visualSeriesData,
            },
          ]
        : fallbackSeries,
    };

    return chartOptions;
  }

  private computeRepeatedDefectsGaugeOptions(payload: any | any[]): unknown {
    const percent = this.resolveRepeatedPercent(payload);
    const boundedPercent = Math.max(0, Math.min(100, percent));
    return { ...(busPulseData.repeatedDefectsGauge as any), series: [Number(boundedPercent.toFixed(2))] };
  }

  private computeSafetyCriticalGaugeOptions(payload: any | any[]): unknown {
    const percent = this.resolveSafetyCriticalPercent(payload);
    const boundedPercent = Math.max(0, Math.min(100, percent));
    return { ...(busPulseData.safetyCriticalDefectsGauge as any), series: [Number(boundedPercent.toFixed(2))] };
  }

  /** Apply one or more widget updates in a single array pass. */
  private applyWidgetUpdates(updates: Record<string, Partial<DashboardWidget>>): void {
    if (!this.widgets.length || !Object.keys(updates).length) return;
    this.widgets = this.widgets.map((w) => updates[w.id] ? { ...w, ...updates[w.id] } : w);
  }

  private resolveSafetyCriticalPercent(payload: any | any[]): number {
    const readPercent = (source: any): number | null => {
      const candidates = [
        source?.safetyCriticalPercent,
        source?.SafetyCriticalPercent,
        source?.criticalPercent,
        source?.CriticalPercent,
        source?.data?.safetyCriticalPercent,
        source?.data?.SafetyCriticalPercent,
        source?.result?.safetyCriticalPercent,
        source?.result?.SafetyCriticalPercent,
      ];

      for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      }

      return null;
    };

    const readSafetyCriticalTickets = (source: any): number | null => {
      const candidates = [
        source?.safetyCriticalTickets,
        source?.SafetyCriticalTickets,
        source?.criticalTickets,
        source?.CriticalTickets,
        source?.data?.safetyCriticalTickets,
        source?.result?.safetyCriticalTickets,
      ];

      for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      }

      return null;
    };

    const readTotalTickets = (source: any): number | null => {
      const candidates = [
        source?.totalTickets,
        source?.TotalTickets,
        source?.total,
        source?.count,
        source?.data?.totalTickets,
        source?.result?.totalTickets,
      ];

      for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      }

      return null;
    };

    const computePercent = (source: any): number | null => {
      const explicitPercent = readPercent(source);
      if (explicitPercent !== null) {
        return explicitPercent;
      }

      const criticalTickets = readSafetyCriticalTickets(source);
      const totalTickets = readTotalTickets(source);
      if (criticalTickets !== null && totalTickets !== null && totalTickets > 0) {
        return (criticalTickets / totalTickets) * 100;
      }

      return null;
    };

    if (!Array.isArray(payload)) {
      return computePercent(payload) ?? 0;
    }

    let weightedPercentSum = 0;
    let weightedTotal = 0;
    const fallbackPercents: number[] = [];

    for (const item of payload) {
      const totalTickets = readTotalTickets(item);
      const percent = computePercent(item);
      if (percent === null) {
        continue;
      }

      if (totalTickets !== null && totalTickets > 0) {
        weightedPercentSum += percent * totalTickets;
        weightedTotal += totalTickets;
      } else {
        fallbackPercents.push(percent);
      }
    }

    if (weightedTotal > 0) {
      return weightedPercentSum / weightedTotal;
    }

    if (fallbackPercents.length > 0) {
      const sum = fallbackPercents.reduce((acc, value) => acc + value, 0);
      return sum / fallbackPercents.length;
    }

    return 0;
  }

  private resolveRepeatedPercent(payload: any | any[]): number {
    const readPercent = (source: any): number | null => {
      const candidates = [
        source?.repeatedPercent,
        source?.RepeatedPercent,
        source?.data?.repeatedPercent,
        source?.data?.RepeatedPercent,
        source?.result?.repeatedPercent,
        source?.result?.RepeatedPercent,
      ];

      for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      }

      return null;
    };

    const normalizePercentValue = (value: number): number => {
      if (!Number.isFinite(value) || value < 0) {
        return 0;
      }

      // Handle APIs that return ratios (0..1) instead of percentages (0..100).
      if (value > 0 && value <= 1) {
        return value * 100;
      }

      return value;
    };

    const readRepeatedTickets = (source: any): number | null => {
      const candidates = [
        source?.repeatedTickets,
        source?.RepeatedTickets,
        source?.repeatTickets,
        source?.RepeatTickets,
        source?.data?.repeatedTickets,
        source?.result?.repeatedTickets,
      ];

      for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      }

      return null;
    };

    const readTotalTickets = (source: any): number | null => {
      const candidates = [
        source?.totalTickets,
        source?.TotalTickets,
        source?.total,
        source?.count,
        source?.data?.totalTickets,
        source?.result?.totalTickets,
      ];

      for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      }

      return null;
    };

    const computePercent = (source: any): number | null => {
      const explicitPercent = readPercent(source);
      if (explicitPercent !== null) {
        return normalizePercentValue(explicitPercent);
      }

      const repeatedTickets = readRepeatedTickets(source);
      const totalTickets = readTotalTickets(source);
      if (repeatedTickets !== null && totalTickets !== null && totalTickets > 0) {
        return (repeatedTickets / totalTickets) * 100;
      }

      return null;
    };

    if (!Array.isArray(payload)) {
      return computePercent(payload) ?? 0;
    }

    let weightedPercentSum = 0;
    let weightedTotal = 0;
    const fallbackPercents: number[] = [];

    for (const item of payload) {
      const percent = computePercent(item);
      if (percent === null) {
        continue;
      }

      const totalTickets = readTotalTickets(item);
      if (totalTickets !== null && totalTickets > 0) {
        weightedPercentSum += percent * totalTickets;
        weightedTotal += totalTickets;
      } else {
        fallbackPercents.push(percent);
      }
    }

    if (weightedTotal > 0) {
      return weightedPercentSum / weightedTotal;
    }

    if (fallbackPercents.length > 0) {
      const sum = fallbackPercents.reduce((acc, value) => acc + value, 0);
      return sum / fallbackPercents.length;
    }

    return 0;
  }

  private makeTreemapEntriesReadable(entries: Array<{ area: string; count: number }>): Array<{ area: string; count: number }> {
    if (!entries.length) {
      return [];
    }

    const maxEntries = 12;
    if (entries.length <= maxEntries) {
      return entries;
    }

    const head = entries.slice(0, maxEntries - 1);
    const tailTotal = entries.slice(maxEntries - 1).reduce((sum, item) => sum + item.count, 0);
    if (tailTotal > 0) {
      head.push({ area: 'Other', count: tailTotal });
    }
    return head;
  }

  private buildReadableTreemapSeries(entries: Array<{ area: string; count: number }>): Array<{ x: string; y: number; rawValue: number }> {
    if (!entries.length) {
      return [];
    }

    const highest = Math.max(...entries.map((entry) => entry.count));
    const highestRoot = Math.sqrt(Math.max(highest, 0));
    const minVisibleRatio = 0.18;

    return entries.map((entry) => {
      const rootScaled = Math.sqrt(Math.max(entry.count, 0));
      const minVisible = highestRoot * minVisibleRatio;
      const visualValue = entry.count > 0
        ? Math.max(rootScaled, minVisible)
        : 0;

      return {
        x: entry.area,
        y: Number(visualValue.toFixed(4)),
        rawValue: entry.count,
      };
    });
  }

  private extractOverallByAreaEntries(payload: any): Array<{ area: string; count: number }> {
    const container =
      payload?.overallByDefectType ?? payload?.data?.overallByDefectType ?? payload?.result?.overallByDefectType ??
      payload?.overallByArea       ?? payload?.data?.overallByArea       ?? payload?.result?.overallByArea;
    if (!container) {
      return [];
    }

    const toEntriesFromArray = (items: any[]): Array<{ area: string; count: number }> => {
      return items
        .map((item) => {
          const area = String(item?.area ?? item?.name ?? item?.label ?? item?.x ?? '').trim();
          const count = Number(item?.count ?? item?.value ?? item?.y ?? 0);
          return { area, count };
        })
        .filter((entry) => entry.area.length > 0 && Number.isFinite(entry.count) && entry.count >= 0);
    };

    if (Array.isArray(container)) {
      return toEntriesFromArray(container);
    }

    if (Array.isArray(container?.items)) {
      return toEntriesFromArray(container.items);
    }

    if (Array.isArray(container?.$values)) {
      return toEntriesFromArray(container.$values);
    }

    if (typeof container === 'object') {
      return Object.entries(container)
        .map(([key, value]) => ({ area: String(key).trim(), count: Number(value ?? 0) }))
        .filter((entry) => entry.area.length > 0 && Number.isFinite(entry.count) && entry.count >= 0);
    }

    return [];
  }

  private computeRepeatedDefectsByAreaOptions(payload: any | any[]): unknown {

    const totalsByArea = new Map<string, number>();

    const mergeEntries = (entries: Array<{ area: string; count: number }>) => {
      for (const entry of entries) {
        const area = String(entry.area ?? '').trim();
        const count = Number(entry.count ?? 0);
        if (!area || !Number.isFinite(count) || count < 0) {
          continue;
        }

        totalsByArea.set(area, (totalsByArea.get(area) ?? 0) + count);
      }
    };

    if (Array.isArray(payload)) {
      for (const item of payload) {
        mergeEntries(this.extractRepeatedByAreaEntries(item));
      }
    } else {
      mergeEntries(this.extractRepeatedByAreaEntries(payload));
    }

    const merged = Array.from(totalsByArea.entries())
      .map(([area, count]) => ({ area, count }))
      .sort((left, right) => right.count - left.count);

    const readableEntries = this.makeTreemapEntriesReadable(merged);
    const visualSeriesData = this.buildReadableTreemapSeries(readableEntries);
    const fallbackSeries = (busPulseData.repeatedDefectsByAreaTreemap as any)?.series ?? [];

    const chartOptions = {
      ...(busPulseData.repeatedDefectsByAreaTreemap as any),
      dataLabels: {
        ...((busPulseData.repeatedDefectsByAreaTreemap as any)?.dataLabels ?? {}),
        formatter: (text: string, opts: any) => {
          const seriesIndex = Number(opts?.seriesIndex ?? 0);
          const dataPointIndex = Number(opts?.dataPointIndex ?? 0);
          const point = opts?.w?.config?.series?.[seriesIndex]?.data?.[dataPointIndex];
          const rawValue = Number(point?.rawValue ?? point?.y ?? opts?.value ?? 0);
          const safeValue = Number.isFinite(rawValue) ? rawValue : 0;
          return [text, safeValue.toLocaleString()];
        },
      },
      tooltip: {
        ...((busPulseData.repeatedDefectsByAreaTreemap as any)?.tooltip ?? {}),
        y: {
          ...((busPulseData.repeatedDefectsByAreaTreemap as any)?.tooltip?.y ?? {}),
          formatter: (_value: number, opts: any) => {
            const seriesIndex = Number(opts?.seriesIndex ?? 0);
            const dataPointIndex = Number(opts?.dataPointIndex ?? 0);
            const point = opts?.w?.config?.series?.[seriesIndex]?.data?.[dataPointIndex];
            const rawValue = Number(point?.rawValue ?? point?.y ?? 0);
            return Number.isFinite(rawValue) ? rawValue.toLocaleString() : '0';
          },
        },
      },
      series: visualSeriesData.length > 0
        ? [
            {
              data: visualSeriesData,
            },
          ]
        : fallbackSeries,
    };

    return chartOptions;
  }

  private computeDefectsByStationOptions(payload: any | any[]): unknown {

    const totalsByStation = new Map<string, number>();

    const mergeEntries = (entries: Array<{ station: string; value: number }>) => {
      for (const entry of entries) {
        const station = String(entry.station ?? '').trim();
        const value = Number(entry.value ?? 0);
        if (!station || !Number.isFinite(value) || value < 0) {
          continue;
        }

        totalsByStation.set(station, (totalsByStation.get(station) ?? 0) + value);
      }
    };

    if (Array.isArray(payload)) {
      for (const item of payload) {
        mergeEntries(this.extractDefectsByStationEntries(item));
      }
    } else {
      mergeEntries(this.extractDefectsByStationEntries(payload));
    }

    const groupedByLegend = new Map<
      string,
      { label: string; value: number; orderNumber: number | null; fullNames: Set<string> }
    >();

    for (const [station, value] of totalsByStation.entries()) {
      const label = this.getStationLegendLabel(station);
      const orderNumber = this.extractStationPrefixNumber(station);
      const existing = groupedByLegend.get(label);

      if (existing) {
        existing.value += value;
        existing.fullNames.add(station);
        continue;
      }

      groupedByLegend.set(label, {
        label,
        value,
        orderNumber,
        fullNames: new Set<string>([station]),
      });
    }

    const stationEntries = Array.from(groupedByLegend.values())
      .map((entry) => ({
        label: entry.label,
        value: entry.value,
        orderNumber: entry.orderNumber,
        fullNames: Array.from(entry.fullNames.values()),
      }))
      .sort((left, right) => {
        if (left.orderNumber !== null && right.orderNumber !== null) {
          if (left.orderNumber !== right.orderNumber) {
            return left.orderNumber - right.orderNumber;
          }
          return left.label.localeCompare(right.label);
        }

        if (left.orderNumber !== null) return -1;
        if (right.orderNumber !== null) return 1;
        return left.label.localeCompare(right.label);
      });

    const fullStationNames = stationEntries.map((entry) => entry.fullNames.join(', '));
    const rawValues = stationEntries.map((entry) => Number(entry.value.toFixed(2)));
    const barColors = stationEntries.map((_, index) => {
      const ratio = stationEntries.length > 1 ? index / (stationEntries.length - 1) : 0;
      const lightness = 28 + ratio * 38;
      return `hsl(132, 56%, ${lightness.toFixed(1)}%)`;
    });

    const maxRaw = Math.max(...rawValues, 0);
    const maxLog = Math.log10(Math.max(maxRaw, 0) + 1);
    const minVisibleRatio = 0.28;
    const scaledValues = rawValues.map((value) => {
      if (value <= 0) {
        return 0;
      }
      const scaled = Math.log10(value + 1);
      return Number(Math.max(scaled, maxLog * minVisibleRatio).toFixed(4));
    });

    const fallbackChart = busPulseData.defectsByStationChart as any;
    const categories = stationEntries.map((entry) => entry.label);

    const chartOptions = {
      ...fallbackChart,
      chart: {
        ...(fallbackChart?.chart ?? {}),
      },
      xaxis: {
        ...(fallbackChart?.xaxis ?? {}),
        categories: categories.length > 0 ? categories : (fallbackChart?.xaxis?.categories ?? []),
        labels: {
          ...((fallbackChart?.xaxis as any)?.labels ?? {}),
          show: true,
          rotate: -90,
          rotateAlways: true,
          trim: false,
          hideOverlappingLabels: false,
          showDuplicates: true,
          formatter: (value: string) => this.wrapLongLegendText(value),
          style: {
            ...((fallbackChart?.xaxis as any)?.labels?.style ?? {}),
            fontSize: '10px',
          },
        },
      },
      yaxis: {
        ...(fallbackChart?.yaxis ?? {}),
        show: true,
        tickAmount: 6,
        labels: {
          ...((fallbackChart?.yaxis as any)?.labels ?? {}),
          formatter: (value: number) => {
            if (!Number.isFinite(value)) {
              return '0';
            }
            const rawApprox = Math.pow(10, value) - 1;
            return Number.isFinite(rawApprox) ? Math.max(0, Math.round(rawApprox)).toLocaleString() : '0';
          },
        },
      },
      plotOptions: {
        ...(fallbackChart?.plotOptions ?? {}),
        bar: {
          ...((fallbackChart?.plotOptions as any)?.bar ?? {}),
          horizontal: false,
          distributed: true,
          columnWidth: '55%',
          borderRadius: 5,
        },
      },
      colors: barColors,
      legend: {
        ...(fallbackChart?.legend ?? {}),
        show: false,
        showForSingleSeries: false,
        position: 'bottom',
      },
      dataLabels: {
        ...(fallbackChart?.dataLabels ?? {}),
        enabled: true,
        formatter: (_val: number, opts: any) => {
          const dataPointIndex = Number(opts?.dataPointIndex ?? -1);
          const raw = dataPointIndex >= 0 ? rawValues[dataPointIndex] : 0;
          return Number.isFinite(raw) ? raw.toLocaleString() : '0';
        },
        style: {
          ...((fallbackChart?.dataLabels as any)?.style ?? {}),
          colors: ['#212529'],
        },
      },
      series: scaledValues.length > 0
        ? [{
            name: 'Avg Defects',
            data: scaledValues,
          }]
        : (fallbackChart?.series ?? []),
      tooltip: {
        ...(fallbackChart?.tooltip ?? {}),
        x: {
          ...((fallbackChart?.tooltip?.x as any) ?? {}),
          formatter: (_value: string, opts: any) => {
            const dataPointIndex = Number(opts?.dataPointIndex ?? -1);
            const fullName = dataPointIndex >= 0 ? fullStationNames[dataPointIndex] : '';
            return fullName || 'Station';
          },
        },
        y: {
          ...(fallbackChart?.tooltip?.y ?? {}),
          formatter: (_val: number, opts: any) => {
            const dataPointIndex = Number(opts?.dataPointIndex ?? -1);
            const raw = dataPointIndex >= 0 ? rawValues[dataPointIndex] : 0;
            return Number.isFinite(raw) ? raw.toLocaleString() : '0';
          },
        },
      },
    };

    return chartOptions;
  }

  private extractStationPrefixNumber(stationName: string): number | null {
    const normalized = String(stationName ?? '').trim();
    const match = normalized.match(/^(\d{1,3})(?=\s|\.|-|$)/);
    if (!match?.[1]) {
      return null;
    }

    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private getStationLegendLabel(stationName: string): string {
    const numericPrefix = this.extractStationPrefixNumber(stationName);
    if (numericPrefix !== null) {
      return String(numericPrefix);
    }

    const normalized = String(stationName ?? '').trim();
    return normalized || 'Unknown';
  }

  private wrapLongLegendText(value: string, maxCharsPerLine = 12): string {
    const text = String(value ?? '').trim();
    if (!text) {
      return '';
    }

    // Keep compact numeric station labels on one line.
    if (/^\d+$/.test(text)) {
      return text;
    }

    if (text.length <= maxCharsPerLine) {
      return text;
    }

    const words = text.split(/\s+/);
    if (words.length === 1) {
      const parts: string[] = [];
      for (let i = 0; i < text.length; i += maxCharsPerLine) {
        parts.push(text.slice(i, i + maxCharsPerLine));
      }
      return parts.join('\n');
    }

    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxCharsPerLine) {
        current = next;
      } else {
        if (current) {
          lines.push(current);
        }
        current = word;
      }
    }

    if (current) {
      lines.push(current);
    }

    return lines.join('\n');
  }

  private extractDefectsByStationEntries(payload: any): Array<{ station: string; value: number }> {
    const container = payload?.defectsByStation ?? payload?.data?.defectsByStation ?? payload?.result?.defectsByStation;
    if (!container) {
      return [];
    }

    const toEntriesFromArray = (items: any[]): Array<{ station: string; value: number }> => {
      return items
        .map((item) => {
          const station = String(
            item?.station ?? item?.stationName ?? item?.name ?? item?.label ?? item?.x ?? '',
          ).trim();
          const value = Number(item?.value ?? item?.count ?? item?.avg ?? item?.y ?? 0);
          return { station, value };
        })
        .filter((entry) => entry.station.length > 0 && Number.isFinite(entry.value) && entry.value >= 0);
    };

    if (Array.isArray(container)) {
      return toEntriesFromArray(container);
    }

    if (Array.isArray(container?.items)) {
      return toEntriesFromArray(container.items);
    }

    if (Array.isArray(container?.$values)) {
      return toEntriesFromArray(container.$values);
    }

    if (typeof container === 'object') {
      return Object.entries(container)
        .map(([key, value]) => ({ station: String(key).trim(), value: Number(value ?? 0) }))
        .filter((entry) => entry.station.length > 0 && Number.isFinite(entry.value) && entry.value >= 0);
    }

    return [];
  }

  private extractRepeatedByAreaEntries(payload: any): Array<{ area: string; count: number }> {
    const container = payload?.repeatedByArea ?? payload?.data?.repeatedByArea ?? payload?.result?.repeatedByArea;
    if (!container) {
      return [];
    }

    const toEntriesFromArray = (items: any[]): Array<{ area: string; count: number }> => {
      return items
        .map((item) => {
          const area = String(item?.area ?? item?.name ?? item?.label ?? item?.x ?? '').trim();
          const count = Number(item?.count ?? item?.value ?? item?.y ?? 0);
          return { area, count };
        })
        .filter((entry) => entry.area.length > 0 && Number.isFinite(entry.count) && entry.count >= 0);
    };

    if (Array.isArray(container)) {
      return toEntriesFromArray(container);
    }

    if (Array.isArray(container?.items)) {
      return toEntriesFromArray(container.items);
    }

    if (Array.isArray(container?.$values)) {
      return toEntriesFromArray(container.$values);
    }

    if (typeof container === 'object') {
      return Object.entries(container)
        .map(([key, value]) => ({ area: String(key).trim(), count: Number(value ?? 0) }))
        .filter((entry) => entry.area.length > 0 && Number.isFinite(entry.count) && entry.count >= 0);
    }

    return [];
  }

  private getSelectedOrAllVisibleProjectIds(): string[] {
    const selectedProjectId = String(this.selectedProject ?? '').trim().toLowerCase();
    if (selectedProjectId && selectedProjectId !== 'all') {
      return [String(this.selectedProject ?? '').trim()];
    }

    return this.projects
      .map((project) => String(project.id ?? '').trim())
      .filter((projectId) => !!projectId && projectId.toLowerCase() !== 'all');
  }

  private normalizeTicketsByStatusShape(input: any): Array<{ name: string; value: number }> {
    // Accepts multiple shapes and returns an array of { name, value }.
    if (!input && input !== 0) return [];

    // If already an array of items
    if (Array.isArray(input)) {
      return input.map((it: any) => ({ name: String(it?.name ?? it?.label ?? ''), value: Number(it?.value ?? it?.count ?? 0) || 0 }));
    }

    // If it's an object map: { 'Open': 10, 'In Progress': 5 }
    if (typeof input === 'object') {
      // If it has categories/values shape
      const categories = Array.isArray(input?.categories) ? input.categories : null;
      const values = Array.isArray(input?.values) ? input.values : null;
      if (categories && values && categories.length === values.length) {
        return categories.map((c: any, i: number) => ({ name: String(c ?? ''), value: Number(values[i] ?? 0) || 0 }));
      }

      // Fallback: enumerate own keys
      return Object.keys(input).map((k) => ({ name: String(k), value: Number((input as any)[k] ?? 0) || 0 }));
    }

    return [];
  }

  private buildWidgets(): DashboardWidget[] {
    return sortWidgetsByOrder(this.widgets).map((item) => ({ ...item }));
  }

  private loadLayoutFromStorage(): void {
    try {
      const parsedLayout = readWidgetLayout(this.getLayoutStorageKey());
      if (!parsedLayout) {
        this.applyDefaultWidgetLayout();
        return;
      }

      this.widgets = sortWidgetsByOrder(applyWidgetLayout(this.widgets, parsedLayout));
      // Ensure Vehicle Station Tracking (`widget-15`) appears above Project Timeline (`widget-13`)
      // even if user had a saved layout that placed them differently. This keeps the
      // requested default ordering consistent across environments. If you prefer
      // to preserve user custom layouts, remove this migration.
      try {
        const idx15 = this.widgets.findIndex((w) => w.id === 'widget-15');
        const idx13 = this.widgets.findIndex((w) => w.id === 'widget-13');
        if (idx15 > -1 && idx13 > -1 && idx15 > idx13) {
          // swap their order values and persist
          const w15 = { ...this.widgets[idx15] };
          const w13 = { ...this.widgets[idx13] };
          const tempOrder = w15.order;
          w15.order = w13.order;
          w13.order = tempOrder;
          this.widgets[idx15] = w15;
          this.widgets[idx13] = w13;
          this.widgets = sortWidgetsByOrder(this.widgets);
          this.saveLayoutToStorage();
        }
      } catch {
        // ignore migration failures
      }
    } catch {
      this.applyDefaultWidgetLayout();
    }
  }

  private saveLayoutToStorage(): void {
    try {
      saveWidgetLayout(this.getLayoutStorageKey(), this.widgets);
    } catch {
      // ignore storage write failures
    }
  }

  private applyDefaultWidgetLayout(): void {
    const defaults = this.isAdminRole ? ADMIN_DEFAULT_WIDGET_LAYOUT : DEFAULT_WIDGET_LAYOUT;
    this.widgets = sortWidgetsByOrder(applyDefaultWidgetLayout(this.widgets, defaults));
    this.saveLayoutToStorage();
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.resizeSession) return;
    applyResizeDeltaToDom(this.resizeSession, event);
  }

  private onMouseUp(): void {
    if (!this.resizeSession) return;

    const { widgetId, handle, currentWidth, currentHeight } = this.resizeSession;
    const widget = this.widgets.find((item) => item.id === widgetId);
    if (widget) {
      if (handle === 'corner' || handle === 'right') widget.width = currentWidth;
      if (handle === 'corner' || handle === 'bottom') widget.height = currentHeight;
    }

    this.resizeSession = null;
    document.body.classList.remove('is-resizing');
    document.body.style.cursor = '';
    window.dispatchEvent(new Event('resize'));
    this.saveLayoutToStorage();
    this.cdr.markForCheck();
  }

  private extractTicketTotal(response: any): number {
    const candidates = [
      response?.totalTickets,
      response?.total,
      response?.count,
      response?.totalItems,
      response?.totalRecords,
    ];
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return Number(this.currentProjectStats.totalTickets ?? 0);
  }

  private fetchAllClientVehiclesAndTickets(): void {
    if (this.isAdminRole) return;
    const clientId = this.getEffectiveClientId();
    // Fetch all vehicles
    this.dashboardProjectsService.getAllVehicleOptionsResult({ clientId }).subscribe({
      next: (result) => {
        this.allClientVehicles = result.options || [];
      },
    });
    // Fetch all tickets
    this.clientDashboardService.getTickets({ clientId, page: 1, pageSize: 1000 }).subscribe({
      next: (response: unknown) => {
        const tickets = extractArrayFromApiResponse(response);
        this.allClientTickets = tickets;
        // Collect all unique assignBy and assignTo IDs
        const userIds = Array.from(new Set(
          tickets
            .flatMap((t: any) => [Number(t?.assignBy), Number(t?.assignTo)])
            .filter((id) => Number.isFinite(id) && id > 0)
        ));
        if (userIds.length) {
          // Batch fetch user details
          this.userManagementService.getUsers({ page: 1, pageSize: userIds.length, role: '', clientId: '', manufacturerId: '' }).subscribe({
            next: (result: any) => {
              if (result && Array.isArray(result.items)) {
                for (const user of result.items) {
                  this.userIdToUsername[user.id] = user.username || user.name || 'Unknown';
                }
              }
            }
          });
        }
      },
    });
  }
}

