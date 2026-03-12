import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, catchError, finalize, forkJoin, of } from 'rxjs';
import type {
  ApiClient,
  ApiLocation,
  ApiManufacturer,
  ApiProject,
  FleetFilterChip,
  FleetFilterKind,
  FleetFilterOption,
  FleetMode,
  FleetSelectedEntity,
  FleetStats,
  FleetTab,
} from '../models/fleet-map.models';
import { FleetMapApiService } from './fleet-map-api.service';
import { hasUsableCoordinates } from '../utils/fleet-map-geo';
import { getProjectStatusDisplayLabel } from '../utils/fleet-map-status';
import { AppStateService } from '../../../services/app-state.service';

const THEME_STORAGE_KEY = 'buspulse-theme';

function getInitialDarkMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const documentTheme = document.documentElement.getAttribute('data-theme-mode');
  if (documentTheme === 'dark') return true;
  if (documentTheme === 'light') return false;

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === 'dark') return true;
  if (storedTheme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function sortByLabel<T extends FleetFilterOption>(items: T[]): T[] {
  return [...items].sort((left, right) => left.label.localeCompare(right.label));
}

function toggleArrayValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function filterByNameQuery<T extends { name: string }>(items: T[], query: string): T[] {
  if (!query) return items;
  return items.filter((item) => item.name.toLowerCase().includes(query));
}

function filterProjectsByQuery(items: ApiProject[], query: string): ApiProject[] {
  if (!query) return items;

  return items.filter((project) => (
    project.name.toLowerCase().includes(query) ||
    project.type.toLowerCase().includes(query) ||
    project.clientId.toLowerCase().includes(query)
  ));
}

function getModeForTab(tab: FleetTab): FleetMode {
  switch (tab) {
    case 'projects':
      return 'projects';
    case 'clients':
      return 'clients';
    case 'manufacturers':
    case 'locations':
      return 'manufacturers';
  }
}

function buildSelectedEntity(
  type: FleetTab,
  entity: ApiProject | ApiClient | ApiManufacturer | ApiLocation,
): FleetSelectedEntity {
  switch (type) {
    case 'projects':
      return { kind: 'project', data: entity as ApiProject };
    case 'clients':
      return { kind: 'client', data: entity as ApiClient };
    case 'manufacturers':
      return { kind: 'manufacturer', data: entity as ApiManufacturer };
    case 'locations':
      return { kind: 'location', data: entity as ApiLocation };
  }
}

function buildEntityKey(entity: FleetSelectedEntity): string {
  return `${entity.kind}:${entity.data.id}`;
}

@Injectable()
export class FleetMapStateService {
  private readonly api = inject(FleetMapApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly appStateService = inject(AppStateService);

  readonly projects = signal<ApiProject[]>([]);
  readonly projectTypes = signal(this.api.deriveProjectTypes([]));
  readonly clients = signal<ApiClient[]>([]);
  readonly manufacturers = signal<ApiManufacturer[]>([]);
  readonly locations = signal<ApiLocation[]>([]);
  readonly isLoading = signal(true);
  readonly isError = signal(false);

  readonly activeTableTab = signal<FleetTab>('projects');
  readonly tableSearch = signal('');
  readonly selectedEntity = signal<FleetSelectedEntity | null>(null);
  readonly mapFocusEntity = signal<FleetSelectedEntity | null>(null);
  readonly viewedProjectId = signal<string | null>(null);
  readonly showFilters = signal(false);
  readonly isDark = signal(getInitialDarkMode());

  readonly draftProjectIds = signal<string[]>([]);
  readonly draftClientIds = signal<string[]>([]);
  readonly draftManufacturerIds = signal<string[]>([]);
  readonly draftTypes = signal<string[]>([]);
  readonly draftStatuses = signal<string[]>([]);

  readonly appliedProjectIds = signal<string[]>([]);
  readonly appliedClientIds = signal<string[]>([]);
  readonly appliedManufacturerIds = signal<string[]>([]);
  readonly appliedTypes = signal<string[]>([]);
  readonly appliedStatuses = signal<string[]>([]);

  readonly mode = computed(() => getModeForTab(this.activeTableTab()));
  readonly normalizedTableSearch = computed(() => this.tableSearch().toLowerCase().trim());
  readonly projectOptions = computed<FleetFilterOption[]>(() => (
    sortByLabel(this.projects().map((project) => ({ id: project.id, label: project.name })))
  ));
  readonly clientOptions = computed<FleetFilterOption[]>(() => (
    sortByLabel(this.clients().map((client) => ({ id: client.id, label: client.name })))
  ));
  readonly manufacturerOptions = computed<FleetFilterOption[]>(() => (
    sortByLabel(this.manufacturers().map((manufacturer) => ({ id: manufacturer.id, label: manufacturer.name })))
  ));
  readonly projectTypeOptions = computed<FleetFilterOption[]>(() => (
    sortByLabel(this.projectTypes().map((type) => ({ id: type.id, label: type.name })))
  ));
  readonly statusOptions = computed<FleetFilterOption[]>(() => (
    Array.from(new Set(this.projects().map((project) => project.status)))
      .map((status) => ({
        id: status,
        label: getProjectStatusDisplayLabel(status),
      }))
      .sort((left, right) => left.label.localeCompare(right.label))
  ));
  readonly projectById = computed(() => new Map(this.projects().map((project) => [project.id, project])));
  readonly clientById = computed(() => new Map(this.clients().map((client) => [client.id, client])));
  readonly manufacturerById = computed(() => (
    new Map(this.manufacturers().map((manufacturer) => [manufacturer.id, manufacturer]))
  ));
  readonly manufacturerLocationIdsById = computed(() => {
    const mapping = new Map<string, Set<string>>();
    this.manufacturers().forEach((manufacturer) => {
      mapping.set(manufacturer.id, new Set(manufacturer.locationIds));
    });
    return mapping;
  });
  readonly appliedManufacturerLocationIds = computed(() => {
    const ids = new Set<string>();
    this.appliedManufacturerIds().forEach((manufacturerId) => {
      this.manufacturerLocationIdsById().get(manufacturerId)?.forEach((locationId) => ids.add(locationId));
    });
    return ids;
  });
  readonly filteredProjects = computed(() => {
    const selectedStatuses = new Set(this.appliedStatuses().map((status) => status.toLowerCase()));

    return this.projects().filter((project) => {
      const projectLocationIds = new Set(project.locationIds);
      if (project.locationId) {
        projectLocationIds.add(project.locationId);
      }

      const projectMatch = this.appliedProjectIds().length === 0 || this.appliedProjectIds().includes(project.id);
      const clientMatch = this.appliedClientIds().length === 0 || this.appliedClientIds().includes(project.clientId);
      const manufacturerMatch =
        this.appliedManufacturerIds().length === 0 ||
        Array.from(projectLocationIds).some((locationId) => this.appliedManufacturerLocationIds().has(locationId));
      const typeMatch = this.appliedTypes().length === 0 || this.appliedTypes().includes(project.type);
      const statusMatch = selectedStatuses.size === 0 || selectedStatuses.has(project.status);

      return projectMatch && clientMatch && manufacturerMatch && typeMatch && statusMatch;
    });
  });
  readonly activeProjectLocationIds = computed(() => {
    const ids = new Set<string>();
    this.filteredProjects().forEach((project) => {
      project.locationIds.forEach((id) => ids.add(id));
      if (project.locationId) ids.add(project.locationId);
    });
    return ids;
  });
  readonly activeProjectClientIds = computed(() => {
    const ids = new Set<string>();
    this.filteredProjects().forEach((project) => ids.add(project.clientId));
    return ids;
  });
  readonly activeProjectManufacturerIds = computed(() => {
    const ids = new Set<string>();
    this.manufacturers().forEach((manufacturer) => {
      if (manufacturer.locationIds.some((locationId) => this.activeProjectLocationIds().has(locationId))) {
        ids.add(manufacturer.id);
      }
    });
    return ids;
  });
  readonly directlyFilteredLocationIds = computed(() => {
    const ids = new Set<string>();

    this.appliedClientIds().forEach((clientId) => {
      this.clientById().get(clientId)?.locationIds.forEach((locationId) => ids.add(locationId));
    });

    this.appliedManufacturerIds().forEach((manufacturerId) => {
      this.manufacturerById().get(manufacturerId)?.locationIds.forEach((locationId) => ids.add(locationId));
    });

    return ids;
  });
  readonly hasActiveFilters = computed(() => [
    this.appliedProjectIds(),
    this.appliedClientIds(),
    this.appliedManufacturerIds(),
    this.appliedTypes(),
    this.appliedStatuses(),
  ].some((values) => values.length > 0));
  readonly filteredClients = computed(() => (
    this.hasActiveFilters()
      ? this.clients().filter((client) => (
          this.activeProjectClientIds().has(client.id) || this.appliedClientIds().includes(client.id)
        ))
      : this.clients()
  ));
  readonly filteredManufacturers = computed(() => (
    this.hasActiveFilters()
      ? this.manufacturers().filter((manufacturer) => (
          this.activeProjectManufacturerIds().has(manufacturer.id) ||
          this.appliedManufacturerIds().includes(manufacturer.id)
        ))
      : this.manufacturers()
  ));
  readonly filteredLocations = computed(() => (
    this.hasActiveFilters()
      ? this.locations().filter((location) => (
          this.activeProjectLocationIds().has(location.id) ||
          this.directlyFilteredLocationIds().has(location.id)
        ))
      : this.locations()
  ));
  readonly mappedProjectCount = computed(() => (
    this.filteredProjects().filter((project) => {
      const locationIds = new Set(project.locationIds);
      if (project.locationId) {
        locationIds.add(project.locationId);
      }

      return hasUsableCoordinates(project.lat, project.lng) || Array.from(locationIds).some((locationId) => (
        this.filteredLocations().some((location) => location.id === locationId)
      ));
    }).length
  ));
  readonly activeFilterCount = computed(() => (
    this.appliedProjectIds().length +
    this.appliedClientIds().length +
    this.appliedManufacturerIds().length +
    this.appliedTypes().length +
    this.appliedStatuses().length
  ));
  readonly activeFilterChips = computed<FleetFilterChip[]>(() => {
    const chips: FleetFilterChip[] = [];

    this.appliedProjectIds().forEach((projectId) => {
      chips.push({
        key: `project-${projectId}`,
        label: this.projectById().get(projectId)?.name ?? projectId,
        kind: 'projects',
        value: projectId,
      });
    });

    this.appliedClientIds().forEach((clientId) => {
      chips.push({
        key: `client-${clientId}`,
        label: this.clientById().get(clientId)?.name ?? clientId,
        kind: 'clients',
        value: clientId,
      });
    });

    this.appliedManufacturerIds().forEach((manufacturerId) => {
      chips.push({
        key: `manufacturer-${manufacturerId}`,
        label: this.manufacturerById().get(manufacturerId)?.name ?? manufacturerId,
        kind: 'manufacturers',
        value: manufacturerId,
      });
    });

    this.appliedTypes().forEach((type) => {
      chips.push({
        key: `type-${type}`,
        label: type,
        kind: 'types',
        value: type,
      });
    });

    this.appliedStatuses().forEach((status) => {
      chips.push({
        key: `status-${status}`,
        label: getProjectStatusDisplayLabel(status as ApiProject['status']),
        kind: 'statuses',
        value: status,
      });
    });

    return chips;
  });
  readonly mapProjects = computed(() => {
    const visibleProjects = this.activeTableTab() === 'projects'
      ? filterProjectsByQuery(this.filteredProjects(), this.normalizedTableSearch())
      : [];

    if (this.activeTableTab() === 'projects' && this.viewedProjectId()) {
      return visibleProjects.filter((project) => project.id === this.viewedProjectId());
    }

    return visibleProjects;
  });
  readonly viewedProject = computed(() => {
    const viewedProjectId = this.viewedProjectId();
    if (!viewedProjectId) return null;
    return this.projectById().get(viewedProjectId) ?? null;
  });
  readonly mapClients = computed(() => {
    if (this.activeTableTab() === 'projects') {
      if (this.viewedProject()) {
        const client = this.clientById().get(this.viewedProject()!.clientId);
        return client ? [client] : [];
      }

      const clientIds = new Set(this.mapProjects().map((project) => project.clientId));
      return this.filteredClients().filter((client) => clientIds.has(client.id));
    }

    if (this.activeTableTab() === 'clients') {
      return filterByNameQuery(this.filteredClients(), this.normalizedTableSearch());
    }

    return [];
  });
  readonly mapManufacturers = computed(() => {
    if (this.activeTableTab() === 'projects') {
      const locationIds = new Set<string>();

      if (this.viewedProject()) {
        this.viewedProject()!.locationIds.forEach((locationId) => locationIds.add(locationId));
        if (this.viewedProject()!.locationId) {
          locationIds.add(this.viewedProject()!.locationId!);
        }
      } else {
        this.mapProjects().forEach((project) => {
          project.locationIds.forEach((locationId) => locationIds.add(locationId));
          if (project.locationId) {
            locationIds.add(project.locationId);
          }
        });
      }

      return this.filteredManufacturers().filter((manufacturer) => (
        manufacturer.locationIds.some((locationId) => locationIds.has(locationId))
      ));
    }

    if (this.activeTableTab() === 'manufacturers') {
      return filterByNameQuery(this.filteredManufacturers(), this.normalizedTableSearch());
    }

    return [];
  });
  readonly mapLocations = computed(() => {
    if (this.activeTableTab() === 'projects') {
      const locationIds = new Set<string>();

      if (this.viewedProject()) {
        this.viewedProject()!.locationIds.forEach((locationId) => locationIds.add(locationId));
        if (this.viewedProject()!.locationId) {
          locationIds.add(this.viewedProject()!.locationId!);
        }
      } else {
        this.mapProjects().forEach((project) => {
          project.locationIds.forEach((locationId) => locationIds.add(locationId));
          if (project.locationId) {
            locationIds.add(project.locationId);
          }
        });
      }

      return this.filteredLocations().filter((location) => locationIds.has(location.id));
    }

    if (this.activeTableTab() === 'clients') {
      const locationIds = new Set<string>();
      this.mapClients().forEach((client) => {
        client.locationIds.forEach((locationId) => locationIds.add(locationId));
      });
      return this.filteredLocations().filter((location) => locationIds.has(location.id));
    }

    if (this.activeTableTab() === 'manufacturers') {
      const locationIds = new Set<string>();
      this.mapManufacturers().forEach((manufacturer) => {
        manufacturer.locationIds.forEach((locationId) => locationIds.add(locationId));
      });
      return this.filteredLocations().filter((location) => locationIds.has(location.id));
    }

    return filterByNameQuery(this.filteredLocations(), this.normalizedTableSearch());
  });
  readonly visibleEntityKeys = computed(() => new Set([
    ...this.mapProjects().map((project) => `project:${project.id}`),
    ...this.mapClients().map((client) => `client:${client.id}`),
    ...this.mapManufacturers().map((manufacturer) => `manufacturer:${manufacturer.id}`),
    ...this.mapLocations().map((location) => `location:${location.id}`),
  ]));
  readonly stats = computed<FleetStats>(() => ({
    totalProjects: this.filteredProjects().length,
    activeProjects: this.filteredProjects().filter((project) => project.status === 'active').length,
    inactiveProjects: this.filteredProjects().filter((project) => project.status === 'inactive').length,
    totalClients: this.filteredClients().length,
  }));

  constructor() {
    this.appStateService.state$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        const resolvedTheme = String(
          state?.theme ?? document.documentElement.getAttribute('data-theme-mode') ?? '',
        ).trim().toLowerCase();
        const nextIsDark = resolvedTheme === 'dark';

        if (nextIsDark !== this.isDark()) {
          this.isDark.set(nextIsDark);
        }
      });

    effect(() => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(THEME_STORAGE_KEY, this.isDark() ? 'dark' : 'light');
      }
    });

    effect(() => {
      const selectedEntity = this.selectedEntity();
      const focusedEntity = this.mapFocusEntity();
      const viewedProjectId = this.viewedProjectId();
      const visibleEntityKeys = this.visibleEntityKeys();

      if (selectedEntity && !visibleEntityKeys.has(buildEntityKey(selectedEntity))) {
        untracked(() => this.selectedEntity.set(null));
      }

      if (focusedEntity && !visibleEntityKeys.has(buildEntityKey(focusedEntity))) {
        untracked(() => this.mapFocusEntity.set(null));
      }

      if (viewedProjectId && !visibleEntityKeys.has(`project:${viewedProjectId}`)) {
        untracked(() => this.viewedProjectId.set(null));
      }
    });
  }

  load(): void {
    this.isLoading.set(true);
    this.isError.set(false);

    let hadError = false;
    const capture = <T>(source$: Observable<T>) => (
      source$.pipe(
        catchError(() => {
          hadError = true;
          return of([] as unknown as T);
        }),
      )
    );

    forkJoin({
      clients: capture(this.api.fetchClients()),
      manufacturers: capture(this.api.fetchManufacturers()),
      locations: capture(this.api.fetchLocations()),
      projects: capture(this.api.fetchProjects()),
    }).pipe(
      finalize(() => this.isLoading.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((result) => {
      this.clients.set(result.clients);
      this.manufacturers.set(result.manufacturers);
      this.locations.set(result.locations);
      this.projects.set(result.projects);
      this.projectTypes.set(this.api.deriveProjectTypes(result.projects));
      this.isError.set(hadError);
    });
  }

  refresh(): void {
    this.load();
  }

  setSearch(value: string): void {
    this.tableSearch.set(value);
  }

  setMode(mode: FleetMode): void {
    this.activeTableTab.set(mode);
    this.tableSearch.set('');
    this.clearSelection();
  }

  setActiveTab(nextTab: FleetTab): void {
    this.activeTableTab.set(nextTab);
    this.tableSearch.set('');
    this.clearSelection();
  }

  toggleTheme(): void {
    this.appStateService.toggleTheme();
  }

  openFilters(): void {
    this.draftProjectIds.set([...this.appliedProjectIds()]);
    this.draftClientIds.set([...this.appliedClientIds()]);
    this.draftManufacturerIds.set([...this.appliedManufacturerIds()]);
    this.draftTypes.set([...this.appliedTypes()]);
    this.draftStatuses.set([...this.appliedStatuses()]);
    this.showFilters.set(true);
  }

  closeFilters(): void {
    this.showFilters.set(false);
  }

  applyFilters(): void {
    this.appliedProjectIds.set([...this.draftProjectIds()]);
    this.appliedClientIds.set([...this.draftClientIds()]);
    this.appliedManufacturerIds.set([...this.draftManufacturerIds()]);
    this.appliedTypes.set([...this.draftTypes()]);
    this.appliedStatuses.set([...this.draftStatuses()]);
    this.showFilters.set(false);
    this.clearSelection();
  }

  resetFilters(): void {
    this.draftProjectIds.set([]);
    this.draftClientIds.set([]);
    this.draftManufacturerIds.set([]);
    this.draftTypes.set([]);
    this.draftStatuses.set([]);
    this.appliedProjectIds.set([]);
    this.appliedClientIds.set([]);
    this.appliedManufacturerIds.set([]);
    this.appliedTypes.set([]);
    this.appliedStatuses.set([]);
    this.clearSelection();
  }

  toggleDraftValue(kind: FleetFilterKind, value: string): void {
    switch (kind) {
      case 'projects':
        this.draftProjectIds.update((current) => toggleArrayValue(current, value));
        return;
      case 'clients':
        this.draftClientIds.update((current) => toggleArrayValue(current, value));
        return;
      case 'manufacturers':
        this.draftManufacturerIds.update((current) => toggleArrayValue(current, value));
        return;
      case 'types':
        this.draftTypes.update((current) => toggleArrayValue(current, value));
        return;
      case 'statuses':
        this.draftStatuses.update((current) => toggleArrayValue(current, value));
        return;
    }
  }

  removeChip(chip: FleetFilterChip): void {
    switch (chip.kind) {
      case 'projects':
        this.appliedProjectIds.update((current) => current.filter((value) => value !== chip.value));
        return;
      case 'clients':
        this.appliedClientIds.update((current) => current.filter((value) => value !== chip.value));
        return;
      case 'manufacturers':
        this.appliedManufacturerIds.update((current) => current.filter((value) => value !== chip.value));
        return;
      case 'types':
        this.appliedTypes.update((current) => current.filter((value) => value !== chip.value));
        return;
      case 'statuses':
        this.appliedStatuses.update((current) => current.filter((value) => value !== chip.value));
        return;
    }
  }

  handleViewEntity(
    type: FleetTab,
    entity: ApiProject | ApiClient | ApiManufacturer | ApiLocation,
  ): void {
    const nextSelection = buildSelectedEntity(type, entity);
    this.selectedEntity.set(nextSelection);
    this.mapFocusEntity.set(nextSelection);
    this.viewedProjectId.set(type === 'projects' ? (entity as ApiProject).id : null);
    this.activeTableTab.set(type);
  }

  setSelectedEntity(entity: FleetSelectedEntity | null): void {
    this.selectedEntity.set(entity);
    if (entity === null) {
      this.mapFocusEntity.set(null);
    }
  }

  clearSelection(): void {
    this.selectedEntity.set(null);
    this.mapFocusEntity.set(null);
    this.viewedProjectId.set(null);
  }
}
