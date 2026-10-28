import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OAuthError, parseWwwAuthenticate, decodeJwt, tokensFromResponse, needsRefresh, isSecureUrl, parseCallbackQuery } from "../../app/src/ai/oauth-core.js";
import { discoverMcpAuth, registerClient, buildAuthUrl, exchangeCode, refreshTokens, revokeTokens, McpAuthSession, protectedResourceUrls, authServerUrls } from "../../app/src/ai/mcp-oauth.js";
import { createPkce } from "../../app/src/ai/vault.js";
import { McpClient } from "../../app/src/ai/mcp.js";
import { redact } from "../../app/src/core/log.js";
import { fakeFetch, jsonResponse } from "./helpers.js";

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `${b64u({ alg: "RS256" })}.${b64u(claims)}.c2lnc2lnc2lnc2lnc2lnc2lnc2lnc2lnc2ln`;

// ------------------------------------------------------------------ core
test("PKCE: verifier/challenge pair is S256 and state is random", async () => {
  const a = await createPkce();
  const b = await createPkce();
  assert.equal(a.challenge, createHash("sha256").update(a.verifier).digest("base64url"));
  assert.ok(a.verifier.length >= 43);
  assert.notEqual(a.state, b.state);
});

test("parseWwwAuthenticate reads resource_metadata, scope and error", () => {
  const p = parseWwwAuthenticate('Bearer realm="mcp", resource_metadata="https://x.test/.well-known/oauth-protected-resource", scope="read write", error="invalid_token"');
  assert.equal(p.params.resource_metadata, "https://x.test/.well-known/oauth-protected-resource");
  assert.equal(p.params.scope, "read write");
  assert.equal(p.params.error, "invalid_token");
  assert.equal(parseWwwAuthenticate('Basic realm="x"'), null);
  assert.equal(parseWwwAuthenticate(null), null);
});

test("tokensFromResponse, needsRefresh and the refresh window", () => {
  const t = tokensFromResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 }, 1000);
  assert.equal(t.expiresAt, 1000 + 3600_000);
  assert.equal(needsRefresh(t, 1000), false);
  assert.equal(needsRefresh(t, t.expiresAt - 59_000), true); // inside the 60 s skew
  assert.equal(needsRefresh(null), true);
  assert.throws(() => tokensFromResponse({}, 0), OAuthError);
  assert.equal(tokensFromResponse({ access_token: "b" }, 0, { refreshToken: "old" }).refreshToken, "old");
});

test("isSecureUrl allows https and loopback http only", () => {
  assert.ok(isSecureUrl("https://a.test/x"));
  assert.ok(isSecureUrl("http://127.0.0.1:1/x"));
  assert.ok(!isSecureUrl("http://a.test/x"));
  assert.ok(!isSecureUrl("javascript:alert(1)"));
});

test("parseCallbackQuery checks error, state, code", () => {
  assert.equal(parseCallbackQuery("code=c&state=s", "s").code, "c");
  assert.throws(() => parseCallbackQuery("code=c&state=x", "s"), { code: "state_mismatch" });
  assert.throws(() => parseCallbackQuery("error=access_denied&state=s", "s"), { code: "access_denied" });
  assert.throws(() => parseCallbackQuery("state=s", "s"), { code: "no_code" });
  assert.throws(() => parseCallbackQuery("code=c", ""), { code: "state_mismatch" });
});

test("decodeJwt reads claims and tolerates garbage", () => {
  assert.equal(decodeJwt(jwt({ email: "a@b.c" })).email, "a@b.c");
  assert.equal(decodeJwt("nonsense"), null);
});

// ------------------------------------------------------------------ discovery
const SERVER = "https://mcp.example.com/api/mcp";
const AS = "https://auth.example.com";
function fixtures(over = {}) {
  const prm = { resource: SERVER, authorization_servers: [AS], scopes_supported: ["read"], ...(over.prm || {}) };
  const as = { issuer: AS, authorization_endpoint: `${AS}/authorize`, token_endpoint: `${AS}/token`, registration_endpoint: `${AS}/register`, code_challenge_methods_supported: ["S256"], ...(over.as || {}) };
  return fakeFetch((c) => {
    if (c.url === "https://mcp.example.com/.well-known/oauth-protected-resource/api/mcp" && !over.noPrm) return jsonResponse(prm);
    if (c.url === `${AS}/.well-known/oauth-authorization-server`) return jsonResponse(as);
    return new Response("nope", { status: 404 });
  });
}

