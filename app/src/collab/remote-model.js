// The Collaboration window's model (pure, no DOM; unit tested in tests/collab/remote-ui.test.js): turns the snapshots
// of the main window into the same shapes the Collaboration UI reads from a controller and an app (`c.session`,
// `c.threads()`, `app.doc`, ...), and turns every call that changes something into an action for the main window.
// The window has no room connection, identity or documents of its own (docs/adr/0030-collab-native-window.md).
//
// Public API
//   createRemoteModel({ act, toast }) → { c, app, update(snapshot) → "none" | "chat" | "all", snapshot() }
//     act(name, args, { timeout }) → Promise<{ ok, error?, data? }>     sends one action to the main window
//     toast(message, variant, duration)                               shows a message in this window
// Invariants: methods that return a promise reject with the main window's error text; fire-and-forget methods report
// failures through `toast`; nothing here keeps the invite code.
import { changeKind } from "./remote-ui.js";

/** Actions that may wait for the network, a large file or a question in the main window. */
const SLOW = new Set(["room.create", "room.join", "relay.stop", "relay.test", "file.send", "file.open", "invite.net", "version.list", "version.save", "version.restore", "version.send", "live.open", "live.copy"]);
const GUEST = { nick: "?", color: "#888888", initials: "?" };

export function createRemoteModel({ act, toast = () => {} }) {
  let snap = null;
  let session = null; // one stable object per room, so open forms keep reading fresh state

  const call = async (name, args = {}) => {
    const r = await act(name, args, { timeout: SLOW.has(name) ? 120000 : 15000 });
    if (!r || !r.ok) throw new Error((r && r.error) || "That did not work.");
    return r.data;
  };
  const fire = (name, args) => void call(name, args).catch((e) => toast(e.message, "danger", 5000));

  const sessionMethods = {
    member: (id) => session?.members.find((m) => m.id === id) || null,
    chat: (text, { reply, thread, links } = {}) => call("chat.send", { text, reply, thread, links }),
    editChat: (id, text) => call("chat.edit", { id, text }),
    deleteChat: (id) => call("chat.delete", { id }),
    react: (id, emoji, on) => call("chat.react", { id, emoji, on }),
    typing: (on) => call("chat.typing", { on }),
    setRole: (id, role) => call("member.role", { id, role }),
    remove: (id) => call("member.remove", { id }),
  };

  function readSession(s, me) {
    if (!s) return null;
    const target = session && session.id === s.id ? session : { ...sessionMethods };
    const roles = new Map(s.members.map((m) => [m.id, m.role]));
    roles.set(s.id, s.role);
    return Object.assign(target, {
      state: s.state,
      relayHost: s.host,
      id: s.id,
      myRole: s.role,
      isHost: s.isHost,
      profile: me.profile,
      fingerprint: s.fingerprint,
      local: s.local,
      builtin: s.builtin,
      members: s.members.map((m) => ({ id: m.id, profile: m.profile, typing: m.typing, presence: { studio: m.studio, docName: m.docName } })),
      room: { roleOf: (id) => roles.get(id) || "" },
      chatStore: {
        unread: s.unread,
        list: s.chat,
        byId: new Map(s.chat.map((m) => [m.id, m])),
        main: () => s.chat.filter((m) => !m.thread),
        thread: (root) => s.chat.filter((m) => m.thread === root),
        threadCount: (root) => s.chat.filter((m) => m.thread === root && !m.deleted).length,
        mentionsMe: (m) => !!m?.mention,
      },
    });
  }

  const c = {
    events: new EventTarget(),
    session: null,
    followId: null,
    transfers: new Map(),
    received: new Map(),
    prefillInvite: "",
    get myId() {
      return snap?.me.id || "";
    },
    isMine: (id) => !!snap && snap.me.ids.includes(id),
    profile: () => snap?.me.profile || GUEST,
    profileChanged() {},
    status: () => ({ connected: session?.state === "open", members: (session?.members.length || 0) + 1 }),
    presencePayload: () => ({ studio: snap?.me.studio || "", docName: snap?.me.docName || "" }),
    markRead() {
      if (!session?.chatStore.unread) return;
      session.chatStore.unread = 0;
      fire("chat.read");
    },
    threads: () => snap?.threads || [],
    // rooms
    createRoom: (o) => call("room.create", o),
    joinRoom: (code) => call("room.join", { code }),
    leave: () => call("room.leave"),
    stopRelay: () => call("relay.stop"),
    testRelay: (relay) => call("relay.test", { relay }),
    inviteNet: () => call("invite.net"),
    inviteCode: () => call("invite.code"),
    inviteLink: () => call("invite.link"),
    setInviteRelay: (url) => call("invite.relay", { url: url || "" }),
    // chat, files, navigation in the main window
    selectionLink: () => call("chat.link"),
    sendFile: (f) => call("file.send", f),
    openReceived: (fid, mode = "copy") => call("file.open", { fid, mode }),
    saveReceived: (fid) => call("file.save", { fid }),
    dismissReceived: (fid) => fire("file.dismiss", { fid }),
    jump: (link) => fire("jump", { link }),
    preview: (doc, nodes) => fire("preview", { doc, nodes }),
    follow: (id) => fire("member.follow", { id }),
    focusMain: () => fire("main.focus"),
    // shared documents
    shareFlow: () => call("share.flow"),
    live: async () => ({
      list: () => snap?.session?.live || [],
      stop: (doc) => call("live.stop", { doc }),
      openLive: (doc) => call("live.open", { doc }),
      openCopy: (doc) => call("live.copy", { doc }),
    }),
    // comments of the main window's active document
    addThread: (text) => call("comment.add", { text }),
    reply(thread, text) {
      if (!String(text || "").trim()) return false;
      fire("comment.reply", { thread, text });
      return true;
    },
    setResolved: (thread, on) => fire("comment.resolve", { thread, on }),
    jumpToThread: (thread) => fire("comment.jump", { thread }),
    editComment: (thread, msg, text) => fire("comment.edit", { thread, msg, text }),
    deleteComment: (thread, msg) => fire("comment.delete", { thread, msg }),
    dropThread: (thread) => fire("comment.drop", { thread }),
    // versions of the main window's active document
    versions: {
      list: () => call("version.list"),
      thumb: (id) => call("version.thumb", { id }).catch(() => null),
      rename: (id, name) => call("version.rename", { id, name }),
      remove: (id) => call("version.remove", { id }),
    },
    saveVersion: (o) => call("version.save", o),
    restoreVersion: (id, { inPlace = false } = {}) => call("version.restore", { id, inPlace }),
    sendVersion: (id) => call("version.send", { id }),
  };

  const app = {
    prefs: { collabNick: "", collabRelay: "", offlineMode: false },
    doc: null,
    docs: [],
    setPref(key, value) {
      if (key !== "collabNick") return;
      app.prefs.collabNick = value;
      fire("pref.nick", { nick: value });
    },
    run: (command) => fire("run", { command }),
    toast,
  };

  /** Takes a validated snapshot; returns what has to be rendered again. */
  function update(next) {
    const kind = changeKind(snap, next);
    snap = next;
    session = c.session = readSession(next.session, next.me);
    c.followId = next.session?.followId || null;
    c.transfers = new Map((next.session?.transfers || []).map((x) => [x.fid, x]));
    c.received = new Map((next.session?.received || []).map((x) => [x.fid, { transfer: x }]));
    app.prefs = { collabNick: next.prefs.nick, collabRelay: next.prefs.relay, offlineMode: next.prefs.offline };
    app.doc = next.doc;
    app.docs = next.docIds.map((id) => ({ id }));
    return kind;
  }

  return { c, app, update, snapshot: () => snap };
}
