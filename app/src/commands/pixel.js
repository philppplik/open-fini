// Pixel-studio commands: selection operations, layers and masks, adjustments/filters, document operations, tracing.
import { h, clone } from "../core/util.js";
import { createNode, solid, worldMatrix, localBounds } from "../core/nodes.js";
import { createCanvas, ctx2d } from "../core/doc.js";
import { mul, translate, scale as scaleM, rotate, apply, ident } from "../core/math.js";
import { Mask, listEffects, getEffect, traceImage, resizeImage } from "../engine/pixel/index.js";
import { fitSubpath } from "../engine/vector/fit.js";
import { addNodes, topLevelSelection } from "../core/ops.js";
import { setMask, getMask, paintTarget, layerSpaceMask, commitPixelEdit, newPixelLayer, addLayerMask, removeLayerMask, maskCanvas } from "../core/pixel.js";
import { addEffectLayer, mergeDown, rasterizeToLayer, rasterizeNodes, flattenPage } from "../core/raster.js";
import { promptDialog, openDialog, confirmDialog } from "../ui/dialogs.js";
import { numField, selectField, switchField } from "../ui/controls.js";
import { cropPage } from "../studios/tools/pixel-misc.js";
import { pageVisualBounds } from "../core/raster.js";

const hasDoc = (a) => !!a.doc;
const hasMask = (a) => !!a.state?.pixelMask;

