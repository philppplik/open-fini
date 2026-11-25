// The Design panel of the Proto Studio (docs/concepts/proto-studio.md §5.3; dock id "proto-inspector"): every field of
// the selection's layers (§3.2): name; position, rotation, alignment, constraints, grid cells and "ignore auto layout";
// sizing (fixed, hug, fill, relative, with minimum and maximum); auto layout (flex direction, wrap, gap, padding, an
// alignment matrix) or grid (tracks, gaps, padding); appearance (opacity, blend, corner radius, clipping); fills,
// strokes and effects; text; accessibility and code; an export placeholder. With nothing selected it shows the page.
// Scrubbing a label or using the arrow keys previews live; a committed value is ONE operation for all selected layers
// (one undo step). Variable binding buttons come with T6.
//
//   createDesignPanel(ws) → { el, render(force?), geometry() }
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { numField, colorField } from "../../ui/controls.js";
import { field, isContainer, BLENDS, CONSTRAINTS_X, CONSTRAINTS_Y, TEXT_CASE, TEXT_DECORATION } from "../../engine/proto/schema.js";
import * as E from "../tools/edit.js";
import { parseTracks, formatTracks } from "../tools/math.js";
import { TYPE_LABELS, ICONS } from "./layers.js";

const SIZE_MODES = [
  ["fixed", N_("Fixed")],
  ["hug", N_("Hug contents")],
  ["fill", N_("Fill container")],
  ["rel", N_("Relative (%)")],
];
const CX_LABELS = { left: N_("Left"), right: N_("Right"), leftRight: N_("Left and right"), center: N_("Center"), scale: N_("Scale") };
const CY_LABELS = { top: N_("Top"), bottom: N_("Bottom"), topBottom: N_("Top and bottom"), center: N_("Center"), scale: N_("Scale") };
const ALIGN_LABELS = { start: N_("Start"), center: N_("Center"), end: N_("End"), stretch: N_("Stretch"), baseline: N_("Baseline") };
const JUSTIFY_LABELS = { start: N_("Start"), center: N_("Center"), end: N_("End"), "space-between": N_("Space between"), "space-around": N_("Space around"), "space-evenly": N_("Space evenly") };
const FILL_LABELS = { solid: N_("Solid"), linear: N_("Linear gradient"), radial: N_("Radial gradient"), conic: N_("Conic gradient"), image: N_("Image") };
const EFFECT_LABELS = { shadow: N_("Drop shadow"), inner: N_("Inner shadow"), blur: N_("Layer blur"), backgroundBlur: N_("Background blur") };
const STROKE_ALIGN = { inside: N_("Inside"), center: N_("Center"), outside: N_("Outside") };
const CASE_LABELS = { none: N_("As typed"), upper: N_("Uppercase"), lower: N_("Lowercase"), title: N_("Title case") };
const DECO_LABELS = { none: N_("None"), underline: N_("Underline"), strike: N_("Strikethrough") };
const AUTO_LABELS = { width: N_("Auto width"), height: N_("Auto height"), fixed: N_("Fixed size") };
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const FONTS = ["Inter", "system-ui", "Arial", "Helvetica", "Georgia", "Times New Roman", "Verdana", "Courier New", "monospace", "serif", "sans-serif"];
const BLEND_LABEL = (b) => b.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100;
const isHex = (s) => /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s);
const hex6 = (s) => {
  if (!isHex(s)) return null;
  if (s.length === 4 || s.length === 5) return "#" + [...s.slice(1)].map((c) => c + c).join("");
  return s.toLowerCase();
};

