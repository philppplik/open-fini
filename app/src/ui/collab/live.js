// Shared documents and "Edit together" (beta). Lazy: loaded by the collaboration runtime on the first share, the first
// incoming share/live/op message or the first sharing command. Docs: docs/collaboration.md ▸ Live editing,
// decision record: docs/adr/0011-live-editing-sync.md.
//
// One LiveManager per window (`getLive(controller)`), holding one binding per shared document:
//   TreeBinding  Vector / Pixel structure / Layout: local history steps are diffed into tree ops (collab/tree-crdt.js);
//                remote ops are applied with collab/tree-apply.js, never through the undo history, so Undo only reverts
//                the user's own steps.
//   TextBinding  Code studio projects and one-file text documents: one RGA (collab/text-crdt.js) per text file, bound
//                to the project text and to CodeMirror (remote changes are not added to the editor's history).
//   OfficeBinding  Office Suite apps that declare a `collabAdapter` (office/apps.js): their model is flattened into keyed
//                records and merged with collab/office-records.js (last writer wins per record). Office apps without
//                an adapter (the word processor today) are shared as snapshots (copies).
//
// Wire messages (collab/protocol.js): share {doc, docName, kind, a: start|stop|pause|resume}, live {doc, a: req|have|bye,
// to}, op {doc, kind, path?, ops[]}, and a file transfer (purpose "live", addressed `to` the requester) carrying the
// .ofini snapshot plus `collab-live.json` (the CRDT state with every clock) for the initial sync. Ops that arrive while
// the snapshot is on its way are buffered and applied after it (idempotent, so overlap is harmless).
//
// Public API (the runtime, commands, context menus and Vibe tools use these):
//   getLive(c) → mgr   mgr.share(doc, "live"|"copy")  mgr.stop(docId)  mgr.setPaused(docId, on)  mgr.openLive(docId)
//   mgr.openCopy(docId)  mgr.ignore(docId)  mgr.resync(docId)  mgr.status(doc) → { shared, live, kind, people, paused,
//   owner, role }  mgr.list() → shared documents of the room  mgr.handle(event, payload)  (session events)
// Invariants: remote edits never enter the local undo history; nothing is opened without the user's click; viewers'
// and commenters' ops are refused by every receiver (session permission check) and their local edits to a live
// document are rolled back to the shared state; a pre-merge version is saved before a remote edit overwrites a field
// this user changed in the last seconds (never silent data loss).
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { log } from "../../core/log.js";
import { saveOfini, loadOfini } from "../../core/ofini.js";
import { markUntrusted } from "../../core/security.js";
import { dlState } from "../../engine/dl.js";
import { Doc } from "../../core/doc.js";
import { TreeCRDT, flattenDoc, diffOps, validateTreeOp } from "../../collab/tree-crdt.js";
import { applyView } from "../../collab/tree-apply.js";
import { TextCRDT, textDiff, validateTextOp, TEXT_LIMITS } from "../../collab/text-crdt.js";
import { RecordsCRDT, validateRecordOp } from "../../collab/office-records.js";
import { loadedOfficeApp, officeKindOf } from "../../office/apps.js";
import { canDo, cleanText, LIMITS } from "../../collab/protocol.js";
import { randomB64u } from "../../collab/crypto.js";
import { confirmDialog } from "../dialogs.js";

const FLUSH_MS = 60; // local edits are batched for this long (≤ ~16 messages per second)
const CONFLICT_WINDOW_MS = 6000; // a remote overwrite of a field I changed this recently counts as a conflict
const CONFLICT_SNAPSHOT_EVERY_MS = 120_000; // at most one automatic pre-merge version per document per 2 minutes
const PAUSE_GRACE_MS = 3000;
const MAX_BATCH_CHARS = 180 * 1024;
const SYNC_FILE = "collab-live.json";

/** "tree" | "text" | "office" */
export const docKind = (doc) => (doc?.web ? "text" : doc?.office ? "office" : "tree");
/** The collaboration adapter of an Office document's app, when the app is loaded and declares one. */
const officeAdapter = (doc) => (doc?.office ? loadedOfficeApp(officeKindOf(doc))?.collabAdapter || null : null);

let mgr = null;
export function getLive(c) {
  if (!mgr) mgr = new LiveManager(c);
  return mgr;
}

