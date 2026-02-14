import { Component, input, output, signal, inject, HostListener, effect, ElementRef, Renderer2, OnDestroy, HostBinding, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { A11yModule } from '@angular/cdk/a11y';
import { toSignal } from '@angular/core/rxjs-interop';
import { Client } from '../../../../../shared/models/client.model';
import { ProjectService, FactoryOption } from '../../../../../shared/services/project.service';

export interface ProjectFormData {
  clientId: string;
  clientName: string;
  factoryId: number;
  manufacturerId: number;
  manufacturerName: string;
  projectName: string;
  assessmentType: string;
  status: 'Active' | 'Inactive';
  location?: string;
  notes?: string;
}

@Component({
  selector: 'app-add-company-modal',
  imports: [CommonModule, FormsModule, A11yModule, NgSelectModule],
  templateUrl: './add-company-modal.component.html',
  styleUrl: './add-company-modal.component.scss',
})
export class AddCompanyModalComponent implements OnDestroy {
  // Inputs
  isVisible = input<boolean>(false);
  /** When true, overlay is positioned over the map area only (no moveToBody, absolute positioning) */
  useMapPositioning = input<boolean>(false);
  /** Clients for Step 1 dropdown */
  clients = input<Client[]>([]);

  // Outputs
  projectAdded = output<ProjectFormData>();
  close = output<void>();

  // Services
  private projectService = inject(ProjectService);
  private elementRef = inject(ElementRef);
  private renderer = inject(Renderer2);

  // Form data
  clientId = signal<string | null>(null);
  selectedFactory = signal<FactoryOption | null>(null);
  projectName = signal<string>('');
  assessmentType = signal<string>('');
  projectStatus = signal<'Active' | 'Inactive'>('Active');
  location = signal<string>('');
  notes = signal<string>('');

  // Step state (1–4)
  currentStep = signal<1 | 2 | 3 | 4>(1);

  readonly factoryOptions = toSignal(this.projectService.getFactoriesWithManufacturers(), { initialValue: [] as FactoryOption[] });
  readonly projectTypes = toSignal(this.projectService.getProjectTypes(), { initialValue: [] as string[] });

  readonly canProceedToStep2 = computed(() => !!this.clientId());

  readonly canProceedToStep3 = computed(() => !!this.selectedFactory());

  readonly canProceedToStep4 = computed(() => {
    const name = this.projectName().trim();
    const type = this.assessmentType().trim();
    return !!name && !!type;
  });

  readonly isFormValid = computed(() => {
    return this.canProceedToStep2() && this.canProceedToStep3() && this.canProceedToStep4();
  });

  // Form state
  loading = signal<boolean>(false);
  private closeAfterSuccessTimerId: ReturnType<typeof setTimeout> | null = null;
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  submissionState = signal<'IDLE' | 'SUBMITTING' | 'SUCCESS' | 'ERROR'>('IDLE');
  isSubmitting = computed(() => this.loading());

  @HostBinding('class.map-positioned') get isMapPositioned(): boolean {
    return this.useMapPositioning();
  }

  constructor() {
    effect(() => {
      const visible = this.isVisible();
      const mapPos = this.useMapPositioning();
      if (visible && !mapPos) {
        setTimeout(() => this.moveToBody(), 0);
      }

      if (visible) {
        setTimeout(() => this.focusFirstInput(), 100);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.closeAfterSuccessTimerId !== null) {
      clearTimeout(this.closeAfterSuccessTimerId);
      this.closeAfterSuccessTimerId = null;
    }
    const element = this.elementRef.nativeElement;
    if (element.parentNode === document.body) {
      this.renderer.removeChild(document.body, element);
    }
  }

  private moveToBody(): void {
    const element = this.elementRef.nativeElement;
    if (element.parentNode !== document.body) {
      this.renderer.appendChild(document.body, element);
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isVisible() && !this.isSubmitting()) {
      this.onClose();
    }
  }

  private validateForm(): boolean {
    if (!this.clientId()) {
      this.errorMessage.set('Please select a client.');
      return false;
    }
    if (!this.selectedFactory()) {
      this.errorMessage.set('Please select a factory.');
      return false;
    }
    if (!this.projectName().trim()) {
      this.errorMessage.set('Project name is required.');
      return false;
    }
    if (!this.assessmentType().trim()) {
      this.errorMessage.set('Assessment type is required.');
      return false;
    }
    return true;
  }

  goToStep(step: number): void {
    if (step >= 1 && step <= 4) this.currentStep.set(step as 1 | 2 | 3 | 4);
  }

  nextStep(): void {
    const step = this.currentStep();
    if (step < 4) this.currentStep.set((step + 1) as 1 | 2 | 3 | 4);
  }

  prevStep(): void {
    const step = this.currentStep();
    if (step > 1) this.currentStep.set((step - 1) as 1 | 2 | 3 | 4);
  }

  onFactorySelect(option: FactoryOption | null): void {
    this.selectedFactory.set(option);
  }

  onSubmit(): void {
    if (this.isSubmitting()) {
      return;
    }

    this.errorMessage.set(null);
    this.successMessage.set(null);

    if (!this.validateForm()) {
      setTimeout(() => this.errorMessage.set(null), 3000);
      return;
    }

    this.loading.set(true);
    this.submissionState.set('SUBMITTING');

    const cid = this.clientId()!;
    const client = this.clients().find((c) => c.id === cid);
    const clientName = client?.name ?? cid;
    const factory = this.selectedFactory()!;

    const locationDisplay =
      this.location().trim() ||
      [factory.city, factory.state_province, factory.country].filter(Boolean).join(', ') ||
      factory.factory_location_name;

    const formData: ProjectFormData = {
      clientId: cid,
      clientName,
      factoryId: factory.factoryId,
      manufacturerId: factory.manufacturerId,
      manufacturerName: factory.manufacturerName,
      projectName: this.projectName().trim(),
      assessmentType: this.assessmentType().trim(),
      status: this.projectStatus(),
      location: locationDisplay || undefined,
      notes: this.notes().trim() || undefined,
    };

    this.projectAdded.emit(formData);
  }

  private resetForm(): void {
    this.currentStep.set(1);
    this.clientId.set(null);
    this.selectedFactory.set(null);
    this.projectName.set('');
    this.assessmentType.set('');
    this.projectStatus.set('Active');
    this.location.set('');
    this.notes.set('');
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.loading.set(false);
    this.submissionState.set('IDLE');
  }

  onClose(): void {
    if (this.isSubmitting()) {
      return;
    }
    this.resetForm();
    this.close.emit();
  }

  private focusFirstInput(): void {
    const step = this.currentStep();
    const selector =
      step === 1
        ? '#client-select'
        : step === 2
          ? '#factory-select'
          : step === 3
            ? '#project-name'
            : '#project-location';
    const el = this.elementRef.nativeElement.querySelector(selector);
    if (el) (el as HTMLElement).focus();
  }

  handleSuccess(message?: string): void {
    this.loading.set(false);
    this.errorMessage.set(null);
    this.successMessage.set(
      message || `${this.projectName().trim() || 'Project'} added successfully.`
    );
    this.submissionState.set('SUCCESS');
  }

  handleError(message: string): void {
    const fallback = 'Failed to add project. Please try again.';
    this.errorMessage.set(message?.trim() ? message : fallback);
    this.successMessage.set(null);
    this.loading.set(false);
    this.submissionState.set('ERROR');
  }

  closeAfterSuccess(): void {
    if (this.closeAfterSuccessTimerId !== null) {
      clearTimeout(this.closeAfterSuccessTimerId);
    }
    this.closeAfterSuccessTimerId = setTimeout(() => {
      this.closeAfterSuccessTimerId = null;
      this.onClose();
    }, 2000);
  }

  onBackdropClick(event: MouseEvent): void {
    if (this.isSubmitting()) {
      return;
    }
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.onClose();
    }
  }

  stopPropagation(event: MouseEvent): void {
    event.stopPropagation();
  }

  loadSampleData(): void {
    this.errorMessage.set(null);
    this.projectName.set('Sample Project - LE96 40FT');
    this.assessmentType.set('New Build');
    this.projectStatus.set('Active');
  }

  getProjectStatusClass(status: 'Active' | 'Inactive'): string {
    return status === 'Active' ? 'status-active' : 'status-inactive';
  }
}
