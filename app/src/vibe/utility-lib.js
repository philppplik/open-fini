// Everyday helpers behind the "Utilities" tools: a safe calculator (no eval), unit conversion, date arithmetic, unified
// diff application, text search over project files and a sandboxed JavaScript runner (Web Worker with no network,
// terminated at a time limit). Pure apart from runSandboxed, which takes an injectable worker factory for tests.
//
// Public API
//   calculate(expr) → number                 convertUnits(value, from, to) → number     UNITS
//   dateMath({ op, date, other, amount, unit }) → object
//   applyPatch(text, patch) → string          (unified diff, one file; throws with the failing hunk)
//   searchFiles(files, query, { regex, caseSensitive, glob, max }) → [{ path, line, text }]
//   globToRegExp(glob) → RegExp
//   SANDBOX_PRELUDE, sandboxSource(code), runSandboxed(code, { timeoutMs, createWorker }) → Promise<{ result, logs, ms }>

// ------------------------------------------------------------------ calculator

const FN = { sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, sign: Math.sign, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, log: Math.log10, log10: Math.log10, log2: Math.log2, ln: Math.log, exp: Math.exp, min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot };
const CONST = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2 };

/** Evaluates + - * / % ^ (right associative), unary minus, parentheses, n! , functions (FN) and constants. No eval. */
export function calculate(expr) {
  const s = String(expr).replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^");
  if (!s) throw new Error("Empty expression.");
  if (s.length > 2000) throw new Error("The expression is too long.");
  let i = 0;
  const peek = () => s[i];
  const fail = (msg) => {
    throw new Error(`${msg} at position ${i + 1} of “${expr}”.`);
  };
  const eat = (c) => (s[i] === c ? (i++, true) : false);
  function expression() {
    let v = term();
    for (;;) {
      if (eat("+")) v += term();
      else if (eat("-")) v -= term();
      else return v;
    }
  }
  function term() {
    let v = unary();
    for (;;) {
      if (eat("*")) v *= unary();
      else if (eat("/")) v /= unary();
      else if (eat("%")) v %= unary();
      else return v;
    }
  }
  function unary() {
    if (eat("-")) return -unary();
    if (eat("+")) return unary();
    return power();
  }
  function power() {
    const b = postfix();
    return eat("^") ? b ** unary() : b;
  }
  function postfix() {
    let v = atom();
    while (eat("!")) {
      if (v < 0 || v > 170 || !Number.isInteger(v)) fail("Factorial needs an integer from 0 to 170");
      let f = 1;
      for (let k = 2; k <= v; k++) f *= k;
      v = f;
    }
    return v;
  }
  function atom() {
    if (eat("(")) {
      const v = expression();
      if (!eat(")")) fail("Missing “)”");
      return v;
    }
    const num = /^(\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const id = /^[a-z_]\w*/i.exec(s.slice(i));
    if (id) {
      const name = id[0].toLowerCase();
      i += id[0].length;
      if (peek() === "(") {
        const f = Object.hasOwn(FN, name) ? FN[name] : null;
        if (!f) fail(`Unknown function “${name}”`);
        i++;
        const args = [];
        if (!eat(")")) {
          do args.push(expression());
          while (eat(","));
          if (!eat(")")) fail("Missing “)”");
        }
        return f(...args);
      }
      if (Object.hasOwn(CONST, name)) return CONST[name];
      fail(`Unknown name “${name}”`);
    }
    return fail("Unexpected character");
  }
  const v = expression();
  if (i < s.length) fail("Unexpected character");
  return v;
}

// ------------------------------------------------------------------ units

/** factor to the base unit of each dimension */
export const UNITS = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, um: 1e-6, nm: 1e-9, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852, pt: 0.0254 / 72, pc: 0.0254 / 6, px: 0.0254 / 96 },
  mass: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, oz: 0.028349523125, st: 6.35029318 },
  time: { s: 1, ms: 0.001, min: 60, h: 3600, d: 86400, wk: 604800, yr: 31557600 },
  data: { b: 1, kb: 1000, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1048576, gib: 1073741824, tib: 1099511627776 },
  area: { m2: 1, km2: 1e6, cm2: 1e-4, mm2: 1e-6, ha: 1e4, acre: 4046.8564224, ft2: 0.09290304, in2: 0.00064516 },
  volume: { l: 1, ml: 0.001, m3: 1000, cm3: 0.001, gal: 3.785411784, qt: 0.946352946, pint: 0.473176473, floz: 0.0295735295625, cup: 0.2365882365 },
  speed: { "m/s": 1, "km/h": 1 / 3.6, mph: 0.44704, kn: 1852 / 3600 },
  temperature: { c: null, f: null, k: null },
};
const ALIAS = { meter: "m", meters: "m", metre: "m", kilometer: "km", kilometers: "km", centimeter: "cm", millimeter: "mm", inch: "in", inches: "in", foot: "ft", feet: "ft", mile: "mi", miles: "mi", gram: "g", grams: "g", kilogram: "kg", pound: "lb", pounds: "lb", lbs: "lb", ounce: "oz", second: "s", sec: "s", seconds: "s", minute: "min", minutes: "min", hour: "h", hours: "h", hr: "h", day: "d", days: "d", week: "wk", weeks: "wk", year: "yr", years: "yr", byte: "b", bytes: "b", liter: "l", litre: "l", liters: "l", gallon: "gal", "°c": "c", celsius: "c", "°f": "f", fahrenheit: "f", kelvin: "k", kmh: "km/h", kph: "km/h", "µm": "um", "m²": "m2", "km²": "km2", "m³": "m3" };

