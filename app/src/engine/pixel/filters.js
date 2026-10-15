// Filter registry. Every entry follows the EffectModule contract (docs/engine-contracts.md): length-like
// params (radius, distance, size, ...) are expressed in document pixels and multiplied by `ctx.scale`
// so a zoomed-out preview matches the full resolution result. Alpha is always preserved and
// blurs are premultiplied-alpha correct.

import { defineEffect, rangeControl as range, intControl, boolControl as bool, angleControl as angle, pointControl as point, selectControl as select } from "./effect.js";
import { gaussianBlurImage, boxBlurImage } from "./blur.js";
import { motionBlur, radialBlur, defocusBlur, tiltShift, bloom } from "./fx-blur.js";
import { unsharpMask, sharpen, clarity, highPass, medianFilter, noiseAdd, denoise, emboss, edgeDetect } from "./fx-detail.js";
import { pixelate, vignette, oilPaint, halftone, glitch } from "./fx-style.js";

/**
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RGBAImage
 * @typedef {import('./effect.js').EffectModule} EffectModule
 */

const QUALITY = [["draft", "Draft"], ["good", "Good"], ["best", "Best"]];
const CENTER = () => ({ x: 0.5, y: 0.5 });

/**
 * Registry of filters keyed by id: gaussian-blur, box-blur, motion-blur, radial-blur, zoom-blur,
 * defocus, unsharp-mask, sharpen, clarity, high-pass, median, noise-add, denoise, pixelate, emboss,
 * edge-detect, vignette, oil-paint, halftone, bloom, tilt-shift, glitch.
 * @type {Object<string, EffectModule>}
 */
