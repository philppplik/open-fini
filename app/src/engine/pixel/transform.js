// Geometric transforms: resampling, affine and perspective warps, rotation.
// All resampling is premultiplied-alpha correct; downscales use a kernel stretched by the scale factor
// (or exact area weights for 'box'), so they are properly antialiased.

import { createImage, cloneImage, toPremultipliedFloat, fromPremultipliedFloat, parseColor } from "./image.js";

/**
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RGBAImage
 * @typedef {'nearest'|'bilinear'|'bicubic'|'lanczos3'|'box'} ResizeFilter
 */

// ---------------------------------------------------------------------------------------------
// Separable resize
// ---------------------------------------------------------------------------------------------

function kBilinear(x) {
  x = Math.abs(x);
  return x < 1 ? 1 - x : 0;
}

function kCubic(x) {
  x = Math.abs(x);
  if (x < 1) return 1.5 * x * x * x - 2.5 * x * x + 1;
  if (x < 2) return -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2;
  return 0;
}

function kLanczos3(x) {
  x = Math.abs(x);
  if (x < 1e-8) return 1;
  if (x >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

const KERNELS = {
  bilinear: [kBilinear, 1],
  bicubic: [kCubic, 2],
  lanczos3: [kLanczos3, 3],
};

// Per destination sample: list of (clamped source index, weight); weights sum to 1.
function buildWeights(srcN, dstN, filter) {
  const scale = srcN / dstN;
  let maxT;
  let kernel = null;
  let support = 0;
  let fs = 1;
  if (filter === "box") {
    maxT = Math.ceil(scale) + 2;
  } else {
    const k = KERNELS[filter] || KERNELS.bicubic;
    kernel = k[0];
    fs = Math.max(1, scale);
    support = k[1] * fs;
    maxT = 2 * Math.ceil(support) + 2;
  }
  const idx = new Int32Array(dstN * maxT);
  const wt = new Float32Array(dstN * maxT);
  const cnt = new Int32Array(dstN);
  const last = srcN - 1;
  for (let i = 0; i < dstN; i++) {
    const o = i * maxT;
    let n = 0;
    let sum = 0;
    if (filter === "box") {
      const lo = i * scale;
      const hi = (i + 1) * scale;
      const j0 = Math.floor(lo);
      const j1 = Math.min(srcN, Math.ceil(hi));
      for (let j = j0; j < j1; j++) {
        const w = Math.min(j + 1, hi) - Math.max(j, lo);
        if (w <= 1e-9) continue;
        idx[o + n] = j > last ? last : j;
        wt[o + n] = w;
        sum += w;
        n++;
      }
    } else {
      const center = (i + 0.5) * scale - 0.5;
      const jl = Math.ceil(center - support);
      const jr = Math.floor(center + support);
      for (let j = jl; j <= jr && n < maxT; j++) {
        const w = kernel((j - center) / fs);
        if (w === 0) continue;
        idx[o + n] = j < 0 ? 0 : j > last ? last : j;
        wt[o + n] = w;
        sum += w;
        n++;
      }
    }
    if (n === 0 || sum === 0) {
      const c = Math.min(last, Math.max(0, Math.round((i + 0.5) * scale - 0.5)));
      idx[o] = c;
      wt[o] = 1;
      n = 1;
      sum = 1;
    }
    const inv = 1 / sum;
    for (let t = 0; t < n; t++) wt[o + t] *= inv;
    cnt[i] = n;
  }
  return { idx, wt, cnt, maxT };
}

function hPassU8(d, sw, sh, dw, W, out) {
  const { idx, wt, cnt, maxT } = W;
  for (let y = 0; y < sh; y++) {
    const rb = y * sw * 4;
    let o = y * dw * 4;
    for (let x = 0; x < dw; x++, o += 4) {
      let r = 0, g = 0, b = 0, a = 0;
      const tb = x * maxT;
      const n = cnt[x];
      for (let t = 0; t < n; t++) {
        const p = rb + idx[tb + t] * 4;
        const wa = wt[tb + t] * d[p + 3];
        const k = wa * (1 / 255);
        a += wa;
        r += k * d[p];
        g += k * d[p + 1];
        b += k * d[p + 2];
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
}

function hPassF32(f, sw, sh, dw, W, out) {
  const { idx, wt, cnt, maxT } = W;
  for (let y = 0; y < sh; y++) {
    const rb = y * sw * 4;
    let o = y * dw * 4;
    for (let x = 0; x < dw; x++, o += 4) {
      let r = 0, g = 0, b = 0, a = 0;
      const tb = x * maxT;
      const n = cnt[x];
      for (let t = 0; t < n; t++) {
        const p = rb + idx[tb + t] * 4;
        const w = wt[tb + t];
        r += w * f[p];
        g += w * f[p + 1];
        b += w * f[p + 2];
        a += w * f[p + 3];
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
}

function vPassF32(f, w, sh, dh, W, out) {
  const { idx, wt, cnt, maxT } = W;
  const rowLen = w * 4;
  const acc = new Float32Array(rowLen);
  for (let y = 0; y < dh; y++) {
    acc.fill(0);
    const tb = y * maxT;
    const n = cnt[y];
    for (let t = 0; t < n; t++) {
      const wgt = wt[tb + t];
      const rb = idx[tb + t] * rowLen;
      for (let i = 0; i < rowLen; i++) acc[i] += wgt * f[rb + i];
    }
    out.set(acc, y * rowLen);
  }
}

function nearestResize(img, w, h) {
  const out = createImage(w, h);
  const sw = img.width;
  const sh = img.height;
  const sBuf = img.data.byteOffset % 4 === 0 ? img.data : new Uint8ClampedArray(img.data);
  const s = new Uint32Array(sBuf.buffer, sBuf.byteOffset, sw * sh);
  const d = new Uint32Array(out.data.buffer, 0, w * h);
  const xs = new Int32Array(w);
  for (let x = 0; x < w; x++) xs[x] = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / w));
  for (let y = 0; y < h; y++) {
    const so = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / h)) * sw;
    const dO = y * w;
    for (let x = 0; x < w; x++) d[dO + x] = s[so + xs[x]];
  }
  return out;
}

/**
 * Resizes an image (new image returned). Downscaling uses a stretched kernel / area weights so it is
 * antialiased; colors are resampled premultiplied by alpha (no dark fringes).
 * @param {RGBAImage} img source
 * @param {number} width target width (>= 1)
 * @param {number} height target height (>= 1)
 * @param {{filter?: ResizeFilter}} [opts] filter: 'nearest' | 'bilinear' | 'bicubic' (Catmull-Rom, default) |
 *   'lanczos3' | 'box' (exact area average, best for large reductions)
 * @returns {RGBAImage}
 */
export function resizeImage(img, width, height, opts = {}) {
  const dw = Math.max(1, Math.round(width));
  const dh = Math.max(1, Math.round(height));
  const sw = img.width;
  const sh = img.height;
  const filter = opts.filter || "bicubic";
  if (sw === 0 || sh === 0) return createImage(dw, dh);
  if (dw === sw && dh === sh) return cloneImage(img);
  if (filter === "nearest") return nearestResize(img, dw, dh);
  const Wx = buildWeights(sw, dw, filter);
  const Wy = buildWeights(sh, dh, filter);
  let result;
  if (dw * sh <= sw * dh) {
    const tmp = new Float32Array(dw * sh * 4);
    hPassU8(img.data, sw, sh, dw, Wx, tmp);
    result = new Float32Array(dw * dh * 4);
    vPassF32(tmp, dw, sh, dh, Wy, result);
  } else {
    const src = toPremultipliedFloat(img);
    const tmp = new Float32Array(sw * dh * 4);
    vPassF32(src, sw, sh, dh, Wy, tmp);
    result = new Float32Array(dw * dh * 4);
    hPassF32(tmp, sw, dh, dw, Wx, result);
  }
  const out = createImage(dw, dh);
  return fromPremultipliedFloat(result, out);
}

// ---------------------------------------------------------------------------------------------
// Point sampling for warps
// ---------------------------------------------------------------------------------------------

const S = new Float64Array(4); // premultiplied RGBA (0..255) written by the samplers

function sampleNearest(d, W, H, sx, sy) {
  const x = Math.floor(sx + 0.5);
  const y = Math.floor(sy + 0.5);
  if (x < 0 || y < 0 || x >= W || y >= H) {
    S[0] = S[1] = S[2] = S[3] = 0;
    return;
  }
  const j = (y * W + x) * 4;
  const a = d[j + 3];
  const k = a * (1 / 255);
  S[0] = d[j] * k;
  S[1] = d[j + 1] * k;
  S[2] = d[j + 2] * k;
  S[3] = a;
}

function sampleBilinear(d, W, H, sx, sy) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (let dy = 0; dy < 2; dy++) {
    const y = y0 + dy;
    if (y < 0 || y >= H) continue;
    const wy = dy === 0 ? 1 - fy : fy;
    for (let dx = 0; dx < 2; dx++) {
      const x = x0 + dx;
      if (x < 0 || x >= W) continue;
      const w = wy * (dx === 0 ? 1 - fx : fx);
      if (w === 0) continue;
      const j = (y * W + x) * 4;
      const al = d[j + 3];
      const wa = w * al;
      const k = wa * (1 / 255);
      a += wa;
      r += k * d[j];
      g += k * d[j + 1];
      b += k * d[j + 2];
    }
  }
  S[0] = r;
  S[1] = g;
  S[2] = b;
  S[3] = a;
}

const WX = new Float64Array(4);
const WY = new Float64Array(4);

function sampleBicubic(d, W, H, sx, sy) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  for (let i = 0; i < 4; i++) {
    WX[i] = kCubic(fx - (i - 1));
    WY[i] = kCubic(fy - (i - 1));
  }
  let r = 0, g = 0, b = 0, a = 0;
  for (let j = 0; j < 4; j++) {
    const y = y0 + j - 1;
    if (y < 0 || y >= H) continue;
    const wy = WY[j];
    if (wy === 0) continue;
    for (let i = 0; i < 4; i++) {
      const x = x0 + i - 1;
      if (x < 0 || x >= W) continue;
      const w = wy * WX[i];
      if (w === 0) continue;
      const p = (y * W + x) * 4;
      const wa = w * d[p + 3];
      const k = wa * (1 / 255);
      a += wa;
      r += k * d[p];
      g += k * d[p + 1];
      b += k * d[p + 2];
    }
  }
  S[0] = r;
  S[1] = g;
  S[2] = b;
  S[3] = a;
}

function pickSampler(filter) {
  if (filter === "nearest") return 0;
  if (filter === "bicubic" || filter === "lanczos3") return 2;
  return 1;
}

function sampleWith(mode, d, W, H, sx, sy) {
  if (mode === 0) sampleNearest(d, W, H, sx, sy);
  else if (mode === 1) sampleBilinear(d, W, H, sx, sy);
  else sampleBicubic(d, W, H, sx, sy);
}

function storeSample(out, o, bg) {
  let a = S[3];
  if (a < 0) a = 0;
  else if (a > 255) a = 255;
  if (bg) {
    // composite over an opaque-or-not background color (premultiplied math)
    const ba = bg[3] / 255;
    const fa = a / 255;
    const oa = fa + ba * (1 - fa);
    if (oa <= 0) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      return;
    }
    const k = 1 - fa;
    out[o] = (S[0] + bg[0] * ba * k) / oa;
    out[o + 1] = (S[1] + bg[1] * ba * k) / oa;
    out[o + 2] = (S[2] + bg[2] * ba * k) / oa;
    out[o + 3] = oa * 255;
    return;
  }
  if (a <= 0.0005) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  const k = 255 / a;
  out[o] = S[0] * k;
  out[o + 1] = S[1] * k;
  out[o + 2] = S[2] * k;
  out[o + 3] = a;
}

// Box-reduces a source image before a strongly minifying warp, returning the image and the scale
// factors (source units per reduced unit).
function prereduce(img, minify) {
  if (minify < 2) return { img, fx: 1, fy: 1 };
  const f = Math.floor(minify);
  const nw = Math.max(1, Math.ceil(img.width / f));
  const nh = Math.max(1, Math.ceil(img.height / f));
  return { img: resizeImage(img, nw, nh, { filter: "box" }), fx: img.width / nw, fy: img.height / nh };
}

// ---------------------------------------------------------------------------------------------
// Affine warp
// ---------------------------------------------------------------------------------------------

/**
 * Warps an image with an affine matrix.
 * `mat` maps SOURCE pixel coordinates to OUTPUT coordinates, canvas style:
 *   x' = a*x + c*y + e ; y' = b*x + d*y + f   (matrix [a, b, c, d, e, f])
 * Pixel (i, j) is the square [i, i+1] x [j, j+1]. Areas of the output not covered by the source become
 * transparent (or `background`). Strong minification is pre-reduced with a box filter to avoid aliasing.
 * @param {RGBAImage} img source
 * @param {number[]} mat [a, b, c, d, e, f]
 * @param {number} outW output width
 * @param {number} outH output height
 * @param {{filter?: 'nearest'|'bilinear'|'bicubic', background?: string}} [opts] default filter 'bilinear'
 * @returns {RGBAImage}
 */
export function affineWarp(img, mat, outW, outH, opts = {}) {
  const ow = Math.max(1, Math.round(outW));
  const oh = Math.max(1, Math.round(outH));
  const out = createImage(ow, oh);
  let [a, b, c, d, e, f] = mat;
  const det = a * d - b * c;
  if (!isFinite(det) || Math.abs(det) < 1e-12) {
    if (opts.background) fillBg(out, opts.background);
    return out;
  }
  let src = img;
  const pr = prereduce(img, 1 / Math.sqrt(Math.abs(det)));
  if (pr.img !== img) {
    src = pr.img;
    a *= pr.fx; b *= pr.fx;
    c *= pr.fy; d *= pr.fy;
  }
  const inv = 1 / (a * d - b * c);
  const ia = d * inv, ib = -b * inv, ic = -c * inv, id = a * inv;
  const ie = -(ia * e + ic * f);
  const iff = -(ib * e + id * f);
  const mode = pickSampler(opts.filter || "bilinear");
  const bg = opts.background ? parseColor(opts.background) : null;
  const sd = src.data;
  const W = src.width;
  const H = src.height;
  const od = out.data;
  for (let y = 0; y < oh; y++) {
    const py = y + 0.5;
    let o = y * ow * 4;
    for (let x = 0; x < ow; x++, o += 4) {
      const px = x + 0.5;
      const u = ia * px + ic * py + ie - 0.5;
      const v = ib * px + id * py + iff - 0.5;
      sampleWith(mode, sd, W, H, u, v);
      storeSample(od, o, bg);
    }
  }
  return out;
}

function fillBg(out, color) {
  const c = parseColor(color);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
  }
}

