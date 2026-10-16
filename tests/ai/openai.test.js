import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAIProvider, toWireMessages, fromWireMessages, ProviderError } from "../../app/src/ai/providers/openai.js";
import { parseSse, parseJsonLenient, createSseParser } from "../../app/src/ai/util.js";
import { streamResponse, splitAt, jsonResponse, fakeFetch, collect, oa, chunk } from "./helpers.js";

const FIXTURE = [
  chunk({ role: "assistant", content: "" }),
  ": OPENROUTER PROCESSING\n\n",
  chunk({ content: "Hel" }),
  chunk({ content: "lo ✓ wörld \u{1f600}" }),
  chunk({ reasoning_content: "think" }),
  chunk({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "add_shape", arguments: "" } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: '{"type":"re' } }] }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: 'ct","x":10}' } }] }),
  chunk({ tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "screenshot", arguments: "{}" } }] }),
  chunk({}, "tool_calls"),
  oa({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 4 } } }),
  "data: [DONE]\n\n",
].join("");

function mk(body, extra = {}) {
  const f = fakeFetch(() => (typeof body === "function" ? body() : body));
  return { f, p: createOpenAIProvider({ baseUrl: "https://example.test/v1/", apiKey: "k", fetch: f, ...extra }) };
}
const req = { model: "m", messages: [{ role: "user", content: "hi" }] };

test("openai: parses text, thinking, fragmented tool calls, usage", async () => {
  const { p, f } = mk(() => streamResponse([FIXTURE]));
  const ev = await collect(p.stream({ ...req, system: "sys", maxTokens: 100, temperature: 0.2, tools: [{ name: "t", description: "d", inputSchema: { type: "object" } }], toolChoice: { name: "t" } }));
  assert.deepEqual(
    ev.map((e) => e.type),
    ["text", "text", "thinking", "tool_call", "tool_call", "usage", "done"],
  );
  assert.equal(ev[0].delta, "Hel");
  assert.deepEqual(ev[3], { type: "tool_call", id: "call_a", name: "add_shape", input: { type: "rect", x: 10 } });
  assert.deepEqual(ev[4].input, {});
  assert.deepEqual(ev[5], { type: "usage", input: 12, output: 7, cachedInput: 4 });
  const done = ev[6];
  assert.equal(done.stopReason, "tool_use");
  assert.deepEqual(
    done.message.content.map((b) => b.type),
    ["thinking", "text", "tool_use", "tool_use"],
  );
  assert.equal(done.message.content[1].text, "Hello ✓ wörld \u{1f600}");
  const c = f.calls[0];
  assert.equal(c.url, "https://example.test/v1/chat/completions");
  assert.equal(c.headers.Authorization, "Bearer k");
  assert.equal(c.json.stream, true);
  assert.deepEqual(c.json.stream_options, { include_usage: true });
  assert.equal(c.json.max_tokens, 100);
  assert.deepEqual(c.json.tool_choice, { type: "function", function: { name: "t" } });
  assert.equal(c.json.tools[0].function.name, "t");
  assert.deepEqual(c.json.messages[0], { role: "system", content: "sys" });
});

test("openai: SSE split at every byte offset (LF and CRLF) gives identical events", async () => {
  const run = async (text, n) => {
    const { p } = mk(() => streamResponse(splitAt(text, n)));
    return collect(p.stream(req));
  };
  const base = await run(FIXTURE, 0);
  const len = new TextEncoder().encode(FIXTURE).length;
  for (let n = 1; n < len; n++) assert.deepEqual(await run(FIXTURE, n), base, `offset ${n}`);
  const crlf = FIXTURE.replace(/\n/g, "\r\n");
  const len2 = new TextEncoder().encode(crlf).length;
  for (let n = 0; n < len2; n += 1) assert.deepEqual(await run(crlf, n), base, `crlf offset ${n}`);
});

test("openai: one-byte chunks", async () => {
  const bytes = new TextEncoder().encode(FIXTURE);
  const { p } = mk(() => streamResponse(Array.from(bytes, (b) => new Uint8Array([b]))));
  const ev = await collect(p.stream(req));
  assert.equal(ev.at(-1).stopReason, "tool_use");
});

test("sse parser: comments, multi-line data, CR, missing final blank line", async () => {
  const sp = createSseParser();
  const out = [...sp.push(": hi\r\ndata: a\r\ndata: b\r\n\r\nevent: x\rdata: c\r\r"), ...sp.push("data: tail")];
  out.push(...sp.flush());
  assert.deepEqual(out, [
    { event: "message", data: "a\nb" },
    { event: "x", data: "c" },
    { event: "message", data: "tail" },
  ]);
  const evs = await collect(parseSse(streamResponse(["data: 1\n\ndata: 2\n\n"])));
  assert.equal(evs.length, 2);
});

