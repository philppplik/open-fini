// The Collaboration window: a floating, draggable, resizable window inside the app that stays open across studios.
// Tabs: Chat (room chat with replies, threads, reactions, mentions, files, links and the activity feed), People
// (status, verification words, invite code, members, roles, follow), Comments (threads of the active document) and
// Versions (named snapshots of the active document). Comments and versions work without a room.
//
// API: showCollabWindow(app, controller, tab?) → { el, select(tab), startComment(anchor, text), startSaveVersion() }
// Accessibility: role="dialog" (non-modal), tabs with role="tablist", new chat messages announced through an
// aria-live log, every action is a real button, Esc in a text field cancels the reply/edit, focus stays put on updates.
import { h, formatBytes } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { platform } from "../../platform/index.js";
import { REACTIONS, LIMITS, canDo, ROLES } from "../../collab/protocol.js";
import { relayHost, CollabCryptoError } from "../../collab/crypto.js";
import { checkFile } from "../../collab/files.js";
import { filterThreads, threadTitle, threadCounts } from "../../collab/comments.js";
import { avatarEl, colorFor } from "./runtime.js";
import { confirmDialog, openDialog } from "../dialogs.js";

const POS_KEY = "openfini.collab.window";
const TABS = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "people", label: "People", icon: "people" },
  { id: "comments", label: "Comments", icon: "chat-quote" },
  { id: "versions", label: "Versions", icon: "clock-history" },
];

let win = null;

export function showCollabWindow(app, c, tab) {
  if (!win) win = createWindow(app, c);
  win.show(tab);
  return win;
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (ts) => new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const icon = (name) => h("sl-icon", { name, "aria-hidden": "true" });
const btn = (label, onClick, { cls = "", ic, title, variant } = {}) => {
  const b = h("button.of-collab-btn", { type: "button", class: `${cls}${variant ? ` of-collab-btn--${variant}` : ""}`, title: title || undefined }, ic ? icon(ic) : null, label ? h("span", label) : null);
  if (!label && title) b.setAttribute("aria-label", title);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(e, b);
  });
  return b;
};
const roleLabel = (r) => ({ host: t("Host"), editor: t("Editor"), commenter: t("Commenter"), viewer: t("Viewer") })[r] || r;

