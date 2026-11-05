// Design and review dialogs of the word processor: Design gallery (themes and style sets), table style gallery, text
// box, section break, table of contents and the Review dialog for tracked changes. Loaded on first use by the office.*
// commands (commands/office.js); the logic lives in engine/office/design.js.
import { h } from "../../core/util.js";
import * as M from "../../engine/office/model.js";
import * as D from "../../engine/office/design.js";
import { openDialog } from "../dialogs.js";

const field = (label, input) => h("label.of-ofield", h("span", label), input);
const check = (label, on) => {
  const c = h("input", { type: "checkbox" });
  c.checked = !!on;
  return { el: h("label.of-ocheck", c, label), get: () => c.checked };
};
const sel = (options, value) => {
  const s = h("select.of-oinput", options.map(([v, t]) => h("option", { value: v }, t)));
  s.value = value;
  return s;
};

// ------------------------------------------------------------------------------------------------ design gallery

/** Themes (font and color sets) and style sets; a click applies and can be undone. */
export function designDialog(app, ws) {
  const ed = ws.editor;
  const body = h("div.of-oform");
  const render = () => {
    const m = ws.prj.model;
    const themeCards = D.THEMES.map((t) => {
      const b = h("button.of-odesign__card", { type: "button", class: m.theme?.id === t.id ? "active" : "", "aria-pressed": String(m.theme?.id === t.id) },
        h("strong", { style: `font-family:${JSON.stringify(t.fonts.heading)};color:${t.colors.heading}` }, t.label),
        h("span", { style: `font-family:${JSON.stringify(t.fonts.body)};font-size:12px` }, `${t.fonts.heading} / ${t.fonts.body}`),
        h("span.of-odesign__swatches", [t.colors.heading, t.colors.accent, t.colors.text].map((c) => h("span", { style: `background:${c}` }))));
      b.addEventListener("click", () => {
        ed.commit(D.applyTheme(ws.prj.model, t.id), { label: `Theme: ${t.label}`, sel: ed.sel });
        render();
      });
      return b;
    });
    const setCards = D.STYLE_SETS.map((st) => {
      const b = h("button.of-odesign__card", { type: "button" }, h("strong", st.label), h("span", { style: "font-size:12px" }, `Line spacing ${st.normal.lineHeight}, ${st.normal.spaceAfter} pt after${st.normal.align === "justify" ? ", justified" : ""}`));
      b.addEventListener("click", () => {
        ed.commit(D.applyStyleSet(ws.prj.model, st.id), { label: `Style Set: ${st.label}`, sel: ed.sel });
        render();
      });
      return b;
    });
    // live preview of the current look, straight from the resolved styles
    const st = (id) => M.resolveStyle(m, id).run;
    const look = (id, extra = "") => {
      const r = st(id);
      return `font-family:${JSON.stringify(r.font || "Calibri")};color:${r.color || "#000"};font-weight:${r.b ? 700 : 400};${extra}`;
    };
    const preview = h("div.of-odesign__preview", { "aria-label": "Preview" },
      h("div", { style: look("Title", "font-size:22px;line-height:1.2") }, "Document title"),
      h("div", { style: look("Heading1", "font-size:16px;margin-top:6px") }, "Heading 1"),
      h("div", { style: look("Normal", "font-size:12px") }, "Body text uses the theme's body font and text color. Tables styled with Theme accent follow the accent color."),
      h("div", { style: look("Heading3", "font-size:13px;margin-top:4px") }, "Heading 3 in the accent color"));
    // custom theme: own fonts and colors
    const th = m.theme || D.THEMES[0];
    const fontIn = (v, label) => h("input.of-oinput", { type: "text", value: v, list: "of-office-fonts", "aria-label": label });
    const hf = fontIn(th.fonts.heading, "Heading font");
    const bf = fontIn(th.fonts.body, "Body font");
    const color = (v, label) => h("input.of-oinput", { type: "color", value: v, "aria-label": label });
    const hc = color(th.colors.heading, "Heading color");
    const ac = color(th.colors.accent, "Accent color");
    const tc = color(th.colors.text, "Text color");
    const custom = h("button.of-btn.of-btn--default", { type: "button" }, "Apply custom theme");
    custom.addEventListener("click", () => {
      ed.commit(D.applyTheme(ws.prj.model, { id: "custom", fonts: { heading: hf.value.trim() || "Calibri", body: bf.value.trim() || "Calibri" }, colors: { heading: hc.value, accent: ac.value, text: tc.value } }), { label: "Custom Theme", sel: ed.sel });
      render();
    });
    body.replaceChildren(
      preview,
      h("h3.of-odesign__h", "Themes (fonts and colors)"), h("div.of-odesign__grid", themeCards),
      h("h3.of-odesign__h", "Custom theme"),
      h("div.of-orow", field("Heading font", hf), field("Body font", bf)),
      h("div.of-orow", field("Headings", hc), field("Accent", ac), field("Text", tc), custom),
      h("h3.of-odesign__h", "Style sets (spacing)"), h("div.of-odesign__grid", setCards),
      h("p.of-hint", "Themes and style sets change the built-in styles (Normal, Title, headings, Quote), so every paragraph that uses them follows. Direct formatting stays. Undo with Ctrl+Z."));
  };
  render();
  openDialog({ title: "Design", body, width: 680, buttons: [{ label: "Close", variant: "primary", onClick: (c) => c() }] });
}

