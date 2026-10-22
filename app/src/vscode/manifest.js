// VS Code extension manifests (package.json inside a .vsix): localization, normalization and the honest
// compatibility verdict OpenFini shows before and after installing. Pure (no DOM), unit-tested in tests/vscode.
//
// Public API
//   localizePackage(pkg, nls)            replaces "%key%" strings with texts from package.nls*.json
//   normalizePackage(pkg)                -> { ok, errors, manifest } (a stable, validated shape; see NORMALIZED below)
//   compatibility(manifest, {code, names}) -> { level: "full"|"partial"|"none", label, summary, reasons, apis, ... }
//   scanApiUsage(code)                   -> unsupported `vscode.*` members a bundle appears to use (heuristic)
//   referencedFiles(manifest)            -> package paths OpenFini needs (theme, snippet, language files, entry, icon)
//   languageIdOf(path, languages)        -> VS Code language id of a file name ("javascript", "python", …)
//   vscodeChord(key)                     -> OpenFini chord ("ctrl+shift+u" -> "Mod+Shift+U") or null
//   configurationProperties(manifest)    -> flat { "section.key": schema } of contributes.configuration
//
// Invariants: the manifest is data from an untrusted package; every field is type-checked and length-capped here
// before any UI or host code reads it. Nothing in this module executes extension code.
import { normalizeChord } from "../customize/chords.js";

/** The VS Code API version OpenFini reports to extensions (`vscode.version`) and checks `engines.vscode` against. */
export const COMPAT_VSCODE_VERSION = "1.95.0";

/** Contribution points OpenFini understands. Everything else is listed as "not supported". */
export const SUPPORTED_CONTRIBUTIONS = ["themes", "snippets", "languages", "configuration", "commands", "keybindings"];
/** Contribution points that only matter together with code (commands, keybindings). */
const CODE_CONTRIBUTIONS = new Set(["commands", "keybindings", "menus"]);
/** Contributions that are harmless metadata and never count against compatibility. */
const IGNORED_CONTRIBUTIONS = new Set(["menus", "jsonValidation", "configurationDefaults", "walkthroughs", "colors", "semanticTokenScopes", "semanticTokenTypes", "semanticTokenModifiers"]);

const str = (x, max = 400) => (typeof x === "string" ? x.slice(0, max) : typeof x === "object" && x && typeof x.value === "string" ? x.value.slice(0, max) : "");
const arr = (x, max = 500) => (Array.isArray(x) ? x.slice(0, max) : []);
const relPath = (p) => (typeof p === "string" && p.length < 300 ? p.replace(/\\/g, "/").replace(/^(\.\/)+/, "") : "");

// ------------------------------------------------------------------ localization

/** Replaces "%key%" values (anywhere in the manifest) with package.nls texts; unknown keys stay as they are. */
export function localizePackage(pkg, ...bundles) {
  const lookup = (key) => {
    for (const b of bundles) {
      const v = b?.[key];
      if (typeof v === "string") return v;
      if (v && typeof v.message === "string") return v.message;
    }
    return null;
  };
  const walk = (x, depth = 0) => {
    if (depth > 12) return x;
    if (typeof x === "string") {
      const m = /^%([^%\s]{1,200})%$/.exec(x);
      return m ? (lookup(m[1]) ?? x) : x;
    }
    if (Array.isArray(x)) return x.map((y) => walk(y, depth + 1));
    if (x && typeof x === "object") {
      const out = {};
      for (const [k, v] of Object.entries(x)) out[k] = walk(v, depth + 1);
      return out;
    }
    return x;
  };
  return walk(pkg);
}

// ------------------------------------------------------------------ normalization

