/**
 * A small, safe spreadsheet formula engine for table cells (pure, no `eval`, no `Function`).
 *
 * Syntax: `=SUM(B2:B5)`, `=A1*1.19`, `=IF(B2>100,"high","low")`, `=ROUND(AVERAGE(C2:C9),1)`, `=A2&" "&B2`.
 * Operators: `+ - * / ^ & % = <> < > <= >=` and parentheses. Functions: SUM, AVERAGE (AVG), MIN, MAX, COUNT,
 * COUNTA, PRODUCT, MEDIAN, ROUND, ABS, SQRT, IF, AND, OR, NOT. References: `A1`, `$A$1`, ranges `A1:B3`.
 * Errors follow spreadsheets: `#DIV/0!`, `#REF!`, `#NAME?`, `#VALUE!`, `#CYCLE!`, `#ERROR!` (syntax).
 *
 * @module formula
 */

import { parseNumber, colName, colIndex } from './format.js';

export class FormulaError {
  /** @param {string} code */
  constructor(code) {
    this.code = code;
  }
  toString() {
    return this.code;
  }
}
export const isError = (v) => v instanceof FormulaError;

const MAX_DEPTH = 64;
const MAX_FORMULA = 1000;
const MAX_RANGE = 100000;

// ---------------------------------------------------------------------------------------------- tokenizer

/** @typedef {{t:'num'|'str'|'ref'|'id'|'op'|'lp'|'rp'|'comma'|'end', v?:any, s:number, e:number, absC?:boolean, absR?:boolean, r?:number, c?:number}} Tok */

/**
 * @param {string} src formula text without the leading `=`
 * @returns {Tok[]}
 */
