// Glue for the two OAuth sign-ins: "Sign in with OpenAI" (provider preset `openai-account`, desktop only) and
// "Sign in" for OAuth-protected MCP servers (desktop via a one-shot loopback listener, web/PWA via a redirect back to the app).
// Public API: signInOpenAI, signOutOpenAI, openAIGetToken, accountInfo, signInMcp, finishMcpSignIn, isMcpReturn,
//   mcpAuthFor, mcpSignedIn, signOutMcp.
// Invariants: protocol logic lives in ai/openai-account.js and ai/mcp-oauth.js (pure, tested). Tokens are kept ONLY in the
// vault secrets (`vibeStore.secrets`, sealed when the passphrase vault is on) as a JSON record; never in localStorage,
// URLs, logs or toasts. The only value kept in sessionStorage during a web redirect is the PKCE verifier + state
// (no tokens), removed on return. See docs/openai-account-auth.md and docs/ai-engine.md.
import { vibeStore } from "./store.js";
import { platform } from "../platform/index.js";
import { t } from "../i18n/index.js";

const ai = () => import("../ai/index.js");
const tauri = () => window.__TAURI__?.core;
const PENDING = "vibe.mcpoauth";

const readRecord = (key) => {
  try {
    return JSON.parse(vibeStore.getKey(key) || "null");
  } catch {
    return null;
  }
};
const recordStore = (key) => ({ load: async () => readRecord(key), save: (rec) => vibeStore.setKey(key, JSON.stringify(rec)) });

/** Opens `buildUrl(port)` in the system browser and resolves with `{query, port}` of the callback (desktop only). */
async function viaLoopback({ preferredPort, path, state, buildUrl }) {
  const core = tauri();
  if (!core) throw new Error(t("This sign-in needs the desktop app: it receives the answer on a local port."));
  const port = await core.invoke("oauth_loopback_start", { preferredPort: preferredPort ?? null });
  const waiting = core.invoke("oauth_loopback_wait", { path, expectedState: state });
  waiting.catch(() => {}); // surfaced below; avoids an unhandled rejection if opening the browser fails first
  await platform.openExternal(buildUrl(port));
  return { query: await waiting, port };
}

// ---------------------------------------------------------------- OpenAI account

/** Stable opaque id of this installation (OpenAI requires one per host; it is not a credential). */
async function hostId(lib) {
  if (!vibeStore.settings.openaiHostId) await vibeStore.saveSettings({ openaiHostId: lib.newHostId() });
  return vibeStore.settings.openaiHostId;
}

/** Signs in (or re-authorizes the saved registration of `existingId`) and stores the connection. @returns the provider record */
export async function signInOpenAI(app, existingId) {
  if (!tauri()) throw new Error(t("Signing in with an OpenAI account needs the desktop app. In the browser, use an API key."));
  app.network?.assert("oauth");
  await vibeStore.load();
  const lib = await ai();
  const prev = existingId ? readRecord(existingId) : null;
  const pk = await lib.createPkce();
  const nonce = lib.randomId("", 16);
  const host = await hostId(lib);
  const { query, port } = await viaLoopback({
    preferredPort: lib.OPENAI_AUTH.preferredPort,
    path: lib.OPENAI_AUTH.redirectPath,
    state: pk.state,
    buildUrl: (port) => lib.buildOpenAIAuthUrl({ clientId: prev?.clientId, hostId: host, redirectUri: lib.loopbackRedirect(port), challenge: pk.challenge, state: pk.state, nonce, idTokenHint: prev?.tokens?.idToken, loginHint: prev?.email }),
  });
  const redirectUri = lib.loopbackRedirect(port);
  const rec = await lib.completeSignIn({ fetch: (...a) => fetch(...a), query, expect: { state: pk.state, nonce, verifier: pk.verifier, redirectUri, hostId: host, clientId: prev?.clientId } });
  const preset = lib.PROVIDER_PRESETS.find((p) => p.id === "openai-account");
  const saved = await vibeStore.saveProvider({ id: existingId, preset: "openai-account", label: rec.email ? `OpenAI (${rec.email})` : preset.label, kind: preset.kind, baseUrl: preset.baseUrl, apiKey: JSON.stringify(rec) });
  return saved;
}

