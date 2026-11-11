// Scene Studio understanding (browser side of scene/analysis.js): reads the sound and the frames of a media item
// and turns them into analysis results; renders contact sheets the assistant can look at; runs speech recognition.
// Used by the assistant's tools (vibe/tools/scene-understand.js) and reusable by the UI.
//
//   monoSamples(store, mediaId) → { samples, rate } | null
//   analyzeAudio(store, mediaId, opts) → { silence, loudness, beats }
//   detectShots(store, model, mediaId, { step, threshold, onProgress }) → [t, …]
//   contactSheet(draw, times, { cols, cellW, labels }) → canvas     draw(t) → Promise<CanvasImageSource>
//   transcribers: registerTranscriber({ id, label, local, available(), transcribe(job) }) / pickTranscriber(id)
//   The built-in "system" transcriber feeds the sound to the browser's speech recognizer in real time (Chromium
//   139 or newer; sends audio to the browser vendor's service unless on-device recognition is installed).
// Invariants: nothing here changes the document; long jobs take an AbortSignal and report progress.
import { detectSilence, loudness, detectBeats, frameSignature, shotCuts, makeTranscript } from "./analysis.js";
import { makeCanvas } from "./render.js";

/** The sound of a media item mixed to mono, or null when it has none. */
export async function monoSamples(store, mediaId) {
  const buf = await store.audio(mediaId);
  if (!buf) return null;
  const a = buf.getChannelData(0);
  if (buf.numberOfChannels < 2) return { samples: a, rate: buf.sampleRate, duration: buf.duration };
  const b = buf.getChannelData(1);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
  return { samples: out, rate: buf.sampleRate, duration: buf.duration };
}

export async function analyzeAudio(store, mediaId, { thresholdDb, minDur, pad, beats = true } = {}) {
  const m = await monoSamples(store, mediaId);
  if (!m) throw new Error("This media item has no sound the browser can decode.");
  return {
    silence: detectSilence(m.samples, m.rate, { ...(thresholdDb !== undefined ? { thresholdDb } : {}), ...(minDur !== undefined ? { minDur } : {}), ...(pad !== undefined ? { pad } : {}) }),
    loudness: loudness(m.samples, m.rate),
    ...(beats ? { beats: detectBeats(m.samples, m.rate) } : {}),
    duration: m.duration,
  };
}

/** Cut points inside a video: samples a small copy of the picture every `step` seconds and compares histograms. */
export async function detectShots(store, model, mediaId, { step = 0.5, threshold = 0.35, onProgress = () => {}, signal = null } = {}) {
  const md = model.media[mediaId];
  if (!md || md.kind !== "video") throw new Error("Shot detection needs a video.");
  const cv = makeCanvas(48, 27);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const times = [];
  const sigs = [];
  const n = Math.max(1, Math.floor(md.duration / step));
  for (let i = 0; i <= n; i++) {
    if (signal?.aborted) throw new DOMException("Cancelled.", "AbortError");
    const t = Math.min(md.duration - 0.01, i * step);
    const src = await store.frameAt(mediaId, t);
    if (!src) continue;
    ctx.drawImage(src, 0, 0, 48, 27);
    sigs.push(frameSignature(ctx.getImageData(0, 0, 48, 27).data));
    times.push(t);
    onProgress(i / n);
  }
  const rough = shotCuts(sigs, times, { threshold });
  // refine each cut to the frame: bisect between the sample before and the sample at the cut
  const out = [];
  for (const cut of rough) {
    let lo = Math.max(0, cut - step);
    let hi = cut;
    const sigAt = async (t) => {
      const src = await store.frameAt(mediaId, t);
      if (!src) return null;
      ctx.drawImage(src, 0, 0, 48, 27);
      return frameSignature(ctx.getImageData(0, 0, 48, 27).data);
    };
    const a = await sigAt(lo);
    for (let k = 0; k < 5 && a; k++) {
      const mid = (lo + hi) / 2;
      const s = await sigAt(mid);
      if (!s) break;
      let d = 0;
      for (let i = 0; i < 64; i++) d += Math.abs(s[i] - a[i]);
      if (d / 2 > threshold / 2) hi = mid;
      else lo = mid;
    }
    out.push(Math.round(hi * 100) / 100);
  }
  return out;
}

