// Collaboration runtime (lazy: loaded by the collab.* commands on first use, never at start-up).
//
// One controller per window, available as `app.collab` once loaded. It owns the room session (collab/session.js) and
// connects it to the app: profile (Settings ▸ Profile and collaboration), comments stored in documents, named versions,
// presence from the canvas / code editor / office editor, the activity feed from document edits, received files,
// notifications (toast + title badge) and "follow". The UI lives in window.js (the floating Collaboration window) and
// overlay.js (cursors, selection halos, carets, comment markers).
//
// Public API (used by commands/collab.js, the Vibe tools in vibe/tools/collab.js and the settings section):
//   getCollab(app) → controller          openCollab(app, tab)   addComment(app, opts)   saveVersionDialog(app, opts)
//   shareDoc(app)   leaveRoom(app)   shareDocument(app, {doc, mode})   stopSharing(app, {doc})   resyncDocument(app, {doc})
//   controller: .session .profile() .createRoom({relay, defaultRole}) .joinRoom(code) .leave()
//     .shareFlow(doc, mode) .live() → live-document manager (live.js) .liveStatus(doc)
//     .threads(doc) .commentOp(doc, op) .addThread(doc, anchor, text) .reply(doc, threadId, text) .setResolved(doc, id, on)
//     .versions .saveVersion(doc, {name, note, auto, reason}) .restoreVersion(id, {inPlace}) .sendVersion(id)
//     .follow(memberId|null) .jump(link) .status()
// Invariants: invite codes and secrets are never logged or stored; every received file needs a click before it is
// opened or saved; nothing here runs before the user opens Collaboration.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { log } from "../../core/log.js";
import { kvGet, kvSet, kvDelete } from "../../core/storage.js";
import { saveOfini, loadOfini } from "../../core/ofini.js";
import { markUntrusted } from "../../core/security.js";
import { dlState } from "../../engine/dl.js";
import { platform } from "../../platform/index.js";
import { CollabSession, normalizeProfile } from "../../collab/session.js";
import { createTransport } from "../../collab/transport.js";
import { getComments, colorFor as hostColorFor } from "./comments-host.js";
import { createVersionStore } from "../../collab/versions.js";
import { createThrottle, followTarget } from "../../collab/presence.js";
import { cleanText, LIMITS, canDo } from "../../collab/protocol.js";
import { randomB64u } from "../../collab/crypto.js";
import { confirmDialog, openDialog } from "../dialogs.js";

const AVATAR_KEY = "collab.avatar";
const CANVAS_STUDIOS = ["vector", "pixel", "layout"];

let controller = null;

/** The controller of this window (created on first use). */
export function getCollab(app) {
  if (!controller) controller = new CollabController(app);
  return controller;
}

export async function openCollab(app, tab) {
  const c = getCollab(app);
  await c.ready;
  if (c.poppedOut && (await import("./remote-host.js")).noteIfPoppedOut(app, c)) return; // the UI lives in its own window
  (await import("./window.js")).showCollabWindow(app, c, tab);
}

/** Moves the Collaboration UI into its own OS window (UI-only remote view; this window keeps the connection). */
export async function popOutCollab(app) {
  const c = getCollab(app);
  await c.ready;
  return (await import("./remote-host.js")).popOut(app, c);
}

export async function addComment(app, opts = {}) {
  const c = getCollab(app);
  await c.ready;
  if (!app.doc) return;
  const w = (await import("./window.js")).showCollabWindow(app, c, "comments");
  w.startComment(opts.anchor || c.currentAnchor(), opts.text);
}

/**
 * "Add comment here…": builds the anchor from where the user clicked (`opts.kind/x/y/data/selection` of a context menu
 * target, or nothing: the current selection) and opens the inline composer there. Works without a room.
 */
export async function addCommentHere(app, opts = {}) {
  const c = getCollab(app);
  await c.ready;
  if (!app.doc) return;
  const ui = await c.commentUI();
  ui.composeFor(opts);
}

export async function saveVersionDialog(app, opts = {}) {
  const c = getCollab(app);
  await c.ready;
  if (!app.doc) return;
  if (opts.name !== undefined) return c.saveVersion(app.doc, opts);
  (await import("./window.js")).showCollabWindow(app, c, "versions").startSaveVersion();
}

export async function shareDoc(app) {
  const c = getCollab(app);
  await c.ready;
  return c.shareDoc(app.doc);
}

/** "How to start a relay" (copyable commands). */
export async function relayHelp(app) {
  return (await import("./network.js")).relayHelpDialog(app);
}

