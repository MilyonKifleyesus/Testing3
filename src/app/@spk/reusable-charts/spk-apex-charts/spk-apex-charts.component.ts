import { Component, Input, ChangeDetectorRef, ElementRef, AfterViewInit, OnDestroy, ViewChild, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import ApexCharts from 'apexcharts';

@Component({
  selector: 'spk-apex-charts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './spk-apex-charts.component.html',
  styleUrl: './spk-apex-charts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SpkApexChartsComponent implements AfterViewInit, OnDestroy, OnChanges {
  @Input() chartOptions: any;
  @ViewChild('chartHost', { static: false }) chartHost?: ElementRef<HTMLDivElement>;

  private resizeObserver?: ResizeObserver;
  private resizeTimeout: any;
  private renderTimeout: any;
  private updateOptionsTimeout: any;
  private renderMountTimeout: any;
  private isDestroyed = false;
  private isViewReady = false;
  private chartInstance: ApexCharts | null = null;
  private lastWidth = 0;
  private lastHeight = 0;
  renderChart = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private elementRef: ElementRef
  ) {}

  ngAfterViewInit(): void {
    this.isViewReady = true;
    this.scheduleChartMount();

    // Initialize ResizeObserver to watch container size changes
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.isDestroyed) {
          return;
        }
        this.handleResize();
      });
      this.resizeObserver.observe(this.elementRef.nativeElement);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['chartOptions']) {
      if (this.chartInstance && this.renderChart && this.isViewReady) {
        this.updateChartOptionsInPlace();
        return;
      }
      this.scheduleChartMount();
    }
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.renderChart = false;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
    if (this.updateOptionsTimeout) {
      clearTimeout(this.updateOptionsTimeout);
    }
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
    }
    if (this.renderMountTimeout) {
      clearTimeout(this.renderMountTimeout);
    }

    this.destroyChartInstance();
  }

  private scheduleChartMount(): void {
    if (this.renderMountTimeout) {
      clearTimeout(this.renderMountTimeout);
    }

    this.renderChart = false;

    if (this.isDestroyed || !this.isViewReady || !this.chartOptions?.chart) {
      this.cdr.markForCheck();
      return;
    }

    this.renderMountTimeout = setTimeout(() => {
      if (this.isDestroyed) {
        return;
      }

      const container = this.elementRef.nativeElement as HTMLElement;
      const isConnected = typeof container?.isConnected === 'boolean'
        ? container.isConnected
        : document.body.contains(container);

      if (!isConnected) {
        return;
      }

      this.renderChart = true;
      this.cdr.markForCheck();

      if (this.renderTimeout) {
        clearTimeout(this.renderTimeout);
      }
      this.renderTimeout = setTimeout(() => {
        if (!this.isDestroyed) {
          this.renderApexChart();
        }
      });
    });
  }

  private renderApexChart(): void {
    if (this.isDestroyed || !this.renderChart || !this.chartOptions || !this.chartHost?.nativeElement) {
      return;
    }

    const host = this.chartHost.nativeElement;
    const isConnected = typeof host?.isConnected === 'boolean'
      ? host.isConnected
      : document.body.contains(host);
    if (!isConnected) {
      return;
    }

    this.destroyChartInstance();

    const width = this.elementRef.nativeElement.offsetWidth;
    const height = this.elementRef.nativeElement.offsetHeight;

    const chartConfig = {
      ...this.chartOptions,
      chart: {
        ...(this.chartOptions?.chart ?? {}),
        width: width > 0 ? width : this.chartOptions?.chart?.width,
        height: height > 0 ? height : this.chartOptions?.chart?.height,
      },
    };

    try {
      this.chartInstance = new ApexCharts(host, chartConfig);
      this.chartInstance.render();
      this.lastWidth = width;
      this.lastHeight = height;
    } catch {
      this.chartInstance = null;
    }
  }

  private updateChartOptionsInPlace(): void {
    if (this.isDestroyed || !this.chartInstance || !this.chartOptions) {
      return;
    }

    const width = this.elementRef.nativeElement.offsetWidth;
    const height = this.elementRef.nativeElement.offsetHeight;

    const nextOptions = {
      ...this.chartOptions,
      chart: {
        ...(this.chartOptions?.chart ?? {}),
        width: width > 0 ? width : this.chartOptions?.chart?.width,
        height: height > 0 ? height : this.chartOptions?.chart?.height,
      },
    };

    if (this.updateOptionsTimeout) {
      clearTimeout(this.updateOptionsTimeout);
    }

    this.updateOptionsTimeout = setTimeout(() => {
      if (this.isDestroyed || !this.chartInstance) {
        return;
      }

      try {
        this.chartInstance.updateOptions(nextOptions, false, true);
        if (Array.isArray(nextOptions?.series)) {
          // Some chart types (notably radial gauges) can ignore series changes
          // through updateOptions alone, so apply series explicitly.
          this.chartInstance.updateSeries(nextOptions.series, true);
        }
        if (width > 0) {
          this.lastWidth = width;
        }
        if (height > 0) {
          this.lastHeight = height;
        }
      } catch {
        this.scheduleChartMount();
      }
    }, 0);
  }

  private destroyChartInstance(): void {
    if (!this.chartInstance) {
      return;
    }

    try {
      this.chartInstance.destroy();
    } catch {
      // no-op
    } finally {
      this.chartInstance = null;
    }
  }

  private handleResize(): void {
    // Debounce resize events
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
    this.resizeTimeout = setTimeout(() => {
      if (this.isDestroyed) {
        return;
      }
      this.updateChartSize();
    }, 100);
  }

  private updateChartSize(): void {
    // Get container dimensions
    const container = this.elementRef.nativeElement;
    const width = container.offsetWidth;
    const height = container.offsetHeight;

    // Update chart options with new dimensions
    if (this.isDestroyed || !this.renderChart || !this.chartOptions || width <= 0 || height <= 0) {
      return;
    }

    const chartType = (this.chartOptions?.chart?.type ?? '').toLowerCase();
    const isCircular = chartType === 'donut' || chartType === 'pie' || chartType === 'radialbar';
    const minWidth = isCircular ? 80 : 48;
    const minHeight = isCircular ? 80 : 48;
    if (width < minWidth || height < minHeight) {
      return;
    }

    if (Math.abs(width - this.lastWidth) < 2 && Math.abs(height - this.lastHeight) < 2) {
      return;
    }

    this.lastWidth = width;
    this.lastHeight = height;

    this.cdr.markForCheck();

    if (!this.chartInstance) {
      this.renderApexChart();
      return;
    }

    if (this.updateOptionsTimeout) {
      clearTimeout(this.updateOptionsTimeout);
    }
    this.updateOptionsTimeout = setTimeout(() => {
      if (this.isDestroyed || !this.chartInstance) {
        return;
      }
      try {
        this.chartInstance.updateOptions(
          {
            chart: {
              ...this.chartOptions?.chart,
              width,
              height,
            },
          },
          false,
          true,
        );
      } catch {
        // no-op
      }
    }, 50);
  }
}