function createWindow(app, c) {
  let tab = "chat";
  let threadRoot = null; // chat thread being shown
  let replyTo = null;
  let editing = null; // chat message id being edited
  let commentFilter = { status: "open", mine: false };
  let focusThread = null;
  let pendingAnchor = null;
  let showQr = false; // People ▸ join link QR code shown

  const title = h("h2.of-collab-win__title", t("Collaboration"));
  const pill = h("span.of-collab-pill", { role: "status" });
  const close = btn("", () => hide(), { ic: "x-lg", title: t("Close") });
  const head = h("div.of-collab-win__head", icon("people"), title, pill, close);
  const tablist = h("div.of-collab-tabs", { role: "tablist", "aria-label": t("Collaboration sections") });
  const body = h("div.of-collab-win__body");
  const live = h("div.of-sr-only", { "aria-live": "polite", role: "log" }); // announces new messages
  const el = h("section.of-collab-win", { role: "dialog", "aria-modal": "false", "aria-labelledby": "of-collab-title", tabIndex: -1 }, head, tablist, body, live);
  title.id = "of-collab-title";
  document.body.append(el);

  // ---- position (per-viewer convenience) and dragging
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    if (p && Number.isFinite(p.x)) Object.assign(el.style, { left: `${Math.max(0, Math.min(innerWidth - 200, p.x))}px`, top: `${Math.max(0, Math.min(innerHeight - 120, p.y))}px`, ...(p.w ? { width: `${p.w}px`, height: `${p.h}px` } : {}) });
  } catch {
    /* default position from CSS */
  }
  const savePos = () => {
    try {
      const r = el.getBoundingClientRect();
      localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }));
    } catch {
      /* storage blocked */
    }
  };
  head.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => {
      el.style.left = `${Math.max(0, Math.min(innerWidth - 120, ev.clientX - dx))}px`;
      el.style.top = `${Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy))}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    };
    const up = () => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      savePos();
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
  });
  new ResizeObserver(() => el.isConnected && !el.hidden && savePos()).observe(el);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.target.closest("textarea, input")) hide();
    e.stopPropagation(); // typing here must not trigger canvas shortcuts
  });

  // ---- tabs
  const tabButtons = new Map();
  for (const tb of TABS) {
    const b = h("button.of-collab-tab", { type: "button", role: "tab", id: `of-collab-tab-${tb.id}`, "aria-controls": "of-collab-panel" }, icon(tb.icon), h("span", t(tb.label)), h("span.of-collab-tab__badge"));
    b.addEventListener("click", () => select(tb.id));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = TABS.findIndex((x) => x.id === tab);
      const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].id;
      select(next);
      tabButtons.get(next).focus();
    });
    tabButtons.set(tb.id, b);
    tablist.append(b);
  }
  body.id = "of-collab-panel";
  body.setAttribute("role", "tabpanel");

  function select(id) {
    tab = TABS.some((x) => x.id === id) ? id : tab;
    for (const [k, b] of tabButtons) {
      b.setAttribute("aria-selected", String(k === tab));
      b.tabIndex = k === tab ? 0 : -1;
    }
    body.setAttribute("aria-labelledby", `of-collab-tab-${tab}`);
    render();
  }

  function show(id) {
    el.hidden = false;
    if (id) select(id);
    else render();
    if (tab === "chat") c.markRead();
  }
  function hide() {
    el.hidden = true;
    app.cv?.stage?.focus?.();
  }

  // ---- status pill and badges
  function renderHead() {
    const st = c.status();
    if (!c.session) {
      pill.textContent = t("Not in a room");
      pill.className = "of-collab-pill";
    } else {
      const state = c.session.state;
      pill.className = `of-collab-pill of-collab-pill--${state === "open" ? "ok" : "warn"}`;
      pill.textContent = state === "open" ? t("{host} · encrypted · {n, plural, one {# member} other {# members}}", { host: c.session.relayHost, n: st.members }) : state === "reconnecting" || state === "connecting" ? t("Connecting…") : t("Disconnected");
    }
    const unread = c.session?.chatStore.unread || 0;
    const badge = tabButtons.get("chat").querySelector(".of-collab-tab__badge");
    badge.textContent = unread && !(tab === "chat" && !el.hidden) ? String(Math.min(99, unread)) : "";
    const cb = tabButtons.get("comments").querySelector(".of-collab-tab__badge");
    cb.textContent = app.doc ? String(threadCounts(c.threads(app.doc)).open || "") : "";
  }

  // ---- re-render on changes (coalesced per frame; the chat composer is kept)
  let queued = false;
  const onChange = (e) => {
    const what = e.detail;
    if (what === "presence" && tab !== "people") return renderHead();
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (el.hidden) return renderHead();
      if (tab === "chat" && c.session && what === "chat") return renderChatList(true);
      render();
    });
  };
  c.events.addEventListener("change", onChange);
  c.events.addEventListener("focus-thread", (e) => {
    focusThread = e.detail;
    commentFilter.status = "all";
    select("comments");
  });
  for (const ev of ["doc", "docs"]) app.on(ev, () => !el.hidden && (tab === "comments" || tab === "versions") && render());

  // ================================================================ render
  let chatParts = null;

  function render() {
    renderHead();
    if (tab === "chat") return c.session ? renderChat() : renderStart();
    chatParts = null;
    if (tab === "people") return c.session ? renderPeople() : renderStart();
    if (tab === "comments") return renderComments();
    if (tab === "versions") return renderVersions();
  }

  // ---------------------------------------------------------------- start (not in a room)
  function renderStart() {
    chatParts = null;
    const nick = h("input.of-collab-input", { value: app.prefs.collabNick || "", maxLength: LIMITS.nick, placeholder: t("Your name"), "aria-label": t("Nickname") });
    nick.addEventListener("change", () => {
      app.setPref("collabNick", nick.value.trim().slice(0, LIMITS.nick));
      c.profileChanged();
    });
    const me = h("div.of-collab-me", avatarEl(c.profile(), 36, { own: true }), h("label.of-collab-field", h("span", t("Your nickname in rooms")), nick), btn("", () => app.run("collab.profile"), { ic: "gear", title: t("Profile and collaboration settings") }));

    const where = h("select.of-collab-input", { "aria-label": t("Where") }, h("option", { value: "local" }, t("This device: other windows and tabs")), h("option", { value: "relay" }, t("Relay server (local network or internet)")));
    const relay = h("input.of-collab-input", { value: app.prefs.collabRelay || "ws://127.0.0.1:8787/", spellcheck: false, "aria-label": t("Relay address"), placeholder: "wss://relay.example.org/" });
    // relay: loopback warning, "Test connection" with a diagnosis, and how to start one
    const loopNote = h("p.of-collab-note", { hidden: true }, icon("info-circle"), t("localhost is this computer only. Other devices join through this computer's network address: after creating the room, pick it under People ▸ Invite."));
    const diag = h("ul.of-relay-diag", { "aria-live": "polite" });
    const testBtn = btn(t("Test connection"), async (e, b) => {
      b.disabled = true;
      diag.replaceChildren(h("li", t("Checking…")));
      try {
        const { diagnose } = await import("./network.js");
        const r = await diagnose(relay.value.trim(), { app });
        diag.replaceChildren(...r.steps.map((s) => h("li", { class: s.ok ? "is-ok" : "is-bad" }, icon(s.ok ? "check-circle" : "exclamation-triangle"), h("span", s.text, s.fix ? h("span.of-relay-diag__fix", ` ${s.fix}`) : null))));
      } finally {
        b.disabled = false;
      }
    }, { ic: "activity" });
    const help = btn(t("How to start a relay"), () => app.run("collab.relayHelp"), { ic: "terminal" });
    const relayRow = h("div.of-collab-field", h("label.of-collab-field", h("span", t("Relay address")), relay), loopNote, h("div.of-collab-actions", testBtn, help), diag);
    const checkLoop = async () => {
      const { isLoopbackRelay } = await import("./network.js");
      loopNote.hidden = !isLoopbackRelay(relay.value.trim());
    };
    relay.addEventListener("input", checkLoop);
    checkLoop();
    const role = h("select.of-collab-input", { "aria-label": t("New members join as") }, ...["editor", "commenter", "viewer"].map((r) => h("option", { value: r }, roleLabel(r))));
    const sync = () => (relayRow.hidden = where.value !== "relay");
    where.addEventListener("change", sync);
    sync();
    const err = h("p.of-collab-error", { role: "alert" });
    const create = btn(t("Create room"), async (e, b) => {
      err.textContent = "";
      if (!app.prefs.collabNick && nick.value.trim()) app.setPref("collabNick", nick.value.trim());
      b.disabled = true;
      try {
        await c.createRoom({ relay: where.value === "local" ? "local" : relay.value.trim(), defaultRole: role.value });
        select("people");
      } catch (ex) {
        err.textContent = ex instanceof CollabCryptoError || ex.code ? ex.message : t("The room could not be created: {message}", { message: ex.message });
      } finally {
        b.disabled = false;
      }
    }, { variant: "primary", ic: "plus-lg" });

    const code = h("textarea.of-collab-input", { rows: 3, spellcheck: false, placeholder: "wss://host:8787/#ofc1.…", "aria-label": t("Invite code") });
    const fromLink = c.prefillInvite ? h("p.of-collab-note", icon("link-45deg"), t("Filled in from a join link. Check that you expected an invitation, then choose Join.")) : null;
    if (c.prefillInvite) {
      code.value = c.prefillInvite;
      c.prefillInvite = "";
    }
    const join = btn(t("Join…"), async (e, b) => {
      err.textContent = "";
      let host;
      try {
        const { parseInvite } = await import("../../collab/crypto.js");
        host = relayHost(parseInvite(code.value).relay);
      } catch (ex) {
        err.textContent = ex.message;
        return;
      }
      if (!app.prefs.collabNick && nick.value.trim()) app.setPref("collabNick", nick.value.trim());
      const ok = await confirmDialog({
        title: "Join room",
        message:
          host === "this device"
            ? t("Join the room in the other windows of this device as “{name}”? Members will see your nickname, avatar, which document, page and tool you use, your pointer and selection, and what you post.", { name: c.profile().nick })
            : t("Join the room on {host} as “{name}”? Members will see your nickname, avatar, which document, page and tool you use, your pointer and selection, and what you post. Content is end-to-end encrypted; the relay sees your IP address, the room id and when and how much is sent.", { host, name: c.profile().nick }),
        ok: "Join",
      });
      if (!ok) return;
      b.disabled = true;
      try {
        await c.joinRoom(code.value);
        code.value = "";
        select("people");
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        b.disabled = false;
      }
    }, { variant: "primary", ic: "box-arrow-in-right" });

    const offline = app.prefs.offlineMode ? h("p.of-collab-note", icon("wifi-off"), t("Offline mode is on: only rooms on this device and relays on this computer (localhost) work.")) : null;
    body.replaceChildren(
      h("div.of-collab-start",
        me,
        offline,
        h("section.of-collab-card", h("h3", t("Start a room")), h("label.of-collab-field", h("span", t("Where")), where), relayRow, h("label.of-collab-field", h("span", t("New members join as")), role), h("div.of-collab-actions", create)),
        h("section.of-collab-card", h("h3", t("Join with an invite code")), fromLink, code, h("div.of-collab-actions", join)),
        err,
        h("p.of-collab-hint", t("Everything in a room is end-to-end encrypted with a key that only travels inside the invite code. A relay is a tiny server you run yourself: npm run relay -- --lan for your network (see How to start a relay). Comments and versions also work without a room.")),
      ),
    );
  }

  // ---------------------------------------------------------------- chat
  function renderChat() {
    const s = c.session;
    const list = h("div.of-chat__list", { role: "log", "aria-label": t("Messages"), tabIndex: 0 });
    const threadHead = h("div.of-chat__thread-head");
    const typing = h("div.of-chat__typing", { "aria-live": "polite" });
    const files = h("div.of-chat__files");
    const replyBar = h("div.of-chat__replybar");
    const input = h("textarea.of-chat__input", { rows: 2, maxLength: LIMITS.chatText, placeholder: t("Message the room… (@ to mention)"), "aria-label": t("Message") });
    const suggest = h("ul.of-chat__suggest", { role: "listbox", hidden: true, "aria-label": t("Members") });
    const fileInput = h("input", { type: "file", hidden: true });
    const attach = btn("", () => fileInput.click(), { ic: "paperclip", title: t("Send a file (up to 25 MB)") });
    const linkBtn = btn("", () => {
      const l = c.selectionLink();
      if (!l) return app.toast("Select a layer, a page or a code line first.", "neutral", 2400);
      pendingLinks.push(l);
      renderReplyBar();
    }, { ic: "link-45deg", title: t("Link the current selection") });
    const send = btn("", () => submit(), { ic: "send", title: t("Send (Enter)"), variant: "primary" });
    const composer = h("div.of-chat__composer", replyBar, h("div.of-chat__row", input, h("div.of-chat__tools", attach, linkBtn, send)), suggest, fileInput);
    const canChat = canDo(s.myRole, "chat");
    if (!canChat) composer.hidden = true;
    body.replaceChildren(h("div.of-chat", threadHead, list, files, typing, composer));
    chatParts = { list, threadHead, typing, files, replyBar, input };
    let pendingLinks = [];

    function renderReplyBar() {
      replyBar.replaceChildren();
      const m = replyTo && s.chatStore.byId.get(replyTo);
      if (editing) replyBar.append(h("div.of-chat__chip", icon("pencil"), h("span", t("Editing your message")), btn("", () => ((editing = null), (input.value = ""), renderReplyBar()), { ic: "x", title: t("Cancel") })));
      else if (m) replyBar.append(h("div.of-chat__chip", icon("quote"), h("span", t("Reply to {name}: {text}", { name: m.nick, text: (m.text || "").slice(0, 60) })), btn("", () => ((replyTo = null), renderReplyBar()), { ic: "x", title: t("Cancel reply") })));
      for (const l of pendingLinks) replyBar.append(h("div.of-chat__chip", icon("link-45deg"), h("span", l.label), btn("", () => ((pendingLinks = pendingLinks.filter((x) => x !== l)), renderReplyBar()), { ic: "x", title: t("Remove link") })));
    }

    async function submit() {
      const text = input.value.trim();
      if (!text && !pendingLinks.length) return;
      try {
        if (editing) {
          await s.editChat(editing, text);
          editing = null;
        } else {
          await s.chat(text || "🔗", { ...(replyTo ? { reply: replyTo } : {}), ...(threadRoot ? { thread: threadRoot } : {}), links: pendingLinks });
          replyTo = null;
          pendingLinks = [];
        }
        input.value = "";
        renderReplyBar();
        s.typing(false).catch(() => {});
      } catch (e) {
        app.toast(e.message, "danger", 4000);
      }
    }

    // @mention autocomplete
    let options = [];
    let active = 0;
    const mentionQuery = () => {
      const upto = input.value.slice(0, input.selectionStart);
      const m = /(^|\s)@([^\s@]{0,32})$/.exec(upto);
      return m ? { q: m[2].toLowerCase(), start: upto.length - m[2].length - 1 } : null;
    };
    const updateSuggest = () => {
      const mq = mentionQuery();
      options = mq ? s.members.filter((m) => (m.profile?.nick || "").toLowerCase().startsWith(mq.q)).slice(0, 6) : [];
      suggest.hidden = !options.length;
      active = Math.min(active, Math.max(0, options.length - 1));
      suggest.replaceChildren(...options.map((m, i) => {
        const li = h("li.of-chat__opt", { role: "option", id: `of-chat-opt-${i}`, "aria-selected": String(i === active) }, avatarEl(m.profile, 18), h("span", m.profile.nick));
        li.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          pick(i);
        });
        return li;
      }));
      if (options.length) input.setAttribute("aria-activedescendant", `of-chat-opt-${active}`);
      else input.removeAttribute("aria-activedescendant");
    };
    const pick = (i) => {
      const mq = mentionQuery();
      const m = options[i];
      if (!mq || !m) return;
      const before = input.value.slice(0, mq.start);
      const after = input.value.slice(input.selectionStart);
      input.value = `${before}@${m.profile.nick} ${after}`;
      const pos = before.length + m.profile.nick.length + 2;
      input.setSelectionRange(pos, pos);
      updateSuggest();
    };
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    let typingSent = 0;
    input.addEventListener("input", () => {
      updateSuggest();
      if (Date.now() - typingSent > 3000 && input.value) {
        typingSent = Date.now();
        s.typing(true).catch(() => {});
      }
    });
    input.addEventListener("keydown", (e) => {
      if (!suggest.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
        return updateSuggest();
      }
      if (!suggest.hidden && (e.key === "Enter" || e.key === "Tab")) {
        e.preventDefault();
        return pick(active);
      }
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.stopPropagation();
        if (!suggest.hidden) suggest.hidden = true;
        else if (editing || replyTo) {
          editing = null;
          replyTo = null;
          input.value = "";
          renderReplyBar();
        }
      }
    });
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      fileInput.value = "";
      if (!f) return;
      const chk = checkFile(f.name, f.size);
      if (!chk.ok) return app.toast(chk.error, "warning", 5000);
      try {
        await c.sendFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      } catch (e) {
        app.toast(e.message, "danger", 5000);
      }
    });
    chatParts.setReply = (id) => {
      replyTo = id;
      editing = null;
      renderReplyBar();
      input.focus();
    };
    chatParts.setEdit = (m) => {
      editing = m.id;
      replyTo = null;
      input.value = m.text;
      renderReplyBar();
      input.focus();
    };
    renderReplyBar();
    renderChatList(false);
    c.markRead();
  }

  let announced = 0;
  function renderChatList(incremental) {
    const s = c.session;
    if (!chatParts || !s) return render();
    const { list, threadHead, typing, files } = chatParts;
    const store = s.chatStore;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    threadHead.replaceChildren();
    let items;
    if (threadRoot && store.byId.has(threadRoot)) {
      const root = store.byId.get(threadRoot);
      threadHead.append(btn(t("Back to chat"), () => ((threadRoot = null), renderChatList(false)), { ic: "arrow-left" }), h("span.of-chat__thread-title", t("Thread: {text}", { text: (root.text || "").slice(0, 60) })));
      items = [root, ...store.thread(threadRoot)];
    } else {
      threadRoot = null;
      items = store.main();
    }
    list.replaceChildren(...items.map((m) => messageEl(m)));
    // typing and transfers
    const typers = s.members.filter((m) => m.typing).map((m) => m.profile?.nick || "?");
    typing.textContent = typers.length ? t("{names} typing…", { names: typers.join(", ") }) : "";
    files.replaceChildren(...[...c.transfers.values()].map((tr) => h("div.of-chat__progress", icon(tr.outgoing ? "upload" : "download"), h("span", tr.failed ? t("{name}: {error}", { name: tr.name, error: tr.failed }) : `${tr.name} · ${Math.round((100 * tr.done) / Math.max(1, tr.size))}%`), h("progress", { max: tr.size, value: tr.done }))));
    if (atBottom || !incremental) list.scrollTop = list.scrollHeight;
    // announce new messages from others to screen readers
    const fresh = store.list.slice(announced).filter((m) => m.kind === "chat" && m.from !== s.id);
    announced = store.list.length;
    if (fresh.length && incremental) live.textContent = fresh.map((m) => `${m.nick}: ${m.text}`).join(". ").slice(0, 300);
    if (!el.hidden) c.markRead();
    renderHead();
  }

  function messageEl(m) {
    const s = c.session;
    if (m.kind === "system") return h("div.of-msg.of-msg--system", h("span", t(m.text)));
    if (m.kind === "activity") {
      const a = m.activity;
      const n = a.count;
      const text = t("{label} · {n, plural, one {# layer} other {# layers}}{where}", { label: a.label, n, where: a.pageName ? t(" on {page}", { page: a.pageName }) : "" });
      const acts = h("span.of-msg__acts");
      if (a.nodes?.length && app.docs.some((d) => d.id === a.doc)) {
        acts.append(btn(t("Jump"), () => c.jump({ kind: "node", doc: a.doc, id: a.nodes[0], page: a.page, label: "" }), { cls: "of-collab-link" }), btn(t("Show"), () => c.preview(a.doc, a.nodes), { cls: "of-collab-link", title: t("Highlight the changed layers without selecting them") }));
      }
      return h("div.of-msg.of-msg--activity", avatarEl(s.member(m.from)?.profile || { nick: m.nick, color: m.color, initials: m.nick.slice(0, 2) }, 18), h("span.of-msg__who", m.nick), h("span", text), h("span.of-msg__doc", a.docName || ""), acts, h("time.of-msg__time", fmtTime(m.ts)));
    }
    const mine = m.from === s.id;
    const prof = mine ? s.profile : s.member(m.from)?.profile || { nick: m.nick, color: m.color, initials: m.nick.slice(0, 2) };
    const row = h("article.of-msg", { class: `${mine ? "of-msg--mine" : ""}${store().mentionsMe(m) ? " of-msg--mention" : ""}`, "aria-label": t("{name} at {time}", { name: m.nick, time: fmtTime(m.ts) }) });
    const head = h("div.of-msg__head", h("span.of-msg__who", m.nick), h("time.of-msg__time", fmtTime(m.ts)), m.edited && !m.deleted ? h("span.of-msg__edited", t("edited")) : null);
    const quote = m.reply && store().byId.get(m.reply);
    const content = h("div.of-msg__body");
    if (quote) content.append(h("div.of-msg__quote", h("strong", quote.nick), h("span", (quote.deleted ? t("Message deleted") : quote.text || "").slice(0, 120))));
    if (m.deleted) content.append(h("p.of-msg__text.of-msg__text--deleted", t("Message deleted")));
    else if (m.text && m.text !== "🔗") content.append(textWithMentions(m.text, s));
    for (const l of m.links || []) content.append(btn(l.label || t("Link"), () => c.jump(l), { cls: "of-chat__linkchip", ic: l.kind === "line" ? "code" : l.kind === "page" ? "file-earmark" : "bounding-box", title: t("Jump to {label}", { label: l.label }) }));
    if (m.file && !m.deleted) content.append(fileCard(m));
    const reacts = h("div.of-msg__reacts");
    for (const [emoji, who] of Object.entries(m.reactions || {})) {
      const on = who.includes(s.id);
      const b = btn(`${emoji} ${who.length}`, () => s.react(m.id, emoji, !on).catch((e) => app.toast(e.message, "danger")), { cls: `of-msg__react${on ? " on" : ""}`, title: who.map((id) => s.member(id)?.profile?.nick || "?").join(", ") });
      b.setAttribute("aria-pressed", String(on));
      reacts.append(b);
    }
    const tools = h("div.of-msg__tools");
    if (!m.deleted) {
      const picker = h("div.of-msg__picker", { hidden: true }, ...REACTIONS.map((e) => btn(e, () => ((picker.hidden = true), s.react(m.id, e, !(m.reactions[e] || []).includes(s.id)).catch(() => {})), { title: t("React with {emoji}", { emoji: e }) })));
      tools.append(btn("", () => (picker.hidden = !picker.hidden), { ic: "heart", title: t("React") }), picker);
      tools.append(btn("", () => chatParts?.setReply(m.id), { ic: "quote", title: t("Reply") }));
      if (!threadRoot) tools.append(btn("", () => ((threadRoot = m.id), renderChatList(false)), { ic: "chat", title: t("Reply in thread") }));
      if (mine) {
        tools.append(btn("", () => chatParts?.setEdit(m), { ic: "pencil", title: t("Edit") }));
        tools.append(btn("", async () => (await confirmDialog({ title: "Delete message", message: "Delete this message for everyone in the room?", ok: "Delete", danger: true })) && s.deleteChat(m.id).catch((e) => app.toast(e.message, "danger")), { ic: "trash3", title: t("Delete") }));
      }
    }
    const count = !threadRoot && store().threadCount(m.id);
    const threadLink = count ? btn(t("{n, plural, one {# reply} other {# replies}} in thread", { n: count }), () => ((threadRoot = m.id), renderChatList(false)), { cls: "of-collab-link" }) : null;
    row.append(avatarEl(prof, 28, { own: mine }), h("div.of-msg__main", head, content, reacts, threadLink), tools);
    return row;
  }
  const store = () => c.session.chatStore;

  function textWithMentions(text, s) {
    const p = h("p.of-msg__text");
    const nicks = [s.profile.nick, ...s.members.map((m) => m.profile?.nick).filter(Boolean)].sort((a, b) => b.length - a.length);
    let rest = text;
    while (rest) {
      let best = -1;
      let nick = "";
      for (const n of nicks) {
        const i = rest.toLowerCase().indexOf(`@${n.toLowerCase()}`);
        if (i >= 0 && (best < 0 || i < best)) {
          best = i;
          nick = n;
        }
      }
      if (best < 0) {
        p.append(rest);
        break;
      }
      p.append(rest.slice(0, best), h("span.of-msg__mention", rest.slice(best, best + nick.length + 1)));
      rest = rest.slice(best + nick.length + 1);
    }
    return p;
  }

  function fileCard(m) {
    const f = m.file;
    const got = c.received.get(f.fid);
    const mine = m.from === c.session.id;
    const card = h("div.of-filecard", icon(/\.ofini$/i.test(f.name) ? "file-earmark" : /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name) ? "file-earmark-image" : "file-earmark-text"), h("div.of-filecard__meta", h("strong", f.name), h("span", formatBytes(f.size))));
    const acts = h("div.of-filecard__acts");
    if (mine) acts.append(h("span.of-collab-hint", t("Sent")));
    else if (!got) acts.append(h("span.of-collab-hint", c.transfers.has(f.fid) ? t("Receiving…") : t("Not received")));
    else {
      const isDoc = got.transfer.ext === "ofini";
      const confirmOpen = async (mode) => {
        const ok = await confirmDialog({ title: "Open received file", message: t("Open “{name}” from {who}? Only open files from people you trust. Website scripts in it stay off until you enable them.", { name: f.name, who: m.nick }), ok: "Open" });
        if (ok) c.openReceived(f.fid, mode).catch((e) => app.toast(e.message, "danger", 5000));
      };
      if (isDoc) {
        acts.append(btn(t("Open"), () => confirmOpen("linked"), { title: t("Open with comments and presence linked to the room") }), btn(t("Open as copy"), () => confirmOpen("copy")));
        if (app.docs.some((d) => d.id === got.transfer.doc)) acts.append(btn(t("Update my copy"), () => confirmOpen("replace"), { title: t("Replace your open copy; a version of it is saved first") }));
      } else acts.append(btn(t("Open as document"), () => confirmOpen("copy")));
      acts.append(btn(t("Save…"), () => c.saveReceived(f.fid).catch((e) => app.toast(e.message, "danger"))));
    }
    card.append(acts);
    return card;
  }

  // ---------------------------------------------------------------- people
  function renderPeople() {
    const s = c.session;
    const st = c.status();
    const words = h("p.of-collab-words", { "aria-label": t("Verification words") }, ...s.fingerprint.map((w) => h("span", w)));
    const inviteBox = h("div.of-collab-invite");
    const showInvite = btn(t("Show invite code"), () => {
      inviteBox.replaceChildren(h("textarea.of-collab-input", { readOnly: true, rows: 3, value: s.shareInviteCode, "aria-label": t("Invite code") }), h("p.of-collab-hint", t("Anyone with this code can join until the host changes the key. Share it privately (not in public channels). It is never saved by OpenFini.")));
    }, { ic: "eye" });
    const copyText = async (text, done) => {
      try {
        await navigator.clipboard.writeText(text);
        app.toast(done, "success", 2200);
      } catch {
        app.toast("Copying failed. Use “Show invite code” and copy it by hand.", "warning", 3000);
      }
    };
    const copy = btn(t("Copy invite code"), () => copyText(s.shareInviteCode, t("Invite code copied. Share it privately.")), { ic: "copy" });
    const leave = btn(t("Leave"), () => app.run("collab.leave"), { ic: "box-arrow-up-right", variant: "danger" });
    const share = app.doc && canDo(s.myRole, "file-offer") ? btn(t("Share this document…"), () => c.shareFlow(app.doc).catch((e) => app.toast(e.message, "danger", 5000)), { ic: "share" }) : null;
    // rooms across the network: the address other devices use, join link and QR code (from the relay's /info)
    const lanBox = h("div.of-collab-lan");
    if (s.invite.relay !== "local") {
      import("./network.js").then(async (net) => {
        const info = await net.relayInfo(s.invite.relay);
        const addrs = net.inviteAddresses(info, s.invite.relay);
        const parts = [];
        if (net.isLoopbackRelay(s.invite.relay) && !s.inviteRelay) parts.push(h("p.of-collab-note", icon("exclamation-triangle"), t("This invite points to localhost, which other devices cannot reach. Choose this computer's network address below.")));
        if (addrs.length) {
          const cur = s.inviteRelay || s.invite.relay;
          const sel = h("select.of-collab-input", { "aria-label": t("Address for other devices") }, h("option", { value: s.invite.relay }, t("{url} (as entered)", { url: s.invite.relay })), ...addrs.map((a) => h("option", { value: a.url, selected: a.url === cur }, a.label)));
          sel.addEventListener("change", () => {
            try {
              if (sel.value === s.invite.relay) s.inviteRelay = null;
              else s.setInviteRelay(sel.value);
              renderPeople();
            } catch (e) {
              app.toast(e.message, "danger", 4000);
            }
          });
          parts.push(h("label.of-collab-field", h("span", t("Address for other devices")), sel));
        } else if (!info && net.isLoopbackRelay(s.invite.relay)) parts.push(h("p.of-collab-hint", t("The relay's network addresses could not be read. Start it with npm run relay -- --lan, or type this computer's IP address into the relay address.")));
        const link = net.joinLink(info, s.shareInviteCode);
        if (link) {
          const qrBox = h("div.of-collab-qr");
          const qrBtn = btn(showQr ? t("Hide QR code") : t("Show QR code"), () => ((showQr = !showQr), renderPeople()), { ic: "phone" });
          qrBtn.setAttribute("aria-pressed", String(showQr));
          if (showQr) qrBox.replaceChildren(net.qrSvg(link, t("QR code of the join link")), h("p.of-collab-hint", t("Scan with a phone or tablet on the same network. Anyone who can see this code can join the room.")));
          parts.push(h("div.of-collab-actions", btn(t("Copy join link"), () => copyText(link, t("Join link copied. It contains the room key: share it privately.")), { ic: "link-45deg" }), qrBtn), qrBox);
        }
        lanBox.replaceChildren(...parts);
      });
    }
    const status = h("section.of-collab-card",
      h("div.of-collab-status", icon(st.connected ? "shield-check" : "exclamation-triangle"), h("span", st.connected ? t("Connected to {host}, end-to-end encrypted, {n, plural, one {# member} other {# members}}.", { host: s.relayHost, n: st.members }) : t("Not connected ({state}).", { state: s.state }))),
      h("h3", t("Verification words")),
      words,
      h("p.of-collab-hint", t("Everyone in the room sees the same six words. Compare them by phone or in person: if they differ, someone is not in the room you think, so leave.")),
      h("div.of-collab-actions", showInvite, copy, share, leave),
      lanBox,
      inviteBox,
    );
    // documents shared in this room ("Edit together", beta)
    const sharedBox = h("div");
    c.live().then((live) => {
      const list = live.list();
      if (!list.length) return;
      const row = (d) => {
        const acts = d.open
          ? [btn(d.ownedByMe ? t("Stop sharing") : t("Leave"), () => live.stop(d.doc).catch((e) => app.toast(e.message, "danger")), { ic: "x-circle" })]
          : [btn(t("Open live"), () => live.openLive(d.doc).catch((e) => app.toast(e.message, "danger", 5000)), { variant: "primary" }), btn(t("Open copy"), () => live.openCopy(d.doc).catch((e) => app.toast(e.message, "danger", 5000)))];
        const meta = d.open ? (d.paused ? t("Live · paused · {n, plural, one {# person} other {# people}}", { n: d.people }) : t("Live · {n, plural, one {# person} other {# people}}", { n: d.people })) : t("Shared by {name}", { name: d.from });
        return h("li.of-collab-member", icon(d.kind === "text" ? "code-slash" : "file-earmark"), h("div.of-collab-member__meta", h("strong", d.name), h("span", meta)), h("div.of-collab-member__acts", ...acts));
      };
      sharedBox.replaceChildren(h("section.of-collab-card", h("h3", t("Shared documents (Edit together, beta)")), h("ul.of-collab-members", ...list.map(row))));
    });
    const rows = [];
    rows.push(memberRow({ id: s.id, profile: s.profile, presence: c.presencePayload(), online: true }, true));
    for (const m of s.members) rows.push(memberRow(m, false));
    const filesBox = c.received.size ? h("section.of-collab-card", h("h3", t("Received files")), ...[...c.received.values()].map(({ transfer }) => h("div.of-filecard", icon("file-earmark"), h("div.of-filecard__meta", h("strong", transfer.name), h("span", formatBytes(transfer.size))), h("div.of-filecard__acts", btn(t("Open"), async () => (await confirmDialog({ title: "Open received file", message: t("Open “{name}”? Only open files from people you trust.", { name: transfer.name }), ok: "Open" })) && c.openReceived(transfer.fid, "copy").catch((e) => app.toast(e.message, "danger"))), btn(t("Save…"), () => c.saveReceived(transfer.fid)), btn("", () => c.dismissReceived(transfer.fid), { ic: "x", title: t("Dismiss") }))))) : null;
    body.replaceChildren(h("div.of-collab-people", status, sharedBox, h("section.of-collab-card", h("h3", t("Members")), h("ul.of-collab-members", ...rows)), filesBox));
  }

  function memberRow(m, isMe) {
    const s = c.session;
    const p = m.presence || {};
    const role = s.room.roleOf(m.id);
    const where = p.docName ? `${studioName(p.studio)} · ${p.docName}` : studioName(p.studio);
    const li = h("li.of-collab-member", avatarEl(m.profile, 30, { own: isMe }), h("div.of-collab-member__meta", h("strong", isMe ? t("{name} (you)", { name: m.profile?.nick || "?" }) : m.profile?.nick || "?"), h("span", [roleLabel(role), where].filter(Boolean).join(" · "))));
    const acts = h("div.of-collab-member__acts");
    if (!isMe) {
      const following = c.followId === m.id;
      const f = btn(following ? t("Stop following") : t("Follow"), () => c.follow(following ? null : m.id), { ic: "crosshair", title: t("Show what {name} sees", { name: m.profile?.nick || "?" }) });
      f.setAttribute("aria-pressed", String(following));
      acts.append(f);
      if (s.isHost && role !== "host") {
        const sel = h("select.of-collab-input", { "aria-label": t("Role of {name}", { name: m.profile?.nick || "?" }) }, ...ROLES.filter((r) => r !== "host").map((r) => h("option", { value: r, selected: r === role }, roleLabel(r))));
        sel.addEventListener("change", () => s.setRole(m.id, sel.value).catch((e) => app.toast(e.message, "danger")));
        acts.append(sel, btn("", async () => {
          if (await confirmDialog({ title: "Remove member", message: t("Remove {name} from the room? The room key is changed so they cannot read anything that follows; everyone else is switched over automatically.", { name: m.profile?.nick || "?" }), ok: "Remove", danger: true })) s.remove(m.id).catch((e) => app.toast(e.message, "danger"));
        }, { ic: "x-circle", title: t("Remove from room") }));
      }
    } else acts.append(btn("", () => app.run("collab.profile"), { ic: "pencil", title: t("Edit profile") }));
    li.append(acts);
    return li;
  }
  const studioName = (id) => ({ vector: t("Vector"), pixel: t("Pixel"), layout: t("Layout"), code: t("Code"), vibe: t("Vibe"), office: t("Office") })[id] || "";

  // ---------------------------------------------------------------- comments
  function renderComments() {
    const doc = app.doc;
    if (!doc) return body.replaceChildren(h("p.of-collab-empty", t("Open a document to see and add comments.")));
    const threads = c.threads(doc);
    const counts = threadCounts(threads);
    const seg = h("div.of-collab-seg", { role: "group", "aria-label": t("Show") }, ...[["open", t("Open ({n})", { n: counts.open })], ["resolved", t("Resolved ({n})", { n: counts.resolved })], ["all", t("All")]].map(([v, label]) => {
      const b = btn(label, () => ((commentFilter.status = v), renderComments()));
      b.setAttribute("aria-pressed", String(commentFilter.status === v));
      return b;
    }));
    const mine = h("label.of-collab-check", h("input", { type: "checkbox", checked: commentFilter.mine }), h("span", t("Mine and mentions")));
    mine.firstChild.addEventListener("change", (e) => ((commentFilter.mine = e.target.checked), renderComments()));
    const add = btn(t("New comment"), () => startComment(c.currentAnchor()), { ic: "plus-lg", variant: "primary" });
    const composer = pendingAnchor ? newCommentForm(doc) : null;
    const listed = filterThreads(threads, { status: commentFilter.status, mine: commentFilter.mine ? c.myId : null });
    const items = listed.map((th) => threadCard(doc, th));
    body.replaceChildren(h("div.of-comments", h("div.of-comments__bar", seg, mine, add), composer, items.length ? h("div.of-comments__list", ...items) : h("p.of-collab-empty", commentFilter.status === "open" ? t("No open comments. Select a layer, text or code line and choose Add Comment (Ctrl+Alt+M).") : t("Nothing here."))));
    if (focusThread) {
      const card = body.querySelector(`[data-thread="${CSS.escape(focusThread)}"]`);
      card?.scrollIntoView({ block: "nearest" });
      card?.querySelector("textarea")?.focus();
      focusThread = null;
    }
    if (composer) composer.querySelector("textarea").focus();
  }

  function anchorLabel(doc, a) {
    switch (a.kind) {
      case "node": {
        const n = doc.find(a.node);
        return n ? t("Layer “{name}”", { name: n.name || n.type }) : t("Deleted layer “{name}”", { name: a.quote || "?" });
      }
      case "page":
      case "region": {
        const p = doc.pages.find((x) => x.id === a.page);
        return p ? t("Page “{name}”", { name: p.name || "" }) : t("Deleted page");
      }
      case "line":
        return t("{file}, line {line}", { file: (a.path || "").split("/").pop(), line: a.line });
      case "text":
        return a.quote ? t("Text “{quote}”", { quote: a.quote.slice(0, 40) }) : t("Text");
      default:
        return t("Document");
    }
  }

  function jumpToAnchor(doc, a) {
    if (a.kind === "node") return c.jump({ kind: "node", doc: doc.id, id: a.node, page: a.page });
    if (a.kind === "page" || a.kind === "region") return c.jump({ kind: "page", doc: doc.id, id: a.page, page: a.page });
    if (a.kind === "line") return c.jump({ kind: "line", doc: doc.id, id: a.path, line: a.line });
    if (a.kind === "text" && app.officeUI?.editor && app.officeUI.doc === doc) {
      try {
        app.setStudio("office");
        const path = JSON.parse(a.path);
        app.officeUI.editor.setSelection({ anchor: { path, offset: a.from || 0 }, focus: { path, offset: a.to ?? a.from ?? 0 } });
      } catch {
        /* the paragraph moved */
      }
    }
  }

  function newCommentForm(doc) {
    const ta = h("textarea.of-collab-input", { rows: 3, maxLength: LIMITS.commentText, placeholder: t("Add a comment… (@ to mention)"), "aria-label": t("Comment") });
    if (pendingAnchor.text) ta.value = pendingAnchor.text;
    const save = () => {
      try {
        c.addThread(doc, pendingAnchor.anchor, ta.value);
        pendingAnchor = null;
        commentFilter.status = "open";
        renderComments();
      } catch (e) {
        app.toast(e.message, "warning", 3000);
      }
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
      if (e.key === "Escape") {
        e.stopPropagation();
        pendingAnchor = null;
        renderComments();
      }
    });
    return h("section.of-collab-card.of-comments__new", h("div.of-comments__anchor", icon("chat-quote"), h("span", anchorLabel(doc, pendingAnchor.anchor))), ta, h("div.of-collab-actions", btn(t("Cancel"), () => ((pendingAnchor = null), renderComments())), btn(t("Comment"), save, { variant: "primary" })), h("p.of-collab-hint", t("Ctrl+Enter to post. Comments are saved in the document and shared with the room when you are in one.")));
  }

  function threadCard(doc, th) {
    const card = h("article.of-thread", { class: th.resolved ? "of-thread--resolved" : "", "data-thread": th.id, style: `--of-collab-color:${th.color || "#888888"}` });
    const jump = btn(anchorLabel(doc, th.anchor), () => jumpToAnchor(doc, th.anchor), { cls: "of-collab-link", ic: "crosshair", title: t("Show where this comment is") });
    const res = btn(th.resolved ? t("Reopen") : t("Resolve"), () => c.setResolved(doc, th.id, !th.resolved), { ic: th.resolved ? "arrow-counterclockwise" : "check2-circle" });
    const head = h("div.of-thread__head", jump, res);
    if (c.isMine(th.author) || c.session?.isHost) head.append(btn("", async () => (await confirmDialog({ title: "Delete comment thread", message: "Delete this whole thread with all replies?", ok: "Delete", danger: true })) && c.commentOp(doc, { op: "drop", threadId: th.id }), { ic: "trash3", title: t("Delete thread") }));
    card.append(head);
    if (th.anchor.quote && th.anchor.kind !== "node" && th.anchor.kind !== "page") card.append(h("blockquote.of-thread__quote", th.anchor.quote));
    for (const m of th.messages) {
      const msg = h("div.of-thread__msg", avatarEl({ nick: m.nick, color: m.color, initials: (m.nick || "?").slice(0, 2).toUpperCase() }, 22), h("div", h("div.of-msg__head", h("span.of-msg__who", m.nick || "?"), h("time.of-msg__time", fmtDate(m.ts)), m.edited && !m.deleted ? h("span.of-msg__edited", t("edited")) : null), m.deleted ? h("p.of-msg__text.of-msg__text--deleted", t("Comment deleted")) : h("p.of-msg__text", m.text)));
      if (c.isMine(m.author) && !m.deleted) {
        msg.append(h("div.of-msg__tools",
          btn("", () => {
            const ta = h("textarea.of-collab-input", { rows: 2, value: m.text, "aria-label": t("Edit comment") });
            const p = msg.querySelector(".of-msg__text");
            p.replaceWith(h("div", ta, h("div.of-collab-actions", btn(t("Cancel"), () => renderComments()), btn(t("Save"), () => c.commentOp(doc, { op: "edit", threadId: th.id, msgId: m.id, text: ta.value.trim() || m.text }) || renderComments(), { variant: "primary" }))));
            ta.focus();
          }, { ic: "pencil", title: t("Edit") }),
          btn("", () => c.commentOp(doc, { op: "delete", threadId: th.id, msgId: m.id }), { ic: "trash3", title: t("Delete") }),
        ));
      }
      card.append(msg);
    }
    if (th.resolved) card.append(h("p.of-collab-hint", t("Resolved by {name} · {date}", { name: th.resolvedBy || "?", date: th.resolvedAt ? fmtDate(th.resolvedAt) : "" })));
    const ta = h("textarea.of-collab-input", { rows: 1, maxLength: LIMITS.commentText, placeholder: t("Reply…"), "aria-label": t("Reply to this comment") });
    const send = () => {
      try {
        if (c.reply(doc, th.id, ta.value)) ta.value = "";
      } catch (e) {
        app.toast(e.message, "warning", 2500);
      }
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    card.append(h("div.of-thread__reply", ta, btn("", send, { ic: "send", title: t("Reply") })));
    return card;
  }

  function startComment(anchor, text) {
    if (!app.doc) return;
    pendingAnchor = { anchor, text };
    if (tab !== "comments") select("comments");
    else renderComments();
  }

  // ---------------------------------------------------------------- versions
  let savingForm = false;
  async function renderVersions() {
    const doc = app.doc;
    if (!doc) return body.replaceChildren(h("p.of-collab-empty", t("Open a document to see its versions.")));
    const name = h("input.of-collab-input", { maxLength: 80, placeholder: t("Version name, e.g. “Sent to client”"), "aria-label": t("Version name") });
    const note = h("textarea.of-collab-input", { rows: 2, maxLength: 500, placeholder: t("Note (optional)"), "aria-label": t("Note") });
    const save = btn(t("Save version"), async (e, b) => {
      b.disabled = true;
      try {
        await c.saveVersion(doc, { name: name.value.trim(), note: note.value.trim() });
        savingForm = false;
        app.toast("Version saved on this device.", "success", 1800);
      } catch (ex) {
        app.toast(ex.message, "danger", 4000);
      } finally {
        b.disabled = false;
      }
    }, { variant: "primary", ic: "bookmark-star" });
    const form = h("section.of-collab-card", { class: savingForm ? "of-collab-card--focus" : "" }, h("h3", t("Save a version of “{name}”", { name: doc.name })), name, note, h("div.of-collab-actions", save), h("p.of-collab-hint", t("Versions are complete copies of the document kept on this device (up to 30 per document). Restoring in place is one undoable step; a snapshot of the current state is saved first.")));
    const listBox = h("div.of-versions", h("p.of-collab-hint", t("Loading…")));
    body.replaceChildren(h("div.of-versions-tab", form, listBox));
    if (savingForm) name.focus();
    const list = await c.versions.list(doc.id);
    if (tab !== "versions" || app.doc !== doc) return;
    if (!list.length) return listBox.replaceChildren(h("p.of-collab-empty", t("No versions yet.")));
    const s = c.session;
    listBox.replaceChildren(...list.map((v) => {
      const img = h("img.of-version__thumb", { alt: "" });
      c.versions.thumb(v.id).then((b) => {
        if (b) {
          const url = URL.createObjectURL(new Blob([b], { type: "image/png" }));
          img.src = url;
          img.onload = () => URL.revokeObjectURL(url);
        }
      });
      const acts = h("div.of-version__acts",
        btn(t("Restore"), async () => (await confirmDialog({ title: "Restore version", message: t("Replace the current content with “{name}”? A snapshot of the current state is saved first, and Undo also brings it back.", { name: v.name }), ok: "Restore" })) && c.restoreVersion(v.id, { inPlace: true }).then(() => renderVersions()).catch((e) => app.toast(e.message, "danger", 4000)), { ic: "arrow-counterclockwise" }),
        btn(t("Open as copy"), () => c.restoreVersion(v.id).catch((e) => app.toast(e.message, "danger", 4000)), { ic: "files" }),
      );
      if (s?.state === "open" && canDo(s.myRole, "file-offer")) acts.append(btn(t("Send to room"), () => c.sendVersion(v.id).then(() => app.toast("Version sent.", "success", 1600)).catch((e) => app.toast(e.message, "danger", 4000)), { ic: "send" }));
      acts.append(
        btn("", async () => {
          const { promptDialog } = await import("../dialogs.js");
          const nn = await promptDialog({ title: "Rename version", label: "Name", value: v.name });
          if (nn != null) await c.versions.rename(v.id, nn.trim() || v.name);
          renderVersions();
        }, { ic: "pencil", title: t("Rename") }),
        btn("", async () => (await confirmDialog({ title: "Delete version", message: t("Delete the version “{name}” from this device?", { name: v.name }), ok: "Delete", danger: true })) && c.versions.remove(v.id).then(() => renderVersions()), { ic: "trash3", title: t("Delete") }),
      );
      return h("article.of-version", img, h("div.of-version__meta", h("strong", v.name), h("span", `${fmtDate(v.ts)}${v.author ? ` · ${v.author}` : ""} · ${formatBytes(v.bytes)}`), v.auto ? h("span.of-version__badge", t("automatic")) : null, v.note ? h("p", v.note) : null), acts);
    }));
  }

  return {
    el,
    show,
    hide,
    select,
    startComment,
    startSaveVersion() {
      savingForm = true;
      if (tab !== "versions") select("versions");
      else renderVersions();
    },
  };
}

export { openDialog, platform, colorFor };
