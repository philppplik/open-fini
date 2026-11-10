// Native charts in presentation files (docs/office-slides.md ▸ Formats and fidelity): DrawingML chart parts for
// PowerPoint (`ppt/charts/chartN.xml`, ECMA-376 Part 1 § 21.2) and embedded OpenDocument chart objects for Impress
// (ISO/IEC 26300 § 10 and § 11: an `Object N/content.xml` with `office:chart` and its data in a local table). Both
// carry the data as cached values, so they open without the spreadsheet; there is no embedded workbook. Pure (no DOM);
// used by pptx.js and odp.js. Tests: tests/office/slides-depth.test.js.
//
// Public API
//   pptxChartXml(chart) → string                          chart = slideChart(...) definition with data and palette
//   readPptxChart(doc) → { type, title, data } | null      doc = parsed c:chartSpace
//   odfChartXml(chart, { w, h }) → string                  content.xml of an embedded chart object
//   readOdfChart(doc) → { type, title, data } | null       doc = parsed office:document-content of the object
import { child, children, find, findAll, attr, esc, escAttr } from "../../engine/office/xml.js";
import { seriesColor } from "../../engine/layout/chart-data.js";

const C_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const hex = (c) => String(c || "#4f46e5").replace("#", "").slice(0, 6).toUpperCase();
const numText = (v) => String(Math.round(v * 1e10) / 1e10);
const colName = (i) => (i < 26 ? "" : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26));

/** PowerPoint chart family of a chart type: { tag, dir?, grouping, axes } */
const PPTX_KIND = {
  column: { tag: "barChart", dir: "col", grouping: "clustered" },
  "stacked-column": { tag: "barChart", dir: "col", grouping: "stacked" },
  "percent-column": { tag: "barChart", dir: "col", grouping: "percentStacked" },
  bar: { tag: "barChart", dir: "bar", grouping: "clustered" },
  "stacked-bar": { tag: "barChart", dir: "bar", grouping: "stacked" },
  line: { tag: "lineChart", grouping: "standard" },
  area: { tag: "areaChart", grouping: "standard" },
  "stacked-area": { tag: "areaChart", grouping: "stacked" },
  scatter: { tag: "scatterChart" },
  pie: { tag: "pieChart" },
  donut: { tag: "doughnutChart" },
  radar: { tag: "radarChart" },
};

