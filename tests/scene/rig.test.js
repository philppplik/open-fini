// Scene Studio motion rigging (scene/rig.js) and the "Scene motion" assistant tools (scene/ai-motion.js).
import test from "node:test";
import assert from "node:assert/strict";
import * as K from "../../app/src/scene/keyframes.js";
import * as M from "../../app/src/scene/model.js";
import * as R from "../../app/src/scene/rig.js";
import * as AM from "../../app/src/scene/ai-motion.js";
import { frameState } from "../../app/src/scene/evaluate.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const layer = (m, t, id) => frameState(m, t).layers.find((l) => l.clip.id === id);

function scene() {
  let m = M.emptyScene({ fps: 25 });
  m = M.addClip(m, { id: "a", type: "solid", start: 0, dur: 4, x: { kf: [{ t: 0, v: 100 }, { t: 2, v: 300 }] } }).model;
  m = M.addClip(m, { id: "b", type: "shape", start: 0, dur: 4, x: 500, y: 400 }).model;
  m = M.addClip(m, { id: "c", type: "text", start: 0, dur: 4, text: { text: "Hi" } }).model;
  return m;
}

test("behaviors: normalized, deterministic, loop / spin / wiggle on top of keyframes", () => {
  assert.equal(R.normBehaviors([{ type: "nope", prop: "x" }]), undefined);
  const list = R.normBehaviors([{ id: "w", type: "wiggle", prop: "x", amount: 5, freq: 2, seed: 3 }, { type: "loop", prop: "x", mode: "pingpong" }, { type: "spin", prop: "rot", rate: 90 }]);
  assert.equal(list.length, 3);
  const c = { x: { kf: [{ t: 0, v: 0 }, { t: 1, v: 10 }] }, rot: 0, beh: [{ id: "l", type: "loop", prop: "x", mode: "cycle" }] };
  near(R.propAt(c, "x", 1.5), 5);
  near(R.propAt({ ...c, beh: [{ id: "l", type: "loop", prop: "x", mode: "pingpong" }] }, "x", 1.25), 7.5);
  near(R.propAt({ ...c, beh: [{ id: "l", type: "loop", prop: "x", mode: "offset" }] }, "x", 1.5), 15);
  near(R.propAt({ ...c, beh: [{ id: "s", type: "spin", prop: "rot", rate: 90 }] }, "rot", 2), 180);
  const w = { x: 100, beh: [{ id: "w", type: "wiggle", prop: "x", amount: 10, freq: 3, seed: 7 }] };
  const v1 = R.propAt(w, "x", 0.37);
  assert.equal(R.propAt(w, "x", 0.37), v1, "deterministic");
  assert.ok(Math.abs(v1 - 100) <= 10);
  for (let x = 0; x < 20; x += 0.13) assert.ok(Math.abs(R.noise1(x, 4)) <= 1);
  // through the model: add, evaluate, update, remove; survives normalization
  let m = scene();
  const r = R.addBehavior(m, "b", { type: "spin", prop: "rot", rate: 45 });
  m = M.normalizeScene(JSON.parse(JSON.stringify(r.model)));
  near(layer(m, 2, "b").rot, 90);
  m = R.updateBehavior(m, "b", m.clips.b.beh[0].id, { rate: 10 });
  near(layer(m, 2, "b").rot, 20);
  m = R.updateBehavior(m, "b", m.clips.b.beh[0].id, null);
  assert.equal(m.clips.b.beh, undefined);
  assert.throws(() => R.addBehavior(m, "b", { type: "wiggle", prop: "volume" }));
});

test("parenting: children follow the parent; setParent keeps the look; cycles are refused and repaired", () => {
  let m = scene();
  const before = layer(m, 1, "b");
  m = R.setParent(m, "b", "a", 1);
  assert.equal(m.clips.b.parent, "a");
  // nothing jumps at the time of parenting: the world position is the same
  const L = layer(m, 1, "b");
  const [wx, wy] = R.apply(L.pm, L.x, L.y);
  near(wx, before.x, 1e-6);
  near(wy, before.y, 1e-6);
  // the parent moves 100 px between 1 s and 2 s: the child moves with it
  const L2 = layer(m, 2, "b");
  near(R.apply(L2.pm, L2.x, L2.y)[0] - wx, 100, 1e-6);
  // unparent keeps the look at that time
  const u = R.setParent(m, "b", null, 2);
  near(layer(u, 2, "b").x, R.apply(L2.pm, L2.x, L2.y)[0], 1e-6);
  assert.throws(() => R.setParent(m, "a", "b", 0), /itself|children/);
  // a foreign file with a cycle loses the link that closes it
  const bad = M.normalizeScene({ ...JSON.parse(JSON.stringify(m)), clips: { ...m.clips, a: { ...m.clips.a, parent: "b" } } });
  assert.ok(!(bad.clips.a.parent && bad.clips.b.parent));
  // a rotated, scaled parent: the child's matrix composes
  let r = M.updateClip(scene(), "a", { x: 0, y: 0, rot: 90, sx: 2, sy: 2 });
  r = { ...r, clips: { ...r.clips, b: { ...r.clips.b, parent: "a", x: 10, y: 0 } } };
  const pm = R.parentMatrix(r, r.clips.b, 0);
  const [px, py] = R.apply(pm, 10, 0);
  near(px, 0, 1e-9);
  near(py, 20, 1e-9);
});

