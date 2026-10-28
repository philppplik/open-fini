import test from "node:test";
import assert from "node:assert/strict";
import { OPENAI_AUTH, buildOpenAIAuthUrl, completeSignIn, revokeOpenAI, parseAccountModels, planUsageGranted, loopbackRedirect, newHostId, friendlyAccountError } from "../../app/src/ai/openai-account.js";
import { createOpenAIResponsesProvider, toResponsesInput } from "../../app/src/ai/providers/openai-responses.js";
import { createProvider, PROVIDER_PRESETS } from "../../app/src/ai/providers/index.js";
import { fakeFetch, jsonResponse, streamResponse, collect } from "./helpers.js";

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `${b64u({ alg: "RS256" })}.${b64u(claims)}.c2lnc2lnc2lnc2lnc2lnc2lnc2lnc2lnc2ln`;
const sse = (...evs) => evs.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

const expect = (o = {}) => ({ state: "st", nonce: "no", verifier: "ver", redirectUri: loopbackRedirect(1455), hostId: "urn:uuid:h", ...o });
const idTok = (o = {}) => jwt({ iss: OPENAI_AUTH.issuer, aud: ["oaiapp_1"], exp: 2e9, nonce: "no", sub: "u1", email: "me@example.com", ...o });
const tokenFetch = (o = {}) => fakeFetch(() => jsonResponse({ access_token: "ACCESS", refresh_token: "REFRESH", id_token: idTok(o.id), expires_in: 3600, scope: o.scope ?? OPENAI_AUTH.scope }));

