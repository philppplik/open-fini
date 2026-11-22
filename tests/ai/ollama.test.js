import test from "node:test";
import assert from "node:assert/strict";
import { createOllamaProvider, parseShow, mergeModels, normalizeBase, isCloudModel, testOllama, detectOllama, originFixes, toOllamaMessages, parseNdjson, versionAtLeast, describeModel } from "../../app/src/ai/providers/ollama.js";
import { createOllamaFetch, isNativeOllamaUrl } from "../../app/src/ai/ollama-transport.js";
import { createProvider, PROVIDER_PRESETS } from "../../app/src/ai/providers/index.js";
import { resetLocalBackoff } from "../../app/src/ai/util.js";
import { collect, fakeFetch, jsonResponse, streamResponse } from "./helpers.js";

const SHOW = { capabilities: ["completion", "tools", "vision"], details: { family: "llama", parameter_size: "8B", quantization_level: "Q4_K_M" }, model_info: { "llama.context_length": 131072 } };
const ND = (...o) => o.map((x) => JSON.stringify(x) + "\n").join("");

test("presets use the native kind and base URLs are normalized", () => {
  assert.equal(PROVIDER_PRESETS.find((p) => p.id === "ollama").kind, "ollama");
  assert.equal(PROVIDER_PRESETS.find((p) => p.id === "ollama-cloud").needsKey, true);
  assert.equal(createProvider({ preset: "ollama" }).kind, "ollama");
  assert.equal(normalizeBase("http://localhost:11434/v1/"), "http://localhost:11434");
  assert.equal(normalizeBase(" http://127.0.0.1:11434/api "), "http://127.0.0.1:11434");
  assert.ok(isCloudModel("gpt-oss:120b-cloud") && isCloudModel("qwen3-coder:480b-cloud") && isCloudModel("x:cloud") && !isCloudModel("llama3.2:3b"));
  assert.ok(versionAtLeast("0.40.16", "0.3.0") && !versionAtLeast("0.2.9", "0.3.0"));
});

test("capabilities are read from /api/show, with a guess for old servers", () => {
  const c = parseShow(SHOW);
  assert.deepEqual([c.tools, c.vision, c.thinking, c.contextWindow, c.family, c.quantization, c.parameterSize], [true, true, false, 131072, "llama", "Q4_K_M", "8B"]);
  assert.equal(parseShow({ capabilities: ["completion", "thinking"] }).tools, false);
  assert.equal(parseShow({ capabilities: ["embedding"] }).embedding, true);
  const old = parseShow({ details: { families: ["llama", "clip"] }, model_info: { "x.context_length": 4096 } });
  assert.equal(old.vision, true);
  assert.equal(old.tools, undefined);
  assert.equal(old.contextWindow, 4096);
});

test("model list merges tags, ps and show; cloud models sort last", () => {
  const list = mergeModels(
    { models: [{ name: "gpt-oss:120b-cloud", size: 0 }, { name: "b:7b", size: 4.7e9, details: { family: "qwen" } }, { name: "a:1b", size: 7e8 }] },
    { models: [{ name: "b:7b", context_length: 8192 }] },
    { "b:7b": parseShow(SHOW) },
  );
  assert.deepEqual(list.map((m) => m.id), ["b:7b", "a:1b", "gpt-oss:120b-cloud"]);
  assert.equal(list[0].loaded, true);
  assert.equal(list[0].tools, true);
  assert.equal(list[2].cloud, true);
  assert.match(describeModel(list[0]), /8B · Q4_K_M · 4\.7 GB · tools · vision · 128K ctx · loaded/);
});

