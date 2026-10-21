// OpenFini bootstrap.
import { setBasePath } from "../vendor/shoelace/utilities/base-path.js";
import { registerIconLibrary } from "../vendor/shoelace/utilities/icon-library.js";
import "../vendor/shoelace/shoelace-autoloader.js";

import { App, getDefaultPrefs } from "./core/app.js";
import { registerAllTools } from "./studios/index.js";
import { registerCommands } from "./commands/index.js";
import { installShortcuts } from "./ui/shortcuts.js";
import { installCustomization } from "./customize/index.js";
import { installTooltips } from "./ui/controls.js";
import { createShell, applyTheme } from "./ui/shell.js";
import { ensureFont } from "./core/fonts.js";
import { installLogCapture } from "./core/log-capture.js";
import { redact } from "./core/log.js";
import { markBootOk } from "./core/bootguard.js";
import { initI18n, t, translateDom } from "./i18n/index.js";

// Central logging first, so everything that goes wrong while starting is recorded (see docs/troubleshooting.md).
installLogCapture();

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
// Language first: everything rendered below is translated. The OS locale (desktop) is only asked when the preference is "auto".
await initI18n({
  pref: app.prefs.language,
  osLocale: async () => {
    if (app.prefs.language !== "auto") return undefined;
    const { platform } = await import("./platform/index.js");
    return platform.osLocale?.();
  },
});
window.openfini = app; // handy for debugging and automated tests

registerAllTools(app);
registerCommands(app);
installCustomization(app, { defaults: getDefaultPrefs }); // before the key handler: rebound shortcuts must be in place
installShortcuts(app);
installTooltips();
applyTheme(app);
app.on("prefs", () => applyTheme(app));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => app.prefs.theme === "auto" && applyTheme(app));

// Unexpected errors: keep working, tell the user once in a while (work is autosaved). The details are logged by log-capture.js.
let lastErrorToast = 0;
const reportError = (message) => {
  if (!message || /ResizeObserver|unobserve/i.test(message)) return; // benign browser / component noise
  const now = Date.now();
  if (now - lastErrorToast < 5000) return;
  lastErrorToast = now;
  app.toast(t("Something went wrong: {message}. Your work is autosaved on this device.", { message: redact(message).slice(0, 140) }), "danger", 7000, { label: t("Details"), run: () => app.run("help.troubleshoot") });
};
window.addEventListener("error", (e) => reportError(e.message));
window.addEventListener("unhandledrejection", (e) => reportError(e.reason?.message || String(e.reason)));

createShell(app, document.getElementById("app"));
applyTheme(app); // again, now that the layout exists (dock side and width)
app.on("locale", () => translateDom(document)); // static chrome tagged with data-i18n-* follows a live language switch
app.setTool("move");
ensureFont("Inter", 400);
ensureFont("Inter", 700);

// feature modules that need the shell to exist
const { boot } = await import("./boot.js");
await boot(app);
try {
  markBootOk(localStorage);
} catch {
  /* storage blocked: no guard */
} // the crash-loop guard counts a start as failed until this point
