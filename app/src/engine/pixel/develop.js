// RAW-style "Develop" pipeline and local tone mapping, both working on float planes.
//
// DEVELOP order: white balance + exposure in LINEAR light (a 256-entry float table, so there is no
// clipping at 1.0 and highlights can still be pulled back) -> noise reduction -> local highlights /
// shadows -> whites / blacks / contrast / tone curve (one combined table) -> dehaze -> clarity ->
// vibrance / saturation / per-band HSL -> sharpening -> vignette -> grain -> 8-bit output.
// Everything after the linear stage works on sRGB-encoded values. Stages whose parameters are neutral
// are skipped, and an all-default parameter set returns the image untouched.

import { clamp, clamp01, smoothstep } from "./image.js";
import { rgbToHsl, hslToRgb, HSL_OUT, RGB_OUT, SRGB_TO_LINEAR, linearToSrgb, encodeSrgbFast } from "./color.js";
import { gaussianBlurPlane, guidedFilter, guidedFilterSelf, transposePlane } from "./blur.js";
import { gaussianTable } from "./fx-detail.js";
import { buildCurveFloat, whiteBalanceGains } from "./adjustments.js";
import { defineEffect, rangeControl as range, intControl } from "./effect.js";

/**
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RGBAImage
 * @typedef {import('./effect.js').EffectModule} EffectModule
 */

const LUT_N = 4096;

function lumaFloat(R, G, B, Y, n) {
  for (let i = 0; i < n; i++) Y[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
}

// van Herk style sliding minimum along rows using a monotonic queue.
function rowMin(src, w, h, r, dst) {
  const dq = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let head = 0, tail = 0, next = 0;
    for (let i = 0; i < w; i++) {
      const hi = i + r < w - 1 ? i + r : w - 1;
      while (next <= hi) {
        const v = src[o + next];
        while (tail > head && src[o + dq[tail - 1]] >= v) tail--;
        dq[tail++] = next++;
      }
      const lo = i - r;
      while (dq[head] < lo) head++;
      dst[o + i] = src[o + dq[head]];
    }
  }
}

/**
 * Square minimum filter (erosion) of a plane with window radius r, edges clamped.
 * @param {Float32Array} plane modified in place
 * @param {Float32Array} scratch w*h
 * @param {number} w
 * @param {number} h
 * @param {number} r integer radius
 */
export function minFilterPlane(plane, scratch, w, h, r) {
  if (r < 1) return;
  rowMin(plane, w, h, r, scratch);
  transposePlane(scratch, plane, w, h);
  rowMin(plane, h, w, r, scratch);
  transposePlane(scratch, plane, h, w);
}

// Logistic contrast curve on 0..1 (identity at 0). amount -1..1.
function contrastFn(x, amount) {
  if (amount === 0) return x;
  if (amount > 0) {
    const k = amount * 6;
    const s0 = 1 / (1 + Math.exp(0.5 * k));
    const s1 = 1 / (1 + Math.exp(-0.5 * k));
    return (1 / (1 + Math.exp(-k * (x - 0.5))) - s0) / (s1 - s0);
  }
  const k = -amount * 4;
  const s0 = 1 / (1 + Math.exp(0.5 * k));
  const s1 = 1 / (1 + Math.exp(-0.5 * k));
  const y = s0 + x * (s1 - s0);
  return 0.5 + Math.log(y / (1 - y)) / k;
}

