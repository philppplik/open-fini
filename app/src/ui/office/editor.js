// The page editor of the Office Studio: a contenteditable surface rendered from the document model. The model is the
// single source of truth: every edit is intercepted (beforeinput, keyboard, clipboard, drag and drop, IME composition
// end), applied to the model as one undoable transaction of the document history, and the changed blocks re-render.
// Pages are an approximation: block heights are measured and blocks that do not fit are pushed to the next page.
import * as M from "../../engine/office/model.js";
import { addMedia, fitSize, sniffImage } from "../../engine/office/media.js";
import { commitOffice } from "../../core/office.js";
import { h } from "../../core/util.js";

const PX = 96 / 72; // CSS px per point
const GAP = 28; // px between pages in print layout
const atom = (n) => n.nodeType === 1 && (n.dataset.obj !== undefined || n.dataset.br !== undefined);
const cssId = (id) => String(id).replace(/[^\w-]/g, "_");
const pt = (v) => `${Math.round(v * 100) / 100}pt`;

export function fontStack(f) {
  const fam = String(f || "Calibri").replace(/["\\<>{};]/g, "");
  const generic = /mono|courier|consol/i.test(fam) ? "monospace" : /times|georgia|serif|cambria|garamond|palatino|baskerville/i.test(fam) && !/sans/i.test(fam) ? "serif" : "sans-serif";
  const alias = /^calibri$/i.test(fam) ? ', "Carlito"' : /^cambria$/i.test(fam) ? ', "Caladea"' : /^arial$/i.test(fam) ? ', "Liberation Sans", "Arimo"' : /^times new roman$/i.test(fam) ? ', "Liberation Serif", "Tinos"' : "";
  return `"${fam}"${alias}, ${generic}`;
}

export function runCss(m) {
  const a = [];
  if (m.font) a.push(`font-family:${fontStack(m.font)}`);
  if (m.size) a.push(`font-size:${pt(m.size)}`);
  if (m.b !== undefined) a.push(`font-weight:${m.b ? 700 : 400}`);
  if (m.i !== undefined) a.push(`font-style:${m.i ? "italic" : "normal"}`);
  const deco = [m.u ? "underline" : "", m.s ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) a.push(`text-decoration:${deco}`);
  if (m.color) a.push(`color:${m.color}`);
  if (m.highlight) a.push(`background-color:${m.highlight}`);
  if (m.va) a.push(`vertical-align:${m.va === "sub" ? "sub" : "super"};font-size:0.7em`);
  return a.join(";");
}

export function paraCss(p) {
  const a = [];
  if (!p) return "";
  if (p.align) a.push(`text-align:${p.align}`);
  if (p.spaceBefore !== undefined) a.push(`margin-top:${pt(p.spaceBefore)}`);
  if (p.spaceAfter !== undefined) a.push(`margin-bottom:${pt(p.spaceAfter)}`);
  if (p.indentLeft !== undefined) a.push(`margin-left:${pt(p.indentLeft)}`);
  if (p.indentRight !== undefined) a.push(`margin-right:${pt(p.indentRight)}`);
  if (p.indentFirst !== undefined) a.push(`text-indent:${pt(p.indentFirst)}`);
  if (p.lineHeight !== undefined) a.push(`line-height:${Math.round(p.lineHeight * 1.17 * 1000) / 1000}`);
  return a.join(";");
}

/** CSS of the named styles (class .of-st-<id>), with inheritance resolved. */
export function stylesCss(doc, scope) {
  let css = "";
  for (const id of Object.keys(doc.styles)) {
    const st = M.resolveStyle(doc, id);
    css += `${scope} .of-st-${cssId(id)}{${runCss(st.run)};${paraCss({ lineHeight: 1.15, spaceAfter: 0, ...st.para })}}\n`;
  }
  return css;
}

function segmenter() {
  try {
    return new Intl.Segmenter(undefined, { granularity: "grapheme" });
  } catch {
    return null;
  }
}
const graphemes = segmenter();
/** Length of the grapheme before / after `offset` in `text`. */
function clusterLen(text, offset, back) {
  if (graphemes) {
    let prev = 0;
    for (const s of graphemes.segment(text)) {
      const end = s.index + s.segment.length;
      if (back && end >= offset) return offset - s.index;
      if (!back && s.index >= offset) return s.segment.length;
      prev = end;
    }
    return back ? offset - prev : 1;
  }
  const c = back ? text.charCodeAt(offset - 1) : text.charCodeAt(offset + 1);
  return c >= 0xdc00 && c < 0xe000 ? 2 : 1;
}

export class OfficeEditor {
  constructor(app, doc) {
    this.app = app;
    this.doc = doc;
    this.prj = doc.office;
    this.cache = new WeakMap();
    this.mediaUrls = new Map();
    this.pending = null;
    this.composing = false;
    this.pages = 1;
    const start = M.firstPos(this.model);
    this.sel = { anchor: start, focus: start };
    this.listeners = new Set();

    this.styleEl = h("style");
    this.sheets = h("div.of-oed__sheets", { "aria-hidden": "true" });
    this.flow = h("div.of-oed__flow", { contenteditable: "true", role: "textbox", "aria-multiline": "true", "aria-label": "Document", spellcheck: app.prefs.officeSpellcheck === false ? "false" : "true", translate: "no" });
    this.notes = h("div.of-oed__notes", { contenteditable: "false" });
    this.pagesEl = h("div.of-oed__pages", this.sheets, this.flow, this.notes);
    this.zoomBox = h("div.of-oed__zoom", this.pagesEl);
    this.el = h("div.of-oed", { tabindex: "-1" }, this.styleEl, this.zoomBox);
    this.#wire();
    this.render();
  }

  get model() {
    return this.prj.model;
  }
  get view() {
    return this.prj.view;
  }

  dispose() {
    for (const u of this.mediaUrls.values()) URL.revokeObjectURL(u);
    this.mediaUrls.clear();
    document.removeEventListener("selectionchange", this.onSelChange);
    this.resizeObs?.disconnect();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  #notify(kind) {
    for (const fn of this.listeners) fn(kind);
  }

  // ------------------------------------------------------------------------------------------ model updates

  /** Applies a new model as one history step and puts the caret at `sel`. */
  commit(next, { label = "Edit", sel = null, coalesce = null } = {}) {
    const s = sel ? (sel.anchor ? sel : { anchor: sel, focus: sel }) : null;
    if (next === this.model) {
      if (s) this.setSelection(s);
      return;
    }
    this.pending = null;
    commitOffice(this.doc, label, next, { coalesce, sel: s, selBefore: this.sel });
  }

  /** Called by the workspace for every model change (edit, undo, redo, Vibe). */
  modelChanged(info = {}) {
    if (info.sel) this.sel = this.#clampSel(info.sel);
    else this.sel = this.#clampSel(this.sel);
    this.render();
    this.#restoreSelection(false); // only when the editor has focus (find bar, dialogs and Vibe keep theirs)
    this.#notify("model");
  }

  #clampSel(sel) {
    const fix = (p) => {
      let b = p && M.getBlock(this.model, p.path);
      if (!b || b.type !== "paragraph") {
        // nearest paragraph at or before the path
        const all = [...M.paragraphs(this.model)];
        const cand = all.filter((x) => M.comparePos({ path: x.path, offset: 0 }, { path: p?.path || [0], offset: 0 }) <= 0).pop() || all[0];
        return { path: cand.path, offset: 0 };
      }
      return { path: p.path, offset: Math.max(0, Math.min(M.paraLength(b), p.offset)) };
    };
    return { anchor: fix(sel.anchor), focus: fix(sel.focus) };
  }

  get range() {
    const a = this.sel.anchor;
    const f = this.sel.focus;
    return M.comparePos(a, f) <= 0 ? [a, f] : [f, a];
  }
  get collapsed() {
    return M.comparePos(this.sel.anchor, this.sel.focus) === 0;
  }
  currentPara() {
    return M.getBlock(this.model, this.sel.focus.path);
  }

  // ------------------------------------------------------------------------------------------ rendering

  render() {
    const m = this.model;
    if (this.stylesFor !== m.styles) {
      this.stylesFor = m.styles;
      this.styleEl.textContent = stylesCss(m, ".of-oed__pages");
      this.cache = new WeakMap(); // style changes can turn paragraphs into headings
    }
    const els = [];
    const counters = new Map();
    m.blocks.forEach((b, i) => {
      let el = this.cache.get(b);
      if (!el) {
        el = this.#renderBlock(b);
        this.cache.set(b, el);
      }
      el.dataset.bi = String(i);
      if (b.type === "paragraph") this.#label(el, b, counters);
      els.push(el);
    });
    const cur = [...this.flow.children].filter((c) => !c.classList.contains("of-oed__gap"));
    if (cur.length !== els.length || cur.some((c, k) => c !== els[k])) this.flow.replaceChildren(...els);
    // footnote numbers in reading order
    let n = 0;
    const order = [];
    for (const fn of this.flow.querySelectorAll("[data-fn]")) {
      fn.textContent = String(++n);
      order.push(fn.dataset.fn);
    }
    this.#renderNotes(order);
    this.#applyLayout();
  }

  #label(el, p, counters) {
    if (!p.list) {
      delete el.dataset.label;
      return;
    }
    const key = p.list.id || p.list.kind;
    const arr = counters.get(key) || [];
    const L = p.list.level || 0;
    arr.length = L + 1;
    arr[L] = (arr[L] || 0) + 1;
    counters.set(key, arr);
    el.dataset.label = M.listLabel(p.list.kind, L, arr[L]);
  }

  #renderBlock(b) {
    if (b.type === "paragraph") return this.#renderPara(b);
    if (b.type === "pageBreak") return h("div.of-oed__pb", { contenteditable: "false", role: "separator", "aria-label": "Page break" }, h("span", "Page break"));
    if (b.type === "rule") return h("div.of-oed__hr", { contenteditable: "false", role: "separator" }, h("hr"));
    if (b.type === "table") return this.#renderTable(b);
    return h("div");
  }

  #renderPara(p) {
    const lvl = M.headingLevel(this.model, p);
    const el = document.createElement(lvl ? `h${Math.min(6, lvl)}` : "p");
    el.dataset.p = "";
    el.className = `of-st-${cssId(p.style || "Normal")}${p.list ? ` is-list is-${p.list.kind}` : ""}`;
    let css = paraCss(p.props);
    if (p.list) css += `;margin-left:${pt(36 * ((p.list.level || 0) + 1))};text-indent:0`;
    if (css) el.style.cssText = css;
    for (const r of p.runs) el.append(this.#renderRun(r));
    if (!p.runs.length || p.runs[p.runs.length - 1].type === "break") el.append(h("br", { "data-ph": "" }));
    return el;
  }

  #renderRun(r) {
    if (M.isText(r)) {
      const s = document.createElement(r.link ? "a" : "span");
      s.dataset.r = "";
      if (r.link) {
        s.href = r.link;
        s.className = "of-oed__link";
        s.title = `${r.link} (Ctrl+click to open)`;
      }
      const css = runCss(r);
      if (css) s.style.cssText = css;
      s.textContent = r.text;
      return s;
    }
    if (r.type === "break") return h("br", { "data-br": "" });
    if (r.type === "image") {
      const media = this.model.media[r.media];
      return h("img.of-oed__img", { "data-obj": "", "data-media": r.media, contenteditable: "false", draggable: "false", alt: r.alt || "", src: this.#mediaUrl(r.media, media), style: `width:${pt(r.width)};height:${pt(r.height)}` });
    }
    if (r.type === "footnote") return h("sup.of-oed__fn", { "data-obj": "", "data-fn": r.id, contenteditable: "false", title: "Footnote (double-click to edit)" }, "#");
    if (r.type === "field") return h("span.of-oed__field", { "data-obj": "", contenteditable: "false", title: r.field === "page" ? "Page number" : r.field === "pages" ? "Number of pages" : "Date" }, r.field === "date" ? new Date().toLocaleDateString("en-US") : "#");
    return h("span");
  }

  #mediaUrl(id, media) {
    if (!media?.bytes) return "";
    let u = this.mediaUrls.get(id);
    if (!u || this.mediaUrls.get(`${id}:bytes`) !== media.bytes) {
      if (u) URL.revokeObjectURL(u);
      u = URL.createObjectURL(new Blob([media.bytes], { type: media.mime }));
      this.mediaUrls.set(id, u);
      this.mediaUrls.set(`${id}:bytes`, media.bytes);
    }
    return u;
  }

  #renderTable(t) {
    const grid = M.tableGrid(t);
    const border = t.borders.style === "none" ? "" : `${pt(t.borders.width)} solid ${t.borders.color}`;
    const table = h("table.of-oed__table", { "data-borders": t.borders.style });
    table.append(h("colgroup", t.cols.map((w) => h("col", { style: `width:${pt(w)}` }))));
    const body = h("tbody");
    t.rows.forEach((row, r) => {
      const tr = h("tr", row.header ? { class: "is-header" } : {});
      for (let c = 0; c < t.cols.length; c++) {
        const g = grid[r][c];
        if (!g || !g.origin) continue;
        const cell = row.cells[g.ci];
        const td = h(row.header ? "th" : "td", { "data-r": String(r), "data-c": String(g.ci) });
        if (g.colspan > 1) td.colSpan = g.colspan;
        if (g.rowspan > 1) td.rowSpan = g.rowspan;
        td.style.cssText = `${border ? `border:${border};` : ""}${cell.shading ? `background:${cell.shading};` : ""}${cell.vAlign ? `vertical-align:${cell.vAlign};` : ""}`;
        const counters = new Map();
        for (const p of cell.blocks) {
          const pe = this.#renderPara(p);
          this.#label(pe, p, counters);
          td.append(pe);
        }
        tr.append(td);
      }
      body.append(tr);
    });
    table.append(body);
    table.style.width = pt(t.cols.reduce((a, c) => a + c, 0));
    const wrap = h("div.of-oed__tablewrap", table);
    return wrap;
  }

  #renderNotes(order) {
    const fns = this.model.footnotes;
    if (!order.length) {
      this.notes.replaceChildren();
      this.notes.hidden = true;
      return;
    }
    this.notes.hidden = false;
    const list = h("ol");
    order.forEach((id) => {
      const text = (fns[id] || []).map((p) => M.paraText(p).replace(/\uFFFC/g, "")).join(" ");
      const li = h("li", h("button.of-oed__noteedit", { type: "button", title: "Edit footnote", onclick: () => this.editFootnote(id) }, text || "(empty footnote)"));
      list.append(li);
    });
    this.notes.replaceChildren(h("h2.of-oed__notes-title", "Footnotes"), list);
  }

  // ------------------------------------------------------------------------------------------ pages

  #applyLayout() {
    const pg = this.model.page;
    const W = pg.width * PX;
    const Hh = pg.height * PX;
    const m = pg.margins;
    const print = this.view.layout !== "web";
    const z = this.view.zoom || 1;
    this.el.classList.toggle("is-web", !print);
    this.el.classList.toggle("is-darkpage", !!this.app.prefs.officeDarkPage);
    for (const g of this.flow.querySelectorAll(":scope > .of-oed__gap")) g.remove();
    if (!print) {
      this.sheets.replaceChildren();
      this.pagesEl.style.cssText = `width:${Math.round((pg.width - m.left - m.right) * PX + 64)}px;transform:scale(${z})`;
      this.flow.style.cssText = `width:auto;margin:0;padding:32px`;
      this.notes.style.cssText = "margin:0 32px 32px";
      requestAnimationFrame(() => {
        this.zoomBox.style.cssText = `width:${this.pagesEl.offsetWidth * z}px;height:${this.pagesEl.offsetHeight * z}px`;
      });
      this.pages = 1;
      this.#notify("layout");
      return;
    }
    const cw = (pg.width - m.left - m.right) * PX;
    const ch = Math.max(40, (pg.height - m.top - m.bottom) * PX);
    const P = Hh + GAP;
    this.flow.style.cssText = `width:${cw}px;margin:0 0 0 ${m.left * PX}px;padding:0;position:relative;top:${m.top * PX}px`;
    this.notes.style.cssText = `width:${cw}px;margin-left:${m.left * PX}px;position:relative;top:${m.top * PX}px`;
    // measure blocks without spacers, then push blocks that do not fit to the next page
    const kids = [...this.flow.children];
    const tops = kids.map((k) => k.offsetTop);
    const bottoms = kids.map((k) => k.offsetTop + k.offsetHeight);
    let shift = 0;
    let forceNext = false;
    kids.forEach((k, i) => {
      const T = tops[i] + shift;
      const B = bottoms[i] + shift;
      const page = Math.max(0, Math.floor(T / P));
      const start = page * P;
      const block = this.model.blocks[i];
      let s = 0;
      const brk = forceNext || (block?.type === "paragraph" && block.props?.pageBreakBefore && i > 0);
      if (brk) s = (page + 1) * P - T;
      else if (T > start + ch) s = (page + 1) * P - T; // starts in the gap between pages
      else if (B > start + ch && T > start + 2 && B - T <= ch) s = (page + 1) * P - T; // does not fit: next page
      forceNext = block?.type === "pageBreak";
      if (s > 0) {
        k.before(h("div.of-oed__gap", { contenteditable: "false", "aria-hidden": "true", style: `height:${s}px` }));
        shift += s;
      }
    });
    const end = (bottoms.length ? bottoms[bottoms.length - 1] : 0) + shift + (this.notes.hidden ? 0 : this.notes.offsetHeight + 24);
    const pages = Math.max(1, Math.floor(Math.max(0, end - 1) / P) + 1);
    this.pages = pages;
    // page sheets with header and footer
    const sheets = [];
    for (let i = 0; i < pages; i++) {
      const sheet = h("div.of-oed__sheet", { style: `top:${i * P}px;width:${W}px;height:${Hh}px` });
      if (this.model.header.length) sheet.append(this.#hf("header", i + 1, pages));
      if (this.model.footer.length) sheet.append(this.#hf("footer", i + 1, pages));
      sheets.push(sheet);
    }
    this.sheets.replaceChildren(...sheets);
    const totalH = pages * P - GAP;
    this.pagesEl.style.cssText = `width:${W}px;height:${totalH}px;transform:scale(${z})`;
    this.zoomBox.style.cssText = `width:${W * z}px;height:${totalH * z}px`;
    this.#notify("layout");
  }

  #hf(kind, page, pages) {
    const pg = this.model.page;
    const m = pg.margins;
    const el = h(`div.of-oed__hf.of-oed__${kind}`, { title: `Double-click to edit the ${kind}`, style: `left:${m.left * PX}px;right:${m.right * PX}px;${kind === "header" ? `top:${m.header * PX}px` : `bottom:${m.footer * PX}px`}` });
    for (const p of this.model[kind]) {
      const pe = this.#renderPara(p);
      for (const f of pe.querySelectorAll(".of-oed__field")) f.textContent = f.title === "Page number" ? String(page) : f.title === "Number of pages" ? String(pages) : f.textContent;
      el.append(pe);
    }
    el.addEventListener("dblclick", () => this.app.run("office.headerFooter"));
    return el;
  }

  setZoom(z) {
    this.view.zoom = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
    this.#applyLayout();
  }
  zoomToWidth() {
    const avail = this.el.clientWidth - 48;
    const w = this.view.layout === "web" ? this.pagesEl.offsetWidth : this.model.page.width * PX;
    if (avail > 100 && w > 0) this.setZoom(avail / w);
  }
  setLayout(mode) {
    this.view.layout = mode === "web" ? "web" : "print";
    this.#applyLayout();
  }
  relayout() {
    this.flow.spellcheck = this.app.prefs.officeSpellcheck !== false;
    this.#applyLayout();
  }

  // ------------------------------------------------------------------------------------------ DOM <-> model positions

  paraEl(path) {
    const top = this.flow.querySelector(`:scope > [data-bi="${path[0]}"]`);
    if (!top || path.length === 1) return top;
    const td = top.querySelector(`[data-r="${path[1]}"][data-c="${path[2]}"]`);
    return td ? [...td.children].filter((x) => x.dataset.p !== undefined)[path[3]] || null : null;
  }

  pathOf(pEl) {
    if (pEl.parentElement === this.flow) return [Number(pEl.dataset.bi)];
    const td = pEl.closest("[data-r]");
    const top = td?.closest("[data-bi]");
    if (!td || !top) return null;
    return [Number(top.dataset.bi), Number(td.dataset.r), Number(td.dataset.c), [...td.children].filter((x) => x.dataset.p !== undefined).indexOf(pEl)];
  }

  /** Model position of a DOM point, or null outside the document. */
  domToPos(node, off) {
    if (!node || !this.flow.contains(node)) return null;
    const base = node.nodeType === 3 ? node.parentNode : node;
    let pEl = base.closest?.("[data-p]");
    if (pEl && !this.flow.contains(pEl)) pEl = null;
    if (!pEl) {
      // a point between blocks or inside a table / separator: use the closest paragraph
      const child = node.childNodes?.[off] || node.childNodes?.[off - 1] || base;
      const el = child.nodeType === 1 ? child : child.parentNode;
      pEl = el.closest?.("[data-p]") || el.querySelector?.("[data-p]");
      if (!pEl) {
        let n = el.closest?.(".of-oed__flow > *") || el;
        while (n && !(n.dataset?.p !== undefined || n.querySelector?.("[data-p]"))) n = n.nextElementSibling;
        pEl = n ? (n.dataset.p !== undefined ? n : n.querySelector("[data-p]")) : this.flow.querySelector("[data-p]");
      }
      const path = pEl && this.pathOf(pEl);
      return path ? { path, offset: 0 } : null;
    }
    const path = this.pathOf(pEl);
    if (!path) return null;
    return { path, offset: this.#offsetIn(pEl, node, off) };
  }

  #offsetIn(pEl, node, off) {
    const lenOf = (n) => {
      if (n.nodeType === 3) return n.data.length;
      if (n.nodeType !== 1) return 0;
      if (atom(n)) return 1;
      if (n.dataset.ph !== undefined) return 0;
      let s = 0;
      for (const c of n.childNodes) s += lenOf(c);
      return s;
    };
    const inAtom = (node.nodeType === 1 ? node : node.parentNode)?.closest?.("[data-obj]");
    if (inAtom && pEl.contains(inAtom) && inAtom !== node) {
      node = inAtom.parentNode;
      off = [...node.childNodes].indexOf(inAtom) + 1;
    }
    let count = 0;
    if (node === pEl) {
      for (let i = 0; i < off && i < pEl.childNodes.length; i++) count += lenOf(pEl.childNodes[i]);
      return count;
    }
    const walk = (n) => {
      if (n === node) {
        if (n.nodeType === 3) count += Math.min(off, n.data.length);
        else for (let i = 0; i < off && i < n.childNodes.length; i++) count += lenOf(n.childNodes[i]);
        return true;
      }
      if (n.nodeType === 3) {
        count += n.data.length;
        return false;
      }
      if (n.nodeType !== 1) return false;
      if (atom(n)) {
        count += 1;
        return false;
      }
      for (const c of n.childNodes) if (walk(c)) return true;
      return false;
    };
    for (const c of pEl.childNodes) if (walk(c)) return count;
    return count;
  }

  /** DOM point for a model position. */
  posToDom(pos) {
    const pEl = this.paraEl(pos.path);
    if (!pEl) return null;
    let left = pos.offset;
    const find = (n) => {
      const kids = n.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.nodeType === 3) {
          if (left <= c.data.length) return [c, left];
          left -= c.data.length;
        } else if (c.nodeType === 1) {
          if (atom(c)) {
            if (left === 0) return [n, i];
            left -= 1;
            if (left === 0 && !(kids[i + 1]?.nodeType === 3)) return [n, i + 1];
          } else if (c.dataset.ph === undefined) {
            const r = find(c);
            if (r) return r;
          }
        }
      }
      return null;
    };
    return find(pEl) || [pEl, 0];
  }

  setSelection(sel, { scroll = true } = {}) {
    this.sel = this.#clampSel(sel);
    this.#restoreSelection(true, scroll);
    this.#notify("selection");
  }

  #restoreSelection(force = true, scroll = true) {
    const s = document.getSelection();
    if (!s) return;
    const focused = this.flow.contains(document.activeElement) || document.activeElement === this.flow;
    if (!focused && !force) return;
    const a = this.posToDom(this.sel.anchor);
    const f = this.posToDom(this.sel.focus);
    if (!a || !f) return;
    this.ignoreSel = true;
    try {
      if (!focused) this.flow.focus({ preventScroll: true });
      s.setBaseAndExtent(a[0], a[1], f[0], f[1]);
    } catch {
      /* the node went away */
    }
    this.ignoreSel = false;
    if (scroll) {
      const el = (f[0].nodeType === 3 ? f[0].parentElement : f[0])?.closest?.("[data-p]");
      el?.scrollIntoView?.({ block: "nearest" });
    }
    for (const img of this.flow.querySelectorAll(".of-oed__img.is-selected")) img.classList.remove("is-selected");
    const [from, to] = this.range;
    if (M.samePath(from.path, to.path) && to.offset - from.offset === 1) {
      const r = M.sliceRuns(this.currentPara()?.runs || [], from.offset, to.offset)[0];
      if (r?.type === "image") {
        const imgs = [...(this.paraEl(from.path)?.querySelectorAll("img") || [])];
        const before = M.sliceRuns(this.currentPara().runs, 0, from.offset).filter((x) => x.type === "image").length;
        imgs[before]?.classList.add("is-selected");
      }
    }
  }

  #syncFromDom() {
    if (this.ignoreSel) return;
    const s = document.getSelection();
    if (!s || !s.anchorNode || !this.flow.contains(s.anchorNode)) return;
    const a = this.domToPos(s.anchorNode, s.anchorOffset);
    const f = this.domToPos(s.focusNode, s.focusOffset);
    if (!a || !f) return;
    const moved = M.comparePos(a, this.sel.anchor) || M.comparePos(f, this.sel.focus);
    this.sel = { anchor: a, focus: f };
    if (moved && this.pending && !(this.pending.at && M.comparePos(this.pending.at, f) === 0)) this.pending = null;
    this.#notify("selection");
  }

  // ------------------------------------------------------------------------------------------ input

  #wire() {
    this.onSelChange = () => this.#syncFromDom();
    document.addEventListener("selectionchange", this.onSelChange);
    const f = this.flow;
    f.addEventListener("beforeinput", (e) => this.#beforeInput(e));
    f.addEventListener("keydown", (e) => this.#keydown(e));
    f.addEventListener("compositionstart", () => {
      this.composing = true;
      this.#syncFromDom();
      if (!this.collapsed) {
        // replace the selection first so the composition starts in a clean place
        const [a, b] = this.range;
        const r = M.deleteRange(this.model, a, b);
        this.commit(r.doc, { label: "Typing", sel: r.pos, coalesce: "office-typing" });
      }
      this.composePath = this.sel.focus.path;
    });
    f.addEventListener("compositionend", () => {
      this.composing = false;
      this.#syncComposed();
    });
    f.addEventListener("copy", (e) => this.#copy(e, false));
    f.addEventListener("cut", (e) => this.#copy(e, true));
    f.addEventListener("paste", (e) => this.#paste(e));
    f.addEventListener("dragstart", (e) => e.preventDefault());
    f.addEventListener("dragover", (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].some((t) => t === "Files" || t === "text/plain" || t === "text/html")) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }
    });
    f.addEventListener("drop", (e) => this.#drop(e));
    f.addEventListener("click", (e) => {
      const a = e.target.closest?.("a.of-oed__link");
      if (a && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        import("../links.js").then((m) => m.openLink(a.getAttribute("href"), { app: this.app }));
      } else if (a) e.preventDefault();
    });
    f.addEventListener("mousedown", (e) => {
      const img = e.target.closest?.(".of-oed__img");
      if (img) {
        e.preventDefault();
        this.#selectAtom(img);
      }
    });
    f.addEventListener("dblclick", (e) => {
      const fn = e.target.closest?.("[data-fn]");
      if (fn) return this.editFootnote(fn.dataset.fn);
      if (e.target.closest?.(".of-oed__img")) this.app.run("office.imageProperties");
    });
    f.addEventListener("contextmenu", (e) => {
      if (e.shiftKey) return; // Shift + right-click: the browser's own menu (spelling suggestions)
      e.preventDefault();
      e.stopPropagation();
      const img = e.target.closest?.(".of-oed__img");
      if (img) this.#selectAtom(img);
      else {
        // move the caret to the click unless it lands inside the current selection
        const pos = this.#posFromPoint(e.clientX, e.clientY);
        const [a, b] = this.range;
        if (pos && (this.collapsed || M.comparePos(pos, a) < 0 || M.comparePos(pos, b) > 0)) this.setSelection({ anchor: pos, focus: pos }, { scroll: false });
      }
      this.#notify("contextmenu");
      import("./context-menu.js").then((m) => m.showOfficeContextMenu(this.app, this, e.clientX, e.clientY, e));
    });
    f.addEventListener("focus", () => this.#notify("focus"));
    this.resizeObs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.view.layout === "web" && this.#applyLayout()) : null;
    window.addEventListener("openfini:fonts", () => this.el.isConnected && this.#applyLayout());
  }

  #selectAtom(el) {
    const pEl = el.closest("[data-p]");
    const path = pEl && this.pathOf(pEl);
    if (!path) return;
    const parent = el.parentNode;
    const idx = [...parent.childNodes].indexOf(el);
    const offset = this.#offsetIn(pEl, parent, idx);
    this.setSelection({ anchor: { path, offset }, focus: { path, offset: offset + 1 } }, { scroll: false });
  }

  #syncComposed() {
    // read back what the input method wrote into the paragraph and apply it to the model
    const path = this.composePath || this.sel.focus.path;
    const pEl = this.paraEl(path);
    const p = M.getBlock(this.model, path);
    if (!pEl || !p || p.type !== "paragraph") return this.render();
    const domText = this.#domText(pEl);
    const modelText = M.paraText(p);
    if (domText === modelText) return;
    let a = 0;
    while (a < domText.length && a < modelText.length && domText[a] === modelText[a]) a++;
    let b = 0;
    while (b < domText.length - a && b < modelText.length - a && domText[domText.length - 1 - b] === modelText[modelText.length - 1 - b]) b++;
    const inserted = domText.slice(a, domText.length - b).replace(/[\n\uFFFC]/g, "");
    let m = this.model;
    const from = { path, offset: a };
    m = M.deleteRange(m, from, { path, offset: modelText.length - b }).doc;
    const marks = this.pending?.marks || M.marksAt(M.getBlock(m, path).runs, a);
    const r = M.insertText(m, from, inserted, marks);
    this.cache.delete(p); // the DOM of the old paragraph was changed by the IME
    this.commit(r.doc, { label: "Typing", sel: r.pos, coalesce: "office-typing" });
  }

  #domText(pEl) {
    let s = "";
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) s += c.data;
        else if (c.nodeType === 1) {
          if (c.dataset.br !== undefined) s += "\n";
          else if (c.dataset.obj !== undefined) s += "\uFFFC";
          else if (c.dataset.ph === undefined) walk(c);
        }
      }
    };
    walk(pEl);
    return s;
  }

  #beforeInput(e) {
    if (this.composing || e.isComposing || e.inputType === "insertCompositionText") return; // applied at compositionend
    this.#syncFromDom();
    const t = e.inputType;
    e.preventDefault();
    switch (t) {
      case "insertText":
        return this.insertText(e.data ?? "");
      case "insertReplacementText": {
        const text = e.dataTransfer?.getData("text/plain") ?? e.data ?? "";
        const r = e.getTargetRanges?.()[0];
        if (r) {
          const a = this.domToPos(r.startContainer, r.startOffset);
          const b = this.domToPos(r.endContainer, r.endOffset);
          if (a && b) this.sel = { anchor: a, focus: b };
        }
        return this.insertText(text, "Replace Word");
      }
      case "insertParagraph":
        return this.splitParagraph();
      case "insertLineBreak":
        return this.insertInline([{ type: "break" }], "Line Break");
      case "deleteContentBackward":
      case "deleteContentForward":
      case "deleteWordBackward":
      case "deleteWordForward":
      case "deleteSoftLineBackward":
      case "deleteSoftLineForward":
      case "deleteHardLineBackward":
      case "deleteHardLineForward":
      case "deleteContent":
      case "deleteByCut":
        return this.deleteBy(t);
      case "historyUndo":
        return this.app.run("edit.undo");
      case "historyRedo":
        return this.app.run("edit.redo");
      case "formatBold":
        return this.toggleMark("b");
      case "formatItalic":
        return this.toggleMark("i");
      case "formatUnderline":
        return this.toggleMark("u");
      case "formatStrikeThrough":
        return this.toggleMark("s");
      case "formatSuperscript":
        return this.toggleMark("va", "super");
      case "formatSubscript":
        return this.toggleMark("va", "sub");
      case "insertFromPaste":
      case "insertFromDrop":
        return; // handled by the paste / drop events
      default:
        return; // anything else would bypass the model
    }
  }

  #keydown(e) {
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
    if (e.isComposing || this.composing) return;
    if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      this.#syncFromDom();
      const path = this.sel.focus.path;
      if (path.length === 4) return this.moveCell(e.shiftKey ? -1 : 1);
      if (this.currentPara()?.list) return this.indent(e.shiftKey ? -1 : 1);
      if (e.shiftKey) return;
      return this.insertText("\t");
    }
    if (e.key === "Escape") {
      this.#notify("escape");
      return;
    }
    if (mod && !e.altKey && e.key === "Enter") {
      e.preventDefault();
      return this.insertPageBreak();
    }
    if ((mod || e.altKey) && !["Control", "Meta", "Alt", "Shift"].includes(e.key)) {
      // app shortcuts (save, open, studio switching, office.* formatting commands); copy/cut/paste/select all stay native
      if (mod && !e.altKey && !e.shiftKey && ["c", "x", "v", "a"].includes(e.key.toLowerCase())) return;
      this.#syncFromDom();
      this.app.handleShortcut?.(e);
    }
  }

  // ------------------------------------------------------------------------------------------ editing operations

  insertText(text, label = "Typing") {
    if (!text) return;
    let m = this.model;
    let pos = this.sel.focus;
    if (!this.collapsed) {
      const [a, b] = this.range;
      ({ doc: m, pos } = M.deleteRange(m, a, b));
    }
    const p = M.getBlock(m, pos.path);
    if (!p || p.type !== "paragraph") return;
    const marks = this.pending && (!this.pending.at || M.comparePos(this.pending.at, pos) === 0) ? this.pending.marks : M.marksAt(p.runs, pos.offset);
    const r = M.insertText(m, pos, text, marks);
    this.commit(r.doc, { label, sel: r.pos, coalesce: label === "Typing" ? "office-typing" : null });
  }

  insertInline(items, label = "Insert") {
    let m = this.model;
    let pos = this.sel.focus;
    if (!this.collapsed) {
      const [a, b] = this.range;
      ({ doc: m, pos } = M.deleteRange(m, a, b));
    }
    const r = M.insertInline(m, pos, items);
    this.commit(r.doc, { label, sel: r.pos });
  }

  splitParagraph() {
    let m = this.model;
    let pos = this.sel.focus;
    if (!this.collapsed) {
      const [a, b] = this.range;
      ({ doc: m, pos } = M.deleteRange(m, a, b));
    }
    const r = M.splitParagraph(m, pos);
    this.commit(r.doc, { label: "New Paragraph", sel: r.pos });
  }

  deleteBy(type) {
    const m = this.model;
    if (!this.collapsed) {
      const [a, b] = this.range;
      const r = M.deleteRange(m, a, b);
      return this.commit(r.doc, { label: "Delete", sel: r.pos });
    }
    const pos = this.sel.focus;
    const p = M.getBlock(m, pos.path);
    if (!p || p.type !== "paragraph") return;
    const text = M.paraText(p);
    const back = /Backward/.test(type);
    if (back && pos.offset === 0) {
      const r = M.joinBackward(m, pos.path);
      return this.commit(r.doc, { label: "Delete", sel: r.pos });
    }
    if (!back && pos.offset >= text.length) {
      const r = M.joinForward(m, pos.path);
      return this.commit(r.doc, { label: "Delete", sel: r.pos });
    }
    let len;
    if (/Word/.test(type)) {
      if (back) len = pos.offset - (/(\S+\s*|\s+)$/u.exec(text.slice(0, pos.offset))?.index ?? 0);
      else len = /^(\s*\S+|\s+)/u.exec(text.slice(pos.offset))?.[0].length || 1;
    } else if (/Line/.test(type)) len = back ? pos.offset : text.length - pos.offset;
    else len = clusterLen(text, pos.offset, back);
    const a = back ? { path: pos.path, offset: pos.offset - len } : pos;
    const b = back ? pos : { path: pos.path, offset: pos.offset + len };
    const r = M.deleteRange(m, a, b);
    this.commit(r.doc, { label: "Delete", sel: r.pos, coalesce: /Word|Line/.test(type) ? null : "office-delete" });
  }

  /** Marks of the selection start (for toolbar state). */
  activeMarks() {
    const [a] = this.range;
    const p = M.getBlock(this.model, a.path);
    if (!p || p.type !== "paragraph") return {};
    const own = this.pending?.marks || (this.collapsed ? M.marksAt(p.runs, a.offset) : M.marksOf(M.sliceRuns(p.runs, a.offset, a.offset + 1).find(M.isText) || {}));
    return { ...M.effectiveRun(this.model, p, {}), ...own, _own: own };
  }

  toggleMark(key, value = true) {
    const [a, b] = this.range;
    if (this.collapsed) {
      const cur = this.pending?.marks || M.marksAt(this.currentPara()?.runs || [], a.offset);
      const next = { ...cur };
      if (next[key] === value) delete next[key];
      else next[key] = value;
      this.pending = { marks: next, at: a };
      this.#notify("selection");
      return;
    }
    let all = true;
    for (const path of M.pathsBetween(this.model, a.path, b.path)) {
      const p = M.getBlock(this.model, path);
      if (p?.type !== "paragraph") continue;
      const s = M.samePath(path, a.path) ? a.offset : 0;
      const e = M.samePath(path, b.path) ? b.offset : Infinity;
      if (!M.rangeHasMark(p.runs, s, e, key, value === true ? undefined : value) && M.paraLength(p) && s < Math.min(e, M.paraLength(p))) all = false;
    }
    this.commit(M.formatRange(this.model, a, b, { [key]: all ? null : value }), { label: "Format", sel: this.sel });
  }

  /** Sets marks (null removes) on the selection, or on the next typed text at a caret. */
  setMarks(marks, label = "Format") {
    const [a, b] = this.range;
    if (this.collapsed) {
      const cur = this.pending?.marks || M.marksAt(this.currentPara()?.runs || [], a.offset);
      const next = { ...cur };
      for (const [k, v] of Object.entries(marks)) if (v === null || v === undefined || v === false) delete next[k];
      else next[k] = v;
      this.pending = { marks: next, at: a };
      this.#notify("selection");
      return;
    }
    this.commit(M.formatRange(this.model, a, b, marks), { label, sel: this.sel });
  }

  setParagraph(props, label = "Paragraph") {
    const [a, b] = this.range;
    this.commit(M.setParagraphProps(this.model, a, b, props), { label, sel: this.sel });
  }
  setStyle(style) {
    const [a, b] = this.range;
    this.commit(M.setParagraphStyle(this.model, a, b, style), { label: "Apply Style", sel: this.sel });
  }
  toggleList(kind) {
    const [a, b] = this.range;
    this.commit(M.toggleList(this.model, a, b, kind), { label: kind === "bullet" ? "Bullets" : "Numbering", sel: this.sel });
  }
  indent(delta) {
    const [a, b] = this.range;
    this.commit(M.indentParagraphs(this.model, a, b, delta), { label: delta > 0 ? "Indent" : "Outdent", sel: this.sel });
  }
  clearFormatting() {
    const [a, b] = this.range;
    this.pending = null;
    if (this.collapsed) {
      const p = this.currentPara();
      return this.commit(M.clearFormatting(this.model, { path: a.path, offset: 0 }, { path: a.path, offset: M.paraLength(p) }), { label: "Clear Formatting", sel: this.sel });
    }
    this.commit(M.clearFormatting(this.model, a, b), { label: "Clear Formatting", sel: this.sel });
  }

  /** Inserts top-level blocks (tables, page breaks, rules) at the caret. */
  insertBlocks(blocks, label) {
    const pos = this.sel.focus;
    if (pos.path.length > 1 && blocks.some((b) => b.type !== "paragraph")) {
      this.app.toast("Tables, page breaks and lines cannot be placed inside a table cell. The caret moved after the table.", "warning", 3500);
      return this.commit(M.insertBlocksAt(this.model, { path: [pos.path[0]], offset: Infinity }, blocks).doc, { label });
    }
    const r = M.insertBlocksAt(this.model, pos, blocks);
    this.commit(r.doc, { label, sel: r.pos });
  }
  insertPageBreak() {
    this.insertBlocks([{ type: "pageBreak" }], "Page Break");
  }
  insertRule() {
    this.insertBlocks([{ type: "rule" }], "Horizontal Line");
  }
  insertTable(rows, cols) {
    const pg = this.model.page;
    const t = M.createTable(rows, cols, pg.width - pg.margins.left - pg.margins.right, { header: false });
    const pos = this.sel.focus;
    if (pos.path.length > 1) return this.app.toast("A table cannot be placed inside another table.", "warning");
    const r = M.insertBlocksAt(this.model, pos, [t]);
    // caret into the first cell
    const ti = r.doc.blocks.indexOf(t);
    this.commit(r.doc, { label: "Insert Table", sel: { path: [ti, 0, 0, 0], offset: 0 } });
  }

  /** Inserts image bytes at the caret (scaled to the column width). */
  insertImage(bytes, name = "image", alt = "") {
    const mime = sniffImage(bytes, name);
    if (!mime) return this.app.toast("That file is not a PNG, JPEG, GIF, WebP or SVG image.", "warning");
    if (bytes.length > 40 * 1024 * 1024) return this.app.toast("That image is larger than 40 MB.", "warning");
    const m = { ...this.model, media: { ...this.model.media } };
    const id = addMedia(m, { bytes, mime, name });
    const pg = m.page;
    const { width, height } = fitSize(m.media[id], pg.width - pg.margins.left - pg.margins.right);
    let pos = this.sel.focus;
    let doc = m;
    if (!this.collapsed) {
      const [a, b] = this.range;
      ({ doc, pos } = M.deleteRange(doc, a, b));
    }
    const r = M.insertInline(doc, pos, [{ type: "image", media: id, width, height, ...(alt ? { alt } : {}) }]);
    this.commit(r.doc, { label: "Insert Image", sel: r.pos });
  }

  insertFootnote(text) {
    const id = M.uid("fn");
    const m = { ...this.model, footnotes: { ...this.model.footnotes, [id]: [M.para(text || "")] } };
    const pos = this.collapsed ? this.sel.focus : this.range[1];
    const r = M.insertInline(m, pos, [{ type: "footnote", id }]);
    this.commit(r.doc, { label: "Insert Footnote", sel: r.pos });
  }

  async editFootnote(id) {
    const { promptDialog } = await import("../dialogs.js");
    const cur = (this.model.footnotes[id] || []).map((p) => M.paraText(p)).join("\n");
    const v = await promptDialog({ title: "Edit footnote", label: "Footnote text", value: cur, ok: "Save" });
    if (v === null) return;
    this.commit({ ...this.model, footnotes: { ...this.model.footnotes, [id]: v.split("\n").map((l) => M.para(l)) } }, { label: "Edit Footnote" });
  }

  setLink(href) {
    const [a, b] = this.range;
    if (this.collapsed) {
      // no selection: insert the address as linked text
      if (!href) return;
      const p = this.currentPara();
      const marks = { ...M.marksAt(p.runs, a.offset), link: href };
      const r = M.insertText(this.model, a, href, marks);
      return this.commit(r.doc, { label: "Insert Link", sel: r.pos });
    }
    this.commit(M.formatRange(this.model, a, b, { link: href || null, u: null }), { label: href ? "Link" : "Remove Link", sel: this.sel });
  }

  /** The link at the caret, or null. */
  linkAt() {
    const [a] = this.range;
    const p = M.getBlock(this.model, a.path);
    return p?.type === "paragraph" ? M.marksAt(p.runs, Math.max(a.offset, this.collapsed ? a.offset : a.offset + 1)).link || null : null;
  }

  // ---- tables

  tableContext() {
    const path = this.sel.focus.path;
    if (path.length !== 4) return null;
    const t = this.model.blocks[path[0]];
    if (t?.type !== "table") return null;
    return { ti: path[0], t, r: path[1], ci: path[2], col: M.cellColumn(t, path[1], path[2]) };
  }

  tableOp(op, arg) {
    const ctx = this.tableContext();
    if (!ctx) return this.app.toast("Put the caret in a table first.", "warning");
    const { ti, t, r, col } = ctx;
    let next;
    let sel = null;
    switch (op) {
      case "rowAbove":
        next = M.tableInsertRow(t, r, false);
        sel = { path: [ti, r, 0, 0], offset: 0 };
        break;
      case "rowBelow":
        next = M.tableInsertRow(t, r, true);
        sel = { path: [ti, r + 1, 0, 0], offset: 0 };
        break;
      case "colLeft":
        next = M.tableInsertCol(t, col, false);
        break;
      case "colRight":
        next = M.tableInsertCol(t, col, true);
        break;
      case "deleteRow":
        next = M.tableDeleteRow(t, r);
        if (!next) return this.tableOp("deleteTable");
        sel = { path: [ti, Math.max(0, Math.min(r, next.rows.length - 1)), 0, 0], offset: 0 };
        break;
      case "deleteCol":
        next = M.tableDeleteCol(t, col);
        if (!next) return this.tableOp("deleteTable");
        sel = { path: [ti, r, 0, 0], offset: 0 };
        break;
      case "deleteTable": {
        const blocks = this.model.blocks.slice();
        blocks.splice(ti, 1);
        if (!blocks.length || blocks[Math.min(ti, blocks.length - 1)]?.type !== "paragraph") blocks.splice(ti, 0, M.para(""));
        return this.commit({ ...this.model, blocks }, { label: "Delete Table", sel: { path: [Math.min(ti, blocks.length - 1)], offset: 0 } });
      }
      case "merge": {
        const [a, b] = this.range;
        if (a.path.length !== 4 || b.path.length !== 4 || a.path[0] !== b.path[0]) return this.app.toast("Select two or more cells of one table to merge them.", "warning");
        const c0 = M.cellColumn(t, a.path[1], a.path[2]);
        const c1 = M.cellColumn(t, b.path[1], b.path[2]);
        if (a.path[1] === b.path[1] && c0 === c1) return this.app.toast("Select two or more cells (drag across them) to merge.", "warning");
        next = M.tableMerge(t, a.path[1], c0, b.path[1], c1);
        sel = { path: [ti, Math.min(a.path[1], b.path[1]), 0, 0], offset: 0 };
        const g = M.tableGrid(next)[sel.path[1]][Math.min(c0, c1)];
        sel.path[2] = g ? g.ci : 0;
        break;
      }
      case "split":
        next = M.tableSplit(t, r, ctx.ci);
        break;
      case "header":
        next = { ...t, rows: t.rows.map((row, k) => (k === 0 ? { ...row, header: !row.header } : row)) };
        break;
      case "shading": {
        const grid = M.tableGrid(t);
        const [a, b] = this.range;
        const rows = t.rows.map((row) => ({ ...row, cells: row.cells.slice() }));
        const inSel = (rr, cc) => {
          if (a.path.length !== 4 || b.path.length !== 4) return rr === r && cc === col;
          const r0 = Math.min(a.path[1], b.path[1]);
          const r1 = Math.max(a.path[1], b.path[1]);
          const x0 = Math.min(M.cellColumn(t, a.path[1], a.path[2]), M.cellColumn(t, b.path[1], b.path[2]));
          const x1 = Math.max(M.cellColumn(t, a.path[1], a.path[2]), M.cellColumn(t, b.path[1], b.path[2]));
          return rr >= r0 && rr <= r1 && cc >= x0 && cc <= x1;
        };
        grid.forEach((gr, rr) => gr.forEach((g, cc) => {
          if (g?.origin && inSel(rr, cc)) {
            const cell = { ...rows[rr].cells[g.ci] };
            if (arg) cell.shading = arg;
            else delete cell.shading;
            rows[rr].cells[g.ci] = cell;
          }
        }));
        next = { ...t, rows };
        break;
      }
      case "borders":
        next = { ...t, borders: { ...t.borders, ...arg } };
        break;
      case "colWidths":
        next = { ...t, cols: arg };
        break;
      default:
        return;
    }
    this.commit(M.replaceTop(this.model, ti, next), { label: "Edit Table", sel: sel || this.sel });
  }

  moveCell(dir) {
    const ctx = this.tableContext();
    if (!ctx) return;
    const { ti, t, r, ci } = ctx;
    let nr = r;
    let nc = ci + dir;
    if (nc >= t.rows[r].cells.length) {
      nr++;
      nc = 0;
    } else if (nc < 0) {
      nr--;
      nc = nr >= 0 ? t.rows[nr].cells.length - 1 : 0;
    }
    if (nr >= t.rows.length) return this.tableOp("rowBelow");
    if (nr < 0) return;
    const p = t.rows[nr].cells[nc].blocks[0];
    this.setSelection({ anchor: { path: [ti, nr, nc, 0], offset: 0 }, focus: { path: [ti, nr, nc, 0], offset: M.paraLength(p) } });
  }

  // ---- clipboard

  /** The selection as a small document (paragraphs; table cells are flattened). */
  selectionDoc() {
    const [a, b] = this.range;
    const blocks = [];
    for (const path of M.pathsBetween(this.model, a.path, b.path)) {
      const p = M.getBlock(this.model, path);
      if (p?.type !== "paragraph") continue;
      const s = M.samePath(path, a.path) ? a.offset : 0;
      const e = M.samePath(path, b.path) ? b.offset : Infinity;
      blocks.push({ ...p, runs: M.sliceRuns(p.runs, s, e) });
    }
    return { ...this.model, blocks: blocks.length ? blocks : [M.para("")] };
  }

  selectedText() {
    return M.documentText(this.selectionDoc());
  }

  async #copy(e, cut) {
    this.#syncFromDom();
    if (this.collapsed) return;
    e.preventDefault();
    const sd = this.selectionDoc();
    const { writeHtml } = await import("../../engine/office/html.js").catch(() => ({}));
    const text = M.documentText(sd).replace(/\uFFFC/g, "");
    try {
      e.clipboardData?.setData("text/plain", text);
      if (writeHtml) e.clipboardData?.setData("text/html", writeHtml(sd, { fragment: true }));
    } catch {
      /* clipboard not available */
    }
    if (cut) {
      const [a, b] = this.range;
      const r = M.deleteRange(this.model, a, b);
      this.commit(r.doc, { label: "Cut", sel: r.pos });
    }
  }

  async #paste(e) {
    e.preventDefault();
    this.#syncFromDom();
    const dt = e.clipboardData;
    if (!dt) return;
    const file = [...(dt.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) return this.insertImage(new Uint8Array(await file.arrayBuffer()), file.name || "Pasted image");
    const html = dt.getData("text/html");
    const text = dt.getData("text/plain");
    if (html && !this.plainPaste) return this.pasteHtml(html);
    if (text) this.insertText(text.replace(/\r\n?/g, "\n"), "Paste");
    this.plainPaste = false;
  }

  /** Pastes sanitized HTML (formatting, lists, tables and embedded images are kept). */
  async pasteHtml(html) {
    const { readHtml } = await import("../../engine/office/html.js");
    const frag = readHtml(html).doc;
    this.insertFragment(frag, "Paste");
  }

  /** Inserts another document's blocks at the caret. */
  insertFragment(frag, label = "Insert") {
    let m = { ...this.model, media: { ...this.model.media }, footnotes: { ...this.model.footnotes } };
    // bring media and footnotes along under fresh ids
    const mediaMap = new Map();
    for (const [id, med] of Object.entries(frag.media || {})) mediaMap.set(id, addMedia(m, med, "img"));
    const fnMap = new Map();
    for (const [id, f] of Object.entries(frag.footnotes || {})) {
      const nid = M.uid("fn");
      fnMap.set(id, nid);
      m.footnotes[nid] = f;
    }
    const fixRuns = (runs) => runs.map((r) => (r.type === "image" ? { ...r, media: mediaMap.get(r.media) || r.media } : r.type === "footnote" ? { ...r, id: fnMap.get(r.id) || r.id } : r));
    const blocks = frag.blocks.map((b) => (b.type === "paragraph" ? { ...b, runs: fixRuns(b.runs) } : b.type === "table" ? { ...b, rows: b.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, blocks: c.blocks.map((p) => ({ ...p, runs: fixRuns(p.runs) })) })) })) } : b));
    while (blocks.length > 1 && blocks[blocks.length - 1].type === "paragraph" && !blocks[blocks.length - 1].runs.length) blocks.pop();
    let pos = this.sel.focus;
    if (!this.collapsed) {
      const [a, b] = this.range;
      ({ doc: m, pos } = M.deleteRange(m, a, b));
    }
    const inCell = pos.path.length > 1;
    if (blocks.every((b) => b.type === "paragraph") || inCell) {
      const paras = blocks.flatMap((b) => (b.type === "paragraph" ? [b] : b.type === "table" ? b.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks)) : []));
      if (paras.length === 1) {
        const r = M.insertInline(m, pos, paras[0].runs);
        return this.commit(r.doc, { label, sel: r.pos });
      }
      // first paragraph joins the caret paragraph, the rest follow with their own style
      const p = M.getBlock(m, pos.path);
      const head = M.sliceRuns(p.runs, 0, pos.offset);
      const tail = M.sliceRuns(p.runs, pos.offset, Infinity);
      const list = paras.map((q, k) => (k === 0 ? { ...p, runs: M.mergeRuns([...head, ...q.runs]) } : q));
      const last = list[list.length - 1];
      const lastLen = M.paraLength(last);
      list[list.length - 1] = { ...last, runs: M.mergeRuns([...last.runs, ...tail]) };
      const i = pos.path[pos.path.length - 1];
      m = M.updateContainer(m, pos.path, (l) => [...l.slice(0, i), ...list, ...l.slice(i + 1)]);
      return this.commit(m, { label, sel: { path: pos.path.slice(0, -1).concat(i + list.length - 1), offset: lastLen } });
    }
    const r = M.insertBlocksAt(m, pos, blocks);
    this.commit(r.doc, { label, sel: r.pos });
  }

  #posFromPoint(x, y) {
    const caret = document.caretPositionFromPoint?.(x, y) || null;
    const range = caret ? null : document.caretRangeFromPoint?.(x, y);
    const node = caret ? caret.offsetNode : range?.startContainer;
    const off = caret ? caret.offset : range?.startOffset;
    return node ? this.domToPos(node, off) : null;
  }

  async #drop(e) {
    const dt = e.dataTransfer;
    if (!dt) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = this.#posFromPoint(e.clientX, e.clientY);
    if (pos) this.sel = { anchor: pos, focus: pos };
    const files = [...(dt.files || [])];
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (sniffImage(bytes, f.name)) this.insertImage(bytes, f.name);
      else if (/\.(docx|odt|rtf|md|markdown|txt|html?)$/i.test(f.name)) {
        const { importOffice } = await import("../../engine/office/index.js");
        try {
          this.insertFragment(importOffice(f.name, bytes).doc, "Insert File");
        } catch (err) {
          this.app.toast(err.message, "danger", 5000);
        }
      } else this.app.toast(`“${f.name}” cannot be inserted into a document.`, "warning");
    }
    if (files.length) return;
    const html = dt.getData("text/html");
    if (html) return this.pasteHtml(html);
    const text = dt.getData("text/plain");
    if (text) this.insertText(text, "Drop Text");
  }

  selectAll() {
    const all = [...M.paragraphs(this.model)];
    const last = all[all.length - 1];
    this.setSelection({ anchor: { path: all[0].path, offset: 0 }, focus: { path: last.path, offset: M.paraLength(last.para) } });
  }

  focus() {
    this.flow.focus({ preventScroll: true });
    this.#restoreSelection(true, false);
  }

  /** Selects a found range and scrolls it into view. */
  reveal(path, from, to) {
    this.setSelection({ anchor: { path, offset: from }, focus: { path, offset: to } });
  }
}
