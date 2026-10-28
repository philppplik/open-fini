// Durable log storage: keeps log entries (already redacted by core/log.js when they were recorded) across sessions in
// rotating segments inside the app's key-value store. Pure: no DOM and no direct storage access; the caller passes a
// `storage` ({ get(key), set(key, value), delete(key) }, all async) so tests can use a Map.
//
// Layout (keys inside the store):
//   diag.log.index        [{ key, session, build, t0, t1, count, bytes }]   one row per segment, oldest first
//   diag.seg.<n>          { session, build, entries: [entry...] }           at most `segmentSize` entries
//
// Public API: createLogStore(o) -> { append(entry), flush(), sessions(), load(sessionId|"all"), clear(), prune(),
//   setRetentionDays(n), stats() }; pure helpers: pruneIndex(), summarizeSessions(), filterEntries(), newSessionId().
// Invariants: a segment only ever holds entries of ONE session; retention 0 persists nothing (session only); pruning
// removes whole segments (oldest first) when older than the retention, or when total entries > maxEntries or total
// bytes > maxBytes; every entry is passed through redact() again on its way in (defense in depth).
import { redact } from "./log.js";

export const INDEX_KEY = "diag.log.index";
export const SEG_PREFIX = "diag.seg.";
export const DEFAULTS = { retentionDays: 14, maxEntries: 20000, maxBytes: 5 * 1024 * 1024, segmentSize: 500 };
const DAY = 86400000;

