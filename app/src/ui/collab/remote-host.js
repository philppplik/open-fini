// Main-window side of the Collaboration window (lazy). The Collaboration UI never renders inside the app window: it
// lives in its own OS window (ui/collab/remote-view.js + window.js). This window stays the ONLY owner of the room
// connection, identity, keys, documents, unread counters and notifications; the Collaboration window gets bounded
// snapshots and sends a whitelist of actions. Protocol and limits: collab/remote-ui.js.
// Design: docs/adr/0030-collab-native-window.md.
//
// Public API
//   openWindow(app, c, { tab, thread, invite, focus }) → Promise<boolean>   opens the window, or focuses the open one
//   isWindowOpen() → boolean
// Invariants: room keys and the room secret never enter a snapshot; the invite code only leaves this window as the
// answer to invite.code / invite.link; every action is validated by validateAction and re-checked against the member's
// role; closing the Collaboration window never leaves the room; when this window goes away it closes the other one.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { platform } from "../../platform/index.js";
import { canDo } from "../../collab/protocol.js";
import { UI_CHANNEL, isUiMessage, makeSnapshot, snapshotKey, validateAction } from "../../collab/remote-ui.js";
import { openDialog } from "../dialogs.js";

let channel = null;
let attached = null; // { pid } while the Collaboration window is connected
let pendingShow = null; // what the window should show once it says hello
let lastKey = "";
let byeTimer = 0;
let builtinRelay = null; // status of the relay this desktop app started (platform/native-net.js), or null

export const isWindowOpen = () => !!attached;

function post(msg) {
  try {
    channel?.postMessage(msg);
  } catch {
    /* closed */
  }
}

