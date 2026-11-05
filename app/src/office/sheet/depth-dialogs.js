// Dialogs of the Spreadsheet depth features (lazy, loaded by SheetView ▸ depth()): format as table, data validation,
// named ranges, paste special, page setup and print, pivot table, sparklines, the validation list picker and row/column
// groups. The model work is in depth.js; each action is one undo step through view.commit.
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { openDialog } from "../toolkit/ui.js";
import { formatRange } from "../toolkit/selection.js";
import * as D from "./depth.js";
import { cellLook, sheetPages } from "./render.js";
import { rcKey } from "./formula.js";

const field = (label, control) => h("label.of-ofield", h("span", t(label)), control);
const input = (value = "", attrs = {}) => h("input.of-oinput", { value: String(value ?? ""), spellcheck: "false", ...attrs });
const select = (options, value) => h("select.of-oinput", options.map(([v, l]) => h("option", { value: v, selected: v === value || undefined }, t(l))));
const check = (label, on = false) => {
  const box = h("input", { type: "checkbox", checked: on || undefined });
  return { box, el: h("label.of-sheet__check", box, h("span", t(label))) };
};
const sel = (view) => formatRange(view.clampRange(view.range));
/** Runs a model change and reports its error as a toast instead of closing the dialog. */
const attempt = (view, close, label, fn) => {
  try {
    const next = fn();
    close();
    view.commit(label, next);
  } catch (err) {
    view.app.toast(err.message, "warning", 5000);
  }
};

export function tableDialog(view) {
  const existing = D.tableAt(view.sheet, view.sel.r, view.sel.c);
  const rangeIn = input(existing?.range || formatRange(view.range.r0 === view.range.r1 && view.range.c0 === view.range.c1 ? currentRegion(view) : view.clampRange(view.range)), { "aria-label": t("Table range") });
  const style = select([["blue", N_("Blue")], ["green", N_("Green")], ["orange", N_("Orange")], ["gray", N_("Gray")], ["light", N_("Light")]], existing?.style || "blue");
  const header = check(N_("First row is a header"), existing ? existing.header : true);
  const banded = check(N_("Banded rows"), existing ? existing.banded : true);
  const total = check(N_("Total row"), existing?.total || false);
  if (existing) rangeIn.disabled = true;
  const buttons = [{ label: "Cancel", onClick: (c) => c() }];
  if (existing) buttons.push({ label: "Remove table", onClick: (close) => attempt(view, close, "Remove Table", () => D.removeTable(view.model, view.sid, existing.id)) });
  buttons.push({
    label: existing ? "Apply" : "Format as table",
    variant: "primary",
    onClick: (close) =>
      attempt(view, close, "Format as Table", () =>
        existing
          ? D.updateTable(view.model, view.sid, existing.id, { style: style.value, header: header.box.checked, banded: banded.box.checked })
          : D.addTable(view.model, view.sid, { range: rangeIn.value, style: style.value, header: header.box.checked, banded: banded.box.checked, total: total.box.checked })),
  });
  if (existing) total.el.hidden = true;
  openDialog({ title: "Format as table", width: 420, body: h("div.of-oform", field(N_("Table range"), rangeIn), field(N_("Style"), style), header.el, banded.el, total.el), buttons });
}

function currentRegion(view) {
  const sheet = view.sheet;
  // the block of filled cells around the cursor (like Ctrl+A)
  const filled = (r, c) => {
    const x = sheet.cells[rcKey(r, c)];
    return !!x && (x.v !== undefined || x.f !== undefined);
  };
  if (!filled(view.sel.r, view.sel.c)) return view.clampRange(view.range);
  let g = { r0: view.sel.r, c0: view.sel.c, r1: view.sel.r, c1: view.sel.c };
  const grow = () => {
    let any = false;
    const row = (r) => r >= 0 && Array.from({ length: g.c1 - g.c0 + 1 }, (_, i) => g.c0 + i).some((c) => filled(r, c));
    const col = (c) => c >= 0 && Array.from({ length: g.r1 - g.r0 + 1 }, (_, i) => g.r0 + i).some((r) => filled(r, c));
    if (row(g.r0 - 1)) (g.r0 -= 1), (any = true);
    if (row(g.r1 + 1)) (g.r1 += 1), (any = true);
    if (col(g.c0 - 1)) (g.c0 -= 1), (any = true);
    if (col(g.c1 + 1)) (g.c1 += 1), (any = true);
    return any;
  };
  for (let i = 0; i < 500 && grow(); i++);
  return g;
}