const unitOf = (u) => {
  const k = String(u).trim().toLowerCase();
  const key = ALIAS[k] || k;
  for (const [dim, table] of Object.entries(UNITS)) if (key in table) return { dim, key };
  throw new Error(`Unknown unit “${u}”. Known: ${Object.values(UNITS).flatMap((t) => Object.keys(t)).join(", ")}.`);
};

export function convertUnits(value, from, to) {
  const a = unitOf(from);
  const b = unitOf(to);
  if (a.dim !== b.dim) throw new Error(`Cannot convert ${a.dim} (${from}) to ${b.dim} (${to}).`);
  const v = Number(value);
  if (a.dim === "temperature") {
    const k = a.key === "c" ? v + 273.15 : a.key === "f" ? ((v - 32) * 5) / 9 + 273.15 : v;
    return b.key === "c" ? k - 273.15 : b.key === "f" ? ((k - 273.15) * 9) / 5 + 32 : k;
  }
  return (v * UNITS[a.dim][a.key]) / UNITS[b.dim][b.key];
}

// ------------------------------------------------------------------ dates

const parseDate = (d) => {
  if (d == null || d === "" || d === "now" || d === "today") return new Date();
  const x = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d);
  if (Number.isNaN(x.getTime())) throw new Error(`“${d}” is not a date (use ISO 8601, e.g. 2026-03-01 or 2026-03-01T12:00:00Z).`);
  return x;
};

/** op "add" (date + amount unit), "diff" (other − date), "info" (weekday, ISO week, day of year). All in UTC. */
export function dateMath({ op = "info", date, other, amount = 0, unit = "days" }) {
  const d = parseDate(date);
  if (op === "add") {
    const x = new Date(d);
    const u = String(unit).toLowerCase().replace(/s$/, "");
    if (u === "year") x.setUTCFullYear(x.getUTCFullYear() + amount);
    else if (u === "month") x.setUTCMonth(x.getUTCMonth() + amount);
    else if (u === "week") x.setUTCDate(x.getUTCDate() + 7 * amount);
    else if (u === "day") x.setUTCDate(x.getUTCDate() + amount);
    else if (u === "hour") x.setTime(x.getTime() + amount * 3600e3);
    else if (u === "minute") x.setTime(x.getTime() + amount * 60e3);
    else throw new Error(`Unknown unit “${unit}” (years, months, weeks, days, hours, minutes).`);
    return { result: x.toISOString() };
  }
  if (op === "diff") {
    const o = parseDate(other);
    const ms = o - d;
    return { days: ms / 864e5, hours: ms / 36e5, weeks: ms / 6048e5, ms };
  }
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const isoWeek = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return { iso: d.toISOString(), weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getUTCDay()], isoWeek, dayOfYear: Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 864e5) + 1, unix: Math.floor(d.getTime() / 1000) };
}

// ------------------------------------------------------------------ unified diff

