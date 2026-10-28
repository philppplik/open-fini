// Magic Eraser: one click erases the pixels of the active pixel layer that are similar to the clicked color
// (contiguous or everywhere). One history step; respects the pixel selection and layer locks.
// Core logic: engine/pixel/selection.js magicWand().
import { Tool } from "../../core/tool.js";
import { paintTarget, toLayer, layerSpaceMask, commitPixelEdit } from "../../core/pixel.js";
import { ctx2d } from "../../core/doc.js";
import { magicWand } from "../../engine/pixel/index.js";
import { N_ } from "../../i18n/index.js";

export class MagicEraserTool extends Tool {
  static id = "magic-eraser";
  static label = "Magic Eraser";
  static icon = "eraser";
  static shortcut = "E";
  static studios = ["pixel"];
  static options = [
    { key: "tolerance", label: N_("Tolerance"), type: "int", min: 0, max: 255, step: 1, default: 32 },
    { key: "contiguous", label: N_("Contiguous"), type: "bool", default: true },
    { key: "opacity", label: N_("Opacity"), type: "range", min: 0.05, max: 1, step: 0.01, default: 1 },
  ];
  cursor = "crosshair";

  pointerDown(e) {
    const app = this.app;
    const t = paintTarget(app);
    if (!t) return app.toast("Select a pixel layer first.", "warning");
    if (t.locked) return app.toast("This layer is locked.", "warning");
    const [lx, ly] = toLayer(t, e.x, e.y);
    const W = t.canvas.width, H = t.canvas.height;
    if (lx < 0 || ly < 0 || lx >= W || ly >= H) return;
    const before = t.ctx.getImageData(0, 0, W, H);
    const after = new ImageData(new Uint8ClampedArray(before.data), W, H);
    const mask = magicWand(after, Math.floor(lx), Math.floor(ly), { tolerance: this.opts.tolerance, contiguous: this.opts.contiguous, antialias: true });
    const sel = layerSpaceMask(app, t);
    const selData = sel ? ctx2d(sel).getImageData(0, 0, W, H).data : null;
    let changed = false;
    for (let i = 0; i < W * H; i++) {
      let m = mask.data[i] / 255;
      if (!m) continue;
      if (selData) m *= selData[i * 4 + 3] / 255;
      const a = after.data[i * 4 + 3];
      const n = Math.round(a * (1 - m * this.opts.opacity));
      if (n !== a) {
        after.data[i * 4 + 3] = n;
        changed = true;
      }
    }
    if (!changed) return;
    t.ctx.putImageData(after, 0, 0);
    commitPixelEdit(app, t, { x: 0, y: 0, before, after }, "Magic Eraser");
    app.doc.touch(t.node);
    app.requestRender();
  }
}

export const PIXEL_ERASE_TOOLS = [MagicEraserTool];
