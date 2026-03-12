import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  TemplateRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Subject, debounceTime, switchMap, startWith, combineLatest, takeUntil, finalize } from 'rxjs';
import { NgbModal, NgbModalRef, NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { NgSelectComponent, NgSelectModule } from '@ng-select/ng-select';
import { ToastrService } from 'ngx-toastr';
import { TimeLogService } from '../../../../shared/services/time-log.service';
import { TimeLogLookupAdapterService } from '../../../../shared/services/time-log-lookup-adapter.service';
import {
  TimeLog,
  TimeLogFilter,
  TimeLogListParams,
  TimeLogUser,
  TIME_OF_TIME_OPTIONS,
} from '../../../../shared/models/time-log.model';
import { format, parseISO } from 'date-fns';

type SortField = keyof Pick<
  TimeLog,
  'id' | 'startDate' | 'spentTimeHours' | 'description' | 'projectName' | 'vehicleFleetNumber' | 'typeOfTime' | 'userName'
>;

interface FilterOption {
  id: string;
  name: string;
}

type DropdownSearchKey = 'project' | 'vehicle' | 'typeOfTime' | 'user';

@Component({
  selector: 'app-timesheet',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, NgbModule, NgSelectModule],
  templateUrl: './timesheet.component.html',
  styleUrls: ['./timesheet.component.scss'],
})
export class TimesheetComponent implements OnInit, OnDestroy {
  @ViewChild('deleteModal') deleteModal!: TemplateRef<unknown>;

  private readonly router = inject(Router);
  private readonly modal = inject(NgbModal);
  private readonly toastr = inject(ToastrService);
  private readonly timeLogService = inject(TimeLogService);
  private readonly lookupAdapter = inject(TimeLogLookupAdapterService);

  private readonly search$ = new Subject<string>();
  readonly refresh$ = new Subject<void>();
  private destroy$ = new Subject<void>();
  private rawItems: TimeLog[] = [];
  private readonly pendingUserNameHydration = new Set<string>();
  private readonly unresolvedUserIds = new Set<string>();

  confirmModalRef: NgbModalRef | null = null;
  confirmDeleteId: string | null = null;
  deleting = false;

  items: TimeLog[] = [];
  total = 0;
  loading = false;
  error: string | null = null;

  projectOptions: { id: string; name: string }[] = [];
  vehicleOptions: { id: string; name: string }[] = [];
  userOptions: TimeLogUser[] = [];
  typeOfTimeOptions = [...TIME_OF_TIME_OPTIONS];
  projectFilterOptions: FilterOption[] = [{ id: '', name: 'All Projects' }];
  vehicleFilterOptions: FilterOption[] = [{ id: '', name: 'All Vehicles' }];
  userFilterOptions: FilterOption[] = [{ id: '', name: 'All Users' }];
  typeOfTimeFilterOptions: FilterOption[] = [
    { id: '', name: 'All Types' },
    ...TIME_OF_TIME_OPTIONS.map((type) => ({ id: type, name: type })),
  ];
  lookupWarning: string | null = null;

  filters: TimeLogFilter = {};
  searchTerm = '';
  dropdownSearch: Record<DropdownSearchKey, string> = {
    project: '',
    vehicle: '',
    typeOfTime: '',
    user: '',
  };
  page = 1;
  pageSize = 25;
  sortBy: string = 'startDate';
  sortDirection: 'asc' | 'desc' = 'desc';

  Math = Math;

  ngOnInit(): void {
    this.initLookupData();

    combineLatest([
      this.search$.pipe(startWith(''), debounceTime(400)),
      this.refresh$.pipe(startWith(undefined)),
    ]).pipe(
        takeUntil(this.destroy$),
        switchMap(([debouncedSearch]) => {
          const params: TimeLogListParams = {
            page: this.page,
            pageSize: this.pageSize,
            sortBy: this.sortBy,
            sortDirection: this.sortDirection,
            ...this.filters,
            searchTerm: debouncedSearch || undefined,
          };
          this.loading = true;
          this.error = null;
          return this.timeLogService.getTimeLogs(params);
        })
      )
      .subscribe({
        next: (res) => {
          this.rawItems = res.items ?? [];
          this.applyLookupDisplayNames();
          this.total = res.total ?? 0;
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.message ?? 'Failed to load time logs';
          this.loading = false;
        },
      }
    );
  }

