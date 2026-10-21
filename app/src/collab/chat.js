// Chat store: messages, replies, threads, reactions, edits, deletions, unread count and mentions. Pure (no DOM).
//
// A message is { id, from, nick, color, ts, text, reply?, thread?, mentions[], links[], file?, edited?, deleted?,
// reactions: { emoji: [member ids] }, kind: "chat" | "activity" | "system" }. `thread` is the id of the thread's root
// message: replies inside a thread are not shown in the main list, only their count on the root. `reply` quotes
// another message in the main list. Only the author may edit or delete a message (checked here, so a modified client
// cannot change other people's messages). Deleted messages keep a tombstone so replies still make sense.
//
// Public API
//   new ChatStore({ me, max })
//   .add(from, author, msg, { local })  → message | null   (author = { nick, color })
//   .edit(from, id, text, ts) / .remove(from, id) / .react(from, id, emoji, on)   → boolean (changed)
//   .addActivity(from, author, activity, ts) → message     (groups into the previous activity of the same author)
//   .addSystem(text, ts)
//   .main()              messages of the main list (no thread replies), oldest first
//   .thread(rootId)      replies of a thread, oldest first
//   .unread / .markRead() / .mentionsMe(message)
import { LIMITS } from "./protocol.js";

const ACTIVITY_GROUP_MS = 8000;

export class ChatStore {
  /** @param {{me:string, max?:number}} o */
  constructor({ me, max = LIMITS.chatHistory }) {
    this.me = me;
    this.max = max;
    /** @type {any[]} */
    this.list = [];
    this.byId = new Map();
    this.unread = 0;
    this.unreadMentions = 0;
  }

  #push(m) {
    this.list.push(m);
    this.byId.set(m.id, m);
    while (this.list.length > this.max) this.byId.delete(this.list.shift().id);
    return m;
  }

  mentionsMe(m) {
    return !!m && m.from !== this.me && Array.isArray(m.mentions) && m.mentions.includes(this.me);
  }

  /** Adds a chat message. Duplicate ids are ignored (returns null). */
  add(from, author, msg, { local = false, ts = Date.now() } = {}) {
    if (!msg?.id || this.byId.has(msg.id)) return null;
    const thread = msg.thread && this.byId.has(msg.thread) ? this.byId.get(msg.thread).thread || msg.thread : undefined;
    const m = {
      kind: "chat",
      id: msg.id,
      from,
      nick: author?.nick || "?",
      color: author?.color || "#888888",
      ts,
      text: msg.text || "",
      reply: msg.reply && this.byId.has(msg.reply) ? msg.reply : undefined,
      thread,
      mentions: msg.mentions || [],
      links: msg.links || [],
      file: msg.file,
      reactions: {},
    };
    this.#push(m);
    if (!local) {
      this.unread++;
      if (this.mentionsMe(m)) this.unreadMentions++;
    }
    return m;
  }

  edit(from, id, text, ts = Date.now()) {
    const m = this.byId.get(id);
    if (!m || m.kind !== "chat" || m.from !== from || m.deleted) return false;
    m.text = text;
    m.edited = ts;
    return true;
  }

  remove(from, id) {
    const m = this.byId.get(id);
    if (!m || m.kind !== "chat" || m.from !== from || m.deleted) return false;
    m.deleted = true;
    m.text = "";
    m.links = [];
    m.file = undefined;
    m.reactions = {};
    return true;
  }

  react(from, id, emoji, on) {
    const m = this.byId.get(id);
    if (!m || m.deleted) return false;
    const who = m.reactions[emoji] || [];
    const has = who.includes(from);
    if (on === has) return false;
    if (on) {
      if (Object.keys(m.reactions).length >= LIMITS.reactions && !m.reactions[emoji]) return false;
      m.reactions[emoji] = [...who, from];
    } else {
      const next = who.filter((x) => x !== from);
      if (next.length) m.reactions[emoji] = next;
      else delete m.reactions[emoji];
    }
    return true;
  }

  /**
   * Adds an edit-activity entry ("Mia moved 3 layers on Page 2"). Consecutive activities of the same author, document
   * and label within a few seconds merge into one entry (counts add up), so the feed stays readable.
   */
  addActivity(from, author, a, ts = Date.now()) {
    const last = this.list[this.list.length - 1];
    if (last && last.kind === "activity" && last.from === from && last.activity.doc === a.doc && last.activity.label === a.label && ts - last.ts < ACTIVITY_GROUP_MS) {
      last.activity.count += a.count;
      last.activity.steps = (last.activity.steps || 1) + 1;
      last.activity.nodes = [...new Set([...(last.activity.nodes || []), ...(a.nodes || [])])].slice(0, LIMITS.ids);
      last.ts = ts;
      return last;
    }
    return this.#push({ kind: "activity", id: `act-${from.slice(0, 6)}-${ts}-${this.list.length}`, from, nick: author?.nick || "?", color: author?.color || "#888888", ts, activity: { ...a, steps: 1 }, reactions: {} });
  }

  addSystem(text, ts = Date.now()) {
    return this.#push({ kind: "system", id: `sys-${ts}-${this.list.length}`, from: "", nick: "", color: "", ts, text, reactions: {} });
  }

  main() {
    return this.list.filter((m) => !m.thread);
  }

  thread(rootId) {
    return this.list.filter((m) => m.thread === rootId);
  }

  threadCount(rootId) {
    let n = 0;
    for (const m of this.list) if (m.thread === rootId && !m.deleted) n++;
    return n;
  }

  markRead() {
    this.unread = 0;
    this.unreadMentions = 0;
  }

  /** The recent chat messages a host sends to a new member (no activities, no system notes, no deleted ones). */
  recent(n = LIMITS.stateChat) {
    return this.list
      .filter((m) => m.kind === "chat" && !m.deleted)
      .slice(-n)
      .map((m) => ({ from: m.from, nick: m.nick, color: m.color, ts: m.ts, msg: { id: m.id, text: m.text, ...(m.reply ? { reply: m.reply } : {}), ...(m.thread ? { thread: m.thread } : {}), mentions: m.mentions, links: m.links, ...(m.file ? { file: m.file } : {}) } }));
  }
}

/** Human-readable activity line: "moved 3 layers on Page 2" style, from a history label and counts. Pure. */
export function describeActivity(a) {
  const label = String(a.label || "Edit");
  const n = a.count || 1;
  const what = n === 1 ? "1 layer" : `${n} layers`;
  const where = a.pageName ? ` on ${a.pageName}` : "";
  return { label, what, where, text: `${label} · ${what}${where}` };
}
