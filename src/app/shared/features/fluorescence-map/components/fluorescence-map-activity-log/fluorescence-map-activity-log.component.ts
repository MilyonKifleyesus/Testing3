import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ActivityLog,
  ParentGroup,
  SubsidiaryCompany,
  FactoryLocation,
  FleetSelection,
  MapViewMode,
  OperationalStatus,
  NodeStatus,
} from '../../../../models/fluorescence-map.interface';
import { WarRoomService } from '../../../../services/fluorescence-map.service';
import { FactoryEditPayload, SubsidiaryEditPayload } from '../../fluorescence-map.types';

export type ProjectStatusDisplay = 'active' | 'inactive' | 'none';
type CoordinateInput = string;

interface CoordinateDraftFields {
  latitude: CoordinateInput;
  longitude: CoordinateInput;
}

interface FactoryDraft extends CoordinateDraftFields {
  name: string;
  location: string;
  description: string;
  status: NodeStatus;
}

interface SubsidiaryDraft extends CoordinateDraftFields {
  name: string;
  location: string;
  description: string;
  status: OperationalStatus;
}

@Component({
  selector: 'app-war-room-activity-log',
  imports: [CommonModule],
  templateUrl: './fluorescence-map-activity-log.component.html',
  styleUrl: './fluorescence-map-activity-log.component.scss',
})
export class WarRoomActivityLogComponent implements AfterViewInit, OnDestroy {
  parentGroups = input.required<ParentGroup[]>();
  activityLogs = input.required<ActivityLog[]>();
  projectStatusByFactoryId = input<Map<string, ProjectStatusDisplay>>(new Map());
  selectedEntity = input<FleetSelection | null>(null);
  editMode = input<boolean>(false);
  mapViewMode = input<MapViewMode>('parent');
  isBusy = input<boolean>(false);

  selectionChange = output<FleetSelection>();
  editModeChange = output<boolean>();
  factoryDetailsUpdated = output<FactoryEditPayload>();
  readonly subsidiaryDetailsUpdated = output<SubsidiaryEditPayload>();
  readonly batchUpdateRequested = output<{ factories: FactoryEditPayload[]; subsidiaries: SubsidiaryEditPayload[] }>();
  subsidiaryDeleted = output<string>();
  factoryDeleted = output<string>();
  addProjectForFactory = output<{ factoryId: string; subsidiaryId: string }>();

  @ViewChild('logList', { static: false }) logList?: ElementRef<HTMLElement>;
  private viewReady = false;
  private refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastExpandedForSelection: { level: string; id: string } | null = null;

  readonly expandedParents = signal<string[]>([]);
  readonly expandedSubsidiaries = signal<string[]>([]);
  readonly refreshing = signal<boolean>(false);
  readonly factoryListExpanded = signal<Record<string, boolean>>({});
  readonly noProjectSitesExpanded = signal<Record<string, boolean>>({});
  readonly factoryLogPreviewExpanded = signal<Record<string, boolean>>({});
  readonly logPreviewCount = 3;
  private readonly factoryCollapseThreshold = 3;

  // Multi-item draft storage
  readonly factoryDrafts = signal<Map<string, FactoryDraft>>(new Map());
  readonly subsidiaryDrafts = signal<Map<string, SubsidiaryDraft>>(new Map());

  readonly editingFactoryId = signal<string | null>(null);
  readonly editingSubsidiaryId = signal<string | null>(null);
  readonly factoryValidationErrors = signal<Map<string, string>>(new Map());

  readonly manufacturerSearchQuery = signal<string>('');

  readonly filteredParentGroupsForDisplay = computed(() => {
    const groups = this.parentGroups();
    const q = this.manufacturerSearchQuery().trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        subsidiaries: g.subsidiaries.filter((s) => s.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.subsidiaries.length > 0);
  });

  readonly searchMatchCount = computed(() => {
    const filtered = this.filteredParentGroupsForDisplay();
    return filtered.reduce((sum, g) => sum + g.subsidiaries.length, 0);
  });

  readonly subsidiaryIdByFactoryId = computed(() => {
    const lookup = new Map<string, string>();
    for (const group of this.parentGroups()) {
      for (const subsidiary of group.subsidiaries) {
        for (const factory of subsidiary.factories ?? []) {
          lookup.set(factory.id, subsidiary.id);
        }
      }
    }
    return lookup;
  });

