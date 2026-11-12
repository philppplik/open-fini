// Scene Studio format 3 and the timeline's keyframe and clip operations (scene/keyops.js, scene/edit-ops.js).
import test from "node:test";
import assert from "node:assert/strict";
import * as K from "../../app/src/scene/keyframes.js";
import * as M from "../../app/src/scene/model.js";
import * as KO from "../../app/src/scene/keyops.js";
import * as E from "../../app/src/scene/edit-ops.js";
import { frameState, flattenAudio } from "../../app/src/scene/evaluate.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} â‰ˆ ${b}`);

function scene() {
  let m = M.emptyScene({ fps: 25 });
  m = M.addMedia(m, { id: "mv", kind: "video", name: "clip.mp4", duration: 20, w: 1920, h: 1080, hasAudio: true }).model;
  const r = M.placeMedia(m, "mv", { start: 0, dur: 10 });
  m = r.model;
  const v = M.videoTracks(m)[1].id;
  m = M.addClip(m, { id: "s1", type: "solid", track: M.videoTracks(m)[0].id, start: 0, dur: 4, opacity: { kf: [{ t: 0, v: 0 }, { t: 1, v: 1, e: "easeOut" }, { t: 3, v: 0.5 }] } }).model;
  return { m, video: r.ids[0], audio: r.ids[1], v };
}

test("format 3: nested keyframes, anchor point and flags survive normalization and evaluate", () => {
  let m = M.emptyScene({ fps: 25 });
  m = M.addClip(m, { id: "t1", type: "text", start: 0, dur: 2, text: { text: "Hi", size: { kf: [{ t: 0, v: 40 }, { t: 2, v: 80 }] }, color: { kf: [{ t: 0, v: "#000000" }, { t: 2, v: "#ffffff" }] } }, ax: { kf: [{ t: 0, v: 0 }, { t: 2, v: 10 }] }, label: "#ff0000", off: false }).model;
  m = M.addClip(m, { id: "s1", type: "shape", start: 0, dur: 2, shape: { w: { kf: [{ t: 0, v: 100 }, { t: 1, v: 300 }] } }, crop: { l: { kf: [{ t: 0, v: 0 }, { t: 2, v: 0.5 }] } }, mask: { shape: "rect", feather: { kf: [{ t: 0, v: 0 }, { t: 2, v: 20 }] } } }).model;
  const n = M.normalizeScene(JSON.parse(JSON.stringify(m)));
  assert.equal(n.version, 3);
  assert.ok(K.isTrack(n.clips.t1.text.size) && K.isTrack(n.clips.t1.text.color) && K.isTrack(n.clips.t1.ax));
  assert.equal(n.clips.t1.label, "#ff0000");
  assert.deepEqual(M.animatedPaths(n.clips.s1).sort(), ["crop.l", "mask.feather", "shape.w"]);
  const L = frameState(n, 1).layers;
  const text = L.find((l) => l.clip.id === "t1");
  near(text.clip.text.size, 60);
  assert.equal(text.clip.text.color, "#808080");
  near(text.ax, 5);
  const sh = L.find((l) => l.clip.id === "s1");
  near(sh.clip.shape.w, 300);
  near(sh.crop.l, 0.25);
  near(sh.mask.feather, 10);
  // setProp / setKeyframe address nested paths; a split keeps both halves animated
  let k = M.setKeyframe(n, "s1", "shape.h", 0.5, 50);
  assert.ok(K.isTrack(k.clips.s1.shape.h));
  const r = M.splitClip(k, "s1", 1);
  near(K.valueAt(r.model.clips[r.id].crop.l, 0), 0.25);
  near(K.valueAt(r.model.clips.s1.crop.l, 1), 0.25);
  // trimming the head retimes nested keyframes too
  const tr = M.trimClip(n, "s1", "start", 0.4);
  near(K.valueAt(tr.clips.s1.shape.w, 0.6), 300);
});

test("format 3: disabled clips and soloed tracks drop out of picture and sound", () => {
  const { m, video, audio } = scene();
  assert.equal(frameState(m, 1).layers.length, 2);
  const off = M.updateClip(m, video, { off: true });
  assert.equal(frameState(off, 1).layers.length, 1);
  assert.equal(flattenAudio(M.updateClip(m, audio, { off: true })).length, 0);
  const a2 = M.addTrack(m, "audio").id;
  const solo = M.updateTrack(m, M.audioTracks(m)[1].id, { solo: true });
  assert.equal(flattenAudio(solo).length, 0, "the clip's track is not the soloed one");
  assert.ok(a2);
  assert.equal(M.updateTrack(solo, M.audioTracks(m)[1].id, { solo: false }).tracks.some((t) => t.solo), false);
});

test("links: placed video and sound are linked; a cut keeps pairs; unlink detaches", () => {
  const { m, video, audio } = scene();
  assert.equal(m.clips[video].link, m.clips[audio].link);
  assert.deepEqual(E.linkedIds(m, [video]).sort(), [video, audio].sort());
  const s = M.splitAll(m, 5);
  const [v2, a2] = s.ids;
  assert.equal(s.model.clips[v2].link, s.model.clips[a2].link);
  assert.notEqual(s.model.clips[v2].link, s.model.clips[video].link);
  const u = E.unlinkClips(m, [video]);
  assert.equal(u.clips[video].link, undefined);
  assert.equal(u.clips[audio].link, undefined);
  const l = E.linkClips(u, [video, "s1"]);
  assert.equal(l.clips.s1.link, l.clips[video].link);
});

