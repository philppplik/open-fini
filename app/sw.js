/* OpenFini service worker: makes the app work offline.
 *
 * - Cache-first. Every build gets its own cache ("openfini-<version>"), filled
 *   from a precache manifest that scripts/build.mjs injects (see the two @@
 *   tokens below). Files whose revision did not change are copied from the
 *   previous cache instead of being downloaded again.
 * - A new version installs in the background and then WAITS. It only takes over
 *   when the page posts { type: "SKIP_WAITING" }, so an update never swaps files
 *   under a running editing session (see registerServiceWorker in
 *   src/platform/pwa.js).
 * - Old caches are deleted when a new version activates.
 * - Web Share Target: a POST to <scope>/share (files shared from another app) is stored in the "ofshare-v1"
 *   cache and answered with a redirect to ./?share=<id>; the page then opens the files and empties the cache.
 *   That cache does not start with "openfini-", so version clean-up never touches it.
 * - Without injected tokens (the dev server serves this file as is) the worker
 *   does not intercept anything and removes itself, so development is never stale.
 */

const VERSION = "@@BUILD_VERSION@@";
/** Precache manifest: [path relative to this file, revision]. */
const PRECACHE = /*@@PRECACHE_MANIFEST@@*/ [];

const DEV = VERSION.startsWith("@@");
const CACHE_PREFIX = "openfini-";
const CACHE_NAME = CACHE_PREFIX + VERSION;
const INDEX = "index.html";
const META = "openfini-cache-meta.json"; // pseudo URL that stores the revisions of a finished cache
const BATCH = 24; // parallel downloads while precaching

const scoped = (path) => new URL(path, self.registration.scope).href;

const SHARE_CACHE = "ofshare-v1";
const SHARE_PATH = "share";

self.addEventListener("install", (event) => {
  if (DEV) return;
  // No skipWaiting() here on purpose: see the header comment.
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(DEV ? removeSelf() : activate());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (data.type === "GET_VERSION") {
    event.source?.postMessage({ type: "VERSION", version: VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  if (DEV) return;
  const { request } = event;
  const url = new URL(request.url);
  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === new URL(SHARE_PATH, self.registration.scope).pathname) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  // The worker script and the build info must always come from the network.
  if (url.pathname === new URL(self.location.href).pathname || url.pathname.endsWith("/build-info.json")) return;
  event.respondWith(request.mode === "navigate" ? navigation(request) : asset(request));
});

/** Share target: keep the shared files for the page and send the browser to the app. */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((f) => typeof f === "object" && f.size > 0);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const cache = await caches.open(SHARE_CACHE);
    let n = 0;
    for (const file of files) {
      const key = scoped(`share-files/${id}/${n++}/${encodeURIComponent(file.name || "shared-file")}`);
      await cache.put(key, new Response(file, { headers: { "content-type": file.type || "application/octet-stream" } }));
    }
    return Response.redirect(scoped(files.length ? `?share=${id}` : "./"), 303);
  } catch {
    return Response.redirect(scoped("./"), 303);
  }
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const previous = await previousCaches();
  const missing = [];
  for (const [path, revision] of PRECACHE) {
    if (!(await reuse(cache, previous, path, revision))) missing.push(path);
  }
  for (let i = 0; i < missing.length; i += BATCH) {
    await Promise.all(missing.slice(i, i + BATCH).map((path) => download(cache, path)));
  }
  const revisions = Object.fromEntries(PRECACHE);
  await cache.put(scoped(META), new Response(JSON.stringify(revisions), { headers: { "content-type": "application/json" } }));
}

/** Older OpenFini caches together with the revisions they were built from. */
async function previousCaches() {
  const result = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX) || name === CACHE_NAME) continue;
    try {
      const cache = await caches.open(name);
      const meta = await cache.match(scoped(META));
      if (meta) result.push({ cache, revisions: await meta.json() });
    } catch {
      // An unreadable old cache is simply not reused.
    }
  }
  return result;
}

async function reuse(cache, previous, path, revision) {
  for (const old of previous) {
    if (old.revisions[path] !== revision) continue;
    const response = await old.cache.match(scoped(path));
    if (response) {
      await cache.put(scoped(path), response);
      return true;
    }
  }
  return false;
}

async function download(cache, path) {
  // "reload" skips the HTTP cache so a fresh deploy is never mixed with stale files.
  const response = await fetch(new Request(scoped(path), { cache: "reload" }));
  if (!response.ok) throw new Error(`OpenFini precache: ${path} returned ${response.status}`);
  await cache.put(scoped(path), await withoutRedirect(response));
}

/** A redirected response cannot be served to a navigation; store a clean copy. */
async function withoutRedirect(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function activate() {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
  await self.clients.claim();
}

async function removeSelf() {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
  await self.registration.unregister();
}

/** Page loads: always the app shell, whatever the query string says. */
async function navigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const shell = await cache.match(scoped(INDEX), { ignoreVary: true });
  if (shell) return shell;
  try {
    return await fetch(request);
  } catch {
    return offlinePage();
  }
}

/** Everything else: cache first, then network (and remember what the network returned). */
async function asset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    return Response.error();
  }
}

function offlinePage() {
  const html =
    '<!doctype html><html lang="en-US"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="dark light"><title>OpenFini is offline</title>' +
    "<style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#1c1d21;color:#e6e6ea;font:16px system-ui,sans-serif}" +
    "main{max-width:28rem;padding:1.5rem;text-align:center}h1{font-size:1.25rem}</style>" +
    "<main><h1>OpenFini is offline</h1><p>The app has not been saved for offline use yet. Connect to the internet once, reload, and it will work without a connection from then on.</p></main></html>";
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
}
