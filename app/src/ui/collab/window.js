// The Collaboration UI: the content of the Collaboration window, which is always its own OS window and never part of
// the app window (docs/adr/0030-collab-native-window.md). Tabs: Chat (room chat with replies, threads, reactions,
// mentions, files, links and the activity feed), People (start or join a room, status, verification words, invite
// code, members, roles, follow), Comments (threads of the main window's active document) and Versions (named
// snapshots of it). Comments and versions work without a room.
//
// It runs in the Collaboration window against the model of collab/remote-model.js: `c` and `app` have the shapes of
// the collaboration controller and the app, filled from the main window's snapshots; every change is an action the
// main window performs. Nothing here has a room connection, keys or documents.
//
// API: mountCollabPanel(app, c, { compact, onCompact, chrome }) → { el, select(tab), show({ tab, thread, invite, focus }) }
// Accessibility: role="main", tabs with role="tablist", new chat messages announced through an aria-live log, every
// action is a real button, Esc in a text field cancels the reply/edit, focus and drafts stay put on updates.
import { h, formatBytes } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { REACTIONS, LIMITS, canDo, ROLES } from "../../collab/protocol.js";
import { checkFile } from "../../collab/files.js";
import { filterThreads, threadTitle, threadCounts } from "../../collab/comments.js";
import { avatarEl } from "./avatar.js";
import { confirmDialog } from "../dialogs.js";
import { layoutMode } from "./layout-mode.js";

// items below the tabs in the side rail (hidden in the narrow layout): they open the share flow and the settings
const NAV_ACTIONS = [
  { id: "share", label: "Share", icon: "share", command: "collab.shareDocument" },
  { id: "settings", label: "Settings", icon: "gear", command: "collab.profile" },
];
const TABS = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "people", label: "People", icon: "people" },
  { id: "comments", label: "Comments", icon: "chat-quote" },
  { id: "versions", label: "Versions", icon: "clock-history" },
];

