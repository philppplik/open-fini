// Windows icon (ICO) writer, clean-room from the public ICONDIR / ICONDIRENTRY layout: every size is stored as a PNG
// stream (supported by Windows Vista and later, every browser and every icon editor). Pure, no DOM.
//
// Public API
//   ICO_SIZES                                   the standard sizes written by default (16 … 256 px)
//   encodeIco(images)                           [{ width, height, png }] -> ICO bytes
//   icoFromImage(img, { sizes?, level? })        RGBA image { width, height, data } -> ICO bytes with every size up
//                                               to the image size (non-square images are centered on a transparent square)
//   resizeRgba(img, w, h)                       area-averaged resample with premultiplied alpha
// Invariants: at most 256 entries; sizes are 1..256 px (256 is written as 0 in the directory, as the format requires).
import { encodePng } from "./png.js";

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * @param {{ width: number, height: number, png: Uint8Array }[]} images
 * @returns {Uint8Array}
 */
export function encodeIco(images) {
  if (!images.length || images.length > 256) throw new Error("An icon holds 1 to 256 images.");
  for (const im of images) if (!(im.width >= 1 && im.width <= 256 && im.height >= 1 && im.height <= 256)) throw new Error("Icon images must be 1 to 256 pixels wide and high.");
  const head = 6 + 16 * images.length;
  const total = head + images.reduce((s, im) => s + im.png.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0, true);
  dv.setUint16(2, 1, true); // 1 = icon
  dv.setUint16(4, images.length, true);
  let at = head;
  images.forEach((im, i) => {
    const e = 6 + i * 16;
    out[e] = im.width & 0xff; // 256 -> 0
    out[e + 1] = im.height & 0xff;
    out[e + 2] = 0; // no palette
    out[e + 3] = 0;
    dv.setUint16(e + 4, 1, true); // color planes
    dv.setUint16(e + 6, 32, true); // bits per pixel
    dv.setUint32(e + 8, im.png.length, true);
    dv.setUint32(e + 12, at, true);
    out.set(im.png, at);
    at += im.png.length;
  });
  return out;
}

/**
 * Area-averaged resample (premultiplied, so transparent pixels do not darken edges).
 * @param {{ width: number, height: number, data: ArrayLike<number> }} img
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }}
 */
export function resizeRgba(img, w, h) {
  const { width: sw, height: sh, data: s } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  const fx = sw / w;
  const fy = sh / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * fy;
    const y1 = Math.min(sh, y0 + fy);
    for (let x = 0; x < w; x++) {
      const x0 = x * fx;
      const x1 = Math.min(sw, x0 + fx);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const i = (sy * sw + sx) * 4;
          const al = s[i + 3] / 255;
          r += s[i] * al * wgt;
          g += s[i + 1] * al * wgt;
          b += s[i + 2] * al * wgt;
          a += al * wgt;
          area += wgt;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / (area || 1)) * 255);
    }
  }
  return { width: w, height: h, data: out };
}

/** Centers an image on a transparent square canvas (icons are square). */
function squared(img) {
  const n = Math.max(img.width, img.height);
  if (img.width === img.height) return img;
  const data = new Uint8ClampedArray(n * n * 4);
  const ox = (n - img.width) >> 1;
  const oy = (n - img.height) >> 1;
  const row = img.width * 4;
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * row, (y + 1) * row), ((y + oy) * n + ox) * 4);
  return { width: n, height: n, data };
}

/**
 * An ICO file with the standard sizes up to the image size (at least the smallest one).
 * @param {{ width: number, height: number, data: Uint8ClampedArray | Uint8Array }} img RGBA
 * @param {{ sizes?: number[], level?: number }} [o]
 */
export function icoFromImage(img, o = {}) {
  const sq = squared(img);
  const wanted = (o.sizes?.length ? o.sizes : ICO_SIZES).filter((n) => n >= 1 && n <= 256);
  let sizes = [...new Set(wanted)].filter((n) => n <= sq.width).sort((a, b) => a - b);
  if (!sizes.length) sizes = [Math.min(256, Math.max(1, sq.width))];
  const images = sizes.map((n) => {
    const im = n === sq.width ? sq : resizeRgba(sq, n, n);
    return { width: n, height: n, png: encodePng(im, { color: "rgba", level: o.level ?? 9 }) };
  });
  return encodeIco(images);
}
