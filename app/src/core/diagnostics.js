// Pure helpers behind the Troubleshooting dialog, the diagnostic report/bundle, "Report an issue" and the Vibe
// diagnostics tools: problem grouping with plain-language hints, the report builder, the GitHub issue URL builder,
// the "what is stored on this device" inventory and browser detection. No DOM, no storage access: callers pass in data.
import { redact, redactValue, groupKey, entriesToText, levelRank } from "./log.js";

export const REPO_URL = "https://github.com/philppplik/open-fini";
export const ISSUE_URL = `${REPO_URL}/issues/new`;

// ------------------------------------------------------------------ hints

const has = (re, e) => re.test(e.msg) || re.test(e.stack || "");

/**
 * Known problems. `test(entry)` decides, the first match wins. `title` is one line, `text` says what it means and what to do.
 * @type {{id:string, title:string, text:string, benign?:boolean, test:(e:object)=>boolean}[]}
 */
export const HINTS = [
  { id: "benign-resize", benign: true, title: "Harmless browser notice", text: "This message is produced by the browser while panels resize. It does not affect your work and can be ignored.", test: (e) => /ResizeObserver loop/i.test(e.msg) },
  { id: "storage-quota", title: "This device's storage is full", text: "OpenFini could not write to browser or app storage, so autosave and recent files may not work. Free space: Settings ▸ Security and privacy ▸ Privacy tools (clear recent files or the autosaved session), save your documents as files, or free disk space. Private windows have very small storage limits.", test: (e) => has(/QuotaExceeded|quota (?:has been )?exceeded|storage (?:is )?full|No space left|disk (?:is )?full/i, e) && !/\b(?:insufficient_quota|exceeded your current quota)\b/i.test(e.msg) },
  { id: "storage-unavailable", title: "Local storage is not available", text: "The browser database (IndexedDB) cannot be used. This happens in private or incognito windows, when site data is blocked, or when the browser profile is damaged. Autosave, recent files and saved keys will not persist. Open OpenFini in a normal window, allow site data, or restart the browser.", test: (e) => has(/IndexedDB|indexedDB|IDBDatabase|IDBTransaction|backing store/i, e) },
  { id: "ai-offline", title: "Blocked by offline mode", text: "Offline mode is on, so network features refuse to run. Turn it off under Settings ▸ Security and privacy if you want to use them.", test: (e) => /Offline mode is on/i.test(e.msg) },
  { id: "ai-auth", title: "The AI provider rejected the API key", text: "The provider answered 401 or 403. Check the key in Vibe Studio ▸ Models: it may be mistyped, expired, revoked, or for another provider or region.", test: (e) => /ai|mcp/.test(e.scope) && /\b40[13]\b|invalid[_ ]api[_ ]key|incorrect api key|unauthorized|authentication|permission denied/i.test(e.msg) },
  { id: "ai-rate", title: "The AI provider is limiting requests or credits", text: "The provider answered 429 or reports no remaining quota. Wait a moment, pick a different model, or check billing and limits in the provider's dashboard.", test: (e) => /\b429\b|rate.?limit|too many requests|insufficient[_ ]quota|exceeded your current quota|credit/i.test(e.msg) && (/ai|mcp|net/.test(e.scope) || /provider|model|api/i.test(e.msg)) },
  { id: "ai-server", title: "The AI provider has a problem", text: "The provider answered with a server error (5xx or overloaded). This is usually temporary: try again, or choose another model or provider.", test: (e) => /ai|mcp|net/.test(e.scope) && /\b5\d\d\b|overloaded|bad gateway|service unavailable|gateway time-?out/i.test(e.msg) },
  { id: "ai-network", title: "The AI provider or server could not be reached", text: "The request never arrived. Check your internet connection, that a local model server (Ollama, LM Studio) is running, and the base URL in Vibe Studio ▸ Models. In a browser, a server must also allow cross-origin requests (CORS). Offline mode and a firewall can also block it.", test: (e) => /ai|mcp|net/.test(e.scope) && /Failed to fetch|NetworkError|Load failed|fetch failed|ECONNREFUSED|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|network request failed/i.test(e.msg) },
  { id: "csp", title: "Blocked by the Content-Security-Policy", text: "The browser refused to load or run something because it breaks the app's security policy. This should not happen in normal use. If it started after you added an extension or a custom tool, remove it; otherwise please report it.", test: (e) => e.scope === "csp" || /Content[- ]Security[- ]Policy|violates the following/i.test(e.msg) },
  { id: "memory", title: "Out of memory", text: "The browser ran out of memory. Close other documents and tabs, turn on Low-power mode (Settings ▸ Canvas and editing), reduce the undo-history memory, or work with smaller images.", test: (e) => has(/out of memory|Array buffer allocation failed|Invalid (?:array|typed array) length|Maximum call stack|allocation failed|Aw, Snap/i, e) },
  { id: "graphics", title: "A graphics problem occurred", text: "The browser's canvas or GPU context failed (for example a lost WebGL context or a canvas that is too large). Reload the app; if it repeats, turn on Low-power mode or update your graphics driver.", test: (e) => has(/WebGL|context lost|canvas (?:is )?too large|Canvas exceeds|Failed to execute 'getImageData'/i, e) },
  { id: "font", title: "A font could not be loaded", text: "A font file failed to download or could not be decoded. OpenFini falls back to another font, so text may look different. Reload to retry, or re-add the font in the Type panel.", test: (e) => /font/i.test(e.msg) && /fail|could not|decode|OTS|network|404|invalid/i.test(e.msg) },
  { id: "chunk-load", title: "Part of the app could not be loaded", text: "A file belonging to OpenFini failed to load, usually because an update was just installed or the connection dropped. Reload the page or restart the app. If it keeps happening: Troubleshooting ▸ Safe mode, then Reset app data.", test: (e) => has(/Failed to load resource|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically imported module|ChunkLoad|Loading chunk/i, e) },
  { id: "service-worker", title: "Offline cache problem", text: "The service worker (the offline copy of the app) failed. Reload once; if it persists, open Troubleshooting ▸ Reset app data and choose to clear the offline cache.", test: (e) => /service ?worker/i.test(e.msg) },
  { id: "extension", title: "An extension had a problem", text: "An extension failed. Disable or remove it in Settings ▸ Extensions. Safe mode starts OpenFini with all extensions turned off.", test: (e) => /^ext/.test(e.scope) || /\bextension\b/i.test(e.msg) },
  { id: "permission", title: "The browser denied a permission", text: "A feature needed a permission (clipboard, file access) that was denied or needs a click first. Try again directly after clicking the button, or allow it in the browser's site settings.", test: (e) => has(/NotAllowedError|Permission denied|clipboard.*(?:denied|not allowed)|SecurityError/i, e) },
  { id: "vault", title: "A passphrase did not work", text: "Decrypting stored data failed: the passphrase is wrong or the data is damaged. Without the passphrase encrypted data cannot be recovered; Settings ▸ Security and privacy lets you reset it.", test: (e) => /vault|passphrase|decrypt|bad_passphrase/i.test(e.msg) },
  { id: "cross-origin", title: "A script from another origin failed", text: "The browser hides the details of errors from other origins (\"Script error.\"). This is often caused by a browser extension or a script in a previewed website, not by OpenFini.", test: (e) => /^Script error\.?$/i.test(e.msg.trim()) },
  { id: "autosave", title: "Autosave did not complete", text: "The recovery copy of your documents could not be written. Save your documents as files (Ctrl+S) to be safe, then check the storage problems listed above.", test: (e) => /Autosave failed/i.test(e.msg) },
];

