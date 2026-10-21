// GIF87a / GIF89a decoder for animated GIFs (clean-room, from the public GIF89a specification).
//
// Public API:  readGif(bytes, { maxFrames = 300, maxPixels = 120e6 }) -> { width, height, loops, frames, warnings }
//              each frame: { rgba (full canvas, already composited), delay (ms), name }
//              isGif(bytes)
// Why:         the browser's createImageBitmap only returns the first frame; this gives every frame so they can
//              become layers.
// Invariants:  pure, no DOM; frame and pixel counts are capped; malformed LZW data ends the frame instead of throwing.

export function isGif(b) {
  return !!b && b.length >= 13 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61;
}

/** GIF flavored LZW (LSB first). Returns exactly `count` indices (missing data stays 0). */
export function gifLzw(data, minCode, count) {
  const out = new Uint8Array(count);
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  const first = new Uint8Array(4096);
  for (let i = 0; i < clear; i++) {
    suffix[i] = i;
    first[i] = i;
    length[i] = 1;
  }
  let next = eoi + 1;
  let bits = minCode + 1;
  let prev = -1;
  let buf = 0;
  let cnt = 0;
  let sp = 0;
  let o = 0;
  while (o < count) {
    while (cnt < bits && sp < data.length) {
      buf |= data[sp++] << cnt;
      cnt += 8;
    }
    if (cnt < bits) break;
    const code = buf & ((1 << bits) - 1);
    buf >>>= bits;
    cnt -= bits;
    if (code === clear) {
      next = eoi + 1;
      bits = minCode + 1;
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    if (prev === -1) {
      if (code >= clear) break;
      out[o++] = code;
      prev = code;
      continue;
    }
    if (code > next) break;
    const f = code < next ? first[code] : first[prev];
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = f;
      first[next] = first[prev];
      length[next] = length[prev] + 1;
      next++;
    }
    const L = length[code];
    const n = Math.min(L, count - o);
    let c = code;
    for (let k = L - 1; k >= 0; k--) {
      if (k < n) out[o + k] = suffix[c];
      c = prefix[c];
    }
    o += n;
    prev = code;
    if (next >= 1 << bits && bits < 12) bits++;
  }
  return out;
}

/**
 * @param {Uint8Array} b
 * @param {{ maxFrames?: number, maxPixels?: number }} [opts]
 */
export function readGif(b, { maxFrames = 300, maxPixels = 120e6 } = {}) {
  if (!isGif(b)) throw new Error('This is not a GIF file.');
  const warnings = [];
  const u16 = (o) => b[o] | (b[o + 1] << 8);
  const width = u16(6);
  const height = u16(8);
  if (!width || !height) throw new Error('This GIF has no size.');
  if (width * height > 64e6) throw new Error('This GIF is too large.');
  const flags = b[10];
  let p = 13;
  let global = null;
  if (flags & 0x80) {
    const n = 2 << (flags & 7);
    if (p + n * 3 > b.length) throw new Error('The GIF file is truncated.');
    global = b.subarray(p, p + n * 3);
    p += n * 3;
  }
  const frames = [];
  let loops = 1;
  let gce = { delay: 100, disposal: 0, transparent: -1 };
  let canvas = new Uint8ClampedArray(width * height * 4);
  let restore = null;
  let pixelsUsed = 0;
  const skipBlocks = () => {
    while (p < b.length && b[p] !== 0) p += b[p] + 1;
    p++;
  };
  while (p < b.length) {
    const tag = b[p++];
    if (tag === 0x3b) break;
    if (tag === 0x21) {
      const label = b[p++];
      if (label === 0xf9 && b[p] >= 4) {
        const f = b[p + 1];
        gce = { disposal: (f >> 2) & 7, transparent: f & 1 ? b[p + 4] : -1, delay: Math.max(u16(p + 2) * 10, 20) };
        skipBlocks();
      } else if (label === 0xff && b[p] >= 11 && String.fromCharCode(...b.subarray(p + 1, p + 12)) === 'NETSCAPE2.0') {
        if (b[p + 12] === 3 && b[p + 13] === 1) loops = u16(p + 14);
        skipBlocks();
      } else skipBlocks();
      continue;
    }
    if (tag !== 0x2c) {
      warnings.push('Unexpected data in the GIF file was ignored.');
      break;
    }
    if (p + 9 > b.length) break;
    const fx = u16(p);
    const fy = u16(p + 2);
    const fw = u16(p + 4);
    const fh = u16(p + 6);
    const lf = b[p + 8];
    p += 9;
    let table = global;
    if (lf & 0x80) {
      const n = 2 << (lf & 7);
      table = b.subarray(p, p + n * 3);
      p += n * 3;
    }
    const minCode = b[p++];
    const chunks = [];
    let total = 0;
    while (p < b.length && b[p] !== 0) {
      const n = b[p];
      chunks.push(b.subarray(p + 1, p + 1 + n));
      total += n;
      p += n + 1;
    }
    p++;
    if (frames.length >= maxFrames) {
      warnings.push(`Only the first ${maxFrames} frames were read.`);
      break;
    }
    pixelsUsed += width * height;
    if (pixelsUsed > maxPixels) {
      warnings.push('The remaining frames were skipped (the animation is too large).');
      break;
    }
    if (minCode < 1 || minCode > 11 || !table) {
      warnings.push('A frame with invalid data was skipped.');
      continue;
    }
    const data = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      data.set(c, o);
      o += c.length;
    }
    let idx = gifLzw(data, minCode, fw * fh);
    if (lf & 0x40) {
      // interlaced: rows come in four passes
      const de = new Uint8Array(fw * fh);
      let row = 0;
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
        for (let y = start; y < fh; y += step) de.set(idx.subarray(row * fw, row * fw + fw), y * fw), row++;
      }
      idx = de;
    }
    if (gce.disposal === 3) restore = canvas.slice();
    for (let y = 0; y < fh; y++) {
      const cy = fy + y;
      if (cy >= height) break;
      for (let x = 0; x < fw; x++) {
        const cx = fx + x;
        if (cx >= width) break;
        const v = idx[y * fw + x];
        if (v === gce.transparent) continue;
        const d = (cy * width + cx) * 4;
        canvas[d] = table[v * 3] ?? 0;
        canvas[d + 1] = table[v * 3 + 1] ?? 0;
        canvas[d + 2] = table[v * 3 + 2] ?? 0;
        canvas[d + 3] = 255;
      }
    }
    frames.push({ rgba: canvas.slice(), delay: gce.delay, name: `Frame ${frames.length + 1}` });
    if (gce.disposal === 2) {
      for (let y = fy; y < Math.min(height, fy + fh); y++) canvas.fill(0, (y * width + fx) * 4, (y * width + Math.min(width, fx + fw)) * 4);
    } else if (gce.disposal === 3 && restore) canvas = restore;
    gce = { delay: 100, disposal: 0, transparent: -1 };
  }
  if (!frames.length) throw new Error('This GIF contains no readable frames.');
  return { width, height, loops, frames, warnings: [...new Set(warnings)] };
}
