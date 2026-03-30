import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ActivityLogRow,
  ClientManagementCreateRequest,
  ClientManagementDraft,
  ClientManagementRow,
  ClientManagementSaveRequest,
  DataManagementRowDraft,
  DataManagementSaveRequest,
  DataManagementTab,
  LocationManagementCreateRequest,
  LocationManagementDraft,
  LocationManagementRow,
  LocationManagementSaveRequest,
  ManufacturerManagementCreateRequest,
  ManufacturerManagementDraft,
  ManufacturerManagementRow,
  ManufacturerManagementSaveRequest,
  ProjectManagementCreateRequest,
} from '../../models/fleet-vm.models';
import { ActivityLogTableService } from '../../services/activity-log-table.service';
import {
  LocationMultiSelectComponent,
  LocationMultiSelectOption,
} from '../location-multi-select/location-multi-select.component';

type RowSize = 'compact' | 'default' | 'comfortable';
type DrawerEntity = 'project' | 'client' | 'manufacturer' | 'location' | null;
type DrawerMode = 'create' | 'edit';

const TABLE_HEIGHT_STORAGE_KEY = 'fleetpulse:data-table-height';
const ROW_SIZE_STORAGE_KEY = 'fleetpulse:data-table-row-size';
const TABLE_MIN_HEIGHT = 280;
const TABLE_MAX_HEIGHT = 620;
const TABLE_SAFE_VIEWPORT_OFFSET = 220;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const formatCoordinate = (value: number | null | undefined): string =>
  Number.isFinite(value) ? Number(value).toFixed(6) : '';

const getViewportMaxTableHeight = (): number => {
  if (typeof window === 'undefined') return TABLE_MAX_HEIGHT;
  const viewportLimit = window.innerHeight - TABLE_SAFE_VIEWPORT_OFFSET;
  return Math.max(TABLE_MIN_HEIGHT, Math.min(TABLE_MAX_HEIGHT, viewportLimit));
};

const clampTableHeight = (value: number, maxHeight = getViewportMaxTableHeight()): number =>
  Math.min(maxHeight, Math.max(TABLE_MIN_HEIGHT, value));

@Component({
  selector: 'app-fleet-activity-table',
  standalone: true,
  imports: [CommonModule, FormsModule, LocationMultiSelectComponent],
  templateUrl: './fleet-activity-table.component.html',
  styleUrl: './fleet-activity-table.component.scss',
  host: {
    '[class.inline-layout-host]': `layoutMode() === 'inline'`,
  },
})
export class FleetActivityTableComponent implements OnDestroy {
  rows = input<ActivityLogRow[]>([]);
  clientRows = input<ClientManagementRow[]>([]);
  manufacturerRows = input<ManufacturerManagementRow[]>([]);
  locationRows = input<LocationManagementRow[]>([]);
  canEdit = input<boolean>(true);
  open = input<boolean>(true);
  layoutMode = input<'overlay' | 'inline'>('overlay');
  selectedProjectId = input<string | null>(null);
  showClearFilters = input<boolean>(false);

  openChange = output<boolean>();
  rowView = output<ActivityLogRow>();
  rowDelete = output<ActivityLogRow>();
  rowSelected = output<string>();
  rowHovered = output<string | null>();
  rowSaveRequested = output<DataManagementSaveRequest>();
  rowCreateRequested = output<ProjectManagementCreateRequest>();
  clientView = output<ClientManagementRow>();
  manufacturerView = output<ManufacturerManagementRow>();
  locationView = output<LocationManagementRow>();
  clientSaveRequested = output<ClientManagementSaveRequest>();
  clientCreateRequested = output<ClientManagementCreateRequest>();
  manufacturerSaveRequested = output<ManufacturerManagementSaveRequest>();
  manufacturerCreateRequested = output<ManufacturerManagementCreateRequest>();
  locationSaveRequested = output<LocationManagementSaveRequest>();
  locationCreateRequested = output<LocationManagementCreateRequest>();
  clearFiltersRequested = output<void>();

  readonly activeTab = signal<DataManagementTab>('projects');
  readonly searchInput = signal('');
  readonly rowSize = signal<RowSize>(this.restoreRowSize());
  readonly tableHeight = signal<number>(this.restoreTableHeight());
  readonly isResizing = signal(false);

  readonly drawerOpen = signal(false);
  readonly drawerMode = signal<DrawerMode>('edit');
  readonly drawerEntity = signal<DrawerEntity>(null);
  readonly drawerSaving = signal(false);
  readonly drawerError = signal<string | null>(null);

