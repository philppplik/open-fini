// Context menu providers of Vibe Studio: chat messages and tool cards.
import { registerContextProvider } from "../context-menu/index.js";
import { vibeStore } from "../../vibe/store.js";
import { uid } from "../../core/util.js";
import { messageText, messageMarkdown, turnMarkdown, retryPlan, withoutTurn, branchMessages } from "../../vibe/chat-ops.js";

export function registerVibeContext(vs) {
  const { app, session } = vs;
  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      app.toast(what, "success", 1400);
    } catch {
      app.toast("The browser blocked clipboard access.", "warning", 3000);
    }
  };
  const msgs = () => session.chat.messages;
  const save = () => {
    session.emit("chat");
    vibeStore.saveChat(session.chat).catch(() => {});
  };

  registerContextProvider({
    id: "vibe.message",
    priority: 50,
    matches: (c) => c.kind === "vibe-message",
    items: (c) => {
      const { index, role, el } = c.data;
      const m = index >= 0 ? msgs()[index] : null;
      const sel = String(window.getSelection?.() || "");
      const domText = el?.innerText?.trim() || "";
      const busy = session.running;
      const plan = m ? retryPlan(msgs(), index) : null;
      return [
        { label: "Copy selection", icon: "clipboard", hidden: !sel, run: () => copy(sel, "Copied.") },
        { label: "Copy message", icon: "clipboard", run: () => copy(m ? messageText(m) || domText : domText, "Message copied.") },
        { label: "Copy as Markdown", icon: "markdown", run: () => copy(m ? messageMarkdown(m) : domText, "Markdown copied.") },
        { label: "Copy whole turn as Markdown", disabled: !m, run: () => copy(turnMarkdown(msgs(), index), "Markdown copied.") },
        "-",
        {
          label: role === "user" ? "Retry from this message" : "Retry this answer", icon: "arrow-repeat", disabled: busy || !plan,
          title: plan || !m ? undefined : "Messages with attachments cannot be sent again.",
          run: async () => {
            session.chat.messages = plan.keep;
            save();
            try {
              await session.send(plan.text);
            } catch (err) {
              app.toast(err.message || "The request failed.", "danger", 5000);
            }
          },
        },
        { label: "Branch chat from here", icon: "diagram-2", disabled: !m, run: async () => {
          const chat = { id: uid("chat"), title: `Branch: ${session.chat.title}`.slice(0, 60), messages: branchMessages(msgs(), index), created: Date.now(), model: session.chat.model };
          await vibeStore.saveChat(chat);
          await session.openChat(chat.id);
          app.toast("Started a new chat from this point.", "success", 2200);
        } },
        { label: "Delete this turn", icon: "trash3", disabled: busy || !m, run: () => {
          session.chat.messages = withoutTurn(msgs(), index);
          save();
        } },
      ];
    },
  });

  registerContextProvider({
    id: "vibe.tool-card",
    priority: 60,
    matches: (c) => c.kind === "vibe-tool-card",
    items: (c) => {
      const { name, input, card } = c.data;
      const result = card?.querySelector(".of-tool__result")?.innerText?.trim() || "";
      return [
        { label: card?.classList.contains("open") ? "Collapse details" : "Expand details", icon: "arrows-expand", run: () => card?.classList.toggle("open") },
        { label: "Copy tool input (JSON)", icon: "braces", run: () => copy(JSON.stringify(input ?? {}, null, 2), "Input copied.") },
        { label: "Copy tool result", icon: "clipboard", disabled: !result, run: () => copy(result, "Result copied.") },
        { label: "Copy tool name", icon: "wrench", run: () => copy(name, "Tool name copied.") },
      ];
    },
  });
}
