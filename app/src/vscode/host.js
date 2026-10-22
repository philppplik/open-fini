// The VS Code extension host: installed VS Code extensions (from Open VSX or a local .vsix), their declarative
// contributions (color themes, snippets, language configurations, settings) and, for web extensions only, the
// sandboxed frame that runs the `browser` bundle against the `vscode` API shim (runtime-src.js).
//
// Loaded lazily: extensions/index.js imports this module only when VS Code extensions are installed or the user
// opens the "VS Code" tab of the extension manager. Get the instance with getVscodeHost(app).
//
// Public API (VscodeHost)
//   load()                                    restores installed extensions (manifest validated again on every load)
//   list() / get(id)                          runtime entries { id, rec, manifest, compat, state, logs, output, … }
//   inspect(bytes)                            unpack + validate + compatibility (no side effects)
//   install({bytes, source}, ask)             asks `ask(info)` for consent ({ ok, network }) then installs/updates
//   installFromOpenVsx(namespace, name, ask)  downloads the latest .vsix from open-vsx.org and installs it
//   checkUpdate(id, ask)                      Open VSX installs only: installs a newer version after consent
//   uninstall(id) / setEnabled(id, on) / setSetting(id, key, value) / setNetwork(id, origins)
//   runCommand(id, command, args)             runs a web extension command (activates it first)
//   openVsx                                   the Open VSX client (search, details, download)
//   editor hooks used by editor-bridge.js: editorChanged(path, view), snippetsFor(lang), languageDataFor(lang),
//     languageIdOf(path), complete(...), hover(...), hasFormatter(path), format(path), codeActions(path)
//
// Invariants
// - Extension code never runs in the app: one `<iframe sandbox="allow-scripts">` per running web extension with the
//   same CSP as OpenFini extensions (connect-src 'none'); `fetch` inside it goes through the host and only reaches
//   origins the user allowed in the consent dialog, never while offline mode is on.
// - Extensions whose code needs Node (`main` without `browser`) are never run; only their contributions are used.
// - Every call from a frame goes through extensions/rpc.js (envelope, size and rate limits, timeouts) with the
//   method allow-list below. Edits to a file are applied as ONE undo step and only to project files.
import { Emitter } from "../core/util.js";
import { log as coreLog } from "../core/log.js";
import { kvGet, kvSet, kvDelete } from "../core/storage.js";
import { registerTheme } from "../ui/themes.js";
import { localeTag } from "../i18n/index.js";
import { createSandbox } from "../extensions/sandbox.js";
import { createDispatcher, RpcError, v } from "../extensions/rpc.js";
import { FRAME_CSP, scriptUrl } from "../extensions/html.js";
import { originOf } from "../extensions/permissions.js";
import { VSCODE_RUNTIME_SRC } from "./runtime-src.js";
import { unpackVsix, readText } from "./vsix.js";
import { normalizePackage, compatibility, languageIdOf, selectorMatches, vscodeChord, languageData, globToRegExp, COMPAT_VSCODE_VERSION } from "./manifest.js";
import { loadThemeJson, convertColorTheme, themeIdFor } from "./theme.js";
import { parseSnippetFile } from "./snippets.js";
import { parseJsonc } from "./jsonc.js";
import { createOpenVsx } from "./openvsx.js";

const INDEX_KEY = "vsx:index";
const MAX_LOGS = 200;
const MAX_OUTPUT = 64 * 1024;
const PROVIDER_TIMEOUT = { completion: 1500, hover: 1500, format: 8000, rangeFormat: 8000, codeActions: 3000 };
const KIND_VARIANT = { info: "primary", warning: "warning", error: "danger" };
const METHODS = new Set(["api.unsupported", "commands.register", "commands.execute", "window.message", "window.input", "window.pick", "window.status", "window.show", "output.append", "output.show", "editor.edit", "editor.snippet", "editor.select", "workspace.read", "workspace.stat", "workspace.list", "workspace.find", "workspace.applyEdit", "config.update", "storage.set", "providers.register", "providers.dispose", "diagnostics.set", "env.clipboard", "env.openExternal", "network.fetch"]);
const jsonSafe = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));
const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Permission check for the VS Code frames: known methods only; network per allowed origin. */
function checkVscode(granted, method, params) {
  if (!METHODS.has(method)) return { ok: false, code: "UNKNOWN_METHOD", message: `Unknown method “${method}”.` };
  if (method === "network.fetch") {
    const o = originOf(params?.url);
    if (!o || !granted.has(`network:${o}`)) return { ok: false, code: "PERMISSION_DENIED", message: `Network access to ${o || "this address"} was not allowed for this extension.` };
  }
  return { ok: true };
}

let instance = null;
/** The host singleton (created and loaded on first use). */
export function getVscodeHost(app) {
  if (!instance) {
    instance = new VscodeHost(app);
    app.vscode = instance;
    instance.ready = instance.load();
  }
  return instance.ready.then(() => instance);
}

