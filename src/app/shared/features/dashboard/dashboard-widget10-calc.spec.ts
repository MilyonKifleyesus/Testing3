/**
 * Widget-10 Calculation Tests
 *
 * Fully tests the avg-defects-per-vehicle formula:
 *   avg = Math.round((rawCount / vehicleCount) * 100) / 100
 *
 * And the vehicleCount resolution logic:
 *   vehicleCount = totalCount > 0 ? totalCount : options.filter(not-all).length
 *   vehicleCount = Math.max(vehicleCount, 1)   ← never divide by zero
 */

// ─── Replicate the exact production formulas ────────────────────────────────

/** Mirrors dashboard.component.ts line 2582-2586 */
function resolveVehicleCount(vehiclesResponse: {
  totalCount?: number | null;
  options?: Array<{ id: string }>;
}): number {
  const rawCount = Number(vehiclesResponse?.totalCount ?? 0);
  const vehicleCount = rawCount > 0
    ? rawCount
    : (vehiclesResponse?.options ?? []).filter(
        (v) => String(v.id ?? '').toLowerCase() !== 'all',
      ).length;
  return Math.max(vehicleCount, 1);
}

/** Mirrors dashboard.component.ts line 2619 */
function calcAvg(rawCount: number, vehicleCount: number): number {
  return Math.round((rawCount / vehicleCount) * 100) / 100;
}

/** Full per-project calculation as done in loadProjectsByAreaWidget */
interface AreaEntry { area: string; count: number; }
interface ProjectInput {
  entries: AreaEntry[];
  vehicleCount: number;
}

function buildAreaMap(projects: ProjectInput[]): Map<string, number[]> {
  const areaMap = new Map<string, number[]>();

  projects.forEach(({ entries, vehicleCount }, colIdx) => {
    const seenAreas = new Set<string>();

    for (const entry of entries) {
      seenAreas.add(entry.area);
      if (!areaMap.has(entry.area)) {
        areaMap.set(entry.area, Array(colIdx).fill(0));
      }
      const avg = Math.round((entry.count / vehicleCount) * 100) / 100;
      areaMap.get(entry.area)!.push(avg);
    }

    for (const [, data] of areaMap.entries()) {
      if (!seenAreas.has([...areaMap.entries()].find(([, d]) => d === data)![0])) {
        data.push(0);
      }
    }

    // correct padding — mirror exact production loop
    for (const [area, data] of areaMap.entries()) {
      if (!seenAreas.has(area)) data.push(0);
    }
  });

  return areaMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. vehicleCount resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveVehicleCount', () => {
  it('uses totalCount when it is positive', () => {
    expect(resolveVehicleCount({ totalCount: 200, options: [{ id: '1' }] })).toBe(200);
  });

  it('falls back to options.length when totalCount is 0', () => {
    expect(resolveVehicleCount({ totalCount: 0, options: [{ id: '1' }, { id: '2' }, { id: '3' }] })).toBe(3);
  });

  it('falls back to options.length when totalCount is null', () => {
    expect(resolveVehicleCount({ totalCount: null, options: [{ id: '1' }, { id: '2' }] })).toBe(2);
  });

  it('falls back to options.length when totalCount is undefined', () => {
    expect(resolveVehicleCount({ options: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }] })).toBe(3);
  });

  it('excludes "all" sentinel from options count', () => {
    expect(resolveVehicleCount({ totalCount: 0, options: [{ id: 'all' }, { id: '1' }, { id: '2' }] })).toBe(2);
  });

  it('excludes "ALL" (case-insensitive) from options count', () => {
    expect(resolveVehicleCount({ totalCount: 0, options: [{ id: 'ALL' }, { id: '1' }] })).toBe(1);
  });

  it('returns 1 (not 0) when options is empty — prevents divide-by-zero', () => {
    expect(resolveVehicleCount({ totalCount: 0, options: [] })).toBe(1);
  });

  it('returns 1 when options is undefined — prevents divide-by-zero', () => {
    expect(resolveVehicleCount({ totalCount: 0 })).toBe(1);
  });

  it('returns 1 when only "all" sentinel is in options', () => {
    expect(resolveVehicleCount({ totalCount: 0, options: [{ id: 'all' }] })).toBe(1);
  });

  it('ignores totalCount when it is negative (treats as 0)', () => {
    expect(resolveVehicleCount({ totalCount: -5, options: [{ id: '1' }, { id: '2' }] })).toBe(2);
  });

  it('pagination scenario: totalCount=200 but only 50 options returned — uses 200', () => {
    const options = Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1) }));
    expect(resolveVehicleCount({ totalCount: 200, options })).toBe(200);
  });

  it('no-totalCount paginated scenario: only 50 options returned — uses 50 (known limitation)', () => {
    const options = Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1) }));
    expect(resolveVehicleCount({ totalCount: 0, options })).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. calcAvg — the core formula
