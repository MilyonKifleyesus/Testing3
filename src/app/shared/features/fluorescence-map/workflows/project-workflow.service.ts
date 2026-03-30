import { Injectable } from '@angular/core';
import { take } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { LocationService } from '../../../../shared/services/location.service';
import { ProjectService } from '../../../../shared/services/project.service';
import { WarRoomService } from '../../../../shared/services/fluorescence-map.service';
import { ToastrService } from 'ngx-toastr';
import { FactoryLocation, OperationalStatus, ProjectRoute, SubsidiaryCompany } from '../../../../shared/models/fluorescence-map.interface';
import { Project } from '../../../../shared/models/project.model';
import { FactoryEditPayload, SubsidiaryEditPayload } from '../fluorescence-map.types';
import {
  CLEAR_FILTERS_AFTER_ADD_DELAY_MS,
  FIT_MAP_AFTER_ADD_DELAY_MS,
  FIT_MAP_AFTER_ADD_RETRY_DELAY_MS,
} from '../fluorescence-map.constants';

interface ManufacturerRuntimeRecordLike {
  id: number;
  locationId?: number | null;
}

type ProjectCreateDraft = Omit<Project, 'id'> & {
  locationIds?: number[];
};

export interface ProjectWorkflowContext {
  factories(): FactoryLocation[];
  subsidiaries(): SubsidiaryCompany[];
  apiManufacturersSignal(): ManufacturerRuntimeRecordLike[];
  retryRequiredDataLoad(): void;
  projectRoutes(): ProjectRoute[];
  clearAllFilters(): void;
  setSelectedProjectId(value: string | null): void;
  mapFitBoundsToRoutes(routes: ProjectRoute[]): void;
  announce(message: string): void;
  closeModalAfterSuccess(): void;
  handleModalSuccess(message: string): void;
  handleModalError(message: string): void;
  waitForRouteThenCapture(projectId: string, projectName: string | undefined, initialDelayMs: number, pollIntervalMs: number, maxAttempts: number): void;
}

