// Engine registry: pluggable speech, search, knowledge-base and OCR engines (docs/engines.md). Pure (no DOM).
//
// Built-in engines, extensions (openfini.engines.register, permission "vibe") and MCP adapters (mcpEngine) register
// here, so a new recognizer, search backend, document loader or OCR engine needs no core edit. Consumers ask the
// registry instead of switching over hard-coded names.
//
//   ENGINE_KINDS                         kind -> { label, methods: one of these must be a function }
//   validateEngine(kind, engine)         -> string[] (empty when valid)
//   const r = new EngineRegistry()
//   r.register(kind, engine)             -> dispose()   (throws on an invalid engine or a taken id)
//   r.list(kind) / r.get(kind, id)       registered engines (frozen descriptors, built-ins first)
//   r.pick(kind, { id, local, path, mime }) -> the requested engine, else the first match, or null
//   r.onChange(fn)                       -> off()
//   engines                              the app-wide registry
//   mcpEngine(kind, { server, tool, callTool, map, ... }) -> an engine descriptor backed by one MCP tool
//
// Descriptor (every kind): { id, label, local, source?, origin?, ...methods }
//   id      /^[a-z0-9][a-z0-9._:-]{1,63}$/, unique per kind
//   local   true only when data never leaves the device; every UI that offers the engine shows it
//   source  "builtin" | "extension" | "mcp"   origin { name } for display
// Kinds and their methods:
//   stt         listen({ lang, continuous, onText(text, final), onEnd(), onError(err) }) -> { stop() }   (streaming)
//               or transcribe(pcm: Float32Array 16 kHz mono, { lang, sampleRate, signal, model }) -> { text } (batch)
//   tts         speak(text, { lang, rate, pitch, signal }) -> Promise<void>, stop()
//   search      search(query, { limit, signal }) -> [{ title, url, snippet }]; endpoint: shown in the approval card
//   rag-loader  extensions: [".pdf"], mimes?: [...]; load(bytes, { path, signal, ocr }) -> { text, pages?, skipped? }
//   ocr         recognize(image: { width, height, data: Uint8ClampedArray RGBA }, { lang, signal }) -> { text }

export const ENGINE_KINDS = Object.freeze({
  stt: { label: "Speech input", methods: ["listen", "transcribe"] },
  tts: { label: "Spoken replies", methods: ["speak"] },
  search: { label: "Web search", methods: ["search"] },
  "rag-loader": { label: "Knowledge base loader", methods: ["load"] },
  ocr: { label: "Text recognition (OCR)", methods: ["recognize"] },
});

const ID_RE = /^[a-z0-9][a-z0-9._:-]{1,63}$/;
const EXT_RE = /^\.[a-z0-9]{1,10}$/i; // stored lower-case
const SOURCES = ["builtin", "extension", "mcp"];

/** Errors of an engine descriptor for `kind` (empty array = valid). */
export function validateEngine(kind, e) {
  const k = ENGINE_KINDS[kind];
  if (!k) return [`Unknown engine kind “${kind}”. Kinds: ${Object.keys(ENGINE_KINDS).join(", ")}.`];
  if (!e || typeof e !== "object") return ["The engine must be an object."];
  const err = [];
  if (typeof e.id !== "string" || !ID_RE.test(e.id)) err.push("id must be 2 to 64 characters: lower-case letters, digits, “.”, “_”, “:” or “-”.");
  if (typeof e.label !== "string" || !e.label.trim() || e.label.length > 80) err.push("label must be 1 to 80 characters.");
  if (typeof e.local !== "boolean") err.push("local must be true (data stays on this device) or false.");
  if (e.source !== undefined && !SOURCES.includes(e.source)) err.push(`source must be one of ${SOURCES.join(", ")}.`);
  if (!k.methods.some((m) => typeof e[m] === "function")) err.push(`a ${kind} engine needs ${k.methods.length > 1 ? `one of ${k.methods.join(" or ")}` : k.methods[0]}() as a function.`);
  if (kind === "tts" && e.stop !== undefined && typeof e.stop !== "function") err.push("stop must be a function.");
  if (kind === "search" && e.endpoint !== undefined && (typeof e.endpoint !== "string" || e.endpoint.length > 200)) err.push("endpoint must be a short text (the host shown in the approval card).");
  if (kind === "rag-loader") {
    if (!Array.isArray(e.extensions) || !e.extensions.length || e.extensions.length > 20 || !e.extensions.every((x) => typeof x === "string" && EXT_RE.test(x))) err.push("extensions must list 1 to 20 file extensions such as “.pdf”.");
    if (e.mimes !== undefined && (!Array.isArray(e.mimes) || !e.mimes.every((x) => typeof x === "string" && x.length < 100))) err.push("mimes must be a list of media types.");
  }
  return err;
}

const extOf = (path) => {
  const m = /(\.[a-z0-9]{1,10})$/i.exec(String(path || ""));
  return m ? m[1].toLowerCase() : "";
};

export class EngineRegistry {
  #by = new Map(Object.keys(ENGINE_KINDS).map((k) => [k, []]));
  #listeners = new Set();