/** Flat map of `contributes.configuration` properties (object or array form). */
export function configurationProperties(manifestOrPkg) {
  const conf = manifestOrPkg?.contributes?.configuration;
  const out = {};
  for (const block of Array.isArray(conf) ? conf : conf ? [conf] : []) {
    const props = block?.properties;
    if (!props || typeof props !== "object") continue;
    for (const [key, def] of Object.entries(props).slice(0, 300)) {
      if (!/^[\w.$-]{1,160}$/.test(key) || !def || typeof def !== "object") continue;
      const type = Array.isArray(def.type) ? def.type.find((t) => t !== "null") : def.type;
      out[key] = {
        type: ["boolean", "string", "number", "integer", "array", "object"].includes(type) ? type : def.enum ? "string" : "object",
        default: def.default,
        description: str(def.markdownDescription || def.description, 600),
        enum: Array.isArray(def.enum) ? def.enum.slice(0, 60).filter((e) => ["string", "number", "boolean"].includes(typeof e)) : null,
        minimum: typeof def.minimum === "number" ? def.minimum : undefined,
        maximum: typeof def.maximum === "number" ? def.maximum : undefined,
        group: str(block.title, 80),
      };
    }
  }
  return out;
}

/**
 * Validates and normalizes a (localized) package.json.
 * @returns {{ok: boolean, errors: string[], manifest: object|null}}
 */
export function normalizePackage(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return { ok: false, errors: ["package.json is not an object."], manifest: null };
  const publisher = str(pkg.publisher, 100);
  const name = str(pkg.name, 100);
  if (!/^[A-Za-z0-9][\w-]*$/.test(publisher)) errors.push("package.json has no valid publisher.");
  if (!/^[A-Za-z0-9][\w.-]*$/.test(name)) errors.push("package.json has no valid name.");
  const version = str(pkg.version, 60);
  if (!/^\d+\.\d+\.\d+/.test(version)) errors.push("package.json has no valid version.");
  const c = pkg.contributes && typeof pkg.contributes === "object" ? pkg.contributes : {};
  const contributes = {
    themes: arr(c.themes, 100).filter((t) => t && relPath(t.path)).map((t, i) => ({ id: str(t.id, 100) || str(t.label, 100) || `theme-${i}`, label: str(t.label, 80) || str(t.id, 80) || `Theme ${i + 1}`, uiTheme: ["vs", "vs-dark", "hc-black", "hc-light"].includes(t.uiTheme) ? t.uiTheme : "vs-dark", path: relPath(t.path) })),
    snippets: arr(c.snippets, 200).filter((s) => s && relPath(s.path)).map((s) => ({ language: str(s.language, 60), path: relPath(s.path) })),
    languages: arr(c.languages, 200).filter((l) => l && str(l.id, 60)).map((l) => ({ id: str(l.id, 60), aliases: arr(l.aliases, 10).map((a) => str(a, 60)).filter(Boolean), extensions: arr(l.extensions, 40).map((e) => str(e, 30).toLowerCase()).filter((e) => e.startsWith(".")), filenames: arr(l.filenames, 40).map((f) => str(f, 80)).filter(Boolean), configuration: relPath(l.configuration) })),
    grammars: arr(c.grammars, 200).filter((g) => g && relPath(g.path)).map((g) => ({ language: str(g.language, 60), scopeName: str(g.scopeName, 120), path: relPath(g.path) })),
    commands: arr(c.commands, 300).filter((x) => x && str(x.command, 160)).map((x) => ({ command: str(x.command, 160), title: str(x.title, 120) || str(x.command, 120), category: str(x.category, 60) })),
    keybindings: (Array.isArray(c.keybindings) ? c.keybindings : c.keybindings ? [c.keybindings] : []).slice(0, 300).filter((k) => k && str(k.command, 160) && str(k.key, 60)).map((k) => ({ command: str(k.command, 160), key: str(k.key, 60), mac: str(k.mac, 60), when: str(k.when, 300) })),
    configuration: configurationProperties(pkg),
  };
  const other = Object.keys(c).filter((k) => !SUPPORTED_CONTRIBUTIONS.includes(k) && k !== "grammars");
  const manifest = {
    id: `${publisher}.${name}`.toLowerCase(),
    publisher,
    name,
    displayName: str(pkg.displayName, 100) || name,
    description: str(pkg.description, 600),
    version,
    license: str(pkg.license, 100),
    engine: str(pkg.engines?.vscode, 60),
    categories: arr(pkg.categories, 20).map((x) => str(x, 40)).filter(Boolean),
    keywords: arr(pkg.keywords, 30).map((x) => str(x, 40)).filter(Boolean),
    icon: relPath(pkg.icon),
    repository: str(typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url, 300),
    browser: relPath(pkg.browser),
    main: relPath(pkg.main),
    extensionKind: arr(typeof pkg.extensionKind === "string" ? [pkg.extensionKind] : pkg.extensionKind, 5).filter((k) => ["ui", "workspace", "web"].includes(k)),
    activationEvents: arr(pkg.activationEvents, 200).map((e) => str(e, 200)).filter(Boolean),
    dependencies: arr(pkg.extensionDependencies, 50).map((x) => str(x, 120)).filter(Boolean),
    pack: arr(pkg.extensionPack, 100).map((x) => str(x, 120)).filter(Boolean),
    contributes,
    otherContributions: other.slice(0, 40),
  };
  return { ok: !errors.length, errors, manifest: errors.length ? null : manifest };
}

