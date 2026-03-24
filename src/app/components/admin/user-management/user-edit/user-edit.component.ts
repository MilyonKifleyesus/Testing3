import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { UserManagementService, ManufacturerOption } from '../../../../shared/services/user-management.service';
import { ClientService } from '../../../../shared/services/client.service';
import { Client } from '../../../../shared/models/client.model';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  phone?: string;
  role: string;
  client?: string;
  manufacturer?: string;
  status: string;
  address?: string;
}

@Component({
  selector: 'app-user-edit',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './user-edit.component.html',
  styleUrls: ['./user-edit.component.scss']
})
export class UserEditComponent implements OnInit {
  private readonly fallbackRoles = ['Admin', 'Manager', 'Inspector', 'Client User', 'Viewer'];
  userId: number | null = null;
  user: User = {
    id: 0,
    name: '',
    username: '',
    email: '',
    phone: '',
    role: 'Viewer',
    status: 'active',
    address: ''
  };

  roles: string[] = this.fallbackRoles;
  clients: string[] = [''];
  manufacturers: string[] = [''];
  statuses = ['active', 'inactive', 'suspended'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userManagementService: UserManagementService,
    private clientService: ClientService,
  ) {}

  ngOnInit(): void {
    this.loadDropdownOptions();

    const idParam = this.route.snapshot.paramMap.get('id');
    this.userId = idParam ? Number(idParam) : null;
    if (this.userId) {
      this.loadUserData();
    }
  }

  private loadDropdownOptions(): void {
    forkJoin({
      roles: this.userManagementService.getRoles().pipe(catchError(() => of(this.fallbackRoles))),
      clients: this.clientService.getClients().pipe(catchError(() => of([] as Client[]))),
      manufacturers: this.userManagementService.getManufacturers(0).pipe(catchError(() => of([] as ManufacturerOption[]))),
    }).subscribe(({ roles, clients, manufacturers }) => {
      this.roles = roles.length > 0 ? roles : this.fallbackRoles;
      this.clients = [
        '',
        ...clients
          .map((client) => String(client.name ?? '').trim())
          .filter((name) => name.length > 0),
      ];
      this.manufacturers = [
        '',
        ...manufacturers
          .map((manufacturer) => String(manufacturer.name ?? '').trim())
          .filter((name) => name.length > 0),
      ];
    });
  }

  loadUserData(): void {
    if (!this.userId) {
      return;
    }

    this.userManagementService.getUserById(this.userId).subscribe((user) => {
      if (!user) {
        return;
      }

      this.user = {
        id: user.id,
        name: user.name,
        username: user.userName,
        email: user.email ?? '',
        phone: '',
        role: user.role,
        client: user.clientName || '',
        manufacturer: user.manufacturerName || '',
        status: !user.deleted ? 'active' : 'inactive',
        address: '',
      };
    });
  }

  saveUser(): void {
    if (this.validateForm()) {
      console.log('Saving user:', this.user);
      alert('User saved successfully!');
      this.router.navigate(['/admin/users/view', this.userId]);
    }
  }

  validateForm(): boolean {
    if (!this.user.name || !this.user.username || !this.user.email) {
      alert('Please fill in all required fields');
      return false;
    }
    if (!this.isValidEmail(this.user.email)) {
      alert('Please enter a valid email address');
      return false;
    }
    return true;
  }

  isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  cancel(): void {
    if (confirm('Are you sure you want to cancel? All unsaved changes will be lost.')) {
      this.router.navigate(['/admin/users']);
    }
  }
}
