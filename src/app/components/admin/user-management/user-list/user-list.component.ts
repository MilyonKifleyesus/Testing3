import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SpkDropdownsComponent } from '../../../../@spk/reusable-ui-elements/spk-dropdowns/spk-dropdowns.component';
import { NgbModal, NgbModalRef, NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { buildPaginationItems, calculateTotalPages, PAGINATION_ELLIPSIS } from '../../../../shared/utils/pagination.utils';
import { ClientService } from '../../../../shared/services/client.service';
import { UserListItem, UserManagementService, ManufacturerOption } from '../../../../shared/services/user-management.service';
import { Client } from '../../../../shared/models/client.model';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  role: string;
  client?: string;
  manufacturer?: string;
  status?: string;
  createdDate?: string;
}

type UserSortColumn = 'id' | 'name' | 'username' | 'role' | 'client' | 'manufacturer';

interface ClientFilterOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SpkDropdownsComponent, NgbModule],
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.scss']
})
export class UserListComponent implements OnInit {
  readonly paginationEllipsis = PAGINATION_ELLIPSIS;
  readonly apiFetchPageSize = 200;
  confirmModalRef: NgbModalRef | null = null;
  confirmAction: (() => void) | null = null;
  confirmMessage: string = '';
  confirmTitle: string = '';

  constructor(
    private modalService: NgbModal,
    private clientService: ClientService,
    private userManagementService: UserManagementService,
  ) {}
  
  filteredUsers: User[] = [];
  allUsers: User[] = [];
  private searchedUsers: User[] = [];
  Math = Math;
  
  // Pagination properties
  pageSize: number = 10;
  currentPage: number = 1;
  totalCount: number = 0;
  isLoading: boolean = false;
  
  // Filter properties
  selectedClient: string = '0';
  selectedManufacturer: string = '0';
  selectedRole: string = 'all';
  selectedRoleApiValue: string = '';
  searchTerm: string = '';

  // Filter options
  clients: ClientFilterOption[] = [];
  manufacturers: ManufacturerOption[] = [];
  roles: string[] = [];

  sortColumn: UserSortColumn = 'id';
  sortDirection: 'asc' | 'desc' = 'asc';

  ngOnInit() {
    this.loadFilterOptions();
  }

  private loadFilterOptions() {
    forkJoin({
      clients: this.clientService.getClients().pipe(catchError(() => of([] as Client[]))),
      manufacturers: this.userManagementService.getManufacturers(0).pipe(catchError(() => of([] as ManufacturerOption[]))),
      roles: this.userManagementService.getRoles().pipe(catchError(() => of(['Admin', 'Client User', 'Inspector', 'Manager', 'Viewer']))),
    }).subscribe(({ clients, manufacturers, roles }) => {
      this.clients = clients
        .map((client) => ({
          id: String(client.id ?? '').trim(),
          name: String(client.name ?? '').trim(),
        }))
        .filter((client) => client.id.length > 0 && client.name.length > 0);

      this.manufacturers = manufacturers;
      this.roles = roles.length > 0 ? roles : ['Admin', 'Client User', 'Inspector', 'Manager', 'Viewer'];

      if (this.selectedRole !== 'all' && !this.roles.includes(this.selectedRole)) {
        this.selectedRole = this.roles[0] ?? 'Admin';
      }

      this.selectedRoleApiValue = this.resolveApiRoleValue(this.selectedRole);

      this.loadUsersFromApi();
    });
  }

  filterUsers() {
    this.currentPage = 1;
    this.loadUsersFromApi();
  }

  onClientChange(clientId: string): void {
    this.selectedClient = String(clientId ?? '0').trim() || '0';
    // Manufacturer options are dependent on the selected client context.
    // Reset to "All" to avoid sending stale cross-client combinations.
    this.selectedManufacturer = '0';
    this.currentPage = 1;
    this.loadUsersFromApi();
  }

  onRoleChange(role: string) {
    this.selectedRole = String(role ?? 'all').trim() || 'all';
    this.selectedRoleApiValue = this.resolveApiRoleValue(this.selectedRole);
    this.currentPage = 1;
    this.searchTerm = '';
    this.loadUsersFromApi();
  }

