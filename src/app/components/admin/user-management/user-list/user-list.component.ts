import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SpkDropdownsComponent } from '../../../../@spk/reusable-ui-elements/spk-dropdowns/spk-dropdowns.component';
import { NgbModal, NgbModalRef, NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { buildPaginationItems, PAGINATION_ELLIPSIS } from '../../../../shared/utils/pagination.utils';
import { ClientService } from '../../../../shared/services/client.service';
import { UserListItem, UserManagementService, ManufacturerOption } from '../../../../shared/services/user-management.service';
import { Client } from '../../../../shared/models/client.model';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

interface User {
  id: number;
  userName: string;
  name: string;
  email: string | null;
  role: string;
  clientName: string;
  manufacturerName: string;
  deleted: boolean;
}

type UserSortColumn = 'id' | 'name' | 'userName' | 'role' | 'clientName' | 'manufacturerName';

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
export class UserListComponent implements OnInit, OnDestroy {
  readonly paginationEllipsis = PAGINATION_ELLIPSIS;
  readonly pageSize = 10;

  confirmModalRef: NgbModalRef | null = null;
  confirmAction: (() => void) | null = null;
  confirmMessage = '';
  confirmTitle = '';

  filteredUsers: User[] = [];
  totalCount = 0;
  currentPage = 1;
  isLoading = false;

  selectedClient = '0';
  selectedManufacturer = '0';
  selectedRole = 'all';
  searchTerm = '';

  clients: ClientFilterOption[] = [];
  manufacturers: ManufacturerOption[] = [];
  roles = ['Admin', 'Client User', 'Inspector'];

  sortColumn: UserSortColumn = 'id';
  sortDirection: 'asc' | 'desc' = 'asc';

  private loadSub?: Subscription;
  private readonly subscriptions = new Subscription();

  constructor(
    private readonly modalService: NgbModal,
    private readonly clientService: ClientService,
    private readonly userManagementService: UserManagementService,
  ) {}

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  get pageStartItem(): number {
    if (!this.totalCount) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEndItem(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalCount);
  }

  get visiblePages(): number[] {
    return buildPaginationItems(this.totalPages, this.currentPage, 5);
  }

  ngOnInit(): void {
    const filterSub = forkJoin({
      clients: this.clientService.getClients().pipe(catchError(() => of([] as Client[]))),
      manufacturers: this.userManagementService.getManufacturers(0).pipe(catchError(() => of([] as ManufacturerOption[]))),
    }).subscribe(({ clients, manufacturers }) => {
      this.clients = clients
        .map((c) => ({ id: String(c.id ?? '').trim(), name: String(c.name ?? '').trim() }))
        .filter((c) => c.id.length > 0 && c.name.length > 0);
      this.manufacturers = manufacturers;
      this.loadUsers();
    });
    this.subscriptions.add(filterSub);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private resetPagination(): void {
    this.currentPage = 1;
    this.totalCount = 0;
  }

  private loadUsers(): void {
    this.isLoading = true;
    this.loadSub?.unsubscribe();

    const role = this.selectedRole.toLowerCase() === 'all' ? '' : this.selectedRole;

    this.loadSub = this.userManagementService.getUsers({
      page: this.currentPage,
      pageSize: this.pageSize,
      search: this.searchTerm.trim(),
      role,
      clientId: this.selectedClient,
      manufacturerId: this.selectedManufacturer,
      sortBy: this.sortColumn,
      sortDirection: this.sortDirection,
    }).subscribe({
      next: ({ items, totalCount }) => {
        this.filteredUsers = items.map((user: UserListItem) => ({
          id: user.id,
          userName: user.userName,
          name: user.name,
          email: user.email,
          role: user.role,
          clientName: user.clientName,
          manufacturerName: user.manufacturerName,
          deleted: user.deleted,
        }));
        this.totalCount = totalCount;
        this.isLoading = false;
      },
      error: () => {
        this.filteredUsers = [];
        this.totalCount = 0;
        this.isLoading = false;
      },
    });
    this.subscriptions.add(this.loadSub);
  }

  onSort(column: UserSortColumn): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.resetPagination();
    this.loadUsers();
  }

  getSortIndicator(column: UserSortColumn): string {
    if (this.sortColumn !== column) return '';
    return this.sortDirection === 'asc' ? '▲' : '▼';
  }

  filterUsers(): void {
    this.resetPagination();
    this.loadUsers();
  }

  onClientChange(clientId: string): void {
    this.selectedClient = String(clientId ?? '0').trim() || '0';
    this.selectedManufacturer = '0';
    this.resetPagination();
    this.loadUsers();
  }

  onRoleChange(role: string): void {
    this.selectedRole = String(role ?? 'all').trim() || 'all';
    this.searchTerm = '';
    this.resetPagination();
    this.loadUsers();
  }

  onSearchChange(): void {
    this.userManagementService.clearUsersCache();
    this.resetPagination();
    this.loadUsers();
  }

  getTotalPages(): number {
    return this.totalPages;
  }

  getPageNumbers(): number[] {
    return this.visiblePages;
  }

  getShowingStart(): number {
    return this.pageStartItem;
  }

  getShowingEnd(): number {
    return this.pageEndItem;
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.loadUsers();
  }

  nextPage(): void {
    this.changePage(this.currentPage + 1);
  }

  previousPage(): void {
    this.changePage(this.currentPage - 1);
  }

  goToPage(page: number): void {
    this.changePage(page);
  }

  getUserInitials(name: string): string {
    return name
      .split(' ')
      .map((word: string) => word.charAt(0).toUpperCase())
      .join('')
      .substring(0, 2);
  }

  getRoleClass(role: string): string {
    const roleClassMap: Record<string, string> = {
      'admin': 'bg-primary',
      'client user': 'bg-info',
      'inspector': 'bg-warning',
      'manager': 'bg-success',
      'viewer': 'bg-secondary',
    };
    return roleClassMap[role.toLowerCase()] || 'bg-secondary';
  }

  openConfirmModal(message: string, title: string, action: () => void, modalContent: unknown): void {
    this.confirmMessage = message;
    this.confirmTitle = title;
    this.confirmAction = action;
    this.confirmModalRef = this.modalService.open(modalContent, { centered: true });
  }

  confirmModalYes(): void {
    this.confirmAction?.();
    this.confirmModalRef?.close();
  }

  confirmModalNo(): void {
    this.confirmModalRef?.dismiss();
  }

  resetPassword(user: User, modalContent: unknown): void {
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

  deleteUser(user: User, modalContent: unknown): void {
    this.openConfirmModal(
      `Are you sure you want to delete user "${user.name}"? This action cannot be undone.`,
      'Delete User',
      () => {
        this.filteredUsers = this.filteredUsers.filter((u) => u.id !== user.id);
        this.totalCount = Math.max(0, this.totalCount - 1);
      },
      modalContent
    );
  }
}
