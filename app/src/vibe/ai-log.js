// AI log: one structured record per assistant request (docs/ai-logging.md), so developers can iterate on skills and
// tools. Stored with core/log-store.js in its own channel ("ai.log.index" / "ai.seg.<n>", rotating, 14 days, 5 MB).
// Settings ▸ Artificial intelligence ▸ Logging and actions: `aiLog` (metadata, default on), `aiLogVerbose` (also the
// prompt, tool arguments and results, default off). Secrets are always redacted (core/log.js ▸ redact/redactValue).
//
// Public API
//   createRunLog({ verbose, now }) → { start(meta), event(ev), approval(name, ok, reason), finish(o) → record }
//   recordRun(record)                          appends to the store (lazy, never throws)
//   loadAiLog() / clearAiLog() / aiLogStats()
//   exportAiLog(records, { includeContent, build }) → JSON object;  aiLogMarkdown(exported) → string
//   hashText(s) → 8-hex FNV-1a
// Pure apart from recordRun/loadAiLog/clearAiLog/aiLogStats (they load core/storage.js lazily).
import { redact, redactValue } from "../core/log.js";

export const AI_INDEX_KEY = "ai.log.index";
export const AI_SEG_PREFIX = "ai.seg.";
export const FORMAT = "openfini-ai-log";
const MAX_RECORD = 64 * 1024;
const MAX_TOOLS = 200;
const CONTENT_KEYS = ["prompt", "args", "result", "reply"];

export function hashText(s) {
  let x = 0x811c9dc5;
  for (let i = 0; i < String(s).length; i++) x = Math.imul(x ^ String(s).charCodeAt(i), 0x01000193) >>> 0;
  return x.toString(16).padStart(8, "0");
}

const sizeOf = (v) => {
  try {
    return typeof v === "string" ? v.length : JSON.stringify(v ?? null).length;
  } catch {
    return 0;
  }
};
const clipStr = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** One request's log. `verbose` keeps redacted content (prompt, tool args and results, the reply). */
export function createRunLog({ verbose = false, now = () => Date.now() } = {}) {
  const rec = { v: 1, t: now(), chat: "", model: "", provider: "", route: null, systemHash: "", skills: [], toolsAvailable: 0, tools: [], approvals: [], retries: [], fallbacks: [], usage: { input: 0, output: 0 }, steps: 0 };
  const open = new Map();
  let reply = "";
  return {
    rec,
    start({ chat, model, provider, route, system, skills, tools, prompt, source, mode }) {
      Object.assign(rec, { chat: chat || "", model: model || "", provider: provider || "", route: route || null, systemHash: system ? hashText(system) : "", systemChars: system ? system.length : 0, skills: (skills || []).slice(0, 100), toolsAvailable: tools || 0, source: source || "chat", mode: mode || "" });
      if (prompt != null) rec.promptChars = String(prompt).length;
      if (verbose && prompt != null) rec.prompt = clipStr(redact(String(prompt)), 8000);
    },
    event(ev) {
      if (!ev) return;
      if (ev.type === "tool_start" && rec.tools.length < MAX_TOOLS) {
        const call = { id: ev.id, name: ev.name, argKeys: ev.input && typeof ev.input === "object" ? Object.keys(ev.input).slice(0, 30) : [], argChars: sizeOf(ev.input), t: now() };
        if (verbose) call.args = redactValue(ev.input);
        open.set(ev.id, call);
        rec.tools.push(call);
        if (ev.name === "use_skill" && ev.input?.name) (rec.skillsLoaded ||= []).push(String(ev.input.name).slice(0, 80));
      } else if (ev.type === "tool_end") {
        const call = open.get(ev.id);
        if (!call) return;
        open.delete(ev.id);
        call.ms = ev.ms ?? now() - call.t;
        call.status = ev.isError ? "error" : "ok";
        call.resultChars = sizeOf(ev.result);
        if (ev.isError) call.error = clipStr(redact(typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result ?? "")), 500);
        if (verbose) call.result = typeof ev.result === "string" ? clipStr(redact(ev.result), 2000) : redactValue(ev.result);
        delete call.t;
      } else if (ev.type === "usage") {
        rec.usage.input += ev.input || 0;
        rec.usage.output += ev.output || 0;
        if (ev.cachedInput != null) rec.usage.cachedInput = (rec.usage.cachedInput || 0) + ev.cachedInput;
      } else if (ev.type === "retry") rec.retries.push({ attempt: ev.attempt, status: ev.status ?? null, error: clipStr(redact(ev.error || ""), 300), delayMs: ev.delayMs });
      else if (ev.type === "route_retry") rec.retries.push({ attempt: ev.attempt, target: ev.target, category: ev.category, error: clipStr(redact(ev.reason || ""), 300), delayMs: ev.delayMs });
      else if (ev.type === "route_fallback") rec.fallbacks.push({ from: ev.from, to: ev.to, category: ev.category, reason: clipStr(redact(ev.reason || ""), 300) });
      else if (ev.type === "step") rec.steps = ev.n;
      else if (ev.type === "text" && verbose) reply += ev.delta || "";
    },
    approval(name, ok, reason) {
      rec.approvals.push({ tool: name, allowed: !!ok, ...(reason ? { reason: clipStr(redact(String(reason)), 200) } : {}) });
    },
    finish({ stopReason = "", error = null } = {}) {
      rec.ms = now() - rec.t;
      rec.stopReason = error ? "error" : stopReason || "end";
      if (error) rec.error = clipStr(redact(String(error.message || error)), 1000);
      for (const call of open.values()) (call.status = "unfinished"), delete call.t;
      if (verbose && reply) rec.reply = clipStr(redact(reply), 4000);
      rec.verbose = !!verbose;
      return rec;
    },
  };
}

