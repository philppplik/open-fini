import test from "node:test";
import assert from "node:assert/strict";
import { createRunLog, exportAiLog, aiLogMarkdown, hashText, FORMAT } from "../../app/src/vibe/ai-log.js";
import { createLogStore } from "../../app/src/core/log-store.js";

const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

function sampleRun(verbose) {
  let t = 1000;
  const log = createRunLog({ verbose, now: () => (t += 10) });
  log.start({ chat: "chat_1", model: "demo", provider: "demo", system: "You are Vibe.", skills: ["a", "b"], tools: 42, prompt: `Rewrite this. key ${KEY}` });
  log.event({ type: "tool_start", id: "t1", name: "use_skill", input: { name: "brand-voice" } });
  log.event({ type: "tool_end", id: "t1", name: "use_skill", result: "ok", ms: 5 });
  log.event({ type: "tool_start", id: "t2", name: "set_text", input: { id: "n1", text: "Secret document text", apiKey: KEY } });
  log.event({ type: "tool_end", id: "t2", name: "set_text", result: "Boom", isError: true, ms: 7 });
  log.event({ type: "usage", input: 100, output: 20 });
  log.event({ type: "route_fallback", from: "A", to: "B", category: "rate_limit", reason: "429" });
  log.event({ type: "text", delta: "Done." });
  log.approval("set_text", true, "Allow set_text?");
  return log.finish({ stopReason: "end" });
}

test("a run record keeps metadata and never secrets", () => {
  const r = sampleRun(false);
  assert.equal(r.model, "demo");
  assert.equal(r.systemHash, hashText("You are Vibe."));
  assert.deepEqual(r.skillsLoaded, ["brand-voice"]);
  assert.equal(r.tools.length, 2);
  assert.deepEqual(r.tools[1].argKeys, ["id", "text", "apiKey"]);
  assert.equal(r.tools[1].status, "error");
  assert.equal(r.tools[1].ms, 7);
  assert.equal(r.usage.input, 100);
  assert.equal(r.fallbacks[0].to, "B");
  assert.equal(r.approvals[0].allowed, true);
  assert.equal(r.prompt, undefined, "content is only recorded in verbose mode");
  assert.equal(r.tools[1].args, undefined);
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test("verbose records content but redacts keys; the export strips content unless asked", () => {
  const r = sampleRun(true);
  assert.ok(r.prompt.includes("Rewrite"));
  assert.equal(r.reply, "Done.");
  assert.equal(r.tools[1].args.apiKey, "[redacted]");
  assert.ok(!JSON.stringify(r).includes(KEY));
  const lean = exportAiLog([r]);
  assert.equal(lean.format, FORMAT);
  assert.equal(lean.runs[0].prompt, undefined);
  assert.equal(lean.runs[0].tools[1].args, undefined);
  assert.ok(!JSON.stringify(lean).includes("Secret document text"));
  const full = exportAiLog([r], { includeContent: true });
  assert.ok(JSON.stringify(full).includes("Secret document text"));
  assert.ok(!JSON.stringify(full).includes(KEY));
  const md = aiLogMarkdown(lean);
  assert.match(md, /set_text \| error/);
});

test("the AI log uses its own channel in the log store", async () => {
  const map = new Map();
  const storage = { get: async (k) => map.get(k), set: async (k, v) => void map.set(k, v), delete: async (k) => void map.delete(k) };
  const diag = createLogStore({ storage, session: "s1" });
  const ai = createLogStore({ storage, session: "s1", indexKey: "ai.log.index", segPrefix: "ai.seg." });
  diag.append({ t: 1, level: "info", scope: "app", msg: "hello" });
  ai.append({ t: 2, level: "info", scope: "ai", msg: JSON.stringify({ model: "demo" }) });
  await diag.flush();
  await ai.flush();
  assert.ok(map.has("ai.log.index") && map.has("diag.log.index"));
  assert.deepEqual((await ai.load()).map((e) => e.scope), ["ai"]);
  assert.deepEqual((await diag.load()).map((e) => e.scope), ["app"]);
  await ai.clear();
  assert.equal((await diag.load()).length, 1);
});
