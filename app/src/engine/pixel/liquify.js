// Liquify: interactive mesh warp. Brush strokes edit a displacement field stored on a (possibly
// reduced resolution) grid; rendering resamples the untouched source image through the field with
// premultiplied bilinear interpolation. Only the area touched since the last reset() is re-rendered,
// so strokes on big images stay interactive.

import { createImage } from "./image.js";

/**
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RGBAImage
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

const EMPTY = () => ({ x: 0, y: 0, width: 0, height: 0 });

/**
 * Brush modes of {@link Liquify#applyBrush}.
 * @typedef {'push'|'twirl-cw'|'twirl-ccw'|'pinch'|'bloat'|'reconstruct'} LiquifyMode
 */

export class Liquify {
  /**
   * @param {RGBAImage} img source image; it must not be modified while the Liquify object is in use
   *   unless `opts.copy` is true
   * @param {{step?: number, copy?: boolean}} [opts] `step` = field grid spacing in px (default: 1 for images up to
   *   1024 px, larger for bigger images so the grid stays near 1024 x 1024); `copy` keeps a private copy of the source
   */
  constructor(img, opts = {}) {
    this.width = img.width;
    this.height = img.height;
    this.src = opts.copy ? { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) } : img;
    this.step = Math.max(1, Math.round(opts.step || Math.ceil(Math.max(img.width, img.height) / 1024)));
    this.gw = Math.ceil(this.width / this.step) + 2;
    this.gh = Math.ceil(this.height / this.step) + 2;
    /** @type {Float32Array|null} horizontal source offsets at the grid nodes (px) */
    this.fu = new Float32Array(this.gw * this.gh);
    /** @type {Float32Array|null} vertical source offsets at the grid nodes (px) */
    this.fv = new Float32Array(this.gw * this.gh);
    this._dirty = EMPTY();
    this._opaque = null;
  }

  _check() {
    if (!this.fu) throw new Error("Liquify: used after dispose()");
  }

  /**
   * Applies one brush dab to the displacement field.
   * - push: moves pixels along (dx, dy), the drag movement since the previous dab
   * - twirl-cw / twirl-ccw: rotates pixels around the brush center
   * - pinch: pulls pixels toward the center; bloat: pushes them away
   * - reconstruct: relaxes the field back toward "no distortion"
   * @param {{mode: LiquifyMode, x: number, y: number, radius: number, strength?: number, dx?: number, dy?: number}} b
   *   x/y brush center and radius in px; strength 0..1 (1 = pixels follow the drag exactly / about 0.3 rad of twist per dab)
   * @returns {Rect} dirty rectangle in image pixels (re-render it with renderRegion)
   */
  applyBrush(b) {
    this._check();
    const R = Math.max(0.5, b.radius);
    const strength = b.strength === undefined ? 1 : Math.max(0, Math.min(1, b.strength));
    const step = this.step;
    const gw = this.gw;
    const gh = this.gh;
    const i0 = Math.max(0, Math.floor((b.x - R) / step));
    const i1 = Math.min(gw - 1, Math.ceil((b.x + R) / step));
    const j0 = Math.max(0, Math.floor((b.y - R) / step));
    const j1 = Math.min(gh - 1, Math.ceil((b.y + R) / step));
    const fu = this.fu;
    const fv = this.fv;
    const mode = b.mode;
    const dxm = b.dx || 0;
    const dym = b.dy || 0;
    const invR2 = 1 / (R * R);
    const maxAng = 0.3 * strength;
    const sgn = mode === "twirl-ccw" ? -1 : 1;
    for (let j = j0; j <= j1; j++) {
      const py = j * step - b.y;
      for (let i = i0; i <= i1; i++) {
        const px = i * step - b.x;
        const t = (px * px + py * py) * invR2;
        if (t >= 1) continue;
        const f = (1 - t) * (1 - t);
        const n = j * gw + i;
        switch (mode) {
          case "push":
            fu[n] -= dxm * strength * f;
            fv[n] -= dym * strength * f;
            break;
          case "twirl-cw":
          case "twirl-ccw": {
            const th = sgn * maxAng * f;
            const c = Math.cos(th);
            const s = Math.sin(th);
            fu[n] += px * c + py * s - px;
            fv[n] += -px * s + py * c - py;
            break;
          }
          case "pinch": {
            const k = 0.12 * strength * f;
            fu[n] += px * k;
            fv[n] += py * k;
            break;
          }
          case "bloat": {
            const k = 0.12 * strength * f;
            fu[n] -= px * k;
            fv[n] -= py * k;
            break;
          }
          case "reconstruct": {
            const k = 1 - Math.min(1, strength * f);
            fu[n] *= k;
            fv[n] *= k;
            break;
          }
          default:
            throw new RangeError("Liquify.applyBrush: unknown mode " + mode);
        }
      }
    }
    const rect = this._clip({ x: i0 * step - step, y: j0 * step - step, width: (i1 - i0 + 2) * step + step, height: (j1 - j0 + 2) * step + step });
    this._dirty = unionRects(this._dirty, rect);
    return rect;
  }

  _clip(r) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(this.width, Math.ceil(r.x + r.width));
    const y1 = Math.min(this.height, Math.ceil(r.y + r.height));
    if (x1 <= x0 || y1 <= y0) return EMPTY();
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /**
   * Displacement of the source sample position at an image pixel (for tests and previews).
   * @param {number} x
   * @param {number} y
   * @returns {{u: number, v: number}} source offset in px (output(x, y) samples source(x + u, y + v))
   */
  displacementAt(x, y) {
    this._check();
    const step = this.step;
    const gx = (x + 0.5) / step;
    const gy = (y + 0.5) / step;
    const i = Math.floor(gx), j = Math.floor(gy);
    const tx = gx - i, ty = gy - j;
    const gw = this.gw;
    const a = j * gw + i;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    return {
      u: this.fu[a] * w00 + this.fu[a + 1] * w10 + this.fu[a + gw] * w01 + this.fu[a + gw + 1] * w11,
      v: this.fv[a] * w00 + this.fv[a + 1] * w10 + this.fv[a + gw] * w01 + this.fv[a + gw + 1] * w11,
    };
  }

  /**
   * Renders the whole warped image.
   * @param {RGBAImage} [out] destination of the same size (a new image is created when omitted)
   * @returns {RGBAImage}
   */
  render(out) {
    this._check();
    const dst = out || createImage(this.width, this.height);
    if (dst.width !== this.width || dst.height !== this.height) throw new RangeError("Liquify.render: size mismatch");
    dst.data.set(this.src.data);
    if (this._dirty.width > 0) this._warp(dst, this._dirty);
    return dst;
  }

  /**
   * Re-renders one rectangle of the output (after applyBrush / reset). Pixels of the rectangle are first
   * restored from the source, then warped.
   * @param {RGBAImage|Rect} a destination image, or the rectangle (then `b` is the image)
   * @param {Rect|RGBAImage} b rectangle, or the destination image
   * @returns {RGBAImage} the destination image
   */
  renderRegion(a, b) {
    this._check();
    const out = a && a.data ? a : b;
    const rect = a && a.data ? b : a;
    if (!out || !out.data) throw new TypeError("Liquify.renderRegion: destination image required");
    if (out.width !== this.width || out.height !== this.height) throw new RangeError("Liquify.renderRegion: size mismatch");
    const r = this._clip(rect);
    if (r.width === 0) return out;
    const W = this.width;
    for (let y = r.y; y < r.y + r.height; y++) {
      const o = (y * W + r.x) * 4;
      out.data.set(this.src.data.subarray(o, o + r.width * 4), o);
    }
    this._warp(out, r);
    return out;
  }

  _isOpaque() {
    if (this._opaque === null) {
      const d = this.src.data;
      let o = true;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] !== 255) {
          o = false;
          break;
        }
      }
      this._opaque = o;
    }
    return this._opaque;
  }

  // Warps the pixels of rect from the source into dst.
  _warp(dst, r) {
    const W = this.width;
    const H = this.height;
    const step = this.step;
    const gw = this.gw;
    const fu = this.fu;
    const fv = this.fv;
    const s = this.src.data;
    const d = dst.data;
    const opaque = this._isOpaque();
    const inv = 1 / step;
    const Wm = W - 1;
    const Hm = H - 1;
    for (let y = r.y; y < r.y + r.height; y++) {
      const gy = (y + 0.5) * inv;
      const j = gy | 0;
      const ty = gy - j;
      const r0 = j * gw;
      const r1 = r0 + gw;
      for (let x = r.x; x < r.x + r.width; x++) {
        const gx = (x + 0.5) * inv;
        const i = gx | 0;
        const tx = gx - i;
        const a00 = r0 + i, a10 = a00 + 1, a01 = r1 + i, a11 = a01 + 1;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const u = fu[a00] * w00 + fu[a10] * w10 + fu[a01] * w01 + fu[a11] * w11;
        const v = fv[a00] * w00 + fv[a10] * w10 + fv[a01] * w01 + fv[a11] * w11;
        if (u === 0 && v === 0) continue;
        let sx = x + u;
        let sy = y + v;
        sx = sx < 0 ? 0 : sx > Wm ? Wm : sx;
        sy = sy < 0 ? 0 : sy > Hm ? Hm : sy;
        const x0 = sx | 0;
        const y0 = sy | 0;
        const x1 = x0 < Wm ? x0 + 1 : x0;
        const y1 = y0 < Hm ? y0 + 1 : y0;
        const fx = sx - x0;
        const fy = sy - y0;
        const k00 = (y0 * W + x0) * 4, k10 = (y0 * W + x1) * 4, k01 = (y1 * W + x0) * 4, k11 = (y1 * W + x1) * 4;
        const b00 = (1 - fx) * (1 - fy), b10 = fx * (1 - fy), b01 = (1 - fx) * fy, b11 = fx * fy;
        const o = (y * W + x) * 4;
        if (opaque) {
          d[o] = s[k00] * b00 + s[k10] * b10 + s[k01] * b01 + s[k11] * b11;
          d[o + 1] = s[k00 + 1] * b00 + s[k10 + 1] * b10 + s[k01 + 1] * b01 + s[k11 + 1] * b11;
          d[o + 2] = s[k00 + 2] * b00 + s[k10 + 2] * b10 + s[k01 + 2] * b01 + s[k11 + 2] * b11;
          d[o + 3] = 255;
        } else {
          const p00 = b00 * s[k00 + 3], p10 = b10 * s[k10 + 3], p01 = b01 * s[k01 + 3], p11 = b11 * s[k11 + 3];
          const a = p00 + p10 + p01 + p11;
          if (a <= 0.0005) {
            d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0;
          } else {
            const ia = 1 / a;
            d[o] = (s[k00] * p00 + s[k10] * p10 + s[k01] * p01 + s[k11] * p11) * ia;
            d[o + 1] = (s[k00 + 1] * p00 + s[k10 + 1] * p10 + s[k01 + 1] * p01 + s[k11 + 1] * p11) * ia;
            d[o + 2] = (s[k00 + 2] * p00 + s[k10 + 2] * p10 + s[k01 + 2] * p01 + s[k11 + 2] * p11) * ia;
            d[o + 3] = a;
          }
        }
      }
    }
  }

  /**
   * Clears all distortion.
   * @returns {Rect} the rectangle that has to be re-rendered (the previously distorted area)
   */
  reset() {
    this._check();
    this.fu.fill(0);
    this.fv.fill(0);
    const r = this._dirty;
    this._dirty = EMPTY();
    return r;
  }

  /** Releases the field buffers and the source reference. The object cannot be used afterwards. */
  dispose() {
    this.fu = null;
    this.fv = null;
    this.src = null;
    this._dirty = EMPTY();
  }
}

function unionRects(a, b) {
  if (a.width === 0) return b;
  if (b.width === 0) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