test("discovery: path-aware protected resource, then authorization server metadata", async () => {
  const f = fixtures();
  const d = await discoverMcpAuth({ fetch: f, serverUrl: SERVER });
  assert.equal(d.tokenEndpoint, `${AS}/token`);
  assert.equal(d.resource, SERVER);
  assert.deepEqual(d.scopes, ["read"]);
  assert.deepEqual(protectedResourceUrls(SERVER), ["https://mcp.example.com/.well-known/oauth-protected-resource/api/mcp", "https://mcp.example.com/.well-known/oauth-protected-resource"]);
  assert.equal(authServerUrls("https://a.test/tenant")[0], "https://a.test/.well-known/oauth-authorization-server/tenant");
});

test("discovery: resource_metadata from WWW-Authenticate is used first, scope parameter wins", async () => {
  const f = fakeFetch((c) => {
    if (c.url === "https://meta.example.com/prm") return jsonResponse({ resource: SERVER, authorization_servers: [AS] });
    if (c.url === `${AS}/.well-known/oauth-authorization-server`) return jsonResponse({ issuer: AS, authorization_endpoint: `${AS}/a`, token_endpoint: `${AS}/t`, code_challenge_methods_supported: ["S256"] });
    return new Response("", { status: 404 });
  });
  const d = await discoverMcpAuth({ fetch: f, serverUrl: SERVER, wwwAuthenticate: 'Bearer resource_metadata="https://meta.example.com/prm", scope="a b"' });
  assert.equal(f.calls[0].url, "https://meta.example.com/prm");
  assert.deepEqual(d.scopes, ["a", "b"]);
});

test("discovery: legacy server is its own authorization server; OIDC fallback works", async () => {
  const f = fakeFetch((c) => (c.url === "https://mcp.example.com/.well-known/openid-configuration" ? jsonResponse({ issuer: "https://mcp.example.com", authorization_endpoint: "https://mcp.example.com/a", token_endpoint: "https://mcp.example.com/t", code_challenge_methods_supported: ["S256"] }) : new Response("", { status: 404 })));
  const d = await discoverMcpAuth({ fetch: f, serverUrl: SERVER });
  assert.equal(d.issuer, "https://mcp.example.com");
});

test("discovery refuses: no S256, http endpoints, other resource, other issuer, no metadata", async () => {
  await assert.rejects(discoverMcpAuth({ fetch: fixtures({ as: { code_challenge_methods_supported: undefined } }), serverUrl: SERVER }), { code: "pkce_unsupported" });
  await assert.rejects(discoverMcpAuth({ fetch: fixtures({ as: { code_challenge_methods_supported: ["plain"] } }), serverUrl: SERVER }), { code: "pkce_unsupported" });
  await assert.rejects(discoverMcpAuth({ fetch: fixtures({ as: { token_endpoint: "http://auth.example.com/token" } }), serverUrl: SERVER }), { code: "discovery_failed" });
  await assert.rejects(discoverMcpAuth({ fetch: fixtures({ prm: { resource: "https://evil.example.com/mcp" } }), serverUrl: SERVER }), { code: "discovery_failed" });
  await assert.rejects(discoverMcpAuth({ fetch: fixtures({ as: { issuer: "https://other.example.com" } }), serverUrl: SERVER }), { code: "discovery_failed" });
  await assert.rejects(discoverMcpAuth({ fetch: fakeFetch(() => new Response("", { status: 404 })), serverUrl: SERVER }), { code: "discovery_failed" });
  await assert.rejects(discoverMcpAuth({ fetch: fixtures({ prm: { authorization_servers: ["http://auth.example.com"] } }), serverUrl: SERVER }), { code: "discovery_failed" });
});