test("keyframe selection: delete, ease, value, retime (move and scale), reverse", () => {
  const { m } = scene();
  const all = KO.keysOfClip(m.clips.s1);
  assert.equal(all.length, 3);
  const del = KO.deleteKeys(m, [all[1]]);
  assert.equal(del.clips.s1.opacity.kf.length, 2);
  const eased = KO.easeKeys(m, [all[0]], "hold");
  assert.equal(eased.clips.s1.opacity.kf[0].e, "hold");
  assert.equal(KO.setKeyValue(m, [all[2]], 0.2).clips.s1.opacity.kf[2].v, 0.2);
  // move by 0.4 s (frame snapped)
  const mv = KO.retimeKeys(m, [all[1], all[2]], { dt: 0.4 });
  assert.deepEqual(mv.model.clips.s1.opacity.kf.map((k) => k.t), [0, 1.4, 3.4]);
  assert.equal(mv.sel.length, 2);
  // scale around the first keyframe (timeline 0) by 2: 1 â†’ 2, 3 â†’ clamped into the clip (4)
  const sc = KO.retimeKeys(m, all, { factor: 0.5, pivot: 0 });
  assert.deepEqual(sc.model.clips.s1.opacity.kf.map((k) => k.t), [0, 0.52, 1.52]);
  // reverse: values play backwards inside the same span
  const rv = KO.reverseKeys(m, all);
  const kf = rv.clips.s1.opacity.kf;
  assert.deepEqual(kf.map((k) => k.t), [0, 2, 3]);
  assert.deepEqual(kf.map((k) => k.v), [0.5, 1, 0]);
  // easeOut leaving the old keyframe at 1 becomes its mirror (an ease in) on the reversed segment 0 â†’ 2
  assert.deepEqual(kf[0].e, [0.42, 0, 1, 1]);
});

test("keyframe clipboard: copy keeps relative timing, paste lands at the playhead; stopwatch toggles", () => {
  const { m } = scene();
  const board = KO.copyKeySel(m, KO.keysOfClip(m.clips.s1).slice(1));
  assert.deepEqual(board.items[0].keys.map((k) => k.t), [0, 2]);
  const p = KO.pasteKeySel(m, "s1", board, 0.2);
  assert.ok(p.model.clips.s1.opacity.kf.some((k) => Math.abs(k.t - 2.2) < 1e-6));
  assert.equal(p.sel.length, 2);
  const on = KO.toggleAnimation(m, "s1", "rot", 1);
  assert.deepEqual(on.clips.s1.rot, { kf: [{ t: 1, v: 0 }] });
  const offAgain = KO.toggleAnimation(on, "s1", "opacity", 2);
  near(offAgain.clips.s1.opacity, K.valueAt(m.clips.s1.opacity, 2));
  assert.deepEqual(KO.keyTimesOf(m.clips.s1), [0, 1, 3]);
});

test("clip clipboard, reverse, freeze frame, trim to playhead, gaps, tracks, arrange, replace media", () => {
  const { m, video, audio } = scene();
  const board = E.copyClips(m, [video, audio]);
  const p = E.pasteClips(m, board, 12);
  assert.equal(p.ids.length, 2);
  assert.equal(p.model.clips[p.ids[0]].start, 12);
  assert.equal(p.model.clips[p.ids[0]].link, p.model.clips[p.ids[1]].link);
  assert.notEqual(p.model.clips[p.ids[0]].link, m.clips[video].link);
  // reverse: remap from the last frame back to the in point
  const r = E.reverseClip(m, video);
  const rm = r.clips[video].remap;
  near(K.valueAt(rm, 0), 10 - 1 / 25);
  near(K.valueAt(rm, 10 - 1 / 25), 0);
  assert.equal(M.maxDur(r, r.clips[video]), Infinity);
  // freeze at 4 s: split, the second part holds source frame 4
  const f = E.freezeFrame(m, video, 4);
  near(f.model.clips[f.id].remap, 4);
  assert.equal(f.model.clips[f.id].start, 4);
  assert.equal(frameState(f.model, 7).layers.find((l) => l.clip.id === f.id).time, 4);
  // trim to playhead
  const t = E.trimTo(m, [video], "end", 6);
  assert.equal(t.clips[video].dur, 6);
  // gaps on one track
  let g = M.addClip(m, { id: "late", type: "solid", track: m.clips.s1.track, start: 6, dur: 1 }).model;
  assert.deepEqual(E.gapAt(g, m.clips.s1.track, 5), [4, 6]);
  g = E.rippleDeleteGap(g, m.clips.s1.track, 5);
  assert.equal(g.clips.late.start, 4);
  // duplicate track
  const d = E.duplicateTrack(m, m.clips.s1.track);
  assert.equal(M.trackClips(d.model, d.id).length, 1);
  // arrange: bring the video clip to the front (the top track holds s1 over 0..4, so a new track is added)
  const a = E.arrangeClip(m, video, 2);
  assert.equal(M.videoTracks(a)[0].id, a.clips[video].track);
  // replace media
  const rp = E.replaceMedia(M.addMedia(m, { id: "mv2", kind: "video", name: "b.mp4", duration: 3, w: 10, h: 10 }).model, video, "mv2");
  assert.equal(rp.clips[video].media, "mv2");
  assert.ok(rp.clips[video].dur <= 3);
  assert.throws(() => E.replaceMedia(m, "s1", "mv"));
});

test("effects: reorder and reset", () => {
  let { m } = scene();
  const a = M.addEffect(m, "s1", "blur", { radius: 4 });
  const b = M.addEffect(a.model, "s1", "sepia", {});
  m = M.moveEffect(b.model, "s1", b.id, 0);
  assert.deepEqual(m.clips.s1.effects.map((e) => e.type), ["sepia", "blur"]);
  m = M.resetEffect(m, "s1", a.id);
  assert.deepEqual(m.clips.s1.effects[1].p, {});
});
