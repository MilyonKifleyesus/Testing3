import { getFirstDefinedValue, toOptionalText, toText } from '../../utils/api-data.utils';

export interface DashboardTicketActivityPoint {
  date: string;
  count: number;
}

export type DashboardTicketActivityGranularity = 'day' | 'week' | 'month';

export interface DashboardTicketActivityResult {
  points: DashboardTicketActivityPoint[];
  totalTickets: number;
  spanDays: number;
  activeDays: number;
  projectCount: number;
  averagePerDay: number;
  firstTicketAt: string | null;
  lastTicketAt: string | null;
  peakDayDate: string | null;
  peakDayCount: number;
  projectNames: string[];
}

export interface DashboardTicketActivityDateFilter {
  startDate?: string;
  endDate?: string;
}

interface TicketActivityChartThemeConfig {
  mode: 'light' | 'dark';
  foreColor: string;
  axisLabelColor: string;
  axisTitleColor: string;
  gridBorderColor: string;
  tooltipTheme: 'light' | 'dark';
  barColor: string;
  trendColor: string;
  gradientShade: 'light' | 'dark';
  gradientToColor: string;
  annotationBorderColor: string;
  annotationLabelBackground: string;
  annotationLabelColor: string;
  noDataColor: string;
}

const RESPONSIVE_OPTIONS_KEY = '__busPulseResponsiveOptions';
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function extractDayKey(createdAt: string): string | null {
  const normalized = String(createdAt ?? '').trim();
  if (!normalized) {
    return null;
  }

  const directDateMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directDateMatch) {
    return directDateMatch[1];
  }

  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString().slice(0, 10);
}

