// Whiteboard rich objects (docs/office-board.md ▸ Rich objects): tables, charts, coordinate systems with function
// graphs, math formulas and sub-board cards. Pure: normalizers, a safe expression compiler, a small TeX-like formula
// layout and display-list builders used by render.js. No DOM; unit-tested in tests/office/board-objects.test.js.
//
//   table   { rows: string[][], header: bool, fontSize, stroke, fill (header color), merges?: ["A1:B1"],
//             styles?: { "B2": { bold?, fill? } } }
//   chart   { chart: engine/layout/chart-data.js definition with data }
//   plot    { xMin, xMax, yMin, yMax, grid: bool, axisLabels: { x, y }, functions: [{ expr, color, label? }],
//             points: [{ x, y, label?, color? }], segments?: [{ from: [x, y], to: [x, y], color? }] }
//             (math coordinates; y grows upward; the element box is the plot area). An expr is a graph y = f(x),
//             a parametric curve "(cos(t), sin(t)) t = 0..2pi" or an implicit curve "x^2 + y^2 = 4" (parseCurve).
//   math    { tex: string, fontSize }   \frac{a}{b}, \sqrt{x}, x^{2}, x_{i}, Greek letters, common symbols,
//             \left( … \right) and \begin{matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases|aligned}
//   portal  { target: page id, name }   a card that opens another page (a sub-board); render.js adds a preview
import { normalizeChart } from "../../engine/layout/chart-data.js";
import { renderChart } from "../../engine/layout/chart-render.js";
import { t } from "../../i18n/index.js";

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

