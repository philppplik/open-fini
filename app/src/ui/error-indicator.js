// Small always-loaded pieces of the diagnostics UI: the red error dot in the status bar and the safe-mode banner.
// The Troubleshooting dialog itself (ui/diagnostics-dialog.js) is loaded only when one of them is used.
import { h } from "../core/util.js";
import { log } from "../core/log.js";

/** Status-bar button: invisible until this session logged an error that was not looked at yet. */
export function createErrorIndicator(app) {
  const b = h("button.of-errdot.hidden", { type: "button", "data-tip": "Errors were logged. Open Troubleshooting." }, h("span.of-errdot__dot", { "aria-hidden": "true" }), h("span.of-errdot__n"));
  const n = b.querySelector(".of-errdot__n");
  const update = () => {
    const c = log.unseen;
    b.classList.toggle("hidden", c <= 0);
    n.textContent = c > 99 ? "99+" : String(c);
    b.setAttribute("aria-label", `${c} unread error${c === 1 ? "" : "s"}. Open Troubleshooting.`);
  };
  b.addEventListener("click", () => app.run("help.troubleshoot", { tab: "problems" }));
  log.subscribe(update);
  update();
  return b;
}

/** A thin notice while the app runs in safe mode, with a button that restarts normally. */
export function installSafeBanner(app) {
  if (!app.safeMode || document.querySelector(".of-safebanner")) return;
  const restart = h("button.of-btn", { type: "button" }, "Restart normally");
  restart.addEventListener("click", () => location.assign(location.pathname));
  const info = h("button.of-btn", { type: "button" }, "Troubleshooting");
  info.addEventListener("click", () => app.run("help.troubleshoot"));
  document.body.append(h("div.of-safebanner", { role: "status" }, h("strong", "Safe mode"), h("span", " — your last session was not restored, extensions and AI are off, and your saved settings are not applied."), restart, info));
}