class LiveManager {
  constructor(c) {
    this.c = c;
    this.app = c.app;
    this.bindings = new Map(); // docId → binding
    this.offers = new Map(); // docId → { from, name, kind, studio, ts } shares of others not opened here
    this.holders = new Map(); // docId → Set(member id) members that have the live document open
    this.pending = new Map(); // docId → { from, mode, buffer:[], timer } sync requests in flight
    this.cards = new Map(); // docId → card element
    this.events = new EventTarget();
    for (const ev of ["docs", "doc", "prefs", "studio", "saved"]) this.app.on(ev, () => this.decorate());
    window.addEventListener("resize", () => this.decorate());
    this.app.on("docs", () => this.#pruneClosed());
  }

  get session() {
    const s = this.c.session;
    return s && s.state !== "left" ? s : null;
  }
  changed() {
    this.decorate();
    this.c.changed("live");
    this.events.dispatchEvent(new Event("change"));
  }
  name(id) {
    return this.session?.member(id)?.profile?.nick || t("Someone");
  }

  // ------------------------------------------------------------------ sharing (local)

  /** Shares a document: "live" (linked, Edit together beta) or "copy" (snapshot file). */
  async share(doc, mode = "live") {
    const s = this.session;
    if (!s || s.state !== "open") throw new Error(t("Join or create a room first."));
    if (mode === "copy" || (docKind(doc) === "office" && !officeAdapter(doc))) {
      if (mode !== "copy") this.app.toast("This Office document is shared as a copy: its app does not support editing together yet.", "primary", 6000);
      return this.c.shareDoc(doc);
    }
    if (!canDo(s.myRole, "share")) throw new Error(t("Only editors can share a live document. Ask the host for the Editor role, or share a copy."));
    let b = this.bindings.get(doc.id);
    if (!b) b = this.#bind(doc, { owner: s.id, fresh: true });
    await s.send("share", { doc: doc.id, docName: cleanText(doc.name, LIMITS.docName), kind: b.kind, a: "start", studio: this.app.studio });
    await s.send("live", { doc: doc.id, a: "have" });
    this.app.toast(t("Sharing “{name}” live. Others get a card to open it.", { name: doc.name }), "success", 3500);
    this.changed();
    return b;
  }

  /** Stops sharing (owner: for everyone) or leaves the live session of a document (others: keeps the copy). */
  async stop(docId, { quiet = false } = {}) {
    const b = this.bindings.get(docId);
    const s = this.session;
    if (b && s?.state === "open") {
      if (b.owner === s.id) await s.send("share", { doc: docId, docName: cleanText(b.doc.name, LIMITS.docName), kind: b.kind, a: "stop" }).catch(() => {});
      else await s.send("live", { doc: docId, a: "bye" }).catch(() => {});
    }
    b?.detach();
    this.bindings.delete(docId);
    if (b && !quiet) this.app.toast(t("“{name}” is no longer edited together. Your copy stays open.", { name: b.doc.name }), "neutral", 3000);
    this.changed();
  }

  /** Host or the document's owner: pause or resume editing for everyone. */
  async setPaused(docId, on) {
    const b = this.bindings.get(docId);
    const s = this.session;
    if (!b || !s) return;
    if (!(s.isHost || b.owner === s.id)) throw new Error(t("Only the host or the person who shared the document can pause editing."));
    await s.send("share", { doc: docId, docName: cleanText(b.doc.name, LIMITS.docName), kind: b.kind, a: on ? "pause" : "resume" });
    b.setPaused(on, s.id);
    this.changed();
  }

  #bind(doc, { owner, fresh = false, state = null }) {
    const s = this.session;
    const kind = docKind(doc);
    const B = kind === "text" ? TextBinding : kind === "office" ? OfficeBinding : TreeBinding;
    const b = new B(this, doc, { owner, site: s.id, state, fresh });
    this.bindings.set(doc.id, b);
    if (!this.holders.has(doc.id)) this.holders.set(doc.id, new Set());
    this.offers.delete(doc.id);
    this.#removeCard(doc.id);
    return b;
  }

