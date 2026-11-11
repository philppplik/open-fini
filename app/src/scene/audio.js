// Scene Studio audio engine (docs/scene-studio.md ▸ Audio). Sound is played from decoded buffers through Web Audio,
// never from the <video> elements, so the picture follows ONE clock (the AudioContext) and the same graph renders
// the export offline. Per audio clip: source (speed) → gate → low / high cut → equalizer → compressor → gain
// (volume keyframes × fades) → pan → master.
//
//   createAudioEngine(store)  → { start(model, t, rate, seq), stop(), time(), levels(), destroy() }
//   renderAudio(model, store, { from, to, sampleRate, seq }) → Promise<AudioBuffer>       (export, analysis)
//   encodeWav(buffer) → Uint8Array (16-bit PCM)      gateCurve(samples, rate, thresholdDb, release) → Float32Array
// What sounds is evaluate.js ▸ flattenAudio: audio clips plus the sound of compositions (nested, with the
// composition clip's speed, trim, volume, fades and pan applied).
// Limits: changing the speed changes the pitch (no time-stretch yet); time-remapped compositions are silent.
import { clipEnd, duration, sequence } from "./model.js";
import { flattenAudio } from "./evaluate.js";
import { valueAt } from "./keyframes.js";
import { stageEffects } from "./effects.js";

const CURVE_RATE = 50; // automation points per second

/**
 * Gain curve of a noise gate over mono samples: 1 while the level (RMS of 10 ms windows) is above the threshold,
 * falling to 0 over `release` seconds after it drops. One value per 10 ms. Pure (unit-tested).
 */
export function gateCurve(samples, rate, thresholdDb = -45, release = 0.15) {
  const win = Math.max(1, Math.round(rate / 100));
  const n = Math.ceil(samples.length / win);
  const out = new Float32Array(n);
  const thr = Math.pow(10, thresholdDb / 20);
  const fall = 1 / Math.max(1, release * 100);
  let g = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const end = Math.min(samples.length, (i + 1) * win);
    for (let j = i * win; j < end; j++) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / Math.max(1, end - i * win));
    g = rms >= thr ? 1 : Math.max(0, g - fall);
    out[i] = g;
  }
  return out;
}

