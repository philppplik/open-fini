// Scene Studio export (docs/scene-studio.md ▸ Export): renders the sequence frame by frame with exactly seeked
// sources (scene/frames.js), encodes with WebCodecs and writes the container itself (scene/mux.js). Nothing leaves
// the device and no helper program is needed.
//
//   exportSupport() → Promise<{ mp4, webm, aac, opus, gif, wav, frames, reason }>     what this browser can encode
//   exportScene(store, model, { format, scale, fps, bitrate, audioBitrate, range, onProgress, signal }) → { bytes, mime, ext, notes }
//     format: "mp4" (H.264 + AAC, or Opus where AAC cannot be encoded) | "webm" (VP9 or VP8 + Opus) | "gif" |
//             "frames" (PNG sequence in a ZIP) | "wav" (sound only) | "png" (the frame at range.in)
// Invariants: the export never changes the document; `signal` aborts between frames and releases the encoders; a
// frame that fails to render aborts the export with the frame's time in the message (never a silent black frame).
// Limits: export speed is bounded by seeking the sources (about real time for HD); frame rates above the
// sequence's are not interpolated.
import { duration } from "./model.js";
import { createExactRenderer } from "./frames.js";
import { renderAudio, encodeWav } from "./audio.js";
import { muxMp4, muxWebm } from "./mux.js";

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** H.264 codec string for a frame size: High profile at the lowest level that fits. */
export function avcCodec(w, h, fps) {
  const mbps = Math.ceil(w / 16) * Math.ceil(h / 16) * fps;
  const level = mbps <= 40500 ? 0x1e : mbps <= 108000 ? 0x1f : mbps <= 245760 ? 0x28 : mbps <= 589824 ? 0x32 : mbps <= 983040 ? 0x33 : 0x34;
  return `avc1.6400${level.toString(16)}`;
}

/** A sensible video bit rate (bits per second) for a frame size, frame rate and quality 0..1. */
export function defaultBitrate(w, h, fps, quality = 0.7) {
  return Math.round(w * h * fps * (0.04 + quality * 0.12));
}

async function videoConfig(format, w, h, fps, bitrate) {
  if (typeof VideoEncoder !== "function") return null;
  const tries = format === "mp4"
    ? [{ codec: avcCodec(w, h, fps), avc: { format: "avc" } }, { codec: "avc1.42001f", avc: { format: "avc" } }]
    : [{ codec: "vp09.00.40.08" }, { codec: "vp8" }];
  for (const c of tries) {
    const cfg = { ...c, width: w, height: h, bitrate, framerate: fps, latencyMode: "quality" };
    try {
      if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
    } catch {
      /* try the next codec */
    }
  }
  return null;
}

async function audioConfig(format, sampleRate, bitrate) {
  if (typeof AudioEncoder !== "function") return null;
  const tries = format === "mp4" ? ["mp4a.40.2", "opus"] : ["opus"];
  for (const codec of tries) {
    const cfg = { codec, sampleRate, numberOfChannels: 2, bitrate };
    try {
      if ((await AudioEncoder.isConfigSupported(cfg)).supported) return cfg;
    } catch {
      /* try the next codec */
    }
  }
  return null;
}

export async function exportSupport() {
  const [mp4, webm, aac, opus] = await Promise.all([videoConfig("mp4", 1280, 720, 30, 4e6), videoConfig("webm", 1280, 720, 30, 4e6), audioConfig("mp4", 48000, 128000), audioConfig("webm", 48000, 128000)]);
  return {
    mp4: !!mp4,
    webm: !!webm,
    aac: aac?.codec === "mp4a.40.2",
    opus: !!opus,
    gif: true,
    frames: true,
    wav: true,
    reason: !mp4 && !webm ? "This browser has no video encoder (WebCodecs). GIF, PNG frames and WAV still work; use the desktop app or a Chromium-based browser for MP4 and WebM." : "",
  };
}

