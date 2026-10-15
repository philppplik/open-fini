// Core RGBA image helpers for the pixel engine. Pure ES module: no DOM, Canvas or ImageData.
//
// Images are NON-premultiplied RGBA8 ({ width, height, data: Uint8ClampedArray }), identical in
// layout to ImageData. Every function here works in Node and in a Web Worker.

/**
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RGBAImage
 * @typedef {{ width: number, height: number, data: Uint8Array }} MaskData
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

/** Luma weight of red (Rec. 601, applied to gamma-encoded sRGB values). */
export const LUMA_R = 0.299;
/** Luma weight of green (Rec. 601, applied to gamma-encoded sRGB values). */
export const LUMA_G = 0.587;
/** Luma weight of blue (Rec. 601, applied to gamma-encoded sRGB values). */
export const LUMA_B = 0.114;

/**
 * Clamps `v` into [lo, hi].
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Clamps `v` into [0, 1].
 * @param {number} v
 * @returns {number}
 */
export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Rounds and clamps to an integer byte (0..255). NaN becomes 0.
 * @param {number} v
 * @returns {number}
 */
export function clampByte(v) {
  return v > 0 ? (v < 255 ? (v + 0.5) | 0 : 255) : 0;
}

/**
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Hermite smooth step between two edges.
 * @param {number} e0 lower edge
 * @param {number} e1 upper edge
 * @param {number} x value
 * @returns {number} 0..1
 */
