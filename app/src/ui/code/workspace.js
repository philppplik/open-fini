// The Code studio workspace of one document: file explorer, code editor, live preview with a visual designer,
// outline, element palette, search, assets and the console. This module owns the state that the parts share
// (selected element, style target, undo of visual operations) and every operation that changes the project.
import { Emitter, h, empty, debounce } from "../../core/util.js";
import { ensureWeb } from "../../core/web.js";
import * as E from "../../engine/web/index.js";
import { t } from "../../i18n/index.js";
import { createModel } from "./model.js";
import { CodeEditors } from "./editor.js";
import { PreviewPane } from "./preview.js";
import { createExplorer } from "./explorer.js";
import { createOutline } from "./outline.js";
import { createElementsPanel } from "./elements-panel.js";
import { createSearchPanel } from "./search.js";
import { createAssetsPanel } from "./assets.js";
import { createBottomPanel } from "./bottom.js";
import { createToolbar } from "./toolbar.js";
import { createStart } from "./start.js";
import { showContextMenu } from "../menus.js";
import { openContextMenu } from "../context-menu/index.js";
import { promptDialog, confirmDialog } from "../dialogs.js";
import { iconEl } from "../toolbox.js";
import { openCommandPalette } from "./palette.js";
import { updateReferences } from "./refs.js";
import { importInto } from "./import.js";
import { gitServiceFor } from "./git-service.js";
import { gitGutter, refreshGutter } from "./git-gutter.js";
import { platform } from "../../platform/index.js";
import { DocPreview, docKind } from "./docpreview.js";
import { createDocTools } from "./doctools.js";

const workspaces = new WeakMap();

/** The workspace of a document (created on first use; shows the start screen until the document has a project). */
export function workspaceFor(app, doc) {
  let ws = workspaces.get(doc);
  if (!ws) {
    ws = new CodeWorkspace(app, doc);
    workspaces.set(doc, ws);
  }
  return ws;
}
export function disposeWorkspace(doc) {
  const ws = workspaces.get(doc);
  ws?.dispose();
  workspaces.delete(doc);
}

const CONTAINER_TAGS = new Set(["div", "section", "header", "footer", "main", "nav", "article", "aside", "ul", "ol", "form", "body", "figure", "details", "fieldset", "dl", "blockquote", "li", "td", "th", "label", "button", "a", "span"]);
const ACTIVITY = [
  { id: "explorer", icon: "files", label: "Explorer", shortcut: "" },
  { id: "add", icon: "plus-square", label: "Add elements", shortcut: "" },
  { id: "outline", icon: "diagram-3", label: "Navigator", shortcut: "" },
  { id: "search", icon: "search", label: "Search (Ctrl+Shift+F)", shortcut: "" },
  { id: "git", icon: "signpost-split", label: "Source Control", shortcut: "" },
  { id: "assets", icon: "images", label: "Assets", shortcut: "" },
  { id: "libs", icon: "stack", label: "Libraries", shortcut: "" },
];

export class CodeWorkspace extends Emitter {
  constructor(app, doc) {
    super();
    this.app = app;
    this.doc = doc;
    this.web = doc.web;
    this.selection = null; // { file, id, path }
    this.hoverId = null;
    this.view = "split";
    this.sideTab = "explorer";
    this.sideOpen = true;
    this.consoleLines = [];
    this.opStack = []; // visual operations: { files: [path] }
    this.redoStack = [];
    this.clip = null;
    this.styleSelector = null; // chosen selector in the style panel (".hero") or "" for inline
    this.side = h("div.of-codeside");
    this.main = h("div.of-codemain");
    this.toolbar = h("div.of-codebar");
    this.built = false;
    if (this.web) this.#build();
    else this.#buildStart();
  }

  // ------------------------------------------------------------ construction

