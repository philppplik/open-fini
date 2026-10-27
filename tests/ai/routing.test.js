import test from "node:test";
import assert from "node:assert/strict";
import { createMockProvider } from "../../app/src/ai/providers/mock.js";
import { runAgent } from "../../app/src/ai/agent.js";
import { ProviderError, isAbortError } from "../../app/src/ai/util.js";
import { createRoutedProvider, RouteError, RouteHealth, RouteStats, resolveRoute, suggestFallback, testRoute, normalizePolicy, fallbackNotice } from "../../app/src/ai/routing.js";

// fake timers: macrotask based, so a hanging provider "times out" only after all microtask work is done
const timers = { set: (f) => setImmediate(f), clear: (h) => clearImmediate(h) };
const delays = [];
const sleep = async (ms) => void delays.push(ms);
const textScript = (text) =>
  async function* () {
    for (const w of text.match(/.{1,6}/g)) yield { type: "text", delta: w };
  };
const prov = (name, failures, text = "Hello from " + name) => createMockProvider({ name, failures, script: textScript(text) });
const T = (provider, model = provider.name, extra = {}) => ({ providerId: provider.name, model, provider, ...extra });
const ask = (text = "hi") => ({ model: "x", messages: [{ role: "user", content: text }] });
const drain = async (p, req = ask(), signal) => {
  const events = [];
  for await (const e of p.stream(req, { signal })) events.push(e);
  return events;
};
const textOf = (events) => events.filter((e) => e.type === "text").map((e) => e.delta).join("");
const mk = (targets, policy = {}, extra = {}) => createRoutedProvider({ targets, policy: { baseDelayMs: 1, ...policy }, timers, sleep, random: () => 0.5, ...extra });

test("429 then success on the same target (retry with backoff)", async () => {
  delays.length = 0;
  const a = prov("a", [{ type: "http", status: 429, code: "rate_limit_error" }]);
  const b = prov("b");
  const ev = await drain(mk([T(a), T(b)]));
  assert.equal(textOf(ev), "Hello from a");
  assert.equal(b.calls, 0);
  assert.ok(ev.some((e) => e.type === "route_retry" && e.category === "rate_limit"));
  assert.equal(delays.length, 1);
});

test("timeout (no first token) falls back to the next target", async () => {
  const a = prov("a", [{ type: "timeout" }, { type: "timeout" }]);
  const b = prov("b");
  const ev = await drain(mk([T(a, "a", { timeoutMs: 20 }), T(b, "b")]));
  const fb = ev.find((e) => e.type === "route_fallback");
  assert.ok(fb);
  assert.equal(fb.category, "timeout");
  assert.match(fb.text, /Switched to b after a timeout/);
  assert.equal(textOf(ev), "Hello from b");
});

test("mid-stream cut continues on the fallback without duplicating text", async () => {
  const full = "The quick brown fox jumps over the lazy dog.";
  const a = createMockProvider({ name: "a", failures: [{ type: "cut", afterChars: 12 }], script: textScript(full) });
  let seen;
  const b = createMockProvider({
    name: "b",
    script: async function* (req) {
      seen = req.messages;
      yield { type: "text", delta: " (rest)" };
    },
  });
  const ev = await drain(mk([T(a), T(b)], { retriesPerTarget: 0 }));
  const done = ev.find((e) => e.type === "done");
  const partial = textOf(ev.filter((e) => e !== done)).replace(" (rest)", "");
  assert.ok(partial.length >= 12 && full.startsWith(partial));
  assert.equal(done.message.content[0].text, partial + " (rest)");
  assert.equal(seen[seen.length - 2].role, "assistant");
  assert.equal(seen[seen.length - 2].content, partial);
  assert.match(seen[seen.length - 1].content, /Continue exactly/);
});

test("failure before any text restarts cleanly (buffered tool calls are dropped)", async () => {
  let n = 0;
  const a = createMockProvider({
    name: "a",
    script: async function* () {
      yield { type: "tool_call", id: "t1", name: "x", input: {} };
      if (n++ === 0) throw new ProviderError("down", { status: 503, code: "overloaded_error", retryable: true });
    },
  });
  const ev = await drain(mk([T(a)], { retriesPerTarget: 1 }));
  assert.equal(ev.filter((e) => e.type === "tool_call").length, 1);
});

