// Office Toolkit: shared UI building blocks for Office apps (Document, Spreadsheet, Presentation, Whiteboard). Plain
// DOM + Shoelace, styled by app/styles/office-suite.css with the --of-* theme tokens; every control is keyboard
// reachable, labelled for screen readers and translated with t(). Reference with examples: docs/office-suite.md ▸
// Toolkit. Pure helpers live next to this file (selection, virtual, find, clipboard, numfmt, rough).
//
// Public API (each returns an element or { el, ...methods })
//   button({ icon, label, onClick, shortcut?, toggle?, pressed? })      icon button, aria-pressed for toggles
//   ribbon(groups)  groups: [{ id, label, items: Element[] }]           toolbar with groups; groups that do not fit
//                   move into a "More" dropdown (ResizeObserver); arrow keys move focus between controls
//   formulaBar({ onCommit, onRefCommit, refLabel? }) → { el, setRef, setValue, focus }
//   colorPicker({ label, value, onPick, allowNone? }) → { el, set }      palette + custom color
//   fontControls({ onFamily, onSize }) → { el, set({ family, size }) }
//   numberFormatMenu({ onPick }) → element                               presets of toolkit/numfmt.js
//   zoomControl({ value, onChange, min?, max? }) → { el, set }
//   splitPanels({ a, b, dir?: "h"|"v", size?: 280, min?: 120, onResize? }) → { el, setSize }
//   ruler({ length, scale?, unit?: "cm"|"in"|"px" }) → { el, draw(length, scale, offset) }
//   virtualGrid({ rows: Axis, cols: Axis, renderCell(r, c) → Node|string, header? }) → { el, refresh, scrollTo }
//   dragGesture(el, { onStart, onMove, onEnd })  pointer capture, returns off()
//   officeContextMenu(app, event, kind, data)  kind "office-<app kind>" for the context-menu framework
//   dialogs: openDialog, confirmDialog, promptDialog (re-exported from ui/dialogs.js)
// Invariants: components never touch the document model; they call the callbacks they were given. Long-lived
// observers are disconnected by `el.destroy?.()` (call it from your app's destroy()).
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { openContextMenu } from "../../ui/context-menu/index.js";
import { NUMBER_FORMATS } from "./numfmt.js";
export { openDialog, confirmDialog, promptDialog } from "../../ui/dialogs.js";

export function button({ icon, label, onClick, shortcut, toggle = false, pressed = false, text = null }) {
  const b = h("button.of-tk-btn", { type: "button", "aria-label": t(label), "data-tip": t(label), "data-shortcut": shortcut || null }, icon ? h("sl-icon", { name: icon, "aria-hidden": "true" }) : null, text);
  if (toggle) b.setAttribute("aria-pressed", String(!!pressed));
  b.addEventListener("click", (e) => onClick?.(e, b));
  return b;
}

export function ribbon(groups) {
  const el = h("div.of-tk-ribbon", { role: "toolbar", "aria-label": t("Toolbar") });
  const parts = groups.map((g) => h("div.of-tk-ribbon__group", { role: "group", "aria-label": t(g.label), "data-group": g.id }, ...g.items));
  const panel = h("div.of-tk-ribbon__overflow", { style: { display: "flex", flexWrap: "wrap", gap: "4px", padding: "6px", maxWidth: "420px" } });
  const more = h("sl-dropdown.of-tk-ribbon__more", { hoist: true, placement: "bottom-end" }, h("button.of-tk-btn", { slot: "trigger", type: "button", "aria-label": t("More tools") }, h("sl-icon", { name: "three-dots" })), h("div", { style: { background: "var(--of-bg-panel)", border: "1px solid var(--of-border)", borderRadius: "6px" } }, panel));
  el.append(...parts, more);
  const fit = () => {
    for (const p of parts) if (p.parentElement !== el) el.insertBefore(p, more);
    more.hidden = true;
    let i = parts.length;
    while (i > 1 && el.scrollWidth > el.clientWidth + 1) {
      more.hidden = false;
      panel.prepend(parts[--i]);
    }
  };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => fit()) : null;
  ro?.observe(el);
  el.destroy = () => ro?.disconnect();
  // roving focus with arrow keys
  el.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const items = [...el.querySelectorAll("button, select, input")].filter((x) => x.offsetParent !== null && !x.disabled);
    const i = items.indexOf(document.activeElement);
    if (i < 0 || (e.target.tagName === "INPUT" && e.target.type !== "color")) return;
    e.preventDefault();
    items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length]?.focus();
  });
  queueMicrotask(fit);
  return el;
}

