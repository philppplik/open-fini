// Logic behind the "Scripting and checks" tools (tools/script.js). See docs/adr/0028-vibe-code-mode.md.
//
// Code mode: the model writes a short JavaScript function body that runs in a Web Worker without network, storage,
// DOM or imports (the prelude of utility-lib.js), terminated at a time limit. The only way out is
// `openfini.call(name, args)` (or `openfini.<tool_name>(args)`), a message to the app that runs one OpenFini tool
// through the caller's gate. Everything here is pure apart from runScript, which takes an injectable worker factory.
//
// Public API
//   scriptSource(code, args) → string                       worker source
//   runScript(code, { args, timeoutMs, maxCalls, call, createWorker }) → Promise<{ result, logs, calls, ms }>
//   tsType(schema) / tsSignature(tool) → string              TypeScript-like signature of a tool
//   searchTools(tools, query, { group, groups, limit }) → tool[]
//   advertisedTools(groups, context, extra) → Set<string>    tool names listed in the compact mode; CORE_GROUPS
//   pageText(text, { offset, length, search }) → window      paging for read_result
//   diffFacts(before, after) → { added, removed, changed }   structural diff of two pageFacts lists
//   measure(boxes, { tolerance }) → { union, gaps, overlaps, aligned }
//   contrastRatio(hexA, hexB) → number                       WCAG 2 contrast
//   diffPixels(a, b, width, height, { threshold, cell }) → { changed, percent, regions }
import { SANDBOX_PRELUDE } from "./utility-lib.js";

const SCRIPT_RUNTIME = `
const __pending = new Map(); let __seq = 0;
const __call = (name, args) => new Promise((resolve, reject) => { const id = ++__seq; __pending.set(id, { resolve, reject }); __post({ call: id, name: String(name), args: args || {} }); });
const openfini = new Proxy({ call: __call, log: (...a) => console.log(...a) }, { get: (t, k) => (k in t || typeof k !== "string" || k === "then" ? t[k] : (args) => __call(k, args)) });
self.onmessage = async (e) => {
  const m = e.data;
  if (m && m.reply) { const p = __pending.get(m.reply); if (p) { __pending.delete(m.reply); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); } return; }
  try { const r = await __run(openfini.args, openfini); let out; try { out = JSON.parse(JSON.stringify(r ?? null)); } catch { out = String(r); } __post({ ok: true, result: out, logs: __logs }); }
  catch (err) { __post({ ok: false, error: String((err && err.message) || err), logs: __logs }); }
};
`;

/** The worker's whole source: sandbox prelude, the call bridge, then the user's code as an async function body. */
export function scriptSource(code, args) {
  return `${SANDBOX_PRELUDE}${SCRIPT_RUNTIME}openfini.args = ${JSON.stringify(args ?? {}).replace(/</g, "\\u003c")};
const __run = async (args, openfini) => {
${code}
};
`;
}

const browserWorker = (src) => {
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  return w;
};

/**
 * Runs `code` in a fresh worker. `call(name, args)` executes one tool for the script (it decides what is allowed).
 * The time limit only counts while the script computes: time spent inside tool calls is not charged, so a slow
 * render does not kill a correct script, while a busy loop is stopped.
 */
export function runScript(code, { args = {}, timeoutMs = 10000, maxCalls = 500, call, createWorker = browserWorker } = {}) {
  if (String(code).length > 100_000) return Promise.reject(new Error("The script is larger than 100 KB."));
  const t0 = Date.now();
  const w = createWorker(scriptSource(code, args));
  const calls = [];
  return new Promise((resolve, reject) => {
    let timer = null;
    let open = 0;
    let done = false;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(reject, new Error(`The script computed longer than ${Math.round(timeoutMs / 1000)} s without finishing and was stopped. ${calls.length} tool call(s) had run.`)), timeoutMs);
    };
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      w.terminate();
      fn(v);
    };
    w.onmessage = async (e) => {
      const d = e.data || {};
      if (d.call) {
        if (calls.length >= maxCalls) return w.postMessage({ reply: d.call, error: `The script made more than ${maxCalls} tool calls.` });
        const rec = { name: d.name, ok: false };
        calls.push(rec);
        open++;
        clearTimeout(timer);
        try {
          const result = await call(d.name, d.args);
          rec.ok = true;
          if (!done) w.postMessage({ reply: d.call, result: JSON.parse(JSON.stringify(result ?? null)) });
        } catch (err) {
          rec.error = String(err?.message || err);
          if (!done) w.postMessage({ reply: d.call, error: rec.error });
        } finally {
          if (--open === 0 && !done) arm();
        }
        return;
      }
      if (d.ok) finish(resolve, { result: d.result, logs: d.logs || [], calls, ms: Date.now() - t0 });
      else finish(reject, Object.assign(new Error(`${d.error}${d.logs?.length ? `\nOutput:\n${d.logs.join("\n")}` : ""}`), { calls }));
    };
    w.onerror = (e) => finish(reject, new Error(e?.message || "The script could not run (syntax error?)."));
    arm();
    w.postMessage("run");
  });
}

