import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, map, of, switchMap, take } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { ProjectService } from '../../../services/project.service';
import { Project } from '../../../models/project.model';
import { ClientService } from '../../../services/client.service';
import { resolveProjectManagementContext } from '../project-management-context';
import { ClientDashboardService } from '../../../services/client-dashboard.service';
import { extractArrayFromApiResponse, getFirstDefinedValue, toOptionalText, toText } from '../../../utils/api-data.utils';

interface ProjectVehicle {
  id: number;
  fleetNumber: string;
  make: string;
  model: string;
  vin: string;
  propulsion: string;
  status: 'completed' | 'in-progress' | 'pending' | 'failed';
  inspector: string;
  inspectorAvatar?: string;
  inspectionDate?: string;
  imageUrl?: string;
  progress: number;
}

@Component({
  selector: 'app-project-view',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './project-view.component.html',
  styleUrls: ['./project-view.component.scss']
})
export class ProjectViewComponent implements OnInit {
  projectId: string | null = null;

  project = {
    client: '-',
    name: '-',
    contract: '-',
    location: '-',
    type: '-',
    hasRoadTest: false,
    status: 'Active' as 'Active' | 'Closed'
  };

  tabs = [
    { key: 'project', label: 'Project' },
    { key: 'vehicles', label: 'Vehicles' },
    { key: 'inspection-categories', label: 'Inspection Categories' },
    { key: 'inspection-tasks', label: 'Inspection Tasks' },
    { key: 'files', label: 'Files' }
  ];
  activeTab = 'project';

  vehicleViewMode: 'grid' | 'table' = 'grid';
  projectVehicles: ProjectVehicle[] = [];
  filteredProjectVehicles: ProjectVehicle[] = [];

  readonly portalPrefix: '/admin' | '/client';
  readonly scopedClientId: string | null;

  vehicleFilters = {
    search: '',
    status: '',
    propulsion: '',
    inspector: ''
  };

  get canManageProjects(): boolean {
    return this.portalPrefix === '/admin';
  }

  get vehicleViewPathPrefix(): string {
    return `${this.portalPrefix}/vehicles/view`;
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly authService: AuthService,
    private readonly projectService: ProjectService,
    private readonly clientService: ClientService,
    private readonly clientDashboardService: ClientDashboardService,
  ) {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.projectId = idParam ? String(idParam) : null;

    const context = resolveProjectManagementContext(
      this.authService.currentUserValue,
      this.route.snapshot.queryParamMap.get('clientId'),
    );

    this.portalPrefix = context.portalPrefix;
    this.scopedClientId = context.scopedClientId;
  }

  ngOnInit(): void {
    this.loadProjectDetails();
    this.loadProjectVehicles();
  }

  private loadProjectDetails(): void {
    if (!this.projectId) return;

    this.projectService
      .getProjectById(this.projectId)
      .pipe(
        switchMap((projectById) => {
          if (projectById && this.isProjectInScope(projectById)) {
            this.project = this.mapProjectForView(projectById);
            return of([] as Project[]);
          }

          const filters = this.scopedClientId ? { clientId: this.scopedClientId } : {};
          return this.projectService.getProjectsWithRefresh(filters);
        }),
      )
      .pipe(take(1))
      .subscribe((projects) => {
        if (!Array.isArray(projects)) return;

        const selectedProject = projects.find(
          (project) => String(project.id) === this.projectId,
        );

        if (!selectedProject || !this.isProjectInScope(selectedProject)) return;
        this.project = this.mapProjectForView(selectedProject);
      });
  }

  private isProjectInScope(project: Project): boolean {
    if (!this.scopedClientId) {
      return true;
    }
    return String(project.clientId ?? '').trim() === this.scopedClientId;
  }

  private mapProjectForView(project: Project): {
    client: string;
    name: string;
    contract: string;
    location: string;
    type: string;
    hasRoadTest: boolean;
    status: 'Active' | 'Closed';
  } {
    const normalizedStatus: 'Active' | 'Closed' = project.status === 'Closed' ? 'Closed' : 'Active';
    const resolvedClientName = this.clientService.resolveClientName(
      project.clientId,
      project.clientName ?? '-',
    );

    return {
      client: resolvedClientName || '-',
      name: project.projectName?.trim() ? project.projectName : '-',
      contract: project.contract?.trim() ? project.contract : '-',
      location: project.location ?? project.manufacturerLocationId ?? '-',
      type: project.assessmentType?.trim() ? project.assessmentType : '-',
      hasRoadTest: false,
      status: normalizedStatus,
    };
  }

  private loadProjectVehicles(): void {
    const parsedProjectId = Number(this.projectId);
    if (!Number.isFinite(parsedProjectId) || parsedProjectId <= 0) {
      this.projectVehicles = [];
      this.filteredProjectVehicles = [];
      return;
    }

    const scopedClientId = Number(this.scopedClientId);
    const requestParams: { clientId?: number; page: number; pageSize: number } = {
      page: 1,
      pageSize: 5000,
      ...(Number.isFinite(scopedClientId) && scopedClientId > 0 ? { clientId: scopedClientId } : {}),
    };

    this.clientDashboardService
      .getProjectVehicles(parsedProjectId, requestParams)
      .pipe(
        map((response) => extractArrayFromApiResponse(response)),
        map((items) =>
          items
            .map((item, index) => this.mapProjectVehicle(item, index))
            .filter((vehicle): vehicle is ProjectVehicle => vehicle !== null),
        ),
        catchError((error) => {
          console.error('Failed to load project vehicles:', error);
          return of([] as ProjectVehicle[]);
        }),
        take(1),
      )
      .subscribe((vehicles) => {
        this.projectVehicles = vehicles;
        this.filterVehicles();
      });
  }

