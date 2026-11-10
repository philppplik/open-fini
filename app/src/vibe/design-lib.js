// Pure logic behind the "Design checks and assets" tools (tools/design-assist.js): a design linter with machine-
// applicable fixes, color palettes, type scales, column grids and procedural SVG assets. No DOM, no document access:
// everything works on plain facts (tools/power.js pageFacts) and returns plain data or SVG text.
//
// Public API
//   lintFacts(facts, page, opts) → { issues, counts }        issues: { rule, severity, ids, message, fix? }
//   LINT_RULES                                               rule id → one-line description
//   hexToHsl / hslToHex / mixHex / colorDistance
//   harmony(base, scheme) → hex[]                            colorScale(base) → { 50: hex … 900: hex }
//   bestTextColor(bg) / fixContrast(fg, bg, target) → hex
//   paletteFromFacts(facts, { max }) → [{ color, uses, area }]
//   typeScale({ base, ratio, up, down }) → [{ step, name, size, lineHeight }]
//   columnGrid({ width, margin, columns, gutter }) → { columnWidth, columns: [{ x, w }] }
//   generateSvg(kind, opts) → { svg, width, height }         ASSET_KINDS
//   code128(text) → number[] (module widths)                 rng(seed)        clipToBox(polygon, w, h)
import { contrastRatio } from "./script-lib.js";

const r1 = (n) => Math.round(n * 10) / 10;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ------------------------------------------------------------------ color

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ""));
  if (!m) return null;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}
const toHex = (rgb) => `#${rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}`;

export function hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }) {
  const S = clamp(s, 0, 100) / 100;
  const L = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = L - c / 2;
  return toHex([r, g, b].map((v) => (v + m) * 255));
}

/** Linear mix of two colors in sRGB; t = 0 gives a, 1 gives b. */
export function mixHex(a, b, t) {
  const p = hexToRgb(a);
  const q = hexToRgb(b);
  return toHex(p.map((v, i) => v + (q[i] - v) * t));
}

/** Euclidean distance in sRGB (0 to about 441). */
export function colorDistance(a, b) {
  const p = hexToRgb(a);
  const q = hexToRgb(b);
  return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) : Infinity;
}

const SCHEMES = { complementary: [0, 180], analogous: [-30, 0, 30], triadic: [0, 120, 240], tetradic: [0, 90, 180, 270], "split-complementary": [0, 150, 210], monochrome: null };
export const HARMONY_SCHEMES = Object.keys(SCHEMES);

/** Colors that go with `base`: hue rotations, or five lightness steps for monochrome. */
export function harmony(base, scheme = "analogous") {
  const hsl = hexToHsl(base);
  if (!hsl) throw new Error(`“${base}” is not a #rrggbb color.`);
  if (!(scheme in SCHEMES)) throw new Error(`Unknown scheme “${scheme}”. Use: ${HARMONY_SCHEMES.join(", ")}.`);
  if (scheme === "monochrome") return [20, 35, 50, 65, 80].map((l) => hslToHex({ ...hsl, l }));
  return SCHEMES[scheme].map((d) => hslToHex({ ...hsl, h: hsl.h + d }));
}

/** A 50-900 tint and shade scale around `base` (500 is the base itself). */
export function colorScale(base) {
  if (!hexToRgb(base)) throw new Error(`“${base}” is not a #rrggbb color.`);
  const b = `#${/^#?([0-9a-f]{6})/i.exec(base)[1].toLowerCase()}`;
  const tint = { 50: 0.92, 100: 0.84, 200: 0.68, 300: 0.48, 400: 0.24 };
  const shade = { 600: 0.16, 700: 0.34, 800: 0.52, 900: 0.68 };
  const out = {};
  for (const [k, t] of Object.entries(tint)) out[k] = mixHex(b, "#ffffff", t);
  out[500] = b;
  for (const [k, t] of Object.entries(shade)) out[k] = mixHex(b, "#000000", t);
  return out;
}

/** Black or white, whichever reads better on `bg`. */
export function bestTextColor(bg) {
  return (contrastRatio("#111111", bg) || 0) >= (contrastRatio("#ffffff", bg) || 0) ? "#111111" : "#ffffff";
}

