import { Component, input, output, signal, inject, HostListener, effect, ElementRef, Renderer2, OnDestroy, HostBinding, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WarRoomService } from '../../../../../shared/services/fluorescence-map.service';
import { NgSelectModule } from '@ng-select/ng-select';
import { SubsidiaryCompany } from '../../../../../shared/models/fluorescence-map.interface';

import { A11yModule } from '@angular/cdk/a11y';

export type TargetCompanyMode = 'existing' | 'new';

export interface CompanyFormData {
  targetCompanyMode: TargetCompanyMode;
  existingSubsidiaryId?: string;
  companyName: string;
  location: string;
  sourceCompanyName?: string;
  sourceLocation?: string;
  status: 'ACTIVE' | 'INACTIVE';
  description?: string;
  logo?: string | ArrayBuffer | null;
  logoFile?: File;
  subLocations?: SubLocationFormData[];
}

export interface SubLocationFormData {
  name: string;
  location: string;
  status: 'ACTIVE' | 'INACTIVE';
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
  /** Subsidiaries for "Connect to Existing Client" dropdown */
  subsidiaries = input<SubsidiaryCompany[]>([]);

  // Outputs
  companyAdded = output<CompanyFormData>();
  companyAddedComplete = output<void>();
  close = output<void>();
  /** Emitted when user clicks "View on map" for selected subsidiary */
  viewOnMap = output<string>();

  // Services
  private warRoomService = inject(WarRoomService);
  private elementRef = inject(ElementRef);
  private renderer = inject(Renderer2);

  // Form data
  targetCompanyMode = signal<TargetCompanyMode>('new');
  existingSubsidiaryId = signal<string | null>(null);
  companyName = signal<string>('');
  location = signal<string>('');
  companyStatus = signal<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  sourceCompanyName = signal<string>('');
  sourceLocation = signal<string>('');
  description = signal<string>('');
  logoFile = signal<File | null>(null);
  logoPreview = signal<string | null>(null);
  subLocations = signal<SubLocationFormData[]>([]);
  subLocationName = signal<string>('');
  subLocationLocation = signal<string>('');
  subLocationIsActive = signal<boolean>(true);

  // Step state (1–4)
  currentStep = signal<1 | 2 | 3 | 4>(1);

  readonly subsidiaryOptions = computed(() =>
    this.subsidiaries().map((s) => ({ id: s.id, name: s.name }))
  );

  readonly canAddSubLocation = computed(() => {
    return !!this.subLocationName().trim() && !!this.subLocationLocation().trim();
  });

  readonly canProceedToStep2 = computed(() => {
    const name = this.sourceCompanyName().trim();
    const loc = this.sourceLocation().trim();
    return (name && loc) || (!name && !loc);
  });

  readonly canProceedToStep3 = computed(() => {
    if (this.targetCompanyMode() === 'existing') {
      return !!this.existingSubsidiaryId();
    }
    return !!this.companyName().trim() && !!this.location().trim();
  });

  readonly canProceedToStep4 = computed(() => {
    const subs = this.subLocations();
    return subs.length > 0 && subs.every((s) => !!s.name?.trim() && !!s.location?.trim());
  });

  readonly isFormValid = computed(() => {
    return this.canProceedToStep2() && this.canProceedToStep3() && this.canProceedToStep4();
  });

  // Form state
  // Async UI state required by UX spec (kept local to the modal).
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
    // Move modal to body when visible and NOT using map positioning
    effect(() => {
      const visible = this.isVisible();
      const mapPos = this.useMapPositioning();
      if (visible && !mapPos) {
        setTimeout(() => this.moveToBody(), 0);
      }

      // Accessibility: Focus first input when modal opens
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

  /**
   * Handle escape key to close modal
   */
  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isVisible() && !this.isSubmitting()) {
      this.onClose();
    }
  }

