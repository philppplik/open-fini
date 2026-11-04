// OpenDocument spreadsheet (.ods, flat .fods, .ots templates) reader and writer for the Spreadsheet app. Pure; uses
// the zip limits and XML parser of engine/office. Formulas are converted between OpenFormula ("of:=SUM([.A1:.B2])")
// and the app's A1 syntax. Tests: tests/office/sheet-codecs.test.js.
//
// Public API
//   readOds(bytes, { report }) → workbook model
//   writeOds(model, { calc, title }) → Uint8Array
//   fromOdfFormula(text) / toOdfFormula(formula)
import { readZip, writeZip, strFromU8, isZip } from "../../engine/office/zip.js";
import { parseXml, child, children, find, findAll, textOf, attr, esc, escAttr } from "../../engine/office/xml.js";
import { parseRange, formatRange } from "../toolkit/selection.js";
import { newWorkbook, newSheet, normalizeWorkbook, DEFAULT_COL, DEFAULT_ROW } from "./model.js";
import { keyRC, rcKey, isErr, formatTokens, refText } from "./formula.js";
import { dateToSerial, isDateCode } from "./numfmt-code.js";

export const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";
const MAX_REPEAT_FILL = 1024; // repeated *non-empty* cells/rows are expanded up to this many times
const LIMIT_ROWS = 1048576;
const LIMIT_COLS = 16384;

const len = (s) => {
  const m = /^([\d.]+)\s*(cm|mm|in|pt|pc|px)?$/.exec(String(s || "").trim());
  if (!m) return null;
  const v = Number(m[1]);
  const k = { cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, pc: 16, px: 1 }[m[2] || "px"];
  return Math.round(v * k);
};

// ------------------------------------------------------------------------------------------------------ formulas

/** "of:=SUM([.A1:.B3])+['Other sheet'.C1]" → "SUM(A1:B3)+'Other sheet'!C1" */
export function fromOdfFormula(text) {
  let s = String(text || "").replace(/^(?:of|oooc|msoxl):/i, "").replace(/^=/, "");
  let out = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      q = !q;
      out += ch;
      continue;
    }
    if (q) {
      out += ch;
      continue;
    }
    if (ch === "[") {
      const j = s.indexOf("]", i);
      if (j < 0) {
        out += ch;
        continue;
      }
      out += odfRef(s.slice(i + 1, j));
      i = j;
      continue;
    }
    out += ch === ";" ? "," : ch;
  }
  return out;
}

function odfRef(inner) {
  const part = (p) => {
    const m = /^\$?(?:'((?:[^']|'')+)'|([^.']*))\.(\$?[A-Za-z]{1,3}\$?\d+)$/.exec(p.trim());
    if (!m) return null;
    const sheet = m[1] != null ? m[1].replace(/''/g, "'") : m[2] || null;
    return { sheet, cell: m[3] };
  };
  const [a, b] = inner.split(":");
  const pa = part(a);
  if (!pa) return "#REF!";
  const pb = b != null ? part(b) : null;
  const sh = pa.sheet ? `${/^[A-Za-z_][\w.]*$/.test(pa.sheet) && !/^[A-Za-z]{1,3}\d+$/.test(pa.sheet) ? pa.sheet : `'${pa.sheet.replace(/'/g, "''")}'`}!` : "";
  return `${sh}${pa.cell}${pb ? `:${pb.cell}` : ""}`;
}

/** "SUM(A1:B3)+Sheet2!C1" → "of:=SUM([.A1:.B3])+[$Sheet2.C1]" */
export function toOdfFormula(formula) {
  return `of:=${formatTokens(formula, { ref: odfText, comma: ";" }) ?? formula}`;
}

function odfText(ref) {
  const sh = ref.sheet != null ? `$'${ref.sheet.replace(/'/g, "''")}'` : "";
  const a = refText({ r: ref.r, c: ref.c, absR: ref.absR, absC: ref.absC });
  if (ref.r1 === undefined) return `[${sh}.${a}]`;
  const b = refText({ r: ref.r1, c: ref.c1, absR: ref.absR1, absC: ref.absC1 });
  return `[${sh}.${a}:${sh ? sh : ""}.${b}]`;
}

