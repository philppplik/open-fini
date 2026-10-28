// Office Studio workspace: formatting toolbar, outline / styles sidebar, find & replace bar and the page editor.
// Mounted by the Office Suite host (office/host.js) through the Document app (office/document/app.js), one per document.
import { h } from "../../core/util.js";
import * as M from "../../engine/office/model.js";
import { iconButton } from "../controls.js";
import { OfficeEditor } from "./editor.js";

const FONTS = ["Calibri", "Arial", "Helvetica", "Verdana", "Segoe UI", "Inter", "Georgia", "Times New Roman", "Cambria", "Garamond", "Palatino Linotype", "Courier New", "Consolas"];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const SPACING = [["1", "Single"], ["1.15", "1.15"], ["1.5", "1.5 lines"], ["2", "Double"], ["2.5", "2.5"], ["3", "Triple"]];

/** The word processor's workspace; mounted by the Office Suite host (office/document/app.js ▸ mount). */
export class OfficeWorkspace {
  constructor(app, doc) {
    this.app = app;
    this.doc = doc;
    this.prj = doc.office;
    // validate the stored model once (files from disk, older versions, Vibe edits)
    if (this.prj.model._raw || this.prj.model.version !== M.OFFICE_VERSION || !Array.isArray(this.prj.model.blocks)) this.prj.model = M.normalizeDoc(this.prj.model);
    this.editor = new OfficeEditor(app, doc);
    this.prj.on("change", (info) => {
      this.editor.modelChanged(info);
      this.#refreshPanels();
    });
    this.editor.on((kind) => {
      if (kind === "selection" || kind === "model") this.#scheduleToolbar();
      if (kind === "layout" || kind === "model") app.emit("officestatus");
      if (kind === "escape") this.find.close();
    });
    this.#build();
    this.#refreshPanels();
  }

  activate() {
    this.editor.relayout();
    this.#refreshPanels();
    this.#updateToolbar();
    this.app.emit("officestatus");
    this.app.emit("contextbar");
    requestAnimationFrame(() => this.editor.el.isConnected && !document.querySelector("sl-dialog[open]") && this.editor.focus());
  }
  deactivate() {}

  statusText() {
    const s = M.stats(this.prj.model);
    const pages = this.editor.pages;
    const sel = this.editor.collapsed ? "" : ` · ${(this.editor.selectedText().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length} selected`;
    return `Page${pages === 1 ? "" : "s"}: ${pages} · ${s.words.toLocaleString("en-US")} word${s.words === 1 ? "" : "s"}${sel} · ${s.chars.toLocaleString("en-US")} characters · ${this.prj.view.layout === "web" ? "Web layout" : "Print layout"} · ${Math.round((this.prj.view.zoom || 1) * 100)}%`;
  }

  // ------------------------------------------------------------------------------------------ layout

  #build() {
    const ed = this.editor;
    const keep = (b) => {
      b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the caret in the document
      return b;
    };
    const btn = (icon, label, run, shortcut) => keep(iconButton({ icon, label, shortcut, onClick: () => { run(); ed.focus(); } }));
    const glyph = (text, label, run, shortcut, cls = "") => {
      const b = keep(h("button.of-ibtn.of-otb__glyph", { type: "button", "aria-label": label, "data-tip": label, "data-shortcut": shortcut, class: cls }, text));
      b.addEventListener("click", () => {
        run();
        ed.focus();
      });
      return b;
    };
    const select = (label, options, onChange, cls = "") => {
      const s = h("select.of-otb__select", { "aria-label": label, "data-tip": label, class: cls }, options.map(([v, t]) => h("option", { value: v }, t)));
      s.addEventListener("change", () => {
        onChange(s.value);
        ed.focus();
      });
      return s;
    };