export function formulaBar({ onCommit, onRefCommit, refLabel = "Cell reference" } = {}) {
  const ref = h("input.of-tk-input.of-tk-formula__ref", { "aria-label": t(refLabel), spellcheck: "false" });
  const input = h("input.of-tk-input.of-tk-formula__input", { "aria-label": t("Formula or value"), spellcheck: "false" });
  const el = h("div.of-tk-formula", ref, h("span.of-tk-formula__fx", { "aria-hidden": "true" }, "fx"), input);
  let original = "";
  input.addEventListener("focus", () => (original = input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (e.preventDefault(), onCommit?.(input.value, { move: e.shiftKey ? "up" : "down" }));
    else if (e.key === "Tab") (e.preventDefault(), onCommit?.(input.value, { move: e.shiftKey ? "left" : "right" }));
    else if (e.key === "Escape") input.value = original;
  });
  ref.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), onRefCommit?.(ref.value.trim())));
  return { el, setRef: (s) => (ref.value = s), setValue: (s) => (input.value = s ?? ""), focus: () => input.focus(), input };
}

const PALETTE = ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff", "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff", "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc", "#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"];

export function colorPicker({ label = "Color", value = "#000000", onPick, allowNone = false } = {}) {
  const bar = h("span", { style: { display: "block", height: "3px", marginTop: "1px", background: value || "transparent" } });
  const trigger = h("button.of-tk-btn", { slot: "trigger", type: "button", "aria-label": t(label), "data-tip": t(label) }, h("span", { style: { display: "grid" } }, h("sl-icon", { name: "palette", "aria-hidden": "true" }), bar));
  const grid = h("div.of-tk-swatches", { role: "radiogroup", "aria-label": t(label) });
  const custom = h("input", { type: "color", value: value || "#000000", "aria-label": t("Custom color") });
  const panel = h("div", { style: { background: "var(--of-bg-panel)", border: "1px solid var(--of-border)", borderRadius: "6px", padding: "4px" } }, grid, h("label", { style: { display: "flex", gap: "6px", alignItems: "center", padding: "4px 6px", fontSize: "12px" } }, custom, t("Custom…")));
  const dd = h("sl-dropdown", { hoist: true }, trigger, panel);
  const set = (v) => {
    value = v;
    bar.style.background = v || "transparent";
    for (const s of grid.children) s.setAttribute("aria-checked", String(s.dataset.color === v));
  };
  const pick = (v) => {
    set(v);
    dd.hide?.();
    onPick?.(v);
  };
  grid.append(...(allowNone ? [null, ...PALETTE.slice(1)] : PALETTE).map((c) => {
    const s = h("button.of-tk-swatch", { type: "button", role: "radio", "aria-label": c || t("None"), "data-color": c || "", style: { background: c || "repeating-linear-gradient(45deg, #fff 0 4px, #e33 4px 5px)" } });
    s.addEventListener("click", () => pick(c));
    return s;
  }));
  custom.addEventListener("change", () => pick(custom.value));
  set(value);
  return { el: dd, set };
}

const FONTS = ["Calibri", "Arial", "Helvetica", "Verdana", "Segoe UI", "Inter", "Georgia", "Times New Roman", "Cambria", "Garamond", "Courier New", "Consolas", "Comic Sans MS"];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];
let listSeq = 0;

