// Proto Studio assistant tools (vibe/tools/proto.js, task T11) end to end on a design document without a browser:
// one validated undo step per write call, readable errors, names instead of ids, lint and fix, and a scripted agent
// run (mock provider) that builds a login screen with auto layout.
import test from "node:test";
import assert from "node:assert/strict";
import { Doc } from "../../app/src/core/doc.js";
import { OfficeProject } from "../../app/src/core/office.js";
import { starterModel } from "../../app/src/proto/host.js";
import { validate } from "../../app/src/engine/proto/validate.js";
import { createOpenFiniTools, TOOL_GROUPS } from "../../app/src/vibe/tools/index.js";
import { advertisedTools } from "../../app/src/vibe/script-lib.js";
import { STUDIOS, STUDIO_TOOLS } from "../../app/src/vibe/orchestrator.js";
import { TOOLSETS } from "../../app/src/vibe/agents.js";
import { runAgent } from "../../app/src/ai/agent.js";
import { scriptedProvider, toolTurn, textTurn } from "../ai/helpers.js";
import { imageSize } from "../../app/src/proto/ai-runtime.js";

function protoApp({ starter = "phone", attachments = [] } = {}) {
  const doc = new Doc({ name: "Design", studio: "proto", width: 1440, height: 1024, pages: 1 });
  doc.office = new OfficeProject(starterModel({ starter, title: "Design" }), "proto");
  doc.history.clear();
  const app = { doc, docs: [doc], prefs: { labsProto: true }, studio: "proto", protoUI: null, on() {}, emit() {}, toast() {}, setStudio(s) { this.studio = s; }, openDoc(d) { this.docs.push(d); this.doc = d; } };
  const tools = new Map(createOpenFiniTools(app, { attachments: () => attachments }).map((t) => [t.name, t]));
  return { app, doc, tools, model: () => app.doc.office.model, run: (name, args = {}) => tools.get(name).run(args, {}) };
}
const steps = (doc) => doc.history.entries.length;
const LOGIN = {
  type: "frame", name: "Login", w: 390, h: 844, layout: { dir: "column", gap: 16, pad: 24, justify: "center" }, fill: "#ffffff",
  children: [
    { type: "text", ref: "title", text: "Welcome back", size: 28, weight: "bold" },
    { type: "column", name: "Email field", w: "fill", gap: 6, children: [{ type: "text", text: "Email", size: 14, color: "#3f3f46" }, { type: "row", name: "Email input", w: "fill", h: 48, pad: [0, 16], align: "center", stroke: "#d4d4d8", radius: 8, children: [{ type: "text", text: "you@example.com", color: "#52525b" }] }] },
    { type: "row", ref: "button", name: "Sign in button", tag: "button", w: "fill", h: 48, justify: "center", align: "center", fill: "#1d4ed8", radius: 8, children: [{ type: "text", text: "Sign in", color: "#ffffff", weight: 600 }] },
  ],
};

test("the Proto group is registered, listed in the proto context and known to plan_work and sub-agents", () => {
  const { tools } = protoApp();
  for (const n of TOOL_GROUPS.Proto) assert.ok(tools.has(n), n);
  const listed = advertisedTools(TOOL_GROUPS, "proto");
  for (const n of TOOL_GROUPS.Proto) assert.ok(listed.has(n), n);
  assert.ok(STUDIOS.includes("proto"));
  for (const n of TOOLSETS[STUDIO_TOOLS.proto[0]]) assert.ok(TOOL_GROUPS.Proto.includes(n), n);
  for (const n of TOOL_GROUPS.Proto) if (!tools.get(n).readOnly) assert.match(tools.get(n).description, /Verify with proto_describe and proto_screenshot/, n);
});