/** The first matching hint of an entry, or null. */
export function hintFor(entry) {
  for (const h of HINTS) {
    try {
      if (h.test(entry)) return { id: h.id, title: h.title, text: h.text, benign: !!h.benign };
    } catch {
      /* ignore a faulty matcher */
    }
  }
  return null;
}

/**
 * Groups warnings and errors by message and sorts them: errors first, then by count, then by recency.
 * @param {object[]} entries log entries (see log.js)
 * @param {{minLevel?:string, includeBenign?:boolean, limit?:number}} [o]
 */
export function groupProblems(entries, { minLevel = "warn", includeBenign = false, limit = 50 } = {}) {
  const min = levelRank(minLevel);
  const groups = new Map();
  for (const e of entries) {
    if (levelRank(e.level) < min) continue;
    const key = `${e.level}|${e.scope}|${groupKey(e.msg)}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, level: e.level, scope: e.scope, msg: e.msg, count: 0, first: e.t, last: e.last || e.t, stack: e.stack, previous: !!e.prev, hint: hintFor(e) };
      groups.set(key, g);
    }
    g.count += e.count || 1;
    g.first = Math.min(g.first, e.t);
    g.last = Math.max(g.last, e.last || e.t);
    g.previous = g.previous && !!e.prev;
    if (!g.stack && e.stack) g.stack = e.stack;
  }
  let list = [...groups.values()];
  if (!includeBenign) list = list.filter((g) => !g.hint?.benign);
  list.sort((a, b) => levelRank(b.level) - levelRank(a.level) || b.count - a.count || b.last - a.last);
  return list.slice(0, limit);
}

/** A few lines about the newest problems (for the Vibe tools and the issue body). */
export function problemSummary(problems, max = 5) {
  if (!problems.length) return "No warnings or errors were logged.";
  return problems.slice(0, max).map((p) => `- [${p.level}] [${p.scope}] ${p.msg.slice(0, 200)}${p.count > 1 ? ` (x${p.count})` : ""}${p.hint ? ` — ${p.hint.title}` : ""}`).join("\n");
}

// ------------------------------------------------------------------ browser / platform

/**
 * Identifies browser, engine and (for the desktop app) the web view from a user-agent string.
 * @param {string} ua
 * @param {{isDesktop?:boolean, os?:string}} [o]
 */
export function browserInfo(ua = "", { isDesktop = false, os = "" } = {}) {
  const m = (re) => (re.exec(ua) || [])[1] || "";
  let name = "Unknown";
  let version = "";
  if (/Edg\//.test(ua)) [name, version] = ["Edge", m(/Edg\/([\d.]+)/)];
  else if (/OPR\//.test(ua)) [name, version] = ["Opera", m(/OPR\/([\d.]+)/)];
  else if (/Firefox\//.test(ua)) [name, version] = ["Firefox", m(/Firefox\/([\d.]+)/)];
  else if (/Chrome\//.test(ua)) [name, version] = ["Chrome", m(/Chrome\/([\d.]+)/)];
  else if (/Version\/[\d.]+.*Safari\//.test(ua)) [name, version] = ["Safari", m(/Version\/([\d.]+)/)];
  const engine = /Firefox\//.test(ua) ? "Gecko" : /AppleWebKit\//.test(ua) ? (/Chrome\//.test(ua) ? "Blink" : "WebKit") : "Unknown";
  let webview = null;
  if (isDesktop) webview = os === "windows" ? `WebView2 (${name} ${version})` : os === "macos" ? "WKWebView (WebKit)" : os === "linux" ? "WebKitGTK" : `${name} ${version}`;
  return { name, version, engine, webview };
}

// ------------------------------------------------------------------ report

function flatten(obj, prefix = "", out = []) {
  if (obj == null) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.push(`${key}: ${Array.isArray(v) ? (v.length ? v.join(", ") : "none") : v === undefined || v === null ? "unknown" : v}`);
  }
  return out;
}

/** Environment object → `key: value` lines (secrets and personal data redacted). */
export function environmentLines(env) {
  return flatten(redactValue(env)).map((l) => redact(l));
}

/** One-line summary: "OpenFini 0.3.0 (build abc) · Windows desktop · WebView2 …". */
export function environmentSummary(env = {}) {
  const a = env.app || {};
  const p = env.platform || {};
  const build = String(a.buildId || "").split("-").pop();
  return redact([`OpenFini ${a.version || "?"}${build && build !== a.version ? ` (build ${build})` : ""}`, a.mode, p.os, p.webview || (p.browser ? `${p.browser.name} ${p.browser.version}` : ""), a.safeMode ? "safe mode" : ""].filter(Boolean).join(" · "));
}

/**
 * The text of the diagnostic report. Contains no documents, keys or file names: logs and environment only, redacted.
 * @param {{env?:object, entries?:object[], problems?:object[], security?:object[], generatedAt?:number, maxEntries?:number}} o
 */
export function buildReport({ env = {}, entries = [], problems, security, generatedAt = Date.now(), maxEntries = 200 } = {}) {
  const probs = problems || groupProblems(entries);
  const lines = [];
  lines.push("# OpenFini diagnostic report", "", `Generated: ${new Date(generatedAt).toISOString()}`, `Summary: ${environmentSummary(env)}`, "");
  lines.push("This report contains technical information only: no documents, API keys or file names. Secrets and your user name in file paths are removed automatically. Review it before sharing.", "");
  lines.push("## Problems", "");
  if (!probs.length) lines.push("No warnings or errors were logged.");
  for (const p of probs.slice(0, 25)) {
    lines.push(`- [${p.level}] [${p.scope}] ${p.msg.slice(0, 300)}${p.count > 1 ? ` (x${p.count})` : ""}${p.previous ? " (previous session)" : ""}`);
    if (p.hint) lines.push(`  hint: ${p.hint.title}`);
  }
  if (security?.length) {
    lines.push("", "## Security overview", "");
    for (const c of security) lines.push(`- [${c.level}] ${c.label}: ${c.detail}`);
  }
  lines.push("", "## Environment", "", ...environmentLines(env));
  const recent = entries.slice(-maxEntries);
  lines.push("", `## Recent log (${recent.length} of ${entries.length} entries)`, "", recent.length ? entriesToText(recent) : "The log is empty.", "");
  return redact(lines.join("\n"));
}

/**
 * Files of the diagnostic bundle (ZIP/JSON). Never contains documents, keys or file names.
 * @returns {{[name:string]: string}}
 */
export function buildBundleFiles({ env = {}, entries = [], inventory, security, generatedAt = Date.now() } = {}) {
  const problems = groupProblems(entries);
  const clean = redactValue(env);
  const files = {
    "README.txt": [
      "OpenFini diagnostic bundle",
      `Created: ${new Date(generatedAt).toISOString()}`,
      "",
      "report.txt        human-readable summary, problems, environment and recent log",
      "environment.json  environment and settings (secrets removed)",
      "log.json          the redacted log entries",
      "log.txt           the same entries as text",
      inventory ? "storage.json      keys and sizes of what OpenFini stores on this device (no values)" : "",
      "",
      "Documents, API keys, chat contents and file names are never included. Secrets and your user name in file paths",
      "are removed automatically, but please skim the files before sending them to anyone.",
    ].filter((l) => l !== "").join("\n"),
    "report.txt": buildReport({ env, entries, problems, security, generatedAt }),
    "environment.json": JSON.stringify(clean, null, 2),
    "log.json": JSON.stringify({ generatedAt: new Date(generatedAt).toISOString(), entries: entries.map((e) => ({ time: new Date(e.t).toISOString(), level: e.level, scope: e.scope, message: redact(e.msg), count: e.count, ...(e.stack ? { stack: redact(e.stack) } : {}), ...(e.prev ? { previousSession: true } : {}) })), problems: problems.map((p) => ({ level: p.level, scope: p.scope, message: redact(p.msg), count: p.count, hint: p.hint?.title || null })) }, null, 2),
    "log.txt": redact(entriesToText(entries)),
  };
  if (inventory) files["storage.json"] = JSON.stringify(inventory, null, 2);
  return files;
}

// ------------------------------------------------------------------ GitHub issue

const EDITION = { desktop: "Desktop app (installer)", pwa: "Installed PWA", browser: "In the browser" };

/**
 * Builds the "new issue" URL for the bug report form, prefilled with redacted environment data and the newest errors,
 * and kept below `maxLength` characters (GitHub rejects very long URLs) by dropping the oldest log lines.
 * @param {{env?:object, entries?:object[], title?:string, note?:string, includeLog?:boolean, maxLength?:number, base?:string}} o
 * @returns {{url:string, title:string, fields:Record<string,string>, length:number, truncated:boolean}}
 */
export function buildIssueUrl({ env = {}, entries = [], title = "", note = "", includeLog = true, maxLength = 7000, base = ISSUE_URL } = {}) {
  const a = env.app || {};
  const p = env.platform || {};
  const problems = groupProblems(entries, { minLevel: "error" });
  const fields = {
    template: "bug_report.yml",
    title: `[Bug]: ${redact(title).trim().slice(0, 120)}`.trimEnd(),
    version: `${a.version || ""}${a.buildId ? ` (${a.buildId})` : ""}`,
    edition: EDITION[a.mode] || "",
  };
  if (a.mode !== "desktop" && p.browser?.name) fields.browser = `${p.browser.name} ${p.browser.version}`.trim();
  if (p.os === "macos") fields.os = "macOS";
  else if (p.os === "linux") fields.os = "Linux";
  const what = [note ? redact(note).slice(0, 600) : "", problems.length ? `Recent errors:\n${problemSummary(problems, 3)}` : ""].filter(Boolean).join("\n\n");
  if (what) fields["what-happened"] = what;
  const header = `Environment: ${environmentSummary(env)}\nSafe mode: ${a.safeMode ? "yes" : "no"} · Offline mode: ${a.offlineMode ? "on" : "off"} · Low-power: ${env.perf?.low ? "yes" : "no"}\n`;
  const logEntries = entries.filter((e) => levelRank(e.level) >= levelRank("warn")).slice(-40);
  let logLines = includeLog ? entriesToText(logEntries, { stack: false }).split("\n").filter(Boolean) : [];
  let truncated = false;
  const compose = () => {
    const f = { ...fields, logs: redact(`${header}${logLines.length ? `\n${logLines.join("\n")}` : ""}`) };
    const q = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return { f, url: `${base}?${q}` };
  };
  let out = compose();
  while (out.url.length > maxLength && logLines.length) {
    logLines = logLines.slice(Math.ceil(logLines.length / 4));
    truncated = true;
    out = compose();
  }
  if (out.url.length > maxLength && fields["what-happened"]) {
    delete fields["what-happened"];
    truncated = true;
    out = compose();
  }
  if (out.url.length > maxLength) {
    // the environment header alone is too long: keep only the version
    out = { f: { ...fields, logs: "" }, url: `${base}?template=bug_report.yml&title=${encodeURIComponent(fields.title)}&version=${encodeURIComponent(fields.version)}` };
    truncated = true;
  }
  return { url: out.url, title: fields.title, fields: out.f, length: out.url.length, truncated };
}

// ------------------------------------------------------------------ storage inventory

/** What a stored key is for. `kind` is "kv" (IndexedDB) or "local" (localStorage). */
export function describeKey(key, kind = "kv") {
  const k = String(key);
  if (kind === "local") {
    if (k === "openfini.prefs.v1") return { label: "Settings", category: "Settings", sensitive: false };
    if (k === "openfini.boot") return { label: "Start-up check (crash-loop guard)", category: "Diagnostics", sensitive: false };
    if (k === "openfini.lock") return { label: "App lock flag", category: "Security", sensitive: false };
    return { label: "Other setting", category: "Other", sensitive: false };
  }
  if (k === "session") return { label: "Autosaved session (your open documents)", category: "Documents", sensitive: true, clear: "autosave" };
  if (k === "recents") return { label: "Recent files list", category: "Documents", sensitive: true, clear: "recents" };
  if (k.startsWith("recent:")) return { label: "Stored copy of a recent file", category: "Documents", sensitive: true, clear: "recents" };
  if (k === "fonts") return { label: "Fonts you added", category: "Fonts", sensitive: false, clear: "fonts" };
  if (k === "ui.glassImage") return { label: "Your glass background image (stays on this device, never exported)", category: "Appearance", sensitive: false };
  if (k === "applock") return { label: "App lock record (salt and check value, no passphrase)", category: "Security", sensitive: false };
  if (k === "diag.errors") return { label: "Errors of earlier sessions (redacted)", category: "Diagnostics", sensitive: false, clear: "logs" };
  if (k === "vibe.secrets") return { label: "AI provider API keys", category: "AI", sensitive: true, clear: "ai" };
  if (k === "vibe.providers") return { label: "AI provider connections (no keys)", category: "AI", sensitive: false, clear: "ai" };
  if (k === "vibe.chats" || k.startsWith("vibe.chat.")) return { label: "Vibe chats", category: "AI", sensitive: true, clear: "ai" };
  if (k === "vibe.memory") return { label: "Vibe memory notes", category: "AI", sensitive: true, clear: "ai" };
  if (k === "vibe.knowledge") return { label: "Vibe knowledge index", category: "AI", sensitive: true, clear: "ai" };
  if (k.startsWith("vibe.")) return { label: "Vibe settings, skills, tools or MCP servers", category: "AI", sensitive: false, clear: "ai" };
  if (k.startsWith("ext:data:")) return { label: "Data saved by an extension", category: "Extensions", sensitive: false, clear: "extensions" };
  if (k.startsWith("ext:")) return { label: "Installed extension (code and permissions)", category: "Extensions", sensitive: false };
  return { label: "Other data", category: "Other", sensitive: false };
}

/** Names that would reveal file names are hidden in the inventory. */
function publicKey(key, i) {
  return key.startsWith("recent:") ? `recent:<file ${i + 1}>` : redact(key);
}

/**
 * The "what OpenFini stores on this device" inventory: keys, descriptions and sizes, never values.
 * @param {{kv?:{key:string, bytes:number}[], local?:{key:string, bytes:number}[], caches?:{name:string, entries?:number}[], databases?:string[], estimate?:{usage?:number, quota?:number}, generatedAt?:number, serviceWorkers?:number}} o
 */
export function buildInventory({ kv = [], local = [], caches = [], databases = [], estimate = {}, serviceWorkers = 0, generatedAt = Date.now() } = {}) {
  let n = 0;
  const kvItems = kv.map((x) => ({ key: publicKey(String(x.key), n++), bytes: Math.max(0, Math.round(x.bytes || 0)), ...describeKey(x.key, "kv") })).sort((a, b) => b.bytes - a.bytes);
  const localItems = local.map((x) => ({ key: redact(String(x.key)), bytes: Math.max(0, Math.round(x.bytes || 0)), ...describeKey(x.key, "local") }));
  const byCategory = {};
  for (const i of [...kvItems, ...localItems]) byCategory[i.category] = (byCategory[i.category] || 0) + i.bytes;
  return {
    format: "openfini-storage-inventory",
    version: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    note: "Keys, descriptions and approximate sizes only. No values, document contents, file names or keys are included.",
    totals: { kvBytes: kvItems.reduce((s, i) => s + i.bytes, 0), localStorageBytes: localItems.reduce((s, i) => s + i.bytes, 0), usage: estimate.usage ?? null, quota: estimate.quota ?? null, byCategory },
    indexedDb: { databases: databases.map(redact), keys: kvItems },
    localStorage: { keys: localItems },
    caches: caches.map((c) => ({ name: redact(c.name), entries: c.entries ?? null })),
    serviceWorkers,
  };
}

/** Human readable inventory for display. */
export function inventoryText(inv) {
  const fmt = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const lines = ["What OpenFini stores on this device", ""];
  for (const i of inv.indexedDb.keys) lines.push(`${i.category.padEnd(12)} ${fmt(i.bytes).padStart(9)}  ${i.label}${i.sensitive ? " (private)" : ""}  [${i.key}]`);
  for (const i of inv.localStorage.keys) lines.push(`${i.category.padEnd(12)} ${fmt(i.bytes).padStart(9)}  ${i.label}  [${i.key}]`);
  for (const c of inv.caches) lines.push(`Offline cache ${c.entries != null ? `${c.entries} files` : ""}  [${c.name}]`);
  return lines.join("\n");
}