/** Splits `s` at `sep` characters outside parentheses. */
function splitTop(s, sep) {
  const out = [];
  let depth = 0, from = 0;
  for (let k = 0; k < s.length; k++) {
    if (s[k] === "(") depth++;
    else if (s[k] === ")") depth--;
    else if (depth === 0 && s[k] === sep && s[k + 1] !== "=" && s[k - 1] !== "=") {
      out.push(s.slice(from, k));
      from = k + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

const EXPLICIT = /^\s*(?:y|f\s*\(\s*x\s*\))\s*=(?!=)/i;
const HAS_Y = /(^|[^a-z0-9_])y(?![a-z0-9_])/i;

/**
 * Classifies and compiles a plot expression:
 *   "x^2 - 1", "y = sin(x)"                  → { kind: "y", fn(x) }
 *   "(cos(t), sin(t))", "(t, t^2) t = -2..2" → { kind: "param", fx(t), fy(t), t0, t1 }   (t from 0 to 2π by default)
 *   "x^2 + y^2 = 4", "x = 3", "x*y - 1"      → { kind: "implicit", F(x, y) }             (the curve F = 0)
 * Throws a readable Error on bad input.
 */
export function parseCurve(src) {
  const text = String(src ?? "").trim();
  if (text.startsWith("(")) {
    let depth = 0, close = -1;
    for (let k = 0; k < text.length; k++) {
      if (text[k] === "(") depth++;
      else if (text[k] === ")" && --depth === 0) {
        close = k;
        break;
      }
    }
    const parts = close > 0 ? splitTop(text.slice(1, close), ",") : [];
    const rest = close > 0 ? text.slice(close + 1) : "";
    const range = /^\s*[,;]?\s*(?:for\s+)?t\s*=\s*(.+?)\s*\.\.\s*(.+?)\s*$/i.exec(rest);
    if (parts.length === 2 && (!rest.trim() || range)) {
      const t0 = range ? compileExpr(range[1], [])() : 0;
      const t1 = range ? compileExpr(range[2], [])() : 2 * Math.PI;
      if (!(Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0)) throw new Error(`The t range needs a larger end than start in “${src}”.`);
      return { kind: "param", fx: compileExpr(parts[0], ["t"]), fy: compileExpr(parts[1], ["t"]), t0, t1 };
    }
  }
  const rest = text.replace(EXPLICIT, "");
  if (rest.includes("=") || HAS_Y.test(rest)) {
    const sides = splitTop(text, "=");
    if (sides.length > 2) throw new Error(`Use one “=” in “${src}”.`);
    const l = compileExpr(sides[0], ["x", "y"]);
    const r = sides.length === 2 ? compileExpr(sides[1], ["x", "y"]) : () => 0;
    return { kind: "implicit", F: (x, y) => l(x, y) - r(x, y) };
  }
  return { kind: "y", fn: compileExpr(text) };
}

/** Samples a parametric curve into polylines (split where undefined or where it jumps by more than `jump`). */
export function sampleParametric(fx, fy, t0, t1, jump = Infinity, n = 600) {
  const out = [];
  let cur = [];
  for (let k = 0; k <= n; k++) {
    const tt = t0 + ((t1 - t0) * k) / n;
    const p = [fx(tt), fy(tt)];
    const ok = Number.isFinite(p[0]) && Number.isFinite(p[1]);
    const last = cur[cur.length - 1];
    if (!ok || (last && Math.hypot(p[0] - last[0], p[1] - last[1]) > jump)) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    if (ok) cur.push(p);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/**
 * The curve F(x, y) = 0 over a box by marching squares on an nx × ny grid: line segments [[x1, y1], [x2, y2]].
 * Sign changes across poles (|F| grows at the crossing) are skipped; saddles are resolved with the cell center.
 */
export function implicitSegments(F, x0, x1, y0, y1, nx = 120, ny = 90) {
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
  const W = nx + 1;
  const v = new Float64Array(W * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) v[j * W + i] = F(x0 + i * dx, y0 + j * dy);
  const segs = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const f = c.map(([a, b]) => v[b * W + a]);
      if (f.some((x) => !Number.isFinite(x))) continue;
      const hits = [];
      for (let e = 0; e < 4; e++) {
        const a = f[e], b = f[(e + 1) % 4];
        if (a < 0 === b < 0) {
          hits.push(null);
          continue;
        }
        const s = a / (a - b);
        const [pa, pb] = [c[e], c[(e + 1) % 4]];
        const x = x0 + (pa[0] + (pb[0] - pa[0]) * s) * dx, y = y0 + (pa[1] + (pb[1] - pa[1]) * s) * dy;
        const mid = F(x, y);
        hits.push(Number.isFinite(mid) && Math.abs(mid) <= Math.max(Math.abs(a), Math.abs(b)) ? [x, y] : null);
      }
      const on = hits.filter(Boolean);
      if (on.length === 2) segs.push(on);
      else if (on.length === 4) {
        const center = F(x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dy);
        if (center < 0 === f[0] < 0) segs.push([hits[0], hits[1]], [hits[2], hits[3]]);
        else segs.push([hits[3], hits[0]], [hits[1], hits[2]]);
      }
    }
  return segs;
}

/** The legend text of a plot function: "y = …" for graphs, the expression itself for curves. */
export function curveLabel(f) {
  if (f.label) return f.label;
  let kind = "y";
  try {
    kind = parseCurve(f.expr).kind;
  } catch {
    /* shown as typed */
  }
  return kind === "y" ? `y = ${f.expr.replace(EXPLICIT, "").trim()}` : f.expr.trim();
}

/** Nice axis step for a range (1, 2, 5 × 10^k) giving about `count` ticks. */
export function niceStep(range, count = 8) {
  const raw = Math.abs(range) / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

// ---------------------------------------------------------------- normalizing

const colName = (c) => (c < 26 ? "" : String.fromCharCode(64 + Math.floor(c / 26))) + String.fromCharCode(65 + (c % 26));
/** 0-based row and column → "B3". */
export const a1 = (r, c) => `${colName(c)}${r + 1}`;
/** "B3" or "A1:C2" (case-insensitive) → { r0, c0, r1, c1 } or null. */
export function cellRange(text) {
  const m = /^\s*([A-Z]{1,2})(\d{1,3})(?:\s*:\s*([A-Z]{1,2})(\d{1,3}))?\s*$/i.exec(String(text ?? ""));
  if (!m) return null;
  const col = (s) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const [ra, ca] = [+m[2] - 1, col(m[1])];
  const [rb, cb] = m[3] ? [+m[4] - 1, col(m[3])] : [ra, ca];
  if (ra < 0 || rb < 0) return null;
  return { r0: Math.min(ra, rb), c0: Math.min(ca, cb), r1: Math.max(ra, rb), c1: Math.max(ca, cb) };
}

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
    const merges = [];
    for (const m of Array.isArray(e.merges) ? e.merges.slice(0, 500) : []) {
      const g = cellRange(m);
      if (!g || g.r0 >= e.rows.length || g.c0 >= cols) continue;
      g.r1 = Math.min(g.r1, e.rows.length - 1);
      g.c1 = Math.min(g.c1, cols - 1);
      if ((g.r1 === g.r0 && g.c1 === g.c0) || merges.some((o) => g.r0 <= o.r1 && g.r1 >= o.r0 && g.c0 <= o.c1 && g.c1 >= o.c0)) continue;
      merges.push(g);
    }
    if (merges.length) e.merges = merges.map((g) => `${a1(g.r0, g.c0)}:${a1(g.r1, g.c1)}`);
    else delete e.merges;
    const styles = {};
    for (const [k, v] of Object.entries(e.styles && typeof e.styles === "object" ? e.styles : {}).slice(0, 6000)) {
      const g = cellRange(k);
      if (!g || g.r0 >= e.rows.length || g.c0 >= cols || !v) continue;
      const st = { ...(v.bold ? { bold: true } : {}), ...(hexOr(v.fill, null) ? { fill: hexOr(v.fill, null) } : {}) };
      if (Object.keys(st).length) styles[a1(g.r0, g.c0)] = st;
    }
    if (Object.keys(styles).length) e.styles = styles;
    else delete e.styles;
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
    e.name = String(e.name ?? t("Sub-board")).slice(0, 120);
  }
  return e;
}

// ---------------------------------------------------------------- math formulas

const SYMBOLS = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", sum: "∑", prod: "∏", int: "∫", oint: "∮", infty: "∞", partial: "∂", nabla: "∇", pm: "±", mp: "∓", times: "×", cdot: "·", div: "÷", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", propto: "∝", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftrightarrow: "⇔", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩", forall: "∀", exists: "∃", emptyset: "∅", cdots: "⋯", ldots: "…", degree: "°", circ: "∘", sin: "sin", cos: "cos", tan: "tan", log: "log", ln: "ln", lim: "lim", exp: "exp", min: "min", max: "max", quad: "  ", ",": " ", ";": " ", "!": "", "{": "{", "}": "}", "%": "%", "\\": " " };
const RELATIONS = new Set(["pm", "mp", "times", "cdot", "div", "le", "leq", "ge", "geq", "ne", "neq", "approx", "equiv", "sim", "propto", "to", "rightarrow", "leftarrow", "Rightarrow", "Leftrightarrow", "in", "notin", "subset", "subseteq", "cup", "cap"]);
const UPRIGHT = new Set(["sin", "cos", "tan", "log", "ln", "lim", "exp", "min", "max"]);

/** Environments: delimiters left and right, column alignment (c, l, or "rl" alternating right / left). */
const ENVS = { matrix: ["", "", "c"], pmatrix: ["(", ")", "c"], bmatrix: ["[", "]", "c"], Bmatrix: ["{", "}", "c"], vmatrix: ["|", "|", "c"], Vmatrix: ["‖", "‖", "c"], smallmatrix: ["", "", "c"], cases: ["{", "", "l"], aligned: ["", "", "rl"], align: ["", "", "rl"], "align*": ["", "", "rl"], gathered: ["", "", "c"], array: ["", "", "c"] };
const DELIMS = { "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", ".": "", "/": "/", "\\{": "{", "\\}": "}", "\\lbrace": "{", "\\rbrace": "}", "\\|": "‖", "\\vert": "|", "\\Vert": "‖", "\\langle": "⟨", "\\rangle": "⟩", "\\lbrack": "[", "\\rbrack": "]" };

/**
 * Parses TeX-like math into nodes: { k: "t", s, italic } | { k: "sup"|"sub", base, arg } | { k: "frac", n, d } |
 * { k: "sqrt", arg } | { k: "row", items } | { k: "delim", open, close, body } | { k: "matrix", env, rows: node[][] }.
 */
export function parseTex(src) {
  const s = String(src ?? "");
  let i = 0;
  const skipSpace = () => {
    while (/\s/.test(s[i] || "")) i++;
  };
  function delim() {
    skipSpace();
    const m = /^\\(?:[a-zA-Z]+|.)|^./.exec(s.slice(i));
    if (!m) return "";
    i += m[0].length;
    return Object.hasOwn(DELIMS, m[0]) ? DELIMS[m[0]] : "";
  }
  function envName() {
    skipSpace();
    if (s[i] !== "{") return "";
    const end = s.indexOf("}", i);
    const name = s.slice(i + 1, end < 0 ? s.length : end).trim();
    i = end < 0 ? s.length : end + 1;
    return name;
  }
  function environment(env) {
    if (env === "array") envName(); // column spec
    const rows = [[]];
    const cellEnd = (j) => s[j] === "&" || s.startsWith("\\\\", j) || s.startsWith("\\end", j);
    while (i < s.length && rows.length <= 50) {
      const cell = row(cellEnd);
      if (rows[rows.length - 1].length < 20) rows[rows.length - 1].push(cell);
      if (s[i] === "&") i++;
      else if (s.startsWith("\\\\", i)) {
        i += 2;
        rows.push([]);
      } else {
        if (s.startsWith("\\end", i)) {
          i += 4;
          envName();
        }
        break;
      }
    }
    const last = rows[rows.length - 1];
    if (rows.length > 1 && (!last.length || (last.length === 1 && !last[0].items.length))) rows.pop();
    return { k: "matrix", env: Object.hasOwn(ENVS, env) ? env : "matrix", rows };
  }
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
      if (name === "left") {
        const open = delim();
        const body = row((j) => s.startsWith("\\right", j));
        let close = "";
        if (s.startsWith("\\right", i)) {
          i += 6;
          close = delim();
        }
        return { k: "delim", open, close, body };
      }
      if (name === "right") {
        delim();
        return { k: "t", s: "", italic: false };
      }
      if (name === "begin") return environment(envName());
      if (name === "end") {
        envName();
        return { k: "t", s: "", italic: false };
      }
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
    const done = typeof stop === "function" ? stop : (j) => s[j] === stop;
    while (i < s.length && !done(i)) {
      if (s[i] === "^" || s[i] === "_") {
        const k = s[i] === "^" ? "sup" : "sub";
        i++;
        const base = items.pop() || { k: "t", s: "", italic: false };
        items.push({ k, base, arg: group() });
        continue;
      }
      const n = single();
      if (n.k === "t" && UPRIGHT.has(n.s)) n.italic = false;
      if (n.k !== "t" || n.s) items.push(n); // spaces and empty commands add nothing
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
    case "delim": {
      const b = layoutTex(node.body, size, measure);
      const axis = -size * 0.3;
      const half = Math.max(axis + b.ascent, b.descent - axis, size * 0.5) + size * 0.08;
      return fence(b, node.open, node.close, axis - half, axis + half, size);
    }
    case "matrix": {
      const [open, close, align] = ENVS[node.env] || ENVS.matrix;
      const small = node.env === "smallmatrix" ? 0.7 : 1;
      const cells = node.rows.map((r) => r.map((c) => layoutTex(c, size * small, measure)));
      const ncol = Math.max(1, ...cells.map((r) => r.length));
      const colW = Array.from({ length: ncol }, (_, j) => Math.max(0, ...cells.map((r) => r[j]?.w || 0)));
      const rowA = cells.map((r) => Math.max(size * small * 0.75, ...r.map((c) => c.ascent)));
      const rowD = cells.map((r) => Math.max(size * small * 0.25, ...r.map((c) => c.descent)));
      const gapY = size * 0.3;
      const gapX = (j) => (align === "rl" ? (j % 2 ? size * 1.2 : size * 0.15) : size * (align === "l" ? 1 : 0.8));
      const H = rowA.reduce((a, v, k) => a + v + rowD[k], 0) + gapY * Math.max(0, cells.length - 1);
      const axis = -size * 0.3;
      const top = axis - H / 2;
      const body = { w: colW.reduce((a, v) => a + v, 0) + colW.slice(1).reduce((a, _, j) => a + gapX(j), 0), ascent: -top, descent: top + H, runs: [], rules: [] };
      let y = top;
      cells.forEach((r, i) => {
        y += rowA[i];
        let x = 0;
        for (let j = 0; j < ncol; j++) {
          const c = r[j];
          const a = align === "rl" ? (j % 2 ? "l" : "r") : align;
          if (c) place(body, c, x + (a === "l" ? 0 : a === "r" ? colW[j] - c.w : (colW[j] - c.w) / 2), y);
          x += colW[j] + (j < ncol - 1 ? gapX(j) : 0);
        }
        y += rowD[i] + gapY;
      });
      return open || close ? fence(body, open, close, top - size * 0.08, top + H + size * 0.08, size) : body;
    }
    default:
      return { w: 0, ascent: 0, descent: 0, runs: [], rules: [] };
  }
}
function place(out, b, dx, dy) {
  for (const r of b.runs) out.runs.push({ ...r, x: r.x + dx, y: r.y + dy });
  for (const r of b.rules) out.rules.push({ ...r, x: r.x + dx, y: r.y + dy });
  if (b.strokes?.length) (out.strokes ||= []).push(...b.strokes.map((pl) => pl.map(([x, y]) => [x + dx, y + dy])));
  out.ascent = Math.max(out.ascent, b.ascent - dy);
  out.descent = Math.max(out.descent, b.descent + dy);
}

/** Wraps a laid-out box in stretched delimiters drawn as strokes from `top` to `bot` (baseline coordinates). */
function fence(b, open, close, top, bot, size) {
  const dw = (ch) => (!ch ? 0 : "|‖".includes(ch) ? size * 0.25 : size * 0.4);
  const out = { w: 0, ascent: -top, descent: bot, runs: [], rules: [], strokes: [] };
  const lw = dw(open);
  out.strokes.push(...delimStrokes(open, 0, top, bot, lw));
  place(out, b, lw + (open ? size * 0.05 : 0), 0);
  const x = lw + (open ? size * 0.05 : 0) + b.w + (close ? size * 0.05 : 0);
  out.strokes.push(...delimStrokes(close, x, top, bot, dw(close)));
  out.w = x + dw(close);
  return out;
}

/** Polylines of a stretched delimiter in [x0, x0 + w] × [top, bot]; right-hand ones are mirrored left ones. */
export function delimStrokes(ch, x0, top, bot, w) {
  if (!ch) return [];
  const h = bot - top, mid = (top + bot) / 2;
  const LEFT = { ")": "(", "]": "[", "}": "{", "⟩": "⟨" };
  const base = LEFT[ch] || ch;
  let lines;
  if (base === "(") lines = [Array.from({ length: 17 }, (_, k) => [x0 + w * 0.85 - w * 0.6 * Math.sin((Math.PI * k) / 16), top + (h * k) / 16])];
  else if (base === "[") lines = [[[x0 + w * 0.8, top], [x0 + w * 0.3, top], [x0 + w * 0.3, bot], [x0 + w * 0.8, bot]]];
  else if (base === "{") {
    const xs = x0 + w * 0.5, r = Math.min(w * 0.35, h * 0.08);
    lines = [[[x0 + w * 0.9, top], [xs + r * 0.3, top + r * 0.3], [xs, top + r], [xs, mid - r], [xs - r * 0.3, mid - r * 0.3], [x0 + w * 0.1, mid], [xs - r * 0.3, mid + r * 0.3], [xs, mid + r], [xs, bot - r], [xs + r * 0.3, bot - r * 0.3], [x0 + w * 0.9, bot]]];
  } else if (base === "⟨") lines = [[[x0 + w * 0.8, top], [x0 + w * 0.2, mid], [x0 + w * 0.8, bot]]];
  else if (base === "|") lines = [[[x0 + w / 2, top], [x0 + w / 2, bot]]];
  else if (base === "‖") lines = [[[x0 + w * 0.3, top], [x0 + w * 0.3, bot]], [[x0 + w * 0.7, top], [x0 + w * 0.7, bot]]];
  else if (base === "/") lines = [[[x0 + w * 0.9, top], [x0 + w * 0.1, bot]]];
  else return [];
  return LEFT[ch] ? lines.map((pl) => pl.map(([x, y]) => [2 * x0 + w - x, y])) : lines;
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

/**
 * Items of a rich object in its local box. `measure(text, size, font)` → px (board font ids). `opts.preview` is the
 * display list of a sub-board's target page ({ items, width, height }, from render.js), drawn scaled into the card.
 */
export function objectItems(el, measure, m = IDENT, opts = {}) {
  const { w, h } = el;
  const items = [];
  const runs = [];
  const flushText = () => runs.length && items.push({ t: "text", runs: runs.splice(0), m });
  if (el.type === "table") {
    const rows = el.rows.length, cols = el.rows[0].length;
    const cw = w / cols, rh = h / rows;
    const size = el.fontSize;
    const mg = (el.merges || []).map(cellRange).filter(Boolean);
    const span = new Map(); // "r,c" → merge box (anchor) or null (covered)
    for (const g of mg)
      for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) span.set(`${r},${c}`, r === g.r0 && c === g.c0 ? g : null);
    const box = (r, c) => {
      const g = span.get(`${r},${c}`);
      return g ? { x: g.c0 * cw, y: g.r0 * rh, w: (g.c1 - g.c0 + 1) * cw, h: (g.r1 - g.r0 + 1) * rh } : { x: c * cw, y: r * rh, w: cw, h: rh };
    };
    const inner = (r, c, r2, c2) => {
      // true when cells (r, c) and (r2, c2) lie in the same merge, so no grid line between them
      for (const g of mg) if (r >= g.r0 && r <= g.r1 && r2 >= g.r0 && r2 <= g.r1 && c >= g.c0 && c <= g.c1 && c2 >= g.c0 && c2 <= g.c1) return true;
      return false;
    };
    if (el.header) items.push(path(rectD(0, 0, w, rh), solid(el.fill), null, m));
    for (const [k, st] of Object.entries(el.styles || {})) {
      const g = cellRange(k);
      if (!st.fill || !g || span.get(`${g.r0},${g.c0}`) === null) continue;
      const b = box(g.r0, g.c0);
      items.push(path(rectD(b.x, b.y, b.w, b.h), solid(st.fill), null, m));
    }
    const grid = [["M", 0, 0], ["L", w, 0], ["M", 0, h], ["L", w, h], ["M", 0, 0], ["L", 0, h], ["M", w, 0], ["L", w, h]];
    for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) if (!inner(r - 1, c, r, c)) grid.push(["M", c * cw, r * rh], ["L", (c + 1) * cw, r * rh]);
    for (let c = 1; c < cols; c++) for (let r = 0; r < rows; r++) if (!inner(r, c - 1, r, c)) grid.push(["M", c * cw, r * rh], ["L", c * cw, (r + 1) * rh]);
    items.push(path(grid, null, line(el.stroke, 1), m));
    el.rows.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell || span.get(`${r},${c}`) === null) return;
      const b = box(r, c);
      const merged = span.has(`${r},${c}`);
      let text = cell.split("\n")[0];
      while (text.length > 1 && measure(text, size, "sans") > b.w - 12) text = `${text.slice(0, -2)}…`;
      const tw = measure(text, size, "sans");
      const numeric = /^[-+]?[\d.,]+%?$/.test(cell.trim());
      const x = merged ? b.x + (b.w - tw) / 2 : numeric && !(el.header && r === 0) ? b.x + b.w - 6 - tw : b.x + 6;
      const bold = (el.header && r === 0) || el.styles?.[a1(r, c)]?.bold;
      runs.push(textRun(text, x, b.y + b.h / 2 + size * 0.35, size, { weight: bold ? 700 : 400 }, measure));
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
    if (l.strokes?.length) items.push(path(l.strokes.flatMap((pl) => pl.map(([x, y], j) => [j ? "L" : "M", ox + x, oy + y])), null, line(el.stroke || "#1e1e1e", Math.max(1, size / 16)), m));
    flushText();
  } else if (el.type === "portal") {
    const pv = opts.preview;
    const body = { x: 8, y: 36, w: w - 16, h: h - 36 - 24 };
    const showPreview = pv && pv.width > 0 && pv.height > 0 && pv.items.length && body.w > 40 && body.h > 30;
    items.push(path(rectD(4, 4, w, h), solid("#000000", 0.08), null, m));
    items.push(path(rectD(0, 0, w, h), solid(el.fill || "#f8f9fa"), line(el.stroke || "#495057", 1.5), m));
    items.push(path(rectD(0, 0, w, Math.min(h, 28)), solid(el.stroke || "#495057"), null, m));
    if (showPreview) {
      const s = Math.min(body.w / pv.width, body.h / pv.height);
      const tx = body.x + (body.w - pv.width * s) / 2, ty = body.y + (body.h - pv.height * s) / 2;
      items.push(path(rectD(body.x, body.y, body.w, body.h), solid("#ffffff"), line("#dee2e6", 1), m));
      items.push({ t: "group", items: [{ t: "group", items: pv.items, m: mul(m, [s, 0, 0, s, tx, ty]), opacity: 1, blend: "normal", clip: null, isolate: false }], m: IDENT, opacity: 1, blend: "normal", clip: { d: rectD(body.x, body.y, body.w, body.h), rule: "nonzero", m }, isolate: false });
      let name = `▣ ${el.name}`;
      while (name.length > 3 && measure(name, 13, "sans") > w - 20) name = `${name.slice(0, -2)}…`;
      runs.push(textRun(name, 10, 19, 13, { weight: 700, color: "#ffffff" }, measure));
    } else {
      runs.push(textRun(`▣ ${t("Sub-board")}`, 10, 19, 13, { weight: 700, color: "#ffffff" }, measure));
      runs.push(textRun(el.name, 12, Math.min(h - 10, 28 + 30), 20, { weight: 700 }, measure));
    }
    if (h > 80) runs.push(textRun(t("Double-click to open"), 12, h - 8, 12, { color: "#868e96" }, measure));
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
    let c;
    try {
      c = parseCurve(f.expr);
    } catch {
      return;
    }
    const toD = (pls) => pls.flatMap((pl) => pl.map(([x, y], j) => [j ? "L" : "M", X(x), Y(y)]));
    let d;
    if (c.kind === "y") d = toD(sampleFunction(c.fn, el.xMin, el.xMax, el.yMin, el.yMax, Math.min(1200, Math.max(200, Math.round(w * 1.5)))));
    else if (c.kind === "param") d = toD(sampleParametric(c.fx, c.fy, c.t0, c.t1, Math.max(el.xMax - el.xMin, el.yMax - el.yMin) / 2, 800));
    else d = toD(implicitSegments(c.F, el.xMin, el.xMax, el.yMin, el.yMax, clamp(Math.round(w / 4), 30, 160), clamp(Math.round(h / 4), 30, 160)));
    if (d.length) items.push({ t: "group", items: [path(d, null, line(f.color, 2.5), m)], m: IDENT, opacity: 1, blend: "normal", clip: { d: rectD(0, 0, w, h), rule: "nonzero", m }, isolate: false });
    runs.push(textRun(curveLabel(f), 8, 18 + k * 18, 13, { color: f.color, weight: 700 }, measure));
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
  if (el.type === "plot") return el.functions.map((f) => curveLabel({ expr: f.expr })).concat(el.points.map((p) => `${p.label ? `${p.label} ` : ""}(${p.x}, ${p.y})`)).join("\n");
  if (el.type === "math") return el.tex;
  if (el.type === "portal") return el.name;
  return "";
}
