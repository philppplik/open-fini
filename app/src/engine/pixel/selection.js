// Selection masks: 8-bit coverage masks with shape constructors, boolean combination, feather /
// grow / shrink / smooth / border, marching-squares contour extraction (marching ants, selection ->
// path, image trace), magic wand and color range selection.

import { clamp01, div255, LUMA_R, LUMA_G, LUMA_B, parseColor } from "./image.js";
import { gaussianBlurPlane } from "./blur.js";

/**
 * @typedef {{ width: number, height: number, data: Uint8Array }} MaskData
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ points: number[], hole: boolean }} Contour
 */

const ZERO_RECT = () => ({ x: 0, y: 0, width: 0, height: 0 });

/**
 * Selection mask. `data` holds one byte per pixel: 0 = unselected, 255 = fully selected.
 * A Mask is itself a valid {@link MaskData}.
 */
export class Mask {
  /**
   * @param {number|MaskData} width width in px, or an existing MaskData to wrap (no copy)
   * @param {number} [height]
   * @param {Uint8Array} [data] optional backing store (length width*height); zero-filled when omitted
   */
  constructor(width, height, data) {
    if (width && typeof width === "object") {
      data = width.data;
      height = width.height;
      width = width.width;
    }
    this.width = Math.max(0, width | 0);
    this.height = Math.max(0, height | 0);
    if (data && data.length !== this.width * this.height) throw new RangeError("Mask: data length does not match size");
    /** @type {Uint8Array} */
    this.data = data || new Uint8Array(this.width * this.height);
  }

  /** @param {number} width @param {number} height @returns {Mask} fully unselected mask */
  static empty(width, height) {
    return new Mask(width, height);
  }

  /** @param {number} width @param {number} height @returns {Mask} fully selected mask */
  static full(width, height) {
    const m = new Mask(width, height);
    m.data.fill(255);
    return m;
  }

  /**
   * Anti-aliased axis-aligned rectangle (fractional coordinates give exact area coverage).
   * @param {number} width mask width
   * @param {number} height mask height
   * @param {number} x left
   * @param {number} y top
   * @param {number} w rectangle width
   * @param {number} h rectangle height
   * @returns {Mask}
   */
  static rect(width, height, x, y, w, h) {
    const m = new Mask(width, height);
    const x0 = x, x1 = x + w, y0 = y, y1 = y + h;
    if (!(w > 0 && h > 0)) return m;
    const ix0 = Math.max(0, Math.floor(x0));
    const ix1 = Math.min(m.width, Math.ceil(x1));
    const iy0 = Math.max(0, Math.floor(y0));
    const iy1 = Math.min(m.height, Math.ceil(y1));
    if (ix1 <= ix0 || iy1 <= iy0) return m;
    const cx = new Float32Array(ix1 - ix0);
    for (let i = ix0; i < ix1; i++) cx[i - ix0] = clamp01(Math.min(i + 1, x1) - Math.max(i, x0));
    const d = m.data;
    for (let j = iy0; j < iy1; j++) {
      const cy = clamp01(Math.min(j + 1, y1) - Math.max(j, y0));
      const o = j * m.width;
      for (let i = ix0; i < ix1; i++) d[o + i] = Math.round(cx[i - ix0] * cy * 255);
    }
    return m;
  }

  /**
   * Anti-aliased ellipse inscribed in the rectangle (x, y, w, h).
   * @param {number} width mask width
   * @param {number} height mask height
   * @param {number} x left of the bounding box
   * @param {number} y top of the bounding box
   * @param {number} w bounding box width
   * @param {number} h bounding box height
   * @returns {Mask}
   */
  static ellipse(width, height, x, y, w, h) {
    const m = new Mask(width, height);
    const rx = w / 2;
    const ry = h / 2;
    if (!(rx > 0 && ry > 0)) return m;
    const cx = x + rx;
    const cy = y + ry;
    const ix0 = Math.max(0, Math.floor(x));
    const ix1 = Math.min(m.width, Math.ceil(x + w));
    const iy0 = Math.max(0, Math.floor(y));
    const iy1 = Math.min(m.height, Math.ceil(y + h));
    const d = m.data;
    const irx2 = 1 / (rx * rx);
    const iry2 = 1 / (ry * ry);
    const gcut = 3 / Math.min(rx, ry);
    for (let j = iy0; j < iy1; j++) {
      const dy = j + 0.5 - cy;
      const by = dy * dy * iry2;
      const o = j * m.width;
      for (let i = ix0; i < ix1; i++) {
        const dx = i + 0.5 - cx;
        const g = dx * dx * irx2 + by - 1;
        if (g <= -gcut) {
          d[o + i] = 255;
        } else if (g < gcut) {
          const gx = dx * irx2;
          const gy = dy * iry2;
          const gl = 2 * Math.sqrt(gx * gx + gy * gy);
          const sd = gl > 1e-9 ? g / gl : -Math.min(rx, ry);
          const c = 0.5 - sd;
          d[o + i] = c >= 1 ? 255 : c <= 0 ? 0 : Math.round(c * 255);
        }
      }
    }
    return m;
  }

