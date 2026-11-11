// Scene Studio: footage analysis (pure signal and transcript functions) and the assistant's tools run headless
// against a real document (no workspace, no browser): editing, animation, cutting by transcript, captions.
import test from "node:test";
import assert from "node:assert/strict";
import * as A from "../../app/src/scene/analysis.js";
import * as M from "../../app/src/scene/model.js";
import { Doc } from "../../app/src/core/doc.js";
import { OfficeProject } from "../../app/src/core/office.js";
import { sceneTools, MOTIONS } from "../../app/src/vibe/tools/scene.js";
import { sceneUnderstandTools } from "../../app/src/vibe/tools/scene-understand.js";
import { SCENE_SKILLS } from "../../app/src/ai/skills-scene.js";
import { parseSkill } from "../../app/src/ai/skills.js";
import { createOpenFiniTools, TOOL_GROUPS } from "../../app/src/vibe/tools/index.js";

const RATE = 8000;
// tone bursts: sound in [0, 1), silence in [1, 2), sound in [2, 3)
function bursts() {
  const s = new Float32Array(RATE * 3);
  for (let i = 0; i < s.length; i++) if (i < RATE || i >= RATE * 2) s[i] = Math.sin(i / 3) * 0.5;
  return s;
}

test("analysis: silence, loudness and beats", () => {
  const sil = A.detectSilence(bursts(), RATE, { minDur: 0.5, pad: 0.05 });
  assert.equal(sil.length, 1);
  assert.ok(Math.abs(sil[0][0] - 1.05) < 0.05 && Math.abs(sil[0][1] - 1.95) < 0.05, JSON.stringify(sil));
  assert.deepEqual(A.invertRanges([[1, 2]], 3), [[0, 1], [2, 3]]);
  const l = A.loudness(bursts(), RATE);
  assert.ok(l.peakDb > -7 && l.peakDb <= -5.9);
  assert.equal(l.perSecond.length, 3);
  assert.ok(l.perSecond[1] < -60 && l.perSecond[0] > -12);
  // clicks every 0.5 s = 120 BPM
  const s = new Float32Array(RATE * 8);
  for (let b = 0; b < 16; b++) for (let i = 0; i < 200; i++) s[Math.round(b * 0.5 * RATE) + i] = Math.sin(i) * (1 - i / 200);
  const beats = A.detectBeats(s, RATE);
  assert.ok(Math.abs(beats.bpm - 120) < 2, `bpm ${beats.bpm}`);
  assert.ok(beats.times.length >= 15);
  assert.ok(beats.times.every((t) => Math.abs(((t + 0.02) % 0.5) - 0.02) < 0.03), "beats sit on the clicks");
  assert.deepEqual(A.detectBeats(new Float32Array(RATE * 5), RATE), { bpm: 0, times: [] });
});

test("analysis: shot cuts ignore slow changes", () => {
  const frame = (r, g, b) => {
    const d = new Uint8ClampedArray(64 * 4);
    for (let i = 0; i < d.length; i += 4) d.set([r, g, b, 255], i);
    return A.frameSignature(d);
  };
  // red … red, then blue … blue: one cut; a slow drift inside one color bin: none
  const sigs = [frame(250, 0, 0), frame(250, 5, 0), frame(245, 0, 5), frame(0, 0, 250), frame(5, 0, 250), frame(0, 5, 245)];
  const times = sigs.map((_, i) => i * 0.5);
  assert.deepEqual(A.shotCuts(sigs, times), [1.5]);
  assert.equal(A.signatureDistance(sigs[0], sigs[3]), 1);
});

