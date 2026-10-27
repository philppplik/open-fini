// Two-way sync between the preview and the code editor of the Code studio.
//
//   preview -> code   the selected element's start tag keeps a subtle line highlight in the editor (and the editor scrolls
//                     to it on selection, see Workspace#selectElement); hovering an element highlights its lines lightly.
//   code -> preview   the caret in the page's HTML selects the element (Workspace#onCursor); hovering a line of the page's
//                     HTML outlines the element in the preview; the caret inside a CSS rule outlines every element that
//                     rule matches (bridge "matchSel") and shows "N elements".
//   breadcrumb bar    html > body > section.hero > h1: click selects (and shows the code), hover outlines in the preview.
//                     For the selection it also lists the rules that apply, each jumping to its place in the CSS.
//
// Public API: syncHighlight (CodeMirror extension, add to every file's state), SyncController (one per workspace).
// Invariants: everything is cheap (debounced, capped) and off when the preference `codeSyncHighlight` is false.
import * as CM from "../../../vendor/codemirror/codemirror.js";
import { h, empty } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import * as E from "../../engine/web/index.js";

const setRanges = CM.StateEffect.define();

const selLine = CM.Decoration.line({ class: "of-sync-sel" });
const hoverLine = CM.Decoration.line({ class: "of-sync-hover" });

/** CodeMirror extension: line highlights for the selected (`sel`) and hovered (`hover`) element, set with `setSyncRanges`. */
export const syncHighlight = CM.StateField.define({
  create: () => ({ sel: null, hover: null, deco: CM.Decoration.none }),
  update(v, tr) {
    let { sel, hover } = v;
    let changed = false;
    for (const e of tr.effects) {
      if (e.is(setRanges)) {
        sel = e.value.sel;
        hover = e.value.hover;
        changed = true;
      }
    }
    if (!changed && !tr.docChanged) return v;
    if (tr.docChanged && !changed) {
      sel = sel && { from: tr.changes.mapPos(sel.from), to: tr.changes.mapPos(sel.to) };
      hover = hover && { from: tr.changes.mapPos(hover.from), to: tr.changes.mapPos(hover.to) };
    }
    const len = tr.state.doc.length;
    const b = new CM.RangeSetBuilder();
    const items = [];
    for (const [r, deco] of [[sel, selLine], [hover, hoverLine]]) {
      if (!r || r.from > len) continue;
      const first = tr.state.doc.lineAt(Math.min(r.from, len)).number;
      const last = tr.state.doc.lineAt(Math.min(r.to, len)).number;
      for (let n = first; n <= Math.min(last, first + 60); n++) items.push([tr.state.doc.line(n).from, n, deco]);
    }
    items.sort((x, y) => x[0] - y[0] || (x[2] === selLine ? -1 : 1));
    let prev = -1;
    for (const [from, , deco] of items) {
      if (from === prev) continue; // one decoration per line: the selection wins over the hover
      b.add(from, from, deco);
      prev = from;
    }
    return { sel, hover, deco: b.finish() };
  },
  provide: (f) => CM.EditorView.decorations.from(f, (v) => v.deco),
});

export function setSyncRanges(view, sel, hover) {
  if (view) view.dispatch({ effects: setRanges.of({ sel: sel || null, hover: hover || null }) });
}

const debounce = (fn, ms) => {
  let id = 0;
  const f = (...a) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...a), ms);
  };
  f.cancel = () => clearTimeout(id);
  return f;
};

