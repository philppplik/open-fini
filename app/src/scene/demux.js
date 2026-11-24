// Scene Studio container readers (clean-room, from ISO/IEC 14496-12 / -15 and the Matroska / WebM specifications):
// the video track of an MP4 / MOV or WebM / MKV file as encoded samples for WebCodecs' VideoDecoder, so the export
// and the playback cache decode a file front to back instead of seeking a <video> element for every frame
// (scene/decode.js). Pure (no DOM); unit-tested in tests/scene/demux.test.js against scene/mux.js output.
//
//   demuxVideo(bytes, mime?) → track | null
//   track: { container: "mp4" | "webm", codec (WebCodecs string), width, height, description (Uint8Array | null),
//            samples: [{ ts, dur, key, offset, size }] in decode order (ts = presentation time in microseconds,
//            offset / size = the sample's bytes in `bytes`), times: sorted presentation times (µs) }
// Returns null for what it does not read (fragmented MP4, laced video blocks, codecs WebCodecs cannot name, damaged
// files): the caller falls back to seeking. Never throws on hostile input; sizes are checked against the buffer.

const u8 = (b, o) => b[o];
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const i32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const hex2 = (v) => v.toString(16).padStart(2, "0");
const MAX_SAMPLES = 2e6;

// ---------------------------------------------------------------------------------------------- MP4

function* boxes(b, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o);
    const type = fourcc(b, o + 4);
    let head = 8;
    if (size === 1) {
      if (o + 16 > end) return;
      size = u64(b, o + 8);
      head = 16;
    } else if (size === 0) size = end - o;
    if (size < head || o + size > end) return;
    yield { type, start: o + head, end: o + size };
    o += size;
  }
}
const child = (b, box, type) => {
  for (const c of boxes(b, box.start, box.end)) if (c.type === type) return c;
  return null;
};
const path = (b, box, ...types) => types.reduce((x, t) => (x ? child(b, x, t) : null), box);

/** WebCodecs codec string of an HEVC configuration record (ISO/IEC 14496-15 annex E). */
export function hevcCodec(prefix, r) {
  if (r.length < 13) return null;
  const space = ["", "A", "B", "C"][r[1] >> 6];
  const tier = (r[1] >> 5) & 1 ? "H" : "L";
  const idc = r[1] & 31;
  let compat = u32(r, 2);
  let rev = 0; // the compatibility flags are written bit-reversed
  for (let i = 0; i < 32; i++) {
    rev = (rev << 1) | (compat & 1);
    compat >>>= 1;
  }
  const cons = [];
  for (let i = 6; i < 12; i++) cons.push(r[i]);
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  return [`${prefix}.${space}${idc}`, (rev >>> 0).toString(16), `${tier}${r[12]}`, ...cons.map((c) => c.toString(16))].join(".");
}

/** WebCodecs codec string of an AV1 configuration record (av1C). */
export function av1Codec(r) {
  if (r.length < 4) return null;
  const profile = r[1] >> 5;
  const level = r[1] & 31;
  const tier = r[2] >> 7 ? "H" : "M";
  const high = (r[2] >> 6) & 1;
  const twelve = (r[2] >> 5) & 1;
  const depth = high ? (twelve ? 12 : 10) : 8;
  return `av01.${profile}.${String(level).padStart(2, "0")}${tier}.${String(depth).padStart(2, "0")}`;
}

function sampleEntry(b, stsd) {
  // stsd: full box header (4), entry count (4), then the entries
  for (const e of boxes(b, stsd.start + 8, stsd.end)) {
    const width = u16(b, e.start + 24);
    const height = u16(b, e.start + 26);
    const kids = [...boxes(b, e.start + 78, e.end)];
    const find = (t) => kids.find((k) => k.type === t);
    const body = (k) => b.slice(k.start, k.end);
    if (e.type === "avc1" || e.type === "avc3") {
      const c = find("avcC");
      if (!c || c.end - c.start < 4) return null;
      return { codec: `${e.type}.${hex2(b[c.start + 1])}${hex2(b[c.start + 2])}${hex2(b[c.start + 3])}`, width, height, description: body(c) };
    }
    if (e.type === "hvc1" || e.type === "hev1") {
      const c = find("hvcC");
      const codec = c && hevcCodec(e.type, body(c));
      return codec ? { codec, width, height, description: body(c) } : null;
    }
    if (e.type === "vp09") {
      const c = find("vpcC"); // full box: version, flags, profile, level, bitDepth (4 bits) …
      if (!c || c.end - c.start < 7) return { codec: "vp09.00.10.08", width, height, description: null };
      return { codec: `vp09.${String(b[c.start + 4]).padStart(2, "0")}.${String(b[c.start + 5]).padStart(2, "0")}.${String(b[c.start + 6] >> 4).padStart(2, "0")}`, width, height, description: null };
    }
    if (e.type === "vp08") return { codec: "vp8", width, height, description: null };
    if (e.type === "av01") {
      const c = find("av1C");
      const codec = c ? av1Codec(body(c)) : null;
      return codec ? { codec, width, height, description: null } : null;
    }
    return null;
  }
  return null;
}

