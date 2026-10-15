// OpenFini bootstrap.
import { setBasePath } from "../vendor/shoelace/utilities/base-path.js";
import { registerIconLibrary } from "../vendor/shoelace/utilities/icon-library.js";
import "../vendor/shoelace/shoelace-autoloader.js";

import { App } from "./core/app.js";
import { registerAllTools } from "./studios/index.js";
import { registerCommands } from "./commands/index.js";
import { installShortcuts } from "./ui/shortcuts.js";
import { installTooltips } from "./ui/controls.js";
import { createShell, applyTheme } from "./ui/shell.js";
import { ensureFont } from "./core/fonts.js";

// Shoelace 2.20 calls ResizeObserver.unobserve(undefined) when a <sl-range>/<sl-select> is removed before its
// first render (panels are rebuilt often). The call is harmless but throws; ignore non-element arguments.
if (typeof ResizeObserver !== "undefined") {
  const unobserve = ResizeObserver.prototype.unobserve;
  ResizeObserver.prototype.unobserve = function (target) {
    if (target instanceof Element) unobserve.call(this, target);
  };
}

setBasePath(new URL("../vendor/shoelace", import.meta.url).href);
// OpenFini's own tool/glyph icons; everything else comes from Shoelace's default (Bootstrap Icons) library.
registerIconLibrary("of", { resolver: (name) => new URL(`../assets/icons/${name}.svg`, import.meta.url).href });

const app = new App();
window.openfini = app; // handy for debugging and automated tests

registerAllTools(app);
registerCommands(app);
installShortcuts(app);
installTooltips();
applyTheme(app);
app.on("prefs", () => applyTheme(app));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => app.prefs.theme === "auto" && applyTheme(app));

// Unexpected errors: keep working, tell the user once in a while (work is autosaved), log the details.
let lastErrorToast = 0;
const reportError = (message) => {
  if (!message || /ResizeObserver|unobserve/i.test(message)) return; // benign browser / component noise
  console.error("[OpenFini]", message);
  const now = Date.now();
  if (now - lastErrorToast < 5000) return;
  lastErrorToast = now;
  app.toast(`Something went wrong: ${String(message).slice(0, 140)}. Your work is autosaved on this device.`, "danger", 7000);
};
window.addEventListener("error", (e) => reportError(e.message));
window.addEventListener("unhandledrejection", (e) => reportError(e.reason?.message || String(e.reason)));

createShell(app, document.getElementById("app"));
app.setTool("move");
ensureFont("Inter", 400);
ensureFont("Inter", 700);

// feature modules that need the shell to exist
const { boot } = await import("./boot.js");
await boot(app);
