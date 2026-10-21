// One place where links leave OpenFini for the user's browser or mail program. It honors the "Ask before opening links
// in your browser" setting (prefs.confirmExternal) and refuses anything but http(s), mailto and tel.
import { platform } from "../platform/index.js";
import { confirmDialog } from "./dialogs.js";
import { log } from "../core/log.js";

/** Normalizes protocol-relative links and returns null for anything that must not be opened. */
export function normalizeLink(href) {
  const s = String(href ?? "").trim();
  if (!s) return null;
  const url = s.startsWith("//") ? `https:${s}` : s;
  return /^(https?:|mailto:|tel:)/i.test(url) ? url : null;
}

/**
 * Opens a link in the default browser, asking first when the setting is on.
 * @param {string} href
 * @param {{app?: object, confirmed?: boolean}} [o] `confirmed: true` when the user just saw this exact address in a
 *   dialog of their own (for example the issue preview) and the extra question would only repeat it.
 * @returns {Promise<boolean>} true when the link was handed to the system
 */
export async function openLink(href, { app = globalThis.openfini, confirmed = false } = {}) {
  const url = normalizeLink(href);
  if (!url) {
    log.warn("links", "Refused to open a link with an unsupported scheme");
    return false;
  }
  if (!confirmed && app?.prefs?.confirmExternal !== false) {
    const shown = url.length > 160 ? `${url.slice(0, 160)}…` : url;
    const ok = await confirmDialog({ title: "Open link", message: `Open ${shown} in your browser?`, ok: "Open" });
    if (!ok) return false;
  }
  try {
    await platform.openExternal(url);
    return true;
  } catch (err) {
    log.warn("links", "Could not open a link", err);
    app?.toast?.("The link could not be opened.", "warning", 3000);
    return false;
  }
}
