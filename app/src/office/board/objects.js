// Whiteboard rich objects (docs/office-board.md ▸ Rich objects): tables, charts, coordinate systems with function
// graphs, math formulas and sub-board cards. Pure: normalizers, a safe expression compiler, a small TeX-like formula
// layout and display-list builders used by render.js. No DOM; unit-tested in tests/office/board-objects.test.js.
//
//   table   { rows: string[][], header: bool, fontSize, stroke, fill (header color) }
//   chart   { chart: engine/layout/chart-data.js definition with data }
//   plot    { xMin, xMax, yMin, yMax, grid: bool, axisLabels: { x, y }, functions: [{ expr, color, label? }],
//             points: [{ x, y, label?, color? }], segments?: [{ from: [x, y], to: [x, y], color? }] }
//             (math coordinates; y grows upward; the element box is the plot area)
//   math    { tex: string, fontSize }   \frac{a}{b}, \sqrt{x}, x^{2}, x_{i}, Greek letters and common symbols
//   portal  { target: page id, name }   a card that opens another page (a sub-board)
import { normalizeChart } from "../../engine/layout/chart-data.js";
import { renderChart } from "../../engine/layout/chart-render.js";

export const OBJECT_TYPES = ["table", "chart", "plot", "math", "portal"];
const IDENT = [1, 0, 0, 1, 0, 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const hexOr = (c, d) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : d);
const solid = (color, alpha = 1) => (color ? { type: "solid", color, alpha } : null);
const line = (color, width, dash = null) => ({ paint: solid(color), width, cap: "round", join: "round", miterLimit: 10, dash, dashOffset: 0 });
const rectD = (x, y, w, h) => [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
const path = (d, fill, stroke, m) => ({ t: "path", d, rule: "nonzero", fill, stroke, m });
const PALETTE = ["#1971c2", "#e03131", "#2f9e44", "#f08c00", "#7048e8", "#0c8599"];

// ---------------------------------------------------------------- expressions

const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10, log2: Math.log2, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, min: Math.min, max: Math.max, pow: Math.pow };
const CONST = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

/**
 * Compiles a math expression in the given variables into a function (no eval): + - * / ^, unary minus, parentheses,
 * implicit multiplication (2x, 3(x+1), x sin(x)), functions (FN) and constants (pi, e, tau). "y =" / "f(x) =" prefixes
 * are dropped. Throws a readable Error on bad input.
 */
export function compileExpr(src, vars = ["x"]) {
  const text = String(src ?? "").replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=/i, "").replace(/\*\*/g, "^").replace(/[·×]/g, "*").replace(/÷/g, "/").replace(/π/g, "pi").replace(/−/g, "-");
  if (!text.trim()) throw new Error("Empty expression.");
  if (text.length > 500) throw new Error("The expression is too long.");
  const toks = [];
  const re = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?|([a-z_][a-z0-9_]*)|(.))/giy;
  for (let m; re.lastIndex < text.length && (m = re.exec(text));) {
    if (m[1] !== undefined) toks.push({ k: "n", v: Number(m[1] + (m[2] !== undefined ? `e${m[2]}` : "")) });
    else if (m[3] !== undefined) toks.push({ k: "id", v: m[3].toLowerCase() });
    else if (m[4] !== undefined && m[4].trim()) toks.push({ k: "op", v: m[4] });
  }
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => peek()?.k === "op" && peek().v === v;
  const fail = (msg) => {
    throw new Error(`${msg} in “${src}”.`);
  };
  const startsAtom = (t) => t && (t.k === "n" || t.k === "id" || (t.k === "op" && t.v === "("));
  function expr() {
    let a = term();
    while (isOp("+") || isOp("-")) {
      const op = toks[i++].v;
      const b = term();
      const l = a;
      a = op === "+" ? (s) => l(s) + b(s) : (s) => l(s) - b(s);
    }
    return a;
  }
  function term() {
    let a = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = toks[i++].v;
        const b = unary();
        const l = a;
        a = op === "*" ? (s) => l(s) * b(s) : (s) => l(s) / b(s);
      } else if (startsAtom(peek())) {
        const b = power();
        const l = a;
        a = (s) => l(s) * b(s);
      } else return a;
    }
  }
  function unary() {
    if (isOp("-")) {
      i++;
      const a = unary();
      return (s) => -a(s);
    }
    if (isOp("+")) {
      i++;
      return unary();
    }
    return power();
  }
  function power() {
    const b = atom();
    if (isOp("^")) {
      i++;
      const e = unary();
      return (s) => b(s) ** e(s);
    }
    return b;
  }
  function atom() {
    const t = toks[i++];
    if (!t) fail("Unexpected end");
    if (t.k === "n") return () => t.v;
    if (t.k === "op" && t.v === "(") {
      const a = expr();
      if (!isOp(")")) fail("Missing “)”");
      i++;
      return a;
    }
    if (t.k === "id") {
      if (isOp("(")) {
        const f = Object.hasOwn(FN, t.v) ? FN[t.v] : null;
        if (!f) fail(`Unknown function “${t.v}”`);
        i++;
        const args = [expr()];
        while (isOp(",")) {
          i++;
          args.push(expr());
        }
        if (!isOp(")")) fail("Missing “)”");
        i++;
        return (s) => f(...args.map((g) => g(s)));
      }
      const vi = vars.indexOf(t.v);
      if (vi >= 0) return (s) => s[vi];
      if (Object.hasOwn(CONST, t.v)) return () => CONST[t.v];
      if (Object.hasOwn(FN, t.v) && startsAtom(peek())) {
        // sin x, ln x: a function applied to the next power term
        const f = FN[t.v];
        const a = power();
        return (s) => f(a(s));
      }
      fail(`Unknown name “${t.v}”`);
    }
    return fail(`Unexpected “${t.v}”`);
  }
  const f = expr();
  if (i < toks.length) fail(`Unexpected “${toks[i].v}”`);
  return (...args) => {
    const v = f(args);
    return Number.isFinite(v) ? v : NaN;
  };
}

