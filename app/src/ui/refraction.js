// Liquid glass refraction: pure math and decisions. No DOM, runs under Node (tests/ui/refraction.test.js).
//
// Technique (own implementation, see docs/adr/0015-liquid-glass-refraction.md; the idea of "bend the backdrop with an
// SVG displacement map derived from a rim height profile and Snell's law" is credited to tomacco/amazing-glass, MIT):
//   1. A glass slab has a convex rim of width `bevel` that flattens into a plane. `profile(t)` is its height (t = 0 at the
//      edge, 1 at the end of the rim); the rim is a quarter sine, so the bend fades smoothly from the edge inwards.
//   2. The slope of that profile tilts the surface normal by theta; a vertical view ray bends by Snell's law (n = 1.5):
//      sin(thetaR) = sin(theta) / 1.5. The lateral shift grows with theta - thetaR; `RIM` stores it normalized (0..1).
//   3. `buildDisplacement` writes, per pixel of a rounded rectangle, the inward edge direction times that shift into the
//      red and green channels of an RGBA image (128 = no shift). The DOM side (refraction-dom.js) feeds that image to
//      <feImage> + <feDisplacementMap> inside `backdrop-filter: url(#filter)`; chromatic dispersion is three displacement
//      maps of slightly different strength, one per color channel.
//   The maps are built once per size class (`sizeClass`) and cached; nothing runs per frame.
//
// Public API
//   REFRACTION_DEFAULTS, clampRefraction(prefs)      the four tuning values, clamped
//   urlBackdropSupported(probe)                      decision from feature probes (Chromium-engine only)
//   refractionState(style, fx, supported, settings)  { on, reason }
//   sizeClass(n), mapKey(w,h,r,bevel)                quantization so equal-looking surfaces share one map
//   channelScales(strength, dispersion)              feDisplacementMap scales for r, g, b (px, already x2)
//   buildDisplacement(w, h, radius, bevel)           { width, height, data } RGBA bytes
//
// Invariants
//   * Refraction only moves backdrop pixels around inside the surface, so the colors behind a panel stay within the
//     worst-case backdrops ui/glass.js already tests; the fill opacity floors and lifted text are untouched.
//   * Everything here is deterministic and allocation-light (one Uint8ClampedArray per map).
export const REFRACTION_DEFAULTS = Object.freeze({ refraction: 60, bevel: 16, specular: 60, dispersion: 20 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

/** Clamped tuning values from raw prefs ({ glassRefraction, glassBevel, glassSpecular, glassDispersion }). */
export function clampRefraction(p = {}) {
  return {
    refraction: clamp(Math.round(num(p.glassRefraction, 60)), 0, 100),
    bevel: clamp(Math.round(num(p.glassBevel, 16)), 4, 40),
    specular: clamp(Math.round(num(p.glassSpecular, 60)), 0, 100),
    dispersion: clamp(Math.round(num(p.glassDispersion, 20)), 0, 100),
  };
}

/**
 * Does this browser render `backdrop-filter: url(#svg-filter)`? Only Chromium-based engines do (Chrome, Edge, WebView2,
 * Electron); Safari and Firefox either ignore the url() or drop the whole declaration. `probe` is measured by
 * refraction-dom.js: { css: CSS.supports("backdrop-filter","url(#x) blur(1px)"), computed: the probe element's computed
 * backdrop-filter keeps "url(", chromium: the engine is Chromium }.
 */
export const urlBackdropSupported = (probe = {}) => !!(probe.css && probe.computed && probe.chromium);

/**
 * Whether refraction is active. `fx` is fxState() of glass.js, `supported` the probe result.
 * @returns {{on:boolean, reason:string|null}} reason: style, fx, unsupported, off
 */
export function refractionState(style, fx, supported, settings) {
  if (style !== "liquid") return { on: false, reason: "style" };
  if (!fx?.on) return { on: false, reason: "fx" };
  if (!supported) return { on: false, reason: "unsupported" };
  if (!settings || settings.refraction <= 0) return { on: false, reason: "off" };
  return { on: true, reason: null };
}

const LADDER = [48, 64, 80, 96, 128, 160, 192, 256, 320, 384, 512, 640, 768, 1024, 1536, 2048];

/** Rounds a size in px to the nearest step of a geometric ladder: maps are shared inside a size class. */
export function sizeClass(n) {
  let best = LADDER[0];
  for (const s of LADDER) if (Math.abs(s - n) < Math.abs(best - n)) best = s;
  return best;
}

export const mapKey = (w, h, r, bevel) => `${sizeClass(w)}x${sizeClass(h)}r${Math.round(r)}b${Math.round(bevel)}`;

/**
 * feDisplacementMap scales (px) for the red, green and blue channel. A map value v in -1..1 shifts a pixel by
 * scale * v / 2, so the maximum shift at the rim is `strength` px (0.4 px per percent) for the middle channel;
 * dispersion spreads the red and blue channel by up to +-35 % of that around it.
 */
export function channelScales(strength, dispersion) {
  const s = clamp(strength, 0, 100) * 0.4 * 2;
  const d = clamp(dispersion, 0, 100) / 100;
  return [s * (1 + 0.35 * d), s, s * (1 - 0.35 * d)];
}

// ------------------------------------------------------------------ rim profile

const N_GLASS = 1.5;
const RIM_STEPS = 64;
/** Rim height: 0 at the edge (t = 0), 1 where the rim ends (t = 1). A quarter sine: steep at the edge, flat at the slab. */
export const profile = (t) => Math.sin((clamp(t, 0, 1) * Math.PI) / 2);
const RIM_SLOPE = 1.6; // bevel height / bevel width: how steep the rim is (a taller rim bends more)

/** Normalized lateral shift (0..1) per rim position t (0 edge .. 1 inner end), from the slope and Snell's law. */
export const RIM = (() => {
  const out = new Float32Array(RIM_STEPS + 1);
  let max = 0;
  for (let i = 0; i <= RIM_STEPS; i++) {
    const t = i / RIM_STEPS;
    const slope = RIM_SLOPE * Math.cos((t * Math.PI) / 2); // d(profile)/dt times the height ratio
    const theta = Math.atan(slope);
    const thetaR = Math.asin(Math.sin(theta) / N_GLASS);
    out[i] = Math.tan(theta - thetaR);
    max = Math.max(max, out[i]);
  }
  for (let i = 0; i <= RIM_STEPS; i++) out[i] = i === RIM_STEPS ? 0 : out[i] / max;
  return out;
})();

const rimAt = (t) => {
  const f = clamp(t, 0, 1) * RIM_STEPS;
  const i = Math.min(RIM_STEPS - 1, Math.floor(f));
  return RIM[i] + (RIM[i + 1] - RIM[i]) * (f - i);
};

/**
 * RGBA displacement map for a w x h rounded rectangle: R = x shift, G = y shift (128 = none), B = 128, A = 255.
 * The shift points inward (away from the nearest edge): the rim shows content from further inside, like a magnifying convex lens. It must not point outward: a backdrop-filter has no pixels beyond its own box, so those samples would be transparent holes.
 * `bevel` is the rim width in the same units as w and h.
 */
export function buildDisplacement(w, h, radius, bevel) {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const r = clamp(radius, 0, Math.min(W, H) / 2);
  const b = Math.max(1, bevel);
  const data = new Uint8ClampedArray(W * H * 4);
  const hx = W / 2;
  const hy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - hx;
      const py = y + 0.5 - hy;
      const qx = Math.abs(px) - (hx - r);
      const qy = Math.abs(py) - (hy - r);
      let nx;
      let ny;
      let sdf;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        nx = (qx / len) * Math.sign(px);
        ny = (qy / len) * Math.sign(py);
        sdf = len - r;
      } else if (qx > qy) {
        nx = Math.sign(px) || 1;
        ny = 0;
        sdf = qx - r;
      } else {
        nx = 0;
        ny = Math.sign(py) || 1;
        sdf = qy - r;
      }
      const d = -sdf; // distance from the edge, positive inside
      const m = d >= b ? 0 : rimAt(Math.max(0, d) / b);
      const i = (y * W + x) * 4;
      data[i] = 127.5 - 127.5 * nx * m; // inward: the rim magnifies content from inside the box
      data[i + 1] = 127.5 - 127.5 * ny * m;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}