function demuxMp4(b) {
  let moov = null;
  for (const x of boxes(b, 0, b.length)) {
    if (x.type === "moov") moov = x;
    if (x.type === "moof") return null; // fragmented: not read (the element path handles it)
  }
  if (!moov) return null;
  const mvhd = child(b, moov, "mvhd");
  const movieScale = mvhd ? (u8(b, mvhd.start) === 1 ? u32(b, mvhd.start + 20) : u32(b, mvhd.start + 12)) : 1000;
  for (const trak of boxes(b, moov.start, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = child(b, trak, "mdia");
    const hdlr = mdia && child(b, mdia, "hdlr");
    if (!hdlr || fourcc(b, hdlr.start + 8) !== "vide") continue;
    const mdhd = child(b, mdia, "mdhd");
    const scale = mdhd ? (u8(b, mdhd.start) === 1 ? u32(b, mdhd.start + 20) : u32(b, mdhd.start + 12)) : 0;
    const stbl = path(b, mdia, "minf", "stbl");
    if (!scale || !stbl) return null;
    const get = (t) => child(b, stbl, t);
    const stsd = get("stsd");
    const entry = stsd && sampleEntry(b, stsd);
    if (!entry) return null;
    const stsz = get("stsz");
    const stts = get("stts");
    const stsc = get("stsc");
    const stco = get("stco") || get("co64");
    if (!stsz || !stts || !stsc || !stco) return null;
    const n = u32(b, stsz.start + 8);
    if (n > MAX_SAMPLES || (u32(b, stsz.start + 4) === 0 && stsz.start + 12 + n * 4 > stsz.end)) return null;
    const fixed = u32(b, stsz.start + 4);
    const size = (i) => (fixed || u32(b, stsz.start + 12 + i * 4));
    // decode times
    const dts = new Float64Array(n);
    {
      const count = u32(b, stts.start + 4);
      let i = 0;
      let t = 0;
      for (let k = 0; k < count && stts.start + 16 + k * 8 <= stts.end; k++) {
        const c = u32(b, stts.start + 8 + k * 8);
        const d = u32(b, stts.start + 12 + k * 8);
        for (let j = 0; j < c && i < n; j++, i++) {
          dts[i] = t;
          t += d;
        }
      }
      if (i < n) return null;
    }
    // composition offsets (B-frames)
    const cts = new Float64Array(n);
    const ctts = get("ctts");
    if (ctts) {
      const v1 = u8(b, ctts.start) === 1;
      const count = u32(b, ctts.start + 4);
      let i = 0;
      for (let k = 0; k < count && ctts.start + 16 + k * 8 <= ctts.end; k++) {
        const c = u32(b, ctts.start + 8 + k * 8);
        const off = v1 ? i32(b, ctts.start + 12 + k * 8) : u32(b, ctts.start + 12 + k * 8);
        for (let j = 0; j < c && i < n; j++, i++) cts[i] = off;
      }
    }
    // sync samples (absent: every sample is a key frame)
    let keys = null;
    const stss = get("stss");
    if (stss) {
      keys = new Uint8Array(n);
      const count = u32(b, stss.start + 4);
      for (let k = 0; k < count && stss.start + 12 + k * 4 <= stss.end; k++) {
        const s = u32(b, stss.start + 8 + k * 4);
        if (s >= 1 && s <= n) keys[s - 1] = 1;
      }
    }
    // chunk offsets and samples per chunk
    const co64 = stco.type === "co64";
    const chunks = u32(b, stco.start + 4);
    if (stco.start + 8 + chunks * (co64 ? 8 : 4) > stco.end) return null;
    const chunkOff = (k) => (co64 ? u64(b, stco.start + 8 + k * 8) : u32(b, stco.start + 8 + k * 4));
    const runs = u32(b, stsc.start + 4);
    const offsets = new Float64Array(n);
    {
      let i = 0;
      for (let r = 0; r < runs && i < n; r++) {
        const first = u32(b, stsc.start + 8 + r * 12) - 1;
        const per = u32(b, stsc.start + 12 + r * 12);
        const last = r + 1 < runs ? u32(b, stsc.start + 8 + (r + 1) * 12) - 1 : chunks;
        for (let k = first; k < last && k < chunks && i < n; k++) {
          let o = chunkOff(k);
          for (let j = 0; j < per && i < n; j++, i++) {
            offsets[i] = o;
            o += size(i);
          }
        }
      }
      if (i < n) return null;
    }
    // edit list: an empty edit delays the track, the first media edit says where presentation starts
    let shift = 0;
    let delay = 0;
    const elst = path(b, trak, "edts", "elst");
    if (elst) {
      const v1 = u8(b, elst.start) === 1;
      const count = u32(b, elst.start + 4);
      const w = v1 ? 20 : 12;
      for (let k = 0; k < count && elst.start + 8 + (k + 1) * w <= elst.end; k++) {
        const o = elst.start + 8 + k * w;
        const dur = v1 ? u64(b, o) : u32(b, o);
        const mt = v1 ? u32(b, o + 8) * 4294967296 + u32(b, o + 12) : i32(b, o + 4);
        if (mt === -1 || (v1 && u32(b, o + 8) === 0xffffffff)) delay += dur / movieScale;
        else {
          shift = mt;
          break;
        }
      }
    }
    const samples = new Array(n);
    for (let i = 0; i < n; i++) {
      const ts = Math.round(((dts[i] + cts[i] - shift) / scale + delay) * 1e6);
      if (offsets[i] + size(i) > b.length) return null;
      samples[i] = { ts, dur: 0, key: keys ? keys[i] === 1 : true, offset: offsets[i], size: size(i) };
    }
    return finish({ container: "mp4", ...entry, samples });
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- WebM / Matroska

const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
// level-1 elements of a segment: where an unknown-size cluster ends
const LEVEL1 = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, CLUSTER, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367]);

function readId(b, o) {
  const f = b[o];
  const len = f >= 0x80 ? 1 : f >= 0x40 ? 2 : f >= 0x20 ? 3 : f >= 0x10 ? 4 : 0;
  if (!len || o + len > b.length) return null;
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + b[o + i];
  return { id: v, len };
}
function readSize(b, o) {
  const f = b[o];
  let len = 1;
  while (len <= 8 && !(f & (0x80 >> (len - 1)))) len++;
  if (len > 8 || o + len > b.length) return null;
  let v = f & (0xff >> len);
  let all = v === (0xff >> len);
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[o + i];
    if (b[o + i] !== 0xff) all = false;
  }
  return { size: all ? -1 : v, len }; // -1 = unknown size (live recordings)
}
function el(b, o, end) {
  const id = readId(b, o);
  if (!id) return null;
  const sz = readSize(b, o + id.len);
  if (!sz) return null;
  const start = o + id.len + sz.len;
  const stop = sz.size < 0 ? end : start + sz.size;
  if (stop > end) return null;
  return { id: id.id, start, end: stop, unknown: sz.size < 0 };
}
function* elements(b, start, end) {
  let o = start;
  while (o < end) {
    const e = el(b, o, end);
    if (!e) return;
    yield e;
    o = e.end;
  }
}
const uintOf = (b, e) => {
  let v = 0;
  for (let i = e.start; i < e.end; i++) v = v * 256 + b[i];
  return v;
};
const strOf = (b, e) => String.fromCharCode(...b.subarray(e.start, Math.min(e.end, e.start + 64))).replace(/\0+$/, "");

