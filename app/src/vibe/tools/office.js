// Vibe tools for the Office Studio: read, write and format word-processing documents, page setup and export.
// Every change is one undoable step of the document history (core/office.js commitOffice).
import { tool, S } from "./helpers.js";
import * as M from "../../engine/office/model.js";
import { commitOffice } from "../../core/office.js";

const MARK_PROPS = {
  bold: S.bool("Bold"),
  italic: S.bool("Italic"),
  underline: S.bool("Underline"),
  strike: S.bool("Strikethrough"),
  superscript: S.bool("Superscript"),
  subscript: S.bool("Subscript"),
  color: S.str("Text color, #rrggbb"),
  highlight: S.str("Highlight color #rrggbb, or \"none\""),
  font: S.str("Font family, e.g. Calibri, Georgia"),
  size: S.num("Font size in points", { minimum: 4, maximum: 400 }),
  link: S.str("https:// or mailto: address; empty string removes the link"),
};
const PARA_PROPS = {
  align: S.str("left | center | right | justify", { enum: ["left", "center", "right", "justify"] }),
  spaceBefore: S.num("Space before in points"),
  spaceAfter: S.num("Space after in points"),
  lineHeight: S.num("Line spacing multiple, e.g. 1, 1.15, 1.5, 2"),
  indentLeft: S.num("Left indent in points"),
  indentFirst: S.num("First-line indent in points (negative = hanging)"),
  keepWithNext: S.bool("Keep with the next paragraph"),
};
const POSITION = {
  position: S.str("Where to insert: end (default), start, after or before the block `index`, or caret (the user's cursor)", { enum: ["end", "start", "after", "before", "caret"] }),
  index: S.num("Block index from office_read_document (for position after / before)"),
};
const BLOCK_TYPES = ["paragraph", "heading", "title", "subtitle", "bullet", "number", "quote", "code", "pageBreak", "rule"];

function toMarks(m = {}) {
  const out = {};
  for (const [k, key] of [["bold", "b"], ["italic", "i"], ["underline", "u"], ["strike", "s"]]) if (k in m) out[key] = m[k] ? true : null;
  if (m.superscript) out.va = "super";
  else if (m.subscript) out.va = "sub";
  else if (m.superscript === false || m.subscript === false) out.va = null;
  if (m.color) out.color = M.normColor(m.color) || null;
  if ("highlight" in m) out.highlight = m.highlight && m.highlight !== "none" ? M.normColor(m.highlight) || null : null;
  if (m.font) out.font = String(m.font).slice(0, 64);
  if (m.size) out.size = Math.max(1, Math.min(400, Number(m.size)));
  if ("link" in m) out.link = m.link ? M.safeHref(m.link) || null : null;
  return out;
}

