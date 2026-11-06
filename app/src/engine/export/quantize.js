// Color quantization for indexed (PNG-8) export: median cut over RGBA samples, nearest-color mapping with an optional
// Floyd-Steinberg error diffusion. Pure (no DOM), deterministic.
//
// Public API: quantize(rgba, width, height, { colors = 256, dither = false }) -> { palette: Uint8Array (RGBA x n), indices: Uint8Array }
// Invariants: 2 <= palette size <= colors <= 256; fully transparent pixels share one palette entry; entries with alpha
//             below 255 come first (so the PNG tRNS chunk stays short); images with few colors keep them exactly.

const MAX_SAMPLES = 1 << 18;

/**
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @param {{colors?:number, dither?:boolean}} [o]
 */
export function quantize(rgba, width, height, { colors = 256, dither = false } = {}) {
  const n = width * height;
  const max = Math.max(2, Math.min(256, Math.round(colors)));
  let palette = exactPalette(rgba, n, max);
  const exact = !!palette;
  if (!palette) palette = medianCut(rgba, n, max);
  palette = orderByAlpha(palette);
  const indices = mapPixels(rgba, width, height, palette, dither && !exact);
  return { palette, indices };
}

/** The image's own colors when there are at most `max` of them (transparent pixels collapse to one entry). */
function exactPalette(rgba, n, max) {
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const a = rgba[j + 3];
    const key = a === 0 ? 0 : ((rgba[j] << 24) | (rgba[j + 1] << 16) | (rgba[j + 2] << 8) | a) >>> 0;
    if (!seen.has(key)) {
      if (seen.size >= max) return null;
      seen.set(key, a === 0 ? [0, 0, 0, 0] : [rgba[j], rgba[j + 1], rgba[j + 2], a]);
    }
  }
  const out = new Uint8Array(Math.max(2, seen.size) * 4);
  let k = 0;
  for (const c of seen.values()) out.set(c, 4 * k++);
  return out;
}

function medianCut(rgba, n, max) {
  const step = Math.max(1, Math.ceil(n / MAX_SAMPLES));
  let transparent = false;
  const pts = [];
  for (let i = 0; i < n; i += step) {
    const j = i * 4;
    if (rgba[j + 3] === 0) transparent = true;
    else pts.push(j);
  }
  const target = transparent ? max - 1 : max;
  let boxes = pts.length ? [pts] : [];
  while (boxes.length < target) {
    // split the box with the largest channel range (ties: the most populated)
    let best = -1;
    let bestScore = 0;
    let bestCh = 0;
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      if (box.length < 2) continue;
      const lo = [255, 255, 255, 255];
      const hi = [0, 0, 0, 0];
      for (const j of box) for (let c = 0; c < 4; c++) {
        const v = rgba[j + c];
        if (v < lo[c]) lo[c] = v;
        if (v > hi[c]) hi[c] = v;
      }
      let ch = 0;
      for (let c = 1; c < 4; c++) if (hi[c] - lo[c] > hi[ch] - lo[ch]) ch = c;
      const score = (hi[ch] - lo[ch]) * Math.sqrt(box.length);
      if (score > bestScore) {
        bestScore = score;
        best = b;
        bestCh = ch;
      }
    }
    if (best < 0) break;
    const box = boxes[best].sort((x, y) => rgba[x + bestCh] - rgba[y + bestCh]);
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }
  const out = new Uint8Array(Math.max(2, boxes.length + (transparent ? 1 : 0)) * 4);
  let k = transparent ? 1 : 0; // entry 0 stays [0,0,0,0] for transparent pixels
  for (const box of boxes) {
    const s = [0, 0, 0, 0];
    for (const j of box) for (let c = 0; c < 4; c++) s[c] += rgba[j + c];
    for (let c = 0; c < 4; c++) out[k * 4 + c] = Math.round(s[c] / box.length);
    k++;
  }
  return out;
}

/** Entries with alpha < 255 first (tRNS only needs to list those). */
function orderByAlpha(pal) {
  const list = [];
  for (let i = 0; i < pal.length; i += 4) list.push(pal.subarray(i, i + 4));
  list.sort((a, b) => (a[3] === 255) - (b[3] === 255));
  const out = new Uint8Array(pal.length);
  list.forEach((c, i) => out.set(c, i * 4));
  return out;
}

function mapPixels(rgba, w, h, pal, dither) {
  const count = pal.length / 4;
  const cache = new Int16Array(1 << 20).fill(-1); // 5 bits per channel
  const nearest = (r, g, b, a) => {
    if (a < 8) {
      for (let i = 0; i < count; i++) if (pal[i * 4 + 3] === 0) return i;
    }
    const key = ((r >> 3) << 15) | ((g >> 3) << 10) | ((b >> 3) << 5) | (a >> 3);
    const hit = cache[key];
    if (hit >= 0) return hit;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      const dr = r - pal[o];
      const dg = g - pal[o + 1];
      const db = b - pal[o + 2];
      const da = a - pal[o + 3];
      const d = dr * dr * 3 + dg * dg * 4 + db * db * 2 + da * da * 4;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    cache[key] = best;
    return best;
  };
  const out = new Uint8Array(w * h);
  if (!dither) {
    for (let i = 0, j = 0; i < w * h; i++, j += 4) out[i] = nearest(rgba[j], rgba[j + 1], rgba[j + 2], rgba[j + 3]);
    return out;
  }
  // Floyd-Steinberg on RGBA, two rows of error
  let cur = new Float32Array((w + 2) * 4);
  let next = new Float32Array((w + 2) * 4);
  const px = new Int32Array(4);
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let y = 0; y < h; y++) {
    next.fill(0);
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      const e = (x + 1) * 4;
      px[0] = clamp(rgba[j] + cur[e]);
      px[1] = clamp(rgba[j + 1] + cur[e + 1]);
      px[2] = clamp(rgba[j + 2] + cur[e + 2]);
      px[3] = clamp(rgba[j + 3] + cur[e + 3]);
      const k = nearest(px[0], px[1], px[2], px[3]);
      out[y * w + x] = k;
      for (let c = 0; c < 4; c++) {
        const err = px[c] - pal[k * 4 + c];
        if (!err) continue;
        cur[e + 4 + c] += (err * 7) / 16;
        next[e - 4 + c] += (err * 3) / 16;
        next[e + c] += (err * 5) / 16;
        next[e + 4 + c] += err / 16;
      }
    }
    [cur, next] = [next, cur];
  }
  return out;
}