@Injectable({ providedIn: 'root' })
export class ProjectWorkflowService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly locationService: LocationService,
    private readonly warRoomService: WarRoomService,
    private readonly toastr: ToastrService
  ) {}

  private parseLocationParts(location: string): { city: string; country: string } {
    const parts = location.split(',').map((p) => p.trim());
    const city = parts[0] || '';
    let country = parts.length > 1 ? parts[parts.length - 1] : '';
    if (!country && parts.length === 1) country = 'Unknown';
    return { city, country };
  }

  private parseApiNumericId(value: string): number | null {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private getCoordinateFromPayloadOrFallback(
    payload: { coordinates?: { latitude: number; longitude: number } | null },
    fallbackLatitude: number | null | undefined,
    fallbackLongitude: number | null | undefined
  ): { latitude: number; longitude: number } {
    const latitudeCandidate = payload.coordinates?.latitude ?? fallbackLatitude;
    const longitudeCandidate = payload.coordinates?.longitude ?? fallbackLongitude;
    if (latitudeCandidate == null || longitudeCandidate == null) {
      throw new Error('Missing coordinates: provide coordinates or ensure fallback latitude/longitude are available.');
    }
    const latitude = Number(latitudeCandidate);
    const longitude = Number(longitudeCandidate);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error('Latitude must be between -90 and 90.');
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error('Longitude must be between -180 and 180.');
    }

    return { latitude, longitude };
  }

  private resolveLocationIdForSubsidiary(ctx: ProjectWorkflowContext, subsidiaryId: string): number | null {
    const manufacturerId = this.parseApiNumericId(subsidiaryId);
    if (manufacturerId == null) return null;

    const apiManufacturer = ctx.apiManufacturersSignal().find((mfr) => mfr.id === manufacturerId);
    const primaryLocationId = apiManufacturer?.locationId ?? null;
    if (primaryLocationId != null && Number.isFinite(primaryLocationId)) {
      return primaryLocationId;
    }

    const subsidiary = ctx.subsidiaries().find((item) => item.id === subsidiaryId);
    const fallbackFactory = subsidiary?.factories?.[0];
    return fallbackFactory ? this.parseApiNumericId(fallbackFactory.id) : null;
  }

  async persistFactoryUpdate(ctx: ProjectWorkflowContext, payload: FactoryEditPayload): Promise<void> {
    const locationId = this.parseApiNumericId(payload.factoryId);
    if (locationId == null) throw new Error(`Invalid location id "${payload.factoryId}".`);

    const name = payload.name.trim() || 'Unnamed Location';
    const location = payload.location.trim();
    const description = payload.description.trim();
    const locationParts = location ? this.parseLocationParts(location) : null;
    const existingFactory = ctx.factories().find((factory) => factory.id === payload.factoryId);
    const existingLocation = await firstValueFrom(this.locationService.getLocationById(locationId).pipe(take(1)));

    const { latitude, longitude } = this.getCoordinateFromPayloadOrFallback(
      payload,
      existingLocation?.latitude ?? existingFactory?.coordinates.latitude,
      existingLocation?.longitude ?? existingFactory?.coordinates.longitude
    );

    const updatedLocation = await firstValueFrom(
      this.locationService.updateLocation(locationId, { name, latitude, longitude }).pipe(take(1))
    );

    this.warRoomService.updateFactoryDetails(payload.factoryId, {
      name: updatedLocation.name,
      city: locationParts?.city ?? existingFactory?.city,
      country: locationParts?.country ?? existingFactory?.country,
      description,
      coordinates: { latitude: updatedLocation.latitude, longitude: updatedLocation.longitude },
      locationLabel: location || undefined,
      status: payload.status,
    });
  }

  async persistSubsidiaryUpdate(ctx: ProjectWorkflowContext, payload: SubsidiaryEditPayload): Promise<void> {
    const manufacturerId = this.parseApiNumericId(payload.subsidiaryId);
    if (manufacturerId == null) throw new Error(`Invalid manufacturer id "${payload.subsidiaryId}".`);

    const name = payload.name.trim() || 'Unnamed Company';
    const location = payload.location.trim();
    const description = payload.description.trim();

    const updatedManufacturer = await firstValueFrom(
      this.projectService.updateManufacturer(manufacturerId, { manufacturerName: name }).pipe(take(1))
    );
    if (!updatedManufacturer) throw new Error(`Manufacturer ${manufacturerId} was not found.`);

    const locationId = this.resolveLocationIdForSubsidiary(ctx, payload.subsidiaryId);
    if (locationId == null) throw new Error('No linked location id for manufacturer.');
    const existingLocation = await firstValueFrom(this.locationService.getLocationById(locationId).pipe(take(1)));
    const fallbackFactory = ctx.factories().find((factory) => factory.subsidiaryId === payload.subsidiaryId);
    const { latitude, longitude } = this.getCoordinateFromPayloadOrFallback(
      payload,
      existingLocation?.latitude ?? fallbackFactory?.coordinates.latitude,
      existingLocation?.longitude ?? fallbackFactory?.coordinates.longitude
    );

    await firstValueFrom(
      this.locationService
        .updateLocation(locationId, {
          name: location || existingLocation?.name || name,
          latitude,
          longitude,
        })
        .pipe(take(1))
    );

    this.warRoomService.updateSubsidiaryDetails(payload.subsidiaryId, {
      name: updatedManufacturer.manufacturerName || name,
      location: location || undefined,
      description: description || undefined,
      status: payload.status as OperationalStatus,
    });
  }

  async runBatchUpdate(
    ctx: ProjectWorkflowContext,
    payload: { factories: FactoryEditPayload[]; subsidiaries: SubsidiaryEditPayload[] },
    logError: (message: string, error?: unknown) => void
  ): Promise<{ successCount: number; failureCount: number }> {
    let successCount = 0;
    let failureCount = 0;

    for (const sub of payload.subsidiaries) {
      try {
        await this.persistSubsidiaryUpdate(ctx, sub);
        successCount++;
      } catch (error) {
        failureCount++;
        logError(`Failed subsidiary update ${sub.subsidiaryId}`, error);
      }
    }

    for (const fact of payload.factories) {
      try {
        await this.persistFactoryUpdate(ctx, fact);
        successCount++;
      } catch (error) {
        failureCount++;
        logError(`Failed factory update ${fact.factoryId}`, error);
      }
    }

    if (successCount > 0) {
      const groups = await firstValueFrom(this.projectService.buildParentGroupsFromApi().pipe(take(1)));
      this.warRoomService.setParentGroupsFromApi(groups);
      ctx.retryRequiredDataLoad();
    }

    return { successCount, failureCount };
  }

  async onFactoryDetailsUpdated(ctx: ProjectWorkflowContext, payload: FactoryEditPayload, logError: (m: string, e?: unknown) => void): Promise<void> {
    try {
      await this.persistFactoryUpdate(ctx, payload);
      const groups = await firstValueFrom(this.projectService.buildParentGroupsFromApi().pipe(take(1)));
      this.warRoomService.setParentGroupsFromApi(groups);
      ctx.retryRequiredDataLoad();
      this.toastr.success('Site details updated from API.', 'SYNC COMPLETE');
    } catch (error) {
      logError('Factory update failed', error);
      this.toastr.error('Failed to update site from API.', 'SAVE ERROR');
    }
  }

  async onSubsidiaryDetailsUpdated(ctx: ProjectWorkflowContext, payload: SubsidiaryEditPayload, logError: (m: string, e?: unknown) => void): Promise<void> {
    try {
      await this.persistSubsidiaryUpdate(ctx, payload);
      const groups = await firstValueFrom(this.projectService.buildParentGroupsFromApi().pipe(take(1)));
      this.warRoomService.setParentGroupsFromApi(groups);
      ctx.retryRequiredDataLoad();
      this.toastr.success('Manufacturer details updated from API.', 'SYNC COMPLETE');
    } catch (error) {
      logError('Subsidiary update failed', error);
      this.toastr.error('Failed to update manufacturer from API.', 'SAVE ERROR');
    }
  }

  async onProjectAdded(
    ctx: ProjectWorkflowContext,
    formData: {
      projectName: string;
      clientId: string;
      clientName: string;
    assessmentType: string;
    manufacturerLocationId?: string | number | null;
    factoryId?: string | number | null;
    location?: string;
    manufacturerName: string;
      status: 'Active' | 'Inactive';
    },
    setInFlight: (value: boolean) => void,
    logError: (m: string, e?: unknown) => void
  ): Promise<void> {
    const manufacturerLocationIdRaw = formData.manufacturerLocationId ?? formData.factoryId;
    const locationId =
      manufacturerLocationIdRaw == null
        ? null
        : Number.parseInt(String(manufacturerLocationIdRaw), 10);
    if (locationId == null || !Number.isFinite(locationId)) {
      ctx.handleModalError('Invalid location. Please select a valid factory location.');
      this.toastr.error('Could not resolve location id from API.', 'REGISTRATION FAILED');
      return;
    }

    setInFlight(true);
    try {
      const projectTypeId = await firstValueFrom(
        this.projectService.resolveProjectTypeIdByName(formData.assessmentType).pipe(take(1))
      );
      if (projectTypeId == null) {
        const msg = `Assessment type "${formData.assessmentType}" is not available from API.`;
        ctx.handleModalError('Unknown assessment type. Please select a valid API type.');
        this.toastr.error(msg, 'REGISTRATION FAILED', {
          timeOut: 8000,
          closeButton: true,
        });
        return;
      }

      const status = formData.status === 'Active' ? 'Open' : 'Closed';
      const projectManufacturerLocationId = formData.manufacturerLocationId ?? formData.factoryId ?? String(locationId);
      const project: ProjectCreateDraft = {
        projectName: formData.projectName,
        clientId: formData.clientId,
        clientName: formData.clientName,
        assessmentType: formData.assessmentType,
        projectTypeId,
        locationIds: [locationId],
        locationId,
        manufacturerLocationId: String(projectManufacturerLocationId),
        location: formData.location ?? '',
        manufacturer: formData.manufacturerName,
        status,
        closed: status === 'Closed',
      };

      const createdProject = await firstValueFrom(this.projectService.addProject(project).pipe(take(1)));

      this.warRoomService.setMapViewMode('project');
      this.warRoomService.selectEntity(null);
      ctx.setSelectedProjectId(null);
      setTimeout(() => ctx.clearAllFilters(), CLEAR_FILTERS_AFTER_ADD_DELAY_MS);

      ctx.retryRequiredDataLoad();
      ctx.handleModalSuccess(`Successfully added project "${formData.projectName}" for ${formData.clientName}.`);
      this.toastr.success(`Project "${formData.projectName}" added.`, 'PROJECT REGISTERED', {
        timeOut: 5000,
        progressBar: true,
        closeButton: true,
      });
      ctx.closeModalAfterSuccess();
      ctx.announce(`Project ${formData.projectName} added.`);

      const fitMapToRoutes = (): void => {
        const routes = ctx.projectRoutes();
        const newRoute = routes.find((r) => r.projectId === String(createdProject.id));
        if (newRoute) {
          ctx.mapFitBoundsToRoutes([newRoute]);
        } else if (routes.length > 0) {
          ctx.mapFitBoundsToRoutes(routes);
        }
      };
      setTimeout(fitMapToRoutes, FIT_MAP_AFTER_ADD_DELAY_MS);
      setTimeout(fitMapToRoutes, FIT_MAP_AFTER_ADD_RETRY_DELAY_MS);

      ctx.waitForRouteThenCapture(String(createdProject.id), createdProject.projectName, 800, 400, 6);
    } catch (error) {
      logError('Critical error adding project', error);
      ctx.handleModalError('Create failed. Please try again.');
      this.toastr.error(
        error instanceof Error ? error.message : 'A fatal system error occurred.',
        'REGISTRATION FAILED',
        { timeOut: 8000, closeButton: true }
      );
    } finally {
      setInFlight(false);
    }
  }
}