/** Update style to match selection (Word's "Update Heading 1 to Match Selection"). */
export function updateStyleFromSelection(app, ws) {
  const ed = ws.editor;
  try {
    const p = ed.currentPara();
    ed.commit(D.updateStyleFromParagraph(ws.prj.model, ed.sel.focus.path), { label: "Update Style", sel: ed.sel });
    app.toast(`Style “${ws.prj.model.styles[p.style]?.name || p.style}” updated from the selection.`, "success", 2200);
  } catch (e) {
    app.toast(e.message, "warning");
  }
}

// ------------------------------------------------------------------------------------------------ table styles

export function tableStylesDialog(app, ws) {
  const ed = ws.editor;
  const ctx = ed.tableContext();
  if (!ctx) return app.toast("Put the caret in a table first.", "warning");
  const ti = ed.sel.focus.path[0];
  const t0 = ws.prj.model.blocks[ti];
  const d = t0.design || { style: "", header: true, banded: true, firstCol: false, total: false };
  const header = check("Header row", d.header);
  const banded = check("Banded rows", d.banded);
  const firstCol = check("First column", d.firstCol);
  const total = check("Total row", d.total);
  let chosen = d.style || "blue";
  const grid = h("div.of-odesign__grid");
  const apply = () => {
    const t = ws.prj.model.blocks[ti];
    if (t?.type !== "table") return;
    const next = D.applyTableStyle(t, chosen, { header: header.get(), banded: banded.get(), firstCol: firstCol.get(), total: total.get() }, ws.prj.model.theme);
    ed.commit(M.replaceTop(ws.prj.model, ti, next), { label: "Table Style", sel: ed.sel });
  };
  const render = () =>
    grid.replaceChildren(
      ...D.TABLE_STYLES.map((s) => {
        const c = D.tableStyleColors(s.id, ws.prj.model.theme);
        const row = (fill, n) => h("tr", Array.from({ length: 4 }, () => h("td", { style: `background:${fill || "transparent"};--b:${c.border === "none" ? "transparent" : c.border || "#ccc"}` }, n)));
        const prev = h("table.of-odesign__tbl", row(c.head), row(null), row(c.band), row(null));
        const b = h("button.of-odesign__card", { type: "button", class: chosen === s.id ? "active" : "", "aria-pressed": String(chosen === s.id) }, prev, h("span", s.label));
        b.addEventListener("click", () => {
          chosen = s.id;
          apply();
          render();
        });
        return b;
      }),
    );
  render();
  for (const c of [header, banded, firstCol, total]) c.el.querySelector("input").addEventListener("change", apply);
  openDialog({
    title: "Table Styles",
    body: h("div.of-oform", grid, h("div.of-orow", header.el, banded.el, firstCol.el, total.el), h("p.of-hint", "Styles write their colors into the cells, so DOCX, ODT, RTF, HTML and PDF keep them. Choosing a style replaces cell shading.")),
    width: 680,
    buttons: [{ label: "Close", variant: "primary", onClick: (c) => c() }],
  });
}

// ------------------------------------------------------------------------------------------------ text boxes

/** The text box under a one-object selection: { p, path, offset, box } or null. */
export function selectedTextBox(ed) {
  const [a, b] = ed.range;
  const p = M.getBlock(ed.model, a.path);
  if (!p || !M.samePath(a.path, b.path) || b.offset - a.offset !== 1) return null;
  const r = M.sliceRuns(p.runs, a.offset, b.offset)[0];
  return r?.type === "textbox" ? { p, path: a.path, offset: a.offset, box: r } : null;
}