export const FILTERS = {
  "gaussian-blur": defineEffect(
    "gaussian-blur",
    "Gaussian Blur",
    "Blur",
    [range("radius", "Radius", 0, 250, 4, { step: 0.1, unit: "px", hint: "Standard deviation of the Gaussian." })],
    {},
    (img, p, ctx) => gaussianBlurImage(img, p.radius * ctx.scale),
  ),

  "box-blur": defineEffect(
    "box-blur",
    "Box Blur",
    "Blur",
    [range("radius", "Radius", 0, 250, 4, { step: 0.1, unit: "px" }), intControl("passes", "Smoothness", 1, 3, 1, { hint: "Number of box passes; 3 approximates a Gaussian." })],
    {},
    (img, p, ctx) => boxBlurImage(img, p.radius * ctx.scale, p.radius * ctx.scale, Math.max(1, Math.min(3, Math.round(p.passes)))),
  ),

  "motion-blur": defineEffect(
    "motion-blur",
    "Motion Blur",
    "Blur",
    [angle("angle", "Angle", 0), range("distance", "Distance", 0, 500, 20, { unit: "px" })],
    {},
    (img, p, ctx) => motionBlur(img, p.angle, p.distance * ctx.scale),
  ),

  "radial-blur": defineEffect(
    "radial-blur",
    "Radial Blur",
    "Blur",
    [
      range("angle", "Amount", 0, 180, 10, { unit: "°", hint: "Total rotation swept by the blur (spin)." }),
      point("center", "Center", CENTER()),
      select("quality", "Quality", QUALITY, "good"),
    ],
    {},
    (img, p) => radialBlur(img, "spin", (p.angle * Math.PI) / 180, p.center.x * img.width, p.center.y * img.height, p.quality),
  ),

  "zoom-blur": defineEffect(
    "zoom-blur",
    "Zoom Blur",
    "Blur",
    [range("amount", "Amount", 0, 95, 20, { unit: "%" }), point("center", "Center", CENTER()), select("quality", "Quality", QUALITY, "good")],
    {},
    (img, p) => radialBlur(img, "zoom", Math.min(0.95, p.amount / 100), p.center.x * img.width, p.center.y * img.height, p.quality),
  ),

  defocus: defineEffect(
    "defocus",
    "Lens Blur (Defocus)",
    "Blur",
    [range("radius", "Radius", 0, 40, 6, { step: 0.5, unit: "px", hint: "Disc kernel radius." })],
    {},
    (img, p, ctx) => defocusBlur(img, p.radius * ctx.scale),
  ),

  "tilt-shift": defineEffect(
    "tilt-shift",
    "Tilt-Shift",
    "Blur",
    [
      point("focus", "Focus Point", CENTER()),
      angle("angle", "Angle", 0),
      range("band", "Sharp Band", 0, 100, 20, { unit: "%", hint: "Half width of the sharp band relative to the shorter side." }),
      range("transition", "Transition", 1, 100, 30, { unit: "%" }),
      range("blur", "Blur", 0, 100, 12, { step: 0.5, unit: "px" }),
      range("saturation", "Saturation Boost", -100, 100, 20, { unit: "%" }),
    ],
    {},
    (img, p, ctx) => {
      const m = Math.min(img.width, img.height);
      return tiltShift(img, {
        fx: p.focus.x * img.width,
        fy: p.focus.y * img.height,
        angle: p.angle,
        band: (p.band / 100) * (m / 2),
        transition: (p.transition / 100) * (m / 2),
        blur: p.blur * ctx.scale,
        saturation: p.saturation / 100,
      });
    },
  ),

  "unsharp-mask": defineEffect(
    "unsharp-mask",
    "Unsharp Mask",
    "Sharpen",
    [
      range("amount", "Amount", 0, 500, 100, { unit: "%" }),
      range("radius", "Radius", 0.1, 100, 1.5, { step: 0.1, unit: "px" }),
      range("threshold", "Threshold", 0, 255, 0, { hint: "Only differences of at least this many levels are sharpened." }),
    ],
    {},
    (img, p, ctx) => unsharpMask(img, p.amount / 100, p.radius * ctx.scale, p.threshold),
  ),

  sharpen: defineEffect("sharpen", "Sharpen", "Sharpen", [range("amount", "Amount", 0, 200, 50, { unit: "%" })], {}, (img, p) => sharpen(img, p.amount / 100)),

  clarity: defineEffect(
    "clarity",
    "Clarity",
    "Sharpen",
    [range("amount", "Amount", -100, 100, 40, { unit: "%" }), range("radius", "Radius", 1, 100, 20, { step: 0.5, unit: "px" })],
    {},
    (img, p, ctx) => clarity(img, p.amount / 100, p.radius * ctx.scale),
  ),

  "high-pass": defineEffect(
    "high-pass",
    "High Pass",
    "Sharpen",
    [
      range("radius", "Radius", 0.1, 250, 3, { step: 0.1, unit: "px" }),
      range("strength", "Strength", 0, 500, 100, { unit: "%" }),
      bool("monochrome", "Monochrome", false),
    ],
    {},
    (img, p, ctx) => highPass(img, p.radius * ctx.scale, p.strength / 100, p.monochrome),
  ),

  median: defineEffect(
    "median",
    "Median",
    "Noise",
    [intControl("radius", "Radius", 1, 10, 1, { unit: "px" })],
    {},
    (img, p, ctx) => medianFilter(img, Math.max(1, Math.min(12, Math.round(p.radius * ctx.scale)))),
  ),

  "noise-add": defineEffect(
    "noise-add",
    "Add Noise",
    "Noise",
    [
      range("amount", "Amount", 0, 100, 15, { unit: "%" }),
      select("distribution", "Distribution", [["gaussian", "Gaussian"], ["uniform", "Uniform"]], "gaussian"),
      bool("monochrome", "Monochromatic", false),
      intControl("seed", "Seed", 0, 99999, 1, { hint: "The same seed always produces the same noise pattern." }),
    ],
    {},
    (img, p) => noiseAdd(img, p.amount, p.distribution !== "uniform", p.monochrome, p.seed),
  ),

  denoise: defineEffect(
    "denoise",
    "Reduce Noise",
    "Noise",
    [
      range("strength", "Luminance", 0, 100, 40, { unit: "%" }),
      range("colorStrength", "Color", 0, 100, 50, { unit: "%" }),
      range("radius", "Radius", 1, 20, 2, { step: 0.5, unit: "px" }),
      range("detail", "Preserve Detail", 0, 100, 20, { unit: "%" }),
    ],
    {},
    (img, p, ctx) => denoise(img, p.strength, p.colorStrength, p.radius * ctx.scale, p.detail),
  ),

  pixelate: defineEffect(
    "pixelate",
    "Pixelate",
    "Stylize",
    [range("size", "Cell Size", 1, 200, 8, { unit: "px" }), select("mode", "Sampling", [["average", "Average"], ["center", "Center"]], "average")],
    {},
    (img, p, ctx) => pixelate(img, p.size * ctx.scale, p.mode),
  ),

  emboss: defineEffect(
    "emboss",
    "Emboss",
    "Stylize",
    [
      angle("angle", "Light Angle", 135),
      range("height", "Height", 0.1, 20, 2, { step: 0.1, unit: "px" }),
      range("amount", "Amount", 1, 500, 100, { unit: "%" }),
      select("mode", "Result", [["gray", "Gray Relief"], ["color", "Keep Color"]], "gray"),
    ],
    {},
    (img, p, ctx) => emboss(img, p.angle, p.height * (p.amount / 100) * ctx.scale, p.mode === "color"),
  ),

  "edge-detect": defineEffect(
    "edge-detect",
    "Find Edges",
    "Stylize",
    [
      range("strength", "Strength", 1, 500, 100, { unit: "%" }),
      select("mode", "Edges", [["gray", "Luminance"], ["color", "Per Channel"]], "gray"),
      bool("invert", "Dark Edges on White", false),
    ],
    {},
    (img, p, ctx) => edgeDetect(img, (p.strength / 100) * ctx.scale, p.mode === "color", p.invert),
  ),

  vignette: defineEffect(
    "vignette",
    "Vignette",
    "Light",
    [
      range("amount", "Amount", -100, 100, -40, { unit: "%", hint: "Negative darkens the corners, positive lightens them." }),
      range("midpoint", "Midpoint", 0, 100, 50, { unit: "%" }),
      range("feather", "Feather", 0, 100, 50, { unit: "%" }),
      range("roundness", "Roundness", -100, 100, 0, { unit: "%", hint: "-100 squarish, 0 follows the image, 100 circular." }),
      point("center", "Center", CENTER()),
    ],
    {},
    (img, p) =>
      vignette(img, {
        amount: p.amount / 100,
        midpoint: p.midpoint / 100,
        feather: p.feather / 100,
        roundness: p.roundness / 100,
        cx: p.center.x * img.width,
        cy: p.center.y * img.height,
      }),
  ),

  "oil-paint": defineEffect(
    "oil-paint",
    "Oil Paint",
    "Stylize",
    [range("radius", "Brush Size", 1, 10, 3, { unit: "px" }), intControl("levels", "Detail Levels", 2, 64, 20)],
    {},
    (img, p, ctx) => oilPaint(img, Math.max(1, Math.min(12, Math.round(p.radius * ctx.scale))), p.levels),
  ),

  halftone: defineEffect(
    "halftone",
    "Halftone",
    "Stylize",
    [
      range("size", "Dot Spacing", 2, 60, 8, { step: 0.5, unit: "px" }),
      angle("angle", "Screen Angle", 0),
      select("mode", "Inks", [["cmyk", "CMYK"], ["gray", "Black"]], "cmyk"),
      range("mix", "Mix With Original", 0, 100, 100, { unit: "%" }),
    ],
    {},
    (img, p, ctx) => halftone(img, p.size * ctx.scale, p.angle, p.mode, p.mix / 100),
  ),

  bloom: defineEffect(
    "bloom",
    "Bloom",
    "Light",
    [
      range("threshold", "Threshold", 0, 254, 170, { hint: "Luma above which pixels glow." }),
      range("radius", "Radius", 1, 200, 20, { step: 0.5, unit: "px" }),
      range("intensity", "Intensity", 0, 300, 60, { unit: "%" }),
    ],
    {},
    (img, p, ctx) => bloom(img, p.threshold, p.radius * ctx.scale, p.intensity / 100),
  ),

  glitch: defineEffect(
    "glitch",
    "Glitch",
    "Distort",
    [
      intControl("seed", "Seed", 0, 99999, 7),
      range("amount", "Amount", 0, 100, 40, { unit: "%" }),
      range("displacement", "Row Displacement", 0, 500, 60, { unit: "px" }),
      range("channelShift", "Channel Shift", 0, 100, 6, { unit: "px" }),
      range("blockHeight", "Band Height", 1, 200, 24, { unit: "px" }),
    ],
    {},
    (img, p, ctx) =>
      glitch(img, {
        seed: p.seed,
        amount: p.amount / 100,
        displacement: p.displacement * ctx.scale,
        channelShift: p.channelShift * ctx.scale,
        blockHeight: Math.max(1, p.blockHeight * ctx.scale),
      }),
  ),
};

/**
 * Applies a filter by id.
 * @param {RGBAImage} img image (modified in place and returned)
 * @param {{kind: string, params?: object}} filter `kind` is an id of {@link FILTERS}
 * @param {{scale: number}} [ctx] render context; `scale` multiplies length-like params (default 1)
 * @returns {RGBAImage}
 */
export function applyFilter(img, filter, ctx = { scale: 1 }) {
  const mod = FILTERS[filter.kind];
  if (!mod) throw new RangeError("Unknown filter: " + filter.kind);
  return mod.apply(img, filter.params || {}, ctx);
}
