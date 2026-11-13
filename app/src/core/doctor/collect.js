// App Doctor, browser side (docs/doctor.md ▸ App checks): collects the status object env.js evaluates and runs the fixes
// it offers. Loaded only by the Doctor dialog and the run_doctor Vibe tool (both lazy). Nothing here reads key values,
// file contents or paths into the result; AI providers are checked for configuration, and reachability is a plain
// request to the provider's own address without credentials (skipped in offline mode).
import { kvKeys, kvGetRaw, kvDelete, kvGet, kvSet, getRecents } from "../storage.js";
import { getDefaultPrefs } from "../app.js";
import { platform } from "../../platform/index.js";
import { checkPrefs, providerUrlOk, evaluateEnvironment } from "./env.js";
import { diagnoseFile } from "./file.js";

const PREF_KEY = "openfini.prefs.v1";
const N_ = (x) => x; // marks text for the i18n extractor
const safe = async (fn, fallback) => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

function features() {
  const g = globalThis;
  let webgl = false;
  let webgl2 = false;
  try {
    const c = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1) : g.document?.createElement("canvas");
    webgl2 = !!c?.getContext("webgl2");
    webgl = webgl2 || !!c?.getContext("webgl");
  } catch {
    /* no GPU context */
  }
  return {
    webgl,
    webgl2,
    webgpu: !!g.navigator?.gpu,
    webcodecs: typeof g.VideoEncoder === "function" && typeof g.VideoDecoder === "function",
    offscreen: typeof g.OffscreenCanvas === "function",
    workers: typeof g.Worker === "function",
    localFonts: typeof g.queryLocalFonts === "function" || !!platform.isDesktop,
    fileSystem: typeof g.showOpenFilePicker === "function" || !!platform.isDesktop,
  };
}

async function swStatus() {
  const supported = "serviceWorker" in (globalThis.navigator || {});
  const host = globalThis.location?.hostname || "";
  const out = { supported, desktop: !!platform.isDesktop, dev: /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host), registered: false, controlled: false, caches: [], current: null };
  if (!supported || out.desktop) return out;
  const regs = await safe(() => navigator.serviceWorker.getRegistrations(), []);
  out.registered = regs.length > 0;
  out.controlled = !!navigator.serviceWorker.controller;
  out.caches = await safe(() => caches.keys(), []);
  out.current = await currentCache();
  return out;
}

/** The cache name of the running service worker version (asks it with GET_VERSION). */
async function currentCache() {
  const ctl = globalThis.navigator?.serviceWorker?.controller;
  if (!ctl) return null;
  return safe(
    () =>
      withTimeout(
        new Promise((res) => {
          const ch = new MessageChannel();
          ch.port1.onmessage = (e) => res(e.data?.version ? `openfini-${e.data.version}` : null);
          ctl.postMessage({ type: "GET_VERSION" }, [ch.port2]);
        }),
        1500,
      ),
    null,
  );
}

async function idbStatus() {
  try {
    const keys = await withTimeout(kvKeys(), 5000);
    const unreadable = [];
    for (const k of keys.slice(0, 5000)) if ((await kvGetRaw(k)) === undefined) unreadable.push(k);
    return { ok: true, keys: keys.length, unreadable };
  } catch (e) {
    return { ok: false, error: e?.name || e?.message || "unavailable", keys: 0, unreadable: [] };
  }
}

async function recoveryStatus() {
  const s = await safe(() => kvGet("session"), undefined);
  const docs = Array.isArray(s?.docs) ? s.docs : [];
  let damaged = 0;
  for (const d of docs) if (!(d?.bytes instanceof Uint8Array) || diagnoseFile(d.bytes, { name: "session.ofini" }).counts.error) damaged++;
  const recents = await safe(getRecents, []);
  let recentsMissing = 0;
  for (const r of recents) if (!r.path && !r.isDir && !(await safe(() => kvGetRaw(`recent:${r.id}`), undefined))) recentsMissing++;
  return { present: !!s, docs: docs.length - damaged, damaged, recents: recents.length, recentsMissing };
}

async function workerStatus() {
  const t0 = performance.now();
  try {
    const { runJob } = await import("../workers/index.js");
    await withTimeout(runJob("zip.compress", { files: { "a.txt": new Uint8Array([111, 102]) }, level: 1 }), 8000);
    return { ok: true, ms: performance.now() - t0 };
  } catch (e) {
    return { ok: false, error: e?.message || "failed" };
  }
}