/** Samples y = f(x) over [x0, x1]: polylines split where the function is undefined or jumps off the range. */
export function sampleFunction(fn, x0, x1, yMin, yMax, n = 400) {
  const out = [];
  let cur = [];
  const span = yMax - yMin;
  let prev = null;
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n;
    const y = fn(x);
    const ok = Number.isFinite(y) && y > yMin - span * 4 && y < yMax + span * 4;
    const jump = prev !== null && ok && Math.abs(y - prev) > span * 2;
    if (!ok || jump) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    if (ok) cur.push([x, y]);
    prev = ok ? y : null;
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Nice axis step for a range (1, 2, 5 × 10^k) giving about `count` ticks. */
export function niceStep(range, count = 8) {
  const raw = Math.abs(range) / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

// ---------------------------------------------------------------- normalizing

/** Repairs the type-specific fields of a rich object (normalizeBoard, Vibe input, collaborators). */
export function normalizeObject(el) {
  const e = { ...el };
  if (e.type === "table") {
    const rows = Array.isArray(e.rows) && e.rows.length ? e.rows : [["", ""], ["", ""]];
    const cols = clamp(Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0))), 1, 30);
    e.rows = rows.slice(0, 200).map((r) => Array.from({ length: cols }, (_, c) => String((Array.isArray(r) ? r[c] : "") ?? "").slice(0, 2000)));
    e.header = e.header !== false;
    e.fontSize = clamp(num(e.fontSize, 16), 6, 96);
    e.fill = hexOr(e.fill, "#e7f5ff");
    e.stroke = hexOr(e.stroke, "#495057");
  } else if (e.type === "chart") e.chart = normalizeChart(e.chart);
  else if (e.type === "plot") {
    let [x0, x1] = [num(e.xMin, -10), num(e.xMax, 10)];
    let [y0, y1] = [num(e.yMin, -10), num(e.yMax, 10)];
    if (!(x1 > x0)) [x0, x1] = [-10, 10];
    if (!(y1 > y0)) [y0, y1] = [-10, 10];
    Object.assign(e, { xMin: x0, xMax: x1, yMin: y0, yMax: y1, grid: e.grid !== false });
    e.functions = (Array.isArray(e.functions) ? e.functions : []).slice(0, 12).map((f, k) => ({ expr: String(f?.expr ?? f ?? "").slice(0, 500), color: hexOr(f?.color, PALETTE[k % PALETTE.length]), ...(f?.label ? { label: String(f.label).slice(0, 80) } : {}) })).filter((f) => f.expr.trim());
    e.points = (Array.isArray(e.points) ? e.points : []).slice(0, 500).filter((p) => Number.isFinite(+p?.x) && Number.isFinite(+p?.y)).map((p) => ({ x: +p.x, y: +p.y, ...(p.label ? { label: String(p.label).slice(0, 80) } : {}), color: hexOr(p.color, "#e03131") }));
    e.segments = (Array.isArray(e.segments) ? e.segments : []).slice(0, 200).filter((s) => Array.isArray(s?.from) && Array.isArray(s?.to)).map((s) => ({ from: [num(s.from[0]), num(s.from[1])], to: [num(s.to[0]), num(s.to[1])], color: hexOr(s.color, "#1e1e1e") }));
    e.axisLabels = { x: String(e.axisLabels?.x ?? "x").slice(0, 40), y: String(e.axisLabels?.y ?? "y").slice(0, 40) };
  } else if (e.type === "math") {
    e.tex = String(e.tex ?? "").slice(0, 2000);
    e.fontSize = clamp(num(e.fontSize, 28), 8, 200);
  } else if (e.type === "portal") {
    e.target = typeof e.target === "string" ? e.target.slice(0, 64) : "";
    e.name = String(e.name ?? "Sub-board").slice(0, 120);
  }
  return e;
}