function isIdentityCurve(pts) {
  if (!pts || pts.length < 2) return true;
  const f = buildCurveFloat(pts, 64);
  for (let i = 0; i < 64; i++) if (Math.abs(f[i] - i / 63) > 1e-4) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Develop stages
// ---------------------------------------------------------------------------------------------

function noiseReduction(P, w, h, lum, col, radius) {
  const n = w * h;
  const { R, G, B } = P;
  const Y = new Float32Array(n);
  const Cb = new Float32Array(n);
  const Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = R[i], g = G[i], b = B[i];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = 0.5 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const scratch = new Float32Array(n);
  const rr = Math.max(1, radius);
  if (col > 0) {
    const e = ((col / 100) * 40) / 255;
    guidedFilter(Y, Cb, w, h, rr * 2, e * e + 1e-6, Cb, scratch);
    guidedFilter(Y, Cr, w, h, rr * 2, e * e + 1e-6, Cr, scratch);
  }
  if (lum > 0) {
    const e = ((lum / 100) * 30) / 255;
    guidedFilterSelf(Y, w, h, rr, e * e + 1e-6, Y, scratch);
  }
  for (let i = 0; i < n; i++) {
    const y = Y[i], cb = Cb[i] - 0.5, cr = Cr[i] - 0.5;
    R[i] = y + 1.402 * cr;
    G[i] = y - 0.344136 * cb - 0.714136 * cr;
    B[i] = y + 1.772 * cb;
  }
}

function highlightsShadows(P, w, h, shadows, highlights, sigma) {
  const n = w * h;
  const { R, G, B } = P;
  const Bl = new Float32Array(n);
  lumaFloat(R, G, B, Bl, n);
  gaussianBlurPlane(Bl, new Float32Array(n), w, h, sigma, sigma);
  const NB = 128;
  const NC = 1024;
  const CMAX = 1.5;
  const tab = new Float32Array(NB * NC);
  const as = shadows / 100;
  const ah = highlights / 100;
  for (let b = 0; b < NB; b++) {
    const bb = (b + 0.5) / NB;
    const ws = (1 - bb) * (1 - bb);
    const wh = bb * bb * (bb > 0.3 ? 1 : bb / 0.3);
    // exponent applied to the channel: < 1 brightens, > 1 darkens
    let e = 1;
    if (as > 0) e *= 1 / (1 + as * ws * 3);
    else if (as < 0) e *= 1 + -as * ws * 2;
    if (ah < 0) e *= 1 + -ah * wh * 2.5;
    else if (ah > 0) e *= 1 / (1 + ah * wh * 1.5);
    for (let c = 0; c < NC; c++) tab[b * NC + c] = e === 1 ? (c / (NC - 1)) * CMAX : Math.pow((c / (NC - 1)) * CMAX, e);
  }
  const cs = (NC - 1) / CMAX;
  for (let i = 0; i < n; i++) {
    let bi = (Bl[i] * NB) | 0;
    bi = bi < 0 ? 0 : bi >= NB ? NB - 1 : bi;
    const row = bi * NC;
    let c = R[i]; c = c < 0 ? 0 : c > CMAX ? CMAX : c; R[i] = tab[row + ((c * cs + 0.5) | 0)];
    c = G[i]; c = c < 0 ? 0 : c > CMAX ? CMAX : c; G[i] = tab[row + ((c * cs + 0.5) | 0)];
    c = B[i]; c = c < 0 ? 0 : c > CMAX ? CMAX : c; B[i] = tab[row + ((c * cs + 0.5) | 0)];
  }
}

function toneLUT(p) {
  const lut = new Float32Array(LUT_N + 1);
  const bp = (-p.blacks / 100) * 0.25;
  const wp = p.whites >= 0 ? 1 - (p.whites / 100) * 0.25 : 1 + (-p.whites / 100) * 0.25;
  const span = Math.max(0.05, wp - bp);
  const c = clamp(p.contrast, -100, 100) / 100;
  const curve = isIdentityCurve(p.toneCurve) ? null : buildCurveFloat(p.toneCurve, LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) {
    let x = i / LUT_N;
    x = clamp01((x - bp) / span);
    x = clamp01(contrastFn(x, c));
    if (curve) x = curve[Math.round(x * LUT_N)];
    lut[i] = x;
  }
  return lut;
}

function applyToneLUT(P, n, lut) {
  const { R, G, B } = P;
  for (let i = 0; i < n; i++) {
    let x = R[i]; x = x < 0 ? 0 : x > 1 ? 1 : x; R[i] = lut[(x * LUT_N + 0.5) | 0];
    x = G[i]; x = x < 0 ? 0 : x > 1 ? 1 : x; G[i] = lut[(x * LUT_N + 0.5) | 0];
    x = B[i]; x = x < 0 ? 0 : x > 1 ? 1 : x; B[i] = lut[(x * LUT_N + 0.5) | 0];
  }
}

function dehaze(P, w, h, amount) {
  const n = w * h;
  const { R, G, B } = P;
  if (amount < 0) {
    const k = -amount * 0.5;
    const ar = 0.84, ag = 0.87, ab = 0.92;
    for (let i = 0; i < n; i++) {
      R[i] = R[i] * (1 - k) + ar * k;
      G[i] = G[i] * (1 - k) + ag * k;
      B[i] = B[i] * (1 - k) + ab * k;
    }
    return;
  }
  const rho = Math.max(2, Math.round(0.006 * Math.max(w, h)));
  const dark = new Float32Array(n);
  const scratch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = R[i], g = G[i], b = B[i];
    dark[i] = r < g ? (r < b ? r : b) : g < b ? g : b;
  }
  minFilterPlane(dark, scratch, w, h, rho);
  // atmospheric light: brightest pixel among the top 0.1 % of the dark channel
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.min(255, Math.max(0, (dark[i] * 255) | 0))]++;
  let acc = 0, thr = 255;
  const target = Math.max(1, n * 0.001);
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= target) {
      thr = v;
      break;
    }
  }
  let ar = 0.8, ag = 0.8, ab = 0.8, best = -1;
  for (let i = 0; i < n; i++) {
    if (((dark[i] * 255) | 0) >= thr) {
      const s = R[i] + G[i] + B[i];
      if (s > best) {
        best = s;
        ar = R[i]; ag = G[i]; ab = B[i];
      }
    }
  }
  ar = clamp(ar, 0.6, 1.2); ag = clamp(ag, 0.6, 1.2); ab = clamp(ab, 0.6, 1.2);
  const amean = (ar + ag + ab) / 3;
  // transmission map from the (blurred) dark channel
  gaussianBlurPlane(dark, scratch, w, h, rho * 0.75, rho * 0.75);
  const omega = 0.9 * amount;
  for (let i = 0; i < n; i++) {
    let t = 1 - omega * (dark[i] / amean);
    if (t < 0.25) t = 0.25;
    const it = 1 / t;
    R[i] = (R[i] - ar) * it + ar;
    G[i] = (G[i] - ag) * it + ag;
    B[i] = (B[i] - ab) * it + ab;
  }
}

