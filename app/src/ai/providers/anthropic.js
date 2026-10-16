// Anthropic Messages API provider (streaming, tools, images, thinking, prompt caching).
// Pure: `fetch` is injected. Works from browsers via the direct-browser-access header.

import { ProviderError, doFetch, errorFromBody, joinUrl, parseJsonLenient, parseSse, toBlocks } from "../util.js";

export { ProviderError };

const EFFORT_BUDGET = { low: 2048, medium: 8192, high: 24576 };

function imageBlock(b) {
  return { type: "image", source: { type: "base64", media_type: b.mime || "image/png", data: b.data } };
}

function resultContent(c) {
  if (typeof c === "string") return c;
  const out = [];
  for (const b of c || []) {
    if (!b) continue;
    if (b.type === "text") {
      if (b.text) out.push({ type: "text", text: b.text });
    } else if (b.type === "image") out.push(imageBlock(b));
  }
  return out.length ? out : "(no output)";
}

/**
 * Translates neutral messages into Anthropic Messages API messages.
 * Thinking blocks are only sent back when they carry a `signature` (or are redacted).
 * @param {{role:string,content:any}[]} messages
 * @returns {object[]}
 */
export function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    const content = [];
    for (const b of toBlocks(m.content)) {
      switch (b.type) {
        case "text":
          if (b.text) content.push({ type: "text", text: b.text });
          break;
        case "image":
          content.push(imageBlock(b));
          break;
        case "tool_use":
          content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} });
          break;
        case "tool_result": {
          const r = { type: "tool_result", tool_use_id: b.toolUseId, content: resultContent(b.content) };
          if (b.isError) r.is_error = true;
          content.push(r);
          break;
        }
        case "thinking":
          if (m.role === "assistant") {
            if (b.redacted && b.data) content.push({ type: "redacted_thinking", data: b.data });
            else if (b.signature) content.push({ type: "thinking", thinking: b.text || "", signature: b.signature });
          }
          break;
        default:
          break;
      }
    }
    if (!content.length) {
      if (m.role === "assistant") continue;
      content.push({ type: "text", text: "(empty)" });
    }
    out.push({ role: m.role, content });
  }
  return out;
}

/**
 * Translates Anthropic content blocks back to neutral blocks.
 * @param {object[]} blocks
 */
export function fromAnthropicContent(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (b.type === "text") out.push({ type: "text", text: b.text });
    else if (b.type === "tool_use") out.push({ type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} });
    else if (b.type === "thinking") out.push({ type: "thinking", text: b.thinking || "", ...(b.signature ? { signature: b.signature } : {}) });
    else if (b.type === "redacted_thinking") out.push({ type: "thinking", text: "", redacted: true, data: b.data });
  }
  return out;
}

function mapStop(r) {
  switch (r) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    default:
      return "end";
  }
}

/**
 * Creates an Anthropic provider.
 * @param {{baseUrl?:string, apiKey?:string, fetch?:typeof fetch, headers?:Record<string,string>, cache?:boolean, name?:string}} opts
 */
