// Scene Studio runtime of the assistant's tools (docs/scene-studio.md ▸ Assistant): the browser side that the pure
// modules (ai-ops.js, ai-auto.js, motion.js, analysis.js) cannot do: find the active scene and commit one undo step,
// render frames and contact sheets to images, decode sound, sample video frames, run the analysis jobs in the worker
// pool, transcribe through the engine registry, import and export. Loaded on the first scene tool call.
//
//   sceneTarget(app)                       → { doc, ui, store, model(), commit(label, next) }
//   renderFrames(ctx, times, opts)         → tool content: one frame, or a labeled contact sheet (JPEG)
//   sampleSourceFrames(ctx, media, times)  → the same for frames of one media item (source seconds)
//   analyzeAudioOf(ctx, media, opts)       → silence, loudness, beats (worker job "scene.audio")
//   detectShotsOf(ctx, media, opts)        → shots (frames sampled here, compared in worker job "scene.shots")
//   transcribeMedia(ctx, media, opts)      → transcript through a batch "stt" engine (platform/engines.js)
//   importFiles(ctx, files, opts), exportFile(app, ctx, opts)
import * as M from "./model.js";
import { createMediaStore, probeMedia, mediaKind } from "./media.js";
import { makeCanvas } from "./render.js";
import { resample, mixMono, normalizeTranscript, planChunks, wordsFromText, levelsDb, detectSilence } from "./analysis.js";

const stores = new WeakMap(); // doc → media store used while the workspace of that scene is not mounted

/** The active scene document with a media store and an undoable commit ("Vibe: <label>"). */
export async function sceneTarget(app) {
  const doc = app.doc;
  if (doc?.office?.kind !== "scene") throw new Error("The active document is not a scene. Create one with scene_new or switch to a scene document.");
  const prj = doc.office;
  if (prj.model?.version !== M.SCENE_VERSION || !Array.isArray(prj.model?.tracks)) prj.model = M.normalizeScene(prj.model || {});
  const ui = app.sceneUI?.doc === doc ? app.sceneUI : null;
  let store = ui?.store;
  if (!store) {
    store = stores.get(doc) || createMediaStore(() => doc.office.model);
    stores.set(doc, store);
  }
  const { commitOffice } = await import("../core/office.js");
  return {
    doc,
    ui,
    store,
    model: () => doc.office.model,
    commit(label, next) {
      if (next && next !== doc.office.model) {
        commitOffice(doc, `Vibe: ${label}`, next);
        ui?.requestDraw?.();
      }
      return doc.office.model;
    },
  };
}

// ---------------------------------------------------------------------------------------------- images

async function encode(canvas, mime = "image/png", quality = 0.82) {
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: mime, quality }) : await new Promise((r) => canvas.toBlob(r, mime, quality));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const tcShort = (m, t) => M.timecode(m, t).replace(/^00:/, "");

/**
 * Draws cells into a grid with a time label under each: `draw(ctx2d, i, w, h)` paints cell i. One cell is returned
 * as a PNG of the frame alone.
 */
async function sheet(n, aspect, draw, labels, { maxSize = 1280, single = false } = {}) {
  if (single) {
    const w = aspect >= 1 ? maxSize : Math.round(maxSize * aspect);
    const h = aspect >= 1 ? Math.round(maxSize / aspect) : maxSize;
    const c = makeCanvas(w, h);
    await draw(c.getContext("2d"), 0, w, h);
    return { mime: "image/png", data: await encode(c), width: w, height: h };
  }
  const cols = Math.min(n, Math.max(1, Math.round(Math.sqrt(n * (aspect >= 1 ? 1 : 2)))));
  const rows = Math.ceil(n / cols);
  const cw = Math.floor(Math.min(480, maxSize / cols));
  const ch = Math.round(cw / aspect);
  const lab = 22;
  const c = makeCanvas(cols * cw, rows * (ch + lab));
  const g = c.getContext("2d");
  g.fillStyle = "#111";
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * (ch + lab);
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.rect(0, 0, cw - 2, ch);
    g.clip();
    await draw(g, i, cw - 2, ch);
    g.restore();
    g.fillStyle = "#fff";
    g.font = "600 13px sans-serif";
    g.textBaseline = "middle";
    g.fillText(`${i + 1}  ${labels[i]}`, x + 6, y + ch + lab / 2);
  }
  return { mime: "image/jpeg", data: await encode(c, "image/jpeg"), width: c.width, height: c.height };
}