export function textBoxDialog(app, ws, { edit = false } = {}) {
  const ed = ws.editor;
  const cur = edit ? selectedTextBox(ed) : null;
  if (edit && !cur) return app.toast("Double-click a text box first.", "warning");
  const box = cur?.box || D.textBox({ text: "", wrap: "right", fill: "#f2f6fc", border: "#8eaadb" });
  const txt = h("textarea.of-oinput", { rows: 5, "aria-label": "Text" }, box.text);
  const width = h("input.of-oinput", { type: "number", min: 36, max: 1000, step: 1, value: String(box.width) });
  const wrap = sel([["right", "Float right, text wraps left"], ["left", "Float left, text wraps right"], ["none", "In line with text"]], box.wrap);
  const fill = h("input.of-oinput", { type: "color", value: box.fill || "#ffffff" });
  const noFill = check("No fill", !box.fill);
  const border = h("input.of-oinput", { type: "color", value: box.border || "#808080" });
  const noBorder = check("No border", !box.border);
  const buttons = [{ label: "Cancel", onClick: (c) => c() }];
  if (cur)
    buttons.unshift({
      label: "Delete",
      onClick: (c) => {
        const runs = M.mergeRuns([...M.sliceRuns(cur.p.runs, 0, cur.offset), ...M.sliceRuns(cur.p.runs, cur.offset + 1, Infinity)]);
        ed.commit(M.setBlock(ws.prj.model, cur.path, { ...cur.p, runs }), { label: "Delete Text Box", sel: { path: cur.path, offset: cur.offset } });
        c();
      },
    });
  buttons.push({
    label: cur ? "Apply" : "Insert",
    variant: "primary",
    onClick: (c) => {
      const next = D.textBox({ text: txt.value, width: Number(width.value), wrap: wrap.value, fill: noFill.get() ? null : fill.value, border: noBorder.get() ? null : border.value });
      if (cur) {
        const runs = [...M.sliceRuns(cur.p.runs, 0, cur.offset), next, ...M.sliceRuns(cur.p.runs, cur.offset + 1, Infinity)];
        ed.commit(M.setBlock(ws.prj.model, cur.path, { ...cur.p, runs }), { label: "Text Box", sel: ed.sel });
      } else ed.insertInline([next], "Insert Text Box");
      c();
    },
  });
  openDialog({
    title: cur ? "Text Box" : "Insert Text Box",
    body: h("div.of-oform", field("Text (one paragraph per line)", txt), h("div.of-orow", field("Width (pt)", width), field("Wrapping", wrap)), h("div.of-orow", field("Fill", fill), noFill.el, field("Border", border), noBorder.el), h("p.of-hint", "The box floats beside the paragraph it is anchored to and the text wraps around it. Word and other formats receive the box text as indented paragraphs.")),
    width: 560,
    buttons,
  });
}

// ------------------------------------------------------------------------------------------------ sections and TOC

export function sectionBreakDialog(app, ws) {
  const ed = ws.editor;
  const columns = sel([["1", "One column"], ["2", "Two columns"], ["3", "Three columns"], ["4", "Four columns"]], "2");
  const start = sel([["continuous", "Continuous (same page)"], ["page", "Next page"]], "continuous");
  const gap = h("input.of-oinput", { type: "number", min: 0, max: 288, step: 1, value: "36" });
  openDialog({
    title: "Section Break",
    body: h("div.of-oform", h("div.of-orow", field("Columns after the break", columns), field("Start", start), field("Column gap (pt)", gap)), h("p.of-hint", "Everything after the break, up to the next section break, uses these columns. Insert another section break with one column to return to full width. Multi-column sections are kept in Word documents; other formats get one column.")),
    width: 560,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      { label: "Insert", variant: "primary", onClick: (c) => (ed.insertBlocks([D.sectionBreak({ columns: Number(columns.value), columnGap: Number(gap.value), start: start.value })], "Section Break"), c()) },
    ],
  });
}

export function insertToc(app, ws, levels = 3) {
  const ed = ws.editor;
  if (!M.outline(ws.prj.model).length) app.toast("No headings yet: the table of contents fills in as you apply Heading styles.", "info", 3500);
  ed.insertBlocks([D.tocBlock({ levels })], "Table of Contents");
}

