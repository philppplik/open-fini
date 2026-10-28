# Sign in with an OpenAI account, and OAuth for MCP servers

Status: researched 2026-10-28 against OpenAI's public documentation. Decision record: [ADR 0017](adr/0017-openai-account-auth.md).

Users asked to use OpenFini's AI with an OpenAI (ChatGPT) account instead of an API key. This page records what
OpenAI documents, what is legitimate for OpenFini, what we built, and what we could not verify.

## Verdict

| Question | Answer |
|---|---|
| Does OpenAI document a public OAuth + PKCE flow for third-party apps that uses the user's ChatGPT plan for API calls? | **Yes, as a preview, for open-source and locally hosted apps** ("ChatGPT plan usage", part of "Sign in with ChatGPT"). |
| Can a registered client be obtained? | Yes, without a form or secret: **dynamic registration** through the authorize URL (`client_id=dynamic_agent_client`); OpenAI returns an issued `client_id` (`oaiapp_...`) in the callback. |
| Can a browser/PWA do it? | **No.** The redirect must be `http://127.0.0.1:<port>/auth/callback` (not `localhost`), and the docs exclude paid or remotely hosted apps (those must use an interest form). A hosted PWA cannot receive a loopback callback and is a remotely hosted app. |
| Can the desktop app do it? | **Yes**, with a one-shot loopback listener (small Rust command, no new dependencies). |
| Device-code flow? | Documented only for Codex CLI (`codex login --device-auth`); the third-party plan-usage pages do not mention it. **Not implemented.** |
| Reuse Codex CLI's client id or `chatgpt.com/backend-api/codex`? | **Refused.** Not documented for third parties; the plan-usage docs say "Do not use ChatGPT's `backend-api` endpoints". We never do that. |
| OAuth for MCP servers? | Yes, documented by the MCP authorization spec and used by OpenAI's own docs for tools with auth. **Implemented** for every OAuth-protected remote MCP server. |

So the outcome is **(A) for the desktop app, with honest limits**, plus MCP OAuth everywhere. In the browser the
"OpenAI account" preset explains why it is unavailable and points to the API-key preset.

## What OpenAI documents (sources)

