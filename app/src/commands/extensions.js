// Extension commands. The extension host itself loads lazily (extensions/index.js); these only open its UI.
export function registerExtensionCommands(app) {
  app.registerCommand("ext.manage", { label: "Extensions…", icon: "puzzle", run: (a) => import("../ui/extensions/manager.js").then((m) => m.openExtensionManager(a)) });
}
