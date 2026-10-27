// Collaboration commands (docs/collaboration.md). Tiny on purpose: everything else loads with import() on first use.
// Ids: collab.open, collab.chat, collab.comments, collab.addComment, collab.versions, collab.saveVersion,
//      collab.share, collab.leave, collab.profile, collab.shareDocument, collab.shareLive, collab.shareCopy,
//      collab.stopSharing, collab.resync, collab.relayHelp
// Also registers the "Share with collaboration room" context-menu section (document tabs, empty canvas, Code explorer
// files and tabs, the Office editor) and opens the join dialog for links of the form …/#join=<invite code>.
import { registerContextProvider } from "../ui/context-menu/index.js";

const rt = () => import("../ui/collab/runtime.js");

export function registerCollabCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });
  const inRoom = (a) => !!a.collab?.session && a.collab.session.state !== "left";
  const shared = (a, doc = a.doc) => !!doc && !!a.collab?.liveStatus?.(doc).shared;
  const docOf = (a, o) => o?.doc || a.doc;

  def("collab.open", "Collaborate…", async (a) => (await rt()).openCollab(a), { icon: "people" });
  def("collab.chat", "Room Chat", async (a) => (await rt()).openCollab(a, "chat"), { icon: "chat", shortcut: "Mod+Alt+C" });
  def("collab.comments", "Comments", async (a) => (await rt()).openCollab(a, "comments"), { icon: "chat-quote" });
  def("collab.addComment", "Add Comment in Panel…", async (a, o) => (await rt()).addComment(a, o), { icon: "chat-quote", enabled: (a) => !!a.doc });
  // inline comments: the composer opens at the pointer / selection (docs/collaboration.md, "Comments on the canvas, in code and in text")
  def("collab.addCommentHere", "Add Comment Here…", async (a, o) => (await rt()).addCommentHere(a, o?.ctx || o || {}), { icon: "chat-quote", shortcut: "Mod+Alt+M", enabled: (a) => !!a.doc });
  def("collab.commentMode", "Comment Mode (click to place a comment)", async (a) => (await (await rt()).getCollab(a).commentUI()).commentMode(), { icon: "chat-quote", enabled: (a) => !!a.doc });
  def("collab.toggleComments", "Show or Hide All Comments", async (a) => {
    const ui = await (await rt()).getCollab(a).commentUI();
    ui.setPinsVisible(!ui.pinsVisible());
  }, { icon: "eye", enabled: (a) => !!a.doc });
  def("collab.popOut", "Pop Out Collaboration Window", async (a) => (await rt()).popOutCollab(a), { icon: "box-arrow-up-right" });

  // comments saved in a document show their pins as soon as the document is active (the runtime loads lazily)
  app.on("doc", () => {
    if (app.doc?.comments?.length && !app.collab) rt().then((r) => r.getCollab(app)).catch(() => {});
  });

  registerContextProvider({
    id: "collab.comment",
    priority: 12,
    matches: (c) => !!c.app.doc && (["canvas-empty", "canvas-layers", "canvas-text", "table", "table-cell", "chart", "layers-row", "code-editor", "office-document", "web-element"].includes(c.kind)),
    items: (c) => [{ label: "Add comment here…", icon: "chat-quote", shortcut: "Mod+Alt+M", run: () => c.app.run("collab.addCommentHere", { ctx: { kind: c.kind, x: c.x, y: c.y, data: c.data } }) }],
  });
  def("collab.versions", "Version History", async (a) => (await rt()).openCollab(a, "versions"), { icon: "clock-history", enabled: (a) => !!a.doc });
  def("collab.saveVersion", "Save Version…", async (a, o) => (await rt()).saveVersionDialog(a, o), { icon: "bookmark-star", enabled: (a) => !!a.doc });
  def("collab.share", "Share Document to Room", async (a) => (await rt()).shareDoc(a), { icon: "share", enabled: (a) => !!a.doc && inRoom(a) });
  def("collab.leave", "Leave Room", async (a) => (await rt()).leaveRoom(a), { icon: "x-circle", enabled: inRoom });
  def("collab.profile", "Profile and Collaboration Settings", (a) => import("../ui/dialogs.js").then((m) => m.preferencesDialog(a, "collab")), { icon: "people" });
  // shared documents and "Edit together" (beta)
  def("collab.shareDocument", "Share with Collaboration Room…", async (a, o) => (await rt()).shareDocument(a, { doc: docOf(a, o) }), { icon: "people", enabled: (a) => !!a.doc });
  def("collab.shareLive", "Share as Linked Live Document", async (a, o) => (await rt()).shareDocument(a, { doc: docOf(a, o), mode: "live" }), { icon: "link-45deg", enabled: (a) => !!a.doc && !a.doc.office && !shared(a) });
  def("collab.shareCopy", "Share a Copy (Snapshot)", async (a, o) => (await rt()).shareDocument(a, { doc: docOf(a, o), mode: "copy" }), { icon: "share", enabled: (a) => !!a.doc });
  def("collab.stopSharing", "Stop Sharing", async (a, o) => (await rt()).stopSharing(a, { doc: docOf(a, o) }), { icon: "x-circle", enabled: (a) => shared(a) });
  def("collab.resync", "Resync Shared Document", async (a, o) => (await rt()).resyncDocument(a, { doc: docOf(a, o) }), { icon: "arrow-repeat", enabled: (a) => shared(a) });
  def("collab.relayHelp", "How to Start a Relay", async (a) => (await rt()).relayHelp(a), { icon: "terminal" });

  registerContextProvider({
    id: "collab.share",
    priority: 10,
    matches: (c) => ["doc-tab", "canvas-empty", "explorer-file", "editor-tab", "office-document"].includes(c.kind) && !!(c.data?.doc || c.app.doc),
    items: (c) => {
      const doc = c.data?.doc || c.app.doc;
      if (shared(c.app, doc)) return [{ label: "Stop sharing", icon: "x-circle", run: () => c.app.run("collab.stopSharing", { doc }) }, { label: "Share a copy (snapshot)", icon: "share", run: () => c.app.run("collab.shareCopy", { doc }) }];
      return [
        { label: "Share with collaboration room…", icon: "people", run: () => c.app.run("collab.shareDocument", { doc }) },
        { label: "Share as linked live document", icon: "link-45deg", hidden: !!doc.office, run: () => c.app.run("collab.shareLive", { doc }) },
        { label: "Share a copy (snapshot)", icon: "share", run: () => c.app.run("collab.shareCopy", { doc }) },
      ];
    },
  });

  // join links: http(s)://<relay>/#join=<invite code> (the code stays in the fragment, which browsers never send)
  const checkJoin = (delay) => {
    try {
      const m = /^#join=(.+)$/.exec(location.hash || "");
      if (!m) return;
      history.replaceState(null, "", location.pathname + location.search); // keep the secret out of the address bar
      const code = decodeURIComponent(m[1]);
      setTimeout(() => rt().then((r) => r.openJoin(app, code)), delay);
    } catch {
      /* no location (tests) or a malformed link */
    }
  };
  checkJoin(900);
  globalThis.addEventListener?.("hashchange", () => checkJoin(0));
}