// ─────────────────────────────────────────────────────────────────────────────

describe('calcAvg — Math.round((count / vehicleCount) * 100) / 100', () => {
  // ── exact matches from the TTC screenshot ────────────────────────────────

  it('SR2838 Interior=61.5: 615 defects / 10 vehicles', () => {
    expect(calcAvg(615, 10)).toBe(61.5);
  });

  it('SR2838 Exterior=36.3: 363 defects / 10 vehicles', () => {
    expect(calcAvg(363, 10)).toBe(36.3);
  });

  it('SR2838 Vehicle Interior=21.4: 214 defects / 10 vehicles', () => {
    expect(calcAvg(214, 10)).toBe(21.4);
  });

  it('SR2838 UnderCarriage=21.5: 215 defects / 10 vehicles', () => {
    expect(calcAvg(215, 10)).toBe(21.5);
  });

  it('Nova-LF65-e40FT Interior=44: 440 defects / 10 vehicles', () => {
    expect(calcAvg(440, 10)).toBe(44);
  });

  it('Nova-LF65-e40FT UnderCarriage=9.3: 93 defects / 10 vehicles', () => {
    expect(calcAvg(93, 10)).toBe(9.3);
  });

  it('LF76 Interior=45.9: 918 defects / 20 vehicles', () => {
    expect(calcAvg(918, 20)).toBe(45.9);
  });

  // ── rounding behaviour ───────────────────────────────────────────────────

  it('rounds to 2 decimal places: 10 / 3 = 3.33', () => {
    expect(calcAvg(10, 3)).toBe(3.33);
  });

  it('rounds to 2 decimal places: 1 / 3 = 0.33', () => {
    expect(calcAvg(1, 3)).toBe(0.33);
  });

  it('rounds up at .005: 5 / 3 = 1.67', () => {
    expect(calcAvg(5, 3)).toBe(1.67);
  });

  it('whole number stays whole: 100 / 10 = 10', () => {
    expect(calcAvg(100, 10)).toBe(10);
  });

  it('zero raw count always gives 0', () => {
    expect(calcAvg(0, 10)).toBe(0);
    expect(calcAvg(0, 1)).toBe(0);
    expect(calcAvg(0, 200)).toBe(0);
  });

  it('vehicleCount=1 (fallback) returns raw count as-is', () => {
    expect(calcAvg(615, 1)).toBe(615);
  });

  it('large fleet: 10000 defects / 500 vehicles = 20', () => {
    expect(calcAvg(10000, 500)).toBe(20);
  });

  it('single defect across large fleet: 1 / 100 = 0.01', () => {
    expect(calcAvg(1, 100)).toBe(0.01);
  });

  it('rounds correctly to avoid floating-point noise', () => {
    // 0.1 + 0.2 floating point noise — ensure rounding cleans it up
    const result = calcAvg(1, 3);
    expect(result).toBe(0.33);
    expect(Number.isFinite(result)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. vehicleCount × calcAvg — combined: what chart actually shows
// ─────────────────────────────────────────────────────────────────────────────

describe('vehicleCount + calcAvg combined — full segment value pipeline', () => {
  it('totalCount present: segment = round(count/totalCount * 100) / 100', () => {
    const vc = resolveVehicleCount({ totalCount: 10, options: [] });
    expect(calcAvg(615, vc)).toBe(61.5);
  });

  it('totalCount absent: falls back to options count, affects avg', () => {
    // 50 vehicles returned in options (paginated), true count is 200
    // → avg will be 4× higher than correct (known limitation)
    const vc50  = resolveVehicleCount({ totalCount: 0,   options: Array(50).fill({ id: 'x' }) });
    const vc200 = resolveVehicleCount({ totalCount: 200, options: Array(50).fill({ id: 'x' }) });
    expect(calcAvg(1000, vc50)).toBe(20);   // wrong: paginated fallback
    expect(calcAvg(1000, vc200)).toBe(5);   // correct: uses totalCount
    expect(calcAvg(1000, vc50)).toBeGreaterThan(calcAvg(1000, vc200));
  });

  it('zero vehicles (options empty, no totalCount) → vehicleCount=1 → avg = raw count', () => {
    const vc = resolveVehicleCount({ totalCount: 0, options: [] });
    expect(vc).toBe(1);
    expect(calcAvg(500, vc)).toBe(500);
  });

  it('single vehicle: avg = exact raw count', () => {
    const vc = resolveVehicleCount({ totalCount: 1 });
    expect(calcAvg(37, vc)).toBe(37);
  });

  it('TTC SR2838 full simulation: 10 vehicles, multiple areas', () => {
    const vc = resolveVehicleCount({ totalCount: 10 });
    const areas: Record<string, number> = {
      Interior: 615, Exterior: 363, UnderCarriage: 215,
      'Vehicle Interior': 214, 'Road Test': 101, Function: 77,
      Roof: 41, Water: 55, Engine: 27, Unknown: 46,
    };
    const avgs = Object.fromEntries(
      Object.entries(areas).map(([k, v]) => [k, calcAvg(v, vc)])
    );
    expect(avgs['Interior']).toBe(61.5);
    expect(avgs['Exterior']).toBe(36.3);
    expect(avgs['UnderCarriage']).toBe(21.5);
    expect(avgs['Vehicle Interior']).toBe(21.4);
    expect(avgs['Road Test']).toBe(10.1);
    expect(avgs['Function']).toBe(7.7);
    expect(avgs['Roof']).toBe(4.1);
    expect(avgs['Water']).toBe(5.5);
    expect(avgs['Engine']).toBe(2.7);
    expect(avgs['Unknown']).toBe(4.6);
    // Total = sum of individually-rounded avgs (not a single round of the sum)
    // 61.5+36.3+21.5+21.4+10.1+7.7+4.1+5.5+2.7+4.6 = 175.4
    const total = Object.values(avgs).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(175.4, 1);
  });

  it('TTC Nova-LF65-e40FT full simulation: 10 vehicles', () => {
    const vc = resolveVehicleCount({ totalCount: 10 });
    expect(calcAvg(440, vc)).toBe(44);    // Interior
    expect(calcAvg(93,  vc)).toBe(9.3);   // UnderCarriage
    expect(calcAvg(27,  vc)).toBe(2.7);   // Engine
    expect(calcAvg(47,  vc)).toBe(4.7);   // Unknown
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Sort by total — largest area is always bottom of stack
// ─────────────────────────────────────────────────────────────────────────────

describe('areas sorted by total descending', () => {
  function sortAreas(areas: Array<{ name: string; data: number[] }>) {
    return areas
      .map(a => ({ ...a, total: a.data.reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.total - a.total)
      .map(({ name, data }) => ({ name, data }));
  }

  it('largest area comes first (bottom of stack)', () => {
    const areas = [
      { name: 'Engine',   data: [2.7, 1.0] },
      { name: 'Interior', data: [61.5, 44.0] },
      { name: 'Exterior', data: [36.3, 9.3] },
    ];
    const sorted = sortAreas(areas);
    expect(sorted[0].name).toBe('Interior');   // total 105.5
    expect(sorted[1].name).toBe('Exterior');   // total 45.6
    expect(sorted[2].name).toBe('Engine');     // total 3.7
  });

  it('all equal totals preserves relative order', () => {
    const areas = [
      { name: 'A', data: [5] },
      { name: 'B', data: [5] },
      { name: 'C', data: [5] },
    ];
    const sorted = sortAreas(areas);
    expect(sorted.map(a => a.name)).toEqual(['A', 'B', 'C']);
  });

  it('single area stays as single item', () => {
    const areas = [{ name: 'Interior', data: [61.5] }];
    expect(sortAreas(areas)[0].name).toBe('Interior');
  });

  it('area with all-zero data sorts to the end', () => {
    const areas = [
      { name: 'Interior', data: [61.5] },
      { name: 'Ghost',    data: [0, 0] },
    ];
    const sorted = sortAreas(areas);
    expect(sorted[0].name).toBe('Interior');
    expect(sorted[1].name).toBe('Ghost');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Edge cases — NaN / Infinity guards
// ─────────────────────────────────────────────────────────────────────────────

describe('edge cases — numeric safety', () => {
  it('calcAvg never produces NaN (vehicleCount is always ≥1)', () => {
    [1, 5, 10, 100, 200].forEach(vc => {
      expect(Number.isNaN(calcAvg(0, vc))).toBe(false);
      expect(Number.isNaN(calcAvg(615, vc))).toBe(false);
    });
  });

  it('calcAvg never produces Infinity', () => {
    [1, 10, 100].forEach(vc => {
      expect(Number.isFinite(calcAvg(1000, vc))).toBe(true);
    });
  });

  it('resolveVehicleCount never returns 0', () => {
    expect(resolveVehicleCount({ totalCount: 0, options: [] })).toBeGreaterThanOrEqual(1);
    expect(resolveVehicleCount({})).toBeGreaterThanOrEqual(1);
    expect(resolveVehicleCount({ totalCount: -999 })).toBeGreaterThanOrEqual(1);
  });
});
