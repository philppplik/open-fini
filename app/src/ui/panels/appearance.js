// Appearance panel: fill, stroke, shape parameters and live effects of the selection.
import { h, empty, clone, frameScheduler } from "../../core/util.js";
import { solid, linearGradient, radialGradient, conicGradient, defaultStroke, hasFillStroke } from "../../core/nodes.js";
import { toHex6, colorAlpha, parseColor } from "../../core/color.js";
import { LAYER_FX, FX_ORDER, newFx } from "../../core/effects.js";
import { buildControls, colorField, gradientEditor, iconButton, numField, section, segmented, selectField, switchField } from "../controls.js";

const FILL_TYPES = [
  { value: "none", label: "None", icon: "slash-circle" },
  { value: "solid", label: "Solid", icon: "square-fill" },
  { value: "linear", label: "Linear gradient", icon: "of:grad-linear", lib: "of" },
  { value: "radial", label: "Radial gradient", icon: "of:grad-radial", lib: "of" },
  { value: "conic", label: "Conical gradient", icon: "of:grad-conic", lib: "of" },
];

const fixIcons = (opts) => opts.map((o) => ({ ...o, icon: o.icon.replace(/^of:/, "") }));

function fillTypeOf(f) {
  return f ? f.type : "none";
}

/** Creates a fill of `type`, carrying over the current color. */
function convertFill(cur, type, fallback = "#7c6df2") {
  const base = cur ? (cur.type === "solid" ? cur.color : cur.stops?.[0]?.color) || fallback : fallback;
  const hex = toHex6(base);
  switch (type) {
    case "none":
      return null;
    case "solid":
      return solid(hex, cur?.type === "solid" ? cur.alpha ?? 1 : 1);
    case "linear":
      return linearGradient(hex, "#ffffff");
    case "radial":
      return radialGradient(hex, "#ffffff");
    case "conic":
      return conicGradient(hex, "#ff3b6b");
    default:
      return cur;
  }
}

/** Fill/stroke-paint editor. */
function paintEditor({ label, get, set, allowNone = true }) {
  const types = fixIcons(FILL_TYPES.filter((t) => allowNone || t.value !== "none"));
  const body = h("div.of-paint__body");
  let current = get();
  let seg;
  let solidField;
  let grad;
  let angle;

  function rebuild() {
    empty(body);
    const f = current;
    const t = fillTypeOf(f);
    if (t === "solid") {
      solidField = colorField({
        value: f.alpha < 1 ? toHex6(f.color) : f.color,
        label: "Color",
        onInput: (c) => commit({ ...f, color: toHex6(c), alpha: colorAlpha(c) * 1 }, false),
        onChange: (c) => commit({ ...f, color: toHex6(c), alpha: colorAlpha(c) }, true),
      });
      solidField.set(withAlpha(f));
      body.append(h("div.of-row", solidField.el));
    } else if (t !== "none") {
      grad = gradientEditor({ fill: f, onInput: (g) => commit(g, false), onChange: (g) => commit(g, true) });
      body.append(grad.el);
      if (t === "linear") {
        const a = Math.round((Math.atan2(f.y1 - f.y0, f.x1 - f.x0) * 180) / Math.PI);
        angle = numField({
          label: "Angle", value: a, min: -360, max: 360, unit: "°", precision: 0,
          onInput: (v) => commit(withAngle(current, v), false), onChange: (v) => commit(withAngle(current, v), true),
        });
        body.append(h("div.of-row", angle.el));
      } else if (t === "conic") {
        angle = numField({
          label: "Angle", value: Math.round(((f.angle || 0) * 180) / Math.PI), min: -360, max: 360, unit: "°", precision: 0,
          onInput: (v) => commit({ ...current, angle: (v * Math.PI) / 180 }, false), onChange: (v) => commit({ ...current, angle: (v * Math.PI) / 180 }, true),
        });
        body.append(h("div.of-row", angle.el));
      }
    }
  }

  function commit(f, final) {
    current = f;
    set(f, final);
  }

  seg = segmented(types, fillTypeOf(current), (t) => {
    if (t === fillTypeOf(current)) return;
    commit(convertFill(current, t), true);
    rebuild();
  });
  const el = h("div.of-paint", h("div.of-row", label ? h("span.of-num__label", label) : null, seg.el), body);
  rebuild();
  return {
    el,
    update(f) {
      const changedType = fillTypeOf(f) !== fillTypeOf(current);
      current = f;
      seg.set(fillTypeOf(f));
      if (changedType) rebuild();
      else if (f?.type === "solid") solidField?.set(withAlpha(f));
      else if (f) grad?.set(f);
    },
  };
}

const withAlpha = (f) => {
  const c = parseColor(f.color);
  const a = Math.round(Math.min(1, c.a * (f.alpha ?? 1)) * 255);
  return toHex6(f.color) + (a < 255 ? a.toString(16).padStart(2, "0") : "");
};