export function createDesignPanel(ws) {
  const el = h("div.of-proto-design", { role: "region", "aria-label": t("Design") });
  let key = null;
  let ids = [];

  const model = () => ws.model();
  const set = (s, unset) => E.setFields(model(), ids, s, unset);
  const live = (s) => ws.preview(set(s));
  const commit = (s, label = t("Edit properties"), unset) => ws.apply(set(s, unset), label);
  const apply = (op, label = t("Edit properties")) => ws.apply(op, label);

  // ------------------------------------------------------------------------------------------- widgets
  const sec = (title, children, actions = null) => h("section.of-proto-design__sec", { "aria-label": title }, h("header.of-proto-design__head", h("h3", title), actions), ...children.filter(Boolean));
  const grid = (...kids) => h("div.of-proto-design__grid", ...kids.filter(Boolean));
  const row = (...kids) => h("div.of-proto-design__row", ...kids.filter(Boolean));
  const note = (text) => h("p.of-proto-design__note", text);

  /** A number with a scrubbable label: live while scrubbing, one step on commit. */
  function numBox({ label, title, value, fld, min, max, step = 1, unit = "", precision = 2, disabled = false, onLive, onCommit }) {
    const f = numField({ label, title: title || label, value: value ?? NaN, min, max, step, unit, precision, onInput: (v) => onLive?.(v), onChange: (v) => onCommit(v) });
    f.el.dataset.field = fld;
    f.input.dataset.field = fld;
    if (disabled) f.disable(true);
    return f.el;
  }
  /** An optional number (blank = none). */
  function optBox({ label, value, fld, onCommit }) {
    const input = h("input.of-proto-design__opt", { type: "text", inputMode: "decimal", value: Number.isFinite(value) ? String(r2(value)) : "", placeholder: "–", "aria-label": label, dataset: { field: fld }, spellcheck: false });
    input.addEventListener("change", () => {
      const s = input.value.trim();
      if (!s) return onCommit(null);
      const v = Number(s.replace(",", "."));
      if (Number.isFinite(v) && v >= 0) onCommit(v);
      else input.value = Number.isFinite(value) ? String(value) : "";
    });
    input.addEventListener("keydown", (e) => e.key === "Enter" && input.blur());
    return h("label.of-proto-design__optf", h("span", label), input);
  }
  function select({ label, value, options, fld, onChange, disabled = false }) {
    const s = h("select.of-proto-design__select", { "aria-label": label, dataset: { field: fld }, disabled });
    for (const [v, l] of options) s.append(h("option", { value: v, selected: v === value }, l));
    if (!options.some(([v]) => v === value)) s.append(h("option", { value: "", selected: true, disabled: true }, t("Mixed")));
    s.addEventListener("change", () => onChange(s.value));
    return h("label.of-proto-design__field", h("span", label), s);
  }
  function check({ label, value, fld, onChange }) {
    const c = h("input", { type: "checkbox", checked: !!value, dataset: { field: fld } });
    c.addEventListener("change", () => onChange(c.checked));
    return h("label.of-proto-design__check", c, h("span", label));
  }
  function text({ label, value, fld, placeholder = "", onCommit, wide = false }) {
    const i = h("input.of-proto-design__text", { type: "text", value: value ?? "", placeholder, "aria-label": label, dataset: { field: fld }, spellcheck: false });
    i.addEventListener("change", () => onCommit(i.value));
    i.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") i.blur();
    });
    return h(`label.of-proto-design__field${wide ? ".is-wide" : ""}`, h("span", label), i);
  }
  function seg({ label, value, options, fld, onChange }) {
    const g = h("div.of-proto-design__seg", { role: "group", "aria-label": label });
    for (const o of options) {
      const b = h("button", { type: "button", "aria-pressed": String(o.value === value), "aria-label": o.label, "data-tip": o.label, dataset: { field: `${fld}:${o.value}` } }, o.icon ? h("sl-icon", { name: o.icon }) : o.label);
      b.addEventListener("click", () => onChange(o.value));
      g.append(b);
    }
    return g;
  }
  function color({ label, value, fld, onLive, onCommit }) {
    const v = typeof value === "string" ? value : "#000000";
    const c = colorField({ value: v, alpha: true, label: "", onInput: (x) => onLive?.(x), onChange: (x) => onCommit(x) });
    c.el.classList.add("of-proto-design__chip");
    const hexIn = h("input.of-proto-design__hex", { type: "text", value: typeof value === "string" ? value : t("Variable"), disabled: typeof value !== "string", "aria-label": label, dataset: { field: fld }, spellcheck: false });
    hexIn.addEventListener("change", () => {
      const s = hexIn.value.trim();
      const x = hex6(s.startsWith("#") ? s : `#${s}`);
      if (x) onCommit(x);
      else hexIn.value = v;
    });
    hexIn.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") hexIn.blur();
    });
    return h("div.of-proto-design__color", c.el, hexIn);
  }
  const iconBtn = (icon, label, onClick, { pressed, disabled } = {}) => {
    const b = h("button.of-proto-design__ibtn", { type: "button", "aria-label": label, "data-tip": label, disabled: !!disabled }, h("sl-icon", { name: icon }));
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    b.addEventListener("click", onClick);
    return b;
  };

  // ------------------------------------------------------------------------------------------- render
  function render(force = false) {
    const m = model();
    const sel = ws.selection.filter((id) => m.nodes[id]);
    const nodes = sel.map((id) => m.nodes[id]);
    const boxes = sel.map((id) => ws.box(id));
    const k = [ws.page, m.pages[ws.page], sel.join(","), ...nodes, ws.readOnly, measuredKey(sel, nodes, boxes)];
    if (!force && key && k.length === key.length && k.every((v, i) => v === key[i])) return;
    key = k;
    ids = sel;
    const focus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset?.field : null;
    const parts = nodes.length ? layerSections(m, nodes, boxes) : pageSections(m);
    el.replaceChildren(...parts);
    el.classList.toggle("is-readonly", ws.readOnly);
    if (ws.readOnly) for (const c of el.querySelectorAll("input, select, button")) c.disabled = true;
    if (focus) el.querySelector(`[data-field="${CSS.escape(focus)}"]`)?.focus?.({ preventScroll: true });
  }

  /** Values shown from the canvas (hug and fill sizes, positions in auto layout) take part in the render key. */
  function measuredKey(sel, nodes, boxes) {
    return nodes
      .map((n, i) => {
        const b = boxes[i];
        const auto = field(n, "w").mode !== "fixed" || field(n, "h").mode !== "fixed" || E.isFlow(model(), n.id);
        return auto && b ? `${r2(b.x)},${r2(b.y)},${r2(b.w)},${r2(b.h)}` : "";
      })
      .join(";");
  }

  function pageSections(m) {
    const p = m.pages[ws.page];
    if (!p) return [];
    return [
      sec(t("Page"), [
        grid(text({ label: t("Name"), value: p.name, fld: "page.name", wide: true, onCommit: (v) => v.trim() && apply({ op: "page.update", id: p.id, set: { name: v.trim().slice(0, 256) } }, t("Rename page")) })),
        h("div.of-proto-design__label", t("Background")),
        color({ label: t("Background"), value: p.bg || "#f4f4f5", fld: "page.bg", onCommit: (v) => apply({ op: "page.update", id: p.id, set: { bg: v } }, t("Page background")) }),
      ]),
      note(t("Select a layer to edit its position, size, layout, fills, strokes, effects and text.")),
    ];
  }

  function layerSections(m, nodes, boxes) {
    const n = nodes[0];
    const multi = nodes.length > 1;
    const out = [];
    // ---- header
    const title = multi ? t("{n} layers", { n: nodes.length }) : n.name || t(TYPE_LABELS[n.type] || "Layer");
    out.push(
      h(
        "div.of-proto-design__title",
        h("sl-icon", { name: multi ? "layers" : ICONS[n.type] || "square" }),
        multi ? h("strong", title) : text({ label: t("Name"), value: n.name, fld: "name", wide: true, onCommit: (v) => v.trim() && commit({ name: v.trim().slice(0, 256) }, t("Rename layer")) }),
        multi ? null : h("span.of-proto-design__type", t(TYPE_LABELS[n.type] || "Layer")),
      ),
    );
    out.push(positionSection(m, nodes, boxes));
    out.push(sizeSection(m, nodes, boxes));
    if (nodes.every((x) => isContainer(x.type) && x.type !== "instance")) out.push(layoutSection(m, nodes));
    out.push(appearanceSection(nodes));
    if (nodes.every((x) => x.type !== "line")) out.push(fillSection(nodes));
    out.push(strokeSection(nodes));
    out.push(effectSection(nodes));
    if (nodes.every((x) => x.type === "text")) out.push(textSection(nodes));
    out.push(codeSection(nodes));
    out.push(sec(t("Export"), [note(t("Exporting layers as images and code comes with a later update of this preview."))]));
    return out;
  }

  // ---- position
  function positionSection(m, nodes, boxes) {
    const n = nodes[0];
    const b = boxes[0];
    const flow = nodes.every((x) => E.isFlow(m, x.id));
    const anyFlow = nodes.some((x) => E.isFlow(m, x.id));
    const parent = n.parent != null ? m.nodes[n.parent] : null;
    const sameParent = nodes.every((x) => x.parent === n.parent);
    const plt = parent ? field(parent, "layout")?.type : "none";
    const kids = [];
    const alignOp = (edge) => apply(E.align(m, ids, edge, ws.box), t("Align layers"));
    const canAlign = !anyFlow && (nodes.length > 1 || parent);
    kids.push(
      h(
        "div.of-proto-design__aligns",
        { role: "group", "aria-label": t("Align") },
        iconBtn("align-start", t("Align left"), () => alignOp("left"), { disabled: !canAlign }),
        iconBtn("align-center", t("Align horizontal centers"), () => alignOp("hcenter"), { disabled: !canAlign }),
        iconBtn("align-end", t("Align right"), () => alignOp("right"), { disabled: !canAlign }),
        iconBtn("align-top", t("Align top"), () => alignOp("top"), { disabled: !canAlign }),
        iconBtn("align-middle", t("Align vertical centers"), () => alignOp("vcenter"), { disabled: !canAlign }),
        iconBtn("align-bottom", t("Align bottom"), () => alignOp("bottom"), { disabled: !canAlign }),
      ),
    );
    const pos = (axis) => {
      const stored = field(n, axis);
      const pb = parent ? ws.box(parent.id) : { x: 0, y: 0 };
      const shown = flow && b && pb ? b[axis] - pb[axis] : stored;
      return numBox({
        label: axis.toUpperCase(),
        title: axis === "x" ? t("X position") : t("Y position"),
        value: shown,
        fld: axis,
        disabled: flow,
        onLive: (v) => live({ [axis]: r2(v) }),
        onCommit: (v) => commit({ [axis]: r2(v) }, t("Move layers")),
      });
    };
    kids.push(
      grid(
        pos("x"),
        pos("y"),
        numBox({ label: "°", title: t("Rotation"), value: field(n, "rot"), fld: "rot", min: -360, max: 360, onLive: (v) => live({ rot: r2(v) }), onCommit: (v) => commit({ rot: r2(((v + 540) % 360) - 180) }, t("Rotate")) }),
      ),
    );
    if (sameParent && (plt === "flex" || plt === "grid"))
      kids.push(check({ label: t("Ignore auto layout (absolute position)"), value: nodes.every((x) => field(x, "pos") === "abs"), fld: "pos", onChange: (on) => (on ? apply(absolute(m), t("Absolute position")) : commit({ pos: "flow" }, t("Auto layout position"))) }));
    if (parent && !flow)
      kids.push(
        h("div.of-proto-design__label", t("Constraints")),
        grid(
          select({ label: t("Horizontal"), value: field(n, "cx"), fld: "cx", options: CONSTRAINTS_X.map((c) => [c, t(CX_LABELS[c])]), onChange: (v) => commit({ cx: v }, t("Constraints")) }),
          select({ label: t("Vertical"), value: field(n, "cy"), fld: "cy", options: CONSTRAINTS_Y.map((c) => [c, t(CY_LABELS[c])]), onChange: (v) => commit({ cy: v }, t("Constraints")) }),
        ),
      );
    if (plt === "grid" && flow && nodes.length === 1) {
      const cell = field(n, "cell") || {};
      const cellSet = (k, v) => {
        const next = { ...cell };
        if (v == null) delete next[k];
        else next[k] = Math.max(1, Math.round(v));
        return Object.keys(next).length ? commit({ cell: next }, t("Grid cell")) : commit({}, t("Grid cell"), ["cell"]);
      };
      kids.push(
        h("div.of-proto-design__label", t("Grid cell")),
        grid(
          optBox({ label: t("Column"), value: cell.col, fld: "cell.col", onCommit: (v) => cellSet("col", v) }),
          optBox({ label: t("Column span"), value: cell.colSpan, fld: "cell.colSpan", onCommit: (v) => cellSet("colSpan", v) }),
          optBox({ label: t("Row"), value: cell.row, fld: "cell.row", onCommit: (v) => cellSet("row", v) }),
          optBox({ label: t("Row span"), value: cell.rowSpan, fld: "cell.rowSpan", onCommit: (v) => cellSet("rowSpan", v) }),
        ),
      );
    }
    return sec(t("Position"), kids);
  }

  /** Absolute position for flow children, at the place they have now. */
  function absolute(m) {
    const ops = ids.map((id) => {
      const n = m.nodes[id];
      const b = ws.box(id);
      const pb = n.parent != null ? ws.box(n.parent) : null;
      return { op: "node.update", id, set: { pos: "abs", ...(b && pb ? { x: r2(b.x - pb.x), y: r2(b.y - pb.y) } : {}) } };
    });
    return E.batch(ops);
  }

  // ---- size
  function sizeSection(m, nodes, boxes) {
    const n = nodes[0];
    const b = boxes[0];
    const parent = n.parent != null ? m.nodes[n.parent] : null;
    const inAuto = parent && ["flex", "grid"].includes(field(parent, "layout")?.type);
    const container = isContainer(n.type) || n.type === "text";
    const axis = (ax) => {
      const s = field(n, ax);
      const modes = SIZE_MODES.filter(([v]) => (v === "hug" ? container || s.mode === "hug" : v === "fill" ? inAuto || s.mode === "fill" : true));
      const value = s.mode === "fixed" ? s.value : s.mode === "rel" ? s.value : b?.[ax === "w" ? "w" : "h"];
      const label = ax === "w" ? "W" : "H";
      return h(
        "div.of-proto-design__size",
        numBox({
          label,
          title: ax === "w" ? t("Width") : t("Height"),
          value,
          fld: ax,
          min: 0,
          unit: s.mode === "rel" ? "%" : "",
          onLive: (v) => live({ [ax]: s.mode === "rel" ? { ...s, value: Math.min(100, Math.max(0, r2(v))) } : { ...keepMinMax(s), mode: "fixed", value: Math.max(0, r2(v)) } }),
          onCommit: (v) => {
            if (s.mode === "rel") return commit({ [ax]: { ...s, value: Math.min(100, Math.max(0, r2(v))) } }, t("Resize"));
            const op = E.batch(ids.map((id) => E.resizeTo(m, id, sizeBox(m, id, ax, Math.max(0, r2(v))), { from: fromOf(m, id), measured: ws.box })));
            apply(op, t("Resize"));
          },
        }),
        select({ label: ax === "w" ? t("Width mode") : t("Height mode"), value: s.mode, fld: `${ax}.mode`, options: modes.map(([v, l]) => [v, t(l)]), onChange: (v) => apply(E.sizeMode(m, ids, ax, v, ws.box), t("Sizing")) }),
      );
    };
    const mm = (ax, k, label) => {
      const s = field(n, ax);
      return optBox({
        label,
        value: s[k],
        fld: `${ax}.${k}`,
        onCommit: (v) => {
          const next = { ...s };
          if (v == null) delete next[k];
          else next[k] = v;
          if (Number.isFinite(next.min) && Number.isFinite(next.max) && next.min > next.max) return;
          commit({ [ax]: next }, t("Minimum and maximum size"));
        },
      });
    };
    return sec(t("Size"), [axis("w"), axis("h"), h("div.of-proto-design__label", t("Minimum and maximum")), grid(mm("w", "min", t("Min W")), mm("w", "max", t("Max W")), mm("h", "min", t("Min H")), mm("h", "max", t("Max H")))]);
  }
  const keepMinMax = (s) => ({ ...(Number.isFinite(s.min) ? { min: s.min } : {}), ...(Number.isFinite(s.max) ? { max: s.max } : {}) });
  function fromOf(m, id) {
    const b = ws.box(id);
    const n = m.nodes[id];
    return { w: E.fixedSize(n, "w") ?? b?.w ?? 0, h: E.fixedSize(n, "h") ?? b?.h ?? 0 };
  }
  function sizeBox(m, id, ax, v) {
    const n = m.nodes[id];
    const f = fromOf(m, id);
    return { x: field(n, "x"), y: field(n, "y"), w: ax === "w" ? v : f.w, h: ax === "h" ? v : f.h };
  }

  // ---- auto layout
  function layoutSection(m, nodes) {
    const n = nodes[0];
    const L = field(n, "layout") || { type: "none" };
    const type = nodes.every((x) => (field(x, "layout")?.type || "none") === L.type) ? L.type : null;
    const setType = (v) => {
      if (v === type) return;
      if (v === "none") return apply(E.batch(ids.map((id) => E.removeAutoLayout(m, id, ws.box))), t("Remove auto layout"));
      if (type === "none" || type == null) return apply(E.batch(ids.map((id) => E.autoLayout(m, [id], v, ws.box))), v === "grid" ? t("Grid layout") : t("Auto layout"));
      // flex ⇄ grid keeps padding and gaps
      const next = v === "grid" ? { type: "grid", gap: L.gap ?? 0, rowGap: L.rowGap ?? L.gap ?? 0, pad: L.pad || [0, 0, 0, 0], align: "start", justify: "start", grid: { cols: [{ fr: 1 }, { fr: 1 }], rows: [], autoFlow: "row" } } : { type: "flex", dir: "row", gap: L.gap ?? 0, pad: L.pad || [0, 0, 0, 0], align: "start", justify: "start" };
      commit({ layout: next }, v === "grid" ? t("Grid layout") : t("Auto layout"));
    };
    const kids = [
      seg({
        label: t("Layout"),
        value: type,
        fld: "layout.type",
        options: [
          { value: "none", label: t("No layout"), icon: "bounding-box" },
          { value: "flex", label: t("Auto layout"), icon: "layout-three-columns" },
          { value: "grid", label: t("Grid"), icon: "grid-3x3" },
        ],
        onChange: setType,
      }),
    ];
    const lset = (path, v, label = t("Auto layout")) => commit({ [`layout.${path}`]: v }, label);
    const llive = (path, v) => live({ [`layout.${path}`]: v });
    const pad = Array.isArray(L.pad) ? L.pad : [0, 0, 0, 0];
    const padBoxes = () =>
      grid(
        ...[t("Top"), t("Right"), t("Bottom"), t("Left")].map((label, i) =>
          numBox({
            label: ["↑", "→", "↓", "←"][i],
            title: t("Padding {side}", { side: label }),
            value: typeof pad[i] === "number" ? pad[i] : NaN,
            fld: `pad.${i}`,
            min: 0,
            onLive: (v) => llive("pad", pad.map((p, j) => (j === i ? Math.max(0, r2(v)) : num(p)))),
            onCommit: (v) => lset("pad", pad.map((p, j) => (j === i ? Math.max(0, r2(v)) : num(p))), t("Padding")),
          }),
        ),
      );
    if (type === "flex") {
      const dir = L.dir || "row";
      kids.push(
        row(
          seg({ label: t("Direction"), value: dir, fld: "layout.dir", options: [{ value: "row", label: t("Horizontal"), icon: "arrow-right" }, { value: "column", label: t("Vertical"), icon: "arrow-down" }], onChange: (v) => lset("dir", v) }),
          check({ label: t("Wrap"), value: !!L.wrap, fld: "layout.wrap", onChange: (v) => lset("wrap", v) }),
        ),
        grid(
          numBox({ label: t("Gap"), value: typeof L.gap === "number" ? L.gap : NaN, fld: "layout.gap", min: 0, onLive: (v) => llive("gap", Math.max(0, r2(v))), onCommit: (v) => lset("gap", Math.max(0, r2(v)), t("Gap")) }),
          L.wrap ? numBox({ label: t("Row gap"), value: typeof (L.rowGap ?? L.gap) === "number" ? L.rowGap ?? L.gap : NaN, fld: "layout.rowGap", min: 0, onLive: (v) => llive("rowGap", Math.max(0, r2(v))), onCommit: (v) => lset("rowGap", Math.max(0, r2(v)), t("Gap")) }) : null,
        ),
        h("div.of-proto-design__label", t("Padding")),
        padBoxes(),
        h("div.of-proto-design__label", t("Alignment")),
        row(matrix(L, dir), h("div.of-proto-design__stack", select({ label: t("Justify"), value: L.justify || "start", fld: "layout.justify", options: Object.entries(JUSTIFY_LABELS).map(([v, l]) => [v, t(l)]), onChange: (v) => lset("justify", v) }), select({ label: t("Align items"), value: L.align || "start", fld: "layout.align", options: Object.entries(ALIGN_LABELS).map(([v, l]) => [v, t(l)]), onChange: (v) => lset("align", v) }))),
      );
    } else if (type === "grid") {
      const g = L.grid || { cols: [], rows: [] };
      const tracks = (k, label) =>
        text({
          label,
          value: formatTracks(g[k]),
          fld: `layout.grid.${k}`,
          placeholder: "1fr 1fr 240px",
          wide: true,
          onCommit: (v) => {
            const parsed = parseTracks(v);
            if (!parsed || (k === "cols" && !parsed.length)) {
              ws.app?.toast?.(t("Use track sizes such as 1fr, 240px, auto or minmax(200px, 1fr)."), "warning", 4000);
              return render(true);
            }
            lset(`grid.${k}`, parsed, t("Grid tracks"));
          },
        });
      kids.push(
        tracks("cols", t("Columns")),
        tracks("rows", t("Rows")),
        grid(
          numBox({ label: t("Column gap"), value: typeof L.gap === "number" ? L.gap : NaN, fld: "layout.gap", min: 0, onLive: (v) => llive("gap", Math.max(0, r2(v))), onCommit: (v) => lset("gap", Math.max(0, r2(v)), t("Gap")) }),
          numBox({ label: t("Row gap"), value: typeof (L.rowGap ?? L.gap) === "number" ? L.rowGap ?? L.gap : NaN, fld: "layout.rowGap", min: 0, onLive: (v) => llive("rowGap", Math.max(0, r2(v))), onCommit: (v) => lset("rowGap", Math.max(0, r2(v)), t("Gap")) }),
        ),
        h("div.of-proto-design__label", t("Padding")),
        padBoxes(),
        grid(
          select({ label: t("Align items"), value: L.align || "start", fld: "layout.align", options: Object.entries(ALIGN_LABELS).map(([v, l]) => [v, t(l)]), onChange: (v) => lset("align", v) }),
          select({ label: t("Justify"), value: L.justify || "start", fld: "layout.justify", options: Object.entries(JUSTIFY_LABELS).map(([v, l]) => [v, t(l)]), onChange: (v) => lset("justify", v) }),
          select({ label: t("Flow"), value: g.autoFlow || "row", fld: "layout.grid.autoFlow", options: [["row", t("Rows")], ["column", t("Columns")]], onChange: (v) => lset("grid.autoFlow", v) }),
        ),
      );
    } else if (type === "none") kids.push(note(t("Auto layout arranges the children in a row or a column with gaps and padding (Shift+A).")));
    kids.push(check({ label: t("Clip content"), value: nodes.every((x) => field(x, "clip") === true), fld: "clip", onChange: (v) => commit({ clip: v }, t("Clip content")) }));
    return sec(t("Auto layout"), kids);
  }

  /** The 3×3 alignment matrix: columns are the horizontal, rows the vertical alignment of the children. */
  function matrix(L, dir) {
    const vals = ["start", "center", "end"];
    const g = h("div.of-proto-design__matrix", { role: "group", "aria-label": t("Alignment") });
    const names = [t("Top"), t("Middle"), t("Bottom")];
    const hn = [t("left"), t("center"), t("right")];
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) {
        const justify = dir === "row" ? vals[x] : vals[y];
        const align = dir === "row" ? vals[y] : vals[x];
        const on = (L.justify || "start") === justify && (L.align || "start") === align;
        const b = h("button", { type: "button", "aria-pressed": String(on), "aria-label": `${names[y]} ${hn[x]}`, "data-tip": `${names[y]} ${hn[x]}`, dataset: { field: `matrix:${x}${y}` } }, h("span"));
        b.addEventListener("click", () => commit({ "layout.justify": justify, "layout.align": align }, t("Alignment")));
        g.append(b);
      }
    return g;
  }

  // ---- appearance
  function appearanceSection(nodes) {
    const n = nodes[0];
    const radius = field(n, "radius");
    const perCorner = Array.isArray(radius);
    const kids = [
      grid(
        numBox({ label: "%", title: t("Opacity"), value: num(field(n, "opacity"), 1) * 100, fld: "opacity", min: 0, max: 100, precision: 0, onLive: (v) => live({ opacity: r2(v / 100) }), onCommit: (v) => commit({ opacity: r2(Math.max(0, Math.min(100, v)) / 100) }, t("Opacity")) }),
        select({ label: t("Blend"), value: field(n, "blend"), fld: "blend", options: BLENDS.map((b) => [b, t(BLEND_LABEL(b))]), onChange: (v) => commit({ blend: v }, t("Blend mode")) }),
      ),
    ];
    if (nodes.every((x) => x.type !== "line" && x.type !== "text")) {
      const corners = perCorner ? radius : [radius, radius, radius, radius];
      kids.push(
        row(
          h("div.of-proto-design__label", t("Corner radius")),
          iconBtn("bounding-box-circles", t("Independent corners"), () => commit({ radius: perCorner ? num(corners[0]) : corners.map((c) => num(c)) }, t("Corner radius")), { pressed: perCorner }),
        ),
        perCorner
          ? grid(
              ...["↖", "↗", "↘", "↙"].map((label, i) =>
                numBox({ label, title: t("Corner radius"), value: num(corners[i]), fld: `radius.${i}`, min: 0, onLive: (v) => live({ radius: corners.map((c, j) => (j === i ? Math.max(0, r2(v)) : num(c))) }), onCommit: (v) => commit({ radius: corners.map((c, j) => (j === i ? Math.max(0, r2(v)) : num(c))) }, t("Corner radius")) }),
              ),
            )
          : grid(numBox({ label: "◜", title: t("Corner radius"), value: typeof radius === "number" ? radius : NaN, fld: "radius", min: 0, onLive: (v) => live({ radius: Math.max(0, r2(v)) }), onCommit: (v) => commit({ radius: Math.max(0, r2(v)) }, t("Corner radius")) })),
      );
    }
    kids.push(check({ label: t("Visible"), value: nodes.every((x) => field(x, "visible") !== false), fld: "visible", onChange: (v) => commit({ visible: v }, v ? t("Show layers") : t("Hide layers")) }));
    return sec(t("Appearance"), kids);
  }

  // ---- lists: fills, strokes, effects
  function listSection(title, key, items, { add, item, addLabel }) {
    const list = Array.isArray(items) ? items : [];
    const setList = (next, label) => commit({ [key]: next }, label);
    const addBtn = iconBtn("plus-lg", addLabel, () => setList([...list, add()], addLabel));
    const rows = list.map((it, i) => {
      const upd = (patch, label, liveOnly = false) => {
        const merged = { ...it, ...patch };
        for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
        const next = list.map((x, j) => (j === i ? merged : x));
        return liveOnly ? live({ [key]: next }) : setList(next, label);
      };
      const eye = iconBtn(it?.visible === false ? "eye-slash" : "eye", it?.visible === false ? t("Show") : t("Hide"), () => upd({ visible: it?.visible === false }, title), { pressed: it?.visible !== false });
      const del = iconBtn("dash-lg", t("Remove"), () => setList(list.filter((_, j) => j !== i), title));
      return h("div.of-proto-design__item", item(it, i, upd), h("div.of-proto-design__item-actions", eye, del));
    });
    return sec(title, rows.length ? rows : [note(t("None"))], addBtn);
  }

  function fillSection(nodes) {
    const n = nodes[0];
    return listSection(t("Fill"), "fills", field(n, "fills"), {
      addLabel: t("Add fill"),
      add: () => ({ type: "solid", color: n.type === "frame" ? "#ffffff" : "#d4d4d8" }),
      item: (f, i, upd) => {
        if (!f || typeof f !== "object") return h("span");
        const typeSel = select({
          label: t("Fill type"),
          value: f.type,
          fld: `fills.${i}.type`,
          options: Object.entries(FILL_LABELS).filter(([v]) => v !== "image" || f.type === "image").map(([v, l]) => [v, t(l)]),
          onChange: (v) => {
            const base = typeof f.color === "string" ? f.color : typeof f.stops?.[0]?.color === "string" ? f.stops[0].color : "#d4d4d8";
            if (v === "solid") upd({ type: "solid", color: base, stops: undefined, angle: undefined }, t("Fill"));
            else upd({ type: v, stops: f.stops?.length >= 2 ? f.stops : [{ at: 0, color: base }, { at: 1, color: "#ffffff" }], angle: f.angle ?? 180, color: undefined }, t("Fill"));
          },
        });
        const parts = [typeSel];
        if (f.type === "solid") parts.push(color({ label: t("Fill color"), value: f.color, fld: `fills.${i}.color`, onLive: (c) => upd({ color: c }, null, true), onCommit: (c) => upd({ color: c }, t("Fill")) }));
        else if (Array.isArray(f.stops)) {
          const stopColor = (j, label) => color({ label, value: f.stops[j].color, fld: `fills.${i}.stops.${j}`, onLive: (c) => upd({ stops: f.stops.map((s, k) => (k === j ? { ...s, color: c } : s)) }, null, true), onCommit: (c) => upd({ stops: f.stops.map((s, k) => (k === j ? { ...s, color: c } : s)) }, t("Fill")) });
          parts.push(stopColor(0, t("Start color")), stopColor(f.stops.length - 1, t("End color")));
          if (f.type !== "radial") parts.push(numBox({ label: "°", title: t("Angle"), value: num(f.angle, 180), fld: `fills.${i}.angle`, onLive: (v) => upd({ angle: r2(v) }, null, true), onCommit: (v) => upd({ angle: r2(v) }, t("Fill")) }));
        } else if (f.type === "image") parts.push(h("span.of-proto-design__muted", t("Image")));
        parts.push(numBox({ label: "%", title: t("Fill opacity"), value: num(f.opacity, 1) * 100, fld: `fills.${i}.opacity`, min: 0, max: 100, precision: 0, onLive: (v) => upd({ opacity: r2(v / 100) }, null, true), onCommit: (v) => upd({ opacity: r2(Math.max(0, Math.min(100, v)) / 100) }, t("Fill")) }));
        return h("div.of-proto-design__item-body", ...parts);
      },
    });
  }

  function strokeSection(nodes) {
    return listSection(t("Stroke"), "strokes", field(nodes[0], "strokes"), {
      addLabel: t("Add stroke"),
      add: () => ({ color: "#18181b", w: 1, align: nodes[0].type === "line" || nodes[0].type === "vector" ? "center" : "inside" }),
      item: (s, i, upd) =>
        h(
          "div.of-proto-design__item-body",
          color({ label: t("Stroke color"), value: s.color, fld: `strokes.${i}.color`, onLive: (c) => upd({ color: c }, null, true), onCommit: (c) => upd({ color: c }, t("Stroke")) }),
          numBox({ label: "W", title: t("Stroke width"), value: num(s.w, 1), fld: `strokes.${i}.w`, min: 0, onLive: (v) => upd({ w: Math.max(0, r2(v)) }, null, true), onCommit: (v) => upd({ w: Math.max(0, r2(v)) }, t("Stroke")) }),
          select({ label: t("Position"), value: s.align || "inside", fld: `strokes.${i}.align`, options: Object.entries(STROKE_ALIGN).map(([v, l]) => [v, t(l)]), onChange: (v) => upd({ align: v }, t("Stroke")) }),
          check({ label: t("Dashed"), value: Array.isArray(s.dash) && s.dash.length > 0, fld: `strokes.${i}.dash`, onChange: (v) => upd({ dash: v ? [4, 4] : null }, t("Stroke")) }),
        ),
    });
  }

  function effectSection(nodes) {
    return listSection(t("Effects"), "effects", field(nodes[0], "effects"), {
      addLabel: t("Add effect"),
      add: () => ({ type: "shadow", x: 0, y: 4, blur: 16, spread: 0, color: "#0000001f" }),
      item: (fx, i, upd) => {
        const kind = fx.type === "shadow" && fx.inset ? "inner" : fx.type;
        const typeSel = select({
          label: t("Effect"),
          value: kind,
          fld: `effects.${i}.type`,
          options: Object.entries(EFFECT_LABELS).map(([v, l]) => [v, t(l)]),
          onChange: (v) => {
            if (v === "shadow" || v === "inner") upd({ type: "shadow", inset: v === "inner" ? true : undefined, x: fx.x ?? 0, y: fx.y ?? 4, blur: fx.blur ?? 16, spread: fx.spread ?? 0, color: fx.color ?? "#0000001f", radius: undefined }, t("Effects"));
            else upd({ type: v, radius: fx.radius ?? 8, x: undefined, y: undefined, blur: undefined, spread: undefined, color: undefined, inset: undefined }, t("Effects"));
          },
        });
        if (fx.type === "shadow") {
          const n2 = (k, label, title, min) => numBox({ label, title, value: num(fx[k]), fld: `effects.${i}.${k}`, min, onLive: (v) => upd({ [k]: r2(v) }, null, true), onCommit: (v) => upd({ [k]: r2(min === 0 ? Math.max(0, v) : v) }, t("Effects")) });
          return h("div.of-proto-design__item-body", typeSel, grid(n2("x", "X", t("Shadow X")), n2("y", "Y", t("Shadow Y")), n2("blur", t("Blur"), t("Blur"), 0), n2("spread", t("Spread"), t("Spread"))), color({ label: t("Shadow color"), value: fx.color, fld: `effects.${i}.color`, onLive: (c) => upd({ color: c }, null, true), onCommit: (c) => upd({ color: c }, t("Effects")) }));
        }
        return h("div.of-proto-design__item-body", typeSel, numBox({ label: t("Blur"), title: t("Blur radius"), value: num(fx.radius), fld: `effects.${i}.radius`, min: 0, onLive: (v) => upd({ radius: Math.max(0, r2(v)) }, null, true), onCommit: (v) => upd({ radius: Math.max(0, r2(v)) }, t("Effects")) }));
      },
    });
  }

  // ---- text
  function textSection(nodes) {
    const n = nodes[0];
    const st = n.text?.style || {};
    const tset = (k, v, label = t("Text style")) => commit({ [`text.style.${k}`]: v }, label);
    const tlive = (k, v) => live({ [`text.style.${k}`]: v });
    const lh = st.lineHeight;
    const font = h("input.of-proto-design__text", { type: "text", value: st.font || "Inter", list: "of-proto-fonts", "aria-label": t("Font"), dataset: { field: "text.font" }, spellcheck: false });
    font.addEventListener("change", () => font.value.trim() && tset("font", font.value.trim().slice(0, 256), t("Font")));
    font.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") font.blur();
    });
    const datalist = h("datalist", { id: "of-proto-fonts" }, ...FONTS.map((f) => h("option", { value: f })));
    return sec(t("Text"), [
      h("label.of-proto-design__field.is-wide", h("span", t("Font")), font, datalist),
      grid(
        numBox({ label: t("Size"), title: t("Font size"), value: num(st.size, 16), fld: "text.size", min: 1, onLive: (v) => tlive("size", Math.max(1, r2(v))), onCommit: (v) => tset("size", Math.max(1, r2(v)), t("Font size")) }),
        select({ label: t("Weight"), value: String(num(st.weight, 400)), fld: "text.weight", options: WEIGHTS.map((w) => [String(w), String(w)]), onChange: (v) => tset("weight", Number(v), t("Font weight")) }),
        numBox({ label: t("Line"), title: t("Line height (%)"), value: lh && typeof lh === "object" && Number.isFinite(lh.pct) ? lh.pct : NaN, unit: "%", fld: "text.lineHeight", min: 0, onLive: (v) => tlive("lineHeight", { pct: Math.max(0, r2(v)) }), onCommit: (v) => tset("lineHeight", { pct: Math.max(0, r2(v)) }, t("Line height")) }),
        numBox({ label: t("Spacing"), title: t("Letter spacing"), value: num(st.tracking), step: 0.1, fld: "text.tracking", onLive: (v) => tlive("tracking", r2(v)), onCommit: (v) => tset("tracking", r2(v), t("Letter spacing")) }),
      ),
      seg({
        label: t("Text alignment"),
        value: st.align || "left",
        fld: "text.align",
        options: [
          { value: "left", label: t("Align left"), icon: "text-left" },
          { value: "center", label: t("Align center"), icon: "text-center" },
          { value: "right", label: t("Align right"), icon: "text-right" },
          { value: "justify", label: t("Justify"), icon: "justify" },
        ],
        onChange: (v) => tset("align", v, t("Text alignment")),
      }),
      grid(
        select({ label: t("Case"), value: st.case || "none", fld: "text.case", options: TEXT_CASE.map((c) => [c, t(CASE_LABELS[c])]), onChange: (v) => tset("case", v) }),
        select({ label: t("Decoration"), value: st.decoration || "none", fld: "text.decoration", options: TEXT_DECORATION.map((c) => [c, t(DECO_LABELS[c])]), onChange: (v) => tset("decoration", v) }),
        check({ label: t("Italic"), value: !!st.italic, fld: "text.italic", onChange: (v) => tset("italic", v) }),
      ),
      h("div.of-proto-design__label", t("Color")),
      color({ label: t("Text color"), value: st.color ?? "#18181b", fld: "text.color", onLive: (c) => tlive("color", c), onCommit: (c) => tset("color", c, t("Text color")) }),
      seg({
        label: t("Resizing"),
        value: n.text?.autoSize || "width",
        fld: "text.autoSize",
        options: Object.entries(AUTO_LABELS).map(([v, l]) => ({ value: v, label: t(l), icon: v === "width" ? "arrow-left-right" : v === "height" ? "arrow-down-up" : "aspect-ratio" })),
        onChange: (v) => {
          const m = model();
          const b = (id) => ws.box(id);
          const ops = ids.map((id) => {
            const x = m.nodes[id];
            const s = { "text.autoSize": v };
            if (v === "width") s.w = { mode: "hug" };
            else s.w = { mode: "fixed", value: r2(E.fixedSize(x, "w") ?? b(id)?.w ?? 100) };
            s.h = v === "fixed" ? { mode: "fixed", value: r2(E.fixedSize(x, "h") ?? b(id)?.h ?? 24) } : { mode: "hug" };
            return E.setFields(m, [id], s);
          });
          apply(E.batch(ops), t("Text resizing"));
        },
      }),
      optBox({ label: t("Max lines"), value: n.text?.maxLines, fld: "text.maxLines", onCommit: (v) => commit({ "text.maxLines": v == null ? null : Math.max(1, Math.round(v)) }, t("Max lines")) }),
    ]);
  }

  // ---- accessibility and code
  function codeSection(nodes) {
    const n = nodes[0];
    const a11y = n.a11y || {};
    return sec(t("Accessibility and code"), [
      grid(
        text({ label: t("HTML element"), value: n.tag || "", placeholder: "div", fld: "tag", onCommit: (v) => (v.trim() ? (/^[a-z][a-z0-9-]*$/.test(v.trim()) ? commit({ tag: v.trim() }, t("HTML element")) : render(true)) : commit({}, t("HTML element"), ["tag"])) }),
        text({ label: t("Role"), value: a11y.role || "", fld: "a11y.role", onCommit: (v) => commit({ a11y: { ...a11y, role: v.trim() || null } }, t("Accessibility")) }),
      ),
      text({ label: t("Accessible name"), value: a11y.label || "", fld: "a11y.label", wide: true, onCommit: (v) => commit({ a11y: { ...a11y, label: v.trim() || null } }, t("Accessibility")) }),
    ]);
  }

  return {
    el,
    render,
    geometry() {
      render();
    },
  };
}
