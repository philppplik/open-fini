// App Doctor (docs/doctor.md ▸ App checks): turns a plain status object, collected by ui/doctor-dialog.js, into a list
// of findings with a level, a plain-language explanation and, where possible, a fix the dialog can run. Pure and
// testable (tests/core/doctor-env.test.js); the same shape as core/security.js ▸ evaluateSecurity.
//
// status = {
//   storage:   { usage, quota, persisted, persistSupported },              bytes; undefined when the browser does not say
//   idb:       { ok, error, keys, unreadable: string[] },                 IndexedDB "openfini" ▸ "kv"
//   recovery:  { present, docs, damaged, recents, recentsMissing },        autosaved session and recent files
//   sw:        { supported, registered, controlled, caches: string[], current, desktop, dev },
//   features:  { webgl, webgl2, webgpu, webcodecs, offscreen, workers, localFonts, fileSystem },
//   fonts:     { user, failed },
//   workers:   { ok, ms, error },
//   extensions:{ total, failed: string[], hung: string[] } | null (safe mode),
//   engines:   { total, kinds: { [kind]: n } },
//   ai:        { enabled, offline, locked, activeMissing, providers: [{ label, local, hasKey, needsKey, urlOk, reachable }] },
//   prefs:     { ok, parseError, invalid: string[] },
//   safeMode,
// }
// Values never include keys, file contents or personal paths, so the report built from findings is safe to share.

const N_ = (s) => s; // marks text for the i18n extractor (this module does not import the i18n runtime)

/** Fixes the dialog knows how to run (ui/doctor-dialog.js ▸ ENV_FIXES). `safe` ones run with "Fix all safe issues". */
export const ENV_FIXES = Object.freeze({
  "persist-storage": { label: N_("Ask to keep data"), safe: true },
  "reset-prefs": { label: N_("Back up and reset settings"), safe: true },
  "rebuild-recovery": { label: N_("Remove unreadable recovery entries"), safe: true },
  "clear-stale-caches": { label: N_("Remove old offline caches"), safe: true },
  "reregister-sw": { label: N_("Re-register the offline worker"), safe: true },
  "clear-caches": { label: N_("Clear the offline cache"), safe: false },
  "restart-extensions": { label: N_("Restart failed extensions"), safe: true },
});

const LEVEL_RANK = { error: 0, warning: 1, info: 2, ok: 3 };
const MB = (n) => Math.round(n / 1048576);

/**
 * @param {object} s status, see the header
 * @returns {{ code, area, severity: "ok"|"info"|"warning"|"error", message, params, fix?: { id, label, safe } }[]}
 */