test("each write is one undo step labeled Vibe, the model stays valid, and undo restores it", async () => {
  const { doc, run, model } = protoApp();
  await run("proto_describe"); // the first call loads the model once (proto/workspace.js ▸ ensureProto)
  const before = model();
  const n0 = steps(doc);
  const c = await run("proto_create", { nodes: [LOGIN] });
  assert.equal(c.created, 8);
  assert.equal(steps(doc) - n0, 1);
  assert.match(doc.history.entries.at(-1).label, /^Vibe: Create layers$/);
  const m = model();
  const root = m.nodes[c.roots[0]];
  assert.equal(root.layout.type, "flex");
  assert.equal(m.nodes[c.refs.button].pos, "flow");
  assert.equal(m.nodes[c.refs.button].tag, "button");
  assert.equal(m.nodes[c.refs.title].name, "Welcome back", "text layers are named by their text");
  assert.deepEqual(validate(m).errors, []);
  await run("proto_update", { updates: [{ id: c.refs.title, set: { text: "Hello again", size: 32 } }, { id: c.roots[0], set: { gap: 20 } }] });
  assert.equal(steps(doc) - n0, 2);
  assert.equal(model().nodes[c.refs.title].text.runs[0].t, "Hello again");
  assert.equal(model().nodes[c.roots[0]].layout.gap, 20);
  assert.equal(model().nodes[c.roots[0]].layout.dir, "column", "layout keys merge");
  const d = await run("proto_duplicate", { ids: [c.refs.button], count: 2 });
  assert.equal(d.ids.length, 2);
  await run("proto_move", { ids: [c.refs.button], index: 0 });
  await run("proto_delete", { ids: d.ids });
  assert.equal(steps(doc) - n0, 5);
  const desc = await run("proto_describe");
  assert.ok(desc.lines.some((l) => /"Sign in button" fill×48 flex row .*<button> fill #1d4ed8/.test(l)), desc.lines.join("\n"));
  for (let i = 0; i < 5; i++) doc.undo();
  assert.equal(model(), before);
});

test("errors are readable and nothing is committed", async () => {
  const { doc, run, model } = protoApp();
  await run("proto_describe");
  const m = model();
  const n0 = steps(doc);
  await assert.rejects(run("proto_update", { updates: [{ id: "nope", set: { w: 10 } }] }), /proto_describe/);
  await assert.rejects(run("proto_create", { nodes: [{ type: "blob" }] }), /Unknown layer type/);
  await assert.rejects(run("proto_create", { nodes: [{ type: "frame", fill: "not a color" }] }), /not a color/);
  await assert.rejects(run("proto_create", { nodes: [{ type: "frame", fill: { $var: "missing" } }] }), /no variable “missing”/);
  await assert.rejects(run("proto_create", { nodes: [{ type: "frame", opacity: 7 }] }), /opacity/);
  assert.equal(model(), m);
  assert.equal(steps(doc), n0);
  const { app, run: run2 } = protoApp();
  app.doc = new Doc({ name: "Poster", studio: "vector", width: 100, height: 100, pages: 1 });
  await assert.rejects(run2("proto_describe"), /not a Proto design/);
});

test("components, variables, styles and tokens by name", async () => {
  const { run, model } = protoApp({ starter: "blank" });
  await run("proto_variables", { action: "collection", name: "Color", modes: ["Light", "Dark"] });
  await run("proto_variables", { action: "create", coll: "Color", items: [{ name: "color/primary", values: { Light: "#1d4ed8", Dark: "#60a5fa" } }, { name: "color/on-primary", type: "color", value: "white" }, { name: "color/accent", alias: "color/primary" }] });
  const m1 = model();
  const prim = Object.entries(m1.vars.items).find(([, v]) => v.name === "color/primary")[0];
  const c = await run("proto_create", { nodes: [{ type: "row", name: "Button", pad: [12, 20], radius: 8, fill: { $var: "color/primary" }, children: [{ type: "text", ref: "label", text: "Button", color: { $var: "color/on-primary" } }] }] });
  const btn = c.roots[0];
  assert.deepEqual(model().nodes[btn].fills[0].color, { $var: prim });
  await run("proto_component", { action: "create", ids: [btn] });
  assert.equal(model().nodes[btn].type, "component");
  await run("proto_component", { action: "defineProp", id: "Button", name: "label", def: { type: "text", default: "Button" } });
  await run("proto_component", { action: "bindProp", id: btn, layer: c.refs.label, field: "text", prop: "label" });
  const inst = await run("proto_component", { action: "instance", of: "Button", props: { label: "Save" } });
  assert.equal(model().nodes[inst.ids[0]].type, "instance");
  await run("proto_variables", { action: "setMode", id: inst.ids[0], coll: "Color", mode: "Dark" });
  assert.equal(Object.values(model().nodes[inst.ids[0]].modes)[0], "dark");
  await run("proto_styles", { action: "create", name: "Label", kind: "text", from: c.refs.label });
  assert.ok(model().nodes[c.refs.label].style.text);
  const exp = await run("proto_tokens", { action: "export" });
  assert.ok(JSON.stringify(exp.tokens).includes("#1d4ed8"));
  const css = await run("proto_tokens", { action: "export", format: "css" });
  assert.match(css.tokens, /--color-primary/);
  const imp = await run("proto_tokens", { action: "import", tokens: JSON.stringify({ space: { $type: "dimension", sm: { $value: { value: 8, unit: "px" } } } }), collection: "Spacing" });
  assert.ok(imp.report);
  assert.ok(Object.values(model().vars.items).some((v) => v.name.includes("sm")));
  const found = await run("proto_search", { variable: "color/primary" });
  assert.ok(found.matches.some((l) => l.startsWith(btn)));
  const desc = await run("proto_describe");
  assert.ok(desc.components.some((l) => /"Button".*props label:text instances 1/.test(l)), desc.components.join("\n"));
  assert.ok(desc.variables[0].variables.some((l) => /color\/accent = →color\/primary/.test(l)));
});

test("proto_to_code exports the page or chosen layers in each format, read-only", async () => {
  const { doc, run } = protoApp({ starter: "blank" });
  const c = await run("proto_create", { nodes: [LOGIN] });
  const before = doc.history.entries.length;
  const html = await run("proto_to_code");
  assert.equal(html.format, "html");
  assert.equal(html.entry, "index.html");
  const page = html.files.find((f) => f.path === "index.html").text;
  assert.match(page, /<button class="sign-in-button" type="button">/);
  assert.match(page, /<h2 class="welcome-back">Welcome back<\/h2>/);
  const react = await run("proto_to_code", { format: "react", ids: [c.roots[0]] });
  assert.ok(react.files.some((f) => f.path === "src/screens/Login.tsx"));
  const one = await run("proto_to_code", { format: "swiftui", file: "Screens/LoginView.swift" });
  assert.deepEqual(one.files.map((f) => f.path), ["Screens/LoginView.swift"]);
  assert.match(one.files[0].text, /struct LoginView: View/);
  const small = await run("proto_to_code", { format: "react-tailwind", maxChars: 1000 });
  assert.ok(small.files.some((f) => f.truncated || f.omitted));
  await assert.rejects(run("proto_to_code", { ids: ["nope"] }), /proto_describe/);
  await assert.rejects(run("proto_to_code", { file: "missing.css" }), /No file/);
  assert.equal(doc.history.entries.length, before, "exporting changes nothing");
});

test("lint, fix, content, rename, responsive and get_node", async () => {
  const { doc, run, model } = protoApp({ starter: "blank" });
  const c = await run("proto_create", { nodes: [{ ...LOGIN, children: [...LOGIN.children, { type: "text", ref: "faint", text: "Forgot password?", color: "#e4e4e7" }, { type: "frame", ref: "empty" }] }] });
  const r = await run("proto_lint", {});
  const ids = r.issues.map((i) => i.id);
  assert.ok(ids.includes(`contrast:${c.refs.faint}`), ids.join("\n"));
  assert.ok(ids.includes(`empty-frame:${c.refs.empty}`));
  const n0 = steps(doc);
  const f = await run("proto_fix", { rules: ["contrast", "empty-frame"] });
  assert.equal(steps(doc) - n0, 1);
  assert.equal(f.fixed.length, 2);
  assert.ok(!model().nodes[c.refs.empty]);
  await assert.rejects(run("proto_fix", { issues: ["contrast:nope"] }), /Run proto_lint again/);
  const fc = await run("proto_content", { ids: [c.roots[0]], kind: "name", seed: 1 });
  assert.ok(fc.filled.length >= 4);
  const rn = await run("proto_rename", { ids: [c.roots[0]], force: true });
  assert.ok(rn.changes.length);
  const resp = await run("proto_responsive", { id: c.roots[0], widths: [320, 390] });
  assert.deepEqual(resp.widths.map((w) => w.width), [390, 320]);
  const nodes = await run("proto_get_node", { ids: [c.refs.button], resolved: true });
  assert.equal(nodes.nodes[0].children.length, 1);
});

test("from_screenshot places the image as a locked reference with one undo step", async () => {
  // a 2 × 3 PNG header is enough for the size; colors and text are read in the app window
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0]);
  assert.deepEqual(imageSize(png), { w: 2, h: 3 });
  const file = { name: "shot.png", type: "image/png", size: png.length, file: { arrayBuffer: async () => png.buffer } };
  const { doc, run, model } = protoApp({ starter: "blank", attachments: [file] });
  const n0 = steps(doc);
  const r = await run("proto_from_screenshot", { width: 390 });
  assert.equal(steps(doc) - n0, 1);
  const ref = model().nodes[r.reference];
  assert.equal(ref.locked, true);
  assert.equal(ref.fills[0].media, r.media);
  assert.deepEqual([...model().media[r.media].bytes], [...png]);
  assert.equal(r.size, "390 × 585");
  assert.ok(model().nodes[r.frame]);
  doc.undo();
  assert.ok(!model().media?.[r.media], "undo removes the media too");
  const { run: none } = protoApp();
  await assert.rejects(none("proto_from_screenshot", {}), /No image is attached/);
});