test("analysis: transcript, fillers, phrases, search, ducking", () => {
  const tr = A.makeTranscript({ cues: [{ t0: 0, t1: 2, text: "Um, welcome to the show." }, { t0: 4, t1: 6, text: "Today we talk about editing." }], lang: "en" });
  assert.equal(tr.words.length, 10);
  assert.equal(tr.segments.length, 2);
  assert.ok(tr.words[0].t1 <= tr.words[1].t0 + 1e-6);
  assert.deepEqual(A.fillerRanges(tr.words, { lang: "en" }).map((f) => f.text), ["um"]);
  assert.equal(A.fillerRanges([{ t0: 0, t1: 1, w: "like" }], {}).length, 0, "ambiguous words need aggressive");
  assert.equal(A.fillerRanges([{ t0: 0, t1: 1, w: "like" }], { aggressive: true }).length, 1);
  const hit = A.findPhrase(tr.words, "Talk about EDIT");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].text, "talk about editing.");
  let m = M.emptyScene();
  m = M.addMedia(m, { id: "v", kind: "video", duration: 10, w: 100, h: 100 }).model;
  m = M.setAnalysis(m, "v", { transcript: tr, notes: [{ t: 5, text: "A person edits video on a laptop" }] });
  m = M.addMarker(m, 3, "Editing chapter").model;
  const res = A.searchIndex(m, "editing laptop");
  assert.deepEqual(res.map((r) => r.kind).sort(), ["marker", "picture", "speech"]);
  // ducking: down for speech, up in the pause
  const duck = A.duckingTrack([[2, 4], [6, 8]], 0, 10, { ducked: 0.2, ramp: 0.5 });
  const at = (t) => {
    const kf = duck.kf;
    let i = kf.findIndex((k) => k.t > t);
    if (i <= 0) return kf[i < 0 ? kf.length - 1 : 0].v;
    const a = kf[i - 1];
    const b = kf[i];
    return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  };
  assert.equal(at(0), 1);
  assert.equal(at(3), 0.2);
  assert.equal(at(5), 1);
  assert.equal(at(7), 0.2);
  assert.equal(at(9.5), 1);
});

function harness() {
  let m = M.emptyScene({ title: "T" });
  m = M.addMedia(m, { id: "vid", kind: "video", mime: "video/mp4", name: "talk.mp4", duration: 20, w: 1920, h: 1080 }).model;
  m = M.addMedia(m, { id: "pic", kind: "image", mime: "image/png", name: "pic.png", w: 1000, h: 1000 }).model;
  const doc = new Doc({ name: "Scene", studio: "scene", width: m.width, height: m.height, pages: 1 });
  doc.office = new OfficeProject(m, "scene");
  const app = { doc, docs: [doc], prefs: {}, studio: "vibe", on() {}, emit() {} };
  const tools = Object.fromEntries([...sceneTools(app), ...sceneUnderstandTools(app)].map((t) => [t.name, t]));
  return { app, doc, run: (name, args = {}) => tools[name].run(args), model: () => doc.office.model, tools };
}