/** Opens the join form with an invite code from a join link (…/#join=<code>); the user still confirms. */
export async function openJoin(app, code) {
  const c = getCollab(app);
  await c.ready;
  c.prefillInvite = String(code || "").trim().slice(0, 600);
  await openCollab(app, "people");
}

/** Share a document with the room (`mode` "live" | "copy" | undefined = ask). Starts the room flow when needed. */
export async function shareDocument(app, { doc = app.doc, mode } = {}) {
  const c = getCollab(app);
  await c.ready;
  return c.shareFlow(doc, mode);
}

/** Stop sharing (owner) or leave the live session (others) of a document. */
export async function stopSharing(app, { doc = app.doc } = {}) {
  const c = getCollab(app);
  if (doc) return (await c.live()).stop(doc.id);
}

/** Ask for the current state of a live document again. */
export async function resyncDocument(app, { doc = app.doc } = {}) {
  const c = getCollab(app);
  if (doc) return (await c.live()).resync(doc.id);
}

export async function leaveRoom(app) {
  const c = getCollab(app);
  if (!c.session) return;
  if (!(await confirmDialog({ title: "Leave room", message: "Leave this collaboration room? Your documents stay open on this device.", ok: "Leave" }))) return;
  await c.leave();
}

/** A stable color for a nickname when the user has not chosen one. */
export const colorFor = hostColorFor;

class CollabController {
  constructor(app) {
    this.app = app;
    this.session = null;
    this.avatar = "";
    this.followId = null;
    this.flash = null; // { ids, until } nodes highlighted by an activity "Show"
    this.transfers = new Map(); // fid → progress for the UI
    this.received = new Map(); // fid → { transfer, bytes } kept until the user opens, saves or dismisses it
    this.versions = createVersionStore({ get: kvGet, set: kvSet, del: kvDelete });
    this.host = getComments(app); // comments work without this runtime; the host broadcasts through us once we are loaded
    this.host.room = this;
    this.authorId = this.host.authorId;
    this.events = this.host.events;
    app.collab = this;
    this.ready = kvGet(AVATAR_KEY).then((v) => {
      if (typeof v === "string" && v.length <= LIMITS.avatarChars) this.avatar = v;
    });
    this.#installHooks();
  }

  /** Notifies the UI (window, overlay, settings) that something changed. */
  changed(what = "all") {
    this.events.dispatchEvent(new CustomEvent("change", { detail: what }));
  }

  // ------------------------------------------------------------------ identity

  profile() {
    const nick = this.app.prefs.collabNick || t("Guest");
    return normalizeProfile({ nick, color: this.app.prefs.collabColor || colorFor(nick), avatar: this.avatar || undefined });
  }

  /** Stores the avatar (data URL of a ≤128 px image) on this device only. "" removes it. */
  async setAvatar(dataUrl) {
    this.avatar = dataUrl || "";
    if (dataUrl) await kvSet(AVATAR_KEY, dataUrl);
    else await kvDelete(AVATAR_KEY);
    this.session?.updateProfile(this.profile()).catch(() => {});
    this.changed("profile");
  }

  profileChanged() {
    this.session?.updateProfile(this.profile()).catch(() => {});
    this.changed("profile");
  }

  /** The member id my comments carry: the session id in a room, otherwise a random id kept on this device. */
  get myId() {
    return this.session && this.session.state !== "left" ? this.session.id : this.authorId;
  }
  isMine(id) {
    return id === this.authorId || (this.session && id === this.session.id);
  }

  // ------------------------------------------------------------------ rooms

  #factory = (relay) => createTransport(relay);