// ---------------------------------------------------------------- math formulas

const SYMBOLS = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", sum: "∑", prod: "∏", int: "∫", oint: "∮", infty: "∞", partial: "∂", nabla: "∇", pm: "±", mp: "∓", times: "×", cdot: "·", div: "÷", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", propto: "∝", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftrightarrow: "⇔", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩", forall: "∀", exists: "∃", emptyset: "∅", cdots: "⋯", ldots: "…", degree: "°", circ: "∘", sin: "sin", cos: "cos", tan: "tan", log: "log", ln: "ln", lim: "lim", exp: "exp", min: "min", max: "max", quad: "  ", ",": " ", ";": " ", "!": "", "{": "{", "}": "}", "%": "%", "\\": " " };
const RELATIONS = new Set(["pm", "mp", "times", "cdot", "div", "le", "leq", "ge", "geq", "ne", "neq", "approx", "equiv", "sim", "propto", "to", "rightarrow", "leftarrow", "Rightarrow", "Leftrightarrow", "in", "notin", "subset", "subseteq", "cup", "cap"]);
const UPRIGHT = new Set(["sin", "cos", "tan", "log", "ln", "lim", "exp", "min", "max"]);

/** Parses TeX-like math into nodes: { k: "t", s, italic } | { k: "sup"|"sub", base, arg } | { k: "frac", n, d } | { k: "sqrt", arg } | { k: "row", items }. */
export function parseTex(src) {
  const s = String(src ?? "");
  let i = 0;
  function group() {
    if (s[i] === "{") {
      i++;
      const r = row("}");
      i++;
      return r;
    }
    return single();
  }
  function single() {
    if (i >= s.length) return { k: "row", items: [] };
    const c = s[i];
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
      i += m ? m[0].length : 1;
      const name = m ? m[1] : "";
      if (name === "frac" || name === "dfrac") return { k: "frac", n: group(), d: group() };
      if (name === "sqrt") return { k: "sqrt", arg: group() };
      if (name === "left" || name === "right") return single();
      if (name === "text" || name === "mathrm" || name === "operatorname") return textArg();
      const sym = Object.hasOwn(SYMBOLS, name) ? SYMBOLS[name] : name;
      return { k: "t", s: RELATIONS.has(name) ? ` ${sym} ` : sym, italic: false };
    }
    i++;
    if (/\s/.test(c)) return { k: "t", s: "", italic: false };
    if ("=<>+-".includes(c)) return { k: "t", s: ` ${c === "-" ? "−" : c} `, italic: false };
    return { k: "t", s: c, italic: /[a-zA-Z]/.test(c) };
  }
  function textArg() {
    if (s[i] !== "{") return { k: "t", s: "", italic: false };
    const end = s.indexOf("}", i);
    const out = { k: "t", s: s.slice(i + 1, end < 0 ? s.length : end), italic: false };
    i = end < 0 ? s.length : end + 1;
    return out;
  }
  function row(stop) {
    const items = [];
    while (i < s.length && s[i] !== stop) {
      if (s[i] === "^" || s[i] === "_") {
        const k = s[i] === "^" ? "sup" : "sub";
        i++;
        const base = items.pop() || { k: "t", s: "", italic: false };
        items.push({ k, base, arg: group() });
        continue;
      }
      const n = single();
      if (n.k === "t" && UPRIGHT.has(n.s)) n.italic = false;
      items.push(n);
    }
    return { k: "row", items };
  }
  return row(null);
}