/** Frames of the sequence at timeline times (exactly seeked, as exported): one image, or a numbered contact sheet. */
export async function renderFrames(ctx, times, { seq = "main", maxSize = 1280 } = {}) {
  const { createExactRenderer } = await import("./frames.js");
  const model = ctx.model();
  const sq = M.sequence(model, seq);
  const aspect = sq.width / sq.height;
  const r = createExactRenderer(ctx.store);
  const scale = Math.min(1, (times.length === 1 ? maxSize : 480) / Math.max(sq.width, sq.height));
  const img = await sheet(times.length, aspect, async (g, i, w, h) => {
    const frame = await r.render(model, times[i], { seq, scale });
    g.drawImage(frame, 0, 0, w, h);
  }, times.map((t) => `${tcShort(model, t)} (${Math.round(t * 100) / 100}s)`), { maxSize, single: times.length === 1 });
  return img;
}

/** Frames of one media item at source times (what the camera recorded, regardless of the edit). */
export async function sampleSourceFrames(ctx, mediaId, times, { maxSize = 1280 } = {}) {
  const md = ctx.model().media[mediaId];
  if (!md || md.kind === "audio") throw new Error(`“${mediaId}” is not a video or image item.`);
  const aspect = (md.w || 16) / (md.h || 9);
  return sheet(times.length, aspect, async (g, i, w, h) => {
    const src = await ctx.store.frameAt(mediaId, times[i]);
    if (src) g.drawImage(src, 0, 0, w, h);
  }, times.map((t) => `${Math.round(t * 100) / 100}s`), { maxSize, single: times.length === 1 });
}

// ---------------------------------------------------------------------------------------------- sound and frames

/** Decoded channels of a media item resampled to `rate` (stereo at most). */
export async function channelsOf(ctx, mediaId, rate = 16000) {
  const md = ctx.model().media[mediaId];
  if (!md) throw new Error(`There is no media item “${mediaId}”.`);
  if (md.kind === "image") throw new Error(`“${md.name}” is an image; it has no sound.`);
  const buf = await ctx.store.audio(mediaId);
  if (!buf) throw new Error(`The sound of “${md.name}” cannot be decoded in this browser${md.kind === "video" ? " (or the video has no sound track)" : ""}.`);
  const out = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) {
    const src = buf.getChannelData(c);
    const x = resample(src, buf.sampleRate, rate);
    out.push(x === src ? src.slice() : x); // always a copy: it may be transferred to a worker
  }
  return { channels: out, rate, duration: buf.duration };
}

/** Silence, loudness and beats of a media item, computed in the worker pool. */
export async function analyzeAudioOf(ctx, mediaId, opts = {}, signal) {
  const { channels, rate } = await channelsOf(ctx, mediaId, 16000);
  const { runJob } = await import("../core/workers/index.js");
  // channelsOf returns copies, so they can move to the worker (the decoded buffer stays with the media store)
  return runJob("scene.audio", { channels, rate, opts }, { transfer: channels.map((c) => c.buffer), signal });
}

/**
 * Shots of a video: frames sampled at `fps` (64 × 36 pixels) in this thread (seeking needs the media element),
 * compared in the worker pool.
 */