  /**
   * Anti-aliased polygon fill using exact signed-area coverage accumulation.
   * @param {number} width mask width
   * @param {number} height mask height
   * @param {number[]|number[][]|{x:number,y:number}[]|Array<number[]>} points one ring as a flat list
   *   [x0,y0,x1,y1,...] or as [[x,y],...] / [{x,y},...]; several rings may be given as an array of rings
   *   (they combine according to `fillRule`, so inner rings can punch holes)
   * @param {{fillRule?: 'nonzero'|'evenodd'}} [opts]
   * @returns {Mask}
   */
  static polygon(width, height, points, opts = {}) {
    const m = new Mask(width, height);
    const rings = normalizeRings(points);
    if (!rings.length) return m;
    let minY = Infinity, maxY = -Infinity;
    for (const r of rings) {
      for (let i = 1; i < r.length; i += 2) {
        if (r[i] < minY) minY = r[i];
        if (r[i] > maxY) maxY = r[i];
      }
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(m.height, Math.ceil(maxY));
    if (!(y1 > y0)) return m;
    const W = m.width;
    const H = y1 - y0;
    const stride = W + 2;
    const acc = new Float32Array(stride * H);
    for (const r of rings) {
      const n = r.length / 2;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const j = i + 1 === n ? 0 : i + 1;
        accumulateLine(acc, stride, W, H, r[i * 2], r[i * 2 + 1] - y0, r[j * 2], r[j * 2 + 1] - y0);
      }
    }
    const evenodd = opts.fillRule === "evenodd";
    const d = m.data;
    for (let j = 0; j < H; j++) {
      let s = 0;
      const ro = j * stride;
      const o = (j + y0) * W;
      for (let i = 0; i < W; i++) {
        s += acc[ro + i];
        let v = s < 0 ? -s : s;
        if (evenodd) {
          v = v % 2;
          if (v > 1) v = 2 - v;
        } else if (v > 1) v = 1;
        d[o + i] = v <= 0.002 ? 0 : v >= 0.998 ? 255 : Math.round(v * 255);
      }
    }
    return m;
  }

  /**
   * Mask equal to the alpha channel of an image.
   * @param {{width:number,height:number,data:Uint8ClampedArray}} img
   * @returns {Mask}
   */
  static fromAlpha(img) {
    return Mask.fromImage(img, { channel: "alpha" });
  }

  /**
   * Mask equal to the luma of an image (Rec. 601 on the encoded values).
   * @param {{width:number,height:number,data:Uint8ClampedArray}} img
   * @returns {Mask}
   */
  static fromLuma(img) {
    return Mask.fromImage(img, { channel: "luma" });
  }

  /**
   * Builds a mask from one channel of an image.
   * @param {{width:number,height:number,data:Uint8ClampedArray}} img
   * @param {{channel?: 'luma'|'alpha'|'red'|'green'|'blue', invert?: boolean}} [opts] default channel 'luma'
   * @returns {Mask}
   */
  static fromImage(img, opts = {}) {
    const m = new Mask(img.width, img.height);
    const n = img.width * img.height;
    const d = img.data;
    const o = m.data;
    const ch = opts.channel || "luma";
    if (ch === "luma") {
      for (let i = 0, j = 0; i < n; i++, j += 4) o[i] = LUMA_R * d[j] + LUMA_G * d[j + 1] + LUMA_B * d[j + 2];
    } else {
      const off = ch === "alpha" ? 3 : ch === "red" ? 0 : ch === "green" ? 1 : ch === "blue" ? 2 : -1;
      if (off < 0) throw new RangeError("Mask.fromImage: unknown channel " + ch);
      for (let i = 0, j = off; i < n; i++, j += 4) o[i] = d[j];
    }
    if (opts.invert) m.invert();
    return m;
  }

  /** @returns {Mask} deep copy */
  clone() {
    return new Mask(this.width, this.height, new Uint8Array(this.data));
  }

  /** Sets every pixel to `value`. @param {number} value 0..255 @returns {Mask} this */
  fill(value) {
    this.data.fill(value);
    return this;
  }

  /** @param {number} x @param {number} y @returns {number} coverage at a pixel (0 outside the mask) */
  get(x, y) {
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? 0 : this.data[y * this.width + x];
  }

  /** @returns {boolean} true when no pixel has coverage */
  isEmpty() {
    const d = this.data;
    for (let i = 0, n = d.length; i < n; i++) if (d[i] !== 0) return false;
    return true;
  }

  /**
   * Bounding box of all pixels whose coverage is at least `min` (default 1).
   * @param {number} [min=1]
   * @returns {Rect} zero-sized rect {0,0,0,0} when the mask is empty
   */
  bounds(min = 1) {
    return boundsOf(this.data, this.width, this.height, min);
  }

