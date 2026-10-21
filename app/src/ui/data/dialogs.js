// Dialogs for tables and charts: Insert (table / chart gallery), Import CSV, Chart data editor.
import { h, empty } from "../../core/util.js";
import { openDialog } from "../dialogs.js";
import { numField, selectField, switchField, button, segmented } from "../controls.js";
import { createDataGrid } from "./data-grid.js";
import { measurer } from "../../core/fonts.js";
import { renderToCanvas } from "../../engine/backends/canvas.js";
import { createTable, parseTextMatrix } from "../../engine/layout/table-model.js";
import { renderTable } from "../../engine/layout/table-render.js";
import { PRESET_IDS, TABLE_PRESETS } from "../../engine/layout/table-styles.js";
import { CHART_PRESETS, PALETTE_IDS, PALETTES, chartFromPreset, dataToMatrix, matrixToData, resolveData, normalizeChart } from "../../engine/layout/chart-data.js";
import { renderChart } from "../../engine/layout/chart-render.js";
import { addTableNode, addChartNode, editChart, listTables, linkChart, setChartMatrix, isTable } from "../../core/data-nodes.js";
import * as A from "../../core/table-actions.js";
import { platform } from "../../platform/index.js";

const decodeText = (bytes) => new TextDecoder().decode(bytes);

function drawThumb(items, w, h2, bg = "#ffffff", maxW = 150, maxH = 100) {
  const s = Math.min(maxW / w, maxH / h2, 1.5);
  const c = renderToCanvas({ width: w, height: h2, items }, { scale: s, width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h2 * s)), bg });
  c.className = "of-thumb__img";
  return c;
}

function chartThumb(preset, palette) {
  const chart = chartFromPreset(preset.id, palette ? { options: { palette } } : {});
  const w = 300;
  const hh = chart.type === "progress" ? 90 : chart.type === "sparkline" ? 100 : chart.type === "kpi" ? 170 : chart.type === "ring" ? 220 : 190;
  return drawThumb(renderChart(chart, chart.data, w, hh, measurer).items, w, hh);
}

function tableStyleOptions(app) {
  const saved = Object.entries(app.doc?.tableStyles || {}).map(([id, s]) => ({ value: id, label: `${s.name} (saved)` }));
  return [...PRESET_IDS.map((id) => ({ value: id, label: TABLE_PRESETS[id].name })), ...saved];
}

// ------------------------------------------------------------------------------------------------ insert

