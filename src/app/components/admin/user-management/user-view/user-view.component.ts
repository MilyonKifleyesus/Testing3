import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { UserManagementService } from '../../../../shared/services/user-management.service';

interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  phone?: string;
  role: string;
  clientId?: string;
  client?: string;
  manufacturer?: string;
  status: 'active' | 'inactive' | 'suspended';
  createdDate: string;
  updatedAt?: string;
  lastLogin?: string;
  address?: string;
  permissions: string[];
}

@Component({
  selector: 'app-user-view',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './user-view.component.html',
  styleUrls: ['./user-view.component.scss']
})
export class UserViewComponent implements OnInit {
  userId: number | null = null;
  user: User | null = null;
  activeTab = 'profile';

  tabs = [
    { key: 'profile', label: 'Profile', icon: 'ti-user' },
    { key: 'permissions', label: 'Permissions', icon: 'ti-shield-check' },
    { key: 'activity', label: 'Activity Log', icon: 'ti-history' }
  ];

  activityLogs: { date: string; action: string; details: string; type: string }[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userManagementService: UserManagementService,
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.userId = idParam ? Number(idParam) : null;
    this.loadUserData();
  }

  loadUserData(): void {
    if (!this.userId) {
      this.user = null;
      return;
    }

    this.userManagementService.getUserById(this.userId).subscribe((user) => {
      if (!user) {
        this.user = null;
        return;
      }

      this.user = {
        id: user.id,
        name: user.name !== 'N/A' ? user.name : user.userName,
        username: user.userName,
        email: user.email ?? '',
        role: user.role,
        clientId: String(user.clientId),
        client: user.clientName || undefined,
        manufacturer: user.manufacturerName || undefined,
        status: !user.deleted ? 'active' : 'inactive',
        createdDate: user.lastUpdate || '—',
        updatedAt: user.lastUpdate || undefined,
        lastLogin: user.lastUpdate || undefined,
        permissions: [],
      };
    });
  }

  setTab(tabKey: string): void {
    this.activeTab = tabKey;
  }

  getUserInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  }

  getStatusClass(status: string): string {
    const classes: { [key: string]: string } = {
      'active': 'bg-success',
      'inactive': 'bg-secondary',
      'suspended': 'bg-danger'
    };
    return classes[status] || 'bg-secondary';
  }

  getRoleClass(role: string): string {
    const classes: { [key: string]: string } = {
      'Admin': 'bg-danger-transparent text-danger',
      'Manager': 'bg-warning-transparent text-warning',
      'Inspector': 'bg-info-transparent text-info',
      'Client User': 'bg-primary-transparent text-primary',
      'Viewer': 'bg-secondary-transparent text-secondary'
    };
    return classes[role] || 'bg-secondary-transparent';
  }

  getActivityIcon(type: string): string {
    const icons: { [key: string]: string } = {
      'login': 'ti-login',
      'logout': 'ti-logout',
      'update': 'ti-edit',
      'view': 'ti-eye',
      'create': 'ti-plus',
      'delete': 'ti-trash'
    };
    return icons[type] || 'ti-point';
  }

  getActivityClass(type: string): string {
    const classes: { [key: string]: string } = {
      'login': 'bg-success-transparent text-success',
      'logout': 'bg-secondary-transparent text-secondary',
      'update': 'bg-warning-transparent text-warning',
      'view': 'bg-info-transparent text-info',
      'create': 'bg-primary-transparent text-primary',
      'delete': 'bg-danger-transparent text-danger'
    };
    return classes[type] || 'bg-secondary-transparent';
  }

  editUser(): void {
    if (!this.userId) {
      return;
    }

    this.router.navigate(['/admin/users/edit', this.userId]);
  }

  suspendUser(): void {
    if (confirm('Are you sure you want to suspend this user?')) {
      if (this.user) {
        this.user.status = 'suspended';
      }
    }
  }

  activateUser(): void {
    if (this.user) {
      this.user.status = 'active';
    }
  }

  resetPassword(): void {
    if (confirm('Send password reset email to ' + this.user?.email + '?')) {
      alert('Password reset email sent successfully!');
    }
  }

  deleteUser(): void {
    if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      console.log('Delete user:', this.userId);
      // Navigate back to user list
    }
  }
}
