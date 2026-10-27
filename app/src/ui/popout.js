// Pop-out windows runtime (lazy module): opens extra OpenFini windows, hands documents over, returns them, keeps
// shared preferences in sync. The pure parts (envelope, url params, registry) are in platform/popout.js.
//
// Public API
//   installWindowing(app)                      every window, once at boot: channel listener, prefs sync, recovery
//   bootPopout(app, params)                    popout window only: studio, document handoff, autosave namespace, close guard
//   popoutDoc(app, doc, { mode })              "move" (default) or "copy" a document into a new window
//   popoutStudio(app, studioId)                new window showing a studio (hands over the current doc if it belongs there)
//   newWindow(app)                             empty new window on the current studio
//   returnToMain(app)                          send every document of this popout back to the main window
//   isPopoutWindow()                           true inside a pop-out
// Invariants: a document is only closed in the source window after the receiving window confirmed ("adopted");
// a failed handoff leaves the source untouched. Handoff envelopes live in IndexedDB under popout:<id> until adopted.
// See docs/multi-window.md.
import { platform } from "../platform/index.js";
import { windowControls } from "../platform/window-controls.js";
import { CHANNEL, buildPopoutUrl, createPopoutRegistry, handoffKey, isMessage, makeEnvelope, newId, nextWindowLabel, parsePopoutParams, readEnvelope, sessionKey } from "../platform/popout.js";
import { kvDelete, kvGet, kvKeys, kvSet } from "../core/storage.js";
import { saveOfini, loadOfini } from "../core/ofini.js";
import { hasStudio } from "../studios/registry.js";
import { confirmDialog } from "./dialogs.js";

const PREF_KEY = "openfini.prefs.v1";
const registry = createPopoutRegistry();
let channel = null;
let me = null; // params of this window when it is a pop-out
const waiters = new Set();

export const isPopoutWindow = () => !!me;
const docStudio = (doc) => (["pixel", "layout", "code"].includes(doc.studio) ? doc.studio : "vector");
const post = (msg) => {
  try {
    channel?.postMessage(msg);
  } catch {
    /* closed */
  }
};
/** Resolves true when `type` for `id` arrives within `ms`. */
function waitFor(type, id, ms) {
  return new Promise((resolve) => {
    const w = { type, id, done: (v) => (waiters.delete(w), clearTimeout(t), resolve(v)) };
    const t = setTimeout(() => w.done(false), ms);
    waiters.add(w);
  });
}

// ------------------------------------------------------------------------------------------ opening windows

/** Opens the window; resolves true when it was created. Must run inside the user gesture for the web fallback. */
async function openWindow({ studio, doc, pid, size = { w: 1280, h: 840, minW: 720, minH: 480 } }) {
  const url = buildPopoutUrl(platform.isDesktop ? "index.html" : location.pathname, { studio, doc, pid });
  if (platform.isDesktop) {
    const W = window.__TAURI__?.webviewWindow?.WebviewWindow;
    if (!W) throw new Error("The Tauri window API is not available (app.withGlobalTauri).");
    const label = nextWindowLabel(registry.labels());
    const mac = windowControls.mode === "overlay";
    const win = new W(label, { url, title: "OpenFini", width: size.w, height: size.h, minWidth: size.minW, minHeight: size.minH, decorations: mac, ...(mac ? { titleBarStyle: "overlay", hiddenTitle: true } : {}) });
    await new Promise((resolve, reject) => {
      win.once("tauri://created", resolve);
      win.once("tauri://error", (e) => reject(new Error(typeof e.payload === "string" ? e.payload : "The window could not be created.")));
    });
    registry.add({ id: pid, label, studio });
    win.once("tauri://destroyed", () => registry.remove(pid));
    return true;
  }
  // Browsers cannot create frameless windows: a popup window with the browser's own chrome is the closest thing.
  const w = window.open(url, `openfini-${pid}`, `popup=yes,width=${size.w},height=${size.h}`);
  if (!w) return false;
  registry.add({ id: pid, label: null, studio });
  const t = setInterval(() => w.closed && (clearInterval(t), registry.remove(pid)), 2000);
  return true;
}

