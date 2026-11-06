// What is in a Vibe request's context window (pure, no DOM): the system prompt, tool definitions, memories and every
// transcript block (messages, attachments, tool calls and results) with an estimated token count, plus the edits the
// context panel offers (drop a tool result, an attachment or a whole turn). Token counts use the same rule as
// ai/agent.js estimateTokens (about four characters per token); images count a flat estimate. docs/vibe-memory.md.
import { turnBounds, withoutTurn, isToolResultOnly } from "./chat-ops.js";

export const IMAGE_TOKENS = 1600;
export const DROPPED = "[Removed from the context by the user.]";

const tok = (chars) => Math.ceil(chars / 4);
const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b.type === "text" ? b.text : b.type === "image" ? "" : JSON.stringify(b))).join("\n") : JSON.stringify(c ?? ""));
const short = (s, n = 70) => {
  const one = String(s || "").replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/**
 * Lists the context items of a request.
 * @param {{system?:string, tools?:{name:string,description?:string,inputSchema?:object}[], memory?:{id:string,text:string}[], messages?:object[]}} o
 * @returns {{items:object[], total:number, byKind:Record<string,number>}}
 *   item: { id, kind: "system"|"tools"|"memory"|"message"|"attachment"|"tool_call"|"tool_result", label, tokens, index?, block?, droppable }
 */
export function contextItems({ system = "", tools = [], memory = [], messages = [] } = {}) {
  const items = [];
  if (system) items.push({ id: "system", kind: "system", label: "Instructions (system prompt, skill catalog, document summary)", tokens: tok(system.length), droppable: false });
  if (tools.length) items.push({ id: "tools", kind: "tools", label: `${tools.length} tool definitions`, tokens: tok(JSON.stringify(tools).length), droppable: false });
  for (const m of memory) items.push({ id: `mem:${m.id}`, kind: "memory", label: short(m.text, 90), tokens: tok(m.text.length + 4), memoryId: m.id, droppable: true });
  const names = new Map();
  messages.forEach((m, i) => {
    if (typeof m.content === "string") {
      items.push({ id: `msg:${i}`, kind: "message", role: m.role, label: short(m.content), tokens: tok(m.content.length + 4), index: i, droppable: m.role === "user" });
      return;
    }
    (m.content || []).forEach((b, k) => {
      const at = { index: i, block: k };
      if (b.type === "text") {
        if (b.text === DROPPED || /removed from the context by the user\.\]$/.test(b.text)) return;
        const attached = /^\[Attached (file|document|image)/.exec(b.text);
        if (attached) items.push({ id: `att:${i}:${k}`, kind: "attachment", label: short(b.text.split("\n")[0].replace(/^\[|\]$/g, "")), tokens: tok(b.text.length), ...at, droppable: true });
        else items.push({ id: `msg:${i}:${k}`, kind: "message", role: m.role, label: short(b.text), tokens: tok(b.text.length + 4), ...at, droppable: m.role === "user" && !isToolResultOnly(m) });
      } else if (b.type === "image") items.push({ id: `img:${i}:${k}`, kind: "attachment", label: "Image", tokens: IMAGE_TOKENS, ...at, droppable: true });
      else if (b.type === "tool_use") {
        names.set(b.id, b.name);
        items.push({ id: `call:${b.id}`, kind: "tool_call", label: b.name, tokens: tok(JSON.stringify(b.input ?? {}).length + b.name.length), ...at, droppable: false });
      } else if (b.type === "tool_result") {
        const text = textOf(b.content);
        if (text === DROPPED) return;
        const imgs = Array.isArray(b.content) ? b.content.filter((x) => x.type === "image").length : 0;
        items.push({ id: `res:${b.toolUseId}`, kind: "tool_result", label: names.get(b.toolUseId) || "tool result", tokens: tok(text.length) + imgs * IMAGE_TOKENS, ...at, toolUseId: b.toolUseId, droppable: true });
      } else if (b.type === "thinking") items.push({ id: `think:${i}:${k}`, kind: "message", role: "thinking", label: "Reasoning", tokens: tok((b.text || "").length), ...at, droppable: false });
    });
  });
  const byKind = {};
  let total = 0;
  for (const it of items) {
    total += it.tokens;
    byKind[it.kind] = (byKind[it.kind] || 0) + it.tokens;
  }
  return { items, total, byKind };
}

/**
 * The transcript without one item (a new array; the input is not changed). Tool results and attachments are replaced
 * by a short marker so tool_use / tool_result pairs stay valid; a user message drops its whole turn.
 */
export function dropContextItem(messages, item) {
  if (!item?.droppable) return messages;
  if (item.kind === "message") return withoutTurn(messages, item.index);
  if (item.kind !== "tool_result" && item.kind !== "attachment") return messages;
  return messages.map((m, i) => {
    if (i !== item.index || typeof m.content === "string") return m;
    return {
      ...m,
      content: m.content.map((b, k) => {
        if (k !== item.block) return b;
        if (b.type === "tool_result") return { ...b, content: DROPPED };
        return { type: "text", text: DROPPED };
      }),
    };
  });
}

/** Drops every tool result older than the newest turn (the "Free up space" action). */
export function dropOldToolResults(messages) {
  if (!messages.length) return messages;
  const { start } = turnBounds(messages, messages.length - 1);
  return messages.map((m, i) => (i >= start || !Array.isArray(m.content) || !m.content.some((b) => b.type === "tool_result") ? m : { ...m, content: m.content.map((b) => (b.type === "tool_result" ? { ...b, content: DROPPED } : b)) }));
}

/** Rough context window of a model id (tokens), for the meter. Unknown models get a conservative 128k. */
export function contextWindowFor(model = "") {
  const id = String(model).toLowerCase();
  if (/gemini-(1\.5|2|3)|gpt-4\.1|gpt-5|claude.*\[1m\]|llama-4/.test(id)) return id.includes("gpt-5") ? 400000 : 1000000;
  if (/claude|o1|o3|o4/.test(id)) return 200000;
  if (/gpt-4o|gpt-4-turbo|mistral-large|qwen|deepseek|llama-3\.[1-3]/.test(id)) return 128000;
  if (/gpt-3\.5/.test(id)) return 16000;
  if (/(^|[^0-9])8k/.test(id)) return 8000;
  return 128000;
}
