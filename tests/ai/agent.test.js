import test from "node:test";
import assert from "node:assert/strict";
import { runAgent, compactMessages, estimateTokens, validateSchema, truncateText } from "../../app/src/ai/agent.js";
import { createMockProvider } from "../../app/src/ai/providers/mock.js";
import { ProviderError } from "../../app/src/ai/util.js";
import { scriptedProvider, textTurn, toolTurn } from "./helpers.js";

const noSleep = async () => {};
const schema = { type: "object", properties: { n: { type: "integer", minimum: 1 }, label: { type: "string", enum: ["a", "b"] } }, required: ["n"], additionalProperties: false };
const user = (t) => ({ role: "user", content: t });
const results = (r) => r.messages.filter((m) => m.role === "user").flatMap((m) => m.content);

function run(opts) {
  const events = [];
  const p = runAgent({ model: "m", messages: [user("go")], sleep: noSleep, ...opts, onEvent: (e) => events.push(e) });
  return p.then((r) => ({ ...r, events }));
}

test("agent: multi-step tool use, events and usage", async () => {
  const provider = scriptedProvider([
    async function* () {
      yield { type: "usage", input: 10, output: 5 };
      yield* toolTurn([{ id: "c1", name: "echo", input: { n: 2 } }], "Working")();
    },
    textTurn("All done"),
  ]);
  const tool = { name: "echo", description: "e", inputSchema: schema, run: (i) => ({ doubled: i.n * 2 }) };
  const r = await run({ provider, tools: [tool], system: "SYS" });
  assert.equal(r.stopReason, "end");
  assert.equal(r.steps, 2);
  assert.deepEqual(r.usage, { input: 10, output: 5 });
  assert.deepEqual(r.messages.map((m) => m.role), ["assistant", "user", "assistant"]);
  assert.deepEqual(r.messages[1].content[0], { type: "tool_result", toolUseId: "c1", content: '{"doubled":4}' });
  assert.deepEqual(r.events.map((e) => e.type), ["step", "usage", "text", "tool_start", "tool_end", "step", "text", "done"]);
  const end = r.events.find((e) => e.type === "tool_end");
  assert.equal(end.isError, false);
  assert.ok(end.ms >= 0);
  assert.equal(provider.requests[0].system, "SYS");
  assert.equal(provider.requests[1].messages.length, 3);
  assert.deepEqual(provider.requests[0].tools[0].name, "echo");
});

test("agent: runs the demo (mock) provider end to end, using ids from earlier tool results", async () => {
  let n = 0;
  const log = [];
  const mkTool = (name, extra = {}) => ({
    name,
    description: name,
    inputSchema: { type: "object" },
    run: (input) => {
      log.push([name, input]);
      return name === "new_document" ? { id: "doc1" } : { id: `L${++n}` };
    },
    ...extra,
  });
  const tools = ["new_document", "add_shape", "add_text", "set_style", "screenshot"].map((x) => mkTool(x));
  const r = await run({ provider: createMockProvider(), tools, messages: [user("Draw a blue rectangle and a circle with an outline")] });
  assert.equal(r.stopReason, "end");
  const names = log.map((l) => l[0]);
  assert.deepEqual(names, ["add_shape", "add_shape", "set_style", "screenshot"]);
  assert.equal(log[0][1].type, "rect");
  assert.equal(log[0][1].fill, "#3b82f6");
  assert.equal(log[1][1].type, "ellipse");
  assert.deepEqual(log[2][1].ids, ["L1", "L2"]);
  const last = r.messages.at(-1);
  assert.equal(last.role, "assistant");
  assert.match(last.content[0].text, /Done/);
});

