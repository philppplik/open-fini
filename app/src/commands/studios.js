// studio.<id> commands (Studio menu, command palette, shortcuts), derived from the studio registry.
// Alt+1..Alt+N follow the visible (header) order; studios in the "More" menu have no shortcut but a command.
import { listStudios, onStudioRegistered, studioIconSpec } from "../studios/registry.js";

export function registerStudioCommands(app) {
  const define = () => {
    const visible = app.visibleStudios;
    for (const s of listStudios()) {
      const slot = visible.indexOf(s.id);
      app.commands.set(`studio.${s.id}`, {
        id: `studio.${s.id}`,
        label: `${s.label} Studio`,
        icon: studioIconSpec(s),
        run: (a) => a.setStudio(s.id),
        checked: (a) => a.studio === s.id,
        shortcut: slot >= 0 ? `Alt+${slot + 1}` : undefined,
      });
    }
  };
  define();
  // the Studio menu lists every registered studio (also the ones in "More")
  app.menuProviders = app.menuProviders || {};
  app.menuProviders.studios = () => [...listStudios().map((s) => `studio.${s.id}`), "-", "studio.choose"];
  app.registerCommand("studio.choose", { label: "Choose Studios in the Header…", icon: "layout-three-columns", run: (a) => a.emit("dialog", { id: "preferences", section: "studios" }) });
  // a studio registered later (extension, Office ...) or a changed selection updates commands and shortcuts
  const refresh = () => {
    define();
    app.emit("commands");
  };
  onStudioRegistered(refresh);
  app.on("prefs", (key) => (key === "visibleStudios" || key === "*") && refresh());
}