function clarityStage(P, w, h, amount, sigma) {
  const n = w * h;
  const { R, G, B } = P;
  const Y = new Float32Array(n);
  const Bl = new Float32Array(n);
  lumaFloat(R, G, B, Y, n);
  Bl.set(Y);
  gaussianBlurPlane(Bl, new Float32Array(n), w, h, sigma, sigma);
  for (let i = 0; i < n; i++) {
    const y = clamp01(Y[i]);
    const t = 2 * y - 1;
    const delta = amount * (Y[i] - Bl[i]) * (1 - 0.8 * t * t);
    R[i] += delta;
    G[i] += delta;
    B[i] += delta;
  }
}

const HSL_BANDS = [
  ["red", 0],
  ["orange", 30],
  ["yellow", 60],
  ["green", 120],
  ["aqua", 180],
  ["blue", 240],
  ["purple", 270],
  ["magenta", 300],
];

function colorStage(P, n, vibrance, saturation, bands, skip) {
  const { R, G, B } = P;
  const v = vibrance / 100;
  const s = saturation / 100;
  const sk = 1 + s;
  // band adjustment tables (hue shift deg, sat factor delta, light delta)
  let bh = null, bs = null, bl = null;
  if (bands) {
    bh = bands.hue; bs = bands.sat; bl = bands.lum;
  }
  for (let i = 0; i < n; i++) {
    let r = R[i], g = G[i], b = B[i];
    if (v !== 0 || s !== 0) {
      const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
      const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
      const sat = mx > 1e-4 ? (mx - mn) / mx : 0;
      let k = sk;
      if (v > 0) {
        let wv = 1 - sat;
        wv *= wv;
        if (skip && r > g && g >= b && r > mn) {
          const hh = (60 * (g - b)) / (r - b);
          const sw = 1 - Math.abs(hh - 25) / 30;
          if (sw > 0) wv *= 1 - 0.65 * sw;
        }
        k *= 1 + v * wv * 2;
      } else if (v < 0) {
        k *= 1 + v * (0.25 + 0.75 * sat);
      }
      if (k < 0) k = 0;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * k;
      g = l + (g - l) * k;
      b = l + (b - l) * k;
    }
    if (bands) {
      const rc = r < 0 ? 0 : r > 1 ? 1 : r, gc = g < 0 ? 0 : g > 1 ? 1 : g, bc = b < 0 ? 0 : b > 1 ? 1 : b;
      rgbToHsl(rc * 255, gc * 255, bc * 255);
      const hue = HSL_OUT[0], sa = HSL_OUT[1], li = HSL_OUT[2];
      const mx = rc > gc ? (rc > bc ? rc : bc) : gc > bc ? gc : bc;
      const mn = rc < gc ? (rc < bc ? rc : bc) : gc < bc ? gc : bc;
      const cw = smoothstep(0.02, 0.2, mx - mn);
      if (cw > 0) {
        // locate hue between two band centers
        let k0 = 0;
        for (let q = 0; q < 8; q++) if (hue >= HSL_BANDS[q][1]) k0 = q;
        const k1 = (k0 + 1) % 8;
        const h0 = HSL_BANDS[k0][1];
        const h1 = k0 === 7 ? 360 : HSL_BANDS[k1][1];
        const t = (hue - h0) / (h1 - h0);
        const dh = bh[k0] + (bh[k1] - bh[k0]) * t;
        const ds = bs[k0] + (bs[k1] - bs[k0]) * t;
        const dl = bl[k0] + (bl[k1] - bl[k0]) * t;
        let ns = ds > 0 ? sa + (1 - sa) * ds * cw : sa * (1 + ds * cw);
        let nl = li + dl * cw;
        ns = ns < 0 ? 0 : ns > 1 ? 1 : ns;
        nl = nl < 0 ? 0 : nl > 1 ? 1 : nl;
        hslToRgb(hue + dh * cw, ns, nl);
        r = RGB_OUT[0] / 255;
        g = RGB_OUT[1] / 255;
        b = RGB_OUT[2] / 255;
      }
    }
    R[i] = r;
    G[i] = g;
    B[i] = b;
  }
}