  async createRoom({ relay = "local", defaultRole = "editor" } = {}) {
    if (relay !== "local") this.app.network.assert("collab", relay);
    await this.leave(true);
    const s = await CollabSession.create({ relay, profile: this.profile(), defaultRole, transportFactory: this.#factory, log });
    await this.#start(s);
    if (relay !== "local") this.app.setPref("collabRelay", relay);
    log.info("collab", `Created a room on ${s.relayHost}`);
    return s;
  }

  async joinRoom(code) {
    const s = await CollabSession.join({ invite: code, profile: this.profile(), transportFactory: this.#factory, log });
    if (s.invite.relay !== "local") this.app.network.assert("collab", s.invite.relay);
    await this.leave(true);
    await this.#start(s);
    log.info("collab", `Joined a room on ${s.relayHost}`);
    return s;
  }

  async #start(s) {
    this.session = s;
    this.#wireSession(s);
    this.changed("status");
    try {
      await s.start();
    } catch (e) {
      this.session = null;
      this.changed("status");
      throw e;
    }
    this.sendPresence();
    this.changed("status");
    // "Share with collaboration room…" started before there was a room: share now
    const ps = this.pendingShare;
    this.pendingShare = null;
    if (ps && this.app.docs.includes(ps.doc)) setTimeout(() => this.shareFlow(ps.doc, ps.mode).catch((e) => this.app.toast(e.message, "danger", 5000)), 300);
  }

  // ------------------------------------------------------------------ shared documents ("Edit together", beta)

  /** The live-document manager (ui/collab/live.js), loaded on first use. */
  async live() {
    if (!this.liveMgr) this.liveMgr = (await import("./live.js")).getLive(this);
    return this.liveMgr;
  }

  #liveQ = Promise.resolve();
  /** Hands session events to live.js strictly in arrival order (the module loads lazily). */
  #live(event, payload) {
    this.#liveQ = this.#liveQ.then(async () => (await this.live()).handle(event, payload)).catch((e) => log.warn("collab", `Live editing: ${e.message}`));
    return this.#liveQ;
  }

  /** Sharing status of a document without loading anything (false until live.js was used). */
  liveStatus(doc) {
    return this.liveMgr ? this.liveMgr.status(doc) : { shared: false };
  }

  /**
   * Shares a document with the room. `mode`: "live" (linked, Edit together beta), "copy" (snapshot) or undefined
   * (asks). Without a room, opens the start/join panel first and shares once a room is ready.
   */
  async shareFlow(doc = this.app.doc, mode) {
    if (!doc) return;
    if (!this.session || this.session.state !== "open") {
      this.pendingShare = { doc, mode };
      await openCollab(this.app, "people");
      this.app.toast(t("Create or join a room: “{name}” is shared as soon as you are in.", { name: doc.name }), "primary", 5000);
      return;
    }
    if (!mode) {
      const kind = doc.web ? "text" : doc.office ? "office" : "tree";
      const choice = await confirmDialog({
        title: "Share with collaboration room",
        message: kind === "office" ? t("Share “{name}” with the room as a copy? Office documents are not edited live yet.", { name: doc.name }) : t("Share “{name}” with the room? A linked live document is edited together by everyone with the Editor role (beta); a copy is a snapshot others can open on their own.", { name: doc.name }),
        ok: kind === "office" ? "Share a copy" : "Share live",
        extra: kind === "office" ? undefined : "Share a copy",
      });
      if (!choice) return;
      mode = choice === true && kind !== "office" ? "live" : "copy";
    }
    return (await this.live()).share(doc, mode);
  }

  async leave(quiet = false) {
    const s = this.session;
    if (!s) return;
    if (this.liveMgr) await this.liveMgr.handle("left", {});
    this.session = null;
    this.followId = null;
    this.presenceThrottle?.cancel();
    await s.leave().catch(() => {});
    this.received.clear();
    this.transfers.clear();
    this.#titleBadge();
    this.changed("status");
    this.app.requestOverlay();
    if (!quiet) this.app.toast("You left the room.", "neutral", 2400);
  }

  status() {
    const s = this.session;
    if (!s) return { connected: false };
    return { connected: s.state === "open", ...s.status(), fingerprint: s.fingerprint, members: s.members.length + 1, me: s.id };
  }

  #wireSession(s) {
    const app = this.app;
    s.on("status", () => {
      this.changed("status");
      if (s.state === "closed" && this.session === s) app.toast("The connection to the room was lost.", "warning", 6000);
    });
    s.on("members", () => {
      this.changed("members");
      app.requestOverlay();
    });
    s.on("chat", () => {
      this.changed("chat");
      this.#titleBadge();
    });
    s.on("notify", ({ kind, message }) => {
      if (!app.prefs.collabNotify) return;
      const text = kind === "mention" ? t("{name} mentioned you: {text}", { name: message.nick, text: message.text.slice(0, 80) }) : t("{name} replied: {text}", { name: message.nick, text: message.text.slice(0, 80) });
      app.toast(text, "primary", 6000, { label: t("Open chat"), run: () => openCollab(app, "chat") });
    });
    s.on("presence", ({ member }) => {
      app.requestOverlay();
      if (member && member.id === this.followId) this.#applyFollow(member);
      this.changed("presence");
    });
    s.on("comment", ({ doc, op, sender, isHost }) => this.#remoteComment(doc, op, sender, isHost));
    s.on("file-progress", ({ transfer }) => {
      this.transfers.set(transfer.fid, { fid: transfer.fid, name: transfer.name, size: transfer.size, done: transfer.sent ?? transfer.received ?? 0, outgoing: !!transfer.outgoing, failed: transfer.failed, from: transfer.from });
      this.changed("files");
    });
    s.on("file", ({ transfer, bytes }) => {
      this.transfers.delete(transfer.fid);
      if (transfer.purpose === "live") {
        // a live-document snapshot this window asked for (ui/collab/live.js checks that it did)
        this.changed("files");
        return this.#live("file", { transfer, bytes });
      }
      this.received.set(transfer.fid, { transfer, bytes });
      this.changed("files");
    });
    // shared documents and "Edit together" (beta): handled in order by the lazily loaded live.js
    for (const ev of ["share", "live", "op"]) s.on(ev, (p) => this.#live(ev, p));
    s.on("members", () => this.liveMgr && this.#live("members", {}));
    s.on("removed", ({ rotated } = {}) => {
      this.session = null;
      if (this.liveMgr) this.#live("left", {});
      this.changed("status");
      app.toast(rotated ? t("The room key changed while you were away. Ask the host for a new invite code.") : t("The host removed you from the room."), "warning", 8000);
    });
    s.on("rotated", () => {
      this.changed("status");
      app.toast("The room key was changed. Compare the new verification words with the others.", "primary", 6000);
    });
    s.on("error", ({ error }) => log.warn("collab", error?.message || "Room error"));
  }

  // ------------------------------------------------------------------ hooks into the app

  #installHooks() {
    const app = this.app;
    // presence: pointer on the canvas, selection, page, studio, tool, view
    this.presenceThrottle = createThrottle((p) => this.session?.presence(p).catch(() => {}), { perSecond: LIMITS.presencePerSecond });
    this.pointer = null;
    const onMove = (e) => {
      if (!this.session || !app.doc || !app.view) return;
      const r = app.cv.stage.getBoundingClientRect();
      const [x, y] = app.screenToPage(e.clientX - r.left, e.clientY - r.top);
      this.pointer = { x, y };
      this.sendPresence();
    };
    const attach = () => {
      if (!app.cv?.stage || app.cv.stage.dataset.collab) return;
      app.cv.stage.dataset.collab = "1";
      app.cv.stage.addEventListener("pointermove", onMove, { passive: true });
      // manual navigation stops "follow"
      app.cv.stage.addEventListener("wheel", () => this.followId && this.follow(null, true), { passive: true });
      app.cv.stage.addEventListener("pointerdown", () => this.followId && this.follow(null, true));
    };
    attach();
    for (const ev of ["selection", "page", "studio", "tool", "doc", "view"]) app.on(ev, () => (attach(), this.sendPresence()));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.followId) this.follow(null, true);
    });
    // code and office carets: poll cheaply while in a room (their editors have no shared event hub)
    this.caretTimer = setInterval(() => {
      if (this.session && (app.studio === "code" || app.studio === "office")) this.sendPresence();
    }, 400);
    // activity feed from local edits
    this.pendingActivity = null;
    app.on("docchange", (ev) => this.#onDocChange(ev));
    // the title badge survives the shell's own title updates
    for (const ev of ["doc", "docs", "docchange"]) app.on(ev, () => setTimeout(() => this.#titleBadge(), 0));
  }

  /** The presence payload of this window right now. */
  presencePayload() {
    const app = this.app;
    const doc = app.doc;
    const p = { studio: app.studio };
    if (!doc) return p;
    p.doc = doc.id;
    p.docName = cleanText(doc.name, LIMITS.docName);
    if (CANVAS_STUDIOS.includes(app.studio) && app.page) {
      p.page = app.page.id;
      if (this.pointer) Object.assign(p, { x: round(this.pointer.x), y: round(this.pointer.y) });
      p.sel = app.selection.slice(0, LIMITS.ids).map((n) => n.id);
      if (app.tool?.id) p.tool = String(app.tool.id).slice(0, 40);
      const v = app.view?.visibleRect?.();
      if (v && Number.isFinite(v.w)) p.view = { x: round(v.x), y: round(v.y), w: round(Math.max(0, v.w)), h: round(Math.max(0, v.h)) };
    } else if (app.studio === "code" && app.codeUI?.editors?.view && app.codeUI.doc === doc) {
      const ed = app.codeUI.editors;
      const head = ed.view.state.selection.main.head;
      const line = ed.view.state.doc.lineAt(head);
      if (ed.active) p.caret = { path: String(ed.active).slice(0, 512), line: line.number, ch: head - line.from };
    } else if (app.studio === "office" && app.officeUI?.editor && app.officeUI.doc === doc) {
      const sel = app.officeUI.editor.sel;
      if (sel?.focus) {
        const [a, b] = app.officeUI.editor.range;
        const path = JSON.stringify(sel.focus.path).slice(0, 512);
        p.caret = { path, from: sel.focus.offset, ...(JSON.stringify(a.path) === JSON.stringify(b.path) && a.offset !== b.offset ? { from: a.offset, to: b.offset } : {}) };
      }
    }
    return p;
  }

  sendPresence() {
    if (!this.session || this.session.state !== "open") return;
    const p = this.presencePayload();
    const key = JSON.stringify(p);
    if (key === this.lastPresence) return;
    this.lastPresence = key;
    this.presenceThrottle.push(p);
  }

  #onDocChange(ev) {
    const s = this.session;
    if (!s || s.state !== "open" || this.applyingRemote || !this.app.prefs.collabActivity || !canDo(s.myRole, "activity")) return;
    if (!ev || ev.label === "Comment" || !ev.label) return;
    const doc = this.app.doc;
    const ids = [...(ev.nodes || [])].map((n) => n?.id).filter(Boolean);
    const label = cleanText(ev.history ? t("Undo/Redo: {label}", { label: t(ev.label) }) : t(ev.label), LIMITS.label);
    const pa = this.pendingActivity;
    if (pa && pa.doc === doc.id && pa.label === label) {
      pa.count += Math.max(1, ids.length);
      pa.nodes = [...new Set([...pa.nodes, ...ids])].slice(0, LIMITS.ids);
    } else {
      this.#flushActivity();
      const page = this.app.page;
      this.pendingActivity = { doc: doc.id, docName: cleanText(doc.name, LIMITS.docName), label, count: Math.max(1, ids.length), nodes: ids.slice(0, LIMITS.ids), ...(page ? { page: page.id, pageName: cleanText(page.name || "", LIMITS.label) } : {}) };
    }
    clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => this.#flushActivity(), 1500);
  }

  #flushActivity() {
    const a = this.pendingActivity;
    this.pendingActivity = null;
    if (a && this.session?.state === "open") this.session.activity(a).catch(() => {});
  }

  #titleBadge() {
    const n = this.session ? this.session.chatStore.unreadMentions : 0;
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = n ? `(${n}) ${base}` : base;
    const btn = document.querySelector('[data-cmd="collab.open"]');
    const unread = this.session ? this.session.chatStore.unread : 0;
    if (btn) {
      if (unread) btn.setAttribute("data-badge", unread > 99 ? "99+" : String(unread));
      else btn.removeAttribute("data-badge");
      btn.classList.toggle("of-collab-live", !!this.session);
    }
  }

