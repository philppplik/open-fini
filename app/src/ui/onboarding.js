// Onboarding: the welcome and per-studio tour invitations, "What's new", and the "What's this?" help mode.
// Loaded lazily after start-up (boot.js). Nothing here blocks the UI: invitations are small cards, never modal.
import { h } from "../core/util.js";
import { startTour, isTourActive, endTour, applicableSteps } from "./tour.js";
import { TOURS } from "./tour-steps.js";
import { WHATS_NEW, whatsNewFor, latestVersion } from "./whats-new.js";

const STUDIO_TOURS = ["vector", "pixel", "layout", "code", "vibe"];
let nudge = null;

/** Automation (browser tests, WebDriver) and ?notour never get invitations. */
const quiet = () => navigator.webdriver === true || new URLSearchParams(location.search).has("notour");
const dialogOpen = () => !!document.querySelector("sl-dialog[open], .of-palette");

function markSeen(app, key) {
  app.setPref("toursSeen", { ...(app.prefs.toursSeen || {}), [key]: true });
}

export function closeNudge() {
  nudge?.remove();
  nudge = null;
}

function showNudge(app, key, { title, text, action }) {
  closeNudge();
  const start = h("button.of-btn.of-btn--primary", { type: "button" }, action);
  const later = h("button.of-btn", { type: "button" }, "Not now");
  const never = h("button.of-coach__link", { type: "button" }, "Don't show tours");
  nudge = h("div.of-nudge", { role: "region", "aria-label": title }, h("strong", title), h("p", text), h("div.of-nudge__row", later, start), never);
  start.addEventListener("click", () => {
    closeNudge();
    markSeen(app, key);
    runTour(app, key);
  });
  later.addEventListener("click", () => {
    closeNudge();
    markSeen(app, key);
  });
  never.addEventListener("click", () => {
    closeNudge();
    app.setPref("tours", false);
    app.toast("Tours are off. You can still start one from Help, Take the tour.", "primary", 3600);
  });
  document.body.append(nudge);
}

/** Runs a tour now (waits briefly for a studio's UI to mount) and records the outcome. */
export async function runTour(app, key) {
  if (!TOURS[key]) return false;
  for (let tries = 0; tries < 12 && !applicableSteps(app, key).length; tries++) await new Promise((r) => setTimeout(r, 150));
  closeNudge();
  const result = await startTour(app, key);
  markSeen(app, key);
  if (result === "never") {
    app.setPref("tours", false);
    app.toast("Tours are off. You can still start one from Help, Take the tour.", "primary", 3600);
  }
  return result !== "skipped" || applicableSteps(app, key).length > 0;
}

/** The tour of the studio you are in (Help ▸ Take a studio tour). */
export const runStudioTour = (app) => runTour(app, STUDIO_TOURS.includes(app.studio) ? app.studio : "welcome");

/** Forget which tours were seen so every invitation and What's new appear again. */
export function resetTours(app) {
  app.setPref("toursSeen", {});
  app.setPref("whatsNewSeen", "0"); // anything but empty: "empty" means first run
  app.setPref("tours", true);
}

export async function currentVersion() {
  try {
    const r = await fetch("./build-info.json", { cache: "no-store" });
    if (r.ok) return (await r.json()).version || latestVersion();
  } catch {
    /* development server: no build info */
  }
  return latestVersion();
}

export async function showWhatsNew(app, version) {
  const v = version || (await currentVersion());
  const entry = whatsNewFor(v) || WHATS_NEW[0];
  const { openDialog } = await import("./dialogs.js");
  const list = h("ul.of-whatsnew", entry.items.map((it) => h("li", h("sl-icon", { name: it.icon }), h("div", h("strong", it.title), h("p", it.text)))));
  const body = h("div", h("p.of-dialog__text", `Version ${entry.version}: ${entry.title}`), list, h("p.of-hint", "The complete list of changes is in the changelog on GitHub."));
  openDialog({
    title: "What's new in OpenFini",
    body,
    width: 560,
    buttons: [
      { label: "Take the tour", onClick: (close) => { close(); runTour(app, "welcome"); } },
      { label: "Got it", variant: "primary", onClick: (c) => c() },
    ],
  });
  app.setPref("whatsNewSeen", entry.version);
}