  private readonly editingProjectRow = signal<ActivityLogRow | null>(null);
  private readonly editingClientRow = signal<ClientManagementRow | null>(null);
  private readonly editingManufacturerRow = signal<ManufacturerManagementRow | null>(null);
  private readonly editingLocationRow = signal<LocationManagementRow | null>(null);

  readonly projectDraft = signal<DataManagementRowDraft | null>(null);
  readonly clientDraft = signal<ClientManagementDraft | null>(null);
  readonly manufacturerDraft = signal<ManufacturerManagementDraft | null>(null);
  readonly locationDraft = signal<LocationManagementDraft | null>(null);

  readonly normalizedSearchTerm = computed(() => this.searchInput().trim().toLowerCase());
  readonly visibleRows = computed(() =>
    this.tableService.filterAndSearchRows(this.rows(), this.searchInput())
  );
  readonly visibleClientRows = computed(() => this.filterClientRows(this.clientRows(), this.normalizedSearchTerm()));
  readonly visibleManufacturerRows = computed(() =>
    this.filterManufacturerRows(this.manufacturerRows(), this.normalizedSearchTerm())
  );
  readonly visibleLocationRows = computed(() =>
    this.filterLocationRows(this.locationRows(), this.normalizedSearchTerm())
  );
  readonly entryCount = computed(() => {
    const tab = this.activeTab();
    if (tab === 'projects') return this.visibleRows().length;
    if (tab === 'clients') return this.visibleClientRows().length;
    if (tab === 'manufacturers') return this.visibleManufacturerRows().length;
    return this.visibleLocationRows().length;
  });

  readonly rowCellPaddingClass = computed(() => {
    const size = this.rowSize();
    if (size === 'compact') return 'cell compact';
    if (size === 'comfortable') return 'cell comfortable';
    return 'cell';
  });

  readonly locationOptions = computed<LocationMultiSelectOption[]>(() => {
    const options: LocationMultiSelectOption[] = [];
    for (const row of this.locationRows()) {
      const id = Number.parseInt(row.locationId, 10);
      if (!Number.isFinite(id)) continue;
      options.push({
        id,
        name: row.locationName,
        latitude: row.latitude,
        longitude: row.longitude,
      });
    }
    return options;
  });

  private resizeState: {
    startY: number;
    startHeight: number;
    pointerId: number;
    target: HTMLElement;
    previousCursor: string;
    previousUserSelect: string;
  } | null = null;
  private cleanupResizeListeners: (() => void) | null = null;
  private readonly handleWindowResize = () => {
    this.tableHeight.update((height) => clampTableHeight(height));
  };

  constructor(private readonly tableService: ActivityLogTableService) {
    effect(() => {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(TABLE_HEIGHT_STORAGE_KEY, String(this.tableHeight()));
    });

    effect(() => {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(ROW_SIZE_STORAGE_KEY, this.rowSize());
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleWindowResize);
    }
  }

