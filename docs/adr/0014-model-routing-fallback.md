# 0014: Model routing with fallback as a provider wrapper

Status: Accepted

## Context

A single model that stops answering (rate limit, overload, timeout, network error, deprecated model) ended the whole
request after the agent loop's two blind retries. Users asked for a fallback. Requirements: sub-agents and quick actions
must benefit too, user mistakes (wrong key, invalid request) must never be hidden, partially streamed answers must not be
duplicated, and the logic has to be testable without a network.

## Decision

- **A route is a provider.** `createRoutedProvider()` (`app/src/ai/routing.js`) returns an object with the normal
  provider `stream()` interface, so `runAgent`, `AgentManager` and quick actions need no changes beyond forwarding two
  extra event types (`route_retry`, `route_fallback`).
- **The model menu stays the primary.** `resolveRoute(settings)` returns `[primary, ...fallbacks]`; the saved route only
  lists fallbacks. The old `activeProvider`/`model` settings (and per-chat overrides) therefore keep working unchanged, and
  a route with no usable fallback is a one-element route that bypasses the router completely.
- **Errors are normalized once**, in `ProviderError` (`category`, `retryable`, `fallbackWorthy`; `classifyProviderError`
  in `ai/util.js`). Only `fallbackWorthy` errors move to the next target. Auth errors do not, unless the user enabled
  "also fall back on auth errors"; invalid-request errors never do. Context-length errors only move to a target with a
  larger known window.
- **State machine per request**: same-target retries with exponential backoff and jitter (a `Retry-After` above 15 s means
  "out for now": fall back instead of waiting), a per-target circuit breaker (3 consecutive failures, 60 s cool-down;
  if every target is cooling down they are all tried), a first-token timeout (45 s) and an attempt timeout. Every loop
  is bounded by `targets x (retries + 1)` attempts.
- **Mid-stream failures**: tool calls are buffered until an attempt finishes, so a failure before any text restarts the
  request cleanly. If text was already shown, the next attempt gets the partial text as an assistant message plus a
  "continue exactly where you stopped" instruction, and the final message has the partial text prepended. The alternative
  (restart and show a second answer) duplicates text; the alternative (surface the error) loses the work.
- **Statistics are counts only** (kv `vibe.routeStats`): per target ok/fail counters and the last 40 outcomes with a
  category. No prompts, no answers.

## Consequences

- One more async-generator layer in the stream path (negligible cost), and a continuation heuristic that depends on the
  fallback model following the instruction; it is covered by tests with scripted providers only, not live models.
- Sub-agents may use a different model than the one the user picked for them when the chain triggers; the notice in chat
  and the Activity log say so.
- Provider capability metadata for compatibility skipping comes from the preset (`tools`, `vision`), not from live
  model lists; unknown capabilities are treated as supported.