function withAngle(f, deg) {
  const a = (deg * Math.PI) / 180;
  const c = [(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2];
  const half = Math.max(0.0001, Math.hypot(f.x1 - f.x0, f.y1 - f.y0) / 2) || 0.5;
  return { ...f, x0: c[0] - Math.cos(a) * half, y0: c[1] - Math.sin(a) * half, x1: c[0] + Math.cos(a) * half, y1: c[1] + Math.sin(a) * half };
}

export function createAppearancePanel(app) {
  const el = h("div.of-panel.of-appearance");
  let sig = "";
  let live = {}; // widgets updated in place

  const targets = () => app.selection.filter(hasFillStroke);

  function editNodes(label, fn, coalesce) {
    const doc = app.doc;
    const nodes = targets();
    if (!nodes.length) {
      return;
    }
    doc.tx(label, () => nodes.forEach((n) => doc.set(n, fn(n))), { coalesce });
  }

  function build() {
    empty(el);
    live = {};
    const doc = app.doc;
    if (!doc) return el.append(h("div.of-empty", "Open a document to edit appearance."));
    const nodes = targets();
    const n = nodes[nodes.length - 1] || null;
    const forDefault = !app.selection.length;
    if (!n && !forDefault) {
      // only effects / non-paint nodes selected
    }
    if (forDefault) el.append(h("div.of-hint", "Default style for new shapes"));
    const fillSrc = () => (forDefault ? app.style.fill : n?.fill);
    const strokeSrc = () => (forDefault ? app.style.stroke : n?.stroke);

    // ---------------------------------------------------------------- fill
    if (n || forDefault) {
      const fillEd = paintEditor({
        label: "",
        get: fillSrc,
        set: (f, final) => {
          if (forDefault) {
            app.style.fill = f;
            app.emit("colors");
          } else editNodes("Fill", () => ({ fill: clone(f) }), final ? undefined : "fill");
        },
      });
      live.fill = fillEd;
      el.append(section("Fill", fillEd.el));

      // ---------------------------------------------------------------- stroke
      const strokeBox = h("div.of-stroke");
      const buildStroke = () => {
        empty(strokeBox);
        const s = strokeSrc();
        const setStroke = (patch, final = true) => {
          const cur = strokeSrc() || defaultStroke("#000000", 1);
          const next = { ...cur, ...patch };
          if (forDefault) {
            app.style.stroke = next;
            app.emit("colors");
          } else editNodes("Stroke", () => ({ stroke: clone(next) }), final ? undefined : "stroke");
        };
        const paint = paintEditor({
          label: "",
          allowNone: true,
          get: () => strokeSrc()?.fill || null,
          set: (f, final) => {
            if (!f) {
              if (forDefault) app.style.stroke = null;
              else editNodes("Stroke", () => ({ stroke: null }));
              buildStroke();
              return;
            }
            setStroke({ fill: clone(f) }, final);
          },
        });
        strokeBox.append(paint.el);
        live.stroke = paint;
        if (s) {
          const w = numField({ label: "Width", value: s.width, min: 0, max: 500, step: 0.5, unit: "px", precision: 2, onInput: (v) => setStroke({ width: v }, false), onChange: (v) => setStroke({ width: v }) });
          const align = segmented(
            [{ value: "inside", label: "Inside", icon: "box-arrow-in-down-right" }, { value: "center", label: "Center", icon: "dash-lg" }, { value: "outside", label: "Outside", icon: "box-arrow-up-right" }],
            s.align || "center",
            (v) => setStroke({ align: v }),
          );
          const cap = segmented([{ value: "butt", label: "Butt cap", text: "⏤" }, { value: "round", label: "Round cap", text: "◖" }, { value: "square", label: "Square cap", text: "▭" }], s.cap, (v) => setStroke({ cap: v }));
          const join = segmented([{ value: "miter", label: "Miter join", text: "⌐" }, { value: "round", label: "Round join", text: "⌒" }, { value: "bevel", label: "Bevel join", text: "⌙" }], s.join, (v) => setStroke({ join: v }));
          const dashSel = selectField({
            label: "Dash", value: dashKind(s), options: [{ value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }, { value: "dashdot", label: "Dash-dot" }],
            onChange: (v) => setStroke({ dash: dashFor(v, s.width) }),
          });
          strokeBox.append(h("div.of-row", w.el), h("div.of-row", h("span.of-num__label", "Align"), align.el), h("div.of-row", h("span.of-num__label", "Cap"), cap.el, h("span.of-num__label", "Join"), join.el), h("div.of-row", dashSel.el));
          live.strokeW = w;
        }
      };
      buildStroke();
      el.append(section("Stroke", strokeBox));
    }

    // ---------------------------------------------------------------- shape parameters
    const sel = app.activeNode;
    if (sel && ["rect", "polygon", "star"].includes(sel.type)) {
      const box = h("div.of-form");
      const setP = (patch, final = true) => app.doc.tx("Shape", () => app.selection.filter((x) => x.type === sel.type).forEach((x) => app.doc.set(x, patch)), { coalesce: final ? undefined : "shapeparam" });
      if (sel.type === "rect") {
        const r = Array.isArray(sel.r) ? sel.r[0] : sel.r || 0;
        const f = numField({ label: "Corner radius", value: r, min: 0, max: 5000, unit: "px", precision: 1, wide: true, onInput: (v) => setP({ r: [v, v, v, v] }, false), onChange: (v) => setP({ r: [v, v, v, v] }) });
        box.append(f.el);
      } else if (sel.type === "polygon") {
        box.append(numField({ label: "Sides", value: sel.sides, min: 3, max: 64, step: 1, precision: 0, wide: true, onChange: (v) => setP({ sides: Math.round(v) }) }).el, numField({ label: "Corner radius", value: sel.cr || 0, min: 0, max: 500, unit: "px", wide: true, onChange: (v) => setP({ cr: v }) }).el);
      } else {
        box.append(
          numField({ label: "Points", value: sel.points, min: 3, max: 64, step: 1, precision: 0, wide: true, onChange: (v) => setP({ points: Math.round(v) }) }).el,
          numField({ label: "Inner radius", value: Math.round(sel.ratio * 100), min: 5, max: 98, unit: "%", precision: 0, wide: true, onChange: (v) => setP({ ratio: v / 100 }) }).el,
          numField({ label: "Corner radius", value: sel.cr || 0, min: 0, max: 500, unit: "px", wide: true, onChange: (v) => setP({ cr: v }) }).el,
        );
      }
      el.append(section("Shape", box));
    }

    // ---------------------------------------------------------------- effects
    if (app.selection.length) el.append(section("Effects", effectsEditor(app)));
  }

  function dashKind(s) {
    if (!s.dash || !s.dash.length) return "solid";
    if (s.dash.length === 4) return "dashdot";
    return s.dash[0] < s.width * 0.5 ? "dotted" : "dashed";
  }
  function dashFor(kind, w) {
    const k = Math.max(1, w);
    switch (kind) {
      case "dashed":
        return [k * 3, k * 2];
      case "dotted":
        return [0.01, k * 2];
      case "dashdot":
        return [k * 3, k * 2, 0.01, k * 2];
      default:
        return null;
    }
  }

  function sync() {
    const n = targets()[targets().length - 1];
    const forDefault = !app.selection.length;
    const f = forDefault ? app.style.fill : n?.fill;
    live.fill?.update(f || null);
    const s = forDefault ? app.style.stroke : n?.stroke;
    live.stroke?.update(s?.fill || null);
    live.strokeW?.set(s?.width ?? 0);
  }

  function maybeBuild(force) {
    const n = app.activeNode;
    const s = `${app.doc?.id}|${app.selection.length}|${n?.id}|${n?.type}|${!!n?.stroke}|${n?.fill?.type}|${n?.stroke?.fill?.type}|${n?.fx?.length}|${app.selection.length ? 1 : 0}`;
    if (!force && s === sig) return sync();
    sig = s;
    build();
  }
  const sched = frameScheduler(() => maybeBuild(false));
  for (const ev of ["selection", "doc", "docchange", "colors"]) app.on(ev, sched);
  maybeBuild(true);
  return { el, show: () => maybeBuild(true) };
}

// ------------------------------------------------------------------ effects editor

function effectsEditor(app) {
  const wrap = h("div.of-fx");
  const doc = app.doc;
  const node = app.activeNode;
  const list = node.fx || [];
  const setFx = (fx, final = true, label = "Effects") => app.selection.length && doc.tx(label, () => app.selection.forEach((n) => doc.set(n, { fx: clone(fx) })), { coalesce: final ? undefined : "fx" });

  list.forEach((fx, i) => {
    const def = LAYER_FX[fx.type];
    if (!def) return;
    const form = buildControls(def.controls, fx, {
      onInput: (k, v) => setFx(patch(list, i, { [k]: v }), false),
      onChange: (k, v) => setFx(patch(list, i, { [k]: v })),
    });
    const sw = switchField({ label: def.label, value: fx.enabled !== false, onChange: (v) => setFx(patch(list, i, { enabled: v })) });
    const del = iconButton({ icon: "x-lg", label: "Remove effect", onClick: () => setFx(list.filter((_, j) => j !== i), true, "Remove Effect") });
    wrap.append(h("details.of-fx__item", { open: true }, h("summary", sw.el, del), form));
  });
  const options = FX_ORDER.map((t) => ({ value: t, label: LAYER_FX[t].label }));
  const add = h("sl-select", { placeholder: "Add effect…", size: "small", hoist: true, class: "of-fx__add", "aria-label": "Add effect" });
  for (const o of options) add.append(h("sl-option", { value: o.value }, o.label));
  add.addEventListener("sl-change", () => {
    const t = add.value;
    add.value = "";
    if (t) setFx([...list, newFx(t)], true, "Add Effect");
  });
  wrap.append(add);
  return wrap;
}

const patch = (list, i, p) => list.map((f, j) => (j === i ? { ...f, ...p } : f));