async function aiStatus(app) {
  const enabled = !!app.prefs.aiEnabled;
  if (!enabled || app.safeMode) return { enabled: false };
  const { vibeStore } = await import("../../vibe/store.js");
  await safe(() => vibeStore.load());
  const { PROVIDER_PRESETS } = await import("../../ai/providers/index.js");
  const offline = !!app.prefs.offlineMode;
  const providers = [];
  for (const p of vibeStore.providers || []) {
    const preset = PROVIDER_PRESETS.find((x) => x.id === p.preset);
    const url = p.baseUrl || preset?.baseUrl || "";
    const entry = { label: p.label || preset?.label || "Provider", local: /\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url), hasKey: !!vibeStore.getKey(p.id), needsKey: preset ? !!preset.needsKey : false, urlOk: providerUrlOk(url) };
    if (!offline && entry.urlOk && url && app.network?.allowed?.("ai") !== false) {
      // a credential-free request to the provider's origin: any HTTP answer (even 401/404) means it is reachable
      entry.reachable = await safe(() => withTimeout(fetch(new URL(url).origin, { method: "HEAD", mode: "no-cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }).then(() => true), 4000), false);
    }
    providers.push(entry);
  }
  const active = vibeStore.settings?.activeProvider;
  return { enabled, offline, locked: !!vibeStore.locked, activeMissing: !!active && active !== "demo" && !(vibeStore.providers || []).some((p) => p.id === active), providers };
}

/** Collects the status object of env.js (see its header). */
export async function collectDoctorStatus(app) {
  const est = await safe(() => navigator.storage.estimate(), {});
  const raw = (() => {
    try {
      return localStorage.getItem(PREF_KEY);
    } catch {
      return null;
    }
  })();
  const exts = app.extensions ? await safe(() => app.extensions.list(), []) : null;
  const [{ engines, ENGINE_KINDS }, { ensureBuiltinEngines }] = await Promise.all([import("../../platform/engines.js"), import("../../platform/builtin-engines.js")]);
  await safe(() => ensureBuiltinEngines());
  const kinds = {};
  let engineTotal = 0;
  for (const k of Object.keys(ENGINE_KINDS)) {
    kinds[k] = (await safe(() => engines.list(k), [])).length;
    engineTotal += kinds[k];
  }
  const [idb, recovery, sw, workers, ai] = await Promise.all([idbStatus(), recoveryStatus(), swStatus(), workerStatus(), safe(() => aiStatus(app), { enabled: !!app.prefs.aiEnabled, providers: [] })]);
  return {
    storage: { usage: est.usage, quota: est.quota, persisted: await safe(() => navigator.storage.persisted(), false), persistSupported: typeof navigator.storage?.persist === "function" },
    idb,
    recovery,
    sw,
    features: features(),
    fonts: { user: app.fonts?.size || 0, failed: app.fontsFailed || 0 },
    workers,
    extensions: exts === null ? null : { total: exts.length, failed: exts.filter((e) => e.state === "error" || e.state === "invalid").map((e) => e.name || e.id), hung: exts.filter((e) => e.hung).map((e) => e.name || e.id) },
    engines: { total: engineTotal, kinds },
    ai,
    prefs: checkPrefs(raw, getDefaultPrefs()),
    safeMode: !!app.safeMode,
  };
}

/** Status plus findings. */
export async function runEnvironmentChecks(app) {
  const status = await collectDoctorStatus(app);
  return { status, findings: evaluateEnvironment(status) };
}

/**
 * Runs one environment fix. Returns [message, params]: an English template the dialog translates with t().
 * @param {object} app @param {string} id one of env.js ▸ ENV_FIXES @param {object} status the collected status
 */
export async function runEnvironmentFix(app, id, status) {
  switch (id) {
    case "persist-storage":
      return (await safe(() => navigator.storage.persist(), false)) ? [N_("The browser will keep OpenFini's data.")] : [N_("The browser declined; installing OpenFini as an app usually allows it.")];
    case "reset-prefs": {
      try {
        const raw = localStorage.getItem(PREF_KEY);
        if (raw != null) localStorage.setItem(`${PREF_KEY}.backup`, raw);
      } catch {
        /* private mode: nothing to back up */
      }
      app.resetPrefs();
      return [N_("Settings were reset; the previous ones are kept as a backup in this browser.")];
    }
    case "rebuild-recovery": {
      let removed = 0;
      for (const k of status?.idb?.unreadable || []) {
        await kvDelete(k);
        removed++;
      }
      const s = await safe(() => kvGet("session"), undefined);
      if (Array.isArray(s?.docs)) {
        const good = s.docs.filter((d) => d?.bytes instanceof Uint8Array && !diagnoseFile(d.bytes, { name: "session.ofini" }).counts.error);
        if (good.length !== s.docs.length) {
          removed += s.docs.length - good.length;
          await kvSet("session", { ...s, docs: good, active: Math.min(s.active || 0, Math.max(0, good.length - 1)) });
        }
      }
      return removed ? [N_("Unreadable entries removed: {n}."), { n: removed }] : [N_("Nothing needed to be removed.")];
    }
    case "clear-stale-caches": {
      const cur = status?.sw?.current;
      let n = 0;
      for (const name of await safe(() => caches.keys(), [])) if (name.startsWith("openfini-") && name !== cur && (await caches.delete(name))) n++;
      return [N_("Old caches removed: {n}."), { n }];
    }
    case "clear-caches": {
      for (const name of await safe(() => caches.keys(), [])) if (name.startsWith("openfini-")) await caches.delete(name);
      return [N_("The offline cache is cleared; it is downloaded again on the next start.")];
    }
    case "reregister-sw": {
      const { registerServiceWorker } = await import("../../platform/pwa.js");
      const reg = await safe(() => registerServiceWorker({}), null);
      return reg ? [N_("The offline worker is registered again.")] : [N_("The offline worker could not be registered here.")];
    }
    case "restart-extensions": {
      const exts = app.extensions ? await safe(() => app.extensions.list(), []) : [];
      let n = 0;
      for (const e of exts) if (e.state === "error" || e.hung) if (await safe(() => app.extensions.restart(e.id).then(() => true), false)) n++;
      return [N_("Extensions restarted: {n}."), { n }];
    }
    default:
      throw new Error(`Unknown fix: ${id}`);
  }
}
