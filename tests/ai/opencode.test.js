import test from "node:test";
import assert from "node:assert/strict";
import { parseOpenCodeConfig, stripJsonc, createOpenCodeServerProvider, modelsFromProvidersResponse, splitModel, transcriptText } from "../../app/src/ai/providers/opencode.js";
import { PROVIDER_PRESETS, createProvider } from "../../app/src/ai/providers/index.js";
import { collect, fakeFetch, jsonResponse } from "./helpers.js";

const CONFIG = `{
  // global config
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-5-5",
  "provider": {
    "myprovider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My AI Provider",
      "options": {
        "baseURL": "https://api.myprovider.com/v1/",
        "apiKey": "{env:MY_PROVIDER_API_KEY}",
        "headers": { "X-Org": "team-a", "Authorization": "Bearer abc", "X-Token": "{env:TOK}" }
      },
      "models": { "my-model": { "name": "My Model", "limit": { "context": 200000, "output": 65536 } },},
    },
    "ollama": { "npm": "@ai-sdk/openai-compatible", "name": "Ollama", "options": { "baseURL": "http://localhost:11434/v1" }, "models": { "llama3.1": {} } },
    "anthropic": { "options": { "apiKey": "sk-ant-secret" } },
    "weird": { "npm": "@ai-sdk/amazon-bedrock", "options": { "region": "us-east-1" } },
    "envurl": { "npm": "@ai-sdk/openai-compatible", "options": { "baseURL": "{env:URL}" } },
  },
}`;

test("opencode.json import: connections, no secrets, warnings", () => {
  const r = parseOpenCodeConfig(CONFIG);
  assert.equal(r.defaultModel, "anthropic/claude-sonnet-5-5");
  assert.deepEqual(r.connections.map((c) => c.id), ["myprovider", "ollama", "anthropic"]);
  const my = r.connections[0];
  assert.equal(my.baseUrl, "https://api.myprovider.com/v1");
  assert.deepEqual(my.headers, { "X-Org": "team-a" });
  assert.deepEqual(my.models, [{ id: "my-model", name: "My Model", contextWindow: 200000 }]);
  assert.match(my.keyHint, /\{env:MY_PROVIDER_API_KEY\}/);
  assert.equal(r.connections[1].needsKey, false);
  const a = r.connections[2];
  assert.equal(a.preset, "anthropic");
  assert.equal(a.kind, "anthropic");
  assert.ok(!JSON.stringify(r).includes("sk-ant-secret") && !JSON.stringify(r).includes("Bearer abc"));
  assert.ok(r.warnings.some((w) => /weird/.test(w)));
  assert.ok(r.warnings.some((w) => /envurl/.test(w)));
});

test("opencode.json import: invalid input and JSONC helper", () => {
  assert.throws(() => parseOpenCodeConfig("not json"), /not valid JSON/);
  assert.throws(() => parseOpenCodeConfig("[]"), /object/);
  assert.deepEqual(parseOpenCodeConfig({}).connections, []);
  assert.deepEqual(JSON.parse(stripJsonc('{"a":"http://x//y", /* c */ "b":[1,],}')), { a: "http://x//y", b: [1] });
});

test("Zen preset sanity", () => {
  const z = PROVIDER_PRESETS.find((p) => p.id === "opencode-zen");
  assert.equal(z.label, "OpenCode Zen");
  assert.equal(z.kind, "openai");
  assert.equal(z.baseUrl, "https://opencode.ai/zen/v1");
  assert.equal(z.needsKey, true);
  assert.match(z.keyUrl, /^https:\/\/opencode\.ai\//);
  assert.ok(z.models.length >= 3);
  const p = createProvider({ preset: "opencode-zen", apiKey: "k", fetch: fakeFetch(() => jsonResponse({ object: "list", data: [{ id: "big-pickle", object: "model", owned_by: "opencode" }] })) });
  return p.listModels().then((m) => assert.deepEqual(m, [{ id: "big-pickle" }]));
});

test("server preset creates the experimental adapter", () => {
  const s = PROVIDER_PRESETS.find((p) => p.id === "opencode-server");
  assert.equal(s.kind, "opencode-server");
  assert.equal(createProvider({ preset: "opencode-server" }).kind, "opencode-server");
});

test("opencode server: health, models, message round trip with basic auth", async () => {
  const f = fakeFetch((c) => {
    if (c.url.endsWith("/global/health")) return jsonResponse({ healthy: true, version: "1.2.3" });
    if (c.url.endsWith("/config/providers")) return jsonResponse({ providers: [{ id: "anthropic", name: "Anthropic", models: { "claude-sonnet-5-5": { name: "Sonnet", limit: { context: 200000 } } } }], default: { anthropic: "claude-sonnet-5-5" } });
    if (c.url.endsWith("/session") && c.method === "POST") return jsonResponse({ id: "ses_1" });
    if (c.url.endsWith("/session/ses_1/message")) return jsonResponse({ info: { id: "m1" }, parts: [{ type: "step-start" }, { type: "text", text: "Hi there" }] });
    return jsonResponse({}, { status: 200 });
  });
  const p = createOpenCodeServerProvider({ fetch: f, apiKey: "pw" });
  assert.deepEqual(await p.health(), { healthy: true, version: "1.2.3" });
  assert.deepEqual(await p.listModels(), [{ id: "anthropic/claude-sonnet-5-5", name: "Anthropic: Sonnet", contextWindow: 200000 }]);
  const ev = await collect(p.stream({ model: "anthropic/claude-sonnet-5-5", system: "Be brief", messages: [{ role: "user", content: "Hello" }], tools: [{ name: "x" }] }));
  assert.equal(ev[0].delta, "Hi there");
  assert.equal(ev.at(-1).type, "done");
  const msg = f.calls.find((c) => c.url.endsWith("/message"));
  assert.deepEqual(msg.json, { model: { providerID: "anthropic", modelID: "claude-sonnet-5-5" }, parts: [{ type: "text", text: "Hello" }], system: "Be brief" });
  assert.equal(msg.headers.Authorization, "Basic " + Buffer.from("opencode:pw").toString("base64"));
  assert.equal(f.calls[0].url.startsWith("http://127.0.0.1:4096/"), true);
});

test("opencode server: error mapping and helpers", async () => {
  const f = fakeFetch((c) => (c.url.endsWith("/session") ? jsonResponse({ id: "s" }) : c.url.endsWith("/message") ? jsonResponse({ info: { error: { name: "ProviderAuthError", data: { message: "bad key" } } }, parts: [] }) : jsonResponse({})));
  const p = createOpenCodeServerProvider({ fetch: f });
  await assert.rejects(collect(p.stream({ model: "a/b", messages: [{ role: "user", content: "x" }] })), /bad key/);
  assert.throws(() => splitModel("nomodel"), /providerID\/modelID/);
  assert.deepEqual(splitModel("openrouter/anthropic/claude"), { providerID: "openrouter", modelID: "anthropic/claude" });
  assert.deepEqual(modelsFromProvidersResponse({ x: { models: ["m1"] }, default: {} }), [{ id: "x/m1" }]);
  assert.match(transcriptText([{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }]), /Current request:\nc/);
});
