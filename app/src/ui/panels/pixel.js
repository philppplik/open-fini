// Pixel-studio panels: Brush and Adjustments (adjustment / live filter / develop layers). The Histogram and Info panels live in ui/histogram/.
import { h, empty, clone, frameScheduler, debounce } from "../../core/util.js";
import { listEffects, getEffect, autoLevels, autoContrast, autoColor } from "../../engine/pixel/index.js";
import { addEffectLayer, mergeDown } from "../../core/raster.js";
import { addLayerMask } from "../../core/pixel.js";
import { buildControls, button, section, sliderField, switchField, iconButton } from "../controls.js";
import { StrokeEngine } from "../../engine/brush.js";
import { createCanvas, ctx2d } from "../../core/doc.js";
import { buildPageDL } from "../../engine/dl.js";
import { renderToCanvas } from "../../engine/backends/canvas.js";

// ------------------------------------------------------------------ brush

const PRESETS = [
  { name: "Hard Round", size: 24, hardness: 1, opacity: 1, flow: 1, spacing: 0.08, smoothing: 0.2 },
  { name: "Soft Round", size: 60, hardness: 0.25, opacity: 1, flow: 1, spacing: 0.1, smoothing: 0.3 },
  { name: "Airbrush", size: 90, hardness: 0, opacity: 1, flow: 0.18, spacing: 0.05, smoothing: 0.35 },
  { name: "Marker", size: 30, hardness: 0.85, opacity: 0.7, flow: 1, spacing: 0.06, smoothing: 0.4 },
  { name: "Fine Liner", size: 4, hardness: 1, opacity: 1, flow: 1, spacing: 0.05, smoothing: 0.5 },
];

export function createBrushPanel(app) {
  const b = app.brush;
  const preview = h("canvas.of-brushpreview", { width: 560, height: 120 });
  const fields = {};
  const set = (key, v) => {
    b[key] = v;
    drawPreview();
    app.emit("brush");
  };
  const mk = (key, label, min, max, step, scale = 1, unit = "") => {
    const f = sliderField({ label, value: b[key], min, max, step, scale, unit, onInput: (v) => set(key, v), onChange: (v) => set(key, v) });
    fields[key] = f;
    return f.el;
  };
  const presets = h("div.of-presetrow", PRESETS.map((p) => {
    const btn = h("button.of-chipbtn2", { type: "button", title: `${p.name} — size ${p.size}px` }, p.name);
    btn.addEventListener("click", () => {
      Object.assign(b, { size: p.size, hardness: p.hardness, opacity: p.opacity, flow: p.flow, spacing: p.spacing, smoothing: p.smoothing });
      for (const k of Object.keys(fields)) fields[k].set(b[k]);
      drawPreview();
      app.emit("brush");
    });
    return btn;
  }));
  const press = switchField({ label: "Pressure controls size", value: b.pressureSize, onChange: (v) => (b.pressureSize = v) });
  const pressO = switchField({ label: "Pressure controls flow", value: b.pressureOpacity, onChange: (v) => (b.pressureOpacity = v) });
  const el = h(
    "div.of-panel",
    section("Brush", h("div.of-form", presets, preview, mk("size", "Size", 1, 800, 1, 1, "px"), mk("hardness", "Hardness", 0, 1, 0.01, 100, "%"), mk("opacity", "Opacity", 0.01, 1, 0.01, 100, "%"), mk("flow", "Flow", 0.01, 1, 0.01, 100, "%"), mk("spacing", "Spacing", 0.02, 1, 0.01, 100, "%"), mk("smoothing", "Stabilizer", 0, 0.9, 0.01, 100, "%"))),
    section("Pen & touch", h("div.of-form", press.el, pressO.el)),
  );

  function drawPreview() {
    const W = preview.width;
    const H = preview.height;
    const c = createCanvas(W, H);
    const k = Math.min(1, 44 / Math.max(1, b.size));
    const eng = new StrokeEngine(c, { size: Math.max(2, b.size * k), hardness: b.hardness, opacity: b.opacity, flow: b.flow, spacing: b.spacing, color: app.style.primary, pressureSize: true });
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      pts.push([30 + t * (W - 60), H / 2 + Math.sin(t * Math.PI * 2) * (H * 0.28), Math.sin(t * Math.PI) * 0.9 + 0.1]);
    }
    eng.begin(...pts[0]);
    for (const p of pts.slice(1)) eng.move(...p);
    eng.end();
    const ctx = preview.getContext("2d");
    ctx.fillStyle = "#d9dae0";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(c, 0, 0);
  }
  for (const ev of ["colors", "brush"]) app.on(ev, debounce(drawPreview, 60));
  requestAnimationFrame(drawPreview);
  return { el, show: drawPreview };
}

// ------------------------------------------------------------------ adjustments