test("listModels calls tags, ps and show once per model (cached)", async () => {
  const f = fakeFetch((c) => {
    if (c.url.endsWith("/api/tags")) return jsonResponse({ models: [{ name: "m1" }, { name: "m2:cloud" }] });
    if (c.url.endsWith("/api/ps")) return jsonResponse({ models: [] });
    if (c.url.endsWith("/api/show")) return jsonResponse(SHOW);
    return jsonResponse({}, { status: 404 });
  });
  const p = createOllamaProvider({ baseUrl: "http://localhost:11434/v1", fetch: f });
  const a = await p.listModels();
  await p.listModels();
  assert.equal(a.length, 2);
  assert.equal(a[1].cloud, true);
  assert.equal(f.calls.filter((c) => c.url.endsWith("/api/show")).length, 2);
  assert.ok(f.calls.every((c) => c.url.startsWith("http://localhost:11434/api/")));
});

test("NDJSON in split chunks, even in the middle of a character", async () => {
  const bytes = new TextEncoder().encode(ND({ a: "é" }, { b: 2 }));
  const out = await collect(parseNdjson(streamResponse([bytes.slice(0, 7), bytes.slice(7, 9), bytes.slice(9)])));
  assert.deepEqual(out, [{ a: "é" }, { b: 2 }]);
});

test("chat streams text, thinking, tool calls and usage; sends capped num_ctx and only supported features", async () => {
  const all = ND({ message: { role: "assistant", thinking: "hm" } }, { message: { content: "Hel" } }) + ND({ message: { content: "lo", tool_calls: [{ function: { name: "get_time", arguments: { tz: "UTC" } } }] } }, { done: true, done_reason: "stop", prompt_eval_count: 12, eval_count: 5 });
  const f = fakeFetch((c) => {
    if (c.url.endsWith("/api/show")) return jsonResponse({ ...SHOW, capabilities: ["completion", "tools", "thinking"] });
    return streamResponse([all.slice(0, 40), all.slice(40)], { headers: { "content-type": "application/x-ndjson" } });
  });
  const p = createOllamaProvider({ baseUrl: "http://127.0.0.1:11434", fetch: f, keepAlive: "10m" });
  const ev = await collect(p.stream({ model: "m", system: "S", messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image", mime: "image/png", data: "QUJD" }] }], tools: [{ name: "get_time", description: "d", inputSchema: { type: "object", properties: {} } }], reasoning: { effort: "high" } }));
  const body = f.calls.find((c) => c.url.endsWith("/api/chat")).json;
  assert.equal(body.options.num_ctx, 32768);
  assert.equal(body.keep_alive, "10m");
  assert.equal(body.think, true);
  assert.equal(body.tools[0].function.name, "get_time");
  assert.equal(body.messages[1].images, undefined); // no vision capability: images are not sent
  assert.match(body.messages[1].content, /cannot read images/);
  assert.deepEqual(ev.filter((e) => e.type === "thinking").map((e) => e.delta), ["hm"]);
  assert.equal(ev.filter((e) => e.type === "text").map((e) => e.delta).join(""), "Hello");
  const tc = ev.find((e) => e.type === "tool_call");
  assert.deepEqual([tc.name, tc.input], ["get_time", { tz: "UTC" }]);
  assert.deepEqual(ev.find((e) => e.type === "usage"), { type: "usage", input: 12, output: 5 });
  const done = ev.at(-1);
  assert.equal(done.stopReason, "tool_use");
  assert.deepEqual(done.message.content.map((b) => b.type), ["thinking", "text", "tool_use"]);
});

test("tools are not sent to models without tool support; images are sent to vision models", async () => {
  const f = fakeFetch((c) => (c.url.endsWith("/api/show") ? jsonResponse({ capabilities: ["completion", "vision"] }) : streamResponse([ND({ message: { content: "ok" }, done: true })])));
  const p = createOllamaProvider({ baseUrl: "http://localhost:11434", fetch: f });
  await collect(p.stream({ model: "v", messages: [{ role: "user", content: [{ type: "image", mime: "image/png", data: "QUJD" }, { type: "text", text: "what" }] }], tools: [{ name: "t" }] }));
  const body = f.calls.find((c) => c.url.endsWith("/api/chat")).json;
  assert.equal(body.tools, undefined);
  assert.deepEqual(body.messages[0].images, ["QUJD"]);
  assert.equal(body.options.num_ctx, 8192);
});

test("tool results carry the tool name and a truncated stream is an error", async () => {
  const m = toOllamaMessages("sys", [
    { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "lookup", input: { q: 1 } }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "c1", content: "42" }] },
  ]);
  assert.deepEqual(m[1].tool_calls, [{ function: { name: "lookup", arguments: { q: 1 } } }]);
  assert.deepEqual(m[2], { role: "tool", tool_name: "lookup", content: "42" });
  const f = fakeFetch((c) => (c.url.endsWith("/api/show") ? jsonResponse(SHOW) : streamResponse([ND({ message: { content: "partial" } })])));
  await assert.rejects(collect(createOllamaProvider({ baseUrl: "http://localhost:11434", fetch: f }).stream({ model: "m", messages: [{ role: "user", content: "x" }] })), { code: "stream_truncated" });
});

