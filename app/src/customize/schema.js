// The customization schema: every portable setting with its type, range and validator. Pure (no DOM).
// It is the single source of truth for profiles (import validation), the Vibe tools `get_settings` / `set_setting`
// and the documentation. Settings that are security relevant (AI switch, app lock, offline mode, protected mode, tokens)
// are deliberately NOT in this list: they are never exported, imported or changed by the assistant.
import { validateOverrides } from "./keymap.js";

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const ID_RE = /^[A-Za-z0-9_.:@-]{1,120}$/;
const STUDIO_IDS = ["vector", "pixel", "layout", "code", "vibe"];
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const NAME_RE = /^[^\u0000-\u001f<>]{1,40}$/;

/** Built-in quick actions of the header (more can be added: any command id). */
export const QUICK_ACTIONS = ["undo", "redo", "theme", "export", "panels"];

/** Shown by default (theme toggle and panel toggle are optional extras: Settings > Toolbox and menus). */
export const DEFAULT_QUICK_ACTIONS = ["undo", "redo", "export", "collab.open"];

/** The default of versions up to 0.5: stored unchanged by users who never customized it, so it is migrated. */
export const LEGACY_QUICK_ACTIONS = ["undo", "redo", "theme", "export", "panels"];

/** Defaults of the preferences added by the customization system (merged into `defaultPrefs()` in core/app.js). */
export function customizationDefaults() {
  return {
    uiFontSize: 13, // px, the base text size of menus, panels and dialogs
    uiFont: "inter", // inter | system | serif | mono | custom
    uiFontCustom: "",
    uiRadius: "default", // sharp | default | round
    animSpeed: "normal", // off | slow | normal | fast
    cursorSize: "default", // default | large | xlarge
    canvasBg: "", // "" = theme
    checker: "light", // light | dark | neutral | solid
    checkerSize: 6,
    gridColor: "",
    guideColor: "",
    selectionColor: "",
    shortcuts: {},
    shortcutPreset: "default",
    toolbox: {},
    menus: { menus: [], items: [] },
    quickActions: DEFAULT_QUICK_ACTIONS.slice(),
    layout: {},
    workspaces: {},
    newDocDefaults: {},
    exportDefaults: {},
    textDefaults: {},
    profileActive: "",
  };
}

const bool = (v) => typeof v === "boolean";
const int = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const oneOf = (...opts) => (v) => opts.includes(v);
const color = (v) => v === "" || (typeof v === "string" && COLOR_RE.test(v));
const strList = (max, re = ID_RE) => (v) => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && re.test(x));

