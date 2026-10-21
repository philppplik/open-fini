// Color panel: picker + document swatches. Targets fill/stroke (vector, layout) or foreground/background (pixel).
import { h, empty, frameScheduler, clone } from "../../core/util.js";
import { toHex6, colorAlpha, cssColor, rgbToHex } from "../../core/color.js";
import { solid, defaultStroke, hasFillStroke } from "../../core/nodes.js";
import { segmented, iconButton } from "../controls.js";

export function createColorPanel(app) {
  let target = "fill"; // fill | stroke (vector) ; primary | secondary (pixel)
  const picker = h("sl-color-picker", { inline: true, opacity: true, format: "hex", size: "large", "no-format-toggle": false, class: "of-picker" });
  const swatchBox = h("div.of-swatches");
  const seg = h("div.of-row");
  const el = h("div.of-panel.of-colorpanel", seg, picker, h("div.of-swatches__bar", h("span.of-slider__label", "Swatches"), iconButton({ icon: "plus-lg", label: "Add current color to swatches", onClick: addSwatch })), swatchBox);
  let segCtl = null;
  let silent = false;

  const pixelMode = () => app.studio === "pixel";

  function buildSeg() {
    empty(seg);
    const opts = pixelMode()
      ? [{ value: "primary", label: "Foreground", text: "FG" }, { value: "secondary", label: "Background", text: "BG" }]
      : [{ value: "fill", label: "Fill", text: "Fill" }, { value: "stroke", label: "Stroke", text: "Stroke" }];
    if (pixelMode() && !["primary", "secondary"].includes(target)) target = "primary";
    if (!pixelMode() && !["fill", "stroke"].includes(target)) target = "fill";
    segCtl = segmented(opts, target, (v) => {
      target = v;
      syncPicker();
    });
    seg.append(segCtl.el);
  }

  function currentColor() {
    if (pixelMode()) return app.style[target];
    const n = app.selection.filter(hasFillStroke).pop();
    const src = n ? (target === "fill" ? n.fill : n.stroke?.fill) : target === "fill" ? app.style.fill : app.style.stroke?.fill;
    if (!src) return "#00000000";
    if (src.type === "solid") return toHex6(src.color) + (src.alpha < 1 ? Math.round(src.alpha * 255).toString(16).padStart(2, "0") : "");
    return src.stops?.[0]?.color || "#000000";
  }

  function syncPicker() {
    silent = true;
    const c = currentColor();
    if (picker.value !== c) picker.value = c;
    setTimeout(() => (silent = false), 0);
  }

  function apply(color, final) {
    if (silent) return;
    if (pixelMode()) {
      app.style[target] = toHex6(color);
      app.emit("colors");
      return;
    }
    const f = solid(toHex6(color), colorAlpha(color));
    const nodes = app.selection.filter(hasFillStroke);
    if (!nodes.length) {
      if (target === "fill") app.style.fill = f;
      else app.style.stroke = { ...(app.style.stroke || defaultStroke("#000000", 1)), fill: f };
      app.emit("colors");
      return;
    }
    app.doc.tx(
      "Color",
      () =>
        nodes.forEach((n) => {
          if (target === "fill") app.doc.set(n, { fill: clone(f) });
          else app.doc.set(n, { stroke: { ...(n.stroke || defaultStroke("#000000", 1)), fill: clone(f) } });
        }),
      { coalesce: final ? undefined : "color" },
    );
  }

  picker.addEventListener("sl-input", () => apply(picker.value, false));
  picker.addEventListener("sl-change", () => apply(picker.value, true));

  function addSwatch() {
    const c = toHex6(picker.value);
    if (app.doc.swatches.some((s) => s.color === c)) return;
    app.doc.arrayInsert(app.doc.swatches, { id: `sw${Date.now()}`, name: c, color: c }, app.doc.swatches.length, "Add Swatch");
    renderSwatches();
  }

  function renderSwatches() {
    empty(swatchBox);
    const doc = app.doc;
    if (!doc) return;
    for (const s of doc.swatches) {
      const b = h("button.of-swatch", { type: "button", style: { background: cssColor(s.color) }, title: `${s.name}\nClick: ${pixelMode() ? "foreground" : "fill"} · Shift-click: ${pixelMode() ? "background" : "stroke"} · Right-click: delete`, "aria-label": s.name });
      b.addEventListener("click", (e) => {
        const prev = target;
        target = pixelMode() ? (e.shiftKey ? "secondary" : "primary") : e.shiftKey ? "stroke" : "fill";
        apply(s.color, true);
        target = prev;
        syncPicker();
      });
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        doc.arrayRemove(doc.swatches, s, "Delete Swatch");
        renderSwatches();
      });
      swatchBox.append(b);
    }
  }

  const sched = frameScheduler(() => {
    syncPicker();
  });
  app.on("studio", () => {
    buildSeg();
    syncPicker();
  });
  for (const ev of ["selection", "docchange", "colors", "doc"]) app.on(ev, sched);
  app.on("doc", renderSwatches);
  app.on("swatches", renderSwatches);
  buildSeg();
  renderSwatches();
  setTimeout(syncPicker, 0);
  return { el, show: () => { buildSeg(); renderSwatches(); syncPicker(); } };
}

export { rgbToHex };
