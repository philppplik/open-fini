// Whiteboard: dialogs that create and edit rich objects (table, chart, graph, formula, sub-board). Loaded lazily by
// view.js the first time one is used (Insert menu, double-click on an object). Each dialog resolves with the props
// to apply, or null when cancelled; the view commits them as one undo step.
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { openDialog } from "../toolkit/ui.js";
import { parseCurve, cellRange } from "./objects.js";

const CHART_TYPES = [{ value: "column", label: N_("Column") }, { value: "bar", label: N_("Bar") }, { value: "line", label: N_("Line") }, { value: "area", label: N_("Area") }, { value: "pie", label: N_("Pie") }, { value: "donut", label: N_("Donut") }, { value: "scatter", label: N_("Scatter") }, { value: "radar", label: N_("Radar") }];

const field = (label, el) => h("label.of-ofield", h("span", label), el);
const tsv = (rows) => rows.map((r) => r.join("\t")).join("\n");
const parseRows = (text) => String(text).replace(/\r/g, "").split("\n").filter((l, i, a) => l.trim() || i < a.length - 1).map((l) => (l.includes("\t") ? l.split("\t") : l.split(/\s*[;|]\s*|,\s*/)));

function ask(title, body, validate) {
  return new Promise((resolve) => {
    const err = h("p.of-hint", { role: "alert", style: { color: "var(--of-danger, #c92a2a)" } });
    openDialog({
      title,
      body: h("div.of-oform", ...body, err),
      width: 520,
      onClose: () => resolve(null),
      buttons: [
        { label: t("Cancel"), onClick: (c) => (c(), resolve(null)) },
        { label: t("OK"), variant: "primary", onClick: (c) => {
          try {
            const v = validate();
            c();
            resolve(v);
          } catch (e) {
            err.textContent = e.message;
          }
        } },
      ],
    });
  });
}