/**
 * Lays out a formula: { w, ascent, descent, runs: [{ text, x, y (baseline), size, italic }], rules: [{ x, y, w }] }
 * in a box with the baseline at y = 0. `measure(text, size, italic)` → px.
 */
export function layoutTex(node, size, measure) {
  switch (node.k) {
    case "t": {
      const w = node.s ? measure(node.s, size, node.italic) : 0;
      return { w, ascent: size * 0.75, descent: size * 0.25, runs: node.s ? [{ text: node.s, x: 0, y: 0, size, italic: node.italic }] : [], rules: [] };
    }
    case "row": {
      const out = { w: 0, ascent: size * 0.75, descent: size * 0.25, runs: [], rules: [] };
      for (const it of node.items) {
        const b = layoutTex(it, size, measure);
        place(out, b, out.w, 0);
        out.w += b.w;
      }
      return out;
    }
    case "sup":
    case "sub": {
      const base = layoutTex(node.base, size, measure);
      const arg = layoutTex(node.arg, size * 0.7, measure);
      const out = { w: base.w + arg.w + size * 0.05, ascent: base.ascent, descent: base.descent, runs: [], rules: [] };
      place(out, base, 0, 0);
      const dy = node.k === "sup" ? -base.ascent * 0.55 : size * 0.25;
      place(out, arg, base.w + size * 0.05, dy);
      return out;
    }
    case "frac": {
      const n = layoutTex(node.n, size * 0.85, measure);
      const d = layoutTex(node.d, size * 0.85, measure);
      const w = Math.max(n.w, d.w) + size * 0.3;
      const axis = -size * 0.3;
      const out = { w, ascent: 0, descent: 0, runs: [], rules: [{ x: 0, y: axis, w }] };
      place(out, n, (w - n.w) / 2, axis - n.descent - size * 0.12);
      place(out, d, (w - d.w) / 2, axis + d.ascent + size * 0.12);
      return out;
    }
    case "sqrt": {
      const a = layoutTex(node.arg, size, measure);
      const sw = measure("√", size, false);
      const out = { w: sw + a.w + size * 0.1, ascent: 0, descent: 0, runs: [{ text: "√", x: 0, y: 0, size, italic: false }], rules: [{ x: sw, y: -a.ascent - size * 0.08, w: a.w + size * 0.1 }] };
      place(out, a, sw + size * 0.05, 0);
      out.ascent = Math.max(out.ascent, a.ascent + size * 0.15);
      return out;
    }
    default:
      return { w: 0, ascent: 0, descent: 0, runs: [], rules: [] };
  }
}
function place(out, b, dx, dy) {
  for (const r of b.runs) out.runs.push({ ...r, x: r.x + dx, y: r.y + dy });
  for (const r of b.rules) out.rules.push({ ...r, x: r.x + dx, y: r.y + dy });
  out.ascent = Math.max(out.ascent, b.ascent - dy);
  out.descent = Math.max(out.descent, b.descent + dy);
}

/** Natural size of a formula element (for creating it): { w, h }. */
export function mathSize(tex, fontSize, measure) {
  const l = layoutTex(parseTex(tex), fontSize, (t, s, it) => measure(t, s, it));
  return { w: Math.ceil(l.w + fontSize * 0.4), h: Math.ceil(l.ascent + l.descent + fontSize * 0.4) };
}

// ---------------------------------------------------------------- display lists (local box 0..w, 0..h; caller adds m)

const FONT = "Helvetica";
const MATH_FONT = "Times New Roman";
function textRun(text, x, y, size, { family = FONT, weight = 400, italic = false, color = "#1e1e1e" } = {}, measure) {
  return { text, x, y, width: measure(text, size, family === MATH_FONT ? "serif" : "sans"), font: { family, size, weight, style: italic ? "italic" : "normal" }, fill: solid(color), stroke: null, letterSpacing: 0, underline: false, strike: false };
}

