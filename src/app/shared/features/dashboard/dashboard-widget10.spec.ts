/**
 * Widget-10 Full Test Suite: Comparison of Projects by Area
 *
 * Tests the complete data transformation pipeline powering loadProjectsByAreaWidget():
 *
 *   1. extractOverallByAreaEntries()   — normalises all 5 API envelope shapes
 *   2. areaMap building algorithm      — aligns areas across projects (padding with 0)
 *   3. buildProjectsByAreaChartOptions — merges data into ApexCharts config
 *   4. Full pipeline integration        — API responses → final chart options
 *   5. getSelectedOrAllVisibleProjectIds logic — which project IDs to fetch
 *
 * extractOverallByAreaEntries and getSelectedOrAllVisibleProjectIds are private
 * methods of DashboardComponent.  To avoid bootstrapping the 3 000-line component
 * in TestBed, their logic is replicated here as pure functions that must stay
 * in sync with the originals in dashboard.component.ts.
 */

import { buildProjectsByAreaChartOptions } from './dashboard-chart.utils';

// ─────────────────────────────────────────────────────────────────────────────
// Pure replicas of private DashboardComponent helpers
// Keep these in sync with dashboard.component.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replica of DashboardComponent.extractOverallByAreaEntries()
 * (dashboard.component.ts ~line 2106)
 */
function extractOverallByAreaEntries(
  payload: any,
): Array<{ area: string; count: number }> {
  const container =
    payload?.overallByArea ??
    payload?.data?.overallByArea ??
    payload?.result?.overallByArea;

  if (!container) return [];

  const toEntriesFromArray = (
    items: any[],
  ): Array<{ area: string; count: number }> =>
    items
      .map((item: any) => ({
        area: String(
          item?.area ?? item?.name ?? item?.label ?? item?.x ?? '',
        ).trim(),
        count: Number(item?.count ?? item?.value ?? item?.y ?? 0),
      }))
      .filter(
        (e) =>
          e.area.length > 0 && Number.isFinite(e.count) && e.count >= 0,
      );

  if (Array.isArray(container)) return toEntriesFromArray(container);
  if (Array.isArray(container?.items))
    return toEntriesFromArray(container.items);
  if (Array.isArray(container?.$values))
    return toEntriesFromArray(container.$values);

  if (typeof container === 'object') {
    return Object.entries(container)
      .map(([key, value]) => ({
        area: String(key).trim(),
        count: Number(value ?? 0),
      }))
      .filter(
        (e) =>
          e.area.length > 0 && Number.isFinite(e.count) && e.count >= 0,
      );
  }

  return [];
}

/**
 * Replica of the areaMap-building loop inside
 * DashboardComponent.loadProjectsByAreaWidget()
 * (dashboard.component.ts ~line 2580)
 */
interface ProjectInput {
  name: string;
  entries: Array<{ area: string; count: number }>;
}

function buildProjectsByAreaPayload(projects: ProjectInput[]): {
  projectNames: string[];
  areas: Array<{ name: string; data: number[] }>;
} {
  const projectNames: string[] = [];
  const areaMap = new Map<string, number[]>();

  projects.forEach(({ name, entries }, colIdx) => {
    projectNames.push(name);
    const seenAreas = new Set<string>();

    for (const entry of entries) {
      seenAreas.add(entry.area);
      if (!areaMap.has(entry.area)) {
        areaMap.set(entry.area, Array(colIdx).fill(0));
      }
      areaMap.get(entry.area)!.push(entry.count);
    }

    for (const [area, data] of areaMap.entries()) {
      if (!seenAreas.has(area)) {
        data.push(0);
      }
    }
  });

  const areas = Array.from(areaMap.entries()).map(([name, data]) => ({
    name,
    data: data.map((v) => (Number.isFinite(v) ? v : 0)),
  }));

  return { projectNames, areas };
}

/**
 * Replica of DashboardComponent.getSelectedOrAllVisibleProjectIds()
 * (dashboard.component.ts ~line 2639)
 */