test("a scripted agent run (mock provider) builds a login screen with auto layout", async () => {
  const { app, doc, tools, model } = protoApp({ starter: "blank" });
  const provider = scriptedProvider([
    toolTurn([{ id: "c1", name: "proto_describe", input: {} }], "Looking at the design."),
    toolTurn([{ id: "c2", name: "proto_create", input: { nodes: [LOGIN] } }], "Building the login screen."),
    toolTurn([{ id: "c3", name: "proto_lint", input: { severity: "warning" } }]),
    textTurn("Done: a login screen with auto layout."),
  ]);
  const r = await runAgent({ model: "m", provider, tools: [...tools.values()], messages: [{ role: "user", content: "Design a login screen" }], sleep: async () => {} });
  assert.equal(r.stopReason, "end");
  const results = r.messages.filter((m) => m.role === "user").flatMap((m) => m.content).filter((b) => b.type === "tool_result");
  assert.equal(results.length, 3);
  assert.ok(results.every((b) => !b.isError), JSON.stringify(results));
  const m = model();
  const frame = Object.values(m.nodes).find((n) => n.name === "Login");
  assert.equal(frame.layout.type, "flex");
  assert.equal(frame.layout.dir, "column");
  const kids = Object.values(m.nodes).filter((n) => n.parent === frame.id);
  assert.equal(kids.length, 3);
  assert.ok(kids.every((n) => n.pos === "flow"), "children flow in the auto layout");
  assert.equal(doc.history.entries.length, 1, "one undo step for the whole screen");
  const lint = JSON.parse(results[2].content);
  assert.equal(lint.counts.error, 0, results[2].content);
  assert.ok(app.doc === doc);
});

