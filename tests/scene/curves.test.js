// Scene Studio format 2: Bezier tangents on keyframes (evaluation, serialization, migration, the graph editor's
// track operations) and nested compositions (evaluation, cycles, time remapping, sound passing through).
import test from "node:test";
import assert from "node:assert/strict";
import * as K from "../../app/src/scene/keyframes.js";
import * as M from "../../app/src/scene/model.js";
import { frameState, flattenAudio, sourceTime } from "../../app/src/scene/evaluate.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const sample = (tr, a, b, n = 50) => Array.from({ length: n + 1 }, (_, i) => K.valueAt(tr, a + ((b - a) * i) / n));

// ------------------------------------------------------------------------------------------- Bezier evaluation

test("bezier: tangents shape the segment, ends are exact, easy ease is symmetric", () => {
  const easy = { kf: [{ t: 0, v: 0, o: [0, 1 / 3] }, { t: 2, v: 10, i: [0, 1 / 3] }] };
  near(K.valueAt(easy, 0), 0);
  near(K.valueAt(easy, 2), 10);
  near(K.valueAt(easy, 1), 5, 1e-4);
  assert.ok(K.valueAt(easy, 0.2) < 1, "slow start");
  assert.ok(K.valueAt(easy, 1.8) > 9, "slow end");
  // speed 0 at both keyframes, fastest in the middle
  near(K.speedAt(easy, 0.001), 0, 0.2);
  assert.ok(K.speedAt(easy, 1) > 5);
  // monotone for zero-speed handles
  const s = sample(easy, 0, 2);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] >= s[i - 1] - 1e-9);
  // a steep out speed overshoots between equal values (bounce between two keyframes)
  const over = { kf: [{ t: 0, v: 0, o: [40, 0.5] }, { t: 1, v: 0 }] };
  assert.ok(Math.max(...sample(over, 0, 1)) > 3);
});

test("bezier: a CSS easing and its derived tangents give the same curve", () => {
  const css = { kf: [{ t: 1, v: 2, e: "easeInOut" }, { t: 3, v: 8 }] };
  const tg = K.tangentsOf(css, 0);
  const tg1 = K.tangentsOf(css, 1);
  const explicit = { kf: [{ t: 1, v: 2, o: tg.out }, { t: 3, v: 8, i: tg1.in }] };
  for (let x = 1; x <= 3; x += 0.1) near(K.valueAt(css, x), K.valueAt(explicit, x), 1e-5);
});

test("bezier: influences above 100 % together keep time monotonic; hold wins over tangents", () => {
  const big = { kf: [{ t: 0, v: 0, o: [0, 1] }, { t: 1, v: 1, i: [0, 1] }] };
  const s = sample(big, 0, 1, 100);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] >= s[i - 1] - 1e-9);
  near(K.valueAt(big, 0.5), 0.5, 1e-4);
  const hold = { kf: [{ t: 0, v: 0, e: "hold", o: [5, 0.5] }, { t: 1, v: 1 }] };
  assert.equal(K.valueAt(hold, 0.99), 0);
});

test("easings: bounce and elastic start and end exactly; format 1 curves are unchanged", () => {
  for (const name of ["bounce", "elastic"]) {
    near(K.ease(name, 0), 0);
    near(K.ease(name, 1), 1);
  }
  assert.ok(K.ease("elastic", 0.2) > 1, "elastic overshoots");
  // without i / o the old easing path is used (same polynomial as before)
  near(K.valueAt({ kf: [{ t: 0, v: 0, e: [0.42, 0, 0.58, 1] }, { t: 1, v: 1 }] }, 0.5), 0.5, 1e-4);
  near(K.valueAt({ kf: [{ t: 0, v: 0, e: "easeIn" }, { t: 1, v: 1 }] }, 0.5), K.bezierAt(0.42, 0, 1, 1, 0.5));
});

// ------------------------------------------------------------------------------------------- serialization

test("tangents: serialize through JSON, survive normalization, are clamped and dropped where they do not apply", () => {
  const tr = { kf: [{ t: 0, v: 1, o: [3, 0.4], b: true }, { t: 1, v: 2, i: [-1, 0.2], e: "bounce" }] };
  const back = K.normalizeValue(JSON.parse(JSON.stringify(tr)), 0);
  assert.deepEqual(back, tr);
  const bad = K.normalizeValue({ kf: [{ t: 0, v: 1, o: [Infinity, 2], i: "x", b: "yes" }, { t: 1, v: "#ffffff", i: [1, 0.5] }, { t: 2, v: 3, o: [1e12, -1] }] }, 0);
  assert.equal(bad.kf[0].o, undefined, "non-finite speed is dropped");
  assert.equal(bad.kf[0].b, undefined);
  assert.equal(bad.kf[1].i, undefined, "colors have no tangents");
  assert.deepEqual(bad.kf[2].o, [1e7, 0], "speed and influence are clamped");
  assert.equal(K.normalizeEasing("nope"), null);
  assert.deepEqual(K.normalizeEasing([2, 50, -1, 0]), [1, 10, 0, 0]);
});

