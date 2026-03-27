import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { NgSelectModule } from '@ng-select/ng-select';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import {
  CreateSnagPayload,
  CreateSnagService,
  CreatedSnagResult,
  SnagCategoryOption,
  SnagProjectOption,
  SnagUserOption,
  SnagVehicleOption,
} from './create-snag.service';

interface ImagePreview {
  file: File;
  url: string;
}

@Component({
  selector: 'app-create-snag',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, NgSelectModule],
  templateUrl: './create-snag.component.html',
  styleUrl: './create-snag.component.scss',
})
export class CreateSnagComponent implements OnInit, OnDestroy {
  private readonly fb      = inject(FormBuilder);
  private readonly router  = inject(Router);
  private readonly svc     = inject(CreateSnagService);
  private readonly destroy$ = new Subject<void>();

  readonly maxImages = 3;
  readonly maxFileSizeBytes = 5 * 1024 * 1024;

  readonly snagForm = this.fb.group({
    projectId:                  [null as number | null, Validators.required],
    vehicleId:                  [{ value: null as number | null, disabled: true }, Validators.required],
    userId:                     [this.svc.getCurrentUser().id, Validators.required],
    finalInspectionCategoryId:  [null as number | null, Validators.required],
    safetyCritical:             [false],
    repeater:                   [false],
    description:                ['', [Validators.required, Validators.minLength(10), Validators.maxLength(1000)]],
  });

  projects:   SnagProjectOption[]  = [];
  vehicles:   SnagVehicleOption[]  = [];
  categories: SnagCategoryOption[] = [];
  inspectors: SnagUserOption[]     = [];

  currentUser: SnagUserOption = this.svc.getCurrentUser();
  isAdmin = this.svc.isAdmin();

  imagePreviews: ImagePreview[] = [];
  savedSnag: CreatedSnagResult | null = null;

  loadingLookups  = true;
  loadingVehicles = false;
  submitting      = false;
  dragActive      = false;
  submitError     = '';
  submitSuccess   = '';

  projectSearchText   = '';
  vehicleSearchText   = '';
  inspectorSearchText = '';
  categorySearchText  = '';

  get filteredProjects(): SnagProjectOption[] {
    const q = this.projectSearchText.toLowerCase();
    return q ? this.projects.filter(p => p.name.toLowerCase().includes(q)) : this.projects;
  }

  get filteredVehicles(): SnagVehicleOption[] {
    const q = this.vehicleSearchText.toLowerCase();
    return q ? this.vehicles.filter(v => v.name.toLowerCase().includes(q)) : this.vehicles;
  }

  get filteredInspectors(): SnagUserOption[] {
    const q = this.inspectorSearchText.toLowerCase();
    return q ? this.inspectors.filter(u => u.name.toLowerCase().includes(q)) : this.inspectors;
  }

