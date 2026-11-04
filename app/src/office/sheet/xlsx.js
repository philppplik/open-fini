// XLSX (Office Open XML SpreadsheetML) reader and writer for the Spreadsheet app. Pure: zip limits and the tolerant
// XML parser of engine/office (no entity expansion, no DTDs). What is kept, simplified or dropped is listed in
// docs/office-sheet.md ▸ Formats and reported through the ImportReport. Tests: tests/office/sheet-codecs.test.js.
//
// Public API
//   readXlsx(bytes, { report }) → workbook model          (also .xlsm / .xltx; macros are dropped)
//   writeXlsx(model, { calc, title }) → Uint8Array          calc = createCalc(model) for the cached formula values
import { readZip, writeZip, strFromU8 } from "../../engine/office/zip.js";
import { parseXml, child, children, find, findAll, textOf, attr, esc, escAttr } from "../../engine/office/xml.js";
import { parseRange, formatRange, colIndex } from "../toolkit/selection.js";
import { newWorkbook, newSheet, normalizeWorkbook, DEFAULT_COL, DEFAULT_ROW, usedRange } from "./model.js";
import { keyRC, rcKey, isErr, shiftFormula } from "./formula.js";

const BUILTIN_FMT = { 0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 5: '"$"#,##0_);("$"#,##0)', 6: '"$"#,##0_);[Red]("$"#,##0)', 7: '"$"#,##0.00_);("$"#,##0.00)', 8: '"$"#,##0.00_);[Red]("$"#,##0.00)', 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??", 14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm", 37: "#,##0_);(#,##0)", 38: "#,##0_);[Red](#,##0)", 39: "#,##0.00_);(#,##0.00)", 40: "#,##0.00_);[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@" };
const FMT_ID = Object.fromEntries(Object.entries(BUILTIN_FMT).map(([k, v]) => [v, Number(k)]));
const XL_ERRORS = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"]);
const NEW_FNS = /\b(XLOOKUP|XMATCH|IFS|SWITCH|MAXIFS|MINIFS|CONCAT|TEXTJOIN|IFNA|DAYS|STDEV\.S|STDEV\.P|VAR\.S|VAR\.P|MODE\.SNGL|RANK\.EQ|CEILING\.MATH|FLOOR\.MATH|XOR)\(/g;
const PX_PER_CHAR = 7;
const colPx = (w) => Math.round(Number(w) * PX_PER_CHAR + 5);
const colChars = (px) => Math.max(0, Math.round(((px - 5) / PX_PER_CHAR) * 100) / 100);

const argb = (el) => {
  const rgb = attr(el, "rgb");
  return rgb && /^[0-9a-f]{6,8}$/i.test(rgb) ? `#${rgb.slice(-6).toLowerCase()}` : null;
};

function parseRels(text) {
  const out = new Map();
  if (!text) return out;
  for (const r of findAll(parseXml(text), "Relationship")) out.set(attr(r, "Id"), { target: attr(r, "Target") || "", type: attr(r, "Type") || "" });
  return out;
}
const resolvePath = (base, target) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) seg === ".." ? parts.pop() : seg !== "." && parts.push(seg);
  return parts.join("/");
};
const relsOf = (path) => path.replace(/[^/]+$/, (f) => `_rels/${f}.rels`);

// ------------------------------------------------------------------------------------------------------ styles

