import {
  buildProjectDurationChartOptions,
  buildProjectsByAreaChartOptions,
  extractProjectsByAreaData,
} from './dashboard-chart.utils';

describe('extractProjectsByAreaData', () => {
  it('returns null when payload is null', () => {
    expect(extractProjectsByAreaData(null)).toBeNull();
  });

  it('returns null when payload has no projectsByArea field', () => {
    expect(extractProjectsByAreaData({ totalTickets: 5 })).toBeNull();
  });

  it('reads projectsByArea directly from payload', () => {
    const payload = {
      projectsByArea: {
        projectNames: ['Alpha', 'Beta'],
        areas: [
          { name: 'Exterior', data: [3, 5] },
          { name: 'Interior', data: [1, 2] },
        ],
      },
    };
    const result = extractProjectsByAreaData(payload);
    expect(result).not.toBeNull();
    expect(result!.projectNames).toEqual(['Alpha', 'Beta']);
    expect(result!.areas.length).toBe(2);
    expect(result!.areas[0]).toEqual({ name: 'Exterior', data: [3, 5] });
  });

  it('reads projectsByArea from payload.data envelope', () => {
    const payload = {
      data: {
        projectsByArea: {
          projectNames: ['Project X'],
          areas: [{ name: 'Roof', data: [7] }],
        },
      },
    };
    const result = extractProjectsByAreaData(payload);
    expect(result).not.toBeNull();
    expect(result!.projectNames).toEqual(['Project X']);
    expect(result!.areas[0].name).toBe('Roof');
  });

  it('reads projectsByArea from payload.result envelope', () => {
    const payload = {
      result: {
        projectsByArea: {
          projectNames: ['Project Y'],
          areas: [{ name: 'UnderCarriage', data: [4] }],
        },
      },
    };
    const result = extractProjectsByAreaData(payload);
    expect(result!.projectNames).toEqual(['Project Y']);
  });

  it('returns null when projectNames is empty', () => {
    const payload = {
      projectsByArea: {
        projectNames: [],
        areas: [{ name: 'Exterior', data: [] }],
      },
    };
    expect(extractProjectsByAreaData(payload)).toBeNull();
  });

  it('returns null when areas is empty', () => {
    const payload = {
      projectsByArea: {
        projectNames: ['Alpha'],
        areas: [],
      },
    };
    expect(extractProjectsByAreaData(payload)).toBeNull();
  });

  it('filters out blank project names', () => {
    const payload = {
      projectsByArea: {
        projectNames: ['Alpha', '', '  ', 'Beta'],
        areas: [{ name: 'Exterior', data: [1, 0, 0, 2] }],
      },
    };
    const result = extractProjectsByAreaData(payload);
    expect(result!.projectNames).toEqual(['Alpha', 'Beta']);
  });

  it('filters out areas with blank names', () => {
    const payload = {
      projectsByArea: {
        projectNames: ['Alpha'],
        areas: [
          { name: '', data: [1] },
          { name: 'Interior', data: [3] },
        ],
      },
    };
    const result = extractProjectsByAreaData(payload);
    expect(result!.areas.length).toBe(1);
    expect(result!.areas[0].name).toBe('Interior');
  });

  it('coerces non-finite data values to 0', () => {
    const payload = {
      projectsByArea: {
        projectNames: ['Alpha'],
        areas: [{ name: 'Roof', data: [null, undefined, NaN, 5] }],
      },
    };
    const result = extractProjectsByAreaData(payload);
    expect(result!.areas[0].data).toEqual([0, 0, 0, 5]);
  });
});

describe('buildProjectsByAreaChartOptions', () => {
  const baseOptions = {
    chart: { type: 'bar', stacked: true },
    xaxis: { labels: { style: { fontSize: '12px' } } },
    colors: ['#aaa'],
  };

  it('sets xaxis.categories to projectNames', () => {
    const data = {
      projectNames: ['P1', 'P2'],
      areas: [{ name: 'Ext', data: [1, 2] }],
    };
    const opts = buildProjectsByAreaChartOptions(baseOptions, data);
    expect(opts.xaxis.categories).toEqual(['P1', 'P2']);
  });

  it('maps areas to series', () => {
    const data = {
      projectNames: ['P1', 'P2'],
      areas: [
        { name: 'Exterior', data: [3, 4] },
        { name: 'Interior', data: [1, 2] },
      ],
    };
    const opts = buildProjectsByAreaChartOptions(baseOptions, data);
    expect(opts.series).toEqual([
      { name: 'Exterior', data: [3, 4] },
      { name: 'Interior', data: [1, 2] },
    ]);
  });

  it('preserves base chart options (colours, chart type, etc.)', () => {
    const data = { projectNames: ['P1'], areas: [{ name: 'A', data: [1] }] };
    const opts = buildProjectsByAreaChartOptions(baseOptions, data);
    expect(opts.chart).toEqual(baseOptions.chart);
    expect(opts.colors).toEqual(baseOptions.colors);
  });

  it('preserves existing xaxis sub-properties (e.g. labels style)', () => {
    const data = { projectNames: ['P1'], areas: [{ name: 'A', data: [1] }] };
    const opts = buildProjectsByAreaChartOptions(baseOptions, data);
    expect(opts.xaxis.labels).toEqual(baseOptions.xaxis.labels);
  });
});

describe('buildProjectDurationChartOptions', () => {
  it('applies the developer check-in palette by project type', () => {
    const opts = buildProjectDurationChartOptions([
      { projectId: '1', projectName: 'Alpha', projectType: 'New Build', durationDays: 10, startDate: null, endDate: null },
      { projectId: '2', projectName: 'Bravo', projectType: 'Condition Assessment', durationDays: 20, startDate: null, endDate: null },
      { projectId: '3', projectName: 'Charlie', projectType: 'PDI', durationDays: 30, startDate: null, endDate: null },
      { projectId: '4', projectName: 'Delta', projectType: 'Mid Life', durationDays: 40, startDate: null, endDate: null },
      { projectId: '5', projectName: 'Echo', projectType: 'Audit', durationDays: 50, startDate: null, endDate: null },
    ], true);

    expect(opts.colors).toEqual(['#16A34A', '#2563EB', '#86EFAC', '#F59E0B', '#DC2626']);
  });

  it('grows chart height when there are many projects so the wrapper can scroll', () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      projectId: String(index + 1),
      projectName: `Project ${index + 1}`,
      projectType: 'New Build',
      durationDays: 10 + index,
      startDate: null,
      endDate: null,
    }));

    const opts = buildProjectDurationChartOptions(items, false);

    expect(opts.chart.height).toBeGreaterThan(420);
    expect(opts.series[0].data.length).toBe(20);
  });

  it('hides the built-in x-axis so the widget can render a fixed footer axis', () => {
    const opts = buildProjectDurationChartOptions([
      { projectId: '1', projectName: 'Alpha', projectType: 'New Build', durationDays: 10, startDate: null, endDate: null },
    ], false);

    expect(opts.xaxis.labels.show).toBeFalse();
    expect(opts.xaxis.title.text).toBeUndefined();
    expect(opts.xaxis.tickAmount).toBe(9);
  });
});
