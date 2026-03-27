import { Component, Input, ChangeDetectorRef, ElementRef, AfterViewInit, OnDestroy, ViewChild, OnChanges, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import ApexCharts from 'apexcharts';

const RESPONSIVE_OPTIONS_KEY = '__busPulseResponsiveOptions';

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeChartOptions(baseValue: any, overrideValue: any): any {
  if (overrideValue === undefined) {
    return baseValue;
  }

  if (Array.isArray(overrideValue)) {
    return [...overrideValue];
  }

  if (!isPlainObject(baseValue) || !isPlainObject(overrideValue)) {
    return overrideValue;
  }

  const merged: Record<string, any> = { ...baseValue };

  for (const [key, value] of Object.entries(overrideValue)) {
    merged[key] = mergeChartOptions(merged[key], value);
  }

  return merged;
}

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
    const chartOptionsChange = changes['chartOptions'];
    if (chartOptionsChange) {
      if (this.chartInstance && this.renderChart && this.isViewReady) {
        const seriesPresenceChanged =
          this.hasChartSeriesData(chartOptionsChange.previousValue) !==
          this.hasChartSeriesData(chartOptionsChange.currentValue);

        const prevCount = this.getSeriesPointCount(chartOptionsChange.previousValue);
        const nextCount = this.getSeriesPointCount(chartOptionsChange.currentValue);
        const seriesShapeChanged = Math.abs(prevCount - nextCount) > 5;

        if (seriesPresenceChanged || seriesShapeChanged) {
          this.scheduleChartMount();
          return;
        }

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

    const { width, height } = this.getHostDimensions();
    const chartConfig = this.resolveChartConfig(width, height);

    // Validate that chart config has required data before rendering
    if (!chartConfig || !this.isValidChartConfig(chartConfig)) {
      return;
    }

    try {
      this.chartInstance = new ApexCharts(host, chartConfig);
      this.chartInstance.render();
      this.lastWidth = width;
      this.lastHeight = height;
    } catch {
      this.chartInstance = null;
    }
  }

  private isValidChartConfig(config: any): boolean {
    if (!config?.chart) return false;
    
    // For charts with series data, ensure series is valid
    if (config.series !== undefined) {
      if (!Array.isArray(config.series)) return false;
      if (config.series.length === 0) return false;
      
      // Check each series item is valid
      for (const item of config.series) {
        if (item === undefined || item === null) return false;
        if (Array.isArray(item) && item.length === 0) return false;
        if (typeof item === 'object' && Array.isArray(item.data) && item.data.length === 0) return false;
      }
    }
    
    return true;
  }

  private getSeriesPointCount(config: any): number {
    if (!Array.isArray(config?.series)) return 0;
    let count = 0;
    for (const item of config.series) {
      if (Array.isArray(item)) {
        count += item.length;
      } else if (isPlainObject(item) && Array.isArray(item['data'])) {
        count += item['data'].length;
      } else if (item !== null && item !== undefined) {
        count += 1;
      }
    }
    return count;
  }

  private hasChartSeriesData(config: any): boolean {
    if (!Array.isArray(config?.series) || config.series.length === 0) {
      return false;
    }

    return config.series.some((item: any) => {
      if (item === undefined || item === null) {
        return false;
      }

      if (Array.isArray(item)) {
        return item.length > 0;
      }

      if (typeof item === 'number' || typeof item === 'string') {
        return true;
      }

      if (isPlainObject(item) && Array.isArray(item['data'])) {
        return item['data'].length > 0;
      }

      return true;
    });
  }

  private updateChartOptionsInPlace(): void {
    if (this.isDestroyed || !this.chartInstance || !this.chartOptions) {
      return;
    }

    const { width, height } = this.getHostDimensions();
    const nextOptions = this.resolveChartConfig(width, height);

    // Validate chart config has required data before updating
    if (!nextOptions || !this.isValidChartConfig(nextOptions)) {
      return;
    }

    if (this.updateOptionsTimeout) {
      clearTimeout(this.updateOptionsTimeout);
    }

    this.updateOptionsTimeout = setTimeout(() => {
      const chartInstance = this.chartInstance;
      if (this.isDestroyed || !chartInstance) {
        return;
      }

      try {
        const { series, ...nextChartOptions } = nextOptions;
        const updatePromise = Promise.resolve(
          chartInstance.updateOptions(nextChartOptions, false, false, false)
        );

        void (Array.isArray(series)
          ? updatePromise.then(() => chartInstance.updateSeries(series, false))
          : updatePromise
        ).then(() => {
          if (this.isDestroyed || this.chartInstance !== chartInstance) {
            return;
          }

          if (width > 0) {
            this.lastWidth = width;
          }
          if (height > 0) {
            this.lastHeight = height;
          }
        }).catch(() => {
          this.scheduleChartMount();
        });
      } catch {
        this.scheduleChartMount();
      }
    }, 0);
  }

  exportDataURI(scale = 2): Promise<{ imgURI: string } | null> {
    if (!this.chartInstance) {
      return Promise.resolve(null);
    }
    return (this.chartInstance as any).dataURI({ scale }).catch(() => null);
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
    const { width, height } = this.getHostDimensions();

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
        this.chartInstance.updateOptions(this.resolveChartConfig(width, height), false, false, false);
      } catch {
        // no-op
      }
    }, 50);
  }

  private getHostDimensions(): { width: number; height: number } {
    const container = this.elementRef.nativeElement as HTMLElement;
    return {
      width: container.offsetWidth,
      height: container.offsetHeight,
    };
  }

  private resolveChartConfig(width: number, height: number): any {
    if (!this.chartOptions) {
      return null;
    }

    const responsiveOptionsFactory = this.chartOptions?.[RESPONSIVE_OPTIONS_KEY];
    const { [RESPONSIVE_OPTIONS_KEY]: _responsiveOptionsFactory, ...baseOptions } = this.chartOptions;
    const responsiveOptions = typeof responsiveOptionsFactory === 'function'
      ? responsiveOptionsFactory({ width, height }) ?? {}
      : {};
    const mergedOptions = mergeChartOptions(baseOptions, responsiveOptions);

    return {
      ...mergedOptions,
      chart: {
        ...(mergedOptions?.chart ?? {}),
        width: width > 0 ? width : mergedOptions?.chart?.width,
        height: height > 0 ? height : mergedOptions?.chart?.height,
      },
    };
  }
}