test("errors: missing model offers a pull, cloud needs sign-in, mid-stream errors are mapped", async () => {
  resetLocalBackoff();
  const notFound = fakeFetch(() => jsonResponse({ error: "model 'zz' not found" }, { status: 404 }));
  const p = createOllamaProvider({ baseUrl: "http://localhost:11434", fetch: notFound });
  await assert.rejects(collect(p.stream({ model: "zz", messages: [{ role: "user", content: "x" }] })), (e) => e.code === "model_not_found" && e.pullable === true && /ollama pull zz/.test(e.message));
  const unauth = fakeFetch((c) => (c.url.endsWith("/api/show") ? jsonResponse(SHOW) : jsonResponse({ error: "unauthorized" }, { status: 401 })));
  await assert.rejects(collect(createOllamaProvider({ baseUrl: "http://localhost:11434", fetch: unauth }).stream({ model: "gpt-oss:120b-cloud", messages: [{ role: "user", content: "x" }] })), (e) => e.code === "unauthorized" && /ollama signin/.test(e.message));
  const mid = fakeFetch((c) => (c.url.endsWith("/api/show") ? jsonResponse(SHOW) : streamResponse([ND({ error: "model requires more system memory (9 GiB) than is available" })])));
  await assert.rejects(collect(createOllamaProvider({ baseUrl: "http://localhost:11434", fetch: mid }).stream({ model: "big", messages: [{ role: "user", content: "x" }] })), { code: "out_of_memory" });
});

test("pull reports progress and the cloud key is sent as a bearer token", async () => {
  const f = fakeFetch(() => streamResponse([ND({ status: "pulling abc", total: 100, completed: 25 }), ND({ status: "pulling abc", total: 100, completed: 100 }, { status: "success" })]));
  const seen = [];
  await createOllamaProvider({ baseUrl: "https://ollama.com", apiKey: "k1", fetch: f }).pull("llama3.2", { onProgress: (p) => seen.push(p.fraction) });
  assert.deepEqual(seen, [0.25, 1, null]);
  assert.equal(f.calls[0].headers.Authorization, "Bearer k1");
  assert.equal(f.calls[0].url, "https://ollama.com/api/pull");
});

