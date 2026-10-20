// Request builders and deploy flows of the publish targets, against a mock fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "../../app/vendor/fflate/fflate.js";
import { netlify, vercel, vercelName, deployNetlify, deployVercel, deployGitHubPages, deployWebDav, dirsOf, davAuth, deploy, targetById, TARGETS, helperRequest } from "../../app/src/engine/publish/targets.js";
import { selectFiles, summarize, zipFiles, joinUrl } from "../../app/src/engine/publish/files.js";
import { preflight, summarizeIssues } from "../../app/src/engine/publish/preflight.js";
import { sha1Hex } from "../../app/src/engine/git/objects.js";

const enc = new TextEncoder();
const F = (path, s = "x") => ({ path, bytes: enc.encode(s) });
const files = [F("index.html", "<h1>1</h1>"), F("css/a.css", "a{}"), F("img/p.png", "png")];
const res = (status, body, headers = {}) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body), headers });
const noSleep = async () => {};

function mock(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", headers: init.headers || {}, body: init.body });
    return handler(url, init, calls) ?? res(404, { message: "unhandled" });
  };
  fn.calls = calls;
  return fn;
}

test("file selection: default and custom excludes, includes, dry-run summary", () => {
  const all = [F("index.html"), F(".DS_Store"), F(".git/HEAD"), F("src/app.js.map"), F("drafts/a.html"), F("img/big.psd", "xxxxxxxx")];
  assert.deepEqual(selectFiles(all).files.map((f) => f.path), ["index.html", "src/app.js.map", "drafts/a.html", "img/big.psd"]);
  assert.deepEqual(selectFiles(all, { exclude: "*.map\ndrafts/\n**/*.psd" }).files.map((f) => f.path), ["index.html"]);
  assert.deepEqual(selectFiles(all, { include: "*.html" }).files.map((f) => f.path), ["index.html", "drafts/a.html"]);
  const s = summarize(all);
  assert.equal(s.count, 6);
  assert.equal(s.largest[0].path, "img/big.psd");
  assert.deepEqual(Object.keys(unzipSync(zipFiles(files))).sort(), ["css/a.css", "img/p.png", "index.html"]);
  assert.equal(joinUrl("https://h/base/", "a b/c.html"), "https://h/base/a%20b/c.html");
});

test("Netlify: creates a site, uploads a zip, polls until ready", async () => {
  const f = mock((url, init, calls) => {
    if (url.endsWith("/api/v1/sites") && init.method === "POST") return res(201, { id: "S1", ssl_url: "https://x.netlify.app" });
    if (url.endsWith("/sites/S1/deploys")) return res(200, { id: "D1", state: "uploading" });
    if (url.endsWith("/deploys/D1")) return res(200, { id: "D1", state: calls.filter((c) => c.url.endsWith("/deploys/D1")).length > 1 ? "ready" : "processing" });
  });
  const r = await deployNetlify({ files, config: { siteName: "my-site" }, secret: "TOKEN", fetch: f, sleep: noSleep });
  assert.equal(r.url, "https://x.netlify.app");
  assert.deepEqual(r.config, { siteId: "S1" });
  const [create, dep] = f.calls;
  assert.equal(JSON.parse(create.body).name, "my-site");
  assert.equal(dep.headers["Content-Type"], "application/zip");
  assert.equal(dep.headers.Authorization, "Bearer TOKEN");
  assert.deepEqual(Object.keys(unzipSync(dep.body)).sort(), ["css/a.css", "img/p.png", "index.html"]);
  for (const c of f.calls) assert.ok(c.url.startsWith("https://api.netlify.com/"), "token only goes to Netlify");
  assert.equal(netlify.deploy("t", "a/b", new Uint8Array()).url, "https://api.netlify.com/api/v1/sites/a%2Fb/deploys");
  await assert.rejects(() => deployNetlify({ files, config: {}, secret: "", fetch: f }), (e) => e.code === "NO_SECRET");
  const bad = mock(() => res(401, { message: "Unauthorized" }));
  await assert.rejects(() => deployNetlify({ files, config: { siteId: "S" }, secret: "x", fetch: bad }), (e) => e.code === "AUTH");
});

