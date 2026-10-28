// Dialogs of the Office Studio: new document (page presets and templates), page setup, header & footer, link, table
// picker and borders, paragraph, styles, image properties, document properties, word count and export.
import { h, downloadName } from "../../core/util.js";
import * as M from "../../engine/office/model.js";
import { openDialog, promptDialog } from "../dialogs.js";
import { openOfficeModel } from "./open.js";

const field = (label, input) => h("label.of-ofield", h("span", label), input);
const num = (value, { min = 0, max = 2000, step = 0.1 } = {}) => h("input.of-oinput", { type: "number", value: String(Math.round(value * 100) / 100), min, max, step });
const text = (value = "", attrs = {}) => h("input.of-oinput", { type: "text", value, ...attrs });
const sel = (options, value) => {
  const s = h("select.of-oinput", options.map(([v, t]) => h("option", { value: v }, t)));
  s.value = value;
  return s;
};
const check = (label, on) => {
  const c = h("input", { type: "checkbox" });
  c.checked = !!on;
  return { el: h("label.of-ocheck", c, label), get: () => c.checked };
};
const UNITS = { mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pt: 1 };

// ------------------------------------------------------------------------------------------------ new document

const TEMPLATES = [
  { id: "blank", label: "Blank document", hint: "An empty page" },
  { id: "letter", label: "Letter", hint: "Sender, recipient, date, subject and signature" },
  { id: "report", label: "Report", hint: "Title, summary, headings and a table" },
  { id: "invoice", label: "Invoice", hint: "Sender, customer, items table and totals" },
  { id: "memo", label: "Memo", hint: "To, from, date, subject and body" },
  { id: "meeting", label: "Meeting notes", hint: "Attendees, agenda, decisions and action items" },
  { id: "resume", label: "Resume", hint: "Name, contact line and sections" },
];

export function templateModel(id, size, orientation) {
  const d = M.createDocument({ size, orientation });
  const P = (t, s = "Normal", extra) => M.para(t, s, extra);
  if (id === "letter") {
    d.blocks = [P("Your Name"), P("Street and number"), P("City, ZIP"), P(""), P("Recipient Name"), P("Company"), P("Street and number"), P("City, ZIP"), P(""), P(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), "Normal", { props: { align: "right" } }), P(""), P([{ text: "Subject: ", b: true }, { text: "Your subject", b: true }]), P(""), P("Dear Ms. / Mr. …,"), P("Write your letter here."), P(""), P("Sincerely,"), P(""), P("Your Name")];
  } else if (id === "report") {
    const t = M.createTable(3, 3, d.page.width - d.page.margins.left - d.page.margins.right, { header: true });
    ["Item", "Value", "Notes"].forEach((v, i) => (t.rows[0].cells[i].blocks = [P([{ text: v, b: true }])]));
    d.blocks = [P("Report Title", "Title"), P("Subtitle or date", "Subtitle"), M.heading(1, "Summary"), P("State the main finding in one or two sentences."), M.heading(1, "Background"), P("Context and goals."), M.heading(2, "Details"), P("Supporting points:"), P("First point", "List", { list: { kind: "bullet", level: 0, id: "l1" } }), P("Second point", "List", { list: { kind: "bullet", level: 0, id: "l1" } }), t, M.heading(1, "Next steps"), P("What happens next.")];
    d.footer = [P([{ text: "Page " }, { type: "field", field: "page" }, { text: " of " }, { type: "field", field: "pages" }], "Normal", { props: { align: "center" } })];
  } else if (id === "invoice") {
    const w = d.page.width - d.page.margins.left - d.page.margins.right;
    const t = M.createTable(5, 4, w, { header: true });
    const cell = (r, c, v, b) => (t.rows[r].cells[c].blocks = [P(b ? [{ text: v, b: true }] : v, "Normal", c ? { props: { align: "right" } } : undefined)]);
    ["Description", "Quantity", "Unit price", "Amount"].forEach((v, i) => cell(0, i, v, true));
    [["Service or product", "1", "0.00", "0.00"], ["", "", "", ""], ["", "", "", ""]].forEach((row, r) => row.forEach((v, c) => cell(r + 1, c, v)));
    ["Total", "", "", "0.00"].forEach((v, i) => cell(4, i, v, true));
    d.blocks = [P("Invoice", "Title"), P("Your Company · Street · City · email@example.com"), P(""), P([{ text: "Bill to: ", b: true }, { text: "Customer name, address" }]), P([{ text: "Invoice no.: ", b: true }, { text: "2026-001" }]), P([{ text: "Date: ", b: true }, { text: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) }]), P(""), t, P(""), P("Payment due within 14 days. Bank details: …"), P("Thank you for your business.")];
  } else if (id === "memo") {
    const L = (k, v) => P([{ text: `${k}: `, b: true }, { text: v }]);
    d.blocks = [P("Memo", "Title"), L("To", "Recipients"), L("From", "Your Name"), L("Date", new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })), L("Subject", "Topic"), P(""), M.heading(1, "Summary"), P("The key message in two sentences."), M.heading(1, "Details"), P("Background, options and the recommendation.")];
  } else if (id === "meeting") {
    const B = (t, id) => P(t, "List", { list: { kind: "bullet", level: 0, id } });
    d.blocks = [P("Meeting Notes", "Title"), P(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), "Subtitle"), M.heading(1, "Attendees"), B("Name", "a1"), M.heading(1, "Agenda"), P("First topic", "List", { list: { kind: "number", level: 0, id: "g1" } }), P("Second topic", "List", { list: { kind: "number", level: 0, id: "g1" } }), M.heading(1, "Decisions"), B("Decision", "d1"), M.heading(1, "Action items"), B("Owner: task, due date", "t1")];
  } else if (id === "resume") {
    d.blocks = [P("Your Name", "Title"), P("City · email@example.com · +1 555 0100 · linkedin.com/in/you", "Subtitle"), M.heading(1, "Experience"), P([{ text: "Job Title, Company", b: true }, { text: " — 2021 to today" }]), P("Achievement with a measurable result", "List", { list: { kind: "bullet", level: 0, id: "e1" } }), P("Another achievement", "List", { list: { kind: "bullet", level: 0, id: "e1" } }), M.heading(1, "Education"), P([{ text: "Degree, School", b: true }, { text: " — 2017 to 2021" }]), M.heading(1, "Skills"), P("Skill one · Skill two · Skill three")];
  }
  return M.normalizeDoc(d);
}