  /**
   * Boolean combination with another mask of the same size, in place.
   * Coverage values combine like probabilities: add = a + b - ab, subtract = a(1-b), intersect = ab,
   * xor = a + b - 2ab, replace = b.
   * @param {MaskData} other
   * @param {'replace'|'add'|'subtract'|'intersect'|'xor'} [op='replace']
   * @returns {Mask} this
   */
  combine(other, op = "replace") {
    if (other.width !== this.width || other.height !== this.height) throw new RangeError("Mask.combine: size mismatch");
    const a = this.data;
    const b = other.data;
    const n = a.length;
    switch (op) {
      case "replace":
        a.set(b);
        break;
      case "add":
        for (let i = 0; i < n; i++) {
          const x = a[i], y = b[i];
          a[i] = y === 0 ? x : x === 0 ? y : x + y - div255(x * y);
        }
        break;
      case "subtract":
        for (let i = 0; i < n; i++) {
          const y = b[i];
          if (y === 0) continue;
          a[i] = a[i] === 0 ? 0 : div255(a[i] * (255 - y));
        }
        break;
      case "intersect":
        for (let i = 0; i < n; i++) {
          const x = a[i], y = b[i];
          a[i] = x === 0 || y === 0 ? 0 : x === 255 ? y : y === 255 ? x : div255(x * y);
        }
        break;
      case "xor":
        for (let i = 0; i < n; i++) {
          const x = a[i], y = b[i];
          const v = x + y - 2 * div255(x * y);
          a[i] = v < 0 ? 0 : v;
        }
        break;
      default:
        throw new RangeError("Mask.combine: unknown op " + op);
    }
    return this;
  }

  /** Inverts the coverage (255 - v) in place. @returns {Mask} this */
  invert() {
    const d = this.data;
    for (let i = 0, n = d.length; i < n; i++) d[i] = 255 - d[i];
    return this;
  }

  /**
   * Gaussian feather. `radius` is the distance over which the edge fades on each side
   * (sigma = radius / 2); image borders are treated as continuing the mask.
   * @param {number} radius px
   * @returns {Mask} this
   */
  feather(radius) {
    if (!(radius > 0)) return this;
    const sigma = radius / 2;
    const b = this.bounds();
    if (b.width === 0) return this;
    const pad = Math.ceil(3 * sigma) + 2;
    const r = growRect(b, pad, this.width, this.height);
    this._blurRegion(r, sigma, 0, 0);
    return this;
  }

  /**
   * Blurs a region and optionally steepens the result around 50 % (used by feather and smooth).
   * @private
   */
  _blurRegion(r, sigma, gain) {
    const w = r.width;
    const h = r.height;
    const n = w * h;
    const plane = new Float32Array(n);
    const scratch = new Float32Array(n);
    const d = this.data;
    const W = this.width;
    for (let y = 0; y < h; y++) {
      const so = (r.y + y) * W + r.x;
      const po = y * w;
      for (let x = 0; x < w; x++) plane[po + x] = d[so + x];
    }
    gaussianBlurPlane(plane, scratch, w, h, sigma, sigma);
    for (let y = 0; y < h; y++) {
      const so = (r.y + y) * W + r.x;
      const po = y * w;
      if (gain) {
        for (let x = 0; x < w; x++) {
          const v = (plane[po + x] - 127.5) * gain + 127.5;
          d[so + x] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5;
        }
      } else {
        for (let x = 0; x < w; x++) d[so + x] = plane[po + x];
      }
    }
  }

  /**
   * Expands the selection by `px` pixels (exact Euclidean distance, anti-aliased edge).
   * @param {number} px
   * @returns {Mask} this
   */
  grow(px) {
    if (!(px > 0)) return this;
    const b = this.bounds(128);
    if (b.width === 0) return this;
    const r = growRect(b, Math.ceil(px) + 2, this.width, this.height);
    morph(this, r, px, true);
    return this;
  }

  /**
   * Contracts the selection by `px` pixels (exact Euclidean distance, anti-aliased edge).
   * Image borders do not erode the selection.
   * @param {number} px
   * @returns {Mask} this
   */
  shrink(px) {
    if (!(px > 0)) return this;
    const b = this.bounds(1);
    if (b.width === 0) return this;
    const r = growRect(b, Math.ceil(px) + 2, this.width, this.height);
    morph(this, r, px, false);
    return this;
  }

  /**
   * Smooths jagged outlines by rounding corners (blur + re-threshold with an anti-aliased edge);
   * corners end up rounded with roughly a `px` radius.
   * @param {number} px smoothing radius
   * @returns {Mask} this
   */
  smooth(px) {
    if (!(px > 0)) return this;
    const b = this.bounds();
    if (b.width === 0) return this;
    const sigma = px * 0.5;
    const gain = Math.min(12, Math.max(1, 2.5 * sigma));
    const r = growRect(b, Math.ceil(3 * sigma) + 2, this.width, this.height);
    this._blurRegion(r, sigma, gain);
    return this;
  }

  /**
   * Replaces the selection by a band of total width `px` centered on its edge.
   * @param {number} px band width
   * @returns {Mask} this
   */
  border(px) {
    const half = Math.max(0.5, px / 2);
    const outer = this.clone().grow(half);
    const inner = this.clone().shrink(half);
    outer.combine(inner, "subtract");
    this.data.set(outer.data);
    return this;
  }