// ------------------------------------------------------------------------------------------------ review

export function toggleTrackChanges(app, ws) {
  const ed = ws.editor;
  const on = !ws.prj.model.trackChanges;
  const next = { ...ws.prj.model };
  if (on) next.trackChanges = true;
  else delete next.trackChanges;
  ed.commit(next, { label: on ? "Track Changes On" : "Track Changes Off", sel: ed.sel });
  app.toast(on ? `Track changes is on: edits are marked as ${ed.trackAuthor()}.` : "Track changes is off.", "info", 2200);
}

export function resolveAll(app, ws, accept) {
  const ed = ws.editor;
  const r = D.resolveRevisions(ws.prj.model, { accept });
  if (!r.count) return app.toast("There are no tracked changes.", "info");
  ed.commit(r.doc, { label: accept ? "Accept All Changes" : "Reject All Changes" });
  app.toast(`${accept ? "Accepted" : "Rejected"} ${r.count} change${r.count === 1 ? "" : "s"}.`, "success", 2000);
}

export function reviewDialog(app, ws) {
  const ed = ws.editor;
  const list = h("ul.of-oreview__list", { "aria-label": "Tracked changes" });
  const status = h("p.of-hint");
  const render = () => {
    const revs = D.revisions(ws.prj.model);
    status.textContent = `${revs.length} change${revs.length === 1 ? "" : "s"} · Track changes is ${ws.prj.model.trackChanges ? "on" : "off"}.`;
    list.replaceChildren(
      ...revs.map((r) => {
        const act = (accept) => () => {
          ed.commit(D.resolveRevisions(ws.prj.model, { accept, ids: [r.id] }).doc, { label: accept ? "Accept Change" : "Reject Change" });
          render();
        };
        const go = h("button.of-oreview__text.of-linkbtn", { type: "button", title: "Show in the document", onclick: () => ed.setSelection({ anchor: { path: r.path, offset: r.from }, focus: { path: r.path, offset: r.to } }) }, r.text || "(object)");
        return h("li.of-oreview__item", h("span.of-oreview__kind", { class: `is-${r.kind}` }, r.kind === "ins" ? "Inserted" : "Deleted"), h("small", r.author), go,
          h("button.of-btn.of-btn--default", { type: "button", onclick: act(true) }, "Accept"), h("button.of-btn.of-btn--default", { type: "button", onclick: act(false) }, "Reject"));
      }),
    );
    if (!revs.length) list.append(h("li.of-oside__empty", "No tracked changes. Turn on Track Changes (Document menu) and edit: insertions are underlined, deletions struck through."));
  };
  render();
  openDialog({
    title: "Review Changes",
    body: h("div.of-oform", status, list),
    width: 640,
    buttons: [
      { label: "Track changes on/off", onClick: () => (toggleTrackChanges(app, ws), render()) },
      { label: "Reject all", onClick: () => (resolveAll(app, ws, false), render()) },
      { label: "Accept all", onClick: () => (resolveAll(app, ws, true), render()) },
      { label: "Close", variant: "primary", onClick: (c) => c() },
    ],
  });
}

// ------------------------------------------------------------------------------------------------ table tools

/** Sort, distribute, fit and total row on the table at the caret (Table menu). */
export function tableAction(app, ws, op) {
  const ed = ws.editor;
  const ctx = ed.tableContext();
  if (!ctx) return app.toast("Put the caret in a table first.", "warning");
  const m = ws.prj.model;
  const width = m.page.width - m.page.margins.left - m.page.margins.right;
  const labels = { sortAsc: "Sort Ascending", sortDesc: "Sort Descending", distribute: "Distribute Columns", fit: "Fit Table to Page", total: "Add Total Row" };
  try {
    let next;
    if (op === "sortAsc" || op === "sortDesc") next = D.tableSort(ctx.t, ctx.col, { desc: op === "sortDesc" }, m.theme);
    else if (op === "distribute") next = D.tableDistribute(ctx.t);
    else if (op === "fit") next = D.tableFit(ctx.t, width);
    else if (op === "total") next = D.tableTotalRow(ctx.t, {}, m.theme);
    else return;
    ed.commit(M.replaceTop(m, ctx.ti, next), { label: labels[op], sel: { path: [ctx.ti, 0, 0, 0], offset: 0 } });
  } catch (e) {
    app.toast(e.message, "warning", 3500);
  }
}
