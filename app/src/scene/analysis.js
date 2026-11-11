// Scene Studio analysis (docs/scene-studio.md ▸ Understanding footage): what the assistant needs to know about a
// media item to edit it like a person would. Pure signal and text functions (unit-tested in
// tests/scene/analysis.test.js); the browser parts that read frames and decode sound live in scene/understand.js.
//
// Results are stored per media item in model.analysis[mediaId] (source time, seconds):
//   silence:    [[t0, t1], …]                 quiet stretches
//   loudness:   { peakDb, rmsDb, perSecond: [dB, …] }
//   beats:      { bpm, times: [t, …] }
//   shots:      [t, …]                        cut points inside the source
//   transcript: { lang, source, words: [{ t0, t1, w }], segments: [{ t0, t1, text }] }
//   notes:      [{ t, text }]                 what the assistant saw in sampled frames (searchable)

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);

/** RMS level per window (seconds) of mono samples. */
export function rmsWindows(samples, rate, win = 0.02) {
  const n = Math.max(1, Math.round(rate * win));
  const out = new Float32Array(Math.ceil(samples.length / n));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    const end = Math.min(samples.length, (i + 1) * n);
    for (let j = i * n; j < end; j++) sum += samples[j] * samples[j];
    out[i] = Math.sqrt(sum / Math.max(1, end - i * n));
  }
  return out;
}

/**
 * Quiet stretches of at least `minDur` seconds below `thresholdDb` (relative to full scale). `pad` seconds of each
 * stretch are kept at both ends so cuts do not clip the first and last syllable.
 */
export function detectSilence(samples, rate, { thresholdDb = -38, minDur = 0.45, pad = 0.08 } = {}) {
  const win = 0.02;
  const rms = rmsWindows(samples, rate, win);
  const thr = Math.pow(10, thresholdDb / 20);
  const out = [];
  let start = -1;
  for (let i = 0; i <= rms.length; i++) {
    const quiet = i < rms.length && rms[i] < thr;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      const t0 = start * win + (start === 0 ? 0 : pad);
      const t1 = i * win - (i === rms.length ? 0 : pad);
      if (t1 - t0 >= minDur) out.push([Math.round(t0 * 1000) / 1000, Math.round(t1 * 1000) / 1000]);
      start = -1;
    }
  }
  return out;
}

/** Peak and RMS level in dBFS, plus the RMS per second (for "where is it loud"). */
export function loudness(samples, rate) {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i] < 0 ? -samples[i] : samples[i];
    if (a > peak) peak = a;
    sum += samples[i] * samples[i];
  }
  const per = rmsWindows(samples, rate, 1);
  return { peakDb: Math.round(db(peak) * 10) / 10, rmsDb: Math.round(db(Math.sqrt(sum / Math.max(1, samples.length))) * 10) / 10, perSecond: Array.from(per, (v) => Math.round(db(v) * 10) / 10) };
}

/**
 * Tempo and beat times from the energy envelope: onset strength (positive energy change per 10 ms), tempo by
 * autocorrelation in 60..180 BPM, then the phase that collects the most onset energy.
 */
export function detectBeats(samples, rate) {
  const win = 0.01;
  const env = rmsWindows(samples, rate, win);
  const onset = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) onset[i] = Math.max(0, env[i] - env[i - 1]);
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= Math.max(1, onset.length);
  if (!(mean > 1e-6) || onset.length < 300) return { bpm: 0, times: [] };
  let best = 0;
  let bestLag = 0;
  const lo = Math.round(60 / 180 / win);
  const hi = Math.round(60 / 60 / win);
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    // prefer tempi near 120 BPM a little, as listeners do
    s *= 1 - 0.25 * Math.abs(Math.log2((60 / (lag * win)) / 120));
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  if (!bestLag) return { bpm: 0, times: [] };
  let phase = 0;
  let bestPhase = -1;
  for (let p = 0; p < bestLag; p++) {
    let s = 0;
    for (let i = p; i < onset.length; i += bestLag) s += onset[i] + (onset[i - 1] || 0) + (onset[i + 1] || 0);
    if (s > bestPhase) {
      bestPhase = s;
      phase = p;
    }
  }
  const times = [];
  for (let i = phase; i < onset.length; i += bestLag) times.push(Math.round(i * win * 1000) / 1000);
  return { bpm: Math.round((60 / (bestLag * win)) * 10) / 10, times };
}