  /**
   * Shifts the mask by whole pixels (rounded); exposed areas become unselected.
   * @param {number} dx
   * @param {number} dy
   * @returns {Mask} this
   */
  translate(dx, dy) {
    dx = Math.round(dx);
    dy = Math.round(dy);
    if (dx === 0 && dy === 0) return this;
    const W = this.width;
    const H = this.height;
    const src = this.data;
    const out = new Uint8Array(src.length);
    const x0 = Math.max(0, dx);
    const x1 = Math.min(W, W + dx);
    if (x1 > x0) {
      for (let y = 0; y < H; y++) {
        const sy = y - dy;
        if (sy < 0 || sy >= H) continue;
        out.set(src.subarray(sy * W + (x0 - dx), sy * W + (x1 - dx)), y * W + x0);
      }
    }
    this.data = out;
    return this;
  }

  /**
   * Extracts the outline of the selection (pixels with coverage >= threshold) as closed polylines
   * using marching squares with linear interpolation of the threshold crossing, so anti-aliased masks
   * yield sub-pixel accurate contours. Coordinates are in pixel-edge space (pixel (x,y) covers
   * [x,x+1]x[y,y+1]); the mask is treated as zero outside its bounds, so contours of selections that
   * touch the border still close along the image edge.
   *
   * Outer boundaries wind clockwise on screen (positive shoelace area with y down) and holes wind
   * the opposite way; `hole` is set accordingly. Perfectly rectilinear corners are restored to
   * sharp corners when `simplify > 0`.
   * @param {{threshold?: number, simplify?: number}} [opts] threshold 1..255 (default 128); simplify =
   *   Douglas-Peucker tolerance in px (default 0.5, 0 keeps every marching-squares vertex)
   * @returns {Contour[]}
   */
  toContours(opts = {}) {
    const threshold = opts.threshold === undefined ? 128 : opts.threshold;
    const simplify = opts.simplify === undefined ? 0.5 : opts.simplify;
    return marchingSquares(this.data, this.width, this.height, threshold, simplify);
  }
}

function normalizeRings(points) {
  if (!points || !points.length) return [];
  const first = points[0];
  if (typeof first === "number") return [points.slice()];
  const isPoint = (p) => (Array.isArray(p) && p.length === 2 && typeof p[0] === "number") || (p && typeof p === "object" && !Array.isArray(p) && "x" in p);
  if (isPoint(first)) return [flattenPoints(points)];
  const rings = [];
  for (const r of points) {
    if (!r || !r.length) continue;
    rings.push(typeof r[0] === "number" ? Array.from(r) : flattenPoints(r));
  }
  return rings;
}

function flattenPoints(pts) {
  const out = new Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (Array.isArray(p)) {
      out[i * 2] = p[0];
      out[i * 2 + 1] = p[1];
    } else {
      out[i * 2] = p.x;
      out[i * 2 + 1] = p.y;
    }
  }
  return out;
}

// Signed-area coverage accumulation (exact for simple polygons) after "font-rs".
function accumulateLine(a, stride, W, H, x0, y0, x1, y1) {
  if (y0 === y1) return;
  let dir = 1;
  if (y0 > y1) {
    dir = -1;
    let t = x0; x0 = x1; x1 = t;
    t = y0; y0 = y1; y1 = t;
  }
  if (y1 <= 0 || y0 >= H) return;
  const dxdy = (x1 - x0) / (y1 - y0);
  let x = x0;
  let ys = Math.floor(y0);
  if (y0 < 0) {
    x -= y0 * dxdy;
    ys = 0;
  }
  const yStop = Math.min(H, Math.ceil(y1));
  for (let y = ys; y < yStop; y++) {
    const dy = Math.min(y + 1, y1) - Math.max(y, y0);
    const xnext = x + dxdy * dy;
    const d = dy * dir;
    let xa = x < xnext ? x : xnext;
    let xb = x < xnext ? xnext : x;
    if (xa < 0) xa = 0; else if (xa > W) xa = W;
    if (xb < 0) xb = 0; else if (xb > W) xb = W;
    const x0f = Math.floor(xa);
    const x0i = x0f;
    const x1c = Math.ceil(xb);
    const row = y * stride;
    if (x1c <= x0i + 1) {
      const xmf = 0.5 * (xa + xb) - x0f;
      a[row + x0i] += d - d * xmf;
      a[row + x0i + 1] += d * xmf;
    } else {
      const s = 1 / (xb - xa);
      const x0fr = xa - x0f;
      const a0 = 0.5 * s * (1 - x0fr) * (1 - x0fr);
      const x1fr = xb - x1c + 1;
      const am = 0.5 * s * x1fr * x1fr;
      a[row + x0i] += d * a0;
      if (x1c === x0i + 2) {
        a[row + x0i + 1] += d * (1 - a0 - am);
      } else {
        const a1 = s * (1.5 - x0fr);
        a[row + x0i + 1] += d * (a1 - a0);
        for (let xi = x0i + 2; xi < x1c - 1; xi++) a[row + xi] += d * s;
        const a2 = a1 + (x1c - x0i - 3) * s;
        a[row + x1c - 1] += d * (1 - a2 - am);
      }
      a[row + x1c] += d * am;
    }
    x = xnext;
  }
}

