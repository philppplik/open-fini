// Application state hub: open documents, per-document view state, selection, tools,
// commands and preferences. UI modules subscribe to its events and never talk to each other directly.
import { Emitter, clone } from "./util.js";
import { Doc } from "./doc.js";
import { Viewport } from "./viewport.js";
import { solid } from "./nodes.js";

const PREF_KEY = "openfini.prefs.v1";

const defaultPrefs = () => ({
  // appearance and accessibility
  theme: "dark", // dark | light | auto
  accent: "violet",
  density: "default", // compact | default | spacious
  uiScale: 100, // percent
  reduceMotion: "auto", // auto | on | off
  highContrast: false,
  focusRings: false,
  showHints: true, // tooltips
  // general
  restoreSession: true,
  autosave: true,
  autosaveSeconds: 4,
  confirmClose: true,
  // canvas and performance
  lowPower: "auto", // auto | on | off
  rulers: true,
  clipContent: null, // null = per studio default
  historyMB: 96,
  // code studio
  codeTabSize: 2,
  codeWordWrap: false,
  codeFontSize: 13,
  codeFormatOnSave: false,
  previewScripts: true,
  // security and AI
  confirmExternal: true,
  aiEnabled: false,
});

function loadPrefs() {
  try {
    return { ...defaultPrefs(), ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") };
  } catch {
    return defaultPrefs();
  }
}

export const STUDIO_ORDER = ["vector", "pixel", "layout", "code", "vibe"];

export class App extends Emitter {
  constructor() {
    super();
    this.docs = [];
    /** @type {Doc|null} */
    this.doc = null;
    this.states = new Map(); // Doc → state
    this.studio = "vector";
    this.toolClasses = new Map();
    this.tools = new Map(); // instances
    this.tool = null;
    this.prevTool = null;
    this.commands = new Map();
    this.prefs = loadPrefs();
    this._toolOpts = {};
    // current drawing style shared by shape tools and panels
    this.style = {
      fill: solid("#7c6df2"),
      stroke: null,
      primary: "#000000", // pixel foreground color
      secondary: "#ffffff", // pixel background color
    };
    this.brush = { size: 32, hardness: 0.7, opacity: 1, flow: 1, spacing: 0.12, smoothing: 0.35, pressureSize: true, pressureOpacity: false };
    this.clip = null; // internal clipboard
    this.perf = this.#resolvePerf();
    this.fonts = new Map(); // user supplied fonts
  }

  /** Raw bytes of a user-supplied font for PDF embedding (null for system fonts → standard PDF fonts). */
  fontBytes(font) {
    return this.fonts.get(font.family) || null;
  }

  // ------------------------------------------------------------ preferences / performance

  #resolvePerf() {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 8;
    const auto = cores <= 4 || mem <= 4;
    const low = this.prefs.lowPower === "on" || (this.prefs.lowPower === "auto" && auto);
    return {
      low,
      dprCap: low ? 1 : 2,
      shadows: !low,
      historyBytes: (low ? Math.min(32, this.prefs.historyMB) : this.prefs.historyMB) * 1024 * 1024,
      fxDuringDrag: !low,
    };
  }

  /** Restores every preference to its default. */
  resetPrefs() {
    this.prefs = defaultPrefs();
    try {
      localStorage.removeItem(PREF_KEY);
    } catch {
      /* private mode */
    }
    this.perf = this.#resolvePerf();
    for (const d of this.docs) d.history.limitBytes = this.perf.historyBytes;
    this.emit("prefs", "*");
    this.emit("render");
  }

  setPref(key, value) {
    this.prefs[key] = value;
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs));
    } catch {
      /* private mode */
    }
    this.perf = this.#resolvePerf();
    for (const d of this.docs) d.history.limitBytes = this.perf.historyBytes;
    this.emit("prefs", key);
    this.emit("render");
  }

  // ------------------------------------------------------------ documents

  get state() {
    return this.doc ? this.states.get(this.doc) : null;
  }
  get view() {
    return this.state?.view || null;
  }
  get page() {
    return this.state?.page || this.doc?.pages[0] || null;
  }
  get selection() {
    return this.state?.selection || [];
  }
  get activeNode() {
    const s = this.selection;
    return s.length ? s[s.length - 1] : null;
  }
  /** Container whose children are directly selectable (a group being edited, or the page root). */
  get context() {
    return this.state?.group || this.page?.root || null;
  }

  openDoc(doc, { activate = true } = {}) {
    if (!this.docs.includes(doc)) {
      this.docs.push(doc);
      doc.history.limitBytes = this.perf.historyBytes;
      this.states.set(doc, { doc, view: new Viewport(), selection: [], page: doc.pages[0], group: null, pixelMask: null, maskTarget: false, fitted: false });
      doc.on("change", (ev) => this.#onDocChange(doc, ev));
      this.emit("docs");
    }
    if (activate) this.activateDoc(doc);
    return doc;
  }

  activateDoc(doc) {
    if (this.doc === doc) return;
    this.tool?.deactivate();
    this.doc = doc;
    this.emit("doc", doc);
    this.emit("selection");
    this.tool?.activate();
    this.emit("render");
  }

  closeDoc(doc) {
    const i = this.docs.indexOf(doc);
    if (i < 0) return;
    this.docs.splice(i, 1);
    this.states.delete(doc);
    if (this.doc === doc) {
      this.doc = null;
      this.activateDoc(this.docs[Math.min(i, this.docs.length - 1)] || null);
      if (!this.doc) {
        this.emit("doc", null);
        this.emit("selection");
      }
    }
    this.emit("docs");
    this.emit("render");
  }

  #onDocChange(doc, ev) {
    if (doc !== this.doc) return;
    const st = this.state;
    if (ev.structure || ev.history) {
      const keep = st.selection.filter((n) => doc.find(n.id) === n);
      if (keep.length !== st.selection.length) {
        st.selection = keep;
        this.emit("selection");
      }
      if (st.group && doc.find(st.group.id) !== st.group) st.group = null;
      if (!doc.pages.includes(st.page) && !doc.masters.includes(st.page)) st.page = doc.pages[0];
    }
    this.emit("docchange", ev);
    this.emit("render");
  }

  // ------------------------------------------------------------ selection

  select(nodes, { add = false, toggle = false } = {}) {
    const st = this.state;
    if (!st) return;
    const list = (Array.isArray(nodes) ? nodes : nodes ? [nodes] : []).filter(Boolean);
    let next;
    if (toggle) {
      next = st.selection.slice();
      for (const n of list) {
        const i = next.indexOf(n);
        if (i >= 0) next.splice(i, 1);
        else next.push(n);
      }
    } else if (add) {
      next = st.selection.slice();
      for (const n of list) if (!next.includes(n)) next.push(n);
    } else next = list;
    const same = next.length === st.selection.length && next.every((n, i) => n === st.selection[i]);
    if (same) return;
    st.selection = next;
    const first = next[next.length - 1];
    if (first && first._page && first._page !== st.page && (this.doc.pages.includes(first._page) || this.doc.masters.includes(first._page))) st.page = first._page;
    this.emit("selection");
    this.emit("render");
  }

  clearSelection() {
    this.select([]);
  }
  isSelected(node) {
    return this.selection.includes(node);
  }

  setActivePage(page) {
    const st = this.state;
    if (!st || st.page === page) return;
    st.page = page;
    st.group = null;
    st.pixelMask = null;
    this.emit("page", page);
    this.emit("selection");
    this.emit("render");
  }

  /** Selects what lives inside `group` (enter-group editing). */
  enterGroup(group) {
    const st = this.state;
    if (!st) return;
    st.group = group;
    this.emit("context");
    this.emit("render");
  }
  exitGroup() {
    const st = this.state;
    if (!st?.group) return;
    const g = st.group;
    st.group = g._parent && g._parent !== this.page.root ? g._parent : null;
    this.select([g]);
    this.emit("context");
  }

  // ------------------------------------------------------------ studios & tools

  setStudio(id) {
    if (this.studio === id) return;
    this.studio = id;
    const cls = this.tool && this.toolClasses.get(this.tool.id);
    if (!cls || !this.studioHasTool(id, cls)) this.setTool(this.defaultToolFor(id));
    this.emit("studio", id);
    this.emit("render");
  }

  studioHasTool(studio, cls) {
    return cls.studios.includes(studio);
  }
  defaultToolFor(studio) {
    return studio === "pixel" ? "brush" : studio === "layout" ? "move" : "move";
  }

  registerTool(Cls) {
    this.toolClasses.set(Cls.id, Cls);
  }

  setTool(id) {
    if (this.tool?.id === id) return;
    const Cls = this.toolClasses.get(id);
    if (!Cls) return;
    this.tool?.cancel();
    this.tool?.deactivate();
    this.prevTool = this.tool?.id || null;
    if (!this.tools.has(id)) this.tools.set(id, new Cls(this));
    this.tool = this.tools.get(id);
    this.tool.activate();
    this.emit("tool", id);
    this.emit("overlay");
  }

  toolOptions(id) {
    if (!this._toolOpts[id]) {
      const Cls = this.toolClasses.get(id);
      const o = {};
      for (const c of Cls?.options || []) o[c.key] = clone(c.default);
      this._toolOpts[id] = o;
    }
    return this._toolOpts[id];
  }

  setToolOption(id, key, value) {
    this.toolOptions(id)[key] = value;
    this.emit("toolopts", { id, key });
    this.tools.get(id)?.refresh?.();
    this.emit("overlay");
  }

  // ------------------------------------------------------------ commands

  registerCommand(id, def) {
    this.commands.set(id, { id, ...def });
  }

  run(id, args) {
    const c = this.commands.get(id);
    if (!c) return false;
    if (c.enabled && !c.enabled(this)) return false;
    try {
      return c.run(this, args) ?? true;
    } catch (err) {
      console.error(`Command ${id} failed`, err);
      this.toast(err?.message || `“${c.label || id}” failed.`, "danger");
      return false;
    }
  }

  isEnabled(id) {
    const c = this.commands.get(id);
    return !!c && (!c.enabled || !!c.enabled(this));
  }

  // ------------------------------------------------------------ feedback

  toast(message, variant = "primary", duration = 3200) {
    this.emit("toast", { message, variant, duration });
  }
  status(text) {
    this.emit("status", text);
  }
  requestRender() {
    this.emit("render");
  }
  requestOverlay() {
    this.emit("overlay");
  }

  /** Page-space → screen space (CSS px) for overlay drawing. */
  pageToScreen(x, y, page = this.page) {
    return this.view.toScreen(x + page.x, y + page.y);
  }
  screenToPage(sx, sy, page = this.page) {
    const [x, y] = this.view.toDoc(sx, sy);
    return [x - page.x, y - page.y];
  }

  newDoc(opts) {
    const doc = new Doc(opts);
    this.openDoc(doc);
    return doc;
  }
}
