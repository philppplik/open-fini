// Native GET for the assistant's web tools in the desktop app (src-tauri/src/webfetch.rs): reads pages that send no
// CORS headers, resolves host names on the native side and refuses private addresses there too, and never follows
// redirects (the 3xx comes back, so guardedFetch in web-access.js checks and approves every hop). The browser build
// (PWA) has no native side: `webFetch` then is the web view's own `fetch` and everything keeps working for sites that
// allow cross-origin reads (docs/vibe-studio.md ▸ Web access).
//
// Only plain GETs without credentials go native (custom headers other than Accept, bodies and other methods use the
// web view's fetch), so API keys never take this path.

const b64 = (s) => {
  const bin = atob(s || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** True in the desktop app (Tauri with the web_get command). */
export function nativeWebAvailable() {
  return !!globalThis.window?.__TAURI__?.core?.invoke;
}

/** Whether a fetch call can be served natively: GET, no body, no headers except Accept. */
export function nativeEligible(init = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const keys = Object.keys(init.headers || {}).map((k) => k.toLowerCase());
  return method === "GET" && init.body == null && keys.every((k) => k === "accept");
}

/** Turns the native result into the subset of `Response` the web tools use. Exported for tests. */
export function toResponse(r, maxBytes) {
  const bytes = b64(r.body);
  const head = new Map([["content-type", r.contentType || ""], ["content-length", String(bytes.length)], ...(r.location ? [["location", r.location]] : [])]);
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    statusText: "",
    url: r.url,
    type: "basic",
    redirected: false,
    truncated: !!r.truncated,
    maxBytes,
    headers: { get: (k) => head.get(String(k).toLowerCase()) ?? null },
    body: null,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => new TextDecoder().decode(bytes),
    json: async () => JSON.parse(new TextDecoder().decode(bytes)),
  };
}

/** One native GET (no redirects followed). */
export async function nativeFetch(url, init = {}, { maxBytes = 2 * 1024 * 1024, timeoutMs = 15000 } = {}) {
  const invoke = globalThis.window.__TAURI__.core.invoke;
  const headers = init.headers || {};
  const accept = Object.entries(headers).find(([k]) => k.toLowerCase() === "accept")?.[1];
  const call = invoke("web_get", { request: { url: String(url), accept, maxBytes, timeoutMs } }).then((r) => toResponse(r, maxBytes));
  if (!init.signal) return call;
  if (init.signal.aborted) throw init.signal.reason || new Error("Aborted.");
  return Promise.race([call, new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason || new Error("Aborted.")), { once: true }))]);
}

/** `fetch` for the web tools: native for eligible GETs in the desktop app, the web view's fetch otherwise. */
export function webFetch(url, init = {}) {
  if (nativeWebAvailable() && nativeEligible(init)) return nativeFetch(url, init, { maxBytes: init.maxBytes, timeoutMs: init.timeoutMs });
  return globalThis.fetch(url, init);
}
