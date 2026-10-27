// Protocol of the UI-only Collaboration pop-out (pure, no DOM; unit tested in tests/collab/remote-ui.test.js).
// Design: docs/adr/0010-collab-popout.md and docs/collaboration.md ("Pop-out window").
//
// The main window keeps the ONE room connection (keys, identity, relay socket). The pop-out window is a remote view:
// it receives bounded, plain-data snapshots over BroadcastChannel("openfini-collab-ui") and sends a small whitelist of
// actions back. No key material, invite code or room secret ever crosses this channel; the pop-out has no identity.
//
// Public API
//   UI_CHANNEL
//   isUiMessage(m) → boolean                              envelope check: { t, ... } with a known type
//   validateAction(a) → { ok: true, action } | { ok: false, error }   whitelist + limits for pop-out → main actions
//   makeSnapshot(input) → Snapshot                         bounded copy built by the main window
//   readSnapshot(v) → Snapshot | null                      validated copy in the pop-out
// Message types: hello {pid}, bye {pid}, act {pid, rid, a}, res {rid, ok, error?}, snap {s}, dock {} (main asks the pop-out to close).
export const UI_CHANNEL = "openfini-collab-ui";
export const TYPES = ["hello", "bye", "act", "res", "snap", "dock"];
export const LIMITS = { chat: 120, members: 100, threads: 200, messages: 100, text: 4000, nick: 40 };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const id = (v) => (typeof v === "string" && ID_RE.test(v) ? v : null);
const color = (v) => (typeof v === "string" && COLOR_RE.test(v) ? v : "#888888");
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

export function isUiMessage(m) {
  return !!m && typeof m === "object" && TYPES.includes(m.t) && (m.t === "snap" || m.t === "dock" || m.t === "res" || !!id(m.pid) || m.t === "hello");
}

const ACTIONS = {
  "chat.send": (a) => ({ text: str(a.text, LIMITS.text).trim() }),
  "chat.read": () => ({}),
  "comment.add": (a) => ({ text: str(a.text, LIMITS.text).trim() }), // anchored at the main window's current selection
  "comment.reply": (a) => ({ thread: id(a.thread), text: str(a.text, LIMITS.text).trim() }),
  "comment.resolve": (a) => ({ thread: id(a.thread), on: a.on !== false }),
  "comment.jump": (a) => ({ thread: id(a.thread) }),
  "dock": () => ({}),
};

export function validateAction(a) {
  if (!a || typeof a !== "object" || typeof a.name !== "string" || !Object.hasOwn(ACTIONS, a.name)) return { ok: false, error: "unknown action" };
  const args = ACTIONS[a.name](a.args && typeof a.args === "object" ? a.args : {});
  if ("text" in args && !args.text) return { ok: false, error: "empty text" };
  if (("thread" in args) && !args.thread) return { ok: false, error: "missing thread" };
  return { ok: true, action: { name: a.name, args } };
}

/** @param {{status:object, me:object, members:any[], chat:any[], unread:number, doc:object|null, threads:any[], pins?:boolean}} i */
export function makeSnapshot(i) {
  return readSnapshot({ v: 1, ...i, ts: Date.now() });
}

export function readSnapshot(v) {
  if (!v || typeof v !== "object") return null;
  const st = v.status && typeof v.status === "object" ? v.status : {};
  const me = v.me && typeof v.me === "object" ? v.me : {};
  const member = (m) => ({ id: str(m?.id, 64), nick: str(m?.nick, LIMITS.nick) || "?", color: color(m?.color), role: str(m?.role, 12), online: m?.online !== false });
  const msg = (m) => ({ id: str(m?.id, 64), from: str(m?.from, 64), nick: str(m?.nick, LIMITS.nick) || "?", color: color(m?.color), ts: num(m?.ts), text: str(m?.text, LIMITS.text), kind: ["chat", "activity", "system"].includes(m?.kind) ? m.kind : "chat", mine: !!m?.mine, deleted: !!m?.deleted });
  const thread = (t) => ({
    id: str(t?.id, 64),
    nick: str(t?.nick, LIMITS.nick) || "?",
    color: color(t?.color),
    resolved: !!t?.resolved,
    n: num(t?.n),
    where: str(t?.where, 120),
    messages: (Array.isArray(t?.messages) ? t.messages : []).slice(-LIMITS.messages).map((m) => ({ id: str(m?.id, 64), nick: str(m?.nick, LIMITS.nick) || "?", color: color(m?.color), ts: num(m?.ts), text: str(m?.text, LIMITS.text), deleted: !!m?.deleted })),
  });
  return {
    v: 1,
    ts: num(v.ts),
    status: { inRoom: !!st.inRoom, state: str(st.state, 16), host: str(st.host, 80), members: num(st.members), role: str(st.role, 12), canChat: st.canChat !== false, canComment: st.canComment !== false },
    me: { id: str(me.id, 64), nick: str(me.nick, LIMITS.nick), color: color(me.color) },
    members: (Array.isArray(v.members) ? v.members : []).slice(0, LIMITS.members).map(member),
    chat: (Array.isArray(v.chat) ? v.chat : []).slice(-LIMITS.chat).map(msg),
    unread: num(v.unread),
    doc: v.doc && typeof v.doc === "object" ? { id: str(v.doc.id, 64), name: str(v.doc.name, 120) } : null,
    threads: (Array.isArray(v.threads) ? v.threads : []).slice(0, LIMITS.threads).map(thread),
  };
}