const solidFill = (c) => `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>`;
const strCache = (f, list) => `<c:strRef><c:f>${esc(f)}</c:f><c:strCache><c:ptCount val="${list.length}"/>${list.map((s, i) => `<c:pt idx="${i}"><c:v>${esc(s)}</c:v></c:pt>`).join("")}</c:strCache></c:strRef>`;
const numCache = (f, list) => `<c:numRef><c:f>${esc(f)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${list.length}"/>${list.map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${numText(v)}</c:v></c:pt>` : "")).join("")}</c:numCache></c:numRef>`;
const richText = (text, size = 1400) => `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="${size}" b="1"/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx>`;

/**
 * A DrawingML chart part (c:chartSpace) for a chart definition. Series colors come from the chart (seriesColor), the
 * text color and font from its options (textColor, fontFamily), so a themed slide chart keeps its look.
 */
export function pptxChartXml(chart) {
  const k = PPTX_KIND[chart.type] || PPTX_KIND.column;
  const { categories, series } = chart.data;
  const n = categories.length;
  const last = n + 1;
  const pie = k.tag === "pieChart" || k.tag === "doughnutChart";
  const list = pie ? series.slice(0, 1) : series;
  const ser = list.map((s, i) => {
    const col = colName(i + 1);
    const color = seriesColor(chart, i);
    const head = `<c:idx val="${i}"/><c:order val="${i}"/><c:tx>${strCache(`Sheet1!$${col}$1`, [s.name || `Series ${i + 1}`])}</c:tx>`;
    const line = k.tag === "lineChart" || k.tag === "scatterChart" || k.tag === "radarChart";
    const spPr = line ? `<c:spPr><a:ln w="28575" cap="rnd">${solidFill(color)}<a:round/></a:ln></c:spPr>` : `<c:spPr>${solidFill(color)}</c:spPr>`;
    const marker = line ? `<c:marker><c:symbol val="${chart.options?.markers === false ? "none" : "circle"}"/><c:size val="5"/><c:spPr>${solidFill(color)}</c:spPr></c:marker>` : "";
    const points = pie ? categories.map((_, j) => `<c:dPt><c:idx val="${j}"/><c:bubble3D val="0"/><c:spPr>${solidFill(seriesColor({ ...chart, data: { ...chart.data, series: [] } }, j))}<a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join("") : "";
    const vals = s.values.slice(0, n).map((v) => (v == null ? NaN : +v));
    if (k.tag === "scatterChart") {
      const xs = categories.map((c) => parseFloat(String(c).replace(",", ".")));
      return `<c:ser>${head}${spPr}${marker}<c:xVal>${numCache(`Sheet1!$A$2:$A$${last}`, xs)}</c:xVal><c:yVal>${numCache(`Sheet1!$${col}$2:$${col}$${last}`, vals)}</c:yVal><c:smooth val="${chart.options?.smooth ? 1 : 0}"/></c:ser>`;
    }
    const cat = `<c:cat>${strCache(`Sheet1!$A$2:$A$${last}`, categories.map(String))}</c:cat><c:val>${numCache(`Sheet1!$${col}$2:$${col}$${last}`, vals)}</c:val>`;
    if (k.tag === "barChart") return `<c:ser>${head}${spPr}<c:invertIfNegative val="0"/>${cat}</c:ser>`;
    if (k.tag === "lineChart") return `<c:ser>${head}${spPr}${marker}${cat}<c:smooth val="${chart.options?.smooth ? 1 : 0}"/></c:ser>`;
    if (k.tag === "radarChart") return `<c:ser>${head}${spPr}${marker}${cat}</c:ser>`;
    if (pie) return `<c:ser>${head}${points}${cat}</c:ser>`;
    return `<c:ser>${head}${spPr}${cat}</c:ser>`;
  }).join("");
  const AX = '<c:axId val="500000001"/><c:axId val="500000002"/>';
  let plot;
  if (k.tag === "barChart") plot = `<c:barChart><c:barDir val="${k.dir}"/><c:grouping val="${k.grouping}"/><c:varyColors val="0"/>${ser}<c:gapWidth val="80"/>${k.grouping === "clustered" ? "" : '<c:overlap val="100"/>'}${AX}</c:barChart>`;
  else if (k.tag === "lineChart") plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/>${AX}</c:lineChart>`;
  else if (k.tag === "areaChart") plot = `<c:areaChart><c:grouping val="${k.grouping}"/><c:varyColors val="0"/>${ser}${AX}</c:areaChart>`;
  else if (k.tag === "scatterChart") plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${ser}${AX}</c:scatterChart>`;
  else if (k.tag === "radarChart") plot = `<c:radarChart><c:radarStyle val="marker"/><c:varyColors val="0"/>${ser}${AX}</c:radarChart>`;
  else if (k.tag === "pieChart") plot = `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/></c:pieChart>`;
  else plot = `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
  const grid = chart.options?.gridlines === false ? "" : '<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';
  const horizontal = k.dir === "bar";
  const catAx = k.tag === "scatterChart"
    ? `<c:valAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`
    : `<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="${horizontal ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx = `<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "b" : "l"}"/>${grid}<c:numFmt formatCode="${k.grouping === "percentStacked" ? "0%" : "General"}" sourceLinked="${k.grouping === "percentStacked" ? 0 : 1}"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000001"/><c:crosses val="${horizontal ? "max" : "autoZero"}"/><c:crossBetween val="${k.tag === "areaChart" ? "midCat" : "between"}"/></c:valAx>`;
  const axes = pie ? "" : catAx + valAx;
  const legendPos = { top: "t", bottom: "b", left: "l", right: "r" }[chart.options?.legend] || "b";
  const legend = chart.options?.legend === "none" || (!pie && series.length < 2 && chart.options?.legend === "auto") ? "" : `<c:legend><c:legendPos val="${legendPos}"/><c:overlay val="0"/></c:legend>`;
  const title = chart.title ? `<c:title>${richText(chart.title)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  const font = chart.options?.fontFamily ? `<a:latin typeface="${escAttr(chart.options.fontFamily)}"/>` : "";
  const txPr = `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200">${chart.options?.textColor ? solidFill(chart.options.textColor) : ""}${font}</a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
  return `${HEAD}<c:chartSpace ${C_NS}><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr}</c:chartSpace>`;
}

