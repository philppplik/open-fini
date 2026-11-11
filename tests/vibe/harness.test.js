import test from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../../app/src/ai/agent.js";
import { advertisedTools, pageText, CORE_GROUPS } from "../../app/src/vibe/script-lib.js";
import { createOpenFiniTools, TOOL_GROUPS } from "../../app/src/vibe/tools/index.js";
import { SCRIPT_BLOCKED } from "../../app/src/vibe/tools/script.js";
import { ONCE_ONLY_TOOLS } from "../../app/src/vibe/web-hosts.js";
import { scriptedProvider, textTurn, toolTurn } from "../ai/helpers.js";
import { fakeApp } from "./helpers.js";

function setup(policy) {
  const app = fakeApp();
  const ctx = { results: new Map(), policy };
  const tools = createOpenFiniTools(app, ctx);
  const by = new Map(tools.map((t) => [t.name, t]));
  ctx.lookup = (n) => by.get(n);
  ctx.toolNames = () => [...by.keys()];
  return { app, ctx, by, run: (name, args) => by.get(name).run(args, {}) };
}

test("compact tool list: core groups plus the groups of what is open", () => {
  const vec = advertisedTools(TOOL_GROUPS, "vector");
  for (const n of ["find_tools", "call_tool", "run_script", "ask_user", "add_shape", "describe_page", "lint_design", "new_document"]) assert.ok(vec.has(n), n);
  for (const n of ["sheet_write_range", "git_commit", "web_search", "slides_add_slide", "write_file"]) assert.ok(!vec.has(n), n);
  const sheet = advertisedTools(TOOL_GROUPS, "sheet", ["web_search"]);
  assert.ok(sheet.has("sheet_write_range") && sheet.has("office_screenshot") && sheet.has("web_search"));
  assert.ok(!sheet.has("add_shape"));
  assert.ok(advertisedTools(TOOL_GROUPS, "code").has("preview_interact"));
  assert.deepEqual([...advertisedTools(TOOL_GROUPS, "vibe")].sort(), [...vec].sort(), "an unknown context falls back to the vector set");
  for (const g of CORE_GROUPS) assert.ok(TOOL_GROUPS[g], `core group ${g} exists`);
  const all = Object.values(TOOL_GROUPS).flat().length;
  assert.ok(vec.size < all / 2, `compact lists ${vec.size} of ${all} tools`);
});

test("runAgent: advertise hides tools from the request but keeps them callable", async () => {
  const provider = scriptedProvider([toolTurn([{ id: "1", name: "hidden", input: {} }]), textTurn("done")]);
  const mk = (name) => ({ name, description: "d", inputSchema: { type: "object", properties: {} }, run: () => ({ ran: name }) });
  const r = await runAgent({ provider, model: "m", messages: [{ role: "user", content: "go" }], tools: [mk("shown"), mk("hidden")], advertise: (t) => t.name === "shown", sleep: async () => {} });
  assert.deepEqual(provider.requests[0].tools.map((t) => t.name), ["shown"]);
  assert.match(JSON.stringify(r.messages), /\\"ran\\":\\"hidden\\"/);
});

test("runAgent: a cut result calls onTruncated and carries its note", async () => {
  const provider = scriptedProvider([toolTurn([{ id: "1", name: "big", input: {} }]), textTurn("done")]);
  const seen = [];
  const big = { name: "big", description: "d", inputSchema: { type: "object", properties: {} }, run: () => "x".repeat(5000) };
  const r = await runAgent({ provider, model: "m", messages: [{ role: "user", content: "go" }], tools: [big], maxResultChars: 1000, onTruncated: (x) => (seen.push(x), "\n[stored as r1]"), sleep: async () => {} });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text.length, 5000);
  assert.equal(seen[0].name, "big");
  assert.match(JSON.stringify(r.messages), /characters omitted.*stored as r1/s);
});

test("read_result pages and searches a stored result", async () => {
  const { ctx, run } = setup();
  ctx.results.set("r1", `${"a".repeat(30000)}NEEDLE${"b".repeat(30000)}`);
  const first = await run("read_result", { id: "r1" });
  assert.deepEqual([first.total, first.offset, first.length, first.next], [60006, 0, 20000, 20000]);
  const hit = await run("read_result", { id: "r1", search: "needle", length: 500 });
  assert.equal(hit.found, true);
  assert.equal(hit.offset, 29800);
  assert.ok(hit.text.includes("NEEDLE"));
  assert.equal((await run("read_result", { id: "r1", offset: 59000 })).end, true);
  await assert.rejects(run("read_result", { id: "r9" }), /No stored result .*Stored: r1/s);
  assert.equal(pageText("abc", { search: "zzz" }).found, false);
});

test("call_tool runs any tool with that tool's own approval", async () => {
  const asked = [];
  const { app, by, run } = setup((name, args) => (asked.push([name, args]), name === "remember" ? "Remember?" : false));
  const t = by.get("call_tool");
  assert.ok(t.alwaysAsk && ONCE_ONLY_TOOLS.has("call_tool"), "its approval is never skipped by a mode or Always allow");
  assert.equal(t.needsApproval({ name: "add_shape", args: { type: "rect" } }), false);
  assert.equal(t.needsApproval({ name: "remember", args: { note: "x" } }), "Remember?");
  assert.deepEqual(asked.map((a) => a[0]), ["add_shape", "remember"]);
  const r = await run("call_tool", { name: "add_shape", args: { type: "rect", x: 1, y: 2, w: 30, h: 40 } });
  assert.ok(r.id);
  assert.equal(app.doc.pages[0].root.children.length, 1);
  await assert.rejects(run("call_tool", { name: "add_shape", args: { type: "blob" } }), /Invalid args for add_shape.*find_tools/s);
  await assert.rejects(run("call_tool", { name: "call_tool", args: {} }), /cannot call itself/);
  await assert.rejects(run("call_tool", { name: "nope" }), /Unknown tool/);
  assert.ok(SCRIPT_BLOCKED.has("call_tool"), "scripts call tools directly, not through call_tool");
});
