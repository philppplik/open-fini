// Native (no image generation) photo edits of the Pixel studio: classical background removal / subject selection,
// color replace, auto white balance / levels / contrast, and a dispatcher `applyEdit` over these plus the existing
// sharpen, denoise, vignette, tilt-shift and upscale filters. Pure: plain {width, height, data} images, no DOM.
// Heavy calls run on the worker pool (core/workers/jobs.js "pixel.edit"); tests in tests/pixel/native-edit.test.js.
import { NATIVE_EDITS } from "./native-edit-list.js";

export { NATIVE_EDITS };

/** Edits that run on the worker pool (self-contained here); the others call the existing filters on the main thread. */
export const WORKER_EDITS = ["remove_background", "auto_white_balance", "color_replace", "upscale"];

// This module imports nothing heavy on purpose: it is loaded by the worker, and sharing the start-up engine modules
// with the worker bundle would split them into more (worse compressing) start-up chunks.

/** Separable box blur of a Float32 plane, `passes` times (in place). */
function blurPlane(a, w, h, r, passes = 2) {
  const t = new Float32Array(Math.max(w, h));
  const R = Math.max(1, Math.round(r)), k = 1 / (2 * R + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) t[x] = a[o + x];
      let s = t[0] * (R + 1);
      for (let i = 1; i <= R; i++) s += t[Math.min(w - 1, i)];
      for (let x = 0; x < w; x++) {
        a[o + x] = s * k;
        s += t[Math.min(w - 1, x + R + 1)] - t[Math.max(0, x - R)];
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) t[y] = a[y * w + x];
      let s = t[0] * (R + 1);
      for (let i = 1; i <= R; i++) s += t[Math.min(h - 1, i)];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s * k;
        s += t[Math.min(h - 1, y + R + 1)] - t[Math.max(0, y - R)];
      }
    }
  }
}

const hex = (s) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s || "").trim());
  const v = m ? parseInt(m[1], 16) : 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** Gray-world white balance over the visible, unclipped pixels (in place). Returns the per-channel gains. */
export function autoWhiteBalance(img) {
  const d = img.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
    if (mx >= 250 || mx <= 5) continue; // clipped pixels carry no color information
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  if (!n) return [1, 1, 1];
  const gray = (r + g + b) / 3;
  const gains = [gray / (r || 1), gray / (g || 1), gray / (b || 1)].map((k) => Math.max(0.5, Math.min(2, k)));
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] * gains[0];
    d[i + 1] = d[i + 1] * gains[1];
    d[i + 2] = d[i + 2] * gains[2];
  }
  return gains;
}

/** Applies levels params ({inBlack, inWhite, channels}) as produced by autoLevels / autoContrast (in place). */
export function applyLevelsStretch(img, p) {
  const lut = (lo, hi) => {
    const t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) t[v] = hi > lo ? ((v - lo) * 255) / (hi - lo) : v;
    return t;
  };
  const m = lut(p.inBlack ?? 0, p.inWhite ?? 255);
  const ch = p.channels || {};
  const L = ["red", "green", "blue"].map((k) => (ch[k] ? lut(ch[k].inBlack, ch[k].inWhite) : null));
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = m[d[i + c]];
      d[i + c] = L[c] ? L[c][v] : v;
    }
  }
  return img;
}

/**
 * Background mask by edge-seeded region growing: the colors along the image border are the background model, and
 * the background grows inward from the border through pixels close to that model, stopped by strong edges.
 * Transparent pixels always count as background. Returns a Uint8Array (255 = background) with a feathered edge.
 */