/** Opens the UI-only Collaboration pop-out (?popout=collab). Resolves with its window id, or null (blocked). Run it inside a user gesture. */
export async function popoutCollab(app) {
  const pid = newId();
  try {
    return (await openWindow({ studio: "collab", pid, size: { w: 560, h: 720, minW: 340, minH: 320 } })) ? pid : null;
  } catch (err) {
    app.toast(err.message, "danger", 6000);
    return null;
  }
}

/** Hands one document to a new window. mode "move" closes it here once the new window has it. */
export async function popoutDoc(app, doc, { mode = "move", studio } = {}) {
  if (!doc) return false;
  if (mode === "move" && !doc.saved && !(await confirmDialog({ title: "Move to new window", message: `“${doc.name}” has unsaved changes. They move with the document: the whole current state is handed over.`, ok: "Move" }))) return false;
  const id = newId();
  const pid = newId();
  const target = studio || docStudio(doc);
  let opened = false;
  try {
    opened = await openWindow({ studio: target, doc: id, pid }); // first: the web fallback needs the click's user gesture
  } catch (err) {
    app.toast(err.message, "danger", 6000);
    return false;
  }
  if (!opened) {
    app.toast("Your browser blocked the new window. Allow pop-ups for this site and try again.", "warning", 6000);
    return false;
  }
  try {
    const bytes = await saveOfini(doc);
    await kvSet(handoffKey(id), makeEnvelope({ id, name: doc.name, studio: target, saved: doc.saved, path: doc.path, untrusted: !!doc.untrusted && !doc.scriptsOk, bytes, mode }));
    registry.attachDoc(pid, id);
  } catch (err) {
    app.toast(`The document could not be handed over: ${err.message}`, "danger", 6000);
    return false;
  }
  if (!(await waitFor("adopted", id, 12000))) {
    await kvDelete(handoffKey(id));
    app.toast("The new window did not take the document. It stays here.", "warning", 5000);
    return false;
  }
  if (mode === "move") app.closeDoc(doc);
  return true;
}

export async function popoutStudio(app, studioId = app.studio) {
  if (!hasStudio(studioId)) return false;
  const doc = app.doc && (app.doc.studio === studioId || (studioId === "vector" && docStudio(app.doc) === "vector")) ? app.doc : null;
  if (doc) return popoutDoc(app, doc, { mode: "move", studio: studioId });
  return openEmpty(app, studioId);
}
export const newWindow = (app) => openEmpty(app, app.studio);

async function openEmpty(app, studio) {
  try {
    if (!(await openWindow({ studio, pid: newId() }))) app.toast("Your browser blocked the new window. Allow pop-ups for this site and try again.", "warning", 6000);
  } catch (err) {
    app.toast(err.message, "danger", 6000);
  }
}

// ------------------------------------------------------------------------------------------ receiving

