// Live layer effects (non-destructive, stored on nodes as `fx[]`) and blend modes.
// Controls follow the shared Control schema (docs/engine-contracts.md §1.1) so the UI is generated.

export const BLEND_MODES = [
  { value: "normal", label: "Normal" },
  { value: "darken", label: "Darken" },
  { value: "multiply", label: "Multiply" },
  { value: "color-burn", label: "Color Burn" },
  { value: "lighten", label: "Lighten" },
  { value: "screen", label: "Screen" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "overlay", label: "Overlay" },
  { value: "soft-light", label: "Soft Light" },
  { value: "hard-light", label: "Hard Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

const color = (key, label, def) => ({ key, label, type: "color", default: def });
const rng = (key, label, min, max, step, def, unit) => ({ key, label, type: "range", min, max, step, default: def, unit });

export const LAYER_FX = {
  dropShadow: {
    label: "Outer Shadow",
    defaults: { type: "dropShadow", enabled: true, color: "#000000", alpha: 0.5, blur: 10, dx: 0, dy: 4 },
    controls: [color("color", "Color", "#000000"), rng("alpha", "Opacity", 0, 1, 0.01, 0.5), rng("blur", "Radius", 0, 100, 0.5, 10, "px"), rng("dx", "Offset X", -100, 100, 1, 0, "px"), rng("dy", "Offset Y", -100, 100, 1, 4, "px")],
  },
  innerShadow: {
    label: "Inner Shadow",
    defaults: { type: "innerShadow", enabled: true, color: "#000000", alpha: 0.5, blur: 8, dx: 0, dy: 3 },
    controls: [color("color", "Color", "#000000"), rng("alpha", "Opacity", 0, 1, 0.01, 0.5), rng("blur", "Radius", 0, 100, 0.5, 8, "px"), rng("dx", "Offset X", -100, 100, 1, 0, "px"), rng("dy", "Offset Y", -100, 100, 1, 3, "px")],
  },
  outerGlow: {
    label: "Outer Glow",
    defaults: { type: "outerGlow", enabled: true, color: "#8b7cf6", alpha: 0.8, radius: 14, spread: 0.3 },
    controls: [color("color", "Color", "#8b7cf6"), rng("alpha", "Opacity", 0, 1, 0.01, 0.8), rng("radius", "Radius", 0, 100, 0.5, 14, "px"), rng("spread", "Intensity", 0, 3, 0.1, 0.3)],
  },
  innerGlow: {
    label: "Inner Glow",
    defaults: { type: "innerGlow", enabled: true, color: "#ffffff", alpha: 0.7, radius: 12 },
    controls: [color("color", "Color", "#ffffff"), rng("alpha", "Opacity", 0, 1, 0.01, 0.7), rng("radius", "Radius", 0, 100, 0.5, 12, "px")],
  },
  outline: {
    label: "Outline",
    defaults: { type: "outline", enabled: true, color: "#000000", alpha: 1, width: 3 },
    controls: [color("color", "Color", "#000000"), rng("alpha", "Opacity", 0, 1, 0.01, 1), rng("width", "Width", 0, 60, 0.5, 3, "px")],
  },
  colorOverlay: {
    label: "Color Overlay",
    defaults: { type: "colorOverlay", enabled: true, color: "#ff3b6b", alpha: 0.5 },
    controls: [color("color", "Color", "#ff3b6b"), rng("alpha", "Opacity", 0, 1, 0.01, 0.5)],
  },
  blur: {
    label: "Gaussian Blur",
    defaults: { type: "blur", enabled: true, radius: 6 },
    controls: [rng("radius", "Radius", 0, 100, 0.5, 6, "px")],
  },
};

export const FX_ORDER = ["dropShadow", "innerShadow", "outerGlow", "innerGlow", "outline", "colorOverlay", "blur"];

export function newFx(type) {
  const d = LAYER_FX[type];
  return d ? JSON.parse(JSON.stringify(d.defaults)) : null;
}
