// Software update dialog (lazy), drawn from the update flow state (core/update-flow.js): version, date and notes, then
// "Download and install" with a progress bar, then "Restart now" / "Later". Builds without update signing, portable
// copies, package-manager installs and the web app get the matching hint instead. "Skip this version" is remembered
// in prefs.updateSkipped.
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { summarizeNotes } from "../core/update-policy.js";
import { openDialog } from "./dialogs.js";
import { openLink } from "./links.js";
import { checkNow, getFlow } from "./update-check.js";
import { RELEASES_PAGE } from "../core/updates.js";

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const errorText = {
  signature: () => t("The update could not be verified (its signature does not match), so it was not installed. Nothing on your computer was changed."),
  offline: () => t("OpenFini could not reach github.com. Check your connection and try again."),
  failed: () => t("The update did not work."),
};

export async function showUpdateDialog(app, { noCheck = false } = {}) {
  const flow = await getFlow(app);
  const body = h("div", { style: "min-height:96px" });
  const footer = h("div", { style: "display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap" });
  let legacy = null;
  let close = () => {};
  const btn = (label, onClick, variant = "default") => {
    const b = h("sl-button", { variant, size: "medium" }, label);
    b.addEventListener("click", onClick);
    return b;
  };
  const notes = (s) => {
    const text = summarizeNotes(s.notes);
    return text ? h("pre", { style: "white-space:pre-wrap;font:inherit;margin:8px 0 0;max-height:220px;overflow:auto" }, text) : null;
  };
  const headline = (s) => h("p", { style: "margin:0" }, h("strong", t("Version {version} is available", { version: s.version })), s.date ? ` (${new Date(s.date).toLocaleDateString()})` : "", " - ", t("You have {current}.", { current: s.current }));

  function render(s) {
    const msg = (text) => [h("p", { style: "margin:0", role: "status" }, text)];
    let content = [];
    let buttons = [btn(t("Close"), () => close())];
    switch (s.phase) {
      case "checking":
        content = msg(t("Checking for updates…"));
        buttons = [];
        break;
      case "current":
        content = [h("p", { style: "margin:0" }, t("OpenFini {current} is up to date.", { current: s.current }))];
        break;
      case "available":
        content = [headline(s), notes(s)];
        buttons = [btn(t("Skip this version"), () => (app.setPref("updateSkipped", s.version), close())), btn(t("Later"), () => close()), btn(t("Download and install"), () => flow.download(), "primary")];
        break;
      case "downloading": {
        const bar = h("progress", { max: s.total || 1, value: s.total ? s.downloaded : undefined, style: "width:100%", "aria-label": t("Download progress") });
        content = [h("p", { style: "margin:0 0 8px" }, t("Downloading version {version}…", { version: s.version })), bar, h("p", { style: "margin:8px 0 0", "aria-live": "polite" }, s.total ? t("{done} of {total}", { done: mb(s.downloaded), total: mb(s.total) }) : mb(s.downloaded))];
        buttons = [];
        break;
      }
      case "ready":
        content = [h("p", { style: "margin:0" }, t("Version {version} is downloaded and verified.", { version: s.version })), h("p", { style: "margin:8px 0 0" }, t("OpenFini closes to install it and starts again. Your open documents are autosaved on this device first and restored afterwards; save files you want on disk now. On Windows the installer closes the app.")), notes(s)];
        buttons = [btn(t("Later"), () => close()), btn(t("Restart now"), () => flow.install(), "primary")];
        break;
      case "installing":
        content = msg(t("Installing… OpenFini restarts in a moment."));
        buttons = [];
        break;
      case "error":
        content = [h("p", { style: "margin:0", role: "alert" }, errorText[s.error.kind]()), s.error.kind !== "signature" && s.error.message ? h("p", { style: "margin:8px 0 0;opacity:.7;word-break:break-word" }, s.error.message.slice(0, 200)) : null];
        buttons = [btn(t("Close"), () => close()), btn(t("Try again"), () => checkNow(app).then(() => render(flow.state)), "primary")];
        break;
      case "blocked":
        content = [h("p", { style: "margin:0" }, s.reason || t("Offline mode is on."))];
        break;
      case "web":
        content = msg(t("You are using the web version. It updates itself: reload the page to get the newest version."));
        buttons = [btn(t("Close"), () => close()), btn(t("Reload"), () => location.reload(), "primary")];
        break;
      case "manual":
        if (s.reason === "package") content = msg(t("This copy was installed with a package manager. Update it with your package manager."));
        else if (legacy?.status === "available") {
          content = [h("p", { style: "margin:0" }, h("strong", t("Version {version} is available", { version: legacy.release.version })), " - ", t("You have {current}.", { current: legacy.current })), notes({ notes: legacy.release.notes }), h("p", { style: "margin:8px 0 0;opacity:.7" }, s.reason === "portable" ? t("This copy cannot update itself. Download the new version from the release page.") : t("In-app updates are not set up in this build. Download the new version from the release page."))];
          buttons = [btn(t("Close"), () => close()), btn(t("Open release page"), () => (openLink(legacy.release.url || RELEASES_PAGE), close()), "primary")];
        } else if (legacy?.status === "current") content = [h("p", { style: "margin:0" }, t("OpenFini {current} is up to date.", { current: legacy.current }))];
        else content = [h("p", { style: "margin:0" }, legacy?.reason || t("The check did not work."))];
        break;
      default:
        content = msg(t("Checking for updates…"));
        buttons = [];
    }
    body.replaceChildren(...content.filter(Boolean));
    footer.replaceChildren(...buttons);
  }

  const dialog = openDialog({ key: "update-available", title: "Software update", width: 480, body: h("div", body, footer) });
  close = dialog.close;
  const unsub = flow.subscribe(render);
  dialog.dlg.addEventListener("sl-after-hide", (e) => e.target === dialog.dlg && unsub());
  const phase = flow.state.phase;
  if (!noCheck || phase === "idle") {
    if (!["downloading", "ready", "installing"].includes(phase)) {
      const s = await checkNow(app);
      legacy = s.legacy || null;
      render(flow.state);
    }
  }
}
