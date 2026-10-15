// Directional, radial, lens and light blur algorithms behind the "Blur" filters.
// Internal module: the public surface is FILTERS in filters.js.

import { blurImageWith, gaussianBlurImage, gaussianBlurPlane, transposePlane } from "./blur.js";

// ---------------------------------------------------------------------------------------------
// Motion blur
// ---------------------------------------------------------------------------------------------

function mapRow(plane, w, row, off, nq, dst) {
  const base = row * w;
  const lo = Math.max(0, Math.min(nq, -off));
  const hi = Math.max(lo, Math.min(nq, w - off));
  const first = plane[base];
  const last = plane[base + w - 1];
  for (let i = 0; i < lo; i++) dst[i] = first;
  const o = base + off;
  for (let i = lo; i < hi; i++) dst[i] = plane[o + i];
  for (let i = hi; i < nq; i++) dst[i] = last;
}

// Box blur along discrete lines x = q + round(u * y) (u in [-1, 1]); every pixel lies on exactly one
// line, so the blur is O(1) per pixel with sliding sums and needs no interpolation.
function lineBlur(plane, out, w, h, u, k, f) {
  const sh = new Int32Array(h);
  let smin = 0;
  let smax = 0;
  for (let y = 0; y < h; y++) {
    const s = Math.round(u * y);
    sh[y] = s;
    if (s < smin) smin = s;
    if (s > smax) smax = s;
  }
  const qmin = -smax;
  const nq = w + smax - smin;
  const acc = new Float64Array(nq);
  const add = new Float32Array(nq);
  const rem = new Float32Array(nq);
  const ra = new Float32Array(nq);
  const inv = 1 / (2 * k + 1 + 2 * f);
  const cy = (y) => (y < 0 ? 0 : y >= h ? h - 1 : y);
  mapRow(plane, w, 0, qmin + sh[0], nq, add);
  for (let i = 0; i < nq; i++) acc[i] = (k + 1) * add[i];
  for (let j = 1; j <= k; j++) {
    const row = j < h ? j : h - 1;
    mapRow(plane, w, row, qmin + sh[row], nq, add);
    for (let i = 0; i < nq; i++) acc[i] += add[i];
  }
  for (let y = 0; y < h; y++) {
    const addRow = cy(y + k + 1);
    const remRow = cy(y - k);
    mapRow(plane, w, addRow, qmin + sh[addRow], nq, add);
    mapRow(plane, w, remRow, qmin + sh[remRow], nq, rem);
    const o = y * w;
    const q0 = -sh[y] - qmin;
    if (f > 0) {
      const raRow = cy(y - k - 1);
      mapRow(plane, w, raRow, qmin + sh[raRow], nq, ra);
      for (let x = 0; x < w; x++) {
        const i = x + q0;
        out[o + x] = (acc[i] + f * (ra[i] + add[i])) * inv;
      }
    } else {
      for (let x = 0; x < w; x++) out[o + x] = acc[x + q0] * inv;
    }
    for (let i = 0; i < nq; i++) acc[i] += add[i] - rem[i];
  }
}

function motionPlane(plane, scratch, w, h, vx, vy, k, f) {
  if (Math.abs(vx) < Math.abs(vy)) {
    lineBlur(plane, scratch, w, h, vx / vy, k, f);
    plane.set(scratch);
  } else {
    transposePlane(plane, scratch, w, h);
    lineBlur(scratch, plane, h, w, vy / vx, k, f);
    transposePlane(plane, scratch, h, w);
    plane.set(scratch);
  }
}

/**
 * Linear motion blur. The kernel is a box of `distance` samples along the line at `angle` (degrees,
 * counter-clockwise from the +x axis), traced on the pixel grid.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} angle degrees
 * @param {number} distance total blur length in px
 * @returns {typeof img}
 */
