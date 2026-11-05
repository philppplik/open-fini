// Sub-agent tools (group "Agents"): delegate focused tasks to child runs with their own context window.
// The engine lives in ../agents.js; the session binds `ctx.agents()` to the AgentManager of the current run.
import { tool, S } from "./helpers.js";
import { TOOLSETS } from "../agents.js";
import { STUDIOS } from "../orchestrator.js";

export function agentTools(app, ctx) {
  const mgr = () => {
    const m = ctx.agents?.();
    if (!m) throw new Error("Sub-agents are not available here (only inside Vibe chats).");
    return m;
  };
  return [
    tool("spawn_agent", `Delegates ONE focused, self-contained task to a sub-agent that works in parallel with its own context window and returns a structured summary (text plus ids of layers and files it touched). Use it for independent parts of a bigger job (e.g. palette, logo mark and typography of a brand kit), not for tiny steps. Give the agent everything it needs in "task": it cannot see this conversation. Tool sets: ${Object.keys(TOOLSETS).join(", ")}, read-only, or tool names; it never gets more tools than you. Returns immediately with the agent id; call wait_agent to collect results.`, {
      role: S.str("Short role name shown to the user, e.g. “palette”, “copywriter”"),
      task: S.str("Complete instruction: goal, sizes, colors, where to place things, what to return"),
      tools: { type: "array", items: { type: "string" }, description: "Tool sets and/or tool names (default: all of yours)" },
      constraints: S.str("Extra rules, e.g. “only edit layers inside the group g12”"),
      maxSteps: S.num("Step limit for this agent (capped by the setting)", { minimum: 1, maximum: 40 }),
    }, ["role", "task"], (a, c) => ({ ...mgr().spawn(a, { parentToolId: c?.id }), note: "Running. Call wait_agent to get the result." }), { readOnly: true }),

    tool("wait_agent", "Waits until sub-agents finish and returns their results: status, summary, artifacts {layers, files}, steps. Without ids it waits for all agents of this run.", {
      ids: { type: "array", items: { type: "string" }, description: "Agent ids from spawn_agent (default: all)" },
      timeoutSeconds: S.num("Give up waiting after this many seconds (default 600)", { minimum: 1, maximum: 1800 }),
    }, [], async (a, c) => ({ results: await mgr().wait(a.ids, { timeoutMs: (a.timeoutSeconds || 600) * 1000, signal: c?.signal }) }), { readOnly: true }),

    tool("list_agents", "Lists the sub-agents of this run with their status (queued, running, done, error, cancelled).", {}, [], () => ({ agents: mgr().list(), usage: mgr().usage }), { readOnly: true }),

    tool("plan_work", "Orchestrates a job that spans several files, documents or studios (e.g. a website: HTML/CSS/JS in code, logo in vector, photos in pixel, copy in document). Give 2-12 tasks with a target studio, the files or documents each may change (targets), dependencies and acceptance checks. The tasks run as parallel sub-agents with the right studio guide and tool group; tasks that share a target or depend on each other run in order; shared names, colors, paths and ids go through the blackboard; each task verifies its own output and a reviewer agent checks the acceptance criteria at the end. The user sees the tasks as a live checklist. Waits until all tasks are final and returns per-task status, summaries, the blackboard and the review. Do not use it for single-studio work you can do in a few calls. Verify with work_task (action status) and the studio describe tools.", {
      goal: S.str("The overall goal in one or two sentences (every task sees it)"),
      tasks: {
        type: "array", minItems: 1, maxItems: 12, description: "The work items",
        items: {
          type: "object", additionalProperties: false, required: ["title", "studio"],
          properties: {
            id: S.str("Short id such as t1 or logo (default t1, t2 …)"),
            title: S.str("What this task delivers"),
            studio: { type: "string", enum: STUDIOS, description: "Studio the task works in (picks its tools and guide)" },
            targets: { type: "array", items: { type: "string" }, description: "Files or documents this task creates or changes, e.g. index.html, Logo" },
            dependsOn: { type: "array", items: { type: "string" }, description: "Ids of tasks that must finish first" },
            acceptance: { type: "array", items: { type: "string" }, description: "Checks that must hold when the task is done" },
            instructions: S.str("Everything the task agent needs: sizes, colors, copy, where to place things (it cannot see this chat)"),
          },
        },
      },
      review: S.bool("Run the reviewer agent at the end (default true)"),
    }, ["goal", "tasks"], async (a, c) => {
      const o = ctx.orchestrator?.({ review: a.review !== false });
      if (!o) throw new Error("Orchestration is only available inside Vibe chats.");
      return o.run(a.tasks, { goal: a.goal, signal: c?.signal });
    }, { readOnly: true }),

    tool("work_task", "Status, cancel or resume of the tasks of the current plan_work job. resume re-runs a cancelled, failed or skipped task (and the tasks skipped because of it) and waits for them.", {
      action: { type: "string", enum: ["status", "cancel", "resume"], description: "What to do" },
      id: S.str("Task id (for cancel and resume)"),
    }, ["action"], async (a, c) => {
      const o = ctx.orchestrator?.();
      if (!o || !o.tasks.length) throw new Error("No plan_work job in this request. Call plan_work first.");
      if (a.action === "status") return o.status();
      if (!a.id) throw new Error("Give the task id.");
      if (a.action === "cancel") return { cancelled: o.cancel(a.id), ...o.status() };
      return o.resume(a.id, { signal: c?.signal });
    }, { readOnly: true }),

    tool("blackboard", "Shared notes of the current plan_work job for hand-offs between tasks: names, colors, file paths, asset and layer ids. set stores a value under a key, get reads one key or (without key) everything.", {
      action: { type: "string", enum: ["get", "set"], description: "Read or write" },
      key: S.str("Key such as brand.primary or logo.file"),
      value: { description: "Value to store (string, number, array or object)" },
    }, ["action"], (a) => {
      const o = ctx.orchestrator?.();
      const b = o?.blackboard || (ctx.blackboard ||= new Map());
      if (a.action === "set") {
        if (!a.key) throw new Error("set needs a key.");
        if (b.size >= 200 && !b.has(a.key)) throw new Error("The blackboard is full (200 keys).");
        const json = JSON.stringify(a.value ?? null);
        if (json.length > 4000) throw new Error("Value too large (max 4000 characters as JSON); store a file path or id instead.");
        b.set(String(a.key).slice(0, 80), JSON.parse(json));
        return { ok: true, keys: b.size };
      }
      return a.key ? { key: a.key, value: b.has(a.key) ? b.get(a.key) : null } : { entries: Object.fromEntries(b) };
    }, { readOnly: true }),

    tool("cancel_agent", "Stops a running or queued sub-agent.", { id: S.str("Agent id") }, ["id"], (a) => ({ cancelled: mgr().cancel(a.id, "Cancelled by the parent agent.") }), { readOnly: true }),
  ];
}