test("tangents: retiming scales speeds so the curve keeps its shape; replacing a value keeps them", () => {
  const tr = { kf: [{ t: 0, v: 0, o: [10, 0.5] }, { t: 1, v: 10, i: [10, 0.5] }] };
  const slow = K.retime(tr, { scale: 2 });
  assert.deepEqual(slow.kf[0].o, [5, 0.5]);
  near(K.valueAt(slow, 1), K.valueAt(tr, 0.5));
  const set = K.setKeyframe(tr, 0, 1);
  assert.deepEqual(set.kf[0].o, [10, 0.5]);
});

test("migration: a format 1 scene loads as format 2 and renders the same frames", () => {
  const v1 = {
    version: 1,
    width: 640,
    height: 360,
    fps: 25,
    tracks: [{ id: "tv", kind: "video" }, { id: "ta", kind: "audio" }],
    clips: { a: { id: "a", track: "tv", type: "solid", start: 0, dur: 4, opacity: { kf: [{ t: 0, v: 0, e: "easeOut" }, { t: 2, v: 1, e: "back" }, { t: 4, v: 0.5 }] }, x: { kf: [{ t: 0, v: 0 }, { t: 4, v: 640, e: [0.1, 0.7, 0.3, 1] }] } } },
    comps: {},
    media: {},
  };
  const m = M.normalizeScene(JSON.parse(JSON.stringify(v1)));
  assert.equal(m.version, 2);
  for (let tt = 0; tt <= 4; tt += 0.2) {
    const L = frameState(m, tt).layers[0];
    near(L.opacity, Math.max(0, Math.min(1, K.valueAt(v1.clips.a.opacity, tt))));
    near(L.x, K.valueAt(v1.clips.a.x, tt));
  }
  // and format 2 additions survive a save / load
  const r = M.setKeyframeTangents(m, "a", "opacity", 2, { out: [0, 0.5] });
  const again = M.normalizeScene(JSON.parse(JSON.stringify(r)));
  assert.deepEqual(again.clips.a.opacity.kf[1].o, [0, 0.5]);
  assert.equal(again.clips.a.opacity.kf[1].e, undefined, "a set out tangent replaces the named easing");
});

// ------------------------------------------------------------------------------------------- track operations

test("graph operations: presets, unified and broken tangents, move, remove, copy and paste", () => {
  const tr = { kf: [{ t: 0, v: 0 }, { t: 1, v: 5 }, { t: 2, v: 0 }] };
  const easy = K.applyEasing(tr, [1], "easyEase");
  assert.deepEqual([easy.kf[1].i, easy.kf[1].o], [[0, 1 / 3], [0, 1 / 3]]);
  near(K.speedAt(easy, 1), 0, 0.5);
  assert.equal(K.applyEasing(easy, [1], "linear").kf[1].i, undefined);
  assert.equal(K.applyEasing(tr, [0], "hold").kf[0].e, "hold");
  const custom = K.applyEasing(easy, [0], [0.2, 0, 0.2, 1]);
  assert.deepEqual(custom.kf[0].e, [0.2, 0, 0.2, 1]);
  assert.equal(custom.kf[1].i, undefined, "the next keyframe's incoming tangent gives way to the curve");
  assert.throws(() => K.applyEasing(tr, [0], "wobble"), /Unknown easing/);
  // unified: setting the out speed mirrors it to the in side; broken keeps them apart
  const u = K.setTangents(tr, 1, { out: [3, 0.25] });
  assert.equal(u.kf[1].i[0], 3);
  const b = K.setTangents(K.setTangents(tr, 1, { broken: true }), 1, { out: [3, 0.25] });
  assert.equal(b.kf[1].i, undefined);
  assert.equal(b.kf[1].b, true);
  // move: time and value, collisions replace
  const mv = K.moveKeys(tr, [0], 1, 2);
  assert.deepEqual(mv.track.kf.map((k) => [k.t, k.v]), [[1, 2], [2, 0]]);
  assert.deepEqual(mv.idx, [0]);
  assert.equal(K.removeKeys(tr, [0, 1, 2]), 0, "removing all leaves a constant");
  const clip = K.copyKeys(tr, [2, 1]);
  assert.deepEqual(clip.map((k) => k.t), [0, 1]);
  const pasted = K.pasteKeys(7, clip, 3);
  assert.deepEqual(pasted.kf.map((k) => [k.t, k.v]), [[3, 5], [4, 0]]);
});

