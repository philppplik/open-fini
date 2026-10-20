// A small spreadsheet-like data grid: type into cells, paste CSV / TSV / HTML tables from the clipboard, add and
// remove rows and columns. Used by the chart data dialog.
import { h, empty } from "../../core/util.js";
import { iconButton } from "../controls.js";
import { colName } from "../../engine/layout/format.js";
import { parseHtmlTable, parseTextMatrix } from "../../engine/layout/table-model.js";

/**
 * @param {{matrix?:(string|number)[][], readOnly?:boolean, onChange?:(m:string[][])=>void, maxRows?:number, maxCols?:number}} [o]
 */
export function createDataGrid({ matrix = [[""]], readOnly = false, onChange, maxRows = 500, maxCols = 40 } = {}) {
  let data = normalize(matrix);
  let focus = [0, 0];
  const table = h("table.of-grid", { role: "grid" });
  const wrap = h("div.of-grid__scroll", table);
  const bar = h(
    "div.of-grid__bar",
    iconButton({ icon: "plus-lg", label: "Add row", onClick: () => addRow() }),
    h("span.of-grid__barlabel", "Row"),
    iconButton({ icon: "dash-lg", label: "Delete the current row", onClick: () => removeRow(focus[0]) }),
    h("span.of-grid__sep"),
    iconButton({ icon: "plus-lg", label: "Add column", onClick: () => addCol() }),
    h("span.of-grid__barlabel", "Column"),
    iconButton({ icon: "dash-lg", label: "Delete the current column", onClick: () => removeCol(focus[1]) }),
  );
  if (readOnly) bar.classList.add("hidden");
  const el = h("div.of-gridwrap", bar, wrap);

  function normalize(m) {
    const rows = Math.max(1, m.length);
    const cols = Math.max(1, ...m.map((r) => r.length));
    return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (m[r] && m[r][c] != null ? String(m[r][c]) : "")));
  }
  const changed = () => onChange?.(data.map((r) => r.slice()));

  function input(r, c) {
    const inp = h("input.of-grid__cell", { type: "text", value: data[r][c], readOnly, spellcheck: false, "aria-label": `${colName(c)}${r + 1}`, class: r === 0 ? "head" : c === 0 ? "label" : "" });
    inp.addEventListener("focus", () => (focus = [r, c]));
    inp.addEventListener("input", () => {
      data[r][c] = inp.value;
      changed();
    });
    inp.addEventListener("keydown", (e) => {
      const go = (dr, dc) => {
        e.preventDefault();
        table.querySelector(`input[data-pos="${r + dr}:${c + dc}"]`)?.focus();
      };
      if (e.key === "Enter") go(e.shiftKey ? -1 : 1, 0);
      else if (e.key === "ArrowDown") go(1, 0);
      else if (e.key === "ArrowUp") go(-1, 0);
      else if (e.key === "ArrowRight" && inp.selectionStart === inp.value.length && inp.selectionEnd === inp.value.length) go(0, 1);
      else if (e.key === "ArrowLeft" && inp.selectionStart === 0 && inp.selectionEnd === 0) go(0, -1);
    });
    inp.addEventListener("paste", (e) => {
      if (readOnly) return;
      const cd = e.clipboardData;
      if (!cd) return;
      const html = cd.getData("text/html");
      const text = cd.getData("text/plain");
      const m = (html && parseHtmlTable(html)) || (text && /[\t\n]/.test(text.trim()) ? parseTextMatrix(text, { delimiter: text.includes("\t") ? "\t" : "auto" }) : null);
      if (!m || (m.length === 1 && m[0].length === 1)) return;
      e.preventDefault();
      paste(r, c, m);
    });
    inp.dataset.pos = `${r}:${c}`;
    return inp;
  }

  function render() {
    empty(table);
    const head = h("tr", h("th.of-grid__corner"));
    for (let c = 0; c < data[0].length; c++) head.append(h("th.of-grid__colhead", colName(c)));
    table.append(h("thead", head));
    const body = h("tbody");
    data.forEach((row, r) => {
      const tr = h("tr", h("th.of-grid__rowhead", String(r + 1)));
      row.forEach((_, c) => tr.append(h("td", input(r, c))));
      body.append(tr);
    });
    table.append(body);
  }

  function paste(r0, c0, m) {
    const rows = Math.min(maxRows, Math.max(data.length, r0 + m.length));
    const cols = Math.min(maxCols, Math.max(data[0].length, c0 + Math.max(...m.map((x) => x.length))));
    data = normalize(Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (data[r] && data[r][c]) || "")));
    m.forEach((row, i) => row.forEach((v, j) => {
      if (r0 + i < rows && c0 + j < cols) data[r0 + i][c0 + j] = String(v);
    }));
    render();
    changed();
  }
  function addRow() {
    if (data.length >= maxRows) return;
    data.push(Array(data[0].length).fill(""));
    render();
    changed();
    table.querySelector(`input[data-pos="${data.length - 1}:0"]`)?.focus();
  }
  function addCol() {
    if (data[0].length >= maxCols) return;
    for (const r of data) r.push("");
    render();
    changed();
    table.querySelector(`input[data-pos="0:${data[0].length - 1}"]`)?.focus();
  }
  function removeRow(i) {
    if (data.length <= 1) return;
    data.splice(Math.min(i, data.length - 1), 1);
    focus = [Math.min(focus[0], data.length - 1), focus[1]];
    render();
    changed();
  }
  function removeCol(j) {
    if (data[0].length <= 1) return;
    for (const r of data) r.splice(Math.min(j, r.length - 1), 1);
    focus = [focus[0], Math.min(focus[1], data[0].length - 1)];
    render();
    changed();
  }
  render();
  return {
    el,
    get: () => data.map((r) => r.slice()),
    set(m) {
      data = normalize(m);
      render();
    },
    paste: (m) => paste(focus[0], focus[1], m),
    focusFirst: () => table.querySelector("input")?.focus(),
  };
}
