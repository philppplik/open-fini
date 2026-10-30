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
}