test("auth errors are surfaced, not hidden by a fallback (unless enabled)", async () => {
  const a = prov("a", [{ type: "http", status: 401, code: "invalid_api_key" }]);
  const b = prov("b");
  await assert.rejects(drain(mk([T(a), T(b)])), (e) => e.category === "auth");
  assert.equal(b.calls, 0);
  const a2 = prov("a", [{ type: "http", status: 401, code: "invalid_api_key" }]);
  const ev = await drain(mk([T(a2), T(b)], { fallbackOnAuth: true }));
  assert.equal(textOf(ev), "Hello from b");
});

test("invalid requests are surfaced", async () => {
  const a = prov("a", [{ type: "http", status: 400, code: "invalid_request_error", message: "bad schema" }]);
  await assert.rejects(drain(mk([T(a), T(prov("b"))])), (e) => e.category === "invalid_request");
});

test("all targets down: aggregated error lists every attempt", async () => {
  const down = { type: "http", status: 503, code: "overloaded_error", message: "busy" };
  const a = prov("a", [down, down, down]);
  const b = prov("b", [{ type: "http", status: 500, message: "boom" }, { type: "http", status: 500, message: "boom" }]);
  await assert.rejects(drain(mk([T(a), T(b)])), (e) => {
    assert.ok(e instanceof RouteError);
    assert.equal(e.attempts.length, 4);
    assert.match(e.message, /a: overloaded/);
    assert.match(e.message, /b: unknown \(HTTP 500\)/);
    return true;
  });
});

test("tool and vision compatibility skip targets", async () => {
  const a = prov("a");
  const b = prov("b");
  const p = mk([T(a, "a", { capabilities: { tools: false } }), T(b)]);
  const ev = await drain(p, { ...ask(), tools: [{ name: "t", description: "", inputSchema: {} }] });
  assert.equal(textOf(ev), "Hello from b");
  assert.equal(a.calls, 0);
  const img = { model: "x", messages: [{ role: "user", content: [{ type: "image", mime: "image/png", data: "AA" }] }] };
  const p2 = mk([T(a, "a", { capabilities: { vision: false } })]);
  await assert.rejects(drain(p2, img), (e) => e instanceof RouteError && /cannot read images/.test(e.message));
});

test("context_length error switches only to a larger window", async () => {
  const a = prov("a", [{ type: "http", status: 400, code: "context_length_exceeded", message: "maximum context length is 8000 tokens" }]);
  const small = prov("small");
  const big = prov("big");
  const ev = await drain(mk([T(a, "a", { capabilities: { contextWindow: 8000 } }), T(small, "small", { capabilities: { contextWindow: 4000 } }), T(big, "big", { capabilities: { contextWindow: 200000 } })]));
  assert.equal(textOf(ev), "Hello from big");
  assert.equal(small.calls, 0);
});

test("circuit breaker skips a failing target after the threshold, then recovers after the cooldown", async () => {
  let now = 0;
  const health = new RouteHealth(() => now);
  const down = { type: "http", status: 503, code: "overloaded_error" };
  const a = createMockProvider({ name: "a", failures: (i) => (i < 3 ? down : null), script: textScript("A") });
  const b = prov("b");
  const p = mk([T(a), T(b)], { retriesPerTarget: 0, breakerThreshold: 3, breakerCooldownMs: 1000 }, { health });
  for (let i = 0; i < 3; i++) await drain(p);
  assert.equal(a.calls, 3);
  await drain(p); // breaker open: a is not called
  assert.equal(a.calls, 3);
  now = 2000;
  assert.equal(textOf(await drain(p)), "A");
});

test("user abort is never converted into a fallback", async () => {
  const a = prov("a", [{ type: "timeout" }]);
  const b = prov("b");
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 5);
  await assert.rejects(drain(mk([T(a), T(b)], { firstTokenTimeoutMs: 0, attemptTimeoutMs: 0 }), ask(), ctl.signal), isAbortError);
  assert.equal(b.calls, 0);
});

test("long Retry-After skips retrying the same target", async () => {
  const a = prov("a", [{ type: "http", status: 429, code: "FreeUsageLimitError", message: "Free usage limit reached", retryAfterMs: 17_000_000 }]);
  const ev = await drain(mk([T(a), T(prov("b"))]));
  assert.ok(!ev.some((e) => e.type === "route_retry"));
  assert.ok(ev.some((e) => e.type === "route_fallback"));
});