test("authorize URL: first registration vs saved client", () => {
  const first = new URL(buildOpenAIAuthUrl({ hostId: "urn:uuid:h", redirectUri: loopbackRedirect(1455), challenge: "c", state: "s", nonce: "n" }));
  assert.equal(first.origin + first.pathname, OPENAI_AUTH.authorizeUrl);
  assert.equal(first.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(first.searchParams.get("agent_name_hint"), "OpenFini");
  assert.equal(first.searchParams.get("redirect_uri"), "http://127.0.0.1:1455/auth/callback");
  assert.equal(first.searchParams.get("code_challenge_method"), "S256");
  assert.equal(first.searchParams.get("resource"), "https://api.openai.com/v1");
  assert.match(first.searchParams.get("scope"), /chatgpt\.tokens\.use\.direct/);
  const again = new URL(buildOpenAIAuthUrl({ clientId: "oaiapp_1", hostId: "h", redirectUri: loopbackRedirect(50000), challenge: "c", state: "s", nonce: "n", idTokenHint: "IDT", loginHint: "a@b.c" }));
  assert.equal(again.searchParams.get("client_id"), "oaiapp_1");
  assert.equal(again.searchParams.has("agent_name_hint"), false);
  assert.equal(again.searchParams.get("id_token_hint"), "IDT");
  assert.ok(!/localhost/.test(again.toString().replace(/%3A/gi, ":")));
  assert.match(newHostId(), /^urn:uuid:[0-9a-f-]{36}$/);
});

test("completeSignIn: success returns the account and stores a refreshable record", async () => {
  const f = tokenFetch();
  const rec = await completeSignIn({ fetch: f, query: "code=C&state=st&client_id=oaiapp_1", expect: expect(), now: 1_000 });
  assert.equal(rec.clientId, "oaiapp_1");
  assert.equal(rec.email, "me@example.com");
  assert.equal(rec.planUsage, true);
  assert.equal(rec.tokens.accessToken, "ACCESS");
  assert.equal(rec.tokens.expiresAt, 1_000 + 3_600_000);
  const body = new URLSearchParams(f.calls[0].body);
  assert.equal(f.calls[0].url, OPENAI_AUTH.tokenUrl);
  assert.equal(body.get("code_verifier"), "ver");
  assert.equal(body.get("client_id"), "oaiapp_1");
  assert.equal(body.get("resource"), "https://api.openai.com/v1");
  assert.equal(body.has("client_secret"), false);
});

test("completeSignIn: refusals (state, error, client, claims, missing registration)", async () => {
  const f = tokenFetch();
  await assert.rejects(completeSignIn({ fetch: f, query: "code=C&state=bad&client_id=oaiapp_1", expect: expect() }), { code: "state_mismatch" });
  await assert.rejects(completeSignIn({ fetch: f, query: "error=access_denied&state=st", expect: expect() }), { code: "access_denied" });
  await assert.rejects(completeSignIn({ fetch: f, query: "code=C&state=st", expect: expect() }), { code: "registration_incomplete" });
  await assert.rejects(completeSignIn({ fetch: f, query: "code=C&state=st&client_id=other", expect: expect({ clientId: "oaiapp_1" }) }), { code: "client_mismatch" });
  assert.equal(f.calls.length, 0, "no token request before the callback is validated");
  const q = "code=C&state=st&client_id=oaiapp_1";
  await assert.rejects(completeSignIn({ fetch: tokenFetch({ id: { nonce: "other" } }), query: q, expect: expect() }), { code: "bad_id_token" });
  await assert.rejects(completeSignIn({ fetch: tokenFetch({ id: { aud: ["x"] } }), query: q, expect: expect() }), { code: "bad_id_token" });
  await assert.rejects(completeSignIn({ fetch: tokenFetch({ id: { iss: "https://evil.example" } }), query: q, expect: expect() }), { code: "bad_id_token" });
  await assert.rejects(completeSignIn({ fetch: tokenFetch({ id: { exp: 1 } }), query: q, expect: expect() }), { code: "bad_id_token" });
  const denied = fakeFetch(() => jsonResponse({ error: "invalid_grant" }, { status: 400 }));
  await assert.rejects(completeSignIn({ fetch: denied, query: q, expect: expect() }), { code: "invalid_grant" });
});

test("completeSignIn: sign-in without plan usage is flagged", async () => {
  const rec = await completeSignIn({ fetch: tokenFetch({ scope: "openid email profile" }), query: "code=C&state=st&client_id=oaiapp_1", expect: expect() });
  assert.equal(rec.planUsage, false);
  assert.equal(planUsageGranted("a chatgpt.tokens.use.direct"), true);
  assert.equal(planUsageGranted("chatgpt.tokens.use.directx"), false);
});

test("revokeOpenAI posts the refresh token with the saved client id and reports unconfirmed revocation", async () => {
  const f = fakeFetch(() => new Response("", { status: 200 }));
  assert.equal(await revokeOpenAI({ fetch: f, record: { clientId: "oaiapp_1", tokens: { refreshToken: "R" } } }), true);
  const b = new URLSearchParams(f.calls[0].body);
  assert.equal(b.get("token"), "R");
  assert.equal(b.get("client_id"), "oaiapp_1");
  assert.equal(await revokeOpenAI({ fetch: async () => { throw new Error("x"); }, record: { clientId: "c", tokens: { refreshToken: "R" } } }), false);
});

test("parseAccountModels keeps listed models in server order", () => {
  const m = parseAccountModels({ models: [{ slug: "b", display_name: "B", visibility: "list" }, { slug: "hidden", visibility: "hide" }, { slug: "a", visibility: "list" }] });
  assert.deepEqual(m, [{ id: "b", name: "B" }, { id: "a", name: undefined }]);
  assert.deepEqual(parseAccountModels(null), []);
  assert.match(friendlyAccountError("subscription_sharing_usage_limit_exceeded"), /usage limit/);
  assert.equal(friendlyAccountError("x"), null);
});

// ------------------------------------------------------------------ provider
test("toResponsesInput maps text, images, tool calls and results; no system items", () => {
  const input = toResponsesInput([
    { role: "user", content: [{ type: "text", text: "hi" }, { type: "image", mime: "image/png", data: "AAAA" }] },
    { role: "assistant", content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "c1", name: "t", input: { a: 1 } }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "c1", content: "done" }] },
  ]);
  assert.equal(input[0].content[1].type, "input_image");
  assert.deepEqual(input[1], { role: "assistant", content: [{ type: "output_text", text: "ok" }] });
  assert.deepEqual(input[2], { type: "function_call", call_id: "c1", name: "t", arguments: '{"a":1}' });
  assert.deepEqual(input[3], { type: "function_call_output", call_id: "c1", output: "done" });
  assert.ok(!input.some((i) => i.role === "system"));
});