// ------------------------------------------------------------------ registration and tokens
test("registerClient posts a public-client registration and returns the id", async () => {
  const f = fakeFetch(() => jsonResponse({ client_id: "cid", client_secret: "sec" }, { status: 201 }));
  const r = await registerClient({ fetch: f, registrationEndpoint: `${AS}/register`, redirectUri: "http://127.0.0.1:5/callback" });
  assert.deepEqual(r, { clientId: "cid", clientSecret: "sec" });
  assert.deepEqual(f.calls[0].json.redirect_uris, ["http://127.0.0.1:5/callback"]);
  assert.equal(f.calls[0].json.token_endpoint_auth_method, "none");
  await assert.rejects(registerClient({ fetch: f, registrationEndpoint: undefined, redirectUri: "x" }), { code: "registration_unsupported" });
  const bad = fakeFetch(() => jsonResponse({ error: "invalid_redirect_uri" }, { status: 400 }));
  await assert.rejects(registerClient({ fetch: bad, registrationEndpoint: `${AS}/register`, redirectUri: "x" }), { code: "invalid_redirect_uri" });
});

test("buildAuthUrl carries PKCE S256, state, resource and scope", () => {
  const u = new URL(buildAuthUrl({ authorizationEndpoint: `${AS}/authorize`, clientId: "cid", redirectUri: "http://127.0.0.1:5/callback", challenge: "ch", state: "st", resource: SERVER, scope: ["a", "b"] }));
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("resource"), SERVER);
  assert.equal(u.searchParams.get("scope"), "a b");
  assert.equal(u.searchParams.get("state"), "st");
});

const record = (over = {}) => ({ tokenEndpoint: `${AS}/token`, clientId: "cid", resource: SERVER, tokens: { accessToken: "A1", refreshToken: "R1", expiresAt: 10_000_000 }, ...over });

test("exchangeCode sends verifier and resource; refresh rotates and keeps old refresh token when absent", async () => {
  const f = fakeFetch((c) => jsonResponse({ access_token: "A2", refresh_token: "R2", expires_in: 60 }));
  const t = await exchangeCode({ fetch: f, record: record(), code: "CODE", verifier: "VER", redirectUri: "http://x", now: 0 });
  const body = new URLSearchParams(f.calls[0].body);
  assert.equal(body.get("code_verifier"), "VER");
  assert.equal(body.get("resource"), SERVER);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(t.expiresAt, 60_000);
  const f2 = fakeFetch(() => jsonResponse({ access_token: "A3", expires_in: 60 }));
  const r = await refreshTokens({ fetch: f2, record: record(), now: 0 });
  assert.equal(r.refreshToken, "R1");
  assert.equal(new URLSearchParams(f2.calls[0].body).get("refresh_token"), "R1");
});

test("token errors surface the server's error code without leaking secrets", async () => {
  const f = fakeFetch(() => jsonResponse({ error: "invalid_grant", error_description: "expired" }, { status: 400 }));
  await assert.rejects(exchangeCode({ fetch: f, record: record(), code: "SECRET-CODE", verifier: "SECRET-VERIFIER", redirectUri: "x" }), (e) => e.code === "invalid_grant" && !/SECRET/.test(e.message));
  const net = async () => {
    throw new Error("offline");
  };
  await assert.rejects(refreshTokens({ fetch: net, record: record() }), { code: "network_error" });
  await assert.rejects(refreshTokens({ fetch: f, record: record({ tokens: { accessToken: "a" } }) }), { code: "no_refresh_token" });
});

test("revokeTokens is best effort", async () => {
  const f = fakeFetch(() => new Response("", { status: 200 }));
  assert.equal(await revokeTokens({ fetch: f, record: record({ revocationEndpoint: `${AS}/revoke` }) }), true);
  assert.equal(new URLSearchParams(f.calls[0].body).get("token_type_hint"), "refresh_token");
  assert.equal(await revokeTokens({ fetch: f, record: record() }), false);
  assert.equal(await revokeTokens({ fetch: async () => { throw new Error("x"); }, record: record({ revocationEndpoint: `${AS}/revoke` }) }), false);
});

// ------------------------------------------------------------------ session
function memStore(rec) {
  const s = { rec, saves: 0, load: async () => s.rec && JSON.parse(JSON.stringify(s.rec)), save: async (r) => ((s.rec = r), s.saves++) };
  return s;
}

