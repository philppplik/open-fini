import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { runScript, scriptSource, tsType, tsSignature, searchTools, diffFacts, measure, contrastRatio, diffPixels } from "../../app/src/vibe/script-lib.js";
import { createOpenFiniTools, TOOL_GROUPS } from "../../app/src/vibe/tools/index.js";
import { SCRIPT_BLOCKED } from "../../app/src/vibe/tools/script.js";
import { plainText } from "../../app/src/engine/layout/text-model.js";
import { fakeApp } from "./helpers.js";

// A Web Worker stand-in: the worker source runs in a vm context, messages go both ways asynchronously.
const vmWorker = (src) => {
  const w = { onmessage: null, onerror: null, terminated: false, terminate() { this.terminated = true; } };
  const self = { fetch: () => "LEAK", postMessage: (d) => setTimeout(() => !w.terminated && w.onmessage?.({ data: d })), onmessage: null };
  const ctx = vm.createContext({ self, setTimeout, JSON, Object, String, Promise, Map, Proxy, Error, Math, Array });
  try {
    vm.runInContext(src, ctx, { timeout: 1000 });
  } catch (e) {
    setTimeout(() => w.onerror?.(e));
  }
  w.postMessage = (d) => setTimeout(() => !w.terminated && self.onmessage?.({ data: d }));
  return w;
};

function setup() {
  const app = fakeApp();
  const ctx = { createWorker: vmWorker };
  const tools = createOpenFiniTools(app, ctx);
  const by = new Map(tools.map((t) => [t.name, t]));
  ctx.lookup = (n) => by.get(n);
  ctx.toolNames = () => [...by.keys()];
  const run = (name, args) => by.get(name).run(args, {});
  return { app, ctx, by, run };
}

test("runScript: tool calls through the bridge, proxy sugar, args, logs, errors", async () => {
  const seen = [];
  const call = async (name, args) => {
    seen.push([name, args]);
    if (name === "boom") throw new Error("nope");
    return { n: (args.n || 0) * 2 };
  };
  const r = await runScript("const a = await openfini.double({ n: args.start }); const b = await openfini.call('double', { n: a.n }); console.log('x', b); return b.n;", { args: { start: 3 }, call, createWorker: vmWorker });
  assert.equal(r.result, 12);
  assert.deepEqual(seen.map((s) => s[0]), ["double", "double"]);
  assert.deepEqual(r.calls.map((c) => c.ok), [true, true]);
  assert.deepEqual([...r.logs], ['x {"n":12}']);
  const caught = await runScript("try { await openfini.boom(); } catch (e) { return e.message; }", { call, createWorker: vmWorker });
  assert.equal(caught.result, "nope");
  await assert.rejects(runScript("throw new Error('bad')", { call, createWorker: vmWorker }), /bad/);
  await assert.rejects(runScript("for (let i = 0; i < 5; i++) await openfini.double({}); return 1;", { call, maxCalls: 3, createWorker: vmWorker }), /more than 3 tool calls/);
  const never = () => ({ terminate() {}, postMessage() {} });
  await assert.rejects(runScript("while(true){}", { timeoutMs: 20, call, createWorker: never }), /computed longer/);
  assert.match(scriptSource("return 1", { a: "</script>" }), /\\u003c\/script>/);
  const leak = await runScript("return [typeof fetch, typeof self.fetch];", { call, createWorker: vmWorker });
  assert.deepEqual([...leak.result], ["undefined", "undefined"]);
});

