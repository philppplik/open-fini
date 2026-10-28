// Cheap permanent architecture checks (see "Keeping the app small and clean" in docs/development.md and
// docs/refactoring-audit.md). They run on the source with the dependency-free import graph, no build needed.
//
// - no circular static imports in app/src (core and engine in particular);
// - layering: core/ and engine/ never import UI, studios, commands or the Vibe runtime statically;
// - engine purity: engine code does not touch DOM or browser globals (web engine has its own, stricter test);
// - start-up closure: what index.html loads statically must not include the heavy, lazily loaded areas.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, findCycles, pathTo, staticClosure, stripComments } from "../../scripts/lib/import-graph.mjs";

const posix = (p) => p.split(sep).join("/");
const APP = posix(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "app"));
const graph = buildGraph({ roots: [`${APP}/src`, `${APP}/vendor/fflate`, `${APP}/vendor/polygon-clipping`] });
const rel = (f) => f.slice(APP.length + 1);
const under = (...dirs) => (f) => dirs.some((d) => f.startsWith(`${APP}/${d}`));
const ENTRIES = [`${APP}/src/main.js`, `${APP}/src/bootguard.js`];

/**
 * Areas that must stay out of the static start-up closure (they load with import() when used). Add an area here when
 * you make it lazy; remove one only deliberately (it costs start-up time on every launch).
 */
export const LAZY_AREAS = [
  "src/collab/", "src/ui/collab/",
  "src/vscode/", "src/extensions/", "src/ui/extensions/",
  "src/engine/office/", "src/ui/office/", "src/office/",
  "src/engine/formats/", "src/engine/git/", "src/engine/publish/",
  "src/ui/code/", "src/ui/vibe/", "src/vibe/", "src/ai/",
  "src/i18n/locales/",
  "src/ui/export-dialog.js",
  "src/engine/web/charcodec.js", "src/engine/web/texttools.js", // the palette loads texttools-catalog.js instead
  "vendor/pdfjs/", "vendor/codemirror/", "vendor/katex/",
];

test("graph sanity: the scan finds the app", () => {
  assert.ok(graph.size > 300, `only ${graph.size} modules found`);
  assert.ok(graph.has(`${APP}/src/core/app.js`));
});

test("no circular static imports in app/src", () => {
  const cycles = findCycles(graph, under("src/"));
  assert.deepEqual(cycles.map((c) => c.map(rel)), [], "break the cycle (move the shared helper down a layer) instead of allowing it");
});

test("layering: core/ and engine/ do not import UI, studios, commands or the Vibe runtime", () => {
  const banned = under("src/ui/", "src/studios/", "src/commands/", "src/vibe/");
  // core/app.js reads the studio registry, which is plain data (studios/registry.js imports nothing from the UI).
  const allowed = new Set([`${APP}/src/studios/registry.js`]);
  const bad = [];
  for (const [file, node] of graph) {
    if (!under("src/core/", "src/engine/")(file)) continue;
    for (const target of node.static) if (banned(target) && !allowed.has(target)) bad.push(`${rel(file)} -> ${rel(target)}`);
  }
  assert.deepEqual(bad, [], "pure layers must not depend on the UI; pass a callback or use import() for UI on demand");
  for (const target of graph.get(`${APP}/src/studios/registry.js`).static) assert.ok(!under("src/ui/")(target), "studios/registry.js must stay free of UI imports");
});

test("engine purity: no DOM or browser globals in app/src/engine", () => {
  // Property access on browser globals, outside comments and string literals. `typeof document` checks are fine.
  const GLOBALS = /(?<![\w$.])(document|window|navigator|localStorage|sessionStorage|location)\s*\.|(?<![\w$.])(fetch|requestAnimationFrame|XMLHttpRequest)\s*\(/g;
  const sample = stripComments('const a = document.body; x.window.y; "window.z"; // fetch(u)\nfetch(u);', { literals: false });
  assert.deepEqual([...sample.matchAll(GLOBALS)].map((m) => m[1] || m[2]), ["document", "fetch"], "the scan itself works");
  const bad = [];
  for (const file of graph.keys()) {
    if (!under("src/engine/")(file)) continue;
    const code = stripComments(readFileSync(file, "utf8"), { literals: false });
    const hits = new Set([...code.matchAll(GLOBALS)].map((m) => m[1] || m[2]));
    if (hits.size) bad.push(`${rel(file)}: ${[...hits].join(", ")}`);
  }
  assert.deepEqual(bad, [], "engines run in Node and workers: take what you need as a parameter");
});

test("start-up closure excludes the lazily loaded areas", () => {
  const closure = staticClosure(graph, ENTRIES);
  assert.ok(closure.size > 50, "the closure should contain the shell");
  const lazy = under(...LAZY_AREAS);
  const leaks = [...closure].filter(lazy).map((f) => `${rel(f)}  (via ${pathTo(graph, ENTRIES, f).map(rel).join(" -> ")})`);
  assert.deepEqual(leaks, [], "load these with import() where they are used");
});
