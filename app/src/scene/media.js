// Scene Studio media store (docs/scene-studio.md ▸ Media): everything that turns the bytes of a media item into
// something drawable or audible. One store per open scene document; nothing here is saved.
//
//   probeMedia(bytes, name, mime)        → { kind, mime, name, duration, w, h, hasAudio, bytes }   (import)
//   createMediaStore(getModel, onReady)  → store
//     store.source(mediaId, time, clip)  → <video> | ImageBitmap | null   the compositor's provider (viewer)
//     store.setPlaying(playing, rate)    video elements follow the transport; time-remapped clips play from a cache
//                                        of decoded frames around the playhead (filled ahead in the playing direction)
//     store.frameAt(mediaId, time, { fast }) → Promise<CanvasImageSource|null>   frame-accurate (export, analysis,
//                                        tools); `fast` decodes sequentially with WebCodecs (scene/decode.js) where it can
//     store.releaseReaders()             closes the export's decoders
//     store.audio(mediaId)               → Promise<AudioBuffer|null>         decoded once, cached
//     store.peaks(mediaId)               → Promise<{ rate, data: Float32Array }|null>   waveform (100 values / s)
//     store.thumb(mediaId, time, h)      → canvas | null (returns null and calls onReady when it becomes available)
//     store.prune(liveClipIds), store.forget(mediaId), store.destroy()     release what is no longer needed
// Invariants: a source that is not ready returns null (the compositor skips the layer) and onReady() is called when
// it is, so the viewer repaints; object URLs are revoked by destroy(); decoding never blocks the UI thread longer
// than one frame (elements and the browser's decoders do the work). An item without bytes (referenced media that
// is offline or not read yet, scene/media-refs.js) is treated as not ready, and nothing is cached for it.

import { createFrameReader, planPrefetch } from "./decode.js";

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|weba)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
const MIME = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", ogv: "video/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", weba: "audio/webm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp" };

export const SCENE_MEDIA_ACCEPT = "video/*,audio/*,image/*,.mkv,.mov,.srt,.vtt";

