import test from "node:test";
import assert from "node:assert/strict";
import { historyMark, mergeSince } from "../../app/src/extensions/history.js";
import { History } from "../../app/src/core/history.js";
import { buildPanelDocument, buildMainDocument, resolveRef, FRAME_CSP, scriptUrl } from "../../app/src/extensions/html.js";
import { RUNTIME_SRC } from "../../app/src/extensions/runtime-src.js";
import { buildScaffold } from "../../app/src/extensions/scaffold.js";
import { validateManifest } from "../../app/src/extensions/manifest.js";

const entry = (label, n = 1) => ({ label, ops: Array.from({ length: n }, () => ({ undo() {}, redo() {} })), bytes: 10, touched: new Set([label]), structure: label === "b" });

test("every entry an extension command adds becomes one undo step", () => {
  const h = new History();
  h.push(entry("before"));
  const mark = historyMark(h);
  h.push(entry("a", 2));
  h.push(entry("b", 3));
  h.push(entry("c"));
  assert.equal(h.entries.length, 4);
  assert.equal(mergeSince(h, mark, "Ext: Grid"), 3);
  assert.equal(h.entries.length, 2);
  assert.equal(h.index, 2);
  const merged = h.entries[1];
  assert.equal(merged.label, "Ext: Grid");
  assert.equal(merged.ops.length, 6);
  assert.equal(merged.structure, true);
  assert.deepEqual([...merged.touched].sort(), ["a", "b", "c"]);
  assert.equal(h.undo().label, "Ext: Grid");
  assert.equal(h.index, 1);
});

test("a single entry is only relabeled; no entries do nothing", () => {
  const h = new History();
  const mark = historyMark(h);
  assert.equal(mergeSince(h, mark, "x"), 0);
  h.push(entry("one"));
  assert.equal(mergeSince(h, mark, "Ext: One"), 0);
  assert.equal(h.entries[0].label, "Ext: One");
});

test("merging is skipped when the old history was trimmed away", () => {
  const h = new History({ limitEntries: 3 });
  for (const n of ["1", "2", "3"]) h.push(entry(n));
  const mark = historyMark(h);
  for (const n of ["a", "b", "c"]) h.push(entry(n));
  assert.equal(mergeSince(h, mark, "Ext"), 0);
});

test("resolveRef finds package files and ignores URLs", () => {
  const files = { "panel/ui.js": 1, "shared.css": 1 };
  assert.equal(resolveRef("ui.js", "panel/index.html", files), "panel/ui.js");
  assert.equal(resolveRef("../shared.css", "panel/index.html", files), "shared.css");
  assert.equal(resolveRef("https://x.test/a.js", "panel/index.html", files), null);
  assert.equal(resolveRef("missing.js", "panel/index.html", files), null);
});

test("panel documents inline local scripts and styles, drop remote ones, and start with the CSP", () => {
  const enc = (s) => new TextEncoder().encode(s);
  const files = { "p/ui.js": enc("window.x = 1;"), "p/ui.css": enc("b{color:red}") };
  const html = `<!doctype html><html><head><base href="https://evil.test/"><link rel="stylesheet" href="ui.css"><link rel="stylesheet" href="https://evil.test/x.css"></head><body><script src="ui.js"></script><script src="https://evil.test/x.js"></script><script>alert(1)</script><img src="https://evil.test/p.gif"></body></html>`;
  const out = buildPanelDocument({ config: { id: "a.b" }, runtimeSrc: RUNTIME_SRC, html, htmlPath: "p/index.html", files });
  assert.ok(out.indexOf("Content-Security-Policy") < out.indexOf("<script"), "CSP comes before any script");
  assert.ok(out.includes(FRAME_CSP.replace(/"/g, "&quot;")));
  assert.ok(!/evil\.test\/(x\.js|x\.css)/.test(out) && !out.includes("<base"));
  assert.ok(out.includes("<style>b{color:red}</style>"));
  assert.ok(out.includes(scriptUrl("window.x = 1;")));
  assert.ok(!/<script\b[^>]*>[^<]/i.test(out), "no inline script bodies remain");
  assert.ok(/<script src="data:text\/javascript;charset=utf-8,__ofxBoot/.test(out) || out.includes(scriptUrl("__ofxBoot()")));
});

test("the main document carries config, the runtime and the extension code as data: scripts", () => {
  const out = buildMainDocument({ config: { id: "a.b", version: "1.0.0" }, runtimeSrc: RUNTIME_SRC, mainCode: "function activate(){}" });
  assert.ok(out.includes(scriptUrl("function activate(){}")));
  assert.ok(!out.includes("</script><script>"), "no inline scripts");
  assert.match(out, /connect-src 'none'/);
});

test("the runtime source is a self-contained IIFE", () => {
  assert.match(RUNTIME_SRC, /^\(function runtime\(\)/);
  assert.ok(RUNTIME_SRC.endsWith(")()"));
  assert.doesNotThrow(() => new Function(RUNTIME_SRC)); // parses
});

test("scaffolded extensions pass the manifest validator", () => {
  const s = buildScaffold({ name: "Hello Tools", description: "Says hello", permissions: ["ui"], commands: [{ id: "hello", title: "Say Hello", studios: ["vector"] }] });
  assert.equal(s.id, "local.hello-tools");
  const r = validateManifest(JSON.parse(s.files["openfini-extension.json"]), { hostVersion: "0.4.0" });
  assert.deepEqual(r.errors, []);
  assert.match(s.files["main.js"], /async function activate\(openfini\)/);
  assert.match(s.files["main.js"], /commands\.register\("hello"/);
  const custom = buildScaffold({ name: "X", mainJs: "// mine", commands: [{ title: "Run it" }] });
  assert.equal(custom.files["main.js"], "// mine\n");
  assert.equal(JSON.parse(custom.files["openfini-extension.json"]).contributes.commands[0].id, "run.it");
});