    this.styleSel = select("Paragraph style", [], (v) => ed.setStyle(v), "of-otb__style");
    this.fontSel = h("input.of-otb__font", { "aria-label": "Font", "data-tip": "Font", list: "of-office-fonts", spellcheck: "false" });
    this.fontSel.addEventListener("change", () => {
      const v = this.fontSel.value.trim();
      if (v) ed.setMarks({ font: v }, "Font");
      ed.focus();
    });
    this.fontSel.addEventListener("keydown", (e) => e.key === "Enter" && this.fontSel.dispatchEvent(new Event("change")));
    const fontList = h("datalist", { id: "of-office-fonts" }, FONTS.map((f) => h("option", { value: f })));
    this.sizeSel = h("input.of-otb__size", { "aria-label": "Font size (points)", "data-tip": "Font size (points)", list: "of-office-sizes", inputmode: "decimal" });
    this.sizeSel.addEventListener("change", () => {
      const v = parseFloat(this.sizeSel.value);
      if (v > 0 && v < 1639) ed.setMarks({ size: Math.round(v * 2) / 2 }, "Font Size");
      ed.focus();
    });
    this.sizeSel.addEventListener("keydown", (e) => e.key === "Enter" && this.sizeSel.dispatchEvent(new Event("change")));
    const sizeList = h("datalist", { id: "of-office-sizes" }, SIZES.map((s) => h("option", { value: String(s) })));

