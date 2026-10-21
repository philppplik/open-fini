// Banner at the top of the website preview while protected mode keeps the scripts of a project from outside switched off.
import { h } from "../core/util.js";
import { blockedByProtection } from "../core/security.js";

/** @param {{app: object, ws: {doc: object}, rebuild: () => void, on: Function}} pane the Code studio PreviewPane */
export function protectedBanner(pane) {
  const app = pane.app;
  const enable = h("button.of-btn.of-btn--primary", { type: "button" }, "Enable scripts");
  const el = h("div.of-protbanner.hidden", { role: "status" }, h("sl-icon", { name: "shield-lock", "aria-hidden": "true" }), h("span", "Protected mode: this project came from a file or folder, so its scripts are off. The page is shown without running them."), enable);
  const update = () => el.classList.toggle("hidden", !blockedByProtection(app.prefs, pane.ws.doc));
  enable.addEventListener("click", () => {
    pane.ws.doc.scriptsOk = true;
    update();
    pane.rebuild();
    app.toast("Scripts are enabled for this project in this session. They still run in a sandboxed frame.", "primary", 3500);
  });
  pane.on("built", update);
  app.on("prefs", (key) => {
    update();
    if (["previewScripts", "protectedMode", "offlineMode", "*"].includes(key)) pane.rebuild();
  });
  update();
  return el;
}