function sharpenStage(P, w, h, amount, sigma, masking) {
  const n = w * h;
  const { R, G, B } = P;
  const Y = new Float32Array(n);
  const Bl = new Float32Array(n);
  lumaFloat(R, G, B, Y, n);
  Bl.set(Y);
  gaussianBlurPlane(Bl, new Float32Array(n), w, h, sigma, sigma);
  const mk = masking / 100;
  const edge = mk * 0.12;
  for (let i = 0; i < n; i++) {
    const diff = Y[i] - Bl[i];
    let wgt = 1;
    if (mk > 0) {
      const a = diff < 0 ? -diff : diff;
      wgt = smoothstep(0, edge, a);
    }
    const delta = amount * diff * wgt;
    R[i] += delta;
    G[i] += delta;
    B[i] += delta;
  }
}

function vignetteStage(P, w, h, amount, midpoint, feather, roundness) {
  const { R, G, B } = P;
  const cx = w / 2, cy = h / 2;
  const circ = roundness > 0 ? roundness : 0;
  const sq = roundness < 0 ? -roundness : 0;
  const R0 = Math.sqrt(cx * cx + cy * cy);
  const rx = cx * Math.SQRT2 * (1 - circ) + R0 * circ;
  const ry = cy * Math.SQRT2 * (1 - circ) + R0 * circ;
  const inner = Math.min(0.98, midpoint);
  const outer = Math.max(inner + 0.02, inner + feather * (1.2 - inner));
  for (let y = 0; y < h; y++) {
    const dy = (y + 0.5 - cy) / ry;
    const dyc = Math.abs(y + 0.5 - cy) / cy;
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / rx;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (sq > 0) {
        const dxc = Math.abs(x + 0.5 - cx) / cx;
        dist = dist * (1 - sq) + (dxc > dyc ? dxc : dyc) * sq;
      }
      let t = (dist - inner) / (outer - inner);
      if (t <= 0) continue;
      if (t > 1) t = 1;
      t = t * t * (3 - 2 * t);
      const i = y * w + x;
      if (amount < 0) {
        const k = 1 + amount * t;
        R[i] *= k;
        G[i] *= k;
        B[i] *= k;
      } else {
        const k = amount * t;
        R[i] += (1 - R[i]) * k;
        G[i] += (1 - G[i]) * k;
        B[i] += (1 - B[i]) * k;
      }
    }
  }
}

