// How Ollama requests travel. In the desktop app they go through the native `ollama_fetch` command
// (src-tauri/src/ollama.rs): no CORS, no OLLAMA_ORIGINS, streamed back chunk by chunk, IPv4 and IPv6 both tried.
// In a browser (PWA) they use the page's own `fetch`, which needs Ollama to allow this origin (see ollama.js).
// The result is a real `Response`, so the rest of the app does not care which path was taken.

const bin = (s) => {
  const raw = atob(s || "");
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

/** Tauri's core API (invoke + Channel) when running in the desktop app. */
export function tauriCore() {
  const c = globalThis.window?.__TAURI__?.core;
  return c && typeof c.invoke === "function" && typeof c.Channel === "function" ? c : null;
}

/** Mirror of the native rule: this device, the local network, or ollama.com. Anything else uses the web view. */
export function isNativeOllamaUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "ollama.com" || host.endsWith(".ollama.com")) return u.protocol === "https:";
  if (host === "localhost" || /\.(localhost|local|internal|lan)$/.test(host) || host.endsWith(".home.arpa")) return true;
  if (/^(127|10)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
  return !host.includes(".") && !host.includes(":");
}

let jobs = 0;

/**
 * A `fetch` for Ollama. `deps` is for tests: { core, fetch }.
 * @returns {(url:string, init?:RequestInit)=>Promise<Response>}
 */
export function createOllamaFetch(deps = {}) {
  const fn = (url, init = {}) => {
    const core = "core" in deps ? deps.core : tauriCore();
    const webFetch = deps.fetch || ((...a) => globalThis.fetch(...a));
    if (!core || !isNativeOllamaUrl(url)) return webFetch(url, init);
    const signal = init.signal;
    const aborted = () => signal?.reason || Object.assign(new Error("Aborted."), { name: "AbortError" });
    if (signal?.aborted) return Promise.reject(aborted());
    const job = `ollama-${Date.now().toString(36)}-${++jobs}`;
    const headers = Object.entries(init.headers || {}).map(([k, v]) => [k, String(v)]);
    return new Promise((resolve, reject) => {
      let ctrl;
      let settled = false;
      let closed = false;
      const body = new ReadableStream({
        start(c) {
          ctrl = c;
        },
        cancel() {
          closed = true;
          core.invoke("net_cancel", { job }).catch(() => {});
        },
      });
      const onAbort = () => {
        core.invoke("net_cancel", { job }).catch(() => {});
        if (!settled) {
          settled = true;
          reject(aborted());
        } else if (!closed) {
          closed = true;
          try {
            ctrl.error(aborted());
          } catch {
            /* already closed */
          }
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const channel = new core.Channel();
      channel.onmessage = (m) => {
        if (!m || closed) return;
        if (m.type === "head" && !settled) {
          settled = true;
          const noBody = m.status === 204 || m.status === 205 || m.status === 304;
          const h = { "content-type": m.contentType || "" };
          if (m.location) h.location = m.location;
          resolve(new Response(noBody ? null : body, { status: m.status, headers: h }));
          if (noBody) closed = true;
        } else if (m.type === "chunk") {
          ctrl.enqueue(bin(m.data));
        } else if (m.type === "end") {
          closed = true;
          signal?.removeEventListener("abort", onAbort);
          try {
            ctrl.close();
          } catch {
            /* already closed */
          }
        }
      };
      core
        .invoke("ollama_fetch", { request: { url: String(url), method: init.method || "GET", headers, body: typeof init.body === "string" ? init.body : undefined, job }, onEvent: channel })
        .catch((e) => {
          signal?.removeEventListener("abort", onAbort);
          const err = new TypeError(typeof e === "string" ? e : e?.message || "The request failed.");
          if (!settled) {
            settled = true;
            reject(err);
          } else if (!closed) {
            closed = true;
            try {
              ctrl.error(err);
            } catch {
              /* already closed */
            }
          }
        });
    });
  };
  fn.native = !!("core" in deps ? deps.core : tauriCore());
  return fn;
}
