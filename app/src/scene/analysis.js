// Scene Studio footage analysis (docs/scene-studio.md ▸ Understanding footage). Pure: no DOM, no app state; runs in
// the worker pool (core/workers/jobs.js "scene.audio", "scene.shots") or in the calling thread, and is unit-tested in
// tests/scene/analysis.test.js. The browser side (decoding, seeking frames, speech engines) is scene/ai-runtime.js.
//
// Results are stored per media item in `model.analysis[<mediaId>]`, in SOURCE seconds of that item:
//   transcript { engine, lang, estimated, words: [{ t0, t1, w }], segments: [{ t0, t1, text }] }
//   shots      [{ t0, t1, score }]                 scene cuts found by the frame-difference detector
//   silence    [[t0, t1]]                          ranges quieter than the threshold (see detectSilence)
//   loudness   { integrated, peak, threshold }     LUFS (ITU-R BS.1770 gating), dBFS, the silence threshold used
//   beats      { bpm, times: [t], onsets: [t] }    tempo, beat grid (dynamic programming), onsets
//   notes      [{ t0, t1, text }]                  frame or shot descriptions the assistant wrote (scene_index_note)
//
//   audio:  mixMono, resample, levelsDb, detectSilence, loudness, fft, onsetEnvelope, pickOnsets, estimateTempo,
//           trackBeats, analyzeAudio
//   video:  histogram, frameDistance, detectShots, analyzeFrames
//   speech: normalizeTranscript, wordsFromText, planChunks, findPhrase, fillerRanges, FILLERS
//   index:  buildIndex, searchIndex, tokenize
// Invariants: every function is deterministic and returns plain data; times are seconds, sorted ascending.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r3 = (v) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------------------------- audio

/** Average of the channels (Float32Array[]) as one Float32Array. */
export function mixMono(channels) {
  const list = channels.filter(Boolean);
  if (!list.length) return new Float32Array(0);
  if (list.length === 1) return list[0];
  const n = Math.min(...list.map((c) => c.length));
  const out = new Float32Array(n);
  for (const c of list) for (let i = 0; i < n; i++) out[i] += c[i];
  for (let i = 0; i < n; i++) out[i] /= list.length;
  return out;
}

/** Linear resampling (with box averaging when it shrinks by more than two). */
export function resample(samples, inRate, outRate) {
  if (inRate === outRate || !samples.length) return samples;
  const ratio = inRate / outRate;
  const n = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(n);
  if (ratio >= 2) {
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(samples.length, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += samples[j];
      out[i] = b > a ? s / (b - a) : 0;
    }
    return out;
  }
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    out[i] = samples[i0] + (samples[i1] - samples[i0]) * (x - i0);
  }
  return out;
}

/** RMS level in dBFS per hop (default 20 ms hops, 40 ms windows); -100 for digital silence. */
export function levelsDb(samples, rate, { hop = 0.02, win = 0.04 } = {}) {
  const h = Math.max(1, Math.round(hop * rate));
  const w = Math.max(h, Math.round(win * rate));
  const n = Math.max(0, Math.ceil(samples.length / h));
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i * h + Math.floor(h / 2) - Math.floor(w / 2));
    const b = Math.min(samples.length, a + w);
    let s = 0;
    for (let j = a; j < b; j++) s += samples[j] * samples[j];
    const ms = b > a ? s / (b - a) : 0;
    db[i] = ms > 1e-10 ? Math.max(-100, 10 * Math.log10(ms)) : -100;
  }
  return { hop: h / rate, db };
}

function percentile(arr, p) {
  if (!arr.length) return -100;
  const s = Float32Array.from(arr).sort();
  return s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)];
}

/** The threshold "auto" picks: 30 % of the way from the noise floor (15th percentile) to the loud parts (85th). */
export function autoThreshold(db) {
  const lo = percentile(db, 0.15);
  const hi = percentile(db, 0.85);
  return clamp(lo + (hi - lo) * 0.3, -60, -20);
}

/**
 * Silent ranges from a level curve: runs below `thresholdDb` ("auto" = autoThreshold) that last at least `minDur`
 * seconds. Each range is shrunk by `pad` seconds on the sides that touch sound, so cuts keep a little air.
 * @returns {{ ranges: [number, number][], threshold: number }}
 */