  ngOnDestroy(): void {
    this.endResize();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleWindowResize);
    }
  }

  setActiveTab(tab: DataManagementTab): void {
    if (this.activeTab() === tab) return;
    this.activeTab.set(tab);
    if (tab !== 'projects') {
      this.rowHovered.emit(null);
    }
    this.closeDrawer();
  }

  isTabActive(tab: DataManagementTab): boolean {
    return this.activeTab() === tab;
  }

  togglePanel(): void {
    this.openChange.emit(!this.open());
  }

  onRowClicked(row: ActivityLogRow): void {
    if (this.activeTab() !== 'projects') return;
    this.rowSelected.emit(row.projectId);
  }

  onRowMouseEnter(row: ActivityLogRow): void {
    if (this.activeTab() !== 'projects') return;
    this.rowHovered.emit(row.projectId);
  }

  onRowMouseLeave(): void {
    if (this.activeTab() !== 'projects') return;
    this.rowHovered.emit(null);
  }

  openCreateDrawer(event?: MouseEvent): void {
    event?.stopPropagation();
    if (!this.canEdit()) return;

    this.drawerError.set(null);
    this.drawerMode.set('create');
    const tab = this.activeTab();

    if (tab === 'projects') {
      this.drawerEntity.set('project');
      this.editingProjectRow.set(null);
      this.projectDraft.set(this.createProjectDraft(null));
    } else if (tab === 'clients') {
      this.drawerEntity.set('client');
      this.editingClientRow.set(null);
      this.clientDraft.set(this.createClientDraft(null));
    } else if (tab === 'manufacturers') {
      this.drawerEntity.set('manufacturer');
      this.editingManufacturerRow.set(null);
      this.manufacturerDraft.set(this.createManufacturerDraft(null));
    } else {
      this.drawerEntity.set('location');
      this.editingLocationRow.set(null);
      this.locationDraft.set(this.createLocationDraft(null));
    }

    this.drawerOpen.set(true);
  }

  openProjectEdit(row: ActivityLogRow, event?: MouseEvent): void {
    event?.stopPropagation();
    if (!this.canEdit()) return;
    this.drawerError.set(null);
    this.drawerMode.set('edit');
    this.drawerEntity.set('project');
    this.editingProjectRow.set(row);
    this.projectDraft.set(this.createProjectDraft(row));
    this.rowSelected.emit(row.projectId);
    this.drawerOpen.set(true);
  }

  openClientEdit(row: ClientManagementRow, event?: MouseEvent): void {
    event?.stopPropagation();
    if (!this.canEdit()) return;
    this.drawerError.set(null);
    this.drawerMode.set('edit');
    this.drawerEntity.set('client');
    this.editingClientRow.set(row);
    this.clientDraft.set(this.createClientDraft(row));
    this.drawerOpen.set(true);
  }

  openManufacturerEdit(row: ManufacturerManagementRow, event?: MouseEvent): void {
    event?.stopPropagation();
    if (!this.canEdit()) return;
    this.drawerError.set(null);
    this.drawerMode.set('edit');
    this.drawerEntity.set('manufacturer');
    this.editingManufacturerRow.set(row);
    this.manufacturerDraft.set(this.createManufacturerDraft(row));
    this.drawerOpen.set(true);
  }

  openLocationEdit(row: LocationManagementRow, event?: MouseEvent): void {
    event?.stopPropagation();
    if (!this.canEdit()) return;
    this.drawerError.set(null);
    this.drawerMode.set('edit');
    this.drawerEntity.set('location');
    this.editingLocationRow.set(row);
    this.locationDraft.set(this.createLocationDraft(row));
    this.drawerOpen.set(true);
  }

  closeDrawer(event?: MouseEvent): void {
    event?.stopPropagation();
    this.drawerOpen.set(false);
    this.drawerSaving.set(false);
    this.drawerError.set(null);
    this.drawerEntity.set(null);
    this.editingProjectRow.set(null);
    this.editingClientRow.set(null);
    this.editingManufacturerRow.set(null);
    this.editingLocationRow.set(null);
  }

  async saveDrawer(event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    if (!this.canEdit()) return;

    const entity = this.drawerEntity();
    const mode = this.drawerMode();
    if (!entity) return;

    this.drawerSaving.set(true);
    this.drawerError.set(null);

    try {
      await new Promise<void>((resolve, reject) => {
        if (entity === 'project') {
          const draft = this.projectDraft();
          if (!draft) {
            reject(new Error('Project draft not initialized.'));
            return;
          }
          if (mode === 'edit') {
            const row = this.editingProjectRow();
            if (!row) {
              reject(new Error('Project row not selected.'));
              return;
            }
            this.rowSaveRequested.emit({ row, draft, resolve, reject });
            return;
          }
          this.rowCreateRequested.emit({ draft, resolve, reject });
          return;
        }

        if (entity === 'client') {
          const draft = this.clientDraft();
          if (!draft) {
            reject(new Error('Client draft not initialized.'));
            return;
          }
          if (mode === 'edit') {
            const row = this.editingClientRow();
            if (!row) {
              reject(new Error('Client row not selected.'));
              return;
            }
            this.clientSaveRequested.emit({ row, draft, resolve, reject });
            return;
          }
          this.clientCreateRequested.emit({ draft, resolve, reject });
          return;
        }

        if (entity === 'manufacturer') {
          const draft = this.manufacturerDraft();
          if (!draft) {
            reject(new Error('Manufacturer draft not initialized.'));
            return;
          }
          if (mode === 'edit') {
            const row = this.editingManufacturerRow();
            if (!row) {
              reject(new Error('Manufacturer row not selected.'));
              return;
            }
            this.manufacturerSaveRequested.emit({ row, draft, resolve, reject });
            return;
          }
          this.manufacturerCreateRequested.emit({ draft, resolve, reject });
          return;
        }

        const draft = this.locationDraft();
        if (!draft) {
          reject(new Error('Location draft not initialized.'));
          return;
        }
        if (mode === 'edit') {
          const row = this.editingLocationRow();
          if (!row) {
            reject(new Error('Location row not selected.'));
            return;
          }
          this.locationSaveRequested.emit({ row, draft, resolve, reject });
          return;
        }
        this.locationCreateRequested.emit({ draft, resolve, reject });
      });

      this.closeDrawer();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save.';
      this.drawerError.set(message);
    } finally {
      this.drawerSaving.set(false);
    }
  }

  patchProjectDraft(field: keyof DataManagementRowDraft['projectDraft'], value: string | boolean | number[]): void {
    const base = this.projectDraft();
    if (!base) return;
    this.projectDraft.set({
      ...base,
      projectDraft: {
        ...base.projectDraft,
        [field]: value,
      },
    });
  }

  patchClientDraft(field: keyof ClientManagementDraft, value: string | number[]): void {
    const base = this.clientDraft();
    if (!base) return;
    this.clientDraft.set({ ...base, [field]: value } as ClientManagementDraft);
  }

  patchManufacturerDraft(field: keyof ManufacturerManagementDraft, value: string | number[]): void {
    const base = this.manufacturerDraft();
    if (!base) return;
    this.manufacturerDraft.set({ ...base, [field]: value } as ManufacturerManagementDraft);
  }

  patchLocationDraft(field: keyof LocationManagementDraft, value: string): void {
    const base = this.locationDraft();
    if (!base) return;
    this.locationDraft.set({ ...base, [field]: value });
  }

  async onClientLogoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    if (!file) return;
    const error = this.validateLogoFile(file);
    if (error) {
      this.drawerError.set(error);
      if (input) input.value = '';
      return;
    }
    const encoded = await this.fileToDataUrl(file);
    this.patchClientDraft('customerLogo', encoded);
    this.patchClientDraft('customerLogoName', file.name);
  }

  async onManufacturerLogoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    if (!file) return;
    const error = this.validateLogoFile(file);
    if (error) {
      this.drawerError.set(error);
      if (input) input.value = '';
      return;
    }
    const encoded = await this.fileToDataUrl(file);
    this.patchManufacturerDraft('manufacturerLogo', encoded);
    this.patchManufacturerDraft('manufacturerLogoName', file.name);
  }

  statusClass(row: ActivityLogRow): string {
    if (row.status === 'Active') return 'status-pill status-active';
    if (row.status === 'Under Inspection') return 'status-pill status-inspection';
    return 'status-pill status-closed';
  }

  displayCoordinate(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return '--';
    return value.toFixed(6);
  }

  projectLocationChips(row: ActivityLogRow): string[] {
    const locationIds = this.resolveLocationIds(row.locationIds, row.locationId);
    if (locationIds.length === 0) return [];

    const locationById = new Map(
      this.locationRows().map((locationRow) => [Number.parseInt(locationRow.locationId, 10), locationRow.locationName])
    );

    return locationIds.map((locationId) => locationById.get(locationId) ?? `#${locationId}`);
  }

  onDeleteClicked(row: ActivityLogRow, event?: MouseEvent): void {
    event?.stopPropagation();
    this.rowDelete.emit(row);
  }

  onSearchTermChange(value: string): void {
    this.searchInput.set(value);
  }

  setRowSize(value: RowSize): void {
    this.rowSize.set(value);
  }

  beginResize(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    this.endResize();

    const target = event.currentTarget as HTMLElement;
    const pointerId = event.pointerId;
    this.resizeState = {
      startY: event.clientY,
      startHeight: this.tableHeight(),
      pointerId,
      target,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };

    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    this.isResizing.set(true);

    try {
      target.setPointerCapture(pointerId);
    } catch {
      // no-op
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!this.resizeState || moveEvent.pointerId !== this.resizeState.pointerId) return;
      const deltaY = this.resizeState.startY - moveEvent.clientY;
      const nextHeight = clampTableHeight(Math.round(this.resizeState.startHeight + deltaY));
      this.tableHeight.set(nextHeight);
    };

    const onPointerEnd = (endEvent: PointerEvent) => {
      if (!this.resizeState || endEvent.pointerId !== this.resizeState.pointerId) return;
      this.endResize();
    };

    const onWindowBlur = () => this.endResize();

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    window.addEventListener('blur', onWindowBlur);
    this.cleanupResizeListeners = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('blur', onWindowBlur);
    };
  }

  onResizeHandleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.tableHeight.update((height) => clampTableHeight(height + 24));
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.tableHeight.update((height) => clampTableHeight(height - 24));
    }
  }

  clearFilters(event?: MouseEvent): void {
    event?.stopPropagation();
    this.clearFiltersRequested.emit();
  }

  private endResize(): void {
    this.cleanupResizeListeners?.();
    this.cleanupResizeListeners = null;

    if (this.resizeState) {
      try {
        if (this.resizeState.target.hasPointerCapture(this.resizeState.pointerId)) {
          this.resizeState.target.releasePointerCapture(this.resizeState.pointerId);
        }
      } catch {
        // no-op
      }
      document.body.style.cursor = this.resizeState.previousCursor;
      document.body.style.userSelect = this.resizeState.previousUserSelect;
    }

    this.resizeState = null;
    this.isResizing.set(false);
  }

  private restoreTableHeight(): number {
    if (typeof localStorage === 'undefined') return 420;
    const raw = localStorage.getItem(TABLE_HEIGHT_STORAGE_KEY);
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampTableHeight(parsed) : clampTableHeight(420);
  }

  private restoreRowSize(): RowSize {
    if (typeof localStorage === 'undefined') return 'default';
    const raw = localStorage.getItem(ROW_SIZE_STORAGE_KEY);
    if (raw === 'compact' || raw === 'default' || raw === 'comfortable') {
      return raw;
    }
    return 'default';
  }

  private createProjectDraft(row: ActivityLogRow | null): DataManagementRowDraft {
    const locationIds = this.resolveLocationIds(row?.locationIds, row?.locationId ?? null);
    return {
      projectDraft: {
        name: row?.entityName || '',
        status: row?.status ?? 'Active',
        type: row?.projectTypeName || '',
        projectTypeId: row?.projectTypeId || '',
        contract: row?.contract || '',
        hasRoadTest: row?.hasRoadTest ?? false,
        clientId: row?.clientId ?? '',
        locationIds,
        manufacturerDisplay: row?.manufacturerName || 'Unknown',
      },
      locationDraft: {
        name: row?.locationName || '',
        latitude: '',
        longitude: '',
      },
      clientDraft: {
        name: row?.clientName || '',
        locationIds,
      },
      manufacturerDraft: {
        name: row?.manufacturerName || 'Unknown',
        locationId: row?.manufacturerLocationId ?? row?.locationId ?? '',
        locationIds,
        disabled: true,
      },
    };
  }

  private createClientDraft(row: ClientManagementRow | null): ClientManagementDraft {
    return {
      name: row?.clientName || '',
      locationIds: this.resolveLocationIds(row?.locationIds, row?.locationId ?? null),
      customerLogo: null,
      customerLogoName: null,
    };
  }

  private createManufacturerDraft(row: ManufacturerManagementRow | null): ManufacturerManagementDraft {
    return {
      name: row?.manufacturerName || '',
      locationIds: this.resolveLocationIds(row?.locationIds, row?.locationId ?? null),
      manufacturerLogo: null,
      manufacturerLogoName: null,
    };
  }

  private createLocationDraft(row: LocationManagementRow | null): LocationManagementDraft {
    return {
      name: row?.locationName || '',
      latitude: formatCoordinate(row?.latitude),
      longitude: formatCoordinate(row?.longitude),
    };
  }

  private resolveLocationIds(values: number[] | undefined, fallbackLocationId: string | number | null): number[] {
    if (Array.isArray(values) && values.length > 0) {
      return Array.from(new Set(values.map((value) => Number(value)).filter((value) => Number.isFinite(value))));
    }
    const fallback = Number.parseInt(String(fallbackLocationId ?? ''), 10);
    return Number.isFinite(fallback) ? [fallback] : [];
  }

  private filterClientRows(rows: ClientManagementRow[], term: string): ClientManagementRow[] {
    if (!term) return rows;
    return rows.filter((row) =>
      this.matchesSearch(term, [
        row.clientName,
        row.locationName,
        ...(row.linkedLocations?.map((entry) => entry.name) ?? []),
        String(row.projectCount),
      ])
    );
  }

  private filterManufacturerRows(rows: ManufacturerManagementRow[], term: string): ManufacturerManagementRow[] {
    if (!term) return rows;
    return rows.filter((row) =>
      this.matchesSearch(term, [
        row.manufacturerName,
        row.locationName,
        ...(row.linkedLocations?.map((entry) => entry.name) ?? []),
      ])
    );
  }

  private filterLocationRows(rows: LocationManagementRow[], term: string): LocationManagementRow[] {
    if (!term) return rows;
    return rows.filter((row) =>
      this.matchesSearch(term, [
        row.locationName,
        row.locationId,
        row.latitude != null ? String(row.latitude) : '',
        row.longitude != null ? String(row.longitude) : '',
      ])
    );
  }

  private matchesSearch(term: string, values: string[]): boolean {
    return values.join(' ').toLowerCase().includes(term);
  }

  private validateLogoFile(file: File): string | null {
    if (!file.type.startsWith('image/')) return 'Only image files are allowed.';
    if (file.size > MAX_LOGO_BYTES) return 'Logo file size must be 2MB or smaller.';
    return null;
  }

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Failed to read logo file.'));
      reader.readAsDataURL(file);
    });
  }
}