export function smoothstep(e0, e1, x) {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * Exact integer round(v / 255) for integers 0..65025 (product of two bytes).
 * @param {number} v
 * @returns {number}
 */
export function div255(v) {
  v += 128;
  return (v + (v >> 8)) >> 8;
}

/**
 * Luma (0..255) of gamma-encoded RGB values using Rec. 601 weights.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number}
 */
export function luminance(r, g, b) {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

/**
 * Integer luma (0..255) of gamma-encoded RGB bytes, Rec. 601 weights in 8.8 fixed point.
 * @param {number} r 0..255
 * @param {number} g 0..255
 * @param {number} b 0..255
 * @returns {number} 0..255
 */
export function luma8(r, g, b) {
  return (77 * r + 150 * g + 29 * b + 128) >> 8;
}

/**
 * Creates a fully transparent image.
 * @param {number} width
 * @param {number} height
 * @returns {RGBAImage}
 */
export function createImage(width, height) {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

/**
 * Wraps existing pixel data into an image object (no copy).
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray|Uint8Array} data length must be width*height*4
 * @returns {RGBAImage}
 */
export function imageFromData(width, height, data) {
  if (data.length !== width * height * 4) throw new RangeError("imageFromData: data length does not match size");
  const d = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  return { width, height, data: d };
}

/**
 * Deep copy of an image.
 * @param {RGBAImage} img
 * @returns {RGBAImage}
 */
export function cloneImage(img) {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/**
 * Copies the pixels of `src` into `dst` in place (same size required).
 * @param {RGBAImage} dst
 * @param {RGBAImage} src
 * @returns {RGBAImage} dst
 */
export function copyImageData(dst, src) {
  if (dst.width !== src.width || dst.height !== src.height) throw new RangeError("copyImageData: size mismatch");
  dst.data.set(src.data);
  return dst;
}

/**
 * Parses a color into [r, g, b, a] (0..255). Accepts '#rgb', '#rrggbb', '#rrggbbaa',
 * [r,g,b(,a)] arrays and {r,g,b,a} objects.
 * @param {string|number[]|{r:number,g:number,b:number,a?:number}} color
 * @returns {number[]} four integers 0..255
 */
export function parseColor(color) {
  if (typeof color === "string") {
    let s = color.trim();
    if (s[0] === "#") s = s.slice(1);
    if (s.length === 3 || s.length === 4) s = s.split("").map((c) => c + c).join("");
    if ((s.length !== 6 && s.length !== 8) || !/^[0-9a-fA-F]+$/.test(s)) throw new RangeError("parseColor: bad color " + color);
    const n = parseInt(s.slice(0, 6), 16);
    const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  if (Array.isArray(color) || ArrayBuffer.isView(color)) {
    return [clampByte(color[0]), clampByte(color[1]), clampByte(color[2]), color.length > 3 ? clampByte(color[3]) : 255];
  }
  if (color && typeof color === "object") {
    return [clampByte(color.r), clampByte(color.g), clampByte(color.b), color.a === undefined ? 255 : clampByte(color.a)];
  }
  throw new TypeError("parseColor: unsupported color");
}

/**
 * Formats 0..255 channel values as a lower-case hex color ('#rrggbb', or '#rrggbbaa' when alpha is given and < 255).
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} [a]
 * @returns {string}
 */
export function toHex(r, g, b, a) {
  const h = (v) => clampByte(v).toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b) + (a === undefined || clampByte(a) === 255 ? "" : h(a));
}

/**
 * Fills the whole image with one color (no blending).
 * @param {RGBAImage} img
 * @param {string|number[]} color
 * @returns {RGBAImage} img
 */
export function fillImage(img, color) {
  const c = parseColor(color);
  const d = img.data;
  const n = d.length;
  if (c[0] === c[1] && c[1] === c[2] && c[2] === c[3]) {
    d.fill(c[0]);
    return img;
  }
  for (let i = 0; i < n; i += 4) {
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = c[3];
  }
  return img;
}

/**
 * Raw pixel copy (no blending) of a rectangle from `src` to `dst`, clipped against both images.
 * @param {RGBAImage} dst destination image
 * @param {RGBAImage} src source image
 * @param {number} sx source x
 * @param {number} sy source y
 * @param {number} w width
 * @param {number} h height
 * @param {number} dx destination x
 * @param {number} dy destination y
 * @returns {Rect} the destination rectangle that was written (width 0 if nothing)
 */
export function copyRegion(dst, src, sx, sy, w, h, dx, dy) {
  sx |= 0; sy |= 0; w |= 0; h |= 0; dx |= 0; dy |= 0;
  if (sx < 0) { dx -= sx; w += sx; sx = 0; }
  if (sy < 0) { dy -= sy; h += sy; sy = 0; }
  if (dx < 0) { sx -= dx; w += dx; dx = 0; }
  if (dy < 0) { sy -= dy; h += dy; dy = 0; }
  w = Math.min(w, src.width - sx, dst.width - dx);
  h = Math.min(h, src.height - sy, dst.height - dy);
  if (w <= 0 || h <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const sd = src.data;
  const dd = dst.data;
  const rowLen = w * 4;
  for (let y = 0; y < h; y++) {
    const so = ((sy + y) * src.width + sx) * 4;
    const dO = ((dy + y) * dst.width + dx) * 4;
    if (sd === dd && so === dO) continue;
    dd.set(sd.subarray(so, so + rowLen), dO);
  }
  return { x: dx, y: dy, width: w, height: h };
}

/**
 * Draws `src` onto `dst` at (dx, dy). Mode 'copy' replaces pixels, 'over' composites with
 * non-premultiplied source-over (optionally scaled by `opacity`).
 * @param {RGBAImage} dst
 * @param {RGBAImage} src
 * @param {number} dx
 * @param {number} dy
 * @param {{sx?:number, sy?:number, width?:number, height?:number, mode?:'copy'|'over', opacity?:number}} [opts]
 * @returns {Rect} destination rectangle written
 */
export function blit(dst, src, dx, dy, opts = {}) {
  const sx = opts.sx | 0;
  const sy = opts.sy | 0;
  const w = opts.width === undefined ? src.width - sx : opts.width | 0;
  const h = opts.height === undefined ? src.height - sy : opts.height | 0;
  const opacity = opts.opacity === undefined ? 1 : clamp01(opts.opacity);
  if ((opts.mode || "copy") === "copy" && opacity === 1) return copyRegion(dst, src, sx, sy, w, h, dx, dy);

  // Clip like copyRegion.
  let cx = sx, cy = sy, cw = w, ch = h, ox = dx | 0, oy = dy | 0;
  if (cx < 0) { ox -= cx; cw += cx; cx = 0; }
  if (cy < 0) { oy -= cy; ch += cy; cy = 0; }
  if (ox < 0) { cx -= ox; cw += ox; ox = 0; }
  if (oy < 0) { cy -= oy; ch += oy; oy = 0; }
  cw = Math.min(cw, src.width - cx, dst.width - ox);
  ch = Math.min(ch, src.height - cy, dst.height - oy);
  if (cw <= 0 || ch <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const sd = src.data;
  const dd = dst.data;
  const copyMode = (opts.mode || "copy") === "copy";
  for (let y = 0; y < ch; y++) {
    let si = ((cy + y) * src.width + cx) * 4;
    let di = ((oy + y) * dst.width + ox) * 4;
    for (let x = 0; x < cw; x++, si += 4, di += 4) {
      const sa = (sd[si + 3] * opacity) / 255;
      if (copyMode) {
        // opacity < 1 in copy mode: interpolate toward the source including alpha.
        const da0 = dd[di + 3];
        const a = da0 + (sd[si + 3] - da0) * opacity;
        if (a <= 0) { dd[di] = dd[di + 1] = dd[di + 2] = dd[di + 3] = 0; continue; }
        const k = opacity;
        const wd = da0 * (1 - k);
        const ws = sd[si + 3] * k;
        dd[di] = (dd[di] * wd + sd[si] * ws) / a;
        dd[di + 1] = (dd[di + 1] * wd + sd[si + 1] * ws) / a;
        dd[di + 2] = (dd[di + 2] * wd + sd[si + 2] * ws) / a;
        dd[di + 3] = a;
        continue;
      }
      if (sa <= 0) continue;
      const da = dd[di + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) continue;
      const wd = (da * (1 - sa)) / oa;
      const ws = sa / oa;
      dd[di] = dd[di] * wd + sd[si] * ws;
      dd[di + 1] = dd[di + 1] * wd + sd[si + 1] * ws;
      dd[di + 2] = dd[di + 2] * wd + sd[si + 2] * ws;
      dd[di + 3] = oa * 255;
    }
  }
  return { x: ox, y: oy, width: cw, height: ch };
}

/**
 * Returns a new image holding the rectangle (x, y, w, h). Areas outside `img` are transparent.
 * @param {RGBAImage} img
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {RGBAImage}
 */
export function cropImage(img, x, y, w, h) {
  const out = createImage(w, h);
  copyRegion(out, img, x, y, out.width, out.height, 0, 0);
  return out;
}

/**
 * Mirrors an image. Returns a NEW image; the source is not modified.
 * Accepts `(img, horizontal, vertical)` booleans, or `(img, 'horizontal'|'vertical'|'both')`,
 * or `(img, { horizontal, vertical })`.
 * @param {RGBAImage} img
 * @param {boolean|string|{horizontal?:boolean,vertical?:boolean}} [horizontal=true]
 * @param {boolean} [vertical=false]
 * @returns {RGBAImage}
 */
export function flipImage(img, horizontal = true, vertical = false) {
  let h = horizontal;
  let v = vertical;
  if (typeof horizontal === "string") {
    h = horizontal === "horizontal" || horizontal === "both" || horizontal === "h";
    v = horizontal === "vertical" || horizontal === "both" || horizontal === "v";
  } else if (horizontal && typeof horizontal === "object") {
    h = !!horizontal.horizontal;
    v = !!horizontal.vertical;
  }
  const { width: w, height: ht } = img;
  const out = createImage(w, ht);
  const sBuf = img.data.byteOffset % 4 === 0 ? img.data : new Uint8ClampedArray(img.data);
  const s = new Uint32Array(sBuf.buffer, sBuf.byteOffset, w * ht);
  const d = new Uint32Array(out.data.buffer, 0, w * ht);
  for (let y = 0; y < ht; y++) {
    const sy = v ? ht - 1 - y : y;
    const so = sy * w;
    const dO = y * w;
    if (!h) {
      d.set(s.subarray(so, so + w), dO);
    } else {
      for (let x = 0; x < w; x++) d[dO + x] = s[so + w - 1 - x];
    }
  }
  return out;
}

/**
 * True when every pixel has alpha 255.
 * @param {RGBAImage} img
 * @returns {boolean}
 */
export function isOpaque(img) {
  const d = img.data;
  for (let i = 3, n = d.length; i < n; i += 4) if (d[i] !== 255) return false;
  return true;
}

/**
 * Premultiplies colors by alpha in place (8-bit, lossy for low alpha).
 * @param {RGBAImage} img
 * @returns {RGBAImage} img
 */
export function premultiplyInPlace(img) {
  const d = img.data;
  for (let i = 0, n = d.length; i < n; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    d[i] = div255(d[i] * a);
    d[i + 1] = div255(d[i + 1] * a);
    d[i + 2] = div255(d[i + 2] * a);
  }
  return img;
}

/**
 * Reverses {@link premultiplyInPlace} in place (8-bit, lossy for low alpha).
 * @param {RGBAImage} img
 * @returns {RGBAImage} img
 */
export function unpremultiplyInPlace(img) {
  const d = img.data;
  for (let i = 0, n = d.length; i < n; i += 4) {
    const a = d[i + 3];
    if (a === 255 || a === 0) continue;
    const k = 255 / a;
    d[i] = d[i] * k;
    d[i + 1] = d[i + 1] * k;
    d[i + 2] = d[i + 2] * k;
  }
  return img;
}

/**
 * Converts to a premultiplied float buffer (interleaved RGBA, all channels 0..255 scale).
 * @param {RGBAImage} img
 * @param {Float32Array} [out] optional destination of length width*height*4
 * @returns {Float32Array}
 */
export function toPremultipliedFloat(img, out) {
  const d = img.data;
  const n = d.length;
  const f = out || new Float32Array(n);
  for (let i = 0; i < n; i += 4) {
    const a = d[i + 3];
    const k = a * (1 / 255);
    f[i] = d[i] * k;
    f[i + 1] = d[i + 1] * k;
    f[i + 2] = d[i + 2] * k;
    f[i + 3] = a;
  }
  return f;
}

/**
 * Converts a premultiplied float buffer (see {@link toPremultipliedFloat}) back into `img`.
 * @param {Float32Array} f
 * @param {RGBAImage} img destination image
 * @returns {RGBAImage} img
 */
export function fromPremultipliedFloat(f, img) {
  const d = img.data;
  const n = d.length;
  for (let i = 0; i < n; i += 4) {
    const a = f[i + 3];
    if (a <= 0.0005) {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
      continue;
    }
    const k = 255 / a;
    d[i] = f[i] * k;
    d[i + 1] = f[i + 1] * k;
    d[i + 2] = f[i + 2] * k;
    d[i + 3] = a;
  }
  return img;
}

/**
 * Blends `processed` over `original` through a mask: result = original + (processed - original) * mask * amount.
 * Used by the host to apply any effect through a selection or layer mask. When the two images have
 * different alpha at a pixel the interpolation is done in premultiplied space (no fringes).
 *
 * The result is written into `out` (default: `processed`, which avoids an allocation); `out` may also be
 * `original`. Pixels where the effective weight is 0 receive the original pixel.
 * @param {RGBAImage} original image before the effect
 * @param {RGBAImage} processed image after the effect (same size)
 * @param {MaskData|null|undefined} mask 8-bit coverage, same size; null/undefined = everywhere
 * @param {number} [amount=1] global opacity of the effect, 0..1
 * @param {RGBAImage} [out=processed] destination
 * @returns {RGBAImage} out
 */
export function lerpWithMask(original, processed, mask, amount = 1, out = processed) {
  const n = original.width * original.height;
  if (processed.width !== original.width || processed.height !== original.height) throw new RangeError("lerpWithMask: size mismatch");
  if (out.width !== original.width || out.height !== original.height) throw new RangeError("lerpWithMask: size mismatch");
  if (mask && (mask.width !== original.width || mask.height !== original.height)) throw new RangeError("lerpWithMask: mask size mismatch");
  const amt = clamp01(amount);
  const o = original.data;
  const p = processed.data;
  const d = out.data;
  const md = mask ? mask.data : null;
  const outIsOrig = d === o;
  const outIsProc = d === p;
  if (!md && amt === 1) {
    if (!outIsProc) d.set(p);
    return out;
  }
  if (amt === 0 || (md && !hasNonZero(md))) {
    if (!outIsOrig) d.set(o);
    return out;
  }
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const m = md ? md[i] : 255;
    if (m === 0) {
      if (!outIsOrig) {
        d[j] = o[j]; d[j + 1] = o[j + 1]; d[j + 2] = o[j + 2]; d[j + 3] = o[j + 3];
      }
      continue;
    }
    if (m === 255 && amt === 1) {
      if (!outIsProc) {
        d[j] = p[j]; d[j + 1] = p[j + 1]; d[j + 2] = p[j + 2]; d[j + 3] = p[j + 3];
      }
      continue;
    }
    const t = (m * amt) / 255;
    const ao = o[j + 3];
    const ap = p[j + 3];
    if (ao === ap) {
      const r0 = o[j], g0 = o[j + 1], b0 = o[j + 2];
      const r1 = p[j], g1 = p[j + 1], b1 = p[j + 2];
      d[j] = r0 + (r1 - r0) * t;
      d[j + 1] = g0 + (g1 - g0) * t;
      d[j + 2] = b0 + (b1 - b0) * t;
      d[j + 3] = ao;
    } else {
      const a = ao + (ap - ao) * t;
      if (a <= 0) {
        d[j] = d[j + 1] = d[j + 2] = d[j + 3] = 0;
      } else {
        const wo = ao * (1 - t);
        const wp = ap * t;
        const inv = 1 / (wo + wp);
        const r = (o[j] * wo + p[j] * wp) * inv;
        const g = (o[j + 1] * wo + p[j + 1] * wp) * inv;
        const b = (o[j + 2] * wo + p[j + 2] * wp) * inv;
        d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = a;
      }
    }
  }
  return out;
}

function hasNonZero(a) {
  for (let i = 0, n = a.length; i < n; i++) if (a[i] !== 0) return true;
  return false;
}

/**
 * Intersects a rectangle with the image bounds. Returns a zero-size rect if nothing remains.
 * @param {Rect} r
 * @param {number} width
 * @param {number} height
 * @returns {Rect}
 */
export function clipRect(r, width, height) {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.width));
  const y1 = Math.min(height, Math.ceil(r.y + r.height));
  if (x1 <= x0 || y1 <= y0) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Union of two rectangles (a zero-size rect is the identity).
 * @param {Rect} a
 * @param {Rect} b
 * @returns {Rect}
 */
export function unionRect(a, b) {
  if (!a || a.width <= 0 || a.height <= 0) return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : { x: 0, y: 0, width: 0, height: 0 };
  if (!b || b.width <= 0 || b.height <= 0) return { x: a.x, y: a.y, width: a.width, height: a.height };
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
