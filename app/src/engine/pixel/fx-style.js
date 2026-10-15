// Stylizing algorithms behind the "Stylize", "Distort" and "Light" filters.
// Internal module: the public surface is FILTERS in filters.js.

import { createImage } from "./image.js";
import { boxBlurImage } from "./blur.js";

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
 * Mosaic: replaces every size x size cell with its (alpha weighted) average color or its center pixel.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} size cell size in px
 * @param {'average'|'center'} mode
 * @returns {typeof img}
 */
export function pixelate(img, size, mode) {
  const s = Math.max(1, Math.round(size));
  if (s === 1) return img;
  const W = img.width;
  const H = img.height;
  const d = img.data;
  for (let y0 = 0; y0 < H; y0 += s) {
    const y1 = Math.min(H, y0 + s);
    for (let x0 = 0; x0 < W; x0 += s) {
      const x1 = Math.min(W, x0 + s);
      let r, g, b, a;
      if (mode === "center") {
        const cx = Math.min(W - 1, x0 + (s >> 1));
        const cy = Math.min(H - 1, y0 + (s >> 1));
        const j = (cy * W + cx) * 4;
        r = d[j]; g = d[j + 1]; b = d[j + 2]; a = d[j + 3];
      } else {
        let sr = 0, sg = 0, sb = 0, sa = 0;
        for (let y = y0; y < y1; y++) {
          let j = (y * W + x0) * 4;
          for (let x = x0; x < x1; x++, j += 4) {
            const al = d[j + 3];
            sr += d[j] * al;
            sg += d[j + 1] * al;
            sb += d[j + 2] * al;
            sa += al;
          }
        }
        if (sa === 0) {
          r = g = b = a = 0;
        } else {
          r = sr / sa; g = sg / sa; b = sb / sa;
          a = sa / ((x1 - x0) * (y1 - y0));
        }
      }
      for (let y = y0; y < y1; y++) {
        let j = (y * W + x0) * 4;
        for (let x = x0; x < x1; x++, j += 4) {
          d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = a;
        }
      }
    }
  }
  return img;
}

/**
 * Vignette: smooth radial darkening (amount < 0) or lightening (amount > 0) toward the corners.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {{amount:number, midpoint:number, feather:number, roundness:number, cx:number, cy:number}} o
 *   amount -1..1, midpoint/feather 0..1, roundness -1 (squarish) .. 1 (circle), center in px
 * @returns {typeof img}
 */
export function vignette(img, o) {
  if (!o.amount) return img;
  const W = img.width;
  const H = img.height;
  const d = img.data;
  const ex = Math.max(o.cx, W - o.cx, 1);
  const ey = Math.max(o.cy, H - o.cy, 1);
  const R = Math.sqrt(ex * ex + ey * ey);
  const rd = o.roundness;
  const circ = rd > 0 ? rd : 0;
  const sq = rd < 0 ? -rd : 0;
  const rx = ex * Math.SQRT2 * (1 - circ) + R * circ;
  const ry = ey * Math.SQRT2 * (1 - circ) + R * circ;
  const inner = Math.min(0.98, Math.max(0, o.midpoint));
  const outer = Math.max(inner + 0.02, inner + o.feather * (1.2 - inner));
  const amt = o.amount;
  for (let y = 0; y < H; y++) {
    const dy = (y + 0.5 - o.cy) / ry;
    const dyc = Math.abs(y + 0.5 - o.cy) / ey;
    for (let x = 0; x < W; x++) {
      const j = (y * W + x) * 4;
      if (d[j + 3] === 0) continue;
      const dx = (x + 0.5 - o.cx) / rx;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (sq > 0) {
        const dxc = Math.abs(x + 0.5 - o.cx) / ex;
        dist = dist * (1 - sq) + (dxc > dyc ? dxc : dyc) * sq;
      }
      let t = (dist - inner) / (outer - inner);
      if (t <= 0) continue;
      if (t > 1) t = 1;
      t = t * t * (3 - 2 * t);
      if (amt < 0) {
        const k = 1 + amt * t;
        d[j] *= k;
        d[j + 1] *= k;
        d[j + 2] *= k;
      } else {
        const k = amt * t;
        d[j] += (255 - d[j]) * k;
        d[j + 1] += (255 - d[j + 1]) * k;
        d[j + 2] += (255 - d[j + 2]) * k;
      }
    }
  }
  return img;
}

