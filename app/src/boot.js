// Late bootstrap: session restore, service worker, URL params.
import { platform } from "./platform/index.js";
import { registerServiceWorker } from "./platform/pwa.js";
import { log } from "./core/log.js";

export async function boot(app) {
  const params = new URLSearchParams(location.search);
  log.info("app", `OpenFini started${app.safeMode ? " in safe mode" : ""}`);

  // app lock: ask for the passphrase before anything reads the autosaved session (ui/app-lock.js)
  try {
    const { kvGetRaw } = await import("./core/storage.js");
    if (await kvGetRaw("applock")) await (await import("./ui/app-lock.js")).gate(app);
  } catch (err) {
    log.error("security", "The app lock could not be checked", err);
  }
  if (app.safeMode) import("./ui/error-indicator.js").then((m) => m.installSafeBanner(app));
  const studio = params.get("studio");
  if (studio && ["vector", "pixel", "layout", "code", "vibe", "office"].includes(studio)) app.setStudio(studio);
  if (studio === "export") app.run("file.export"); // legacy launcher shortcut: Export is a popup now

  // returning from "Sign in with OpenRouter"
  if (params.get("vibe_oauth") === "openrouter" && params.has("code")) import("./vibe/oauth.js").then((m) => m.finishOAuth(app, params));

  // AI context-menu functions (loaded in the background; they only show when AI features are enabled)
  import("./vibe/quick-actions.js").then((m) => (app.aiQuick = m));

  // extensions (sandboxed add-ons) load in the background, see docs/extensions.md
  app.extensionsReady = import("./extensions/index.js").then((m) => m.initExtensions(app)).catch((err) => {
    console.error("[extensions]", err);
    app.extensions = null;
  });

  // welcome and studio tour invitations, What's new (never blocks; skipped for automation and ?notour)
  import("./ui/onboarding.js").then((m) => m.installOnboarding(app));

  // drop files or folders anywhere on the window to open them
  import("./ui/open-folder.js").then((m) => m.installDropToOpen(app));

  // open files handed over by the OS (file association, "Open with", launch arguments, PWA file handler, share target)
  import("./platform/open-router.js").then((m) => m.installOpenWith(app)).catch((err) => console.warn("OpenFini: open-with is unavailable", err));

  // user-supplied fonts saved on this device
  try {
    const { kvGet } = await import("./core/storage.js");
    const { registerFont } = await import("./core/fonts.js");
    const saved = (await kvGet("fonts")) || [];
    for (const [name, bytes] of saved) {
      await registerFont(name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      app.fonts.set(name, bytes);
    }
  } catch {
    /* fonts are optional */
  }

  if (!app.docs.length && !params.has("fresh") && app.prefs.restoreSession !== false && !app.safeMode) await app.restoreSession?.();

  platform.setTitle?.("OpenFini");
  if (!platform.isDesktop && "serviceWorker" in navigator && location.protocol.startsWith("http") && location.hostname !== "localhost" && !app.safeMode && app.network.allowed("update")) {
    registerServiceWorker?.({
      onUpdate: async (applyUpdate) => {
        const { confirmDialog } = await import("./ui/dialogs.js");
        const ok = await confirmDialog({
          title: "Update available",
          message: "A new version of OpenFini is ready. Your work is autosaved on this device and will be restored after the update.",
          ok: "Update now",
          cancel: "Later",
        });
        if (ok) {
          if (app.prefs.autosave) await app.autosaveNow?.();
          applyUpdate();
        }
      },
    });
  }
}
