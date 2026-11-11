// Image-level commands of the Pixel studio: crop (tool / to selection), trim edges, reveal all, rotate, image size.
// The work is done by studios/tools/image-ops.js (loaded on first use); this file only registers the commands.
import { h } from "../core/util.js";
import { t, N_ } from "../i18n/index.js";
import { openDialog } from "../ui/dialogs.js";
import { numField, switchField } from "../ui/controls.js";

const hasDoc = (a) => !!a.doc;
const hasMask = (a) => !!a.state?.pixelMask;

/** Runs an image-ops function lazily and toasts the reason when it declined. */
const op = (name, ...args) => async (a) => {
  const m = await import("../studios/tools/image-ops.js");
  const r = await m[name](a, ...args);
  if (r !== true) a.toast(r, "warning");
};

export function registerPixelImageCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });
  def("doc.crop", "Crop", (a) => a.setTool("crop"), { enabled: hasDoc, icon: "of:crop" });
  def("doc.cropToSelection", "Crop to Selection", op("cropToSelection"), { enabled: hasMask });
  def("doc.trimTransparent", "Trim Transparent Edges", op("trimEdges", { mode: "transparent" }), { enabled: hasDoc });
  def("doc.trimColor", "Trim Edges of the Same Color", op("trimEdges", { mode: "topleft", tolerance: 8 }), { enabled: hasDoc });
  def("doc.revealAll", "Reveal All", op("revealAll"), { enabled: hasDoc });
  def("doc.rotate90ccw", "Rotate Document 90° Counter-Clockwise", op("rotateDocument", -90), { enabled: hasDoc });
  def("doc.rotate180", "Rotate Document 180°", op("rotateDocument", 180), { enabled: hasDoc });
  def("doc.rotateArbitrary", "Rotate Document by Angle…", (a) => {
    const st = { angle: 15, expand: true };
    const fa = numField({ label: N_("Angle"), value: st.angle, min: -360, max: 360, step: 0.5, precision: 1, unit: "°", wide: true, onChange: (v) => (st.angle = v) });
    const ex = switchField({ label: N_("Expand canvas to fit"), value: true, onChange: (v) => (st.expand = v) });
    openDialog({
      title: N_("Rotate Document"),
      body: h("div.of-form", fa.el, ex.el, h("p.of-hint", t("Positive angles rotate clockwise. New corners stay transparent."))),
      width: 380,
      buttons: [
        { label: "Cancel", onClick: (c) => c() },
        { label: N_("Rotate"), variant: "primary", onClick: (close) => { op("rotateDocument", st.angle, { expand: st.expand })(a); close(); } },
      ],
    });
  }, { enabled: hasDoc });
  // native photo edits on the active pixel layer (studios/tools/native-edit-ops.js, lazy)
  const ne = (fn, ...args) => async (a) => {
    const r = await (await import("../studios/tools/native-edit-ops.js"))[fn](a, ...args.map((x) => (typeof x === "function" ? x(a) : x)));
    if (r !== true) a.toast(r, "warning");
  };
  const px = { enabled: (a) => a.activeNode?.type === "pixel" };
  for (const [id, label, name, p] of [["removeBackground", N_("Remove Background"), "remove_background"], ["autoWhiteBalance", N_("Auto White Balance"), "auto_white_balance"], ["autoLevels", N_("Auto Levels"), "auto_levels"], ["autoContrast", N_("Auto Contrast"), "auto_contrast"], ["replaceColor", N_("Replace Foreground Color with Background Color"), "color_replace", (a) => ({ from: a.style?.primary, to: a.style?.secondary })], ["sharpen", N_("Unsharp Mask"), "sharpen"], ["denoise", N_("Reduce Noise"), "denoise"], ["vignette", N_("Vignette"), "vignette"], ["tiltShift", N_("Tilt-Shift Blur"), "tilt_shift"], ["upscale", N_("Upscale 2x"), "upscale", { factor: 2 }]]) def(`photo.${id}`, label, ne("editLayer", name, p || {}), px);
  def("select.subject", "Select Subject", ne("selectSubject"), { enabled: hasDoc });

  // healing (studios/tools/heal-ops.js, lazy; the pixel work runs on the worker pool)
  const heal = (fn, status, ...args) => async (a) => {
    a.status(t(status));
    try {
      const r = await (await import("../studios/tools/heal-ops.js"))[fn](a, ...args);
      if (typeof r === "string") a.toast(r, "warning", 6000);
      else if (r?.applied) a.toast(t("Straightened by {angle}°.", { angle: r.angle.toFixed(1) }), "success", 2500);
      else if (r?.applied === false) a.toast(t("The image is already level."), "success", 2500);
    } finally {
      a.status("");
    }
  };
  def("pixel.contentAwareFill", "Content-Aware Fill", heal("contentAwareFill", N_("Filling the selection…")), { shortcut: "Shift+Backspace", enabled: (a) => hasMask(a) && a.activeNode?.type === "pixel", icon: "magic" });
  def("doc.straightenHorizon", "Straighten Horizon", heal("straightenHorizon", N_("Looking for the horizon…")), { enabled: hasDoc, icon: "sunset" });

  // before / after (ui/compare.js, lazy): the first look of each page in the Pixel studio is the "before" state
  let compare = null;
  const loadCompare = async () => (compare ||= await import("../ui/compare.js"));
  const firstLook = () => {
    if (app.studio === "pixel" && app.doc && app.page) loadCompare().then((m) => m.captureFirstLook(app));
  };
  for (const ev of ["doc", "page", "studio"]) app.on(ev, firstLook);
  def("view.compare", "Compare Before / After", async (a) => {
    const r = (await loadCompare()).toggleCompare(a);
    if (typeof r === "string") a.toast(r, "warning", 6000);
  }, { shortcut: "Mod+Alt+Y", enabled: hasDoc, checked: () => !!compare?.isComparing(), icon: "layout-split" });
  def("view.compareSetBefore", "Set Current State as Before", async (a) => {
    (await loadCompare()).setBefore(a);
    a.toast(t("The current state is now the before state."), "success", 2000);
  }, { enabled: hasDoc });

  def("arrange.moveTo", "Move to Position…", async (a) => (await import("../studios/tools/move-to.js")).moveToDialog(a), { enabled: (a) => a.selection.some((n) => !n.locked) });
}