const aborted = (signal) => {
  if (signal?.aborted) throw new DOMException("Export cancelled.", "AbortError");
};

async function encodeAudio(buffer, cfg, signal) {
  const samples = [];
  let description = null;
  let error = null;
  const enc = new AudioEncoder({
    output(chunk, meta) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (meta?.decoderConfig?.description) description = new Uint8Array(meta.decoderConfig.description.buffer ? meta.decoderConfig.description.buffer.slice(meta.decoderConfig.description.byteOffset || 0, (meta.decoderConfig.description.byteOffset || 0) + meta.decoderConfig.description.byteLength) : meta.decoderConfig.description);
      samples.push({ data, ts: chunk.timestamp, dur: chunk.duration || 0, key: true });
    },
    error: (e) => (error = e),
  });
  enc.configure(cfg);
  const rate = buffer.sampleRate;
  const block = rate; // one second per AudioData
  const ch = [buffer.getChannelData(0), buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)];
  for (let i = 0; i < buffer.length; i += block) {
    aborted(signal);
    if (error) throw error;
    const n = Math.min(block, buffer.length - i);
    const planar = new Float32Array(n * 2);
    planar.set(ch[0].subarray(i, i + n), 0);
    planar.set(ch[1].subarray(i, i + n), n);
    const ad = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / rate) * 1e6), data: planar });
    enc.encode(ad);
    ad.close();
    if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
  }
  await enc.flush();
  enc.close();
  if (error) throw error;
  return { codec: cfg.codec, sampleRate: rate, channels: 2, description, samples };
}

const silent = (buffer) => {
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i += 97) if (d[i] !== 0) return false;
  }
  return true;
};