test("runAgent surfaces route events and keeps one assistant message", async () => {
  const a = prov("a", [{ type: "cut", afterChars: 6 }]);
  const b = createMockProvider({ name: "b", script: async function* () { yield { type: "text", delta: " world" }; } });
  const events = [];
  const res = await runAgent({ provider: mk([T(a), T(b)], { retriesPerTarget: 0 }), model: "x", messages: [{ role: "user", content: "hi" }], onEvent: (e) => events.push(e) });
  assert.equal(res.stopReason, "end");
  assert.ok(events.some((e) => e.type === "route_fallback"));
  assert.equal(res.messages.length, 1);
  assert.match(res.messages[0].content.map((b) => b.text).join(""), /^Hello from a\s*world$|world$/);
});

test("randomized failure sequences always terminate within the attempt bound", async () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const kinds = [
    () => ({ type: "http", status: 429, code: "rate_limit_error" }),
    () => ({ type: "http", status: 503, code: "overloaded_error" }),
    () => ({ type: "http", status: 500 }),
    () => ({ type: "http", status: 404, message: "model not found" }),
    () => ({ type: "http", status: 401, code: "invalid_api_key" }),
    () => ({ type: "http", status: 400, code: "invalid_request_error" }),
    () => ({ type: "network" }),
    () => ({ type: "cut", afterChars: 7 }),
    () => ({ type: "empty" }),
    () => ({ type: "timeout" }),
    () => null,
  ];
  for (let run = 0; run < 1500; run++) {
    const n = 1 + Math.floor(rnd() * 4);
    const retries = Math.floor(rnd() * 3);
    const targets = [];
    const provs = [];
    for (let i = 0; i < n; i++) {
      const list = Array.from({ length: 6 }, () => kinds[Math.floor(rnd() * kinds.length)]());
      const p = prov("p" + i, list);
      provs.push(p);
      targets.push(T(p, "m" + i, { timeoutMs: 5 }));
    }
    const p = mk(targets, { retriesPerTarget: retries, breakerThreshold: 1 + Math.floor(rnd() * 3), fallbackOnAuth: rnd() < 0.3, attemptTimeoutMs: 50 }, { health: new RouteHealth() });
    let outcome;
    try {
      const ev = await drain(p);
      outcome = ev.some((e) => e.type === "done") ? "ok" : "nodone";
    } catch (e) {
      outcome = e instanceof ProviderError ? "err" : "bad:" + e;
    }
    assert.ok(outcome === "ok" || outcome === "err", `run ${run}: ${outcome}`);
    const total = provs.reduce((s, x) => s + x.calls, 0);
    assert.ok(total <= n * (retries + 1), `run ${run}: ${total} attempts > ${n * (retries + 1)}`);
  }
});

test("resolveRoute: single model is a one-element route; chain, primary override and opt-out", () => {
  const s = { activeProvider: "p1", model: "m1", routes: [{ id: "r", name: "Chain", targets: [{ providerId: "p1", model: "m1" }, { providerId: "p2", model: "m2", enabled: false }, { providerId: "p3", model: "m3" }], policy: { retriesPerTarget: 3 } }], activeRoute: "r" };
  assert.deepEqual(resolveRoute({ activeProvider: "p1", model: "m1" }).targets, [{ providerId: "p1", model: "m1" }]);
  const r = resolveRoute(s);
  assert.deepEqual(r.targets.map((t) => t.model), ["m1", "m3"]);
  assert.equal(r.policy.retriesPerTarget, 3);
  assert.deepEqual(resolveRoute(s, { primary: { providerId: "p9", model: "z" } }).targets.map((t) => t.model), ["z", "m1", "m3"]);
  assert.equal(resolveRoute(s, { useFallback: false }).chain, false);
});

test("stats, suggestions, policy clamping and notices", () => {
  let now = 1e9;
  const st = new RouteStats({}, () => now);
  for (let i = 0; i < 3; i++) st.record("p/m", false, "timeout");
  st.record("p/m", true);
  assert.equal(st.summary("p/m").rate, 0.25);
  const route = { targets: [{ providerId: "p", model: "m", label: "M" }] };
  assert.match(suggestFallback(st, route).text, /failed 3 times/);
  now += 2 * 86400000;
  assert.equal(suggestFallback(st, route), null);
  assert.equal(normalizePolicy({ retriesPerTarget: 99 }).retriesPerTarget, 5);
  assert.equal(fallbackNotice("Claude Haiku", "timeout"), "Switched to Claude Haiku after a timeout.");
});

test("testRoute reports per target without falling back", async () => {
  const out = await testRoute([T(prov("a", [{ type: "http", status: 503, code: "overloaded_error" }])), T(prov("b"))], { timers });
  assert.deepEqual(out.map((r) => r.ok), [false, true]);
  assert.equal(out[0].category, "overloaded");
});