/** A short random id for one app session. */
export function newSessionId(now = Date.now()) {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Which index rows survive. Pure. `keepKeys` are never removed (the open segment).
 * @returns {{keep: object[], drop: object[]}}
 */
export function pruneIndex(index, { now, retentionDays, maxEntries = DEFAULTS.maxEntries, maxBytes = DEFAULTS.maxBytes, keepKeys = [] }) {
  const cutoff = now - retentionDays * DAY;
  const sorted = [...index].sort((a, b) => a.t0 - b.t0);
  const drop = [];
  let rows = sorted.filter((r) => {
    if (r.t1 < cutoff && !keepKeys.includes(r.key)) return (drop.push(r), false);
    return true;
  });
  let entries = rows.reduce((n, r) => n + r.count, 0);
  let bytes = rows.reduce((n, r) => n + r.bytes, 0);
  while (rows.length > 1 && (entries > maxEntries || bytes > maxBytes)) {
    const i = rows.findIndex((r) => !keepKeys.includes(r.key));
    if (i < 0) break;
    const [r] = rows.splice(i, 1);
    drop.push(r);
    entries -= r.count;
    bytes -= r.bytes;
  }
  return { keep: rows, drop };
}

/** Sessions from the index: [{ session, build, t0, t1, count, segments }] newest first. */
export function summarizeSessions(index) {
  const by = new Map();
  for (const r of index) {
    const s = by.get(r.session) || { session: r.session, build: r.build, t0: r.t0, t1: r.t1, count: 0, segments: 0 };
    s.t0 = Math.min(s.t0, r.t0);
    s.t1 = Math.max(s.t1, r.t1);
    s.count += r.count;
    s.segments++;
    by.set(r.session, s);
  }
  return [...by.values()].sort((a, b) => b.t0 - a.t0);
}

/** Filters entries like Logger.entries(): `level` is a minimum rank, `scope` an exact scope, `search` a substring. */
export function filterEntries(entries, { level, scope, search } = {}) {
  const rank = { debug: 0, info: 1, warn: 2, error: 3 };
  const min = level ? rank[level] ?? 0 : 0;
  const q = search ? String(search).toLowerCase() : "";
  return entries.filter((e) => (rank[e.level] ?? 1) >= min && (!scope || scope === "all" || e.scope === scope) && (!q || `${e.msg} ${e.scope} ${e.stack || ""}`.toLowerCase().includes(q)));
}

const slim = ({ t, last, level, scope, msg, stack, count }) => ({ t, last, level, scope, msg: redact(msg), count, ...(stack ? { stack: redact(stack) } : {}) });
const sizeOf = (entries) => entries.reduce((n, e) => n + (e.msg?.length || 0) + (e.stack?.length || 0) + 60, 0);

/**
 * @param {object} o
 * @param {{get:Function,set:Function,delete:Function}} o.storage
 * @param {string} o.session  id of this session
 * @param {string} [o.build]  build/version label stored with every segment
 * @param {() => number} [o.now]
 * @param {number} [o.retentionDays=14]  0 = persist nothing
 */
export function createLogStore({ storage, session, build = "development", now = () => Date.now(), retentionDays = DEFAULTS.retentionDays, maxEntries = DEFAULTS.maxEntries, maxBytes = DEFAULTS.maxBytes, segmentSize = DEFAULTS.segmentSize }) {
  let days = retentionDays;
  let index = null; // loaded lazily
  let seg = null; // { key, entries: [{src, copy}] } the open segment of this session
  let dirty = false;
  const closed = []; // full segments not yet written
  let chain = Promise.resolve();
  const serial = (fn) => (chain = chain.then(fn, fn));

  const loadIndex = async () => (index ||= ((await storage.get(INDEX_KEY)) || []).filter((r) => r && r.key));
  const nextKey = () => `${SEG_PREFIX}${Math.max(0, ...index.map((r) => Number(r.key.slice(SEG_PREFIX.length)) || 0)) + 1}`;

  return {
    session,
    setRetentionDays(n) {
      days = Math.max(0, Math.floor(Number(n) || 0));
    },
    get retentionDays() {
      return days;
    },
    /** Queues an entry (the same object may be appended again after its count changed). Cheap and synchronous. */
    append(entry) {
      if (!days || !entry) return;
      if (seg && seg.entries.length >= segmentSize) (closed.push(seg), (seg = null));
      if (!seg) seg = { key: null, entries: [] };
      if (!seg.entries.some((x) => x.src === entry)) seg.entries.push({ src: entry });
      dirty = true;
    },
    /** Writes the open segment and the index, then prunes. Resolves when done; never throws. */
    flush() {
      return serial(async () => {
        if (!dirty || !seg || !days) return;
        dirty = false;
        try {
          await loadIndex();
          const todo = [...closed, seg];
          for (const open of todo) {
            const entries = open.entries.map((x) => slim(x.src));
            if (!entries.length) continue;
            if (!open.key) open.key = nextKey();
            const row = { key: open.key, session, build, t0: entries[0].t, t1: entries[entries.length - 1].last || entries[entries.length - 1].t, count: entries.length, bytes: sizeOf(entries) };
            await storage.set(open.key, { session, build, entries });
            index = [...index.filter((r) => r.key !== open.key), row];
            closed.shift();
          }
          closed.length = 0;
          await storage.set(INDEX_KEY, index);
          await this.prune();
        } catch {
          dirty = true; // storage unavailable or full: retry on the next flush
        }
      });
    },
    /** Removes segments that are too old or exceed the size caps. */
    async prune() {
      await loadIndex();
      const { keep, drop } = pruneIndex(index, { now: now(), retentionDays: days || DEFAULTS.retentionDays, maxEntries, maxBytes, keepKeys: seg?.key ? [seg.key] : [] });
      if (!drop.length) return 0;
      index = keep;
      for (const r of drop) await storage.delete(r.key);
      await storage.set(INDEX_KEY, index);
      return drop.length;
    },
    /** Sessions on disk (including the open one), newest first. */
    async sessions() {
      return summarizeSessions(await loadIndex());
    },
    /** Entries of one session id, or of every stored session ("all", each entry tagged with `session` and `build`), oldest first. */
    async load(sessionId = "all") {
      const rows = (await loadIndex()).filter((r) => sessionId === "all" || r.session === sessionId).sort((a, b) => a.t0 - b.t0);
      const out = [];
      for (const r of rows) {
        const s = await storage.get(r.key);
        for (const e of s?.entries || []) out.push({ ...e, msg: redact(String(e.msg)), session: r.session, build: r.build });
      }
      return out;
    },
    /** Deletes every stored segment (and forgets the open one). */
    async clear() {
      await serial(async () => {
        await loadIndex();
        for (const r of index) await storage.delete(r.key);
        index = [];
        seg = null;
        closed.length = 0;
        dirty = false;
        await storage.delete(INDEX_KEY);
      });
    },
    async stats() {
      const rows = await loadIndex();
      return { sessions: summarizeSessions(rows).length, entries: rows.reduce((n, r) => n + r.count, 0), bytes: rows.reduce((n, r) => n + r.bytes, 0) };
    },
  };
}