export function detectSilence({ hop, db }, { thresholdDb = "auto", minDur = 0.5, pad = 0.1, duration = db.length * hop } = {}) {
  const thr = thresholdDb === "auto" || !Number.isFinite(+thresholdDb) ? autoThreshold(db) : +thresholdDb;
  const ranges = [];
  let start = -1;
  const close = (i) => {
    let a = start * hop;
    let b = Math.min(duration, i * hop);
    if (b - a >= minDur) {
      if (a > 0) a += pad;
      if (b < duration - 1e-6) b -= pad;
      if (b > a) ranges.push([r3(a), r3(b)]);
    }
    start = -1;
  };
  for (let i = 0; i < db.length; i++) {
    if (db[i] < thr) {
      if (start < 0) start = i;
    } else if (start >= 0) close(i);
  }
  if (start >= 0) close(db.length);
  return { ranges, threshold: Math.round(thr * 10) / 10 };
}

// biquad coefficients of the BS.1770 K-weighting at any sample rate (pre-filter shelf and RLB high-pass)
function kWeighting(rate) {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * Integrated loudness (LUFS, ITU-R BS.1770-4: K-weighting, 400 ms blocks with 75 % overlap, absolute gate -70 LUFS,
 * relative gate -10 LU) and the sample peak in dBFS. Channels are weighted 1 (mono or stereo).
 */
export function loudness(channels, rate) {
  const list = channels.filter(Boolean);
  const n = list.length ? Math.min(...list.map((c) => c.length)) : 0;
  let peak = 0;
  for (const c of list) for (let i = 0; i < n; i++) {
    const v = c[i] < 0 ? -c[i] : c[i];
    if (v > peak) peak = v;
  }
  const filters = kWeighting(rate);
  const weighted = list.map((c) => filters.reduce((x, f) => biquad(x, f), c.subarray ? c.subarray(0, n) : c));
  const block = Math.round(0.4 * rate);
  const step = Math.round(0.1 * rate);
  const z = [];
  for (let s = 0; s + block <= n; s += step) {
    let sum = 0;
    for (const w of weighted) {
      let e = 0;
      for (let i = s; i < s + block; i++) e += w[i] * w[i];
      sum += e / block;
    }
    z.push(sum);
  }
  const lufs = (ms) => -0.691 + 10 * Math.log10(ms);
  const above = z.filter((v) => v > 0 && lufs(v) > -70);
  let integrated = -70;
  if (above.length) {
    const rel = lufs(above.reduce((a, v) => a + v, 0) / above.length) - 10;
    const gated = above.filter((v) => lufs(v) > rel);
    if (gated.length) integrated = lufs(gated.reduce((a, v) => a + v, 0) / gated.length);
  }
  return { integrated: Math.round(Math.max(-70, integrated) * 10) / 10, peak: Math.round((peak > 1e-5 ? 20 * Math.log10(peak) : -100) * 10) / 10 };
}

/** In-place radix-2 FFT of (re, im); the length must be a power of two. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/**
 * Onset strength per hop: spectral flux of the log-compressed magnitude spectrum (Hann window), half-wave rectified
 * and normalized to a maximum of 1.
 * @returns {{ hop: number, env: Float32Array }} hop in seconds
 */
export function onsetEnvelope(samples, rate, { size = 1024, hop = 512 } = {}) {
  const frames = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
  const env = new Float32Array(frames);
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  let prev = new Float32Array(size / 2);
  let cur = new Float32Array(size / 2);
  let max = 0;
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = samples[o + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < size / 2; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = cur[k] - prev[k];
      if (d > 0 && f > 0) flux += d;
    }
    env[f] = flux;
    if (flux > max) max = flux;
    [prev, cur] = [cur, prev];
  }
  if (max > 0) for (let i = 0; i < frames; i++) env[i] /= max;
  return { hop: hop / rate, env };
}

/** Onset times: local maxima of the envelope above its moving mean plus `delta`, at least `minGap` seconds apart. */
export function pickOnsets({ hop, env }, { win = 0.3, delta = 0.07, minGap = 0.08 } = {}) {
  const w = Math.max(1, Math.round(win / hop));
  const gap = Math.max(1, Math.round(minGap / hop));
  const out = [];
  let last = -Infinity;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] < env[i - 1] || env[i] < env[i + 1]) continue;
    let s = 0;
    let c = 0;
    let isMax = true;
    for (let j = Math.max(0, i - w); j <= Math.min(env.length - 1, i + w); j++) {
      s += env[j];
      c++;
      if (env[j] > env[i] && Math.abs(j - i) <= gap) isMax = false;
    }
    if (isMax && env[i] > s / c + delta && i - last >= gap) {
      out.push(r3(i * hop));
      last = i;
    }
  }
  return out;
}

