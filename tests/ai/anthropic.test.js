import test from "node:test";
import assert from "node:assert/strict";
import { createAnthropicProvider, toAnthropicMessages } from "../../app/src/ai/providers/anthropic.js";
import { createProvider, PROVIDER_PRESETS } from "../../app/src/ai/providers/index.js";
import { ProviderError } from "../../app/src/ai/util.js";
import { streamResponse, splitAt, jsonResponse, fakeFetch, collect, an } from "./helpers.js";

const FIXTURE = [
  an("message_start", { message: { id: "msg_1", role: "assistant", content: [], usage: { input_tokens: 25, cache_read_input_tokens: 5, output_tokens: 1 } } }),
  an("ping", {}),
  an("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } }),
  an("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "Let me " } }),
  an("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "think ✓" } }),
  an("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "SIG123" } }),
  an("content_block_stop", { index: 0 }),
  an("content_block_start", { index: 1, content_block: { type: "text", text: "" } }),
  an("content_block_delta", { index: 1, delta: { type: "text_delta", text: "Hello " } }),
  an("content_block_delta", { index: 1, delta: { type: "text_delta", text: "wörld" } }),
  an("content_block_stop", { index: 1 }),
  an("content_block_start", { index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "add_text", input: {} } }),
  an("content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: "" } }),
  an("content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: '{"text":"Hi' } }),
  an("content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: ' there","x":4' } }),
  an("content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: "2}" } }),
  an("content_block_stop", { index: 2 }),
  an("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 40 } }),
  an("message_stop", {}),
].join("");

const req = { model: "claude-x", messages: [{ role: "user", content: "hi" }] };
const mk = (body, o = {}) => {
  const f = fakeFetch(() => (typeof body === "function" ? body() : body));
  return { f, p: createAnthropicProvider({ apiKey: "sk-test", fetch: f, ...o }) };
};

test("anthropic: stream events, thinking signature, tool input, usage", async () => {
  const { p, f } = mk(() => streamResponse([FIXTURE]));
  const ev = await collect(p.stream({ ...req, system: "SYS", tools: [{ name: "add_text", description: "d", inputSchema: { type: "object" } }] }));
  assert.deepEqual(ev.map((e) => e.type), ["thinking", "thinking", "text", "text", "tool_call", "usage", "done"]);
  assert.deepEqual(ev[4], { type: "tool_call", id: "toolu_1", name: "add_text", input: { text: "Hi there", x: 42 } });
  assert.deepEqual(ev[5], { type: "usage", input: 30, output: 40, cachedInput: 5 });
  const done = ev.at(-1);
  assert.equal(done.stopReason, "tool_use");
  assert.deepEqual(done.message.content[0], { type: "thinking", text: "Let me think ✓", signature: "SIG123" });
  assert.equal(done.message.content[1].text, "Hello wörld");
  assert.equal(done.message.content[2].name, "add_text");
  const c = f.calls[0];
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.headers["x-api-key"], "sk-test");
  assert.equal(c.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(c.json.system, "SYS");
  assert.equal(c.json.max_tokens, 8192);
  assert.equal(c.json.tools[0].input_schema.type, "object");
});

test("anthropic: SSE split at every byte offset", async () => {
  const run = async (n) => collect(mk(() => streamResponse(splitAt(FIXTURE, n))).p.stream(req));
  const base = await run(0);
  const len = new TextEncoder().encode(FIXTURE).length;
  for (let n = 1; n < len; n += 1) assert.deepEqual(await run(n), base, `offset ${n}`);
  const crlf = FIXTURE.replace(/\n/g, "\r\n");
  const len2 = new TextEncoder().encode(crlf).length;
  for (let n = 1; n < len2; n += 3) assert.deepEqual(await run2(crlf, n), base, `crlf ${n}`);
  async function run2(t, n) {
    return collect(mk(() => streamResponse(splitAt(t, n))).p.stream(req));
  }
});

test("anthropic: max_tokens, error events and truncation", async () => {
  const mt = an("message_start", { message: { usage: { input_tokens: 1 } } }) + an("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + an("content_block_delta", { index: 0, delta: { type: "text_delta", text: "x" } }) + an("message_delta", { delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 3 } }) + an("message_stop", {});
  const ev = await collect(mk(() => streamResponse([mt])).p.stream(req));
  assert.equal(ev.at(-1).stopReason, "max_tokens");
  const err = an("message_start", { message: { usage: { input_tokens: 1 } } }) + an("error", { error: { type: "overloaded_error", message: "Overloaded" } });
  await assert.rejects(collect(mk(() => streamResponse([err])).p.stream(req)), (e) => e instanceof ProviderError && e.status === 529 && e.retryable && e.message === "Overloaded");
  await assert.rejects(collect(mk(() => streamResponse([an("message_start", { message: {} })])).p.stream(req)), (e) => e.code === "stream_truncated");
});

test("anthropic: HTTP errors", async () => {
  const r429 = mk(() => jsonResponse({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, { status: 429, headers: { "retry-after": "7" } }));
  await assert.rejects(collect(r429.p.stream(req)), (e) => e.status === 429 && e.retryable && e.retryAfterMs === 7000 && e.code === "rate_limit_error");
  const r400 = mk(() => jsonResponse({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, { status: 400 }));
  await assert.rejects(collect(r400.p.stream(req)), (e) => e.status === 400 && !e.retryable);
  const r529 = mk(() => jsonResponse({ type: "error", error: { type: "overloaded_error", message: "o" } }, { status: 529 }));
  await assert.rejects(collect(r529.p.stream(req)), (e) => e.retryable);
});

test("anthropic: cache hints, thinking budget, tool choice", async () => {
  const { p, f } = mk(() => streamResponse([an("message_start", { message: {} }) + an("message_delta", { delta: { stop_reason: "end_turn" }, usage: {} }) + an("message_stop", {})]), { cache: true });
  const tools = [{ name: "a", description: "", inputSchema: { type: "object" } }, { name: "b", description: "", inputSchema: { type: "object" } }];
  await collect(p.stream({ ...req, system: "S", tools, reasoning: { effort: "medium" }, temperature: 0.5, toolChoice: { name: "a" } }));
  const j = f.calls[0].json;
  assert.deepEqual(j.system, [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }]);
  assert.equal(j.tools[0].cache_control, undefined);
  assert.deepEqual(j.tools[1].cache_control, { type: "ephemeral" });
  assert.deepEqual(j.thinking, { type: "enabled", budget_tokens: 8192 });
  assert.ok(j.max_tokens > 8192);
  assert.equal(j.temperature, undefined);
  assert.equal(j.tool_choice, undefined, "forced tool choice is dropped while thinking");
  await collect(p.stream({ ...req, tools, toolChoice: { name: "a" }, maxTokens: 100, temperature: 0.1 }));
  const j2 = f.calls[1].json;
  assert.deepEqual(j2.tool_choice, { type: "tool", name: "a" });
  assert.equal(j2.thinking, undefined);
  assert.equal(j2.temperature, 0.1);
  await collect(p.stream({ ...req, maxTokens: 1500, reasoning: { effort: "high" } }));
  assert.equal(f.calls[2].json.thinking, undefined, "budget below the 1024 minimum disables thinking");
});

test("anthropic: message translation (images, tool results, thinking round trip)", () => {
  const m = toAnthropicMessages([
    { role: "user", content: [{ type: "text", text: "see" }, { type: "image", mime: "image/png", data: "QUJD" }] },
    { role: "assistant", content: [{ type: "thinking", text: "hm", signature: "S" }, { type: "thinking", text: "unsigned" }, { type: "text", text: "" }, { type: "tool_use", id: "t1", name: "x", input: { a: 1 } }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: [{ type: "text", text: "ok" }, { type: "image", mime: "image/jpeg", data: "WFla" }] }, { type: "tool_result", toolUseId: "t2", content: "bad", isError: true }] },
    { role: "assistant", content: [] },
  ]);
  assert.deepEqual(m[0].content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } });
  assert.deepEqual(m[1].content, [{ type: "thinking", thinking: "hm", signature: "S" }, { type: "tool_use", id: "t1", name: "x", input: { a: 1 } }]);
  assert.deepEqual(m[2].content[0], { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "ok" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "WFla" } }] });
  assert.deepEqual(m[2].content[1], { type: "tool_result", tool_use_id: "t2", content: "bad", is_error: true });
  assert.equal(m.length, 3, "empty assistant message is dropped");
});

test("anthropic: listModels paginates; embed/images unsupported", async () => {
  const f = fakeFetch((c) =>
    c.url.includes("after_id=b") ? jsonResponse({ data: [{ id: "c", display_name: "C" }], has_more: false, last_id: "c" }) : jsonResponse({ data: [{ id: "a", display_name: "A", max_input_tokens: 200000 }, { id: "b", display_name: "B" }], has_more: true, last_id: "b" }),
  );
  const p = createAnthropicProvider({ apiKey: "k", fetch: f, baseUrl: "https://proxy.test/" });
  const m = await p.listModels();
  assert.deepEqual(m.map((x) => x.id), ["a", "b", "c"]);
  assert.equal(m[0].contextWindow, 200000);
  assert.ok(f.calls[0].url.startsWith("https://proxy.test/v1/models?limit=100"));
  await assert.rejects(p.embed(["x"], {}), (e) => e.code === "unsupported");
  await assert.rejects(p.generateImage({}), (e) => e.code === "unsupported");
});

test("providers: createProvider and presets", () => {
  assert.ok(PROVIDER_PRESETS.length >= 12);
  const ids = PROVIDER_PRESETS.map((p) => p.id);
  for (const id of ["openrouter", "openai", "anthropic", "deepseek", "xai", "groq", "together", "mistral", "google-gemini", "ollama", "lmstudio", "custom"]) assert.ok(ids.includes(id), id);
  assert.equal(PROVIDER_PRESETS.find((p) => p.id === "ollama").needsKey, false);
  assert.equal(PROVIDER_PRESETS.find((p) => p.id === "openrouter").baseUrl, "https://openrouter.ai/api/v1");
  for (const p of PROVIDER_PRESETS) {
    assert.ok(["openai", "anthropic"].includes(p.kind));
    assert.ok(p.capabilities && "vision" in p.capabilities && "tools" in p.capabilities && "images" in p.capabilities && "embeddings" in p.capabilities);
    assert.ok(Array.isArray(p.models) && typeof p.note === "string");
  }
  assert.equal(createProvider({ kind: "anthropic", apiKey: "k" }).kind, "anthropic");
  assert.equal(createProvider({ preset: "groq", apiKey: "k" }).baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(createProvider({ kind: "mock" }).kind, "mock");
  assert.throws(() => createProvider({ kind: "nope" }));
  assert.throws(() => createProvider({ preset: "nope" }));
});
