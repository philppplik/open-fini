// Paint-bucket style fills built on the selection engine.

import { parseColor } from "./image.js";
import { Mask, magicWand } from "./selection.js";

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

/**
 * Composites a solid color over the image wherever `mask` has coverage (non-premultiplied
 * source-over; coverage scales the color's own alpha).
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img image, modified in place
 * @param {{width:number,height:number,data:Uint8Array}} mask coverage mask, same size as the image
 * @param {string|number[]} color '#rrggbb', '#rrggbbaa' or [r,g,b,a]
 * @param {{opacity?: number}} [opts] extra global opacity 0..1 (default 1)
 * @returns {Rect} dirty rectangle (width 0 when nothing changed)
 */
export function fillMask(img, mask, color, opts = {}) {
  if (mask.width !== img.width || mask.height !== img.height) throw new RangeError("fillMask: mask size mismatch");
  const c = parseColor(color);
  const opacity = opts.opacity === undefined ? 1 : Math.min(1, Math.max(0, opts.opacity));
  const W = img.width;
  const H = img.height;
  const md = mask.data;
  const d = img.data;
  const ca = (c[3] / 255) * opacity;
  const none = { x: 0, y: 0, width: 0, height: 0 };
  if (ca <= 0) return none;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  const cr = c[0], cg = c[1], cb = c[2];
  for (let y = 0; y < H; y++) {
    const mo = y * W;
    for (let x = 0; x < W; x++) {
      const m = md[mo + x];
      if (m === 0) continue;
      const sa = (m * ca) / 255;
      const j = (mo + x) * 4;
      if (sa >= 0.9999) {
        d[j] = cr;
        d[j + 1] = cg;
        d[j + 2] = cb;
        d[j + 3] = 255;
      } else {
        const da = d[j + 3] / 255;
        const oa = sa + da * (1 - sa);
        if (oa <= 0) continue;
        const wd = (da * (1 - sa)) / oa;
        const ws = sa / oa;
        d[j] = d[j] * wd + cr * ws;
        d[j + 1] = d[j + 1] * wd + cg * ws;
        d[j + 2] = d[j + 2] * wd + cb * ws;
        d[j + 3] = oa * 255;
      }
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return none;
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Paint bucket. Selects pixels similar to the one at (x, y) (see {@link magicWand}) and fills them.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img image, modified in place
 * @param {number} x seed x
 * @param {number} y seed y
 * @param {string|number[]} color fill color
 * @param {{tolerance?: number, contiguous?: boolean, antialias?: boolean, mask?: {width:number,height:number,data:Uint8Array}, grow?: number, opacity?: number}} [opts]
 *   tolerance 0..255 (default 32), contiguous (default true), antialias (default true), `mask` restricts the fill
 *   to a selection, `grow` expands the filled region by that many px (hides fringes), `opacity` 0..1
 * @returns {Rect} dirty rectangle (width 0 when nothing was filled)
 */
export function floodFill(img, x, y, color, opts = {}) {
  const region = magicWand(img, x, y, {
    tolerance: opts.tolerance === undefined ? 32 : opts.tolerance,
    contiguous: opts.contiguous !== false,
    antialias: opts.antialias !== false,
  });
  if (opts.grow > 0) region.grow(opts.grow);
  if (opts.mask) {
    if (opts.mask.width !== img.width || opts.mask.height !== img.height) throw new RangeError("floodFill: mask size mismatch");
    region.combine(opts.mask instanceof Mask ? opts.mask : new Mask(opts.mask), "intersect");
  }
  return fillMask(img, region, color, { opacity: opts.opacity });
}
