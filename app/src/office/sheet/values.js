// Spreadsheet values shared by the formula engine and its function library (no imports, so neither depends on the
// other in a cycle): error values, coercions and the spreadsheet ordering. Pure.

export class FErr {
  constructor(code) {
    this.code = code;
  }
  toString() {
    return this.code;
  }
}
export const isErr = (v) => v instanceof FErr;
export const ERR = Object.freeze(Object.fromEntries(["#DIV/0!", "#N/A", "#NAME?", "#NUM!", "#REF!", "#VALUE!", "#NULL!", "#CYCLE!", "#ERROR!"].map((c) => [c, new FErr(c)])));
/** The literal value of a stored cell (not its formula result). */
export const valueOfCell = (cell) => (cell == null || cell.v === undefined ? null : cell.v);

export function numText(n) {
  if (!Number.isFinite(n)) return "#NUM!";
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e21 || abs < 1e-9)) return n.toExponential(9).replace(/\.?0+e/, "e").replace("e", "E");
  return String(Number(n.toPrecision(15)));
}

export function toText(v) {
  if (v == null) return "";
  if (typeof v === "number") return numText(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

const typeRank = (v) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 0);

/** Spreadsheet ordering: numbers < text < booleans; text compares case-insensitively; blank acts as 0 or "". */
export function compareValues(a, b) {
  if (a == null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b == null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ta = typeRank(a);
  const tb = typeRank(b);
  if (ta !== tb) return ta - tb;
  if (typeof a === "string") {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function toNum(v) {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isErr(v)) return v;
  const s = String(v).trim();
  if (s === "") return 0;
  const pct = s.endsWith("%");
  const n = Number((pct ? s.slice(0, -1) : s).replace(/^\$/, "").replace(/,(?=\d{3}\b)/g, ""));
  return Number.isFinite(n) ? (pct ? n / 100 : n) : ERR["#VALUE!"];
}

/** A range used where one value is expected: a 1x1 range is its cell; larger ones give #VALUE!. */
export function scalar(v, ctx) {
  if (v && v.range) {
    if (v.r0 === v.r1 && v.c0 === v.c1) return ctx.get(v.sid, v.r0, v.c0);
    return ERR["#VALUE!"];
  }
  return v;
}