function getSelectedOrAllVisibleProjectIds(
  selectedProject: any,
  projects: Array<{ id: any }>,
): string[] {
  const selectedProjectId = String(selectedProject ?? '')
    .trim()
    .toLowerCase();
  if (selectedProjectId && selectedProjectId !== 'all') {
    return [String(selectedProject ?? '').trim()];
  }
  return projects
    .map((p) => String(p.id ?? '').trim())
    .filter((id) => !!id && id.toLowerCase() !== 'all');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. extractOverallByAreaEntries
// ─────────────────────────────────────────────────────────────────────────────

describe('extractOverallByAreaEntries', () => {
  // ── null / missing ────────────────────────────────────────────────────────

  it('returns [] when payload is null', () => {
    expect(extractOverallByAreaEntries(null)).toEqual([]);
  });

  it('returns [] when payload is undefined', () => {
    expect(extractOverallByAreaEntries(undefined)).toEqual([]);
  });

  it('returns [] when overallByArea field is absent', () => {
    expect(extractOverallByAreaEntries({ totalTickets: 5 })).toEqual([]);
  });

  it('returns [] when overallByArea is empty array', () => {
    expect(extractOverallByAreaEntries({ overallByArea: [] })).toEqual([]);
  });

  // ── flat envelope ─────────────────────────────────────────────────────────

  it('reads flat overallByArea array with area + count fields', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [
        { area: 'Exterior', count: 12 },
        { area: 'Interior', count: 7 },
      ],
    });
    expect(result).toEqual([
      { area: 'Exterior', count: 12 },
      { area: 'Interior', count: 7 },
    ]);
  });

  // ── nested envelopes ──────────────────────────────────────────────────────

  it('reads from payload.data.overallByArea', () => {
    const result = extractOverallByAreaEntries({
      data: { overallByArea: [{ area: 'Roof', count: 4 }] },
    });
    expect(result).toEqual([{ area: 'Roof', count: 4 }]);
  });

  it('reads from payload.result.overallByArea', () => {
    const result = extractOverallByAreaEntries({
      result: { overallByArea: [{ area: 'Engine', count: 9 }] },
    });
    expect(result).toEqual([{ area: 'Engine', count: 9 }]);
  });

  // ── field aliases — area ──────────────────────────────────────────────────

  it('accepts name as alias for area', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [{ name: 'Exterior', count: 5 }],
    });
    expect(result[0].area).toBe('Exterior');
  });

  it('accepts label as alias for area', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [{ label: 'UnderCarriage', count: 3 }],
    });
    expect(result[0].area).toBe('UnderCarriage');
  });

  it('accepts x as alias for area', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [{ x: 'Water', count: 2 }],
    });
    expect(result[0].area).toBe('Water');
  });

  // ── field aliases — count ─────────────────────────────────────────────────

  it('accepts value as alias for count', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [{ area: 'Interior', value: 11 }],
    });
    expect(result[0].count).toBe(11);
  });

  it('accepts y as alias for count', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [{ area: 'Function', y: 6 }],
    });
    expect(result[0].count).toBe(6);
  });

  // ── wrapped envelopes ─────────────────────────────────────────────────────

  it('reads from items-wrapped envelope', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: {
        items: [
          { area: 'Exterior', count: 10 },
          { area: 'Interior', count: 3 },
        ],
      },
    });
    expect(result).toEqual([
      { area: 'Exterior', count: 10 },
      { area: 'Interior', count: 3 },
    ]);
  });

  it('reads from $values-wrapped envelope', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: { $values: [{ area: 'Roof', count: 7 }] },
    });
    expect(result).toEqual([{ area: 'Roof', count: 7 }]);
  });

  it('reads from object-map envelope', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: { Exterior: 48, Interior: 21, Roof: 9 },
    });
    expect(result).toContain(jasmine.objectContaining({ area: 'Exterior', count: 48 }));
    expect(result).toContain(jasmine.objectContaining({ area: 'Interior', count: 21 }));
    expect(result).toContain(jasmine.objectContaining({ area: 'Roof', count: 9 }));
    expect(result.length).toBe(3);
  });

  // ── filtering & sanitisation ──────────────────────────────────────────────

  it('filters out entries with blank area names', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [{ area: '', count: 5 }, { area: 'Interior', count: 3 }],
    });
    expect(result.length).toBe(1);
    expect(result[0].area).toBe('Interior');
  });

  it('filters out entries with whitespace-only area names', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [{ area: '   ', count: 5 }, { area: 'Roof', count: 2 }],
    });
    expect(result.length).toBe(1);
    expect(result[0].area).toBe('Roof');
  });

  it('filters out entries with negative counts', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [
        { area: 'Exterior', count: -1 },
        { area: 'Interior', count: 2 },
      ],
    });
    expect(result.length).toBe(1);
    expect(result[0].area).toBe('Interior');
  });

  it('trims whitespace from area names', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [{ area: '  Exterior  ', count: 5 }],
    });
    expect(result[0].area).toBe('Exterior');
  });

  it('coerces string count values to numbers', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [{ area: 'Exterior', count: '15' as any }],
    });
    expect(result[0].count).toBe(15);
  });

  it('treats null count as 0', () => {
    const result = extractOverallByAreaEntries({
      overallByArea: [{ area: 'Roof', count: null as any }],
    });
    expect(result[0].count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. areaMap building algorithm — area alignment across projects
// ─────────────────────────────────────────────────────────────────────────────

describe('buildProjectsByAreaPayload — area alignment algorithm', () => {
  it('handles a single project with multiple areas', () => {
    const { projectNames, areas } = buildProjectsByAreaPayload([
      {
        name: 'Alpha',
        entries: [
          { area: 'Exterior', count: 10 },
          { area: 'Interior', count: 5 },
        ],
      },
    ]);
    expect(projectNames).toEqual(['Alpha']);
    expect(areas.find((a) => a.name === 'Exterior')!.data).toEqual([10]);
    expect(areas.find((a) => a.name === 'Interior')!.data).toEqual([5]);
  });

  it('aligns identical areas across three projects', () => {
    const { projectNames, areas } = buildProjectsByAreaPayload([
      { name: 'Alpha', entries: [{ area: 'Exterior', count: 10 }, { area: 'Interior', count: 5 }] },
      { name: 'Beta',  entries: [{ area: 'Exterior', count: 8  }, { area: 'Interior', count: 3 }] },
      { name: 'Gamma', entries: [{ area: 'Exterior', count: 6  }, { area: 'Interior', count: 9 }] },
    ]);
    expect(projectNames).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(areas.find((a) => a.name === 'Exterior')!.data).toEqual([10, 8, 6]);
    expect(areas.find((a) => a.name === 'Interior')!.data).toEqual([5, 3, 9]);
  });

  it('pads with 0 when an area first appears in project 2 (not project 1)', () => {
    const { areas } = buildProjectsByAreaPayload([
      { name: 'Alpha', entries: [{ area: 'Exterior', count: 10 }] },
      { name: 'Beta',  entries: [{ area: 'Exterior', count: 8 }, { area: 'Roof', count: 4 }] },
    ]);
    expect(areas.find((a) => a.name === 'Roof')!.data).toEqual([0, 4]);
  });

  it('pads with 0 when an area from project 1 is absent in project 2', () => {
    const { areas } = buildProjectsByAreaPayload([
      { name: 'Alpha', entries: [{ area: 'Exterior', count: 10 }, { area: 'Engine', count: 2 }] },
      { name: 'Beta',  entries: [{ area: 'Exterior', count: 8 }] },
    ]);
    expect(areas.find((a) => a.name === 'Engine')!.data).toEqual([2, 0]);
  });

  it('handles three projects where each has a completely unique area', () => {
    const { projectNames, areas } = buildProjectsByAreaPayload([
      { name: 'Alpha', entries: [{ area: 'Exterior', count: 3 }] },
      { name: 'Beta',  entries: [{ area: 'Interior', count: 5 }] },
      { name: 'Gamma', entries: [{ area: 'Roof',     count: 7 }] },
    ]);
    expect(projectNames).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(areas).toHaveSize(3);
    expect(areas.find((a) => a.name === 'Exterior')!.data).toEqual([3, 0, 0]);
    expect(areas.find((a) => a.name === 'Interior')!.data).toEqual([0, 5, 0]);
    expect(areas.find((a) => a.name === 'Roof')!.data).toEqual([0, 0, 7]);
  });

  it('pads all existing areas with 0 for a project that has no area data', () => {
    const { areas } = buildProjectsByAreaPayload([
      { name: 'Alpha', entries: [{ area: 'Exterior', count: 10 }, { area: 'Interior', count: 5 }] },
      { name: 'Beta',  entries: [] },
    ]);
    expect(areas.find((a) => a.name === 'Exterior')!.data).toEqual([10, 0]);
    expect(areas.find((a) => a.name === 'Interior')!.data).toEqual([5, 0]);
  });

  it('returns empty areas when all projects have no area data', () => {
    const { projectNames, areas } = buildProjectsByAreaPayload([
      { name: 'Alpha', entries: [] },
      { name: 'Beta',  entries: [] },
    ]);
    expect(projectNames).toEqual(['Alpha', 'Beta']);
    expect(areas).toHaveSize(0);
  });

  it('returns empty projectNames and areas for an empty project list', () => {
    const { projectNames, areas } = buildProjectsByAreaPayload([]);
    expect(projectNames).toHaveSize(0);
    expect(areas).toHaveSize(0);
  });

  it('every area data array has the same length as projectNames', () => {
    const { projectNames, areas } = buildProjectsByAreaPayload([
      { name: 'Alpha', entries: [{ area: 'Exterior', count: 10 }, { area: 'Interior', count: 3 }] },
      { name: 'Beta',  entries: [{ area: 'Roof',     count: 4  }] },
      { name: 'Gamma', entries: [{ area: 'Exterior', count: 6  }] },
    ]);
    for (const area of areas) {
      expect(area.data.length).toBe(projectNames.length);
    }
  });

  it('handles an area appearing in projects 1 and 3 but not 2', () => {
    const { areas } = buildProjectsByAreaPayload([
      { name: 'Alpha', entries: [{ area: 'Engine', count: 5 }] },
      { name: 'Beta',  entries: [] },
      { name: 'Gamma', entries: [{ area: 'Engine', count: 3 }] },
    ]);
    expect(areas.find((a) => a.name === 'Engine')!.data).toEqual([5, 0, 3]);
  });

  it('handles a single project with no area data', () => {
    const { projectNames, areas } = buildProjectsByAreaPayload([
      { name: 'Only', entries: [] },
    ]);
    expect(projectNames).toEqual(['Only']);
    expect(areas).toHaveSize(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Full pipeline integration
//    API responses → extractOverallByAreaEntries → buildProjectsByAreaPayload
//    → buildProjectsByAreaChartOptions
// ─────────────────────────────────────────────────────────────────────────────

describe('Widget-10 full pipeline integration', () => {
  const baseOptions = {
    chart: { type: 'bar', stacked: true },
    xaxis: { labels: { style: { fontSize: '12px' } } },
    colors: ['#00c49a', '#007b61', '#004f3e'],
    legend: { position: 'top' },
  };

  it('produces correct chart from three standard flat-array API responses', () => {
    const apiResponses = [
      { overallByArea: [{ area: 'Exterior', count: 12 }, { area: 'Interior', count: 7 }, { area: 'Roof', count: 3 }] },
      { overallByArea: [{ area: 'Exterior', count: 9  }, { area: 'Interior', count: 5 }] },                             // no Roof
      { data: { overallByArea: [{ area: 'Interior', count: 4 }, { area: 'Engine', count: 6 }] } },                      // nested + new area
    ];
    const projectLabels = ['Alpha', 'Beta', 'Gamma'];

    const inputProjects = apiResponses.map((res, i) => ({
      name: projectLabels[i],
      entries: extractOverallByAreaEntries(res),
    }));

    const { projectNames, areas } = buildProjectsByAreaPayload(inputProjects);
    const opts = buildProjectsByAreaChartOptions(baseOptions, { projectNames, areas });

    expect(opts.xaxis.categories).toEqual(['Alpha', 'Beta', 'Gamma']);

    expect(opts.series.find((s: any) => s.name === 'Exterior').data).toEqual([12, 9, 0]);
    expect(opts.series.find((s: any) => s.name === 'Interior').data).toEqual([7, 5, 4]);
    expect(opts.series.find((s: any) => s.name === 'Roof').data   ).toEqual([3, 0, 0]);
    expect(opts.series.find((s: any) => s.name === 'Engine').data ).toEqual([0, 0, 6]);

    // base visual options preserved
    expect(opts.colors).toEqual(baseOptions.colors);
    expect(opts.chart.stacked).toBe(true);
    expect(opts.legend).toEqual(baseOptions.legend);
  });

  it('produces correct chart when all responses use object-map envelope', () => {
    const apiResponses = [
      { overallByArea: { Exterior: 20, Interior: 10 } },
      { overallByArea: { Exterior: 15, Roof: 5 } },
    ];
    const inputProjects = apiResponses.map((res, i) => ({
      name: `Project ${i + 1}`,
      entries: extractOverallByAreaEntries(res),
    }));

    const { projectNames, areas } = buildProjectsByAreaPayload(inputProjects);
    const opts = buildProjectsByAreaChartOptions(baseOptions, { projectNames, areas });

    expect(opts.xaxis.categories).toEqual(['Project 1', 'Project 2']);
    expect(opts.series.find((s: any) => s.name === 'Exterior').data).toEqual([20, 15]);
    expect(opts.series.find((s: any) => s.name === 'Interior').data).toEqual([10, 0]);
    expect(opts.series.find((s: any) => s.name === 'Roof').data    ).toEqual([0, 5]);
  });

  it('handles one failed project call (catchError returns {}) gracefully', () => {
    const apiResponses = [
      { overallByArea: [{ area: 'Exterior', count: 10 }, { area: 'Interior', count: 4 }] },
      {},  // simulates catchError(() => of({ id, res: {} })) result
    ];
    const inputProjects = apiResponses.map((res, i) => ({
      name: `Project ${i + 1}`,
      entries: extractOverallByAreaEntries(res),
    }));

    const { projectNames, areas } = buildProjectsByAreaPayload(inputProjects);
    const opts = buildProjectsByAreaChartOptions(baseOptions, { projectNames, areas });

    expect(opts.xaxis.categories).toEqual(['Project 1', 'Project 2']);
    expect(opts.series.find((s: any) => s.name === 'Exterior').data).toEqual([10, 0]);
    expect(opts.series.find((s: any) => s.name === 'Interior').data).toEqual([4, 0]);
  });

  it('handles all failed project calls — produces no series', () => {
    const apiResponses = [{}, {}];
    const inputProjects = apiResponses.map((res, i) => ({
      name: `Project ${i + 1}`,
      entries: extractOverallByAreaEntries(res),
    }));

    const { projectNames, areas } = buildProjectsByAreaPayload(inputProjects);
    expect(projectNames).toHaveSize(2);
    expect(areas).toHaveSize(0);
    // With no areas, loadProjectsByAreaWidget bails early (no chart update).
    // buildProjectsByAreaChartOptions is only called when areas.length > 0.
  });

  it('handles $values-wrapped API response in the full pipeline', () => {
    const apiResponse = {
      overallByArea: { $values: [{ area: 'Exterior', count: 30 }, { area: 'Water', count: 2 }] },
    };
    const entries = extractOverallByAreaEntries(apiResponse);
    const { areas } = buildProjectsByAreaPayload([{ name: 'P1', entries }]);
    expect(areas.find((a) => a.name === 'Exterior')!.data).toEqual([30]);
    expect(areas.find((a) => a.name === 'Water')!.data   ).toEqual([2]);
  });

  it('handles items-wrapped API response in the full pipeline', () => {
    const apiResponse = {
      overallByArea: { items: [{ area: 'Engine', count: 8 }] },
    };
    const entries = extractOverallByAreaEntries(apiResponse);
    const { areas } = buildProjectsByAreaPayload([{ name: 'P1', entries }]);
    expect(areas.find((a) => a.name === 'Engine')!.data).toEqual([8]);
  });

  it('preserves xaxis sub-properties (e.g. label style) while replacing categories', () => {
    const apiResponse = { overallByArea: [{ area: 'Exterior', count: 5 }] };
    const entries = extractOverallByAreaEntries(apiResponse);
    const { projectNames, areas } = buildProjectsByAreaPayload([{ name: 'Alpha', entries }]);
    const opts = buildProjectsByAreaChartOptions(baseOptions, { projectNames, areas });
    expect(opts.xaxis.labels).toEqual(baseOptions.xaxis.labels);
    expect(opts.xaxis.categories).toEqual(['Alpha']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. getSelectedOrAllVisibleProjectIds
// ─────────────────────────────────────────────────────────────────────────────

describe('getSelectedOrAllVisibleProjectIds', () => {
  it('returns only the selected project ID when a specific project is selected', () => {
    const result = getSelectedOrAllVisibleProjectIds('42', [
      { id: '1' }, { id: '2' }, { id: '42' },
    ]);
    expect(result).toEqual(['42']);
  });

  it('returns all project IDs when selectedProject is "all"', () => {
    const result = getSelectedOrAllVisibleProjectIds('all', [
      { id: '1' }, { id: '2' }, { id: '3' },
    ]);
    expect(result).toEqual(['1', '2', '3']);
  });

  it('returns all project IDs when selectedProject is null', () => {
    const result = getSelectedOrAllVisibleProjectIds(null, [
      { id: '10' }, { id: '20' },
    ]);
    expect(result).toEqual(['10', '20']);
  });

  it('returns all project IDs when selectedProject is undefined', () => {
    const result = getSelectedOrAllVisibleProjectIds(undefined, [
      { id: '5' }, { id: '6' },
    ]);
    expect(result).toEqual(['5', '6']);
  });

  it('excludes "all" sentinel value from projects list', () => {
    const result = getSelectedOrAllVisibleProjectIds('all', [
      { id: 'all' }, { id: '5' },
    ]);
    expect(result).toEqual(['5']);
  });

  it('returns empty array when projects list is empty and selection is "all"', () => {
    expect(getSelectedOrAllVisibleProjectIds('all', [])).toEqual([]);
  });

  it('filters out blank project IDs', () => {
    const result = getSelectedOrAllVisibleProjectIds('all', [
      { id: '' }, { id: null }, { id: '7' },
    ]);
    expect(result).toEqual(['7']);
  });

  it('coerces numeric project IDs to strings', () => {
    const result = getSelectedOrAllVisibleProjectIds('all', [
      { id: 1 }, { id: 2 },
    ]);
    expect(result).toEqual(['1', '2']);
  });

  it('handles case-insensitive "ALL" selection', () => {
    const result = getSelectedOrAllVisibleProjectIds('ALL', [
      { id: '10' }, { id: '20' },
    ]);
    expect(result).toEqual(['10', '20']);
  });

  it('single-project selection returns that ID even when it is not in the project list', () => {
    const result = getSelectedOrAllVisibleProjectIds('99', [
      { id: '1' }, { id: '2' },
    ]);
    expect(result).toEqual(['99']);
  });
});