/** Moves the lightness of `fg` away from `bg` until the contrast reaches `target`; falls back to black or white. */
export function fixContrast(fg, bg, target = 4.5) {
  const f = hexToHsl(fg);
  const b = hexToHsl(bg);
  if (!f || !b) return bestTextColor(bg);
  const dir = b.l > 50 ? -1 : 1;
  for (let l = f.l; l >= 0 && l <= 100; l += dir * 2) {
    const c = hslToHex({ ...f, l });
    if (contrastRatio(c, bg) >= target) return c;
  }
  return bestTextColor(bg);
}

/** Solid colors used on a page, most used first (by layer count, then covered area). */
export function paletteFromFacts(facts, { max = 12 } = {}) {
  const m = new Map();
  const add = (c, area) => {
    if (!/^#[0-9a-f]{6}/i.test(c || "")) return;
    const k = c.slice(0, 7).toLowerCase();
    const e = m.get(k) || { color: k, uses: 0, area: 0 };
    e.uses++;
    e.area += area;
    m.set(k, e);
  };
  for (const f of facts) {
    if (f.visible === false) continue;
    const area = (f.w || 0) * (f.h || 0);
    add(f.fill, area);
    if (f.stroke) add(String(f.stroke).split("/")[0], 0);
    if (f.color) add(f.color, area / 4);
  }
  return [...m.values()].sort((a, b) => b.uses - a.uses || b.area - a.area).slice(0, max).map((e) => ({ ...e, area: Math.round(e.area) }));
}

// ------------------------------------------------------------------ type scale and grid

const RATIOS = { "minor-second": 1.067, "major-second": 1.125, "minor-third": 1.2, "major-third": 1.25, "perfect-fourth": 1.333, "augmented-fourth": 1.414, "perfect-fifth": 1.5, golden: 1.618 };
export const SCALE_RATIOS = RATIOS;
const STEP_NAMES = ["body", "h6", "h5", "h4", "h3", "h2", "h1", "display"];

/** A modular type scale. Sizes are rounded to 0.5 px; line height tightens as the size grows. */
export function typeScale({ base = 16, ratio = "major-third", up = 6, down = 2 } = {}) {
  const k = typeof ratio === "number" ? ratio : RATIOS[ratio];
  if (!(k > 1 && k < 3)) throw new Error(`Unknown ratio “${ratio}”. Use a number between 1 and 3 or: ${Object.keys(RATIOS).join(", ")}.`);
  const out = [];
  for (let s = -down; s <= up; s++) {
    const size = Math.round(base * k ** s * 2) / 2;
    const lineHeight = Math.round(clamp(1.6 - (size - base) / 120, 1.05, 1.7) * 100) / 100;
    out.push({ step: s, name: s < 0 ? (s === -1 ? "small" : "caption") : STEP_NAMES[s] || `display-${s - 6}`, size, lineHeight });
  }
  return out;
}

/** Column positions for a page width. */
export function columnGrid({ width, margin = 64, columns = 12, gutter = 24 } = {}) {
  if (!(width > 0)) throw new Error("Give the page width.");
  const inner = width - 2 * margin;
  const cw = (inner - gutter * (columns - 1)) / columns;
  if (!(cw > 0)) throw new Error("The margins and gutters leave no room for the columns.");
  return { columnWidth: r1(cw), contentWidth: r1(inner), columns: Array.from({ length: columns }, (_, i) => ({ index: i + 1, x: r1(margin + i * (cw + gutter)), w: r1(cw) })), span: "A span of n columns is n * columnWidth + (n - 1) * gutter wide." };
}

// ------------------------------------------------------------------ lint

export const LINT_RULES = {
  contrast: "Text with too little contrast against what lies behind it (WCAG 4.5:1, large text 3:1)",
  "tiny-text": "Text smaller than the minimum size",
  "empty-text": "Text layers without text",
  "off-page": "Top-level layers completely outside the page",
  "off-grid": "Positions that are not on the grid (only when a grid is given)",
  "near-align": "Edges that miss each other by a pixel or two",
  "uneven-spacing": "Rows or columns of layers with almost, but not exactly, equal gaps",
  "text-overlap": "Text layers that overlap each other",
  "missing-alt": "Images without a text alternative",
  "near-colors": "Colors that differ so little that one was probably meant",
  "many-fonts": "More font families or sizes than a consistent design uses",
};

function backdropOf(flat, i, pageBg) {
  const me = flat[i];
  const cx = me.x + me.w / 2;
  const cy = me.y + me.h / 2;
  for (let j = i + 1; j < flat.length; j++) {
    const f = flat[j];
    if (f.visible !== false && f.type !== "text" && f.type !== "group" && /^#/.test(f.fill || "") && f.w != null && cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h) return { color: f.fill.slice(0, 7), id: f.id };
  }
  return { color: pageBg || "#ffffff", id: null };
}

/**
 * Checks one page. `facts` is the flat list of pageFacts (top-most first) with, for text layers, `color`, and for
 * images `alt`. Every issue names its layers; `fix` is a tool call that resolves it.
 * @param {object[]} facts
 * @param {{w:number, h:number, bg?:string}} page
 * @param {{minFont?:number, grid?:number, tolerance?:number, rules?:string[], maxIssues?:number}} [o]
 */
export function lintFacts(facts, page, { minFont = 11, grid = 0, tolerance = 3, rules, maxIssues = 80 } = {}) {
  const on = (r) => !rules?.length || rules.includes(r);
  const issues = [];
  const add = (rule, severity, ids, message, fix) => issues.push({ rule, severity, ids, message, ...(fix ? { fix } : {}) });
  const vis = facts.filter((f) => f.visible !== false);
  const boxed = vis.filter((f) => f.w != null);
  const texts = boxed.filter((f) => f.type === "text");

  if (on("contrast")) {
    for (const t of texts) {
      if (!t.text || !/^#/.test(t.color || "")) continue;
      const bg = backdropOf(facts, facts.indexOf(t), page.bg);
      const ratio = contrastRatio(t.color, bg.color);
      const need = (t.fontSize || 12) >= 24 ? 3 : 4.5;
      if (ratio != null && ratio < need) add("contrast", "error", [t.id], `“${t.text.slice(0, 30)}” has contrast ${ratio}:1 on ${bg.color} (needs ${need}:1).`, { tool: "set_style", args: { ids: [t.id], fill: fixContrast(t.color, bg.color, need) } });
    }
  }
  if (on("tiny-text")) for (const t of texts) if (t.text && t.fontSize && t.fontSize < minFont) add("tiny-text", "warning", [t.id], `“${t.text.slice(0, 30)}” is ${t.fontSize} px (minimum ${minFont}).`, { tool: "set_style", args: { ids: [t.id], fontSize: minFont } });
  if (on("empty-text")) for (const t of vis.filter((f) => f.type === "text" && !String(f.text || "").trim())) add("empty-text", "info", [t.id], "Empty text layer.", { tool: "delete_layers", args: { ids: [t.id] } });
  if (on("off-page")) for (const f of boxed.filter((x) => x.depth === 0)) if (f.x + f.w <= 0 || f.y + f.h <= 0 || f.x >= page.w || f.y >= page.h) add("off-page", "warning", [f.id], `“${f.name}” lies completely outside the page.`);
  if (on("off-grid") && grid > 0) {
    const off = boxed.filter((f) => f.depth === 0 && !f.locked && (Math.abs(f.x / grid - Math.round(f.x / grid)) > 0.01 || Math.abs(f.y / grid - Math.round(f.y / grid)) > 0.01));
    if (off.length) add("off-grid", "info", off.map((f) => f.id), `${off.length} layer(s) are not on the ${grid} px grid.`, { tool: "snap_layers", args: { ids: off.map((f) => f.id), grid } });
  }
  if (on("missing-alt")) for (const f of vis.filter((x) => (x.type === "image" || x.type === "pixel") && !x.alt)) add("missing-alt", "warning", [f.id], `Image “${f.name}” has no text alternative (set_style alt).`);
  if (on("text-overlap")) {
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i];
        const b = texts[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 2 && oy > 2 && a.text && b.text) add("text-overlap", "warning", [a.id, b.id], `Text “${a.text.slice(0, 20)}” overlaps “${b.text.slice(0, 20)}” by ${r1(ox)} x ${r1(oy)} px.`);
      }
    }
  }

  // siblings only: layers of one parent are laid out together
  const byParent = new Map();
  for (const f of boxed) if (!f.locked) byParent.set(f.parentId, [...(byParent.get(f.parentId) || []), f]);
  if (on("near-align")) {
    for (const sibs of byParent.values()) {
      if (sibs.length < 2 || sibs.length > 200) continue;
      for (const [edge, axis, at] of [["left", "x", (f) => f.x], ["top", "y", (f) => f.y]]) {
        const sorted = [...sibs].sort((a, b) => at(a) - at(b));
        let group = [sorted[0]];
        const flush = () => {
          const vals = group.map(at);
          if (group.length > 1 && Math.max(...vals) - Math.min(...vals) > 0.05) {
            // the value most layers share wins; ties go to the smallest
            const freq = new Map();
            for (const v of vals) freq.set(v, (freq.get(v) || 0) + 1);
            const target = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
            const movers = group.filter((f) => at(f) !== target);
            for (const f of movers) add("near-align", "info", [f.id], `“${f.name}” ${edge} edge is at ${at(f)}, ${r1(Math.abs(at(f) - target))} px off ${target} where ${group.length - movers.length} neighbor(s) sit.`, { tool: "transform_layers", args: { ids: [f.id], [axis]: target } });
          }
        };
        for (let i = 1; i < sorted.length; i++) {
          if (at(sorted[i]) - at(group[group.length - 1]) <= tolerance) group.push(sorted[i]);
          else {
            flush();
            group = [sorted[i]];
          }
        }
        flush();
      }
    }
  }
  if (on("uneven-spacing")) {
    for (const sibs of byParent.values()) {
      for (const [axis, pos, size, cross, csize] of [["x", "x", "w", "y", "h"], ["y", "y", "h", "x", "w"]]) {
        // rows (or columns): same cross position and size within the tolerance
        const rows = new Map();
        for (const f of sibs) {
          const key = `${Math.round(f[cross] / (tolerance + 1))}:${Math.round(f[csize] / (tolerance + 1))}`;
          rows.set(key, [...(rows.get(key) || []), f]);
        }
        for (const row of rows.values()) {
          if (row.length < 3) continue;
          const s = [...row].sort((a, b) => a[pos] - b[pos]);
          const gaps = [];
          for (let i = 1; i < s.length; i++) gaps.push(r1(s[i][pos] - s[i - 1][pos] - s[i - 1][size]));
          const spread = Math.max(...gaps) - Math.min(...gaps);
          if (gaps.every((g) => g >= 0) && spread > 0.05 && spread <= tolerance * 2) add("uneven-spacing", "info", s.map((f) => f.id), `${s.length} layers in a ${axis === "x" ? "row" : "column"} have gaps ${gaps.join(", ")} px.`, { tool: "distribute_layers", args: { ids: s.map((f) => f.id), axis } });
        }
      }
    }
  }
  if (on("near-colors")) {
    const pal = paletteFromFacts(vis, { max: 40 });
    const seen = new Set();
    for (let i = 0; i < pal.length; i++) {
      for (let j = i + 1; j < pal.length; j++) {
        const d = colorDistance(pal[i].color, pal[j].color);
        if (d > 0 && d < 10 && !seen.has(pal[j].color)) {
          seen.add(pal[j].color);
          add("near-colors", "info", [], `${pal[j].color} (${pal[j].uses} use(s)) is almost ${pal[i].color} (${pal[i].uses} use(s)).`, { tool: "find_replace", args: { kind: "color", find: pal[j].color, replace: pal[i].color, scope: "page" } });
        }
      }
    }
  }
  if (on("many-fonts")) {
    const fams = [...new Set(texts.map((t) => t.fontFamily).filter(Boolean))];
    const sizes = [...new Set(texts.map((t) => t.fontSize).filter(Boolean))].sort((a, b) => a - b);
    if (fams.length > 3) add("many-fonts", "info", [], `${fams.length} font families: ${fams.join(", ")}. Two or three are usual.`);
    if (sizes.length > 7) add("many-fonts", "info", [], `${sizes.length} font sizes: ${sizes.join(", ")}. Use a type scale (type_scale).`);
  }
  const counts = {};
  for (const i of issues) counts[i.rule] = (counts[i.rule] || 0) + 1;
  const order = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { issues: issues.slice(0, maxIssues), counts, total: issues.length, fixable: issues.filter((i) => i.fix).length };
}

