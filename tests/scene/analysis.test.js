// Scene Studio footage analysis: silence, loudness, onsets, tempo and beats, shot detection, transcripts, the index.
import test from "node:test";
import assert from "node:assert/strict";
import * as A from "../../app/src/scene/analysis.js";
import { runJob } from "../../app/src/core/workers/jobs.js";

const RATE = 16000;
const tone = (sec, amp, freq = 440, rate = RATE) => Float32Array.from({ length: Math.round(sec * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));
const cat = (...parts) => {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} ≈ ${b} (±${eps})`);

test("silence: finds the quiet parts with an automatic threshold and keeps padding toward sound", () => {
  const s = cat(tone(1, 0.3), new Float32Array(RATE * 1.5), tone(1, 0.3), new Float32Array(RATE * 0.2), tone(0.5, 0.3));
  const r = A.detectSilence(A.levelsDb(s, RATE), { minDur: 0.5, pad: 0.1, duration: s.length / RATE });
  assert.equal(r.ranges.length, 1, "the 0.2 s pause is too short");
  near(r.ranges[0][0], 1.1, 0.05, "start + pad");
  near(r.ranges[0][1], 2.4, 0.05, "end - pad");
  assert.ok(r.threshold <= -20 && r.threshold >= -60);
  // a fixed threshold above the tone level makes everything silent; trailing silence is not padded at the end
  const all = A.detectSilence(A.levelsDb(s, RATE), { thresholdDb: 0, minDur: 0.5, pad: 0.1, duration: s.length / RATE });
  assert.deepEqual(all.ranges, [[0, Math.round((s.length / RATE) * 1000) / 1000]]);
});

test("loudness: a stereo sine at -6 dBFS reads about -6 LUFS, and silence is gated", () => {
  const s = tone(3, 0.5, 997, 48000);
  const l = A.loudness([s, s], 48000);
  near(l.integrated, -6.0, 0.3, "integrated");
  near(l.peak, -6.0, 0.1, "peak");
  // the same at a lower sample rate (the K filter is computed for any rate)
  const low = tone(3, 0.5, 997, 16000);
  near(A.loudness([low, low], 16000).integrated, -6.0, 0.4, "16 kHz");
  assert.equal(A.loudness([new Float32Array(48000)], 48000).integrated, -70);
});

test("fft: a pure tone peaks in its bin", () => {
  const n = 256;
  const re = Float32Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 8 * i) / n));
  const im = new Float32Array(n);
  A.fft(re, im);
  const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]));
  assert.equal(mags.indexOf(Math.max(...mags.slice(0, n / 2))), 8);
  near(mags[8], n / 2, 1e-3);
});

// a click track: short noise bursts every `period` seconds
function clicks(sec, period, rate = 22050) {
  const s = new Float32Array(Math.round(sec * rate));
  let seed = 1;
  for (let t = 0.25; t < sec; t += period) {
    const o = Math.round(t * rate);
    for (let i = 0; i < 400 && o + i < s.length; i++) {
      seed = (seed * 16807) % 2147483647;
      s[o + i] = ((seed / 2147483647) * 2 - 1) * Math.exp(-i / 80);
    }
  }
  return s;
}

test("onsets, tempo and beats of a 120 BPM click track", () => {
  const s = clicks(12, 0.5);
  const env = A.onsetEnvelope(s, 22050);
  const on = A.pickOnsets(env);
  assert.ok(on.length >= 20 && on.length <= 25, `onsets ${on.length}`);
  near(on[0], 0.25, 0.05, "first onset");
  const tempo = A.estimateTempo(env);
  near(tempo.bpm, 120, 3, "bpm");
  const beats = A.trackBeats(env, tempo.period);
  assert.ok(beats.length >= 20, `beats ${beats.length}`);
  const gaps = beats.slice(1).map((b, i) => b - beats[i]);
  for (const g of gaps) near(g, 0.5, 0.06, "beat spacing");
  // every beat lands on a click
  for (const b of beats) near(Math.abs((b - 0.25) / 0.5 - Math.round((b - 0.25) / 0.5)) * 0.5, 0, 0.06, `phase of ${b}`);
});

test("analyzeAudio bundles silence, loudness and beats (also through the worker job)", async () => {
  const s = cat(clicks(6, 0.5, RATE), new Float32Array(RATE * 2));
  const r = A.analyzeAudio([s], RATE);
  assert.equal(r.duration, 8);
  assert.ok(r.silence.some(([a, b]) => a >= 5.75 && a < 6.1 && b === 8), JSON.stringify(r.silence));
  assert.ok(Number.isFinite(r.loudness.integrated) && Number.isFinite(r.loudness.threshold));
  near(r.beats.bpm, 120, 4);
  const viaJob = await runJob("scene.audio", { channels: [s], rate: RATE, opts: { beats: false } });
  assert.deepEqual(viaJob.r.silence, r.silence);
  assert.equal(viaJob.r.beats, undefined);
});

// solid-color frames with a little noise
function frame(rgb, seed = 0, w = 16, h = 9) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const n = ((i * 31 + seed * 17) % 7) - 3;
    d[i * 4] = rgb[0] + n;
    d[i * 4 + 1] = rgb[1] + n;
    d[i * 4 + 2] = rgb[2] + n;
    d[i * 4 + 3] = 255;
  }
  return d;
}

test("shots: hard cuts between different pictures are found, noise and slow changes are not", async () => {
  const frames = [];
  const colors = [[200, 40, 40], [30, 160, 60], [40, 60, 210]];
  for (let i = 0; i < 36; i++) {
    const shot = i < 12 ? 0 : i < 24 ? 1 : 2;
    const c = colors[shot].map((v) => v + (i % 12)); // slow drift inside a shot
    frames.push({ t: i * 0.25, data: frame(c, i) });
  }
  const shots = A.analyzeFrames(frames, { duration: 9 });
  assert.equal(shots.length, 3, JSON.stringify(shots));
  near(shots[1].t0, 3, 0.01);
  near(shots[2].t0, 6, 0.01);
  assert.equal(shots[2].t1, 9);
  assert.ok(A.frameDistance(frames[0].data, frames[1].data) < 0.1);
  assert.ok(A.frameDistance(frames[11].data, frames[12].data) > 0.3);
  // minShot merges cuts that are too close
  const dists = [{ t: 1, d: 0.9 }, { t: 1.2, d: 0.95 }, { t: 3, d: 0.01 }];
  assert.deepEqual(A.detectShots(dists, { threshold: 0.5, minShot: 0.6, duration: 4 }).map((s) => s.t0), [0, 1.2]);
  const job = await runJob("scene.shots", { frames, opts: { duration: 9 } });
  assert.deepEqual(job.r, shots);
});

test("transcripts: normalize, estimate word times, segments, phrases and fillers", () => {
  const words = [["So", 0, 0.3], ["um", 0.35, 0.6], ["the", 0.7, 0.8], ["Café", 0.85, 1.2], ["opens", 1.25, 1.6], ["today.", 1.65, 2], ["Äh", 3, 3.2], ["you", 3.3, 3.4], ["know", 3.45, 3.7]].map(([w, t0, t1]) => ({ w, t0, t1 }));
  const tr = A.normalizeTranscript({ engine: "x", words }, 10);
  assert.equal(tr.words.length, 9);
  assert.equal(tr.estimated, false);
  assert.equal(tr.segments.length, 2, "split after the sentence end");
  assert.equal(tr.segments[0].text, "So um the Café opens today.");
  assert.deepEqual(A.findPhrase(tr.words, "cafe opens").map((h) => [h.i0, h.i1]), [[3, 4]], "accents and case ignored");
  const f = A.fillerRanges(tr.words, { lang: "en" });
  assert.deepEqual(f.map((x) => x.w), ["um", "Äh"], "accents are folded: Äh matches ah");
  assert.ok(f[0].t0 >= 0.3 && f[0].t1 <= 0.7, "padding never reaches the neighbors");
  assert.deepEqual(A.fillerRanges(tr.words, { soft: true }).map((x) => x.w), ["So", "um", "Äh", "you know"]);
  // segments only: words are estimated and spread by length
  const est = A.normalizeTranscript({ segments: [{ t0: 1, t1: 3, text: "hello wide world" }] }, 10);
  assert.equal(est.estimated, true);
  assert.equal(est.words.length, 3);
  assert.equal(est.words[0].t0, 1);
  assert.ok(est.words[2].t1 <= 3);
  assert.deepEqual(A.normalizeTranscript({ words: [{ start: 12, end: 13, word: "x" }] }, 10).words[0], { t0: 10, t1: 10, w: "x" }, "clamped to the duration");
});

test("planChunks cuts at pauses and never exceeds the maximum", () => {
  const ch = A.planChunks([[5, 6], [20, 21], [40, 40.5]], 70, { max: 28 });
  for (const [a, b] of ch) assert.ok(b - a <= 28 + 1e-9, `${a}-${b}`);
  assert.deepEqual(ch[0], [0, 20]);
  assert.ok(ch.every(([a, b], i) => i === 0 || a >= ch[i - 1][1]), "ordered, no overlap");
  assert.equal(ch[ch.length - 1][1], 70);
});

test("index: transcript, notes, markers and captions are searchable with ranking", () => {
  const model = {
    media: { v: { id: "v" } },
    analysis: { v: { transcript: { segments: [{ t0: 0, t1: 3, text: "We open the new bakery downtown" }, { t0: 3, t1: 6, text: "The weather was rainy" }] }, notes: [{ t0: 10, t1: 12, text: "Close-up of a croissant on a plate" }], shots: [{ t0: 0, t1: 5 }] } },
    markers: [{ t: 4, name: "Bakery sign" }],
    clips: { c1: { caption: true, start: 7, dur: 2, text: { text: "Rain again" } } },
  };
  const idx = A.buildIndex(model);
  assert.equal(idx.length, 6);
  const hits = A.searchIndex(idx, "where is the bakery");
  assert.deepEqual(hits.map((h) => h.kind), ["speech", "marker"]);
  assert.equal(A.searchIndex(idx, "croissants")[0].kind, "visual", "prefix match");
  assert.equal(A.searchIndex(idx, "rain", { kinds: ["caption"] })[0].text, "Rain again");
  assert.equal(A.searchIndex(idx, "new bakery")[0].score > A.searchIndex(idx, "bakery new")[0].score, true, "phrase bonus");
  assert.deepEqual(A.tokenize("Wo ist die Bäckerei?"), ["backerei"]);
});
