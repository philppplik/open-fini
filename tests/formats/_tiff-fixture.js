// Synthetic TIFF writer for the tests (independent of the reader): builds strips with the chosen compression.
import { zlibSync } from '../../app/vendor/fflate/fflate.js';

export function packBitsEncode(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (i + run < data.length && data[i + run] === data[i] && run < 128) run++;
    if (run > 1) {
      out.push(257 - run, data[i]);
      i += run;
    } else {
      let lit = 1;
      while (i + lit < data.length && lit < 128 && (i + lit + 1 >= data.length || data[i + lit] !== data[i + lit + 1])) lit++;
      out.push(lit - 1, ...data.subarray(i, i + lit));
      i += lit;
    }
  }
  return Uint8Array.from(out);
}

export function lzwEncode(data) {
  const out = [];
  let buf = 0;
  let cnt = 0;
  let bits = 9;
  const put = (code) => {
    buf = (buf << bits) | code;
    cnt += bits;
    while (cnt >= 8) {
      out.push((buf >>> (cnt - 8)) & 255);
      cnt -= 8;
    }
    buf &= (1 << cnt) - 1;
  };
  let table = new Map();
  let next = 258;
  put(256);
  let w = '';
  for (const c of data) {
    const wc = w + String.fromCharCode(c);
    if (wc.length === 1 || table.has(wc)) w = wc;
    else {
      put(w.length === 1 ? w.charCodeAt(0) : table.get(w));
      table.set(wc, next++);
      if (next > (1 << bits) - 1 && bits < 12) bits++;
      if (next >= 4093) {
        put(256);
        table = new Map();
        next = 258;
        bits = 9;
      }
      w = String.fromCharCode(c);
    }
  }
  if (w) put(w.length === 1 ? w.charCodeAt(0) : table.get(w));
  put(257);
  if (cnt) out.push((buf << (8 - cnt)) & 255);
  return Uint8Array.from(out);
}

/**
 * pages: [{ width, height, spp, bps, photo, data (raw interleaved bytes), comp, predictor, rowsPerStrip, extra, cmap, subfile }]
 */
export function buildTiff(pages, { le = true } = {}) {
  const parts = [];
  let size = 8;
  const hdr = new Uint8Array(8);
  const hv = new DataView(hdr.buffer);
  hdr.set(le ? [0x49, 0x49] : [0x4d, 0x4d]);
  hv.setUint16(2, 42, le);
  parts.push(hdr);
  const push = (u8) => {
    parts.push(u8);
    const at = size;
    size += u8.length + (u8.length & 1);
    if (u8.length & 1) parts.push(new Uint8Array(1));
    return at;
  };
  const ifdOffsets = [];
  const built = pages.map((p) => {
    const rps = p.rowsPerStrip || p.height;
    const rowBytes = Math.ceil((p.width * p.spp * p.bps) / 8);
    const strips = [];
    for (let y = 0; y < p.height; y += rps) {
      let chunk = p.data.slice(y * rowBytes, Math.min(p.height, y + rps) * rowBytes);
      if (p.predictor === 2) {
        chunk = Uint8Array.from(chunk);
        const rows = chunk.length / rowBytes;
        for (let r = 0; r < rows; r++) for (let x = rowBytes - 1; x >= p.spp; x--) chunk[r * rowBytes + x] = (chunk[r * rowBytes + x] - chunk[r * rowBytes + x - p.spp]) & 255;
      }
      const comp = p.comp || 1;
      strips.push(comp === 5 ? lzwEncode(chunk) : comp === 32773 ? packBitsEncode(chunk) : comp === 8 ? zlibSync(chunk) : chunk);
    }
    const offs = strips.map((s) => push(s));
    return { p, rps, offs, counts: strips.map((s) => s.length) };
  });
  built.forEach((b, i) => {
    const { p } = b;
    const entries = [];
    const add = (tag, type, vals) => entries.push({ tag, type, vals });
    if (p.subfile) add(254, 4, [p.subfile]);
    add(256, 4, [p.width]);
    add(257, 4, [p.height]);
    add(258, 3, Array(p.spp).fill(p.bps));
    add(259, 3, [p.comp || 1]);
    add(262, 3, [p.photo]);
    add(273, 4, b.offs);
    add(277, 3, [p.spp]);
    add(278, 4, [b.rps]);
    add(279, 4, b.counts);
    if (p.predictor) add(317, 3, [p.predictor]);
    if (p.cmap) add(320, 3, p.cmap);
    if (p.extra) add(338, 3, [p.extra]);
    entries.sort((a, c) => a.tag - c.tag);
    const dataBlobs = entries.map((e) => {
      const sz = e.type === 3 ? 2 : 4;
      const u = new Uint8Array(sz * e.vals.length);
      const dv = new DataView(u.buffer);
      e.vals.forEach((v, k) => (sz === 2 ? dv.setUint16(k * 2, v, le) : dv.setUint32(k * 4, v, le)));
      return u;
    });
    const extAt = [];
    for (const u of dataBlobs) extAt.push(u.length > 4 ? push(u) : -1);
    const ifd = new Uint8Array(2 + entries.length * 12 + 4);
    const dv = new DataView(ifd.buffer);
    dv.setUint16(0, entries.length, le);
    entries.forEach((e, k) => {
      const o = 2 + k * 12;
      dv.setUint16(o, e.tag, le);
      dv.setUint16(o + 2, e.type, le);
      dv.setUint32(o + 4, e.vals.length, le);
      if (extAt[k] >= 0) dv.setUint32(o + 8, extAt[k], le);
      else ifd.set(dataBlobs[k], o + 8);
    });
    ifdOffsets.push({ at: push(ifd), len: ifd.length, index: i });
  });
  const out = new Uint8Array(size);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  const dv = new DataView(out.buffer);
  dv.setUint32(4, ifdOffsets[0].at, le);
  ifdOffsets.forEach((x, k) => dv.setUint32(x.at + x.len - 4, k + 1 < ifdOffsets.length ? ifdOffsets[k + 1].at : 0, le));
  return out;
}
