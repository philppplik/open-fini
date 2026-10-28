// Shared, pure OAuth 2.x helpers for the MCP sign-in and the OpenAI account sign-in.
// Public API: OAuthError, formBody, parseWwwAuthenticate, decodeJwt, tokensFromResponse, needsRefresh, postForm,
//   isSecureUrl, parseCallbackQuery.
// Invariants: no DOM, no storage, `fetch` is injected. Error messages never contain tokens, codes or secrets:
// only the server's `error` / `error_description` fields (which do not carry credentials) are surfaced.

/** Sign-in failure with a stable machine code (`invalid_grant`, `invalid_client`, `network_error`, `discovery_failed`, ...). */
export class OAuthError extends Error {
  /** @param {string} code @param {string} message @param {{status?:number}} [info] */
  constructor(code, message, info = {}) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
    this.status = info.status;
  }
}

/** application/x-www-form-urlencoded body from an object (undefined/null/"" values are skipped). */
export function formBody(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p.toString();
}

/**
 * Parses a `WWW-Authenticate` header (RFC 9110). Returns the first Bearer challenge's parameters, lower-cased keys.
 * @param {string|null|undefined} header
 * @returns {{scheme:string, params:Record<string,string>}|null}
 */
export function parseWwwAuthenticate(header) {
  if (!header) return null;
  const m = /(?:^|[\s,])Bearer(?=\s|$)/i.exec(header);
  if (!m) return null;
  const rest = header.slice(m.index + m[0].length);
  const params = {};
  const re = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  let x;
  while ((x = re.exec(rest))) {
    // a later challenge (another auth-scheme) ends the Bearer parameters
    if (/\s(Basic|Digest|Negotiate)\s/i.test(rest.slice(0, x.index))) break;
    params[x[1].toLowerCase()] = x[2] !== undefined ? x[2].replace(/\\(.)/g, "$1") : x[3];
  }
  return { scheme: "Bearer", params };
}

/** Decodes a JWT payload WITHOUT verifying the signature (use only for display / claim checks on tokens received directly from the token endpoint). */
export function decodeJwt(jwt) {
  const part = String(jwt || "").split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bin = atob(b64);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/**
 * Normalizes a token endpoint response.
 * @param {any} json @param {number} now epoch ms @param {{refreshToken?:string}} [prev] keeps the old refresh token when the server does not rotate it
 */
export function tokensFromResponse(json, now, prev = {}) {
  if (!json || typeof json.access_token !== "string" || !json.access_token) throw new OAuthError("bad_response", "The sign-in server returned no access token.");
  const expires = Number(json.expires_in);
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : prev.refreshToken || "",
    idToken: typeof json.id_token === "string" ? json.id_token : undefined,
    tokenType: json.token_type || "Bearer",
    scope: typeof json.scope === "string" ? json.scope : "",
    // servers that omit expires_in: assume one hour
    expiresAt: now + (Number.isFinite(expires) && expires > 0 ? expires : 3600) * 1000,
    savedAt: now,
  };
}

/** True when the access token is expired or within `skewMs` of expiring. */
export function needsRefresh(tokens, now = Date.now(), skewMs = 60_000) {
  return !tokens || !tokens.accessToken || !(tokens.expiresAt > now + skewMs);
}

/** https is required for every sign-in endpoint; plain http only for loopback (local dev servers). */
export function isSecureUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
  } catch {
    return false;
  }
}

/**
 * POSTs a form and parses the JSON answer. Throws OAuthError (code = the server's `error`, else `http_<status>`).
 * @param {typeof fetch} f @param {string} url @param {Record<string,any>} body @param {{signal?:AbortSignal, headers?:Record<string,string>}} [o]
 */
export async function postForm(f, url, body, o = {}) {
  let res;
  try {
    res = await f(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...(o.headers || {}) }, body: formBody(body), signal: o.signal });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw new OAuthError("network_error", `Could not reach the sign-in server: ${e && e.message ? e.message : e}`);
  }
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const code = (json && typeof json.error === "string" && json.error) || `http_${res.status}`;
    const desc = json && typeof json.error_description === "string" ? json.error_description : "";
    throw new OAuthError(code, `${code}${desc ? `: ${desc}` : ""}`, { status: res.status });
  }
  return json || {};
}

/**
 * Validates an OAuth callback query. Checks `error` first, then `state`.
 * @param {string|URLSearchParams} query @param {string} expectedState
 * @returns {{code:string, params:URLSearchParams}}
 */
export function parseCallbackQuery(query, expectedState) {
  const p = query instanceof URLSearchParams ? query : new URLSearchParams(String(query).replace(/^\?/, ""));
  if (p.get("error")) throw new OAuthError(p.get("error"), `The sign-in was not completed: ${p.get("error")}${p.get("error_description") ? ` (${p.get("error_description")})` : ""}`);
  if (!expectedState || p.get("state") !== expectedState) throw new OAuthError("state_mismatch", "The sign-in response did not match this request. Please try again.");
  const code = p.get("code");
  if (!code) throw new OAuthError("no_code", "The sign-in response contained no code.");
  return { code, params: p };
}
