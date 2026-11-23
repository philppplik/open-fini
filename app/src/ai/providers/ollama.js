// Ollama provider on Ollama's native API (https://github.com/ollama/ollama/blob/main/docs/api.md):
//   GET /api/version, GET /api/tags (installed models), GET /api/ps (loaded models), POST /api/show (capabilities,
//   context length), POST /api/chat (NDJSON stream with tools, images and thinking), POST /api/pull, POST /api/embed.
// Why not the /v1 compatibility layer: it has no model capabilities, no `num_ctx`, no `keep_alive`, no pull and
// it silently cuts prompts to a 4096 token window.
// Local models and Ollama cloud models served by the local daemon ("gpt-oss:120b-cloud", ":cloud" suffix, after
// `ollama signin`) share one list; a direct connection to https://ollama.com uses the same API with an API key.
// Pure: `fetch` is injected (desktop: ollama-transport.js → native command; browser: the page's fetch).

import { ProviderError, abortError, doFetch, isAbortError, joinUrl, makeId, readTextChunks, textOf, toBlocks } from "../util.js";
import { createOllamaFetch } from "../ollama-transport.js";

export { ProviderError };

export const OLLAMA_DEFAULT_BASES = ["http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434"];
export const OLLAMA_CLOUD_BASE = "https://ollama.com";
const MAX_CTX = 32768;
const DEFAULT_CTX = 8192;

/** Native root of an Ollama server: drops a trailing /v1 or /api and slashes ("http://localhost:11434/v1" → "http://localhost:11434"). */
export function normalizeBase(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(v1|api)$/i, "")
    .replace(/\/+$/, "");
}

/** Models run by Ollama's cloud (suffix ":cloud" or "-cloud"). */
export const isCloudModel = (name) => /(:|-)cloud$/i.test(String(name || ""));