test("Vercel: uploads files by digest, then creates the deployment", async () => {
  const f = mock((url, init) => {
    if (url.includes("/v2/files")) return res(200, {});
    if (url.includes("/v13/deployments") && init.method === "POST") return res(200, { id: "dpl_1", url: "my-site-abc.vercel.app", readyState: "BUILDING" });
    if (url.includes("/v13/deployments/dpl_1")) return res(200, { id: "dpl_1", url: "my-site-abc.vercel.app", readyState: "READY", alias: ["my-site.vercel.app"] });
  });
  const r = await deployVercel({ files, config: { projectName: "My Site!", teamId: "team_1" }, secret: "VT", fetch: f, sleep: noSleep });
  assert.equal(r.url, "https://my-site.vercel.app");
  const uploads = f.calls.filter((c) => c.url.includes("/v2/files"));
  assert.equal(uploads.length, 3);
  assert.ok(uploads.every((u) => u.url.endsWith("teamId=team_1") && u.headers["x-vercel-digest"].length === 40));
  assert.ok(uploads.some((u) => u.headers["x-vercel-digest"] === sha1Hex(enc.encode("a{}"))));
  const create = f.calls.find((c) => c.method === "POST" && c.url.includes("/v13/deployments"));
  const body = JSON.parse(create.body);
  assert.equal(body.name, "my-site");
  assert.equal(body.target, "production");
  assert.deepEqual(body.files.map((x) => x.file).sort(), ["css/a.css", "img/p.png", "index.html"]);
  assert.equal(vercelName("  Ünï Site__ "), "n-site");
  assert.equal(vercel.state("t", "d", "").url, "https://api.vercel.com/v13/deployments/d");
  const err = mock((url) => (url.includes("/v2/files") ? res(200, {}) : res(200, { id: "d", url: "u", readyState: "ERROR" })));
  await assert.rejects(() => deployVercel({ files, config: {}, secret: "x", fetch: err, sleep: noSleep }), /error/);
});

test("GitHub Pages: commits to a separate branch and enables Pages", async () => {
  const sha = (n) => String(n).padStart(40, "0");
  let blob = 0;
  const f = mock((url, init) => {
    const p = new URL(url).pathname;
    if (p === "/repos/me/site") return res(200, { default_branch: "main" });
    if (p === "/repos/me/site/git/ref/heads/gh-pages") return res(404, { message: "Not Found" });
    if (p.endsWith("/git/blobs")) return res(201, { sha: sha(++blob) });
    if (p.endsWith("/git/trees")) return res(201, { sha: sha(900) });
    if (p.endsWith("/git/commits")) return res(201, { sha: sha(901) });
    if (p.endsWith("/git/refs")) return res(201, {});
    if (p.endsWith("/pages") && init.method === "POST") return res(409, { message: "exists" });
    if (p.endsWith("/pages")) return res(200, { html_url: "https://me.github.io/site/" });
  });
  const r = await deployGitHubPages({ files, config: { repo: "https://github.com/me/site", branch: "gh-pages" }, secret: "ghp", fetch: f });
  assert.equal(r.url, "https://me.github.io/site/");
  const tree = JSON.parse(f.calls.find((c) => c.url.endsWith("/git/trees")).body).tree;
  assert.ok(tree.some((e) => e.path === ".nojekyll"));
  assert.equal(tree.length, 4);
  const commit = JSON.parse(f.calls.find((c) => c.url.endsWith("/git/commits")).body);
  assert.deepEqual(commit.parents, []);
  assert.equal(JSON.parse(f.calls.find((c) => c.url.endsWith("/git/refs")).body).ref, "refs/heads/gh-pages");
  for (const c of f.calls) assert.equal(new URL(c.url).hostname, "api.github.com");
  await assert.rejects(() => deployGitHubPages({ files, config: { repo: "me/site", branch: "main" }, secret: "t", fetch: f }), (e) => e.code === "BAD_CONFIG");
  await assert.rejects(() => deployGitHubPages({ files, config: { repo: "bad" }, secret: "t", fetch: f }), (e) => e.code === "BAD_CONFIG");
});