/**
 * Oil paint: every pixel takes the average color of the most populated intensity bin inside its
 * (2r+1)^2 window (sliding histograms, O(r) per pixel).
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} radius window radius in px (>= 1)
 * @param {number} levels number of intensity bins (2..64)
 * @returns {typeof img}
 */
export function oilPaint(img, radius, levels) {
  const r = Math.max(1, Math.round(radius));
  const L = Math.max(2, Math.min(64, Math.round(levels)));
  const W = img.width;
  const H = img.height;
  const src = new Uint8ClampedArray(img.data);
  const dst = img.data;
  const bin = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < W * H; i++, j += 4) bin[i] = ((77 * src[j] + 150 * src[j + 1] + 29 * src[j + 2]) >> 8) * L >> 8;
  const cnt = new Int32Array(L);
  const sr = new Int32Array(L);
  const sg = new Int32Array(L);
  const sb = new Int32Array(L);
  for (let y = 0; y < H; y++) {
    cnt.fill(0);
    sr.fill(0);
    sg.fill(0);
    sb.fill(0);
    for (let yy = y - r; yy <= y + r; yy++) {
      const ry = (yy < 0 ? 0 : yy >= H ? H - 1 : yy) * W;
      for (let xx = -r; xx <= r; xx++) {
        const i = ry + (xx < 0 ? 0 : xx >= W ? W - 1 : xx);
        const p = i * 4;
        if (src[p + 3] === 0) continue;
        const b = bin[i];
        cnt[b]++;
        sr[b] += src[p];
        sg[b] += src[p + 1];
        sb[b] += src[p + 2];
      }
    }
    for (let x = 0; x < W; x++) {
      if (x > 0) {
        const xr = x - 1 - r < 0 ? 0 : x - 1 - r;
        const xa = x + r >= W ? W - 1 : x + r;
        for (let yy = y - r; yy <= y + r; yy++) {
          const ry = (yy < 0 ? 0 : yy >= H ? H - 1 : yy) * W;
          let i = ry + xr;
          let p = i * 4;
          if (src[p + 3] !== 0) {
            const b = bin[i];
            cnt[b]--;
            sr[b] -= src[p];
            sg[b] -= src[p + 1];
            sb[b] -= src[p + 2];
          }
          i = ry + xa;
          p = i * 4;
          if (src[p + 3] !== 0) {
            const b = bin[i];
            cnt[b]++;
            sr[b] += src[p];
            sg[b] += src[p + 1];
            sb[b] += src[p + 2];
          }
        }
      }
      const j = (y * W + x) * 4;
      if (src[j + 3] === 0) continue;
      let best = 0;
      let bc = cnt[0];
      for (let b = 1; b < L; b++) {
        if (cnt[b] > bc) {
          bc = cnt[b];
          best = b;
        }
      }
      if (bc === 0) continue;
      dst[j] = sr[best] / bc;
      dst[j + 1] = sg[best] / bc;
      dst[j + 2] = sb[best] / bc;
    }
  }
  return img;
}

const INK_RGB = [
  [0, 174, 239],
  [236, 0, 140],
  [255, 242, 0],
  [35, 31, 32],
];

/**
 * Halftone: rotated dot screens whose dot size follows the local tone. 'gray' = one black screen;
 * 'cmyk' = four screens at 15/75/0/45 degrees (plus `angle`) composited subtractively on paper white.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} size dot spacing in px
 * @param {number} angle screen rotation in degrees
 * @param {'gray'|'cmyk'} mode
 * @param {number} mix 0..1 blend with the original
 * @returns {typeof img}
 */