function grainStage(P, w, h, amount, size, roughness, seed, scale) {
  const n = w * h;
  const { R, G, B } = P;
  const sigma = (amount / 100) * 0.1;
  const sPx = Math.max(1, (1 + (size / 100) * 3.5) * scale);
  const table = gaussianTable(seed);
  let s = (Math.imul(seed | 0, 2654435761) ^ 0x2545f491) | 0;
  if (s === 0) s = 0x1234567;
  const rough = clamp01(roughness / 100);
  const coarse = sPx > 1.2;
  let grid = null, gw = 0, gh = 0;
  if (coarse) {
    gw = Math.ceil(w / sPx) + 2;
    gh = Math.ceil(h / sPx) + 2;
    grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      grid[i] = table[s & 0x7fff];
    }
  }
  const norm = coarse ? 1 / Math.sqrt((1 - rough) * (1 - rough) + rough * rough) : 1;
  for (let y = 0; y < h; y++) {
    let gy = 0, j = 0, ty = 0;
    if (coarse) {
      gy = (y + 0.5) / sPx;
      j = gy | 0;
      ty = gy - j;
    }
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      let nz = table[s & 0x7fff];
      if (coarse) {
        const gx = (x + 0.5) / sPx;
        const k = gx | 0;
        const tx = gx - k;
        const a = j * gw + k;
        const c = grid[a] * (1 - tx) * (1 - ty) + grid[a + 1] * tx * (1 - ty) + grid[a + gw] * (1 - tx) * ty + grid[a + gw + 1] * tx * ty;
        nz = (c * (1 - rough) + nz * rough) * norm;
      }
      const y0 = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
      const yc = y0 < 0 ? 0 : y0 > 1 ? 1 : y0;
      const t = 2 * yc - 1;
      const d = nz * sigma * (1 - 0.6 * t * t);
      R[i] += d;
      G[i] += d;
      B[i] += d;
    }
  }
}

