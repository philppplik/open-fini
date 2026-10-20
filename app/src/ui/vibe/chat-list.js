// Vibe chat list extras for concurrent chats: the header (running count + "Stop all" kill switch) and the per-row
// status badge (running spinner, needs approval, finished, failed). Rows stay plain buttons; stopping a single chat is
// in the row's context menu, the composer's stop button and the AI progress pill.
import { h } from "../../core/util.js";
import { iconEl } from "../toolbox.js";

const LABEL = { running: "Running", approval: "Needs your approval", done: "Finished", error: "Failed" };

/** Status badge for one chat row. `st` comes from hub.statusOf(chatId). */
export function chatRowExtras(vs, chat, st) {
  if (!st || st.status === "idle") return [];
  const active = chat.id === vs.session.chat.id;
  if (st.status === "done" && active) return []; // the open chat shows its own result
  const icon = st.status === "running" ? h("sl-spinner", { "aria-hidden": "true" }) : iconEl(st.status === "approval" ? "shield-lock" : st.status === "error" ? "exclamation-triangle" : "check2");
  return [h("span.of-vlist__badge", { class: st.status, title: LABEL[st.status] || "" }, icon, st.pending ? h("b", String(st.pending)) : null, h("span.of-sr-only", `, ${LABEL[st.status] || st.status}`))];
}

/** List header: title, "N running" and the global stop button. */
export function chatListHead(vs, newButton) {
  const running = vs.hub.running.filter((s) => !s.hidden).length;
  const pending = [...vs.hub.sessions.values()].reduce((n, s) => n + (s.hidden ? 0 : s.pendingApprovals.length + s.pendingAsks.length), 0);
  const stop = running
    ? h("button.of-vlist__stopall", { type: "button", title: "Stop every running chat and sub-agent", onclick: () => vs.hub.stopAll() }, iconEl("stop-fill"), h("span", "Stop all"))
    : null;
  return h(
    "div.of-vlist__head",
    h("strong", "Vibe"),
    running ? h("span.of-vlist__running", { role: "status" }, `${running} running${pending ? ` · ${pending} waiting` : ""}`) : h("span.of-vlist__running", { role: "status" }),
    stop,
    newButton,
  );
}
