// Presentation app UI (Office Suite kind "slides"): ribbon, thumbnails panel, edit canvas with selection handles
// (move, resize, rotate), in-place text editing, speaker notes, slide sorter and the export dialog. Mounted by
// app.js ▸ mount(); the instance becomes app.officeUI. Every change goes through commitOffice (undo, collaboration);
// ribbon buttons and keys run the slides.* commands (commands/office-slides.js), which call the methods below.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { commitOffice } from "../../core/office.js";
import { officeItemAnchor } from "../../collab/anchors.js";
import { ribbon, button, colorPicker, fontControls, splitPanels, dragGesture, officeContextMenu, openDialog } from "../toolkit/ui.js";
import * as M from "./model.js";
import { MediaUrls, slideNode, scaledSlide, elementNode } from "./slide-dom.js";

let stylesLoaded = false;
function ensureStyles() {
  if (stylesLoaded || typeof document === "undefined") return;
  stylesLoaded = true;
  document.head.append(h("link", { rel: "stylesheet", href: new URL("styles/office-slides.css", document.baseURI).href }));
}

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const SHAPE_ITEMS = [
  { value: "rect", label: "Rectangle", icon: "square" },
  { value: "roundRect", label: "Rounded rectangle", icon: "app" },
  { value: "ellipse", label: "Ellipse", icon: "circle" },
  { value: "triangle", label: "Triangle", icon: "triangle" },
  { value: "diamond", label: "Diamond", icon: "diamond" },
  { value: "arrow", label: "Arrow", icon: "arrow-right" },
  { value: "line", label: "Line", icon: "slash-lg" },
];
const ALIGN_ITEMS = [
  { value: "left", label: "Align left edges", icon: "align-start" },
  { value: "center", label: "Align centers", icon: "align-center" },
  { value: "right", label: "Align right edges", icon: "align-end" },
  "-",
  { value: "top", label: "Align tops", icon: "align-top" },
  { value: "middle", label: "Align middles", icon: "align-middle" },
  { value: "bottom", label: "Align bottoms", icon: "align-bottom" },
];
const EXPORT_ITEMS = [
  { value: "pptx", label: "PowerPoint presentation (.pptx)" },
  { value: "odp", label: "OpenDocument presentation (.odp)" },
  { value: "pdf", label: "PDF (.pdf)" },
  { value: "png", label: "PNG images, one per slide (.zip)" },
  { value: "png1", label: "This slide as PNG (.png)" },
];
let clipboard = null; // { elements, media } copied elements (shared between decks of this window)

function menuButton({ icon, label, items, onPick }) {
  const menu = h("sl-menu", ...items.map((it) => (it === "-" ? h("sl-divider") : h("sl-menu-item", { value: it.value }, it.icon ? h("sl-icon", { slot: "prefix", name: it.icon }) : null, t(it.label)))));
  menu.addEventListener("sl-select", (e) => onPick(e.detail.item.value));
  return h("sl-dropdown", { hoist: true }, h("button.of-tk-btn", { slot: "trigger", type: "button", "aria-label": t(label), "data-tip": t(label) }, h("sl-icon", { name: icon, "aria-hidden": "true" }), h("sl-icon.of-sl-caret", { name: "chevron-down", "aria-hidden": "true" })), menu);
}

export class SlidesView {
  constructor(host, doc, app) {
    ensureStyles();
    this.kind = "slides";
    this.host = host;
    this.doc = doc;
    this.app = app;
    this.urls = new MediaUrls();
    this.cur = this.deck.slides[0]?.id;
    this.sel = new Set();
    this.mode = "normal";
    this.scale = 1;
    this.thumbCache = new Map(); // slide id → { slide, theme, node }
    this.editing = null;
    this.build();
    this.offChange = doc.office.on("change", () => this.refresh());
    this.refresh();
  }

  get deck() {
    return this.doc.office.model;
  }
  get slide() {
    return M.slideById(this.deck, this.cur) || this.deck.slides[0];
  }
  get selected() {
    return this.slide.elements.filter((e) => this.sel.has(e.id));
  }
  commit(label, next, opts) {
    commitOffice(this.doc, t(label), next, opts);
  }
  run(id, args) {
    return this.app.run(id, args);
  }

  // ------------------------------------------------------------------ building

