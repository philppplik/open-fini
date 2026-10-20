// Custom title bar: the header doubles as the window's title bar in the desktop app (Tauri). The system title bar is
// switched off (src-tauri/tauri.conf.json: decorations false), so the header is draggable and, on Windows and Linux,
// carries minimize / maximize / close. On macOS the system traffic lights float over the header (titleBarStyle Overlay).
// In the browser and the installed PWA nothing changes. Dragging and double-click-to-maximize come from Tauri's
// data-tauri-drag-region; only elements that carry the attribute drag, so buttons and menus stay clickable.
import { h } from "../core/util.js";
import { windowControls } from "../platform/window-controls.js";

const ICONS = {
  min: '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
  max: '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
  restore: '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
  close: '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" stroke-width="1" fill="none"/></svg>',
};

function controlButton(kind, label, onClick) {
  const b = h("button.of-wc__btn", { type: "button", "data-wc": kind, "aria-label": label, title: label });
  b.innerHTML = ICONS[kind];
  if (kind === "close") b.classList.add("of-wc__btn--close");
  b.addEventListener("click", onClick);
  return b;
}

/**
 * Turns `header` into the title bar when the platform draws no system title bar.
 * @param {import("../core/app.js").App} app
 * @param {HTMLElement} header the .of-header element
 */
export function installTitleBar(app, header) {
  if (windowControls.mode === "native") return;
  const markDraggable = () => {
    header.setAttribute("data-tauri-drag-region", "");
    // containers between the buttons are part of the drag area (children are not draggable unless they carry the attribute)
    for (const el of header.querySelectorAll(".of-menubar, .of-studios, .of-header__actions")) el.setAttribute("data-tauri-drag-region", "");
  };
  header.classList.add("of-header--titlebar", `of-header--${windowControls.mode}`);
  markDraggable();

  // closing (the system gesture or our own button) goes through the unsaved-changes confirmation
  windowControls.installCloseGuard(() => app.confirmQuit());

  if (!windowControls.hasButtons) return;
  const minimize = controlButton("min", "Minimize", () => windowControls.minimize());
  const maximize = controlButton("max", "Maximize", () => windowControls.toggleMaximize());
  const close = controlButton("close", "Close window", () => windowControls.close());
  const group = h("div.of-wc", { role: "group", "aria-label": "Window controls" }, minimize, maximize, close);
  header.append(group);

  const setMaximized = (on) => {
    maximize.innerHTML = ICONS[on ? "restore" : "max"];
    const label = on ? "Restore" : "Maximize";
    maximize.setAttribute("aria-label", label);
    maximize.title = label;
    header.classList.toggle("is-maximized", on);
  };
  windowControls.verify().then((mode) => {
    if (mode === "native") {
      // the window still has its system title bar (configuration not applied): do not draw a second one
      group.remove();
      header.classList.remove("of-header--titlebar", "of-header--custom");
      header.removeAttribute("data-tauri-drag-region");
      return;
    }
    windowControls.onMaximizedChange(setMaximized);
  });
}
