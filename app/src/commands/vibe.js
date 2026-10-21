// Vibe Studio commands (the workspace itself is loaded lazily; these only act once it exists).
export function registerVibeCommands(app) {
  const vibe = () => app.vibe;
  const live = (a) => a.studio === "vibe" && !!a.vibe?.vs?.chat;
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, studios: ["vibe"], enabled: live, ...extra });
  def("vibe.newChat", "New Chat", () => vibe().session.newChat(), { shortcut: "Mod+Alt+N", icon: "pencil-square" });
  def("vibe.undoRun", "Undo Last AI Run", () => app.toast(`Undid ${vibe().session.undoLastRun()} change(s).`, "success", 1600), { enabled: (a) => live(a) && a.vibe.session.runs.length > 0, icon: "arrow-counterclockwise" });
  def("vibe.stop", "Stop", () => vibe().session.abort(), { shortcut: "Escape", enabled: (a) => live(a) && a.vibe.session.running });
  // global kill switch: every chat, quick action and sub-agent (works in every studio)
  app.registerCommand("vibe.stopAll", { label: "Stop All AI Tasks", icon: "stop-fill", run: (a) => a.toast(`Stopped ${a.vibeHub?.stopAll() || 0} AI task(s).`, "primary", 1600), enabled: (a) => !!a.vibeHub?.running.length });
  for (const [id, label] of [["canvas", "Canvas"], ["activity", "Activity"], ["models", "Models and Connections"], ["tools", "Tools and MCP"], ["skills", "Skills"], ["knowledge", "Knowledge and Memory"]]) {
    def(`vibe.tab${id[0].toUpperCase()}${id.slice(1)}`, `Show ${label}`, () => vibe().vs.openTab(id));
  }
}
