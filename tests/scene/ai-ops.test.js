// Scene Studio assistant tools, "Scene" group: the pure logic of every editing tool (scene/ai-ops.js).
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/scene/model.js";
import * as O from "../../app/src/scene/ai-ops.js";
import { valueAt, isTrack } from "../../app/src/scene/keyframes.js";

function scene() {
  let m = M.emptyScene({ title: "Test" });
  m = M.addMedia(m, { id: "vid", kind: "video", mime: "video/mp4", name: "talk.mp4", duration: 20, w: 1280, h: 720, hasAudio: true }).model;
  m = M.addMedia(m, { id: "img", kind: "image", mime: "image/png", name: "pic.png", w: 800, h: 600 }).model;
  m = M.addMedia(m, { id: "song", kind: "audio", mime: "audio/mpeg", name: "song.mp3", duration: 30 }).model;
  return m;
}
const place = (m, a) => O.placeMedia(m, a).model;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("time codes, tracks by name and clear errors", () => {
  const m = scene();
  assert.equal(O.time(m, "1:05.5"), 65.5);
  assert.equal(O.time(m, "00:00:02:15"), 2.5);
  assert.throws(() => O.time(m, "soon"), /not a time/);
  assert.equal(O.findTrack(m, "v1").name, "V1");
  assert.throws(() => O.findTrack(m, "A1", "video"), /audio track/);
  assert.throws(() => O.findTrack(m, "nope"), /Tracks: V2/);
  assert.throws(() => O.clipOf(m, "zz"), /scene_describe/);
});

test("summary: one line per clip, analysis in numbers, detail on request", () => {
  let m = place(scene(), { media: "vid" });
  m = M.setAnalysis(m, "vid", { shots: [{ t0: 0, t1: 5 }], loudness: { integrated: -20, peak: -3 } });
  const s = O.summary(m);
  assert.equal(s.format, "1920×1080 @ 30 fps");
  assert.equal(s.clips.length, 2);
  assert.match(s.clips.find((l) => / video /.test(l)), /video "talk.mp4" V1 0–20s media=vid scale=1.5/);
  assert.equal(s.analysis.vid.shots, 1);
  const id = M.clipList(m)[0].id;
  assert.equal(O.summary(m, { clips: [id] }).detail[0].id, id);
  assert.equal(O.summary(m, { from: 25 }).clips.length, 0);
  assert.ok(O.catalog().effects.look.params.look.includes("Teal and orange"));
});

test("placeMedia: source range, speed and the linked sound", () => {
  const r = O.placeMedia(scene(), { media: "vid", start: 2, sourceIn: 4, sourceOut: 10, speed: 2 });
  const [v, a] = r.result.ids.map((id) => r.model.clips[id]);
  assert.equal(v.type, "video");
  assert.equal(a.type, "audio");
  for (const c of [v, a]) {
    assert.equal(c.start, 2);
    assert.equal(c.in, 4);
    assert.equal(c.speed, 2);
    near(c.dur, 3);
  }
  assert.throws(() => O.placeMedia(scene(), { media: "vid", sourceIn: 25 }), /past the end/);
  assert.throws(() => O.placeMedia(scene(), { media: "nope" }), /Media: vid/);
  const img = O.placeMedia(scene(), { media: "img", start: 1, dur: 2, fit: "fill" });
  assert.equal(img.model.clips[img.result.ids[0]].dur, 2);
});

test("addLayer: text, shape, solid and adjustment with effects", () => {
  let r = O.addLayer(scene(), { type: "text", text: "Hello", style: { size: 80, color: "#ff0000" }, start: "0:01", dur: 2, x: 100, effects: [{ type: "shadow" }] });
  const c = r.model.clips[r.result.id];
  assert.equal(c.text.text, "Hello");
  assert.equal(c.text.size, 80);
  assert.equal(c.x, 100);
  assert.equal(c.start, 1);
  assert.equal(c.effects[0].type, "shadow");
  r = O.addLayer(r.model, { type: "adjustment", start: 0, end: 4 });
  assert.equal(r.model.clips[r.result.id].name, "Adjustment layer");
  assert.throws(() => O.addLayer(scene(), { type: "text" }), /needs text/);
  assert.throws(() => O.addLayer(scene(), { type: "solid", blend: "glowy" }), /blend mode/);
  assert.throws(() => O.addLayer(scene(), { type: "image", media: "nope" }), /Import it/);
});