const stamp = (t) => {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(s < 60 && s % 1 ? 2 : 0).padStart(s < 60 && s % 1 ? 5 : 2, "0")}`;
};

/**
 * A grid of frames with their time printed on each: one image that shows a stretch of video at a glance.
 * @param {(t: number) => Promise<CanvasImageSource|null>} draw
 */
export async function contactSheet(draw, times, { cols = 4, cellW = 320, aspect = 16 / 9, labels = null } = {}) {
  const n = times.length;
  const c = Math.min(cols, n);
  const rows = Math.ceil(n / c);
  const cellH = Math.round(cellW / aspect);
  const sheet = makeCanvas(c * cellW, rows * cellH);
  const ctx = sheet.getContext("2d");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < n; i++) {
    const x = (i % c) * cellW;
    const y = Math.floor(i / c) * cellH;
    const src = await draw(times[i]);
    if (src) {
      const sw = src.videoWidth || src.naturalWidth || src.width;
      const sh = src.videoHeight || src.naturalHeight || src.height;
      const k = Math.min(cellW / sw, cellH / sh);
      ctx.drawImage(src, x + (cellW - sw * k) / 2, y + (cellH - sh * k) / 2, sw * k, sh * k);
    }
    const label = labels?.[i] ?? stamp(times[i]);
    ctx.font = `600 ${Math.max(12, Math.round(cellW / 18))}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(x + 4, y + 4, tw + 10, Math.round(cellW / 14) + 6);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "top";
    ctx.fillText(label, x + 9, y + 7);
    ctx.strokeStyle = "#000";
    ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
  }
  return sheet;
}

/** PNG bytes of a canvas as base64 (tool results carry images this way). */
export async function canvasToBase64(cv, type = "image/jpeg", quality = 0.85) {
  const blob = cv.convertToBlob ? await cv.convertToBlob({ type, quality }) : await new Promise((r) => cv.toBlob(r, type, quality));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { data: btoa(bin), mime: type, width: cv.width, height: cv.height };
}

// ---------------------------------------------------------------------------------------------- speech recognition

const registry = new Map();

/**
 * Adds a speech-to-text engine. `transcribe({ buffer (AudioBuffer), from, to, lang, onProgress, signal })` returns
 * `{ words: [{ t0, t1, w }] }` or `{ cues: [{ t0, t1, text }] }` in source seconds. `local` = audio stays on the device.
 */
export function registerTranscriber(def) {
  if (!def?.id || typeof def.transcribe !== "function") return false;
  registry.set(def.id, { label: def.id, local: false, available: () => true, ...def });
  return true;
}
// Batch speech engines of the platform registry (platform/engines.js, kind "stt": local recognizers, extensions,
// MCP) transcribe 16 kHz mono sound without time stamps. To get times, the sound is cut at its pauses and every
// piece becomes one cue; makeTranscript spreads the words inside it.
function engineTranscriber(e) {
  return {
    id: e.id,
    label: e.label || e.id,
    local: !!e.local,
    available: () => true,
    async transcribe({ buffer, from = 0, to = buffer.duration, lang = "en-US", onProgress = () => {}, signal = null }) {
      const rate = 16000;
      const off = new OfflineAudioContext(1, Math.max(1, Math.ceil((to - from) * rate)), rate);
      const src = off.createBufferSource();
      src.buffer = buffer;
      src.connect(off.destination);
      src.start(0, from, to - from);
      const pcm = (await off.startRendering()).getChannelData(0);
      const pauses = detectSilence(pcm, rate, { minDur: 0.35, pad: 0.1 });
      // pieces between pauses, merged up to 12 seconds, never longer than 25
      const pieces = [];
      let start = 0;
      const total = pcm.length / rate;
      for (const [p0, p1] of [...pauses, [total, total]]) {
        const mid = Math.min(total, (p0 + p1) / 2);
        if (mid - start >= 12 || p0 >= total) {
          for (let s = start; s < mid; s += 25) pieces.push([s, Math.min(mid, s + 25)]);
          start = mid;
        }
      }
      const cues = [];
      for (let i = 0; i < pieces.length; i++) {
        if (signal?.aborted) throw new DOMException("Cancelled.", "AbortError");
        const [s, t] = pieces[i];
        if (t - s < 0.2) continue;
        const r = await e.transcribe(pcm.subarray(Math.floor(s * rate), Math.ceil(t * rate)), { lang, sampleRate: rate, signal });
        const text = String(r?.text || "").trim();
        if (text) cues.push({ t0: from + s, t1: from + t, text });
        onProgress((i + 1) / pieces.length);
      }
      return { cues };
    },
  };
}