export function newOfficeDocumentDialog(app) {
  const st = { size: "A4", orientation: "portrait", template: "blank", name: "Untitled document" };
  const sizes = h("div.of-onew__sizes", { role: "radiogroup", "aria-label": "Page size" });
  const renderSizes = () =>
    sizes.replaceChildren(
      ...["A4", "Letter", "Legal", "A5"].map((k) => {
        const p = M.PAGE_SIZES[k];
        const b = h("button.of-preset", { type: "button", role: "radio", "aria-checked": String(st.size === k), class: st.size === k ? "active" : "" }, h("strong", p.label), h("span", `${Math.round((p.width / 72) * 25.4)} × ${Math.round((p.height / 72) * 25.4)} mm`));
        b.addEventListener("click", () => {
          st.size = k;
          renderSizes();
        });
        return b;
      }),
    );
  renderSizes();
  const templates = h("div.of-onew__templates", { role: "radiogroup", "aria-label": "Template" });
  const renderTemplates = () =>
    templates.replaceChildren(
      ...TEMPLATES.map((t) => {
        const b = h("button.of-preset", { type: "button", role: "radio", "aria-checked": String(st.template === t.id), class: st.template === t.id ? "active" : "" }, h("strong", t.label), h("span", t.hint));
        b.addEventListener("click", () => {
          st.template = t.id;
          if (st.name.startsWith("Untitled") || TEMPLATES.some((x) => x.label === st.name)) name.value = st.name = t.id === "blank" ? "Untitled document" : t.label;
          renderTemplates();
        });
        return b;
      }),
    );
  renderTemplates();
  const orient = sel([["portrait", "Portrait"], ["landscape", "Landscape"]], "portrait");
  orient.addEventListener("change", () => (st.orientation = orient.value));
  const name = text(st.name, { "aria-label": "Name" });
  name.addEventListener("input", () => (st.name = name.value));
  const other = h("button.of-linkbtn", { type: "button" }, "Other document types (design, photo, layout, website)…");
  const body = h("div.of-onew", field("Name", name), h("h3.of-onew__h", "Template"), templates, h("h3.of-onew__h", "Page size"), sizes, field("Orientation", orient), other);
  const { close } = openDialog({
    title: "New Document",
    body,
    width: 640,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Create",
        variant: "primary",
        onClick: (c) => {
          c();
          const model = templateModel(st.template, st.size, st.orientation);
          model.meta.title = st.name || "";
          openOfficeModel(app, model, { name: st.name || "Untitled document" });
        },
      },
    ],
  });
  other.addEventListener("click", () => {
    close();
    import("../dialogs.js").then((m) => m.newDocumentDialog(app, { studio: "vector" }));
  });
}

