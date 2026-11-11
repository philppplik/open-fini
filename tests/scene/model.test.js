// Scene Studio: keyframes, the timeline model and its editing operations, frame evaluation and the effect math.
import test from "node:test";
import assert from "node:assert/strict";
import * as K from "../../app/src/scene/keyframes.js";
import * as M from "../../app/src/scene/model.js";
import { frameState, transitionState, textAnimState, gainAt } from "../../app/src/scene/evaluate.js";
import { applyPixel, cssFilter, effectParams, stageEffects, registerEffect, EFFECTS } from "../../app/src/scene/effects.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

function scene() {
  let m = M.emptyScene({ title: "T" });
  m = M.addMedia(m, { id: "vid", kind: "video", mime: "video/mp4", name: "clip.mp4", duration: 10, w: 1280, h: 720 }).model;
  m = M.addMedia(m, { id: "img", kind: "image", mime: "image/png", name: "pic.png", w: 800, h: 600 }).model;
  return m;
}
const v1 = (m) => M.videoTracks(m)[1].id;

test("keyframes: hold before and after, linear, eased, colors and arrays", () => {
  const tr = { kf: [{ t: 1, v: 0 }, { t: 3, v: 10 }] };
  assert.equal(K.valueAt(5, 2), 5);
  assert.equal(K.valueAt(tr, 0), 0);
  assert.equal(K.valueAt(tr, 9), 10);
  near(K.valueAt(tr, 2), 5);
  const eased = { kf: [{ t: 0, v: 0, e: "easeIn" }, { t: 1, v: 1 }] };
  assert.ok(K.valueAt(eased, 0.5) < 0.5);
  assert.equal(K.valueAt({ kf: [{ t: 0, v: 1, e: "hold" }, { t: 1, v: 2 }] }, 0.99), 1);
  assert.equal(K.valueAt({ kf: [{ t: 0, v: "#000000" }, { t: 1, v: "#ffffff" }] }, 0.5), "#808080");
  assert.deepEqual(K.valueAt({ kf: [{ t: 0, v: [0, 10] }, { t: 2, v: [10, 20] }] }, 1), [5, 15]);
  // bezier end points and monotony of the standard curves
  for (const name of ["ease", "easeIn", "easeOut", "easeInOut"]) {
    near(K.ease(name, 0), 0);
    near(K.ease(name, 1), 1);
    let last = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = K.ease(name, p);
      assert.ok(v >= last - 1e-6);
      last = v;
    }
  }
  assert.ok(K.ease("back", 0.7) > 1, "back overshoots");
});

test("keyframes: set, replace, remove, normalize", () => {
  let v = K.setKeyframe(4, 1, 4);
  v = K.setKeyframe(v, 0, 0, "easeOut");
  assert.deepEqual(v.kf.map((k) => k.t), [0, 1]);
  v = K.setKeyframe(v, 1, 8);
  assert.equal(v.kf[1].v, 8);
  v = K.removeKeyframe(v, 0);
  assert.equal(K.removeKeyframe(v, 1), 8, "the last keyframe leaves a constant");
  assert.equal(K.normalizeValue({ kf: [{ t: "x", v: 1 }] }, 7), 7);
  assert.deepEqual(K.normalizeValue({ kf: [{ t: 2, v: 1 }, { t: 1, v: 0, e: "nope" }] }, 0), { kf: [{ t: 1, v: 0 }, { t: 2, v: 1 }] });
});

test("model: add, overwrite on the same track, automatic track choice", () => {
  let m = scene();
  const a = M.addClip(m, { type: "video", media: "vid", start: 0, dur: 4, track: v1(m) });
  m = a.model;
  assert.equal(m.clips[a.id].name, "clip.mp4");
  // a clip dropped into the middle splits what it covers
  const b = M.addClip(m, { type: "solid", start: 1, dur: 1, track: v1(m) });
  m = b.model;
  const on = M.trackClips(m, v1(m));
  assert.deepEqual(on.map((c) => [c.start, c.dur]), [[0, 1], [1, 1], [2, 2]]);
  near(on[2].in, 2);
  // without a track the first free one is used
  const c = M.addClip(m, { type: "text", start: 0, dur: 3 });
  assert.notEqual(c.model.clips[c.id].track, v1(m));
  // a media clip cannot be longer than its source
  const long = M.addClip(scene(), { type: "video", media: "vid", start: 0, dur: 99 });
  assert.equal(long.model.clips[long.id].dur, 10);
  assert.throws(() => M.addClip(m, { type: "audio", media: "vid", track: v1(m) }), /video track/);
  assert.throws(() => M.addClip(m, { type: "video", media: "nope" }), /no media/);
});