export function motionBlur(img, angle, distance) {
  if (!(distance > 1)) return img;
  const rad = (angle * Math.PI) / 180;
  const vx = Math.cos(rad);
  const vy = -Math.sin(rad);
  const r = (distance - 1) / 2;
  const k = Math.floor(r);
  const f = r - k;
  const w = img.width;
  const h = img.height;
  return blurImageWith(img, img, (plane, scratch) => motionPlane(plane, scratch, w, h, vx, vy, k, f));
}

// ---------------------------------------------------------------------------------------------
// Radial (spin) and zoom blur
// ---------------------------------------------------------------------------------------------

/**
 * Spin or zoom blur by averaging samples taken along an arc (spin) or toward the center (zoom).
 * Premultiplied-alpha correct. Sample counts adapt to the distance from the center.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {'spin'|'zoom'} mode
 * @param {number} amount spin: total rotation in radians; zoom: fraction (0..0.95) of the radius to sweep
 * @param {number} cx center x in px
 * @param {number} cy center y in px
 * @param {'draft'|'good'|'best'} quality sample budget and interpolation
 * @returns {typeof img}
 */
export function radialBlur(img, mode, amount, cx, cy, quality) {
  if (!(amount > 0)) return img;
  const W = img.width;
  const H = img.height;
  const out = img.data;
  const src = new Uint8ClampedArray(out);
  const nmax = quality === "draft" ? 8 : quality === "best" ? 32 : 16;
  const bilinear = quality !== "draft";
  let opaque = true;
  for (let i = 3; i < src.length; i += 4) {
    if (src[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const spin = mode === "spin";
  const cosStep = new Float64Array(nmax + 1);
  const sinStep = new Float64Array(nmax + 1);
  for (let n = 2; n <= nmax; n++) {
    cosStep[n] = Math.cos(amount / (n - 1));
    sinStep[n] = Math.sin(amount / (n - 1));
  }
  const c0 = Math.cos(amount / 2);
  const s0 = Math.sin(amount / 2);
  const Wm = W - 1;
  const Hm = H - 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const vx = x + 0.5 - cx;
      const vy = y + 0.5 - cy;
      const r = Math.sqrt(vx * vx + vy * vy);
      let n = 1 + Math.ceil(r * amount * 0.75);
      if (n > nmax) n = nmax;
      if (n <= 1) continue;
      let ux, uy, cs = 1, sn = 0, sc = 1, sstep = 0;
      if (spin) {
        ux = vx * c0 + vy * s0;
        uy = -vx * s0 + vy * c0;
        cs = cosStep[n];
        sn = sinStep[n];
      } else {
        sstep = amount / (n - 1);
      }
      let ar = 0, ag = 0, ab = 0, aa = 0;
      for (let i = 0; i < n; i++) {
        let px, py;
        if (spin) {
          px = cx + ux;
          py = cy + uy;
          const nx = ux * cs - uy * sn;
          uy = ux * sn + uy * cs;
          ux = nx;
        } else {
          px = cx + vx * sc;
          py = cy + vy * sc;
          sc -= sstep;
        }
        px -= 0.5;
        py -= 0.5;
        if (!bilinear) {
          let ix = (px + 0.5) | 0;
          let iy = (py + 0.5) | 0;
          if (px < 0) ix = 0;
          if (py < 0) iy = 0;
          if (ix > Wm) ix = Wm;
          if (iy > Hm) iy = Hm;
          const j = (iy * W + ix) * 4;
          if (opaque) {
            ar += src[j];
            ag += src[j + 1];
            ab += src[j + 2];
          } else {
            const a = src[j + 3];
            ar += src[j] * a;
            ag += src[j + 1] * a;
            ab += src[j + 2] * a;
            aa += a;
          }
          continue;
        }
        let x0 = Math.floor(px);
        let y0 = Math.floor(py);
        const fx = px - x0;
        const fy = py - y0;
        let x1 = x0 + 1;
        let y1 = y0 + 1;
        x0 = x0 < 0 ? 0 : x0 > Wm ? Wm : x0;
        x1 = x1 < 0 ? 0 : x1 > Wm ? Wm : x1;
        y0 = y0 < 0 ? 0 : y0 > Hm ? Hm : y0;
        y1 = y1 < 0 ? 0 : y1 > Hm ? Hm : y1;
        const j00 = (y0 * W + x0) * 4;
        const j10 = (y0 * W + x1) * 4;
        const j01 = (y1 * W + x0) * 4;
        const j11 = (y1 * W + x1) * 4;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        if (opaque) {
          ar += w00 * src[j00] + w10 * src[j10] + w01 * src[j01] + w11 * src[j11];
          ag += w00 * src[j00 + 1] + w10 * src[j10 + 1] + w01 * src[j01 + 1] + w11 * src[j11 + 1];
          ab += w00 * src[j00 + 2] + w10 * src[j10 + 2] + w01 * src[j01 + 2] + w11 * src[j11 + 2];
        } else {
          const a00 = w00 * src[j00 + 3];
          const a10 = w10 * src[j10 + 3];
          const a01 = w01 * src[j01 + 3];
          const a11 = w11 * src[j11 + 3];
          ar += a00 * src[j00] + a10 * src[j10] + a01 * src[j01] + a11 * src[j11];
          ag += a00 * src[j00 + 1] + a10 * src[j10 + 1] + a01 * src[j01 + 1] + a11 * src[j11 + 1];
          ab += a00 * src[j00 + 2] + a10 * src[j10 + 2] + a01 * src[j01 + 2] + a11 * src[j11 + 2];
          aa += a00 + a10 + a01 + a11;
        }
      }
      const j = (y * W + x) * 4;
      if (opaque) {
        const inv = 1 / n;
        out[j] = ar * inv;
        out[j + 1] = ag * inv;
        out[j + 2] = ab * inv;
      } else if (aa > 0) {
        const inv = 1 / aa;
        out[j] = ar * inv;
        out[j + 1] = ag * inv;
        out[j + 2] = ab * inv;
        out[j + 3] = aa / n;
      } else {
        out[j] = out[j + 1] = out[j + 2] = out[j + 3] = 0;
      }
    }
  }
  return img;
}

// ---------------------------------------------------------------------------------------------
// Defocus (disc kernel)
// ---------------------------------------------------------------------------------------------

// Disc blur of one plane: for every disc row the horizontal segment sum comes from a row prefix sum
// (O(1)), so the cost per pixel is O(radius) instead of O(radius^2).
function discPlane(plane, scratch, w, h, radius) {
  const R = Math.max(1, Math.round(radius));
  const rows = 2 * R + 1;
  const hw = new Int32Array(rows);
  let total = 0;
  for (let dy = -R; dy <= R; dy++) {
    const inside = radius * radius + 0.5 - dy * dy;
    const v = inside > 0 ? Math.floor(Math.sqrt(inside)) : -1;
    hw[dy + R] = v > R ? R : v;
    if (hw[dy + R] >= 0) total += 2 * hw[dy + R] + 1;
  }
  const inv = 1 / total;
  const stride = w + 2 * R + 1;
  const ring = new Float64Array(rows * stride);
  const filled = new Int32Array(rows).fill(-1);
  const fillPrefix = (row) => {
    const slot = row % rows;
    if (filled[slot] === row) return;
    filled[slot] = row;
    const base = slot * stride;
    const so = row * w;
    let s = 0;
    ring[base] = 0;
    const first = plane[so];
    const last = plane[so + w - 1];
    for (let j = 0; j < w + 2 * R; j++) {
      const x = j - R;
      s += x < 0 ? first : x >= w ? last : plane[so + x];
      ring[base + j + 1] = s;
    }
  };
  const bases = new Int32Array(rows);
  for (let y = 0; y < h; y++) {
    for (let dy = -R; dy <= R; dy++) {
      let ry = y + dy;
      ry = ry < 0 ? 0 : ry >= h ? h - 1 : ry;
      fillPrefix(ry);
      bases[dy + R] = (ry % rows) * stride;
    }
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      const xr = x + R;
      for (let r = 0; r < rows; r++) {
        const half = hw[r];
        if (half < 0) continue;
        const b = bases[r];
        sum += ring[b + xr + half + 1] - ring[b + xr - half];
      }
      scratch[o + x] = sum * inv;
    }
  }
  plane.set(scratch);
}