  private resolveApiRoleValue(role: string): string {
    const normalized = String(role ?? '').trim();
    if (!normalized || normalized.toLowerCase() === 'all') {
      return '';
    }

    const lookup: Record<string, string> = {
      'admin': 'Admin',
      'user': 'User',
      'client user': 'User',
      'inspector': 'Inspector',
      'manager': 'Manager',
      'viewer': 'Viewer',
      'superadmin': 'SuperAdmin',
      'super admin': 'SuperAdmin',
    };

    return lookup[normalized.toLowerCase()] ?? normalized;
  }

  onSort(column: UserSortColumn) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }

    this.currentPage = 1;
    this.applySearchFilter();
  }

  getSortIndicator(column: UserSortColumn): string {
    if (this.sortColumn !== column) {
      return '';
    }
    return this.sortDirection === 'asc' ? '▲' : '▼';
  }

  private getApiRoleParam(selectedRole: string): string {
    const normalized = String(selectedRole ?? '').trim();
    if (!normalized || normalized.toLowerCase() === 'all') {
      return '';
    }

    if (normalized.toLowerCase() === 'client user') {
      return 'User';
    }

    return normalized;
  }

  private sortUsers(users: User[]): User[] {
    const direction = this.sortDirection === 'asc' ? 1 : -1;
    const value = (user: User): string | number => {
      switch (this.sortColumn) {
        case 'id':
          return user.id;
        case 'name':
          return (user.name ?? '').toLowerCase();
        case 'username':
          return (user.username ?? '').toLowerCase();
        case 'role':
          return (user.role ?? '').toLowerCase();
        case 'client':
          return (user.client ?? '').toLowerCase();
        case 'manufacturer':
          return (user.manufacturer ?? '').toLowerCase();
        default:
          return '';
      }
    };

    return [...users].sort((leftUser, rightUser) => {
      const left = value(leftUser);
      const right = value(rightUser);

      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * direction;
      }

      return String(left).localeCompare(String(right)) * direction;
    });
  }

  private resolveClientNameFromId(clientId: string): string | undefined {
    const normalizedId = String(clientId ?? '').trim();
    if (!normalizedId || normalizedId === '0') {
      return undefined;
    }

    const match = this.clients.find((client) => String(client.id).trim() === normalizedId);
    if (match?.name) {
      return match.name;
    }

    const resolved = this.clientService.resolveClientName(normalizedId, '');
    return resolved || `Client #${normalizedId}`;
  }

  private resolveManufacturerNameFromId(manufacturerId: string): string | undefined {
    const normalizedId = String(manufacturerId ?? '').trim();
    if (!normalizedId || normalizedId === '0') {
      return undefined;
    }

    const match = this.manufacturers.find((manufacturer) => String(manufacturer.id).trim() === normalizedId);
    return match?.name || `Manufacturer #${normalizedId}`;
  }

  private applySearchFilter() {
    const filtered = this.allUsers.filter((user) => {
      const matchesSearch = !this.searchTerm ||
        user.name.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        user.username.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        user.email.toLowerCase().includes(this.searchTerm.toLowerCase());

      return matchesSearch;
    });

    this.searchedUsers = this.sortUsers(filtered);

    this.totalCount = this.searchedUsers.length;
    const totalPages = this.getTotalPages();
    if (this.currentPage > totalPages) {
      this.currentPage = totalPages;
    }
    if (this.currentPage < 1) {
      this.currentPage = 1;
    }

    this.applyPagination();
  }

  private loadUsersFromApi() {
    this.isLoading = true;

    this.userManagementService.getUsers({
      page: 1,
      pageSize: this.apiFetchPageSize,
      role: this.selectedRoleApiValue,
      clientId: this.selectedClient,
      manufacturerId: this.selectedManufacturer,
    }).subscribe({
      next: (response) => {
        let mappedUsers = response.items.map((user: UserListItem) => {
          const clientId = String(user.clientId ?? '').trim();
          const manufacturerId = String(user.manufacturerId ?? '').trim();
          const hasClientId = clientId.length > 0 && clientId !== '0';
          const hasManufacturerId = manufacturerId.length > 0 && manufacturerId !== '0';

          const clientName =
            user.client || (hasClientId ? this.resolveClientNameFromId(clientId) : '');
          const manufacturerName =
            user.manufacturer || (hasManufacturerId ? this.resolveManufacturerNameFromId(manufacturerId) : '');

          return {
            id: user.id,
            name: user.name,
            username: user.username,
            email: user.email,
            role: user.role,
            client: clientName || undefined,
            manufacturer: manufacturerName || undefined,
            status: user.status || undefined,
            createdDate: user.createdDate || undefined,
          };
        });

        const requestedRole = this.selectedRoleApiValue.trim().toLowerCase();
        if (requestedRole) {
          mappedUsers = mappedUsers.filter((user) => user.role.trim().toLowerCase() === requestedRole);
        }

        this.allUsers = mappedUsers;
        this.applySearchFilter();
        this.isLoading = false;
      },
      error: () => {
        this.allUsers = [];
        this.filteredUsers = [];
        this.totalCount = 0;
        this.isLoading = false;
      },
    });
  }

  nextPage() {
    if (this.currentPage < this.getTotalPages()) {
      this.currentPage++;
      this.applyPagination();
    }
  }

  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.applyPagination();
    }
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.getTotalPages()) {
      this.currentPage = page;
      this.applyPagination();
    }
  }

  getTotalPages(): number {
    return calculateTotalPages(this.totalCount, this.pageSize);
  }

  getPageNumbers(): number[] {
    return buildPaginationItems(this.getTotalPages(), this.currentPage, 5);
  }

  getShowingStart(): number {
    if (this.totalCount <= 0) {
      return 0;
    }
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  getShowingEnd(): number {
    if (this.totalCount <= 0) {
      return 0;
    }
    return Math.min(this.currentPage * this.pageSize, this.totalCount);
  }

  applyPagination() {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    this.filteredUsers = this.searchedUsers.slice(startIndex, endIndex);
  }

  onSearchChange() {
    this.currentPage = 1;
    this.applySearchFilter();
  }

  getUserInitials(name: string): string {
    return name
      .split(' ')
      .map((word: string) => word.charAt(0).toUpperCase())
      .join('')
      .substring(0, 2);
  }

  getRoleClass(role: string): string {
    const roleClassMap: { [key: string]: string } = {
      'admin': 'bg-primary',
      'client user': 'bg-info',
      'inspector': 'bg-warning',
      'manager': 'bg-success',
      'viewer': 'bg-secondary'
    };
    return roleClassMap[role.toLowerCase()] || 'bg-secondary';
  }

  openConfirmModal(message: string, title: string, action: () => void, modalContent: any) {
    this.confirmMessage = message;
    this.confirmTitle = title;
    this.confirmAction = action;
    this.confirmModalRef = this.modalService.open(modalContent, { centered: true });
  }

  confirmModalYes() {
    if (this.confirmAction) {
      this.confirmAction();
    }
    if (this.confirmModalRef) {
      this.confirmModalRef.close();
    }
  }

  confirmModalNo() {
    if (this.confirmModalRef) {
      this.confirmModalRef.dismiss();
    }
  }

  resetPassword(user: User, modalContent: any): void {
    this.openConfirmModal(
      `Send password reset email to ${user.email}?`,
      'Reset Password',
      () => {
        console.log('Reset password for user:', user.id);
        alert('Password reset email sent successfully!');
      },
      modalContent
    );
  }

  deleteUser(user: User, modalContent: any): void {
    this.openConfirmModal(
      `Are you sure you want to delete user "${user.name}"? This action cannot be undone.`,
      'Delete User',
      () => {
        this.allUsers = this.allUsers.filter(u => u.id !== user.id);
        this.filterUsers();
        alert('User deleted successfully!');
      },
      modalContent
    );
  }
}
