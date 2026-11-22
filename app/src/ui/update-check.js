// Update UI: the "Updates" rows in Settings > About, Help > Check for Updates and the optional background check.
// The desktop app updates itself through the Tauri updater plugin (core/update-flow.js is the state machine, the
// dialog is ui/update-dialog.js). Builds without a configured update key, portable copies and the web app fall back to
// the release page (core/updates.js). Honors offline mode (`app.network.assert("update")`).
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { buildInfo } from "../core/env.js";
import { checkForUpdates, compareVersions, detectPlatform, RELEASES_PAGE } from "../core/updates.js";
import { shouldAutoCheck, shouldPrompt } from "../core/update-policy.js";
import { createUpdateFlow, updatePolicy } from "../core/update-flow.js";
import { platform } from "../platform/index.js";
import { openLink } from "./links.js";

/** The Tauri updater bridge, or null in the browser. A missing plugin (no public key in this build) throws "not registered". */
function nativeUpdater() {
  const T = typeof window !== "undefined" ? window.__TAURI__ : null;
  if (!platform.isDesktop || !T?.core) return null;
  return {
    check() {
      if (!T.updater?.check) throw new Error("updater plugin not registered");
      return T.updater.check();
    },
    relaunch: () => T.process.relaunch(),
    installKind: () => T.core.invoke("update_install_kind"),
  };
}

/** The one update flow of this window (created on first use). */
export async function getFlow(app) {
  if (app._updateFlow) return app._updateFlow;
  const info = await buildInfo();
  app._updateFlow = createUpdateFlow({
    native: nativeUpdater(),
    current: info?.version || "",
    policy: updatePolicy({ auto: app.prefs.updateCheckAuto, autoDownload: app.prefs.updateAutoDownload }),
    canCheck: () => app.network?.assert("update"),
    saveWork: async () => app.autosaveNow?.(), // the recovery store: restored at the next start
  });
  return app._updateFlow;
}

/** Legacy check against the GitHub releases API (release page fallback). Returns the result of `checkForUpdates`. */
export async function runUpdateCheck(app) {
  try {
    app.network?.assert("update");
  } catch (err) {
    return { status: "blocked", reason: err.message };
  }
  const info = await buildInfo();
  const result = await checkForUpdates({ current: info?.version || null, ...detectPlatform(navigator.userAgent) });
  app.setPref("updateLastCheck", Date.now());
  if (result.status === "available") app.setPref("updateSeenVersion", result.release.version);
  return result;
}

/** Runs a check (native when possible) and returns the flow state; a manual "unconfigured" state carries the legacy result. */
export async function checkNow(app) {
  const flow = await getFlow(app);
  flow.setPolicy(updatePolicy({ auto: app.prefs.updateCheckAuto, autoDownload: app.prefs.updateAutoDownload }));
  const state = await flow.check();
  app.setPref("updateLastCheck", Date.now());
  if (state.phase === "available") app.setPref("updateSeenVersion", state.version);
  if (state.phase === "manual" && state.reason !== "package") {
    const legacy = await runUpdateCheck(app);
    return { ...state, legacy };
  }
  return state;
}

/** Help > Check for Updates. */
export async function checkForUpdatesCommand(app) {
  const { showUpdateDialog } = await import("./update-dialog.js");
  showUpdateDialog(app);
}

/** Start-up hook: checks at most once a day, only when automatic checks are on (off by default). Never opens a modal:
 *  a quiet toast says an update is available (or, with background download, ready) and offers to open the dialog. */
export async function maybeAutoCheck(app) {
  const dev = !(await buildInfo())?.version;
  if (!shouldAutoCheck({ auto: app.prefs.updateCheckAuto, lastCheck: app.prefs.updateLastCheck, offline: !!app.prefs.offlineMode, safeMode: app.safeMode, dev })) return;
  const open = async () => (await import("./update-dialog.js")).showUpdateDialog(app, { noCheck: true });
  const s = await checkNow(app);
  if (s.phase === "available") {
    if (app.prefs.updateSkipped === s.version) return;
    if (app.prefs.updateAutoDownload) {
      const flow = await getFlow(app);
      if ((await flow.download()).phase === "ready") app.toast(t("OpenFini {version} is ready to install.", { version: s.version }), "success", 9000, { label: t("Restart now"), run: open });
      return;
    }
    app.toast(t("OpenFini {version} is available.", { version: s.version }), "primary", 9000, { label: t("View"), run: open });
  } else if (s.legacy?.status === "available" && shouldPrompt({ release: s.legacy.release, current: s.legacy.current, skipped: app.prefs.updateSkipped, compare: compareVersions })) {
    app.toast(t("OpenFini {version} is available.", { version: s.legacy.release.version }), "primary", 9000, { label: t("View"), run: async () => (await import("./update-dialog.js")).showUpdateDialog(app) });
  }
}

/** Rows for Settings > About. */
export function updateRows(app, { button }) {
  const status = h("div.of-set__hint", { role: "status", "aria-live": "polite" }, app.prefs.updateLastCheck ? t("Last checked {date}.", { date: new Date(app.prefs.updateLastCheck).toLocaleString() }) : t("Not checked yet."));
  const check = button("Check for updates", async () => {
    status.textContent = t("Checking…");
    await checkForUpdatesCommand(app);
    status.textContent = t("Last checked {date}.", { date: new Date(app.prefs.updateLastCheck || Date.now()).toLocaleString() });
  });
  const sw = (key, label) => {
    const el = h("sl-switch", { size: "small", "aria-label": label });
    el.checked = !!app.prefs[key];
    el.addEventListener("sl-change", () => app.setPref(key, el.checked));
    return el;
  };
  return [
    h("div.of-set__row", h("div.of-set__label", t("Updates")), h("div.of-set__ctl", check)),
    status,
    h("div.of-set__row", h("div.of-set__label", t("Check automatically"), h("div.of-set__hint", t("At most once a day, at start-up; a newer version shows a quiet message, never a dialog. Contacts github.com only; nothing about you is sent. Off by default: OpenFini never checks unless you switch this on."))), h("div.of-set__ctl", sw("updateCheckAuto", t("Check for updates automatically")))),
    h("div.of-set__row", h("div.of-set__label", t("Download updates in the background"), h("div.of-set__hint", t("Only with automatic checks. The update is downloaded and verified, then waits until you choose Restart now. Desktop app only."))), h("div.of-set__ctl", sw("updateAutoDownload", t("Download updates in the background")))),
    h("div.of-set__row", h("div.of-set__label", t("All releases")), h("div.of-set__ctl", button(t("Open"), () => openLink(RELEASES_PAGE)))),
  ];
}
