import { test } from "node:test";
import assert from "node:assert/strict";
import { Timeline, matchesFilter, visibleEntries, undoPlan, formatLog, summarizeTouched } from "../../app/src/ui/vibe/timeline.js";
import { toolTitle, summarizeArgs, formatDuration, endStatus, groupLabel, resultParts, resultPreview, touchedBy, isReadTool, formatJson } from "../../app/src/ui/vibe/tool-format.js";

const clock = () => {
  let t = 1000;
  return Object.assign(() => (t += 100), { set: (v) => (t = v) });
};

function run(tl) {
  tl.startRun("Make a poster");
  tl.event({ type: "step", n: 1 });
  tl.event({ type: "tool_start", id: "a", name: "add_shape", input: { type: "rect", id: "n1" } });
  tl.event({ type: "tool_end", id: "a", name: "add_shape", result: [{ type: "text", text: '{"id":"n7"}' }], isError: false, ms: 12 });
  tl.event({ type: "tool_start", id: "b", name: "list_layers", input: {} });
  tl.event({ type: "tool_end", id: "b", name: "list_layers", result: "[]", isError: false, ms: 3 });
  tl.event({ type: "tool_start", id: "c", name: "write_file", input: { path: "index.html" } });
  tl.event({ type: "tool_end", id: "c", name: "write_file", result: "The user declined this action.", isError: true, ms: 1 });
  tl.event({ type: "usage", input: 10, output: 5 });
  tl.finish({ stopReason: "end_turn", steps: 2, usage: { input: 10, output: 5 } });
}

test("tool format helpers", () => {
  assert.equal(toolTitle("mcp_github__list_issues"), "Github › list issues");
  assert.equal(toolTitle("add_shape"), "Add shape");
  assert.equal(summarizeArgs({ path: "a.html", nested: { x: 1 }, text: "hello\n  world" }), "path: a.html · text: hello world");
  assert.equal(summarizeArgs(null), "");
  assert.ok(summarizeArgs({ text: "x".repeat(500) }).length < 60);
  assert.equal(formatDuration(950), "950 ms");
  assert.equal(formatDuration(1234), "1.2 s");
  assert.equal(formatDuration(65000), "1m 05s");
  assert.equal(endStatus(false, "ok"), "ok");
  assert.equal(endStatus(true, "The user declined this action."), "declined");
  assert.equal(endStatus(true, "Aborted by the user."), "aborted");
  assert.equal(endStatus(true, "Error: boom"), "error");
  assert.equal(groupLabel(["ok", "ok", "ok", "ok"]), "Used 4 tools");
  assert.equal(groupLabel(["ok", "running"]), "Using 2 tools…");
  assert.equal(groupLabel(["ok", "error"]), "Used 2 tools (1 failed)");
  assert.equal(isReadTool("list_layers"), true);
  assert.equal(isReadTool("add_shape"), false);
  assert.equal(formatJson({ a: 1 }, 5).startsWith("{\n  "), true);
});

test("result parts split text and images and pretty-print JSON", () => {
  const r = resultParts([{ type: "text", text: '{"a":1}' }, { type: "image", mime: "image/png", data: "AAAA" }]);
  assert.equal(r.images.length, 1);
  assert.match(r.texts[0], /\n {2}"a": 1/);
  assert.equal(resultPreview([{ type: "image", mime: "image/png", data: "x" }]), "1 image");
  assert.equal(resultPreview("a\n  b"), "a b");
});

test("touchedBy finds layer ids and file paths in args and JSON results", () => {
  const t = touchedBy("x", { id: "n1", path: "css/app.css" }, [{ type: "text", text: '{"id":"n7","ids":["n8"]}' }]);
  assert.deepEqual(t.map((x) => `${x.type}:${x.ref}`).sort(), ["node:n1", "node:n7", "node:n8", "path:css/app.css"]);
  assert.deepEqual(touchedBy("x", { text: "hi" }, "plain"), []);
});

test("timeline builds a run with tool entries, status, usage and duration", () => {
  const tl = new Timeline(clock());
  run(tl);
  assert.equal(tl.runs.length, 1);
  const r = tl.runs[0];
  assert.equal(r.status, "done");
  assert.equal(r.steps, 2);
  assert.deepEqual([r.usage.input, r.usage.output, r.usage.reported], [10, 5, true]);
  assert.ok(r.endedAt > r.startedAt);
  assert.deepEqual(r.entries.map((e) => `${e.name}:${e.status}`), ["add_shape:ok", "list_layers:ok", "write_file:declined"]);
  assert.equal(r.entries[0].ms, 12);
  assert.equal(tl.current, null);
  assert.deepEqual(tl.totals().runs, 1);
  assert.equal(tl.totals().tools, 3);
});

