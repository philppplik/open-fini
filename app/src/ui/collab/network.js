// Rooms across a network: relay diagnosis ("Test connection"), LAN addresses of a relay (GET /info), join links and QR
// codes, and the "How to start a relay" help. Lazy (loaded by the Collaboration window). Docs: docs/collaboration.md ▸
// Rooms across your network, troubleshooting table there.
//
// API
//   relayInfo(relayUrl) → Promise<info | null>          GET http(s)://<relay>/info (null when unreachable or blocked)
//   diagnose(relayUrl, { app }) → Promise<{ ok, steps: [{ ok, text, fix? }] }>
//   isLoopbackRelay(url)   inviteAddresses(info, relayUrl) → [{ url, label }]   joinLink(info, invite) → string | null
//   qrSvg(text) → SVGElement      relayHelpDialog(app)
// Browser limits (stated in the UI): a page cannot scan the network for relays, cannot read a WebSocket's HTTP status,
// and an https page cannot open ws:// to another machine; the diagnosis infers causes from what it can observe.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { encodeQR, qrToSvgPath } from "../../collab/qr.js";
import { openDialog } from "../dialogs.js";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopbackRelay(url) {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const httpOf = (relayUrl) => {
  const u = new URL(relayUrl);
  return `${u.protocol === "wss:" ? "https:" : "http:"}//${u.host}`;
};

const infoCache = new Map(); // relay url → { at, promise } (the People tab re-renders often)

/** The relay's /info (version, LAN addresses, whether it serves the app). Null when it cannot be read. Cached 20 s. */
export function relayInfo(relayUrl, { timeout = 4000, fresh = false } = {}) {
  const hit = infoCache.get(relayUrl);
  if (hit && !fresh && Date.now() - hit.at < 20_000) return hit.promise;
  const promise = fetchInfo(relayUrl, timeout);
  infoCache.set(relayUrl, { at: Date.now(), promise });
  return promise;
}

async function fetchInfo(relayUrl, timeout) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const res = await fetch(`${httpOf(relayUrl)}/info`, { signal: ctl.signal, cache: "no-store", credentials: "omit" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.app === "openfini-relay" ? j : null;
  } catch {
    return null;
  }
}

/** Addresses other devices can use, from /info: [{ url, label }]. */
export function inviteAddresses(info, relayUrl) {
  if (!info) return [];
  const out = [];
  const pageHttps = typeof location !== "undefined" && location.protocol === "https:";
  const secure = info.wss || [];
  const plain = info.ws || [];
  for (let i = 0; i < Math.max(secure.length, plain.length); i++) {
    // wss first: browsers on other devices need a secure page (and wss) for encryption; the desktop app falls back to ws
    if (secure[i]) out.push({ url: secure[i], label: t("{url} (secure, for browsers and the desktop app)", { url: secure[i] }) });
    if (plain[i] && (!secure[i] || !pageHttps)) out.push({ url: plain[i], label: t("{url} (desktop app and this computer)", { url: plain[i] }) });
  }
  return out.filter((a) => a.url !== relayUrl);
}

/** A link that opens the app served by the relay with the join dialog filled in (secret stays in the fragment). */
export function joinLink(info, invite) {
  if (!info?.servesApp || !invite) return null;
  const relay = invite.slice(0, invite.indexOf("#"));
  let host;
  try {
    host = new URL(relay).host;
  } catch {
    return null;
  }
  const app = (info.appUrls || []).find((u) => u.startsWith("https:") && new URL(u).host === host) || (info.appUrls || []).find((u) => new URL(u).host === host);
  return app ? `${app}#join=${invite}` : null;
}

/** Step-by-step check of a relay address with plain-language fixes. */
export async function diagnose(relayUrl, { app } = {}) {
  const steps = [];
  const add = (ok, text, fix) => (steps.push({ ok, text, fix }), ok);
  let u;
  try {
    u = new URL(relayUrl);
    if (u.protocol !== "ws:" && u.protocol !== "wss:") throw new Error();
  } catch {
    add(false, t("The address is not a relay address."), t("Use ws://host:port/ or wss://host/, for example ws://192.168.1.20:8787/."));
    return { ok: false, steps };
  }
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) add(false, t("This page is not a secure context, so it cannot encrypt."), t("Open OpenFini over https:// (the relay started with --lan serves it), on localhost, or use the desktop app."));
  else add(true, t("This page can encrypt (secure context)."));
  if (app?.prefs?.offlineMode && !isLoopbackRelay(relayUrl)) add(false, t("Offline mode blocks relays on other computers."), t("Turn off offline mode in Settings ▸ Security and privacy."));
  const pageHttps = location.protocol === "https:";
  if (pageHttps && u.protocol === "ws:" && !isLoopbackRelay(relayUrl)) add(false, t("This page is https://, so the browser blocks ws:// to another computer (mixed content). OpenFini tries wss:// on the same port first."), t("Start the relay with --lan (it answers wss:// on the same port), or open the app the relay serves: {url}", { url: `https://${u.host}/` }));
  if (isLoopbackRelay(relayUrl)) add(true, t("{host} is this computer. Other devices cannot use this address: pick a network address for the invite after creating the room.", { host: u.host }));
  const info = await relayInfo(relayUrl, { fresh: true });
  if (info) {
    add(true, t("The relay answers (OpenFini relay {version}).", { version: info.version }));
    if (info.originAllowed === false) add(false, t("The relay does not accept pages from this address ({origin}).", { origin: location.origin }), t("Start the relay with --origin {origin}, or open the app the relay serves.", { origin: location.origin }));
  } else {
    add(false, t("The relay's information page could not be read."), t("Is the relay running (npm run relay -- --lan)? Is the address and port right? On the relay computer, allow the port in the firewall for private networks. Desktop app: only localhost and https relays can be checked this way; the connection test below still works."));
  }
  // try a real WebSocket handshake (a browser does not reveal the HTTP status; a quick close usually means a refused origin)
  const ws = await new Promise((resolve) => {
    let sock;
    const t0 = Date.now();
    try {
      sock = new WebSocket(relayUrl);
    } catch (e) {
      return resolve({ ok: false, blocked: true, error: e.message });
    }
    const done = (r) => {
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        /* closed */
      }
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, timeout: true }), 5000);
    sock.onopen = () => done({ ok: true });
    sock.onerror = () => done({ ok: false, ms: Date.now() - t0 });
  });
  if (ws.ok) add(true, t("A WebSocket connection to the relay works."));
  else if (ws.blocked) add(false, t("The browser refused to open the connection ({error}).", { error: ws.error }), t("Mixed content or an invalid address: use wss:// from https pages."));
  else if (ws.timeout) add(false, t("The connection timed out."), t("A firewall drops the traffic, or the address is wrong. Check that both devices are on the same network (guest Wi-Fi often isolates devices)."));
  else add(false, t("The relay refused or closed the connection."), info ? t("The relay is reachable, so it most likely refused this page's origin: start it with --origin {origin}, or open the app it serves.", { origin: location.origin }) : t("The port is closed or nothing listens there. Start the relay and check the port."));
  return { ok: steps.every((s) => s.ok), steps, info };
}

