// The Collaboration window (?popout=collab): the one place where the Collaboration UI is shown. It is its own OS
// window (a Tauri window on the desktop, a browser popup on the web) and a remote view of the main window's room: no
// identity, keys, connection or documents here. It turns the snapshots received over
// BroadcastChannel("openfini-collab-ui") into a model (collab/remote-model.js), renders it with window.js and sends a
// whitelist of actions back (protocol: collab/remote-ui.js, main-window side: ui/collab/remote-host.js, design:
// docs/adr/0030-collab-native-window.md).
//
// Public API: bootCollabWindow(app, params)   called by boot.js instead of the studio boot
// Invariants: closing this window tells the main window and never leaves the room; when the main window goes away
// this window closes; nothing here persists room data (only this window's own position, size and density).
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { platform } from "../../platform/index.js";
import { windowControls } from "../../platform/window-controls.js";
import { UI_CHANNEL, WINDOW_STATE_KEY, isUiMessage, readShow, readSnapshot, readWindowState } from "../../collab/remote-ui.js";
import { createRemoteModel } from "../../collab/remote-model.js";
import { sessionKey } from "../../platform/popout.js";
import { mountCollabPanel } from "./window.js";

export function bootCollabWindow(app, params) {
  document.documentElement.classList.add("is-collab-window");
  const title = `${t("Collaboration")} - OpenFini`;
  document.title = title;
  platform.setTitle?.(title);
  app.popout = params;
  app.sessionKey = sessionKey(params.id); // never touch the main window's autosaved session
  const note = h("p.of-remote-note", { role: "status" });
  document.body.append(note);
  if (typeof BroadcastChannel === "undefined") {
    note.textContent = t("This browser cannot connect two windows (no BroadcastChannel), so Collaboration is not available here.");
    return;
  }
  note.textContent = t("Waiting for the main window… Keep OpenFini open in the other window.");

  const pid = params.id;
  const channel = new BroadcastChannel(UI_CHANNEL);
  const post = (m) => {
    try {
      channel.postMessage(m);
    } catch {
      /* closed */
    }
  };

  // ---- actions (answered by `res`)
  let rid = 0;
  const waiting = new Map();
  const act = (name, args = {}, { timeout = 15000 } = {}) =>
    new Promise((done) => {
      const id = `r${++rid}`;
      const resolve = (r) => done(r.ok || r.error ? r : { ok: false, error: t("That did not work.") });
      waiting.set(id, resolve);
      post({ t: "act", pid, rid: id, a: { name, args } });
      setTimeout(() => waiting.delete(id) && resolve({ ok: false, error: t("The main window did not answer.") }), timeout);
    });
  const model = createRemoteModel({ act, toast: (...a) => app.toast(...a) });

  // ---- this window's own state: where it was, how large, compact density
  let state = readWindowState(null);
  try {
    state = readWindowState(JSON.parse(localStorage.getItem(WINDOW_STATE_KEY) || "null"));
  } catch {
    /* storage blocked */
  }
  let saved = "";
  const saveState = () => {
    const next = JSON.stringify({ x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight, compact: state.compact });
    if (next === saved || document.hidden) return;
    saved = next;
    try {
      localStorage.setItem(WINDOW_STATE_KEY, next);
    } catch {
      /* storage blocked */
    }
  };
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(saveState, 300);
  });
  const moveTimer = setInterval(saveState, 3000); // browsers have no "moved" event

  // ---- the panel, mounted with the first snapshot
  let panel = null;
  let pendingShow = null;
  function mount() {
    note.remove();
    // a frameless desktop window (Windows, Linux) gets its own minimize and close buttons and a draggable header
    const chrome = [];
    if (windowControls.hasButtons) {
      const winBtn = (ic, label, run) => {
        const b = h("button.of-collab-btn.of-collab-winbtn", { type: "button", title: label, "aria-label": label }, h("sl-icon", { name: ic, "aria-hidden": "true" }));
        b.addEventListener("click", run);
        return b;
      };
      chrome.push(winBtn("dash-lg", t("Minimize"), () => windowControls.minimize()), winBtn("x-lg", t("Close window"), () => closeSelf()));
    }
    panel = mountCollabPanel(model.app, model.c, {
      compact: state.compact,
      chrome,
      onCompact: (on) => {
        state.compact = on;
        saveState();
      },
    });
    if (windowControls.mode !== "native") {
      const head = panel.el.querySelector(".of-collab-win__head");
      for (const el of [head, ...head.querySelectorAll(".of-collab-win__title, .of-collab-pill, sl-icon")]) if (!el.closest("button")) el.setAttribute("data-tauri-drag-region", "");
      panel.el.classList.add(`of-collab-win--${windowControls.mode}`);
    }
    if (pendingShow) panel.show(pendingShow);
    pendingShow = null;
  }

  // ---- connection
  channel.onmessage = (ev) => {
    const m = ev.data;
    if (!isUiMessage(m)) return;
    if (m.t === "snap") {
      const s = readSnapshot(m.s);
      if (!s) return;
      const kind = model.update(s);
      if (!panel) mount();
      else if (kind !== "none") model.c.events.dispatchEvent(new CustomEvent("change", { detail: kind }));
    } else if (m.t === "res") {
      waiting.get(m.rid)?.(m);
      waiting.delete(m.rid);
    } else if (m.t === "show") {
      const req = readShow(m);
      if (panel) panel.show(req);
      else pendingShow = req;
      window.focus();
    } else if (m.t === "close") closeSelf();
  };
  let closing = false;
  function closeSelf() {
    if (closing) return;
    closing = true;
    saveState();
    post({ t: "bye", pid });
    if (platform.isDesktop) windowControls.close();
    else window.close();
  }
  window.addEventListener("pagehide", () => {
    clearInterval(moveTimer);
    clearInterval(retry);
    if (!closing) post({ t: "bye", pid });
  });
  post({ t: "hello", pid });
  // the main window may still be starting up: ask again until it answers
  const retry = setInterval(() => (model.snapshot() ? clearInterval(retry) : post({ t: "hello", pid })), 2000);
}
