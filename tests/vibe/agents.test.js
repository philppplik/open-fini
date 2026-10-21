import test from "node:test";
import assert from "node:assert/strict";
import { AgentManager, resolveToolset, collectArtifacts, MAX_DEPTH } from "../../app/src/vibe/agents.js";
import { runAgent, createMockProvider } from "../../app/src/ai/index.js";

const T = (name, readOnly = false) => ({ name, description: `${name} tool`, inputSchema: { type: "object", properties: {} }, readOnly, run: () => ({ ok: true }) });
const PARENT = [T("add_shape"), T("set_style"), T("list_layers", true), T("screenshot", true), T("write_file"), T("ask_user"), T("create_tool"), T("spawn_agent", true), T("wait_agent", true)];
const names = (l) => l.map((t) => t.name).sort();

test("resolveToolset never grants more than the parent and respects the depth limit", () => {
  assert.deepEqual(names(resolveToolset(["read-only"], PARENT)), ["list_layers", "screenshot"]);
  assert.deepEqual(names(resolveToolset(["design"], PARENT)), ["add_shape", "list_layers", "screenshot", "set_style"]);
  assert.deepEqual(names(resolveToolset(["write_file", "generate_image"], PARENT)), ["write_file"], "unknown tools are not invented");
  const all = names(resolveToolset([], PARENT, { depth: 1 }));
  assert.ok(!all.includes("ask_user") && !all.includes("create_tool"), "children never ask the user or create tools");
  assert.ok(all.includes("spawn_agent"), "depth 1 may delegate once more");
  assert.ok(!names(resolveToolset([], PARENT, { depth: MAX_DEPTH })).includes("spawn_agent"), "no spawning beyond the max depth");
});

test("collectArtifacts finds created ids and touched files", () => {
  const a = collectArtifacts([
    { name: "add_shape", result: '{"id":"n4"}' },
    { name: "duplicate_layers", result: { ids: ["n5", "n6"] } },
    { name: "write_file", input: { path: "index.html" }, result: "OK" },
    { name: "list_layers", readOnly: true, result: '{"id":"n1"}' },
    { name: "add_text", isError: true, result: '{"id":"n9"}' },
  ]);
  assert.deepEqual(a, { layers: ["n4", "n5", "n6"], files: ["index.html"] });
});

function manager(o = {}) {
  const events = [];
  const m = new AgentManager({ runAgent, provider: createMockProvider(), model: "demo", parentTools: [{ ...T("add_shape"), run: async (a) => ({ id: `shape_${a.name || "x"}` }) }, T("screenshot", true)], onEvent: (e) => events.push(e), ...o });
  return { m, events };
}

test("agents run concurrently up to the limit, the rest queue; results are structured", async () => {
  const { m, events } = manager({ settings: { maxConcurrent: 2 } });
  const a = m.spawn({ role: "one", task: "Draw a blue rectangle", tools: ["add_shape"] });
  m.spawn({ role: "two", task: "Draw a red rectangle" });
  const c = m.spawn({ role: "three", task: "Draw a circle" });
  assert.equal(a.id, "a1");
  assert.equal(m.running, 2);
  assert.equal(m.list().find((x) => x.id === c.id).status, "queued");
  const results = await m.wait();
  assert.deepEqual(results.map((r) => r.status), ["done", "done", "done"]);
  assert.ok(results[0].artifacts.layers.length >= 1);
  assert.match(results[0].summary, /Done/);
  assert.ok(events.some((e) => e.type === "agent_event" && e.ev.type === "tool_start" && e.ev.id.startsWith("a1:")), "child ids are prefixed");
  assert.ok(m.usage.steps >= 6);
});

test("budget, depth, validation, cancel and parent abort", async () => {
  assert.throws(() => manager({ depth: MAX_DEPTH }).m.spawn({ task: "x" }), /cannot spawn/);
  assert.throws(() => manager().m.spawn({ role: "r" }), /needs a task/);
  assert.throws(() => manager().m.spawn({ task: "x", tools: ["nothing_here"] }), /No tools match/);
  const tight = manager({ settings: { budgetSteps: 1 } }).m;
  tight.spawn({ task: "Draw a rectangle" });
  const [r] = await tight.wait();
  assert.equal(r.steps, 1, "the child's step limit is capped by the remaining budget");
  assert.match(r.note, /step limit/);
  assert.throws(() => tight.spawn({ task: "again" }), /budget of this run is spent/);

  const ctl = new AbortController();
  const slow = new AgentManager({ runAgent, provider: createMockProvider({ delayMs: 20 }), model: "demo", parentTools: [T("add_shape")], signal: ctl.signal, settings: { maxConcurrent: 1 } });
  slow.spawn({ task: "Draw a rectangle" });
  const q = slow.spawn({ task: "Draw a circle" });
  assert.equal(slow.cancel(q.id), true);
  ctl.abort();
  const res = await slow.wait();
  assert.deepEqual(res.map((x) => x.status), ["cancelled", "cancelled"]);
  await assert.rejects(manager().m.wait(["zz"]), /Unknown agent/);
});
