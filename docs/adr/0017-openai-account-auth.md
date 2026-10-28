# 0017: OpenAI account sign-in on desktop, OAuth for MCP servers, nothing undocumented

Status: Accepted

## Context

Users want to use an OpenAI (ChatGPT) account instead of an API key. Two unofficial routes exist in the wild: reusing the
Codex CLI's client id, and calling ChatGPT's `backend-api/codex`. OpenAI also documents a preview, "ChatGPT plan usage"
for open-source and locally hosted apps, with dynamic client registration, PKCE, a loopback redirect and the public
Responses API (`docs/openai-account-auth.md` has the sources).

## Decision

- Implement only the documented preview. Never use the Codex client id or `backend-api`.
- Desktop only: OpenAI requires `http://127.0.0.1:<port>/auth/callback`; a browser cannot listen, and hosted apps are
  excluded. The web build shows why and points to the API-key preset.
- A small Rust command pair (`oauth_loopback_start` / `_wait`, std only) receives the callback: one shot, loopback `Host`
  check, exact `state`, 120 s timeout. No HTTP client dependency: the token endpoints allow CORS, so JS exchanges tokens.
- A separate provider kind `openai-responses` (preset `openai-account`) because plan usage works only through the
  Responses API with `store:false`/`stream:true` and a restricted field set; the Chat Completions provider is untouched.
- Tokens are one JSON record in the existing vault secrets, refreshed by a single-flight session shared with MCP OAuth.
- Implement OAuth for MCP servers per the MCP authorization spec (discovery, DCR, PKCE S256, `resource`, refresh); it is
  generally useful and the one documented "tools with auth" mechanism. Servers without S256 are refused.
- ID-token signatures are not verified in the webview (JWKS has no CORS); claims are checked, the token comes straight from
  the token endpoint over TLS.

## Consequences

- Behavior depends on a preview that may change; the UI says so and API keys stay first-class.
- Not live-tested here (no accounts); covered by fake-server unit tests. The first release should be checked by hand.
- One more provider kind and about 600 lines of lazily loaded JS; Rust grows by one small module.
- Rejected: Codex client reuse (undocumented, may violate terms), device code (undocumented for third parties),
  a Rust HTTP client (size), a localhost web proxy (unneeded).
