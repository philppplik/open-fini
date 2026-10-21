// Surface styles: the DOM side. Writes the `--of-glass-*` variables and the `data-surface*` attributes on <html>,
// owns the background layer element (#of-backdrop) and the user's own background image.
//
// Public API
//   applyGlass(app, vars, theme)  called by ui/appearance.js after the theme (vars = resolved theme variables)
//   glassEnv(app)                 the environment that decides whether blur is active
//   setGlassImage(file)           downscale (<= 1920 px) + blurred copy, stored locally in kv storage only
//   clearGlassImage() / hasGlassImage() / onGlassImageChange(fn)
//
// Invariants
//   * <html data-surface="glass|liquid|sea"> is present only for a styled surface; absent means the unchanged solid look.
//   * <html data-glass-fx="on|off">: "off" (low power, high contrast, reduced transparency, no backdrop-filter) keeps the
//     tint but draws opaque panels and hides the background layer.
//   * The image never leaves the device: it is a Blob in IndexedDB (key `ui.glassImage`), never in prefs or profiles.
import { resolveGlass, glassSettings, effectiveBackdrop } from "./glass.js";

export const GLASS_IMAGE_KEY = "ui.glassImage";
const MAX_SIDE = 1920;
const BLUR_SIDE = 480;

let owned = new Set(); // CSS variables written last time
let backdrop = null;
let image = { loaded: false, loading: null, full: null, small: null, name: "" };
const listeners = new Set();
let envHooked = false;

const mq = (q) => (typeof matchMedia === "function" ? matchMedia(q) : { matches: false, addEventListener() {} });

export const glassSupported = () => typeof CSS !== "undefined" && !!CSS.supports && (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)"));

/** Inputs of `fxState()` read from the app and the browser. */
export function glassEnv(app) {
  return {
    lowPower: !!app.perf?.low,
    highContrast: !!app.prefs.highContrast,
    reducedTransparency: mq("(prefers-reduced-transparency: reduce)").matches,
    contrastMore: mq("(prefers-contrast: more)").matches,
    supported: glassSupported(),
  };
}

function ensureBackdrop() {
  if (backdrop?.isConnected) return backdrop;
  backdrop = document.createElement("div");
  backdrop.id = "of-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.append(document.createElement("i"));
  document.body.prepend(backdrop);
  return backdrop;
}

/** Applies the surface style to the document. Returns the result of `resolveGlass` (for the settings UI). */
export function applyGlass(app, vars, theme) {
  const root = document.documentElement;
  const prefs = theme?.surface === "none" ? { ...app.prefs, surfaceStyle: "solid" } : app.prefs;
  const g = resolveGlass(vars, prefs, glassEnv(app));

  for (const k of owned) root.style.removeProperty(k);
  owned = new Set(Object.keys(g.vars));
  for (const [k, v] of Object.entries(g.vars)) root.style.setProperty(k, v);

  if (g.style === "solid") {
    delete root.dataset.surface;
    delete root.dataset.glassFx;
    delete root.dataset.glassBd;
    delete root.dataset.glassAnim;
    backdrop?.remove();
    backdrop = null;
  } else {
    const s = glassSettings(prefs);
    root.dataset.surface = g.style;
    root.dataset.glassFx = g.on ? "on" : "off";
    if (s.backdrop === "image" || prefs.glassBackdrop === "image") loadImage().then(() => updateBackdrop(app, prefs, g));
    updateBackdrop(app, prefs, g);
  }
  if (!envHooked) {
    envHooked = true;
    // the system can change these at any time: re-apply the whole appearance
    const redo = () => app.emit("prefs", "*");
    for (const q of ["(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)", "(prefers-reduced-motion: reduce)"]) mq(q).addEventListener?.("change", redo);
  }
  return g;
}

function updateBackdrop(app, prefs, g) {
  const root = document.documentElement;
  const s = glassSettings(prefs);
  const id = effectiveBackdrop(s, !!image.full);
  root.dataset.glassBd = id;
  const reduce = root.classList.contains("of-reduce-motion") || mq("(prefers-reduced-motion: reduce)").matches;
  root.dataset.glassAnim = s.animate && g.on && !reduce && !app.perf?.low ? "on" : "off";
  if (g.style === "solid") return;
  ensureBackdrop();
  const el = root;
  if (id === "image" && image.full) el.style.setProperty("--of-glass-img", `url("${image.full}"), url("${image.small || image.full}")`);
  else el.style.removeProperty("--of-glass-img");
}

// ------------------------------------------------------------------ the user's image

function loadImage() {
  if (image.loaded) return Promise.resolve();
  image.loading ||= import("../core/storage.js")
    .then((kv) => kv.kvGet(GLASS_IMAGE_KEY))
    .then((rec) => {
      if (rec?.full instanceof Blob) setUrls(rec);
      image.loaded = true;
      for (const fn of listeners) fn();
    })
    .catch(() => {
      image.loaded = true;
    });
  return image.loading;
}

function setUrls(rec) {
  if (image.full) URL.revokeObjectURL(image.full);
  if (image.small) URL.revokeObjectURL(image.small);
  image.full = rec ? URL.createObjectURL(rec.full) : null;
  image.small = rec?.small instanceof Blob ? URL.createObjectURL(rec.small) : null;
  image.name = rec?.name || "";
}

export const hasGlassImage = () => !!image.full;
export const glassImageName = () => image.name;
export function onGlassImageChange(fn) {
  listeners.add(fn);
  loadImage();
  return () => listeners.delete(fn);
}

function drawScaled(bitmap, side, blurPx) {
  const k = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (blurPx) ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode the image."))), "image/jpeg", blurPx ? 0.7 : 0.86));
}

/**
 * Stores a picture as the background layer. Throws a readable Error for files that are not images.
 * @param {File} file
 */
export async function setGlassImage(file) {
  if (!file || !/^image\//.test(file.type || "")) throw new Error("Choose an image file (PNG, JPEG, WebP or GIF).");
  if (file.size > 40 * 1024 * 1024) throw new Error("That image is too large (limit 40 MB).");
  const bitmap = await createImageBitmap(file);
  try {
    const rec = { full: await drawScaled(bitmap, MAX_SIDE, 0), small: await drawScaled(bitmap, BLUR_SIDE, 6), name: String(file.name || "image").slice(0, 80) };
    const kv = await import("../core/storage.js");
    await kv.kvSet(GLASS_IMAGE_KEY, rec);
    setUrls(rec);
    image.loaded = true;
    for (const fn of listeners) fn();
  } finally {
    bitmap.close?.();
  }
}

export async function clearGlassImage() {
  const kv = await import("../core/storage.js");
  await kv.kvDelete(GLASS_IMAGE_KEY);
  setUrls(null);
  for (const fn of listeners) fn();
}