  readonly logsByFactoryId = computed(() => {
    const grouped = new Map<string, ActivityLog[]>();
    for (const log of this.activityLogs()) {
      const locationId = this.getLogLocationId(log);
      if (!locationId) continue;
      const existing = grouped.get(locationId);
      if (existing) {
        existing.push(log);
      } else {
        grouped.set(locationId, [log]);
      }
    }

    for (const [locationId, logs] of grouped.entries()) {
      grouped.set(locationId, logs.slice().sort((a, b) => this.compareLogsNewestFirst(a, b)));
    }
    return grouped;
  });

  readonly logsBySubsidiaryId = computed(() => {
    const grouped = new Map<string, ActivityLog[]>();
    for (const log of this.activityLogs()) {
      const subsidiaryId = this.getLogSubsidiaryId(log);
      if (!subsidiaryId) continue;
      const existing = grouped.get(subsidiaryId);
      if (existing) {
        existing.push(log);
      } else {
        grouped.set(subsidiaryId, [log]);
      }
    }

    for (const [subsidiaryId, logs] of grouped.entries()) {
      grouped.set(subsidiaryId, logs.slice().sort((a, b) => this.compareLogsNewestFirst(a, b)));
    }
    return grouped;
  });

  readonly latestLogByFactory = computed(() => {
    const map = new Map<string, ActivityLog>();
    for (const [locationId, logs] of this.logsByFactoryId().entries()) {
      if (logs.length > 0) {
        map.set(locationId, logs[0]);
      }
    }
    return map;
  });

