// Window commands: pop-out windows (docs/multi-window.md) and the recent-files list.
// Ids: window.popout, window.popoutStudio, window.new, window.returnToMain, file.clearRecent.
import { parsePopoutParams } from "../platform/popout.js";
import { clearRecents, restoreRecents, setRecentLimit, trimRecents } from "../core/storage.js";
import { confirmDialog } from "../ui/dialogs.js";

const rt = () => import("../ui/popout.js");

export function registerWindowCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });
  const inPopout = !!parsePopoutParams(globalThis.location?.search);

  def("window.popout", "Move Document to New Window", async (a, o) => (await rt()).popoutDoc(a, o?.doc || a.doc, { mode: o?.mode || "move" }), { enabled: (a) => !!a.doc, icon: "box-arrow-up-right" });
  def("window.popoutStudio", "Detach Current Studio", async (a, o) => (await rt()).popoutStudio(a, o?.studio || a.studio), { icon: "window-stack" });
  def("window.new", "New Window", async (a) => (await rt()).newWindow(a), { shortcut: "Mod+Shift+Alt+N", icon: "window-plus" });
  def("window.returnToMain", "Return to Main Window", async (a) => (await rt()).returnToMain(a), { enabled: () => inPopout, icon: "box-arrow-in-down-left" });

  // ---- recent files
  setRecentLimit(app.prefs.recentLimit);
  app.on("prefs", (k) => {
    if (k !== "recentLimit" && k !== "*") return;
    setRecentLimit(app.prefs.recentLimit);
    trimRecents().then((r) => app.emit("recents", r));
  });
  def("file.clearRecent", "Clear Recent Files", async (a, o) => {
    if (!o?.confirmed && !(await confirmDialog({ title: "Clear recent files", message: "Remove every entry from the recent files list? Your documents are not deleted.", ok: "Clear", danger: true }))) return false;
    const snap = await clearRecents();
    a.emit("recents", []);
    if (!snap.list.length) return true;
    a.toast(`Cleared ${snap.list.length} recent file${snap.list.length === 1 ? "" : "s"}.`, "neutral", 6000, { label: "Undo", run: async () => a.emit("recents", await restoreRecents(snap)) });
    return true;
  }, { icon: "trash" });
}
