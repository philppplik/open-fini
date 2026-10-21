/**
 * Chart definitions (pure): types, palettes, defaults, gallery presets with sample data, data from a linked
 * table, matrix conversion for the data grid, sorting and the accessible description.
 *
 * A chart is stored in a `chart` node as `{ type, title, subtitle, data, source, options }`:
 *
 * ```
 * data:   { categories: string[], series: [{ name, values: (number|null)[], color? }] }
 *         scatter charts use the categories as numeric X values; kpi / progress / ring / sparkline charts use the
 *         first series (last value = the number, the earlier values feed the sparkline)
 * source: null | { tableId, range?: "A1:D5", seriesIn?: "columns"|"rows", header?: true, labelCol?: true }
 *         when set, `data` is a cached copy and the table's evaluated cells are the truth
 * ```
 *
 * @module chart-data
 */

import { parseNumber, parseRange, formatValue } from './format.js';
import { tableValues } from './table-model.js';

export const CHART_TYPES = {
  column: { label: 'Column', family: 'cartesian' },
  'stacked-column': { label: 'Stacked column', family: 'cartesian' },
  'percent-column': { label: '100% column', family: 'cartesian' },
  bar: { label: 'Bar', family: 'cartesian' },
  'stacked-bar': { label: 'Stacked bar', family: 'cartesian' },
  line: { label: 'Line', family: 'cartesian' },
  area: { label: 'Area', family: 'cartesian' },
  'stacked-area': { label: 'Stacked area', family: 'cartesian' },
  scatter: { label: 'Scatter', family: 'cartesian' },
  pie: { label: 'Pie', family: 'pie' },
  donut: { label: 'Donut', family: 'pie' },
  radar: { label: 'Radar', family: 'radar' },
  kpi: { label: 'Big number', family: 'single' },
  progress: { label: 'Progress bar', family: 'single' },
  ring: { label: 'Progress ring', family: 'single' },
  sparkline: { label: 'Sparkline', family: 'single' },
};
export const CHART_TYPE_IDS = Object.keys(CHART_TYPES);

/** Named palettes (hex). `colorblind` is the Okabe-Ito set. */
export const PALETTES = {
  default: ['#4f46e5', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'],
  ocean: ['#0b3c5d', '#1d70a2', '#3a9ad9', '#6cc3e8', '#a6e1f2', '#2a9d8f', '#8ecae6', '#1b4965'],
  sunset: ['#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#577590', '#9b5de5'],
  forest: ['#1b4332', '#2d6a4f', '#40916c', '#52b788', '#74c69d', '#95d5b2', '#b7e4c7', '#6b705c'],
  mono: ['#312e81', '#4338ca', '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff', '#1e1b4b'],
  pastel: ['#a5b4fc', '#99f6e4', '#fde68a', '#fecaca', '#d8b4fe', '#bbf7d0', '#fbcfe8', '#cbd5e1'],
  vivid: ['#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#0891b2', '#ea580c', '#4d7c0f'],
  colorblind: ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00', '#f0e442', '#000000'],
};
export const PALETTE_IDS = Object.keys(PALETTES);

/** Series colors for a chart: explicit `color`, else the palette (named or an array of hex colors). */
export function seriesColor(chart, i, palette) {
  const s = chart.data?.series?.[i];
  if (s && /^#[0-9a-f]{3,8}$/i.test(s.color || '')) return s.color;
  const pal = palette || paletteOf(chart.options);
  return pal[i % pal.length];
}

export function paletteOf(options) {
  const p = options?.palette;
  if (Array.isArray(p) && p.length) return p.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)).concat(PALETTES.default).slice(0, Math.max(1, p.length));
  return PALETTES[p] || PALETTES.default;
}

/** @returns {object} complete default options */
export function defaultOptions() {
  return {
    palette: 'default',
    theme: 'light', // light | dark (sets text, grid and background defaults)
    legend: 'auto', // auto | top | bottom | left | right | none
    gridlines: true,
    xTitle: '',
    yTitle: '',
    dataLabels: false,
    numFmt: null, // format spec (see format.js) for ticks, labels and values
    smooth: false,
    markers: true,
    radius: 4, // bar corner radius in px
    gap: 0.35, // space between category groups (fraction of the band)
    overlap: 0, // overlap of bars inside a group, -0.5 .. 1
    min: null,
    max: null,
    log: false,
    sort: 'none', // none | asc | desc (by the first series, or by total when stacked)
    innerRadius: 0.62, // donut hole (fraction)
    startAngle: 0, // degrees clockwise from 12 o'clock
    varyColors: false, // one color per category for single-series bar charts
    fontScale: 1,
    fontFamily: 'Inter',
    textColor: null,
    gridColor: null,
    background: null,
    centerLabel: '', // donut / ring center text (auto: total / percent)
    target: null, // progress / ring maximum (default 100)
  };
}