/** Applies a unified diff (one file) to `text`. Context must match exactly; hunks may be offset by a few lines. */
export function applyPatch(text, patch) {
  const lines = String(text).split("\n");
  const hunks = [];
  let h = null;
  for (const l of String(patch).replace(/\r\n/g, "\n").split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (m) {
      hunks.push((h = { old: Number(m[1]), lines: [] }));
      continue;
    }
    if (!h || l.startsWith("---") || l.startsWith("+++") || l.startsWith("\\")) continue;
    if (l[0] === " " || l[0] === "-" || l[0] === "+") h.lines.push(l);
    else if (l === "") h.lines.push(" ");
  }
  if (!hunks.length) throw new Error("No hunks found: pass a unified diff with @@ -a,b +c,d @@ headers.");
  let delta = 0;
  for (const [k, hk] of hunks.entries()) {
    const before = hk.lines.filter((l) => l[0] !== "+").map((l) => l.slice(1));
    const after = hk.lines.filter((l) => l[0] !== "-").map((l) => l.slice(1));
    const want = Math.max(0, hk.old - 1 + delta);
    const fits = (at) => at >= 0 && at + before.length <= lines.length && before.every((b, j) => lines[at + j] === b);
    let at = -1;
    for (let off = 0; off <= 50 && at < 0; off++) at = fits(want - off) ? want - off : fits(want + off) ? want + off : -1;
    if (at < 0) throw new Error(`Hunk ${k + 1} (line ${hk.old}) does not match the file. Re-read the file and make a fresh diff.`);
    lines.splice(at, before.length, ...after);
    delta += after.length - before.length + (at - want);
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ search in files

export function globToRegExp(glob) {
  const re = String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
  return new RegExp(`(^|/)${re}$`, "i");
}

export function searchFiles(files, query, { regex = false, caseSensitive = false, glob, max = 100 } = {}) {
  let re;
  try {
    re = new RegExp(regex ? query : String(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "" : "i");
  } catch (e) {
    throw new Error(`Invalid regular expression: ${e.message}`);
  }
  const g = glob ? globToRegExp(glob) : null;
  const out = [];
  for (const f of files) {
    if (g && !g.test(f.path)) continue;
    const ls = String(f.text ?? "").split("\n");
    for (let i = 0; i < ls.length; i++) {
      if (!re.test(ls[i])) continue;
      out.push({ path: f.path, line: i + 1, text: ls[i].trim().slice(0, 240) });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// ------------------------------------------------------------------ sandboxed JavaScript

/** Runs first inside the worker: removes every way out (network, storage, nested workers, imports) on the global object
 * and its whole prototype chain, so user code cannot fetch them back from WorkerGlobalScope.prototype. */
export const SANDBOX_PRELUDE = `"use strict";
{ const ks = ["fetch","XMLHttpRequest","WebSocket","WebTransport","EventSource","importScripts","indexedDB","caches","BroadcastChannel","Worker","SharedWorker","RTCPeerConnection","FileReaderSync","Request","Response"];
  for (let o = self; o; o = Object.getPrototypeOf(o)) for (const k of ks) { try { Object.defineProperty(o, k, { value: undefined, configurable: false, writable: false }); } catch {} } }
const __logs = []; const __fmt = (a) => a.map((x) => { try { return typeof x === "string" ? x : JSON.stringify(x); } catch { return String(x); } }).join(" ");
const console = { log: (...a) => { if (__logs.length < 200) __logs.push(__fmt(a).slice(0, 2000)); } }; console.info = console.warn = console.error = console.log;
const __post = self.postMessage.bind(self);
self.onmessage = async () => { try { const r = await __run(); let out; try { out = JSON.parse(JSON.stringify(r ?? null)); } catch { out = String(r); } __post({ ok: true, result: out, logs: __logs }); } catch (err) { __post({ ok: false, error: String((err && err.message) || err), logs: __logs }); } };
`;

/** The worker's whole source: the prelude, then the user's code as the body of an async function (no eval needed). */
export const sandboxSource = (code) => `${SANDBOX_PRELUDE}const __run = async () => {
${code}
};
`;

const browserWorker = (src) => {
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  return w;
};

/** Runs `code` (an async function body; `return` gives the result) in a fresh worker. Throws on error or time-out. */
export function runSandboxed(code, { timeoutMs = 5000, createWorker = browserWorker } = {}) {
  if (String(code).length > 100_000) return Promise.reject(new Error("The code is larger than 100 KB."));
  const t0 = Date.now();
  const w = createWorker(sandboxSource(code));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      w.terminate();
      reject(new Error(`The code ran longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`));
    }, timeoutMs);
    w.onmessage = (e) => {
      clearTimeout(timer);
      w.terminate();
      const d = e.data || {};
      if (d.ok) resolve({ result: d.result, logs: d.logs || [], ms: Date.now() - t0 });
      else reject(new Error(`${d.error}${d.logs?.length ? `\nOutput:\n${d.logs.join("\n")}` : ""}`));
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      w.terminate();
      reject(new Error(e?.message || "The code could not run."));
    };
    w.postMessage("run");
  });
}
