// Protocol between the main window and the Collaboration window (pure, no DOM; unit tested in
// tests/collab/remote-ui.test.js). Design: docs/adr/0030-collab-native-window.md and docs/collaboration.md
// ("The Collaboration window").
//
// The Collaboration UI always lives in its own OS window. The main window keeps the ONE room connection (keys,
// identity, relay socket) and the documents; the Collaboration window is a remote view: it receives bounded,
// plain-data snapshots over BroadcastChannel("openfini-collab-ui") and sends a whitelist of actions back. Room keys
// and the room secret never cross the channel. The invite code is not part of a snapshot: it is only sent as the
// answer to an explicit request (Show / Copy / QR code), and into the main window when the user joins a room.
//
// Public API
//   UI_CHANNEL, PROTOCOL, WINDOW_LABEL, WINDOW_SIZE, WINDOW_STATE_KEY, RUN_COMMANDS, LIMITS
//   isUiMessage(m) → boolean                              envelope check: { t, ... } with a known type
//   validateAction(a) → { ok: true, action } | { ok: false, error }   whitelist + limits for window → main actions
//   makeSnapshot(input) → Snapshot                         bounded copy built by the main window
//   readSnapshot(v) → Snapshot | null                      validated copy in the Collaboration window
//   snapshotKey(s) → string                                the snapshot without its time stamp (to skip unchanged ones)
//   changeKind(prev, next) → "none" | "chat" | "all"       what the window has to render again
//   readShow(m) → { tab, thread, invite, focus }           validated "show" request (main → window)
//   readWindowState(json) / placeWindow(state, monitors) / windowFeatures(place)   remembered position and size
// Message types: hello {pid}, bye {pid}, act {pid, rid, a}, res {rid, ok, error?, data?}, snap {s},
//   show {tab?, thread?, invite?, focus?} (main asks the window to show something), close {} (the main window goes away).
export const UI_CHANNEL = "openfini-collab-ui";
export const PROTOCOL = 2;
/** Tauri window label (one window, so re-opening focuses it; listed in src-tauri/capabilities/default.json). */
export const WINDOW_LABEL = "collab";
/** localStorage key of the window's remembered position and size (written by the Collaboration window itself). */
export const WINDOW_STATE_KEY = "openfini.collab.nativeWindow";
export const WINDOW_SIZE = { w: 560, h: 720, minW: 340, minH: 320 };
export const TYPES = ["hello", "bye", "act", "res", "snap", "show", "close"];
export const TABS = ["chat", "people", "comments", "versions"];
export const LIMITS = { chat: 300, members: 64, threads: 500, messages: 100, text: 4000, nick: 40, avatar: 24 * 1024, invite: 4000, url: 600, fileBytes: 25 * 1024 * 1024, links: 8, ids: 64, list: 64 };
/** Commands of the main window the Collaboration window may start (each opens a dialog in the main window). */
export const RUN_COMMANDS = ["collab.profile", "collab.shareDocument", "collab.relayHelp"];

const ID_RE = /^[^\u0000-\u001f\u007f]{1,128}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const id = (v) => (typeof v === "string" && ID_RE.test(v) ? v : null);
const ids = (v, max = LIMITS.ids) => (Array.isArray(v) ? v.map(id).filter(Boolean).slice(0, max) : []);
const color = (v) => (typeof v === "string" && COLOR_RE.test(v) ? v : "#888888");
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const oneOf = (v, list, d = null) => (list.includes(v) ? v : d);
const obj = (v) => (v && typeof v === "object" ? v : {});
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

export function isUiMessage(m) {
  if (!m || typeof m !== "object" || !TYPES.includes(m.t)) return false;
  return m.t === "snap" || m.t === "close" || m.t === "res" || m.t === "show" || !!id(m.pid);
}

const link = (l) => {
  const kind = oneOf(l?.kind, ["node", "page", "line"]);
  const doc = id(l?.doc);
  const target = str(l?.id, 512);
  if (!kind || !doc || !target) return null;
  return { kind, doc, id: target, ...(id(l.page) ? { page: l.page } : {}), ...(Number.isFinite(l.line) ? { line: Math.max(1, Math.round(l.line)) } : {}), label: str(l.label, 120) };
};
const links = (v) => arr(v, LIMITS.links).map(link).filter(Boolean);

