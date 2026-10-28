// "Sign in with ChatGPT" plan usage for open-source / locally hosted apps (OpenAI preview, documented at
// https://developers.openai.com/siwc/token-sharing-open-source). Pure protocol helpers; see docs/openai-account-auth.md
// for the sources, the verdict and the limits, and docs/adr/0016-openai-account-auth.md for the decision.
//
// Public API: OPENAI_AUTH, newHostId, loopbackRedirect, buildOpenAIAuthUrl, completeSignIn, revokeOpenAI,
//   parseAccountModels, planUsageGranted, friendlyAccountError.
// Invariants: pure (`fetch` injected, no DOM/storage). Only `https://api.openai.com/v1` is ever called with the token
// (never ChatGPT's backend-api). The redirect is `http://127.0.0.1:<port>/auth/callback` (the docs forbid `localhost`).
// Token refresh is shared with MCP sign-in (OAuthSession in mcp-oauth.js). Errors never contain tokens or codes.
// Deviation: the ID token is received directly from the token endpoint over TLS, so only its claims are checked; the
// JWKS endpoint sends no CORS headers and cannot be read from a webview (OIDC Core 3.1.3.7 allows this).

import { OAuthError, decodeJwt, parseCallbackQuery, postForm, tokensFromResponse } from "./oauth-core.js";

export const OPENAI_AUTH = Object.freeze({
  issuer: "https://auth.openai.com",
  authorizeUrl: "https://auth.openai.com/api/accounts/authorize",
  tokenUrl: "https://auth.openai.com/api/accounts/oauth/token",
  revokeUrl: "https://auth.openai.com/api/accounts/oauth/revoke",
  resource: "https://api.openai.com/v1",
  scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
  planScope: "chatgpt.tokens.use.direct",
  redirectPath: "/auth/callback",
  preferredPort: 1455,
  registrationClientId: "dynamic_agent_client",
});

/** Opaque per-installation host id (RFC 4122 UUID urn); persist it before the first sign-in. */
export function newHostId() {
  return `urn:uuid:${globalThis.crypto.randomUUID()}`;
}

export const loopbackRedirect = (port) => `http://127.0.0.1:${port}${OPENAI_AUTH.redirectPath}`;

/**
 * Authorization URL. First registration uses `dynamic_agent_client` + `agent_name_hint`; a saved `clientId` skips both.
 * @param {{clientId?:string, agentName?:string, hostId:string, redirectUri:string, challenge:string, state:string, nonce:string, idTokenHint?:string, loginHint?:string, forceConsent?:boolean}} o
 */
export function buildOpenAIAuthUrl(o) {
  const u = new URL(OPENAI_AUTH.authorizeUrl);
  const q = u.searchParams;
  q.set("response_type", "code");
  q.set("client_id", o.clientId || OPENAI_AUTH.registrationClientId);
  if (!o.clientId) q.set("agent_name_hint", o.agentName || "OpenFini");
  q.set("ext_agent_host_id", o.hostId);
  q.set("redirect_uri", o.redirectUri);
  q.set("scope", OPENAI_AUTH.scope);
  q.set("resource", OPENAI_AUTH.resource);
  q.set("state", o.state);
  q.set("nonce", o.nonce);
  q.set("code_challenge", o.challenge);
  q.set("code_challenge_method", "S256");
  if (o.idTokenHint) q.set("id_token_hint", o.idTokenHint);
  if (o.loginHint) q.set("login_hint", o.loginHint);
  if (o.forceConsent) q.set("prompt", "consent");
  return u.toString();
}

/** True when the granted scopes allow using the ChatGPT plan for API calls. */
export const planUsageGranted = (scope) => String(scope || "").split(/\s+/).includes(OPENAI_AUTH.planScope);

/**
 * Finishes a sign-in: validates the callback, exchanges the code (PKCE), checks the ID token claims.
 * @param {{fetch:typeof fetch, query:string|URLSearchParams, expect:{state:string, nonce:string, verifier:string, redirectUri:string, hostId:string, clientId?:string}, now?:number}} o
 * @returns {Promise<{provider:'openai-account', issuer:string, clientId:string, hostId:string, subject:string, email:string, name:string, planUsage:boolean, resource:string, tokenEndpoint:string, revocationEndpoint:string, tokens:object}>}
 */
