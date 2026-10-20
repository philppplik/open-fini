// Opening whole project folders (File ▸ Open Folder…, or dropping a folder anywhere on the window) and the
// window-wide "drop to open" handling for files.
import { h } from "../core/util.js";
import { markUntrusted } from "../core/security.js";
import { pickDocumentEntry } from "../core/text-docs.js";
import { Doc } from "../core/doc.js";
import { ensureWeb } from "../core/web.js";
import { confirmDialog } from "./dialogs.js";
import { pickFiles, entriesFromPicked, entriesFromDrop, MAX_IMPORT_BYTES } from "./code/import.js";
import { isTextPath, normalizePath } from "../engine/web/paths.js";

const WEB = /\.(html?|css|m?js|json|svg|webmanifest|txt|md|markdown|mdx|tex|latex|bib|ya?ml|xml|csv|toml|ini|tsx?|jsx)$/i;
export const OPENABLE = /\.(ofini|svg|png|jpe?g|gif|webp|avif|bmp|psd|psb|idml|pdf|ai)$/i;

/**
 * Opens a folder given as [{ path, file }] (paths relative to the folder or including its name).
 * A folder with web files becomes a website project in the Code studio; otherwise every design file in it
 * (OpenFini documents, images, SVG, PSD, IDML) opens as its own document.
 */
export async function openFolderEntries(app, entries, hintName = "") {
  entries = entries.filter((e) => e.path && !/(^|\/)\./.test(e.path));
  if (!entries.length) return app.toast("That folder has no files OpenFini can use.", "warning");
  // a single common top-level folder is the project root
  const tops = new Set(entries.map((e) => e.path.split("/")[0]));
  let name = hintName;
  if (tops.size === 1 && entries.every((e) => e.path.includes("/"))) {
    name = name || [...tops][0];
    entries = entries.map((e) => ({ ...e, path: e.path.split("/").slice(1).join("/") }));
  }
  name = name || "Website";
  const html = entries.filter((e) => /\.html?$/i.test(e.path));
  const design = entries.filter((e) => OPENABLE.test(e.path) && !/\.svg$/i.test(e.path) && !/^(assets|images|img|static|public)\//i.test(e.path));
  if (html.length) return openAsWebsite(app, entries, name);
  // a folder of Markdown or LaTeX documents (with images, bibliographies …) is a project, not a pile of images
  if (entries.some((e) => /\.(md|markdown|mdx|tex|latex)$/i.test(e.path))) return openAsWebsite(app, entries, name);
  const open = entries.filter((e) => OPENABLE.test(e.path));
  if (!open.length) {
    if (entries.some((e) => WEB.test(e.path))) return openAsWebsite(app, entries, name);
    return app.toast("That folder has no files OpenFini can open (OpenFini documents, images, SVG, PSD, IDML or a website).", "warning", 5000);
  }
  void design;
  if (open.length > 3) {
    const ok = await confirmDialog({ title: "Open folder", message: `Open ${Math.min(open.length, 12)} document${open.length === 1 ? "" : "s"} from “${name}”${open.length > 12 ? ` (the first 12 of ${open.length})` : ""}?`, ok: "Open" });
    if (!ok) return;
  }
  let n = 0;
  for (const e of open.slice(0, 12)) {
    try {
      const bytes = new Uint8Array(await e.file.arrayBuffer());
      await app.openFile({ name: e.path.split("/").pop(), bytes, mime: e.file.type });
      n++;
    } catch (err) {
      app.toast(`${e.path}: ${err.message}`, "danger", 6000);
    }
  }
  if (n) app.toast(`Opened ${n} document${n === 1 ? "" : "s"} from “${name}”.`, "success", 2200);
}

async function openAsWebsite(app, entries, name) {
  let total = 0;
  for (const e of entries) total += e.file.size;
  if (total > MAX_IMPORT_BYTES) return app.toast(`That folder is too large (${(total / 1048576).toFixed(0)} MB, limit ${MAX_IMPORT_BYTES / 1048576} MB).`, "danger", 6000);
  app.status("Reading folder…");
  try {
    const files = {};
    for (const e of entries) {
      const path = normalizePath(e.path);
      if (!path) continue;
      const bytes = new Uint8Array(await e.file.arrayBuffer());
      files[path] = isTextPath(path) ? new TextDecoder().decode(bytes) : bytes;
    }
    const doc = new Doc({ name, width: 1280, height: 800, studio: "code" });
    ensureWeb(doc, files);
    if (!doc.web.pages().length) {
      // a folder of Markdown, LaTeX or other text files: open the main document first
      const entry = pickDocumentEntry(Object.keys(files));
      if (entry) Object.assign(doc.web.settings, { openFiles: [entry], activeFile: entry }), (doc.web.entry = entry);
    }
    markUntrusted(app.prefs, doc); // protected mode: preview scripts stay off until the user enables them
    doc.history.clear();
    doc.saved = false;
    app.openDoc(doc);
    app.setStudio("code");
    app.toast(`Opened “${name}” as a website project (${Object.keys(files).length} files).`, "success", 2600);
  } finally {
    app.status("");
  }
}

/** File ▸ Open Folder… */
export async function openFolderDialog(app) {
  const picked = await pickFiles({ directory: true });
  if (!picked.length) return;
  const first = picked[0].webkitRelativePath?.split("/")[0] || "";
  await openFolderEntries(app, entriesFromPicked(picked, { directory: true }), first);
}

/** Window-wide drop: files open as documents, folders open as projects. */
export function installDropToOpen(app) {
  let depth = 0;
  const veil = h("div.of-dropveil.hidden", h("div", h("strong", "Drop to open"), h("span", "Files open as documents. A folder opens as a project.")));
  document.body.append(veil);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  const hide = () => {
    depth = 0;
    veil.classList.add("hidden");
  };
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    veil.classList.remove("hidden");
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) veil.classList.add("hidden");
  });
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    hide();
    if (e.defaultPrevented || !hasFiles(e)) return; // the canvas, explorer and assets handle their own drops
    e.preventDefault();
    const dt = e.dataTransfer;
    const isFolder = [...(dt.items || [])].some((i) => i.webkitGetAsEntry?.()?.isDirectory);
    const entries = entriesFromDrop(dt); // must start synchronously: the drop data is only valid during the event
    entries.then(async (list) => {
      try {
        if (isFolder) return await openFolderEntries(app, list);
        for (const { file } of list) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          await app.openFile({ name: file.name, bytes, mime: file.type });
        }
      } catch (err) {
        app.toast(err.message, "danger", 6000);
      }
    });
  });
  window.addEventListener("dragend", hide);
}
