// OpenAI-compatible Chat Completions provider.
// Works with OpenAI, OpenRouter, DeepSeek, xAI, Groq, Together, Mistral, Gemini (OpenAI compat),
// Ollama, LM Studio, vLLM and any custom base URL. Pure: `fetch` is injected.

import {
  ProviderError,
  abortError,
  base64ToBytes,
  bytesToBase64,
  doFetch,
  errorFromBody,
  isAbortError,
  joinUrl,
  makeId,
  parseDataUrl,
  parseJsonLenient,
  parseSse,
  sniffImageMime,
  textOf,
  toBlocks,
} from "../util.js";

export { ProviderError };

/** @typedef {{type:'text',text:string}|{type:'image',mime:string,data:string}|{type:'tool_use',id:string,name:string,input:object}|{type:'tool_result',toolUseId:string,content:string|object[],isError?:boolean}|{type:'thinking',text:string}} Block */
/** @typedef {{role:'user'|'assistant',content:string|Block[]}} Message */
/** @typedef {{name:string,description?:string,inputSchema?:object}} ToolSpec */

const imagePart = (b) => ({ type: "image_url", image_url: { url: `data:${b.mime || "image/png"};base64,${b.data}` } });

function resultText(tr) {
  const t = typeof tr.content === "string" ? tr.content : textOf(tr.content);
  const hasImages = Array.isArray(tr.content) && tr.content.some((b) => b && b.type === "image");
  let out = t || (hasImages ? "(image output attached in the next message)" : "(no output)");
  if (tr.isError && !/^error\b/i.test(out)) out = "Error: " + out;
  return out;
}

/**
 * Translates neutral messages to OpenAI chat wire messages.
 * tool_result images (unsupported in `tool` messages) are appended as a following user message.
 * @param {string|undefined} system
 * @param {Message[]} messages
 * @returns {object[]}
 */
export function toWireMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages || []) {
    const blocks = toBlocks(m.content);
    if (m.role === "assistant") {
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      const calls = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      if (!text && !calls.length) continue;
      const msg = { role: "assistant", content: text || (calls.length ? null : "") };
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
      continue;
    }
    // user
    const results = blocks.filter((b) => b.type === "tool_result");
    const rest = blocks.filter((b) => b.type === "text" || b.type === "image");
    const lateImages = [];
    for (const tr of results) {
      out.push({ role: "tool", tool_call_id: tr.toolUseId, content: resultText(tr) });
      if (Array.isArray(tr.content)) {
        for (const b of tr.content) if (b && b.type === "image") lateImages.push({ id: tr.toolUseId, b });
      }
    }
    const parts = [];
    for (const li of lateImages) {
      parts.push({ type: "text", text: `Image output of tool call ${li.id}:` });
      parts.push(imagePart(li.b));
    }
    for (const b of rest) parts.push(b.type === "text" ? { type: "text", text: b.text } : imagePart(b));
    if (!parts.length) {
      if (!results.length) out.push({ role: "user", content: "" });
      continue;
    }
    if (parts.every((p) => p.type === "text")) out.push({ role: "user", content: parts.map((p) => p.text).join("\n") });
    else out.push({ role: "user", content: parts });
  }
  return out;
}

/**
 * Translates OpenAI wire messages back to the neutral model (inverse of {@link toWireMessages}).
 * @param {object[]} wire
 * @returns {{system?:string, messages:Message[]}}
 */