/** The QR code of `text` as an SVG element (dark modules in the text color, light background, quiet zone). */
export function qrSvg(text, label) {
  const qr = encodeQR(text, { ecl: "M" });
  const n = qr.size + 8;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `-4 -4 ${n} ${n}`);
  svg.setAttribute("class", "of-qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label || t("QR code"));
  const bg = document.createElementNS(ns, "rect");
  Object.entries({ x: -4, y: -4, width: n, height: n, fill: "#ffffff" }).forEach(([k, v]) => bg.setAttribute(k, v));
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", qrToSvgPath(qr));
  path.setAttribute("fill", "#000000");
  svg.append(bg, path);
  return svg;
}

const COMMANDS = [
  { title: "This network (LAN): phones, tablets and laptops", cmd: "npm run relay -- --lan", note: "Binds every interface, serves the app, answers ws:// and wss:// on port 8787 and prints the addresses and a QR code. Other devices open https://<this computer's IP>:8787/ and accept the certificate warning once." },
  { title: "Without the OpenFini sources (Node 20+ only)", cmd: "node relay.mjs --lan", note: "Download scripts/relay.mjs (and scripts/relay-tls.mjs for https, next to it) into any folder and run this command in that folder. “npm run relay” only works inside the OpenFini project folder (elsewhere npm reports ENOENT package.json)." },
  { title: "This computer only", cmd: "npm run relay", note: "ws://127.0.0.1:8787/ for windows on this computer." },
  { title: "A server on the internet (VPS) behind a TLS reverse proxy", cmd: "node scripts/relay.mjs --port 8787 --origin https://your.app.origin", note: "Keep it on 127.0.0.1 and let Caddy (relay.example.org { reverse_proxy 127.0.0.1:8787 }) or nginx (proxy_pass with Upgrade headers, see docs/collaboration.md) terminate TLS. Members use wss://relay.example.org/." },
];

/** "How to start a relay": copyable commands for LAN, a single machine and a server. */
export function relayHelpDialog(app) {
  const copyBtn = (text) => {
    const b = h("button.of-collab-btn", { type: "button" }, h("sl-icon", { name: "copy", "aria-hidden": "true" }), h("span", t("Copy")));
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        app.toast("Copied.", "success", 1500);
      } catch {
        app.toast("Copying failed. Select the command and copy it by hand.", "warning", 3000);
      }
    });
    return b;
  };
  const body = h(
    "div.of-relay-help",
    h("p", t("A relay is a tiny program that forwards the room's encrypted messages. It never sees content.")),
    h("p.of-collab-note", h("sl-icon", { name: "info-circle", "aria-hidden": "true" }), t("Easiest: in the OpenFini desktop app choose Start a room ▸ Your network: start a relay on this computer. No terminal or Node.js needed.")),
    h("p", t("The commands below run the relay with Node.js 20 or newer, for example on a server or so that browsers on phones and tablets can join (they need https).")),
    ...COMMANDS.map((c) => h("section.of-collab-card", h("h3", t(c.title)), h("div.of-relay-help__cmd", h("code", c.cmd), copyBtn(c.cmd)), h("p.of-collab-hint", t(c.note)))),
    h("p.of-collab-hint", t("Browsers cannot search the network for relays. Share the address the relay prints, a join link or its QR code instead.")),
  );
  return openDialog({ title: "How to start a relay", body, width: 600, buttons: [{ label: "Close", variant: "primary", onClick: (close) => close() }] });
}
