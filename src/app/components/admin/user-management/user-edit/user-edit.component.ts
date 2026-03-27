import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule, NgForm } from '@angular/forms';
import { ToastrService } from 'ngx-toastr';
import {
  ChangeUserPasswordRequest,
  ManufacturerOption,
  SaveUserRequest,
  UserListItem,
  UserManagementService,
} from '../../../../shared/services/user-management.service';
import { ClientService } from '../../../../shared/services/client.service';
import { AuthService } from '../../../../shared/services/auth.service';
import { Client } from '../../../../shared/models/client.model';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

interface SelectOption {
  id: string;
  name: string;
}

interface UserEditorModel {
  name: string;
  username: string;
  email: string;
  picture: string;
  role: string;
  status: string;
  language: string;
  clientId: string;
  manufacturerId: string;
  phone: string;
  address: string;
}

interface PasswordModel {
  password: string;
  confirmPassword: string;
}

@Component({
  selector: 'app-user-edit',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './user-edit.component.html',
  styleUrls: ['./user-edit.component.scss']
})
export class UserEditComponent implements OnInit {
  private readonly fallbackRoles = ['Admin', 'Inspector', 'Client', 'General Admin', 'Manufacturer', 'Manager', 'Viewer'];

  readonly statuses = ['active', 'inactive', 'suspended'];
  readonly languageOptions = ['English', 'French'];

  userId: number | null = null;
  isCreateMode = true;
  isLoading = false;
  isSavingBasicInfo = false;
  isSavingPassword = false;
  userNotFound = false;

  roles: string[] = [...this.fallbackRoles];
  clients: SelectOption[] = [];
  manufacturers: SelectOption[] = [];

