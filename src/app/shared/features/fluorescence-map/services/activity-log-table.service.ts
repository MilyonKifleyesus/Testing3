import { Injectable } from '@angular/core';
import { ActivityLogRow, ClientVm, LocationVm, ManufacturerVm, ProjectVm } from '../models/fleet-vm.models';

export interface ActivityLogProjectionFilters {
  status?: 'all' | 'active' | 'inactive';
  clientIds?: string[];
  manufacturerIds?: string[];
  projectTypeIds?: string[];
  projectIds?: string[];
}

@Injectable({ providedIn: 'root' })
export class ActivityLogTableService {
  buildRows(
    projects: ProjectVm[],
    clients: ClientVm[],
    manufacturers: ManufacturerVm[],
    locations: LocationVm[],
    filters: ActivityLogProjectionFilters
  ): ActivityLogRow[] {
    const clientById = new Map(clients.map((client) => [String(client.id), client]));
    const locationById = new Map(locations.map((location) => [String(location.id), location]));
    const manufacturerById = new Map(manufacturers.map((manufacturer) => [String(manufacturer.id), manufacturer]));
    const manufacturerByLocationId = new Map<string, ManufacturerVm[]>();
    for (const manufacturer of manufacturers) {
      const dedupedLocationKeys = new Set<string>();
      const candidateLocationValues = [
        manufacturer.locationId,
        ...(manufacturer.locationIds ?? []),
      ];
      for (const locationValue of candidateLocationValues) {
        const candidateKeys = this.buildIdCandidates(locationValue == null ? '' : String(locationValue));
        for (const key of candidateKeys) {
          if (!key || dedupedLocationKeys.has(key)) continue;
          dedupedLocationKeys.add(key);
          const list = manufacturerByLocationId.get(key) ?? [];
          manufacturerByLocationId.set(key, [...list, manufacturer]);
        }
      }
    }

    const filteredProjects = this.filterProjects(projects, filters);
    const rows = filteredProjects.map((project) =>
      this.mapProjectToRow(project, clientById, locationById, manufacturerById, manufacturerByLocationId)
    );
    return this.sortRows(rows);
  }

  filterAndSearchRows(rows: ActivityLogRow[], searchTerm: string): ActivityLogRow[] {
    const normalizedTerm = searchTerm.trim().toLowerCase();
    if (!normalizedTerm) {
      return rows;
    }

    return rows.filter((row) =>
      [
        row.entityName,
        row.clientName,
        row.manufacturerName,
        row.locationName,
        row.status,
        row.updatedAt ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedTerm)
    );
  }

  toCsv(rows: ActivityLogRow[]): string {
    const headers = [
      'Entity',
      'Status',
      'Client',
      'Manufacturer',
      'Location',
      'Start Date',
      'End Date',
      'Updated At',
      'Source',
    ];
    const values = rows.map((row) => [
      row.entityName,
      row.status,
      row.clientName,
      row.manufacturerName,
      row.locationName,
      row.startDate ?? '',
      row.endDate ?? '',
      row.updatedAt ?? '',
      row.source,
    ]);

    return [headers, ...values]
      .map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n');
  }

  private sortRows(rows: ActivityLogRow[]): ActivityLogRow[] {
    return rows.slice().sort((a, b) => {
      const tsA = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const tsB = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      if (tsA !== tsB) return tsB - tsA;
      return a.entityName.localeCompare(b.entityName);
    });
  }

  private filterProjects(projects: ProjectVm[], filters: ActivityLogProjectionFilters): ProjectVm[] {
    return projects.filter((project) => {
      const projectId = String(project.id);
      const clientId = String(project.clientId);
      const status = this.toRowStatus(project.status);
      const manufacturerName = (project.manufacturerName ?? '').toLowerCase();
      const manufacturerLocationId = String(project.manufacturerLocationId ?? '');
      const projectTypeId = String(project.projectTypeId ?? project.assessmentType ?? '');

      if (filters.projectIds?.length && !filters.projectIds.includes(projectId)) return false;
      if (filters.clientIds?.length && !filters.clientIds.includes(clientId)) return false;
      if (
        filters.manufacturerIds?.length &&
        !filters.manufacturerIds.some((manufacturerId) => {
          const normalizedId = manufacturerId.toLowerCase();
          return manufacturerLocationId === manufacturerId || manufacturerName.includes(normalizedId);
        })
      ) {
        return false;
      }
      if (filters.projectTypeIds?.length && !filters.projectTypeIds.includes(projectTypeId)) return false;
      if (filters.status === 'active' && status !== 'Active') return false;
      if (filters.status === 'inactive' && status === 'Active') return false;
      return true;
    });
  }

