// The Data panel (right dock, Layout studio): table, cell and chart controls for the selection, plus the
// insert shortcuts when nothing is selected.
import { h, empty, frameScheduler } from "../../core/util.js";
import { numField, selectField, switchField, button, segmented, colorField, section } from "../controls.js";
import { isChart, editChart } from "../../core/data-nodes.js";
import * as A from "../../core/table-actions.js";
import { PRESET_IDS, TABLE_PRESETS, resolveStyle } from "../../engine/layout/table-styles.js";
import { CHART_TYPES, PALETTE_IDS, normalizeChart, resolveData, describeChart, paletteOf } from "../../engine/layout/chart-data.js";
import { rangeName } from "../../engine/layout/format.js";

const textField = ({ label, value = "", placeholder = "", multiline = false, onCommit }) => {
  const input = h(multiline ? "textarea.of-textfield" : "input.of-textfield", { type: "text", value, placeholder, rows: multiline ? 3 : undefined, spellcheck: false, "aria-label": label });
  if (multiline) input.value = value;
  const commit = () => onCommit?.(input.value);
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !multiline) input.blur();
  });
  return { el: h("label.of-textlabel", h("span.of-num__label", label), input), input, set: (v) => document.activeElement !== input && (input.value = v ?? "") };
};

const CUR = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY", "INR"];
const TYPES = Object.entries(CHART_TYPES).map(([value, d]) => ({ value, label: d.label }));

