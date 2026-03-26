import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { NgSelectModule } from '@ng-select/ng-select';
import { NgApexchartsModule } from 'ng-apexcharts';
import { catchError, forkJoin, from, map, mergeMap, Observable, of, Subscription, switchMap, toArray } from 'rxjs';
import { SpkApexChartsComponent } from '../../../@spk/reusable-charts/spk-apex-charts/spk-apex-charts.component';
import { SharedModule } from '../../shared.module';
import { MapStageComponent } from '../fleet-map/components/map-stage/map-stage.component';
import * as busPulseData from '../../data/bus-pulse-dashboard';
import { defaultClientProfile } from '../../data/client-profiles-dashboard';
import { projectStats } from '../../data/client-tickets-assets';
import {
  DashboardWidget,
  ProjectStats,
  RecentActivity,
  VehicleStats,
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
  PROJECT_TYPE_LOOKUP,
} from './dashboard.constants';
import {
  buildAdminStatCards,
  buildClientStatCards,
  resolveClientProjectStats,
} from './dashboard-stats.utils';
import {
  buildProjectsByAreaChartOptions,
  buildProjectStatusChartOptions,
  buildVehiclesByMakeModelChartOptions,
  buildVehiclesByPropulsionTypeChartOptions,
  normalizeAreaEntries,
} from './dashboard-chart.utils';
import {
  bucketTicketCreationActivityPoints,
  buildTicketCreationActivityChartOptions,
  DashboardTicketActivityGranularity,
  DashboardTicketActivityResult,
} from './dashboard-ticket-activity.utils';
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
import { Inject } from '@angular/core';
import { ToastService } from '../../../components/elements/toast/toast.service';
import { DefectWordCloudWidgetComponent } from '../../components/defect-word-cloud-widget/defect-word-cloud-widget.component';
import { VehicleActivitiesWidgetComponent } from '../../components/vehicle-activities-widget/vehicle-activities-widget.component';
import {
  SpkTicketActivityWidgetComponent,
  SpkTicketActivityWidgetViewModel,
} from '../../../@spk/reusable-dashboard/spk-ticket-activity-widget/spk-ticket-activity-widget.component';
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
import { getFirstDefinedValue, toOptionalText, toText } from '../../utils/api-data.utils';
import { ProjectActivitiesDataService } from '../../services/project-activities-data.service';
import ExcelJS from 'exceljs';

type DashboardMapStatusFilter = 'all' | ApiProject['status'];

interface DashboardMapFilterOption {
  id: string;
  label: string;
}