  #pruneClosed() {
    for (const [id, b] of this.bindings) if (!this.app.docs.includes(b.doc)) this.stop(id, { quiet: true });
  }

  // ------------------------------------------------------------------ incoming messages

  /** Session events routed here by the runtime: "share" | "live" | "op" | "file" | "members" | "left". */
  async handle(event, p) {
    try {
      if (event === "share") return this.#onShare(p);
      if (event === "live") return this.#onLive(p);
      if (event === "op") return this.#onOp(p);
      if (event === "file") return this.#onFile(p);
      if (event === "members") return this.#onMembers();
      if (event === "left") return this.#onLeft();
    } catch (e) {
      log.warn("collab", `Live editing: ${e.message}`);
    }
  }

  /** Someone new joined: tell them about my shared documents (late joiners would not know about them otherwise). */
  async #onMembers() {
    const s = this.session;
    if (s?.state === "open") {
      const online = s.members.map((m) => m.id);
      const fresh = online.some((id) => !this.known.has(id));
      this.known = new Set(online);
      if (fresh) {
        for (const b of this.bindings.values()) {
          if (b.owner === s.id) {
            for (const a of b.paused ? ["start", "pause"] : ["start"]) await s.send("share", { doc: b.doc.id, docName: cleanText(b.doc.name, LIMITS.docName), kind: b.kind, a, studio: this.app.studio }).catch(() => {});
          }
          await s.send("live", { doc: b.doc.id, a: "have" }).catch(() => {});
        }
      }
    }
    this.changed();
  }
  known = new Set();

  #onShare({ sender, msg, isHost }) {
    const b = this.bindings.get(msg.doc);
    if (msg.a === "start") {
      if (b) return;
      this.offers.set(msg.doc, { from: sender, name: msg.docName || t("Untitled"), kind: msg.kind, studio: msg.studio, ts: Date.now() });
      (this.holders.get(msg.doc) || this.holders.set(msg.doc, new Set()).get(msg.doc)).add(sender);
      this.#showCard(msg.doc);
      this.c.session?.chatStore.addSystem(t("{name} shared “{doc}” to edit together.", { name: this.name(sender), doc: msg.docName || "?" }), Date.now());
      this.c.changed("chat");
    } else if (msg.a === "stop") {
      this.offers.delete(msg.doc);
      this.#removeCard(msg.doc);
      if (b && b.owner === sender) {
        b.detach();
        this.bindings.delete(msg.doc);
        this.app.toast(t("{name} stopped sharing “{doc}”. Your copy stays open.", { name: this.name(sender), doc: b.doc.name }), "neutral", 5000);
      }
    } else if (b && (isHost || sender === b.owner)) {
      b.setPaused(msg.a === "pause", sender, msg.ts);
      this.app.toast(msg.a === "pause" ? t("{name} paused editing of “{doc}”.", { name: this.name(sender), doc: b.doc.name }) : t("{name} resumed editing of “{doc}”.", { name: this.name(sender), doc: b.doc.name }), "primary", 3500);
    }
    this.changed();
  }

  async #onLive({ sender, msg }) {
    const set = this.holders.get(msg.doc) || this.holders.set(msg.doc, new Set()).get(msg.doc);
    if (msg.a === "have") set.add(sender);
    else if (msg.a === "bye") set.delete(sender);
    else if (msg.a === "req" && msg.to === this.session?.id) {
      const b = this.bindings.get(msg.doc);
      if (!b) return;
      b.flush();
      const bytes = await packSnapshot(b);
      await this.session.sendFile(bytes, { name: `${(b.doc.name || "Document").replace(/[\\/:*?"<>|]+/g, "_")}.ofini`, purpose: "live", doc: b.doc.id, to: sender, note: b.doc.name });
    }
    this.changed();
  }

  #onOp({ sender, msg }) {
    const pend = this.pending.get(msg.doc);
    if (pend) {
      if (pend.buffer.length < 5000) pend.buffer.push({ sender, msg });
      return;
    }
    this.bindings.get(msg.doc)?.receive(sender, msg);
    this.holders.get(msg.doc)?.add(sender);
  }

  async #onFile({ transfer, bytes }) {
    const pend = this.pending.get(transfer.doc);
    if (!pend || transfer.from !== pend.from || transfer.purpose !== "live") return;
    clearTimeout(pend.timer);
    this.pending.delete(transfer.doc);
    const { doc, state } = await unpackSnapshot(bytes);
    if (doc.id !== transfer.doc) throw new Error("the snapshot is for another document");
    if (doc.office && pend.mode !== "copy") await import("../../office/index.js").then((m) => m.loadOfficeApp(officeKindOf(doc))).catch(() => null); // the binding needs the app's adapter
    if (pend.mode === "resync") {
      const b = this.bindings.get(doc.id);
      b?.replaceState(doc, state);
    } else if (pend.mode === "copy") {
      doc.id = `d_${randomB64u(6)}`;
      this.#open(doc);
      this.app.toast(t("Opened a copy of “{name}”.", { name: doc.name }), "success", 2500);
    } else {
      const old = this.app.docs.find((d) => d.id === doc.id);
      if (old) {
        // keep the user's own copy as a separate document
        old.id = `d_${randomB64u(6)}`;
        old.name = t("{name} (my copy)", { name: old.name });
        this.app.emit("docs");
      }
      this.#open(doc);
      const b = this.#bind(doc, { owner: pend.owner, state });
      await this.session?.send("live", { doc: doc.id, a: "have" }).catch(() => {});
      for (const m of pend.buffer) b.receive(m.sender, m.msg);
      this.app.toast(t("“{name}” is open. You edit it together with the room (beta).", { name: doc.name }), "success", 3500);
    }
    this.changed();
  }

  #onLeft() {
    for (const b of this.bindings.values()) b.detach();
    this.bindings.clear();
    this.offers.clear();
    this.holders.clear();
    for (const id of [...this.cards.keys()]) this.#removeCard(id);
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.changed();
  }

  #open(doc) {
    doc.saved = false;
    markUntrusted(this.app.prefs, doc);
    this.app.setStudio(["pixel", "layout", "code", "office"].includes(doc.studio) ? doc.studio : "vector");
    this.app.openDoc(doc);
    requestAnimationFrame(() => this.app.cv?.fitPage?.());
  }

  // ------------------------------------------------------------------ opening a shared document

  #holderFor(docId) {
    const s = this.session;
    const offer = this.offers.get(docId);
    const online = new Set(s ? s.members.map((m) => m.id) : []);
    const owner = offer?.from || this.bindings.get(docId)?.owner;
    if (owner && online.has(owner)) return owner;
    for (const id of this.holders.get(docId) || []) if (online.has(id)) return id;
    return null;
  }

  async #request(docId, mode) {
    const s = this.session;
    if (!s || s.state !== "open") throw new Error(t("Join or create a room first."));
    const from = this.#holderFor(docId);
    if (!from) throw new Error(t("Nobody who has this document open is online."));
    const owner = this.offers.get(docId)?.from || this.bindings.get(docId)?.owner || from;
    const timer = setTimeout(() => {
      if (this.pending.get(docId)?.timer !== timer) return;
      this.pending.delete(docId);
      this.app.toast("The shared document did not arrive. Try again, or ask for a copy.", "warning", 6000);
      this.changed();
    }, 90_000);
    this.pending.set(docId, { from, owner, mode, buffer: [], timer });
    await s.send("live", { doc: docId, a: "req", to: from });
    this.changed();
  }

  /** Opens a document someone shared, linked and edited together (asks first). */
  async openLive(docId) {
    const offer = this.offers.get(docId);
    const role = this.session?.myRole;
    const msg = canDo(role, "op")
      ? t("Open “{name}” from {who} and edit it together? Your edits are sent to the room as you make them (end-to-end encrypted). Only open documents from people you trust. Edit together is a beta.", { name: offer?.name || "?", who: offer ? this.name(offer.from) : "?" })
      : t("Open “{name}” from {who}? Your role in this room lets you watch the live document, not change it.", { name: offer?.name || "?", who: offer ? this.name(offer.from) : "?" });
    if (!(await confirmDialog({ title: "Open shared document", message: msg, ok: "Open live" }))) return false;
    await this.#request(docId, "live");
    this.#removeCard(docId);
    this.app.toast(t("Getting “{name}”…", { name: offer?.name || "" }), "primary", 2500);
    return true;
  }

  /** Opens an unlinked copy of a shared document. */
  async openCopy(docId) {
    const offer = this.offers.get(docId);
    if (!(await confirmDialog({ title: "Open shared document", message: t("Open a copy of “{name}” from {who}? The copy is yours and does not change with the room. Only open documents from people you trust.", { name: offer?.name || "?", who: offer ? this.name(offer.from) : "?" }), ok: "Open copy" }))) return false;
    await this.#request(docId, "copy");
    this.#removeCard(docId);
    return true;
  }

  ignore(docId) {
    this.#removeCard(docId);
    const o = this.offers.get(docId);
    if (o) o.ignored = true;
    this.changed();
  }

  /** Asks the owner for the current state again (repairs a document that drifted, brings pixel content). */
  async resync(docId) {
    const b = this.bindings.get(docId);
    if (!b) return;
    if (b.owner === this.session?.id) throw new Error(t("You shared this document: the others resync from you."));
    await this.#request(docId, "resync");
    this.app.toast("Asking for the current state…", "primary", 2000);
  }

  // ------------------------------------------------------------------ status for the UI and the Vibe tools

  status(doc) {
    const s = this.session;
    if (!doc) return { shared: false };
    const b = this.bindings.get(doc.id);
    const online = new Set(s ? s.members.map((m) => m.id) : []);
    const people = b ? 1 + [...(this.holders.get(doc.id) || [])].filter((id) => online.has(id)).length : 0;
    return {
      shared: !!b,
      live: !!b,
      kind: docKind(doc),
      people,
      paused: !!b?.paused,
      owner: b ? (b.owner === s?.id ? "me" : this.name(b.owner)) : null,
      ownedByMe: !!b && b.owner === s?.id,
      canEdit: !!b && canDo(s?.myRole, "op") && !b.paused,
      dropped: b?.dropped || 0,
      conflicts: b?.conflicts || 0,
      pending: this.pending.has(doc.id),
    };
  }

  list() {
    const out = [];
    for (const [id, b] of this.bindings) out.push({ doc: id, name: b.doc.name, kind: b.kind, open: true, ...this.status(b.doc) });
    for (const [id, o] of this.offers) if (!this.bindings.has(id)) out.push({ doc: id, name: o.name, kind: o.kind, open: false, from: this.name(o.from), ignored: !!o.ignored });
    return out;
  }

  // ------------------------------------------------------------------ UI: share cards, tab badges, the together bar

  #showCard(docId) {
    const o = this.offers.get(docId);
    if (!o || this.cards.has(docId)) return;
    let stack = document.querySelector(".of-live-cards");
    if (!stack) document.body.append((stack = h("div.of-live-cards", { role: "region", "aria-label": t("Shared documents") })));
    const kindLabel = o.kind === "text" ? t("code project") : t("design");
    const b = (label, run, variant) => {
      const el = h("button.of-collab-btn", { type: "button", class: variant ? `of-collab-btn--${variant}` : "" }, label);
      el.addEventListener("click", () => run().catch?.((e) => this.app.toast(e.message, "danger", 5000)));
      return el;
    };
    const card = h(
      "div.of-live-card",
      { role: "group", "aria-label": t("{who} shared {name}", { who: this.name(o.from), name: o.name }) },
      h("sl-icon", { name: "people", "aria-hidden": "true" }),
      h("div.of-live-card__text", h("strong", t("{who} shared “{name}”", { who: this.name(o.from), name: o.name })), h("span", t("Live {kind} · Edit together (beta)", { kind: kindLabel }))),
      h("div.of-live-card__acts", b(t("Open live"), () => this.openLive(docId), "primary"), b(t("Open copy"), () => this.openCopy(docId)), b(t("Ignore"), async () => this.ignore(docId))),
    );
    stack.append(card);
    this.cards.set(docId, card);
  }

  #removeCard(docId) {
    this.cards.get(docId)?.remove();
    this.cards.delete(docId);
  }

  /** Shared badge with the member count on document tabs, and the "Editing together" bar for the active document. */
  decorate() {
    const tabs = document.querySelectorAll(".of-doctabs .of-doctab");
    this.app.docs.forEach((d, i) => {
      const tab = tabs[i];
      if (!tab) return;
      const st = this.status(d);
      let badge = tab.querySelector(".of-doctab__live");
      if (!st.shared) return badge?.remove();
      if (!badge) {
        badge = h("span.of-doctab__live", h("sl-icon", { name: "people", "aria-hidden": "true" }), h("span"));
        tab.insertBefore(badge, tab.querySelector(".of-doctab__close"));
      }
      badge.lastChild.textContent = String(st.people);
      badge.title = st.paused ? t("Shared · editing paused") : t("Shared · editing together with {n, plural, one {# person} other {# people}}", { n: st.people });
      badge.setAttribute("aria-label", badge.title);
      badge.classList.toggle("is-paused", st.paused);
    });
    this.#bar();
  }

  #bar() {
    let bar = document.querySelector(".of-live-bar");
    const doc = this.app.doc;
    const st = this.status(doc);
    if (!st.shared) return bar?.remove();
    if (!bar) {
      bar = h("div.of-live-bar", { role: "status" });
      document.body.append(bar);
    }
    const s = this.session;
    const b = this.bindings.get(doc.id);
    const btn = (label, icon, run, title) => {
      const el = h("button.of-collab-btn", { type: "button", title: title || undefined }, h("sl-icon", { name: icon, "aria-hidden": "true" }), h("span", label));
      el.addEventListener("click", () => Promise.resolve(run()).catch((e) => this.app.toast(e.message, "danger", 5000)));
      return el;
    };
    const parts = [h("sl-icon", { name: "people", "aria-hidden": "true" }), h("span.of-live-bar__text", st.paused ? t("Editing paused · {n, plural, one {# person} other {# people}}", { n: st.people }) : t("Editing together · {n, plural, one {# person} other {# people}}", { n: st.people })), h("span.of-live-bar__beta", t("beta"))];
    if (!st.canEdit && !st.paused) parts.push(h("span.of-live-bar__note", t("view only")));
    if (st.dropped) parts.push(btn(t("Resync"), "arrow-repeat", () => this.resync(doc.id), t("{n} remote edits were dropped while editing was paused", { n: st.dropped })));
    if (s && (s.isHost || b.owner === s.id)) parts.push(btn(st.paused ? t("Resume") : t("Pause"), st.paused ? "play-circle" : "pause", () => this.setPaused(doc.id, !st.paused)));
    if (s && b.owner !== s.id && !st.dropped) parts.push(btn(t("Resync"), "arrow-repeat", () => this.resync(doc.id), t("Get the current state (also brings pixel content and images)")));
    parts.push(btn(st.ownedByMe ? t("Stop sharing") : t("Leave"), "x-circle", () => this.stop(doc.id)));
    bar.replaceChildren(...parts);
    bar.setAttribute("aria-label", t("Edit together (beta)"));
  }
}

