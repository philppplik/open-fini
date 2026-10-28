// Office Suite host: the part of the Office studio that is the same for every app. Mounted by ui/shell.js into the
// studio's canvas area on studio / document changes (lazy). It shows
//   * the suite bar: Home (launcher), the kind switcher (one button per registered app: jumps to the last open
//     document of that kind, or to the launcher filtered to it) and the active app's name;
//   * the launcher (office/launcher.js) when no Office document is active or Home was chosen;
//   * the active document's app, mounted once per document and kept while the document is open.
// The document tab strip of the window already lists every open document (Office ones carry their kind's icon).
//
// Public API: syncOfficeSuite(app, area), showOfficeHome(app, kind?)
// App state it owns: app.officeUI (the mounted app instance of the active document, or null), app.officeHome (true
// while the launcher is shown although a document is open). Events: emits "officestatus" (status bar) and
// "officekind" (menus) when the active app changes.
// Invariants: an app instance is created at most once per document and destroyed when the document closes; a slow
// app import never mounts into a document that is no longer active (token check).
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { officeApps, officeApp, loadOfficeApp, officeKindOf } from "./index.js";

const mounts = new WeakMap(); // doc → { el, inst, kind }
const live = new Set(); // docs with a mount (to destroy on close)
let shell = null; // { root, bar, body, launcher }
let token = 0;

function ensureShell(app, area) {
  if (shell && shell.root.isConnected) return shell;
  const bar = h("div.of-suite__bar", { role: "toolbar", "aria-label": t("Office Suite") });
  const body = h("div.of-suite__body");
  const root = h("div.of-suite", bar, body);
  area.replaceChildren(root);
  shell = { root, bar, body, launcher: null };
  return shell;
}

function renderBar(app, activeKind) {
  const { bar } = shell;
  const home = h("button.of-suite__home", { type: "button", "aria-pressed": String(!activeKind), title: t("Office home: new, templates, recent files") }, h("sl-icon", { name: "house-door" }), h("span", t("Home")));
  home.addEventListener("click", () => showOfficeHome(app));
  const kinds = h("div.of-suite__kinds", { role: "group", "aria-label": t("Office apps") },
    ...officeApps().map((m) => {
      const b = h("button.of-suite__kind", { type: "button", "aria-pressed": String(activeKind === m.kind), "data-kind": m.kind, title: t(m.blurb || m.label) }, h("sl-icon", { name: m.icon }), h("span", t(m.label)));
      b.addEventListener("click", () => switchKind(app, m.kind));
      return b;
    }));
  bar.replaceChildren(home, kinds);
}

/** Kind switcher: the most recent open document of that kind, or the launcher filtered to it. */
function switchKind(app, kind) {
  const doc = [...app.docs].reverse().find((d) => officeKindOf(d) === kind);
  if (doc) {
    app.officeHome = false;
    if (app.doc === doc) syncOfficeSuite(app);
    else app.activateDoc(doc);
  } else showOfficeHome(app, kind);
}

/** Shows the launcher (File ▸ New in the Office studio, the Home button, the kind switcher). */
export function showOfficeHome(app, kind = null) {
  app.officeHome = true;
  app.officeHomeKind = kind;
  if (app.studio !== "office") app.setStudio("office");
  else syncOfficeSuite(app);
}

let lastArea = null;
let lastDoc = null;
/** Mounts (or refreshes) the suite for the active document. Called on studio / document changes. */
export async function syncOfficeSuite(app, area = lastArea) {
  if (!area) return;
  lastArea = area;
  pruneClosed(app);
  if (app.studio !== "office") {
    app.officeUI?.deactivate?.();
    return;
  }
  ensureShell(app, area);
  const doc = app.doc;
  if (doc !== lastDoc) {
    lastDoc = doc; // another document became active (tab, open, new): leave the launcher
    if (doc?.office) app.officeHome = false;
  }
  const kind = officeKindOf(doc);
  const my = ++token;
  if (!kind || app.officeHome) {
    app.officeUI?.deactivate?.();
    setActive(app, null);
    renderBar(app, null);
    const { renderLauncher } = await import("./launcher.js");
    if (my !== token) return;
    shell.body.replaceChildren(renderLauncher(app, { doc, kind: app.officeHomeKind || null }));
    return;
  }
  renderBar(app, kind);
  let m = mounts.get(doc);
  if (!m) {
    const manifest = officeApp(kind);
    if (!manifest) {
      setActive(app, null);
      shell.body.replaceChildren(missingApp(app, doc, kind));
      return;
    }
    const el = h("div.of-suite__app", { "data-kind": kind });
    m = { el, inst: null, kind, ready: null };
    mounts.set(doc, m);
    live.add(doc);
    m.ready = loadOfficeApp(kind).then((impl) => impl.mount(el, doc, app)).then((inst) => {
      inst.kind ||= kind;
      inst.doc ||= doc;
      m.inst = inst;
      return inst;
    });
    m.ready.catch((err) => {
      mounts.delete(doc);
      live.delete(doc);
      app.toast(t("The {app} app could not be loaded: {msg}", { app: t(manifest.label), msg: err.message }), "danger", 6000);
    });
  }
  const inst = m.inst || (await m.ready.catch(() => null));
  if (my !== token || !inst || app.doc !== doc) return;
  if (app.officeUI && app.officeUI !== inst) app.officeUI.deactivate?.();
  if (shell.body.firstChild !== m.el) shell.body.replaceChildren(m.el);
  setActive(app, inst);
  inst.activate?.();
}

function setActive(app, inst) {
  const changed = app.officeUI !== inst;
  app.officeUI = inst;
  if (changed) {
    app.emit("officestatus");
    app.emit("officekind", inst?.kind || null);
  }
}

/** Destroys app instances of documents that were closed. */
function pruneClosed(app) {
  for (const doc of [...live]) {
    if (app.docs.includes(doc)) continue;
    const m = mounts.get(doc);
    live.delete(doc);
    mounts.delete(doc);
    try {
      m?.inst?.destroy?.();
    } catch {
      /* an app's cleanup must not break the suite */
    }
    if (app.officeUI === m?.inst) app.officeUI = null;
  }
}

function missingApp(app, doc, kind) {
  return h("div.of-suite__missing", { role: "status" },
    h("h2", t("This version cannot edit this Office document")),
    h("p", t("“{name}” is a {kind} document. The app that edits it is not part of this version of OpenFini. Saving keeps its content unchanged.", { name: doc.name, kind })),
    h("sl-button", { onclick: () => showOfficeHome(app) }, t("Office home")));
}