// ------------------------------------------------------------------ typed API text

/** A JSON-schema fragment as a compact TypeScript-like type. */
export function tsType(s, depth = 0) {
  if (!s || typeof s !== "object") return "any";
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.anyOf || s.oneOf) return [...new Set((s.anyOf || s.oneOf).map((x) => tsType(x, depth + 1)))].join(" | ");
  if (s.type === "array") {
    const inner = tsType(s.items, depth + 1);
    return /[ |]/.test(inner) && !inner.startsWith("{") ? `(${inner})[]` : `${inner}[]`;
  }
  if (s.type === "object") {
    const props = Object.entries(s.properties || {});
    if (!props.length || depth > 2) return "object";
    const req = new Set(s.required || []);
    return `{ ${props.map(([k, v]) => `${k}${req.has(k) ? "" : "?"}: ${tsType(v, depth + 1)}`).join("; ")} }`;
  }
  if (s.type === "integer") return "number";
  return typeof s.type === "string" ? s.type : "any";
}

/** `name(args: {...}): Promise<any>  // first sentence` with one comment line per described parameter when `full`. */
export function tsSignature(t, { full = false } = {}) {
  const head = `${t.name}(args: ${tsType(t.inputSchema)}): Promise<any>`;
  const first = String(t.description || "").split(/(?<=[.!?])\s/)[0].slice(0, 160);
  if (!full) return `${head} // ${first}`;
  const params = Object.entries(t.inputSchema?.properties || {}).filter(([, v]) => v.description).map(([k, v]) => `//   ${k}: ${String(v.description).slice(0, 140)}`);
  return [`// ${String(t.description || "").slice(0, 600)}`, ...params, head].join("\n");
}

/** Ranks tools for a free-text query (name hits first, then description words); `group` filters by UI group. */
export function searchTools(tools, query, { group, groups = {}, limit = 12 } = {}) {
  const groupOf = new Map();
  for (const [g, names] of Object.entries(groups)) for (const n of names) groupOf.set(n, g);
  const words = String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const g = group ? String(group).toLowerCase() : null;
  const scored = [];
  for (const t of tools) {
    const tg = groupOf.get(t.name) || "";
    if (g && !tg.toLowerCase().includes(g)) continue;
    const name = t.name.toLowerCase();
    const text = `${t.description || ""} ${tg}`.toLowerCase();
    let score = words.length ? 0 : 1;
    for (const w of words) {
      if (name === w) score += 12;
      else if (name.split("_").includes(w)) score += 6;
      else if (name.includes(w)) score += 4;
      if (text.includes(w)) score += 1;
    }
    if (score > 0) scored.push({ t, score, group: tg });
  }
  return scored.sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name)).slice(0, limit).map((x) => ({ tool: x.t, group: x.group, score: x.score }));
}

// ------------------------------------------------------------------ compact tool list

/** Groups that are always listed, whatever the user works on. */
export const CORE_GROUPS = ["Documents", "Assistant", "Scripting and checks", "Agents", "Attachments", "Comments"];
const STUDIO_GROUPS = {
  vector: ["Layers and vector", "Power tools", "Design checks and assets"],
  pixel: ["Layers and vector", "Power tools", "Pixel", "Image editing"],
  layout: ["Layers and vector", "Power tools", "Design checks and assets", "Tables and charts", "Color"],
  code: ["Code and websites", "Frameworks, libraries and documents", "Git and publishing"],
  document: ["Office suite", "Office documents"],
  sheet: ["Office suite", "Spreadsheets"],
  slides: ["Office suite", "Presentation"],
  board: ["Office suite", "Whiteboard"],
  scene: ["Scene", "Scene understanding", "Scene automation"],
};

