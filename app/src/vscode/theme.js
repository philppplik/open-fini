// VS Code color themes -> OpenFini themes. Pure (no DOM; the contrast helpers of ui/themes.js are pure too).
//
// Public API
//   loadThemeJson(files, path)                 parses a theme file (JSONC) and merges its `include` chain (max 4 levels)
//   convertColorTheme(theme, {label, uiTheme, id}) -> { def, mode, adjusted, mapped }
//       def      a registerTheme() definition with BOTH variants: the theme's own mode gets the full conversion
//                (surfaces, text, accent, editor and syntax colors); the other mode keeps OpenFini's default surfaces
//                and only takes the accent and syntax colors (VS Code themes have a single variant)
//       adjusted variables the contrast check of resolveVars() had to change to stay legible (reported in the UI)
//   tokenColor(rules, scope)                   the foreground the TextMate rules give a scope (VS Code prefix matching)
//   themeIdFor(extId, label)                   a registerTheme-compatible id (lowercase, <= 40 chars)
//
// Invariants: only `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa` values are accepted (no url(), no CSS injection);
// translucent surface colors are composited over the editor background so contrast math stays meaningful.
import { parseJsonc } from "./jsonc.js";
import { readText } from "./vsix.js";
import { composite, resolveVars, hex, mix } from "../ui/themes.js";

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const okColor = (c) => (typeof c === "string" && HEX_RE.test(c.trim()) ? c.trim().toLowerCase() : null);

/** Parses a theme file and merges `include`d files (the including file wins). */
export function loadThemeJson(files, path, depth = 0) {
  const text = readText(files, path);
  if (text === null) throw new Error(`The theme file “${path}” is missing from the package.`);
  const json = parseJsonc(text);
  if (!json || typeof json !== "object") throw new Error(`The theme file “${path}” is not an object.`);
  if (typeof json.include === "string" && depth < 4) {
    const dir = path.split("/").slice(0, -1);
    for (const seg of json.include.replace(/\\/g, "/").split("/")) {
      if (seg === "..") dir.pop();
      else if (seg && seg !== ".") dir.push(seg);
    }
    try {
      const base = loadThemeJson(files, dir.join("/"), depth + 1);
      return { ...base, ...json, colors: { ...base.colors, ...json.colors }, tokenColors: [...(Array.isArray(base.tokenColors) ? base.tokenColors : []), ...(Array.isArray(json.tokenColors) ? json.tokenColors : [])] };
    } catch {
      /* a missing include only loses the base colors */
    }
  }
  return json;
}

/** Normalized TextMate rules: [{ scopes: string[], fg: "#…"|null, fontStyle }]. */
function rulesOf(tokenColors) {
  const out = [];
  for (const r of Array.isArray(tokenColors) ? tokenColors.slice(0, 2000) : []) {
    if (!r || typeof r !== "object" || !r.settings) continue;
    const scopes = (Array.isArray(r.scope) ? r.scope : typeof r.scope === "string" ? r.scope.split(",") : [""]).map((s) => String(s).trim());
    out.push({ scopes, fg: okColor(r.settings.foreground), fontStyle: typeof r.settings.fontStyle === "string" ? r.settings.fontStyle : "" });
  }
  return out;
}

/** The foreground a scope gets: the rule whose selector is the longest prefix of `scope` wins (later rules win ties). */
export function tokenColor(rules, scope) {
  let best = null;
  let bestLen = -1;
  for (const r of rules) {
    if (!r.fg) continue;
    for (const sel of r.scopes) {
      if (!sel) continue;
      const last = sel.split(/\s+/).pop(); // descendant selectors ("meta.tag string") are reduced to their last part
      if ((scope === last || scope.startsWith(`${last}.`)) && last.length >= bestLen) {
        best = r.fg;
        bestLen = last.length;
      }
    }
  }
  return best;
}

const SYNTAX = {
  "--of-syn-keyword": ["keyword.control", "keyword", "storage.type"],
  "--of-syn-string": ["string.quoted.double", "string"],
  "--of-syn-number": ["constant.numeric", "constant.language"],
  "--of-syn-comment": ["comment.line", "comment"],
  "--of-syn-function": ["entity.name.function", "support.function"],
  "--of-syn-tag": ["entity.name.tag"],
  "--of-syn-attr": ["entity.other.attribute-name"],
  "--of-syn-prop": ["support.type.property-name", "variable.other.property", "meta.object-literal.key"],
  "--of-syn-type": ["entity.name.type", "entity.name.class", "support.type", "support.class"],
  "--of-syn-op": ["keyword.operator"],
  "--of-syn-punct": ["punctuation.definition", "punctuation"],
  "--of-syn-heading": ["markup.heading", "entity.name.section"],
  "--of-syn-link": ["markup.underline.link", "string.other.link"],
};