test("tools: build, arrange, animate, effects, transitions, undo", async () => {
  const h = harness();
  const added = await h.run("scene_add_clip", { type: "media", media: "vid", start: 0 });
  assert.equal(added.ids.length, 2);
  const [v, a] = added.ids;
  const text = await h.run("scene_add_clip", { type: "text", start: 1, dur: 3, text: "Hello", style: { size: 120, anim: { in: "pop" } }, y: 200 });
  assert.equal(h.model().clips[text.ids[0]].text.anim.in, "pop");
  let d = await h.run("scene_describe");
  assert.equal(d.clips.length, 3);
  assert.equal(d.duration, 20);
  // split everything at 5 s, delete the first video piece with ripple
  const sp = await h.run("scene_arrange", { action: "split", at: 5 });
  assert.equal(sp.newIds.length, 2);
  await h.run("scene_arrange", { action: "delete", ids: [v], ripple: true });
  assert.equal(M.trackClips(h.model(), h.model().clips[sp.newIds[0]].track)[0].start, 0);
  await h.run("scene_arrange", { action: "trim", ids: [a], edge: "end", to: 4 });
  assert.equal(h.model().clips[a].dur, 4);
  await assert.rejects(() => h.run("scene_arrange", { action: "trim", ids: ["nope"], edge: "end", to: 1 }), /no clip/);
  // keyframes and motion presets
  const t = text.ids[0];
  await h.run("scene_set_keyframes", { id: t, property: "scale", keyframes: [{ t: 0, v: 0.5, e: "easeOut" }, { t: 1, v: 1 }] });
  assert.equal(h.model().clips[t].sx.kf.length, 2);
  assert.equal(h.model().clips[t].sy.kf[0].e, "easeOut");
  await h.run("scene_set_keyframes", { id: t, property: "scale", value: 1 });
  assert.equal(h.model().clips[t].sx, 1);
  for (const motion of Object.keys(MOTIONS)) await h.run("scene_animate", { ids: [t], motion });
  assert.ok(h.model().clips[t].y.kf.length > 2);
  await assert.rejects(() => h.run("scene_animate", { ids: [a], motion: "fade-in" }), /picture clips/);
  // effects: type checks, defaults, update, remove
  const fx = await h.run("scene_effects", { id: t, action: "add", type: "grade", params: { exposure: 0.5 } });
  assert.equal(fx.effects[0].params.contrast, 1);
  await assert.rejects(() => h.run("scene_effects", { id: t, action: "add", type: "eq" }), /audio effect/);
  await h.run("scene_effects", { id: t, action: "update", effect: fx.effect, on: false });
  assert.equal(h.model().clips[t].effects[0].on, false);
  await h.run("scene_effects", { id: t, action: "remove", effect: fx.effect });
  await h.run("scene_set_transition", { ids: [t], edge: "in", type: "dissolve", dur: 0.4 });
  assert.equal(h.model().clips[t].tin.type, "dissolve");
  await h.run("scene_set_transition", { ids: [t], edge: "in", type: "none" });
  assert.equal(h.model().clips[t].tin, null);
  // tracks, markers, sequence, precompose
  const tk = await h.run("scene_tracks", { action: "add", kind: "video", name: "Titles" });
  assert.equal(tk.tracks[0].name, "Titles");
  await h.run("scene_markers", { action: "add", markers: [{ t: 2, name: "Intro" }] });
  const sq = await h.run("scene_set_sequence", { preset: "vertical", rangeIn: 1, rangeOut: 3 });
  assert.deepEqual([sq.width, sq.height, sq.range.in], [1080, 1920, 1]);
  const pc = await h.run("scene_precompose", { ids: [t], name: "Title" });
  assert.equal(h.model().clips[pc.clip].type, "comp");
  // one undo step per call
  const before = h.model();
  await h.run("scene_cut_ranges", { ranges: [[0, 1]] });
  assert.notEqual(h.model(), before);
  h.doc.undo();
  assert.equal(h.model(), before);
  // options catalog
  const opt = await h.run("scene_list_options");
  assert.ok(opt.effects.length >= 15 && opt.motionPresets.includes("ken-burns"));
});

