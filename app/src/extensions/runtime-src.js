// The code that runs INSIDE every extension frame (background frame and panels): it exposes the versioned
// `openfini` API object and speaks the RPC protocol with the host (see rpc.js). It is written as a normal
// function so it is syntax-checked and minified with the app; the host serializes it with toString().
// It never runs in the app's own context. `__OFX_CFG` is defined by the script that precedes it.
// It runs in two places: a dedicated Worker started by the extension's relay frame (background scripts, see html.js;
// the host can then stop a runaway loop) or directly in a frame (panels, and background scripts when the frame cannot
// start a worker). In a worker there is no document and the relay frame forwards every message.
/* eslint-disable no-undef */
function runtime() {
  const CFG = __OFX_CFG;
  const G = globalThis;
  const inWorker = typeof document === "undefined";
  const CALL_TIMEOUT = 11 * 60_000; // longer than every host-side limit; only frees promises the host never answers
  const pending = new Map();
  const commands = new Map();
  const tools = new Map();
  const events = new Map();
  const listeners = { message: new Set(), settings: new Set() };
  let seq = 0;
  let settings = CFG.settings || {};
  const send = inWorker ? (m) => G.postMessage({ ofx: 1, ...m }) : (m) => parent.postMessage({ ofx: 1, ...m }, "*");
  const call = (m, p) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Object.assign(new Error(`${m} got no answer`), { code: "TIMEOUT" }));
      }, CALL_TIMEOUT);
      pending.set(id, { resolve, reject, timer });
      send({ t: "req", id, m, p: p || {} });
    });
  const fmt = (a) => a.map((x) => (typeof x === "string" ? x : x instanceof Error ? x.stack || x.message : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(" ");
  const log = (level, ...a) => send({ t: "log", level, text: fmt(a).slice(0, 4000) });
  for (const k of ["log", "info", "warn", "error", "debug"]) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      orig(...a);
      log(k === "log" || k === "debug" ? "info" : k, ...a);
    };
  }
  addEventListener("error", (e) => log("error", e.message || "Script error", e.filename ? `(${e.lineno}:${e.colno})` : ""));
  addEventListener("unhandledrejection", (e) => log("error", "Unhandled rejection:", e.reason));

  const applyTheme = (vars) => {
    if (inWorker) return;
    for (const [k, v] of Object.entries(vars || {})) document.documentElement.style.setProperty(k, v);
  };
  applyTheme(CFG.theme);

  async function invoke(m, p) {
    switch (m) {
      case "command.run": {
        const fn = commands.get(p.id);
        if (typeof fn !== "function") throw new Error(`Command “${p.id}” has no handler. Call openfini.commands.register("${p.id}", fn) while activating.`);
        return (await fn(p.args)) ?? null;
      }
      case "tool.run": {
        const fn = tools.get(p.name);
        if (typeof fn !== "function") throw new Error(`Vibe tool “${p.name}” has no handler.`);
        return (await fn(p.args)) ?? null;
      }
      case "event":
        for (const fn of events.get(p.name) || []) try { fn(p.payload); } catch (e) { log("error", e); }
        return null;
      case "settings":
        settings = p.values;
        for (const fn of listeners.settings) try { fn(settings); } catch (e) { log("error", e); }
        return null;
      case "theme":
        applyTheme(p.vars);
        return null;
      case "message":
        for (const fn of listeners.message) try { fn(p.data); } catch (e) { log("error", e); }
        return null;
      case "deactivate":
        if (typeof G.deactivate === "function") await G.deactivate();
        return null;
      case "ping":
        return "pong";
      default:
        throw new Error(`Unknown host call ${m}`);
    }
  }

  addEventListener("message", async (e) => {
    const d = e.data;
    if ((!inWorker && e.source !== parent) || !d || d.ofx !== 1) return;
    if (d.t === "res") {
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      clearTimeout(p.timer);
      if (d.ok) p.resolve(d.r);
      else p.reject(Object.assign(new Error(d.e?.message || "Call failed"), { code: d.e?.code }));
    } else if (d.t === "inv") {
      try {
        send({ t: "ires", id: d.id, ok: true, r: await invoke(d.m, d.p || {}) });
      } catch (err) {
        send({ t: "ires", id: d.id, ok: false, e: { code: "EXT_ERROR", message: String((err && err.message) || err).slice(0, 600) } });
      }
    }
  });

  const need = (v, name) => {
    if (typeof v !== "function") throw new TypeError(`${name} must be a function`);
  };
  const api = {
    apiVersion: 1,
    extension: Object.freeze({ id: CFG.id, version: CFG.version, panel: CFG.panelId || null }),
    commands: {
      register(id, fn) {
        need(fn, "handler");
        commands.set(id, fn);
        return call("commands.register", { id });
      },
      execute: (id, args) => call("commands.execute", { id, args }),
    },
    ui: {
      showMessage: (text, kind = "info") => call("ui.showMessage", { text: String(text), kind }),
      confirm: (text, opts = {}) => call("ui.confirm", { text: String(text), ...opts }),
      prompt: (label, opts = {}) => call("ui.prompt", { label: String(label), ...opts }),
      form: (spec) => call("ui.form", spec),
      openPanel: (id) => call("ui.openPanel", { id }),
      setStatus: (text) => call("ui.setStatus", { text: String(text) }),
    },
    document: {
      info: () => call("document.info"),
      pageInfo: () => call("document.pageInfo"),
      readSelection: () => call("document.readSelection"),
      readLayers: (opts) => call("document.readLayers", opts || {}),
      listTools: () => call("document.listTools"),
      callTool: (name, args) => call("document.callTool", { name, args: args || {} }),
      export: (opts) => call("document.export", opts || {}),
    },
    studio: { current: () => call("studio.current"), list: () => call("studio.list"), set: (id) => call("studio.set", { id }) },
    storage: {
      get: (key, fallback) => call("storage.get", { key }).then((v) => (v === null || v === undefined ? fallback : v)),
      set: (key, value) => call("storage.set", { key, value }),
      delete: (key) => call("storage.delete", { key }),
      keys: () => call("storage.keys"),
      clear: () => call("storage.clear"),
    },
    settings: {
      get: (key) => settings[key],
      getAll: () => ({ ...settings }),
      onChange(fn) {
        need(fn, "listener");
        listeners.settings.add(fn);
        return () => listeners.settings.delete(fn);
      },
    },
    network: { fetch: (url, init) => call("network.fetch", { url: String(url), init: init || {} }) },
    files: {
      open: (opts) => call("files.open", opts || {}),
      save: (opts) => call("files.save", opts),
    },
    events: {
      on(name, fn) {
        need(fn, "listener");
        if (!events.has(name)) {
          events.set(name, new Set());
          call("events.subscribe", { event: name }).catch((e) => { events.delete(name); log("error", e.message); });
        }
        events.get(name).add(fn);
        return () => events.get(name)?.delete(fn);
      },
    },
    vibe: {
      registerTool(def, handler) {
        const spec = typeof def === "string" ? { name: def } : def;
        const fn = handler || spec.handler;
        need(fn, "handler");
        tools.set(spec.name, fn);
        const { handler: _h, ...plain } = spec;
        return call("vibe.registerTool", plain);
      },
      registerSkill: (def) => call("vibe.registerSkill", def),
    },
    messages: {
      post: (data) => call("messages.post", { data }),
      onMessage(fn) {
        need(fn, "listener");
        listeners.message.add(fn);
        return () => listeners.message.delete(fn);
      },
    },
    log: (...a) => log("info", ...a),
  };
  const freeze = (o) => {
    for (const v of Object.values(o)) if (v && typeof v === "object") freeze(v);
    return Object.freeze(o);
  };
  Object.defineProperty(G, "openfini", { value: freeze(api), writable: false, configurable: false });

  G.__ofxBoot = async () => {
    try {
      if (G.__ofxLoadError) throw G.__ofxLoadError;
      if (!CFG.panel && typeof G.activate === "function") await G.activate(G.openfini);
      send({ t: "ready", mode: inWorker ? "worker" : "frame" });
    } catch (err) {
      send({ t: "ready", error: String((err && err.message) || err).slice(0, 600) });
    }
  };
}

export const RUNTIME_SRC = `(${runtime.toString()})()`;
