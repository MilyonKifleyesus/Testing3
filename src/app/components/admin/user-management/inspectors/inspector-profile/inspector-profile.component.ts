import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  UserManagementService,
  UserListItem,
  InspectorStatistics,
} from '../../../../../shared/services/user-management.service';

interface Inspector {
  id?: number;
  fullName: string;
  shortName: string;
  email: string;
  phone: string;
  location: string;
  badgeId: string;
  yearsExperience: number;
  specialization: string;
  notes: string;
  primaryClient: string;
  serviceArea: string;
  shiftPreference: string;
  maxInspectionsPerDay: number;
  status: string;
  role: string;
  allowOvertime: boolean;
  sendNotifications: boolean;
  rating: number;
  busesInspected: number;
  busesAssigned: number;
  tests: { road: number; water: number };
  snags: { total: number; byArea: string; safetyCritical: number };
  avatarBg?: string;
}

function mapUserToInspector(user: UserListItem, stats: InspectorStatistics | null): Inspector {
  return {
    id: user.id,
    fullName: user.name,
    shortName: user.name.split(' ').map((p) => p[0]).join('. ') + '.',
    email: user.email,
    phone: '',
    location: '',
    badgeId: '',
    yearsExperience: 0,
    specialization: '',
    notes: '',
    primaryClient: user.client,
    serviceArea: '',
    shiftPreference: '',
    maxInspectionsPerDay: 8,
    status: user.isActive ?? true ? 'active' : 'inactive',
    role: user.role,
    allowOvertime: false,
    sendNotifications: true,
    rating: stats?.rating ?? 0,
    busesInspected: stats?.busesInspected ?? 0,
    busesAssigned: stats?.busesAssigned ?? 0,
    tests: { road: stats?.roadTests ?? 0, water: stats?.waterTests ?? 0 },
    snags: {
      total: stats?.totalSnags ?? 0,
      byArea: stats?.snagsByArea ?? '',
      safetyCritical: stats?.safetyCriticalSnags ?? 0,
    },
  };
}

@Component({
  selector: 'app-inspector-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './inspector-profile.component.html',
  styleUrls: ['./inspector-profile.component.scss'],
})
export class InspectorProfileComponent implements OnInit {

  inspector: Inspector = {
    fullName: '',
    shortName: '',
    email: '',
    phone: '',
    location: '',
    badgeId: '',
    yearsExperience: 0,
    specialization: '',
    notes: '',
    primaryClient: '',
    serviceArea: '',
    shiftPreference: '',
    maxInspectionsPerDay: 8,
    status: 'active',
    role: 'Inspector',
    allowOvertime: false,
    sendNotifications: true,
    rating: 0,
    busesInspected: 0,
    busesAssigned: 0,
    tests: { road: 0, water: 0 },
    snags: { total: 0, byArea: '', safetyCritical: 0 },
  };

  isLoading = false;
  loadError = false;
  editMode = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private userMgmt: UserManagementService,
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe((params) => {
      const id = Number(params['id']);
      if (id) {
        this.loadInspectorData(id);
      }
    });
  }

  private loadInspectorData(id: number): void {
    this.isLoading = true;
    this.loadError = false;

    forkJoin({
      user: this.userMgmt.getUserById(id).pipe(catchError(() => of(null))),
      stats: this.userMgmt.getInspectorStatistics(id).pipe(catchError(() => of(null))),
    }).subscribe(({ user, stats }) => {
      this.isLoading = false;
      if (!user) {
        this.loadError = true;
        return;
      }
      this.inspector = mapUserToInspector(user, stats);
    });
  }

  toggleEditMode(): void {
    this.editMode = !this.editMode;
  }

  saveProfile(): void {
    console.log('Inspector updated:', this.inspector);
    alert('Inspector profile updated successfully!');
    this.editMode = false;
  }

  goBack(): void {
    this.router.navigate(['/admin/users/inspectors']);
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase())
      .join('')
      .substring(0, 2);
  }

  getStars(rating: number): boolean[] {
    return Array.from({ length: 5 }, (_, i) => i < rating);
  }

  getStatusBadgeClass(status: string): string {
    const map: Record<string, string> = {
      active: 'bg-success',
      inactive: 'bg-secondary',
      suspended: 'bg-danger',
    };
    return map[status] ?? 'bg-secondary';
  }
}
