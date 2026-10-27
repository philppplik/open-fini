// Main-window side of the UI-only Collaboration pop-out (lazy). The main window stays the ONLY owner of the room
// connection, identity, keys, unread counters and notifications; the pop-out window (remote-view.js) gets bounded
// snapshots and may send a whitelist of actions. Protocol and limits: collab/remote-ui.js. Design: docs/adr/0010-collab-popout.md.
//
// Public API
//   popOut(app, c) → Promise<boolean>   opens the pop-out window (user gesture!) and docks the floating window away
//   dockBack(app, c)                    the pop-out went away (closed or asked to dock): shows the floating window again
//   isPoppedOut() → boolean
// Invariants: no key material, invite code or room secret is ever put into a snapshot; every action is validated by
// validateAction and re-checked against the member's role; the floating window is hidden only while a pop-out is attached.
import { t } from "../../i18n/index.js";
import { canDo } from "../../collab/protocol.js";
import { UI_CHANNEL, isUiMessage, makeSnapshot, validateAction } from "../../collab/remote-ui.js";
import { pinNumbers } from "../../collab/anchors.js";

let channel = null;
let attached = null; // { pid } while a pop-out is connected
let pending = null; // pid of a pop-out that was opened but has not said hello yet
let timer = 0;

export const isPoppedOut = () => !!attached || !!pending;

function post(msg) {
  try {
    channel?.postMessage(msg);
  } catch {
    /* closed */
  }
}

function snapshot(app, c) {
  const s = c.session;
  const d = app.doc;
  const prof = c.profile();
  const role = s?.myRole || "";
  const members = s ? [{ id: c.myId, nick: prof.nick, color: prof.color, role, online: true }, ...s.members.map((m) => ({ id: m.id, nick: m.profile?.nick, color: m.profile?.color, role: s.room.roleOf(m.id), online: true }))] : [];
  const chat = s
    ? s.chatStore.main().map((m) => ({ id: m.id, from: m.from, nick: m.nick, color: m.color, ts: m.ts, kind: m.kind, mine: c.isMine(m.from), deleted: !!m.deleted, text: m.kind === "activity" ? m.activity?.label || "" : m.file && !m.text ? `📎 ${m.file.name}` : m.text }))
    : [];
  const nums = d ? pinNumbers(c.threads(d)) : new Map();
  const where = (th) => (th.anchor.kind === "line" ? `${(th.anchor.path || "").split("/").pop()}:${th.anchor.line}` : th.anchor.quote || th.anchor.kind);
  return makeSnapshot({
    status: s ? { inRoom: true, state: s.state, host: s.relayHost, members: s.members.length + 1, role, canChat: canDo(role, "chat"), canComment: canDo(role, "comment") } : { inRoom: false, canComment: true },
    me: { id: c.myId, nick: prof.nick, color: prof.color },
    members,
    chat,
    unread: s?.chatStore.unread || 0,
    doc: d ? { id: d.id, name: d.name } : null,
    threads: d ? c.threads(d).map((th) => ({ id: th.id, nick: th.nick, color: th.color, resolved: !!th.resolved, n: nums.get(th.id), where: where(th), messages: th.messages })) : [],
  });
}

async function perform(app, c, { name, args }) {
  const s = c.session;
  const d = app.doc;
  switch (name) {
    case "chat.send":
      if (!s || s.state !== "open") throw new Error(t("You are not in a room."));
      if (!canDo(s.myRole, "chat")) throw new Error(t("Your role in this room does not allow this."));
      await s.chat(args.text);
      return;
    case "chat.read":
      return c.markRead();
    case "comment.add":
      if (!d) throw new Error(t("Open a document to comment."));
      if (s?.state === "open" && !canDo(s.myRole, "comment")) throw new Error(t("Your role in this room does not allow comments."));
      c.addThread(d, c.currentAnchor(), args.text);
      return;
    case "comment.reply":
      if (!d) return;
      if (s?.state === "open" && !canDo(s.myRole, "comment")) throw new Error(t("Your role in this room does not allow comments."));
      c.reply(d, args.thread, args.text);
      return;
    case "comment.resolve":
      if (d) c.setResolved(d, args.thread, args.on);
      return;
    case "comment.jump": {
      const th = d && c.threads(d).find((x) => x.id === args.thread);
      const a = th?.anchor;
      if (!a) return;
      if (a.kind === "node") c.jump({ kind: "node", doc: d.id, id: a.node, page: a.page });
      else if (a.kind === "page" || a.kind === "region") c.jump({ kind: "page", doc: d.id, id: a.page, page: a.page });
      else if (a.kind === "line") c.jump({ kind: "line", doc: d.id, id: a.path, line: a.line });
      return;
    }
    case "dock":
      return dockBack(app, c);
  }
}

