// Orchestrated multi-file / multi-studio runs for Vibe chats (docs/vibe-orchestration.md, ADR 0022). Pure engine
// logic (no DOM): it schedules the tasks of one `plan_work` call on the run's AgentManager.
//
// Public API
//   normalizePlan(tasks, { maxTasks }) -> Task[]          validates ids, studios, dependencies (pure, unit-tested)
//   const o = new Orchestrator({ manager, guideFor, onPlan, review })
//   await o.run(tasks, { goal, signal })                  -> { tasks, review, blackboard, usage }
//   o.cancel(taskId) / o.resume(taskId, { signal }) / o.status()
//   o.blackboard: Map<string, value> (shared hand-offs: names, colors, file paths, asset ids)
//
// Invariants
//   - A task starts only when every dependency is done; tasks whose targets (file paths, document names) overlap are
//     serialized in plan order, so two agents never write the same file or document at once (target locks).
//   - Parallelism, steps and tokens are bounded by the AgentManager (maxConcurrent, shared budget). When the budget is
//     spent or sub-agents are unavailable, run() degrades to a "sequential" result the parent agent works through.
//   - Every task gets its studio guide and a verification instruction; one reviewer agent checks acceptance criteria
//     at the end (unless review:false) and may fix what fails.
//   - Agent ids are recorded per task (`agentIds`), and child tool calls carry `taskId` so history tags group edits.

export const STUDIOS = ["vector", "pixel", "layout", "code", "document", "sheet", "slides", "board", "vibe"];
/** Tool sets (vibe/agents.js TOOLSETS keys or tool names) granted per studio. */
export const STUDIO_TOOLS = {
  vector: ["design"],
  pixel: ["pixel", "design"],
  layout: ["layout", "design"],
  code: ["web"],
  document: ["office"],
  sheet: ["sheet"],
  slides: ["slides"],
  board: ["board"],
  vibe: ["knowledge"],
};
const MAX_TASKS = 12;
const FINAL = new Set(["done", "error", "cancelled", "skipped"]);

const str = (v, n = 400) => String(v ?? "").trim().slice(0, n);

/**
 * Validates and normalizes plan tasks. Throws a model-readable Error on bad input.
 * @param {object[]} tasks [{ id?, title, studio, targets?, dependsOn?, acceptance?, instructions? }]
 */
export function normalizePlan(tasks, { maxTasks = MAX_TASKS } = {}) {
  if (!Array.isArray(tasks) || !tasks.length) throw new Error("plan_work needs at least one task.");
  if (tasks.length > maxTasks) throw new Error(`At most ${maxTasks} tasks per plan; merge small steps.`);
  const out = tasks.map((t, i) => {
    const studio = str(t.studio, 20).toLowerCase() || "vibe";
    if (!STUDIOS.includes(studio)) throw new Error(`Task ${i + 1}: unknown studio "${t.studio}". Use one of ${STUDIOS.join(", ")}.`);
    const title = str(t.title, 120);
    if (!title) throw new Error(`Task ${i + 1}: a title is required.`);
    return {
      id: str(t.id, 40) || `t${i + 1}`,
      title,
      studio,
      targets: (Array.isArray(t.targets) ? t.targets : []).map((x) => str(x, 200)).filter(Boolean),
      dependsOn: (Array.isArray(t.dependsOn) ? t.dependsOn : []).map((x) => str(x, 40)).filter(Boolean),
      acceptance: (Array.isArray(t.acceptance) ? t.acceptance : t.acceptance ? [t.acceptance] : []).map((x) => str(x, 300)).filter(Boolean),
      instructions: str(t.instructions, 4000),
      status: "pending",
      agentIds: [],
      summary: "",
    };
  });
  const ids = new Set();
  for (const t of out) {
    if (ids.has(t.id)) throw new Error(`Duplicate task id "${t.id}".`);
    ids.add(t.id);
  }
  for (const t of out) for (const d of t.dependsOn) if (!ids.has(d)) throw new Error(`Task "${t.id}" depends on unknown task "${d}".`);
  // target locks: a later task that shares a target waits for the earlier one
  const key = (s) => s.toLowerCase().replace(/^\.?\//, "");
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < i; j++) {
      if (out[i].targets.some((x) => out[j].targets.map(key).includes(key(x))) && !out[i].dependsOn.includes(out[j].id)) out[i].dependsOn.push(out[j].id);
    }
  }
  // cycles
  const state = new Map();
  const byId = new Map(out.map((t) => [t.id, t]));
  const visit = (t, path) => {
    if (state.get(t.id) === 2) return;
    if (state.get(t.id) === 1) throw new Error(`Dependency cycle: ${[...path, t.id].join(" -> ")}.`);
    state.set(t.id, 1);
    for (const d of t.dependsOn) visit(byId.get(d), [...path, t.id]);
    state.set(t.id, 2);
  };
  out.forEach((t) => visit(t, []));
  return out;
}