/** "video" | "audio" | "image" | null from a MIME type or a file name. */
export function mediaKind(name, mime = "") {
  if (/^video\//.test(mime) || VIDEO_EXT.test(name)) return "video";
  if (/^audio\//.test(mime) || AUDIO_EXT.test(name)) return "audio";
  if (/^image\//.test(mime) || IMAGE_EXT.test(name)) return "image";
  return null;
}
export const mimeOf = (name, mime = "") => mime || MIME[String(name).split(".").pop().toLowerCase()] || "application/octet-stream";

const once = (el, ok, fail, ms = 15000) =>
  new Promise((resolve, reject) => {
    const done = (fn, v) => {
      clearTimeout(timer);
      el.removeEventListener(ok, onOk);
      el.removeEventListener(fail, onFail);
      fn(v);
    };
    const onOk = () => done(resolve);
    const onFail = () => done(reject, new Error(el.error?.message || "The browser cannot decode this file."));
    const timer = setTimeout(() => done(reject, new Error("Timed out while reading the file.")), ms);
    el.addEventListener(ok, onOk);
    el.addEventListener(fail, onFail);
  });

/** Reads what the timeline needs to know about a file. Throws a readable error when the browser cannot decode it. */
export async function probeMedia(bytes, name, mime = "") {
  const kind = mediaKind(name, mime);
  if (!kind) throw new Error(`“${name}” is not a video, audio or image file.`);
  const type = mimeOf(name, mime);
  const item = { kind, mime: type, name, duration: 0, w: 0, h: 0, hasAudio: kind === "audio", bytes };
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  let el = null;
  try {
    if (kind === "image") {
      const img = new Image();
      img.src = url;
      await img.decode();
      item.w = img.naturalWidth || 1024;
      item.h = img.naturalHeight || 1024;
    } else {
      el = document.createElement(kind);
      el.preload = "metadata";
      el.muted = true;
      el.src = url;
      await once(el, "loadedmetadata", "error");
      if (!Number.isFinite(el.duration)) {
        // files without a duration in the header (some WebM recordings): seeking to the end reveals it
        el.currentTime = 1e7;
        await once(el, "seeked", "error").catch(() => {});
      }
      item.duration = Number.isFinite(el.duration) ? el.duration : 0;
      if (kind === "video") {
        item.w = el.videoWidth;
        item.h = el.videoHeight;
        if (!item.w) throw new Error(`“${name}” has no picture this browser can decode.`);
        item.hasAudio = el.mozHasAudio ?? (el.audioTracks ? el.audioTracks.length > 0 : true); // refined when the sound is decoded
      }
    }
  } finally {
    // also on a decode error or timeout: a probe element left with its source keeps a decoder alive
    if (el) {
      el.removeAttribute("src");
      el.load();
    }
    URL.revokeObjectURL(url);
  }
  return item;
}

export function createMediaStore(getModel, onReady = () => {}) {
  const urls = new Map(); // media id → object URL
  const images = new Map(); // media id → ImageBitmap | "loading" | "failed"
  const videos = new Map(); // clip id → { el, media }
  const exact = new Map(); // media id → { el, chain } for frameAt
  const buffers = new Map(); // media id → Promise<AudioBuffer|null>
  const peakCache = new Map();
  const thumbs = new Map(); // "id@t@h" → canvas | "loading"
  const readers = new Map(); // media id → { p: Promise<reader|null>, r } sequential decoders of the export
  const cacheReaders = new Map(); // media id → the same, for the playback cache of time-remapped clips
  const caches = new Map(); // media id → { frames: Map<µs, ImageBitmap>, busy, last, dir, used }
  let playing = false;
  let rate = 1;
  let dead = false;
  let actx = null;

  const urlOf = (id) => {
    if (!urls.has(id)) {
      const md = getModel().media[id];
      if (!md?.bytes) return null;
      urls.set(id, URL.createObjectURL(new Blob([md.bytes], { type: md.mime })));
    }
    return urls.get(id);
  };

  function image(id) {
    const got = images.get(id);
    if (got) return typeof got === "string" ? null : got;
    const md = getModel().media[id];
    if (!md?.bytes) return null;
    images.set(id, "loading");
    const load = md.mime === "image/svg+xml"
      ? new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("svg"));
          img.src = urlOf(id);
        })
      : createImageBitmap(new Blob([md.bytes], { type: md.mime }));
    load.then((bmp) => {
      if (dead || images.get(id) !== "loading") return bmp.close?.(); // destroyed, or the item was pruned meanwhile
      images.set(id, bmp);
      onReady();
    }).catch(() => images.set(id, "failed"));
    return null;
  }

  function makeVideo(id) {
    const el = document.createElement("video");
    el.muted = true; // sound comes from the audio engine (decoded buffers), so picture and sound share one clock
    el.playsInline = true;
    el.preload = "auto";
    el.src = urlOf(id);
    return el;
  }

  function video(id, time, clip) {
    const key = clip?.id || id;
    let v = videos.get(key);
    if (!v || v.media !== id) {
      if (!urlOf(id)) return null;
      v = { el: makeVideo(id), media: id };
      const repaint = () => !dead && onReady();
      v.el.addEventListener("seeked", repaint);
      v.el.addEventListener("loadeddata", repaint);
      videos.set(key, v);
    }
    const el = v.el;
    const want = Math.max(0, Math.min(time, (el.duration || Infinity) - 0.001));
    const speed = (clip?.speed || 1) * rate;
    v.used = performance.now();
    // a time-remapped clip (reverse, freeze, speed ramp) cannot simply play: while playing, its frames come from the
    // decoded-frame cache around the playhead; until a frame is there, the element is seeked as before
    if (playing && clip?.remap !== undefined) {
      const bmp = remapFrame(id, want);
      if (bmp) {
        if (!el.paused) el.pause();
        return bmp;
      }
    }
    if (playing && clip?.remap === undefined) {
      if (el.playbackRate !== speed) el.playbackRate = Math.max(0.0625, Math.min(16, speed));
      if (el.paused) {
        el.currentTime = want;
        el.play().catch(() => {});
      } else if (Math.abs(el.currentTime - want) > 0.12 * Math.max(1, speed)) el.currentTime = want; // drifted: resync
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - want) > 0.004 && !el.seeking) el.currentTime = want;
    }
    v.used = performance.now();
    return el.readyState >= 2 ? el : null;
  }

  // ---- sequential decoding (scene/decode.js): one WebCodecs reader per media item, opened on first use; null when
  // the browser or the file does not allow it (the element is seeked instead)
  const readerOf = (map, id) => {
    let r = map.get(id);
    if (!r) {
      const md = getModel().media[id];
      r = { p: md?.bytes ? createFrameReader(md.bytes, md.mime).catch(() => null) : Promise.resolve(null), r: undefined };
      r.p.then((x) => {
        r.r = x;
        if (dead || map.get(id) !== r) x?.close();
      });
      map.set(id, r);
    }
    return r;
  };

  // decoded-frame cache of time-remapped clips while playing: every frame a decode run passes is kept (scaled to
  // preview size), so a reversed clip decodes each group of pictures once instead of seeking for every frame
  const CACHE_FRAMES = 120;
  const CACHE_WIDTH = 640;
  function remapFrame(id, time) {
    const md = getModel().media[id];
    const c = caches.get(id) || { frames: new Map(), failed: new Set(), busy: false, last: null, dir: 0, used: 0 };
    if (!caches.has(id)) caches.set(id, c);
    const rd = readerOf(cacheReaders, id);
    const reader = rd.r;
    if (!reader || reader.closed) {
      if (rd.r === undefined) rd.p.then(() => !dead && onReady());
      return null;
    }
    const now = performance.now();
    if (c.last && now - c.last.at < 300 && Math.abs(time - c.last.time) > 1e-5) c.dir = Math.sign(time - c.last.time);
    else if (!c.last || now - c.last.at >= 300) c.dir = 0;
    c.last = { time, at: now };
    c.used = now;
    const ts = reader.timeOf(time);
    pump(id, c, reader, md);
    return c.frames.get(ts) || null;
  }
  function pump(id, c, reader, md) {
    if (c.busy || dead || !playing) return;
    const plan = planPrefetch(reader.times, c.last.time, c.dir, 1);
    const idx = plan.find((i) => !c.frames.has(reader.times[i]) && !c.failed.has(reader.times[i]));
    if (idx === undefined) return;
    c.busy = true;
    const scale = Math.min(1, CACHE_WIDTH / Math.max(1, md.w || CACHE_WIDTH));
    const opts = scale < 1 ? { resizeWidth: Math.max(1, Math.round(md.w * scale)), resizeHeight: Math.max(1, Math.round(md.h * scale)), resizeQuality: "medium" } : {};
    const jobs = [];
    const keep = (frame) => {
      const ts = frame.timestamp;
      if (c.frames.has(ts)) return frame.close();
      jobs.push(createImageBitmap(frame, opts).then((b) => {
        if (dead || caches.get(id) !== c) return b.close();
        c.frames.set(ts, b);
        trimCache(c, reader);
      }, () => {}).finally(() => frame.close()));
    };
    const want = reader.times[idx];
    reader.frameAt(want / 1e6, { keep })
      .then(() => Promise.all(jobs))
      .then(() => !c.frames.has(want) && c.failed.add(want)) // never ask for a frame the decoder did not give twice
      .catch(() => {})
      .finally(() => {
        c.busy = false;
        if (!dead) {
          onReady();
          if (playing) setTimeout(() => pump(id, c, reader, md), 0);
        }
      });
  }
  function trimCache(c, reader) {
    if (c.frames.size <= CACHE_FRAMES) return;
    const at = reader.timeOf(c.last?.time || 0);
    // drop the frames farthest from the playhead, but keep the ones ahead of it in the playing direction
    const order = [...c.frames.keys()].sort((a, b) => {
      const da = (a - at) * (c.dir || 1) < 0 ? Math.abs(a - at) * 4 : Math.abs(a - at);
      const db = (b - at) * (c.dir || 1) < 0 ? Math.abs(b - at) * 4 : Math.abs(b - at);
      return db - da;
    });
    for (const ts of order.slice(0, c.frames.size - CACHE_FRAMES)) {
      c.frames.get(ts).close?.();
      c.frames.delete(ts);
    }
  }
  function dropCache(id) {
    const c = caches.get(id);
    if (c) for (const b of c.frames.values()) b.close?.();
    caches.delete(id);
    const r = cacheReaders.get(id);
    r?.r?.close();
    cacheReaders.delete(id);
  }

  // one hidden element per media item for frame-accurate reads; requests are serialized. `fast`: decode the file
  // sequentially with WebCodecs where it can (the export: frames are asked for in increasing time)
  function frameAt(id, time, { fast = false } = {}) {
    const md = getModel().media[id];
    if (!md) return Promise.resolve(null);
    if (fast && md.kind === "video" && md.bytes) {
      const rd = readerOf(readers, id);
      return rd.p.then(async (reader) => {
        if (reader && !reader.closed) {
          try {
            const f = await reader.frameAt(Math.max(0, Math.min(time, (md.duration || time + 1) - 0.001)));
            if (f) return f;
          } catch {
            /* the decoder failed on this file: seek instead from now on */
          }
        }
        return frameAt(id, time);
      });
    }
    if (md.kind === "image") {
      const got = images.get(id);
      if (got && typeof got !== "string") return Promise.resolve(got);
      image(id);
      return new Promise((resolve) => {
        const poll = () => {
          const g = images.get(id);
          if (g === "failed" || dead) resolve(null);
          else if (g && g !== "loading") resolve(g);
          else setTimeout(poll, 20);
        };
        poll();
      });
    }
    let x = exact.get(id);
    if (!x) {
      if (!urlOf(id)) return Promise.resolve(null);
      x = { el: makeVideo(id), chain: Promise.resolve() };
      exact.set(id, x);
    }
    const run = async () => {
      const el = x.el;
      if (el.readyState < 1) await once(el, "loadedmetadata", "error");
      const want = Math.max(0, Math.min(time, (el.duration || time) - 0.001));
      if (Math.abs(el.currentTime - want) > 0.0005 || el.readyState < 2) {
        el.currentTime = want;
        await once(el, "seeked", "error", 20000);
      }
      if (el.readyState < 2) await once(el, "loadeddata", "error").catch(() => {});
      return el;
    };
    const p = x.chain.then(run, run);
    x.chain = p.catch(() => {});
    return p.catch(() => null);
  }

  function audio(id) {
    if (buffers.has(id)) return buffers.get(id);
    const md = getModel().media[id];
    if (md && !md.bytes) return Promise.resolve(null); // referenced media not read yet (or offline): try again later
    const p = (async () => {
      if (!md?.bytes || md.kind === "image" || md.bytes.length > 600e6) return null;
      try {
        actx ||= new (globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext)(2, 1, 48000);
        return await actx.decodeAudioData(md.bytes.slice().buffer);
      } catch {
        return null; // no sound track, or a codec the browser cannot decode
      }
    })();
    buffers.set(id, p);
    return p;
  }

  function peaks(id) {
    if (getModel().media[id] && !getModel().media[id].bytes) return Promise.resolve(null);
    if (!peakCache.has(id)) {
      peakCache.set(id, audio(id).then((buf) => {
        if (!buf) return null;
        const per = 100;
        const n = Math.ceil(buf.duration * per);
        const data = new Float32Array(n);
        const step = buf.sampleRate / per;
        for (let ch = 0; ch < Math.min(2, buf.numberOfChannels); ch++) {
          const d = buf.getChannelData(ch);
          for (let i = 0; i < n; i++) {
            let mx = 0;
            const end = Math.min(d.length, Math.floor((i + 1) * step));
            for (let j = Math.floor(i * step); j < end; j += 4) {
              const a = d[j] < 0 ? -d[j] : d[j];
              if (a > mx) mx = a;
            }
            if (mx > data[i]) data[i] = mx;
          }
        }
        return { rate: per, data };
      }));
    }
    return peakCache.get(id);
  }

  function thumb(id, time, h = 40) {
    const md = getModel().media[id];
    if (!md || md.kind === "audio") return null;
    const t = md.kind === "image" ? 0 : Math.round(time * 2) / 2;
    const key = `${id}@${t}@${h}`;
    const got = thumbs.get(key);
    if (got) return got === "loading" ? null : got;
    thumbs.set(key, "loading");
    frameAt(id, t).then((src) => {
      if (!src || dead) return thumbs.delete(key);
      const w = Math.max(1, Math.round((h * md.w) / (md.h || 1)));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(src, 0, 0, w, h);
      thumbs.set(key, c);
      if (thumbs.size > 600) thumbs.delete(thumbs.keys().next().value);
      onReady("thumb");
    });
    return null;
  }

  function release(id) {
    dropCache(id);
    readers.get(id)?.r?.close();
    readers.delete(id);
    const x = exact.get(id);
    if (x) {
      x.el.pause();
      x.el.removeAttribute("src");
      x.el.load();
      exact.delete(id);
    }
    const b = images.get(id);
    if (b && typeof b !== "string") b.close?.();
    images.delete(id);
    if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
    urls.delete(id);
    buffers.delete(id);
    peakCache.delete(id);
    for (const k of thumbs.keys()) if (k.startsWith(`${id}@`)) thumbs.delete(k);
  }

  return {
    source(id, time, clip) {
      const md = getModel().media[id];
      if (!md) return null;
      return md.kind === "image" ? image(id) : md.kind === "video" ? video(id, time, clip) : null;
    },
    setPlaying(on, playRate = 1) {
      playing = on;
      rate = playRate;
      if (!on) for (const v of videos.values()) if (!v.el.paused) v.el.pause();
    },
    /**
     * Drops video elements of clips that no longer exist or were not drawn for a while (called by the viewer), and
     * everything held for media items that left the bin: object URLs (each a full copy of the file), decoded images,
     * frame-reader elements, decoded sound and peaks. Undo brings an item back and it loads again on demand.
     */
    prune(liveClipIds) {
      const now = performance.now();
      for (const [key, v] of videos) {
        if (!liveClipIds.has(key) || (videos.size > 12 && now - (v.used || 0) > 20000)) {
          v.el.pause();
          v.el.removeAttribute("src");
          v.el.load();
          videos.delete(key);
        }
      }
      const media = getModel()?.media || {};
      for (const id of new Set([...urls.keys(), ...images.keys(), ...exact.keys(), ...buffers.keys(), ...peakCache.keys(), ...caches.keys(), ...readers.keys()])) if (!media[id]) release(id);
      for (const [id, c] of caches) if (!playing && now - c.used > 20000) dropCache(id); // the cache serves playback only
    },
    /** Closes the sequential decoders of the export (call when it is done; they reopen on demand). */
    releaseReaders() {
      for (const r of readers.values()) r.r?.close();
      readers.clear();
    },
    /** Drops everything held for one media item (its file changed: Relink); it loads again on demand. */
    forget(id) {
      for (const [key, v] of videos) {
        if (v.media !== id) continue;
        v.el.pause();
        v.el.removeAttribute("src");
        v.el.load();
        videos.delete(key);
      }
      release(id);
    },
    frameAt,
    audio,
    peaks,
    thumb,
    url: urlOf,
    destroy() {
      dead = true;
      for (const id of [...caches.keys(), ...cacheReaders.keys()]) dropCache(id);
      for (const r of readers.values()) r.r?.close();
      readers.clear();
      for (const v of [...videos.values(), ...exact.values()]) {
        v.el.pause();
        v.el.removeAttribute("src");
        v.el.load();
      }
      for (const b of images.values()) if (typeof b !== "string") b.close?.();
      for (const u of urls.values()) URL.revokeObjectURL(u);
      videos.clear();
      exact.clear();
      images.clear();
      urls.clear();
      buffers.clear();
      peakCache.clear();
      thumbs.clear();
    },
  };
}
