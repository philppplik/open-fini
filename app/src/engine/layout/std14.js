/**
 * Metrics and encoding helpers for the 14 standard PDF fonts (Helvetica, Times, Courier families).
 *
 * The advance widths are the Adobe Core 14 AFM widths (1000 units per em) for the WinAnsi (Windows-1252)
 * code points 32..255, stored as compact comma separated tables. The Oblique / BoldOblique variants of
 * Helvetica and all four Courier variants share the widths of their upright siblings (Courier is 600 flat).
 * Symbol and ZapfDingbats are intentionally not provided.
 *
 * Shared by the layout engine (approximate measuring without a canvas) and the PDF backend.
 *
 * @module std14
 */

/** AFM widths for WinAnsi codes 32..255, one comma separated list per upright/bold/italic base font. */
const RAW = {
  'Helvetica': '278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500',
  'Helvetica-Bold': '278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556',
  'Times-Roman': '250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,350,500,350,333,500,444,1000,500,500,333,1000,556,333,889,350,611,350,350,333,333,444,444,350,500,1000,333,980,389,333,722,350,444,722,250,333,500,500,500,500,200,500,333,760,276,500,564,333,760,333,400,564,300,300,333,500,453,250,333,300,310,500,750,750,750,444,722,722,722,722,722,722,889,667,611,611,611,611,333,333,333,333,722,722,722,722,722,722,722,564,722,722,722,722,722,722,556,500,444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,564,500,500,500,500,500,500,500,500',
  'Times-Bold': '250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520,350,500,350,333,500,500,1000,500,500,333,1000,556,333,1000,350,667,350,350,333,333,500,500,350,500,1000,333,1000,389,333,722,350,444,722,250,333,500,500,500,500,220,500,333,747,300,500,570,333,747,333,400,570,300,300,333,556,540,250,333,300,330,500,750,750,750,500,722,722,722,722,722,722,1000,722,667,667,667,667,389,389,389,389,722,722,778,778,778,778,778,570,778,722,722,722,722,722,611,556,500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,500,556,500',
  'Times-Italic': '250,333,420,500,500,833,778,214,333,333,500,675,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,675,675,675,500,920,611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,611,722,611,500,556,722,611,833,611,556,556,389,278,389,422,500,333,500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,500,500,389,389,278,500,444,667,444,444,389,400,275,400,541,350,500,350,333,500,556,889,500,500,333,1000,500,333,944,350,556,350,350,333,333,556,556,350,500,889,333,980,389,333,667,350,389,556,250,389,500,500,500,500,275,500,333,760,276,500,675,333,760,333,400,675,300,300,333,500,523,250,333,300,310,500,750,750,750,500,611,611,611,611,611,611,889,667,611,611,611,611,333,333,333,333,722,667,722,722,722,722,722,675,722,722,722,722,722,556,611,500,500,500,500,500,500,500,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,675,500,500,500,500,500,444,500,444',
  'Times-BoldItalic': '250,389,555,500,500,833,778,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,832,667,667,667,722,667,667,722,778,389,500,667,611,889,722,722,611,722,667,556,611,722,667,889,667,611,611,333,278,333,570,500,333,500,500,444,500,444,333,500,556,278,278,500,278,778,556,500,500,500,389,389,278,556,444,667,500,444,389,348,220,348,570,350,500,350,333,500,500,1000,500,500,333,1000,556,333,944,350,611,350,350,333,333,500,500,350,500,1000,333,1000,389,333,722,350,389,611,250,389,500,500,500,500,220,500,333,747,266,500,606,333,747,333,400,570,300,300,333,576,500,250,333,300,300,500,750,750,750,500,667,667,667,667,667,667,944,667,667,667,667,667,389,389,389,389,722,722,722,722,722,722,722,570,722,722,722,722,722,611,611,500,500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,444,500,444',
};

/** @type {Record<string, Uint16Array>} */
const cache = {};

/** The base-14 PostScript names this module can handle. */
export const STD14_FONTS = Object.freeze([
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
]);

const MONO_RE = /courier|mono|consolas|menlo|monaco|typewriter|fixed|cascadia|lucida console|source code|fira code|inconsolata|andale/i;
const SERIF_RE = /times|serif|georgia|garamond|palatino|book antiqua|cambria|minion|baskerville|didot|bodoni|century|caslon|merriweather|playfair|lora|charter|constantia|bookman|libre baskerville|noto serif|song|ming|roman/i;

/**
 * Maps a CSS-like font description to the closest base-14 PostScript name using family-name heuristics:
 * monospace-looking names map to Courier, serif-looking names to Times, everything else to Helvetica.
 * @param {string} family
 * @param {number} [weight=400]  >= 600 selects the bold variant
 * @param {string} [style='normal']  'italic' or 'oblique' selects the italic/oblique variant
 * @returns {string} e.g. 'Helvetica-BoldOblique'
 */
export function std14Name(family, weight = 400, style = 'normal') {
  const f = String(family || '');
  const bold = weight >= 600;
  const ital = style === 'italic' || style === 'oblique';
  let base;
  if (MONO_RE.test(f)) base = 'Courier';
  else if (/sans|arial|helvet|verdana|tahoma|calibri|segoe|inter\b|roboto|open sans|arimo/i.test(f)) base = 'Helvetica';
  else if (SERIF_RE.test(f)) base = 'Times';
  else base = 'Helvetica';
  if (base === 'Times') return bold ? (ital ? 'Times-BoldItalic' : 'Times-Bold') : ital ? 'Times-Italic' : 'Times-Roman';
  const suffix = bold ? (ital ? '-BoldOblique' : '-Bold') : ital ? '-Oblique' : '';
  return base + suffix;
}

