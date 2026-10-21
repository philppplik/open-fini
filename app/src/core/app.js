// Application state hub: open documents, per-document view state, selection, tools,
// commands and preferences. UI modules subscribe to its events and never talk to each other directly.
import { Emitter, clone } from "./util.js";
import { Doc } from "./doc.js";
import { Viewport } from "./viewport.js";
import { solid } from "./nodes.js";
import { log } from "./log.js";
import { t, locale as i18nLocale, setLocale as setI18nLocale, onLocaleChange } from "../i18n/index.js";
import { createNetwork } from "./network.js";
import { isSafeMode } from "./bootguard.js";
import { customizationDefaults } from "../customize/schema.js";
import { studioIds, hasStudio, resolveVisibleStudios, overflowStudios, DEFAULT_VISIBLE_STUDIOS } from "../studios/registry.js";

const PREF_KEY = "openfini.prefs.v1";

const defaultPrefs = () => ({
  // appearance and accessibility
  theme: "dark", // mode: dark | light | auto
  themeId: "default", // color theme (ui/themes.js); every theme has a light and a dark variant
  accent: "violet",
  surfaceStyle: "solid", // solid | glass | liquid | sea (ui/glass.js); sits on top of the color theme
  glassBlur: null, // 0-40 px, null = the style's default
  glassTransparency: null, // 0-50 %, null = the style's default
  glassBackdrop: "auto", // auto | aurora | ocean | dusk | seaglass | mono | accent | image
  glassDim: 0, // 0-80 %, darkens the background layer
  glassAnimate: false, // slowly drifting mesh gradient
  density: "default", // compact | default | spacious
  uiScale: 100, // percent
  reduceMotion: "auto", // auto | on | off
  highContrast: false,
  focusRings: false,
  showHints: true, // tooltips
  // onboarding (ui/onboarding.js)
  tours: true, // offer the welcome tour and the per-studio tours
  contextHints: true, // empty-state hints in panels
  toursSeen: {}, // tour id → true
  whatsNewSeen: "", // version whose "What's new" was shown
  recentCommands: [], // command palette history (ids)
  // studios shown in the header, in order (max 5; every other registered studio is in the More menu)
  visibleStudios: [...DEFAULT_VISIBLE_STUDIOS],
  // general
  language: "auto", // "auto" (system language) or a code from i18n/locales.js
  restoreSession: true,
  autosave: true,
  autosaveSeconds: 4,
  showRecent: true, // recent files on the start page
  recentLimit: 12, // recent files remembered (0-50)
  confirmClose: true,
  saveOriginalFormat: true, // File ▸ Save writes an opened .txt / .md / .docx / .svg again in that format while it fits (core/source-format.js)
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
  gitName: "", // author of commits in Source Control
  gitEmail: "",
  previewScripts: true,
  // security and AI
  confirmExternal: true,
  aiEnabled: false,
  updateCheckAuto: false, // check GitHub for a newer release at start-up (once a day); off by default
  updateLastCheck: 0,
  updateSeenVersion: "",
  offlineMode: false, // network kill-switch (core/network.js)
  appLock: false, // mirror of the lock record; the lock itself is in storage (ui/app-lock.js)
  appLockIdleMinutes: 10, // 0 = never lock on idle
  appLockOnHide: false, // lock when the window is hidden or minimized
  protectedMode: true, // website projects from files/folders open with preview scripts off until enabled
  verboseLogging: false, // also record debug-level log entries
  // customization (customize/schema.js): fonts, shortcuts, toolbox, layout, workspaces, defaults
  ...customizationDefaults(),
});

/** A fresh copy of the default preferences (used by customization reset and profiles). */
export const getDefaultPrefs = () => defaultPrefs();

const safeMode = () => isSafeMode(globalThis.location?.search);