function validToolbox(v) {
  if (!isObj(v)) return false;
  return Object.entries(v).every(([studio, t]) => STUDIO_IDS.includes(studio) && isObj(t) && Object.keys(t).every((k) => ["hidden", "order", "ungroup"].includes(k)) && Object.values(t).every(strList(200)));
}
function validMenus(v) {
  return isObj(v) && Object.keys(v).every((k) => k === "menus" || k === "items") && (v.menus === undefined || strList(60, /^[^\u0000-\u001f<>]{1,40}$/)(v.menus)) && (v.items === undefined || strList(600)(v.items));
}
const validPanelState = (s) => isObj(s) && Object.keys(s).every((k) => ["hidden", "side", "width"].includes(k)) && (s.hidden === undefined || strList(60)(s.hidden)) && (s.side === undefined || s.side === "left" || s.side === "right") && (s.width === undefined || s.width === null || (Number.isFinite(s.width) && s.width >= 220 && s.width <= 560));
function validLayout(v) {
  return isObj(v) && Object.entries(v).every(([studio, s]) => STUDIO_IDS.includes(studio) && validPanelState(s));
}
function validWorkspaces(v) {
  if (!isObj(v)) return false;
  return Object.entries(v).every(([studio, list]) => STUDIO_IDS.includes(studio) && isObj(list) && Object.keys(list).length <= 24 && Object.entries(list).every(([name, s]) => NAME_RE.test(name) && name !== "__proto__" && validPanelState(s)));
}
const UNITS = ["px", "mm", "cm", "in", "pt"];
function validNewDoc(v) {
  if (!isObj(v)) return false;
  return Object.entries(v).every(([studio, d]) => ["vector", "pixel", "layout"].includes(studio) && isObj(d) && Object.entries(d).every(([k, x]) => {
    if (k === "width" || k === "height") return Number.isFinite(x) && x >= 1 && x <= 100000;
    if (k === "unit") return UNITS.includes(x);
    if (k === "dpi") return Number.isFinite(x) && x >= 36 && x <= 1200;
    if (k === "bg") return typeof x === "string" && COLOR_RE.test(x);
    if (k === "transparent") return bool(x);
    return false;
  }));
}
function validExport(v) {
  return isObj(v) && Object.entries(v).every(([k, x]) => (k === "format" && ["png", "jpg", "webp", "svg", "pdf", "psd"].includes(x)) || (k === "scale" && [0.5, 1, 2, 3, 4].includes(x)) || (k === "quality" && Number.isFinite(x) && x >= 0.01 && x <= 1) || (k === "transparent" && bool(x)));
}
function validText(v) {
  return isObj(v) && Object.entries(v).every(([k, x]) => (k === "fontFamily" && typeof x === "string" && /^[\w .'-]{1,60}$/.test(x)) || (k === "fontSize" && Number.isFinite(x) && x >= 4 && x <= 999) || (k === "fontWeight" && [100, 200, 300, 400, 500, 600, 700, 800, 900].includes(x)) || (k === "lineHeight" && Number.isFinite(x) && x >= 0.5 && x <= 4) || (k === "align" && ["left", "center", "right", "justify"].includes(x)));
}

/**
 * Portable settings. `section` groups them for the assistant and the docs; `type` is informational ("json" = structured).
 * `check(value)` returns true when the value is acceptable.
 */
export const SETTINGS = [
  // general
  { key: "restoreSession", section: "general", type: "boolean", label: "Restore my last session", check: bool },
  { key: "autosave", section: "general", type: "boolean", label: "Autosave to this device", check: bool },
  { key: "autosaveSeconds", section: "general", type: "integer", label: "Autosave delay (seconds)", min: 2, max: 120, check: int(2, 120) },
  { key: "confirmClose", section: "general", type: "boolean", label: "Ask before closing unsaved documents", check: bool },
  { key: "saveOriginalFormat", section: "general", type: "boolean", label: "Save opened files in their original format when possible", check: bool },
  // appearance
  { key: "theme", section: "appearance", type: "enum", options: ["dark", "light", "auto"], label: "Mode", check: oneOf("dark", "light", "auto") },
  { key: "themeId", section: "appearance", type: "string", label: "Color theme id", check: (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) },
  { key: "accent", section: "appearance", type: "string", label: "Accent color id", check: (v) => typeof v === "string" && /^[a-z]{1,16}$/.test(v) },
  { key: "accentCustom", section: "appearance", type: "color", label: "Custom accent color", check: color },
  { key: "surfaceStyle", section: "appearance", type: "enum", options: ["solid", "glass", "liquid", "sea"], label: "Surface style", check: oneOf("solid", "glass", "liquid", "sea") },
  { key: "glassBlur", section: "appearance", type: "integer", min: 0, max: 40, label: "Glass blur (px, empty = style default)", check: (v) => v === null || int(0, 40)(v) },
  { key: "glassTransparency", section: "appearance", type: "integer", min: 0, max: 50, label: "Glass transparency (%, empty = style default)", check: (v) => v === null || int(0, 50)(v) },
  { key: "glassBackdrop", section: "appearance", type: "enum", options: ["auto", "aurora", "ocean", "dusk", "seaglass", "mono", "accent", "image"], label: "Glass background layer (your own image is never exported)", check: oneOf("auto", "aurora", "ocean", "dusk", "seaglass", "mono", "accent", "image") },
  { key: "glassDim", section: "appearance", type: "integer", min: 0, max: 80, label: "Glass background dimming (%)", check: int(0, 80) },
  { key: "glassAnimate", section: "appearance", type: "boolean", label: "Animate the glass background", check: bool },
  { key: "seaTint", section: "appearance", type: "enum", options: ["accent", "teal", "custom"], label: "Sea glass tint (follow the accent, classic teal or an own hue)", check: oneOf("accent", "teal", "custom") },
  { key: "seaHue", section: "appearance", type: "integer", min: 0, max: 359, label: "Sea glass hue (degrees, for the custom tint)", check: int(0, 359) },
  { key: "glassRefraction", section: "appearance", type: "integer", min: 0, max: 100, label: "Liquid glass refraction strength (%)", check: int(0, 100) },
  { key: "glassBevel", section: "appearance", type: "integer", min: 4, max: 40, label: "Liquid glass edge thickness (px)", check: int(4, 40) },
  { key: "glassSpecular", section: "appearance", type: "integer", min: 0, max: 100, label: "Liquid glass specular highlight (%)", check: int(0, 100) },
  { key: "glassDispersion", section: "appearance", type: "integer", min: 0, max: 100, label: "Liquid glass chromatic dispersion (%)", check: int(0, 100) },
  { key: "density", section: "appearance", type: "enum", options: ["compact", "default", "spacious"], label: "Density", check: oneOf("compact", "default", "spacious") },
  { key: "uiScale", section: "appearance", type: "integer", min: 80, max: 160, label: "Interface scale (%)", check: int(80, 160) },
  { key: "uiFontSize", section: "appearance", type: "integer", min: 11, max: 18, label: "Interface text size (px)", check: int(11, 18) },
  { key: "uiFont", section: "appearance", type: "enum", options: ["inter", "system", "serif", "mono", "custom"], label: "Interface font", check: oneOf("inter", "system", "serif", "mono", "custom") },
  { key: "uiFontCustom", section: "appearance", type: "string", label: "Custom interface font family", check: (v) => typeof v === "string" && /^[\w .'-]{0,60}$/.test(v) },
  { key: "uiRadius", section: "appearance", type: "enum", options: ["sharp", "default", "round"], label: "Corner radius", check: oneOf("sharp", "default", "round") },
  { key: "animSpeed", section: "appearance", type: "enum", options: ["off", "slow", "normal", "fast"], label: "Animation speed", check: oneOf("off", "slow", "normal", "fast") },
  { key: "cursorSize", section: "appearance", type: "enum", options: ["default", "large", "xlarge"], label: "Canvas pointer size", check: oneOf("default", "large", "xlarge") },
  // accessibility
  { key: "highContrast", section: "accessibility", type: "boolean", label: "High contrast", check: bool },
  { key: "reduceMotion", section: "accessibility", type: "enum", options: ["auto", "on", "off"], label: "Reduce motion", check: oneOf("auto", "on", "off") },
  { key: "focusRings", section: "accessibility", type: "boolean", label: "Always show focus outlines", check: bool },
  { key: "showHints", section: "accessibility", type: "boolean", label: "Show tooltips", check: bool },
  { key: "tours", section: "accessibility", type: "boolean", label: "Offer tours", check: bool },
  { key: "contextHints", section: "accessibility", type: "boolean", label: "Show hints in empty panels", check: bool },
  // canvas
  { key: "rulers", section: "canvas", type: "boolean", label: "Show rulers", check: bool },
  { key: "clipContent", section: "canvas", type: "tristate", label: "Clip content to the page (null = per studio)", check: (v) => v === null || bool(v) },
  { key: "lowPower", section: "canvas", type: "enum", options: ["auto", "on", "off"], label: "Low-power mode", check: oneOf("auto", "on", "off") },
  { key: "historyMB", section: "canvas", type: "integer", min: 8, max: 1024, label: "Undo history memory (MB)", check: int(8, 1024) },
  { key: "canvasBg", section: "canvas", type: "color", label: "Canvas background color (empty = theme)", check: color },
  { key: "checker", section: "canvas", type: "enum", options: ["light", "dark", "neutral", "solid"], label: "Transparency checkerboard", check: oneOf("light", "dark", "neutral", "solid") },
  { key: "checkerSize", section: "canvas", type: "enum", options: [4, 6, 8, 12], label: "Checkerboard square size (px)", check: oneOf(4, 6, 8, 12) },
  { key: "gridColor", section: "canvas", type: "color", label: "Grid color (empty = default)", check: color },
  { key: "guideColor", section: "canvas", type: "color", label: "Guide color (empty = default)", check: color },
  { key: "selectionColor", section: "canvas", type: "color", label: "Selection outline color (empty = accent)", check: color },
  // code studio
  { key: "codeTabSize", section: "code", type: "enum", options: [2, 4, 8], label: "Tab size", check: oneOf(2, 4, 8) },
  { key: "codeWordWrap", section: "code", type: "boolean", label: "Wrap long lines", check: bool },
  { key: "codeFontSize", section: "code", type: "integer", min: 10, max: 24, label: "Editor font size", check: int(10, 24) },
  { key: "codeFormatOnSave", section: "code", type: "boolean", label: "Format on save", check: bool },
  { key: "codeFormatOnPaste", section: "code", type: "boolean", label: "Format pasted code", check: bool },
  { key: "codeUseTabs", section: "code", type: "boolean", label: "Indent with tabs when formatting", check: bool },
  { key: "codeLineWidth", section: "code", type: "integer", min: 40, max: 240, label: "Formatter line width", check: int(40, 240) },
  { key: "codeQuoteStyle", section: "code", type: "enum", options: ["keep", "double", "single"], label: "Attribute quote style when formatting", check: oneOf("keep", "double", "single") },
  { key: "codeSyncHighlight", section: "code", type: "boolean", label: "Sync highlighting between the preview and the code", check: bool },
  { key: "codeLayout", section: "code", type: "enum", options: ["auto", "codeLeft", "codeRight", "codeTop", "codeBottom"], label: "Split layout of the Code studio", check: oneOf("auto", "codeLeft", "codeRight", "codeTop", "codeBottom") },
  { key: "codeMeasureUnit", section: "code", type: "enum", options: ["px", "mm", "cm", "in", "pt", "rem", "em", "%"], label: "Measure tool unit", check: oneOf("px", "mm", "cm", "in", "pt", "rem", "em", "%") },
  { key: "codeMeasurePpi", section: "code", type: "integer", min: 20, max: 1000, label: "Measure tool pixels per inch (96 = CSS reference)", check: int(20, 1000) },
  { key: "codeMeasureDpr", section: "code", type: "boolean", label: "Measure tool counts device pixels", check: bool },
  { key: "codeViewportSizes", section: "code", type: "json", label: "Saved preview sizes", check: (v) => Array.isArray(v) && v.length <= 12 && v.every((s) => s && typeof s.name === "string" && Number.isFinite(s.w) && Number.isFinite(s.h)) },
  // structured customization
  { key: "shortcuts", section: "keyboard", type: "json", label: "Keyboard shortcut overrides", check: (v) => validateOverrides(v).ok && isObj(v) },
  { key: "shortcutPreset", section: "keyboard", type: "string", label: "Shortcut preset", check: (v) => typeof v === "string" && /^[a-z]{1,16}$/.test(v) },
  { key: "toolbox", section: "toolbox", type: "json", label: "Toolbox customization per studio", check: validToolbox },
  { key: "menus", section: "toolbox", type: "json", label: "Hidden menus and menu items", check: validMenus },
  { key: "quickActions", section: "toolbox", type: "json", label: "Quick actions in the header", check: strList(30) },
  { key: "layout", section: "layout", type: "json", label: "Panel visibility, dock side and width per studio", check: validLayout },
  { key: "workspaces", section: "layout", type: "json", label: "Saved workspaces per studio", check: validWorkspaces },
  { key: "newDocDefaults", section: "defaults", type: "json", label: "Default new-document settings per studio", check: validNewDoc },
  { key: "exportDefaults", section: "defaults", type: "json", label: "Default export settings", check: validExport },
  { key: "textDefaults", section: "defaults", type: "json", label: "Default text style", check: validText },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
export const SETTING_KEYS = SETTINGS.map((s) => s.key);
export const getSettingDef = (key) => BY_KEY.get(key) || null;
export const isPortableKey = (key) => BY_KEY.has(key);
/** Keys that must never travel in a profile or be set by the assistant, even if someone adds them to a file. */
export const FORBIDDEN_KEY = /key|token|secret|passw|passphrase|credential|apikey|auth|aiEnabled|appLock|offlineMode|protectedMode|confirmExternal|gitEmail|gitName/i;

/** Checks one value against the schema. */
export function validateSetting(key, value) {
  const def = BY_KEY.get(key);
  if (!def) return { ok: false, error: FORBIDDEN_KEY.test(key) ? `“${key}” is a protected setting and cannot be changed here.` : `Unknown setting “${key}”.` };
  if (!def.check(value)) {
    let want = def.type;
    if (def.options) want = `one of ${def.options.join(", ")}`;
    else if (def.min !== undefined) want = `a whole number from ${def.min} to ${def.max}`;
    else if (def.type === "color") want = "a color like #1a2b3c (or an empty string for the default)";
    return { ok: false, error: `Invalid value for ${key}: expected ${want}.` };
  }
  return { ok: true };
}

/** Settings of a section (or all) with their current values, for the assistant. */
export function describeSettings(prefs, defaults, { section = "", keys = null } = {}) {
  return SETTINGS.filter((s) => (!section || s.section === section) && (!keys || keys.includes(s.key))).map((s) => {
    const o = { key: s.key, section: s.section, label: s.label, type: s.type, value: prefs[s.key] === undefined ? defaults[s.key] : prefs[s.key], default: defaults[s.key] };
    if (s.options) o.options = s.options;
    if (s.min !== undefined) Object.assign(o, { min: s.min, max: s.max });
    return o;
  });
}