const cacheValues = (ref) => {
  const cache = find(ref, "strCache") || find(ref, "numCache") || find(ref, "strLit") || find(ref, "numLit");
  const count = Math.min(5000, Number(attr(child(cache, "ptCount"), "val")) || 0);
  const out = new Array(count).fill(null);
  for (const pt of children(cache, "pt")) {
    const i = Number(attr(pt, "idx"));
    const v = child(pt, "v");
    if (Number.isInteger(i) && i >= 0 && i < 5000) out[i] = v ? v.children.filter((x) => typeof x === "string").join("") : null;
  }
  return out;
};
const allText = (el) => findAll(el, "t").map((t) => t.children.filter((x) => typeof x === "string").join("")).join("");

/** Reads the first chart of a DrawingML c:chartSpace into a chart definition (type, title, data), or null. */
export function readPptxChart(doc) {
  const plotArea = find(doc, "plotArea");
  if (!plotArea) return null;
  const plot = children(plotArea).find((c) => /Chart$/.test(c.local));
  if (!plot) return null;
  const grouping = attr(child(plot, "grouping"), "val") || "";
  const dir = attr(child(plot, "barDir"), "val");
  let type = "column";
  if (plot.local === "barChart" || plot.local === "bar3DChart") type = `${grouping === "stacked" ? "stacked-" : grouping === "percentStacked" && dir !== "bar" ? "percent-" : ""}${dir === "bar" ? "bar" : "column"}`;
  else if (plot.local === "lineChart" || plot.local === "line3DChart") type = "line";
  else if (plot.local === "areaChart" || plot.local === "area3DChart") type = grouping === "stacked" ? "stacked-area" : "area";
  else if (plot.local === "pieChart" || plot.local === "pie3DChart" || plot.local === "ofPieChart") type = "pie";
  else if (plot.local === "doughnutChart") type = "donut";
  else if (plot.local === "scatterChart" || plot.local === "bubbleChart") type = "scatter";
  else if (plot.local === "radarChart") type = "radar";
  if (type === "percent-bar") type = "stacked-bar";
  const sers = children(plot, "ser").slice(0, 50);
  let categories = [];
  const series = sers.map((s, i) => {
    const catEl = child(s, "cat") || child(s, "xVal");
    const valEl = child(s, "val") || child(s, "yVal");
    if (!categories.length && catEl) categories = cacheValues(catEl).map((v) => v ?? "");
    const name = cacheValues(child(s, "tx"))[0] || allText(child(s, "tx")) || `Series ${i + 1}`;
    const values = cacheValues(valEl).map((v) => (v === null || v === "" || !Number.isFinite(+v) ? null : +v));
    return { name, values };
  });
  const len = Math.max(categories.length, ...series.map((s) => s.values.length));
  if (!len) return null;
  categories = Array.from({ length: len }, (_, i) => String(categories[i] ?? i + 1));
  for (const s of series) s.values = Array.from({ length: len }, (_, i) => s.values[i] ?? null);
  const titleEl = child(find(doc, "chart"), "title");
  return { type, title: titleEl ? allText(titleEl) : "", data: { categories, series } };
}