export function createDataPanel(app) {
  const el = h("div.of-panel.of-data");
  let syncs = [];
  const bind = (fn) => syncs.push(fn);
  const syncAll = () => syncs.forEach((f) => f());
  const run = (fn) => {
    fn();
    syncAll();
  };

  // ------------------------------------------------------------------ insert (nothing selected)
  function insertSection() {
    return h(
      "div.of-form",
      h("p.of-hint", "Tables and charts are normal objects: edit them here, on the canvas, or ask the Vibe assistant. Everything exports as vector graphics."),
      h("div.of-row", button("Insert table…", () => app.run("layout.insertTable"), { variant: "primary" }), button("Insert chart…", () => app.run("layout.insertChart"), { variant: "primary" })),
      h("div.of-row", button("Import CSV…", () => app.run("layout.importTable")), button("Paste from clipboard", () => app.run("edit.paste"))),
      h("p.of-hint", "Shortcuts: B = Table tool, H = Chart tool. In a table: click a cell, type, Tab / arrows to move, drag borders to resize."),
    );
  }

  // ------------------------------------------------------------------ table
  function tableSection(node) {
    const st = () => resolveStyle(node.tstyle);
    const styleOpts = () => [{ value: "custom", label: "Custom" }, ...PRESET_IDS.map((id) => ({ value: id, label: TABLE_PRESETS[id].name })), ...Object.entries(app.doc.tableStyles || {}).map(([id, s]) => ({ value: id, label: `${s.name} (saved)` }))];
    const preset = selectField({ label: "Style", value: node.styleId || "custom", options: styleOpts(), onChange: (v) => v !== "custom" && run(() => A.applyStylePreset(app, v)) });
    bind(() => preset.set(node.styleId || "custom"));
    const save = button("Save style…", async () => {
      const { promptDialog } = await import("../dialogs.js");
      const name = await promptDialog({ title: "Save table style", label: "Name", value: "My table style" });
      if (name) {
        const id = A.saveTableStyle(app, name);
        app.toast(`Saved “${name}”. It now appears in the Style list of every table in this document.`, "success");
        A.applyStylePreset(app, id);
        rebuild();
      }
    });
    const del = button("Delete saved", () => {
      const id = node.styleId;
      if (id && app.doc.tableStyles?.[id]) {
        A.deleteTableStyle(app, id);
        rebuild();
      }
    });
    const num = (label, get, set, o = {}) => {
      const f = numField({ label, value: get(), precision: 0, wide: true, ...o, onChange: (v) => run(() => set(v)) });
      bind(() => f.set(get()));
      return f;
    };
    const sw = (label, get, set) => {
      const f = switchField({ label, value: get(), onChange: (v) => run(() => set(v)) });
      bind(() => f.set(get()));
      return f;
    };
    const color = (label, get, set, { clearable = false } = {}) => {
      const f = colorField({ label, value: get() || "#ffffff", alpha: false, onChange: (c) => run(() => set(c)) });
      bind(() => f.set(get() || "#ffffff"));
      return clearable ? h("div.of-row", f.el, button("None", () => run(() => set(null)))) : f.el;
    };
    const ps = (key, label) => color(label, () => st()[key], (c) => A.patchStyle(app, { [key]: c }));
    const header = h(
      "div.of-form",
      h("div.of-row", preset.el),
      h("div.of-row", save, del),
      h("div.of-row", num("Header rows", () => node.headerRows, (v) => A.tableEdit(app, "Header Rows", (m) => (m.headerRows = Math.round(v))), { min: 0, max: 5 }).el, num("Header cols", () => node.headerCols, (v) => A.tableEdit(app, "Header Columns", (m) => (m.headerCols = Math.round(v))), { min: 0, max: 5 }).el),
      sw("Alternate row shading (zebra)", () => !!st().zebra, (v) => A.patchStyle(app, { zebra: v })).el,
      h("div.of-row", sw("Row lines", () => st().hLines, (v) => A.patchStyle(app, { hLines: v })).el, sw("Column lines", () => st().vLines, (v) => A.patchStyle(app, { vLines: v })).el),
      sw("Outer frame", () => st().outer, (v) => A.patchStyle(app, { outer: v })).el,
      h("div.of-row", ps("headFill", "Header fill"), ps("headColor", "Header text")),
      h("div.of-row", ps("altFill", "Zebra fill"), ps("borderColor", "Lines")),
      h("div.of-row", ps("color", "Text"), num("Line", () => st().borderWidth, (v) => A.patchStyle(app, { borderWidth: v }), { min: 0, max: 12, precision: 1, step: 0.5 }).el),
      h("div.of-row", num("Font size", () => st().size, (v) => A.patchStyle(app, { size: v }, "Table Font Size", { coalesce: "tsize" }), { min: 6, max: 96 }).el, num("Pad X", () => st().padX, (v) => A.patchStyle(app, { padX: v }, "Table Padding", { coalesce: "tpad" }), { min: 0, max: 60 }).el, num("Pad Y", () => st().padY, (v) => A.patchStyle(app, { padY: v }, "Table Padding", { coalesce: "tpad" }), { min: 0, max: 60 }).el),
      sw("Rows grow with their text", () => node.autoHeight !== false, (v) => A.tableEdit(app, "Row Height", (m) => (m.autoHeight = v))).el,
      sw("Repeat header rows when split across pages", () => node.repeatHeader !== false, (v) => app.doc.set(node, { repeatHeader: v }, "Repeat Header")).el,
    );
    const rowsCols = h(
      "div.of-form",
      h("div.of-btnrow", ...["table.rowAbove", "table.rowBelow", "table.dupRow", "table.moveRowUp", "table.moveRowDown", "table.deleteRows"].map((id) => cmdBtn(id))),
      h("div.of-btnrow", ...["table.colLeft", "table.colRight", "table.dupCol", "table.moveColLeft", "table.moveColRight", "table.deleteCols"].map((id) => cmdBtn(id))),
      h("div.of-btnrow", ...["table.distributeRows", "table.distributeCols", "table.fit"].map((id) => cmdBtn(id))),
      h("p.of-hint", "Rows and columns apply to the selected cells. Drag a cell border on the canvas to resize (Shift keeps the table width)."),
    );
    const data = h(
      "div.of-form",
      h("div.of-btnrow", ...["table.sortAsc", "table.sortDesc"].map((id) => cmdBtn(id))),
      h("div.of-btnrow", button("Import CSV…", () => app.run("layout.importTable")), cmdBtn("table.exportCSV"), cmdBtn("table.flow")),
      textField({ label: "Alt text (exported to SVG)", value: node.alt || "", multiline: true, onCommit: (v) => app.doc.set(node, { alt: v }, "Alt Text") }).el,
      h("p.of-hint", "Formulas start with =. Functions: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, PRODUCT, MEDIAN, ROUND, ABS, SQRT, IF, AND, OR, NOT. Example: =SUM(B2:B5) or =B2*1.19."),
    );
    return [section("Table", header), section("Rows and columns", rowsCols), cellSection(node), section("Data", data, { open: false })];
  }

  function cmdBtn(id) {
    const c = app.commands.get(id);
    const b = button(c?.label?.replace(/\(s\)/, "").replace(" Evenly", "").replace(" by Column", "").replace("Export Table as ", "Export ").replace(" Across Pages", " over pages") || id, () => app.run(id), { cls: "of-btn--small" });
    b.title = c?.label || id;
    return b;
  }

  // ------------------------------------------------------------------ cells
  function cellSection(node) {
    const first = () => {
      const r = A.selRect(app, node);
      return r ? node.cells[r.r0][r.c0] : { v: "" };
    };
    const rect = () => A.selRect(app, node);
    const status = h("div.of-hint.of-data__status");
    const formula = textField({ label: "Cell content (type = for a formula)", onCommit: (v) => {
      const s = app.tableSel;
      const r = rect();
      if (r) run(() => A.setCellText(app, s && !s.all ? Math.min(s.ar, s.fr) : r.r0, s && !s.all ? Math.min(s.ac, s.fc) : r.c0, v));
    } });
    bind(() => {
      const r = rect();
      const s = app.tableSel;
      const all = !s || s.all;
      status.textContent = all ? "Cells: the whole table (click a cell on the canvas to select)" : `Cells: ${rangeName({ r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 })}`;
      formula.set(all ? "" : first().v);
      formula.input.disabled = all;
    });
    const fmt = (patch, label) => run(() => A.formatSelection(app, patch, label));
    const toggle = (txt, key, title) => {
      const b = button(txt, () => fmt({ [key]: !first()[key] }, title), { cls: "of-btn--small of-btn--toggle" });
      b.title = title;
      bind(() => b.setAttribute("aria-pressed", String(!!first()[key])));
      return b;
    };
    const align = segmented([{ value: "left", label: "Align left", icon: "text-left" }, { value: "center", label: "Align center", icon: "text-center" }, { value: "right", label: "Align right", icon: "text-right" }], first().align || "", (v) => fmt({ align: v }, "Cell Alignment"));
    const valign = segmented([{ value: "top", label: "Align top", icon: "align-top" }, { value: "middle", label: "Align middle", icon: "align-middle" }, { value: "bottom", label: "Align bottom", icon: "align-bottom" }], first().valign || "middle", (v) => fmt({ valign: v }, "Cell Alignment"));
    bind(() => (align.set(first().align || ""), valign.set(first().valign || "middle")));
    const tcolor = colorField({ label: "Text", value: first().color || "#111827", alpha: false, onChange: (c) => fmt({ color: c }, "Cell Text Color") });
    const fill = colorField({ label: "Fill", value: first().fill || "#ffffff", alpha: false, onChange: (c) => fmt({ fill: c }, "Cell Fill") });
    bind(() => (tcolor.set(first().color || "#111827"), fill.set(first().fill || "#ffffff")));
    const size = numField({ label: "Size", value: first().size || 0, min: 0, max: 200, precision: 0, wide: true, title: "Font size for these cells (0 = table default)", onChange: (v) => fmt({ size: v || null }, "Cell Font Size") });
    const pad = numField({ label: "Padding", value: first().pad ?? 0, min: 0, max: 60, precision: 0, wide: true, title: "Padding for these cells (0 = table default)", onChange: (v) => fmt({ pad: v || null }, "Cell Padding") });
    bind(() => (size.set(first().size || 0), pad.set(first().pad || 0)));
    // borders
    const bw = { where: "all", width: 1, color: "#111827" };
    const where = selectField({ label: "Borders", value: "all", options: ["all", "outer", "inner", "top", "bottom", "left", "right", "none"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })), onChange: (v) => (bw.where = v) });
    const width = numField({ label: "Width", value: 1, min: 0, max: 12, precision: 1, step: 0.5, wide: true, onChange: (v) => (bw.width = v) });
    const bcolor = colorField({ label: "Color", value: bw.color, alpha: false, onChange: (c) => (bw.color = c) });
    const applyB = button("Apply borders", () => run(() => A.borderSelection(app, bw.where, bw.where === "none" || !bw.width ? null : { w: bw.width, c: bw.color })));
    // number format
    const nf = { type: "auto", decimals: 2, currency: "USD", prefix: "", suffix: "", thousands: true, negative: "minus", dateStyle: "medium" };
    const col = () => node.colFmt?.[rect().c0] || null;
    const useCell = switchField({ label: "Selected cells only (not the whole column)", value: false });
    const pushFmt = () => {
      const spec = nf.type === "auto" && !nf.prefix && !nf.suffix ? null : { ...nf, decimals: nf.type === "auto" ? undefined : nf.decimals };
      run(() => (useCell.sw.checked ? A.setCellFormat(app, spec) : A.setColumnFormat(app, spec)));
    };
    const ftype = selectField({ label: "Number format", value: "auto", options: [["auto", "Automatic"], ["number", "Number"], ["currency", "Currency"], ["percent", "Percent"], ["compact", "Compact (1.2K)"], ["date", "Date"], ["text", "Text"]].map(([value, label]) => ({ value, label })), onChange: (v) => ((nf.type = v), pushFmt()) });
    const fdec = numField({ label: "Decimals", value: 2, min: 0, max: 8, precision: 0, wide: true, onChange: (v) => ((nf.decimals = Math.round(v)), pushFmt()) });
    const fcur = selectField({ label: "Currency", value: "USD", options: CUR.map((c) => ({ value: c, label: c })), onChange: (v) => ((nf.currency = v), pushFmt()) });
    const fpre = textField({ label: "Prefix", onCommit: (v) => ((nf.prefix = v), pushFmt()) });
    const fsuf = textField({ label: "Suffix", onCommit: (v) => ((nf.suffix = v), pushFmt()) });
    const fneg = switchField({ label: "Negative in parentheses", value: false, onChange: (v) => ((nf.negative = v ? "parens" : "minus"), pushFmt()) });
    bind(() => {
      const f = (useCell.sw.checked ? first().fmt : col()) || {};
      Object.assign(nf, { type: f.type || "auto", decimals: f.decimals ?? 2, currency: f.currency || "USD", prefix: f.prefix || "", suffix: f.suffix || "", negative: f.negative || "minus", dateStyle: f.dateStyle || "medium" });
      ftype.set(nf.type);
      fdec.set(nf.decimals);
      fcur.set(nf.currency);
      fpre.set(nf.prefix);
      fsuf.set(nf.suffix);
      fneg.set(nf.negative === "parens");
    });
    const body = h(
      "div.of-form",
      status,
      formula.el,
      h("div.of-row", align.el, valign.el),
      h("div.of-btnrow", toggle("B", "bold", "Bold"), toggle("I", "italic", "Italic"), toggle("U", "underline", "Underline"), button("Merge", () => app.run("table.merge"), { cls: "of-btn--small" }), button("Split", () => app.run("table.split"), { cls: "of-btn--small" })),
      h("div.of-row", tcolor.el, fill.el, button("No fill", () => fmt({ fill: null }, "Cell Fill"), { cls: "of-btn--small" })),
      h("div.of-row", size.el, pad.el),
      h("div.of-row", where.el, width.el, bcolor.el),
      applyB,
      ftype.el,
      h("div.of-row", fdec.el, fcur.el),
      h("div.of-row", fpre.el, fsuf.el),
      fneg.el,
      useCell.el,
    );
    return section("Cells", body);
  }

  // ------------------------------------------------------------------ chart
  function chartSection(node) {
    const chart = () => normalizeChart(node.chart);
    const opt = (key, value, label = "Chart Option") => run(() => editChart(app.doc, node, (c) => (c.options[key] = value), label, { coalesce: `copt:${key}` }));
    const top = (key, value, label = "Chart") => run(() => editChart(app.doc, node, (c) => (c[key] = value), label, { coalesce: `ctop:${key}` }));
    const sel = (label, key, options) => {
      const f = selectField({ label, value: String(chart().options[key]), options, onChange: (v) => opt(key, v) });
      bind(() => f.set(String(chart().options[key])));
      return f.el;
    };
    const sw = (label, key) => {
      const f = switchField({ label, value: !!chart().options[key], onChange: (v) => opt(key, v) });
      bind(() => f.set(!!chart().options[key]));
      return f.el;
    };
    const num = (label, key, o = {}) => {
      const f = numField({ label, value: chart().options[key] ?? 0, wide: true, precision: 0, ...o, onChange: (v) => opt(key, o.scaleOut ? o.scaleOut(v) : v) });
      bind(() => f.set(o.scaleIn ? o.scaleIn(chart().options[key]) : chart().options[key] ?? 0));
      return f.el;
    };
    const optionalNum = (label, key) => {
      const f = textField({ label, value: chart().options[key] == null ? "" : String(chart().options[key]), placeholder: "auto", onCommit: (v) => {
        const n = parseFloat(String(v).replace(",", "."));
        opt(key, Number.isFinite(n) ? n : null);
      } });
      bind(() => f.set(chart().options[key] == null ? "" : String(chart().options[key])));
      return f.el;
    };
    const txt = (label, get, set, o = {}) => {
      const f = textField({ label, value: get(), onCommit: set, ...o });
      bind(() => f.set(get()));
      return f.el;
    };
    const type = selectField({ label: "Type", value: chart().type, options: TYPES, onChange: (v) => run(() => editChart(app.doc, node, (c) => (c.type = v), "Chart Type")) });
    bind(() => type.set(chart().type));
    const linked = h("div.of-hint");
    bind(() => {
      const c = chart();
      const t = c.source && app.doc.find(c.source.tableId);
      linked.textContent = c.source ? (t ? `Data: linked to table “${t.name}” (updates live).` : "Data: linked table is missing, showing the last values.") : "Data: stored in the chart.";
    });
    const fnum = (key) => (chart().options.numFmt || {})[key];
    const setFmt = (patch) => opt("numFmt", { ...(chart().options.numFmt || { type: "number" }), ...patch }, "Chart Number Format");
    const ftype = selectField({ label: "Number format", value: (chart().options.numFmt || {}).type || "auto", options: [["auto", "Automatic"], ["number", "Number"], ["currency", "Currency"], ["percent", "Percent (×100)"], ["compact", "Compact"]].map(([value, label]) => ({ value, label })), onChange: (v) => (v === "auto" ? opt("numFmt", null, "Chart Number Format") : setFmt({ type: v })) });
    const fdec = numField({ label: "Decimals", value: fnum("decimals") ?? 0, min: 0, max: 6, precision: 0, wide: true, onChange: (v) => setFmt({ decimals: Math.round(v) }) });
    const fpre = textField({ label: "Prefix", value: fnum("prefix") || "", onCommit: (v) => setFmt({ prefix: v }) });
    const fsuf = textField({ label: "Suffix", value: fnum("suffix") || "", onCommit: (v) => setFmt({ suffix: v }) });
    bind(() => (ftype.set((chart().options.numFmt || {}).type || "auto"), fdec.set(fnum("decimals") ?? 0), fpre.set(fnum("prefix") || ""), fsuf.set(fnum("suffix") || "")));
    // colors
    const pal = selectField({ label: "Palette", value: typeof chart().options.palette === "string" ? chart().options.palette : "default", options: PALETTE_IDS.map((id) => ({ value: id, label: id[0].toUpperCase() + id.slice(1) })), onChange: (v) => opt("palette", v, "Chart Palette") });
    const strip = h("div.of-datadlg__swatches");
    const seriesBox = h("div.of-form");
    const drawSeries = () => {
      empty(strip);
      for (const c of paletteOf(chart().options)) strip.append(h("span", { style: { background: c } }));
      empty(seriesBox);
      const c = chart();
      const { data } = resolveData(c, (id) => (app.doc.find(id)?.type === "table" ? app.doc.find(id) : null));
      const pieLike = CHART_TYPES[c.type].family === "pie";
      if (pieLike) return;
      data.series.slice(0, 12).forEach((s, i) => {
        const cur = c.data.series[i]?.color || paletteOf(c.options)[i % paletteOf(c.options).length];
        const f = colorField({ label: s.name, value: cur, alpha: false, onChange: (col) => run(() => editChart(app.doc, node, (cc) => { if (cc.data.series[i]) cc.data.series[i].color = col; }, "Series Color", { coalesce: `scol:${i}` })) });
        seriesBox.append(h("div.of-row", f.el, button("Reset", () => run(() => editChart(app.doc, node, (cc) => { if (cc.data.series[i]) delete cc.data.series[i].color; }, "Series Color")), { cls: "of-btn--small" })));
      });
    };
    bind(() => (pal.set(typeof chart().options.palette === "string" ? chart().options.palette : "default"), drawSeries()));
    const bg = colorField({ label: "Background", value: chart().options.background || "#ffffff", alpha: false, onChange: (c) => opt("background", c, "Chart Background") });
    bind(() => bg.set(chart().options.background || "#ffffff"));
    const alt = textField({ label: "Alt text (SVG title / description)", value: node.alt || "", multiline: true, placeholder: describeChart(chart(), resolveData(chart(), () => null).data), onCommit: (v) => app.doc.set(node, { alt: v }, "Alt Text") });
    bind(() => alt.set(node.alt || ""));
    const main = h(
      "div.of-form",
      h("div.of-row", button("Edit data…", () => app.run("chart.editData"), { variant: "primary" }), button("Gallery…", () => app.run("chart.gallery"))),
      linked,
      type.el,
      txt("Title", () => chart().title, (v) => top("title", v, "Chart Title")),
      txt("Subtitle", () => chart().subtitle, (v) => top("subtitle", v, "Chart Subtitle")),
    );
    const style = h(
      "div.of-form",
      pal.el,
      strip,
      seriesBox,
      sel("Legend", "legend", ["auto", "bottom", "top", "right", "left", "none"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))),
      sel("Theme", "theme", [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]),
      h("div.of-row", bg.el, button("Transparent", () => opt("background", null, "Chart Background"), { cls: "of-btn--small" })),
      num("Text size", "fontScale", { min: 0.5, max: 3, step: 0.1, precision: 1 }),
    );
    const axes = h(
      "div.of-form",
      txt("Horizontal axis title", () => chart().options.xTitle, (v) => opt("xTitle", v, "Axis Title")),
      txt("Vertical axis title", () => chart().options.yTitle, (v) => opt("yTitle", v, "Axis Title")),
      sw("Gridlines", "gridlines"),
      h("div.of-row", optionalNum("Min", "min"), optionalNum("Max", "max")),
      sw("Logarithmic value axis", "log"),
      sel("Sort categories", "sort", [{ value: "none", label: "As entered" }, { value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]),
    );
    const marks = h(
      "div.of-form",
      sw("Data labels", "dataLabels"),
      ftype.el,
      h("div.of-row", fdec.el, h("div.of-row", fpre.el, fsuf.el)),
      sw("Smooth lines", "smooth"),
      sw("Markers", "markers"),
      sw("Color each category (single series)", "varyColors"),
      h("div.of-row", num("Corner radius", "radius", { min: 0, max: 40 }), num("Gap %", "gap", { min: 0, max: 90, scaleIn: (v) => Math.round((v ?? 0.35) * 100), scaleOut: (v) => v / 100 })),
      num("Bar overlap %", "overlap", { min: -50, max: 100, scaleIn: (v) => Math.round((v ?? 0) * 100), scaleOut: (v) => v / 100 }),
      h("div.of-row", num("Donut hole %", "innerRadius", { min: 20, max: 90, scaleIn: (v) => Math.round((v ?? 0.62) * 100), scaleOut: (v) => v / 100 }), num("Start angle", "startAngle", { min: -360, max: 360 })),
      txt("Center text (donut / ring)", () => chart().options.centerLabel, (v) => opt("centerLabel", v, "Chart Center Text")),
      optionalNum("Target (progress / ring, default 100)", "target"),
    );
    const a11y = h("div.of-form", alt.el, h("p.of-hint", "Leave empty to use the automatic description. The text becomes the chart's <desc> in SVG exports."));
    return [section("Chart", main), section("Colors and layout", style), section("Axes", axes, { open: false }), section("Labels and shapes", marks, { open: false }), section("Accessibility", a11y, { open: false })];
  }

  // ------------------------------------------------------------------ assembly
  let key = "";
  function rebuild() {
    syncs = [];
    empty(el);
    if (!app.doc) return;
    const node = A.activeTable(app);
    const sel = app.selection;
    const chartNode = sel.length === 1 && isChart(sel[0]) ? sel[0] : null;
    key = `${app.doc.id}|${node?.id}|${chartNode?.id}`;
    if (node) el.append(...tableSection(node));
    else if (chartNode) el.append(...chartSection(chartNode));
    else el.append(insertSection());
    syncAll();
  }
  const sched = frameScheduler(() => {
    const node = A.activeTable(app);
    const sel = app.selection;
    const chartNode = sel.length === 1 && isChart(sel[0]) ? sel[0] : null;
    const k = `${app.doc?.id}|${node?.id}|${chartNode?.id}`;
    if (k !== key) rebuild();
    else syncAll();
  });
  for (const ev of ["selection", "doc", "tablesel", "docchange"]) app.on(ev, sched);
  rebuild();
  return { el, show: rebuild };
}

