// Help ▸ Troubleshooting…: live log viewer, grouped problems with hints, environment, and the tools to report a bug
// (copy report, save bundle, issue on GitHub, safe mode, reset). Loaded on demand. Everything shown or exported is redacted.
import { h, empty, formatBytes, downloadName } from "../core/util.js";
import { log, formatTime, entriesToText, redact, redactValue, LEVELS } from "../core/log.js";
import { groupProblems, buildReport, buildBundleFiles, buildIssueUrl } from "../core/diagnostics.js";
import { collectEnvironment, collectInventory, securityOverview } from "../core/env.js";
import { safeModeUrl } from "../core/bootguard.js";
import { openDialog, confirmDialog } from "./dialogs.js";
import { platform } from "../platform/index.js";
import { openLink } from "./links.js";

const MAX_ROWS = 500;

// ------------------------------------------------------------------ helpers

async function writeFile(app, name, content, mime, filterName, ext) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const res = await platform.saveFile({ suggestedName: name, bytes, mime, filters: [{ name: filterName, extensions: [ext] }] });
  if (res) app.toast(`Saved ${res.name}`, "success", 2000);
  return res;
}

async function copyText(app, text, what) {
  try {
    await navigator.clipboard.writeText(text);
    app.toast(`${what} copied.`, "success", 1800);
  } catch {
    app.toast("Copying is not allowed here. Use Save instead.", "warning", 3500);
  }
}

/** The full redacted report text (environment, problems, security overview, log). */
export async function reportText(app) {
  const [env, sec] = await Promise.all([collectEnvironment(app), securityOverview(app).catch(() => null)]);
  return buildReport({ env, entries: log.entries(), security: sec?.checks });
}

export async function copyReport(app) {
  await copyText(app, await reportText(app), "Diagnostic report");
}

/** Saves a ZIP with report, environment and redacted logs. Never contains documents, keys or file names. */
export async function saveBundle(app, format = "zip") {
  const [env, inventory, sec] = await Promise.all([collectEnvironment(app), collectInventory().catch(() => null), securityOverview(app).catch(() => null)]);
  const files = buildBundleFiles({ env, entries: log.entries(), inventory, security: sec?.checks });
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "json") return writeFile(app, `openfini-diagnostics-${stamp}.json`, JSON.stringify({ format: "openfini-diagnostic-bundle", files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, k.endsWith(".json") ? JSON.parse(v) : v])) }, null, 2), "application/json", "JSON", "json");
  const { zipSync, strToU8 } = await import("../../vendor/fflate/fflate.js");
  const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
  return writeFile(app, `openfini-diagnostics-${stamp}.zip`, bytes, "application/zip", "ZIP archive", "zip");
}

/** Restarts in safe mode (web: reload with ?safe=1; desktop: the same URL inside the web view). */
export function restartInSafeMode() {
  location.assign(safeModeUrl(location.pathname));
}

// ------------------------------------------------------------------ report an issue

/** Shows what would be sent, then opens the prefilled GitHub bug report form. */
export async function reportIssueDialog(app) {
  const env = await collectEnvironment(app);
  const entries = log.entries();
  const state = { title: "", note: "", includeLog: true };
  const title = h("sl-input", { label: "Short title", placeholder: "What went wrong?", size: "small" });
  const note = h("sl-textarea", { label: "What happened? (optional)", rows: 3, size: "small", resize: "vertical" });
  const include = h("sl-checkbox", { checked: true }, "Include recent warnings and errors (redacted)");
  const preview = h("pre.of-diag__preview", { tabindex: 0, "aria-label": "Text that will be prefilled on GitHub" });
  const stats = h("p.of-hint");
  const refresh = () => {
    state.title = title.value || "";
    state.note = note.value || "";
    state.includeLog = include.checked;
    const r = buildIssueUrl({ env, entries, title: state.title, note: state.note, includeLog: state.includeLog });
    const q = new URL(r.url).searchParams;
    preview.textContent = ["Title: " + r.title, "Version: " + q.get("version"), "Edition: " + (q.get("edition") || "—"), q.get("browser") ? "Browser: " + q.get("browser") : "", q.get("os") ? "OS: " + q.get("os") : "", "", q.get("what-happened") || "", "", q.get("logs") || ""].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
    stats.textContent = `${r.length.toLocaleString("en-US")} of 7,000 characters${r.truncated ? " — older log lines were left out to fit" : ""}. Nothing is sent until you submit the form on GitHub.`;
    return r;
  };
  for (const el of [title, note]) el.addEventListener("sl-input", refresh);
  include.addEventListener("sl-change", refresh);
  refresh();
  openDialog({
    title: "Report an issue",
    width: 640,
    cls: "of-dlg-640",
    body: h("div.of-diag__form", h("p", "OpenFini will open a prefilled bug report on GitHub in your browser. This is exactly what will be filled in. It contains no documents, API keys or file names; secrets and your user name in paths are removed. You can edit everything on GitHub before submitting."), title, note, include, h("label.of-diag__lbl", "Prefilled text"), preview, stats),
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      { label: "Copy full report", onClick: () => copyReport(app) },
      {
        label: "Open GitHub issue",
        variant: "primary",
        onClick: async (close) => {
          const r = refresh();
          if (await openLink(r.url, { app, confirmed: true })) close();
        },
      },
    ],
  });
}