test("model: split keeps the picture and the animation continuous", () => {
  let m = scene();
  const a = M.addClip(m, { type: "video", media: "vid", start: 1, dur: 4, in: 2, opacity: { kf: [{ t: 0, v: 0 }, { t: 4, v: 1 }] }, tin: { type: "fade", dur: 0.5 }, tout: { type: "fade", dur: 0.5 } });
  m = a.model;
  const r = M.splitClip(m, a.id, 3);
  m = r.model;
  const L = m.clips[a.id];
  const R = m.clips[r.id];
  assert.deepEqual([L.start, L.dur, R.start, R.dur], [1, 2, 3, 2]);
  near(R.in, 4);
  near(K.valueAt(L.opacity, 2), 0.5);
  near(K.valueAt(R.opacity, 0), 0.5);
  near(K.valueAt(R.opacity, 2), 1);
  assert.equal(L.tout, null);
  assert.equal(R.tin, null);
  assert.equal(M.splitClip(m, a.id, 1).id, null, "a cut at the edge does nothing");
});

test("model: trim, ripple trim, move, slip, speed", () => {
  let m = scene();
  const a = M.addClip(m, { type: "video", media: "vid", start: 0, dur: 4, track: v1(m) });
  const b = M.addClip(a.model, { type: "video", media: "vid", start: 4, dur: 4, track: v1(m) });
  m = b.model;
  // head trim moves the in-point
  let t = M.trimClip(m, b.id, "start", 5);
  assert.deepEqual([t.clips[b.id].start, t.clips[b.id].dur, t.clips[b.id].in], [5, 3, 1]);
  // the head cannot go before the start of the source
  t = M.trimClip(m, b.id, "start", 2);
  assert.equal(t.clips[b.id].start, 4);
  // ripple trim of the tail pulls the next clip along
  t = M.trimClip(m, a.id, "end", 3, { ripple: true });
  assert.equal(t.clips[b.id].start, 3);
  // tail cannot pass the end of the source
  t = M.trimClip(m, b.id, "end", 99);
  assert.equal(t.clips[b.id].dur, 10);
  // move onto another clip overwrites it
  t = M.moveClip(m, b.id, { start: 2 });
  assert.equal(t.clips[a.id].dur, 2);
  assert.equal(M.slipClip(m, a.id, 3).clips[a.id].in, 3);
  assert.equal(M.slipClip(m, a.id, 99).clips[a.id].in, 6);
  const s = M.setSpeed(m, a.id, 2, { ripple: true });
  assert.deepEqual([s.clips[a.id].dur, s.clips[b.id].start], [2, 2]);
});

test("model: delete, ripple delete, cut and keep ranges, gaps", () => {
  let m = scene();
  const a = M.addClip(m, { type: "video", media: "vid", start: 0, dur: 4, track: v1(m) });
  const b = M.addClip(a.model, { type: "video", media: "vid", start: 4, dur: 4, track: v1(m) });
  const au = M.addClip(b.model, { type: "audio", media: "vid", start: 0, dur: 8 });
  m = M.addMarker(au.model, 6, "later").model;
  assert.equal(M.deleteClips(m, [a.id], { ripple: true }).clips[b.id].start, 0);
  // cut 1..2 and 5..6 everywhere
  const cut = M.cutRanges(m, [[5, 6], [1, 2]]);
  assert.equal(M.duration(cut), 6);
  assert.deepEqual(M.trackClips(cut, v1(m)).map((c) => [c.start, c.dur, c.in]), [[0, 1, 0], [1, 2, 2], [3, 1, 0], [4, 2, 2]]);
  assert.deepEqual(M.trackClips(cut, au.model.clips[au.id].track).map((c) => [c.start, c.dur, c.in]), [[0, 1, 0], [1, 3, 2], [4, 2, 6]]);
  assert.equal(cut.markers[0].t, 4);
  const kept = M.keepRanges(m, [[1, 2], [6, 7]]);
  assert.equal(M.duration(kept), 2);
  const gap = M.insertGap(m, 2, 1);
  assert.equal(M.duration(gap), 9);
  assert.equal(M.duration(M.closeGaps(gap)), 8);
  assert.deepEqual(M.mergeRanges([[3, 4], [0, 1], [0.5, 2]]), [[0, 2], [3, 4]]);
});