// ==================================================================== snapshot packing

async function packSnapshot(b) {
  const bytes = await saveOfini(b.doc);
  const { unzipSync, zipSync, strToU8 } = await import("../../../vendor/fflate/fflate.js");
  const files = unzipSync(bytes);
  files[SYNC_FILE] = strToU8(JSON.stringify({ v: 1, kind: b.kind, state: b.stateJSON() }));
  return zipSync(files, { level: 6 });
}

async function unpackSnapshot(bytes) {
  const { unzipSync, strFromU8 } = await import("../../../vendor/fflate/fflate.js");
  const entry = unzipSync(bytes, { filter: (f) => f.name === SYNC_FILE })[SYNC_FILE];
  if (!entry) throw new Error("the shared document has no live state");
  const json = JSON.parse(strFromU8(entry));
  if (!json || json.v !== 1) throw new Error("unsupported live state");
  const doc = await loadOfini(bytes);
  return { doc, state: json.state };
}

// ==================================================================== bindings

class BaseBinding {
  constructor(mgr, doc, { owner, site }) {
    this.mgr = mgr;
    this.app = mgr.app;
    this.doc = doc;
    this.owner = owner;
    this.site = site;
    this.paused = false;
    this.pausedAt = 0;
    this.dropped = 0;
    this.conflicts = 0;
    this.applying = false;
    this.timer = null;
    this.offs = [];
  }
  get session() {
    return this.mgr.session;
  }
  get canEdit() {
    const s = this.session;
    return !!s && s.state === "open" && canDo(s.myRole, "op") && !this.paused;
  }
  setPaused(on, by, ts = Date.now()) {
    this.paused = !!on;
    this.pausedAt = on ? ts : 0;
    this.mgr.changed();
  }
  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_MS);
  }
  /** Sends ops in messages that stay below the frame limit. */
  send(base, ops) {
    const s = this.session;
    if (!s || s.state !== "open" || !ops.length) return;
    let batch = [];
    let size = 0;
    const out = () => {
      if (!batch.length) return;
      s.op({ ...base, ops: batch }).catch((e) => log.warn("collab", `Live edit not sent: ${e.message}`));
      batch = [];
      size = 0;
    };
    for (const op of ops) {
      const n = JSON.stringify(op).length;
      if (batch.length >= LIMITS.ops || size + n > MAX_BATCH_CHARS) out();
      batch.push(op);
      size += n;
    }
    out();
  }
  dropWhilePaused(msg) {
    if (this.paused && msg.ts > this.pausedAt + PAUSE_GRACE_MS) {
      this.dropped++;
      this.mgr.changed();
      return true;
    }
    return false;
  }
  denied() {
    const now = Date.now();
    if (now - (this.lastDenied || 0) > 4000) {
      this.lastDenied = now;
      this.app.toast(this.paused ? t("Editing of this document is paused by the host. Your change was undone.") : t("Your role in this room is view only for live documents. Your change was undone."), "warning", 4000);
    }
  }
  detach() {
    clearTimeout(this.timer);
    for (const off of this.offs) off?.();
    this.offs = [];
  }
}

