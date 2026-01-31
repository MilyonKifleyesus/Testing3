import { AfterViewInit, Component, ElementRef, ViewChild, computed, effect, input, output, signal } from '@angular/core';
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
} from '../../../../../shared/models/war-room.interface';

@Component({
  selector: 'app-war-room-activity-log',
  imports: [CommonModule],
  templateUrl: './war-room-activity-log.component.html',
  styleUrl: './war-room-activity-log.component.scss',
})
export class WarRoomActivityLogComponent implements AfterViewInit {
  parentGroups = input.required<ParentGroup[]>();
  activityLogs = input.required<ActivityLog[]>();
  selectedEntity = input<FleetSelection | null>(null);
  editMode = input<boolean>(false);
  mapViewMode = input<MapViewMode>('parent');

  selectionChange = output<FleetSelection>();
  editModeChange = output<boolean>();
  factoryDetailsUpdated = output<{
    factoryId: string;
    name: string;
    location: string;
    description: string;
    status: NodeStatus;
  }>();
  subsidiaryDetailsUpdated = output<{
    subsidiaryId: string;
    name: string;
    location: string;
    description: string;
    status: OperationalStatus;
  }>();
  subsidiaryDeleted = output<string>();
  factoryDeleted = output<string>();

  @ViewChild('logList', { static: false }) logList?: ElementRef<HTMLElement>;
  private viewReady = false;

  readonly expandedParents = signal<string[]>([]);
  readonly expandedSubsidiaries = signal<string[]>([]);
  readonly editingFactoryId = signal<string | null>(null);
  readonly editingSubsidiaryId = signal<string | null>(null);
  readonly draftName = signal<string>('');
  readonly draftLocation = signal<string>('');
  readonly draftDescription = signal<string>('');
  readonly draftSubsidiaryName = signal<string>('');
  readonly draftSubsidiaryLocation = signal<string>('');
  readonly draftSubsidiaryDescription = signal<string>('');
  readonly draftFactoryStatus = signal<NodeStatus>('ACTIVE');
  readonly draftSubsidiaryStatus = signal<OperationalStatus>('ACTIVE');

  readonly latestLogByFactory = computed(() => {
    const logs = this.activityLogs();
    const map = new Map<string, ActivityLog>();

    for (const log of logs) {
      const existing = map.get(log.factoryId);
      if (!existing) {
        map.set(log.factoryId, log);
        continue;
      }
      const existingDate = typeof existing.timestamp === 'string' ? new Date(existing.timestamp) : existing.timestamp;
      const logDate = typeof log.timestamp === 'string' ? new Date(log.timestamp) : log.timestamp;
      if (logDate.getTime() > existingDate.getTime()) {
        map.set(log.factoryId, log);
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
      this.ensureExpandedForSelection(selection);
      this.scrollToSelection(selection);
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    const selection = this.selectedEntity();
    if (selection) {
      this.scrollToSelection(selection);
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

  onParentClick(group: ParentGroup): void {
    this.selectionChange.emit({ level: 'parent', id: group.id, parentGroupId: group.id });
  }

  onSubsidiaryClick(subsidiary: SubsidiaryCompany): void {
    if (this.mapViewMode() !== 'subsidiary') {
      return;
    }
    this.selectionChange.emit({
      level: 'subsidiary',
      id: subsidiary.id,
      parentGroupId: subsidiary.parentGroupId,
      subsidiaryId: subsidiary.id,
    });
  }

  onFactoryClick(factory: FactoryLocation): void {
    this.selectionChange.emit({
      level: 'factory',
      id: factory.id,
      parentGroupId: factory.parentGroupId,
      subsidiaryId: factory.subsidiaryId,
      factoryId: factory.id,
    });
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
    this.draftName.set(factory.name);
    this.draftLocation.set([factory.city, factory.country].filter(Boolean).join(', '));
    this.draftDescription.set(latestLog?.description || factory.description || '');
    this.draftFactoryStatus.set(factory.status);
  }

  startEditSubsidiary(subsidiary: SubsidiaryCompany): void {
    this.editingSubsidiaryId.set(subsidiary.id);
    this.draftSubsidiaryName.set(subsidiary.name);
    this.draftSubsidiaryLocation.set(subsidiary.location || this.getSubsidiaryLocation(subsidiary));
    this.draftSubsidiaryDescription.set(subsidiary.description || '');
    this.draftSubsidiaryStatus.set(subsidiary.status);
  }

  onNameInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.draftName.set(target?.value ?? '');
  }

  onLocationInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.draftLocation.set(target?.value ?? '');
  }

  onSubsidiaryNameInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.draftSubsidiaryName.set(target?.value ?? '');
  }

  onSubsidiaryLocationInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.draftSubsidiaryLocation.set(target?.value ?? '');
  }

  onSubsidiaryDescriptionInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement | null;
    this.draftSubsidiaryDescription.set(target?.value ?? '');
  }

  onFactoryStatusChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const value = target?.value as NodeStatus | undefined;
    if (value) {
      this.draftFactoryStatus.set(value);
    }
  }

  onSubsidiaryStatusChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const value = target?.value as OperationalStatus | undefined;
    if (value) {
      this.draftSubsidiaryStatus.set(value);
    }
  }

  onDescriptionInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement | null;
    this.draftDescription.set(target?.value ?? '');
  }

  saveFactoryDetails(factoryId: string): void {
    const name = this.draftName().trim();
    const location = this.draftLocation().trim();
    const description = this.draftDescription().trim();
    const status = this.draftFactoryStatus();
    this.factoryDetailsUpdated.emit({ factoryId, name, location, description, status });
    this.cancelEditFactory();
  }

  saveSubsidiaryDetails(subsidiaryId: string): void {
    const name = this.draftSubsidiaryName().trim();
    const location = this.draftSubsidiaryLocation().trim();
    const description = this.draftSubsidiaryDescription().trim();
    const status = this.draftSubsidiaryStatus();
    this.subsidiaryDetailsUpdated.emit({ subsidiaryId, name, location, description, status });
    this.cancelEditSubsidiary();
  }

  cancelEditFactory(): void {
    this.editingFactoryId.set(null);
    this.draftName.set('');
    this.draftLocation.set('');
    this.draftDescription.set('');
    this.draftFactoryStatus.set('ACTIVE');
  }

  cancelEditSubsidiary(): void {
    this.editingSubsidiaryId.set(null);
    this.draftSubsidiaryName.set('');
    this.draftSubsidiaryLocation.set('');
    this.draftSubsidiaryDescription.set('');
    this.draftSubsidiaryStatus.set('ACTIVE');
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

  getSubsidiaryLocation(subsidiary: SubsidiaryCompany): string {
    const factory = subsidiary.factories[0];
    if (!factory) return '';
    return this.formatLocation(factory.city, factory.country);
  }

  formatLocation(city: string, country?: string): string {
    if (!city && !country) return 'Unknown';
    if (!city) return country || 'Unknown';
    return country ? `${city}, ${country}` : city;
  }

  getStatusClass(status: string): string {
    const normalized = status.trim().toUpperCase();
    if (normalized === 'ACTIVE' || normalized === 'ONLINE') return 'status-active';
    if (normalized === 'WARNING' || normalized === 'MAINTENANCE') return 'status-warning';
    if (normalized === 'PAUSED' || normalized === 'OFFLINE' || normalized === 'INACTIVE') return 'status-paused';
    return 'status-info';
  }

  formatStatusLabel(status: string): string {
    const normalized = status.trim().toUpperCase();
    if (normalized === 'ACTIVE' || normalized === 'ONLINE' || normalized === 'OPTIMAL') {
      return 'ACTIVE';
    }
    return 'INACTIVE';
  }

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
}
