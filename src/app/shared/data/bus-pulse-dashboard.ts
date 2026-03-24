import type { TicketsByStatusData } from '../models/client-dashboard.models';

// BusPulse Dashboard Data - Fleet Management System

// Text color constant for data labels - dark for readability on light backgrounds
const DATA_LABEL_COLOR = '#212529'; // Using Bootstrap's dark gray color for consistency

// Color palette constants for consistent theming across all charts
const PRIMARY_GREEN_COLORS_2 = ['#609764', '#95c097'];
const PRIMARY_GREEN_COLORS_4 = ['#609764', '#95c097', '#cfead0', '#e0ece2'];
const PRIMARY_GREEN_COLORS_3 = ['#609764', '#95c097', '#cfead0'];
const PRIMARY_GREEN_COLORS_6 = ['#1b5e20', '#2e7d32', '#388e3c', '#4caf50', '#66bb6a', '#81c784'];
const PRIMARY_GREEN_COLORS_3_ALT = ['#609764', '#95c097', '#cfead0'];
const BLUE_ACCENT_COLORS = ['#4099ff', '#00d4ff', '#50c878'];
const SINGLE_GREEN_DARK = ['#2e7d32'];
const SINGLE_GREEN_LIGHT = ['#66bb6a'];
const SINGLE_GREEN_MEDIUM = ['#388e3c'];
const TICKETS_STATUS_GREEN_COLORS = ['#609764', '#95c097', '#cfead0', '#e0ece2', '#66bb6a', '#81c784', '#d1f2d6'];
const TICKETS_STATUS_BAR_COLOR = PRIMARY_GREEN_COLORS_6;
const PROJECTS_BY_STATION_HEATMAP_RANGES = [
  { from: 0, to: 5, color: '#cfead0', name: 'Low' },
  { from: 6, to: 20, color: '#609764', name: 'Medium' },
  { from: 21, to: 999999, color: '#1b5e20', name: 'High' }
];

/**
 * 1. Open and Closed Projects (Donut Chart)
 */