export function officeTools(app) {
  const docOf = () => {
    const d = app.doc;
    if (!d?.office) throw new Error("The active document is not an Office document. Call office_new_document, or ask the user to open a Word, ODT or RTF file (File ▸ Open).");
    if (d.office.kind && d.office.kind !== "document") throw new Error(`The active Office document is a ${d.office.kind}, not a text document: use office_describe and the tools of that app.`);
    if (d.office.model._raw || d.office.model.version !== M.OFFICE_VERSION) d.office.model = M.normalizeDoc(d.office.model);
    return d;
  };
  const model = () => docOf().office.model;
  const commit = (label, next) => {
    const d = docOf();
    if (app.officeUI?.doc === d) app.officeUI.editor.commit(next, { label: `Vibe: ${label}` });
    else commitOffice(d, `Vibe: ${label}`, next);
  };
  const inlineRuns = async (text) => {
    // inline Markdown (**bold**, *italic*, `code`, [link](url)) for a single paragraph
    if (!/[*_`[\\]/.test(text)) return [{ text }];
    const { readMarkdown } = await import("../../engine/office/markdown.js");
    const p = readMarkdown(text.replace(/\n/g, " ")).doc.blocks.find((b) => b.type === "paragraph");
    return p ? p.runs : [{ text }];
  };
  const toBlocks = async (specs) => {
    const out = [];
    const ids = {};
    let prevKind = null;
    for (const s of specs) {
      const type = s.type || "paragraph";
      if (type === "pageBreak" || type === "rule") {
        out.push({ type });
        prevKind = null;
        continue;
      }
      const runs = await inlineRuns(String(s.text ?? ""));
      const style = s.style || null;
      if (type === "bullet" || type === "number") {
        if (prevKind !== type) ids[type] = M.uid("v");
        out.push(M.para(runs, style || "List", { list: { kind: type, level: Math.max(0, Math.min(8, s.level | 0)), id: ids[type] } }));
        prevKind = type;
        continue;
      }
      prevKind = null;
      const map = { heading: `Heading${Math.max(1, Math.min(6, s.level || 1))}`, title: "Title", subtitle: "Subtitle", quote: "Quote", code: "Code", paragraph: "Normal" };
      out.push(M.para(type === "code" ? [{ text: String(s.text ?? "") }] : runs, style || map[type] || "Normal"));
    }
    return out;
  };
  const insertAt = (m, blocks, { position = "end", index }) => {
    let at = m.blocks.length;
    if (position === "start") at = 0;
    else if (position === "after" || position === "before") {
      if (!Number.isInteger(index) || index < 0 || index >= m.blocks.length) throw new Error(`index must be a block index between 0 and ${m.blocks.length - 1} (see office_read_document).`);
      at = position === "after" ? index + 1 : index;
    } else if (position === "caret" && app.officeUI?.doc === app.doc) at = app.officeUI.editor.sel.focus.path[0] + 1;
    else if (position === "end") {
      // replace a trailing empty paragraph
      const last = m.blocks[m.blocks.length - 1];
      if (last?.type === "paragraph" && !last.runs.length) at = m.blocks.length - 1;
    }
    const list = m.blocks.slice();
    const replaceEmpty = position === "end" && at === m.blocks.length - 1;
    list.splice(at, replaceEmpty ? 1 : 0, ...blocks);
    for (let k = list.length - 1; k > 0; k--) if (list[k].type === "table" && list[k - 1].type === "table") list.splice(k, 0, M.para(""));
    if (list[list.length - 1].type !== "paragraph") list.push(M.para(""));
    return { doc: { ...m, blocks: list }, at };
  };
  const describe = (m, b, i) => {
    if (b.type === "paragraph") {
      const lvl = M.headingLevel(m, b);
      const kind = lvl ? `heading ${lvl}` : b.list ? `${b.list.kind} level ${b.list.level}` : b.style === "Normal" ? "paragraph" : `paragraph (${m.styles[b.style]?.name || b.style})`;
      return { index: i, kind, style: b.style, text: M.paraText(b).replace(/\uFFFC/g, "[object]").slice(0, 600) };
    }
    if (b.type === "table") return { index: i, kind: "table", rows: b.rows.length, columns: b.cols.length, cells: b.rows.slice(0, 6).map((r) => r.cells.map((c) => c.blocks.map(M.paraText).join(" ").slice(0, 80))) };
    return { index: i, kind: b.type };
  };

  return [
    tool("office_new_document", "Creates a new Office Studio text document (Word-style, with pages) and switches to the Office Studio. Optional template: blank, letter, report or resume.", {
      title: S.str("Document name"),
      size: S.str("Paper size", { enum: ["A4", "Letter", "Legal", "A5"] }),
      orientation: S.str("portrait or landscape", { enum: ["portrait", "landscape"] }),
      template: S.str("blank (default), letter, report or resume", { enum: ["blank", "letter", "report", "resume"] }),
    }, [], async ({ title = "Untitled document", size = "A4", orientation = "portrait", template = "blank" }) => {
      const { templateModel } = await import("../../ui/office/dialogs.js");
      const { openOfficeModel } = await import("../../ui/office/open.js");
      const m = templateModel(template, size, orientation);
      m.meta.title = title;
      openOfficeModel(app, m, { name: title, saved: false });
      return { ok: true, name: title, blocks: m.blocks.length, page: `${size} ${orientation}` };
    }),

    tool("office_read_document", "Reads the active Office document: page setup, named styles, outline and every block (paragraphs with style and text, lists, tables) with its index for the other office_ tools.", {
      from: S.num("First block index (default 0)"),
      maxBlocks: S.num("Maximum blocks to return (default 300)"),
    }, [], ({ from = 0, maxBlocks = 300 }) => {
      const m = model();
      const st = M.stats(m);
      const blocks = m.blocks.slice(from, from + Math.max(1, Math.min(2000, maxBlocks))).map((b, k) => describe(m, b, from + k));
      return {
        name: app.doc.name,
        title: m.meta.title,
        page: { size: m.page.size, orientation: m.page.orientation, widthPt: m.page.width, heightPt: m.page.height, marginsPt: m.page.margins },
        header: m.header.map(M.paraText).join(" / "),
        footer: m.footer.map((p) => p.runs.map((r) => (M.isText(r) ? r.text : r.type === "field" ? `{${r.field.toUpperCase()}}` : "")).join("")).join(" / "),
        styles: Object.entries(m.styles).filter(([, s]) => s.type !== "character").map(([id, s]) => ({ id, name: s.name })),
        outline: M.outline(m).map((o) => ({ index: o.path[0], level: o.level, text: o.text })),
        stats: st,
        totalBlocks: m.blocks.length,
        blocks,
      };
    }, { readOnly: true }),

    tool("office_find", "Finds text in the active Office document (plain text, whole words or a regular expression). Returns the block index and the surrounding text of each match.", {
      query: S.str("Text or regular expression"),
      regex: S.bool("Treat query as a regular expression"),
      caseSensitive: S.bool("Match case"),
      wholeWord: S.bool("Whole words only"),
    }, ["query"], ({ query, regex = false, caseSensitive = false, wholeWord = false }) => {
      const m = model();
      const found = M.findMatches(m, query, { regex, caseSensitive, wholeWord, limit: 200 });
      return {
        count: found.length,
        matches: found.slice(0, 50).map((f) => {
          const t = M.paraText(M.getBlock(m, f.path));
          return { index: f.path[0], inTable: f.path.length > 1, text: f.text, context: `${t.slice(Math.max(0, f.from - 40), f.from)}[${f.text}]${t.slice(f.to, f.to + 40)}`.replace(/\uFFFC/g, "") };
        }),
      };
    }, { readOnly: true }),

    tool("office_insert_blocks", "Inserts content into the active Office document. Either `markdown` (headings, lists, tables, emphasis) or `blocks` [{type: paragraph|heading|title|subtitle|bullet|number|quote|code|pageBreak|rule, text, level}] where text may use **bold**, *italic* and [links](https://…).", {
      markdown: S.str("Markdown content to insert"),
      blocks: { type: "array", description: "Blocks to insert", items: { type: "object", properties: { type: { type: "string", enum: BLOCK_TYPES }, text: { type: "string" }, level: { type: "number", description: "Heading level 1-6, or list level 0-8" }, style: { type: "string", description: "Named style id (overrides type)" } }, required: ["type"] } },
      ...POSITION,
    }, [], async ({ markdown, blocks, position = "end", index }) => {
      let add;
      let media = {};
      if (markdown) {
        const { readMarkdown } = await import("../../engine/office/markdown.js");
        const d = readMarkdown(markdown).doc;
        add = d.blocks.filter((b, k, a) => !(k === a.length - 1 && b.type === "paragraph" && !b.runs.length));
        media = d.media;
      } else if (blocks?.length) add = await toBlocks(blocks);
      else throw new Error("Pass `markdown` or `blocks`.");
      const m = model();
      const r = insertAt({ ...m, media: { ...m.media, ...media } }, add, { position, index });
      commit("Insert", r.doc);
      return { inserted: add.length, at: r.at };
    }),

    tool("office_replace_text", "Replaces text in the active Office document (all occurrences by default). Formatting of the replaced text follows the first replaced character. Use regex with $1 groups for patterns.", {
      find: S.str("Text (or regular expression) to find"),
      replace: S.str("Replacement text"),
      regex: S.bool("Regular expression mode"),
      caseSensitive: S.bool("Match case (default true for exact edits)"),
      wholeWord: S.bool("Whole words only"),
      all: S.bool("Replace every occurrence (default true); false replaces the first only"),
    }, ["find", "replace"], ({ find, replace, regex = false, caseSensitive = true, wholeWord = false, all = true }) => {
      const m = model();
      let found = M.findMatches(m, find, { regex, caseSensitive, wholeWord });
      if (!found.length && !regex && find.includes("\n")) throw new Error("Matches cannot span paragraphs: replace one paragraph at a time.");
      if (!found.length) return { replaced: 0, hint: "No match. Check the exact text with office_read_document or office_find." };
      if (!all) found = found.slice(0, 1);
      commit("Replace Text", M.replaceMatches(m, found, replace, { query: find, regex, caseSensitive }));
      return { replaced: found.length };
    }),

    tool("office_set_style", "Applies a named paragraph style (Normal, Title, Subtitle, Heading1-6, Quote, Code, List or a custom style id) to blocks, and/or defines or modifies a style (`define`).", {
      style: S.str("Style id, e.g. Heading2"),
      paragraphs: { type: "array", items: { type: "number" }, description: "Block indexes to apply the style to" },
      find: S.str("Apply to every paragraph containing this text"),
      define: { type: "object", description: "Create or change the style", properties: { name: { type: "string" }, basedOn: { type: "string" }, next: { type: "string" }, outline: { type: "number", description: "Heading level 1-6 for outline/TOC" }, ...MARK_PROPS, ...PARA_PROPS } },
    }, ["style"], ({ style, paragraphs = [], find, define }) => {
      let m = model();
      const id = String(style).replace(/[^\w -]/g, "").slice(0, 60);
      if (define) {
        const cur = m.styles[id] || { name: define.name || id, type: "paragraph", basedOn: "Normal", para: {}, run: {} };
        const marks = toMarks(define);
        const run = { ...cur.run };
        for (const [k, v] of Object.entries(marks)) if (v === null) delete run[k];
        else run[k] = v;
        const para = { ...cur.para };
        for (const k of Object.keys(PARA_PROPS)) if (define[k] !== undefined) para[k] = define[k];
        const entry = { ...cur, name: define.name || cur.name || id, para, run, ...(define.basedOn ? { basedOn: define.basedOn } : {}), ...(define.next ? { next: define.next } : {}), ...(define.outline ? { outline: define.outline } : {}) };
        m = { ...m, styles: M.normalizeDoc({ ...m, styles: { ...m.styles, [id]: entry } }).styles };
      }
      if (!m.styles[id]) throw new Error(`There is no style “${id}”. Existing: ${Object.keys(m.styles).join(", ")}. Pass \`define\` to create it.`);
      const targets = new Set(paragraphs.filter((i) => Number.isInteger(i) && m.blocks[i]?.type === "paragraph"));
      if (find) for (const f of M.findMatches(m, find, { caseSensitive: true })) if (f.path.length === 1) targets.add(f.path[0]);
      const blocks = m.blocks.map((b, i) => (targets.has(i) ? { ...b, style: id } : b));
      commit(define ? "Define Style" : "Apply Style", { ...m, blocks });
      return { style: id, applied: targets.size, defined: !!define };
    }),

    tool("office_apply_format", "Formats text in the active Office document: character `marks` on every match of `find` (or on whole `paragraphs`), and/or paragraph properties (`paragraph`) on the blocks containing them.", {
      find: S.str("Exact text to format (all occurrences)"),
      regex: S.bool("find is a regular expression"),
      paragraphs: { type: "array", items: { type: "number" }, description: "Block indexes to format entirely" },
      marks: { type: "object", description: "Character formatting", properties: MARK_PROPS },
      paragraph: { type: "object", description: "Paragraph formatting", properties: PARA_PROPS },
    }, [], ({ find, regex = false, paragraphs = [], marks = {}, paragraph }) => {
      let m = model();
      const mk = toMarks(marks);
      let n = 0;
      const touched = new Set();
      if (find) {
        for (const f of M.findMatches(m, find, { regex, caseSensitive: true })) {
          if (Object.keys(mk).length) m = M.formatRange(m, { path: f.path, offset: f.from }, { path: f.path, offset: f.to }, mk);
          touched.add(JSON.stringify(f.path));
          n++;
        }
      }
      for (const i of paragraphs) {
        const b = m.blocks[i];
        if (b?.type !== "paragraph") continue;
        if (Object.keys(mk).length) m = M.formatRange(m, { path: [i], offset: 0 }, { path: [i], offset: M.paraLength(b) }, mk);
        touched.add(JSON.stringify([i]));
        n++;
      }
      if (paragraph) for (const p of touched) {
        const path = JSON.parse(p);
        m = M.setParagraphProps(m, { path, offset: 0 }, { path, offset: 0 }, paragraph);
      }
      if (!n) return { formatted: 0, hint: "Nothing matched: pass `find` (exact text) or `paragraphs` (indexes from office_read_document)." };
      commit("Format", m);
      return { formatted: n };
    }),

    tool("office_insert_table", "Inserts a table into the active Office document. `rows` is a list of rows, each a list of cell texts (first row = header when header is true).", {
      rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Cell texts row by row", minItems: 1 },
      header: S.bool("First row is a header row (bold, repeats on new pages)"),
      columnWidths: { type: "array", items: { type: "number" }, description: "Column widths in points (default: equal widths across the page)" },
      borders: S.bool("Draw borders (default true)"),
      ...POSITION,
    }, ["rows"], ({ rows, header = true, columnWidths, borders = true, position = "end", index }) => {
      const m = model();
      const cols = Math.max(1, ...rows.map((r) => r.length));
      const width = m.page.width - m.page.margins.left - m.page.margins.right;
      const t = M.createTable(rows.length, cols, width, { header });
      t.rows.forEach((row, r) => row.cells.forEach((cell, c) => (cell.blocks = [M.para(header && r === 0 ? [{ text: String(rows[r][c] ?? ""), b: true }] : String(rows[r][c] ?? ""))])));
      if (Array.isArray(columnWidths) && columnWidths.length === cols) t.cols = columnWidths.map((w) => Math.max(12, Number(w) || 72));
      if (!borders) t.borders = { ...t.borders, style: "none" };
      const r = insertAt(m, [t], { position, index });
      commit("Insert Table", r.doc);
      return { inserted: true, at: r.at, rows: rows.length, columns: cols };
    }),

    tool("office_set_page_setup", "Changes the page setup of the active Office document: paper size, orientation, margins (millimeters), header and footer text ({PAGE}, {PAGES} and {DATE} become fields).", {
      size: S.str("Paper size", { enum: ["A4", "Letter", "Legal", "A5", "A3"] }),
      orientation: S.str("portrait or landscape", { enum: ["portrait", "landscape"] }),
      margins: { type: "object", description: "Margins in millimeters", properties: { top: { type: "number" }, bottom: { type: "number" }, left: { type: "number" }, right: { type: "number" } } },
      header: S.str("Header text (empty string removes it)"),
      footer: S.str("Footer text, e.g. \"Page {PAGE} of {PAGES}\" (empty string removes it)"),
      headerAlign: S.str("left | center | right", { enum: ["left", "center", "right"] }),
      footerAlign: S.str("left | center | right", { enum: ["left", "center", "right"] }),
    }, [], async ({ size, orientation, margins, header, footer, headerAlign, footerAlign }) => {
      const m = model();
      const page = { ...m.page, margins: { ...m.page.margins } };
      const orient = orientation || page.orientation;
      if (size) {
        const p = M.PAGE_SIZES[size];
        page.size = size;
        page.width = orient === "landscape" ? p.height : p.width;
        page.height = orient === "landscape" ? p.width : p.height;
      } else if (orientation && orientation !== page.orientation) [page.width, page.height] = [page.height, page.width];
      page.orientation = orient;
      for (const [k, v] of Object.entries(margins || {})) if (Number.isFinite(v) && v >= 0) page.margins[k] = (v * 72) / 25.4;
      const next = { ...m, page };
      const { fromFieldText } = await import("../../ui/office/dialogs.js");
      if (header !== undefined) next.header = header ? fromFieldText(header, headerAlign) : [];
      if (footer !== undefined) next.footer = footer ? fromFieldText(footer, footerAlign) : [];
      commit("Page Setup", next);
      return { size: page.size, orientation: page.orientation, marginsMm: Object.fromEntries(Object.entries(page.margins).map(([k, v]) => [k, Math.round((v / 72) * 25.4)])) };
    }),

    tool("office_export", "Exports the active Office document (any kind) in a format its app writes: text documents docx, odt, pdf, rtf, html, md or txt; other kinds list theirs in office_describe. A save dialog opens for the user. The .ofini document itself is saved with File ▸ Save.", {
      format: S.str("Target format id, e.g. docx, pdf, xlsx, csv, pptx"),
    }, ["format"], async ({ format }) => {
      if (app.doc?.office?.kind && app.doc.office.kind !== "document") {
        const { exportOfficeDoc } = await import("../../office/services/export.js");
        const res = await exportOfficeDoc(app, app.doc, String(format));
        return res ? { exported: res.name } : { exported: null, note: "The user cancelled the save dialog." };
      }
      if (!["docx", "odt", "pdf", "rtf", "html", "md", "txt"].includes(format)) throw new Error("Text documents export as docx, odt, pdf, rtf, html, md or txt.");
      const d = docOf();
      const { exportOffice } = await import("../../ui/office/dialogs.js");
      const res = await exportOffice(app, { prj: d.office, doc: d }, format);
      return res ? { exported: res.name } : { exported: null, note: "The user cancelled the save dialog." };
    }, { needsApproval: (a) => `Export the document as ${String(a.format || "").toUpperCase()} (a save dialog opens)?` }),
  ];
}
