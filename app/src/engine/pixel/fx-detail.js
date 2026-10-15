// Sharpening, local contrast, noise and relief algorithms behind the "Sharpen", "Noise" and
// "Stylize" filters. Internal module: the public surface is FILTERS in filters.js.

import { createImage } from "./image.js";
import { gaussianBlurImage, gaussianBlurPlane, lumaPlane, guidedFilter, guidedFilterSelf } from "./blur.js";

// ---------------------------------------------------------------------------------------------
// Sharpen family
// ---------------------------------------------------------------------------------------------

/**
 * Unsharp mask: img += amount * (img - blur(img)) where the difference exceeds `threshold`.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} amount strength factor (1 = 100 %)
 * @param {number} sigma blur radius in px
 * @param {number} threshold minimum per-channel difference (0..255) that gets sharpened
 * @returns {typeof img}
 */
export function unsharpMask(img, amount, sigma, threshold) {
  if (amount === 0 || !(sigma > 0.05)) return img;
  const bl = gaussianBlurImage(img, sigma, sigma, createImage(img.width, img.height));
  const d = img.data;
  const b = bl.data;
  for (let j = 0, n = d.length; j < n; j += 4) {
    if (d[j + 3] === 0) continue;
    let df = d[j] - b[j];
    if (df >= threshold || -df >= threshold) d[j] += df * amount;
    df = d[j + 1] - b[j + 1];
    if (df >= threshold || -df >= threshold) d[j + 1] += df * amount;
    df = d[j + 2] - b[j + 2];
    if (df >= threshold || -df >= threshold) d[j + 2] += df * amount;
  }
  return img;
}

/**
 * Classic 3x3 Laplacian sharpen (img += amount * (4c - sum of the 4 neighbors)). Transparent
 * neighbors are replaced by the center pixel so edges next to transparency stay clean.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} amount strength factor (1 = classic [0 -1 0; -1 5 -1; 0 -1 0])
 * @returns {typeof img}
 */
export function sharpen(img, amount) {
  if (amount === 0) return img;
  const W = img.width;
  const H = img.height;
  const d = img.data;
  const s = new Uint8ClampedArray(d);
  for (let y = 0; y < H; y++) {
    const up = y > 0 ? -W * 4 : 0;
    const dn = y < H - 1 ? W * 4 : 0;
    for (let x = 0; x < W; x++) {
      const j = (y * W + x) * 4;
      if (s[j + 3] === 0) continue;
      let ju = j + up, jd = j + dn, jl = j + (x > 0 ? -4 : 0), jr = j + (x < W - 1 ? 4 : 0);
      if (s[ju + 3] === 0) ju = j;
      if (s[jd + 3] === 0) jd = j;
      if (s[jl + 3] === 0) jl = j;
      if (s[jr + 3] === 0) jr = j;
      const r = s[j], g = s[j + 1], b = s[j + 2];
      d[j] = r + amount * (4 * r - s[ju] - s[jd] - s[jl] - s[jr]);
      d[j + 1] = g + amount * (4 * g - s[ju + 1] - s[jd + 1] - s[jl + 1] - s[jr + 1]);
      d[j + 2] = b + amount * (4 * b - s[ju + 2] - s[jd + 2] - s[jl + 2] - s[jr + 2]);
    }
  }
  return img;
}

/**
 * Clarity: midtone-weighted local contrast. The luma difference to a wide Gaussian blur is added
 * to all channels equally, so hues are preserved.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} amount -1..1 (negative softens)
 * @param {number} sigma blur radius in px
 * @returns {typeof img}
 */
export function clarity(img, amount, sigma) {
  if (amount === 0) return img;
  const w = img.width;
  const h = img.height;
  const n = w * h;
  const B = lumaPlane(img, new Float32Array(n));
  gaussianBlurPlane(B, new Float32Array(n), w, h, sigma, sigma);
  const d = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (d[j + 3] === 0) continue;
    const r = d[j], g = d[j + 1], b = d[j + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const t = l * (2 / 255) - 1;
    const wgt = 1 - 0.8 * t * t;
    const delta = amount * (l - B[i]) * wgt;
    d[j] = r + delta;
    d[j + 1] = g + delta;
    d[j + 2] = b + delta;
  }
  return img;
}

/**
 * High-pass: 128 + (img - blur(img)) * strength.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} sigma blur radius in px
 * @param {number} strength factor (1 = 100 %)
 * @param {boolean} mono luma-only result (gray)
 * @returns {typeof img}
 */
export function highPass(img, sigma, strength, mono) {
  const bl = gaussianBlurImage(img, sigma, sigma, createImage(img.width, img.height));
  const d = img.data;
  const b = bl.data;
  for (let j = 0, n = d.length; j < n; j += 4) {
    if (d[j + 3] === 0) continue;
    if (mono) {
      const dl = 0.299 * (d[j] - b[j]) + 0.587 * (d[j + 1] - b[j + 1]) + 0.114 * (d[j + 2] - b[j + 2]);
      const v = 128 + dl * strength;
      d[j] = d[j + 1] = d[j + 2] = v;
    } else {
      d[j] = 128 + (d[j] - b[j]) * strength;
      d[j + 1] = 128 + (d[j + 1] - b[j + 1]) * strength;
      d[j + 2] = 128 + (d[j + 2] - b[j + 2]) * strength;
    }
  }
  return img;
}

