import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { parseHtml, select, textOf, extractTables, tablesToMarkdown, extractLinks, extractMeta, parseRobots, robotsAllows, parseSitemap, crawl, httpRequest } from "../../app/src/vibe/web-scrape.js";
import { addTextSource, addFiles, listSources, searchWithCitations, chunkPositions } from "../../app/src/vibe/knowledge-sources.js";
import { KnowledgeIndex } from "../../app/src/ai/rag.js";
import { calculate, convertUnits, dateMath, applyPatch, searchFiles, runSandboxed, sandboxSource } from "../../app/src/vibe/utility-lib.js";
import { checkCommand, resolveCwd, parseArgv, tunnelUrl, programName } from "../../app/src/vibe/terminal-policy.js";
import { TOOL_GROUPS, createOpenFiniTools } from "../../app/src/vibe/tools/index.js";
import { ONCE_ONLY_TOOLS } from "../../app/src/vibe/web-hosts.js";
import { tokenOk } from "../../scripts/relay.mjs";
import { normalizeRelay } from "../../app/src/collab/crypto.js";
import { fakeApp } from "./helpers.js";

const PAGE = `<!doctype html><html lang="en"><head><title>Shop &amp; Co</title><meta name="description" content="Things"><meta property="og:title" content="OG"><link rel="canonical" href="/home"></head>
<body><nav><a href="/a">A</a></nav><div id="main" class="list"><p class="item price">10 €</p><p class="item">20 €<p class="item" data-x="y">30 €</div>
<table><caption>Prices</caption><tr><th>Name<th>Price</tr><tr><td>Tea</td><td>3</td></tr></table>
<a href="https://other.org/x">ext</a><a href="/b#frag">B</a><a href="javascript:1">no</a><script>evil()</script></body></html>`;

test("selector extraction: tags, ids, classes, attributes, combinators, implicit closes", () => {
  const root = parseHtml(PAGE);
  assert.deepEqual(select(root, "#main .item").map(textOf), ["10 €", "20 €", "30 €"]);
  assert.deepEqual(select(root, "div > p.price").map(textOf), ["10 €"]);
  assert.deepEqual(select(root, "p[data-x=y]").map(textOf), ["30 €"]);
  assert.equal(select(root, "script").length, 0, "scripts are dropped");
  assert.throws(() => select(root, "p:hover"), /Unsupported/);
});

test("tables, links and metadata", () => {
  const t = extractTables(PAGE);
  assert.deepEqual(t[0].rows, [["Name", "Price"], ["Tea", "3"]]);
  assert.match(tablesToMarkdown(t), /Table 1: Prices\n\| Name \| Price \|/);
  const links = extractLinks(PAGE, "https://shop.example/x/");
  assert.deepEqual(links.map((l) => [l.url, l.internal]), [["https://shop.example/a", true], ["https://other.org/x", false], ["https://shop.example/b", true]]);
  const m = extractMeta(PAGE, "https://shop.example/");
  assert.equal(m.title, "Shop & Co");
  assert.equal(m.canonical, "https://shop.example/home");
  assert.equal(m.meta["og:title"], "OG");
});

test("robots.txt and sitemaps", () => {
  const r = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/ok\nCrawl-delay: 2\nSitemap: https://s.example/sm.xml\n\nUser-agent: badbot\nDisallow: /");
  assert.equal(r.crawlDelay, 2);
  assert.ok(!robotsAllows(r, "/private/x"));
  assert.ok(robotsAllows(r, "/private/ok/1"));
  assert.ok(robotsAllows(r, "/public"));
  assert.deepEqual(r.sitemaps, ["https://s.example/sm.xml"]);
  assert.ok(!robotsAllows(parseRobots("User-agent: openfini\nDisallow: /\nUser-agent: *\nAllow: /"), "/x"), "a group naming OpenFini wins");
  assert.deepEqual(parseSitemap("<urlset><url><loc>https://a.example/1</loc></url><url><loc> https://a.example/2 </loc></url></urlset>").urls, ["https://a.example/1", "https://a.example/2"]);
});

const res = (body, { status = 200, type = "text/html" } = {}) => new Response(body, { status, headers: { "content-type": type } });