test("typed signatures and tool search", () => {
  assert.equal(tsType({ type: "object", properties: { a: { type: "string", enum: ["x", "y"] }, n: { type: "array", items: { type: "number" } } }, required: ["a"] }), '{ a: "x" | "y"; n?: number[] }');
  assert.equal(tsType({ anyOf: [{ type: "string" }, { type: "object" }] }), "string | object");
  const { by } = setup();
  assert.match(tsSignature(by.get("add_shape")), /^add_shape\(args: \{ type: "rect" \| "ellipse"/);
  assert.match(tsSignature(by.get("add_shape"), { full: true }), /\/\/ {3}x: Left in page px/);
  const hits = searchTools([...by.values()], "spreadsheet formula", { groups: TOOL_GROUPS });
  assert.equal(hits[0].tool.name, "sheet_set_formula");
  assert.ok(searchTools([...by.values()], "", { group: "whiteboard", groups: TOOL_GROUPS, limit: 40 }).every((h) => h.group === "Whiteboard"));
});

test("find_tools lists groups, searches and describes", async () => {
  const { run } = setup();
  assert.match((await run("find_tools", {})).groups["Scripting and checks"], /run_script/);
  assert.match((await run("find_tools", { query: "contrast alignment gaps" })).tools, /measure_layers\(args/);
  assert.match((await run("find_tools", { names: ["checkpoint"] })).tools, /\/\/ {3}action:/);
  await assert.rejects(run("find_tools", { names: ["nope_tool"] }), /Unknown tool/);
});

test("run_script edits in one undo step; dry run reports the diff and reverts", async () => {
  const { app, run } = setup();
  const doc = app.doc;
  const code = "const ids = []; for (let i = 0; i < args.n; i++) { const r = await openfini.add_shape({ type: 'rect', x: 40 + i * 120, y: 40, w: 100, h: 80, name: 'Card ' + (i + 1) }); ids.push(r.id); } await openfini.set_style({ ids, fill: '#ff0000' }); return ids.length;";
  const dry = await run("run_script", { code, args: { n: 3 }, dryRun: true });
  assert.equal(dry.diff.counts.added, 3);
  assert.equal(dry.undo, "reverted (dry run)");
  assert.equal(doc.history.index, 0);
  assert.equal(doc.history.entries.length, 0, "no redo tail is left behind");
  assert.equal(doc.pages[0].root.children.length, 0);

  const real = await run("run_script", { code, args: { n: 4 }, label: "Cards" });
  assert.equal(real.result, 4);
  assert.equal(real.toolCalls, 5);
  assert.equal(doc.pages[0].root.children.length, 4);
  assert.equal(doc.history.index, 1, "one undo step");
  assert.equal(doc.history.entries[0].label, "Cards");
  doc.undo();
  assert.equal(doc.pages[0].root.children.length, 0);
});

test("run_script refuses nested code, per-call approvals and non-revertible tools in a dry run", async () => {
  const { run } = setup();
  for (const n of ["run_plan", "run_script", "ask_user"]) assert.ok(SCRIPT_BLOCKED.has(n));
  await assert.rejects(run("run_script", { code: "await openfini.run_plan({ steps: [] });" }), /cannot run inside run_script/);
  await assert.rejects(run("run_script", { code: "await openfini.remember({ note: 'x' });" }), /needs the user's approval/);
  await assert.rejects(run("run_script", { code: "await openfini.write_file({ path: 'a.html', content: 'x' });", dryRun: true }), /cannot be dry-run/);
  await assert.rejects(run("run_script", { code: "await openfini.add_shape({ type: 'blob' });" }), /Invalid args for add_shape/);
  await assert.rejects(run("run_script", { code: "await openfini.add_shap({});" }), /Unknown tool .*add_shape/s);
});

test("a failing script keeps earlier edits in one step and says so", async () => {
  const { app, run } = setup();
  await assert.rejects(run("run_script", { code: "await openfini.add_shape({ type: 'rect', x: 0, y: 0, w: 10, h: 10 }); await openfini.add_shape({ type: 'ellipse', x: 0, y: 0, w: 10, h: 10 }); throw new Error('halfway');" }), /halfway.*2 tool call\(s\) had already succeeded/s);
  assert.equal(app.doc.history.index, 1);
});

test("checkpoint: save, diff, restore", async () => {
  const { app, run } = setup();
  const a = await run("add_shape", { type: "rect", x: 10, y: 10, w: 100, h: 50, name: "A", fill: "#112233" });
  assert.equal((await run("checkpoint", { action: "save", name: "base" })).layers, 1);
  await run("add_shape", { type: "ellipse", x: 200, y: 10, w: 50, h: 50, name: "B" });
  await run("transform_layers", { ids: [a.id], dx: 30 });
  const d = await run("checkpoint", { action: "diff", name: "base" });
  assert.equal(d.counts.added, 1);
  assert.deepEqual(d.changed[0].fields.x, [10, 40]);
  assert.equal((await run("checkpoint", { action: "list" })).checkpoints[0].restorable, true);
  const r = await run("restore_checkpoint", { name: "base" });
  assert.equal(r.undoneSteps, 2);
  assert.equal(app.doc.pages[0].root.children.length, 1);
  assert.equal((await run("checkpoint", { action: "diff", name: "base" })).counts.changed, 0);
  await assert.rejects(run("restore_checkpoint", { name: "nope" }), /No checkpoint/);
});

test("measure: gaps, overlaps, alignment, spacing, contrast", async () => {
  const m = measure([{ id: "a", x: 0, y: 0, w: 100, h: 50 }, { id: "b", x: 120, y: 0, w: 100, h: 50 }, { id: "c", x: 240, y: 0, w: 100, h: 60 }, { id: "d", x: 50, y: 20, w: 20, h: 10 }]);
  assert.deepEqual(m.union, { x: 0, y: 0, w: 340, h: 60 });
  assert.equal(m.gaps.find((g) => g.a === "a" && g.b === "b").horizontal, 20);
  assert.deepEqual(m.overlaps.map((o) => [o.a, o.b, o.contains]), [["a", "d", true]]);
  assert.deepEqual(m.aligned.top[0].ids, ["a", "b", "c"]);
  const s = measure([{ id: "a", x: 0, y: 0, w: 10, h: 10 }, { id: "b", x: 30, y: 0, w: 10, h: 10 }, { id: "c", x: 60, y: 0, w: 10, h: 10 }]);
  assert.deepEqual(s.spacing.x, { gaps: [20, 20], equal: true });
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#777777", "#ffffff"), 4.48);
  assert.equal(contrastRatio("linear-gradient", "#fff"), null);

  const { run } = setup();
  const bg = await run("add_shape", { type: "rect", x: 0, y: 0, w: 400, h: 200, fill: "#222222" });
  const t = await run("add_text", { text: "Hello", x: 20, y: 20, fontSize: 16, fill: "#333333" });
  const r = await run("measure_layers", { ids: [bg.id, t.id] });
  assert.equal(r.contrast[0].backdrop, bg.id);
  assert.equal(r.contrast[0].passes, false);
});

test("find_replace: text keeps formatting, colors and fonts, dry run, one undo step", async () => {
  const { app, run } = setup();
  const doc = app.doc;
  const t1 = await run("add_text", { text: "Sale now\nBig sale ends soon", x: 10, y: 10, fontSize: 20 });
  const t2 = await run("add_text", { text: "No match", x: 10, y: 200 });
  const box = await run("add_shape", { type: "rect", x: 0, y: 300, w: 50, h: 50, fill: "#ff0000", stroke: "#ff0000" });
  const textOf = (id) => plainText(doc.stories[doc.find(id).storyId].story);
  const dry = await run("find_replace", { kind: "text", find: "sale", replace: "offer", dryRun: true });
  assert.equal(dry.matches, 2);
  assert.equal(textOf(t1.id), "Sale now\nBig sale ends soon");
  const before = doc.history.index;
  const r = await run("find_replace", { kind: "text", find: "sale", replace: "offer" });
  assert.equal(r.replaced, 2);
  assert.equal(textOf(t1.id), "offer now\nBig offer ends soon");
  assert.equal(textOf(t2.id), "No match");
  assert.equal(doc.history.index, before + 1);
  await run("find_replace", { kind: "text", find: "(\\w+) offer", replace: "$1 DEAL", regex: true, caseSensitive: true });
  assert.equal(textOf(t1.id), "offer now\nBig DEAL ends soon");
  assert.equal((await run("find_replace", { kind: "text", find: "now", replace: "x", wholeWord: true, within: { name: "nothing*" } })).matches, 0);

  const c = await run("find_replace", { kind: "color", find: "#f00", replace: "#00ff00" });
  assert.deepEqual(c.ids, [box.id]);
  assert.equal(doc.find(box.id).fill.color, "#00ff00");
  assert.equal(doc.find(box.id).stroke.fill.color, "#00ff00");

  const fam = doc.stories[doc.find(t1.id).storyId].defaults?.char?.fontFamily;
  if (fam) {
    const f = await run("find_replace", { kind: "font", find: fam.toUpperCase(), replace: "Inter" });
    assert.ok(f.layers >= 1);
    assert.equal(doc.stories[doc.find(t1.id).storyId].defaults.char.fontFamily, "Inter");
  }
});

test("diffFacts and diffPixels", () => {
  const d = diffFacts([{ id: "1", type: "rect", name: "A", x: 0, y: 0, w: 1, h: 1 }, { id: "2", type: "text", name: "T", text: "a" }], [{ id: "2", type: "text", name: "T", text: "b" }, { id: "3", type: "rect", name: "C" }]);
  assert.deepEqual(d.counts, { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(d.changed[0].fields.text, ["a", "b"]);
  const w = 64;
  const h = 48;
  const a = new Uint8ClampedArray(w * h * 4).fill(255);
  const b = new Uint8ClampedArray(a);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) b[(y * w + x) * 4] = 0;
  for (let y = 40; y < 44; y++) for (let x = 50; x < 60; x++) b[(y * w + x) * 4 + 1] = 0;
  const p = diffPixels(a, b, w, h);
  assert.equal(p.changed, 64 + 40);
  assert.equal(p.regions.length, 2);
  assert.deepEqual(p.regions[0], { x: 0, y: 0, w: 16, h: 16, pixels: 64 });
  assert.equal(diffPixels(a, a, w, h).percent, 0);
});