// Every action returns its cleaned arguments, or null when a required one is missing or malformed.
const need = (args, ...keys) => (keys.every((k) => args[k] !== null && args[k] !== "" && args[k] !== undefined) ? args : null);
const text = (v) => str(v, LIMITS.text).trim();
const none = () => ({});
const ACTIONS = {
  "pref.nick": (a) => ({ nick: str(a.nick, LIMITS.nick).trim() }),
  run: (a) => need({ command: oneOf(a.command, RUN_COMMANDS) }, "command"),
  "main.focus": none,
  "room.create": (a) => need({ where: oneOf(a.where, ["builtin", "local", "relay"]), relay: str(a.relay, LIMITS.url).trim(), role: oneOf(a.role, ["editor", "commenter", "viewer"], "editor"), tunnel: a.tunnel === true }, "where"),
  "room.join": (a) => need({ code: str(a.code, LIMITS.invite).trim() }, "code"),
  "room.leave": none,
  "relay.stop": none,
  "relay.test": (a) => need({ relay: str(a.relay, LIMITS.url).trim() }, "relay"),
  "chat.send": (a) => need({ text: text(a.text), ...(id(a.reply) ? { reply: a.reply } : {}), ...(id(a.thread) ? { thread: a.thread } : {}), links: links(a.links) }, "text"),
  "chat.edit": (a) => need({ id: id(a.id), text: text(a.text) }, "id", "text"),
  "chat.delete": (a) => need({ id: id(a.id) }, "id"),
  "chat.react": (a) => need({ id: id(a.id), emoji: str(a.emoji, 16), on: a.on !== false }, "id", "emoji"),
  "chat.typing": (a) => ({ on: a.on === true }),
  "chat.read": none,
  "chat.link": none, // answers with a link to the main window's current selection
  "file.send": (a) => need({ name: str(a.name, 255), bytes: a.bytes instanceof Uint8Array && a.bytes.length && a.bytes.length <= LIMITS.fileBytes ? a.bytes : null }, "name", "bytes"),
  "file.open": (a) => need({ fid: id(a.fid), mode: oneOf(a.mode, ["copy", "linked", "replace"], "copy") }, "fid"),
  "file.save": (a) => need({ fid: id(a.fid) }, "fid"),
  "file.dismiss": (a) => need({ fid: id(a.fid) }, "fid"),
  jump: (a) => need({ link: link(a.link) }, "link"),
  preview: (a) => need({ doc: id(a.doc), nodes: ids(a.nodes) }, "doc"),
  "member.follow": (a) => ({ id: id(a.id) }),
  "member.role": (a) => need({ id: id(a.id), role: oneOf(a.role, ["editor", "commenter", "viewer"]) }, "id", "role"),
  "member.remove": (a) => need({ id: id(a.id) }, "id"),
  "invite.net": none, // addresses other devices can use, whether a join link exists (no secret)
  "invite.code": none, // answers with the invite code: only on an explicit click
  "invite.link": none, // answers with the join link (contains the invite code)
  "invite.relay": (a) => ({ url: str(a.url, LIMITS.url).trim() }),
  "share.flow": none,
  "live.stop": (a) => need({ doc: id(a.doc) }, "doc"),
  "live.open": (a) => need({ doc: id(a.doc) }, "doc"),
  "live.copy": (a) => need({ doc: id(a.doc) }, "doc"),
  "comment.add": (a) => need({ text: text(a.text) }, "text"), // anchored at the main window's current selection
  "comment.reply": (a) => need({ thread: id(a.thread), text: text(a.text) }, "thread", "text"),
  "comment.resolve": (a) => need({ thread: id(a.thread), on: a.on !== false }, "thread"),
  "comment.jump": (a) => need({ thread: id(a.thread) }, "thread"),
  "comment.edit": (a) => need({ thread: id(a.thread), msg: id(a.msg), text: text(a.text) }, "thread", "msg", "text"),
  "comment.delete": (a) => need({ thread: id(a.thread), msg: id(a.msg) }, "thread", "msg"),
  "comment.drop": (a) => need({ thread: id(a.thread) }, "thread"),
  "version.list": none,
  "version.thumb": (a) => need({ id: id(a.id) }, "id"),
  "version.save": (a) => ({ name: str(a.name, 80).trim(), note: str(a.note, 500).trim() }),
  "version.restore": (a) => need({ id: id(a.id), inPlace: a.inPlace === true }, "id"),
  "version.send": (a) => need({ id: id(a.id) }, "id"),
  "version.rename": (a) => need({ id: id(a.id), name: str(a.name, 80).trim() }, "id", "name"),
  "version.remove": (a) => need({ id: id(a.id) }, "id"),
};
export const ACTION_NAMES = Object.keys(ACTIONS);

export function validateAction(a) {
  if (!a || typeof a !== "object" || typeof a.name !== "string" || !Object.hasOwn(ACTIONS, a.name)) return { ok: false, error: "unknown action" };
  const args = ACTIONS[a.name](obj(a.args));
  if (!args) return { ok: false, error: "missing or invalid argument" };
  return { ok: true, action: { name: a.name, args } };
}

