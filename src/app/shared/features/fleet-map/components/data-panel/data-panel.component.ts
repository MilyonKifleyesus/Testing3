import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input, output, signal } from '@angular/core';
import type { ApiClient, ApiLocation, ApiManufacturer, ApiProject, FleetSelectedEntity, FleetTab } from '../../models/fleet-map.models';
import { hasUsableCoordinates } from '../../utils/fleet-map-geo';
import { getProjectStatusDisplayLabel } from '../../utils/fleet-map-status';

export interface FleetEntityViewEvent {
  tab: FleetTab;
  entity: ApiProject | ApiClient | ApiManufacturer | ApiLocation;
}

interface DataTab {
  id: FleetTab;
  label: string;
  iconClass: string;
}

interface ProjectMeta {
  clientName: string;
  clientLogoUrl?: string;
  clientAuxiliary?: string;
  manufacturerLabel: string;
  primaryManufacturerName: string;
  primaryManufacturerLogoUrl?: string;
  manufacturerCount: number;
  locationCount: number;
}

interface LocationBrandMeta {
  logoUrl?: string;
  label?: string;
  kind?: 'Manufacturer' | 'Client';
}

const TABS: DataTab[] = [
  { id: 'projects', label: 'Projects', iconClass: 'bi bi-clipboard-data' },
  { id: 'clients', label: 'Clients', iconClass: 'bi bi-people' },
  { id: 'manufacturers', label: 'Manufacturers', iconClass: 'bi bi-building' },
  { id: 'locations', label: 'Locations', iconClass: 'bi bi-geo-alt' },
];