// ------------------------------------------------------------------ procedural SVG assets

/** Deterministic random numbers in [0, 1) from a seed (mulberry32). */
export function rng(seed = 1) {
  let a = (Number(seed) | 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// bar and space widths of the 106 Code 128 symbols (values 0-105), six modules each
export const C128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232").split(" ");
/** Module widths (bar, space, bar, …) of a Code 128 symbol in code set B, checksum and stop included. */
export function code128(text) {
  const s = String(text);
  if (!s.length || s.length > 80) throw new Error("Code 128 takes 1 to 80 characters.");
  const codes = [104];
  for (const ch of s) {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`Code 128 (set B) cannot encode “${ch}”. Use printable ASCII.`);
    codes.push(v);
  }
  codes.push(codes.reduce((sum, v, i) => sum + v * Math.max(1, i), 0) % 103);
  const widths = [];
  for (const c of codes) widths.push(...C128[c].split("").map(Number));
  widths.push(2, 3, 3, 1, 1, 1, 2); // stop
  return widths;
}

export const ASSET_KINDS = ["dots", "grid", "stripes", "checker", "waves", "triangles", "crosses", "confetti", "blob", "wave-divider", "sunburst", "rings", "placeholder", "qr", "barcode"];

const f1 = (n) => String(Math.round(n * 10) / 10);
const circle = (x, y, r) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0z`;
/** Clips a polygon [[x, y], …] to the box 0,0,w,h (Sutherland-Hodgman); imported paths are not clipped by the viewBox. */
export function clipToBox(poly, w, h) {
  const edges = [[(p) => p[0] >= 0, (a, b) => [0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])]], [(p) => p[0] <= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]], [(p) => p[1] >= 0, (a, b) => [a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]), 0]], [(p) => p[1] <= h, (a, b) => [a[0] + ((b[0] - a[0]) * (h - a[1])) / (b[1] - a[1]), h]]];
  let out = poly;
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      const b = src[(i + 1) % src.length];
      if (inside(a)) {
        out.push(a);
        if (!inside(b)) out.push(cut(a, b));
      } else if (inside(b)) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}
const polyPath = (pts) => (pts.length > 2 ? `M${pts.map((q) => `${f1(q[0])} ${f1(q[1])}`).join("L")}z` : "");

/**
 * Builds one asset as plain SVG (paths only, no filters or patterns, so it imports as editable vectors).
 * @param {string} kind one of ASSET_KINDS
 * @param {{width?:number, height?:number, color?:string, background?:string, cell?:number, size?:number, angle?:number, seed?:number, count?:number, text?:string, colors?:string[], qrPath?:{d:string,size:number}}} [o]
 */
export function generateSvg(kind, o = {}) {
  const w = clamp(o.width || 400, 8, 8000);
  const h = clamp(o.height || (kind === "wave-divider" ? 120 : kind === "barcode" ? 120 : w), 8, 8000);
  const color = o.color || "#111827";
  const cell = clamp(o.cell || 24, 2, 2000);
  const rand = rng(o.seed ?? 1);
  const colors = o.colors?.length ? o.colors : [color];
  const parts = [];
  // whole cells only, centered: nothing may reach outside the box
  const cols = Math.max(1, Math.floor(w / cell));
  const rows = Math.max(1, Math.floor(h / cell));
  const ox = (w - cols * cell) / 2;
  const oy = (h - rows * cell) / 2;
  const guard = (n) => {
    if (n > 20000) throw new Error("That would create more than 20 000 shapes. Use a larger cell or a smaller area.");
  };
  const path = (d, fill = color, extra = "") => parts.push(`<path d="${d}" fill="${fill}"${extra}/>`);
  const stroke = (d, sw, c = color) => parts.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="${f1(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  const size = o.size ?? cell / 6;

  if (kind === "dots") {
    guard(cols * rows);
    let d = "";
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) d += circle(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell, Math.min(size, cell / 2));
    path(d);
  } else if (kind === "grid") {
    let d = "";
    for (let x = 0; x <= cols; x++) d += `M${f1(ox + x * cell)} ${f1(oy)}V${f1(h - oy)}`;
    for (let y = 0; y <= rows; y++) d += `M${f1(ox)} ${f1(oy + y * cell)}H${f1(w - ox)}`;
    stroke(d, o.size ?? 1);
  } else if (kind === "stripes") {
    // parallel bands at an angle, drawn long enough to cover the box and clipped by the viewBox
    const a = ((o.angle ?? 45) * Math.PI) / 180;
    const len = Math.hypot(w, h);
    const n = Math.ceil((2 * len) / cell);
    guard(n);
    let d = "";
    const bw = o.size ?? cell / 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    for (let i = -n; i <= n; i++) {
      const cx = w / 2 - uy * i * cell;
      const cy = h / 2 + ux * i * cell;
      d += polyPath(clipToBox([[-len, -bw / 2], [len, -bw / 2], [len, bw / 2], [-len, bw / 2]].map(([x, y]) => [cx + x * ux - y * uy, cy + x * uy + y * ux]), w, h));
    }
    path(d);
  } else if (kind === "checker") {
    guard(cols * rows);
    let d = "";
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if ((x + y) % 2 === 0) d += `M${f1(ox + x * cell)} ${f1(oy + y * cell)}h${cell}v${cell}h${-cell}z`;
    path(d);
  } else if (kind === "waves") {
    guard(rows * cols);
    let d = "";
    const amp = Math.min(o.size ?? cell / 4, cell / 2);
    for (let y = 0; y < rows; y++) {
      d += `M${f1(ox)} ${f1(oy + (y + 0.5) * cell)}`;
      for (let x = 0; x < cols; x++) d += `q${f1(cell / 4)} ${f1(-amp)} ${f1(cell / 2)} 0t${f1(cell / 2)} 0`;
    }
    stroke(d, Math.max(1, cell / 12));
  } else if (kind === "triangles") {
    guard(cols * rows);
    const byColor = new Map();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = colors[Math.floor(rand() * colors.length)];
        const up = rand() < 0.5;
        const d = up ? `M${f1(ox + x * cell)} ${f1(oy + (y + 1) * cell)}l${cell / 2} ${-cell}l${cell / 2} ${cell}z` : `M${f1(ox + x * cell)} ${f1(oy + y * cell)}l${cell / 2} ${cell}l${cell / 2} ${-cell}z`;
        if (rand() < (o.density ?? 0.7)) byColor.set(c, (byColor.get(c) || "") + d);
      }
    }
    for (const [c, d] of byColor) path(d, c);
  } else if (kind === "crosses") {
    guard(cols * rows);
    let d = "";
    const s = Math.min(o.size ?? cell / 5, cell / 2);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) d += `M${f1(ox + (x + 0.5) * cell - s)} ${f1(oy + (y + 0.5) * cell)}h${f1(2 * s)}M${f1(ox + (x + 0.5) * cell)} ${f1(oy + (y + 0.5) * cell - s)}v${f1(2 * s)}`;
    stroke(d, Math.max(1, s / 3));
  } else if (kind === "confetti") {
    const n = clamp(o.count || 120, 1, 4000);
    const byColor = new Map();
    for (let i = 0; i < n; i++) {
      const c = colors[Math.floor(rand() * colors.length)];
      const s = Math.min((o.size ?? 6) * (0.5 + rand()), w / 2, h / 2);
      const x = s + rand() * (w - 2 * s);
      const y = s + rand() * (h - 2 * s);
      const a = rand() * Math.PI;
      const dx = Math.cos(a) * s;
      const dy = Math.sin(a) * s;
      const d = rand() < 0.5 ? circle(x, y, s / 2) : `M${f1(x - dx)} ${f1(y - dy)}L${f1(x - dy / 3)} ${f1(y + dx / 3)}L${f1(x + dx)} ${f1(y + dy)}L${f1(x + dy / 3)} ${f1(y - dx / 3)}z`;
      byColor.set(c, (byColor.get(c) || "") + d);
    }
    for (const [c, d] of byColor) path(d, c);
  } else if (kind === "blob") {
    // points on a wobbly circle, joined by a closed Catmull-Rom spline (as cubic Béziers)
    const n = clamp(o.count || 8, 3, 40);
    const wob = clamp(o.size ?? 0.35, 0, 0.9);
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r = 1 - wob * rand();
      return [w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2];
    });
    let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
    }
    path(`${d}z`);
  } else if (kind === "wave-divider") {
    const n = clamp(o.count || 3, 1, 40);
    const seg = w / n;
    const amp = clamp(o.size ?? h / 3, 1, h / 2) / 1.4; // humps vary by up to 1.4x and must stay inside
    let d = `M0 ${f1(h / 2)}`;
    for (let i = 0; i < n; i++) d += `q${f1(seg / 4)} ${f1((i % 2 ? 1 : -1) * amp * (0.6 + rand() * 0.8))} ${f1(seg / 2)} 0t${f1(seg / 2)} 0`;
    path(`${d}V${f1(h)}H0z`);
  } else if (kind === "sunburst") {
    const n = clamp(o.count || 16, 2, 360);
    const R = Math.hypot(w, h);
    let d = "";
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 0.5) / n) * Math.PI * 2;
      d += polyPath(clipToBox([[w / 2, h / 2], [w / 2 + Math.cos(a0) * R, h / 2 + Math.sin(a0) * R], [w / 2 + Math.cos(a1) * R, h / 2 + Math.sin(a1) * R]], w, h));
    }
    path(d);
  } else if (kind === "rings") {
    const n = clamp(o.count || 6, 1, 200);
    const R = Math.min(w, h) / 2;
    let d = "";
    for (let i = 1; i <= n; i++) d += circle(w / 2, h / 2, (R * i) / n - (o.size ?? 2) / 2);
    stroke(d, o.size ?? 2);
  } else if (kind === "placeholder") {
    parts.push(`<rect x="0" y="0" width="${f1(w)}" height="${f1(h)}" fill="${o.background || "#e5e7eb"}"/>`);
    stroke(`M0 0L${f1(w)} ${f1(h)}M${f1(w)} 0L0 ${f1(h)}`, 1, "#9ca3af");
    // the label is returned, not drawn: the caller adds it as a real text layer (SVG text depends on font loading)
    const label = String(o.text || `${Math.round(w)} × ${Math.round(h)}`);
    const fontSize = Math.round(clamp(Math.min((w / Math.max(4, label.length)) * 1.4, h / 4), 8, 96));
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${f1(w)}" height="${f1(h)}" viewBox="0 0 ${f1(w)} ${f1(h)}">${parts.join("")}</svg>`, width: w, height: h, label, fontSize };
  } else if (kind === "qr") {
    if (!o.qrPath) throw new Error("Give the text for the QR code.");
    const q = 4; // quiet zone in modules
    const n = o.qrPath.size + 2 * q;
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${f1(w)}" height="${f1(w)}" viewBox="0 0 ${n} ${n}"><rect width="${n}" height="${n}" fill="${o.background || "#ffffff"}"/><path transform="translate(${q} ${q})" d="${o.qrPath.d}" fill="${color}"/></svg>`, width: w, height: w, modules: o.qrPath.size };
  } else if (kind === "barcode") {
    const widths = code128(o.text ?? "");
    const total = widths.reduce((s, v) => s + v, 0) + 20; // 10 modules of quiet zone on each side
    // bars in real px (module width = width / modules), so the importer needs no aspect-ratio handling
    const mw = w / total;
    const f3 = (n) => String(Math.round(n * 1000) / 1000);
    let x = 10;
    let d = "";
    widths.forEach((wd, i) => {
      if (i % 2 === 0) d += `M${f3(x * mw)} 0h${f3(wd * mw)}v${f1(h)}h${f3(-wd * mw)}z`;
      x += wd;
    });
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${f1(w)}" height="${f1(h)}" viewBox="0 0 ${f1(w)} ${f1(h)}"><rect width="${f1(w)}" height="${f1(h)}" fill="${o.background || "#ffffff"}"/><path d="${d}" fill="${color}"/></svg>`, width: w, height: h, modules: total };
  } else throw new Error(`Unknown kind “${kind}”. Use: ${ASSET_KINDS.join(", ")}.`);

  const bg = o.background ? `<rect x="0" y="0" width="${f1(w)}" height="${f1(h)}" fill="${o.background}"/>` : "";
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${f1(w)}" height="${f1(h)}" viewBox="0 0 ${f1(w)} ${f1(h)}">${bg}${parts.join("")}</svg>`, width: w, height: h };
}