export function fromWireMessages(wire) {
  const messages = [];
  let system;
  const partsToBlocks = (c) => {
    if (typeof c === "string") return c ? [{ type: "text", text: c }] : [];
    const out = [];
    for (const p of c || []) {
      if (p.type === "text") out.push({ type: "text", text: p.text });
      else if (p.type === "image_url") {
        const d = parseDataUrl(p.image_url && p.image_url.url);
        if (d) out.push({ type: "image", mime: d.mime, data: d.data });
      }
    }
    return out;
  };
  for (const w of wire || []) {
    if (w.role === "system" || w.role === "developer") {
      system = (system ? system + "\n\n" : "") + (typeof w.content === "string" ? w.content : textOf(partsToBlocks(w.content)));
    } else if (w.role === "user") {
      const bl = partsToBlocks(w.content);
      messages.push({ role: "user", content: bl.length === 1 && bl[0].type === "text" ? bl[0].text : bl });
    } else if (w.role === "assistant") {
      const bl = partsToBlocks(w.content);
      for (const tc of w.tool_calls || []) {
        const r = parseJsonLenient(tc.function && tc.function.arguments);
        bl.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: r.value && typeof r.value === "object" ? r.value : {} });
      }
      messages.push({ role: "assistant", content: bl.length === 1 && bl[0].type === "text" ? bl[0].text : bl });
    } else if (w.role === "tool") {
      const block = { type: "tool_result", toolUseId: w.tool_call_id, content: typeof w.content === "string" ? w.content : textOf(partsToBlocks(w.content)) };
      const last = messages[messages.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) last.content.push(block);
      else messages.push({ role: "user", content: [block] });
    }
  }
  return { system, messages };
}

/** Converts neutral ToolSpecs to OpenAI `tools`. @param {ToolSpec[]} tools */
export function toWireTools(tools) {
  return (tools || []).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description || "", parameters: t.inputSchema || { type: "object", properties: {} } },
  }));
}

function mapFinish(reason, hasTools) {
  if (hasTools) return reason === "length" ? "max_tokens" : "tool_use";
  switch (reason) {
    case "length":
      return "max_tokens";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "content_filter":
    case "error":
      return "error";
    default:
      return "end";
  }
}

function mapUsage(u) {
  if (!u || typeof u !== "object") return null;
  const input = u.prompt_tokens ?? u.input_tokens ?? 0;
  const output = u.completion_tokens ?? u.output_tokens ?? 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cached_tokens;
  const ev = { type: "usage", input, output };
  if (cached != null) ev.cachedInput = cached;
  return ev;
}

function finishToolCall(slot) {
  const r = parseJsonLenient(slot.args);
  const ev = { type: "tool_call", id: slot.id, name: slot.name, input: {} };
  if (r.ok && r.value && typeof r.value === "object" && !Array.isArray(r.value)) {
    ev.input = r.value;
    if (r.repaired) ev.repaired = true;
  } else {
    ev.error = r.ok ? "Tool arguments must be a JSON object." : "Tool arguments were not valid JSON.";
    ev.rawArguments = slot.args;
  }
  if (!slot.name) ev.error = "Tool call had no function name.";
  return ev;
}

function reasoningDelta(d) {
  if (typeof d.reasoning_content === "string") return d.reasoning_content;
  if (typeof d.reasoning === "string") return d.reasoning;
  if (Array.isArray(d.reasoning_details)) {
    return d.reasoning_details.map((x) => (x && (x.text || x.summary)) || "").join("");
  }
  return "";
}

function buildMessage(thinking, text, calls) {
  const content = [];
  if (thinking) content.push({ type: "thinking", text: thinking });
  if (text) content.push({ type: "text", text });
  for (const c of calls) if (c.name) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
  return { role: "assistant", content };
}

/**
 * Creates an OpenAI-compatible provider.
 * @param {{baseUrl?:string, apiKey?:string, headers?:Record<string,string>, fetch?:typeof fetch, name?:string,
 *   imageApi?:'images'|'chat', maxTokensParam?:string, extraBody?:object}} opts
 */