// ---------------------------------------------------------------------------------------------
// Median
// ---------------------------------------------------------------------------------------------

/**
 * Median filter with a (2r+1)^2 square window per channel (Huang's sliding histogram, O(r) per pixel).
 * Fully transparent pixels are ignored when forming the median.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} radius integer window radius (>= 1)
 * @returns {typeof img}
 */
export function medianFilter(img, radius) {
  const r = Math.max(1, Math.round(radius));
  const W = img.width;
  const H = img.height;
  const src = new Uint8ClampedArray(img.data);
  const dst = img.data;
  const hist = new Int32Array(256);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < H; y++) {
      hist.fill(0);
      let cnt = 0;
      let med = 0;
      let lt = 0;
      for (let yy = y - r; yy <= y + r; yy++) {
        const ry = (yy < 0 ? 0 : yy >= H ? H - 1 : yy) * W;
        for (let xx = -r; xx <= r; xx++) {
          const p = (ry + (xx < 0 ? 0 : xx >= W ? W - 1 : xx)) * 4;
          if (src[p + 3] !== 0) {
            hist[src[p + c]]++;
            cnt++;
          }
        }
      }
      for (let x = 0; x < W; x++) {
        if (x > 0) {
          const xr = x - 1 - r < 0 ? 0 : x - 1 - r;
          const xa = x + r >= W ? W - 1 : x + r;
          for (let yy = y - r; yy <= y + r; yy++) {
            const ry = (yy < 0 ? 0 : yy >= H ? H - 1 : yy) * W;
            let p = (ry + xr) * 4;
            if (src[p + 3] !== 0) {
              const v = src[p + c];
              hist[v]--;
              cnt--;
              if (v < med) lt--;
            }
            p = (ry + xa) * 4;
            if (src[p + 3] !== 0) {
              const v = src[p + c];
              hist[v]++;
              cnt++;
              if (v < med) lt++;
            }
          }
        }
        const j = (y * W + x) * 4;
        if (src[j + 3] === 0 || cnt === 0) continue;
        const half = cnt >> 1;
        while (lt > half) {
          med--;
          lt -= hist[med];
        }
        while (lt + hist[med] <= half) {
          lt += hist[med];
          med++;
        }
        dst[j + c] = med;
      }
    }
  }
  return img;
}

// ---------------------------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded standard-normal lookup table (Box-Muller), length 32768.
 * @param {number} seed
 * @returns {Float32Array}
 */
export function gaussianTable(seed) {
  const rnd = mulberry32((seed | 0) ^ 0x9e3779b9);
  const t = new Float32Array(32768);
  for (let i = 0; i < t.length; i += 2) {
    const u = Math.max(1e-12, rnd());
    const v = rnd();
    const m = Math.sqrt(-2 * Math.log(u));
    t[i] = m * Math.cos(2 * Math.PI * v);
    t[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  return t;
}

/**
 * Adds seeded noise. The same seed on the same image always yields identical output.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} amount 0..100 (100 = standard deviation of about 60 levels)
 * @param {boolean} gaussian gaussian (true) or uniform (false) distribution
 * @param {boolean} mono same noise on all channels (true) or independent per channel
 * @param {number} seed integer seed
 * @returns {typeof img}
 */
export function noiseAdd(img, amount, gaussian, mono, seed) {
  const sigma = (amount / 100) * 60;
  if (!(sigma > 0)) return img;
  const amp = sigma * 1.7320508;
  const table = gaussian ? gaussianTable(seed) : null;
  let s = (Math.imul(seed | 0, 2654435761) ^ 0x2545f491) | 0;
  if (s === 0) s = 0x1234567;
  const d = img.data;
  const n = d.length;
  for (let j = 0; j < n; j += 4) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const u = s;
    let u2 = 0;
    if (!mono) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      u2 = s;
    }
    if (d[j + 3] === 0) continue;
    let nr, ng, nb;
    if (gaussian) {
      nr = table[u & 0x7fff] * sigma;
      if (mono) ng = nb = nr;
      else {
        ng = table[(u >>> 15) & 0x7fff] * sigma;
        nb = table[u2 & 0x7fff] * sigma;
      }
    } else {
      nr = (((u & 0xffff) - 32768) / 32768) * amp;
      if (mono) ng = nb = nr;
      else {
        ng = ((((u >>> 16) & 0xffff) - 32768) / 32768) * amp;
        nb = (((u2 & 0xffff) - 32768) / 32768) * amp;
      }
    }
    d[j] += nr;
    d[j + 1] += ng;
    d[j + 2] += nb;
  }
  return img;
}

// ---------------------------------------------------------------------------------------------
// Denoise
// ---------------------------------------------------------------------------------------------

