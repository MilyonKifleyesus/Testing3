import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { UserManagementService, UserListItem, InspectorStatistics } from '../../../../shared/services/user-management.service';
import { buildPaginationItems, PAGINATION_ELLIPSIS } from '../../../../shared/utils/pagination.utils';

interface InspectorCard {
  id: number;
  fullName: string;
  username: string;
  email: string;
  client: string;
  role: string;
  isActive: boolean;
  avatarBg: string;
  statsLoading: boolean;
  busesInspected: number;
  busesAssigned: number;
  tests: { road: number; water: number };
  snags: { total: number; byArea: string; safetyCritical: number };
  rating: number;
}

const AVATAR_BG = '#e9ecef';

function mapUserToCard(user: UserListItem): InspectorCard {
  return {
    id: user.id,
    fullName: user.name || user.username || 'Inspector',
    username: user.username || '',
    email: user.email || '',
    client: user.client || '',
    role: user.role || 'Inspector',
    isActive: user.isActive !== false,
    avatarBg: AVATAR_BG,
    statsLoading: true,
    busesInspected: 0,
    busesAssigned: 0,
    tests: { road: 0, water: 0 },
    snags: { total: 0, byArea: '', safetyCritical: 0 },
    rating: 0,
  };
}

type SortColumn = 'id' | 'fullName' | 'username' | 'email' | 'client' | 'busesInspected' | 'rating' | 'status';

@Component({
  selector: 'app-inspector-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './inspector-list.component.html',
  styleUrl: './inspector-list.component.scss'
})
export class InspectorListComponent implements OnInit {
  readonly paginationEllipsis = PAGINATION_ELLIPSIS;
  readonly pageSize = 10;

  inspectors: InspectorCard[] = [];
  isLoading = false;
  loadError = false;

  viewMode: 'card' | 'table' = 'card';
  searchQuery = '';

  // Sorting
  sortColumn: SortColumn | '' = '';
  sortDirection: 'asc' | 'desc' = 'asc';

  // Pagination
  currentPage = 1;

  // Flip cards (card view)
  flippedCards = new Set<number>();

  // Message modal
  isMessageModalOpen = false;
  selectedInspector: InspectorCard | null = null;
  messageData = { subject: '', body: '', priority: 'normal', sendCopy: false };

  constructor(private userManagementService: UserManagementService) {}

  ngOnInit() {
    this.loadInspectors();
  }

  // ── Computed: sorted + filtered + paginated ───────────────────────────────

  get sortedInspectors(): InspectorCard[] {
    if (!this.sortColumn) return this.inspectors;
    const col = this.sortColumn;
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    return [...this.inspectors].sort((a, b) => {
      const av = this.sortValue(a, col);
      const bv = this.sortValue(b, col);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  get filteredInspectors(): InspectorCard[] {
    const query = this.searchQuery.toLowerCase().trim();
    if (!query) return this.sortedInspectors;
    return this.sortedInspectors.filter(i =>
      String(i.id).includes(query) ||
      i.fullName.toLowerCase().includes(query) ||
      i.username.toLowerCase().includes(query) ||
      i.email.toLowerCase().includes(query) ||
      i.client.toLowerCase().includes(query),
    );
  }

  get paginatedInspectors(): InspectorCard[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredInspectors.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredInspectors.length / this.pageSize));
  }

  get visiblePages(): number[] {
    return buildPaginationItems(this.totalPages, this.currentPage, 5);
  }

  get pageStartItem(): number {
    return this.filteredInspectors.length ? (this.currentPage - 1) * this.pageSize + 1 : 0;
  }

  get pageEndItem(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredInspectors.length);
  }

  // ── Data Loading ──────────────────────────────────────────────────────────

  private loadInspectors() {
    this.isLoading = true;
    this.loadError = false;

    this.userManagementService.getUsers({
      page: 1, pageSize: 200, role: 'Inspector', clientId: '0', manufacturerId: '0',
    }).subscribe({
      next: (result) => {
        const cards = result.items
          .filter(u => u.role.toLowerCase() === 'inspector')
          .map((user) => mapUserToCard(user));

        this.inspectors = cards;
        this.isLoading = false;
        this.loadStatsForAll(cards);
      },
      error: () => {
        this.isLoading = false;
        this.loadError = true;
      },
    });
  }