/** Props for a new or edited object of `kind` ("table", "chart", "plot", "math", "portal"), or null. */
export async function objectDialog(kind, el = null) {
  if (kind === "table") {
    const ta = h("textarea.of-oinput", { rows: 8, spellcheck: "false", value: tsv(el?.rows || [["Name", "Value"], ["", ""]]) });
    ta.value = tsv(el?.rows || [["Name", "Value"], ["", ""]]);
    const head = h("sl-checkbox", { checked: el ? el.header : true }, t("First row is a header"));
    const merges = h("input.of-oinput", { value: (el?.merges || []).join(", "), placeholder: "A1:C1, B2:B3", spellcheck: "false" });
    const bold = h("input.of-oinput", { value: Object.entries(el?.styles || {}).filter(([, s]) => s.bold).map(([k]) => k).join(", "), placeholder: "A3, C5", spellcheck: "false" });
    const refs = (input) => input.value.split(/[\s,;]+/).filter(Boolean).map((x) => {
      if (!cellRange(x)) throw new Error(t("“{ref}” is not a cell or range such as B2 or A1:C1.", { ref: x }));
      return x.toUpperCase();
    });
    return ask(el ? t("Edit table") : t("Insert table"), [field(t("Cells (one row per line; separate cells with Tab, comma or |)"), ta), head, field(t("Merged cells (ranges such as A1:C1)"), merges), field(t("Bold cells"), bold)], () => {
      const rows = parseRows(ta.value);
      if (!rows.length) throw new Error(t("Enter at least one row."));
      const styles = Object.fromEntries(Object.entries(el?.styles || {}).map(([k, s]) => [k, { ...s, bold: false }]));
      for (const k of refs(bold)) styles[k] = { ...(styles[k] || {}), bold: true };
      return { rows, header: head.checked, merges: refs(merges), styles };
    });
  }
  if (kind === "chart") {
    const c = el?.chart;
    const type = h("select.of-oinput", CHART_TYPES.map((x) => h("option", { value: x.value }, t(x.label))));
    type.value = c?.type || "column";
    const title = h("input.of-oinput", { value: c?.title || "" });
    const rows = c ? [["", ...c.data.series.map((s) => s.name)], ...c.data.categories.map((cat, i) => [cat, ...c.data.series.map((s) => (s.values[i] ?? ""))])] : [["", "Series 1"], ["A", "3"], ["B", "5"], ["C", "2"]];
    const ta = h("textarea.of-oinput", { rows: 8, spellcheck: "false" });
    ta.value = tsv(rows);
    return ask(el ? t("Edit chart") : t("Insert chart"), [field(t("Chart type"), type), field(t("Chart title"), title), field(t("Data (first row: series names; first column: categories)"), ta)], () => {
      const m = parseRows(ta.value);
      if (m.length < 2 || m[0].length < 2) throw new Error(t("Enter a header row and at least one row of values."));
      const series = m[0].slice(1).map((name, k) => ({ name: name || `Series ${k + 1}`, values: m.slice(1).map((r) => (r[k + 1] === "" || r[k + 1] == null ? null : Number(String(r[k + 1]).replace(",", ".")))) }));
      return { chart: { ...(c || {}), type: type.value, title: title.value.trim(), data: { categories: m.slice(1).map((r) => r[0]), series } } };
    });
  }
  if (kind === "plot") {
    const fx = h("textarea.of-oinput", { rows: 4, spellcheck: "false" });
    fx.value = (el?.functions || [{ expr: "x^2 - 2" }]).map((f) => f.expr).join("\n");
    const pts = h("textarea.of-oinput", { rows: 3, spellcheck: "false", placeholder: "P 1 2" });
    pts.value = (el?.points || []).map((p) => `${p.label || ""} ${p.x} ${p.y}`.trim()).join("\n");
    const r = (k, d) => h("input.of-oinput", { type: "number", step: "any", value: String(el?.[k] ?? d) });
    const range = { xMin: r("xMin", -10), xMax: r("xMax", 10), yMin: r("yMin", -10), yMax: r("yMax", 10) };
    return ask(el ? t("Edit graph") : t("Insert graph"), [field(t("Graphs, one per line: y = f(x), a curve (x(t), y(t)) t = 0..2pi, or an equation in x and y"), fx), field(t("Points (optional label, x and y per line)"), pts), h("div.of-board__range", field(t("x from"), range.xMin), field(t("x to"), range.xMax), field(t("y from"), range.yMin), field(t("y to"), range.yMax))], () => {
      const functions = fx.value.split("\n").map((s) => s.trim()).filter(Boolean).map((expr, k) => {
        parseCurve(expr);
        return { expr, ...(el?.functions?.[k]?.color ? { color: el.functions[k].color } : {}) };
      });
      const points = pts.value.split("\n").map((s) => s.trim().split(/\s+/)).filter((p) => p.length >= 2 && p[0]).map((p) => {
        const [y, x] = [Number(p.at(-1)), Number(p.at(-2))];
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(t("Each point needs an x and a y number."));
        return { x, y, ...(p.length > 2 ? { label: p.slice(0, -2).join(" ") } : {}) };
      });
      const v = Object.fromEntries(Object.entries(range).map(([k, i]) => [k, Number(i.value)]));
      if (!(v.xMax > v.xMin) || !(v.yMax > v.yMin)) throw new Error(t("Each range needs a larger “to” than “from”."));
      return { functions, points, ...v };
    });
  }
  if (kind === "math") {
    const ta = h("textarea.of-oinput", { rows: 3, spellcheck: "false", placeholder: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" });
    ta.value = el?.tex || "";
    return ask(el ? t("Edit formula") : t("Insert formula"), [field(t("Formula (TeX: \\frac{a}{b}, \\sqrt{x}, x^{2}, x_{i}, \\alpha, \\sum, \\le, \\left( \\right), \\begin{pmatrix} … \\end{pmatrix} …)"), ta)], () => {
      if (!ta.value.trim()) throw new Error(t("Enter a formula."));
      return { tex: ta.value.trim() };
    });
  }
  if (kind === "portal") {
    const name = h("input.of-oinput", { value: el?.name || t("Details") });
    return ask(el ? t("Rename sub-board") : t("Insert sub-board"), [field(t("Name"), name)], () => ({ name: name.value.trim() || t("Sub-board") }));
  }
  return null;
}