test("WebDAV: MKCOL for folders (parents first), then PUT with basic auth", async () => {
  const f = mock(() => res(201, {}));
  const r = await deployWebDav({ files: [...files, F("img/deep/x.png")], config: { url: "https://cloud.example.com/dav/site/", username: "me", mode: "webdav", publicUrl: "https://site.example.com" }, secret: "pw", fetch: f });
  assert.equal(r.url, "https://site.example.com");
  const mk = f.calls.filter((c) => c.method === "MKCOL").map((c) => c.url);
  assert.deepEqual(mk, ["https://cloud.example.com/dav/site/css/", "https://cloud.example.com/dav/site/img/", "https://cloud.example.com/dav/site/img/deep/"]);
  const puts = f.calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 4);
  assert.equal(puts[0].headers.Authorization, `Basic ${Buffer.from("me:pw").toString("base64")}`);
  assert.ok(puts.some((p) => p.url.endsWith("/img/p.png") && p.headers["Content-Type"] === "image/png"));
  const put = mock(() => res(204, null));
  await deployWebDav({ files, config: { url: "https://h.example/up", mode: "put", auth: "bearer" }, secret: "T", fetch: put });
  assert.ok(put.calls.every((c) => c.method === "PUT" && c.headers.Authorization === "Bearer T"));
  assert.deepEqual(dirsOf([F("a/b/c.txt"), F("a/d.txt")]), ["a", "a/b"]);
  assert.deepEqual(davAuth({ auth: "none" }, "x"), {});
  await assert.rejects(() => deployWebDav({ files, config: { url: "http://example.com/up", username: "u" }, secret: "pw", fetch: f }), /https/);
  await assert.rejects(() => deployWebDav({ files, config: { url: "ftp://x" }, secret: "pw", fetch: f }), (e) => e.code === "BAD_CONFIG");
});

test("network failures and cancellation are reported clearly", async () => {
  const down = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(() => deployNetlify({ files, config: { siteId: "S" }, secret: "t", fetch: down }), (e) => e.code === "NETWORK" && /CORS/.test(e.message));
  const abort = async () => {
    throw new DOMException("x", "AbortError");
  };
  await assert.rejects(() => deployNetlify({ files, config: { siteId: "S" }, secret: "t", fetch: abort }), (e) => e.name === "AbortError");
});

test("registry: honest about Cloudflare, helper request carries the target in a header", () => {
  assert.ok(TARGETS.every((t) => t.id && t.label));
  assert.match(targetById("cloudflare").unavailable, /BLAKE3/);
  assert.throws(() => deploy("cloudflare", {}), (e) => e.code === "UNAVAILABLE");
  const r = helperRequest({ helperUrl: "http://127.0.0.1:4310/", protocol: "ftp", host: "h", username: "u", remotePath: "/w" }, files, { token: "TT", password: "secret" });
  assert.equal(r.url, "http://127.0.0.1:4310/publish");
  assert.equal(r.init.headers.Authorization, "Bearer TT");
  const t = JSON.parse(Buffer.from(r.init.headers["X-OpenFini-Target"], "base64url").toString());
  assert.deepEqual([t.protocol, t.host, t.user, t.password], ["ftp", "h", "u", "secret"]);
});

test("preflight finds broken links, missing alt, title, meta and mixed content", () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <a href="about.html">About</a> <a href="missing.html">Gone</a> <a href="#nope">x</a> <a href="https://example.com">ext</a>
    <img src="img/p.png"><img src="img/none.png" alt="n"><script src="http://cdn.example/x.js"></script></body></html>`;
  const proj = { "index.html": html, "about.html": `<!doctype html><html lang="en"><head><title>About</title><meta name="viewport" content="width=device-width"><meta name="description" content="d"></head><body><p>Hi</p></body></html>`, "img/p.png": "p" };
  const src = { list: () => Object.keys(proj), readText: (p) => proj[p] ?? null, readBytes: (p) => (p in proj ? enc.encode(proj[p]) : null) };
  const issues = preflight(src);
  const codes = issues.map((i) => i.code);
  for (const c of ["link/broken", "link/anchor", "html/img-alt", "html/no-title", "html/no-viewport", "html/no-lang", "html/no-description", "html/mixed-content"]) assert.ok(codes.includes(c), c);
  assert.equal(issues.filter((i) => i.code === "link/broken").length, 2);
  assert.equal(issues.filter((i) => i.path === "about.html").length, 0);
  assert.match(summarizeIssues(issues), /2 errors/);
  assert.equal(summarizeIssues([]), "No problems found");
  assert.equal(preflight({ list: () => [], readText: () => null, readBytes: () => null })[0].code, "site/no-pages");
});