/** Items of a rich object in its local box. `measure(text, size, font)` → px (board font ids). */
export function objectItems(el, measure, m = IDENT) {
  const { w, h } = el;
  const items = [];
  const runs = [];
  const flushText = () => runs.length && items.push({ t: "text", runs: runs.splice(0), m });
  if (el.type === "table") {
    const rows = el.rows.length, cols = el.rows[0].length;
    const cw = w / cols, rh = h / rows;
    const size = el.fontSize;
    if (el.header) items.push(path(rectD(0, 0, w, rh), solid(el.fill), null, m));
    const grid = [];
    for (let r = 0; r <= rows; r++) grid.push(["M", 0, r * rh], ["L", w, r * rh]);
    for (let c = 0; c <= cols; c++) grid.push(["M", c * cw, 0], ["L", c * cw, h]);
    items.push(path(grid, null, line(el.stroke, 1), m));
    el.rows.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell) return;
      let text = cell.split("\n")[0];
      while (text.length > 1 && measure(text, size, "sans") > cw - 12) text = `${text.slice(0, -2)}…`;
      const tw = measure(text, size, "sans");
      const numeric = /^[-+]?[\d.,]+%?$/.test(cell.trim());
      const x = numeric && !(el.header && r === 0) ? (c + 1) * cw - 6 - tw : c * cw + 6;
      runs.push(textRun(text, x, r * rh + rh / 2 + size * 0.35, size, { weight: el.header && r === 0 ? 700 : 400 }, measure));
    }));
    flushText();
  } else if (el.type === "chart") {
    const r = renderChart(el.chart, el.chart.data, w, h, { measure: (font, text) => measure(text, font.size, "sans") });
    items.push(path(rectD(0, 0, w, h), solid("#ffffff"), line("#dee2e6", 1), m));
    for (const it of r.items) items.push({ ...it, m: mul(m, it.m || IDENT) });
  } else if (el.type === "plot") plotItems(el, measure, m, items);
  else if (el.type === "math") {
    const size = el.fontSize;
    const l = layoutTex(parseTex(el.tex), size, (t, s, it) => measure(t, s, "serif"));
    const ox = (w - l.w) / 2, oy = (h - (l.ascent + l.descent)) / 2 + l.ascent;
    for (const r of l.runs) runs.push(textRun(r.text, ox + r.x, oy + r.y, r.size, { family: MATH_FONT, italic: r.italic, color: el.stroke || "#1e1e1e" }, measure));
    if (l.rules.length) items.push(path(l.rules.flatMap((r) => [["M", ox + r.x, oy + r.y], ["L", ox + r.x + r.w, oy + r.y]]), null, line(el.stroke || "#1e1e1e", Math.max(1, size / 18)), m));
    flushText();
  } else if (el.type === "portal") {
    items.push(path(rectD(4, 4, w, h), solid("#000000", 0.08), null, m));
    items.push(path(rectD(0, 0, w, h), solid(el.fill || "#f8f9fa"), line(el.stroke || "#495057", 1.5), m));
    items.push(path(rectD(0, 0, w, Math.min(h, 28)), solid(el.stroke || "#495057"), null, m));
    runs.push(textRun("▣ Sub-board", 10, 19, 13, { weight: 700, color: "#ffffff" }, measure));
    runs.push(textRun(el.name, 12, Math.min(h - 10, 28 + 30), 20, { weight: 700 }, measure));
    if (h > 80) runs.push(textRun("Double-click to open", 12, h - 12, 12, { color: "#868e96" }, measure));
    flushText();
  }
  return items;
}

const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

/** Math coordinates → local box px for a plot element. */
export function plotScale(el) {
  const sx = el.w / (el.xMax - el.xMin), sy = el.h / (el.yMax - el.yMin);
  return { X: (x) => (x - el.xMin) * sx, Y: (y) => el.h - (y - el.yMin) * sy };
}

