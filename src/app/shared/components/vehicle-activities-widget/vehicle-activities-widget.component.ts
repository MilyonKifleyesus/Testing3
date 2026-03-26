import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectInspector, ProjectStats } from '../../models/client-dashboard.models';

interface SparklinePoint {
  x: number;
  y: number;
}

interface SparklineModel {
  gradientId: string;
  linePath: string;
  areaPath: string;
  stroke: string;
  fillStart: string;
  fillEnd: string;
}

function seededWave(seed: string, len = 18): number[] {
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(33, hash) ^ seed.charCodeAt(index)) >>> 0;
  }

  const values: number[] = [];
  for (let index = 0; index < len; index += 1) {
    hash = (Math.imul(1664525, hash) + 1013904223) >>> 0;
    values.push((hash % 70) + 15);
  }

  return values.map((value, index) => {
    const previous = values[index - 1] ?? value;
    const next = values[index + 1] ?? value;
    return Math.round((previous + value + next) / 3);
  });
}

@Component({
  selector: 'app-vehicle-activities-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './vehicle-activities-widget.component.html',
  styleUrls: ['./vehicle-activities-widget.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VehicleActivitiesWidgetComponent implements OnChanges {
  @Input() rows: ProjectStats[] = [];
  @Input() loading = false;
  @Input() totalCount = 0;
  @Input() currentPage = 0;
  @Input() pageSize = 5;
  @Output() pageChange = new EventEmitter<number>();

  readonly skeletonRows = [1, 2, 3, 4, 5];
  readonly inspectorPreviewLimit = 3;

  private readonly sparklineCache = new Map<string, SparklineModel>();
  private readonly compactDateFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  });
  private readonly inspectorToneClasses = [
    'tone--violet',
    'tone--blue',
    'tone--teal',
    'tone--amber',
    'tone--rose',
  ];

  get totalPages(): number {
    return this.pageSize > 0 ? Math.ceil(this.totalCount / this.pageSize) : 0;
  }

  get hasPrev(): boolean {
    return this.currentPage > 0;
  }

  get hasNext(): boolean {
    return this.currentPage < this.totalPages - 1;
  }

  get pageLabel(): string {
    return `Page ${this.currentPage + 1} of ${Math.max(this.totalPages, 1)}`;
  }

  get visibleRangeStart(): number {
    if (this.totalCount === 0 || this.rows.length === 0) {
      return 0;
    }

    return this.currentPage * this.pageSize + 1;
  }

  get visibleRangeEnd(): number {
    if (this.totalCount === 0 || this.rows.length === 0) {
      return 0;
    }

    return Math.min(this.visibleRangeStart + this.rows.length - 1, this.totalCount);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['rows']) {
      this.sparklineCache.clear();
    }
  }

  getVisibleProjectCount(): number {
    return this.rows.length;
  }

  getTotalTickets(): number {
    return this.rows.reduce((sum, row) => sum + (row.totalTickets || 0), 0);
  }

  getTotalCritical(): number {
    return this.rows.reduce((sum, row) => sum + (row.safetyCriticalTickets ?? 0), 0);
  }

  getTotalRepeated(): number {
    return this.rows.reduce((sum, row) => sum + (row.repeatedTickets ?? 0), 0);
  }

  getActiveCount(): number {
    return this.rows.filter((row) => this.getStatusKey(row) === 'active').length;
  }

  getVehicleCount(row: ProjectStats): number {
    return row.vehicles?.length || 0;
  }

  getChangeLabel(row: ProjectStats): string {
    const percentage = Math.abs(row.ticketsChangePercentage ?? 0);
    if (percentage === 0) {
      return '0.0%';
    }

    const prefix = row.ticketsStatus === 'increased' ? '+' : '-';
    return `${prefix}${percentage.toFixed(1)}%`;
  }

  getChangeClass(row: ProjectStats): string {
    if ((row.ticketsChangePercentage ?? 0) === 0) {
      return 'change--neutral';
    }

    return row.ticketsStatus === 'increased' ? 'change--up' : 'change--down';
  }

  getStatusLabel(row: ProjectStats): string {
    const labels = {
      critical: 'Critical',
      warning: 'Watch',
      inactive: 'Idle',
      active: 'Active',
    };

    return labels[this.getStatusKey(row)];
  }

  getStatusClass(row: ProjectStats): string {
    const classes = {
      critical: 'status--critical',
      warning: 'status--warning',
      inactive: 'status--idle',
      active: 'status--active',
    };

    return classes[this.getStatusKey(row)];
  }

  getIconClass(row: ProjectStats): string {
    const classes = {
      critical: 'icon--critical',
      warning: 'icon--warning',
      inactive: 'icon--idle',
      active: 'icon--active',
    };

    return classes[this.getStatusKey(row)];
  }

  getRowClass(row: ProjectStats): string {
    const statusKey = this.getStatusKey(row);
    if (statusKey === 'critical') {
      return 'row--critical';
    }

    if (statusKey === 'warning') {
      return 'row--warning';
    }

    return '';
  }

  getInspectorPreview(row: ProjectStats): ProjectInspector[] {
    return (row.inspectors ?? []).slice(0, this.inspectorPreviewLimit);
  }

  getInspectorOverflowCount(row: ProjectStats): number {
    return Math.max((row.inspectors?.length ?? 0) - this.inspectorPreviewLimit, 0);
  }

  getInspectorCountLabel(row: ProjectStats): string {
    const count = row.inspectors?.length ?? 0;
    if (count === 0) {
      return 'No inspectors';
    }

    return `${count} inspector${count === 1 ? '' : 's'}`;
  }

  getInspectorTooltip(row: ProjectStats): string {
    return (row.inspectors ?? []).map((inspector) => inspector.name).join(', ');
  }

  getInspectorToneClass(inspector: ProjectInspector): string {
    const key = inspector.name || inspector.initials || 'inspector';
    return this.inspectorToneClasses[this.hashCode(key) % this.inspectorToneClasses.length];
  }

  getProjectTypeClass(row: ProjectStats): string {
    const typeClassMap: Record<string, string> = {
      'New Build': 'type--blue',
      'Condition Assessment': 'type--purple',
      PDI: 'type--amber',
      'Mid-Life Overhaul': 'type--green',
    };

    return typeClassMap[row.projectType ?? ''] ?? 'type--grey';
  }

  getTicketCaption(row: ProjectStats): string {
    const criticalCount = row.safetyCriticalTickets ?? 0;
    if (criticalCount > 0) {
      return `${criticalCount} critical`;
    }

    const repeatedCount = row.repeatedTickets ?? 0;
    if (repeatedCount > 0) {
      return `${repeatedCount} repeated`;
    }

    const vehicleCount = this.getVehicleCount(row);
    return `${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'} in scope`;
  }

  getProjectMeta(row: ProjectStats): string {
    if (row.lastStationName) {
      return `Last station: ${row.lastStationName}`;
    }

    const vehicleCount = this.getVehicleCount(row);
    if (vehicleCount > 0) {
      return `${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'} in scope`;
    }

    return 'Awaiting tracker data';
  }

  getStatusMeta(row: ProjectStats): string {
    const statusKey = this.getStatusKey(row);
    if (statusKey === 'critical') {
      const criticalCount = row.safetyCriticalTickets ?? 0;
      return criticalCount > 0 ? `${criticalCount} safety-critical issues` : 'Immediate attention needed';
    }

    if (statusKey === 'warning') {
      const repeatedCount = row.repeatedTickets ?? 0;
      return repeatedCount > 0 ? `${repeatedCount} repeated issues` : 'Volume trend needs review';
    }

    if (!row.lastActivityDate) {
      return 'No recent sync';
    }

    const parsed = new Date(row.lastActivityDate);
    if (Number.isNaN(parsed.getTime())) {
      return 'Recent sync detected';
    }

    return `Last sync ${this.compactDateFormatter.format(parsed)}`;
  }

  getYesterdayLabel(row: ProjectStats): string {
    if (row.ticketsYesterday == null) {
      return '-';
    }

    return `${row.ticketsYesterday}`;
  }

  getSparkline(row: ProjectStats): SparklineModel {
    const seed = row.projectId || row.projectName || 'project';
    const history = row.sparklineHistory?.tickets?.length ? row.sparklineHistory.tickets : seededWave(seed);
    const cacheKey = `${seed}|${history.join(',')}|${this.getStatusKey(row)}`;
    const cached = this.sparklineCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const tone = this.getStatusKey(row);
    const stroke = tone === 'critical'
      ? '#ef4444'
      : tone === 'warning'
        ? '#f59e0b'
        : tone === 'inactive'
          ? '#64748b'
          : '#16a34a';
    const points = this.buildPoints(history);
    const first = points[0];
    const last = points[points.length - 1];
    const baseline = 38;

    const model: SparklineModel = {
      gradientId: `spark-${this.hashCode(cacheKey)}`,
      linePath: points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '),
      areaPath: first && last
        ? [`M ${first.x} ${baseline}`, ...points.map((point) => `L ${point.x} ${point.y}`), `L ${last.x} ${baseline}`, 'Z'].join(' ')
        : '',
      stroke,
      fillStart: this.hexToRgba(stroke, 0.24),
      fillEnd: this.hexToRgba(stroke, 0.02),
    };

    this.sparklineCache.set(cacheKey, model);
    return model;
  }

  trackById(_: number, row: ProjectStats): string {
    return row.projectId;
  }

  trackInspector(_: number, inspector: ProjectInspector): string {
    return `${inspector.name}|${inspector.avatarUrl ?? ''}|${inspector.initials}`;
  }

  private getStatusKey(row: ProjectStats): 'critical' | 'warning' | 'inactive' | 'active' {
    if ((row.safetyCriticalTickets ?? 0) > 0) {
      return 'critical';
    }

    if ((row.repeatedPercent ?? 0) >= 15 || (row.repeatedTickets ?? 0) >= 3) {
      return 'warning';
    }

    if (!row.lastActivityDate) {
      return 'inactive';
    }

    const parsed = new Date(row.lastActivityDate);
    if (Number.isNaN(parsed.getTime())) {
      return 'inactive';
    }

    const diffHours = (Date.now() - parsed.getTime()) / 3600000;
    return diffHours > 168 ? 'inactive' : 'active';
  }

  private buildPoints(series: number[]): SparklinePoint[] {
    const safeSeries = series.length >= 2 ? series : [0, 0];
    const min = Math.min(...safeSeries);
    const max = Math.max(...safeSeries);
    const range = Math.max(max - min, 1);
    const width = 150;
    const height = 40;
    const xPadding = 2;
    const yPadding = 2;
    const usableWidth = width - xPadding * 2;
    const usableHeight = height - yPadding * 2;

    return safeSeries.map((value, index) => ({
      x: Number((xPadding + (usableWidth * index) / Math.max(safeSeries.length - 1, 1)).toFixed(2)),
      y: Number((height - yPadding - ((value - min) / range) * usableHeight).toFixed(2)),
    }));
  }

  private hashCode(input: string): number {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
      hash = (Math.imul(31, hash) + input.charCodeAt(index)) >>> 0;
    }
    return hash;
  }

  private hexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '');
    const safeHex = normalized.length === 3
      ? normalized.split('').map((char) => `${char}${char}`).join('')
      : normalized;

    const value = Number.parseInt(safeHex, 16);
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
}