// ------------------------------------------------------------------------------------------------------ reader

function readStyles(docs) {
  const data = new Map(); // data style name → code
  const cells = new Map(); // cell style name → style
  const cols = new Map(); // column style → px
  const rows = new Map(); // row style → px
  for (const doc of docs) {
    if (!doc) continue;
    for (const el of [...findAll(doc, "number-style"), ...findAll(doc, "percentage-style"), ...findAll(doc, "currency-style"), ...findAll(doc, "date-style"), ...findAll(doc, "time-style")]) {
      data.set(attr(el, "style:name"), dataStyleCode(el));
    }
    for (const st of findAll(doc, "style")) {
      const name = attr(st, "style:name");
      const fam = attr(st, "style:family");
      if (fam === "table-column") {
        const w = len(attr(child(st, "table-column-properties"), "style:column-width"));
        if (w) cols.set(name, w);
      } else if (fam === "table-row") {
        const p = child(st, "table-row-properties");
        const h = len(attr(p, "style:row-height"));
        if (h && attr(p, "style:use-optimal-row-height") !== "true") rows.set(name, h);
      } else if (fam === "table-cell") {
        const s = {};
        const tp = child(st, "text-properties");
        const cp = child(st, "table-cell-properties");
        const pp = child(st, "paragraph-properties");
        if (attr(tp, "fo:font-weight") === "bold") s.b = true;
        if (attr(tp, "fo:font-style") === "italic") s.i = true;
        if (attr(tp, "style:text-underline-style") && attr(tp, "style:text-underline-style") !== "none") s.u = true;
        if (attr(tp, "style:text-line-through-style") && attr(tp, "style:text-line-through-style") !== "none") s.st = true;
        const color = attr(tp, "fo:color");
        if (/^#[0-9a-f]{6}$/i.test(color || "") && color.toLowerCase() !== "#000000") s.color = color.toLowerCase();
        const size = parseFloat(attr(tp, "fo:font-size"));
        if (size && size !== 10 && size !== 11) s.size = size;
        const font = attr(tp, "style:font-name");
        if (font) s.font = font;
        const bg = attr(cp, "fo:background-color");
        if (/^#[0-9a-f]{6}$/i.test(bg || "")) s.fill = bg.toLowerCase();
        const ha = attr(pp, "fo:text-align");
        if (ha === "center") s.ha = "center";
        else if (ha === "end" || ha === "right") s.ha = "right";
        else if (ha === "start" || ha === "left") s.ha = "left";
        const va = attr(cp, "style:vertical-align");
        if (va === "top" || va === "bottom") s.va = va;
        else if (va === "middle") s.va = "middle";
        if (attr(cp, "fo:wrap-option") === "wrap") s.wrap = true;
        const bd = {};
        for (const [k, a] of [["t", "fo:border-top"], ["r", "fo:border-right"], ["b", "fo:border-bottom"], ["l", "fo:border-left"]]) {
          const v = attr(cp, a) || attr(cp, "fo:border");
          const m = /#[0-9a-f]{6}/i.exec(v || "");
          if (v && v !== "none" && m) bd[k] = m[0].toLowerCase();
        }
        if (Object.keys(bd).length) s.bd = bd;
        const ds = attr(st, "style:data-style-name");
        if (ds) s._ds = ds;
        const parent = attr(st, "style:parent-style-name");
        cells.set(name, { s, parent });
      }
    }
  }
  const resolved = new Map();
  for (const [name, { s }] of cells) {
    const out = { ...s };
    if (out._ds) {
      const code = data.get(out._ds);
      if (code && code !== "General") out.nf = code;
      delete out._ds;
    }
    resolved.set(name, Object.keys(out).length ? out : null);
  }
  return { cells: resolved, cols, rows };
}

function dataStyleCode(el) {
  const kind = el.local;
  if (kind === "date-style" || kind === "time-style") {
    let code = "";
    for (const c of el.children) {
      if (typeof c === "string") continue;
      const long = attr(c, "number:style") === "long";
      switch (c.local) {
        case "year":
          code += long ? "yyyy" : "yy";
          break;
        case "month":
          code += attr(c, "number:textual") === "true" ? (long ? "mmmm" : "mmm") : long ? "mm" : "m";
          break;
        case "day":
          code += long ? "dd" : "d";
          break;
        case "day-of-week":
          code += long ? "dddd" : "ddd";
          break;
        case "hours":
          code += long ? "hh" : "h";
          break;
        case "minutes":
          code += long ? "mm" : "m";
          break;
        case "seconds":
          code += long ? "ss" : "s";
          break;
        case "am-pm":
          code += "AM/PM";
          break;
        case "text":
          code += textOf(c).replace(/[a-zA-Z]/g, (x) => `\\${x}`);
          break;
      }
    }
    return code || (kind === "date-style" ? "yyyy-mm-dd" : "hh:mm");
  }
  const num = find(el, "number") || find(el, "scientific-number");
  const dec = Number(attr(num, "number:decimal-places") ?? 0) || 0;
  const grouping = attr(num, "number:grouping") === "true";
  let body = `${grouping ? "#,##0" : "0"}${dec ? `.${"0".repeat(dec)}` : ""}`;
  if (num?.local === "scientific-number") body += "E+00";
  let code = "";
  for (const c of el.children) {
    if (typeof c === "string") continue;
    if (c.local === "number" || c.local === "scientific-number") code += body;
    else if (c.local === "text") code += textOf(c) === "%" ? "%" : textOf(c) ? `"${textOf(c).replace(/"/g, "")}"` : "";
    else if (c.local === "currency-symbol") code += `"${textOf(c)}"`;
  }
  return code || "General";
}

export function readOds(bytes, { report = null } = {}) {
  let content;
  let styles = null;
  let settings = null;
  let meta = null;
  if (isZip(bytes)) {
    const { entries, problems, ok } = readZip(bytes, { want: (n) => n === "content.xml" || n === "styles.xml" || n === "settings.xml" || n === "meta.xml" || n === "mimetype" });
    for (const p of problems) report?.note?.(p);
    if (!ok || !entries["content.xml"]) throw new Error("This file is not an OpenDocument spreadsheet (content.xml is missing).");
    content = parseXml(strFromU8(entries["content.xml"]));
    if (entries["styles.xml"]) styles = parseXml(strFromU8(entries["styles.xml"]));
    if (entries["settings.xml"]) settings = parseXml(strFromU8(entries["settings.xml"]));
    if (entries["meta.xml"]) meta = parseXml(strFromU8(entries["meta.xml"]));
  } else {
    content = parseXml(new TextDecoder().decode(bytes)); // flat XML (.fods)
    styles = content;
    settings = content;
    meta = content;
  }
  const st = readStyles([styles, content]);
  const body = find(content, "spreadsheet");
  if (!body) throw new Error("This file is not an OpenDocument spreadsheet.");
  const sheets = [];
  for (const table of children(body, "table")) sheets.push(readTable(table, st, sheets.length, report));
  if (!sheets.length) sheets.push(newSheet("Sheet1", "s1", 1));
  // frozen panes and the active sheet live in settings.xml
  let activeName = null;
  if (settings) {
    for (const item of findAll(settings, "config-item")) if (attr(item, "config:name") === "ActiveTable") activeName = textOf(item);
    for (const entry of findAll(settings, "config-item-map-entry")) {
      const name = attr(entry, "config:name");
      const sh = sheets.find((s) => s.name === name);
      if (!sh) continue;
      const get = (k) => textOf(children(entry, "config-item").find((i) => attr(i, "config:name") === k));
      const fr = { r: get("VerticalSplitMode") === "2" ? Number(get("VerticalSplitPosition")) || 0 : 0, c: get("HorizontalSplitMode") === "2" ? Number(get("HorizontalSplitPosition")) || 0 : 0 };
      if (fr.r || fr.c) sh.freeze = fr;
    }
  }
  const title = meta ? textOf(find(meta, "title")) : "";
  report?.kept?.(`${sheets.length} sheet${sheets.length === 1 ? "" : "s"}, values, formulas, number formats, fonts, fills, borders, alignment, merged cells, column widths, row heights`);
  const active = sheets.find((s) => s.name === activeName) || sheets[0];
  return normalizeWorkbook({ ...newWorkbook(), sheets, active: active.id, meta: { title } });
}

function readTable(table, st, index, report) {
  const s = newSheet(attr(table, "table:name") || `Sheet${index + 1}`, `s${index + 1}`, index + 1);
  let c = 0;
  for (const col of findAll(table, "table-column")) {
    const n = Math.min(Number(attr(col, "table:number-columns-repeated")) || 1, LIMIT_COLS);
    const w = attr(col, "table:visibility") === "collapse" ? 0 : st.cols.get(attr(col, "table:style-name"));
    if (w != null && w !== DEFAULT_COL && n <= MAX_REPEAT_FILL) for (let k = 0; k < n; k++) s.cols[c + k] = w;
    c += n;
  }
  let r = 0;
  const rowsOf = (el, out = []) => {
    for (const ch of el.children) {
      if (typeof ch === "string") continue;
      if (ch.local === "table-row") out.push(ch);
      else if (ch.local === "table-row-group" || ch.local === "table-header-rows" || ch.local === "table-rows") rowsOf(ch, out);
    }
    return out;
  };
  let annotations = 0;
  for (const row of rowsOf(table)) {
    const repeat = Math.min(Number(attr(row, "table:number-rows-repeated")) || 1, LIMIT_ROWS - r);
    const cellsEls = children(row).filter((x) => x.local === "table-cell" || x.local === "covered-table-cell");
    const hasContent = cellsEls.some((x) => x.local === "table-cell" && (attr(x, "office:value-type") || attr(x, "table:formula") || attr(x, "table:number-columns-spanned") || attr(x, "table:number-rows-spanned") || x.children.length));
    const h = attr(row, "table:visibility") === "collapse" ? 0 : st.rows.get(attr(row, "table:style-name"));
    const times = hasContent ? Math.min(repeat, MAX_REPEAT_FILL) : 1;
    for (let k = 0; k < times; k++) {
      if (h != null && h !== DEFAULT_ROW && repeat <= MAX_REPEAT_FILL) s.rows[r + k] = h;
      if (!hasContent) continue;
      let cc = 0;
      for (const cel of cellsEls) {
        const n = Math.min(Number(attr(cel, "table:number-columns-repeated")) || 1, LIMIT_COLS - cc);
        if (cel.local === "covered-table-cell") {
          cc += n;
          continue;
        }
        const style = st.cells.get(attr(cel, "table:style-name")) || null;
        const cell = readCell(cel, style);
        if (find(cel, "annotation")) annotations++;
        if (cell) {
          const reps = cell.v !== undefined || cell.f !== undefined ? Math.min(n, MAX_REPEAT_FILL) : Math.min(n, 64);
          for (let j = 0; j < reps; j++) s.cells[rcKey(r + k, cc + j)] = cell;
        }
        const rs = Number(attr(cel, "table:number-rows-spanned")) || 1;
        const cs = Number(attr(cel, "table:number-columns-spanned")) || 1;
        if ((rs > 1 || cs > 1) && k === 0) s.merges.push(formatRange({ r0: r, c0: cc, r1: r + rs - 1, c1: cc + cs - 1 }));
        cc += n;
      }
    }
    r += repeat;
    if (r >= LIMIT_ROWS) break;
  }
  if (annotations) report?.dropped?.("Cell comments (annotations).");
  return s;
}

function readCell(el, style) {
  const type = attr(el, "office:value-type");
  const f = attr(el, "table:formula");
  const cell = {};
  if (f) cell.f = fromOdfFormula(f);
  else if (type === "float" || type === "percentage" || type === "currency") cell.v = Number(attr(el, "office:value"));
  else if (type === "boolean") cell.v = attr(el, "office:boolean-value") === "true";
  else if (type === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?))?/.exec(attr(el, "office:date-value") || "");
    if (m) cell.v = dateToSerial(+m[1], +m[2], +m[3]) + (m[4] ? (+m[4] * 3600 + +m[5] * 60 + +m[6]) / 86400 : 0);
  } else if (type === "time") {
    const m = /^PT(\d+)H(\d+)M(\d+(?:\.\d+)?)S$/.exec(attr(el, "office:time-value") || "");
    if (m) cell.v = (+m[1] * 3600 + +m[2] * 60 + +m[3]) / 86400;
  } else {
    const ps = children(el, "p");
    if (ps.length) cell.v = ps.map(textOf).join("\n");
  }
  if (typeof cell.v === "number" && !Number.isFinite(cell.v)) delete cell.v;
  let s = style;
  if (type === "percentage" && !s?.nf) s = { ...(s || {}), nf: "0%" };
  if (type === "date" && !s?.nf) s = { ...(s || {}), nf: "yyyy-mm-dd" };
  if (type === "time" && !s?.nf) s = { ...(s || {}), nf: "hh:mm" };
  if (s) cell.s = s;
  return cell.v !== undefined || cell.f !== undefined || cell.s ? cell : null;
}