export function insertDialog(app, tab = "table") {
  const st = { tab, rows: 4, cols: 3, headerRows: 1, headerCols: 0, width: Math.min(app.page.w - 80, 560), style: "clean", preset: "column", palette: "default", link: false };
  const sel = app.selection.length === 1 && isTable(app.selection[0]) ? app.selection[0] : null;
  const body = h("div.of-datadlg");
  const pane = h("div.of-datadlg__pane");
  const seg = segmented([{ value: "table", label: "Table", text: "Table" }, { value: "chart", label: "Chart", text: "Chart" }], st.tab, (v) => {
    st.tab = v;
    render();
  });
  body.append(seg.el, pane);

  function tablePane() {
    const preview = h("div.of-datadlg__preview");
    const draw = () => {
      empty(preview);
      try {
        const t = createTable({ rows: Math.min(st.rows, 5), cols: Math.min(st.cols, 4), headerRows: Math.min(st.headerRows, 2), headerCols: st.headerCols, width: 300, rowHeight: 30, style: st.style, savedStyles: app.doc.tableStyles });
        for (let r = st.headerRows; r < t.rows.length; r++) for (let c = 0; c < t.cols.length; c++) t.cells[r][c].v = String((r + 1) * (c + 2) * 3);
        const { layout, items } = renderTable(t, measurer);
        preview.append(drawThumb(items, layout.w, layout.h, "#ffffff", 320, 160));
      } catch {
        /* preview is optional */
      }
    };
    const rows = numField({ label: "Rows", value: st.rows, min: 1, max: 100, precision: 0, wide: true, onChange: (v) => ((st.rows = Math.round(v)), draw()) });
    const cols = numField({ label: "Columns", value: st.cols, min: 1, max: 30, precision: 0, wide: true, onChange: (v) => ((st.cols = Math.round(v)), draw()) });
    const hr = numField({ label: "Header rows", value: st.headerRows, min: 0, max: 3, precision: 0, wide: true, onChange: (v) => ((st.headerRows = Math.round(v)), draw()) });
    const hc = numField({ label: "Header columns", value: st.headerCols, min: 0, max: 3, precision: 0, wide: true, onChange: (v) => ((st.headerCols = Math.round(v)), draw()) });
    const w = numField({ label: "Width", value: st.width, min: 80, unit: "px", precision: 0, wide: true, onChange: (v) => (st.width = v) });
    const style = selectField({ label: "Style", value: st.style, options: tableStyleOptions(app), onChange: (v) => ((st.style = v), draw()) });
    draw();
    return h("div.of-form", h("div.of-row", rows.el, cols.el), h("div.of-row", hr.el, hc.el), w.el, style.el, preview, h("p.of-hint", "Click a cell to type. Tab and the arrow keys move between cells; drag the cell borders to resize. Start a cell with = for a formula such as =SUM(B2:B5)."));
  }

  function chartPane() {
    const grid = h("div.of-gallery", { role: "listbox", "aria-label": "Chart presets" });
    const cards = [];
    const fill = () => {
      empty(grid);
      cards.length = 0;
      for (const p of CHART_PRESETS) {
        const b = h("button.of-gallery__card", { type: "button", role: "option", "aria-selected": String(p.id === st.preset), title: p.name }, chartThumb(p, st.palette), h("span", p.name));
        b.addEventListener("click", () => {
          st.preset = p.id;
          cards.forEach((c, i) => c.setAttribute("aria-selected", String(CHART_PRESETS[i].id === st.preset)));
        });
        b.addEventListener("dblclick", () => document.querySelector(".of-datadlg")?.closest("sl-dialog")?.querySelector("[slot=footer] sl-button[variant=primary]")?.click());
        cards.push(b);
        grid.append(b);
      }
    };
    fill();
    const pal = selectField({ label: "Colors", value: st.palette, options: PALETTE_IDS.map((id) => ({ value: id, label: `${id[0].toUpperCase()}${id.slice(1)}` })), onChange: (v) => ((st.palette = v), fill()) });
    const swatches = h("div.of-datadlg__swatches", PALETTES[st.palette].map((c) => h("span", { style: { background: c } })));
    pal.select.addEventListener("sl-change", () => swatches.replaceChildren(...PALETTES[st.palette].map((c) => h("span", { style: { background: c } }))));
    const parts = [grid, h("div.of-row", pal.el, swatches)];
    if (sel) {
      const sw = switchField({ label: `Use data from “${sel.name}” (stays linked)`, value: st.link, onChange: (v) => (st.link = v) });
      parts.push(sw.el);
    }
    parts.push(h("p.of-hint", "You can change the type, colors and data afterwards in the Data panel, or double-click the chart to edit its data."));
    return h("div.of-form", ...parts);
  }

  function render() {
    empty(pane);
    pane.append(st.tab === "table" ? tablePane() : chartPane());
  }
  render();

  openDialog({
    title: "Insert Table or Chart",
    body,
    width: 660,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Insert",
        variant: "primary",
        onClick: (close) => {
          close();
          if (st.tab === "table") {
            const node = addTableNode(app, { rows: st.rows, cols: st.cols, headerRows: st.headerRows, headerCols: st.headerCols, width: st.width, style: st.style });
            app.setTool("table");
            A.setTableSel(app, node, Math.min(st.headerRows, st.rows - 1), 0);
          } else {
            const options = { palette: st.palette };
            const node = addChartNode(app, { preset: st.preset, options });
            if (sel && st.link) editChart(app.doc, node, (c) => {
              linkChart(c, sel);
              c.options.numFmt = null; // the preset's sample number format does not fit the user's data
            });
            app.select([node]);
          }
          app.emit("revealpanel", "data");
        },
      },
    ],
  });
}

// ------------------------------------------------------------------------------------------------ import CSV

export function importTableDialog(app) {
  const st = { text: "", delimiter: "auto", header: true, mode: "new" };
  const target = A.activeTable(app);
  const area = h("textarea.of-importarea", { rows: 8, placeholder: "Paste CSV or TSV text here, or load a file…", spellcheck: false, "aria-label": "CSV or TSV text" });
  const info = h("div.of-hint");
  const grid = h("div.of-importgrid");
  const update = () => {
    st.text = area.value;
    empty(grid);
    if (!st.text.trim()) return (info.textContent = "");
    const m = parseTextMatrix(st.text, { delimiter: st.delimiter });
    info.textContent = `${m.length} rows × ${m[0]?.length || 0} columns`;
    const g = createDataGrid({ matrix: m.slice(0, 8), readOnly: true });
    grid.append(g.el);
  };
  area.addEventListener("input", update);
  const load = button("Load file…", async () => {
    const files = await platform.openFiles({ accept: [{ name: "Data files", extensions: ["csv", "tsv", "txt"] }], multiple: false });
    if (!files.length) return;
    area.value = decodeText(files[0].bytes);
    update();
  });
  const delim = selectField({ label: "Delimiter", value: "auto", options: [{ value: "auto", label: "Detect" }, { value: ",", label: "Comma" }, { value: ";", label: "Semicolon" }, { value: "\t", label: "Tab" }, { value: "|", label: "Pipe" }], onChange: (v) => ((st.delimiter = v), update()) });
  const header = switchField({ label: "First row is a header", value: true, onChange: (v) => (st.header = v) });
  const mode = target ? selectField({ label: "Import as", value: "new", options: [{ value: "new", label: "A new table" }, { value: "replace", label: `Replace the data of “${target.name}”` }], onChange: (v) => (st.mode = v) }) : null;
  openDialog({
    title: "Import CSV / TSV",
    width: 620,
    body: h("div.of-form", h("div.of-row", load, delim.el), area, info, grid, header.el, mode?.el || null),
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Import",
        variant: "primary",
        onClick: (close) => {
          if (!st.text.trim()) return app.toast("Load a file or paste some text first.", "warning");
          const m = parseTextMatrix(st.text, { delimiter: st.delimiter });
          if (!m.length) return app.toast("No rows found.", "warning");
          close();
          if (st.mode === "replace" && target) A.replaceTableData(app, m, { header: st.header });
          else {
            const node = A.tableFromMatrix(app, m, { header: st.header });
            app.select([node]);
          }
          app.emit("revealpanel", "data");
        },
      },
    ],
  });
}

