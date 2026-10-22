// The code editor of the Code studio: CodeMirror 6 with one EditorState per project file (so every file keeps
// its own undo history), a tab strip, project-aware completions and a diagnostics linter.
// Visual tools edit files through `applyChanges`, which goes through the same history as typing.
import * as CM from "../../../vendor/codemirror/codemirror.js";
import { Emitter, h, empty, formatBytes } from "../../core/util.js";
import { languageOf, parseHtml, parseCss, formatCss, resolveRef, dirname } from "../../engine/web/index.js";
import { expandHtml, expandCss, abbreviationBefore } from "../../engine/web/emmet.js";
import { tailwindClasses, BOOTSTRAP_CLASSES, TAILWIND_VARIANTS, splitVariant, attributeOptions, htmxValues } from "../../engine/web/index.js";
import { fileIcon, fuzzyScore, trimmedChange } from "./util.js";
import { markContext } from "../context-menu/index.js";
import { registerCodeContext, openEditorMenu } from "./context.js";

const SNIPPETS_HTML = [
  { label: "html5", detail: "HTML document", template: `<!doctype html>\n<html lang="en-US">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>\${Title}</title>\n    <link rel="stylesheet" href="css/style.css" />\n  </head>\n  <body>\n    \${}\n    <script src="js/main.js"></script>\n  </body>\n</html>\n` },
  { label: "link:css", detail: "stylesheet link", template: `<link rel="stylesheet" href="\${css/style.css}" />` },
  { label: "script:src", detail: "script tag", template: `<script src="\${js/main.js}"></script>` },
  { label: "img", detail: "image", template: `<img src="\${}" alt="\${}" />` },
  { label: "a:link", detail: "link", template: `<a href="\${#}">\${Link}</a>` },
  { label: "section", detail: "section", template: `<section class="\${section}">\n  <div class="container">\n    \${}\n  </div>\n</section>` },
  { label: "ul>li", detail: "list", template: `<ul>\n  <li>\${}</li>\n  <li></li>\n  <li></li>\n</ul>` },
  { label: "form", detail: "form", template: `<form action="\${}" method="post">\n  <label>\n    \${Name}\n    <input type="text" name="\${name}" required />\n  </label>\n  <button type="submit">\${Send}</button>\n</form>` },
  { label: "meta:vp", detail: "viewport meta", template: `<meta name="viewport" content="width=device-width, initial-scale=1" />` },
];
const SNIPPETS_CSS = [
  { label: "flex-center", detail: "center with flexbox", template: `display: flex;\nalign-items: center;\njustify-content: center;` },
  { label: "grid-cols", detail: "responsive grid", template: `display: grid;\ngrid-template-columns: repeat(auto-fit, minmax(\${240px}, 1fr));\ngap: \${24px};` },
  { label: "media-tablet", detail: "@media (max-width: 991px)", template: `@media (max-width: 991px) {\n  \${}\n}` },
  { label: "media-mobile", detail: "@media (max-width: 767px)", template: `@media (max-width: 767px) {\n  \${}\n}` },
  { label: "media-small", detail: "@media (max-width: 478px)", template: `@media (max-width: 478px) {\n  \${}\n}` },
  { label: "reset", detail: "box-sizing reset", template: `*, *::before, *::after {\n  box-sizing: border-box;\n}` },
];

function languageExtension(path) {
  switch (languageOf(path)) {
    case "html":
      return CM.html({ autoCloseTags: true, matchClosingTags: true });
    case "css":
      return CM.css();
    case "javascript":
      return CM.javascript({ typescript: /\.tsx?$/i.test(path), jsx: /\.(jsx|tsx)$/i.test(path) });
    case "json":
      return CM.json();
    case "markdown":
      return CM.markdown();
    case "xml":
      return CM.xml();
    case "latex":
      return CM.StreamLanguage.define(CM.stex);
    case "yaml":
      return CM.StreamLanguage.define(CM.yaml);
    case "toml":
      return CM.StreamLanguage.define(CM.toml);
    case "properties":
      return CM.StreamLanguage.define(CM.properties);
    default:
      return [];
  }
}

