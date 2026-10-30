// Spreadsheet rendering helpers shared by the grid view and the exports: what a cell shows (formatted text, color,
// alignment, conditional formats), chart data from a range, and display lists of a range (PDF pages, PNG) built
// from the same rules. Pure (the measurer is a parameter); the canvas grid lives in office/sheet/view.js.
//
// Public API
//   cellLook(sheet, calc, r, c, cfStats) → { text, value, style, align, color, fill, error }
//   cfStatsFor(sheet, calc) → (rule) → { min, max }        cached per call site
//   chartModel(model, sheet, chart, calc) → normalized chart (engine/layout/chart-data.js) with its data
//   sheetPages(model, sid, calc, { measurer, range?, page?, margin?, single? }) → [{ width, height, items }]
import { parseRange } from "../toolkit/selection.js";
import { normalizeChart, matrixToData } from "../../engine/layout/chart-data.js";
import { renderChart } from "../../engine/layout/chart-render.js";
import { roundRectPath } from "../../engine/layout/chart-geometry.js";
import { rcKey, isErr, toText } from "./formula.js";
import { formatCode } from "./numfmt-code.js";
import { cfStyle, usedRange, mergeAt, sheetByName, DEFAULT_COL, DEFAULT_ROW } from "./model.js";

export const FONT = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";

export function cfStatsFor(sheet, calc) {
  const cache = new Map();
  return (rule) => {
    if (cache.has(rule.id)) return cache.get(rule.id);
    const g = parseRange(rule.range);
    let min = Infinity;
    let max = -Infinity;
    if (g) {
      const r1 = Math.min(g.r1, g.r0 + 20000);
      for (let r = g.r0; r <= r1; r++)
        for (let c = g.c0; c <= g.c1; c++) {
          const v = calc.get(sheet.id, r, c);
          if (typeof v === "number") (min = Math.min(min, v)), (max = Math.max(max, v));
        }
    }
    const st = Number.isFinite(min) ? { min, max } : null;
    cache.set(rule.id, st);
    return st;
  };
}

/** Everything the grid and the exports need to draw one cell. */
export function cellLook(sheet, calc, r, c, stats = null) {
  const cell = sheet.cells[rcKey(r, c)];
  const value = cell ? (cell.f !== undefined ? calc.get(sheet.id, r, c) : (cell.v ?? null)) : null;
  let style = cell?.s || null;
  if (sheet.cf.length) {
    const extra = cfStyle(sheet.cf, r, c, value, stats || cfStatsFor(sheet, calc));
    if (extra) style = { ...(style || {}), ...extra };
  }
  let text = "";
  let color = style?.color || null;
  const error = isErr(value);
  if (error) text = value.code;
  else if (value != null) {
    const f = formatCode(value, style?.nf || "General");
    text = f.text;
    if (f.color) color = f.color;
  }
  const align = style?.ha || (error || typeof value === "boolean" ? "center" : typeof value === "number" ? "right" : "left");
  return { cell, value, text, style, align, color, fill: style?.fill || null, error };
}

/** The chart definition with data from its range (header row = series names, first column = categories). */
export function chartModel(model, sheet, chart, calc) {
  const src = chart.sheet ? sheetByName(model, chart.sheet) || sheet : sheet;
  const g = parseRange(chart.range);
  const matrix = [];
  if (g) {
    const r1 = Math.min(g.r1, g.r0 + 500);
    const c1 = Math.min(g.c1, g.c0 + 40);
    for (let r = g.r0; r <= r1; r++) {
      const row = [];
      for (let c = g.c0; c <= c1; c++) {
        const look = cellLook(src, calc, r, c);
        row.push(typeof look.value === "number" && (r > g.r0 || c === g.c0) ? look.value : look.text);
      }
      matrix.push(row);
    }
  }
  const header = matrix.length > 1 && matrix[0].slice(1).some((v) => typeof v === "string" && v !== "");
  const labelCol = matrix.length && matrix.some((row, i) => (header ? i > 0 : true) && typeof row[0] === "string" && row[0] !== "");
  const data = matrixToData(matrix, { header, labelCol, seriesIn: chart.seriesIn === "rows" ? "rows" : "columns" });
  return normalizeChart({ type: chart.type, title: chart.title || "", data, options: { legend: "auto", fontFamily: "Inter", radius: 2 } });
}