// ------------------------------------------------------------------ files

/** Package paths (relative to the extension folder) that OpenFini reads. */
export function referencedFiles(m) {
  const out = new Set();
  const c = m.contributes;
  for (const t of c.themes) out.add(t.path);
  for (const s of c.snippets) out.add(s.path);
  for (const l of c.languages) if (l.configuration) out.add(l.configuration);
  if (m.icon) out.add(m.icon);
  if (m.browser) for (const p of [m.browser, `${m.browser}.js`, `${m.browser}/index.js`]) out.add(p.replace(/\/+/g, "/"));
  return out;
}

/** The browser entry file that exists in `names` (VS Code resolves "dist/web/extension" like Node does). */
export function resolveEntry(entry, names) {
  if (!entry) return null;
  const has = (p) => (names instanceof Set ? names.has(p) : names.includes(p));
  for (const p of [entry, `${entry}.js`, `${entry}/index.js`]) if (has(p)) return p;
  return null;
}

// ------------------------------------------------------------------ compatibility

/** Members of supported namespaces OpenFini does not implement and that popular extensions use. */
const KNOWN_UNSUPPORTED = {
  window: ["createWebviewPanel", "registerWebviewViewProvider", "registerWebviewPanelSerializer", "createTreeView", "registerTreeDataProvider", "createTerminal", "registerTerminalProfileProvider", "registerTerminalLinkProvider", "registerUriHandler", "registerCustomEditorProvider", "createQuickPick", "createInputBox", "showOpenDialog", "showSaveDialog", "showWorkspaceFolderPick", "registerFileDecorationProvider", "showNotebookDocument", "tabGroups", "createWebviewTextEditorInset"],
  workspace: ["registerFileSystemProvider", "registerTaskProvider", "registerTextDocumentContentProvider", "registerNotebookSerializer", "updateWorkspaceFolders", "openNotebookDocument", "registerTimelineProvider", "saveAll", "save", "saveAs"],
  languages: ["registerDefinitionProvider", "registerReferenceProvider", "registerRenameProvider", "registerDocumentSymbolProvider", "registerWorkspaceSymbolProvider", "registerSignatureHelpProvider", "registerFoldingRangeProvider", "registerDocumentSemanticTokensProvider", "registerDocumentRangeSemanticTokensProvider", "registerInlayHintsProvider", "registerCodeLensProvider", "registerDocumentLinkProvider", "registerColorProvider", "registerInlineCompletionItemProvider", "registerOnTypeFormattingEditProvider", "registerSelectionRangeProvider", "registerCallHierarchyProvider", "registerTypeHierarchyProvider", "registerLinkedEditingRangeProvider", "registerDocumentHighlightProvider", "registerImplementationProvider", "registerTypeDefinitionProvider", "registerDeclarationProvider", "registerEvaluatableExpressionProvider", "registerInlineValuesProvider", "setTextDocumentLanguage"],
  env: ["asExternalUri", "createTelemetryLogger"],
};
/** Namespaces OpenFini does not implement at all. */
const UNSUPPORTED_NAMESPACES = ["debug", "tasks", "scm", "tests", "notebooks", "authentication", "comments", "chat", "lm", "interactive"];
const NS_MEMBER_RE = /^(register|start|create|on[A-Z]|get|active|breakpoints|executeTask|fetchTasks|taskExecutions|selectChatModels|sessions)/;