  private loadStatsForAll(cards: InspectorCard[]) {
    cards.forEach(card => {
      this.userManagementService.getInspectorStatistics(card.id).subscribe({
        next: (stats: InspectorStatistics | null) => {
          if (stats) {
            card.busesInspected = stats.busesInspected;
            card.busesAssigned = stats.busesAssigned;
            card.tests = { road: stats.roadTests, water: stats.waterTests };
            card.snags = {
              total: stats.totalSnags,
              byArea: stats.snagsByArea,
              safetyCritical: stats.safetyCriticalSnags,
            };
            card.rating = stats.rating;
          }
          card.statsLoading = false;
        },
        error: () => { card.statsLoading = false; },
      });
    });
  }

  // ── Sorting ───────────────────────────────────────────────────────────────

  private sortValue(i: InspectorCard, col: SortColumn): string | number {
    switch (col) {
      case 'id':            return i.id;
      case 'fullName':      return i.fullName.toLowerCase();
      case 'username':      return i.username.toLowerCase();
      case 'email':         return i.email.toLowerCase();
      case 'client':        return i.client.toLowerCase();
      case 'busesInspected':return i.busesInspected;
      case 'rating':        return i.rating;
      case 'status':        return i.isActive ? 0 : 1;
      default:              return '';
    }
  }

  sortTable(column: SortColumn): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.currentPage = 1;
  }

  sortIcon(column: SortColumn): string {
    if (this.sortColumn !== column) return '';
    return this.sortDirection === 'asc' ? '▲' : '▼';
  }

  // ── Search ────────────────────────────────────────────────────────────────

  onSearchChange(): void {
    this.currentPage = 1;
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.currentPage = 1;
  }

  // ── Pagination ────────────────────────────────────────────────────────────

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  previousPage(): void { this.changePage(this.currentPage - 1); }
  nextPage(): void     { this.changePage(this.currentPage + 1); }

  // ── View Mode ─────────────────────────────────────────────────────────────

  toggleViewMode(mode: 'card' | 'table') {
    this.viewMode = mode;
    this.currentPage = 1;
    if (mode === 'table') this.flippedCards.clear();
  }

  // ── Flip Cards ────────────────────────────────────────────────────────────

  flipCard(id: number)   { this.flippedCards.add(id); }
  unflipCard(id: number) { this.flippedCards.delete(id); }
  isCardFlipped(id: number): boolean { return this.flippedCards.has(id); }

  // ── Helpers ───────────────────────────────────────────────────────────────

  getInitials(name: string): string {
    return name.split(' ').map(p => p.trim()[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
  }

  getStars(rating: number): boolean[] {
    return Array.from({ length: 5 }, (_, i) => i < Math.round(rating));
  }

  getRatingLabel(rating: number): string {
    if (rating >= 4.5) return 'Excellent';
    if (rating >= 3.5) return 'Good';
    if (rating >= 2.5) return 'Average';
    return 'Needs Improvement';
  }

  // ── Message Modal ─────────────────────────────────────────────────────────

  showMessageModal(inspector: InspectorCard) {
    this.selectedInspector = inspector;
    this.isMessageModalOpen = true;
    this.messageData = { subject: '', body: '', priority: 'normal', sendCopy: false };
    document.body.classList.add('modal-open');
  }

  closeMessageModal() {
    this.isMessageModalOpen = false;
    this.selectedInspector = null;
    document.body.classList.remove('modal-open');
  }

  sendMessage() {
    if (!this.messageData.subject || !this.messageData.body) {
      alert('Please enter both subject and message.');
      return;
    }
    console.log('Sending message to:', this.selectedInspector?.fullName, this.messageData);
    alert(`Message sent successfully to ${this.selectedInspector?.fullName}!`);
    this.closeMessageModal();
  }
}