// ------------------------------------------------------------------------------------------------ page setup

export function pageSetupDialog(app, ws) {
  const m = ws.prj.model;
  const pg = m.page;
  let unit = "mm";
  const conv = (v) => v / UNITS[unit];
  const size = sel([...Object.entries(M.PAGE_SIZES).map(([k, p]) => [k, p.label]), ["custom", "Custom"]], pg.size);
  const orient = sel([["portrait", "Portrait"], ["landscape", "Landscape"]], pg.orientation);
  const unitSel = sel([["mm", "Millimeters"], ["cm", "Centimeters"], ["in", "Inches"], ["pt", "Points"]], unit);
  const w = num(conv(pg.width));
  const hgt = num(conv(pg.height));
  const mg = Object.fromEntries(["top", "bottom", "left", "right", "header", "footer"].map((k) => [k, num(conv(pg.margins[k]))]));
  const cols = sel([["1", "One column"], ["2", "Two columns"], ["3", "Three columns"]], String(pg.columns || 1));
  const read = () => ({ w: Number(w.value) * UNITS[unit], h: Number(hgt.value) * UNITS[unit], m: Object.fromEntries(Object.entries(mg).map(([k, i]) => [k, Number(i.value) * UNITS[unit]])) });
  unitSel.addEventListener("change", () => {
    const cur = read();
    unit = unitSel.value;
    w.value = String(Math.round(conv(cur.w) * 100) / 100);
    hgt.value = String(Math.round(conv(cur.h) * 100) / 100);
    for (const [k, i] of Object.entries(mg)) i.value = String(Math.round(conv(cur.m[k]) * 100) / 100);
  });
  const applySize = () => {
    const p = M.PAGE_SIZES[size.value];
    if (!p) return;
    const land = orient.value === "landscape";
    w.value = String(Math.round(conv(land ? p.height : p.width) * 100) / 100);
    hgt.value = String(Math.round(conv(land ? p.width : p.height) * 100) / 100);
  };
  size.addEventListener("change", applySize);
  orient.addEventListener("change", () => {
    if (size.value === "custom") [w.value, hgt.value] = [hgt.value, w.value];
    else applySize();
  });
  const note = h("p.of-hint", "Columns are stored in DOCX/ODT files and used by Word and LibreOffice; the editor and the PDF export show one column.");
  const body = h("div.of-oform",
    h("div.of-orow", field("Paper size", size), field("Orientation", orient), field("Units", unitSel)),
    h("div.of-orow", field("Width", w), field("Height", hgt)),
    h("h3.of-onew__h", "Margins"),
    h("div.of-orow", field("Top", mg.top), field("Bottom", mg.bottom), field("Left", mg.left), field("Right", mg.right)),
    h("div.of-orow", field("Header distance", mg.header), field("Footer distance", mg.footer), field("Columns", cols)),
    note);
  openDialog({
    title: "Page Setup",
    body,
    width: 600,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Apply",
        variant: "primary",
        onClick: (c) => {
          const v = read();
          if (!(v.w >= 72 && v.h >= 72)) return app.toast("The page must be at least 1 inch (25.4 mm) wide and high.", "warning");
          if (v.m.left + v.m.right > v.w - 36 || v.m.top + v.m.bottom > v.h - 36) return app.toast("The margins leave no room for text.", "warning");
          const page = { ...pg, size: size.value, orientation: v.w > v.h ? "landscape" : "portrait", width: v.w, height: v.h, margins: v.m, columns: Number(cols.value) };
          ws.editor.commit({ ...ws.prj.model, page }, { label: "Page Setup" });
          c();
        },
      },
    ],
  });
}