export function fontControls({ onFamily, onSize } = {}) {
  const id = `of-tk-fonts-${++listSeq}`;
  const fam = h("input.of-tk-input", { "aria-label": t("Font"), "data-tip": t("Font"), list: id, spellcheck: "false", style: { width: "128px" } });
  const size = h("input.of-tk-input", { "aria-label": t("Font size (points)"), "data-tip": t("Font size (points)"), list: `${id}-s`, inputmode: "decimal", style: { width: "52px" } });
  fam.addEventListener("change", () => fam.value.trim() && onFamily?.(fam.value.trim()));
  size.addEventListener("change", () => {
    const v = parseFloat(size.value);
    if (v > 0 && v < 1639) onSize?.(Math.round(v * 2) / 2);
  });
  const el = h("span", { style: { display: "inline-flex", gap: "4px" } }, fam, size, h("datalist", { id }, FONTS.map((f) => h("option", { value: f }))), h("datalist", { id: `${id}-s` }, SIZES.map((s) => h("option", { value: String(s) }))));
  return { el, set: ({ family, size: s } = {}) => ((fam.value = family ?? ""), (size.value = s == null ? "" : String(s))) };
}

export function numberFormatMenu({ onPick } = {}) {
  const menu = h("sl-menu", ...NUMBER_FORMATS.map((f) => h("sl-menu-item", { value: f.id }, t(f.label))));
  menu.addEventListener("sl-select", (e) => {
    const f = NUMBER_FORMATS.find((x) => x.id === e.detail.item.value);
    if (f) onPick?.(f.fmt, f.id);
  });
  return h("sl-dropdown", { hoist: true }, h("button.of-tk-btn", { slot: "trigger", type: "button", "aria-label": t("Number format"), "data-tip": t("Number format") }, h("span", "123"), h("sl-icon", { name: "chevron-down", "aria-hidden": "true" })), menu);
}

export function zoomControl({ value = 1, onChange, min = 0.1, max = 4 } = {}) {
  const out = h("span.of-tk-zoom__value", { "aria-live": "polite" });
  const set = (v) => {
    value = Math.max(min, Math.min(max, v));
    out.textContent = `${Math.round(value * 100)}%`;
  };
  const step = (f) => {
    set(Math.round(value * f * 20) / 20);
    onChange?.(value);
  };
  const el = h("span.of-tk-zoom", { role: "group", "aria-label": t("Zoom") }, button({ icon: "zoom-out", label: "Zoom out", onClick: () => step(1 / 1.25) }), out, button({ icon: "zoom-in", label: "Zoom in", onClick: () => step(1.25) }));
  set(value);
  return { el, set };
}

export function splitPanels({ a, b, dir = "h", size = 280, min = 120, onResize } = {}) {
  const pa = h("div.of-tk-split__pane", a);
  const pb = h("div.of-tk-split__pane", { style: { flex: "1" } }, b);
  const handle = h("div.of-tk-split__handle", { role: "separator", tabindex: "0", "aria-orientation": dir === "h" ? "vertical" : "horizontal", "aria-label": t("Resize panels") });
  const el = h("div.of-tk-split", { "data-dir": dir }, pa, handle, pb);
  const prop = dir === "h" ? "width" : "height";
  const setSize = (px) => {
    const total = dir === "h" ? el.clientWidth : el.clientHeight;
    size = Math.max(min, total ? Math.min(total - min, px) : px);
    pa.style[prop] = `${size}px`;
    pa.style.flex = "none";
    handle.setAttribute("aria-valuenow", String(Math.round(size)));
    onResize?.(size);
  };
  dragGesture(handle, {
    onStart: () => size,
    onMove: (d, start) => setSize(start + (dir === "h" ? d.dx : d.dy)),
  });
  handle.addEventListener("keydown", (e) => {
    const k = { ArrowLeft: -16, ArrowUp: -16, ArrowRight: 16, ArrowDown: 16 }[e.key];
    if (k) (e.preventDefault(), setSize(size + k));
  });
  setSize(size);
  return { el, setSize };
}

