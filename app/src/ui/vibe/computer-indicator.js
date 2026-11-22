// The always-on-top bar of a computer use session (window "computer-indicator", created by src-tauri/src/computer.rs
// while a session is active and destroyed when it ends). It says what the assistant may do, how long, and offers
// Pause / Resume and Stop. Its capability (src-tauri/capabilities/computer-indicator.json) allows nothing else.
// Public API: bootComputerIndicator()   called by boot.js instead of the studio boot (?popout=computer-indicator)
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";

const CSS = `
html.is-computer-indicator body > :not(.of-cui) { display: none !important; }
html.is-computer-indicator, html.is-computer-indicator body { margin: 0; height: 100%; overflow: hidden; background: #b3261e; color: #fff; font: 13px/1.2 system-ui, sans-serif; }
.of-cui { display: flex; align-items: center; gap: 8px; height: 100%; padding: 0 8px 0 12px; box-sizing: border-box; cursor: move; user-select: none; }
.of-cui[data-paused="true"] { background: #7a5a00; }
.of-cui__dot { width: 10px; height: 10px; border-radius: 50%; background: #fff; flex: none; animation: of-cui-pulse 1.4s ease-in-out infinite; }
.of-cui[data-paused="true"] .of-cui__dot { animation: none; opacity: 0.6; }
.of-cui__text { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.of-cui button { flex: none; font: inherit; font-weight: 600; color: #fff; background: rgba(255, 255, 255, 0.16); border: 1px solid rgba(255, 255, 255, 0.55); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.of-cui button:hover, .of-cui button:focus-visible { background: rgba(255, 255, 255, 0.3); }
.of-cui button.of-cui__stop { background: #fff; color: #8c1d18; border-color: #fff; }
@keyframes of-cui-pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .of-cui__dot { animation: none; } }
`;

export function bootComputerIndicator() {
  const tauri = globalThis.window?.__TAURI__;
  const invoke = (cmd) => tauri.core.invoke(cmd);
  document.documentElement.classList.add("is-computer-indicator");
  document.head.append(h("style", CSS));
  document.title = t("Computer use");
  const text = h("span.of-cui__text", { role: "status" });
  const toggle = h("button", { type: "button" });
  const stop = h("button.of-cui__stop", { type: "button" }, t("Stop"));
  const bar = h("div.of-cui", { "data-tauri-drag-region": "" }, h("span.of-cui__dot", { "aria-hidden": "true", "data-tauri-drag-region": "" }), text, toggle, stop);
  text.setAttribute("data-tauri-drag-region", "");
  document.body.append(bar);
  let paused = false;

  async function refresh() {
    let st = null;
    try {
      st = await invoke("computer_status");
    } catch {
      /* the window goes away with the session */
    }
    const g = st?.grant;
    if (!g) {
      text.textContent = t("Computer use has ended.");
      toggle.hidden = true;
      return;
    }
    paused = !!g.paused;
    const minutes = Math.max(1, Math.ceil(g.expiresInMs / 60000));
    bar.dataset.paused = String(paused);
    text.textContent = paused ? t("Paused: Vibe cannot use the mouse or keyboard") : g.scope === "control" ? t("Vibe is using this computer · {n} min left", { n: minutes }) : t("Vibe can see your screen · {n} min left", { n: minutes });
    text.title = t("Stop at any time with {shortcut}.", { shortcut: st.stopShortcut });
    stop.title = text.title;
    toggle.hidden = g.scope !== "control";
    toggle.textContent = paused ? t("Resume") : t("Pause");
  }

  toggle.addEventListener("click", () => invoke(paused ? "computer_resume" : "computer_pause").then(refresh, refresh));
  stop.addEventListener("click", () => invoke("computer_stop").catch(() => {}));
  tauri?.event?.listen?.("openfini://computer", refresh);
  setInterval(refresh, 15000);
  refresh();
}