  private mapProjectToRow(
    project: ProjectVm,
    clientById: Map<string, ClientVm>,
    locationById: Map<string, LocationVm>,
    manufacturerById: Map<string, ManufacturerVm>,
    manufacturerByLocationId: Map<string, ManufacturerVm[]>
  ): ActivityLogRow {
    const locationId = project.locationId ?? project.manufacturerLocationId ?? '';
    const location = locationById.get(String(locationId));
    const manufacturerMatches = this.resolveManufacturersForProject(project, manufacturerById, manufacturerByLocationId);
    const manufacturer = manufacturerMatches.length === 1 ? manufacturerMatches[0] : null;
    const client = clientById.get(String(project.clientId));
    const updatedAt = this.toIsoOrNull(project.lastUpdate);
    const timelineDate = this.toDateOnly(updatedAt);
    const locationCoordinates = this.toCoordinates(location?.latitude ?? null, location?.longitude ?? null);
    const clientCoordinates = this.toCoordinates(client?.latitude ?? null, client?.longitude ?? null);
    const manufacturerCoordinates = this.toCoordinates(
      manufacturer?.latitude ?? location?.latitude ?? null,
      manufacturer?.longitude ?? location?.longitude ?? null
    );
    const manufacturerName =
      manufacturerMatches.length > 1
        ? 'Multiple'
        : project.manufacturerName || manufacturer?.name || 'Unknown';
    const manufacturerId = manufacturer ? String(manufacturer.id) : null;

    return {
      id: `project-${project.id}`,
      entityType: 'project',
      entityId: String(project.id),
      projectId: String(project.id),
      projectTypeId: project.projectTypeId,
      projectTypeName: project.assessmentType,
      contract: project.contract ?? null,
      hasRoadTest: Boolean(project.hasRoadTest),
      entityName: project.projectName || String(project.id),
      status: this.toRowStatus(project.status),
      clientId: project.clientId || null,
      clientName: project.clientName || client?.name || 'Unknown',
      clientLocationId: client?.locationId ?? null,
      clientCoordinates,
      manufacturerId,
      manufacturerName,
      manufacturerLocationId: project.manufacturerLocationId ?? manufacturer?.locationId ?? null,
      manufacturerCoordinates,
      locationId: project.locationId ?? null,
      locationIds: project.locationIds ?? undefined,
      locationName: project.locationName || location?.name || 'Unknown',
      locationCoordinates,
      startDate: timelineDate,
      endDate: timelineDate,
      updatedAt,
      coordinates: locationCoordinates,
      source: 'project_snapshot',
    };
  }

  private buildIdCandidates(rawId: string | null | undefined): string[] {
    if (!rawId) return [];
    const candidates: string[] = [];
    const push = (value: string | null | undefined): void => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed || candidates.includes(trimmed)) return;
      candidates.push(trimmed);
    };

    const raw = String(rawId).trim();
    if (!raw) return [];

    push(raw);
    const withoutSource = raw.replace(/^source-/i, '').trim();
    push(withoutSource);
    const withoutLoc = withoutSource.replace(/^loc-/i, '').trim();
    push(withoutLoc);

    if (/^\d+$/.test(withoutLoc)) {
      const numeric = String(Number.parseInt(withoutLoc, 10));
      push(numeric);
      push(`loc-${numeric}`);
    }

    return candidates;
  }

  private resolveManufacturersForProject(
    project: ProjectVm,
    manufacturerById: Map<string, ManufacturerVm>,
    manufacturerByLocationId: Map<string, ManufacturerVm[]>
  ): ManufacturerVm[] {
    const matchedById = new Map<string, ManufacturerVm>();
    const checked = new Set<string>();
    const lookupValues = [
      project.manufacturerLocationId,
      project.locationId,
      ...(project.locationIds ?? []).map((locationId) => String(locationId)),
    ];

    for (const value of lookupValues) {
      const candidates = this.buildIdCandidates(value);
      for (const candidate of candidates) {
        if (checked.has(candidate)) continue;
        checked.add(candidate);
        const byLocation = manufacturerByLocationId.get(candidate) ?? [];
        for (const manufacturer of byLocation) {
          matchedById.set(String(manufacturer.id), manufacturer);
        }
        const byId = manufacturerById.get(candidate);
        if (byId) {
          matchedById.set(String(byId.id), byId);
        }
      }
    }

    return Array.from(matchedById.values());
  }

  private toRowStatus(status: ProjectVm['status']): ActivityLogRow['status'] {
    if (status === 'Closed') return 'Closed';
    if (status === 'Delayed') return 'Under Inspection';
    return 'Active';
  }

  private toIsoOrNull(value: string | null): string | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  private toDateOnly(value: string | null): string | null {
    if (!value) return null;
    return value.slice(0, 10);
  }

  private toCoordinates(latitude: number | null, longitude: number | null): { latitude: number; longitude: number } | null {
    if (latitude == null || longitude == null) return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  }
}
