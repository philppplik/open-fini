/**
 * Chart renderer (pure): turns a normalized chart definition plus resolved data into display-list items in a
 * `w x h` box (origin top-left). Everything is vector paths and text runs, so SVG, PDF and PNG export are exact.
 *
 * @module chart-render
 */

import { CHART_TYPES, paletteOf, sortData } from './chart-data.js';
import { formatValue, plainNumber } from './format.js';
import { niceTicks, logTicks, makeScale, stackSeries, pieAngles, arcPath, roundRectPath, circlePath, linePathData, smoothPathData, radarPoint, readableOn } from './chart-geometry.js';

const IDM = [1, 0, 0, 1, 0, 0];
const solid = (color, alpha = 1) => ({ type: 'solid', color: color.length === 4 ? `#${[...color.slice(1)].map((x) => x + x).join('')}` : color.slice(0, 7).toLowerCase(), alpha });
const strokeOf = (color, width, extra = {}) => ({ paint: solid(color), width, cap: 'butt', join: 'round', miterLimit: 4, dash: null, dashOffset: 0, ...extra });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function theme(o) {
  const dark = o.theme === 'dark';
  return {
    text: o.textColor || (dark ? '#e5e7eb' : '#374151'),
    muted: dark ? '#9ca3af' : '#6b7280',
    grid: o.gridColor || (dark ? '#374151' : '#e5e7eb'),
    axis: dark ? '#6b7280' : '#9ca3af',
    bg: o.background || null,
    surface: o.background || (dark ? '#111827' : '#ffffff'),
    card: dark ? '#1f2937' : '#f8fafc',
    pos: dark ? '#4ade80' : '#16a34a',
    neg: dark ? '#f87171' : '#dc2626',
  };
}

/** Base font size: scales with the chart box so charts stay legible at any size. */
export function baseFontSize(w, h, o = {}) {
  return clamp(Math.min(w, h * 1.4) / 34, 8, 26) * (clamp(o.fontScale || 1, 0.5, 3));
}

function stepDecimals(step) {
  if (!step || step >= 1) return 0;
  return Math.min(6, Math.ceil(-Math.log10(step) - 1e-9));
}

class Painter {
  constructor(measurer, family, color) {
    this.m = measurer;
    this.family = family;
    this.color = color;
    this.items = [];
    this.runs = [];
    this.rot = [];
  }
  width(str, size, weight = 400) {
    return this.m.measure({ family: this.family, size, weight, style: 'normal' }, str);
  }
  /** Draws text. `anchor`: start | middle | end. `y` is the baseline. `rotate` in degrees about (x, y). */
  text(str, x, y, { size, weight = 400, color = this.color, anchor = 'start', rotate = 0 } = {}) {
    if (str === '' || str == null) return 0;
    str = String(str);
    const w = this.width(str, size, weight);
    const dx = anchor === 'middle' ? -w / 2 : anchor === 'end' ? -w : 0;
    const run = { text: str, x: rotate ? dx : x + dx, y: rotate ? 0 : y, width: w, font: { family: this.family, size, weight, style: 'normal' }, fill: solid(color), stroke: null, letterSpacing: 0, underline: false, strike: false };
    if (rotate) {
      const a = (rotate * Math.PI) / 180;
      this.rot.push({ t: 'text', runs: [run], m: [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), x, y] });
    } else this.runs.push(run);
    return w;
  }
  path(d, fill, stroke = null, rule = 'nonzero') {
    if (!d.length) return;
    this.items.push({ t: 'path', d, rule, fill, stroke, m: IDM });
  }
  done() {
    const out = this.items.slice();
    if (this.runs.length) out.push({ t: 'text', runs: this.runs, m: IDM });
    out.push(...this.rot);
    return out;
  }
}

/**
 * Renders a chart.
 * @param {object} chart normalized chart (see chart-data.js)
 * @param {{categories:string[], series:{name:string, values:(number|null)[], color?:string}[]}} data resolved data
 * @param {number} W @param {number} H
 * @param {{measure:Function, metrics?:Function}} measurer
 * @returns {{items:any[], plot:{x:number,y:number,w:number,h:number}|null}}
 */