test("crawl: same origin, robots, delay, caps and progress (mocked fetch)", async () => {
  const site = {
    "https://s.example/robots.txt": res("User-agent: *\nDisallow: /secret\nCrawl-delay: 3", { type: "text/plain" }),
    "https://s.example/": res('<title>Home</title><a href="/p1">1</a><a href="/secret">s</a><a href="https://evil.org/">x</a><a href="/p2">2</a>'),
    "https://s.example/p1": res('<title>P1</title><a href="/p3">3</a>'),
    "https://s.example/p2": res("<title>P2</title>"),
  };
  const fetched = [];
  const sleeps = [];
  const progress = [];
  const fetchImpl = async (u) => (fetched.push(u), site[u]?.clone?.() || res("nope", { status: 404 }));
  const r = await crawl("https://s.example/", { enabled: true }, { fetchImpl, sleep: async (ms) => sleeps.push(ms), maxPages: 3, maxDepth: 1, onProgress: (p) => progress.push(p.done) });
  assert.deepEqual(r.pages.map((p) => p.title), ["Home", "P1", "P2"]);
  assert.ok(!fetched.some((u) => u.includes("evil.org") || u.includes("/secret")), "never leaves the origin or enters disallowed paths");
  assert.deepEqual(r.skipped.map((s) => s.reason), ["robots.txt"]);
  assert.ok(sleeps.every((ms) => ms === 3000), "Crawl-delay is honored");
  assert.deepEqual(progress, [1, 2, 3]);
  const capped = await crawl("https://s.example/", { enabled: true }, { fetchImpl, sleep: async () => {}, maxPages: 999, maxDepth: 99 });
  assert.ok(capped.pages.length <= 25);
  await assert.rejects(crawl("http://127.0.0.1/", { enabled: true }, { fetchImpl }), /blocked/);
});

test("http_request: allowlist, methods, headers, no redirects (mocked fetch)", async () => {
  const web = { enabled: true, apiDomains: ["api.example.com"] };
  let seen;
  const fetchImpl = async (u, init) => ((seen = { u, init }), res('{"ok":1}', { type: "application/json" }));
  await assert.rejects(httpRequest("https://other.example/x", web, { fetchImpl }), /allowlist/);
  await assert.rejects(httpRequest("https://api.example.com/x", web, { fetchImpl, method: "TRACE" }), /not allowed/);
  await assert.rejects(httpRequest("https://api.example.com/x", web, { fetchImpl, headers: { Cookie: "a" } }), /cannot be set/);
  const r = await httpRequest("https://v1.api.example.com/items", web, { fetchImpl, method: "post", body: { a: 1 } });
  assert.deepEqual(r.json, { ok: 1 });
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.credentials, "omit");
  assert.equal(seen.init.redirect, "manual");
  assert.equal(seen.init.headers["Content-Type"], "application/json");
  await assert.rejects(httpRequest("https://api.example.com/r", web, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } }) }), /redirect/);
});

