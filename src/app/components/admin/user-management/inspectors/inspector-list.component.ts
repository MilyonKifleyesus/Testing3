import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  UserManagementService,
  UserListItem,
  InspectorStatistics,
} from '../../../../shared/services/user-management.service';

interface InspectorCard {
  id: number;
  name: string;
  fullName: string;
  username: string;
  email: string;
  role: string;
  client: string;
  isActive: boolean;
  statsLoading: boolean;
  stats: InspectorStatistics | null;
}

function mapUserToCard(user: UserListItem): InspectorCard {
  return {
    id: user.id,
    name: user.name,
    fullName: user.name,
    username: user.userName,
    email: user.email ?? '',
    role: user.role,
    client: user.clientName ?? '',
    isActive: !user.deleted,
    statsLoading: true,
    stats: null,
  };
}

function buildPaginationItems(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | string)[] = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

@Component({
  selector: 'app-inspector-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './inspector-list.component.html',
  styleUrl: './inspector-list.component.scss',
})
export class InspectorListComponent implements OnInit {
  private static listCache: InspectorCard[] | null = null;

  inspectors: InspectorCard[] = [];
  filteredInspectors: InspectorCard[] = [];

  isLoading = false;
  loadError = false;

  viewMode: 'card' | 'table' = 'card';

  searchQuery = '';

  flippedCards = new Set<number>();

  sortColumn = 'name';
  sortDir: 'asc' | 'desc' = 'asc';

  readonly pageSize = 10;
  currentPage = 1;

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredInspectors.length / this.pageSize));
  }

  get pageStartItem(): number {
    if (!this.filteredInspectors.length) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEndItem(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredInspectors.length);
  }

  get paginatedInspectors(): InspectorCard[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredInspectors.slice(start, start + this.pageSize);
  }

  get visiblePages(): (number | string)[] {
    return buildPaginationItems(this.currentPage, this.totalPages);
  }

  // Message modal
  isMessageModalOpen = false;
  selectedInspector: InspectorCard | null = null;
  messageData = { subject: '', body: '', priority: 'normal', sendCopy: false };

  constructor(private userMgmt: UserManagementService) {}

  ngOnInit(): void {
    if (InspectorListComponent.listCache) {
      this.inspectors = InspectorListComponent.listCache;
      this.filteredInspectors = [...this.inspectors];
      this.loadStatsForAll();
    } else {
      this.loadInspectors();
    }
  }

  private loadInspectors(): void {
    this.isLoading = true;
    this.loadError = false;

    this.userMgmt
      .getUsers({ page: 1, pageSize: 200, role: 'Inspector', clientId: '0', manufacturerId: '0', sortBy: 'name', sortDirection: 'asc', search: this.searchQuery.trim() })
      .pipe(catchError(() => {
        this.loadError = true;
        return of({ items: [], totalCount: 0 });
      }))
      .subscribe((result) => {
        this.isLoading = false;
        this.inspectors = result.items.map((u) => mapUserToCard(u));
        if (!this.searchQuery.trim() && !this.loadError) {
          InspectorListComponent.listCache = this.inspectors;
        }
        this.filteredInspectors = [...this.inspectors];
        this.currentPage = 1;
        if (!this.loadError) this.loadStatsForAll();
      });
  }

  private loadStatsForAll(): void {
    this.inspectors.forEach((insp) => {
      if (insp.stats !== null || !insp.statsLoading) return;
      this.userMgmt.getInspectorStatistics(insp.id).subscribe((stats) => {
        const idx = this.inspectors.findIndex((i) => i.id === insp.id);
        if (idx === -1) return;
        this.inspectors[idx] = { ...this.inspectors[idx], statsLoading: false, stats };
        InspectorListComponent.listCache = this.inspectors;
        this.filteredInspectors = this.filteredInspectors.map((i) =>
          i.id === insp.id ? this.inspectors[idx] : i,
        );
      });
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  getInitials(name: string): string {
    return name
      .split(' ')
      .map((part) => part.trim()[0])
      .filter(Boolean)
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  getStars(rating: number): boolean[] {
    return Array.from({ length: 5 }, (_, i) => i < rating);
  }

  getRatingLabel(rating: number): string {
    return rating >= 4 ? 'Excellent' : 'Good';
  }

  // ── View Mode ────────────────────────────────────────────────────────────────

  toggleViewMode(mode: 'card' | 'table'): void {
    this.viewMode = mode;
    if (mode === 'table') this.flippedCards.clear();
  }

  // ── Search ───────────────────────────────────────────────────────────────────

  searchInspectors(): void {
    this.userMgmt.clearUsersCache();
    InspectorListComponent.listCache = null;
    this.loadInspectors();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.userMgmt.clearUsersCache();
    InspectorListComponent.listCache = null;
    this.loadInspectors();
  }

  // ── Flip Cards ───────────────────────────────────────────────────────────────

  flipCard(id: number): void    { this.flippedCards.add(id); }
  unflipCard(id: number): void  { this.flippedCards.delete(id); }
  isCardFlipped(id: number): boolean { return this.flippedCards.has(id); }

  // ── Sorting ──────────────────────────────────────────────────────────────────

  sortTable(column: string): void {
    if (this.sortColumn === column) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDir = 'asc';
    }
  }

  sortIcon(column: string): string {
    if (this.sortColumn !== column) return '';
    return this.sortDir === 'asc' ? '▲' : '▼';
  }

  // ── Pagination ───────────────────────────────────────────────────────────────

  previousPage(): void { this.changePage(this.currentPage - 1); }
  nextPage(): void     { this.changePage(this.currentPage + 1); }
  changePage(page: number | string): void {
    const p = Number(page);
    if (!Number.isFinite(p) || p < 1 || p > this.totalPages) return;
    this.currentPage = p;
  }

  // ── Message Modal ─────────────────────────────────────────────────────────────

  showMessageModal(inspector: InspectorCard): void {
    this.selectedInspector = inspector;
    this.isMessageModalOpen = true;
    this.messageData = { subject: '', body: '', priority: 'normal', sendCopy: false };
    document.body.classList.add('modal-open');
  }

  closeMessageModal(): void {
    this.isMessageModalOpen = false;
    this.selectedInspector = null;
    document.body.classList.remove('modal-open');
  }

  sendMessage(): void {
    if (!this.messageData.subject || !this.messageData.body) {
      alert('Please enter both subject and message.');
      return;
    }
    console.log('Sending message to:', this.selectedInspector?.fullName, this.messageData);
    alert(`Message sent successfully to ${this.selectedInspector?.fullName}!`);
    this.closeMessageModal();
  }
}
