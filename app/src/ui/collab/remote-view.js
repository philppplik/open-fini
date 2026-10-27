// The Collaboration UI in its own OS window (?popout=collab): a remote view of the main window's room. UI only: this
// window has no identity, keys or connection; it renders snapshots received over BroadcastChannel("openfini-collab-ui")
// and sends a whitelist of actions back (protocol: collab/remote-ui.js, host: ui/collab/remote-host.js, design:
// docs/adr/0013-collab-popout.md). The responsive layout (top tabs / left rail / list column) is the same as the
// floating window's (ui/collab/layout-mode.js).
//
// Public API: bootCollabPopout(app, params)   called by boot.js instead of the studio pop-out boot
// Invariants: all remote text is rendered with textContent only; closing this window (or "Dock back") tells the main
// window, which then shows its floating window again; nothing here persists room data.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { platform } from "../../platform/index.js";
import { windowControls } from "../../platform/window-controls.js";
import { UI_CHANNEL, isUiMessage, readSnapshot } from "../../collab/remote-ui.js";
import { sessionKey } from "../../platform/popout.js";
import { layoutMode } from "./layout-mode.js";

const TABS = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "people", label: "People", icon: "people" },
  { id: "comments", label: "Comments", icon: "chat-quote" },
];
const icon = (name) => h("sl-icon", { name, "aria-hidden": "true" });
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const initials = (nick) => (String(nick || "?").trim().split(/\s+/).map((p) => [...p][0]).slice(0, 2).join("") || "?").toUpperCase();
const avatar = (m) => {
  const a = h("span.of-remote-avatar", { "aria-hidden": "true" }, initials(m.nick));
  a.style.setProperty("--of-collab-color", m.color || "#888888");
  return a;
};
const btn = (label, onClick, { ic, title, primary } = {}) => {
  const b = h("button.of-collab-btn", { type: "button", class: primary ? "of-collab-btn--primary" : "", title: title || undefined }, ic ? icon(ic) : null, label ? h("span", label) : null);
  if (!label && title) b.setAttribute("aria-label", title);
  b.addEventListener("click", onClick);
  return b;
};