// ------------------------------------------------------------------ reset guidance

export function resetAppDataDialog(app) {
  const clearKeys = h("sl-checkbox", { checked: true }, "Settings and start-up state");
  const clearStore = h("sl-checkbox", { checked: true }, "Autosaved session, recent files and added fonts");
  const clearAi = h("sl-checkbox", { checked: false }, "AI data: chats, connections and stored API keys");
  const clearCache = h("sl-checkbox", { checked: true }, "Offline cache and service worker (the app is downloaded again)");
  openDialog({
    title: "Reset app data",
    width: 540,
    cls: "of-dlg-540",
    body: h("div.of-diag__form",
      h("p", "Use this when OpenFini misbehaves after an update or does not start. Your documents that you saved as files are never touched. Work that only exists in the autosaved session is lost, so save open documents first (Ctrl+S)."),
      h("p.of-hint", "Try Safe mode first: it starts without your session, extensions and AI and changes nothing."),
      h("div.of-diag__checks", clearKeys, clearStore, clearAi, clearCache),
      h("p.of-hint", "For everything at once (including a typed confirmation), use Settings ▸ Security and privacy ▸ Delete all local data."),
    ),
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      { label: "Restart in safe mode", onClick: () => restartInSafeMode() },
      {
        label: "Reset selected",
        variant: "danger",
        onClick: async (close) => {
          if (!(await confirmDialog({ title: "Reset app data", message: "Delete the selected data on this device and reload OpenFini?", ok: "Reset and reload", danger: true }))) return;
          const { resetLocalData } = await import("./security-center.js");
          await resetLocalData(app, { settings: clearKeys.checked, store: clearStore.checked, ai: clearAi.checked, cache: clearCache.checked });
          close();
        },
      },
    ],
  });
}

// ------------------------------------------------------------------ the dialog