test("McpAuthSession: no refresh before the skew window, refresh after, rotation saved", async () => {
  let now = 0;
  const f = fakeFetch(() => jsonResponse({ access_token: "A2", refresh_token: "R2", expires_in: 3600 }));
  const store = memStore(record({ tokens: { accessToken: "A1", refreshToken: "R1", expiresAt: 3_600_000 } }));
  const s = new McpAuthSession({ fetch: f, store, now: () => now });
  assert.equal(await s.getAccessToken(), "A1");
  assert.equal(f.calls.length, 0);
  now = 3_600_000 - 30_000;
  assert.equal(await s.getAccessToken(), "A2");
  assert.equal(store.rec.tokens.refreshToken, "R2");
  assert.equal(f.calls.length, 1);
});

test("McpAuthSession: concurrent callers share one refresh (rotating tokens)", async () => {
  const f = fakeFetch(async () => jsonResponse({ access_token: "A2", refresh_token: "R2", expires_in: 3600 }));
  const store = memStore(record({ tokens: { accessToken: "A1", refreshToken: "R1", expiresAt: 0 } }));
  const s = new McpAuthSession({ fetch: f, store, now: () => 1_000_000 });
  const r = await Promise.all([s.getAccessToken(), s.getAccessToken(), s.getAccessToken()]);
  assert.deepEqual(r, ["A2", "A2", "A2"]);
  assert.equal(f.calls.length, 1);
});

test("McpAuthSession: refused refresh token clears the sign-in, a network error keeps it", async () => {
  const bad = fakeFetch(() => jsonResponse({ error: "invalid_grant" }, { status: 400 }));
  const store = memStore(record({ tokens: { accessToken: "A1", refreshToken: "R1", expiresAt: 0 } }));
  await assert.rejects(new McpAuthSession({ fetch: bad, store, now: () => 1 }).getAccessToken(), { code: "invalid_grant" });
  assert.equal(store.rec.tokens, null);
  const store2 = memStore(record({ tokens: { accessToken: "A1", refreshToken: "R1", expiresAt: 0 } }));
  await assert.rejects(new McpAuthSession({ fetch: async () => { throw new Error("offline"); }, store: store2, now: () => 1 }).getAccessToken(), { code: "network_error" });
  assert.equal(store2.rec.tokens.refreshToken, "R1");
  assert.equal(await new McpAuthSession({ fetch: bad, store: memStore(null) }).getAccessToken(), "");
});

test("McpClient with auth: adds the bearer token and retries once after a 401 + refresh", async () => {
  const store = memStore(record({ tokens: { accessToken: "OLD", refreshToken: "R1", expiresAt: 9e15 } }));
  const tokenFetch = fakeFetch(() => jsonResponse({ access_token: "NEW", refresh_token: "R2", expires_in: 3600 }));
  const auth = new McpAuthSession({ fetch: tokenFetch, store });
  const f = fakeFetch((c) => {
    const bearer = c.headers.Authorization;
    if (bearer !== "Bearer NEW") return new Response("", { status: 401, headers: { "www-authenticate": 'Bearer error="invalid_token"' } });
    const m = c.json;
    if (m.method === "initialize") return jsonResponse({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "s" } } });
    return new Response(null, { status: 202 });
  });
  const c = new McpClient({ url: SERVER, fetch: f, auth });
  await c.connect();
  assert.equal(f.calls[0].headers.Authorization, "Bearer OLD");
  assert.equal(f.calls[1].headers.Authorization, "Bearer NEW");
  assert.equal(tokenFetch.calls.length, 1);
});

test("McpClient without sign-in exposes the WWW-Authenticate challenge on a 401", async () => {
  const f = fakeFetch(() => new Response("", { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="https://x.test/prm"' } }));
  await assert.rejects(new McpClient({ url: SERVER, fetch: f }).connect(), (e) => e.status === 401 && /resource_metadata/.test(e.wwwAuthenticate));
});

test("log redaction removes tokens, codes and JWTs", () => {
  const j = jwt({ sub: "u", email: "a@b.c" });
  const line = redact(`access_token=abc123secret refresh_token: "r-xyz-1234" Authorization: Bearer ${j} ${j}`);
  assert.ok(!/abc123secret|r-xyz-1234|c2lnc2ln/.test(line), line);
});