function developApply(img, p, ctx) {
  const w = img.width;
  const h = img.height;
  const n = w * h;
  if (n === 0) return img;
  const scale = ctx.scale;
  const hasWB = p.temperature !== 0 || p.tint !== 0;
  const hasExp = p.exposure !== 0;
  const hasNR = p.luminanceNR > 0 || p.colorNR > 0;
  const hasHS = p.highlights !== 0 || p.shadows !== 0;
  const curveActive = !isIdentityCurve(p.toneCurve);
  const hasTone = p.whites !== 0 || p.blacks !== 0 || p.contrast !== 0 || curveActive;
  const hasDehaze = p.dehaze !== 0;
  const hasClarity = p.clarity !== 0;
  let bands = null;
  {
    const hue = new Float64Array(8), sat = new Float64Array(8), lum = new Float64Array(8);
    let any = false;
    HSL_BANDS.forEach(([name], i) => {
      const cap = name[0].toUpperCase() + name.slice(1);
      hue[i] = (clamp(p["hsl" + cap + "Hue"] || 0, -100, 100) / 100) * 30;
      sat[i] = clamp(p["hsl" + cap + "Sat"] || 0, -100, 100) / 100;
      lum[i] = (clamp(p["hsl" + cap + "Lum"] || 0, -100, 100) / 100) * 0.3;
      if (hue[i] !== 0 || sat[i] !== 0 || lum[i] !== 0) any = true;
    });
    if (any) bands = { hue, sat, lum };
  }
  const hasColor = p.vibrance !== 0 || p.saturation !== 0 || bands;
  const hasSharpen = p.sharpenAmount > 0;
  const hasVignette = p.vignetteAmount !== 0;
  const hasGrain = p.grainAmount > 0;
  if (!(hasWB || hasExp || hasNR || hasHS || hasTone || hasDehaze || hasClarity || hasColor || hasSharpen || hasVignette || hasGrain)) return img;

  const d = img.data;
  const P = { R: new Float32Array(n), G: new Float32Array(n), B: new Float32Array(n) };
  // Stage 1: white balance + exposure in linear light (float table, no clipping).
  {
    const ev = Math.pow(2, p.exposure);
    const g = hasWB ? whiteBalanceGains(p.temperature, p.tint) : [1, 1, 1];
    const tabs = [0, 1, 2].map((c) => {
      const t = new Float32Array(256);
      const gain = g[c] * ev;
      for (let i = 0; i < 256; i++) t[i] = gain === 1 ? i / 255 : linearToSrgb(Math.max(0, SRGB_TO_LINEAR[i] * gain));
      return t;
    });
    const { R, G, B } = P;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      R[i] = tabs[0][d[j]];
      G[i] = tabs[1][d[j + 1]];
      B[i] = tabs[2][d[j + 2]];
    }
  }
  const diag = Math.max(w, h);
  if (hasNR) noiseReduction(P, w, h, p.luminanceNR, p.colorNR, 1.5 * scale);
  if (hasHS) highlightsShadows(P, w, h, p.shadows, p.highlights, Math.max(2, 0.015 * diag));
  if (hasTone) applyToneLUT(P, n, toneLUT(p));
  if (hasDehaze) dehaze(P, w, h, p.dehaze / 100);
  if (hasClarity) clarityStage(P, w, h, p.clarity / 100, Math.max(3, 0.012 * diag));
  if (hasColor) colorStage(P, n, p.vibrance, p.saturation, bands, true);
  if (hasSharpen) sharpenStage(P, w, h, p.sharpenAmount / 100, Math.max(0.3, p.sharpenRadius * scale), p.sharpenMasking);
  if (hasVignette) vignetteStage(P, w, h, p.vignetteAmount / 100, p.vignetteMidpoint / 100, p.vignetteFeather / 100, p.vignetteRoundness / 100);
  if (hasGrain) grainStage(P, w, h, p.grainAmount, p.grainSize, p.grainRoughness, p.grainSeed, scale);
  const { R, G, B } = P;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (d[j + 3] === 0) continue;
    d[j] = R[i] * 255;
    d[j + 1] = G[i] * 255;
    d[j + 2] = B[i] * 255;
  }
  return img;
}