test("openai: repairs truncated tool args and flags invalid ones", async () => {
  const body =
    chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "t", arguments: '{"a":1,"b":"unfinis' } }] }) +
    chunk({ tool_calls: [{ index: 1, id: "b", function: { name: "u", arguments: "this is not json" } }] }) +
    chunk({}, "length") +
    "data: [DONE]\n\n";
  const { p } = mk(() => streamResponse([body]));
  const ev = await collect(p.stream(req));
  const calls = ev.filter((e) => e.type === "tool_call");
  assert.deepEqual(calls[0].input, { a: 1, b: "unfinis" });
  assert.equal(calls[0].repaired, true);
  assert.deepEqual(calls[1].input, {});
  assert.ok(calls[1].error);
  assert.equal(ev.at(-1).stopReason, "max_tokens");
});

test("parseJsonLenient repair cases", () => {
  assert.deepEqual(parseJsonLenient('{"a":[1,2').value, { a: [1, 2] });
  assert.deepEqual(parseJsonLenient('{"a":1,').value, { a: 1 });
  assert.deepEqual(parseJsonLenient('{"a":1,"b"').value, { a: 1 });
  assert.deepEqual(parseJsonLenient('{"a":1,"b":').value, { a: 1, b: null });
  assert.deepEqual(parseJsonLenient('```json\n{"a":1}\n```').value, { a: 1 });
  assert.deepEqual(parseJsonLenient("").value, {});
  assert.equal(parseJsonLenient("nope").ok, false);
});

test("openai: tool_calls without index/id, id reuse, stop with tool calls", async () => {
  const body =
    chunk({ tool_calls: [{ id: "x1", function: { name: "a", arguments: '{"k":' } }] }) +
    chunk({ tool_calls: [{ function: { arguments: "1}" } }] }) +
    chunk({ tool_calls: [{ id: "x2", function: { name: "b", arguments: "{}" } }] }) +
    chunk({}, "stop") +
    "data: [DONE]\n\n";
  const { p } = mk(() => streamResponse([body]));
  const ev = await collect(p.stream(req));
  const calls = ev.filter((e) => e.type === "tool_call");
  assert.deepEqual(calls.map((c) => [c.id, c.name, c.input]), [["x1", "a", { k: 1 }], ["x2", "b", {}]]);
  assert.equal(ev.at(-1).stopReason, "tool_use");
});

test("openai: non-streaming JSON reply is accepted", async () => {
  const { p } = mk(() => jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "plain" } }], usage: { prompt_tokens: 1, completion_tokens: 2 } }));
  const ev = await collect(p.stream(req));
  assert.equal(ev.at(-1).message.content[0].text, "plain");
});

test("openai: errors map to ProviderError", async () => {
  const cases = [
    [{ status: 429, body: { error: { message: "Rate limit", type: "rate_limit_error", code: "rate_limit_exceeded" } }, headers: { "retry-after": "2" } }, { status: 429, retryable: true, retryAfterMs: 2000, code: "rate_limit_exceeded" }],
    [{ status: 429, body: { error: { message: "quota", type: "insufficient_quota", code: "insufficient_quota" } } }, { status: 429, retryable: false }],
    [{ status: 401, body: { error: { message: "Bad key", type: "authentication_error", code: "invalid_api_key" } } }, { status: 401, retryable: false }],
    [{ status: 402, body: { error: { message: "Insufficient Balance", type: "unknown_error" } } }, { status: 402, retryable: false }],
    [{ status: 502, body: { error: { message: "Provider returned error", code: 502, metadata: { raw: "upstream down", provider_name: "X" } } } }, { status: 502, retryable: true }],
    [{ status: 503, text: "<html>Service unavailable</html>" }, { status: 503, retryable: true }],
    [{ status: 400, body: { error: { message: "bad param", type: "invalid_request_error" } } }, { status: 400, retryable: false }],
  ];
  for (const [resp, want] of cases) {
    const { p } = mk(() =>
      resp.text !== undefined
        ? new Response(resp.text, { status: resp.status })
        : jsonResponse(resp.body, { status: resp.status, headers: resp.headers || {} }),
    );
    await assert.rejects(collect(p.stream(req)), (e) => {
      assert.ok(e instanceof ProviderError);
      for (const [k, v] of Object.entries(want)) assert.equal(e[k], v, `${k} for ${resp.status}`);
      assert.ok(e.message.length > 0);
      return true;
    });
  }
});

