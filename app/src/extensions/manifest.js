// Extension manifest (`openfini-extension.json`): constants, a pure validator with helpful messages, and the
// consistency check between a manifest and the files of its package. No DOM, no app access.
import { parseVersion, validRange, satisfies } from "./semver.js";

export const MANIFEST_FILE = "openfini-extension.json";
export const API_VERSION = 1;
export const STUDIO_IDS = ["vector", "pixel", "layout", "code", "vibe"];
export const MENU_NAMES = ["File", "Edit", "Layer", "Arrange", "Shape", "Select", "Filter", "Text", "Document", "View", "Insert", "Go", "Studio", "Help", "context:canvas", "context:code", "context:explorer", "context:layers", "context:text"];
export const FLAG_PERMISSIONS = ["document.read", "document.write", "ui", "storage", "files", "export", "vibe", "commands"];
export const ID_RE = /^[a-z0-9][a-z0-9-]{1,30}\.[a-z0-9][a-z0-9-]{1,40}$/;
const LOCAL_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{1,40}$/;
const PATH_RE = /^(?!\/)(?!.*(^|\/)\.\.?(\/|$))[^\\:*?"<>|\0]+$/;
const ICON_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const VAR_RE = /^--(of|sl)-[a-z0-9-]{1,60}$/;
const VALUE_RE = /^(?!.*(url\(|@import|expression|javascript:))[#a-zA-Z0-9\s.,%()/_+*-]{1,200}$/;
const KEY_RE = /^(?:(?:Mod|Alt|Shift)\+)*(?:[A-Z0-9]|F\d{1,2}|Enter|Escape|Tab|Space|Backspace|Delete|Arrow(?:Up|Down|Left|Right)|[\[\]\\;'",./=+-])$/;
const ACTIVATION = /^(onStartup|onStudio:(vector|pixel|layout|code|vibe)|onCommand:[A-Za-z][A-Za-z0-9._-]{0,63}|onFileType:[a-z0-9]{1,10})$/;
const LIMITS = { commands: 100, menus: 100, keybindings: 100, panels: 10, themes: 20, templates: 50, importers: 20, exporters: 20, vibeTools: 20, vibeSkills: 20, snippets: 300, settings: 40 };

/** Normalizes an origin pattern ("https://api.example.com", "https://*.example.com", "http://localhost:8080") or null. */
export function normalizeOrigin(s) {
  const m = /^(https?):\/\/((?:\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:\d{1,5})?$/i.exec(String(s ?? "").trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if (scheme === "http" && !local) return null; // plain http only for the developer's own machine
  if (local && host.startsWith("*")) return null;
  return `${scheme}://${host}${m[4] || ""}`;
}

/** Validates a permission string; returns an error message or null. */
export function permissionError(p) {
  if (typeof p !== "string") return "must be a string";
  if (FLAG_PERMISSIONS.includes(p)) return null;
  if (p.startsWith("network:")) return normalizeOrigin(p.slice(8)) ? null : `“${p}”: use network:https://host (or https://*.host); plain http is only allowed for localhost`;
  return `unknown permission “${p}”. Known: ${FLAG_PERMISSIONS.join(", ")}, network:<origin>`;
}

class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }
  err(path, msg) {
    this.errors.push({ path, message: `${path}: ${msg}` });
  }
  warn(path, msg) {
    this.warnings.push({ path, message: `${path}: ${msg}` });
  }
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const str = (r, path, v, { max = 200, min = 1, required = true, re, reHint } = {}) => {
  if (v === undefined || v === null) {
    if (required) r.err(path, "is required");
    return undefined;
  }
  if (typeof v !== "string") return void r.err(path, `must be a string, got ${typeof v}`);
  if (v.length < min || v.length > max) return void r.err(path, `must be ${min}–${max} characters`);
  if (re && !re.test(v)) return void r.err(path, `${reHint || "has an invalid format"}; got “${v.slice(0, 40)}”`);
  return v;
};
const list = (r, path, v, max) => {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return void r.err(path, "must be an array") || [];
  if (v.length > max) r.err(path, `has ${v.length} entries, the maximum is ${max}`);
  return v.slice(0, max);
};
const studios = (r, path, v) => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((s) => STUDIO_IDS.includes(s))) return void r.err(path, `must be an array of ${STUDIO_IDS.join(", ")}`);
  return [...new Set(v)];
};
const pathStr = (r, path, v, ext) => {
  const s = str(r, path, v, { max: 200, re: PATH_RE, reHint: "must be a relative path inside the package (no “..”, no leading “/”)" });
  if (s && ext && !ext.test(s)) r.err(path, `must end in ${ext.source.replace(/[\\$()]/g, "")}`);
  return s;
};

/** JSON-ish schema subset for tool arguments (checked structurally; the host validates the arguments with it). */
function checkSchema(r, path, s, depth = 0) {
  if (!isObj(s)) return void r.err(path, "must be a JSON Schema object");
  if (depth > 6) return void r.err(path, "is nested too deeply");
  if (depth === 0 && s.type !== "object") r.err(`${path}.type`, "must be “object” at the top level");
  if (s.properties !== undefined) {
    if (!isObj(s.properties)) r.err(`${path}.properties`, "must be an object");
    else for (const [k, v] of Object.entries(s.properties)) checkSchema(r, `${path}.properties.${k}`, v, depth + 1);
  }
  if (s.items !== undefined) checkSchema(r, `${path}.items`, s.items, depth + 1);
  if (JSON.stringify(s).length > 8000) r.err(path, "is larger than 8 KB");
}

/**
 * Validates a parsed manifest.
 * @param {any} raw the parsed JSON
 * @param {{hostVersion?: string}} [opts]
 * @returns {{ok: boolean, errors: {path:string,message:string}[], warnings: {path:string,message:string}[], manifest: object|null}}
 */
export function validateManifest(raw, { hostVersion } = {}) {
  const r = new Report();
  if (!isObj(raw)) {
    r.err("manifest", "must be a JSON object");
    return { ok: false, errors: r.errors, warnings: r.warnings, manifest: null };
  }
  const KNOWN = ["$schema", "id", "name", "version", "description", "publisher", "icon", "engines", "main", "activationEvents", "permissions", "contributes", "homepage", "license", "repository", "keywords"];
  for (const k of Object.keys(raw)) if (!KNOWN.includes(k)) r.warn(k, "is not a known manifest field and is ignored");

  const id = str(r, "id", raw.id, { max: 72, re: ID_RE, reHint: "must look like publisher.name (lowercase letters, digits and “-”, e.g. acme.grid-tools)" });
  const name = str(r, "name", raw.name, { max: 60 });
  const version = str(r, "version", raw.version, { max: 40 });
  if (version && !parseVersion(version)) r.err("version", `must be a semantic version such as 1.0.0; got “${version}”`);
  const description = str(r, "description", raw.description, { max: 300, required: false }) || "";
  let engine = "";
  if (!isObj(raw.engines) || raw.engines.openfini === undefined) r.err("engines.openfini", 'is required, e.g. { "engines": { "openfini": ">=0.3.0" } }');
  else if (typeof raw.engines.openfini !== "string" || !validRange(raw.engines.openfini)) r.err("engines.openfini", `“${raw.engines.openfini}” is not a valid semver range (examples: ">=0.3.0", "^0.4.0", "0.3.x")`);
  else {
    engine = raw.engines.openfini.trim();
    if (hostVersion && !satisfies(hostVersion, engine)) r.err("engines.openfini", `this extension needs OpenFini ${engine}, but you are running ${hostVersion}`);
  }
  let icon;
  if (raw.icon !== undefined) {
    if (typeof raw.icon === "string" && ICON_NAME.test(raw.icon)) icon = raw.icon;
    else icon = pathStr(r, "icon", raw.icon, /\.(png|svg|webp)$/i);
  }
  const main = raw.main === undefined ? undefined : pathStr(r, "main", raw.main, /\.js$/i);

  // permissions
  const permissions = [];
  for (const [i, p] of list(r, "permissions", raw.permissions, 40).entries()) {
    const e = permissionError(p);
    if (e) r.err(`permissions[${i}]`, e);
    else if (!permissions.includes(p.startsWith("network:") ? `network:${normalizeOrigin(p.slice(8))}` : p)) permissions.push(p.startsWith("network:") ? `network:${normalizeOrigin(p.slice(8))}` : p);
  }

  // contributions
  const c = raw.contributes === undefined ? {} : raw.contributes;
  if (!isObj(c)) r.err("contributes", "must be an object");
  const cc = isObj(c) ? c : {};
  const CKEYS = ["commands", "menus", "keybindings", "panels", "themes", "templates", "importers", "exporters", "vibeTools", "vibeSkills", "settings", "snippets"];
  for (const k of Object.keys(cc)) if (!CKEYS.includes(k)) r.warn(`contributes.${k}`, `is not a known contribution point (${CKEYS.join(", ")})`);

  const commands = [];
  for (const [i, x] of list(r, "contributes.commands", cc.commands, LIMITS.commands).entries()) {
    const p = `contributes.commands[${i}]`;
    if (!isObj(x)) {
      r.err(p, "must be an object");
      continue;
    }
    const cid = str(r, `${p}.id`, x.id, { max: 64, re: LOCAL_ID, reHint: "must start with a letter and use letters, digits, “.”, “_” or “-”" });
    const title = str(r, `${p}.title`, x.title, { max: 80 });
    if (cid && commands.some((y) => y.id === cid)) r.err(`${p}.id`, `“${cid}” is declared twice`);
    const cmd = { id: cid, title, category: str(r, `${p}.category`, x.category, { max: 40, required: false }), icon: x.icon === undefined ? undefined : str(r, `${p}.icon`, x.icon, { max: 41, re: ICON_NAME }), studios: studios(r, `${p}.studios`, x.studios), requires: undefined };
    if (x.requires !== undefined) {
      if (["document", "selection"].includes(x.requires)) cmd.requires = x.requires;
      else r.err(`${p}.requires`, 'must be "document" or "selection"');
    }
    if (cid && title) commands.push(cmd);
  }
  const hasCmd = (id) => commands.some((x) => x.id === id);

  const menus = [];
  for (const [i, x] of list(r, "contributes.menus", cc.menus, LIMITS.menus).entries()) {
    const p = `contributes.menus[${i}]`;
    if (!isObj(x)) {
      r.err(p, "must be an object");
      continue;
    }
    if (!MENU_NAMES.includes(x.menu)) r.err(`${p}.menu`, `must be one of ${MENU_NAMES.join(", ")}; got “${x.menu}”`);
    else if (!hasCmd(x.command)) r.err(`${p}.command`, `“${x.command}” is not declared in contributes.commands`);
    else menus.push({ menu: x.menu, command: x.command, studios: studios(r, `${p}.studios`, x.studios), group: x.group === undefined ? undefined : str(r, `${p}.group`, x.group, { max: 40 }) });
  }

  const keybindings = [];
  for (const [i, x] of list(r, "contributes.keybindings", cc.keybindings, LIMITS.keybindings).entries()) {
    const p = `contributes.keybindings[${i}]`;
    if (!isObj(x)) {
      r.err(p, "must be an object");
      continue;
    }
    if (!hasCmd(x.command)) r.err(`${p}.command`, `“${x.command}” is not declared in contributes.commands`);
    else if (typeof x.key !== "string" || !KEY_RE.test(x.key)) r.err(`${p}.key`, `“${x.key}” is not a valid shortcut. Use Mod (Ctrl/Cmd), Alt, Shift and one key, e.g. "Mod+Alt+G"`);
    else keybindings.push({ command: x.command, key: x.key, studios: studios(r, `${p}.studios`, x.studios) });
  }

  const panels = [];
  for (const [i, x] of list(r, "contributes.panels", cc.panels, LIMITS.panels).entries()) {
    const p = `contributes.panels[${i}]`;
    if (!isObj(x)) {
      r.err(p, "must be an object");
      continue;
    }
    const pid = str(r, `${p}.id`, x.id, { max: 64, re: LOCAL_ID });
    const title = str(r, `${p}.title`, x.title, { max: 30 });
    const html = pathStr(r, `${p}.html`, x.html, /\.html?$/i);
    const st = studios(r, `${p}.studios`, x.studios) || ["vector", "pixel", "layout", "code"];
    if (st.includes("vibe")) r.err(`${p}.studios`, "Vibe Studio has no dock; panels can live in vector, pixel, layout and code");
    if (x.location !== undefined && !["top", "bottom"].includes(x.location)) r.err(`${p}.location`, 'must be "top" or "bottom"');
    if (pid && title && html) panels.push({ id: pid, title, html, icon: x.icon === undefined ? "puzzle" : str(r, `${p}.icon`, x.icon, { max: 41, re: ICON_NAME }), studios: st.filter((s) => s !== "vibe"), location: x.location });
  }

  const themes = [];
  for (const [i, x] of list(r, "contributes.themes", cc.themes, LIMITS.themes).entries()) {
    const p = `contributes.themes[${i}]`;
    if (!isObj(x)) {
      r.err(p, "must be an object");
      continue;
    }
    const tid = str(r, `${p}.id`, x.id, { max: 64, re: LOCAL_ID });
    const label = str(r, `${p}.label`, x.label, { max: 40 });
    const t = { id: tid, label, dark: undefined, light: undefined };
    for (const mode of ["dark", "light"]) {
      if (x[mode] === undefined) continue;
      if (!isObj(x[mode])) {
        r.err(`${p}.${mode}`, "must be an object of CSS variables");
        continue;
      }
      const vars = {};
      for (const [k, v] of Object.entries(x[mode])) {
        if (!VAR_RE.test(k)) r.err(`${p}.${mode}.${k}`, "variable names must start with --of- or --sl-");
        else if (typeof v !== "string" || !VALUE_RE.test(v)) r.err(`${p}.${mode}.${k}`, `“${String(v).slice(0, 30)}” is not a plain CSS value (colors, lengths and shadows only; no url() or @import)`);
        else vars[k] = v;
      }
      t[mode] = vars;
    }
    if (!t.dark || !t.light) r.err(p, 'needs both a "dark" and a "light" object of CSS variables (every theme must support both)');
    if (tid && label) themes.push(t);
  }

  const templates = [];
  for (const [i, x] of list(r, "contributes.templates", cc.templates, LIMITS.templates).entries()) {
    const p = `contributes.templates[${i}]`;
    if (!isObj(x)) {
      r.err(p, "must be an object");
      continue;
    }
    const tid = str(r, `${p}.id`, x.id, { max: 64, re: LOCAL_ID });
    const label = str(r, `${p}.label`, x.label, { max: 60 });
    const kind = x.kind === "website" ? "website" : "design";
    const t = { id: tid, label, kind, description: str(r, `${p}.description`, x.description, { max: 200, required: false }) };
    if (kind === "website") {
      if (!isObj(x.files) || !Object.keys(x.files).length) r.err(`${p}.files`, "website templates need a files object { \"index.html\": \"templates/index.html\" } mapping project paths to package files");
      else {
        t.files = {};
        for (const [k, v] of Object.entries(x.files)) {
          if (!PATH_RE.test(k)) r.err(`${p}.files.${k}`, "is not a valid project path");
          else t.files[k] = pathStr(r, `${p}.files.${k}`, v);
        }
      }
    } else {
      t.studio = ["vector", "pixel", "layout"].includes(x.studio) ? x.studio : "vector";
      t.width = Math.min(20000, Math.max(16, Math.round(+x.width || 1080)));
      t.height = Math.min(20000, Math.max(16, Math.round(+x.height || 1080)));
      if (!Array.isArray(x.steps) || x.steps.length > 200 || !x.steps.every((s) => isObj(s) && typeof s.tool === "string" && (s.args === undefined || isObj(s.args)))) r.err(`${p}.steps`, 'must be an array (max 200) of { "tool": "add_shape", "args": {…} }');
      else t.steps = x.steps.map((s) => ({ tool: s.tool, args: s.args || {} }));
    }
    if (tid && label) templates.push(t);
  }

  const handlers = (key, label) => {
    const out = [];
    for (const [i, x] of list(r, `contributes.${key}`, cc[key], LIMITS[key]).entries()) {
      const p = `contributes.${key}[${i}]`;
      if (!isObj(x)) {
        r.err(p, "must be an object");
        continue;
      }
      const hid = str(r, `${p}.id`, x.id, { max: 64, re: LOCAL_ID });
      const title = str(r, `${p}.title`, x.title, { max: 60 });
      const exts = (Array.isArray(x.extensions) ? x.extensions : x.extension !== undefined ? [x.extension] : []).map((e) => String(e).toLowerCase().replace(/^\./, ""));
      if (!exts.length || exts.length > 10 || !exts.every((e) => /^[a-z0-9]{1,10}$/.test(e))) r.err(`${p}.extensions`, `needs 1–10 file extensions without dots, e.g. ["gpl"] for a ${label}`);
      if (!hasCmd(x.command)) r.err(`${p}.command`, `“${x.command}” is not declared in contributes.commands`);
      if (hid && title && exts.length && hasCmd(x.command)) out.push({ id: hid, title, extensions: exts, command: x.command });
    }
    return out;
  };
  const importers = handlers("importers", "file importer");
  const exporters = handlers("exporters", "file exporter");

  const vibeTools = [];
  for (const [i, x] of list(r, "contributes.vibeTools", cc.vibeTools, LIMITS.vibeTools).entries()) {
    const p = `contributes.vibeTools[${i}]`;
    if (!isObj(x)) {
      r.err(p, "must be an object");
      continue;
    }
    const tn = str(r, `${p}.name`, x.name, { max: 41, re: TOOL_NAME, reHint: "must be snake_case (letters, digits, “_”)" });
    const d = str(r, `${p}.description`, x.description, { max: 600, min: 10 });
    const schema = x.inputSchema === undefined ? { type: "object", properties: {} } : x.inputSchema;
    const before = r.errors.length;
    checkSchema(r, `${p}.inputSchema`, schema);
    if (tn && vibeTools.some((y) => y.name === tn)) r.err(`${p}.name`, `“${tn}” is declared twice`);
    if (tn && d && r.errors.length === before) vibeTools.push({ name: tn, description: d, inputSchema: schema });
  }

  const vibeSkills = [];
  for (const [i, x] of list(r, "contributes.vibeSkills", cc.vibeSkills, LIMITS.vibeSkills).entries()) {
    const p = `contributes.vibeSkills[${i}]`;
    if (!isObj(x)) {
      r.err(p, "must be an object");
      continue;
    }
    if (x.file !== undefined) {
      const f = pathStr(r, `${p}.file`, x.file, /\.md$/i);
      if (f) vibeSkills.push({ file: f });
    } else if (typeof x.body === "string" && typeof x.name === "string" && x.body.length <= 20000) vibeSkills.push({ name: x.name.slice(0, 60), description: str(r, `${p}.description`, x.description, { max: 300, required: false }) || "", body: x.body });
    else r.err(p, 'needs a "file" (path to a SKILL.md) or inline "name", "description" and "body"');
  }

  let settings;
  if (cc.settings !== undefined) {
    const props = isObj(cc.settings) ? cc.settings.properties : undefined;
    if (!isObj(props)) r.err("contributes.settings", 'must be { "properties": { "key": { "type": "boolean|string|number", "default": …, "title": "…" } } }');
    else {
      settings = { properties: {} };
      const entries = Object.entries(props);
      if (entries.length > LIMITS.settings) r.err("contributes.settings.properties", `has more than ${LIMITS.settings} settings`);
      for (const [k, v] of entries.slice(0, LIMITS.settings)) {
        const p = `contributes.settings.properties.${k}`;
        if (!LOCAL_ID.test(k)) r.err(p, "setting keys must start with a letter and use letters, digits, “.”, “_” or “-”");
        else if (!isObj(v) || !["boolean", "string", "number"].includes(v.type)) r.err(`${p}.type`, 'must be "boolean", "string" or "number"');
        else {
          const ok = v.default === undefined || typeof v.default === v.type;
          if (!ok) r.err(`${p}.default`, `must be a ${v.type}`);
          settings.properties[k] = { type: v.type, title: str(r, `${p}.title`, v.title, { max: 60, required: false }) || k, description: str(r, `${p}.description`, v.description, { max: 200, required: false }), default: v.default, enum: Array.isArray(v.enum) && v.type !== "boolean" ? v.enum.filter((e) => typeof e === v.type).slice(0, 40) : undefined, min: typeof v.min === "number" ? v.min : undefined, max: typeof v.max === "number" ? v.max : undefined };
        }
      }
    }
  }

  const snippets = [];
  for (const [i, x] of list(r, "contributes.snippets", cc.snippets, LIMITS.snippets).entries()) {
    const p = `contributes.snippets[${i}]`;
    if (!isObj(x)) {
      r.err(p, "must be an object");
      continue;
    }
    if (!["html", "css", "javascript"].includes(x.language)) r.err(`${p}.language`, 'must be "html", "css" or "javascript"');
    const label = str(r, `${p}.label`, x.label, { max: 60 });
    const body = str(r, `${p}.body`, x.body, { max: 8000 });
    if (label && body && ["html", "css", "javascript"].includes(x.language)) snippets.push({ language: x.language, label, detail: str(r, `${p}.detail`, x.detail, { max: 80, required: false }) || "", body });
  }

  // activation: explicit events + the ones implied by the contributions (like VS Code)
  const events = list(r, "activationEvents", raw.activationEvents, 50).filter((e, i) => {
    if (typeof e === "string" && ACTIVATION.test(e)) return true;
    r.err(`activationEvents[${i}]`, `“${e}” is not valid. Use onStartup, onStudio:<studio>, onCommand:<command id> or onFileType:<extension>`);
    return false;
  });
  for (const e of events) if (e.startsWith("onCommand:") && !hasCmd(e.slice(10))) r.warn("activationEvents", `${e} refers to a command that is not declared in contributes.commands`);
  const implied = [...commands.map((x) => `onCommand:${x.id}`), ...importers.flatMap((x) => x.extensions.map((e) => `onFileType:${e}`))];
  const activationEvents = [...new Set([...events, ...implied])];

  // needs-main checks
  const needsMain = commands.length || importers.length || exporters.length || vibeTools.length;
  if (needsMain && !main) r.err("main", "is required because this extension contributes commands, importers, exporters or Vibe tools that run code");
  if (vibeTools.length && !permissions.includes("vibe")) r.err("permissions", 'contributes.vibeTools needs the "vibe" permission');
  if (!Object.keys(raw).length) r.err("manifest", "is empty");

  const manifest = r.errors.length
    ? null
    : {
        id, name, version, description, publisher: id.split(".")[0], icon, engines: { openfini: engine }, main, activationEvents, permissions,
        homepage: typeof raw.homepage === "string" && /^https:\/\//.test(raw.homepage) ? raw.homepage.slice(0, 200) : undefined,
        license: typeof raw.license === "string" ? raw.license.slice(0, 40) : undefined,
        contributes: { commands, menus, keybindings, panels, themes, templates, importers, exporters, vibeTools, vibeSkills, settings, snippets },
      };
  return { ok: r.errors.length === 0, errors: r.errors, warnings: r.warnings, manifest };
}

/** All package files a (valid) manifest refers to. */
export function referencedFiles(m) {
  const out = [];
  if (m.main) out.push(m.main);
  if (m.icon && /[./]/.test(m.icon)) out.push(m.icon);
  for (const p of m.contributes.panels) out.push(p.html);
  for (const s of m.contributes.vibeSkills) if (s.file) out.push(s.file);
  for (const t of m.contributes.templates) if (t.files) out.push(...Object.values(t.files));
  return out;
}

/** Checks that every referenced file exists in the package. Returns error messages. */
export function checkPackageFiles(m, paths) {
  const have = new Set(paths);
  return referencedFiles(m).filter((f) => !have.has(f)).map((f) => `The manifest refers to “${f}”, but the package has no such file.`);
}

/** One-line human summary of a permission for the consent dialog. */
export function describePermission(p) {
  if (p.startsWith("network:")) return { label: `Connect to ${p.slice(8)}`, risk: "high", text: `Can send and receive data from ${p.slice(8)} (only that address, and only while network access is not blocked in Settings).` };
  const T = {
    "document.read": { label: "Read your document", risk: "medium", text: "Can see layers, selection, pages and website files of the open document." },
    "document.write": { label: "Change your document", risk: "high", text: "Can add, edit and delete layers and files through the same tools the Vibe assistant uses. Every change is one undo step." },
    ui: { label: "Show messages and dialogs", risk: "low", text: "Can show notices, ask you questions, open its panels and switch studios." },
    storage: { label: "Store its own data", risk: "low", text: "Keeps a small private store on this device (up to 1 MB)." },
    files: { label: "Open and save files", risk: "medium", text: "Can ask you to pick files to read or choose where to save a file. It never gets access without your dialog." },
    export: { label: "Render exports", risk: "medium", text: "Can render pages and layers of the open document to PNG, JPEG, WebP or SVG data (it still needs the Save permission to write files)." },
    vibe: { label: "Extend the Vibe assistant", risk: "medium", text: "Can add tools and skills to Vibe Studio. Its tools always ask for your approval before running." },
    commands: { label: "Run other commands", risk: "high", text: "Can run any OpenFini menu command, for example save, close or export." },
  };
  return { label: T[p]?.label || p, risk: T[p]?.risk || "high", text: T[p]?.text || "" };
}