  /**
   * Handle file selection for logo
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];

      // Check if it's an image file (SVG, PNG, JPG, JPEG, GIF, WEBP)
      const validImageTypes = [
        'image/svg+xml',
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp'
      ];

      const validExtensions = ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

      if (validImageTypes.includes(file.type) || validExtensions.includes(fileExtension)) {
        this.logoFile.set(file);

        // Create preview
        const reader = new FileReader();
        const handleReadError = (message: string): void => {
          this.logoPreview.set(null);
          this.errorMessage.set(message);
          setTimeout(() => this.errorMessage.set(null), 3000);
        };

        reader.onload = (e) => {
          const result = e.target?.result;
          if (typeof result === 'string') {
            this.logoPreview.set(result);
          } else {
            handleReadError('Unable to preview the selected logo file');
          }
        };
        reader.onerror = () => handleReadError('Failed to read the selected logo file');
        reader.onabort = () => handleReadError('Logo upload was interrupted');
        reader.readAsDataURL(file);
      } else {
        this.errorMessage.set('Please select an image file (SVG, PNG, JPG, GIF, or WEBP)');
        setTimeout(() => this.errorMessage.set(null), 3000);
      }
    }
  }

  /**
   * Remove selected logo
   */
  removeLogo(): void {
    this.logoFile.set(null);
    this.logoPreview.set(null);
  }

  /**
   * Validate form
   */
  private validateForm(): boolean {
    const sourceCompany = this.sourceCompanyName().trim();
    const sourceLocation = this.sourceLocation().trim();
    if (sourceCompany && !sourceLocation) {
      this.errorMessage.set('Your location is required when providing a source company');
      return false;
    }
    if (!sourceCompany && sourceLocation) {
      this.errorMessage.set('Your company name is required when providing a source location');
      return false;
    }

    if (this.targetCompanyMode() === 'existing') {
      if (!this.existingSubsidiaryId()) {
        this.errorMessage.set('Please select an existing client');
        return false;
      }
    } else {
      if (!this.companyName().trim()) {
        this.errorMessage.set('Target company name is required');
        return false;
      }
      if (!this.location().trim()) {
        this.errorMessage.set('Target company primary location is required');
        return false;
      }
    }

    const subs = this.subLocations();
    if (subs.length === 0) {
      this.errorMessage.set('At least one factory location is required');
      return false;
    }
    for (const s of subs) {
      if (!s.name?.trim() || !s.location?.trim()) {
        this.errorMessage.set('Each factory must have a name and location');
        return false;
      }
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

  onViewOnMap(): void {
    const id = this.existingSubsidiaryId();
    if (id) this.viewOnMap.emit(id);
  }

  /**
   * Parse location input (coordinates or address)
   */
  private async parseLocation(locationInput: string): Promise<{ latitude: number | null; longitude: number | null; city: string; needsGeocoding?: boolean } | null> {
    const trimmed = locationInput.trim();

    // Extract city from input (everything after the coordinates if coordinates are provided)
    let city = trimmed;

    // Try to parse as coordinates (format: "lat, lng" or "lat,lng")
    const coordinateMatch = trimmed.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)(?:\s*,\s*(.+))?$/);
    if (coordinateMatch) {
      const latitude = parseFloat(coordinateMatch[1]);
      const longitude = parseFloat(coordinateMatch[2]);
      city = coordinateMatch[3] ? coordinateMatch[3].trim() : trimmed;

      // Validate coordinate ranges
      if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
        return { latitude, longitude, city: city || 'Unknown' };
      } else {
        throw new Error('Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180');
      }
    }

    // Check if it's a "City, Province" format (e.g., "Toronto, Ontario")
    // Pattern: text, text (at least one comma with text on both sides, not coordinates)
    const cityProvinceMatch = trimmed.match(/^([^,]+),\s*([^,]+)$/);
    if (cityProvinceMatch && !coordinateMatch) {
      // Valid "City, Province" format - accept it even if geocoding isn't available
      // Return null coordinates with needsGeocoding flag so downstream consumers can detect this
      city = trimmed;
      return { latitude: null, longitude: null, city: trimmed, needsGeocoding: true };
    }