test("openai: network error and mid-stream error and truncation", async () => {
  const net = createOpenAIProvider({ baseUrl: "http://x/v1", fetch: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(collect(net.stream(req)), (e) => e.code === "network_error" && e.retryable === true);
  const mid = mk(() => streamResponse([chunk({ content: "a" }) + oa({ error: { message: "overloaded", code: 529 } })]));
  await assert.rejects(collect(mid.p.stream(req)), (e) => e.status === 529 && e.retryable);
  const cut = mk(() => streamResponse([chunk({ content: "a" })]));
  await assert.rejects(collect(cut.p.stream(req)), (e) => e.code === "stream_truncated" && e.retryable);
});

test("openai: abort mid-stream", async () => {
  const ctl = new AbortController();
  let release;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(chunk({ content: "a" })));
      release = () => c.close();
    },
  });
  const f = fakeFetch(() => new Response(body, { headers: { "content-type": "text/event-stream" } }));
  const p = createOpenAIProvider({ baseUrl: "http://x/v1", fetch: f });
  const got = [];
  const run = (async () => {
    for await (const e of p.stream(req, { signal: ctl.signal })) {
      got.push(e);
      if (e.type === "text") setTimeout(() => ctl.abort(), 5);
    }
  })();
  await assert.rejects(run, (e) => e.name === "AbortError");
  assert.equal(got.length, 1);
  try {
    release();
  } catch {
    /* stream was cancelled by the abort */
  }
});

test("openai: reasoning and max tokens parameter styles", async () => {
  const a = mk(() => streamResponse([chunk({}, "stop")]), { baseUrl: "https://openrouter.ai/api/v1" });
  await collect(a.p.stream({ ...req, reasoning: { effort: "high" }, maxTokens: 5 }));
  assert.deepEqual(a.f.calls[0].json.reasoning, { effort: "high" });
  assert.equal(a.f.calls[0].json.max_tokens, 5);
  const b = mk(() => streamResponse([chunk({}, "stop")]), { baseUrl: "https://api.openai.com/v1" });
  await collect(b.p.stream({ ...req, reasoning: { effort: "low" }, maxTokens: 5 }));
  assert.equal(b.f.calls[0].json.reasoning_effort, "low");
  assert.equal(b.f.calls[0].json.max_completion_tokens, 5);
});

test("openai wire translation: round trip and tool-result images", () => {
  const neutral = [
    { role: "user", content: "draw" },
    { role: "assistant", content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "c1", name: "add_shape", input: { x: 1 } }, { type: "tool_use", id: "c2", name: "screenshot", input: {} }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "c1", content: "done" }, { type: "tool_result", toolUseId: "c2", content: "shot" }] },
    { role: "assistant", content: "looks good" },
    { role: "user", content: [{ type: "text", text: "see" }, { type: "image", mime: "image/png", data: "QUJD" }] },
  ];
  const wire = toWireMessages("SYS", neutral);
  assert.equal(wire[0].role, "system");
  assert.deepEqual(wire[2].tool_calls[0], { id: "c1", type: "function", function: { name: "add_shape", arguments: '{"x":1}' } });
  assert.deepEqual(wire.slice(3, 5).map((m) => m.role), ["tool", "tool"]);
  assert.equal(wire.at(-1).content[1].image_url.url, "data:image/png;base64,QUJD");
  const back = fromWireMessages(wire);
  assert.equal(back.system, "SYS");
  assert.deepEqual(back.messages, neutral);

  const w2 = toWireMessages(undefined, [
    { role: "assistant", content: [{ type: "tool_use", id: "z", name: "screenshot", input: {} }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "z", isError: true, content: [{ type: "text", text: "boom" }, { type: "image", mime: "image/jpeg", data: "WFla" }] }] },
  ]);
  assert.equal(w2[0].content, null);
  assert.deepEqual(w2[1], { role: "tool", tool_call_id: "z", content: "Error: boom" });
  assert.equal(w2[2].role, "user");
  assert.equal(w2[2].content[1].image_url.url, "data:image/jpeg;base64,WFla");
});

