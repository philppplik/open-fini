// OpenCode integration (https://opencode.ai). Pure ES module; `fetch` is injected.
//
//   1. OpenCode Zen: a normal OpenAI-compatible gateway; handled by the "opencode-zen" preset (providers/index.js) and
//      the generic OpenAI provider. Nothing in this file is needed for it.
//   2. OpenCode server (`opencode serve`): EXPERIMENTAL adapter, createOpenCodeServerProvider(). Only endpoints that
//      are documented at https://opencode.ai/docs/server/ and /docs/sdk/ are used:
//        GET  /global/health                 -> { healthy, version }
//        GET  /config/providers              -> providers and default models (response shape is NOT documented: parsed leniently)
//        POST /session            { title? } -> Session { id }
//        POST /session/:id/message { model:{providerID,modelID}, system?, parts:[{type:"text",text}] } -> { info, parts }
//        POST /session/:id/abort
//      The documented message endpoint waits for the complete answer, so output is delivered as ONE text event (no
//      token streaming: the server-sent event schema is not documented, so it is not used). OpenCode runs its own tools
//      inside its own project directory; OpenFini's tools are NOT exposed to it (capabilities.tools = false).
//      Auth: OPENCODE_SERVER_PASSWORD enables HTTP Basic auth, user `opencode` (OPENCODE_SERVER_USERNAME to change).
//   3. parseOpenCodeConfig(): reads an opencode.json(c) and proposes OpenFini connections. API keys are never read.
import { ProviderError, doFetch, joinUrl, throwIfAborted, textOf, toBlocks } from "../util.js";

// ------------------------------------------------------------------ opencode.json import

