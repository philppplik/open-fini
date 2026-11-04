// Spreadsheet formula engine (Office Suite ▸ Spreadsheet, docs/office-sheet.md): tokenizer, parser, evaluator,
// reference rewriting (fill / paste / insert / delete / rename) and the recalculation engine with a dependency graph.
// Pure: no DOM, no eval/Function. Tests: tests/office/sheet-formula.test.js.
//
// Public API
//   parseFormula(text) → ast                     text without the leading "=" (throws FErr("#ERROR!") on bad syntax)
//   FErr, isErr(v), ERR                          error values (#DIV/0!, #N/A, #NAME?, #NUM!, #REF!, #VALUE!, #NULL!, #CYCLE!, #ERROR!)
//   rewriteRefs(formula, fn) → formula           fn(ref) → ref | null (null = #REF!); ref = { sheet, r, c, absR, absC, r1?, c1?, … }
//   shiftFormula(formula, dr, dc)                relative references move (fill, copy and paste)
//   adjustFormula(formula, { ownSheet, sheet, axis: "row"|"col", at, n })   insert (n > 0) / delete (n < 0) rows or columns
//   renameSheetInFormula(formula, from, to)
//   createCalc(model) → calc                     calc.update(model) → Set<"sid!A1"> changed; calc.get(sid, r, c) → value
//   valueOfCell(cell), toText(value), compareValues(a, b)
// Values: number | string | boolean | null (blank) | FErr. Ranges inside the evaluator are { range: true, sid, r0, c0, r1, c1 }.
// Invariants: evaluation never throws (errors become FErr values); cycles evaluate to #CYCLE!; recursion is bounded
// (dependencies are evaluated in an explicit post-order, so a 100 000-cell chain does not overflow the stack).
import { colName, colIndex } from "../toolkit/selection.js";
import { FUNCTIONS } from "./functions.js";
import { FErr, isErr, ERR, toNum, toText, compareValues, scalar, valueOfCell } from "./values.js";

export { FErr, isErr, ERR, toNum, toText, compareValues, scalar, valueOfCell };

export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;

const ERROR_RE = /^#(DIV\/0!|N\/A|NAME\?|NUM!|REF!|VALUE!|NULL!|CYCLE!|ERROR!)/i;

// ------------------------------------------------------------------------------------------------------ tokenizer

