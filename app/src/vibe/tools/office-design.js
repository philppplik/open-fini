// Design and review Vibe tools for text documents (docs/vibe-studio.md ▸ Office design and review): themes and style
// sets, update a style from a paragraph, table style gallery, section breaks with columns, floating text boxes, the
// table of contents and tracked changes. Logic in engine/office/design.js; every edit is one undo step ("Vibe: …").
// Each description ends with "Watch out": the mistakes models typically make with the tool and how to verify.
import { tool, S } from "./helpers.js";

const eng = () => Promise.all([import("../../engine/office/model.js"), import("../../engine/office/design.js"), import("../../core/office.js")]);

export function officeDesignTools(app) {
  async function textDoc() {
    const [M, D, core] = await eng();
    const d = app.doc;
    if (!d?.office) throw new Error("The active document is not an Office document. Open or create a text document first (office_new kind document).");
    if (d.office.kind && d.office.kind !== "document") throw new Error(`The active Office document is a ${d.office.kind}; this tool works on text documents. Switch with office_list_documents.`);
    if (d.office.model._raw || d.office.model.version !== M.OFFICE_VERSION) d.office.model = M.normalizeDoc(d.office.model);
    const commit = (label, next) => {
      // while Track changes is on, Vibe's edits become tracked changes authored "Vibe (AI)" (track.js ▸ trackDiff)
      if (d.office.model.trackChanges && !/^(Track Changes|Accept|Reject)/.test(label)) next = D.trackDiff(d.office.model, next, D.VIBE_AUTHOR);
      if (app.officeUI?.doc === d && app.officeUI.editor) app.officeUI.editor.commit(next, { label: `Vibe: ${label}` });
      else core.commitOffice(d, `Vibe: ${label}`, next);
    };
    return { m: d.office.model, M, D, commit };
  }
  const blockAt = (m, index, kind) => {
    if (!Number.isInteger(index) || !m.blocks[index]) throw new Error(`No block at index ${index}; the document has ${m.blocks.length} blocks (office_read_document lists them).`);
    if (kind && m.blocks[index].type !== kind) throw new Error(`Block ${index} is a ${m.blocks[index].type}, not a ${kind}.${kind === "table" ? ` Tables are at: ${m.blocks.map((b, i) => (b.type === "table" ? i : null)).filter((i) => i !== null).join(", ") || "none"}.` : ""}`);
    return m.blocks[index];
  };
  const insertAt = (M, m, at, blocks) => {
    const list = m.blocks.slice();
    const i = Math.max(0, Math.min(list.length, Number.isInteger(at) ? at : list.length));
    list.splice(i, 0, ...blocks);
    if (list[list.length - 1].type !== "paragraph") list.push(M.para(""));
    return { ...m, blocks: list };
  };

  return [
    tool("office_apply_design", "Applies a theme (heading and body fonts plus colors) and/or a style set (spacing, line height, title size) to the built-in styles of the active text document; tables styled from the gallery follow the theme accent. Themes: office, classic, modern, elegant, bold, minimal, ocean. Style sets: default, compact, airy, formal. Watch out: this restyles every paragraph that uses the built-in styles, but direct formatting (fonts or colors set on runs) wins over the theme; remove it with office_apply_format first if the theme does not show. Verify with a screenshot.", {
      theme: S.str("Theme id", { enum: ["office", "classic", "modern", "elegant", "bold", "minimal", "ocean"] }),
      styleSet: S.str("Style set id", { enum: ["default", "compact", "airy", "formal"] }),
    }, [], async ({ theme, styleSet } = {}) => {
      const { m, D, commit } = await textDoc();
      if (!theme && !styleSet) throw new Error("Pass theme and/or styleSet.");
      let next = m;
      if (theme) next = D.applyTheme(next, theme);
      if (styleSet) next = D.applyStyleSet(next, styleSet);
      commit("Apply Design", next);
      return { theme: next.theme?.id || null, styleSet: styleSet || null, fonts: next.theme?.fonts, colors: next.theme?.colors };
    }),

    tool("office_update_style", "Update style to match selection: the direct paragraph formatting and the run formatting shared by all text of the paragraph at block `index` become part of its style (or `style`), so every paragraph with that style changes the same way; the paragraph's own copies are removed. Watch out: only formatting common to the whole paragraph is taken; format one example paragraph completely first (office_apply_format), then call this.", {
      index: S.num("Block index of the example paragraph"),
      style: S.str("Style id to update (default: the paragraph's own style), e.g. Heading1"),
    }, ["index"], async ({ index, style }) => {
      const { m, D, commit } = await textDoc();
      blockAt(m, index, "paragraph");
      const next = D.updateStyleFromParagraph(m, [index], style);
      commit("Update Style", next);
      const id = style || m.blocks[index].style;
      return { style: id, para: next.styles[id].para, run: next.styles[id].run };
    }),

    tool("office_table_style", "Applies a table style from the gallery to a table of the active text document: header row fill and text color, banded rows, bold first column and total row. Styles: plain, light, accent (theme color), blue, green, orange, dark, minimal. Watch out: the colors are written into the cells and replace manual cell shading; `index` is the table's block index (office_list_sections lists tables).", {
      index: S.num("Block index of the table"),
      style: S.str("Table style id", { enum: ["plain", "light", "accent", "blue", "green", "orange", "dark", "minimal"] }),
      header: S.bool("Style the first row as a header row (default true)"),
      banded: S.bool("Banded rows (default true)"),
      firstCol: S.bool("Bold first column (default false)"),
      total: S.bool("Bold last row as a total row (default false)"),
    }, ["index", "style"], async ({ index, style, header = true, banded = true, firstCol = false, total = false }) => {
      const { m, M, D, commit } = await textDoc();
      const t = blockAt(m, index, "table");
      commit("Table Style", M.replaceTop(m, index, D.applyTableStyle(t, style, { header, banded, firstCol, total }, m.theme)));
      return { table: index, style, header, banded, firstCol, total };
    }),

    tool("office_insert_section_break", "Inserts a section break before block `index`: everything after it, up to the next section break, is laid out in `columns` columns (1 to 4), starting on the same page (continuous) or a new page. Use two breaks to put only part of the document in columns (columns 2, then later columns 1). Watch out: multi-column layout is kept in DOCX only (other formats get one column); a multi-column section does not split across pages in the editor, so keep it shorter than a page or use several sections.", {
      index: S.num("Block index the new section starts at (default: end of the document)"),
      columns: S.num("Columns of the new section (1-4, default 2)"),
      start: S.str("continuous (default) or page", { enum: ["continuous", "page"] }),
      gap: S.num("Column gap in points (default 36)"),
    }, [], async ({ index, columns = 2, start = "continuous", gap = 36 } = {}) => {
      const { m, M, D, commit } = await textDoc();
      const brk = D.sectionBreak({ columns, columnGap: gap, start });
      const next = insertAt(M, m, index, [brk]);
      commit("Section Break", next);
      return { inserted: true, at: Number.isInteger(index) ? index : m.blocks.length, ...brk, sections: D.sectionsOf(next).map((s) => ({ from: s.from, to: s.to, columns: s.columns })) };
    }),

    tool("office_insert_text_box", "Adds a floating text box (sidebar, pull quote, callout) anchored at the start of the paragraph at block `index`; the paragraph text wraps around it. Content is plain `text` (one paragraph per line) or formatted `paragraphs`. DOCX and ODT keep it as a floating text box; other formats receive its paragraphs indented after the anchor. Watch out: keep boxes short (under 60 words) and anchor them to a long body paragraph, not a heading; verify with office_design_info (floating).", {
      index: S.num("Block index of the anchor paragraph"),
      text: S.str("Plain text of the box; new lines start new paragraphs (or use paragraphs)"),
      paragraphs: { type: "array", description: "Formatted content instead of text: one item per paragraph", items: { type: "object", properties: { align: S.str("left, center, right or justify", { enum: ["left", "center", "right", "justify"] }), runs: { type: "array", items: { type: "object", properties: { text: S.str("Text"), bold: S.bool("Bold"), italic: S.bool("Italic"), underline: S.bool("Underline"), color: S.str("Color #rrggbb"), size: S.num("Font size in points") }, required: ["text"] } } }, required: ["runs"] } },
      wrap: S.str("right (default), left or none (inline)", { enum: ["right", "left", "none"] }),
      width: S.num("Width in points (default 180)"),
      fill: S.str("Background color, e.g. #eef4ff (default none)"),
      border: S.str("Border color (default #808080; 'none' for no border)"),
    }, ["index"], async ({ index, text = "", paragraphs, wrap = "right", width = 180, fill, border = "#808080" }) => {
      const { m, M, D, commit } = await textDoc();
      const p = blockAt(m, index, "paragraph");
      if (!text && !paragraphs?.length) throw new Error("Pass text or paragraphs for the box content.");
      const paras = paragraphs?.length ? paragraphs.map((q) => ({ align: q.align, runs: (q.runs || []).map((r) => ({ text: r.text, b: r.bold, i: r.italic, u: r.underline, color: r.color, size: r.size })) })) : undefined;
      const box = D.textBox({ text, paras, wrap, width, fill, border: border === "none" ? null : border });
      commit("Text Box", M.replaceTop(m, index, { ...p, runs: [box, ...p.runs] }));
      return { anchor: index, ...box };
    }),

    tool("office_insert_toc", "Inserts a generated table of contents before block `index` (default: after the Title and Subtitle). It lists the headings up to `levels` and updates itself when headings change; Word documents get a real TOC field. Watch out: it lists only paragraphs with heading styles, so style headings first (office_set_style or office_list_sections to check); insert at most one per document.", {
      index: S.num("Block index to insert before (default: after the title block)"),
      levels: S.num("Heading levels to include (1-6, default 3)"),
      title: S.str("Title above the entries (default Contents; empty for none)"),
    }, [], async ({ index, levels = 3, title = "Contents" } = {}) => {
      const { m, M, D, commit } = await textDoc();
      if (m.blocks.some((b) => b.type === "toc")) throw new Error("The document already has a table of contents; it updates itself.");
      let at = index;
      if (!Number.isInteger(at)) {
        at = 0;
        while (m.blocks[at]?.type === "paragraph" && ["Title", "Subtitle"].includes(m.blocks[at].style)) at++;
      }
      const toc = D.tocBlock({ levels, title });
      commit("Table of Contents", insertAt(M, m, at, [toc]));
      return { inserted: true, at, levels: toc.levels, entries: D.tocEntries(m, toc.levels).map((e) => `${"  ".repeat(e.level - 1)}${e.text}`) };
    }),

    tool("office_track_changes", "Tracked changes of the active text document. action: on / off (record later edits as insertions, deletions, format changes, paragraph changes, splits and joins), list (every change with id, kind, author and text), accept or reject (all, or filtered by ids from list, author or kind). While tracking is on, Vibe's own edits are tracked too, authored Vibe (AI). Watch out: list before accepting so you do not accept changes the user wanted to review, and accepting or rejecting cannot be told apart from an edit after saving.", {
      action: S.str("on, off, list, accept or reject", { enum: ["on", "off", "list", "accept", "reject"] }),
      ids: { type: "array", items: { type: "number" }, description: "Change ids from action list (default: all)" },
      author: S.str("Only changes of this author"),
      kind: S.str("Only insertions (ins), deletions (del), format changes (format), paragraph changes (paragraph), paragraph splits (split) or joins (join)", { enum: ["ins", "del", "format", "paragraph", "split", "join"] }),
    }, ["action"], async ({ action, ids, author, kind }) => {
      const { m, D, commit } = await textDoc();
      if (action === "list") return { tracking: !!m.trackChanges, changes: D.revisions(m).slice(0, 300) };
      if (action === "on" || action === "off") {
        const next = { ...m };
        if (action === "on") next.trackChanges = true;
        else delete next.trackChanges;
        commit(action === "on" ? "Track Changes On" : "Track Changes Off", next);
        return { tracking: action === "on" };
      }
      const r = D.resolveRevisions(m, { accept: action === "accept", ids: ids?.length ? ids : undefined, author, kind });
      if (r.count) commit(action === "accept" ? "Accept Changes" : "Reject Changes", r.doc);
      return { [action === "accept" ? "accepted" : "rejected"]: r.count, remaining: D.revisions(r.doc).length };
    }),

    tool("office_design_info", "Describes the design of the active text document and the available choices: current theme (fonts, colors), the style of every table, sections with their columns, the table of contents, floating text boxes and wrapped images, tracked changes count; plus the ids of all themes, style sets and table styles. Watch out: call it before changing the design so you keep what the user already chose.", {}, [], async () => {
      const { m, M, D } = await textDoc();
      return {
        theme: m.theme || null,
        themes: D.THEMES.map((t) => ({ id: t.id, fonts: t.fonts })),
        styleSets: D.STYLE_SETS.map((s) => s.id),
        tableStyles: D.TABLE_STYLES.map((s) => s.id),
        tables: m.blocks.flatMap((b, i) => (b.type === "table" ? [{ index: i, rows: b.rows.length, columns: b.cols.length, widthPt: Math.round(b.cols.reduce((a, c) => a + c, 0)), style: b.design?.style || null, header: !!b.rows[0]?.header }] : [])),
        sections: D.sectionsOf(m).map((s) => ({ from: s.from, to: s.to, columns: s.columns, start: s.start })),
        toc: m.blocks.flatMap((b, i) => (b.type === "toc" ? [{ index: i, levels: b.levels, entries: D.tocEntries(m, b.levels).length }] : [])),
        floating: D.floatingObjects(m).map((f) => ({ index: f.path.length === 1 ? f.path[0] : f.path, kind: f.kind, wrap: f.wrap, ...(f.text ? { text: f.text.slice(0, 80) } : {}) })),
        trackChanges: !!m.trackChanges,
        revisions: D.revisions(m).length,
        textWidthPt: Math.round(m.page.width - m.page.margins.left - m.page.margins.right),
        headings: M.outline(m).length,
      };
    }, { readOnly: true }),

    tool("office_table_edit", "Edits a table of the active text document by its block index: sort (body rows by a column, numbers numerically; header and total row stay), total (append a total row summing the numeric columns), distribute (equal column widths), fit (scale to the text width), widths (set column widths in points), insert_row / delete_row (at `row`), insert_column / delete_column (at `column`), header (header row on/off with `on`). Watch out: indexes are 0-based; sorting and totals refuse tables with merged cells; after insert or delete the table's styled banding is re-applied, check with office_read_document.", {
      index: S.num("Block index of the table"),
      action: S.str("What to do", { enum: ["sort", "total", "distribute", "fit", "widths", "insert_row", "delete_row", "insert_column", "delete_column", "header"] }),
      column: S.num("0-based column (sort, insert_column, delete_column)"),
      row: S.num("0-based row (insert_row inserts after it, delete_row)"),
      descending: S.bool("Sort descending (default false)"),
      widths: { type: "array", items: { type: "number" }, description: "Column widths in points (widths)" },
      label: S.str("Label of the total row (default Total)"),
      on: S.bool("Header row on or off (header)"),
    }, ["index", "action"], async ({ index, action, column = 0, row = 0, descending = false, widths, label = "Total", on = true }) => {
      const { m, M, D, commit } = await textDoc();
      const t = blockAt(m, index, "table");
      const width = m.page.width - m.page.margins.left - m.page.margins.right;
      const restyle = (x) => (x && t.design ? D.applyTableStyle(x, t.design.style, t.design, m.theme) : x);
      const inRange = (v, n, what) => {
        if (!Number.isInteger(v) || v < 0 || v >= n) throw new Error(`${what} ${v} does not exist; the table has ${n} ${what}s (0-based).`);
      };
      let next;
      if (action === "sort") next = D.tableSort(t, column, { desc: descending }, m.theme);
      else if (action === "total") next = D.tableTotalRow(t, { label }, m.theme);
      else if (action === "distribute") next = D.tableDistribute(t);
      else if (action === "fit") next = D.tableFit(t, width);
      else if (action === "widths") {
        if (!Array.isArray(widths) || widths.length !== t.cols.length) throw new Error(`Pass ${t.cols.length} widths (one per column).`);
        next = { ...t, cols: widths.map((w) => Math.max(4, Math.min(2000, Number(w) || 72))) };
      } else if (action === "insert_row") (inRange(row, t.rows.length, "row"), (next = restyle(M.tableInsertRow(t, row, true))));
      else if (action === "delete_row") (inRange(row, t.rows.length, "row"), (next = restyle(M.tableDeleteRow(t, row))));
      else if (action === "insert_column") (inRange(column, t.cols.length, "column"), (next = restyle(M.tableInsertCol(t, column, true))));
      else if (action === "delete_column") (inRange(column, t.cols.length, "column"), (next = restyle(M.tableDeleteCol(t, column))));
      else if (action === "header") next = restyle({ ...t, rows: t.rows.map((r, i) => (i === 0 ? (on ? { ...r, header: true } : { cells: r.cells }) : r)), ...(t.design ? { design: { ...t.design, header: !!on } } : {}) });
      if (!next) throw new Error("That would remove the last row or column; delete the whole table with office_replace_text or ask the user.");
      commit("Edit Table", M.replaceTop(m, index, next));
      return { table: index, action, rows: next.rows.length, columns: next.cols.length, widthsPt: next.cols, preview: D.tableText(next).slice(0, 8) };
    }),

    tool("office_insert_styled_table", "Inserts a table from rows of text with a gallery style in one step (first row as header, numbers right-aligned), before block `index` or at the end; optional total row. Watch out: keep cells short (under 12 words); for live spreadsheet data use office_sheet_to_document instead; verify with office_read_document.", {
      rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Rows of cell texts; the first row is the header" },
      style: S.str("Table style id (default accent)", { enum: ["plain", "light", "accent", "blue", "green", "orange", "dark", "minimal"] }),
      index: S.num("Block index to insert before (default: end)"),
      total: S.bool("Append a total row summing the numeric columns (default false)"),
    }, ["rows"], async ({ rows, style = "accent", index, total = false }) => {
      const { m, M, D, commit } = await textDoc();
      if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new Error("rows must be 1 to 500 rows of strings.");
      const width = m.page.width - m.page.margins.left - m.page.margins.right;
      let t = D.tableFromRows(rows.map((r) => (Array.isArray(r) ? r.slice(0, 40).map((v) => String(v ?? "")) : [String(r)])), width, { header: true, style }, m.theme);
      if (total) t = D.tableTotalRow(t, {}, m.theme);
      const at = Number.isInteger(index) ? index : m.blocks.length;
      const next = insertAt(M, m, at, [t]);
      const list = next.blocks.slice();
      const ti = list.indexOf(t);
      if (list[ti + 1]?.type !== "paragraph") list.splice(ti + 1, 0, M.para(""));
      if (ti > 0 && list[ti - 1]?.type === "table") list.splice(ti, 0, M.para(""));
      commit("Insert Styled Table", { ...next, blocks: list });
      return { inserted: true, at: list.indexOf(t), rows: t.rows.length, columns: t.cols.length, style };
    }),
  ];
}