test("move, trim, split, delete and speed", () => {
  let m = place(scene(), { media: "vid", start: 0, withAudio: false });
  const id = M.clipList(m)[0].id;
  m = O.moveClips(m, { ids: [id], start: 3 }).model;
  assert.equal(m.clips[id].start, 3);
  m = O.moveClips(m, { ids: [id], by: -1 }).model;
  assert.equal(m.clips[id].start, 2);
  m = O.moveClips(m, { ids: [id], track: "V2" }).model;
  assert.equal(M.trackOf(m, m.clips[id].track).name, "V2");
  let r = O.trimClip(m, { id, edge: "end", to: 30 });
  assert.match(r.result.note, /cannot grow past its source/);
  m = O.trimClip(m, { id, edge: "end", by: -10 }).model;
  near(m.clips[id].dur, 10);
  r = O.split(m, { at: 7 });
  assert.equal(r.result.newClips.length, 1);
  m = r.model;
  assert.throws(() => O.split(m, { at: 100 }), /Nothing to split/);
  const second = r.result.newClips[0];
  m = O.deleteClips(m, { ids: [id], ripple: true }).model;
  assert.equal(m.clips[second].start, 2);
  m = O.setSpeed(m, { id: second, speed: 0.5 }).model;
  near(m.clips[second].dur, 10);
  assert.throws(() => O.setSpeed(m, { id: second, speed: 50 }), /between/);
});

test("setSpeed changes the linked sound of a video too", () => {
  const m = place(scene(), { media: "vid", start: 0, dur: 4 });
  const [v, a] = ["video", "audio"].map((type) => M.clipList(m).find((c) => c.type === type).id);
  const r = O.setSpeed(m, { id: v, speed: 2 });
  assert.equal(r.result.audio, a);
  near(r.model.clips[a].dur, 2);
});

test("updateClips, transitions and keyframes with easing", () => {
  let m = O.addLayer(scene(), { type: "shape", shape: { kind: "ellipse", w: 100, h: 100 }, start: 0, dur: 4 }).model;
  const id = M.clipList(m)[0].id;
  m = O.updateClips(m, { ids: [id], props: { scale: 2, opacity: 0.5, blend: "screen", mask: { shape: "ellipse", w: 0.5, h: 0.5 } } }).model;
  assert.equal(m.clips[id].sx, 2);
  assert.equal(m.clips[id].blend, "screen");
  assert.throws(() => O.updateClips(m, { ids: [id], props: {} }), /props is empty/);
  m = O.setTransitions(m, { ids: [id], edge: "both", type: "dissolve", dur: 1 }).model;
  assert.deepEqual([m.clips[id].tin.type, m.clips[id].tout.dur], ["dissolve", 1]);
  m = O.setTransitions(m, { ids: [id], edge: "out", type: "none" }).model;
  assert.equal(m.clips[id].tout, null);
  m = O.keyframes(m, { id, prop: "x", keys: [{ t: 0, v: 0, easing: "easeOut" }, { t: 2, v: 1000 }] }).model;
  assert.ok(isTrack(m.clips[id].x));
  assert.ok(valueAt(m.clips[id].x, 1) > 500, "ease out is ahead of linear");
  m = O.keyframes(m, { id, prop: "x", mode: "replace", keys: [{ t: "0:01", v: 50 }] }).model;
  assert.deepEqual(m.clips[id].x.kf.map((k) => k.t), [1]);
  m = O.keyframes(m, { id, prop: "x", mode: "clear" }).model;
  assert.equal(m.clips[id].x, 50);
  assert.throws(() => O.keyframes(m, { id, prop: "x", keys: [{ t: 0, v: 1, easing: "wobbly" }] }), /Unknown easing/);
  const tl = O.keyframes(m, { id, prop: "opacity", timeBase: "timeline", keys: [{ t: 3, v: 0 }] }).model;
  assert.equal(tl.clips[id].opacity.kf[0].t, 3);
});

test("effects: add, update, remove, stage checks and animated parameters", () => {
  let m = place(scene(), { media: "vid", start: 0 });
  const [v, a] = ["video", "audio"].map((type) => M.clipList(m).find((c) => c.type === type).id);
  let r = O.effects(m, { ids: [v], action: "add", type: "look", params: { look: 2 } });
  const fx = r.result.effectIds[0];
  m = r.model;
  m = O.effects(m, { ids: [v], action: "update", effect: "look", params: { amount: 0.5 }, on: false }).model;
  assert.deepEqual([m.clips[v].effects[0].p.amount, m.clips[v].effects[0].on], [0.5, false]);
  m = O.keyframes(m, { id: v, prop: `fx:${fx}:amount`, keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }).model;
  assert.ok(isTrack(m.clips[v].effects[0].p.amount));
  assert.throws(() => O.effects(m, { ids: [v], action: "add", type: "eq" }), /audio effect/);
  assert.throws(() => O.effects(m, { ids: [a], action: "add", type: "blur" }), /picture effect/);
  assert.throws(() => O.effects(m, { ids: [v], action: "add", type: "sparkle" }), /not an effect/);
  m = O.effects(m, { ids: [v], action: "remove", effect: fx }).model;
  assert.equal(m.clips[v].effects.length, 0);
});

