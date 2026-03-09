import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  NgZone,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NGX_ECHARTS_CONFIG, NgxEchartsModule } from 'ngx-echarts';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import 'echarts-wordcloud';
import { distinctUntilChanged, filter, of, Subject, switchMap, catchError, timer } from 'rxjs';
import { DefectWordCloudService } from './defect-word-cloud.service';
import {
  AggregatedWordCloudResult,
  DefectWordCloudBackendFilters,
  DefectWordCloudUiFilters,
  InspectionAreaOption,
  WordCloudDatum,
} from './defect-word-cloud.models';

type LoadRequest = {
  filters: DefectWordCloudBackendFilters;
  forceRefresh: boolean;
  debounce: boolean;
};

type DefectOption = {
  id: string;
  label: string;
  count: number;
};

@Component({
  selector: 'app-defect-word-cloud',
  standalone: true,
  imports: [CommonModule, FormsModule, NgxEchartsModule],
  templateUrl: './defect-word-cloud.component.html',
  styleUrl: './defect-word-cloud.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NGX_ECHARTS_CONFIG,
      useFactory: () => ({ echarts }),
    },
  ],
})
export class DefectWordCloudComponent implements AfterViewInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly ngZone = inject(NgZone);
  private readonly defectWordCloudService = inject(DefectWordCloudService);

  private readonly projectIdSignal = signal<string | null>(null);
  private readonly fullscreenSignal = signal(false);
  private readonly inspectionAreaId = signal('');
  private readonly selectedDefectKey = signal('');
  private readonly vehicleId = signal('');
  private readonly dateFrom = signal('');
  private readonly dateTo = signal('');
  private readonly requestLoad$ = new Subject<LoadRequest>();

  private chartInstance: { resize: () => void; dispose: () => void } | null = null;
  private resizeObserver?: ResizeObserver;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly words = signal<WordCloudDatum[]>([]);
  readonly inspectionAreaOptions = signal<InspectionAreaOption[]>([]);
  readonly totalTickets = signal(0);
  readonly validDescriptionCount = signal(0);
  readonly uniqueDescriptionCount = signal(0);

  readonly uiFilters = computed<DefectWordCloudUiFilters>(() => ({
    inspectionAreaId: this.inspectionAreaId(),
    selectedDefectKey: this.selectedDefectKey(),
    vehicleId: this.vehicleId(),
    dateFrom: this.dateFrom(),
    dateTo: this.dateTo(),
  }));

  readonly backendFilters = computed<DefectWordCloudBackendFilters>(() => ({
    projectId: this.normalizeProjectId(this.projectIdSignal()),
    defectLocationId: this.normalizeValue(this.inspectionAreaId()),
    vehicleId: this.normalizeValue(this.vehicleId()),
    dateFrom: this.normalizeDate(this.dateFrom()),
    dateTo: this.normalizeDate(this.dateTo()),
  }));

  readonly hasInvalidDateRange = computed(() => {
    const from = this.normalizeDate(this.dateFrom());
    const to = this.normalizeDate(this.dateTo());
    return !!from && !!to && from > to;
  });

  readonly hasWidgetOwnedFilters = computed(() => {
    return !!(
      this.normalizeValue(this.inspectionAreaId()) ||
      this.normalizeValue(this.selectedDefectKey()) ||
      this.normalizeValue(this.vehicleId()) ||
      this.normalizeDate(this.dateFrom()) ||
      this.normalizeDate(this.dateTo())
    );
  });

  readonly defectOptions = computed<DefectOption[]>(() =>
    this.words().map((word) => ({
      id: word.key,
      label: word.text,
      count: word.value,
    })),
  );

  readonly filteredWords = computed<WordCloudDatum[]>(() => {
    const allWords = this.words();
    const selectedKey = this.selectedDefectKey();

    if (selectedKey) {
      const match = allWords.find((word) => word.key === selectedKey);
      return match ? [match] : [];
    }

    return allWords.slice(0, 200);
  });

  readonly emptyStateMessage = computed<string | null>(() => {
    if (this.loading() || this.error()) {
      return null;
    }

    if (this.words().length === 0) {
      return this.hasWidgetOwnedFilters()
        ? 'No results for the selected filters'
        : 'No defect data available';
    }

    if (this.filteredWords().length === 0) {
      return 'No results for the selected filters';
    }

    return null;
  });

  readonly chartOptions = computed<EChartsOption>(() => {
    const data = this.filteredWords();
    const maxFontSize = this.fullscreenSignal() ? 72 : 56;

    return {
      animationDuration: 300,
      animationDurationUpdate: 200,
      tooltip: {
        show: true,
        formatter: (params: any) => {
          const text = params?.data?.name ?? 'Unknown';
          const value = Number(params?.data?.value ?? 0);
          return `${text}<br/>${value} ticket${value === 1 ? '' : 's'}`;
        },
      },
      series: [
        {
          type: 'wordCloud',
          shape: 'circle',
          width: '100%',
          height: '100%',
          left: 'center',
          top: 'center',
          rotationRange: [0, 0],
          rotationStep: 0,
          gridSize: this.fullscreenSignal() ? 12 : 8,
          sizeRange: [14, maxFontSize],
          drawOutOfBound: false,
          textStyle: {
            fontFamily: 'inherit',
            fontWeight: 700,
            color: () => {
              const colors = ['#1b5e20', '#2e7d32', '#00897b', '#1565c0', '#6a1b9a'];
              return colors[Math.floor(Math.random() * colors.length)];
            },
          },
          emphasis: {
            textStyle: {
              shadowBlur: 8,
              shadowColor: 'rgba(0, 0, 0, 0.25)',
            },
          },
          data: data.map((word) => ({
            name: word.text,
            value: word.value,
          })),
        } as never,
      ],
    } as EChartsOption;
  });

  @Input() set projectId(value: string | null | undefined) {
    this.projectIdSignal.set(this.normalizeProjectId(value) ?? null);
  }

  @Input() set fullscreen(value: boolean | '' | null | undefined) {
    this.fullscreenSignal.set(Boolean(value));
    this.scheduleChartResize();
  }

  constructor() {
    toObservable(this.backendFilters)
      .pipe(
        distinctUntilChanged((previous, current) =>
          this.defectWordCloudService.createBackendSignature(previous)
          === this.defectWordCloudService.createBackendSignature(current),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((filters) => {
        this.requestLoad$.next({
          filters,
          forceRefresh: false,
          debounce: true,
        });
      });

    toObservable(this.projectIdSignal)
      .pipe(
        distinctUntilChanged(),
        switchMap((projectId) =>
          this.defectWordCloudService.getInspectionAreaOptions(projectId).pipe(
            catchError(() => of([])),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((options) => {
        this.inspectionAreaOptions.set(options);
        if (this.inspectionAreaId() && !options.some((option) => option.id === this.inspectionAreaId())) {
          this.inspectionAreaId.set('');
        }
      });

    this.requestLoad$
      .pipe(
        switchMap((request) => {
          if (this.hasInvalidDateRange()) {
            this.error.set(null);
            this.loading.set(false);
            return of(null);
          }

          this.loading.set(true);
          this.error.set(null);

          return timer(request.debounce ? 250 : 0).pipe(
            switchMap(() =>
              this.defectWordCloudService.getWordCloudData(request.filters, { forceRefresh: request.forceRefresh }).pipe(
                catchError((error) => {
                  this.error.set(this.defectWordCloudService.toUserMessage(error));
                  this.loading.set(false);
                  return of(null);
                }),
              ),
            ),
          );
        }),
        filter((result): result is AggregatedWordCloudResult => result !== null),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.words.set(result.words);
        this.totalTickets.set(result.totalTickets);
        this.validDescriptionCount.set(result.validDescriptionCount);
        this.uniqueDescriptionCount.set(result.uniqueDescriptionCount);
        if (this.selectedDefectKey() && !result.words.some((word) => word.key === this.selectedDefectKey())) {
          this.selectedDefectKey.set('');
        }
        this.loading.set(false);
        this.error.set(null);
        this.scheduleChartResize();
      });
  }

  ngAfterViewInit(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleChartResize());
      this.resizeObserver.observe(this.elementRef.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chartInstance?.dispose();
    this.chartInstance = null;
  }

  onChartInit(instance: any): void {
    this.chartInstance = instance;
    this.scheduleChartResize();
  }

  onInspectionAreaChange(value: string): void {
    this.inspectionAreaId.set(value);
  }

  onSelectedDefectChange(value: string): void {
    this.selectedDefectKey.set(value);
    this.scheduleChartResize();
  }

  onVehicleIdChange(value: string): void {
    this.vehicleId.set(value);
  }

  onDateFromChange(value: string): void {
    this.dateFrom.set(value);
  }

  onDateToChange(value: string): void {
    this.dateTo.set(value);
  }

  resetFilters(): void {
    this.inspectionAreaId.set('');
    this.selectedDefectKey.set('');
    this.vehicleId.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
  }

  retry(): void {
    if (this.hasInvalidDateRange()) {
      return;
    }

    this.requestLoad$.next({
      filters: this.backendFilters(),
      forceRefresh: true,
      debounce: false,
    });
  }

  trackByInspectionArea(index: number, option: InspectionAreaOption): string {
    return option.id;
  }

  trackByDefect(index: number, option: DefectOption): string {
    return option.id;
  }

  private scheduleChartResize(): void {
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        if (this.chartInstance) {
          this.chartInstance.resize();
        }
      });
    });
  }

  private normalizeProjectId(value: string | null | undefined): string | undefined {
    const normalized = this.normalizeValue(value);
    if (!normalized || normalized === 'all') {
      return undefined;
    }
    return normalized;
  }

  private normalizeValue(value: string | null | undefined): string | undefined {
    if (value == null) {
      return undefined;
    }

    const normalized = String(value).trim();
    return normalized ? normalized : undefined;
  }

  private normalizeDate(value: string | null | undefined): string | undefined {
    const normalized = this.normalizeValue(value);
    return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
  }
}