test("model: keyframes, effects, transitions, tracks, pre-compose, describe", () => {
  let m = scene();
  const a = M.addClip(m, { type: "image", media: "img", start: 2, dur: 4 });
  m = a.model;
  m = M.setKeyframe(m, a.id, "x", 2, 100);
  m = M.setKeyframe(m, a.id, "x", 4, 300, "easeOut");
  near(K.valueAt(m.clips[a.id].x, 1), 200);
  m = M.setProp(m, a.id, "x", 500, 4); // animated: writes the keyframe under the playhead
  assert.equal(m.clips[a.id].x.kf[1].v, 500);
  m = M.removeKeyframe(M.removeKeyframe(m, a.id, "x", 2), a.id, "x", 4);
  assert.equal(m.clips[a.id].x, 500);
  const fx = M.addEffect(m, a.id, "blur", { radius: 4 });
  m = M.setKeyframe(fx.model, a.id, `fx:${fx.id}:radius`, 2, 0);
  assert.ok(K.isTrack(m.clips[a.id].effects[0].p.radius));
  m = M.updateEffect(m, a.id, fx.id, { on: false });
  assert.equal(m.clips[a.id].effects[0].on, false);
  assert.throws(() => M.setKeyframe(m, a.id, "nope", 0, 1), /Unknown property/);
  m = M.setTransition(m, a.id, "in", "wipe-left", 1);
  assert.deepEqual(m.clips[a.id].tin, { type: "wipe-left", dur: 1 });
  assert.throws(() => M.setTransition(m, a.id, "in", "sparkle"), /not a transition/);
  const tk = M.addTrack(m, "video");
  assert.equal(tk.model.tracks[0].id, tk.id, "new video tracks go on top");
  assert.throws(() => M.removeTrack(M.removeTrack(m, M.audioTracks(m)[0].id), M.audioTracks(m)[1].id), /at least one/);
  const pc = M.precompose(m, [a.id], "Intro");
  assert.equal(pc.model.clips[pc.id].type, "comp");
  assert.equal(Object.values(pc.model.comps[pc.comp].clips)[0].start, 0);
  const d = M.describeScene(pc.model);
  assert.equal(d.compositions[0].name, "Intro");
  assert.equal(d.clips[0].type, "comp");
  assert.equal(M.timecode(m, 61.5), "00:01:01:15");
  assert.equal(M.parseTime(m, "1:02"), 62);
  assert.equal(M.parseTime(m, "00:00:01:15"), 1.5);
});

test("model: normalize survives hostile input and round-trips through JSON", () => {
  assert.doesNotThrow(() => M.normalizeScene(null));
  const bad = M.normalizeScene({ width: "x", fps: 1e9, tracks: [{ id: "a b", kind: "video" }], clips: { z: { track: "nope" } }, media: { "../x": {} }, comps: { k: { clips: { c: { type: "comp", comp: "missing", track: "t" } } } } });
  assert.equal(bad.fps, 120);
  assert.equal(Object.keys(bad.clips).length, 0);
  let m = scene();
  m = M.placeMedia(m, "vid", { start: 0 }).model;
  m = M.addClip(m, { type: "text", start: 0, dur: 2, text: { text: "Hi", anim: { in: "chars" } } }).model;
  const again = M.normalizeScene(JSON.parse(JSON.stringify(m)));
  assert.deepEqual(again.clips, m.clips);
  assert.deepEqual(again.tracks, m.tracks);
  for (const t of M.TEMPLATES) assert.ok(M.templateScene(t.id, { title: "X" }).tracks.length);
});

test("placeMedia: fits the picture and links the sound", () => {
  const r = M.placeMedia(scene(), "vid", {});
  const [v, a] = r.ids.map((id) => r.model.clips[id]);
  assert.equal(v.type, "video");
  assert.equal(a.type, "audio");
  assert.equal(v.sx, 1.5);
  assert.equal(M.placeMedia(scene(), "img", {}).model.clips[M.placeMedia(scene(), "img", {}).ids[0]]?.dur ?? 5, 5);
});

