import {
  aggregateTicketCreationActivity,
  bucketTicketCreationActivityPoints,
  buildTicketCreationActivityChartOptions,
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
