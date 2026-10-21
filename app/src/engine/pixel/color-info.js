// Color readout values for the Info panel: hex, HSL, HSB, CIE Lab (D65) and the color difference between samples.
import { SRGB_TO_LINEAR } from "./color.js";

const hex2 = (v) => Math.round(v).toString(16).padStart(2, "0");

/**
 * @param {number} r 0..255
 * @param {number} g 0..255
 * @param {number} b 0..255
 * @param {number} [a] alpha 0..255 (default 255)
 * @returns {{r:number,g:number,b:number,a:number,hex:string,hsl:[number,number,number],hsb:[number,number,number],lab:[number,number,number]}} hue 0..360, s/l/b 0..100, L 0..100
 */
export function colorInfo(r, g, b, a = 255) {
  r = Math.round(r); g = Math.round(g); b = Math.round(b);
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
  let hue = 0;
  if (d) hue = mx === R ? ((G - B) / d + (G < B ? 6 : 0)) * 60 : mx === G ? ((B - R) / d + 2) * 60 : ((R - G) / d + 4) * 60;
  const l = (mx + mn) / 2;
  const sl = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const sb = mx ? d / mx : 0;
  const lr = SRGB_TO_LINEAR[r], lg = SRGB_TO_LINEAR[g], lb = SRGB_TO_LINEAR[b];
  const X = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const Y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const Z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return {
    r, g, b, a: Math.round(a), hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`,
    hsl: [hue, sl * 100, l * 100], hsb: [hue, sb * 100, mx * 100],
    lab: [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)],
  };
}

/** CIE76 color difference between two {@link colorInfo} results. */
export const deltaE = (p, q) => Math.hypot(p.lab[0] - q.lab[0], p.lab[1] - q.lab[1], p.lab[2] - q.lab[2]);