export class SyncController {
  /** @param {import("./workspace.js").Workspace} ws */
  constructor(ws) {
    this.ws = ws;
    this.sel = null; // { from, to } of the selected element's start tag in the page source
    this.hover = null;
    this.match = null; // { selector, count } of the CSS rule at the caret
    this.rules = [];
    this.bar = h("div.of-crumbs.hidden", { role: "navigation", "aria-label": t("Element path") });
    ws.editors.el.insertBefore(this.bar, ws.editors.host);
    const off = [];
    const refresh = debounce(() => this.refresh(), 30);
    off.push(ws.on("selection", refresh));
    off.push(ws.on("project", debounce(() => this.refresh(), 150)));
    off.push(ws.editors.on("active", () => {
      this.refresh();
      this.caret();
    }));
    off.push(ws.on("hover", (id) => this.#hover(id)));
    off.push(ws.editors.on("cursor", debounce(() => this.caret(), 120)));
    off.push(ws.preview.on("matchCount", (m) => {
      this.match = m;
      this.render();
    }));
    off.push(ws.preview.on("swap", () => this.caret()));
    off.push(ws.app.on("prefs", () => this.refresh()));
    // editor hover -> outline in the preview (only the page's HTML; throttled, the frame is only told on change)
    const host = ws.editors.host;
    this.lastHoverId = null;
    const move = debounce((e) => this.#editorHover(e), 60);
    host.addEventListener("mousemove", move);
    host.addEventListener("mouseleave", () => {
      move.cancel?.();
      this.#setPreviewHover(null);
    });
    this.destroy = () => {
      off.forEach((f) => f?.());
      host.removeEventListener("mousemove", move);
      this.bar.remove();
    };
  }

  get on() {
    return this.ws.app.prefs.codeSyncHighlight !== false;
  }

  #page() {
    const ws = this.ws;
    const p = ws.editors.active;
    return p && p === ws.page ? p : null;
  }

  /** Re-computes the selected element's range, the breadcrumb and the applying rules. */
  refresh() {
    const ws = this.ws;
    const cur = ws.selection ? ws.current() : null;
    this.sel = null;
    this.rules = [];
    if (cur && this.on) {
      const src = ws.web.text(cur.file) || "";
      this.sel = { file: cur.file, ...E.openTagLines(src, cur.el) };
      const files = ws.web.paths.filter((p) => /\.css$/i.test(p)).map((p) => ({ file: p, parsed: ws.model.css(p) }));
      // universal resets (`*, *::before`) apply to everything and only add noise
      this.rules = E.rulesForElement(files, cur.el).filter((r) => !r.selector.startsWith("*")).slice(0, 12);
    }
    this.#apply();
    this.render();
  }

  #apply() {
    const view = this.ws.editors.view;
    if (!view) return;
    const active = this.ws.editors.active;
    const sel = this.on && this.sel && this.sel.file === active ? this.sel : null;
    const hv = this.on && this.hover && this.hover.file === active ? this.hover : null;
    setSyncRanges(view, sel, hv);
  }

  #hover(id) {
    const ws = this.ws;
    this.hover = null;
    if (id != null && this.on) {
      const parsed = ws.page ? ws.model.html(ws.page) : null;
      const el = parsed?.elements[id];
      if (el) this.hover = { file: ws.page, ...E.openTagLines(ws.web.text(ws.page) || "", el) };
    }
    this.#apply();
  }

  #setPreviewHover(id) {
    if (id === this.lastHoverId) return;
    this.lastHoverId = id;
    this.ws.preview.hover(id);
    this.#hover(id);
  }

  #editorHover(e) {
    const ws = this.ws;
    const view = ws.editors.view;
    if (!this.on || !view || !this.#page() || ws.view === "code") return this.#setPreviewHover(null);
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const parsed = pos == null ? null : ws.model.html(ws.page);
    const el = parsed ? E.elementAtOffset(parsed, pos) : null;
    this.#setPreviewHover(el ? el.id : null);
  }

  /** The caret in a stylesheet outlines the elements its rule matches in the preview. */
  caret() {
    const ws = this.ws;
    const c = ws.editors.cursorInfo();
    let selector = null;
    if (this.on && c && /\.css$/i.test(c.path) && ws.view !== "code") {
      const rule = E.cssRuleAt(ws.model.css(c.path), c.head);
      selector = rule ? E.matchableSelector(rule.selector) : null;
      this.cssRule = rule ? { file: c.path, selector: rule.selector.replace(/\s+/g, " ").trim() } : null;
    } else this.cssRule = null;
    if (selector !== (ws.preview.matchSel || null)) {
      this.match = null;
      ws.preview.matchSelector(selector);
    }
    this.render();
  }

  render() {
    const ws = this.ws;
    empty(this.bar);
    const cur = ws.selection ? ws.current() : null;
    const showCss = this.cssRule && this.on;
    if (!this.on || (!cur && !showCss)) {
      this.bar.classList.add("hidden");
      return;
    }
    this.bar.classList.remove("hidden");
    if (showCss) {
      this.bar.append(h("span.of-crumbs__rule", { title: this.cssRule.selector }, this.cssRule.selector));
      const m = this.match;
      if (m && m.selector) {
        const text = m.count < 0 ? t("not matchable in the preview") : m.count === 1 ? t("1 element") : t("{n} elements", { n: m.count });
        this.bar.append(h("span.of-crumbs__count", { role: "status" }, text));
      }
      return;
    }
    const trail = h("span.of-crumbs__trail");
    E.crumbsOf(cur.el).forEach((c, i, all) => {
      if (i) trail.append(h("span.of-crumbs__sep", { "aria-hidden": "true" }, "›"));
      const b = h("button.of-crumbs__item", { type: "button", "aria-current": i === all.length - 1 ? "true" : null, title: t("Select {name}", { name: c.label }) }, c.label);
      b.addEventListener("click", () => ws.selectElement(c.id, { scroll: true, reveal: true }));
      b.addEventListener("mouseenter", () => ws.preview.hover(c.id));
      b.addEventListener("mouseleave", () => ws.preview.hover(null));
      trail.append(b);
    });
    this.bar.append(trail);
    if (this.rules.length) {
      const list = h("span.of-crumbs__rules", h("span.of-crumbs__label", t("Rules")));
      for (const r of this.rules) {
        const b = h("button.of-crumbs__chip", { type: "button", title: `${r.file}${r.media ? ` · @media ${r.media}` : ""}` }, r.selector.length > 28 ? r.selector.slice(0, 27) + "…" : r.selector);
        b.addEventListener("click", () => ws.openFile(r.file, { focus: true, from: r.start, to: r.end, keepPage: true }));
        list.append(b);
      }
      this.bar.append(list);
    }
  }
}
