// Central logging: a leveled, scoped logger with an in-memory ring buffer and automatic redaction of secrets.
// Pure (no DOM): the browser hooks that feed it (console, window errors, CSP, resource loads) live in
// log-capture.js, the viewer in ui/diagnostics-dialog.js.
//
//   import { log } from "./log.js";
//   log.warn("storage", "Quota is almost full", { usage });      // log.debug / info / warn / error(scope, ...args)
//   const l = log.scope("ai"); l.error("Request failed", err);   // scoped helper
//
// Everything is redacted when it is recorded, so the buffer never holds API keys, tokens, credentials in URLs
// or your user name from file paths. Entries are small plain objects: { id, t, last, level, scope, msg, stack?, count, prev? }.

export const LEVELS = ["debug", "info", "warn", "error"];
const RANK = { debug: 0, info: 1, warn: 2, error: 3 };

/** Numeric severity of a level name (unknown names count as info). */
export const levelRank = (level) => RANK[level] ?? 1;

const MAX_MESSAGE = 2000;
const MAX_STACK_LINES = 12;
const MAX_DATA_DEPTH = 4;

// ------------------------------------------------------------------ redaction

const SECRET_NAMES = "api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|token|password|passwd|pwd|passphrase|signature|credential|session[_-]?id";

/** Ordered replacement rules. Every rule is a [RegExp, replacement] pair applied with String.replace. */
const RULES = [
  // data: URIs can be megabytes long and may hold private images
  [/data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?(;[a-z0-9=.+-]+)*,[A-Za-z0-9+/=%_-]{40,}/gi, (m) => `data:[${m.length} chars omitted]`],
  // credentials inside URLs: https://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1[redacted]@"],
  // HTTP authorization headers and bearer tokens
  [/\b(authorization\s*[:=]\s*)(?:bearer|basic|token)?\s*[^\s,;"'}]+/gi, "$1[redacted]"],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  // well-known key formats
  [/\bsk-[A-Za-z0-9_-]{12,}/g, "[redacted-key]"],
  [/\b(?:xai|gsk|pplx|r8|hf|key)[-_][A-Za-z0-9]{20,}/g, "[redacted-key]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted-key]"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/g, "[redacted-key]"],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, "[redacted-key]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[redacted-key]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted-key]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted-jwt]"],
  // name=value / "name": "value" pairs whose name suggests a secret
  [new RegExp(`\\b((?:x-)?(?:${SECRET_NAMES})\\b["']?\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^\\s"'&,;}\\]]+)`, "gi"), (m, head, value) => `${head}${/^["']/.test(value) ? `${value[0]}[redacted]${value[0]}` : "[redacted]"}`],
  // generic query parameters that carry secrets even though their name is short
  [/([?&](?:key|code|auth|sig|state)=)[^\s&#"']+/gi, "$1[redacted]"],
  // home directories (Windows, macOS, Linux), also inside file:// URLs
  [/\b([A-Za-z]:[\\/]+Users[\\/]+)(?:[^\\/\s"'<>:*?|]+(?: [^\\/\s"'<>:*?|]+){0,2}(?=[\\/])|[^\\/\s"'<>:*?|]+)/gi, "$1<user>"],
  [/(\/(?:Users|home)\/)[^/\s"'<>:]+/g, "$1<user>"],
  // e-mail addresses
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  // long opaque tokens that mix letters and digits
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}\b/g, "[redacted-token]"],
];

/**
 * Removes secrets and personal data from text: API keys (sk-…, AIza…, ghp_…), bearer tokens, credentials and
 * token query parameters in URLs, `password=…` style pairs, e-mail addresses and the user name in home-directory paths.
 * @param {unknown} input
 * @returns {string}
 */
export function redact(input) {
  let s = typeof input === "string" ? input : input == null ? "" : String(input);
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  return s;
}

const SECRET_KEY_RE = new RegExp(`^(?:${SECRET_NAMES}|authorization|auth|key|keys|apikeys?|secrets?)$`, "i");

/**
 * Deep copy of a JSON-like value with secret-looking property names blanked and every string redacted.
 * Depth, array length and string length are capped so the result is always small.
 */
export function redactValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redact(value.length > 4000 ? `${value.slice(0, 4000)}…` : value);
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (value instanceof Error) return redact(`${value.name}: ${value.message}`);
  if (typeof Uint8Array !== "undefined" && (value instanceof Uint8Array || value instanceof ArrayBuffer)) return `[binary ${value.byteLength} bytes]`;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DATA_DEPTH) return Array.isArray(value) ? `[array ${value.length}]` : "[object]";
  seen.add(value);
  if (Array.isArray(value)) {
    const out = value.slice(0, 50).map((v) => redactValue(v, depth + 1, seen));
    if (value.length > 50) out.push(`…${value.length - 50} more`);
    return out;
  }
  const out = {};
  let n = 0;
  for (const k of Object.keys(value)) {
    if (++n > 60) {
      out["…"] = "more properties omitted";
      break;
    }
    out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : redactValue(value[k], depth + 1, seen);
  }
  return out;
}

// ------------------------------------------------------------------ formatting

function describe(arg) {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg == null || typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") return String(arg);
  if (typeof arg === "function") return `[function ${arg.name || "anonymous"}]`;
  if (typeof Event !== "undefined" && arg instanceof Event) return `[${arg.type} event]`;
  try {
    return JSON.stringify(redactValue(arg));
  } catch {
    return Object.prototype.toString.call(arg);
  }
}

/** Joins console-style arguments into one message (strings as is, errors as "Name: message", objects as JSON). */
export function formatArgs(args) {
  let msg = args.map(describe).join(" ");
  if (msg.length > MAX_MESSAGE) msg = `${msg.slice(0, MAX_MESSAGE)}…`;
  return redact(msg);
}

/** Keeps the first stack lines of the first Error among `args`, redacted. */
export function stackOf(args) {
  const err = args.find((a) => a instanceof Error && typeof a.stack === "string") || args.find((a) => a && typeof a === "object" && typeof a.stack === "string");
  if (!err) return undefined;
  const lines = String(err.stack).split("\n").filter((l) => /\S/.test(l));
  // the first line repeats the message; keep frames only
  const frames = lines.filter((l, i) => i > 0 || /^\s*at\s/.test(l)).slice(0, MAX_STACK_LINES);
  return frames.length ? redact(frames.map((l) => l.trim()).join("\n")) : undefined;
}

/**
 * A stable key that groups messages differing only in numbers, ids, hashes and URLs
 * ("Failed to load chunk-AB12CD.js (3 retries)" and "... chunk-XY99ZZ.js (5 retries)" share a key).
 */
export function groupKey(msg) {
  return String(msg)
    .replace(/https?:\/\/[^\s"')]+/g, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/[A-Za-z0-9_-]{3,}-[A-Za-z0-9]{8}\.(js|css|woff2?)/g, "<asset>.$1")
    .replace(/\b[0-9a-f]{10,}\b/gi, "<hex>")
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

// ------------------------------------------------------------------ logger

/**
 * @typedef {{id:number, t:number, last:number, level:string, scope:string, msg:string, stack?:string, count:number, prev?:boolean}} LogEntry
 */

export class Logger {
  /**
   * @param {object} [o]
   * @param {number} [o.capacity=2000] ring buffer size
   * @param {() => number} [o.now]
   * @param {string} [o.minLevel="info"] entries below this level are dropped
   * @param {number} [o.mergeWindow=10000] identical consecutive entries within this many ms are merged (count++)
   */
  constructor({ capacity = 2000, now = () => Date.now(), minLevel = "info", mergeWindow = 10000 } = {}) {
    this.capacity = capacity;
    this.now = now;
    this.minLevel = minLevel;
    this.mergeWindow = mergeWindow;
    /** Echo warn/error entries to the real console (set by log-capture.js). */
    this.echo = null;
    /** @type {LogEntry[]} */
    this.buffer = [];
    this.seq = 0;
    this.listeners = new Set();
    this.errorCount = 0; // errors of this session (merged repeats count individually)
    this.warnCount = 0;
    this.seenErrors = 0;
    this.dropped = 0;
  }

  /** Records an entry. `args` follow console.log conventions. Returns the entry (or null when filtered out). */
  log(level, scope, ...args) {
    if (!(level in RANK)) level = "info";
    if (RANK[level] < RANK[this.minLevel]) return null;
    const t = this.now();
    let msg;
    let stack;
    try {
      msg = formatArgs(args);
      stack = RANK[level] >= RANK.warn ? stackOf(args) : undefined;
    } catch {
      msg = "[unprintable log arguments]";
    }
    scope = String(scope || "app").slice(0, 32);
    if (level === "error") this.errorCount++;
    else if (level === "warn") this.warnCount++;
    const last = this.buffer[this.buffer.length - 1];
    let entry;
    if (last && !last.prev && last.level === level && last.scope === scope && last.msg === msg && t - last.last <= this.mergeWindow) {
      last.count++;
      last.last = t;
      entry = last;
    } else {
      entry = { id: ++this.seq, t, last: t, level, scope, msg, count: 1 };
      if (stack) entry.stack = stack;
      this.buffer.push(entry);
      if (this.buffer.length > this.capacity) {
        this.buffer.splice(0, this.buffer.length - this.capacity);
        this.dropped++;
      }
    }
    if (this.echo && RANK[level] >= RANK.warn) {
      try {
        this.echo(level, scope, msg);
      } catch {
        /* the console may be unavailable */
      }
    }
    for (const fn of [...this.listeners]) {
      try {
        fn(entry);
      } catch {
        /* a broken listener must not break logging */
      }
    }
    return entry;
  }

  debug(scope, ...args) {
    return this.log("debug", scope, ...args);
  }
  info(scope, ...args) {
    return this.log("info", scope, ...args);
  }
  warn(scope, ...args) {
    return this.log("warn", scope, ...args);
  }
  error(scope, ...args) {
    return this.log("error", scope, ...args);
  }

  /** A logger bound to one scope: `const l = log.scope("ai"); l.warn("slow")`. */
  scope(name) {
    return { debug: (...a) => this.log("debug", name, ...a), info: (...a) => this.log("info", name, ...a), warn: (...a) => this.log("warn", name, ...a), error: (...a) => this.log("error", name, ...a) };
  }

  /**
   * Entries in recording order.
   * @param {{level?:string, scope?:string, search?:string, since?:number, limit?:number, previous?:boolean}} [f]
   *   `level` is a minimum level; `scope` an exact scope or comma separated list; `search` a case-insensitive substring;
   *   `since` an epoch ms lower bound; `limit` keeps only the newest N; `previous: false` hides entries of earlier sessions.
   */
  entries(f = {}) {
    const min = f.level ? levelRank(f.level) : 0;
    const scopes = f.scope && f.scope !== "all" ? new Set(String(f.scope).split(",").map((s) => s.trim())) : null;
    const q = f.search ? String(f.search).toLowerCase() : "";
    let out = this.buffer.filter((e) => RANK[e.level] >= min && (!scopes || scopes.has(e.scope)) && (!f.since || e.last >= f.since) && (f.previous !== false || !e.prev) && (!q || e.msg.toLowerCase().includes(q) || e.scope.toLowerCase().includes(q) || (e.stack || "").toLowerCase().includes(q)));
    if (f.limit && out.length > f.limit) out = out.slice(out.length - f.limit);
    return out;
  }

  /** Scopes seen so far, sorted. */
  scopes() {
    return [...new Set(this.buffer.map((e) => e.scope))].sort();
  }

  /** Number of errors this session that the user has not looked at yet. */
  get unseen() {
    return this.errorCount - this.seenErrors;
  }
  markSeen() {
    this.seenErrors = this.errorCount;
    for (const fn of [...this.listeners]) fn(null);
  }

  clear() {
    this.buffer = [];
    this.errorCount = 0;
    this.warnCount = 0;
    this.seenErrors = 0;
    for (const fn of [...this.listeners]) fn(null);
  }

  /** Subscribes to new entries (`fn(entry)`) and to clear / seen events (`fn(null)`). Returns the unsubscribe function. */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Puts entries of an earlier session in front of the buffer (marked `prev`). */
  loadPrevious(list) {
    if (!Array.isArray(list)) return 0;
    const clean = list
      .filter((e) => e && typeof e.msg === "string" && Number.isFinite(e.t))
      .slice(-200)
      .map((e) => ({ id: -1, t: e.t, last: e.last || e.t, level: LEVELS.includes(e.level) ? e.level : "error", scope: String(e.scope || "app").slice(0, 32), msg: redact(e.msg).slice(0, MAX_MESSAGE), count: Math.max(1, Number(e.count) || 1), prev: true, ...(e.stack ? { stack: redact(e.stack) } : {}) }));
    for (const e of clean) e.id = -(++this.seq);
    this.buffer = [...clean, ...this.buffer.filter((e) => !e.prev)];
    return clean.length;
  }

  /** The newest error entries of this session, for persistence between sessions. */
  persistable(limit = 50) {
    return this.buffer.filter((e) => !e.prev && e.level === "error").slice(-limit).map(({ t, last, level, scope, msg, stack, count }) => ({ t, last, level, scope, msg, count, ...(stack ? { stack } : {}) }));
  }
}

// ------------------------------------------------------------------ rendering

/** Time as `HH:MM:SS.mmm` in local time. */
export function formatTime(t) {
  const d = new Date(t);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** One entry as a text line (stack frames indented below it). */
export function formatEntry(e, { stack = true } = {}) {
  const head = `${new Date(e.t).toISOString()} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.msg}${e.count > 1 ? ` (x${e.count})` : ""}${e.prev ? " (previous session)" : ""}`;
  return stack && e.stack ? `${head}\n${e.stack.split("\n").map((l) => `    ${l}`).join("\n")}` : head;
}

/** Entries as plain text, one per line. */
export function entriesToText(entries, opts) {
  return entries.map((e) => formatEntry(e, opts)).join("\n");
}

/** The shared application logger. */
export const log = new Logger();