/**
 * Tempo from the autocorrelation of the onset envelope between `min` and `max` BPM, weighted toward 120 BPM (a
 * log-Gaussian prior) so octave errors stay rare.
 * @returns {{ bpm: number, period: number, confidence: number }} period in hops
 */
export function estimateTempo({ hop, env }, { min = 60, max = 180 } = {}) {
  const n = env.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n || 1;
  const x = Float32Array.from(env, (v) => v - mean);
  const lo = Math.max(1, Math.floor(60 / max / hop));
  const hi = Math.min(n - 1, Math.ceil(60 / min / hop));
  let zero = 0;
  for (let i = 0; i < n; i++) zero += x[i] * x[i];
  let best = 0;
  let bestLag = 0;
  let bestRaw = 0;
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    const bpm = 60 / (lag * hop);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    if (s * prior > best) {
      best = s * prior;
      bestLag = lag;
      bestRaw = s;
    }
  }
  if (!bestLag) return { bpm: 0, period: 0, confidence: 0 };
  // refine the lag with a parabola through the neighbors
  const ac = (lag) => {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    return s;
  };
  const a = ac(bestLag - 1);
  const b = bestRaw;
  const c = ac(bestLag + 1);
  const shift = a - 2 * b + c ? clamp((0.5 * (a - c)) / (a - 2 * b + c), -0.5, 0.5) : 0;
  const period = bestLag + shift;
  return { bpm: Math.round((60 / (period * hop)) * 10) / 10, period, confidence: Math.round(clamp(zero ? bestRaw / zero : 0, 0, 1) * 100) / 100 };
}

/**
 * Beat times by dynamic programming (Ellis 2007): each beat maximizes onset strength plus the best predecessor about
 * one period earlier, penalized by how far the gap is from the period (log-squared, `tightness`).
 */
export function trackBeats({ hop, env }, period, { tightness = 100 } = {}) {
  const n = env.length;
  if (!(period > 1) || n < 2) return [];
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const v = score[p] - tightness * Math.log((t - p) / period) ** 2;
      if (arg < 0 || v > best) {
        best = v;
        arg = p;
      }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // start from the best score in the last period
  let t = n - 1;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > score[t]) t = i;
  const beats = [];
  while (t >= 0) {
    beats.push(r3(t * hop));
    t = back[t];
  }
  return beats.reverse();
}

/**
 * Everything the audio tools store for one media item, from its channels.
 * @returns {{ silence, loudness, beats, duration }}
 */
export function analyzeAudio(channels, rate, { thresholdDb = "auto", minSilence = 0.5, pad = 0.1, beats = true } = {}) {
  const mono = mixMono(channels);
  const duration = mono.length / rate;
  const lv = levelsDb(mono, rate);
  const sil = detectSilence(lv, { thresholdDb, minDur: minSilence, pad, duration });
  const loud = loudness(channels, rate);
  let beatInfo = null;
  if (beats && duration >= 2) {
    const lowRate = Math.min(rate, 22050);
    const low = resample(mono, rate, lowRate);
    const size = 2 ** Math.round(Math.log2(lowRate * 0.046)); // about 46 ms windows, half overlapping
    const env = onsetEnvelope(low, lowRate, { size, hop: size / 2 });
    const tempo = estimateTempo(env);
    beatInfo = { bpm: tempo.bpm, confidence: tempo.confidence, times: tempo.period ? trackBeats(env, tempo.period) : [], onsets: pickOnsets(env).slice(0, 5000) };
  }
  return { duration: r3(duration), silence: sil.ranges, loudness: { ...loud, threshold: sil.threshold }, ...(beatInfo ? { beats: beatInfo } : {}) };
}

// ---------------------------------------------------------------------------------------------- video