export function validationDialog(view) {
  const rule = D.validationAt(view.sheet, view.sel.r, view.sel.c);
  const rangeIn = input(rule?.range || sel(view), { "aria-label": t("Apply to range") });
  const type = select([["list", N_("List of values")], ["number", N_("Number")], ["integer", N_("Whole number")], ["textLength", N_("Text length")]], rule?.type || "list");
  const items = input(rule?.list?.join(", ") || rule?.source || "", { placeholder: t("Red, Green, Blue or Sheet1!A1:A10"), "aria-label": t("Items or source range") });
  const min = input(rule?.min ?? "", { "aria-label": t("Minimum"), inputmode: "decimal" });
  const max = input(rule?.max ?? "", { "aria-label": t("Maximum"), inputmode: "decimal" });
  const msg = input(rule?.message || "", { "aria-label": t("Error message") });
  const blank = check(N_("Allow blank cells"), rule ? rule.allowBlank !== false : true);
  const sync = () => {
    items.closest("label").hidden = type.value !== "list";
    min.closest("label").hidden = max.closest("label").hidden = type.value === "list";
  };
  type.addEventListener("change", sync);
  openDialog({
    title: "Data validation",
    width: 440,
    body: h("div.of-oform", field(N_("Apply to range"), rangeIn), field(N_("Allow"), type), field(N_("Items or source range"), items), field(N_("Minimum"), min), field(N_("Maximum"), max), field(N_("Error message"), msg), blank.el),
    buttons: [
      { label: "Clear validation", onClick: (close) => attempt(view, close, "Clear Validation", () => D.clearValidation(view.model, view.sid, rangeIn.value)) },
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Apply",
        variant: "primary",
        onClick: (close) =>
          attempt(view, close, "Data Validation", () => {
            const text = items.value.trim();
            const isRange = /^(?:'[^']+'!|[\w.]+!)?\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?$/.test(text);
            return D.addValidation(view.model, view.sid, {
              range: rangeIn.value,
              type: type.value,
              ...(type.value === "list" ? (isRange ? { source: text.includes("!") ? text : `${view.sheet.name}!${text}` } : { list: text.split(/\s*[,;]\s*/).filter(Boolean) }) : { min: min.value, max: max.value }),
              allowBlank: blank.box.checked,
              message: msg.value.trim(),
            });
          }),
      },
    ],
  });
  queueMicrotask(sync);
}

/** The drop-down of a list-validated cell: pick an item to enter it. */
export function listPicker(view) {
  const s = view.sheet;
  const rule = D.validationAt(s, view.sel.r, view.sel.c);
  const items = D.listItems(view.model, s, rule, (sid, r, c) => view.calc.get(sid, r, c));
  if (!items.length) return view.app.toast(t("The list of this cell is empty."), "warning", 3000);
  view.listEl?.remove();
  const b = view.cellRect(view.sel.r, view.sel.c);
  const z = view.zoom;
  const current = cellLook(s, view.calc, view.sel.r, view.sel.c).text;
  const close = () => {
    menu.remove();
    view.listEl = null;
    view.focus();
  };
  const pick = (text) => {
    close();
    view.commitInput(text, null);
  };
  const menu = h("div.of-sheet__list", { role: "listbox", "aria-label": t("Allowed values"), tabindex: "-1" }, items.map((it) => {
    const opt = h("div.of-sheet__list-item", { role: "option", tabindex: "-1", "aria-selected": String(it === current) }, it);
    opt.addEventListener("click", () => pick(it));
    return opt;
  }));
  Object.assign(menu.style, { left: `${b.x * z}px`, top: `${(b.y + b.h) * z}px`, minWidth: `${Math.max(120, b.w * z)}px` });
  menu.addEventListener("keydown", (e) => {
    const opts = [...menu.children];
    const i = opts.indexOf(document.activeElement);
    if (e.key === "Escape") return e.preventDefault(), close();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      opts[Math.max(0, Math.min(opts.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    }
    if (e.key === "Enter" && i >= 0) e.preventDefault(), pick(items[i]);
  });
  menu.addEventListener("focusout", (e) => {
    if (!menu.contains(e.relatedTarget)) setTimeout(() => menu.isConnected && close(), 0);
  });
  view.gridEl.append(menu);
  view.listEl = menu;
  (menu.querySelector('[aria-selected="true"]') || menu.firstElementChild)?.focus();
}

export function namesDialog(view) {
  const names = Object.entries(view.model.names || {});
  const nameIn = input("", { "aria-label": t("Name"), placeholder: "TaxRate" });
  const refIn = input(`${view.sheet.name}!${sel(view).replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}`, { "aria-label": t("Refers to") });
  const list = h("ul.of-sheet__rules", names.map(([n, ref]) => {
    const del = h("button.of-tk-btn", { type: "button", "aria-label": t("Delete name") }, h("sl-icon", { name: "trash" }));
    del.addEventListener("click", () => {
      view.commit("Delete Name", D.deleteName(view.model, n));
      del.closest("li").remove();
    });
    const go = h("button.of-tk-btn", { type: "button" }, `${n} = ${ref}`);
    go.addEventListener("click", () => {
      nameIn.value = n;
      refIn.value = ref;
    });
    return h("li", go, del);
  }));
  openDialog({
    title: "Named ranges",
    width: 460,
    body: h("div.of-oform", names.length ? h("div", h("strong", t("Names of this workbook")), list) : h("p", t("Names make formulas easier to read: =SUM(Sales)*TaxRate.")), field(N_("Name"), nameIn), field(N_("Refers to"), refIn)),
    buttons: [
      { label: "Close", onClick: (c) => c() },
      { label: "Save name", variant: "primary", onClick: (close) => attempt(view, close, "Define Name", () => D.setName(view.model, nameIn.value.trim(), refIn.value.trim())) },
    ],
  });
}

export function pasteSpecialDialog(view) {
  const clip = view.clip;
  if (!clip) return view.app.toast(t("Copy cells in this spreadsheet first (Paste Special works with cells copied here)."), "warning", 4000);
  const what = select([["all", N_("All")], ["values", N_("Values")], ["formulas", N_("Formulas")], ["formats", N_("Formats")]], "values");
  const op = select([["none", N_("None")], ["add", N_("Add")], ["sub", N_("Subtract")], ["mul", N_("Multiply")], ["div", N_("Divide")]], "none");
  const skip = check(N_("Skip blanks"));
  const transpose = check(N_("Transpose"));
  openDialog({
    title: "Paste special",
    width: 380,
    body: h("div.of-oform", field(N_("Paste"), what), field(N_("Operation"), op), skip.el, transpose.el),
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Paste",
        variant: "primary",
        onClick: (close) => {
          const at = { r: view.range.r0, c: view.range.c0 };
          attempt(view, close, "Paste Special", () => D.pasteSpecial(view.model, view.sid, at.r, at.c, clip, { paste: what.value === "formulas" ? "formulas" : what.value, op: op.value, skipBlanks: skip.box.checked, transpose: transpose.box.checked }));
        },
      },
    ],
  });
}