test("agent: read-only tools run in parallel, others sequentially in call order", async () => {
  const order = [];
  let release;
  const gate = new Promise((res) => (release = res));
  const ro1 = { name: "r1", description: "", inputSchema: { type: "object" }, readOnly: true, run: async () => { order.push("r1-start"); await gate; order.push("r1-end"); return "1"; } };
  const ro2 = { name: "r2", description: "", inputSchema: { type: "object" }, readOnly: true, run: async () => { order.push("r2-start"); release(); return "2"; } };
  const w1 = { name: "w1", description: "", inputSchema: { type: "object" }, run: async () => { order.push("w1"); return "w1"; } };
  const w2 = { name: "w2", description: "", inputSchema: { type: "object" }, run: async () => { order.push("w2"); return "w2"; } };
  const provider = scriptedProvider([
    toolTurn([
      { id: "a", name: "w1", input: {} },
      { id: "b", name: "r1", input: {} },
      { id: "c", name: "r2", input: {} },
      { id: "d", name: "w2", input: {} },
    ]),
    textTurn("ok"),
  ]);
  const r = await run({ provider, tools: [ro1, ro2, w1, w2] });
  assert.deepEqual(order, ["w1", "r1-start", "r2-start", "r1-end", "w2"]);
  assert.deepEqual(results(r).map((b) => b.toolUseId), ["a", "b", "c", "d"]);
});

test("agent: approval granted, denied, and missing handler", async () => {
  const ran = [];
  const tool = { name: "del", description: "", inputSchema: { type: "object", properties: { x: { type: "string" } } }, needsApproval: (i) => (i.x === "safe" ? false : "Delete " + i.x), run: (i) => (ran.push(i.x), "deleted") };
  const mk = () => scriptedProvider([toolTurn([{ id: "1", name: "del", input: { x: "layer" } }]), textTurn("fin")]);
  const asked = [];
  const ok = await run({ provider: mk(), tools: [tool], approve: (q) => (asked.push(q), true) });
  assert.deepEqual(asked, [{ id: "1", name: "del", input: { x: "layer" }, reason: "Delete layer" }]);
  assert.equal(results(ok)[0].content, "deleted");
  const no = await run({ provider: mk(), tools: [tool], approve: async () => false });
  assert.equal(results(no)[0].isError, true);
  assert.equal(results(no)[0].content, "The user declined this action.");
  assert.equal(ran.length, 1);
  const none = await run({ provider: mk(), tools: [tool] });
  assert.equal(results(none)[0].isError, true);
  const safe = await run({ provider: scriptedProvider([toolTurn([{ id: "1", name: "del", input: { x: "safe" } }]), textTurn("fin")]), tools: [tool], approve: () => assert.fail("no approval needed") });
  assert.equal(results(safe)[0].content, "deleted");
});

test("agent: invalid input, unknown tool, thrown error, unparseable arguments never crash the loop", async () => {
  const boom = { name: "boom", description: "", inputSchema: { type: "object" }, run: () => { throw new Error("kaput"); } };
  const echo = { name: "echo", description: "", inputSchema: schema, run: () => "x" };
  const provider = scriptedProvider([
    toolTurn([
      { id: "1", name: "echo", input: { n: 0, label: "z", extra: true } },
      { id: "2", name: "nope", input: {} },
      { id: "3", name: "boom", input: {} },
      { id: "4", name: "echo", input: {}, error: "Tool arguments were not valid JSON." },
    ]),
    textTurn("recovered"),
  ]);
  const r = await run({ provider, tools: [echo, boom] });
  const res = results(r);
  assert.ok(res.every((b) => b.isError));
  assert.match(res[0].content, /input\.n must be >= 1/);
  assert.match(res[0].content, /input\.label must be one of/);
  assert.match(res[0].content, /extra is not an allowed property/);
  assert.match(res[1].content, /Unknown tool "nope".*echo, boom/);
  assert.match(res[2].content, /kaput/);
  assert.match(res[3].content, /not be parsed as JSON/);
  assert.equal(r.stopReason, "end");
});