export async function completeSignIn({ fetch: f, query, expect, now = Date.now() }) {
  const { code, params } = parseCallbackQuery(query, expect.state);
  const issued = params.get("client_id") || "";
  if (expect.clientId && issued && issued !== expect.clientId) throw new OAuthError("client_mismatch", "The sign-in answered for a different registration. Please try again.");
  const clientId = expect.clientId || issued;
  if (!clientId) throw new OAuthError("registration_incomplete", "OpenAI did not issue a client ID for this app. Please try again.");
  const json = await postForm(f, OPENAI_AUTH.tokenUrl, { grant_type: "authorization_code", client_id: clientId, code, code_verifier: expect.verifier, redirect_uri: expect.redirectUri, resource: OPENAI_AUTH.resource });
  const tokens = tokensFromResponse(json, now);
  const claims = decodeJwt(tokens.idToken);
  if (!claims) throw new OAuthError("bad_id_token", "OpenAI returned no readable ID token.");
  const aud = [].concat(claims.aud || []);
  if (claims.iss !== OPENAI_AUTH.issuer) throw new OAuthError("bad_id_token", "The ID token was not issued by OpenAI.");
  if (!aud.includes(clientId)) throw new OAuthError("bad_id_token", "The ID token is for a different client.");
  if (!(claims.exp * 1000 > now - 5000)) throw new OAuthError("bad_id_token", "The ID token has already expired.");
  if (claims.nonce !== expect.nonce) throw new OAuthError("bad_id_token", "The ID token does not belong to this sign-in.");
  return {
    provider: "openai-account",
    issuer: OPENAI_AUTH.issuer,
    clientId,
    hostId: expect.hostId,
    subject: String(claims.sub || ""),
    email: String(claims.email || ""),
    name: String(claims.name || ""),
    planUsage: planUsageGranted(tokens.scope || params.get("scope")),
    resource: OPENAI_AUTH.resource,
    tokenEndpoint: OPENAI_AUTH.tokenUrl,
    revocationEndpoint: OPENAI_AUTH.revokeUrl,
    tokens,
  };
}

/** Revokes the refresh token (documented sign-out). @returns {Promise<boolean>} false when revocation could not be confirmed */
export async function revokeOpenAI({ fetch: f, record }) {
  if (!record?.tokens?.refreshToken) return true;
  try {
    await postForm(f, OPENAI_AUTH.revokeUrl, { token: record.tokens.refreshToken, token_type_hint: "refresh_token", client_id: record.clientId });
    return true;
  } catch {
    return false;
  }
}

/** Account-specific model list from `GET /v1/models` (`{models:[{slug, display_name, visibility}]}`); keeps the server's order. */
export function parseAccountModels(json) {
  const arr = Array.isArray(json?.models) ? json.models : Array.isArray(json?.data) ? json.data : [];
  const out = [];
  for (const m of arr) {
    if (!m) continue;
    if (m.visibility && m.visibility !== "list") continue;
    const id = m.slug || m.id;
    if (typeof id === "string" && id) out.push({ id, name: typeof m.display_name === "string" ? m.display_name : undefined });
  }
  return out;
}

const FRIENDLY = {
  subscription_sharing_usage_limit_exceeded: "Your ChatGPT plan's usage limit for apps is used up for now. Check ChatGPT settings, Usage, or use an API key instead.",
  subscription_sharing_user_not_eligible: "Your ChatGPT plan or region is not eligible for plan usage in other apps. Use an API key instead.",
  subscription_sharing_usage_unavailable: "ChatGPT plan usage is temporarily unavailable. Try again in a moment.",
  subscription_sharing_user_unavailable: "ChatGPT plan usage is temporarily unavailable. Try again in a moment.",
  subscription_sharing_unsupported_capability: "This request uses a feature that plan usage does not support.",
  subscription_sharing_route_not_supported: "This request type is not available with a ChatGPT account.",
  subscription_sharing_invalid_user: "OpenAI rejected the sign-in. Sign in again in Settings.",
  chatpass_v2_scope_not_authorized: "Plan usage was not granted. Sign in again and allow plan usage.",
  chatpass_v2_invalid_authorization_context: "Plan usage was not granted. Sign in again and allow plan usage.",
};

/** Plain-language text for the documented plan-usage error codes, or null for other codes. */
export const friendlyAccountError = (code) => FRIENDLY[String(code)] || null;