function tokenize(src) {
  /** @type {Tok[]} */
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i++;
      continue;
    }
    const s = i;
    if (ch === '"') {
      let j = i + 1;
      let str = '';
      for (;;) {
        if (j >= n) throw new FormulaError('#ERROR!');
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
      out.push({ t: 'str', v: str, s, e: j + 1 });
      i = j + 1;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || (ch === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      const m = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(src.slice(i));
      out.push({ t: 'num', v: parseFloat(m[0]), s, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (ch === '$' || /[A-Za-z_]/.test(ch)) {
      const m = /^\$?[A-Za-z]{1,3}\$?\d+(?![A-Za-z0-9_(])/.exec(src.slice(i));
      if (m) {
        const mm = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(m[0]);
        const c = colIndex(mm[2]);
        const r = parseInt(mm[4], 10) - 1;
        out.push({ t: 'ref', absC: !!mm[1], absR: !!mm[3], c, r, s, e: i + m[0].length });
        i += m[0].length;
        continue;
      }
      const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
      if (!id) throw new FormulaError('#ERROR!');
      out.push({ t: 'id', v: id[0].toUpperCase(), s, e: i + id[0].length });
      i += id[0].length;
      continue;
    }
    if (ch === '(') out.push({ t: 'lp', s, e: ++i });
    else if (ch === ')') out.push({ t: 'rp', s, e: ++i });
    else if (ch === ',' || ch === ';') out.push({ t: 'comma', s, e: ++i });
    else if (ch === '<' || ch === '>') {
      const two = src.slice(i, i + 2);
      const op = two === '<=' || two === '>=' || two === '<>' ? two : ch;
      i += op.length;
      out.push({ t: 'op', v: op, s, e: i });
    } else if ('+-*/^&%=:'.includes(ch)) out.push({ t: 'op', v: ch, s, e: ++i });
    else throw new FormulaError('#ERROR!');
  }
  out.push({ t: 'end', s: n, e: n });
  return out;
}

// ---------------------------------------------------------------------------------------------- parser

class Parser {
  constructor(src) {
    if (src.length > MAX_FORMULA) throw new FormulaError('#ERROR!');
    this.toks = tokenize(src);
    this.p = 0;
    this.depth = 0;
  }
  get tok() {
    return this.toks[this.p];
  }
  isOp(v) {
    return this.tok.t === 'op' && this.tok.v === v;
  }
  parse() {
    const e = this.cmp();
    if (this.tok.t !== 'end') throw new FormulaError('#ERROR!');
    return e;
  }
  cmp() {
    let l = this.add();
    while (this.tok.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(this.tok.v)) {
      const op = this.toks[this.p++].v;
      l = { t: 'bin', op, l, r: this.add() };
    }
    return l;
  }
  add() {
    let l = this.mul();
    while (this.tok.t === 'op' && (this.tok.v === '+' || this.tok.v === '-' || this.tok.v === '&')) {
      const op = this.toks[this.p++].v;
      l = { t: 'bin', op, l, r: this.mul() };
    }
    return l;
  }
  mul() {
    let l = this.pow();
    while (this.tok.t === 'op' && (this.tok.v === '*' || this.tok.v === '/')) {
      const op = this.toks[this.p++].v;
      l = { t: 'bin', op, l, r: this.pow() };
    }
    return l;
  }
  pow() {
    let l = this.unary();
    while (this.isOp('^')) {
      this.p++;
      l = { t: 'bin', op: '^', l, r: this.unary() };
    }
    return l;
  }
  unary() {
    if (this.tok.t === 'op' && (this.tok.v === '-' || this.tok.v === '+')) {
      const op = this.toks[this.p++].v;
      if (++this.depth > MAX_DEPTH) throw new FormulaError('#ERROR!');
      const x = this.unary();
      this.depth--;
      return { t: 'un', op, x };
    }
    let e = this.primary();
    while (this.isOp('%')) {
      this.p++;
      e = { t: 'pct', x: e };
    }
    return e;
  }
  primary() {
    const t = this.tok;
    if (++this.depth > MAX_DEPTH) throw new FormulaError('#ERROR!');
    try {
      if (t.t === 'num') {
        this.p++;
        return { t: 'num', v: t.v };
      }
      if (t.t === 'str') {
        this.p++;
        return { t: 'str', v: t.v };
      }
      if (t.t === 'ref') {
        this.p++;
        if (this.isOp(':')) {
          const b = this.toks[this.p + 1];
          if (b.t !== 'ref') throw new FormulaError('#ERROR!');
          this.p += 2;
          return { t: 'range', r0: Math.min(t.r, b.r), c0: Math.min(t.c, b.c), r1: Math.max(t.r, b.r), c1: Math.max(t.c, b.c) };
        }
        return { t: 'ref', r: t.r, c: t.c };
      }
      if (t.t === 'id') {
        this.p++;
        if (this.tok.t === 'lp') {
          this.p++;
          const args = [];
          if (this.tok.t !== 'rp') {
            for (;;) {
              args.push(this.cmp());
              if (this.tok.t === 'comma') {
                this.p++;
                continue;
              }
              break;
            }
          }
          if (this.tok.t !== 'rp') throw new FormulaError('#ERROR!');
          this.p++;
          return { t: 'call', name: t.v, args };
        }
        if (t.v === 'TRUE') return { t: 'bool', v: true };
        if (t.v === 'FALSE') return { t: 'bool', v: false };
        throw new FormulaError('#NAME?');
      }
      if (t.t === 'lp') {
        this.p++;
        const e = this.cmp();
        if (this.tok.t !== 'rp') throw new FormulaError('#ERROR!');
        this.p++;
        return e;
      }
      throw new FormulaError('#ERROR!');
    } finally {
      this.depth--;
    }
  }
}

const astCache = new Map();

/**
 * Parses formula text (without `=`). Returns an AST or a {@link FormulaError}.
 * @param {string} src
 */
export function parseFormula(src) {
  let hit = astCache.get(src);
  if (hit) return hit;
  try {
    hit = new Parser(src).parse();
  } catch (e) {
    hit = e instanceof FormulaError ? e : new FormulaError('#ERROR!');
  }
  if (astCache.size > 500) astCache.clear();
  astCache.set(src, hit);
  return hit;
}

// ---------------------------------------------------------------------------------------------- evaluation

const err = (code) => new FormulaError(code);

/** Coerces a scalar to a number for arithmetic (empty = 0, booleans = 0/1, numeric text parsed). */
function toNum(v) {
  if (isError(v)) return v;
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseNumber(v);
  return n == null ? err('#VALUE!') : n;
}
const toStr = (v) => (v == null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
const toBool = (v) => {
  if (isError(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v == null || v === '') return false;
  const s = String(v).toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  const n = parseNumber(v);
  return n == null ? err('#VALUE!') : n !== 0;
};

function cmpValues(a, b) {
  const an = typeof a === 'number' || a == null || a === '';
  const bn = typeof b === 'number' || b == null || b === '';
  if (an && bn) return (a || 0) - (b || 0);
  if (typeof a === 'string' && typeof b === 'string') {
    const x = parseNumber(a);
    const y = parseNumber(b);
    if (x != null && y != null) return x - y;
    return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return String(toStr(a)).localeCompare(String(toStr(b)));
}

/** Flattens evaluated args into numbers for aggregate functions (ranges skip text and blanks). */
function collectNumbers(args, ev, { countText = false } = {}) {
  const nums = [];
  let count = 0;
  for (const a of args) {
    if (a.t === 'range') {
      const cells = ev.range(a);
      if (isError(cells)) return cells;
      for (const v of cells) {
        if (isError(v)) return v;
        if (typeof v === 'number') nums.push(v);
        else if (typeof v === 'boolean') continue;
        if (v != null && v !== '') count++;
      }
    } else {
      const v = ev.eval(a);
      if (isError(v)) return v;
      if (a.t === 'ref') {
        if (typeof v === 'number') nums.push(v);
        if (v != null && v !== '') count++;
      } else {
        const n = toNum(v);
        if (isError(n)) return n;
        nums.push(n);
        count++;
      }
    }
  }
  return countText ? { nums, count } : nums;
}

const FUNCS = {
  SUM: (a, ev) => {
    const n = collectNumbers(a, ev);
    return isError(n) ? n : n.reduce((s, x) => s + x, 0);
  },
  PRODUCT: (a, ev) => {
    const n = collectNumbers(a, ev);
    return isError(n) ? n : n.length ? n.reduce((s, x) => s * x, 1) : 0;
  },
  AVERAGE: (a, ev) => {
    const n = collectNumbers(a, ev);
    if (isError(n)) return n;
    return n.length ? n.reduce((s, x) => s + x, 0) / n.length : err('#DIV/0!');
  },
  MIN: (a, ev) => {
    const n = collectNumbers(a, ev);
    return isError(n) ? n : n.length ? Math.min(...n) : 0;
  },
  MAX: (a, ev) => {
    const n = collectNumbers(a, ev);
    return isError(n) ? n : n.length ? Math.max(...n) : 0;
  },
  COUNT: (a, ev) => {
    const n = collectNumbers(a, ev);
    return isError(n) ? n : n.length;
  },
  COUNTA: (a, ev) => {
    const r = collectNumbers(a, ev, { countText: true });
    return isError(r) ? r : r.count;
  },
  MEDIAN: (a, ev) => {
    const n = collectNumbers(a, ev);
    if (isError(n)) return n;
    if (!n.length) return err('#VALUE!');
    n.sort((x, y) => x - y);
    const m = n.length >> 1;
    return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
  },
  ROUND: (a, ev) => {
    if (a.length < 1 || a.length > 2) return err('#VALUE!');
    const x = toNum(ev.eval(a[0]));
    if (isError(x)) return x;
    const d = a[1] ? toNum(ev.eval(a[1])) : 0;
    if (isError(d)) return d;
    const f = 10 ** Math.max(-10, Math.min(10, Math.trunc(d)));
    return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
  },
  ABS: (a, ev) => {
    if (a.length !== 1) return err('#VALUE!');
    const x = toNum(ev.eval(a[0]));
    return isError(x) ? x : Math.abs(x);
  },
  SQRT: (a, ev) => {
    if (a.length !== 1) return err('#VALUE!');
    const x = toNum(ev.eval(a[0]));
    if (isError(x)) return x;
    return x < 0 ? err('#VALUE!') : Math.sqrt(x);
  },
  IF: (a, ev) => {
    if (a.length < 2 || a.length > 3) return err('#VALUE!');
    const c = toBool(ev.eval(a[0]));
    if (isError(c)) return c;
    if (c) return ev.eval(a[1]);
    return a[2] ? ev.eval(a[2]) : false;
  },
  AND: (a, ev) => {
    let r = true;
    for (const x of a) {
      const b = toBool(ev.eval(x));
      if (isError(b)) return b;
      r = r && b;
    }
    return a.length ? r : err('#VALUE!');
  },
  OR: (a, ev) => {
    let r = false;
    for (const x of a) {
      const b = toBool(ev.eval(x));
      if (isError(b)) return b;
      r = r || b;
    }
    return a.length ? r : err('#VALUE!');
  },
  NOT: (a, ev) => {
    if (a.length !== 1) return err('#VALUE!');
    const b = toBool(ev.eval(a[0]));
    return isError(b) ? b : !b;
  },
};
FUNCS.AVG = FUNCS.AVERAGE;

/**
 * Evaluates an AST. `ctx.get(r, c)` returns the (already evaluated) value of a cell.
 * @param {any} ast
 * @param {{get:(r:number,c:number)=>any, rows:number, cols:number}} ctx
 */
export function evaluateAst(ast, ctx) {
  if (isError(ast)) return ast;
  const ev = {
    eval(n) {
      switch (n.t) {
        case 'num':
        case 'str':
        case 'bool':
          return n.v;
        case 'ref':
          if (n.r < 0 || n.c < 0 || n.r >= ctx.rows || n.c >= ctx.cols) return err('#REF!');
          return ctx.get(n.r, n.c);
        case 'range': {
          const cells = ev.range(n);
          if (isError(cells)) return cells;
          return cells.length === 1 ? cells[0] : err('#VALUE!');
        }
        case 'un': {
          const x = toNum(ev.eval(n.x));
          return isError(x) ? x : n.op === '-' ? -x : x;
        }
        case 'pct': {
          const x = toNum(ev.eval(n.x));
          return isError(x) ? x : x / 100;
        }
        case 'bin':
          return binary(n.op, ev.eval(n.l), ev.eval(n.r));
        case 'call': {
          const f = FUNCS[n.name];
          return f ? f(n.args, ev) : err('#NAME?');
        }
        default:
          return err('#ERROR!');
      }
    },
    range(n) {
      if (n.r1 >= ctx.rows || n.c1 >= ctx.cols || n.r0 < 0 || n.c0 < 0) return err('#REF!');
      if ((n.r1 - n.r0 + 1) * (n.c1 - n.c0 + 1) > MAX_RANGE) return err('#VALUE!');
      const out = [];
      for (let r = n.r0; r <= n.r1; r++) for (let c = n.c0; c <= n.c1; c++) out.push(ctx.get(r, c));
      return out;
    },
  };
  return ev.eval(ast);
}

function binary(op, a, b) {
  if (isError(a)) return a;
  if (isError(b)) return b;
  switch (op) {
    case '&':
      return toStr(a) + toStr(b);
    case '=':
      return cmpValues(a, b) === 0;
    case '<>':
      return cmpValues(a, b) !== 0;
    case '<':
      return cmpValues(a, b) < 0;
    case '>':
      return cmpValues(a, b) > 0;
    case '<=':
      return cmpValues(a, b) <= 0;
    case '>=':
      return cmpValues(a, b) >= 0;
  }
  const x = toNum(a);
  const y = toNum(b);
  if (isError(x)) return x;
  if (isError(y)) return y;
  switch (op) {
    case '+':
      return x + y;
    case '-':
      return x - y;
    case '*':
      return x * y;
    case '/':
      return y === 0 ? err('#DIV/0!') : x / y;
    case '^': {
      const r = x ** y;
      return Number.isFinite(r) ? r : err('#VALUE!');
    }
  }
  return err('#ERROR!');
}

/**
 * Evaluates a formula string (with or without leading `=`) against a cell getter.
 * @param {string} formula
 * @param {{get:(r:number,c:number)=>any, rows:number, cols:number}} ctx
 */
export function evaluateFormula(formula, ctx) {
  const src = formula[0] === '=' ? formula.slice(1) : formula;
  const ast = parseFormula(src);
  let v = evaluateAst(ast, ctx);
  if (typeof v === 'number' && !Number.isFinite(v)) v = err('#VALUE!');
  return v;
}

/**
 * Creates a lazily evaluated sheet. `raw(r, c)` returns the raw cell content (string or number, `=` starts a
 * formula). `value(r, c)` returns number | string | boolean | null | FormulaError; cycles give `#CYCLE!`.
 * @param {(r:number,c:number)=>any} raw
 * @param {number} rows
 * @param {number} cols
 */
export function createSheet(raw, rows, cols) {
  const cache = new Map();
  const busy = new Set();
  const ctx = { rows, cols, get: (r, c) => value(r, c) };
  function value(r, c) {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return err('#REF!');
    const key = r * 65536 + c;
    if (cache.has(key)) return cache.get(key);
    const s = raw(r, c);
    let v;
    if (typeof s === 'string' && s.charCodeAt(0) === 61 /* = */ && s.length > 1) {
      if (busy.has(key)) return err('#CYCLE!');
      busy.add(key);
      try {
        v = evaluateFormula(s, ctx);
      } finally {
        busy.delete(key);
      }
    } else if (s == null || s === '') v = null;
    else if (typeof s === 'number') v = s;
    else {
      const n = parseNumber(s);
      v = n == null ? String(s) : n;
    }
    // a cycle detected deeper must not poison unrelated cells: only cache non-cycle results
    if (!(isError(v) && v.code === '#CYCLE!')) cache.set(key, v);
    return v;
  }
  return { value, rows, cols };
}

// ---------------------------------------------------------------------------------------------- reference rewriting

/**
 * Rewrites the cell references of a formula. `map({r, c, absR, absC}, rangeSide)` returns `{r, c}` or `null`
 * (→ `#REF!`). Ranges are passed endpoint by endpoint with `rangeSide` = `'start'` or `'end'`; return `null`
 * from both sides to delete the range. Text outside references (including string literals) is kept as is.
 * @param {string} formula
 * @param {(ref:{r:number,c:number,absR:boolean,absC:boolean}, side:'single'|'start'|'end')=>({r:number,c:number}|null)} map
 * @returns {string}
 */
export function rewriteRefs(formula, map) {
  if (typeof formula !== 'string' || formula[0] !== '=') return formula;
  let toks;
  try {
    toks = tokenize(formula.slice(1));
  } catch {
    return formula;
  }
  const src = formula.slice(1);
  let out = '';
  let last = 0;
  const fmt = (t, p) => `${t.absC ? '$' : ''}${colName(p.c)}${t.absR ? '$' : ''}${p.r + 1}`;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'ref') continue;
    const isStart = toks[i + 1] && toks[i + 1].t === 'op' && toks[i + 1].v === ':' && toks[i + 2] && toks[i + 2].t === 'ref';
    if (isStart) {
      const b = toks[i + 2];
      const pa = map(t, 'start');
      const pb = map(b, 'end');
      out += src.slice(last, t.s);
      out += pa && pb ? `${fmt(t, pa)}:${fmt(b, pb)}` : '#REF!';
      last = b.e;
      i += 2;
    } else {
      const p = map(t, 'single');
      out += src.slice(last, t.s);
      out += p ? fmt(t, p) : '#REF!';
      last = t.e;
    }
  }
  return `=${out}${src.slice(last)}`;
}

/**
 * Adjusts references after rows or columns were inserted or deleted.
 * @param {string} formula
 * @param {{axis:'row'|'col', op:'insert'|'delete', at:number, count?:number}} edit
 */
export function shiftFormula(formula, edit) {
  const k = edit.count || 1;
  const key = edit.axis === 'row' ? 'r' : 'c';
  return rewriteRefs(formula, (ref, side) => {
    const v = ref[key];
    let nv = v;
    if (edit.op === 'insert') {
      if (v >= edit.at) nv = v + k;
    } else if (side === 'single') {
      if (v >= edit.at && v < edit.at + k) return null;
      if (v >= edit.at + k) nv = v - k;
    } else if (side === 'start') {
      // a range start inside the deleted block moves to the first surviving row
      if (v >= edit.at + k) nv = v - k;
      else if (v >= edit.at) nv = edit.at;
    } else if (v >= edit.at + k) nv = v - k;
    else if (v >= edit.at) nv = edit.at - 1;
    if (nv < 0) return null;
    return { r: key === 'r' ? nv : ref.r, c: key === 'c' ? nv : ref.c };
  });
}

/**
 * Adjusts references after a row/column moved from index `from` to index `to` (the others shift by one).
 * @param {string} formula
 * @param {{axis:'row'|'col', from:number, to:number}} edit
 */
export function moveFormula(formula, edit) {
  const key = edit.axis === 'row' ? 'r' : 'c';
  return rewriteRefs(formula, (ref) => {
    const v = ref[key];
    let nv = v;
    if (v === edit.from) nv = edit.to;
    else if (edit.from < edit.to && v > edit.from && v <= edit.to) nv = v - 1;
    else if (edit.from > edit.to && v >= edit.to && v < edit.from) nv = v + 1;
    return { r: key === 'r' ? nv : ref.r, c: key === 'c' ? nv : ref.c };
  });
}