/** Display-list items of a chart at (x, y). */
export function chartItems(model, sheet, chart, calc, measurer, x, y) {
  const ch = chartModel(model, sheet, chart, calc);
  const { items } = renderChart(ch, ch.data, chart.w, chart.h, measurer);
  const box = { t: "path", d: roundRectPath(x, y, chart.w, chart.h, 0), rule: "nonzero", fill: { type: "solid", color: "#ffffff", alpha: 1 }, stroke: { paint: { type: "solid", color: "#c8ccd2", alpha: 1 }, width: 1, cap: "butt", join: "miter", miterLimit: 4, dash: null, dashOffset: 0 }, m: [1, 0, 0, 1, 0, 0] };
  return [box, ...items.map((it) => ({ ...it, m: [it.m[0], it.m[1], it.m[2], it.m[3], it.m[4] + x, it.m[5] + y] }))];
}

const solid = (color) => ({ type: "solid", color, alpha: 1 });
const rect = (x, y, w, h, color) => ({ t: "path", d: roundRectPath(x, y, w, h, 0), rule: "nonzero", fill: solid(color), stroke: null, m: [1, 0, 0, 1, 0, 0] });

/**
 * Pages of a range as display lists (A4 portrait at 96 dpi by default). Columns that do not fit move to further
 * pages (rows first, then columns, like spreadsheet print order). `single` renders the whole range on one page (PNG).
 */