/** 64-bin RGB histogram (4 levels per channel) of RGBA pixels, normalized to sum 1, plus the mean luma 0..1. */
export function histogram(rgba) {
  const h = new Float32Array(64);
  let luma = 0;
  const px = rgba.length >> 2;
  for (let i = 0; i < rgba.length; i += 4) {
    h[((rgba[i] >> 6) << 4) | ((rgba[i + 1] >> 6) << 2) | (rgba[i + 2] >> 6)]++;
    luma += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  for (let i = 0; i < 64; i++) h[i] /= px || 1;
  return { h, luma: luma / (px || 1) / 255 };
}

/**
 * Difference of two frames (same size, RGBA) in 0..1: 70 % histogram chi-square distance (robust to motion) and
 * 30 % mean absolute luma difference per pixel (catches cuts between shots with similar colors).
 */
export function frameDistance(a, b) {
  const ha = histogram(a).h;
  const hb = histogram(b).h;
  let chi = 0;
  for (let i = 0; i < 64; i++) {
    const s = ha[i] + hb[i];
    if (s > 0) chi += ((ha[i] - hb[i]) ** 2) / s;
  }
  let pix = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 4) {
    const ya = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
    const yb = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
    pix += Math.abs(ya - yb);
  }
  pix /= (n >> 2 || 1) * 255;
  return 0.7 * clamp(chi / 2, 0, 1) + 0.3 * pix;
}

/**
 * Shot boundaries from frame distances [{ t, d }] (d = difference between the frame at t and the one before): a cut
 * where d exceeds the threshold ("auto": median + 6 × median absolute deviation, at least 0.18), is the largest
 * value within two samples and lies at least `minShot` seconds after the previous cut.
 * @returns {[{ t0, t1, score }]} shots covering [0, duration]
 */
export function detectShots(dists, { threshold = "auto", minShot = 0.6, duration } = {}) {
  const ds = dists.map((x) => x.d);
  const end = duration ?? (dists.length ? dists[dists.length - 1].t : 0);
  let thr = +threshold;
  if (threshold === "auto" || !Number.isFinite(thr)) {
    const med = percentile(ds, 0.5);
    const mad = percentile(ds.map((d) => Math.abs(d - med)), 0.5);
    thr = Math.max(0.18, med + 6 * mad);
  }
  const cuts = [];
  for (let i = 0; i < dists.length; i++) {
    const d = ds[i];
    if (d < thr) continue;
    let isMax = true;
    for (let j = Math.max(0, i - 2); j <= Math.min(ds.length - 1, i + 2); j++) if (ds[j] > d) isMax = false;
    const t = dists[i].t;
    if (!isMax || t < minShot || end - t < minShot / 2) continue;
    if (cuts.length && t - cuts[cuts.length - 1].t < minShot) {
      if (d > cuts[cuts.length - 1].d) cuts[cuts.length - 1] = { t, d };
      continue;
    }
    cuts.push({ t, d });
  }
  const shots = [];
  let t0 = 0;
  let score = 1;
  for (const c of cuts) {
    shots.push({ t0: r3(t0), t1: r3(c.t), score: Math.round(score * 100) / 100 });
    t0 = c.t;
    score = c.d;
  }
  if (end > t0) shots.push({ t0: r3(t0), t1: r3(end), score: Math.round(score * 100) / 100 });
  return shots;
}

/** Shots of sampled frames [{ t, data: RGBA }] (all the same size), the job the worker runs. */
export function analyzeFrames(frames, opts = {}) {
  const dists = [];
  for (let i = 1; i < frames.length; i++) dists.push({ t: frames[i].t, d: frameDistance(frames[i - 1].data, frames[i].data) });
  return detectShots(dists, opts);
}

// ---------------------------------------------------------------------------------------------- speech

/** Words spread over [t0, t1] by their length in characters (for engines that return text without times). */
export function wordsFromText(text, t0, t1) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const total = words.reduce((a, w) => a + w.length + 1, 0);
  const out = [];
  let pos = t0;
  for (const w of words) {
    const d = ((t1 - t0) * (w.length + 1)) / (total || 1);
    out.push({ t0: r3(pos), t1: r3(pos + d * 0.92), w });
    pos += d;
  }
  return out;
}

