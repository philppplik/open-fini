// Scene Studio container writers (clean-room, from ISO/IEC 14496-12 / -14 / -15 and the Matroska / WebM
// specifications): the encoded chunks of WebCodecs go into an MP4 or a WebM file. Pure (no DOM); unit-tested in
// tests/scene/mux.test.js by reading the boxes / elements back.
//
//   muxMp4({ video, audio })  → Uint8Array      muxWebm({ video, audio }) → Uint8Array
//   track: { codec, width, height (video) | sampleRate, channels (audio), description (Uint8Array: avcC record,
//            AudioSpecificConfig or OpusHead), samples: [{ data: Uint8Array, ts, dur (microseconds), key }] }
// MP4 video = H.264 ("avc1…", samples in AVCC format), audio = AAC ("mp4a.40.2") or Opus. WebM video = VP8 / VP9 /
// AV1, audio = Opus. Limits: files up to 4 GiB (32-bit chunk offsets), one video and one audio track, no B-frame
// reordering (WebCodecs encoders are configured for none).

const cat = (parts) => {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u8 = (...v) => new Uint8Array(v);
const u16 = (v) => u8((v >> 8) & 255, v & 255);
const u32 = (v) => u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const str = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const zeros = (n) => new Uint8Array(n);

// ---------------------------------------------------------------------------------------------- MP4

const box = (type, ...payload) => {
  const body = cat(payload);
  return cat([u32(body.length + 8), str(type), body]);
};
const full = (type, version, flags, ...payload) => box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...payload);
const MATRIX = cat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);

function esds(config, bitrate = 128000) {
  // ES_Descriptor > DecoderConfigDescriptor > DecoderSpecificInfo (the AudioSpecificConfig), SLConfigDescriptor
  const dsi = cat([u8(0x05, config.length), config]);
  const dcd = cat([u8(0x04, 13 + dsi.length, 0x40, 0x15, 0, 0, 0), u32(bitrate), u32(bitrate), dsi]);
  const es = cat([u8(0x03, 3 + dcd.length + 3), u16(1), u8(0), dcd, u8(0x06, 1, 2)]);
  return full("esds", 0, 0, es);
}

function sampleEntry(tk) {
  if (tk.kind === "video") {
    const avcC = box("avcC", tk.description);
    return box("avc1", zeros(6), u16(1), zeros(16), u16(tk.width), u16(tk.height), u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(24), u16(0xffff), avcC);
  }
  const head = cat([zeros(6), u16(1), zeros(8), u16(tk.channels), u16(16), u32(0), u32((tk.sampleRate << 16) >>> 0)]);
  if (/^opus/i.test(tk.codec)) {
    // dOps: version, channels, pre-skip, input sample rate, output gain, mapping family
    const d = tk.description && tk.description.length >= 19 ? tk.description : null;
    const preSkip = d ? d[10] | (d[11] << 8) : 312;
    return box("Opus", head, box("dOps", u8(0, tk.channels), u16(preSkip), u32(tk.sampleRate), u16(0), u8(0)));
  }
  return box("mp4a", head, esds(tk.description || u8(0x11, 0x90)));
}