export function pageSetupDialog(view) {
  const p = { orientation: "portrait", paper: "a4", margin: 48, gridlines: true, fit: "none", ...(view.sheet.page || {}) };
  const orientation = select([["portrait", N_("Portrait")], ["landscape", N_("Landscape")]], p.orientation);
  const paper = select([["a4", N_("A4")], ["letter", N_("Letter")]], p.paper);
  const margin = select([["24", N_("Narrow")], ["48", N_("Normal")], ["96", N_("Wide")]], String(p.margin));
  const area = input(p.printArea || "", { placeholder: t("Whole sheet"), "aria-label": t("Print area") });
  const grid = check(N_("Print gridlines"), p.gridlines);
  const fit = check(N_("Fit to one page"), p.fit === "page");
  const useSel = h("button.of-tk-btn", { type: "button" }, t("Use the selection"));
  useSel.addEventListener("click", () => (area.value = sel(view)));
  const apply = () => D.setPageSetup(view.model, view.sid, { orientation: orientation.value, paper: paper.value, margin: Number(margin.value), printArea: area.value.trim() || null, gridlines: grid.box.checked, fit: fit.box.checked ? "page" : "none" });
  openDialog({
    title: "Page setup",
    width: 420,
    body: h("div.of-oform", field(N_("Orientation"), orientation), field(N_("Paper"), paper), field(N_("Margins"), margin), field(N_("Print area"), area), useSel, grid.el, fit.el),
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      { label: "Print…", onClick: (close) => (attempt(view, close, "Page Setup", apply), printSheet(view)) },
      { label: "Apply", variant: "primary", onClick: (close) => attempt(view, close, "Page Setup", apply) },
    ],
  });
}