function developControls() {
  const c = [];
  const g = (group, ctrl) => {
    ctrl.group = group;
    c.push(ctrl);
  };
  g("Basic", range("temperature", "Temperature", -100, 100, 0));
  g("Basic", range("tint", "Tint", -100, 100, 0));
  g("Basic", range("exposure", "Exposure", -5, 5, 0, { step: 0.01, unit: " EV" }));
  g("Basic", range("contrast", "Contrast", -100, 100, 0));
  g("Basic", range("highlights", "Highlights", -100, 100, 0));
  g("Basic", range("shadows", "Shadows", -100, 100, 0));
  g("Basic", range("whites", "Whites", -100, 100, 0));
  g("Basic", range("blacks", "Blacks", -100, 100, 0));
  g("Presence", range("clarity", "Clarity", -100, 100, 0));
  g("Presence", range("dehaze", "Dehaze", -100, 100, 0));
  g("Presence", range("vibrance", "Vibrance", -100, 100, 0));
  g("Presence", range("saturation", "Saturation", -100, 100, 0));
  g("Tone Curve", { key: "toneCurve", label: "Tone Curve", type: "curve", default: [[0, 0], [1, 1]] });
  for (const [name] of HSL_BANDS) {
    const cap = name[0].toUpperCase() + name.slice(1);
    g("HSL " + cap, range("hsl" + cap + "Hue", "Hue", -100, 100, 0));
    g("HSL " + cap, range("hsl" + cap + "Sat", "Saturation", -100, 100, 0));
    g("HSL " + cap, range("hsl" + cap + "Lum", "Luminance", -100, 100, 0));
  }
  g("Detail", range("sharpenAmount", "Sharpening Amount", 0, 150, 0));
  g("Detail", range("sharpenRadius", "Sharpening Radius", 0.5, 3, 1, { step: 0.1, unit: "px" }));
  g("Detail", range("sharpenMasking", "Sharpening Masking", 0, 100, 0));
  g("Detail", range("luminanceNR", "Luminance Noise Reduction", 0, 100, 0));
  g("Detail", range("colorNR", "Color Noise Reduction", 0, 100, 0));
  g("Effects", range("vignetteAmount", "Vignette Amount", -100, 100, 0));
  g("Effects", range("vignetteMidpoint", "Vignette Midpoint", 0, 100, 50));
  g("Effects", range("vignetteFeather", "Vignette Feather", 0, 100, 50));
  g("Effects", range("vignetteRoundness", "Vignette Roundness", -100, 100, 0));
  g("Effects", range("grainAmount", "Grain Amount", 0, 100, 0));
  g("Effects", range("grainSize", "Grain Size", 0, 100, 25));
  g("Effects", range("grainRoughness", "Grain Roughness", 0, 100, 50));
  g("Effects", intControl("grainSeed", "Grain Seed", 0, 99999, 1));
  return c;
}

/**
 * RAW-style Develop module (id 'develop'). Float pipeline: white balance, exposure, noise reduction,
 * highlights / shadows, whites / blacks / contrast / tone curve, dehaze, clarity, vibrance / saturation /
 * per-band HSL, sharpening, vignette, grain. Neutral (default) parameters return the image unchanged.
 * Radii of sharpening, noise reduction and grain are multiplied by `ctx.scale`; local-contrast radii are
 * relative to the image size.
 * @type {EffectModule}
 */
export const DEVELOP = defineEffect("develop", "Develop", "Develop", developControls(), {}, developApply);

// ---------------------------------------------------------------------------------------------
// Local tone mapping
// ---------------------------------------------------------------------------------------------

