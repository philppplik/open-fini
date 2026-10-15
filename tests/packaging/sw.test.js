import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import vm from "node:vm";

import { buildFixture, realSw } from "./_fixture.js";

const ORIGIN = "http://localhost";

// --- a tiny in-memory Cache Storage ------------------------------------------
const keyOf = (request) => (typeof request === "string" ? new URL(request, ORIGIN).href : request.url);

class MemoryCache {
  entries = new Map();
  async put(request, response) {
    this.entries.set(keyOf(request), {
      body: Buffer.from(await response.arrayBuffer()),
      init: { status: response.status, statusText: response.statusText, headers: [...response.headers] },
    });
  }
  async match(request) {
    const hit = this.entries.get(keyOf(request));
    return hit ? new Response(hit.body, hit.init) : undefined;
  }
}

class MemoryCaches {
  stores = new Map();
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new MemoryCache());
    return this.stores.get(name);
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name) {
    return this.stores.delete(name);
  }
}

/** Loads a service worker script into a sandbox that mimics ServiceWorkerGlobalScope. */
function loadWorker(code, { caches = new MemoryCaches(), fetchImpl } = {}) {
  const listeners = {};
  const calls = { skipWaiting: 0, claim: 0, unregister: 0, fetched: [] };
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    registration: { scope: `${ORIGIN}/`, unregister: async () => void calls.unregister++ },
    clients: { claim: async () => void calls.claim++ },
    skipWaiting: () => void calls.skipWaiting++,
    addEventListener: (type, fn) => void (listeners[type] = fn),
  };
  const fetchStub = async (request) => {
    calls.fetched.push(typeof request === "string" ? request : request.url);
    return fetchImpl(request);
  };
  vm.runInNewContext(code, { self, caches, fetch: fetchStub, Request, Response, URL, console });

  return {
    caches,
    calls,
    async dispatch(type, extra = {}) {
      const waits = [];
      await listeners[type]({ waitUntil: (p) => waits.push(p), ...extra });
      await Promise.all(waits);
    },
    /** Returns the response given to respondWith(), or undefined when the worker ignored the request. */
    async fetch(request) {
      let responded;
      listeners.fetch({ request, respondWith: (p) => void (responded = p) });
      return responded === undefined ? undefined : responded;
    },
    hasListener: (type) => type in listeners,
  };
}