// ---------------------------------------------------------------------------------------------- snapshots

const profile = (p) => {
  const nick = str(p?.nick, LIMITS.nick) || "?";
  const avatar = typeof p?.avatar === "string" && p.avatar.length <= LIMITS.avatar && /^data:image\/(png|webp|jpeg);base64,/.test(p.avatar) ? p.avatar : "";
  return { nick, color: color(p?.color), initials: str(p?.initials, 3) || nick.slice(0, 2).toUpperCase(), ...(avatar ? { avatar } : {}) };
};
const member = (m) => ({ id: str(m?.id, 128), profile: profile(m?.profile), role: str(m?.role, 12), studio: str(m?.studio, 16), docName: str(m?.docName, 120), typing: !!m?.typing });
const reactions = (r) => Object.fromEntries(Object.entries(obj(r)).slice(0, 16).map(([e, who]) => [str(e, 16), ids(who)]).filter(([e, who]) => e && who.length));
const activity = (a) => ({ label: str(a?.label, 120), count: Math.max(1, num(a?.count, 1)), pageName: str(a?.pageName, 120), doc: str(a?.doc, 128), docName: str(a?.docName, 120), page: str(a?.page, 128), nodes: ids(a?.nodes) });
const message = (m) => {
  const kind = oneOf(m?.kind, ["chat", "activity", "system"], "chat");
  const file = m?.file && typeof m.file === "object" && id(m.file.fid) ? { fid: m.file.fid, name: str(m.file.name, 255), size: Math.max(0, num(m.file.size)) } : null;
  return {
    id: str(m?.id, 128),
    from: str(m?.from, 128),
    nick: str(m?.nick, LIMITS.nick) || "?",
    color: color(m?.color),
    ts: num(m?.ts),
    kind,
    text: str(m?.text, LIMITS.text),
    edited: !!m?.edited,
    deleted: !!m?.deleted,
    mention: !!m?.mention,
    ...(id(m?.reply) ? { reply: m.reply } : {}),
    ...(id(m?.thread) ? { thread: m.thread } : {}),
    links: links(m?.links),
    reactions: reactions(m?.reactions),
    ...(file ? { file } : {}),
    ...(kind === "activity" ? { activity: activity(m.activity) } : {}),
  };
};
const comment = (m) => ({ id: str(m?.id, 128), author: str(m?.author, 128), nick: str(m?.nick, LIMITS.nick) || "?", color: color(m?.color), ts: num(m?.ts), text: str(m?.text, LIMITS.text), edited: !!m?.edited, deleted: !!m?.deleted, ai: !!m?.ai, mentions: ids(m?.mentions, 16) });
const thread = (t) => ({
  id: str(t?.id, 128),
  author: str(t?.author, 128),
  color: color(t?.color),
  ai: !!t?.ai,
  ts: num(t?.ts),
  resolved: !!t?.resolved,
  resolvedBy: str(t?.resolvedBy, LIMITS.nick),
  resolvedAt: num(t?.resolvedAt),
  where: str(t?.where, 200),
  anchor: { kind: str(t?.anchor?.kind, 16), quote: str(t?.anchor?.quote, 400) },
  messages: arr(t?.messages, LIMITS.messages).map(comment),
});
const transfer = (x) => ({ fid: str(x?.fid, 128), name: str(x?.name, 255), size: Math.max(0, num(x?.size)), done: Math.max(0, num(x?.done)), outgoing: !!x?.outgoing, failed: str(x?.failed, 200) });
const received = (x) => ({ fid: str(x?.fid, 128), name: str(x?.name, 255), size: Math.max(0, num(x?.size)), ext: str(x?.ext, 12), doc: str(x?.doc, 128) });
const liveDoc = (d) => ({ doc: str(d?.doc, 128), name: str(d?.name, 120), kind: str(d?.kind, 12), open: !!d?.open, ownedByMe: !!d?.ownedByMe, paused: !!d?.paused, people: Math.max(0, num(d?.people)), from: str(d?.from, LIMITS.nick) });

function session(s) {
  if (!s || typeof s !== "object") return null;
  const builtin = s.builtin && typeof s.builtin === "object" ? { addr: str(s.builtin.addr, LIMITS.url), port: num(s.builtin.port) } : null;
  return {
    state: str(s.state, 16),
    host: str(s.host, 120),
    id: str(s.id, 128),
    role: str(s.role, 12),
    isHost: !!s.isHost,
    fingerprint: arr(s.fingerprint, 12).map((w) => str(w, 24)),
    local: !!s.local, // a room on this device only
    builtin,
    members: arr(s.members, LIMITS.members).map(member),
    chat: (Array.isArray(s.chat) ? s.chat : []).slice(-LIMITS.chat).map(message),
    unread: Math.max(0, num(s.unread)),
    followId: id(s.followId),
    transfers: arr(s.transfers, LIMITS.list).map(transfer),
    received: arr(s.received, LIMITS.list).map(received),
    live: arr(s.live, LIMITS.list).map(liveDoc),
  };
}

