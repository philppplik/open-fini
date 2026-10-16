// Late bootstrap: session restore, service worker, URL params.
import { platform } from "./platform/index.js";
import { registerServiceWorker } from "./platform/pwa.js";

export async function boot(app) {
  const params = new URLSearchParams(location.search);
  const studio = params.get("studio");
  if (studio && ["vector", "pixel", "layout", "code", "vibe"].includes(studio)) app.setStudio(studio);
  if (studio === "export") app.run("file.export"); // legacy launcher shortcut: Export is a popup now

  // returning from "Sign in with OpenRouter"
  if (params.get("vibe_oauth") === "openrouter" && params.has("code")) import("./vibe/oauth.js").then((m) => m.finishOAuth(app, params));

  // AI context-menu functions (loaded in the background; they only show when AI features are enabled)
  import("./vibe/quick-actions.js").then((m) => (app.aiQuick = m));

  // drop files or folders anywhere on the window to open them
  import("./ui/open-folder.js").then((m) => m.installDropToOpen(app));

  // reopen files handed over by the OS (file association / launch arguments)
  platform.onOpenFiles?.(async (files) => {
    for (const f of files) {
      try {
        await app.openFile(f);
      } catch (err) {
        app.toast(err.message, "danger", 6000);
      }
    }
  });

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

  if (!app.docs.length && !params.has("fresh") && app.prefs.restoreSession !== false) await app.restoreSession?.();

  platform.setTitle?.("OpenFini");
  if (!platform.isDesktop && "serviceWorker" in navigator && location.protocol.startsWith("http") && location.hostname !== "localhost") {
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
