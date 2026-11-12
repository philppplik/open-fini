// Scene Studio assistant tools end to end on a scene document (no browser): one undo step per call, readable errors,
// approvals and the compact tool list of the scene context.
import test from "node:test";
import assert from "node:assert/strict";
import { Doc } from "../../app/src/core/doc.js";
import { OfficeProject } from "../../app/src/core/office.js";
import * as M from "../../app/src/scene/model.js";
import { createOpenFiniTools, TOOL_GROUPS } from "../../app/src/vibe/tools/index.js";
import { advertisedTools } from "../../app/src/vibe/script-lib.js";
import { STUDIOS, STUDIO_TOOLS } from "../../app/src/vibe/orchestrator.js";
import { TOOLSETS } from "../../app/src/vibe/agents.js";

function sceneApp() {
  let model = M.emptyScene({ title: "Clip" });
  model = M.addMedia(model, { id: "vid", kind: "video", mime: "video/mp4", name: "talk.mp4", duration: 12, w: 1920, h: 1080, hasAudio: true }).model;
  const doc = new Doc({ name: "Clip", studio: "scene", width: 1920, height: 1080, pages: 1 });
  doc.office = new OfficeProject(model, "scene");
  doc.history.clear();
  const app = { doc, docs: [doc], prefs: {}, studio: "scene", sceneUI: null, on() {}, emit() {}, toast() {} };
  const tools = new Map(createOpenFiniTools(app, {}).map((t) => [t.name, t]));
  return { app, doc, run: (name, args = {}) => tools.get(name).run(args, {}), tools };
}

test("each scene tool call is one undo step and the describe output follows", async () => {
  const { doc, run } = sceneApp();
  const before = doc.history.entries.length;
  const placed = await run("scene_place_media", { media: "vid", start: 0 });
  assert.equal(placed.ids.length, 2);
  const title = await run("scene_title", { text: "Hello", preset: "pop", start: 1, dur: 3 });
  assert.ok(title.ids.length >= 1);
  await run("scene_cut_ranges", { ranges: [[2, 4]] });
  const d = await run("scene_describe");
  assert.equal(d.duration, 10);
  assert.ok(d.clips.some((l) => /text "Title" .*text="Hello"/.test(l)), d.clips.join("\n"));
  assert.equal(doc.history.entries.length - before, 3, "three calls, three undo steps");
  assert.match(JSON.stringify(doc.history.entries.at(-1).label ?? doc.history.entries.at(-1)), /Vibe: Cut Ranges/);
  doc.history.undo?.() ?? doc.undo?.();
});

test("errors are readable and nothing is committed on failure", async () => {
  const { app, run } = sceneApp();
  const model = app.doc.office.model;
  await assert.rejects(run("scene_trim_clip", { id: "nope", edge: "end", to: 2 }), /scene_describe/);
  assert.equal(app.doc.office.model, model);
  await assert.rejects(run("scene_transcript"), /scene_transcribe/);
  await assert.rejects(run("scene_cut_transcript", { phrases: ["x"] }), /scene_transcribe/);
  app.doc = new Doc({ name: "Poster", studio: "vector", width: 100, height: 100, pages: 1 });
  await assert.rejects(run("scene_describe"), /not a scene/);
});

test("transcription explains what is missing when no batch engine exists, and asks before online engines", async () => {
  const { run, tools } = sceneApp();
  await run("scene_place_media", { media: "vid", start: 0 });
  await assert.rejects(run("scene_transcribe", { engine: "system" }), /only listens to the microphone/);
  assert.equal(tools.get("scene_transcribe").needsApproval({}), false, "no batch engine, nothing leaves the device");
  assert.match(tools.get("scene_export").needsApproval({ format: "mp4" }), /Export the scene as MP4/);
  assert.match(tools.get("scene_import_media").needsApproval({ url: "https://example.com/a.mp4" }), /example\.com/);
  assert.equal(tools.get("scene_import_media").needsApproval({ attachment: "a.mp4" }), false);
});

test("the scene context lists the scene groups; plan_work and sub-agents know the studio", () => {
  const listed = advertisedTools(TOOL_GROUPS, "scene");
  for (const n of [...TOOL_GROUPS.Scene, ...TOOL_GROUPS["Scene understanding"], ...TOOL_GROUPS["Scene automation"]]) assert.ok(listed.has(n), n);
  assert.ok(STUDIOS.includes("scene"));
  for (const n of TOOLSETS[STUDIO_TOOLS.scene[0]]) assert.ok(TOOL_GROUPS.Scene.concat(TOOL_GROUPS["Scene understanding"], TOOL_GROUPS["Scene automation"]).includes(n), n);
});

test("scene_set_easing changes existing keyframes and scene_precompose nests clips, one undo step each", async () => {
  const { app, doc, run } = sceneApp();
  const placed = await run("scene_place_media", { media: "vid", start: 0, withAudio: false });
  const id = placed.ids[0];
  await run("scene_keyframes", { id, prop: "opacity", keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 2, v: 0.5 }] });
  const before = doc.history.entries.length;
  const r = await run("scene_set_easing", { id, prop: "opacity", easing: "hold", at: [1] });
  assert.equal(r.keyframes, 3);
  const kf = app.doc.office.model.clips[id].opacity.kf;
  assert.equal(kf[1].e, "hold");
  assert.notEqual(kf[0].e, "hold", "only the key at 1 s changes");
  await run("scene_set_easing", { id, prop: "opacity", easing: [0.4, 0, 0.2, 1] });
  assert.equal(doc.history.entries.length - before, 2);
  await assert.rejects(run("scene_set_easing", { id, prop: "opacity", easing: "wobbly" }), /Unknown easing/);
  await assert.rejects(run("scene_set_easing", { id, prop: "rot", easing: "linear" }), /no keyframes/);
  await assert.rejects(run("scene_set_easing", { id, prop: "opacity", easing: "linear", at: [7] }), /No keyframe/);

  const p = await run("scene_precompose", { ids: [id], name: "Group" });
  const m = app.doc.office.model;
  assert.equal(m.clips[p.id].type, "comp");
  assert.equal(m.clips[p.id].comp, p.comp);
  assert.ok(!m.clips[id], "the clip moved into the composition");
  assert.ok(m.comps[p.comp].clips[id]);
  assert.equal(m.comps[p.comp].name, "Group");
  const inner = await run("scene_precompose", { ids: [id], seq: p.comp });
  assert.ok(app.doc.office.model.comps[inner.comp], "pre-compose works inside a composition");
  assert.equal(app.doc.office.model.comps[p.comp].clips[inner.id].type, "comp");
  await assert.rejects(run("scene_precompose", { ids: ["nope"] }), /scene_describe/);
});