/**
 * Names of the tools to list for the model in the compact mode: the core groups, the groups of what is open
 * (`context`: vector, pixel, layout, code, document, sheet, slides, board, scene) and `extra` names (an active skill's
 * tools). Everything else stays callable through call_tool after find_tools.
 */
export function advertisedTools(groups, context, extra = []) {
  const out = new Set(extra);
  for (const g of [...CORE_GROUPS, ...(STUDIO_GROUPS[context] || STUDIO_GROUPS.vector)]) for (const n of groups[g] || []) out.add(n);
  return out;
}

/** A window of a long text for read_result: by offset, or around the first match of `search`. */
export function pageText(text, { offset = 0, length = 20000, search } = {}) {
  const total = text.length;
  let at = Math.max(0, Math.min(total, Math.floor(offset)));
  let found;
  if (search) {
    const i = text.toLowerCase().indexOf(String(search).toLowerCase(), at);
    found = i >= 0;
    if (found) at = Math.max(0, i - 200);
  }
  const len = Math.max(200, Math.min(60000, Math.floor(length)));
  const part = text.slice(at, at + len);
  return { total, offset: at, length: part.length, ...(search ? { found } : {}), ...(at + part.length < total ? { next: at + part.length } : { end: true }), text: part };
}

// ------------------------------------------------------------------ structural diff

const DIFF_FIELDS = ["type", "name", "x", "y", "w", "h", "fill", "stroke", "text", "opacity", "visible", "locked", "parentId", "fontFamily", "fontSize"];

/** Compares two flat fact lists (tools/power.js pageFacts): which layers were added, removed or changed. */
export function diffFacts(before, after, { max = 60 } = {}) {
  const a = new Map(before.map((f) => [f.id, f]));
  const b = new Map(after.map((f) => [f.id, f]));
  const brief = (f) => ({ id: f.id, type: f.type, name: f.name, ...(f.w != null ? { x: f.x, y: f.y, w: f.w, h: f.h } : {}), ...(f.text ? { text: f.text.slice(0, 60) } : {}) });
  const added = after.filter((f) => !a.has(f.id)).map(brief);
  const removed = before.filter((f) => !b.has(f.id)).map(brief);
  const changed = [];
  for (const f of after) {
    const o = a.get(f.id);
    if (!o) continue;
    const fields = {};
    for (const k of DIFF_FIELDS) if ((o[k] ?? null) !== (f[k] ?? null)) fields[k] = [o[k] ?? null, f[k] ?? null];
    if (Object.keys(fields).length) changed.push({ id: f.id, name: f.name, fields });
  }
  const cut = (l) => (l.length > max ? [...l.slice(0, max), { more: l.length - max }] : l);
  return { added: cut(added), removed: cut(removed), changed: cut(changed), counts: { added: added.length, removed: removed.length, changed: changed.length } };
}

// ------------------------------------------------------------------ measuring

const r1 = (n) => Math.round(n * 10) / 10;

