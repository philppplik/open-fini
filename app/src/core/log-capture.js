// Feeds the central logger (core/log.js) from the browser: console.warn / console.error, window errors, unhandled
// promise rejections, failed resource loads, failed network requests and Content-Security-Policy violations. Also keeps
// the newest errors in local storage so they can be looked at after a crash or restart.
import { log } from "./log.js";

const BENIGN = /ResizeObserver|unobserve/i; // harmless browser / component noise, kept at debug level

const urlForLog = (u) => {
  try {
    const x = new URL(String(u?.url || u), location.href);
    return x.origin === location.origin ? x.pathname : `${x.origin}${x.pathname}`;
  } catch {
    return "(unknown url)";
  }
};

let installed = false;

/**
 * Installs the capture hooks once. Safe to call in any environment (does nothing without a window).
 * @param {{ persist?: boolean }} [o]
 */
export function installLogCapture({ persist = true } = {}) {
  if (installed || typeof window === "undefined") return log;
  installed = true;

  // console.warn / console.error (the originals still run, so the browser console stays complete)
  const orig = { warn: console.warn, error: console.error, log: console.log };
  let capturing = false;
  log.echo = (level, scope, msg) => {
    if (!capturing) (orig[level] || orig.log).call(console, `[${scope}]`, msg);
  };
  for (const level of ["warn", "error"]) {
    console[level] = (...args) => {
      orig[level].apply(console, args);
      if (capturing) return;
      capturing = true;
      try {
        log.log(level, "console", ...args);
      } finally {
        capturing = false;
      }
    };
  }

  const record = (level, scope, ...args) => {
    capturing = true; // the browser already shows these in its console
    try {
      log.log(level, scope, ...args);
    } finally {
      capturing = false;
    }
  };

  window.addEventListener(
    "error",
    (e) => {
      const t = e.target;
      if (t && t !== window && t.tagName) {
        // a resource (image, script, stylesheet, font) failed to load
        const src = t.currentSrc || t.src || t.href;
        if (src) record("warn", "resource", `Failed to load <${t.tagName.toLowerCase()}> ${urlForLog(src)}`);
        return;
      }
      if (BENIGN.test(e.message || "")) return record("debug", "app", e.message);
      record("error", "app", e.error instanceof Error ? e.error : e.message || "Script error.", e.filename ? `at ${urlForLog(e.filename)}:${e.lineno}:${e.colno}` : "");
    },
    true,
  );
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const msg = r?.message || String(r);
    if (BENIGN.test(msg)) return record("debug", "app", msg);
    record("error", "app", "Unhandled promise rejection:", r instanceof Error ? r : msg);
  });
  document.addEventListener("securitypolicyviolation", (e) => {
    record("warn", "csp", `Blocked ${e.effectiveDirective || e.violatedDirective}: ${urlForLog(e.blockedURI || "inline")}${e.sourceFile ? ` (${urlForLog(e.sourceFile)}:${e.lineNumber})` : ""}`);
  });
  window.addEventListener("offline", () => record("info", "net", "The browser reports that this device is offline."));
  window.addEventListener("online", () => record("info", "net", "The browser reports that this device is online again."));

  // failed requests: network errors, authorization / rate-limit / server errors (never the content of requests or responses)
  if (typeof window.fetch === "function") {
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      const p = nativeFetch.apply(this, arguments);
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      p.then(
        (r) => {
          if (r.ok) return;
          const foreign = (() => {
            try {
              return new URL(r.url || String(input?.url || input), location.href).origin !== location.origin;
            } catch {
              return true;
            }
          })();
          if (r.status >= 500 || r.status === 401 || r.status === 403 || r.status === 429 || (foreign && r.status >= 400)) record("warn", "net", `HTTP ${r.status} for ${method} ${urlForLog(r.url || input)}`);
        },
        (err) => {
          if (err?.name === "AbortError") return;
          record("warn", "net", `Request failed: ${method} ${urlForLog(input)} (${err?.message || err})`);
        },
      );
      return p;
    };
  }

  if (persist) setupPersistence();
  return log;
}

let store = null;
let storeReady = null;
const SESSION = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);

/** Retention in days from the saved settings (default 14; 0 = this session only). Read directly: the App is not built yet. */
function savedRetention() {
  try {
    const v = JSON.parse(localStorage.getItem("openfini.prefs.v1") || "{}").logRetentionDays;
    return Number.isFinite(v) ? Math.max(0, Math.min(365, Math.floor(v))) : 14;
  } catch {
    return 14;
  }
}

/** The durable log store (core/log-store.js), created on first use. Resolves to null when storage is unavailable. */
export function getLogStore() {
  storeReady ||= (async () => {
    try {
      const [{ createLogStore }, kv, { buildInfo }] = await Promise.all([import("./log-store.js"), import("./storage.js"), import("./env.js")]);
      let build = "development";
      try {
        const info = await buildInfo();
        if (info?.version) build = `${info.version}${info.commit ? "+" + String(info.commit).slice(0, 7) : ""}`;
      } catch {
        /* development build */
      }
      store = createLogStore({ storage: { get: kv.kvGetRaw, set: kv.kvSetRaw, delete: kv.kvDelete }, session: SESSION, build, retentionDays: savedRetention() });
      return store;
    } catch {
      return null;
    }
  })();
  return storeReady;
}

/** Applies Settings ▸ "Keep logs for N days". 0 deletes what is stored and stops persisting. */
export async function setLogRetention(days) {
  const s = await getLogStore();
  if (!s) return;
  s.setRetentionDays(days);
  if (!s.retentionDays) await s.clear();
  else await s.prune();
}

/** Persists info+ entries in batches (debounced, flushed when the page is hidden) and loads errors of earlier sessions. */
async function setupPersistence() {
  const s = await getLogStore();
  if (!s) return;
  const kv = await import("./storage.js");
  try {
    // errors of earlier sessions show up as "(previous session)" in the problems list and the report
    const prev = s.retentionDays ? (await s.load("all")).filter((e) => e.session !== SESSION && e.level === "error").slice(-50) : [];
    log.loadPrevious(prev.length ? prev : s.retentionDays ? await kv.kvGet("diag.errors") : null);
  } catch {
    /* no previous sessions */
  }
  if (s.retentionDays) kv.kvDelete("diag.errors");
  let timer = 0;
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    s.flush();
  };
  log.subscribe((e) => {
    if (!e) return;
    s.append(e);
    if (!timer) timer = setTimeout(flush, e.level === "error" ? 1500 : 5000);
  });
  for (const e of log.buffer) if (!e.prev) s.append(e); // entries recorded while the store was loading
  if (log.buffer.length) timer ||= setTimeout(flush, 5000);
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}

/** Forgets every stored log (Settings ▸ Security and privacy ▸ Privacy tools, Troubleshooting ▸ Clear logs). */
export async function clearStoredErrors() {
  const { kvDelete } = await import("./storage.js");
  await kvDelete("diag.errors");
  const s = await getLogStore();
  await s?.clear();
}