test("the screenshot display list follows the solver; media.put is exactly undoable", async () => {
  const { paintList } = await import("../../app/src/proto/ai-render.js");
  const { apply } = await import("../../app/src/engine/proto/ops.js");
  const { run, model } = protoApp({ starter: "blank" });
  const c = await run("proto_create", { nodes: [LOGIN] });
  const list = paintList(model(), c.roots[0]);
  assert.equal(list.w, 390);
  assert.equal(list.h, 844);
  assert.equal(list.items[0].fills[0].color, "#ffffff");
  const texts = list.items.filter((i) => i.text);
  assert.ok(texts.some((i) => i.text[0].segs.map((s) => s.text).join("").includes("Welcome")));
  const btn = list.items.find((i) => i.key === c.refs.button);
  assert.equal(Math.round(btn.w), 342, "fill width inside 24 px padding");
  const m0 = model();
  const bytes = new Uint8Array([1, 2, 3]);
  const r = apply(m0, { op: "media.put", id: "m1", media: { mime: "image/png", name: "a.png", bytes } });
  assert.equal(r.model.media.m1.bytes, bytes, "bytes are shared, not copied");
  assert.deepEqual(apply(r.model, r.inverse).model.media, m0.media);
  assert.throws(() => apply(m0, { op: "media.put", media: { mime: "text/html", bytes } }), /not supported/);
});

