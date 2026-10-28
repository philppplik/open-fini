// OpenAI Responses API provider for ChatGPT-account sign-in (plan usage).
// Public API: createOpenAIResponsesProvider, toResponsesInput.
// Invariants: pure (`fetch` injected). Always sends store:false and stream:true, instructions (never a system-role
// item), and none of the fields the plan-usage route rejects (max_output_tokens, temperature, metadata, ...).
// Only https://api.openai.com/v1 is called. `getToken({force})` supplies the (refreshed) access token per request;
// a 401 triggers one forced refresh and a retry. Rules: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations

import { ProviderError, doFetch, errorFromBody, isAbortError, joinUrl, makeId, parseJsonLenient, parseSse, textOf, toBlocks } from "../util.js";
import { friendlyAccountError, parseAccountModels } from "../openai-account.js";

/**
 * Neutral messages -> Responses `input` items.
 * @param {{role:'user'|'assistant', content:any}[]} messages
 */
export function toResponsesInput(messages) {
  const out = [];
  for (const m of messages || []) {
    const blocks = toBlocks(m.content);
    if (m.role === "assistant") {
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (text) out.push({ role: "assistant", content: [{ type: "output_text", text }] });
      for (const b of blocks) if (b.type === "tool_use") out.push({ type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) });
      continue;
    }
    const parts = [];
    for (const b of blocks) {
      if (b.type === "tool_result") {
        const t = typeof b.content === "string" ? b.content : textOf(b.content);
        out.push({ type: "function_call_output", call_id: b.toolUseId, output: (b.isError && !/^error\b/i.test(t) ? "Error: " : "") + (t || "(no output)") });
        if (Array.isArray(b.content)) for (const x of b.content) if (x && x.type === "image") parts.push({ type: "input_image", image_url: `data:${x.mime || "image/png"};base64,${x.data}` });
      } else if (b.type === "text") parts.push({ type: "input_text", text: b.text });
      else if (b.type === "image") parts.push({ type: "input_image", image_url: `data:${b.mime || "image/png"};base64,${b.data}` });
    }
    if (parts.length) out.push({ role: "user", content: parts });
  }
  return out;
}

const usageOf = (u) => (u ? { type: "usage", input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, ...(u.input_tokens_details?.cached_tokens != null ? { cachedInput: u.input_tokens_details.cached_tokens } : {}) } : null);

function failure(err, name) {
  const code = err?.code || "error";
  const friendly = friendlyAccountError(code);
  const status = err?.status || (/usage_limit/.test(code) ? 429 : /unavailable/.test(code) ? 503 : 0);
  return new ProviderError(friendly || err?.message || "The request failed.", { status, code, retryable: /usage_unavailable|user_unavailable/.test(code), provider: name });
}

/**
 * @param {{getToken:(o?:{force?:boolean})=>Promise<string>, fetch?:typeof fetch, name?:string, baseUrl?:string}} opts
 */
export function createOpenAIResponsesProvider(opts) {
  const baseUrl = (opts.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const name = opts.name || "openai-account";
  const f = opts.fetch || ((...a) => globalThis.fetch(...a));

  async function call(path, init, force) {
    const token = await opts.getToken({ force });
    if (!token) throw new ProviderError("You are signed out. Sign in with OpenAI in Settings.", { status: 401, code: "signed_out", provider: name });
    init.headers = { ...init.headers, Authorization: `Bearer ${token}` };
    try {
      return await doFetch(f, joinUrl(baseUrl, path), init, name);
    } catch (e) {
      if (e instanceof ProviderError && e.status === 401 && !force) return call(path, init, true);
      if (e instanceof ProviderError) throw failure(e, name);
      throw e;
    }
  }

  return {
    name,
    kind: "openai-responses",
    baseUrl,
    capabilities: { embeddings: false, images: false },

    /** Only the models this account may use (`GET /v1/models`, visibility "list"). */
    async listModels({ signal } = {}) {
      const res = await call("models", { method: "GET", headers: {}, signal });
      return parseAccountModels(await res.json().catch(() => null));
    },

    async *stream(req, { signal } = {}) {
      const body = { model: req.model, input: toResponsesInput(req.messages), store: false, stream: true };
      if (req.system) body.instructions = req.system;
      if (req.tools && req.tools.length) {
        body.tools = req.tools.map((t) => ({ type: "function", name: t.name, description: t.description || "", parameters: t.inputSchema || { type: "object", properties: {} } }));
        const tc = req.toolChoice;
        if (tc === "none" || tc === "auto") body.tool_choice = tc;
        else if (tc && tc.name) body.tool_choice = { type: "function", name: tc.name };
      }
      if (req.reasoning && req.reasoning.effort) body.reasoning = { effort: req.reasoning.effort };
      const res = await call("responses", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body), signal }, false);

      let text = "";
      let thinking = "";
      const calls = [];
      let completed = false;
      let incomplete = false;
      let usage = null;
      try {
        for await (const ev of parseSse(res, signal)) {
          let o;
          try {
            o = JSON.parse(ev.data);
          } catch {
            continue;
          }
          const type = o.type || ev.event;
          if (type === "response.output_text.delta" && typeof o.delta === "string") {
            text += o.delta;
            yield { type: "text", delta: o.delta };
          } else if ((type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") && typeof o.delta === "string") {
            thinking += o.delta;
            yield { type: "thinking", delta: o.delta };
          } else if (type === "response.output_item.done" && o.item && o.item.type === "function_call") {
            const r = parseJsonLenient(o.item.arguments);
            const ok = r.ok && r.value && typeof r.value === "object" && !Array.isArray(r.value);
            const c = { type: "tool_call", id: o.item.call_id || makeId("call"), name: o.item.name || "", input: ok ? r.value : {} };
            if (!ok) {
              c.error = "Tool arguments were not valid JSON.";
              c.rawArguments = o.item.arguments;
            }
            calls.push(c);
            yield c;
          } else if (type === "response.completed") {
            completed = true;
            usage = usageOf(o.response && o.response.usage);
          } else if (type === "response.incomplete") {
            completed = true;
            incomplete = true;
            usage = usageOf(o.response && o.response.usage);
          } else if (type === "response.failed") {
            throw failure(o.response?.error || {}, name);
          } else if (type === "error") {
            throw failure(errorFromBody(o, ev.data, 0, undefined, name), name);
          }
        }
      } catch (e) {
        if (isAbortError(e) || e instanceof ProviderError) throw e;
        throw new ProviderError(`Stream error: ${e && e.message ? e.message : e}`, { code: "stream_error", retryable: true, provider: name });
      }
      if (!completed) throw new ProviderError("The stream ended before the model finished.", { code: "stream_truncated", retryable: true, provider: name });
      if (usage) yield usage;
      const content = [];
      if (thinking) content.push({ type: "thinking", text: thinking });
      if (text) content.push({ type: "text", text });
      for (const c of calls) if (c.name) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      yield { type: "done", stopReason: calls.length ? "tool_use" : incomplete ? "max_tokens" : "end", message: { role: "assistant", content } };
    },
  };
}