// ------------------------------------------------------------------------------------------------ header and footer

const toFieldText = (paras) => paras.map((p) => p.runs.map((r) => (M.isText(r) ? r.text : r.type === "field" ? `{${r.field.toUpperCase()}}` : r.type === "break" ? "\n" : "")).join("")).join("\n");
const fromFieldText = (s, align) =>
  String(s)
    .split("\n")
    .filter((l, i, a) => l.trim() || a.length === 1)
    .map((line) => {
      const runs = [];
      for (const part of line.split(/(\{PAGE\}|\{PAGES\}|\{DATE\})/i)) {
        if (!part) continue;
        const f = /^\{(PAGE|PAGES|DATE)\}$/i.exec(part);
        runs.push(f ? { type: "field", field: f[1].toLowerCase() } : { text: part });
      }
      return M.para(runs, "Normal", align && align !== "left" ? { props: { align } } : {});
    })
    .filter((p) => p.runs.length);

export function headerFooterDialog(app, ws) {
  const m = ws.prj.model;
  const ht = h("textarea.of-oinput", { rows: 2, "aria-label": "Header text" }, toFieldText(m.header));
  const ft = h("textarea.of-oinput", { rows: 2, "aria-label": "Footer text" }, toFieldText(m.footer));
  const alignOf = (paras) => paras[0]?.props?.align || "left";
  const ha = sel([["left", "Left"], ["center", "Center"], ["right", "Right"]], alignOf(m.header));
  const fa = sel([["left", "Left"], ["center", "Center"], ["right", "Right"]], alignOf(m.footer));
  const body = h("div.of-oform",
    field("Header", ht), field("Header alignment", ha),
    field("Footer", ft), field("Footer alignment", fa),
    h("p.of-hint", "Use {PAGE} for the page number, {PAGES} for the number of pages and {DATE} for the date, for example: Page {PAGE} of {PAGES}. The same header and footer appear on every page (different first or odd/even pages are not supported yet)."));
  openDialog({
    title: "Header & Footer",
    body,
    width: 560,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      { label: "Apply", variant: "primary", onClick: (c) => (ws.editor.commit({ ...ws.prj.model, header: fromFieldText(ht.value, ha.value), footer: fromFieldText(ft.value, fa.value) }, { label: "Header & Footer" }), c()) },
    ],
  });
}

export { fromFieldText };

// ------------------------------------------------------------------------------------------------ links

export async function linkDialog(app, ws) {
  const cur = ws.editor.linkAt();
  const v = await promptDialog({ title: cur ? "Edit link" : "Insert link", label: "Web address (https://…, mailto:… or #heading). Leave empty to remove the link.", value: cur || "https://", ok: "Apply" });
  if (v === null) return;
  const href = v.trim() && v.trim() !== "https://" ? M.safeHref(/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v.trim()) ? `https://${v.trim()}` : v.trim()) : null;
  if (v.trim() && v.trim() !== "https://" && !href) return app.toast("Only web (https), email (mailto) and phone (tel) links are allowed.", "warning");
  ws.editor.setLink(href);
  ws.editor.focus();
}

// ------------------------------------------------------------------------------------------------ table picker

