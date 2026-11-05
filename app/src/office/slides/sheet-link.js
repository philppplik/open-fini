// Charts from spreadsheet data, for the Presentation and Whiteboard apps. Loaded lazily by "Chart from spreadsheet…"
// and the slides_insert_chart / slides_refresh_charts / board_add_chart Vibe tools. The caller stores a snapshot (the
// chart definition with its data, engine/layout/chart-data.js) plus where it came from ({ doc, sheet, range }); nothing
// links the documents at run time, so a deck or board opens, renders and exports without the spreadsheet.
//
// The data comes from the spreadsheet's own app-independent API, office/sheet/depth.js ▸ sheetChartData (computed
// values; header row = series names, first column = categories; also behind the sheet_chart_data Vibe tool).
import { normalizeChart } from "../../engine/layout/chart-data.js";

/** Open spreadsheet document by name (exact, then case-insensitive). */
export function findSheetDoc(app, name) {
  const all = (app.docs || []).filter((d) => d.office?.kind === "sheet");
  const hit = all.find((d) => d.name === name) || all.find((d) => d.name.toLowerCase() === String(name || "").toLowerCase());
  if (!hit) throw new Error(`No open spreadsheet named “${name}”. Open spreadsheets: ${all.map((d) => d.name).join(", ") || "none"}.`);
  return hit;
}

/**
 * Builds a chart definition from a range of an open spreadsheet (default: the used range of the sheet).
 * @returns {Promise<{ chart: object, source: { doc, sheet, range }, rows: number, cols: number }>}
 */
export async function chartFromSheet(app, { spreadsheet, sheet = "", range = "", type = "column", title = "", seriesIn = "columns" }) {
  const src = findSheetDoc(app, spreadsheet);
  const { loadOfficeApp } = await import("../index.js");
  await loadOfficeApp("sheet");
  const [{ ensureModel, calcFor }, SM, D, sel] = await Promise.all([import("../sheet/app.js"), import("../sheet/model.js"), import("../sheet/depth.js"), import("../toolkit/selection.js")]);
  const wb = ensureModel(src.office);
  const sh = sheet ? SM.sheetByName(wb, sheet) : SM.activeSheet(wb);
  if (!sh) throw new Error(`No sheet “${sheet}”. Sheets: ${wb.sheets.map((s) => s.name).join(", ")}.`);
  let a1 = String(range || "").replace(/\$/g, "").toUpperCase();
  if (!a1) {
    const g = SM.usedRange(sh);
    if (!g) throw new Error(`The sheet “${sh.name}” is empty.`);
    a1 = sel.formatRange(g);
  }
  const calc = calcFor(src);
  const data = D.sheetChartData(wb, { sheet: sh.name, range: a1, seriesIn }, (sid, r, c) => calc.get(sid, r, c));
  if (!data.series.some((s) => s.values.some((v) => v != null))) throw new Error(`${a1} on “${sh.name}” has no numbers to chart. Put series names in the first row and categories in the first column.`);
  const chart = normalizeChart({ type, title, data: { categories: data.categories, series: data.series }, options: { legend: "auto", radius: 2 } });
  return { chart, source: { doc: src.name, sheet: sh.name, range: a1 }, rows: data.categories.length, cols: data.series.length };
}

/** Re-reads every chart of a deck whose spreadsheet is open. Returns { deck, updated, missing: [doc names] }. */
export async function refreshDeckCharts(app, deck) {
  const M = await import("./model.js");
  let next = deck;
  let updated = 0;
  const missing = new Set();
  for (const s of deck.slides) {
    for (const e of s.elements) {
      if (e.type !== "chart" || !e.source) continue;
      try {
        const r = await chartFromSheet(app, { spreadsheet: e.source.doc, sheet: e.source.sheet, range: e.source.range, type: e.chart.type, title: e.chart.title });
        next = M.setChartData(next, s.id, e.id, { data: r.chart.data });
        updated++;
      } catch {
        missing.add(e.source.doc);
      }
    }
  }
  return { deck: next, updated, missing: [...missing] };
}
