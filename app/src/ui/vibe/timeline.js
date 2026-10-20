// Pure activity-log model for Vibe Studio (no DOM). It consumes the same events the chat consumes (message, step,
// tool_start, tool_end, usage, retry, approval, plan, done, error) and builds a timeline of runs:
//   run   = one user request: plan, entries, usage, duration, the session runs it can undo
//   entry = tool call | approval | error | retry
// The UI (panel-activity.js) renders it and `run-log.js` feeds it from a VibeSession.
import { toolTitle, summarizeArgs, isReadTool, endStatus, touchedBy, resultPreview, formatDuration } from "./tool-format.js";

export const FILTERS = ["all", "changes", "errors"];

export class Timeline {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.runs = [];
    this.seq = 0;
    this.listeners = new Set();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  #changed() {
    for (const fn of [...this.listeners]) fn(this);
  }
  get current() {
    const r = this.runs[this.runs.length - 1];
    return r && r.status === "running" ? r : null;
  }

  startRun(title) {
    if (this.current) this.#close(this.current, "done");
    const run = { id: `run${++this.seq}`, title: String(title || "Request").replace(/\s+/g, " ").slice(0, 80), startedAt: this.now(), endedAt: null, status: "running", steps: 0, usage: { input: 0, output: 0, reported: false }, plan: [], entries: [], undoRefs: [], edits: 0 };
    this.runs.push(run);
    this.#changed();
    return run;
  }
  #close(run, status) {
    run.status = status;
    run.endedAt = this.now();
    for (const e of run.entries) if (e.kind === "tool" && (e.status === "running" || e.status === "awaiting")) {
      e.status = "aborted";
      e.endedAt = run.endedAt;
    }
  }
  #run() {
    return this.current || this.startRun("Request");
  }
  #tool(id) {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const e = this.runs[i].entries.find((x) => x.kind === "tool" && x.toolId === id);
      if (e) return e;
    }
    return null;
  }

  /** An agent event (`session.on("event")`). */
  event(ev) {
    if (!ev || !ev.type) return;
    const run = this.#run();
    switch (ev.type) {
      case "step":
        run.steps = Math.max(run.steps, ev.n || 0);
        break;
      case "tool_start":
        run.entries.push({ id: `${run.id}.${run.entries.length + 1}`, kind: "tool", toolId: ev.id, name: ev.name, title: ev.child ? `↳ ${ev.child}: ${toolTitle(ev.name)}` : toolTitle(ev.name), ...(ev.child ? { child: ev.child } : {}), summary: summarizeArgs(ev.input), at: this.now(), endedAt: null, ms: null, status: "running", change: !isReadTool(ev.name), touches: touchedBy(ev.name, ev.input, null), input: ev.input });
        break;
      case "tool_end": {
        const e = this.#tool(ev.id);
        if (!e) break;
        e.status = endStatus(ev.isError, ev.result);
        e.endedAt = this.now();
        e.ms = ev.ms ?? e.endedAt - e.at;
        e.result = resultPreview(ev.result, 140);
        e.touches = touchedBy(e.name, e.input, ev.result);
        if (e.status !== "ok") e.change = false;
        if (e.status === "declined") e.declined = true;
        break;
      }
      case "usage":
        run.usage.input += ev.input || 0;
        run.usage.output += ev.output || 0;
        run.usage.reported = true;
        break;
      case "retry":
        run.entries.push({ id: `${run.id}.${run.entries.length + 1}`, kind: "retry", at: this.now(), attempt: ev.attempt, text: `Provider busy, retry ${ev.attempt}${ev.status ? ` (HTTP ${ev.status})` : ""}`, detail: ev.error ? String(ev.error).slice(0, 200) : "" });
        break;
      default:
        return;
    }
    this.#changed();
  }

  /** The user was asked to approve a call (`session.on("approval")`). */
  approvalAsked(req) {
    const run = this.#run();
    const tool = this.#tool(req.id);
    if (tool && tool.status === "running") tool.status = "awaiting";
    run.entries.push({ id: `${run.id}.${run.entries.length + 1}`, kind: "approval", toolId: req.id, name: req.name, at: this.now(), text: req.reason || `Allow ${toolTitle(req.name)}?`, decision: null });
    this.#changed();
  }
  approvalDecided(toolId, ok) {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const e = this.runs[i].entries.find((x) => x.kind === "approval" && x.toolId === toolId && x.decision == null);
      if (e) {
        e.decision = ok ? "allowed" : "declined";
        e.decidedAt = this.now();
        const t = this.#tool(toolId);
        if (t && t.status === "awaiting") t.status = "running";
        this.#changed();
        return;
      }
    }
  }

  setPlan(steps) {
    const run = this.#run();
    run.plan = (steps || []).map((s) => ({ text: String(s.text ?? s), status: s.status || "todo" }));
    this.#changed();
  }

  /** The run ended: `res` is the agent's `done` result. */
  finish(res = {}) {
    const run = this.current;
    if (!run) return;
    if (res.steps) run.steps = Math.max(run.steps, res.steps);
    const u = res.usage;
    if (u && (u.input || u.output)) {
      run.usage.input = Math.max(run.usage.input, u.input || 0);
      run.usage.output = Math.max(run.usage.output, u.output || 0);
      run.usage.reported = true;
    }
    run.stopReason = res.stopReason || "end_turn";
    this.#close(run, res.stopReason === "aborted" ? "aborted" : res.error ? "error" : "done");
    this.#changed();
  }
  fail(err) {
    const run = this.#run();
    run.entries.push({ id: `${run.id}.${run.entries.length + 1}`, kind: "error", at: this.now(), text: String(err?.message || err || "Unknown error").slice(0, 300) });
    this.#close(run, "error");
    this.#changed();
  }
  /** Idle again without a done/error (defensive): never leave a run "running". */
  settle() {
    if (this.current) {
      this.#close(this.current, "done");
      this.#changed();
    }
  }

  /** The finished run left these undo records in the session (see `session.runs`). */
  attachUndo(refs, edits) {
    const run = [...this.runs].reverse().find((r) => r.status !== "running" && !r.undoRefs.length);
    if (!run || !refs.length) return;
    run.undoRefs = refs;
    run.edits = edits ?? 0;
    this.#changed();
  }
  clear() {
    this.runs = [];
    this.#changed();
  }

  totals() {
    let tools = 0;
    let errors = 0;
    let ms = 0;
    for (const r of this.runs) {
      ms += (r.endedAt ?? this.now()) - r.startedAt;
      for (const e of r.entries) {
        if (e.kind === "tool") tools++;
        if (e.kind === "error" || (e.kind === "tool" && (e.status === "error"))) errors++;
      }
    }
    return { runs: this.runs.length, tools, errors, ms };
  }
}