@Component({
  selector: 'app-data-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './data-panel.component.html',
  styleUrl: './data-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class DataPanelComponent {
  readonly activeTab = input.required<FleetTab>();
  readonly search = input.required<string>();
  readonly projects = input.required<ApiProject[]>();
  readonly clients = input.required<ApiClient[]>();
  readonly manufacturers = input.required<ApiManufacturer[]>();
  readonly locations = input.required<ApiLocation[]>();
  readonly selectedEntity = input<FleetSelectedEntity | null>(null);

  readonly activeTabChange = output<FleetTab>();
  readonly searchChange = output<string>();
  readonly viewEntity = output<FleetEntityViewEvent>();

  readonly open = signal(true);
  readonly tabs = TABS;
  readonly failedLogoKeys = signal<Set<string>>(new Set());

  readonly counts = computed<Record<FleetTab, number>>(() => ({
    projects: this.projects().length,
    clients: this.clients().length,
    manufacturers: this.manufacturers().length,
    locations: this.locations().length,
  }));

  readonly locationById = computed(() => new Map(this.locations().map((location) => [location.id, location])));
  readonly clientById = computed(() => new Map(this.clients().map((client) => [client.id, client])));

  readonly projectMetaById = computed(() => {
    const clientById = this.clientById();
    const manufacturers = this.manufacturers();
    const locationById = this.locationById();

    return new Map<string, ProjectMeta>(this.projects().map((project) => {
      const client = clientById.get(project.clientId) ?? null;
      const manufacturerEntities = Array.from(new Map(
        project.locationIds
          .flatMap((locationId) => manufacturers.filter((manufacturer) => manufacturer.locationIds.includes(locationId)))
          .map((manufacturer) => [manufacturer.id, manufacturer]),
      ).values());
      const manufacturerNames = manufacturerEntities.map((manufacturer) => manufacturer.name);
      const locationCount = project.locationIds.length || (project.locationId ? 1 : 0);

      return [project.id, {
        clientName: client?.name ?? project.clientId,
        clientLogoUrl: client?.logoUrl,
        clientAuxiliary: client?.locationIds.length
          ? `${this.countMappedLocations(client.locationIds, locationById)}/${client.locationIds.length} mapped`
          : undefined,
        manufacturerLabel: manufacturerNames.join(', ') || 'Unassigned',
        primaryManufacturerName: manufacturerEntities[0]?.name ?? 'Unassigned',
        primaryManufacturerLogoUrl: manufacturerEntities[0]?.logoUrl,
        manufacturerCount: manufacturerEntities.length,
        locationCount,
      }];
    }));
  });

  readonly manufacturerLocationNamesById = computed(() => (
    new Map(this.manufacturers().map((manufacturer) => {
      const locationNames = Array.from(new Set(
        manufacturer.locationIds
          .map((locationId) => this.locationById().get(locationId)?.name)
          .filter((name): name is string => !!name),
      ));
      return [manufacturer.id, locationNames];
    }))
  ));

  readonly clientLocationNamesById = computed(() => (
    new Map(this.clients().map((client) => {
      const locationNames = Array.from(new Set(
        client.locationIds
          .map((locationId) => this.locationById().get(locationId)?.name)
          .filter((name): name is string => !!name),
      ));
      return [client.id, locationNames];
    }))
  ));

  readonly locationBrandMetaById = computed(() => (
    new Map(this.locations().map((location) => {
      const manufacturer = (location.manufacturerId
        ? this.manufacturers().find((candidate) => candidate.id === location.manufacturerId)
        : null) ?? this.manufacturers().find((candidate) => candidate.locationIds.includes(location.id));
      const client = this.clients().find((candidate) => candidate.locationIds.includes(location.id));

      return [location.id, {
        logoUrl: manufacturer?.logoUrl ?? client?.logoUrl,
        label: manufacturer?.name ?? client?.name,
        kind: manufacturer ? 'Manufacturer' : client ? 'Client' : undefined,
      } satisfies LocationBrandMeta];
    }))
  ));

  readonly normalizedSearch = computed(() => this.search().toLowerCase().trim());

  readonly projectRows = computed(() => {
    if (this.activeTab() !== 'projects') return [];
    const query = this.normalizedSearch();
    if (!query) return this.projects();

    return this.projects().filter((project) => {
      const meta = this.projectMetaById().get(project.id);
      return (
        project.name.toLowerCase().includes(query) ||
        (meta?.clientName.toLowerCase().includes(query) ?? false) ||
        (meta?.manufacturerLabel.toLowerCase().includes(query) ?? false) ||
        project.type.toLowerCase().includes(query) ||
        project.clientId.toLowerCase().includes(query)
      );
    });
  });

  readonly clientRows = computed(() => {
    if (this.activeTab() !== 'clients') return [];
    const query = this.normalizedSearch();
    if (!query) return this.clients();

    return this.clients().filter((client) => (
      client.name.toLowerCase().includes(query) ||
      (this.clientLocationNamesById().get(client.id) ?? []).some((locationName) => locationName.toLowerCase().includes(query))
    ));
  });

  readonly manufacturerRows = computed(() => {
    if (this.activeTab() !== 'manufacturers') return [];
    const query = this.normalizedSearch();
    if (!query) return this.manufacturers();

    return this.manufacturers().filter((manufacturer) => (
      manufacturer.name.toLowerCase().includes(query) ||
      (this.manufacturerLocationNamesById().get(manufacturer.id) ?? []).some((locationName) => (
        locationName.toLowerCase().includes(query)
      ))
    ));
  });

  readonly locationRows = computed(() => {
    if (this.activeTab() !== 'locations') return [];
    const query = this.normalizedSearch();
    if (!query) return this.locations();
    return this.locations().filter((location) => location.name.toLowerCase().includes(query));
  });

  toggleOpen(): void {
    this.open.update((current) => !current);
  }

  changeTab(tab: FleetTab): void {
    this.activeTabChange.emit(tab);
  }

  emitSearch(value: string): void {
    this.searchChange.emit(value);
  }

  emitView(tab: FleetTab, entity: ApiProject | ApiClient | ApiManufacturer | ApiLocation): void {
    this.viewEntity.emit({ tab, entity });
  }

  entityInitials(name: string): string {
    return name.slice(0, 2).toUpperCase();
  }

  countMappedLocations(locationIds: string[], locationById: Map<string, ApiLocation> = this.locationById()): number {
    return locationIds.reduce((count, locationId) => {
      const location = locationById.get(locationId);
      return location && hasUsableCoordinates(location.lat, location.lng) ? count + 1 : count;
    }, 0);
  }

  projectStatusLabel(status: ApiProject['status']): string {
    return getProjectStatusDisplayLabel(status);
  }

  logoKey(prefix: string, id: string, logoUrl?: string): string {
    return `${prefix}:${id}:${logoUrl ?? 'none'}`;
  }

  hasLogo(prefix: string, id: string, logoUrl?: string): boolean {
    if (!logoUrl) return false;
    return !this.failedLogoKeys().has(this.logoKey(prefix, id, logoUrl));
  }

  markLogoFailed(prefix: string, id: string, logoUrl?: string): void {
    if (!logoUrl) return;
    const next = new Set(this.failedLogoKeys());
    next.add(this.logoKey(prefix, id, logoUrl));
    this.failedLogoKeys.set(next);
  }

  isSelected(kind: FleetSelectedEntity['kind'], id: string): boolean {
    return this.selectedEntity()?.kind === kind && this.selectedEntity()?.data.id === id;
  }

  projectMeta(id: string): ProjectMeta | undefined {
    return this.projectMetaById().get(id);
  }

  clientLocationNames(id: string): string[] {
    return this.clientLocationNamesById().get(id) ?? [];
  }

  manufacturerLocationNames(id: string): string[] {
    return this.manufacturerLocationNamesById().get(id) ?? [];
  }

  locationBrandMeta(id: string): LocationBrandMeta | undefined {
    return this.locationBrandMetaById().get(id);
  }

  emptyColspan(): number {
    switch (this.activeTab()) {
      case 'projects':
        return 7;
      case 'clients':
        return 5;
      default:
        return 4;
    }
  }
}