/**
 * A small signature of a frame for shot detection: a 4 × 4 × 4 color histogram, normalized. `rgba` = pixels of a
 * small copy of the frame (for example 48 × 27).
 */
export function frameSignature(rgba) {
  const h = new Float32Array(64);
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) h[((rgba[i] >> 6) << 4) | ((rgba[i + 1] >> 6) << 2) | (rgba[i + 2] >> 6)]++;
  for (let i = 0; i < 64; i++) h[i] /= n || 1;
  return h;
}

/** Histogram difference 0..1 of two signatures. */
export function signatureDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / 2;
}

/**
 * Cut points from signatures sampled at `times`: a cut is where the difference to the previous sample is above
 * `threshold` and clearly above the local average (so slow pans and fades do not count).
 */
export function shotCuts(signatures, times, { threshold = 0.35, minGap = 0.4 } = {}) {
  const d = signatures.map((s, i) => (i ? signatureDistance(signatures[i - 1], s) : 0));
  const cuts = [];
  for (let i = 1; i < d.length; i++) {
    let local = 0;
    let n = 0;
    for (let j = Math.max(1, i - 4); j <= Math.min(d.length - 1, i + 4); j++) {
      if (j !== i) {
        local += d[j];
        n++;
      }
    }
    local = n ? local / n : 0;
    if (d[i] >= threshold && d[i] > local * 2.2 + 0.05 && (!cuts.length || times[i] - cuts[cuts.length - 1] >= minGap)) cuts.push(times[i]);
  }
  return cuts;
}

// ---------------------------------------------------------------------------------------------- transcript

const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();

/** A transcript from cues or words: words get even timing inside their cue when only cues are known. */
export function makeTranscript({ words = null, cues = null, lang = "", source = "" }) {
  let w = [];
  if (Array.isArray(words) && words.length) {
    w = words.filter((x) => x && Number.isFinite(+x.t0) && String(x.w ?? x.text ?? "").trim()).map((x) => ({ t0: +x.t0, t1: Number.isFinite(+x.t1) && +x.t1 > +x.t0 ? +x.t1 : +x.t0 + 0.3, w: String(x.w ?? x.text).trim() }));
  } else {
    for (const c of cues || []) {
      const parts = String(c.text || "").split(/\s+/).filter(Boolean);
      const total = parts.reduce((n, p) => n + p.length + 1, 0) || 1;
      let t = +c.t0;
      for (const p of parts) {
        const d = ((c.t1 - c.t0) * (p.length + 1)) / total;
        w.push({ t0: Math.round(t * 1000) / 1000, t1: Math.round((t + d) * 1000) / 1000, w: p });
        t += d;
      }
    }
  }
  w.sort((a, b) => a.t0 - b.t0);
  return { lang, source, words: w, segments: segmentsOf(w) };
}