export async function exportScene(store, model, opts = {}) {
  const { format = "mp4", onProgress = () => {}, signal = null } = opts;
  const total = duration(model);
  const from = Math.max(0, opts.range?.in ?? 0);
  const to = Math.min(total, opts.range?.out ?? total);
  if (!(to > from) && format !== "png") throw new Error("There is nothing to export: the sequence is empty.");
  const scale = Math.max(0.05, Math.min(4, opts.scale || 1));
  const fps = Math.max(1, Math.min(model.fps, opts.fps || model.fps));
  const notes = [];
  const renderer = createExactRenderer(store);
  const frameCount = Math.max(1, Math.round((to - from) * fps));
  const frameAt = async (i) => {
    const t = from + i / fps;
    try {
      return await renderer.render(model, t, { scale: opts.renderScale || scale, gpu: opts.gpu });
    } catch (err) {
      throw new Error(`Frame at ${t.toFixed(2)} s could not be rendered: ${err.message}`);
    }
  };

  if (format === "png") {
    const cv = await frameAt(0);
    const blob = cv.convertToBlob ? await cv.convertToBlob({ type: "image/png" }) : await new Promise((r) => cv.toBlob(r, "image/png"));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/png", ext: "png", notes };
  }

  if (format === "wav") {
    const buf = await renderAudio(model, store, { from, to });
    onProgress(1);
    return { bytes: encodeWav(buf), mime: "audio/wav", ext: "wav", notes };
  }

  if (format === "gif") {
    const { createGifEncoder } = await import("./gif.js");
    const gfps = Math.min(fps, opts.fps || 15);
    const n = Math.max(1, Math.round((to - from) * gfps));
    let gif = null;
    for (let i = 0; i < n; i++) {
      aborted(signal);
      const cv = await renderer.render(model, from + i / gfps, { scale });
      gif ||= createGifEncoder(cv.width, cv.height, { fps: gfps });
      gif.add(cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data);
      onProgress((i + 1) / n);
    }
    notes.push("GIF has 256 colors and no sound.");
    return { bytes: gif.finish(), mime: "image/gif", ext: "gif", notes };
  }

  if (format === "frames") {
    const { zipSync } = await import("../../vendor/fflate/fflate.js");
    const files = {};
    const pad = String(frameCount).length;
    for (let i = 0; i < frameCount; i++) {
      aborted(signal);
      const cv = await frameAt(i);
      const blob = cv.convertToBlob ? await cv.convertToBlob({ type: "image/png" }) : await new Promise((r) => cv.toBlob(r, "image/png"));
      files[`frame_${String(i + 1).padStart(pad, "0")}.png`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
      onProgress((i + 1) / frameCount);
    }
    return { bytes: zipSync(files), mime: "application/zip", ext: "zip", notes };
  }

  // ---- video: MP4 or WebM
  const w = even(model.width * scale);
  const h = even(model.height * scale);
  const renderScale = w / model.width; // even sizes: render at exactly the encoded width
  const bitrate = opts.bitrate || defaultBitrate(w, h, fps, opts.quality ?? 0.7);
  const vcfg = await videoConfig(format, w, h, fps, bitrate);
  if (!vcfg) throw new Error(`This browser cannot encode ${format === "mp4" ? "MP4 (H.264)" : "WebM (VP9 / VP8)"} at ${w} × ${h}. Try the other format, a smaller size, or the desktop app.`);
  const video = { codec: vcfg.codec, width: w, height: h, description: null, samples: [] };
  let vError = null;
  const venc = new VideoEncoder({
    output(chunk, meta) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const d = meta?.decoderConfig?.description;
      if (d && !video.description) video.description = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset || 0, (d.byteOffset || 0) + d.byteLength) : d);
      video.samples.push({ data, ts: chunk.timestamp, dur: chunk.duration || Math.round(1e6 / fps), key: chunk.type === "key" });
    },
    error: (e) => (vError = e),
  });
  venc.configure(vcfg);
  let audio = null;
  try {
    const gop = Math.max(1, Math.round(fps * 2));
    for (let i = 0; i < frameCount; i++) {
      aborted(signal);
      if (vError) throw vError;
      const t = from + i / fps;
      let cv;
      try {
        cv = await renderer.render(model, t, { scale: renderScale, gpu: opts.gpu });
      } catch (err) {
        throw new Error(`Frame at ${t.toFixed(2)} s could not be rendered: ${err.message}`);
      }
      // the canvas may be one pixel off the even encoder size: VideoFrame scales it
      const vf = new VideoFrame(cv, { timestamp: Math.round((i / fps) * 1e6), duration: Math.round(1e6 / fps), ...(cv.width !== w || cv.height !== h ? { displayWidth: w, displayHeight: h } : {}) });
      venc.encode(vf, { keyFrame: i % gop === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
      onProgress(((i + 1) / frameCount) * 0.92);
    }
    await venc.flush();
    if (vError) throw vError;
    // ---- sound
    if (opts.audio !== false) {
      const buf = await renderAudio(model, store, { from, to });
      if (!silent(buf)) {
        const acfg = await audioConfig(format, buf.sampleRate, opts.audioBitrate || 160000);
        if (acfg) {
          audio = await encodeAudio(buf, acfg, signal);
          if (format === "mp4" && acfg.codec === "opus") notes.push("This browser cannot encode AAC, so the sound is Opus. QuickTime and some phones do not play Opus in MP4; VLC, Chrome and Firefox do.");
        } else notes.push("This browser cannot encode sound for this format; the video was exported without sound.");
      }
    }
  } finally {
    if (venc.state !== "closed") venc.close();
  }
  onProgress(0.97);
  if (format === "mp4" && !video.description) throw new Error("The H.264 encoder returned no configuration record.");
  const bytes = format === "mp4" ? muxMp4({ video, audio }) : muxWebm({ video, audio });
  onProgress(1);
  return { bytes, mime: format === "mp4" ? "video/mp4" : "video/webm", ext: format, notes, width: w, height: h, fps, codec: vcfg.codec, audioCodec: audio?.codec || null };
}
