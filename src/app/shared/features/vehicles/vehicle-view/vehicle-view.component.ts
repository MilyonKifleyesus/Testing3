import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { VehicleDetail, GalleryImage, TimelineEvent } from '../models/vehicle.model';
import { VehicleUtilService } from '../services/vehicle-util.service';
import { ClientDashboardService } from '../../../services/client-dashboard.service';
import { catchError, map, of, take } from 'rxjs';
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
  imports: [CommonModule, RouterModule, NgApexchartsModule],
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
  
  /** Currently selected image in gallery */
  selectedImage: string = '';
  
  /** Gallery images collection */
  galleryImages: GalleryImage[] = [];

  /** Timeline events */
  timeline: TimelineEvent[] = [];

  isLoading: boolean = false;
  errorMessage: string = '';

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

  public PAGINATION_ELLIPSIS = PAGINATION_ELLIPSIS;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly authService: AuthService,
    public vehicleUtil: VehicleUtilService,
    private readonly clientDashboardService: ClientDashboardService,
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

    this.clientDashboardService
      .getVehicles({ page: 1, pageSize: 10000 })
      .pipe(
        map((response) => extractArrayFromApiResponse(response)),
        map((vehicles) =>
          vehicles.find((item) => {
            const id = Number(getFirstDefinedValue(item, ['id', 'vehicleId', 'vehicleID', 'VehicleId', 'vehicle.id']) ?? 0);
            return Number.isFinite(id) && id === this.vehicleId;
          }),
        ),
        catchError((error) => {
          console.error('Failed to load vehicle detail:', error);
          this.errorMessage = 'Failed to load vehicle details.';
          return of(undefined);
        }),
        take(1),
      )
      .subscribe((item) => {
        if (!item) {
          this.vehicle = null;
          this.timeline = [];
          this.galleryImages = [];
          this.selectedImage = '';
          this.isLoading = false;
          this.errorMessage = this.errorMessage || 'Vehicle not found.';
          return;
        }

        this.vehicle = this.mapVehicleDetail(item);
        this.totalPages = Math.ceil((this.vehicle?.tickets?.length || 0) / this.pageSize);
        this.currentPage = 1;
        this.updatePagination();
        this.timeline = this.vehicle.timeline || [];
        this.galleryImages = this.vehicle.images.gallery || [];
        this.selectedImage = this.galleryImages.length ? this.galleryImages[0].url : '';
        this.isLoading = false;
      });
  }

  updatePagination(): void {
    if (!this.vehicle || !this.vehicle.tickets) {
      this.paginatedTickets = [];
      this.paginationItems = [];
      return;
    }
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.paginatedTickets = this.vehicle.tickets.slice(start, end);
    this.totalPages = Math.ceil(this.vehicle.tickets.length / this.pageSize);
    this.paginationItems = buildPaginationItems(this.totalPages, this.currentPage);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === PAGINATION_ELLIPSIS) return;
    this.currentPage = page;
    this.updatePagination();
  }

  private loadVehicleTickets(): void {
    this.clientDashboardService
      .getTickets({ vehicleId: this.vehicleId, page: 1, pageSize: 5000 })
      .pipe(
        map((response) => extractArrayFromApiResponse(response)),
        catchError((error) => {
          console.error('Failed to load vehicle tickets:', error);
          return of([] as any[]);
        }),
        take(1),
      )
      .subscribe((tickets) => {
        if (!this.vehicle) {
          this.isLoading = false;
          return;
        }

        const mappedTickets = tickets.map((ticket, index) => this.mapTicket(ticket, index));
        this.vehicle = {
          ...this.vehicle,
          tickets: mappedTickets,
        };

        this.timeline = this.buildTimelineFromTickets(tickets);
        this.initializeCharts();
        this.isLoading = false;
      });
  }

  private mapVehicleDetail(item: any): VehicleDetail {
    const fleetNumber = toText(
      getFirstDefinedValue(item, ['fleetNumber', 'vehicleNumber', 'unitNumber', 'FleetNumber', 'VehicleNumber']),
      `Vehicle-${this.vehicleId}`,
    );
    const inspectionDate = toText(
      getFirstDefinedValue(item, ['inspectionDate', 'updatedDate', 'createdDate', 'lastInspectionDate']),
      '-',
    );

    return {
      id: this.vehicleId,
      client: toText(getFirstDefinedValue(item, ['clientName', 'client', 'customerName']), '-'),
      fleetNumber,
      make: toText(getFirstDefinedValue(item, ['make', 'manufacturer', 'makeName']), '-'),
      model: toText(getFirstDefinedValue(item, ['model', 'modelValue', 'vehicleModel']), '-'),
      vin: toText(getFirstDefinedValue(item, ['vin', 'VIN']), '-'),
      mileageType: toText(getFirstDefinedValue(item, ['mileageType', 'distanceUnit']), 'miles'),
      propulsion: toText(getFirstDefinedValue(item, ['propulsionTypeName', 'propulsion', 'fuelType']), '-'),
      status: 'completed',
      imageUrl: toText(getFirstDefinedValue(item, ['imageUrl', 'photo', 'vehicleImage']), this.defaultVehicleImage),
      inspectionDate,
      frameNumber: toText(getFirstDefinedValue(item, ['frameNumber', 'frameNo']), '-'),
      year: Number(getFirstDefinedValue(item, ['year', 'modelYear']) ?? new Date().getFullYear()),
      color: toText(getFirstDefinedValue(item, ['color', 'vehicleColor']), '-'),
      licensePlate: toText(getFirstDefinedValue(item, ['licensePlate', 'plateNumber']), '-'),
      inspector: {
        name: toText(getFirstDefinedValue(item, ['inspector', 'inspectorName', 'assignedInspector']), '-'),
        email: toText(getFirstDefinedValue(item, ['inspectorEmail', 'email']), '-'),
        avatar: toText(getFirstDefinedValue(item, ['inspectorAvatar', 'avatar']), this.defaultAvatar),
      },
      shippingDetail: {
        frontCurb: toText(getFirstDefinedValue(item, ['frontCurb', 'shippingAddress', 'shipFrom']), '-'),
        backStreet: toText(getFirstDefinedValue(item, ['backStreet', 'deliveryAddress', 'shipTo']), '-'),
      },
      media: {
        interiorVideo: toText(getFirstDefinedValue(item, ['interiorVideo']), ''),
        exteriorVideo: toText(getFirstDefinedValue(item, ['exteriorVideo']), ''),
      },
      images: {
        front: toText(getFirstDefinedValue(item, ['images.front', 'frontImage', 'photo']), this.defaultVehicleImage),
        back: toText(getFirstDefinedValue(item, ['images.back', 'rearImage', 'photo']), this.defaultVehicleImage),
        left: toText(getFirstDefinedValue(item, ['images.left', 'leftImage', 'photo']), this.defaultVehicleImage),
        right: toText(getFirstDefinedValue(item, ['images.right', 'rightImage', 'photo']), this.defaultVehicleImage),
        interior: toText(getFirstDefinedValue(item, ['images.interior', 'interiorImage', 'photo']), this.defaultVehicleImage),
      },
      inspectionData: {
        date: inspectionDate,
        duration: toText(getFirstDefinedValue(item, ['inspectionDuration', 'duration']), '-'),
        mileage: Number(getFirstDefinedValue(item, ['mileage', 'odometer']) ?? 0),
      },
      defects: [],
      tickets: [],
      snags: [],
      timeline: [],
    };
  }

  private mapTicket(ticket: any, index: number): any {
    const id = toText(getFirstDefinedValue(ticket, ['ticketNumber', 'id', 'ticketId']), String(index + 1));
    const status = toText(getFirstDefinedValue(ticket, ['status', 'ticketStatus']), 'open').toLowerCase();
    const priority = toText(getFirstDefinedValue(ticket, ['priority', 'severity']), 'low').toLowerCase();

    return {
      id,
      title: toText(getFirstDefinedValue(ticket, ['title', 'description', 'defectType']), 'Ticket'),
      priority: priority === 'high' || priority === 'medium' || priority === 'low' ? priority : 'low',
      status: status === 'open' || status === 'in-progress' || status === 'resolved' || status === 'closed' ? status : 'open',
      createdDate: toText(getFirstDefinedValue(ticket, ['createdDate', 'dateCreated', 'openedDate']), '-'),
    };
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
