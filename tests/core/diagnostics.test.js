import { test } from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../../app/src/core/log.js";
import { groupProblems, hintFor, buildReport, buildBundleFiles, buildIssueUrl, buildInventory, describeKey, browserInfo, environmentSummary, environmentLines, problemSummary, inventoryText } from "../../app/src/core/diagnostics.js";

const logger = () => {
  let t = 1_700_000_000_000;
  return new Logger({ now: () => (t += 1000), minLevel: "debug" });
};
const env = () => ({
  app: { version: "0.3.0", buildId: "0.3.0-abc12345", mode: "browser", safeMode: false, offlineMode: false },
  platform: { os: "windows", userAgent: "Mozilla/5.0 Chrome/130.0.0.0", browser: { name: "Chrome", version: "130.0.0.0" } },
  perf: { low: false },
  prefs: { theme: "dark", apiKey: "sk-abcdefghijklmnopqrstuvwx", note: "C:\\Users\\jane\\x" },
  storage: { usage: 1234, quota: 99999 },
});

test("hints: known problems are recognized, unknown ones are not", () => {
  const h = (level, scope, msg) => hintFor({ level, scope, msg });
  assert.equal(h("error", "storage", "QuotaExceededError: The quota has been exceeded").id, "storage-quota");
  assert.equal(h("error", "ai", "Provider returned 401 Unauthorized").id, "ai-auth");
  assert.equal(h("error", "ai", "429 Too Many Requests").id, "ai-rate");
  assert.equal(h("error", "ai", "TypeError: Failed to fetch").id, "ai-network");
  assert.equal(h("error", "ai", "Offline mode is on, so nothing was sent").id, "ai-offline");
  assert.equal(h("warn", "csp", "Blocked script-src https://evil.test").id, "csp");
  assert.equal(h("error", "app", "Failed to load font Inter 400").id, "font");
  assert.equal(h("error", "app", "RangeError: Invalid array length").id, "memory");
  assert.equal(h("warn", "app", "ResizeObserver loop completed with undelivered notifications").benign, true);
  assert.equal(h("error", "app", "something nobody has seen before"), null);
});

test("groupProblems groups by message shape, counts repeats, sorts errors first and hides benign notices", () => {
  const l = logger();
  l.warn("net", "Failed to load https://a.test/x.js (retry 1)");
  l.warn("net", "Failed to load https://b.test/y.js (retry 2)");
  l.error("app", "boom 1");
  l.error("app", "boom 2");
  l.error("app", "boom 3");
  l.error("ai", "request failed: 401");
  l.warn("app", "ResizeObserver loop limit exceeded");
  l.info("app", "just info");
  const g = groupProblems(l.entries());
  assert.equal(g.length, 3);
  assert.equal(g[0].level, "error");
  assert.equal(g[0].count, 3, "numbers do not split a group");
  assert.equal(g.at(-1).level, "warn");
  assert.equal(g.at(-1).count, 2);
  assert.ok(g.some((p) => p.hint?.id === "ai-auth"));
  assert.equal(groupProblems(l.entries(), { includeBenign: true }).length, 4);
  assert.match(problemSummary(g), /\[error\]/);
  assert.equal(problemSummary([]), "No warnings or errors were logged.");
});

test("buildReport: contains summary, problems, environment and log, with secrets removed", () => {
  const l = logger();
  l.error("ai", "request to https://x.test?token=SECRET99 failed with sk-abcdefghijklmnopqrstuvwx");
  const text = buildReport({ env: env(), entries: l.entries(), generatedAt: 0 });
  for (const part of ["# OpenFini diagnostic report", "Summary: OpenFini 0.3.0 (build abc12345)", "## Problems", "## Environment", "## Recent log (1 of 1 entries)", "app.version: 0.3.0", "platform.browser.name: Chrome"]) assert.ok(text.includes(part), part);
  assert.ok(!/SECRET99|sk-abcdefghijkl|jane/.test(text), "secrets and user names are removed");
  assert.match(text, /prefs\.apiKey: \[redacted\]/);
});

test("buildReport honors maxEntries and handles an empty log", () => {
  const l = logger();
  for (let i = 0; i < 30; i++) l.warn("x", `warning number ${i} unique${"abcdefghij"[i % 10]}${"klmnopqrst"[(i / 3) | 0]}`);
  const text = buildReport({ env: env(), entries: l.entries(), maxEntries: 5 });
  assert.match(text, /Recent log \(5 of 30 entries\)/);
  assert.match(buildReport({ env: env(), entries: [] }), /No warnings or errors were logged\.[\s\S]*The log is empty\./);
});