function boundsOf(data, W, H, min) {
  let y0 = -1, y1 = -1, x0 = W, x1 = -1;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    let first = -1, last = -1;
    for (let x = 0; x < W; x++) {
      if (data[o + x] >= min) {
        first = x;
        break;
      }
    }
    if (first < 0) continue;
    for (let x = W - 1; x >= first; x--) {
      if (data[o + x] >= min) {
        last = x;
        break;
      }
    }
    if (y0 < 0) y0 = y;
    y1 = y;
    if (first < x0) x0 = first;
    if (last > x1) x1 = last;
  }
  if (y0 < 0) return ZERO_RECT();
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function growRect(b, pad, W, H) {
  const x0 = Math.max(0, b.x - pad);
  const y0 = Math.max(0, b.y - pad);
  const x1 = Math.min(W, b.x + b.width + pad);
  const y1 = Math.min(H, b.y + b.height + pad);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e30;
  z[1] = 1e30;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

// Morphological grow/shrink with a disc, inside region r.
function morph(mask, r, px, grow) {
  const w = r.width;
  const h = r.height;
  const W = mask.width;
  const md = mask.data;
  const INF = 1e20;
  const f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const so = (r.y + y) * W + r.x;
    const fo = y * w;
    if (grow) for (let x = 0; x < w; x++) f[fo + x] = md[so + x] >= 128 ? 0 : INF;
    else for (let x = 0; x < w; x++) f[fo + x] = md[so + x] < 128 ? 0 : INF;
  }
  const n = Math.max(w, h);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const d1 = new Float64Array(n);
  const col = new Float64Array(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = f[y * w + x];
    edt1d(col, h, d1, v, z);
    for (let y = 0; y < h; y++) f[y * w + x] = d1[y];
  }
  for (let y = 0; y < h; y++) {
    const fo = y * w;
    for (let x = 0; x < w; x++) col[x] = f[fo + x];
    edt1d(col, w, d1, v, z);
    for (let x = 0; x < w; x++) f[fo + x] = d1[x];
  }
  for (let y = 0; y < h; y++) {
    const so = (r.y + y) * W + r.x;
    const fo = y * w;
    for (let x = 0; x < w; x++) {
      const d2 = f[fo + x];
      const o = md[so + x];
      if (grow) {
        if (d2 === 0) continue;
        const c = px + 1 - Math.sqrt(d2);
        if (c <= 0) continue;
        const v8 = c >= 1 ? 255 : Math.round(c * 255);
        if (v8 > o) md[so + x] = v8;
      } else {
        if (d2 >= INF * 0.5) continue; // no unselected pixel anywhere in the region
        if (d2 === 0) {
          md[so + x] = 0;
          continue;
        }
        const c = Math.sqrt(d2) - px;
        const v8 = c >= 1 ? 255 : c <= 0 ? 0 : Math.round(c * 255);
        if (v8 < o) md[so + x] = v8;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Marching squares
// ---------------------------------------------------------------------------------------------

// Edge codes: 0 = top, 1 = right, 2 = bottom, 3 = left. Table entries are (from, to) pairs with the
// selected side on the right-hand side of the walking direction (screen coordinates, y down).
const MS_SEGS = [
  null,
  [3, 2],
  [2, 1],
  [3, 1],
  [1, 0],
  null, // saddle (handled separately)
  [2, 0],
  [3, 0],
  [0, 3],
  [0, 2],
  null, // saddle
  [0, 1],
  [1, 3],
  [1, 2],
  [2, 3],
  null,
];

class SegBuf {
  constructor() {
    this.n = 0;
    this.cap = 1024;
    this.sId = new Int32Array(this.cap);
    this.eId = new Int32Array(this.cap);
    this.sx = new Float32Array(this.cap);
    this.sy = new Float32Array(this.cap);
  }

  push(sId, eId, sx, sy) {
    if (this.n === this.cap) {
      const cap = this.cap * 2;
      const grow = (a, T) => {
        const b = new T(cap);
        b.set(a);
        return b;
      };
      this.sId = grow(this.sId, Int32Array);
      this.eId = grow(this.eId, Int32Array);
      this.sx = grow(this.sx, Float32Array);
      this.sy = grow(this.sy, Float32Array);
      this.cap = cap;
    }
    const i = this.n++;
    this.sId[i] = sId;
    this.eId[i] = eId;
    this.sx[i] = sx;
    this.sy[i] = sy;
  }
}

// Computes crossing id and position for edge `e` of the cell whose top-left pixel is (x0, y0).
// Results go to module scratch (ptX, ptY); returns the unique edge id.
let ptX = 0;
let ptY = 0;
function edgePoint(e, x0, y0, tl, tr, br, bl, thr, stride) {
  switch (e) {
    case 0: {
      ptX = x0 + 0.5 + (thr - tl) / (tr - tl);
      ptY = y0 + 0.5;
      return ((y0 + 1) * stride + (x0 + 1)) * 2;
    }
    case 1: {
      ptX = x0 + 1.5;
      ptY = y0 + 0.5 + (thr - tr) / (br - tr);
      return ((y0 + 1) * stride + (x0 + 2)) * 2 + 1;
    }
    case 2: {
      ptX = x0 + 0.5 + (thr - bl) / (br - bl);
      ptY = y0 + 1.5;
      return ((y0 + 2) * stride + (x0 + 1)) * 2;
    }
    default: {
      ptX = x0 + 0.5;
      ptY = y0 + 0.5 + (thr - tl) / (bl - tl);
      return ((y0 + 1) * stride + (x0 + 1)) * 2 + 1;
    }
  }
}

function marchingSquares(data, W, H, thr, simplify) {
  const b = boundsOf(data, W, H, Math.max(1, Math.ceil(thr)));
  if (b.width === 0) return [];
  // Threshold crossing is exactly at `thr`: use values >= thr as inside.
  const stride = W + 2;
  const bw = b.width;
  const segs = new SegBuf();
  let lineA = new Uint8Array(bw + 2);
  let lineB = new Uint8Array(bw + 2);
  const x0p = b.x - 1;
  // Row cy = b.y - 1 has pixel row b.y - 1 (may be outside -> zeros) as its top and b.y as bottom.
  const loadRow = (line, py) => {
    if (py < 0 || py >= H) {
      line.fill(0);
      return;
    }
    const o = py * W;
    for (let i = 0; i < bw + 2; i++) {
      const px = x0p + i;
      line[i] = px < 0 || px >= W ? 0 : data[o + px];
    }
  };
  loadRow(lineA, b.y - 1);
  for (let cy = b.y - 1; cy <= b.y + b.height - 1; cy++) {
    loadRow(lineB, cy + 1);
    for (let i = 0; i <= bw; i++) {
      const tl = lineA[i], tr = lineA[i + 1], br = lineB[i + 1], bl = lineB[i];
      let c = (tl >= thr ? 8 : 0) | (tr >= thr ? 4 : 0) | (br >= thr ? 2 : 0) | (bl >= thr ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const cx = x0p + i;
      let seg = MS_SEGS[c];
      if (c === 5) seg = (tl + tr + br + bl) * 0.25 >= thr ? [3, 0, 1, 2] : [1, 0, 3, 2];
      else if (c === 10) seg = (tl + tr + br + bl) * 0.25 >= thr ? [0, 1, 2, 3] : [0, 3, 2, 1];
      for (let k = 0; k < seg.length; k += 2) {
        const sid = edgePoint(seg[k], cx, cy, tl, tr, br, bl, thr, stride);
        const sx = ptX, sy = ptY;
        const eid = edgePoint(seg[k + 1], cx, cy, tl, tr, br, bl, thr, stride);
        segs.push(sid, eid, sx, sy);
      }
    }
    const t = lineA; lineA = lineB; lineB = t;
  }
  const n = segs.n;
  if (n === 0) return [];
  // Open-addressing hash: start edge id -> segment index.
  let cap = 16;
  while (cap < n * 2) cap <<= 1;
  const mask = cap - 1;
  const keys = new Int32Array(cap).fill(-1);
  const vals = new Int32Array(cap);
  for (let i = 0; i < n; i++) {
    let h = Math.imul(segs.sId[i], 0x9e3779b1) >>> 0 & mask;
    while (keys[h] !== -1) h = (h + 1) & mask;
    keys[h] = segs.sId[i];
    vals[h] = i;
  }
  const next = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = segs.eId[i];
    let h = Math.imul(key, 0x9e3779b1) >>> 0 & mask;
    let found = -1;
    while (keys[h] !== -1) {
      if (keys[h] === key) {
        found = vals[h];
        break;
      }
      h = (h + 1) & mask;
    }
    next[i] = found;
  }
  const visited = new Uint8Array(n);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const pts = [];
    let j = i;
    while (j >= 0 && !visited[j]) {
      visited[j] = 1;
      pts.push(segs.sx[j], segs.sy[j]);
      j = next[j];
    }
    if (pts.length < 6) continue;
    out.push(finishRing(pts, simplify));
  }
  return out;
}

function ringArea(p) {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return a / 2;
}

function finishRing(pts, simplify) {
  let p = pts;
  if (simplify > 0) {
    p = removeCollinear(p, 1e-3);
    p = restoreCorners(p);
    p = douglasPeuckerRing(p, simplify);
  }
  const area = ringArea(p);
  return { points: p, hole: area < 0 };
}

// Drops vertices that lie (almost exactly) on the line through their neighbors.
function removeCollinear(p, eps) {
  const n = p.length / 2;
  if (n < 4) return p;
  const keep = new Uint8Array(n);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, c = (i + 1) % n;
    const ax = p[i * 2] - p[a * 2], ay = p[i * 2 + 1] - p[a * 2 + 1];
    const bx = p[c * 2] - p[i * 2], by = p[c * 2 + 1] - p[i * 2 + 1];
    const cross = ax * by - ay * bx;
    const dot = ax * bx + ay * by;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    // keep when the turn is non-zero or the path reverses
    if (Math.abs(cross) > eps * (la + lb) || dot < 0) {
      keep[i] = 1;
      kept++;
    }
  }
  if (kept < 3) return p;
  const out = new Array(kept * 2);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      out[k++] = p[i * 2];
      out[k++] = p[i * 2 + 1];
    }
  }
  return out;
}