  model: UserEditorModel = this.createEmptyModel();
  passwordModel: PasswordModel = this.createEmptyPasswordModel();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly toastr: ToastrService,
    private readonly userManagementService: UserManagementService,
    private readonly clientService: ClientService,
    private readonly authService: AuthService,
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    const parsedId = Number(idParam);
    this.userId = Number.isFinite(parsedId) && parsedId > 0 ? parsedId : null;
    this.isCreateMode = this.userId == null;
    this.loadPageData();
  }

  get pageTitle(): string {
    return this.isCreateMode ? 'Create User' : 'Edit User';
  }

  get saveButtonLabel(): string {
    if (this.isSavingBasicInfo) {
      return this.isCreateMode ? 'Creating...' : 'Saving...';
    }

    return this.isCreateMode ? 'Create User' : 'Save Changes';
  }

  get passwordButtonLabel(): string {
    return this.isSavingPassword ? 'Updating...' : 'Update Password';
  }

  get selectedRoleRequiresClient(): boolean {
    return this.model.role.trim().toLowerCase().includes('client');
  }

  get profilePicturePreview(): string {
    return this.model.picture.trim();
  }

  get profileInitials(): string {
    const source = this.model.name.trim() || this.model.username.trim() || 'U';
    return source
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase())
      .join('')
      .slice(0, 2);
  }

  private loadPageData(): void {
    this.isLoading = true;
    this.userNotFound = false;

    forkJoin({
      roles: this.userManagementService.getRoles().pipe(catchError(() => of(this.fallbackRoles))),
      clients: this.clientService.getClients().pipe(catchError(() => of([] as Client[]))),
      manufacturers: this.userManagementService.getManufacturers(0).pipe(catchError(() => of([] as ManufacturerOption[]))),
      user: this.userId
        ? this.userManagementService.getUserById(this.userId).pipe(catchError(() => of(null)))
        : of(null),
    }).subscribe({
      next: ({ roles, clients, manufacturers, user }) => {
        this.roles = roles.length > 0 ? roles : [...this.fallbackRoles];
        this.clients = clients
          .map((client) => ({
            id: String(client.id ?? '').trim(),
            name: String(client.name ?? '').trim(),
          }))
          .filter((client) => client.id.length > 0 && client.name.length > 0);
        this.manufacturers = manufacturers
          .map((manufacturer) => ({
            id: String(manufacturer.id ?? '').trim(),
            name: String(manufacturer.name ?? '').trim(),
          }))
          .filter((manufacturer) => manufacturer.id.length > 0 && manufacturer.name.length > 0);

        if (user) {
          this.applyUserToModel(user);
        } else if (!this.isCreateMode) {
          this.userNotFound = true;
          this.toastr.error('User not found.');
        }

        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.userNotFound = !this.isCreateMode;
        this.toastr.error('Failed to load user editor.');
      },
    });
  }

  saveBasicInfo(form: NgForm): void {
    if (this.isLoading || this.isSavingBasicInfo) {
      return;
    }

    if (form.invalid) {
      form.form.markAllAsTouched();
      this.toastr.error('Please complete the required fields.');
      return;
    }

    if (this.isCreateMode && !this.hasValidCreatePassword()) {
      this.toastr.error('Please enter and confirm a password for the new user.');
      return;
    }

    const request = this.buildSaveUserRequest();
    this.isSavingBasicInfo = true;

    const request$ = this.isCreateMode
      ? this.userManagementService.createUser(request)
      : this.userManagementService.updateUser(this.userId as number, request);

    request$.subscribe({
      next: (savedUser) => {
        this.isSavingBasicInfo = false;
        this.passwordModel = this.createEmptyPasswordModel();
        this.toastr.success(this.isCreateMode ? 'User created successfully.' : 'User updated successfully.');
        const targetId = Number(savedUser.id ?? this.userId ?? 0);
        if (targetId > 0 && this.authService.currentUserValue?.userId === targetId) {
          this.authService.fetchAndStorePicture(targetId);
        }
        if (targetId > 0) {
          this.router.navigate(['/admin/users/view', targetId]);
          return;
        }

        this.router.navigate(['/admin/users/list']);
      },
      error: (error) => {
        this.isSavingBasicInfo = false;
        this.toastr.error(this.formatApiError(error, this.isCreateMode ? 'Failed to create user.' : 'Failed to save user.'));
      },
    });
  }

  savePassword(form: NgForm): void {
    if (this.isCreateMode || !this.userId || this.isSavingPassword) {
      return;
    }

    if (form.invalid) {
      form.form.markAllAsTouched();
      this.toastr.error('Please complete the password fields.');
      return;
    }

    if (!this.hasMatchingPassword()) {
      this.toastr.error('Passwords do not match.');
      return;
    }

    const request: ChangeUserPasswordRequest = {
      password: this.passwordModel.password.trim(),
      confirmPassword: this.passwordModel.confirmPassword.trim(),
    };

    this.isSavingPassword = true;
    this.userManagementService.changeUserPassword(this.userId, request).subscribe({
      next: () => {
        this.isSavingPassword = false;
        this.passwordModel = this.createEmptyPasswordModel();
        form.resetForm(this.passwordModel);
        this.toastr.success('Password updated successfully.');
      },
      error: (error) => {
        this.isSavingPassword = false;
        this.toastr.error(this.formatApiError(error, 'Failed to update password.'));
      },
    });
  }

  cancel(): void {
    const target = this.userId ? ['/admin/users/view', this.userId] : ['/admin/users/list'];
    this.router.navigate(target);
  }

  onPictureFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.toastr.error('Please choose an image file.');
      if (input) {
        input.value = '';
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.model.picture = String(reader.result ?? '').trim();
      if (input) {
        input.value = '';
      }
    };
    reader.onerror = () => {
      this.toastr.error('Failed to read the selected image.');
    };
    reader.readAsDataURL(file);
  }

  clearPicture(): void {
    this.model.picture = '';
  }

  private applyUserToModel(user: UserListItem): void {
    const resolvedUsername = (user as any).userName || user.username;
    const resolvedClient = (user as any).clientName || user.client;
    const resolvedManufacturer = (user as any).manufacturerName || user.manufacturer;
    const resolvedStatus = typeof (user as any).deleted === 'boolean'
      ? (!(user as any).deleted ? 'active' : 'inactive')
      : this.normalizeStatus(user.status, user.isActive);

    this.model = {
      name: user.name !== 'N/A' ? user.name : '',
      username: resolvedUsername !== 'N/A' ? (resolvedUsername || '') : '',
      email: user.email ?? '',
      picture: user.picture || '',
      role: user.role || this.roles[0] || 'Admin',
      status: resolvedStatus,
      language: user.language || 'English',
      clientId: this.normalizeOptionId(user.clientId),
      manufacturerId: this.normalizeOptionId(user.manufacturerId),
      phone: user.phone || '',
      address: user.address || '',
    };
  }

  private buildSaveUserRequest(): SaveUserRequest {
    const request: SaveUserRequest = {
      name: this.model.name.trim(),
      username: this.model.username.trim(),
      email: this.model.email.trim(),
      picture: this.model.picture.trim() || null,
      role: this.model.role.trim(),
      status: this.normalizeStatus(this.model.status),
      language: this.model.language.trim() || null,
      clientId: this.normalizeOptionId(this.model.clientId),
      manufacturerId: this.normalizeOptionId(this.model.manufacturerId),
      phone: this.model.phone.trim() || null,
      address: this.model.address.trim() || null,
    };

    if (this.isCreateMode) {
      request.password = this.passwordModel.password.trim();
      request.confirmPassword = this.passwordModel.confirmPassword.trim();
    }

    return request;
  }

  private hasValidCreatePassword(): boolean {
    return this.passwordModel.password.trim().length > 0 && this.hasMatchingPassword();
  }

  private hasMatchingPassword(): boolean {
    return this.passwordModel.password.trim().length > 0 &&
      this.passwordModel.password.trim() === this.passwordModel.confirmPassword.trim();
  }

  private normalizeStatus(status: unknown, isActive?: boolean): string {
    const normalized = String(status ?? '').trim().toLowerCase();
    if (normalized) {
      return normalized;
    }

    if (typeof isActive === 'boolean') {
      return isActive ? 'active' : 'inactive';
    }

    return 'active';
  }

  private normalizeOptionId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return normalized && normalized !== '0' ? normalized : '';
  }

  private createEmptyModel(): UserEditorModel {
    return {
      name: '',
      username: '',
      email: '',
      picture: '',
      role: 'Admin',
      status: 'active',
      language: 'English',
      clientId: '',
      manufacturerId: '',
      phone: '',
      address: '',
    };
  }

  private createEmptyPasswordModel(): PasswordModel {
    return {
      password: '',
      confirmPassword: '',
    };
  }

  private formatApiError(error: unknown, fallback: string): string {
    const apiError = error as {
      status?: number;
      error?: { message?: string; title?: string; errors?: Record<string, string[] | string> };
      message?: string;
    };

    const fieldErrors = apiError?.error?.errors
      ? Object.values(apiError.error.errors)
          .flatMap((value) => Array.isArray(value) ? value : [value])
          .map((value) => String(value ?? '').trim())
          .filter((value) => value.length > 0)
      : [];

    const message =
      fieldErrors[0] ??
      String(apiError?.error?.message ?? apiError?.error?.title ?? apiError?.message ?? '').trim();

    if (message) {
      return message;
    }

    if (typeof apiError?.status === 'number' && apiError.status > 0) {
      return `${fallback} Server error (${apiError.status}).`;
    }

    return fallback;
  }
}
