// Dialogs of the Spreadsheet app (lazy): insert function, chart, conditional formatting, filter values, find and
// replace, custom number format. Each one commits through the view (one undo step).
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { openDialog } from "../toolkit/ui.js";
import { findMatches, replaceMatches } from "../toolkit/find.js";
import { parseRange, formatRange } from "../toolkit/selection.js";
import { CHART_TYPES } from "../../engine/layout/chart-data.js";
import { FUNCTION_NAMES } from "./functions.js";
import { formatCode } from "./numfmt-code.js";
import * as M from "./model.js";
import { rcKey, keyRC } from "./formula.js";
import { cellLook } from "./render.js";

const field = (label, control) => h("label.of-ofield", h("span", t(label)), control);
const input = (value = "", attrs = {}) => h("input.of-oinput", { value: String(value ?? ""), spellcheck: "false", ...attrs });
const select = (options, value) => h("select.of-oinput", options.map(([v, l]) => h("option", { value: v, selected: v === value || undefined }, t(l))));

export function functionDialog(view) {
  const search = input("", { placeholder: t("Search functions"), "aria-label": t("Search functions") });
  const list = h("select.of-oinput", { size: "12", "aria-label": t("Functions") });
  const fill = () => list.replaceChildren(...FUNCTION_NAMES.filter((n) => n.includes(search.value.trim().toUpperCase())).map((n) => h("option", { value: n }, n)));
  search.addEventListener("input", fill);
  fill();
  const insert = (close) => {
    const name = list.value || list.options[0]?.value;
    if (!name) return;
    close();
    view.startEdit(`=${name}(`);
  };
  list.addEventListener("dblclick", () => insert(d.close));
  const d = openDialog({ title: "Insert function", width: 360, body: h("div.of-oform", search, list), buttons: [{ label: "Cancel", onClick: (c) => c() }, { label: "Insert", variant: "primary", onClick: insert }] });
}

const CHART_CHOICES = ["column", "stacked-column", "bar", "line", "area", "pie", "donut", "scatter"];

export function chartDialog(view, chart = null) {
  const g = view.clampRange(view.range);
  const single = g.r0 === g.r1 && g.c0 === g.c1;
  const rangeIn = input(chart?.range || formatRange(single ? M.currentRegion(view.sheet, g.r0, g.c0) : g), { "aria-label": t("Data range") });
  const type = select(CHART_CHOICES.map((k) => [k, CHART_TYPES[k].label]), chart?.type || "column");
  const title = input(chart?.title || "", { "aria-label": t("Chart title") });
  const by = select([["columns", N_("Series in columns")], ["rows", N_("Series in rows")]], chart?.seriesIn || "columns");
  const body = h("div.of-oform", field("Chart type", type), field("Data range", rangeIn), field("Series", by), field("Title", title), h("p.of-hint", t("The first row holds the series names and the first column the categories.")));
  const buttons = [{ label: "Cancel", onClick: (c) => c() }];
  if (chart) buttons.unshift({ label: "Delete chart", onClick: (c) => (c(), view.deleteChart(chart.id)) });
  buttons.push({
    label: chart ? "Apply" : "Insert",
    variant: "primary",
    onClick: (close) => {
      const r = parseRange(rangeIn.value.trim().toUpperCase());
      if (!r) return view.app.toast(t("“{ref}” is not a cell range.", { ref: rangeIn.value }), "warning");
      close();
      const def = { type: type.value, range: formatRange(r), title: title.value.trim(), seriesIn: by.value };
      if (chart) return view.commit("Edit Chart", M.updateSheet(view.model, view.sid, (s) => ({ ...s, charts: s.charts.map((c) => (c.id === chart.id ? { ...c, ...def } : c)) })));
      const ch = { id: M.newId("ch"), ...def, r: r.r0, c: r.c1 + 2, w: 480, h: 300 };
      view.commit("Insert Chart", M.updateSheet(view.model, view.sid, (s) => ({ ...s, charts: [...s.charts, ch] })));
      view.chartSel = ch.id;
      view.paint();
    },
  });
  openDialog({ title: chart ? "Edit chart" : "Insert chart", width: 440, body, buttons });
}