/** "0.12.3" → [0,12,3]; null when it is not a version. */
export function parseVersion(v) {
  const m = String(v || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
export function versionAtLeast(v, min) {
  const a = parseVersion(v);
  const b = parseVersion(min);
  if (!a || !b) return true;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
/** Tool calling arrived in Ollama 0.3.0. */
export const MIN_VERSION = "0.3.0";

/**
 * Reads /api/show into what Vibe needs. `capabilities` (Ollama 0.6.4+) is authoritative; older servers are guessed
 * from `model_info` and `details.families` (tools stay "unknown" = allowed there).
 */
export function parseShow(json) {
  const j = json && typeof json === "object" ? json : {};
  const info = j.model_info || {};
  const d = j.details || {};
  const out = {};
  if (Array.isArray(j.capabilities)) {
    const c = j.capabilities;
    out.tools = c.includes("tools");
    out.vision = c.includes("vision");
    out.thinking = c.includes("thinking");
    out.embedding = c.includes("embedding") && !c.includes("completion");
  } else {
    const families = [d.family, ...(Array.isArray(d.families) ? d.families : [])].map((x) => String(x || "").toLowerCase());
    out.vision = families.some((x) => /clip|mllama|vision|siglip/.test(x)) || Object.keys(info).some((k) => /\.vision\./.test(k));
    out.thinking = /\.Think|thinking|<think>/i.test(String(j.template || ""));
    out.embedding = /bert|embed/.test(families.join(" ")) && !/llama|qwen|gemma|mistral/.test(families.join(" "));
  }
  const ctxKey = Object.keys(info).find((k) => /\.context_length$/.test(k));
  const ctx = ctxKey ? Number(info[ctxKey]) : NaN;
  if (Number.isFinite(ctx) && ctx > 0) out.contextWindow = ctx;
  if (d.family) out.family = d.family;
  if (d.parameter_size) out.parameterSize = d.parameter_size;
  if (d.quantization_level) out.quantization = d.quantization_level;
  return out;
}

/**
 * One list for the model menu: installed models (/api/tags) with their capabilities (/api/show) and whether they are
 * loaded in memory right now (/api/ps). Cloud models are marked `cloud` and sorted after the local ones.
 * @param {{models?:object[]}} tags @param {{models?:object[]}} [ps] @param {Record<string,object>} [shows] by model name
 * @param {{allCloud?:boolean}} [o]
 */
export function mergeModels(tags, ps, shows = {}, { allCloud = false } = {}) {
  const loaded = new Map((ps?.models || []).map((m) => [m.name || m.model, m]));
  const out = [];
  for (const m of tags?.models || []) {
    const id = m.name || m.model;
    if (!id) continue;
    const s = shows[id] || {};
    const d = m.details || {};
    const e = { id, size: m.size || 0, cloud: allCloud || isCloudModel(id), loaded: loaded.has(id) };
    const family = s.family || d.family;
    if (family) e.family = family;
    const params = s.parameterSize || d.parameter_size;
    if (params) e.parameterSize = params;
    const q = s.quantization || d.quantization_level;
    if (q) e.quantization = q;
    if (s.tools !== undefined) e.tools = s.tools;
    if (s.vision !== undefined) e.vision = s.vision;
    if (s.thinking !== undefined) e.thinking = s.thinking;
    if (s.embedding) e.embedding = true;
    if (s.contextWindow) e.contextWindow = s.contextWindow;
    const lm = loaded.get(id);
    if (lm?.context_length) e.loadedContext = lm.context_length;
    out.push(e);
  }
  return out.sort((a, b) => Number(a.cloud) - Number(b.cloud) || Number(b.loaded) - Number(a.loaded) || a.id.localeCompare(b.id));
}

/** One-line description of a model for menus: "7B · Q4_K_M · 4.7 GB · tools · vision · loaded". */
export function describeModel(m) {
  const gb = m.size ? (m.size >= 1e9 ? `${(m.size / 1e9).toFixed(1)} GB` : `${Math.round(m.size / 1e6)} MB`) : "";
  return [m.cloud ? "cloud" : "", m.parameterSize, m.quantization, gb, m.tools ? "tools" : "", m.vision ? "vision" : "", m.thinking ? "thinking" : "", m.contextWindow ? `${Math.round(m.contextWindow / 1024)}K ctx` : "", m.loaded ? "loaded" : ""].filter(Boolean).join(" · ");
}

/** Capability badges of a model for menus, in a fixed order: a subset of vision, tools, thinking, embedding. */
export function capabilityBadges(m) {
  return [m.vision ? "vision" : "", m.tools ? "tools" : "", m.thinking ? "thinking" : "", m.embedding ? "embedding" : ""].filter(Boolean);
}

/**
 * Groups merged models for the chat model menu: Local first, then Cloud (empty groups are dropped). Each entry keeps
 * the model and its capability badges. `query` filters by id (case-insensitive).
 * @returns {{id:"local"|"cloud", models:{id:string, model:object, badges:string[]}[]}[]}
 */
export function groupModelsForMenu(models, query = "") {
  const q = String(query || "").toLowerCase();
  const pick = (cloud) => (models || []).filter((m) => !!m.cloud === cloud && m.id.toLowerCase().includes(q)).map((m) => ({ id: m.id, model: m, badges: capabilityBadges(m) }));
  return [{ id: "local", models: pick(false) }, { id: "cloud", models: pick(true) }].filter((g) => g.models.length);
}

// ------------------------------------------------------------------------------------------ messages

/**
 * Neutral messages → Ollama /api/chat messages. Images go to the `images` array (base64 without a data URL prefix);
 * tool results become `tool` messages carrying the tool's name.
 */
export function toOllamaMessages(system, messages, { vision = true } = {}) {
  const out = [];
  if (system) out.push({ role: "system", content: system });
  const names = new Map();
  for (const m of messages || []) {
    const blocks = toBlocks(m.content);
    if (m.role === "assistant") {
      const msg = { role: "assistant", content: blocks.filter((b) => b.type === "text").map((b) => b.text).join("") };
      const thinking = blocks.filter((b) => b.type === "thinking").map((b) => b.text).join("");
      if (thinking) msg.thinking = thinking;
      const calls = blocks.filter((b) => b.type === "tool_use");
      for (const c of calls) names.set(c.id, c.name);
      if (calls.length) msg.tool_calls = calls.map((c) => ({ function: { name: c.name, arguments: c.input ?? {} } }));
      if (msg.content || msg.thinking || calls.length) out.push(msg);
      continue;
    }
    const late = [];
    for (const tr of blocks.filter((b) => b.type === "tool_result")) {
      const text = typeof tr.content === "string" ? tr.content : textOf(tr.content);
      const t = text || (tr.isError ? "Error" : "(no output)");
      out.push({ role: "tool", tool_name: names.get(tr.toolUseId) || "tool", content: tr.isError && !/^error\b/i.test(t) ? `Error: ${t}` : t });
      if (Array.isArray(tr.content)) for (const b of tr.content) if (b && b.type === "image") late.push(b);
    }
    const rest = blocks.filter((b) => b.type === "text" || b.type === "image");
    const images = [...late, ...rest.filter((b) => b.type === "image")].map((b) => b.data);
    const text = rest.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (!text && !images.length) continue;
    const msg = { role: "user", content: text };
    if (images.length) {
      if (vision) msg.images = images;
      else msg.content = `${text}${text ? "\n\n" : ""}(${images.length} image${images.length === 1 ? " was" : "s were"} attached, but this model cannot read images.)`;
    }
    out.push(msg);
  }
  return out;
}

/** Neutral ToolSpecs → Ollama `tools`. */
export const toOllamaTools = (tools) => (tools || []).map((t) => ({ type: "function", function: { name: t.name, description: t.description || "", parameters: t.inputSchema || { type: "object", properties: {} } } }));

/** Splits a (possibly chunked) NDJSON body into parsed objects. Lines may arrive in pieces. */
export async function* parseNdjson(source, signal) {
  let buf = "";
  for await (const text of readTextChunks(source, signal)) {
    buf += text;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line);
      } catch {
        /* a broken line is skipped */
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try {
      yield JSON.parse(tail);
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------------------------------ errors

/** Plain-language errors for what Ollama answers. `ctx` = { model, base, cloud }. */
export function mapOllamaError(e, ctx = {}) {
  if (!(e instanceof ProviderError)) return e;
  const msg = String(e.message || "");
  const model = ctx.model || "this model";
  const make = (message, code, extra = {}) => Object.assign(new ProviderError(message, { status: e.status, code, retryable: false, provider: e.provider || "ollama", ...extra }), extra.props || {});
  if (e.status === 404 || /model .*not found|try pulling it/i.test(msg)) {
    const err = make(`The model “${model}” is not installed in Ollama. Pull it from the Models tab, or run “ollama pull ${model}”.`, "model_not_found", { category: "model_unavailable", fallbackWorthy: true });
    err.pullable = !ctx.cloud;
    err.model = ctx.model;
    return err;
  }
  if (e.status === 401 || /unauthorized|not signed in|signin/i.test(msg)) {
    return make(isCloudModel(ctx.model) || ctx.cloud ? "Ollama cloud needs you to sign in. Run “ollama signin” in a terminal (local daemon), or add an API key from ollama.com/settings/keys for a direct connection." : `Ollama refused the request (HTTP 401): ${msg}`, "unauthorized", { category: "auth" });
  }
  if (e.status === 403) return make(`Ollama refused this app's origin (HTTP 403). The desktop app avoids this; in a browser, allow the origin with OLLAMA_ORIGINS (Models tab ▸ Ollama ▸ Test connection shows the exact command).`, "origin_blocked", { category: "auth" });
  if (/does not support (tools|thinking|image|vision)/i.test(msg)) return make(`“${model}” ${msg.replace(/^.*?does not support/i, "does not support")}. Pick a model with that capability or turn the feature off.`, "unsupported_capability", { category: "invalid_request", fallbackWorthy: true });
  if (/out of memory|requires more (system )?memory|unable to allocate/i.test(msg)) return make(`Ollama ran out of memory loading “${model}”: ${msg}. Pick a smaller model or a smaller quantization.`, "out_of_memory", { category: "model_unavailable", fallbackWorthy: true });
  return e;
}

/** Heuristic for browsers: a "Failed to fetch" on a server that is up means CORS/origin, mixed content or a private-network block. */
export async function probeReachable(base, f = (...a) => globalThis.fetch(...a)) {
  try {
    await f(joinUrl(base, "api/version"), { mode: "no-cors", method: "GET" });
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------------ diagnosis

/** Commands that set OLLAMA_ORIGINS for `origin` per operating system (Ollama FAQ ▸ "How do I configure Ollama server?"). */
export function originFixes(origin) {
  const o = origin || "https://your-site.example";
  return {
    windows: { title: "Windows", steps: ["Quit Ollama from the tray icon (right-click ▸ Quit).", `Open a terminal and run: setx OLLAMA_ORIGINS "${o}"`, "Start Ollama again from the Start menu."], command: `setx OLLAMA_ORIGINS "${o}"` },
    macos: { title: "macOS", steps: [`Run in Terminal: launchctl setenv OLLAMA_ORIGINS "${o}"`, "Quit and restart the Ollama app."], command: `launchctl setenv OLLAMA_ORIGINS "${o}"` },
    linux: { title: "Linux", steps: ["Run: sudo systemctl edit ollama.service", `Add under [Service]: Environment="OLLAMA_ORIGINS=${o}"`, "Run: sudo systemctl daemon-reload && sudo systemctl restart ollama"], command: `sudo systemctl edit ollama.service\n# add:\n[Service]\nEnvironment="OLLAMA_ORIGINS=${o}"\n# then:\nsudo systemctl daemon-reload && sudo systemctl restart ollama` },
  };
}

/** Which OS key of {@link originFixes} fits a user agent / platform string. */
export function detectOs(s = globalThis.navigator?.userAgent || "") {
  return /Win/i.test(s) ? "windows" : /Mac|iPhone|iPad/i.test(s) ? "macos" : "linux";
}

/**
 * Asks one base URL what is going on. Status: ok | down | origin-blocked | mixed-content | old | error.
 * @param {{base:string, fetch?:Function, apiKey?:string, page?:{origin?:string, protocol?:string}, desktop?:boolean, signal?:AbortSignal}} o
 */
export async function testOllama({ base, fetch: f = createOllamaFetch(), apiKey, page = globalThis.location || {}, desktop = false, signal } = {}) {
  const root = normalizeBase(base);
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const r = { base: root, status: "error", message: "" };
  if (!/^https?:\/\//i.test(root)) return { ...r, message: "Enter an address that starts with http:// or https://, for example http://127.0.0.1:11434." };
  const insecure = /^http:/i.test(root);
  const loopback = /^http:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:|\/|$)/i.test(root);
  if (!desktop && page.protocol === "https:" && insecure && !loopback) return { ...r, status: "mixed-content", message: "This page is served over https, so the browser blocks requests to a plain http server on another machine (mixed content). Use the desktop app, open this app over http, or put Ollama behind https (a reverse proxy or a tunnel)." };
  let res;
  try {
    res = await f(joinUrl(root, "api/version"), { method: "GET", headers, signal });
  } catch (e) {
    if (isAbortError(e)) throw e;
    if (!desktop && (await probeReachable(root, f))) {
      return { ...r, status: "origin-blocked", origin: page.origin || "", message: `Ollama is running but refused this page's origin${page.origin ? ` (${page.origin})` : ""}. Allow it with OLLAMA_ORIGINS${loopback && page.protocol === "https:" ? ", and note that Safari blocks https pages from reaching http://localhost at all: use the desktop app or another browser" : ""}.` };
    }
    return { ...r, status: "down", message: `Nothing answered at ${root}. Start Ollama (the app, or “ollama serve”), or correct the address and port.` };
  }
  if (res.status === 403) return { ...r, status: "origin-blocked", origin: page.origin || "", message: `Ollama refused this app's origin (HTTP 403)${page.origin ? `: ${page.origin}` : ""}. Allow it with OLLAMA_ORIGINS.` };
  if (res.status === 401) return { ...r, status: "error", message: "The server asked for credentials (HTTP 401). For ollama.com add an API key from ollama.com/settings/keys." };
  if (!res.ok) return { ...r, status: "error", message: `The server answered HTTP ${res.status}. This does not look like Ollama.` };
  let version = "";
  try {
    version = String((await res.json()).version || "");
  } catch {
    /* not Ollama */
  }
  if (!version) return { ...r, status: "error", message: "The server answered, but not like Ollama (no version). Check the port: Ollama uses 11434." };
  if (!versionAtLeast(version, MIN_VERSION)) return { ...r, status: "old", version, message: `Ollama ${version} is too old: tool use needs ${MIN_VERSION} or newer. Update Ollama.` };
  return { ...r, status: "ok", version, message: `Connected to Ollama ${version}.` };
}

/** Tries the given address first, then the usual local ones; returns the first that works, else the first result. */
export async function detectOllama({ base, candidates = OLLAMA_DEFAULT_BASES, ...rest } = {}) {
  const list = [...new Set([base, ...candidates].filter(Boolean).map(normalizeBase))];
  let first = null;
  for (const c of list) {
    const r = await testOllama({ base: c, ...rest });
    first ||= r;
    if (r.status === "ok") return r;
    if (r.status === "origin-blocked" || r.status === "old") return r;
  }
  return first;
}

// ------------------------------------------------------------------------------------------ provider

/**
 * @param {{baseUrl?:string, apiKey?:string, headers?:object, fetch?:Function, name?:string, keepAlive?:string|number,
 *   numCtx?:number, cloud?:boolean}} opts
 */
export function createOllamaProvider(opts = {}) {
  const baseUrl = normalizeBase(opts.baseUrl || OLLAMA_DEFAULT_BASES[0]);
  const name = opts.name || "ollama";
  const f = opts.fetch || createOllamaFetch();
  const cloudBase = /^https:\/\/([a-z0-9-]+\.)*ollama\.com$/i.test(baseUrl) || !!opts.cloud;
  const showCache = new Map();

  const headers = (json = true) => {
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    if (opts.apiKey) h.Authorization = `Bearer ${opts.apiKey}`;
    return Object.assign(h, opts.headers || {});
  };
  const call = async (path, body, signal, extra) => {
    const init = body === undefined ? { method: "GET", headers: headers(false), signal } : { method: "POST", headers: headers(true), body: JSON.stringify(body), signal };
    try {
      return await doFetch(f, joinUrl(baseUrl, path), init, name);
    } catch (e) {
      if (isAbortError(e)) throw e;
      const err = mapOllamaError(e, { model: body?.model, cloud: cloudBase, ...extra });
      if (err instanceof ProviderError && err.status === 0 && err.code === "network_error" && typeof document !== "undefined" && !f.native && (await probeReachable(baseUrl, f))) {
        throw new ProviderError(`${err.message} The server is running, so the browser is blocking the request: Ollama must allow this page's origin (OLLAMA_ORIGINS). Open the Models tab ▸ Ollama ▸ Test connection for the exact command.`, { status: 0, code: "origin_blocked", retryable: false, provider: name });
      }
      throw err;
    }
  };

  /** Capabilities of one model from /api/show, cached. Unknown on failure (everything is then allowed). */
  async function show(model, signal) {
    if (showCache.has(model)) return showCache.get(model);
    const p = call("api/show", { model }, signal)
      .then((r) => r.json())
      .then(parseShow)
      .catch((e) => {
        showCache.delete(model);
        if (isAbortError(e)) throw e;
        return {};
      });
    showCache.set(model, p);
    return p;
  }

  const provider = {
    name,
    kind: "ollama",
    baseUrl,
    capabilities: { embeddings: true, images: false },

    /** Everything Ollama serves: local models, daemon-served cloud models, capabilities, loaded state. */
    async listModels({ signal } = {}) {
      const tags = await (await call("api/tags", undefined, signal)).json();
      const ps = await call("api/ps", undefined, signal).then((r) => r.json()).catch((e) => (isAbortError(e) ? Promise.reject(e) : {}));
      const names = (tags.models || []).map((m) => m.name || m.model).filter(Boolean).slice(0, 200);
      const shows = {};
      let next = 0;
      const worker = async () => {
        while (next < names.length) {
          const n = names[next++];
          shows[n] = await show(n, signal);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, names.length) }, worker));
      return mergeModels(tags, ps, shows, { allCloud: cloudBase });
    },

    /** Capabilities of one model ({tools, vision, thinking, contextWindow, …}); {} when unknown. */
    capabilitiesOf: (model, signal) => show(model, signal),

    async version({ signal } = {}) {
      return String((await (await call("api/version", undefined, signal)).json()).version || "");
    },

    /**
     * Streams /api/chat as neutral events. Tools and images are only sent to models that support them.
     * @param {{model:string, system?:string, messages:object[], tools?:object[], maxTokens?:number, temperature?:number, reasoning?:{effort:string}}} request
     */
    async *stream(request, { signal } = {}) {
      const caps = await show(request.model, signal).catch((e) => (isAbortError(e) ? Promise.reject(e) : {}));
      const useTools = !!(request.tools && request.tools.length) && request.toolChoice !== "none" && caps.tools !== false;
      const ctx = opts.numCtx || Math.min(caps.contextWindow || DEFAULT_CTX, MAX_CTX);
      const body = { model: request.model, messages: toOllamaMessages(request.system, request.messages, { vision: caps.vision !== false }), stream: true, options: { num_ctx: ctx } };
      if (opts.keepAlive != null && opts.keepAlive !== "") body.keep_alive = opts.keepAlive;
      if (request.maxTokens != null) body.options.num_predict = request.maxTokens;
      if (request.temperature != null) body.options.temperature = request.temperature;
      if (useTools) body.tools = toOllamaTools(request.tools);
      if (caps.thinking && request.reasoning?.effort) body.think = /gpt-oss/i.test(request.model) ? request.reasoning.effort : true;
      const res = await call("api/chat", body, signal, { model: request.model });
      let text = "";
      let thinking = "";
      const calls = [];
      let usage = null;
      let doneReason = null;
      let done = false;
      for await (const obj of parseNdjson(res, signal)) {
        if (obj.error) throw mapOllamaError(new ProviderError(String(obj.error), { status: /not found/i.test(obj.error) ? 404 : 500, provider: name }), { model: request.model, cloud: cloudBase });
        const m = obj.message || {};
        if (typeof m.thinking === "string" && m.thinking) {
          thinking += m.thinking;
          yield { type: "thinking", delta: m.thinking };
        }
        if (typeof m.content === "string" && m.content) {
          text += m.content;
          yield { type: "text", delta: m.content };
        }
        for (const tc of m.tool_calls || []) {
          const fn = tc.function || {};
          let input = fn.arguments;
          if (typeof input === "string") {
            try {
              input = JSON.parse(input);
            } catch {
              input = null;
            }
          }
          const ev = { type: "tool_call", id: tc.id || makeId("call"), name: fn.name || "", input: input && typeof input === "object" && !Array.isArray(input) ? input : {} };
          if (!fn.name) ev.error = "Tool call had no function name.";
          else if (input == null) ev.error = "Tool arguments were not valid JSON.";
          calls.push(ev);
          yield ev;
        }
        if (obj.done) {
          done = true;
          doneReason = obj.done_reason || null;
          if (obj.prompt_eval_count != null || obj.eval_count != null) usage = { type: "usage", input: obj.prompt_eval_count || 0, output: obj.eval_count || 0 };
        }
      }
      if (!done) throw new ProviderError("The stream ended before the model finished.", { code: "stream_truncated", retryable: true, provider: name });
      if (usage) yield usage;
      const content = [];
      if (thinking) content.push({ type: "thinking", text: thinking });
      if (text) content.push({ type: "text", text });
      for (const c of calls) if (c.name) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      yield { type: "done", stopReason: calls.length ? "tool_use" : doneReason === "length" ? "max_tokens" : "end", message: { role: "assistant", content } };
    },

    /** Embeddings via /api/embed. @param {string[]} texts @param {{model:string, signal?:AbortSignal}} o */
    async embed(texts, { model, signal } = {}) {
      const out = [];
      for (let i = 0; i < texts.length; i += 64) {
        const batch = texts.slice(i, i + 64);
        const json = await (await call("api/embed", { model, input: batch }, signal, { model })).json();
        if (!Array.isArray(json.embeddings) || json.embeddings.length !== batch.length) throw new ProviderError(`Embeddings response had ${json.embeddings?.length ?? 0} vectors for ${batch.length} inputs.`, { code: "bad_response", provider: name });
        out.push(...json.embeddings);
      }
      return out;
    },

    /**
     * Downloads a model (POST /api/pull, streamed). `onProgress({status, completed, total, fraction})`.
     * @param {string} model @param {{onProgress?:Function, signal?:AbortSignal}} [o]
     */
    async pull(model, { onProgress, signal } = {}) {
      const res = await call("api/pull", { model, stream: true }, signal, { model });
      let ok = false;
      for await (const obj of parseNdjson(res, signal)) {
        if (obj.error) throw new ProviderError(String(obj.error), { status: 500, provider: name });
        if (obj.status === "success") ok = true;
        onProgress?.({ status: obj.status || "", completed: obj.completed || 0, total: obj.total || 0, fraction: obj.total ? Math.min(1, (obj.completed || 0) / obj.total) : null });
      }
      if (!ok) throw new ProviderError("The download did not finish.", { code: "stream_truncated", retryable: true, provider: name });
      showCache.delete(model);
    },
  };
  return provider;
}

export { abortError };
