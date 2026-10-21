// Sub-agent tools (group "Agents"): delegate focused tasks to child runs with their own context window.
// The engine lives in ../agents.js; the session binds `ctx.agents()` to the AgentManager of the current run.
import { tool, S } from "./helpers.js";
import { TOOLSETS } from "../agents.js";

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

    tool("cancel_agent", "Stops a running or queued sub-agent.", { id: S.str("Agent id") }, ["id"], (a) => ({ cancelled: mgr().cancel(a.id, "Cancelled by the parent agent.") }), { readOnly: true }),
  ];
}