async function askNumber(title, label, value, { min = 0, max = 500 } = {}) {
  const v = await promptDialog({ title, label, value: String(value), type: "number" });
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

export function registerPixelCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });

  // ------------------------------------------------------------------ selection
  def("select.all", "Select All", (a) => {
    const p = a.page;
    setMask(a, Mask.full(Math.round(p.w), Math.round(p.h)), "Select All");
  }, { enabled: hasDoc });
  def("select.none", "Deselect", (a) => {
    a.state.lastMask = a.state.pixelMask ? a.state.pixelMask.clone() : a.state.lastMask;
    setMask(a, null, "Deselect");
  }, { enabled: hasMask });
  def("select.reselect", "Reselect", (a) => a.state.lastMask && setMask(a, a.state.lastMask.clone(), "Reselect"), { enabled: (a) => !!a.state?.lastMask && !a.state.pixelMask });
  def("select.invert", "Invert Selection", (a) => {
    const m = getMask(a);
    const p = a.page;
    const next = m ? m.clone() : Mask.empty(Math.round(p.w), Math.round(p.h));
    next.invert();
    setMask(a, next, "Invert Selection");
  }, { shortcut: "Mod+Shift+I", enabled: hasDoc });
  const refine = (id, label, op, askLabel, def0) =>
    def(id, label, async (a) => {
      const v = await askNumber(label, askLabel, def0, { min: 0, max: 300 });
      if (v == null) return;
      const next = getMask(a).clone();
      next[op](v);
      setMask(a, next, label.replace("…", ""));
    }, { enabled: hasMask });
  refine("select.feather", "Feather…", "feather", "Radius (px)", 8);
  refine("select.grow", "Grow…", "grow", "Pixels", 4);
  refine("select.shrink", "Shrink…", "shrink", "Pixels", 4);
  refine("select.border", "Border…", "border", "Width (px)", 6);
  refine("select.smooth", "Smooth…", "smooth", "Radius (px)", 4);
  def("select.colorRange", "Color Range…", (a) => a.setTool("color-range"), { enabled: hasDoc });

  def("select.toLayer", "Selection to New Layer", (a) => {
    const t = paintTarget(a, { create: false });
    const sel = layerSpaceMask(a, t || {});
    if (!t || !sel) return a.toast("Select an area on a pixel layer first.", "warning");
    const c = createCanvas(t.canvas.width, t.canvas.height);
    const ctx = ctx2d(c);
    ctx.drawImage(t.canvas, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(sel, 0, 0);
    const layer = newPixelLayer(a, { name: "Selection", w: c.width, h: c.height, above: t.owner });
    a.doc.pixels.set(layer.id, c);
    layer.m = t.node.m.slice();
    a.doc.touch(layer);
  }, { enabled: hasMask });

  def("select.toMask", "Selection to Layer Mask", (a) => {
    const n = a.activeNode;
    if (!n) return;
    if (n.mask) removeLayerMask(a, n);
    addLayerMask(a, n, "selection");
  }, { enabled: (a) => hasMask(a) && !!a.activeNode });

  def("select.toPath", "Selection to Curves", (a) => {
    const m = getMask(a);
    const contours = m.toContours({ simplify: 0.8 });
    const subs = contours.filter((c) => c.points.length >= 6).map((c) => {
      const pts = [];
      for (let i = 0; i < c.points.length; i += 2) pts.push([c.points[i], c.points[i + 1]]);
      return fitSubpath(pts, { closed: true, tolerance: 0.9, cornerAngle: 40 });
    });
    if (!subs.length) return;
    const node = createNode("path", { name: "Selection", path: { subpaths: subs }, rule: "evenodd", fill: a.style.fill ? clone(a.style.fill) : solid("#7c6df2"), stroke: null });
    addNodes(a, node, { label: "Selection to Curves" });
  }, { enabled: hasMask });

  def("pixel.clearSelection", "Clear Selected Pixels", (a) => {
    const t = paintTarget(a, { create: false });
    if (!t || t.locked) return;
    const sel = layerSpaceMask(a, t);
    if (!sel) return;
    const W = t.canvas.width;
    const H = t.canvas.height;
    const before = t.ctx.getImageData(0, 0, W, H);
    t.ctx.save();
    t.ctx.globalCompositeOperation = "destination-out";
    t.ctx.drawImage(sel, 0, 0);
    t.ctx.restore();
    commitPixelEdit(a, t, { x: 0, y: 0, before, after: t.ctx.getImageData(0, 0, W, H) }, "Clear Selection");
    a.doc.touch(t.node);
    a.requestRender();
  }, { enabled: hasMask });

  const fillSel = (which) => (a) => {
    const t = paintTarget(a);
    if (!t || t.locked) return;
    const W = t.canvas.width;
    const H = t.canvas.height;
    const sel = layerSpaceMask(a, t);
    const before = t.ctx.getImageData(0, 0, W, H);
    if (sel) {
      const tmp = createCanvas(W, H);
      const x = ctx2d(tmp);
      x.fillStyle = a.style[which];
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = "destination-in";
      x.drawImage(sel, 0, 0);
      t.ctx.drawImage(tmp, 0, 0);
    } else {
      t.ctx.fillStyle = a.style[which];
      t.ctx.fillRect(0, 0, W, H);
    }
    commitPixelEdit(a, t, { x: 0, y: 0, before, after: t.ctx.getImageData(0, 0, W, H) }, "Fill");
    a.doc.touch(t.node);
    a.requestRender();
  };
  def("pixel.fillForeground", "Fill with Foreground", fillSel("primary"), { shortcut: "Alt+Backspace", enabled: hasDoc });
  def("pixel.fillBackground", "Fill with Background", fillSel("secondary"), { shortcut: "Mod+Backspace", enabled: hasDoc });

  // ------------------------------------------------------------------ layers
  def("layer.newPixel", "New Pixel Layer", (a) => newPixelLayer(a), { shortcut: "Mod+Shift+N", enabled: hasDoc, icon: "plus-square-dotted" });
  def("layer.newGroup", "New Group", (a) => {
    const g = createNode("group", { name: "Group" });
    addNodes(a, g, { label: "New Group", index: a.activeNode && a.activeNode._parent === a.context ? a.context.children.indexOf(a.activeNode) + 1 : undefined });
  }, { enabled: hasDoc });
  def("layer.delete", "Delete Layer", (a) => a.run("edit.delete"), { enabled: hasDoc });
  def("layer.addMask", "Add Layer Mask", (a) => {
    const n = a.activeNode;
    if (!n) return a.toast("Select a layer first.", "warning");
    if (n.mask) {
      a.state.maskTarget = true;
      return a.emit("selection");
    }
    addLayerMask(a, n, hasMask(a) ? "selection" : "reveal");
  }, { enabled: (a) => !!a.activeNode, icon: "circle-half" });
  def("layer.deleteMask", "Delete Layer Mask", (a) => a.activeNode && removeLayerMask(a, a.activeNode), { enabled: (a) => !!a.activeNode?.mask });
  def("layer.editMask", "Edit Mask / Layer", (a) => {
    if (!a.activeNode?.mask) return;
    a.state.maskTarget = !a.state.maskTarget;
    a.emit("selection");
  }, { shortcut: "\\", enabled: (a) => !!a.activeNode?.mask, checked: (a) => !!a.state?.maskTarget });
  def("layer.applyMask", "Apply Layer Mask", (a) => {
    const n = a.activeNode;
    if (!n?.mask || n.type !== "pixel") return a.toast("Masks can be applied to pixel layers.", "warning");
    const doc = a.doc;
    const src = doc.getPixels(n);
    const out = createCanvas(src.width, src.height);
    const ctx = ctx2d(out);
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    const m = doc.getPixels(n.mask);
    ctx.setTransform(n.mask.m[0], n.mask.m[1], n.mask.m[2], n.mask.m[3], n.mask.m[4], n.mask.m[5]);
    ctx.drawImage(m, 0, 0);
    doc.tx("Apply Mask", () => {
      doc.replacePixels(n, out, {}, "Apply Mask");
      doc.setMask(n, null);
    });
    a.state.maskTarget = false;
    a.emit("selection");
  }, { enabled: (a) => a.activeNode?.type === "pixel" && !!a.activeNode.mask });
  def("layer.mergeDown", "Merge Down", (a) => mergeDown(a, a.activeNode), { shortcut: "Mod+E", enabled: (a) => !!a.activeNode && a.activeNode._parent?.children.indexOf(a.activeNode) > 0 });
  def("layer.rasterize", "Rasterize", (a) => {
    const nodes = topLevelSelection(a);
    if (!nodes.length) return;
    rasterizeToLayer(a, nodes, { name: nodes.length === 1 ? nodes[0].name : "Rasterized" });
  }, { enabled: (a) => topLevelSelection(a).some((n) => n.type !== "pixel") });
  def("layer.flatten", "Flatten Document", (a) => flattenPage(a), { enabled: hasDoc });

  // ------------------------------------------------------------------ adjustments, live filters, develop
  const group = (kind) => {
    const byCat = new Map();
    for (const e of listEffects().filter((x) => x.kind === kind)) {
      if (!byCat.has(e.category)) byCat.set(e.category, []);
      byCat.get(e.category).push(e);
    }
    return byCat;
  };
  const items = (kind) => {
    const cats = group(kind);
    if (cats.size <= 1) return [...cats.values()].flat().map((e) => ({ label: e.label, run: () => addEffectLayer(app, e.kind, e.id) }));
    return [...cats].map(([cat, list]) => ({ label: cat, items: list.map((e) => ({ label: e.label, run: () => addEffectLayer(app, e.kind, e.id) })) }));
  };
  app.menuProviders = app.menuProviders || {};
  app.menuProviders.adjustments = () => items("adjustment");
  app.menuProviders.livefilters = () => items("filter");
  app.menuProviders.filters = () => [
    ...items("filter"),
    { label: "Develop", items: listEffects().filter((e) => e.kind === "develop").map((e) => ({ label: e.label, run: () => addEffectLayer(app, e.kind, e.id) })) },
  ];

  def("layer.mergeEffects", "Apply Effects to Layer", (a) => {
    const n = a.activeNode;
    if (n?.type === "adjust") mergeDown(a, n);
  }, { enabled: (a) => a.activeNode?.type === "adjust" });

  // ------------------------------------------------------------------ document
  def("doc.addPage", "Add Page", (a) => {
    const p = a.doc.addPage({}, a.doc.pages.indexOf(a.page) + 1);
    a.setActivePage(p);
    a.cv?.fitPage(p);
  }, { enabled: hasDoc, icon: "file-earmark-plus" });
  def("doc.deletePage", "Delete Page", async (a) => {
    if (a.doc.pages.length < 2) return a.toast("A document needs at least one page.", "warning");
    if (!(await confirmDialog({ title: "Delete page", message: `Delete “${a.page.name}” and everything on it?`, ok: "Delete", danger: true }))) return;
    const page = a.page;
    const idx = a.doc.pages.indexOf(page);
    a.doc.removePage(page);
    a.setActivePage(a.doc.pages[Math.max(0, idx - 1)]);
  }, { enabled: (a) => !!a.doc && a.doc.pages.length > 1 });
  def("doc.addMaster", "Add Master Page", (a) => {
    const m = a.doc.addMaster(`Master ${String.fromCharCode(65 + a.doc.masters.length)}`);
    a.toast(`Added “${m.name}”. Assign it to pages in the Pages panel.`, "success");
  }, { enabled: hasDoc });

  const transformAll = (label, build) => (a) => {
    const doc = a.doc;
    const page = a.page;
    const M = build(page);
    doc.tx(label, () => {
      for (const n of page.root.children) doc.set(n, { m: mul(M.m, n.m) });
      if (M.size) doc.set(page, { w: M.size[0], h: M.size[1] });
    });
    a.cv?.fitPage();
  };
  def("doc.flipH", "Flip Document Horizontally", transformAll("Flip Document", (p) => ({ m: [-1, 0, 0, 1, p.w, 0] })), { enabled: hasDoc });
  def("doc.flipV", "Flip Document Vertically", transformAll("Flip Document", (p) => ({ m: [1, 0, 0, -1, 0, p.h] })), { enabled: hasDoc });
  def("doc.rotate90", "Rotate Document 90° Clockwise", transformAll("Rotate Document", (p) => ({ m: [0, 1, -1, 0, p.h, 0], size: [p.h, p.w] })), { enabled: hasDoc });

  def("doc.cropToContent", "Crop to Content", (a) => {
    const nodes = a.page.root.children.filter((n) => n.visible);
    const b = pageVisualBounds(nodes);
    if (!b) return a.toast("There is no content to crop to.", "warning");
    cropPage(a, b, { deletePixels: false });
  }, { enabled: hasDoc });

  def("doc.resize", "Resize Document…", async (a) => {
    const p = a.page;
    const st = { w: p.w, h: p.h, lock: true, resample: "scale", dpi: a.doc.dpi };
    const fw = numField({ label: "Width", value: st.w, min: 1, max: 32000, precision: 0, unit: "px", wide: true, onChange: (v) => {
      if (st.lock) st.h = Math.round((v / st.w) * st.h);
      st.w = Math.round(v);
      fh.set(st.h);
    } });
    const fh = numField({ label: "Height", value: st.h, min: 1, max: 32000, precision: 0, unit: "px", wide: true, onChange: (v) => {
      if (st.lock) st.w = Math.round((v / st.h) * st.w);
      st.h = Math.round(v);
      fw.set(st.w);
    } });
    const lock = switchField({ label: "Keep aspect ratio", value: true, onChange: (v) => (st.lock = v) });
    const rs = selectField({ label: "Resample", value: st.resample, onChange: (v) => (st.resample = v), options: [{ value: "scale", label: "Scale layers (keep vectors sharp)" }, { value: "lanczos3", label: "Lanczos (best quality)" }, { value: "bicubic", label: "Bicubic" }, { value: "bilinear", label: "Bilinear" }, { value: "nearest", label: "Nearest neighbor (pixel art)" }] });
    const dp = numField({ label: "Resolution", value: st.dpi, min: 1, max: 2400, precision: 0, unit: "dpi", wide: true, onChange: (v) => (st.dpi = Math.round(v)) });
    openDialog({
      title: "Resize Document",
      body: h("div.of-form", h("div.of-row", fw.el, fh.el), lock.el, rs.el, dp.el, h("p.of-hint", "Scaling keeps vector objects sharp. A resample filter also converts the pixel layers to the new pixel size; the resolution only changes the document metadata.")),
      width: 420,
      buttons: [
        { label: "Cancel", onClick: (c) => c() },
        {
          label: "Resize",
          variant: "primary",
          onClick: async (close) => {
            const m = await import("../core/image-ops.js");
            const r = m.resizeDocument(a, st.w, st.h, { resample: st.resample, dpi: st.dpi });
            if (r !== true) a.toast(r, "warning");
            close();
          },
        },
      ],
    });
  }, { enabled: hasDoc });

  def("doc.canvasSize", "Canvas Size…", (a) => {
    const p = a.page;
    const st = { w: p.w, h: p.h, ax: 0.5, ay: 0.5 };
    const fw = numField({ label: "Width", value: st.w, min: 1, max: 32000, precision: 0, unit: "px", wide: true, onChange: (v) => (st.w = Math.round(v)) });
    const fh = numField({ label: "Height", value: st.h, min: 1, max: 32000, precision: 0, unit: "px", wide: true, onChange: (v) => (st.h = Math.round(v)) });
    const anchors = h("div.of-anchor");
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const b = h("button.of-anchor__cell", { type: "button", "aria-pressed": String(x === 1 && y === 1), "aria-label": `Anchor ${["top", "middle", "bottom"][y]} ${["left", "center", "right"][x]}` });
      b.addEventListener("click", () => {
        st.ax = x / 2;
        st.ay = y / 2;
        anchors.querySelectorAll("button").forEach((o) => o.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
      });
      anchors.append(b);
    }
    openDialog({
      title: "Canvas Size",
      body: h("div.of-form", h("div.of-row", fw.el, fh.el), h("div.of-row", h("span.of-slider__label", "Anchor"), anchors)),
      width: 420,
      buttons: [
        { label: "Cancel", onClick: (c) => c() },
        {
          label: "Apply",
          variant: "primary",
          onClick: (close) => {
            const dx = (st.w - p.w) * st.ax;
            const dy = (st.h - p.h) * st.ay;
            a.doc.tx("Canvas Size", () => {
              for (const n of p.root.children) a.doc.set(n, { m: mul(translate(dx, dy), n.m) });
              a.doc.set(p, { w: st.w, h: st.h });
            });
            a.state.pixelMask = null;
            a.cv?.fitPage();
            close();
          },
        },
      ],
    });
  }, { enabled: hasDoc });

  // ------------------------------------------------------------------ image trace
  def("shape.trace", "Trace Image to Vector…", (a) => traceDialog(a), { enabled: (a) => a.selection.some((n) => n.type === "pixel" || n.type === "image") });
}