// ---------------------------------------------------------------- OpenDocument chart objects

const O_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.3"';
const ODF_CLASS = { column: "bar", "stacked-column": "bar", "percent-column": "bar", bar: "bar", "stacked-bar": "bar", line: "line", area: "area", "stacked-area": "area", scatter: "scatter", pie: "circle", donut: "ring", radar: "radar" };
const cmOf = (px) => `${(Math.round(((Number(px) || 0) * 2.54 * 1000) / 96) / 1000).toFixed(3)}cm`;

/** content.xml of an embedded OpenDocument chart object (chart plus its data in the local table "local-table"). */
export function odfChartXml(chart, { w = 480, h = 320 } = {}) {
  const { categories, series } = chart.data;
  const n = categories.length;
  const cls = ODF_CLASS[chart.type] || "bar";
  const pie = cls === "circle" || cls === "ring";
  const list = pie ? series.slice(0, 1) : series;
  const stacked = /^stacked-/.test(chart.type), percent = chart.type === "percent-column";
  const styles = [`<style:style style:name="ch1" style:family="chart"><style:chart-properties chart:vertical="${/bar$/.test(chart.type) ? "true" : "false"}"${stacked ? ' chart:stacked="true"' : ""}${percent ? ' chart:percentage="true"' : ""} chart:three-dimensional="false"/></style:style>`];
  styles.push(`<style:style style:name="chText" style:family="chart"><style:text-properties fo:font-size="12pt"${chart.options?.textColor ? ` fo:color="${chart.options.textColor}"` : ""}${chart.options?.fontFamily ? ` fo:font-family="${escAttr(chart.options.fontFamily)}"` : ""}/></style:style>`);
  const series_ = list.map((s, i) => {
    const col = colName(i + 1);
    const name = `S${i}`;
    const color = seriesColor(chart, i);
    const line = cls === "line" || cls === "scatter" || cls === "radar";
    styles.push(`<style:style style:name="${name}" style:family="chart"><style:graphic-properties draw:fill-color="${color}" svg:stroke-color="${line ? color : "#ffffff"}"${line ? ' svg:stroke-width="0.07cm"' : ""}/></style:style>`);
    const domain = cls === "scatter" ? `<chart:domain table:cell-range-address="local-table.A2:A${n + 1}"/>` : "";
    const points = pie ? categories.map((_, j) => {
      const pn = `P${j}`;
      styles.push(`<style:style style:name="${pn}" style:family="chart"><style:graphic-properties draw:fill-color="${seriesColor({ ...chart, data: { ...chart.data, series: [] } }, j)}" svg:stroke-color="#ffffff"/></style:style>`);
      return `<chart:data-point chart:style-name="${pn}"/>`;
    }).join("") : "";
    return `<chart:series chart:style-name="${name}" chart:class="chart:${cls}" chart:values-cell-range-address="local-table.${col}2:${col}${n + 1}" chart:label-cell-address="local-table.${col}1">${domain}${points}</chart:series>`;
  }).join("");
  const axes = pie ? "" : `<chart:axis chart:dimension="x" chart:name="primary-x" chart:style-name="chText">${cls === "scatter" ? "" : `<chart:categories table:cell-range-address="local-table.A2:A${n + 1}"/>`}</chart:axis><chart:axis chart:dimension="y" chart:name="primary-y" chart:style-name="chText">${chart.options?.gridlines === false ? "" : '<chart:grid chart:class="major"/>'}</chart:axis>`;
  const legendPos = { top: "top", bottom: "bottom", left: "start", right: "end" }[chart.options?.legend] || "bottom";
  const legend = chart.options?.legend === "none" || (!pie && series.length < 2 && chart.options?.legend === "auto") ? "" : `<chart:legend chart:legend-position="${legendPos}" chart:style-name="chText"/>`;
  const title = chart.title ? `<chart:title chart:style-name="chText"><text:p>${esc(chart.title)}</text:p></chart:title>` : "";
  const cell = (v, num) => (num && Number.isFinite(v) ? `<table:table-cell office:value-type="float" office:value="${numText(v)}"><text:p>${numText(v)}</text:p></table:table-cell>` : `<table:table-cell office:value-type="string"><text:p>${esc(v ?? "")}</text:p></table:table-cell>`);
  const head = `<table:table-header-rows><table:table-row><table:table-cell/>${list.map((s, i) => cell(s.name || `Series ${i + 1}`, false)).join("")}</table:table-row></table:table-header-rows>`;
  const rows = categories.map((c, j) => `<table:table-row>${cls === "scatter" ? cell(parseFloat(String(c).replace(",", ".")), true) : cell(String(c), false)}${list.map((s) => cell(s.values[j] == null ? NaN : +s.values[j], true)).join("")}</table:table-row>`).join("");
  const table = `<table:table table:name="local-table"><table:table-header-columns><table:table-column/></table:table-header-columns><table:table-columns><table:table-column table:number-columns-repeated="${Math.max(1, list.length)}"/></table:table-columns>${head}<table:table-rows>${rows}</table:table-rows></table:table>`;
  return `${HEAD}<office:document-content ${O_NS}><office:automatic-styles>${styles.join("")}</office:automatic-styles><office:body><office:chart><chart:chart svg:width="${cmOf(w)}" svg:height="${cmOf(h)}" chart:class="chart:${cls}">${title}${legend}<chart:plot-area chart:style-name="ch1" table:cell-range-address="local-table.A1:${colName(list.length)}${n + 1}" chart:data-source-has-labels="both">${axes}${series_}</chart:plot-area>${table}</chart:chart></office:chart></office:body></office:document-content>`;
}