    this.b = glyph("B", "Bold", () => ed.toggleMark("b"), "Mod+B", "is-bold");
    this.i = glyph("I", "Italic", () => ed.toggleMark("i"), "Mod+I", "is-italic");
    this.u = glyph("U", "Underline", () => ed.toggleMark("u"), "Mod+U", "is-underline");
    this.s = glyph("S", "Strikethrough", () => ed.toggleMark("s"), "Mod+Shift+X", "is-strike");
    this.sup = glyph("x²", "Superscript", () => ed.toggleMark("va", "super"), "Mod+.");
    this.sub = glyph("x₂", "Subscript", () => ed.toggleMark("va", "sub"), "Mod+,");
    const colorIn = (label, onPick, swatch) => {
      const input = h("input", { type: "color", value: swatch, "aria-label": label, class: "of-otb__colorin" });
      const bar = h("span.of-otb__swatch", { style: `background:${swatch}` });
      const wrap = h("label.of-ibtn.of-otb__color", { "data-tip": label }, h("span.of-otb__colorglyph", label === "Text color" ? "A" : "ab"), bar, input);
      input.addEventListener("input", () => (bar.style.background = input.value));
      input.addEventListener("change", () => {
        onPick(input.value);
        ed.focus();
      });
      return wrap;
    };
    const color = colorIn("Text color", (v) => ed.setMarks({ color: v }, "Text Color"), "#c00000");
    const hl = colorIn("Highlight color", (v) => ed.setMarks({ highlight: v }, "Highlight"), "#ffff00");
    this.align = {
      left: btn("text-left", "Align left", () => ed.setParagraph({ align: "left" }), "Mod+L"),
      center: btn("text-center", "Center", () => ed.setParagraph({ align: "center" }), "Mod+E"),
      right: btn("text-right", "Align right", () => ed.setParagraph({ align: "right" }), "Mod+R"),
      justify: btn("justify", "Justify", () => ed.setParagraph({ align: "justify" }), "Mod+J"),
    };
    this.bul = btn("list-ul", "Bulleted list", () => ed.toggleList("bullet"), "Mod+Shift+L");
    this.num = btn("list-ol", "Numbered list", () => ed.toggleList("number"), "Mod+Shift+N");
    const out = glyph("⇤", "Decrease indent", () => ed.indent(-1), "Shift+Tab");
    const inn = glyph("⇥", "Increase indent", () => ed.indent(1), "Tab");
    this.spacing = select("Line spacing", SPACING, (v) => ed.setParagraph({ lineHeight: Number(v) }, "Line Spacing"));
    const clear = btn("eraser", "Clear formatting", () => ed.clearFormatting(), "Mod+Space");
    const link = btn("link-45deg", "Link…", () => this.app.run("office.insertLink"), "Mod+K");
    const img = btn("image", "Insert image…", () => this.app.run("office.insertImage"));
    const table = keep(iconButton({ icon: "table", label: "Insert table", onClick: (e, b) => import("./dialogs.js").then((m) => m.tablePicker(this.app, b, (r, c) => ed.insertTable(r, c))) }));
    const pb = glyph("⤓", "Page break", () => ed.insertPageBreak(), "Mod+Enter");
    const fn = glyph("¹", "Footnote…", () => this.app.run("office.insertFootnote"));
    this.layoutBtn = h("div.of-otb__seg", { role: "group", "aria-label": "Layout" },
      (this.printBtn = keep(h("button.of-otb__segbtn", { type: "button", "aria-pressed": "true", onclick: () => this.app.run("office.printLayout") }, "Print"))),
      (this.webBtn = keep(h("button.of-otb__segbtn", { type: "button", "aria-pressed": "false", onclick: () => this.app.run("office.webLayout") }, "Web"))));
    this.zoomSel = select("Zoom", [["0.5", "50%"], ["0.75", "75%"], ["1", "100%"], ["1.25", "125%"], ["1.5", "150%"], ["2", "200%"], ["width", "Page width"]], (v) => (v === "width" ? ed.zoomToWidth() : ed.setZoom(Number(v))));
    const sideBtn = btn("layout-sidebar-inset", "Show / hide outline and styles", () => this.toggleSidebar());
    const findBtn = btn("search", "Find and replace", () => this.find.open(false), "Mod+F");
    const sep = () => h("span.of-otb__sep", { role: "separator" });
    this.toolbar = h("div.of-otb", { role: "toolbar", "aria-label": "Formatting" },
      sideBtn, sep(), this.styleSel, this.fontSel, fontList, this.sizeSel, sizeList, sep(),
      this.b, this.i, this.u, this.s, this.sup, this.sub, color, hl, sep(),
      this.align.left, this.align.center, this.align.right, this.align.justify, sep(),
      this.bul, this.num, out, inn, this.spacing, clear, sep(),
      link, img, table, pb, fn, h("span.of-otb__grow"), findBtn, this.layoutBtn, this.zoomSel);
    // roving arrow keys inside the toolbar
    this.toolbar.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      const items = [...this.toolbar.querySelectorAll("button, select, input:not([type=color])")];
      const i = items.indexOf(e.target);
      if (i < 0) return;
      e.preventDefault();
      items[(i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length].focus();
    });

    // sidebar
    this.outlineList = h("ol.of-oside__outline", { "aria-label": "Document outline" });
    this.stylesList = h("ul.of-oside__styles", { "aria-label": "Styles" });
    const tabBtn = (id, label) => {
      const b = h("button.of-oside__tab", { type: "button", role: "tab", "aria-selected": "false", "data-tab": id }, label);
      b.addEventListener("click", () => this.showPanel(id));
      return b;
    };
    this.tabs = h("div.of-oside__tabs", { role: "tablist", "aria-label": "Sidebar" }, tabBtn("outline", "Outline"), tabBtn("styles", "Styles"));
    this.outlinePanel = h("div.of-oside__panel", { role: "tabpanel", "aria-label": "Outline" }, this.outlineList);
    const newStyle = h("button.of-btn.of-btn--default", { type: "button", onclick: () => import("./dialogs.js").then((m) => m.styleDialog(this.app, this, null)) }, "New style…");
    this.stylesPanel = h("div.of-oside__panel", { role: "tabpanel", "aria-label": "Styles" }, this.stylesList, h("div.of-oside__actions", newStyle));
    this.side = h("aside.of-oside", this.tabs, this.outlinePanel, this.stylesPanel);

    this.find = createFindBar(this);
    this.scroller = h("div.of-office__scroll", this.editor.el);
    this.scroller.addEventListener("mousedown", (e) => {
      // clicks on the gray area beside the pages put the caret at the end
      if (e.target === this.scroller || e.target === this.editor.el) {
        e.preventDefault();
        const last = [...M.paragraphs(this.prj.model)].pop();
        this.editor.setSelection({ anchor: { path: last.path, offset: M.paraLength(last.para) }, focus: { path: last.path, offset: M.paraLength(last.para) } });
      }
    });
    this.main = h("div.of-office__main", this.find.el, this.scroller);
    this.el = h("div.of-office", { "data-sidebar": this.app.prefs.officeSidebar === false ? "off" : "on" }, this.toolbar, h("div.of-office__body", this.side, this.main));
    this.showPanel(this.prj.view.panel || "outline");
  }

  toggleSidebar(force) {
    const on = force ?? this.el.dataset.sidebar === "off";
    this.el.dataset.sidebar = on ? "on" : "off";
    this.app.setPref("officeSidebar", on);
  }

  showPanel(id) {
    this.prj.view.panel = id;
    for (const t of this.tabs.children) t.setAttribute("aria-selected", String(t.dataset.tab === id));
    this.outlinePanel.hidden = id !== "outline";
    this.stylesPanel.hidden = id !== "styles";
    if (this.el.dataset.sidebar === "off") this.toggleSidebar(true);
  }

  #refreshPanels() {
    const m = this.prj.model;
    // outline
    const items = M.outline(m);
    this.outlineList.replaceChildren(
      ...(items.length
        ? items.map((o) => h("li", { style: `--lvl:${o.level - 1}` }, h("button.of-oside__item", { type: "button", onclick: () => this.editor.setSelection({ anchor: { path: o.path, offset: 0 }, focus: { path: o.path, offset: 0 } }) }, o.text)))
        : [h("li.of-oside__empty", "Headings appear here. Use the style list (Heading 1, Heading 2 …) to structure the document.")]),
    );
    // styles
    const ids = Object.keys(m.styles).filter((id) => m.styles[id].type !== "character");
    const ordered = [...M.BUILTIN_STYLE_IDS.filter((id) => ids.includes(id)), ...ids.filter((id) => !M.BUILTIN_STYLE_IDS.includes(id)).sort()];
    this.stylesList.replaceChildren(
      ...ordered.map((id) => {
        const st = M.resolveStyle(m, id);
        const sample = h("span.of-oside__sample", { style: `font-weight:${st.run.b ? 700 : 400};font-style:${st.run.i ? "italic" : "normal"}` }, m.styles[id].name || id);
        const apply = h("button.of-oside__item", { type: "button", "data-tip": `Apply ${m.styles[id].name || id}`, onclick: () => (this.editor.setStyle(id), this.editor.focus()) }, sample, h("small", `${st.run.size || 11} pt`));
        const edit = iconButton({ icon: "pencil", label: `Modify ${m.styles[id].name || id}…`, onClick: () => import("./dialogs.js").then((d) => d.styleDialog(this.app, this, id)) });
        return h("li.of-oside__style", apply, edit);
      }),
    );
    // style select
    const cur = this.styleSel.value;
    this.styleSel.replaceChildren(...ordered.map((id) => h("option", { value: id }, m.styles[id].name || id)));
    this.styleSel.value = cur;
    this.#updateToolbar();
  }

  #scheduleToolbar() {
    if (this.tbTimer) return;
    this.tbTimer = requestAnimationFrame(() => {
      this.tbTimer = 0;
      this.#updateToolbar();
      this.app.emit("officestatus");
    });
  }

  #updateToolbar() {
    const ed = this.editor;
    const p = ed.currentPara();
    if (!p) return;
    const marks = ed.activeMarks();
    const set = (b, on) => {
      b.classList.toggle("active", !!on);
      b.setAttribute("aria-pressed", String(!!on));
    };
    set(this.b, marks.b);
    set(this.i, marks.i);
    set(this.u, marks.u);
    set(this.s, marks.s);
    set(this.sup, marks.va === "super");
    set(this.sub, marks.va === "sub");
    const pp = M.effectivePara(this.prj.model, p);
    for (const [k, b] of Object.entries(this.align)) set(b, (pp.align || "left") === k);
    set(this.bul, p.list?.kind === "bullet");
    set(this.num, p.list?.kind === "number");
    if (document.activeElement !== this.fontSel) this.fontSel.value = marks.font || "";
    if (document.activeElement !== this.sizeSel) this.sizeSel.value = marks.size ? String(marks.size) : "";
    this.styleSel.value = p.style || "Normal";
    const lh = pp.lineHeight || 1.15;
    this.spacing.value = SPACING.find(([v]) => Math.abs(Number(v) - lh) < 0.01)?.[0] || "";
    const web = this.prj.view.layout === "web";
    this.printBtn.setAttribute("aria-pressed", String(!web));
    this.webBtn.setAttribute("aria-pressed", String(web));
    const z = String(this.prj.view.zoom || 1);
    this.zoomSel.value = [...this.zoomSel.options].some((o) => o.value === z) ? z : "";
  }

  refreshToolbar() {
    this.#updateToolbar();
    this.app.emit("officestatus");
  }
}