/**
 * Lens-style defocus blur with a disc kernel (premultiplied-alpha correct).
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} radius disc radius in px
 * @returns {typeof img}
 */
export function defocusBlur(img, radius) {
  if (!(radius >= 1)) {
    return radius > 0.15 ? gaussianBlurImage(img, radius * 0.6) : img;
  }
  const w = img.width;
  const h = img.height;
  return blurImageWith(img, img, (plane, scratch) => discPlane(plane, scratch, w, h, radius));
}

// ---------------------------------------------------------------------------------------------
// Tilt-shift
// ---------------------------------------------------------------------------------------------

/**
 * Tilt-shift: variable blur that grows with the distance from a focus band, built by blending a small
 * stack of progressively blurred copies.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {{fx:number, fy:number, angle:number, band:number, transition:number, blur:number, saturation:number}} o
 *   fx/fy focus point in px, angle in degrees (0 = horizontal band), band/transition in px, blur = max sigma in px,
 *   saturation = extra saturation (0..1) applied to the blurred area
 * @returns {typeof img}
 */
export function tiltShift(img, o) {
  const w = img.width;
  const h = img.height;
  const maxSigma = Math.max(0, o.blur);
  if (!(maxSigma > 0.15)) return img;
  const L = maxSigma > 6 ? 5 : 4;
  const stack = [img.data];
  let prev = { width: w, height: h, data: new Uint8ClampedArray(img.data) };
  let prevSigma = 0;
  for (let i = 1; i <= L; i++) {
    const sigma = maxSigma * (i / L);
    const inc = Math.sqrt(Math.max(0, sigma * sigma - prevSigma * prevSigma));
    const cur = { width: w, height: h, data: new Uint8ClampedArray(prev.data) };
    gaussianBlurImage(cur, inc, inc, cur);
    stack.push(cur.data);
    prev = cur;
    prevSigma = sigma;
  }
  const rad = (o.angle * Math.PI) / 180;
  const nx = Math.sin(rad);
  const ny = Math.cos(rad);
  const d = img.data;
  const band = Math.max(0, o.band);
  const trans = Math.max(1e-3, o.transition);
  const sat = o.saturation;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      const dist = Math.abs((x + 0.5 - o.fx) * nx + (y + 0.5 - o.fy) * ny);
      let t = (dist - band) / trans;
      if (t <= 0) {
        continue;
      }
      if (t > 1) t = 1;
      t = t * t * (3 - 2 * t);
      const lv = t * L;
      let i = lv | 0;
      if (i >= L) i = L - 1;
      const f = lv - i;
      const a = stack[i];
      const b = stack[i + 1];
      const oa = a[j + 3];
      if (oa === 0 && b[j + 3] === 0) continue;
      let r = a[j] + (b[j] - a[j]) * f;
      let g = a[j + 1] + (b[j + 1] - a[j + 1]) * f;
      let bl = a[j + 2] + (b[j + 2] - a[j + 2]) * f;
      if (sat !== 0) {
        const l = 0.299 * r + 0.587 * g + 0.114 * bl;
        const k = 1 + sat * t;
        r = l + (r - l) * k;
        g = l + (g - l) * k;
        bl = l + (bl - l) * k;
      }
      d[j] = r;
      d[j + 1] = g;
      d[j + 2] = bl;
      d[j + 3] = oa + (b[j + 3] - oa) * f;
    }
  }
  return img;
}