class TreeBinding extends BaseBinding {
  constructor(mgr, doc, opts) {
    super(mgr, doc, opts);
    this.kind = "tree";
    this.cache = new WeakMap();
    this.graveyard = new Map();
    this.localWrites = new Map(); // `${id}|${field}` → time of my last write
    this.lastSnapshot = 0;
    const flat = flattenDoc(doc, this.cache);
    this.crdt = opts.state ? TreeCRDT.fromJSON(opts.state, opts.site) : TreeCRDT.fromFlat(flat, opts.site);
    this.crdt.site = opts.site;
    if (opts.state) this.#apply(null, true); // the received document and the state must agree exactly
    this.prev = new Set(flattenDoc(doc, this.cache).keys());
    this.offs.push(doc.on("change", (ev) => !this.applying && !ev?.remote && this.schedule()));
  }

  stateJSON() {
    return this.crdt.toJSON();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const flat = flattenDoc(this.doc, this.cache);
    const ops = diffOps(this.crdt, flat, this.prev);
    if (!ops.length) return;
    if (!this.canEdit) {
      this.denied();
      this.#apply(null, true); // roll the document back to the shared state (no history entry)
      return;
    }
    this.prev = new Set(flat.keys());
    const stamped = this.crdt.applyLocal(ops);
    const now = Date.now();
    for (const op of stamped) this.localWrites.set(`${op.id}|${op.f || "#"}`, now);
    if (this.localWrites.size > 5000) this.localWrites.clear();
    this.send({ doc: this.doc.id, kind: "tree" }, stamped);
  }

