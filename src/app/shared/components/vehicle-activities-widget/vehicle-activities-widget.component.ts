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

type ApiStatusKey = 'critical' | 'warning' | 'inactive' | 'active' | 'neutral';

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
  private readonly failedBrandLogoKeys = new Set<string>();
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
      this.failedBrandLogoKeys.clear();
    }
  }

  getVisibleProjectCount(): number {
    return this.totalCount;
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
    const percentage = row.ticketsChangePercentage;
    if (percentage == null) {
      return '-';
    }

    if (percentage === 0) {
      return '0.0%';
    }

    const prefix = row.ticketsStatus === 'decreased' ? '-' : '+';
    return `${prefix}${Math.abs(percentage).toFixed(1)}%`;
  }

  getChangeClass(row: ProjectStats): string {
    if (row.ticketsChangePercentage == null || row.ticketsChangePercentage === 0 || !row.ticketsStatus) {
      return 'change--neutral';
    }

    return row.ticketsStatus === 'increased' ? 'change--up' : 'change--down';
  }

  getStatusLabel(row: ProjectStats): string {
    return (row.status ?? this.getFallbackStatusLabel(row.statusTone) ?? '-').trim();
  }

  getStatusClass(row: ProjectStats): string {
    const statusKey = this.getStatusKey(row);
    const classes: Record<ApiStatusKey, string> = {
      critical: 'status--critical',
      warning: 'status--warning',
      inactive: 'status--idle',
      active: 'status--active',
      neutral: 'status--idle',
    };

    return classes[statusKey];
  }

  getIconClass(row: ProjectStats): string {
    const statusKey = this.getStatusKey(row);
    const classes: Record<ApiStatusKey, string> = {
      critical: 'icon--critical',
      warning: 'icon--warning',
      inactive: 'icon--idle',
      active: 'icon--active',
      neutral: 'icon--idle',
    };

    return classes[statusKey];
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
    if (vehicleCount > 0) {
      return `${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'} in scope`;
    }

    return '-';
  }

  getProjectMeta(row: ProjectStats): string {
    if (row.lastStationName) {
      return `Last station: ${row.lastStationName}`;
    }

    const vehicleCount = this.getVehicleCount(row);
    if (vehicleCount > 0) {
      return `${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'} in scope`;
    }

    return '-';
  }

  getStatusMeta(row: ProjectStats): string {
    if (row.statusMeta) {
      return row.statusMeta;
    }

    if (!row.lastActivityDate) {
      return '-';
    }

    const parsed = new Date(row.lastActivityDate);
    if (Number.isNaN(parsed.getTime())) {
      return row.lastActivityDate;
    }

    return `Last sync ${this.compactDateFormatter.format(parsed)}`;
  }

  getYesterdayLabel(row: ProjectStats): string {
    if (row.ticketsYesterday == null) {
      return '-';
    }

    return `${row.ticketsYesterday}`;
  }

  getSparkline(row: ProjectStats): SparklineModel | null {
    const history = row.sparklineHistory?.tickets;
    if (!history?.length) {
      return null;
    }

    const statusKey = this.getStatusKey(row);
    const cacheKey = `${row.projectId}|${history.join(',')}|${statusKey}`;
    const cached = this.sparklineCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const stroke = statusKey === 'critical'
      ? '#ef4444'
      : statusKey === 'warning'
        ? '#f59e0b'
        : statusKey === 'active'
          ? '#16a34a'
          : '#64748b';
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

  hasBrandLogo(projectId: string, kind: 'client' | 'manufacturer', logoUrl?: string | null): boolean {
    if (!logoUrl) {
      return false;
    }

    return !this.failedBrandLogoKeys.has(this.getBrandLogoKey(projectId, kind, logoUrl));
  }

  markBrandLogoFailed(projectId: string, kind: 'client' | 'manufacturer', logoUrl?: string | null): void {
    if (!logoUrl) {
      return;
    }

    this.failedBrandLogoKeys.add(this.getBrandLogoKey(projectId, kind, logoUrl));
  }

  getBrandInitials(name?: string | null): string {
    const safeName = String(name ?? '').trim();
    if (!safeName) {
      return '--';
    }

    return safeName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  private getStatusKey(row: ProjectStats): ApiStatusKey {
    const tone = String(row.statusTone ?? '').trim().toLowerCase();
    if (tone === 'critical') {
      return 'critical';
    }
    if (tone === 'warning') {
      return 'warning';
    }
    if (tone === 'inactive') {
      return 'inactive';
    }
    if (tone === 'active') {
      return 'active';
    }

    const status = String(row.status ?? '').trim().toLowerCase();
    if (['critical', 'danger', 'error'].includes(status)) {
      return 'critical';
    }
    if (['warning', 'watch', 'caution'].includes(status)) {
      return 'warning';
    }
    if (['inactive', 'idle', 'closed', 'paused'].includes(status)) {
      return 'inactive';
    }
    if (['active', 'open', 'healthy', 'ok'].includes(status)) {
      return 'active';
    }

    return 'neutral';
  }

  private getFallbackStatusLabel(statusTone?: string | null): string | null {
    const normalized = String(statusTone ?? '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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

  private getBrandLogoKey(projectId: string, kind: 'client' | 'manufacturer', logoUrl: string): string {
    return `${projectId}:${kind}:${logoUrl}`;
  }
}