async function readHandoff(id, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const env = readEnvelope(await kvGet(handoffKey(id)));
    if (env || Date.now() > end) return env;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Opens the document of handoff `id` in this window; confirms to the sender. */
async function adopt(app, id) {
  const env = await readHandoff(id);
  if (!env) return false;
  const doc = await loadOfini(env.bytes);
  doc.name = env.name || doc.name;
  doc.path = env.path;
  doc.saved = env.saved;
  if (env.untrusted) doc.untrusted = true;
  app.openDoc(doc);
  app.setStudio(docStudio(doc));
  requestAnimationFrame(() => app.cv?.fitPage());
  await kvDelete(handoffKey(id));
  post({ type: "adopted", id });
  return true;
}

export async function bootPopout(app, params) {
  me = params;
  app.popout = params;
  app.sessionKey = sessionKey(params.id);
  document.documentElement.classList.add("is-popout");
  if (params.studio && hasStudio(params.studio)) app.setStudio(params.studio);
  if (params.doc && !(await adopt(app, params.doc))) app.toast("The document for this window could not be found.", "warning", 6000);
  // closing: offer to return the documents to the main window; unsaved ones are also autosaved for recovery
  const normal = app.confirmQuit;
  app.confirmQuit = async () => {
    if (app.docs.length) {
      const r = await confirmDialog({ title: "Close window", message: "Send this window’s documents back to the main window?", ok: "Send back", extra: "Close without sending", cancel: "Cancel" });
      if (r === false) return false;
      if (r === true) {
        await returnToMain(app, { keepOpen: true });
        if (app.docs.length) return false; // nobody took them
      }
    }
    if (!(await normal?.())) return false;
    await kvDelete(app.sessionKey);
    return true;
  };
  window.addEventListener("beforeunload", (e) => {
    if (!platform.isDesktop && app.docs.some((d) => !d.saved)) e.preventDefault();
  });
  window.addEventListener("pagehide", () => post({ type: "closed", id: params.id }));
}

export async function returnToMain(app, { keepOpen = false } = {}) {
  if (!me) return app.toast("This is the main window.", "primary", 2000);
  for (const doc of [...app.docs]) {
    const id = newId();
    await kvSet(handoffKey(id), makeEnvelope({ id, name: doc.name, studio: docStudio(doc), saved: doc.saved, path: doc.path, bytes: await saveOfini(doc), mode: "move" }));
    post({ type: "return", id });
    if (!(await waitFor("adopted", id, 4000))) {
      await kvDelete(handoffKey(id));
      app.toast("The main window did not answer. Keep this window open, or save the document.", "warning", 6000);
      return false;
    }
    app.closeDoc(doc);
  }
  if (!keepOpen) {
    await kvDelete(app.sessionKey);
    if (platform.isDesktop) windowControls.close();
    else window.close();
  }
  return true;
}

// ------------------------------------------------------------------------------------------ recovery

/** Main window: unsaved documents of pop-outs that vanished (crash, browser window closed) come back as tabs. */
export async function recoverPopouts(app, onlyId) {
  const keys = (await kvKeys()).filter((k) => k.startsWith("popout-session:") && (!onlyId || k === sessionKey(onlyId)));
  if (!keys.length) return 0;
  const live = new Set();
  const listen = (ev) => ev.data?.type === "pong" && live.add(ev.data.id);
  channel?.addEventListener("message", listen);
  post({ type: "ping" });
  await new Promise((r) => setTimeout(r, 500));
  channel?.removeEventListener("message", listen);
  let n = 0;
  for (const key of keys) {
    if (live.has(key.slice("popout-session:".length))) continue;
    const s = await kvGet(key);
    for (const e of s?.docs || []) {
      if (e.saved) continue; // already on disk or in the file the user saved
      try {
        const doc = await loadOfini(e.bytes);
        doc.path = e.path;
        doc.saved = false;
        app.openDoc(doc, { activate: false });
        n++;
      } catch {
        /* corrupt entry */
      }
    }
    await kvDelete(key);
  }
  if (n) app.toast(`Recovered ${n} unsaved document${n === 1 ? "" : "s"} from a closed window.`, "success", 4000);
  return n;
}

// ------------------------------------------------------------------------------------------ shared preferences

/** localStorage is shared per origin: a change in one window updates the others (no write back, so no loops). */
function installPrefSync(app) {
  window.addEventListener("storage", (e) => {
    if (e.key !== PREF_KEY || app.safeMode || !e.newValue) return;
    let next;
    try {
      next = JSON.parse(e.newValue);
    } catch {
      return;
    }
    for (const k of Object.keys(next)) {
      if (JSON.stringify(next[k]) === JSON.stringify(app.prefs[k])) continue;
      app.prefs[k] = next[k];
      app.emit("prefs", k);
    }
    app.emit("render");
  });
}

export function installWindowing(app) {
  installPrefSync(app);
  if (typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (ev) => {
    const m = ev.data;
    if (!isMessage(m)) return;
    for (const w of [...waiters]) if (w.type === m.type && w.id === m.id) w.done(true);
    if (m.type === "ping" && me) post({ type: "pong", id: me.id });
    if (m.type === "return" && !me) adopt(app, m.id).catch((err) => app.toast(`A returned document could not be opened: ${err.message}`, "danger", 5000));
    if (m.type === "closed" && !me) setTimeout(() => recoverPopouts(app, m.id), 800);
  };
}

export { parsePopoutParams };