const fmtVal = (k, v) => {
  if (v == null) return "unknown";
  if (/Bytes$/.test(k) && typeof v === "number") return formatBytes(v);
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

/**
 * Opens the Troubleshooting dialog.
 * @param {object} app
 * @param {"log"|"problems"|"environment"|"actions"} [tab]
 */
export function troubleshootingDialog(app, tab = "log") {
  const filter = { level: "info", scope: "all", search: "" };
  let paused = false;
  let frozen = null; // entries at the moment of pausing
  let current = ["log", "problems", "environment", "actions"].includes(tab) ? tab : "log";
  log.markSeen();

  const tabs = h("div.of-diag__tabs", { role: "tablist", "aria-label": "Troubleshooting sections" });
  const panel = h("div.of-diag__panel", { role: "tabpanel", tabindex: -1 });
  const TABS = [["log", "Log"], ["problems", "Problems"], ["environment", "Environment"], ["actions", "Actions"]];
  const tabBtns = new Map();
  for (const [id, label] of TABS) {
    const b = h("button.of-diag__tab", { type: "button", role: "tab", id: `of-diag-tab-${id}`, "aria-controls": "of-diag-panel" }, label);
    b.addEventListener("click", () => show(id));
    b.addEventListener("keydown", (e) => {
      const i = TABS.findIndex(([x]) => x === current);
      const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : null;
      if (next) {
        e.preventDefault();
        show(next[0]);
        tabBtns.get(next[0]).focus();
      }
    });
    tabBtns.set(id, b);
    tabs.append(b);
  }
  panel.id = "of-diag-panel";

  let redraw = () => {};
  let rafId = 0;
  const unsub = log.subscribe(() => {
    if (current === "log" && paused) return;
    if (current === "environment" || current === "actions") return;
    if (!rafId) rafId = requestAnimationFrame(() => ((rafId = 0), redraw()));
  });

  function show(id) {
    current = id;
    for (const [k, b] of tabBtns) {
      b.setAttribute("aria-selected", String(k === id));
      b.tabIndex = k === id ? 0 : -1;
      b.classList.toggle("active", k === id);
    }
    panel.setAttribute("aria-labelledby", `of-diag-tab-${id}`);
    empty(panel);
    ({ log: renderLog, problems: renderProblems, environment: renderEnvironment, actions: renderActions })[id]();
  }

  // ---- log tab
  function renderLog() {
    const level = h("select", { "aria-label": "Minimum level" }, [["debug", "All levels"], ["info", "Info and above"], ["warn", "Warnings and errors"], ["error", "Errors only"]].map(([v, t]) => h("option", { value: v, selected: v === filter.level }, t)));
    const scope = h("select", { "aria-label": "Scope" });
    const fillScopes = () => {
      const cur = filter.scope;
      empty(scope);
      scope.append(h("option", { value: "all" }, "All scopes"), ...log.scopes().map((s) => h("option", { value: s, selected: s === cur }, s)));
    };
    fillScopes();
    const search = h("input", { type: "search", placeholder: "Search the log", "aria-label": "Search the log", value: filter.search, spellcheck: false });
    const pause = h("button.of-btn", { type: "button", "aria-pressed": String(paused) }, paused ? "Resume" : "Pause");
    const clear = h("button.of-btn", { type: "button" }, "Clear");
    const copy = h("button.of-btn", { type: "button" }, "Copy");
    const saveTxt = h("button.of-btn", { type: "button" }, "Save .txt");
    const saveJson = h("button.of-btn", { type: "button" }, "Save .json");
    const list = h("div.of-diag__log", { role: "log", "aria-live": "off", tabindex: 0, "aria-label": "Log entries" });
    const count = h("span.of-diag__count", { role: "status" });
    const visible = () => (paused && frozen ? frozen : log.entries({ level: filter.level, scope: filter.scope, search: filter.search })).filter((e) => !(paused && frozen) || matches(e));
    const matches = (e) => {
      const rank = (l) => LEVELS.indexOf(l);
      return rank(e.level) >= rank(filter.level) && (filter.scope === "all" || e.scope === filter.scope) && (!filter.search || `${e.msg} ${e.scope}`.toLowerCase().includes(filter.search.toLowerCase()));
    };
    redraw = () => {
      const all = visible();
      const shown = all.slice(-MAX_ROWS);
      const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 24;
      empty(list);
      if (!shown.length) list.append(h("p.of-diag__empty", log.buffer.length ? "No entries match the filter." : "Nothing has been logged yet. Warnings and errors will appear here as they happen."));
      for (const e of shown) {
        list.append(h(`div.of-diag__row.lv-${e.level}`, h("span.of-diag__t", formatTime(e.t)), h("span.of-diag__lv", e.level), h("span.of-diag__sc", e.scope), h("span.of-diag__msg", e.msg, e.count > 1 ? h("b.of-diag__x", ` ×${e.count}`) : null, e.prev ? h("i.of-diag__prev", " (previous session)") : null, e.stack ? h("pre.of-diag__stack", e.stack) : null)));
      }
      count.textContent = `${shown.length === all.length ? all.length : `${shown.length} of ${all.length}`} entr${all.length === 1 ? "y" : "ies"}${paused ? " · paused" : ""}`;
      if (atEnd) list.scrollTop = list.scrollHeight;
    };
    level.addEventListener("change", () => ((filter.level = level.value), redraw()));
    scope.addEventListener("change", () => ((filter.scope = scope.value), redraw()));
    search.addEventListener("input", () => ((filter.search = search.value), redraw()));
    search.addEventListener("keydown", (e) => e.stopPropagation());
    pause.addEventListener("click", () => {
      paused = !paused;
      frozen = paused ? log.entries({ level: "debug" }) : null;
      pause.textContent = paused ? "Resume" : "Pause";
      pause.setAttribute("aria-pressed", String(paused));
      fillScopes();
      redraw();
    });
    clear.addEventListener("click", () => {
      log.clear();
      frozen = paused ? [] : null;
      fillScopes();
      redraw();
    });
    copy.addEventListener("click", () => copyText(app, redact(entriesToText(visible())), "Log"));
    saveTxt.addEventListener("click", () => writeFile(app, downloadName("openfini-log", "txt"), redact(entriesToText(visible())), "text/plain", "Text", "txt"));
    saveJson.addEventListener("click", () => writeFile(app, downloadName("openfini-log", "json"), JSON.stringify(redactValue(visible().map((e) => ({ time: new Date(e.t).toISOString(), level: e.level, scope: e.scope, message: e.msg, count: e.count, stack: e.stack }))), null, 2), "application/json", "JSON", "json"));
    panel.append(h("div.of-diag__bar", level, scope, search, pause, clear, copy, saveTxt, saveJson), list, h("div.of-diag__foot", count, h("span.of-hint", "Secrets, tokens and your user name in paths are removed before anything is recorded.")));
    redraw();
  }

  // ---- problems tab
  function renderProblems() {
    const draw = () => {
      empty(panel);
      const probs = groupProblems(log.entries({ previous: true }));
      redraw = draw;
      if (!probs.length) {
        panel.append(h("div.of-diag__none", h("sl-icon", { name: "check2-circle" }), h("p", "No problems recorded."), h("p.of-hint", "Warnings and errors from this and the previous session are grouped here with an explanation when the cause is known.")));
        return;
      }
      panel.append(h("p.of-hint", `${probs.length} kind${probs.length === 1 ? "" : "s"} of problem, most serious first.`));
      for (const p of probs) {
        const show = h("button.of-btn", { type: "button" }, "Show in log");
        show.addEventListener("click", () => {
          filter.search = p.msg.slice(0, 40);
          filter.level = "debug";
          filter.scope = "all";
          paused = false;
          frozen = null;
          showTab("log");
        });
        const copy = h("button.of-btn", { type: "button" }, "Copy");
        copy.addEventListener("click", () => copyText(app, redact(`[${p.level}] [${p.scope}] ${p.msg}${p.stack ? `\n${p.stack}` : ""}`), "Problem"));
        const actions = [show, copy];
        if (app.prefs.aiEnabled && app.aiQuick?.runQuickAction) {
          const ex = h("button.of-btn", { type: "button", title: "Sends this redacted message (not your documents) to your AI provider" }, "Explain with Vibe");
          ex.addEventListener("click", () => app.aiQuick.runQuickAction(app, { label: "Explain this error", mode: "answer", prompt: `Explain this OpenFini error in plain language and tell me what I can do about it. Do not change the document.\n\nScope: ${p.scope}\nMessage: ${redact(p.msg)}${p.stack ? `\nStack:\n${redact(p.stack)}` : ""}${p.hint ? `\nKnown cause: ${p.hint.title}` : ""}` }));
          actions.push(ex);
        }
        panel.append(h(`article.of-diag__prob.lv-${p.level}`,
          h("header", h("span.of-diag__badge", p.level), h("span.of-diag__sc", p.scope), h("strong", p.msg.length > 220 ? `${p.msg.slice(0, 220)}…` : p.msg)),
          h("p.of-hint", `${p.count} time${p.count === 1 ? "" : "s"} · last ${formatTime(p.last)}${p.previous ? " · previous session" : ""}`),
          p.hint ? h("div.of-diag__hint", h("strong", p.hint.title), h("p", p.hint.text)) : h("p.of-hint", "No known explanation yet. “Report an issue” helps us add one."),
          h("div.of-diag__acts", actions)));
      }
    };
    draw();
  }

  // ---- environment tab
  async function renderEnvironment() {
    panel.append(h("p.of-hint", "Collecting…"));
    const env = await collectEnvironment(app);
    if (current !== "environment") return;
    empty(panel);
    const clean = redactValue(env);
    const sections = Object.entries(clean).map(([name, obj]) => h("details.of-diag__sec", { open: name !== "prefs" },
      h("summary", name === "app" ? "Application" : name[0].toUpperCase() + name.slice(1).replace(/([A-Z])/g, " $1")),
      h("dl", ...Object.entries(obj).flatMap(([k, v]) => [h("dt", k), h("dd", fmtVal(k, v))]))));
    const used = env.storage.usageBytes;
    const quota = env.storage.quotaBytes;
    if (used != null && quota) sections.unshift(h("div.of-diag__quota", h("span", `Storage: ${formatBytes(used)} of ${formatBytes(quota)} (${((used / quota) * 100).toFixed(1)}%)`), h("progress", { max: quota, value: used, "aria-label": "Storage used" })));
    const copy = h("button.of-btn", { type: "button" }, "Copy environment");
    copy.addEventListener("click", () => copyText(app, JSON.stringify(clean, null, 2), "Environment"));
    panel.append(h("div.of-diag__bar", copy), ...sections);
  }

  // ---- actions tab
  function renderActions() {
    const act = (title, text, label, run, { danger = false, primary = false } = {}) => {
      const b = h("button.of-btn", { type: "button", class: danger ? "of-btn--danger" : primary ? "of-btn--primary" : "" }, label);
      b.addEventListener("click", run);
      return h("div.of-diag__act", h("div", h("strong", title), h("p.of-hint", text)), b);
    };
    const verbose = h("sl-switch", { size: "small", "aria-label": "Verbose logging" });
    verbose.checked = !!app.prefs.verboseLogging;
    verbose.addEventListener("sl-change", () => app.setPref("verboseLogging", verbose.checked));
    panel.append(
      act("Copy diagnostic report", "Environment, problems and the recent log as text, with secrets removed. Paste it into a bug report.", "Copy report", () => copyReport(app), { primary: true }),
      act("Save diagnostic bundle", "A ZIP with the report, environment, redacted logs and a list of what is stored on this device. Never contains documents, API keys or chats.", "Save .zip", () => saveBundle(app, "zip")),
      act("Save as JSON", "The same bundle as a single JSON file.", "Save .json", () => saveBundle(app, "json")),
      act("Report an issue on GitHub", "Opens a prefilled bug report after showing you exactly what it contains.", "Report…", () => reportIssueDialog(app)),
      act("Restart in safe mode", "Starts without restoring your session, with extensions and AI off, and without applying saved settings. Nothing is deleted.", "Restart in safe mode", async () => {
        if (app.docs.some((d) => !d.saved) && !(await confirmDialog({ title: "Restart in safe mode", message: "Unsaved changes stay in the autosaved copy on this device but will not be restored in safe mode. Restart now?", ok: "Restart" }))) return;
        if (app.prefs.autosave) await app.autosaveNow?.();
        restartInSafeMode();
      }),
      act("Reset app data", "Clears settings, the autosaved session, recent files or the offline cache when nothing else helps. Guidance and options inside.", "Reset…", () => resetAppDataDialog(app), { danger: true }),
      h("div.of-diag__act", h("div", h("strong", "Verbose logging"), h("p.of-hint", "Also record debug-level messages. Useful when you were asked to reproduce a problem. Slightly more memory.")), verbose),
    );
  }

  function showTab(id) {
    show(id);
    tabBtns.get(id)?.focus();
  }

  show(current);
  const { dlg } = openDialog({
    title: "Troubleshooting",
    width: 940,
    cls: "of-diagnostics",
    body: h("div.of-diag", tabs, panel),
    buttons: [{ label: "Close", variant: "primary", onClick: (c) => c() }],
    onClose: () => {
      unsub();
      cancelAnimationFrame(rafId);
      log.markSeen();
    },
  });
  void dlg;
}
