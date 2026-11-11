// Semantic and cross-app Vibe tools for the Office Suite (docs/vibe-studio.md ▸ Office): work on a text document by
// its headings instead of block indexes (read, rewrite, move, promote a section), check accessibility, and move
// content between apps (document tables → spreadsheet, spreadsheet range → document table, outline → slides, whiteboard
// → document).
// Pure structure logic lives in engine/office/sections.js; every edit is one undo step ("Vibe: …").
// Each description ends with "Watch out": the mistakes models typically make with the tool and how to verify.
import { tool, S } from "./helpers.js";

const eng = () => Promise.all([import("../../engine/office/model.js"), import("../../engine/office/sections.js"), import("../../core/office.js"), import("../../engine/office/track.js")]);

export function officeSemanticTools(app) {
  async function textDoc() {
    const [M, X, core, T] = await eng();
    const d = app.doc;
    if (!d?.office) throw new Error("The active document is not an Office document. Open or create a text document first (office_new kind document).");
    if (d.office.kind && d.office.kind !== "document") throw new Error(`The active Office document is a ${d.office.kind}; this tool works on text documents. Switch with office_list_documents.`);
    if (d.office.model._raw || d.office.model.version !== M.OFFICE_VERSION) d.office.model = M.normalizeDoc(d.office.model);
    const commit = (label, next) => {
      // while Track changes is on, Vibe's edits become tracked changes authored "Vibe (AI)" (track.js ▸ trackDiff)
      if (d.office.model.trackChanges) next = T.trackDiff(d.office.model, next, T.VIBE_AUTHOR);
      if (app.officeUI?.doc === d && app.officeUI.editor) app.officeUI.editor.commit(next, { label: `Vibe: ${label}` });
      else core.commitOffice(d, `Vibe: ${label}`, next);
    };
    return { d, m: d.office.model, M, X, commit };
  }
  const mdBlocks = async (markdown) => {
    const { readMarkdown } = await import("../../engine/office/markdown.js");
    const r = readMarkdown(String(markdown || "")).doc;
    return { blocks: r.blocks.filter((b, k, a) => !(k === a.length - 1 && b.type === "paragraph" && !b.runs.length)), media: r.media };
  };
  const brief = (M, m, from, to) =>
    m.blocks.slice(from, to).map((b, k) => ({ index: from + k, kind: b.type === "paragraph" ? (M.headingLevel(m, b) ? `heading ${M.headingLevel(m, b)}` : b.list ? `${b.list.kind} ${b.list.level}` : "paragraph") : b.type, style: b.style, text: b.type === "paragraph" ? M.paraText(b).replace(/￼/g, "").slice(0, 1500) : b.type === "table" ? `[table ${b.rows.length}×${b.cols.length}]` : "" }));
  const heading = { heading: S.str("Heading text of the section (exact, case-insensitive, or a unique part of it)"), nth: S.num("Which match when several headings have the same text (1-based)") };

  return [
    tool("office_list_sections", "Lists the sections of the active text document: every heading with its level, block range [index, end) and word count. Use it to address content by meaning instead of block numbers. Watch out: a section includes its subsections; documents without heading styles have no sections (style headings first with office_set_style).", {}, [], async () => {
      const { m, M, X } = await textDoc();
      return {
        sections: X.sections(m).map((s) => ({ ...s, words: m.blocks.slice(s.index + 1, s.end).reduce((n, b) => n + (b.type === "paragraph" ? (M.paraText(b).match(/\S+/g) || []).length : 0), 0) })),
        tables: X.listTables(m),
      };
    }, { readOnly: true }),

    tool("office_read_section", "Reads one section of the active text document by its heading: heading, body style and every block with its index and text. Watch out: read before rewriting, and quote facts from the section rather than inventing them.", { ...heading }, ["heading"], async ({ heading: h, nth }) => {
      const { m, M, X } = await textDoc();
      const s = X.findSection(m, h, { nth });
      return { heading: s.text, level: s.level, index: s.index, end: s.end, bodyStyle: X.bodyStyle(m, s), blocks: brief(M, m, s.index + 1, s.end) };
    }, { readOnly: true }),

    tool("office_rewrite_section", "Replaces the body of a section (found by heading) with Markdown while keeping the heading, the section's body paragraph style and paragraph formatting. Use for rewrite, shorten, expand, translate or restructure-in-place. Watch out: send only the body (no heading line); headings inside the Markdown should be one level deeper than the section; keepSubsections true leaves subsections untouched. Verify with office_read_section.", {
      ...heading,
      markdown: S.str("New body as Markdown (paragraphs, - bullets, 1. steps, | tables |, **bold**)"),
      keepSubsections: S.bool("Only replace the text before the first subheading (default false: the whole section including subsections)"),
    }, ["heading", "markdown"], async ({ heading: h, nth, markdown, keepSubsections = false }) => {
      const { m, X, commit } = await textDoc();
      const s = X.findSection(m, h, { nth });
      const { blocks, media } = await mdBlocks(markdown);
      if (!blocks.length) throw new Error("The Markdown is empty. To delete a section's text pass a single space paragraph, or use office_replace_text.");
      if (/^\s*#{1,6}\s/.test(markdown) && blocks[0]?.style === `Heading${s.level}`) throw new Error("The Markdown starts with a heading of the section's own level: send the body only; the heading is kept.");
      const r = X.replaceSectionBody({ ...m, media: { ...m.media, ...media } }, s, blocks, { keepSubsections });
      commit("Rewrite Section", r.doc);
      return { section: s.text, replacedBlocks: r.to - r.from, from: r.from, to: r.to };
    }),

    tool("office_move_section", "Restructures the outline: moves a section (with its subsections) before or after another section, and/or promotes or demotes it. Watch out: moving changes block indexes, so call office_list_sections again before the next index-based edit.", {
      ...heading,
      target: S.str("Heading of the section to move next to (optional when only changing the level)"),
      where: S.str("before or after the target (default after)", { enum: ["before", "after"] }),
      levelChange: S.num("-1 promotes (Heading3 → Heading2), +1 demotes; applies to the subsections too"),
    }, ["heading"], async ({ heading: h, nth, target, where = "after", levelChange = 0 }) => {
      const { m, X, commit } = await textDoc();
      let next = m;
      let s = X.findSection(next, h, { nth });
      if (levelChange) {
        next = X.shiftSectionLevel(next, s, Math.max(-5, Math.min(5, Math.round(levelChange))));
        s = X.findSection(next, s.index);
      }
      if (target) next = X.moveSection(next, s, X.findSection(next, target), where);
      else if (!levelChange) throw new Error("Pass target (to move) and/or levelChange (to promote or demote).");
      commit("Restructure Outline", next);
      return { moved: s.text, outline: X.sections(next).map((x) => `${"  ".repeat(x.level - 1)}${x.text}`) };
    }),

    tool("office_check_accessibility", "Checks the active text document for accessibility problems: missing title, skipped heading levels, empty headings, images without alt text, tables without header rows, vague link text, low-contrast text and very long paragraphs. Returns block indexes. Watch out: fix structure with styles (office_set_style), not by making text bigger or bold; re-run the check to confirm count 0.", {}, [], async () => {
      const { m, X } = await textDoc();
      return X.accessibilityCheck(m);
    }, { readOnly: true }),

    tool("office_tables_to_sheet", "Copies tables of the active text document into a NEW spreadsheet (one sheet per table, header row bold, numbers and dates parsed as values) and opens it. Watch out: the text document stays unchanged; check the result with sheet_describe (numbers should be right-aligned values, not text) before adding formulas.", {
      tables: { type: "array", items: { type: "number" }, description: "Block indexes of the tables (default: all, see office_list_sections)" },
      title: S.str("Name of the new spreadsheet"),
    }, [], async ({ tables, title } = {}) => {
      const { d, m, X } = await textDoc();
      const all = X.listTables(m);
      const pick = tables?.length ? all.filter((t) => tables.includes(t.index)) : all;
      if (!pick.length) throw new Error(all.length ? `No table at ${tables}. Tables are at: ${all.map((t) => t.index).join(", ")}.` : "The document has no tables.");
      const { createOfficeDocument } = await import("../../ui/office/open.js");
      const sheetDoc = await createOfficeDocument(app, "sheet", { title: title || `${d.name} tables` });
      const [{ ensureModel }, SM, F, core] = await Promise.all([import("../../office/sheet/app.js"), import("../../office/sheet/model.js"), import("../../office/sheet/formula.js"), import("../../core/office.js")]);
      let wb = ensureModel(sheetDoc.office);
      const out = [];
      pick.forEach((t, k) => {
        let sid = wb.sheets[0].id;
        const name = (t.caption.replace(/[[\]:*?/\\']/g, "").slice(0, 28) || `Table ${k + 1}`).trim() || `Table ${k + 1}`;
        if (k === 0) wb = SM.renameSheet(wb, sid, SM.validSheetName(name) ? name : `Table ${k + 1}`);
        else {
          wb = SM.addSheet(wb, { name: SM.uniqueSheetName(wb, SM.validSheetName(name) ? name : "Table"), after: wb.sheets[wb.sheets.length - 1].id });
          sid = wb.active;
        }
        const rows = X.tableRows(m.blocks[t.index]);
        rows.forEach((row, r) => row.forEach((v, c) => (wb = SM.inputCell(wb, sid, F.rcKey(r, c), v))));
        if (t.header && rows.length) wb = SM.applyStyle(wb, sid, { r0: 0, c0: 0, r1: 0, c1: rows[0].length - 1 }, { b: true, fill: "#dde5f0" });
        out.push({ table: t.index, sheet: SM.sheetById(wb, sid).name, rows: rows.length, columns: rows[0]?.length || 0 });
      });
      wb = { ...wb, active: wb.sheets[0].id };
      core.commitOffice(sheetDoc, "Vibe: Tables to Spreadsheet", wb);
      app.officeUI?.refresh?.();
      return { spreadsheet: sheetDoc.name, sheets: out };
    }),

    tool("office_sheet_to_document", "Inserts a range of an open spreadsheet into the active text document as a formatted table (computed values with their number formats; first row as header). Watch out: the table is a snapshot, it does not update when the sheet changes; name the spreadsheet exactly as office_list_documents shows it and keep ranges small (at most 200 rows × 20 columns).", {
      spreadsheet: S.str("Name of the open spreadsheet document (office_list_documents)"),
      range: S.str("A1 range, e.g. A1:D12 (default: the used range)"),
      sheet: S.str("Sheet name (default: the active sheet)"),
      header: S.bool("First row is a header row (default true)"),
      position: S.str("end (default), start, after or before the block `index`", { enum: ["end", "start", "after", "before"] }),
      index: S.num("Block index for after / before"),
    }, ["spreadsheet"], async ({ spreadsheet, range, sheet, header = true, position = "end", index }) => {
      const src = app.docs.find((x) => x.office?.kind === "sheet" && x.name === spreadsheet) || app.docs.find((x) => x.office?.kind === "sheet" && x.name.toLowerCase() === String(spreadsheet).toLowerCase());
      if (!src) throw new Error(`No open spreadsheet named “${spreadsheet}”. Open spreadsheets: ${app.docs.filter((x) => x.office?.kind === "sheet").map((x) => x.name).join(", ") || "none"}.`);
      const { loadOfficeApp } = await import("../../office/index.js");
      await loadOfficeApp("sheet");
      const [{ ensureModel, calcFor }, SM, sel, R] = await Promise.all([import("../../office/sheet/app.js"), import("../../office/sheet/model.js"), import("../../office/toolkit/selection.js"), import("../../office/sheet/render.js")]);
      const wb = ensureModel(src.office);
      const sh = sheet ? SM.sheetByName(wb, sheet) : SM.activeSheet(wb);
      if (!sh) throw new Error(`No sheet “${sheet}”. Sheets: ${wb.sheets.map((s) => s.name).join(", ")}.`);
      const g = range ? sel.parseRange(String(range).replace(/\$/g, "").toUpperCase()) : SM.usedRange(sh);
      if (!g) throw new Error(range ? `“${range}” is not an A1 range.` : "The sheet is empty.");
      const r1 = Math.min(g.r1, g.r0 + 199);
      const c1 = Math.min(g.c1, g.c0 + 19);
      const calc = calcFor(src);
      const rows = [];
      const right = [];
      for (let r = g.r0; r <= r1; r++) {
        const row = [];
        for (let c = g.c0; c <= c1; c++) {
          const look = R.cellLook(sh, calc, r, c);
          row.push(look.text);
          if (r > g.r0 && typeof look.value === "number") right[c - g.c0] = true;
        }
        rows.push(row);
      }
      const { m, M, commit } = await textDoc();
      const width = m.page.width - m.page.margins.left - m.page.margins.right;
      const t = M.createTable(rows.length, rows[0].length, width, { header });
      t.rows.forEach((row, r) => row.cells.forEach((cell, c) => (cell.blocks = [M.para(header && r === 0 ? [{ text: rows[r][c], b: true }] : rows[r][c], "Normal", right[c] && !(header && r === 0) ? { props: { align: "right" } } : {})])));
      let at = m.blocks.length;
      if (position === "start") at = 0;
      else if (position === "after" || position === "before") {
        if (!Number.isInteger(index) || !m.blocks[index]) throw new Error("index must be a block index (office_list_sections / office_read_document).");
        at = position === "after" ? index + 1 : index;
      }
      const list = m.blocks.slice();
      list.splice(at, 0, t);
      if (list[at + 1]?.type !== "paragraph") list.splice(at + 1, 0, M.para(""));
      commit("Sheet to Table", { ...m, blocks: list });
      return { inserted: true, at, rows: rows.length, columns: rows[0].length, truncated: r1 < g.r1 || c1 < g.c1 };
    }),

    tool("office_document_to_slides", "Turns the outline of the active text document into a NEW presentation: the Title becomes a title slide, each heading up to `level` a slide, its list items and the first sentence of each paragraph the bullets. Watch out: this is a draft; shorten bullets to under 10 words with slides_set_text and check with slides_describe; long sections lose text beyond maxBullets.", {
      level: S.num("Deepest heading level that starts a slide (default 2)"),
      maxBullets: S.num("Bullets per slide (default 6)"),
      title: S.str("Name of the new presentation"),
      theme: S.str("Theme id (slides_describe lists them)"),
    }, [], async ({ level = 2, maxBullets = 6, title, theme } = {}) => {
      const { d, m, X } = await textDoc();
      const plan = X.slidePlan(m, { level: Math.max(1, Math.min(6, level)), maxBullets: Math.max(1, Math.min(12, maxBullets)) });
      if (!plan.length) throw new Error("The document has no Title or headings to build slides from. Style the headings first (office_set_style).");
      if (plan.length > 200) throw new Error(`That would be ${plan.length} slides; use a lower level.`);
      const { createOfficeDocument } = await import("../../ui/office/open.js");
      const deckDoc = await createOfficeDocument(app, "slides", { title: title || m.meta.title || d.name });
      const [SL, core] = await Promise.all([import("../../office/slides/model.js"), import("../../core/office.js")]);
      let deck = SL.normalizeDeck(deckDoc.office.model);
      if (theme && SL.THEMES.some((x) => x.id === theme)) deck = SL.applyTheme(deck, theme);
      const old = deck.slides.map((s) => s.id);
      for (const p of plan) deck = SL.addSlide(deck, { layout: p.layout, text: p.layout === "title-content" ? { title: p.title, body: p.bullets.join("\n") } : { title: p.title, subtitle: p.subtitle || "" } }).deck;
      deck = SL.deleteSlides(deck, old);
      core.commitOffice(deckDoc, "Vibe: Document to Slides", deck);
      app.officeUI?.refresh?.();
      return { presentation: deckDoc.name, slides: plan.map((p, i) => ({ slide: i + 1, layout: p.layout, title: p.title, bullets: p.bullets.length })) };
    }),

    tool("office_board_to_document", "Writes a whiteboard up as a NEW text document: the board title as Title, one heading per page (several pages) and per frame, sticky notes, text boxes and labeled shapes as bullets in reading order, and connectors as “A → B” lines. Watch out: the result is a raw draft; rewrite it into prose with office_rewrite_section and check with office_list_sections. Unlabeled shapes, drawings and pictures are left out.", {
      board: S.str("Name of the open whiteboard (default: the active document)"),
      title: S.str("Title of the new document (default: the board title)"),
      connections: S.bool("Include the Connections lists (default true)"),
    }, [], async ({ board, title, connections = true } = {}) => {
      const boards = app.docs.filter((x) => x.office?.kind === "board");
      const src = board ? boards.find((x) => x.name === board) || boards.find((x) => x.name.toLowerCase() === String(board).toLowerCase()) : app.doc?.office?.kind === "board" ? app.doc : null;
      if (!src) throw new Error(board ? `No open whiteboard named “${board}”. Open whiteboards: ${boards.map((x) => x.name).join(", ") || "none"}.` : "The active document is not a whiteboard; pass board with the name of an open whiteboard (office_list_documents).");
      const B = await import("../../office/board/model.js");
      const model = B.normalizeBoard(src.office.model);
      const r = B.boardToMarkdown(model, { title: title || model.title || src.name, connections });
      if (!r.items && !r.connections) throw new Error("The board has no text to write up (sticky notes, text boxes or labeled shapes).");
      const { createOfficeDocument } = await import("../../ui/office/open.js");
      const docName = title || `${model.title || src.name} notes`;
      const textDocument = await createOfficeDocument(app, "document", { title: docName });
      const [M, core] = await Promise.all([import("../../engine/office/model.js"), import("../../core/office.js")]);
      const m = M.normalizeDoc(textDocument.office.model);
      const { blocks, media } = await mdBlocks(r.markdown);
      core.commitOffice(textDocument, "Vibe: Board to Document", { ...m, blocks, media: { ...m.media, ...media } });
      app.officeUI?.refresh?.();
      return { document: textDocument.name, sections: r.sections, bullets: r.items, connections: r.connections };
    }),
  ];
}