export const openClosedProjectsChart = {
  series: [24, 8],
  labels: ['Open Projects', 'Closed Projects'],
  chart: {
    height: 280,
    type: 'donut',
    sparkline: { enabled: false },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  dataLabels: { enabled: true, style: { colors: [DATA_LABEL_COLOR], fontSize: '13px', fontWeight: 600 } },
  legend: { position: 'bottom', fontSize: '13px', fontFamily: 'Poppins, sans-serif', fontWeight: 500 },
  stroke: { show: true, curve: 'smooth', lineCap: 'round', colors: ['#ff0000'], width: 2, dashArray: 0 },
  plotOptions: {
    pie: {
      expandOnClick: false,
      donut: {
        size: '55%',
        background: 'transparent',
        labels: {
          show: true,
          name: { show: true, fontSize: '13px', color: '#495057', offsetY: -4 },
          value: { show: true, fontSize: '18px', fontWeight: 600, offsetY: 8, color: '#212529' },
          total: { show: true, showAlways: true, label: 'Total Projects', fontSize: '13px', fontWeight: 500, color: '#495057' }
        }
      }
    }
  },
  colors: PRIMARY_GREEN_COLORS_2
};

/**
 * 2. Vehicles Inspected by Make and Model (Donut Chart)
 */
export const vehiclesByMakeModelChart = {
  series: [1],
  labels: ['No Vehicles'],
  chart: {
    height: 280,
    type: 'donut',
    sparkline: { enabled: false },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  dataLabels: { enabled: true, style: { colors: [DATA_LABEL_COLOR], fontSize: '13px', fontWeight: 600 } },
  legend: { position: 'bottom', fontSize: '13px', fontFamily: 'Poppins, sans-serif', fontWeight: 500 },
  stroke: { show: true, curve: 'smooth', lineCap: 'round', colors: ['#fff'], width: 2, dashArray: 0 },
  plotOptions: {
    pie: {
      expandOnClick: false,
      donut: { size: '55%', background: 'transparent' }
    }
  },
  colors: PRIMARY_GREEN_COLORS_4
};

/**
 * 3. Vehicles Inspected by Propulsion Type (Donut Chart)
 */
export const vehiclesByPropulsionChart = {
  series: [1],
  labels: ['No Vehicles'],
  chart: {
    height: 280,
    type: 'donut',
    sparkline: { enabled: false },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  dataLabels: { enabled: true, style: { colors: [DATA_LABEL_COLOR], fontSize: '13px', fontWeight: 600 } },
  legend: { position: 'bottom', fontSize: '13px', fontFamily: 'Poppins, sans-serif', fontWeight: 500 },
  stroke: { show: true, curve: 'smooth', lineCap: 'round', colors: ['#fff'], width: 2, dashArray: 0 },
  plotOptions: {
    pie: {
      expandOnClick: false,
      donut: { size: '55%', background: 'transparent' }
    }
  },
  colors: PRIMARY_GREEN_COLORS_3
};

/**
 * 4. Overall Defects by Area (Distributed Treemap Chart)
 */
export const defectsByAreaTreemap = {
  series: [
    {
      data: [
        { x: 'Chassis & Frame', y: 145 },
        { x: 'Engine & Transmission', y: 128 },
        { x: 'Brakes & Suspension', y: 112 },
        { x: 'Interior & Comfort', y: 98 },
        { x: 'Lighting & Electrical', y: 87 },
        { x: 'Body & Exterior', y: 76 }
      ]
    }
  ],
  chart: {
    height: 350,
    type: 'treemap',
    sparkline: { enabled: false },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  dataLabels: {
    enabled: true,
    formatter: function (text: string, opts: { value?: number }) {
      const defectCount = opts?.value;
      return defectCount !== undefined ? [text, defectCount.toString()] : text;
    },
    style: { fontSize: '12px', fontFamily: 'Poppins, sans-serif' }
  },
  legend: { position: 'bottom', fontSize: '13px', fontFamily: 'Poppins, sans-serif' },
  plotOptions: {
    treemap: {
      enableShades: true,
      shadeIntensity: 0.6,
      reverseScale: false,
      colorScale: { ranges: [] }
    }
  },
  colors: PRIMARY_GREEN_COLORS_6
};

/**
 * 5. Average Defects by Station (Basic Bar Chart)
 */
export const defectsByStationChart = {
  series: [
    { name: 'Avg Defects', data: [3.2, 4.1, 2.8, 3.7, 2.5, 4.3, 3.0, 2.9] }
  ],
  chart: {
    height: 300,
    type: 'bar',
    toolbar: { show: true },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  plotOptions: {
    bar: {
      horizontal: false,
      columnWidth: '45%',
      borderRadius: 4,
      dataLabels: { position: 'top' }
    }
  },
  dataLabels: {
    enabled: true,
    formatter: function (val: number) { return val.toFixed(1); },
    style: { colors: ['#ffffff'], fontSize: '11px', fontWeight: 600 }
  },
  stroke: { show: true, width: 0, colors: ['transparent'] },
  xaxis: {
    categories: ['Station A', 'Station B', 'Station C', 'Station D', 'Station E', 'Station F', 'Station G', 'Station H'],
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: { style: { fontSize: '12px', fontFamily: 'Poppins, sans-serif' } }
  },
  yaxis: { title: { text: 'Avg Defects', style: { fontSize: '13px', fontFamily: 'Poppins, sans-serif' } } },
  fill: { opacity: 1 },
  colors: SINGLE_GREEN_DARK,
  legend: { position: 'top', fontSize: '13px', fontFamily: 'Poppins, sans-serif' }
};

/**
 * 6. Repeated Defects (Semi Circular Gauge)
 */
export const repeatedDefectsGauge = {
  series: [68],
  chart: {
    height: 280,
    type: 'radialBar',
    sparkline: { enabled: false },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.3 }
  },
  plotOptions: {
    radialBar: {
      startAngle: -90,
      endAngle: 90,
      hollow: { size: '35%' },
      track: { background: '#fff', strokeWidth: '100%', margin: 2 },
      dataLabels: {
        name: { show: true, offsetY: 10, color: '#495057', fontSize: '13px', fontFamily: 'Poppins, sans-serif' },
        value: { show: true, color: '#212529', fontSize: '28px', fontWeight: 'bold', offsetY: -20, fontFamily: 'Poppins, sans-serif' }
      }
    }
  },
  fill: {
    type: 'gradient',
    gradient: {
      shade: 'light',
      type: 'horizontal',
      shadeIntensity: 0.45,
      gradientToColors: ['#1b5e20'],
      inverseColors: false,
      opacityFrom: 1,
      opacityTo: 1,
      stops: [0, 100],
    },
  },
  colors: SINGLE_GREEN_LIGHT,
  labels: ['Repeated %']
};

/**
 * 7. Safety Critical Defects (Semi Circular Gauge)
 */
export const safetyCriticalDefectsGauge = {
  series: [42],
  chart: {
    height: 280,
    type: 'radialBar',
    sparkline: { enabled: false },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.3 }
  },
  plotOptions: {
    radialBar: {
      startAngle: -90,
      endAngle: 90,
      hollow: { size: '35%' },
      track: { background: '#fff', strokeWidth: '100%', margin: 2 },
      dataLabels: {
        name: { show: true, offsetY: 10, color: '#495057', fontSize: '13px', fontFamily: 'Poppins, sans-serif' },
        value: { show: true, color: '#212529', fontSize: '28px', fontWeight: 'bold', offsetY: -20, fontFamily: 'Poppins, sans-serif' }
      }
    }
  },
  fill: {
    type: 'gradient',
    gradient: {
      shade: 'light',
      type: 'horizontal',
      shadeIntensity: 0.45,
      gradientToColors: ['#1b5e20'],
      inverseColors: false,
      opacityFrom: 1,
      opacityTo: 1,
      stops: [0, 100],
    },
  },
  colors: SINGLE_GREEN_MEDIUM,
  labels: ['Critical %']
};

/**
 * 8. Repeated Defects by Area (Distributed Treemap Chart)
 */
export const repeatedDefectsByAreaTreemap = {
  series: [
    {
      data: [
        { x: 'Brakes & Suspension', y: 92 },
        { x: 'Engine & Transmission', y: 87 },
        { x: 'Chassis & Frame', y: 76 },
        { x: 'Lighting & Electrical', y: 58 },
        { x: 'Interior & Comfort', y: 45 },
        { x: 'Body & Exterior', y: 32 }
      ]
    }
  ],
  chart: {
    height: 350,
    type: 'treemap',
    sparkline: { enabled: false },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  dataLabels: {
    enabled: true,
    formatter: function (text: string, opts: { value?: number }) {
      const defectCount = opts?.value;
      return defectCount !== undefined ? [text, defectCount.toString()] : text;
    },
    style: { fontSize: '12px', fontFamily: 'Poppins, sans-serif' }
  },
  legend: { position: 'bottom', fontSize: '13px', fontFamily: 'Poppins, sans-serif' },
  plotOptions: {
    treemap: {
      enableShades: true,
      shadeIntensity: 0.6,
      reverseScale: false
    }
  },
  colors: PRIMARY_GREEN_COLORS_6
};

/**
 * 9. Comparison of Projects by Area (Stacked Column Chart)
 */
export const projectsByAreaStackedChart = {
  series: [
    { name: 'Area A', data: [3.2, 2.8, 3.5, 4.1, 2.9] },
    { name: 'Area B', data: [2.1, 3.4, 2.7, 3.2, 3.8] },
    { name: 'Area C', data: [3.8, 2.5, 4.2, 2.9, 3.3] }
  ],
  chart: {
    height: 300,
    type: 'bar',
    stacked: true,
    toolbar: { show: true },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  responsive: [{ breakpoint: 480, options: { legend: { position: 'bottom' } } }],
  plotOptions: {
    bar: {
      horizontal: false,
      columnWidth: '50%',
      borderRadius: 4,
      dataLabels: { position: 'center' }
    }
  },
  xaxis: {
    categories: ['Project 1', 'Project 2', 'Project 3', 'Project 4', 'Project 5'],
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: { style: { fontSize: '12px', fontFamily: 'Poppins, sans-serif' } }
  },
  yaxis: { title: { text: 'Avg Defects', style: { fontSize: '13px', fontFamily: 'Poppins, sans-serif' } } },
  dataLabels: {
    enabled: true,
    formatter: function (val: number) { return val.toFixed(1); },
    offsetY: 0,
    style: { colors: ['#ffffff'], fontSize: '11px', fontWeight: 600 },
    dropShadow: { enabled: false }
  },
  fill: { opacity: 1 },
  colors: PRIMARY_GREEN_COLORS_3_ALT,
  legend: { position: 'top', fontSize: '13px', fontFamily: 'Poppins, sans-serif' }
};

/**
 * 10. Comparison of Projects by Station Type (Color Range Heatmap)
 */
export const projectsByStationHeatmap = {
  series: [
    {
      name: 'Project 1',
      data: [
        { x: 'Production', y: 18 },
        { x: 'Final', y: 6 },
        { x: 'Shipped', y: 2 },
        { x: 'Client', y: 1 },
        { x: 'Unspecified', y: 0 }
      ]
    },
    {
      name: 'Project 2',
      data: [
        { x: 'Production', y: 12 },
        { x: 'Final', y: 9 },
        { x: 'Shipped', y: 3 },
        { x: 'Client', y: 0 },
        { x: 'Unspecified', y: 1 }
      ]
    },
    {
      name: 'Project 3',
      data: [
        { x: 'Production', y: 21 },
        { x: 'Final', y: 4 },
        { x: 'Shipped', y: 5 },
        { x: 'Client', y: 2 },
        { x: 'Unspecified', y: 0 }
      ]
    }
  ],
  chart: {
    height: 350,
    type: 'heatmap',
    toolbar: { show: true },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  plotOptions: {
    heatmap: {
      shadeIntensity: 0.5,
      radius: 0,
      useFillColorAsStroke: true,
      colorScale: {
        ranges: PROJECTS_BY_STATION_HEATMAP_RANGES
      }
    }
  },
  dataLabels: { enabled: true, style: { fontSize: '11px', fontFamily: 'Poppins' } },
  legend: { show: true, position: 'bottom', fontSize: '13px', fontFamily: 'Poppins, sans-serif' }
};

/**
 * 11. Comparison of Average Station Time (Stacked Bar Chart)
 */
export const stationTimeComparisonChart = {
  series: [
    { name: 'Setup Time (min)', data: [15, 12, 18, 14, 16, 13, 17, 15] },
    { name: 'Inspection Time (min)', data: [45, 52, 48, 55, 50, 58, 46, 51] },
    { name: 'Report Time (min)', data: [10, 12, 11, 10, 12, 11, 10, 12] }
  ],
  chart: {
    height: 300,
    type: 'bar',
    stacked: true,
    toolbar: { show: true },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  responsive: [{ breakpoint: 480, options: { legend: { position: 'bottom' } } }],
  plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
  xaxis: { type: 'numeric', title: { text: 'Time (minutes)', style: { fontSize: '13px', fontFamily: 'Poppins, sans-serif' } } },
  yaxis: {
    categories: ['Project 1', 'Project 2', 'Project 3', 'Project 4', 'Project 5', 'Project 6', 'Project 7', 'Project 8'],
    title: { text: 'Projects', style: { fontSize: '13px', fontFamily: 'Poppins, sans-serif' } }
  },
  dataLabels: { enabled: false },
  fill: { opacity: 1 },
  colors: PRIMARY_GREEN_COLORS_3_ALT,
  legend: { position: 'top', fontSize: '13px', fontFamily: 'Poppins, sans-serif' }
};

/**
 * 12. Project Timeline Plot (Advanced Colored Timeline)
 */
export const projectTimelineChart = {
  series: [
    {
      data: [
        {
          x: 'Project Alpha',
          y: [new Date('2024-01-10').getTime(), new Date('2024-03-15').getTime()],
          fillColor: '#1b5e20'
        },
        {
          x: 'Project Beta',
          y: [new Date('2024-02-01').getTime(), new Date('2024-04-20').getTime()],
          fillColor: '#2e7d32'
        },
        {
          x: 'Project Gamma',
          y: [new Date('2024-01-20').getTime(), new Date('2024-05-10').getTime()],
          fillColor: '#388e3c'
        },
        {
          x: 'Project Delta',
          y: [new Date('2024-03-01').getTime(), new Date('2024-06-30').getTime()],
          fillColor: '#4caf50'
        },
        {
          x: 'Project Epsilon',
          y: [new Date('2024-02-15').getTime(), new Date('2024-05-25').getTime()],
          fillColor: '#66bb6a'
        }
      ]
    }
  ],
  chart: {
    height: 350,
    type: 'rangeBar',
    toolbar: { show: true },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  plotOptions: {
    bar: {
      horizontal: true,
      barHeight: '60%',
      rangeBarGroupRows: false
    }
  },
  xaxis: {
    type: 'datetime',
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: { style: { fontSize: '12px', fontFamily: 'Poppins, sans-serif' } }
  },
  yaxis: {
    title: { text: 'Projects', style: { fontSize: '13px', fontFamily: 'Poppins, sans-serif' } }
  },
  dataLabels: { enabled: false },
  legend: { show: false }
};

/**
 * Vehicle Station Tracking (template reused from Project Timeline)
 */
export const vehicleStationTrackingChart = {
  series: [
    {
      data: [
        { x: 'Vehicle A', y: [new Date('2024-03-01').getTime(), new Date('2024-03-03').getTime()], fillColor: '#1b5e20' },
        { x: 'Vehicle B', y: [new Date('2024-03-04').getTime(), new Date('2024-03-10').getTime()], fillColor: '#2e7d32' },
        { x: 'Vehicle C', y: [new Date('2024-03-08').getTime(), new Date('2024-03-20').getTime()], fillColor: '#388e3c' }
      ]
    }
  ],
  chart: {
    height: 350,
    type: 'rangeBar',
    toolbar: { show: true },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  plotOptions: {
    bar: {
      horizontal: true,
      barHeight: '60%',
      rangeBarGroupRows: false
    }
  },
  xaxis: {
    type: 'datetime',
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: { style: { fontSize: '12px', fontFamily: 'Poppins, sans-serif' } }
  },
  yaxis: {
    title: { text: 'Vehicles', style: { fontSize: '13px', fontFamily: 'Poppins, sans-serif' } }
  },
  dataLabels: { enabled: false },
  legend: { show: false }
};

/**
 * 13. Comparison of Project Magnitude (Bubble Chart)
 */
export const projectMagnitudeBubble = {
  series: [
    {
      name: 'Fleet Size',
      data: [
        { x: 45, y: 23, z: 85 },
        { x: 58, y: 31, z: 72 },
        { x: 38, y: 18, z: 92 },
        { x: 72, y: 42, z: 65 },
        { x: 62, y: 38, z: 78 },
        { x: 35, y: 14, z: 88 },
        { x: 68, y: 39, z: 81 },
        { x: 52, y: 27, z: 95 }
      ]
    }
  ],
  chart: {
    height: 350,
    type: 'bubble',
    toolbar: { show: true },
    dropShadow: { enabled: true, enabledOnSeries: undefined, top: 3, left: 0, blur: 3, color: '#000', opacity: 0.1 }
  },
  dataLabels: { enabled: false },
  fill: { opacity: 0.8 },
  xaxis: {
    axisBorder: { show: false },
    axisTicks: { show: false },
    title: { text: 'Defect Rate (%)', style: { fontSize: '13px', fontFamily: 'Poppins, sans-serif' } },
    labels: { style: { fontSize: '12px', fontFamily: 'Poppins, sans-serif' } }
  },
  yaxis: {
    title: { text: 'Inspection Days', style: { fontSize: '13px', fontFamily: 'Poppins, sans-serif' } },
    labels: { style: { fontSize: '12px', fontFamily: 'Poppins, sans-serif' } }
  },
  colors: SINGLE_GREEN_DARK,
  legend: { position: 'bottom', fontSize: '13px', fontFamily: 'Poppins, sans-serif' }
};

/**
 * 14. Tickets by Status (Horizontal Bar Chart)
 */
export const buildTicketsByStatusBar = (data?: TicketsByStatusData) => {
  // If the backend supplies `ticketsByStatus` use it. Prefer ordering that
  // matches the product's canonical statuses when present, otherwise fall
  // back to the API-provided ordering or demo values.
  const apiStatus = data?.ticketsByStatus ?? undefined;

  // Canonical labels (exact order required for the product)
  const canonical = [
    'Open',
    'Resolved',
    'Client Verification',
    'Approved with Defects',
    'Rejected with Defects',
    'Closed',
  ];

  // Use keyword-based matching (case-insensitive) to canonicalize API status labels.
  // This handles many variants, spacing/typo differences, and compound labels.
  const getCanonicalLabel = (rawLabel: string | null | undefined): string | null => {
    const s = String(rawLabel ?? '').trim().toLowerCase();
    if (!s) return null;

    // Normalize punctuation and collapse whitespace for simpler substring checks
    const normalized = s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

    // Priority-ordered keyword checks
    const checks: Array<{ label: string; keywords: string[] }> = [
      { label: 'Approved with Defects', keywords: ['approved with defects', 'approved w/ defects', 'approved', 'reviewdandapproved', 'reviewedandapproved', 'review and approved'] },
      { label: 'Rejected with Defects', keywords: ['rejected with defects', 'rejected w/ defects', 'rejected'] },
      { label: 'Client Verification', keywords: ['client verification', 'clientreview', 'client review', 'verification', 'client verification pending', 'client review pending'] },
      { label: 'Resolved', keywords: ['resolved'] },
      { label: 'Closed', keywords: ['closed'] },
      { label: 'Open', keywords: ['open tickets', 'open', 'in progress', 'in-progress', 'in_progress', 'escalat', 'on hold', 'on-hold', 'on_hold', 'reopened', 're-opened', 're_opened'] },
    ];

    for (const chk of checks) {
      for (const kw of chk.keywords) {
        if (normalized.includes(kw)) return chk.label;
      }
    }

    return null;
  };

  // Aggregate API values into canonical labels using keyword-based mapping when
  // an array of status items is provided. Otherwise, produce canonical labels
  // with zero counts. This ensures the widget never falls back to demo data.
  const agg = new Map<string, number>();
  if (Array.isArray(apiStatus) && apiStatus.length) {
    for (const item of apiStatus) {
      const raw = String(item?.name ?? '').trim();
      if (!raw) continue;
      const canonicalLabel = getCanonicalLabel(raw);
      if (canonicalLabel) {
        agg.set(canonicalLabel, (agg.get(canonicalLabel) ?? 0) + (Number(item?.value ?? 0) || 0));
      }
      // ignore unknown statuses for this canonical chart
    }
  }

  // Always render canonical labels in the required order; zero-fill when absent
  const categories = canonical.slice();
  const values = canonical.map((label) => agg.get(label) ?? 0);

  // Prepare percent series and keep absolute counts for tooltip when available.
  // Only treat counts as "absolute" when the API supplied an array and the
  // aggregated total is greater than zero. Otherwise render zeros for all
  // percents (avoid divide-by-zero) and do not show absolute counts in tooltips.
  const counts = values.slice();
  const totalCount = counts.reduce((s, v) => s + (Number(v) || 0), 0);
  const countsAreAbsolute = Array.isArray(apiStatus) && apiStatus.length > 0 && totalCount > 0;
  const percentValues = totalCount > 0
    ? counts.map((v) => (Number(v) || 0) / totalCount * 100)
    : categories.map(() => 0);

  // Formatter that truncates (does not round) and shows adaptive decimals.
  const formatPercent = (raw: number) => {
    const val = Number(raw) || 0;
    if (val === 0) return '0%';
    if (val >= 1) {
      // For values >= 1%, show two decimals, truncated
      const truncated = Math.floor(val * 100) / 100;
      return truncated.toFixed(2) + '%';
    }

    // For values < 1%, show up to 6 decimals, truncated, trim trailing zeros
    const multiplier = 1e6;
    const truncated = Math.floor(val * multiplier) / multiplier;
    let s = truncated.toFixed(6);
    // trim trailing zeros and possibly trailing dot
    s = s.replace(/(?:\.0+|0+)$/, (m) => m.replace(/0+$/, ''));
    s = s.replace(/\.$/, '');
    return s + '%';
  };

  return {
    chart: {
      type: 'bar',
      height: 400,
      toolbar: { show: false },
      sparkline: { enabled: false }
    },
    plotOptions: {
      bar: {
        horizontal: true,
        distributed: true,
        barHeight: '65%',
        borderRadius: 3,
        dataLabels: { position: 'right' }
      }
    },
    dataLabels: {
      enabled: true,
      formatter: function (val: number) {
        return formatPercent(val);
      },
      offsetX: 8,
      style: {
        colors: ['var(--default-text-color)'],
        fontSize: '12px',
        fontWeight: 600
      }
    },
    xaxis: {
      categories,
      labels: {
        style: {
          colors: '#6c757d',
          fontSize: '13px'
        }
      },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    series: [
      {
        name: 'Tickets (%)',
        data: percentValues
      }
    ],
    colors: TICKETS_STATUS_BAR_COLOR,
    grid: {
      borderColor: 'rgba(0,0,0,0.05)',
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: false } }
    },
    tooltip: {
      y: {
        formatter: function (val: number, opts?: any) {
          const idx = opts?.dataPointIndex ?? 0;
          const abs = counts[idx] ?? 0;
          const pct = formatPercent(val);
          if (countsAreAbsolute) {
            return `${abs} (${pct})`;
          }
          return pct;
        },
        title: { formatter: function () { return ''; } }
      }
    },
    legend: { show: false },
    states: {
      hover: { filter: { type: 'darken', value: 0.15 } },
      active: { filter: { type: 'darken', value: 0.15 } }
    }
  };
};

// Summary Statistics
export const dashboardStats = {
  totalProjects: 32,
  openProjects: 24,
  closedProjects: 8,
  totalVehicles: 450,
  vehiclesInspected: 388,
  totalDefects: 1247,
  criticalDefects: 89,
  repeatedDefects: 234,
  averageDefectsPerVehicle: 3.2,
  completionRate: '85%'
};