function ensureChannel(app, c) {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(UI_CHANNEL);
  channel.onmessage = async (ev) => {
    const m = ev.data;
    if (!isUiMessage(m)) return;
    if (m.t === "hello") {
      attached = { pid: m.pid };
      pending = null;
      clearTimeout(timer);
      c.poppedOut = true;
      c.events.dispatchEvent(new CustomEvent("popout", { detail: true }));
      (await import("./window.js")).hideCollabWindow();
      post({ t: "snap", s: snapshot(app, c) });
    } else if (m.t === "bye" && attached && m.pid === attached.pid) {
      dockBack(app, c);
    } else if (m.t === "act" && attached && m.pid === attached.pid) {
      const v = validateAction(m.a);
      if (!v.ok) return post({ t: "res", rid: m.rid, ok: false, error: v.error });
      try {
        await perform(app, c, v.action);
        post({ t: "res", rid: m.rid, ok: true });
      } catch (err) {
        post({ t: "res", rid: m.rid, ok: false, error: String(err.message || err).slice(0, 200) });
      }
      if (attached) post({ t: "snap", s: snapshot(app, c) });
    }
  };
  // push a fresh snapshot after every change (coalesced)
  let queued = 0;
  c.events.addEventListener("change", () => {
    if (!attached || queued) return;
    queued = setTimeout(() => {
      queued = 0;
      if (attached) post({ t: "snap", s: snapshot(app, c) });
    }, 120);
  });
  for (const ev of ["doc", "docs"]) app.on(ev, () => attached && post({ t: "snap", s: snapshot(app, c) }));
  window.addEventListener("pagehide", () => attached && post({ t: "dock" }));
}

/** Opens the pop-out. Must run inside the click's user gesture (the web fallback uses window.open). */
export async function popOut(app, c) {
  if (typeof BroadcastChannel === "undefined") {
    app.toast(t("This browser cannot connect two windows (no BroadcastChannel)."), "warning", 5000);
    return false;
  }
  if (isPoppedOut()) {
    app.toast(t("The Collaboration window is already open in its own window."), "primary", 3500, { label: t("Dock back"), run: () => dockBack(app, c) });
    post({ t: "snap", s: snapshot(app, c) });
    return true;
  }
  ensureChannel(app, c);
  const pid = await (await import("../popout.js")).popoutCollab(app);
  if (!pid) {
    app.toast(t("Your browser blocked the new window. Allow pop-ups for this site and try again."), "warning", 6000);
    return false;
  }
  pending = pid;
  // if the new window never says hello (blocked after all, crashed), the floating window simply stays
  timer = setTimeout(() => {
    if (pending === pid) pending = null;
  }, 15000);
  return true;
}

/** The pop-out closed (or asked to dock): the floating window comes back, nothing else changes. */
export async function dockBack(app, c) {
  const wasAttached = !!attached;
  const pid = attached?.pid;
  attached = null;
  pending = null;
  clearTimeout(timer);
  c.poppedOut = false;
  c.events.dispatchEvent(new CustomEvent("popout", { detail: false }));
  if (pid) post({ t: "dock" });
  if (wasAttached) (await import("./window.js")).showCollabWindow(app, c);
}

/** `openCollab` while popped out: tell the user instead of opening a second UI. */
export function noteIfPoppedOut(app, c) {
  if (!attached) return false;
  app.toast(t("Collaboration is open in its own window."), "primary", 3500, { label: t("Dock back"), run: () => dockBack(app, c) });
  post({ t: "snap", s: snapshot(app, c) });
  return true;
}