* Overview and eligibility, "ChatGPT plan usage": <https://developers.openai.com/siwc/token-sharing-open-source>
  (open-source and locally hosted apps; "This does not grant access to their ChatGPT conversations or other account
  context"; paid or remotely hosted apps use the interest form).
* Registration and sign-in: <https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md>
  (authorize URL, dynamic registration, loopback rules, token exchange, ID-token checks).
* Accounts and sessions (refresh, revocation, multiple accounts): `.../profiles-and-sessions.md`.
* Token reference (lifetimes, claims): `.../token-reference.md`. Access token 1 hour, refresh token 30 days, rotated on every refresh.
* Models and inference: `.../models-and-inference.md`. `GET /v1/models` (entries with `visibility: "list"`), `POST /v1/responses` with `store:false` and `stream:true`.
* Preview limitations and error recovery: `.../preview-limitations.md`, `.../errors-and-recovery.md`.
* Sign in with ChatGPT for websites (identity only, selected commercial partners, needs a registered client): <https://developers.openai.com/siwc/website>. **Not used**: it yields identity, not API access.
* Codex authentication (ChatGPT login, API key, device code; localhost:1455 callback): <https://learn.chatgpt.com/docs/auth> (formerly developers.openai.com/codex/auth). Describes Codex itself; it does not authorize other apps to reuse Codex's credentials.
* Apps SDK authentication (OpenAI acting as the OAuth client of your MCP server: DCR or client-ID metadata documents, PKCE S256, `resource`, `WWW-Authenticate`): <https://developers.openai.com/apps-sdk/build/auth>.
* MCP authorization spec: <https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization>.

Endpoints (from the docs, confirmed against `https://auth.openai.com/.well-known/openid-configuration`):
authorize `https://auth.openai.com/api/accounts/authorize`, token `.../api/accounts/oauth/token`, revocation
`.../api/accounts/oauth/revoke`, API `https://api.openai.com/v1`. Scopes: `openid profile email offline_access
resource.invoke chatgpt.tokens.use.direct` (the last three are plan usage).

### Limits OpenAI documents for plan usage (and how we respect them)

* Requests: `store:false`, `stream:true`, instructions through `instructions` (no system-role items), no
  `previous_response_id` over HTTP, and a list of rejected fields (`max_output_tokens`, `temperature`, `metadata`, ...).
  `openai-responses.js` sends none of them.
* Not supported: image generation, file search, code interpreter, hosted MCP/connectors, embeddings route, audio/video.
  The preset therefore declares no image or embedding capability; function tools (all of OpenFini's) work.
* Usage is the user's **ChatGPT plan allowance**, shown to the user as such. Plan-usage errors
  (`subscription_sharing_usage_limit_exceeded`, ...) are translated into plain language.
* The preview can change or end; the UI says so.

## What we verified ourselves

* `auth.openai.com` token and revocation endpoints answer CORS preflights with `access-control-allow-origin: *`, and
  `api.openai.com/v1/responses` likewise, so the webview can call them directly. The discovery document and JWKS are
  **not** served with CORS headers, so endpoints are built in (they are documented constants) and the ID token's
  signature is not verified in the webview; the token is received directly from the token endpoint over TLS and `iss`,
  `aud`, `exp` and `nonce` are checked (OIDC Core 3.1.3.7 allows this). This deviates from OpenAI's recommendation to
  verify the signature against the JWKS.
* Everything else is covered by unit tests with fake servers. **No live sign-in, plan-usage inference or MCP OAuth
  round trip was run** (no accounts or keys in the build environment).

## Architecture

| Piece | File |
|---|---|
| OAuth helpers (form posts, `WWW-Authenticate`, JWT claims, callback validation, error type) | `app/src/ai/oauth-core.js` |
| MCP OAuth: discovery (RFC 9728, RFC 8414, OIDC), dynamic registration (RFC 7591), PKCE URL, code exchange, refresh, revoke, `McpAuthSession` | `app/src/ai/mcp-oauth.js` |
| `McpClient` hooks: `auth` option (bearer per request, one retry after 401 + refresh), `McpError.wwwAuthenticate` | `app/src/ai/mcp.js` |
| OpenAI plan-usage protocol (authorize URL, callback + ID token checks, revoke, model list, friendly errors) | `app/src/ai/openai-account.js` |
| Responses API provider (`kind: "openai-responses"`) | `app/src/ai/providers/openai-responses.js` |
| Desktop loopback listener (`oauth_loopback_start`, `oauth_loopback_wait`) | `src-tauri/src/oauth.rs` |
| Glue: redirects, loopback, storage in the vault, sign out | `app/src/vibe/account-auth.js` |
| UI (Models: "OpenAI account" form; Tools: per-server "Sign in"/"Sign out") | `app/src/ui/vibe/account-ui.js` |

Flow, OpenAI (desktop): create PKCE (`createPkce`), state, nonce and a persistent opaque host id (`urn:uuid:...`) ->
Rust binds `127.0.0.1` (port 1455 if free, otherwise any; only the port may vary) -> system browser opens the
authorize URL -> Rust returns the callback query after checking path, `Host` header and `state` (one-shot, 120 s
timeout) -> JS validates the callback, exchanges the code (PKCE, `resource`), checks the ID token, stores one JSON record
(`clientId`, `hostId`, tokens, email, plan flag) in the vault secrets -> `OAuthSession` refreshes one hour tokens ahead
of expiry (60 s window), serialized so the rotating refresh token never races; a refused refresh token clears the
tokens ("sign in again"), a network error keeps them.

Flow, MCP: probe the server unauthenticated -> `401` + `WWW-Authenticate` (`resource_metadata`, `scope`) -> discovery
(refuses servers that do not advertise PKCE S256, non-https endpoints, a `resource` or issuer that does not match) ->
dynamic registration as a public client (or a manually entered client id via `oauthClientId` on the server record) ->
authorize with `resource` -> loopback listener (desktop) or redirect back to `?vibe_oauth=mcp` (web/PWA; PKCE verifier
and state wait in `sessionStorage` only until return) -> token exchange -> `McpClient` sends the bearer token and
refreshes on 401.

## Security notes

* Tokens live only in the vault secrets (`vibeStore.secrets`), sealed with the passphrase when the key vault is on, and
  are never put in URLs, logs, toasts or `localStorage`. `core/log.js` redaction covers `access_token`, `refresh_token`,
  `id_token`, `code`-like values, bearer headers and JWTs (tested).
* The loopback listener accepts exactly one valid callback (path, loopback `Host`, exact `state`), answers everything
  else with 400, never logs, and stops after two minutes (DNS-rebinding and local-port-scan resistant).
* Only `https://api.openai.com/v1` ever receives the OpenAI access token; MCP tokens go only to that server's URL.
* Sign-out revokes the refresh token at OpenAI (`token_type_hint=refresh_token`); if revocation cannot be confirmed the UI
  says so and points to ChatGPT settings.

## Limits and not done

* Desktop only for the OpenAI account. No device-code flow (not documented for third parties).
* No account picker for several OpenAI accounts (each sign-in is one connection; add another via Add).
* The OpenAI preview terms were summarized from the linked pages; read them before shipping a release that relies on it.
* MCP: no client-ID metadata documents (CIMD), no step-up scope handling, no RFC 9207 `iss` check on the callback.
* `chatgpt.com` connector direction (OpenFini as an MCP server for ChatGPT) is out of scope.

## Testing

`node --test tests/ai/oauth.test.js tests/ai/openai-account.test.js` (PKCE, discovery fixtures, registration, refresh
timing and single flight, error cases, redaction, Responses stream, 401 retry); the Rust parser has unit tests in
`src-tauri/src/oauth.rs`. For a live check: desktop build, Settings > Artificial intelligence > Models > Add > "OpenAI
account", sign in, "Test connection".

## How to extend

Another provider with a loopback OAuth: add its protocol module next to `openai-account.js`, reuse `oauth-core.js` and
`viaLoopback` in `account-auth.js`, and store the record in the vault secrets.
