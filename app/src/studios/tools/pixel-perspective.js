// Perspective Crop: drag four corner handles onto the corners of a tilted rectangle (a document, a facade, a screen) and
// press Enter; the page is flattened and replaced by the straightened rectangle (homography warp, bicubic).
// This is destructive for the page content (all visible layers are merged into one pixel layer) but is ONE undo step.
// Core: engine/pixel/transform.js perspectiveWarp(); output size from quadSize() (tests/pixel/crop.test.js).
import { Tool } from "../../core/tool.js";
import { createCanvas, ctx2d } from "../../core/doc.js";
import { createNode } from "../../core/nodes.js";
import { rasterizeNodes } from "../../core/raster.js";
import { button } from "../../ui/controls.js";
import { N_ } from "../../i18n/index.js";
import { h } from "../../core/util.js";

export class PerspectiveCropTool extends Tool {
  static id = "perspective-crop";
  static label = "Perspective Crop";
  static icon = "of:crop";
  static shortcut = "C";
  static studios = ["pixel"];
  static options = [{ key: "filter", label: N_("Resampling"), type: "select", default: "bicubic", options: [{ value: "bicubic", label: N_("Bicubic") }, { value: "bilinear", label: N_("Bilinear") }, { value: "nearest", label: N_("Nearest neighbor (pixel art)") }] }];
  cursor = "crosshair";
  quad = null;
  drag = -1;

  activate() {
    const p = this.app.page;
    const mx = p.w * 0.1, my = p.h * 0.1;
    this.quad = [[mx, my], [p.w - mx, my], [p.w - mx, p.h - my], [mx, p.h - my]];
    this.app.requestOverlay();
  }
  deactivate() {
    this.quad = null;
  }
  #near(e) {
    const tol = 12 / this.app.view.zoom;
    let best = -1, bd = tol;
    this.quad.forEach(([x, y], i) => {
      const d = Math.hypot(x - e.x, y - e.y);
      if (d <= bd) { bd = d; best = i; }
    });
    return best;
  }
  hover(e) {
    if (this.quad) this.app.cv?.setCursor(this.#near(e) >= 0 ? "move" : "crosshair");
  }
  pointerDown(e) {
    if (this.quad) this.drag = this.#near(e);
  }
  pointerMove(e) {
    if (this.drag < 0) return;
    this.quad[this.drag] = [e.x, e.y];
    this.app.requestOverlay();
  }
  pointerUp() {
    this.drag = -1;
  }
  keyDown(ev) {
    if (ev.key === "Enter") return this.apply(), true;
    if (ev.key === "Escape") return this.app.setTool("move"), true;
    return false;
  }
  async apply() {
    const [{ perspectiveWarp }, { quadSize }] = await Promise.all([import("../../engine/pixel/transform.js"), import("../../engine/pixel/crop.js")]);
    const app = this.app, page = app.page, doc = app.doc;
    const nodes = page.root.children.filter((n) => n.visible);
    const r = nodes.length ? rasterizeNodes(app, nodes, { clip: false }) : null;
    if (!r) return app.toast("There is nothing visible to straighten.", "warning");
    const { w, h: hh } = quadSize(this.quad);
    if (w < 8 || hh < 8) return app.toast("The four corners are too close together.", "warning");
    const src = ctx2d(r.canvas).getImageData(0, 0, r.canvas.width, r.canvas.height);
    const q = this.quad.map(([x, y]) => [x - r.rect.x, y - r.rect.y]);
    const out = perspectiveWarp(src, q, w, hh, { filter: this.opts.filter });
    const cv = createCanvas(out.width, out.height);
    ctx2d(cv).putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
    const layer = createNode("pixel", { name: "Perspective crop", w: out.width, h: out.height });
    doc.pixels.set(layer.id, cv);
    doc.tx("Perspective Crop", () => {
      for (const n of [...page.root.children]) doc.remove(n);
      doc.insert(layer, page.root, 0);
      doc.set(page, { w: out.width, h: out.height, guides: { h: [], v: [] } });
    });
    app.state.pixelMask = null;
    app.select([layer]);
    app.cv?.fitPage();
    app.setTool("move");
  }
  contextBar() {
    return h("div.of-row.of-inline", button(N_("Apply crop"), () => this.apply(), { variant: "primary" }), button(N_("Cancel"), () => this.app.setTool("move")));
  }
  pillState() {
    return this.quad ? { key: N_("Perspective crop"), actions: [{ id: "apply", label: "Apply", key: "Enter", primary: true }, { id: "cancel", label: "Cancel", key: "Escape" }] } : null;
  }
  pillAction(id) {
    if (id === "apply") this.apply();
    else this.app.setTool("move");
  }
  overlay(ctx) {
    if (!this.quad) return;
    const pts = this.quad.map(([x, y]) => this.app.pageToScreen(x, y));
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = "#8b7cf6";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}
