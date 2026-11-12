// Scene Studio property names (docs/scene-studio.md ▸ Animation): the labels of animatable property paths as the
// inspector, the timeline's keyframe rows and the graph editor show them, and the list of what a clip can animate.
import { t, N_ } from "../i18n/index.js";
import { EFFECTS } from "./effects.js";

export const PROP_LABEL = {
  x: N_("Position X"),
  y: N_("Position Y"),
  sx: N_("Scale X"),
  sy: N_("Scale Y"),
  rot: N_("Rotation"),
  opacity: N_("Opacity"),
  ax: N_("Anchor X"),
  ay: N_("Anchor Y"),
  volume: N_("Volume"),
  pan: N_("Pan"),
  remap: N_("Source time"),
  "crop.l": N_("Crop left"),
  "crop.t": N_("Crop top"),
  "crop.r": N_("Crop right"),
  "crop.b": N_("Crop bottom"),
  "mask.x": N_("Mask X"),
  "mask.y": N_("Mask Y"),
  "mask.w": N_("Mask width"),
  "mask.h": N_("Mask height"),
  "mask.feather": N_("Mask feather"),
  "text.size": N_("Font size"),
  "text.tracking": N_("Letter spacing"),
  "text.lineHeight": N_("Line height"),
  "text.strokeW": N_("Outline width"),
  "text.color": N_("Text color"),
  "shape.w": N_("Shape width"),
  "shape.h": N_("Shape height"),
  "shape.radius": N_("Corner radius"),
  "shape.strokeW": N_("Outline width"),
  "shape.fill": N_("Fill"),
};

/** The translated label of a property path of clip `c` ("Opacity", "Gaussian blur › Radius"). */
export function propLabel(c, path) {
  if (!path.startsWith("fx:")) return t(PROP_LABEL[path] || path);
  const [, fid, p] = path.split(":");
  const fx = c?.effects?.find((e) => e.id === fid);
  const def = fx && EFFECTS[fx.type];
  return def ? `${t(def.label)} › ${t(def.params[p]?.label || p)}` : p;
}

/** Every property path clip `c` can animate, in panel order (also those without keyframes). */
export function animatablePaths(c) {
  const out = [];
  if (c.type !== "audio") out.push("x", "y", "sx", "sy", "rot", "opacity", "ax", "ay");
  if (c.remap !== undefined) out.push("remap");
  if (c.volume !== undefined) out.push("volume", "pan");
  if (c.type === "video" || c.type === "image") out.push("crop.l", "crop.t", "crop.r", "crop.b");
  if (c.mask) out.push("mask.x", "mask.y", "mask.w", "mask.h", "mask.feather");
  if (c.type === "text") out.push("text.size", "text.tracking", "text.lineHeight", "text.strokeW", "text.color");
  if (c.type === "shape") out.push("shape.w", "shape.h", "shape.radius", "shape.strokeW", ...(c.shape.fill ? ["shape.fill"] : []));
  for (const e of c.effects || []) {
    const def = EFFECTS[e.type];
    if (!def || def.stage === "audio") continue;
    for (const [k, d] of Object.entries(def.params)) if (!d.options) out.push(`fx:${e.id}:${k}`);
  }
  return out;
}

/** Clip label colors (timeline, context menu, inspector). */
export const LABEL_COLORS = [
  { color: "#e5484d", label: N_("Red") },
  { color: "#f76b15", label: N_("Orange") },
  { color: "#ffc53d", label: N_("Yellow") },
  { color: "#46a758", label: N_("Green") },
  { color: "#12a594", label: N_("Teal") },
  { color: "#0090ff", label: N_("Blue") },
  { color: "#8e4ec6", label: N_("Violet") },
  { color: "#d6409f", label: N_("Pink") },
];
