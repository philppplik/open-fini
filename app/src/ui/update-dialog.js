// "Version X is available" dialog (lazy). Install = open the installer asset (or the release page); nothing installs
// by itself and no signing infrastructure is involved. "Skip this version" is remembered in prefs.updateSkipped.
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { summarizeNotes } from "../core/update-policy.js";
import { openDialog } from "./dialogs.js";
import { openLink } from "./links.js";

export function showUpdateDialog(app, { release, current }) {
  const notes = summarizeNotes(release.notes);
  openDialog({
    key: "update-available",
    title: t("Version {version} is available", { version: release.version }),
    width: 480,
    body: h("div", h("p", t("You have {current}.", { current })), notes ? h("pre.of-update-notes", { style: "white-space:pre-wrap;font:inherit;margin:0;max-height:240px;overflow:auto" }, notes) : null),
    buttons: [
      { label: "Skip this version", onClick: (close) => (app.setPref("updateSkipped", release.version), close()) },
      { label: "Later", onClick: (close) => close() },
      { label: release.asset ? "Download installer" : "Open release page", variant: "primary", onClick: (close) => (openLink(release.asset?.url || release.url), close()) },
    ],
  });
}