function loadPrefs() {
  // Safe mode: saved settings stay untouched on disk but are not applied in this session.
  if (safeMode()) return defaultPrefs();
  try {
    return { ...defaultPrefs(), ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") };
  } catch {
    return defaultPrefs();
  }
}

/** @deprecated Use app.visibleStudios; kept for extensions and old imports. */
export const STUDIO_ORDER = [...DEFAULT_VISIBLE_STUDIOS];

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
    /** True when started with ?safe=1: no session restore, extensions off, AI off, saved settings not applied. Extensions and other loaders must honor it. */
    this.safeMode = safeMode();
    this.log = log; // central logger (core/log.js)
    log.minLevel = this.prefs.verboseLogging ? "debug" : "info";
    /** Offline mode / network kill-switch: `app.network.allowed(kind)` and `app.network.assert(kind)` (core/network.js). */
    this.network = createNetwork(() => this.prefs.offlineMode, { onBlocked: ({ kind, url }) => log.info("network", `Blocked by offline mode: ${kind}${url ? ` (${url.split(/[?#]/)[0]})` : ""}`) });
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
    /** Interface language: `app.i18n.locale()`, `app.i18n.t(...)`, `app.i18n.set("de" | "auto")`. */
    this.i18n = { t, locale: i18nLocale, set: setI18nLocale };
    onLocaleChange(() => {
      this.emit("locale", i18nLocale());
      this.emit("menuschanged");
      this.emit("render");
    });
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
      if (!this.safeMode) localStorage.removeItem(PREF_KEY);
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
    if (key === "verboseLogging") log.minLevel = value ? "debug" : "info";
    if (key === "language") setI18nLocale(value);
    try {
      // Safe mode applies defaults, so only the changed key is merged into the stored settings
      const stored = this.safeMode ? { ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}"), [key]: value } : this.prefs;
      localStorage.setItem(PREF_KEY, JSON.stringify(stored));
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

  /** Studios shown in the header (at most five, user order). */
  get visibleStudios() {
    return resolveVisibleStudios(this.prefs.visibleStudios, studioIds());
  }
  /** Registered studios that are not in the header: listed in the "More" menu. */
  get moreStudios() {
    return overflowStudios(this.visibleStudios, studioIds());
  }
  setVisibleStudios(list) {
    this.setPref("visibleStudios", resolveVisibleStudios(list, studioIds()));
  }

  setStudio(id) {
    if (this.studio === id || !hasStudio(id)) return;
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
    // A command id has exactly one owner; a second registration is a bug (it would silently replace the first).
    if (this.commands.has(id)) log.warn("command", `Command ${id} is registered twice; the later definition wins.`);
    const cmd = { id, ...def };
    if (typeof def.label === "string") {
      // The label is translated when it is READ, so a language switch updates menus, palette and hints without re-registering.
      let source = def.label;
      Object.defineProperty(cmd, "label", { enumerable: true, configurable: true, get: () => t(source), set: (v) => (source = v) });
    }
    this.commands.set(id, cmd);
  }

  run(id, args) {
    const c = this.commands.get(id);
    if (!c) return false;
    if (c.enabled && !c.enabled(this)) return false;
    const fail = (err) => {
      log.error("command", `Command ${id} failed`, err);
      this.toast(err?.message || t("“{name}” failed.", { name: c.label || id }), "danger", 5000, { label: t("Details"), run: () => this.run("help.troubleshoot") });
    };
    try {
      const r = c.run(this, args);
      // async commands report their failures here too (callers that await the result still see the rejection)
      if (r && typeof r.then === "function") r.catch((err) => (err?.name === "AbortError" ? undefined : fail(err)));
      return r ?? true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  isEnabled(id) {
    const c = this.commands.get(id);
    return !!c && (!c.enabled || !!c.enabled(this));
  }

  // ------------------------------------------------------------ feedback

  /** Shows a message. `action` ({label, run}) adds a button to the toast, for example "Details". */
  toast(message, variant = "primary", duration = 3200, action) {
    this.emit("toast", { message: t(message), variant, duration, action }); // literal messages are in the catalog; others stay as written
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