type DashboardMapStatusOption = { id: DashboardMapStatusFilter; label: string };
type TicketActivityRangePreset = '30d' | '90d' | '180d' | '365d' | 'all' | 'custom';

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
    DefectWordCloudWidgetComponent,
    VehicleActivitiesWidgetComponent,
    SpkTicketActivityWidgetComponent,
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
  projectActivitiesRows: ProjectStats[] = [];
  projectActivitiesLoading = false;
  projectActivitiesTotalCount = 0;
  projectActivitiesCurrentPage = 0;
  readonly projectActivitiesPageSize = 5;

  allClientVehicles: any[] = [];
  allClientTickets: any[] = [];
  userIdToUsername: { [id: number]: string } = {};

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

  userPicture = '';
  private dataInitialized = false;
  private resizeSession: DashboardResizeSession | null = null;
  private projectsRequestVersion = 0;
  private vehiclesRequestVersion = 0;
  private makeModelRequestVersion = 0;
  private propulsionRequestVersion = 0;
  private vehicleStationRequestVersion = 0;
  private widget10RequestVersion = 0;
  private ticketActivityRequestVersion = 0;
  private projectTimelineRequestVersion = 0;
  // Labels shown in the left column of widget-15 (vehicle list)
  vehicleStationLabels: string[] = [];
  // Date range filter for widget-13 (Project Timeline)
  projectTimelineStartDate = '';
  projectTimelineEndDate = '';
  ticketActivityStartDate = '';
  ticketActivityEndDate = '';
  ticketActivityRangePreset: TicketActivityRangePreset = '90d';
  ticketActivityCustomRangeOpen = false;
  ticketActivityDownloadMenuOpen = false;
  ticketActivityGranularity: DashboardTicketActivityGranularity = 'day';
  projectTimelinePageNumber = 1;
  projectTimelinePageSize = 50;
  projectTimelineTotalCount = 0;
  projectTimelineLoadedPageCount = 1;
  projectTimelineLoadedAllRecords = false;
  readonly projectTimelinePageSizeOptions = [25, 50, 100];
  private projectTimelineItems: any[] = [];
  private lastTicketActivityResult: DashboardTicketActivityResult | null = null;
  private ticketActivityLiveRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

  private readonly mouseMoveHandler = (event: MouseEvent) => this.onMouseMove(event);
  private readonly mouseUpHandler = () => this.ngZone.run(() => this.onMouseUp());
  private readonly keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.fullscreenWidgetId) {
      this.toggleFullscreen(this.fullscreenWidgetId);
    }
  };

  @ViewChildren(MapStageComponent) private mapStageComponents!: QueryList<MapStageComponent>;
  @ViewChild(SpkTicketActivityWidgetComponent) private ticketActivityWidget?: SpkTicketActivityWidgetComponent;

  private userSubscription?: Subscription;
  private themeSubscription?: Subscription;
  private projectActivitiesSubscriptions = new Subscription();
  ticketActivityViewModel: SpkTicketActivityWidgetViewModel = {
    scopeLabel: 'Current selection',
    projectLabel: '',
    totalTickets: '0',
    spanDays: '0',
    activeDays: '0',
    averagePerDay: '0.0',
    peakDayLabel: '-',
    peakDayCount: '0',
    firstTicketLabel: '-',
    lastTicketLabel: '-',
    rangeLabel: 'No created ticket dates',
  };

  constructor(
    private authService: AuthService,
    private dashboardProjectsService: DashboardProjectsService,
    private clientService: ClientService,
    @Inject(ClientDashboardService) private clientDashboardService: ClientDashboardService,
    private toastService: ToastService,
    private fleetMapApiService: FleetMapApiService,
    private appStateService: AppStateService,
    private projectActivitiesDataService: ProjectActivitiesDataService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private dashboardStateService: DashboardStateService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.bindProjectActivitiesWidgetState();

    try {
      this.applyTicketActivityPreset('90d', false);
      this.syncDashboardTheme();
      const cached = this.dashboardStateService.snapshot;
      const currentRole = this.computeRole(this.authService.userRole);
      if (cached && cached.role === currentRole) {
        this.restoreFromSnapshot(cached);
      } else {
        this.dashboardStateService.snapshot = null;
        this.applyRole(this.authService.userRole);
        const qp = this.route.snapshot.queryParams;
        if (qp['projectId']) this.selectedProject = qp['projectId'];
        if (qp['vehicleId']) this.selectedVehicle = qp['vehicleId'];
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
      // Skip full re-init if role hasn't changed
      if (this.isRoleMatch(user?.role ?? null)) {
        this.cdr.markForCheck();
        return;
      }
      // Role changed — invalidate cache and re-initialize
      this.dataInitialized = false;
      this.dashboardStateService.snapshot = null;
      try {
        this.applyRole(user?.role ?? null);
      } catch (err) {
        this.toastService.show('Client dashboard role error: ' + (typeof err === 'object' && err && 'message' in err ? (err as any).message : String(err)), { classname: 'bg-danger text-light', autohide: true });
      }
    });
    this.themeSubscription = this.appStateService.state$.subscribe((state) => {
      this.syncDashboardTheme(state?.theme);
    });
    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('mousemove', this.mouseMoveHandler);
      document.addEventListener('mouseup', this.mouseUpHandler);
    });
    document.addEventListener('keydown', this.keydownHandler);

    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
  }

  ngOnDestroy(): void {
    this.clearTicketActivityLiveRefreshTimeout();
    this.saveLayoutToStorage();
    // Persist dashboard state for next in-app navigation (cleared on browser refresh)
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
      } satisfies DashboardSnapshot;
    }
    this.userSubscription?.unsubscribe();
    this.themeSubscription?.unsubscribe();
    this.projectActivitiesSubscriptions.unsubscribe();
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    document.removeEventListener('mouseup', this.mouseUpHandler);
    document.removeEventListener('keydown', this.keydownHandler);
    document.body.classList.remove('is-resizing');
    document.body.style.cursor = '';
    document.body.style.overflow = 'auto';
    this.resizeSession = null;
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
    this.selectedVehicle = 'all';
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

  onProjectChange(projectId: string): void {
    this.selectedProject = projectId;
    this.selectedVehicle = 'all';
    this.resetProjectTimelinePagination();
    this.updateDashboardMapView();
    this.refreshVehiclesByMakeModelChart();
    this.refreshVehiclesByPropulsionTypesChart();
    this.loadVehicles(projectId);
    if (!this.isAdminRole) {
      this.fetchAllClientVehiclesAndTickets();
      this.refreshClientView();
    }
    // refresh vehicle station tracking when project changes
    this.refreshVehicleStationTrackingWidget();
    this.refreshProjectTimelineWidget();
  }

  onAdminClientChange(clientId: string): void {
    if (!this.isAdminRole) return;

    this.selectedClient = clientId;
    this.selectedProject = 'all';
    this.selectedVehicle = 'all';
    this.resetProjectTimelinePagination();
    this.totalVehiclesCount = null;
    this.projects = [{ id: 'all', name: 'All Projects' }];
    this.vehicles = [{ id: 'all', name: 'All Vehicles' }];

    this.updateDashboardMapView();
    this.loadProjects();
  }

  onVehicleChange(vehicleId: string): void {
    this.selectedVehicle = vehicleId;
    this.resetProjectTimelinePagination();
    if (this.isAdminRole) {
      this.setAdminStatCards();
      return;
    }

    if (!this.isAdminRole) {
      this.fetchAllClientVehiclesAndTickets();
      this.refreshClientView();
    }
    this.refreshVehicleStationTrackingWidget();
    this.refreshProjectTimelineWidget();
  }

  applyTicketActivityDateFilter(): void {
    this.ticketActivityCustomRangeOpen = true;
    this.ticketActivityRangePreset = 'custom';
    this.clearTicketActivityLiveRefreshTimeout();
    if (!this.hasValidTicketActivityDateRange()) {
      return;
    }
    this.refreshTicketCreationActivityWidget(false);
  }

  clearTicketActivityDateFilter(): void {
    this.ticketActivityCustomRangeOpen = false;
    this.applyTicketActivityPreset('90d');
  }

  toggleTicketActivityCustomRange(): void {
    this.ticketActivityCustomRangeOpen = !this.ticketActivityCustomRangeOpen;
  }

  toggleTicketActivityDownloadMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.ticketActivityDownloadMenuOpen = !this.ticketActivityDownloadMenuOpen;
  }

  downloadTicketActivityPNG(): void {
    const widget = this.ticketActivityWidget;
    if (!widget) {
      console.warn('[TCA] Ticket activity widget not found');
      return;
    }
    widget.exportChartPng().then((result) => {
      if (!result?.imgURI) {
        console.warn('[TCA] PNG export returned no data');
        return;
      }
      const a = document.createElement('a');
      a.href = result.imgURI;
      a.download = 'ticket-creation-activity.png';
      a.click();
    }).catch((err) => {
      console.error('[TCA] PNG export failed', err);
    });
  }

  downloadTicketActivityCSV(): void {
    const activity = this.lastTicketActivityResult;
    const vm = this.ticketActivityViewModel;
    const granularity = this.ticketActivityGranularity;
    const points = activity ? bucketTicketCreationActivityPoints(activity.points, granularity) : [];
    const rows: string[][] = [
      ['# Ticket Creation Activity Summary'],
      ['Scope', vm.scopeLabel],
      ['Project', vm.projectLabel || 'All Projects'],
      ['Range', vm.rangeLabel],
      ['Total Tickets', vm.totalTickets],
      ['Span Days', vm.spanDays],
      ['Active Days', vm.activeDays],
      ['Average / Day', vm.averagePerDay],
      ['Peak Day Date', vm.peakDayLabel],
      ['Peak Day Count', vm.peakDayCount],
      ['First Ticket', vm.firstTicketLabel],
      ['Last Ticket', vm.lastTicketLabel],
      [],
      [`# Timeline (${granularity} granularity)`],
      ['Date', 'Tickets Created'],
      ...points.map((p) => [p.date, String(p.count)]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ticket-creation-activity.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async downloadTicketActivityExcel(): Promise<void> {
    const activity = this.lastTicketActivityResult;
    const vm = this.ticketActivityViewModel;
    const granularity = this.ticketActivityGranularity;
    const points = activity ? bucketTicketCreationActivityPoints(activity.points, granularity) : [];
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BusPulse';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 24 },
      { header: 'Value', key: 'value', width: 32 },
    ];
    summarySheet.addRows([
      { metric: 'Scope', value: vm.scopeLabel },
      { metric: 'Project', value: vm.projectLabel || 'All Projects' },
      { metric: 'Range', value: vm.rangeLabel },
      { metric: 'Total Tickets', value: vm.totalTickets },
      { metric: 'Span Days', value: vm.spanDays },
      { metric: 'Active Days', value: vm.activeDays },
      { metric: 'Average / Day', value: vm.averagePerDay },
      { metric: 'Peak Day Date', value: vm.peakDayLabel },
      { metric: 'Peak Day Count', value: vm.peakDayCount },
      { metric: 'First Ticket', value: vm.firstTicketLabel },
      { metric: 'Last Ticket', value: vm.lastTicketLabel },
    ]);
    summarySheet.getRow(1).font = { bold: true };

    const timelineSheet = workbook.addWorksheet(`Timeline (${granularity})`);
    timelineSheet.columns = [
      { header: 'Date', key: 'date', width: 16 },
      { header: 'Tickets Created', key: 'count', width: 18 },
    ];
    timelineSheet.addRows(points.map((p) => ({ date: p.date, count: p.count })));
    timelineSheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ticket-creation-activity.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  onTicketActivityDateChange(): void {
    this.ticketActivityCustomRangeOpen = true;
    this.ticketActivityRangePreset = 'custom';
    this.scheduleTicketActivityLiveRefresh();
  }

  applyTicketActivityPreset(preset: TicketActivityRangePreset, refresh = true): void {
    this.clearTicketActivityLiveRefreshTimeout();
    this.ticketActivityRangePreset = preset;
    this.ticketActivityCustomRangeOpen = preset === 'custom';

    if (preset === 'all') {
      this.ticketActivityStartDate = '';
      this.ticketActivityEndDate = '';
    } else if (preset !== 'custom') {
      const today = new Date();
      const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
      const days = preset === '30d'
        ? 30
        : preset === '180d'
          ? 180
          : preset === '365d'
            ? 365
            : 90;
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - (days - 1));
      this.ticketActivityStartDate = start.toISOString().slice(0, 10);
      this.ticketActivityEndDate = end.toISOString().slice(0, 10);
    }

    if (refresh) {
      this.refreshTicketCreationActivityWidget(false);
    }
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
    this.updateDashboardMapView();
  }

  toggleDashboardMapManufacturer(manufacturerId: string): void {
    const normalizedId = String(manufacturerId ?? '').trim();
    if (!normalizedId) {
      return;
    }

    this.dashboardMapSelectedManufacturerIds = this.dashboardMapSelectedManufacturerIds.includes(normalizedId)
      ? this.dashboardMapSelectedManufacturerIds.filter((id) => id !== normalizedId)
      : [...this.dashboardMapSelectedManufacturerIds, normalizedId];

    this.updateDashboardMapView();
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
    // After CDK drop animation completes, force chart components to re-read container dimensions
    setTimeout(() => {
      this.widgets.forEach(w => { if (w.chartOptions) w.chartOptions = { ...w.chartOptions }; });
      this.cdr.markForCheck();
    }, 320);
  }

  isWidgetVisible(widget: DashboardWidget): boolean {
    // Admins always see all widgets
    if (this.isAdminRole) return true;

    // Hide fleet map and recent activities widgets for non-admin users (added PR 309)
    if (widget.id === 'widget-map' || widget.id === 'widget-14') return false;

    // If both filters are set to 'all', hide the Vehicle Station Tracking widget (widget-15)
    if (this.selectedProject === 'all' && this.selectedVehicle === 'all' && widget.id === 'widget-15') {
      return false;
    }

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
  }

  toggleFullscreen(widgetId: string): void {
    const nextFullscreenId = getNextFullscreenWidgetId(this.fullscreenWidgetId, widgetId);

    this.fullscreenWidgetId = nextFullscreenId;
    document.body.style.overflow = this.fullscreenWidgetId ? 'hidden' : 'auto';
  }

  get fullscreenWidget(): DashboardWidget | undefined {
    if (!this.fullscreenWidgetId) return undefined;
    return this.widgets.find((widget) => widget.id === this.fullscreenWidgetId);
  }

  onProjectActivitiesPageChange(delta: number): void {
    const nextPage = this.projectActivitiesCurrentPage + delta;
    const totalPages = this.projectActivitiesPageSize > 0
      ? Math.ceil(this.projectActivitiesTotalCount / this.projectActivitiesPageSize)
      : 0;

    if (nextPage < 0 || nextPage >= totalPages) {
      return;
    }

    this.projectActivitiesCurrentPage = nextPage;
    this.refreshProjectActivitiesWidget();
  }

  private computeRole(roleValue: string | null): DashboardRole {
    const normalized = String(roleValue ?? '').trim().toLowerCase();
    return normalized === 'admin' || normalized === 'superadmin' ? 'admin' : 'client';
  }

  private isRoleMatch(roleValue: string | null): boolean {
    return this.computeRole(roleValue) === this.role;
  }

  private restoreFromSnapshot(snapshot: DashboardSnapshot): void {
    this.role = snapshot.role;
    this.widgets = snapshot.widgets.map(w => ({ ...w }));
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
    this.title = this.isAdminRole ? 'BusPulse Fleet Dashboard' : 'BusPulse Client Dashboard';
    this.dashboardMapLoading = false;
    this.updateDashboardMapView();
    this.refreshProjectActivitiesWidget(true);
    this.dataInitialized = true;
    this.cdr.markForCheck();
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
    if (!this.isAdminRole) {
      this.fetchAllClientVehiclesAndTickets();
    }

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
    this.resetProjectTimelinePagination();

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
          : [{ id: 'all', name: 'All Projects' }];

        const hasSelectedProject = this.projects.some((project) => project.id === this.selectedProject);
        if (!hasSelectedProject) {
          this.selectedProject = 'all';
        }

        this.updateProjectStatusChart(this.projects);
        this.updateProjectScopedComparisonWidgets();
        this.refreshVehiclesByMakeModelChart();
        this.refreshVehiclesByPropulsionTypesChart();

        this.updateDashboardMapView();
        this.loadVehicles(this.selectedProject);
        if (!this.isAdminRole) {
          this.refreshClientView();
        }
        this.refreshProjectTimelineWidget();
      },
      error: (err) => {
        if (requestVersion !== this.projectsRequestVersion) return;
        this.projects = [{ id: 'all', name: 'All Projects' }];
        this.selectedProject = 'all';
        this.selectedVehicle = 'all';
        this.updateProjectStatusChart(this.projects);
        this.updateProjectScopedComparisonWidgets();
        this.refreshVehiclesByMakeModelChart();
        this.refreshVehiclesByPropulsionTypesChart();
        this.updateDashboardMapView();
        this.loadVehicles(this.selectedProject);
        if (!this.isAdminRole) {
          this.refreshClientView();
        }
        this.toastService.show('Failed to load projects: ' + (err?.message || 'Unknown error'), { classname: 'bg-danger text-light', autohide: true });
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
          options: (authoritative?.options && authoritative.options.length)
            ? authoritative.options
            : scoped.options,
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

        this.refreshTicketCreationActivityWidget();

        if (this.isAdminRole) {
          this.setAdminStatCards();
        } else {
          this.fetchAllClientVehiclesAndTickets();
          this.refreshClientView();
        }

        this.refreshProjectActivitiesWidget(true);
      },
      error: (err) => {
        if (requestVersion !== this.vehiclesRequestVersion) return;
        this.vehicles = [{ id: 'all', name: 'All Vehicles' }];
        this.selectedVehicle = 'all';
        this.totalVehiclesCount = null;
        this.refreshTicketCreationActivityWidget();
        this.refreshProjectActivitiesWidget(true);
        this.toastService.show('Failed to load vehicles: ' + (err?.message || 'Unknown error'), { classname: 'bg-danger text-light', autohide: true });
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
      },
      error: (err) => {
        this.clients = [{ id: 'all', name: 'All Clients' }];
        this.selectedClient = 'all';
        this.updateDashboardMapView();
        this.toastService.show('Failed to load clients: ' + (err?.message || 'Unknown error'), { classname: 'bg-danger text-light', autohide: true });
      },
    });
  }

  private loadDashboardMapData(): void {
    this.dashboardMapLoading = true;
    this.dashboardMapError = '';
    this.updateDashboardMapWidgetState();

    forkJoin({
      projects: this.fleetMapApiService.fetchProjects(),
      clients: this.fleetMapApiService.fetchClients(),
      manufacturers: this.fleetMapApiService.fetchManufacturers(),
      locations: this.fleetMapApiService.fetchLocations(),
    }).subscribe({
      next: ({ projects, clients, manufacturers, locations }) => {
        this.allMapProjects = projects;
        this.allMapClients = clients;
        this.allMapManufacturers = manufacturers;
        this.allMapLocations = locations;
        this.dashboardMapDataLoaded = true;
        this.dashboardMapLoading = false;
        this.updateDashboardMapView();
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
      },
    });
  }

  private updateDashboardMapView(): void {
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
    const nextIsDark = resolvedTheme === 'dark' || html.classList.contains('dark');
    const didThemeChange = this.dashboardMapIsDark !== nextIsDark;

    this.dashboardMapIsDark = nextIsDark;

    if (didThemeChange) {
      this.rebuildTicketActivityChartForTheme();
    }
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
      },
      error: () => {
        this.clientProfile = fallbackProfile;
        this.customerLogoName = '';
      },
    });
  }

  getEffectiveClientId(): number | undefined {
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
    this.updateProjectStatusChart(this.projects);
    // Always fetch tickets dashboard and update admin stats from API result
    this.dashboardProjectsService.getTicketsDashboard({
      projectId: this.selectedProject !== 'all' ? this.selectedProject : undefined,
      vehicleId: this.selectedVehicle !== 'all' ? this.selectedVehicle : undefined,
      clientId: this.getEffectiveClientId(),
      includeClosed: this.includeClosedProjects,
    }).subscribe({
      next: (res) => {
        // Reuse repeatedTickets and safetyCriticalTickets from API result
        const statsSource = {
          ...busPulseData.dashboardStats,
          repeatedDefects: res?.repeatedTickets ?? busPulseData.dashboardStats.repeatedDefects,
          criticalDefects: res?.safetyCriticalTickets ?? busPulseData.dashboardStats.criticalDefects,
        };
        this.statCards = buildAdminStatCards(statsSource, totalProjects, this.totalVehiclesCount);
        this.updateTicketsByStatusWidgetFromApi(res);
      },
      error: () => {
        this.statCards = buildAdminStatCards(busPulseData.dashboardStats, totalProjects, this.totalVehiclesCount);
        this.updateTicketsByStatusWidgetFromApi([]);
      },
    });
  }

  private refreshClientView(): void {
    this.currentProjectStats = resolveClientProjectStats(
      projectStats,
      this.selectedProject,
      this.selectedVehicle,
    ) ?? this.currentProjectStats;

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

      if (this.selectedVehicle === 'all') {
        this.dashboardProjectsService.getTicketsDashboard({ projectId: projectIdParam }).subscribe({
          next: (res) => {
            const result: any = res ?? {};
            const candidates = [result.totalTickets, result.total, result.count, result.totalItems, result.totalRecords];
            let total = Number(this.currentProjectStats.totalTickets ?? 0);
            for (const c of candidates) {
              const n = Number(c);
              if (Number.isFinite(n) && n >= 0) {
                total = n;
                break;
              }
            }

            this.currentProjectStats = {
              ...this.currentProjectStats,
              totalTickets: total,
            };

            this.statCards = buildClientStatCards(
              this.currentProjectStats,
              this.showFilters,
              this.selectedProject,
            );
            // Update Tickets by Status widget from API response when available
            this.updateTicketsByStatusWidgetFromApi(result);
          },
          error: () => {
            // Show canonical zeros on API error
            this.updateTicketsByStatusWidgetFromApi([]);
          },
        });
      } else {
        const vehicleIdParam = this.selectedVehicle;
        this.dashboardProjectsService.getTicketsDashboard({ projectId: projectIdParam, vehicleId: vehicleIdParam }).subscribe({
          next: (res) => {
            const result: any = res ?? {};
            const candidates = [result.totalTickets, result.total, result.count, result.totalItems, result.totalRecords];
            let total = Number(this.currentProjectStats.totalTickets ?? 0);
            for (const c of candidates) {
              const n = Number(c);
              if (Number.isFinite(n) && n >= 0) {
                total = n;
                break;
              }
            }

            this.currentProjectStats = {
              ...this.currentProjectStats,
              totalTickets: total,
            };

            this.statCards = buildClientStatCards(
              this.currentProjectStats,
              this.showFilters,
              this.selectedProject,
            );
            // Update Tickets by Status widget from API response when available
            this.updateTicketsByStatusWidgetFromApi(result);
          },
          error: () => {
            // Show canonical zeros on API error
            this.updateTicketsByStatusWidgetFromApi([]);
          },
        });
      }
    }
    // If a specific vehicle is selected, request the tickets dashboard for that vehicle
    // and update the Total Tickets card with the API result (if present).
    if (!this.isAdminRole && this.selectedProject !== 'all' && this.selectedVehicle !== 'all') {
      const projectIdParam = this.selectedProject;
      const vehicleIdParam = this.selectedVehicle;

      this.dashboardProjectsService.getTicketsDashboard({ projectId: projectIdParam, vehicleId: vehicleIdParam }).subscribe({
        next: (result) => {
          const res: any = result ?? {};
          const candidates = [res.totalTickets, res.total, res.count, res.totalItems, res.totalRecords];

          let total = 0;
          for (const c of candidates) {
            const n = Number(c);
            if (Number.isFinite(n) && n >= 0) {
              total = n;
              break;
            }
          }

          this.currentProjectStats = {
            ...this.currentProjectStats,
            totalTickets: total,
          };

          this.statCards = buildClientStatCards(
            this.currentProjectStats,
            this.showFilters,
            this.selectedProject,
          );
          // Update Tickets by Status widget from API response when available
          this.updateTicketsByStatusWidgetFromApi(res);
        },
        error: () => {
          // Show canonical zeros on API error
          this.updateTicketsByStatusWidgetFromApi([]);
        },
      });
    }
    // If All Projects is selected, either fetch vehicle-scoped totals (option A)
    // or aggregate per-project totals when no vehicle is selected.
    if (!this.isAdminRole && this.selectedProject === 'all') {
      if (this.selectedVehicle && this.selectedVehicle !== 'all') {
        // Option A: single call by vehicleId across all projects
        this.dashboardProjectsService.getTicketsDashboard({ vehicleId: this.selectedVehicle }).subscribe({
          next: (res) => {
            const r: any = res ?? {};
            const candidates = [r.totalTickets, r.total, r.count, r.totalItems, r.totalRecords];
            let total = Number(this.currentProjectStats.totalTickets ?? 0);
            for (const c of candidates) {
              const n = Number(c);
              if (Number.isFinite(n) && n >= 0) {
                total = n;
                break;
              }
            }

            this.currentProjectStats = {
              ...this.currentProjectStats,
              totalTickets: total,
            };

            this.statCards = buildClientStatCards(
              this.currentProjectStats,
              this.showFilters,
              this.selectedProject,
            );
            // Update Tickets by Status widget from API response when available
            this.updateTicketsByStatusWidgetFromApi(r);
          },
          error: () => {
            // Show canonical zeros on API error and keep stat cards
            this.updateTicketsByStatusWidgetFromApi([]);
            this.statCards = buildClientStatCards(
              this.currentProjectStats,
              this.showFilters,
              this.selectedProject,
            );
          },
        });
      } else {
        // Use one aggregated request for client scope to avoid spawning
        // one network call per project (can freeze/crash on large fleets).
        this.dashboardProjectsService.getTicketsDashboard().subscribe({
          next: (res) => {
            const r: any = res ?? {};
            const candidates = [r.totalTickets, r.total, r.count, r.totalItems, r.totalRecords];
            let total = Number(this.currentProjectStats.totalTickets ?? 0);
            for (const c of candidates) {
              const n = Number(c);
              if (Number.isFinite(n) && n >= 0) {
                total = n;
                break;
              }
            }

            this.currentProjectStats = {
              ...this.currentProjectStats,
              totalTickets: total,
            };

            this.statCards = buildClientStatCards(
              this.currentProjectStats,
              this.showFilters,
              this.selectedProject,
            );
            this.updateTicketsByStatusWidgetFromApi(r);
          },
          error: () => {
            this.updateTicketsByStatusWidgetFromApi([]);
            this.statCards = buildClientStatCards(
              this.currentProjectStats,
              this.showFilters,
              this.selectedProject,
            );
          },
        });
      }
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
    this.updateProjectStatusWidget(this.projectStatusChartOptions);

    this.loadLayoutFromStorage();
  }

  private bindProjectActivitiesWidgetState(): void {
    this.projectActivitiesSubscriptions.unsubscribe();
    this.projectActivitiesSubscriptions = new Subscription();

    this.projectActivitiesSubscriptions.add(
      this.projectActivitiesDataService.rows$.subscribe((rows) => {
        this.projectActivitiesRows = rows;
        this.cdr.markForCheck();
      }),
    );

    this.projectActivitiesSubscriptions.add(
      this.projectActivitiesDataService.totalCount$.subscribe((totalCount) => {
        this.projectActivitiesTotalCount = totalCount;
        this.cdr.markForCheck();
      }),
    );

    this.projectActivitiesSubscriptions.add(
      this.projectActivitiesDataService.loading$.subscribe((loading) => {
        this.projectActivitiesLoading = loading;
        this.cdr.markForCheck();
      }),
    );
  }

  private refreshProjectActivitiesWidget(resetPage = false): void {
    const widgetId = 'widget-project-activities';
    const widget = this.widgets.find((item) => item.id === widgetId);
    if (!widget || !this.isWidgetVisible(widget)) {
      return;
    }

    if (resetPage) {
      this.projectActivitiesCurrentPage = 0;
    }

    const projectScope = this.resolveProjectActivitiesProjectScope();
    const selectedVehicleId = String(this.selectedVehicle ?? '').trim();
    const vehicleId = selectedVehicleId && selectedVehicleId.toLowerCase() !== 'all' && projectScope.projectId
      ? selectedVehicleId
      : undefined;

    this.widgets = this.widgets.map((item) => (
      item.id === widgetId
        ? {
            ...item,
            subtitle: this.buildProjectActivitiesSubtitle(projectScope.projectName, !!vehicleId),
            loading: false,
          }
        : item
    ));

    this.projectActivitiesDataService.loadPage({
      page: this.projectActivitiesCurrentPage,
      pageSize: this.projectActivitiesPageSize,
      clientId: this.getEffectiveClientId(),
      includeClosed: this.includeClosedProjects,
      projectId: projectScope.projectId,
      projectName: projectScope.projectName,
      projectTypeId: projectScope.projectTypeId,
      vehicleId,
    });
  }

  private resolveProjectActivitiesProjectScope(): {
    projectId?: string;
    projectName?: string;
    projectTypeId?: number;
  } {
    const explicitProjectId = String(this.selectedProject ?? '').trim();
    if (explicitProjectId && explicitProjectId.toLowerCase() !== 'all') {
      const explicitProject = this.projects.find((project) => project.id === explicitProjectId);
      return {
        projectId: explicitProjectId,
        projectName: explicitProject?.name,
        projectTypeId: explicitProject?.projectTypeId,
      };
    }

    if (!this.isAdminRole && String(this.selectedVehicle ?? '').trim().toLowerCase() !== 'all') {
      const inferredProjectId = String(this.currentProjectStats?.projectId ?? '').trim();
      if (inferredProjectId) {
        const inferredProject = this.projects.find((project) => project.id === inferredProjectId);
        return {
          projectId: inferredProjectId,
          projectName: inferredProject?.name ?? this.currentProjectStats?.projectName,
          projectTypeId: inferredProject?.projectTypeId,
        };
      }
    }

    return {};
  }

  private buildProjectActivitiesSubtitle(projectName?: string, vehicleScoped = false): string {
    if (projectName && vehicleScoped) {
      return `Ticket volume, staffing, and sync status for ${projectName} and the selected vehicle`;
    }

    if (projectName) {
      return `Ticket volume, staffing, and sync status for ${projectName}`;
    }

    return 'Live ticket volume, staffing, and sync status by project';
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

    const projectNames = this.projects
      .filter((project) => String(project.id ?? '').toLowerCase() !== 'all')
      .map((project) => String(project.name ?? '').trim())
      .filter((name) => !!name);

    if (!projectNames.length) {
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
    const widget12ProjectNames = projectNames.slice(0, 12);
    const widget15VehicleNames = (Array.isArray(this.vehicles) && this.vehicles.filter(v => String(v?.id ?? '').toLowerCase() !== 'all').map((v: any) => String(v.name ?? v.id)).slice(0, 10)) || projectNames.slice(0, 10);

    const templateWidget11 = busPulseData.projectsByStationHeatmap as any;
    const templateHeatmapSeries = Array.isArray(templateWidget11?.series) ? templateWidget11.series : [];
    const widget11Options = {
      ...templateWidget11,
      series: widget10ProjectNames.map((projectName, index) => ({
        ...(templateHeatmapSeries[index % Math.max(templateHeatmapSeries.length, 1)] ?? {}),
        name: projectName,
      })),
    };

    const templateWidget12 = busPulseData.stationTimeComparisonChart as any;
    const widget12Options = {
      ...templateWidget12,
      yaxis: {
        ...(templateWidget12?.yaxis ?? {}),
        categories: widget12ProjectNames,
      },
      series: Array.isArray(templateWidget12?.series)
        ? templateWidget12.series.map((seriesItem: any) => ({
            ...seriesItem,
            data: fitSeriesData(seriesItem?.data, widget12ProjectNames.length),
          }))
        : [],
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
      if (widget.id === 'widget-11') return { ...widget, chartOptions: widget11Options, loading: false };
      if (widget.id === 'widget-12') return { ...widget, chartOptions: widget12Options, loading: false };
      if (widget.id === 'widget-15') return { ...widget, chartOptions: widget15Options, loading: false };
      return widget;
    });
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
      },
      error: () => {
        if (requestVersion !== currentRequestVersion()) {
          return;
        }

        this.updateVehicleDistributionWidget(widgetId, buildChartOptions([]));
      },
    });
  }

  private refreshVehicleStationTrackingWidget(): void {
    const requestVersion = ++this.vehicleStationRequestVersion;

    const projectIdParam = this.selectedProject !== 'all' ? this.selectedProject : undefined;
    const vehicleIdParam = this.selectedVehicle !== 'all' ? this.selectedVehicle : undefined;

    // set loading flag for widget-15
    this.widgets = this.widgets.map((w) => (w.id === 'widget-15' ? { ...w, loading: true } : w));

    // Fetch a lighter page to keep widget responsive on large fleets.
    const stationTrackerPageSize = vehicleIdParam ? 500 : 350;
    this.dashboardProjectsService.getStationTrackers({
      projectId: projectIdParam,
      vehicleId: vehicleIdParam,
      pageSize: stationTrackerPageSize,
    }).subscribe({
      next: (items) => {
        if (requestVersion !== this.vehicleStationRequestVersion) return;

        // group by vehicleId
        const grouped = new Map<string, any[]>();
        for (const it of Array.isArray(items) ? items : []) {
          const vid = String(it?.vehicleId ?? it?.vehicleID ?? it?.vehicle_id ?? 'unknown');
          if (!grouped.has(vid)) grouped.set(vid, []);
          grouped.get(vid)!.push(it);
        }

        const palette = ['#1b5e20', '#2e7d32', '#388e3c', '#4caf50', '#66bb6a', '#81c784', '#50c878', '#83bc96'];
        const seriesData: any[] = [];
        let colorIndex = 0;

        // Determine the authoritative list of vehicles to display on the Y axis.
        // Prefer the currently-loaded vehicle options when project-scoped; fall
        // back to allClientVehicles or the IDs returned by the tracker API.
        let vehicleIdsToShow: string[] = [];

        if (vehicleIdParam) {
          vehicleIdsToShow = [String(vehicleIdParam)];
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

        // Prepare left-column labels (exposed to template) based on ordered ids
        const vehicleLabels = vehicleIdsToShow.map((vid) => {
          const opt = (this.vehicles || []).find((v: any) => String(v.id) === String(vid)) || (this.allClientVehicles || []).find((v: any) => String(v.id) === String(vid));
          return opt ? String(opt.name ?? opt.id) : `Vehicle ${vid}`;
        });
        this.vehicleStationLabels = vehicleLabels;

        for (const vid of vehicleIdsToShow) {
          const records = grouped.get(vid) ?? [];

          const vehicleOption = (this.vehicles || []).find((v: any) => String(v.id) === String(vid)) || (this.allClientVehicles || []).find((v: any) => String(v.id) === String(vid));
          const vehicleLabel = vehicleOption ? String(vehicleOption.name ?? vehicleOption.id) : `Vehicle ${vid}`;

          if (!records.length) {
            // Add a tiny transparent placeholder so the vehicle appears on the Y axis
            const now = Date.now();
            seriesData.push({ x: vehicleLabel, y: [now, now + 1], fillColor: 'rgba(0,0,0,0)', meta: { stationId: null, stationNumber: '', stationName: '', raw: null, label: '' } });
            continue;
          }

          for (const rec of records) {
            const startDateIso = rec?.startDate ?? rec?.dateStarted ?? null;
            const endDateIso = rec?.endDate ?? rec?.dateEnded ?? null;
            const startMs = startDateIso ? new Date(startDateIso).getTime() : Date.now();
            const endMs = endDateIso ? new Date(endDateIso).getTime() : (startMs + 60 * 60 * 1000);
            const stationId = rec?.stationId ?? rec?.stationID ?? rec?.station_id ?? null;
            const stationNumber = String(rec?.stationNumber ?? rec?.stationNo ?? '').trim();
            const stationName = String(rec?.stationName ?? '').trim();
            const label = stationNumber || stationName || (stationId ? `Station ${stationId}` : String(rec?.description ?? ''));
            const color = palette[(colorIndex++) % palette.length];
            seriesData.push({ x: vehicleLabel, y: [startMs, endMs], fillColor: color, meta: { stationId, stationNumber, stationName, raw: rec, label, startDate: startDateIso, endDate: endDateIso } });
          }
        }

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

        const axisTitleColor = (((template && template.yaxis && template.yaxis.title && template.yaxis.title.style && template.yaxis.title.style.color) !== undefined)
          ? template.yaxis.title.style.color
          : '#1b5e20');

        const chartOptions = {
          ...(template || {}),
          chart: {
            ...((template && template.chart) || {}),
            height: calculatedHeight,
            width: calculatedWidth,
            zoom: {
              ...(((template && template.chart && template.chart.zoom) || {})),
              enabled: false,
            },
            toolbar: {
              ...(((template && template.chart && template.chart.toolbar) || {})),
              show: false,
            },
          },
          // Align bars and y-axis labels: increase bar height slightly and
          // nudge y-axis label vertical offset so labels and range bars center
          // on the same row. We merge with any template.plotOptions.
          plotOptions: {
            ...((template && template.plotOptions) || {}),
            bar: {
              ...(((template && template.plotOptions && template.plotOptions.bar) || {})),
              // restore template bar height for consistent alignment
              barHeight: ((template && template.plotOptions && template.plotOptions.bar && template.plotOptions.bar.barHeight) !== undefined)
                ? template.plotOptions.bar.barHeight
                : '60%',
              // maintain grouping behavior from template if present
              rangeBarGroupRows: ((template && template.plotOptions && template.plotOptions.bar && template.plotOptions.bar.rangeBarGroupRows) !== undefined)
                ? template.plotOptions.bar.rangeBarGroupRows
                : false,
            },
          },
          xaxis: {
            ...((template && template.xaxis) || {}),
            type: 'datetime',
            tickAmount: 6,
            // Add an explicit x-axis title for the timeline (Date)
            // Use template xaxis title when present, otherwise default to
            // 'Date' and match the y-axis title color when available.
            title: ((template && template.xaxis && template.xaxis.title) !== undefined)
              ? template.xaxis.title
              : {
                text: 'Date',
                style: {
                  fontSize: '13px',
                  fontFamily: 'Poppins, sans-serif',
                  color: axisTitleColor,
                },
              },
            labels: {
              ...(((template && template.xaxis && template.xaxis.labels) || {})),
              rotate: -30,
              hideOverlappingLabels: true,
              style: {
                ...(((template && template.xaxis && template.xaxis.labels && template.xaxis.labels.style) || {})),
                fontSize: '11px',
              },
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
            ...((template && template.yaxis) || {}),
            // Ensure y-axis title uses the same explicit color as the x-axis
            title: {
              ...(((template && template.yaxis && template.yaxis.title) || {})),
              style: {
                ...(((template && template.yaxis && template.yaxis.title && template.yaxis.title.style) || {})),
                color: axisTitleColor,
              },
            },
            labels: {
              ...(((template && template.yaxis && template.yaxis.labels) || {})),
              // Respect template offset when present; otherwise no manual nudge
              offsetY: ((template && template.yaxis && template.yaxis.labels && template.yaxis.labels.offsetY) !== undefined)
                ? template.yaxis.labels.offsetY
                : 0,
              style: {
                ...(((template && template.yaxis && template.yaxis.labels && template.yaxis.labels.style) || {})),
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
              const stationValue = stationName || stationNumber || String(meta?.label ?? 'Station').trim();
              const stationLine = stationValue ? `<div><strong>Station Name:</strong> ${stationValue}</div>` : '';
              const stationNumberLine = stationNumber ? `<div><strong>Station Number:</strong> ${stationNumber}</div>` : '';

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
                  startLine +
                  endLine +
                  `</div>`;
            },
          },
          series: [{ ...(template?.series?.[0] ?? {}), data: seriesData }],
        };

        // small helpers to sync label/scroll interactions exist in template
        // attach calculated sizes for the host element to consume
        (chartOptions as any).__calculatedHostHeight = calculatedHeight;
        (chartOptions as any).__calculatedHostWidth = calculatedWidth;

        // Attach the calculated height and width to the chartOptions so callers
        // can read them (used by the template to set the host element size).
        (chartOptions as any).__calculatedHostHeight = calculatedHeight;
        (chartOptions as any).__calculatedHostWidth = calculatedWidth;

        this.widgets = this.widgets.map((w) => (w.id === 'widget-15' ? { ...w, chartOptions, loading: false } : w));
      },
      error: () => {
        if (requestVersion !== this.vehicleStationRequestVersion) return;
        this.widgets = this.widgets.map((w) => (w.id === 'widget-15' ? { ...w, chartOptions: (busPulseData as any).vehicleStationTrackingChart, loading: false } : w));
        try { this.toastService.show('Failed to load Vehicle Station Tracking data', { classname: 'bg-warning text-dark', autohide: true }); } catch { }
      }
    });
  }

  applyProjectTimelineDateFilter(): void {
    this.resetProjectTimelinePagination();
    this.refreshProjectTimelineWidget();
  }

  onProjectTimelinePageSizeChange(pageSize: string | number): void {
    const normalizedPageSize = Math.max(1, Number(pageSize) || 50);
    if (normalizedPageSize === this.projectTimelinePageSize) {
      return;
    }

    this.projectTimelinePageSize = normalizedPageSize;
    this.resetProjectTimelinePagination();
    this.refreshProjectTimelineWidget();
  }

  loadPreviousProjectTimelinePage(): void {
    if (!this.canLoadPreviousProjectTimelinePage) {
      return;
    }

    const targetPage = Math.max(1, this.projectTimelinePageNumber - 1);
    this.refreshProjectTimelineWidget({ pageNumber: targetPage, append: false });
  }

  loadNextProjectTimelinePage(): void {
    if (!this.canLoadNextProjectTimelinePage) {
      return;
    }

    const targetPage = this.projectTimelineRangeEndPage + 1;
    this.refreshProjectTimelineWidget({ pageNumber: targetPage, append: false });
  }

  loadMoreProjectTimeline(): void {
    if (!this.canLoadMoreProjectTimeline) {
      return;
    }

    const targetPage = this.projectTimelineRangeEndPage + 1;
    this.refreshProjectTimelineWidget({ pageNumber: targetPage, append: true });
  }

  get projectTimelineTotalPages(): number {
    if (!this.projectTimelineTotalCount) {
      return 0;
    }

    if (this.projectTimelineLoadedAllRecords) {
      return this.projectTimelineItems.length ? 1 : 0;
    }

    return Math.max(1, Math.ceil(this.projectTimelineTotalCount / this.projectTimelinePageSize));
  }

  get projectTimelineRangeStart(): number {
    if (!this.projectTimelineTotalCount || !this.projectTimelineItems.length) {
      return 0;
    }

    if (this.projectTimelineLoadedAllRecords) {
      return 1;
    }

    return ((this.projectTimelinePageNumber - 1) * this.projectTimelinePageSize) + 1;
  }

  get projectTimelineRangeEnd(): number {
    if (!this.projectTimelineTotalCount || !this.projectTimelineItems.length) {
      return 0;
    }

    return Math.min(this.projectTimelineRangeStart + this.projectTimelineItems.length - 1, this.projectTimelineTotalCount);
  }

  get projectTimelineRangeEndPage(): number {
    if (this.projectTimelineLoadedAllRecords) {
      return this.projectTimelineItems.length ? 1 : 0;
    }

    return this.projectTimelinePageNumber + this.projectTimelineLoadedPageCount - 1;
  }

  get canLoadPreviousProjectTimelinePage(): boolean {
    if (this.projectTimelineLoadedAllRecords) {
      return false;
    }

    return this.projectTimelinePageNumber > 1 && !this.isProjectTimelineLoading;
  }

  get canLoadNextProjectTimelinePage(): boolean {
    if (this.projectTimelineLoadedAllRecords) {
      return false;
    }

    return this.projectTimelineTotalPages > 0 &&
      this.projectTimelineRangeEndPage < this.projectTimelineTotalPages &&
      !this.isProjectTimelineLoading;
  }

  get canLoadMoreProjectTimeline(): boolean {
    if (this.projectTimelineLoadedAllRecords) {
      return false;
    }

    return this.projectTimelineTotalPages > 0 &&
      this.projectTimelineRangeEndPage < this.projectTimelineTotalPages &&
      !this.isProjectTimelineLoading;
  }

  get isProjectTimelineLoading(): boolean {
    return !!this.widgets.find((widget) => widget.id === 'widget-13')?.loading;
  }

  private refreshProjectTimelineWidget(options: { pageNumber?: number; append?: boolean } = {}): void {
    const requestVersion = ++this.projectTimelineRequestVersion;
    const targetPageNumber = Math.max(1, Number(options.pageNumber ?? this.projectTimelinePageNumber) || 1);
    const append = !!options.append;

    const projectIdParam = this.selectedProject !== 'all' ? this.selectedProject : undefined;
    const vehicleIdParam = this.selectedVehicle !== 'all' ? this.selectedVehicle : undefined;
    const startDate = this.projectTimelineStartDate || undefined;
    const endDate = this.projectTimelineEndDate || undefined;

    this.dashboardProjectsService.clearStationTrackersCache();

    this.widgets = this.widgets.map((w) => (
      w.id === 'widget-13'
        ? { ...w, chartOptions: append ? w.chartOptions : this.buildEmptyProjectTimelineChartOptions(), loading: true }
        : w
    ));

    const shouldLoadAllProjectTimelineRecords = !!projectIdParam;
    const request$: Observable<any> = shouldLoadAllProjectTimelineRecords
      ? this.dashboardProjectsService.getAllStationTrackers({
          projectId: projectIdParam,
          vehicleId: vehicleIdParam,
          startDate,
          endDate,
          pageSize: Math.max(this.projectTimelinePageSize, 250),
          refresh: true,
        })
      : this.dashboardProjectsService.getStationTrackersPage({
          projectId: projectIdParam,
          vehicleId: vehicleIdParam,
          startDate,
          endDate,
          pageNumber: targetPageNumber,
          pageSize: this.projectTimelinePageSize,
          refresh: true,
        });

    request$.subscribe({
      next: (result: any) => {
        if (requestVersion !== this.projectTimelineRequestVersion) return;
        const incomingItems = shouldLoadAllProjectTimelineRecords
          ? (Array.isArray(result) ? result : [])
          : (Array.isArray((result as any)?.items) ? (result as any).items : []);
        this.projectTimelineItems = shouldLoadAllProjectTimelineRecords
          ? incomingItems
          : (append ? [...this.projectTimelineItems, ...incomingItems] : incomingItems);
        this.projectTimelineTotalCount = shouldLoadAllProjectTimelineRecords
          ? incomingItems.length
          : Number((result as any)?.totalCount ?? 0);
        this.projectTimelinePageNumber = shouldLoadAllProjectTimelineRecords
          ? 1
          : (append ? this.projectTimelinePageNumber : targetPageNumber);
        this.projectTimelineLoadedPageCount = shouldLoadAllProjectTimelineRecords
          ? (incomingItems.length ? 1 : 0)
          : (append ? Math.max(1, (targetPageNumber - this.projectTimelinePageNumber) + 1) : 1);
        this.projectTimelineLoadedAllRecords = shouldLoadAllProjectTimelineRecords;

        const chartOptions = this.buildProjectTimelineChartOptions(this.projectTimelineItems, projectIdParam);

        this.widgets = this.widgets.map((w) => (w.id === 'widget-13' ? { ...w, chartOptions, loading: false } : w));
      },
      error: () => {
        if (requestVersion !== this.projectTimelineRequestVersion) return;
        this.projectTimelineItems = [];
        this.projectTimelineTotalCount = 0;
        this.projectTimelineLoadedPageCount = 1;
        this.projectTimelineLoadedAllRecords = false;
        this.widgets = this.widgets.map((w) => (w.id === 'widget-13' ? { ...w, chartOptions: (busPulseData as any).projectTimelineChart, loading: false } : w));
        try { this.toastService.show('Failed to load Project Timeline data', { classname: 'bg-warning text-dark', autohide: true }); } catch { }
      },
    });
  }

  private buildEmptyProjectTimelineChartOptions(): any {
    const template = (busPulseData as any).projectTimelineChart ?? {};
    return {
      ...template,
      series: [{ ...(template?.series?.[0] ?? {}), data: [] }],
    };
  }

  private resetProjectTimelinePagination(): void {
    this.projectTimelinePageNumber = 1;
    this.projectTimelineTotalCount = 0;
    this.projectTimelineLoadedPageCount = 1;
    this.projectTimelineLoadedAllRecords = false;
    this.projectTimelineItems = [];
  }

  private buildProjectTimelineChartOptions(items: any[], projectIdParam?: string): any {
    const grouped = new Map<string, any[]>();
    for (const rec of Array.isArray(items) ? items : []) {
      const pid = String(rec?.projectId ?? rec?.projectID ?? rec?.project_id ?? 'unknown');
      if (!grouped.has(pid)) grouped.set(pid, []);
      grouped.get(pid)!.push(rec);
    }

    const palette = ['#1b5e20', '#2e7d32', '#388e3c', '#4caf50', '#66bb6a', '#81c784', '#50c878', '#83bc96'];
    const seriesData: any[] = [];
    let colorIndex = 0;

    let projectIdsToShow: string[] = projectIdParam
      ? [String(projectIdParam)]
      : Array.from(grouped.keys());

    if (!projectIdsToShow.length && Array.isArray(this.projects)) {
      projectIdsToShow = this.projects
        .map((p: any) => String(p?.id ?? ''))
        .filter((id) => id && id.toLowerCase() !== 'all');
    }

    projectIdsToShow = Array.from(new Set(projectIdsToShow));

    for (const pid of projectIdsToShow) {
      const records = grouped.get(pid) ?? [];

      const projectOption = (this.projects || []).find((p: any) => String(p.id) === pid);
      const projectLabel = projectOption
        ? String(projectOption.name ?? projectOption.id)
        : records[0]?.projectName ?? `Project ${pid}`;

      if (!records.length) {
        const now = Date.now();
        seriesData.push({ x: projectLabel, y: [now, now + 1], fillColor: 'rgba(0,0,0,0)', meta: { stationId: null, stationNumber: '', stationName: '', raw: null, label: '' } });
        continue;
      }

      for (const rec of records) {
        const startDateIso = rec?.startDate ?? rec?.dateStarted ?? null;
        const endDateIso = rec?.endDate ?? rec?.dateEnded ?? null;
        const startMs = startDateIso ? new Date(startDateIso).getTime() : Date.now();
        const endMs = endDateIso ? new Date(endDateIso).getTime() : (startMs + 60 * 60 * 1000);
        const stationId = rec?.stationId ?? rec?.stationID ?? null;
        const stationNumber = String(rec?.stationNumber ?? rec?.stationNo ?? '').trim();
        const stationName = String(rec?.stationName ?? '').trim();
        const label = stationNumber || stationName || (stationId ? `Station ${stationId}` : String(rec?.description ?? ''));
        const color = palette[(colorIndex++) % palette.length];
        seriesData.push({ x: projectLabel, y: [startMs, endMs], fillColor: color, meta: { stationId, stationNumber, stationName, raw: rec, label, startDate: startDateIso, endDate: endDateIso } });
      }
    }

    const template = (busPulseData as any).projectTimelineChart ?? {};
    const isDark = this.dashboardMapIsDark;
    const textColor = isDark ? '#e0e0e0' : '#333333';
    const visibleProjectCount = Math.max(1, new Set(seriesData.map((point) => String(point?.x ?? ''))).size);
    const timelineBounds = seriesData
      .map((point) => Array.isArray(point?.y) ? point.y : [])
      .filter((range) => range.length === 2)
      .reduce((acc, range) => {
        const start = Number(range[0]);
        const end = Number(range[1]);
        if (Number.isFinite(start)) {
          acc.min = acc.min === null ? start : Math.min(acc.min, start);
        }
        if (Number.isFinite(end)) {
          acc.max = acc.max === null ? end : Math.max(acc.max, end);
        }
        return acc;
      }, { min: null as number | null, max: null as number | null });
    const spanDays = (timelineBounds.min !== null && timelineBounds.max !== null)
      ? Math.max(1, Math.ceil((timelineBounds.max - timelineBounds.min) / (1000 * 60 * 60 * 24)))
      : 90;
    const calculatedHeight = Math.min(Math.max(200, (visibleProjectCount * 28) + 28), 340);
    const calculatedWidth = Math.min(Math.max(960, 840 + (Math.min(spanDays, 210) * 2)), 1440);

    const chartOptions = {
      ...template,
      chart: {
        ...(template?.chart ?? {}),
        type: 'rangeBar',
        height: calculatedHeight,
        width: calculatedWidth,
        parentHeightOffset: 0,
        toolbar: {
          ...(template?.chart?.toolbar ?? {}),
          show: true,
          tools: {
            download: true,
            selection: false,
            zoom: false,
            zoomin: false,
            zoomout: false,
            pan: false,
            reset: false,
          },
        },
      },
      plotOptions: {
        bar: {
          ...(template?.plotOptions?.bar ?? {}),
          horizontal: true,
          barHeight: visibleProjectCount <= 6 ? '58%' : '52%',
          rangeBarGroupRows: false,
        },
      },
      grid: {
        ...(template?.grid ?? {}),
        padding: {
          ...(template?.grid?.padding ?? {}),
          top: 6,
          right: 18,
          bottom: 0,
          left: 8,
        },
      },
      xaxis: {
        ...(template?.xaxis ?? {}),
        type: 'datetime',
        tickAmount: spanDays > 150 ? 7 : 6,
        labels: {
          ...(template?.xaxis?.labels ?? {}),
          format: "MMM 'yy",
          rotate: 0,
          datetimeUTC: false,
          hideOverlappingLabels: true,
          style: {
            ...(template?.xaxis?.labels?.style ?? {}),
            colors: textColor,
            fontSize: '11px',
          },
        },
      },
      yaxis: {
        ...(template?.yaxis ?? {}),
        title: {
          ...(template?.yaxis?.title ?? {}),
          text: 'Projects',
        },
        labels: {
          ...(template?.yaxis?.labels ?? {}),
          minWidth: 108,
          maxWidth: 150,
          offsetX: -4,
          style: {
            ...(template?.yaxis?.labels?.style ?? {}),
            fontSize: '12px',
            colors: textColor,
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
          const project = String(point?.x ?? '').trim() || 'Project';
          const stationName = String(meta?.stationName ?? meta?.stationNumber ?? meta?.label ?? '').trim();
          const stationLine = stationName ? `<div><strong>Station:</strong> ${stationName}</div>` : '';
          const fmt = (iso?: string | null) => {
            if (!iso) return '';
            try { return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return String(iso); }
          };
          const startLine = meta?.startDate ? `<div><strong>Start:</strong> ${fmt(meta.startDate)}</div>` : '';
          const endLine = meta?.endDate ? `<div><strong>End:</strong> ${fmt(meta.endDate)}</div>` : '';
          return `<div class="apexcharts-tooltip-rangebar" style="padding:8px 10px;">` +
            `<div><strong>Project:</strong> ${project}</div>` +
            stationLine + startLine + endLine +
            `</div>`;
        },
      },
      series: [{ ...(template?.series?.[0] ?? {}), data: seriesData }],
    };

    (chartOptions as any).__calculatedHostHeight = calculatedHeight;
    (chartOptions as any).__calculatedHostWidth = calculatedWidth;
    (chartOptions as any).__busPulseResponsiveOptions = ({ width }: { width: number }) => {
      if (width >= 720) {
        return {};
      }

      return {
        xaxis: {
          labels: {
            rotate: 0,
            style: {
              fontSize: '10px',
            },
          },
        },
        yaxis: {
          title: {
            text: '',
          },
          labels: {
            minWidth: 88,
            maxWidth: 118,
            style: {
              fontSize: '11px',
            },
          },
        },
      };
    };

    return chartOptions;
  }

  private updateVehicleDistributionWidget(widgetId: 'widget-2' | 'widget-3', chartOptions: unknown): void {
    if (!this.widgets.length) return;

    this.widgets = this.widgets.map((widget) => (
      widget.id === widgetId
        ? { ...widget, chartOptions, loading: false }
        : widget
    ));
  }

  private refreshTicketCreationActivityWidget(showLoading = true): void {
    const widgetId = 'widget-16';
    const widget = this.widgets.find((item) => item.id === widgetId);
    if (!widget) {
      return;
    }

    const requestVersion = ++this.ticketActivityRequestVersion;
    const projectId = this.selectedProject !== 'all' ? this.selectedProject : undefined;
    const vehicleId = this.selectedVehicle !== 'all' ? this.selectedVehicle : undefined;
    const clientId = this.getEffectiveClientId();

    const shouldShowLoading = showLoading || !widget.chartOptions;
    if (shouldShowLoading) {
      this.widgets = this.widgets.map((item) => (
        item.id === widgetId
          ? { ...item, loading: true }
          : item
      ));
    }

    this.dashboardProjectsService.getTicketCreationActivity({
      clientId,
      projectId,
      vehicleId,
      includeClosed: this.includeClosedProjects,
      startDate: this.ticketActivityStartDate || undefined,
      endDate: this.ticketActivityEndDate || undefined,
    }).subscribe({
      next: (activity) => {
        if (requestVersion !== this.ticketActivityRequestVersion) {
          return;
        }

        const projectLabel = this.getTicketActivityProjectLabel(activity);
        const scopeLabel = this.getTicketActivityScopeLabel(projectLabel, activity.projectCount);
        this.ticketActivityGranularity = this.getTicketActivityGranularity(activity);
        const chartOptions = buildTicketCreationActivityChartOptions(
          busPulseData.ticketCreationActivityChart,
          activity,
          this.ticketActivityGranularity,
          this.dashboardMapIsDark,
        );

        this.lastTicketActivityResult = activity;
        this.ticketActivityViewModel = this.buildTicketActivityViewModel(activity, scopeLabel, projectLabel);

        this.widgets = this.widgets.map((item) => (
          item.id === widgetId
            ? {
                ...item,
                loading: false,
                subtitle: activity.points.length
                  ? `${this.getTicketActivityGranularityLabel(this.ticketActivityGranularity)} created-ticket flow for ${scopeLabel.toLowerCase()}`
                  : 'Created-date ticket flow for the selected range',
                chartOptions,
              }
            : item
        ));
      },
      error: () => {
        if (requestVersion !== this.ticketActivityRequestVersion) {
          return;
        }

        this.lastTicketActivityResult = null;
        this.ticketActivityViewModel = this.buildEmptyTicketActivityViewModel();
        this.ticketActivityGranularity = 'day';

        this.widgets = this.widgets.map((item) => (
          item.id === widgetId
            ? {
                ...item,
                loading: false,
                chartOptions: buildTicketCreationActivityChartOptions(
                  busPulseData.ticketCreationActivityChart,
                  this.createEmptyTicketActivityResult(),
                  this.ticketActivityGranularity,
                  this.dashboardMapIsDark,
                ),
              }
            : item
        ));
      },
    });
  }

  private rebuildTicketActivityChartForTheme(): void {
    const widgetId = 'widget-16';
    const widget = this.widgets.find((item) => item.id === widgetId);

    if (!widget) {
      return;
    }

    const activity = this.lastTicketActivityResult ?? this.createEmptyTicketActivityResult();
    const chartOptions = buildTicketCreationActivityChartOptions(
      busPulseData.ticketCreationActivityChart,
      activity,
      this.ticketActivityGranularity,
      this.dashboardMapIsDark,
    );

    this.widgets = this.widgets.map((item) => (
      item.id === widgetId
        ? {
            ...item,
            chartOptions,
          }
        : item
    ));
  }

  private createEmptyTicketActivityResult(): DashboardTicketActivityResult {
    return {
      points: [],
      totalTickets: 0,
      spanDays: 0,
      activeDays: 0,
      projectCount: 0,
      averagePerDay: 0,
      firstTicketAt: null,
      lastTicketAt: null,
      peakDayDate: null,
      peakDayCount: 0,
      projectNames: [],
    };
  }

  private buildTicketActivityViewModel(
    activity: DashboardTicketActivityResult,
    scopeLabel: string,
    projectLabel: string,
  ): SpkTicketActivityWidgetViewModel {
    return {
      scopeLabel,
      projectLabel,
      totalTickets: this.formatNumber(activity.totalTickets),
      spanDays: this.formatNumber(activity.spanDays),
      activeDays: this.formatNumber(activity.activeDays),
      averagePerDay: activity.averagePerDay.toFixed(activity.averagePerDay >= 100 ? 0 : 1),
      peakDayLabel: activity.peakDayDate ? this.formatTicketActivityDate(activity.peakDayDate) : '-',
      peakDayCount: this.formatNumber(activity.peakDayCount),
      firstTicketLabel: activity.firstTicketAt ? this.formatTicketActivityDateTime(activity.firstTicketAt) : '-',
      lastTicketLabel: activity.lastTicketAt ? this.formatTicketActivityDateTime(activity.lastTicketAt) : '-',
      rangeLabel: activity.points.length
        ? `${this.formatTicketActivityDate(activity.points[0].date)} - ${this.formatTicketActivityDate(activity.points[activity.points.length - 1].date)}`
        : 'No created ticket dates',
    };
  }

  private buildEmptyTicketActivityViewModel(): SpkTicketActivityWidgetViewModel {
    return {
      scopeLabel: 'Current selection',
      projectLabel: '',
      totalTickets: '0',
      spanDays: '0',
      activeDays: '0',
      averagePerDay: '0.0',
      peakDayLabel: '-',
      peakDayCount: '0',
      firstTicketLabel: '-',
      lastTicketLabel: '-',
      rangeLabel: 'No created ticket dates',
    };
  }

  private getTicketActivityProjectLabel(activity: DashboardTicketActivityResult): string {
    if (this.selectedProject !== 'all') {
      return this.getSelectedProjectName();
    }

    if (activity.projectCount <= 1 && activity.projectNames.length === 1) {
      return activity.projectNames[0];
    }

    if (this.isAdminRole && this.selectedClient !== 'all') {
      return this.getSelectedClientName();
    }

    return activity.projectCount > 1
      ? `${this.formatNumber(activity.projectCount)} Projects`
      : 'All Projects';
  }

  private getTicketActivityScopeLabel(projectLabel: string, projectCount: number): string {
    if (this.selectedProject !== 'all') {
      return projectLabel;
    }

    if (this.selectedVehicle !== 'all') {
      return this.getSelectedVehicleName();
    }

    if (projectCount > 1) {
      return projectLabel;
    }

    return projectLabel || 'Current selection';
  }

  private getTicketActivityGranularity(
    activity: DashboardTicketActivityResult,
  ): DashboardTicketActivityGranularity {
    if (this.ticketActivityRangePreset === 'all' || activity.points.length > 365) {
      return 'month';
    }

    if (activity.points.length > 120) {
      return 'week';
    }

    return 'day';
  }

  private scheduleTicketActivityLiveRefresh(): void {
    this.clearTicketActivityLiveRefreshTimeout();
    if (!this.hasValidTicketActivityDateRange()) {
      return;
    }

    this.ticketActivityLiveRefreshTimeout = setTimeout(() => {
      this.ticketActivityLiveRefreshTimeout = null;
      this.refreshTicketCreationActivityWidget(false);
    }, 160);
  }

  private clearTicketActivityLiveRefreshTimeout(): void {
    if (this.ticketActivityLiveRefreshTimeout) {
      clearTimeout(this.ticketActivityLiveRefreshTimeout);
      this.ticketActivityLiveRefreshTimeout = null;
    }
  }

  private hasValidTicketActivityDateRange(): boolean {
    const startDate = String(this.ticketActivityStartDate ?? '').trim();
    const endDate = String(this.ticketActivityEndDate ?? '').trim();
    return !startDate || !endDate || startDate <= endDate;
  }

  private getTicketActivityGranularityLabel(
    granularity: DashboardTicketActivityGranularity,
  ): string {
    if (granularity === 'month') {
      return 'Monthly';
    }

    if (granularity === 'week') {
      return 'Weekly';
    }

    return 'Daily';
  }

  private formatTicketActivityDate(value: string): string {
    if (!value) {
      return '-';
    }

    const parsed = value.includes('T')
      ? new Date(value)
      : new Date(`${value}T00:00:00`);

    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  private formatTicketActivityDateTime(value: string): string {
    if (!value) {
      return '-';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat().format(Number(value ?? 0));
  }

  private getSelectedVehicleName(): string {
    const vehicle = this.vehicles.find((item) => String(item.id ?? '') === String(this.selectedVehicle ?? ''));
    return vehicle?.name ?? `Vehicle ${this.selectedVehicle}`;
  }

  private updateTicketsByStatusWidgetFromApi(payload: any | any[]): void {
    if (!this.widgets.length) return;

    this.updateSafetyCriticalGaugeWidgetFromApi(payload);
    this.updateRepeatedDefectsGaugeWidgetFromApi(payload);
    this.updateOverallDefectsByAreaWidgetFromApi(payload);
    this.updateRepeatedDefectsByAreaWidgetFromApi(payload);
    this.updateDefectsByStationWidgetFromApi(payload);
    this.loadProjectsByAreaWidget();

    // Temporary debug logging to help capture API payloads that cause the
    // Tickets-by-Status widget to fall back to demo/demo values. Reproduce
    // the failing selection and check the browser console for these entries.
    try {
      console.debug('[TicketsByStatus] raw payload:', payload, { project: this.selectedProject, vehicle: this.selectedVehicle });
    } catch (e) {
      // Ignore console failures in restricted environments
    }

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

    try {
      console.debug('[TicketsByStatus] normalized combined:', combined);
    } catch (e) {
      // swallow
    }

    const chartOptions = busPulseData.buildTicketsByStatusBar({ ticketsByStatus: combined });

    this.widgets = this.widgets.map((widget) => (
      widget.id === 'widget-9' ? { ...widget, chartOptions, loading: false } : widget
    ));
  }

  private updateOverallDefectsByAreaWidgetFromApi(payload: any | any[]): void {
    if (!this.widgets.length) return;

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

    this.widgets = this.widgets.map((widget) => (
      widget.id === 'widget-4' ? { ...widget, chartOptions, loading: false } : widget
    ));
  }

  private updateRepeatedDefectsGaugeWidgetFromApi(payload: any | any[]): void {
    if (!this.widgets.length) return;

    const resolvedPercent = this.resolveRepeatedPercent(payload);
    const boundedPercent = Number.isFinite(resolvedPercent)
      ? Math.max(0, Math.min(100, Number(resolvedPercent)))
      : 0;

    const fallbackGauge = busPulseData.repeatedDefectsGauge as any;
    const chartOptions = {
      ...fallbackGauge,
      series: [Number(boundedPercent.toFixed(2))],
    };

    this.widgets = this.widgets.map((widget) => (
      widget.id === 'widget-5' ? { ...widget, chartOptions, loading: false } : widget
    ));
  }

  private updateSafetyCriticalGaugeWidgetFromApi(payload: any | any[]): void {
    if (!this.widgets.length) return;

    const resolvedPercent = this.resolveSafetyCriticalPercent(payload);
    const boundedPercent = Number.isFinite(resolvedPercent)
      ? Math.max(0, Math.min(100, Number(resolvedPercent)))
      : 0;

    const fallbackGauge = busPulseData.safetyCriticalDefectsGauge as any;
    const chartOptions = {
      ...fallbackGauge,
      series: [Number(boundedPercent.toFixed(2))],
    };

    this.widgets = this.widgets.map((widget) => (
      widget.id === 'widget-7' ? { ...widget, chartOptions, loading: false } : widget
    ));
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
    const container = payload?.overallByArea ?? payload?.data?.overallByArea ?? payload?.result?.overallByArea;
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

    let raw: Array<{ area: string; count: number }> = [];

    if (Array.isArray(container)) {
      raw = toEntriesFromArray(container);
    } else if (Array.isArray(container?.items)) {
      raw = toEntriesFromArray(container.items);
    } else if (Array.isArray(container?.$values)) {
      raw = toEntriesFromArray(container.$values);
    } else if (typeof container === 'object') {
      raw = Object.entries(container)
        .map(([key, value]) => ({ area: String(key).trim(), count: Number(value ?? 0) }))
        .filter((entry) => entry.area.length > 0 && Number.isFinite(entry.count) && entry.count >= 0);
    }

    return normalizeAreaEntries(raw);
  }

  private updateRepeatedDefectsByAreaWidgetFromApi(payload: any | any[]): void {
    if (!this.widgets.length) return;

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

    this.widgets = this.widgets.map((widget) => (
      widget.id === 'widget-8' ? { ...widget, chartOptions, loading: false } : widget
    ));
  }

  private updateDefectsByStationWidgetFromApi(payload: any | any[]): void {
    if (!this.widgets.length) return;

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

    this.widgets = this.widgets.map((widget) => (
      widget.id === 'widget-6' ? { ...widget, width: 12, chartOptions, loading: false } : widget
    ));
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

  /**
   * Calls GET /tickets/dashboard?projectId={id} once per project in parallel
   * (forkJoin), extracts the overallByArea block from each response, and builds
   * widget-10 as a stacked bar chart where:
   *   - each column  = one project  (projectNames[])
   *   - each series  = one area     (areas[].name)
   *   - each value   = defect count for that area in that project
   * Missing areas for a project are filled with 0 so all series stay aligned.
   */
  private loadProjectsByAreaWidget(): void {
    if (!this.widgets.length) return;

    // Skip API calls entirely when the widget is hidden (e.g. client compact mode).
    const widget = this.widgets.find(w => w.id === 'widget-10');
    if (!widget || !this.isWidgetVisible(widget)) return;

    const projectIds = this.getSelectedOrAllVisibleProjectIds();
    if (projectIds.length === 0) return;

    // Stamp this request so stale forkJoin results from rapid filter changes
    // are discarded on arrival rather than overwriting fresher data.
    const requestVersion = ++this.widget10RequestVersion;

    this.widgets = this.widgets.map(w =>
      w.id === 'widget-10' ? { ...w, loading: true } : w,
    );

    // Apply vehicle filter when a specific vehicle is selected.
    const rawVehicle = String(this.selectedVehicle ?? '').trim().toLowerCase();
    const effectiveVehicleId = rawVehicle && rawVehicle !== 'all'
      ? String(this.selectedVehicle).trim()
      : undefined;

    const calls = projectIds.map(id =>
      forkJoin({
        tickets: this.dashboardProjectsService.getTicketsDashboard({
          projectId: id,
          clientId: this.getEffectiveClientId(),
          includeClosed: this.includeClosedProjects,
          vehicleId: effectiveVehicleId,
        }).pipe(catchError(() => of(null as any))),
        vehicles: this.dashboardProjectsService.getVehicleOptionsByProjectResult(id, {
          clientId: this.getEffectiveClientId(),
          includeClosed: this.includeClosedProjects,
          includeAllOption: false,
        }).pipe(catchError(() => of({ options: [] as any[], totalCount: 0 }))),
      }).pipe(
        map(({ tickets, vehicles }) => {
          const rawCount = Number(vehicles?.totalCount ?? 0);
          const vehicleCount = rawCount > 0
            ? rawCount
            : (vehicles?.options ?? []).filter((v: any) => String(v.id ?? '').toLowerCase() !== 'all').length;
          return { id, res: tickets ?? {} as any, failed: tickets === null, vehicleCount: Math.max(vehicleCount, 1) };
        }),
      ),
    );

    from(calls).pipe(mergeMap(call => call, 6), toArray()).subscribe({
      next: (results) => {
        // Discard results from a superseded request (user changed filters).
        if (requestVersion !== this.widget10RequestVersion) return;

        const projectNames: string[] = [];
        const areaMap = new Map<string, number[]>();
        let failedCount = 0;

        results.forEach(({ id, res, failed, vehicleCount }, colIdx) => {
          const project = this.projects.find(p => String(p.id) === String(id));
          projectNames.push(project?.name ?? String(id));

          if (failed) {
            failedCount++;
            // Pad all areas already in the map so every column stays aligned.
            for (const data of areaMap.values()) data.push(0);
            return;
          }

          const entries = this.extractOverallByAreaEntries(res);
          const seenAreas = new Set<string>();

          for (const entry of entries) {
            seenAreas.add(entry.area);
            if (!areaMap.has(entry.area)) {
              areaMap.set(entry.area, Array(colIdx).fill(0));
            }
            const avg = Math.round((entry.count / vehicleCount) * 100) / 100;
            areaMap.get(entry.area)!.push(avg);
          }

          for (const [area, data] of areaMap.entries()) {
            if (!seenAreas.has(area)) data.push(0);
          }
        });

        const setNoData = (text: string) => {
          const noDataOptions = {
            ...busPulseData.projectsByAreaStackedChart,
            series: [],
            noData: {
              text,
              align: 'center',
              verticalAlign: 'middle',
              style: { fontSize: '14px', fontFamily: 'Poppins, sans-serif', color: '#6c757d' },
            },
          };
          this.widgets = this.widgets.map(w =>
            w.id === 'widget-10' ? { ...w, chartOptions: noDataOptions, loading: false } : w,
          );
        };

        if (projectNames.length === 0 || areaMap.size === 0) {
          setNoData(failedCount > 0
            ? 'Data unavailable — API error'
            : 'No defect data for selected projects',
          );
          return;
        }

        // Sort areas by total count descending — largest area is always the
        // bottom segment in the stack, keeping colours consistent across loads.
        const areas = Array.from(areaMap.entries())
          .map(([name, data]) => ({
            name,
            data: data.map(v => (Number.isFinite(v) ? v : 0)),
            total: data.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0),
          }))
          .sort((a, b) => b.total - a.total)
          .map(({ name, data }) => ({ name, data }));

        const chartOptions = buildProjectsByAreaChartOptions(
          busPulseData.projectsByAreaStackedChart,
          { projectNames, areas },
        );

        const subtitle = failedCount > 0
          ? `Average defects per vehicle per area (${failedCount} project${failedCount > 1 ? 's' : ''} unavailable)`
          : 'Average defects per vehicle per area';

        this.widgets = this.widgets.map(w =>
          w.id === 'widget-10' ? { ...w, chartOptions, loading: false, subtitle } : w,
        );
      },
      error: () => {
        if (requestVersion !== this.widget10RequestVersion) return;
        const errorOptions = {
          ...busPulseData.projectsByAreaStackedChart,
          series: [],
          noData: {
            text: 'Failed to load data',
            align: 'center',
            verticalAlign: 'middle',
            style: { fontSize: '14px', fontFamily: 'Poppins, sans-serif', color: '#6c757d' },
          },
        };
        this.widgets = this.widgets.map(w =>
          w.id === 'widget-10' ? { ...w, chartOptions: errorOptions, loading: false } : w,
        );
      },
    });
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

    window.dispatchEvent(new Event('resize'));
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
      next: (tickets: any[]) => {
        this.allClientTickets = tickets || [];
      },
    });
  }

  private buildProjectVehicleSummaries(items: any[]): VehicleStats[] {
    const vehicles = new Map<string, VehicleStats>();

    items.forEach((item) => {
      const vehicleId = toOptionalText(getFirstDefinedValue(item, [
        'id',
        'vehicleId',
        'vehicleID',
        'VehicleId',
        'VehicleID',
        'assetId',
        'AssetId',
      ]));
      const vehicleName = toOptionalText(getFirstDefinedValue(item, [
        'fleetNumber',
        'vehicleName',
        'VehicleName',
        'name',
        'title',
      ]));
      const dedupeKey = String(vehicleId ?? vehicleName ?? '').trim().toLowerCase();

      if (!dedupeKey) {
        return;
      }

      if (!vehicles.has(dedupeKey)) {
        vehicles.set(dedupeKey, {
          vehicleId: String(vehicleId ?? dedupeKey),
          vehicleName: toText(vehicleName, `Vehicle ${vehicles.size + 1}`),
          totalTickets: 0,
          totalAssets: 0,
          ticketsChangePercentage: 0,
          assetsChangePercentage: 0,
          ticketsStatus: 'decreased',
          assetsStatus: 'decreased',
        });
      }
    });

    return Array.from(vehicles.values());
  }

  private pickLatestStationEntry(entries: any[]): any {
    if (!entries?.length) return null;
    return entries.reduce((latest, entry) => {
      const a = entry?.startDate ?? entry?.endDate ?? '';
      const b = latest?.startDate ?? latest?.endDate ?? '';
      return a > b ? entry : latest;
    }, entries[0]);
  }

  // ── Fleet Map Downloads ───────────────────────────────────────────────────

  private getActiveMapStage(): MapStageComponent | undefined {
    const all = this.mapStageComponents.toArray();
    return this.fullscreenWidgetId === 'widget-map' ? all[all.length - 1] : all[0];
  }

  async downloadMapPNG(): Promise<void> {
    const blob = await this.getActiveMapStage()?.captureMapImage();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fleet-map.png';
    a.click();
    URL.revokeObjectURL(url);
  }

  downloadMapCSV(): void {
    const projects = this.dashboardMapProjects;
    if (!projects.length) return;
    const headers = ['Name', 'Status', 'Type', 'Client', 'Latitude', 'Longitude'];
    const rows = projects.map((p) => {
      const client = this.dashboardMapClients.find((c) => c.id === p.clientId);
      return [
        `"${p.name ?? ''}"`,
        p.status ?? '',
        p.type ?? '',
        `"${client?.name ?? p.clientId ?? ''}"`,
        p.lat ?? '',
        p.lng ?? '',
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fleet-map-projects.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async downloadMapExcel(): Promise<void> {
    const projects = this.dashboardMapProjects;
    if (!projects.length) return;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BusPulse';
    const sheet = workbook.addWorksheet('Fleet Map Projects');
    sheet.columns = [
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Type', key: 'type', width: 18 },
      { header: 'Client', key: 'client', width: 24 },
      { header: 'Latitude', key: 'lat', width: 14 },
      { header: 'Longitude', key: 'lng', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    projects.forEach((p) => {
      const client = this.dashboardMapClients.find((c) => c.id === p.clientId);
      sheet.addRow({
        name: p.name ?? '',
        status: p.status ?? '',
        type: p.type ?? '',
        client: client?.name ?? p.clientId ?? '',
        lat: p.lat ?? '',
        lng: p.lng ?? '',
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fleet-map-projects.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }
}