test("agent: result mapping (blocks, objects, undefined) and truncation", async () => {
  const big = "A".repeat(500) + "MIDDLE" + "Z".repeat(500);
  const tools = [
    { name: "blocks", description: "", inputSchema: { type: "object" }, run: () => [{ type: "text", text: "hi" }, { type: "image", mime: "image/png", data: "QQ==" }] },
    { name: "none", description: "", inputSchema: { type: "object" }, run: () => undefined },
    { name: "big", description: "", inputSchema: { type: "object" }, run: () => big },
  ];
  const provider = scriptedProvider([toolTurn(["blocks", "none", "big"].map((n, i) => ({ id: "t" + i, name: n, input: {} }))), textTurn("k")]);
  const r = await run({ provider, tools, maxResultChars: 200 });
  const res = results(r);
  assert.equal(res[0].content[1].type, "image");
  assert.equal(res[1].content, "OK");
  assert.ok(res[2].content.length < 330);
  assert.match(res[2].content, /^A+/);
  assert.match(res[2].content, /characters omitted/);
  assert.match(res[2].content, /Z+$/);
  assert.equal(truncateText("short", 100), "short");
});

test("agent: abort mid-stream and mid-tool", async () => {
  const ctl = new AbortController();
  const provider = {
    async *stream(req, { signal }) {
      yield { type: "text", delta: "partial" };
      await new Promise((_, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))));
    },
  };
  const events = [];
  const r = await runAgent({ provider, model: "m", messages: [user("go")], signal: ctl.signal, onEvent: (e) => { events.push(e); if (e.type === "text") setTimeout(() => ctl.abort(), 2); } });
  assert.equal(r.stopReason, "aborted");
  assert.deepEqual(r.messages, []);
  assert.equal(events.at(-1).type, "done");

  // mid-tool
  const ctl2 = new AbortController();
  let sawSignal = false;
  const slow = { name: "slow", description: "", inputSchema: { type: "object" }, run: (i, ctx) => new Promise(() => { sawSignal = !!ctx.signal; setTimeout(() => ctl2.abort(), 2); }) };
  const second = { name: "second", description: "", inputSchema: { type: "object" }, run: () => assert.fail("must not run after abort") };
  const prov2 = scriptedProvider([toolTurn([{ id: "s1", name: "slow", input: {} }, { id: "s2", name: "second", input: {} }]), textTurn("never")]);
  const r2 = await runAgent({ provider: prov2, model: "m", messages: [user("go")], tools: [slow, second], signal: ctl2.signal });
  assert.equal(r2.stopReason, "aborted");
  assert.ok(sawSignal);
  const res = r2.messages.at(-1).content;
  assert.deepEqual(res.map((b) => [b.toolUseId, b.isError]), [["s1", true], ["s2", true]]);
  assert.equal(prov2.requests.length, 1);
  // already aborted
  const ctl3 = new AbortController();
  ctl3.abort();
  const r3 = await runAgent({ provider: prov2, model: "m", messages: [], signal: ctl3.signal });
  assert.equal(r3.stopReason, "aborted");
  assert.equal(r3.steps, 0);
});

test("agent: retries retryable errors with backoff, honors retryAfter, gives up", async () => {
  const sleeps = [];
  const sleep = async (ms) => void sleeps.push(ms);
  let calls = 0;
  const flaky = {
    async *stream() {
      calls++;
      if (calls === 1) throw new ProviderError("slow down", { status: 429, retryable: true, retryAfterMs: 4000 });
      if (calls === 2) throw new ProviderError("down", { status: 503, retryable: true });
      yield* textTurn("finally")();
    },
  };
  const events = [];
  const r = await runAgent({ provider: flaky, model: "m", messages: [user("x")], sleep, onEvent: (e) => events.push(e) });
  assert.equal(r.stopReason, "end");
  assert.deepEqual(sleeps, [4000, 2000]);
  assert.deepEqual(events.filter((e) => e.type === "retry").map((e) => [e.attempt, e.error]), [[1, "slow down"], [2, "down"]]);

  calls = -100;
  const hopeless = { async *stream() { throw new ProviderError("nope", { status: 500, retryable: true }); } };
  const r2 = await runAgent({ provider: hopeless, model: "m", messages: [user("x")], sleep, retries: 2 });
  assert.equal(r2.stopReason, "error");
  assert.equal(r2.error, "nope");

  let n401 = 0;
  const auth = { async *stream() { n401++; throw new ProviderError("bad key", { status: 401, retryable: false }); } };
  const r3 = await runAgent({ provider: auth, model: "m", messages: [user("x")], sleep });
  assert.equal(r3.stopReason, "error");
  assert.equal(n401, 1);
  const weird = { async *stream() { throw new Error("plain failure"); } };
  assert.equal((await runAgent({ provider: weird, model: "m", messages: [], sleep })).error, "plain failure");
});