/** @param {{prefs:object, me:object, session:object|null, doc:object|null, docIds:string[], threads:any[]}} i */
export function makeSnapshot(i) {
  return readSnapshot({ ...i, v: PROTOCOL, ts: Date.now() });
}

export function readSnapshot(v) {
  if (!v || typeof v !== "object" || v.v !== PROTOCOL) return null;
  const me = obj(v.me);
  const prefs = obj(v.prefs);
  return {
    v: PROTOCOL,
    ts: num(v.ts),
    prefs: { nick: str(prefs.nick, LIMITS.nick), relay: str(prefs.relay, LIMITS.url), offline: !!prefs.offline },
    me: { id: str(me.id, 128), ids: ids(me.ids, 4), profile: profile(me.profile), studio: str(me.studio, 16), docName: str(me.docName, 120) },
    session: session(v.session),
    doc: v.doc && typeof v.doc === "object" && id(v.doc.id) ? { id: v.doc.id, name: str(v.doc.name, 120) } : null,
    docIds: ids(v.docIds, 200),
    threads: arr(v.threads, LIMITS.threads).map(thread),
  };
}

export const snapshotKey = (s) => JSON.stringify({ ...s, ts: 0 });

// The parts that change with every chat message, keystroke ("typing") or file chunk: they only need the chat list again.
const split = (s) => {
  const ses = s.session;
  const quick = ses ? { chat: ses.chat, unread: ses.unread, transfers: ses.transfers, typing: ses.members.filter((m) => m.typing).map((m) => m.id) } : null;
  const rest = { ...s, ts: 0, session: ses ? { ...ses, chat: 0, unread: 0, transfers: 0, members: ses.members.map((m) => ({ ...m, typing: false })) } : null };
  return [JSON.stringify(rest), JSON.stringify(quick)];
};

/** What changed between two snapshots: nothing, only the chat stream, or anything else. */
export function changeKind(prev, next) {
  if (!prev || !next) return prev === next ? "none" : "all";
  const [a1, b1] = split(prev);
  const [a2, b2] = split(next);
  return a1 !== a2 ? "all" : b1 !== b2 ? "chat" : "none";
}

export function readShow(m) {
  return { tab: oneOf(m?.tab, TABS), thread: id(m?.thread), invite: str(m?.invite, LIMITS.invite).trim(), focus: oneOf(m?.focus, ["version"]) };
}

// ---------------------------------------------------------------------------------------------- window placement

/** Validated remembered geometry of the Collaboration window (CSS px): { w, h, x?, y?, compact }. */
export function readWindowState(json) {
  const j = obj(json);
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : undefined);
  const out = { w: WINDOW_SIZE.w, h: WINDOW_SIZE.h, compact: j.compact === true };
  if (n(j.w) >= WINDOW_SIZE.minW && n(j.h) >= WINDOW_SIZE.minH && n(j.w) <= 10000 && n(j.h) <= 10000) ((out.w = n(j.w)), (out.h = n(j.h)));
  if (n(j.x) !== undefined && n(j.y) !== undefined && Math.abs(n(j.x)) < 100000 && Math.abs(n(j.y)) < 100000) ((out.x = n(j.x)), (out.y = n(j.y)));
  return out;
}

/**
 * Where to open the window. `monitors` are the visible screen areas in CSS px ([{ x, y, w, h }]). The remembered
 * position is only used when the window's title area would be reachable on one of them (a second screen may be gone).
 */
export function placeWindow(state, monitors = []) {
  const s = readWindowState(state);
  const out = { w: s.w, h: s.h };
  if (s.x === undefined) return out;
  const hit = monitors.find((m) => m && s.x + 80 <= m.x + m.w && s.x + s.w - 80 >= m.x && s.y >= m.y - 8 && s.y + 40 <= m.y + m.h);
  if (!hit) return out;
  out.w = Math.min(s.w, hit.w);
  out.h = Math.min(s.h, hit.h);
  return { ...out, x: s.x, y: s.y };
}

/** The `features` string of window.open for a placement. */
export function windowFeatures(place) {
  const f = ["popup=yes", `width=${place.w}`, `height=${place.h}`];
  if (place.x !== undefined) f.push(`left=${place.x}`, `top=${place.y}`);
  return f.join(",");
}
