// OpenFini tools about the operating system integration: which platform this is and which files it can open.
// Nothing here touches arbitrary paths; both tools only read information the app already has.
import { tool } from "./helpers.js";
import { platform } from "../../platform/index.js";
import { isStandalone } from "../../platform/pwa.js";
import { describeSupportedTypes, defaultAppsInstructions, FILE_TYPES } from "../../platform/file-types.js";
import { getRecents } from "../../core/storage.js";

async function appVersion() {
  try {
    const res = await fetch("./build-info.json");
    if (res.ok) return (await res.json()).version || "unknown";
  } catch {
    // development server without a build
  }
  return "development build";
}

export function systemTools() {
  return [
    tool("get_platform_info", "Describes where OpenFini runs (operating system, desktop app or browser, version) and which file types it can open from the operating system (Open with, double click, PWA file handler), including whether those associations are registered. Use it to answer questions about opening files or setting OpenFini as the default app.", {}, [], async () => {
      const desktop = platform.isDesktop;
      const web = !desktop;
      return {
        os: platform.os,
        runtime: desktop ? "desktop app (Tauri)" : isStandalone() ? "installed web app (PWA)" : "browser tab",
        version: await appVersion(),
        fileAssociations: desktop
          ? "Registered by the installer: .ofini and .ofext open OpenFini on double click; every other listed type is offered under Open with and never replaces your default app. Whether the installer was used cannot be checked from inside the app."
          : "Only available after the app is installed as a PWA in a Chromium based browser (file handlers); a plain browser tab cannot be registered.",
        launchQueueSupported: web ? typeof window !== "undefined" && "launchQueue" in window : undefined,
        commandLine: desktop ? "openfini [--help] [--version] [FILE...]; a second launch opens the files in the running window." : undefined,
        supportedTypes: describeSupportedTypes(),
        ownedExtensions: FILE_TYPES.filter((t) => t.own).flatMap((t) => t.ext.map((e) => `.${e}`)),
        howToSetDefault: defaultAppsInstructions(platform.os),
      };
    }, { readOnly: true }),

    tool("list_recent_files", "Lists the recently opened or saved files (name, time, size, and the path on the desktop app). Reading only: it does not open anything.", {}, [], async () => {
      const recents = await getRecents();
      return { count: recents.length, files: recents.map((r) => ({ name: r.name, time: new Date(r.time).toISOString(), bytes: r.size, path: platform.isDesktop ? r.path || null : undefined })) };
    }, { readOnly: true }),
  ];
}
