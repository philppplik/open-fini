// Cross-chat memory for Vibe (pure, no DOM, no storage): the record shape, migration of old notes, duplicate
// detection and retrieval. Retrieval is a small lexical ranker (BM25-style term weights over the memory texts, plus
// pinned items and a little recency), so only the memories relevant to the current request go into the system prompt
// instead of every note. Storage lives in store.js (IndexedDB, this device only); the only place memories leave the
// device is the system prompt sent to the model the user chose (docs/vibe-memory.md).
//
// Record: { id, text, kind, scope, enabled, pinned, created, updated, source, uses, lastUsed }
//   kind    "preference" | "fact" | "project" | "note"
//   scope   "global" | "project:<name>" (only used while a document or project with that name is open)
//   source  { chat, title } of the chat that saved it, or null (added by hand)

export const MEMORY_KINDS = ["preference", "fact", "project", "note"];
export const MAX_MEMORY_TEXT = 500;
export const MAX_MEMORIES = 500;

const STOP = new Set("a an and are as at be by for from has have i in is it its me my of on or our so that the this to was we were will with you your".split(" "));

/** Lower-case word tokens without stop words (Unicode letters and digits). */
export function memoryTokens(text) {
  return (String(text || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).map((w) => w.replace(/'s$/, "")).filter((w) => w.length > 1 && !STOP.has(w));
}

/** Brings any stored shape ({ id, text, time } from older versions included) to the current record. */
export function normalizeMemory(m, now = Date.now()) {
  const text = String(m?.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_MEMORY_TEXT);
  const created = Number(m?.created ?? m?.time) || now;
  return {
    id: String(m?.id || `m${created.toString(36)}${Math.random().toString(36).slice(2, 6)}`),
    text,
    kind: MEMORY_KINDS.includes(m?.kind) ? m.kind : "note",
    scope: typeof m?.scope === "string" && (m.scope === "global" || m.scope.startsWith("project:")) ? m.scope : "global",
    enabled: m?.enabled !== false,
    pinned: !!m?.pinned,
    created,
    updated: Number(m?.updated) || created,
    source: m?.source && typeof m.source === "object" ? { chat: String(m.source.chat || ""), title: String(m.source.title || "").slice(0, 80) } : null,
    uses: Number(m?.uses) || 0,
    lastUsed: Number(m?.lastUsed) || 0,
  };
}

/** Jaccard similarity of the token sets of two texts (0..1). */
export function similarity(a, b) {
  const x = new Set(memoryTokens(a));
  const y = new Set(memoryTokens(b));
  if (!x.size || !y.size) return String(a).trim().toLowerCase() === String(b).trim().toLowerCase() ? 1 : 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}

/** The existing memory that says (nearly) the same thing, or null. */
export function findDuplicate(list, text, threshold = 0.75) {
  let best = null;
  let score = threshold;
  for (const m of list || []) {
    const s = similarity(m.text, text);
    if (s >= score) {
      best = m;
      score = s;
    }
  }
  return best;
}

/** True when a memory applies with this project name ("" = no project open). */
export function inScope(m, project = "") {
  if (!m.scope || m.scope === "global") return true;
  return !!project && m.scope.slice(8).toLowerCase() === String(project).toLowerCase();
}

/**
 * Picks the memories to send with a request.
 * @param {object[]} list all memories
 * @param {string} query the user's message (and recent context)
 * @param {{k?:number, budgetChars?:number, project?:string, exclude?:string[], now?:number}} [o]
 * @returns {{selected:object[], considered:number}} selected in prompt order (pinned first, then by relevance)
 */
export function selectMemories(list, query, { k = 8, budgetChars = 2400, project = "", exclude = [], now = Date.now() } = {}) {
  const skip = new Set(exclude);
  const pool = (list || []).filter((m) => m.enabled !== false && m.text && !skip.has(m.id) && inScope(m, project));
  const q = memoryTokens(query);
  // document frequency over the pool, BM25-style idf and length normalization
  const docs = pool.map((m) => memoryTokens(`${m.text} ${m.kind === "note" ? "" : m.kind}`));
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, docs.length) || 1;
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
  const N = pool.length;
  const scored = pool.map((m, i) => {
    const d = docs[i];
    const tf = new Map();
    for (const w of d) tf.set(w, (tf.get(w) || 0) + 1);
    let s = 0;
    for (const w of new Set(q)) {
      const f = tf.get(w) || 0;
      // prefix match for simple inflections ("color" ~ "colors")
      const g = f || [...tf.keys()].some((x) => x.length > 3 && w.length > 3 && (x.startsWith(w) || w.startsWith(x))) * 0.6;
      if (!g) continue;
      const idf = Math.log(1 + (N - (df.get(w) || 0) + 0.5) / ((df.get(w) || 0) + 0.5));
      s += (idf * g * 2.2) / (g + 1.2 * (0.25 + (0.75 * d.length) / avg));
    }
    // preferences are useful in almost every request; a little recency breaks ties
    const prior = (m.kind === "preference" ? 0.15 : 0) + 0.1 * Math.exp(-(now - (m.updated || 0)) / (30 * 864e5));
    return { m, s, prior };
  });
  const pinned = scored.filter((x) => x.m.pinned).sort((a, b) => b.m.updated - a.m.updated);
  const rest = scored.filter((x) => !x.m.pinned);
  // with a small pool every memory fits: keep them all (relevant first) so short notes are never lost
  rest.sort((a, b) => b.s + b.prior - (a.s + a.prior) || b.m.updated - a.m.updated);
  const relevant = N <= k ? rest : rest.filter((x) => x.s > 0 || (x.m.kind === "preference" && q.length < 3));
  const selected = [];
  let used = 0;
  for (const x of [...pinned, ...relevant]) {
    if (selected.length >= k + pinned.length) break;
    if (used + x.m.text.length > budgetChars && selected.length) continue;
    selected.push(x.m);
    used += x.m.text.length;
  }
  return { selected, considered: N };
}

/** Lines for the system prompt (kind prefix helps the model weigh them). */
export function memoryLines(selected) {
  return selected.map((m) => (m.kind === "note" ? m.text : `${m.kind}: ${m.text}`));
}

/** Validated import (JSON exported from the Memory panel); returns normalized records, newest wins on duplicates. */
export function importMemories(existing, json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const arr = Array.isArray(data) ? data : Array.isArray(data?.memories) ? data.memories : null;
  if (!arr) throw new Error("This file does not contain memories.");
  const out = existing.slice();
  let added = 0;
  for (const raw of arr) {
    const m = normalizeMemory(raw);
    if (!m.text || out.some((x) => x.id === m.id) || findDuplicate(out, m.text, 0.95)) continue;
    out.push(m);
    added++;
  }
  return { list: out.slice(-MAX_MEMORIES), added };
}
