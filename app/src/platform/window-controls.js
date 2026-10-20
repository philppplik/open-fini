// Window controls for the custom title bar (desktop shell only). The browser and the PWA keep their own chrome:
// every method is a harmless no-op there, so UI code never has to check the platform first.
//
//   import { windowControls } from "./platform/window-controls.js";
//   if (windowControls.mode === "custom") header.append(buttons);   // minimize / maximize / close are drawn by the app
//
// Modes
//   "native"  browser, PWA, or a desktop window that still has its system title bar
//   "custom"  Windows and Linux desktop: decorations are off, the app draws the title bar and the three buttons
//   "overlay" macOS desktop: the system traffic lights float over the app (titleBarStyle "Overlay"); the header only
//             leaves room for them
// See docs/os-integration.md for the window configuration this relies on (src-tauri/tauri.conf.json and capabilities).

import { detectDesktopOs } from "./common.js";

/** Which chrome the app draws. Pure, so it is unit tested. */
export function chromeMode({ isDesktop, os }) {
  if (!isDesktop) return "native";
  return os === "macos" ? "overlay" : "custom";
}

/**
 * @param {{ isDesktop: boolean, os: string, tauri?: any }} env  `tauri` is window.__TAURI__ (injected for tests)
 */
export function createWindowControls({ isDesktop, os, tauri }) {
  let mode = chromeMode({ isDesktop, os });
  let win = null;
  const current = () => {
    if (!win) {
      try {
        win = tauri?.window?.getCurrentWindow?.() || null;
      } catch {
        win = null;
      }
    }
    return win;
  };
  const call = async (name, ...args) => {
    const w = current();
    if (!w || typeof w[name] !== "function") return undefined;
    try {
      return await w[name](...args);
    } catch (err) {
      console.warn(`OpenFini: window.${name}() failed (missing capability in src-tauri/capabilities/default.json?)`, err);
      return undefined;
    }
  };

  return {
    /** "native" | "custom" | "overlay" (see the file comment). May switch to "native" after verify(). */
    get mode() {
      return mode;
    },
    /** True when the app draws minimize / maximize / close itself. */
    get hasButtons() {
      return mode === "custom";
    },
    /**
     * Confirms that the system title bar really is gone (decorations: false). If the window still has native
     * decorations (a config that was not applied) the custom bar steps back, so there are never two title bars.
     */
    async verify() {
      if (mode === "custom") {
        const decorated = await call("isDecorated");
        if (decorated === true) mode = "native";
      }
      return mode;
    },
    minimize: () => call("minimize"),
    async toggleMaximize() {
      const maximized = await call("isMaximized");
      return call(maximized ? "unmaximize" : "maximize");
    },
    /** Asks the window to close; the close-request guard (installCloseGuard) decides about unsaved changes. */
    close: () => call("close"),
    async isMaximized() {
      return (await call("isMaximized")) === true;
    },
    /** Calls `callback(isMaximized)` now and whenever the window is resized; resolves with an unsubscribe function. */
    async onMaximizedChange(callback) {
      const w = current();
      if (!w) return () => {};
      const emit = async () => callback((await call("isMaximized")) === true);
      emit();
      try {
        const off = await w.onResized(emit);
        return typeof off === "function" ? off : () => {};
      } catch {
        return () => {};
      }
    },
    /**
     * Intercepts the window's close request (the system close button, Alt+F4, Cmd+Q on macOS, the app's own close
     * button). `confirm()` resolves true when closing is fine; otherwise the window stays open.
     */
    async installCloseGuard(confirm) {
      const w = current();
      if (!w || typeof w.onCloseRequested !== "function") return () => {};
      try {
        return await w.onCloseRequested(async (event) => {
          event.preventDefault();
          let ok = false;
          try {
            ok = await confirm();
          } catch (err) {
            console.warn("OpenFini: close confirmation failed", err);
          }
          if (ok) await call("destroy");
        });
      } catch (err) {
        console.warn("OpenFini: close guard unavailable", err);
        return () => {};
      }
    },
  };
}

const tauri = typeof window !== "undefined" ? window.__TAURI__ : undefined;
const isDesktop = typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

export const windowControls = createWindowControls({ isDesktop, os: isDesktop ? detectDesktopOs() : "web", tauri });
export default windowControls;
