import test from "node:test";
import assert from "node:assert/strict";
import { errorFromBody, classifyProviderError, ProviderError } from "../../app/src/ai/util.js";

// Fixtures: real-world error bodies of OpenAI-compatible and Anthropic APIs (and OpenCode Zen, observed 2026-10-27).
const FIX = [
  ["openai 429 rate limit", { error: { message: "Rate limit reached for gpt-5 in organization org-x on tokens per min.", type: "tokens", code: "rate_limit_exceeded" } }, 429, "rate_limit", true, true],
  ["openai insufficient quota", { error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" } }, 429, "rate_limit", false, true],
  ["openai bad key", { error: { message: "Incorrect API key provided: sk-***.", type: "invalid_request_error", code: "invalid_api_key" } }, 401, "auth", false, false],
  ["openai context length", { error: { message: "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.", type: "invalid_request_error", code: "context_length_exceeded" } }, 400, "context_length", false, true],
  ["openai model not found", { error: { message: "The model `gpt-9` does not exist or you do not have access to it.", type: "invalid_request_error", code: "model_not_found" } }, 404, "model_unavailable", false, true],
  ["openai 500", { error: { message: "The server had an error while processing your request.", type: "server_error" } }, 500, "unknown", true, true],
  ["openai 503", { error: { message: "That model is currently overloaded with other requests.", type: "server_error" } }, 503, "overloaded", true, true],
  ["openai invalid schema", { error: { message: "Invalid schema for function 'x'", type: "invalid_request_error", param: "tools" } }, 400, "invalid_request", false, false],
  ["openai content filter", { error: { message: "Your request was rejected as a result of our safety system.", type: "invalid_request_error", code: "content_policy_violation" } }, 400, "content_filter", false, true],
  ["anthropic 529 overloaded", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529, "overloaded", true, true],
  ["anthropic 429", { type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" } }, 429, "rate_limit", true, true],
  ["anthropic 401", { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401, "auth", false, false],
  ["anthropic 403", { type: "error", error: { type: "permission_error", message: "Your API key does not have permission to use the specified resource." } }, 403, "auth", false, false],
  ["anthropic too long", { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 maximum" } }, 400, "context_length", false, true],
  ["anthropic 404 model", { type: "error", error: { type: "not_found_error", message: "model: claude-nope" } }, 404, "model_unavailable", false, true],
  ["anthropic 500", { type: "error", error: { type: "api_error", message: "Internal server error" } }, 500, "unknown", true, true],
  ["anthropic 400", { type: "error", error: { type: "invalid_request_error", message: "messages: roles must alternate" } }, 400, "invalid_request", false, false],
  ["opencode zen free limit", { type: "error", error: { type: "FreeUsageLimitError", message: "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go" } }, 429, "rate_limit", false, true],
  ["gateway timeout", "<html>504</html>", 504, "timeout", true, true],
  ["request timeout", { error: { message: "Request timed out." } }, 408, "timeout", true, true],
];

for (const [name, body, status, category, retryable, fallbackWorthy] of FIX) {
  test(`classification: ${name}`, () => {
    const e = errorFromBody(typeof body === "string" ? undefined : body, typeof body === "string" ? body : "", status, undefined, "x");
    assert.equal(e.category, category);
    assert.equal(e.retryable, retryable);
    assert.equal(e.fallbackWorthy, fallbackWorthy);
  });
}

test("classification: network errors and explicit overrides", () => {
  const n = new ProviderError("Network error: Failed to fetch", { status: 0, code: "network_error", retryable: true });
  assert.equal(n.category, "network");
  assert.equal(n.fallbackWorthy, true);
  assert.equal(new ProviderError("x", { status: 500, category: "auth", fallbackWorthy: false }).category, "auth");
  assert.equal(classifyProviderError({ status: 0, code: "stream_truncated", message: "The stream ended before the model finished." }).category, "network");
});