function webmCodec(id, priv) {
  if (id === "V_VP8") return "vp8";
  if (id === "V_VP9") return "vp09.00.10.08";
  if (id === "V_AV1") return priv && priv.length >= 4 ? av1Codec(priv) : "av01.0.04M.08";
  if (id === "V_MPEG4/ISO/AVC") return priv && priv.length >= 4 ? `avc1.${hex2(priv[1])}${hex2(priv[2])}${hex2(priv[3])}` : null;
  if (id === "V_MPEGH/ISO/HEVC") return priv ? hevcCodec("hvc1", priv) : null;
  return null;
}

function demuxWebm(b) {
  const head = el(b, 0, b.length);
  if (!head || head.id !== 0x1a45dfa3) return null;
  const seg = el(b, head.end, b.length);
  if (!seg || seg.id !== SEGMENT) return null;
  let scale = 1e6; // TimecodeScale: nanoseconds per tick
  let track = null;
  const samples = [];
  // the segment's children, walked by hand so an unknown-size cluster ends at the next level-1 element
  let o = seg.start;
  while (o < seg.end) {
    const e = el(b, o, seg.end);
    if (!e) break;
    if (e.id === 0x1549a966) {
      for (const x of elements(b, e.start, e.end)) if (x.id === 0x2ad7b1) scale = uintOf(b, x) || 1e6;
    } else if (e.id === 0x1654ae6b) {
      for (const te of elements(b, e.start, e.end)) {
        if (te.id !== 0xae || track) continue;
        const t = { num: 0, type: 0, codecId: "", priv: null, width: 0, height: 0 };
        for (const x of elements(b, te.start, te.end)) {
          if (x.id === 0xd7) t.num = uintOf(b, x);
          else if (x.id === 0x83) t.type = uintOf(b, x);
          else if (x.id === 0x86) t.codecId = strOf(b, x);
          else if (x.id === 0x63a2) t.priv = b.slice(x.start, x.end);
          else if (x.id === 0xe0) for (const v of elements(b, x.start, x.end)) {
            if (v.id === 0xb0) t.width = uintOf(b, v);
            else if (v.id === 0xba) t.height = uintOf(b, v);
          }
        }
        if (t.type === 1) track = t;
      }
    } else if (e.id === CLUSTER) {
      if (!track) return null; // tracks come first in every file we can read
      let tc = 0;
      let p = e.start;
      const end = e.unknown ? seg.end : e.end;
      while (p < end) {
        const id = readId(b, p);
        if (!id || (e.unknown && LEVEL1.has(id.id))) break;
        const x = el(b, p, end);
        if (!x) break;
        if (x.id === 0xe7) tc = uintOf(b, x);
        else if (x.id === 0xa3 || x.id === 0xa0) {
          let block = x;
          let key = false;
          if (x.id === 0xa0) {
            block = null;
            let refs = 0;
            for (const y of elements(b, x.start, x.end)) {
              if (y.id === 0xa1) block = y;
              else if (y.id === 0xfb) refs++;
            }
            key = refs === 0;
            if (!block) {
              p = x.end;
              continue;
            }
          }
          const tn = readSize(b, block.start);
          if (tn && tn.size === track.num) {
            const q = block.start + tn.len;
            const rel = (b[q] << 24) >> 16 | b[q + 1]; // signed 16 bit
            const flags = b[q + 2];
            if (flags & 0x06) return null; // laced video frames: not read
            if (x.id === 0xa3) key = (flags & 0x80) !== 0;
            const offset = q + 3;
            if (samples.length >= MAX_SAMPLES) return null;
            samples.push({ ts: Math.round(((tc + rel) * scale) / 1000), dur: 0, key, offset, size: block.end - offset });
          }
        }
        p = x.end;
      }
      if (e.unknown) {
        o = p;
        continue;
      }
    }
    if (e.unknown) break; // an unknown-size element other than a cluster: nothing after it can be found
    o = e.end;
  }
  if (!track) return null;
  const codec = webmCodec(track.codecId, track.priv);
  if (!codec) return null;
  const description = /^V_MPEG/.test(track.codecId) ? track.priv : null;
  return finish({ container: "webm", codec, width: track.width, height: track.height, description, samples });
}

// durations from the next presentation time; the sorted list the reader looks frames up in
function finish(track) {
  const s = track.samples;
  if (!s.length || !s[0].key) return null; // a stream must start with a key frame
  const times = s.map((x) => x.ts).sort((a, b) => a - b);
  const next = new Map();
  for (let i = 0; i < times.length; i++) next.set(times[i], i + 1 < times.length ? times[i + 1] : null);
  const typical = times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) : 33333;
  for (const x of s) {
    const nx = next.get(x.ts);
    x.dur = nx === null || nx === undefined ? Math.round(typical) : nx - x.ts;
  }
  return { ...track, times };
}

/** The video track of an MP4 / MOV or WebM / MKV file, or null (see the header). */
export function demuxVideo(bytes, mime = "") {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length < 16) return null;
    const ebml = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    if (ebml || /webm|matroska/.test(mime)) return ebml ? demuxWebm(bytes) : null;
    return demuxMp4(bytes);
  } catch {
    return null;
  }
}

/** Index of the frame shown at `us` (microseconds) in a sorted time list: the last one at or before it. */
export function frameIndexAt(times, us) {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0) return -1;
  if (us < times[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= us) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