test("model curves: setEasing, setKeyframeTangents, moveKeyframes, keyframesOf, pasteKeyframes", () => {
  let m = M.emptyScene({ fps: 25 });
  const r = M.addClip(m, { type: "solid", start: 2, dur: 4, x: { kf: [{ t: 0, v: 0 }, { t: 2, v: 100 }, { t: 4, v: 0 }] } });
  m = r.model;
  assert.deepEqual(M.animatedPaths(m.clips[r.id]), ["x"]);
  m = M.setEasing(m, r.id, "x", "easyEase", { at: 4 });
  assert.deepEqual(m.clips[r.id].x.kf[1].o, [0, 1 / 3]);
  assert.throws(() => M.setEasing(m, r.id, "x", "easyEase", { at: 9 }), /No keyframe/);
  m = M.setEasing(m, r.id, "x", "bounce");
  assert.equal(m.clips[r.id].x.kf[0].e, "bounce");
  m = M.setKeyframeTangents(m, r.id, "x", 4, { in: [10, 0.5], out: [-10, 0.5], broken: true });
  const ks = M.keyframesOf(m, r.id, "x");
  assert.deepEqual([ks[1].t, ks[1].in, ks[1].out, ks[1].broken], [4, [10, 0.5], [-10, 0.5], true]);
  m = M.moveKeyframes(m, r.id, "x", [4], 0.51, 5);
  assert.deepEqual([m.clips[r.id].x.kf[1].t, m.clips[r.id].x.kf[1].v], [2.52, 105]);
  assert.throws(() => M.editKeyframes(m, r.id, "y", (x) => x), /no keyframes/);
  const p = M.pasteKeyframes(m, r.id, "opacity", [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 9, v: 0 }], 3);
  assert.deepEqual(p.clips[r.id].opacity.kf.map((k) => k.t), [1, 2], "keyframes past the clip are dropped");
});

// ------------------------------------------------------------------------------------------- compositions

function nested() {
  let m = M.emptyScene({ fps: 20, width: 400, height: 200 });
  m = M.addMedia(m, { id: "snd", kind: "audio", mime: "audio/wav", name: "a.wav", duration: 20 }).model;
  // inner: a solid and a sound
  const inner = M.addComp(m, { name: "Inner", width: 100, height: 100 });
  m = inner.model;
  m = M.inSequence(m, inner.id, (s) => M.addClip(s, { type: "solid", start: 0, dur: 4, x: { kf: [{ t: 0, v: 0 }, { t: 4, v: 100 }] } }).model);
  m = M.inSequence(m, inner.id, (s) => M.addClip(s, { type: "audio", media: "snd", start: 1, dur: 2, in: 5 }).model);
  // outer: the inner composition at 1 s, twice as fast
  const outer = M.addComp(m, { name: "Outer" });
  m = outer.model;
  m = M.inSequence(m, outer.id, (s) => M.placeComp(s, inner.id, { start: 1 }).model);
  // main: the outer composition at 10 s
  const top = M.placeComp(m, outer.id, { start: 10 });
  return { m: top.model, inner: inner.id, outer: outer.id, clip: top.id };
}

test("nesting: frames evaluate through two levels with each clip's own time", () => {
  const { m, inner, outer, clip } = nested();
  assert.equal(m.clips[clip].dur, 5, "a composition clip is as long as its content");
  const top = frameState(m, 12).layers.find((l) => l.clip.id === clip);
  near(top.time, 2);
  const mid = frameState(m, top.time, { seq: outer }).layers[0];
  assert.equal(mid.clip.comp, inner);
  near(mid.time, 1);
  near(frameState(m, mid.time, { seq: inner }).layers[0].x, 25);
  // speed and trim of a composition clip
  const fast = M.setSpeed(m, clip, 2);
  near(sourceTime(fast.clips[clip], 1), 2);
  assert.equal(fast.clips[clip].dur, 2.5);
});