export function bootCollabPopout(app, params) {
  document.documentElement.classList.add("is-collab-popout");
  document.title = `${t("Collaboration")} — OpenFini`;
  app.popout = params;
  app.sessionKey = sessionKey(params.id); // never touch the main window's autosaved session
  if (typeof BroadcastChannel === "undefined") {
    document.body.append(h("p.of-remote-note", t("This browser cannot connect two windows (no BroadcastChannel).")));
    return;
  }
  const pid = params.id;
  const channel = new BroadcastChannel(UI_CHANNEL);
  const post = (m) => {
    try {
      channel.postMessage(m);
    } catch {
      /* closed */
    }
  };
  let snap = null;
  let tab = "chat";
  let rid = 0;
  const drafts = new Map(); // thread id → reply draft (kept across snapshots)
  let chatDraft = "";

  // ---- shell
  const pill = h("span.of-collab-pill", { role: "status" }, t("Connecting…"));
  const dockBtn = btn(t("Dock back"), () => closeSelf(), { ic: "box-arrow-in-down-left", title: t("Close this window and show Collaboration in the main window again") });
  const head = h("div.of-collab-win__head", icon("people"), h("h2.of-collab-win__title", { id: "of-remote-title" }, t("Collaboration")), pill, dockBtn);
  const tablist = h("div.of-collab-tabs", { role: "tablist", "aria-label": t("Collaboration sections") });
  const nav = h("nav.of-collab-nav", { "aria-label": t("Collaboration") }, tablist);
  const aside = h("aside.of-collab-aside", { hidden: true, "aria-label": t("Conversations") });
  const body = h("div.of-collab-win__body", { role: "tabpanel", id: "of-remote-panel" });
  const live = h("div.of-sr-only", { "aria-live": "polite", role: "log" });
  const root = h("section.of-collab-win.of-collab-win--popout", { role: "main", "aria-labelledby": "of-remote-title", "data-mode": "narrow" }, head, h("div.of-collab-win__main", nav, aside, body), live);
  document.body.append(root);
  const tabs = new Map();
  for (const tb of TABS) {
    const b = h("button.of-collab-tab", { type: "button", role: "tab", id: `of-remote-tab-${tb.id}`, "aria-controls": "of-remote-panel" }, icon(tb.icon), h("span.of-collab-tab__label", t(tb.label)), h("span.of-collab-tab__badge"));
    b.addEventListener("click", () => select(tb.id));
    tabs.set(tb.id, b);
    tablist.append(b);
  }
  nav.addEventListener("keydown", (e) => {
    const vertical = root.dataset.mode !== "narrow";
    const keys = vertical ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    if (![...keys, "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const ids = TABS.map((x) => x.id);
    const i = ids.indexOf(tab);
    const j = e.key === "Home" ? 0 : e.key === "End" ? ids.length - 1 : (i + (e.key === keys[1] ? 1 : ids.length - 1)) % ids.length;
    select(ids[j]);
    tabs.get(ids[j]).focus();
  });
  new ResizeObserver(() => {
    const m = layoutMode(root.clientWidth);
    if (root.dataset.mode !== m) {
      root.dataset.mode = m;
      tablist.setAttribute("aria-orientation", m === "narrow" ? "horizontal" : "vertical");
      render();
    }
  }).observe(root);

  function select(id) {
    tab = id;
    for (const [k, b] of tabs) {
      b.setAttribute("aria-selected", String(k === tab));
      b.tabIndex = k === tab ? 0 : -1;
    }
    body.setAttribute("aria-labelledby", `of-remote-tab-${tab}`);
    render();
    if (tab === "chat") act("chat.read");
  }

  // ---- actions (answered by `res`)
  const waiting = new Map();
  function act(name, args = {}) {
    const id = `r${++rid}`;
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      post({ t: "act", pid, rid: id, a: { name, args } });
      setTimeout(() => waiting.delete(id) && resolve({ ok: false, error: t("The main window did not answer.") }), 8000);
    });
  }
  const report = (r) => r && !r.ok && live.replaceChildren(h("p", r.error || t("That did not work.")));

  // ---- rendering
  function renderHead() {
    const s = snap?.status;
    pill.className = "of-collab-pill";
    if (!snap) pill.textContent = t("Connecting…");
    else if (!s.inRoom) pill.textContent = t("Not in a room");
    else {
      pill.className = `of-collab-pill of-collab-pill--${s.state === "open" ? "ok" : "warn"}`;
      pill.textContent = s.state === "open" ? t("{host} · encrypted · {n, plural, one {# member} other {# members}}", { host: s.host, n: s.members }) : t("Connecting…");
    }
    const cb = tabs.get("chat").querySelector(".of-collab-tab__badge");
    cb.textContent = snap?.unread && tab !== "chat" ? String(Math.min(99, snap.unread)) : "";
    const ob = tabs.get("comments").querySelector(".of-collab-tab__badge");
    ob.textContent = snap ? String(snap.threads.filter((x) => !x.resolved).length || "") : "";
  }

  let chatParts = null;
  function render() {
    renderHead();
    const wide = root.dataset.mode === "wide";
    aside.hidden = !(wide && snap && (tab === "chat" || tab === "comments"));
    if (!snap) return body.replaceChildren(h("p.of-remote-note", t("Waiting for the main window… Keep OpenFini open in the other window.")));
    if (!aside.hidden) {
      aside.replaceChildren(
        h("h3.of-collab-aside__title", tab === "chat" ? t("Members") : t("Threads")),
        ...(tab === "chat"
          ? snap.members.map((m) => h("div.of-collab-aside__row", avatar(m), h("span", m.nick + (m.id === snap.me.id ? ` ${t("(you)")}` : ""))))
          : snap.threads.map((th) => h("div.of-collab-aside__row", h("span.of-collab-aside__dot", { style: `background:${th.color}` }), h("span", `${th.n}. ${th.messages.find((m) => !m.deleted)?.text || "…"}`)))),
      );
    }
    if (tab !== "chat") chatParts = null;
    if (tab === "chat") renderChat();
    else if (tab === "people") renderPeople();
    else renderComments();
  }

  function renderChat() {
    if (!snap.status.inRoom) return body.replaceChildren(h("p.of-remote-note", t("Not in a room. Start or join a room in the main window.")));
    if (!chatParts) {
      const list = h("div.of-remote-chat__list", { role: "log", "aria-label": t("Messages") });
      const ta = h("textarea.of-collab-input", { rows: 2, maxLength: 4000, placeholder: t("Message…"), "aria-label": t("Message") });
      ta.value = chatDraft;
      ta.addEventListener("input", () => (chatDraft = ta.value));
      const send = async () => {
        const text = ta.value.trim();
        if (!text) return;
        ta.value = chatDraft = "";
        report(await act("chat.send", { text }));
      };
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });
      const composer = h("div.of-remote-chat__composer", ta, btn("", send, { ic: "send", title: t("Send") }));
      chatParts = { list, ta, composer, root: h("div.of-remote-chat", list, composer) };
      body.replaceChildren(chatParts.root);
    }
    const { list } = chatParts;
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 24;
    chatParts.ta.disabled = !snap.status.canChat;
    list.replaceChildren(...snap.chat.map((m) => (m.kind === "chat" ? h("div.of-remote-chat__msg", avatar(m), h("div", h("div.of-msg__head", h("span.of-msg__who", m.nick), h("time.of-msg__time", fmtTime(m.ts))), h("p.of-msg__text", m.deleted ? t("Message deleted") : m.text))) : h("div.of-remote-chat__msg.of-remote-chat__msg--system", h("span"), h("span", m.kind === "activity" ? `${m.nick} ${m.text}` : m.text)))));
    if (stick) list.scrollTop = list.scrollHeight;
  }

  function renderPeople() {
    if (!snap.status.inRoom) return body.replaceChildren(h("p.of-remote-note", t("Not in a room. Start or join a room in the main window.")));
    const roleLabel = (r) => ({ host: t("Host"), editor: t("Editor"), commenter: t("Commenter"), viewer: t("Viewer") })[r] || r;
    body.replaceChildren(h("div.of-remote-people", ...snap.members.map((m) => h("div.of-collab-aside__row", avatar(m), h("span", `${m.nick}${m.id === snap.me.id ? ` ${t("(you)")}` : ""} · ${roleLabel(m.role)}`)))), h("p.of-remote-note", t("Invitations, roles and verification words are managed in the main window.")));
  }

  function renderComments() {
    for (const ta of body.querySelectorAll("textarea[data-thread]")) drafts.set(ta.dataset.thread, ta.value);
    const hadFocus = document.activeElement?.dataset?.thread || null;
    const cards = snap.threads.map((th) => {
      const ta = h("textarea.of-collab-input", { rows: 1, placeholder: t("Reply…"), "aria-label": t("Reply to this comment") });
      ta.dataset.thread = th.id;
      ta.value = drafts.get(th.id) || "";
      const send = async () => {
        const text = ta.value.trim();
        if (!text) return;
        ta.value = "";
        drafts.delete(th.id);
        report(await act("comment.reply", { thread: th.id, text }));
      };
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });
      const msgs = th.messages.map((m) => h("div.of-thread__msg", avatar(m), h("div", h("div.of-msg__head", h("span.of-msg__who", m.nick), h("time.of-msg__time", fmtTime(m.ts))), h("p.of-msg__text", m.deleted ? t("Comment deleted") : m.text))));
      const card = h("article.of-thread", { class: th.resolved ? "of-thread--resolved" : "", style: `--of-collab-color:${th.color}` },
        h("div.of-thread__head", btn(`${th.n}. ${th.where}`, () => act("comment.jump", { thread: th.id }), { ic: "crosshair", title: t("Show where this comment is in the main window") }), btn(th.resolved ? t("Reopen") : t("Resolve"), async () => report(await act("comment.resolve", { thread: th.id, on: !th.resolved })), { ic: th.resolved ? "arrow-counterclockwise" : "check2-circle" })),
        ...msgs,
        h("div.of-thread__reply", ta, btn("", send, { ic: "send", title: t("Reply") })),
      );
      return card;
    });
    const newTa = h("textarea.of-collab-input", { rows: 2, placeholder: t("New comment on the current selection in the main window…"), "aria-label": t("New comment") });
    const add = btn(t("Comment"), async () => {
      const text = newTa.value.trim();
      if (!text) return;
      newTa.value = "";
      report(await act("comment.add", { text }));
    }, { primary: true });
    body.replaceChildren(h("div.of-comments", snap.doc ? h("section.of-collab-card", h("div.of-comments__anchor", icon("chat-quote"), h("span", snap.doc.name)), newTa, h("div.of-collab-actions", add)) : h("p.of-collab-empty", t("Open a document in the main window to comment.")), cards.length ? h("div.of-comments__list", ...cards) : h("p.of-collab-empty", t("No comments."))));
    if (hadFocus) body.querySelector(`textarea[data-thread="${CSS.escape(hadFocus)}"]`)?.focus();
  }

  // ---- connection
  let key = "";
  channel.onmessage = (ev) => {
    const m = ev.data;
    if (!isUiMessage(m)) return;
    if (m.t === "snap") {
      const s = readSnapshot(m.s);
      if (!s) return;
      const prevUnread = snap?.unread || 0;
      snap = s;
      const k = JSON.stringify([s.status, s.members, s.chat.length && s.chat[s.chat.length - 1].id, s.chat.length, s.threads, s.doc, tab === "chat" ? 0 : s.unread]);
      if (k !== key || !chatParts) {
        key = k;
        render();
      } else renderHead();
      if (tab === "chat" && (s.unread || prevUnread)) act("chat.read");
      const last = s.chat[s.chat.length - 1];
      if (last && last.kind === "chat" && !last.mine && document.hidden) live.replaceChildren(h("p", `${last.nick}: ${last.text}`));
    } else if (m.t === "res") {
      waiting.get(m.rid)?.(m);
      waiting.delete(m.rid);
    } else if (m.t === "dock") closeSelf(false);
  };
  window.addEventListener("pagehide", () => post({ t: "bye", pid }));
  function closeSelf(notify = true) {
    if (notify) post({ t: "bye", pid });
    if (platform.isDesktop) windowControls.close();
    else window.close();
  }
  select("chat");
  post({ t: "hello", pid });
  // the main window may still be starting up, or the room UI is unavailable there: ask again until it answers
  const retry = setInterval(() => (snap ? undefined : post({ t: "hello", pid })), 2000);
  window.addEventListener("pagehide", () => clearInterval(retry));
}