export function tablePicker(app, anchor, onPick) {
  document.querySelector(".of-otable-pop")?.remove();
  const N = 10;
  let hr = 0;
  let hc = 0;
  const label = h("div.of-otable-pop__label", "Insert table");
  const grid = h("div.of-otable-pop__grid", { role: "grid", "aria-label": "Table size" });
  const cells = [];
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const b = h("button.of-otable-pop__cell", { type: "button", role: "gridcell", tabindex: r === 0 && c === 0 ? "0" : "-1", "aria-label": `${r + 1} by ${c + 1} table` });
      b.addEventListener("mouseenter", () => mark(r, c));
      b.addEventListener("focus", () => mark(r, c));
      b.addEventListener("click", () => pick(r, c));
      cells.push(b);
      grid.append(b);
    }
  const custom = h("button.of-linkbtn", { type: "button" }, "Custom size…");
  const pop = h("div.of-otable-pop", { role: "dialog", "aria-label": "Insert table" }, label, grid, custom);
  function mark(r, c) {
    hr = r;
    hc = c;
    cells.forEach((b, i) => b.classList.toggle("on", Math.floor(i / N) <= r && i % N <= c));
    label.textContent = `${r + 1} × ${c + 1} table`;
  }
  function done() {
    pop.remove();
    document.removeEventListener("mousedown", outside, true);
  }
  function pick(r, c) {
    done();
    onPick(r + 1, c + 1);
  }
  const outside = (e) => !pop.contains(e.target) && done();
  grid.addEventListener("keydown", (e) => {
    const moves = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
    if (moves[e.key]) {
      e.preventDefault();
      const r = Math.max(0, Math.min(N - 1, hr + moves[e.key][0]));
      const c = Math.max(0, Math.min(N - 1, hc + moves[e.key][1]));
      cells[r * N + c].focus();
    } else if (e.key === "Escape") done();
  });
  custom.addEventListener("click", async () => {
    done();
    const v = await promptDialog({ title: "Insert table", label: "Rows × columns (for example 4 x 3)", value: "4 x 3", ok: "Insert" });
    const m = v && /(\d+)\s*[x×*,]\s*(\d+)/i.exec(v);
    if (m) onPick(Math.min(200, Math.max(1, +m[1])), Math.min(40, Math.max(1, +m[2])));
  });
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 260, r.left))}px`;
  pop.style.top = `${r.bottom + 6}px`;
  setTimeout(() => document.addEventListener("mousedown", outside, true));
  mark(0, 0);
  cells[0].focus();
}

export function bordersDialog(app, ws) {
  const ctx = ws.editor.tableContext();
  if (!ctx) return app.toast("Put the caret in a table first.", "warning");
  const b = ctx.t.borders;
  const style = sel([["single", "Solid lines"], ["none", "No borders"]], b.style);
  const width = num(b.width, { min: 0.25, max: 6, step: 0.25 });
  const color = h("input.of-oinput", { type: "color", value: b.color });
  openDialog({
    title: "Table Borders",
    body: h("div.of-oform", h("div.of-orow", field("Borders", style), field("Width (pt)", width), field("Color", color))),
    width: 460,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      { label: "Apply", variant: "primary", onClick: (c) => (ws.editor.tableOp("borders", { style: style.value, width: Number(width.value) || 0.5, color: color.value }), c()) },
    ],
  });
}

export function shadingDialog(app, ws) {
  if (!ws.editor.tableContext()) return app.toast("Put the caret in a table first.", "warning");
  const color = h("input.of-oinput", { type: "color", value: "#fff2cc" });
  openDialog({
    title: "Cell Shading",
    body: h("div.of-oform", field("Fill color of the selected cells", color)),
    width: 420,
    buttons: [
      { label: "No fill", onClick: (c) => (ws.editor.tableOp("shading", null), c()) },
      { label: "Cancel", onClick: (c) => c() },
      { label: "Apply", variant: "primary", onClick: (c) => (ws.editor.tableOp("shading", color.value), c()) },
    ],
  });
}

// ------------------------------------------------------------------------------------------------ paragraph / styles

export function paragraphDialog(app, ws) {
  const ed = ws.editor;
  const p = ed.currentPara();
  if (!p) return;
  const pp = M.effectivePara(ws.prj.model, p);
  const align = sel([["left", "Left"], ["center", "Center"], ["right", "Right"], ["justify", "Justified"]], pp.align || "left");
  const before = num(pp.spaceBefore || 0);
  const after = num(pp.spaceAfter || 0);
  const line = num(pp.lineHeight || 1.15, { min: 0.5, max: 10, step: 0.05 });
  const left = num(pp.indentLeft || 0, { min: -500 });
  const right = num(pp.indentRight || 0, { min: -500 });
  const first = num(pp.indentFirst || 0, { min: -500 });
  const keep = check("Keep with next paragraph", pp.keepWithNext);
  const brk = check("Page break before", pp.pageBreakBefore);
  openDialog({
    title: "Paragraph",
    body: h("div.of-oform", h("div.of-orow", field("Alignment", align), field("Line spacing (×)", line)), h("div.of-orow", field("Space before (pt)", before), field("Space after (pt)", after)), h("div.of-orow", field("Indent left (pt)", left), field("Indent right (pt)", right), field("First line (pt, negative = hanging)", first)), keep.el, brk.el),
    width: 560,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Apply",
        variant: "primary",
        onClick: (c) => {
          ed.setParagraph({ align: align.value, spaceBefore: Number(before.value), spaceAfter: Number(after.value), lineHeight: Number(line.value), indentLeft: Number(left.value) || null, indentRight: Number(right.value) || null, indentFirst: Number(first.value) || null, keepWithNext: keep.get() || null, pageBreakBefore: brk.get() || null });
          c();
        },
      },
    ],
  });
}

/** Modify a named style (id) or create a new one from the paragraph at the caret (id = null). */
export function styleDialog(app, ws, id) {
  const m = ws.prj.model;
  const ed = ws.editor;
  const isNew = !id;
  const base = isNew ? ed.currentPara()?.style || "Normal" : id;
  const st = M.resolveStyle(m, base);
  const own = isNew ? { para: {}, run: {} } : m.styles[id];
  const marks = isNew ? ed.activeMarks()._own || {} : {};
  const name = text(isNew ? "" : own.name || id, { "aria-label": "Style name" });
  const parentIds = Object.keys(m.styles).filter((k) => k !== id && m.styles[k].type !== "character");
  const basedOn = sel([["", "(none)"], ...parentIds.map((k) => [k, m.styles[k].name || k])], isNew ? base : own.basedOn || "");
  const nextSel = sel([["", "(same style)"], ...parentIds.map((k) => [k, m.styles[k].name || k])], isNew ? "" : own.next || "");
  const font = text((isNew ? marks.font : own.run?.font) || "", { list: "of-office-fonts", placeholder: st.run.font || "inherit" });
  const size = num((isNew ? marks.size : own.run?.size) || st.run.size || 11, { min: 1, max: 400, step: 0.5 });
  const color = h("input.of-oinput", { type: "color", value: (isNew ? marks.color : own.run?.color) || st.run.color || "#000000" });
  const bold = check("Bold", isNew ? marks.b ?? st.run.b : own.run?.b ?? st.run.b);
  const ital = check("Italic", isNew ? marks.i ?? st.run.i : own.run?.i ?? st.run.i);
  const align = sel([["", "(inherit)"], ["left", "Left"], ["center", "Center"], ["right", "Right"], ["justify", "Justified"]], own.para?.align || "");
  const before = num(own.para?.spaceBefore ?? st.para.spaceBefore ?? 0);
  const after = num(own.para?.spaceAfter ?? st.para.spaceAfter ?? 0);
  const line = num(own.para?.lineHeight ?? st.para.lineHeight ?? 1.15, { min: 0.5, max: 10, step: 0.05 });
  const outline = sel([["0", "Body text"], ...[1, 2, 3, 4, 5, 6].map((n) => [String(n), `Level ${n} (outline)`])], String(own.outline || 0));
  openDialog({
    title: isNew ? "New Style" : `Modify Style: ${own.name || id}`,
    body: h("div.of-oform",
      h("div.of-orow", field("Name", name), field("Based on", basedOn), field("Next paragraph", nextSel)),
      h("div.of-orow", field("Font", font), field("Size (pt)", size), field("Color", color)),
      h("div.of-orow", bold.el, ital.el),
      h("div.of-orow", field("Alignment", align), field("Space before (pt)", before), field("Space after (pt)", after), field("Line spacing", line)),
      field("Outline level", outline),
      h("p.of-hint", "Changes apply to every paragraph with this style. Styles are saved in DOCX, ODT and RTF files.")),
    width: 640,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: isNew ? "Create" : "Apply",
        variant: "primary",
        onClick: (c) => {
          const nm = name.value.trim();
          if (!nm) return app.toast("Enter a style name.", "warning");
          const sid = isNew ? M.styleIdFor(m, nm) : id;
          const run = { ...(own.run || {}), size: Number(size.value) || undefined, color: color.value, b: bold.get() || undefined, i: ital.get() || undefined };
          if (font.value.trim()) run.font = font.value.trim();
          else delete run.font;
          const para = { ...(own.para || {}), spaceBefore: Number(before.value), spaceAfter: Number(after.value), lineHeight: Number(line.value) };
          if (align.value) para.align = align.value;
          else delete para.align;
          const entry = { name: nm, type: "paragraph", para, run, ...(basedOn.value && sid !== "Normal" ? { basedOn: basedOn.value } : {}), ...(nextSel.value ? { next: nextSel.value } : {}), ...(Number(outline.value) ? { outline: Number(outline.value) } : {}) };
          const next = M.normalizeDoc({ ...ws.prj.model, styles: { ...ws.prj.model.styles, [sid]: entry } });
          // keep block identity: only the styles change
          let model = { ...ws.prj.model, styles: next.styles };
          if (isNew) {
            const [a, b] = ed.range;
            model = M.setParagraphStyle(model, a, b, sid);
          }
          ed.commit(model, { label: isNew ? "New Style" : "Modify Style" });
          c();
        },
      },
    ],
  });
}

// ------------------------------------------------------------------------------------------------ image / properties / count

export function imagePropertiesDialog(app, ws) {
  const ed = ws.editor;
  const [a, b] = ed.range;
  const p = M.getBlock(ws.prj.model, a.path);
  const r = p && M.samePath(a.path, b.path) && b.offset - a.offset === 1 ? M.sliceRuns(p.runs, a.offset, b.offset)[0] : null;
  if (r?.type !== "image") return app.toast("Click an image first.", "warning");
  const media = ws.prj.model.media[r.media];
  const ratio = r.height / r.width;
  const w = num(r.width, { min: 4, max: 2000, step: 1 });
  const hh = num(r.height, { min: 4, max: 2000, step: 1 });
  const lock = check("Keep proportions", true);
  w.addEventListener("input", () => lock.get() && (hh.value = String(Math.round(Number(w.value) * ratio * 10) / 10)));
  hh.addEventListener("input", () => lock.get() && (w.value = String(Math.round((Number(hh.value) / ratio) * 10) / 10)));
  const alt = h("textarea.of-oinput", { rows: 2, "aria-label": "Alternative text" }, r.alt || "");
  openDialog({
    title: "Image",
    body: h("div.of-oform", h("p.of-hint", `${media?.name || r.media} · ${media?.w || "?"} × ${media?.h || "?"} px`), h("div.of-orow", field("Width (pt)", w), field("Height (pt)", hh)), lock.el, field("Alternative text (read by screen readers, kept in DOCX/ODT/HTML)", alt)),
    width: 520,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      {
        label: "Apply",
        variant: "primary",
        onClick: (c) => {
          const nr = { ...r, width: Math.max(4, Number(w.value) || r.width), height: Math.max(4, Number(hh.value) || r.height) };
          if (alt.value.trim()) nr.alt = alt.value.trim();
          else delete nr.alt;
          const runs = [...M.sliceRuns(p.runs, 0, a.offset), nr, ...M.sliceRuns(p.runs, b.offset, Infinity)];
          ed.commit(M.setBlock(ws.prj.model, a.path, { ...p, runs }), { label: "Image Properties", sel: ed.sel });
          c();
        },
      },
    ],
  });
}

export function propertiesDialog(app, ws) {
  const meta = ws.prj.model.meta;
  const inputs = Object.fromEntries(["title", "author", "subject", "keywords", "lang"].map((k) => [k, text(meta[k] || "")]));
  openDialog({
    title: "Document Properties",
    body: h("div.of-oform", field("Title", inputs.title), field("Author", inputs.author), field("Subject", inputs.subject), field("Keywords (comma separated)", inputs.keywords), field("Language (for example en-US)", inputs.lang)),
    width: 520,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      { label: "Apply", variant: "primary", onClick: (c) => (ws.editor.commit({ ...ws.prj.model, meta: { ...meta, ...Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()])) } }, { label: "Document Properties" }), c()) },
    ],
  });
}

export function wordCountDialog(app, ws) {
  const s = M.stats(ws.prj.model);
  const selText = ws.editor.collapsed ? "" : ws.editor.selectedText();
  const rows = [["Pages (approximate)", ws.editor.pages], ["Words", s.words], ["Characters (with spaces)", s.chars], ["Characters (no spaces)", s.charsNoSpaces], ["Paragraphs", s.paragraphs]];
  if (selText) rows.push(["Words in the selection", (selText.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length]);
  openDialog({ title: "Word Count", body: h("table.of-otable-stats", rows.map(([k, v]) => h("tr", h("th", { scope: "row" }, k), h("td", Number(v).toLocaleString("en-US"))))), width: 420, buttons: [{ label: "Close", variant: "primary", onClick: (c) => c() }] });
}

// ------------------------------------------------------------------------------------------------ export

const EXPORT_INFO = {
  docx: "Microsoft Word. Opens in Word, LibreOffice, Google Docs and Pages.",
  odt: "OpenDocument Text (LibreOffice, Collabora, Word).",
  pdf: "For printing and sharing. Uses standard PDF fonts (Helvetica, Times, Courier); links are not clickable.",
  rtf: "Rich Text for older word processors. SVG images are converted to PNG.",
  html: "A web page with embedded images and styles.",
  md: "Markdown for wikis and docs sites. Colors, fonts and page setup are not kept.",
  txt: "Plain text only.",
};

export function exportOfficeDialog(app, ws, preset = "docx") {
  const fmt = sel([["docx", "Word document (.docx)"], ["odt", "OpenDocument text (.odt)"], ["pdf", "PDF (.pdf)"], ["rtf", "Rich Text (.rtf)"], ["html", "Web page (.html)"], ["md", "Markdown (.md)"], ["txt", "Plain text (.txt)"]], preset);
  const info = h("p.of-hint", EXPORT_INFO[preset]);
  fmt.addEventListener("change", () => (info.textContent = EXPORT_INFO[fmt.value]));
  openDialog({
    title: "Export Document",
    body: h("div.of-oform", field("Format", fmt), info, h("p.of-hint", "The OpenFini document (.ofini, File ▸ Save) keeps everything; exports are copies in other formats.")),
    width: 500,
    buttons: [
      { label: "Cancel", onClick: (c) => c() },
      { label: "Export…", variant: "primary", onClick: (c) => (c(), exportOffice(app, ws, fmt.value)) },
    ],
  });
}

/** Renders SVG / non-JPEG images to PNG or RGBA for writers that need them (DOCX fallback, RTF, PDF). */
export async function rasterize(media, { rgba = false } = {}) {
  const out = {};
  for (const [id, m] of Object.entries(media || {})) {
    if (!m.bytes) continue;
    if (!rgba && m.mime !== "image/svg+xml") continue;
    if (rgba && m.mime === "image/jpeg") continue;
    try {
      const bmp = await createImageBitmap(new Blob([m.bytes], { type: m.mime }));
      const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const hh = Math.max(1, Math.round(bmp.height * scale));
      const c = new OffscreenCanvas(w, hh);
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0, w, hh);
      if (rgba) out[id] = { width: w, height: hh, rgba: ctx.getImageData(0, 0, w, hh).data };
      else out[id] = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    } catch {
      /* undecodable image: the writer uses a placeholder */
    }
  }
  return out;
}

/** Writes the document in a format and asks where to save it. Returns the result of platform.saveFile. */
export async function exportOffice(app, ws, format) {
  const { platform } = await import("../../platform/index.js");
  const model = ws.prj.model;
  const base = (ws.doc.name || "Document").replace(/\.(docx|odt|rtf|html?|md|txt|pdf)$/i, "");
  app.status(`Exporting ${format.toUpperCase()}…`);
  try {
    let bytes;
    let mime;
    let ext = format;
    if (format === "pdf") {
      const images = await rasterize(model.media, { rgba: true });
      const { exportPdf } = await import("../../engine/office/pdf.js");
      bytes = exportPdf(model, { images, title: model.meta.title || base });
      mime = "application/pdf";
    } else {
      const svgFallbacks = format === "docx" || format === "rtf" ? await rasterize(model.media) : {};
      const { exportOffice: write } = await import("../../engine/office/index.js");
      const out = write(model, format, { svgFallbacks, title: model.meta.title || base });
      bytes = out.bytes;
      mime = out.mime;
      ext = out.ext;
    }
    const res = await platform.saveFile({ suggestedName: downloadName(base, ext), bytes, mime, filters: [{ name: format.toUpperCase(), extensions: [ext] }] });
    if (res) app.toast(`Exported ${res.name}`, "success", 2200);
    return res;
  } finally {
    app.status("");
  }
}