// ------------------------------------------------------------------ storage (lazy)
let store = null;
function getStore() {
  store ||= (async () => {
    const [{ createLogStore, newSessionId }, kv] = await Promise.all([import("../core/log-store.js"), import("../core/storage.js")]);
    return createLogStore({ storage: { get: kv.kvGetRaw, set: kv.kvSetRaw, delete: kv.kvDelete }, session: newSessionId(), indexKey: AI_INDEX_KEY, segPrefix: AI_SEG_PREFIX, segmentSize: 100 });
  })().catch(() => null);
  return store;
}

/** Appends one finished record (best effort; never throws). */
export async function recordRun(rec) {
  try {
    const s = await getStore();
    if (!s) return;
    let msg = JSON.stringify(rec);
    if (msg.length > MAX_RECORD) msg = JSON.stringify({ ...rec, tools: rec.tools.map(({ args, result, ...x }) => x), prompt: undefined, reply: undefined, truncated: true });
    s.append({ t: rec.t, level: rec.stopReason === "error" ? "warn" : "info", scope: "ai", msg });
    await s.flush();
  } catch {
    /* logging must never break a run */
  }
}

/** Every stored record, oldest first. */
export async function loadAiLog() {
  const s = await getStore();
  if (!s) return [];
  const out = [];
  for (const e of await s.load("all")) {
    try {
      out.push({ ...JSON.parse(e.msg), session: e.session, build: e.build });
    } catch {
      /* a damaged entry */
    }
  }
  return out;
}
export async function clearAiLog() {
  await (await getStore())?.clear();
}
export async function aiLogStats() {
  return (await (await getStore())?.stats()) || { sessions: 0, entries: 0, bytes: 0 };
}

/** The developer export: secrets are always stripped; document content only with includeContent. */
export function exportAiLog(records, { includeContent = false, build = "" } = {}) {
  const strip = (r) => {
    const x = redactValue(r, 0);
    if (includeContent) return x;
    for (const k of CONTENT_KEYS) delete x[k];
    if (Array.isArray(x.tools)) for (const c of x.tools) if (c && typeof c === "object") (delete c.args, delete c.result);
    return x;
  };
  return { format: FORMAT, version: 1, exported: new Date().toISOString(), build, includesContent: !!includeContent, runs: records.map(strip) };
}

export function aiLogMarkdown(exp) {
  const lines = [`# OpenFini AI log`, "", `Exported ${exp.exported}${exp.build ? ` · build ${exp.build}` : ""} · ${exp.runs.length} run(s) · content ${exp.includesContent ? "included" : "not included"}`, ""];
  for (const r of exp.runs) {
    const tools = Array.isArray(r.tools) ? r.tools : [];
    lines.push(`## ${new Date(r.t).toISOString()} · ${r.model || "?"} · ${r.stopReason || ""}`, "");
    lines.push(`- provider: ${r.provider || "?"}${r.route ? ` · route ${r.route}` : ""} · source ${r.source || "chat"} · ${r.ms ?? "?"} ms · steps ${r.steps ?? 0}`);
    lines.push(`- system prompt hash ${r.systemHash || "-"} (${r.systemChars ?? 0} chars) · ${(r.skills || []).length} skills available · loaded: ${(r.skillsLoaded || []).join(", ") || "none"} · tools available ${r.toolsAvailable ?? 0}`);
    lines.push(`- tokens in ${r.usage?.input ?? 0} / out ${r.usage?.output ?? 0}`);
    if (r.fallbacks?.length) lines.push(`- fallbacks: ${r.fallbacks.map((f) => `${f.from} → ${f.to} (${f.category})`).join("; ")}`);
    if (r.retries?.length) lines.push(`- retries: ${r.retries.length}`);
    if (r.approvals?.length) lines.push(`- approvals: ${r.approvals.map((a) => `${a.tool} ${a.allowed ? "allowed" : "denied"}`).join(", ")}`);
    if (r.error) lines.push(`- error: ${r.error}`);
    if (tools.length) {
      lines.push("", "| tool | status | ms | args | result chars |", "| --- | --- | --- | --- | --- |");
      for (const c of tools) lines.push(`| ${c.name} | ${c.status || ""} | ${c.ms ?? ""} | ${(c.argKeys || []).join(", ")} | ${c.resultChars ?? ""} |`);
    }
    if (r.prompt) lines.push("", "Prompt:", "", "```", String(r.prompt), "```");
    lines.push("");
  }
  return lines.join("\n");
}