export function evaluateEnvironment(s = {}) {
  const out = [];
  const add = (code, area, severity, message, params = {}, fixId = null) => {
    const f = { code, area, severity, message, params };
    if (fixId && ENV_FIXES[fixId]) f.fix = { id: fixId, ...ENV_FIXES[fixId] };
    out.push(f);
  };

  // storage
  const st = s.storage || {};
  if (st.quota > 0 && st.usage >= 0) {
    const pct = Math.round((st.usage / st.quota) * 100);
    if (pct >= 90) add("quota", N_("Storage"), "error", N_("Storage is almost full: {used} MB of {quota} MB used ({pct} %). Autosave and recovery may fail."), { used: MB(st.usage), quota: MB(st.quota), pct });
    else if (pct >= 70) add("quota", N_("Storage"), "warning", N_("Storage is filling up: {used} MB of {quota} MB used ({pct} %)."), { used: MB(st.usage), quota: MB(st.quota), pct });
    else add("quota", N_("Storage"), "ok", N_("{used} MB of {quota} MB storage used."), { used: MB(st.usage), quota: MB(st.quota) });
  } else add("quota", N_("Storage"), "info", N_("The storage quota is not reported here."));
  if (st.persisted) add("persist", N_("Storage"), "ok", N_("Stored data is persistent; the browser will not evict it under storage pressure."));
  else if (st.persistSupported && !s.sw?.desktop) add("persist", N_("Storage"), "warning", N_("Stored data is not persistent; the browser may delete autosaves when space runs low."), {}, "persist-storage");

  // IndexedDB
  const idb = s.idb || {};
  if (idb.ok === false) add("idb", N_("Storage"), "error", N_("The local database cannot be opened ({error}). Autosave, recent files and AI settings are unavailable."), { error: String(idb.error || "unknown").slice(0, 120) });
  else if (idb.unreadable?.length) add("idb", N_("Storage"), "warning", N_("{n, plural, one {# stored entry cannot} other {# stored entries cannot}} be read."), { n: idb.unreadable.length }, "rebuild-recovery");
  else if (idb.ok) add("idb", N_("Storage"), "ok", N_("The local database works ({n, plural, one {# entry} other {# entries}})."), { n: idb.keys || 0 });

  // recovery
  const rec = s.recovery || {};
  if (rec.damaged > 0) add("recovery", N_("Recovery"), "warning", N_("{n, plural, one {# autosaved document is} other {# autosaved documents are}} damaged and would be skipped on restore."), { n: rec.damaged }, "rebuild-recovery");
  else if (rec.present) add("recovery", N_("Recovery"), "ok", N_("The autosaved session holds {n, plural, one {# readable document} other {# readable documents}}."), { n: rec.docs || 0 });
  if (rec.recentsMissing > 0) add("recents", N_("Recovery"), "info", N_("Recent files without a stored copy (they open only from disk): {n}."), { n: rec.recentsMissing }, "rebuild-recovery");

  // offline worker and caches
  const sw = s.sw || {};
  if (sw.desktop) add("sw", N_("Offline"), "ok", N_("The desktop app serves its files itself; no offline worker is needed."));
  else if (sw.dev && !sw.registered) add("sw", N_("Offline"), "info", N_("The offline worker is not used on a local development server."));
  else if (!sw.supported) add("sw", N_("Offline"), "info", N_("This browser has no service workers; OpenFini works only while online."));
  else if (!sw.registered) add("sw", N_("Offline"), "warning", N_("The offline worker is not registered, so OpenFini will not start without a connection."), {}, "reregister-sw");
  else {
    add("sw", N_("Offline"), "ok", N_("The offline worker is active."));
    const caches = sw.caches || [];
    const stale = caches.filter((c) => c.startsWith("openfini-") && c !== sw.current);
    if (stale.length) add("caches", N_("Offline"), "info", N_("Caches from earlier versions take up space: {n}."), { n: stale.length }, "clear-stale-caches");
  }
  if (sw.supported && !sw.desktop && sw.registered) add("cache-reset", N_("Offline"), "info", N_("If the app shows old or mixed versions, clearing the offline cache downloads everything again."), {}, "clear-caches");

  // graphics and media capabilities
  const f = s.features || {};
  const cap = (code, ok, yes, no, sev = "info") => add(code, N_("Capabilities"), ok ? "ok" : sev, ok ? yes : no);
  cap("webgl", f.webgl2 || f.webgl, N_("WebGL is available (GPU effects and 3D previews)."), N_("WebGL is unavailable; GPU effects fall back to slower CPU rendering."), "warning");
  cap("webgpu", f.webgpu, N_("WebGPU is available."), N_("WebGPU is unavailable; features that use it fall back to WebGL or the CPU."));
  cap("webcodecs", f.webcodecs, N_("WebCodecs is available (video import and export in Scene Studio)."), N_("WebCodecs is unavailable; video export in Scene Studio is limited."), "warning");
  cap("offscreen", f.offscreen, N_("OffscreenCanvas is available (rendering in workers)."), N_("OffscreenCanvas is unavailable; rendering runs on the main thread and may stutter."), "warning");
  cap("localfonts", f.localFonts, N_("Installed fonts can be listed."), N_("Installed fonts cannot be listed here; a curated list is shown and fonts can be added in Settings."));

  // fonts and workers
  const fonts = s.fonts || {};
  if (fonts.failed > 0) add("fonts", N_("Fonts"), "warning", N_("{n, plural, one {# added font} other {# added fonts}} could not be loaded."), { n: fonts.failed });
  else if (fonts.user > 0) add("fonts", N_("Fonts"), "ok", N_("Added fonts loaded: {n}."), { n: fonts.user });
  const w = s.workers || {};
  if (w.ok === false) add("workers", N_("Workers"), "error", N_("The background worker pool does not respond ({error}); exports and filters run slowly or fail."), { error: String(w.error || "timeout").slice(0, 120) });
  else if (w.ok) add("workers", N_("Workers"), "ok", N_("The background worker pool answers ({ms} ms)."), { ms: Math.round(w.ms || 0) });

  // extensions and engines
  if (s.extensions === null) add("extensions", N_("Extensions"), "info", N_("Extensions are off in safe mode."));
  else if (s.extensions) {
    const ex = s.extensions;
    const bad = [...(ex.failed || []), ...(ex.hung || [])];
    if (bad.length) add("extensions", N_("Extensions"), "warning", N_("Extensions with problems: {list}."), { list: bad.slice(0, 6).join(", ") }, "restart-extensions");
    else add("extensions", N_("Extensions"), "ok", N_("{n, plural, one {# extension} other {# extensions}}, none with errors."), { n: ex.total || 0 });
  }
  if (s.engines) add("engines", N_("Extensions"), s.engines.total ? "ok" : "warning", s.engines.total ? N_("Registered engines: {n}.") : N_("No engines are registered; some features will be missing."), { n: s.engines.total || 0 });

  // AI configuration (no request carries a key; reachability is a plain request to the provider's own address)
  const ai = s.ai || {};
  if (!ai.enabled) add("ai", N_("AI"), "ok", N_("AI features are off."));
  else {
    const ps = ai.providers || [];
    if (!ps.length) add("ai", N_("AI"), "info", N_("AI features are on, but no provider is connected."));
    if (ai.activeMissing) add("ai-active", N_("AI"), "warning", N_("The selected AI provider no longer exists; Vibe falls back to the demo assistant."));
    if (ai.locked) add("ai-locked", N_("AI"), "info", N_("API keys are locked; unlock them to check the providers that need a key."));
    for (const p of ps) {
      if (!p.urlOk) add("ai-url", N_("AI"), "warning", N_("The address of “{provider}” is not a valid https address (or a local one)."), { provider: p.label });
      else if (p.needsKey && !p.hasKey && !ai.locked) add("ai-key", N_("AI"), "warning", N_("“{provider}” needs an API key, but none is stored."), { provider: p.label });
      else if (p.reachable === false) add("ai-reach", N_("AI"), "info", N_("“{provider}” could not be reached from here (offline, a firewall or the provider is down)."), { provider: p.label });
      else add("ai-ok", N_("AI"), "ok", ai.offline ? N_("“{provider}” is configured (not contacted: offline mode is on).") : N_("“{provider}” is configured."), { provider: p.label });
    }
  }

  // preferences
  const pr = s.prefs || {};
  if (pr.parseError) add("prefs", N_("Settings"), "error", N_("Saved settings are damaged and were ignored; defaults are in use."), {}, "reset-prefs");
  else if (pr.invalid?.length) add("prefs", N_("Settings"), "warning", N_("Saved settings with invalid values: {list}."), { n: pr.invalid.length, list: pr.invalid.slice(0, 6).join(", ") }, "reset-prefs");
  else if (pr.ok) add("prefs", N_("Settings"), "ok", N_("Saved settings are valid."));
  if (s.safeMode) add("safe", N_("Settings"), "info", N_("Safe mode is on: saved settings, extensions and session restore are not applied."));

  return out.sort((a, b) => LEVEL_RANK[a.severity] - LEVEL_RANK[b.severity]);
}

/**
 * Checks saved preferences against the defaults: a value whose type differs from the default's type is invalid.
 * @param {string|null} raw the stored JSON text
 * @param {object} defaults
 * @returns {{ ok: boolean, parseError: boolean, invalid: string[] }}
 */
export function checkPrefs(raw, defaults) {
  if (raw == null || raw === "") return { ok: true, parseError: false, invalid: [] };
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ok: false, parseError: true, invalid: [] };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, parseError: true, invalid: [] };
  const kind = (x) => (x === null ? "null" : Array.isArray(x) ? "array" : typeof x);
  const invalid = [];
  for (const [k, d] of Object.entries(defaults || {})) {
    if (!(k in v) || d === null || d === undefined || v[k] === null) continue;
    if (kind(v[k]) !== kind(d)) invalid.push(k);
    else if (typeof d === "number" && !Number.isFinite(v[k])) invalid.push(k);
  }
  return { ok: !invalid.length, parseError: false, invalid };
}

/** True for an AI provider address the Doctor accepts: https, or http to this device. */
export function providerUrlOk(url) {
  if (!url) return true; // presets without a custom address
  try {
    const u = new URL(url);
    if (u.username || u.password) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  } catch {
    return false;
  }
}