function trak(tk, id, offsets, movieScale) {
  const scale = tk.kind === "video" ? 90000 : tk.sampleRate;
  const toScale = (us) => Math.round((us * scale) / 1e6);
  const n = tk.samples.length;
  // decode deltas from the timestamps, so variable frame times survive
  const deltas = tk.samples.map((s, i) => (i + 1 < n ? toScale(tk.samples[i + 1].ts) - toScale(s.ts) : toScale(s.dur || 0) || 1));
  const stts = [];
  for (const d of deltas) {
    const last = stts[stts.length - 1];
    if (last && last[1] === d) last[0]++;
    else stts.push([1, d]);
  }
  const duration = deltas.reduce((a, b) => a + b, 0);
  const keys = tk.samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
  const stbl = box("stbl",
    full("stsd", 0, 0, u32(1), sampleEntry(tk)),
    full("stts", 0, 0, u32(stts.length), ...stts.map(([c, d]) => cat([u32(c), u32(d)]))),
    ...(tk.kind === "video" && keys.length < n ? [full("stss", 0, 0, u32(keys.length), ...keys.map(u32))] : []),
    full("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1)), // one sample per chunk
    full("stsz", 0, 0, u32(0), u32(n), ...tk.samples.map((s) => u32(s.data.length))),
    full("stco", 0, 0, u32(n), ...offsets.map(u32)));
  const minf = box("minf",
    tk.kind === "video" ? full("vmhd", 0, 1, zeros(8)) : full("smhd", 0, 0, zeros(4)),
    box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
    stbl);
  const mdia = box("mdia",
    full("mdhd", 0, 0, u32(0), u32(0), u32(scale), u32(duration), u16(0x55c4), u16(0)),
    full("hdlr", 0, 0, u32(0), str(tk.kind === "video" ? "vide" : "soun"), zeros(12), str(tk.kind === "video" ? "OpenFini Video\0" : "OpenFini Audio\0")),
    minf);
  const movieDur = Math.round((duration / scale) * movieScale);
  const tkhd = full("tkhd", 0, 3, u32(0), u32(0), u32(id), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(tk.kind === "audio" ? 0x0100 : 0), u16(0), MATRIX, u32((tk.width || 0) << 16), u32((tk.height || 0) << 16));
  return { box: box("trak", tkhd, mdia), movieDur };
}

export function muxMp4({ video = null, audio = null }) {
  const tracks = [video && { ...video, kind: "video" }, audio && { ...audio, kind: "audio" }].filter((t) => t && t.samples.length);
  if (!tracks.length) throw new Error("Nothing to write: no encoded samples.");
  const ftyp = box("ftyp", str("isom"), u32(0x200), str("isom"), str("iso2"), str("avc1"), str("mp41"));
  // interleave the samples by time so players do not have to seek between the tracks
  const order = [];
  tracks.forEach((tk, ti) => tk.samples.forEach((s, si) => order.push({ ti, si, ts: s.ts })));
  order.sort((a, b) => a.ts - b.ts || a.ti - b.ti);
  const offsets = tracks.map((tk) => new Array(tk.samples.length));
  let pos = ftyp.length + 8;
  const data = [];
  for (const o of order) {
    const s = tracks[o.ti].samples[o.si];
    offsets[o.ti][o.si] = pos;
    pos += s.data.length;
    data.push(s.data);
  }
  if (pos > 0xffffffff) throw new Error("The video is larger than 4 GB. Export a shorter range or a lower quality.");
  const mdat = cat([u32(pos - ftyp.length), str("mdat"), ...data]);
  const movieScale = 1000;
  const traks = tracks.map((tk, i) => trak(tk, i + 1, offsets[i], movieScale));
  const mvhd = full("mvhd", 0, 0, u32(0), u32(0), u32(movieScale), u32(Math.max(...traks.map((t) => t.movieDur))), u32(0x10000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(tracks.length + 1));
  return cat([ftyp, mdat, box("moov", mvhd, ...traks.map((t) => t.box))]);
}

// ---------------------------------------------------------------------------------------------- WebM

// EBML variable-length size
function vint(n) {
  if (n < 0x7f) return u8(0x80 | n);
  if (n < 0x3fff) return u8(0x40 | (n >> 8), n & 255);
  if (n < 0x1fffff) return u8(0x20 | (n >> 16), (n >> 8) & 255, n & 255);
  if (n < 0xfffffff) return u8(0x10 | (n >>> 24), (n >> 16) & 255, (n >> 8) & 255, n & 255);
  const hi = Math.floor(n / 0x100000000);
  return u8(0x01, 0, 0, hi & 255, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
}
const idBytes = (id) => (id > 0xffffff ? u32(id) : id > 0xffff ? u8(id >> 16, (id >> 8) & 255, id & 255) : id > 0xff ? u16(id) : u8(id));
const el = (id, ...payload) => {
  const body = cat(payload);
  return cat([idBytes(id), vint(body.length), body]);
};
const uint = (v) => {
  const out = [];
  let n = Math.max(0, Math.floor(v));
  do {
    out.unshift(n % 256);
    n = Math.floor(n / 256);
  } while (n > 0);
  return new Uint8Array(out);
};
const f64 = (v) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return b;
};

/** A minimal OpusHead (RFC 7845) for encoders that give no description. */
export function opusHead(channels, sampleRate) {
  return cat([str("OpusHead"), u8(1, channels, 0x38, 0x01, sampleRate & 255, (sampleRate >> 8) & 255, (sampleRate >> 16) & 255, (sampleRate >>> 24) & 255, 0, 0, 0)]);
}

export function muxWebm({ video = null, audio = null }) {
  const tracks = [video && { ...video, kind: "video", num: 1 }, audio && { ...audio, kind: "audio", num: video ? 2 : 1 }].filter((t) => t && t.samples.length);
  if (!tracks.length) throw new Error("Nothing to write: no encoded samples.");
  const codecId = (c) => (/^vp8/i.test(c) ? "V_VP8" : /^vp09|^vp9/i.test(c) ? "V_VP9" : /^av01/i.test(c) ? "V_AV1" : "A_OPUS");
  const header = el(0x1a45dfa3, el(0x4286, uint(1)), el(0x42f7, uint(1)), el(0x42f2, uint(4)), el(0x42f3, uint(8)), el(0x4282, str("webm")), el(0x4287, uint(4)), el(0x4285, uint(2)));
  const durMs = Math.max(...tracks.map((t) => {
    const last = t.samples[t.samples.length - 1];
    return (last.ts + (last.dur || 0)) / 1000;
  }));
  const info = el(0x1549a966, el(0x2ad7b1, uint(1000000)), el(0x4d80, str("OpenFini")), el(0x5741, str("OpenFini")), el(0x4489, f64(durMs)));
  const entries = tracks.map((t) => el(0xae,
    el(0xd7, uint(t.num)), el(0x73c5, uint(t.num)), el(0x9c, uint(0)), el(0x83, uint(t.kind === "video" ? 1 : 2)), el(0x86, str(codecId(t.codec))),
    ...(t.kind === "video"
      ? [el(0xe0, el(0xb0, uint(t.width)), el(0xba, uint(t.height)))]
      : [el(0x56aa, uint(6500000)), el(0x56bb, uint(80000000)), el(0x63a2, t.description?.length ? t.description : opusHead(t.channels, t.sampleRate)), el(0xe1, el(0xb5, f64(t.sampleRate)), el(0x9f, uint(t.channels)))])));
  const tracksEl = el(0x1654ae6b, ...entries);
  // clusters: a new one at every video key frame, or every 5 seconds without video
  const all = [];
  for (const t of tracks) for (const s of t.samples) all.push({ num: t.num, video: t.kind === "video", ms: Math.round(s.ts / 1000), key: t.kind === "audio" || s.key, data: s.data });
  all.sort((a, b) => a.ms - b.ms || a.num - b.num);
  const hasVideo = tracks.some((t) => t.kind === "video");
  const clusters = [];
  let cur = null;
  for (const s of all) {
    const startNew = !cur || s.ms - cur.ms > 30000 || (hasVideo ? s.video && s.key && cur.blocks.length : s.ms - cur.ms >= 5000);
    if (startNew) clusters.push((cur = { ms: s.ms, blocks: [], cue: hasVideo ? s.video && s.key : true }));
    const rel = s.ms - cur.ms;
    cur.blocks.push(el(0xa3, vint(s.num), u8((rel >> 8) & 255, rel & 255, s.key ? 0x80 : 0), s.data));
  }
  const clusterEls = clusters.map((c) => el(0x1f43b675, el(0xe7, uint(c.ms)), ...c.blocks));
  // cues point at clusters; their positions are relative to the start of the segment payload
  const cueNum = tracks[0].num;
  const cuesFor = (base) => {
    let pos = base;
    const points = [];
    clusters.forEach((c, i) => {
      if (c.cue) points.push(el(0xbb, el(0xb3, uint(c.ms)), el(0xb7, el(0xf7, uint(cueNum)), el(0xf1, uint(pos)))));
      pos += clusterEls[i].length;
    });
    return el(0x1c53bb6b, ...points);
  };
  // the cue element's own size changes the cluster offsets: iterate until it is stable
  let cues = cuesFor(info.length + tracksEl.length);
  for (let i = 0; i < 4; i++) {
    const next = cuesFor(info.length + tracksEl.length + cues.length);
    if (next.length === cues.length) {
      cues = next;
      break;
    }
    cues = next;
  }
  const body = cat([info, tracksEl, cues, ...clusterEls]);
  return cat([header, idBytes(0x18538067), vint(body.length), body]);
}