// Marching squares chamfers every rectilinear corner of a hard mask by half a pixel. Detect the
// exact pattern (axis-aligned run, 0.707 px diagonal, orthogonal axis-aligned run) and restore the corner.
function restoreCorners(p) {
  const n = p.length / 2;
  if (n < 5) return p;
  const X = (i) => p[((i % n) + n) % n * 2];
  const Y = (i) => p[((i % n) + n) % n * 2 + 1];
  const drop = new Uint8Array(n);
  const repl = new Map();
  const tol = 0.06;
  for (let i = 0; i < n; i++) {
    const j = i + 1;
    if (drop[i % n] || drop[j % n]) continue;
    const dx = X(j) - X(i), dy = Y(j) - Y(i);
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < 0.35 || adx > 0.65 || ady < 0.35 || ady > 0.65) continue;
    const pdx = X(i) - X(i - 1), pdy = Y(i) - Y(i - 1);
    const ndx = X(j + 1) - X(j), ndy = Y(j + 1) - Y(j);
    const prevV = Math.abs(pdx) < tol && Math.abs(pdy) > 1.2;
    const prevH = Math.abs(pdy) < tol && Math.abs(pdx) > 1.2;
    const nextV = Math.abs(ndx) < tol && Math.abs(ndy) > 1.2;
    const nextH = Math.abs(ndy) < tol && Math.abs(ndx) > 1.2;
    let cx, cy;
    if (prevV && nextH) {
      cx = X(i);
      cy = Y(j);
    } else if (prevH && nextV) {
      cx = X(j);
      cy = Y(i);
    } else continue;
    repl.set(i % n, [cx, cy]);
    drop[j % n] = 1;
  }
  if (!repl.size) return p;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (drop[i]) continue;
    const r = repl.get(i);
    if (r) out.push(r[0], r[1]);
    else out.push(p[i * 2], p[i * 2 + 1]);
  }
  return out.length >= 6 ? out : p;
}

