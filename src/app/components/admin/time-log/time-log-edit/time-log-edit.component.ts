import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { TimeLogService } from '../../../../shared/services/time-log.service';
import {
  LookupState,
  TimeLogLookupAdapterService,
} from '../../../../shared/services/time-log-lookup-adapter.service';
import {
  TimeLogPayload,
  TypeOfTime,
  TIME_OF_TIME_OPTIONS,
  TimeLogProject,
} from '../../../../shared/models/time-log.model';

@Component({
  selector: 'app-time-log-edit',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './time-log-edit.component.html',
  styleUrls: ['./time-log-edit.component.scss'],
})
export class TimeLogEditComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly toastr = inject(ToastrService);
  private readonly timeLogService = inject(TimeLogService);
  private readonly lookupAdapter = inject(TimeLogLookupAdapterService);
  private readonly destroy$ = new Subject<void>();

  editForm!: FormGroup;
  id: string | null = null;
  loading = true;
  saving = false;
  error: string | null = null;

  projects: TimeLogProject[] = [];
  vehicleOptions: { id: string; name: string }[] = [];
  users: { id: string; name: string }[] = [];
  typeOfTimeOptions = [...TIME_OF_TIME_OPTIONS];
  selectedProjectId = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id');
    if (!this.id) {
      this.router.navigate(['/admin/timesheet']);
      return;
    }

    this.editForm = this.fb.group({
      projectId: ['', Validators.required],
      vehicleId: ['', Validators.required],
      userId: ['', Validators.required],
      typeOfTime: ['', Validators.required],
      startDateTime: ['', Validators.required],
      spentTimeHours: [null as number | null, [Validators.required, Validators.min(0.01)]],
      description: [''],
    });

    this.editForm
      .get('projectId')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((projectId: string) => {
        const nextProjectId = String(projectId ?? '');
        const changed = this.selectedProjectId !== nextProjectId;
        this.selectedProjectId = nextProjectId;
        this.syncVehicleOptions(nextProjectId);
        if (changed) {
          this.editForm.patchValue({ vehicleId: '' }, { emitEvent: false });
        }
      });

    this.initializeLookups();
    this.timeLogService.getTimeLog(this.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (log) => {
        const startVal = log.startDate?.slice(0, 16) ?? '';
        this.editForm.patchValue({
          projectId: log.projectId,
          vehicleId: log.vehicleId,
          userId: log.userId,
          typeOfTime: log.typeOfTime,
          startDateTime: startVal,
          spentTimeHours: log.spentTimeHours,
          description: log.description ?? '',
        }, { emitEvent: false });
        this.selectedProjectId = log.projectId;
        this.syncVehicleOptions(log.projectId);
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.message ?? 'Failed to load time log';
        this.loading = false;
      },
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  backToList(): void {
    this.router.navigate(['/admin/timesheet']);
  }

  onSubmit(): void {
    if (this.editForm.invalid || !this.id) return;
    const v = this.editForm.value;
    const startDate = v.startDateTime?.length >= 16 ? v.startDateTime.slice(0, 16) : v.startDateTime;
    const payload: Partial<TimeLogPayload> = {
      projectId: v.projectId,
      vehicleId: v.vehicleId,
      userId: v.userId,
      typeOfTime: v.typeOfTime as TypeOfTime,
      startDate,
      spentTimeHours: Number(v.spentTimeHours),
      description: v.description ?? '',
    };
    this.saving = true;
    this.timeLogService.updateTimeLog(this.id, payload).subscribe({
      next: () => {
        this.toastr.success('Time log updated.');
        this.router.navigate(['/admin/timesheet']);
      },
      error: (err) => {
        this.saving = false;
        this.toastr.error(this.formatApiError(err, 'Failed to update.'));
      },
    });
  }

  get f() {
    return this.editForm.controls;
  }

  private initializeLookups(): void {
    this.lookupAdapter.lookups$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => this.handleLookupState(state));
    this.lookupAdapter.refresh('manual');
  }

  private handleLookupState(state: LookupState): void {
    this.projects = state.projects;
    this.users = state.users;
    this.syncVehicleOptions(this.selectedProjectId);
  }

  private syncVehicleOptions(projectId: string): void {
    if (!projectId) {
      this.vehicleOptions = [];
      return;
    }
    this.vehicleOptions = this.lookupAdapter
      .getVehiclesForProject(projectId)
      .map((vehicle) => ({
        id: vehicle.id,
        name: vehicle.fleetNumber,
      }));
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