  #buildStart() {
    empty(this.side);
    empty(this.main);
    empty(this.toolbar);
    this.side.append(h("div.of-side__pane", h("div.of-side__head", h("span.of-side__title", "Code studio")), h("div.of-empty", "No website project in this document yet.")));
    this.main.append(createStart(this));
    this.toolbar.append(h("span.of-codebar__hint", "Website projects live inside your document next to the design."));
    this.emit("built");
  }

  /** Creates the project in this document from { path: text } files and builds the workbench. */
  createProject(files, { name } = {}) {
    ensureWeb(this.doc, files);
    this.web = this.doc.web;
    this.doc.saved = false;
    if (name && /^untitled/i.test(this.doc.name)) this.doc.name = name;
    this.#build();
    this.app.emit("docchange", {});
    this.app.emit("contextbar");
    const entry = this.web.entry;
    this.editors.openFile(entry);
    this.preview.showPage(entry);
    this.app.emit("codeui", this);
  }

  #build() {
    const web = this.web;
    this.built = true;
    this.model = createModel(web);
    this.view = web.settings.view || "split";
    this.editors = new CodeEditors({ app: this.app, web, model: this.model, keys: this.#editorKeys() });
    // Source Control: the service is cheap; the engine and the panel load when a repository exists or the pane opens
    this.git = gitServiceFor(this.app, web);
    this.editors.extraExtensions = (path) => gitGutter(path, (p) => this.git.baseText(p));
    this.git.on("change", () => this.editors.view?.dispatch({ effects: refreshGutter.of(null) }));
    if (this.git.exists) this.git.refresh();
    const gitEl = h("div.of-side__pane.of-gitpane");
    let gitMounted = false;
    this.gitPane = { el: gitEl, show: () => !gitMounted && ((gitMounted = true), import("./git-panel.js").then((m) => m.mountGit(this, gitEl))) };
    this.preview = new PreviewPane(this);
    // Markdown / LaTeX / BibTeX files get a document preview instead of the canvas (docpreview.js)
    this.docPreview = new DocPreview(this);
    const libsEl = h("div.of-side__pane.of-libspane");
    let libsMounted = false;
    this.libsPane = { el: libsEl, show: () => !libsMounted && ((libsMounted = true), import("./libraries-ui.js").then((m) => m.mountLibraries(this, libsEl))) };
    this.explorer = createExplorer(this);
    this.outline = createOutline(this);
    this.elementsPanel = createElementsPanel(this);
    this.searchPanel = createSearchPanel(this);
    this.assetsPanel = createAssetsPanel(this);
    this.bottom = createBottomPanel(this);
    this.toolbarApi = createToolbar(this);

    // ---- sidebar: activity bar + active pane
    this.activity = h("div.of-activity", { role: "tablist", "aria-label": "Sidebar", "aria-orientation": "vertical" });
    this.paneHost = h("div.of-side__panes");
    this.panes = { explorer: this.explorer, add: this.elementsPanel, outline: this.outline, search: this.searchPanel, git: this.gitPane, assets: this.assetsPanel, libs: this.libsPane };
    empty(this.side);
    this.side.append(this.activity, this.paneHost);
    this.#renderSide();

    // ---- workbench: editor | preview, bottom panel
    this.splitEl = h(
      "div.of-split",
      h("div.of-split__code", this.editors.el),
      h("div.of-split__bar", { role: "separator", tabIndex: 0, "aria-orientation": "vertical", title: t("Drag to resize, double-click to reset, arrow keys to adjust"), "aria-label": t("Resize code and preview"), "aria-valuemin": "10", "aria-valuemax": "90" }),
      h("div.of-split__preview", this.preview.el, this.docPreview.el),
    );
    this.#wireSplitter();
    empty(this.main);
    this.main.append(this.splitEl, this.bottom.el);
    empty(this.toolbar);
    this.toolbar.append(this.toolbarApi.el);
    this.setView(this.view, { silent: true });

    // ---- reactions
    this.web.on("text", () => this.#onText());
    // Markdown sites (content/ + layouts/): regenerate the HTML pages when a source file changes
    this.web.on("text", ({ path, origin }) => origin !== "api" && /^(content|layouts)\/|^site\.json$/.test(path) && import("./mdsite.js").then((m) => m.scheduleBuild(this)));
    this.web.on("tree", () => this.#onText());
    this.editors.on("cursor", (c) => this.#onCursor(c));
    this.on("cursor", () => this.app.emit("codestatus"));
    this.preview.on("breakpoint", () => this.app.emit("codestatus"));
    this.editors.on("active", () => {
      this.#syncDocMode();
      this.emit("active");
    });
    createDocTools(this);
    this.model.web.on("tree", () => this.emit("files"));
    this.preview.on("swap", () => this.emit("swap"));

    this.editors.restore();
    if (!this.editors.active) {
      const entry = web.entry;
      if (web.has(entry)) this.editors.openFile(entry);
    }
    this.preview.rebuild();
    this.preview.layout();
    if (web.settings.kind === "document") this.sideOpen = false; // a single opened file: editor and preview only
    this.#renderSide();
    this.#syncDocMode();
    this.preview.on("built", () => this.problemsSoon());
    this.computeProblems();
    this.emit("built");
  }

  /** Shows the document preview (Markdown, LaTeX, BibTeX) instead of the canvas while such a file is active. */
  #syncDocMode() {
    const path = this.editors.active;
    const kind = docKind(path);
    const doc = !!kind;
    this.main.toggleAttribute("data-doc", doc);
    this.toolbar.toggleAttribute("data-doc", doc);
    // a one-file text project without a preview (JSON, YAML …): the editor takes the whole width
    this.main.toggleAttribute("data-solo", !doc && this.web.settings.kind === "document");
    this.preview.el.classList.toggle("hidden", doc);
    if (doc) this.docPreview.show(path);
    else this.docPreview.hide();
    if (!doc) requestAnimationFrame(() => this.preview.layout());
    this.emit("docmode", { path, kind });
  }
  get documentKind() {
    return docKind(this.editors?.active);
  }

  #renderSide() {
    empty(this.activity);
    for (const a of ACTIVITY) {
      const b = h("button.of-activity__btn", { type: "button", role: "tab", class: a.id === this.sideTab && this.sideOpen ? "active" : "", "aria-selected": String(a.id === this.sideTab && this.sideOpen), "data-tip": a.label, "data-tip-pos": "right", "aria-label": a.label }, iconEl(a.icon));
      b.addEventListener("click", () => (a.id === this.sideTab && this.sideOpen ? this.toggleSidebar(false) : this.showSide(a.id)));
      this.activity.append(b);
    }
    this.activity.append(h("span.of-activity__spacer"));
    const settings = h("button.of-activity__btn", { type: "button", "data-tip": "Editor settings", "data-tip-pos": "right", "aria-label": "Editor settings" }, iconEl("gear"));
    settings.addEventListener("click", (e) => {
      const r = settings.getBoundingClientRect();
      showContextMenu(this.app, r.right + 6, r.top - 120, [
        { label: "Word wrap", icon: "text-wrap", checked: !!this.web.settings.wordWrap, run: () => this.editors.setWordWrap(!this.web.settings.wordWrap) },
        { label: `Tab size: ${this.web.settings.tabSize || 2}`, icon: "indent", run: () => this.cycleTabSize() },
        { label: "Spacing guides on canvas", icon: "bounding-box-circles", checked: this.spacingGuides !== false, run: () => this.toggleSpacingGuides() },
        "-",
        { label: "Command palette", icon: "terminal", run: () => this.palette() },
      ]);
      e.stopPropagation();
    });
    this.activity.append(settings);
    empty(this.paneHost);
    this.paneHost.append(this.panes[this.sideTab].el);
    this.panes[this.sideTab].show?.();
    this.side.classList.toggle("collapsed", !this.sideOpen);
  }

  showSide(tab) {
    if (!this.built) return;
    this.sideTab = tab;
    this.sideOpen = true;
    this.#renderSide();
    this.emit("side", tab);
    if (tab === "search") this.searchPanel.focus?.();
  }
  toggleSidebar(force) {
    this.sideOpen = force ?? !this.sideOpen;
    this.#renderSide();
  }

  /**
   * Split arrangement. The code pane is always the first DOM child; CSS reverses the flex direction for "codeRight" and
   * "codeBottom". The choice is "auto" (code left, stacked on top below 900 px) or one of E.LAYOUTS, stored per project
   * (web.settings.layout) and as the default for new projects (pref codeLayout). The ratio is the share of the code pane,
   * remembered separately for side-by-side (splitH) and stacked (splitV) arrangements.
   */
  get layoutChoice() {
    const c = this.web.settings.layout || this.app.prefs.codeLayout;
    return E.LAYOUTS.includes(c) ? c : "auto";
  }
  /** The arrangement currently shown (auto resolved against the available width). */
  get layout() {
    return this.splitEl?.dataset.layout || "codeLeft";
  }
  setLayout(choice) {
    const c = E.LAYOUTS.includes(choice) ? choice : "auto";
    this.web.settings.layout = c === "auto" ? null : c;
    this.app.setPref("codeLayout", c);
    if (this.view !== "split") this.setView("split");
    this.#applyLayout();
    this.emit("layout", this.layout);
  }
  #splitKey(layout = this.layout) {
    return E.isStacked(layout) ? "splitV" : "splitH";
  }
  #splitTotal() {
    return E.isStacked(this.layout) ? this.splitEl.clientHeight : this.splitEl.clientWidth;
  }
  splitRatio() {
    const st = this.web.settings;
    const key = this.#splitKey();
    return E.clampRatio(st[key] ?? (key === "splitH" ? st.split : undefined) ?? 0.5, this.#splitTotal(), 240);
  }
  #applyLayout() {
    if (!this.splitEl) return;
    const l = E.resolveLayout(this.layoutChoice, this.splitEl.clientWidth);
    const changed = this.splitEl.dataset.layout !== l;
    this.splitEl.dataset.layout = l;
    this.splitEl.classList.toggle("vertical", E.isStacked(l));
    const bar = this.splitEl.querySelector(".of-split__bar");
    bar.setAttribute("aria-orientation", E.isStacked(l) ? "horizontal" : "vertical");
    const r = this.splitRatio();
    this.splitEl.style.setProperty("--split", String(r));
    bar.setAttribute("aria-valuenow", String(Math.round(r * 100)));
    if (changed) {
      this.emit("layout", l);
      requestAnimationFrame(() => {
        this.preview?.layout();
        this.editors?.view?.requestMeasure();
      });
    }
  }
  #setRatio(r) {
    this.web.settings[this.#splitKey()] = +E.clampRatio(r, this.#splitTotal(), 240).toFixed(4);
    this.#applyLayout();
  }
  #wireSplitter() {
    const bar = this.splitEl.querySelector(".of-split__bar");
    const relayout = () => {
      this.preview.layout();
      this.editors.view?.requestMeasure();
    };
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const r = this.splitEl.getBoundingClientRect();
        const stacked = E.isStacked(this.layout);
        const total = stacked ? r.height : r.width;
        this.#setRatio(E.ratioFromPointer(this.layout, stacked ? ev.clientY - r.top : ev.clientX - r.left, total));
      };
      const up = () => {
        bar.removeEventListener("pointermove", mv);
        bar.removeEventListener("pointerup", up);
        bar.removeEventListener("pointercancel", up);
        relayout();
      };
      bar.addEventListener("pointermove", mv);
      bar.addEventListener("pointerup", up);
      bar.addEventListener("pointercancel", up);
    });
    bar.addEventListener("dblclick", () => {
      this.#setRatio(0.5);
      relayout();
    });
    bar.addEventListener("keydown", (e) => {
      const next = E.stepRatio(this.splitRatio(), e.key, this.layout, e.shiftKey);
      if (next == null) return;
      e.preventDefault();
      this.#setRatio(next);
      relayout();
    });
    new ResizeObserver(() => this.#applyLayout()).observe(this.splitEl);
    this.#applyLayout();
  }

  // ------------------------------------------------------------ view / layout

  setView(view, { silent = false } = {}) {
    this.view = view;
    this.web.settings.view = view;
    this.splitEl?.setAttribute("data-view", view);
    this.main.setAttribute("data-view", view);
    this.preview?.layout();
    if (!silent) {
      this.emit("view", view);
      if (view !== "design") this.#revealSelection();
    }
  }

  toggleSpacingGuides() {
    this.spacingGuides = this.spacingGuides === false;
    this.preview.setSpacingGuides(this.spacingGuides);
  }
  cycleTabSize() {
    const next = { 2: 4, 4: 8, 8: 2 }[this.web.settings.tabSize || 2] || 2;
    this.web.settings.tabSize = next;
    this.app.setPref("codeTabSize", next);
    this.app.toast(`Tab size is now ${next} for new editor tabs.`, "primary", 1800);
  }

  // ------------------------------------------------------------ files

  openFile(path, opts = {}) {
    if (!this.web.has(path)) return;
    if (this.view === "design") this.setView("split");
    this.editors.openFile(path, opts);
    this.explorer.reveal(path);
    if (/\.html?$/i.test(path) && path !== this.preview.page && !opts.keepPage) this.preview.showPage(path);
  }
  showPage(path) {
    this.preview.showPage(path);
    this.selection = null;
    this.emit("selection", null);
    this.emit("page", path);
  }
  get page() {
    return this.preview.page;
  }
  navigatePreview(href) {
    const ref = E.resolveRef(this.page, href);
    if (!ref) return;
    const target = this.web.has(ref.path) ? ref.path : this.web.has(`${ref.path}.html`) ? `${ref.path}.html` : null;
    if (target && /\.html?$/i.test(target)) this.showPage(target);
    else this.app.toast(`“${href}” is not a page in this project.`, "warning", 2400);
  }
  openExternal(href) {
    // only web links, mail and phone links leave the app; anything else is ignored
    if (!/^(https?:|mailto:|tel:)/i.test(href) && !href.startsWith("//")) return;
    import("../links.js").then((m) => m.openLink(href, { app: this.app })); // honors "ask before opening links"
  }
  afterRename(pairs) {
    try {
      const n = updateReferences(this, pairs);
      if (n) this.app.toast(`Updated ${n} reference${n === 1 ? "" : "s"} to the renamed file.`, "success", 2400);
    } catch (err) {
      console.error(err);
    }
  }
  afterImport() {
    this.preview.rebuild();
  }

  // ------------------------------------------------------------ selection

  /** The selected element in the latest parse: { parsed, el, file } or null. */
  current() {
    const sel = this.selection;
    if (!sel) return null;
    const parsed = this.model.html(sel.file);
    if (!parsed) return null;
    let el = parsed.elements[sel.id];
    if (!el || E.elementPath(el).join(",") !== sel.path.join(",")) {
      el = E.elementAtPath(parsed, sel.path);
      if (!el) {
        this.selection = null;
        return null;
      }
      sel.id = el.id;
    }
    return { parsed, el, file: sel.file };
  }

  selectElement(id, { reveal = true, scroll = false, source = "ui" } = {}) {
    const file = this.page;
    const parsed = file ? this.model.html(file) : null;
    const el = id != null ? parsed?.elements[id] : null;
    this.selection = el ? { file, id: el.id, path: E.elementPath(el) } : null;
    this.styleSelector = null; // re-derived by the style panel
    this.preview.selectionChanged();
    if (scroll && el) this.preview.reveal(el.id);
    this.emit("selection", this.selection);
    if (el && reveal && this.view !== "design" && source !== "code") this.#revealSelection();
  }
  #revealSelection() {
    const cur = this.current();
    if (!cur) return;
    const a = this.editors.active;
    if (a === cur.file || !a || /\.html?$/i.test(a)) this.editors.openFile(cur.file, { from: cur.el.open.start, to: cur.el.open.end });
  }
  revealInCode(id) {
    this.selectElement(id, { reveal: false });
    if (this.view === "design") this.setView("split");
    const cur = this.current();
    if (cur) this.editors.openFile(cur.file, { focus: true, from: cur.el.open.start, to: cur.el.open.end });
  }
  pickFromPreview(id, { shift, alt } = {}) {
    if (alt) {
      // Alt+click selects the parent
      const parsed = this.model.html(this.page);
      const parent = parsed?.elements[id]?.parent;
      if (parent) id = parent.id;
    }
    this.selectElement(id, { reveal: true });
  }
  setHover(id) {
    this.hoverId = id;
    this.emit("hover", id);
  }
  selectParent() {
    const cur = this.current();
    if (cur?.el.parent) this.selectElement(cur.el.parent.id, { scroll: true });
  }
  selectChild() {
    const cur = this.current();
    const kid = cur?.el.children.find((c) => c.type === "element");
    if (kid) this.selectElement(kid.id, { scroll: true });
  }
  selectSibling(dir) {
    const cur = this.current();
    if (!cur) return;
    const sibs = (cur.el.parent ? cur.el.parent.children : cur.parsed.children).filter((c) => c.type === "element");
    const i = sibs.indexOf(cur.el);
    const next = sibs[i + dir];
    if (next) this.selectElement(next.id, { scroll: true });
  }

  #onCursor(c) {
    this.emit("cursor", c);
    // moving the caret in the page's HTML selects the element under it (not while typing)
    if (c && c.path === this.page && this.editors.hasFocus() && this.#lastDocRev === this.web.rev) {
      const parsed = this.model.html(c.path);
      const el = parsed ? E.elementAtOffset(parsed, c.head) : null;
      if (el && el.id !== this.selection?.id) this.selectElement(el.id, { reveal: false, scroll: true, source: "code" });
    }
    this.#lastDocRev = this.web.rev;
  }
  #lastDocRev = -1;

  #onText() {
    // keep the selection attached to the same element across edits
    if (this.selection) this.current();
    this.problemsSoon();
    this.emit("project");
  }
  problemsSoon = debounce(() => this.computeProblems(), 600);
  _problems = [];

  /** Re-collects parser/syntax problems of every file and missing references found while building the preview. */
  computeProblems() {
    const out = this.editors.allProblems();
    for (const d of this.preview.last?.diagnostics || []) if (this.web.has(d.file)) out.push({ ...d, path: d.file });
    const rank = { error: 0, warning: 1, info: 2 };
    out.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || a.path.localeCompare(b.path) || a.start - b.start);
    this._problems = out;
    this.emit("problems");
  }
  problemCount() {
    return this._problems.filter((p) => p.severity !== "info").length;
  }

  // ------------------------------------------------------------ visual edits

  #record(files) {
    this.opStack.push({ files: [...new Set(files)] });
    if (this.opStack.length > 200) this.opStack.shift();
    this.redoStack.length = 0;
  }

  /**
   * Runs an edit on the selected element (or the element `id`). `fn(parsed, el)` returns Change[] or { changes, at }.
   * `select`: "keep" (default), "new" (select the element at `at`), "none".
   */
  editElement(fn, { id = null, select = "keep", label } = {}) {
    const file = this.page;
    const parsed = this.model.html(file);
    if (!parsed) return false;
    const el = id != null ? parsed.elements[id] : this.current()?.el;
    if (!el && id != null) return false;
    let out;
    try {
      out = fn(parsed, el);
    } catch (err) {
      this.app.toast(err.message, "warning", 3200); // e.g. an edit that would produce invalid HTML
      return false;
    }
    const changes = Array.isArray(out) ? out : out?.changes;
    if (!changes?.length) return false;
    this.#record([file]);
    this.editors.applyChanges(file, changes);
    const at = Array.isArray(out) ? null : out?.at;
    if (select === "new" && at != null) {
      const np = this.model.html(file);
      const ne = np ? E.elementAtOffset(np, at) : null;
      if (ne) this.selectElement(ne.id, { reveal: true, scroll: true });
    } else if (select === "none") this.selectElement(null);
    return true;
  }

  setAttribute(name, value) {
    return this.editElement((p, el) => E.setAttribute(p, el.id, name, value));
  }
  setClasses(classes) {
    return this.editElement((p, el) => E.setClasses(p, el.id, classes));
  }
  setTag(tag) {
    return this.editElement((p, el) => E.setTag(p, el.id, tag));
  }

  /** Page-level settings of the page shown in the preview: title, description and language. */
  pageMeta() {
    const parsed = this.page ? this.model.html(this.page) : null;
    if (!parsed) return null;
    const title = E.findByTag(parsed, "title");
    const html = E.findByTag(parsed, "html");
    const desc = parsed.elements.find((e) => e.tag === "meta" && (E.getAttr(e, "name") || "").toLowerCase() === "description");
    return { title: title ? E.elementText(parsed, title) : "", description: desc ? E.getAttr(desc, "content") || "" : "", lang: html ? E.getAttr(html, "lang") || "" : "" };
  }
  setPageMeta(patch) {
    if ("title" in patch) {
      this.editElement((p) => {
        const t = E.findByTag(p, "title");
        if (t) return E.setText(p, t.id, patch.title);
        const head = E.findByTag(p, "head");
        return head ? E.insertHtml(p, head.id, 0, `<title>${E.escapeText(patch.title)}</title>`) : null;
      });
    }
    if ("description" in patch) {
      this.editElement((p) => {
        const m = p.elements.find((e) => e.tag === "meta" && (E.getAttr(e, "name") || "").toLowerCase() === "description");
        if (m) return E.setAttribute(p, m.id, "content", patch.description || null);
        const head = E.findByTag(p, "head");
        return head && patch.description ? E.insertHtml(p, head.id, Number.MAX_SAFE_INTEGER, `<meta name="description" content="${E.escapeAttr(patch.description)}">`) : null;
      });
    }
    if ("lang" in patch) {
      this.editElement((p) => {
        const html = E.findByTag(p, "html");
        return html ? E.setAttribute(p, html.id, "lang", patch.lang || null) : null;
      });
    }
  }
  applyTextEdit(id, text, isHtml) {
    this.selectElement(id, { reveal: false });
    this.editElement((p, el) => (isHtml ? E.setInnerHtml(p, el.id, text) : E.setText(p, el.id, text)), { id });
  }

  insertElement(def, parentId, index) {
    const file = this.page;
    if (!file) return false;
    const parsed = this.model.html(file);
    if (parentId === undefined) {
      const t = this.#insertionPoint(parsed);
      parentId = t.parentId;
      index = t.index;
    }
    const cssFile = def.css ? this.ensureStylesheet(file) : null;
    const cssSource = cssFile ? this.web.text(cssFile) : null;
    let plan;
    try {
      plan = E.planInsert(parsed, cssSource, parentId, index ?? Number.MAX_SAFE_INTEGER, def);
    } catch (err) {
      this.app.toast(err.message, "warning", 3200);
      return false;
    }
    const files = [file];
    this.editors.applyChanges(file, plan.html.changes);
    if (cssFile && plan.css?.length) {
      this.editors.applyChanges(cssFile, plan.css);
      files.push(cssFile);
    }
    this.#record(files);
    const np = this.model.html(file);
    const ne = np ? E.elementAtOffset(np, plan.html.at) : null;
    if (ne) this.selectElement(ne.id, { reveal: true, scroll: true });
    return true;
  }
  #insertionPoint(parsed) {
    const cur = this.current();
    if (!cur) return { parentId: null, index: Number.MAX_SAFE_INTEGER };
    const { el } = cur;
    if (CONTAINER_TAGS.has(el.tag) && !el.void) return { parentId: el.id, index: Number.MAX_SAFE_INTEGER };
    const sibs = (el.parent ? el.parent.children : parsed.children).filter((c) => c.type === "element");
    return { parentId: el.parent ? el.parent.id : null, index: sibs.indexOf(el) + 1 };
  }

  moveElement(id, parentId, index) {
    this.editElement((p) => {
      try {
        return E.moveElement(p, id, parentId, index);
      } catch (err) {
        this.app.toast(err.message, "warning", 2400);
        return null;
      }
    }, { select: "new" });
  }
  /** Files dropped onto the canvas: copied to assets/, images are inserted where they were dropped. */
  async dropFiles(files, parentId, index) {
    try {
      const list = [...files].filter((f) => f && typeof f.name === "string");
      if (!list.length) return;
      const entries = list.map((file) => ({ path: E.sanitizeFileName(file.name) || "file", file }));
      const res = await importInto(this.web, entries, { prefix: "assets" });
      for (const e of entries) {
        const path = `assets/${e.path}`;
        if (!this.web.has(path) || !/^image\//.test(e.file.type || E.mimeOf(path))) continue;
        const alt = e.path.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
        this.insertElement({ id: "asset-image", label: "Image", icon: "image", description: "", html: `<img src="${E.relativeRef(this.page, path)}" alt="${alt}" loading="lazy">` }, parentId, index);
        index = parentId === undefined ? index : index + 1;
      }
      this.app.toast(`Added ${res.added + res.replaced} file${res.added + res.replaced === 1 ? "" : "s"} to assets/.`, "success", 1800);
    } catch (err) {
      this.app.toast(err.message, "danger", 5000);
    }
  }
  deleteSelected() {
    const cur = this.current();
    if (!cur || cur.el.tag === "body" || cur.el.tag === "html") return;
    const parent = cur.el.parent;
    const ppath = parent ? E.elementPath(parent) : null;
    this.editElement((p, el) => E.deleteElement(p, el.id));
    if (ppath) {
      const np = this.model.html(this.page);
      const pe = np && E.elementAtPath(np, ppath);
      this.selectElement(pe ? pe.id : null, { reveal: false });
    } else this.selectElement(null);
  }
  duplicateSelected() {
    this.editElement((p, el) => E.duplicateElement(p, el.id), { select: "new" });
  }
  wrapSelected(tag = "div", attrs) {
    this.editElement((p, el) => E.wrapElement(p, el.id, tag, attrs), { select: "new" });
  }
  unwrapSelected() {
    this.editElement((p, el) => E.unwrapElement(p, el.id));
    this.selectElement(null);
  }
  copySelected() {
    const cur = this.current();
    if (!cur) return false;
    this.clip = E.elementSource(cur.parsed, cur.el.id);
    navigator.clipboard?.writeText(this.clip).catch(() => {});
    this.app.toast("Element copied.", "primary", 1200);
    return true;
  }
  cutSelected() {
    if (this.copySelected()) this.deleteSelected();
  }
  async pasteElement() {
    let html = this.clip;
    if (!html) {
      try {
        html = await navigator.clipboard.readText();
      } catch {
        return;
      }
    }
    if (!html || !/^\s*</.test(html)) return;
    const parsed = this.model.html(this.page);
    const t = this.#insertionPoint(parsed);
    this.editElement((p) => E.insertHtml(p, t.parentId, t.index, html), { select: "new" });
  }

  // ------------------------------------------------------------ styles

  /** The stylesheet that should receive new rules for `page`; creates and links one when the page has none. */
  ensureStylesheet(page = this.page) {
    let css = this.model.primaryStylesheet(page);
    if (css) return css;
    css = this.web.has("css/style.css") ? "css/style.css" : (this.web.create("css/style.css", "").path);
    const parsed = this.model.html(page);
    const head = parsed && E.findByTag(parsed, "head");
    if (head) {
      const rel = E.relativeRef(page, css);
      const r = E.insertHtml(parsed, head.id, Number.MAX_SAFE_INTEGER, `<link rel="stylesheet" href="${rel}">`);
      this.editors.applyChanges(page, r.changes);
    }
    return css;
  }

  /** Current style target: { selector, media, file } — selector "" means the element's inline style. */
  styleTarget() {
    const cur = this.current();
    if (!cur) return null;
    const classes = E.classList(cur.el);
    let selector = this.styleSelector;
    if (selector == null) selector = classes.length ? `.${classes[classes.length - 1]}` : "";
    if (selector && !classes.includes(selector.slice(1)) && !/^[.#]/.test(selector)) selector = "";
    const bp = this.preview.bp;
    return { selector, media: bp.media || null, bp, el: cur.el, classes, file: selector ? this.cssFileFor(selector, bp.media) : null };
  }
  /** The CSS file that already holds `selector` (any media), else the page's stylesheet. */
  cssFileFor(selector, media) {
    for (const p of this.model.cssFiles()) {
      if (E.findRule(this.model.css(p), { selector, media })) return p;
    }
    for (const p of this.model.cssFiles()) {
      if (E.findRule(this.model.css(p), { selector, media: null })) return p;
    }
    return this.model.primaryStylesheet(this.page) || null;
  }

  /** Declarations of the current style target at the current breakpoint: { prop: Decl } */
  targetDeclarations(t = this.styleTarget()) {
    if (!t) return {};
    if (!t.selector) {
      const cur = this.current();
      const styleAttr = cur && E.getAttr(cur.el, "style");
      if (!styleAttr) return {};
      const out = {};
      for (const d of E.parseCss(`x{${styleAttr}}`).rules[0]?.decls || []) out[d.prop] = d;
      return out;
    }
    if (!t.file) return {};
    return E.getDeclarations(this.model.css(t.file), { selector: t.selector, media: t.media });
  }

  /**
   * Writes style declarations to the current target ({ prop: value|null }). Creates a class when the element has none.
   * `live` = true only previews the change in the frame (used while scrubbing).
   */
  setStyle(props, { live = false } = {}) {
    const cur = this.current();
    if (!cur) return false;
    if (live) {
      this.preview.live(cur.el.id, props);
      return true;
    }
    let t = this.styleTarget();
    if (!t.selector && (t.bp.media || t.classes.length === 0) && this.styleSelector !== "") {
      // style through a class: create `tag-N` when the element has none
      const name = this.#autoClass(cur.el);
      this.setClasses([...t.classes, name]);
      this.styleSelector = `.${name}`;
      t = this.styleTarget();
    }
    if (!t) return false;
    if (!t.selector) {
      this.editElement((p, el) => E.setInlineStyle(p, el.id, props));
      return true;
    }
    const file = t.file || this.ensureStylesheet(this.page);
    const parsed = this.model.css(file);
    const changes = E.setDeclarations(parsed, { selector: t.selector, media: t.media }, props);
    if (!changes.length) return false;
    this.#record([file]);
    this.editors.applyChanges(file, changes);
    return true;
  }
  #autoClass(el) {
    const used = new Set(this.model.classNames());
    const parsed = this.model.html(this.page);
    for (const e of parsed.elements) for (const c of E.classList(e)) used.add(c);
    const base = { div: "div-block", section: "section", a: "link", p: "paragraph", img: "image", ul: "list", li: "list-item", button: "button", h1: "heading", h2: "heading", h3: "heading", span: "text-span" }[el.tag] || el.tag;
    for (let i = 1; ; i++) {
      const name = i === 1 && !used.has(base) ? base : `${base}-${i}`;
      if (!used.has(name)) return name;
    }
  }
  setStyleSelector(sel) {
    this.styleSelector = sel;
    this.emit("style");
  }

  /**
   * Declarations of the same selector at larger breakpoints (desktop-first cascade): { prop: { value, from } }.
   * Used by the style panel to show which values a breakpoint inherits.
   */
  inheritedDeclarations(t = this.styleTarget()) {
    if (!t || !t.selector || !t.bp.media) {
      if (!t || !t.selector) return {};
    }
    const chain = { desktop: [], "desktop-xl": ["desktop"], "desktop-2xl": ["desktop", "desktop-xl"], tablet: ["desktop"], "mobile-landscape": ["desktop", "tablet"], "mobile-portrait": ["desktop", "tablet", "mobile-landscape"] }[t.bp.id] || [];
    const out = {};
    for (const id of chain) {
      const bp = E.BREAKPOINTS.find((b) => b.id === id);
      for (const p of this.model.cssFiles()) {
        const decls = E.getDeclarations(this.model.css(p), { selector: t.selector, media: bp.media || null });
        for (const [prop, d] of Object.entries(decls)) out[prop] = { value: d.value, from: bp.label };
      }
    }
    return out;
  }

  elementCategories() {
    return E.ELEMENT_CATEGORIES;
  }

  // ------------------------------------------------------------ undo / redo

  /** Undo for the studio: the editor's own history when it has focus, else the last visual operation. */
  undo() {
    if (this.editors.hasFocus()) return this.editors.undo();
    const op = this.opStack.pop();
    if (!op) return this.editors.undo();
    for (const f of op.files) this.editors.undo(f);
    this.redoStack.push(op);
    this.#after();
    return true;
  }
  redo() {
    if (this.editors.hasFocus()) return this.editors.redo();
    const op = this.redoStack.pop();
    if (!op) return this.editors.redo();
    for (const f of op.files) this.editors.redo(f);
    this.opStack.push(op);
    this.#after();
    return true;
  }
  canUndo() {
    return this.opStack.length > 0 || this.editors.canUndo();
  }
  canRedo() {
    return this.redoStack.length > 0 || this.editors.canRedo();
  }
  #after() {
    this.current();
    this.emit("project");
    this.app.emit("docchange", { web: true });
  }

  // ------------------------------------------------------------ element menu & keys

  elementMenu(id, x, y) {
    if (id != null) this.selectElement(id, { reveal: false });
    const cur = this.current();
    const items = [];
    if (cur) {
      items.push(
        { label: "Edit text", icon: "cursor-text", run: () => this.preview.startTextEdit(cur.el.id), disabled: cur.el.void },
        { label: "Show in code", icon: "code-slash", run: () => this.revealInCode(cur.el.id) },
        "-",
        { label: "Copy", icon: "clipboard", run: () => this.copySelected() },
        { label: "Cut", icon: "scissors", run: () => this.cutSelected() },
        { label: "Paste", icon: "clipboard-plus", run: () => this.pasteElement() },
        { label: "Duplicate", icon: "files", run: () => this.duplicateSelected() },
        "-",
        { label: "Select parent", icon: "arrow-up-short", run: () => this.selectParent(), disabled: !cur.el.parent },
        { label: "Wrap in div", icon: "box", run: () => this.wrapSelected("div") },
        { label: "Unwrap", icon: "box-arrow-up", run: () => this.unwrapSelected(), disabled: !cur.el.children.some((c) => c.type === "element") && !cur.el.children.length },
        "-",
        { label: "Delete", icon: "trash3", run: () => this.deleteSelected(), disabled: cur.el.tag === "body" || cur.el.tag === "html" },
      );
    } else items.push({ label: "Paste", icon: "clipboard-plus", run: () => this.pasteElement() });
    // the AI submenu comes from a provider (code/context.js), gated by prefs.aiEnabled
    openContextMenu(this.app, { kind: "web-element", x, y, data: { ws: this, element: cur?.el }, base: items });
  }

  /** Keys forwarded from the preview frame (the frame cannot reach the app's shortcut handler). */
  previewKey(m) {
    const mod = m.ctrl || m.meta;
    const k = m.key;
    const ev = { key: k, code: m.code, ctrlKey: !!m.ctrl, metaKey: !!m.meta, shiftKey: !!m.shift, altKey: !!m.alt, defaultPrevented: false, preventDefault() {}, target: document.body };
    if (!mod && !m.alt) {
      if (k === "Delete" || k === "Backspace") return this.deleteSelected();
      if (k === "Escape") return this.selectElement(null);
      if (k === "Enter") {
        const cur = this.current();
        if (cur) return this.preview.startTextEdit(cur.el.id);
      }
      if (k === "F2") return this.openPalette("");
    }
    if (mod && !m.shift && !m.alt) {
      const l = k.toLowerCase();
      if (l === "c") return this.copySelected();
      if (l === "x") return this.cutSelected();
      if (l === "v") return this.pasteElement();
      if (l === "d") return this.duplicateSelected();
      if (l === "z") return this.undo();
      if (l === "y") return this.redo();
    }
    if (mod && m.shift && k.toLowerCase() === "z") return this.redo();
    this.app.handleShortcut?.(ev);
  }

  // ------------------------------------------------------------ console

  log(level, text) {
    text = String(text).replace(/data:text\/javascript[^\s)"']*/g, "<script>");
    this.consoleLines.push({ level, text, time: Date.now() });
    if (this.consoleLines.length > 500) this.consoleLines.shift();
    this.emit("console", { level, text });
  }
  clearConsole() {
    this.consoleLines = [];
    this.emit("console", null);
  }

  // ------------------------------------------------------------ palette / commands

  palette() {
    openCommandPalette(this, ">");
  }
  quickOpen() {
    openCommandPalette(this, "");
  }
  openPalette(prefix) {
    openCommandPalette(this, prefix);
  }
  #editorKeys() {
    const app = this.app;
    const run = (id) => () => (app.run(id), true);
    return [
      { key: "Mod-s", run: run("file.save"), preventDefault: true },
      { key: "Mod-Shift-s", run: run("file.saveAs"), preventDefault: true },
      { key: "Mod-Shift-e", run: run("file.export"), preventDefault: true },
      { key: "Mod-p", run: () => (this.quickOpen(), true), preventDefault: true },
      { key: "Mod-Shift-p", run: () => (this.palette(), true), preventDefault: true },
      { key: "F1", run: () => (this.palette(), true), preventDefault: true },
      { key: "Mod-b", run: () => (this.toggleSidebar(), true), preventDefault: true },
      { key: "Mod-j", run: () => (this.bottom.toggle(), true), preventDefault: true },
      { key: "Mod-Shift-f", run: () => (this.showSide("search"), true), preventDefault: true },
      // Alt+1..5 follow the visible studio order of the header
      ...[1, 2, 3, 4, 5].map((n) => ({ key: `Alt-${n}`, run: () => (app.visibleStudios[n - 1] ? (app.setStudio(app.visibleStudios[n - 1]), true) : false), preventDefault: true })),
      { key: "Alt-z", run: () => (this.editors.setWordWrap(!this.web.settings.wordWrap), true), preventDefault: true },
    ];
  }

  // ------------------------------------------------------------ status

  statusText() {
    if (!this.built) return "Code studio";
    const c = this.editors.cursorInfo();
    const parts = [];
    if (c) parts.push(`Ln ${c.line}, Col ${c.col}${c.selected ? ` (${c.selected} selected)` : ""}`);
    if (c) parts.push(({ html: "HTML", css: "CSS", javascript: "JavaScript", json: "JSON", markdown: "Markdown", xml: "XML", latex: "LaTeX", yaml: "YAML", toml: "TOML", properties: "INI", text: "Plain text" })[E.languageOf(c.path)] || "Plain text");
    parts.push(`Spaces: ${this.web.settings.tabSize || 2}`, "UTF-8");
    parts.push(`${this.preview.bp.label} ${this.preview.bp.width}px`);
    return parts.join("   ·   ");
  }

  activate() {
    if (!this.built) return;
    requestAnimationFrame(() => {
      this.preview.layout();
      this.editors.view?.requestMeasure();
    });
  }

  dispose() {
    if (!this.built) return;
    this.preview.destroy();
    this.docPreview?.destroy();
    this.editors.destroy();
  }
}