// ------------------------------------------------------------------ What's this? (Shift+F1)

let whatsThis = null;

export function toggleWhatsThis(app) {
  if (whatsThis) return whatsThis.end();
  endTour();
  const root = document.documentElement;
  root.classList.add("of-whatsthis");
  const banner = h("div.of-whatsthis__banner", { role: "status" }, h("sl-icon", { name: "question-circle" }), "What's this? Click anything to see what it does. Press Esc to stop.");
  let card = null;
  document.body.append(banner);

  const clear = () => {
    card?.remove();
    card = null;
  };
  async function explain(e) {
    if (e.target.closest?.(".of-whatsthis__card, .of-whatsthis__banner")) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type !== "click") return;
    const { describeElement } = await import("./help-content.js");
    const info = describeElement(e.target, app) || { title: "Not much to explain here", text: "Try clicking a tool, a panel tab, a button in the header or the canvas." };
    clear();
    const sc = info.shortcut ? h("kbd", info.shortcut) : null;
    card = h("div.of-whatsthis__card", { role: "dialog", "aria-label": info.title || "Help" }, h("strong", info.title || "Help", sc ? h("span", " ") : null, sc), info.text ? h("p", info.text) : null);
    document.body.append(card);
    const w = card.offsetWidth;
    const hgt = card.offsetHeight;
    card.style.left = `${Math.max(8, Math.min(e.clientX + 12, innerWidth - w - 8))}px`;
    card.style.top = `${Math.max(8, Math.min(e.clientY + 14, innerHeight - hgt - 8))}px`;
    banner.setAttribute("aria-label", `${info.title}. ${info.text || ""}`);
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      end();
    }
  }
  function end() {
    root.classList.remove("of-whatsthis");
    banner.remove();
    clear();
    for (const t of ["pointerdown", "pointerup", "click", "mousedown", "mouseup", "contextmenu"]) document.removeEventListener(t, explain, true);
    document.removeEventListener("keydown", onKey, true);
    whatsThis = null;
  }
  for (const t of ["pointerdown", "pointerup", "click", "mousedown", "mouseup", "contextmenu"]) document.addEventListener(t, explain, true);
  document.addEventListener("keydown", onKey, true);
  whatsThis = { end };
}

// ------------------------------------------------------------------ automatic invitations

export function installOnboarding(app) {
  if (quiet()) return;
  let pending = 0;

  const welcomed = () => !!app.prefs.toursSeen?.welcome;
  function maybeInvite() {
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (!app.prefs.tours || nudge || isTourActive() || dialogOpen()) return;
      if (!welcomed()) {
        if (app.studio === "vibe" && !app.doc) return;
        return showNudge(app, "welcome", { title: "New to OpenFini?", text: "Take a one-minute tour of the interface. You can repeat it any time from Help, Take the tour.", action: "Start the tour" });
      }
      const key = app.studio;
      if (!TOURS[key] || app.prefs.toursSeen?.[key]) return;
      if (key !== "vibe" && !app.doc) return; // the studio's tools and panels only exist with a document
      if (!applicableSteps(app, key).length) return;
      showNudge(app, key, { title: `First time in the ${TOURS[key].title}?`, text: "A short tour shows the tools and panels you will use most.", action: "Show me" });
    }, 900);
  }
  for (const ev of ["studio", "doc"]) app.on(ev, maybeInvite);

  // What's new: first runs only get the welcome invitation; later version changes get the dialog
  (async () => {
    const v = await currentVersion();
    const seen = app.prefs.whatsNewSeen;
    if (!seen) {
      app.setPref("whatsNewSeen", v);
      return;
    }
    if (seen !== v && whatsNewFor(v) && app.prefs.tours) setTimeout(() => !dialogOpen() && showWhatsNew(app, v), 1500);
  })();
  maybeInvite();
}
