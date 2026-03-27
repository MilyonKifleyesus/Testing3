import {
  aggregateTicketCreationActivity,
  bucketTicketCreationActivityPoints,
  buildTicketCreationActivityChartOptions,
  getTicketActivityCountBetween,
  getTicketActivityPresetRange,
} from './dashboard-ticket-activity.utils';

describe('dashboard-ticket-activity.utils', () => {
  it('aggregates tickets by day and fills missing dates in the range', () => {
    const result = aggregateTicketCreationActivity([
      { projectId: 10, projectName: 'Project Alpha', createdAt: '2026-03-01T09:00:00Z' },
      { projectId: 10, projectName: 'Project Alpha', createdAt: '2026-03-01T14:30:00Z' },
      { projectId: 22, projectName: 'Project Beta', createdAt: '2026-03-03T08:15:00Z' },
    ]);

    expect(result.totalTickets).toBe(3);
    expect(result.spanDays).toBe(3);
    expect(result.activeDays).toBe(2);
    expect(result.projectCount).toBe(2);
    expect(result.firstTicketAt).toBe('2026-03-01T09:00:00Z');
    expect(result.lastTicketAt).toBe('2026-03-03T08:15:00Z');
    expect(result.peakDayDate).toBe('2026-03-01');
    expect(result.peakDayCount).toBe(2);
    expect(result.points).toEqual([
      { date: '2026-03-01', count: 2 },
      { date: '2026-03-02', count: 0 },
      { date: '2026-03-03', count: 1 },
    ]);
  });

  it('builds mixed chart options from aggregated points', () => {
    const activity = aggregateTicketCreationActivity([
      { projectId: 10, createdAt: '2026-03-01T09:00:00Z' },
      { projectId: 10, createdAt: '2026-03-02T09:00:00Z' },
      { projectId: 10, createdAt: '2026-03-02T13:00:00Z' },
    ]);

    const chartOptions = buildTicketCreationActivityChartOptions(
      {
        chart: { type: 'line' },
        series: [],
      },
      activity,
    );

    expect(chartOptions.series.length).toBe(2);
    expect(chartOptions.series[0].name).toBe('Tickets Created');
    expect(chartOptions.series[0].data.length).toBe(2);
    expect(chartOptions.series[1].name).toBe('7 Day Trend');
    expect(chartOptions.annotations.yaxis[0].y).toBe(activity.averagePerDay);
    expect(chartOptions.chart.redrawOnParentResize).toBeTrue();
    expect(typeof chartOptions.__busPulseResponsiveOptions).toBe('function');
  });

  it('applies light theme colors when requested', () => {
    const activity = aggregateTicketCreationActivity([
      { projectId: 10, createdAt: '2026-03-01T09:00:00Z' },
    ]);

    const chartOptions = buildTicketCreationActivityChartOptions(
      {
        chart: { type: 'line' },
        series: [],
        fill: { gradient: {} },
        xaxis: { labels: { style: {} } },
        yaxis: { labels: { style: {} }, title: { style: {} } },
        noData: { style: {} },
      },
      activity,
      'day',
      false,
    );

    expect(chartOptions.theme.mode).toBe('light');
    expect(chartOptions.tooltip.theme).toBe('light');
    expect(chartOptions.xaxis.labels.style.colors).toBe('#64748b');
    expect(chartOptions.yaxis.title.style.color).toBe('#334155');
  });

  it('suppresses datetime axis labels when no ticket activity exists', () => {
    const chartOptions = buildTicketCreationActivityChartOptions(
      {
        chart: { type: 'line' },
        series: [],
        xaxis: { labels: { style: {} } },
        tooltip: {},
      },
      aggregateTicketCreationActivity([]),
    );

    expect(chartOptions.xaxis.type).toBe('category');
    expect(chartOptions.xaxis.categories).toEqual([]);
    expect(chartOptions.xaxis.labels.show).toBeFalse();
    expect(chartOptions.tooltip.enabled).toBeFalse();
  });

  it('filters tickets to the requested created-date range', () => {
    const result = aggregateTicketCreationActivity(
      [
        { projectId: 10, createdAt: '2026-03-01T09:00:00Z' },
        { projectId: 10, createdAt: '2026-03-02T09:00:00Z' },
        { projectId: 10, createdAt: '2026-03-03T09:00:00Z' },
      ],
      {
        startDate: '2026-03-02',
        endDate: '2026-03-03',
      },
    );

    expect(result.totalTickets).toBe(2);
    expect(result.spanDays).toBe(2);
    expect(result.activeDays).toBe(2);
    expect(result.firstTicketAt).toBe('2026-03-02T09:00:00Z');
    expect(result.lastTicketAt).toBe('2026-03-03T09:00:00Z');
    expect(result.points).toEqual([
      { date: '2026-03-02', count: 1 },
      { date: '2026-03-03', count: 1 },
    ]);
  });

  it('buckets daily points into calendar months for long-range charts', () => {
    const buckets = bucketTicketCreationActivityPoints(
      [
        { date: '2026-03-01', count: 2 },
        { date: '2026-03-15', count: 3 },
        { date: '2026-04-02', count: 4 },
      ],
      'month',
    );

    expect(buckets).toEqual([
      { date: '2026-03-01', count: 5 },
      { date: '2026-04-01', count: 4 },
    ]);
  });

  it('reduces label density and hides annotations on compact chart containers', () => {
    const activity = aggregateTicketCreationActivity(
      Array.from({ length: 16 }, (_, index) => ({
        projectId: 10,
        createdAt: `2026-03-${String(index + 1).padStart(2, '0')}T09:00:00Z`,
      })),
    );

    const chartOptions = buildTicketCreationActivityChartOptions(
      {
        chart: { type: 'line' },
        series: [],
      },
      activity,
    );

    const compactOptions = chartOptions.__busPulseResponsiveOptions({ width: 375, height: 320 });

    expect(compactOptions.xaxis.tickAmount).toBe(3);
    expect(compactOptions.plotOptions.bar.columnWidth).toBe('72%');
    expect(compactOptions.annotations.yaxis).toEqual([]);
    expect(compactOptions.tooltip.followCursor).toBeTrue();
  });

  describe('getTicketActivityPresetRange', () => {
    // Fixed reference: Thursday 2026-03-26
    const thursday = new Date('2026-03-26T12:00:00Z');
    // Fixed reference: Monday 2026-03-23
    const monday = new Date('2026-03-23T12:00:00Z');
    // Fixed reference: Sunday 2026-03-22
    const sunday = new Date('2026-03-22T12:00:00Z');

    it('returns yesterday as a single-day range', () => {
      const { startDate, endDate } = getTicketActivityPresetRange('yesterday', thursday);
      expect(startDate).toBe('2026-03-25');
      expect(endDate).toBe('2026-03-25');
    });

    it('returns yesterday correctly when today is Monday', () => {
      const { startDate, endDate } = getTicketActivityPresetRange('yesterday', monday);
      expect(startDate).toBe('2026-03-22');
      expect(endDate).toBe('2026-03-22');
    });

    it('returns Monday-to-today for thisWeek on a Thursday', () => {
      const { startDate, endDate } = getTicketActivityPresetRange('thisWeek', thursday);
      expect(startDate).toBe('2026-03-23');
      expect(endDate).toBe('2026-03-26');
    });

    it('returns Monday-to-today for thisWeek on a Monday', () => {
      const { startDate, endDate } = getTicketActivityPresetRange('thisWeek', monday);
      expect(startDate).toBe('2026-03-23');
      expect(endDate).toBe('2026-03-23');
    });

    it('returns Monday-to-today for thisWeek on a Sunday (week starts on Monday)', () => {
      const { startDate, endDate } = getTicketActivityPresetRange('thisWeek', sunday);
      expect(startDate).toBe('2026-03-16');
      expect(endDate).toBe('2026-03-22');
    });

    it('returns a 30-day range inclusive for 30d preset', () => {
      const { startDate, endDate } = getTicketActivityPresetRange('30d', thursday);
      expect(endDate).toBe('2026-03-26');
      expect(startDate).toBe('2026-02-25');
    });

    it('returns a 90-day range for 90d preset', () => {
      const { startDate, endDate } = getTicketActivityPresetRange('90d', thursday);
      expect(endDate).toBe('2026-03-26');
      expect(startDate).toBe('2025-12-27');
    });
  });

  describe('getTicketActivityCountBetween', () => {
    const activity = aggregateTicketCreationActivity([
      { projectId: 1, createdAt: '2026-03-22T09:00:00Z' }, // Sunday (last week)
      { projectId: 1, createdAt: '2026-03-23T09:00:00Z' }, // Monday (this week)
      { projectId: 1, createdAt: '2026-03-24T09:00:00Z' }, // Tuesday (this week)
      { projectId: 1, createdAt: '2026-03-24T14:00:00Z' }, // Tuesday second ticket
      { projectId: 1, createdAt: '2026-03-25T09:00:00Z' }, // Wednesday / yesterday
      { projectId: 1, createdAt: '2026-03-26T09:00:00Z' }, // Thursday / today
    ]);

    it('counts tickets for yesterday correctly', () => {
      // yesterday relative to 2026-03-26 is 2026-03-25
      const { startDate, endDate } = getTicketActivityPresetRange('yesterday', new Date('2026-03-26T12:00:00Z'));
      expect(getTicketActivityCountBetween(activity, startDate, endDate)).toBe(1);
    });

    it('counts tickets for this week correctly (Mon–Thu)', () => {
      // thisWeek from Thursday 2026-03-26 = Mon 2026-03-23 to Thu 2026-03-26
      const { startDate, endDate } = getTicketActivityPresetRange('thisWeek', new Date('2026-03-26T12:00:00Z'));
      expect(getTicketActivityCountBetween(activity, startDate, endDate)).toBe(5);
    });

    it('excludes tickets from before the start date', () => {
      expect(getTicketActivityCountBetween(activity, '2026-03-24', '2026-03-26')).toBe(4);
    });

    it('returns 0 when no tickets fall in the range', () => {
      expect(getTicketActivityCountBetween(activity, '2026-03-01', '2026-03-10')).toBe(0);
    });

    it('returns 0 for empty activity', () => {
      const empty = aggregateTicketCreationActivity([]);
      expect(getTicketActivityCountBetween(empty, '2026-03-23', '2026-03-26')).toBe(0);
    });
  });

  it('keeps more labels and wider bars on large chart containers', () => {
    const activity = aggregateTicketCreationActivity(
      Array.from({ length: 16 }, (_, index) => ({
        projectId: 10,
        createdAt: `2026-03-${String(index + 1).padStart(2, '0')}T09:00:00Z`,
      })),
    );

    const chartOptions = buildTicketCreationActivityChartOptions(
      {
        chart: { type: 'line' },
        series: [],
      },
      activity,
    );

    const desktopOptions = chartOptions.__busPulseResponsiveOptions({ width: 1366, height: 420 });

    expect(desktopOptions.xaxis.tickAmount).toBe(8);
    expect(desktopOptions.plotOptions.bar.columnWidth).toBe('56%');
    expect(desktopOptions.annotations).toBeUndefined();
    expect(desktopOptions.tooltip.followCursor).toBeFalse();
  });
});