export class VscodeHost extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.exts = new Map();
    this.view = null;
    this.path = null;
    this.versions = new Map();
    this.pushTimer = 0;
    this.openVsx = createOpenVsx({
      fetch: (...a) => fetch(...a),
      assertNetwork: (url) => {
        if (app.network?.assert) app.network.assert("extension", url);
        else if (app.prefs?.offlineMode) throw new Error("Network access is blocked: offline mode is on (Settings ▸ Security and privacy).");
      },
    });
  }

  // ------------------------------------------------------------------ persistence

  async load() {
    const ids = (await kvGet(INDEX_KEY)) || [];
    for (const id of ids) {
      const rec = await kvGet(`vsx:rec:${id}`);
      if (rec?.pkg) this.#add(rec);
    }
    const { installEditorBridge } = await import("./editor-bridge.js");
    installEditorBridge(this.app, this);
    this.app.registerCommand?.("vscode.codeActions", { label: "VS Code: Quick Fix…", studios: ["code"], enabled: () => this.#hasProviders("codeActions"), run: () => this.codeActions() });
    this.app.emit("commands");
    this.emit("change");
  }

  async #persist(ext) {
    await kvSet(INDEX_KEY, [...this.exts.keys()]);
    await kvSet(`vsx:rec:${ext.id}`, ext.rec);
  }

  list() {
    return [...this.exts.values()].sort((a, b) => a.manifest.displayName.localeCompare(b.manifest.displayName));
  }
  get(id) {
    return this.exts.get(String(id).toLowerCase()) || null;
  }

  #log(ext, level, text) {
    ext.logs.push({ t: Date.now(), level, text: String(text).slice(0, 2000) });
    if (ext.logs.length > MAX_LOGS) ext.logs.shift();
    coreLog.log(level === "info" ? "info" : level, "vscode", `[${ext.id}] ${text}`);
    this.emit("log", ext);
  }

  /** Validates a stored record again and creates the runtime entry. */
  #add(rec) {
    const norm = normalizePackage(rec.pkg);
    if (!norm.ok) {
      coreLog.log("warn", "vscode", `Skipped the invalid VS Code extension ${rec.id}: ${norm.errors.join(" ")}`);
      return null;
    }
    const manifest = norm.manifest;
    if (manifest.browser && rec.entry) manifest.browser = rec.entry;
    const code = manifest.browser ? readText(rec.files, manifest.browser) || "" : "";
    const ext = {
      id: manifest.id,
      rec,
      manifest,
      compat: compatibility(manifest, { code, names: rec.native || [], runtimeUnsupported: rec.runtimeUnsupported || [] }),
      state: "idle",
      error: null,
      frame: null,
      logs: [],
      output: new Map(),
      providers: new Map(),
      snippets: [],
      languages: [],
      themes: [],
      unreg: [],
      registered: false,
      activating: null,
      diagnostics: 0,
    };
    if (manifest.browser && !code) ext.compat = { ...ext.compat, level: "partial", runsCode: false, label: "Partially supported: its web entry file is missing from the package" };
    ext.dispatcher = createDispatcher({
      handlers: this.#handlers(ext),
      granted: (rec.network || []).map((o) => `network:${o}`),
      check: checkVscode,
      onViolation: (kind) => this.#kill(ext, `it broke a limit (${kind})`),
    });
    this.exts.set(ext.id, ext);
    if (rec.enabled !== false) this.#register(ext);
    else ext.state = "disabled";
    return ext;
  }

  // ------------------------------------------------------------------ contributions

  #register(ext) {
    if (ext.registered) return;
    ext.registered = true;
    const { app } = this;
    const c = ext.manifest.contributes;
    const files = ext.rec.files;
    ext.themes = [];
    for (const t of c.themes) {
      try {
        const json = loadThemeJson(files, t.path);
        const conv = convertColorTheme(json, { label: t.label, uiTheme: t.uiTheme, id: themeIdFor(ext.id, t.id || t.label), group: `VS Code: ${ext.manifest.displayName}`.slice(0, 60) });
        ext.unreg.push(registerTheme(conv.def, { replace: true }));
        ext.themes.push({ id: conv.def.id, label: t.label, mode: conv.mode, adjusted: conv.adjusted, mapped: conv.mapped.length });
        if (conv.adjusted.length) this.#log(ext, "info", `Theme “${t.label}”: ${conv.adjusted.length} colors were adjusted for legible contrast (${conv.adjusted.slice(0, 6).join(", ")}).`);
      } catch (err) {
        this.#log(ext, "warn", `Theme “${t.label}” could not be converted: ${err.message}`);
      }
    }
    ext.snippets = [];
    for (const s of c.snippets) {
      try {
        ext.snippets.push(...parseSnippetFile(readText(files, s.path) ?? "{}", s.language));
      } catch (err) {
        this.#log(ext, "warn", `Snippets in ${s.path} could not be read: ${err.message}`);
      }
    }
    ext.languages = c.languages.map((l) => {
      let data = {};
      if (l.configuration) {
        try {
          data = languageData(parseJsonc(readText(files, l.configuration) ?? "{}"));
        } catch (err) {
          this.#log(ext, "warn", `The language configuration of ${l.id} could not be read: ${err.message}`);
        }
      }
      return { ...l, data };
    });
    if (ext.compat.runsCode) {
      const keys = new Map(c.keybindings.map((k) => [k.command, k]));
      for (const cmd of c.commands) {
        const full = `vsx:${ext.id}:${cmd.command}`;
        let shortcut;
        const kb = keys.get(cmd.command);
        if (kb) {
          const chord = vscodeChord(kb.key);
          const clash = chord && [...app.commands.values()].find((x) => (x.shortcut || "").toLowerCase() === chord.toLowerCase() && (!x.studios || x.studios.includes("code")));
          if (!chord) this.#log(ext, "info", `Key binding “${kb.key}” for ${cmd.command} is not supported (multi-step chords are not).`);
          else if (clash) this.#log(ext, "warn", `Key binding ${chord} for ${cmd.command} was not set: it is used by ${clash.id}.`);
          else shortcut = chord;
        }
        app.registerCommand(full, { label: cmd.category ? `${cmd.category}: ${cmd.title}` : cmd.title, studios: ["code"], shortcut, group: "VS Code", run: () => this.runCommand(ext.id, cmd.command) });
        ext.unreg.push(() => app.commands.delete(full));
      }
    }
    ext.state = ext.compat.runsCode ? "idle" : "declarative";
    app.emit("commands");
    app.emit("editor-contrib");
    if (ext.compat.runsCode) this.#maybeActivate(ext);
  }

  #unregister(ext) {
    if (!ext.registered) return;
    ext.registered = false;
    for (const off of ext.unreg.splice(0)) {
      try {
        off();
      } catch (err) {
        console.error(err);
      }
    }
    this.#stop(ext);
    ext.snippets = [];
    ext.languages = [];
    ext.themes = [];
    this.app.emit("commands");
    this.app.emit("editor-contrib");
  }

  /** Languages contributed by enabled extensions (for language ids of files). */
  allLanguages() {
    const out = [];
    for (const e of this.exts.values()) if (e.registered) out.push(...e.languages);
    return out;
  }
  languageIdOf(path) {
    return languageIdOf(path, this.allLanguages());
  }
  snippetsFor(languageId) {
    const out = [];
    for (const e of this.exts.values()) if (e.registered) for (const s of e.snippets) if (s.languages.includes(languageId) || s.languages.includes("*")) out.push({ ...s, ext: e.manifest.displayName });
    return out;
  }
  languageDataFor(languageId) {
    for (const e of this.exts.values()) if (e.registered) for (const l of e.languages) if (l.id === languageId && Object.keys(l.data).length) return l.data;
    return null;
  }

  // ------------------------------------------------------------------ activation and frames

  #maybeActivate(ext, reason) {
    if (!ext.compat.runsCode || ext.state !== "idle" || !this.app.codeUI) return;
    const ev = ext.manifest.activationEvents;
    const lang = this.path ? this.languageIdOf(this.path) : null;
    const hit = ev.some((e) => e === "*" || e === "onStartupFinished" || e.startsWith("workspaceContains:") || (lang && e === `onLanguage:${lang}`) || (reason && e === reason));
    if (hit) this.activate(ext.id).catch(() => {});
  }

  #snapshot(path = this.path) {
    const ed = this.app.codeUI?.editors;
    const st = path && ed?.stateFor?.(path);
    if (!st) return null;
    const text = st.doc.length > 2 * 1024 * 1024 ? "" : st.doc.toString();
    const pos = (off) => {
      const line = st.doc.lineAt(off);
      return { line: line.number - 1, character: off - line.from };
    };
    return { path, languageId: this.languageIdOf(path), version: this.versions.get(path) || 1, text, selections: st.selection.ranges.slice(0, 20).map((r) => ({ anchor: pos(r.anchor), active: pos(r.head) })) };
  }

  async activate(id) {
    const ext = this.get(id);
    if (!ext) throw new Error(`The VS Code extension “${id}” is not installed.`);
    if (!ext.compat.runsCode) throw new Error(`“${ext.manifest.displayName}” has no web code OpenFini can run (only its contributions are used).`);
    if (ext.state === "disabled") throw new Error(`“${ext.manifest.displayName}” is disabled.`);
    if (ext.state === "active") return ext;
    if (ext.activating) return ext.activating;
    ext.activating = (async () => {
      ext.state = "activating";
      ext.error = null;
      this.emit("change");
      try {
        const code = readText(ext.rec.files, ext.manifest.browser) || "";
        const data = (await kvGet(`vsx:data:${ext.id}`)) || {};
        const props = ext.manifest.contributes.configuration;
        const cfg = {
          extId: ext.id,
          compatVersion: COMPAT_VSCODE_VERSION,
          locale: localeTag(),
          machineId: (ext.rec.machineId ||= rand()),
          sessionId: rand(),
          settings: ext.rec.settings || {},
          defaults: Object.fromEntries(Object.entries(props).map(([k, d]) => [k, d.default])),
          globalState: data.global || {},
          workspaceState: data.workspace || {},
          network: ext.rec.network || [],
          languages: [...new Set(this.allLanguages().map((l) => l.id))],
          packageJSON: { name: ext.manifest.name, publisher: ext.manifest.publisher, version: ext.manifest.version, displayName: ext.manifest.displayName, contributes: { commands: ext.manifest.contributes.commands } },
          projectName: this.app.doc?.name || "Project",
          editor: this.#snapshot(),
        };
        const doc = buildFrameDocument(cfg, code);
        const sb = createSandbox({ doc, label: `VS Code extension ${ext.manifest.displayName}`, onRequest: (m, s) => ext.dispatcher.dispatch(m, { sandbox: s }), onLog: (lv, t) => this.#log(ext, lv, t) });
        ext.frame = sb;
        const r = await Promise.race([sb.ready, new Promise((res) => setTimeout(() => res({ error: "it did not finish activating within 10 seconds" }), 10_000))]);
        if (r.error) throw new Error(`“${ext.manifest.displayName}” could not start: ${r.error}`);
        this.#heartbeat(ext);
        ext.state = "active";
        this.#log(ext, "info", "Activated");
      } catch (err) {
        this.#log(ext, "error", err.message);
        this.#stop(ext);
        ext.state = "error";
        ext.error = err.message;
        throw err;
      } finally {
        ext.activating = null;
        this.emit("change");
      }
      return ext;
    })();
    return ext.activating;
  }

  #heartbeat(ext) {
    clearInterval(ext.beat);
    let misses = 0;
    ext.beat = setInterval(async () => {
      if (!ext.frame?.alive) return;
      try {
        await ext.frame.invoke("ping", {}, 5000);
        misses = 0;
      } catch {
        if (++misses >= 2) this.#kill(ext, "it stopped responding");
      }
    }, 15_000);
  }

  #stop(ext) {
    clearInterval(ext.beat);
    ext.frame?.destroy();
    ext.frame = null;
    ext.providers.clear();
    if (ext.state === "active" || ext.state === "activating") ext.state = "idle";
  }

  #kill(ext, reason) {
    if (ext.state === "error" || ext.state === "disabled") return;
    this.#stop(ext);
    ext.state = "error";
    ext.error = `Stopped: ${reason}.`;
    this.#log(ext, "error", ext.error);
    this.app.toast(`The VS Code extension “${ext.manifest.displayName}” was stopped: ${reason}.`, "warning", 6000);
    this.emit("change");
  }

  async restart(id) {
    const ext = this.get(id);
    if (!ext) return;
    this.#stop(ext);
    ext.state = ext.compat.runsCode ? "idle" : "declarative";
    ext.error = null;
    this.emit("change");
    if (ext.compat.runsCode) await this.activate(id);
  }

  async runCommand(id, command, args) {
    const ext = this.get(id);
    if (!ext) throw new Error(`Unknown VS Code extension ${id}`);
    try {
      await this.activate(id);
      return await ext.frame.invoke("command.run", { id: command, args: jsonSafe(args) }, 60_000);
    } catch (err) {
      this.#log(ext, "error", `${command}: ${err.message}`);
      this.app.toast(`${ext.manifest.displayName}: ${err.message}`, "danger", 6000);
      return null;
    }
  }

  // ------------------------------------------------------------------ the editor (called by editor-bridge.js)

  editorChanged(path, view, docChanged) {
    if (docChanged) this.versions.set(path, (this.versions.get(path) || 1) + 1);
    const switched = path !== this.path;
    this.path = path;
    this.view = view;
    if (switched) for (const e of this.exts.values()) this.#maybeActivate(e);
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      const snap = this.#snapshot();
      for (const e of this.exts.values()) if (e.state === "active" && e.frame?.alive) e.frame.invoke("editor.update", { editor: snap }, 5000).catch(() => {});
    }, switched ? 0 : 150);
  }

  #providersFor(kind, path) {
    const languageId = this.languageIdOf(path);
    const out = [];
    for (const e of this.exts.values()) if (e.state === "active") for (const [handle, p] of e.providers) if (p.kind === kind && selectorMatches(p.selector, languageId, path)) out.push({ ext: e, handle, p });
    return out;
  }
  #hasProviders(kind, path = this.path) {
    return !!path && this.#providersFor(kind, path).length > 0;
  }

  async #callProviders(kind, path, extra) {
    const list = this.#providersFor(kind, path);
    if (!list.length) return [];
    const doc = this.#snapshot(path);
    if (!doc) return [];
    const results = await Promise.all(
      list.map(({ ext, handle }) =>
        ext.frame
          .invoke("provider.call", { handle, kind, doc, ...extra }, PROVIDER_TIMEOUT[kind])
          .then((r) => ({ ext, r }))
          .catch((err) => {
            this.#log(ext, "warn", `${kind} provider failed: ${err.message}`);
            return { ext, r: null };
          }),
      ),
    );
    return results.filter((x) => x.r);
  }

  hasCompletion(path) {
    return this.#hasProviders("completion", path);
  }
  triggerCharacters(path) {
    const out = new Set();
    for (const { p } of this.#providersFor("completion", path)) for (const c of p.triggers || []) out.add(c);
    return out;
  }
  async complete(path, pos, trigger) {
    return (await this.#callProviders("completion", path, { pos, trigger })).flatMap(({ ext, r }) => (Array.isArray(r) ? r.map((it) => ({ ...it, ext: ext.manifest.displayName })) : []));
  }
  async hover(path, pos) {
    return (await this.#callProviders("hover", path, { pos })).flatMap(({ r }) => r.contents || []);
  }
  hasHover(path) {
    return this.#hasProviders("hover", path);
  }
  hasFormatter(path) {
    return this.#hasProviders("format", path) || this.#hasProviders("rangeFormat", path);
  }
  /** Formats with the first formatter that answers; applies its edits as one undo step. */
  async format(path) {
    const tabSize = this.app.prefs?.codeTabSize || 2;
    for (const kind of ["format", "rangeFormat"]) {
      const res = await this.#callProviders(kind, path, { tabSize });
      const hit = res.find(({ r }) => Array.isArray(r) && r.length) || (kind === "rangeFormat" ? res.find(({ r }) => Array.isArray(r)) : null);
      if (hit) {
        if (hit.r.length) this.#applyEdits(path, hit.r, null, `Format with ${hit.ext.manifest.displayName}`);
        this.app.status(`Formatted with ${hit.ext.manifest.displayName}`);
        return true;
      }
    }
    return false;
  }

  /** "VS Code: Quick Fix…": asks the code action providers at the cursor and runs the chosen action. */
  async codeActions(path = this.path) {
    const snap = path && this.#snapshot(path);
    if (!snap) return this.app.toast("Open a file in the Code studio first.", "warning");
    const sel = snap.selections[0] || { anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } };
    const res = await this.#callProviders("codeActions", path, { pos: sel.active, range: { start: sel.anchor, end: sel.active } });
    const actions = res.flatMap(({ ext, r }) => (Array.isArray(r) ? r.map((a) => ({ ...a, ext })) : []));
    if (!actions.length) return this.app.toast("No quick fixes here.", "primary", 2000);
    const { quickPick } = await import("../ui/extensions/vscode-dialogs.js");
    const i = await quickPick({ title: "Quick Fix", items: actions.map((a) => ({ label: a.title, description: a.ext.manifest.displayName })) });
    if (i === null || i === undefined) return;
    const a = actions[i];
    if (a.edit) for (const f of a.edit) if (f.path) this.#applyEdits(f.path, f.edits, a.ext, a.title);
    if (a.command && a.ext.frame) await a.ext.frame.invoke("command.run", { id: a.command.command, args: a.command.arguments }, 60_000).catch((err) => this.app.toast(err.message, "danger", 5000));
  }

  /** Applies VS Code edits ({start, end, text} in line/character) to a project file as ONE undo step. */
  #applyEdits(path, edits, ext, label) {
    const ed = this.app.codeUI?.editors;
    const st = ed?.stateFor?.(path);
    if (!st) throw new RpcError("BAD_REQUEST", `“${path}” is not a text file of the open project.`);
    const off = (p) => {
      const n = Math.min(Math.max(1, (p?.line | 0) + 1), st.doc.lines);
      const line = st.doc.line(n);
      return line.from + Math.min(Math.max(0, p?.character | 0), line.length);
    };
    const changes = edits
      .slice(0, 5000)
      .map((e) => {
        const a = off(e.start);
        const b = off(e.end);
        return { from: Math.min(a, b), to: Math.max(a, b), insert: String(e.text ?? "") };
      })
      .sort((x, y) => x.from - y.from || x.to - y.to)
      .filter((c, i, all) => i === 0 || c.from >= all[i - 1].to);
    if (!changes.length) return true;
    ed.applyChanges(path, changes, { userEvent: "input.vscode" });
    if (ext && label) this.#log(ext, "info", `${label}: ${changes.length} edit${changes.length === 1 ? "" : "s"} in ${path}`);
    return true;
  }

  // ------------------------------------------------------------------ handlers of the frame API

  #handlers(ext) {
    const { app } = this;
    const H = {};
    const interactive = (fn) => Object.assign(fn, { interactive: true });
    const name = () => ext.manifest.displayName;
    const web = () => app.codeUI?.web || null;
    const projectPath = (uri) => {
      const s = v.str(uri, "uri", { max: 2000 });
      const m = /^(?:file|openfini):\/\/[^/]*\/(.*)$/.exec(s) || /^(?:file|openfini):\/?(.*)$/.exec(s);
      if (!m) return null;
      try {
        return decodeURIComponent(m[1]).replace(/^\/+/, "");
      } catch {
        return null;
      }
    };
    const ownFile = (uri) => {
      const m = new RegExp(`^openfini-ext://${ext.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(.*)$`).exec(String(uri));
      return m ? decodeURIComponent(m[1]).replace(/^\/+/, "") : null;
    };
    H["api.unsupported"] = (p) => {
      const api = v.str(p.api, "api", { max: 200 });
      const list = (ext.rec.runtimeUnsupported ||= []);
      if (!list.includes(api) && list.length < 100) {
        list.push(api);
        this.#log(ext, "warn", `Used an API OpenFini does not support: vscode.${api}`);
        ext.compat = compatibility(ext.manifest, { code: readText(ext.rec.files, ext.manifest.browser) || "", names: ext.rec.native || [], runtimeUnsupported: list });
        this.#persist(ext).catch(() => {});
        this.emit("change");
      }
      return null;
    };
    H["commands.register"] = (p) => {
      v.str(p.id, "id", { max: 200 });
      return null;
    };
    H["commands.execute"] = async (p) => {
      const id = v.oneOf(p.id, "id", ["code.format", "code.toggleComment", "file.save", "code.undo", "code.redo", "code.find", "code.quickOpen", "code.palette", "code.gotoLine"]);
      return { ok: !!(await app.run(id)) };
    };
    H["window.message"] = interactive(async (p) => {
      const text = v.str(p.text, "text", { max: 2000 });
      const kind = v.oneOf(p.kind, "kind", ["info", "warning", "error"]);
      const items = v.arr(p.items ?? [], "items", { max: 6 }).map((x) => String(x).slice(0, 60));
      this.#log(ext, kind === "info" ? "info" : kind === "warning" ? "warn" : "error", `Message: ${text}`);
      if (!items.length && !p.modal) {
        app.toast(`${name()}: ${text}`, KIND_VARIANT[kind], 4000);
        return null;
      }
      const { messageDialog } = await import("../ui/extensions/vscode-dialogs.js");
      return messageDialog({ title: name(), text, detail: String(p.detail || "").slice(0, 2000), items, kind });
    });
    H["window.input"] = interactive(async (p) => {
      const { promptDialog } = await import("../ui/dialogs.js");
      return promptDialog({ title: String(p.title || name()).slice(0, 80), label: String(p.prompt || p.placeHolder || "").slice(0, 300), value: String(p.value || "").slice(0, 2000), type: p.password ? "password" : "text" });
    });
    H["window.pick"] = interactive(async (p) => {
      const list = v.arr(p.items, "items", { max: 500 }).map((x) => ({ label: String(x?.label ?? "").slice(0, 200), description: String(x?.description ?? "").slice(0, 200), detail: String(x?.detail ?? "").slice(0, 300), picked: !!x?.picked }));
      const { quickPick } = await import("../ui/extensions/vscode-dialogs.js");
      return quickPick({ title: String(p.placeHolder || name()).slice(0, 120), items: list, many: !!p.canPickMany });
    });
    H["window.status"] = (p) => {
      app.status(v.str(p.text, "text", { max: 300 }) ? `${name()}: ${p.text}` : "");
      return null;
    };
    H["window.show"] = (p) => {
      const path = v.str(p.path, "path", { max: 500 });
      if (!web()?.has(path)) throw new RpcError("BAD_REQUEST", `“${path}” is not a file of the open project.`);
      app.codeUI.openFile(path, { focus: true });
      return null;
    };
    H["output.append"] = (p) => {
      const ch = v.str(p.channel, "channel", { max: 80 });
      const text = v.str(p.text, "text", { max: 64 * 1024 });
      const prev = p.replace ? "" : ext.output.get(ch) || "";
      ext.output.set(ch, (prev + text).slice(-MAX_OUTPUT));
      this.emit("log", ext);
      return null;
    };
    H["output.show"] = () => {
      app.status(`${name()}: see its output in Studio ▸ Extensions ▸ VS Code`);
      return null;
    };
    H["editor.edit"] = (p) => {
      const path = v.str(p.path, "path", { max: 500 });
      const edits = v.arr(p.edits, "edits", { max: 5000 });
      if (typeof p.version === "number" && p.version !== (this.versions.get(path) || 1)) return false; // the document changed meanwhile, like VS Code
      return this.#applyEdits(path, edits, ext, "Edit");
    };
    H["editor.snippet"] = async (p) => {
      const path = v.str(p.path, "path", { max: 500 });
      const text = v.str(p.text, "text", { max: 100_000 });
      if (path !== this.path || !this.view) throw new RpcError("BAD_REQUEST", "Snippets can only be inserted into the active editor.");
      const { insertSnippet } = await import("./editor-bridge.js");
      return insertSnippet(this.view, text, p.at, path);
    };
    H["editor.select"] = (p) => {
      const path = v.str(p.path, "path", { max: 500 });
      const s = v.arr(p.selections, "selections", { max: 20 })[0];
      if (path !== this.path || !this.view || !s) return false;
      const doc = this.view.state.doc;
      const off = (q) => {
        const line = doc.line(Math.min(Math.max(1, (q?.line | 0) + 1), doc.lines));
        return line.from + Math.min(Math.max(0, q?.character | 0), line.length);
      };
      this.view.dispatch({ selection: { anchor: off(s.anchor), head: off(s.active) }, scrollIntoView: true });
      return true;
    };
    H["workspace.read"] = (p) => {
      const own = ownFile(p.uri);
      if (own !== null) {
        const b = ext.rec.files[own];
        if (!b) throw new RpcError("BAD_REQUEST", `The extension file “${own}” is not available (OpenFini keeps only the files it uses).`);
        return p.bytes ? b : { text: new TextDecoder().decode(b), version: 1, languageId: languageIdOf(own) };
      }
      const path = projectPath(p.uri);
      const w = web();
      if (!path || !w?.has(path)) throw new RpcError("BAD_REQUEST", "Only files of the open Code studio project can be read.");
      if (p.bytes) return w.bytes(path);
      if (!w.isText(path)) throw new RpcError("BAD_REQUEST", `“${path}” is not a text file.`);
      return { text: w.text(path), version: this.versions.get(path) || 1, languageId: this.languageIdOf(path) };
    };
    H["workspace.stat"] = (p) => {
      const path = projectPath(p.uri) ?? "";
      const w = web();
      if (!w) throw new RpcError("BAD_REQUEST", "No Code studio project is open.");
      if (w.has(path)) return { type: 1, size: w.bytes(path)?.length || 0, ctime: 0, mtime: 0 };
      if (!path || w.paths.some((x) => x.startsWith(`${path}/`))) return { type: 2, size: 0, ctime: 0, mtime: 0 };
      throw new RpcError("BAD_REQUEST", `“${path}” does not exist (FileNotFound).`);
    };
    H["workspace.list"] = (p) => {
      const dir = (projectPath(p.uri) ?? "").replace(/\/+$/, "");
      const w = web();
      if (!w) return [];
      const seen = new Map();
      for (const x of w.paths) {
        if (dir && !x.startsWith(`${dir}/`)) continue;
        const rest = dir ? x.slice(dir.length + 1) : x;
        const [head, ...more] = rest.split("/");
        seen.set(head, more.length ? 2 : 1);
      }
      return [...seen].slice(0, 5000);
    };
    H["workspace.find"] = (p) => {
      const w = web();
      if (!w) return [];
      const inc = globToRegExp(v.str(p.include ?? "**/*", "include", { max: 300 }));
      const exc = p.exclude ? globToRegExp(v.str(p.exclude, "exclude", { max: 300 })) : null;
      return w.paths.filter((x) => inc.test(x) && !exc?.test(x)).slice(0, Math.min(5000, v.num(p.max ?? 1000, "max", { min: 1, max: 5000 })));
    };
    H["workspace.applyEdit"] = (p) => {
      const files = v.arr(p.files ?? [], "files", { max: 50 });
      for (const f of files) if (f?.path) this.#applyEdits(String(f.path), v.arr(f.edits, "edits", { max: 5000 }), ext, "Workspace edit");
      return true;
    };
    H["config.update"] = async (p) => {
      const key = v.str(p.key, "key", { max: 200 });
      await this.setSetting(ext.id, key, p.value, { fromExtension: true });
      return null;
    };
    H["storage.set"] = async (p) => {
      const scope = v.oneOf(p.scope, "scope", ["global", "workspace"]);
      const key = v.str(p.key, "key", { max: 200, min: 1 });
      const data = (await kvGet(`vsx:data:${ext.id}`)) || {};
      const bucket = (data[scope] ||= {});
      if (p.value === null) delete bucket[key];
      else bucket[key] = p.value;
      if (JSON.stringify(data).length > 1024 * 1024) throw new RpcError("QUOTA", "The extension's state is larger than 1 MB.");
      await kvSet(`vsx:data:${ext.id}`, data);
      return null;
    };
    H["providers.register"] = (p) => {
      const handle = v.num(p.handle, "handle", { int: true, min: 1, max: 1e6 });
      const kind = v.oneOf(p.kind, "kind", Object.keys(PROVIDER_TIMEOUT));
      if (ext.providers.size >= 200) throw new RpcError("QUOTA", "Too many providers.");
      ext.providers.set(handle, { kind, selector: p.selector, triggers: (Array.isArray(p.triggers) ? p.triggers : []).map((c) => String(c).slice(0, 2)).slice(0, 20) });
      this.#log(ext, "info", `Registered a ${kind} provider for ${JSON.stringify(p.selector).slice(0, 120)}`);
      this.app.emit("commands");
      return null;
    };
    H["providers.dispose"] = (p) => {
      ext.providers.delete(p.handle);
      return null;
    };
    H["diagnostics.set"] = (p) => {
      ext.diagnostics = v.num(p.count ?? 0, "count", { min: 0, max: 1e6 });
      return null;
    };
    H["env.clipboard"] = async (p) => {
      await navigator.clipboard?.writeText(v.str(p.text, "text", { max: 1024 * 1024 }));
      return null;
    };
    H["env.openExternal"] = interactive(async (p) => {
      const url = v.str(p.url, "url", { max: 2000 });
      if (!/^https?:\/\//i.test(url)) throw new RpcError("BAD_REQUEST", "Only http(s) links can be opened.");
      const { confirmDialog } = await import("../ui/dialogs.js");
      if (!(await confirmDialog({ title: name(), message: `Open this link in your browser?\n${url}`, ok: "Open" }))) return false;
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    });
    H["network.fetch"] = async (p) => {
      const url = v.str(p.url, "url", { max: 2000 });
      if (app.network?.assert) app.network.assert("extension", url);
      const init = v.obj(p.init, "init");
      const method = v.oneOf(String(init.method || "GET").toUpperCase(), "method", ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
      const headers = {};
      for (const [k, val] of Object.entries(v.obj(init.headers, "headers"))) if (!/^(cookie|host|origin|referer|user-agent|proxy-|sec-)/i.test(k)) headers[k.slice(0, 100)] = String(val).slice(0, 2000);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30_000);
      try {
        const res = await fetch(url, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : init.body, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store", signal: ctl.signal });
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length > 5 * 1024 * 1024) throw new RpcError("TOO_LARGE", "The response is larger than 5 MB.");
        this.#log(ext, "info", `fetch ${method} ${originOf(url)} → ${res.status}`);
        return { status: res.status, headers: Object.fromEntries([...res.headers].slice(0, 40)), text: new TextDecoder().decode(buf) };
      } catch (err) {
        if (err instanceof RpcError) throw err;
        throw new RpcError("NETWORK", err.name === "AbortError" ? "The request timed out." : `Request failed: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
    };
    return H;
  }

  // ------------------------------------------------------------------ install, update, remove

  /** Unpacks and checks a .vsix without installing it. */
  inspect(bytes) {
    const { pkg, manifest, files, names } = unpackVsix(bytes, { locale: localeTag() });
    const code = manifest.browser ? readText(files, manifest.browser) || "" : "";
    const native = names.filter((n) => /\.(node|dll|so|dylib|exe)$/i.test(n)).slice(0, 10);
    const compat = compatibility(manifest, { code, names: native });
    return { pkg, manifest, files, native, compat, existing: this.get(manifest.id) };
  }

  /**
   * Installs or updates after the user consented.
   * @param {{bytes: Uint8Array, source: {type: "openvsx"|"file", name?: string, url?: string, namespace?: string, extName?: string}}} pkgIn
   * @param {(info: object) => Promise<{ok: boolean, network?: string[]} | boolean>} ask
   */
  async install({ bytes, source }, ask) {
    const info = this.inspect(bytes);
    if (typeof ask !== "function") throw new Error("Installing a VS Code extension needs the user's consent.");
    const answer = await ask({ ...info, source });
    const ok = answer === true || answer?.ok === true;
    if (!ok) return null;
    const { manifest, existing } = info;
    if (manifest.contributes.themes.length + manifest.contributes.snippets.length > 200) throw new Error("This extension contributes too many themes or snippet files.");
    const rec = {
      id: manifest.id,
      pkg: info.pkg,
      entry: manifest.browser || null,
      files: info.files,
      native: info.native,
      enabled: existing ? existing.rec.enabled !== false : true,
      settings: existing?.rec.settings || {},
      network: (answer?.network || existing?.rec.network || []).filter((o) => /^https?:\/\/[^/]+$/.test(o)).slice(0, 20),
      source: source || { type: "file" },
      machineId: existing?.rec.machineId,
      runtimeUnsupported: [],
      installedAt: existing?.rec.installedAt || Date.now(),
      updatedAt: Date.now(),
    };
    if (existing) {
      this.#unregister(existing);
      this.exts.delete(existing.id);
    }
    const ext = this.#add(rec);
    await this.#persist(ext);
    this.#log(ext, "info", `${existing ? `Updated to ${manifest.version}` : `Installed ${manifest.version}`} (${rec.source.type === "openvsx" ? "Open VSX" : "local file"}); ${ext.compat.label}`);
    this.emit("change");
    return { id: ext.id, updated: !!existing, compat: ext.compat };
  }

  async installFromOpenVsx(namespace, extName, ask) {
    const d = await this.openVsx.details(namespace, extName);
    if (!d.files.download) throw new Error("Open VSX offers no download for this extension.");
    const bytes = await this.openVsx.download(d.files.download);
    return this.install({ bytes, source: { type: "openvsx", namespace: d.namespace, extName: d.name, url: d.files.download, version: d.version } }, ask);
  }

  /** Looks for a newer version on Open VSX; installs it after consent. Returns { latest, current, updated }. */
  async checkUpdate(id, ask) {
    const ext = this.get(id);
    const src = ext?.rec.source;
    if (src?.type !== "openvsx") throw new Error("Only extensions installed from Open VSX can be updated automatically. Install the new .vsix file to update.");
    const d = await this.openVsx.details(src.namespace, src.extName);
    const newer = cmpVersion(d.version, ext.manifest.version) > 0;
    if (!newer) return { latest: d.version, current: ext.manifest.version, updated: false };
    const done = await this.installFromOpenVsx(src.namespace, src.extName, ask);
    return { latest: d.version, current: ext.manifest.version, updated: !!done };
  }

  async uninstall(id) {
    const ext = this.get(id);
    if (!ext) return;
    this.#unregister(ext);
    this.exts.delete(ext.id);
    await kvDelete(`vsx:rec:${ext.id}`);
    await kvDelete(`vsx:data:${ext.id}`);
    await kvSet(INDEX_KEY, [...this.exts.keys()]);
    coreLog.log("info", "vscode", `Uninstalled ${ext.id}`);
    this.emit("change");
  }

  async setEnabled(id, on) {
    const ext = this.get(id);
    if (!ext) return;
    ext.rec.enabled = !!on;
    if (on) {
      ext.state = "idle";
      ext.error = null;
      this.#register(ext);
    } else {
      this.#unregister(ext);
      ext.state = "disabled";
    }
    await this.#persist(ext);
    this.#log(ext, "info", on ? "Enabled" : "Disabled");
    this.emit("change");
  }

  async setNetwork(id, origins) {
    const ext = this.get(id);
    if (!ext) return;
    ext.rec.network = origins.filter((o) => /^https?:\/\/[^/]+$/.test(o)).slice(0, 20);
    ext.dispatcher.setGranted(ext.rec.network.map((o) => `network:${o}`));
    await this.#persist(ext);
    this.emit("change");
  }

  settingsOf(ext) {
    const out = {};
    for (const [k, def] of Object.entries(ext.manifest.contributes.configuration)) out[k] = ext.rec.settings?.[k] ?? def.default;
    return out;
  }

  async setSetting(id, key, value, { fromExtension = false } = {}) {
    const ext = this.get(id);
    if (!ext) return;
    const def = ext.manifest.contributes.configuration[key];
    if (!def && !fromExtension) throw new Error(`Unknown setting ${key}`);
    if (JSON.stringify(value ?? null).length > 64 * 1024) throw new Error("The value is too large.");
    const next = { ...ext.rec.settings };
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
    ext.rec.settings = next;
    await this.#persist(ext);
    ext.frame?.invoke("config.changed", { values: next, keys: [key] }, 5000).catch(() => {});
    this.emit("change");
  }
}

/** Compares dotted versions (pre-release suffixes ignored). */
export function cmpVersion(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}

/** The sandboxed document of a web extension: CSP first, the shim, then the CommonJS bundle and the boot call. */
export function buildFrameDocument(cfg, code) {
  const head = `const __VSX_CFG = ${JSON.stringify(cfg).replace(/</g, "\\u003c")};\n${VSCODE_RUNTIME_SRC}`;
  const wrapped = `__vsxDefine(function (module, exports, require, process, global) {\n${code}\n});`;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(FRAME_CSP)}"><script src="${scriptUrl(head)}"></script></head><body><script src="${scriptUrl(wrapped)}"></script><script src="${scriptUrl("__vsxBoot()")}"></script></body></html>`;
}