test("tools: cut by transcript, silence, captions, ducking, slideshow, beat edit, reframe", async () => {
  const h = harness();
  await h.run("scene_add_clip", { type: "media", media: "vid", start: 0 });
  await assert.rejects(() => h.run("scene_get_transcript", { media: "vid" }), /no transcript/);
  await h.run("scene_set_transcript", { media: "vid", language: "en", cues: [{ t0: 0, t1: 3, text: "Um hello and welcome." }, { t0: 5, t1: 8, text: "This part is boring." }, { t0: 10, t1: 14, text: "Here is the good part." }] });
  let tr = await h.run("scene_get_transcript", { media: "vid" });
  assert.equal(tr.segments.length, 3);
  assert.deepEqual(tr.segments[1].timeline, [[5, 8]]);
  // preview changes nothing
  const pre = await h.run("scene_cut_transcript", { media: "vid", mode: "segments", segments: [1], preview: true });
  assert.equal(pre.preview, true);
  assert.equal(M.duration(h.model()), 20);
  await h.run("scene_cut_transcript", { media: "vid", mode: "segments", segments: [1] });
  assert.ok(Math.abs(M.duration(h.model()) - 17.07) < 0.1, String(M.duration(h.model())));
  tr = await h.run("scene_get_transcript", { media: "vid" });
  assert.ok(tr.segments[1].timeline.reduce((n, [a, b]) => n + (b - a), 0) < 0.1, "the cut segment is gone from the timeline (but for the padding)");
  assert.ok(tr.segments[2].timeline[0][0] < 8, "later speech moved earlier");
  const fill = await h.run("scene_cut_transcript", { media: "vid", mode: "fillers" });
  assert.equal(fill.matches, 1);
  const found = await h.run("scene_search", { query: "good part" });
  assert.equal(found.exactPhrases.length, 1);
  assert.ok(found.hits.some((x) => x.kind === "speech"));
  // silence: stored analysis → cuts
  h.doc.office.set(M.setAnalysis(h.model(), "vid", { silence: [[15, 18]] }));
  const d0 = M.duration(h.model());
  const rs = await h.run("scene_remove_silence", { media: "vid", keep: 0.2 });
  assert.equal(rs.cuts, 1);
  assert.ok(Math.abs(d0 - M.duration(h.model()) - 2.8) < 0.1);
  // captions follow the current cut
  const cap = await h.run("scene_captions", { action: "create", media: "vid", maxChars: 20, style: "bold" });
  assert.ok(cap.captions >= 2);
  const srt = await h.run("scene_captions", { action: "export" });
  assert.match(srt.text, /-->/);
  assert.ok(!/boring/.test(srt.text), "cut words do not appear in captions");
  await h.run("scene_captions", { action: "style", textStyle: { size: 70 } });
  assert.ok(Object.values(h.model().clips).filter((c) => c.caption).every((c) => c.text.size === 70));
  // ducking from the transcript
  h.doc.office.set(M.addMedia(h.model(), { id: "mus", kind: "audio", duration: 30, name: "music.mp3" }).model);
  const mus = await h.run("scene_add_clip", { type: "media", media: "mus", start: 0, dur: 10 });
  await h.run("scene_duck_music", { music: mus.ids, voice: "vid" });
  assert.ok(h.model().clips[mus.ids[0]].volume.kf.length >= 4);
  // slideshow and beat edit
  const show = await h.run("scene_slideshow", { media: ["pic", "pic", "pic"], seconds: 2, start: 30 });
  assert.equal(show.ids.length, 3);
  assert.equal(h.model().clips[show.ids[1]].tin.type, "dissolve");
  assert.ok(h.model().clips[show.ids[0]].sx.kf[1].v > h.model().clips[show.ids[0]].sx.kf[0].v);
  assert.ok(h.model().clips[show.ids[1]].sx.kf[1].v < h.model().clips[show.ids[1]].sx.kf[0].v, "the move alternates");
  await assert.rejects(() => h.run("scene_beat_edit", { music: "mus", media: ["pic"] }), /no beats/);
  h.doc.office.set(M.setAnalysis(h.model(), "mus", { beats: { bpm: 120, times: Array.from({ length: 40 }, (_, i) => i * 0.5) } }));
  const be = await h.run("scene_beat_edit", { music: "mus", media: ["pic", "pic"], beats: 2, start: 40 });
  assert.deepEqual(be.ids.map((id) => [h.model().clips[id].start, h.model().clips[id].dur]), [[40, 1], [41, 1]]);
  const rf = await h.run("scene_reframe", { preset: "square" });
  assert.equal(rf.width, 1080);
  const vclip = Object.values(h.model().clips).find((c) => c.type === "video");
  assert.equal(vclip.sx, 1, "1080p footage fills a 1080 square at scale 1");
});

test("tools are registered, grouped and named by the skills and the guide", () => {
  const all = createOpenFiniTools({ prefs: {}, docs: [], on() {}, emit() {} }, {});
  const names = new Set(all.map((t) => t.name));
  for (const g of ["Scene editing", "Scene understanding"]) for (const n of TOOL_GROUPS[g]) assert.ok(names.has(n), n);
  assert.equal(TOOL_GROUPS["Scene editing"].length + TOOL_GROUPS["Scene understanding"].length, all.filter((t) => t.name.startsWith("scene_")).length);
  for (const md of SCENE_SKILLS) {
    const s = parseSkill(md);
    assert.ok(s.name.startsWith("scene-"));
    for (const t of s.allowedTools) assert.ok(names.has(t), `${s.name} allows unknown tool ${t}`);
    for (const m of s.body.matchAll(/\bscene_[a-z_]+\b/g)) assert.ok(names.has(m[0]), `${s.name} mentions ${m[0]}`);
  }
});