export class CodeEditors extends Emitter {
  /**
   * @param {object} o
   * @param {import("../../core/app.js").App} o.app
   * @param {import("../../core/web.js").WebProject} o.web
   * @param {ReturnType<import("./model.js").createModel>} o.model
   * @param {Array} [o.keys] extra CodeMirror key bindings (global app shortcuts)
   */
  constructor({ app, web, model, keys = [] }) {
    super();
    this.app = app;
    this.web = web;
    this.model = model;
    this.keys = keys;
    /** @type {Map<string, import("@codemirror/state").EditorState>} */
    this.states = new Map();
    this.open = []; // tab order
    this.active = null;
    this.view = null;
    this.wrap = new CM.Compartment();
    this.tabsEl = h("div.of-etabs", { role: "tablist", "aria-label": "Open files" });
    this.placeholder = h("div.of-editor__empty", h("sl-icon", { name: "code-slash" }), h("p", "Open a file from the Explorer"), h("p.of-hint", "Quick open  Ctrl+P · Commands  Ctrl+Shift+P"));
    this.host = h("div.of-editor__host");
    this.media = h("div.of-editor__media.hidden");
    this.fmtbar = h("div.of-fmtbar.hidden"); // formatting buttons for Markdown and LaTeX (see doctools.js)
    this.el = h("div.of-editor", this.tabsEl, this.fmtbar, this.host, this.media, this.placeholder);

    // editor preferences (Settings ▸ Code studio) are global; the project keeps the effective values
    web.settings.tabSize = app.prefs.codeTabSize || web.settings.tabSize || 2;
    web.settings.wordWrap = !!app.prefs.codeWordWrap;
    this.offPrefs = app.on("prefs", () => {
      web.settings.tabSize = app.prefs.codeTabSize || 2;
      if (!!app.prefs.codeWordWrap !== !!web.settings.wordWrap) this.setWordWrap(!!app.prefs.codeWordWrap);
    });
    web.on("text", ({ path, origin }) => {
      if (origin !== "editor" && origin !== "visual") this.#syncFromProject(path, origin);
    });
    web.on("tree", (ev) => {
      if (ev.kind === "remove") for (const p of ev.paths) this.close(p, true);
      else if (ev.kind === "rename") for (const [from, to] of ev.pairs) this.#renamed(from, to);
    });
    registerCodeContext(this);
    this.#renderTabs();
  }

  // ------------------------------------------------------------ state creation