/** Fills in defaults and repairs a stored / generated chart so the renderer can trust its shape. */
export function normalizeChart(chart) {
  const c = chart && typeof chart === 'object' ? chart : {};
  const type = CHART_TYPES[c.type] ? c.type : 'column';
  const options = { ...defaultOptions(), ...(c.options && typeof c.options === 'object' ? c.options : {}) };
  const data = c.data && typeof c.data === 'object' ? c.data : {};
  let categories = Array.isArray(data.categories) ? data.categories.map((x) => (x == null ? '' : String(x))) : [];
  let series = (Array.isArray(data.series) ? data.series : []).slice(0, 40).map((s, i) => ({
    name: s && s.name != null ? String(s.name) : `Series ${i + 1}`,
    values: (Array.isArray(s?.values) ? s.values : []).slice(0, 2000).map((v) => {
      const n = typeof v === 'number' ? v : parseNumber(v);
      return Number.isFinite(n) ? n : null;
    }),
    ...(s && typeof s.color === 'string' ? { color: s.color } : {}),
  }));
  const n = Math.max(categories.length, ...series.map((s) => s.values.length), 0);
  if (categories.length < n) categories = categories.concat(Array.from({ length: n - categories.length }, (_, i) => String(categories.length + i + 1)));
  for (const s of series) while (s.values.length < n) s.values.push(null);
  if (!series.length) series = [{ name: 'Series 1', values: Array(n).fill(null) }];
  const source = c.source && typeof c.source === 'object' && c.source.tableId ? { seriesIn: 'columns', header: true, labelCol: true, ...c.source } : null;
  return { type, title: c.title ? String(c.title) : '', subtitle: c.subtitle ? String(c.subtitle) : '', data: { categories, series }, source, options };
}

// ------------------------------------------------------------------------------------------------ data in / out

/** Chart data → matrix for the data grid: header row `['', 'S1', 'S2']`, then one row per category. */
export function dataToMatrix(data) {
  const head = ['', ...data.series.map((s) => s.name)];
  const rows = data.categories.map((cat, i) => [cat, ...data.series.map((s) => (s.values[i] == null ? '' : s.values[i]))]);
  return [head, ...rows];
}

/**
 * Matrix → chart data. With `header` the first row holds series names; with `labelCol` the first column holds the
 * categories. `seriesIn: 'rows'` transposes (each row is a series).
 * @param {(string|number|null)[][]} matrix
 * @param {{header?:boolean, labelCol?:boolean, seriesIn?:'columns'|'rows'}} [o]
 */
export function matrixToData(matrix, o = {}) {
  const header = o.header !== false;
  const labelCol = o.labelCol !== false;
  let m = matrix.map((r) => r.slice());
  if (o.seriesIn === 'rows') {
    const w = Math.max(0, ...m.map((r) => r.length));
    m = Array.from({ length: w }, (_, c) => m.map((r) => (r[c] == null ? '' : r[c])));
  }
  if (!m.length) return { categories: [], series: [] };
  const head = header ? m[0] : null;
  const body = header ? m.slice(1) : m;
  const width = Math.max(0, ...m.map((r) => r.length));
  const first = labelCol ? 1 : 0;
  const categories = body.map((r, i) => (labelCol ? (r[0] == null ? '' : String(r[0])) : String(i + 1)));
  const series = [];
  for (let c = first; c < width; c++) {
    series.push({
      name: head && head[c] != null && head[c] !== '' ? String(head[c]) : `Series ${series.length + 1}`,
      values: body.map((r) => {
        const v = r[c];
        const n = typeof v === 'number' ? v : parseNumber(v);
        return Number.isFinite(n) ? n : null;
      }),
    });
  }
  return { categories, series };
}

/**
 * Resolves the data of a chart: from the linked table when `source` is set (and the table exists), otherwise the
 * stored data.
 * @param {object} chart normalized chart
 * @param {(id:string)=>object|null} getTable returns a table model (the node itself) by node id
 * @returns {{data:object, linked:boolean, missing:boolean}}
 */