function plotItems(el, measure, m, items) {
  const { w, h } = el;
  const { X, Y } = plotScale(el);
  const runs = [];
  items.push(path(rectD(0, 0, w, h), solid("#ffffff"), line("#ced4da", 1), m));
  const xs = niceStep(el.xMax - el.xMin, Math.max(2, Math.round(w / 70)));
  const ys = niceStep(el.yMax - el.yMin, Math.max(2, Math.round(h / 60)));
  const ticksX = [], ticksY = [];
  for (let v = Math.ceil(el.xMin / xs) * xs; v <= el.xMax + 1e-9 && ticksX.length < 100; v += xs) ticksX.push(+v.toPrecision(12));
  for (let v = Math.ceil(el.yMin / ys) * ys; v <= el.yMax + 1e-9 && ticksY.length < 100; v += ys) ticksY.push(+v.toPrecision(12));
  if (el.grid) items.push(path([...ticksX.flatMap((v) => [["M", X(v), 0], ["L", X(v), h]]), ...ticksY.flatMap((v) => [["M", 0, Y(v)], ["L", w, Y(v)]])], null, line("#e9ecef", 1), m));
  const ax = clamp(Y(0), 0, h), ay = clamp(X(0), 0, w);
  items.push(path([["M", 0, ax], ["L", w, ax], ["M", w - 8, ax - 4], ["L", w, ax], ["L", w - 8, ax + 4], ["M", ay, h], ["L", ay, 0], ["M", ay - 4, 8], ["L", ay, 0], ["L", ay + 4, 8]], null, line("#343a40", 1.5), m));
  const fmt = (v) => String(Math.abs(v) < 1e-9 ? 0 : +v.toPrecision(6));
  for (const v of ticksX) if (Math.abs(v) > 1e-9 && X(v) > 10 && X(v) < w - 14) runs.push(textRun(fmt(v), X(v) - measure(fmt(v), 11, "sans") / 2, clamp(ax + 14, 12, h - 2), 11, { color: "#495057" }, measure));
  for (const v of ticksY) if (Math.abs(v) > 1e-9 && Y(v) > 12 && Y(v) < h - 6) runs.push(textRun(fmt(v), clamp(ay - 4 - measure(fmt(v), 11, "sans"), 2, w - 30), Y(v) + 4, 11, { color: "#495057" }, measure));
  runs.push(textRun(el.axisLabels.x, w - 6 - measure(el.axisLabels.x, 13, "sans"), clamp(ax - 8, 14, h - 4), 13, { italic: true }, measure));
  runs.push(textRun(el.axisLabels.y, clamp(ay + 8, 2, w - 20), 14, 13, { italic: true }, measure));
  for (const s of el.segments) items.push(path([["M", X(s.from[0]), Y(s.from[1])], ["L", X(s.to[0]), Y(s.to[1])]], null, line(s.color, 2), m));
  el.functions.forEach((f, k) => {
    let fn;
    try {
      fn = compileExpr(f.expr);
    } catch {
      return;
    }
    const d = sampleFunction(fn, el.xMin, el.xMax, el.yMin, el.yMax, Math.min(1200, Math.max(200, Math.round(w * 1.5)))).flatMap((pl) => pl.map(([x, y], j) => [j ? "L" : "M", X(x), Y(y)]));
    if (d.length) items.push({ t: "group", items: [path(d, null, line(f.color, 2.5), m)], m: IDENT, opacity: 1, blend: "normal", clip: { d: rectD(0, 0, w, h), rule: "nonzero", m }, isolate: false });
    const label = f.label || `y = ${f.expr.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, "")}`;
    runs.push(textRun(label, 8, 18 + k * 18, 13, { color: f.color, weight: 700 }, measure));
  });
  for (const p of el.points) {
    if (p.x < el.xMin || p.x > el.xMax || p.y < el.yMin || p.y > el.yMax) continue;
    const cx = X(p.x), cy = Y(p.y), r = 4;
    const K = 0.5523 * r;
    items.push(path([["M", cx + r, cy], ["C", cx + r, cy + K, cx + K, cy + r, cx, cy + r], ["C", cx - K, cy + r, cx - r, cy + K, cx - r, cy], ["C", cx - r, cy - K, cx - K, cy - r, cx, cy - r], ["C", cx + K, cy - r, cx + r, cy - K, cx + r, cy], ["Z"]], solid(p.color), null, m));
    if (p.label) runs.push(textRun(p.label, cx + 7, cy - 7, 12, { color: p.color }, measure));
  }
  if (runs.length) items.push({ t: "text", runs, m });
}

/** A plain-text summary of a rich object for describe, find and board → document. */
export function objectText(el) {
  if (el.type === "table") return el.rows.map((r) => r.join(" | ")).join("\n");
  if (el.type === "chart") return [el.chart.title, ...el.chart.data.series.map((s) => `${s.name}: ${s.values.join(", ")}`)].filter(Boolean).join("\n");
  if (el.type === "plot") return el.functions.map((f) => `y = ${f.expr}`).concat(el.points.map((p) => `${p.label ? `${p.label} ` : ""}(${p.x}, ${p.y})`)).join("\n");
  if (el.type === "math") return el.tex;
  if (el.type === "portal") return el.name;
  return "";
}
