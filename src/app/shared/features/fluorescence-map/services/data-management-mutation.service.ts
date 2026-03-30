import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Client } from '../../../models/client.model';
import { Project } from '../../../models/project.model';
import { ClientService } from '../../../services/client.service';
import { LocationService, ApiLocation } from '../../../services/location.service';
import { ProjectService, ApiManufacturerDetail } from '../../../services/project.service';
import {
  ActivityLogRow,
  ClientManagementDraft,
  ClientManagementRow,
  DataManagementRowDraft,
  LocationManagementDraft,
  LocationManagementRow,
  ManufacturerManagementDraft,
  ManufacturerManagementRow,
} from '../models/fleet-vm.models';

interface CoordinatePair {
  latitude: number;
  longitude: number;
}

export interface SaveRowDraftInput {
  row: ActivityLogRow;
  draft: DataManagementRowDraft;
  project: Project;
  client: Client | null;
  manufacturer: {
    id: string;
    name: string;
    locationId: string | number | null;
  } | null;
  location: ApiLocation | null;
}

export interface SaveRowDraftResult {
  changed: {
    project: boolean;
    location: boolean;
    client: boolean;
    manufacturer: boolean;
  };
  updatedProject?: Project;
  updatedClient?: Client;
  updatedLocation?: ApiLocation;
  updatedManufacturer?: ApiManufacturerDetail | null;
}

export interface SaveClientEntityDraftInput {
  row: ClientManagementRow;
  draft: ClientManagementDraft;
  client: Client;
  location: ApiLocation | null;
}

export interface SaveClientEntityDraftResult {
  changed: {
    client: boolean;
    location: boolean;
  };
  updatedClient?: Client;
  updatedLocation?: ApiLocation;
}

export interface SaveManufacturerEntityDraftInput {
  row: ManufacturerManagementRow;
  draft: ManufacturerManagementDraft;
  manufacturer: {
    id: string;
    name: string;
    locationId: string | number | null;
  };
  location: ApiLocation | null;
}

export interface SaveManufacturerEntityDraftResult {
  changed: {
    manufacturer: boolean;
    location: boolean;
  };
  updatedManufacturer?: ApiManufacturerDetail | null;
  updatedLocation?: ApiLocation;
}

export interface SaveLocationEntityDraftInput {
  row: LocationManagementRow;
  draft: LocationManagementDraft;
  location: ApiLocation;
}

export interface SaveLocationEntityDraftResult {
  changed: {
    location: boolean;
  };
  updatedLocation?: ApiLocation;
}

