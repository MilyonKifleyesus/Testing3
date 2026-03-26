import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { 
  ApexChart, 
  ApexNonAxisChartSeries, 
  ApexResponsive, 
  ApexDataLabels, 
  ApexLegend, 
  ApexPlotOptions, 
  ApexXAxis, 
  ApexYAxis, 
  ApexGrid, 
  ApexStroke, 
  ApexTooltip 
} from 'ng-apexcharts';
import { AuthService } from '../../../services/auth.service';
import { resolveProjectManagementContext } from '../../project-management/project-management-context';
import { VehicleDetail, VehicleAssignment, GalleryImage, TimelineEvent, Snag, Defect, Ticket } from '../models/vehicle.model';
import { VehicleUtilService } from '../services/vehicle-util.service';
import { ClientDashboardService } from '../../../services/client-dashboard.service';
import { UserManagementService } from '../../../services/user-management.service';
import { catchError, firstValueFrom, map, of, take } from 'rxjs';
import { extractArrayFromApiResponse, getFirstDefinedValue, toOptionalText, toText } from '../../../utils/api-data.utils';
import { buildPaginationItems, PAGINATION_ELLIPSIS } from '../../../utils/pagination.utils';

export type ChartOptions = {
  series: ApexNonAxisChartSeries | any;
  chart: ApexChart | any;
  labels?: string[];
  colors?: string[];
  legend?: ApexLegend;
  plotOptions?: ApexPlotOptions;
  responsive?: ApexResponsive[];
  dataLabels?: ApexDataLabels;
  xaxis?: ApexXAxis;
  yaxis?: ApexYAxis;
  grid?: ApexGrid;
  stroke?: ApexStroke;
  tooltip?: ApexTooltip;
};

/**
 * Vehicle View Component
 * 
 * @description
 * Displays comprehensive vehicle details including:
 * - Vehicle insights with KPIs
 * - Inspection timeline
 * - Photo gallery
 * - Defect analysis by area
 * - Tickets and snags
 * - Inspector information
 * - Shipping details
 * - Media files
 * 
 * @example
 * <app-vehicle-view></app-vehicle-view>
 */
@Component({
  selector: 'app-vehicle-view',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, NgApexchartsModule],
  templateUrl: './vehicle-view.component.html',
  styleUrl: './vehicle-view.component.scss'
})
export class VehicleViewComponent implements OnInit {
  /** Vehicle ID from route */
  vehicleId: number = 0;
  
  /** Detailed vehicle data */
  vehicle: VehicleDetail | null = null;
  
  /** Chart: Snag by Area */
  snagByAreaChart: Partial<ChartOptions> = {};

  /** Chart: Defect Severity Gauge */
  defectSeverityChart: Partial<ChartOptions> = {};

  /** Chart: Tickets by Inspector (radial) */
  inspectorTicketsChart: Partial<ChartOptions> = {};
  
  /** Currently selected image in gallery */
  selectedImage: string = '';

  /** Profile picture of the currently logged-in user (for windshield). */
  get userProfilePicture(): string {
    return this.authService.currentUserValue?.picture || '';
  }
  
  /** Gallery images collection */
  galleryImages: GalleryImage[] = [];

  /** Timeline events */
  timeline: TimelineEvent[] = [];

  isLoading: boolean = false;
  errorMessage: string = '';
  timelineVisible: boolean = false;

  // Inspector detail modal
  inspectorModalVisible = false;
  selectedInspector: VehicleAssignment | null = null;
  inspectorModalTickets: Ticket[] = [];
  inspectorModalSnags: Snag[] = [];

  get inspectorSafetyCriticalCount(): number {
    return this.inspectorModalTickets.filter((t) => t.safetyCritical).length;
  }

  get inspectorRepeaterCount(): number {
    return this.inspectorModalTickets.filter((t) => t.repeater).length;
  }

  openInspectorModal(assignment: VehicleAssignment): void {
    this.selectedInspector = assignment;
    const name = assignment.inspectorName;
    this.inspectorModalTickets = (this.vehicle?.tickets ?? []).filter(
      (t) => t.assignedTo === name || t.assignedBy === name,
    );
    this.inspectorModalSnags = (this.vehicle?.snags ?? []).filter(
      (s) => s.inspector === name,
    );
    this.inspectorModalVisible = true;
  }

  closeInspectorModal(): void {
    this.inspectorModalVisible = false;
    this.selectedInspector = null;
  }

  private readonly defaultVehicleImage = 'assets/images/vehicles/yrt40.jpeg';
  private readonly defaultAvatar = 'assets/images/faces/4.jpg';

  readonly portalPrefix: '/admin' | '/client';

  get homePath(): string {
    return `${this.portalPrefix}/dashboard`;
  }

  get vehiclesListPath(): string {
    return `${this.portalPrefix}/vehicles/list`;
  }

  // Pagination for tickets
  currentPage: number = 1;
  pageSize: number = 10;
  totalPages: number = 1;
  paginatedTickets: any[] = [];
  paginationItems: number[] = [];