  receive(sender, msg) {
    if (msg.kind !== "tree" || this.dropWhilePaused(msg)) return;
    let ops;
    try {
      ops = msg.ops.map(validateTreeOp);
    } catch (e) {
      log.warn("collab", `Rejected a live edit: ${e.message}`);
      return;
    }
    this.flush(); // my pending edits first, so the diff base stays exact
    const changed = new Set();
    const lost = [];
    const now = Date.now();
    for (const op of ops) {
      const r = this.crdt.apply(op, sender);
      for (const f of r.fields) changed.add(op.id);
      if (r.structural) changed.add(op.id);
      for (const o of r.overwrote) {
        // my recent value of this very field (or my recent restore/move of this entry) was replaced by theirs
        const when = this.localWrites.get(`${op.id}|${o.field === "#live" ? "#" : o.field}`);
        if (when && now - when < CONFLICT_WINDOW_MS && o.site === this.site) lost.push({ id: op.id, field: o.field });
      }
    }
    if (lost.length) this.#conflict(sender, lost);
    this.#apply(changed, false);
  }

  #apply(changed, full) {
    const doc = this.doc;
    this.applying = true;
    this.mgr.c.applyingRemote = true;
    try {
      const r = applyView(doc, this.crdt, { graveyard: this.graveyard, changed: full ? null : changed });
      this.prev = new Set(flattenDoc(doc, this.cache).keys());
      if (r.structure) dlState.version++;
      doc.rev++;
      doc.modifiedAt = Date.now();
      doc.saved = false;
      const sel = this.app.doc === doc ? this.app.selection.filter((n) => doc.find(n.id) === n) : null;
      if (sel && sel.length !== this.app.selection.length) this.app.select(sel);
      if (this.app.page && this.app.doc === doc && !doc.pages.includes(this.app.page) && !doc.masters.includes(this.app.page)) this.app.setActivePage(doc.pages[0]);
      doc.emit("change", { nodes: r.nodes, structure: r.structure, meta: r.meta, label: "Edit together", remote: true });
    } finally {
      this.applying = false;
      this.mgr.c.applyingRemote = false;
    }
  }

  /** A remote edit replaced something I just changed: keep my version as an automatic version, tell me. */
  #conflict(sender, lost) {
    this.conflicts += lost.length;
    const now = Date.now();
    const node = this.doc.find(lost[0].id);
    const what = node ? node.name || node.type : t("the document");
    this.app.toast(t("{name} changed “{what}” right after you; their change is shown. Your version is kept in Versions.", { name: this.mgr.name(sender), what }), "warning", 6000, { label: t("Versions"), run: () => this.app.run("collab.versions") });
    if (now - this.lastSnapshot < CONFLICT_SNAPSHOT_EVERY_MS) return;
    this.lastSnapshot = now;
    // capture synchronously (before the remote edit is applied), save asynchronously
    const json = this.doc.toJSON();
    const pixels = new Map(this.doc.pixels);
    const assets = { ...this.doc.assets };
    Promise.resolve().then(async () => {
      const copy = Doc.fromJSON(json);
      copy.pixels = pixels;
      for (const [id, a] of Object.entries(assets)) if (copy.assets[id]) copy.assets[id] = a;
      await this.mgr.c.saveVersion(copy, { auto: true, reason: "merge", name: t("Before merging an edit from {name}", { name: this.mgr.name(sender) }) });
    }).catch((e) => log.warn("collab", `Pre-merge version failed: ${e.message}`));
  }

  /** Resync: adopt a fresh state from the owner (also brings pixel bitmaps and image data). */
  replaceState(fresh, state) {
    this.crdt = TreeCRDT.fromJSON(state, this.site);
    for (const [id, c] of fresh.pixels) this.doc.pixels.set(id, c);
    for (const [id, a] of Object.entries(fresh.assets)) if (a.bytes) this.doc.assets[id] = a;
    this.dropped = 0;
    this.#apply(null, true);
    this.mgr.changed();
  }
}

