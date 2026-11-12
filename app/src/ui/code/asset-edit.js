// Quick asset editing: opens an image of a Code studio project in the Pixel studio (PNG, JPEG, WebP) or an SVG in the
// Vector studio as a separate document that stays linked to the project file. File ▸ Save (Mod+S) in that document,
// or "Save Back to Website Asset", writes the edited image back into the project in its own format, so the preview,
// the Assets pane and the export pick it up. Lazy (loaded from the Assets and Explorer context menus and File ▸ Save).
// Docs: docs/code-studio.md ▸ "Editing assets in a design studio".
//
// Public API
//   assetEditTarget(path)              -> { studio, format, label } | null   (pure: which studio edits this file)
//   assetMenuItems(ws, path)           -> context-menu items ("Open in Pixel Studio" …), [] when not editable
//   editAssetInStudio(ws, path)        opens the linked document and switches studio
//   saveAssetBack(app, doc, {returnToCode}) -> boolean   writes the document back into its project file
// Invariants
//   * doc.assetLink = { web, sourceDoc, path, format } is runtime state only: it is never saved into an .ofini file, so a
//     restored session or a reopened file is an ordinary document again.
//   * Never writes into a project whose document was closed or whose file was removed or renamed: the user is told and
//     can still use Save As.
//   * Raster files are written back at the document's page size in the original format; SVG is rewritten by the SVG
//     exporter (comments, scripts and features the Vector studio does not model are not kept: the opening toast says so).
import { t } from "../../i18n/index.js";

const TARGETS = {
  png: { studio: "pixel", format: "png", mime: "image/png" },
  jpg: { studio: "pixel", format: "jpeg", mime: "image/jpeg" },
  jpeg: { studio: "pixel", format: "jpeg", mime: "image/jpeg" },
  webp: { studio: "pixel", format: "webp", mime: "image/webp" },
  svg: { studio: "vector", format: "svg", mime: "image/svg+xml" },
};

/** Which design studio edits `path` with a lossless-format round trip, or null. */
export function assetEditTarget(path) {
  const ext = (/\.([a-z0-9]+)$/i.exec(String(path || ""))?.[1] || "").toLowerCase();
  return TARGETS[ext] || null;
}

/** Context-menu entries for a project file (empty when the file type cannot be edited in a design studio). */
export function assetMenuItems(ws, path) {
  const target = assetEditTarget(path);
  if (!target) return [];
  const label = target.studio === "pixel" ? t("Open in Pixel Studio") : t("Open in Vector Studio");
  return [{ label, icon: target.studio === "pixel" ? "brush" : "vector-pen", run: () => editAssetInStudio(ws, path) }];
}

const bytesOf = (web, path) => {
  const b = web.bytes(path);
  if (!b || !b.length) throw new Error(t("“{path}” is empty.", { path }));
  return b;
};

/** Opens a project image in its design studio as a linked document. */
export async function editAssetInStudio(ws, path) {
  const { app, web } = ws;
  const target = assetEditTarget(path);
  if (!target || !web.has(path)) return;
  const sourceDoc = app.doc;
  // the same file already open for editing: switch to it instead of opening a second copy
  const open = app.docs.find((d) => d.assetLink && d.assetLink.web === web && d.assetLink.path === path);
  if (open) {
    app.activateDoc(open);
    app.setStudio(target.studio);
    return;
  }
  const name = path.split("/").pop();
  try {
    const io = await import("../../core/io.js");
    let doc;
    if (target.studio === "pixel") {
      doc = await io.openImageAsDocument(app, { name, bytes: bytesOf(web, path) });
    } else {
      const text = new TextDecoder().decode(bytesOf(web, path));
      io.placeSvg(app, text, name, { asNewDoc: true });
      doc = app.doc;
      doc.history.clear();
      doc.saved = true;
      app.setStudio("vector");
      requestAnimationFrame(() => app.cv?.fitPage());
    }
    doc.assetLink = { web, sourceDoc, path, format: target.format };
    doc.name = name;
    app.emit("docs");
    app.emit("docchange", {});
    const note = target.studio === "vector" ? ` ${t("Saving back rewrites the SVG from the drawing: comments, scripts and features the Vector studio does not support are not kept.")}` : "";
    app.toast(`${t("Editing {path} of your website. File ▸ Save writes it back.", { path })}${note}`, "primary", 7000, { label: t("Save back"), run: () => saveAssetBack(app, doc) });
  } catch (err) {
    app.toast(err?.message || t("Could not open “{path}”.", { path }), "danger", 6000);
  }
}

/**
 * Writes a linked document back into its project file. Returns true when written.
 * @param {import("../../core/app.js").App} app
 */
export async function saveAssetBack(app, doc = app.doc, { returnToCode = false } = {}) {
  const link = doc?.assetLink;
  if (!link) return false;
  const { web, path, format, sourceDoc } = link;
  if (!app.docs.includes(sourceDoc) || sourceDoc.web !== web) {
    app.toast(t("The website this image belongs to is no longer open. Use File ▸ Save As to keep your changes."), "warning", 7000);
    return false;
  }
  if (!web.has(path)) {
    app.toast(t("“{path}” is no longer in the website (renamed or deleted). Use File ▸ Save As to keep your changes.", { path }), "warning", 7000);
    return false;
  }
  if (app.doc !== doc) app.activateDoc(doc); // the exporters render the active document
  try {
    const io = await import("../../core/io.js");
    const page = doc.pages[0];
    let bytes;
    let notes = [];
    if (format === "svg") {
      const r = io.exportSvg(app, page, { background: false });
      bytes = new TextEncoder().encode(r.svg);
      notes = r.warnings || [];
    } else {
      bytes = (await io.exportRaster(app, { page, format, scale: 1 })).bytes;
    }
    web.put(path, bytes);
    doc.saved = true;
    app.emit("saved");
    app.emit("docchange", {});
    const back = { label: t("Back to Code studio"), run: () => returnTo(app, sourceDoc) };
    if (notes.length) app.toast(t("Updated {path} in the website. {notes}", { path, notes: notes.join(" ") }), "warning", 7000, back);
    else app.toast(t("Updated {path} in the website.", { path }), "success", 3500, back);
    if (returnToCode) returnTo(app, sourceDoc);
    return true;
  } catch (err) {
    app.toast(err?.message || t("Could not write “{path}”.", { path }), "danger", 6000);
    return false;
  }
}

function returnTo(app, sourceDoc) {
  if (!app.docs.includes(sourceDoc)) return;
  app.activateDoc(sourceDoc);
  app.setStudio("code");
}