const fmtTime =(ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

export function mountCollabPanel(app, c, { compact: startCompact = false, onCompact = () => {}, chrome = [] } = {}) {
  let tab = "chat";
  let threadRoot = null; // chat thread being shown
  let replyTo = null;
  let editing = null; // chat message id being edited
  let commentFilter = { status: "open", mine: false };
  let focusThread = null;
  let pendingAnchor = null;
  let showQr = false; // People ▸ join link QR code shown

  let compact = !!startCompact;
  let mode = "narrow";
  const drafts = new Map(); // comment thread id → reply draft (kept across updates)
  const report = (e) => app.toast(e.message, "danger", 5000);

  const title = h("h1.of-collab-win__title", t("Collaboration"));
  const pill = h("span.of-collab-pill", { role: "status" });
  const compactBtn = btn("", () => setCompact(!compact), { ic: "layout-sidebar-inset", title: t("Compact density") });
  const mainBtn = btn("", () => c.focusMain(), { ic: "window", title: t("Show the main OpenFini window") });
  // `chrome`: window buttons of a frameless desktop window (minimize, close), added by remote-view.js
  const head = h("div.of-collab-win__head", icon("people"), title, pill, compactBtn, mainBtn, ...chrome);
  const tablist = h("div.of-collab-tabs", { role: "tablist", "aria-label": t("Collaboration sections"), "aria-orientation": "horizontal" });
  const actions = h("div.of-collab-nav__actions");
  const nav = h("nav.of-collab-nav", { "aria-label": t("Collaboration") }, tablist, actions);
  const aside = h("aside.of-collab-aside", { hidden: true, "aria-label": t("Conversations") });
  const body = h("div.of-collab-win__body");
  const main = h("div.of-collab-win__main", nav, aside, body);
  const live = h("div.of-sr-only", { "aria-live": "polite", role: "log" }); // announces new messages
  const el = h("section.of-collab-win.of-collab-win--native", { role: "main", "aria-labelledby": "of-collab-title", "data-mode": mode }, head, main, live);
  title.id = "of-collab-title";
  document.body.append(el);

  function setCompact(on) {
    compact = !!on;
    el.classList.toggle("is-compact", compact);
    compactBtn.setAttribute("aria-pressed", String(compact));
    onCompact(compact);
  }
  el.classList.toggle("is-compact", compact);
  compactBtn.setAttribute("aria-pressed", String(compact));
  new ResizeObserver(() => applyMode()).observe(el);
  el.addEventListener("keydown", (e) => e.stopPropagation()); // typing here must not trigger app shortcuts

  /** narrow: top tabs; rail: left side rail; wide: rail plus a conversation list column (decisions in layout-mode.js). */
  function applyMode() {
    const m = layoutMode(el.clientWidth);
    if (m === mode && el.dataset.mode === m) return;
    mode = m;
    el.dataset.mode = m;
    tablist.setAttribute("aria-orientation", m === "narrow" ? "horizontal" : "vertical");
    renderAside();
  }

  // ---- navigation: tabs plus action items, one roving tabindex (arrow keys, Home/End)
  const tabButtons = new Map();
  const navItems = [];
  let roving = "chat";
  const setRoving = (id) => {
    roving = id;
    for (const [k, b] of [...tabButtons, ...actionButtons]) b.tabIndex = k === id ? 0 : -1;
  };
  const actionButtons = new Map();
  for (const tb of TABS) {
    const b = h("button.of-collab-tab", { type: "button", role: "tab", id: `of-collab-tab-${tb.id}`, "aria-controls": "of-collab-panel" }, icon(tb.icon), h("span.of-collab-tab__label", t(tb.label)), h("span.of-collab-tab__badge"));
    b.title = t(tb.label);
    b.addEventListener("click", () => select(tb.id));
    tabButtons.set(tb.id, b);
    navItems.push(tb.id);
    tablist.append(b);
  }
  for (const a of NAV_ACTIONS) {
    const b = h("button.of-collab-tab.of-collab-tab--action", { type: "button" }, icon(a.icon), h("span.of-collab-tab__label", t(a.label)));
    b.title = t(a.label);
    b.addEventListener("click", () => app.run(a.command));
    actionButtons.set(a.id, b);
    navItems.push(a.id);
    actions.append(b);
  }
  nav.addEventListener("keydown", (e) => {
    const vertical = mode !== "narrow";
    const prev = vertical ? "ArrowUp" : "ArrowLeft";
    const next = vertical ? "ArrowDown" : "ArrowRight";
    if (![prev, next, "Home", "End"].includes(e.key)) return;
    const all = [...tabButtons, ...actionButtons].filter(([, b]) => b.offsetParent !== null);
    const i = Math.max(0, all.findIndex(([, b]) => b === document.activeElement));
    const j = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (i + (e.key === next ? 1 : all.length - 1)) % all.length;
    e.preventDefault();
    const [id, b] = all[j];
    setRoving(id);
    b.focus();
    if (tabButtons.has(id)) select(id);
  });
  body.id = "of-collab-panel";
  body.setAttribute("role", "tabpanel");

  function select(id) {
    tab = TABS.some((x) => x.id === id) ? id : tab;
    for (const [k, b] of tabButtons) b.setAttribute("aria-selected", String(k === tab));
    setRoving(tab);
    body.setAttribute("aria-labelledby", `of-collab-tab-${tab}`);
    render();
  }

  /** A request of the main window: show a tab, a comment thread, the join form with an invite code, or the Save version form. */
  function show({ tab: id, thread, invite, focus } = {}) {
    if (invite) {
      c.prefillInvite = invite;
      body.replaceChildren(); // the join form is built again with the code
      return select("people");
    }
    if (thread) {
      focusThread = thread;
      commentFilter.status = "all";
      return select("comments");
    }
    if (focus === "version") {
      savingForm = true;
      return select("versions");
    }
    select(id || tab);
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
    badge.textContent = unread && tab !== "chat" ? String(Math.min(99, unread)) : "";
    const cb = tabButtons.get("comments").querySelector(".of-collab-tab__badge");
    cb.textContent = app.doc ? String(threadCounts(c.threads(app.doc)).open || "") : "";
  }

  // ---- re-render on snapshots (coalesced per frame). "chat": only the message stream changed; "all": anything else
  let queued = false;
  let pendingKind = null;
  c.events.addEventListener("change", (e) => {
    pendingKind = pendingKind === "all" || e.detail !== "chat" ? "all" : "chat";
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const kind = pendingKind;
      pendingKind = null;
      if (kind === "all") return render();
      if (tab === "chat" && c.session && chatParts) return renderChatList(true);
      renderHead();
    });
  });
  document.addEventListener("visibilitychange", () => !document.hidden && tab === "chat" && c.session && (c.markRead(), renderHead()));

  // ================================================================ render
  let chatParts = null;

  /** Wide layout only: the list column next to the content (members next to Chat, threads next to Comments). */
  function renderAside() {
    const wanted = mode === "wide" && (tab === "chat" || tab === "comments");
    aside.hidden = !wanted;
    if (!wanted) return aside.replaceChildren();
    if (tab === "chat") {
      const s = c.session;
      const people = s ? [{ id: c.myId, profile: c.profile(), online: true, me: true }, ...s.members] : [];
      aside.replaceChildren(h("h3.of-collab-aside__title", t("Members")), ...(people.length ? people.map((m) => h("div.of-collab-aside__row", avatarEl(m.profile || { nick: "?", color: "#888888" }, 22), h("span", `${m.profile?.nick || "?"}${m.me ? ` ${t("(you)")}` : ""}`))) : [h("p.of-collab-hint", t("Not in a room"))]));
      return;
    }
    const d = app.doc;
    const list = d ? filterThreads(c.threads(d), { status: commentFilter.status, mine: commentFilter.mine ? c.myId : null }) : [];
    aside.replaceChildren(h("h3.of-collab-aside__title", t("Threads")), ...(list.length ? list.map((th) => {
      const b = h("button.of-collab-aside__row", { type: "button", "data-aside-thread": th.id }, h("span.of-collab-aside__dot", { style: `background:${th.color || "#888888"}` }), h("span", threadTitle(th) || "…"), th.ai ? h("span.of-ai-badge", { title: t("Written by the AI assistant") }, "AI") : null);
      b.addEventListener("click", () => ((focusThread = th.id), renderComments()));
      return b;
    }) : [h("p.of-collab-hint", t("Nothing here."))]));
  }

  function render() {
    renderAside();
    renderHead();
    if (!c.session && (tab === "chat" || tab === "people")) {
      chatParts = null;
      // an update must not wipe what is being typed into the start and join forms
      if (body.querySelector(".of-collab-start") && !c.prefillInvite) return;
      return renderStart();
    }
    // the chat composer survives updates: only the message list is rendered again
    if (tab === "chat") return chatParts?.root.isConnected ? renderChatList(true) : renderChat();
    chatParts = null;
    if (tab === "people") return renderPeople();
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

    // the desktop app runs a relay itself (src-tauri/src/relay.rs): one click, no Node.js, no terminal
    const desktop = !!window.__TAURI__?.core;
    const where = h(
      "select.of-collab-input",
      { "aria-label": t("Where") },
      desktop ? h("option", { value: "builtin" }, t("Your network: start a relay on this computer")) : null,
      h("option", { value: "local" }, t("This device: other windows and tabs")),
      h("option", { value: "relay" }, t("Relay server (local network or internet)")),
    );
    const tunnelBox = h("input", { type: "checkbox" });
    const builtinNote = h("p.of-collab-hint", { hidden: true }, h("label", tunnelBox, " ", t("Also reach it from other networks through a tunnel (cloudflared, ngrok or tailscale, if installed; asks first)")), h("br"), t("OpenFini starts a small relay inside this app and creates the room on it. Others in your network join with the invite code in the OpenFini desktop app. Your firewall may ask once whether OpenFini may accept connections: allow it for private networks. The relay stops when you stop it or close OpenFini."));
    const webNote = desktop ? null : h("p.of-collab-note", { hidden: true }, icon("info-circle"), t("A browser cannot start a relay. Enter the address of a hosted relay (wss://…), or of one started on a computer in your network with the desktop app or the one-file relay (How to start a relay)."));
    const relay = h("input.of-collab-input", { value: app.prefs.collabRelay || "ws://127.0.0.1:8787/", spellcheck: false, "aria-label": t("Relay address"), placeholder: "wss://relay.example.org/" });
    // relay: loopback warning, "Test connection" with a diagnosis, and how to start one
    const loopNote = h("p.of-collab-note", { hidden: true }, icon("info-circle"), t("localhost is this computer only. Other devices join through this computer's network address: after creating the room, pick it under People ▸ Invite."));
    const diag = h("ul.of-relay-diag", { "aria-live": "polite" });
    const testBtn = btn(t("Test connection"), async (e, b) => {
      b.disabled = true;
      diag.replaceChildren(h("li", t("Checking…")));
      try {
        const r = await c.testRelay(relay.value.trim());
        diag.replaceChildren(...r.steps.map((s) => h("li", { class: s.ok ? "is-ok" : "is-bad" }, icon(s.ok ? "check-circle" : "exclamation-triangle"), h("span", s.text, s.fix ? h("span.of-relay-diag__fix", ` ${s.fix}`) : null))));
      } catch (ex) {
        diag.replaceChildren(h("li.is-bad", icon("exclamation-triangle"), h("span", ex.message)));
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
    const sync = () => {
      relayRow.hidden = where.value !== "relay";
      builtinNote.hidden = where.value !== "builtin";
      if (webNote) webNote.hidden = where.value !== "relay";
    };
    where.addEventListener("change", sync);
    sync();
    const err = h("p.of-collab-error", { role: "alert" });
    const create = btn(t("Create room"), async (e, b) => {
      err.textContent = "";
      if (!app.prefs.collabNick && nick.value.trim()) app.setPref("collabNick", nick.value.trim());
      b.disabled = true;
      try {
        // the main window creates the room (desktop: it also starts the relay inside the app)
        await c.createRoom({ where: where.value, relay: relay.value.trim(), role: role.value, tunnel: tunnelBox.checked });
        select("people");
      } catch (ex) {
        err.textContent = t("The room could not be created: {message}", { message: ex.message });
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
        const { parseInvite, relayHost } = await import("../../collab/crypto.js");
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
        h("section.of-collab-card", h("h3", t("Start a room")), h("label.of-collab-field", h("span", t("Where")), where), builtinNote, webNote, relayRow, h("label.of-collab-field", h("span", t("New members join as")), role), h("div.of-collab-actions", create)),
        h("section.of-collab-card", h("h3", t("Join with an invite code")), fromLink, code, h("div.of-collab-actions", join)),
        err,
        h("p.of-collab-hint", desktop ? t("Everything in a room is end-to-end encrypted with a key that only travels inside the invite code. The relay only forwards encrypted messages. Comments and versions also work without a room.") : t("Everything in a room is end-to-end encrypted with a key that only travels inside the invite code. A relay is a tiny server: the desktop app starts one with a click, or see How to start a relay. Comments and versions also work without a room.")),
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
    const linkBtn = btn("", async () => {
      try {
        pendingLinks.push(await c.selectionLink());
        renderReplyBar();
      } catch (e) {
        app.toast(e.message, "neutral", 3000);
      }
    }, { ic: "link-45deg", title: t("Link the current selection of the main window") });
    const send = btn("", () => submit(), { ic: "send", title: t("Send (Enter)"), variant: "primary" });
    const composer = h("div.of-chat__composer", replyBar, h("div.of-chat__row", input, h("div.of-chat__tools", attach, linkBtn, send)), suggest, fileInput);
    const root = h("div.of-chat", threadHead, list, files, typing, composer);
    body.replaceChildren(root);
    chatParts = { root, list, threadHead, typing, files, replyBar, input, composer };
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

  let announced = Date.now(); // messages after this time are announced to screen readers
  function renderChatList(incremental) {
    const s = c.session;
    if (!chatParts || !s) return render();
    const { list, threadHead, typing, files } = chatParts;
    chatParts.composer.hidden = !canDo(s.myRole, "chat");
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
    const fresh = store.list.filter((m) => m.ts > announced && m.kind === "chat" && m.from !== s.id);
    announced = store.list.reduce((a, m) => Math.max(a, m.ts), announced);
    if (fresh.length && incremental) live.textContent = fresh.map((m) => `${m.nick}: ${m.text}`).join(". ").slice(0, 300);
    if (!document.hidden) c.markRead();
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
        if (ok) c.openReceived(f.fid, mode).catch(report);
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
  /** People ▸ the relay running in this app: its address, the invite as a QR code, and Stop. */
  function builtinRelayCard(s) {
    const r = s.builtin;
    const box = h("div.of-collab-lan");
    const addr = r.addr;
    const parts = [
      h("p.of-collab-status", icon("share"), h("span", addr ? t("Relay running on this computer: {url}", { url: addr }) : t("Relay running on this computer (port {port}), but no network address was found. Is this computer connected to a network?", { port: r.port }))),
      h("p.of-collab-hint", t("Others join with the invite code in the OpenFini desktop app on the same network. Browsers on other devices need a relay with https: the one-file relay (node openfini-relay.mjs --lan, see How to start a relay).")),
    ];
    const qrBox = h("div.of-collab-qr");
    const qrBtn = btn(showQr ? t("Hide QR code") : t("Show QR code"), () => ((showQr = !showQr), renderPeople()), { ic: "phone" });
    qrBtn.setAttribute("aria-pressed", String(showQr));
    if (showQr) {
      Promise.all([import("./network.js"), c.inviteCode()]).then(([net, code]) => {
        try {
          qrBox.replaceChildren(net.qrSvg(code, t("QR code of the invite code")), h("p.of-collab-hint", t("Scan it with another device to copy the invite code. Anyone who can see this code can join the room.")));
        } catch {
          qrBox.replaceChildren(h("p.of-collab-hint", t("The invite code is too long for a QR code. Copy it instead.")));
        }
      }).catch(report);
    }
    const stop = btn(t("Stop relay"), async (e, b) => {
      const ok = await confirmDialog({ title: N_("Stop relay"), message: t("Stop the relay on this computer? Everyone in the room, including you, is disconnected."), ok: N_("Stop relay"), danger: true });
      if (!ok) return;
      b.disabled = true;
      await c.stopRelay().catch(report);
      b.disabled = false;
    }, { ic: "stop", variant: "danger" });
    parts.push(h("div.of-collab-actions", qrBtn, stop), qrBox);
    box.replaceChildren(...parts);
    return box;
  }

  function renderPeople() {
    const s = c.session;
    const st = c.status();
    const words = h("p.of-collab-words", { "aria-label": t("Verification words") }, ...s.fingerprint.map((w) => h("span", w)));
    const inviteBox = h("div.of-collab-invite");
    // the invite code is fetched from the main window only on these clicks (it is not part of the snapshots)
    const showInvite = btn(t("Show invite code"), async () => {
      const code = await c.inviteCode().catch(report);
      if (!code) return;
      inviteBox.replaceChildren(h("textarea.of-collab-input", { readOnly: true, rows: 3, value: code, "aria-label": t("Invite code") }), h("p.of-collab-hint", t("Anyone with this code can join until the host changes the key. Share it privately (not in public channels). It is never saved by OpenFini.")));
    }, { ic: "eye" });
    const copyText = async (get, done) => {
      try {
        await navigator.clipboard.writeText(await get());
        app.toast(done, "success", 2200);
      } catch {
        app.toast("Copying failed. Use “Show invite code” and copy it by hand.", "warning", 3000);
      }
    };
    const copy = btn(t("Copy invite code"), () => copyText(c.inviteCode, t("Invite code copied. Share it privately.")), { ic: "copy" });
    const leave = btn(t("Leave"), async () => (await confirmDialog({ title: "Leave room", message: "Leave this collaboration room? Your documents stay open on this device.", ok: "Leave" })) && c.leave().catch(report), { ic: "box-arrow-up-right", variant: "danger" });
    const share = app.doc && canDo(s.myRole, "file-offer") ? btn(t("Share this document…"), () => c.shareFlow().catch(report), { ic: "share" }) : null;
    // rooms across the network: the address other devices use, join link and QR code (the main window asks the relay's /info)
    const lanBox = h("div.of-collab-lan");
    const builtinBox = s.builtin ? builtinRelayCard(s) : null;
    if (!s.local && !builtinBox) {
      Promise.all([import("./network.js"), c.inviteNet()]).then(([net, n]) => {
        const parts = [];
        if (n.loopback) parts.push(h("p.of-collab-note", icon("exclamation-triangle"), t("This invite points to localhost, which other devices cannot reach. Choose this computer's network address below.")));
        if (n.addrs.length) {
          const sel = h("select.of-collab-input", { "aria-label": t("Address for other devices") }, h("option", { value: n.entered }, t("{url} (as entered)", { url: n.entered })), ...n.addrs.map((a) => h("option", { value: a.url, selected: a.url === n.current }, a.label)));
          sel.addEventListener("change", () => c.setInviteRelay(sel.value === n.entered ? "" : sel.value).then(() => renderPeople()).catch(report));
          parts.push(h("label.of-collab-field", h("span", t("Address for other devices")), sel));
        } else if (n.infoMissing) parts.push(h("p.of-collab-hint", t("The relay's network addresses could not be read. Start it with node openfini-relay.mjs --lan (How to start a relay), or type this computer's IP address into the relay address.")));
        if (n.canLink) {
          const qrBox = h("div.of-collab-qr");
          const qrBtn = btn(showQr ? t("Hide QR code") : t("Show QR code"), () => ((showQr = !showQr), renderPeople()), { ic: "phone" });
          qrBtn.setAttribute("aria-pressed", String(showQr));
          if (showQr) c.inviteLink().then((link) => qrBox.replaceChildren(net.qrSvg(link, t("QR code of the join link")), h("p.of-collab-hint", t("Scan with a phone or tablet on the same network. Anyone who can see this code can join the room.")))).catch(report);
          parts.push(h("div.of-collab-actions", btn(t("Copy join link"), () => copyText(c.inviteLink, t("Join link copied. It contains the room key: share it privately.")), { ic: "link-45deg" }), qrBtn), qrBox);
        }
        lanBox.replaceChildren(...parts);
      }).catch(() => {});
    }
    const status = h("section.of-collab-card",
      h("div.of-collab-status", icon(st.connected ? "shield-check" : "exclamation-triangle"), h("span", st.connected ? t("Connected to {host}, end-to-end encrypted, {n, plural, one {# member} other {# members}}.", { host: s.relayHost, n: st.members }) : t("Not connected ({state}).", { state: s.state }))),
      h("h3", t("Verification words")),
      words,
      h("p.of-collab-hint", t("Everyone in the room sees the same six words. Compare them by phone or in person: if they differ, someone is not in the room you think, so leave.")),
      h("div.of-collab-actions", showInvite, copy, share, leave),
      lanBox,
      builtinBox,
      inviteBox,
    );
    // documents shared in this room ("Edit together", beta)
    const sharedBox = h("div");
    c.live().then((live) => {
      const list = live.list();
      if (!list.length) return;
      const row = (d) => {
        const acts = d.open
          ? [btn(d.ownedByMe ? t("Stop sharing") : t("Leave"), () => live.stop(d.doc).catch(report), { ic: "x-circle" })]
          : [btn(t("Open live"), () => live.openLive(d.doc).catch((e) => app.toast(e.message, "danger", 5000)), { variant: "primary" }), btn(t("Open copy"), () => live.openCopy(d.doc).catch((e) => app.toast(e.message, "danger", 5000)))];
        const meta = d.open ? (d.paused ? t("Live · paused · {n, plural, one {# person} other {# people}}", { n: d.people }) : t("Live · {n, plural, one {# person} other {# people}}", { n: d.people })) : t("Shared by {name}", { name: d.from });
        return h("li.of-collab-member", icon(d.kind === "text" ? "code-slash" : "file-earmark"), h("div.of-collab-member__meta", h("strong", d.name), h("span", meta)), h("div.of-collab-member__acts", ...acts));
      };
      sharedBox.replaceChildren(h("section.of-collab-card", h("h3", t("Shared documents (Edit together, beta)")), h("ul.of-collab-members", ...list.map(row))));
    });
    const rows = [];
    rows.push(memberRow({ id: s.id, profile: s.profile, presence: c.presencePayload(), online: true }, true));
    for (const m of s.members) rows.push(memberRow(m, false));
    const filesBox = c.received.size ? h("section.of-collab-card", h("h3", t("Received files")), ...[...c.received.values()].map(({ transfer }) => h("div.of-filecard", icon("file-earmark"), h("div.of-filecard__meta", h("strong", transfer.name), h("span", formatBytes(transfer.size))), h("div.of-filecard__acts", btn(t("Open"), async () => (await confirmDialog({ title: "Open received file", message: t("Open “{name}”? Only open files from people you trust.", { name: transfer.name }), ok: "Open" })) && c.openReceived(transfer.fid, "copy").catch((e) => app.toast(e.message, "danger"))), btn(t("Save…"), () => c.saveReceived(transfer.fid).catch(report)), btn("", () => c.dismissReceived(transfer.fid), { ic: "x", title: t("Dismiss") }))))) : null;
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
    if (!doc) return body.replaceChildren(h("p.of-collab-empty", t("Open a document in the main window to see and add comments.")));
    for (const ta of body.querySelectorAll("textarea[data-thread]")) drafts.set(ta.dataset.thread, ta.value);
    const hadFocus = document.activeElement?.dataset?.thread || null;
    const newDraft = body.querySelector(".of-comments__new textarea")?.value;
    const threads = c.threads(doc);
    const counts = threadCounts(threads);
    const seg = h("div.of-collab-seg", { role: "group", "aria-label": t("Show") }, ...[["open", t("Open ({n})", { n: counts.open })], ["resolved", t("Resolved ({n})", { n: counts.resolved })], ["all", t("All")]].map(([v, label]) => {
      const b = btn(label, () => ((commentFilter.status = v), renderComments()));
      b.setAttribute("aria-pressed", String(commentFilter.status === v));
      return b;
    }));
    const mine = h("label.of-collab-check", h("input", { type: "checkbox", checked: commentFilter.mine }), h("span", t("Mine and mentions")));
    mine.firstChild.addEventListener("change", (e) => ((commentFilter.mine = e.target.checked), renderComments()));
    const add = btn(t("New comment"), () => startComment(), { ic: "plus-lg", variant: "primary" });
    const composer = pendingAnchor ? newCommentForm(doc, newDraft) : null;
    const listed = filterThreads(threads, { status: commentFilter.status, mine: commentFilter.mine ? c.myId : null });
    const items = listed.map((th) => threadCard(doc, th));
    body.replaceChildren(h("div.of-comments", h("div.of-comments__bar", seg, mine, add), composer, items.length ? h("div.of-comments__list", ...items) : h("p.of-collab-empty", commentFilter.status === "open" ? t("No open comments. Select a layer, text or code line in the main window and choose New comment, or press Ctrl+Alt+M there.") : t("Nothing here."))));
    if (focusThread) {
      const card = body.querySelector(`[data-thread="${CSS.escape(focusThread)}"]`);
      card?.scrollIntoView({ block: "nearest" });
      card?.querySelector("textarea")?.focus();
      focusThread = null;
    } else if (hadFocus) body.querySelector(`textarea[data-thread="${CSS.escape(hadFocus)}"]`)?.focus();
    else if (composer) composer.querySelector("textarea").focus();
  }

  function newCommentForm(doc, draft) {
    const ta = h("textarea.of-collab-input", { rows: 3, maxLength: LIMITS.commentText, placeholder: t("Add a comment… (@ to mention)"), "aria-label": t("Comment") });
    ta.value = draft ?? pendingAnchor.text ?? "";
    const save = async () => {
      if (!ta.value.trim()) return;
      try {
        await c.addThread(ta.value);
        pendingAnchor = null;
        commentFilter.status = "open";
        renderComments();
      } catch (e) {
        app.toast(e.message, "warning", 4000);
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
    return h("section.of-collab-card.of-comments__new", h("div.of-comments__anchor", icon("chat-quote"), h("span", t("On the current selection in the main window ({name})", { name: doc.name }))), ta, h("div.of-collab-actions", btn(t("Cancel"), () => ((pendingAnchor = null), renderComments())), btn(t("Comment"), save, { variant: "primary" })), h("p.of-collab-hint", t("Ctrl+Enter to post. Comments are saved in the document and shared with the room when you are in one.")));
  }

  function threadCard(doc, th) {
    const card = h("article.of-thread", { class: th.resolved ? "of-thread--resolved" : "", "data-thread": th.id, style: `--of-collab-color:${th.color || "#888888"}` });
    const jump = btn(th.where, () => c.jumpToThread(th.id), { cls: "of-collab-link", ic: "crosshair", title: t("Show where this comment is in the main window") });
    const res = btn(th.resolved ? t("Reopen") : t("Resolve"), () => c.setResolved(th.id, !th.resolved), { ic: th.resolved ? "arrow-counterclockwise" : "check2-circle" });
    const head = h("div.of-thread__head", jump, res);
    if (c.isMine(th.author) || c.session?.isHost) head.append(btn("", async () => (await confirmDialog({ title: "Delete comment thread", message: "Delete this whole thread with all replies?", ok: "Delete", danger: true })) && c.dropThread(th.id), { ic: "trash3", title: t("Delete thread") }));
    card.append(head);
    if (th.anchor.quote && th.anchor.kind !== "node" && th.anchor.kind !== "page") card.append(h("blockquote.of-thread__quote", th.anchor.quote));
    for (const m of th.messages) {
      const msg = h("div.of-thread__msg", avatarEl({ nick: m.nick, color: m.color, initials: (m.nick || "?").slice(0, 2).toUpperCase() }, 22), h("div", h("div.of-msg__head", h("span.of-msg__who", m.nick || "?"), m.ai ? h("span.of-ai-badge", { title: t("Written by the AI assistant") }, "AI") : null, h("time.of-msg__time", fmtDate(m.ts)), m.edited && !m.deleted ? h("span.of-msg__edited", t("edited")) : null), m.deleted ? h("p.of-msg__text.of-msg__text--deleted", t("Comment deleted")) : h("p.of-msg__text", m.text)));
      if (c.isMine(m.author) && !m.deleted) {
        msg.append(h("div.of-msg__tools",
          btn("", () => {
            const ta = h("textarea.of-collab-input", { rows: 2, value: m.text, "aria-label": t("Edit comment") });
            const p = msg.querySelector(".of-msg__text");
            p.replaceWith(h("div", ta, h("div.of-collab-actions", btn(t("Cancel"), () => renderComments()), btn(t("Save"), () => (c.editComment(th.id, m.id, ta.value.trim() || m.text), renderComments()), { variant: "primary" }))));
            ta.focus();
          }, { ic: "pencil", title: t("Edit") }),
          btn("", () => c.deleteComment(th.id, m.id), { ic: "trash3", title: t("Delete") }),
        ));
      }
      card.append(msg);
    }
    if (th.resolved) card.append(h("p.of-collab-hint", t("Resolved by {name} · {date}", { name: th.resolvedBy || "?", date: th.resolvedAt ? fmtDate(th.resolvedAt) : "" })));
    const ta = h("textarea.of-collab-input", { rows: 1, maxLength: LIMITS.commentText, placeholder: t("Reply…"), "aria-label": t("Reply to this comment") });
    ta.dataset.thread = th.id;
    ta.value = drafts.get(th.id) || "";
    const send = () => {
      if (!c.reply(th.id, ta.value)) return;
      ta.value = "";
      drafts.delete(th.id);
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

  function startComment(text) {
    if (!app.doc) return;
    pendingAnchor = { text };
    if (tab !== "comments") select("comments");
    else renderComments();
  }

  // ---------------------------------------------------------------- versions
  let savingForm = false;
  async function renderVersions() {
    const doc = app.doc;
    if (!doc) return body.replaceChildren(h("p.of-collab-empty", t("Open a document in the main window to see its versions.")));
    const name = h("input.of-collab-input", { maxLength: 80, placeholder: t("Version name, e.g. “Sent to client”"), "aria-label": t("Version name") });
    const note = h("textarea.of-collab-input", { rows: 2, maxLength: 500, placeholder: t("Note (optional)"), "aria-label": t("Note") });
    const save = btn(t("Save version"), async (e, b) => {
      b.disabled = true;
      try {
        await c.saveVersion({ name: name.value.trim(), note: note.value.trim() });
        savingForm = false;
        app.toast("Version saved on this device.", "success", 1800);
        renderVersions();
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
    const list = await c.versions.list().catch(() => []);
    if (tab !== "versions" || app.doc?.id !== doc.id || !listBox.isConnected) return;
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
        btn(t("Restore"), async () => (await confirmDialog({ title: "Restore version", message: t("Replace the current content with “{name}”? A snapshot of the current state is saved first, and Undo also brings it back.", { name: v.name }), ok: "Restore" })) && c.restoreVersion(v.id, { inPlace: true }).then(() => renderVersions()).catch(report), { ic: "arrow-counterclockwise" }),
        btn(t("Open as copy"), () => c.restoreVersion(v.id).catch((e) => app.toast(e.message, "danger", 4000)), { ic: "files" }),
      );
      if (s?.state === "open" && canDo(s.myRole, "file-offer")) acts.append(btn(t("Send to room"), () => c.sendVersion(v.id).then(() => app.toast("Version sent.", "success", 1600)).catch((e) => app.toast(e.message, "danger", 4000)), { ic: "send" }));
      acts.append(
        btn("", async () => {
          const { promptDialog } = await import("../dialogs.js");
          const nn = await promptDialog({ title: "Rename version", label: "Name", value: v.name });
          if (nn != null) await c.versions.rename(v.id, nn.trim() || v.name).catch(report);
          renderVersions();
        }, { ic: "pencil", title: t("Rename") }),
        btn("", async () => (await confirmDialog({ title: "Delete version", message: t("Delete the version “{name}” from this device?", { name: v.name }), ok: "Delete", danger: true })) && c.versions.remove(v.id).then(() => renderVersions()).catch(report), { ic: "trash3", title: t("Delete") }),
      );
      return h("article.of-version", img, h("div.of-version__meta", h("strong", v.name), h("span", `${fmtDate(v.ts)}${v.author ? ` · ${v.author}` : ""} · ${formatBytes(v.bytes)}`), v.auto ? h("span.of-version__badge", t("automatic")) : null, v.note ? h("p", v.note) : null), acts);
    }));
  }

  select("chat");
  return { el, select, show };
}