/**
 * Scans a bundled web extension for `vscode` API members OpenFini does not implement. Heuristic: bundlers rename
 * the `vscode` import, so this looks for `.<namespace>.<member>` and reports only known API names.
 * @returns {string[]} sorted "namespace.member" names
 */
export function scanApiUsage(code) {
  const found = new Set();
  const src = String(code || "").slice(0, 8 * 1024 * 1024);
  const re = /\.(window|workspace|languages|env|debug|tasks|scm|tests|notebooks|authentication|comments|chat|lm|interactive)\.([A-Za-z_$][\w$]{1,60})/g;
  let m;
  while ((m = re.exec(src))) {
    const [, ns, member] = m;
    if (KNOWN_UNSUPPORTED[ns]?.includes(member)) found.add(`${ns}.${member}`);
    else if (UNSUPPORTED_NAMESPACES.includes(ns) && NS_MEMBER_RE.test(member)) found.add(`${ns}.${member}`);
    if (found.size > 60) break;
  }
  return [...found].sort();
}

/** Human names of contribution points (for reports). */
const CONTRIB_NAMES = { grammars: "syntax grammars (TextMate)", iconThemes: "file icon themes", productIconThemes: "product icon themes", views: "views", viewsContainers: "view containers", viewsWelcome: "welcome views", debuggers: "debuggers", breakpoints: "breakpoints", taskDefinitions: "tasks", customEditors: "custom editors", notebooks: "notebooks", notebookRenderer: "notebook renderers", terminal: "terminal profiles", authentication: "authentication providers", problemMatchers: "problem matchers", problemPatterns: "problem patterns", typescriptServerPlugins: "TypeScript server plugins", localizations: "UI language packs", submenus: "submenus", resourceLabelFormatters: "resource labels", chatParticipants: "chat participants", languageModelTools: "language model tools", mcpServerDefinitionProviders: "MCP servers" };

/**
 * The compatibility verdict.
 * @param {object} m normalized manifest
 * @param {{code?: string, names?: string[]|Set<string>, runtimeUnsupported?: string[]}} [o] the browser entry's code
 *   (for the API scan), every file name in the package (native binaries), APIs recorded at run time
 */