  #extensions(path) {
    const web = this.web;
    const self = this;
    const keymapExtra = [
      { key: "Tab", run: (v) => self.#emmet(v) },
      ...this.keys,
      { key: "Shift-Alt-f", run: () => (self.format(), true), preventDefault: true },
      { key: "Mod-Alt-ArrowDown", run: CM.copyLineDown },
      { key: "Mod-Alt-ArrowUp", run: CM.copyLineUp },
      { key: "Mod-Shift-k", run: CM.deleteLine },
      { key: "Mod-g", run: CM.gotoLine, preventDefault: true },
      { key: "Mod-h", run: CM.openSearchPanel, preventDefault: true },
      { key: "F3", run: CM.findNext, preventDefault: true },
      { key: "Shift-F3", run: CM.findPrevious, preventDefault: true },
    ];
    return [
      CM.lineNumbers(),
      CM.highlightActiveLineGutter(),
      CM.highlightSpecialChars(),
      CM.history(),
      CM.foldGutter({ openText: "▾", closedText: "▸" }),
      CM.drawSelection(),
      CM.dropCursor(),
      CM.EditorState.allowMultipleSelections.of(true),
      CM.indentOnInput(),
      CM.syntaxHighlighting(CM.classHighlighter),
      CM.bracketMatching(),
      CM.closeBrackets(),
      CM.autocompletion({ activateOnTyping: true, closeOnBlur: true, icons: true }),
      CM.rectangularSelection(),
      CM.crosshairCursor(),
      CM.highlightActiveLine(),
      CM.highlightSelectionMatches(),
      CM.search({ top: true }),
      CM.lintGutter(),
      ...(this.extraExtensions?.(path) || []),
      CM.keymap.of([...keymapExtra, ...CM.closeBracketsKeymap, ...CM.defaultKeymap, ...CM.searchKeymap, ...CM.historyKeymap, ...CM.foldKeymap, ...CM.completionKeymap, ...CM.lintKeymap, CM.indentWithTab]),
      CM.indentUnit.of(" ".repeat(web.settings.tabSize || 2)),
      CM.EditorState.tabSize.of(web.settings.tabSize || 2),
      this.wrap.of(web.settings.wordWrap ? CM.EditorView.lineWrapping : []),
      languageExtension(path),
      CM.EditorState.languageData.of(() => [{ autocomplete: self.#completions(path) }]),
      CM.linter(() => self.diagnosticsFor(path).map((d) => toCmDiagnostic(d, self.states.get(path) || self.view?.state)), { delay: 500 }),
      CM.EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const origin = u.transactions.some((t) => t.annotation(CM.Transaction.userEvent) === "input.visual") ? "visual" : "editor";
          const cur = self.active;
          if (cur) {
            self.states.set(cur, u.state);
            web.setText(cur, u.state.doc.toString(), origin);
            self.emit("doc", { path: cur, origin });
          }
        } else if (u.selectionSet && self.active) self.states.set(self.active, u.state);
        if (u.selectionSet || u.docChanged) self.emit("cursor", self.cursorInfo());
        if (u.focusChanged) self.emit("focus", u.view.hasFocus);
      }),
      CM.EditorView.domEventHandlers({
        contextmenu(e, view) {
          // Shift + right-click keeps the browser's own menu
          if (e.shiftKey) return false;
          e.preventDefault();
          openEditorMenu(self, e, view); // providers: ./context.js (Cut/Copy/Paste, Transform, AI, extensions)
          return true;
        },
      }),
      CM.EditorView.contentAttributes.of({ "aria-label": `Editor for ${path}`, spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
    ];
  }

  stateFor(path) {
    let st = this.states.get(path);
    if (!st) {
      const text = this.web.text(path);
      if (text == null) return null;
      st = CM.EditorState.create({ doc: text, extensions: this.#extensions(path) });
      this.states.set(path, st);
    }
    return st;
  }

  /** Tab expands an Emmet abbreviation before the caret (HTML text and CSS declarations); otherwise Tab indents. */
  #emmet(view) {
    const path = this.active;
    let lang = path ? languageOf(path) : null;
    if (lang !== "html" && lang !== "css") return false;
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const pos = sel.head;
    const line = view.state.doc.lineAt(pos);
    const before = line.text.slice(0, pos - line.from);
    if (lang === "html") {
      const upto = view.state.sliceDoc(0, pos);
      if (before.lastIndexOf("<") > before.lastIndexOf(">")) return false; // inside a tag
      const style = upto.lastIndexOf("<style");
      const script = upto.lastIndexOf("<script");
      if (script > upto.lastIndexOf("</script")) return false;
      if (style > upto.lastIndexOf("</style")) lang = "css";
    }
    const found = abbreviationBefore(before, before.length, lang);
    if (!found) return false;
    const unit = " ".repeat(this.web.settings.tabSize || 2);
    const out = lang === "html" ? expandHtml(found.abbr, { indent: unit }) : expandCss(found.abbr);
    if (!out) return false;
    const base = /^\s*/.exec(line.text)[0];
    const lines = out.text.split("\n");
    const text = lines.map((l, i) => (i ? base + l : l)).join("\n");
    const k = out.text.slice(0, out.cursor).split("\n").length - 1;
    const from = line.from + found.from;
    view.dispatch({ changes: { from, to: pos, insert: text }, selection: { anchor: from + out.cursor + k * base.length }, userEvent: "input.emmet", scrollIntoView: true });
    return true;
  }

  // ------------------------------------------------------------ completions

  #completions(path) {
    const self = this;
    const lang = languageOf(path);
    return (context) => {
      const pos = context.pos;
      const before = context.state.sliceDoc(Math.max(0, pos - 400), pos);
      // snippets contributed by extensions (docs/extensions.md)
      const extSnips = (l) => (self.app.extensions?.snippets(l) || []).map((s) => CM.snippetCompletion(s.body, { label: s.label, detail: s.detail || s.ext, boost: -1 }));
      const fileOptions = (prefix) => {
        const dir = dirname(path);
        const out = [];
        for (const p of self.web.paths) {
          if (p === path) continue;
          const rel = relativeTo(dir, p);
          out.push({ label: rel, type: "file", detail: p === self.web.entry ? "entry" : undefined });
        }
        return out.filter((o) => !prefix || o.label.toLowerCase().includes(prefix.toLowerCase()));
      };
      if (lang === "html") {
        let m = /\sclass\s*=\s*"([^"]*)$/i.exec(before) || /\sclass\s*=\s*'([^']*)$/i.exec(before);
        if (m) {
          const token = /[^\s]*$/.exec(m[1])[0];
          const used = new Set(m[1].split(/\s+/));
          const own = self.model.classNames().filter((c) => !used.has(c) || c === token).map((c) => ({ label: c, type: "class" }));
          const fw = self.model.frameworks();
          if (fw.has("tailwind") || fw.has("bootstrap")) {
            // framework classes: Tailwind variants (md:hover:) stay in front of the completed name
            const { prefix, rest } = splitVariant(token);
            const names = [...(fw.has("tailwind") ? tailwindClasses() : []), ...(fw.has("bootstrap") ? BOOTSTRAP_CLASSES : [])];
            const options = [...own];
            if (fw.has("tailwind") && !rest.includes(":")) for (const v of TAILWIND_VARIANTS) options.push({ label: v, type: "keyword", boost: -3 });
            let n = 0;
            for (const c of names) {
              if (used.has(prefix + c)) continue;
              if (rest && !c.startsWith(rest) && !c.includes(rest)) continue;
              options.push({ label: c, type: "class", detail: fw.has("tailwind") ? "Tailwind" : "Bootstrap", boost: c.startsWith(rest) ? -1 : -2 });
              if (++n > 400) break;
            }
            return { from: pos - rest.length, options, validFor: /^[\w./[\]-]*$/ };
          }
          return { from: pos - token.length, options: own, validFor: /^[\w-]*$/ };
        }
        // Alpine.js / htmx attributes inside a start tag
        const fwAttrs = /<[A-Za-z][\w-]*(?:\s+[^<>]*?)?\s(@[\w.:-]*|:[\w-]*|x-[\w.:-]*|hx-[\w.:-]*)$/.exec(before);
        if (fwAttrs) {
          const options = attributeOptions(self.model.frameworks());
          if (options.length) return { from: pos - fwAttrs[1].length, options, validFor: /^[@:\w.-]*$/ };
        }
        const hxValue = /\s(hx-[\w-]+)\s*=\s*["']([^"']*)$/.exec(before);
        if (hxValue && htmxValues(hxValue[1]).length) return { from: pos - hxValue[2].length, options: htmxValues(hxValue[1]).map((v) => ({ label: v, type: "text" })), validFor: /^[\w .:-]*$/ };
        m = /\s(?:href|src|poster|action|data|srcset)\s*=\s*["']([^"']*)$/i.exec(before);
        if (m) return { from: pos - m[1].length, options: fileOptions(""), validFor: /^[\w./#-]*$/ };
        const word = context.matchBefore(/[\w:>-]+/);
        if (word && word.text.length >= 2 && /(^|\n)\s*[\w:>-]*$/.test(before.slice(-80)) && !/<[^>]*$/.test(before)) {
          const options = SNIPPETS_HTML.map((s) => CM.snippetCompletion(s.template, { label: s.label, detail: s.detail, boost: -1 })).concat(extSnips("html"));
          return { from: word.from, options, validFor: /^[\w:>-]*$/ };
        }
      } else if (lang === "css") {
        let m = /var\(\s*(--[\w-]*)$/.exec(before);
        if (m) return { from: pos - m[1].length, options: self.model.customProperties().map((v) => ({ label: v.name, type: "variable", detail: v.value })), validFor: /^--[\w-]*$/ };
        m = /url\(\s*["']?([^"')]*)$/.exec(before);
        if (m) return { from: pos - m[1].length, options: fileOptions(""), validFor: /^[\w./-]*$/ };
        const word = context.matchBefore(/[\w-]+/);
        if (word && word.text.length >= 3 && /(^|[;{}\n])\s*[\w-]*$/.test(before.slice(-60))) {
          return { from: word.from, options: SNIPPETS_CSS.map((s) => CM.snippetCompletion(s.template, { label: s.label, detail: s.detail, boost: -1 })).concat(extSnips("css")), validFor: /^[\w-]*$/ };
        }
      }
      return null;
    };
  }

  // ------------------------------------------------------------ diagnostics

  /** Problems of one file: parser diagnostics for HTML/CSS plus syntax errors from the language parser. */
  diagnosticsFor(path) {
    const text = this.web.text(path);
    if (text == null) return [];
    const lang = languageOf(path);
    const out = [];
    if (lang === "html") for (const d of this.model.html(path).errors) out.push(d);
    else if (lang === "css") for (const d of this.model.css(path).errors) out.push(d);
    if (lang === "javascript" || lang === "json" || lang === "css" || lang === "html") {
      const st = this.stateFor(path);
      if (st) {
        try {
          // an incomplete parse (time budget) ends in a zero-length error node: only trust finished parses
          const tree = CM.ensureSyntaxTree(st, st.doc.length, 400);
          let n = 0;
          (tree || CM.syntaxTree(st)).iterate({
            enter: (node) => {
              if (!tree) return false;
              if (n < 40 && node.type.isError) {
                n++;
                const from = Math.min(node.from, text.length);
                if (!out.some((d) => d.start <= from && d.end >= from && d.severity === "error")) out.push({ severity: "error", code: "syntax", message: "Syntax error", start: from, end: Math.max(from + 1, node.to) });
              }
            },
          });
        } catch {
          /* a failed parse must never break typing */
        }
      }
    }
    return out;
  }

  /** Problems of every code file in the project: [{path, severity, message, start, end}] */
  allProblems() {
    const out = [];
    for (const p of this.web.paths) {
      const lang = languageOf(p);
      if (!["html", "css", "javascript", "json"].includes(lang) || !this.web.isText(p)) continue;
      for (const d of this.diagnosticsFor(p)) out.push({ ...d, path: p });
    }
    return out;
  }

  // ------------------------------------------------------------ tabs and activation

  openFile(path, { focus = false, from = null, to = null, line = null } = {}) {
    if (!this.web.has(path)) return false;
    if (!this.open.includes(path)) this.open.push(path);
    this.#activate(path);
    if (!this.web.isText(path)) {
      this.#persist();
      return true; // images, audio, video and fonts open in a viewer tab
    }
    if (line != null) {
      const doc = this.view.state.doc;
      const ln = doc.line(Math.min(Math.max(1, line), doc.lines));
      from = ln.from;
      to = ln.to;
    }
    if (from != null) this.select(from, to ?? from, { scroll: true });
    if (focus) this.focus();
    this.#persist();
    return true;
  }

  #activate(path) {
    if (!this.web.isText(path)) {
      this.active = path;
      this.#showMedia(path);
      this.#renderTabs();
      this.emit("active", path);
      this.emit("cursor", null);
      return;
    }
    this.#hideMedia();
    const st = this.stateFor(path);
    if (!st) return;
    // keep the project text and the editor in step (e.g. the file changed while closed)
    if (st.doc.toString() !== this.web.text(path)) this.states.delete(path);
    const state = this.stateFor(path);
    this.active = path;
    if (!this.view) {
      this.view = new CM.EditorView({ state, parent: this.host });
    } else this.view.setState(state);
    this.placeholder.classList.add("hidden");
    this.host.classList.remove("hidden");
    this.#renderTabs();
    this.emit("active", path);
    this.emit("cursor", this.cursorInfo());
  }

  close(path, forget = false) {
    const i = this.open.indexOf(path);
    if (i < 0) {
      if (forget) this.states.delete(path);
      return;
    }
    this.open.splice(i, 1);
    this.states.delete(path);
    if (this.active === path) {
      const next = this.open[Math.min(i, this.open.length - 1)];
      if (next) this.#activate(next);
      else {
        this.active = null;
        this.#hideMedia();
        this.view?.setState(CM.EditorState.create({ doc: "" }));
        this.host.classList.add("hidden");
        this.placeholder.classList.remove("hidden");
        this.#renderTabs();
        this.emit("active", null);
      }
    } else this.#renderTabs();
    this.#persist();
  }

  closeOthers(path) {
    for (const p of [...this.open]) if (p !== path) this.close(p);
  }
  closeAll() {
    for (const p of [...this.open]) this.close(p);
  }

  #renamed(from, to) {
    const st = this.states.get(from);
    this.states.delete(from);
    const i = this.open.indexOf(from);
    if (i >= 0) this.open[i] = to;
    if (st) this.states.delete(to); // the language may change with the extension: rebuild lazily
    if (this.active === from) {
      this.active = to;
      this.#activate(to);
    } else this.#renderTabs();
    this.#persist();
  }

  #syncFromProject(path, origin) {
    const text = this.web.text(path);
    if (text == null) return;
    const st = this.states.get(path);
    if (!st || st.doc.toString() === text) return;
    const ch = trimmedChange(st.doc.toString(), text);
    // edits of other room members ("Edit together") are not part of this user's undo history
    const spec = { changes: ch, userEvent: "input.external", ...(origin === "collab" ? { annotations: CM.Transaction.addToHistory.of(false) } : {}) };
    if (path === this.active && this.view) this.view.dispatch(spec);
    else this.states.set(path, st.update(spec).state);
  }

  /**
   * Applies edits of other room members (ui/collab/live.js): `changes` are sequential ({from,to,insert}, each relative
   * to the text after the previous one). Selections and cursors are mapped through them; nothing enters the undo
   * history. Returns false when this file has no editor state (the caller then writes the project text directly).
   */
  applyRemote(path, changes) {
    const st = this.states.get(path);
    if (!st) return false;
    const annotations = CM.Transaction.addToHistory.of(false);
    if (path === this.active && this.view) {
      for (const c of changes) this.view.dispatch({ changes: { from: c.from, to: c.to, insert: c.insert }, annotations, userEvent: "input.collab" });
      return true;
    }
    let next = st;
    for (const c of changes) next = next.update({ changes: { from: c.from, to: c.to, insert: c.insert }, annotations, userEvent: "input.collab" }).state;
    this.states.set(path, next);
    this.web.setText(path, next.doc.toString(), "visual");
    this.emit("doc", { path, origin: "visual" });
    return true;
  }

  #persist() {
    this.web.settings.openFiles = [...this.open];
    this.web.settings.activeFile = this.active;
  }

  /** Reopens the tabs saved in the project settings. */
  restore() {
    for (const p of this.web.settings.openFiles || []) if (this.web.has(p) && !this.open.includes(p)) this.open.push(p);
    const act = this.web.settings.activeFile;
    const target = act && this.open.includes(act) ? act : this.open[0];
    if (target) this.#activate(target);
    else this.#renderTabs();
  }

  #renderTabs() {
    empty(this.tabsEl);
    const names = this.open.map((p) => p.split("/").pop());
    for (const [i, path] of this.open.entries()) {
      const dup = names.filter((n) => n === names[i]).length > 1;
      const tab = h(
        "div.of-etab",
        { role: "tab", class: path === this.active ? "active" : "", "aria-selected": String(path === this.active), title: path, draggable: "true" },
        fileIcon(path),
        h("span.of-etab__name", names[i], dup ? h("small", ` ${path.split("/").slice(-2, -1)[0] || ""}`) : null),
        h("button.of-etab__close", { type: "button", "aria-label": `Close ${path}`, onclick: (e) => {
          e.stopPropagation();
          this.close(path);
        } }, h("sl-icon", { name: "x-lg" })),
      );
      markContext(tab, "editor-tab", { path, editors: this });
      tab.addEventListener("click", () => this.openFile(path, { focus: true }));
      tab.addEventListener("auxclick", (e) => e.button === 1 && this.close(path));
      tab.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/x-of-tab", path);
        e.dataTransfer.effectAllowed = "move";
      });
      tab.addEventListener("dragover", (e) => {
        if (e.dataTransfer.types.includes("text/x-of-tab")) e.preventDefault();
      });
      tab.addEventListener("drop", (e) => {
        const from = e.dataTransfer.getData("text/x-of-tab");
        if (!from || from === path) return;
        e.preventDefault();
        this.open.splice(this.open.indexOf(from), 1);
        this.open.splice(this.open.indexOf(path), 0, from);
        this.#persist();
        this.#renderTabs();
      });
      this.tabsEl.append(tab);
    }
    this.tabsEl.classList.toggle("hidden", !this.open.length);
    this.tabsEl.querySelector(".active")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  // ------------------------------------------------------------ editing API

  /** Applies [{from,to,insert}] (offsets in the current text of `path`) as one undoable edit. */
  applyChanges(path, changes, { userEvent = "input.visual", selection = null } = {}) {
    if (!changes?.length) return false;
    const st = this.stateFor(path);
    if (!st) return false;
    const spec = { changes: changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert })), userEvent };
    if (selection) spec.selection = selection;
    if (path === this.active && this.view) this.view.dispatch(spec);
    else {
      const tr = st.update(spec);
      this.states.set(path, tr.state);
      this.web.setText(path, tr.state.doc.toString(), "visual");
      this.emit("doc", { path, origin: "visual" });
    }
    return true;
  }

  /** Runs a CodeMirror state command (undo/redo) against a file's state, mounted or not. */
  #target(path) {
    if (path === this.active && this.view) return this.view;
    const self = this;
    return {
      get state() {
        return self.stateFor(path);
      },
      dispatch(tr) {
        self.states.set(path, tr.state);
        self.web.setText(path, tr.state.doc.toString(), "visual");
        self.emit("doc", { path, origin: "visual" });
      },
    };
  }
  undo(path = this.active) {
    return path ? CM.undo(this.#target(path)) : false;
  }
  redo(path = this.active) {
    return path ? CM.redo(this.#target(path)) : false;
  }
  canUndo(path = this.active) {
    const st = path && this.stateFor(path);
    return !!st && CM.undoDepth(st) > 0;
  }
  canRedo(path = this.active) {
    const st = path && this.stateFor(path);
    return !!st && CM.redoDepth(st) > 0;
  }

  select(from, to = from, { scroll = true } = {}) {
    if (!this.view) return;
    const len = this.view.state.doc.length;
    from = Math.min(from, len);
    to = Math.min(to, len);
    this.view.dispatch({ selection: { anchor: from, head: to }, effects: scroll ? CM.EditorView.scrollIntoView(from, { y: "center" }) : [] });
  }

  focus() {
    this.view?.focus();
  }
  hasFocus() {
    return !!this.view?.hasFocus;
  }

  cursorInfo() {
    if (!this.view || !this.active || !this.web.isText(this.active)) return null;
    const sel = this.view.state.selection.main;
    const line = this.view.state.doc.lineAt(sel.head);
    return { path: this.active, from: sel.from, to: sel.to, head: sel.head, line: line.number, col: sel.head - line.from + 1, selected: sel.to - sel.from, ranges: this.view.state.selection.ranges.length };
  }

  /** Run a CodeMirror command on the mounted view (find, goto line, comment …). */
  command(cmd) {
    if (!this.view) return false;
    this.view.focus();
    return cmd(this.view);
  }
  find() {
    return this.command(CM.openSearchPanel);
  }
  gotoLine() {
    return this.command(CM.gotoLine);
  }
  toggleComment() {
    return this.command(CM.toggleComment);
  }
  foldAll() {
    return this.command(CM.foldAll);
  }
  unfoldAll() {
    return this.command(CM.unfoldAll);
  }
  selectedText() {
    if (!this.view) return "";
    const s = this.view.state.selection.main;
    return this.view.state.sliceDoc(s.from, s.to);
  }

  setWordWrap(on) {
    this.web.settings.wordWrap = !!on;
    if (!!this.app.prefs.codeWordWrap !== !!on) this.app.setPref("codeWordWrap", !!on);
    for (const [p, st] of this.states) {
      const next = st.update({ effects: this.wrap.reconfigure(on ? CM.EditorView.lineWrapping : []) }).state;
      this.states.set(p, next);
      if (p === this.active && this.view) this.view.setState(next);
    }
  }

  /** Formats the active file: CSS and JSON are rewritten, other languages are re-indented. */
  format(path = this.active) {
    if (!path || !this.view) return false;
    const text = this.web.text(path);
    const lang = languageOf(path);
    try {
      if (lang === "css") {
        const next = formatCss(text);
        if (next !== text) this.applyChanges(path, [trimmedChange(text, next)], { userEvent: "input.format" });
        return true;
      }
      if (lang === "json") {
        const next = `${JSON.stringify(JSON.parse(text), null, this.web.settings.tabSize || 2)}\n`;
        if (next !== text) this.applyChanges(path, [trimmedChange(text, next)], { userEvent: "input.format" });
        return true;
      }
    } catch (err) {
      this.app.toast(`Cannot format ${path}: ${err.message}`, "warning");
      return false;
    }
    const v = this.view;
    const sel = v.state.selection;
    v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
    CM.indentSelection(v);
    v.dispatch({ selection: sel });
    return true;
  }

  /** Quick-open style search over file paths. */
  searchFiles(query) {
    return this.web.paths
      .map((p) => ({ path: p, score: fuzzyScore(query, p) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  }

  #hideMedia() {
    if (this.mediaUrl) URL.revokeObjectURL(this.mediaUrl);
    this.mediaUrl = null;
    this.media.classList.add("hidden");
    empty(this.media);
  }

  /** Viewer tab for non-text files: images, audio, video, fonts. */
  #showMedia(path) {
    this.#hideMedia();
    const f = this.web.get(path);
    this.host.classList.add("hidden");
    this.placeholder.classList.add("hidden");
    this.media.classList.remove("hidden");
    const mime = f.mime || "";
    const size = f.bytes ? f.bytes.length : f.text.length;
    const meta = h("div.of-media__meta", h("strong", path.split("/").pop()), h("span", mime), h("span", formatBytes(size)));
    this.mediaUrl = URL.createObjectURL(new Blob([f.bytes], { type: mime }));
    let body;
    if (mime.startsWith("image/")) {
      const img = h("img", { src: this.mediaUrl, alt: path, draggable: "false" });
      img.addEventListener("load", () => meta.append(h("span", `${img.naturalWidth} × ${img.naturalHeight} px`)));
      img.addEventListener("click", () => img.classList.toggle("actual"));
      body = h("div.of-media__canvas", img);
    } else if (mime.startsWith("video/")) body = h("div.of-media__canvas", h("video", { src: this.mediaUrl, controls: true }));
    else if (mime.startsWith("audio/")) body = h("div.of-media__canvas", h("audio", { src: this.mediaUrl, controls: true }));
    else if (/font|woff|ttf|otf/.test(mime) || /\.(woff2?|ttf|otf)$/i.test(path)) {
      const family = `of-preview-${Math.abs([...path].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7))}`;
      body = h("div.of-media__font", { style: { fontFamily: `"${family}", sans-serif` } }, h("p", { style: { fontSize: "44px" } }, "The quick brown fox"), h("p", { style: { fontSize: "28px" } }, "jumps over the lazy dog 0123456789"), h("p", { style: { fontSize: "16px" } }, "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz"));
      new FontFace(family, f.bytes.slice().buffer).load().then((ff) => document.fonts.add(ff)).catch(() => body.append(h("p.of-hint", "This font could not be previewed.")));
    } else body = h("div.of-media__canvas", h("p.of-hint", "No preview for this file type."));
    this.media.append(meta, body);
  }

  destroy() {
    this.offPrefs?.();
    this.#hideMedia();
    this.view?.destroy();
    this.view = null;
  }
}

function toCmDiagnostic(d, state) {
  const len = state ? state.doc.length : Infinity;
  const from = Math.min(d.start, len);
  const to = Math.min(Math.max(d.end, from + 1), len);
  return { from, to: Math.max(from, to), severity: d.severity === "info" ? "info" : d.severity, message: d.message, source: d.code };
}

function relativeTo(dir, path) {
  if (!dir) return path;
  const a = dir.split("/");
  const b = path.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return `${"../".repeat(a.length - i)}${b.slice(i).join("/")}`;
}

export { CM, parseHtml, parseCss, resolveRef };