/** `--of-*` variable -> VS Code workbench color keys, first match wins. */
const UI = {
  "--of-bg-canvas": ["editor.background"],
  "--of-editor-bg": ["editor.background"],
  "--of-bg-panel": ["sideBar.background", "panel.background", "editor.background"],
  "--of-bg-bar": ["titleBar.activeBackground", "activityBar.background", "statusBar.background", "sideBar.background"],
  "--of-bg-app": ["editorGroupHeader.tabsBackground", "sideBarSectionHeader.background", "sideBar.background", "editor.background"],
  "--of-bg-raised": ["dropdown.background", "menu.background", "editorWidget.background", "sideBar.background"],
  "--of-bg-input": ["input.background", "dropdown.background"],
  "--of-text": ["foreground", "editor.foreground", "sideBar.foreground"],
  "--of-text-dim": ["descriptionForeground", "sideBar.foreground", "statusBar.foreground"],
  "--of-text-faint": ["editorLineNumber.foreground", "disabledForeground"],
  "--of-border": ["input.border", "dropdown.border", "contrastBorder", "panel.border"],
  "--of-border-soft": ["sideBar.border", "editorGroup.border", "panel.border", "titleBar.border"],
  "--of-accent": ["focusBorder", "button.background", "activityBarBadge.background", "textLink.foreground"],
  "--of-accent-strong": ["button.hoverBackground"],
  "--of-on-accent": ["button.foreground"],
  "--of-danger": ["errorForeground", "editorError.foreground"],
  "--of-ok": ["gitDecoration.addedResourceForeground", "terminal.ansiGreen"],
  "--of-hover": ["list.hoverBackground"],
  "--of-active": ["list.activeSelectionBackground"],
  "--of-editor-select": ["editor.selectionBackground"],
  "--of-selection": ["editor.selectionBackground"],
  "--of-editor-line": ["editor.lineHighlightBackground"],
  "--of-editor-gutter": ["editorLineNumber.foreground"],
};
const SURFACE_KEYS = new Set(["--of-bg-canvas", "--of-editor-bg", "--of-bg-panel", "--of-bg-bar", "--of-bg-app", "--of-bg-raised", "--of-bg-input", "--of-border", "--of-border-soft", "--of-accent", "--of-text", "--of-text-dim", "--of-text-faint", "--of-danger", "--of-ok", "--of-editor-gutter", "--of-on-accent", "--of-accent-strong"]);

export function themeIdFor(extId, label) {
  let h = 5381;
  for (const ch of String(extId)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "theme";
  return `vsc${h.toString(36).slice(0, 5)}-${slug}`.slice(0, 40).replace(/-+$/, "");
}

/** The mode of a VS Code theme: "dark" | "light", plus high contrast. */
export function themeMode(json, uiTheme) {
  const t = String(json?.type || "").toLowerCase();
  if (t === "light" || t === "hclight" || uiTheme === "vs" || uiTheme === "hc-light") return { mode: "light", hc: t === "hclight" || uiTheme === "hc-light" };
  return { mode: "dark", hc: t === "hc" || uiTheme === "hc-black" };
}

/**
 * Converts a parsed VS Code color theme.
 * @param {object} json the theme (after loadThemeJson)
 * @param {{label: string, uiTheme?: string, id: string, group?: string}} o
 */
export function convertColorTheme(json, { label, uiTheme, id, group = "VS Code" }) {
  const colors = json?.colors && typeof json.colors === "object" ? json.colors : {};
  const { mode, hc } = themeMode(json, uiTheme);
  const dark = mode === "dark";
  const rules = rulesOf(json?.tokenColors);
  const editorBg = okColor(colors["editor.background"]) || (dark ? "#1e1e1e" : "#ffffff");
  const own = {};
  const mapped = [];
  for (const [v, keys] of Object.entries(UI)) {
    for (const k of keys) {
      const c = okColor(colors[k]);
      if (!c) continue;
      own[v] = SURFACE_KEYS.has(v) ? composite(c, editorBg) : c;
      mapped.push(k);
      break;
    }
  }
  own["--of-editor-bg"] ||= hex(editorBg);
  own["--of-bg-canvas"] ||= hex(editorBg);
  own["--of-bg-panel"] ||= mix(editorBg, "#000000", dark ? 0.12 : 0.03);
  own["--of-bg-bar"] ||= own["--of-bg-panel"];
  own["--of-bg-app"] ||= own["--of-bg-panel"];
  own["--of-bg-raised"] ||= mix(own["--of-bg-panel"], dark ? "#ffffff" : "#000000", dark ? 0.06 : 0.02);
  const fallbackFg = tokenColor(rules, "") || rules.find((r) => r.scopes.every((s) => !s) && r.fg)?.fg;
  if (!own["--of-text"] && fallbackFg) own["--of-text"] = composite(fallbackFg, editorBg);
  const syntax = {};
  for (const [v, scopes] of Object.entries(SYNTAX)) {
    for (const s of scopes) {
      const c = tokenColor(rules, s);
      if (c) {
        syntax[v] = composite(c, editorBg);
        break;
      }
    }
  }
  const accent = own["--of-accent"] && /^#[0-9a-f]{6}$/.test(own["--of-accent"]) ? own["--of-accent"] : null;
  const native = { ...own, ...syntax };
  const other = { ...syntax, ...(accent ? { "--of-accent": accent } : {}) };
  const def = {
    id,
    name: String(label).slice(0, 40),
    group,
    description: `VS Code ${dark ? "dark" : "light"} theme${hc ? " (high contrast)" : ""}`,
    neutrals: true,
    [mode]: { vars: native },
    [dark ? "light" : "dark"]: { vars: other },
  };
  // contrast check: what resolveVars() had to adjust to keep text and syntax colors legible
  const resolved = resolveVars({ ...def, neutrals: false, light: { vars: def.light.vars }, dark: { vars: def.dark.vars } }, mode);
  const adjusted = Object.keys(native).filter((k) => resolved[k] && /^#/.test(resolved[k]) && /^#/.test(native[k]) && hex(resolved[k]) !== hex(native[k]));
  return { def, mode, hc, adjusted, mapped, tokenRules: rules.length };
}