@Injectable({ providedIn: 'root' })
export class DataManagementMutationService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly clientService: ClientService,
    private readonly locationService: LocationService
  ) {}

  async saveRowDraft(input: SaveRowDraftInput): Promise<SaveRowDraftResult> {
    const { row, draft, project } = input;
    const result: SaveRowDraftResult = {
      changed: {
        project: false,
        location: false,
        client: false,
        manufacturer: false,
      },
    };

    const nextLocationIds = this.resolveLocationIds(
      draft.projectDraft.locationIds,
      row.locationIds,
      row.locationId
    );
    const projectChanged = this.projectChanged(project, draft, nextLocationIds);
    if (projectChanged) {
      const desiredProjectTypeId = this.normalizeText(draft.projectDraft.projectTypeId || String(project.projectTypeId ?? ''));
      const projectTypeId = this.toIntId(desiredProjectTypeId, 'project type id');
      const updatedProject = await firstValueFrom(
        this.projectService.updateProject({
          ...project,
          projectName: this.normalizeText(draft.projectDraft.name) || project.projectName || row.entityName,
          clientId:
            this.normalizeText(draft.projectDraft.clientId || project.clientId) ||
            project.clientId,
          projectTypeId,
          contract: this.normalizeText(draft.projectDraft.contract),
          hasRoadTest: Boolean(draft.projectDraft.hasRoadTest),
          locationIds: nextLocationIds,
          // Status is backend-derived in current deployment.
          status: project.status,
        })
      );
      result.updatedProject = updatedProject;
      result.changed.project = true;
    }

    return result;
  }

  async saveClientEntityDraft(input: SaveClientEntityDraftInput): Promise<SaveClientEntityDraftResult> {
    const { row, draft, client } = input;
    const result: SaveClientEntityDraftResult = {
      changed: {
        client: false,
        location: false,
      },
    };

    const nextLocationIds = this.resolveLocationIds(
      draft.locationIds,
      row.locationIds,
      row.locationId
    );
    const nameChanged = this.normalizeText(draft.name) !== this.normalizeText(client.name);
    const locationChanged = this.locationIdsChanged(nextLocationIds, client.locationIds ?? []);
    const logoChanged =
      this.normalizeText(draft.customerLogo ?? '') !== this.normalizeText(client.logoUrl ?? '');
    const logoNameChanged = this.normalizeText(draft.customerLogoName ?? '') !== '';

    if (!nameChanged && !locationChanged && !logoChanged && !logoNameChanged) {
      return result;
    }

    result.updatedClient = await firstValueFrom(
      this.clientService.updateClient(client.id, {
        customerName: this.normalizeText(draft.name) || this.normalizeText(client.name) || row.clientName,
        customerLogo: draft.customerLogo ?? client.logoUrl ?? null,
        customerLogoName: draft.customerLogoName ?? null,
        locationIds: nextLocationIds,
      })
    );
    result.changed.client = true;

    return result;
  }

  async saveManufacturerEntityDraft(
    input: SaveManufacturerEntityDraftInput
  ): Promise<SaveManufacturerEntityDraftResult> {
    const { row, draft, manufacturer } = input;
    const result: SaveManufacturerEntityDraftResult = {
      changed: {
        manufacturer: false,
        location: false,
      },
    };

    const nextLocationIds = this.resolveLocationIds(
      draft.locationIds,
      row.locationIds,
      row.locationId
    );
    const currentLocationIds = row.locationIds ?? this.resolveLocationIds(undefined, undefined, row.locationId);
    const nameChanged = this.normalizeText(draft.name) !== this.normalizeText(manufacturer.name);
    const locationChanged = this.locationIdsChanged(nextLocationIds, currentLocationIds);
    const logoChanged = this.normalizeText(draft.manufacturerLogo ?? '') !== '';
    const logoNameChanged = this.normalizeText(draft.manufacturerLogoName ?? '') !== '';
    if (!nameChanged && !locationChanged && !logoChanged && !logoNameChanged) {
      return result;
    }

    const manufacturerId = this.toIntId(manufacturer.id, 'manufacturer id');
    result.updatedManufacturer = await firstValueFrom(
      this.projectService.updateManufacturer(manufacturerId, {
        manufacturerName: this.normalizeText(draft.name) || this.normalizeText(manufacturer.name) || row.manufacturerName,
        manufacturerLogo: draft.manufacturerLogo ?? null,
        manufacturerLogoName: draft.manufacturerLogoName ?? null,
        locationIds: nextLocationIds,
      })
    );
    result.changed.manufacturer = true;

    return result;
  }

  async saveLocationEntityDraft(input: SaveLocationEntityDraftInput): Promise<SaveLocationEntityDraftResult> {
    const { row, draft, location } = input;
    const result: SaveLocationEntityDraftResult = {
      changed: {
        location: false,
      },
    };

    const parsedCoordinates = this.parseCoordinatePair(draft.latitude, draft.longitude);
    const baseCoordinates = this.toCoordinatePair(location.latitude ?? row.latitude, location.longitude ?? row.longitude);
    const nameChanged = this.normalizeText(draft.name) !== this.normalizeText(location.name);
    const coordinatesChanged = this.coordinatesChanged(baseCoordinates, parsedCoordinates);
    if (!nameChanged && !coordinatesChanged) {
      return result;
    }

    const resolvedCoordinates = parsedCoordinates ?? baseCoordinates;
    if (!resolvedCoordinates) {
      throw new Error('Location latitude and longitude are both required.');
    }

    const locationId = this.toIntId(row.locationId, 'location id');
    result.updatedLocation = await firstValueFrom(
      this.locationService.updateLocation(locationId, {
        name: this.normalizeText(draft.name) || this.normalizeText(location.name) || this.normalizeText(row.locationName) || 'Location',
        latitude: resolvedCoordinates.latitude,
        longitude: resolvedCoordinates.longitude,
      })
    );
    result.changed.location = true;

    return result;
  }

  private projectChanged(project: Project, draft: DataManagementRowDraft, nextLocationIds: number[]): boolean {
    const nextName = this.normalizeText(draft.projectDraft.name);
    const nextTypeId = this.normalizeText(draft.projectDraft.projectTypeId || String(project.projectTypeId ?? ''));
    const nextContract = this.normalizeText(draft.projectDraft.contract);
    const nextClientId = this.normalizeText(draft.projectDraft.clientId || String(project.clientId ?? ''));

    const currentName = this.normalizeText(project.projectName);
    const currentTypeId = this.normalizeText(String(project.projectTypeId ?? ''));
    const currentContract = this.normalizeText(project.contract);
    const currentClientId = this.normalizeText(String(project.clientId ?? ''));
    const currentRoadTest = Boolean(project.hasRoadTest);
    const currentLocationIds = this.resolveLocationIds(project.locationIds, undefined, project.locationId);

    return (
      nextName !== currentName ||
      nextTypeId !== currentTypeId ||
      nextContract !== currentContract ||
      Boolean(draft.projectDraft.hasRoadTest) !== currentRoadTest ||
      nextClientId !== currentClientId ||
      this.locationIdsChanged(nextLocationIds, currentLocationIds)
    );
  }

  private locationIdsChanged(next: number[], current: number[]): boolean {
    if (next.length !== current.length) return true;
    const left = [...next].sort((a, b) => a - b);
    const right = [...current].sort((a, b) => a - b);
    return left.some((value, index) => value !== right[index]);
  }

  private resolveLocationIds(
    preferred: number[] | undefined,
    existing: number[] | undefined,
    fallbackLocationId: string | number | null | undefined
  ): number[] {
    const normalizedPreferred = this.normalizeLocationIdArray(preferred);
    if (normalizedPreferred.length > 0 || Array.isArray(preferred)) return normalizedPreferred;
    const normalizedExisting = this.normalizeLocationIdArray(existing);
    if (normalizedExisting.length > 0) return normalizedExisting;
    const fallback = this.toNullableIntId(fallbackLocationId);
    return fallback == null ? [] : [fallback];
  }

  private normalizeLocationIdArray(values: unknown): number[] {
    if (!Array.isArray(values)) return [];
    const deduped = new Set<number>();
    for (const value of values) {
      const parsed = this.toNullableIntId(value);
      if (parsed != null) deduped.add(parsed);
    }
    return Array.from(deduped.values());
  }

  private parseCoordinatePair(latitudeText: string, longitudeText: string): CoordinatePair | null {
    const latitude = this.parseCoordinateValue(latitudeText);
    const longitude = this.parseCoordinateValue(longitudeText);

    if (latitude === null && longitude === null) return null;
    if (latitude === null || longitude === null) {
      throw new Error('Latitude and longitude are both required.');
    }
    if (latitude < -90 || latitude > 90) {
      throw new Error('Latitude must be between -90 and 90.');
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error('Longitude must be between -180 and 180.');
    }
    return { latitude, longitude };
  }

  private parseCoordinateValue(value: string): number | null {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      throw new Error('Coordinates must be numeric.');
    }
    return parsed;
  }

  private coordinatesChanged(
    base: { latitude: number; longitude: number } | null,
    next: CoordinatePair | null
  ): boolean {
    if (!next) return false;
    if (!base) return true;
    return !this.areClose(base.latitude, next.latitude) || !this.areClose(base.longitude, next.longitude);
  }

  private areClose(a: number, b: number): boolean {
    return Math.abs(a - b) < 0.000001;
  }

  private toCoordinatePair(latitude: number | null | undefined, longitude: number | null | undefined): CoordinatePair | null {
    if (latitude == null || longitude == null) return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  }

  private normalizeText(value: string | number | null | undefined): string {
    return String(value ?? '').trim();
  }

  private toIntId(value: string | number | null | undefined, field: string): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Missing or invalid ${field}.`);
    }
    return parsed;
  }

  private toNullableIntId(value: unknown): number | null {
    if (value == null || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