function addDays(dayKey: string, days: number): string {
  const start = new Date(`${dayKey}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + days);
  return start.toISOString().slice(0, 10);
}

function getBucketKey(dayKey: string, granularity: DashboardTicketActivityGranularity): string {
  if (granularity === 'month') {
    return `${dayKey.slice(0, 7)}-01`;
  }

  if (granularity === 'week') {
    const start = new Date(`${dayKey}T00:00:00Z`);
    const day = start.getUTCDay();
    const offset = day === 0 ? -6 : 1 - day;
    start.setUTCDate(start.getUTCDate() + offset);
    return start.toISOString().slice(0, 10);
  }

  return dayKey;
}

function getTicketActivityChartTheme(isDarkTheme: boolean): TicketActivityChartThemeConfig {
  if (isDarkTheme) {
    return {
      mode: 'dark',
      foreColor: '#a0aec0',
      axisLabelColor: '#a0aec0',
      axisTitleColor: '#cbd5e1',
      gridBorderColor: 'rgba(255,255,255,0.06)',
      tooltipTheme: 'dark',
      barColor: '#7c6fe0',
      trendColor: '#c5c8ff',
      gradientShade: 'dark',
      gradientToColor: '#9188ff',
      annotationBorderColor: 'rgba(148, 163, 184, 0.35)',
      annotationLabelBackground: 'rgba(15, 23, 42, 0.88)',
      annotationLabelColor: '#e2e8f0',
      noDataColor: '#94a3b8',
    };
  }

  return {
    mode: 'light',
    foreColor: '#475569',
    axisLabelColor: '#64748b',
    axisTitleColor: '#334155',
    gridBorderColor: 'rgba(148,163,184,0.18)',
    tooltipTheme: 'light',
    barColor: '#4f46e5',
    trendColor: '#0f766e',
    gradientShade: 'light',
    gradientToColor: '#818cf8',
    annotationBorderColor: 'rgba(71, 85, 105, 0.28)',
    annotationLabelBackground: 'rgba(255, 255, 255, 0.96)',
    annotationLabelColor: '#1e293b',
    noDataColor: '#64748b',
  };
}

function formatTicketActivityDateLabel(
  granularity: DashboardTicketActivityGranularity,
  value: string,
  timestamp?: number,
  compact = false,
): string {
  const resolvedDate = Number.isFinite(timestamp)
    ? new Date(Number(timestamp))
    : new Date(String(value ?? ''));

  if (Number.isNaN(resolvedDate.getTime())) {
    return String(value ?? '');
  }

  const day = resolvedDate.getUTCDate();
  const month = MONTH_LABELS[resolvedDate.getUTCMonth()] ?? '';
  const year = resolvedDate.getUTCFullYear();

  if (granularity === 'month') {
    return compact ? `${month} ${String(year).slice(-2)}` : `${month} ${year}`;
  }

  if (compact) {
    return `${month} ${day}`;
  }

  return `${day} ${month}`;
}

function buildTicketActivityResponsiveOptions(
  pointCount: number,
  granularity: DashboardTicketActivityGranularity,
  averagePerDay: number,
) {
  return ({ width }: { width: number; height: number }) => {
    const compact = width <= 768;
    const mobile = width <= 480;
    const tiny = width <= 375;
    const hasMultiplePoints = pointCount > 1;

    const targetTicks = granularity === 'month'
      ? (mobile ? 3 : compact ? 4 : 6)
      : granularity === 'week'
        ? (mobile ? 4 : compact ? 5 : 7)
        : (tiny ? 3 : mobile ? 4 : compact ? 6 : 8);

    const tickAmount = hasMultiplePoints
      ? Math.max(2, Math.min(pointCount, targetTicks))
      : undefined;

    const columnWidth = tiny
      ? '72%'
      : pointCount >= 60
        ? mobile
          ? '68%'
          : compact
            ? '60%'
            : '44%'
        : pointCount >= 40
          ? mobile
            ? '64%'
            : compact
              ? '54%'
              : '50%'
          : pointCount >= 24
            ? mobile
              ? '60%'
              : compact
                ? '50%'
                : '56%'
            : compact
              ? '48%'
              : '56%';

    const labelFontSize = tiny ? '9px' : mobile ? '10px' : '11px';

    return {
      chart: {
        redrawOnParentResize: true,
        redrawOnWindowResize: true,
        parentHeightOffset: 0,
        animations: {
          enabled: true,
          dynamicAnimation: {
            speed: mobile ? 140 : 180,
          },
        },
      },
      stroke: {
        width: [0, mobile ? 2 : 2.5],
      },
      markers: {
        size: [0, mobile ? 0 : 2],
      },
      plotOptions: {
        bar: {
          columnWidth,
          borderRadius: mobile ? 5 : 8,
        },
      },
      grid: {
        padding: {
          top: compact ? 4 : 10,
          right: mobile ? 2 : 10,
          bottom: 0,
          left: mobile ? 0 : 6,
        },
      },
      xaxis: {
        tickAmount,
        labels: {
          rotate: 0,
          hideOverlappingLabels: true,
          trim: true,
          minHeight: 0,
          maxHeight: mobile ? 34 : 42,
          style: {
            fontSize: labelFontSize,
          },
          formatter: (value: string, timestamp?: number) =>
            formatTicketActivityDateLabel(granularity, value, timestamp, compact),
        },
      },
      yaxis: {
        tickAmount: mobile ? 4 : 5,
        labels: {
          minWidth: mobile ? 24 : 34,
          style: {
            fontSize: labelFontSize,
          },
        },
      },
      tooltip: {
        followCursor: mobile,
      },
      annotations: averagePerDay > 0 && compact ? { yaxis: [] } : undefined,
    };
  };
}

export function aggregateTicketCreationActivity(
  tickets: unknown[],
  filter: DashboardTicketActivityDateFilter = {},
): DashboardTicketActivityResult {
  const countsByDay = new Map<string, number>();
  const projectNames = new Set<string>();
  const projectIds = new Set<string>();
  const startDayKey = String(filter.startDate ?? '').trim() || null;
  const endDayKey = String(filter.endDate ?? '').trim() || null;

  let firstTicketAt: string | null = null;
  let lastTicketAt: string | null = null;
  let firstDayKey: string | null = null;
  let lastDayKey: string | null = null;
  let firstTimestamp = Number.POSITIVE_INFINITY;
  let lastTimestamp = Number.NEGATIVE_INFINITY;

  for (const ticket of tickets ?? []) {
    const createdAt = toOptionalText(getFirstDefinedValue(ticket, [
      'createdAt',
      'createdDate',
      'dateCreated',
      'date',
      'CreatedAt',
      'CreatedDate',
    ]));

    if (!createdAt) {
      continue;
    }

    const dayKey = extractDayKey(createdAt);
    if (!dayKey) {
      continue;
    }

    if (startDayKey && dayKey < startDayKey) {
      continue;
    }

    if (endDayKey && dayKey > endDayKey) {
      continue;
    }

    countsByDay.set(dayKey, (countsByDay.get(dayKey) ?? 0) + 1);

    const projectId = toOptionalText(getFirstDefinedValue(ticket, [
      'projectId',
      'ProjectId',
      'projectID',
      'ProjectID',
      'project_id',
    ]));
    if (projectId) {
      projectIds.add(projectId);
    }

    const projectName = toOptionalText(getFirstDefinedValue(ticket, [
      'projectName',
      'ProjectName',
      'project.name',
      'project.title',
      'name',
    ]));
    if (projectName) {
      projectNames.add(projectName);
    }

    const parsedTimestamp = Date.parse(createdAt);
    if (!Number.isNaN(parsedTimestamp)) {
      if (parsedTimestamp < firstTimestamp) {
        firstTimestamp = parsedTimestamp;
        firstTicketAt = createdAt;
      }
      if (parsedTimestamp > lastTimestamp) {
        lastTimestamp = parsedTimestamp;
        lastTicketAt = createdAt;
      }
    } else {
      if (!firstTicketAt || createdAt < firstTicketAt) {
        firstTicketAt = createdAt;
      }
      if (!lastTicketAt || createdAt > lastTicketAt) {
        lastTicketAt = createdAt;
      }
    }

    if (!firstDayKey || dayKey < firstDayKey) {
      firstDayKey = dayKey;
    }
    if (!lastDayKey || dayKey > lastDayKey) {
      lastDayKey = dayKey;
    }
  }

  if (!countsByDay.size || !firstDayKey || !lastDayKey) {
    return {
      points: [],
      totalTickets: 0,
      spanDays: 0,
      activeDays: 0,
      projectCount: projectIds.size,
      averagePerDay: 0,
      firstTicketAt,
      lastTicketAt,
      peakDayDate: null,
      peakDayCount: 0,
      projectNames: Array.from(projectNames).sort((left, right) => left.localeCompare(right)),
    };
  }

  const points: DashboardTicketActivityPoint[] = [];
  let cursor = firstDayKey;
  let peakDayDate = firstDayKey;
  let peakDayCount = countsByDay.get(firstDayKey) ?? 0;

  while (cursor <= lastDayKey) {
    const count = countsByDay.get(cursor) ?? 0;
    points.push({ date: cursor, count });

    if (count > peakDayCount) {
      peakDayCount = count;
      peakDayDate = cursor;
    }

    cursor = addDays(cursor, 1);
  }

  const totalTickets = points.reduce((sum, point) => sum + point.count, 0);
  const activeDays = points.filter((point) => point.count > 0).length;
  const spanDays = points.length;

  return {
    points,
    totalTickets,
    spanDays,
    activeDays,
    projectCount: projectIds.size,
    averagePerDay: spanDays > 0 ? Number((totalTickets / spanDays).toFixed(2)) : 0,
    firstTicketAt,
    lastTicketAt,
    peakDayDate,
    peakDayCount,
    projectNames: Array.from(projectNames).sort((left, right) => left.localeCompare(right)),
  };
}

export function bucketTicketCreationActivityPoints(
  points: DashboardTicketActivityPoint[],
  granularity: DashboardTicketActivityGranularity,
): DashboardTicketActivityPoint[] {
  if (granularity === 'day') {
    return points;
  }

  const countsByBucket = new Map<string, number>();

  for (const point of points ?? []) {
    const bucketKey = getBucketKey(point.date, granularity);
    countsByBucket.set(bucketKey, (countsByBucket.get(bucketKey) ?? 0) + Number(point.count ?? 0));
  }

  return Array.from(countsByBucket.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, count]) => ({ date, count }));
}

export function buildTicketCreationActivityChartOptions(
  baseChartOptions: any,
  activity: DashboardTicketActivityResult,
  granularity: DashboardTicketActivityGranularity = 'day',
  isDarkTheme = true,
): any {
  const theme = getTicketActivityChartTheme(isDarkTheme);
  const chartPoints = bucketTicketCreationActivityPoints(activity.points, granularity);
  const trendWindow = granularity === 'month' ? 3 : granularity === 'week' ? 4 : 7;
  const rollingTrend = chartPoints.map((point, index) => {
    const slice = chartPoints.slice(Math.max(0, index - trendWindow + 1), index + 1);
    const average = slice.reduce((sum, entry) => sum + entry.count, 0) / slice.length;
    return {
      x: new Date(`${point.date}T00:00:00Z`).getTime(),
      y: Number(average.toFixed(2)),
    };
  });

  const ticketSeries = chartPoints.map((point) => ({
    x: new Date(`${point.date}T00:00:00Z`).getTime(),
    y: point.count,
  }));

  const averageLabel = activity.averagePerDay > 0
    ? `${toText(activity.averagePerDay, '0')} avg/day`
    : '0 avg/day';

  return {
    ...baseChartOptions,
    [RESPONSIVE_OPTIONS_KEY]: buildTicketActivityResponsiveOptions(
      chartPoints.length,
      granularity,
      activity.averagePerDay,
    ),
    chart: {
      ...(baseChartOptions?.chart ?? {}),
      background: 'transparent',
      foreColor: theme.foreColor,
      redrawOnParentResize: true,
      redrawOnWindowResize: true,
      parentHeightOffset: 0,
    },
    theme: {
      ...(baseChartOptions?.theme ?? {}),
      mode: theme.mode,
    },
    colors: [theme.barColor, theme.trendColor],
    fill: {
      ...(baseChartOptions?.fill ?? {}),
      gradient: {
        ...(baseChartOptions?.fill?.gradient ?? {}),
        shade: theme.gradientShade,
        gradientToColors: [theme.gradientToColor],
      },
    },
    grid: {
      ...(baseChartOptions?.grid ?? {}),
      borderColor: theme.gridBorderColor,
    },
    xaxis: {
      ...(baseChartOptions?.xaxis ?? {}),
      labels: {
        ...(baseChartOptions?.xaxis?.labels ?? {}),
        style: {
          ...(baseChartOptions?.xaxis?.labels?.style ?? {}),
          colors: theme.axisLabelColor,
        },
      },
    },
    yaxis: {
      ...(baseChartOptions?.yaxis ?? {}),
      labels: {
        ...(baseChartOptions?.yaxis?.labels ?? {}),
        style: {
          ...(baseChartOptions?.yaxis?.labels?.style ?? {}),
          colors: theme.axisLabelColor,
        },
      },
      title: {
        ...(baseChartOptions?.yaxis?.title ?? {}),
        style: {
          ...(baseChartOptions?.yaxis?.title?.style ?? {}),
          color: theme.axisTitleColor,
        },
      },
    },
    tooltip: {
      ...(baseChartOptions?.tooltip ?? {}),
      theme: theme.tooltipTheme,
    },
    noData: {
      ...(baseChartOptions?.noData ?? {}),
      style: {
        ...(baseChartOptions?.noData?.style ?? {}),
        color: theme.noDataColor,
      },
    },
    annotations: activity.averagePerDay > 0
      ? {
          yaxis: [
            {
              y: activity.averagePerDay,
              borderColor: theme.annotationBorderColor,
              strokeDashArray: 5,
              label: {
                text: averageLabel,
                borderColor: 'transparent',
                style: {
                  background: theme.annotationLabelBackground,
                  color: theme.annotationLabelColor,
                  fontSize: '11px',
                  fontFamily: 'Poppins, sans-serif',
                },
              },
            },
          ],
        }
      : { yaxis: [] },
    series: [
      {
        name: 'Tickets Created',
        type: 'bar',
        data: ticketSeries,
      },
      {
        name: '7 Day Trend',
        type: 'line',
        data: rollingTrend,
      },
    ],
  };
}