test("audio: dB, pan, fades, EQ, normalize, video clips address their sound", () => {
  let m = place(scene(), { media: "vid", start: 0 });
  const [v, a] = ["video", "audio"].map((type) => M.clipList(m).find((c) => c.type === type).id);
  m = O.audio(m, { ids: [v], volumeDb: -6, pan: -2, fadeIn: 1, eq: { low: 3 } }).model;
  near(m.clips[a].volume, 0.501, 0.001);
  assert.equal(m.clips[a].pan, -1);
  assert.equal(m.clips[a].fadeIn, 1);
  assert.equal(m.clips[a].effects[0].p.low, 3);
  m = O.audio(m, { ids: [a], eq: { high: -2 } }).model;
  assert.equal(m.clips[a].effects.length, 1, "the EQ is updated, not added twice");
  assert.throws(() => O.audio(m, { ids: [a], normalize: -14 }), /scene_analyze_audio/);
  m = M.setAnalysis(m, "vid", { loudness: { integrated: -20 } });
  near(O.audio(m, { ids: [a], normalize: -14 }).model.clips[a].volume, 1.995, 0.01);
  const t = O.addLayer(m, { type: "text", text: "x" });
  assert.throws(() => O.audio(t.model, { ids: [t.result.id], volume: 1 }), /has no sound/);
});

test("markers, range, tracks and format", () => {
  let m = scene();
  let r = O.markers(m, { action: "add", t: 2, name: "Intro" });
  m = r.model;
  assert.equal(m.markers[0].name, "Intro");
  m = O.markers(m, { action: "range", in: 1, out: 3 }).model;
  assert.deepEqual(m.range, { in: 1, out: 3 });
  m = O.markers(m, { action: "range" }).model;
  assert.equal(m.range, null);
  m = O.markers(m, { action: "remove", id: r.result.id }).model;
  assert.equal(m.markers.length, 0);
  r = O.tracks(m, { action: "add", kind: "audio", name: "Music" });
  m = r.model;
  m = O.tracks(m, { action: "update", track: "Music", muted: true }).model;
  assert.ok(M.trackOf(m, r.result.id).muted);
  m = O.tracks(m, { action: "remove", track: r.result.id }).model;
  assert.equal(M.audioTracks(m).length, 2);
  m = place(m, { media: "img", start: 0 });
  const id = M.clipList(m)[0].id;
  const f = O.sequenceFormat(m, { preset: "720p", fps: 25, background: "#112233", title: "New" });
  assert.equal(f.result.format, "1280×720 @ 25 fps");
  near(f.model.clips[id].x, 640);
  assert.throws(() => O.sequenceFormat(m, { preset: "imax" }), /Presets/);
});

test("cutTimeline: cut, keep and lift", () => {
  const m = place(scene(), { media: "vid", start: 0 });
  assert.equal(O.cutTimeline(m, { ranges: [[2, 4], ["0:10", "0:12"]] }).result.after, 16);
  assert.equal(O.cutTimeline(m, { ranges: [[2, 4]], mode: "keep" }).result.after, 2);
  const lifted = O.cutTimeline(m, { ranges: [[2, 4]], mode: "lift" }).model;
  assert.equal(M.duration(lifted), 20, "lift leaves a gap");
  assert.equal(M.clipList(lifted).filter((c) => c.start < 4 && M.clipEnd(c) > 2).length, 0);
  assert.throws(() => O.cutTimeline(m, { ranges: [] }), /Pass ranges/);
});

test("captions: create, import, edit, style, delete and export", () => {
  let m = scene();
  m = O.captions(m, { action: "create", cues: [{ start: 0, end: 2, text: "One" }, { start: 2, end: 4, text: "Two" }], style: "bold" }).model;
  let caps = M.clipList(m).filter((c) => c.caption);
  assert.equal(caps.length, 2);
  assert.equal(caps[0].text.color, "#ffe600");
  m = O.captions(m, { action: "edit", id: caps[0].id, text: "Uno", end: 1.5 }).model;
  assert.equal(m.clips[caps[0].id].text.text, "Uno");
  m = O.captions(m, { action: "style", style: "minimal", overrides: { size: 40 }, y: 0.5 }).model;
  caps = M.clipList(m).filter((c) => c.caption);
  assert.ok(caps.every((c) => c.text.size === 40 && c.y === 540));
  const srt = O.captionsText(m, "srt");
  assert.match(srt.text, /00:00:00,000 --> 00:00:01,500\nUno/);
  assert.match(O.captionsText(m, "vtt").text, /^WEBVTT/);
  m = O.captions(m, { action: "import", subtitles: "1\n00:00:05,000 --> 00:00:06,000\nImported\n", replace: true }).model;
  assert.deepEqual(M.clipList(m).filter((c) => c.caption).map((c) => c.text.text), ["Imported"]);
  m = O.captions(m, { action: "delete" }).model;
  assert.equal(M.clipList(m).filter((c) => c.caption).length, 0);
  assert.throws(() => O.captions(m, { action: "style", style: "classic" }), /no captions/);
  assert.throws(() => O.captions(m, { action: "create", style: "fancy", cues: [{ start: 0, end: 1, text: "x" }] }), /Unknown caption style/);
});