// ------------------------------------------------------------------------------------------------ chart data

export function chartDataDialog(app, node) {
  if (!node || node.type !== "chart") return;
  const doc = app.doc;
  const chart = normalizeChart(node.chart);
  const st = { source: chart.source ? { ...chart.source } : null };
  const tables = listTables(doc);
  const gridHost = h("div.of-datadlg__grid");
  const linkBox = h("div.of-form");
  let grid = null;
  const showGrid = () => {
    empty(gridHost);
    let matrix;
    let readOnly = false;
    if (st.source) {
      const t = doc.find(st.source.tableId);
      const res = resolveData({ ...chart, source: st.source }, (id) => (doc.find(id)?.type === "table" ? doc.find(id) : null));
      matrix = dataToMatrix(res.data);
      readOnly = true;
      gridHost.append(h("p.of-hint", t ? `Linked to “${t.name}”. Edit the table (on the page) and the chart follows. Switch to “Own data” to edit here.` : "The linked table no longer exists. Switch to “Own data”."));
    } else matrix = dataToMatrix(chart.data);
    grid = createDataGrid({ matrix, readOnly });
    gridHost.append(grid.el);
  };
  const srcSel = selectField({
    label: "Data source",
    value: st.source ? st.source.tableId : "",
    options: [{ value: "", label: "Own data (edit below)" }, ...tables.map((t) => ({ value: t.id, label: `Table: ${t.name} (${t.rows}×${t.cols}, page ${t.page})` }))],
    onChange: (v) => {
      if (grid && !st.source) chart.data = matrixToData(grid.get());
      st.source = v ? { tableId: v, seriesIn: "columns", header: true, labelCol: true, ...(st.source?.range ? { range: st.source.range } : {}) } : null;
      renderLink();
      showGrid();
    },
  });
  function renderLink() {
    empty(linkBox);
    if (!st.source) return;
    const range = h("sl-input", { size: "small", label: "Range (optional, e.g. A1:D6)", value: st.source.range || "", placeholder: "whole table" });
    range.addEventListener("sl-change", () => {
      st.source.range = range.value.trim() || undefined;
      if (!st.source.range) delete st.source.range;
      showGrid();
    });
    const dir = selectField({ label: "Series are in", value: st.source.seriesIn, options: [{ value: "columns", label: "Columns" }, { value: "rows", label: "Rows" }], onChange: (v) => ((st.source.seriesIn = v), showGrid()) });
    const hd = switchField({ label: "First row = series names", value: st.source.header !== false, onChange: (v) => ((st.source.header = v), showGrid()) });
    const lc = switchField({ label: "First column = categories", value: st.source.labelCol !== false, onChange: (v) => ((st.source.labelCol = v), showGrid()) });
    linkBox.append(range, dir.el, hd.el, lc.el);
  }
  const importBtn = button("Import CSV…", async () => {
    const files = await platform.openFiles({ accept: [{ name: "Data files", extensions: ["csv", "tsv", "txt"] }], multiple: false });
    if (!files.length) return;
    st.source = null;
    srcSel.set("");
    renderLink();
    showGrid();
    grid.set(parseTextMatrix(decodeText(files[0].bytes)));
  });
  const pasteBtn = button("Paste from clipboard", async () => {
    try {
      const { readClipboardMatrix } = await import("../../studios/tools/data.js");
      const m = await readClipboardMatrix();
      if (!m) return app.toast("The clipboard has no table data. Click into the grid and press Ctrl+V instead.", "warning");
      st.source = null;
      srcSel.set("");
      renderLink();
      showGrid();
      grid.set(m);
    } catch {
      app.toast("The clipboard could not be read. Click into the grid and press Ctrl+V.", "warning");
    }
  });
  renderLink();
  showGrid();
  const isScatter = chart.type === "scatter";
  openDialog({
    title: "Chart Data",
    width: 720,
    body: h("div.of-form", srcSel.el, linkBox, h("div.of-row", importBtn, pasteBtn), gridHost, h("p.of-hint", isScatter ? "Scatter chart: the first column holds the X values, the other columns the Y series." : "The first row holds the series names, the first column the categories. Paste cells from a spreadsheet straight into the grid.")),
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Apply",
        variant: "primary",
        onClick: (close) => {
          close();
          editChart(doc, node, (c) => {
            if (st.source) {
              const t = doc.find(st.source.tableId);
              if (!t) return "The linked table no longer exists.";
              linkChart(c, t, st.source);
            } else setChartMatrix(c, grid.get());
          }, "Edit Chart Data");
          app.requestRender();
          app.emit("tablesel");
        },
      },
    ],
  });
}
