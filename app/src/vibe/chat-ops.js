// Pure helpers for operations on a Vibe chat transcript (copy, retry, delete, branch). A "turn" starts with a real
// user message and runs until the next real user message; tool results are stored as user messages too and are
// skipped when looking for turn boundaries, so tool_use / tool_result pairs are never torn apart.

const blocksOf = (m) => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || []);

/** A user message that only carries tool results (not something the person typed). */
export const isToolResultOnly = (m) => m.role === "user" && Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b.type === "tool_result");
export const isRealUser = (m) => m.role === "user" && !isToolResultOnly(m);

/** [start, end) of the turn that contains message `i`. */
export function turnBounds(messages, i) {
  let start = Math.min(Math.max(i, 0), messages.length - 1);
  while (start > 0 && !isRealUser(messages[start])) start--;
  let end = start + 1;
  while (end < messages.length && !isRealUser(messages[end])) end++;
  return { start, end };
}

/** Plain text of a message: text blocks only. */
export function messageText(m) {
  return blocksOf(m).filter((b) => b.type === "text").map((b) => b.text).join("\n\n").trim();
}

/** Markdown of a message: text blocks as they are, tool calls as a short list. */
export function messageMarkdown(m) {
  const parts = [];
  for (const b of blocksOf(m)) {
    if (b.type === "text" && b.text) parts.push(b.text);
    else if (b.type === "tool_use") parts.push(`> Tool call: \`${b.name}\`\n\n\`\`\`json\n${JSON.stringify(b.input ?? {}, null, 2)}\n\`\`\``);
  }
  const body = parts.join("\n\n").trim();
  return m.role === "user" ? `**You:**\n\n${body}` : body;
}

/** Messages of the whole turn at `i` (for "Copy turn"). */
export function turnMarkdown(messages, i) {
  const { start, end } = turnBounds(messages, i);
  return messages.slice(start, end).filter((m) => !isToolResultOnly(m)).map(messageMarkdown).filter(Boolean).join("\n\n");
}

/**
 * Retry plan for the turn at `i`: the messages to keep and the text to send again. Null when the user message has
 * attachments (they are not stored in a form that can be sent again) or there is no text.
 */
export function retryPlan(messages, i) {
  if (!messages.length) return null;
  const { start } = turnBounds(messages, i);
  const m = messages[start];
  if (!m || !isRealUser(m)) return null;
  if (Array.isArray(m.content) && m.content.some((b) => b.type !== "text")) return null;
  const text = messageText(m);
  if (!text || /^\[Attached/.test(text)) return null;
  return { keep: messages.slice(0, start), text };
}

/** Transcript without the turn at `i`. */
export function withoutTurn(messages, i) {
  const { start, end } = turnBounds(messages, i);
  return [...messages.slice(0, start), ...messages.slice(end)];
}

/** Deep copy of the transcript up to and including the turn at `i` (a new chat branches from here). */
export function branchMessages(messages, i) {
  const { end } = turnBounds(messages, i);
  return JSON.parse(JSON.stringify(messages.slice(0, end)));
}