export function createAdjustmentsPanel(app) {
  const el = h("div.of-panel.of-adjust");
  let sig = "";
  let cur = null; // the controls currently shown for the active adjustment layer

  const chip = (e) => {
    const b = h("button.of-chipbtn2", { type: "button", title: `Add ${e.label}` }, e.label);
    b.addEventListener("click", () => addEffectLayer(app, e.kind, e.id, { nested: !!app.nestAdjust }));
    return b;
  };
  const byKind = (kind) => listEffects().filter((e) => e.kind === kind);

  function autoButtons() {
    const run = (fn, name) => () => {
      const img = compositeImage(app, 512);
      if (!img) return;
      const node = addEffectLayer(app, "adjustment", "levels", { nested: !!app.nestAdjust });
      if (node) {
        node.params = { ...node.params, ...fn(img) };
        node.name = name;
        app.doc.touch(node);
        app.requestRender();
        app.emit("docchange", {});
      }
    };
    return h("div.of-presetrow", button("Auto Levels", run(autoLevels, "Auto Levels")), button("Auto Contrast", run(autoContrast, "Auto Contrast")), button("Auto Color", run(autoColor, "Auto Color")));
  }

  function build() {
    empty(el);
    if (!app.doc) return el.append(h("div.of-empty", "Open a document to add adjustments."));
    const nest = switchField({ label: "Apply to the selected layer only", value: !!app.nestAdjust, onChange: (v) => (app.nestAdjust = v) });
    const node = app.activeNode?.type === "adjust" ? app.activeNode : null;
    if (node) el.append(effectControls(node));
    const cats = new Map();
    for (const e of byKind("adjustment")) (cats.get(e.category) || cats.set(e.category, []).get(e.category)).push(e);
    el.append(
      section("Add adjustment", h("div.of-form", autoButtons(), nest.el, ...[...cats].map(([c, list]) => h("div", h("div.of-form__group", c), h("div.of-presetrow", list.map(chip)))))),
      section("Live filters", h("div.of-presetrow", byKind("filter").map(chip)), { open: false }),
      section("Develop", h("div.of-presetrow", byKind("develop").map(chip)), { open: false }),
    );
  }

  function effectControls(node) {
    const eff = getEffect(node.effect.group, node.effect.id);
    if (!eff) return h("div.of-hint", "This effect is not available.");
    const doc = app.doc;
    const params = { ...eff.defaults, ...node.params };
    const set = (patch, final) => doc.tx(`Edit ${eff.label}`, () => doc.set(node, { params: { ...node.params, ...patch } }), { coalesce: final ? undefined : `adj:${node.id}` });
    const form = buildControls(eff.controls, params, {
      onInput: (k, v) => set({ [k]: v }, false),
      onChange: (k, v) => set({ [k]: v }, true),
    });
    const custom = eff.id === "levels" || eff.id === "curves";
    if (custom) form.classList.add("hidden"); // replaced by the interactive widget as soon as it has loaded
    const slot = h("div.of-adj__widget");
    const strength = sliderField({ label: "Opacity", value: Math.round(node.opacity * 100), min: 0, max: 100, step: 1, unit: "%", onInput: (v) => doc.tx("Opacity", () => doc.set(node, { opacity: v / 100 }), { coalesce: `adjo:${node.id}` }), onChange: (v) => doc.set(node, { opacity: v / 100 }, "Opacity") });
    const on = switchField({ label: "Enabled", value: node.visible, onChange: (v) => doc.set(node, { visible: v }, v ? "Show" : "Hide") });
    const reset = button("Reset", () => doc.set(node, { params: clone(eff.defaults) }, "Reset Effect"), { title: "Restore the default values" });
    const apply = button("Apply to layer", () => mergeDown(app, node), { title: "Bake this effect into the layer below" });
    const mask = iconButton({ icon: "circle-half", label: "Add mask to this effect", onClick: () => addLayerMask(app, node, app.state.pixelMask ? "selection" : "reveal") });
    // hold to compare with the effect switched off (not an undo step)
    const cmp = button("Hold to compare", null, { title: "Press and hold to see the image without this effect" });
    const restore = () => {
      if (!node.visible && cmp._hidden) {
        node.visible = true;
        cmp._hidden = false;
        doc.touch(node);
        app.requestRender();
      }
    };
    cmp.addEventListener("pointerdown", (e) => {
      if (!node.visible) return;
      cmp.setPointerCapture?.(e.pointerId);
      cmp._hidden = true;
      node.visible = false;
      doc.touch(node);
      app.requestRender();
    });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) cmp.addEventListener(ev, restore);
    cur = { node, eff, form, strength, on, widget: null };
    import("../histogram/widgets.js")
      .then((m) => {
        if (cur?.node !== node) return;
        const w = m.createAdjustWidget(app, node, eff, { params, set });
        if (!w) return form.classList.remove("hidden");
        cur.widget = w;
        slot.append(w.el);
        form.classList.toggle("hidden", !!w.replacesControls);
      })
      .catch(() => form.classList.remove("hidden"));
    return section(eff.label, h("div.of-form", h("div.of-row", on.el, h("span.grow"), cmp, mask), strength.el, slot, form, h("div.of-row", reset, apply)), { open: true });
  }

  const s = frameScheduler(() => {
    const n = app.activeNode?.type === "adjust" ? app.activeNode : null;
    const k = `${app.doc?.id}|${n?.id}|${n?.effect?.id}|${app.studio}`;
    if (k === sig) return;
    sig = k;
    build();
  });
  for (const ev of ["selection", "doc", "studio"]) app.on(ev, s);
  // keep the controls in sync with undo / redo, Reset and edits made elsewhere
  app.on("docchange", () => {
    if (!cur || !app.doc || app.doc.find(cur.node.id) !== cur.node) return;
    const p = { ...cur.eff.defaults, ...cur.node.params };
    cur.form.update(p);
    cur.widget?.update(p);
    cur.on.set(cur.node.visible);
    cur.strength.set(Math.round(cur.node.opacity * 100));
  });
  build();
  return { el, show: () => { sig = ""; build(); } };
}

/** Composite of the page (or active layer) scaled to ~`max` px for analysis. */
function compositeImage(app, max = 512) {
  const page = app.page;
  if (!page) return null;
  const s = Math.min(1, max / Math.max(page.w, page.h));
  const w = Math.max(1, Math.round(page.w * s));
  const hh = Math.max(1, Math.round(page.h * s));
  const c = renderToCanvas(buildPageDL(app.doc, page), { scale: s, width: w, height: hh, bg: page.bg });
  return ctx2d(c).getImageData(0, 0, w, hh);
}
