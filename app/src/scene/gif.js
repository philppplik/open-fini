// Animated GIF encoder for the Scene Studio export (clean-room, from the GIF89a specification; the decoder lives in
// engine/formats/gif.js). Pure; unit-tested in tests/scene/mux.test.js by decoding the result with readGif.
//
//   const gif = createGifEncoder(width, height, { fps, loops });   gif.add(rgba);  …  gif.finish() → Uint8Array
// One global palette of up to 256 colors is built from the first frames by median cut; pixels map to the nearest
// palette color with ordered dithering. Limits: no transparency, no per-frame palettes (banding in long gradients).

// Median cut over a color histogram (5 bits per channel).
function buildPalette(samples, max = 256) {
  const hist = new Map();
  for (const rgba of samples) {
    const step = Math.max(1, Math.floor(rgba.length / 4 / 40000)) * 4;
    for (let i = 0; i < rgba.length; i += step) {
      const k = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  let boxes = [[...hist.entries()].map(([k, n]) => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3, n])];
  while (boxes.length < max) {
    // split the box with the largest color range along that channel at the weighted median
    let bi = -1;
    let bch = 0;
    let brange = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255;
        let hi = 0;
        for (const c of b) {
          if (c[ch] < lo) lo = c[ch];
          if (c[ch] > hi) hi = c[ch];
        }
        if (hi - lo > brange) {
          brange = hi - lo;
          bi = i;
          bch = ch;
        }
      }
    });
    if (bi < 0) break;
    const b = boxes[bi].sort((x, y) => x[bch] - y[bch]);
    const total = b.reduce((n, c) => n + c[3], 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < b.length - 1; i++) {
      acc += b[i][3];
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  const pal = new Uint8Array(256 * 3);
  boxes.forEach((b, i) => {
    let n = 0;
    const s = [0, 0, 0];
    for (const c of b) {
      n += c[3];
      for (let ch = 0; ch < 3; ch++) s[ch] += (c[ch] + 4) * c[3];
    }
    for (let ch = 0; ch < 3; ch++) pal[i * 3 + ch] = n ? Math.min(255, Math.round(s[ch] / n)) : 0;
  });
  return { pal, count: Math.max(2, boxes.length) };
}

// GIF LZW (LSB first, variable code size, clear code when the table is full).
function lzw(indices, minCode) {
  const out = [];
  let cur = 0;
  let bits = 0;
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let next = eoi + 1;
  let table = new Map();
  const emit = (code) => {
    cur |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(cur & 255);
      cur >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      table.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      table = new Map();
      next = eoi + 1;
      size = minCode + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function createGifEncoder(width, height, { fps = 15, loops = 0, paletteFrames = 6 } = {}) {
  const pending = []; // frames kept until the palette exists
  const chunks = [];
  let palette = null;
  let cache = null;
  const delay = Math.max(2, Math.round(100 / fps));

  function nearest(r, g, b) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let v = cache[key];
    if (v) return v - 1;
    let best = 0;
    let bd = Infinity;
    const p = palette.pal;
    for (let i = 0; i < palette.count; i++) {
      const dr = p[i * 3] - r;
      const dg = p[i * 3 + 1] - g;
      const db = p[i * 3 + 2] - b;
      const d = dr * dr * 2 + dg * dg * 4 + db * db;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    cache[key] = best + 1;
    return best;
  }

  function writeFrame(rgba) {
    const idx = new Uint8Array(width * height);
    for (let y = 0, i = 0, o = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i += 4, o++) {
        const d = (BAYER[(y & 3) * 4 + (x & 3)] - 7.5) * 1.2;
        idx[o] = nearest(Math.max(0, Math.min(255, rgba[i] + d)), Math.max(0, Math.min(255, rgba[i + 1] + d)), Math.max(0, Math.min(255, rgba[i + 2] + d)));
      }
    }
    const data = lzw(idx, 8);
    const head = [0x21, 0xf9, 4, 0, delay & 255, delay >> 8, 0, 0, 0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0, 8];
    const body = [];
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      body.push(n);
      for (let j = 0; j < n; j++) body.push(data[i + j]);
    }
    body.push(0);
    chunks.push(Uint8Array.from(head), Uint8Array.from(body));
  }

  function start() {
    palette = buildPalette(pending);
    cache = new Uint16Array(32768);
    const head = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 255, width >> 8, height & 255, height >> 8, 0xf7, 0, 0];
    const app = [0x21, 0xff, 11, ...[..."NETSCAPE2.0"].map((c) => c.charCodeAt(0)), 3, 1, loops & 255, loops >> 8, 0];
    chunks.push(Uint8Array.from(head), palette.pal, Uint8Array.from(app));
    for (const f of pending.splice(0)) writeFrame(f);
  }

  return {
    /** Adds a frame (RGBA bytes of width × height; alpha is ignored). */
    add(rgba) {
      if (palette) return writeFrame(rgba);
      pending.push(rgba.slice());
      if (pending.length >= paletteFrames) start();
    },
    finish() {
      if (!palette) {
        if (!pending.length) throw new Error("The GIF has no frames.");
        start();
      }
      chunks.push(Uint8Array.of(0x3b));
      let n = 0;
      for (const c of chunks) n += c.length;
      const out = new Uint8Array(n);
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.length;
      }
      return out;
    },
  };
}