export function createAnthropicProvider(opts = {}) {
  const baseUrl = (opts.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const name = opts.name || "anthropic";
  const f = opts.fetch || ((...a) => globalThis.fetch(...a));

  const headers = (extra) => {
    const h = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    if (opts.apiKey) h["x-api-key"] = opts.apiKey;
    return Object.assign(h, opts.headers || {}, extra || {});
  };

  function buildBody(req) {
    const cache = req.cache ?? opts.cache;
    const body = { model: req.model, stream: true, messages: toAnthropicMessages(req.messages) };
    let maxTokens = req.maxTokens ?? 8192;
    let thinking = null;
    if (req.reasoning && req.reasoning.effort) {
      const want = req.reasoning.budgetTokens ?? EFFORT_BUDGET[req.reasoning.effort] ?? EFFORT_BUDGET.medium;
      if (req.maxTokens == null) maxTokens = want + 8192;
      const budget = Math.min(want, maxTokens - 1024);
      if (budget >= 1024) thinking = { type: "enabled", budget_tokens: budget };
    }
    body.max_tokens = maxTokens;
    if (thinking) body.thinking = thinking;
    else if (req.temperature != null) body.temperature = req.temperature;
    if (req.system) body.system = cache ? [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }] : req.system;
    if (req.tools && req.tools.length) {
      body.tools = req.tools.map((t, i) => {
        const o = { name: t.name, description: t.description || "", input_schema: t.inputSchema || { type: "object", properties: {} } };
        if (cache && i === req.tools.length - 1) o.cache_control = { type: "ephemeral" };
        return o;
      });
      const tc = req.toolChoice;
      if (tc === "none") body.tool_choice = { type: "none" };
      else if (tc === "auto") body.tool_choice = { type: "auto" };
      else if (tc && tc.name && !thinking) body.tool_choice = { type: "tool", name: tc.name }; // forced tools are not allowed with thinking
    }
    return body;
  }

  return {
    name,
    kind: "anthropic",
    baseUrl,
    capabilities: { embeddings: false, images: false },

    /** Lists models via GET /v1/models with cursor pagination. */
    async listModels({ signal } = {}) {
      const out = [];
      let after = "";
      for (let page = 0; page < 20; page++) {
        const url = joinUrl(baseUrl, "v1/models") + `?limit=100${after ? "&after_id=" + encodeURIComponent(after) : ""}`;
        const res = await doFetch(f, url, { method: "GET", headers: headers(), signal }, name);
        const json = await res.json();
        for (const m of json?.data || []) {
          if (!m || !m.id) continue;
          const e = { id: m.id, name: m.display_name || m.id, tools: true };
          const ctx = m.max_input_tokens ?? m.context_window;
          if (Number.isFinite(+ctx) && +ctx > 0) e.contextWindow = +ctx;
          e.vision = m.capabilities?.image_input?.supported ?? true;
          out.push(e);
        }
        if (json?.has_more && json.last_id && json.last_id !== after) after = json.last_id;
        else break;
      }
      return out;
    },

    /**
     * Streams a message as neutral events. `usage.input` counts all prompt tokens (cached + uncached).
     * @param {{model:string, system?:string, messages:any[], tools?:any[], maxTokens?:number, temperature?:number, reasoning?:{effort:string, budgetTokens?:number}, toolChoice?:string|{name:string}, cache?:boolean}} request
     * @param {{signal?:AbortSignal}} [o]
     */
    async *stream(request, { signal } = {}) {
      const res = await doFetch(f, joinUrl(baseUrl, "v1/messages"), { method: "POST", headers: headers({ Accept: "text/event-stream" }), body: JSON.stringify(buildBody(request)), signal }, name);
      /** @type {Map<number, any>} */
      const blocks = new Map();
      const order = [];
      let stop = null;
      let inTok = 0;
      let cached;
      let outTok = 0;
      let sawStop = false;

      for await (const ev of parseSse(res, signal)) {
        let obj;
        try {
          obj = JSON.parse(ev.data);
        } catch {
          continue;
        }
        const type = obj.type || ev.event;
        if (type === "ping") continue;
        if (type === "error") {
          const e = obj.error || {};
          const st = e.type === "overloaded_error" ? 529 : e.type === "rate_limit_error" ? 429 : e.type === "api_error" ? 500 : e.type === "invalid_request_error" ? 400 : e.type === "authentication_error" ? 401 : 0;
          throw errorFromBody(obj, ev.data, st, undefined, name);
        }
        if (type === "message_start") {
          const u = obj.message?.usage || {};
          const cr = u.cache_read_input_tokens || 0;
          const cc = u.cache_creation_input_tokens || 0;
          inTok = (u.input_tokens || 0) + cr + cc;
          if (cr || cc || "cache_read_input_tokens" in u) cached = cr;
          outTok = u.output_tokens || 0;
        } else if (type === "content_block_start") {
          const cb = obj.content_block || {};
          const b = { idx: obj.index, type: cb.type, text: "", sig: "", json: "", id: cb.id, name: cb.name, data: cb.data, input: cb.input };
          if (cb.type === "text" && cb.text) {
            b.text = cb.text;
          }
          blocks.set(obj.index, b);
          order.push(b);
          if (cb.type === "text" && cb.text) yield { type: "text", delta: cb.text };
        } else if (type === "content_block_delta") {
          const b = blocks.get(obj.index);
          const d = obj.delta || {};
          if (!b) continue;
          if (d.type === "text_delta") {
            b.text += d.text;
            if (d.text) yield { type: "text", delta: d.text };
          } else if (d.type === "thinking_delta") {
            b.text += d.thinking;
            if (d.thinking) yield { type: "thinking", delta: d.thinking };
          } else if (d.type === "signature_delta") {
            b.sig += d.signature;
          } else if (d.type === "input_json_delta") {
            b.json += d.partial_json || "";
          }
        } else if (type === "content_block_stop") {
          const b = blocks.get(obj.index);
          if (b && b.type === "tool_use" && !b.done) {
            b.done = true;
            const r = parseJsonLenient(b.json || (b.input && Object.keys(b.input).length ? JSON.stringify(b.input) : ""));
            const ok = r.ok && r.value && typeof r.value === "object" && !Array.isArray(r.value);
            b.input = ok ? r.value : {};
            const evt = { type: "tool_call", id: b.id, name: b.name, input: b.input };
            if (r.repaired) evt.repaired = true;
            if (!ok) {
              evt.error = "Tool arguments were not valid JSON.";
              evt.rawArguments = b.json;
            }
            yield evt;
          }
        } else if (type === "message_delta") {
          if (obj.delta?.stop_reason) stop = obj.delta.stop_reason;
          const u = obj.usage || {};
          if (u.output_tokens != null) outTok = u.output_tokens;
          if (u.input_tokens != null && u.input_tokens > 0) {
            const cr = u.cache_read_input_tokens || 0;
            const cc = u.cache_creation_input_tokens || 0;
            inTok = u.input_tokens + cr + cc;
            if (u.cache_read_input_tokens != null) cached = cr;
          }
        } else if (type === "message_stop") {
          sawStop = true;
          break;
        }
      }
      if (!sawStop && !stop) throw new ProviderError("The stream ended before the model finished.", { code: "stream_truncated", retryable: true, provider: name });
      const content = [];
      for (const b of order) {
        if (b.type === "text") {
          if (b.text) content.push({ type: "text", text: b.text });
        } else if (b.type === "thinking") content.push({ type: "thinking", text: b.text, ...(b.sig ? { signature: b.sig } : {}) });
        else if (b.type === "redacted_thinking") content.push({ type: "thinking", text: "", redacted: true, data: b.data });
        else if (b.type === "tool_use") {
          if (!b.done) {
            const r = parseJsonLenient(b.json);
            b.input = r.ok && r.value && typeof r.value === "object" ? r.value : {};
          }
          content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} });
        }
      }
      const u = { type: "usage", input: inTok, output: outTok };
      if (cached != null) u.cachedInput = cached;
      yield u;
      yield { type: "done", stopReason: mapStop(stop), message: { role: "assistant", content } };
    },

    /** Not supported by the Anthropic API. */
    async embed() {
      throw new ProviderError("The Anthropic API does not provide embeddings.", { code: "unsupported", provider: name });
    },

    /** Not supported by the Anthropic API. */
    async generateImage() {
      throw new ProviderError("The Anthropic API cannot generate images.", { code: "unsupported", provider: name });
    },
  };
}
