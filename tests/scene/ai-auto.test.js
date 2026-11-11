// Scene Studio assistant tools, transcript- and analysis-driven editing (scene/ai-auto.js).
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/src/scene/model.js";
import * as U from "../../app/src/scene/ai-auto.js";

// a 20 s talking-head video placed at 0, its words every 0.5 s
const SPOKEN = "hello and um welcome to the bakery today we bake bread uh and croissants then we taste them all together with friends";
function scene({ estimated = false } = {}) {
  let m = M.emptyScene({ title: "Talk" });
  m = M.addMedia(m, { id: "vid", kind: "video", mime: "video/mp4", name: "talk.mp4", duration: 20, w: 1920, h: 1080, hasAudio: true }).model;
  m = M.placeMedia(m, "vid", { start: 0 }).model;
  const words = SPOKEN.split(" ").map((w, i) => ({ w, t0: i * 0.5, t1: i * 0.5 + 0.4 }));
  return U.setTranscript(m, "vid", { engine: "test", lang: "en", words, estimated }).model;
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("transcript on the timeline: views, words follow cuts and moves", () => {
  let m = scene();
  const v = U.transcriptView(m, { words: true, from: 1, to: 2 });
  assert.equal(v.media, "vid");
  assert.deepEqual(v.rows.map((r) => r.split("] ")[1]), ["um", "welcome"]);
  const segs = U.transcriptView(m);
  assert.equal(segs.unit, "segment");
  assert.match(segs.rows[0], /^#0 \[0–/);
  m = M.cutRanges(m, [[0, 2]]); // "hello and um welcome" gone
  const words = U.timelineWords(m, "vid");
  assert.equal(words[0].w, "to");
  near(words[0].t0, 0);
  assert.throws(() => U.transcriptMedia(M.emptyScene()), /scene_transcribe/);
});

test("cutByTranscript: phrases, segment and word numbers, keep mode, padding", () => {
  const m = scene();
  let r = U.cutByTranscript(m, { phrases: ["we bake bread"] });
  assert.equal(r.model.clips[Object.keys(r.model.clips)[0]] !== undefined, true);
  near(r.result.removed, 1.5 - 0.1 + 0.1, 0.11); // 3 words, padded into the pauses
  const after = U.timelineWords(r.model, "vid").map((w) => w.w);
  assert.ok(!after.includes("bake") && after.includes("croissants"));
  assert.equal(after.length, SPOKEN.split(" ").length - 3);
  r = U.cutByTranscript(m, { words: [[0, 3]], mode: "keep", pad: 0 });
  near(M.duration(r.model), 1.9, 0.04);
  assert.deepEqual(U.timelineWords(r.model, "vid").map((w) => w.w), ["hello", "and", "um", "welcome"]);
  assert.throws(() => U.cutByTranscript(m, { phrases: ["pizza"] }), /None of the phrases/);
  assert.throws(() => U.cutByTranscript(m, { words: [[999, 1000]] }), /outside the transcript/);
  const partial = U.cutByTranscript(m, { phrases: ["bread", "pizza"] });
  assert.deepEqual(partial.result.notFound, ["pizza"]);
});

test("removeFillers: dry run lists, then cuts picture and sound", () => {
  const m = scene();
  const dry = U.removeFillers(m, { dryRun: true });
  assert.equal(dry.result.found, 2);
  assert.equal(dry.model, m);
  const r = U.removeFillers(m, {});
  assert.ok(r.result.removed > 0.4);
  const ws = U.timelineWords(r.model, "vid").map((w) => w.w);
  assert.ok(!ws.includes("um") && !ws.includes("uh"));
  for (const t of M.videoTracks(r.model).concat(M.audioTracks(r.model))) {
    const clips = M.trackClips(r.model, t.id);
    for (let i = 1; i < clips.length; i++) near(clips[i].start, M.clipEnd(clips[i - 1]), 1e-6); // no gaps
  }
});

test("timelineSilence and removeSilences: only where every analysed sound is quiet", () => {
  let m = scene();
  m = M.setAnalysis(m, "vid", { silence: [[3, 6], [10, 10.3], [15, 20]] });
  const ranges = U.timelineSilence(m, { minDur: 0.6, pad: 0.1 });
  assert.deepEqual(ranges, [[3.1, 5.9], [15.1, 20]]);
  // music without analysis keeps everything (unless ignored)
  m = M.addMedia(m, { id: "music", kind: "audio", mime: "audio/mpeg", name: "m.mp3", duration: 30 }).model;
  m = M.addClip(m, { type: "audio", media: "music", start: 0, dur: 5 }).model;
  assert.deepEqual(U.timelineSilence(m, { minDur: 0.6, pad: 0.1 }), [[5.1, 5.9], [15.1, 20]], "the music covers 0-5 s");
  assert.equal(U.timelineSilence(m, { minDur: 0.6, pad: 0.1, ignoreUnanalysed: true }).length, 2);
  assert.equal(U.timelineSilence(m, { minDur: 0.6, pad: 0.1, media: "vid" }).length, 2);
  const dry = U.removeSilences(m, { dryRun: true, ignoreUnanalysed: true });
  assert.equal(dry.result.applied, false);
  const r = U.removeSilences(m, { ignoreUnanalysed: true, pad: 0.1 });
  near(r.result.removed, 2.8 + 4.9, 0.05);
  assert.throws(() => U.timelineSilence(scene()), /scene_analyze_audio/);
});

test("autoCaptions: cues from the words that play, vertical defaults, uppercase", () => {
  let m = scene();
  m = M.cutRanges(m, [[0, 1]]);
  const r = U.autoCaptions(m, { style: "bold", uppercase: true });
  const caps = M.clipList(r.model).filter((c) => c.caption);
  assert.equal(caps.length, r.result.captions);
  assert.ok(caps.length >= 2);
  assert.match(caps[0].text.text, /^UM WELCOME/);
  assert.equal(caps[0].text.color, "#ffe600");
  for (let i = 1; i < caps.length; i++) assert.ok(caps[i].start >= M.clipEnd(caps[i - 1]) - 1e-6, "no overlap");
  assert.throws(() => U.autoCaptions(m, { style: "neon" }), /Unknown caption style/);
});

test("notes and search: where does X happen, mapped to the timeline", () => {
  let m = scene();
  m = U.addNotes(m, { media: "vid", notes: [{ t0: 8, t1: 10, text: "Close-up of fresh croissants on a tray" }] }).model;
  m = U.addNotes(m, { timeline: true, notes: [{ t0: 2, text: "Baker waves at the camera" }] }).model;
  assert.equal(m.analysis.vid.notes.length, 2);
  m = M.cutRanges(m, [[0, 4]]);
  const s = U.sceneSearch(m, "croissant");
  assert.ok(s.hits.length >= 2);
  const visual = s.hits.find((h) => h.kind === "visual");
  assert.deepEqual(visual.source, [8, 10]);
  assert.deepEqual(visual.timeline, [[4, 6]]);
  const gone = U.sceneSearch(m, "waves");
  assert.deepEqual(gone.hits[0].timeline, [], "cut out of the edit");
  assert.match(U.sceneSearch(M.emptyScene(), "x").note, /Nothing is indexed/);
  assert.throws(() => U.addNotes(m, { notes: [{ t0: 1, text: "x" }] }), /Pass media/);
});

test("setTranscript from estimated segments flags the estimate in the view", () => {
  const m = U.setTranscript(scene(), "vid", { segments: [{ t0: 0, t1: 4, text: "first part here" }] }).model;
  assert.equal(m.analysis.vid.transcript.estimated, true);
  assert.match(U.transcriptView(m).note, /estimated/);
  assert.throws(() => U.setTranscript(m, "vid", {}), /empty/);
});