const UNIT_PX = { px: 1, in: 96, cm: 96 / 2.54 };
export function ruler({ length = 800, scale = 1, unit = "cm" } = {}) {
  const el = h("canvas.of-tk-ruler", { "aria-hidden": "true" });
  const draw = (len = length, sc = scale, offset = 0) => {
    length = len;
    scale = sc;
    const dpr = globalThis.devicePixelRatio || 1;
    const w = el.clientWidth || len;
    el.width = Math.round(w * dpr);
    el.height = Math.round(20 * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const color = getComputedStyle(el).color || "#888";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.font = "9px sans-serif";
    const step = (UNIT_PX[unit] || UNIT_PX.cm) * sc;
    const sub = unit === "in" ? 8 : 4;
    ctx.beginPath();
    for (let i = 0, x = -offset; x <= w; i++, x = -offset + (i / sub) * step) {
      if (x < 0) continue;
      const major = i % sub === 0;
      ctx.moveTo(Math.round(x) + 0.5, 20);
      ctx.lineTo(Math.round(x) + 0.5, major ? 8 : 15);
      if (major && i) ctx.fillText(String(i / sub), x + 2, 9);
    }
    ctx.stroke();
  };
  queueMicrotask(() => draw());
  return { el, draw };
}

/** Pointer drag with capture: onStart(e) → state passed back to onMove(delta, state, e) and onEnd(delta, state, e). */
export function dragGesture(el, { onStart, onMove, onEnd } = {}) {
  let start = null;
  let state;
  const down = (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    state = onStart?.(e);
    el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const move = (e) => start && e.pointerId === start.id && onMove?.({ dx: e.clientX - start.x, dy: e.clientY - start.y }, state, e);
  const up = (e) => {
    if (!start || e.pointerId !== start.id) return;
    onEnd?.({ dx: e.clientX - start.x, dy: e.clientY - start.y }, state, e);
    start = null;
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
  };
}

/**
 * A scrolling grid that only creates DOM for visible cells (toolkit/virtual.js axes). renderCell returns a node or
 * text; cells are absolutely positioned inside one layer. Re-render with refresh() after model changes.
 */
export function virtualGrid({ rows, cols, renderCell, overscan = 2, label = "Grid" }) {
  const sizer = h("div.of-tk-vgrid__sizer");
  const layer = h("div.of-tk-vgrid__layer", { role: "rowgroup" });
  const el = h("div.of-tk-vgrid", { role: "grid", "aria-label": t(label), "aria-rowcount": String(rows.count), "aria-colcount": String(cols.count), tabindex: "0" }, sizer, layer);
  let frame = 0;
  const paint = () => {
    frame = 0;
    sizer.style.width = `${cols.total}px`;
    sizer.style.height = `${rows.total}px`;
    const vr = rows.visible(el.scrollTop, el.clientHeight, overscan);
    const vc = cols.visible(el.scrollLeft, el.clientWidth, overscan);
    const frag = document.createDocumentFragment();
    for (let r = vr.start; r < vr.end; r++) {
      const row = h("div", { role: "row", "aria-rowindex": String(r + 1) });
      for (let c = vc.start; c < vc.end; c++) {
        const cell = h("div", { role: "gridcell", "aria-colindex": String(c + 1), "data-r": String(r), "data-c": String(c), style: { position: "absolute", left: `${cols.offsetOf(c)}px`, top: `${rows.offsetOf(r)}px`, width: `${cols.sizeOf(c)}px`, height: `${rows.sizeOf(r)}px` } });
        const v = renderCell(r, c);
        if (v != null) cell.append(v);
        row.append(cell);
      }
      frag.append(row);
    }
    layer.replaceChildren(frag);
  };
  const refresh = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };
  el.addEventListener("scroll", refresh, { passive: true });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(refresh) : null;
  ro?.observe(el);
  el.destroy = () => ro?.disconnect();
  refresh();
  return {
    el,
    refresh,
    scrollTo(r, c) {
      const top = rows.offsetOf(r);
      const left = cols.offsetOf(c);
      if (top < el.scrollTop || top + rows.sizeOf(r) > el.scrollTop + el.clientHeight) el.scrollTop = top - el.clientHeight / 3;
      if (left < el.scrollLeft || left + cols.sizeOf(c) > el.scrollLeft + el.clientWidth) el.scrollLeft = left - el.clientWidth / 3;
    },
  };
}

/** Opens the context menu framework for an Office surface: kind `office-<app kind>` (see docs/context-menus.md). */
export function officeContextMenu(app, event, kind, data = {}) {
  event?.preventDefault?.();
  return openContextMenu(app, { kind, x: event?.clientX ?? 0, y: event?.clientY ?? 0, event, target: event?.target, data });
}
