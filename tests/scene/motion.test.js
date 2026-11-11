// Scene Studio assistant tools, motion presets and timeline automation (scene/motion.js).
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/scene/model.js";
import * as X from "../../app/src/scene/motion.js";
import { valueAt, isTrack } from "../../app/src/scene/keyframes.js";
import { frameState } from "../../app/src/scene/evaluate.js";

function scene() {
  let m = M.emptyScene({ title: "Motion" });
  m = M.addMedia(m, { id: "vid", kind: "video", mime: "video/mp4", name: "a.mp4", duration: 20, w: 1920, h: 1080, hasAudio: true }).model;
  m = M.addMedia(m, { id: "vid2", kind: "video", mime: "video/mp4", name: "b.mp4", duration: 3, w: 1920, h: 1080, hasAudio: false }).model;
  for (const id of ["p1", "p2", "p3"]) m = M.addMedia(m, { id, kind: "image", mime: "image/jpeg", name: `${id}.jpg`, w: 1600, h: 1200 }).model;
  m = M.addMedia(m, { id: "song", kind: "audio", mime: "audio/mpeg", name: "song.mp3", duration: 30 }).model;
  return M.setAnalysis(m, "song", { beats: { bpm: 120, times: Array.from({ length: 60 }, (_, i) => i * 0.5), onsets: [] } });
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("animateClip: entrances, exits and continuous moves are keyframes that end at rest", () => {
  let m = M.addClip(scene(), { type: "shape", start: 1, dur: 4, x: 500, y: 300 }).model;
  const id = M.clipList(m)[0].id;
  let r = X.animateClip(m, { id, preset: "slide-from-left", edge: "both", dur: 0.5 });
  let c = r.model.clips[id];
  near(valueAt(c.x, 0), 500 - 1920 * 0.35);
  near(valueAt(c.x, 0.5), 500);
  near(valueAt(c.x, 3.5), 500);
  near(valueAt(c.x, 4), 500 - 1920 * 0.35);
  near(valueAt(c.opacity, 0), 0);
  near(valueAt(c.opacity, 2), 1);
  r = X.animateClip(m, { id, preset: "pop" });
  near(valueAt(r.model.clips[id].sx, 0.5), 1);
  r = X.animateClip(m, { id, preset: "blur", edge: "in" });
  assert.equal(r.model.clips[id].effects[0].type, "blur");
  r = X.animateClip(m, { id, preset: "shake" });
  c = r.model.clips[id];
  assert.ok(isTrack(c.x) && c.x.kf.length > 50);
  const again = X.animateClip(m, { id, preset: "shake" }).model.clips[id];
  assert.deepEqual(again.x, c.x, "deterministic");
  r = X.animateClip(m, { id, preset: "ken-burns" });
  assert.ok(valueAt(r.model.clips[id].sx, 4) > valueAt(r.model.clips[id].sx, 0));
  assert.throws(() => X.animateClip(m, { id, preset: "wiggle" }), /Presets/);
});

test("titleAnimation and lowerThird build editable clips", () => {
  let r = X.titleAnimation(scene(), { text: "Launch", subtitle: "Spring 2027", preset: "underline", background: "#000000", start: 1, dur: 4 });
  let clips = r.result.ids.map((id) => r.model.clips[id]);
  assert.deepEqual(clips.map((c) => c.type), ["solid", "text", "shape", "text"]);
  assert.equal(clips[1].text.anim.in, "slide-up");
  assert.ok(isTrack(clips[2].sx), "the underline grows");
  assert.equal(frameState(r.model, 2.5).layers.length, 4);
  assert.throws(() => X.titleAnimation(scene(), { text: "x", preset: "matrix" }), /Presets/);
  assert.throws(() => X.titleAnimation(scene(), { text: " " }), /needs text/);
  for (const style of X.LOWER_THIRD_STYLES) {
    r = X.lowerThird(scene(), { name: "Ada Lovelace", title: "Mathematician", style, side: style === "box" ? "right" : "left", start: 2, dur: 5 });
    clips = r.result.ids.map((id) => r.model.clips[id]);
    const name = clips.find((c) => c.name === "Lower third name");
    assert.ok(name && name.text.text === "Ada Lovelace", style);
    assert.ok(name.y > 1080 * 0.7, "in the lower third");
    assert.ok(clips.every((c) => c.start >= 2 && M.clipEnd(c) <= 7 + 1e-6));
  }
  const bar = X.lowerThird(scene(), { name: "A", style: "bar", start: 0, dur: 5 });
  const panel = bar.model.clips[bar.result.ids[0]];
  assert.ok(valueAt(panel.x, 0) < 0 && valueAt(panel.x, 1) > 0, "slides in from the left");
});

test("slideshow: durations, transitions, Ken Burns, music and beats", () => {
  let r = X.slideshow(scene(), { media: ["p1", "p2", "p3"], dur: 2, music: "song" });
  let clips = r.result.clips.map((id) => r.model.clips[id]);
  assert.deepEqual(clips.map((c) => c.start), [0, 2, 4]);
  assert.equal(clips[1].tin.type, "dissolve");
  assert.ok(isTrack(clips[0].sx), "Ken Burns");
  assert.ok(valueAt(clips[0].sx, 0) >= 1920 / 1600 - 1e-9, "fills the frame");
  assert.equal(r.model.clips[r.result.music].dur, 6);
  r = X.slideshow(scene(), { media: ["p1", "p2", "p3"], music: "song", beats: 4, transition: "none", kenBurns: false });
  clips = r.result.clips.map((id) => r.model.clips[id]);
  assert.deepEqual(clips.map((c) => c.dur), [2, 2, 2], "four beats at 120 BPM");
  assert.equal(clips[1].tin, null);
  const noBeats = M.setAnalysis(scene(), "song", { beats: undefined });
  assert.throws(() => X.slideshow(noBeats, { media: ["p1"], music: "song", beats: 2 }), /scene_analyze_audio/);
  assert.throws(() => X.slideshow(scene(), { media: ["song"] }), /pass it as music/);
});

test("beatCuts: cuts on the grid, sources in turn, each video continues", () => {
  const r = X.beatCuts(scene(), { music: "song", sources: ["vid", "vid2"], every: 2, from: 0, to: 6 });
  const clips = M.trackClips(r.model, M.videoTracks(r.model).find((t) => t.name === "Beat cuts").id);
  assert.equal(clips.length, 6);
  assert.ok(clips.every((c) => Math.abs(c.dur - 1) < 1e-6), "every 2 beats = 1 s");
  assert.deepEqual(clips.map((c) => c.media), ["vid", "vid2", "vid", "vid2", "vid", "vid2"]);
  assert.ok(clips[2].in > clips[0].in, "the source continues");
  assert.ok(M.clipList(r.model).some((c) => c.type === "audio" && c.media === "song"), "music placed");
  assert.throws(() => X.beatCuts(scene(), { music: "song", sources: ["song"] }), /not a video or image/);
  assert.throws(() => X.beatCuts(M.setAnalysis(scene(), "song", { beats: null }), { music: "song", sources: ["vid"] }), /beat grid/);
});

test("reframe: 16:9 to 9:16 keeps the focus centered, text stays in frame", () => {
  let m = M.placeMedia(scene(), "vid", { start: 0 }).model;
  m = M.addClip(m, { type: "text", start: 0, dur: 5, x: 960, y: 980, text: { text: "A long caption line that is wide", size: 60 }, caption: true }).model;
  m = M.addClip(m, { type: "solid", start: 0, dur: 5, color: "#000000" }).model;
  const r = X.reframe(m, { aspect: "9:16", focus: { x: 0.7, y: 0.5 } });
  const n = r.model;
  assert.deepEqual([n.width, n.height], [1080, 1920]);
  const v = M.clipList(n).find((c) => c.type === "video");
  near(v.sx, 1920 / 1080, 1e-3);
  // the focus point of the old frame (0.7 × 1920) lands in the middle of the new frame
  near(v.x + (0.7 * 1920 - 960) * v.sx, 540, 0.5);
  const cap = M.clipList(n).find((c) => c.caption);
  assert.equal(cap.text.boxW, Math.round(1080 * 0.86));
  near(cap.y, (980 / 1080) * 1920);
  const solid = M.clipList(n).find((c) => c.type === "solid");
  assert.deepEqual([solid.x, solid.y], [540, 960]);
  assert.equal(M.clipList(n).find((c) => c.type === "audio").start, 0, "sound untouched");
  // the window never leaves the old frame: a focus at the far left is clamped
  const left = X.reframe(m, { aspect: "9:16", focus: { x: 0, y: 0.5 } }).model;
  const vl = M.clipList(left).find((c) => c.type === "video");
  near(vl.x - (vl.sx * 1920) / 2, 0, 0.5);
  // a moving focus becomes keyframes
  const moving = X.reframe(m, { aspect: "1:1", track: [{ t: 0, x: 0.3, y: 0.5 }, { t: 10, x: 0.7, y: 0.5 }] }).model;
  const vm = M.clipList(moving).find((c) => c.type === "video");
  assert.ok(isTrack(vm.x) && valueAt(vm.x, 0) > valueAt(vm.x, 10), "the picture moves left as the focus moves right");
  assert.throws(() => X.reframe(m, { aspect: "3:2" }), /Unknown aspect/);
  assert.deepEqual(X.aspectSize({ width: 1080, height: 1920 }, "16:9"), { width: 1920, height: 1080 });
});

test("highlightReel: ranges in the given order with transitions and fades", () => {
  let m = M.placeMedia(scene(), "vid", { start: 0 }).model;
  m = M.addMarker(m, 12.5, "Goal").model;
  const r = X.highlightReel(m, { ranges: [[12, 14], [2, 4], [12, 13]], transition: "dissolve" });
  const n = r.model;
  assert.equal(r.result.duration, 5);
  const video = M.clipList(n).filter((c) => c.type === "video");
  assert.deepEqual(video.map((c) => [c.start, c.in]), [[0, 12], [2, 2], [4, 12]]);
  assert.equal(video[0].tin, null);
  assert.equal(video[1].tin.type, "dissolve");
  const audio = M.clipList(n).filter((c) => c.type === "audio");
  assert.ok(audio[1].fadeIn > 0 && audio[0].fadeOut > 0);
  assert.deepEqual(n.markers.map((k) => k.t), [0.5, 4.5]);
  assert.throws(() => X.highlightReel(m, { ranges: [] }), /Pass ranges/);
});
