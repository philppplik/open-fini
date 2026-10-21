// Minimal semantic-version parsing and range matching (the subset npm users know):
// exact, `*`/`x` wildcards, ^ ~, > >= < <= =, hyphen ranges, space = AND, `||` = OR. Pure, no dependencies.

const V = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** "1.2.3-beta.1" -> { major, minor, patch, pre: ["beta", 1] } or null. */
export function parseVersion(s) {
  const m = V.exec(String(s ?? "").trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(".").map((p) => (/^\d+$/.test(p) ? +p : p)) : [] };
}

const cmpId = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : typeof a === "number" ? -1 : typeof b === "number" ? 1 : a < b ? -1 : a > b ? 1 : 0);

/** Compares two versions (strings or parsed): negative, 0 or positive. Pre-releases sort before releases. */
export function compareVersions(a, b) {
  const x = typeof a === "string" ? parseVersion(a) : a;
  const y = typeof b === "string" ? parseVersion(b) : b;
  if (!x || !y) throw new Error(`Invalid version: ${!x ? a : b}`);
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] - y[k];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    const c = cmpId(x.pre[i], y.pre[i]);
    if (c) return c;
  }
  return 0;
}

const P = "(\\d+|[xX*])(?:\\.(\\d+|[xX*]))?(?:\\.(\\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?";
const PARTIAL = new RegExp(`^v?${P}$`);

function partial(s) {
  const m = PARTIAL.exec(s);
  if (!m) return null;
  const num = (v) => (v === undefined || /[xX*]/.test(v) ? null : +v);
  return { major: num(m[1]), minor: num(m[2]), patch: num(m[3]), pre: m[4] || null };
}
const full = (p, fill = 0) => ({ major: p.major ?? fill, minor: p.minor ?? fill, patch: p.patch ?? fill, pre: p.pre ? p.pre.split(".").map((x) => (/^\d+$/.test(x) ? +x : x)) : [] });

/** Expands one comparator token ("^1.2", "~1", ">=1.0.0", "1.x") into [op, version] pairs; null when invalid. */
function expand(tok) {
  const m = /^(\^|~>?|>=|<=|>|<|=)?\s*(.+)$/.exec(tok);
  if (!m) return null;
  const op = m[1] || "";
  const p = partial(m[2]);
  if (!p) return null;
  if (p.major === null) return op === "<" ? [["<", full({ major: 0 })]] : [[">=", full({ major: 0 })]]; // "*"
  const lo = full(p);
  if (op === "^") {
    const hi = p.major > 0 ? { major: p.major + 1 } : p.minor === null ? { major: 1 } : p.minor > 0 || p.patch === null ? { major: 0, minor: (p.minor ?? 0) + 1 } : { major: 0, minor: 0, patch: p.patch + 1 };
    return [[">=", lo], ["<", full(hi)]];
  }
  if (op.startsWith("~")) return [[">=", lo], ["<", full(p.minor === null ? { major: p.major + 1 } : { major: p.major, minor: p.minor + 1 })]];
  if (op === ">=" || op === "<") return [[op, lo]];
  if (op === ">") return p.minor === null ? [[">=", full({ major: p.major + 1 })]] : p.patch === null ? [[">=", full({ major: p.major, minor: p.minor + 1 })]] : [[">", lo]];
  if (op === "<=") return p.minor === null ? [["<", full({ major: p.major + 1 })]] : p.patch === null ? [["<", full({ major: p.major, minor: p.minor + 1 })]] : [["<=", lo]];
  // exact or x-range
  if (p.minor === null) return [[">=", lo], ["<", full({ major: p.major + 1 })]];
  if (p.patch === null) return [[">=", lo], ["<", full({ major: p.major, minor: p.minor + 1 })]];
  return [["=", lo]];
}

function parseSet(part) {
  const s = part.trim().replace(/\s*(>=|<=|>|<|=|\^|~>?)\s+/g, "$1").replace(/\s+-\s+/g, " - ");
  if (!s || s === "*") return [[">=", full({ major: 0 })]];
  const hy = /^(\S+) - (\S+)$/.exec(s);
  if (hy) {
    const a = partial(hy[1]);
    const b = partial(hy[2]);
    if (!a || !b || a.major === null) return null;
    const out = [[">=", full(a)]];
    out.push(b.major === null ? [">=", full({ major: 0 })] : b.minor === null ? ["<", full({ major: b.major + 1 })] : b.patch === null ? ["<", full({ major: b.major, minor: b.minor + 1 })] : ["<=", full(b)]);
    return out;
  }
  const out = [];
  for (const tok of s.split(/\s+/)) {
    const e = expand(tok);
    if (!e) return null;
    out.push(...e);
  }
  return out;
}

/** Parses a range into an array of comparator sets (OR of ANDs); null when invalid. */
export function parseRange(range) {
  const parts = String(range ?? "").split("||");
  const sets = parts.map(parseSet);
  return sets.some((x) => !x) ? null : sets;
}

export const validRange = (range) => parseRange(range) !== null;

/** Does `version` satisfy `range`? Pre-releases only satisfy ranges that mention a pre-release of the same x.y.z. */
export function satisfies(version, range) {
  const v = typeof version === "string" ? parseVersion(version) : version;
  const sets = parseRange(range);
  if (!v || !sets) return false;
  return sets.some((set) => {
    if (!set.every(([op, w]) => {
      const c = compareVersions(v, w);
      return op === "=" ? c === 0 : op === ">=" ? c >= 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c < 0;
    })) return false;
    return !v.pre.length || set.some(([, w]) => w.pre.length && w.major === v.major && w.minor === v.minor && w.patch === v.patch);
  });
}
