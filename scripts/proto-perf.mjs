// Proto renderer benchmark (docs/concepts/proto-studio.md §4.3, task T3): runs tests/proto/perf/bench.html in a
// headless Chromium-based browser and prints frame times and latencies against the concept's targets.
//
//   node scripts/proto-perf.mjs                  every scenario
//   node scripts/proto-perf.mjs pan5k edit10k    some scenarios (open10k, pan5k, select5k, edit10k, lod20k)
//   node scripts/proto-perf.mjs --json           the raw results as JSON
//   node scripts/proto-perf.mjs --check          exit 1 when a target is missed
//   CHROME_PATH=/usr/bin/chromium node scripts/proto-perf.mjs
//
// Zero dependencies: a static server for the repository root (scripts/serve.mjs) and the DevTools protocol client of
// scripts/proto-record-geometry.mjs. Headless frame timing depends on the machine and its load; the reference numbers
// in docs/proto-studio.md were taken on the machine named there. Manual checks in WebView2, WKWebView and WebKitGTK
// open the same page by hand (`node scripts/serve.mjs --root .` → /tests/proto/perf/bench.html).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./serve.mjs";
import { launch, evaluate } from "./proto-record-geometry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const check = args.includes("--check");
const only = args.filter((a) => !a.startsWith("--"));

/** Targets of §4.3: [label, value from results, limit, "max" | "min"]. */
const TARGETS = [
  ["Pan, 50 frames and 5,000 visible layers: p95 frame time (ms)", (r) => r.pan5k?.pan.p95, 16.7 * 1.1, "max"],
  ["Zoom, 50 frames and 5,000 visible layers: p95 frame time (ms)", (r) => r.pan5k?.zoom.p95, 16.7 * 1.1, "max"],
  ["Pan, 200 frames and 20,000 layers, level of detail: fps", (r) => r.lod20k?.pan.fps, 30, "min"],
  ["Selection change: p95 (ms)", (r) => r.select5k?.selection.p95, 8, "max"],
  ["Hover highlight: p95 (ms)", (r) => r.select5k?.hover.p95, 8, "max"],
  ["Property edit to painted frame, 10,000 layers: p95 (ms)", (r) => r.edit10k?.p95, 50, "max"],
  ["Open 10,000 layers to first paint (ms)", (r) => r.open10k?.firstPaintMs, 1500, "max"],
  ["Memory, 10,000 layers: JS heap (MB)", (r) => r.open10k?.heapMB, 300, "max"],
];

async function main() {
  const server = createServer({ root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await launch({ width: 1920, height: 1080 });
  try {
    const { s } = browser;
    await s("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    const q = only.length ? `?only=${only.join(",")}` : "";
    await s("Page.navigate", { url: `http://127.0.0.1:${port}/tests/proto/perf/bench.html${q}` });
    let results = null;
    for (let i = 0; i < 600 && !results; i++) {
      await new Promise((r) => setTimeout(r, 500));
      results = await evaluate(s, "window.__protoPerf ? window.__protoPerf : null").catch(() => null);
    }
    if (!results) throw new Error("The benchmark did not finish in 5 minutes.");
    if (results.error) throw new Error(results.error);
    results.browser = browser.product;
    if (json) {
      console.log(JSON.stringify(results, null, 2));
      return 0;
    }
    console.log(`Proto renderer benchmark — ${browser.product}, ${results.viewport}\n`);
    for (const [k, v] of Object.entries(results)) if (v && typeof v === "object") console.log(`${k}: ${JSON.stringify(v)}`);
    console.log("");
    let missed = 0;
    for (const [label, get, limit, kind] of TARGETS) {
      const v = get(results);
      if (v == null) continue;
      const ok = kind === "max" ? v <= limit : v >= limit;
      if (!ok) missed++;
      console.log(`${ok ? "ok  " : "MISS"}  ${label}: ${v} (target ${kind === "max" ? "≤" : "≥"} ${Math.round(limit * 10) / 10})`);
    }
    return check && missed ? 1 : 0;
  } finally {
    await browser.close();
    server.close();
  }
}

process.exitCode = await main();
