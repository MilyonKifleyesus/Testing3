import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, map, of, take } from 'rxjs';
import { Vehicle, VehicleFilter } from './models/vehicle.model';
import { VehicleUtilService } from './services/vehicle-util.service';
import { ClientDashboardService } from '../../services/client-dashboard.service';
import { AuthService } from '../../services/auth.service';
import { resolveProjectManagementContext } from '../project-management/project-management-context';
import { extractArrayFromApiResponse, getFirstDefinedValue, toOptionalText, toText } from '../../utils/api-data.utils';

/**
 * Vehicle List Component
 * 
 * @description
 * Displays a searchable and filterable list of all vehicles in the fleet.
 * Features include:
 * - Real-time search across fleet number, VIN, make, and model
 * - Client and propulsion type filtering
 * - Status indicators
 * - Quick actions (View, Edit, Delete)
 * 
 * @example
 * <app-vehicle-list></app-vehicle-list>
 */
@Component({
  selector: 'app-vehicle-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './vehicle-list.component.html',
  styleUrl: './vehicle-list.component.scss'
})
export class VehicleListComponent implements OnInit {
  /** All vehicles from the service */
  vehicles: Vehicle[] = [];
  
  /** Filtered vehicles based on current criteria */
  filteredVehicles: Vehicle[] = [];
  
  /** Current search term */
  searchTerm: string = '';
  
  /** Selected client filter */
  selectedClient: string = 'all';
  
  /** Selected propulsion filter */
  selectedPropulsion: string = 'all';
  
  /** Available clients */
  clients: string[] = [];
  
  /** Available propulsion types */
  propulsionTypes: string[] = [];

  readonly portalPrefix: '/admin' | '/client';
  readonly scopedClientId: string | null;

  get vehicleViewPathPrefix(): string {
    return `${this.portalPrefix}/vehicles/view`;
  }

  constructor(
    public vehicleUtil: VehicleUtilService,
    private readonly clientDashboardService: ClientDashboardService,
    private readonly authService: AuthService,
    private readonly route: ActivatedRoute,
  ) {
    const context = resolveProjectManagementContext(
      this.authService.currentUserValue,
      this.route.snapshot.queryParamMap.get('clientId'),
    );

    this.portalPrefix = context.portalPrefix;
    this.scopedClientId = context.scopedClientId;
  }

  ngOnInit(): void {
    this.loadVehicles();
  }

  /**
   * Load vehicles from API
   */
  private loadVehicles(): void {
    const scopedClientId = Number(this.scopedClientId);
    const requestParams: { clientId?: number; page: number; pageSize: number } = {
      page: 1,
      pageSize: 5000,
      ...(Number.isFinite(scopedClientId) && scopedClientId > 0 ? { clientId: scopedClientId } : {}),
    };

    this.clientDashboardService
      .getVehicles(requestParams)
      .pipe(
        map((response) => extractArrayFromApiResponse(response)),
        map((items) =>
          items
            .map((item, index) => this.mapVehicle(item, index))
            .filter((vehicle): vehicle is Vehicle => vehicle !== null),
        ),
        catchError((error) => {
          console.error('Failed to load vehicles:', error);
          return of([] as Vehicle[]);
        }),
        take(1),
      )
      .subscribe((vehicles) => {
        this.vehicles = vehicles;
        this.filteredVehicles = [...vehicles];
        this.loadFilterOptions();
      });
  }