/** The instruction a task agent receives (it cannot see the chat). */
export function taskPrompt(task, { goal = "", guide = "", board = {} } = {}) {
  const facts = Object.entries(board);
  return [
    goal ? `Overall goal (other agents do the other parts): ${goal}` : "",
    `Your task: ${task.title}${task.instructions ? `\n${task.instructions}` : ""}`,
    task.targets.length ? `Only create or change these targets: ${task.targets.join(", ")}.` : "",
    facts.length ? `Shared facts from earlier tasks (blackboard):\n${facts.map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")}` : "",
    "Publish names, colors, file paths and ids that other tasks need with the blackboard tool (action set).",
    `Verify before you finish: re-read your output with a describe or preview tool${task.acceptance.length ? ` and check: ${task.acceptance.join("; ")}` : ""}. Fix what fails.`,
    guide ? `## Studio guide (${task.studio})\n${guide}` : "",
  ].filter(Boolean).join("\n\n");
}

export class Orchestrator {
  /**
   * @param {object} o
   * @param {object} o.manager AgentManager of the current run (null = no sub-agents)
   * @param {(studio:string)=>string} [o.guideFor] compact studio guide text
   * @param {(steps:{text:string,status:string}[])=>void} [o.onPlan] live checklist for the chat
   * @param {boolean} [o.review=true] run a reviewer agent at the end
   */
  constructor(o = {}) {
    this.o = o;
    this.tasks = [];
    this.goal = "";
    this.blackboard = new Map();
    this.reviewResult = null;
  }