// -------------------------------------------------------------------------------------------- find & replace

function createFindBar(ws) {
  const ed = ws.editor;
  const q = h("input.of-ofind__q", { type: "search", "aria-label": "Find", placeholder: "Find", spellcheck: "false" });
  const r = h("input.of-ofind__r", { type: "text", "aria-label": "Replace with", placeholder: "Replace with", spellcheck: "false" });
  const cs = h("input", { type: "checkbox", "aria-label": "Match case" });
  const ww = h("input", { type: "checkbox", "aria-label": "Whole words" });
  const rx = h("input", { type: "checkbox", "aria-label": "Regular expression" });
  const count = h("span.of-ofind__count", { role: "status", "aria-live": "polite" });
  let matches = [];
  let idx = -1;
  const opts = () => ({ caseSensitive: cs.checked, wholeWord: ww.checked, regex: rx.checked });
  const search = () => {
    matches = M.findMatches(ws.prj.model, q.value, opts());
    if (rx.checked && q.value) {
      try {
        new RegExp(q.value, "u");
      } catch {
        count.textContent = "Invalid expression";
        return;
      }
    }
    if (idx >= matches.length) idx = matches.length - 1;
    count.textContent = q.value ? (matches.length ? `${Math.max(0, idx) + 1} of ${matches.length}` : "No results") : "";
  };
  const go = (dir) => {
    search();
    if (!matches.length) return;
    const caret = ed.range[1];
    if (idx < 0) {
      idx = matches.findIndex((m) => M.comparePos({ path: m.path, offset: m.from }, caret) >= 0);
      if (idx < 0) idx = 0;
      if (dir < 0) idx = (idx - 1 + matches.length) % matches.length;
    } else idx = (idx + dir + matches.length) % matches.length;
    const m = matches[idx];
    ed.setSelection({ anchor: { path: m.path, offset: m.from }, focus: { path: m.path, offset: m.to } });
    count.textContent = `${idx + 1} of ${matches.length}`;
    q.focus();
  };
  const replaceOne = () => {
    search();
    const [a, b] = ed.range;
    const cur = matches.find((m) => M.samePath(m.path, a.path) && m.from === a.offset && M.samePath(m.path, b.path) && m.to === b.offset);
    if (!cur) return go(1);
    const next = M.replaceMatches(ws.prj.model, [cur], r.value, { query: q.value, ...opts() });
    ed.commit(next, { label: "Replace", sel: { path: cur.path, offset: cur.from } });
    idx = -1;
    go(1);
  };
  const replaceAll = () => {
    search();
    if (!matches.length) return;
    const n = matches.length;
    ed.commit(M.replaceMatches(ws.prj.model, matches, r.value, { query: q.value, ...opts() }), { label: "Replace All" });
    ws.app.toast(`Replaced ${n} occurrence${n === 1 ? "" : "s"}.`, "success", 1800);
    idx = -1;
    search();
  };
  q.addEventListener("input", () => {
    idx = -1;
    search();
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    }
    if (e.key === "Escape") close();
  });
  r.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      replaceOne();
    }
    if (e.key === "Escape") close();
  });
  for (const c of [cs, ww, rx]) c.addEventListener("change", () => ((idx = -1), search()));
  const opt = (input, label) => h("label.of-ofind__opt", input, label);
  const btn = (label, fn, icon) => iconButton({ icon, label, onClick: fn });
  const replaceRow = h("div.of-ofind__row.of-ofind__replace", r, h("button.of-btn.of-btn--default", { type: "button", onclick: replaceOne }, "Replace"), h("button.of-btn.of-btn--default", { type: "button", onclick: replaceAll }, "Replace all"));
  const el = h("div.of-ofind", { role: "search", "aria-label": "Find and replace", hidden: true },
    h("div.of-ofind__row", q, count, btn("Previous match (Shift+Enter)", () => go(-1), "chevron-up"), btn("Next match (Enter)", () => go(1), "chevron-down"), opt(cs, "Aa"), opt(ww, "Whole words"), opt(rx, ".*"), btn("Close (Esc)", () => close(), "x-lg")),
    replaceRow);
  function close() {
    el.hidden = true;
    ed.focus();
  }
  return {
    el,
    open(replace) {
      el.hidden = false;
      replaceRow.hidden = !replace;
      const s = ed.collapsed ? "" : ed.selectedText();
      if (s && !s.includes("\n") && s.length < 200) q.value = s;
      idx = -1;
      search();
      q.focus();
      q.select();
    },
    close,
  };
}