  build() {
    const cmd = (icon, label, id, args) => button({ icon, label, onClick: () => this.run(id, args) });
    this.fonts = fontControls({ onFamily: (font) => this.run("slides.format", { style: { font } }), onSize: (size) => this.run("slides.format", { style: { size } }) });
    this.textColor = colorPicker({ label: "Text color", value: "#000000", onPick: (color) => this.run("slides.format", { style: { color } }) });
    this.fillColor = colorPicker({ label: "Fill color", value: null, allowNone: true, onPick: (fill) => this.run("slides.format", { fill }) });
    this.lineColor = colorPicker({ label: "Outline color", value: null, allowNone: true, onPick: (stroke) => this.run("slides.format", { stroke, ...(stroke ? { strokeWidth: Math.max(1, this.selected[0]?.strokeWidth || 0) } : {}) }) });
    this.bgColor = colorPicker({ label: "Slide background", value: null, allowNone: true, onPick: (color) => this.run("slides.background", { color }) });
    this.toggles = {
      bold: button({ icon: "type", label: "Bold", toggle: true, onClick: () => this.run("slides.bold") }),
      italic: button({ icon: "type-italic", label: "Italic", toggle: true, onClick: () => this.run("slides.italic") }),
      underline: button({ icon: "type-underline", label: "Underline", toggle: true, onClick: () => this.run("slides.underline") }),
      bullets: button({ icon: "list-ul", label: "Bullets", toggle: true, onClick: () => this.run("slides.bullets") }),
      sorter: button({ icon: "grid-3x3-gap", label: "Slide sorter", toggle: true, onClick: () => this.run("slides.sorter") }),
    };
    this.toggles.bold.querySelector("sl-icon")?.replaceWith(h("b", { "aria-hidden": "true" }, "B"));
    const layouts = M.LAYOUTS.map((l) => ({ value: l.id, label: l.name }));
    this.ribbon = ribbon([
      { id: "slide", label: "Slide", items: [
        menuButton({ icon: "plus-lg", label: "New slide", items: layouts, onPick: (layout) => this.run("slides.newSlide", { layout }) }),
        cmd("files", "Duplicate slide", "slides.duplicateSlide"),
        cmd("trash", "Delete slide", "slides.deleteSlide"),
        menuButton({ icon: "layout-split", label: "Layout", items: layouts, onPick: (layout) => this.run("slides.layout", { layout }) }),
        cmd("eye-slash", "Hide slide in the show", "slides.hideSlide"),
      ] },
      { id: "insert", label: "Insert", items: [
        cmd("fonts", "Text box", "slides.insertText"),
        menuButton({ icon: "square", label: "Shape", items: SHAPE_ITEMS, onPick: (shape) => this.run("slides.insertShape", { shape }) }),
        cmd("image", "Picture…", "slides.insertImage"),
        cmd("table", "Table", "slides.insertTable"),
      ] },
      { id: "text", label: "Text", items: [this.fonts.el, this.toggles.bold, this.toggles.italic, this.toggles.underline, this.textColor.el, cmd("text-left", "Align left", "slides.alignLeft"), cmd("text-center", "Center", "slides.alignCenter"), cmd("text-right", "Align right", "slides.alignRight"), this.toggles.bullets] },
      { id: "shape", label: "Shape", items: [this.fillColor.el, this.lineColor.el] },
      { id: "arrange", label: "Arrange", items: [
        cmd("front", "Bring to front", "slides.front"),
        cmd("back", "Send to back", "slides.back"),
        cmd("layer-forward", "Bring forward", "slides.forward"),
        cmd("layer-backward", "Send backward", "slides.backward"),
        menuButton({ icon: "align-center", label: "Align", items: ALIGN_ITEMS, onPick: (how) => this.run("slides.align", { how }) }),
        cmd("arrow-clockwise", "Rotate 90°", "slides.rotate"),
      ] },
      { id: "design", label: "Design", items: [
        menuButton({ icon: "palette", label: "Theme", items: M.THEMES.map((x) => ({ value: x.id, label: x.name })), onPick: (theme) => this.run("slides.theme", { theme }) }),
        this.bgColor.el,
        menuButton({ icon: "collection", label: "Transition", items: [{ value: "none", label: "No transition" }, { value: "fade", label: "Fade" }, { value: "slide", label: "Slide in" }], onPick: (type) => this.run("slides.transition", { type }) }),
      ] },
      { id: "show", label: "Slide show", items: [cmd("play-btn", "Present from the beginning", "slides.present"), cmd("play-circle", "Present from this slide", "slides.presentCurrent"), cmd("display", "Presenter view", "slides.presenterView"), this.toggles.sorter] },
    ]);

    this.thumbs = h("div.of-sl-thumbs", { role: "listbox", "aria-label": t("Slides"), tabindex: "0" });
    this.stage = h("div.of-sl-stage", { tabindex: "0", role: "application", "aria-label": t("Slide canvas") });
    this.notes = h("textarea.of-sl-notes", { "aria-label": t("Speaker notes"), placeholder: t("Click to add speaker notes"), spellcheck: "true" });
    this.main = h("div.of-sl-main", this.stage, this.notes);
    this.split = splitPanels({ a: this.thumbs, b: this.main, size: 200, min: 120 });
    this.sorter = h("div.of-sl-sorter", { role: "listbox", "aria-label": t("Slide sorter"), hidden: true, tabindex: "0" });
    this.live = h("div.of-sl-sr", { "aria-live": "polite" });
    this.el = h("div.of-sl", this.ribbon, this.split.el, this.sorter, this.live);
    this.host.replaceChildren(this.el);

    this.notes.addEventListener("input", () => {
      const id = this.slide.id;
      this.commit("Speaker Notes", M.updateSlide(this.deck, id, { notes: this.notes.value }), { coalesce: `notes:${id}` });
    });
    this.wireThumbs(this.thumbs);
    this.wireThumbs(this.sorter);
    this.wireStage();
    this.ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.fit()) : null;
    this.ro?.observe(this.stage);
  }

  // ------------------------------------------------------------------ rendering

  refresh() {
    const deck = this.deck;
    if (!M.slideById(deck, this.cur)) this.cur = deck.slides[Math.min(deck.slides.length - 1, Math.max(0, this.lastIndex || 0))]?.id;
    this.lastIndex = M.slideIndex(deck, this.cur);
    for (const id of [...this.sel]) if (!this.slide.elements.some((e) => e.id === id)) this.sel.delete(id);
    if (this.editing) return; // the text being typed is the source of truth until it is committed
    this.renderThumbs();
    this.renderStage();
    if (document.activeElement !== this.notes) this.notes.value = this.slide.notes;
    this.syncControls();
    this.app.emit("officestatus");
  }

  renderThumbs() {
    const deck = this.deck;
    const list = this.mode === "sorter" ? this.sorter : this.thumbs;
    const width = this.mode === "sorter" ? 220 : 160;
    const keep = new Set();
    const items = deck.slides.map((s, i) => {
      keep.add(s.id);
      const key = `${s.id}|${width}`;
      let c = this.thumbCache.get(key);
      if (!c || c.slide !== s || c.theme !== deck.theme || c.size !== deck.size || c.media !== deck.media) {
        c = { slide: s, theme: deck.theme, size: deck.size, media: deck.media, node: scaledSlide(deck, s, this.urls, width) };
        this.thumbCache.set(key, c);
      }
      const title = M.slideTitle(s);
      return h(`div.of-sl-thumb${s.id === this.cur ? ".is-current" : ""}${s.hidden ? ".is-hidden" : ""}`, { role: "option", "aria-selected": String(s.id === this.cur), "data-id": s.id, draggable: "true", title: title || t("Slide {n}", { n: i + 1 }), "aria-label": `${t("Slide {n}", { n: i + 1 })}${title ? `: ${title}` : ""}` },
        h("span.of-sl-thumb__num", String(i + 1)), c.node, s.hidden ? h("sl-icon.of-sl-thumb__hidden", { name: "eye-slash", "aria-label": t("Hidden in the show") }) : null);
    });
    for (const k of [...this.thumbCache.keys()]) if (!keep.has(k.split("|")[0])) this.thumbCache.delete(k);
    list.replaceChildren(...items);
    list.querySelector(".is-current")?.scrollIntoView?.({ block: "nearest" });
  }

  renderStage() {
    const deck = this.deck;
    const node = slideNode(deck, this.slide, this.urls, { hints: true });
    node.classList.add("of-sl-canvas");
    this.overlay = h("div.of-sl-overlay");
    node.append(this.overlay);
    this.canvas = node;
    this.frame = h("div.of-sl-frame", node);
    this.stage.replaceChildren(this.frame);
    this.fit();
    this.drawSelection();
  }

  fit() {
    if (!this.canvas) return;
    const { w, h: hh } = this.deck.size;
    const pad = 32;
    const s = Math.max(0.05, Math.min((this.stage.clientWidth - pad) / w, (this.stage.clientHeight - pad) / hh));
    this.scale = Number.isFinite(s) && s > 0 ? s : 1;
    this.canvas.style.transform = `scale(${this.scale})`;
    this.frame.style.width = `${w * this.scale}px`;
    this.frame.style.height = `${hh * this.scale}px`;
    this.canvas.style.setProperty("--of-sl-inv", String(1 / this.scale));
  }

  drawSelection() {
    if (!this.overlay) return;
    const els = this.selected;
    this.overlay.replaceChildren(...els.map((e) => {
      const box = h("div.of-sl-sel", { "data-id": e.id, style: { left: `${e.x}px`, top: `${e.y}px`, width: `${e.w}px`, height: `${Math.max(e.h, 1)}px`, transform: `rotate(${e.rot || 0}deg)` } });
      if (els.length === 1 && !this.editing) {
        for (const k of HANDLES) box.append(h(`div.of-sl-handle.is-${k}`, { "data-handle": k, "aria-hidden": "true" }));
        box.append(h("div.of-sl-handle.is-rot", { "data-handle": "rot", "aria-hidden": "true" }));
      }
      return box;
    }));
    for (const n of this.canvas.querySelectorAll(".of-sl-el")) n.classList.toggle("is-selected", this.sel.has(n.dataset.id));
  }

  syncControls() {
    const e = this.selected.find((x) => x.style) || null;
    const look = e ? M.textLook(this.deck, e) : null;
    this.fonts.set(look ? { family: look.font, size: look.size } : {});
    for (const k of ["bold", "italic", "underline", "bullets"]) this.toggles[k].setAttribute("aria-pressed", String(!!look?.[k]));
    this.toggles.sorter.setAttribute("aria-pressed", String(this.mode === "sorter"));
    if (look) this.textColor.set(look.color);
    const f = this.selected[0];
    this.fillColor.set(f?.fill || null);
    this.lineColor.set(f?.stroke || null);
    this.bgColor.set(this.slide.background?.color || null);
  }

  statusText() {
    const i = M.slideIndex(this.deck, this.cur) + 1;
    const n = this.sel.size;
    return `${t("Slide {n} of {total}", { n: i, total: this.deck.slides.length })}${n ? ` · ${t("{n} selected", { n })}` : ""}`;
  }

  // ------------------------------------------------------------------ navigation and selection

  goTo(id, { focus = false } = {}) {
    if (!M.slideById(this.deck, id)) return;
    this.finishEditing();
    if (this.cur !== id) this.sel.clear();
    this.cur = id;
    this.refresh();
    const i = M.slideIndex(this.deck, id);
    this.live.textContent = t("Slide {n} of {total}", { n: i + 1, total: this.deck.slides.length });
    if (focus) (this.mode === "sorter" ? this.sorter : this.thumbs).focus();
  }
  step(d) {
    const i = M.slideIndex(this.deck, this.cur) + d;
    if (i >= 0 && i < this.deck.slides.length) this.goTo(this.deck.slides[i].id);
  }
  select(ids, add = false) {
    if (!add) this.sel.clear();
    for (const id of ids) this.sel.add(id);
    this.drawSelection();
    this.syncControls();
    this.app.emit("officestatus");
  }

  wireThumbs(list) {
    list.addEventListener("click", (e) => {
      const th = e.target.closest(".of-sl-thumb");
      if (th) this.goTo(th.dataset.id);
    });
    list.addEventListener("dblclick", (e) => {
      if (this.mode === "sorter" && e.target.closest(".of-sl-thumb")) this.run("slides.sorter");
    });
    list.addEventListener("contextmenu", (e) => {
      const th = e.target.closest(".of-sl-thumb");
      if (th) this.goTo(th.dataset.id);
      officeContextMenu(this.app, e, "office-slides", { view: this, target: "thumb" });
    });
    list.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      const grid = this.mode === "sorter" ? Math.max(1, Math.floor(this.sorter.clientWidth / 236)) : 1;
      let handled = true;
      if (e.altKey && (k === "ArrowUp" || k === "ArrowLeft")) this.run("slides.moveUp");
      else if (e.altKey && (k === "ArrowDown" || k === "ArrowRight")) this.run("slides.moveDown");
      else if (k === "ArrowUp" || (k === "ArrowLeft" && grid > 1)) this.step(k === "ArrowLeft" ? -1 : -grid);
      else if (k === "ArrowDown" || (k === "ArrowRight" && grid > 1)) this.step(k === "ArrowRight" ? 1 : grid);
      else if (k === "Home") this.goTo(this.deck.slides[0].id);
      else if (k === "End") this.goTo(this.deck.slides.at(-1).id);
      else if (k === "Delete" || k === "Backspace") this.run("slides.deleteSlide");
      else if (mod && k.toLowerCase() === "d") this.run("slides.duplicateSlide");
      else if (k === "Enter" && !mod) this.run(this.mode === "sorter" ? "slides.sorter" : "slides.newSlide");
      else handled = false;
      if (handled) e.preventDefault();
      if (handled) list.focus();
    });
    let dragId = null;
    list.addEventListener("dragstart", (e) => {
      const th = e.target.closest(".of-sl-thumb");
      if (!th) return;
      dragId = th.dataset.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", t("Slide {n}", { n: M.slideIndex(this.deck, dragId) + 1 }));
    });
    const dropIndex = (e) => {
      const items = [...list.querySelectorAll(".of-sl-thumb")];
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        const before = this.mode === "sorter" ? e.clientY < r.bottom && (e.clientY < r.top || e.clientX < r.left + r.width / 2) : e.clientY < r.top + r.height / 2;
        if (before) return i;
      }
      return items.length;
    };
    list.addEventListener("dragover", (e) => {
      if (!dragId) return;
      e.preventDefault();
      const i = dropIndex(e);
      list.querySelectorAll(".is-drop").forEach((n) => n.classList.remove("is-drop"));
      list.querySelectorAll(".of-sl-thumb")[i]?.classList.add("is-drop");
    });
    list.addEventListener("drop", (e) => {
      if (!dragId) return;
      e.preventDefault();
      let i = dropIndex(e);
      const from = M.slideIndex(this.deck, dragId);
      if (from < i) i--;
      if (from !== i) this.commit("Move Slide", M.moveSlides(this.deck, [dragId], i));
      dragId = null;
    });
    list.addEventListener("dragend", () => {
      dragId = null;
      list.querySelectorAll(".is-drop").forEach((n) => n.classList.remove("is-drop"));
    });
  }

  // ------------------------------------------------------------------ canvas interaction

  toSlide(ev) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / this.scale, y: (ev.clientY - r.top) / this.scale };
  }

  wireStage() {
    const st = this.stage;
    st.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || this.editing?.node.contains(ev.target)) return;
      if (this.editing) this.finishEditing();
      const handle = ev.target.closest?.(".of-sl-handle");
      if (handle) return this.startHandle(ev, handle.dataset.handle);
      const elNode = ev.target.closest?.(".of-sl-el");
      if (!elNode || !this.canvas.contains(elNode)) {
        if (this.canvas?.contains(ev.target) || ev.target === st || ev.target === this.frame) this.startMarquee(ev);
        return;
      }
      const id = elNode.dataset.id;
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
        if (this.sel.has(id)) this.sel.delete(id);
        else this.sel.add(id);
        this.select([...this.sel]);
      } else if (!this.sel.has(id)) this.select([id]);
      st.focus({ preventScroll: true });
      this.startMove(ev);
    });
    st.addEventListener("dblclick", (ev) => {
      // pointer capture during the first click retargets the event to the stage: hit-test the point instead
      const hit = document.elementFromPoint(ev.clientX, ev.clientY) || ev.target;
      const elNode = hit.closest?.(".of-sl-el");
      if (elNode) this.editText(elNode.dataset.id, hit.closest("td, th"));
    });
    st.addEventListener("contextmenu", (ev) => {
      const elNode = ev.target.closest?.(".of-sl-el");
      if (elNode && !this.sel.has(elNode.dataset.id)) this.select([elNode.dataset.id]);
      if (!elNode && !ev.target.closest(".of-sl-sel")) this.select([]);
      officeContextMenu(this.app, ev, "office-slides", { view: this, target: this.sel.size ? "element" : "slide" });
    });
    st.addEventListener("keydown", (ev) => this.onKey(ev));
    st.addEventListener("paste", (ev) => this.onPaste(ev));
    st.addEventListener("dragover", (ev) => ev.dataTransfer?.types?.includes("Files") && ev.preventDefault());
    st.addEventListener("drop", async (ev) => {
      const files = [...(ev.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      ev.preventDefault();
      const p = this.toSlide(ev);
      for (const f of files) await this.insertImageBytes(new Uint8Array(await f.arrayBuffer()), f.name, p);
    });
  }

  /** Live preview of element boxes during a gesture (DOM only); the model changes once at the end. */
  preview(boxes) {
    for (const [id, b] of boxes) {
      for (const n of [this.canvas.querySelector(`.of-sl-el[data-id="${CSS.escape(id)}"]`), this.overlay.querySelector(`.of-sl-sel[data-id="${CSS.escape(id)}"]`)]) {
        if (!n) continue;
        n.style.left = `${b.x}px`;
        n.style.top = `${b.y}px`;
        n.style.width = `${b.w}px`;
        n.style.height = `${Math.max(1, b.h)}px`;
        n.style.transform = `rotate(${b.rot || 0}deg)${n.classList.contains("of-sl-el") && (b.flipH || b.flipV) ? ` scale(${b.flipH ? -1 : 1}, ${b.flipV ? -1 : 1})` : ""}`;
        const svg = n.querySelector?.(":scope > .of-sl-svg");
        if (svg && (b.w !== svg.width.baseVal.value || b.h !== svg.height.baseVal.value)) {
          const e = this.slide.elements.find((x) => x.id === id);
          svg.replaceWith(elementNode(this.deck, { ...e, ...b }, this.urls).querySelector(".of-sl-svg"));
        }
      }
    }
  }

  gesture(ev, onMove, onEnd) {
    const st = this.stage;
    st.setPointerCapture?.(ev.pointerId);
    const start = this.toSlide(ev);
    const move = (e) => onMove(this.toSlide(e), start, e);
    const up = (e) => {
      st.removeEventListener("pointermove", move);
      st.removeEventListener("pointerup", up);
      st.removeEventListener("pointercancel", up);
      onEnd(this.toSlide(e), start, e);
    };
    st.addEventListener("pointermove", move);
    st.addEventListener("pointerup", up);
    st.addEventListener("pointercancel", up);
  }

  snap(v, targets, tol = 6 / this.scale) {
    for (const tv of targets) if (Math.abs(v - tv) <= tol) return tv - v;
    return null;
  }

  startMove(ev) {
    const els = this.selected;
    const starts = new Map(els.map((e) => [e.id, { ...e }]));
    const { w, h: hh } = this.deck.size;
    const others = this.slide.elements.filter((e) => !this.sel.has(e.id));
    const xs = [0, w / 2, w, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
    const ys = [0, hh / 2, hh, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
    const b0 = M.bounds(els);
    let last = null;
    this.gesture(ev, (p, s, e) => {
      let dx = p.x - s.x, dy = p.y - s.y;
      if (!last && Math.hypot(dx, dy) * this.scale < 3) return;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      if (!e.altKey) {
        const sx = [b0.x + dx, b0.x + dx + b0.w / 2, b0.x + dx + b0.w].map((v) => this.snap(v, xs)).find((v) => v != null);
        const sy = [b0.y + dy, b0.y + dy + b0.h / 2, b0.y + dy + b0.h].map((v) => this.snap(v, ys)).find((v) => v != null);
        if (sx != null) dx += sx;
        if (sy != null) dy += sy;
      }
      last = { dx: Math.round(dx), dy: Math.round(dy) };
      this.preview(els.map((el) => [el.id, { ...starts.get(el.id), x: starts.get(el.id).x + last.dx, y: starts.get(el.id).y + last.dy }]));
    }, () => {
      if (!last || (!last.dx && !last.dy)) return;
      this.commit("Move", M.updateElements(this.deck, this.slide.id, [...starts.keys()], (el) => ({ x: starts.get(el.id).x + last.dx, y: starts.get(el.id).y + last.dy })));
    });
  }

  startHandle(ev, kind) {
    const e = this.selected[0];
    if (!e) return;
    const rad = ((e.rot || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    let next = null;
    ev.stopPropagation();
    this.gesture(ev, (p, s, pe) => {
      if (kind === "rot") {
        let a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        if (!pe.shiftKey) {
          const snapTo = Math.round(a / 15) * 15;
          if (Math.abs(snapTo - a) < 4) a = snapTo;
        }
        next = { ...e, rot: Math.round(((a % 360) + 360) % 360) };
      } else {
        // pointer delta in the element's own (unrotated) frame
        const dx = p.x - s.x, dy = p.y - s.y;
        const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
        let L = 0, T = 0, R = e.w, B = e.h;
        if (kind.includes("w")) L += lx;
        if (kind.includes("e")) R += lx;
        if (kind.includes("n")) T += ly;
        if (kind.includes("s")) B += ly;
        const keep = pe.shiftKey !== (e.type === "image") && kind.length === 2 && e.h > 0;
        if (keep) {
          const ratio = e.w / e.h;
          const w2 = Math.abs(R - L), h2 = Math.abs(B - T);
          if (w2 / ratio > h2) kind.includes("n") ? (T = B - w2 / ratio) : (B = T + w2 / ratio);
          else kind.includes("w") ? (L = R - h2 * ratio) : (R = L + h2 * ratio);
        }
        const flipH = R < L, flipV = B < T && e.shape === "line";
        const w = Math.max(e.shape === "line" ? 1 : 8, Math.abs(R - L)), hh = Math.max(e.shape === "line" ? 0 : 8, Math.abs(B - T));
        const mx = (L + R) / 2 - e.w / 2, my = (T + B) / 2 - e.h / 2;
        const ncx = cx + mx * cos - my * sin, ncy = cy + mx * sin + my * cos;
        next = { ...e, x: Math.round(ncx - w / 2), y: Math.round(ncy - hh / 2), w: Math.round(w), h: Math.round(hh), ...(flipH ? { flipH: !e.flipH } : {}), ...(flipV ? { flipV: !e.flipV } : {}) };
      }
      this.preview([[e.id, next]]);
    }, () => {
      if (!next) return;
      const { x, y, w, h: hh, rot, flipH, flipV } = next;
      this.commit(kind === "rot" ? "Rotate" : "Resize", M.updateElements(this.deck, this.slide.id, [e.id], { x, y, w, h: hh, rot, flipH, flipV }));
    });
  }

  startMarquee(ev) {
    const add = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    if (!add) this.select([]);
    this.stage.focus({ preventScroll: true });
    const rect = h("div.of-sl-marquee");
    let moved = false;
    this.gesture(ev, (p, s) => {
      moved = true;
      if (!rect.isConnected) this.overlay.append(rect);
      Object.assign(rect.style, { left: `${Math.min(p.x, s.x)}px`, top: `${Math.min(p.y, s.y)}px`, width: `${Math.abs(p.x - s.x)}px`, height: `${Math.abs(p.y - s.y)}px` });
    }, (p, s) => {
      rect.remove();
      if (!moved) return;
      const x0 = Math.min(p.x, s.x), x1 = Math.max(p.x, s.x), y0 = Math.min(p.y, s.y), y1 = Math.max(p.y, s.y);
      this.select(this.slide.elements.filter((e) => e.x >= x0 && e.y >= y0 && e.x + e.w <= x1 && e.y + e.h <= y1).map((e) => e.id), add);
    });
  }

  // ------------------------------------------------------------------ text editing

  editText(id, cell = null) {
    const e = this.slide.elements.find((x) => x.id === id);
    if (!e || e.type === "image" || (e.type === "shape" && e.shape === "line")) return;
    this.finishEditing();
    this.select([id]);
    const node = this.canvas.querySelector(`.of-sl-el[data-id="${CSS.escape(id)}"]`);
    let target;
    if (e.type === "table") {
      target = cell || node.querySelector("td, th");
      if (!target) return;
    } else {
      target = node.querySelector(".of-sl-txt");
      if (!e.text) target.replaceChildren(h("div.of-sl-p", "​"));
    }
    target.contentEditable = "plaintext-only";
    if (target.contentEditable !== "plaintext-only") target.contentEditable = "true";
    target.classList.add("is-editing");
    target.spellcheck = true;
    this.editing = { id, node: target, cell: e.type === "table" ? [+target.dataset.r, +target.dataset.c] : null };
    this.drawSelection();
    target.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    target.addEventListener("blur", () => this.finishEditing(), { once: true });
    target.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.finishEditing();
        this.stage.focus();
      } else if (ev.key === "Tab" && this.editing?.cell) {
        ev.preventDefault();
        const [r, c] = this.editing.cell;
        const rows = e.rows;
        const nc = ev.shiftKey ? c - 1 : c + 1;
        const pos = nc >= rows[0].length ? [r + 1, 0] : nc < 0 ? [r - 1, rows[0].length - 1] : [r, nc];
        this.finishEditing();
        const next = this.canvas.querySelector(`.of-sl-el[data-id="${CSS.escape(id)}"] [data-r="${pos[0]}"][data-c="${pos[1]}"]`);
        if (next) this.editText(id, next);
      } else if ((ev.ctrlKey || ev.metaKey) && ["b", "i", "u"].includes(ev.key.toLowerCase())) {
        ev.preventDefault();
        this.run({ b: "slides.bold", i: "slides.italic", u: "slides.underline" }[ev.key.toLowerCase()]);
      }
    });
  }

  /** Text of a contenteditable block: one paragraph per child div (the browser adds divs/brs while typing). */
  static readText(node) {
    const parts = [];
    for (const c of node.childNodes) parts.push((c.innerText ?? c.textContent ?? "").replace(/\n$/, ""));
    return parts.join("\n").replace(/​/g, "").replace(/\r/g, "");
  }

  finishEditing() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    ed.node.contentEditable = "false";
    const text = ed.node.querySelector("div") ? SlidesView.readText(ed.node) : (ed.node.innerText || "").replace(/​/g, "");
    const e = this.slide.elements.find((x) => x.id === ed.id);
    if (!e) return this.refresh();
    if (ed.cell) {
      const rows = e.rows.map((r) => r.slice());
      rows[ed.cell[0]][ed.cell[1]] = text;
      if (JSON.stringify(rows) !== JSON.stringify(e.rows)) return this.commit("Edit Table", M.updateElements(this.deck, this.slide.id, [e.id], { rows }));
    } else if (text !== e.text) return this.commit("Edit Text", M.updateElements(this.deck, this.slide.id, [e.id], { text }));
    this.refresh();
  }

  // ------------------------------------------------------------------ keyboard and clipboard

  onKey(ev) {
    if (this.editing) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const k = ev.key;
    const nudge = ev.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-nudge, 0], ArrowRight: [nudge, 0], ArrowUp: [0, -nudge], ArrowDown: [0, nudge] };
    let handled = true;
    if (arrows[k] && this.sel.size && !mod) {
      const [dx, dy] = arrows[k];
      this.commit("Move", M.updateElements(this.deck, this.slide.id, [...this.sel], (e) => ({ x: e.x + dx, y: e.y + dy })), { coalesce: `nudge:${[...this.sel].join(",")}` });
    } else if ((k === "Delete" || k === "Backspace") && this.sel.size) this.run("slides.delete");
    else if (k === "Escape") this.select([]);
    else if (k === "Enter" && this.sel.size === 1) this.editText([...this.sel][0]);
    else if (k === "Tab" && this.slide.elements.length) {
      const els = this.slide.elements;
      const i = els.findIndex((e) => this.sel.has(e.id));
      this.select([els[(i + (ev.shiftKey ? els.length - 1 : 1) + els.length) % els.length].id]);
      if (i < 0 && ev.shiftKey) this.select([els.at(-1).id]);
    } else if (k === "PageDown" || (!this.sel.size && (k === "ArrowDown" || k === "ArrowRight"))) this.step(1);
    else if (k === "PageUp" || (!this.sel.size && (k === "ArrowUp" || k === "ArrowLeft"))) this.step(-1);
    else if (mod && k.toLowerCase() === "a") this.select(this.slide.elements.map((e) => e.id));
    else if (mod && k.toLowerCase() === "d") this.run("slides.duplicate");
    else if (mod && k.toLowerCase() === "c") this.run("slides.copy");
    else if (mod && k.toLowerCase() === "x") this.run("slides.cut");
    else if (mod && ["b", "i", "u"].includes(k.toLowerCase())) this.run({ b: "slides.bold", i: "slides.italic", u: "slides.underline" }[k.toLowerCase()]);
    else if (mod && ev.shiftKey && k === "]") this.run("slides.front");
    else if (mod && ev.shiftKey && k === "[") this.run("slides.back");
    else if (mod && k === "]") this.run("slides.forward");
    else if (mod && k === "[") this.run("slides.backward");
    else if (mod && k.toLowerCase() === "m") this.run("slides.newSlide");
    else if (k === "F5") this.run(ev.altKey ? "slides.presenterView" : ev.shiftKey ? "slides.presentCurrent" : "slides.present");
    else handled = false;
    if (handled) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  copy(cut = false) {
    const els = this.selected;
    if (!els.length) return;
    const media = {};
    for (const e of els) if (e.media && this.deck.media[e.media]) media[e.media] = this.deck.media[e.media];
    clipboard = { elements: els.map((e) => ({ ...e })), media };
    const text = els.map((e) => e.text || (e.rows ? e.rows.map((r) => r.join("\t")).join("\n") : "")).filter(Boolean).join("\n");
    import("../toolkit/clipboard.js").then((m) => m.writeClipboard({ text: text || " ", json: { openfini: "slides", count: els.length } })).catch(() => {});
    if (cut) this.commit("Cut", M.deleteElements(this.deck, this.slide.id, els.map((e) => e.id)));
  }

  async onPaste(ev) {
    if (this.editing) return;
    const items = [...(ev.clipboardData?.items || [])];
    const img = items.find((i) => i.type.startsWith("image/"));
    if (img) {
      ev.preventDefault();
      const f = img.getAsFile();
      return this.insertImageBytes(new Uint8Array(await f.arrayBuffer()), f.name || "Pasted image");
    }
    const text = ev.clipboardData?.getData("text/plain") || "";
    ev.preventDefault();
    if (clipboard && (!text.trim() || clipboard.elements.some((e) => (e.text || "").trim() && text.includes(e.text.trim())) || text === " ")) return this.paste();
    if (text.trim()) this.insertElement("Paste", { type: "text", x: 80, y: 80, w: Math.min(this.deck.size.w - 160, 600), h: 120, text: text.replace(/\r\n?/g, "\n") });
  }

  paste() {
    if (!clipboard) return;
    let deck = { ...this.deck, media: { ...this.deck.media, ...clipboard.media } };
    const ids = [];
    for (const e of clipboard.elements) {
      const r = M.addElement(deck, this.slide.id, { ...e, id: M.newId(), x: e.x + 16, y: e.y + 16 });
      deck = r.deck;
      ids.push(r.id);
    }
    clipboard = { ...clipboard, elements: clipboard.elements.map((e) => ({ ...e, x: e.x + 16, y: e.y + 16 })) };
    this.commit("Paste", deck);
    this.select(ids);
  }

  // ------------------------------------------------------------------ inserting

  insertElement(label, el) {
    const r = M.addElement(this.deck, this.slide.id, el);
    this.commit(label, r.deck);
    this.select([r.id]);
    this.stage.focus({ preventScroll: true });
    return r.id;
  }

  insertText() {
    const { w, h: hh } = this.deck.size;
    const id = this.insertElement("Insert Text Box", { type: "text", x: Math.round(w / 2 - 200), y: Math.round(hh / 2 - 40), w: 400, h: 80, text: "" });
    this.editText(id);
  }

  insertShape(shape = "rect") {
    const { w, h: hh } = this.deck.size;
    const line = shape === "line";
    this.insertElement("Insert Shape", { type: "shape", shape, x: Math.round(w / 2 - 100), y: Math.round(hh / 2 - (line ? 0 : 75)), w: 200, h: line ? 0 : 150, fill: line ? null : this.deck.theme.accent, stroke: line ? this.deck.theme.text : null, strokeWidth: line ? 3 : 0, style: { align: "center", valign: "middle", color: line ? null : "#ffffff" } });
  }

  insertTable(rows = 3, cols = 3) {
    const { w } = this.deck.size;
    this.insertElement("Insert Table", { type: "table", x: 60, y: 140, w: w - 120, h: rows * 44, rows: Array.from({ length: rows }, () => Array(cols).fill("")), style: { size: 16 } });
  }

  async insertImageBytes(bytes, name = "image", at = null) {
    const { sniffImage, imageSize } = await import("../../engine/office/media.js");
    const mime = sniffImage(bytes, name);
    if (!mime) return this.app.toast(t("“{name}” is not a picture OpenFini can place.", { name }), "warning");
    const sz = imageSize(bytes, mime) || { w: 400, h: 300 };
    const { w: W, h: H } = this.deck.size;
    const k = Math.min(1, (W * 0.6) / (sz.w || 1), (H * 0.6) / (sz.h || 1));
    const w = Math.round((sz.w || 400) * k), hh = Math.round((sz.h || 300) * k);
    const m = M.addMedia(this.deck, { bytes, mime, name, w: sz.w, h: sz.h });
    const r = M.addElement(m.deck, this.slide.id, { type: "image", media: m.id, x: Math.round(at ? at.x - w / 2 : (W - w) / 2), y: Math.round(at ? at.y - hh / 2 : (H - hh) / 2), w, h: hh });
    this.commit("Insert Picture", r.deck);
    this.select([r.id]);
  }

  // ------------------------------------------------------------------ formatting helpers used by commands

  /** Applies a patch to the selection, or to every text element of the slide when nothing is selected. */
  format(patch, label = "Format") {
    const ids = this.sel.size ? [...this.sel] : patch.style ? this.slide.elements.filter((e) => e.style).map((e) => e.id) : [];
    if (!ids.length) return;
    if (this.editing) this.finishEditing();
    this.commit(label, M.updateElements(this.deck, this.slide.id, ids, patch));
  }
  toggleStyle(key, label) {
    const first = this.selected.find((e) => e.style);
    if (!first) return;
    this.format({ style: { [key]: !first.style[key] } }, label);
  }

  setSorter(on = this.mode !== "sorter") {
    this.finishEditing();
    this.mode = on ? "sorter" : "normal";
    this.split.el.hidden = on;
    this.sorter.hidden = !on;
    this.refresh();
    (on ? this.sorter : this.stage).focus();
  }

  // ------------------------------------------------------------------ suite contract

  activate() {
    this.refresh();
    requestAnimationFrame(() => this.fit());
  }
  deactivate() {
    this.finishEditing();
  }
  destroy() {
    this.offChange?.();
    this.ro?.disconnect();
    this.ribbon.destroy?.();
    this.urls.dispose();
    this.el.remove();
  }

  commentAnchor() {
    const s = this.slide;
    const e = this.selected[0];
    if (e) return officeItemAnchor({ item: `obj:${s.id}/${e.id}`, label: (e.text || (e.type === "image" ? t("Picture") : e.type)).slice(0, 80) });
    return officeItemAnchor({ item: `slide:${s.id}`, label: M.slideTitle(s) || t("Slide {n}", { n: M.slideIndex(this.deck, s.id) + 1 }) });
  }

  revealAnchor(a) {
    const m = /^(?:slide:|obj:)([^/]+)(?:\/(.+))?$/.exec(a?.item || "");
    if (!m || !M.slideById(this.deck, m[1])) return;
    if (this.mode === "sorter") this.setSorter(false);
    this.goTo(m[1]);
    if (m[2] && this.slide.elements.some((e) => e.id === m[2])) this.select([m[2]]);
  }

  exportDialog() {
    const sel = h("select.of-oinput", { "aria-label": t("Format") }, EXPORT_ITEMS.map((f) => h("option", { value: f.value }, t(f.label))));
    const hint = h("p.of-hint", t("The OpenFini document (.ofini, File ▸ Save) keeps everything; exports are copies in other formats. Hidden slides are left out of PDF and PNG."));
    openDialog({
      title: t("Export presentation"),
      body: h("div.of-oform", h("label.of-ofield", h("span", t("Format")), sel), hint),
      width: 480,
      buttons: [
        { label: t("Cancel"), onClick: (c) => c() },
        { label: t("Export…"), variant: "primary", onClick: (c) => (c(), this.exportAs(sel.value).catch((e) => this.app.toast(e.message, "danger", 6000))) },
      ],
    });
  }

  async exportAs(format) {
    if (format !== "png1") return (await import("../services/export.js")).exportOfficeDoc(this.app, this.doc, format);
    const [{ slideToPng }, { platform }] = await Promise.all([import("./render.js"), import("../../platform/index.js")]);
    const bytes = await slideToPng(M.pruneMedia(this.deck), this.slide);
    const n = M.slideIndex(this.deck, this.slide.id) + 1;
    const base = String(this.doc.name || "Presentation").replace(/\.[a-z0-9]{2,5}$/i, "");
    const res = await platform.saveFile({ suggestedName: `${base}-${n}.png`, bytes, mime: "image/png", filters: [{ name: "PNG", extensions: ["png"] }] });
    if (res) this.app.toast(t("Exported {name}.", { name: res.name }), "success");
  }

  async present({ fromCurrent = false, presenter = false } = {}) {
    this.finishEditing();
    const { startShow } = await import("./present.js");
    const visible = this.deck.slides.filter((s) => !s.hidden);
    if (!visible.length) return this.app.toast(t("Every slide is hidden; show at least one slide to present."), "warning");
    const start = fromCurrent && !this.slide.hidden ? this.slide.id : visible[0].id;
    startShow(this, { start, presenter });
  }
}