test("buildBundleFiles never contains documents or keys and lists its files", () => {
  const l = logger();
  l.error("app", "failed sk-abcdefghijklmnopqrstuvwx");
  const inv = buildInventory({ kv: [{ key: "session", bytes: 10 }], local: [], estimate: {} });
  const files = buildBundleFiles({ env: env(), entries: l.entries(), inventory: inv, generatedAt: 0 });
  assert.deepEqual(Object.keys(files).sort(), ["README.txt", "environment.json", "log.json", "log.txt", "report.txt", "storage.json"]);
  for (const [name, content] of Object.entries(files)) assert.ok(!/sk-abcdefghijkl|jane/.test(content), name);
  assert.equal(JSON.parse(files["environment.json"]).prefs.apiKey, "[redacted]");
  assert.equal(JSON.parse(files["log.json"]).entries[0].message, "failed [redacted-key]");
  assert.ok(!("storage.json" in buildBundleFiles({ env: env(), entries: [] })));
});

test("buildIssueUrl: prefilled bug-report form, redacted, below the length limit", () => {
  const l = logger();
  for (let i = 0; i < 200; i++) l.error("app", `error ${"x".repeat(80)} unique ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i / 26) | 0))} token=SECRET${i}`);
  const r = buildIssueUrl({ env: env(), entries: l.entries(), title: "Crash on save", note: "It broke", maxLength: 3000 });
  assert.ok(r.url.startsWith("https://github.com/philppplik/open-fini/issues/new?template=bug_report.yml"));
  assert.ok(r.url.length <= 3000, String(r.length));
  assert.equal(r.truncated, true);
  const q = new URL(r.url).searchParams;
  assert.equal(q.get("title"), "[Bug]: Crash on save");
  assert.equal(q.get("edition"), "In the browser");
  assert.match(q.get("version"), /0\.3\.0/);
  assert.equal(q.get("browser"), "Chrome 130.0.0.0");
  assert.ok(!/SECRET\d/.test(r.url));
  assert.ok(q.get("logs").includes("Environment: OpenFini 0.3.0"));
});

test("buildIssueUrl: small reports are not truncated and the log can be left out", () => {
  const l = logger();
  l.error("app", "one problem");
  const r = buildIssueUrl({ env: env(), entries: l.entries() });
  assert.equal(r.truncated, false);
  assert.match(new URL(r.url).searchParams.get("logs"), /one problem/);
  const none = buildIssueUrl({ env: env(), entries: l.entries(), includeLog: false });
  assert.ok(!/one problem/.test(new URL(none.url).searchParams.get("logs")));
});

test("inventory: keys, categories and sizes, file names hidden, no values", () => {
  const inv = buildInventory({
    kv: [{ key: "session", bytes: 5000 }, { key: "recent:My Secret Plan.ofini:123", bytes: 900 }, { key: "vibe.secrets", bytes: 80 }, { key: "weird", bytes: 1 }],
    local: [{ key: "openfini.prefs.v1", bytes: 300 }],
    caches: [{ name: "openfini-0.3.0-abc", entries: 12 }],
    estimate: { usage: 10, quota: 100 },
    generatedAt: 0,
  });
  assert.equal(inv.indexedDb.keys[0].key, "session");
  assert.ok(inv.indexedDb.keys.some((k) => k.key === "recent:<file 2>" || k.key.startsWith("recent:<file")));
  assert.ok(!JSON.stringify(inv).includes("Secret Plan"));
  assert.equal(inv.totals.kvBytes, 5981);
  assert.equal(inv.totals.byCategory.AI, 80);
  assert.equal(describeKey("vibe.secrets").sensitive, true);
  assert.equal(describeKey("openfini.prefs.v1", "local").category, "Settings");
  assert.match(inventoryText(inv), /Autosaved session/);
});

test("browserInfo recognizes common browsers and the desktop web view", () => {
  assert.deepEqual(browserInfo("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.5").name, "Edge");
  assert.equal(browserInfo("Mozilla/5.0 Gecko/20100101 Firefox/132.0").engine, "Gecko");
  assert.equal(browserInfo("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15").name, "Safari");
  assert.match(browserInfo("Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36", { isDesktop: true, os: "windows" }).webview, /WebView2/);
  assert.equal(browserInfo("").name, "Unknown");
  assert.match(environmentSummary(env()), /^OpenFini 0\.3\.0 \(build abc12345\) · browser · windows · Chrome 130/);
  assert.ok(environmentLines(env()).every((l) => !l.includes("jane")));
});
