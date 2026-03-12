import {
  Component,
  OnDestroy,
  OnInit,
  TemplateRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { NgbModal, NgbModalRef, NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import { NgSelectComponent, NgSelectModule } from '@ng-select/ng-select';
import {
  Subject,
  takeUntil,
} from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import {
  BulkSubmitResult,
  TimeLogService,
} from '../../../../shared/services/time-log.service';
import {
  downloadTimesheetImportTemplate,
  ParseFileResult,
  matchAndValidate,
  parseFileDetailed,
  revalidateRow,
} from '../../../../shared/services/timesheet-excel.service';
import {
  LookupState,
  TimeLogLookupAdapterService,
} from '../../../../shared/services/time-log-lookup-adapter.service';
import {
  StagingRow,
  TIME_OF_TIME_OPTIONS,
  TimeLogPayload,
  TimeLogProject,
  TimeLogVehicle,
  TypeOfTime,
} from '../../../../shared/models/time-log.model';

type ManualDropdownSearchKey = 'project' | 'vehicle' | 'user' | 'typeOfTime';

@Component({
  selector: 'app-new-time-log',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, FormsModule, NgbNavModule, NgSelectModule],
  templateUrl: './new-time-log.component.html',
  styleUrls: ['./new-time-log.component.scss'],
})
export class NewTimeLogComponent implements OnInit, OnDestroy {
  @ViewChild('confirmDiscardModal') confirmDiscardModal!: TemplateRef<unknown>;

  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly modal = inject(NgbModal);
  private readonly toastr = inject(ToastrService);
  private readonly timeLogService = inject(TimeLogService);
  private readonly lookupAdapter = inject(TimeLogLookupAdapterService);
  private readonly destroy$ = new Subject<void>();

  readonly stagingRows = signal<StagingRow[]>([]);
  readonly activeTab = signal<'manual' | 'import'>('manual');
  readonly refDataLoading = signal(true);
  readonly lookupsReady = signal(false);
  readonly importParsing = signal(false);
  readonly submitLoading = signal(false);
  readonly manualAddLoading = signal(false);
  readonly importSummary = signal<{
    matched: number;
    warning: number;
    error: number;
    skipped: number;
  } | null>(null);

  projects: TimeLogProject[] = [];
  vehicles: TimeLogVehicle[] = [];
  vehicleOptions: { id: string; name: string }[] = [];
  allVehiclesForImport: TimeLogVehicle[] = [];
  users: { id: string; name: string }[] = [];
  typeOfTimeOptions = [...TIME_OF_TIME_OPTIONS];
  projectSelectOptions: { id: string; name: string }[] = [{ id: '', name: 'Select project...' }];
  vehicleSelectOptions: { id: string; name: string }[] = [{ id: '', name: 'Select vehicle...' }];
  userSelectOptions: { id: string; name: string }[] = [{ id: '', name: 'Select user...' }];
  typeOfTimeSelectOptions: { id: string; name: string }[] = [
    { id: '', name: 'Select type...' },
    ...TIME_OF_TIME_OPTIONS.map((type) => ({ id: type, name: type })),
  ];
  manualDropdownSearch: Record<ManualDropdownSearchKey, string> = {
    project: '',
    vehicle: '',
    user: '',
    typeOfTime: '',
  };
  lookupWarning: string | null = null;

  manualForm!: FormGroup;
  selectedProjectId = '';
  private modalRef: NgbModalRef | null = null;

  canSubmit = computed(() => {
    const rows = this.stagingRows();
    return rows.length > 0 && rows.every((r) => r._status !== 'error');
  });

  ngOnInit(): void {
    this.manualForm = this.fb.group({
      projectId: ['', Validators.required],
      vehicleId: ['', Validators.required],
      userId: ['', Validators.required],
      typeOfTime: ['', Validators.required],
      startDateTime: ['', Validators.required],
      spentTimeHours: [null as number | null, [Validators.required, Validators.min(0.01)]],
      description: [''],
    });

    this.manualForm
      .get('projectId')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((projectId: string) => {
        this.selectedProjectId = projectId ?? '';
        this.manualForm.patchValue({ vehicleId: '' }, { emitEvent: false });
        this.syncManualVehiclesForProject(this.selectedProjectId);
      });

    this.initializeLookups();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  backToTimeLogs(): void {
    this.router.navigate(['/admin/timesheet']);
  }

  setTab(tab: 'manual' | 'import'): void {
    this.activeTab.set(tab);
  }

  onAddFromManual(): void {
    if (this.manualForm.invalid || !this.lookupsReady() || this.manualAddLoading()) return;
    this.manualAddLoading.set(true);
    try {
      const v = this.manualForm.value;
      const startDate =
        v.startDateTime && v.startDateTime.length >= 16
          ? v.startDateTime.slice(0, 16)
          : v.startDateTime;
      const row: StagingRow = {
        _id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        _status: 'matched',
        _source: 'manual',
        _errors: [],
        _warnings: [],
        startDate,
        spentTimeHours: Number(v.spentTimeHours),
        description: v.description ?? '',
        projectId: String(v.projectId ?? ''),
        vehicleId: String(v.vehicleId ?? ''),
        typeOfTime: String(v.typeOfTime ?? ''),
        userId: String(v.userId ?? ''),
      };
      const validated = revalidateRow(row, this.projects, this.getAllVehiclesForImport());
      this.stagingRows.update((prev) => [...prev, validated]);
      this.manualForm.reset({
        projectId: '',
        vehicleId: '',
        userId: '',
        typeOfTime: '',
        startDateTime: '',
        spentTimeHours: null,
        description: '',
      });
      this.selectedProjectId = '';
      this.vehicleOptions = [];
      this.vehicles = [];
    } finally {
      setTimeout(() => this.manualAddLoading.set(false), 400);
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !file.name.match(/\.(xlsx|xls|csv)$/i)) {
      this.toastr.error('Please choose a valid .xlsx, .xls, or .csv file.');
      return;
    }
    if (!this.lookupsReady()) {
      this.toastr.warning('Lookups are still loading. Please wait.');
      return;
    }
    this.importParsing.set(true);
    this.importSummary.set(null);
    try {
      const parsed: ParseFileResult = await parseFileDetailed(file);
      const vehiclesForImport = this.getAllVehiclesForImport();
      const rows = matchAndValidate(parsed.rows, this.projects, vehiclesForImport, this.users);
      this.stagingRows.update((prev) => [...prev, ...rows]);

      const matched = rows.filter((r) => r._status === 'matched').length;
      const warning = rows.filter((r) => r._status === 'warning').length;
      const error = rows.filter((r) => r._status === 'error').length;
      this.importSummary.set({
        matched,
        warning,
        error,
        skipped: parsed.skippedRows,
      });

      if (parsed.warnings.length > 0) {
        parsed.warnings.forEach((w) => this.toastr.warning(w, 'Import warning'));
      }
      this.toastr.success(
        `Imported ${rows.length} row(s): ${matched} matched, ${warning} warning, ${error} error, ${parsed.skippedRows} skipped.`
      );
    } catch (err: any) {
      this.toastr.error(err?.message ?? 'Failed to parse file.');
    } finally {
      this.importParsing.set(false);
      input.value = '';
    }
  }

  async onDownloadTemplate(): Promise<void> {
    const allVehicles = this.getAllVehiclesForImport();
    const sampleProject = this.projects[0]?.name ?? 'Project Name';
    const sampleUser = this.users[0]?.name ?? 'User Name';
    const sampleType = this.typeOfTimeOptions[0] ?? 'Production';
    const preferredVehicle =
      allVehicles.find((v) => /^(lf76-104|7215)$/i.test(v.fleetNumber))?.fleetNumber ??
      allVehicles[0]?.fleetNumber ??
      'LF76-104';
    const numericVehicle =
      allVehicles.find((v) => /^\d+$/.test(v.fleetNumber))?.fleetNumber ??
      (preferredVehicle === '7215' ? preferredVehicle : '7215');

    try {
      await downloadTimesheetImportTemplate({
        rows: [
          {
            description: 'Sample row - update values before import',
            project: sampleProject,
            vehicle: preferredVehicle,
            typeOfTime: sampleType,
            user: sampleUser,
          },
          {
            description: 'Vehicle example using numeric fleet number',
            project: sampleProject,
            vehicle: numericVehicle,
            typeOfTime: sampleType,
            user: sampleUser,
          },
        ],
      });
      this.toastr.success('Template downloaded.');
    } catch (err: any) {
      this.toastr.error(err?.message ?? 'Failed to download template.');
    }
  }

  onUpdateRow(id: string, patch: Partial<StagingRow>): void {
    const vehicles = this.getAllVehiclesForImport();
    this.stagingRows.update((prev) =>
      prev.map((r) => {
        if (r._id !== id) return r;
        const shouldResetVehicle =
          patch.projectId !== undefined &&
          patch.projectId !== r.projectId &&
          patch.vehicleId === undefined;
        const safePatch = shouldResetVehicle ? { ...patch, vehicleId: '' } : patch;
        const updated = { ...r, ...safePatch };
        return revalidateRow(updated, this.projects, vehicles);
      })
    );
  }

  onProjectChanged(rowId: string, projectId: string): void {
    this.onUpdateRow(rowId, { projectId, vehicleId: '' });
  }

  onDeleteRow(id: string): void {
    if (this.submitLoading()) return;
    this.stagingRows.update((prev) => prev.filter((r) => r._id !== id));
  }

  onManualDropdownSearch(select: NgSelectComponent, term: string): void {
    if (!select?.itemsList) return;
    const value = term ?? '';
    select.searchTerm = value;
    select.itemsList.filter(value);
    select.itemsList.markSelectedOrDefault(select.markFirst);
    select.detectChanges();
  }

  onManualDropdownClose(select: NgSelectComponent, key: ManualDropdownSearchKey): void {
    this.manualDropdownSearch[key] = '';
    if (!select?.itemsList) return;
    select.searchTerm = '';
    select.itemsList.filter('');
  }

  onDiscardAll(): void {
    if (this.stagingRows().length === 0 || this.submitLoading()) return;
    this.modalRef = this.modal.open(this.confirmDiscardModal, { centered: true });
  }

  confirmDiscard(): void {
    this.stagingRows.set([]);
    this.modalRef?.close();
    this.modalRef = null;
    this.toastr.info('Staging table cleared.');
  }

  cancelDiscard(): void {
    this.modalRef?.dismiss();
    this.modalRef = null;
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;
    const rows = this.stagingRows().filter((r) => r._status !== 'error');
    const payloads: TimeLogPayload[] = rows.map((r) => ({
      projectId: r.projectId,
      vehicleId: r.vehicleId,
      userId: r.userId,
      typeOfTime: r.typeOfTime as TypeOfTime,
      startDate: r.startDate,
      spentTimeHours: Number(r.spentTimeHours),
      description: r.description,
    }));
    this.submitLoading.set(true);
    this.timeLogService.bulkCreateTimeLogs(payloads).subscribe({
      next: (result: BulkSubmitResult) => {
        this.submitLoading.set(false);
        if (result.failureCount === 0) {
          this.toastr.success(`${result.successCount} time log(s) submitted.`);
          this.stagingRows.set([]);
          this.router.navigate(['/admin/timesheet']);
        } else {
          this.toastr.warning(
            `${result.successCount} submitted, ${result.failureCount} failed.`,
            'Partial failure',
            { timeOut: 5000 }
          );
          if (result.errors?.length) {
            result.errors.forEach((e) => this.toastr.error(e, '', { timeOut: 3000 }));
          }
        }
      },
      error: (err) => {
        this.submitLoading.set(false);
        this.toastr.error(this.formatApiError(err, 'Failed to submit.'));
      },
    });
  }

  getProjectName(id: string): string {
    return this.projects.find((p) => p.id === id)?.name ?? id;
  }

  getVehicleName(id: string): string {
    return this.getAllVehiclesForImport().find((v) => v.id === id)?.fleetNumber ?? id;
  }

  getUserName(id: string): string {
    return this.users.find((i) => i.id === id)?.name ?? id;
  }

  getVehiclesForProject(projectId: string): TimeLogVehicle[] {
    if (!projectId) return this.getAllVehiclesForImport();
    return this.lookupAdapter.getVehiclesForProject(projectId);
  }

  get f() {
    return this.manualForm.controls;
  }

  private initializeLookups(): void {
    this.lookupAdapter.lookups$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => this.handleUnifiedLookupState(state));
    this.lookupAdapter.refresh('manual');
  }

  private handleUnifiedLookupState(state: LookupState): void {
    this.refDataLoading.set(state.loading);
    this.projects = state.projects;
    this.users = state.users;
    this.allVehiclesForImport = state.vehicles;
    this.projectSelectOptions = [
      { id: '', name: 'Select project...' },
      ...this.projects.map((project) => ({ id: project.id, name: project.name })),
    ];
    this.userSelectOptions = [
      { id: '', name: 'Select user...' },
      ...this.users.map((user) => ({ id: user.id, name: user.name })),
    ];
    this.syncManualVehiclesForProject(this.selectedProjectId);
    this.lookupsReady.set(
      state.ready &&
        state.projects.length > 0 &&
        state.vehicles.length > 0 &&
        this.users.length > 0
    );

    if (state.error) {
      this.lookupWarning = state.error;
    } else if (state.ready) {
      this.lookupWarning = null;
    }
  }

  private syncManualVehiclesForProject(projectId: string): void {
    const vehiclesForSelection = projectId
      ? this.getVehiclesForProject(projectId)
      : this.getAllVehiclesForImport();
    this.vehicles = vehiclesForSelection;
    this.vehicleOptions = vehiclesForSelection.map((v) => ({
      id: v.id,
      name: v.fleetNumber,
    }));
    this.vehicleSelectOptions = [
      { id: '', name: 'Select vehicle...' },
      ...this.vehicleOptions,
    ];
  }

  private getAllVehiclesForImport(): TimeLogVehicle[] {
    if (this.allVehiclesForImport.length > 0) return this.allVehiclesForImport;
    return this.vehicles;
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
}
