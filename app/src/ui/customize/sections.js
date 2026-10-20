// Settings sections added by the customization system. `withCustomization(app, sections)` is called by
// ui/settings-dialog.js: it adds groups to Appearance and Canvas, makes Keyboard shortcuts editable, adds the sections
// Toolbox and menus, Layout and workspaces, Defaults and Profiles, and shows settings registered by extensions.
import { h } from "../../core/util.js";
import { button } from "../controls.js";
import { iconEl } from "../toolbox.js";

const sw = (key, label, hint) => ({ type: "switch", key, label, hint });
const seg = (key, label, options, hint) => ({ type: "segmented", key, label, options, hint });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Loads a pane module on first use. */
export function lazyPane(loader) {
  const host = h("div.of-cz");
  loader()
    .then((pane) => host.replaceChildren(pane))
    .catch((err) => host.replaceChildren(h("div.of-set__empty", `This section could not be loaded: ${err.message}`)));
  return host;
}

/** A small "reset to default" button for a setting row; null while the value is already the default. */
export function resetButton(app, item, rerender) {
  if (!item.key || item.noReset || !app.customize) return null;
  const d = app.customize.defaults();
  if (!app.customize.getSettingDef(item.key) && item.defaultValue === undefined) return null; // only portable settings (never security switches)
  if (!(item.key in d) && item.defaultValue === undefined) return null;
  const cur = item.get ? item.get() : app.prefs[item.key];
  const dflt = item.defaultValue !== undefined ? item.defaultValue : d[item.key];
  if (same(cur, dflt) || (item.get && item.key === "clipContent" && cur === "auto" && d[item.key] == null)) return null;
  const b = h("button.of-set__reset", { type: "button", title: "Reset to default", "aria-label": `Reset ${item.label || item.key} to default` }, iconEl("arrow-counterclockwise"));
  b.addEventListener("click", () => {
    if (item.defaultValue !== undefined) app.setPref(item.key, item.defaultValue);
    else app.customize.resetKeys([item.key]);
    rerender();
  });
  return b;
}

/** "Reset section" button; null when the section has no resettable keys. */
export function sectionResetButton(app, section, rerender) {
  const keys = (section.resetKeys || section.groups.flatMap((g) => g.items.map((i) => i.key))).filter((k) => k && app.customize?.getSettingDef(k));
  if (!keys.length || !app.customize) return null;
  const b = button("Reset section to defaults", () => {
    app.customize.resetKeys([...new Set(keys)]);
    rerender();
    app.toast(`${section.label}: settings reset to their defaults.`, "success", 1800);
  }, { cls: "of-set__resetsec" });
  return b;
}

// ------------------------------------------------------------------ reusable rows

/** A row with a native select; options [{value,label}]. */
export function selectItem(key, label, options, hint, extra = {}) {
  return { type: "custom", key, label, hint, render: (app, rerender) => rowFor(app, { key, label, hint, ...extra }, rerender, selectControl(app, key, options, extra, rerender)) };
}

/** A row with a color input and a "Default" button (empty string = default). */
export function colorItem(key, label, hint, fallback = "#808080") {
  return {
    type: "custom",
    key,
    label,
    hint,
    render(app, rerender) {
      const cur = app.prefs[key] || "";
      const input = h("input.of-set__color", { type: "color", value: cur || fallback, "aria-label": label });
      input.addEventListener("input", () => app.setPref(key, input.value));
      input.addEventListener("change", rerender);
      const ctl = h("div.of-set__ctl", input, h("span.of-set__hint", cur ? cur : "Default"));
      return rowFor(app, { key, label, hint }, rerender, ctl);
    },
  };
}

function selectControl(app, key, options, extra, rerender) {
  const sel = h("select", { "aria-label": extra.label || key });
  for (const o of options) sel.append(h("option", { value: String(o.value) }, o.label));
  const cur = extra.get ? extra.get() : app.prefs[key];
  sel.value = String(cur);
  sel.addEventListener("change", () => {
    const o = options.find((x) => String(x.value) === sel.value);
    (extra.set || ((v) => app.setPref(key, v)))(o ? o.value : sel.value);
    rerender();
  });
  return sel;
}

