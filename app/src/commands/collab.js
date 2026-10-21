// Collaboration commands (docs/collaboration.md). Tiny on purpose: everything else loads with import() on first use.
// Ids: collab.open, collab.chat, collab.comments, collab.addComment, collab.versions, collab.saveVersion,
//      collab.share, collab.leave, collab.profile
const rt = () => import("../ui/collab/runtime.js");

export function registerCollabCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });
  const inRoom = (a) => !!a.collab?.session && a.collab.session.state !== "left";

  def("collab.open", "Collaborate…", async (a) => (await rt()).openCollab(a), { icon: "people" });
  def("collab.chat", "Room Chat", async (a) => (await rt()).openCollab(a, "chat"), { icon: "chat", shortcut: "Mod+Alt+C" });
  def("collab.comments", "Comments", async (a) => (await rt()).openCollab(a, "comments"), { icon: "chat-quote" });
  def("collab.addComment", "Add Comment", async (a, o) => (await rt()).addComment(a, o), { icon: "chat-quote", shortcut: "Mod+Alt+M", enabled: (a) => !!a.doc });
  def("collab.versions", "Version History", async (a) => (await rt()).openCollab(a, "versions"), { icon: "clock-history", enabled: (a) => !!a.doc });
  def("collab.saveVersion", "Save Version…", async (a, o) => (await rt()).saveVersionDialog(a, o), { icon: "bookmark-star", enabled: (a) => !!a.doc });
  def("collab.share", "Share Document to Room", async (a) => (await rt()).shareDoc(a), { icon: "share", enabled: (a) => !!a.doc && inRoom(a) });
  def("collab.leave", "Leave Room", async (a) => (await rt()).leaveRoom(a), { icon: "x-circle", enabled: inRoom });
  def("collab.profile", "Profile and Collaboration Settings", (a) => import("../ui/dialogs.js").then((m) => m.preferencesDialog(a, "collab")), { icon: "people" });
}