test("cycles: a composition cannot contain itself, directly or through nesting; foreign files are repaired", () => {
  const { m, inner, outer } = nested();
  assert.equal(M.wouldCycle(m, inner, outer), true);
  assert.equal(M.wouldCycle(m, outer, inner), false);
  assert.equal(M.wouldCycle(m, "main", inner), false);
  assert.throws(() => M.inSequence(m, inner, (s) => M.placeComp(s, outer).model), /contains this composition/);
  assert.throws(() => M.inSequence(m, inner, (s) => M.placeComp(s, inner).model), /cannot contain itself/);
  // a file that makes a loop loses the clip that closes it
  const raw = JSON.parse(JSON.stringify(m));
  const tv = raw.comps[inner].tracks.find((x) => x.kind === "video").id;
  raw.comps[inner].clips.loop = { id: "loop", track: tv, type: "comp", comp: outer, start: 6, dur: 1 };
  const fixed = M.normalizeScene(raw);
  assert.equal(M.compReaches(fixed.comps, outer, outer), true, "trivially reaches itself");
  assert.equal(M.compReaches(fixed.comps, inner, outer), false, "the loop is gone");
  assert.ok(!fixed.comps[inner].clips.loop);
  assert.equal(Object.keys(fixed.comps[outer].clips).length, 1, "the legitimate nesting stays");
});

test("pre-compose inside a composition, usage, rename and delete", () => {
  const { m, inner, outer } = nested();
  const ids = Object.keys(m.comps[inner].clips);
  let pc;
  const next = M.inSequence(m, inner, (s) => {
    pc = M.precompose(s, ids, "Deep");
    return pc.model;
  });
  assert.ok(next.comps[pc.comp], "the new composition is kept by commitSequence");
  assert.deepEqual(Object.values(next.comps[inner].clips).map((c) => c.type), ["comp"]);
  assert.deepEqual(Object.values(next.comps[pc.comp].clips).map((c) => c.type).sort(), ["audio", "solid"], "sound goes along");
  assert.deepEqual(M.compUsage(next, inner).map((u) => u.seq), [outer]);
  assert.equal(M.updateComp(next, pc.comp, { name: "Deeper" }).comps[pc.comp].name, "Deeper");
  const gone = M.removeComp(next, inner);
  assert.ok(!gone.comps[inner]);
  assert.equal(Object.keys(gone.comps[outer].clips).length, 0, "clips that used it are removed");
  assert.ok(M.describeScene(next).compositions.find((k) => k.id === inner).uses.includes(pc.comp));
});

test("time remap: on reproduces the timing, keyframes ramp and reverse, a constant freezes", () => {
  const { m, clip } = nested();
  const on = M.setTimeRemap(m, clip, true);
  const c = on.clips[clip];
  for (const l of [0, 1.3, 4.9]) near(sourceTime(c, l), l);
  // reverse: play the composition backwards
  const rev = M.updateClip(on, clip, { remap: { kf: [{ t: 0, v: 5 }, { t: 5, v: 0 }] } });
  near(frameState(rev, 11).layers[0].time, 4);
  const frozen = M.updateClip(on, clip, { remap: 2 });
  near(frameState(frozen, 14).layers[0].time, 2);
  assert.equal(M.maxDur(frozen, frozen.clips[clip]), Infinity, "remapped clips can be extended");
  // keyframes of remap follow the clip like any property (split)
  const sp = M.splitClip(rev, clip, 12);
  near(sourceTime(sp.model.clips[sp.id], 0), 3);
  const off = M.setTimeRemap(rev, clip, false);
  assert.equal(off.clips[clip].remap, undefined);
  assert.throws(() => M.setTimeRemap(m, Object.keys(m.comps[Object.keys(m.comps)[0]].clips)[0], true), /no clip|composition clips/);
});

test("sound passes through nested compositions with speed, trim, volume and mute", () => {
  const { m, clip, outer } = nested();
  const v = flattenAudio(m);
  assert.equal(v.length, 1);
  // inner audio at 1..3 s of Inner, Inner at 1 s of Outer, Outer at 10 s of main → 12..14 s
  near(v[0].start, 12);
  near(v[0].dur, 2);
  near(v[0].in, 5);
  assert.equal(v[0].id.split("/").length, 3);
  // twice as fast: starts at 11, lasts 1 s, plays its source twice as fast
  const fast = flattenAudio(M.setSpeed(m, clip, 2))[0];
  near(fast.start, 11);
  near(fast.dur, 1);
  near(fast.speed, 2);
  // a head trim of the main clip cuts into the sound
  const trimmed = flattenAudio(M.trimClip(m, clip, "start", 12.5))[0];
  near(trimmed.start, 12.5);
  near(trimmed.in, 5.5);
  // the composition clip's volume applies on top
  const quiet = flattenAudio(M.updateClip(m, clip, { volume: 0.5 }))[0];
  near(quiet.gain(0.5), 0.5);
  assert.equal(flattenAudio(M.updateClip(m, clip, { muted: true })).length, 0);
  assert.equal(flattenAudio(M.setTimeRemap(m, clip, true)).length, 0, "time-remapped compositions are silent");
  // the composition alone (its own tab) plays its sound in its own time
  near(flattenAudio(m, { seq: outer })[0].start, 2);
});