function rowFor(app, item, rerender, ctl) {
  const reset = resetButton(app, item, rerender);
  return h("div.of-set__row", h("div", h("div.of-set__label", item.label), item.hint ? h("div.of-set__hint", item.hint) : null), h("div.of-set__ctl", ctl, reset));
}

// ------------------------------------------------------------------ groups

const fontChoices = (app) => [
  { value: "inter", label: "Inter (default)" },
  { value: "system", label: "System font" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Monospace" },
  { value: "custom", label: "Custom family…" },
];

function interfaceGroups(app) {
  return [
    {
      title: "Text and shape",
      items: [
        { type: "number", key: "uiFontSize", label: "Interface text size", min: 11, max: 18, step: 1, unit: "px", hint: "Text in menus, panels, dialogs and the status bar. Separate from Interface scale, which enlarges everything including icons." },
        selectItem("uiFont", "Interface font", fontChoices(app), "Inter is bundled; the system, serif and monospace choices use fonts installed on this device."),
        {
          type: "custom",
          key: "uiFontCustom",
          label: "Custom font family",
          render: (a, rerender) => {
            if (a.prefs.uiFont !== "custom") return h("span");
            const input = h("sl-input", { size: "small", value: a.prefs.uiFontCustom || "", placeholder: "For example Segoe UI", "aria-label": "Custom font family" });
            input.addEventListener("sl-change", () => a.setPref("uiFontCustom", input.value.trim()));
            const user = [...a.fonts.keys()];
            const hint = user.length ? `Fonts you added: ${user.join(", ")}.` : "Any font installed on this device, or one you added in the Type panel.";
            return rowFor(a, { key: "uiFontCustom", label: "Custom font family", hint }, rerender, input);
          },
        },
        seg("uiRadius", "Corner radius", [{ value: "sharp", label: "Sharp", text: "Sharp" }, { value: "default", label: "Default", text: "Default" }, { value: "round", label: "Round", text: "Round" }], "Roundness of buttons, fields, menus and dialogs."),
      ],
    },
    {
      title: "Motion and pointer",
      items: [
        seg("animSpeed", "Animation speed", [{ value: "off", label: "No animations", text: "Off" }, { value: "slow", label: "Slow", text: "Slow" }, { value: "normal", label: "Normal", text: "Normal" }, { value: "fast", label: "Fast", text: "Fast" }], "Speed of transitions. Reduce motion (Accessibility) always wins."),
        seg("cursorSize", "Canvas pointer size", [{ value: "default", label: "Default", text: "Default" }, { value: "large", label: "Large", text: "Large" }, { value: "xlarge", label: "Extra large", text: "XL" }], "Enlarges the arrow and the crosshair over the canvas. Other tool cursors keep their normal size."),
      ],
    },
  ];
}

function canvasGroups() {
  return [
    {
      title: "Canvas colors",
      items: [
        colorItem("canvasBg", "Canvas background", "The area around the pages. Empty uses the theme's color.", "#141518"),
        seg("checker", "Transparency checkerboard", [{ value: "light", label: "Light", text: "Light" }, { value: "dark", label: "Dark", text: "Dark" }, { value: "neutral", label: "Neutral", text: "Neutral" }, { value: "solid", label: "None (white)", text: "None" }], "Shown behind transparent pages."),
        seg("checkerSize", "Checkerboard square size", [4, 6, 8, 12].map((v) => ({ value: v, label: `${v} px`, text: String(v) })), "In screen pixels."),
        colorItem("gridColor", "Grid color", "Empty uses the default blue.", "#7882ff"),
        colorItem("guideColor", "Guide color", "Empty uses the default cyan.", "#22d3ee"),
        colorItem("selectionColor", "Selection outline color", "Empty follows the accent color.", "#7a69f2"),
      ],
    },
  ];
}

function defaultsSection(app) {
  return {
    id: "defaults",
    label: "Defaults for new things",
    icon: "file-earmark-plus",
    lead: "What new documents, exports and text start with. You can still change everything in the dialogs.",
    keywords: "default new document size unit dpi color export format quality text font size preset",
    resetKeys: ["newDocDefaults", "exportDefaults", "textDefaults"],
    groups: [],
    custom: () => lazyPane(() => import("./defaults-pane.js").then((m) => m.defaultsPane(app))),
  };
}

/** Adds the customization UI to the list of settings sections. */
export function withCustomization(app, sections) {
  const by = (id) => sections.find((s) => s.id === id);
  const appearance = by("appearance");
  if (appearance) appearance.groups.push(...interfaceGroups(app));
  if (appearance) appearance.keywords += " font family radius corners animation speed pointer cursor";
  const canvas = by("canvas");
  if (canvas) {
    canvas.groups.push(...canvasGroups());
    canvas.keywords += " background checkerboard transparency grid guide selection color";
  }
  const i = sections.findIndex((s) => s.id === "shortcuts");
  const shortcuts = {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    icon: "keyboard",
    lead: "Click a shortcut and press new keys to rebind it. Conflicts are detected before anything changes.",
    keywords: "keys shortcut hotkey keyboard rebind preset import export conflict",
    resetKeys: ["shortcuts", "shortcutPreset"],
    groups: [],
    custom: () => lazyPane(() => import("./keyboard-editor.js").then((m) => m.keyboardEditor(app))),

  };
  const extra = [
    { id: "toolbox", label: "Toolbox and menus", icon: "tools", lead: "Choose the tools, menus and header buttons you want to see. Everything hidden stays reachable from the command palette (Ctrl+K).", keywords: "toolbox tools hide show reorder group menu quick actions header buttons", resetKeys: ["toolbox", "menus", "quickActions"], groups: [], custom: () => lazyPane(() => import("./toolbox-editor.js").then((m) => m.toolboxEditor(app))) },
    { id: "layout", label: "Layout and workspaces", icon: "layout-sidebar-inset", lead: "Panels, dock side and width, and workspaces you can save and restore for each studio.", keywords: "workspace layout panels dock side width reset essentials painting typography", resetKeys: ["layout", "workspaces"], groups: [], custom: () => lazyPane(() => import("./layout-editor.js").then((m) => m.layoutEditor(app))) },
    defaultsSection(app),
    { id: "profiles", label: "Profiles and backup", icon: "sliders2", lead: "Save your setup, switch between named profiles, or move it to another device. Profiles never contain API keys, tokens or documents.", keywords: "profile export import backup restore switch work presentation low power reset everything ofprofile", resetKeys: [], groups: [], custom: () => lazyPane(() => import("./profiles-pane.js").then((m) => m.profilesPane(app))) },
  ];
  if (i >= 0) sections.splice(i, 1, shortcuts, ...extra);
  else sections.push(shortcuts, ...extra);

  // settings registered through app.customize.registerSetting (extensions, future studios)
  const reg = app.customize?.registry;
  if (reg) {
    for (const sectionId of reg.settingSections()) {
      const items = reg.settingsFor(sectionId).map(registeredItem);
      const target = by(sectionId);
      if (target) target.groups.push({ title: "Added by extensions", items });
      else sections.splice(sections.findIndex((s) => s.id === "about"), 0, { id: sectionId, label: sectionId.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), icon: "puzzle", lead: "Settings added by extensions.", keywords: "", groups: [{ title: "Settings", items }] });
    }
  }
  return sections;
}

function registeredItem(def) {
  const base = { key: def.key, label: def.label, hint: def.hint, defaultValue: def.default };
  switch (def.type) {
    case "switch":
      return { ...base, type: "switch" };
    case "segmented":
      return { ...base, type: "segmented", options: def.options.map((o) => (typeof o === "object" ? { text: o.label, ...o } : { value: o, label: String(o), text: String(o) })) };
    case "number":
      return { ...base, type: "number", min: def.min ?? 0, max: def.max ?? 100, step: def.step ?? 1, unit: def.unit };
    case "text":
      return { ...base, type: "text", placeholder: def.placeholder };
    case "select":
      return selectItem(def.key, def.label, def.options.map((o) => (typeof o === "object" ? o : { value: o, label: String(o) })), def.hint);
    default:
      return colorItem(def.key, def.label, def.hint);
  }
}