  // Sorting for tickets
  ticketSortCol: string = '';
  ticketSortDir: 'asc' | 'desc' = 'asc';

  // Pagination for snags
  snagCurrentPage: number = 1;
  readonly snagPageSize: number = 10;
  snagTotalPages: number = 1;
  paginatedSnags: any[] = [];
  snagPaginationItems: number[] = [];

  // Sorting for snags
  snagSortCol: string = '';
  snagSortDir: 'asc' | 'desc' = 'asc';

  // Inspector filters
  ticketInspectorFilter: string = 'all';
  snagInspectorFilter: string = 'all';

  // Defect type (Area) filter for tickets
  ticketDefectTypeFilter: string = 'all';

  get defectTypeNames(): string[] {
    if (!this.vehicle) return [];
    const names = new Set<string>();
    this.vehicle.tickets.forEach((t: any) => {
      if (t.defectType && t.defectType !== '-') names.add(t.defectType);
    });
    return Array.from(names).sort();
  }

  onTicketDefectTypeFilterChange(): void {
    this.currentPage = 1;
    this.updatePagination();
  }


  get inspectorNames(): string[] {
    if (!this.vehicle) return [];
    const names = new Set<string>();
    this.vehicle.assignments.forEach(a => names.add(a.inspectorName));
    return Array.from(names).sort();
  }

  get filteredTicketCount(): number {
    if (!this.vehicle) return 0;
    return this.getFilteredTickets().length;
  }

  private getFilteredTickets(): any[] {
    if (!this.vehicle) return [];
    let filtered = this.vehicle.tickets;
    if (this.ticketInspectorFilter !== 'all') {
      filtered = filtered.filter((t: any) =>
        t.assignedTo === this.ticketInspectorFilter || t.assignedBy === this.ticketInspectorFilter
      );
    }
    if (this.ticketDefectTypeFilter !== 'all') {
      filtered = filtered.filter((t: any) => t.defectType === this.ticketDefectTypeFilter);
    }
    return filtered;
  }

  get filteredSnagCount(): number {
    if (!this.vehicle) return 0;
    if (this.snagInspectorFilter === 'all') return this.vehicle.snags.length;
    return this.vehicle.snags.filter(s => s.inspector === this.snagInspectorFilter).length;
  }

  onTicketInspectorFilterChange(): void {
    this.currentPage = 1;
    this.updatePagination();
  }

  onSnagInspectorFilterChange(): void {
    this.snagCurrentPage = 1;
    this.updateSnagPagination();
  }

  public PAGINATION_ELLIPSIS = PAGINATION_ELLIPSIS;

  /** userId → display name, populated once on load */
  private userNameById = new Map<number, string>();

  // Ticket carousel
  ticketCarouselLocation: string = 'all';
  carouselOffset: number = 0;
  readonly carouselVisibleCount: number = 4;

  get carouselLocations(): string[] {
    if (!this.vehicle?.tickets) return [];
    const locs = new Set<string>();
    this.vehicle.tickets.filter((t: any) => t.imageUrl).forEach((t: any) => {
      if (t.defectLocation && t.defectLocation !== '-') locs.add(t.defectLocation);
    });
    return Array.from(locs).sort();
  }

  get carouselFilteredTickets(): any[] {
    if (!this.vehicle?.tickets) return [];
    const withImages = this.vehicle.tickets.filter((t: any) => t.imageUrl);
    if (this.ticketCarouselLocation === 'all') return withImages;
    return withImages.filter((t: any) => t.defectLocation === this.ticketCarouselLocation);
  }

  get maxCarouselOffset(): number {
    return Math.max(0, this.carouselFilteredTickets.length - this.carouselVisibleCount);
  }

  get carouselDots(): number[] {
    return Array.from({ length: this.maxCarouselOffset + 1 }, (_, i) => i);
  }

  setCarouselFilter(loc: string): void {
    this.ticketCarouselLocation = loc;
    this.carouselOffset = 0;
  }

  carouselPrev(): void {
    if (this.carouselOffset > 0) this.carouselOffset--;
  }

  carouselNext(): void {
    if (this.carouselOffset < this.maxCarouselOffset) this.carouselOffset++;
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly authService: AuthService,
    public vehicleUtil: VehicleUtilService,
    private readonly clientDashboardService: ClientDashboardService,
    private readonly userManagementService: UserManagementService,
  ) {
    const context = resolveProjectManagementContext(
      this.authService.currentUserValue,
      this.route.snapshot.queryParamMap.get('clientId'),
    );

    this.portalPrefix = context.portalPrefix;
  }

  ngOnInit(): void {
    this.vehicleId = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isFinite(this.vehicleId) || this.vehicleId <= 0) {
      this.errorMessage = 'Invalid vehicle identifier.';
      return;
    }