export function backgroundMask(img, { tolerance = 40, feather = 1.5, edges = 60 } = {}) {
  const { width: W, height: H, data: d } = img;
  const N = W * H;
  // background palette: 4-bit-per-channel bins of the border pixels that hold >= 2 % of them
  const bins = new Map();
  let total = 0;
  const addBorder = (x, y) => {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 16) return;
    const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const e = bins.get(k) || bins.set(k, [0, 0, 0, 0]).get(k);
    e[0] += d[i]; e[1] += d[i + 1]; e[2] += d[i + 2]; e[3]++;
    total++;
  };
  for (let x = 0; x < W; x++) { addBorder(x, 0); if (H > 1) addBorder(x, H - 1); }
  for (let y = 1; y < H - 1; y++) { addBorder(0, y); if (W > 1) addBorder(W - 1, y); }
  const pal = [...bins.values()].filter((e) => e[3] >= Math.max(1, total * 0.02)).map((e) => [e[0] / e[3], e[1] / e[3], e[2] / e[3]]);
  const tol2 = tolerance * tolerance;
  const isBgColor = (p) => {
    const i = p * 4;
    if (d[i + 3] < 16) return true;
    for (const c of pal) {
      const dr = d[i] - c[0], dg = d[i + 1] - c[1], db = d[i + 2] - c[2];
      if (dr * dr + dg * dg + db * db <= tol2) return true;
    }
    return false;
  };
  const luma = (p) => d[p * 4] * 0.299 + d[p * 4 + 1] * 0.587 + d[p * 4 + 2] * 0.114;
  const edge = (p) => {
    const x = p % W, y = (p / W) | 0;
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return 0;
    const gx = luma(p + 1) - luma(p - 1), gy = luma(p + W) - luma(p - W);
    return Math.hypot(gx, gy);
  };
  const bg = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const seed = (p) => { if (!bg[p] && isBgColor(p)) { bg[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (sp) {
    const p = stack[--sp];
    const x = p % W;
    const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W];
    for (const q of nb) {
      if (q < 0 || q >= N || bg[q]) continue;
      if (!isBgColor(q) || edge(q) > edges) continue;
      bg[q] = 1;
      stack[sp++] = q;
    }
  }
  const out = new Uint8Array(N);
  if (feather > 0) {
    const plane = new Float32Array(N);
    for (let p = 0; p < N; p++) plane[p] = bg[p];
    blurPlane(plane, W, H, feather);
    for (let p = 0; p < N; p++) out[p] = Math.round(Math.min(1, plane[p]) * 255);
  } else for (let p = 0; p < N; p++) out[p] = bg[p] * 255;
  return out;
}

/** Subject (foreground) selection: the inverse of backgroundMask. Returns a Uint8Array (255 = subject). */
export function subjectMask(img, opts) {
  const bg = backgroundMask(img, opts);
  for (let p = 0; p < bg.length; p++) bg[p] = 255 - bg[p];
  return bg;
}

/** Removes the background (makes it transparent, feathered) in place; returns the subject mask. */
export function removeBackground(img, opts) {
  const fg = subjectMask(img, opts);
  const d = img.data;
  for (let p = 0; p < fg.length; p++) d[p * 4 + 3] = (d[p * 4 + 3] * fg[p]) / 255;
  return fg;
}

/**
 * Replaces one color with another (in place): pixels within `tolerance` (RGB distance) of `from` take the hue and
 * saturation of `to` while keeping their own lightness (shading survives); the effect fades out toward the tolerance.
 */
export function colorReplace(img, from, to, tolerance = 60) {
  const [fr, fg, fb] = hex(from);
  const [tr, tg, tb] = hex(to);
  const tl = tr * 0.299 + tg * 0.587 + tb * 0.114 || 1;
  const d = img.data;
  let changed = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const dist = Math.hypot(d[i] - fr, d[i + 1] - fg, d[i + 2] - fb);
    if (dist >= tolerance) continue;
    const w = dist < tolerance * 0.5 ? 1 : 1 - (dist - tolerance * 0.5) / (tolerance * 0.5);
    // the target color scaled to this pixel's luma: shading survives
    const k = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / tl;
    d[i] += (tr * k - d[i]) * w;
    d[i + 1] += (tg * k - d[i + 1]) * w;
    d[i + 2] += (tb * k - d[i + 2]) * w;
    changed++;
  }
  return changed;
}

/** Mild 3x3 sharpen (in place), the detail pass after upscaling. */
function sharpen3(img, amount) {
  const { width: W, height: H, data: d } = img;
  const src = new Uint8ClampedArray(d);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const n = src[i - 4 + c] + src[i + 4 + c] + src[i - W * 4 + c] + src[i + W * 4 + c];
      d[i + c] = src[i + c] + amount * (4 * src[i + c] - n) * 0.25;
    }
  }
  return img;
}

/**
 * Runs a native edit by name. `fx` supplies the existing filters for the edits outside WORKER_EDITS (and resizeImage
 * for upscale): { autoLevels, autoContrast, unsharpMask, denoise, vignette, tiltShift, resizeImage } from
 * engine/pixel/index.js. Most edits work in place; upscale returns a new, larger image. Unknown names throw.
 */
export function applyEdit(name, img, params = {}, fx = {}) {
  const p = { ...(NATIVE_EDITS[name] || {}), ...params };
  switch (name) {
    case "remove_background": removeBackground(img, p); return img;
    case "auto_white_balance": autoWhiteBalance(img); return img;
    case "auto_levels": return applyLevelsStretch(img, fx.autoLevels(img, { clip: p.clip }));
    case "auto_contrast": return applyLevelsStretch(img, fx.autoContrast(img, { clip: p.clip }));
    case "color_replace": colorReplace(img, p.from, p.to, p.tolerance); return img;
    case "sharpen": return fx.unsharpMask(img, p.amount, p.radius, p.threshold);
    case "denoise": return fx.denoise(img, p.strength, p.color, p.radius, p.detail);
    case "vignette": return fx.vignette(img, { amount: p.amount, midpoint: p.midpoint, feather: p.feather, roundness: p.roundness, cx: img.width / 2, cy: img.height / 2 });
    case "tilt_shift": {
      const s = Math.max(img.width, img.height);
      return fx.tiltShift(img, { fx: img.width / 2, fy: img.height * p.y, angle: p.angle, band: p.band * s, transition: p.transition * s, blur: p.blur, saturation: 0 });
    }
    case "upscale": {
      const k = Math.max(1, Math.min(4, Number(p.factor) || 2));
      const out = fx.resizeImage(img, Math.round(img.width * k), Math.round(img.height * k), { filter: "lanczos3" });
      return p.detail > 0 ? sharpen3(out, p.detail) : out;
    }
    default: throw new Error(`Unknown edit: ${name}`);
  }
}