function traceDialog(app) {
  const target = app.selection.find((n) => n.type === "pixel" || n.type === "image");
  if (!target) return;
  const st = { mode: "color", colors: 8, speckle: 6, smoothing: 1 };
  const mode = selectField({ label: "Mode", value: st.mode, options: [{ value: "color", label: "Color" }, { value: "mono", label: "Black & white" }], onChange: (v) => (st.mode = v) });
  const colors = numField({ label: "Colors", value: st.colors, min: 2, max: 32, precision: 0, wide: true, onChange: (v) => (st.colors = Math.round(v)) });
  const speckle = numField({ label: "Speckle", value: st.speckle, min: 0, max: 200, precision: 0, unit: "px²", wide: true, onChange: (v) => (st.speckle = v) });
  const smooth = numField({ label: "Smoothing", value: st.smoothing, min: 0, max: 5, step: 0.5, precision: 1, wide: true, onChange: (v) => (st.smoothing = v) });
  openDialog({
    title: "Trace Image",
    body: h("div.of-form", mode.el, colors.el, speckle.el, smooth.el, h("p.of-hint", "Converts the selected raster into editable vector shapes. Fewer colors give simpler results.")),
    width: 420,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Trace",
        variant: "primary",
        onClick: (close) => {
          close();
          setTimeout(() => runTrace(app, target, st), 30);
        },
      },
    ],
  });
}

