import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { NgSelectModule } from '@ng-select/ng-select';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import { AuthService } from '../../../../shared/services/auth.service';
import {
  CreateTicketPayload,
  CreateTicketService,
  CreatedTicketResult,
  DefectLocationOption,
  DefectTypeOption,
  ProjectOption,
  StationOption,
  UserOption,
  VehicleOption,
} from './create-ticket.service';

interface AttachmentPreview {
  file: File;
  url: string;
  isImage: boolean;
}

@Component({
  selector: 'app-create-ticket',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, NgSelectModule],
  templateUrl: './create-ticket.component.html',
  styleUrl: './create-ticket.component.scss',
})
export class CreateTicketComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly createTicketService = inject(CreateTicketService);
  private readonly destroy$ = new Subject<void>();

  readonly maxAttachments = 5;
  readonly maxFileSizeBytes = 5 * 1024 * 1024;

  readonly ticketForm = this.fb.group({
    projectId: [null as number | null, Validators.required],
    vehicleId: [{ value: null as number | null, disabled: true }, Validators.required],
    stationId: [null as number | null, Validators.required],
    defectTypeId: [null as number | null, Validators.required],
    defectLocationId: [null as number | null, Validators.required],
    assignedById: [this.createTicketService.getCurrentUser().id, Validators.required],
    assignedToId: [null as number | null, Validators.required],
    safetyCritical: [false],
    repeater: [false],
    priority: ['low' as 'low' | 'medium' | 'high'],
    status: ['open' as 'open' | 'in-progress' | 'resolved' | 'closed'],
    resolvedDate: [''],
    description: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(1000)]],
  });

  projects: ProjectOption[] = [];
  vehicles: VehicleOption[] = [];
  stations: StationOption[] = [];
  defectTypes: DefectTypeOption[] = [];
  defectLocations: DefectLocationOption[] = [];
  assignableUsers: UserOption[] = [];
  currentUser: UserOption = this.createTicketService.getCurrentUser();

  selectedProject: ProjectOption | null = null;
  selectedVehicle: VehicleOption | null = null;
  savedTicket: CreatedTicketResult | null = null;
  attachmentPreviews: AttachmentPreview[] = [];

  loadingLookups = true;
  loadingVehicles = false;
  submitting = false;
  dragActive = false;
  submitted = false;
  submitError = '';
  submitSuccess = '';

  ngOnInit(): void {
    this.loadLookupData();
    this.setupFormSubscriptions();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.clearAttachmentPreviews();
  }

  get descriptionLength(): number {
    return String(this.ticketForm.get('description')?.value ?? '').length;
  }

  get showResolvedDate(): boolean {
    const status = this.ticketForm.get('status')?.value;
    return status === 'resolved' || status === 'closed';
  }

  get currentClientName(): string {
    return this.selectedProject?.clientName || 'Not selected';
  }

  get currentClientId(): number {
    return this.selectedProject?.clientId ?? 0;
  }

  get canOverrideAssignedBy(): boolean {
    return this.authService.hasRole(['admin', 'superadmin']);
  }

  get currentAssignedBy(): UserOption {
    const assignedById = Number(this.ticketForm.get('assignedById')?.value ?? this.currentUser.id);
    return this.assignableUsers.find((user) => user.id === assignedById) ?? this.currentUser;
  }

  get currentAssignedTo(): UserOption | null {
    const assignedToId = Number(this.ticketForm.get('assignedToId')?.value ?? 0);
    return this.assignableUsers.find((user) => user.id === assignedToId) ?? null;
  }

  get isAssignedByOverridden(): boolean {
    return this.canOverrideAssignedBy && this.currentAssignedBy.id !== this.currentUser.id;
  }

  get attachmentCount(): number {
    return this.attachmentPreviews.length;
  }

  backToTickets(): void {
    this.router.navigate(['/admin/tickets']);
  }

  onSubmit(): void {
    this.submitted = true;
    this.submitError = '';
    this.submitSuccess = '';

    if (this.ticketForm.invalid || !this.selectedProject) {
      this.ticketForm.markAllAsTouched();
      return;
    }

    const raw = this.ticketForm.getRawValue();
    const payload: CreateTicketPayload = {
      ticketDescription: String(raw.description ?? '').trim(),
      projectId: Number(raw.projectId),
      vehicleId: Number(raw.vehicleId),
      stationId: Number(raw.stationId),
      defectTypeId: Number(raw.defectTypeId),
      defectLocationId: Number(raw.defectLocationId),
      assignedById: Number(raw.assignedById || this.currentUser.id),
      assignedToId: Number(raw.assignedToId),
      safetyCritical: Boolean(raw.safetyCritical),
      repeater: Boolean(raw.repeater),
      priority: raw.priority ?? 'low',
      status: raw.status ?? 'open',
      resolvedDate: this.showResolvedDate && raw.resolvedDate ? raw.resolvedDate : undefined,
      clientId: this.currentClientId,
      attachments: this.attachmentPreviews.map((preview) => preview.file),
    };

    console.log('Create ticket payload', payload);

    this.submitting = true;
    this.createTicketService.createTicket(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.savedTicket = result;
          this.submitSuccess = `Ticket ${result.ticketNumber} created successfully.`;
          this.submitting = false;
          this.scrollToFeedback();
        },
        error: () => {
          this.submitError = 'Unable to create ticket right now. Please try again.';
          this.submitting = false;
          this.scrollToFeedback();
        },
      });
  }

  createAnother(): void {
    this.savedTicket = null;
    this.submitSuccess = '';
    this.submitError = '';
    this.submitted = false;
    this.selectedProject = null;
    this.selectedVehicle = null;
    this.vehicles = [];
    this.ticketForm.reset({
      projectId: null,
      vehicleId: null,
      stationId: null,
      defectTypeId: null,
      defectLocationId: null,
      assignedById: this.currentUser.id,
      assignedToId: null,
      safetyCritical: false,
      repeater: false,
      priority: 'low',
      status: 'open',
      resolvedDate: '',
      description: '',
    });
    this.ticketForm.get('vehicleId')?.disable({ emitEvent: false });
    this.clearAttachmentPreviews();
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragActive = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragActive = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragActive = false;
    const files = event.dataTransfer?.files;
    if (files?.length) {
      this.addFiles(files);
    }
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.addFiles(input.files);
    }
    input.value = '';
  }

  openFilePicker(input: HTMLInputElement): void {
    input.click();
  }

  removeAttachment(index: number): void {
    const preview = this.attachmentPreviews[index];
    if (preview) {
      URL.revokeObjectURL(preview.url);
    }
    this.attachmentPreviews.splice(index, 1);
  }

  getFieldError(fieldName: string): string {
    const control = this.ticketForm.get(fieldName);
    if (!control || !(control.touched || this.submitted) || !control.errors) {
      return '';
    }

    if (control.errors['required']) return 'This field is required.';
    if (control.errors['minlength']) return 'Description must be at least 10 characters.';
    if (control.errors['maxlength']) return 'Description cannot exceed 1000 characters.';
    return 'Please review this field.';
  }

  getStatusBadgeClass(status: string | null | undefined): string {
    switch (status) {
      case 'resolved':
        return 'bg-success-subtle text-success';
      case 'closed':
        return 'bg-secondary text-white';
      case 'in-progress':
        return 'bg-warning-subtle text-warning';
      default:
        return 'bg-primary-subtle text-primary';
    }
  }

  getPriorityBadgeClass(priority: string | null | undefined): string {
    switch (priority) {
      case 'high':
        return 'bg-danger-subtle text-danger';
      case 'medium':
        return 'bg-warning-subtle text-warning';
      default:
        return 'bg-success-subtle text-success';
    }
  }

  private loadLookupData(): void {
    this.loadingLookups = true;
    forkJoin({
      projects: this.createTicketService.getProjects(),
      stations: this.createTicketService.getStations(),
      defectTypes: this.createTicketService.getDefectTypes(),
      defectLocations: this.createTicketService.getDefectLocations(),
      assignableUsers: this.createTicketService.getAssignableUsers(),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ projects, stations, defectTypes, defectLocations, assignableUsers }) => {
          this.projects = projects;
          this.stations = stations;
          this.defectTypes = defectTypes;
          this.defectLocations = defectLocations;
          this.assignableUsers = assignableUsers;
          if (!this.assignableUsers.some((user) => user.id === this.currentUser.id)) {
            this.assignableUsers = [...this.assignableUsers, this.currentUser];
          }
          const assignedByControl = this.ticketForm.get('assignedById');
          if (!assignedByControl?.value) {
            assignedByControl?.setValue(this.currentUser.id, { emitEvent: false });
          }
          this.loadingLookups = false;
        },
        error: () => {
          this.loadingLookups = false;
          this.submitError = 'Unable to load ticket lookup data.';
        },
      });
  }

  private setupFormSubscriptions(): void {
    this.ticketForm.get('projectId')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((projectId) => {
        const numericProjectId = Number(projectId ?? 0);
        this.selectedProject = this.projects.find((project) => project.id === numericProjectId) ?? null;
        this.selectedVehicle = null;
        this.vehicles = [];
        this.ticketForm.patchValue({ vehicleId: null }, { emitEvent: false });

        if (numericProjectId > 0) {
          this.ticketForm.get('vehicleId')?.enable({ emitEvent: false });
          this.loadVehicles(numericProjectId);
          return;
        }

        this.ticketForm.get('vehicleId')?.disable({ emitEvent: false });
      });

    this.ticketForm.get('vehicleId')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((vehicleId) => {
        const numericVehicleId = Number(vehicleId ?? 0);
        this.selectedVehicle = this.vehicles.find((vehicle) => vehicle.id === numericVehicleId) ?? null;
      });

    this.ticketForm.get('status')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => {
        if (status === 'resolved' || status === 'closed') {
          if (!this.ticketForm.get('resolvedDate')?.value) {
            this.ticketForm.patchValue({
              resolvedDate: new Date().toISOString().slice(0, 10),
            }, { emitEvent: false });
          }
          return;
        }

        this.ticketForm.patchValue({ resolvedDate: '' }, { emitEvent: false });
      });
  }

  private loadVehicles(projectId: number): void {
    this.loadingVehicles = true;
    this.createTicketService.getVehiclesByProject(projectId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (vehicles) => {
          this.vehicles = vehicles;
          this.loadingVehicles = false;
        },
        error: () => {
          this.vehicles = [];
          this.loadingVehicles = false;
        },
      });
  }

  private addFiles(fileList: FileList): void {
    const nextFiles = Array.from(fileList);
    const openSlots = this.maxAttachments - this.attachmentPreviews.length;

    if (openSlots <= 0) {
      this.submitError = `You can upload a maximum of ${this.maxAttachments} attachments.`;
      return;
    }

    const acceptedFiles = nextFiles.slice(0, openSlots);
    const rejectedMessages: string[] = [];

    acceptedFiles.forEach((file) => {
      if (!file.type.startsWith('image/')) {
        rejectedMessages.push(`${file.name}: only image files are allowed.`);
        return;
      }

      if (file.size > this.maxFileSizeBytes) {
        rejectedMessages.push(`${file.name}: file size must be 5 MB or less.`);
        return;
      }

      this.attachmentPreviews.push({
        file,
        url: URL.createObjectURL(file),
        isImage: true,
      });
    });

    if (nextFiles.length > openSlots) {
      rejectedMessages.push(`Only ${openSlots} more attachment slot(s) were available.`);
    }

    this.submitError = rejectedMessages.join(' ');
  }

  private clearAttachmentPreviews(): void {
    this.attachmentPreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
    this.attachmentPreviews = [];
  }

  private scrollToFeedback(): void {
    requestAnimationFrame(() => {
      const alert = document.querySelector('.alert-danger, .alert-success');
      if (alert instanceof HTMLElement) {
        const top = window.scrollY + alert.getBoundingClientRect().top - 16;
        window.scrollTo({ top: Math.max(top, 0), behavior: 'auto' });
        return;
      }

      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  }
}