/** Layout facts of boxes [{id, x, y, w, h}]: union, pairwise gaps and overlaps, shared edges and centers. */
export function measure(boxes, { tolerance = 0.5, maxPairs = 60 } = {}) {
  const bs = boxes.filter((b) => b && b.w != null);
  if (!bs.length) return { union: null, gaps: [], overlaps: [], aligned: {} };
  const x0 = Math.min(...bs.map((b) => b.x));
  const y0 = Math.min(...bs.map((b) => b.y));
  const union = { x: r1(x0), y: r1(y0), w: r1(Math.max(...bs.map((b) => b.x + b.w)) - x0), h: r1(Math.max(...bs.map((b) => b.y + b.h)) - y0) };
  const gaps = [];
  const overlaps = [];
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const p = bs[i];
      const q = bs[j];
      const dx = Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w));
      const dy = Math.max(q.y - (p.y + p.h), p.y - (q.y + q.h));
      if (dx < 0 && dy < 0) overlaps.push({ a: p.id, b: q.id, w: r1(-dx), h: r1(-dy), area: r1(dx * dy), contains: -dx >= Math.min(p.w, q.w) - tolerance && -dy >= Math.min(p.h, q.h) - tolerance });
      else if (gaps.length < maxPairs) gaps.push({ a: p.id, b: q.id, ...(dx >= 0 ? { horizontal: r1(dx) } : {}), ...(dy >= 0 ? { vertical: r1(dy) } : {}), centerDistance: r1(Math.hypot(q.x + q.w / 2 - p.x - p.w / 2, q.y + q.h / 2 - p.y - p.h / 2)) });
    }
  }
  const edges = { left: (b) => b.x, centerX: (b) => b.x + b.w / 2, right: (b) => b.x + b.w, top: (b) => b.y, centerY: (b) => b.y + b.h / 2, bottom: (b) => b.y + b.h };
  const aligned = {};
  for (const [k, fn] of Object.entries(edges)) {
    const groups = [];
    for (const b of [...bs].sort((p, q) => fn(p) - fn(q))) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(fn(b) - g.at) <= tolerance) g.ids.push(b.id);
      else groups.push({ at: fn(b), ids: [b.id] });
    }
    const shared = groups.filter((g) => g.ids.length > 1).map((g) => ({ at: r1(g.at), ids: g.ids }));
    if (shared.length) aligned[k] = shared;
  }
  // equal spacing along each axis (three or more boxes, no overlap on that axis)
  const spacing = {};
  for (const [axis, pos, size] of [["x", "x", "w"], ["y", "y", "h"]]) {
    const s = [...bs].sort((p, q) => p[pos] - q[pos]);
    const ds = [];
    for (let i = 1; i < s.length; i++) ds.push(r1(s[i][pos] - s[i - 1][pos] - s[i - 1][size]));
    if (ds.length > 1 && ds.every((d) => d >= 0)) spacing[axis] = { gaps: ds, equal: Math.max(...ds) - Math.min(...ds) <= tolerance * 2 };
  }
  return { union, gaps, overlaps, aligned, spacing };
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ""));
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two #rrggbb colors (1 to 21), or null when one is not a solid color. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return null;
  return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
}

// ------------------------------------------------------------------ pixel diff

/**
 * Compares two RGBA buffers of the same size. A pixel counts as changed when any channel differs by more than
 * `threshold`. Changed pixels are grouped on a grid of `cell` px and neighboring cells merge into regions.
 */
export function diffPixels(a, b, width, height, { threshold = 24, cell = 16, maxRegions = 12 } = {}) {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const grid = new Uint32Array(cols * rows);
  let changed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(a[i] - b[i]) > threshold || Math.abs(a[i + 1] - b[i + 1]) > threshold || Math.abs(a[i + 2] - b[i + 2]) > threshold || Math.abs(a[i + 3] - b[i + 3]) > threshold) {
        changed++;
        grid[Math.floor(y / cell) * cols + Math.floor(x / cell)]++;
      }
    }
  }
  const seen = new Uint8Array(cols * rows);
  const regions = [];
  for (let s = 0; s < grid.length; s++) {
    if (!grid[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let x0 = cols;
    let y0 = rows;
    let x1 = -1;
    let y1 = -1;
    let px = 0;
    while (stack.length) {
      const c = stack.pop();
      const cx = c % cols;
      const cy = (c - cx) / cols;
      px += grid[c];
      x0 = Math.min(x0, cx);
      y0 = Math.min(y0, cy);
      x1 = Math.max(x1, cx);
      y1 = Math.max(y1, cy);
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        const n = ny * cols + nx;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && grid[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    regions.push({ x: x0 * cell, y: y0 * cell, w: Math.min(width, (x1 + 1) * cell) - x0 * cell, h: Math.min(height, (y1 + 1) * cell) - y0 * cell, pixels: px });
  }
  regions.sort((p, q) => q.pixels - p.pixels);
  return { changed, percent: Math.round((changed / Math.max(1, width * height)) * 10000) / 100, regions: regions.slice(0, maxRegions), moreRegions: Math.max(0, regions.length - maxRegions) };
}