// Samples a function of clip-local time into an automation curve for [a, b] (clip-local seconds).
function curve(fn, a, b) {
  const n = Math.max(2, Math.ceil((b - a) * CURVE_RATE) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(a + ((b - a) * i) / (n - 1));
  return out;
}

// Builds and schedules the graph of one clip. `when` = context time at which timeline time `t0` sounds.
function schedule(ctx, dest, clip, buffer, when, t0, rate, until) {
  const end = Math.min(clipEnd(clip), until);
  if (end <= t0 + 1e-4 || !buffer) return null;
  const a = Math.max(0, t0 - clip.start); // clip-local start
  const b = end - clip.start;
  const at = when + Math.max(0, clip.start - t0) / rate;
  const len = (b - a) / rate;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = clip.speed * rate;
  let node = src;
  const link = (n) => {
    node.connect(n);
    node = n;
    return n;
  };
  for (const e of stageEffects(clip.effects.filter((x) => x.on).map((x) => ({ type: x.type, p: Object.fromEntries(Object.entries(x.p).map(([k, v]) => [k, valueAt(v, 0)])) })), "audio")) {
    const p = e.p;
    if (e.type === "highpass" || e.type === "lowpass") {
      const f = link(ctx.createBiquadFilter());
      f.type = e.type;
      f.frequency.value = p.freq;
    } else if (e.type === "eq") {
      for (const [type, freq, gain] of [["lowshelf", 200, p.low], ["peaking", 1200, p.mid], ["highshelf", 5000, p.high]]) {
        if (!gain) continue;
        const f = link(ctx.createBiquadFilter());
        f.type = type;
        f.frequency.value = freq;
        f.gain.value = gain;
      }
    } else if (e.type === "compressor") {
      const c = link(ctx.createDynamicsCompressor());
      c.threshold.value = p.threshold;
      c.ratio.value = p.ratio;
      if (p.makeup) link(ctx.createGain()).gain.value = Math.pow(10, p.makeup / 20);
    } else if (e.type === "gate") {
      // the gate is a gain curve computed from the source samples the clip plays
      const s0 = Math.floor((clip.in + a * clip.speed) * buffer.sampleRate);
      const s1 = Math.min(buffer.length, Math.ceil((clip.in + b * clip.speed) * buffer.sampleRate));
      if (s1 > s0 + 1) {
        const g = link(ctx.createGain());
        const c = gateCurve(buffer.getChannelData(0).subarray(s0, s1), buffer.sampleRate, p.threshold, p.release);
        if (c.length > 1) g.gain.setValueCurveAtTime(c, at, len);
      }
    }
  }
  const gain = link(ctx.createGain());
  if (clip.animated) gain.gain.setValueCurveAtTime(curve(clip.gain, a, b), at, len);
  else gain.gain.value = clip.gain(a);
  if (ctx.createStereoPanner && (clip.animated || clip.pan(a))) {
    const pan = link(ctx.createStereoPanner());
    if (clip.animated) pan.pan.setValueCurveAtTime(curve(clip.pan, a, b), at, len);
    else pan.pan.value = clip.pan(a);
  }
  node.connect(dest);
  src.start(at, Math.max(0, clip.in + a * clip.speed), Math.max(0.001, (b - a) * clip.speed));
  return src;
}

const audible = (model, seq = "main") => flattenAudio(model, { seq });

export function createAudioEngine(store) {
  let ctx = null;
  let master = null;
  let analysers = null;
  let running = []; // scheduled sources
  let base = null; // { when, t0, rate }
  let token = 0;

  function ensure() {
    if (ctx) return ctx;
    ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)({ latencyHint: "interactive" });
    master = ctx.createGain();
    const split = ctx.createChannelSplitter(2);
    analysers = [ctx.createAnalyser(), ctx.createAnalyser()];
    for (const an of analysers) an.fftSize = 1024;
    master.connect(ctx.destination);
    master.connect(split);
    split.connect(analysers[0], 0);
    split.connect(analysers[1], 1);
    return ctx;
  }

  function stop() {
    token++;
    for (const s of running) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        /* already ended */
      }
    }
    running = [];
    base = null;
  }

  const buf = new Float32Array(1024);
  return {
    /** Starts the sound of the timeline at time `t` (seconds). Resolves when the clips are scheduled. */
    async start(model, t, rate = 1, seq = "main") {
      stop();
      const my = token;
      const c = ensure();
      if (c.state === "suspended") await c.resume().catch(() => {});
      base = { when: c.currentTime + 0.06, t0: t, rate };
      const until = duration(sequence(model, seq));
      await Promise.all(audible(model, seq).filter((clip) => clipEnd(clip) > t).map(async (clip) => {
        const buffer = await store.audio(clip.media);
        if (my !== token || !buffer) return;
        // a buffer that arrives late starts where the transport is now
        const now = this.time();
        const src = schedule(c, master, clip, buffer, Math.max(c.currentTime + 0.01, base.when + (now - base.t0) / rate), Math.max(t, now), rate, until);
        if (src) running.push(src);
      }));
    },
    stop,
    /** Timeline time of the transport while playing (the master clock of the viewer), or null when stopped. */
    time() {
      if (!base || !ctx) return null;
      return base.t0 + Math.max(0, ctx.currentTime - base.when) * base.rate;
    },
    /** Peak levels [left, right] 0..1 of what is playing right now (meters). */
    levels() {
      if (!analysers || !base) return [0, 0];
      return analysers.map((an) => {
        an.getFloatTimeDomainData(buf);
        let mx = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i] < 0 ? -buf[i] : buf[i];
          if (v > mx) mx = v;
        }
        return Math.min(1, mx);
      });
    },
    setVolume(v) {
      ensure();
      master.gain.value = Math.max(0, Math.min(1, v));
    },
    destroy() {
      stop();
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}

/** Renders the sound of [from, to) offline with the same graph as playback. */
export async function renderAudio(model, store, { from = 0, to = duration(model), sampleRate = 48000, seq = "main" } = {}) {
  const len = Math.max(1, Math.ceil((to - from) * sampleRate));
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const ctx = new Ctx(2, len, sampleRate);
  for (const clip of audible(model, seq)) {
    if (clipEnd(clip) <= from || clip.start >= to) continue;
    const buffer = await store.audio(clip.media);
    if (buffer) schedule(ctx, ctx.destination, clip, buffer, 0, from, 1, to);
  }
  return ctx.startRendering();
}

/** 16-bit PCM WAV file of an AudioBuffer-like object ({ numberOfChannels, sampleRate, length, getChannelData }). */
export function encodeWav(buffer) {
  const ch = Math.min(2, buffer.numberOfChannels);
  const n = buffer.length;
  const out = new Uint8Array(44 + n * ch * 2);
  const v = new DataView(out.buffer);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * ch * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, i) => buffer.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++, o += 2) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return out;
}