  /**
   * Load filter dropdown options
   */
  private loadFilterOptions(): void {
    this.clients = Array.from(
      new Set(
        this.vehicles
          .map((vehicle) => vehicle.client)
          .filter((client) => Boolean(client && client.trim())),
      ),
    ).sort((left, right) => left.localeCompare(right));

    this.propulsionTypes = Array.from(
      new Set(
        this.vehicles
          .map((vehicle) => vehicle.propulsion)
          .filter((propulsion) => Boolean(propulsion && propulsion.trim())),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }

  private mapVehicle(raw: any, index: number): Vehicle | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const idValue = getFirstDefinedValue(raw, ['id', 'vehicleId', 'vehicle_id']);
    const numericId = Number(idValue);
    const resolvedId = Number.isFinite(numericId) && numericId > 0 ? numericId : index + 1;

    return {
      id: resolvedId,
      client: toText(getFirstDefinedValue(raw, ['clientName', 'client', 'customerName']), 'Unknown Client'),
      fleetNumber: toText(
        getFirstDefinedValue(raw, ['fleetNumber', 'fleetNo', 'vehicleNumber', 'unitNumber', 'name']),
        `Vehicle-${resolvedId}`,
      ),
      make: toText(getFirstDefinedValue(raw, ['make', 'manufacturer', 'brand']), '-'),
      model: toText(getFirstDefinedValue(raw, ['model', 'vehicleModel', 'type']), '-'),
      vin: toText(getFirstDefinedValue(raw, ['vin', 'VIN', 'vehicleVin', 'chassisNumber']), '-'),
      mileageType: toText(getFirstDefinedValue(raw, ['mileageType', 'odometerUnit']), 'Kilometres'),
      propulsion: toText(getFirstDefinedValue(raw, ['propulsion', 'propulsionType', 'fuelType']), '-'),
      status: this.normalizeVehicleStatus(getFirstDefinedValue(raw, ['status', 'inspectionStatus', 'vehicleStatus'])),
      imageUrl: toText(getFirstDefinedValue(raw, ['imageUrl', 'image', 'photoUrl']), ''),
      inspectionDate: toOptionalText(
        getFirstDefinedValue(raw, ['inspectionDate', 'lastInspectionDate', 'date']),
      ),
      inspector: toOptionalText(
        getFirstDefinedValue(raw, ['inspector', 'inspectorName', 'inspector.name', 'assignedInspector']),
      ),
    };
  }

  private normalizeVehicleStatus(value: unknown): Vehicle['status'] {
    const normalized = String(value ?? '').toLowerCase().trim();
    if (normalized === 'completed' || normalized === 'closed' || normalized === 'resolved' || normalized === 'done') {
      return 'completed';
    }
    if (normalized === 'in-progress' || normalized === 'in progress' || normalized === 'active') {
      return 'in-progress';
    }
    return 'pending';
  }


  /**
   * Apply filters to vehicle list
   */
  filterVehicles(): void {
    this.filteredVehicles = this.vehicles.filter(vehicle => {
      const matchesSearch = !this.searchTerm ||
        vehicle.fleetNumber.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        vehicle.vin.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        vehicle.make.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        vehicle.model.toLowerCase().includes(this.searchTerm.toLowerCase());
      
      const matchesClient = this.selectedClient === 'all' || vehicle.client.toLowerCase() === this.selectedClient.toLowerCase();
      const matchesPropulsion = this.selectedPropulsion === 'all' || vehicle.propulsion.toLowerCase() === this.selectedPropulsion.toLowerCase();
      
      return matchesSearch && matchesClient && matchesPropulsion;
    });
  }

  /**
   * Get CSS class for vehicle status badge
   */
  getStatusClass(status: string): string {
    return this.vehicleUtil.getStatusBadgeClass(status as any);
  }

  /**
   * Get icon for vehicle status
   */
  getStatusIcon(status: string): string {
    return this.vehicleUtil.getStatusIcon(status as any);
  }

  /**
   * Get inspector name from string or Inspector object
   */
  getInspectorName(inspector: string | any): string {
    return typeof inspector === 'string' ? inspector : (inspector?.name || 'Unknown');
  }

  /**
   * Get inspector initial letter
   */
  getInspectorInitial(inspector: string | any): string {
    const name = this.getInspectorName(inspector);
    return name.charAt(0).toUpperCase();
  }
}