/**
 * Edge-preserving denoise: guided filtering (luma guided by itself, chroma guided by luma) in YCbCr.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} strength luminance smoothing 0..100
 * @param {number} colorStrength chroma smoothing 0..100
 * @param {number} radius filter radius in px
 * @param {number} detail 0..100 % of the original luma detail blended back
 * @returns {typeof img}
 */
export function denoise(img, strength, colorStrength, radius, detail) {
  if (!(strength > 0) && !(colorStrength > 0)) return img;
  const w = img.width;
  const h = img.height;
  const n = w * h;
  const d = img.data;
  const Y = new Float32Array(n);
  const Cb = new Float32Array(n);
  const Cr = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = d[j], g = d[j + 1], b = d[j + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const scratch = new Float32Array(n);
  if (colorStrength > 0) {
    const e = (colorStrength / 100) * 40;
    const rc = Math.max(1, radius * 2);
    guidedFilter(Y, Cb, w, h, rc, e * e + 1, Cb, scratch);
    guidedFilter(Y, Cr, w, h, rc, e * e + 1, Cr, scratch);
  }
  const keep = Math.min(1, Math.max(0, detail / 100));
  if (strength > 0) {
    const e = (strength / 100) * 30;
    guidedFilterSelf(Y, w, h, Math.max(1, radius), e * e + 1, Y, scratch);
  }
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (d[j + 3] === 0) continue;
    let y = Y[i];
    if (strength > 0 && keep > 0) {
      const y0 = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      y += (y0 - y) * keep;
    } else if (strength <= 0) {
      y = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    }
    const cb = Cb[i] - 128;
    const cr = Cr[i] - 128;
    d[j] = y + 1.402 * cr;
    d[j + 1] = y - 0.344136 * cb - 0.714136 * cr;
    d[j + 2] = y + 1.772 * cb;
  }
  return img;
}

// ---------------------------------------------------------------------------------------------
// Emboss / edge detect
// ---------------------------------------------------------------------------------------------

// Sobel gradient of a plane, normalized to luma units per pixel; calls back into `out` through
// either a directional combination (mode 0: a*gx + b*gy) or the magnitude (mode 1).
function sobelPlane(s, w, h, out, mode, a, b) {
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : 0) * w;
    const y0 = y * w;
    const yp = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      const p00 = s[ym + xm], p01 = s[ym + x], p02 = s[ym + xp];
      const p10 = s[y0 + xm], p12 = s[y0 + xp];
      const p20 = s[yp + xm], p21 = s[yp + x], p22 = s[yp + xp];
      const gx = (p02 + 2 * p12 + p22 - p00 - 2 * p10 - p20) * 0.125;
      const gy = (p20 + 2 * p21 + p22 - p00 - 2 * p01 - p02) * 0.125;
      out[y0 + x] = mode === 0 ? a * gx + b * gy : Math.sqrt(gx * gx + gy * gy) * 2;
    }
  }
}

/**
 * Emboss relief lit from `angle` (degrees counter-clockwise from +x; 135 = from the top left).
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} angle light direction in degrees
 * @param {number} k relief gain (already includes height, amount and render scale)
 * @param {boolean} keepColor add the relief to the original colors instead of producing gray
 * @returns {typeof img}
 */
export function emboss(img, angle, k, keepColor) {
  const w = img.width;
  const h = img.height;
  const n = w * h;
  const L = lumaPlane(img, new Float32Array(n));
  const rad = (angle * Math.PI) / 180;
  const lx = Math.cos(rad);
  const ly = -Math.sin(rad);
  const rel = new Float32Array(n);
  sobelPlane(L, w, h, rel, 0, -k * lx, -k * ly);
  const d = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (d[j + 3] === 0) continue;
    const v = rel[i];
    if (keepColor) {
      d[j] += v;
      d[j + 1] += v;
      d[j + 2] += v;
    } else {
      const g = 128 + v;
      d[j] = d[j + 1] = d[j + 2] = g;
    }
  }
  return img;
}

/**
 * Sobel edge detection.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} gain edge gain (already includes strength and render scale)
 * @param {boolean} color per-channel edges (true) or luma edges (false)
 * @param {boolean} invert dark edges on white instead of light edges on black
 * @returns {typeof img}
 */
export function edgeDetect(img, gain, color, invert) {
  const w = img.width;
  const h = img.height;
  const n = w * h;
  const d = img.data;
  const out = new Float32Array(n);
  if (!color) {
    const L = lumaPlane(img, new Float32Array(n));
    sobelPlane(L, w, h, out, 1, 0, 0);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (d[j + 3] === 0) continue;
      let v = out[i] * gain;
      v = v > 255 ? 255 : v;
      if (invert) v = 255 - v;
      d[j] = d[j + 1] = d[j + 2] = v;
    }
    return img;
  }
  const ch = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0, j = c; i < n; i++, j += 4) ch[i] = d[j];
    sobelPlane(ch, w, h, out, 1, 0, 0);
    for (let i = 0, j = c; i < n; i++, j += 4) {
      if (d[j + 3 - c] === 0) continue;
      let v = out[i] * gain;
      v = v > 255 ? 255 : v;
      d[j] = invert ? 255 - v : v;
    }
  }
  return img;
}
