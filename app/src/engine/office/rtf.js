// Rich Text Format (RTF 1.9 subset) reader and writer for the office document model. Pure (no DOM).
// Supported: character formatting, font and color tables, paragraphs and their spacing/indents/alignment, named
// styles, bulleted and numbered lists (\pn and \ls), tables with merged cells and shading, PNG/JPEG pictures, footnotes,
// hyperlinks, page number fields, headers/footers, page size and margins, Unicode (\uN with fallback).
import { createDocument, normalizeDoc, mergeRuns, tableGrid, resolveStyle, effectivePara, effectiveRun, normColor, safeHref, isText, PAGE_SIZES } from "./model.js";
import { imageSize, sniffImage } from "./media.js";
import { createReport, plural } from "./report.js";

const tw = (pt) => Math.round((pt || 0) * 20);

function rtfEscape(s) {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\" || ch === "{" || ch === "}") out += `\\${ch}`;
    else if (ch === "\t") out += "\\tab ";
    else if (c < 0x20) continue;
    else if (c < 0x80) out += ch;
    else if (c > 0xffff) {
      const hi = Math.floor((c - 0x10000) / 0x400) + 0xd800;
      const lo = ((c - 0x10000) % 0x400) + 0xdc00;
      out += `\\u${hi - 65536}?\\u${lo - 65536}?`;
    } else out += `\\u${c > 32767 ? c - 65536 : c}?`;
  }
  return out;
}

const hex = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
    if (i % 64 === 63) s += "\n";
  }
  return s;
};

/**
 * Writes RTF.
 * @param {object} input office document model
 * @param {{ svgFallbacks?: Record<string, Uint8Array> }} [o]
 * @returns {string}
 */
