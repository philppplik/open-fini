// The extension host: installed extensions, their sandboxes, contributions (commands, menus, panels, themes, …),
// activation events and the handlers behind the `openfini` API. Everything an extension can do goes through
// `createDispatcher` (permission checks, limits) and the same tool layer the Vibe assistant uses.
import { Emitter } from "../core/util.js";
import { log as coreLog } from "../core/log.js";
import { kvGet, kvSet, kvDelete } from "../core/storage.js";
import { platform } from "../platform/index.js";
import { registerTheme } from "../ui/themes.js";
import { PANELS, registerPanel } from "../ui/panels/index.js";
import { STUDIOS } from "../studios/index.js";
import { validateManifest, checkPackageFiles, API_VERSION, STUDIO_IDS } from "./manifest.js";
import { createDispatcher, RpcError, v } from "./rpc.js";
import { classifyTool, vibeToolName, findShortcutConflict, hasPermission, originOf } from "./permissions.js";
import { buildMainDocument, buildPanelDocument } from "./html.js";
import { RUNTIME_SRC } from "./runtime-src.js";
import { createSandbox } from "./sandbox.js";
import { historyMark, mergeSince } from "./history.js";

export const FALLBACK_HOST_VERSION = "0.4.0";
const INDEX_KEY = "ext:index";
const MAX_LOGS = 200;
const dec = new TextDecoder();
const THEME_VARS = ["--of-font", "--of-mono", "--of-radius", "--of-radius-sm", "--of-accent", "--of-accent-strong", "--of-accent-soft", "--of-danger", "--of-ok", "--of-bg-app", "--of-bg-bar", "--of-bg-panel", "--of-bg-raised", "--of-bg-input", "--of-border", "--of-border-soft", "--of-text", "--of-text-dim", "--of-text-faint", "--of-hover", "--of-active"];
const KIND_VARIANT = { info: "primary", success: "success", warning: "warning", error: "danger" };
const jsonSafe = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));
const slugId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Offline-mode kill switch of the security work (core/network.js), with a tiny fallback while it is absent. */
export function networkAllowed(app, url) {
  if (typeof app.network?.allowed === "function") return !!app.network.allowed("extension", url);
  return app.prefs?.offlineMode !== true;
}