let platformEngines = null;
/** Loads the platform engine registry once (it is optional: the Scene Studio works without it). */
export async function loadPlatformEngines() {
  if (platformEngines === null) {
    platformEngines = await import("../platform/engines.js").then(async (m) => {
      await import("../platform/builtin-engines.js").catch(() => {});
      return m.engines;
    }).catch(() => false);
  }
  return platformEngines || null;
}
const batchEngines = () => (platformEngines ? platformEngines.list("stt").filter((e) => typeof e.transcribe === "function").map(engineTranscriber) : []);

export const listTranscribers = () => [...batchEngines(), ...registry.values()].map((t) => ({ id: t.id, label: t.label, local: !!t.local, available: !!t.available() }));
/** The engine with this id, or the first available one (local engines first, then batch engines, then the browser's). */
export function pickTranscriber(id = null) {
  const all = [...batchEngines(), ...registry.values()];
  if (id) return all.find((t) => t.id === id) || null;
  const ok = all.filter((t) => t.available());
  return ok.find((t) => t.local) || ok[0] || null;
}

const Recognition = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

// The browser's recognizer, fed with the media item's sound instead of the microphone. It runs in real time.
registerTranscriber({
  id: "system",
  label: "Browser speech recognition",
  local: false,
  available: () => !!Recognition() && typeof AudioContext === "function",
  async transcribe({ buffer, from = 0, to = buffer.duration, lang = "en-US", onProgress = () => {}, signal = null }) {
    const R = Recognition();
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    const rec = new R();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    const cues = [];
    let startedAt = 0;
    const now = () => from + Math.max(0, ctx.currentTime - startedAt);
    let open = null; // start time of the phrase being recognized
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        try {
          rec.onend = null;
          rec.stop();
          src.stop();
        } catch {
          /* already stopped */
        }
        ctx.close().catch(() => {});
        if (err) reject(err);
        else resolve({ cues });
      };
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (open === null) open = Math.max(from, now() - 0.6);
          if (r.isFinal) {
            const text = r[0].transcript.trim();
            if (text) cues.push({ t0: Math.round(open * 100) / 100, t1: Math.round(now() * 100) / 100, text });
            open = null;
          }
        }
        onProgress(Math.min(1, (now() - from) / Math.max(0.1, to - from)));
      };
      rec.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        finish(new Error(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Speech recognition is not allowed in this browser profile." : `Speech recognition failed: ${e.error}.`));
      };
      // the recognizer stops by itself after a pause: restart it while sound is left
      rec.onend = () => {
        if (done) return;
        if (now() < to - 0.3) {
          try {
            rec.start(dest.stream.getAudioTracks()[0]);
          } catch (err) {
            finish(err);
          }
        } else finish();
      };
      signal?.addEventListener("abort", () => finish(new DOMException("Cancelled.", "AbortError")));
      src.onended = () => setTimeout(() => finish(), 1500);
      try {
        rec.start(dest.stream.getAudioTracks()[0]); // throws where the recognizer only takes the microphone
      } catch {
        return finish(new Error("This browser's speech recognizer cannot read a file's sound (it needs Chromium 139 or newer). Import subtitles (.srt / .vtt) or provide the transcript with scene_set_transcript instead."));
      }
      startedAt = ctx.currentTime;
      src.start(0, from, Math.max(0.1, to - from));
    });
  },
});

/** Runs a transcriber over a media item and returns a transcript (scene/analysis.js ▸ makeTranscript). */
export async function transcribeMedia(store, mediaId, { engine = null, lang = "en-US", from, to, onProgress, signal } = {}) {
  await loadPlatformEngines();
  const t = pickTranscriber(engine);
  if (!t || !t.available()) throw new Error("No speech recognition engine is available here. Import subtitles (.srt / .vtt) or provide the transcript with scene_set_transcript.");
  const buffer = await store.audio(mediaId);
  if (!buffer) throw new Error("This media item has no sound the browser can decode.");
  const r = await t.transcribe({ buffer, from: from ?? 0, to: to ?? buffer.duration, lang, onProgress, signal });
  return makeTranscript({ words: r.words, cues: r.cues, lang, source: t.id });
}