/** Access-token getter for the provider (auto refresh, one refresh at a time, rotated refresh token saved). */
export function openAIGetToken(providerId) {
  let session;
  return async ({ force } = {}) => {
    const lib = await ai();
    session ||= new lib.OAuthSession({ fetch: (...a) => fetch(...a), store: recordStore(providerId) });
    return session.getAccessToken({ force });
  };
}

/** What the UI shows for a connection: email, plan-usage flag, signed-in state. */
export function accountInfo(providerId) {
  const r = readRecord(providerId);
  return { signedIn: !!r?.tokens?.accessToken, email: r?.email || "", planUsage: r ? r.planUsage !== false : false };
}

/** Revokes the refresh token at OpenAI and removes the stored credentials. @returns {Promise<boolean>} whether revocation was confirmed */
export async function signOutOpenAI(providerId) {
  const lib = await ai();
  const rec = readRecord(providerId);
  const ok = rec ? await lib.revokeOpenAI({ fetch: (...a) => fetch(...a), record: rec }) : true;
  await vibeStore.setKey(providerId, "");
  return ok;
}

// ---------------------------------------------------------------- MCP servers

const mcpKey = (srv) => `oauth:mcp:${srv.id}`;

export const mcpSignedIn = (srv) => !!readRecord(mcpKey(srv))?.tokens;

/** McpAuthSession for a server that has stored sign-in data, else null (then only the static header applies). */
export async function mcpAuthFor(srv) {
  if (!readRecord(mcpKey(srv))) return null;
  const lib = await ai();
  return new lib.OAuthSession({ fetch: (...a) => fetch(...a), store: recordStore(mcpKey(srv)) });
}

/** Asks the server without credentials; returns its `WWW-Authenticate` header when it demands a sign-in. */
async function probe(url) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "OpenFini", version: "0" } } }) }).catch(() => null);
  if (!res) return { reachable: false };
  return { reachable: true, needsAuth: res.status === 401, www: res.headers.get("www-authenticate") };
}

/**
 * Signs in to an OAuth-protected MCP server. Desktop: completes here and resolves `{done:true}`.
 * Web/PWA: navigates away; `finishMcpSignIn` completes it after the redirect (this promise never resolves usefully).
 */
export async function signInMcp(app, srv) {
  app.network?.assert("oauth");
  app.network?.assert("ai", srv.url);
  await vibeStore.load();
  const lib = await ai();
  const f = (...a) => fetch(...a);
  const p = await probe(srv.url);
  if (!p.reachable) throw new Error(t("The server could not be reached."));
  if (!p.needsAuth) throw new Error(t("This server does not ask for a sign-in."));
  const meta = await lib.discoverMcpAuth({ fetch: f, serverUrl: srv.url, wwwAuthenticate: p.www });
  const pk = await lib.createPkce();
  const finish = async (query, redirectUri, client) => {
    const { code } = (await import("../ai/oauth-core.js")).parseCallbackQuery(query, pk.state);
    const record = { serverUrl: srv.url, resource: meta.resource, issuer: meta.issuer, tokenEndpoint: meta.tokenEndpoint, revocationEndpoint: meta.revocationEndpoint, clientId: client.clientId, clientSecret: client.clientSecret };
    record.tokens = await lib.exchangeCode({ fetch: f, record, code, verifier: pk.verifier, redirectUri });
    record.account = lib.accountLabel(record.tokens);
    await vibeStore.setKey(mcpKey(srv), JSON.stringify(record));
    return record;
  };
  const client0 = srv.oauthClientId ? { clientId: srv.oauthClientId } : null;
  return runMcp({ app, srv, lib, f, meta, pk, finish, client0 });
}