/** Office Suite apps: keyed records (collab/office-records.js) through the app's collabAdapter. */
class OfficeBinding extends BaseBinding {
  constructor(mgr, doc, opts) {
    super(mgr, doc, opts);
    this.kind = "office";
    this.adapter = officeAdapter(doc);
    if (!this.adapter) throw new Error(t("This Office document cannot be edited together."));
    const prj = doc.office;
    this.crdt = opts.state ? RecordsCRDT.fromJSON(opts.state, opts.site) : RecordsCRDT.fromRecords(this.adapter.records(prj.model), opts.site);
    this.crdt.site = opts.site;
    if (opts.state) this.#apply(null);
    this.offs.push(prj.on("change", (info) => !this.applying && info?.origin !== "collab" && this.schedule()));
  }

  stateJSON() {
    return this.crdt.toJSON();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const ops = this.crdt.diff(this.adapter.records(this.doc.office.model));
    if (!ops.length) return;
    if (!this.canEdit) {
      this.denied();
      this.#apply(null); // roll back to the shared state (no history entry)
      return;
    }
    this.send({ doc: this.doc.id, kind: "office" }, this.crdt.applyLocal(ops));
  }

  receive(sender, msg) {
    if (msg.kind !== "office" || this.dropWhilePaused(msg)) return;
    let ops;
    try {
      ops = msg.ops.map(validateRecordOp);
    } catch (e) {
      log.warn("collab", `Rejected a live edit: ${e.message}`);
      return;
    }
    this.flush();
    const changes = {};
    let lost = 0;
    for (const op of ops) {
      const r = this.crdt.apply(op);
      if (r.changed) changes[op.k] = op.v;
      if (r.overwrote) lost++;
    }
    if (lost) this.app.toast(t("{name} changed something you just edited; their change is shown.", { name: this.mgr.name(sender) }), "warning", 5000);
    if (Object.keys(changes).length) this.#apply(changes);
  }