  markRead() {
    this.session?.chatStore.markRead();
    this.#titleBadge();
  }

  // ------------------------------------------------------------------ follow

  follow(id, manual = false) {
    this.followId = id && this.session?.member(id) ? id : null;
    if (this.followId) {
      const m = this.session.member(this.followId);
      if (m?.presence) this.#applyFollow(m);
      this.app.toast(t("Following {name}. Press Esc or move the canvas to stop.", { name: m?.profile?.nick || "?" }), "primary", 3000);
    } else if (manual) this.app.toast("Stopped following.", "neutral", 1500);
    this.changed("members");
  }

  #applyFollow(m) {
    const app = this.app;
    const p = m.presence;
    if (!p) return;
    if (p.studio && p.studio !== app.studio && p.studio !== "vibe") app.setStudio(p.studio);
    const doc = p.doc && app.docs.find((d) => d.id === p.doc);
    if (!doc) return;
    if (app.doc !== doc) app.activateDoc(doc);
    if (CANVAS_STUDIOS.includes(app.studio)) {
      const page = p.page && (doc.pages.find((pg) => pg.id === p.page) || doc.masters.find((pg) => pg.id === p.page));
      if (page && app.page !== page) app.setActivePage(page);
      const v = app.view;
      const target = followTarget(p.view, { w: v?.w, h: v?.h });
      if (v && target) {
        v.zoom = target.zoom;
        v.panX = v.w / 2 - target.cx * target.zoom;
        v.panY = v.h / 2 - target.cy * target.zoom;
        app.emit("view");
        app.requestOverlay();
      }
    } else if (app.studio === "code" && p.caret?.path && app.codeUI?.editors) {
      const ed = app.codeUI.editors;
      try {
        if (ed.active !== p.caret.path && typeof ed.open === "function") ed.open(p.caret.path);
        const view = ed.view;
        const line = view && Math.min(p.caret.line || 1, view.state.doc.lines);
        // scroll only: the follower's own cursor and selection stay where they are
        if (view && line && typeof view.constructor.scrollIntoView === "function") view.dispatch({ effects: view.constructor.scrollIntoView(view.state.doc.line(line).from, { y: "center" }) });
      } catch {
        /* the file may not exist here */
      }
    }
  }

  // ------------------------------------------------------------------ links and jumps

  /** A link to the current selection (or page) for the chat. */
  selectionLink() {
    const app = this.app;
    const doc = app.doc;
    if (!doc) return null;
    if (CANVAS_STUDIOS.includes(app.studio)) {
      const n = app.activeNode?._parent ? app.activeNode : null; // never the page root
      if (n) return { kind: "node", doc: doc.id, id: n.id, page: n._page?.id || app.page?.id, label: cleanText(n.name || n.type, LIMITS.label) };
      if (app.page) return { kind: "page", doc: doc.id, id: app.page.id, page: app.page.id, label: cleanText(app.page.name || t("Page"), LIMITS.label) };
    }
    if (app.studio === "code") {
      const pr = this.presencePayload();
      if (pr.caret?.path) return { kind: "line", doc: doc.id, id: pr.caret.path, line: pr.caret.line, label: `${pr.caret.path.split("/").pop()}:${pr.caret.line}` };
    }
    return null;
  }

  /** Jumps to a link (selects the layer, shows the page, opens the file at the line). */
  jump(link) {
    const app = this.app;
    const doc = app.docs.find((d) => d.id === link.doc);
    if (!doc) {
      app.toast("That document is not open in this window.", "warning", 3000);
      return false;
    }
    if (app.doc !== doc) app.activateDoc(doc);
    if (link.kind === "node" || link.kind === "page") {
      if (!CANVAS_STUDIOS.includes(app.studio)) app.setStudio(CANVAS_STUDIOS.includes(doc.studio) ? doc.studio : "vector");
      const page = doc.pages.find((p) => p.id === (link.page || link.id)) || doc.masters.find((p) => p.id === (link.page || link.id));
      if (page) app.setActivePage(page);
      if (link.kind === "node") {
        const n = doc.find(link.id);
        if (!n) {
          app.toast("That layer no longer exists.", "warning", 2500);
          return false;
        }
        app.select([n]);
        requestAnimationFrame(() => {
          try {
            app.cv?.fitSelection?.();
          } catch {
            /* layers without bounds (empty groups) stay where they are */
          }
        });
      }
      return true;
    }
    if (link.kind === "line") {
      app.setStudio("code");
      setTimeout(() => {
        const ed = app.codeUI?.editors;
        try {
          if (ed && ed.active !== link.id && typeof ed.open === "function") ed.open(link.id);
          const view = ed?.view;
          if (view) {
            const line = view.state.doc.line(Math.min(link.line || 1, view.state.doc.lines));
            view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
            view.focus();
          }
        } catch {
          /* best effort */
        }
      }, 120);
      return true;
    }
    return false;
  }

  /** Briefly highlights layers (activity "Show"), without selecting or changing anything. */
  preview(docId, ids) {
    const app = this.app;
    const doc = app.docs.find((d) => d.id === docId);
    if (!doc) return app.toast("That document is not open in this window.", "warning", 3000);
    if (app.doc !== doc) app.activateDoc(doc);
    const nodes = ids.map((id) => doc.find(id)).filter(Boolean);
    if (!nodes.length) return app.toast("Those layers no longer exist.", "warning", 2500);
    const page = nodes[0]._page;
    if (page && app.page !== page) app.setActivePage(page);
    this.flash = { ids: new Set(ids), until: Date.now() + 2500 };
    app.requestOverlay();
    setTimeout(() => app.requestOverlay(), 2600);
  }

  // ------------------------------------------------------------------ comments

  /** Validated comment threads of a document (normalized once per document). */
  threads(doc) {
    return this.host.threads(doc);
  }

  /** Where a new comment goes: the selected layer, the code line, the office selection, or the page. */
  currentAnchor() {
    return this.host.currentAnchor();
  }

  /** Applies a local comment op, saves it in the document and sends it to the room. */
  commentOp(doc, op) {
    return this.host.commentOp(doc, op);
  }

  #remoteComment(docId, op, sender, isHost) {
    const doc = this.app.docs.find((d) => d.id === docId);
    if (!doc) return;
    if (this.host.applyRemote(doc, op, sender, isHost)) {
      const mentioned = (op.thread?.messages?.[0]?.mentions || op.msg?.mentions || []).includes(this.session?.id);
      if (mentioned && this.app.prefs.collabNotify) {
        const who = this.session.member(sender)?.profile?.nick || "?";
        this.app.toast(t("{name} mentioned you in a comment.", { name: who }), "primary", 6000, { label: t("Show"), run: () => openCollab(this.app, "comments") });
      }
    }
  }

  addThread(doc, anchor, text) {
    return this.host.addThread(doc, anchor, text);
  }

  /** Moves a thread's anchor (a dragged pin). Only the thread's author or the host may do this. */
  reanchor(doc, threadId, anchor) {
    return this.host.reanchor(doc, threadId, anchor);
  }

  /** The inline comment UI (composer, thread popovers, pins, keyboard): loaded on first use, then shared. */
  commentUI() {
    return this.host.commentUI();
  }

  reply(doc, threadId, text, as) {
    return this.host.reply(doc, threadId, text, as);
  }

  setResolved(doc, threadId, on, by) {
    return this.host.setResolved(doc, threadId, on, by);
  }

  // ------------------------------------------------------------------ versions

  async saveVersion(doc, { name = "", note = "", auto = false, reason } = {}) {
    const bytes = await saveOfini(doc);
    const meta = await this.versions.add({ docId: doc.id, docName: doc.name, name: name || (auto ? t("Automatic snapshot") : new Date().toLocaleString()), note, author: (this.session?.profile || this.profile()).nick, auto, reason, bytes, thumb: await thumbOf(bytes) });
    this.changed("versions");
    return meta;
  }

  /** Restores a version as a new document (copy) or into its document as one undoable step. */
  async restoreVersion(id, { inPlace = false } = {}) {
    const app = this.app;
    const meta = await this.versions.get(id);
    const bytes = meta && (await this.versions.bytes(id));
    if (!bytes) throw new Error(t("This version is no longer stored on this device."));
    const restored = await loadOfini(bytes);
    const target = inPlace && app.docs.find((d) => d.id === meta.docId);
    if (target && canRestoreInPlace(target) && canRestoreInPlace(restored)) {
      await this.saveVersion(target, { auto: true, reason: "restore", name: t("Before restoring “{name}”", { name: meta.name }) });
      replaceContents(target, restored, t("Restore Version"));
      if (app.doc !== target) app.activateDoc(target);
      app.toast(t("Restored “{name}”. Undo brings the previous state back.", { name: meta.name }), "success", 4000);
      return target;
    }
    restored.id = `d_${randomB64u(6)}`;
    restored.name = t("{name} (version {version})", { name: meta.docName || restored.name, version: meta.name });
    restored.saved = false;
    markUntrusted(app.prefs, restored);
    app.setStudio(["pixel", "layout", "code", "office"].includes(restored.studio) ? restored.studio : "vector");
    app.openDoc(restored);
    requestAnimationFrame(() => app.cv?.fitPage?.());
    if (inPlace) app.toast("This kind of document is restored as a copy.", "primary", 3500);
    return restored;
  }

  async sendVersion(id) {
    const s = this.#requireRoom("file-offer");
    const meta = await this.versions.get(id);
    const bytes = meta && (await this.versions.bytes(id));
    if (!bytes) throw new Error(t("This version is no longer stored on this device."));
    await s.sendFile(bytes, { name: `${meta.docName || "Document"} - ${meta.name}.ofini`, purpose: "version", doc: meta.docId, note: meta.note || meta.name });
    await s.chat(t("Shared the version “{name}” of {doc}.", { name: meta.name, doc: meta.docName }), {}).catch(() => {});
  }

  // ------------------------------------------------------------------ files and documents

  #requireRoom(type) {
    const s = this.session;
    if (!s || s.state !== "open") throw new Error(t("Join or create a room first."));
    if (type && !canDo(s.myRole, type)) throw new Error(t("Your role in this room does not allow this."));
    return s;
  }

  async shareDoc(doc) {
    if (!doc) return;
    const s = this.#requireRoom("file-offer");
    const bytes = await saveOfini(doc);
    const name = `${(doc.name || "Document").replace(/[\\/:*?"<>|]+/g, "_")}.ofini`;
    const info = await s.sendFile(bytes, { name, purpose: "doc", doc: doc.id, note: doc.name });
    await s.chat("", { file: { fid: info.fid, name: info.name, mime: info.mime, size: info.size } }).catch(() => {});
    this.app.toast(t("Shared “{name}” with the room.", { name: doc.name }), "success", 2500);
  }

  async sendFile(file) {
    const s = this.#requireRoom("file-offer");
    const info = await s.sendFile(file.bytes, { name: file.name });
    await s.chat("", { file: { fid: info.fid, name: info.name, mime: info.mime, size: info.size } });
  }

  /** Opens a received file after the user confirmed. `mode`: "copy" | "linked" | "replace" (documents). */
  async openReceived(fid, mode = "copy") {
    const app = this.app;
    const r = this.received.get(fid);
    if (!r) return;
    const { transfer, bytes } = r;
    if (transfer.ext === "ofini") {
      const doc = await loadOfini(bytes);
      const open = app.docs.find((d) => d.id === doc.id);
      if (mode === "replace" && open) {
        await this.saveVersion(open, { auto: true, reason: "remote", name: t("Before update from {name}", { name: this.session?.member(transfer.from)?.profile?.nick || "?" }) });
        if (canRestoreInPlace(open) && canRestoreInPlace(doc)) {
          replaceContents(open, doc, t("Update from Room"));
          app.activateDoc(open);
          return open;
        }
      }
      if (mode === "linked" && open) {
        app.activateDoc(open);
        app.toast("This document is already open. Use “Update my copy” to replace it with the received one.", "primary", 5000);
        return open;
      }
      if (mode === "copy") doc.id = `d_${randomB64u(6)}`;
      if (!doc.name || doc.name === "Untitled") doc.name = transfer.name.replace(/\.ofini$/i, "");
      doc.saved = false;
      markUntrusted(app.prefs, doc);
      app.setStudio(["pixel", "layout", "code", "office"].includes(doc.studio) ? doc.studio : "vector");
      app.openDoc(doc);
      requestAnimationFrame(() => app.cv?.fitPage?.());
      return doc;
    }
    // every other allowed type goes through the normal Open router (images are decoded again, website scripts stay off)
    return app.openFile({ name: transfer.name, bytes });
  }

  async saveReceived(fid) {
    const r = this.received.get(fid);
    if (!r) return;
    await platform.saveFile({ suggestedName: r.transfer.name, bytes: r.bytes, mime: r.transfer.mime, filters: [{ name: r.transfer.ext.toUpperCase(), extensions: [r.transfer.ext] }] });
  }

  dismissReceived(fid) {
    this.received.delete(fid);
    this.changed("files");
  }
}