export function createOpenAIProvider(opts = {}) {
  const baseUrl = (opts.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const name = opts.name || "openai";
  const f = opts.fetch || ((...a) => globalThis.fetch(...a));
  const isOpenRouter = /openrouter\.ai/i.test(baseUrl);
  const isOpenAI = /api\.openai\.com/i.test(baseUrl);
  const maxTokensParam = opts.maxTokensParam || (isOpenAI ? "max_completion_tokens" : "max_tokens");

  const headers = (json = true, extra) => {
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    if (opts.apiKey) h.Authorization = `Bearer ${opts.apiKey}`;
    Object.assign(h, opts.headers || {}, extra || {});
    return h;
  };

  function buildBody(req) {
    const body = { model: req.model, messages: toWireMessages(req.system, req.messages), stream: true, stream_options: { include_usage: true } };
    if (req.maxTokens != null) body[maxTokensParam] = req.maxTokens;
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.tools && req.tools.length) {
      body.tools = toWireTools(req.tools);
      const tc = req.toolChoice;
      if (tc === "none" || tc === "auto") body.tool_choice = tc;
      else if (tc && tc.name) body.tool_choice = { type: "function", function: { name: tc.name } };
    }
    if (req.reasoning && req.reasoning.effort) {
      if (isOpenRouter) body.reasoning = { effort: req.reasoning.effort };
      else body.reasoning_effort = req.reasoning.effort;
    }
    return Object.assign(body, opts.extraBody || {});
  }

  const provider = {
    name,
    kind: "openai",
    baseUrl,
    capabilities: { embeddings: true, images: true },

    /** Lists models from GET {baseUrl}/models. */
    async listModels({ signal } = {}) {
      const res = await doFetch(f, joinUrl(baseUrl, "models"), { method: "GET", headers: headers(false), signal }, name);
      let json;
      try {
        json = await res.json();
      } catch {
        return [];
      }
      const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
      const out = [];
      for (const m of arr) {
        if (!m) continue;
        const raw = typeof m === "string" ? m : m.id ?? m.name ?? m.model;
        if (!raw || typeof raw !== "string") continue;
        const id = raw.replace(/^models\//, "");
        const e = { id };
        if (typeof m === "object") {
          if (typeof m.name === "string" && m.name !== raw) e.name = m.name;
          else if (typeof m.display_name === "string") e.name = m.display_name;
          const ctx = m.context_length ?? m.context_window ?? m.top_provider?.context_length ?? m.max_context_length ?? m.inputTokenLimit;
          if (Number.isFinite(+ctx) && +ctx > 0) e.contextWindow = +ctx;
          const inMods = m.architecture?.input_modalities ?? m.input_modalities ?? m.modalities;
          if (Array.isArray(inMods)) e.vision = inMods.includes("image");
          else if (typeof m.architecture?.modality === "string") e.vision = /image/.test(m.architecture.modality.split("->")[0]);
          const outMods = m.architecture?.output_modalities;
          if (Array.isArray(outMods) && outMods.includes("image")) e.imageOutput = true;
          const sp = m.supported_parameters;
          if (Array.isArray(sp)) e.tools = sp.includes("tools");
          const p = m.pricing;
          if (p && (p.prompt != null || p.completion != null)) {
            const a = Number(p.prompt);
            const b = Number(p.completion);
            if (Number.isFinite(a) && Number.isFinite(b)) e.pricing = { promptPerM: +(a * 1e6).toFixed(6), completionPerM: +(b * 1e6).toFixed(6) };
          }
        }
        out.push(e);
      }
      return out;
    },

    /**
     * Streams a chat completion as neutral events.
     * @param {{model:string, system?:string, messages:Message[], tools?:ToolSpec[], maxTokens?:number, temperature?:number, reasoning?:{effort:string}, toolChoice?:string|{name:string}}} request
     * @param {{signal?:AbortSignal}} [o]
     */
    async *stream(request, { signal } = {}) {
      const res = await doFetch(
        f,
        joinUrl(baseUrl, "chat/completions"),
        { method: "POST", headers: headers(true, { Accept: "text/event-stream" }), body: JSON.stringify(buildBody(request)), signal },
        name,
      );
      let text = "";
      let thinking = "";
      const slots = [];
      const byIndex = new Map();
      let flushed = 0;
      let finish = null;
      let usage = null;
      let sawDone = false;

      const ctype = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
      if (/application\/json/i.test(ctype)) {
        // server ignored stream:true
        const json = await res.json();
        const ch = json.choices && json.choices[0];
        const msg = (ch && ch.message) || {};
        const rd = reasoningDelta(msg);
        if (rd) {
          thinking = rd;
          yield { type: "thinking", delta: rd };
        }
        if (typeof msg.content === "string" && msg.content) {
          text = msg.content;
          yield { type: "text", delta: text };
        }
        const calls = [];
        for (const tc of msg.tool_calls || []) {
          const ev = finishToolCall({ id: tc.id || makeId("call"), name: tc.function?.name || "", args: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {}) });
          calls.push(ev);
          yield ev;
        }
        const u = mapUsage(json.usage);
        if (u) yield u;
        yield { type: "done", stopReason: mapFinish(ch && ch.finish_reason, calls.length > 0), message: buildMessage(thinking, text, calls) };
        return;
      }

      for await (const ev of parseSse(res, signal)) {
        const data = ev.data;
        if (data === "[DONE]") {
          sawDone = true;
          break;
        }
        let obj;
        try {
          obj = JSON.parse(data);
        } catch {
          continue;
        }
        if (obj && obj.error) throw errorFromBody(obj, data, 0, undefined, name);
        if (ev.event === "error") throw errorFromBody(obj, data, 0, undefined, name);
        if (obj.usage) usage = mapUsage(obj.usage) || usage;
        const choice = obj.choices && obj.choices[0];
        if (!choice) continue;
        const d = choice.delta || choice.message || {};
        const rd = reasoningDelta(d);
        if (rd) {
          thinking += rd;
          yield { type: "thinking", delta: rd };
        }
        if (typeof d.content === "string" && d.content) {
          text += d.content;
          yield { type: "text", delta: d.content };
        }
        if (Array.isArray(d.tool_calls)) {
          for (const tc of d.tool_calls) {
            const idx = tc.index;
            let slot;
            if (idx != null) slot = byIndex.get(idx);
            else if (tc.id) slot = slots.find((s) => s.id === tc.id);
            else slot = slots[slots.length - 1];
            if (slot && idx != null && tc.id && slot.id && tc.id !== slot.id) slot = undefined;
            if (!slot) {
              slot = { id: tc.id || undefined, name: "", args: "" };
              slots.push(slot);
              if (idx != null) byIndex.set(idx, slot);
              // earlier calls are complete once a new one starts
              while (flushed < slots.length - 1) {
                const s = slots[flushed++];
                if (!s.id) s.id = makeId("call");
                s.ev = finishToolCall(s);
                yield s.ev;
              }
            }
            if (tc.id && !slot.id) slot.id = tc.id;
            const fn = tc.function || {};
            if (fn.name && !slot.name) slot.name = fn.name;
            if (typeof fn.arguments === "string") slot.args += fn.arguments;
            else if (fn.arguments && typeof fn.arguments === "object") slot.args = JSON.stringify(fn.arguments);
          }
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      if (!sawDone && !finish) {
        throw new ProviderError("The stream ended before the model finished.", { code: "stream_truncated", retryable: true, provider: name });
      }
      while (flushed < slots.length) {
        const s = slots[flushed++];
        if (!s.id) s.id = makeId("call");
        s.ev = finishToolCall(s);
        yield s.ev;
      }
      const calls = slots.map((s) => s.ev);
      if (usage) yield usage;
      let stopReason = mapFinish(finish, calls.length > 0);
      if (!finish && !calls.length) stopReason = "end";
      yield { type: "done", stopReason, message: buildMessage(thinking, text, calls) };
    },

    /**
     * Embeds texts via {baseUrl}/embeddings (batches of 96).
     * @param {string[]} texts
     * @param {{model:string, signal?:AbortSignal}} o
     * @returns {Promise<number[][]>}
     */
    async embed(texts, { model, signal } = {}) {
      const out = [];
      for (let i = 0; i < texts.length; i += 96) {
        const batch = texts.slice(i, i + 96);
        const res = await doFetch(
          f,
          joinUrl(baseUrl, "embeddings"),
          { method: "POST", headers: headers(true), body: JSON.stringify({ model, input: batch, encoding_format: "float" }), signal },
          name,
        );
        const json = await res.json();
        const data = Array.isArray(json?.data) ? json.data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
        if (data.length !== batch.length) throw new ProviderError(`Embeddings response had ${data.length} vectors for ${batch.length} inputs.`, { code: "bad_response", provider: name });
        for (const d of data) out.push(d.embedding);
      }
      return out;
    },

    /**
     * Generates or edits images. `imageApi:'images'` uses /images/generations|edits, `'chat'` uses
     * chat completions with modalities ['image','text'] (OpenRouter style).
     * @param {{prompt:string, model:string, size?:string, n?:number, image?:{mime:string,data:string}, mask?:{mime:string,data:string}, background?:string, imageApi?:'images'|'chat', signal?:AbortSignal}} o
     * @returns {Promise<{mime:string,data:string}[]>}
     */
    async generateImage(o) {
      const api = o.imageApi || opts.imageApi || "images";
      const signal = o.signal;
      if (api === "chat") {
        const content = [{ type: "text", text: o.size ? `${o.prompt}\n\n(Target size: ${o.size})` : o.prompt }];
        if (o.image) content.push(imagePart(o.image));
        const res = await doFetch(
          f,
          joinUrl(baseUrl, "chat/completions"),
          { method: "POST", headers: headers(true), body: JSON.stringify({ model: o.model, messages: [{ role: "user", content }], modalities: ["image", "text"], stream: false }), signal },
          name,
        );
        const json = await res.json();
        const imgs = json?.choices?.[0]?.message?.images || [];
        const out = [];
        for (const im of imgs) {
          const url = im?.image_url?.url ?? im?.url ?? (typeof im === "string" ? im : "");
          const d = parseDataUrl(url);
          if (d) out.push(d);
          else if (/^https?:/i.test(url)) out.push(await fetchImage(url, signal));
        }
        if (!out.length) throw new ProviderError("The model returned no image.", { code: "no_image", provider: name });
        return out;
      }
      let res;
      if (o.image) {
        const form = new FormData();
        const ext = (m) => (m === "image/jpeg" ? "jpg" : m === "image/webp" ? "webp" : "png");
        form.append("model", o.model);
        form.append("prompt", o.prompt);
        if (o.n) form.append("n", String(o.n));
        if (o.size) form.append("size", o.size);
        if (o.background) form.append("background", o.background);
        form.append("image", new Blob([base64ToBytes(o.image.data)], { type: o.image.mime }), `image.${ext(o.image.mime)}`);
        if (o.mask) form.append("mask", new Blob([base64ToBytes(o.mask.data)], { type: o.mask.mime }), `mask.${ext(o.mask.mime)}`);
        res = await doFetch(f, joinUrl(baseUrl, "images/edits"), { method: "POST", headers: headers(false), body: form, signal }, name);
      } else {
        const body = { model: o.model, prompt: o.prompt };
        if (o.n) body.n = o.n;
        if (o.size) body.size = o.size;
        if (o.background) body.background = o.background;
        if (/^dall-e/i.test(o.model)) body.response_format = "b64_json";
        res = await doFetch(f, joinUrl(baseUrl, "images/generations"), { method: "POST", headers: headers(true), body: JSON.stringify(body), signal }, name);
      }
      const json = await res.json();
      const out = [];
      for (const d of json?.data || []) {
        if (d.b64_json) out.push({ mime: sniffImageMime(base64ToBytes(d.b64_json.slice(0, 16))), data: d.b64_json });
        else if (d.url) out.push(await fetchImage(d.url, signal));
      }
      if (!out.length) throw new ProviderError("The image API returned no images.", { code: "no_image", provider: name });
      return out;
    },
  };

  async function fetchImage(url, signal) {
    const d = parseDataUrl(url);
    if (d) return d;
    // image CDN URLs must not receive the API key
    const res = await doFetch(f, url, { method: "GET", signal }, name);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers && res.headers.get && res.headers.get("content-type");
    return { mime: ct && /^image\//.test(ct) ? ct.split(";")[0] : sniffImageMime(bytes), data: bytesToBase64(bytes) };
  }

  return provider;
}

export { abortError, isAbortError };
