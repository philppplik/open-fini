// Pure gradient shapes for the Pixel gradient tool that Canvas2D has no native gradient for (reflected, diamond).
// `gradientParam` returns the position t (0..1) along the color ramp of a point; `fillGradient` renders a whole image.
// Tested in tests/pixel/gradient.test.js.
import { parseColor } from "./image.js";

/**
 * Ramp position of (x, y) for a gradient dragged from p0 to p1.
 * linear: projection on the drag line; reflected: mirrored on both sides of p0; diamond: |u| + |v| around p0 (rotated by the drag
 * direction); radial: distance from p0; angle: sweep around p0 starting at the drag direction.
 */
export function gradientParam(type, p0, p1, x, y) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = x - p0[0], py = y - p0[1];
  const u = px * ux + py * uy;
  const v = -px * uy + py * ux;
  let t;
  switch (type) {
    case "reflected": t = Math.abs(u) / len; break;
    case "diamond": t = (Math.abs(u) + Math.abs(v)) / len; break;
    case "radial": t = Math.hypot(px, py) / len; break;
    case "conic": {
      const a = Math.atan2(v, u);
      t = (a < 0 ? a + 2 * Math.PI : a) / (2 * Math.PI);
      break;
    }
    default: t = u / len;
  }
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Renders the gradient into an RGBA buffer (non-premultiplied interpolation of c0 -> c1).
 * @param {number} w @param {number} h
 * @param {string} type @param {number[]} p0 @param {number[]} p1 @param {string|number[]} c0 @param {string|number[]} c1
 * @returns {Uint8ClampedArray}
 */
export function fillGradient(w, h, type, p0, p1, c0, c1) {
  const a = parseColor(c0), b = parseColor(c1);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = gradientParam(type, p0, p1, x + 0.5, y + 0.5);
      const i = (y * w + x) * 4;
      out[i] = a[0] + (b[0] - a[0]) * t;
      out[i + 1] = a[1] + (b[1] - a[1]) * t;
      out[i + 2] = a[2] + (b[2] - a[2]) * t;
      out[i + 3] = a[3] + (b[3] - a[3]) * t;
    }
  }
  return out;
}
