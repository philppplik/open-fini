// Icon toolbars under Vibe chat messages. Frequent actions are visible icons; the rest sit in a "⋯" overflow menu so the
// row stays calm (and fits a narrow chat column). Every action reuses the transcript helpers of vibe/chat-ops.js.
//
// Assistant answer: copy, retry (newest answer), helpful / not helpful, ⋯ (copy as Markdown, retry with another
//   model, read aloud, pin, save to knowledge, share to the room, collapse, branch chat from here, delete turn).
// User message: copy, edit and resend, ⋯ (pin, branch chat from here, delete turn).
//
// Public API: messageToolbar(vs, { role, index: () => number, el, getText, getMarkdown, last, onRetry, onEdit }) → element
//   feedbackOf(chatId, index) (local only), PINS_CHANGED event via vs.session.emit("chat") re-render.
import { h, uid } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { iconEl } from "../toolbox.js";
import { showContextMenu } from "../menus.js";
import { vibeStore } from "../../vibe/store.js";
import { retryPlan, withoutTurn, branchMessages, turnBounds } from "../../vibe/chat-ops.js";
import { copyText } from "./tool-cards.js";

const FEEDBACK_KEY = "of-vibe-feedback";
const readFeedback = () => {
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || "{}");
  } catch {
    return {};
  }
};
const writeFeedback = (v) => {
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(v));
  } catch {
    /* feedback is optional */
  }
};

let speaking = null;

function act(icon, label, onClick, extra = {}) {
  const b = h("button.of-vact", { type: "button", "aria-label": t(label), "data-tip": t(label), ...extra }, iconEl(icon));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(b);
  });
  return b;
}