const CF_TYPES = [["gt", N_("Greater than")], ["lt", N_("Less than")], ["ge", N_("Greater than or equal to")], ["le", N_("Less than or equal to")], ["eq", N_("Equal to")], ["ne", N_("Not equal to")], ["between", N_("Between")], ["contains", N_("Text contains")], ["blank", N_("Is empty")], ["notBlank", N_("Is not empty")], ["scale", N_("Color scale (red to green)")]];
const CF_STYLES = [["red", N_("Light red fill, dark red text"), { fill: "#ffc7ce", color: "#9c0006" }], ["green", N_("Green fill, dark green text"), { fill: "#c6efce", color: "#006100" }], ["yellow", N_("Yellow fill, dark yellow text"), { fill: "#ffeb9c", color: "#9c5700" }], ["bold", N_("Bold red text"), { color: "#c00000", b: true }]];

export function conditionalDialog(view) {
  const g = view.clampRange(view.range);
  const rangeIn = input(formatRange(g), { "aria-label": t("Apply to range") });
  const type = select(CF_TYPES, "gt");
  const a = input("", { "aria-label": t("Value") });
  const b = input("", { "aria-label": t("Second value") });
  const style = select(CF_STYLES.map(([k, l]) => [k, l]), "red");
  const sync = () => {
    b.closest("label").hidden = type.value !== "between";
    a.closest("label").hidden = ["blank", "notBlank", "scale"].includes(type.value);
    style.closest("label").hidden = type.value === "scale";
  };
  type.addEventListener("change", sync);
  const rules = view.sheet.cf;
  const list = h("ul.of-sheet__rules", rules.map((r) => {
    const del = h("button.of-tk-btn", { type: "button", "aria-label": t("Delete rule") }, h("sl-icon", { name: "trash" }));
    del.addEventListener("click", () => {
      view.commit("Delete Rule", M.updateSheet(view.model, view.sid, (s) => ({ ...s, cf: s.cf.filter((x) => x.id !== r.id) })));
      del.closest("li").remove();
    });
    return h("li", h("span", `${r.range}: ${t(CF_TYPES.find((x) => x[0] === r.type)?.[1] || r.type)} ${r.a ?? ""}${r.type === "between" ? ` – ${r.b}` : ""}`), del);
  }));
  const body = h("div.of-oform", rules.length ? h("div", h("strong", t("Rules of this sheet")), list) : null, field("Apply to range", rangeIn), field("Format cells when the value is", type), field("Value", a), field("Second value", b), field("Style", style));
  openDialog({
    title: "Conditional formatting",
    width: 460,
    body,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Add rule",
        variant: "primary",
        onClick: (close) => {
          const r = parseRange(rangeIn.value.trim().toUpperCase());
          if (!r) return view.app.toast(t("“{ref}” is not a cell range.", { ref: rangeIn.value }), "warning");
          const num = (v) => (v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v);
          const rule = { id: M.newId("cf"), range: formatRange(r), type: type.value };
          if (!["blank", "notBlank", "scale"].includes(rule.type)) rule.a = num(a.value);
          if (rule.type === "between") rule.b = num(b.value);
          if (rule.type === "scale") rule.colors = ["#f8696b", "#63be7b"];
          else rule.style = CF_STYLES.find((x) => x[0] === style.value)[2];
          close();
          view.commit("Conditional Formatting", M.updateSheet(view.model, view.sid, (s) => ({ ...s, cf: [...s.cf, rule] })));
        },
      },
    ],
  });
  queueMicrotask(sync);
}

export function filterDialog(view, c) {
  const s = view.sheet;
  const g = parseRange(s.filter.range);
  const col = c - g.c0;
  const hidden = new Set(s.filter.hide?.[col] || []);
  const values = new Map();
  for (let r = g.r0 + 1; r <= Math.min(g.r1, g.r0 + 50000); r++) {
    const text = cellLook(s, view.calc, r, c).text;
    values.set(text, (values.get(text) || 0) + 1);
  }
  const sorted = [...values.keys()].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).slice(0, 2000);
  const boxes = sorted.map((v) => h("label.of-sheet__check", h("input", { type: "checkbox", checked: !hidden.has(v) || undefined, value: v }), h("span", v === "" ? t("(empty)") : v)));
  const all = h("label.of-sheet__check", h("input", { type: "checkbox", checked: !hidden.size || undefined }), h("strong", t("Select all")));
  all.firstChild.addEventListener("change", () => boxes.forEach((b) => (b.firstChild.checked = all.firstChild.checked)));
  const sortBtn = (asc) => {
    const b = h("sl-button", { size: "small" }, asc ? t("Sort A to Z") : t("Sort Z to A"));
    b.addEventListener("click", () => {
      d.close();
      view.select(view.sel.r, c, false, false);
      view.sort(asc);
    });
    return b;
  };
  const d = openDialog({
    title: t("Filter {col}", { col: cellLook(s, view.calc, g.r0, c).text || rcKey(g.r0, c) }),
    width: 360,
    body: h("div.of-oform", h("div", { style: { display: "flex", gap: "6px" } }, sortBtn(true), sortBtn(false)), all, h("div.of-sheet__checks", boxes)),
    buttons: [
      { label: "Cancel", onClick: (cl) => cl() },
      {
        label: "Apply",
        variant: "primary",
        onClick: (close) => {
          close();
          const hide = boxes.filter((b) => !b.firstChild.checked).map((b) => b.firstChild.value);
          view.commit("Filter", M.updateSheet(view.model, view.sid, (x) => ({ ...x, filter: { ...x.filter, hide: { ...x.filter.hide, [col]: hide } } })));
        },
      },
    ],
  });
}