export async function detectShotsOf(ctx, mediaId, { fps, threshold = "auto", minShot = 0.6, signal, report } = {}) {
  const md = ctx.model().media[mediaId];
  if (!md || md.kind !== "video") throw new Error(`“${mediaId}” is not a video item.`);
  const rate = Math.max(0.5, Math.min(10, fps || (md.duration > 300 ? 2 : 4)));
  const n = Math.min(6000, Math.floor(md.duration * rate));
  const c = makeCanvas(64, 36);
  const g = c.getContext("2d", { willReadFrequently: true });
  const frames = [];
  for (let i = 0; i <= n; i++) {
    if (signal?.aborted) throw new DOMException("Cancelled.", "AbortError");
    const t = Math.min(md.duration - 0.01, i / rate);
    const src = await ctx.store.frameAt(mediaId, t);
    if (!src) continue;
    g.drawImage(src, 0, 0, 64, 36);
    frames.push({ t: Math.round(t * 1000) / 1000, data: g.getImageData(0, 0, 64, 36).data });
    if (i % 40 === 0) report?.(`Frames ${i} / ${n}`);
  }
  if (frames.length < 2) throw new Error(`No frames of “${md.name}” could be read.`);
  const { runJob } = await import("../core/workers/index.js");
  return runJob("scene.shots", { frames, opts: { threshold, minShot, duration: md.duration } }, { transfer: frames.map((f) => f.data.buffer), signal });
}

// ---------------------------------------------------------------------------------------------- speech

/** The speech-to-text engines and which one a transcription would use (batch engines, local first). */
export async function speechEngines(id = null) {
  const [{ engines }, { ensureBuiltinEngines }] = await Promise.all([import("../platform/engines.js"), import("../platform/builtin-engines.js")]);
  ensureBuiltinEngines();
  const all = engines.list("stt");
  const batch = all.filter((e) => typeof e.transcribe === "function");
  const chosen = id ? all.find((e) => e.id === id) || null : batch.find((e) => e.local) || batch[0] || null;
  return { all, batch, chosen };
}

export const NO_ENGINE = "No speech engine on this device can transcribe a file. The built-in system recognizer only listens to the microphone. Install an extension that registers a batch speech engine (for example a Whisper WebAssembly build, see docs/engines.md), or give me a transcript or subtitle file to use with scene_set_transcript.";

// word times from a chunk result, shifted to source seconds
function chunkWords(res, a, b) {
  const shift = (x) => a + (+x || 0);
  if (Array.isArray(res?.words) && res.words.length) return { words: res.words.map((w) => ({ t0: shift(w.t0 ?? w.start), t1: shift(w.t1 ?? w.end), w: w.w ?? w.word ?? w.text })), estimated: false };
  if (Array.isArray(res?.segments) && res.segments.length) return { words: res.segments.flatMap((s) => wordsFromText(s.text, shift(s.t0 ?? s.start), shift(s.t1 ?? s.end))), estimated: true };
  return { words: wordsFromText(res?.text || "", a, b), estimated: true };
}

/**
 * Transcribes a media item: its sound is decoded, cut into chunks of at most 28 s at pauses, and each chunk goes to
 * a batch `stt` engine (16 kHz mono PCM). Engines that return word or segment times keep them; text-only results
 * get estimated word times (flagged).
 */
export async function transcribeMedia(ctx, mediaId, { engine = null, lang = "", signal, report } = {}) {
  const { chosen } = await speechEngines(engine);
  if (!chosen) throw new Error(engine ? `There is no speech engine “${engine}”.` : NO_ENGINE);
  if (typeof chosen.transcribe !== "function") throw new Error(`The speech engine “${chosen.label}” only listens to the microphone; it cannot transcribe a file. ${NO_ENGINE}`);
  const { channels, rate, duration } = await channelsOf(ctx, mediaId, 16000);
  const mono = mixMono(channels);
  const sil = detectSilence(levelsDb(mono, rate), { minDur: 0.35, pad: 0, duration });
  const chunks = planChunks(sil.ranges, duration);
  const words = [];
  let estimated = false;
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) throw new DOMException("Cancelled.", "AbortError");
    const [a, b] = chunks[i];
    report?.(`Transcribing ${i + 1} / ${chunks.length}`);
    const pcm = mono.slice(Math.floor(a * rate), Math.ceil(b * rate));
    const res = await chosen.transcribe(pcm, { lang, sampleRate: rate, signal });
    const got = chunkWords(res, a, b);
    estimated ||= got.estimated;
    words.push(...got.words);
  }
  return normalizeTranscript({ engine: chosen.id, lang, words, estimated }, duration);
}