test("agent: max_steps", async () => {
  const provider = scriptedProvider([toolTurn([{ id: "x", name: "t", input: {} }])]);
  const tool = { name: "t", description: "", inputSchema: { type: "object" }, run: () => "ok" };
  const r = await run({ provider, tools: [tool], maxSteps: 3 });
  assert.equal(r.stopReason, "max_steps");
  assert.equal(r.steps, 3);
  assert.equal(r.messages.length, 6);
  assert.equal(r.events.at(-1).stopReason, "max_steps");
});

test("agent: tool calls with a max_tokens stop continue; plain max_tokens ends flagged", async () => {
  const provider = scriptedProvider([
    async function* () {
      yield { type: "tool_call", id: "a", name: "t", input: {} };
      yield { type: "tool_call", id: "b", name: "t", input: {}, error: "Tool arguments were not valid JSON." };
      yield { type: "done", stopReason: "max_tokens", message: { role: "assistant", content: [{ type: "tool_use", id: "a", name: "t", input: {} }, { type: "tool_use", id: "b", name: "t", input: {} }] } };
    },
    async function* () {
      yield { type: "text", delta: "cut" };
      yield { type: "done", stopReason: "max_tokens", message: { role: "assistant", content: [{ type: "text", text: "cut" }] } };
    },
  ]);
  const tool = { name: "t", description: "", inputSchema: { type: "object" }, run: () => "ok" };
  const r = await run({ provider, tools: [tool] });
  assert.equal(r.stopReason, "end");
  assert.equal(r.truncated, true);
  const res = results(r);
  assert.equal(res[0].content, "ok");
  assert.match(res[1].content, /cut off/);
});

test("agent: loop guard injects a hint after 3 identical failures", async () => {
  const provider = scriptedProvider([toolTurn([{ id: "x", name: "bad", input: { a: 1 } }]), toolTurn([{ id: "y", name: "bad", input: { a: 1 } }]), toolTurn([{ id: "z", name: "bad", input: { a: 1 } }]), textTurn("stop")]);
  const tool = { name: "bad", description: "", inputSchema: { type: "object" }, run: () => { throw new Error("nope"); } };
  const r = await run({ provider, tools: [tool] });
  const res = results(r);
  assert.ok(!/Hint/.test(res[0].content));
  assert.ok(!/Hint/.test(res[1].content));
  assert.match(res[2].content, /Hint: this identical call has failed 3 times/);
});

test("agent: a throwing onEvent never breaks the loop", async () => {
  const provider = scriptedProvider([textTurn("hi")]);
  const r = await runAgent({ provider, model: "m", messages: [user("x")], onEvent: () => { throw new Error("ui bug"); } });
  assert.equal(r.stopReason, "end");
});