test("sequence layers, audio-driven keyframes and beat markers", () => {
  const m = scene();
  const s = R.staggerClips(m, ["c", "b", "a"], { step: 0.4, moveClip: M.moveClip });
  assert.deepEqual(["c", "b", "a"].map((id) => s.clips[id].start), [0, 0.4, 0.8]);
  const o = R.staggerClips(m, ["a", "b"], { overlap: 1, moveClip: M.moveClip });
  assert.equal(o.clips.b.start, 3);
  // audio levels: silent first second, loud second second
  let a = M.addMedia(m, { id: "au", kind: "audio", name: "a.wav", duration: 4 }).model;
  a = M.addClip(a, { id: "snd", type: "audio", media: "au", start: 0, dur: 4 }).model;
  const levels = { hop: 0.04, db: Array.from({ length: 100 }, (_, i) => (i < 25 ? -80 : -6)) };
  const r = R.audioToKeyframes(a, { id: "b", prop: "scale", audio: "snd", levels, min: 1, max: 2, smooth: 0 }, { setProp: M.setProp });
  assert.ok(K.isTrack(r.model.clips.b.sx) && K.isTrack(r.model.clips.b.sy));
  near(K.valueAt(r.model.clips.b.sx, 0.5), 1);
  near(K.valueAt(r.model.clips.b.sx, 2), 2);
  assert.throws(() => R.audioToKeyframes(a, { id: "b", prop: "x", audio: "c", levels }, { setProp: M.setProp }));
  // beats mapped through the clip that uses the media
  const b = M.setAnalysis(a, "au", { beats: { bpm: 120, times: [0.4, 0.8, 1.2, 9] } });
  assert.deepEqual(R.beatMarkerTimes(b, "au"), [0.4, 0.8, 1.2]);
  assert.deepEqual(R.beatMarkerTimes(b, "au", { every: 2 }), [0.4, 1.2]);
});

test("assistant motion tools: parent with a null, behavior, stagger, keyframe edit, clip time, link, effect order", () => {
  let m = scene();
  let r = AM.parent(m, { ids: ["b", "c"], nullObject: true, name: "Rig" });
  assert.ok(r.result.nullObject);
  assert.equal(r.model.clips.b.parent, r.result.nullObject);
  assert.equal(r.model.clips[r.result.nullObject].shape.fill, null);
  r = AM.behavior(r.model, { id: "b", type: "wiggle", prop: "position", amount: 4 });
  assert.equal(r.result.added.length, 2);
  r = AM.stagger(r.model, { ids: ["a", "b"], step: 1 });
  assert.equal(r.model.clips.b.start, 1);
  r = AM.keyframeEdit(scene(), { id: "a", action: "scale", factor: 2 });
  assert.deepEqual(r.model.clips.a.x.kf.map((k) => k.t), [0, 4]);
  r = AM.keyframeEdit(scene(), { id: "a", action: "reverse" });
  assert.deepEqual(r.model.clips.a.x.kf.map((k) => k.v), [300, 100]);
  assert.throws(() => AM.keyframeEdit(scene(), { id: "b", action: "delete" }), /No keyframes/);
  let v = M.addMedia(scene(), { id: "mv", kind: "video", name: "v.mp4", duration: 10, w: 100, h: 100, hasAudio: false }).model;
  v = M.addClip(v, { id: "v", type: "video", media: "mv", start: 0, dur: 5 }).model;
  r = AM.clipTime(v, { id: "v", action: "reverse" });
  assert.ok(K.isTrack(r.model.clips.v.remap));
  r = AM.clipTime(v, { id: "v", action: "freeze", at: 2 });
  near(r.model.clips[Object.keys(r.model.clips).find((id) => r.model.clips[id].remap !== undefined)].remap, 2);
  r = AM.link(scene(), { ids: ["a", "b"], action: "link" });
  assert.equal(r.model.clips.a.link, r.model.clips.b.link);
  let e = M.addEffect(scene(), "a", "blur", {}).model;
  e = M.addEffect(e, "a", "sepia", {}).model;
  r = AM.effectOrder(e, { id: "a", effect: "sepia", index: 0, reset: true });
  assert.deepEqual(r.model.clips.a.effects.map((x) => x.type), ["sepia", "blur"]);
});

test("motion blur flag and anchor survive normalization; describeClip reports format 3 fields", () => {
  const m = M.normalizeScene(JSON.parse(JSON.stringify(M.updateClip(scene(), "b", { mblur: true, ax: 10, label: "#46a758", off: true }))));
  assert.equal(m.clips.b.mblur, true);
  const d = M.describeClip(m, m.clips.b);
  assert.equal(d.ax, 10);
  assert.equal(d.off, true);
  assert.equal(d.label, "#46a758");
});
