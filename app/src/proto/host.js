// Proto Studio host: mounts the workspace (proto/workspace.js) of the active Proto design into the studio's area, or
// the start screen when the active document is not a design. Mounted by ui/shell.js on studio and document changes
// (lazy: nothing of the Proto Studio is start-up code except its registration in studios/proto.js).
//
// Public API: syncProto(app, area), newProto(app, { starter, title }), isProto(doc)
// App state it owns: app.protoUI (the workspace of the active design, or null). Emits "protostatus".
// Invariants: one workspace per document, created on first activation and destroyed when the document closes; a
// document that is not a design never mounts a workspace. Edits are undo steps of the document (doc.tx), so Undo,
// the History panel, autosave and session restore work as for every other document.
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { Doc } from "../core/doc.js";
import { OfficeProject } from "../core/office.js";
import { emptyDocument, KIND } from "../engine/proto/schema.js";
import { apply } from "../engine/proto/ops.js";
import { storeModel } from "../engine/proto/format.js";
import { mountProto, clearProtoPanels, FRAME_PRESETS } from "./workspace.js";
import { registerProtoCommands } from "../commands/proto.js";

/** Proto designs use the generic project container of core/office.js with kind "proto" (docs/file-format.md). */
export const isProto = (doc) => doc?.office?.kind === KIND;

const mounts = new WeakMap(); // doc → { el, inst }
const live = new Set();
let area = null;
let commands = false;

/**
 * A new Proto model: `blank` (an empty page) or `desktop` / `phone` (one frame of that size). Pure.
 * @param {{ starter?: string, title?: string }} [o]
 */
export function starterModel({ starter = "blank", title = "" } = {}) {
  let model = emptyDocument({ title: title || "Untitled design" });
  const p = FRAME_PRESETS[starter];
  if (p) {
    const page = Object.keys(model.pages)[0];
    model = apply(model, { op: "node.create", type: "frame", page, fields: { name: t(p.name), x: 0, y: 0, w: { mode: "fixed", value: p.w }, h: { mode: "fixed", value: p.h } } }).model;
  }
  return storeModel(model);
}

/** Creates a new design and opens it in the Proto Studio. */
export function newProto(app, { starter = "blank", title = "" } = {}) {
  const name = title || t("Untitled design");
  const model = starterModel({ starter, title: name });
  const doc = new Doc({ name, studio: "proto", width: 1440, height: 1024, pages: 1 });
  doc.office = new OfficeProject(model, KIND);
  doc.history.clear();
  doc.saved = false;
  app.setStudio("proto");
  app.openDoc(doc);
  return doc;
}

function startScreen(app) {
  const designs = app.docs.filter(isProto);
  const card = (icon, label, text, run) => {
    const b = h("button.of-proto-start__card", { type: "button" }, h("sl-icon", { name: icon }), h("b", label), h("span", text));
    b.addEventListener("click", run);
    return b;
  };
  return h(
    "div.of-proto-start",
    h("h2", t("Proto Studio"), h("span.of-proto-start__badge", t("Labs preview"))),
    h("p", t("Design application interfaces on a canvas that is real HTML and CSS: frames, auto layout and grids, ready for prototypes and code.")),
    h(
      "div.of-proto-start__grid",
      card("display", t("Desktop design"), t("A 1440 × 1024 frame to start from."), () => newProto(app, { starter: "desktop" })),
      card("phone", t("Phone design"), t("A 390 × 844 frame to start from."), () => newProto(app, { starter: "phone" })),
      card("file-earmark", t("Blank design"), t("An empty page."), () => newProto(app, { starter: "blank" })),
    ),
    designs.length
      ? h(
          "div.of-proto-start__open",
          h("h3", t("Open designs")),
          ...designs.map((d) => {
            const b = h("button.of-proto-start__doc", { type: "button" }, h("sl-icon", { name: "window-stack" }), d.name);
            b.addEventListener("click", () => app.activateDoc(d));
            return b;
          }),
        )
      : null,
  );
}

/** Mounts (or refreshes) the studio for the active document. */
export async function syncProto(app, into = area) {
  if (!into) return;
  area = into;
  if (!commands) {
    commands = true;
    registerProtoCommands(app);
  }
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
    if (app.protoUI === m?.inst) app.protoUI = null;
  }
  const doc = app.doc;
  if (app.studio !== "proto") {
    app.protoUI?.deactivate();
    return;
  }
  if (!isProto(doc)) {
    app.protoUI?.deactivate();
    app.protoUI = null;
    clearProtoPanels(app);
    area.replaceChildren(startScreen(app));
    app.emit("protostatus");
    return;
  }
  let m = mounts.get(doc);
  if (!m) {
    const el = h("div.of-proto-host");
    area.replaceChildren(el); // the workspace measures its stage, so it mounts attached
    m = { el, inst: mountProto(el, doc, app) };
    mounts.set(doc, m);
    live.add(doc);
  }
  if (app.protoUI && app.protoUI !== m.inst) app.protoUI.deactivate();
  if (area.firstChild !== m.el) area.replaceChildren(m.el);
  app.protoUI = m.inst;
  m.inst.activate();
  app.emit("protostatus");
}