describe("app/sw.js (built)", () => {
  let fx;
  let code;
  let files;

  before(async () => {
    fx = await buildFixture();
    code = await readFile(join(fx.out, "sw.js"), "utf8");
    files = new Map();
    for (const [path] of fx.result.manifest) files.set(`${ORIGIN}/${path}`, await readFile(join(fx.out, path)));
  });
  after(() => fx?.cleanup());

  const origin = async (request) => {
    const url = typeof request === "string" ? request : request.url;
    const body = files.get(url);
    return body ? new Response(body, { status: 200 }) : new Response("missing", { status: 404 });
  };
  const nav = (url) => ({ method: "GET", url, mode: "navigate" });
  const get = (url) => ({ method: "GET", url, mode: "cors" });

  it("precaches every manifest entry at install, without skipWaiting", async () => {
    const sw = loadWorker(code, { fetchImpl: origin });
    await sw.dispatch("install");
    const [cacheName] = await sw.caches.keys();
    assert.equal(cacheName, `openfini-${fx.result.version}`);
    const cache = await sw.caches.open(cacheName);
    for (const [path] of fx.result.manifest) assert.ok(await cache.match(`${ORIGIN}/${path}`), `${path} cached`);
    assert.equal(sw.calls.skipWaiting, 0, "updates must wait for the page");
  });

  it("fails the install when a file cannot be downloaded", async () => {
    const sw = loadWorker(code, { fetchImpl: async () => new Response("nope", { status: 500 }) });
    await assert.rejects(() => sw.dispatch("install"), /precache/);
  });

  it("copies unchanged files from the previous cache instead of downloading them", async () => {
    const caches = new MemoryCaches();
    const old = await caches.open("openfini-OLD");
    const [[reusedPath, reusedRevision], [changedPath]] = fx.result.manifest;
    await old.put(`${ORIGIN}/${reusedPath}`, new Response("FROM-OLD-CACHE"));
    await old.put(`${ORIGIN}/${changedPath}`, new Response("STALE"));
    await old.put(
      `${ORIGIN}/openfini-cache-meta.json`,
      new Response(JSON.stringify({ [reusedPath]: reusedRevision, [changedPath]: "000000000000" })),
    );

    const sw = loadWorker(code, { caches, fetchImpl: origin });
    await sw.dispatch("install");
    const cache = await caches.open(`openfini-${fx.result.version}`);
    assert.equal(await (await cache.match(`${ORIGIN}/${reusedPath}`)).text(), "FROM-OLD-CACHE");
    assert.ok(!sw.calls.fetched.includes(`${ORIGIN}/${reusedPath}`), "unchanged file not downloaded");
    assert.ok(sw.calls.fetched.includes(`${ORIGIN}/${changedPath}`), "changed file downloaded");
    assert.notEqual(await (await cache.match(`${ORIGIN}/${changedPath}`)).text(), "STALE");

    await sw.dispatch("activate");
    assert.deepEqual(await caches.keys(), [`openfini-${fx.result.version}`], "stale cache removed");
    assert.equal(sw.calls.claim, 1);
  });

  it("only skips waiting when the page asks for it", async () => {
    const sw = loadWorker(code, { fetchImpl: origin });
    await sw.dispatch("message", { data: { type: "SOMETHING_ELSE" } });
    await sw.dispatch("message", { data: null });
    assert.equal(sw.calls.skipWaiting, 0);
    await sw.dispatch("message", { data: { type: "SKIP_WAITING" } });
    assert.equal(sw.calls.skipWaiting, 1);
  });

  it("serves cached files first and the app shell for every navigation", async () => {
    const sw = loadWorker(code, { fetchImpl: origin });
    await sw.dispatch("install");
    const offline = loadWorker(code, { caches: sw.caches, fetchImpl: async () => Promise.reject(new TypeError("offline")) });

    const shell = await (await offline.fetch(nav(`${ORIGIN}/?studio=vector`))).text();
    assert.equal(shell, files.get(`${ORIGIN}/index.html`).toString());

    const [asset] = fx.result.manifest.map(([p]) => p).filter((p) => p.endsWith(".css"));
    const css = await offline.fetch(get(`${ORIGIN}/${asset}`));
    assert.equal(css.status, 200);
    assert.equal(offline.calls.fetched.length, 0, "no network access while offline");
  });

  it("shows an offline page when nothing is cached and the network is gone", async () => {
    const sw = loadWorker(code, { fetchImpl: async () => Promise.reject(new TypeError("offline")) });
    const page = await sw.fetch(nav(`${ORIGIN}/`));
    assert.equal(page.status, 503);
    assert.match(await page.text(), /OpenFini is offline/);
  });

  it("ignores requests it must not touch", async () => {
    const sw = loadWorker(code, { fetchImpl: origin });
    assert.equal(await sw.fetch({ method: "POST", url: `${ORIGIN}/x`, mode: "cors" }), undefined);
    assert.equal(await sw.fetch(get("https://example.com/x.js")), undefined, "cross-origin");
    assert.equal(await sw.fetch(get(`${ORIGIN}/sw.js`)), undefined, "the worker script itself");
    assert.equal(await sw.fetch(get(`${ORIGIN}/build-info.json`)), undefined, "build info is always fresh");
  });

  it("deletes older caches on activate", async () => {
    const caches = new MemoryCaches();
    await caches.open("openfini-1.0.0-aaaa");
    await caches.open("someone-elses-cache");
    const sw = loadWorker(code, { caches, fetchImpl: origin });
    await sw.dispatch("install");
    await sw.dispatch("activate");
    assert.deepEqual((await caches.keys()).sort(), [`openfini-${fx.result.version}`, "someone-elses-cache"].sort());
  });
});

describe("app/sw.js (development, tokens not injected)", () => {
  it("does not intercept anything and removes itself", async () => {
    const source = await readFile(realSw, "utf8");
    const caches = new MemoryCaches();
    await caches.open("openfini-leftover");
    const sw = loadWorker(source, { caches, fetchImpl: async () => new Response("x") });

    await sw.dispatch("install");
    assert.equal(sw.calls.fetched.length, 0, "nothing is precached in development");
    assert.equal(await sw.fetch({ method: "GET", url: `${ORIGIN}/index.html`, mode: "navigate" }), undefined);

    await sw.dispatch("activate");
    assert.equal(sw.calls.unregister, 1);
    assert.deepEqual(await caches.keys(), []);
  });
});