export function halftone(img, size, angle, mode, mix) {
  const W = img.width;
  const H = img.height;
  const d = img.data;
  const s = Math.max(2, size);
  const cmyk = mode === "cmyk";
  const nInk = cmyk ? 4 : 1;
  const bl = boxBlurImage(img, s * 0.5, s * 0.5, 1, createImage(W, H));
  const b = bl.data;
  const cs = new Float64Array(nInk);
  const sn = new Float64Array(nInk);
  const base = cmyk ? [15, 75, 0, 45] : [0];
  for (let i = 0; i < nInk; i++) {
    const a = ((base[i] + angle) * Math.PI) / 180;
    cs[i] = Math.cos(a);
    sn[i] = Math.sin(a);
  }
  const Wm = W - 1;
  const Hm = H - 1;
  const half = Math.SQRT1_2;
  const inv = 1 / s;
  for (let y = 0; y < H; y++) {
    const py = y + 0.5;
    for (let x = 0; x < W; x++) {
      const j = (y * W + x) * 4;
      if (d[j + 3] === 0) continue;
      const px = x + 0.5;
      let or = 255, og = 255, ob = 255;
      for (let ink = 0; ink < nInk; ink++) {
        const c = cs[ink], sv = sn[ink];
        const u = px * c + py * sv;
        const v = -px * sv + py * c;
        const cu = Math.round(u * inv) * s;
        const cv = Math.round(v * inv) * s;
        let ix = Math.round(cu * c - cv * sv - 0.5);
        let iy = Math.round(cu * sv + cv * c - 0.5);
        ix = ix < 0 ? 0 : ix > Wm ? Wm : ix;
        iy = iy < 0 ? 0 : iy > Hm ? Hm : iy;
        const k = (iy * W + ix) * 4;
        const r = b[k], g = b[k + 1], bb = b[k + 2];
        let amount;
        if (!cmyk) {
          amount = 1 - (0.299 * r + 0.587 * g + 0.114 * bb) / 255;
        } else {
          const mx = Math.max(r, g, bb) / 255;
          const kk = 1 - mx;
          if (ink === 3) amount = kk;
          else if (kk >= 0.999) amount = 0;
          else {
            const ch = ink === 0 ? r : ink === 1 ? g : bb;
            amount = (1 - ch / 255 - kk) / (1 - kk);
          }
        }
        if (amount <= 0.004) continue;
        const dx = u - cu;
        const dy = v - cv;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const am = amount > 1 ? 1 : amount;
        // radius giving the right ink coverage: circles up to touching (r = s/2), then growing to fill the cell corners
        const rad = am <= 0.7854 ? s * Math.sqrt(am / Math.PI) : s * (0.5 + ((am - 0.7854) / 0.2146) * (half - 0.5));
        let cov = rad - dist + 0.5;
        if (cov <= 0) continue;
        if (cov > 1) cov = 1;
        if (cmyk) {
          const col = INK_RGB[ink];
          or *= 1 - cov * (1 - col[0] / 255);
          og *= 1 - cov * (1 - col[1] / 255);
          ob *= 1 - cov * (1 - col[2] / 255);
        } else {
          const f = 1 - cov;
          or *= f; og *= f; ob *= f;
        }
      }
      if (mix >= 1) {
        d[j] = or; d[j + 1] = og; d[j + 2] = ob;
      } else {
        d[j] += (or - d[j]) * mix;
        d[j + 1] += (og - d[j + 1]) * mix;
        d[j + 2] += (ob - d[j + 2]) * mix;
      }
    }
  }
  return img;
}

/**
 * Digital glitch: random horizontal bands are displaced (with wrap-around) and the red / blue
 * channels are split horizontally. Fully determined by `seed`.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {{seed:number, amount:number, displacement:number, channelShift:number, blockHeight:number}} o
 *   amount 0..1 (share of displaced bands), displacement / channelShift / blockHeight in px
 * @returns {typeof img}
 */
export function glitch(img, o) {
  const W = img.width;
  const H = img.height;
  if (W === 0 || H === 0) return img;
  const src = new Uint8ClampedArray(img.data);
  const d = img.data;
  const rnd = mulberry32(o.seed | 0);
  let y = 0;
  while (y < H) {
    const bh = Math.max(1, Math.round(o.blockHeight * (0.25 + 0.75 * rnd())));
    const displaced = rnd() < o.amount * 0.7;
    const shift = displaced ? Math.round((rnd() * 2 - 1) * o.displacement) : 0;
    const extra = displaced ? Math.round((rnd() * 2 - 1) * o.channelShift * 1.5) : 0;
    const shiftN = ((shift % W) + W) % W;
    const cs = ((((Math.round(o.channelShift) + extra) % W) + W) % W);
    const y1 = Math.min(H, y + bh);
    for (let yy = y; yy < y1; yy++) {
      const ro = yy * W * 4;
      for (let x = 0; x < W; x++) {
        let sx = x - shiftN;
        if (sx < 0) sx += W;
        let xr = sx - cs;
        if (xr < 0) xr += W;
        let xb = sx + cs;
        if (xb >= W) xb -= W;
        const j = ro + x * 4;
        const jg = ro + sx * 4;
        d[j] = src[ro + xr * 4];
        d[j + 1] = src[jg + 1];
        d[j + 2] = src[ro + xb * 4 + 2];
        d[j + 3] = src[jg + 3];
      }
    }
    y = y1;
  }
  return img;
}