export function messageToolbar(vs, o) {
  const { app, session } = vs;
  const msgs = () => session.chat.messages;
  const idx = () => {
    const i = o.index();
    return i >= 0 ? i : msgs().length - 1;
  };
  const toast = (m, k = "success", ms = 1600) => app.toast(t(m), k, ms);
  const save = () => {
    session.emit("chat");
    vibeStore.saveChat(session.chat).catch(() => {});
  };
  const copy = async (text, what) => toast((await copyText(text)) ? what : "The browser blocked clipboard access.", "success");
  const row = h("div.of-vmsg__actions", { role: "toolbar", "aria-label": t(o.role === "user" ? "Message actions" : "Answer actions") });

  const pinned = () => {
    const { start } = turnBounds(msgs(), idx());
    return (session.chat.pins || []).includes(start);
  };
  const togglePin = () => {
    const { start } = turnBounds(msgs(), idx());
    const pins = new Set(session.chat.pins || []);
    if (pins.has(start)) pins.delete(start);
    else pins.add(start);
    session.chat.pins = [...pins].sort((a, b) => a - b);
    save();
  };
  const branch = async () => {
    const chat = { id: uid("chat"), title: `Branch: ${session.chat.title}`.slice(0, 60), messages: branchMessages(msgs(), idx()), created: Date.now(), model: session.chat.model };
    await vibeStore.saveChat(chat);
    await session.openChat(chat.id);
    toast("Started a new chat from this point.", "success", 2200);
  };
  const del = () => {
    if (session.running) return toast("Wait until Vibe has finished.", "warning", 2000);
    session.chat.messages = withoutTurn(msgs(), idx());
    session.chat.pins = [];
    save();
  };
  const menu = (b, items) => {
    const r = b.getBoundingClientRect();
    showContextMenu(app, r.left, r.bottom + 4, items.filter((i) => i === "-" || !i.hidden));
  };

  row.append(act("clipboard", o.role === "user" ? "Copy message" : "Copy answer", () => copy(o.getText(), "Copied.")));

  if (o.role === "user") {
    row.append(act("pencil", "Edit and resend", () => o.onEdit?.()));
    row.append(act("three-dots", "More actions", (b) => menu(b, [
      { label: pinned() ? t("Unpin") : t("Pin message"), icon: "pin-angle", run: togglePin },
      { label: t("Branch chat from here"), icon: "diagram-2", run: branch },
      "-",
      { label: t("Delete this turn"), icon: "trash3", disabled: session.running, run: del },
    ]), { "aria-haspopup": "menu" }));
    return row;
  }

  if (o.last) {
    const retry = act("arrow-repeat", "Retry: send the last message again", () => o.onRetry?.());
    retry.classList.add("of-vact--retry");
    row.append(retry);
  }
  // local feedback (never sent anywhere)
  const fbKey = () => `${session.chat.id}:${turnBounds(msgs(), idx()).start}`;
  const up = act("hand-thumbs-up", "Helpful", () => setFb("up"), { "aria-pressed": "false" });
  const down = act("hand-thumbs-down", "Not helpful", () => setFb("down"), { "aria-pressed": "false" });
  const paintFb = () => {
    const v = readFeedback()[fbKey()];
    up.setAttribute("aria-pressed", String(v === "up"));
    down.setAttribute("aria-pressed", String(v === "down"));
  };
  const setFb = (v) => {
    const all = readFeedback();
    all[fbKey()] = all[fbKey()] === v ? undefined : v;
    writeFeedback(all);
    paintFb();
    if (all[fbKey()]) toast("Thanks: feedback is stored on this device only.", "success", 1800);
  };
  paintFb();
  row.append(up, down);

  const speak = () => {
    const synth = window.speechSynthesis;
    if (!synth) return toast("Reading aloud is not available in this browser.", "warning", 2400);
    if (speaking) {
      synth.cancel();
      speaking = null;
      return;
    }
    const u = new SpeechSynthesisUtterance(o.getText().slice(0, 8000));
    u.lang = app.i18n?.locale?.() || "en-US";
    u.onend = u.onerror = () => (speaking = null);
    speaking = u;
    synth.speak(u);
  };
  const saveToKnowledge = async () => {
    try {
      const index = await session.knowledgeIndex();
      const text = o.getMarkdown();
      await index.addDocument({ id: `chat:${session.chat.id}:${idx()}`, title: `${session.chat.title} (answer)`, text, meta: { source: "chat" } });
      toast("Saved to knowledge. Vibe can find it with search_knowledge.", "success", 2400);
    } catch (err) {
      app.toast(err?.message || t("Could not save to knowledge."), "danger", 4000);
    }
  };
  const inRoom = () => !!app.collab?.session && app.collab.session.state === "open";
  const share = async () => {
    try {
      await app.collab.session.chat(o.getText().slice(0, 4000));
      toast("Shared to the room chat.");
    } catch (err) {
      app.toast(err?.message || t("Could not share."), "danger", 4000);
    }
  };
  const long = () => (o.el.innerText || "").length > 1400;
  const collapse = () => o.el.classList.toggle("of-vmsg--collapsed");

  row.append(act("three-dots", "More actions", (b) => menu(b, [
    { label: t("Copy as Markdown"), icon: "markdown", run: () => copy(o.getMarkdown(), "Markdown copied.") },
    { label: t("Retry with another model…"), icon: "cpu", disabled: session.running || !retryPlan(msgs(), idx()), run: () => vs.openModelPicker(b, { onPick: () => o.onRetryAt?.(idx()) }) },
    { label: speaking ? t("Stop reading") : t("Read aloud"), icon: speaking ? "stop-fill" : "volume-up", disabled: !window.speechSynthesis, run: speak },
    "-",
    { label: pinned() ? t("Unpin") : t("Pin answer"), icon: "pin-angle", run: togglePin },
    { label: t("Save to knowledge"), icon: "journal-bookmark", run: saveToKnowledge },
    { label: t("Share to the room chat"), icon: "people", hidden: !inRoom(), run: share },
    { label: o.el.classList.contains("of-vmsg--collapsed") ? t("Expand") : t("Collapse"), icon: "arrows-collapse", disabled: !long() && !o.el.classList.contains("of-vmsg--collapsed"), run: collapse },
    { label: t("Branch chat from here"), icon: "diagram-2", run: branch },
    "-",
    { label: t("Delete this turn"), icon: "trash3", disabled: session.running, run: del },
  ]), { "aria-haspopup": "menu" }));
  return row;
}