/** Brings this (main) window to the front: an action opened a dialog or moved the canvas here. */
function focusMain() {
  try {
    if (platform.isDesktop) window.__TAURI__?.window?.getCurrentWindow?.().setFocus?.();
    else window.focus();
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------------------------- snapshots

function anchorLabel(doc, a) {
  switch (a?.kind) {
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
      return a.endLine ? t("{file}, lines {from}–{to}", { file: (a.path || "").split("/").pop(), from: a.line, to: a.endLine }) : t("{file}, line {line}", { file: (a.path || "").split("/").pop(), line: a.line });
    case "element":
      return t("Website element {name}", { name: a.quote || a.elem });
    case "text":
      return a.quote ? t("Text “{quote}”", { quote: a.quote.slice(0, 40) }) : t("Text");
    default:
      return t("Document");
  }
}

function snapshot(app, c) {
  const s = c.session;
  const d = app.doc;
  const pres = c.presencePayload();
  let threads = [];
  if (d) {
    try {
      threads = c.threads(d).map((th) => ({ ...th, where: anchorLabel(d, th.anchor) }));
    } catch {
      /* a document without comment support */
    }
  }
  return makeSnapshot({
    prefs: { nick: app.prefs.collabNick || "", relay: app.prefs.collabRelay || "", offline: !!app.prefs.offlineMode },
    me: { id: c.myId, ids: [c.authorId, s?.id].filter(Boolean), profile: c.profile(), studio: pres.studio, docName: pres.docName },
    session: s
      ? {
          state: s.state,
          host: s.relayHost,
          id: s.id,
          role: s.myRole,
          isHost: s.isHost,
          fingerprint: s.fingerprint,
          local: s.invite.relay === "local",
          builtin: builtinRelay && s.invite.relay === builtinRelay.local ? { addr: builtinRelay.addresses[0] || "", port: builtinRelay.port } : null,
          members: s.members.map((m) => ({ id: m.id, profile: m.profile, role: s.room.roleOf(m.id), studio: m.presence?.studio, docName: m.presence?.docName, typing: !!m.typing })),
          chat: s.chatStore.list.map((m) => ({ ...m, mention: s.chatStore.mentionsMe(m) })),
          unread: s.chatStore.unread,
          followId: c.followId,
          transfers: [...c.transfers.values()],
          received: [...c.received.values()].map(({ transfer: x }) => ({ fid: x.fid, name: x.name, size: x.size, ext: x.ext, doc: x.doc })),
          live: c.liveMgr ? c.liveMgr.list() : [],
        }
      : null,
    doc: d ? { id: d.id, name: d.name } : null,
    docIds: app.docs.map((x) => x.id),
    threads,
  });
}

/** Sends the current state when it differs from the last one sent (`force` after a hello). */
function push(app, c, force = false) {
  if (!attached) return;
  const s = snapshot(app, c);
  const key = snapshotKey(s);
  if (!force && key === lastKey) return;
  lastKey = key;
  post({ t: "snap", s });
}

// ---------------------------------------------------------------------------------------------- actions

function jumpToAnchor(app, c, doc, a) {
  if (a.kind === "node") return c.jump({ kind: "node", doc: doc.id, id: a.node, page: a.page });
  if (a.kind === "page" || a.kind === "region") return c.jump({ kind: "page", doc: doc.id, id: a.page, page: a.page });
  if (a.kind === "line") return c.jump({ kind: "line", doc: doc.id, id: a.path, line: a.line });
  if (a.kind === "element") {
    app.setStudio("code");
    return void setTimeout(() => app.codeUI?.selectElement?.(a.elem, { reveal: true }), 150);
  }
  if (a.kind === "item" && app.officeUI?.doc === doc) {
    app.setStudio("office");
    return void app.officeUI.revealAnchor?.(a);
  }
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

async function createRoom(app, c, { where, relay, role, tunnel }) {
  if (where === "builtin") {
    // the desktop app runs a relay itself (src-tauri/src/relay.rs): one click, no Node.js, no terminal
    const net = await import("../../platform/native-net.js");
    // reachable from the internet through a tunnel: require a relay key, so it is not an open forwarder
    const running = await net.relay.status().catch(() => null);
    if (running && running.keyed !== tunnel) await net.relay.stop();
    builtinRelay = await net.relay.start({ lan: true, key: tunnel ? net.newRelayKey() : null });
    await c.createRoom({ relay: builtinRelay.local, defaultRole: role });
    // the invite carries this computer's network address, not localhost
    if (builtinRelay.addresses[0]) c.session.setInviteRelay(builtinRelay.addresses[0]);
    if (tunnel) {
      focusMain();
      const tun = await (await import("./network.js")).startTunnel(app, builtinRelay.port);
      if (tun) {
        c.session.setInviteRelay(net.withRelayKey(tun.url, builtinRelay.local));
        app.toast(t("Public relay address: {url}. Anyone with the invite code can join from the internet. Stop the room to close the tunnel.", { url: tun.url }), "warning", 15000);
      }
    }
  } else await c.createRoom({ relay: where === "local" ? "local" : relay, defaultRole: role });
  if (!app.doc) (await import("./entry.js")).offerNoDocument(app);
}

const inRoom = (c, type) => {
  const s = c.session;
  if (!s || s.state !== "open") throw new Error(t("You are not in a room."));
  if (type && !canDo(s.myRole, type)) throw new Error(t("Your role in this room does not allow this."));
  return s;
};
const needDoc = (app) => {
  if (!app.doc) throw new Error(t("Open a document in the main window first."));
  return app.doc;
};
const mayComment = (c) => {
  if (c.session?.state === "open" && !canDo(c.session.myRole, "comment")) throw new Error(t("Your role in this room does not allow comments."));
};
const toastError = (app) => (e) => app.toast(e.message, "danger", 5000);

/** Runs one validated action; the returned value (plain data) travels back as `data`. */
async function perform(app, c, { name, args }) {
  const s = c.session;
  switch (name) {
    case "pref.nick":
      app.setPref("collabNick", args.nick);
      return void c.profileChanged();
    case "run":
      focusMain();
      return void app.run(args.command);
    case "main.focus":
      return focusMain();
    case "room.create":
      return createRoom(app, c, args);
    case "room.join":
      return void (await c.joinRoom(args.code));
    case "room.leave":
      return c.leave();
    case "relay.stop": {
      await c.leave().catch(() => {});
      const net = await import("../../platform/native-net.js");
      await net.relay.stop().catch(() => {});
      builtinRelay = null;
      return c.changed("status");
    }
    case "relay.test": {
      const r = await (await import("./network.js")).diagnose(args.relay, { app });
      return { steps: r.steps.map((x) => ({ ok: !!x.ok, text: String(x.text || ""), fix: x.fix ? String(x.fix) : "" })) };
    }
    case "chat.send":
      return void (await inRoom(c, "chat").chat(args.text, { ...(args.reply ? { reply: args.reply } : {}), ...(args.thread ? { thread: args.thread } : {}), links: args.links }));
    case "chat.edit":
      return void (await inRoom(c, "chat").editChat(args.id, args.text));
    case "chat.delete":
      return void (await inRoom(c, "chat").deleteChat(args.id));
    case "chat.react":
      return void (await inRoom(c).react(args.id, args.emoji, args.on));
    case "chat.typing":
      return void s?.typing(args.on).catch(() => {});
    case "chat.read":
      return c.markRead();
    case "chat.link": {
      const l = c.selectionLink();
      if (!l) throw new Error(t("Select a layer, a page or a code line in the main window first."));
      return l;
    }
    case "file.send":
      return c.sendFile({ name: args.name, bytes: args.bytes });
    case "file.open":
      focusMain();
      return void (await c.openReceived(args.fid, args.mode));
    case "file.save":
      focusMain();
      return void c.saveReceived(args.fid).catch(toastError(app));
    case "file.dismiss":
      return c.dismissReceived(args.fid);
    case "jump":
      focusMain();
      return void c.jump(args.link);
    case "preview":
      focusMain();
      return void c.preview(args.doc, args.nodes);
    case "member.follow":
      return c.follow(args.id);
    case "member.role":
      return void (await inRoom(c).setRole(args.id, args.role));
    case "member.remove":
      return void (await inRoom(c).remove(args.id));
    case "invite.net": {
      const none = { entered: "", current: "", loopback: false, infoMissing: false, canLink: false, addrs: [] };
      if (!s || s.invite.relay === "local") return none;
      const net = await import("./network.js");
      const info = await net.relayInfo(s.invite.relay);
      const loop = net.isLoopbackRelay(s.invite.relay);
      return { entered: s.invite.relay, current: s.inviteRelay || s.invite.relay, loopback: loop && !s.inviteRelay, infoMissing: !info && loop, canLink: !!net.joinLink(info, s.shareInviteCode), addrs: net.inviteAddresses(info, s.invite.relay).map((a) => ({ url: a.url, label: a.label })) };
    }
    case "invite.code":
      return inRoom(c).shareInviteCode;
    case "invite.link": {
      const net = await import("./network.js");
      const link = net.joinLink(await net.relayInfo(inRoom(c).invite.relay), s.shareInviteCode);
      if (!link) throw new Error(t("This relay does not offer a join link."));
      return link;
    }
    case "invite.relay":
      if (!args.url || args.url === inRoom(c).invite.relay) s.inviteRelay = null;
      else inRoom(c).setInviteRelay(args.url);
      return c.changed("status");
    case "share.flow":
      focusMain();
      return void c.shareFlow(needDoc(app)).catch(toastError(app));
    case "live.stop":
      return void (await (await c.live()).stop(args.doc));
    case "live.open":
      focusMain();
      return void (await (await c.live()).openLive(args.doc));
    case "live.copy":
      focusMain();
      return void (await (await c.live()).openCopy(args.doc));
    case "comment.add":
      mayComment(c);
      return void c.addThread(needDoc(app), c.currentAnchor(), args.text);
    case "comment.reply":
      mayComment(c);
      return void c.reply(needDoc(app), args.thread, args.text);
    case "comment.resolve":
      return void c.setResolved(needDoc(app), args.thread, args.on);
    case "comment.edit":
      return void c.commentOp(needDoc(app), { op: "edit", threadId: args.thread, msgId: args.msg, text: args.text });
    case "comment.delete":
      return void c.commentOp(needDoc(app), { op: "delete", threadId: args.thread, msgId: args.msg });
    case "comment.drop":
      return void c.commentOp(needDoc(app), { op: "drop", threadId: args.thread });
    case "comment.jump": {
      const d = needDoc(app);
      const th = c.threads(d).find((x) => x.id === args.thread);
      if (!th?.anchor) return;
      focusMain();
      return void jumpToAnchor(app, c, d, th.anchor);
    }
    case "version.list":
      return app.doc ? (await c.versions.list(app.doc.id)).map((v) => ({ id: v.id, name: String(v.name || ""), ts: v.ts, author: v.author || "", bytes: v.bytes, auto: !!v.auto, note: v.note || "" })) : [];
    case "version.thumb":
      return (await c.versions.thumb(args.id)) || null;
    case "version.save":
      return void (await c.saveVersion(needDoc(app), { name: args.name, note: args.note }));
    case "version.restore":
      return void (await c.restoreVersion(args.id, { inPlace: args.inPlace }));
    case "version.send":
      return c.sendVersion(args.id);
    case "version.rename":
      return void (await c.versions.rename(args.id, args.name));
    case "version.remove":
      return void (await c.versions.remove(args.id));
  }
}

// ---------------------------------------------------------------------------------------------- the channel

/** The Collaboration window went away. That never leaves the room: say so, with a way back. */
function detach(app, c) {
  if (!attached) return;
  attached = null;
  lastKey = "";
  // a reload of the window says hello again right away: then nothing is shown
  clearTimeout(byeTimer);
  byeTimer = setTimeout(() => {
    if (!attached && c.session && c.session.state !== "left") app.toast(t("The Collaboration window is closed. You are still in the room."), "primary", 8000, { label: t("Open window"), run: () => openWindow(app, c) });
  }, 1500);
}

function ensureChannel(app, c) {
  if (channel) return;
  channel = new BroadcastChannel(UI_CHANNEL);
  channel.onmessage = async (ev) => {
    const m = ev.data;
    if (!isUiMessage(m)) return;
    if (m.t === "hello") {
      clearTimeout(byeTimer);
      attached = { pid: m.pid };
      push(app, c, true);
      if (pendingShow) post({ t: "show", ...pendingShow });
      pendingShow = null;
      // shared documents are listed by live.js, which loads on first use
      if (c.session && !c.liveMgr) c.live().then(() => push(app, c)).catch(() => {});
    } else if (m.t === "bye" && attached && m.pid === attached.pid) {
      detach(app, c);
    } else if (m.t === "act" && attached && m.pid === attached.pid) {
      const v = validateAction(m.a);
      if (!v.ok) return post({ t: "res", rid: m.rid, ok: false, error: v.error });
      try {
        const data = await perform(app, c, v.action);
        post({ t: "res", rid: m.rid, ok: true, ...(data === undefined ? {} : { data }) });
      } catch (err) {
        post({ t: "res", rid: m.rid, ok: false, error: String(err?.message || err).slice(0, 300) });
      }
      push(app, c);
    }
  };
  // push a fresh snapshot after every change (coalesced)
  let queued = 0;
  const later = () => {
    if (!attached || queued) return;
    queued = setTimeout(() => {
      queued = 0;
      if (c.session && !c.liveMgr) c.live().then(() => push(app, c)).catch(() => {});
      push(app, c);
    }, 120);
  };
  c.events.addEventListener("change", later);
  c.events.addEventListener("focus-thread", (e) => attached && post({ t: "show", tab: "comments", thread: e.detail }));
  for (const ev of ["doc", "docs", "prefs"]) app.on(ev, later);
  // the Collaboration window never outlives this one (desktop: src-tauri/src/lib.rs closes it as well)
  window.addEventListener("pagehide", () => post({ t: "close" }));
}

/** The blocked-popup message: the button retries inside its own click (a user gesture). */
function blockedDialog(app, c, show) {
  openDialog({
    title: "Collaboration window blocked",
    width: 460,
    body: h("div", h("p", t("Collaboration opens in its own window, and your browser blocked that window. Allow pop-ups for this site, then choose Open Collaboration window.")), h("p", t("Collaboration never opens inside this window."))),
    buttons: [
      { label: "Cancel", onClick: (close) => close() },
      { label: "Open Collaboration window", variant: "primary", onClick: (close) => (close(), openWindow(app, c, show)) },
    ],
  });
}

/**
 * Opens the Collaboration window, or brings the open one to the front, and asks it to show `tab` (and a comment
 * thread, an invite code from a join link, or the Save version form). Run it inside a user gesture: browsers only
 * open windows then. Resolves false when no window could be opened (a dialog with a retry button is shown).
 */
export async function openWindow(app, c, show = {}) {
  const want = { tab: show.tab || undefined, thread: show.thread || undefined, invite: show.invite || undefined, focus: show.focus || undefined };
  if (typeof BroadcastChannel === "undefined") {
    app.toast(t("This browser cannot connect two windows (no BroadcastChannel), so Collaboration is not available here."), "warning", 8000);
    return false;
  }
  ensureChannel(app, c);
  let result = null;
  try {
    result = await (await import("../popout.js")).popoutCollab({ onClosed: () => detach(app, c) });
  } catch (err) {
    app.toast(err.message, "danger", 6000);
    return false;
  }
  if (!result) {
    blockedDialog(app, c, want);
    return false;
  }
  if (attached) post({ t: "show", ...want });
  else pendingShow = want;
  return true;
}