test("proto_interaction connects screens by name, edits interactions and flows, one step each", async () => {
  const { doc, run, model } = protoApp({ starter: "blank" });
  await run("proto_variables", { action: "collection", name: "State", modes: ["Default"] });
  await run("proto_variables", { action: "create", coll: "State", items: [{ name: "liked", type: "bool", value: false }] });
  await run("proto_create", { nodes: [{ type: "frame", name: "Home", w: 390, h: 844, layout: "column", children: [{ type: "row", name: "Go", w: "fill", h: 48 }] }, { type: "frame", name: "Details", w: 390, h: 844, x: 500 }] });
  const n0 = steps(doc);
  const r = await run("proto_interaction", { action: "connect", from: "Go", to: "Details", transition: { type: "smart", dur: 300 } });
  assert.equal(r.changed, true);
  assert.equal(steps(doc) - n0, 1);
  assert.match(doc.history.entries.at(-1).label, /^Vibe: Prototype: connect$/);
  const m = model();
  const go = Object.values(m.nodes).find((n) => n.name === "Go");
  const details = Object.values(m.nodes).find((n) => n.name === "Details");
  assert.deepEqual(go.proto[0].do[0], { act: "navigate", to: details.id, tr: { type: "smart", dur: 300 } });
  await run("proto_interaction", { action: "add", id: "Details", interaction: { on: { type: "key", key: "Escape" }, do: [{ act: "back" }, { act: "set", var: "liked", value: { op: "not", args: [{ var: "liked" }] } }] } });
  const liked = Object.keys(model().vars.items)[0];
  assert.deepEqual(model().nodes[details.id].proto[0].do[1].value, { op: "not", args: [{ var: liked }] }, "variable names become ids");
  await run("proto_interaction", { action: "addFlow", start: "Home", name: "Main" });
  const list = await run("proto_interaction", { action: "list" });
  assert.equal(list.flows[0].name, "Main");
  assert.equal(list.flows[0].screens.length, 2);
  assert.ok(list.layers.some((l) => l.interactions.some((i) => /navigate to Details \(smart animate, 300 ms\)/.test(i.text))));
  await run("proto_interaction", { action: "updateFlow", flow: "Main", name: "Primary" });
  await run("proto_interaction", { action: "delete", id: "Details", index: 0 });
  assert.equal(model().nodes[details.id].proto, undefined);
  await assert.rejects(run("proto_interaction", { action: "connect", from: "Go", to: "Nowhere" }), /no top-level frame “Nowhere”/);
  await assert.rejects(run("proto_interaction", { action: "add", id: "Go", interaction: { on: { type: "tap" }, do: [] } }), /not valid/);
  await run("proto_interaction", { action: "deleteFlow", flow: "Primary" });
  assert.deepEqual(model().pages[Object.keys(model().pages)[0]].flows, []);
  assert.deepEqual(validate(model()).errors, []);
});