test("filters: changes keeps successful non-read calls, errors keeps failures", () => {
  const tl = new Timeline(clock());
  run(tl);
  const r = tl.runs[0];
  assert.deepEqual(visibleEntries(r, "changes").map((e) => e.name), ["add_shape"]);
  assert.deepEqual(visibleEntries(r, "errors").map((e) => e.name), ["write_file"]);
  assert.equal(visibleEntries(r, "all").length, 3);
  assert.equal(matchesFilter({ kind: "error" }, "errors"), true);
  assert.equal(matchesFilter({ kind: "retry" }, "changes"), false);
});

test("approvals are recorded with their decision and move the call through awaiting", () => {
  const tl = new Timeline(clock());
  tl.startRun("x");
  tl.event({ type: "tool_start", id: "a", name: "add_shape", input: {} });
  tl.approvalAsked({ id: "a", name: "add_shape", reason: "Allow add_shape?" });
  assert.equal(tl.runs[0].entries[0].status, "awaiting");
  tl.approvalDecided("a", false);
  const ap = tl.runs[0].entries.find((e) => e.kind === "approval");
  assert.equal(ap.decision, "declined");
  assert.equal(matchesFilter(ap, "errors"), true);
  assert.equal(tl.runs[0].entries[0].status, "running");
});

test("aborted and failed runs close open tool calls", () => {
  const tl = new Timeline(clock());
  tl.startRun("a");
  tl.event({ type: "tool_start", id: "a", name: "add_shape", input: {} });
  tl.finish({ stopReason: "aborted" });
  assert.equal(tl.runs[0].status, "aborted");
  assert.equal(tl.runs[0].entries[0].status, "aborted");
  tl.startRun("b");
  tl.event({ type: "retry", attempt: 1, status: 429, error: "busy" });
  tl.fail(new Error("Boom"));
  assert.equal(tl.runs[1].status, "error");
  assert.deepEqual(tl.runs[1].entries.map((e) => e.kind), ["retry", "error"]);
  assert.equal(tl.totals().errors, 1);
});

test("events without a run start one; startRun settles a dangling run", () => {
  const tl = new Timeline(clock());
  tl.event({ type: "tool_start", id: "a", name: "x", input: {} });
  assert.equal(tl.runs.length, 1);
  tl.startRun("next");
  assert.equal(tl.runs[0].status, "done");
  assert.equal(tl.runs.length, 2);
  tl.clear();
  assert.equal(tl.runs.length, 0);
});

test("undoPlan: only the newest run is directly undoable, older ones undo through the newer ones", () => {
  const tl = new Timeline(clock());
  const s1 = { doc: {}, marker: 0 };
  const s2 = { doc: {}, marker: 3 };
  const s2b = { doc: {}, marker: 0 };
  tl.startRun("one");
  tl.finish({});
  tl.attachUndo([s1], 3);
  tl.startRun("two");
  tl.finish({});
  tl.attachUndo([s2, s2b], 5);
  tl.startRun("three (no edits)");
  tl.finish({});
  tl.attachUndo([], 0);
  const [r1, r2, r3] = tl.runs;
  let plan = undoPlan(tl.runs, [s1, s2, s2b]);
  assert.deepEqual(plan.get(r2.id), { undoable: true, direct: true, count: 2 });
  assert.deepEqual(plan.get(r1.id), { undoable: true, direct: false, count: 3 });
  assert.equal(plan.get(r3.id).undoable, false);
  plan = undoPlan(tl.runs, [s1]); // the newer run was undone meanwhile
  assert.equal(plan.get(r2.id).undoable, false);
  assert.deepEqual(plan.get(r1.id), { undoable: true, direct: true, count: 1 });
});

test("summarizeTouched and formatLog", () => {
  const tl = new Timeline(clock());
  run(tl);
  const t = summarizeTouched(tl.runs[0]);
  assert.deepEqual(t.paths, []);
  assert.equal(t.nodes, 2);
  const log = formatLog(tl.runs);
  assert.match(log, /“Make a poster” — done/);
  assert.match(log, /10 tokens in \/ 5 out/);
  assert.match(log, /Write file \(path: index\.html\) -> declined/);
  assert.doesNotMatch(formatLog(tl.runs, "changes"), /List layers/);
});