// ------------------------------------------------------------------ helpers

const round = (v) => Math.round(v * 10) / 10;

async function thumbOf(bytes) {
  try {
    const { unzipSync } = await import("../../../vendor/fflate/fflate.js");
    const e = unzipSync(bytes, { filter: (f) => f.name === "thumbnail.png" });
    return e["thumbnail.png"] || null;
  } catch {
    return null;
  }
}

/** Website and Office projects keep live editor state, so they are restored as copies. */
const canRestoreInPlace = (doc) => !doc.web && !doc.office;

const SWAP = ["pages", "masters", "stories", "styles", "swatches", "slices", "tableStyles", "assets", "pixels", "settings", "comments"];
/** Replaces the content of `target` with `source` as ONE undoable step (Edit ▸ Undo brings the old content back). */
function replaceContents(target, source, label) {
  const next = Object.fromEntries(SWAP.map((k) => [k, source[k]]));
  const prev = Object.fromEntries(SWAP.map((k) => [k, target[k]]));
  const apply = (v) => {
    for (const k of SWAP) target[k] = v[k];
    target.relink();
    dlState.version++;
  };
  target.tx(label, () => target._do({ redo: () => apply(next), undo: () => apply(prev), structure: true, meta: true, bytes: 1024 * 1024 }));
}

