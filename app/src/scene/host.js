// Scene Studio host: mounts the workspace (scene/view.js) of the active scene document into the studio's area, or
// the start screen when the active document is not a scene. Mounted by ui/shell.js on studio / document changes
// (lazy: nothing of the Scene Studio is start-up code except its registration in studios/scene.js).
//
// Public API: syncScene(app, area), newScene(app, { template, title, preset }), isScene(doc)
// App state it owns: app.sceneUI (the workspace instance of the active scene document, or null). Emits "scenestatus".
// Invariants: one workspace per document, created on first activation and destroyed when the document closes; a
// document that is not a scene never mounts a workspace (the start screen offers to create one).
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { Doc } from "../core/doc.js";
import { OfficeProject } from "../core/office.js";
import { TEMPLATES, templateScene } from "./model.js";

/** Scene documents use the generic project container of core/office.js with kind "scene" (docs/file-format.md). */
export const isScene = (doc) => doc?.office?.kind === "scene";

const mounts = new WeakMap(); // doc → { el, inst }
const live = new Set();
let area = null;

/** Creates a new scene document from a template and opens it in the Scene Studio. */
export function newScene(app, { template = "blank", title = "" } = {}) {
  const model = templateScene(template, { title });
  const name = title || t("Untitled scene");
  const doc = new Doc({ name, studio: "scene", width: model.width, height: model.height, pages: 1 });
  doc.office = new OfficeProject(model, "scene");
  doc.history.clear();
  doc.saved = false;
  app.setStudio("scene");
  app.openDoc(doc);
  return doc;
}

function startScreen(app) {
  const scenes = app.docs.filter(isScene);
  const card = (tpl) => {
    const b = h("button.of-scene-start__card", { type: "button" }, h("sl-icon", { name: tpl.icon }), h("b", t(tpl.label)), h("span", t(tpl.description)));
    b.addEventListener("click", () => newScene(app, { template: tpl.id }));
    return b;
  };
  return h("div.of-scene-start",
    h("h2", t("Scene Studio")),
    h("p", t("Cut video and audio on a timeline, animate text, shapes and pictures with keyframes, and export the result.")),
    h("div.of-scene-start__grid", ...TEMPLATES.map(card)),
    scenes.length ? h("div.of-scene-start__open", h("h3", t("Open scenes")), ...scenes.map((d) => {
      const b = h("button.of-scene-start__doc", { type: "button" }, h("sl-icon", { name: "file-earmark-play" }), d.name);
      b.addEventListener("click", () => app.activateDoc(d));
      return b;
    })) : null);
}

/** Mounts (or refreshes) the studio for the active document. */
export async function syncScene(app, into = area) {
  if (!into) return;
  area = into;
  for (const doc of [...live]) {
    if (app.docs.includes(doc)) continue;
    const m = mounts.get(doc);
    live.delete(doc);
    mounts.delete(doc);
    try {
      m?.inst?.destroy();
    } catch {
      /* cleanup must not break the studio */
    }
    if (app.sceneUI === m?.inst) app.sceneUI = null;
  }
  const doc = app.doc;
  if (app.studio !== "scene") {
    app.sceneUI?.deactivate();
    return;
  }
  if (!isScene(doc)) {
    app.sceneUI?.deactivate();
    app.sceneUI = null;
    area.replaceChildren(startScreen(app));
    app.emit("scenestatus");
    return;
  }
  let m = mounts.get(doc);
  if (!m) {
    const el = h("div.of-scene-host");
    const { mountScene } = await import("./view.js");
    if (app.doc !== doc || mounts.get(doc)) return syncScene(app);
    m = { el, inst: mountScene(el, doc, app) };
    mounts.set(doc, m);
    live.add(doc);
  }
  if (app.sceneUI && app.sceneUI !== m.inst) app.sceneUI.deactivate();
  if (area.firstChild !== m.el) area.replaceChildren(m.el);
  app.sceneUI = m.inst;
  m.inst.activate();
  app.emit("scenestatus");
}
