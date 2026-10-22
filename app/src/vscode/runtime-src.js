// The `vscode` API shim that runs INSIDE the sandboxed frame of a VS Code web extension (never in the app).
// Like extensions/runtime-src.js it is a normal function (syntax-checked, minified with the app) serialized with
// toString(); `__VSX_CFG` is defined by the script before it. The extension bundle (CommonJS, as VS Code web
// extensions are built) is wrapped in `__vsxDefine(function (module, exports, require) {…})` by host.js.
//
// What it implements (the documented subset, see docs/vscode-extensions.md): commands, window messages/input/
// quick pick/output channels/status bar, the active text editor (document, selections, edit as one undo step),
// workspace configuration, read-only workspace.fs and openTextDocument, completion/hover/formatting/code action
// providers, the common value classes (Uri, Position, Range, Selection, TextEdit, WorkspaceEdit, …), env, version
// and the ExtensionContext. Everything else is caught by a Proxy: the access is reported to the host (shown in the
// manager and the compatibility report) and calling it throws an Error that names the missing API.
//
// Wire format: the same envelope as the OpenFini runtime ({ ofx: 1, t: "req" | "res" | "inv" | "ires" | "log" |
// "ready" }), so host.js reuses extensions/sandbox.js and extensions/rpc.js.
/* eslint-disable no-undef */
function vscodeRuntime() {
  const CFG = __VSX_CFG;
  const pending = new Map();
  let seq = 0;
  const send = (m) => parent.postMessage({ ofx: 1, ...m }, "*");
  const call = (m, p) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      send({ t: "req", id, m, p: p || {} });
    });
  const fmt = (a) => a.map((x) => (typeof x === "string" ? x : x instanceof Error ? x.stack || x.message : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(" ");
  const log = (level, ...a) => send({ t: "log", level, text: fmt(a).slice(0, 4000) });
  for (const k of ["log", "info", "warn", "error", "debug"]) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      orig(...a);
      log(k === "log" || k === "debug" ? "info" : k, ...a);
    };
  }
  addEventListener("error", (e) => log("error", e.message || "Script error"));
  addEventListener("unhandledrejection", (e) => log("error", "Unhandled rejection:", e.reason));
  const reported = new Set();
  const unsupported = (api) => {
    if (!reported.has(api)) {
      reported.add(api);
      call("api.unsupported", { api }).catch(() => {});
    }
    return new Error(`vscode.${api} is not supported in OpenFini (it runs a subset of the VS Code web extension API; see docs/vscode-extensions.md).`);
  };

  // ---------------------------------------------------------------- value classes
  class Disposable {
    constructor(fn) {
      this._fn = fn;
    }
    static from(...items) {
      return new Disposable(() => items.forEach((d) => d?.dispose?.()));
    }
    dispose() {
      const f = this._fn;
      this._fn = null;
      f?.();
    }
  }
  class EventEmitter {
    constructor() {
      this._l = new Set();
      this.event = (fn, thisArg, subs) => {
        const f = thisArg ? fn.bind(thisArg) : fn;
        this._l.add(f);
        const d = new Disposable(() => this._l.delete(f));
        if (Array.isArray(subs)) subs.push(d);
        return d;
      };
    }
    fire(v) {
      for (const f of [...this._l]) try { f(v); } catch (e) { log("error", e); }
    }
    dispose() {
      this._l.clear();
    }
  }
  class Position {
    constructor(line, character) {
      this.line = Math.max(0, line | 0);
      this.character = Math.max(0, character | 0);
    }
    isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
    isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
    isAfter(o) { return !this.isBeforeOrEqual(o); }
    isAfterOrEqual(o) { return !this.isBefore(o); }
    isEqual(o) { return this.line === o.line && this.character === o.character; }
    compareTo(o) { return this.isBefore(o) ? -1 : this.isEqual(o) ? 0 : 1; }
    translate(a = 0, b = 0) {
      if (typeof a === "object") return new Position(this.line + (a.lineDelta || 0), this.character + (a.characterDelta || 0));
      return new Position(this.line + a, this.character + b);
    }
    with(a, b) {
      if (a && typeof a === "object") return new Position(a.line ?? this.line, a.character ?? this.character);
      return new Position(a ?? this.line, b ?? this.character);
    }
  }
  const P = (p) => (p instanceof Position ? p : new Position(p?.line || 0, p?.character || 0));
  class Range {
    constructor(a, b, c, d) {
      let s = typeof a === "number" ? new Position(a, b) : P(a);
      let e = typeof a === "number" ? new Position(c, d) : P(b);
      if (e.isBefore(s)) [s, e] = [e, s];
      this.start = s;
      this.end = e;
    }
    get isEmpty() { return this.start.isEqual(this.end); }
    get isSingleLine() { return this.start.line === this.end.line; }
    contains(x) { return x instanceof Range ? this.contains(x.start) && this.contains(x.end) : !P(x).isBefore(this.start) && !P(x).isAfter(this.end); }
    isEqual(o) { return this.start.isEqual(o.start) && this.end.isEqual(o.end); }
    intersection(o) {
      const s = this.start.isAfter(o.start) ? this.start : o.start;
      const e = this.end.isBefore(o.end) ? this.end : o.end;
      return s.isAfter(e) ? undefined : new Range(s, e);
    }
    union(o) { return new Range(this.start.isBefore(o.start) ? this.start : o.start, this.end.isAfter(o.end) ? this.end : o.end); }
    with(a, b) {
      if (a && !(a instanceof Position) && typeof a === "object") return new Range(a.start ?? this.start, a.end ?? this.end);
      return new Range(a ?? this.start, b ?? this.end);
    }
  }
  class Selection extends Range {
    constructor(a, b, c, d) {
      const anchor = typeof a === "number" ? new Position(a, b) : P(a);
      const active = typeof a === "number" ? new Position(c, d) : P(b);
      super(anchor, active);
      this.anchor = anchor;
      this.active = active;
    }
    get isReversed() { return this.active.isBefore(this.anchor); }
  }
  class TextEdit {
    constructor(range, newText) {
      this.range = range;
      this.newText = newText;
    }
    static replace(r, t) { return new TextEdit(r, t); }
    static insert(p, t) { return new TextEdit(new Range(p, p), t); }
    static delete(r) { return new TextEdit(r, ""); }
  }
  class SnippetString {
    constructor(value = "") {
      this.value = value;
    }
    appendText(t) { this.value += String(t).replace(/[$}\\]/g, "\\$&"); return this; }
    appendTabstop(n = 1) { this.value += `$${n}`; return this; }
    appendPlaceholder(v, n = 1) { this.value += `\${${n}:${typeof v === "string" ? v : ""}}`; return this; }
    appendChoice(values, n = 1) { this.value += `\${${n}|${values.join(",")}|}`; return this; }
    appendVariable(name, def) { this.value += `\${${name}${def ? `:${def}` : ""}}`; return this; }
  }
  const Uri = makeUri();
  function makeUri() {
    class U {
      constructor(scheme, authority, path, query, fragment) {
        this.scheme = scheme || "file";
        this.authority = authority || "";
        this.path = path || "/";
        this.query = query || "";
        this.fragment = fragment || "";
      }
      get fsPath() { return this.path; }
      with(c) { return new U(c.scheme ?? this.scheme, c.authority ?? this.authority, c.path ?? this.path, c.query ?? this.query, c.fragment ?? this.fragment); }
      toString() { return `${this.scheme}://${this.authority}${this.path}${this.query ? `?${this.query}` : ""}${this.fragment ? `#${this.fragment}` : ""}`; }
      toJSON() { return { scheme: this.scheme, authority: this.authority, path: this.path, query: this.query, fragment: this.fragment }; }
      static parse(s) {
        const m = /^([a-zA-Z][\w+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(String(s));
        if (!m) return new U("file", "", String(s));
        return new U(m[1], m[2], m[3] || "/", m[4], m[5]);
      }
      static file(p) { return new U("file", "", `/${String(p).replace(/\\/g, "/").replace(/^\/+/, "")}`); }
      static joinPath(base, ...parts) {
        const segs = base.path.split("/");
        for (const p of parts.join("/").split("/")) {
          if (p === "..") segs.pop();
          else if (p && p !== ".") segs.push(p);
        }
        return base.with({ path: segs.join("/").replace(/^(?!\/)/, "/") });
      }
      static from(c) { return new U(c.scheme, c.authority, c.path, c.query, c.fragment); }
      static isUri(x) { return x instanceof U; }
    }
    return U;
  }
  const docUri = (path) => Uri.from({ scheme: "file", path: `/${path}` });
  const pathOfUri = (u) => {
    const uri = typeof u === "string" ? Uri.parse(u) : u;
    if (!uri || (uri.scheme !== "file" && uri.scheme !== "openfini")) return null;
    return uri.path.replace(/^\/+/, "");
  };
  class WorkspaceEdit {
    constructor() {
      this._e = [];
    }
    replace(uri, range, text) { this._e.push({ uri, edit: new TextEdit(range, text) }); }
    insert(uri, pos, text) { this._e.push({ uri, edit: TextEdit.insert(pos, text) }); }
    delete(uri, range) { this._e.push({ uri, edit: TextEdit.delete(range) }); }
    set(uri, edits) { for (const e of edits || []) this._e.push({ uri, edit: e }); }
    has(uri) { return this._e.some((x) => String(x.uri) === String(uri)); }
    entries() {
      const m = new Map();
      for (const x of this._e) (m.get(String(x.uri)) || m.set(String(x.uri), [x.uri, []]).get(String(x.uri)))[1].push(x.edit);
      return [...m.values()];
    }
    get size() { return this.entries().length; }
    createFile() { throw unsupported("WorkspaceEdit.createFile"); }
    deleteFile() { throw unsupported("WorkspaceEdit.deleteFile"); }
    renameFile() { throw unsupported("WorkspaceEdit.renameFile"); }
  }
  class MarkdownString {
    constructor(value = "", supportThemeIcons = false) {
      this.value = value;
      this.supportThemeIcons = supportThemeIcons;
      this.isTrusted = false;
    }
    appendText(t) { this.value += String(t).replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&"); return this; }
    appendMarkdown(t) { this.value += t; return this; }
    appendCodeblock(code, lang = "") { this.value += `\n\`\`\`${lang}\n${code}\n\`\`\`\n`; return this; }
  }
  class CompletionItem {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
    }
  }
  class CompletionList {
    constructor(items = [], isIncomplete = false) {
      this.items = items;
      this.isIncomplete = isIncomplete;
    }
  }
  class Hover {
    constructor(contents, range) {
      this.contents = Array.isArray(contents) ? contents : [contents];
      this.range = range;
    }
  }
  class Diagnostic {
    constructor(range, message, severity = 0) {
      this.range = range;
      this.message = message;
      this.severity = severity;
    }
  }
  class CodeActionKind {
    constructor(value) {
      this.value = value;
    }
    append(p) { return new CodeActionKind(this.value ? `${this.value}.${p}` : p); }
    contains(o) { return this.value === "" || o.value === this.value || o.value.startsWith(`${this.value}.`); }
    intersects(o) { return this.contains(o) || o.contains(this); }
  }
  for (const [k, v] of Object.entries({ Empty: "", QuickFix: "quickfix", Refactor: "refactor", RefactorExtract: "refactor.extract", RefactorInline: "refactor.inline", RefactorRewrite: "refactor.rewrite", Source: "source", SourceOrganizeImports: "source.organizeImports", SourceFixAll: "source.fixAll" })) CodeActionKind[k] = new CodeActionKind(v);
  class CodeAction {
    constructor(title, kind) {
      this.title = title;
      this.kind = kind;
    }
  }
  class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  }
  class ThemeIcon {
    constructor(id, color) {
      this.id = id;
      this.color = color;
    }
  }
  ThemeIcon.File = new ThemeIcon("file");
  ThemeIcon.Folder = new ThemeIcon("folder");
  class CancellationTokenSource {
    constructor() {
      const em = new EventEmitter();
      this.token = { isCancellationRequested: false, onCancellationRequested: em.event };
      this._em = em;
    }
    cancel() {
      this.token.isCancellationRequested = true;
      this._em.fire();
    }
    dispose() {}
  }
  const enumOf = (names, start = 0) => Object.freeze(Object.fromEntries(names.map((n, i) => [n, i + start]).concat(names.map((n, i) => [i + start, n]))));
  const CompletionItemKind = enumOf(["Text", "Method", "Function", "Constructor", "Field", "Variable", "Class", "Interface", "Module", "Property", "Unit", "Value", "Enum", "Keyword", "Snippet", "Color", "File", "Reference", "Folder", "EnumMember", "Constant", "Struct", "Event", "Operator", "TypeParameter", "User", "Issue"]);

  // ---------------------------------------------------------------- documents and the active editor
  const docs = new Map(); // path -> TextDocument
  function makeDocument(snap) {
    let text = snap.text || "";
    let lines = null;
    const L = () => (lines ||= text.split(/\r?\n/));
    const starts = () => {
      const out = [0];
      for (let i = 0; i < text.length; i++) if (text[i] === "\n") out.push(i + 1);
      return out;
    };
    let st = null;
    const doc = {
      uri: docUri(snap.path),
      fileName: `/${snap.path}`,
      languageId: snap.languageId || "plaintext",
      version: snap.version || 1,
      isDirty: false,
      isUntitled: false,
      isClosed: false,
      eol: 1,
      encoding: "utf8",
      get lineCount() { return L().length; },
      getText(range) {
        if (!range) return text;
        return text.slice(doc.offsetAt(range.start), doc.offsetAt(range.end));
      },
      lineAt(x) {
        const line = typeof x === "number" ? x : x.line;
        if (line < 0 || line >= L().length) throw new Error(`Illegal value for line: ${line}`);
        const t = L()[line];
        const ws = /^\s*/.exec(t)[0].length;
        return { lineNumber: line, text: t, range: new Range(line, 0, line, t.length), rangeIncludingLineBreak: new Range(line, 0, line + 1, 0), firstNonWhitespaceCharacterIndex: ws, isEmptyOrWhitespace: ws === t.length };
      },
      offsetAt(p) {
        st ||= starts();
        const pos = doc.validatePosition(P(p));
        return Math.min(text.length, st[pos.line] + pos.character);
      },
      positionAt(off) {
        st ||= starts();
        const o = Math.max(0, Math.min(text.length, off | 0));
        let lo = 0;
        let hi = st.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (st[mid] <= o) lo = mid;
          else hi = mid - 1;
        }
        return new Position(lo, o - st[lo]);
      },
      validatePosition(p) {
        const line = Math.min(Math.max(0, p.line), L().length - 1);
        return new Position(line, Math.min(Math.max(0, p.character), L()[line].length));
      },
      validateRange(r) { return new Range(doc.validatePosition(r.start), doc.validatePosition(r.end)); },
      getWordRangeAtPosition(p, re) {
        const pos = doc.validatePosition(P(p));
        const t = L()[pos.line];
        const rx = new RegExp((re || /[\w$-]+/).source, "g");
        let m;
        while ((m = rx.exec(t))) {
          if (m.index <= pos.character && m.index + m[0].length >= pos.character && m[0]) return new Range(pos.line, m.index, pos.line, m.index + m[0].length);
          if (!m[0]) rx.lastIndex++;
        }
        return undefined;
      },
      save: async () => false,
      _set(next) {
        text = next.text || "";
        lines = null;
        st = null;
        doc.version = next.version || doc.version + 1;
        doc.languageId = next.languageId || doc.languageId;
      },
    };
    return doc;
  }
  const docFor = (snap) => {
    let d = docs.get(snap.path);
    if (!d) docs.set(snap.path, (d = makeDocument(snap)));
    else if (d.version !== snap.version || d.getText() !== snap.text) d._set(snap);
    return d;
  };
  const sel = (s) => new Selection(s.anchor.line, s.anchor.character, s.active.line, s.active.character);
  let active = null;
  const onActive = new EventEmitter();
  const onSelection = new EventEmitter();
  const onDocChange = new EventEmitter();
  const onDocOpen = new EventEmitter();
  const onConfig = new EventEmitter();
  function makeEditor(doc, selections) {
    const ed = {
      document: doc,
      selections: selections.length ? selections : [new Selection(0, 0, 0, 0)],
      get selection() { return ed.selections[0]; },
      set selection(s) { ed.selections = [s]; call("editor.select", { path: pathOfUri(doc.uri), selections: [s].map(toWireSel) }).catch(() => {}); },
      options: { tabSize: 2, insertSpaces: true },
      viewColumn: 1,
      visibleRanges: [new Range(0, 0, doc.lineCount, 0)],
      async edit(cb) {
        const edits = [];
        const builder = {
          replace: (where, text) => edits.push(where instanceof Position ? TextEdit.insert(where, text) : new TextEdit(where instanceof Selection ? new Range(where.start, where.end) : where, text)),
          insert: (p, text) => edits.push(TextEdit.insert(p, text)),
          delete: (r) => edits.push(TextEdit.delete(r)),
          setEndOfLine: () => {},
        };
        cb(builder);
        if (!edits.length) return true;
        return !!(await call("editor.edit", { path: pathOfUri(doc.uri), version: doc.version, edits: edits.map(toWireEdit) }));
      },
      async insertSnippet(snippet, where) {
        const text = typeof snippet === "string" ? snippet : snippet.value;
        const pos = where ? (where instanceof Position ? where : where.start || where[0]?.start) : ed.selection.active;
        return !!(await call("editor.snippet", { path: pathOfUri(doc.uri), at: { line: pos.line, character: pos.character }, text: String(text) }));
      },
      setDecorations() {
        unsupported("TextEditor.setDecorations");
      },
      revealRange() {},
      show() {},
      hide() {},
    };
    return ed;
  }
  const toWirePos = (p) => ({ line: p.line, character: p.character });
  const toWireSel = (s) => ({ anchor: toWirePos(s.anchor || s.start), active: toWirePos(s.active || s.end) });
  const toWireEdit = (e) => ({ start: toWirePos(e.range.start), end: toWirePos(e.range.end), text: String(e.newText ?? "") });
  function setActive(snap) {
    if (!snap) {
      if (active) {
        active = null;
        onActive.fire(undefined);
      }
      return;
    }
    const before = docs.get(snap.path);
    const oldVersion = before?.version;
    const doc = docFor(snap);
    if (!before) onDocOpen.fire(doc);
    else if (oldVersion !== doc.version) onDocChange.fire({ document: doc, contentChanges: [], reason: undefined });
    const changedEditor = !active || active.document !== doc;
    if (changedEditor) active = makeEditor(doc, (snap.selections || []).map(sel));
    else active.selections = (snap.selections || []).map(sel);
    if (changedEditor) onActive.fire(active);
    else onSelection.fire({ textEditor: active, selections: active.selections, kind: undefined });
  }

  // ---------------------------------------------------------------- configuration
  let settings = CFG.settings || {};
  const defaults = CFG.defaults || {};
  function getConfiguration(section) {
    const pre = section ? `${section}.` : "";
    // like VS Code, the section's values are own properties of the object (extensions spread or destructure it)
    const tree = {};
    for (const [k, v] of Object.entries({ ...defaults, ...settings })) {
      if (pre && !k.startsWith(pre)) continue;
      const parts = k.slice(pre.length).split(".");
      let o = tree;
      for (const p of parts.slice(0, -1)) o = o[p] && typeof o[p] === "object" && !Array.isArray(o[p]) ? o[p] : (o[p] = {});
      o[parts[parts.length - 1]] = v;
    }
    const val = (k) => {
      const full = pre + k;
      if (full in settings) return settings[full];
      if (full in defaults) return defaults[full];
      let o = tree;
      for (const p of String(k).split(".")) {
        if (o === null || typeof o !== "object") return undefined;
        o = o[p];
      }
      return o;
    };
    const cfg = JSON.parse(JSON.stringify(tree));
    const def = (name, value) => Object.defineProperty(cfg, name, { value, enumerable: false });
    def("get", (k, d) => {
      const v = val(k);
      return v === undefined ? d : v;
    });
    def("has", (k) => val(k) !== undefined);
    def("inspect", (k) => ({ key: pre + k, defaultValue: defaults[pre + k], globalValue: settings[pre + k] }));
    def("update", (k, v) => call("config.update", { key: pre + k, value: v === undefined ? null : v }).then(() => undefined));
    return cfg;
  }

  // ---------------------------------------------------------------- providers and commands
  const providers = new Map();
  let handles = 0;
  const register = (kind, selector, provider, extra = {}) => {
    const handle = ++handles;
    providers.set(handle, { kind, provider });
    call("providers.register", { handle, kind, selector: JSON.parse(JSON.stringify(selector ?? null)), ...extra }).catch((e) => log("error", e.message));
    return new Disposable(() => {
      providers.delete(handle);
      call("providers.dispose", { handle }).catch(() => {});
    });
  };
  const commands = new Map();
  const BUILTIN = { "editor.action.formatDocument": "code.format", "editor.action.commentLine": "code.toggleComment", "workbench.action.files.save": "file.save", "undo": "code.undo", "redo": "code.redo", "actions.find": "code.find", "workbench.action.quickOpen": "code.quickOpen", "workbench.action.showCommands": "code.palette", "workbench.action.gotoLine": "code.gotoLine" };
  const md = (x) => (x == null ? "" : typeof x === "string" ? x : x.value !== undefined && typeof x.value === "string" ? (x.language ? `\`\`\`${x.language}\n${x.value}\n\`\`\`` : x.value) : String(x));
  const wireRange = (r) => (r ? { start: toWirePos(r.start || r.inserting?.start || r), end: toWirePos(r.end || r.inserting?.end || r) } : null);
  const wireCommand = (c) => (c && typeof c.command === "string" ? { command: c.command, title: String(c.title || ""), arguments: JSON.parse(JSON.stringify(c.arguments || [])) } : null);
  const wireWsEdit = (we) => (we ? we.entries().map(([uri, edits]) => ({ path: pathOfUri(uri), edits: edits.map(toWireEdit) })) : null);
  const token = () => new CancellationTokenSource().token;

  async function runProvider(p) {
    const entry = providers.get(p.handle);
    if (!entry) return null;
    const doc = docFor(p.doc);
    const pos = p.pos ? new Position(p.pos.line, p.pos.character) : null;
    const prov = entry.provider;
    if (entry.kind === "completion") {
      const res = await prov.provideCompletionItems(doc, pos, token(), { triggerKind: p.trigger ? 1 : 0, triggerCharacter: p.trigger || undefined });
      const items = Array.isArray(res) ? res : res?.items || [];
      return items.slice(0, 500).map((it) => ({
        label: typeof it.label === "string" ? it.label : it.label?.label || "",
        detail: it.detail ? String(it.detail) : typeof it.label === "object" ? it.label?.description || it.label?.detail || "" : "",
        documentation: md(it.documentation),
        kind: typeof it.kind === "number" ? it.kind : null,
        insertText: it.insertText instanceof SnippetString ? null : typeof it.insertText === "string" ? it.insertText : null,
        snippet: it.insertText instanceof SnippetString ? it.insertText.value : null,
        filterText: it.filterText || null,
        sortText: it.sortText || null,
        range: it.range ? wireRange(it.range) : null,
        preselect: !!it.preselect,
      }));
    }
    if (entry.kind === "hover") {
      const h = await prov.provideHover(doc, pos, token());
      if (!h) return null;
      return { contents: (Array.isArray(h.contents) ? h.contents : [h.contents]).map(md).filter(Boolean), range: wireRange(h.range) };
    }
    if (entry.kind === "format" || entry.kind === "rangeFormat") {
      const opts = { tabSize: p.tabSize || 2, insertSpaces: true };
      const edits = entry.kind === "format" ? await prov.provideDocumentFormattingEdits(doc, opts, token()) : await prov.provideDocumentRangeFormattingEdits(doc, new Range(0, 0, doc.lineCount, 0), opts, token());
      return (edits || []).map(toWireEdit);
    }
    if (entry.kind === "codeActions") {
      const range = p.range ? new Range(p.range.start.line, p.range.start.character, p.range.end.line, p.range.end.character) : new Range(pos, pos);
      const acts = (await prov.provideCodeActions(doc, range, { diagnostics: [], only: undefined, triggerKind: 1 }, token())) || [];
      return acts.slice(0, 50).map((a, i) => ({ index: i, title: String(a.title || a.command?.title || "Action"), kind: a.kind?.value || "", edit: wireWsEdit(a.edit), command: wireCommand(a.command || (typeof a.command === "string" ? a : null)) }));
    }
    return null;
  }

  async function invoke(m, p) {
    switch (m) {
      case "command.run": {
        const fn = commands.get(p.id);
        if (!fn) throw new Error(`Command “${p.id}” is not registered (vscode.commands.registerCommand was not called while activating).`);
        const res = await fn(...(Array.isArray(p.args) ? p.args : p.args === undefined || p.args === null ? [] : [p.args]));
        try {
          return res === undefined ? null : JSON.parse(JSON.stringify(res));
        } catch {
          return null;
        }
      }
      case "provider.call":
        return runProvider(p);
      case "editor.update":
        setActive(p.editor);
        return null;
      case "config.changed": {
        settings = p.values || {};
        const keys = p.keys || [];
        onConfig.fire({ affectsConfiguration: (sec) => keys.some((k) => k === sec || k.startsWith(`${sec}.`)) });
        return null;
      }
      case "deactivate":
        for (const d of context.subscriptions.splice(0)) try { d?.dispose?.(); } catch (e) { log("error", e); }
        if (typeof mod.exports?.deactivate === "function") await mod.exports.deactivate();
        return null;
      case "ping":
        return "pong";
      default:
        throw new Error(`Unknown host call ${m}`);
    }
  }

  addEventListener("message", async (e) => {
    const d = e.data;
    if (e.source !== parent || !d || d.ofx !== 1) return;
    if (d.t === "res") {
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.ok) p.resolve(d.r);
      else p.reject(Object.assign(new Error(d.e?.message || "Call failed"), { code: d.e?.code }));
    } else if (d.t === "inv") {
      try {
        send({ t: "ires", id: d.id, ok: true, r: await invoke(d.m, d.p || {}) });
      } catch (err) {
        send({ t: "ires", id: d.id, ok: false, e: { code: "EXT_ERROR", message: String((err && err.message) || err).slice(0, 600) } });
      }
    }
  });

  // ---------------------------------------------------------------- namespaces
  const items = (list) => list.filter((x) => x !== undefined).map((x) => (typeof x === "string" ? x : x?.title || ""));
  const message = (kind) => async (text, ...rest) => {
    const opts = rest[0] && typeof rest[0] === "object" && !("title" in rest[0]) ? rest.shift() : {};
    const raw = rest.flat();
    const idx = await call("window.message", { kind, text: String(text), items: items(raw).slice(0, 6), modal: !!opts.modal, detail: opts.detail ? String(opts.detail) : "" });
    return typeof idx === "number" ? raw[idx] : undefined;
  };
  const channels = new Map();
  const outputChannel = (name) => {
    const ch = {
      name: String(name),
      append: (t) => call("output.append", { channel: ch.name, text: String(t) }).catch(() => {}),
      appendLine: (t) => call("output.append", { channel: ch.name, text: `${t}\n` }).catch(() => {}),
      replace: (t) => call("output.append", { channel: ch.name, text: String(t), replace: true }).catch(() => {}),
      clear: () => call("output.append", { channel: ch.name, text: "", replace: true }).catch(() => {}),
      show: () => call("output.show", { channel: ch.name }).catch(() => {}),
      hide() {},
      dispose: () => channels.delete(ch.name),
    };
    for (const lv of ["trace", "debug", "info", "warn", "error"]) ch[lv] = (msg, ...a) => ch.appendLine(`[${lv}] ${fmt([msg, ...a])}`);
    ch.logLevel = 2;
    ch.onDidChangeLogLevel = new EventEmitter().event;
    channels.set(ch.name, ch);
    return ch;
  };
  const statusItem = () => {
    const it = { text: "", tooltip: "", command: undefined, color: undefined, backgroundColor: undefined, alignment: 1, priority: 0, name: "", show: () => call("window.status", { text: String(it.text), item: true }).catch(() => {}), hide: () => call("window.status", { text: "", item: true }).catch(() => {}), dispose: () => it.hide() };
    return it;
  };
  const toPickItem = (x) => (typeof x === "string" ? { label: x } : { label: String(x?.label ?? ""), description: x?.description ? String(x.description) : "", detail: x?.detail ? String(x.detail) : "", picked: !!x?.picked });

  const window_ = {
    showInformationMessage: message("info"),
    showWarningMessage: message("warning"),
    showErrorMessage: message("error"),
    async showInputBox(o = {}) {
      const v = await call("window.input", { prompt: String(o.prompt || o.title || ""), value: String(o.value || ""), placeHolder: String(o.placeHolder || ""), password: !!o.password, title: String(o.title || "") });
      if (v === null || v === undefined) return undefined;
      if (typeof o.validateInput === "function") {
        const err = await o.validateInput(v);
        if (err) {
          await message("warning")(typeof err === "string" ? err : err.message || "Invalid input");
          return undefined;
        }
      }
      return v;
    },
    async showQuickPick(list, o = {}) {
      const all = await list;
      const arr = Array.isArray(all) ? all : [];
      const res = await call("window.pick", { items: arr.slice(0, 500).map(toPickItem), placeHolder: String(o.placeHolder || o.title || ""), canPickMany: !!o.canPickMany });
      if (res === null || res === undefined) return undefined;
      return o.canPickMany ? res.map((i) => arr[i]) : arr[res];
    },
    createOutputChannel: outputChannel,
    setStatusBarMessage(text, timeoutOrThenable) {
      call("window.status", { text: String(text), timeout: typeof timeoutOrThenable === "number" ? timeoutOrThenable : 5000 }).catch(() => {});
      return new Disposable(() => call("window.status", { text: "" }).catch(() => {}));
    },
    createStatusBarItem: statusItem,
    get activeTextEditor() { return active || undefined; },
    get visibleTextEditors() { return active ? [active] : []; },
    onDidChangeActiveTextEditor: onActive.event,
    onDidChangeTextEditorSelection: onSelection.event,
    onDidChangeVisibleTextEditors: new EventEmitter().event,
    onDidChangeWindowState: new EventEmitter().event,
    state: { focused: true, active: true },
    async showTextDocument(d) {
      const path = pathOfUri(d?.uri || d);
      await call("window.show", { path });
      return active && pathOfUri(active.document.uri) === path ? active : makeEditor(docs.get(path) || docFor({ path, text: "", version: 1 }), []);
    },
    async withProgress(o, task) {
      if (o?.title) call("window.status", { text: String(o.title), timeout: 30000 }).catch(() => {});
      try {
        return await task({ report: (r) => r?.message && call("window.status", { text: String(r.message), timeout: 30000 }).catch(() => {}) }, token());
      } finally {
        call("window.status", { text: "" }).catch(() => {});
      }
    },
    createTextEditorDecorationType: () => ({ key: `deco${++handles}`, dispose() {} }),
  };

  const fs = {
    async readFile(uri) {
      const r = await call("workspace.read", { uri: uri.toString(), bytes: true });
      return r instanceof Uint8Array ? r : new Uint8Array(r || []);
    },
    stat: (uri) => call("workspace.stat", { uri: uri.toString() }),
    async readDirectory(uri) {
      return (await call("workspace.list", { uri: uri.toString() })) || [];
    },
    writeFile: async () => { throw unsupported("workspace.fs.writeFile (project files are read-only for VS Code extensions)"); },
    delete: async () => { throw unsupported("workspace.fs.delete (project files are read-only for VS Code extensions)"); },
    rename: async () => { throw unsupported("workspace.fs.rename"); },
    copy: async () => { throw unsupported("workspace.fs.copy"); },
    createDirectory: async () => { throw unsupported("workspace.fs.createDirectory"); },
    isWritableFileSystem: () => false,
  };
  const diagnostics = new Map();
  const workspace = {
    getConfiguration,
    onDidChangeConfiguration: onConfig.event,
    onDidChangeTextDocument: onDocChange.event,
    onDidOpenTextDocument: onDocOpen.event,
    onDidCloseTextDocument: new EventEmitter().event,
    onDidSaveTextDocument: new EventEmitter().event,
    onWillSaveTextDocument: new EventEmitter().event,
    onDidChangeWorkspaceFolders: new EventEmitter().event,
    get textDocuments() { return [...docs.values()]; },
    get workspaceFolders() { return [{ uri: Uri.from({ scheme: "file", path: "/" }), name: CFG.projectName || "Project", index: 0 }]; },
    get name() { return CFG.projectName || "Project"; },
    rootPath: "/",
    fs,
    isTrusted: false,
    async openTextDocument(x) {
      if (x && typeof x === "object" && !Uri.isUri(x) && ("content" in x || "language" in x)) return makeDocument({ path: `untitled-${++handles}`, text: String(x.content || ""), languageId: x.language || "plaintext", version: 1 });
      const uri = typeof x === "string" ? Uri.file(x) : x;
      const path = pathOfUri(uri);
      if (path === null) throw unsupported(`workspace.openTextDocument for ${uri?.scheme}: URIs`);
      const r = await call("workspace.read", { uri: uri.toString() });
      return docFor({ path, text: r?.text || "", languageId: r?.languageId, version: r?.version || 1 });
    },
    async findFiles(include, exclude, max) {
      const list = await call("workspace.find", { include: typeof include === "string" ? include : include?.pattern || "**/*", exclude: typeof exclude === "string" ? exclude : exclude?.pattern || "", max: max || 1000 });
      return (list || []).map((p) => docUri(p));
    },
    async applyEdit(we) {
      return !!(await call("workspace.applyEdit", { files: wireWsEdit(we) }));
    },
    asRelativePath: (x) => (typeof x === "string" ? x : pathOfUri(x) || String(x)),
    // degraded: the project has one root folder, and file watchers never fire (OpenFini has no file system events)
    getWorkspaceFolder: (uri) => (pathOfUri(uri) !== null ? workspace.workspaceFolders[0] : undefined),
    createFileSystemWatcher: () => ({ ignoreCreateEvents: true, ignoreChangeEvents: true, ignoreDeleteEvents: true, onDidCreate: new EventEmitter().event, onDidChange: new EventEmitter().event, onDidDelete: new EventEmitter().event, dispose() {} }),
  };
  const languages = {
    registerCompletionItemProvider: (sel, prov, ...triggers) => register("completion", sel, prov, { triggers: triggers.map(String).slice(0, 20) }),
    registerHoverProvider: (sel, prov) => register("hover", sel, prov),
    registerDocumentFormattingEditProvider: (sel, prov) => register("format", sel, prov),
    registerDocumentRangeFormattingEditProvider: (sel, prov) => register("rangeFormat", sel, prov),
    registerCodeActionsProvider: (sel, prov) => register("codeActions", sel, prov),
    createDiagnosticCollection(name = "") {
      const store = new Map();
      const push = () => call("diagnostics.set", { owner: String(name), count: [...store.values()].reduce((a, l) => a + l.length, 0) }).catch(() => {});
      const dc = {
        name,
        set(uri, list) {
          if (Array.isArray(uri)) for (const [u, l] of uri) store.set(String(u), l || []);
          else store.set(String(uri), list || []);
          push();
        },
        delete(uri) { store.delete(String(uri)); push(); },
        clear() { store.clear(); push(); },
        get: (uri) => store.get(String(uri)),
        has: (uri) => store.has(String(uri)),
        forEach: (fn) => store.forEach((l, u) => fn(Uri.parse(u), l, dc)),
        dispose() { store.clear(); },
      };
      diagnostics.set(name, dc);
      return dc;
    },
    getLanguages: async () => CFG.languages || [],
    match: (sel, doc) => (sel === "*" || sel === doc.languageId || sel?.language === doc.languageId || (Array.isArray(sel) && sel.some((s) => s === doc.languageId || s?.language === doc.languageId)) ? 10 : 0),
    setLanguageConfiguration: () => new Disposable(() => {}),
    getDiagnostics: () => [],
    // degraded: language status items are accepted but not shown
    createLanguageStatusItem: (id, selector) => ({ id, selector, name: "", text: "", detail: "", severity: 0, busy: false, command: undefined, accessibilityInformation: undefined, dispose() {} }),
    onDidChangeDiagnostics: new EventEmitter().event,
  };
  const commandsNs = {
    registerCommand(id, fn, thisArg) {
      if (typeof fn !== "function") throw new TypeError("handler must be a function");
      commands.set(String(id), thisArg ? fn.bind(thisArg) : fn);
      call("commands.register", { id: String(id) }).catch((e) => log("warn", e.message));
      return new Disposable(() => commands.delete(String(id)));
    },
    registerTextEditorCommand(id, fn, thisArg) {
      return commandsNs.registerCommand(id, async (...args) => {
        if (!active) throw new Error("There is no active editor (open a file in the Code studio).");
        const edits = [];
        const builder = { replace: (r, t) => edits.push(new TextEdit(r instanceof Position ? new Range(r, r) : new Range(r.start, r.end), t)), insert: (p, t) => edits.push(TextEdit.insert(p, t)), delete: (r) => edits.push(TextEdit.delete(new Range(r.start, r.end))), setEndOfLine() {} };
        const res = await fn.call(thisArg, active, builder, ...args);
        if (edits.length) await call("editor.edit", { path: pathOfUri(active.document.uri), version: active.document.version, edits: edits.map(toWireEdit) });
        return res;
      });
    },
    async executeCommand(id, ...args) {
      if (commands.has(id)) return commands.get(id)(...args);
      if (id === "setContext") return undefined;
      if (id === "vscode.open" || id === "vscode.openFolder") throw unsupported(`commands.executeCommand("${id}")`);
      if (BUILTIN[id]) return call("commands.execute", { id: BUILTIN[id] });
      throw unsupported(`commands.executeCommand("${id}")`);
    },
    getCommands: async () => [...commands.keys(), ...Object.keys(BUILTIN)],
  };
  const env = {
    appName: "OpenFini",
    appHost: "web",
    appRoot: "",
    uriScheme: "openfini",
    language: CFG.locale || "en",
    machineId: CFG.machineId,
    sessionId: CFG.sessionId,
    remoteName: undefined,
    shell: "",
    uiKind: 2,
    isTelemetryEnabled: false,
    isNewAppInstall: false,
    onDidChangeTelemetryEnabled: new EventEmitter().event,
    logLevel: 2,
    onDidChangeLogLevel: new EventEmitter().event,
    clipboard: { readText: async () => { throw unsupported("env.clipboard.readText (reading the clipboard is not allowed)"); }, writeText: (t) => call("env.clipboard", { text: String(t) }).then(() => undefined) },
    openExternal: (uri) => call("env.openExternal", { url: String(uri) }).then(Boolean),
  };
  const extSelf = { id: CFG.extId, extensionUri: Uri.parse(`openfini-ext://${CFG.extId}/`), extensionPath: `/${CFG.extId}`, isActive: true, packageJSON: CFG.packageJSON, extensionKind: 2, exports: undefined, activate: async () => undefined };
  const extensions = { getExtension: (id) => (String(id).toLowerCase() === CFG.extId ? extSelf : undefined), get all() { return [extSelf]; }, onDidChange: new EventEmitter().event };
  const l10n = { t: (msg, ...a) => String(typeof msg === "object" ? msg.message : msg).replace(/\{(\d+)\}/g, (_, i) => String(a[i] ?? "")), bundle: undefined, uri: undefined };

  const guard = (ns, obj) =>
    new Proxy(obj, {
      get(t, k) {
        if (k in t || typeof k === "symbol" || k === "then" || k === "toJSON") return t[k];
        const err = unsupported(ns ? `${ns}.${String(k)}` : String(k));
        return () => {
          throw err;
        };
      },
    });
  const api = {
    version: CFG.compatVersion,
    Disposable, EventEmitter, Position, Range, Selection, TextEdit, SnippetString, Uri, WorkspaceEdit, MarkdownString, CompletionItem, CompletionList, Hover, Diagnostic, CodeAction, CodeActionKind, ThemeColor, ThemeIcon, CancellationTokenSource,
    CompletionItemKind,
    CompletionTriggerKind: enumOf(["Invoke", "TriggerCharacter", "TriggerForIncompleteCompletions"]),
    DiagnosticSeverity: enumOf(["Error", "Warning", "Information", "Hint"]),
    LanguageStatusSeverity: enumOf(["Information", "Warning", "Error"]),
    StatusBarAlignment: enumOf(["Left", "Right"], 1),
    ConfigurationTarget: enumOf(["Global", "Workspace", "WorkspaceFolder"], 1),
    EndOfLine: enumOf(["LF", "CRLF"], 1),
    ViewColumn: Object.freeze({ Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 }),
    TextEditorRevealType: enumOf(["Default", "InCenter", "InCenterIfOutsideViewport", "AtTop"]),
    ProgressLocation: Object.freeze({ SourceControl: 1, Window: 10, Notification: 15 }),
    ExtensionMode: enumOf(["Production", "Development", "Test"], 1),
    UIKind: enumOf(["Desktop", "Web"], 1),
    FileType: Object.freeze({ Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 }),
    OverviewRulerLane: Object.freeze({ Left: 1, Center: 2, Right: 4, Full: 7 }),
    DecorationRangeBehavior: enumOf(["OpenOpen", "ClosedClosed", "OpenClosed", "ClosedOpen"]),
    TextDocumentSaveReason: enumOf(["Manual", "AfterDelay", "FocusOut"], 1),
    commands: guard("commands", commandsNs),
    window: guard("window", window_),
    workspace: guard("workspace", workspace),
    languages: guard("languages", languages),
    env: guard("env", env),
    extensions: guard("extensions", extensions),
    l10n,
  };
  const vscode = guard("", api);
  // the namespaces OpenFini does not have at all answer every access with the same helpful error
  for (const ns of ["debug", "tasks", "scm", "tests", "notebooks", "authentication", "comments", "chat", "lm"]) api[ns] = guard(ns, {});

  // ---------------------------------------------------------------- the extension context
  const memento = (scope, initial) => {
    const data = { ...(initial || {}) };
    return {
      get: (k, d) => (k in data ? data[k] : d),
      update(k, v) {
        if (v === undefined) delete data[k];
        else data[k] = v;
        return call("storage.set", { scope, key: String(k), value: v === undefined ? null : JSON.parse(JSON.stringify(v)) }).then(() => undefined);
      },
      keys: () => Object.keys(data),
      setKeysForSync() {},
    };
  };
  const context = {
    subscriptions: [],
    globalState: memento("global", CFG.globalState),
    workspaceState: memento("workspace", CFG.workspaceState),
    secrets: { get: async () => undefined, store: async () => { throw unsupported("ExtensionContext.secrets"); }, delete: async () => undefined, onDidChange: new EventEmitter().event },
    extensionUri: extSelf.extensionUri,
    extensionPath: extSelf.extensionPath,
    asAbsolutePath: (rel) => `${extSelf.extensionPath}/${String(rel).replace(/^\.?\//, "")}`,
    storageUri: Uri.parse(`openfini-storage://${CFG.extId}/workspace`),
    globalStorageUri: Uri.parse(`openfini-storage://${CFG.extId}/global`),
    logUri: Uri.parse(`openfini-log://${CFG.extId}`),
    storagePath: undefined,
    globalStoragePath: `/${CFG.extId}/global`,
    logPath: `/${CFG.extId}/log`,
    extensionMode: 1,
    extension: extSelf,
    environmentVariableCollection: guard("ExtensionContext.environmentVariableCollection", {}),
    languageModelAccessInformation: guard("ExtensionContext.languageModelAccessInformation", {}),
  };

  // ---------------------------------------------------------------- network (only origins the user allowed)
  const allowed = new Set(CFG.network || []);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      /* invalid */
    }
    if (!allowed.has(origin)) throw new TypeError(`Network access to ${origin || url} is blocked: allow it for this extension in OpenFini's extension manager.`);
    const r = await call("network.fetch", { url, init: { method: init.method || "GET", headers: init.headers && typeof init.headers === "object" ? Object.fromEntries(init.headers instanceof Headers ? [...init.headers] : Object.entries(init.headers)) : {}, body: typeof init.body === "string" ? init.body : undefined } });
    return new Response(r.text ?? "", { status: r.status, headers: r.headers });
  };

  // ---------------------------------------------------------------- loading and activation
  const mod = { exports: {} };
  const nodeOnly = new Set(["fs", "child_process", "os", "path", "net", "http", "https", "crypto", "util", "url", "stream", "zlib", "worker_threads", "vm", "tls", "dns", "cluster"]);
  const req = (name) => {
    if (name === "vscode") return vscode;
    const base = String(name).replace(/^node:/, "");
    if (nodeOnly.has(base)) throw new Error(`Cannot find module '${name}': VS Code web extensions run without Node.js (OpenFini runs only the browser build of an extension).`);
    throw new Error(`Cannot find module '${name}': a web extension must be bundled into one file.`);
  };
  globalThis.__vsxDefine = (factory) => {
    try {
      factory.call(mod.exports, mod, mod.exports, req, { env: {}, platform: "browser", versions: {}, cwd: () => "/", nextTick: (f, ...a) => queueMicrotask(() => f(...a)) }, globalThis);
    } catch (err) {
      mod.error = err;
    }
  };
  globalThis.__vsxBoot = async () => {
    try {
      if (mod.error) throw mod.error;
      if (CFG.editor) setActive(CFG.editor);
      const activate = mod.exports?.activate || mod.exports?.default?.activate;
      if (typeof activate === "function") extSelf.exports = await activate(context);
      send({ t: "ready" });
    } catch (err) {
      send({ t: "ready", error: String((err && err.message) || err).slice(0, 600) });
    }
  };
}

export const VSCODE_RUNTIME_SRC = `(${vscodeRuntime.toString()})()`;