test("knowledge sources: chunk positions, caps, citations, BM25 without network", async () => {
  const idx = new KnowledgeIndex({ chunkSize: 200, overlap: 20 });
  const text = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} talks about ${i === 24 ? "zebras and quaggas" : "ordinary things"}.`).join("\n");
  await addTextSource(idx, { id: "notes.md", title: "notes.md", text, source: "notes.md", kind: "file" });
  const r = await searchWithCitations(idx, "quaggas", 3);
  assert.equal(r.results[0].source, "notes.md");
  const hitLine = r.results[0].line;
  assert.ok(hitLine >= 1 && hitLine <= 25 && text.split("\n").slice(hitLine - 1).join("\n").includes("quaggas"));
  assert.match(r.cite, /^\[1\] notes\.md:\d+/);
  assert.deepEqual(chunkPositions("a\nb\nc", ["b\nc"]), [{ char: 2, line: 2 }]);
  const files = [{ path: "a.md", text: "alpha" }, { path: "b.png", bytes: new Uint8Array(3) }, { path: "c.txt", text: "x".repeat(3 * 1024 * 1024) }, { path: "d.js", text: "const delta = 1;" }];
  const f = await addFiles(idx, files, { prefix: "p" });
  assert.deepEqual(f.added, ["a.md", "d.js"]);
  assert.deepEqual(f.skipped.map((s) => s.path), ["b.png", "c.txt"]);
  assert.equal(listSources(idx).length, 3);
  // JSON round trip keeps positions
  const back = KnowledgeIndex.fromJSON(JSON.parse(JSON.stringify(idx.toJSON())));
  assert.equal((await searchWithCitations(back, "quaggas", 1)).results[0].line, hitLine);
});

test("calculator, units and dates", () => {
  assert.equal(calculate("2 + 3 * 4 ^ 2"), 50);
  assert.equal(calculate("-(2^2)"), -4);
  assert.equal(calculate("2^3^2"), 512);
  assert.equal(calculate("5! / 10 % 7"), 5);
  assert.ok(Math.abs(calculate("sqrt(2) * sqrt(2)") - 2) < 1e-12);
  assert.equal(calculate("max(1, pi, 3)"), Math.PI);
  assert.throws(() => calculate("alert(1)"), /Unknown function/);
  assert.throws(() => calculate("constructor"), /Unknown name/);
  assert.throws(() => calculate("constructor(1)"), /Unknown function/);
  assert.ok(Math.abs(convertUnits(1, "mi", "km") - 1.609344) < 1e-9);
  assert.ok(Math.abs(convertUnits(212, "F", "C") - 100) < 1e-9);
  assert.equal(convertUnits(1, "MiB", "KiB"), 1024);
  assert.throws(() => convertUnits(1, "kg", "m"), /Cannot convert/);
  assert.equal(dateMath({ op: "add", date: "2026-01-31", amount: 1, unit: "days" }).result, "2026-02-01T00:00:00.000Z");
  assert.equal(dateMath({ op: "diff", date: "2026-01-01", other: "2026-03-01" }).days, 59);
  assert.deepEqual([dateMath({ date: "2026-01-01" }).weekday, dateMath({ date: "2026-01-01" }).isoWeek], ["Thursday", 1]);
});

test("unified diff application and file search", () => {
  const src = "a\nb\nc\nd\ne";
  assert.equal(applyPatch(src, "--- x\n+++ x\n@@ -2,2 +2,3 @@\n b\n-c\n+C\n+C2\n@@ -5,1 +6,1 @@\n-e\n+E"), "a\nb\nC\nC2\nd\nE");
  assert.throws(() => applyPatch(src, "@@ -1,1 +1,1 @@\n-zzz\n+y"), /does not match/);
  const files = [{ path: "css/a.css", text: "body{}\n.btn{color:red}" }, { path: "index.html", text: "<p class=btn>" }];
  assert.deepEqual(searchFiles(files, "btn").map((m) => [m.path, m.line]), [["css/a.css", 2], ["index.html", 1]]);
  assert.deepEqual(searchFiles(files, "btn", { glob: "**/*.css" }).length, 1);
  assert.equal(searchFiles(files, "^body", { regex: true })[0].line, 1);
});

/** A worker stand-in that runs the real sandbox source in a fresh VM context (with network globals present). */
const vmWorker = (src) => {
  const w = { onmessage: null, onerror: null, terminated: false, terminate() { this.terminated = true; } };
  const self = { fetch: () => "LEAK", WebSocket: function () {}, postMessage: (d) => setTimeout(() => w.onmessage?.({ data: d })), onmessage: null };
  const ctx = vm.createContext({ self, setTimeout, JSON, Object, String, Promise });
  try {
    vm.runInContext(src, ctx, { timeout: 1000 });
  } catch (e) {
    setTimeout(() => w.onerror?.(e));
  }
  w.postMessage = () => self.onmessage?.({ data: "run" });
  w.self = self;
  return w;
};

test("run_code sandbox: result, console output, no network, time limit", async () => {
  const r = await runSandboxed("console.log('hi', {a:1}); return [1,2,3].reduce((a,b)=>a+b,0);", { createWorker: vmWorker });
  assert.equal(r.result, 6);
  assert.deepEqual([...r.logs], ['hi {"a":1}']);
  const leak = await runSandboxed("return [typeof fetch, typeof self.fetch, typeof WebSocket];", { createWorker: vmWorker });
  assert.deepEqual([...leak.result], ["undefined", "undefined", "undefined"]);
  await assert.rejects(runSandboxed("throw new Error('boom')", { createWorker: vmWorker }), /boom/);
  const never = () => ({ terminate() { this.t = true; }, postMessage() {} });
  await assert.rejects(runSandboxed("while(true){}", { timeoutMs: 20, createWorker: never }), /longer than/);
  assert.match(sandboxSource("return 1"), /const __run = async \(\) => \{\nreturn 1\n\};/);
});

test("terminal policy: off by default, allow/deny, no shells, cwd inside opened folders", () => {
  const on = { enabled: true };
  assert.match(checkCommand(["git", "status"], {}), /switched off/);
  assert.equal(checkCommand(["git", "status"], on), null);
  assert.equal(checkCommand(["npm.cmd", "test"], on), null);
  assert.match(checkCommand(["bash", "-c", "rm -rf /"], { ...on, allow: ["bash"] }), /Shells/);
  assert.match(checkCommand(["rm", "-rf", "x"], { ...on, allow: ["rm"] }), /deny list/);
  assert.match(checkCommand(["curl", "x"], on), /deny list/);
  assert.match(checkCommand(["whoami"], on), /allow list/);
  assert.match(checkCommand(["git", "push", "--force"], on), /deny pattern/);
  assert.match(checkCommand(["npm", "i", "-g", "x"], on), /deny pattern/);
  assert.match(checkCommand(["/bin/git"], on), /by name/);
  assert.match(checkCommand(["git", "a\nb"], on), /line breaks/);
  assert.equal(programName("C:\\x\\Git.EXE"), "git");
  assert.equal(resolveCwd("", ["C:\\work\\site"]), "C:/work/site");
  assert.equal(resolveCwd("src/../lib", ["/home/u/p"]), "/home/u/p/lib");
  assert.throws(() => resolveCwd("../../etc", ["/home/u/p"]), /outside/);
  assert.throws(() => resolveCwd("/home/u/proj2", ["/home/u/p"]), /outside/);
  assert.throws(() => resolveCwd("x", []), /Open a folder/);
  assert.deepEqual(parseArgv(`git commit -m "two words" ''`), ["git", "commit", "-m", "two words", ""]);
  assert.throws(() => parseArgv("ls | rm"), /operator/);
});

test("tunnel URLs, relay key and relay addresses with ?key=", () => {
  assert.equal(tunnelUrl("cloudflared", "INF |  https://brave-cat-1.trycloudflare.com  |"), "https://brave-cat-1.trycloudflare.com");
  assert.equal(tunnelUrl("ngrok", 't=1 msg="started tunnel" url=https://ab12.ngrok-free.app'), "https://ab12.ngrok-free.app");
  assert.equal(tunnelUrl("tailscale", "Available on the internet:\nhttps://pc.tail1234.ts.net/"), "https://pc.tail1234.ts.net/");
  assert.equal(tunnelUrl("ngrok", "nothing"), "");
  assert.ok(tokenOk("/?key=s3cret-token", "s3cret-token"));
  assert.ok(!tokenOk("/?key=wrong", "s3cret-token"));
  assert.ok(!tokenOk("/", "s3cret-token"));
  assert.equal(normalizeRelay("wss://r.example/?key=abcdefgh12"), "wss://r.example/?key=abcdefgh12");
  assert.throws(() => normalizeRelay("wss://r.example/?x=1"), /query/);
  assert.throws(() => normalizeRelay("wss://r.example/?key=a b"), /query/);
});

test("new tools are registered, grouped and approval-gated", () => {
  const ctx = { knowledgeIndex: new KnowledgeIndex() };
  const tools = Object.fromEntries(createOpenFiniTools(fakeApp(), ctx).map((t) => [t.name, t]));
  const names = ["scrape_page", "crawl_site", "http_request", "rag_add_source", "rag_search", "rag_list", "rag_remove", "calculate", "convert_units", "date_calc", "run_code", "clipboard_read", "run_command", "apply_patch", "file_search"];
  const grouped = new Set(Object.values(TOOL_GROUPS).flat());
  for (const n of names) {
    assert.ok(tools[n], n);
    assert.ok(grouped.has(n), `${n} grouped`);
  }
  for (const n of ["crawl_site", "http_request", "run_command", "clipboard_read"]) assert.ok(tools[n].alwaysAsk && ONCE_ONLY_TOOLS.has(n), n);
  assert.match(tools.clipboard_read.needsApproval({}), /clipboard/);
  assert.equal(tools.run_command.needsApproval({ argv: ["git"] }), false, "terminal off: the run reports it");
});

test("rag tools end to end on the in-memory index", async () => {
  const ctx = { knowledgeIndex: new KnowledgeIndex(), saveKnowledge: async () => (ctx.saved = (ctx.saved || 0) + 1) };
  const tools = Object.fromEntries(createOpenFiniTools(fakeApp(), ctx).map((t) => [t.name, t]));
  const a = await tools.rag_add_source.run({ kind: "text", title: "Brand", text: "Our brand color is teal #0aa. Headlines use Inter." });
  assert.equal(a.added, 1);
  assert.equal(a.retrieval, "BM25 on this device");
  const s = await tools.rag_search.run({ query: "brand color" });
  assert.match(s.cite, /\[1\] note:Brand:1/);
  const l = await tools.rag_list.run({});
  assert.equal(l.total, 1);
  assert.deepEqual((await tools.rag_remove.run({ ids: [l.sources[0].id] })).removed, [l.sources[0].id]);
  assert.equal(ctx.saved, 2);
  assert.equal(await tools.calculate.run({ expression: "6*7" }).then((r) => r.result), 42);
});
