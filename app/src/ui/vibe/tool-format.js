// Pure helpers (no DOM) that turn tool calls into human text: titles, one-line argument summaries, durations,
// result parts, status classification and the "what did this call touch" lookup used by the Activity tab.

/** "mcp_github__list_issues" -> "Github › list issues"; "add_shape" -> "Add shape". */
export function toolTitle(name) {
  return String(name || "tool")
    .replace(/^mcp_/, "")
    .replace(/__/g, " › ")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

const READ_RE = /^(get|list|read|search|describe|find|query|extract|check|inspect|measure|analy[sz]e|preview|screenshot|ask_user|update_plan|use_skill|remember|recall|render|export_preview|count|diff|status|log|scan|audit|validate|lint|contrast|sample|histogram|explain)(_|$)/;
/** Heuristic for the "Changes" filter: tools that only look at things. Unknown names count as changes. */
export function isReadTool(name) {
  return READ_RE.test(String(name || "").replace(/^(mcp|ext)_[a-z0-9_]*?__/, ""));
}

const KEY_ORDER = ["path", "file", "filename", "name", "title", "text", "content", "prompt", "query", "url", "id", "ids", "type", "shape", "kind", "color", "fill", "size", "width", "height", "x", "y"];

const oneLine = (v, max) => {
  const s = String(v).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** One-line summary of the arguments ("path: index.html · name: Hero"), never longer than `max` characters. */
export function summarizeArgs(input, max = 90) {
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input).sort((a, b) => {
    const ia = KEY_ORDER.indexOf(a);
    const ib = KEY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const parts = [];
  let len = 0;
  for (const k of keys) {
    const v = input[k];
    if (v == null || v === "" || typeof v === "function") continue;
    let shown;
    if (Array.isArray(v)) shown = v.every((x) => typeof x !== "object") ? v.join(", ") : `${v.length} item${v.length === 1 ? "" : "s"}`;
    else if (typeof v === "object") continue;
    else shown = v;
    const piece = `${k}: ${oneLine(shown, 36)}`;
    if (parts.length && len + piece.length > max) break;
    parts.push(piece);
    len += piece.length + 3;
    if (parts.length >= 3) break;
  }
  return parts.join(" · ");
}

/** 0 -> "0 ms", 950 -> "950 ms", 1234 -> "1.2 s", 65000 -> "1m 05s". */
export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Pretty JSON that never throws and is cut at `max` characters. */
export function formatJson(value, max = 6000) {
  let s;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
  } catch {
    s = String(value);
  }
  if (s === undefined) s = "";
  return s.length > max ? `${s.slice(0, max)}\n… (${(s.length - max).toLocaleString("en-US")} more characters)` : s;
}

/** Splits a tool result (string, content blocks or any value) into text parts and images. */
export function resultParts(result) {
  const texts = [];
  const images = [];
  const add = (b) => {
    if (b == null) return;
    if (typeof b === "string") texts.push(b);
    else if (b.type === "image" && b.data) images.push({ mime: b.mime || "image/png", data: b.data });
    else if (b.type === "text") texts.push(String(b.text ?? ""));
    else texts.push(formatJson(b));
  };
  if (Array.isArray(result)) result.forEach(add);
  else add(result);
  return { texts: texts.map(prettyText), images };
}

/** Text that is JSON gets re-indented; everything else stays as it is. */
export function prettyText(t) {
  const s = String(t);
  if (/^\s*[{[]/.test(s) && s.length < 200_000) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      /* not JSON */
    }
  }
  return s;
}

/** First line of the result, for the collapsed card ("Added rectangle · id n_12"). */
export function resultPreview(result, max = 100) {
  const { texts, images } = resultParts(result);
  const t = texts.map((x) => x.replace(/\s+/g, " ").trim()).find(Boolean) || "";
  if (!t && images.length) return `${images.length} image${images.length === 1 ? "" : "s"}`;
  return oneLine(t, max);
}

/** running | awaiting | ok | error | declined | aborted */
export function endStatus(isError, result) {
  if (!isError) return "ok";
  const first = resultParts(result).texts[0] || "";
  if (/^The user declined/i.test(first)) return "declined";
  if (/^Aborted by the user/i.test(first)) return "aborted";
  return "error";
}

export const STATUS_LABEL = { running: "Running", awaiting: "Waiting for approval", ok: "Done", error: "Failed", declined: "Declined", aborted: "Stopped" };

/** Label of a group of consecutive tool calls: "Using 3 tools…" while any runs, otherwise "Used 4 tools (1 failed)". */
export function groupLabel(statuses) {
  const n = statuses.length;
  const running = statuses.some((s) => s === "running" || s === "awaiting");
  const bad = statuses.filter((s) => s === "error" || s === "declined" || s === "aborted").length;
  const noun = `${n} tool${n === 1 ? "" : "s"}`;
  if (running) return `Using ${noun}…`;
  return `Used ${noun}${bad ? ` (${bad} failed)` : ""}`;
}

const NODE_KEYS = ["id", "node", "nodeId", "layer", "layerId", "target", "parent"];
const PATH_KEYS = ["path", "file", "filename", "from", "to"];

function parseJsonText(result) {
  for (const t of resultParts(result).texts) {
    if (/^\s*\{/.test(t)) {
      try {
        return JSON.parse(t);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/**
 * What a call touched: `{ type: "node", ref }` layers/elements and `{ type: "path", ref }` project files.
 * Looks at the arguments first and at an `id` / `path` in a JSON result second. Pure guesswork on purpose: the
 * caller verifies the ref exists before using it.
 */
export function touchedBy(name, input, result) {
  const out = [];
  const seen = new Set();
  const push = (type, ref) => {
    if (typeof ref !== "string" || !ref || ref.length > 200) return;
    const k = `${type}:${ref}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ type, ref });
  };
  const scan = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const k of NODE_KEYS) if (typeof obj[k] === "string") push("node", obj[k]);
    if (Array.isArray(obj.ids)) obj.ids.forEach((x) => push("node", x));
    for (const k of PATH_KEYS) if (typeof obj[k] === "string" && /[./]/.test(obj[k])) push("path", obj[k]);
  };
  scan(input);
  scan(parseJsonText(result));
  void name;
  return out.slice(0, 8);
}