export function resolveData(chart, getTable) {
  const src = chart.source;
  if (!src) return { data: chart.data, linked: false, missing: false };
  const node = getTable ? getTable(src.tableId) : null;
  if (!node || !node.cells) return { data: chart.data, linked: true, missing: true };
  const values = tableValues(node);
  const rect = (src.range && parseRange(src.range)) || { r0: 0, c0: 0, r1: values.length - 1, c1: (values[0] || []).length - 1 };
  const sub = [];
  for (let r = Math.max(0, rect.r0); r <= Math.min(values.length - 1, rect.r1); r++) sub.push(values[r].slice(rect.c0, rect.c1 + 1));
  return { data: matrixToData(sub, src), linked: true, missing: false };
}

/** Returns sorted copy of the data (`asc` / `desc` by first series or, for stacked charts, the category total). */
export function sortData(data, mode, byTotal = false) {
  if (mode !== 'asc' && mode !== 'desc') return data;
  const idx = data.categories.map((_, i) => i);
  const key = (i) => (byTotal ? data.series.reduce((a, s) => a + (s.values[i] || 0), 0) : (data.series[0]?.values[i] ?? -Infinity));
  idx.sort((a, b) => (mode === 'asc' ? key(a) - key(b) : key(b) - key(a)) || a - b);
  return { categories: idx.map((i) => data.categories[i]), series: data.series.map((s) => ({ ...s, values: idx.map((i) => s.values[i]) })) };
}

/** Plain-language description for alt text (also exported as SVG `<desc>`). */
export function describeChart(chart, data) {
  const t = CHART_TYPES[chart.type]?.label || 'Chart';
  const fmt = chart.options?.numFmt;
  const cats = data.categories;
  const parts = [`${t} chart${chart.title ? ` titled “${chart.title}”` : ''}.`];
  if (CHART_TYPES[chart.type]?.family === 'single') {
    const s = data.series[0];
    const last = s && s.values.length ? s.values[s.values.length - 1] : null;
    parts.push(`${s?.name || 'Value'}: ${last == null ? 'no data' : formatValue(last, fmt)}.`);
    return parts.join(' ');
  }
  parts.push(`${cats.length} categories${cats.length ? ` (${cats.slice(0, 6).join(', ')}${cats.length > 6 ? ', …' : ''})` : ''}, ${data.series.length} series (${data.series.map((s) => s.name).join(', ')}).`);
  for (const s of data.series.slice(0, 3)) {
    let max = -Infinity;
    let at = -1;
    s.values.forEach((v, i) => {
      if (v != null && v > max) {
        max = v;
        at = i;
      }
    });
    if (at >= 0) parts.push(`${s.name} peaks at ${formatValue(max, fmt)} (${cats[at]}).`);
  }
  return parts.join(' ');
}

// ------------------------------------------------------------------------------------------------ gallery

