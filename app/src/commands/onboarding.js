// Help and discovery commands: command palette, tours, "What's this?" and "What's new". The UI is loaded on demand.
export function registerOnboardingCommands(app) {
  const def = (id, label, run, extra = {}) => app.registerCommand(id, { label, run, ...extra });
  def("help.palette", "Command Palette…", async (a) => (await import("../ui/command-palette.js")).openCommandPalette(a), { shortcut: "Mod+K", altShortcut: "F1", icon: "search" });
  def("help.tour", "Take the Tour", async (a) => (await import("../ui/onboarding.js")).runTour(a, "welcome"), { icon: "signpost-split" });
  def("help.studioTour", "Tour of This Studio", async (a) => (await import("../ui/onboarding.js")).runStudioTour(a), { icon: "compass" });
  def("help.whatsThis", "What's This?", async (a) => (await import("../ui/onboarding.js")).toggleWhatsThis(a), { shortcut: "Shift+F1", icon: "question-circle" });
  def("help.whatsNew", "What's New", async (a) => (await import("../ui/onboarding.js")).showWhatsNew(a), { icon: "stars" });
  def("help.resetTours", "Reset Tours and Hints", async (a) => {
    (await import("../ui/onboarding.js")).resetTours(a);
    a.toast("Tours will be offered again.", "success", 1800);
  }, { icon: "arrow-counterclockwise" });
}