test("connection test: ok, down, blocked origin, mixed content, old, not Ollama", async () => {
  const ok = fakeFetch(() => jsonResponse({ version: "0.12.3" }));
  assert.equal((await testOllama({ base: "http://localhost:11434/v1", fetch: ok, page: {} })).status, "ok");
  const down = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.equal((await testOllama({ base: "http://localhost:11434", fetch: down, page: {} })).status, "down");
  // a browser: the no-cors probe reaches the server, the CORS fetch does not
  const cors = async (url, init) => {
    if (init?.mode === "no-cors") return { type: "opaque" };
    throw new TypeError("Failed to fetch");
  };
  try {
    const r = await testOllama({ base: "http://localhost:11434", fetch: cors, page: { origin: "https://app.example", protocol: "https:" } });
    assert.equal(r.status, "origin-blocked");
    assert.equal(r.origin, "https://app.example");
    assert.match(originFixes(r.origin).windows.command, /setx OLLAMA_ORIGINS "https:\/\/app\.example"/);
    // the desktop app has no browser origin problem and never probes
    assert.equal((await testOllama({ base: "http://localhost:11434", fetch: down, page: {}, desktop: true })).status, "down");
  } finally {
  }
  assert.equal((await testOllama({ base: "http://192.168.1.5:11434", fetch: ok, page: { protocol: "https:" } })).status, "mixed-content");
  assert.equal((await testOllama({ base: "http://localhost:11434", fetch: fakeFetch(() => jsonResponse({}, { status: 403 })), page: { origin: "o" } })).status, "origin-blocked");
  assert.equal((await testOllama({ base: "http://localhost:11434", fetch: fakeFetch(() => jsonResponse({ version: "0.2.0" })), page: {} })).status, "old");
  assert.equal((await testOllama({ base: "http://localhost:11434", fetch: fakeFetch(() => jsonResponse({ hello: 1 })), page: {} })).status, "error");
  assert.equal((await testOllama({ base: "~/.ollama/models", fetch: ok, page: {} })).status, "error");
});

test("auto-detect tries 127.0.0.1, then localhost", async () => {
  const f = fakeFetch((c) => {
    if (c.url.startsWith("http://localhost:11434")) return jsonResponse({ version: "0.9.0" });
    throw new TypeError("Failed to fetch");
  });
  const r = await detectOllama({ fetch: f, page: {}, desktop: true });
  assert.deepEqual([r.status, r.base], ["ok", "http://localhost:11434"]);
  assert.deepEqual(f.calls.map((c) => c.url), ["http://127.0.0.1:11434/api/version", "http://localhost:11434/api/version"]);
});

test("transport: native hosts, streaming from a fake Tauri core, abort", async () => {
  assert.ok(isNativeOllamaUrl("http://127.0.0.1:11434/api/tags") && isNativeOllamaUrl("http://[::1]:11434/api/tags") && isNativeOllamaUrl("http://192.168.0.4:11434/api/tags") && isNativeOllamaUrl("https://ollama.com/api/tags") && isNativeOllamaUrl("http://my-nas:11434/api/tags"));
  assert.ok(!isNativeOllamaUrl("https://api.openai.com/v1") && !isNativeOllamaUrl("http://ollama.com/api") && !isNativeOllamaUrl("http://example.org:11434"));
  const calls = [];
  class Channel {}
  const core = {
    Channel,
    invoke: async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "ollama_fetch") {
        args.onEvent.onmessage({ type: "head", status: 200, contentType: "application/x-ndjson" });
        args.onEvent.onmessage({ type: "chunk", data: Buffer.from('{"a":1}\n{"b"').toString("base64") });
        args.onEvent.onmessage({ type: "chunk", data: Buffer.from(":2}\n").toString("base64") });
        args.onEvent.onmessage({ type: "end" });
      }
    },
  };
  const f = createOllamaFetch({ core, fetch: () => assert.fail("web fetch must not be used") });
  const res = await f("http://localhost:11434/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(res.status, 200);
  assert.deepEqual(await collect(parseNdjson(res)), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(calls[0][1].request.headers, [["Content-Type", "application/json"]]);
  assert.equal(f.native, true);
  // other hosts use the page's fetch
  let used = false;
  await createOllamaFetch({ core, fetch: async () => ((used = true), jsonResponse({})) })("https://example.org/api/x");
  assert.ok(used);
  // abort before the head cancels the native job
  const ctl = new AbortController();
  const slow = createOllamaFetch({ core: { Channel, invoke: (cmd) => (cmd === "net_cancel" ? Promise.resolve() : new Promise(() => {})) } });
  const pending = slow("http://localhost:11434/api/chat", { signal: ctl.signal });
  ctl.abort();
  await assert.rejects(pending, (e) => e.name === "AbortError");
  // a refusal from the native side becomes a network error
  const refused = createOllamaFetch({ core: { Channel, invoke: async () => Promise.reject("refused") } });
  await assert.rejects(refused("http://localhost:11434/api/tags"), TypeError);
});