// ---------------------------------------------------------------------------------------------
// Perspective warp
// ---------------------------------------------------------------------------------------------

function normalizeQuad(q) {
  if (typeof q[0] === "number") {
    if (q.length < 8) throw new RangeError("perspectiveWarp: quad needs 4 points");
    return [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]];
  }
  return q.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]));
}

/**
 * Maps the quadrilateral `quad` of the source onto the full output rectangle (perspective crop /
 * keystone correction). Quad corners are the source positions of the output's top-left, top-right,
 * bottom-right and bottom-left corners.
 * @param {RGBAImage} img source
 * @param {number[]|number[][]|{x:number,y:number}[]} quad [x0,y0,x1,y1,x2,y2,x3,y3] or four points
 * @param {number} outW output width
 * @param {number} outH output height
 * @param {{filter?: 'nearest'|'bilinear'|'bicubic', background?: string}} [opts] default filter 'bilinear'
 * @returns {RGBAImage}
 */
export function perspectiveWarp(img, quad, outW, outH, opts = {}) {
  const ow = Math.max(1, Math.round(outW));
  const oh = Math.max(1, Math.round(outH));
  let q = normalizeQuad(quad);
  // average minification: sqrt(quad area / output area)
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += q[i][0] * q[j][1] - q[j][0] * q[i][1];
  }
  area = Math.abs(area) / 2;
  let src = img;
  const pr = prereduce(img, Math.sqrt(area / (ow * oh)));
  if (pr.img !== img) {
    src = pr.img;
    q = q.map((p) => [p[0] / pr.fx, p[1] / pr.fy]);
  }
  const [x0, y0] = q[0], [x1, y1] = q[1], [x2, y2] = q[2], [x3, y3] = q[3];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let A, B, C, D, E, F, G, Hh;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    A = x1 - x0; B = x3 - x0; C = x0; D = y1 - y0; E = y3 - y0; F = y0; G = 0; Hh = 0;
  } else {
    const dt = dx1 * dy2 - dx2 * dy1;
    G = (dx3 * dy2 - dx2 * dy3) / dt;
    Hh = (dx1 * dy3 - dx3 * dy1) / dt;
    A = x1 - x0 + G * x1; B = x3 - x0 + Hh * x3; C = x0;
    D = y1 - y0 + G * y1; E = y3 - y0 + Hh * y3; F = y0;
  }
  const out = createImage(ow, oh);
  const mode = pickSampler(opts.filter || "bilinear");
  const bg = opts.background ? parseColor(opts.background) : null;
  const sd = src.data;
  const W = src.width;
  const H = src.height;
  const od = out.data;
  for (let y = 0; y < oh; y++) {
    const v = (y + 0.5) / oh;
    let o = y * ow * 4;
    for (let x = 0; x < ow; x++, o += 4) {
      const u = (x + 0.5) / ow;
      const den = G * u + Hh * v + 1;
      const sx = (A * u + B * v + C) / den - 0.5;
      const sy = (D * u + E * v + F) / den - 0.5;
      sampleWith(mode, sd, W, H, sx, sy);
      storeSample(od, o, bg);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------------------------

function rotate90(img, turns) {
  const t = ((turns % 4) + 4) % 4;
  const { width: w, height: h } = img;
  if (t === 0) return cloneImage(img);
  const ow = t === 2 ? w : h;
  const oh = t === 2 ? h : w;
  const out = createImage(ow, oh);
  const sBuf = img.data.byteOffset % 4 === 0 ? img.data : new Uint8ClampedArray(img.data);
  const s = new Uint32Array(sBuf.buffer, sBuf.byteOffset, w * h);
  const d = new Uint32Array(out.data.buffer, 0, ow * oh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      if (t === 1) { nx = h - 1 - y; ny = x; } // 90 degrees clockwise
      else if (t === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      d[ny * ow + nx] = s[y * w + x];
    }
  }
  return out;
}

/**
 * Rotates an image around its center. Multiples of 90 degrees are lossless pixel moves.
 * @param {RGBAImage} img
 * @param {number} degrees clockwise (screen orientation, y down)
 * @param {{filter?: 'nearest'|'bilinear'|'bicubic', expand?: boolean, background?: string}} [opts]
 *   `expand` (default true) grows the canvas to hold the whole rotated image, otherwise the size is kept;
 *   default filter 'bicubic'
 * @returns {RGBAImage}
 */
export function rotateImage(img, degrees, opts = {}) {
  const expand = opts.expand !== false;
  const quarter = degrees / 90;
  if (Math.abs(quarter - Math.round(quarter)) < 1e-9 && (expand || Math.round(quarter) % 2 === 0 || img.width === img.height)) {
    return rotate90(img, Math.round(quarter));
  }
  const rad = (degrees * Math.PI) / 180;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  const w = img.width;
  const h = img.height;
  const ow = expand ? Math.max(1, Math.ceil(Math.abs(w * cs) + Math.abs(h * sn) - 1e-9)) : w;
  const oh = expand ? Math.max(1, Math.ceil(Math.abs(w * sn) + Math.abs(h * cs) - 1e-9)) : h;
  const cx = w / 2;
  const cy = h / 2;
  const dcx = ow / 2;
  const dcy = oh / 2;
  const mat = [cs, sn, -sn, cs, dcx - cs * cx + sn * cy, dcy - sn * cx - cs * cy];
  return affineWarp(img, mat, ow, oh, { filter: opts.filter || "bicubic", background: opts.background });
}
