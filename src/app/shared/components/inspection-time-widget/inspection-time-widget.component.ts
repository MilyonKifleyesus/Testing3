import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { InspectionTimeData, InspectorTimeEntry } from '../../models/client-dashboard.models';

export interface InspectorTimeRow extends InspectorTimeEntry {
  sharePercent: number;
}

@Component({
  selector: 'app-inspection-time-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inspection-time-widget.component.html',
  styleUrls: ['./inspection-time-widget.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectionTimeWidgetComponent implements OnChanges {
  @Input() data: InspectionTimeData | null = null;
  @Input() loading = false;
  @Input() error = false;
  @Output() retry = new EventEmitter<void>();

  hoveredIndex = -1;
  focusedIndex = -1;
  sortedInspectors: InspectorTimeRow[] = [];
  maxHours = 1;

  readonly skeletonRows = [1, 2, 3, 4, 5];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data']) {
      this.rebuild();
    }
  }

  get totalHours(): number {
    return this.data?.totals.hours ?? 0;
  }

  get totalInspections(): number {
    return this.data?.totals.inspections ?? 0;
  }

  get avgHoursPerInspection(): number {
    if (!this.totalInspections) return 0;
    return this.totalHours / this.totalInspections;
  }

  get topInspector(): string {
    return this.sortedInspectors[0]?.name ?? '—';
  }

  get dateRangeLabel(): string {
    if (!this.data?.dateRange) return '';
    const { start, end } = this.data.dateRange;
    return `${this.formatDate(start)} – ${this.formatDate(end)}`;
  }

  get hasData(): boolean {
    return !!this.data && this.sortedInspectors.length > 0;
  }

  getBarWidth(inspector: InspectorTimeEntry): number {
    return (inspector.hours / this.maxHours) * 100;
  }

  formatHours(h: number): string {
    return h.toFixed(1) + 'h';
  }

  formatAvg(h: number): string {
    return h.toFixed(2) + 'h';
  }

  formatShare(pct: number): string {
    return pct.toFixed(1) + '%';
  }

  getTrendClass(trend?: number): string {
    if (trend == null) return 'it-trend--none';
    if (trend > 0) return 'it-trend--up';
    if (trend < 0) return 'it-trend--down';
    return 'it-trend--flat';
  }

  getTrendLabel(trend?: number): string {
    if (trend == null) return '';
    const sign = trend > 0 ? '+' : '';
    return `${sign}${trend.toFixed(1)}%`;
  }

  getInitials(name: string): string {
    const parts = String(name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);

    if (!parts.length) {
      return '?';
    }

    return parts.map((part) => part.charAt(0).toUpperCase()).join('');
  }

  clearAvatar(inspector: InspectorTimeRow): void {
    inspector.avatarUrl = null;
  }

  trackByInspectorId(_: number, row: InspectorTimeRow): number {
    return row.id;
  }

  private rebuild(): void {
    if (!this.data?.inspectors?.length) {
      this.sortedInspectors = [];
      this.maxHours = 1;
      return;
    }
    const sorted = [...this.data.inspectors].sort((a, b) => b.hours - a.hours);
    this.maxHours = sorted[0].hours || 1;
    const total = sorted.reduce((s, i) => s + i.hours, 0) || 1;
    this.sortedInspectors = sorted.map((inspector) => ({
      ...inspector,
      sharePercent: (inspector.hours / total) * 100,
    }));
  }

  private formatDate(d: string): string {
    if (!d) return '';
    const parts = d.split('-');
    if (parts.length !== 3) return d;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(parts[1], 10) - 1]} ${parseInt(parts[2], 10)}, ${parts[0]}`;
  }
}