// ------------------------------------------------------------------------------------------------------ writer

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';
const cm = (px) => `${(px / (96 / 2.54)).toFixed(3)}cm`;

/** A data style (number:*-style) for a number format code, or null when it is General. */
function dataStyleXml(name, code) {
  if (!code || code === "General" || code === "@") return null;
  if (isDateCode(code)) {
    const parts = [];
    const re = /yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|"[^"]*"|\\.|./gi;
    const toks = code.match(re) || [];
    toks.forEach((t, i) => {
      const low = t.toLowerCase();
      const prev = (toks[i - 1] || "").toLowerCase();
      const next = (toks[i + 1] || toks[i + 2] || "").toLowerCase();
      const minute = (low === "m" || low === "mm") && (prev.startsWith("h") || /^:/.test(toks[i - 1] || "") || next.startsWith("s") || (toks[i - 2] || "").toLowerCase().startsWith("h"));
      if (low === "yyyy" || low === "yy") parts.push(`<number:year${low === "yyyy" ? ' number:style="long"' : ""}/>`);
      else if (minute) parts.push(`<number:minutes${low === "mm" ? ' number:style="long"' : ""}/>`);
      else if (/^m+$/.test(low)) parts.push(`<number:month${low.length >= 3 ? ' number:textual="true"' : ""}${low.length === 2 || low.length === 4 ? ' number:style="long"' : ""}/>`);
      else if (low === "dddd" || low === "ddd") parts.push(`<number:day-of-week${low === "dddd" ? ' number:style="long"' : ""}/>`);
      else if (low === "dd" || low === "d") parts.push(`<number:day${low === "dd" ? ' number:style="long"' : ""}/>`);
      else if (low === "hh" || low === "h") parts.push(`<number:hours${low === "hh" ? ' number:style="long"' : ""}/>`);
      else if (low === "ss" || low === "s") parts.push(`<number:seconds${low === "ss" ? ' number:style="long"' : ""}/>`);
      else if (low === "am/pm") parts.push("<number:am-pm/>");
      else parts.push(`<number:text>${esc(t.replace(/^"|"$/g, "").replace(/^\\/, ""))}</number:text>`);
    });
    const tag = /[hs]/i.test(code) && !/[dy]/i.test(code) ? "time-style" : "date-style";
    return `<number:${tag} style:name="${name}">${parts.join("")}</number:${tag}>`;
  }
  const sec = code.split(";")[0];
  const pct = sec.includes("%");
  const dec = (/\.([0#]+)/.exec(sec)?.[1] || "").length;
  const grouping = /#,##0|0,0/.test(sec);
  const sci = /E[+-]/i.test(sec);
  const lit = /"([^"]*)"/.exec(sec)?.[1] || (/\[\$([^\]-]+)/.exec(sec)?.[1] ?? "");
  const before = lit && sec.indexOf(lit) < sec.search(/[0#]/);
  const numEl = sci ? `<number:scientific-number number:decimal-places="${dec}" number:min-integer-digits="1" number:min-exponent-digits="2"/>` : `<number:number number:decimal-places="${dec}" number:min-decimal-places="${dec}" number:min-integer-digits="1"${grouping ? ' number:grouping="true"' : ""}/>`;
  if (pct) return `<number:percentage-style style:name="${name}">${numEl}<number:text>%</number:text></number:percentage-style>`;
  if (lit) {
    const sym = `<number:currency-symbol>${esc(lit.trim())}</number:currency-symbol>`;
    return `<number:currency-style style:name="${name}">${before ? sym + numEl : `${numEl}<number:text> </number:text>${sym}`}</number:currency-style>`;
  }
  return `<number:number-style style:name="${name}">${numEl}</number:number-style>`;
}

export function writeOds(model, { calc = null, title = "" } = {}) {
  const wb = normalizeWorkbook(model);
  const auto = [];
  const dataStyles = [];
  const cellStyle = new Map();
  const colStyle = new Map();
  const rowStyle = new Map();
  const dsName = new Map();
  const styleFor = (s) => {
    if (!s) return null;
    const key = JSON.stringify(s);
    if (cellStyle.has(key)) return cellStyle.get(key);
    const name = `ce${cellStyle.size + 1}`;
    let ds = "";
    if (s.nf) {
      if (!dsName.has(s.nf)) {
        const n = `N${dsName.size + 100}`;
        const xml = dataStyleXml(n, s.nf);
        dsName.set(s.nf, xml ? n : null);
        if (xml) dataStyles.push(xml);
      }
      if (dsName.get(s.nf)) ds = ` style:data-style-name="${dsName.get(s.nf)}"`;
    }
    const bd = s.bd ? ["t", "r", "b", "l"].map((k, i) => (s.bd[k] ? ` fo:border-${["top", "right", "bottom", "left"][i]}="0.06pt solid ${s.bd[k]}"` : "")).join("") : "";
    const cp = `${s.fill ? ` fo:background-color="${s.fill}"` : ""}${s.va ? ` style:vertical-align="${s.va}"` : ""}${s.wrap ? ' fo:wrap-option="wrap"' : ""}${bd}`;
    const tp = `${s.b ? ' fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"' : ""}${s.i ? ' fo:font-style="italic"' : ""}${s.u ? ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : ""}${s.st ? ' style:text-line-through-style="solid"' : ""}${s.color ? ` fo:color="${s.color}"` : ""}${s.size ? ` fo:font-size="${s.size}pt"` : ""}${s.font ? ` style:font-name="${escAttr(s.font)}" fo:font-family="${escAttr(s.font)}"` : ""}`;
    const pp = s.ha ? ` fo:text-align="${s.ha === "left" ? "start" : s.ha === "right" ? "end" : "center"}"` : "";
    auto.push(`<style:style style:name="${name}" style:family="table-cell" style:parent-style-name="Default"${ds}>${cp ? `<style:table-cell-properties${cp}/>` : ""}${pp ? `<style:paragraph-properties${pp}/>` : ""}${tp ? `<style:text-properties${tp}/>` : ""}</style:style>`);
    cellStyle.set(key, name);
    return name;
  };
  const sizeStyle = (map, prefix, px, family, prop) => {
    if (!map.has(px)) {
      const name = `${prefix}${map.size + 1}`;
      map.set(px, name);
      auto.push(`<style:style style:name="${name}" style:family="${family}"><style:${family}-properties ${prop}="${cm(px)}"${family === "table-row" ? ' style:use-optimal-row-height="false"' : ""}/></style:style>`);
    }
    return map.get(px);
  };
  const defCol = sizeStyle(colStyle, "co", DEFAULT_COL, "table-column", "style:column-width");
  const defRow = sizeStyle(rowStyle, "ro", DEFAULT_ROW, "table-row", "style:row-height");
  const tables = wb.sheets.map((s) => {
    let rows = 0;
    let cols = 0;
    const byRow = new Map();
    for (const [k, cell] of Object.entries(s.cells)) {
      const { r, c } = keyRC(k);
      rows = Math.max(rows, r + 1);
      cols = Math.max(cols, c + 1);
      if (!byRow.has(r)) byRow.set(r, new Map());
      byRow.get(r).set(c, [k, cell]);
    }
    const spans = new Map();
    const covered = new Set();
    for (const m of s.merges) {
      const g = parseRange(m);
      spans.set(rcKey(g.r0, g.c0), g);
      rows = Math.max(rows, g.r1 + 1);
      cols = Math.max(cols, g.c1 + 1);
      for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) if (r !== g.r0 || c !== g.c0) covered.add(rcKey(r, c));
    }
    for (const k of Object.keys(s.rows)) rows = Math.max(rows, Number(k) + 1);
    for (const k of Object.keys(s.cols)) cols = Math.max(cols, Number(k) + 1);
    cols = Math.max(cols, 1);
    const colXml = [];
    for (let c = 0; c < cols; c++) colXml.push(`<table:table-column table:style-name="${s.cols[c] != null ? sizeStyle(colStyle, "co", s.cols[c] || 1, "table-column", "style:column-width") : defCol}"${s.cols[c] === 0 ? ' table:visibility="collapse"' : ""} table:default-cell-style-name="Default"/>`);
    const rowXml = [];
    for (let r = 0; r < rows; r++) {
      const line = byRow.get(r);
      const cellsXml = [];
      for (let c = 0; c < cols; c++) {
        const k = rcKey(r, c);
        if (covered.has(k)) {
          cellsXml.push("<table:covered-table-cell/>");
          continue;
        }
        const cell = line?.get(c)?.[1];
        const g = spans.get(k);
        const span = g ? ` table:number-columns-spanned="${g.c1 - g.c0 + 1}" table:number-rows-spanned="${g.r1 - g.r0 + 1}"` : "";
        if (!cell) {
          cellsXml.push(span ? `<table:table-cell${span}/>` : "<table:table-cell/>");
          continue;
        }
        const sn = styleFor(cell.s);
        const sa = sn ? ` table:style-name="${sn}"` : "";
        let v = cell.v;
        let fx = "";
        if (typeof cell.f === "string") {
          fx = ` table:formula="${escAttr(toOdfFormula(cell.f))}"`;
          v = calc ? calc.value(s.id, k) : null;
          if (isErr(v)) v = null;
        }
        let val;
        if (typeof v === "number" && Number.isFinite(v)) {
          const pct = cell.s?.nf?.includes("%");
          const date = cell.s?.nf && isDateCode(cell.s.nf);
          if (date) {
            const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
            val = ` office:value-type="date" office:date-value="${d.toISOString().slice(0, 19)}"`;
          } else val = ` office:value-type="${pct ? "percentage" : "float"}" office:value="${v}"`;
        } else if (typeof v === "boolean") val = ` office:value-type="boolean" office:boolean-value="${v}"`;
        else if (v != null && v !== "") val = ' office:value-type="string"';
        else val = "";
        const textP = v != null && v !== "" ? `<text:p>${esc(typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v))}</text:p>` : "";
        cellsXml.push(`<table:table-cell${sa}${fx}${val}${span}>${textP}</table:table-cell>`);
      }
      // trim trailing empty cells
      while (cellsXml.length > 1 && cellsXml[cellsXml.length - 1] === "<table:table-cell/>") cellsXml.pop();
      const rs = s.rows[r] != null ? sizeStyle(rowStyle, "ro", s.rows[r] || 1, "table-row", "style:row-height") : defRow;
      rowXml.push(`<table:table-row table:style-name="${rs}"${s.rows[r] === 0 ? ' table:visibility="collapse"' : ""}>${cellsXml.join("")}</table:table-row>`);
    }
    if (!rowXml.length) rowXml.push(`<table:table-row table:style-name="${defRow}"><table:table-cell/></table:table-row>`);
    return `<table:table table:name="${escAttr(s.name)}">${colXml.join("")}${rowXml.join("")}</table:table>`;
  });
  const dbRanges = wb.sheets.filter((s) => s.filter).map((s, i) => {
    const g = parseRange(s.filter.range);
    const q = `$'${s.name.replace(/'/g, "''")}'`;
    return `<table:database-range table:name="__Anonymous_Sheet_DB__${i}" table:target-range-address="${escAttr(`${q}.${rcKey(g.r0, g.c0)}:${q}.${rcKey(g.r1, g.c1)}`)}" table:display-filter-buttons="true"/>`;
  });
  const content = `${XML}<office:document-content ${NS} office:version="1.3"><office:automatic-styles>${dataStyles.join("")}${auto.join("")}</office:automatic-styles><office:body><office:spreadsheet>${tables.join("")}${dbRanges.length ? `<table:database-ranges>${dbRanges.join("")}</table:database-ranges>` : ""}</office:spreadsheet></office:body></office:document-content>`;
  const stylesXml = `${XML}<office:document-styles ${NS} office:version="1.3"><office:styles><style:style style:name="Default" style:family="table-cell"/></office:styles></office:document-styles>`;
  const active = wb.sheets.find((s) => s.id === wb.active) || wb.sheets[0];
  const tableSettings = wb.sheets.map((s) => {
    const fr = s.freeze;
    const item = (n, t, v) => `<config:config-item config:name="${n}" config:type="${t}">${v}</config:config-item>`;
    const body = fr ? item("HorizontalSplitMode", "short", fr.c ? 2 : 0) + item("VerticalSplitMode", "short", fr.r ? 2 : 0) + item("HorizontalSplitPosition", "int", fr.c) + item("VerticalSplitPosition", "int", fr.r) + item("ActiveSplitRange", "short", 2) + item("PositionLeft", "int", 0) + item("PositionRight", "int", fr.c) + item("PositionTop", "int", 0) + item("PositionBottom", "int", fr.r) : "";
    return `<config:config-item-map-entry config:name="${escAttr(s.name)}">${body}</config:config-item-map-entry>`;
  });
  const settingsXml = `${XML}<office:document-settings ${NS} office:version="1.3"><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry><config:config-item config:name="ActiveTable" config:type="string">${esc(active.name)}</config:config-item><config:config-item-map-named config:name="Tables">${tableSettings.join("")}</config:config-item-map-named></config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set></office:settings></office:document-settings>`;
  const metaXml = `${XML}<office:document-meta ${NS} office:version="1.3"><office:meta><meta:generator>OpenFini</meta:generator>${title || wb.meta?.title ? `<dc:title>${esc(title || wb.meta.title)}</dc:title>` : ""}</office:meta></office:document-meta>`;
  const manifest = `${XML}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODS_MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  return writeZip([["mimetype", ODS_MIME, { store: true }], ["META-INF/manifest.xml", manifest], ["content.xml", content], ["styles.xml", stylesXml], ["settings.xml", settingsXml], ["meta.xml", metaXml]]);
}

export { DEFAULT_COL, DEFAULT_ROW };