  #checklist() {
    const mark = { pending: "pending", running: "active", done: "done", error: "error", cancelled: "cancelled", skipped: "cancelled" };
    // task + state let the Activity tab offer Cancel and Undo per task (ui/vibe/panel-activity.js)
    const steps = this.tasks.map((t) => ({ text: `[${t.studio}] ${t.title}${t.status === "error" ? " (failed)" : t.status === "cancelled" ? " (cancelled)" : t.status === "skipped" ? " (skipped: a dependency failed)" : ""}${t.undone ? " (undone)" : ""}`, status: mark[t.status] || "pending", task: t.id, state: t.status, ...(t.undone ? { undone: true } : {}) }));
    if (this.o.review !== false && this.tasks.length > 1) steps.push({ text: "Review against acceptance criteria", status: this.reviewResult ? "done" : "pending" });
    try {
      this.o.onPlan?.(steps);
    } catch {
      /* UI never breaks the run */
    }
  }

  status() {
    return { goal: this.goal, tasks: this.tasks.map(({ id, title, studio, status, dependsOn, agentIds, summary, error, undone }) => ({ id, title, studio, status, dependsOn, agentIds, ...(summary ? { summary: summary.slice(0, 600) } : {}), ...(error ? { error } : {}), ...(undone ? { undone: true } : {}) })), blackboard: Object.fromEntries(this.blackboard), ...(this.reviewResult ? { review: this.reviewResult } : {}) };
  }

  /** Plans and runs the tasks; resolves when every task is final. */
  async run(tasks, { goal = "", signal } = {}) {
    this.tasks = normalizePlan(tasks);
    this.goal = str(goal, 600);
    this.#checklist();
    if (!this.o.manager) return { ...this.status(), mode: "sequential", note: "Sub-agents are not available here: work through the tasks yourself in order, verify each one, and call update_plan as you go." };
    await this.#drive(signal);
    if (this.o.review !== false && this.tasks.length > 1 && this.tasks.some((t) => t.status === "done") && !signal?.aborted) await this.#review(signal);
    this.#checklist();
    return { ...this.status(), mode: "parallel", usage: this.o.manager.usage };
  }

  async #drive(signal) {
    const running = new Map();
    for (;;) {
      if (signal?.aborted) {
        for (const t of this.tasks) if (!FINAL.has(t.status)) t.status = "cancelled";
        break;
      }
      const byId = new Map(this.tasks.map((t) => [t.id, t]));
      for (const t of this.tasks) {
        if (t.status !== "pending") continue;
        const deps = t.dependsOn.map((d) => byId.get(d));
        if (deps.some((d) => d.status === "error" || d.status === "cancelled" || d.status === "skipped")) {
          t.status = "skipped";
          continue;
        }
        if (deps.every((d) => d.status === "done")) running.set(t.id, this.#start(t));
      }
      this.#checklist();
      if (!running.size) break;
      const id = await Promise.race([...running.entries()].map(([k, p]) => p.then(() => k)));
      running.delete(id);
    }
  }

  async #start(t) {
    t.status = "running";
    this.#checklist();
    let guide = "";
    try {
      guide = this.o.guideFor ? str(await this.o.guideFor(t.studio), 6000) : "";
    } catch {
      /* a missing guide never blocks a task */
    }
    try {
      const a = this.o.manager.spawn({ role: `${t.studio}: ${t.title}`.slice(0, 40), task: taskPrompt(t, { goal: this.goal, guide, board: Object.fromEntries(this.blackboard) }), tools: [...STUDIO_TOOLS[t.studio], "knowledge", "blackboard", "read-only"], taskId: t.id });
      t.agentIds.push(a.id);
      const [r] = await this.o.manager.wait([a.id], { timeoutMs: 30 * 60 * 1000 });
      t.summary = r.summary || "";
      t.artifacts = r.artifacts;
      if (t.status === "cancelled") return; // cancelled while running
      t.status = r.status === "done" ? "done" : r.status === "cancelled" ? "cancelled" : "error";
      if (r.error) t.error = r.error;
    } catch (err) {
      t.status = "error";
      t.error = String(err?.message || err);
    }
  }

  async #review(signal) {
    const done = this.tasks.filter((t) => t.status === "done");
    const report = done.map((t) => `- ${t.id} [${t.studio}] ${t.title}\n  acceptance: ${t.acceptance.join("; ") || "(none stated)"}\n  result: ${t.summary.slice(0, 400)}`).join("\n");
    try {
      const a = this.o.manager.spawn({ role: "reviewer", task: `Review the finished tasks of this job against their acceptance criteria. Goal: ${this.goal || "(see tasks)"}\n${report}\n\nInspect each output with describe/preview/read tools (describe_page, read_file, check_problems, office_describe, sheet_describe, slides_describe, board_describe, screenshot). Fix small problems directly; list what still fails. End with "PASS" or "FAIL: <reasons>".`, tools: ["read-only", ...new Set(done.flatMap((t) => STUDIO_TOOLS[t.studio])), "blackboard"] });
      const [r] = await this.o.manager.wait([a.id], { timeoutMs: 15 * 60 * 1000, signal });
      this.reviewResult = { status: r.status, verdict: /\bFAIL\b/.test(r.summary || "") ? "fail" : /\bPASS\b/.test(r.summary || "") ? "pass" : "unknown", summary: str(r.summary, 1200) };
    } catch (err) {
      this.reviewResult = { status: "error", verdict: "unknown", summary: `Review skipped: ${err?.message || err}` };
    }
  }

  cancel(id) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`Unknown task "${id}". Tasks: ${this.tasks.map((x) => x.id).join(", ")}.`);
    if (FINAL.has(t.status)) return false;
    const was = t.status;
    t.status = "cancelled";
    if (was === "running") for (const aid of t.agentIds) this.o.manager?.cancel(aid, "Task cancelled.");
    this.#checklist();
    return true;
  }

  /** Records that the user undid a task's edits (shown in the checklist and in status()). */
  markUndone(id) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return false;
    t.undone = true;
    this.#checklist();
    return true;
  }

  /** Re-runs a cancelled, failed or skipped task and the tasks that were skipped because of it. */
  async resume(id, { signal } = {}) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`Unknown task "${id}".`);
    if (!["cancelled", "error", "skipped"].includes(t.status)) throw new Error(`Task "${id}" is ${t.status}; only cancelled, failed or skipped tasks can be resumed.`);
    if (!this.o.manager) throw new Error("Sub-agents are not available here; do the task yourself.");
    const reset = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of this.tasks) if (!reset.has(x.id) && x.status === "skipped" && x.dependsOn.some((d) => reset.has(d))) (reset.add(x.id), (grew = true));
    }
    for (const x of this.tasks) if (reset.has(x.id)) Object.assign(x, { status: "pending", error: undefined });
    await this.#drive(signal);
    this.#checklist();
    return this.status();
  }
}
