import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlan, taskPrompt, Orchestrator, STUDIO_TOOLS } from "../../app/src/vibe/orchestrator.js";
import { AgentManager, TOOLSETS } from "../../app/src/vibe/agents.js";
import { runAgent, createMockProvider, studioGuide } from "../../app/src/ai/index.js";

const T = (name, readOnly = false, run = () => ({ ok: true })) => ({ name, description: `${name} tool`, inputSchema: { type: "object", properties: {} }, readOnly, run });

test("normalizePlan validates studios, ids, dependencies, cycles and adds target locks", () => {
  assert.throws(() => normalizePlan([]), /at least one/);
  assert.throws(() => normalizePlan([{ title: "x", studio: "music" }]), /unknown studio/);
  assert.throws(() => normalizePlan([{ title: "x", studio: "code", dependsOn: ["zz"] }]), /unknown task/);
  assert.throws(() => normalizePlan([{ id: "a", title: "x", studio: "code", dependsOn: ["b"] }, { id: "b", title: "y", studio: "code", dependsOn: ["a"] }]), /cycle/);
  assert.throws(() => normalizePlan([{ id: "a", title: "x", studio: "code" }, { id: "a", title: "y", studio: "code" }]), /Duplicate/);
  const p = normalizePlan([
    { title: "Page", studio: "code", targets: ["index.html", "styles.css"] },
    { title: "Logo", studio: "vector", targets: ["Logo"] },
    { title: "Styles", studio: "code", targets: ["./styles.css"], acceptance: "contrast ok" },
  ]);
  assert.deepEqual(p.map((t) => t.id), ["t1", "t2", "t3"]);
  assert.deepEqual(p[2].dependsOn, ["t1"], "a shared target serializes the later task");
  assert.deepEqual(p[1].dependsOn, []);
  assert.deepEqual(p[2].acceptance, ["contrast ok"]);
});

test("taskPrompt carries goal, targets, blackboard, acceptance and the guide", () => {
  const [t] = normalizePlan([{ title: "Logo", studio: "vector", targets: ["Logo"], acceptance: ["round"] }]);
  const s = taskPrompt(t, { goal: "Launch kit", guide: "GUIDE", board: { "brand.primary": "#f60" } });
  for (const x of ["Launch kit", "Logo", "brand.primary: #f60", "round", "GUIDE", "blackboard"]) assert.ok(s.includes(x), x);
});

test("every studio maps to known tool sets", () => {
  for (const [studio, sets] of Object.entries(STUDIO_TOOLS)) for (const s of sets) assert.ok(TOOLSETS[s], `${studio}: ${s}`);
});

test("studio guides load lazily for every studio", async () => {
  for (const st of Object.keys(STUDIO_TOOLS)) {
    const g = await studioGuide(st);
    assert.ok(g.length > 300 && g.length < 6000, `${st}: ${g.length}`);
    assert.match(g, /## Verify/, st);
  }
  assert.equal(await studioGuide("nope"), "");
});

function setup(o = {}) {
  const made = [];
  const parentTools = [T("add_shape", false, async (a) => (made.push(a), { id: `n${made.length}` })), T("add_text", false, async () => ({ id: "t1" })), T("describe_page", true), T("screenshot", true), T("blackboard", true)];
  const manager = new AgentManager({ runAgent, provider: createMockProvider(), model: "demo", parentTools, settings: { maxConcurrent: 2, ...o.settings } });
  const plans = [];
  const orch = new Orchestrator({ manager, guideFor: async (s) => `guide for ${s}`, onPlan: (steps) => plans.push(steps), ...o });
  return { orch, manager, plans, made };
}

test("runs tasks in dependency order with a live checklist, review and per-task agents", async () => {
  const { orch, plans, manager } = setup();
  const r = await orch.run([
    { id: "logo", title: "Logo", studio: "vector", instructions: "Draw an orange circle" },
    { id: "head", title: "Headline", studio: "vector", dependsOn: ["logo"], instructions: 'Add a headline text "Hi"' },
  ], { goal: "kit" });
  assert.equal(r.mode, "parallel");
  assert.deepEqual(r.tasks.map((t) => t.status), ["done", "done"]);
  assert.ok(r.review && r.review.status, "a reviewer ran");
  const logoAgent = manager.get(r.tasks[0].agentIds[0]);
  const headAgent = manager.get(r.tasks[1].agentIds[0]);
  assert.equal(logoAgent.taskId, "logo");
  assert.ok(headAgent.started >= logoAgent.ended, "the dependent task starts after its dependency");
  assert.ok(plans.length >= 3 && plans.at(-1).every((s) => s.status === "done"), "checklist ends all done");
  assert.match(logoAgent.task, /guide for vector/);
  // checklist rows carry the task id and state for the Activity tab's Cancel / Undo task buttons
  assert.deepEqual(plans.at(-1).filter((s) => s.task).map((s) => [s.task, s.state]), [["logo", "done"], ["head", "done"]]);
  assert.ok(orch.markUndone("logo") && !orch.markUndone("nope"));
  assert.ok(plans.at(-1).find((s) => s.task === "logo").undone);
  assert.match(plans.at(-1).find((s) => s.task === "logo").text, /\(undone\)/);
  assert.equal(orch.status().tasks[0].undone, true);
});

test("a failed dependency skips dependents; cancel and resume work per task", async () => {
  const { orch } = setup({ review: false });
  const r = await orch.run([
    { id: "a", title: "A", studio: "code", instructions: "x" },
    { id: "b", title: "B", studio: "vector", dependsOn: ["a"], instructions: "Draw a rectangle" },
  ]);
  // the parent has no web tools: the code task still gets its read-only tools and the blackboard
  assert.equal(r.tasks[0].status, "done");
  const { orch: o2 } = setup({ review: false });
  o2.tasks = normalizePlan([{ id: "x", title: "X", studio: "vector", instructions: "Draw a rectangle" }, { id: "y", title: "Y", studio: "vector", dependsOn: ["x"], instructions: "Draw a circle" }]);
  assert.equal(o2.cancel("x"), true);
  o2.tasks[1].status = "skipped";
  assert.throws(() => o2.cancel("zz"), /Unknown task/);
  const s = await o2.resume("x");
  assert.deepEqual(s.tasks.map((t) => t.status), ["done", "done"], "resume re-runs the task and its skipped dependents");
  await assert.rejects(o2.resume("x"), /only cancelled/);
});

test("falls back to sequential work without sub-agents and when the budget is spent", async () => {
  const plans = [];
  const r = await new Orchestrator({ manager: null, onPlan: (s) => plans.push(s) }).run([{ title: "A", studio: "code" }]);
  assert.equal(r.mode, "sequential");
  assert.equal(plans.length, 1);
  const { orch } = setup({ review: false, settings: { budgetSteps: 0 } });
  const r2 = await orch.run([{ title: "A", studio: "vector" }, { title: "B", studio: "vector", dependsOn: ["t1"] }]);
  assert.equal(r2.tasks[0].status, "error");
  assert.match(r2.tasks[0].error, /budget/);
  assert.equal(r2.tasks[1].status, "skipped");
});