  /** Writes changes (or, with null, everything that differs from the shared view) into the model, outside the history. */
  #apply(changes) {
    const prj = this.doc.office;
    const diff = changes || this.crdt.changesTo(this.adapter.records(prj.model));
    if (!Object.keys(diff).length) return;
    this.applying = true;
    try {
      prj.set(this.adapter.applyRecords(prj.model, diff), { origin: "collab", label: "Edit together", remote: true });
    } catch (e) {
      log.warn("collab", `A live edit could not be applied: ${e.message}`);
    } finally {
      this.applying = false;
    }
    this.doc.saved = false;
    this.app.emit("docchange", { remote: true });
  }

  replaceState(fresh, state) {
    this.crdt = RecordsCRDT.fromJSON(state, this.site);
    this.dropped = 0;
    this.#apply(null);
    this.mgr.changed();
  }
}

class TextBinding extends BaseBinding {
  constructor(mgr, doc, opts) {
    super(mgr, doc, opts);
    this.kind = "text";
    this.web = doc.web;
    this.files = new Map(); // path → TextCRDT
    this.dirty = new Set();
    if (opts.state) {
      for (const [path, st] of Object.entries(opts.state.files || {})) this.files.set(path, TextCRDT.fromJSON(st, opts.site));
    } else {
      for (const [path, f] of this.web.files) if (typeof f.text === "string" && f.text.length <= TEXT_LIMITS.docChars) this.files.set(path, TextCRDT.fromText(f.text, opts.site));
    }
    for (const c of this.files.values()) c.site = opts.site;
    this.offs.push(
      this.web.on("text", ({ path, origin }) => {
        if (this.applying || origin === "collab") return;
        this.dirty.add(path);
        this.schedule();
      }),
    );
  }

  stateJSON() {
    const files = {};
    for (const [p, c] of this.files) files[p] = c.toJSON();
    return { files };
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const paths = [...this.dirty];
    this.dirty.clear();
    for (const path of paths) {
      const cur = this.web.has(path) && this.web.isText(path) ? this.web.text(path) : null;
      if (typeof cur !== "string" || cur.length > TEXT_LIMITS.docChars) continue;
      let crdt = this.files.get(path);
      if (!crdt) this.files.set(path, (crdt = new TextCRDT(this.site)));
      const d = textDiff(crdt.text(), cur);
      if (!d) continue;
      if (!this.canEdit) {
        this.denied();
        this.#write(path, [{ from: d.from, to: d.from + d.insert.length, insert: crdt.text().slice(d.from, d.to) }]);
        continue;
      }
      const ops = [];
      if (d.to > d.from) ops.push(crdt.remove(d.from, d.to - d.from));
      for (let i = 0; i < d.insert.length; i += TEXT_LIMITS.insertChars) ops.push(crdt.insert(d.from + i, d.insert.slice(i, i + TEXT_LIMITS.insertChars)));
      this.send({ doc: this.doc.id, kind: "text", path }, ops.filter(Boolean));
    }
  }

  receive(sender, msg) {
    if (msg.kind !== "text" || !msg.path || this.dropWhilePaused(msg)) return;
    let ops;
    try {
      ops = msg.ops.map(validateTextOp);
    } catch (e) {
      log.warn("collab", `Rejected a live edit: ${e.message}`);
      return;
    }
    this.flush();
    const path = msg.path;
    let crdt = this.files.get(path);
    if (!crdt) {
      if (this.files.size >= 2000) return;
      this.files.set(path, (crdt = new TextCRDT(this.site)));
    }
    const changes = [];
    try {
      for (const op of ops) changes.push(...crdt.apply(op, sender).changes);
    } catch (e) {
      log.warn("collab", `Rejected a live edit: ${e.message}`);
      return;
    }
    if (crdt.length > TEXT_LIMITS.docChars) return log.warn("collab", "A shared file grew past the live-editing limit.");
    this.#write(path, changes);
  }

  /** Writes changes into the project and the editor without adding them to the editor's undo history. */
  #write(path, changes) {
    if (!changes.length) return;
    const web = this.web;
    this.applying = true;
    try {
      if (!web.has(path)) {
        try {
          web.create(path, "");
        } catch (e) {
          log.warn("collab", `A shared file could not be created: ${e.message}`);
          return;
        }
        if (!web.isText(path)) {
          web.remove(path); // only text files are live; others travel as snapshots
          return;
        }
      }
      const ed = this.app.codeUI?.doc === this.doc ? this.app.codeUI.editors : null;
      if (!(ed?.applyRemote && ed.applyRemote(path, changes))) web.setText(path, this.files.get(path).text(), "collab");
    } finally {
      this.applying = false;
    }
    this.doc.saved = false;
    this.app.emit("docchange", { remote: true });
  }

  replaceState(fresh, state) {
    this.files.clear();
    for (const [path, st] of Object.entries(state.files || {})) {
      const c = TextCRDT.fromJSON(st, this.site);
      this.files.set(path, c);
      const cur = this.web.has(path) ? this.web.text(path) : null;
      const d = textDiff(cur ?? "", c.text());
      if (d) this.#write(path, [d]);
    }
    this.dropped = 0;
    this.mgr.changed();
  }
}