  private initLookupData(): void {
    this.lookupAdapter.lookups$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        this.projectOptions = state.projects.map((p) => ({
          id: p.id,
          name: p.name,
        }));
        this.vehicleOptions = state.vehicles.map((v) => ({
          id: v.id,
          name: v.fleetNumber,
        }));
        this.userOptions = state.users;
        this.rebuildFilterOptions();
        this.applyLookupDisplayNames();

        if (state.error) {
          this.lookupWarning = state.error;
        } else if (state.ready) {
          this.lookupWarning = null;
        }
      });

    this.lookupAdapter.refresh('manual');
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearch(): void {
    this.search$.next(this.searchTerm);
    this.page = 1;
  }

  onFilterChange(): void {
    this.page = 1;
    this.refresh$.next();
  }

  onDropdownSearch(select: NgSelectComponent, term: string): void {
    if (!select?.itemsList) return;
    const value = term ?? '';
    select.searchTerm = value;
    select.itemsList.filter(value);
    select.itemsList.markSelectedOrDefault(select.markFirst);
    select.detectChanges();
  }

  onDropdownClose(select: NgSelectComponent, key: DropdownSearchKey): void {
    this.dropdownSearch[key] = '';
    if (!select?.itemsList) return;
    select.searchTerm = '';
    select.itemsList.filter('');
  }

  clearFilters(): void {
    this.filters = {};
    this.searchTerm = '';
    this.page = 1;
    this.search$.next('');
    this.refresh$.next();
  }

  get hasActiveFilters(): boolean {
    return (
      !!this.searchTerm ||
      Object.values(this.filters).some((v) => v != null && v !== '')
    );
  }

  setSort(field: SortField): void {
    if (this.sortBy === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = field;
      this.sortDirection = 'asc';
    }
    this.page = 1;
    this.refresh$.next();
  }

  goToPage(p: number): void {
    const totalPages = this.getTotalPages();
    if (p < 1 || p > totalPages) return;
    this.page = p;
    this.refresh$.next();
  }

  getTotalPages(): number {
    return this.total ? Math.ceil(this.total / this.pageSize) : 0;
  }

  getPageNumbers(): number[] {
    const totalPages = this.getTotalPages();
    const max = 5;
    if (totalPages <= max) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (this.page <= 3) return [1, 2, 3, 4, 5];
    if (this.page >= totalPages - 2)
      return Array.from({ length: 5 }, (_, i) => totalPages - 4 + i);
    return Array.from({ length: 5 }, (_, i) => this.page - 2 + i);
  }

  formatDate(d: string): string {
    try {
      return format(parseISO(d), 'dd MMM yyyy HH:mm');
    } catch {
      return d;
    }
  }

  newTimeLog(): void {
    this.router.navigate(['/admin/timesheet/new']);
  }

  downloadReport(): void {
    if (this.items.length === 0) return;
    const headers = ['ID', 'Start Date', 'Spent Time (hours)', 'Description', 'Project', 'Vehicle', 'Type of Time', 'User'];
    const escape = (v: string | number | undefined) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = this.items.map((log) =>
      [
        log.id,
        this.formatDate(log.startDate),
        log.spentTimeHours,
        log.description ?? '',
        log.projectName ?? log.projectId,
        log.vehicleFleetNumber ?? log.vehicleId,
        log.typeOfTime,
        log.userName ?? log.userId,
      ].map(escape).join(',')
    );
    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `time-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  openDeleteModal(log: TimeLog): void {
    this.confirmDeleteId = log.id;
    this.confirmModalRef = this.modal.open(this.deleteModal, { centered: true });
  }

  closeDeleteModal(): void {
    this.confirmModalRef?.dismiss();
    this.confirmModalRef = null;
    this.confirmDeleteId = null;
    this.deleting = false;
  }

  confirmDelete(): void {
    if (!this.confirmDeleteId) return;
    this.deleting = true;
    this.timeLogService.deleteTimeLog(this.confirmDeleteId).subscribe({
      next: () => {
        this.closeDeleteModal();
        this.refresh$.next();
      },
      error: (err) => {
        this.deleting = false;
        this.toastr.error(this.formatApiError(err, 'Failed to delete time log.'));
      },
    });
  }

  private formatApiError(err: any, fallback: string): string {
    const status = Number(err?.status);
    const apiMessage = err?.error?.message ?? err?.error?.title ?? err?.message;
    if (status >= 400 && status < 500) {
      return `API validation failed (${status})${apiMessage ? `: ${apiMessage}` : ''}`;
    }
    if (status >= 500) {
      return `Server error (${status})${apiMessage ? `: ${apiMessage}` : ''}`;
    }
    return apiMessage || fallback;
  }

  private applyLookupDisplayNames(): void {
    const projectNamesById = new Map(this.projectOptions.map((project) => [project.id, project.name]));
    const vehicleNamesById = new Map(this.vehicleOptions.map((vehicle) => [vehicle.id, vehicle.name]));
    const userNamesById = new Map(this.userOptions.map((user) => [user.id, user.name]));

    this.items = this.rawItems.map((item) => ({
      ...item,
      projectName: this.resolveDisplayName(item.projectName, projectNamesById.get(item.projectId)),
      vehicleFleetNumber: this.resolveDisplayName(
        item.vehicleFleetNumber,
        vehicleNamesById.get(item.vehicleId)
      ),
      userName: this.resolveDisplayName(item.userName, userNamesById.get(item.userId)),
    }));

    this.hydrateMissingUsersById(userNamesById);
  }

  private resolveDisplayName(primary?: string, fallback?: string): string | undefined {
    const preferred = String(primary ?? '').trim();
    if (preferred) return preferred;
    const secondary = String(fallback ?? '').trim();
    return secondary || undefined;
  }

  private hydrateMissingUsersById(userNamesById: Map<string, string>): void {
    const missingUserIds = Array.from(
      new Set(
        this.rawItems
          .map((item) => item.userId)
          .filter((userId) => !!userId)
          .filter((userId) => !userNamesById.has(userId))
          .filter((userId) => !this.pendingUserNameHydration.has(userId))
          .filter((userId) => !this.unresolvedUserIds.has(userId))
      )
    );

    if (missingUserIds.length === 0) return;
    missingUserIds.forEach((id) => this.pendingUserNameHydration.add(id));

    this.lookupAdapter
      .resolveUsersByIds(missingUserIds)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          missingUserIds.forEach((id) => this.pendingUserNameHydration.delete(id));
        })
      )
      .subscribe((users) => {
        if (users.length === 0) {
          missingUserIds.forEach((id) => this.unresolvedUserIds.add(id));
          return;
        }

        const foundById = new Map(users.map((user) => [user.id, user.name]));
        for (const id of missingUserIds) {
          if (!foundById.has(id)) {
            this.unresolvedUserIds.add(id);
          }
        }

        if (users.length > 0) {
          const merged = new Map(this.userOptions.map((user) => [user.id, user]));
          users.forEach((user) => merged.set(user.id, user));
          this.userOptions = Array.from(merged.values());
          this.rebuildFilterOptions();
          this.applyLookupDisplayNames();
        }
      });
  }

  private rebuildFilterOptions(): void {
    this.projectFilterOptions = [
      { id: '', name: 'All Projects' },
      ...this.projectOptions.map((project) => ({
        id: project.id,
        name: project.name,
      })),
    ];
    this.vehicleFilterOptions = [
      { id: '', name: 'All Vehicles' },
      ...this.vehicleOptions.map((vehicle) => ({
        id: vehicle.id,
        name: vehicle.name,
      })),
    ];
    this.userFilterOptions = [
      { id: '', name: 'All Users' },
      ...this.userOptions.map((user) => ({
        id: user.id,
        name: user.name,
      })),
    ];
  }
}