    // If not coordinates or city/province format, try geocoding service
    try {
      this.logDebug(`[AddCompanyModalComponent] Geocoding location: "${trimmed}"`);
      const coords = await this.warRoomService.parseLocationInput(trimmed);
      // Use the input as city name if it's an address
      return { ...coords, city: trimmed };
    } catch (error) {
      this.logWarn(`[AddCompanyModalComponent] Geocoding failed for "${trimmed}":`, error);
      // If geocoding fails but it looks like a valid location string, accept it
      // This allows "City, Province" format to work even without geocoding
      if (trimmed.length > 2 && !trimmed.match(/^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/)) {
        // Not coordinates, treat as location string (e.g., "Toronto, Ontario")
        return { latitude: null, longitude: null, city: trimmed, needsGeocoding: true };
      }
      throw error instanceof Error ? error : new Error('Could not parse location. Please enter coordinates in format "latitude, longitude" or a location like "City, Province"');
    }
  }

  /**
   * Handle form submission
   */
  async onSubmit(): Promise<void> {
    // Guard against duplicate submissions while an async request is in-flight.
    if (this.isSubmitting()) {
      return;
    }

    // Clear previous errors
    this.errorMessage.set(null);
    this.successMessage.set(null);

    // Validate form
    if (!this.validateForm()) {
      setTimeout(() => this.errorMessage.set(null), 3000);
      return;
    }

    // Keep modal open while loading to avoid user confusion.
    this.loading.set(true);
    this.submissionState.set('SUBMITTING');

    try {
      const mode = this.targetCompanyMode();
      let companyName = this.companyName().trim();
      let locationValue = this.location().trim();

      if (mode === 'existing') {
        const subId = this.existingSubsidiaryId();
        const sub = this.subsidiaries().find((s) => s.id === subId);
        if (sub) {
          companyName = sub.name;
          locationValue = sub.location || sub.factories[0]?.city || '';
        }
      } else if (locationValue) {
        const locationData = await this.parseLocation(locationValue);
        if (!locationData) {
          throw new Error('Failed to parse location');
        }
      }

      const subLocations = (this.subLocations() ?? []).filter((s) => s.name?.trim() && s.location?.trim());

      const formData: CompanyFormData = {
        targetCompanyMode: mode,
        existingSubsidiaryId: mode === 'existing' ? (this.existingSubsidiaryId() ?? undefined) : undefined,
        companyName,
        location: locationValue,
        sourceCompanyName: this.sourceCompanyName().trim(),
        sourceLocation: this.sourceLocation().trim(),
        status: this.companyStatus(),
        description: this.description().trim() || undefined,
        logo: this.logoPreview(),
        logoFile: this.logoFile() || undefined,
        subLocations,
      };

      this.companyAdded.emit(formData);

      // Wait for parent to signal completion via companyAddedComplete event
      // The parent should call closeAfterSuccess() or emit companyAddedComplete when done
    } catch (error) {
      console.error('Error in onSubmit:', error);
      const errorMsg = error instanceof Error ? error.message : 'An error occurred while processing the form';
      this.handleError(errorMsg);
      console.error('Error message set:', errorMsg);
      // Don't auto-hide error - let user see it and fix the issue
    }
  }

  /**
   * Reset form
   */
  private resetForm(): void {
    this.currentStep.set(1);
    this.targetCompanyMode.set('new');
    this.existingSubsidiaryId.set(null);
    this.companyName.set('');
    this.location.set('');
    this.companyStatus.set('ACTIVE');
    this.sourceCompanyName.set('');
    this.sourceLocation.set('');
    this.description.set('');
    this.logoFile.set(null);
    this.logoPreview.set(null);
    this.subLocations.set([]);
    this.resetSubLocationForm();
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.loading.set(false);
    this.submissionState.set('IDLE');
  }

  /**
   * Handle close button click
   */
  onClose(): void {
    if (this.isSubmitting()) {
      return;
    }
    this.resetForm();
    this.close.emit();
  }

  /**
   * Focus first input for accessibility
   * @private
   */
  private focusFirstInput(): void {
    const step = this.currentStep();
    const selector =
      step === 1 ? '#source-company-name' : step === 2 ? '#target-company-select' : step === 3 ? '.sub-location-input' : '#company-description';
    const el = this.elementRef.nativeElement.querySelector(selector);
    if (el) (el as HTMLElement).focus();
  }

  /**
   * Handle successful submission
   */
  handleSuccess(message?: string): void {
    // Success is the ONLY time we close the modal automatically.
    this.loading.set(false);
    this.errorMessage.set(null);
    this.successMessage.set(
      message || `${this.companyName().trim() || 'Company'} registered. Sync complete.`
    );
    this.submissionState.set('SUCCESS');
  }

  /**
   * Handle submission error
   */
  handleError(message: string): void {
    const fallback = 'Failed to add subsidiary. Please try again.';
    this.errorMessage.set(message?.trim() ? message : fallback);
    this.successMessage.set(null);
    this.loading.set(false);
    this.submissionState.set('ERROR');
  }

  /**
   * Close modal after successful company addition
   * Called by parent when processing is complete
   */
  closeAfterSuccess(): void {
    if (this.closeAfterSuccessTimerId !== null) {
      clearTimeout(this.closeAfterSuccessTimerId);
    }
    this.closeAfterSuccessTimerId = setTimeout(() => {
      this.closeAfterSuccessTimerId = null;
      this.onClose();
    }, 2000); // Give user time to see the success message
  }

  /**
   * Handle backdrop click
   */
  onBackdropClick(event: MouseEvent): void {
    if (this.isSubmitting()) {
      return;
    }
    // Only close if clicking the backdrop itself, not the modal content
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.onClose();
    }
  }

  /**
   * Stop event propagation for modal content clicks
   */
  stopPropagation(event: MouseEvent): void {
    event.stopPropagation();
  }

  addSubLocation(): void {
    if (!this.canAddSubLocation()) {
      this.errorMessage.set('Sub-location name and location are required');
      setTimeout(() => this.errorMessage.set(null), 2500);
      return;
    }

    const status: SubLocationFormData['status'] = this.subLocationIsActive() ? 'ACTIVE' : 'INACTIVE';
    const newLocation: SubLocationFormData = {
      name: this.subLocationName().trim(),
      location: this.subLocationLocation().trim(),
      status,
    };

    this.subLocations.update((current) => [...current, newLocation]);
    this.resetSubLocationForm();
  }

  removeSubLocation(index: number): void {
    this.subLocations.update((current) => current.filter((_, i) => i !== index));
  }

  toggleSubLocationStatus(index: number, checked: boolean): void {
    this.subLocations.update((current) =>
      current.map((item, i) =>
        i === index ? { ...item, status: checked ? 'ACTIVE' : 'INACTIVE' } : item
      )
    );
  }

  loadSampleData(): void {
    this.errorMessage.set(null);
    this.currentStep.set(1);
    this.targetCompanyMode.set('new');
    this.existingSubsidiaryId.set(null);

    // Step 1: Your Company
    this.sourceCompanyName.set('Acme Logistics Inc.');
    this.sourceLocation.set('Toronto, Ontario');

    // Step 2: Target Company (new)
    this.companyName.set('Nova Bus');
    this.location.set('Saint-Eustache, Quebec');
    this.companyStatus.set('ACTIVE');

    // Step 3: Factory Locations
    this.subLocations.set([
      { name: 'Main Production Plant', location: 'Saint-Eustache, Quebec', status: 'ACTIVE' },
      { name: 'Warehouse A', location: 'Saint-Laurent, Quebec', status: 'ACTIVE' },
    ]);
    this.resetSubLocationForm();

    // Step 4: Description and Logo
    this.description.set(
      'STATUS: ACTIVE + INACTIVE // LOCATION: SAINT-EUSTACHE, QUEBEC // MIXED-SCHEDULE BUILDOUT'
    );
    this.logoFile.set(null);
    this.logoPreview.set(null);
  }

  resetSubLocationForm(): void {
    this.subLocationName.set('');
    this.subLocationLocation.set('');
    this.subLocationIsActive.set(true);
  }

  getSubLocationStatusClass(status: SubLocationFormData['status']): string {
    return status === 'ACTIVE' ? 'status-active' : 'status-inactive';
  }

  getSubLocationStatusLabel(status: SubLocationFormData['status']): string {
    return status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  }

  private logDebug(message: string, ...args: any[]): void {
    console.log(message, ...args);
  }

  private logWarn(message: string, ...args: any[]): void {
    console.warn(message, ...args);
  }
}
