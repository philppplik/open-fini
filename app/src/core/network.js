// Offline mode / network kill-switch. One pure policy that every outbound feature asks before it talks to the network:
//
//   app.network.allowed("ai")          // boolean
//   app.network.assert("publish")      // throws NetworkBlockedError with a user-readable message when offline mode is on
//   app.network.allowed("ai", url)     // loopback addresses (localhost, 127.0.0.1, ::1) are never blocked: nothing leaves the device
//
// `kind` is one of NETWORK_KINDS. An unknown kind is treated like "other" and is therefore blocked in offline mode.
// The preference lives in app.prefs.offlineMode (Settings ▸ Security and privacy). This module has no DOM access.

/** Every kind of outbound access, with the label used in messages and in the security overview. */
export const NETWORK_KINDS = Object.freeze({
  ai: "AI providers and MCP servers",
  publish: "Publishing and deployment",
  extension: "Extension network access",
  cdn: "Remote scripts, fonts and images in website previews",
  update: "Update checks",
  oauth: "Sign-in with a provider (OAuth)",
  collab: "Collaboration rooms (relay servers)",
  other: "Other network access",
});

/** Thrown by `assert` while offline mode is on. `kind` names the blocked feature, `code` is always "offline_mode". */
export class NetworkBlockedError extends Error {
  /** @param {string} kind @param {string} message */
  constructor(kind, message) {
    super(message);
    this.name = "NetworkBlockedError";
    this.code = "offline_mode";
    this.kind = kind;
  }
}

/** True for http(s)/ws(s) URLs that point at this device (localhost, *.localhost, 127.x.x.x, ::1). */
export function isLoopbackUrl(url) {
  if (!url) return false;
  let host;
  try {
    host = new URL(String(url), "http://invalid.invalid/").hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

/** The text shown when a feature is blocked by offline mode. */
export function blockedMessage(kind) {
  const what = NETWORK_KINDS[kind] || NETWORK_KINDS.other;
  const text = /^[A-Z][a-z]/.test(what) ? `${what.charAt(0).toLowerCase()}${what.slice(1)}` : what;
  return `Offline mode is on, so nothing was sent: ${text} cannot be used. Turn offline mode off under Settings ▸ Security and privacy.`;
}

/**
 * @param {() => boolean} isOffline reads the current preference (called on every check)
 * @param {{onBlocked?: (info:{kind:string, url?:string}) => void}} [opts] called when a check refuses (for logging)
 */
export function createNetwork(isOffline, { onBlocked } = {}) {
  const net = {
    kinds: NETWORK_KINDS,
    /** True while offline mode is on. */
    get offline() {
      return !!isOffline();
    },
    /** May a feature of this kind use the network right now? */
    allowed(kind, url) {
      if (!isOffline()) return true;
      if (url && isLoopbackUrl(url)) return true;
      try {
        onBlocked?.({ kind: kind in NETWORK_KINDS ? kind : "other", url });
      } catch {
        /* logging must never change the answer */
      }
      return false;
    },
    /** Like `allowed` but throws NetworkBlockedError. */
    assert(kind, url) {
      if (net.allowed(kind, url)) return;
      throw new NetworkBlockedError(kind in NETWORK_KINDS ? kind : "other", blockedMessage(kind));
    },
    message: blockedMessage,
  };
  return net;
}

// ------------------------------------------------------------------ website preview

/** Content-Security-Policy added to website previews in offline mode: nothing remote loads, nothing is sent. */
export const OFFLINE_PREVIEW_CSP = "default-src 'none'; script-src data: 'unsafe-inline'; style-src data: 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src data: blob: about:; form-action 'none'";

/**
 * Adds the offline Content-Security-Policy to a preview document so remote scripts, fonts, images and requests are
 * refused by the browser. Returns the document unchanged when `offline` is false or the policy is already present.
 * @param {string} html
 * @param {boolean} offline
 */
export function withOfflinePreviewCsp(html, offline) {
  if (!offline || typeof html !== "string") return html;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_PREVIEW_CSP}">`;
  if (html.includes(OFFLINE_PREVIEW_CSP)) return html;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length);
  const doctype = /<!doctype[^>]*>/i.exec(html);
  if (doctype) return html.slice(0, doctype.index + doctype[0].length) + `<head>${meta}</head>` + html.slice(doctype.index + doctype[0].length);
  return `<head>${meta}</head>${html}`;
}