/** Groups words into segments at pauses longer than `gap` or after sentence punctuation. */
export function segmentsFromWords(words, { gap = 0.8, maxDur = 12 } = {}) {
  const out = [];
  let cur = null;
  for (const w of words) {
    if (cur && (w.t0 - cur.t1 > gap || w.t1 - cur.t0 > maxDur)) {
      out.push(cur);
      cur = null;
    }
    if (!cur) cur = { t0: w.t0, t1: w.t1, text: "" };
    cur.text = cur.text ? `${cur.text} ${w.w}` : w.w;
    cur.t1 = w.t1;
    if (/[.!?…]$/.test(w.w)) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * A valid transcript from engine output or user input: words ({ t0, t1, w } or { start, end, text }) and / or
 * segments ({ t0, t1, text }). Missing words are estimated from segments (flagged `estimated`), missing segments
 * are built from words. Times are clamped to [0, duration].
 */
export function normalizeTranscript(raw, duration = Infinity) {
  const time = (v) => clamp(Number.isFinite(+v) ? +v : 0, 0, duration);
  const words = (Array.isArray(raw?.words) ? raw.words : [])
    .map((w) => ({ t0: time(w.t0 ?? w.start), t1: time(w.t1 ?? w.end), w: String(w.w ?? w.word ?? w.text ?? "").trim() }))
    .filter((w) => w.w && w.t1 >= w.t0)
    .sort((a, b) => a.t0 - b.t0)
    .slice(0, 200000);
  let segments = (Array.isArray(raw?.segments) ? raw.segments : [])
    .map((s) => ({ t0: time(s.t0 ?? s.start), t1: time(s.t1 ?? s.end), text: String(s.text ?? "").trim() }))
    .filter((s) => s.text && s.t1 > s.t0)
    .sort((a, b) => a.t0 - b.t0)
    .slice(0, 50000);
  let estimated = !!raw?.estimated;
  let w = words;
  if (!w.length && segments.length) {
    w = segments.flatMap((s) => wordsFromText(s.text, s.t0, s.t1));
    estimated = true;
  }
  if (!segments.length) segments = segmentsFromWords(w);
  const r = (o) => ({ ...o, t0: r3(o.t0), t1: r3(o.t1) });
  return { engine: String(raw?.engine || "manual").slice(0, 64), lang: String(raw?.lang || "").slice(0, 16), estimated, words: w.map(r), segments: segments.map(r) };
}

/**
 * Chunks of at most `max` seconds for a batch recognizer, cut in the middle of silent ranges where possible (so no
 * word is split), covering only the speech parts of [0, duration].
 * @param {[number, number][]} silence
 */
export function planChunks(silence, duration, { max = 28, min = 0.3 } = {}) {
  const speech = [];
  let pos = 0;
  for (const [a, b] of silence) {
    if (a > pos) speech.push([pos, a]);
    pos = Math.max(pos, b);
  }
  if (duration > pos) speech.push([pos, duration]);
  const out = [];
  let cur = null;
  for (const [a, b] of speech) {
    if (b - a < min) continue;
    if (cur && b - cur[0] <= max) {
      cur[1] = b;
      continue;
    }
    if (cur) out.push(cur);
    // a speech run longer than max is split into equal parts
    const parts = Math.ceil((b - a) / max);
    for (let i = 0; i < parts - 1; i++) out.push([a + ((b - a) * i) / parts, a + ((b - a) * (i + 1)) / parts]);
    cur = [a + ((b - a) * (parts - 1)) / parts, b];
  }
  if (cur) out.push(cur);
  return out.map(([a, b]) => [r3(a), r3(b)]);
}

const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const wordKey = (w) => fold(w).replace(/[^\p{L}\p{N}']+/gu, "");

/**
 * Where a phrase is spoken: every run of consecutive words that matches the phrase (case, accents and punctuation
 * ignored). @returns {[{ i0, i1, t0, t1 }]} word indices (inclusive) and source times
 */
export function findPhrase(words, phrase) {
  const want = String(phrase).split(/\s+/).map(wordKey).filter(Boolean);
  if (!want.length) return [];
  const keys = words.map((w) => wordKey(w.w));
  const out = [];
  for (let i = 0; i + want.length <= keys.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length && ok; j++) if (keys[i + j] !== want[j]) ok = false;
    if (ok) {
      out.push({ i0: i, i1: i + want.length - 1, t0: words[i].t0, t1: words[i + want.length - 1].t1 });
      i += want.length - 1;
    }
  }
  return out;
}

/** Filler words per language (single tokens; "soft" fillers are real words that are often fillers). */
export const FILLERS = {
  en: { hard: ["um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "hmm", "mm", "mhm"], soft: ["like", "basically", "actually", "literally", "so", "well", "you know", "i mean", "kind of", "sort of"] },
  de: { hard: ["äh", "ähm", "äähm", "öhm", "ehm", "hm", "hmm", "mh", "ähh"], soft: ["also", "halt", "quasi", "sozusagen", "irgendwie", "genau", "eigentlich", "ne", "weißt du"] },
  fr: { hard: ["euh", "heu", "hum", "bah", "ben"], soft: ["genre", "en fait", "du coup", "voilà"] },
  es: { hard: ["eh", "em", "este", "mmm"], soft: ["o sea", "pues", "bueno", "como"] },
};

/**
 * Filler words of a transcript as source ranges (each extended to the neighbors' edges by at most `pad` seconds so
 * the cut does not leave a click). `soft` also matches the soft list; `extra` adds words or phrases.
 * @returns {[{ t0, t1, w, i0, i1 }]}
 */
export function fillerRanges(words, { lang = "", soft = false, extra = [], pad = 0.04 } = {}) {
  const langs = lang && FILLERS[lang.slice(0, 2)] ? [FILLERS[lang.slice(0, 2)]] : Object.values(FILLERS);
  const list = new Set([...langs.flatMap((l) => [...l.hard, ...(soft ? l.soft : [])]), ...extra.map((x) => String(x).toLowerCase())]);
  const out = [];
  const taken = new Set(); // word indices already matched (longer phrases first; "äh" and "ah" fold alike)
  for (const p of [...list].sort((x, y) => y.split(" ").length - x.split(" ").length)) {
    for (const hit of findPhrase(words, p)) {
      if (taken.has(hit.i0) || taken.has(hit.i1)) continue;
      for (let i = hit.i0; i <= hit.i1; i++) taken.add(i);
      const before = words[hit.i0 - 1];
      const after = words[hit.i1 + 1];
      out.push({ t0: r3(Math.max(before ? before.t1 : 0, hit.t0 - pad)), t1: r3(Math.min(after ? after.t0 : Infinity, hit.t1 + pad)), w: words.slice(hit.i0, hit.i1 + 1).map((w) => w.w).join(" "), i0: hit.i0, i1: hit.i1 });
    }
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

// ---------------------------------------------------------------------------------------------- index and search

const STOP = new Set("a an the and or of to in on at is are was were be it this that with for from by as do does did where when what who how which there here i you he she we they me my our your their not no yes ein eine einer eines einem einen der die das den dem des und oder zu im in am an ist sind war waren es mit für von bei als wo wann was wer wie welche hier da ich du er sie wir ihr nicht nein ja".split(" "));

/** Search tokens: folded, letters and digits only, stop words dropped (when anything else is left). */
export function tokenize(text) {
  const all = fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const kept = all.filter((w) => !STOP.has(w));
  return kept.length ? kept : all;
}

/**
 * The searchable entries of a scene: transcript segments, shots (with the notes that overlap them), notes, markers
 * and captions. Media entries are in source seconds; markers and captions in timeline seconds (media null).
 */
export function buildIndex(model) {
  const entries = [];
  for (const [media, a] of Object.entries(model.analysis || {})) {
    if (!model.media?.[media]) continue;
    for (const s of a.transcript?.segments || []) entries.push({ kind: "speech", media, t0: s.t0, t1: s.t1, text: s.text });
    for (const n of a.notes || []) entries.push({ kind: "visual", media, t0: n.t0, t1: n.t1, text: n.text });
    (a.shots || []).forEach((s, i) => entries.push({ kind: "shot", media, t0: s.t0, t1: s.t1, text: `shot ${i + 1}` }));
  }
  for (const k of model.markers || []) if (k.name) entries.push({ kind: "marker", media: null, t0: k.t, t1: k.t, text: k.name });
  for (const c of Object.values(model.clips || {})) if (c.caption && c.text?.text) entries.push({ kind: "caption", media: null, t0: c.start, t1: c.start + c.dur, text: c.text.text });
  return entries;
}

/**
 * Ranks index entries for a query: each query token found as a whole word scores 1, as a prefix 0.6; the whole
 * phrase found adds 2. Entries of kind "shot" only match by number ("shot 3").
 * @returns {[{ kind, media, t0, t1, text, score }]} best first
 */
export function searchIndex(entries, query, { limit = 10, kinds = null } = {}) {
  const q = tokenize(query);
  const phrase = fold(query).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!q.length) return [];
  const hits = [];
  for (const e of entries) {
    if (kinds && !kinds.includes(e.kind)) continue;
    const toks = tokenize(e.text);
    if (!toks.length) continue;
    let score = 0;
    for (const w of q) {
      if (toks.includes(w)) score += 1;
      else if (w.length >= 3 && toks.some((x) => x.startsWith(w) || (x.length >= 4 && w.startsWith(x)))) score += 0.6;
    }
    if (!score) continue;
    if (q.length > 1 && fold(e.text).replace(/[^\p{L}\p{N}]+/gu, " ").includes(phrase)) score += 2;
    hits.push({ ...e, score: Math.round((score / q.length) * 100) / 100 });
  }
  return hits.sort((a, b) => b.score - a.score || a.t0 - b.t0).slice(0, limit);
}