/** Registration needs the redirect URI first, so the loopback port is bound before registering. */
async function runMcp({ app, srv, lib, f, meta, pk, finish, client0 }) {
  const core = tauri();
  if (core) {
    const port = await core.invoke("oauth_loopback_start", { preferredPort: null });
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const client = client0 || (await lib.registerClient({ fetch: f, registrationEndpoint: meta.registrationEndpoint, redirectUri }));
    const waiting = core.invoke("oauth_loopback_wait", { path: "/callback", expectedState: pk.state });
    waiting.catch(() => {});
    await platform.openExternal(lib.buildAuthUrl({ authorizationEndpoint: meta.authorizationEndpoint, clientId: client.clientId, redirectUri, challenge: pk.challenge, state: pk.state, resource: meta.resource, scope: meta.scopes }));
    const query = await waiting;
    await finish(query, redirectUri, client);
    return { done: true };
  }
  const redirectUri = `${location.origin}${location.pathname}?vibe_oauth=mcp`;
  const client = client0 || (await lib.registerClient({ fetch: f, registrationEndpoint: meta.registrationEndpoint, redirectUri }));
  sessionStorage.setItem(PENDING, JSON.stringify({ serverId: srv.id, state: pk.state, verifier: pk.verifier, redirectUri, client, meta }));
  location.href = lib.buildAuthUrl({ authorizationEndpoint: meta.authorizationEndpoint, clientId: client.clientId, redirectUri, challenge: pk.challenge, state: pk.state, resource: meta.resource, scope: meta.scopes });
  return { done: false };
}

export const isMcpReturn = (params) => params.get("vibe_oauth") === "mcp" && (params.has("code") || params.has("error"));

/** Web/PWA: completes the sign-in after the provider redirected back (called from boot.js). */
export async function finishMcpSignIn(app, params) {
  const query = params.toString();
  history.replaceState(null, "", location.pathname); // the one-time code must not stay in the address bar
  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING) || "null");
    sessionStorage.removeItem(PENDING);
  } catch {
    /* unavailable */
  }
  if (!pending?.verifier) return app.toast(t("The sign-in expired. Please try again."), "warning", 4000);
  try {
    app.network?.assert("oauth");
    await vibeStore.load();
    const lib = await ai();
    const { parseCallbackQuery } = await import("../ai/oauth-core.js");
    const { code } = parseCallbackQuery(query, pending.state);
    const srv = vibeStore.mcpServers.find((s) => s.id === pending.serverId);
    if (!srv) throw new Error(t("The MCP server no longer exists."));
    const m = pending.meta;
    const record = { serverUrl: srv.url, resource: m.resource, issuer: m.issuer, tokenEndpoint: m.tokenEndpoint, revocationEndpoint: m.revocationEndpoint, clientId: pending.client.clientId, clientSecret: pending.client.clientSecret };
    record.tokens = await lib.exchangeCode({ fetch: (...a) => fetch(...a), record, code, verifier: pending.verifier, redirectUri: pending.redirectUri });
    record.account = lib.accountLabel(record.tokens);
    await vibeStore.setKey(mcpKey(srv), JSON.stringify(record));
    app.setStudio("vibe");
    app.toast(t("Signed in to {name}.", { name: srv.name }), "success", 3500);
  } catch (err) {
    app.toast(t("Sign-in failed: {message}", { message: err.message }), "danger", 6000);
  }
}

/** Revokes (best effort) and forgets the server's stored sign-in. */
export async function signOutMcp(srv) {
  const lib = await ai();
  const rec = readRecord(mcpKey(srv));
  if (rec) await lib.revokeTokens({ fetch: (...a) => fetch(...a), record: rec });
  await vibeStore.setKey(mcpKey(srv), "");
}