const completed = { type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 7 } } };

test("provider streams text and tool calls over /responses with the plan-usage constraints", async () => {
  const f = fakeFetch(() => streamResponse(sse({ type: "response.output_text.delta", delta: "Hel" }, { type: "response.output_text.delta", delta: "lo" }, { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "t", arguments: '{"x":1}' } }, completed)));
  const p = createOpenAIResponsesProvider({ fetch: f, getToken: async () => "TOK" });
  const ev = await collect(p.stream({ model: "m", system: "sys", messages: [{ role: "user", content: "hi" }], tools: [{ name: "t", description: "d" }], maxTokens: 10, temperature: 0.2 }));
  const call = f.calls[0];
  assert.equal(call.url, "https://api.openai.com/v1/responses");
  assert.equal(call.headers.Authorization, "Bearer TOK");
  assert.equal(call.json.store, false);
  assert.equal(call.json.stream, true);
  assert.equal(call.json.instructions, "sys");
  for (const banned of ["max_output_tokens", "temperature", "metadata", "previous_response_id", "user"]) assert.ok(!(banned in call.json), banned);
  assert.equal(call.json.tools[0].type, "function");
  assert.equal(ev.filter((e) => e.type === "text").map((e) => e.delta).join(""), "Hello");
  assert.deepEqual(ev.find((e) => e.type === "tool_call").input, { x: 1 });
  assert.deepEqual(ev.find((e) => e.type === "usage"), { type: "usage", input: 5, output: 7 });
  const done = ev.at(-1);
  assert.equal(done.stopReason, "tool_use");
  assert.equal(done.message.content[0].text, "Hello");
});

test("provider: truncated stream, failed response with friendly text, 401 retried once with a fresh token", async () => {
  const trunc = fakeFetch(() => streamResponse(sse({ type: "response.output_text.delta", delta: "x" })));
  await assert.rejects(collect(createOpenAIResponsesProvider({ fetch: trunc, getToken: async () => "T" }).stream({ model: "m", messages: [] })), { code: "stream_truncated" });
  const failed = fakeFetch(() => streamResponse(sse({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "raw" } } })));
  await assert.rejects(collect(createOpenAIResponsesProvider({ fetch: failed, getToken: async () => "T" }).stream({ model: "m", messages: [] })), (e) => e.status === 429 && /usage limit/.test(e.message));
  const forces = [];
  let n = 0;
  const retry = fakeFetch(() => (n++ === 0 ? jsonResponse({ error: { code: "subscription_sharing_invalid_user", message: "no" } }, { status: 401 }) : streamResponse(sse(completed))));
  const p = createOpenAIResponsesProvider({ fetch: retry, getToken: async ({ force } = {}) => (forces.push(!!force), force ? "FRESH" : "OLD") });
  await collect(p.stream({ model: "m", messages: [] }));
  assert.deepEqual(forces, [false, true]);
  assert.equal(retry.calls[1].headers.Authorization, "Bearer FRESH");
  const signedOut = createOpenAIResponsesProvider({ fetch: retry, getToken: async () => "" });
  await assert.rejects(collect(signedOut.stream({ model: "m", messages: [] })), { code: "signed_out" });
});

test("provider lists only the account's models; preset is registered and builds a provider", async () => {
  const f = fakeFetch(() => jsonResponse({ models: [{ slug: "gpt-x", display_name: "GPT X", visibility: "list" }] }));
  const p = createOpenAIResponsesProvider({ fetch: f, getToken: async () => "T" });
  assert.deepEqual(await p.listModels(), [{ id: "gpt-x", name: "GPT X" }]);
  assert.equal(f.calls[0].url, "https://api.openai.com/v1/models");
  assert.ok(PROVIDER_PRESETS.some((x) => x.id === "openai-account" && x.kind === "openai-responses"));
  assert.equal(createProvider({ preset: "openai-account", getToken: async () => "T" }).kind, "openai-responses");
});