test("evaluate: layer order, keyframes, transitions and the cross dissolve tail", () => {
  let m = scene();
  const bottom = M.addClip(m, { type: "solid", start: 0, dur: 4, track: v1(m) });
  const top = M.addClip(bottom.model, { type: "text", start: 1, dur: 2, track: M.videoTracks(m)[0].id, opacity: { kf: [{ t: 0, v: 0 }, { t: 2, v: 1 }] }, text: { anim: { in: "pop", inDur: 0.5 } } });
  m = top.model;
  let f = frameState(m, 2);
  assert.deepEqual(f.layers.map((l) => l.clip.id), [bottom.id, top.id]);
  near(f.layers[1].opacity, 0.5);
  assert.equal(frameState(m, 1.25).layers[1].textAnim.type, "pop");
  assert.equal(frameState(m, 3.5).layers.length, 1);
  assert.equal(frameState(m, 4).layers.length, 0, "the end is exclusive");
  // hidden tracks are skipped
  assert.equal(frameState(M.updateTrack(m, v1(m), { hidden: true }), 2).layers.length, 1);
  // cross dissolve: the previous clip stays under the incoming one
  let d = scene();
  const a = M.addClip(d, { type: "video", media: "vid", start: 0, dur: 2, track: v1(d) });
  const b = M.addClip(a.model, { type: "image", media: "img", start: 2, dur: 2, track: v1(d), tin: { type: "dissolve", dur: 1 } });
  f = frameState(b.model, 2.5);
  assert.deepEqual(f.layers.map((l) => l.clip.id), [a.id, b.id]);
  near(f.layers[0].time, 2.5);
  assert.ok(f.layers[1].opacity > 0 && f.layers[1].opacity < 1);
  assert.equal(frameState(b.model, 3.2).layers.length, 1);
  // transition modifiers
  assert.equal(transitionState("slide-left", 0, "in").dx, 1);
  assert.equal(transitionState("slide-left", 0, "out").dx, -1);
  assert.deepEqual(transitionState("wipe-right", 1).wipe, [0, 0, 1, 1]);
  assert.equal(transitionState("dip-black", 0).dip.a, 1);
  assert.equal(textAnimState({ in: "none", out: "fade", inDur: 1, outDur: 1 }, 1.5, 2).edge, "out");
  // audio gain: volume × fades
  const au = M.normalizeClip(m, { type: "audio", media: "vid", dur: 4, volume: 0.5, fadeIn: 1, fadeOut: 1 });
  near(gainAt(au, 0.5), 0.25);
  near(gainAt(au, 2), 0.5);
  near(gainAt(au, 3.5), 0.25);
});

test("effects: parameters, CSS filters and the pixel math", () => {
  assert.deepEqual(effectParams("blur", { radius: 9999 }), { radius: 200 });
  assert.equal(effectParams("nope"), null);
  assert.equal(cssFilter([{ type: "blur", p: { radius: 4 } }, { type: "grade", p: {} }, { type: "grayscale", p: {} }]), "blur(4px) grayscale(1)");
  assert.equal(stageEffects([{ type: "blur", p: {} }, { type: "vignette", p: {} }], "pixel").length, 1);
  const px = (r, g, b, a = 255) => new Uint8ClampedArray([r, g, b, a]);
  const run = (data, type, p) => applyPixel(data, 1, 1, stageEffects([{ type, p }], "pixel"));
  // the default grade is the identity
  assert.deepEqual([...run(px(120, 60, 200), "grade", {})], [120, 60, 200, 255]);
  // exposure brightens, saturation 0 gives gray
  assert.ok(run(px(100, 100, 100), "grade", { exposure: 1 })[0] > 180);
  const gray = run(px(200, 40, 40), "grade", { saturation: 0 });
  assert.ok(Math.abs(gray[0] - gray[1]) <= 1 && Math.abs(gray[1] - gray[2]) <= 1);
  // chroma key: the key color becomes transparent, skin tones stay
  assert.equal(run(px(0, 208, 0), "chroma-key", {})[3], 0);
  assert.equal(run(px(220, 170, 140), "chroma-key", {})[3], 255);
  assert.deepEqual([...run(px(128, 128, 128), "posterize", { levels: 2 })].slice(0, 3), [255, 255, 255]);
  // duotone maps black to the shadow color
  assert.deepEqual([...run(px(0, 0, 0), "duotone", { shadows: "#102030", highlights: "#ffffff" })].slice(0, 3), [16, 32, 48]);
  // vignette darkens corners, not the center
  const img = new Uint8ClampedArray(9 * 4).fill(200);
  applyPixel(img, 3, 3, stageEffects([{ type: "vignette", p: { amount: 1, size: 0.2, softness: 0.3 } }], "pixel"));
  assert.ok(img[0] < img[16]);
  assert.equal(registerEffect("blur", {}), false);
  assert.equal(registerEffect("my-fx", { label: "X", stage: "filter", params: {}, css: () => "" }), true);
  delete EFFECTS["my-fx"];
});