export function sheetPages(model, sid, calc, { measurer, range = null, page = { w: 794, h: 1123 }, margin = 48, single = false, gridlines = true } = {}) {
  const sheet = model.sheets.find((s) => s.id === sid);
  const used = usedRange(sheet);
  let g = range ? parseRange(range) || range : used;
  for (const ch of sheet.charts) {
    // charts extend the printed area
    if (!g) g = { r0: ch.r, c0: ch.c, r1: ch.r, c1: ch.c };
    let w = 0;
    let c = ch.c;
    while (w < ch.w && c < ch.c + 100) w += sheet.cols[c++] ?? DEFAULT_COL;
    let h = 0;
    let r = ch.r;
    while (h < ch.h && r < ch.r + 300) h += sheet.rows[r++] ?? DEFAULT_ROW;
    if (!range) g = { r0: Math.min(g.r0, ch.r), c0: Math.min(g.c0, ch.c), r1: Math.max(g.r1, r - 1), c1: Math.max(g.c1, c - 1) };
  }
  if (!g) return [{ width: page.w, height: page.h, items: [] }];
  g = { r0: 0, c0: 0, ...g, r0: range ? g.r0 : 0, c0: range ? g.c0 : 0 };
  const colW = (c) => sheet.cols[c] ?? DEFAULT_COL;
  const rowH = (r) => sheet.rows[r] ?? DEFAULT_ROW;
  const stats = cfStatsFor(sheet, calc);
  const availW = page.w - margin * 2;
  const availH = page.h - margin * 2;
  // split into column bands and row bands
  const bands = (from, to, size, avail) => {
    const out = [];
    let start = from;
    let acc = 0;
    for (let i = from; i <= to; i++) {
      const s = size(i);
      if (acc + s > avail && i > start && !single) {
        out.push([start, i - 1]);
        start = i;
        acc = 0;
      }
      acc += s;
    }
    out.push([start, to]);
    return out;
  };
  const colBands = bands(g.c0, g.c1, colW, availW);
  const rowBands = bands(g.r0, g.r1, rowH, availH);
  const pages = [];
  for (const [c0, c1] of colBands)
    for (const [r0, r1] of rowBands) {
      const items = [];
      const runs = [];
      let width = 0;
      for (let c = c0; c <= c1; c++) width += colW(c);
      let height = 0;
      for (let r = r0; r <= r1; r++) height += rowH(r);
      const ox = single ? 0 : margin;
      const oy = single ? 0 : margin;
      const xs = [ox];
      for (let c = c0; c <= c1; c++) xs.push(xs[xs.length - 1] + colW(c));
      const ys = [oy];
      for (let r = r0; r <= r1; r++) ys.push(ys[ys.length - 1] + rowH(r));
      if (single) items.push(rect(0, 0, width, height, "#ffffff"));
      if (gridlines) {
        for (const x of xs) items.push(rect(x, oy, 0.5, height, "#d9d9d9"));
        for (const y of ys) items.push(rect(ox, y, width, 0.5, "#d9d9d9"));
      }
      for (let r = r0; r <= r1; r++) {
        const h = rowH(r);
        if (!h) continue;
        for (let c = c0; c <= c1; c++) {
          let w = colW(c);
          if (!w) continue;
          let hh = h;
          const mg = sheet.merges.length ? mergeAt(sheet, r, c) : null;
          if (mg) {
            if (mg.r0 !== r || mg.c0 !== c) continue;
            w = xs[Math.min(mg.c1, c1) - c0 + 1] - xs[c - c0];
            hh = ys[Math.min(mg.r1, r1) - r0 + 1] - ys[r - r0];
          }
          const x = xs[c - c0];
          const y = ys[r - r0];
          const look = cellLook(sheet, calc, r, c, stats);
          if (look.fill) items.push(rect(x, y, w, hh, look.fill));
          const bd = look.style?.bd;
          if (bd) {
            if (bd.t) items.push(rect(x, y, w, 1, bd.t));
            if (bd.b) items.push(rect(x, y + hh - 1, w, 1, bd.b));
            if (bd.l) items.push(rect(x, y, 1, hh, bd.l));
            if (bd.r) items.push(rect(x + w - 1, y, 1, hh, bd.r));
          }
          if (!look.text) continue;
          const size = ((look.style?.size || 11) * 96) / 72;
          const font = { family: look.style?.font || "Calibri", size, weight: look.style?.b ? 700 : 400, style: look.style?.i ? "italic" : "normal" };
          let text = look.text;
          let tw = measurer.measure(font, text);
          // overflow into empty neighbors for left-aligned text, otherwise cut to the cell
          let room = w - 6;
          if (look.align === "left" && !look.style?.wrap) {
            for (let k = c + 1; k <= c1 && tw > room; k++) {
              if (sheet.cells[rcKey(r, k)]?.v !== undefined || sheet.cells[rcKey(r, k)]?.f !== undefined) break;
              room += colW(k);
            }
          }
          if (typeof look.value === "number" && !look.error && tw > room) text = "#".repeat(Math.max(1, Math.floor(room / measurer.measure(font, "#"))));
          while (text.length > 1 && measurer.measure(font, text) > room) text = text.slice(0, -1);
          tw = measurer.measure(font, text);
          const tx = look.align === "right" ? x + w - 3 - tw : look.align === "center" ? x + (w - tw) / 2 : x + 3;
          const va = look.style?.va || "bottom";
          const ty = va === "top" ? y + size + 2 : va === "middle" ? y + hh / 2 + size * 0.35 : y + hh - 5;
          runs.push({ text, x: tx, y: ty, width: tw, font, fill: solid(look.color || "#000000"), stroke: null, letterSpacing: 0, underline: !!look.style?.u, strike: !!look.style?.st });
        }
      }
      if (runs.length) items.push({ t: "text", runs, m: [1, 0, 0, 1, 0, 0] });
      for (const ch of sheet.charts) {
        if (ch.r < r0 || ch.r > r1 || ch.c < c0 || ch.c > c1) continue;
        items.push(...chartItems(model, sheet, ch, calc, measurer, xs[ch.c - c0], ys[ch.r - r0]));
      }
      pages.push(single ? { width: Math.max(1, width), height: Math.max(1, height), items } : { width: page.w, height: page.h, items });
    }
  return pages;
}

export { toText };