  private mapProjectVehicle(raw: any, index: number): ProjectVehicle | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const idValue = getFirstDefinedValue(raw, ['id', 'vehicleId', 'vehicle_id']);
    const numericId = Number(idValue);
    const resolvedId = Number.isFinite(numericId) && numericId > 0 ? numericId : index + 1;

    const fleetNumber = toText(
      getFirstDefinedValue(raw, ['fleetNumber', 'fleetNo', 'vehicleNumber', 'unitNumber', 'name', 'title']),
      `Vehicle-${resolvedId}`,
    );

    const status = this.normalizeVehicleStatus(
      getFirstDefinedValue(raw, ['status', 'inspectionStatus', 'vehicleStatus']),
    );

    const progressValue = Number(getFirstDefinedValue(raw, ['progress', 'completion', 'completionPercentage']));
    const progress =
      Number.isFinite(progressValue)
        ? Math.max(0, Math.min(100, progressValue))
        : status === 'completed'
          ? 100
          : status === 'in-progress'
            ? 50
            : 0;

    const inspector = toText(
      getFirstDefinedValue(raw, [
        'inspector',
        'inspectorName',
        'inspector.name',
        'assignedInspector',
        'technician',
        'technicianName',
      ]),
      'Unassigned',
    );

    return {
      id: resolvedId,
      fleetNumber,
      make: toText(getFirstDefinedValue(raw, ['make', 'manufacturer', 'brand']), '-'),
      model: toText(getFirstDefinedValue(raw, ['model', 'vehicleModel', 'type']), '-'),
      vin: toText(getFirstDefinedValue(raw, ['vin', 'VIN', 'vehicleVin', 'chassisNumber']), '-'),
      propulsion: toText(
        getFirstDefinedValue(raw, ['propulsion', 'propulsionType', 'fuelType', 'engineType']),
        '-',
      ),
      status,
      inspector,
      inspectorAvatar: toOptionalText(
        getFirstDefinedValue(raw, ['inspectorAvatar', 'inspector.avatar', 'assignedInspectorAvatar']),
      ),
      inspectionDate: toOptionalText(getFirstDefinedValue(raw, ['inspectionDate', 'date', 'lastInspectionDate'])),
      imageUrl: toOptionalText(getFirstDefinedValue(raw, ['imageUrl', 'image', 'photoUrl'])),
      progress,
    };
  }

  private normalizeVehicleStatus(value: unknown): ProjectVehicle['status'] {
    const normalized = String(value ?? '').toLowerCase().trim();
    if (normalized === 'completed' || normalized === 'closed' || normalized === 'done') {
      return 'completed';
    }
    if (normalized === 'in-progress' || normalized === 'in progress' || normalized === 'active') {
      return 'in-progress';
    }
    if (normalized === 'failed' || normalized === 'rejected') {
      return 'failed';
    }
    return 'pending';
  }


  setTab(tabKey: string): void {
    this.activeTab = tabKey;
  }

  toggleVehicleView(): void {
    this.vehicleViewMode = this.vehicleViewMode === 'grid' ? 'table' : 'grid';
  }

  filterVehicles(): void {
    this.filteredProjectVehicles = this.projectVehicles.filter((vehicle) => {
      const matchesSearch = !this.vehicleFilters.search ||
        vehicle.vin.toLowerCase().includes(this.vehicleFilters.search.toLowerCase()) ||
        vehicle.fleetNumber.toLowerCase().includes(this.vehicleFilters.search.toLowerCase()) ||
        `${vehicle.make} ${vehicle.model}`.toLowerCase().includes(this.vehicleFilters.search.toLowerCase());

      const matchesStatus = !this.vehicleFilters.status || vehicle.status === this.vehicleFilters.status;
      const matchesPropulsion = !this.vehicleFilters.propulsion || vehicle.propulsion === this.vehicleFilters.propulsion;
      const matchesInspector = !this.vehicleFilters.inspector || vehicle.inspector === this.vehicleFilters.inspector;

      return matchesSearch && matchesStatus && matchesPropulsion && matchesInspector;
    });
  }

  resetFilters(): void {
    this.vehicleFilters = {
      search: '',
      status: '',
      propulsion: '',
      inspector: ''
    };
    this.filteredProjectVehicles = [...this.projectVehicles];
  }

  getVehiclesByStatus(status: string): ProjectVehicle[] {
    return this.projectVehicles.filter((vehicle) => vehicle.status === status);
  }

  getStatusBadgeClass(status: string): string {
    const classes: { [key: string]: string } = {
      completed: 'bg-success',
      'in-progress': 'bg-warning',
      pending: 'bg-info',
      failed: 'bg-danger'
    };
    return classes[status] || 'bg-secondary';
  }

  getProgressBarClass(progress: number): string {
    if (progress === 100) return 'bg-success';
    if (progress >= 50) return 'bg-warning';
    if (progress > 0) return 'bg-info';
    return 'bg-secondary';
  }

  addVehicle(): void {
    console.log('Add vehicle to project');
  }

  inspectVehicle(vehicleId: number): void {
    console.log('Start inspection for vehicle:', vehicleId);
  }

  removeVehicle(vehicleId: number): void {
    if (confirm('Are you sure you want to remove this vehicle from the project?')) {
      this.projectVehicles = this.projectVehicles.filter((vehicle) => vehicle.id !== vehicleId);
      this.filterVehicles();
    }
  }

  closeProject(): void {
    if (!this.canManageProjects || this.project.status === 'Closed') return;
    if (confirm('Are you sure you want to close this project?')) {
      this.project.status = 'Closed';
    }
  }

  editProject(): void {
    alert('Edit flow coming soon');
  }
}
