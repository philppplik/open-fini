// Comments host: everything the comment threads of a document need from the app, WITHOUT the collaboration room code.
//
// Comments are local-first: they live in the document (`doc.comments`, saved in the .ofini, see docs/file-format.md)
// and work in every studio with or without a room. This module is the small, always-lazy controller behind the inline
// comment UI (comment-ui.js), the pins overlay (overlay.js), the Comments dock panel, the status bar count and the
// Vibe comment tools. The heavy collaboration runtime (runtime.js: sessions, transport, crypto, versions) is NOT
// imported here; when the user later joins a room the runtime attaches itself as `host.room`, after which comment ops
// are also broadcast and remote ops arrive through `host.applyRemote`.
//
// Public API
//   getComments(app) → CommentsHost (one per window; also `app.comments`)
//   host.threads(doc) / host.currentAnchor() / host.addThread(doc, anchor, text) / host.reply(doc, id, text)
//   host.setResolved(doc, id, on) / host.reanchor(doc, id, anchor) / host.commentOp(doc, op) / host.applyRemote(...)
//   host.commentUI() → inline comment UI api (lazy)       host.events (EventTarget "change", detail "comments"|…)
//   host.session / host.flash / host.myId / host.isMine(id) / host.profile()   (session is null without a room)
// Invariants: never imports runtime.js statically; every mutation goes through `commentOp` (one place that marks the
// document modified and, when a room is attached, broadcasts); comment text is cleaned (`cleanText`) and plain text.
import { t } from "../../i18n/index.js";
import { log } from "../../core/log.js";
import { applyCommentOp, newThread, normalizeThreads } from "../../collab/comments.js";
import { cleanText, parseMentions, COLORS, LIMITS, canDo } from "../../collab/protocol.js";
import { randomB64u } from "../../collab/crypto.js";

const AUTHOR_KEY = "openfini.collab.author";