function readStyles(text) {
  const st = { xfs: [], dxfs: [] };
  if (!text) return st;
  const doc = parseXml(text);
  const fmts = { ...BUILTIN_FMT };
  for (const n of findAll(find(doc, "numFmts"), "numFmt")) fmts[attr(n, "numFmtId")] = attr(n, "formatCode") || "General";
  const fontOf = (f) => {
    const s = {};
    if (!f) return s;
    if (child(f, "b") && attr(child(f, "b"), "val") !== "0") s.b = true;
    if (child(f, "i") && attr(child(f, "i"), "val") !== "0") s.i = true;
    if (child(f, "u") && attr(child(f, "u"), "val") !== "none") s.u = true;
    if (child(f, "strike") && attr(child(f, "strike"), "val") !== "0") s.st = true;
    const sz = Number(attr(child(f, "sz"), "val"));
    if (sz && sz !== 11) s.size = sz;
    const color = argb(child(f, "color"));
    if (color && color !== "#000000") s.color = color;
    const name = attr(child(f, "name"), "val");
    if (name && name !== "Calibri") s.font = name;
    return s;
  };
  const fonts = children(find(doc, "fonts"), "font").map(fontOf);
  const fillOf = (f, dxf) => {
    const p = child(f, "patternFill");
    if (!p) return null;
    if (!dxf && attr(p, "patternType") !== "solid") return null;
    return argb(child(p, dxf ? "bgColor" : "fgColor")) || argb(child(p, "fgColor"));
  };
  const fills = children(find(doc, "fills"), "fill").map((f) => fillOf(f, false));
  const borders = children(find(doc, "borders"), "border").map((b) => {
    const out = {};
    for (const [side, key] of [["top", "t"], ["right", "r"], ["bottom", "b"], ["left", "l"]]) {
      const e = child(b, side);
      if (e && attr(e, "style") && attr(e, "style") !== "none") out[key] = argb(child(e, "color")) || "#000000";
    }
    return Object.keys(out).length ? out : null;
  });
  for (const xf of children(find(doc, "cellXfs"), "xf")) {
    const s = { ...(fonts[Number(attr(xf, "fontId")) || 0] || {}) };
    const fill = fills[Number(attr(xf, "fillId")) || 0];
    if (fill) s.fill = fill;
    const bd = borders[Number(attr(xf, "borderId")) || 0];
    if (bd) s.bd = bd;
    const nf = fmts[attr(xf, "numFmtId") || "0"];
    if (nf && nf !== "General") s.nf = nf;
    const al = child(xf, "alignment");
    if (al) {
      const h = attr(al, "horizontal");
      if (h === "left" || h === "center" || h === "right") s.ha = h;
      else if (h === "centerContinuous") s.ha = "center";
      const v = attr(al, "vertical");
      if (v === "top" || v === "center" || v === "bottom") s.va = v === "center" ? "middle" : v;
      if (attr(al, "wrapText") === "1" || attr(al, "wrapText") === "true") s.wrap = true;
    }
    st.xfs.push(Object.keys(s).length ? s : null);
  }
  for (const d of children(find(doc, "dxfs"), "dxf")) {
    const s = fontOf(child(d, "font"));
    const fill = child(d, "fill") ? fillOf(child(d, "fill"), true) : null;
    if (fill) s.fill = fill;
    st.dxfs.push(s);
  }
  return st;
}

// ------------------------------------------------------------------------------------------------------ reader

const fromXlFormula = (f) => String(f).replace(/_xlfn\.|_xlws\./gi, "");

export function readXlsx(bytes, { report = null } = {}) {
  const { entries, problems, ok } = readZip(bytes, { want: (n) => n.startsWith("xl/") || n === "[Content_Types].xml" || n.startsWith("docProps/") });
  for (const p of problems) report?.note?.(p);
  if (!ok || !entries["xl/workbook.xml"]) throw new Error("This file is not an Excel workbook (xl/workbook.xml is missing).");
  const txt = (n) => (entries[n] ? strFromU8(entries[n]) : null);
  const wbDoc = parseXml(txt("xl/workbook.xml"));
  const date1904 = ["1", "true"].includes(attr(find(wbDoc, "workbookPr"), "date1904"));
  const wbRels = parseRels(txt("xl/_rels/workbook.xml.rels"));
  const styles = readStyles(txt("xl/styles.xml"));
  const shared = [];
  const ss = txt("xl/sharedStrings.xml");
  if (ss) for (const si of findAll(parseXml(ss), "si")) shared.push(siText(si));
  if (entries["xl/vbaProject.bin"]) report?.dropped?.("Macros (VBA) are not kept; the workbook is saved without them.");
  if (find(wbDoc, "definedNames")) report?.dropped?.("Named ranges are not supported yet; formulas that use them show #NAME?.");
  const sheets = [];
  const nameOf = new Map();
  let active = 0;
  const view = find(wbDoc, "workbookView");
  if (view) active = Number(attr(view, "activeTab")) || 0;
  children(find(wbDoc, "sheets"), "sheet").forEach((el, i) => {
    const rel = wbRels.get(attr(el, "r:id") || attr(el, "id"));
    const path = rel ? resolvePath("xl/workbook.xml", rel.target) : null;
    const name = attr(el, "name") || `Sheet${i + 1}`;
    if (!path || !entries[path]) {
      if (rel && /chartsheet/i.test(rel.type)) report?.dropped?.(`Chart sheet “${name}” (chart sheets are not supported).`);
      return;
    }
    if (attr(el, "state") === "hidden" || attr(el, "state") === "veryHidden") report?.note?.(`Hidden sheet “${name}” is shown.`);
    const sheet = readSheet(txt(path), { name, id: `s${sheets.length + 1}`, pos: sheets.length + 1, shared, styles, date1904, report });
    readDrawing(sheet, path, entries, txt, report);
    nameOf.set(sheet.id, name);
    sheets.push(sheet);
  });
  if (!sheets.length) sheets.push(newSheet("Sheet1", "s1", 1));
  const title = textOf(find(parseXml(txt("docProps/core.xml") || ""), "title")) || "";
  report?.kept?.(`${sheets.length} sheet${sheets.length === 1 ? "" : "s"}, values, formulas, number formats, fonts, fills, borders, alignment, merged cells, column widths, row heights, frozen panes`);
  return normalizeWorkbook({ ...newWorkbook(), sheets, active: sheets[Math.min(active, sheets.length - 1)].id, meta: { title } });
}

