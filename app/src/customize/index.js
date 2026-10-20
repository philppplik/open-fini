// The customization system, installed as `app.customize`. It owns no state of its own: everything lives in `app.prefs`
// (so it persists, resets and travels in profiles like any other setting) and changes are applied live.
//
//   shortcuts   rebind commands and tools (keymap.js); the effective shortcut is written onto the command objects, so menus,
//               tooltips, the palette and the key handler all see it without knowing about customization
//   toolbox     per-studio tool visibility, order and grouping, menu items, quick actions (toolbox-model.js)
//   layout      panel visibility, dock side/width, named workspaces (toolbox-model.js)
//   profiles    export/import, named profiles (profile.js)
//   registry    registerSetting / registerToolboxEntry for extensions (registry.js)
import { STUDIOS } from "../studios/index.js";
import { buildEntries, setChords, resetChords, validateOverrides, presetOverrides, effective, parseKeymap, exportKeymap } from "./keymap.js";
import { SETTINGS, customizationDefaults, validateSetting, getSettingDef, describeSettings } from "./schema.js";
import { arrangeToolbox, visiblePanels, allWorkspaces, snapshotLayout, cleanWorkspaceName, filterMenuItems, isMenuHidden } from "./toolbox-model.js";
import { buildProfile, stringifyProfile, validateProfile, diffProfile, patchFromDiff, templateProfile, sanitizeStoredProfiles } from "./profile.js";
import { createRegistry } from "./registry.js";

