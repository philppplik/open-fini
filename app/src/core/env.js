// Collects the data behind the Troubleshooting dialog, the diagnostic report and the security overview from the
// browser and the app. Everything returned is plain, redactable data: no documents, no keys, no file names.
import { platform } from "../platform/index.js";
import { browserInfo, buildInventory } from "./diagnostics.js";
import { log } from "./log.js";
import { isLoopbackUrl } from "./network.js";
import { evaluateSecurity } from "./security.js";
import { kvEntries } from "./storage.js";

let buildInfoPromise = null;

/** The build's build-info.json (null in development builds). Cached. */
export function buildInfo() {
  buildInfoPromise ||= fetch("./build-info.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return buildInfoPromise;
}

const safe = async (fn, fallback = null) => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

/** Installed extensions as { id, name, version, enabled, permissions[] } (empty when the extension host is absent). */
export function listExtensions(app) {
  const reg = app.extensions;
  let list = [];
  try {
    if (typeof reg?.list === "function") list = reg.list();
    else if (Array.isArray(reg?.installed)) list = reg.installed;
    else if (reg instanceof Map) list = [...reg.values()];
    if (!Array.isArray(list)) list = [...list];
  } catch {
    list = [];
  }
  return list.map((e) => {
    const m = e.manifest || e;
    const perms = e.rec?.granted || m.permissions || e.permissions || []; // granted permissions when the host tracks them
    return {
      id: String(e.id || m.id || "unknown"),
      name: String(e.name || m.name || e.id || "Extension"),
      version: String(e.version || m.version || ""),
      enabled: e.state ? e.state !== "disabled" && e.state !== "invalid" : e.enabled !== false,
      permissions: (Array.isArray(perms) ? perms : Object.values(perms)).map((p) => (typeof p === "string" ? p : p?.origin || p?.name || JSON.stringify(p))),
    };
  });
}

function localStorageEntries() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("openfini")) out.push({ key: k, bytes: (k.length + (localStorage.getItem(k) || "").length) * 2 });
    }
  } catch {
    /* blocked */
  }
  return out;
}

/** The environment: version, platform, browser / web view, memory, storage, service worker, features and settings. */
export async function collectEnvironment(app) {
  const info = await buildInfo();
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const display = (q) => !!globalThis.matchMedia?.(q).matches;
  const mode = platform.isDesktop ? "desktop" : display("(display-mode: standalone)") ? "pwa" : "browser";
  const estimate = await safe(() => navigator.storage.estimate(), {});
  const persisted = await safe(() => navigator.storage.persisted());
  const regs = await safe(() => navigator.serviceWorker.getRegistrations(), []);
  const cacheNames = await safe(() => caches.keys(), []);
  const entries = await safe(kvEntries, []);
  const prefs = { ...app.prefs };
  delete prefs.recentCommands;
  delete prefs.toursSeen;
  const heap = performance?.memory;
  const extensions = listExtensions(app);
  return {
    app: { version: info?.version || "development", buildId: info?.buildId || "development", commit: info?.commit || null, builtAt: info?.builtAt || null, mode, safeMode: !!app.safeMode, offlineMode: !!app.prefs.offlineMode, studio: app.studio, openDocuments: app.docs.length, uptimeMinutes: Math.round(performance.now() / 60000) },
    platform: { os: platform.os, isDesktop: !!platform.isDesktop, userAgent: nav.userAgent || "", language: nav.language || "", online: nav.onLine, secureContext: !!globalThis.isSecureContext, ...(() => { const b = browserInfo(nav.userAgent || "", { isDesktop: platform.isDesktop, os: platform.os }); return { browser: { name: b.name, version: b.version, engine: b.engine }, webview: b.webview }; })() },
    hardware: { cpuCores: nav.hardwareConcurrency || null, deviceMemoryGB: nav.deviceMemory || null, screen: `${screen.width}x${screen.height} @${devicePixelRatio}x`, jsHeapMB: heap ? Math.round(heap.usedJSHeapSize / 1048576) : null },
    perf: { low: !!app.perf.low, setting: app.prefs.lowPower, dprCap: app.perf.dprCap, historyMB: Math.round(app.perf.historyBytes / 1048576) },
    display: { colorScheme: display("(prefers-color-scheme: dark)") ? "dark" : "light", reducedMotion: display("(prefers-reduced-motion: reduce)"), highContrast: display("(prefers-contrast: more)") },
    storage: { usageBytes: estimate?.usage ?? null, quotaBytes: estimate?.quota ?? null, persisted, indexedDb: typeof indexedDB !== "undefined", keys: entries.length, offlineCaches: cacheNames.length },
    serviceWorker: { supported: "serviceWorker" in nav, controlled: !!nav.serviceWorker?.controller, registrations: regs.map((r) => `${r.scope} (${r.active?.state || (r.installing ? "installing" : r.waiting ? "waiting" : "none")})`) },
    features: { aiEnabled: !!app.prefs.aiEnabled, offlineMode: !!app.prefs.offlineMode, appLock: !!app.prefs.appLock, protectedMode: !!app.prefs.protectedMode, previewScripts: app.prefs.previewScripts !== false, confirmExternal: app.prefs.confirmExternal !== false, autosave: !!app.prefs.autosave, restoreSession: app.prefs.restoreSession !== false, extensions: extensions.map((e) => `${e.name}${e.version ? ` ${e.version}` : ""}${e.enabled ? "" : " (disabled)"}`) },
    log: { errors: log.errorCount, warnings: log.warnCount, entries: log.buffer.length },
    prefs,
  };
}