/** Removes // and block comments and trailing commas (JSONC) without touching strings. @param {string} src */
export function stripJsonc(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

// opencode provider id / npm package -> OpenFini preset (built-in providers have no baseURL in the config)
const BUILTIN = {
  anthropic: { preset: "anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com" },
  openai: { preset: "openai", kind: "openai", baseUrl: "https://api.openai.com/v1" },
  openrouter: { preset: "openrouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1" },
  google: { preset: "google-gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  deepseek: { preset: "deepseek", kind: "openai", baseUrl: "https://api.deepseek.com" },
  xai: { preset: "xai", kind: "openai", baseUrl: "https://api.x.ai/v1" },
  groq: { preset: "groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1" },
  mistral: { preset: "mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1" },
  togetherai: { preset: "together", kind: "openai", baseUrl: "https://api.together.xyz/v1" },
  opencode: { preset: "opencode-zen", kind: "openai", baseUrl: "https://opencode.ai/zen/v1" },
};
const SDK_KIND = { "@ai-sdk/openai-compatible": "openai", "@ai-sdk/openai": "openai", "@ai-sdk/anthropic": "anthropic" };

const isRef = (v) => typeof v === "string" && /\{(env|file):[^}]*\}/.test(v);
const SECRET_HEADER = /^(authorization|x-api-key|api-key|x-goog-api-key|cookie|proxy-authorization)$/i;

/**
 * Parses an opencode.json / opencode.jsonc and proposes OpenFini connections.
 * Never reads secrets: `options.apiKey`, auth/secret headers and `{env:..}` / `{file:..}` values are dropped; the
 * result only says whether a key is needed (`needsKey`) and how OpenCode referenced it (`keyHint`).
 * @param {string|object} input file text or parsed object
 * @returns {{connections:{id:string,label:string,preset:string,kind:'openai'|'anthropic',baseUrl:string,headers:object,models:{id:string,name?:string,contextWindow?:number}[],needsKey:boolean,keyHint:string}[], defaultModel:string, warnings:string[]}}
 */
export function parseOpenCodeConfig(input) {
  const warnings = [];
  let cfg = input;
  if (typeof input === "string") {
    try {
      cfg = JSON.parse(stripJsonc(input));
    } catch (e) {
      throw new Error(`This is not valid JSON/JSONC: ${e.message}`);
    }
  }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("Expected a JSON object.");
  const providers = cfg.provider && typeof cfg.provider === "object" ? cfg.provider : {};
  const connections = [];
  for (const [pid, p] of Object.entries(providers)) {
    if (!p || typeof p !== "object") continue;
    const opts = p.options && typeof p.options === "object" ? p.options : {};
    const builtin = BUILTIN[pid];
    const kind = SDK_KIND[p.npm] || (p.npm ? null : builtin?.kind || "openai");
    if (!kind) {
      warnings.push(`Skipped “${pid}”: its SDK package ${p.npm} has no OpenFini equivalent (only OpenAI-compatible and Anthropic APIs are supported).`);
      continue;
    }
    let baseUrl = typeof opts.baseURL === "string" ? opts.baseURL.trim() : builtin?.baseUrl || "";
    if (!baseUrl || isRef(baseUrl)) {
      warnings.push(`Skipped “${pid}”: no usable base URL${isRef(baseUrl) ? " (it is an environment/file reference)" : ""}.`);
      continue;
    }
    baseUrl = baseUrl.replace(/\/+$/, "");
    const headers = {};
    let dropped = 0;
    for (const [k, v] of Object.entries(opts.headers && typeof opts.headers === "object" ? opts.headers : {})) {
      if (typeof v !== "string" || isRef(v) || SECRET_HEADER.test(k)) dropped++;
      else headers[k] = v;
    }
    if (dropped) warnings.push(`“${pid}”: ${dropped} header(s) with secrets or references were not imported.`);
    const models = [];
    for (const [mid, m] of Object.entries(p.models && typeof p.models === "object" ? p.models : {})) {
      const e = { id: String(m?.id || mid) };
      if (typeof m?.name === "string") e.name = m.name;
      const ctx = Number(m?.limit?.context);
      if (Number.isFinite(ctx) && ctx > 0) e.contextWindow = ctx;
      models.push(e);
    }
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(baseUrl);
    const keyRaw = opts.apiKey;
    connections.push({
      id: pid,
      label: typeof p.name === "string" && p.name ? p.name : pid,
      preset: builtin?.preset || "custom",
      kind,
      baseUrl,
      headers,
      models,
      needsKey: !local,
      keyHint: isRef(keyRaw) ? `OpenCode reads the key from ${keyRaw}. Paste the key itself into OpenFini.` : keyRaw ? "The config contains a key; it was not imported. Paste it into OpenFini." : local ? "" : "Paste your API key (OpenCode stores keys in its own auth file, which OpenFini never reads).",
    });
  }
  let defaultModel = typeof cfg.model === "string" ? cfg.model : "";
  if (defaultModel && !defaultModel.includes("/")) defaultModel = "";
  return { connections, defaultModel, warnings };
}

// ------------------------------------------------------------------ opencode server (experimental)

/** Splits "providerID/modelID" at the first slash. @param {string} model */
export function splitModel(model) {
  const s = String(model || "");
  const i = s.indexOf("/");
  if (i <= 0) throw new ProviderError(`Model “${s}” must look like providerID/modelID (for example anthropic/claude-sonnet-5-5).`, { code: "bad_model", status: 400, provider: "opencode" });
  return { providerID: s.slice(0, i), modelID: s.slice(i + 1) };
}

/** Flattens an OpenFini transcript to plain text (tool traffic is omitted: OpenCode runs its own tools). */
export function transcriptText(messages) {
  const list = (messages || []).filter((m) => textOf(m.content).trim());
  if (list.length <= 1) return list.length ? textOf(list[0].content) : "";
  const last = list[list.length - 1];
  const hist = list.slice(0, -1).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${textOf(m.content)}`).join("\n\n");
  return `Earlier conversation:\n${hist}\n\nCurrent request:\n${textOf(last.content)}`;
}

/**
 * Lenient reading of GET /config/providers (shape undocumented): accepts `{providers:[{id,models:{id:{name}}|[...]}]}`,
 * a bare array, or `{[providerId]: {models}}`. Returns model ids as "providerID/modelID".
 */
export function modelsFromProvidersResponse(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.providers) ? json.providers : json && typeof json === "object" ? Object.entries(json).filter(([k, v]) => k !== "default" && v && typeof v === "object").map(([id, v]) => ({ id, ...v })) : [];
  const out = [];
  for (const p of list) {
    if (!p || !p.id) continue;
    const ms = Array.isArray(p.models) ? p.models.map((m) => (typeof m === "string" ? { id: m } : m)) : p.models && typeof p.models === "object" ? Object.entries(p.models).map(([id, m]) => ({ id, ...(m && typeof m === "object" ? m : {}) })) : [];
    for (const m of ms) {
      if (!m?.id) continue;
      const e = { id: `${p.id}/${m.id}`, name: m.name ? `${p.name || p.id}: ${m.name}` : undefined };
      const ctx = Number(m.limit?.context ?? m.contextWindow);
      if (Number.isFinite(ctx) && ctx > 0) e.contextWindow = ctx;
      if (!e.name) delete e.name;
      out.push(e);
    }
  }
  return out;
}

/**
 * Provider for a user-run `opencode serve`. EXPERIMENTAL, see the header comment for what is and is not supported.
 * @param {{baseUrl?:string, apiKey?:string, username?:string, headers?:object, fetch?:typeof fetch, name?:string}} [o] `apiKey` is OPENCODE_SERVER_PASSWORD
 */
export function createOpenCodeServerProvider(o = {}) {
  const baseUrl = (o.baseUrl || "http://127.0.0.1:4096").replace(/\/+$/, "");
  const name = o.name || "opencode";
  const f = (...a) => (o.fetch || globalThis.fetch)(...a);
  const auth = () => (o.apiKey ? { Authorization: "Basic " + btoa(`${o.username || "opencode"}:${o.apiKey}`) } : {});
  const headers = (json) => ({ Accept: "application/json", ...(json ? { "Content-Type": "application/json" } : {}), ...(o.headers || {}), ...auth() });

  return {
    name,
    kind: "opencode-server",
    baseUrl,
    capabilities: { embeddings: false, images: false, tools: false },

    /** GET /global/health. @returns {Promise<{healthy:boolean, version?:string}>} */
    async health({ signal } = {}) {
      const res = await doFetch(f, joinUrl(baseUrl, "global/health"), { method: "GET", headers: headers(false), signal }, name);
      return res.json();
    },

    async listModels({ signal } = {}) {
      const res = await doFetch(f, joinUrl(baseUrl, "config/providers"), { method: "GET", headers: headers(false), signal }, name);
      let json;
      try {
        json = await res.json();
      } catch {
        return [];
      }
      return modelsFromProvidersResponse(json);
    },

    async *stream(request, { signal } = {}) {
      throwIfAborted(signal);
      const model = splitModel(request.model);
      const sres = await doFetch(f, joinUrl(baseUrl, "session"), { method: "POST", headers: headers(true), body: JSON.stringify({ title: "OpenFini" }), signal }, name);
      const session = await sres.json();
      const id = session && session.id;
      if (!id) throw new ProviderError("The OpenCode server did not return a session id.", { code: "bad_response", provider: name });
      const onAbort = () => f(joinUrl(baseUrl, `session/${encodeURIComponent(id)}/abort`), { method: "POST", headers: headers(false) }).catch(() => {});
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      try {
        const body = { model, parts: [{ type: "text", text: transcriptText(request.messages) }], ...(request.system ? { system: request.system } : {}) };
        const res = await doFetch(f, joinUrl(baseUrl, `session/${encodeURIComponent(id)}/message`), { method: "POST", headers: headers(true), body: JSON.stringify(body), signal }, name);
        const json = await res.json();
        const err = json?.info?.error;
        if (err) throw new ProviderError(String(err.data?.message || err.message || err.name || "OpenCode reported an error."), { status: 0, code: String(err.name || "opencode_error"), retryable: false, provider: name, body: err });
        const text = toBlocks(json?.parts)
          .filter((p) => p && p.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join("");
        if (!text) throw new ProviderError("The OpenCode server returned no text.", { code: "empty_response", retryable: true, provider: name });
        yield { type: "text", delta: text };
        yield { type: "done", stopReason: "end", message: { role: "assistant", content: [{ type: "text", text }] } };
      } finally {
        if (signal) signal.removeEventListener("abort", onAbort);
        f(joinUrl(baseUrl, `session/${encodeURIComponent(id)}`), { method: "DELETE", headers: headers(false) }).catch(() => {});
      }
    },

    async embed() {
      throw new ProviderError("The OpenCode server does not provide embeddings.", { code: "unsupported", provider: name });
    },
    async generateImage() {
      throw new ProviderError("The OpenCode server cannot generate images.", { code: "unsupported", provider: name });
    },
  };
}

