// Names and parameter defaults of the native photo edits (engine/pixel/native-edit.js). Kept apart so the UI and
// the Vibe tool schema can list them without loading the algorithms.
/** The edits `applyEdit` knows, with their parameter defaults (used by the UI and the Vibe tool schema). */
export const NATIVE_EDITS = {
  remove_background: { tolerance: 40, feather: 1.5, edges: 60 },
  auto_white_balance: {},
  auto_levels: { clip: 0.1 },
  auto_contrast: { clip: 0.1 },
  color_replace: { from: "#ff0000", to: "#0000ff", tolerance: 60 },
  sharpen: { amount: 0.8, radius: 1.5, threshold: 2 },
  denoise: { strength: 40, color: 50, radius: 2, detail: 30 },
  vignette: { amount: -0.4, midpoint: 0.5, feather: 0.6, roundness: 0 },
  tilt_shift: { band: 0.15, transition: 0.2, blur: 8, angle: 0, y: 0.5 },
  upscale: { factor: 2, detail: 0.4 },
};