// ---------------------------------------------------------------------------------------------
// Bloom
// ---------------------------------------------------------------------------------------------

/**
 * Bloom / glow: blurs the bright parts of the image (at reduced resolution for speed) and screens the
 * result back over the image. Alpha is preserved; the glow only appears on visible pixels.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img modified in place
 * @param {number} threshold luma threshold 0..254 where glow starts
 * @param {number} sigma blur radius in px (standard deviation)
 * @param {number} intensity glow strength, 1 = 100 %
 * @returns {typeof img}
 */
export function bloom(img, threshold, sigma, intensity) {
  const w = img.width;
  const h = img.height;
  const d = img.data;
  if (!(sigma > 0.15) || !(intensity > 0)) return img;
  const f = sigma < 4 ? 1 : sigma < 12 ? 2 : sigma < 40 ? 4 : 8;
  const w2 = Math.ceil(w / f);
  const h2 = Math.ceil(h / f);
  const n2 = w2 * h2;
  const pr = new Float32Array(n2);
  const pg = new Float32Array(n2);
  const pb = new Float32Array(n2);
  const range = 255 - threshold + 1e-6;
  for (let y2 = 0; y2 < h2; y2++) {
    const ya = y2 * f;
    const yb = Math.min(h, ya + f);
    for (let x2 = 0; x2 < w2; x2++) {
      const xa = x2 * f;
      const xb = Math.min(w, xa + f);
      let sr = 0, sg = 0, sb = 0;
      for (let y = ya; y < yb; y++) {
        let j = (y * w + xa) * 4;
        for (let x = xa; x < xb; x++, j += 4) {
          const a = d[j + 3];
          if (a === 0) continue;
          const l = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
          if (l <= threshold) continue;
          const k = ((l - threshold) / range) * (a / 255);
          sr += d[j] * k;
          sg += d[j + 1] * k;
          sb += d[j + 2] * k;
        }
      }
      const inv = 1 / ((yb - ya) * (xb - xa));
      const o = y2 * w2 + x2;
      pr[o] = sr * inv;
      pg[o] = sg * inv;
      pb[o] = sb * inv;
    }
  }
  const scratch = new Float32Array(n2);
  const s2 = sigma / f;
  gaussianBlurPlane(pr, scratch, w2, h2, s2, s2);
  gaussianBlurPlane(pg, scratch, w2, h2, s2, s2);
  gaussianBlurPlane(pb, scratch, w2, h2, s2, s2);
  const gain = intensity * 2; // blurred bright-pass energy is low; scale so intensity 1 is clearly visible
  const w2m = w2 - 1;
  const h2m = h2 - 1;
  for (let y = 0; y < h; y++) {
    let gy = (y + 0.5) / f - 0.5;
    if (gy < 0) gy = 0;
    let y0 = gy | 0;
    if (y0 > h2m) y0 = h2m;
    const y1 = y0 < h2m ? y0 + 1 : y0;
    const fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      if (d[j + 3] === 0) continue;
      let gx = (x + 0.5) / f - 0.5;
      if (gx < 0) gx = 0;
      let x0 = gx | 0;
      if (x0 > w2m) x0 = w2m;
      const x1 = x0 < w2m ? x0 + 1 : x0;
      const fx = gx - x0;
      const i00 = y0 * w2 + x0, i10 = y0 * w2 + x1, i01 = y1 * w2 + x0, i11 = y1 * w2 + x1;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      let br = (pr[i00] * w00 + pr[i10] * w10 + pr[i01] * w01 + pr[i11] * w11) * gain;
      let bg = (pg[i00] * w00 + pg[i10] * w10 + pg[i01] * w01 + pg[i11] * w11) * gain;
      let bb = (pb[i00] * w00 + pb[i10] * w10 + pb[i01] * w01 + pb[i11] * w11) * gain;
      br = br > 255 ? 255 : br;
      bg = bg > 255 ? 255 : bg;
      bb = bb > 255 ? 255 : bb;
      // screen blend
      d[j] = 255 - ((255 - d[j]) * (255 - br)) / 255;
      d[j + 1] = 255 - ((255 - d[j + 1]) * (255 - bg)) / 255;
      d[j + 2] = 255 - ((255 - d[j + 2]) * (255 - bb)) / 255;
    }
  }
  return img;
}