export function compatibility(m, { code = "", names = [], runtimeUnsupported = [] } = {}) {
  const c = m.contributes;
  const reasons = [];
  const nameList = [...names];
  const native = nameList.filter((n) => /\.(node|dll|so|dylib|exe)$/i.test(n)).slice(0, 5);
  const declarative = [];
  if (c.themes.length) declarative.push(`${c.themes.length} color theme${c.themes.length === 1 ? "" : "s"}`);
  if (c.snippets.length) declarative.push(`${c.snippets.length} snippet file${c.snippets.length === 1 ? "" : "s"}`);
  if (c.languages.some((l) => l.configuration)) declarative.push("language configuration");
  if (Object.keys(c.configuration).length) declarative.push("settings");
  const unsupportedContribs = [...(c.grammars.length ? ["grammars"] : []), ...m.otherContributions.filter((k) => !IGNORED_CONTRIBUTIONS.has(k) && !CODE_CONTRIBUTIONS.has(k))].map((k) => CONTRIB_NAMES[k] || k);
  const hasCode = !!(m.browser || m.main);
  const web = !!m.browser;
  const apis = web ? [...new Set([...scanApiUsage(code), ...runtimeUnsupported])].sort() : [];
  // VS Code web extensions must be bundled into one file; an entry that requires sibling modules cannot start
  const unbundled = web && /\brequire\(\s*["']\.{1,2}\//.test(String(code).slice(0, 2 * 1024 * 1024));
  if (unbundled) reasons.push("Its web code is not bundled into one file (it requires other modules), so it cannot start; its other contributions work.");
  if (unsupportedContribs.length) reasons.push(`Not supported contributions: ${unsupportedContribs.join(", ")}.`);
  if (native.length) reasons.push(`Contains native binaries (${native.join(", ")}).`);
  if (m.dependencies.length) reasons.push(`Depends on other extensions that are not installed automatically: ${m.dependencies.slice(0, 5).join(", ")}.`);
  if (m.pack.length && !hasCode && !declarative.length) reasons.push("It is an extension pack: install its extensions one by one.");

  let level;
  let label;
  if (!hasCode) {
    if (!declarative.length && !c.commands.length) {
      level = "none";
      label = unsupportedContribs.length ? `Not supported: only ${unsupportedContribs.join(", ")}` : "Not supported: it contributes nothing OpenFini can use";
    } else if (unsupportedContribs.length) {
      level = "partial";
      label = `Partially supported: declarative, without ${unsupportedContribs.join(", ")}`;
    } else {
      level = "full";
      label = "Fully supported: declarative only";
    }
  } else if (web && unbundled) {
    level = "partial";
    label = "Partially supported: contributions only (its web code is not bundled)";
  } else if (web) {
    if (apis.length || unsupportedContribs.length) {
      level = "partial";
      label = apis.length ? `Partially supported: web extension, uses unsupported APIs: ${apis.slice(0, 6).join(", ")}${apis.length > 6 ? ` (+${apis.length - 6})` : ""}` : `Partially supported: web extension, without ${unsupportedContribs.join(", ")}`;
    } else {
      level = "full";
      label = "Fully supported: web extension using the available API subset";
    }
  } else if (declarative.length) {
    level = "partial";
    label = "Partially supported: contributions only (its code needs Node and does not run)";
    reasons.push("Its code (main) needs the Node.js extension host of VS Code, which a browser or webview cannot provide.");
  } else {
    level = "none";
    label = "Not supported: needs Node or native code";
    reasons.push("Its code (main) needs the Node.js extension host of VS Code, which a browser or webview cannot provide.");
  }
  return { level, label, runsCode: web && !unbundled, declarative, unsupportedContributions: unsupportedContribs, apis, reasons, engine: m.engine || null, engineOk: engineSatisfied(m.engine) };
}

/** Does `^1.80.0`-style `engines.vscode` accept COMPAT_VSCODE_VERSION? Unknown syntax counts as satisfied. */
export function engineSatisfied(range) {
  const m = /^\s*(\^|>=|~)?\s*(\d+)\.(\d+)\.(\d+|x|\*)/.exec(String(range || ""));
  if (!m) return true;
  const [maj, min] = COMPAT_VSCODE_VERSION.split(".").map(Number);
  const need = [Number(m[2]), Number(m[3])];
  if (need[0] !== maj) return need[0] < maj && m[1] === ">=";
  return need[1] <= min;
}

// ------------------------------------------------------------------ languages and keys

const BUILTIN_LANGS = { html: "html", htm: "html", css: "css", scss: "scss", less: "less", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact", ts: "typescript", tsx: "typescriptreact", json: "json", jsonc: "jsonc", md: "markdown", markdown: "markdown", tex: "latex", latex: "latex", yml: "yaml", yaml: "yaml", toml: "toml", ini: "ini", xml: "xml", svg: "xml", py: "python", rb: "ruby", go: "go", rs: "rust", php: "php", java: "java", c: "c", h: "c", cpp: "cpp", cs: "csharp", sh: "shellscript", sql: "sql", vue: "vue", svelte: "svelte", txt: "plaintext" };

/** VS Code language id of a path; languages contributed by installed extensions win over the built-in table. */
export function languageIdOf(path, languages = []) {
  const name = String(path || "").split("/").pop().toLowerCase();
  for (const l of languages) if (l.filenames?.some((f) => f.toLowerCase() === name)) return l.id;
  let best = null;
  for (const l of languages) for (const e of l.extensions || []) if (name.endsWith(e) && (!best || e.length > best[1])) best = [l.id, e.length];
  if (best) return best[0];
  const ext = /\.([^.]+)$/.exec(name)?.[1];
  return BUILTIN_LANGS[ext] || "plaintext";
}

/**
 * Does a VS Code document selector match a document? Supports strings, {language, scheme, pattern} and arrays.
 * `pattern` globs are matched against the project path (leading slashes ignored on both sides).
 */
export function selectorMatches(selector, languageId, path = "") {
  if (!selector) return false;
  if (Array.isArray(selector)) return selector.some((s) => selectorMatches(s, languageId, path));
  if (typeof selector === "string") return selector === "*" || selector === languageId;
  if (typeof selector !== "object") return false;
  if (!selector.language && !selector.scheme && !selector.pattern) return false;
  if (selector.language && selector.language !== "*" && selector.language !== languageId) return false;
  if (selector.scheme && !["file", "untitled", "openfini", "*"].includes(selector.scheme)) return false;
  if (selector.pattern) {
    const pat = typeof selector.pattern === "string" ? selector.pattern : selector.pattern?.pattern;
    if (typeof pat !== "string") return false;
    try {
      return globToRegExp(pat.replace(/^\/+/, "")).test(String(path).replace(/^\/+/, ""));
    } catch {
      return false;
    }
  }
  return true;
}

/** A VS Code glob ("**\/*.{js,ts}", "src/*.md") as a RegExp over project paths without a leading slash. */
export function globToRegExp(glob) {
  let re = "";
  const g = String(glob || "**/*").slice(0, 300);
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      re += g[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += g[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = g.indexOf("}", i);
      if (end < 0) re += "\\{";
      else {
        re += `(?:${g.slice(i + 1, end).split(",").map((x) => x.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("|")})`;
        i = end;
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * language-configuration.json -> CodeMirror language data: comment tokens (Toggle Comment) and the opening characters
 * of single-character auto-closing pairs (closeBrackets). Unknown or malformed fields are ignored.
 */
export function languageData(conf) {
  const out = {};
  const c = conf?.comments;
  const line = typeof c?.lineComment === "string" ? c.lineComment.slice(0, 10) : null;
  const block = Array.isArray(c?.blockComment) && c.blockComment.length === 2 && c.blockComment.every((x) => typeof x === "string" && x.length <= 10) ? { open: c.blockComment[0], close: c.blockComment[1] } : null;
  if (line || block) out.commentTokens = { ...(line ? { line } : {}), ...(block ? { block } : {}) };
  const pairs = Array.isArray(conf?.autoClosingPairs) ? conf.autoClosingPairs : Array.isArray(conf?.brackets) ? conf.brackets : [];
  const open = [];
  for (const p of pairs.slice(0, 40)) {
    const o = Array.isArray(p) ? p[0] : p?.open;
    const cl = Array.isArray(p) ? p[1] : p?.close;
    if (typeof o === "string" && typeof cl === "string" && o.length === 1 && cl.length === 1 && "([{<'\"`".includes(o) && !open.includes(o)) open.push(o);
  }
  if (open.length) out.closeBrackets = { brackets: open };
  return out;
}

/** VS Code key ("ctrl+shift+u") -> OpenFini chord ("Mod+Shift+U"); null for multi-step chords and unknown keys. */
export function vscodeChord(key) {
  const k = String(key || "").trim();
  if (!k || /\s/.test(k)) return null; // "ctrl+k ctrl+c" (two steps) is not supported
  return normalizeChord(k.replace(/\bwin\+/i, "meta+"));
}