const SHEET_RE = /^(?:'((?:[^']|'')+)'|([A-Za-z_À-￿][\w.À-￿]*))!/;
const CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(])/;
const COLS_RE = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w(])/;
const ROWS_RE = /^(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![\w(])/;
const NUM_RE = /^(\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT_RE = /^[A-Za-z_À-￿][\w.À-￿]*/;

function cellOf(m) {
  const c = colIndex(m[2]);
  const r = Number(m[4]) - 1;
  return { c, r, absC: !!m[1], absR: !!m[3] };
}

/** Reads a reference at `src[i..]` (with an optional sheet prefix). Returns { ref, len } or null. */
function readRef(src, i) {
  let rest = src.slice(i, i + 300);
  let sheet = null;
  let len = 0;
  const sm = SHEET_RE.exec(rest);
  if (sm) {
    sheet = sm[1] != null ? sm[1].replace(/''/g, "'") : sm[2];
    len = sm[0].length;
    rest = rest.slice(len);
  }
  let m = CELL_RE.exec(rest);
  if (m) {
    const a = cellOf(m);
    if (a.c >= MAX_COLS || a.r < 0 || a.r >= MAX_ROWS) return null;
    let ref = { sheet, ...a };
    let l = m[0].length;
    if (rest[l] === ":") {
      const m2 = CELL_RE.exec(rest.slice(l + 1));
      if (m2) {
        const b = cellOf(m2);
        ref = { ...ref, r1: b.r, c1: b.c, absR1: b.absR, absC1: b.absC };
        l += 1 + m2[0].length;
      }
    }
    return { ref, len: len + l };
  }
  m = COLS_RE.exec(rest);
  if (m) {
    const c0 = colIndex(m[2]);
    const c1 = colIndex(m[4]);
    if (c0 < 0 || c1 < 0 || c0 >= MAX_COLS || c1 >= MAX_COLS) return null;
    return { ref: { sheet, r: 0, c: c0, r1: MAX_ROWS - 1, c1, absC: !!m[1], absC1: !!m[3], absR: true, absR1: true, wholeCol: true }, len: len + m[0].length };
  }
  m = ROWS_RE.exec(rest);
  if (m) {
    const r0 = Number(m[2]) - 1;
    const r1 = Number(m[4]) - 1;
    if (r0 < 0 || r1 < 0) return null;
    return { ref: { sheet, r: r0, c: 0, r1, c1: MAX_COLS - 1, absR: !!m[1], absR1: !!m[3], absC: true, absC1: true, wholeRow: true }, len: len + m[0].length };
  }
  return null;
}

function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  if (n > 8192) throw ERR["#ERROR!"];
  while (i < n) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    const s = i;
    if (ch === '"') {
      let j = i + 1;
      let str = "";
      for (;;) {
        if (j >= n) throw ERR["#ERROR!"];
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            str += '"';
            j += 2;
            continue;
          }
          break;
        }
        str += src[j++];
      }
      out.push({ t: "str", v: str, s, e: j + 1 });
      i = j + 1;
      continue;
    }
    if (ch === "#") {
      const m = ERROR_RE.exec(src.slice(i, i + 10));
      if (!m) throw ERR["#ERROR!"];
      out.push({ t: "err", v: m[0].toUpperCase(), s, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    // references come before numbers (1:3 row ranges) and identifiers (A1, Sheet1!B2)
    const prev = out[out.length - 1];
    const canRef = !prev || prev.t === "op" || prev.t === "lp" || prev.t === "comma";
    if (canRef && (/[A-Za-z_$'À-￿]/.test(ch) || (/\d/.test(ch) && /^\$?\d{1,7}:\$?\d/.test(src.slice(i, i + 20))))) {
      const r = readRef(src, i);
      if (r) {
        out.push({ t: "ref", ref: r.ref, s, e: i + r.len });
        i += r.len;
        continue;
      }
    }
    if (/[\d.]/.test(ch)) {
      const m = NUM_RE.exec(src.slice(i, i + 64));
      if (!m) throw ERR["#ERROR!"];
      out.push({ t: "num", v: Number(m[0]), s, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    const id = IDENT_RE.exec(src.slice(i, i + 128));
    if (id) {
      let j = i + id[0].length;
      while (src[j] === " ") j++;
      const name = id[0].toUpperCase();
      if (src[j] === "(") out.push({ t: "fn", v: name.replace(/^_XLFN\.|^_XLWS\./, ""), s, e: i + id[0].length });
      else if (name === "TRUE" || name === "FALSE") out.push({ t: "bool", v: name === "TRUE", s, e: i + id[0].length });
      else out.push({ t: "name", v: id[0], s, e: i + id[0].length });
      i += id[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ t: "op", v: two, s, e: i + 2 });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) out.push({ t: "op", v: ch, s, e: i + 1 });
    else if (ch === "(") out.push({ t: "lp", s, e: i + 1 });
    else if (ch === ")") out.push({ t: "rp", s, e: i + 1 });
    else if (ch === "," || ch === ";") out.push({ t: "comma", s, e: i + 1 });
    else throw ERR["#ERROR!"];
    i++;
  }
  out.push({ t: "end", s: n, e: n });
  return out;
}

// ------------------------------------------------------------------------------------------------------ parser

const astCache = new Map();

/** Parses a formula (without "="). Throws ERR["#ERROR!"] for bad syntax. Results are cached (immutable ASTs). */
export function parseFormula(text) {
  const key = String(text);
  const hit = astCache.get(key);
  if (hit) return hit;
  const toks = tokenize(key);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t) => {
    if (toks[p].t !== t) throw ERR["#ERROR!"];
    return toks[p++];
  };
  const BIN = [["=", "<>", "<", ">", "<=", ">="], ["&"], ["+", "-"], ["*", "/"], ["^"]];
  const level = (k) => {
    if (k === BIN.length) return unary();
    let a = level(k + 1);
    while (peek().t === "op" && BIN[k].includes(peek().v)) {
      const op = next().v;
      a = { k: "bin", op, a, b: level(k + 1) };
    }
    return a;
  };
  const unary = () => {
    if (peek().t === "op" && (peek().v === "-" || peek().v === "+")) {
      const op = next().v;
      return { k: "un", op, a: unary() };
    }
    let a = primary();
    while (peek().t === "op" && peek().v === "%") {
      next();
      a = { k: "pct", a };
    }
    return a;
  };
  const primary = () => {
    if (++depth > 200) throw ERR["#ERROR!"];
    const t = next();
    let node;
    switch (t.t) {
      case "num":
        node = { k: "num", v: t.v };
        break;
      case "str":
        node = { k: "str", v: t.v };
        break;
      case "bool":
        node = { k: "bool", v: t.v };
        break;
      case "err":
        node = { k: "err", v: t.v };
        break;
      case "ref": {
        const r = t.ref;
        node = r.r1 === undefined ? { k: "ref", sheet: r.sheet, r: r.r, c: r.c } : { k: "range", sheet: r.sheet, r0: Math.min(r.r, r.r1), c0: Math.min(r.c, r.c1), r1: Math.max(r.r, r.r1), c1: Math.max(r.c, r.c1) };
        break;
      }
      case "name":
        node = { k: "name", v: t.v };
        break;
      case "fn": {
        expect("lp");
        const args = [];
        if (peek().t !== "rp") {
          for (;;) {
            if (peek().t === "comma" || peek().t === "rp") args.push({ k: "blank" });
            else args.push(level(0));
            if (peek().t === "comma") {
              next();
              if (peek().t === "rp") args.push({ k: "blank" });
              continue;
            }
            break;
          }
        }
        expect("rp");
        node = { k: "fn", name: t.v, args };
        break;
      }
      case "lp":
        node = level(0);
        expect("rp");
        break;
      default:
        throw ERR["#ERROR!"];
    }
    depth--;
    return node;
  };
  const ast = level(0);
  if (peek().t !== "end") throw ERR["#ERROR!"];
  if (astCache.size > 20000) astCache.clear();
  astCache.set(key, ast);
  return ast;
}

// ------------------------------------------------------------------------------------------------------ rewriting

const quoteSheet = (name) => (/^[A-Za-z_][\w.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : `'${String(name).replace(/'/g, "''")}'`);
const cellText = (r, c, absR, absC) => `${absC ? "$" : ""}${colName(c)}${absR ? "$" : ""}${r + 1}`;

/** Text of a reference object (the inverse of the tokenizer's ref). */
export function refText(ref) {
  const sh = ref.sheet != null ? `${quoteSheet(ref.sheet)}!` : "";
  if (ref.wholeCol) return `${sh}${ref.absC ? "$" : ""}${colName(ref.c)}:${ref.absC1 ? "$" : ""}${colName(ref.c1)}`;
  if (ref.wholeRow) return `${sh}${ref.absR ? "$" : ""}${ref.r + 1}:${ref.absR1 ? "$" : ""}${ref.r1 + 1}`;
  const a = cellText(ref.r, ref.c, ref.absR, ref.absC);
  return ref.r1 === undefined ? `${sh}${a}` : `${sh}${a}:${cellText(ref.r1, ref.c1, ref.absR1, ref.absC1)}`;
}

/** Rewrites every reference of a formula. `fn(ref)` returns the new ref, or null for #REF!. Bad syntax is kept. */
export function rewriteRefs(formula, fn) {
  let toks;
  try {
    toks = tokenize(String(formula));
  } catch {
    return formula;
  }
  let out = "";
  let last = 0;
  for (const t of toks) {
    if (t.t !== "ref") continue;
    const next = fn({ ...t.ref });
    out += formula.slice(last, t.s) + (next ? refText(next) : "#REF!");
    last = t.e;
  }
  return out + formula.slice(last);
}

/** Rebuilds a formula with references (and argument separators) written by callbacks; null for bad syntax. */
export function formatTokens(formula, { ref = null, comma = null } = {}) {
  let toks;
  try {
    toks = tokenize(String(formula));
  } catch {
    return null;
  }
  let out = "";
  let last = 0;
  for (const t of toks) {
    let rep = null;
    if (t.t === "ref" && ref) rep = ref(t.ref);
    else if (t.t === "comma" && comma != null) rep = comma;
    if (rep == null) continue;
    out += formula.slice(last, t.s) + rep;
    last = t.e;
  }
  return out + formula.slice(last);
}

const clampR = (v) => Math.max(0, Math.min(MAX_ROWS - 1, v));
const clampC = (v) => Math.max(0, Math.min(MAX_COLS - 1, v));

/** Moves the relative parts of every reference by (dr, dc), as fill and paste do. Out of the sheet → #REF!. */
export function shiftFormula(formula, dr, dc) {
  if (!dr && !dc) return formula;
  return rewriteRefs(formula, (ref) => {
    const out = { ...ref };
    if (!ref.wholeCol) {
      if (!ref.absR) out.r = ref.r + dr;
      if (ref.r1 !== undefined && !ref.absR1) out.r1 = ref.r1 + dr;
    }
    if (!ref.wholeRow) {
      if (!ref.absC) out.c = ref.c + dc;
      if (ref.c1 !== undefined && !ref.absC1) out.c1 = ref.c1 + dc;
    }
    const bad = (v, max) => v !== undefined && (v < 0 || v >= max);
    if (bad(out.r, MAX_ROWS) || bad(out.r1, MAX_ROWS) || bad(out.c, MAX_COLS) || bad(out.c1, MAX_COLS)) return null;
    return out;
  });
}

/**
 * Adjusts references after rows/columns were inserted (n > 0) or deleted (n < 0) at index `at` of sheet `sheet`.
 * `ownSheet` is the name of the sheet the formula lives on (unqualified refs point there).
 */
export function adjustFormula(formula, { ownSheet, sheet, axis, at, n }) {
  return rewriteRefs(formula, (ref) => {
    const target = ref.sheet != null ? ref.sheet : ownSheet;
    if (String(target).toLowerCase() !== String(sheet).toLowerCase()) return ref;
    const [k0, k1, whole] = axis === "row" ? ["r", "r1", ref.wholeCol] : ["c", "c1", ref.wholeRow];
    if (whole) return ref;
    const clamp = axis === "row" ? clampR : clampC;
    const out = { ...ref };
    const single = ref[k1] === undefined;
    if (n > 0) {
      if (ref[k0] >= at) out[k0] = clamp(ref[k0] + n);
      if (!single && ref[k1] >= at) out[k1] = clamp(ref[k1] + n);
      return out;
    }
    const del0 = at;
    const del1 = at - n - 1; // inclusive
    const map = (v) => (v < del0 ? v : v > del1 ? v + n : null);
    if (single) {
      const v = map(ref[k0]);
      if (v === null) return null;
      out[k0] = v;
      return out;
    }
    let a = ref[k0];
    let b = ref[k1];
    if (a >= del0 && b <= del1) return null;
    a = a < del0 ? a : a > del1 ? a + n : del0;
    b = b < del0 ? b : b > del1 ? b + n : del0 - 1;
    out[k0] = a;
    out[k1] = Math.max(a, b);
    return out;
  });
}

export function renameSheetInFormula(formula, from, to) {
  const f = String(from).toLowerCase();
  return rewriteRefs(formula, (ref) => (ref.sheet != null && ref.sheet.toLowerCase() === f ? { ...ref, sheet: to } : ref));
}

/** True when a formula references a sheet name (for warnings when a sheet is deleted). */
export function formulaSheets(formula) {
  const out = new Set();
  rewriteRefs(formula, (ref) => (ref.sheet != null && out.add(ref.sheet.toLowerCase()), ref));
  return out;
}

// ------------------------------------------------------------------------------------------------------ values

// ------------------------------------------------------------------------------------------------------ evaluator

/**
 * Evaluates an AST. `ctx` = { sid, sheetId(name) → sid | null, get(sid, r, c) → value, extent(sid) → { rows, cols } }.
 * Returns a value or a range object (functions turn ranges into values themselves).
 */
export function evaluate(node, ctx) {
  switch (node.k) {
    case "num":
    case "str":
    case "bool":
      return node.v;
    case "blank":
      return null;
    case "err":
      return ERR[node.v] || ERR["#ERROR!"];
    case "name":
      return ERR["#NAME?"];
    case "ref": {
      const sid = node.sheet == null ? ctx.sid : ctx.sheetId(node.sheet);
      if (sid == null) return ERR["#REF!"];
      return ctx.get(sid, node.r, node.c);
    }
    case "range": {
      const sid = node.sheet == null ? ctx.sid : ctx.sheetId(node.sheet);
      if (sid == null) return ERR["#REF!"];
      const ext = ctx.extent(sid);
      return { range: true, sid, r0: node.r0, c0: node.c0, r1: Math.min(node.r1, Math.max(node.r0, ext.rows - 1)), c1: Math.min(node.c1, Math.max(node.c0, ext.cols - 1)) };
    }
    case "un": {
      const v = toNum(scalar(evaluate(node.a, ctx), ctx));
      if (isErr(v)) return v;
      return node.op === "-" ? -v : v;
    }
    case "pct": {
      const v = toNum(scalar(evaluate(node.a, ctx), ctx));
      return isErr(v) ? v : v / 100;
    }
    case "bin":
      return binary(node.op, scalar(evaluate(node.a, ctx), ctx), scalar(evaluate(node.b, ctx), ctx));
    case "fn": {
      const f = FUNCTIONS[node.name];
      if (!f) return ERR["#NAME?"];
      try {
        if (f.lazy) return f.fn(node.args.map((a) => () => evaluate(a, ctx)), ctx);
        const args = node.args.map((a) => evaluate(a, ctx));
        if (!f.allowErrors) for (const a of args) if (isErr(a)) return a;
        return f.fn(args, ctx);
      } catch (e) {
        return e instanceof FErr ? e : ERR["#VALUE!"];
      }
    }
    default:
      return ERR["#ERROR!"];
  }
}

function binary(op, a, b) {
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  if (op === "&") return toText(a) + toText(b);
  if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") {
    const c = compareValues(a, b);
    return op === "=" ? c === 0 : op === "<>" ? c !== 0 : op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
  }
  const x = toNum(a);
  if (isErr(x)) return x;
  const y = toNum(b);
  if (isErr(y)) return y;
  let r;
  switch (op) {
    case "+":
      r = x + y;
      break;
    case "-":
      r = x - y;
      break;
    case "*":
      r = x * y;
      break;
    case "/":
      if (y === 0) return ERR["#DIV/0!"];
      r = x / y;
      break;
    case "^":
      r = Math.pow(x, y);
      break;
    default:
      return ERR["#ERROR!"];
  }
  return Number.isFinite(r) ? r : ERR["#NUM!"];
}

// ------------------------------------------------------------------------------------------------------ calc engine

const VOLATILE = new Set(["TODAY", "NOW", "RAND", "RANDBETWEEN"]);

/** Collects the references of an AST: [{ sheet, r0, c0, r1, c1 }] and whether it is volatile. */
function depsOf(ast, out = { refs: [], volatile: false }) {
  switch (ast.k) {
    case "ref":
      out.refs.push({ sheet: ast.sheet, r0: ast.r, c0: ast.c, r1: ast.r, c1: ast.c });
      break;
    case "range":
      out.refs.push({ sheet: ast.sheet, r0: ast.r0, c0: ast.c0, r1: ast.r1, c1: ast.c1 });
      break;
    case "un":
    case "pct":
      depsOf(ast.a, out);
      break;
    case "bin":
      depsOf(ast.a, out);
      depsOf(ast.b, out);
      break;
    case "fn":
      if (VOLATILE.has(ast.name)) out.volatile = true;
      for (const a of ast.args) depsOf(a, out);
      break;
  }
  return out;
}

const A1_CACHE = new Map();
export function keyRC(key) {
  let v = A1_CACHE.get(key);
  if (!v) {
    const m = /^([A-Z]{1,3})(\d+)$/.exec(key);
    v = m ? { r: Number(m[2]) - 1, c: colIndex(m[1]) } : { r: -1, c: -1 };
    if (A1_CACHE.size > 500000) A1_CACHE.clear();
    A1_CACHE.set(key, v);
  }
  return v;
}
export const rcKey = (r, c) => `${colName(c)}${r + 1}`;

/**
 * The recalculation engine of a workbook model. Keeps parsed formulas, a dependency index and the computed values;
 * `update(model)` recomputes only what changed (and what depends on it).
 */
export function createCalc(model) {
  let wb = null;
  let byName = new Map(); // lower name → sid
  let sheets = new Map(); // sid → sheet
  const values = new Map(); // "sid!A1" → value (formula cells only)
  const info = new Map(); // "sid!A1" → { ast, deps:[{sid,r0..}], volatile }
  const single = new Map(); // "sid!A1" → Set(formula keys) (single-cell deps)
  const ranges = new Map(); // sid → [{ r0, c0, r1, c1, fk }]
  const fcells = new Map(); // sid → Map(col → sorted rows[]) of formula cells (for range → formulas lookups)
  const extents = new Map();

  const sheetId = (name) => byName.get(String(name).toLowerCase()) ?? null;
  const extent = (sid) => {
    let e = extents.get(sid);
    if (!e) {
      let rows = 0;
      let cols = 0;
      for (const k of Object.keys(sheets.get(sid)?.cells || {})) {
        const { r, c } = keyRC(k);
        if (r + 1 > rows) rows = r + 1;
        if (c + 1 > cols) cols = c + 1;
      }
      e = { rows, cols };
      extents.set(sid, e);
    }
    return e;
  };

  function unindex(fk) {
    const inf = info.get(fk);
    if (!inf) return;
    for (const d of inf.deps) {
      if (d.single) single.get(d.key)?.delete(fk);
      else {
        const list = ranges.get(d.sid);
        if (list) {
          const i = list.indexOf(d.entry);
          if (i >= 0) list.splice(i, 1);
        }
      }
    }
    const [sid, a1] = splitKey(fk);
    const { r, c } = keyRC(a1);
    const col = fcells.get(sid)?.get(c);
    if (col) {
      const i = col.indexOf(r);
      if (i >= 0) col.splice(i, 1);
    }
    info.delete(fk);
    values.delete(fk);
  }

  function index(sid, a1, f) {
    const fk = `${sid}!${a1}`;
    let ast;
    try {
      ast = parseFormula(f);
    } catch {
      ast = { k: "err", v: "#ERROR!" };
    }
    const d = depsOf(ast);
    const deps = [];
    for (const ref of d.refs) {
      const tsid = ref.sheet == null ? sid : sheetId(ref.sheet);
      if (tsid == null) continue;
      if (ref.r0 === ref.r1 && ref.c0 === ref.c1) {
        const key = `${tsid}!${rcKey(ref.r0, ref.c0)}`;
        if (!single.has(key)) single.set(key, new Set());
        single.get(key).add(fk);
        deps.push({ single: true, key, sid: tsid, r0: ref.r0, c0: ref.c0, r1: ref.r0, c1: ref.c0 });
      } else {
        const entry = { r0: ref.r0, c0: ref.c0, r1: ref.r1, c1: ref.c1, fk };
        if (!ranges.has(tsid)) ranges.set(tsid, []);
        ranges.get(tsid).push(entry);
        deps.push({ single: false, entry, sid: tsid, ...entry });
      }
    }
    const { r, c } = keyRC(a1);
    info.set(fk, { ast, deps, volatile: d.volatile, sid, r, c });
    if (!fcells.has(sid)) fcells.set(sid, new Map());
    const cols = fcells.get(sid);
    if (!cols.has(c)) cols.set(c, []);
    const rows = cols.get(c);
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    rows.splice(lo, 0, r);
  }

  /** Formula cells inside a range of a sheet. */
  function formulasIn(sid, g, out) {
    const cols = fcells.get(sid);
    if (!cols) return;
    for (const [c, rows] of cols) {
      if (c < g.c0 || c > g.c1) continue;
      let lo = 0;
      let hi = rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid] < g.r0) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < rows.length && rows[i] <= g.r1; i++) out.push(`${sid}!${rcKey(rows[i], c)}`);
    }
  }

  /** Formula keys that read a cell (directly or through a range). */
  function dependents(key, out) {
    for (const fk of single.get(key) || []) out.push(fk);
    const [sid, a1] = splitKey(key);
    const list = ranges.get(sid);
    if (list && list.length) {
      const { r, c } = keyRC(a1);
      for (const e of list) if (r >= e.r0 && r <= e.r1 && c >= e.c0 && c <= e.c1) out.push(e.fk);
    }
  }

  const get = (sid, r, c) => {
    const a1 = rcKey(r, c);
    const fk = `${sid}!${a1}`;
    if (info.has(fk)) {
      if (!values.has(fk)) compute(fk);
      return values.get(fk);
    }
    const cell = sheets.get(sid)?.cells?.[a1];
    return valueOfCell(cell);
  };
  const ctxFor = (sid, r = null, c = null) => ({ sid, r, c, sheetId, get, extent });

  /** Computes a formula cell and everything it needs first, iteratively (explicit stack, cycle detection). */
  function compute(start) {
    const state = new Map(); // fk → 1 visiting, 2 done
    const stack = [[start, false]];
    while (stack.length) {
      const [fk, expanded] = stack.pop();
      if (values.has(fk) && !state.has(fk)) continue;
      if (expanded) {
        state.set(fk, 2);
        if (values.has(fk)) continue;
        const inf = info.get(fk);
        const ctx = ctxFor(inf.sid, inf.r, inf.c);
        const v = evaluate(inf.ast, ctx);
        let out = v && v.range ? scalar({ ...v, r1: v.r0, c1: v.c0 }, ctx) : v;
        if (typeof out === "number" && !Number.isFinite(out)) out = ERR["#NUM!"];
        values.set(fk, out === undefined ? null : out);
        continue;
      }
      if (state.get(fk) === 1) {
        // reached a cell that is still being visited: a cycle
        values.set(fk, ERR["#CYCLE!"]);
        continue;
      }
      if (state.get(fk) === 2) continue;
      state.set(fk, 1);
      stack.push([fk, true]);
      const inf = info.get(fk);
      for (const d of inf.deps) {
        const keys = [];
        if (d.single) {
          if (info.has(d.key)) keys.push(d.key);
        } else formulasIn(d.sid, d, keys);
        for (const k of keys) {
          if (values.has(k)) continue;
          if (state.get(k) === 1) {
            values.set(k, ERR["#CYCLE!"]);
            values.set(fk, ERR["#CYCLE!"]);
            continue;
          }
          if (!state.has(k)) stack.push([k, false]);
        }
      }
    }
  }

  function invalidate(keys) {
    const queue = [...keys];
    const seen = new Set();
    while (queue.length) {
      const k = queue.pop();
      if (seen.has(k)) continue;
      seen.add(k);
      values.delete(k);
      const deps = [];
      dependents(k, deps);
      for (const d of deps) if (!seen.has(d)) queue.push(d);
    }
    return seen;
  }

  function reset(model) {
    values.clear();
    info.clear();
    single.clear();
    ranges.clear();
    fcells.clear();
    extents.clear();
    wb = model;
    sheets = new Map(model.sheets.map((s) => [s.id, s]));
    byName = new Map(model.sheets.map((s) => [s.name.toLowerCase(), s.id]));
    for (const s of model.sheets) for (const [a1, cell] of Object.entries(s.cells || {})) if (cell && typeof cell.f === "string") index(s.id, a1, cell.f);
  }

  const sameSheets = (a, b) => a.sheets.length === b.sheets.length && a.sheets.every((s, i) => s.id === b.sheets[i].id && s.name === b.sheets[i].name);

  const calc = {
    get,
    sheetId,
    /** Value of a cell by sheet id and A1 key. */
    value: (sid, a1) => {
      const { r, c } = keyRC(a1);
      return get(sid, r, c);
    },
    /** Applies a new model; returns the set of keys ("sid!A1") whose values may have changed. */
    update(model) {
      if (model === wb) return new Set();
      if (!wb || !sameSheets(wb, model)) {
        reset(model);
        return null; // everything
      }
      const changed = [];
      const nextSheets = new Map(model.sheets.map((s) => [s.id, s]));
      for (const [sid, s] of nextSheets) {
        const old = sheets.get(sid);
        if (old.cells === s.cells) continue;
        extents.delete(sid);
        const a = old.cells || {};
        const b = s.cells || {};
        for (const k in b) if (a[k] !== b[k]) changed.push([sid, k, a[k], b[k]]);
        for (const k in a) if (!(k in b)) changed.push([sid, k, a[k], undefined]);
      }
      wb = model;
      sheets = nextSheets;
      const keys = [];
      for (const [sid, k, before, after] of changed) {
        const fk = `${sid}!${k}`;
        if (before?.f !== after?.f) {
          unindex(fk);
          if (after && typeof after.f === "string") index(sid, k, after.f);
        }
        keys.push(fk);
      }
      for (const [fk, inf] of info) if (inf.volatile) keys.push(fk);
      return invalidate(keys);
    },
    /** Re-evaluates volatile formulas (TODAY, NOW, RAND). */
    tick() {
      const keys = [];
      for (const [fk, inf] of info) if (inf.volatile) keys.push(fk);
      return invalidate(keys);
    },
    /** Number of formula cells. */
    get formulas() {
      return info.size;
    },
    extent,
  };
  reset(model);
  return calc;
}

const splitKey = (k) => {
  const i = k.lastIndexOf("!");
  return [k.slice(0, i), k.slice(i + 1)];
};