function runTrace(app, target, st) {
  const res = rasterizeNodes(app, [target], { clip: false });
  if (!res) return;
  const { canvas, rect } = res;
  const maxSide = 900;
  const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  let img = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
  if (k < 1) img = resizeImage(img, Math.round(canvas.width * k), Math.round(canvas.height * k), { filter: "box" });
  app.status("Tracing…");
  const tr = traceImage(img, { mode: st.mode, colors: st.colors, speckle: st.speckle, smoothing: st.smoothing });
  const sx = rect.w / img.width;
  const sy = rect.h / img.height;
  const group = createNode("group", { name: `${target.name} (traced)` });
  for (const layer of tr.layers) {
    const subs = [];
    for (const c of layer.contours) {
      if (c.points.length < 6) continue;
      const pts = [];
      for (let i = 0; i < c.points.length; i += 2) pts.push([rect.x + c.points[i] * sx, rect.y + c.points[i + 1] * sy]);
      subs.push(fitSubpath(pts, { closed: true, tolerance: 0.6 * Math.max(sx, sy) + 0.4, cornerAngle: 50 }));
    }
    if (!subs.length) continue;
    group.children.push(createNode("path", { name: layer.color, path: { subpaths: subs }, rule: "evenodd", fill: solid(layer.color), stroke: null }));
  }
  app.status("");
  if (!group.children.length) return app.toast("Nothing to trace.", "warning");
  addNodes(app, group, { label: "Trace Image" });
  app.toast(`Traced into ${group.children.length} shapes.`, "success");
}

export { getEffect, localBounds, worldMatrix, rotate, apply, ident, maskCanvas };