test("openai: listModels handles OpenRouter metadata and odd shapes", async () => {
  const { p } = mk(() =>
    jsonResponse({
      data: [
        { id: "anthropic/claude-x", name: "Claude X", context_length: 200000, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, supported_parameters: ["tools", "temperature"], pricing: { prompt: "0.000003", completion: "0.000015" } },
        { id: "models/gemini-2.5-pro" },
        { id: "text-only", architecture: { input_modalities: ["text"] }, supported_parameters: ["temperature"] },
        { nothing: true },
        null,
        "bare-string",
      ],
    }),
  );
  const m = await p.listModels();
  assert.deepEqual(m[0], { id: "anthropic/claude-x", name: "Claude X", contextWindow: 200000, vision: true, tools: true, pricing: { promptPerM: 3, completionPerM: 15 } });
  assert.equal(m[1].id, "gemini-2.5-pro");
  assert.equal(m[2].vision, false);
  assert.equal(m[2].tools, false);
  assert.deepEqual(m.map((x) => x.id), ["anthropic/claude-x", "gemini-2.5-pro", "text-only", "bare-string"]);
  const arr = mk(() => jsonResponse([{ id: "a" }]));
  assert.equal((await arr.p.listModels())[0].id, "a");
  const bad = mk(() => new Response("not json"));
  assert.deepEqual(await bad.p.listModels(), []);
});

test("openai: embed batches of 96 and keeps order", async () => {
  const f = fakeFetch((c) => jsonResponse({ data: c.json.input.map((t, i) => ({ index: i, embedding: [Number(t)] })).reverse() }));
  const p = createOpenAIProvider({ baseUrl: "http://x/v1", fetch: f });
  const texts = Array.from({ length: 200 }, (_, i) => String(i));
  const v = await p.embed(texts, { model: "e" });
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.map((c) => c.json.input.length), [96, 96, 8]);
  assert.deepEqual(v.map((x) => x[0]), texts.map(Number));
});

test("openai: generateImage via images API, edits (multipart), URL results, and chat modalities", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUg==";
  const f1 = fakeFetch(() => jsonResponse({ data: [{ b64_json: png }] }));
  const p1 = createOpenAIProvider({ baseUrl: "http://x/v1", fetch: f1 });
  const r1 = await p1.generateImage({ prompt: "cat", model: "gpt-image-1", size: "1024x1024", n: 1, background: "transparent" });
  assert.deepEqual(r1, [{ mime: "image/png", data: png }]);
  assert.equal(f1.calls[0].url, "http://x/v1/images/generations");
  assert.equal(f1.calls[0].json.response_format, undefined);
  assert.equal(f1.calls[0].json.background, "transparent");

  const f2 = fakeFetch(() => jsonResponse({ data: [{ b64_json: png }] }));
  const p2 = createOpenAIProvider({ baseUrl: "http://x/v1", fetch: f2 });
  await p2.generateImage({ prompt: "edit", model: "gpt-image-1", image: { mime: "image/png", data: png }, mask: { mime: "image/png", data: png } });
  assert.equal(f2.calls[0].url, "http://x/v1/images/edits");
  const form = f2.calls[0].init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("prompt"), "edit");
  assert.ok(form.get("image") instanceof Blob && form.get("mask") instanceof Blob);
  assert.equal(f2.calls[0].headers["Content-Type"], undefined);

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const f3 = fakeFetch((c) => (c.url.endsWith("/generations") ? jsonResponse({ data: [{ url: "https://cdn.test/a.jpg" }] }) : new Response(jpeg, { headers: { "content-type": "image/jpeg" } })));
  const p3 = createOpenAIProvider({ baseUrl: "http://x/v1", apiKey: "secret", fetch: f3 });
  const r3 = await p3.generateImage({ prompt: "x", model: "dall-e-3" });
  assert.equal(r3[0].mime, "image/jpeg");
  assert.equal(f3.calls[0].json.response_format, "b64_json");
  assert.equal(f3.calls[1].headers.Authorization, undefined, "CDN fetch must not carry the API key");

  const f4 = fakeFetch(() => jsonResponse({ choices: [{ message: { content: "here", images: [{ type: "image_url", image_url: { url: `data:image/webp;base64,UklGRg==` } }] } }] }));
  const p4 = createOpenAIProvider({ baseUrl: "http://x/v1", fetch: f4, imageApi: "chat" });
  const r4 = await p4.generateImage({ prompt: "logo", model: "google/gemini-2.5-flash-image" });
  assert.deepEqual(r4, [{ mime: "image/webp", data: "UklGRg==" }]);
  assert.deepEqual(f4.calls[0].json.modalities, ["image", "text"]);
  assert.equal(f4.calls[0].url, "http://x/v1/chat/completions");
  await assert.rejects(createOpenAIProvider({ baseUrl: "http://x/v1", fetch: async () => jsonResponse({ choices: [{ message: { content: "no" } }] }), imageApi: "chat" }).generateImage({ prompt: "x", model: "m" }), /no image/i);
});