  /** Registers an engine; returns a function that removes it again. */
  register(kind, engine) {
    const errors = validateEngine(kind, engine);
    if (errors.length) throw new Error(`Invalid ${kind} engine${engine?.id ? ` “${engine.id}”` : ""}: ${errors.join(" ")}`);
    const list = this.#by.get(kind);
    if (list.some((x) => x.id === engine.id)) throw new Error(`A ${kind} engine with the id “${engine.id}” is already registered.`);
    const e = Object.freeze({ source: "builtin", ...engine, ...(engine.extensions ? { extensions: engine.extensions.map((x) => x.toLowerCase()) } : {}) });
    // built-ins stay first so a default never changes because an extension loaded
    if (e.source === "builtin") list.splice(list.filter((x) => x.source === "builtin").length, 0, e);
    else list.push(e);
    this.#emit(kind);
    return () => {
      const i = list.indexOf(e);
      if (i >= 0) {
        list.splice(i, 1);
        this.#emit(kind);
      }
    };
  }

  list(kind) {
    return [...(this.#by.get(kind) || [])];
  }

  get(kind, id) {
    return (this.#by.get(kind) || []).find((x) => x.id === id) || null;
  }

  /**
   * The engine with `id` when registered (and matching), else the first that matches.
   * local: true = only engines that keep data on the device. path / mime: rag-loader matching.
   */
  pick(kind, { id, local, path, mime } = {}) {
    const byType = (e) => (path && e.extensions?.includes(extOf(path))) || (mime && e.mimes?.includes(mime));
    const ok = (e) => (local === undefined || e.local === local) && (!path && !mime ? true : !!byType(e));
    const list = this.#by.get(kind) || [];
    return (id && list.find((e) => e.id === id && ok(e))) || list.find(ok) || null;
  }

  /** Extensions that some rag-loader can read, e.g. [".pdf"]. */
  loaderExtensions() {
    return [...new Set(this.list("rag-loader").flatMap((e) => e.extensions))];
  }

  onChange(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(kind) {
    for (const fn of [...this.#listeners]) {
      try {
        fn(kind);
      } catch {
        /* a listener never breaks registration */
      }
    }
  }
}

/** The app-wide registry (built-ins register on first use of their module; see docs/engines.md). */
export const engines = new EngineRegistry();

/** Methods an extension may implement per kind (streaming `listen` cannot cross the sandbox boundary). */
export const EXTENSION_METHODS = Object.freeze({ stt: "transcribe", tts: "speak", search: "search", "rag-loader": "load", ocr: "recognize" });

/**
 * The descriptor for an engine an extension registered (openfini.engines.register). `invoke(id, args)` calls into the
 * extension's sandbox; AbortSignals and functions are dropped from the options because they cannot be cloned.
 */
export function extensionEngine(kind, decl, invoke, origin) {
  const method = EXTENSION_METHODS[kind];
  if (!method) throw new Error(`Extensions cannot register ${kind} engines. Kinds: ${Object.keys(EXTENSION_METHODS).join(", ")}.`);
  const plain = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, x]) => typeof x !== "function" && !(typeof AbortSignal !== "undefined" && x instanceof AbortSignal)));
  const e = {
    id: `ext:${origin.id}:${decl.id}`.slice(0, 64).toLowerCase(),
    label: String(decl.label || decl.id).slice(0, 80),
    local: decl.local === true,
    source: "extension",
    origin: { id: origin.id, name: origin.name },
    [method]: (first, opts) => invoke(decl.id, [first, plain(opts)]),
  };
  if (kind === "tts") e.stop = () => invoke(decl.id, null, "stop");
  if (kind === "rag-loader") Object.assign(e, { extensions: decl.extensions, ...(decl.mimes ? { mimes: decl.mimes } : {}) });
  if (kind === "search") e.endpoint = String(decl.endpoint || `extension “${origin.name}”`).slice(0, 200);
  const errors = validateEngine(kind, e);
  if (errors.length) throw new Error(errors.join(" "));
  return e;
}

/**
 * An engine backed by one MCP tool (for example a search server's `search` tool). `callTool(name, args)` is the MCP
 * client's call; `map` turns the engine call into tool arguments and `parse` the tool result into the engine's result.
 * MCP servers are remote unless the user runs them locally, so `local` defaults to false.
 */
export function mcpEngine(kind, { server, tool, callTool, map, parse, id, label, local = false, extensions, endpoint }) {
  if (typeof callTool !== "function") throw new Error("mcpEngine needs callTool(name, args).");
  const method = { stt: "transcribe", tts: "speak", search: "search", "rag-loader": "load", ocr: "recognize" }[kind];
  if (!method) throw new Error(`Unknown engine kind “${kind}”.`);
  const run = async (...args) => {
    const res = await callTool(tool, map ? map(...args) : args[0]);
    return parse ? parse(res) : res;
  };
  return { id: id || `mcp:${String(server).toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${String(tool).toLowerCase().replace(/[^a-z0-9_]+/g, "-")}`.slice(0, 64), label: label || `${server}: ${tool}`.slice(0, 80), local, source: "mcp", origin: { name: String(server) }, [method]: run, ...(extensions ? { extensions } : {}), ...(endpoint ? { endpoint } : kind === "search" ? { endpoint: `MCP server “${server}”` } : {}) };
}
