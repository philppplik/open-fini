// Update check UI: the "Updates" rows in Settings ▸ About and the optional automatic check at start-up.
// Logic lives in core/updates.js (pure, tested). Nothing is installed automatically: the user is pointed to the
// release page or the installer that fits the platform. Honors offline mode (`app.network.assert("update")`).
import { h } from "../core/util.js";
import { buildInfo } from "../core/env.js";
import { checkForUpdates, detectPlatform, RELEASES_PAGE } from "../core/updates.js";
import { openLink } from "./links.js";

const DAY = 24 * 60 * 60 * 1000;

/** Runs one check. Returns the result object of `checkForUpdates`, or `{status:"blocked"|"unknown"}`. */
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

/** Start-up hook: checks at most once a day, only when the user switched automatic checks on. */
export async function maybeAutoCheck(app) {
  if (!app.prefs.updateCheckAuto || app.safeMode) return;
  if (Date.now() - (app.prefs.updateLastCheck || 0) < DAY) return;
  const r = await runUpdateCheck(app);
  if (r.status === "available") {
    app.toast(`OpenFini ${r.release.version} is available.`, "primary", 8000, { label: "Details", run: () => openLink(r.release.url) });
  }
}

const sizeMB = (n) => (n ? ` (${(n / 1048576).toFixed(0)} MB)` : "");

/** Rows for Settings ▸ About. */
export function updateRows(app, { button }) {
  const status = h("div.of-set__hint", { role: "status", "aria-live": "polite" }, app.prefs.updateLastCheck ? `Last checked ${new Date(app.prefs.updateLastCheck).toLocaleString()}.` : "Not checked yet.");
  const actions = h("div.of-set__ctl");
  const check = button("Check for updates", async () => {
    status.textContent = "Checking…";
    actions.replaceChildren(check);
    const r = await runUpdateCheck(app);
    if (r.status === "available") {
      status.textContent = `Version ${r.release.version} is available (you have ${r.current}).`;
      const row = [check];
      if (r.release.asset) row.push(button(`Download installer${sizeMB(r.release.asset.size)}`, () => openLink(r.release.asset.url)));
      row.push(button("Release notes", () => openLink(r.release.url)));
      actions.replaceChildren(...row);
    } else if (r.status === "current") status.textContent = `OpenFini ${r.current} is up to date.`;
    else if (r.status === "blocked") status.textContent = r.reason;
    else status.textContent = r.reason || "The check did not work.";
  });
  actions.append(check);
  const auto = h("sl-switch", { size: "small", "aria-label": "Check for updates automatically" });
  auto.checked = !!app.prefs.updateCheckAuto;
  auto.addEventListener("sl-change", () => app.setPref("updateCheckAuto", auto.checked));
  return [
    h("div.of-set__row", h("div.of-set__label", "Updates"), actions),
    status,
    h("div.of-set__row", h("div.of-set__label", "Check automatically", h("div.of-set__hint", "At most once a day, at start-up. Contacts github.com only; nothing about you is sent. Off by default.")), h("div.of-set__ctl", auto)),
    h("div.of-set__row", h("div.of-set__label", "All releases"), h("div.of-set__ctl", button("Open", () => openLink(RELEASES_PAGE)))),
  ];
}