/** Reads an embedded OpenDocument chart object (its local table) into a chart definition, or null. */
export function readOdfChart(doc) {
  const ch = find(doc, "chart:chart");
  const tbl = find(ch, "table:table") || find(doc, "table:table");
  if (!ch || !tbl) return null;
  const cls = String(attr(ch, "chart:class") || "chart:bar").replace(/^chart:/, "");
  const plotStyle = attr(find(ch, "chart:plot-area"), "chart:style-name");
  const props = {};
  for (const st of findAll(doc, "style:style")) if (attr(st, "style:name") === plotStyle) Object.assign(props, child(st, "style:chart-properties")?.attrs || {});
  const horizontal = props["chart:vertical"] === "true", stacked = props["chart:stacked"] === "true", percent = props["chart:percentage"] === "true";
  const TYPE = { line: "line", area: stacked ? "stacked-area" : "area", scatter: "scatter", circle: "pie", ring: "donut", radar: "radar", "filled-radar": "radar" };
  const type = cls === "bar" ? (horizontal ? (stacked || percent ? "stacked-bar" : "bar") : percent ? "percent-column" : stacked ? "stacked-column" : "column") : TYPE[cls] || "column";
  const cellsOf = (row) => children(row, "table:table-cell").flatMap((c) => {
    const v = attr(c, "office:value");
    const text = findAll(c, "text:p").map((p) => p.children.filter((x) => typeof x === "string").join("")).join(" ");
    return Array(Math.min(200, +attr(c, "table:number-columns-repeated") || 1)).fill(v !== undefined && Number.isFinite(+v) ? +v : text);
  });
  const rows = findAll(tbl, "table:table-row").slice(0, 2001).map(cellsOf);
  if (rows.length < 2) return null;
  const head = rows[0];
  const series = head.slice(1).map((name, i) => ({ name: String(name || `Series ${i + 1}`), values: rows.slice(1).map((r) => (typeof r[i + 1] === "number" ? r[i + 1] : null)) }));
  const title = find(ch, "chart:title");
  return { type, title: title ? findAll(title, "text:p").map((p) => p.children.filter((x) => typeof x === "string").join("")).join(" ") : "", data: { categories: rows.slice(1).map((r) => String(r[0] ?? "")), series } };
}