/** Sentences (or pause-separated phrases) of a word list: [{ t0, t1, text, from, to }] with word indices. */
export function segmentsOf(words, { gap = 0.8, maxWords = 40 } = {}) {
  const out = [];
  let cur = null;
  words.forEach((w, i) => {
    if (cur && (w.t0 - cur.t1 > gap || cur.to - cur.from + 1 >= maxWords)) {
      out.push(cur);
      cur = null;
    }
    if (!cur) cur = { t0: w.t0, t1: w.t1, text: "", from: i, to: i };
    cur.text += (cur.text ? " " : "") + w.w;
    cur.t1 = w.t1;
    cur.to = i;
    if (/[.!?…]["')\]]?$/.test(w.w)) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out;
}

export const FILLERS = {
  en: ["um", "uh", "uhm", "er", "erm", "ah", "hmm", "mhm", "like", "you know", "i mean", "sort of", "kind of"],
  de: ["äh", "ähm", "öh", "öhm", "hm", "hmm", "mhm", "halt", "sozusagen", "quasi", "irgendwie", "also"],
};

/**
 * Time ranges of filler words in a transcript. Single-word fillers that are also real words ("like", "also",
 * "halt") only count when `aggressive` is set. Returns [{ t0, t1, text }].
 */
export function fillerRanges(words, { lang = "en", extra = [], aggressive = false } = {}) {
  const safe = new Set(["um", "uh", "uhm", "er", "erm", "ah", "hmm", "mhm", "äh", "ähm", "öh", "öhm", "hm"]);
  const list = [...(FILLERS[lang.slice(0, 2)] || FILLERS.en), ...extra].map(norm).filter((f) => f && (aggressive || safe.has(f) || f.includes(" ") || extra.map(norm).includes(f)));
  const tokens = words.map((w) => norm(w.w));
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const f of list) {
      const parts = f.split(" ");
      if (parts.every((p, k) => tokens[i + k] === p)) {
        out.push({ t0: words[i].t0, t1: words[i + parts.length - 1].t1, text: f });
        i += parts.length - 1;
        break;
      }
    }
  }
  return out;
}

/**
 * Finds a phrase in a word list (case, accents and punctuation are ignored). Returns [{ t0, t1, from, to, text }].
 */
export function findPhrase(words, query) {
  const q = norm(query).split(" ").filter(Boolean);
  if (!q.length) return [];
  const tokens = words.map((w) => norm(w.w));
  const out = [];
  for (let i = 0; i + q.length <= tokens.length; i++) {
    // a query word may match the start of a transcript word ("edit" finds "editing")
    if (q.every((p, k) => tokens[i + k] === p || (k === q.length - 1 && p.length >= 3 && tokens[i + k].startsWith(p)))) {
      out.push({ t0: words[i].t0, t1: words[i + q.length - 1].t1, from: i, to: i + q.length - 1, text: words.slice(i, i + q.length).map((w) => w.w).join(" ") });
    }
  }
  return out;
}

/**
 * Searches everything known about the footage: transcript phrases, notes on frames, markers, clip names and text.
 * Scores by how many query words match. Returns [{ kind, media?, t (source time for media, else timeline), t1?, text, score }].
 */
export function searchIndex(model, query, { limit = 20 } = {}) {
  const q = norm(query).split(" ").filter((w) => w.length > 1);
  if (!q.length) return [];
  const score = (text) => {
    const t = ` ${norm(text)} `;
    let s = 0;
    for (const w of q) if (t.includes(` ${w}`)) s++;
    return s / q.length;
  };
  const hits = [];
  for (const [media, a] of Object.entries(model.analysis || {})) {
    for (const seg of a.transcript?.segments || []) {
      const s = score(seg.text);
      if (s > 0) hits.push({ kind: "speech", media, t: seg.t0, t1: seg.t1, text: seg.text, score: s });
    }
    for (const n of a.notes || []) {
      const s = score(n.text);
      if (s > 0) hits.push({ kind: "picture", media, t: n.t, text: n.text, score: s });
    }
  }
  for (const k of model.markers || []) {
    const s = score(k.name);
    if (s > 0) hits.push({ kind: "marker", t: k.t, text: k.name, score: s, timeline: true });
  }
  for (const c of Object.values(model.clips || {})) {
    const text = c.type === "text" ? c.text.text : c.name;
    const s = score(text);
    if (s > 0) hits.push({ kind: c.type === "text" ? "text clip" : "clip", clip: c.id, t: c.start, t1: c.start + c.dur, text, score: s, timeline: true });
  }
  return hits.sort((a, b) => b.score - a.score || a.t - b.t).slice(0, limit);
}

/**
 * Volume keyframes that lower a music clip while speech plays ("ducking"). `speech` = timeline ranges with
 * speech; the result is a keyframe track in clip-local time for a clip that starts at `clipStart` and lasts `dur`.
 */
export function duckingTrack(speech, clipStart, dur, { normal = 1, ducked = 0.25, ramp = 0.3 } = {}) {
  const kf = [{ t: 0, v: normal }];
  const push = (t, v) => {
    const tt = Math.max(0, Math.min(dur, t));
    const last = kf[kf.length - 1];
    if (Math.abs(last.t - tt) < 1e-3) last.v = v;
    else if (tt > last.t) kf.push({ t: Math.round(tt * 1000) / 1000, v });
  };
  for (const [a, b] of speech) {
    const s = a - clipStart;
    const e = b - clipStart;
    if (e <= 0 || s >= dur) continue;
    push(s - ramp, kf[kf.length - 1].v);
    push(s, ducked);
    push(e, ducked);
    push(e + ramp, normal);
  }
  push(dur, kf[kf.length - 1].v);
  return kf.length > 2 ? { kf } : normal;
}

/** The complement of ranges inside [0, total]: speech from silence, and the other way round. */
export function invertRanges(ranges, total) {
  const out = [];
  let pos = 0;
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    if (a > pos) out.push([pos, Math.min(a, total)]);
    pos = Math.max(pos, b);
  }
  if (pos < total) out.push([pos, total]);
  return out;
}