export function writeRtf(input, o = {}) {
  const doc = normalizeDoc(input);
  const fonts = ["Calibri"];
  const colors = [];
  const fontIdx = (f) => {
    let i = fonts.indexOf(f || "Calibri");
    if (i < 0) i = fonts.push(f) - 1;
    return i;
  };
  const colorIdx = (c) => {
    let i = colors.indexOf(c);
    if (i < 0) i = colors.push(c) - 1;
    return i + 1; // index 0 is "auto"
  };
  const styleIds = Object.keys(doc.styles).filter((id) => doc.styles[id].type !== "character");
  const sIdx = (id) => Math.max(0, styleIds.indexOf(id));

  const charFmt = (m) => {
    let x = `\\f${fontIdx(m.font)}\\fs${Math.round((m.size || 11) * 2)}`;
    if (m.b) x += "\\b";
    if (m.i) x += "\\i";
    if (m.u) x += "\\ul";
    if (m.s) x += "\\strike";
    if (m.va) x += m.va === "sub" ? "\\sub" : "\\super";
    if (m.color) x += `\\cf${colorIdx(m.color)}`;
    if (m.highlight) x += `\\highlight${colorIdx(m.highlight)}`;
    return `${x} `;
  };
  const paraFmt = (p, pp) => {
    let x = `\\s${sIdx(p.style)}`;
    if (pp.align) x += { left: "\\ql", center: "\\qc", right: "\\qr", justify: "\\qj" }[pp.align];
    if (pp.spaceBefore) x += `\\sb${tw(pp.spaceBefore)}`;
    if (pp.spaceAfter) x += `\\sa${tw(pp.spaceAfter)}`;
    if (pp.lineHeight) x += `\\sl${Math.round(pp.lineHeight * 240)}\\slmult1`;
    if (pp.indentLeft) x += `\\li${tw(pp.indentLeft)}`;
    if (pp.indentRight) x += `\\ri${tw(pp.indentRight)}`;
    if (pp.indentFirst) x += `\\fi${tw(pp.indentFirst)}`;
    if (pp.keepWithNext) x += "\\keepn";
    if (pp.pageBreakBefore) x += "\\pagebb";
    const lvl = resolveStyle(doc, p.style).outline;
    if (lvl) x += `\\outlinelevel${lvl - 1}`;
    return x;
  };
  const counters = new Map();
  const listPrefix = (p) => {
    if (!p.list) return "";
    const L = p.list.level || 0;
    const ind = 360 * (L + 1) * 2;
    if (p.list.kind === "bullet") return `{\\pntext\\f${fontIdx("Symbol")}\\'b7\\tab}{\\*\\pn\\pnlvlblt\\pnf${fontIdx("Symbol")}\\pnindent360{\\pntxtb\\'b7}}\\fi-360\\li${ind}`;
    const key = `${p.list.id}:${L}`;
    const n = (counters.get(key) || 0) + 1;
    counters.set(key, n);
    // deeper levels restart when a shallower item follows
    for (const k of [...counters.keys()]) if (k.startsWith(`${p.list.id}:`) && Number(k.split(":")[1]) > L) counters.delete(k);
    return `{\\pntext\\f0 ${n}.\\tab}{\\*\\pn\\pnlvlbody\\pndec\\pnstart1\\pnindent360{\\pntxta .}}\\fi-360\\li${ind}`;
  };
  const inline = (p, runs) => {
    let x = "";
    for (const r of runs) {
      if (isText(r)) {
        const m = effectiveRun(doc, p, r);
        const body = `{${charFmt(m)}${rtfEscape(r.text)}}`;
        x += r.link ? `{\\field{\\*\\fldinst HYPERLINK "${rtfEscape(r.link).replace(/"/g, "")}"}{\\fldrslt ${body}}}` : body;
      } else if (r.type === "break") x += "\\line ";
      else if (r.type === "field") x += `{\\field{\\*\\fldinst ${r.field === "page" ? "PAGE" : r.field === "pages" ? "NUMPAGES" : "DATE"}}{\\fldrslt 1}}`;
      else if (r.type === "footnote") {
        const body = (doc.footnotes[r.id] || []).map((fp) => `\\pard\\plain ${inline(fp, fp.runs.filter((x2) => x2.type !== "footnote"))}`).join("\\par ");
        x += `{\\super\\chftn}{\\footnote\\pard\\plain{\\super\\chftn} ${body}}`;
      } else if (r.type === "image") {
        const m = doc.media[r.media];
        const bytes = m?.mime === "image/svg+xml" ? o.svgFallbacks?.[r.media] : m?.bytes;
        const kind = m?.mime === "image/jpeg" ? "jpegblip" : bytes && sniffImage(bytes) === "image/png" ? "pngblip" : null;
        if (!kind) {
          x += r.alt ? `{${rtfEscape(`[${r.alt}]`)}}` : "";
          continue;
        }
        const size = imageSize(bytes) || { w: r.width / 0.75, h: r.height / 0.75 };
        x += `{\\pict\\${kind}\\picw${Math.round(size.w)}\\pich${Math.round(size.h)}\\picwgoal${tw(r.width)}\\pichgoal${tw(r.height)}\n${hex(bytes)}}`;
      }
    }
    return x;
  };
  const paraRtf = (p, intbl = false) => {
    const pp = effectivePara(doc, p);
    return `\\pard\\plain${intbl ? "\\intbl" : ""}${paraFmt(p, pp)}${listPrefix(p)} ${inline(p, p.runs)}`;
  };
  let body = "";
  for (const b of doc.blocks) {
    if (b.type === "paragraph") body += `${paraRtf(b)}\\par\n`;
    else if (b.type === "pageBreak") body += "\\page\n";
    else if (b.type === "rule") body += "\\pard\\plain\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\n";
    else if (b.type === "table") {
      const grid = tableGrid(b);
      const edges = [];
      let acc = 0;
      for (const c of b.cols) edges.push((acc += c));
      b.rows.forEach((row, r) => {
        let def = `\\trowd\\trgaph108\\trleft0${row.header ? "\\trhdr" : ""}`;
        let cells = "";
        for (let c = 0; c < b.cols.length; ) {
          const g = grid[r][c];
          const span = g ? g.colspan : 1;
          const right = edges[Math.min(edges.length - 1, c + span - 1)];
          const brd = b.borders.style === "none" ? "" : ["t", "l", "b", "r"].map((s) => `\\clbrdr${s}\\brdrs\\brdrw${Math.round(b.borders.width * 20)}\\brdrcf${colorIdx(b.borders.color)}`).join("");
          if (g && g.origin) {
            const cell = row.cells[g.ci];
            def += `${g.rowspan > 1 ? "\\clvmgf" : ""}${cell.vAlign === "middle" ? "\\clvertalc" : cell.vAlign === "bottom" ? "\\clvertalb" : ""}${cell.shading ? `\\clcbpat${colorIdx(cell.shading)}` : ""}${brd}\\cellx${tw(right)}`;
            cells += `${cell.blocks.map((p, k) => paraRtf(p, true) + (k < cell.blocks.length - 1 ? "\\par " : "")).join("")}\\cell\n`;
          } else {
            def += `${g && g.r < r ? "\\clvmrg" : ""}${brd}\\cellx${tw(right)}`;
            cells += "\\pard\\plain\\intbl \\cell\n";
          }
          c += span;
        }
        body += `${def}\n${cells}\\row\n`;
      });
      body += "\\pard\\plain\n";
    }
  }
  const hf = (kind, blocks) => (blocks.length ? `{\\${kind} ${blocks.map((p) => `${paraRtf(p)}\\par`).join(" ")}}\n` : "");
  const header = hf("header", doc.header);
  const footer = hf("footer", doc.footer);
  const pg = doc.page;
  const stylesheet = styleIds
    .map((id, i) => {
      const s = doc.styles[id];
      const pp = resolveStyle(doc, id);
      const name = /^Heading[1-9]$/.test(id) ? `heading ${id.slice(7)}` : s.name || id;
      return `{\\s${i}${s.basedOn ? `\\sbasedon${sIdx(s.basedOn)}` : ""}${s.next ? `\\snext${sIdx(s.next)}` : ""} ${paraFmt({ style: id }, pp.para).replace(/^\\s\d+/, "")}${charFmt(pp.run).trim()} ${rtfEscape(name)};}`;
    })
    .join("\n");
  const m = doc.meta;
  const info = `{\\info{\\title ${rtfEscape(m.title)}}{\\author ${rtfEscape(m.author)}}{\\subject ${rtfEscape(m.subject)}}{\\keywords ${rtfEscape(m.keywords)}}}`;
  const fontTbl = `{\\fonttbl${fonts.map((f, i) => `{\\f${i}\\f${/mono|courier|consol/i.test(f) ? "modern" : /times|georgia|serif|cambria|garamond/i.test(f) ? "roman" : f === "Symbol" ? "tech" : "swiss"}${f === "Symbol" ? "\\fcharset2" : "\\fcharset0"} ${rtfEscape(f)};}`).join("")}}`;
  const colorTbl = `{\\colortbl;${colors.map((c) => `\\red${parseInt(c.slice(1, 3), 16)}\\green${parseInt(c.slice(3, 5), 16)}\\blue${parseInt(c.slice(5, 7), 16)};`).join("")}}`;
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n${fontTbl}\n${colorTbl}\n{\\stylesheet\n${stylesheet}\n}\n${info}\n\\paperw${tw(pg.width)}\\paperh${tw(pg.height)}\\margl${tw(pg.margins.left)}\\margr${tw(pg.margins.right)}\\margt${tw(pg.margins.top)}\\margb${tw(pg.margins.bottom)}\\headery${tw(pg.margins.header)}\\footery${tw(pg.margins.footer)}${pg.orientation === "landscape" ? "\\landscape" : ""}${pg.columns > 1 ? `\\cols${pg.columns}\\colsx${tw(pg.columnGap)}` : ""}\n${header}${footer}${body}}`;
}

// =============================================================================================== reader

const SKIP_DESTS = new Set(["themedata", "colorschememapping", "latentstyles", "datastore", "xmlnstbl", "rsidtbl", "generator", "mmathPr", "listtext", "pntext", "pntxta", "pntxtb", "bkmkstart", "bkmkend", "fldtype", "nonshppict", "object", "objdata", "shpinst", "shppict", "do", "filetbl", "revtbl", "userprops", "xmlopen", "wgrffmtfilter", "pgdsctbl", "annotation", "atnid", "atnauthor", "atrfstart", "atrfend", "txfieldtext", "formfield", "ftnsep", "ftnsepc", "aftnsep", "aftnsepc", "headerl", "headerr", "headerf", "footerl", "footerr", "footerf", "template", "comment", "doccomm", "operator", "company", "category", "manager", "hlinkbase", "passwordhash", "docvar", "private", "blipuid"]);
const WIN1252 = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030, 0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178 };
const ansi = (b, symbol) => (symbol ? (b === 0xb7 ? "â€¢" : b === 0xa7 ? "â–ª" : String.fromCharCode(b)) : String.fromCodePoint(WIN1252[b] || b));

/**
 * Reads RTF.
 * @param {Uint8Array|string} input
 * @param {{report?: object, name?: string}} [o]
 */
export function readRtf(input, o = {}) {
  const report = o.report || createReport("Rich Text (RTF)", o.name);
  let s = typeof input === "string" ? input : latin1(input);
  if (!/^\s*\{\\rtf/.test(s)) throw new Error("This is not an RTF document.");
  if (s.length > 64 * 1024 * 1024) {
    report.note("The file is very large; only the first 64 MB were read.");
    s = s.slice(0, 64 * 1024 * 1024);
  }
  const model = createDocument();
  const fonts = new Map();
  const colors = [];
  const styleNames = new Map(); // \sN -> model style id
  const listKinds = new Map(); // \lsN -> bullet|number
  const counts = { tables: 0, images: 0, lists: 0, links: 0 };

  const baseChar = () => ({ b: false, i: false, u: false, s: false, va: null, color: null, highlight: null, font: null, size: null, symbol: false });
  const basePara = () => ({ style: 0, align: null, sb: null, sa: null, sl: null, li: null, ri: null, fi: null, keepn: false, pagebb: false, intbl: false, list: null, outline: null, brdrb: false });
  let st = { ch: baseChar(), pp: basePara(), uc: 1, dest: "body", skip: false };
  const stack = [];

  // sinks receive paragraphs: body, footnote, header, footer
  const newSink = (kind) => ({ kind, blocks: [], runs: [], row: null, rowDef: null, rowDefs: [], cells: [], table: null });
  const body = newSink("body");
  let sink = body;
  const sinkStack = [];

  // group-local buffers
  let fonttbl = null;
  let colortbl = null;
  let styleDef = null;
  let pict = null;
  let fld = null;
  let infoField = null;
  let listDef = null;

  const curMarks = () => {
    const c = st.ch;
    const m = {};
    if (c.b) m.b = true;
    if (c.i) m.i = true;
    if (c.u) m.u = true;
    if (c.s) m.s = true;
    if (c.va) m.va = c.va;
    if (c.color) m.color = c.color;
    if (c.highlight) m.highlight = c.highlight;
    if (c.font) m.font = c.font;
    if (c.size) m.size = c.size;
    if (fld?.link && st.dest === "fldrslt") m.link = fld.link;
    return m;
  };
  const emitText = (t) => {
    if (!t || st.skip) return;
    if (st.dest === "fonttbl") return void (fonttbl.name += t);
    if (st.dest === "stylesheet") return void (styleDef && (styleDef.name += t));
    if (st.dest === "pict") return void (pict.hex += t);
    if (st.dest === "fldinst") return void (fld.instr += t);
    if (st.dest === "info") return void (infoField && (model.meta[infoField] += t));
    if (st.dest === "listtable") return;
    if (!["body", "fldrslt", "footnote", "header", "footer"].includes(st.dest)) return;
    if (fld && st.dest === "fldrslt" && fld.field) return; // PAGE / NUMPAGES results are replaced by the field
    sink.runs.push({ text: t, ...curMarks() });
  };
  const paraOf = () => {
    const pp = st.pp;
    const p = { type: "paragraph", style: styleNames.get(pp.style) || "Normal", runs: mergeRuns(sink.runs) };
    const props = {};
    if (pp.align) props.align = pp.align;
    if (pp.sb != null) props.spaceBefore = pp.sb / 20;
    if (pp.sa != null) props.spaceAfter = pp.sa / 20;
    if (pp.sl != null && pp.sl > 0) props.lineHeight = pp.slmult ? pp.sl / 240 : Math.max(0.5, pp.sl / 20 / 12);
    if (pp.li != null) props.indentLeft = pp.li / 20;
    if (pp.ri != null) props.indentRight = pp.ri / 20;
    if (pp.fi != null) props.indentFirst = pp.fi / 20;
    if (pp.keepn) props.keepWithNext = true;
    if (pp.pagebb) props.pageBreakBefore = true;
    if (pp.list) {
      const lvl = String(pp.list.id).startsWith("pn") && pp.li ? Math.max(0, Math.round(pp.li / 720) - 1) : pp.list.level || 0;
      p.list = { kind: pp.list.kind, level: Math.min(8, lvl), id: pp.list.id };
      delete props.indentLeft;
      delete props.indentFirst;
      if (p.style === "Normal") p.style = "List";
      counts.lists++;
    }
    if (pp.outline != null && p.style === "Normal") p.style = `Heading${Math.min(6, pp.outline + 1)}`;
    // keep only what differs from the style
    const sp = model.styles[p.style] ? resolveStyle(model, p.style) : { para: {}, run: {} };
    for (const k of Object.keys(props)) if (sp.para[k] === props[k] || (sp.para[k] === undefined && !props[k] && k !== "align")) delete props[k];
    if (Object.keys(props).length) p.props = props;
    p.runs = p.runs.map((r) => {
      if (!isText(r)) return r;
      const out = { ...r };
      for (const k of ["font", "size", "color", "b", "i"]) if (out[k] !== undefined && sp.run[k] === out[k]) delete out[k];
      return out;
    });
    if (pp.brdrb && !p.runs.length) return { type: "rule" };
    return p;
  };
  const endPara = (force = false) => {
    const p = paraOf();
    sink.runs = [];
    if (st.pp.intbl && sink.kind === "body") {
      if (p.type === "paragraph") sink.cells.push(p);
    } else {
      if (sink.table) flushTable();
      sink.blocks.push(p);
    }
  };
  const flushTable = () => {
    const t = sink.table;
    sink.table = null;
    if (!t || !t.rows.length) return;
    // columns from the union of all cell boundaries
    const edges = [...new Set(t.rows.flatMap((r) => r.def.map((c) => c.x)))].sort((a, b) => a - b);
    const cols = edges.map((e, i) => Math.max(4, (e - (i ? edges[i - 1] : 0)) / 20));
    const rows = [];
    const active = [];
    t.rows.forEach((r) => {
      const row = { cells: [] };
      if (r.header) row.header = true;
      let prev = 0;
      r.def.forEach((d, k) => {
        const c0 = edges.findIndex((e) => e > prev);
        const c1 = edges.indexOf(d.x);
        prev = d.x;
        const span = Math.max(1, c1 - c0 + 1);
        if (d.vmrg && active[c0]) {
          active[c0].rowspan = (active[c0].rowspan || 1) + 1;
          return;
        }
        const cell = { blocks: r.cells[k]?.length ? r.cells[k] : [{ type: "paragraph", style: "Normal", runs: [] }] };
        if (span > 1) cell.colspan = span;
        if (d.shading) cell.shading = d.shading;
        if (d.valign) cell.vAlign = d.valign;
        active[c0] = d.vmgf ? cell : null;
        row.cells.push(cell);
      });
      if (row.cells.length) rows.push(row);
    });
    counts.tables++;
    sink.blocks.push({ type: "table", cols, rows, borders: t.borders ? { style: "single", width: t.borders.width, color: t.borders.color } : { style: "none", width: 0.5, color: "#808080" } });
  };

  let cellDef = { vmgf: false, vmrg: false, shading: null, valign: null };
  const n = s.length;
  readColorTable();
  let i = 0;
  let guard = 0;
  while (i < n) {
    if (++guard > 50_000_000) break;
    const c = s[i];
    if (c === "{") {
      if (stack.length > 300) {
        // absurd nesting: skip the group
        let d = 0;
        for (; i < n; i++) {
          if (s[i] === "\\") i++;
          else if (s[i] === "{") d++;
          else if (s[i] === "}" && --d === 0) break;
        }
        i++;
        continue;
      }
      stack.push({ st: { ch: { ...st.ch }, pp: { ...st.pp, list: st.pp.list }, uc: st.uc, dest: st.dest, skip: st.skip }, sinkDepth: sinkStack.length, special: null });
      i++;
      continue;
    }
    if (c === "}") {
      const fr = stack.pop();
      i++;
      if (!fr) continue;
      // close special destinations
      const dest = st.dest;
      if (fr.special === "pict" && pict) {
        const bytes = pict.bin || hexBytes(pict.hex);
        if (pict.kind && bytes.length) {
          const mime = pict.kind === "jpeg" ? "image/jpeg" : "image/png";
          const id = `img${Object.keys(model.media).length + 1}`;
          const size = imageSize(bytes, mime);
          model.media[id] = { id, mime, name: `${id}.${pict.kind === "jpeg" ? "jpg" : "png"}`, bytes, ...(size ? { w: size.w, h: size.h } : {}) };
          const w = pict.wgoal ? (pict.wgoal / 20) * (pict.scalex / 100) : (size?.w || 100) * 0.75;
          const h = pict.hgoal ? (pict.hgoal / 20) * (pict.scaley / 100) : (size?.h || 100) * 0.75;
          counts.images++;
          st = fr.st;
          sink.runs.push({ type: "image", media: id, width: w, height: h });
          pict = null;
          continue;
        }
        if (!pict.kind) report.dropped("Pictures in WMF/EMF or other formats.");
        pict = null;
      }
      if (fr.special === "fonttbl-entry" && fonttbl) {
        fonts.set(fonttbl.n, { name: fonttbl.name.replace(/;\s*$/, "").trim(), symbol: fonttbl.symbol });
        fonttbl = { n: -1, name: "" };
      }
      if (fr.special === "style" && styleDef) finishStyle();
      if (fr.special === "field") {
        if (fld?.field && sinkStack.length === fr.sinkDepth) {
          st = fr.st;
          sink.runs.push({ type: "field", field: fld.field });
          fld = fld.parent;
          continue;
        }
        fld = fld?.parent || null;
      }
      if (fr.special === "fldinst" && fld) {
        const instr = fld.instr.trim();
        const k = instr.split(/\s+/)[0]?.toUpperCase();
        fld.field = k === "PAGE" ? "page" : k === "NUMPAGES" || k === "SECTIONPAGES" ? "pages" : k === "DATE" || k === "TIME" ? "date" : null;
        const h = /^HYPERLINK\s+"?([^"\s]+)"?/i.exec(instr);
        if (h) {
          fld.link = safeHref(h[1]);
          if (fld.link) counts.links++;
        }
      }
      if (fr.special === "list") {
        if (listDef) listKinds.set(`id${listDef.id}`, listDef.kind);
        listDef = null;
      }
      if (fr.special === "listoverride" && fr.override) listKinds.set(`ls${fr.override.ls}`, listKinds.get(`id${fr.override.id}`) || "bullet");
      if (fr.special === "sink") {
        // end of footnote / header / footer
        if (sink.runs.length) endPara();
        if (sink.table) flushTable();
        const done = sink;
        sink = sinkStack.pop() || body;
        const paras = done.blocks.filter((b) => b.type === "paragraph");
        if (done.kind === "footnote") {
          const id = `fn${Object.keys(model.footnotes).length + 1}`;
          if (paras[0]?.runs[0]?.text) paras[0].runs[0] = { ...paras[0].runs[0], text: paras[0].runs[0].text.replace(/^\s+/, "") };
          model.footnotes[id] = paras.map((p) => ({ ...p, style: "Normal" }));
          st = fr.st;
          sink.runs.push({ type: "footnote", id });
          continue;
        }
        if (done.kind === "header" || done.kind === "footer") model[done.kind] = paras.filter((p) => p.runs.length).slice(0, 20);
      }
      if (dest === "info") infoField = null;
      st = fr.st;
      continue;
    }
    if (c === "\\") {
      const nx = s[i + 1];
      if (nx === undefined) break;
      if (!/[a-zA-Z]/.test(nx)) {
        i += 2;
        if (nx === "'") {
          const b = parseInt(s.substr(i, 2), 16);
          i += 2;
          if (Number.isFinite(b)) emitText(ansi(b, st.ch.symbol));
        } else if (nx === "*") {
          if (stack.length) stack[stack.length - 1].ignorable = true;
        } else if (nx === "~") emitText("\u00a0");
        else if (nx === "_") emitText("\u2011");
        else if (nx === "-") void 0;
        else if (nx === "\\" || nx === "{" || nx === "}") emitText(nx);
        else if (nx === "\n" || nx === "\r") {
          if (!st.skip && ["body", "footnote", "header", "footer"].includes(st.dest)) endPara();
        } else if (nx === "|" || nx === ":") void 0;
        continue;
      }
      let j = i + 1;
      while (j < n && /[a-zA-Z]/.test(s[j])) j++;
      const word = s.slice(i + 1, j);
      let k = j;
      if (s[k] === "-" || /\d/.test(s[k] || "")) {
        k++;
        while (k < n && /\d/.test(s[k])) k++;
      }
      const param = k > j ? parseInt(s.slice(j, k), 10) : null;
      if (s[k] === " ") k++;
      i = k;
      handleWord(word, param);
      continue;
    }
    if (c === "\r" || c === "\n") {
      i++;
      continue;
    }
    // plain text run
    let j = i;
    while (j < n && s[j] !== "\\" && s[j] !== "{" && s[j] !== "}" && s[j] !== "\r" && s[j] !== "\n") j++;
    let t = s.slice(i, j);
    i = j;
    if (st.ucSkip) {
      const cut = Math.min(st.ucSkip, t.length);
      t = t.slice(cut);
      st.ucSkip -= cut;
    }
    emitText(st.ch.symbol ? [...t].map((ch) => ansi(ch.charCodeAt(0), true)).join("") : t);
  }
  while (sinkStack.length) sink = sinkStack.pop();
  if (body.runs.length) {
    sink = body;
    endPara();
  }
  if (body.table) {
    sink = body;
    flushTable();
  }

  function finishStyle() {
    const name = styleDef.name.replace(/;\s*$/, "").trim();
    const lname = name.toLowerCase();
    let id;
    const h = /^heading ([1-9])$/.exec(lname);
    if (h) id = `Heading${Math.min(6, +h[1])}`;
    else id = { normal: "Normal", title: "Title", subtitle: "Subtitle", quote: "Quote", "list paragraph": "List", code: "Code" }[lname] || name.replace(/[^\w -]/g, "").slice(0, 60);
    if (id && styleDef.type === "para") {
      styleNames.set(styleDef.n, id);
      const sp = styleDef.pp;
      const para = {};
      if (sp.align) para.align = sp.align;
      if (sp.sb != null) para.spaceBefore = sp.sb / 20;
      if (sp.sa != null) para.spaceAfter = sp.sa / 20;
      if (sp.li != null) para.indentLeft = sp.li / 20;
      if (sp.keepn) para.keepWithNext = true;
      if (sp.sl) para.lineHeight = sp.slmult ? sp.sl / 240 : 1;
      const run = {};
      const ch = styleDef.ch;
      if (ch.b) run.b = true;
      if (ch.i) run.i = true;
      if (ch.font) run.font = ch.font;
      if (ch.size) run.size = ch.size;
      if (ch.color) run.color = ch.color;
      const def = model.styles[id] || {};
      model.styles[id] = { ...def, name: def.name || name, type: "paragraph", para: { ...(def.para || {}), ...para }, run: { ...(def.run || {}), ...run }, ...(id !== "Normal" ? { basedOn: def.basedOn || "Normal" } : {}) };
    }
    styleDef = null;
  }

  function handleWord(w, p) {
    const fr = stack[stack.length - 1];
    // destinations
    const startDest = (d, special) => {
      st.dest = d;
      if (fr) fr.special = special || d;
    };
    if (st.skip && w !== "bin") return;
    switch (w) {
      case "rtf":
      case "ansi":
      case "deff":
        return;
      case "ansicpg":
        if (p && p !== 1252 && p !== 0) report.note(`The document uses code page ${p}; non-Unicode characters were read as Windows-1252.`);
        return;
      case "fonttbl":
        startDest("fonttbl", "fonttbl");
        fonttbl = { n: -1, name: "" };
        return;
      case "f":
        if (st.dest === "fonttbl") {
          fonttbl = { n: p, name: "", symbol: false };
          if (fr) fr.special = "fonttbl-entry";
          return;
        }
        if (st.dest === "stylesheet" && styleDef) styleDef.ch.font = fonts.get(p)?.name || null;
        st.ch.font = fonts.get(p)?.name || null;
        st.ch.symbol = !!fonts.get(p)?.symbol;
        return;
      case "fcharset":
        if (st.dest === "fonttbl" && fonttbl && p === 2) fonttbl.symbol = true;
        return;
      case "colortbl":
        startDest("colortbl");
        colortbl = { r: 0, g: 0, b: 0, any: false };
        return;
      case "red":
      case "green":
      case "blue":
        if (st.dest === "colortbl") {
          colortbl[w[0]] = p || 0;
          colortbl.any = true;
        }
        return;
      case "stylesheet":
        startDest("stylesheet");
        return;
      case "info":
        startDest("info");
        return;
      case "title":
      case "author":
      case "subject":
      case "keywords":
        if (st.dest === "info") {
          infoField = w === "keywords" ? "keywords" : w;
          model.meta[infoField] = "";
        }
        return;
      case "pict":
        startDest("pict", "pict");
        pict = { hex: "", kind: null, wgoal: 0, hgoal: 0, scalex: 100, scaley: 100, bin: null };
        return;
      case "pngblip":
        if (pict) pict.kind = "png";
        return;
      case "jpegblip":
        if (pict) pict.kind = "jpeg";
        return;
      case "picwgoal":
        if (pict) pict.wgoal = p || 0;
        return;
      case "pichgoal":
        if (pict) pict.hgoal = p || 0;
        return;
      case "picscalex":
        if (pict) pict.scalex = p || 100;
        return;
      case "picscaley":
        if (pict) pict.scaley = p || 100;
        return;
      case "bin":
        if (p > 0) {
          if (pict && !st.skip) pict.bin = Uint8Array.from(s.slice(i, i + p), (ch) => ch.charCodeAt(0) & 255);
          i += p;
        }
        return;
      case "field":
        if (fr) fr.special = "field";
        fld = { instr: "", field: null, link: null, parent: fld };
        return;
      case "fldinst":
        startDest("fldinst", "fldinst");
        return;
      case "fldrslt":
        st.dest = "fldrslt";
        return;
      case "footnote":
      case "header":
      case "footer":
      case "headerl": {
        const kind = w === "headerl" ? null : w;
        if (!kind) {
          st.skip = true;
          return;
        }
        sinkStack.push(sink);
        sink = newSink(kind);
        st.dest = kind;
        st.pp = basePara();
        if (fr) fr.special = "sink";
        if (kind === "footnote" && fr?.ignorable) fr.ignorable = false;
        return;
      }
      case "listtable":
      case "listoverridetable":
        startDest("listtable", "listtable");
        return;
      case "list":
        if (st.dest === "listtable") {
          listDef = { id: null, kind: null };
          if (fr) fr.special = "list";
        }
        return;
      case "listid":
        if (listDef) listDef.id = p;
        else if (fr?.override) fr.override.id = p;
        return;
      case "levelnfc":
        if (listDef && listDef.kind === null) listDef.kind = p === 23 || p === 255 ? "bullet" : "number";
        return;
      case "listoverride":
        if (fr) {
          fr.special = "listoverride";
          fr.override = { id: null, ls: null };
        }
        return;
      case "ls":
        if (fr?.override && st.dest === "listtable") fr.override.ls = p;
        else st.pp.list = { kind: listKinds.get(`ls${p}`) || "bullet", level: st.pp.ilvl || 0, id: `r${p}` };
        return;
      case "ilvl":
        st.pp.ilvl = p || 0;
        if (st.pp.list) st.pp.list = { ...st.pp.list, level: p || 0 };
        return;
      case "pn":
        startDest("pn", "pn");
        st.pp.list = st.pp.list || { kind: "bullet", level: 0, id: "pn" };
        return;
      case "pnlvlblt":
        st.pp.list = { ...(st.pp.list || {}), kind: "bullet", level: st.pp.list?.level || 0, id: "pnb" };
        if (stack.length) stack[stack.length - 1].st.pp.list = st.pp.list;
        return;
      case "pnlvlbody":
      case "pndec":
      case "pnucltr":
      case "pnlcltr":
      case "pnucrm":
      case "pnlcrm":
        st.pp.list = { ...(st.pp.list || {}), kind: "number", level: st.pp.list?.level || 0, id: st.pp.list?.id === "pnb" || !st.pp.list?.id ? "pnn" : st.pp.list.id };
        if (stack.length) stack[stack.length - 1].st.pp.list = st.pp.list;
        return;
      case "pnlvl":
        if (st.pp.list) st.pp.list = { ...st.pp.list, level: Math.max(0, (p || 1) - 1) };
        if (stack.length) stack[stack.length - 1].st.pp.list = st.pp.list;
        return;
      case "s":
        if (st.dest === "stylesheet") {
          styleDef = { n: p || 0, name: "", type: "para", pp: basePara(), ch: baseChar() };
          if (fr) fr.special = "style";
        } else st.pp.style = p || 0;
        return;
      case "cs":
      case "ds":
      case "ts":
        if (st.dest === "stylesheet") {
          styleDef = { n: p || 0, name: "", type: "other", pp: basePara(), ch: baseChar() };
          if (fr) fr.special = "style";
        }
        return;
      // ---- character formatting
      case "plain":
        st.ch = { ...baseChar(), font: fonts.get(0)?.name || null };
        return;
      case "b":
      case "i":
      case "strike":
        (styleDef && st.dest === "stylesheet" ? styleDef.ch : st.ch)[w === "strike" ? "s" : w] = p !== 0;
        return;
      case "ul":
      case "uld":
      case "uldb":
      case "ulw":
      case "ulth":
      case "uldash":
      case "ulwave":
        st.ch.u = p !== 0;
        return;
      case "ulnone":
        st.ch.u = false;
        return;
      case "super":
        st.ch.va = "super";
        return;
      case "sub":
        st.ch.va = "sub";
        return;
      case "nosupersub":
        st.ch.va = null;
        return;
      case "fs":
        if (styleDef && st.dest === "stylesheet") styleDef.ch.size = (p || 24) / 2;
        else st.ch.size = (p || 24) / 2;
        return;
      case "cf":
        if (styleDef && st.dest === "stylesheet") styleDef.ch.color = colors[p] || null;
        else st.ch.color = colors[p] || null;
        return;
      case "highlight":
      case "cb":
      case "chcbpat":
        st.ch.highlight = colors[p] || null;
        return;
      // ---- paragraphs
      case "pard":
        st.pp = { ...basePara(), intbl: false };
        return;
      case "par":
        if (["body", "footnote", "header", "footer"].includes(st.dest)) endPara(true);
        return;
      case "line":
        if (!st.skip) sink.runs.push({ type: "break" });
        return;
      case "tab":
        emitText("\t");
        return;
      case "emdash":
        return emitText("â€”");
      case "endash":
        return emitText("â€“");
      case "bullet":
        return emitText("â€¢");
      case "lquote":
        return emitText("â€˜");
      case "rquote":
        return emitText("â€™");
      case "ldblquote":
        return emitText("â€œ");
      case "rdblquote":
        return emitText("â€");
      case "page":
        if (st.dest === "body") {
          if (sink.runs.length) endPara();
          if (sink.table) flushTable();
          sink.blocks.push({ type: "pageBreak" });
        }
        return;
      case "ql":
      case "qc":
      case "qr":
      case "qj":
        (styleDef && st.dest === "stylesheet" ? styleDef.pp : st.pp).align = { ql: "left", qc: "center", qr: "right", qj: "justify" }[w];
        return;
      case "sb":
      case "sa":
      case "li":
      case "ri":
      case "fi":
      case "sl":
        (styleDef && st.dest === "stylesheet" ? styleDef.pp : st.pp)[w] = p || 0;
        return;
      case "slmult":
        (styleDef && st.dest === "stylesheet" ? styleDef.pp : st.pp).slmult = p !== 0;
        return;
      case "keepn":
        (styleDef && st.dest === "stylesheet" ? styleDef.pp : st.pp).keepn = true;
        return;
      case "pagebb":
        st.pp.pagebb = true;
        return;
      case "outlinelevel":
        st.pp.outline = p;
        return;
      case "brdrb":
        st.pp.brdrb = true;
        return;
      // ---- tables
      case "trowd":
        cellDef = { vmgf: false, vmrg: false, shading: null, valign: null };
        sink.rowDef = { def: [], header: false, borders: null };
        return;
      case "trhdr":
        if (sink.rowDef) sink.rowDef.header = true;
        return;
      case "clvmgf":
        cellDef.vmgf = true;
        return;
      case "clvmrg":
        cellDef.vmrg = true;
        return;
      case "clcbpat":
        cellDef.shading = colors[p] || null;
        return;
      case "clvertalc":
        cellDef.valign = "middle";
        return;
      case "clvertalb":
        cellDef.valign = "bottom";
        return;
      case "brdrw":
        if (sink.rowDef) sink.rowDef.borders = { width: Math.max(0.25, (p || 10) / 20), color: sink.rowDef.borders?.color || "#000000" };
        return;
      case "brdrcf":
        if (sink.rowDef) sink.rowDef.borders = { width: sink.rowDef.borders?.width || 0.5, color: colors[p] || "#000000" };
        return;
      case "cellx":
        if (sink.rowDef) sink.rowDef.def.push({ x: p || 0, ...cellDef });
        cellDef = { vmgf: false, vmrg: false, shading: null, valign: null };
        return;
      case "intbl":
        st.pp.intbl = true;
        return;
      case "cell":
      case "nestcell":
        if (sink.runs.length || !sink.cells.length) {
          const save = st.pp.intbl;
          st.pp.intbl = true;
          endPara();
          st.pp.intbl = save;
        }
        sink.row = sink.row || [];
        sink.row.push(sink.cells);
        sink.cells = [];
        if (w === "nestcell") report.flattened("Nested tables were simplified.");
        return;
      case "row":
      case "nestrow": {
        if (!sink.table) sink.table = { rows: [], borders: null };
        const def = sink.rowDef || { def: [], header: false };
        const cells = sink.row || [];
        while (def.def.length < cells.length) def.def.push({ x: (def.def[def.def.length - 1]?.x || 0) + 1440 });
        sink.table.rows.push({ def: def.def.slice(0, Math.max(cells.length, def.def.length)), cells, header: def.header });
        if (def.borders) sink.table.borders = def.borders;
        sink.row = null;
        return;
      }
      // ---- section / page
      case "paperw":
        model.page.width = (p || 11906) / 20;
        return;
      case "paperh":
        model.page.height = (p || 16838) / 20;
        return;
      case "margl":
      case "margr":
      case "margt":
      case "margb":
        model.page.margins[{ margl: "left", margr: "right", margt: "top", margb: "bottom" }[w]] = (p || 0) / 20;
        return;
      case "headery":
        model.page.margins.header = (p || 720) / 20;
        return;
      case "footery":
        model.page.margins.footer = (p || 720) / 20;
        return;
      case "landscape":
        model.page.orientation = "landscape";
        return;
      case "cols":
        if (p > 1) model.page.columns = Math.min(4, p);
        return;
      case "chftn":
        return;
      case "u": {
        let cp = p < 0 ? p + 65536 : p;
        if (cp >= 0xd800 && cp < 0xdc00) {
          st.hiSurrogate = cp;
        } else if (cp >= 0xdc00 && cp < 0xe000 && st.hiSurrogate) {
          emitText(String.fromCharCode(st.hiSurrogate, cp));
          st.hiSurrogate = 0;
        } else if (Number.isFinite(cp)) emitText(String.fromCodePoint(Math.min(0x10ffff, Math.max(0, cp))));
        st.ucSkip = st.uc;
        skipFallback();
        return;
      }
      case "uc":
        st.uc = Math.max(0, p ?? 1);
        return;
      default:
        if (fr?.ignorable && !fr.special) {
          st.skip = true;
          return;
        }
        if (SKIP_DESTS.has(w)) {
          st.skip = true;
          if (w === "annotation") report.dropped("Comments.");
          return;
        }
    }
  }

  function skipFallback() {
    // skip `uc` fallback characters: a \'hh escape counts as one
    let left = st.ucSkip || 0;
    while (left > 0 && i < n) {
      if (s[i] === "\\" && s[i + 1] === "'") {
        i += 4;
        left--;
      } else if (s[i] === "\\" || s[i] === "{" || s[i] === "}") break;
      else {
        i++;
        left--;
      }
    }
    st.ucSkip = 0;
  }

  // color table entries are terminated by ';' inside the colortbl group: handled after the fact by a scan
  function readColorTable() {
    const m = /\{\\colortbl\s*;?([^}]*)\}/.exec(s);
    if (!m) return;
    const entries = m[0].replace(/^\{\\colortbl/, "").replace(/\}$/, "").split(";");
    entries.pop();
    entries.forEach((e, k) => {
      const r = /\\red(\d+)/.exec(e);
      const g = /\\green(\d+)/.exec(e);
      const b = /\\blue(\d+)/.exec(e);
      colors[k] = r && g && b ? normColor(`#${[r, g, b].map((x) => Math.min(255, +x[1]).toString(16).padStart(2, "0")).join("")}`) : null;
    });
  }

  model.blocks = body.blocks;
  model.page.size = Object.keys(PAGE_SIZES).find((k) => Math.abs(PAGE_SIZES[k].width - Math.min(model.page.width, model.page.height)) < 3 && Math.abs(PAGE_SIZES[k].height - Math.max(model.page.width, model.page.height)) < 3) || "custom";
  if (model.page.width > model.page.height) model.page.orientation = "landscape";
  report.kept(`${plural(model.blocks.filter((b) => b.type === "paragraph").length, "paragraph")} with text formatting.`);
  if (counts.lists) report.kept(`${plural(counts.lists, "list paragraph")}.`);
  if (counts.tables) report.kept(`${plural(counts.tables, "table")}.`);
  if (counts.images) report.kept(`${plural(counts.images, "picture")}.`);
  if (Object.keys(model.footnotes).length) report.kept(`${plural(Object.keys(model.footnotes).length, "footnote")}.`);
  return { doc: normalizeDoc(model), report };
}

function latin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return s;
}

function hexBytes(h) {
  const clean = h.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

