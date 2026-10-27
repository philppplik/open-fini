// Comment threads (Google-Docs-style): anchored threads with replies, edit, delete, resolve and reopen. Pure (no DOM).
//
// Comments live in the document (`doc.comments`, saved in document.json ▸ "comments", see docs/file-format.md) and
// work without any room. In a room every change is also broadcast as a `comment` op (protocol.js) and applied by the
// other members with `applyCommentOp`, which is idempotent (ids) and enforces authorship (only the author edits or
// deletes a message; any commenter may resolve/reopen; only the thread author or the host may drop a whole thread).
//
// Thread = { id, anchor, author, nick, color, ts, resolved?, resolvedBy?, resolvedAt?, messages: [Message] }
// Message = { id, author, nick, color, text, ts, edited?, deleted?, mentions? }
// Anchor = { kind: "doc"|"page"|"node"|"region"|"text"|"line"|"element", page?, node?, rect?, pin?, off?, elem?, path?, line?, endLine?, col?, endCol?, from?, to?, quote? }
//          (how each studio builds one: collab/anchors.js)
//
// Public API
//   newThread({ id, anchor, author, text, ts, msgId, mentions }) → Thread
//   applyCommentOp(threads, op, { sender, isHost }) → boolean (changed; `threads` is mutated in place)
//   normalizeThreads(json) → Thread[]          validated copy for loading documents (drops invalid entries)
//   filterThreads(threads, { status: "open"|"resolved"|"all", mine: memberId|null, anchorKind })
//   threadTitle(thread)                       short text for lists
import { validateThread, cleanText, LIMITS } from "./protocol.js";

export const MAX_THREADS = 2000;

export function newThread({ id, anchor, author, text, ts = Date.now(), msgId, mentions = [] }) {
  return {
    id,
    anchor,
    author: author.id,
    nick: author.nick,
    color: author.color,
    ts,
    resolved: false,
    messages: [{ id: msgId || `${id}-0`, author: author.id, nick: author.nick, color: author.color, text: cleanText(text, LIMITS.commentText), ts, ...(mentions.length ? { mentions } : {}) }],
  };
}

const findThread = (threads, id) => threads.find((t) => t.id === id) || null;

/**
 * Applies one comment op. `sender` is the member who sent it (or me for local ops).
 * @returns {boolean} whether anything changed
 */
export function applyCommentOp(threads, op, { sender, isHost = false } = {}) {
  switch (op.op) {
    case "add": {
      const t = op.thread;
      if (!t || findThread(threads, t.id) || threads.length >= MAX_THREADS) return false;
      if (t.author !== sender || t.messages.some((m) => m.author !== sender)) return false;
      threads.push(structuredCloneSafe(t));
      return true;
    }
    case "reply": {
      const t = findThread(threads, op.threadId);
      if (!t || !op.msg || op.msg.author !== sender || t.messages.some((m) => m.id === op.msg.id) || t.messages.length >= 200) return false;
      t.messages.push({ ...op.msg });
      if (t.resolved) {
        // replying reopens a resolved thread, like Google Docs
        t.resolved = false;
        delete t.resolvedBy;
        delete t.resolvedAt;
      }
      return true;
    }
    case "edit": {
      const t = findThread(threads, op.threadId);
      const m = t?.messages.find((x) => x.id === op.msgId);
      if (!m || m.author !== sender || m.deleted || typeof op.text !== "string") return false;
      m.text = op.text;
      m.edited = Date.now();
      return true;
    }
    case "delete": {
      const t = findThread(threads, op.threadId);
      const m = t?.messages.find((x) => x.id === op.msgId);
      if (!m || m.author !== sender || m.deleted) return false;
      m.deleted = true;
      m.text = "";
      return true;
    }
    case "resolve":
    case "reopen": {
      const t = findThread(threads, op.threadId);
      const want = op.op === "resolve";
      if (!t || !!t.resolved === want) return false;
      t.resolved = want;
      if (want) {
        t.resolvedBy = cleanText(op.text || "", LIMITS.nick);
        t.resolvedAt = Date.now();
      } else {
        delete t.resolvedBy;
        delete t.resolvedAt;
      }
      return true;
    }
    case "reanchor": {
      // dragging a pin to another place: only the thread's author or the host
      const t = findThread(threads, op.threadId);
      if (!t || !op.anchor || (t.author !== sender && !isHost)) return false;
      t.anchor = structuredCloneSafe(op.anchor);
      return true;
    }
    case "drop": {
      const i = threads.findIndex((t) => t.id === op.threadId);
      if (i < 0 || (threads[i].author !== sender && !isHost)) return false;
      threads.splice(i, 1);
      return true;
    }
    default:
      return false;
  }
}

function structuredCloneSafe(v) {
  return JSON.parse(JSON.stringify(v));
}

/** Validated copy of the `comments` section of a document (unknown or broken entries are dropped). */
export function normalizeThreads(json) {
  if (!Array.isArray(json)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of json.slice(0, MAX_THREADS)) {
    const r = validateThread(raw);
    if (r.ok && !seen.has(r.thread.id)) {
      seen.add(r.thread.id);
      out.push(r.thread);
    }
  }
  return out;
}

/** Threads matching a filter, newest activity first. */
export function filterThreads(threads, { status = "open", mine = null, anchorKind = null } = {}) {
  const last = (t) => t.messages.reduce((a, m) => Math.max(a, m.edited || m.ts), t.ts);
  return threads
    .filter((t) => (status === "all" ? true : status === "resolved" ? !!t.resolved : !t.resolved))
    .filter((t) => !mine || t.author === mine || t.messages.some((m) => m.author === mine || m.mentions?.includes(mine)))
    .filter((t) => !anchorKind || t.anchor.kind === anchorKind)
    .sort((a, b) => last(b) - last(a));
}

/** The first message's text, shortened, for list rows and markers. */
export function threadTitle(t) {
  const first = t.messages.find((m) => !m.deleted);
  const s = (first?.text || "").replace(/\s+/g, " ").trim();
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

/** Counts for the panel header. */
export function threadCounts(threads) {
  let open = 0;
  for (const t of threads) if (!t.resolved) open++;
  return { open, resolved: threads.length - open, all: threads.length };
}