    this.loadVehicleDetails();
    this.updatePagination();
  }

  private loadVehicleDetails(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.clientDashboardService.getVehicleById(this.vehicleId)
      .pipe(
        catchError(() => of(null)),
        take(1),
      )
      .subscribe((raw) => {
        if (!raw) {
          this.vehicle = null;
          this.timeline = [];
          this.galleryImages = [];
          this.selectedImage = '';
          this.isLoading = false;
          this.errorMessage = 'Vehicle not found.';
          return;
        }

        // Unwrap common API response envelopes: { data: {...} }, { items: [...] }, etc.
        let item: any = raw;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          // If response has a 'data' key that is a non-array object, use it
          if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
            item = raw.data;
          } else if (Array.isArray(raw.items) && raw.items.length > 0) {
            item = raw.items[0];
          } else if (Array.isArray(raw.data) && raw.data.length > 0) {
            item = raw.data[0];
          }
        } else if (Array.isArray(raw) && raw.length > 0) {
          item = raw[0];
        }

        this.vehicle = this.mapVehicleDetail(item);
        this.currentPage = 1;
        this.updatePagination();
        this.isLoading = false;

        // Derive projectId from the first assignment for downstream API calls
        const projectId = this.vehicle.assignments[0]?.projectId || undefined;

        // Tickets, snags, and station trackers load in parallel.
        // loadUsers() is still called to resolve user IDs in tickets/snags.
        this.loadUsers().then(() => {
          this.loadVehicleTickets(projectId);
          this.loadVehicleSnags(projectId);
          this.loadStationTrackers(projectId);
        });
      });
  }

  updatePagination(): void {
    if (!this.vehicle || !this.vehicle.tickets) {
      this.paginatedTickets = [];
      this.paginationItems = [];
      return;
    }
    const filtered = this.getFilteredTickets();
    this.totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
    const start = (this.currentPage - 1) * this.pageSize;
    this.paginatedTickets = filtered.slice(start, start + this.pageSize);
    this.paginationItems = buildPaginationItems(this.totalPages, this.currentPage);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === PAGINATION_ELLIPSIS) return;
    this.currentPage = page;
    this.updatePagination();
  }

  goToSnagPage(page: number): void {
    if (page < 1 || page > this.snagTotalPages || page === PAGINATION_ELLIPSIS) return;
    this.snagCurrentPage = page;
    this.updateSnagPagination();
  }

  updateSnagPagination(): void {
    const allSnags = this.vehicle?.snags ?? [];
    const filtered = this.snagInspectorFilter === 'all'
      ? allSnags
      : allSnags.filter(s => s.inspector === this.snagInspectorFilter);
    this.snagTotalPages = Math.max(1, Math.ceil(filtered.length / this.snagPageSize));
    if (this.snagCurrentPage > this.snagTotalPages) this.snagCurrentPage = this.snagTotalPages;
    const start = (this.snagCurrentPage - 1) * this.snagPageSize;
    this.paginatedSnags = filtered.slice(start, start + this.snagPageSize);
    this.snagPaginationItems = buildPaginationItems(this.snagTotalPages, this.snagCurrentPage);
  }

  sortTickets(col: string): void {
    if (this.ticketSortCol === col) {
      this.ticketSortDir = this.ticketSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.ticketSortCol = col;
      this.ticketSortDir = 'asc';
    }
    if (!this.vehicle) return;
    const dir = this.ticketSortDir === 'asc' ? 1 : -1;
    const sorted = [...this.vehicle.tickets].sort((a, b) => {
      const av = String((a as any)[col] ?? '').toLowerCase();
      const bv = String((b as any)[col] ?? '').toLowerCase();
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    this.vehicle = { ...this.vehicle, tickets: sorted };
    this.currentPage = 1;
    this.updatePagination();
  }

  sortSnags(col: string): void {
    if (this.snagSortCol === col) {
      this.snagSortDir = this.snagSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.snagSortCol = col;
      this.snagSortDir = 'asc';
    }
    if (!this.vehicle) return;
    const dir = this.snagSortDir === 'asc' ? 1 : -1;
    const sorted = [...this.vehicle.snags].sort((a, b) => {
      const av = String((a as any)[col] ?? '').toLowerCase();
      const bv = String((b as any)[col] ?? '').toLowerCase();
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    this.vehicle = { ...this.vehicle, snags: sorted };
    this.snagCurrentPage = 1;
    this.updateSnagPagination();
  }

  /** Fetch all users into a local map (id → name). Result is cached by UserManagementService. */
  private loadUsers(): Promise<void> {
    return firstValueFrom(
      this.userManagementService.getUsers({ page: 1, pageSize: 1000, role: '', clientId: '', manufacturerId: '' }).pipe(
        map((result) => {
          result.items.forEach((u) => this.userNameById.set(u.id, u.userName || u.name));
        }),
        catchError(() => of(void 0)),
      ),
    );
  }

  /** Safely convert any API value to boolean — handles actual booleans, numbers (0/1), and strings ("true"/"false"/"1"/"0"). */
  private toBool(val: unknown): boolean {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1';
    return false;
  }

  /**
   * Resolve a display name from a raw field value.
   * - Plain text (e.g. "John Smith") → returned as-is
   * - Pure numeric string / number (e.g. "42") → looked up in userNameById, falls back to "User #42"
   */
  private resolveUserName(raw: unknown, fallback = '-'): string {
    const str = String(raw ?? '').trim();
    if (!str || str === '-' || str === 'null' || str === 'undefined') return fallback;
    const asNum = Number(str);
    if (Number.isFinite(asNum) && asNum > 0 && String(asNum) === str) {
      return this.userNameById.get(asNum) ?? `User #${str}`;
    }
    return str;
  }

  private loadVehicleTickets(projectId?: number): void {
    this.clientDashboardService
      .getTickets({ vehicleId: this.vehicleId, pageSize: 5000, ...(projectId ? { projectId } : {}) })
      .pipe(
        map((response) => extractArrayFromApiResponse(response)),
        catchError(() => of([] as any[])),
        take(1),
      )
      .subscribe((tickets) => {
        if (!this.vehicle) return;
        const mappedTickets = tickets.map((ticket, index) => this.mapTicket(ticket, index));
        this.vehicle = { ...this.vehicle, tickets: mappedTickets };
        this.totalPages = Math.ceil(mappedTickets.length / this.pageSize);
        this.updatePagination();
        this.initializeCharts();
        this.buildInspectorTicketsChart();
      });
  }

  private loadStationTrackers(projectId?: number): void {
    this.clientDashboardService
      .getStationTrackers({
        vehicleId: this.vehicleId,
        ...(projectId ? { projectId } : {}),
        pageNumber: 1,
        pageSize: 100,
        orderBy: 'id',
        orderDirection: 'desc',
      })
      .pipe(
        map((response) => extractArrayFromApiResponse(response)),
        catchError(() => of([] as any[])),
        take(1),
      )
      .subscribe((trackers) => {
        this.timeline = this.buildTimelineFromStationTrackers(trackers);
      });
  }

  private loadVehicleSnags(projectId?: number): void {
    this.clientDashboardService
      .getSnags({ vehicleId: this.vehicleId, ...(projectId ? { projectId } : {}), pageSize: 5000 })
      .pipe(
        map((response) => extractArrayFromApiResponse(response)),
        catchError((error) => {
          console.error('Failed to load vehicle snags:', error);
          return of([] as any[]);
        }),
        take(1),
      )
      .subscribe((snags) => {
        if (!this.vehicle) return;
        const mappedSnags: Snag[] = snags.map((snag: any, index: number) => this.mapSnag(snag, index));
        const defects: Defect[] = this.buildDefectsFromSnags(snags);
        this.vehicle = { ...this.vehicle, snags: mappedSnags, defects };
        this.snagCurrentPage = 1;
        this.updateSnagPagination();
        this.initializeCharts();
      });
  }

  private mapSnag(snag: any, index: number): Snag {
    // API fields: id, snagNumber, uniqueId, description, finalInspectionCategoryName,
    //             userId, safetyCritical, repeater, projectId, vehicleId, lastupdate
    const rawId = getFirstDefinedValue(snag, ['id', 'snagId']) ?? index + 1;
    const number = toText(getFirstDefinedValue(snag, ['snagNumber', 'uniqueId']), String(rawId));
    return {
      id: String(rawId),
      number,
      description: toText(getFirstDefinedValue(snag, ['description', 'snagDescription', 'notes']), '-'),
      location: toText(getFirstDefinedValue(snag, ['finalInspectionCategoryName', 'categoryName', 'location']), '-'),
      severity: 'low',
      status: 'open',
      inspector: this.resolveUserName(getFirstDefinedValue(snag, ['userId', 'modifiedBy', 'userName', 'inspectorName'])),
      project: toText(getFirstDefinedValue(snag, ['projectName', 'project']), '-'),
      category: toText(getFirstDefinedValue(snag, ['finalInspectionCategoryName', 'categoryName']), '-'),
      safetyCritical: this.toBool(getFirstDefinedValue(snag, ['safetyCritical', 'isSafetyCritical', 'SafetyCritical'])),
      repeater: this.toBool(getFirstDefinedValue(snag, ['repeater', 'isRepeater', 'repeated', 'Repeater'])),
      hasImages: Boolean(getFirstDefinedValue(snag, ['hasImages', 'hasImage']) ?? (Number(getFirstDefinedValue(snag, ['imageCount']) ?? 0) > 0)),
    };
  }

  private buildDefectsFromSnags(snags: any[]): Defect[] {
    const areaMap = new Map<string, number>();
    for (const snag of snags) {
      const area = toText(getFirstDefinedValue(snag, ['finalInspectionCategoryName', 'categoryName', 'location', 'area']), 'Other');
      areaMap.set(area, (areaMap.get(area) ?? 0) + 1);
    }
    return Array.from(areaMap.entries()).map(([area, count]) => ({
      area,
      count,
      severity: (count > 5 ? 'high' : count > 2 ? 'medium' : 'low') as any,
    }));
  }


  private mapVehicleDetail(item: any): VehicleDetail {
    // New API: GET /api/Vehicles/{id} — flat object with an `assignments` array
    // Try multiple possible field names for the assignments array
    const rawList = item.assignments ?? item.vehicleAssignments ?? item.Assignments;
    const rawAssignments: any[] = Array.isArray(rawList) ? rawList : [];
    const assignments: VehicleAssignment[] = rawAssignments.map((a: any) => ({
      assigmentId:  Number(a.assigmentId ?? a.assignmentId ?? a.id ?? 0),
      projectId:    Number(a.projectId ?? a.ProjectId ?? 0),
      projectName:  toText(getFirstDefinedValue(a, ['projectName', 'ProjectName', 'project']), '-'),
      inspectorId:  Number(a.inspectorId ?? a.InspectorId ?? a.userId ?? 0),
      inspectorName: toText(getFirstDefinedValue(a, ['inspectorName', 'InspectorName', 'userName', 'name']), '-'),
    }));

    // Derive project name from first assignment (they may all share the same project)
    const uniqueProjects = [...new Set(assignments.map((a) => a.projectName).filter((n) => n && n !== '-'))];
    const projectName = uniqueProjects.join(', ') || undefined;

    // Primary inspector = first assignment; all names shown in template via assignments[]
    const primaryInspector = assignments[0];

    const modifiedDate = toText(item.modifiedDate, '-');
    const active = item.active !== false; // default true if missing

    return {
      id: this.vehicleId,
      client:       toText(getFirstDefinedValue(item, ['clientName', 'client', 'ClientName', 'clientTitle']), '-'),
      project:      projectName,
      fleetNumber:  toText(getFirstDefinedValue(item, ['fleetNumber', 'fleet_number', 'FleetNumber', 'busNumber']), `Vehicle-${this.vehicleId}`),
      make:         toText(getFirstDefinedValue(item, ['make', 'Make', 'manufacturer', 'vehicleMake']), '-'),
      model:        toText(getFirstDefinedValue(item, ['model', 'Model', 'vehicleModel']), '-'),
      vin:          toText(getFirstDefinedValue(item, ['vin', 'VIN', 'Vin', 'vehicleIdentificationNumber']), '-'),
      plate:        toText(getFirstDefinedValue(item, ['plate', 'licensePlate', 'LicensePlate', 'plateNumber']), '-'),
      mileageType:  'miles',
      propulsion:   toText(getFirstDefinedValue(item, ['propulsionTypeName', 'propulsion', 'fuelType', 'PropulsionType']), '-'),
      active,
      status:       active ? 'in-progress' : 'completed',
      imageUrl:     toText(getFirstDefinedValue(item, ['imageUrl', 'photo', 'image', 'ImageUrl']), this.defaultVehicleImage),
      inspectionDate: modifiedDate,
      frameNumber:  toText(getFirstDefinedValue(item, ['frameNumber', 'frame_number', 'FrameNumber']), '-'),
      year:         Number(getFirstDefinedValue(item, ['year', 'Year', 'modelYear', 'vehicleYear']) ?? new Date().getFullYear()),
      color:        toText(getFirstDefinedValue(item, ['color', 'Color', 'colour', 'vehicleColor']), '-'),
      licensePlate: toText(getFirstDefinedValue(item, ['plate', 'licensePlate', 'LicensePlate']), '-'),
      inspector: {
        name:   primaryInspector ? primaryInspector.inspectorName : '-',
        email:  toText(getFirstDefinedValue(item, ['inspectorEmail', 'email']), '-'),
        avatar: this.defaultAvatar,
      },
      assignments,
      shippingDetail: {
        frontCurb:  toText(getFirstDefinedValue(item, ['frontCurb', 'shippingAddress']), '-'),
        backStreet: toText(getFirstDefinedValue(item, ['backStreet', 'deliveryAddress']), '-'),
      },
      media: {
        interiorVideo: toText(item.interiorVideo, ''),
        exteriorVideo: toText(item.exteriorVideo, ''),
      },
      images: {
        front:    toText(getFirstDefinedValue(item, ['frontImage', 'imageUrl']), this.defaultVehicleImage),
        back:     toText(getFirstDefinedValue(item, ['rearImage',  'imageUrl']), this.defaultVehicleImage),
        left:     toText(getFirstDefinedValue(item, ['leftImage',  'imageUrl']), this.defaultVehicleImage),
        right:    toText(getFirstDefinedValue(item, ['rightImage', 'imageUrl']), this.defaultVehicleImage),
        interior: toText(getFirstDefinedValue(item, ['interiorImage', 'imageUrl']), this.defaultVehicleImage),
      },
      inspectionData: {
        date:     modifiedDate,
        duration: '-',
        mileage:  Number(getFirstDefinedValue(item, ['mileage', 'odometer']) ?? 0),
      },
      defects:  [],
      tickets:  [],
      snags:    [],
      timeline: [],
    };
  }

  private mapTicket(ticket: any, index: number): any {
    // API fields: id, ticketNumber, ticketDescription, statusTicketName, defectLocationName,
    //             stationName, assignedBy (userId), assignedTo (userId),
    //             safetyCritical, repeated, createdAt
    const id = toText(getFirstDefinedValue(ticket, ['ticketNumber', 'uniqueId', 'id']), String(index + 1));
    const rawStatus = String(getFirstDefinedValue(ticket, ['statusTicketName', 'statusName', 'status']) ?? 'open').toLowerCase();
    const createdDate = toText(getFirstDefinedValue(ticket, ['createdAt', 'createdDate', 'dateCreated']), '-');
    return {
      id,
      title: toText(getFirstDefinedValue(ticket, ['ticketDescription', 'description', 'title']), '-'),
      status: rawStatus || 'open',
      createdDate,
      defectLocation: toText(getFirstDefinedValue(ticket, ['defectLocationName', 'defectLocation']), '-'),
      station: toText(getFirstDefinedValue(ticket, ['stationName', 'station']), '-'),
      defectType: toText(getFirstDefinedValue(ticket, ['defectTypeName', 'defectType', 'defectTypeDescription']), '-'),
      description: toText(getFirstDefinedValue(ticket, ['ticketDescription', 'description']), '-'),
      safetyCritical: this.toBool(getFirstDefinedValue(ticket, ['safetyCritical', 'isSafetyCritical', 'SafetyCritical'])),
      repeater: this.toBool(getFirstDefinedValue(ticket, ['repeated', 'repeater', 'isRepeater', 'Repeated', 'Repeater'])),
      hasImages: Boolean(getFirstDefinedValue(ticket, ['hasImages', 'hasImage']) ?? (Number(getFirstDefinedValue(ticket, ['imageCount']) ?? 0) > 0)),
      imageUrl: (() => {
        if (Array.isArray(ticket.images) && ticket.images.length > 0) {
          return ticket.images[0].imageUrl || ticket.images[0].fileName || undefined;
        }
        return getFirstDefinedValue(ticket, ['imageUrl', 'photo', 'image']) || undefined;
      })(),
      assignedBy: this.resolveUserName(getFirstDefinedValue(ticket, ['assignedBy', 'assignedByName', 'assignedById'])),
      assignedTo: this.resolveUserName(getFirstDefinedValue(ticket, ['assignedTo', 'assignedToName', 'assignedToId'])),
    };
  }

  // Station label map reused from vehicle-station-tracker report
  private static readonly STATION_LABELS: Record<string, string> = {
    station01: '01 · Chassis Prep, AC Prep, Fire Suppression, Engine Dress',
    station02: '02 · Modify Front End, Air Bags, Brake Lines & Fuel Lines',
    station03: '03 · Cab Cut Out, Frame Kickups, Rear Axle, Bike Racks',
    station04: '04 · RR Frame & Shelling, Birdcage, Ramp Support',
    station05: '05 · Air Lines, Exhaust, Drive Shafts, Brake Lines, Rough Electric',
    station06: '06 · Floor, Rear Wall, Roof, AC Mount, Hatches, Electrical',
    station07: '07 · Floor Prep, Hoses, Electrical, Mirror Harness',
    station08: '08 · Polyurea Spray',
    station09: '09 · Front Cap & Seal, Ext Lights, Electrical Upstairs, Fiberglass',
    station10: '10 · Interior Electrical, Ramps',
    station11: '11 · Electrical Console, Interior Lights, Warning Buzzer, Mirrors',
    station12: '12 · Stanchions, Transitions, Speakers, Windows',
    station13: '13 · Test, Bike Racks, Luggage Racks',
    station14: '14 · Seats, Entry Door',
    station15: '15 · ABS Plastics, Exterior Finish, Fire Suppression',
    station16: '16 · Underbody, Vacuum, Coolant, Headlights',
    station17: '17 · Drys Box, Rub Rails, Clean & Detail',
    station18: '18 · Alignment, Leak Down Test',
    station19: '19 · Post Road Test Bay',
    station20: '20 · Inspector Testing & PDI',
    station21: '21 · Recuperation',
    station22: '22 · Nova Bus Finishing Area',
    station23: '23 · Nova Bus Coach Tester Inspection',
    station24: '24 · Coach Tester Road Test, Inspection & Painting',
    station25: '25 · Coach Tester Water Test, Repairs after Road Test',
    station26: '26 · Cleaning & Washing Before Presenting',
    station27: '27 · Station 27',
    station28: '28 · Station 28',
    station29: '29 · Shipped to Client',
  };

  private buildTimelineFromStationTrackers(trackers: any[]): TimelineEvent[] {
    if (!trackers.length) return [];

    const stationKeys = Object.keys(VehicleViewComponent.STATION_LABELS);
    const events: TimelineEvent[] = [];

    for (const tracker of trackers) {
      const stationName = toOptionalText(getFirstDefinedValue(tracker, [
        'stationName', 'StationName', 'stageName', 'stage', 'station',
      ]));
      const user = this.resolveUserName(
        getFirstDefinedValue(tracker, ['userName', 'UserName', 'inspectorName', 'assignedTo', 'userId', 'UserId']),
      );
      const statusRaw = toText(getFirstDefinedValue(tracker, [
        'status', 'stageStatus', 'statusName',
      ]), 'Completed');

      if (stationName) {
        // API returns one record per station event
        const stationNumber = toOptionalText(getFirstDefinedValue(tracker, ['stationNumber', 'StationNumber']));
        const stationTypeName = toOptionalText(getFirstDefinedValue(tracker, ['stationTypeName', 'StationTypeName']));
        const descriptionRaw = toOptionalText(getFirstDefinedValue(tracker, ['description', 'Description']));

        const startRaw = toOptionalText(getFirstDefinedValue(tracker, ['startDate', 'StartDate']));
        const endRaw = toOptionalText(getFirstDefinedValue(tracker, ['endDate', 'EndDate']));
        const startDate = this.formatDate(startRaw);
        const endDate = this.formatDate(endRaw);

        const label = stationNumber
          ? `${stationNumber} · ${stationName}`
          : stationName;

        const descParts = [stationTypeName, descriptionRaw].filter(Boolean);

        events.push({
          date: startDate ?? endDate ?? '-',
          event: label,
          user,
          icon: 'ti-map-pin',
          color: '#26bf94',
          status: statusRaw,
          startDate,
          endDate,
          description: descParts.join(' — ') || undefined,
        });
      } else {
        // API returns one record per vehicle with station01–29 fields
        const startRaw = toOptionalText(getFirstDefinedValue(tracker, [
          'startDate', 'StartDate', 'createdDate',
        ]));
        const globalStart = this.formatDate(startRaw);

        for (const key of stationKeys) {
          const value = toOptionalText(tracker[key]);
          if (!value) continue;
          const endDate = this.formatDate(value) ?? value;
          events.push({
            date: globalStart ?? endDate,
            event: VehicleViewComponent.STATION_LABELS[key],
            user: toText(getFirstDefinedValue(tracker, ['inspector', 'inspectorName', 'userName']), '-'),
            icon: 'ti-map-pin',
            color: '#26bf94',
            status: 'Completed',
            startDate: globalStart ?? undefined,
            endDate,
          });
        }
      }
    }

    return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private formatDate(raw: string | null | undefined): string | undefined {
    if (!raw) return undefined;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString();
  }

  private buildTimelineFromTickets(tickets: any[]): TimelineEvent[] {
    const mapped = tickets
      .map((ticket) => {
        const dateRaw = toOptionalText(getFirstDefinedValue(ticket, ['createdDate', 'dateCreated', 'openedDate']));
        const eventDate = dateRaw ? new Date(dateRaw) : null;
        const eventTitle = toText(getFirstDefinedValue(ticket, ['ticketNumber', 'id']), 'Ticket');
        const status = toText(getFirstDefinedValue(ticket, ['status', 'ticketStatus']), 'Open');

        return {
          date: eventDate && !Number.isNaN(eventDate.getTime()) ? eventDate.toLocaleDateString() : '-',
          time: eventDate && !Number.isNaN(eventDate.getTime()) ? eventDate.toLocaleTimeString() : '-',
          event: `Ticket ${eventTitle}`,
          user: toText(getFirstDefinedValue(ticket, ['assignedToName', 'assignedTo', 'createdByName']), 'System'),
          icon: 'ticket',
          color: '#23b7e5',
          status,
          description: toText(getFirstDefinedValue(ticket, ['description', 'defectType']), ''),
        } as TimelineEvent;
      })
      .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());

    return mapped;
  }

  /**
   * Setup photo gallery
   */
  private setupGallery(): void {
    if (!this.vehicle) return;

    this.galleryImages = [
      { url: this.vehicle.images.front, label: 'Front View' },
      { url: this.vehicle.images.back, label: 'Back View' },
      { url: this.vehicle.images.left, label: 'Left Side' },
      { url: this.vehicle.images.right, label: 'Right Side' },
      { url: this.vehicle.images.interior, label: 'Interior' }
    ];
    
    this.selectedImage = this.galleryImages[0].url;
  }

  /**
   * Initialize ApexCharts configurations
   */
  private initializeCharts(): void {
    if (!this.vehicle) return;

    // Snag by Area Chart (Treemap-style using Bar chart)
    this.snagByAreaChart = {
      series: [{
        data: this.vehicle.defects.map(d => d.count)
      }],
      chart: {
        type: 'bar',
        height: 320,
        toolbar: { show: false }
      },
      plotOptions: {
        bar: {
          borderRadius: 3,
          horizontal: true,
          distributed: true,
          dataLabels: { position: 'bottom' }
        }
      },
      colors: ['#845adf', '#23b7e5', '#f5b849', '#49b6f5', '#26bf94', '#e6533c'],
      dataLabels: {
        enabled: true,
        textAnchor: 'start',
        style: {
          colors: ['#fff'],
          fontSize: '11px'
        },
        formatter: function (val: any, opt: any) {
          return opt.w.globals.labels[opt.dataPointIndex] + ": " + val;
        },
        offsetX: 0
      },
      xaxis: {
        categories: this.vehicle.defects.map(d => d.area)
      },
      yaxis: {
        labels: { show: false }
      },
      tooltip: {
        theme: 'dark',
        x: { show: false },
        y: {
          title: {
            formatter: function () {
              return 'Defects:';
            }
          }
        }
      }
    };

    // Defect Severity Gauge
    const totalDefects = this.vehicle.defects.reduce((sum, d) => sum + d.count, 0);
    this.defectSeverityChart = {
      series: [totalDefects],
      chart: {
        type: 'radialBar',
        height: 220
      },
      plotOptions: {
        radialBar: {
          hollow: {
            size: '55%'
          },
          dataLabels: {
            name: {
              fontSize: '14px',
              color: '#6c757d'
            },
            value: {
              fontSize: '26px',
              fontWeight: 'bold',
              color: '#845adf'
            }
          }
        }
      },
      labels: ['Total Defects'],
      colors: ['#845adf']
    };
  }

  /**
   * Select image in gallery
   * @param image Image URL
   */
  selectImage(image: string): void {
    this.selectedImage = image;
  }

  /**
   * Get CSS class for ticket priority badge
   */
  getTicketPriorityClass(priority: string): string {
    return this.vehicleUtil.getTicketPriorityClass(priority as any);
  }

  /**
   * Get CSS class for ticket status badge
   */
  getTicketStatusClass(status: string): string {
    return this.vehicleUtil.getTicketStatusClass(status as any);
  }

  /**
   * Get CSS class for severity badge
   */
  getSeverityBadgeClass(severity: string): string {
    return this.vehicleUtil.getSeverityBadgeClass(severity as any);
  }

  /**
   * Get total number of defects
   */
  getTotalDefects(): number {
    if (!this.vehicle) return 0;
    return this.vehicle.defects.reduce((sum, d) => sum + d.count, 0);
  }

  /**
   * Smooth scroll to a section
   * @param sectionId - The ID of the section to scroll to
   */
  scrollToSection(sectionId: string): void {
    const element = document.getElementById(sectionId);
    if (element) {
      const offset = 80; // Account for fixed header
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  }

  private buildInspectorTicketsChart(): void {
    if (!this.vehicle || !this.vehicle.assignments.length) return;

    const palette = ['#845adf', '#23b7e5', '#f5b849', '#26bf94', '#e6533c', '#49b6f5', '#fd7e14'];
    const assignments = this.vehicle.assignments;
    const ticketCounts = assignments.map(a =>
      this.vehicle!.tickets.filter(t => t.assignedTo === a.inspectorName || t.assignedBy === a.inspectorName).length
    );
    const maxCount = Math.max(...ticketCounts, 1);
    const series = ticketCounts.map(c => Math.round((c / maxCount) * 100));
    const labels = assignments.map(a => a.inspectorName);
    const totalTickets = ticketCounts.reduce((a, b) => a + b, 0);

    this.inspectorTicketsChart = {
      series,
      chart: { type: 'radialBar', height: 260, toolbar: { show: false }, sparkline: { enabled: false } },
      plotOptions: {
        radialBar: {
          offsetY: 10,
          startAngle: -135,
          endAngle: 135,
          hollow: { margin: 4, size: '20%', background: 'transparent' },
          track: { show: true, background: 'rgba(132,90,223,0.08)', strokeWidth: '75%', margin: 4 },
          dataLabels: {
            name: { fontSize: '13px', fontWeight: '600' },
            value: {
              fontSize: '12px',
              formatter: ((val: number, opts: any) => {
                const idx = opts?.seriesIndex ?? opts?.dataPointIndex;
                if (idx != null && ticketCounts[idx] != null) {
                  return String(ticketCounts[idx]);
                }
                // Fallback: reverse the percentage back to ticket count
                return String(Math.round((val / 100) * maxCount));
              }) as any,
            },
            total: {
              show: true,
              label: 'Total',
              formatter: () => String(totalTickets),
            },
          },
        },
      },
      colors: palette.slice(0, labels.length),
      labels,
      tooltip: { enabled: false },
      legend: { show: false },
      responsive: [],
    };
  }

  /**
   * Export vehicle report
   * TODO: Implement actual export functionality
   */
  exportReport(): void {
    console.log('Exporting report for vehicle:', this.vehicleId);
    alert('Exporting vehicle report...');
    // TODO: Implement PDF/Excel export
  }
}