const Q = ['Q1', 'Q2', 'Q3', 'Q4'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Gallery presets: `{id, name, type, title, data, options}`. Used by the Insert dialog and by `add_chart`. */
export const CHART_PRESETS = [
  { id: 'column', name: 'Revenue by quarter', type: 'column', title: 'Revenue by quarter', data: { categories: Q, series: [{ name: 'Revenue', values: [42, 58, 51, 74] }] }, options: { numFmt: { type: 'currency', decimals: 0, suffix: 'k' }, dataLabels: true } },
  { id: 'grouped', name: 'Grouped columns', type: 'column', title: 'Plan vs. actual', data: { categories: Q, series: [{ name: 'Plan', values: [40, 55, 60, 70] }, { name: 'Actual', values: [42, 58, 51, 74] }] }, options: {} },
  { id: 'stacked', name: 'Stacked columns', type: 'stacked-column', title: 'Sales by channel', data: { categories: Q, series: [{ name: 'Online', values: [20, 28, 26, 40] }, { name: 'Retail', values: [14, 18, 15, 20] }, { name: 'Partners', values: [8, 12, 10, 14] }] }, options: { radius: 0 } },
  { id: 'percent', name: '100% columns', type: 'percent-column', title: 'Share by region', data: { categories: Q, series: [{ name: 'EMEA', values: [30, 32, 35, 33] }, { name: 'Americas', values: [45, 41, 40, 42] }, { name: 'APAC', values: [25, 27, 25, 25] }] }, options: { radius: 0 } },
  { id: 'bars', name: 'Ranked bars', type: 'bar', title: 'Top markets', data: { categories: ['Germany', 'France', 'Spain', 'Italy', 'Poland'], series: [{ name: 'Customers', values: [820, 640, 510, 430, 290] }] }, options: { sort: 'desc', dataLabels: true, legend: 'none' } },
  { id: 'line', name: 'Trend line', type: 'line', title: 'Monthly visitors', data: { categories: MONTHS.slice(0, 8), series: [{ name: 'Visitors', values: [1200, 1340, 1280, 1590, 1720, 1680, 1950, 2210] }] }, options: { smooth: true, numFmt: { type: 'number', decimals: 0 } } },
  { id: 'multiline', name: 'Multi-line', type: 'line', title: 'Signups by plan', data: { categories: MONTHS.slice(0, 6), series: [{ name: 'Free', values: [120, 150, 170, 210, 260, 300] }, { name: 'Pro', values: [40, 52, 61, 80, 96, 120] }, { name: 'Team', values: [8, 12, 15, 22, 30, 41] }] }, options: {} },
  { id: 'stackedbar', name: 'Stacked bars', type: 'stacked-bar', title: 'Tickets by status', data: { categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], series: [{ name: 'Open', values: [12, 9, 14, 8, 6] }, { name: 'In progress', values: [6, 8, 7, 9, 5] }, { name: 'Done', values: [10, 14, 11, 16, 20] }] }, options: { radius: 0 } },
  { id: 'stackedarea', name: 'Stacked area', type: 'stacked-area', title: 'Energy mix', data: { categories: ['2019', '2020', '2021', '2022', '2023', '2024'], series: [{ name: 'Solar', values: [10, 14, 20, 28, 36, 48] }, { name: 'Wind', values: [22, 25, 28, 30, 34, 38] }, { name: 'Hydro', values: [30, 29, 31, 30, 29, 30] }] }, options: { markers: false } },
  { id: 'area', name: 'Area', type: 'area', title: 'Active users', data: { categories: MONTHS.slice(0, 8), series: [{ name: 'Users', values: [320, 410, 380, 520, 610, 590, 720, 840] }] }, options: { smooth: true, markers: false } },
  { id: 'pie', name: 'Pie', type: 'pie', title: 'Budget split', data: { categories: ['Product', 'Marketing', 'Operations', 'Other'], series: [{ name: 'Budget', values: [45, 25, 20, 10] }] }, options: { dataLabels: true, numFmt: { type: 'number', decimals: 0, suffix: '%' } } },
  { id: 'donut', name: 'Donut', type: 'donut', title: 'Traffic sources', data: { categories: ['Search', 'Social', 'Direct', 'Referral'], series: [{ name: 'Visits', values: [52, 24, 16, 8] }] }, options: { dataLabels: true, legend: 'right', centerLabel: '100%' } },
  { id: 'scatter', name: 'Scatter', type: 'scatter', title: 'Price vs. rating', data: { categories: ['5', '8', '12', '15', '19', '24', '28', '33'], series: [{ name: 'Products', values: [3.1, 3.6, 3.9, 4.0, 4.4, 4.3, 4.7, 4.6] }] }, options: { xTitle: 'Price (USD)', yTitle: 'Rating', min: 2 } },
  { id: 'radar', name: 'Radar', type: 'radar', title: 'Skills', data: { categories: ['Design', 'Code', 'Writing', 'Data', 'Strategy', 'Speaking'], series: [{ name: 'Alex', values: [8, 6, 7, 5, 6, 8] }, { name: 'Sam', values: [5, 9, 6, 8, 7, 4] }] }, options: { max: 10 } },
  { id: 'kpi', name: 'Big number', type: 'kpi', title: '', data: { categories: Q, series: [{ name: 'Monthly revenue', values: [41200, 43800, 42100, 48650] }] }, options: { numFmt: { type: 'currency', decimals: 0 } } },
  { id: 'progress', name: 'Progress bar', type: 'progress', title: 'Goal completion', data: { categories: [''], series: [{ name: 'Funded', values: [72] }] }, options: { target: 100, numFmt: { type: 'number', suffix: '%' } } },
  { id: 'ring', name: 'Progress ring', type: 'ring', title: '', data: { categories: [''], series: [{ name: 'Tasks done', values: [68] }] }, options: { target: 100 } },
  { id: 'sparkline', name: 'Sparkline', type: 'sparkline', title: '', data: { categories: MONTHS.slice(0, 10), series: [{ name: 'Trend', values: [4, 6, 5, 8, 7, 9, 12, 10, 14, 16] }] }, options: {} },
];

/** A full chart definition from a preset id or type (with sample data), overridden by `over`. */
export function chartFromPreset(idOrType, over = {}) {
  const p = CHART_PRESETS.find((x) => x.id === idOrType) || CHART_PRESETS.find((x) => x.type === idOrType) || CHART_PRESETS[0];
  const base = JSON.parse(JSON.stringify({ type: p.type, title: p.title, data: p.data, options: p.options, source: null }));
  const merged = { ...base, ...over, options: { ...base.options, ...(over.options || {}) } };
  if (over.data) merged.data = over.data;
  return normalizeChart(merged);
}