test("agent: contextBudget compacts the request but not the returned messages", async () => {
  const old = [
    user("start"),
    { role: "assistant", content: [{ type: "tool_use", id: "o", name: "t", input: {} }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "o", content: "R".repeat(5000) }] },
    { role: "assistant", content: "ok" },
    user("a"), { role: "assistant", content: "b" }, user("c"), { role: "assistant", content: "d" }, user("again"),
  ];
  const provider = scriptedProvider([textTurn("fine")]);
  await runAgent({ provider, model: "m", messages: old, contextBudget: 500 });
  assert.equal(provider.requests[0].messages[2].content[0].content, "[result omitted]");
  assert.equal(old[2].content[0].content.length, 5000);
});

test("compactMessages and estimateTokens", () => {
  const msgs = [
    { role: "user", content: [{ type: "text", text: "hello" }, { type: "image", mime: "image/png", data: "X".repeat(100000) }] },
    { role: "assistant", content: [{ type: "tool_use", id: "1", name: "t", input: { q: 1 } }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "1", content: "Y".repeat(10000) }] },
    { role: "assistant", content: "A".repeat(4000) },
    { role: "user", content: "last question" },
  ];
  assert.ok(estimateTokens(msgs) > 2500);
  assert.equal(estimateTokens([{ role: "user", content: "abcdefgh" }]), Math.ceil((8 + 4) / 4));
  assert.equal(compactMessages(msgs, { maxChars: 1e6 }), msgs, "unchanged when it fits");
  const small = compactMessages(msgs, { maxChars: 6000, keepRecent: 1 });
  assert.notEqual(small, msgs);
  assert.equal(msgs[2].content[0].content.length, 10000, "input untouched");
  assert.deepEqual(small[0].content[1], { type: "text", text: "[image omitted]" });
  assert.equal(small[2].content[0].content, "[result omitted]");
  assert.equal(small.at(-1).content, "last question");
  const kept = compactMessages(msgs, { maxChars: 6000, keepRecent: 5 });
  assert.equal(kept[2].content[0].content.length, 10000, "recent messages are protected");
});

test("validateSchema: keywords", () => {
  const v = (val, s) => validateSchema(val, s, "x");
  assert.deepEqual(v({ a: 1 }, { type: "object", properties: { a: { type: "number" } }, required: ["a"] }), []);
  assert.match(v({}, { type: "object", required: ["a"] })[0], /x\.a is required/);
  assert.match(v("s", { type: "number" })[0], /must be number \(got string\)/);
  assert.match(v(1.5, { type: "integer" })[0], /integer/);
  assert.deepEqual(v(null, { type: ["string", "null"] }), []);
  assert.match(v([1, "a"], { type: "array", items: { type: "number" } })[0], /x\[1\]/);
  assert.match(v([], { type: "array", minItems: 1 })[0], /at least 1/);
  assert.match(v("ab", { type: "string", minLength: 3 })[0], /3 characters/);
  assert.match(v(11, { type: "number", maximum: 10 })[0], /<= 10/);
  assert.match(v("x", { type: "string", pattern: "^a" })[0], /pattern/);
  assert.deepEqual(v("a", { anyOf: [{ type: "number" }, { type: "string" }] }), []);
  assert.match(v(true, { anyOf: [{ type: "number" }, { type: "string" }] })[0], /anyOf/);
  assert.deepEqual(v(1, { oneOf: [{ type: "number", minimum: 5 }, { type: "number", maximum: 5 }] }), []);
  assert.match(v(1, { oneOf: [{ type: "number" }, { type: "integer" }] })[0], /oneOf/);
  assert.match(v({ a: 1, b: 2 }, { type: "object", properties: { a: {} }, additionalProperties: false })[0], /x\.b is not an allowed/);
  assert.match(v({ b: "s" }, { type: "object", additionalProperties: { type: "number" } })[0], /x\.b/);
  assert.deepEqual(v({ anything: 1 }, { type: "object" }), []);
  assert.deepEqual(v(5, undefined), []);
  assert.match(v("c", { enum: ["a", "b"] })[0], /one of/);
  assert.deepEqual(v({ a: { b: [1] } }, { type: "object", properties: { a: { type: "object", properties: { b: { type: "array" } } } } }), []);
});