function toneMapApply(img, p) {
  const strength = clamp01(p.strength / 100);
  const detailParam = clamp(p.detail, -100, 100) / 100;
  const contrast = clamp(p.contrast, -100, 100) / 100;
  const sat = clamp(p.saturation, -100, 100) / 100;
  if (strength === 0 && detailParam === 0 && contrast === 0 && sat === 0) return img;
  const w = img.width;
  const h = img.height;
  const n = w * h;
  if (n === 0) return img;
  const d = img.data;
  const smoothing = clamp01(p.smoothing / 100);
  const lin = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const L = new Float32Array(n); // log2 luminance
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = SRGB_TO_LINEAR[d[j]], g = SRGB_TO_LINEAR[d[j + 1]], b = SRGB_TO_LINEAR[d[j + 2]];
    lin[0][i] = r;
    lin[1][i] = g;
    lin[2][i] = b;
    L[i] = Math.log2(0.2126 * r + 0.7152 * g + 0.0722 * b + 1e-4);
  }
  const base = new Float32Array(n);
  const scratch = new Float32Array(n);
  const radius = Math.max(2, (0.008 + 0.04 * smoothing) * Math.max(w, h));
  const eps = 0.0625 * (0.5 + 1.5 * smoothing);
  guidedFilterSelf(L, w, h, radius, eps, base, scratch);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += base[i];
  mean /= n;
  const compress = 1 - 0.85 * strength;
  const gain = (1 + 0.3 * strength) * Math.pow(2, detailParam * 1.2);
  const ratioExp = 1 + sat * 0.6;
  const contrastLut = contrast === 0 ? null : (() => {
    const t = new Float32Array(1025);
    for (let i = 0; i <= 1024; i++) t[i] = clamp01(contrastFn(i / 1024, contrast));
    return t;
  })();
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const detail = L[i] - base[i];
    const lo = mean + (base[i] - mean) * compress + detail * gain;
    const Lout = Math.pow(2, lo) - 1e-4;
    const Lin = Math.pow(2, L[i]) - 1e-4;
    const inv = Lin > 1e-6 ? 1 / Lin : 0;
    let r, g, b;
    if (inv === 0) {
      r = g = b = Lout > 0 ? Lout : 0;
    } else if (ratioExp === 1) {
      r = lin[0][i] * inv * Lout;
      g = lin[1][i] * inv * Lout;
      b = lin[2][i] * inv * Lout;
    } else {
      r = Math.pow(lin[0][i] * inv, ratioExp) * Lout;
      g = Math.pow(lin[1][i] * inv, ratioExp) * Lout;
      b = Math.pow(lin[2][i] * inv, ratioExp) * Lout;
    }
    if (d[j + 3] === 0) continue;
    let er = encodeSrgbFast(r), eg = encodeSrgbFast(g), eb = encodeSrgbFast(b);
    if (contrastLut) {
      er = contrastLut[(er * 1024 + 0.5) | 0];
      eg = contrastLut[(eg * 1024 + 0.5) | 0];
      eb = contrastLut[(eb * 1024 + 0.5) | 0];
    }
    d[j] = er * 255;
    d[j + 1] = eg * 255;
    d[j + 2] = eb * 255;
  }
  return img;
}

/**
 * Local tone mapping (id 'tone-mapping'): splits log luminance into an edge-preserving base layer
 * (guided filter) and a detail layer, compresses the base layer and re-adds the detail, then restores
 * color ratios. Neutral parameters (strength 0, detail 0, contrast 0, saturation 0) return the image unchanged.
 * Filter radii are relative to the image size, so previews at any `ctx.scale` match the full result.
 * @type {EffectModule}
 */
export const TONEMAP = defineEffect(
  "tone-mapping",
  "Tone Mapping",
  "Develop",
  [
    range("strength", "Strength", 0, 100, 50, { unit: "%", hint: "How much the overall contrast of bright and dark regions is compressed." }),
    range("detail", "Detail", -100, 100, 0, { hint: "Boosts (or softens) fine local contrast." }),
    range("contrast", "Contrast", -100, 100, 0),
    range("saturation", "Saturation", -100, 100, 0),
    range("smoothing", "Smoothing", 0, 100, 50, { unit: "%", hint: "Size of the regions that are treated as one brightness zone; higher = fewer halos but flatter." }),
  ],
  {},
  toneMapApply,
);
