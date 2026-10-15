/**
 * Text measurers for the layout engine.
 *
 * A measurer is a plain object `{measure(font, text) => widthPx, metrics(font) => {ascent, descent, ...}}` where
 * `font = {family, size, weight, style}` (size in px). The browser host builds one on top of
 * `CanvasRenderingContext2D.measureText`; tests and Node use {@link approxMeasurer}; hosts that load font files use
 * {@link makeSfntMeasurer}.
 *
 * @module measurers
 */

import { std14Name, std14TextWidth } from './std14.js';

/**
 * @typedef {{family: string, size: number, weight: number, style: 'normal'|'italic'}} FontSpec
 * @typedef {{ascent: number, descent: number, lineGap?: number, capHeight?: number, xHeight?: number}} FontMetrics
 *   all values in px for the font's size; `descent` is a positive magnitude
 * @typedef {{measure: (font: FontSpec, text: string) => number, metrics: (font: FontSpec) => FontMetrics}} Measurer
 */

/**
 * Typographic ascent / descent / cap height as fractions of the em for the three base families.
 * @type {Record<string, [number, number, number, number]>}
 */
const FAMILY_METRICS = {
  Helvetica: [0.905, 0.212, 0.716, 0.519],
  Times: [0.891, 0.216, 0.662, 0.448],
  Courier: [0.83, 0.3, 0.571, 0.423],
};

/**
 * Deterministic measurer that needs no canvas and no font files: advance widths are the Adobe AFM widths of the
 * base-14 font (Helvetica, Times or Courier, picked from the family name) for the Latin range and plausible
 * constants elsewhere. Widths scale linearly with size, there is no kerning. Intended for tests and Node usage.
 * @type {Measurer}
 */
export const approxMeasurer = {
  measure(font, text) {
    return (std14TextWidth(std14Name(font.family, font.weight, font.style), text) * font.size) / 1000;
  },
  metrics(font) {
    const ps = std14Name(font.family, font.weight, font.style);
    const m = FAMILY_METRICS[ps.startsWith('Times') ? 'Times' : ps.startsWith('Courier') ? 'Courier' : 'Helvetica'];
    const s = font.size;
    return { ascent: m[0] * s, descent: m[1] * s, lineGap: 0, capHeight: m[2] * s, xHeight: m[3] * s };
  },
};

/**
 * Builds a measurer from parsed fonts. `fontLookup` maps a font request to a `FontInfo` (see `parseFont` in sfnt.js)
 * or `null`; requests without a font fall back to {@link approxMeasurer}. Kerning is applied, tracking is not (the
 * layout engine adds it itself).
 * @param {(font: FontSpec) => (import('./sfnt.js').FontInfo|null|undefined)} fontLookup
 * @returns {Measurer}
 */
export function makeSfntMeasurer(fontLookup) {
  return {
    measure(font, text) {
      const info = fontLookup(font);
      if (!info) return approxMeasurer.measure(font, text);
      return info.measure(text, font.size);
    },
    metrics(font) {
      const info = fontLookup(font);
      if (!info) return approxMeasurer.metrics(font);
      const s = font.size / info.unitsPerEm;
      return {
        ascent: info.ascent * s,
        descent: info.descent * s,
        lineGap: info.lineGap * s,
        capHeight: info.capHeight * s,
        xHeight: info.xHeight * s,
      };
    },
  };
}