  get filteredCategories(): SnagCategoryOption[] {
    const q = this.categorySearchText.toLowerCase();
    return q ? this.categories.filter(c => c.name.toLowerCase().includes(q)) : this.categories;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.categories = this.svc.getCategories();

    forkJoin({
      projects:   this.svc.getProjects(),
      inspectors: this.svc.getInspectors(),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ projects, inspectors }) => {
        this.projects   = projects;
        this.inspectors = inspectors;
        this.loadingLookups = false;
      },
      error: () => {
        this.loadingLookups = false;
      },
    });

    // React to project change
    this.snagForm.get('projectId')!.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((projectId) => {
        const vehicleCtrl = this.snagForm.get('vehicleId')!;
        vehicleCtrl.reset(null);
        this.vehicles = [];
        this.vehicleSearchText = '';

        if (projectId) {
          vehicleCtrl.enable();
          this.loadingVehicles = true;
          this.svc.getVehiclesByProject(Number(projectId))
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (vehicles) => {
                this.vehicles        = vehicles;
                this.loadingVehicles = false;
              },
              error: () => { this.loadingVehicles = false; },
            });
        } else {
          vehicleCtrl.disable();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.imagePreviews.forEach(p => URL.revokeObjectURL(p.url));
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  get descriptionLength(): number {
    return String(this.snagForm.get('description')?.value ?? '').length;
  }

  get summaryProject(): string {
    const id = this.snagForm.get('projectId')?.value;
    return this.projects.find(p => p.id === id)?.name ?? '—';
  }

  get summaryVehicle(): string {
    const id = this.snagForm.get('vehicleId')?.value;
    return this.vehicles.find(v => v.id === id)?.name ?? '—';
  }

  get summaryInspector(): string {
    const id = this.snagForm.get('userId')?.value;
    return this.inspectors.find(u => u.id === id)?.name ?? this.currentUser.name;
  }

  get summaryCategory(): string {
    const id = this.snagForm.get('finalInspectionCategoryId')?.value;
    return this.categories.find(c => c.id === id)?.name ?? '—';
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  onSubmit(): void {
    this.snagForm.markAllAsTouched();
    if (this.snagForm.invalid || this.submitting) return;

    this.submitting   = true;
    this.submitError  = '';
    this.submitSuccess = '';

    const raw = this.snagForm.getRawValue();
    const payload: CreateSnagPayload = {
      projectId:               Number(raw.projectId),
      vehicleId:               Number(raw.vehicleId),
      userId:                  Number(raw.userId),
      finalInspectionCategory: Number(raw.finalInspectionCategoryId),
      description:             raw.description ?? '',
      safetyCritical:          Boolean(raw.safetyCritical),
      repeater:                Boolean(raw.repeater),
      images:                  this.imagePreviews.map(p => p.file),
    };

    this.svc.createSnag(payload).pipe(takeUntil(this.destroy$)).subscribe({
      next: (result) => {
        this.savedSnag    = result;
        this.submitting   = false;
        this.submitSuccess = `Snag ${result.snagNumber} created successfully.`;
        this.snagForm.reset({ safetyCritical: false, repeater: false, userId: this.currentUser.id });
        this.vehicles     = [];
        this.clearImages();
      },
      error: (err) => {
        this.submitting  = false;
        this.submitError = err?.error?.message ?? err?.message ?? 'Failed to create snag. Please try again.';
      },
    });
  }

  createAnother(): void {
    this.submitSuccess = '';
    this.submitError   = '';
    this.savedSnag     = null;
  }

  cancel(): void {
    this.router.navigate(['/admin/snags']);
  }

  // ── Image handling ─────────────────────────────────────────────────────────

  openFilePicker(input: HTMLInputElement): void {
    if (this.imagePreviews.length >= this.maxImages) return;
    input.value = '';
    input.click();
  }

  onFileInputChange(event: Event): void {
    const files = (event.target as HTMLInputElement).files;
    if (files) this.addFiles(Array.from(files));
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
    if (files) this.addFiles(Array.from(files));
  }

  removeImage(index: number): void {
    URL.revokeObjectURL(this.imagePreviews[index].url);
    this.imagePreviews.splice(index, 1);
  }

  // ── Validation helpers ─────────────────────────────────────────────────────

  fieldError(name: string): string {
    const ctrl = this.snagForm.get(name);
    if (!ctrl || !ctrl.invalid || !(ctrl.touched || ctrl.dirty)) return '';
    if (ctrl.errors?.['required'])   return 'This field is required.';
    if (ctrl.errors?.['minlength'])  return `Minimum ${ctrl.errors['minlength'].requiredLength} characters.`;
    if (ctrl.errors?.['maxlength'])  return `Maximum ${ctrl.errors['maxlength'].requiredLength} characters.`;
    return 'Invalid value.';
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private addFiles(files: File[]): void {
    const remaining = this.maxImages - this.imagePreviews.length;
    files.slice(0, remaining).forEach((file) => {
      if (!file.type.startsWith('image/') || file.size > this.maxFileSizeBytes) return;
      this.imagePreviews.push({ file, url: URL.createObjectURL(file) });
    });
  }

  private clearImages(): void {
    this.imagePreviews.forEach(p => URL.revokeObjectURL(p.url));
    this.imagePreviews = [];
  }
}