export function renderChart(chart, data0, W, H, measurer) {
  const o = chart.options;
  const th = theme(o);
  const fs = baseFontSize(W, H, o);
  const P = new Painter(measurer, o.fontFamily || 'Inter', th.text);
  const family = CHART_TYPES[chart.type].family;
  const pal = paletteOf(o);
  const colorOf = (i) => (/^#[0-9a-f]{3,8}$/i.test(data0.series[i]?.color || '') ? data0.series[i].color : pal[i % pal.length]);
  if (th.bg) P.path(roundRectPath(0, 0, W, H, 0), solid(th.bg));
  const pad = fs * 0.9;
  const area = { x: pad, y: pad, w: Math.max(10, W - pad * 2), h: Math.max(10, H - pad * 2) };

  if (family === 'single') {
    renderSingle(P, chart, data0, W, H, fs, th, colorOf);
    return { items: P.done(), plot: null };
  }

  // title and subtitle
  if (chart.title) {
    const size = fs * 1.4;
    P.text(chart.title, area.x, area.y + size * 0.9, { size, weight: 700 });
    area.y += size * 1.35;
    area.h -= size * 1.35;
  }
  if (chart.subtitle) {
    P.text(chart.subtitle, area.x, area.y + fs * 0.9, { size: fs, color: th.muted });
    area.y += fs * 1.5;
    area.h -= fs * 1.5;
  }
  if (chart.title || chart.subtitle) {
    area.y += fs * 0.4;
    area.h -= fs * 0.4;
  }

  // legend
  const pieLike = family === 'pie';
  const entries = pieLike ? data0.categories.map((c, i) => ({ label: c, color: pal[i % pal.length] })) : data0.series.map((s, i) => ({ label: s.name, color: colorOf(i) }));
  const varyColors = o.varyColors && data0.series.length === 1 && !pieLike && family === 'cartesian';
  const legendPos = o.legend === 'auto' ? (entries.length > 1 || pieLike ? 'bottom' : 'none') : o.legend;
  const legendEntries = varyColors ? data0.categories.map((c, i) => ({ label: c, color: pal[i % pal.length] })) : entries;
  if (legendPos !== 'none' && legendEntries.length) drawLegend(P, legendEntries, legendPos, area, fs, th);

  if (area.w < 20 || area.h < 20) return { items: P.done(), plot: null };
  let plot = null;
  if (family === 'pie') drawPie(P, chart, data0, area, fs, th, pal);
  else if (family === 'radar') drawRadar(P, chart, data0, area, fs, th, colorOf);
  else plot = drawCartesian(P, chart, data0, area, fs, th, colorOf, pal, varyColors);
  return { items: P.done(), plot };
}

// ------------------------------------------------------------------------------------------------ legend

function drawLegend(P, entries, pos, area, fs, th) {
  const sw = fs * 0.8;
  const gap = fs * 0.45;
  const spacing = fs * 1.3;
  const size = fs * 0.95;
  const widths = entries.map((e) => sw + gap + P.width(e.label, size));
  const swatch = (x, y, color) => P.path(roundRectPath(x, y - sw * 0.85, sw, sw, sw * 0.25), solid(color));
  if (pos === 'top' || pos === 'bottom') {
    const rows = [[]];
    let rowW = 0;
    entries.forEach((e, i) => {
      const need = widths[i] + (rows[rows.length - 1].length ? spacing : 0);
      if (rowW + need > area.w && rows[rows.length - 1].length) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push(i);
      rowW += widths[i] + (rows[rows.length - 1].length > 1 ? spacing : 0);
    });
    const rowH = fs * 1.6;
    const total = rows.length * rowH;
    let y = pos === 'top' ? area.y + fs * 1.1 : area.y + area.h - total + fs * 1.1;
    for (const row of rows) {
      const w = row.reduce((a, i) => a + widths[i], 0) + spacing * (row.length - 1);
      let x = area.x + (area.w - w) / 2;
      for (const i of row) {
        swatch(x, y, entries[i].color);
        P.text(entries[i].label, x + sw + gap, y, { size, color: th.text });
        x += widths[i] + spacing;
      }
      y += rowH;
    }
    if (pos === 'top') area.y += total + fs * 0.3;
    area.h -= total + fs * 0.3;
    return;
  }
  const colW = Math.min(Math.max(...widths), area.w * 0.4);
  const rowH = fs * 1.55;
  const total = entries.length * rowH;
  const x0 = pos === 'left' ? area.x : area.x + area.w - colW;
  let y = area.y + (area.h - total) / 2 + fs * 1.1;
  for (const e of entries) {
    swatch(x0, y, e.color);
    P.text(e.label, x0 + sw + gap, y, { size, color: th.text });
    y += rowH;
  }
  if (pos === 'left') area.x += colW + fs * 1.2;
  area.w -= colW + fs * 1.2;
}

// ------------------------------------------------------------------------------------------------ cartesian

function drawCartesian(P, chart, data0, area, fs, th, colorOf, pal, varyColors) {
  const o = chart.options;
  const type = chart.type;
  const horizontal = type === 'bar' || type === 'stacked-bar';
  const stacked = type === 'stacked-column' || type === 'stacked-bar' || type === 'stacked-area' || type === 'percent-column';
  const percent = type === 'percent-column';
  const isArea = type === 'area' || type === 'stacked-area';
  const isLine = type === 'line';
  const isScatter = type === 'scatter';
  const isBar = !isArea && !isLine && !isScatter;
  const data = isScatter ? data0 : sortData(data0, o.sort, stacked);
  const cats = data.categories;
  const nc = cats.length;
  const ns = data.series.length;
  const vals = data.series.map((s) => s.values);
  const st = stacked ? stackSeries(vals, { percent }) : null;
  const size = fs * 0.9;

  // value domain
  let lo = Infinity;
  let hi = -Infinity;
  if (st) {
    for (const s of st) for (const p of s) if (p) (lo = Math.min(lo, p.y0, p.y1)), (hi = Math.max(hi, p.y0, p.y1));
  } else for (const s of vals) for (const v of s) if (v != null) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  if (!Number.isFinite(lo)) (lo = 0), (hi = 1);
  const log = !!o.log && !percent && lo > 0;
  if (!log && (isBar || isArea)) (lo = Math.min(lo, 0)), (hi = Math.max(hi, 0));
  const vAxisLen = horizontal ? area.w : area.h;
  const want = clamp(Math.round(vAxisLen / (fs * (horizontal ? 5.5 : 3.4))), 3, 9);
  const vt = percent ? niceTicks(0, 100, 5, { fixedMin: 0, fixedMax: 100 }) : log ? logTicks(Math.min(lo, ...[o.min].filter(Number.isFinite)), Math.max(hi, ...[o.max].filter(Number.isFinite))) : niceTicks(lo, hi, want, { fixedMin: o.min, fixedMax: o.max });
  const tickFmt = percent ? { type: 'number', decimals: 0, suffix: '%' } : o.numFmt && o.numFmt.type !== 'auto' ? o.numFmt : Math.max(Math.abs(vt.max), Math.abs(vt.min)) >= 10000 ? { type: 'compact', decimals: 1 } : { type: 'number', decimals: stepDecimals(vt.step) };
  const vLabels = vt.ticks.map((v) => formatValue(v, tickFmt));
  const vLabelW = Math.max(...vLabels.map((s) => P.width(s, size)));

  // scatter x domain
  let xs = null;
  let xt = null;
  if (isScatter) {
    xs = cats.map((c, i) => {
      const n = parseFloat(String(c).replace(/,/g, ''));
      return Number.isFinite(n) ? n : i + 1;
    });
    xt = niceTicks(Math.min(...xs), Math.max(...xs), clamp(Math.round(area.w / (fs * 5)), 3, 9));
  }
  const xLabels = xt ? xt.ticks.map((v) => formatValue(v, { type: 'number', decimals: stepDecimals(xt.step) })) : null;

  // margins
  let left = fs * 0.2;
  let bottom = fs * 0.2;
  const top = fs * 0.9;
  const right = fs * 0.6;
  if (o.yTitle) (horizontal ? (bottom += 0) : (left += fs * 1.7));
  if (o.xTitle) bottom += fs * 1.7;
  if (o.yTitle && horizontal) left += fs * 1.7;
  let catLabelH = 0;
  let catRotate = 0;
  let catSkip = 1;
  const catW = nc ? Math.max(...cats.map((c) => P.width(c, size))) : 0;
  if (horizontal) {
    const maxCat = Math.min(catW, area.w * 0.35);
    left += maxCat + fs * 0.8;
    bottom += fs * 1.7;
  } else {
    left += vLabelW + fs * 0.8;
    if (isScatter) bottom += fs * 1.7;
    else {
      const plotW0 = area.w - left - right;
      const band = nc ? plotW0 / nc : plotW0;
      if (catW <= band * 0.92) catLabelH = fs * 1.7;
      else if (band >= fs * 1.1) {
        catRotate = -40;
        catLabelH = Math.min(catW, area.h * 0.3) * Math.sin(0.7) + fs * 1.1;
      } else {
        catSkip = Math.ceil(catW / Math.max(1, band));
        catLabelH = fs * 1.7;
      }
      bottom += catLabelH;
    }
  }
  const plot = { x: area.x + left, y: area.y + top, w: area.w - left - right, h: area.h - top - bottom };
  if (plot.w < 20 || plot.h < 20) return null;

  // scales
  const sv = horizontal ? makeScale(vt.min, vt.max, plot.x, plot.x + plot.w, log) : makeScale(vt.min, vt.max, plot.y + plot.h, plot.y, log);
  const base = sv(log ? vt.min : clamp(0, vt.min, vt.max));
  const gridStroke = strokeOf(th.grid, 1);
  // grid + value labels
  if (o.gridlines) {
    const d = [];
    for (const v of vt.ticks) {
      const p = Math.round(sv(v)) + 0.5;
      d.push(horizontal ? ['M', p, plot.y] : ['M', plot.x, p], horizontal ? ['L', p, plot.y + plot.h] : ['L', plot.x + plot.w, p]);
    }
    P.path(d, null, gridStroke);
  }
  vt.ticks.forEach((v, i) => {
    const p = sv(v);
    if (horizontal) P.text(vLabels[i], p, plot.y + plot.h + fs * 1.3, { size, color: th.muted, anchor: 'middle' });
    else P.text(vLabels[i], plot.x - fs * 0.5, p + size * 0.35, { size, color: th.muted, anchor: 'end' });
  });
  if (isScatter && o.gridlines) {
    const d = [];
    const sx = makeScale(xt.min, xt.max, plot.x, plot.x + plot.w);
    for (const v of xt.ticks) d.push(['M', Math.round(sx(v)) + 0.5, plot.y], ['L', Math.round(sx(v)) + 0.5, plot.y + plot.h]);
    P.path(d, null, gridStroke);
  }
  // axis titles
  if (o.xTitle) P.text(o.xTitle, plot.x + plot.w / 2, area.y + area.h - fs * 0.3, { size, weight: 600, color: th.muted, anchor: 'middle' });
  if (o.yTitle) P.text(o.yTitle, area.x + fs * 0.9, plot.y + plot.h / 2, { size, weight: 600, color: th.muted, anchor: 'middle', rotate: -90 });

  const fmtLabel = (v) => formatValue(v, o.numFmt && o.numFmt.type !== 'auto' ? o.numFmt : percent ? { type: 'number', decimals: 0, suffix: '%' } : { type: 'number', decimals: Math.abs(v) < 100 && !Number.isInteger(v) ? 1 : 0 });

  const labels = [];
  // ---- bars
  if (isBar) {
    const band = (horizontal ? plot.h : plot.w) / Math.max(1, nc);
    const groupW = band * (1 - clamp(o.gap, 0, 0.9));
    const n = stacked ? 1 : ns;
    const ov = clamp(o.overlap, -0.5, 1);
    const barW = n === 1 ? groupW : groupW / (n - (n - 1) * ov);
    const step = barW * (1 - ov);
    const rad = clamp(o.radius, 0, barW / 2);
    const byColor = new Map();
    for (let c = 0; c < nc; c++) {
      const bandStart = (horizontal ? plot.y : plot.x) + c * band + (band - groupW) / 2;
      for (let s = 0; s < ns; s++) {
        let a;
        let b;
        let v = vals[s][c];
        if (stacked) {
          const p = st[s][c];
          if (!p || p.y0 === p.y1) continue;
          a = sv(p.y0);
          b = sv(p.y1);
          v = p.v;
        } else {
          if (v == null) continue;
          a = base;
          b = sv(v);
        }
        const off = stacked ? 0 : s * step;
        const lowEnd = Math.min(a, b);
        const len = Math.abs(b - a);
        const pos = stacked ? st[s][c].y1 >= st[s][c].y0 : v >= 0;
        const isOuter = !stacked || !st.some((q, k) => k > s && q[c] && q[c].y0 !== q[c].y1 && (q[c].y1 >= q[c].y0) === pos);
        const r = isOuter ? Math.min(rad, len / 2) : 0;
        let d;
        if (horizontal) {
          const x0 = lowEnd;
          const y0 = bandStart + off;
          d = roundRectPath(x0, y0, len, barW, pos ? [0, r, r, 0] : [r, 0, 0, r]);
        } else {
          d = roundRectPath(bandStart + off, lowEnd, barW, len, pos ? [r, r, 0, 0] : [0, 0, r, r]);
        }
        const color = varyColors ? pal[c % pal.length] : colorOf(s);
        if (!byColor.has(color)) byColor.set(color, []);
        byColor.get(color).push(...d);
        if (o.dataLabels && v != null) {
          const text = fmtLabel(v);
          const tw = P.width(text, size);
          if (stacked) {
            if (len > size * 1.4 && tw < (horizontal ? len : barW) * 0.95) labels.push({ text, x: horizontal ? lowEnd + len / 2 : bandStart + barW / 2, y: horizontal ? bandStart + barW / 2 + size * 0.35 : lowEnd + len / 2 + size * 0.35, anchor: 'middle', color: readableOn(color) });
          } else if (horizontal) labels.push({ text, x: pos ? lowEnd + len + fs * 0.4 : lowEnd - fs * 0.4, y: bandStart + off + barW / 2 + size * 0.35, anchor: pos ? 'start' : 'end', color: th.text });
          else if (tw <= Math.max(barW * 1.6, band * 0.9)) labels.push({ text, x: bandStart + off + barW / 2, y: pos ? lowEnd - fs * 0.4 : lowEnd + len + size * 1.0, anchor: 'middle', color: th.text });
        }
      }
    }
    for (const [color, d] of byColor) P.path(d, solid(color));
  }

  // ---- category axis
  const catAt = (i) => {
    if (isArea && nc > 1) return (horizontal ? plot.y : plot.x) + (i / (nc - 1)) * plot.w;
    const band = (horizontal ? plot.h : plot.w) / Math.max(1, nc);
    return (horizontal ? plot.y : plot.x) + band * (i + 0.5);
  };
  if (!isScatter) {
    cats.forEach((c, i) => {
      if (i % catSkip) return;
      const p = catAt(i);
      if (horizontal) P.text(truncate(P, c, size, plot.x - area.x - fs * 1.2 - (o.yTitle ? fs * 1.7 : 0)), plot.x - fs * 0.5, p + size * 0.35, { size, color: th.muted, anchor: 'end' });
      else if (catRotate) P.text(c, p + fs * 0.3, plot.y + plot.h + fs * 1.1, { size, color: th.muted, anchor: 'end', rotate: catRotate });
      else P.text(c, p, plot.y + plot.h + fs * 1.4, { size, color: th.muted, anchor: 'middle' });
    });
  } else {
    xt.ticks.forEach((v, i) => P.text(xLabels[i], makeScale(xt.min, xt.max, plot.x, plot.x + plot.w)(v), plot.y + plot.h + fs * 1.4, { size, color: th.muted, anchor: 'middle' }));
  }
  // axis baseline (zero line / category axis)
  P.path(horizontal ? [['M', Math.round(base) + 0.5, plot.y], ['L', Math.round(base) + 0.5, plot.y + plot.h]] : [['M', plot.x, Math.round(base) + 0.5], ['L', plot.x + plot.w, Math.round(base) + 0.5]], null, strokeOf(th.axis, 1));

  // ---- lines / areas
  if (isLine || isArea) {
    const lw = Math.max(2, fs * 0.22);
    const pts = [];
    for (let s = 0; s < ns; s++) {
      const line = [];
      for (let c = 0; c < nc; c++) {
        const v = stacked ? (st[s][c] ? st[s][c].y1 : null) : vals[s][c];
        line.push(v == null ? null : [catAt(c), sv(v)]);
      }
      pts.push(line);
    }
    for (let s = 0; s < ns; s++) {
      const color = colorOf(s);
      const line = pts[s];
      const d = o.smooth ? smoothPathData(line) : linePathData(line);
      if (isArea) {
        const solidLine = line.filter(Boolean);
        if (solidLine.length > 1) {
          let poly = d.slice();
          if (stacked) {
            const back = [];
            for (let c = nc - 1; c >= 0; c--) back.push([catAt(c), sv(st[s][c] ? st[s][c].y0 : 0)]);
            poly = poly.concat(back.map((p) => ['L', p[0], p[1]]));
          } else poly = poly.concat([['L', solidLine[solidLine.length - 1][0], base], ['L', solidLine[0][0], base]]);
          poly.push(['Z']);
          P.path(poly, solid(color, stacked ? 0.85 : 0.22));
        }
      }
      P.path(d, null, strokeOf(color, lw, { cap: 'round' }));
    }
    if (isLine && o.markers) {
      for (let s = 0; s < ns; s++) {
        const dd = [];
        for (const p of pts[s]) if (p) dd.push(...circlePath(p[0], p[1], Math.max(3, fs * 0.33)));
        P.path(dd, solid(colorOf(s)), strokeOf(th.surface, 1.5));
      }
    }
    if (o.dataLabels) {
      for (let s = 0; s < ns; s++) {
        for (let c = 0; c < nc; c++) {
          const p = pts[s][c];
          const v = vals[s][c];
          if (!p || v == null) continue;
          labels.push({ text: fmtLabel(v), x: p[0], y: p[1] - fs * 0.7, anchor: 'middle', color: th.text });
        }
      }
    }
  }

  // ---- scatter
  if (isScatter) {
    const sx = makeScale(xt.min, xt.max, plot.x, plot.x + plot.w);
    for (let s = 0; s < ns; s++) {
      const dd = [];
      for (let c = 0; c < nc; c++) {
        const v = vals[s][c];
        if (v == null) continue;
        dd.push(...circlePath(sx(xs[c]), sv(v), Math.max(3.5, fs * 0.42)));
        if (o.dataLabels) labels.push({ text: fmtLabel(v), x: sx(xs[c]), y: sv(v) - fs * 0.8, anchor: 'middle', color: th.text });
      }
      P.path(dd, solid(colorOf(s), 0.85), strokeOf(th.surface, 1));
    }
  }
  for (const l of labels) P.text(l.text, l.x, l.y, { size, weight: 600, color: l.color, anchor: l.anchor });
  return plot;
}

function truncate(P, text, size, maxW) {
  if (P.width(text, size) <= maxW || maxW < size * 2) return text;
  let s = text;
  while (s.length > 1 && P.width(`${s}…`, size) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

// ------------------------------------------------------------------------------------------------ pie / donut

function drawPie(P, chart, data, area, fs, th, pal) {
  const o = chart.options;
  const donut = chart.type === 'donut';
  const values = data.series[0]?.values || [];
  const slices = pieAngles(values, { start: -Math.PI / 2 + ((o.startAngle || 0) * Math.PI) / 180 });
  const size = fs * 0.95;
  const R = Math.max(10, Math.min(area.w, area.h) / 2 - (o.dataLabels ? 2 : 0));
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const inner = donut ? R * clamp(o.innerRadius, 0.2, 0.9) : 0;
  const sep = strokeOf(th.surface, Math.max(1.5, fs * 0.15));
  for (const s of slices) P.path(arcPath(cx, cy, inner, R, s.a0, s.a1), solid(pal[s.index % pal.length]), sep);
  if (o.dataLabels) {
    for (const s of slices) {
      if (s.frac < 0.05) continue;
      const a = (s.a0 + s.a1) / 2;
      const r = inner ? (inner + R) / 2 : R * 0.65;
      const text = o.numFmt && o.numFmt.type !== 'auto' ? formatValue(s.value, o.numFmt) : `${(s.frac * 100).toFixed(s.frac < 0.1 ? 1 : 0)}%`;
      P.text(text, cx + Math.cos(a) * r, cy + Math.sin(a) * r + size * 0.35, { size, weight: 700, color: readableOn(pal[s.index % pal.length]), anchor: 'middle' });
    }
  }
  if (donut && o.centerLabel) {
    const total = slices.reduce((a, s) => a + s.value, 0);
    const text = o.centerLabel === 'auto' ? formatValue(total, o.numFmt) : o.centerLabel;
    let fz = inner * 0.5;
    while (fz > 8 && P.width(text, fz, 700) > inner * 1.6) fz -= 1;
    P.text(text, cx, cy + fz * 0.35, { size: fz, weight: 700, anchor: 'middle' });
  }
}

// ------------------------------------------------------------------------------------------------ radar

function drawRadar(P, chart, data, area, fs, th, colorOf) {
  const o = chart.options;
  const n = Math.max(3, data.categories.length);
  const size = fs * 0.9;
  const labelW = Math.max(0, ...data.categories.map((c) => P.width(c, size)));
  const R = Math.max(10, Math.min(area.w / 2 - labelW - fs * 0.8, area.h / 2 - fs * 1.8));
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  let hi = 0;
  for (const s of data.series) for (const v of s.values) if (v != null) hi = Math.max(hi, v);
  const t = niceTicks(0, hi || 1, 4, { fixedMin: 0, fixedMax: Number.isFinite(o.max) ? o.max : null });
  for (const v of t.ticks.slice(1)) {
    const d = [];
    for (let i = 0; i < n; i++) {
      const p = radarPoint(cx, cy, R, i, n, v / t.max);
      d.push([i ? 'L' : 'M', p[0], p[1]]);
    }
    d.push(['Z']);
    P.path(d, null, strokeOf(th.grid, 1));
    const p0 = radarPoint(cx, cy, R, 0, n, v / t.max);
    P.text(formatValue(v, o.numFmt && o.numFmt.type !== 'auto' ? o.numFmt : { type: 'number', decimals: stepDecimalsOf(t.step) }), p0[0] + 3, p0[1] - 2, { size: size * 0.85, color: th.muted });
  }
  const spokes = [];
  for (let i = 0; i < n; i++) {
    const p = radarPoint(cx, cy, R, i, n, 1);
    spokes.push(['M', cx, cy], ['L', p[0], p[1]]);
    const q = radarPoint(cx, cy, R + fs * 0.7, i, n, 1);
    const cosA = Math.cos(-Math.PI / 2 + (i / n) * Math.PI * 2);
    P.text(data.categories[i] ?? '', q[0], q[1] + size * 0.35, { size, color: th.text, anchor: Math.abs(cosA) < 0.25 ? 'middle' : cosA > 0 ? 'start' : 'end' });
  }
  P.path(spokes, null, strokeOf(th.grid, 1));
  data.series.forEach((s, si) => {
    const d = [];
    const pts = [];
    for (let i = 0; i < n; i++) {
      const v = clamp(s.values[i] ?? 0, 0, t.max);
      const p = radarPoint(cx, cy, R, i, n, v / t.max);
      pts.push(p);
      d.push([i ? 'L' : 'M', p[0], p[1]]);
    }
    d.push(['Z']);
    const color = colorOf(si);
    P.path(d, solid(color, 0.18), strokeOf(color, Math.max(2, fs * 0.2)));
    if (o.markers) {
      const dd = [];
      for (const p of pts) dd.push(...circlePath(p[0], p[1], Math.max(3, fs * 0.3)));
      P.path(dd, solid(color), strokeOf(th.surface, 1.5));
    }
  });
}
const stepDecimalsOf = stepDecimals;

// ------------------------------------------------------------------------------------------------ single value variants

function renderSingle(P, chart, data, W, H, fs, th, colorOf) {
  const o = chart.options;
  const s = data.series[0] || { name: '', values: [] };
  const values = s.values.filter((v) => v != null);
  const last = values.length ? values[values.length - 1] : null;
  const prev = values.length > 1 ? values[values.length - 2] : null;
  const color = colorOf(0);
  const fmt = (v) => (v == null ? '–' : formatValue(v, o.numFmt && o.numFmt.type !== 'auto' ? o.numFmt : { type: 'number', decimals: Number.isInteger(v) ? 0 : 1 }));
  const target = Number.isFinite(o.target) && o.target > 0 ? o.target : 100;
  const pad = fs * 0.9;

  if (chart.type === 'sparkline') {
    const pts = [];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const sx = (i) => pad * 0.4 + (i / Math.max(1, s.values.length - 1)) * (W - pad * 0.8);
    const sy = makeScale(lo === hi ? lo - 1 : lo, lo === hi ? hi + 1 : hi, H - pad * 0.5, pad * 0.5);
    s.values.forEach((v, i) => pts.push(v == null ? null : [sx(i), sy(v)]));
    const d = o.smooth ? smoothPathData(pts) : linePathData(pts);
    const f = pts.filter(Boolean);
    if (f.length > 1) P.path(d.concat([['L', f[f.length - 1][0], H], ['L', f[0][0], H], ['Z']]), solid(color, 0.15));
    P.path(d, null, strokeOf(color, Math.max(1.5, fs * 0.18), { cap: 'round' }));
    const lp = f[f.length - 1];
    if (lp) P.path(circlePath(lp[0], lp[1], Math.max(2.5, fs * 0.28)), solid(color));
    return;
  }

  if (chart.type === 'kpi') {
    P.path(roundRectPath(0, 0, W, H, fs * 0.9), solid(o.background || th.card), strokeOf(th.grid, 1));
    const label = chart.title || s.name;
    P.text(label, pad, pad + fs * 0.9, { size: fs, weight: 600, color: th.muted });
    const text = fmt(last);
    let fz = Math.min(H * 0.38, fs * 4.2);
    while (fz > 10 && P.width(text, fz, 700) > W - pad * 2) fz -= 1;
    const spark = values.length > 2 && H > W * 0.3;
    const baseY = pad + fs * 1.4 + fz * (spark ? 0.95 : 1.15);
    P.text(text, pad, baseY, { size: fz, weight: 700, color: th.text });
    if (prev != null && prev !== 0 && last != null) {
      const pct = ((last - prev) / Math.abs(prev)) * 100;
      const up = pct >= 0;
      const dt = `${up ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
      const w = P.text(dt, pad, baseY + fs * 1.5, { size: fs, weight: 700, color: up ? th.pos : th.neg });
      P.text('vs. previous', pad + w + fs * 0.5, baseY + fs * 1.5, { size: fs * 0.9, color: th.muted });
    }
    if (spark) {
      const y0 = Math.max(baseY + fs * 2.4, H * 0.62);
      const hh = H - pad - y0;
      if (hh > fs * 1.5) {
        const lo = Math.min(...values);
        const hi = Math.max(...values);
        const sy = makeScale(lo === hi ? lo - 1 : lo, lo === hi ? hi + 1 : hi, y0 + hh, y0);
        const pts = s.values.map((v, i) => (v == null ? null : [pad + (i / Math.max(1, s.values.length - 1)) * (W - pad * 2), sy(v)]));
        P.path(o.smooth ? smoothPathData(pts) : linePathData(pts), null, strokeOf(color, Math.max(2, fs * 0.2), { cap: 'round' }));
      }
    }
    return;
  }

  const frac = last == null ? 0 : clamp(last / target, 0, 1);
  if (chart.type === 'progress') {
    const label = chart.title || s.name;
    const bh = Math.max(8, fs * 0.95);
    const total = fs * 1.6 + bh;
    const y0 = (H - total) / 2 + fs * 1.1;
    P.text(label, pad * 0.6, y0, { size: fs, weight: 600, color: th.text });
    P.text(fmt(last), W - pad * 0.6, y0, { size: fs, weight: 700, color: th.text, anchor: 'end' });
    const by = y0 + fs * 0.6;
    const bw = W - pad * 1.2;
    P.path(roundRectPath(pad * 0.6, by, bw, bh, bh / 2), solid(th.grid));
    if (frac > 0) P.path(roundRectPath(pad * 0.6, by, Math.max(bh, bw * frac), bh, bh / 2), solid(color));
    return;
  }
  // ring
  const d = Math.min(W, H) - pad * 1.2;
  const cx = W / 2;
  const cy = H / 2;
  const R = d / 2;
  const th2 = Math.max(6, d * 0.14);
  P.path(arcPath(cx, cy, R - th2, R, -Math.PI / 2, Math.PI * 1.5), solid(th.grid));
  if (frac > 0.002) P.path(arcPath(cx, cy, R - th2, R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2 * 0.99999), solid(color));
  const text = o.centerLabel || (o.numFmt && o.numFmt.type !== 'auto' ? fmt(last) : `${Math.round(frac * 100)}%`);
  let fz = d * 0.24;
  while (fz > 8 && P.width(text, fz, 700) > (R - th2) * 1.6) fz -= 1;
  P.text(text, cx, cy + fz * 0.15, { size: fz, weight: 700, color: th.text, anchor: 'middle' });
  const label = chart.title || s.name;
  if (label) P.text(label, cx, cy + fz * 0.15 + fs * 1.4, { size: fs * 0.9, color: th.muted, anchor: 'middle' });
}

export { plainNumber };