/** A stable color for a nickname when the user has not chosen one. */
export function colorFor(nick) {
  let x = 0;
  for (const ch of String(nick || "")) x = (x * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[x % COLORS.length];
}

/** Random member id of this device (kept in localStorage) used as the author of local comments. */
export function localAuthorId() {
  try {
    let id = localStorage.getItem(AUTHOR_KEY);
    if (!/^[A-Za-z0-9_-]{22}$/.test(id || "")) {
      id = randomB64u(16);
      localStorage.setItem(AUTHOR_KEY, id);
    }
    return id;
  } catch {
    return randomB64u(16);
  }
}

export class CommentsHost {
  constructor(app) {
    this.app = app;
    this.room = null; // the collaboration controller once it is loaded (runtime.js sets it)
    this.events = new EventTarget();
    this.authorId = localAuthorId();
    this._normalized = new WeakSet();
    this._cui = null;
    app.comments = this;
    // pins, markers and the thread popover over the editors (lazy: the overlay loads the comment UI)
    if (typeof document !== "undefined") import("./overlay.js").then((m) => m.installOverlay(app, this)).catch((e) => log.error("comments", "Overlay failed to load", e));
  }

  get session() {
    return this.room?.session || null;
  }
  get flash() {
    return this.room?.flash || null;
  }
  get myId() {
    return this.room ? this.room.myId : this.authorId;
  }
  isMine(id) {
    return this.room ? this.room.isMine(id) : id === this.authorId;
  }
  profile() {
    if (this.room) return this.room.profile();
    const nick = this.app.prefs.collabNick || t("Guest");
    return { nick, color: this.app.prefs.collabColor || colorFor(nick) };
  }
  changed(what = "all") {
    this.events.dispatchEvent(new CustomEvent("change", { detail: what }));
  }

  /** Validated comment threads of a document (normalized once per document; broken entries are dropped). */
  threads(doc) {
    if (!doc) return [];
    if (!this._normalized.has(doc)) {
      doc.comments = normalizeThreads(doc.comments);
      this._normalized.add(doc);
    }
    return doc.comments;
  }

  /** Where a new comment goes: the code line, the Office selection, the selected layer, or the page. */
  currentAnchor() {
    const app = this.app;
    if (app.studio === "code") {
      const ed = app.codeUI?.editors;
      if (ed?.view && ed.active && app.codeUI.doc === app.doc) {
        const sel = ed.view.state.selection.main;
        const line = ed.view.state.doc.lineAt(sel.head);
        return { kind: "line", path: String(ed.active).slice(0, 512), line: line.number, quote: cleanText(line.text.trim(), 200) };
      }
    }
    // Office Suite apps: the mounted instance names its selection (docs/office-suite.md ▸ Comments)
    if (app.studio === "office" && typeof app.officeUI?.commentAnchor === "function") {
      const a = app.officeUI.commentAnchor();
      if (a?.kind) return a;
    }
    if (app.studio === "office" && app.officeUI?.editor) {
      const ed = app.officeUI.editor;
      const [a, b] = ed.range;
      const same = JSON.stringify(a.path) === JSON.stringify(b.path);
      let quote = "";
      try {
        quote = String(window.getSelection()?.toString() || "").slice(0, 200);
      } catch {
        /* no selection */
      }
      return { kind: "text", path: JSON.stringify(a.path).slice(0, 512), from: a.offset, to: same ? b.offset : a.offset, ...(quote ? { quote: cleanText(quote, 200) } : {}) };
    }
    const n = app.activeNode?._parent ? app.activeNode : null; // never the page root
    if (n) return { kind: "node", node: n.id, page: n._page?.id || app.page?.id, quote: cleanText(n.name || n.type, 200) };
    if (app.page) return { kind: "page", page: app.page.id, quote: cleanText(app.page.name || "", 200) };
    return { kind: "doc" };
  }

  author() {
    const p = this.session?.profile || this.profile();
    return { id: this.myId, nick: p.nick, color: p.color };
  }

  mentionsIn(text) {
    const s = this.session;
    if (!s) return [];
    return parseMentions(text, [...s.room.members.values()].filter((m) => m.profile).map((m) => ({ id: m.id, nick: m.profile.nick })));
  }

  /** Applies a local comment op, marks the document modified and sends it to the room (when there is one). */
  commentOp(doc, op) {
    const threads = this.threads(doc);
    if (!applyCommentOp(threads, op, { sender: this.myId, isHost: !!this.session?.isHost })) return false;
    this.dirty(doc);
    const s = this.session;
    if (s?.state === "open" && canDo(s.myRole, "comment")) s.comment(doc.id, op).catch((e) => log.warn("collab", e.message));
    return true;
  }

  dirty(doc) {
    doc.saved = false;
    doc.modifiedAt = Date.now();
    doc.rev++;
    doc.emit("change", { nodes: new Set(), structure: false, meta: true, label: "Comment" });
    this.app.emit("docs");
    this.changed("comments");
    this.app.requestOverlay?.();
  }

  /** Applies an op received from the room. Returns whether anything changed. */
  applyRemote(doc, op, sender, isHost) {
    if (!applyCommentOp(this.threads(doc), op, { sender, isHost })) return false;
    this.dirty(doc);
    return true;
  }

  addThread(doc, anchor, text) {
    const clean = cleanText(text, LIMITS.commentText).trim();
    if (!clean) throw new Error(t("The comment is empty."));
    const id = `c${randomB64u(9)}`;
    const thread = newThread({ id, anchor, author: this.author(), text: clean, ts: Date.now(), msgId: `${id}-0`, mentions: this.mentionsIn(clean) });
    this.commentOp(doc, { op: "add", thread });
    return thread;
  }

  /** Moves a thread's anchor (a dragged pin). Only the thread's author or the host may do this. */
  reanchor(doc, threadId, anchor) {
    return this.commentOp(doc, { op: "reanchor", threadId, anchor });
  }

  reply(doc, threadId, text) {
    const clean = cleanText(text, LIMITS.commentText).trim();
    if (!clean) throw new Error(t("The reply is empty."));
    const a = this.author();
    const mentions = this.mentionsIn(clean);
    const msg = { id: `m${randomB64u(9)}`, author: a.id, nick: a.nick, color: a.color, text: clean, ts: Date.now(), ...(mentions.length ? { mentions } : {}) };
    return this.commentOp(doc, { op: "reply", threadId, msg });
  }

  setResolved(doc, threadId, on) {
    return this.commentOp(doc, { op: on ? "resolve" : "reopen", threadId, text: (this.session?.profile || this.profile()).nick });
  }

  /** Shows what a thread points at: selects its layer / opens the page, or opens the code file at the line. */
  reveal(doc, th) {
    const app = this.app;
    const a = th.anchor;
    if (app.doc !== doc) app.activateDoc(doc);
    if (["node", "region", "page"].includes(a.kind)) {
      if (!["vector", "pixel", "layout"].includes(app.studio)) app.setStudio(["vector", "pixel", "layout"].includes(doc.studio) ? doc.studio : "vector");
      const page = doc.pages.find((p) => p.id === a.page) || doc.masters.find((p) => p.id === a.page);
      if (page) app.setActivePage(page);
      const n = a.kind === "node" ? doc.find(a.node) : null;
      if (n) app.select([n]);
    } else if (a.kind === "line" || a.kind === "element") {
      if (app.studio !== "code") app.setStudio("code");
      setTimeout(() => {
        try {
          const ed = app.codeUI?.editors;
          if (a.path && ed && ed.active !== a.path && typeof ed.open === "function") ed.open(a.path);
          const view = ed?.view;
          if (view && a.kind === "line") {
            const line = view.state.doc.line(Math.min(a.line || 1, view.state.doc.lines));
            view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
            view.focus();
          }
        } catch {
          /* best effort */
        }
      }, 120);
    }
    app.requestOverlay();
  }

  /** The inline comment UI (composer, thread popovers, pins, keyboard): loaded on first use, then shared. */
  commentUI() {
    this._cui ||= import("./comment-ui.js").then((m) => m.installCommentUI(this.app, this));
    return this._cui;
  }
}

/** The comments host of this window (created on first use; the collaboration runtime attaches to it later). */
export function getComments(app) {
  return app.comments || new CommentsHost(app);
}