// ---------------------------------------------------------------------------------------------- import and export

/** Probes and adds files ({ name, bytes, mime }) as media items; subtitle files become captions. One undo step. */
export async function importFiles(ctx, files, { place = false, start = null } = {}) {
  let next = ctx.model();
  const added = [];
  const notes = [];
  for (const f of files) {
    if (/\.(srt|vtt)$/i.test(f.name)) {
      const { parseSubtitles, captionsToClips } = await import("./captions.js");
      const cues = parseSubtitles(new TextDecoder().decode(f.bytes));
      next = captionsToClips(next, cues).model;
      notes.push(`${f.name}: ${cues.length} captions`);
      continue;
    }
    if (!mediaKind(f.name, f.mime)) throw new Error(`“${f.name}” is not a video, audio, image or subtitle file.`);
    const item = await probeMedia(f.bytes, f.name, f.mime);
    const r = M.addMedia(next, item);
    next = r.model;
    if (place) next = M.placeMedia(next, r.id, { start: start ?? M.duration(next) }).model;
    added.push({ id: r.id, kind: item.kind, name: item.name, duration: Math.round(item.duration * 1000) / 1000, size: item.w ? `${item.w}×${item.h}` : undefined });
  }
  ctx.commit(added.length ? "Import Media" : "Import Captions", next);
  return { media: added, ...(notes.length ? { captions: notes } : {}) };
}

/** Opens a model as a new scene document (highlight reels and reframed copies keep the original). */
export async function openSceneCopy(app, model, name) {
  const [{ Doc }, { OfficeProject }] = await Promise.all([import("../core/doc.js"), import("../core/office.js")]);
  const doc = new Doc({ name: String(name).slice(0, 120), studio: "scene", width: model.width, height: model.height, pages: 1 });
  doc.office = new OfficeProject({ ...model, title: String(name).slice(0, 200) }, "scene");
  doc.history.clear();
  doc.saved = false;
  app.setStudio("scene");
  app.openDoc(doc);
  return doc;
}

/** Renders and saves the sequence (the user picks the file in the save dialog). */
export async function exportFile(app, ctx, { format = "mp4", scale = 1, fps, quality = 0.7, audio = true, range = null, signal, report } = {}) {
  const { exportScene, exportSupport } = await import("./export.js");
  const support = await exportSupport();
  const need = { mp4: "mp4", webm: "webm", gif: "gif", frames: "frames", png: "frames", wav: "wav" }[format];
  if (!need) throw new Error("format is mp4, webm, gif, frames, png or wav.");
  if (!support[need]) throw new Error(`This browser cannot encode ${format.toUpperCase()}. ${support.reason || "Try webm, gif or wav."}`);
  const res = await exportScene(ctx.store, ctx.model(), { format, scale, fps, quality, audio, range, signal, onProgress: (p) => report?.(`Rendering ${Math.round(p * 100)} %`) });
  const { platform } = await import("../platform/index.js");
  const { downloadName } = await import("../core/util.js");
  await platform.saveFile({ suggestedName: downloadName(ctx.doc.name, res.ext), bytes: res.bytes, mime: res.mime, filters: [{ name: res.ext.toUpperCase(), extensions: [res.ext] }] });
  return { ok: true, format, bytes: res.bytes.length, notes: res.notes };
}