export { customizationDefaults };
const PROFILES_KEY = "openfini.profiles.v1";
const TOOL_CMD = "tool.select.";
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function installCustomization(app, { defaults } = {}) {
  let applying = false;
  const registry = createRegistry((kind) => app.emit(kind === "toolbox" ? "toolboxchanged" : "customize", kind));
  const prefDefaults = () => (defaults ? defaults() : {});

  // ------------------------------------------------------------ tools as commands (reachable from the palette even when hidden)
  function registerToolCommands() {
    for (const [id, C] of app.toolClasses) {
      if (app.commands.has(TOOL_CMD + id) || !C.label) continue;
      app.registerCommand(TOOL_CMD + id, { label: `Tool: ${C.label}`, icon: C.icon, studios: C.studios, enabled: (a) => !!a.doc && a.studio !== "code" && a.studio !== "vibe", run: (a) => a.setTool(id) });
    }
  }

  // ------------------------------------------------------------ shortcuts
  function applyShortcuts() {
    if (applying) return;
    applying = true;
    try {
      const ov = app.prefs.shortcuts || {};
      for (const c of app.commands.values()) {
        if (c.id.startsWith(TOOL_CMD)) continue;
        if (!c._def) c._def = [c.shortcut, c.altShortcut];
        const list = has(ov, c.id) ? ov[c.id] : c._def.filter(Boolean);
        c.shortcut = list[0] || undefined;
        c.altShortcut = list[1] || undefined;
      }
      for (const [id, C] of app.toolClasses) {
        if (!Object.prototype.hasOwnProperty.call(C, "_defShortcut")) C._defShortcut = C.shortcut || "";
        const o = ov[TOOL_CMD + id];
        C.shortcut = o ? o[0] || "" : C._defShortcut;
      }
      app.emit("commands"); // the key handler rebuilds its table
      app.emit("shortcuts");
    } finally {
      applying = false;
    }
  }

  const api = {
    registry,
    registerSetting: (section, def) => {
      const off = registry.registerSetting(section, def);
      if (app.prefs[def.key] === undefined) app.prefs[def.key] = def.default; // not persisted until the user changes it
      return off;
    },
    registerToolboxEntry: (studio, entry) => registry.registerToolboxEntry(studio, entry),
    toolboxExtras: (studio) => registry.toolboxEntries(studio),

    // ---- shortcuts
    entries() {
      const commands = [...app.commands.values()]
        .filter((c) => c.label && !c.id.startsWith(TOOL_CMD) && c.palette !== false)
        .map((c) => ({ id: c.id, label: c.label, studios: c.studios, defaults: c._def || [c.shortcut, c.altShortcut], group: groupOf(c.id) }));
      const tools = [...app.toolClasses].filter(([, C]) => C.label).map(([id, C]) => ({ id: TOOL_CMD + id, label: C.label, studios: C.studios, defaults: [C._defShortcut ?? C.shortcut] }));
      return buildEntries({ commands, tools });
    },
    get shortcutOverrides() {
      return app.prefs.shortcuts || {};
    },
    setShortcut(id, chords, opts) {
      const r = setChords(this.entries(), this.shortcutOverrides, id, chords, opts);
      if (!r.error) {
        app.setPref("shortcuts", r.overrides);
        app.setPref("shortcutPreset", "custom");
      }
      return r;
    },
    resetShortcut(id) {
      app.setPref("shortcuts", resetChords(null, this.shortcutOverrides, id));
    },
    resetShortcuts() {
      app.setPref("shortcuts", {});
      app.setPref("shortcutPreset", "default");
    },
    applyShortcutPreset(id) {
      const o = presetOverrides(id, this.entries());
      if (!o) return false;
      app.setPref("shortcuts", o);
      app.setPref("shortcutPreset", id);
      return true;
    },
    importShortcuts(text, { mode = "merge" } = {}) {
      const r = parseKeymap(text);
      if (!r.ok) return r;
      app.setPref("shortcuts", mode === "replace" ? r.overrides : { ...this.shortcutOverrides, ...r.overrides });
      app.setPref("shortcutPreset", "custom");
      return r;
    },
    exportShortcuts: () => exportKeymap(app.prefs.shortcuts || {}),
    /** Effective chords of a command or tool id. */
    shortcutsOf(id) {
      const e = this.entries().find((x) => x.id === id);
      return e ? effective(e, this.shortcutOverrides) : [];
    },

    // ---- toolbox, menus, quick actions
    toolboxConfig: (studio) => (app.prefs.toolbox || {})[studio] || {},
    setToolboxConfig(studio, cfg) {
      const next = { ...(app.prefs.toolbox || {}) };
      if (Object.keys(cfg).length) next[studio] = cfg;
      else delete next[studio];
      app.setPref("toolbox", next);
      app.emit("toolboxchanged");
    },
    arrangeToolbox: (studio, entries) => arrangeToolbox(entries, (app.prefs.toolbox || {})[studio], (id) => app.toolClasses.has(id)),
    filterMenu: (items) => filterMenuItems(items, app.prefs.menus?.items),
    isMenuHidden: (label) => isMenuHidden(app.prefs.menus, label),
    setMenus(menus) {
      app.setPref("menus", menus);
      app.emit("menuschanged");
    },
    setQuickActions(list) {
      app.setPref("quickActions", list);
      app.emit("quickactions");
    },

    // ---- layout and workspaces
    panelIds: (studio) => ({ top: STUDIOS[studio]?.top || [], bottom: STUDIOS[studio]?.bottom || [] }),
    layout: (studio) => snapshotLayout((app.prefs.layout || {})[studio]),
    visiblePanels: (studio, ids) => visiblePanels(ids, ((app.prefs.layout || {})[studio] || {}).hidden),
    setLayout(studio, state) {
      const s = snapshotLayout(state);
      const next = { ...(app.prefs.layout || {}) };
      if (!s.hidden.length && s.side === "right" && s.width === null) delete next[studio];
      else next[studio] = s;
      app.setPref("layout", next);
      app.emit("layout", studio);
    },
    resetLayout(studio) {
      const next = { ...(app.prefs.layout || {}) };
      if (studio) delete next[studio];
      else for (const k of Object.keys(next)) delete next[k];
      app.setPref("layout", next);
      app.emit("layout", studio || "*");
    },
    workspaces: (studio) => allWorkspaces(studio, api.panelIds(studio), (app.prefs.workspaces || {})[studio]),
    /** Name of the workspace whose state equals the current layout, or "" when customized. */
    activeWorkspace(studio) {
      const cur = JSON.stringify(api.layout(studio));
      return api.workspaces(studio).find((w) => JSON.stringify(snapshotLayout(w.state)) === cur)?.name || "";
    },
    applyWorkspace(studio, name) {
      const w = api.workspaces(studio).find((x) => x.name === name);
      if (!w) return false;
      api.setLayout(studio, w.state);
      return true;
    },
    saveWorkspace(studio, name) {
      const n = cleanWorkspaceName(name);
      if (!n) return "";
      const all = { ...(app.prefs.workspaces || {}) };
      all[studio] = { ...(all[studio] || {}), [n]: snapshotLayout(api.layout(studio)) };
      app.setPref("workspaces", all);
      app.emit("layout", studio);
      return n;
    },
    deleteWorkspace(studio, name) {
      const all = { ...(app.prefs.workspaces || {}) };
      if (!all[studio] || !has(all[studio], name)) return false;
      all[studio] = { ...all[studio] };
      delete all[studio][name];
      if (!Object.keys(all[studio]).length) delete all[studio];
      app.setPref("workspaces", all);
      app.emit("layout", studio);
      return true;
    },

    // ---- settings (generic)
    defaults: prefDefaults,
    /** Sets one portable setting after validating it. Returns { ok, error?, from, to }. */
    set(key, value) {
      const r = validateSetting(key, value);
      if (!r.ok) return r;
      const from = app.prefs[key];
      app.setPref(key, value);
      return { ok: true, from, to: value };
    },
    describe: (opts) => describeSettings(app.prefs, prefDefaults(), opts),
    resetKeys(keys) {
      const d = prefDefaults();
      for (const k of keys) if (getSettingDef(k) && d[k] !== undefined) app.setPref(k, JSON.parse(JSON.stringify(d[k])));
    },
    resetSection(section) {
      api.resetKeys(SETTINGS.filter((s) => s.section === section).map((s) => s.key));
    },

    // ---- profiles
    exportProfile: (name = "My profile") => stringifyProfile(buildProfile(app.prefs, { name, appVersion: app.version || "" })),
    previewProfile(text, mode = "merge") {
      const v = validateProfile(text);
      if (!v.ok) return { ...v, diff: [] };
      return { ...v, diff: diffProfile(app.prefs, prefDefaults(), v.profile, mode) };
    },
    applyProfile(profile, mode = "merge") {
      const diff = diffProfile(app.prefs, prefDefaults(), profile, mode);
      for (const [k, v] of Object.entries(patchFromDiff(diff))) app.setPref(k, v);
      return diff;
    },
    storedProfiles() {
      try {
        return sanitizeStoredProfiles(JSON.parse(localStorage.getItem(PROFILES_KEY) || "{}"));
      } catch {
        return {};
      }
    },
    saveStoredProfiles(profiles) {
      try {
        localStorage.setItem(PROFILES_KEY, JSON.stringify({ profiles }));
      } catch {
        /* private mode */
      }
    },
    /** Saves the current settings as (or into) a named profile. */
    saveProfile(name) {
      const n = cleanWorkspaceName(name);
      if (!n) return "";
      const all = api.storedProfiles();
      all[n] = buildProfile(app.prefs, { name: n });
      api.saveStoredProfiles(all);
      app.setPref("profileActive", n);
      return n;
    },
    createProfileFromTemplate(templateId, name) {
      const n = cleanWorkspaceName(name);
      const p = templateProfile(templateId, { ...prefDefaults() });
      if (!n || !p) return "";
      const all = api.storedProfiles();
      all[n] = { ...p, name: n };
      api.saveStoredProfiles(all);
      return n;
    },
    /** Switches to a stored profile; the active profile is updated with the current settings first. */
    switchProfile(name) {
      const all = api.storedProfiles();
      const target = all[name];
      if (!target) return false;
      const cur = app.prefs.profileActive;
      if (cur && all[cur] && cur !== name) all[cur] = buildProfile(app.prefs, { name: cur });
      api.saveStoredProfiles(all);
      api.applyProfile(target, "replace");
      app.setPref("profileActive", name);
      return true;
    },
    deleteProfile(name) {
      const all = api.storedProfiles();
      if (!all[name]) return false;
      delete all[name];
      api.saveStoredProfiles(all);
      if (app.prefs.profileActive === name) app.setPref("profileActive", "");
      return true;
    },
    /** Every setting, shortcut, workspace and stored profile back to the defaults. */
    resetEverything() {
      app.resetPrefs();
      try {
        localStorage.removeItem(PROFILES_KEY);
      } catch {
        /* private mode */
      }
      app.emit("customize", "reset");
    },
    validateShortcuts: validateOverrides,
    getSettingDef,
  };
  function groupOf(id) {
    const p = String(id).split(".")[0];
    return { file: "File", edit: "Edit", arrange: "Arrange", align: "Align", distribute: "Align", view: "View", studio: "Studios", layer: "Layer", select: "Select", doc: "Document", help: "Help", bool: "Shape", shape: "Shape", pixel: "Pixel", filter: "Filter", code: "Code", vibe: "Vibe", layout: "Layout", text: "Text", table: "Table", chart: "Chart", ext: "Extensions" }[p] || (id.startsWith("ext:") ? "Extensions" : "Other");
  }

  app.customize = api;
  // a damaged or hand-edited stored value must never break the UI: fall back to the default for that setting
  {
    const d = prefDefaults();
    for (const def of SETTINGS) if (app.prefs[def.key] !== undefined && d[def.key] !== undefined && !def.check(app.prefs[def.key])) app.prefs[def.key] = JSON.parse(JSON.stringify(d[def.key]));
  }
  registerToolCommands();
  applyShortcuts();
  app.on("commands", () => {
    if (!applying) applyShortcuts(); // extensions registered commands later: give them their overrides
  });
  app.on("prefs", (key) => {
    if (key === "shortcuts" || key === "*") applyShortcuts();
    if (key === "layout" || key === "toolbox" || key === "*") {
      app.emit("layout", app.studio);
      app.emit("toolboxchanged");
    }
    if (key === "menus" || key === "*") app.emit("menuschanged");
    if (key === "quickActions" || key === "*") app.emit("quickactions");
  });
  // dock side and width are per studio
  app.on("studio", () => import("./apply.js").then((m) => m.applyCustomization(app)));

  // commands that open the customization UI and reset the layout
  const openSettings = (section) => app.emit("dialog", { id: "preferences", section });
  app.registerCommand("customize.shortcuts", { label: "Customize Keyboard Shortcuts…", icon: "keyboard", run: () => openSettings("shortcuts") });
  app.registerCommand("customize.toolbox", { label: "Customize Toolbox and Menus…", icon: "tools", run: () => openSettings("toolbox") });
  app.registerCommand("customize.layout", { label: "Customize Layout and Workspaces…", icon: "layout-sidebar-inset", run: () => openSettings("layout") });
  app.registerCommand("customize.profiles", { label: "Profiles: Export, Import and Switch…", icon: "sliders2", run: () => openSettings("profiles") });
  app.registerCommand("workspace.reset", { label: "Reset Layout of this Studio", icon: "arrow-counterclockwise", run: (a) => a.customize.resetLayout(a.studio) });
  app.registerCommand("workspace.save", {
    label: "Save Current Layout as Workspace…",
    icon: "save",
    run: async (a) => {
      const { promptDialog } = await import("../ui/dialogs.js");
      const name = await promptDialog({ title: "Save workspace", label: "Name", value: "My workspace", ok: "Save" });
      if (name == null) return;
      const n = a.customize.saveWorkspace(a.studio, name);
      a.toast(n ? `Workspace “${n}” saved for the ${STUDIOS[a.studio].label} studio.` : "Enter a name for the workspace.", n ? "success" : "warning", 2200);
    },
  });
  return api;
}