// Avatars from other members are untrusted images: they are decoded and drawn again into a fresh 64 px PNG before they
// are shown, so only plain pixels reach the page (no metadata, no unusual encodings). Until then initials are shown.
const safeAvatars = new Map(); // received data URL → re-encoded data URL ("" when it failed)
async function reencodeAvatar(url) {
  try {
    const blob = await (await fetch(url)).blob();
    if (blob.size > LIMITS.avatarChars || !/^image\/(png|webp|jpeg)$/.test(blob.type)) throw new Error("bad avatar");
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const s = Math.max(64 / bmp.width, 64 / bmp.height);
    c.getContext("2d").drawImage(bmp, (64 - bmp.width * s) / 2, (64 - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    bmp.close?.();
    return c.toDataURL("image/png");
  } catch {
    return "";
  }
}

/** Renders a small avatar (initials or image) for a profile. `own` marks my own avatar (already re-encoded when set). */
export function avatarEl(profile, size = 28, { own = false, onReady } = {}) {
  const p = profile || {};
  const el = h("span.of-collab-avatar", { style: `--of-collab-color:${/^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color : "#888888"};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`, "aria-hidden": "true" });
  el.textContent = p.initials || "?";
  if (p.avatar) {
    const show = (src) => src && el.replaceChildren(h("img", { src, alt: "", draggable: "false" }));
    if (own) show(p.avatar);
    else if (safeAvatars.has(p.avatar)) show(safeAvatars.get(p.avatar));
    else {
      safeAvatars.set(p.avatar, "");
      reencodeAvatar(p.avatar).then((src) => {
        if (safeAvatars.size > 200) safeAvatars.clear();
        safeAvatars.set(p.avatar, src);
        show(src);
        onReady?.();
      });
    }
  }
  return el;
}

export { openDialog };
