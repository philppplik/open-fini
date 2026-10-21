/**
 * Number, percent, currency and date formatting shared by tables and charts (en-US, pure, no DOM).
 *
 * A format spec is a small JSON object stored in documents:
 * `{type: 'auto'|'text'|'number'|'currency'|'percent'|'compact'|'date', decimals?, currency?, thousands?,
 *   negative?: 'minus'|'parens', prefix?, suffix?, dateStyle?: 'short'|'medium'|'long'|'iso'}`.
 *
 * @module format
 */

/**
 * Parses a spreadsheet-like number: `1234`, `1,234.5`, `$12`, `(5)`, `-3`, `45%` (percent values return the
 * fraction, 0.45), `1e3`. Returns `null` when the text is not a number.
 * @param {unknown} input
 * @returns {number|null}
 */
export function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  let t = input.trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1).trim();
  }
  const sign = () => {
    const m = /^[-+−]/.exec(t);
    if (m) {
      if (m[0] !== '+') neg = !neg;
      t = t.slice(1).trim();
    }
  };
  sign();
  t = t.replace(/^[$€£¥]\s*/, '');
  sign();
  t = t.replace(/\s*[$€£¥]$/, '');
  let pct = false;
  if (t.endsWith('%')) {
    pct = true;
    t = t.slice(0, -1).trim();
  }
  let v;
  if (/^\d+(\.\d+)?e[-+]?\d+$/i.test(t)) v = parseFloat(t);
  else if (/^(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/.test(t) && /\d/.test(t)) v = parseFloat(t.replace(/,/g, ''));
  else return null;
  if (!Number.isFinite(v)) return null;
  if (pct) v /= 100;
  return neg ? -v : v;
}

/**
 * Parses an ISO (`2026-01-31`), US (`1/31/2026`) or "Jan 31, 2026" date to a UTC Date, or `null`.
 * @param {unknown} s
 * @returns {Date|null}
 */
export function parseDate(s) {
  if (s instanceof Date) return Number.isNaN(s.getTime()) ? null : s;
  if (typeof s !== 'string') return null;
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t);
  let y;
  let mo;
  let d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t))) {
    [mo, d, y] = [+m[1], +m[2], +m[3]];
    if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
  } else if (/^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/.test(t)) {
    const p = Date.parse(`${t} UTC`);
    return Number.isNaN(p) ? null : new Date(p);
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

const nfCache = new Map();
function nf(opts) {
  const key = JSON.stringify(opts);
  let f = nfCache.get(key);
  if (!f) {
    if (nfCache.size > 200) nfCache.clear();
    f = new Intl.NumberFormat('en-US', opts);
    nfCache.set(key, f);
  }
  return f;
}

const clampDec = (d, dflt) => (Number.isFinite(d) ? Math.max(0, Math.min(10, Math.round(d))) : dflt);

/** Plain number text without float noise: `0.1 + 0.2` → `0.3`. */
export function plainNumber(v) {
  if (!Number.isFinite(v)) return String(v);
  const s = String(+v.toPrecision(12));
  return /e/i.test(s) ? String(v) : s;
}

/**
 * Formats a number with a format spec. Unknown / missing specs use the `auto` behavior.
 * @param {number} v
 * @param {object|null} [fmt]
 * @returns {string}
 */
export function formatNumber(v, fmt) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  const f = fmt || {};
  const type = f.type || 'auto';
  let s;
  const grouping = f.thousands !== false;
  const abs = Math.abs(v);
  const parens = f.negative === 'parens' && v < 0;
  const val = parens ? abs : v;
  switch (type) {
    case 'number': {
      const d = f.decimals;
      s = nf({ minimumFractionDigits: clampDec(d, 0), maximumFractionDigits: clampDec(d, 2), useGrouping: grouping }).format(val);
      break;
    }
    case 'currency': {
      const d = clampDec(f.decimals, 2);
      s = nf({ style: 'currency', currency: f.currency || 'USD', minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: grouping }).format(val);
      break;
    }
    case 'percent': {
      const d = clampDec(f.decimals, 0);
      s = nf({ style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: grouping }).format(val);
      break;
    }
    case 'compact': {
      s = nf({ notation: 'compact', maximumFractionDigits: clampDec(f.decimals, 1) }).format(val);
      break;
    }
    case 'date': {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(val) * 86400000);
      s = formatDate(d, f.dateStyle);
      break;
    }
    default:
      s = Number.isFinite(f.decimals) ? nf({ minimumFractionDigits: clampDec(f.decimals, 0), maximumFractionDigits: clampDec(f.decimals, 0), useGrouping: false }).format(val) : plainNumber(val);
  }
  if (parens) s = `(${s})`;
  return `${f.prefix || ''}${s}${f.suffix || ''}`;
}

/** @param {Date} d @param {'short'|'medium'|'long'|'iso'} [style] */
export function formatDate(d, style = 'medium') {
  if (style === 'iso') return d.toISOString().slice(0, 10);
  const opts = style === 'short' ? { year: '2-digit', month: 'numeric', day: 'numeric' } : style === 'long' ? { year: 'numeric', month: 'long', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(d);
}

/**
 * Formats any value for display. Text stays text unless the format asks for a number or a date and the text
 * parses as one.
 * @param {unknown} value number | string | boolean | null
 * @param {object|null} [fmt]
 * @returns {string}
 */
export function formatValue(value, fmt) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const type = (fmt && fmt.type) || 'auto';
  if (type === 'text') return typeof value === 'number' ? plainNumber(value) : String(value);
  if (type === 'date') {
    if (typeof value === 'number') return formatNumber(value, fmt);
    const d = parseDate(String(value));
    return d ? formatDate(d, fmt.dateStyle) : String(value);
  }
  if (typeof value === 'number') return formatNumber(value, fmt);
  if (type === 'auto' && !(fmt && (fmt.prefix || fmt.suffix || Number.isFinite(fmt.decimals)))) return String(value);
  const n = parseNumber(value);
  return n == null ? String(value) : formatNumber(n, fmt);
}

/** Excel-style column letters: 0 → A, 25 → Z, 26 → AA. */
export function colName(c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Inverse of {@link colName}: `"B"` → 1. Returns -1 for invalid input. */
export function colIndex(name) {
  if (!/^[A-Za-z]{1,3}$/.test(name)) return -1;
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** `(r, c)` → `"B3"`. */
export const cellName = (r, c) => `${colName(c)}${r + 1}`;

/** `"B3"` → `{r:2, c:1}` or `null`. */
export function parseCellName(s) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(s).trim());
  if (!m) return null;
  const r = parseInt(m[2], 10) - 1;
  const c = colIndex(m[1]);
  return r < 0 || c < 0 ? null : { r, c };
}

/**
 * Parses `"A1:C4"` (or a single cell) into an inclusive rectangle, normalized so r0 <= r1 and c0 <= c1.
 * @returns {{r0:number,c0:number,r1:number,c1:number}|null}
 */
export function parseRange(s) {
  const parts = String(s).split(':');
  if (parts.length > 2) return null;
  const a = parseCellName(parts[0]);
  const b = parts.length === 2 ? parseCellName(parts[1]) : a;
  if (!a || !b) return null;
  return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) };
}

export const rangeName = (r) => (r.r0 === r.r1 && r.c0 === r.c1 ? cellName(r.r0, r.c0) : `${cellName(r.r0, r.c0)}:${cellName(r.r1, r.c1)}`);