  constructor() {
    effect(() => {
      const groups = this.parentGroups();
      if (groups.length > 0 && this.expandedParents().length === 0) {
        this.expandedParents.set(groups.map((group) => group.id));
      }
    });

    effect(() => {
      const selection = this.selectedEntity();
      if (!selection) return;
      const key = { level: selection.level, id: selection.id };
      const last = this.lastExpandedForSelection;
      const isNewSelection = !last || last.level !== key.level || last.id !== key.id;
      if (isNewSelection) {
        this.lastExpandedForSelection = key;
        this.ensureExpandedForSelection(selection);
      }
      this.scrollToSelection(selection);
    });

    effect(() => {
      this.parentGroups();
      this.activityLogs();
      this.mapViewMode();
      this.softRefresh();
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    const selection = this.selectedEntity();
    if (selection) {
      this.scrollToSelection(selection);
    }
    this.softRefresh();
  }

  ngOnDestroy(): void {
    if (this.refreshTimeoutId) {
      clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = null;
    }
  }

  formatTimestamp(timestamp: Date | string): string {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  refreshLayout(): void {
    this.queueRefresh(true);
  }

  isSelected(level: FleetSelection['level'], id: string): boolean {
    const selection = this.selectedEntity();
    return !!selection && selection.level === level && selection.id === id;
  }

  isParentExpanded(parentId: string): boolean {
    return this.expandedParents().includes(parentId);
  }

  isSubsidiaryExpanded(subsidiaryId: string): boolean {
    return this.expandedSubsidiaries().includes(subsidiaryId);
  }

  isFactoryListExpanded(subsidiaryId: string): boolean {
    return this.factoryListExpanded()[subsidiaryId] ?? false;
  }

  toggleFactoryList(subsidiaryId: string): void {
    this.factoryListExpanded.update((current) => ({
      ...current,
      [subsidiaryId]: !current[subsidiaryId],
    }));
  }

  hasNoProjectsButHasSites(subsidiary: SubsidiaryCompany): boolean {
    return this.getProjectStatusForSubsidiary(subsidiary) === 'none' && (subsidiary.factories ?? []).length > 0;
  }

  getNoSitesMessage(subsidiary: SubsidiaryCompany): string {
    const warning = subsidiary.description?.trim();
    return warning && warning.length > 0 ? warning : 'No sites for this manufacturer';
  }

  isNoProjectSitesExpanded(subsidiaryId: string): boolean {
    return this.noProjectSitesExpanded()[subsidiaryId] ?? false;
  }

  toggleNoProjectSites(subsidiaryId: string): void {
    this.noProjectSitesExpanded.update((current) => ({
      ...current,
      [subsidiaryId]: !current[subsidiaryId],
    }));
  }

  isFactoryLogPreviewExpanded(factoryId: string): boolean {
    return this.factoryLogPreviewExpanded()[factoryId] ?? false;
  }

  toggleFactoryLogPreview(factoryId: string): void {
    this.factoryLogPreviewExpanded.update((current) => ({
      ...current,
      [factoryId]: !current[factoryId],
    }));
  }

  toggleParent(parentId: string): void {
    this.expandedParents.update((current) =>
      current.includes(parentId) ? current.filter((id) => id !== parentId) : [...current, parentId]
    );
  }

  toggleSubsidiary(subsidiaryId: string): void {
    this.expandedSubsidiaries.update((current) =>
      current.includes(subsidiaryId)
        ? current.filter((id) => id !== subsidiaryId)
        : [...current, subsidiaryId]
    );
  }

  onParentHover(group: ParentGroup, isEntering: boolean): void {
    if (isEntering) {
      this.warRoomService.setHoveredEntity({
        level: 'parent',
        id: group.id,
        parentGroupId: group.id
      });
    } else {
      this.warRoomService.setHoveredEntity(null);
    }
  }

  onParentClick(group: ParentGroup): void {
    const selection: FleetSelection = { level: 'parent', id: group.id, parentGroupId: group.id };
    this.selectionChange.emit(selection);
    this.warRoomService.requestPanToEntity(group.id);
  }

  onSubsidiaryHover(subsidiary: SubsidiaryCompany, isEntering: boolean): void {
    const manufacturerLocationId = subsidiary.factories?.[0]?.id;
    if (isEntering) {
      this.warRoomService.setHoveredEntity({
        level: 'manufacturer',
        id: manufacturerLocationId ?? subsidiary.id,
        parentGroupId: subsidiary.parentGroupId,
        subsidiaryId: subsidiary.id,
        manufacturerLocationId: manufacturerLocationId ?? undefined,
        factoryId: manufacturerLocationId ?? undefined,
      });
    } else {
      this.warRoomService.setHoveredEntity(null);
    }
  }

  onSubsidiaryClick(subsidiary: SubsidiaryCompany): void {
    if (this.mapViewMode() !== 'manufacturer' && this.mapViewMode() !== 'project' && this.mapViewMode() !== 'client') {
      return;
    }
    const manufacturerLocationId = subsidiary.factories?.[0]?.id;
    this.toggleSubsidiary(subsidiary.id);
    const selection: FleetSelection = {
      level: 'manufacturer',
      id: manufacturerLocationId ?? subsidiary.id,
      parentGroupId: subsidiary.parentGroupId,
      subsidiaryId: subsidiary.id,
      manufacturerLocationId: manufacturerLocationId ?? undefined,
      factoryId: manufacturerLocationId ?? undefined,
    };
    this.selectionChange.emit(selection);
    this.warRoomService.requestPanToEntity(manufacturerLocationId ?? subsidiary.id);
  }

  isManufacturerRowSelected(subsidiary: SubsidiaryCompany): boolean {
    const selection = this.selectedEntity();
    if (!selection || selection.level !== 'manufacturer') return false;
    const locationIds = new Set((subsidiary.factories ?? []).map((factory) => factory.id));
    const selectedLocationId = selection.manufacturerLocationId ?? selection.factoryId ?? selection.id;
    return locationIds.has(selectedLocationId);
  }

  onFactoryHover(factory: FactoryLocation, isEntering: boolean): void {
    if (isEntering) {
      this.warRoomService.setHoveredEntity({
        level: 'factory',
        id: factory.id,
        parentGroupId: factory.parentGroupId,
        subsidiaryId: factory.subsidiaryId,
        factoryId: factory.id,
      });
    } else {
      this.warRoomService.setHoveredEntity(null);
    }
  }

  onFactoryClick(factory: FactoryLocation): void {
    const selection: FleetSelection = {
      level: 'factory',
      id: factory.id,
      parentGroupId: factory.parentGroupId,
      subsidiaryId: factory.subsidiaryId,
      factoryId: factory.id,
    };
    this.selectionChange.emit(selection);
    this.warRoomService.requestPanToEntity(factory.id);
  }

  toggleEditMode(): void {
    this.editModeChange.emit(!this.editMode());
    this.cancelEditFactory();
    this.cancelEditSubsidiary();
  }

  isEditingFactory(factoryId: string): boolean {
    return this.editingFactoryId() === factoryId;
  }

  isEditingSubsidiary(subsidiaryId: string): boolean {
    return this.editingSubsidiaryId() === subsidiaryId;
  }

  startEditFactory(factory: FactoryLocation): void {
    const latestLog = this.getLatestLog(factory.id);
    this.editingFactoryId.set(factory.id);
    if (factory.subsidiaryId) {
      this.expandedSubsidiaries.update((current) =>
        current.includes(factory.subsidiaryId) ? current : [...current, factory.subsidiaryId]
      );
    }

    // Initialize draft if not exists
    if (!this.factoryDrafts().has(factory.id)) {
      this.updateFactoryDraft(factory.id, {
        name: factory.name,
        location: [factory.city, factory.country].filter(Boolean).join(', '),
        description: latestLog?.description || factory.description || '',
        status: factory.status,
        latitude: this.toCoordinateInput(factory.coordinates?.latitude),
        longitude: this.toCoordinateInput(factory.coordinates?.longitude),
      });
    }
  }

  startEditSubsidiary(subsidiary: SubsidiaryCompany): void {
    this.editingSubsidiaryId.set(subsidiary.id);
    this.expandedSubsidiaries.update((current) =>
      current.includes(subsidiary.id) ? current : [...current, subsidiary.id]
    );

    // Initialize draft if not exists
    if (!this.subsidiaryDrafts().has(subsidiary.id)) {
      const firstLocationWithCoordinates = (subsidiary.factories ?? []).find((factory) =>
        Number.isFinite(factory.coordinates?.latitude) && Number.isFinite(factory.coordinates?.longitude)
      );
      this.updateSubsidiaryDraft(subsidiary.id, {
        name: subsidiary.name,
        location: subsidiary.location || this.getSubsidiaryLocation(subsidiary),
        description: subsidiary.description || '',
        status: subsidiary.status,
        latitude: this.toCoordinateInput(firstLocationWithCoordinates?.coordinates?.latitude),
        longitude: this.toCoordinateInput(firstLocationWithCoordinates?.coordinates?.longitude),
      });
    }
  }

  private updateFactoryDraft(id: string, updates: Partial<FactoryDraft>): void {
    const drafts = new Map(this.factoryDrafts());
    const existing: FactoryDraft = drafts.get(id) || {
      name: '',
      location: '',
      description: '',
      status: 'ACTIVE',
      latitude: '',
      longitude: '',
    };
    drafts.set(id, { ...existing, ...updates });
    this.factoryDrafts.set(drafts);
  }

  private updateSubsidiaryDraft(id: string, updates: Partial<SubsidiaryDraft>): void {
    const drafts = new Map(this.subsidiaryDrafts());
    const existing: SubsidiaryDraft = drafts.get(id) || {
      name: '',
      location: '',
      description: '',
      status: 'ACTIVE',
      latitude: '',
      longitude: '',
    };
    drafts.set(id, { ...existing, ...updates });
    this.subsidiaryDrafts.set(drafts);
  }

  onNameInput(event: Event, factoryId: string): void {
    const target = event.target as HTMLInputElement | null;
    this.updateFactoryDraft(factoryId, { name: target?.value ?? '' });
    this.clearFactoryValidationError(factoryId);
  }

  onLocationInput(event: Event, factoryId: string): void {
    const target = event.target as HTMLInputElement | null;
    this.updateFactoryDraft(factoryId, { location: target?.value ?? '' });
  }

  onFactoryLatitudeInput(event: Event, factoryId: string): void {
    const target = event.target as HTMLInputElement | null;
    this.updateFactoryDraft(factoryId, { latitude: target?.value ?? '' });
  }

  onFactoryLongitudeInput(event: Event, factoryId: string): void {
    const target = event.target as HTMLInputElement | null;
    this.updateFactoryDraft(factoryId, { longitude: target?.value ?? '' });
  }

  onSubsidiaryNameInput(event: Event, subsidiaryId: string): void {
    const target = event.target as HTMLInputElement | null;
    this.updateSubsidiaryDraft(subsidiaryId, { name: target?.value ?? '' });
  }

  onSubsidiaryLocationInput(event: Event, subsidiaryId: string): void {
    const target = event.target as HTMLInputElement | null;
    this.updateSubsidiaryDraft(subsidiaryId, { location: target?.value ?? '' });
  }

  onSubsidiaryLatitudeInput(event: Event, subsidiaryId: string): void {
    const target = event.target as HTMLInputElement | null;
    this.updateSubsidiaryDraft(subsidiaryId, { latitude: target?.value ?? '' });
  }

  onSubsidiaryLongitudeInput(event: Event, subsidiaryId: string): void {
    const target = event.target as HTMLInputElement | null;
    this.updateSubsidiaryDraft(subsidiaryId, { longitude: target?.value ?? '' });
  }

  onSubsidiaryDescriptionInput(event: Event, subsidiaryId: string): void {
    const target = event.target as HTMLTextAreaElement | null;
    this.updateSubsidiaryDraft(subsidiaryId, { description: target?.value ?? '' });
  }

  onFactoryStatusChange(event: Event, factoryId: string): void {
    const target = event.target as HTMLSelectElement | null;
    const value = target?.value as NodeStatus | undefined;
    if (value) {
      this.updateFactoryDraft(factoryId, { status: value });
    }
  }

  onSubsidiaryStatusChange(event: Event, subsidiaryId: string): void {
    const target = event.target as HTMLSelectElement | null;
    const value = target?.value as OperationalStatus | undefined;
    if (value) {
      this.updateSubsidiaryDraft(subsidiaryId, { status: value });
    }
  }

  onDescriptionInput(event: Event, factoryId: string): void {
    const target = event.target as HTMLTextAreaElement | null;
    this.updateFactoryDraft(factoryId, { description: target?.value ?? '' });
  }

  saveFactoryDetails(factoryId: string): void {
    const draft = this.factoryDrafts().get(factoryId);
    if (!draft || !draft.name.trim()) {
      this.setFactoryValidationError(factoryId, 'Factory name is required before saving.');
      return;
    }
    if (this.hasFactoryCoordinateValidationErrors(factoryId)) {
      this.setFactoryValidationError(factoryId, 'Enter valid latitude and longitude values.');
      return;
    }
    this.clearFactoryValidationError(factoryId);
    const latitude = this.parseCoordinateInput(draft.latitude);
    const longitude = this.parseCoordinateInput(draft.longitude);

    this.factoryDetailsUpdated.emit({
      factoryId,
      name: draft.name.trim(),
      location: draft.location.trim(),
      description: draft.description.trim(),
      status: draft.status,
      coordinates:
        latitude != null && longitude != null
          ? { latitude, longitude }
          : undefined,
    });

    this.removeFromDrafts('factory', factoryId);
    this.editingFactoryId.set(null);
  }

  saveSubsidiaryDetails(subsidiaryId: string): void {
    const draft = this.subsidiaryDrafts().get(subsidiaryId);
    if (!draft || !draft.name.trim()) {
      return;
    }
    if (this.hasSubsidiaryCoordinateValidationErrors(subsidiaryId)) {
      return;
    }

    const latitude = this.parseCoordinateInput(draft.latitude);
    const longitude = this.parseCoordinateInput(draft.longitude);
    this.subsidiaryDetailsUpdated.emit({
      subsidiaryId,
      name: draft.name.trim(),
      location: draft.location.trim(),
      description: draft.description.trim(),
      status: draft.status,
      coordinates:
        latitude != null && longitude != null
          ? { latitude, longitude }
          : undefined,
    });

    this.removeFromDrafts('subsidiary', subsidiaryId);
    this.editingSubsidiaryId.set(null);
  }

  cancelEditFactory(): void {
    if (this.editingFactoryId()) {
      this.removeFromDrafts('factory', this.editingFactoryId()!);
      this.editingFactoryId.set(null);
    }
  }

  cancelEditSubsidiary(): void {
    if (this.editingSubsidiaryId()) {
      this.removeFromDrafts('subsidiary', this.editingSubsidiaryId()!);
      this.editingSubsidiaryId.set(null);
    }
  }

  saveAllDrafts(): void {
    const factoryUpdates = Array.from(this.factoryDrafts().entries())
      .filter(([id, draft]) => draft.name.trim().length > 0 && !this.hasFactoryCoordinateValidationErrors(id))
      .map(([id, draft]) => {
        const latitude = this.parseCoordinateInput(draft.latitude);
        const longitude = this.parseCoordinateInput(draft.longitude);
        return {
          factoryId: id,
          name: draft.name.trim(),
          location: draft.location.trim(),
          description: draft.description.trim(),
          status: draft.status,
          coordinates:
            latitude != null && longitude != null
              ? { latitude, longitude }
              : undefined,
        };
      });

    const subsidiaryUpdates = Array.from(this.subsidiaryDrafts().entries())
      .filter(([id, draft]) => draft.name.trim().length > 0 && !this.hasSubsidiaryCoordinateValidationErrors(id))
      .map(([id, draft]) => {
        const latitude = this.parseCoordinateInput(draft.latitude);
        const longitude = this.parseCoordinateInput(draft.longitude);
        return {
          subsidiaryId: id,
          name: draft.name.trim(),
          location: draft.location.trim(),
          description: draft.description.trim(),
          status: draft.status,
          coordinates:
            latitude != null && longitude != null
              ? { latitude, longitude }
              : undefined,
        };
      });

    if (factoryUpdates.length === 0 && subsidiaryUpdates.length === 0) {
      this.clearAllDrafts();
      return;
    }

    // We emit the batch updates. The parent component will handle the persistence.
    // To satisfy the requirement of preserving drafts on failure, we don't clear them here anymore.
    // Instead, we added a clearDrafts() method for the parent to call.
    this.batchUpdateRequested.emit({ factories: factoryUpdates, subsidiaries: subsidiaryUpdates });
  }

  clearAllDrafts(): void {
    this.factoryDrafts.set(new Map());
    this.subsidiaryDrafts.set(new Map());
    this.editingFactoryId.set(null);
    this.editingSubsidiaryId.set(null);
  }

  private removeFromDrafts(type: 'factory' | 'subsidiary', id: string): void {
    if (type === 'factory') {
      const drafts = new Map(this.factoryDrafts());
      drafts.delete(id);
      this.factoryDrafts.set(drafts);
    } else {
      const drafts = new Map(this.subsidiaryDrafts());
      drafts.delete(id);
      this.subsidiaryDrafts.set(drafts);
    }
  }

  private setFactoryValidationError(factoryId: string, message: string): void {
    this.factoryValidationErrors.update((existing) => {
      const next = new Map(existing);
      next.set(factoryId, message);
      return next;
    });
  }

  private clearFactoryValidationError(factoryId: string): void {
    this.factoryValidationErrors.update((existing) => {
      if (!existing.has(factoryId)) return existing;
      const next = new Map(existing);
      next.delete(factoryId);
      return next;
    });
  }

  hasValidFactoryName(factoryId: string): boolean {
    return !!this.factoryDrafts().get(factoryId)?.name?.trim();
  }

  hasValidFactoryDraft(factoryId: string): boolean {
    return this.hasValidFactoryName(factoryId) && !this.hasFactoryCoordinateValidationErrors(factoryId);
  }

  hasValidSubsidiaryDraft(subsidiaryId: string): boolean {
    return !!this.subsidiaryDrafts().get(subsidiaryId)?.name?.trim() && !this.hasSubsidiaryCoordinateValidationErrors(subsidiaryId);
  }

  getFactoryLatitudeError(factoryId: string): string | null {
    const draft = this.factoryDrafts().get(factoryId);
    if (!draft) return null;
    return this.validateCoordinatePair(draft.latitude, draft.longitude).latitudeError;
  }

  getFactoryLongitudeError(factoryId: string): string | null {
    const draft = this.factoryDrafts().get(factoryId);
    if (!draft) return null;
    return this.validateCoordinatePair(draft.latitude, draft.longitude).longitudeError;
  }

  getSubsidiaryLatitudeError(subsidiaryId: string): string | null {
    const draft = this.subsidiaryDrafts().get(subsidiaryId);
    if (!draft) return null;
    return this.validateCoordinatePair(draft.latitude, draft.longitude).latitudeError;
  }

  getSubsidiaryLongitudeError(subsidiaryId: string): string | null {
    const draft = this.subsidiaryDrafts().get(subsidiaryId);
    if (!draft) return null;
    return this.validateCoordinatePair(draft.latitude, draft.longitude).longitudeError;
  }

  requestDeleteSubsidiary(subsidiaryId: string): void {
    this.subsidiaryDeleted.emit(subsidiaryId);
  }

  requestDeleteFactory(factoryId: string): void {
    this.factoryDeleted.emit(factoryId);
  }

  getLatestLog(factoryId: string): ActivityLog | null {
    return this.latestLogByFactory().get(factoryId) || null;
  }

  getLatestSubsidiaryLog(subsidiaryId: string): ActivityLog | null {
    return this.logsBySubsidiaryId().get(subsidiaryId)?.[0] ?? null;
  }

  getRecentSubsidiaryLogs(subsidiaryId: string, limit = this.logPreviewCount): ActivityLog[] {
    return (this.logsBySubsidiaryId().get(subsidiaryId) ?? []).slice(0, limit);
  }

  getLatestFactoryLog(factoryId: string): ActivityLog | null {
    return this.getLatestLog(factoryId);
  }

  getRecentFactoryLogs(factoryId: string, limit = this.logPreviewCount): ActivityLog[] {
    return (this.logsByFactoryId().get(factoryId) ?? []).slice(0, limit);
  }

  getFactoryLogElementId(factoryId: string): string {
    const safeFactoryId = factoryId.replace(/[^a-zA-Z0-9_-]/g, '-');
    return `factory-log-list-${safeFactoryId}`;
  }

  getActivityStatusClass(status: ActivityLog['status']): string {
    if (status === 'ACTIVE') return 'status-active';
    if (status === 'INFO') return 'status-info';
    if (status === 'WARNING') return 'status-warning';
    return 'status-error';
  }

  toIsoTimestamp(timestamp: Date | string): string | null {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }

  getSubsidiaryLocation(subsidiary: SubsidiaryCompany): string {
    const factory = subsidiary.factories?.[0];
    if (!factory) return '';
    return this.formatLocation(factory.city, factory.country);
  }

  formatLocation(city: string, country?: string): string {
    if (!city && !country) return 'Unknown';
    if (!city) return country || 'Unknown';
    return country ? `${city}, ${country}` : city;
  }

  getSubsidiaryDisplayLocation(subsidiary: SubsidiaryCompany): string {
    return (subsidiary.location || this.getSubsidiaryLocation(subsidiary) || '').trim();
  }

  shouldShowFactoryLocation(factory: FactoryLocation, parent: SubsidiaryCompany): boolean {
    const parentLocation = this.normalizeLocation(this.getSubsidiaryDisplayLocation(parent));
    const factoryLocation = this.normalizeLocation(this.formatLocation(factory.city, factory.country));
    return !parentLocation || !factoryLocation || parentLocation !== factoryLocation;
  }

  getFactoryLocationLabel(factory: FactoryLocation, parent: SubsidiaryCompany): string {
    if (!factory.city && !factory.country) {
      return 'Unavailable';
    }
    return this.formatLocation(factory.city, factory.country);
  }

  shouldCollapseFactories(subsidiary: SubsidiaryCompany): boolean {
    return (subsidiary.factories ?? []).length > this.factoryCollapseThreshold;
  }

  getVisibleFactories(subsidiary: SubsidiaryCompany): FactoryLocation[] {
    const factories = subsidiary.factories ?? [];
    if (!this.shouldCollapseFactories(subsidiary) || this.isFactoryListExpanded(subsidiary.id)) {
      return factories;
    }
    return factories.slice(0, this.factoryCollapseThreshold);
  }

  getHiddenFactoryCount(subsidiary: SubsidiaryCompany): number {
    if (!this.shouldCollapseFactories(subsidiary)) return 0;
    return Math.max(0, (subsidiary.factories ?? []).length - this.factoryCollapseThreshold);
  }

  getProjectStatusForFactory(factoryId: string): ProjectStatusDisplay {
    return this.projectStatusByFactoryId().get(factoryId) ?? 'none';
  }

  getProjectStatusForSubsidiary(subsidiary: SubsidiaryCompany): ProjectStatusDisplay {
    return (subsidiary.factories ?? []).reduce<ProjectStatusDisplay>((acc, f) => {
      const s = this.getProjectStatusForFactory(f.id);
      if (s === 'active') return 'active';
      if (s === 'inactive' && acc !== 'active') return 'inactive';
      return acc;
    }, 'none');
  }

  getStatusClass(projectStatus: ProjectStatusDisplay): string {
    if (projectStatus === 'active') return 'status-active';
    if (projectStatus === 'inactive') return 'status-inactive';
    return 'status-unassigned';
  }

  formatStatusLabel(projectStatus: ProjectStatusDisplay): string {
    if (projectStatus === 'active') return 'ACTIVE';
    if (projectStatus === 'inactive') return 'INACTIVE';
    return 'UNASSIGNED';
  }

  private normalizeLocation(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private toCoordinateInput(value: number | null | undefined): CoordinateInput {
    return Number.isFinite(value) ? String(value) : '';
  }

  private parseCoordinateInput(raw: string): number | null {
    const value = raw.trim();
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private hasFactoryCoordinateValidationErrors(factoryId: string): boolean {
    const draft = this.factoryDrafts().get(factoryId);
    if (!draft) return false;
    return this.validateCoordinatePair(draft.latitude, draft.longitude).hasErrors;
  }

  private hasSubsidiaryCoordinateValidationErrors(subsidiaryId: string): boolean {
    const draft = this.subsidiaryDrafts().get(subsidiaryId);
    if (!draft) return false;
    return this.validateCoordinatePair(draft.latitude, draft.longitude).hasErrors;
  }

  private validateCoordinatePair(
    latitudeRaw: string,
    longitudeRaw: string
  ): { latitudeError: string | null; longitudeError: string | null; hasErrors: boolean } {
    const latitudeText = latitudeRaw.trim();
    const longitudeText = longitudeRaw.trim();
    const latitudeProvided = latitudeText.length > 0;
    const longitudeProvided = longitudeText.length > 0;

    if (!latitudeProvided && !longitudeProvided) {
      return { latitudeError: null, longitudeError: null, hasErrors: false };
    }

    let latitudeError: string | null = null;
    let longitudeError: string | null = null;

    if (latitudeProvided && !longitudeProvided) {
      longitudeError = 'Longitude is required when latitude is set.';
    }
    if (!latitudeProvided && longitudeProvided) {
      latitudeError = 'Latitude is required when longitude is set.';
    }

    const latitude = this.parseCoordinateInput(latitudeText);
    const longitude = this.parseCoordinateInput(longitudeText);

    if (latitudeProvided && latitude == null) {
      latitudeError = 'Latitude must be a valid number.';
    }
    if (longitudeProvided && longitude == null) {
      longitudeError = 'Longitude must be a valid number.';
    }

    if (latitude != null && (latitude < -90 || latitude > 90)) {
      latitudeError = 'Latitude must be between -90 and 90.';
    }
    if (longitude != null && (longitude < -180 || longitude > 180)) {
      longitudeError = 'Longitude must be between -180 and 180.';
    }

    return {
      latitudeError,
      longitudeError,
      hasErrors: !!latitudeError || !!longitudeError,
    };
  }

  private getLogLocationId(log: ActivityLog): string | null {
    const locationId = (log.manufacturerLocationId ?? log.factoryId ?? '').trim();
    return locationId ? locationId : null;
  }

  private getLogSubsidiaryId(log: ActivityLog): string | null {
    const explicitSubsidiaryId = (log.subsidiaryId ?? '').trim();
    if (explicitSubsidiaryId) {
      return explicitSubsidiaryId;
    }
    const locationId = this.getLogLocationId(log);
    if (!locationId) {
      return null;
    }
    return this.subsidiaryIdByFactoryId().get(locationId) ?? null;
  }

  private toEpochMs(timestamp: Date | string): number {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const ms = date.getTime();
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
  }

  private compareLogsNewestFirst(a: ActivityLog, b: ActivityLog): number {
    const diff = this.toEpochMs(b.timestamp) - this.toEpochMs(a.timestamp);
    if (diff !== 0) {
      return diff;
    }
    return b.id.localeCompare(a.id);
  }

  getStatusIcon(projectStatus: ProjectStatusDisplay): string {
    if (projectStatus === 'active') return 'check_circle';
    if (projectStatus === 'inactive') return 'cancel';
    return 'help_outline';
  }

  private warRoomService = inject(WarRoomService);
  private cdr = inject(ChangeDetectorRef);
  private ensureExpandedForSelection(selection: FleetSelection): void {
    if (selection.parentGroupId) {
      this.expandedParents.update((current) =>
        current.includes(selection.parentGroupId!) ? current : [...current, selection.parentGroupId!]
      );
    }

    if (selection.subsidiaryId) {
      this.expandedSubsidiaries.update((current) =>
        current.includes(selection.subsidiaryId!) ? current : [...current, selection.subsidiaryId!]
      );
    }
  }

  private scrollToSelection(selection: FleetSelection): void {
    if (!this.viewReady) return;
    const container = this.logList?.nativeElement;
    if (!container) return;

    const entry = container.querySelector(`[data-entity-id="${selection.level}:${selection.id}"]`) as HTMLElement | null;
    if (!entry) return;

    requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const entryRect = entry.getBoundingClientRect();
      const currentScrollTop = container.scrollTop;
      const entryOffsetTop = entryRect.top - containerRect.top + currentScrollTop;
      const targetScrollTop = entryOffsetTop - container.clientHeight / 2 + entry.clientHeight / 2;
      container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
    });
  }

  private softRefresh(): void {
    if (!this.viewReady) return;
    requestAnimationFrame(() => {
      const selection = this.selectedEntity();
      if (selection) {
        this.scrollToSelection(selection);
      }
    });
  }

  private queueRefresh(showOverlay: boolean): void {
    if (!this.viewReady) return;
    if (this.refreshTimeoutId) {
      clearTimeout(this.refreshTimeoutId);
    }
    if (showOverlay) {
      this.refreshing.set(true);
      this.cdr.detectChanges();
    }
    requestAnimationFrame(() => {
      const selection = this.selectedEntity();
      if (selection) {
        this.scrollToSelection(selection);
      }
    });
    this.refreshTimeoutId = setTimeout(() => {
      if (showOverlay) {
        this.refreshing.set(false);
      }
      this.refreshTimeoutId = null;
    }, 350);
  }
}