/** The "what is stored on this device" inventory (keys and sizes only). */
export async function collectInventory() {
  const estimate = await safe(() => navigator.storage.estimate(), {});
  const names = await safe(async () => (await caches.keys()), []);
  const caches_ = [];
  for (const name of names) caches_.push({ name, entries: await safe(async () => (await (await caches.open(name)).keys()).length) });
  const dbs = await safe(async () => (await indexedDB.databases()).map((d) => d.name), []);
  const regs = await safe(() => navigator.serviceWorker.getRegistrations(), []);
  return buildInventory({ kv: await safe(kvEntries, []), local: localStorageEntries(), caches: caches_, databases: dbs, estimate, serviceWorkers: regs.length });
}

/** Status used by the security check (settings panel and the get_security_status tool). */
export async function collectSecurityStatus(app) {
  const { vibeStore } = await import("../vibe/store.js");
  await safe(() => vibeStore.load());
  const providers = (vibeStore.providers || []).map((p) => ({ id: p.id, label: p.label, local: isLoopbackUrl(p.baseUrl) || p.preset === "ollama" || p.preset === "lmstudio", hasKey: !!vibeStore.getKey(p.id) || !!vibeStore.locked }));
  const header = await safe(async () => {
    if (platform.isDesktop) return undefined;
    const r = await fetch(location.href, { method: "HEAD", cache: "no-store" });
    return r.headers.get("content-security-policy");
  }, undefined);
  const hasLockRecord = !!app.prefs.appLock;
  return {
    ai: { enabled: !!app.prefs.aiEnabled, providers, mcpServers: (vibeStore.mcpServers || []).map((s) => ({ name: s.name, enabled: s.enabled !== false, local: isLoopbackUrl(s.url) })), keysEncrypted: !!vibeStore.settings?.vault, keysLocked: !!vibeStore.locked, activeProvider: vibeStore.settings?.activeProvider || null },
    extensions: listExtensions(app),
    network: { offline: !!app.prefs.offlineMode, desktop: !!platform.isDesktop, updateChecks: !platform.isDesktop && "serviceWorker" in navigator && !!navigator.serviceWorker.controller },
    csp: { desktop: !!platform.isDesktop, header },
    storage: { appLock: hasLockRecord, persisted: await safe(() => navigator.storage.persisted()) },
    protectedMode: !!app.prefs.protectedMode,
    safeMode: !!app.safeMode,
    confirmExternal: app.prefs.confirmExternal !== false,
    previewScripts: app.prefs.previewScripts !== false,
  };
}

/** Status plus the evaluated checks. */
export async function securityOverview(app) {
  const status = await collectSecurityStatus(app);
  return { status, checks: evaluateSecurity(status) };
}