/** Prints the active sheet with its page setup: pages are rendered to images in a hidden frame, then printed. */
export async function printSheet(view) {
  const [{ measurer }, { renderToCanvas }] = await Promise.all([import("../../core/fonts.js"), import("../../engine/backends/canvas.js")]);
  const s = view.sheet;
  const opts = D.printOptions(s);
  const pages = sheetPages(view.model, s.id, view.calc, { measurer, ...opts });
  const urls = pages.map((pg) => renderToCanvas(pg, { scale: 2, bg: "#ffffff", width: Math.round(pg.width * 2), height: Math.round(pg.height * 2) }).toDataURL("image/png"));
  const frame = h("iframe", { title: t("Print"), "aria-hidden": "true", style: "position:fixed;right:0;bottom:0;width:0;height:0;border:0" });
  document.body.append(frame);
  const d = frame.contentDocument;
  const landscape = opts.page.w > opts.page.h;
  d.open();
  d.write(`<!doctype html><title>${s.name.replace(/[<&]/g, "")}</title><style>@page{size:${landscape ? "landscape" : "portrait"};margin:0}body{margin:0}img{display:block;width:100%;page-break-after:always}</style>`);
  d.close();
  for (const u of urls) d.body.append(Object.assign(d.createElement("img"), { src: u, alt: "" }));
  await Promise.all([...d.images].map((img) => (img.complete ? null : new Promise((ok) => (img.onload = img.onerror = ok)))));
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60000);
}

export function pivotDialog(view) {
  const g = view.range.r0 === view.range.r1 && view.range.c0 === view.range.c1 ? currentRegion(view) : view.clampRange(view.range);
  const heads = [];
  for (let c = g.c0; c <= g.c1; c++) heads.push(cellLook(view.sheet, view.calc, g.r0, c).text);
  const opts = heads.map((x) => [x, x]).filter(([x]) => x);
  const rangeIn = input(formatRange(g), { "aria-label": t("Source range") });
  const rows = select(opts, opts[0]?.[0]);
  const cols = select([["", N_("(none)")], ...opts], "");
  const vals = select(opts, opts[opts.length - 1]?.[0]);
  const agg = select([["sum", N_("Sum")], ["count", N_("Count")], ["average", N_("Average")], ["min", N_("Minimum")], ["max", N_("Maximum")]], "sum");
  openDialog({
    title: "Pivot table",
    width: 420,
    body: h("div.of-oform", h("p", t("Summarizes a table with a header row on a new sheet. It does not update by itself; run it again after changes.")), field(N_("Source range"), rangeIn), field(N_("Rows"), rows), field(N_("Columns"), cols), field(N_("Values"), vals), field(N_("Summarize by"), agg)),
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Create",
        variant: "primary",
        onClick: (close) =>
          attempt(view, close, "Pivot Table", () => {
            const table = D.pivot(view.model, view.sheet, (sid, r, c) => view.calc.get(sid, r, c), { range: rangeIn.value, rows: rows.value, columns: cols.value || null, values: vals.value, agg: agg.value });
            const next = D.writePivot(view.model, view.sid, table, { name: "Pivot" });
            queueMicrotask(() => view.showSheet(next.active));
            return next;
          }),
      },
    ],
  });
}

export function sparklineDialog(view) {
  const g = view.clampRange(view.range);
  const rangeIn = input(formatRange(g), { "aria-label": t("Data range") });
  const at = input(rcKey(g.r0, g.c1 + 1), { "aria-label": t("Location") });
  const type = select([["line", N_("Line")], ["column", N_("Column")]], "line");
  const color = h("input", { type: "color", value: "#2563eb", "aria-label": t("Color") });
  const existing = D.sparklineAt(view.sheet, view.sel.r, view.sel.c);
  const buttons = [{ label: "Cancel", onClick: (c) => c() }];
  if (existing) buttons.unshift({ label: "Remove sparkline", onClick: (close) => attempt(view, close, "Remove Sparkline", () => D.removeSparklines(view.model, view.sid, existing.cell)) });
  buttons.push({ label: "Insert", variant: "primary", onClick: (close) => attempt(view, close, "Insert Sparkline", () => D.addSparkline(view.model, view.sid, { cell: at.value, range: rangeIn.value, type: type.value, color: color.value })) });
  openDialog({ title: "Sparkline", width: 400, body: h("div.of-oform", field(N_("Data range"), rangeIn), field(N_("Location"), at), field(N_("Type"), type), field(N_("Color"), color)), buttons });
}

/** Groups (on) or ungroups the selected rows or columns. */
export function groupSelection(view, axis, on) {
  const g = view.clampRange(view.range);
  const [a, b] = axis === "row" ? [g.r0, g.r1] : [g.c0, g.c1];
  view.commit(on ? "Group" : "Ungroup", on ? D.group(view.model, view.sid, axis, a, b) : D.ungroup(view.model, view.sid, axis, a, b));
}

/** Collapses or expands the groups around the cursor (`all` = every group of the sheet). */
export function collapseGroups(view, collapsed, all = false) {
  let next = view.model;
  for (const axis of ["row", "col"]) next = D.setCollapsed(next, view.sid, axis, all ? null : axis === "row" ? view.sel.r : view.sel.c, collapsed);
  if (next === view.model) return;
  view.commit(collapsed ? "Collapse Group" : "Expand Group", next);
}
