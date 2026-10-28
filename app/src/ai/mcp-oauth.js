// OAuth for remote MCP servers, per the MCP authorization spec (2025-06-18 / 2025-11-25): protected resource metadata
// (RFC 9728), authorization server metadata (RFC 8414 / OIDC discovery), dynamic client registration (RFC 7591),
// authorization code + PKCE (S256) with the `resource` parameter (RFC 8707), refresh with rotation.
//
// Public API: discoverMcpAuth, registerClient, buildAuthUrl, exchangeCode, refreshTokens, McpAuthSession.
// Invariants: pure (no DOM, no storage; `fetch` injected). Refuses authorization servers that do not advertise PKCE S256
// and endpoints that are not https (loopback excepted). One refresh at a time per session (rotating refresh tokens).
// Browser/desktop glue (redirects, loopback, storage) lives in app/src/vibe/account-auth.js. See docs/ai-engine.md.

import { OAuthError, decodeJwt, isSecureUrl, needsRefresh, parseWwwAuthenticate, postForm, tokensFromResponse } from "./oauth-core.js";

const getJson = async (f, url, signal) => {
  try {
    const res = await f(url, { headers: { Accept: "application/json" }, signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    return null;
  }
};

/** RFC 9728 candidate URLs for a resource: path-aware first, then the origin. */
export function protectedResourceUrls(serverUrl) {
  const u = new URL(serverUrl);
  const path = u.pathname.replace(/\/+$/, "");
  const out = [];
  if (path) out.push(`${u.origin}/.well-known/oauth-protected-resource${path}`);
  out.push(`${u.origin}/.well-known/oauth-protected-resource`);
  return out;
}

/** RFC 8414 + OIDC candidate URLs for an issuer (the order the MCP spec prescribes). */
export function authServerUrls(issuer) {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, "");
  if (!path) return [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
  return [`${u.origin}/.well-known/oauth-authorization-server${path}`, `${u.origin}/.well-known/openid-configuration${path}`, `${u.origin}${path}/.well-known/openid-configuration`];
}

/** The resource identifier is the server URL without fragment; the metadata `resource` must be the same origin and a path prefix. */
function resourceMatches(declared, serverUrl) {
  try {
    const a = new URL(declared);
    const b = new URL(serverUrl);
    return a.origin === b.origin && (b.pathname === a.pathname || b.pathname.startsWith(a.pathname.replace(/\/+$/, "") + "/") || a.pathname === "/");
  } catch {
    return false;
  }
}

/**
 * Finds out how to sign in to an MCP server.
 * @param {{fetch:typeof fetch, serverUrl:string, wwwAuthenticate?:string|null, signal?:AbortSignal}} o
 * @returns {Promise<{resource:string, issuer:string, authorizationEndpoint:string, tokenEndpoint:string, registrationEndpoint?:string, revocationEndpoint?:string, scopes:string[], scopesSupported:string[]}>}
 */
export async function discoverMcpAuth({ fetch: f, serverUrl, wwwAuthenticate, signal }) {
  const challenge = parseWwwAuthenticate(wwwAuthenticate);
  const candidates = [];
  if (challenge?.params.resource_metadata) candidates.push(challenge.params.resource_metadata);
  candidates.push(...protectedResourceUrls(serverUrl));
  let prm = null;
  for (const url of candidates) {
    if (!isSecureUrl(url)) continue;
    const j = await getJson(f, url, signal);
    if (j && Array.isArray(j.authorization_servers) && j.authorization_servers.length) {
      prm = j;
      break;
    }
  }
  // Older servers (spec 2025-03-26) are their own authorization server.
  const issuer = prm ? String(prm.authorization_servers[0]) : new URL(serverUrl).origin;
  if (prm && prm.resource && !resourceMatches(String(prm.resource), serverUrl)) throw new OAuthError("discovery_failed", "The server's sign-in metadata describes a different resource. Refusing to continue.");
  if (!isSecureUrl(issuer)) throw new OAuthError("discovery_failed", "The authorization server is not reachable over https.");
  let meta = null;
  for (const url of authServerUrls(issuer)) {
    const j = await getJson(f, url, signal);
    if (j && j.authorization_endpoint && j.token_endpoint) {
      meta = j;
      break;
    }
  }
  if (!meta) throw new OAuthError("discovery_failed", "This MCP server does not publish sign-in metadata. Paste an access token instead.");
  if (meta.issuer && prm && new URL(String(meta.issuer)).href !== new URL(issuer).href) throw new OAuthError("discovery_failed", "The authorization server metadata names a different issuer. Refusing to continue.");
  for (const k of ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"]) if (meta[k] && !isSecureUrl(meta[k])) throw new OAuthError("discovery_failed", `The ${k.replace(/_/g, " ")} is not https. Refusing to continue.`);
  if (!Array.isArray(meta.code_challenge_methods_supported) || !meta.code_challenge_methods_supported.includes("S256")) throw new OAuthError("pkce_unsupported", "The authorization server does not advertise PKCE (S256), which MCP requires. Refusing to sign in.");
  const scopeParam = challenge?.params.scope ? challenge.params.scope.split(/\s+/).filter(Boolean) : [];
  const supported = Array.isArray(prm?.scopes_supported) ? prm.scopes_supported.map(String) : [];
  return {
    resource: prm?.resource ? String(prm.resource) : new URL(serverUrl).href.replace(/#.*$/, ""),
    issuer,
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    registrationEndpoint: meta.registration_endpoint,
    revocationEndpoint: meta.revocation_endpoint,
    scopes: scopeParam.length ? scopeParam : supported,
    scopesSupported: supported,
  };
}

/**
 * Dynamic client registration (RFC 7591) as a public client.
 * @returns {Promise<{clientId:string, clientSecret?:string}>}
 */
export async function registerClient({ fetch: f, registrationEndpoint, redirectUri, clientName = "OpenFini", signal }) {
  if (!registrationEndpoint) throw new OAuthError("registration_unsupported", "This server does not support automatic registration. Enter a client ID in the server settings.");
  let res;
  try {
    res = await f(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
      signal,
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw new OAuthError("network_error", `Could not register with the server: ${e && e.message ? e.message : e}`);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.client_id) throw new OAuthError(json?.error || "registration_failed", `Registration was refused${json?.error ? `: ${json.error}` : ` (HTTP ${res.status})`}.`, { status: res.status });
  return { clientId: String(json.client_id), clientSecret: json.client_secret ? String(json.client_secret) : undefined };
}

/** Authorization URL (code + PKCE S256 + resource indicator). */
export function buildAuthUrl({ authorizationEndpoint, clientId, redirectUri, challenge, state, resource, scope }) {
  const u = new URL(authorizationEndpoint);
  const q = u.searchParams;
  q.set("response_type", "code");
  q.set("client_id", clientId);
  q.set("redirect_uri", redirectUri);
  q.set("code_challenge", challenge);
  q.set("code_challenge_method", "S256");
  q.set("state", state);
  if (resource) q.set("resource", resource);
  if (scope) q.set("scope", Array.isArray(scope) ? scope.join(" ") : scope);
  return u.toString();
}

const clientAuth = (rec) => (rec.clientSecret ? { Authorization: `Basic ${btoa(`${rec.clientId}:${rec.clientSecret}`)}` } : {});

/** Trades the authorization code for tokens. @param {{fetch:typeof fetch, record:object, code:string, verifier:string, redirectUri:string, now?:number, signal?:AbortSignal}} o */
export async function exchangeCode({ fetch: f, record, code, verifier, redirectUri, now = Date.now(), signal }) {
  const json = await postForm(f, record.tokenEndpoint, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, client_id: record.clientId, resource: record.resource }, { signal, headers: clientAuth(record) });
  return tokensFromResponse(json, now);
}

/** Refreshes the access token; keeps the old refresh token when the server does not rotate it. */
export async function refreshTokens({ fetch: f, record, now = Date.now(), signal }) {
  if (!record.tokens?.refreshToken) throw new OAuthError("no_refresh_token", "The sign-in has expired. Please sign in again.");
  const json = await postForm(f, record.tokenEndpoint, { grant_type: "refresh_token", refresh_token: record.tokens.refreshToken, client_id: record.clientId, resource: record.resource }, { signal, headers: clientAuth(record) });
  return tokensFromResponse(json, now, record.tokens);
}

/** Best-effort RFC 7009 revocation; never throws. */
export async function revokeTokens({ fetch: f, record }) {
  if (!record?.revocationEndpoint || !record.tokens?.refreshToken) return false;
  try {
    await postForm(f, record.revocationEndpoint, { token: record.tokens.refreshToken, token_type_hint: "refresh_token", client_id: record.clientId }, { headers: clientAuth(record) });
    return true;
  } catch {
    return false;
  }
}

/** Account label from an OIDC-style id/access token (email or name), else "". */
export function accountLabel(tokens) {
  const c = decodeJwt(tokens?.idToken) || decodeJwt(tokens?.accessToken) || {};
  return String(c.email || c.preferred_username || c.name || "");
}

/**
 * Keeps one MCP server's tokens fresh. `store.load()/save(record)` persist the record
 * `{serverUrl, resource, issuer, tokenEndpoint, revocationEndpoint?, clientId, clientSecret?, tokens}`.
 * Plug into McpClient as `auth` (see mcp.js).
 */
export class McpAuthSession {
  /** @param {{fetch:typeof fetch, store:{load:()=>Promise<object|null>, save:(r:object)=>Promise<void>}, now?:()=>number, skewMs?:number}} o */
  constructor({ fetch: f, store, now = Date.now, skewMs = 60_000 }) {
    this.fetch = f;
    this.store = store;
    this.now = now;
    this.skewMs = skewMs;
    this._refreshing = null;
  }

  /** Current access token, refreshed when it is about to expire; "" when not signed in. */
  async getAccessToken({ force = false, signal } = {}) {
    const rec = await this.store.load();
    if (!rec || !rec.tokens) return "";
    if (!force && !needsRefresh(rec.tokens, this.now(), this.skewMs)) return rec.tokens.accessToken;
    if (!rec.tokens.refreshToken) return !force && rec.tokens.expiresAt > this.now() ? rec.tokens.accessToken : "";
    this._refreshing ||= (async () => {
      try {
        const latest = (await this.store.load()) || rec; // another tab may have refreshed already
        if (!force && !needsRefresh(latest.tokens, this.now(), this.skewMs)) return latest.tokens.accessToken;
        const tokens = await refreshTokens({ fetch: this.fetch, record: latest, now: this.now(), signal });
        await this.store.save({ ...latest, tokens });
        return tokens.accessToken;
      } catch (e) {
        // a refused refresh token means "sign in again"; a network hiccup keeps the record
        if (e instanceof OAuthError && /^(invalid_grant|invalid_client|no_refresh_token|unauthorized_client|invalid_refresh_token|token_expired|refresh_token_expired|refresh_token_invalidated|refresh_token_reused)$/.test(e.code)) await this.store.save({ ...rec, tokens: null });
        throw e;
      } finally {
        this._refreshing = null;
      }
    })();
    return this._refreshing;
  }

  /** Called by McpClient on HTTP 401: tries a refresh once. @returns {Promise<boolean>} true when a new token is available */
  async onUnauthorized(/* wwwAuthenticate */) {
    try {
      return !!(await this.getAccessToken({ force: true }));
    } catch {
      return false;
    }
  }
}