function siText(si) {
  let s = "";
  for (const c of si.children) {
    if (typeof c === "string") continue;
    if (c.local === "t") s += textOf(c);
    else if (c.local === "r") s += textOf(child(c, "t"));
  }
  return s;
}

function readSheet(text, { name, id, pos, shared, styles, date1904, report }) {
  const doc = parseXml(text);
  const s = newSheet(name, id, pos);
  const sharedF = new Map(); // si → { f, r, c }
  let dropped = 0;
  for (const col of findAll(find(doc, "cols"), "col")) {
    const min = Number(attr(col, "min")) - 1;
    const max = Math.min(Number(attr(col, "max")) - 1, min + 512);
    const w = attr(col, "hidden") === "1" ? 0 : attr(col, "width") ? colPx(attr(col, "width")) : null;
    if (w == null) continue;
    for (let c = min; c <= max; c++) if (w !== DEFAULT_COL) s.cols[c] = w;
  }
  const sd = find(doc, "sheetData");
  let rowIdx = 0;
  for (const row of children(sd, "row")) {
    const r = attr(row, "r") ? Number(attr(row, "r")) - 1 : rowIdx;
    rowIdx = r + 1;
    if (attr(row, "hidden") === "1") s.rows[r] = 0;
    else if (attr(row, "ht") && (attr(row, "customHeight") === "1" || attr(row, "customHeight") === "true")) {
      const px = Math.round((Number(attr(row, "ht")) * 4) / 3);
      if (px && px !== DEFAULT_ROW) s.rows[r] = px;
    }
    let colIdx = 0;
    for (const c of children(row, "c")) {
      const ref = attr(c, "r");
      let rr = r;
      let cc = colIdx;
      if (ref) {
        const m = /^([A-Z]{1,3})(\d+)$/i.exec(ref);
        if (m) {
          cc = colIndex(m[1]);
          rr = Number(m[2]) - 1;
        }
      }
      colIdx = cc + 1;
      const t = attr(c, "t") || "n";
      const style = styles.xfs[Number(attr(c, "s")) || 0] || null;
      const vEl = child(c, "v");
      const fEl = child(c, "f");
      const cell = {};
      if (fEl) {
        const ftext = textOf(fEl);
        const si = attr(fEl, "si");
        if (attr(fEl, "t") === "shared" && si != null) {
          if (ftext) sharedF.set(si, { f: fromXlFormula(ftext), r: rr, c: cc });
          const base = sharedF.get(si);
          if (base) cell.f = base.r === rr && base.c === cc ? base.f : shiftFormula(base.f, rr - base.r, cc - base.c);
        } else if (attr(fEl, "t") === "array") {
          if (ftext) cell.f = fromXlFormula(ftext);
          dropped++;
        } else if (ftext) cell.f = fromXlFormula(ftext);
      }
      if (cell.f === undefined) {
        if (t === "s") {
          const v = shared[Number(textOf(vEl))];
          if (v !== undefined) cell.v = v;
        } else if (t === "inlineStr") cell.v = siText(child(c, "is") || { children: [] });
        else if (t === "str") cell.v = textOf(vEl);
        else if (t === "b") cell.v = textOf(vEl) === "1";
        else if (t === "e") cell.v = textOf(vEl);
        else if (vEl) {
          const n = Number(textOf(vEl));
          if (Number.isFinite(n)) cell.v = date1904 && style?.nf && /[dmyhs]/i.test(style.nf) && !/[0#]/.test(style.nf) ? n + 1462 : n;
        }
      }
      if (style) cell.s = style;
      if (cell.v !== undefined || cell.f !== undefined || cell.s) s.cells[rcKey(rr, cc)] = cell;
    }
  }
  if (dropped) report?.flattened?.("Array formulas are kept as ordinary formulas (results may differ).");
  for (const mc of findAll(find(doc, "mergeCells"), "mergeCell")) {
    const g = parseRange(attr(mc, "ref"));
    if (g) s.merges.push(formatRange(g));
  }
  const pane = find(doc, "pane");
  if (pane && /frozen/.test(attr(pane, "state") || "")) {
    const fr = { r: Number(attr(pane, "ySplit")) || 0, c: Number(attr(pane, "xSplit")) || 0 };
    if (fr.r || fr.c) s.freeze = fr;
  }
  const af = find(doc, "autoFilter");
  if (af && parseRange(attr(af, "ref"))) {
    s.filter = { range: attr(af, "ref"), hide: {} };
    if (find(af, "filterColumn")) report?.flattened?.("Filter criteria are reset (the filter buttons are kept).");
  }
  let cfIdx = 0;
  for (const cf of findAll(doc, "conditionalFormatting")) {
    const sq = String(attr(cf, "sqref") || "").split(/\s+/)[0];
    if (!parseRange(sq)) continue;
    for (const rule of children(cf, "cfRule")) {
      const type = attr(rule, "type");
      const op = attr(rule, "operator");
      const formulas = children(rule, "formula").map((f) => textOf(f).replace(/^"|"$/g, ""));
      const style = styles.dxfs[Number(attr(rule, "dxfId"))] || { fill: "#ffc7ce" };
      const id = `cf${++cfIdx}`;
      const OPS = { greaterThan: "gt", lessThan: "lt", greaterThanOrEqual: "ge", lessThanOrEqual: "le", equal: "eq", notEqual: "ne", between: "between" };
      if (type === "cellIs" && OPS[op]) s.cf.push({ id, range: sq, type: OPS[op], a: numOr(formulas[0]), ...(formulas[1] != null ? { b: numOr(formulas[1]) } : {}), style });
      else if (type === "containsText") s.cf.push({ id, range: sq, type: "contains", a: attr(rule, "text") || "", style });
      else if (type === "containsBlanks") s.cf.push({ id, range: sq, type: "blank", style });
      else if (type === "notContainsBlanks") s.cf.push({ id, range: sq, type: "notBlank", style });
      else if (type === "colorScale") {
        const colors = children(child(rule, "colorScale"), "color").map(argb).filter(Boolean);
        s.cf.push({ id, range: sq, type: "scale", colors: [colors[0] || "#f8696b", colors[colors.length - 1] || "#63be7b"] });
      } else report?.dropped?.(`Conditional formatting rules of type “${type}”.`);
    }
  }
  if (find(doc, "dataValidations")) report?.dropped?.("Data validation rules.");
  return s;
}
const numOr = (s) => (s != null && s !== "" && Number.isFinite(Number(s)) ? Number(s) : s);

function readDrawing(sheet, sheetPath, entries, txt, report) {
  const rels = parseRels(txt(relsOf(sheetPath)));
  for (const { target, type } of rels.values()) {
    if (!/\/drawing$/.test(type)) continue;
    const dPath = resolvePath(sheetPath, target);
    const dText = txt(dPath);
    if (!dText) continue;
    const dRels = parseRels(txt(relsOf(dPath)));
    const doc = parseXml(dText);
    for (const anchor of [...findAll(doc, "twoCellAnchor"), ...findAll(doc, "oneCellAnchor")]) {
      const chartRef = find(anchor, "chart");
      if (!chartRef) {
        if (find(anchor, "pic")) report?.dropped?.("Pictures in sheets.");
        else report?.dropped?.("Shapes and text boxes in sheets.");
        continue;
      }
      const rel = dRels.get(attr(chartRef, "r:id") || attr(chartRef, "id"));
      const cPath = rel ? resolvePath(dPath, rel.target) : null;
      const chart = cPath && txt(cPath) ? readChart(txt(cPath), sheet.name) : null;
      if (!chart) {
        report?.dropped?.("A chart whose type or data this version cannot read.");
        continue;
      }
      const from = find(anchor, "from");
      const to = find(anchor, "to");
      const fr = { r: Number(textOf(find(from, "row"))) || 0, c: Number(textOf(find(from, "col"))) || 0 };
      const tr = to ? { r: Number(textOf(find(to, "row"))) || fr.r + 15, c: Number(textOf(find(to, "col"))) || fr.c + 6 } : { r: fr.r + 15, c: fr.c + 6 };
      let w = 0;
      for (let c = fr.c; c < tr.c; c++) w += sheet.cols[c] ?? DEFAULT_COL;
      let h = 0;
      for (let r = fr.r; r < tr.r; r++) h += sheet.rows[r] ?? DEFAULT_ROW;
      sheet.charts.push({ id: `ch${sheet.charts.length + 1}`, ...chart, r: fr.r, c: fr.c, w: Math.max(160, w), h: Math.max(120, h) });
    }
  }
}

const CHART_TAGS = { barChart: "bar", bar3DChart: "bar", lineChart: "line", line3DChart: "line", pieChart: "pie", pie3DChart: "pie", doughnutChart: "donut", areaChart: "area", area3DChart: "area", scatterChart: "scatter", radarChart: "radar" };

function readChart(text, ownSheet) {
  const doc = parseXml(text);
  const plot = find(doc, "plotArea");
  if (!plot) return null;
  const node = plot.children.find((c) => typeof c !== "string" && CHART_TAGS[c.local]);
  if (!node) return null;
  let type = CHART_TAGS[node.local];
  const grouping = attr(child(node, "grouping"), "val");
  if (type === "bar") {
    const col = attr(child(node, "barDir"), "val") !== "bar";
    type = col ? (grouping === "stacked" ? "stacked-column" : grouping === "percentStacked" ? "percent-column" : "column") : grouping === "stacked" ? "stacked-bar" : "bar";
  } else if (type === "area" && grouping === "stacked") type = "stacked-area";
  const refs = [];
  for (const ser of children(node, "ser")) for (const f of findAll(ser, "f")) refs.push(textOf(f));
  let box = null;
  let sheet = null;
  for (const ref of refs) {
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(ref.replace(/^\(|\)$/g, ""));
    if (!m) continue;
    const sh = (m[1] ?? m[2]).replace(/''/g, "'");
    const g = parseRange(m[3].replace(/\$/g, ""));
    if (!g) continue;
    if (sheet && sheet !== sh) return null;
    sheet = sh;
    box = box ? { r0: Math.min(box.r0, g.r0), c0: Math.min(box.c0, g.c0), r1: Math.max(box.r1, g.r1), c1: Math.max(box.c1, g.c1) } : g;
  }
  if (!box) return null;
  const title = findAll(child(find(doc, "chart"), "title") || { children: [] }, "t").map(textOf).join("");
  const range = formatRange(box);
  return { type, range: sheet && sheet !== ownSheet ? range : range, title, ...(sheet && sheet !== ownSheet ? { sheet } : {}) };
}

// ------------------------------------------------------------------------------------------------------ writer

const CT = {
  wb: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  ws: "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
  st: "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
  ss: "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
  dr: "application/vnd.openxmlformats-officedocument.drawing+xml",
  ch: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
};
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = (t) => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}`;
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function styleTable() {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  const numFmts = [];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const dxfs = [];
  const idx = new Map([["{}", 0]]);
  const listIdx = (list, xml, offset = 0) => {
    let i = list.indexOf(xml);
    if (i < 0) i = list.push(xml) - 1;
    return i + offset;
  };
  const rgb = (c) => `FF${String(c).replace("#", "").toUpperCase().padEnd(6, "0").slice(0, 6)}`;
  const fontXml = (s) => `<font>${s.b ? "<b/>" : ""}${s.i ? "<i/>" : ""}${s.st ? "<strike/>" : ""}${s.u ? "<u/>" : ""}<sz val="${s.size || 11}"/>${s.color ? `<color rgb="${rgb(s.color)}"/>` : ""}<name val="${escAttr(s.font || "Calibri")}"/></font>`;
  const fmtId = (code) => {
    if (FMT_ID[code] !== undefined) return FMT_ID[code];
    let i = numFmts.findIndex((x) => x === code);
    if (i < 0) i = numFmts.push(code) - 1;
    return 164 + i;
  };
  return {
    xf(s) {
      if (!s) return 0;
      const key = JSON.stringify(s);
      if (idx.has(key)) return idx.get(key);
      const fontId = s.b || s.i || s.u || s.st || s.size || s.color || s.font ? listIdx(fonts, fontXml(s)) : 0;
      const fillId = s.fill ? listIdx(fills, `<fill><patternFill patternType="solid"><fgColor rgb="${rgb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
      const side = (n, k) => (s.bd?.[k] ? `<${n} style="thin"><color rgb="${rgb(s.bd[k])}"/></${n}>` : `<${n}/>`);
      const borderId = s.bd ? listIdx(borders, `<border>${side("left", "l")}${side("right", "r")}${side("top", "t")}${side("bottom", "b")}<diagonal/></border>`) : 0;
      const numFmtId = s.nf ? fmtId(s.nf) : 0;
      const al = s.ha || s.va || s.wrap ? `<alignment${s.ha ? ` horizontal="${s.ha}"` : ""}${s.va ? ` vertical="${s.va === "middle" ? "center" : s.va}"` : ""}${s.wrap ? ' wrapText="1"' : ""}/>` : "";
      const xml = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}${al ? ' applyAlignment="1">' + al + "</xf>" : "/>"}`;
      const i = xfs.push(xml) - 1;
      idx.set(key, i);
      return i;
    },
    dxf(s = {}) {
      const font = s.b || s.i || s.color ? `<font>${s.b ? "<b/>" : ""}${s.i ? "<i/>" : ""}${s.color ? `<color rgb="${rgb(s.color)}"/>` : ""}</font>` : "";
      const fill = s.fill ? `<fill><patternFill><bgColor rgb="${rgb(s.fill)}"/></patternFill></fill>` : "";
      return dxfs.push(`<dxf>${font}${fill}</dxf>`) - 1;
    },
    xml() {
      return `${XML}<styleSheet xmlns="${MAIN_NS}">${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${escAttr(c)}"/>`).join("")}</numFmts>` : ""}<fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${dxfs.length}">${dxfs.join("")}</dxfs></styleSheet>`;
    },
  };
}

const toXlFormula = (f) => String(f).replace(NEW_FNS, "_xlfn.$1(");
const quoteName = (n) => (/^[A-Za-z_][\w.]*$/.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);
const absRange = (sheet, g) => `${quoteName(sheet)}!$${rcKey(g.r0, g.c0).replace(/(\d+)$/, "$$$1")}${g.r0 === g.r1 && g.c0 === g.c1 ? "" : `:$${rcKey(g.r1, g.c1).replace(/(\d+)$/, "$$$1")}`}`;

/** Writes a workbook as .xlsx bytes. `calc` (optional) provides cached formula results. */
export function writeXlsx(model, { calc = null, title = "" } = {}) {
  const wb = normalizeWorkbook(model);
  const st = styleTable();
  const strings = [];
  const stringIdx = new Map();
  const sIdx = (s) => {
    let i = stringIdx.get(s);
    if (i === undefined) {
      i = strings.push(s) - 1;
      stringIdx.set(s, i);
    }
    return i;
  };
  const files = [];
  const ct = [];
  const sheetEntries = [];
  let chartNo = 0;
  wb.sheets.forEach((s, i) => {
    const n = i + 1;
    const path = `xl/worksheets/sheet${n}.xml`;
    ct.push(`<Override PartName="/${path}" ContentType="${CT.ws}"/>`);
    const rowsMap = new Map();
    for (const [k, cell] of Object.entries(s.cells)) {
      const { r, c } = keyRC(k);
      if (r < 0) continue;
      if (!rowsMap.has(r)) rowsMap.set(r, []);
      rowsMap.get(r).push([c, k, cell]);
    }
    for (const r of Object.keys(s.rows)) if (!rowsMap.has(Number(r))) rowsMap.set(Number(r), []);
    const rowXml = [...rowsMap.keys()].sort((a, b) => a - b).map((r) => {
      const cells = rowsMap.get(r).sort((a, b) => a[0] - b[0]).map(([, k, cell]) => {
        const xf = st.xf(cell.s);
        const sAttr = xf ? ` s="${xf}"` : "";
        if (typeof cell.f === "string") {
          const v = calc ? calc.value(s.id, k) : null;
          const fx = `<f>${esc(toXlFormula(cell.f))}</f>`;
          if (isErr(v)) return XL_ERRORS.has(v.code) ? `<c r="${k}"${sAttr} t="e">${fx}<v>${esc(v.code)}</v></c>` : `<c r="${k}"${sAttr}>${fx}</c>`;
          if (typeof v === "number") return `<c r="${k}"${sAttr}>${fx}<v>${v}</v></c>`;
          if (typeof v === "boolean") return `<c r="${k}"${sAttr} t="b">${fx}<v>${v ? 1 : 0}</v></c>`;
          if (typeof v === "string") return `<c r="${k}"${sAttr} t="str">${fx}<v>${esc(v)}</v></c>`;
          return `<c r="${k}"${sAttr}>${fx}</c>`;
        }
        const v = cell.v;
        if (typeof v === "number" && Number.isFinite(v)) return `<c r="${k}"${sAttr}><v>${v}</v></c>`;
        if (typeof v === "boolean") return `<c r="${k}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
        if (typeof v === "string" && XL_ERRORS.has(v)) return `<c r="${k}"${sAttr} t="e"><v>${esc(v)}</v></c>`;
        if (typeof v === "string") return `<c r="${k}"${sAttr} t="s"><v>${sIdx(v)}</v></c>`;
        return `<c r="${k}"${sAttr}/>`;
      });
      const ht = s.rows[r];
      const rAttr = ht === 0 ? ' hidden="1"' : ht != null ? ` ht="${Math.round(ht * 0.75 * 100) / 100}" customHeight="1"` : "";
      return `<row r="${r + 1}"${rAttr}>${cells.join("")}</row>`;
    });
    const colKeys = Object.keys(s.cols).map(Number).sort((a, b) => a - b);
    const cols = colKeys.length ? `<cols>${colKeys.map((c) => `<col min="${c + 1}" max="${c + 1}" width="${colChars(s.cols[c] || DEFAULT_COL)}"${s.cols[c] === 0 ? ' hidden="1"' : ""} customWidth="1"/>`).join("")}</cols>` : "";
    const fr = s.freeze;
    const pane = fr ? `<pane${fr.c ? ` xSplit="${fr.c}"` : ""}${fr.r ? ` ySplit="${fr.r}"` : ""} topLeftCell="${rcKey(fr.r, fr.c)}" activePane="${fr.r && fr.c ? "bottomRight" : fr.r ? "bottomLeft" : "topRight"}" state="frozen"/>` : "";
    const views = `<sheetViews><sheetView workbookViewId="0"${s.id === wb.active ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews>`;
    const used = usedRange(s);
    const dim = `<dimension ref="${used ? formatRange({ r0: 0, c0: 0, r1: used.r1, c1: used.c1 }) : "A1"}"/>`;
    const merges = s.merges.length ? `<mergeCells count="${s.merges.length}">${s.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
    const af = s.filter ? `<autoFilter ref="${s.filter.range}"/>` : "";
    let prio = 0;
    const OPS = { gt: "greaterThan", lt: "lessThan", ge: "greaterThanOrEqual", le: "lessThanOrEqual", eq: "equal", ne: "notEqual", between: "between" };
    const fv = (v) => (typeof v === "number" || (v !== "" && Number.isFinite(Number(v))) ? String(v) : `"${String(v ?? "").replace(/"/g, '""')}"`);
    const cf = s.cf.map((rule) => {
      const g = parseRange(rule.range);
      if (!g) return "";
      let body = "";
      if (OPS[rule.type]) body = `<cfRule type="cellIs" dxfId="${st.dxf(rule.style)}" priority="${++prio}" operator="${OPS[rule.type]}"><formula>${esc(fv(rule.a))}</formula>${rule.type === "between" ? `<formula>${esc(fv(rule.b))}</formula>` : ""}</cfRule>`;
      else if (rule.type === "contains") body = `<cfRule type="containsText" dxfId="${st.dxf(rule.style)}" priority="${++prio}" operator="containsText" text="${escAttr(rule.a ?? "")}"><formula>${esc(`NOT(ISERROR(SEARCH("${String(rule.a ?? "").replace(/"/g, '""')}",${rcKey(g.r0, g.c0)})))`)}</formula></cfRule>`;
      else if (rule.type === "blank") body = `<cfRule type="containsBlanks" dxfId="${st.dxf(rule.style)}" priority="${++prio}"><formula>LEN(TRIM(${rcKey(g.r0, g.c0)}))=0</formula></cfRule>`;
      else if (rule.type === "notBlank") body = `<cfRule type="notContainsBlanks" dxfId="${st.dxf(rule.style)}" priority="${++prio}"><formula>LEN(TRIM(${rcKey(g.r0, g.c0)}))&gt;0</formula></cfRule>`;
      else if (rule.type === "scale") {
        const [a, b] = (rule.colors || ["#f8696b", "#63be7b"]).map((c) => `FF${c.slice(1).toUpperCase()}`);
        body = `<cfRule type="colorScale" priority="${++prio}"><colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="${a}"/><color rgb="${b}"/></colorScale></cfRule>`;
      }
      return body ? `<conditionalFormatting sqref="${rule.range}">${body}</conditionalFormatting>` : "";
    }).join("");
    let drawing = "";
    const sheetRels = [];
    if (s.charts.length) {
      const dn = n;
      const dPath = `xl/drawings/drawing${dn}.xml`;
      ct.push(`<Override PartName="/${dPath}" ContentType="${CT.dr}"/>`);
      sheetRels.push(`<Relationship Id="rId1" Type="${REL("drawing")}" Target="../drawings/drawing${dn}.xml"/>`);
      drawing = '<drawing r:id="rId1"/>';
      const dRels = [];
      const anchors = s.charts.map((ch, k) => {
        const no = ++chartNo;
        const cPath = `xl/charts/chart${no}.xml`;
        ct.push(`<Override PartName="/${cPath}" ContentType="${CT.ch}"/>`);
        dRels.push(`<Relationship Id="rId${k + 1}" Type="${REL("chart")}" Target="../charts/chart${no}.xml"/>`);
        files.push([cPath, chartXml(ch, ch.sheet || s.name)]);
        const to = cellAt(s, ch.r, ch.c, ch.w, ch.h);
        return `<xdr:twoCellAnchor><xdr:from><xdr:col>${ch.c}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.r}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${to.c}</xdr:col><xdr:colOff>${to.dx * 9525}</xdr:colOff><xdr:row>${to.r}</xdr:row><xdr:rowOff>${to.dy * 9525}</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${k + 2}" name="Chart ${k + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${k + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
      });
      files.push([dPath, `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R_NS}">${anchors.join("")}</xdr:wsDr>`]);
      files.push([`xl/drawings/_rels/drawing${dn}.xml.rels`, `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${dRels.join("")}</Relationships>`]);
    }
    if (sheetRels.length) files.push([`xl/worksheets/_rels/sheet${n}.xml.rels`, `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels.join("")}</Relationships>`]);
    files.push([path, `${XML}<worksheet xmlns="${MAIN_NS}" xmlns:r="${R_NS}">${dim}${views}<sheetFormatPr defaultRowHeight="${DEFAULT_ROW * 0.75}"/>${cols}<sheetData>${rowXml.join("")}</sheetData>${af}${merges}${cf}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${drawing}</worksheet>`]);
    sheetEntries.push(`<sheet name="${escAttr(s.name)}" sheetId="${n}" r:id="rId${n}"/>`);
  });
  const nSheets = wb.sheets.length;
  const activeTab = Math.max(0, wb.sheets.findIndex((s) => s.id === wb.active));
  const filterNames = wb.sheets.map((s, i) => (s.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(absRange(s.name, parseRange(s.filter.range)))}</definedName>` : "")).join("");
  const workbook = `${XML}<workbook xmlns="${MAIN_NS}" xmlns:r="${R_NS}"><workbookPr/><bookViews><workbookView activeTab="${activeTab}"/></bookViews><sheets>${sheetEntries.join("")}</sheets>${filterNames ? `<definedNames>${filterNames}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  const wbRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wb.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL("worksheet")}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${nSheets + 1}" Type="${REL("styles")}" Target="styles.xml"/><Relationship Id="rId${nSheets + 2}" Type="${REL("sharedStrings")}" Target="sharedStrings.xml"/></Relationships>`;
  const sst = `${XML}<sst xmlns="${MAIN_NS}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`;
  const docTitle = title || wb.meta?.title || "";
  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(docTitle)}</dc:title><dc:creator>OpenFini</dc:creator></cp:coreProperties>`;
  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT.wb}"/>${ct.join("")}<Override PartName="/xl/styles.xml" ContentType="${CT.st}"/><Override PartName="/xl/sharedStrings.xml" ContentType="${CT.ss}"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL("officeDocument")}" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  return writeZip([["[Content_Types].xml", types], ["_rels/.rels", rootRels], ["docProps/core.xml", core], ["xl/workbook.xml", workbook], ["xl/_rels/workbook.xml.rels", wbRels], ["xl/styles.xml", st.xml()], ["xl/sharedStrings.xml", sst], ...files]);
}

/** The cell (and pixel offset inside it) where a box of w x h starting at (r, c) ends. */
function cellAt(s, r, c, w, h) {
  let cc = c;
  let x = w;
  while (x > (s.cols[cc] ?? DEFAULT_COL) && cc < c + 200) x -= s.cols[cc++] ?? DEFAULT_COL;
  let rr = r;
  let y = h;
  while (y > (s.rows[rr] ?? DEFAULT_ROW) && rr < r + 500) y -= s.rows[rr++] ?? DEFAULT_ROW;
  return { r: rr, c: cc, dx: Math.max(0, Math.round(x)), dy: Math.max(0, Math.round(y)) };
}

/** DrawingML chart part: series in columns (header row = names, first column = categories). */
function chartXml(ch, sheetName) {
  const g = parseRange(ch.range);
  const byRows = ch.seriesIn === "rows";
  const series = [];
  if (g) {
    if (!byRows) {
      for (let c = g.c0 + 1; c <= g.c1; c++) series.push({ name: { r0: g.r0, c0: c, r1: g.r0, c1: c }, cat: { r0: g.r0 + 1, c0: g.c0, r1: g.r1, c1: g.c0 }, val: { r0: g.r0 + 1, c0: c, r1: g.r1, c1: c } });
    } else {
      for (let r = g.r0 + 1; r <= g.r1; r++) series.push({ name: { r0: r, c0: g.c0, r1: r, c1: g.c0 }, cat: { r0: g.r0, c0: g.c0 + 1, r1: g.r0, c1: g.c1 }, val: { r0: r, c0: g.c0 + 1, r1: r, c1: g.c1 } });
    }
  }
  const t = ch.type;
  const isPie = t === "pie" || t === "donut";
  const ser = series.slice(0, isPie ? 1 : 64).map((x, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${esc(absRange(sheetName, x.name))}</c:f></c:strRef></c:tx>${t === "line" ? '<c:marker><c:symbol val="circle"/></c:marker>' : ""}<c:cat><c:strRef><c:f>${esc(absRange(sheetName, x.cat))}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${esc(absRange(sheetName, x.val))}</c:f></c:numRef></c:val>${t === "line" ? '<c:smooth val="0"/>' : ""}</c:ser>`).join("");
  const axes = '<c:axId val="111"/><c:axId val="222"/>';
  const axXml = '<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222"/></c:catAx><c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="111"/></c:valAx>';
  let plot;
  const grouping = t.startsWith("stacked") ? "stacked" : t.startsWith("percent") ? "percentStacked" : "clustered";
  if (isPie) plot = t === "donut" ? `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:holeSize val="60"/></c:doughnutChart>` : `<c:pieChart><c:varyColors val="1"/>${ser}</c:pieChart>`;
  else if (t === "line" || t === "scatter" || t === "radar") plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/>${axes}</c:lineChart>${axXml}`;
  else if (t === "area" || t === "stacked-area") plot = `<c:areaChart><c:grouping val="${t === "area" ? "standard" : "stacked"}"/><c:varyColors val="0"/>${ser}${axes}</c:areaChart>${axXml}`;
  else plot = `<c:barChart><c:barDir val="${t.includes("bar") ? "bar" : "col"}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${ser}${grouping !== "clustered" ? '<c:overlap val="100"/>' : ""}${axes}</c:barChart>${axXml.replace('<c:axPos val="b"/>', `<c:axPos val="${t.includes("bar") ? "l" : "b"}"/>`).replace('<c:axPos val="l"/>', `<c:axPos val="${t.includes("bar") ? "b" : "l"}"/>`)}`;
  const title = ch.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  return `${XML}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R_NS}"><c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="${isPie ? "r" : "b"}"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}
