// The color context of a document: its color settings (document.json -> settings.color) turned into ready-to-use
// conversions. Pure, lazily loaded.
//
// settings.color = { mode: "rgb" | "cmyk", rgb: "srgb" | "display-p3" | "adobe-rgb", cmyk: <asset id of a CMYK .icc> |
//   null (built-in approximation), cmykName, intent: 0 perceptual | 1 relative | 2 saturation | 3 absolute, bpc: bool }
// Document RGB values are interpreted in the RGB working space; CMYK values are percentages 0..100 stored on solid
// paints as `cmyk: [c, m, y, k]` (the paint's `color` is their RGB preview), spot colors add `spot: "Name"`.
import { parseICC, createTransform, bakeLut3, xyzToLab, deltaE } from "./icc.js";
import { rgbSpace, approxCmyk, buildRgbIcc, RGB_SPACES } from "./spaces.js";

export const INTENTS = ["perceptual", "relative", "saturation", "absolute"];
export const GAMUT_TOLERANCE = 3; // CIE76 Delta E

/** Fills defaults; unknown values fall back. */
export function normalizeColorSettings(s) {
  const o = s && typeof s === "object" ? s : {};
  return {
    mode: o.mode === "cmyk" ? "cmyk" : "rgb",
    rgb: RGB_SPACES.includes(o.rgb) ? o.rgb : "srgb",
    cmyk: typeof o.cmyk === "string" && o.cmyk ? o.cmyk : null,
    cmykName: typeof o.cmykName === "string" ? o.cmykName : "",
    intent: [0, 1, 2, 3].includes(o.intent) ? o.intent : 1,
    bpc: o.bpc !== false,
  };
}

const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
const toHex = (rgb) => "#" + rgb.map(hex2).join("");
const fromHex = (hex) => {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ""));
  const v = m ? parseInt(m[1], 16) : 0;
  return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};
const pct = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10;

/**
 * @param {object} settings settings.color
 * @param {Uint8Array|null} [iccBytes] the CMYK output profile, or null for the built-in approximation
 */
export function createColorContext(settings, iccBytes = null) {
  const s = normalizeColorSettings(settings);
  const rgb = rgbSpace(s.rgb);
  let cmyk = approxCmyk();
  if (iccBytes) {
    const p = parseICC(iccBytes);
    if (p.colorSpace !== "CMYK") throw new Error("The output profile must be a CMYK profile.");
    cmyk = p;
  }
  const opts = { intent: s.intent, bpc: s.bpc };
  const r2c = createTransform(rgb, cmyk, opts);
  const c2r = createTransform(cmyk, rgb, { intent: s.intent === 3 ? 3 : 1, bpc: s.bpc });
  const toLab = (v) => xyzToLab(rgb.to(1)(v));
  let imgLut = null;
  let proof = null;
  return {
    settings: s,
    approximate: !iccBytes,
    profileName: iccBytes ? cmyk.name : approxCmyk().name,
    cmykProfile: cmyk,
    /** '#rrggbb' -> [c, m, y, k] in percent (0.1 steps). */
    rgbToCmyk: (hex) => r2c(fromHex(hex)).map(pct),
    /** [c, m, y, k] percent -> '#rrggbb' preview in the working space. */
    cmykToHex: (c) => toHex(c2r(c.map((v) => (Number(v) || 0) / 100))),
    /** RGB 0..1 -> CMYK 0..1 (PDF writer). */
    toCmyk: (r, g, b) => r2c([r, g, b]),
    /** True when the RGB color survives the CMYK round trip within GAMUT_TOLERANCE. */
    inGamut(hex) {
      const v = fromHex(hex);
      return deltaE(toLab(c2r(r2c(v))), toLab(v)) <= GAMUT_TOLERANCE;
    },
    /** Interleaved RGB bytes (n*3) -> CMYK bytes (n*4) through a 17³ LUT. */
    imageToCmyk(rgbBytes) {
      imgLut ||= bakeLut3(r2c, 4, 17);
      const n = (rgbBytes.length / 3) | 0;
      const out = new Uint8Array(n * 4);
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        const v = imgLut.apply([rgbBytes[j] / 255, rgbBytes[j + 1] / 255, rgbBytes[j + 2] / 255]);
        for (let k = 0; k < 4; k++) out[i * 4 + k] = Math.round(Math.max(0, Math.min(1, v[k])) * 255);
      }
      return out;
    },
    /** Soft-proof table: 33³ nodes of [proofed r, g, b, Delta E / 100] (the 4th channel drives the gamut warning). */
    proofTables() {
      if (proof) return proof;
      const grid = 33;
      const lut = bakeLut3((v) => {
        const back = c2r(r2c(v));
        return [...back, deltaE(toLab(back), toLab(v)) / 100];
      }, 4, grid).data;
      return (proof = { grid, lut });
    },
    rgbIcc: () => buildRgbIcc(s.rgb),
    cmykIcc: iccBytes || null,
  };
}

/** Applies the proof table to RGBA pixels in place (trilinear, no allocations); `warn` paints out-of-gamut pixels gray. */
export function applyProof(data, { grid, lut }, { proof = true, warn = false } = {}) {
  const g = grid - 1;
  const s1 = grid * 4;
  const s0 = grid * grid * 4;
  const v = [0, 0, 0, 0];
  for (let p = 0; p < data.length; p += 4) {
    const r = (data[p] * g) / 255;
    const gg = (data[p + 1] * g) / 255;
    const b = (data[p + 2] * g) / 255;
    const r0 = Math.min(r | 0, g - 1);
    const g0 = Math.min(gg | 0, g - 1);
    const b0 = Math.min(b | 0, g - 1);
    const fr = r - r0;
    const fg = gg - g0;
    const fb = b - b0;
    const o = r0 * s0 + g0 * s1 + b0 * 4;
    for (let k = 0; k < 4; k++) {
      const c00 = lut[o + k] + (lut[o + 4 + k] - lut[o + k]) * fb;
      const c01 = lut[o + s1 + k] + (lut[o + s1 + 4 + k] - lut[o + s1 + k]) * fb;
      const c10 = lut[o + s0 + k] + (lut[o + s0 + 4 + k] - lut[o + s0 + k]) * fb;
      const c11 = lut[o + s0 + s1 + k] + (lut[o + s0 + s1 + 4 + k] - lut[o + s0 + s1 + k]) * fb;
      const c0 = c00 + (c01 - c00) * fg;
      v[k] = c0 + (c10 + (c11 - c10) * fg - c0) * fr;
    }
    if (warn && v[3] * 100 > GAMUT_TOLERANCE) {
      data[p] = data[p + 1] = data[p + 2] = 128;
    } else if (proof) {
      data[p] = Math.round(v[0] * 255);
      data[p + 1] = Math.round(v[1] * 255);
      data[p + 2] = Math.round(v[2] * 255);
    }
  }
}