export function findDialog(view, replace = false) {
  const q = input("", { "aria-label": t("Find"), placeholder: t("Find") });
  const rep = input("", { "aria-label": t("Replace with"), placeholder: t("Replace with") });
  const mc = h("input", { type: "checkbox" });
  const status = h("p.of-hint", { role: "status" });
  const items = () =>
    Object.entries(view.sheet.cells)
      .filter(([, c]) => c.v !== undefined || c.f !== undefined)
      .map(([k, c]) => ({ id: k, text: c.f !== undefined ? `=${c.f}` : String(c.v) }))
      .sort((a, b) => keyRC(a.id).r - keyRC(b.id).r || keyRC(a.id).c - keyRC(b.id).c);
  let last = -1;
  const next = () => {
    const hits = findMatches(items(), q.value, { caseSensitive: mc.checked });
    if (!hits.length) return (status.textContent = t("No matches."));
    const ids = [...new Set(hits.map((x) => x.id))];
    last = (last + 1) % ids.length;
    const { r, c } = keyRC(ids[last]);
    view.select(r, c);
    status.textContent = t("{n} of {total}", { n: last + 1, total: ids.length });
  };
  q.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), next()));
  const buttons = [{ label: "Close", onClick: (c) => c() }, { label: "Find next", variant: replace ? "default" : "primary", onClick: next }];
  if (replace)
    buttons.push({
      label: "Replace all",
      variant: "primary",
      onClick: () => {
        const map = replaceMatches(items(), q.value, rep.value, { caseSensitive: mc.checked });
        if (!map.size) return (status.textContent = t("No matches."));
        const updates = {};
        for (const [k, text] of map) updates[k] = M.parseInput(text) ? { ...(M.parseInput(text).f !== undefined ? { f: M.parseInput(text).f } : { v: M.parseInput(text).v }) } : null;
        view.commit("Replace All", M.setCells(view.model, view.sid, updates));
        status.textContent = t("Replaced in {n} cells.", { n: map.size });
      },
    });
  openDialog({ title: replace ? "Find and replace" : "Find", width: 400, body: h("div.of-oform", q, replace ? rep : null, h("label.of-sheet__check", mc, h("span", t("Match case"))), status), buttons });
}

export function numberFormatDialog(view) {
  const cur = view.sheet.cells[view.a1]?.s?.nf || "General";
  const code = input(cur, { "aria-label": t("Format code") });
  const sample = h("p.of-hint", { role: "status" });
  const value = view.calc.get(view.sid, view.sel.r, view.sel.c);
  const show = () => (sample.textContent = `${t("Preview")}: ${formatCode(typeof value === "number" ? value : 1234.5678, code.value).text}`);
  code.addEventListener("input", show);
  show();
  const presets = ["General", "0", "0.00", "#,##0", "#,##0.00", '"$"#,##0.00', '#,##0.00 "€"', "0%", "0.00%", "0.00E+00", "yyyy-mm-dd", "dd.mm.yyyy", "mm/dd/yyyy", "dddd, mmmm d, yyyy", "hh:mm", "hh:mm:ss", "[h]:mm", "@"];
  const list = h("select.of-oinput", { size: "8", "aria-label": t("Presets") }, presets.map((p) => h("option", { value: p }, p)));
  list.addEventListener("change", () => ((code.value = list.value), show()));
  openDialog({
    title: "Number format",
    width: 400,
    body: h("div.of-oform", list, field("Format code", code), sample),
    buttons: [{ label: "Cancel", onClick: (c) => c() }, { label: "Apply", variant: "primary", onClick: (c) => (c(), view.setStyle({ nf: code.value === "General" ? null : code.value })) }],
  });
}