function douglasPeuckerRing(p, eps) {
  const n = p.length / 2;
  if (n <= 3) return p;
  // Anchor at vertex 0 and the vertex farthest from it.
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) {
    const dx = p[i * 2] - p[0], dy = p[i * 2 + 1] - p[1];
    const d = dx * dx + dy * dy;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  const e2 = eps * eps;
  const stack = [0, far, far, n];
  while (stack.length) {
    const b = stack.pop();
    const a = stack.pop();
    if (b - a < 2) continue;
    const ax = p[a * 2], ay = p[a * 2 + 1];
    const bi = b % n;
    const bx = p[bi * 2], by = p[bi * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = p[i * 2] - ax, py = p[i * 2 + 1] - ay;
      let d2;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        let t = (px * dx + py * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - t * dx, qy = py - t * dy;
        d2 = qx * qx + qy * qy;
      }
      if (d2 > md) {
        md = d2;
        mi = i;
      }
    }
    if (md > e2) {
      keep[mi] = 1;
      stack.push(a, mi, mi, b);
    }
  }
  let kept = 0;
  for (let i = 0; i < n; i++) kept += keep[i];
  if (kept < 3) return p;
  const out = new Array(kept * 2);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      out[k++] = p[i * 2];
      out[k++] = p[i * 2 + 1];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Convenience constructors
// ---------------------------------------------------------------------------------------------

/**
 * Anti-aliased rectangle mask. See {@link Mask.rect}.
 * @param {number} width mask width
 * @param {number} height mask height
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {Mask}
 */
export function rectMask(width, height, x, y, w, h) {
  return Mask.rect(width, height, x, y, w, h);
}

/**
 * Anti-aliased ellipse mask inscribed in (x, y, w, h). See {@link Mask.ellipse}.
 * @param {number} width mask width
 * @param {number} height mask height
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {Mask}
 */
export function ellipseMask(width, height, x, y, w, h) {
  return Mask.ellipse(width, height, x, y, w, h);
}

// ---------------------------------------------------------------------------------------------
// Magic wand / color range
// ---------------------------------------------------------------------------------------------

// Chebyshev distance between two RGBA colors; color differences count only as far as both pixels
// are visible, so transparent pixels never match opaque ones but always match each other.
function colorDist(r1, g1, b1, a1, r2, g2, b2, a2) {
  let d = a1 > a2 ? a1 - a2 : a2 - a1;
  const m = (a1 < a2 ? a1 : a2) * (1 / 255);
  let t = r1 - r2;
  t = (t < 0 ? -t : t) * m;
  if (t > d) d = t;
  t = g1 - g2;
  t = (t < 0 ? -t : t) * m;
  if (t > d) d = t;
  t = b1 - b2;
  t = (t < 0 ? -t : t) * m;
  if (t > d) d = t;
  return d;
}

/**
 * Magic wand: selects pixels similar to the pixel at (x, y). Similarity is the largest channel
 * difference (RGB weighted by visibility, plus alpha) and must not exceed `tolerance`.
 * Contiguous mode uses a non-recursive scanline flood fill (4-connected).
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {number} x seed x
 * @param {number} y seed y
 * @param {{tolerance?: number, contiguous?: boolean, antialias?: boolean}} [opts] defaults 32 / true / true
 * @returns {Mask}
 */
export function magicWand(img, x, y, opts = {}) {
  const tol = opts.tolerance === undefined ? 32 : opts.tolerance;
  const contiguous = opts.contiguous !== false;
  const W = img.width;
  const H = img.height;
  const mask = new Mask(W, H);
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return mask;
  const D = img.data;
  const out = mask.data;
  const si = (y * W + x) * 4;
  const sr = D[si], sg = D[si + 1], sb = D[si + 2], sa = D[si + 3];
  if (!contiguous) {
    for (let i = 0, j = 0, n = W * H; i < n; i++, j += 4) {
      if (colorDist(D[j], D[j + 1], D[j + 2], D[j + 3], sr, sg, sb, sa) <= tol) out[i] = 255;
    }
  } else {
    let stack = new Int32Array(1024);
    let sp = 0;
    const push = (px, py) => {
      if (sp + 2 > stack.length) {
        const s2 = new Int32Array(stack.length * 2);
        s2.set(stack);
        stack = s2;
      }
      stack[sp++] = px;
      stack[sp++] = py;
    };
    push(x, y);
    while (sp > 0) {
      const py = stack[--sp];
      const px = stack[--sp];
      let o = py * W;
      if (out[o + px]) continue;
      let j = (o + px) * 4;
      if (colorDist(D[j], D[j + 1], D[j + 2], D[j + 3], sr, sg, sb, sa) > tol) continue;
      let xl = px;
      while (xl > 0 && !out[o + xl - 1]) {
        j = (o + xl - 1) * 4;
        if (colorDist(D[j], D[j + 1], D[j + 2], D[j + 3], sr, sg, sb, sa) > tol) break;
        xl--;
      }
      let xr = px;
      while (xr < W - 1 && !out[o + xr + 1]) {
        j = (o + xr + 1) * 4;
        if (colorDist(D[j], D[j + 1], D[j + 2], D[j + 3], sr, sg, sb, sa) > tol) break;
        xr++;
      }
      out.fill(255, o + xl, o + xr + 1);
      for (let dy = -1; dy <= 1; dy += 2) {
        const ny = py + dy;
        if (ny < 0 || ny >= H) continue;
        const no = ny * W;
        let inRun = false;
        for (let xx = xl; xx <= xr; xx++) {
          let ok = false;
          if (!out[no + xx]) {
            const k = (no + xx) * 4;
            ok = colorDist(D[k], D[k + 1], D[k + 2], D[k + 3], sr, sg, sb, sa) <= tol;
          }
          if (ok && !inRun) push(xx, ny);
          inRun = ok;
        }
      }
    }
  }
  if (opts.antialias !== false) softenEdges(mask);
  return mask;
}

// Light 1-px edge anti-aliasing ([1 6 1]/8 in both directions) restricted to the selection bounds.
function softenEdges(mask) {
  const b = mask.bounds(1);
  if (b.width === 0) return;
  const r = growRect(b, 1, mask.width, mask.height);
  const W = mask.width;
  const d = mask.data;
  const w = r.width;
  const h = r.height;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const so = (r.y + y) * W + r.x;
    const to = y * w;
    for (let x = 0; x < w; x++) {
      const c = d[so + x];
      const l = x > 0 ? d[so + x - 1] : c;
      const rr = x < w - 1 ? d[so + x + 1] : c;
      tmp[to + x] = (l + 6 * c + rr + 4) >> 3;
    }
  }
  for (let y = 0; y < h; y++) {
    const so = (r.y + y) * W + r.x;
    for (let x = 0; x < w; x++) {
      const c = tmp[y * w + x];
      const u = y > 0 ? tmp[(y - 1) * w + x] : c;
      const dn = y < h - 1 ? tmp[(y + 1) * w + x] : c;
      d[so + x] = (u + 6 * c + dn + 4) >> 3;
    }
  }
}

/**
 * Selects every pixel whose color is close to `color`, everywhere in the image.
 * Coverage is 255 within `tolerance` (largest channel difference), then falls off linearly to 0
 * over a further `fuzziness`.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {string|number[]} color target color
 * @param {{tolerance?: number, fuzziness?: number}} [opts] defaults 32 / 16
 * @returns {Mask}
 */
export function colorRange(img, color, opts = {}) {
  const tol = opts.tolerance === undefined ? 32 : opts.tolerance;
  const fuzz = Math.max(0, opts.fuzziness === undefined ? 16 : opts.fuzziness);
  const c = parseColor(color);
  const mask = new Mask(img.width, img.height);
  const D = img.data;
  const out = mask.data;
  const inv = fuzz > 0 ? 255 / fuzz : 0;
  for (let i = 0, j = 0, n = img.width * img.height; i < n; i++, j += 4) {
    const d = colorDist(D[j], D[j + 1], D[j + 2], D[j + 3], c[0], c[1], c[2], c[3]);
    if (d <= tol) out[i] = 255;
    else if (fuzz > 0 && d < tol + fuzz) out[i] = 255 - (d - tol) * inv;
  }
  return mask;
}