/**
 * Advance widths (1000 units per em) of the WinAnsi codes 32..255 for a base-14 font.
 * @param {string} psName One of {@link STD14_FONTS}
 * @returns {Uint16Array} length 224; index = code - 32
 */
export function std14Widths(psName) {
  let t = cache[psName];
  if (t) return t;
  if (psName.startsWith('Courier')) {
    t = new Uint16Array(224).fill(600);
  } else {
    const key = psName.replace('-BoldOblique', '-Bold').replace('-Oblique', '');
    const raw = RAW[key] || RAW.Helvetica;
    t = Uint16Array.from(raw.split(','), Number);
  }
  cache[psName] = t;
  return t;
}

const WIN_SPECIAL = new Map([
  [0x20ac, 128], [0x201a, 130], [0x0192, 131], [0x201e, 132], [0x2026, 133], [0x2020, 134],
  [0x2021, 135], [0x02c6, 136], [0x2030, 137], [0x0160, 138], [0x2039, 139], [0x0152, 140],
  [0x017d, 142], [0x2018, 145], [0x2019, 146], [0x201c, 147], [0x201d, 148], [0x2022, 149],
  [0x2013, 150], [0x2014, 151], [0x02dc, 152], [0x2122, 153], [0x0161, 154], [0x203a, 155],
  [0x0153, 156], [0x017e, 158], [0x0178, 159],
  // lossy fallbacks that keep text readable
  [0x2010, 45], [0x2011, 45], [0x2012, 150], [0x2212, 45], [0x00ad, 45],
  [0x2002, 32], [0x2003, 32], [0x2004, 32], [0x2005, 32], [0x2006, 32], [0x2007, 32], [0x2008, 32],
  [0x2009, 32], [0x200a, 32], [0x202f, 32], [0x3000, 32],
  [0x2032, 39], [0x2033, 34], [0x2215, 47], [0x2044, 47], [0x25cf, 149], [0x25aa, 149], [0x2023, 149],
]);

/**
 * Maps a Unicode code point to a WinAnsi (Windows-1252) code.
 * @param {number} cp
 * @returns {number} 32..255, or -1 when the character cannot be represented
 */
export function winAnsiCode(cp) {
  if (cp >= 32 && cp < 127) return cp;
  if (cp >= 160 && cp <= 255) return cp;
  const s = WIN_SPECIAL.get(cp);
  return s === undefined ? -1 : s;
}

/**
 * Width of a code point in a base-14 font, in 1000-unit em fractions. Unmappable characters use the width
 * of '?' (wide East Asian characters 1000), which is also what the PDF writer substitutes.
 * @param {string} psName
 * @param {number} cp
 * @returns {number}
 */
export function std14CodePointWidth(psName, cp) {
  const t = std14Widths(psName);
  const code = winAnsiCode(cp);
  if (code >= 0) return t[code - 32];
  if ((cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || cp >= 0x1f000) return 1000;
  return t[63 - 32];
}

/**
 * Width of a string in a base-14 font.
 * @param {string} psName
 * @param {string} text
 * @returns {number} width in 1000-unit em fractions (multiply by size / 1000 for pixels)
 */
export function std14TextWidth(psName, text) {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp < 0xdc00 && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        cp = ((cp - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
        i++;
      }
    }
    w += std14CodePointWidth(psName, cp);
  }
  return w;
}

const DESC = {
  'Helvetica': [718, -207, 718, 523, [-166, -225, 1000, 931], 0, 88],
  'Helvetica-Bold': [718, -207, 718, 532, [-170, -228, 1003, 962], 0, 140],
  'Helvetica-Oblique': [718, -207, 718, 523, [-170, -225, 1116, 931], -12, 88],
  'Helvetica-BoldOblique': [718, -207, 718, 532, [-174, -228, 1114, 962], -12, 140],
  'Times-Roman': [683, -217, 662, 450, [-168, -218, 1000, 898], 0, 84],
  'Times-Bold': [676, -205, 676, 461, [-168, -218, 1000, 935], 0, 139],
  'Times-Italic': [683, -217, 653, 441, [-169, -217, 1010, 883], -15.5, 76],
  'Times-BoldItalic': [699, -205, 669, 462, [-200, -218, 996, 921], -15, 121],
  'Courier': [629, -157, 562, 426, [-23, -250, 715, 805], 0, 51],
  'Courier-Bold': [629, -157, 562, 439, [-113, -250, 749, 801], 0, 106],
  'Courier-Oblique': [629, -157, 562, 426, [-27, -250, 849, 805], -12, 51],
  'Courier-BoldOblique': [629, -157, 562, 439, [-57, -250, 869, 801], -12, 106],
};

/**
 * FontDescriptor values of a base-14 font (1000 units per em).
 * @param {string} psName
 * @returns {{ascent:number, descent:number, capHeight:number, xHeight:number, bbox:number[], italicAngle:number, stemV:number, flags:number}}
 */
export function std14Metrics(psName) {
  const d = DESC[psName] || DESC.Helvetica;
  let flags = 32;
  if (psName.startsWith('Courier')) flags |= 1;
  if (psName.startsWith('Times')) flags |= 2;
  if (d[5]) flags |= 64;
  return { ascent: d[0], descent: d[1], capHeight: d[2], xHeight: d[3], bbox: d[4].slice(), italicAngle: d[5], stemV: d[6], flags };
}