export class ExtensionHost extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.exts = new Map();
    this.hostVersion = FALLBACK_HOST_VERSION;
    this.safeMode = false;
    this.toolMap = null;
    this._toolsPromise = null;
    this._gen = 0;
    this._timers = new Map();
    const throttled = (name, payload) => {
      for (const ext of this.exts.values()) {
        if (ext.state === "disabled" || !ext.subs.has(name) || ext.pendingEvents.has(name)) continue;
        ext.pendingEvents.add(name);
        setTimeout(() => {
          ext.pendingEvents.delete(name);
          this.#broadcast(ext, "event", { name, payload: payload() });
        }, 120);
      }
    };
    app.on("docchange", (ev) => throttled("documentChanged", () => ({ label: ev?.label || null, structure: !!ev?.structure, rev: app.doc?.rev ?? 0 })));
    app.on("doc", () => throttled("documentChanged", () => ({ switched: true, rev: app.doc?.rev ?? 0 })));
    app.on("selection", () => throttled("selectionChanged", () => ({ ids: app.selection.map((n) => n.id) })));
    app.on("studio", (id) => {
      throttled("studioChanged", () => ({ studio: app.studio }));
      this.#fire(`onStudio:${id}`);
    });
    app.on("prefs", () => requestAnimationFrame(() => this.#pushTheme()));
  }

  // ------------------------------------------------------------------ loading and persistence

  async load() {
    try {
      const info = await fetch("./build-info.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (info?.version && /^\d+\.\d+\.\d+/.test(info.version)) this.hostVersion = info.version;
    } catch {
      /* development build */
    }
    this.safeMode = this.app.prefs.extensionsEnabled === false || !!this.app.safeMode;
    const ids = (await kvGet(INDEX_KEY)) || [];
    for (const id of ids) {
      const rec = await kvGet(`ext:rec:${id}`);
      if (rec?.raw) this.#add(rec);
    }
    this.app.emit("commands");
    this.emit("change");
    this.#fire("onStartup");
    this.#fire(`onStudio:${this.app.studio}`);
    if ([...this.exts.values()].some((e) => e.valid && e.manifest.permissions.some((p) => p.startsWith("document.")))) this.#tools().catch(() => {});
  }

  async #persist(ext) {
    const ids = [...this.exts.keys()];
    await kvSet(INDEX_KEY, ids);
    await kvSet(`ext:rec:${ext.id}`, ext.rec);
  }

  list() {
    return [...this.exts.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  get(id) {
    return this.exts.get(id) || null;
  }

  /** Validates the stored record again (manifest, files, engine) and creates the runtime entry. */
  #add(rec) {
    const res = validateManifest(rec.raw, { hostVersion: this.hostVersion });
    const fileErrors = res.ok ? checkPackageFiles(res.manifest, Object.keys(rec.files || {})) : [];
    const errors = [...res.errors.map((e) => e.message), ...fileErrors];
    const manifest = res.manifest;
    const granted = (rec.granted || []).filter((p) => manifest?.permissions.includes(p));
    rec.granted = granted;
    const ext = {
      id: rec.id,
      name: rec.raw?.name || rec.id,
      rec,
      manifest,
      valid: !errors.length,
      state: errors.length ? "invalid" : rec.enabled === false ? "disabled" : "inactive",
      error: errors.length ? errors.slice(0, 5).join("\n") : null,
      frame: null,
      panels: new Set(),
      subs: new Set(),
      pendingEvents: new Set(),
      logs: [],
      unreg: [],
      declared: new Set(),
      dynTools: new Map(),
      dynSkills: [],
      data: null,
      crashes: 0,
      scope: null,
      activating: null,
      registered: false,
    };
    if (this.safeMode && ext.valid) ext.state = "disabled";
    ext.dispatcher = createDispatcher({
      handlers: this.#handlers(ext),
      granted: granted,
      toolKind: async (name) => {
        const map = await this.#tools();
        return map.has(name) ? classifyTool(map.get(name)) : "denied";
      },
      onViolation: (kind) => this.#kill(ext, `it broke a limit (${kind})`),
      onCall: (m, ok, ms) => ms > 5000 && !/^(ui.(form|prompt|confirm)|files.)/.test(m) && this.#log(ext, "warn", `${m} took ${Math.round(ms / 100) / 10} s`),
    });
    this.exts.set(ext.id, ext);
    if (ext.valid && ext.state !== "disabled") this.#register(ext);
    else if (!ext.valid) this.#log(ext, "error", `Invalid extension: ${ext.error}`);
    return ext;
  }

  #log(ext, level, text) {
    ext.logs.push({ t: Date.now(), level, text });
    if (ext.logs.length > MAX_LOGS) ext.logs.shift();
    coreLog.log(level === "info" ? "info" : level, "extensions", `[${ext.id}] ${text}`);
    this.emit("log", ext);
  }

  // ------------------------------------------------------------------ contributions

  #register(ext) {
    if (ext.registered) return;
    ext.registered = true;
    const { app } = this;
    const c = ext.manifest.contributes;
    const gen = ++this._gen;
    const keys = new Map(c.keybindings.map((k) => [k.command, k]));
    for (const cmd of c.commands) {
      const full = `ext:${ext.id}:${cmd.id}`;
      let shortcut;
      const kb = keys.get(cmd.id);
      if (kb) {
        const conflict = findShortcutConflict([...app.commands.values()], kb.key, kb.studios || cmd.studios);
        if (conflict) this.#log(ext, "warn", `Shortcut ${kb.key} for “${cmd.title}” was not set: it is already used by ${conflict}.`);
        else shortcut = kb.key;
      }
      app.registerCommand(full, {
        label: cmd.title,
        icon: cmd.icon,
        studios: cmd.studios,
        shortcut,
        ext: ext.id,
        enabled: (a) => (cmd.requires === "document" ? !!a.doc : cmd.requires === "selection" ? !!a.doc && a.selection.length > 0 : true),
        run: (a, args) => {
          this.runCommand(ext.id, cmd.id, args);
        },
      });
      ext.unreg.push(() => app.commands.delete(full));
    }
    for (const p of c.panels) {
      const pid = `ext:${ext.id}:${p.id}:${gen}`;
      registerPanel(pid, { title: p.title, icon: p.icon, ext: ext.id, create: () => this.#panel(ext, p) });
      const places = p.studios.map((s) => [s, p.location || (s === "code" ? "top" : "bottom")]);
      for (const [s, loc] of places) STUDIOS[s][loc].push(pid);
      ext.declared.add(`panel:${p.id}`);
      ext.panelIds ||= new Map();
      ext.panelIds.set(p.id, pid);
      ext.unreg.push(() => {
        delete PANELS[pid];
        for (const [s, loc] of places) STUDIOS[s][loc] = STUDIOS[s][loc].filter((x) => x !== pid);
      });
    }
    for (const t of c.themes) {
      const tid = `x${[...ext.id].reduce((h, ch) => ((h << 5) + h + ch.charCodeAt(0)) >>> 0, 5381).toString(36).slice(0, 5)}-${slugId(t.id)}`.slice(0, 40).replace(/-+$/, "");
      try {
        const off = registerTheme({ id: tid, name: t.label, group: ext.name, description: `From the extension ${ext.name}`, light: { vars: t.light }, dark: { vars: t.dark } }, { replace: true });
        ext.unreg.push(off);
      } catch (err) {
        this.#log(ext, "warn", `Theme “${t.label}” was rejected: ${err.message}`);
      }
    }
    app.emit("commands");
    app.dock?.render?.();
    this.app.emit("extensions:vibe");
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
    this.#stopFrames(ext);
    this.app.emit("commands");
    this.app.dock?.render?.();
    this.app.emit("extensions:vibe");
  }

  #enabled(ext) {
    return ext.valid && ext.registered && ext.state !== "disabled";
  }

  /** Menu entries (command ids and ad-hoc items) that extensions add to the menu `label` in `studio`. */
  menuItems(label, studio) {
    const out = [];
    for (const ext of this.exts.values()) {
      if (!this.#enabled(ext)) continue;
      const c = ext.manifest.contributes;
      for (const m of c.menus) {
        if (m.menu !== label || (m.studios && !m.studios.includes(studio))) continue;
        const cmd = c.commands.find((x) => x.id === m.command);
        if (cmd?.studios && !cmd.studios.includes(studio)) continue;
        out.push(`ext:${ext.id}:${m.command}`);
      }
      if (label === "File") {
        const run = (fn) => () => fn().catch((err) => this.app.toast(err.message, "danger", 5000));
        const tpl = c.templates.map((t) => ({ label: t.label, run: run(() => this.newFromTemplate(ext.id, t.id)) }));
        const imp = c.importers.map((i) => ({ label: i.title, run: run(() => this.pickAndImport(ext.id, i)) }));
        const exp = c.exporters.map((i) => ({ label: i.title, run: () => this.runCommand(ext.id, i.command) }));
        if (tpl.length) out.push({ label: `New from ${ext.name}`, items: tpl });
        if (imp.length) out.push({ label: `Import with ${ext.name}`, items: imp });
        if (exp.length) out.push({ label: `Export with ${ext.name}`, items: exp });
      }
    }
    return out.length ? ["-", ...out] : [];
  }

  /** Submenu of every extension's commands for the Studio menu. */
  commandMenu(studio) {
    const out = [];
    for (const ext of this.exts.values()) {
      if (!this.#enabled(ext)) continue;
      const items = ext.manifest.contributes.commands.filter((c) => !c.studios || c.studios.includes(studio)).map((c) => `ext:${ext.id}:${c.id}`);
      if (items.length) out.push({ label: ext.name, items });
    }
    return out;
  }

  /** Code studio snippets of all enabled extensions for one language. */
  snippets(language) {
    const out = [];
    for (const ext of this.exts.values()) if (this.#enabled(ext)) for (const s of ext.manifest.contributes.snippets) if (s.language === language) out.push({ ...s, ext: ext.id });
    return out;
  }

  // ------------------------------------------------------------------ activation

  #fire(event) {
    for (const ext of this.exts.values()) {
      if (this.#enabled(ext) && ext.manifest.main && ext.state === "inactive" && ext.manifest.activationEvents.includes(event)) this.activate(ext.id).catch(() => {});
    }
  }

  themeVars() {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const k of THEME_VARS) {
      const val = cs.getPropertyValue(k).trim();
      if (val) out[k] = val;
    }
    return out;
  }
  #pushTheme() {
    const vars = this.themeVars();
    for (const ext of this.exts.values()) this.#broadcast(ext, "theme", { vars });
  }

  frames(ext) {
    return [ext.frame, ...ext.panels].filter((f) => f?.alive);
  }
  #broadcast(ext, m, p, except) {
    for (const f of this.frames(ext)) if (f !== except) f.invoke(m, p, 5000).catch(() => {});
  }

  #config(ext, extra = {}) {
    return { id: ext.id, version: ext.manifest.version, apiVersion: API_VERSION, settings: this.settingsOf(ext), theme: this.themeVars(), ...extra };
  }

  async activate(id) {
    const ext = this.exts.get(id);
    if (!ext || !ext.valid) throw new Error(`Extension “${id}” is not installed or invalid.`);
    if (ext.state === "disabled") throw new Error(`Extension “${ext.name}” is disabled.`);
    if (ext.state === "active") return ext;
    if (ext.activating) return ext.activating;
    ext.activating = (async () => {
      ext.state = "activating";
      ext.error = null;
      this.emit("change");
      try {
        const files = ext.rec.files;
        if (ext.manifest.main) {
          if (ext.manifest.permissions.some((p) => p.startsWith("document."))) await this.#tools();
          const doc = buildMainDocument({ config: this.#config(ext), runtimeSrc: RUNTIME_SRC, mainCode: dec.decode(files[ext.manifest.main]) });
          const sb = this.#sandbox(ext, doc, `Extension ${ext.name}`);
          ext.frame = sb;
          const r = await Promise.race([sb.ready, new Promise((res) => setTimeout(() => res({ error: "it did not finish starting within 10 seconds" }), 10_000))]);
          if (r.error) throw new Error(`“${ext.name}” could not start: ${r.error}`);
          this.#heartbeat(ext);
        }
        ext.state = "active";
        this.#log(ext, "info", "Activated");
      } catch (err) {
        this.#log(ext, "error", err.message);
        ext.frame?.destroy();
        ext.frame = null;
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

  #sandbox(ext, doc, label, hidden = true) {
    return createSandbox({ doc, label, hidden, onRequest: (m, sb) => ext.dispatcher.dispatch(m, { sandbox: sb }), onLog: (lv, t) => this.#log(ext, lv, t) });
  }

  #heartbeat(ext) {
    clearInterval(this._timers.get(ext.id));
    let misses = 0;
    this._timers.set(
      ext.id,
      setInterval(async () => {
        if (!ext.frame?.alive) return;
        try {
          await ext.frame.invoke("ping", {}, 5000);
          misses = 0;
        } catch {
          if (++misses >= 2) this.#kill(ext, "it stopped responding");
        }
      }, 15_000),
    );
  }

  #stopFrames(ext) {
    clearInterval(this._timers.get(ext.id));
    this._timers.delete(ext.id);
    ext.frame?.destroy();
    ext.frame = null;
    for (const p of ext.panels) p.destroy();
    ext.panels.clear();
    ext.subs.clear();
    ext.declaredTools = null;
  }

  /** Stops a misbehaving extension: destroys its frames, logs it and tells the user. */
  #kill(ext, reason) {
    if (ext.state === "error" || ext.state === "disabled") return;
    this.#stopFrames(ext);
    ext.state = "error";
    ext.error = `Stopped: ${reason}.`;
    ext.crashes++;
    this.#log(ext, "error", ext.error);
    this.app.toast(`The extension “${ext.name}” was stopped: ${reason}. See Studio ▸ Extensions for details.`, "warning", 6000);
    if (ext.crashes >= 3) this.setEnabled(ext.id, false).catch(() => {});
    this.emit("change");
  }

  async deactivate(id) {
    const ext = this.exts.get(id);
    if (!ext) return;
    try {
      await ext.frame?.invoke("deactivate", {}, 2000);
    } catch {
      /* it may be gone already */
    }
    this.#stopFrames(ext);
    if (ext.state === "active" || ext.state === "error") ext.state = "inactive";
    this.emit("change");
  }

  // ------------------------------------------------------------------ running things

  async #undoScope(ext, label, fn) {
    const app = this.app;
    const doc = app.doc;
    if (ext.scope || !doc) return fn();
    ext.scope = { doc };
    const mark = historyMark(doc.history);
    try {
      return await fn();
    } finally {
      ext.scope = null;
      if (app.doc === doc || app.docs.includes(doc)) {
        if (mergeSince(doc.history, mark, label)) app.emit("render");
      }
    }
  }

  async runCommand(id, cmdId, args) {
    const ext = this.exts.get(id);
    const cmd = ext?.manifest?.contributes.commands.find((c) => c.id === cmdId);
    if (!ext || !cmd) throw new Error(`Unknown extension command ${id}:${cmdId}`);
    try {
      this.#fire(`onCommand:${cmdId}`);
      await this.activate(id);
      if (!ext.frame) throw new Error(`“${ext.name}” has no code to run.`);
      const res = await this.#undoScope(ext, `${ext.name}: ${cmd.title}`, () => ext.frame.invoke("command.run", { id: cmdId, args: jsonSafe(args) }, 10 * 60_000));
      return res;
    } catch (err) {
      this.#log(ext, "error", `${cmd.title}: ${err.message}`);
      this.app.toast(`${ext.name}: ${err.message}`, "danger", 6000);
      return null;
    }
  }

  async #tools() {
    if (this.toolMap) return this.toolMap;
    this._toolsPromise ||= import("../vibe/tools/index.js").then((m) => {
      this.toolMap = new Map(m.createOpenFiniTools(this.app, {}).map((t) => [t.name, t]));
      return this.toolMap;
    });
    return this._toolsPromise;
  }

  /** Runs one built-in tool by name with validated arguments (used for templates and the document API). */
  async runTool(name, args, { ext } = {}) {
    const map = await this.#tools();
    const tool = map.get(name);
    if (!tool || classifyTool(tool) === "denied") throw new RpcError("BAD_REQUEST", `Unknown or unavailable tool “${name}”.`);
    const { validateSchema } = await import("../ai/agent.js");
    const errors = validateSchema(args, tool.inputSchema);
    if (errors.length) throw new RpcError("BAD_REQUEST", `Invalid arguments for ${name}: ${errors.slice(0, 3).join("; ")}`);
    const run = () => tool.run(args, {});
    return jsonSafe(ext ? await this.#undoScope(ext, `${ext.name}: ${name}`, run) : await run());
  }

  // ------------------------------------------------------------------ settings and storage

  settingsOf(ext) {
    const out = {};
    for (const [k, def] of Object.entries(ext.manifest?.contributes.settings?.properties || {})) out[k] = ext.rec.settings?.[k] ?? def.default;
    return out;
  }

  async setSetting(id, key, value) {
    const ext = this.exts.get(id);
    const def = ext?.manifest.contributes.settings?.properties[key];
    if (!def) throw new Error(`Unknown setting ${key}`);
    if (typeof value !== def.type) throw new Error(`${def.title} must be a ${def.type}.`);
    if (def.enum && !def.enum.includes(value)) throw new Error(`${def.title} must be one of ${def.enum.join(", ")}.`);
    if (def.type === "number") value = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, value));
    ext.rec.settings = { ...ext.rec.settings, [key]: value };
    await this.#persist(ext);
    this.#broadcast(ext, "settings", { values: this.settingsOf(ext) });
  }

  async #data(ext) {
    return (ext.data ||= (await kvGet(`ext:data:${ext.id}`)) || {});
  }
  async #saveData(ext) {
    const size = JSON.stringify(ext.data).length;
    if (size > 1024 * 1024) throw new RpcError("QUOTA", "The extension's storage is full (1 MB).");
    await kvSet(`ext:data:${ext.id}`, ext.data);
  }

  // ------------------------------------------------------------------ the API handlers

  #handlers(ext) {
    const { app } = this;
    const H = {};
    const interactive = (fn) => Object.assign(fn, { interactive: true });
    const local = (id) => ext.manifest.contributes.commands.find((c) => c.id === id);
    H["commands.register"] = (p) => {
      const id = v.str(p.id, "id", { max: 64 });
      if (!local(id)) throw new RpcError("BAD_REQUEST", `The command “${id}” is not declared in contributes.commands of the manifest.`);
      return null;
    };
    H["commands.execute"] = async (p, meta) => {
      const id = v.str(p.id, "id", { max: 140 });
      if (local(id)) return jsonSafe(await this.runCommand(ext.id, id, p.args));
      if (!hasPermission(ext.dispatcher.granted, "commands")) throw new RpcError("PERMISSION_DENIED", 'Running other commands needs the "commands" permission.');
      if (!app.commands.has(id)) throw new RpcError("BAD_REQUEST", `Unknown command “${id}”.`);
      return { ok: !!(await app.run(id, p.args)) };
    };
    H["ui.showMessage"] = (p) => {
      const text = v.str(p.text, "text", { max: 500 });
      app.toast(`${ext.name}: ${text}`, KIND_VARIANT[v.oneOf(p.kind ?? "info", "kind", Object.keys(KIND_VARIANT))], 3600);
      return null;
    };
    H["ui.confirm"] = interactive(async (p) => {
      const { confirmDialog } = await import("../ui/dialogs.js");
      return !!(await confirmDialog({ title: v.str(p.title ?? ext.name, "title", { max: 80 }), message: v.str(p.text, "text", { max: 800 }), ok: v.str(p.ok ?? "OK", "ok", { max: 30 }), cancel: v.str(p.cancel ?? "Cancel", "cancel", { max: 30 }) }));
    });
    H["ui.prompt"] = interactive(async (p) => {
      const { promptDialog } = await import("../ui/dialogs.js");
      return promptDialog({ title: v.str(p.title ?? ext.name, "title", { max: 80 }), label: v.str(p.label, "label", { max: 200 }), value: v.str(p.value ?? "", "value", { max: 1000 }), ok: v.str(p.ok ?? "OK", "ok", { max: 30 }) });
    });
    H["ui.form"] = interactive(async (p) => {
      const { formDialog } = await import("../ui/extensions/dialogs.js");
      return formDialog({ title: v.str(p.title ?? ext.name, "title", { max: 80 }), description: v.str(p.description ?? "", "description", { max: 400 }), ok: v.str(p.ok ?? "OK", "ok", { max: 30 }), fields: v.arr(p.fields, "fields", { max: 24 }) });
    });
    H["ui.openPanel"] = (p) => {
      const id = v.str(p.id, "id", { max: 64 });
      const def = ext.manifest.contributes.panels.find((x) => x.id === id);
      const pid = ext.panelIds?.get(id);
      if (!def || !pid) throw new RpcError("BAD_REQUEST", `The panel “${id}” is not declared in contributes.panels.`);
      if (!def.studios.includes(app.studio)) app.setStudio(def.studios[0]);
      document.getElementById("app")?.classList.add("dock-open");
      app.dock?.reveal(pid);
      return null;
    };
    H["ui.setStatus"] = (p) => (app.status(v.str(p.text, "text", { max: 200 })), null);
    H["document.info"] = () => this.runTool("get_document_info", {});
    H["document.pageInfo"] = () => {
      const d = app.doc;
      const pg = app.page;
      if (!d || !pg) return null;
      return { name: d.name, index: d.pages.indexOf(pg), count: d.pages.length, width: Math.round(pg.w), height: Math.round(pg.h), studio: app.studio, website: !!d.web };
    };
    H["document.readSelection"] = () => this.runTool("get_selection", {});
    H["document.readLayers"] = (p) => this.runTool("list_layers", v.obj(p));
    H["document.listTools"] = async () => [...(await this.#tools()).values()].filter((t) => classifyTool(t) !== "denied").map((t) => ({ name: t.name, description: t.description, readOnly: !!t.readOnly, inputSchema: t.inputSchema }));
    H["document.callTool"] = (p) => this.runTool(v.str(p.name, "name", { max: 64 }), v.obj(p.args, "args"), { ext });
    H["studio.current"] = () => app.studio;
    H["studio.list"] = () => STUDIO_IDS.map((id) => ({ id, label: STUDIOS[id].label }));
    H["studio.set"] = (p) => (app.setStudio(v.oneOf(p.id, "id", STUDIO_IDS)), null);
    H["storage.get"] = async (p) => jsonSafe((await this.#data(ext))[v.str(p.key, "key", { max: 100, min: 1 })]);
    H["storage.set"] = async (p) => {
      const data = await this.#data(ext);
      const key = v.str(p.key, "key", { max: 100, min: 1 });
      const val = jsonSafe(p.value);
      if (JSON.stringify(val).length > 256 * 1024) throw new RpcError("QUOTA", "A single value may be at most 256 KB.");
      if (!(key in data) && Object.keys(data).length >= 200) throw new RpcError("QUOTA", "At most 200 keys.");
      data[key] = val;
      await this.#saveData(ext);
      return null;
    };
    H["storage.delete"] = async (p) => {
      delete (await this.#data(ext))[v.str(p.key, "key", { max: 100, min: 1 })];
      await this.#saveData(ext);
      return null;
    };
    H["storage.keys"] = async () => Object.keys(await this.#data(ext));
    H["storage.clear"] = async () => {
      ext.data = {};
      await this.#saveData(ext);
      return null;
    };
    H["settings.get"] = (p) => jsonSafe(this.settingsOf(ext)[p.key]);
    H["settings.getAll"] = () => this.settingsOf(ext);
    H["theme.get"] = () => this.themeVars();
    H["network.fetch"] = interactive((p) => this.#fetch(ext, p));
    H["files.open"] = interactive(async (p) => {
      const exts = v.arr(p.extensions ?? [], "extensions", { max: 20 }).map((e) => v.str(e, "extension", { max: 10, re: /^\.?[A-Za-z0-9]+$/ }).replace(/^\./, ""));
      const files = await platform.openFiles({ accept: exts.length ? [{ description: v.str(p.description ?? "Files", "description", { max: 60 }), extensions: exts }] : undefined, multiple: p.multiple === true });
      return files.slice(0, 20).map((f) => {
        if (f.bytes.length > 16 * 1024 * 1024) throw new RpcError("TOO_LARGE", `“${f.name}” is larger than 16 MB.`);
        return { name: f.name, mime: f.mime, size: f.bytes.length, data: f.bytes };
      });
    });
    H["files.save"] = interactive(async (p) => {
      const name = v.str(p.name, "name", { max: 120, min: 1, re: /^[^\\/:*?"<>|\0]+$/ });
      const data = typeof p.data === "string" ? new TextEncoder().encode(p.data) : p.data instanceof Uint8Array ? p.data : p.data instanceof ArrayBuffer ? new Uint8Array(p.data) : null;
      if (!data) throw new RpcError("BAD_REQUEST", "data must be a string or a Uint8Array.");
      if (data.length > 32 * 1024 * 1024) throw new RpcError("TOO_LARGE", "Files may be at most 32 MB.");
      const res = await platform.saveFile({ suggestedName: name, bytes: data, mime: v.str(p.mime ?? "application/octet-stream", "mime", { max: 100 }) });
      return { saved: !!res, name: res?.name ?? null };
    });
    H["events.subscribe"] = (p) => (ext.subs.add(p.event), null);
    H["vibe.registerTool"] = (p) => {
      const name = v.str(p.name, "name", { max: 41, re: /^[a-z][a-z0-9_]{1,40}$/ });
      const decl = ext.manifest.contributes.vibeTools.find((t) => t.name === name);
      if (!decl) {
        if (ext.dynTools.size >= 20 && !ext.dynTools.has(name)) throw new RpcError("QUOTA", "At most 20 Vibe tools.");
        const schema = p.inputSchema ?? { type: "object", properties: {} };
        if (typeof schema !== "object" || schema.type !== "object" || JSON.stringify(schema).length > 8000) throw new RpcError("BAD_REQUEST", "inputSchema must be a JSON Schema object (type: object, < 8 KB).");
        ext.dynTools.set(name, { name, description: v.str(p.description, "description", { max: 600, min: 10 }), inputSchema: schema });
      }
      app.emit("extensions:vibe");
      return null;
    };
    H["vibe.registerSkill"] = (p) => {
      if (ext.dynSkills.length >= 20) throw new RpcError("QUOTA", "At most 20 skills.");
      const skill = { name: v.str(p.name, "name", { max: 60, min: 2 }), description: v.str(p.description ?? "", "description", { max: 300 }), body: v.str(p.body, "body", { max: 20000, min: 10 }) };
      ext.dynSkills = [...ext.dynSkills.filter((s) => s.name !== skill.name), skill];
      app.emit("extensions:vibe");
      return null;
    };
    H["messages.post"] = (p, meta) => (this.#broadcast(ext, "message", { data: jsonSafe(p.data) }, meta?.sandbox), null);
    return H;
  }

  /** `openfini.network.fetch`: granted origins only, https (or localhost), no cookies, no redirects, capped size. */
  async #fetch(ext, p) {
    const url = v.str(p.url, "url", { max: 2000 });
    const origin = originOf(url);
    if (!origin) throw new RpcError("BAD_REQUEST", "Only http(s) URLs can be fetched.");
    if (!networkAllowed(this.app, url)) throw new RpcError("OFFLINE", "Network access is blocked: offline mode is on (Settings ▸ Security and privacy).");
    const init = v.obj(p.init, "init");
    const method = v.oneOf((init.method || "GET").toUpperCase(), "method", ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
    const headers = {};
    for (const [k, val] of Object.entries(v.obj(init.headers, "headers"))) {
      if (/^(cookie|host|origin|referer|user-agent|proxy-|sec-)/i.test(k)) continue;
      headers[k.slice(0, 100)] = v.str(String(val), "header", { max: 2000 });
    }
    const body = init.body === undefined || init.body === null ? undefined : v.str(init.body, "body", { max: 1024 * 1024 });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30_000);
    try {
      const res = await fetch(url, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : body, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store", signal: ctl.signal });
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > 5 * 1024 * 1024) throw new RpcError("TOO_LARGE", "The response is larger than 5 MB.");
      const out = { ok: res.ok, status: res.status, headers: Object.fromEntries([...res.headers].slice(0, 40)) };
      if (init.responseType === "bytes") out.data = buf;
      else out.text = dec.decode(buf);
      this.#log(ext, "info", `fetch ${method} ${origin} → ${res.status}`);
      return out;
    } catch (err) {
      if (err instanceof RpcError) throw err;
      throw new RpcError("NETWORK", err.name === "AbortError" ? "The request timed out." : `Request failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------ panels

  #panel(ext, p) {
    const el = document.createElement("div");
    el.className = "of-extpanel";
    const doc = buildPanelDocument({ config: this.#config(ext, { panelId: p.id }), runtimeSrc: RUNTIME_SRC, html: dec.decode(ext.rec.files[p.html]), htmlPath: p.html, files: ext.rec.files });
    const sb = this.#sandbox(ext, doc, `${ext.name}: ${p.title}`, false);
    sb.frame.className = "of-extpanel__frame";
    el.append(sb.frame);
    ext.panels.add(sb);
    return { el };
  }

  // ------------------------------------------------------------------ Vibe

  async vibeToolDefs() {
    const out = [];
    for (const ext of this.exts.values()) {
      if (!this.#enabled(ext) || !hasPermission(ext.dispatcher.granted, "vibe")) continue;
      const tools = [...ext.manifest.contributes.vibeTools, ...ext.dynTools.values()];
      for (const t of tools) {
        out.push({
          name: vibeToolName(ext.id, t.name),
          description: `${t.description} (extension tool from “${ext.name}”)`,
          inputSchema: t.inputSchema,
          origin: { type: "extension", id: ext.id, name: ext.name },
          needsApproval: () => `Run the tool “${t.name}” from the extension “${ext.name}”?`,
          run: async (input) => {
            await this.activate(ext.id);
            const { validateSchema } = await import("../ai/agent.js");
            const errors = validateSchema(input ?? {}, t.inputSchema);
            if (errors.length) throw new Error(`Invalid arguments: ${errors.slice(0, 3).join("; ")}`);
            const res = await this.#undoScope(ext, `${ext.name}: ${t.name}`, () => ext.frame.invoke("tool.run", { name: t.name, args: jsonSafe(input ?? {}) }, 120_000));
            const text = JSON.stringify(res ?? null);
            if (text.length > 200_000) throw new Error("The tool returned more than 200 KB.");
            return res;
          },
        });
      }
    }
    return out;
  }

  vibeToolInfos() {
    const out = [];
    for (const ext of this.exts.values()) {
      if (!this.#enabled(ext)) continue;
      for (const t of [...ext.manifest.contributes.vibeTools, ...ext.dynTools.values()]) out.push({ name: vibeToolName(ext.id, t.name), description: t.description, ext: ext.id, extName: ext.name, active: ext.state === "active" });
    }
    return out;
  }

  async vibeSkills() {
    const { parseSkill } = await import("../ai/skills.js");
    const out = [];
    for (const ext of this.exts.values()) {
      if (!this.#enabled(ext) || !hasPermission(ext.dispatcher.granted, "vibe")) continue;
      for (const s of ext.manifest.contributes.vibeSkills) {
        const text = s.file ? dec.decode(ext.rec.files[s.file]) : `---\nname: ${JSON.stringify(s.name)}\ndescription: ${JSON.stringify(s.description)}\n---\n\n${s.body}`;
        out.push({ ...parseSkill(text), origin: { type: "extension", id: ext.id, name: ext.name } });
      }
      for (const s of ext.dynSkills) out.push({ ...parseSkill(`---\nname: ${JSON.stringify(s.name)}\ndescription: ${JSON.stringify(s.description)}\n---\n\n${s.body}`), origin: { type: "extension", id: ext.id, name: ext.name } });
    }
    return out;
  }

  // ------------------------------------------------------------------ templates and file handlers

  async newFromTemplate(id, tid) {
    const ext = this.exts.get(id);
    const t = ext?.manifest.contributes.templates.find((x) => x.id === tid);
    if (!t) throw new Error("Unknown template.");
    if (t.kind === "website") {
      const files = {};
      for (const [path, src] of Object.entries(t.files)) files[path] = dec.decode(ext.rec.files[src]);
      await this.runTool("create_website", { name: t.label, files });
      return;
    }
    await this.runTool("new_document", { name: t.label, width: t.width, height: t.height, studio: t.studio });
    for (const [i, s] of t.steps.entries()) {
      try {
        await this.runTool(s.tool, s.args);
      } catch (err) {
        throw new Error(`Template step ${i + 1} (${s.tool}) failed: ${err.message}`);
      }
    }
  }

  #importerFor(name) {
    const e = String(name).split(".").pop().toLowerCase();
    for (const ext of this.exts.values()) {
      if (!this.#enabled(ext)) continue;
      const imp = ext.manifest.contributes.importers.find((i) => i.extensions.includes(e));
      if (imp) return { ext, imp };
    }
    return null;
  }
  hasImporter(name) {
    return !!this.#importerFor(name);
  }

  /** Hands a file to the extension that registered an importer for its type. Returns true when handled. */
  async importFile(file) {
    const hit = this.#importerFor(file.name);
    if (!hit) return false;
    this.#fire(`onFileType:${file.name.split(".").pop().toLowerCase()}`);
    await this.activate(hit.ext.id);
    await this.#undoScope(hit.ext, `${hit.ext.name}: Import ${file.name}`, () => hit.ext.frame.invoke("command.run", { id: hit.imp.command, args: { name: file.name, mime: file.mime || "", size: file.bytes.length, data: file.bytes } }, 5 * 60_000));
    return true;
  }

  async pickAndImport(id, imp) {
    const files = await platform.openFiles({ accept: [{ description: imp.title, extensions: imp.extensions }], multiple: false });
    for (const f of files) await this.importFile(f);
  }

  // ------------------------------------------------------------------ install, update, remove

  /** Validates package files. Returns {manifest, warnings, existing} or throws one readable Error. */
  inspect(files) {
    const mf = files["openfini-extension.json"];
    if (!mf) throw new Error("The package has no openfini-extension.json at its top level.");
    let raw;
    try {
      raw = JSON.parse(dec.decode(mf).replace(/^﻿/, ""));
    } catch (err) {
      throw new Error(`openfini-extension.json is not valid JSON: ${err.message}`);
    }
    const res = validateManifest(raw, { hostVersion: this.hostVersion });
    const missing = res.ok ? checkPackageFiles(res.manifest, Object.keys(files)) : [];
    const errors = [...res.errors.map((e) => e.message), ...missing];
    if (errors.length) throw new Error(`This extension cannot be installed:\n${errors.slice(0, 8).map((e) => `• ${e}`).join("\n")}`);
    return { manifest: res.manifest, raw, warnings: res.warnings.map((w) => w.message), existing: this.exts.get(res.manifest.id) || null };
  }

  /**
   * Installs or updates an extension after the user consented.
   * @param {{files: Record<string, Uint8Array>, source: object, dirHandle?: any}} pkg
   * @param {(info: {manifest: object, existing: object|null, warnings: string[], source: object, newPermissions: string[]}) => Promise<boolean>} ask
   */
  async install(pkg, ask) {
    const { manifest, raw, warnings, existing } = this.inspect(pkg.files);
    const prev = existing?.rec.granted || [];
    const newPermissions = manifest.permissions.filter((p) => !prev.includes(p));
    const silent = existing && !newPermissions.length && pkg.source?.type === "unpacked";
    if (!silent) {
      if (typeof ask !== "function") throw new Error("Installing an extension needs the user's consent.");
      if (!(await ask({ manifest, existing, warnings, source: pkg.source, newPermissions }))) return null;
    }
    const rec = {
      id: manifest.id,
      raw, // the manifest as written; it is validated again every time the extension loads
      files: pkg.files,
      enabled: existing ? existing.rec.enabled !== false : true,
      granted: manifest.permissions.slice(),
      settings: existing?.rec.settings || {},
      source: pkg.source || { type: "file" },
      installedAt: existing?.rec.installedAt || Date.now(),
      updatedAt: Date.now(),
    };
    if (existing) {
      this.#unregister(existing);
      this.exts.delete(manifest.id);
    }
    const ext = this.#add(rec);
    ext.dirHandle = pkg.dirHandle || existing?.dirHandle || null;
    await this.#persist(ext);
    this.#log(ext, "info", `${existing ? `Updated to ${manifest.version}` : `Installed ${manifest.version}`} (${rec.source.type})`);
    this.emit("change");
    if (ext.state === "inactive") {
      this.#fire("onStartup");
      this.#fire(`onStudio:${this.app.studio}`);
    }
    return { id: manifest.id, updated: !!existing };
  }

  async uninstall(id) {
    const ext = this.exts.get(id);
    if (!ext) return;
    this.#unregister(ext);
    this.exts.delete(id);
    clearInterval(ext.watch);
    await kvDelete(`ext:rec:${id}`);
    await kvDelete(`ext:data:${id}`);
    await kvSet(INDEX_KEY, [...this.exts.keys()]);
    coreLog.log("info", "extensions", `Uninstalled ${id}`);
    this.emit("change");
  }

  async setEnabled(id, on) {
    const ext = this.exts.get(id);
    if (!ext) return;
    ext.rec.enabled = !!on;
    if (!ext.valid) return;
    if (on) {
      ext.state = "inactive";
      ext.error = null;
      ext.crashes = 0;
      this.#register(ext);
      this.#fire("onStartup");
      this.#fire(`onStudio:${this.app.studio}`);
    } else {
      this.#unregister(ext);
      ext.state = "disabled";
    }
    await this.#persist(ext);
    this.#log(ext, "info", on ? "Enabled" : "Disabled");
    this.emit("change");
  }

  async setGranted(id, perms) {
    const ext = this.exts.get(id);
    if (!ext?.valid) return;
    ext.rec.granted = perms.filter((p) => ext.manifest.permissions.includes(p));
    ext.dispatcher.setGranted(ext.rec.granted);
    await this.#persist(ext);
    this.emit("change");
    this.app.emit("extensions:vibe");
  }

  /** Restarts an extension (re-reads the folder for unpacked extensions). */
  async reload(id) {
    const ext = this.exts.get(id);
    if (!ext) return;
    if (ext.dirHandle) {
      const files = await readDirHandle(ext.dirHandle);
      await this.install({ files, source: { type: "unpacked", name: ext.dirHandle.name }, dirHandle: ext.dirHandle }, null);
      return;
    }
    const wasActive = ext.state === "active";
    this.#unregister(ext);
    ext.state = ext.valid ? (ext.rec.enabled === false ? "disabled" : "inactive") : "invalid";
    ext.error = ext.valid ? null : ext.error;
    if (ext.valid && ext.rec.enabled !== false) this.#register(ext);
    if (wasActive || ext.manifest?.activationEvents.includes("onStartup")) this.activate(id).catch(() => {});
    this.emit("change");
  }

  /** Developer mode: poll an unpacked folder (File System Access API) and hot-reload on change. */
  watch(id, on) {
    const ext = this.exts.get(id);
    if (!ext?.dirHandle) return false;
    clearInterval(ext.watch);
    ext.watching = !!on;
    if (on) {
      let sig = null;
      ext.watch = setInterval(async () => {
        try {
          const s = await dirSignature(ext.dirHandle);
          if (sig && s !== sig) await this.reload(id).catch((err) => this.#log(ext, "error", `Hot reload failed: ${err.message}`));
          sig = s;
        } catch (err) {
          this.#log(ext, "warn", `Watching stopped: ${err.message}`);
          clearInterval(ext.watch);
          ext.watching = false;
          this.emit("change");
        }
      }, 1500);
    }
    this.emit("change");
    return true;
  }

  /** Downloads a package (https only, or http://localhost while developing) and unpacks it. */
  async fetchPackage(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new Error("That is not a valid URL.");
    }
    const loop = u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
    if (u.protocol !== "https:" && !loop) throw new Error("Extensions can only be downloaded over https.");
    if (!networkAllowed(this.app, u.href)) throw new Error("Network access is blocked: offline mode is on (Settings ▸ Security and privacy).");
    const res = await fetch(u.href, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    if (!res.ok) throw new Error(`The download failed (HTTP ${res.status}).`);
    const len = +res.headers.get("content-length") || 0;
    if (len > 24 * 1024 * 1024) throw new Error("The package is larger than 24 MB.");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 24 * 1024 * 1024) throw new Error("The package is larger than 24 MB.");
    const { unpackExtension } = await import("./zip.js");
    return { files: unpackExtension(bytes), source: { type: "url", url: u.href } };
  }
}

// ------------------------------------------------------------------ folders (developer mode)

async function* walkDir(handle, prefix = "") {
  for await (const [name, h] of handle.entries()) {
    if (/^(\.git|node_modules|\.DS_Store)$/.test(name)) continue;
    if (h.kind === "directory") yield* walkDir(h, `${prefix}${name}/`);
    else yield [`${prefix}${name}`, h];
  }
}

export async function readDirHandle(handle) {
  const files = {};
  let n = 0;
  let total = 0;
  for await (const [path, fh] of walkDir(handle)) {
    if (++n > 500) throw new Error("The folder has more than 500 files.");
    const f = await fh.getFile();
    total += f.size;
    if (total > 24 * 1024 * 1024) throw new Error("The folder is larger than 24 MB.");
    files[path] = new Uint8Array(await f.arrayBuffer());
  }
  return files;
}

async function dirSignature(handle) {
  const parts = [];
  for await (const [path, fh] of walkDir(handle)) {
    const f = await fh.getFile();
    parts.push(`${path}:${f.size}:${f.lastModified}`);
  }
  return parts.sort().join("|");
}

