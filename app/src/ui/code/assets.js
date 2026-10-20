// Assets pane: images, fonts and media of the project, upload, insert, and "use a design page as an asset".
import { h, empty, formatBytes } from "../../core/util.js";
import { emptyHint } from "../empty-hint.js";
import { relativeRef, sanitizeFileName, basename, uniquePath } from "../../engine/web/index.js";
import { iconButton } from "../controls.js";
import { confirmDialog } from "../dialogs.js";
import { showContextMenu } from "../menus.js";
import { exportRaster, exportSvg } from "../../core/io.js";
import { fileIcon, isImagePath, isFontPath } from "./util.js";
import { pickFiles, entriesFromPicked, entriesFromDrop, importInto } from "./import.js";

const MEDIA = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|mp4|webm|mp3|wav|ogg|pdf)$/i;

export function createAssetsPanel(ws) {
  const { web, app } = ws;
  const grid = h("div.of-assetgrid");
  const head = h("div.of-side__head", h("span.of-side__title", "Assets"));
  const foot = h("div.of-side__foot");
  const designBtn = iconButton({ icon: "vector-pen", label: "Add a design page as SVG or PNG…", onClick: (e, b) => designMenu(b) });
  head.append(h("div.of-side__actions", designBtn, iconButton({ icon: "upload", label: "Upload assets…", onClick: upload })));
  const el = h("div.of-side__pane.of-assetspane", head, grid, foot);
  const urls = new Map(); // path → { url, bytes }

  function thumb(path) {
    const f = web.get(path);
    if (!isImagePath(path)) return fileIcon(path);
    const key = f.bytes || f.text;
    let rec = urls.get(path);
    if (!rec || rec.key !== key) {
      if (rec) URL.revokeObjectURL(rec.url);
      rec = { key, url: URL.createObjectURL(new Blob([f.bytes || f.text], { type: f.mime })) };
      urls.set(path, rec);
    }
    return h("img", { src: rec.url, alt: "", loading: "lazy", draggable: "false" });
  }

  function render() {
    empty(grid);
    const files = web.paths.filter((p) => MEDIA.test(p));
    if (!files.length) {
      grid.append(emptyHint(ws.app, { icon: "images", title: "No assets yet", text: "Upload images, fonts or media, or drop files here. They become available to every page.", plain: "No assets yet. Upload images, fonts or media." }));
    }
    for (const path of files) {
      const f = web.get(path);
      const t = h("div.of-asset", { tabindex: "0", title: path, "data-path": path }, h("div.of-asset__thumb", thumb(path)), h("div.of-asset__name", basename(path)), h("div.of-asset__meta", formatBytes(f.bytes ? f.bytes.length : f.text.length)));
      t.addEventListener("click", () => ws.openFile(path));
      t.addEventListener("dblclick", () => insert(path));
      t.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(app, e.clientX, e.clientY, [
          { label: isFontPath(path) ? "Add @font-face rule" : "Insert into page", icon: "plus-square", run: () => insert(path) },
          { label: "Use as background of the selected element", icon: "image", run: () => background(path), disabled: !isImagePath(path) },
          "-",
          { label: "Copy path", icon: "link-45deg", run: () => navigator.clipboard?.writeText(path) },
          { label: "Delete", icon: "trash3", run: async () => ((await confirmDialog({ title: "Delete asset", message: `Delete “${path}”?`, ok: "Delete", danger: true })) ? web.remove(path) : null) },
        ]);
      });
      grid.append(t);
    }
    foot.textContent = `${files.length} asset${files.length === 1 ? "" : "s"}`;
  }

  function insert(path) {
    const rel = relativeRef(ws.page, path);
    if (isFontPath(path)) {
      const css = ws.ensureStylesheet(ws.page);
      const name = basename(path).replace(/\.[^.]+$/, "").replace(/[-_]?(regular|bold|italic)$/i, "");
      const rule = `@font-face {\n  font-family: "${name}";\n  src: url("${relativeRef(css, path)}") format("${/woff2$/i.test(path) ? "woff2" : /woff$/i.test(path) ? "woff" : /otf$/i.test(path) ? "opentype" : "truetype"}");\n  font-display: swap;\n}\n`;
      ws.editors.applyChanges(css, [{ from: 0, to: 0, insert: `${rule}\n` }]);
      app.toast(`Added @font-face for “${name}” to ${css}. Use it with font-family: "${name}".`, "success", 3500);
      return;
    }
    if (!isImagePath(path)) return app.toast("Only images and fonts can be inserted.", "warning", 1800);
    const alt = basename(path).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    ws.insertElement({ id: "asset-image", label: "Image", icon: "image", description: "", html: `<img src="${rel}" alt="${alt}" loading="lazy">` });
  }
  function background(path) {
    if (!ws.selection) return app.toast("Select an element first.", "warning", 1800);
    const css = ws.ensureStylesheet(ws.page);
    ws.setStyle({ "background-image": `url("${relativeRef(css, path)}")`, "background-size": "cover", "background-position": "center" });
  }

  async function upload() {
    const files = await pickFiles({ accept: "image/*,font/*,.woff,.woff2,.ttf,.otf,video/*,audio/*,.svg,.pdf" });
    if (files.length) await add(entriesFromPicked(files));
  }
  async function add(entries) {
    try {
      const res = await importInto(web, entries, { prefix: "assets", confirmReplace: (paths) => confirmDialog({ title: "Replace assets?", message: `${paths.length} asset${paths.length === 1 ? "" : "s"} already exist. Replace?`, ok: "Replace", cancel: "Keep existing" }) });
      app.toast(`Added ${res.added + res.replaced} asset${res.added + res.replaced === 1 ? "" : "s"} to assets/.`, "success", 1800);
    } catch (err) {
      app.toast(err.message, "danger", 5000);
    }
  }
  el.addEventListener("dragover", (e) => e.preventDefault());
  el.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) await add(await entriesFromDrop(e.dataTransfer));
  });

  function designMenu(anchor) {
    const doc = app.doc;
    const r = anchor.getBoundingClientRect();
    const items = [];
    for (const page of doc.pages) {
      items.push({ label: `${page.name} → SVG`, icon: "filetype-svg", run: () => addDesign(page, "svg") }, { label: `${page.name} → PNG (2×)`, icon: "filetype-png", run: () => addDesign(page, "png") });
      if (doc.pages.length > 1) items.push("-");
    }
    if (!items.length) items.push({ label: "This document has no design pages.", disabled: true, run() {} });
    showContextMenu(app, r.left, r.bottom + 4, items);
  }
  async function addDesign(page, kind) {
    try {
      const base = (sanitizeFileName(page.name) || "design").toLowerCase().replace(/\s+/g, "-");
      let path;
      if (kind === "svg") {
        const { svg } = exportSvg(app, page);
        path = web.createUnique(`assets/${base}.svg`, svg).path;
      } else {
        const r = await exportRaster(app, { page, format: "png", scale: 2, quality: 1 });
        path = web.createUnique(`assets/${base}.png`, r.bytes, { mime: "image/png" }).path;
      }
      app.toast(`Added ${path} from your design.`, "success", 2200);
    } catch (err) {
      app.toast(err.message || "Could not export the page.", "danger", 5000);
    }
  }

  web.on("tree", render);
  render();
  return { el, render, show: render, preview: (p) => ws.showSide("assets") && el.querySelector(`[data-path="${CSS.escape(p)}"]`)?.focus(), uniquePath };
}