/** Does an entry pass the chip filter? */
export function matchesFilter(entry, filter) {
  if (filter === "changes") return entry.kind === "tool" && entry.change && entry.status === "ok";
  if (filter === "errors") return entry.kind === "error" || entry.kind === "retry" || (entry.kind === "tool" && (entry.status === "error" || entry.status === "declined")) || (entry.kind === "approval" && entry.decision === "declined");
  return true;
}

/** Entries of a run that pass the filter, in order. */
export function visibleEntries(run, filter) {
  return run.entries.filter((e) => matchesFilter(e, filter));
}

/**
 * Which finished runs can be undone and what "undo through this run" means.
 * `sessionRuns` is `session.runs` (oldest first). Undo always happens newest-first, so a run is directly undoable only
 * when every one of its records is on top of the stack; older runs are undoable "through" the newer ones.
 * Returns Map(runId -> { undoable, direct, count }) where `count` is how many session records get popped.
 */
export function undoPlan(runs, sessionRuns) {
  const out = new Map();
  for (const run of runs) {
    const idx = run.undoRefs.map((r) => sessionRuns.indexOf(r)).filter((i) => i >= 0);
    if (!idx.length) {
      out.set(run.id, { undoable: false, direct: false, count: 0 });
      continue;
    }
    const lowest = Math.min(...idx);
    const count = sessionRuns.length - lowest;
    out.set(run.id, { undoable: true, direct: count === idx.length, count });
  }
  return out;
}

const clock = (t) => new Date(t).toLocaleTimeString("en-US", { hour12: false });

/** Plain-text log for "Copy log". */
export function formatLog(runs, filter = "all") {
  const lines = [];
  for (const run of runs) {
    const dur = formatDuration((run.endedAt ?? Date.now()) - run.startedAt);
    const usage = run.usage.reported ? `, ${run.usage.input.toLocaleString("en-US")} tokens in / ${run.usage.output.toLocaleString("en-US")} out` : "";
    lines.push(`# ${clock(run.startedAt)} “${run.title}” — ${run.status}, ${dur}, ${run.steps || 1} step${run.steps === 1 ? "" : "s"}${usage}`);
    for (const s of run.plan) lines.push(`  plan [${s.status}] ${s.text}`);
    for (const e of visibleEntries(run, filter)) {
      if (e.kind === "tool") lines.push(`  ${clock(e.at)} ${e.title}${e.summary ? ` (${e.summary})` : ""} -> ${e.status}${e.ms != null ? `, ${formatDuration(e.ms)}` : ""}${e.result && e.status !== "ok" ? `: ${e.result}` : ""}`);
      else if (e.kind === "approval") lines.push(`  ${clock(e.at)} approval: ${e.text} -> ${e.decision || "pending"}`);
      else lines.push(`  ${clock(e.at)} ${e.kind}: ${e.text}`);
    }
  }
  return lines.join("\n");
}

/** Files and layers a run touched (successful calls only): `{ paths: string[], nodes: number }`. */
export function summarizeTouched(run) {
  const paths = new Set();
  const nodes = new Set();
  for (const e of run.entries) {
    if (e.kind !== "tool" || e.status !== "ok" || !e.change) continue;
    for (const t of e.touches || []) (t.type === "path" ? paths : nodes).add(t.ref);
  }
  return { paths: [...paths], nodes: nodes.size };
}
