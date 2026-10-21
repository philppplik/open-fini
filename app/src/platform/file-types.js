// The file types OpenFini registers with the operating system and the browser ("Open with OpenFini").
//
// This table is the single source of truth for documentation, Settings, the Vibe tools and the tests. The
// installers and the PWA manifest cannot import JavaScript, so their lists live in
//   src-tauri/tauri.conf.json (bundle.fileAssociations), src-tauri/tauri.windows.conf.json,
//   src-tauri/windows/open-with.nsh, src-tauri/linux/openfini.desktop and app/manifest.webmanifest;
// tests/packaging/os-integration.test.js fails when any of them drifts away from this table.
//
// Pure data and functions: nothing here touches the DOM.

/**
 * @typedef {Object} FileType
 * @property {string} id            Stable id (also the Windows/macOS association name suffix).
 * @property {string} name          Human readable name.
 * @property {string[]} ext         Extensions without the dot, lower case.
 * @property {string} mime          MIME type registered on Linux/macOS and in the PWA manifest.
 * @property {'Editor' | 'Viewer'} role  macOS CFBundleTypeRole.
 * @property {boolean} own          A type OpenFini owns (becomes the default handler on install).
 * @property {'document' | 'image' | 'import' | 'office' | 'code' | 'foreign' | 'extension'} kind
 *   document: opens as an OpenFini document; image: opens as a pixel/vector document;
 *   import: converted on open; office: word processor files opened in the Office Studio;
 *   code: text opened in the Code studio; foreign: other tools' files the app only
 *   explains how to convert; extension: a zip package.
 */

/** @type {FileType[]} */
export const FILE_TYPES = [
  { id: "document", name: "OpenFini Document", ext: ["ofini"], mime: "application/x-openfini", role: "Editor", own: true, kind: "document" },
  { id: "extension", name: "OpenFini Extension", ext: ["ofext"], mime: "application/x-openfini-extension", role: "Editor", own: true, kind: "extension" },
  { id: "psd", name: "Photoshop Document", ext: ["psd"], mime: "image/vnd.adobe.photoshop", role: "Editor", own: false, kind: "import" },
  { id: "psb", name: "Photoshop Large Document", ext: ["psb"], mime: "image/vnd.adobe.photoshop-large", role: "Viewer", own: false, kind: "import" },
  { id: "idml", name: "InDesign Markup", ext: ["idml"], mime: "application/vnd.adobe.indesign-idml-package", role: "Viewer", own: false, kind: "import" },
  { id: "svg", name: "SVG Image", ext: ["svg"], mime: "image/svg+xml", role: "Editor", own: false, kind: "image" },
  { id: "png", name: "PNG Image", ext: ["png"], mime: "image/png", role: "Editor", own: false, kind: "image" },
  { id: "jpeg", name: "JPEG Image", ext: ["jpg", "jpeg"], mime: "image/jpeg", role: "Editor", own: false, kind: "image" },
  { id: "webp", name: "WebP Image", ext: ["webp"], mime: "image/webp", role: "Editor", own: false, kind: "image" },
  { id: "gif", name: "GIF Image", ext: ["gif"], mime: "image/gif", role: "Viewer", own: false, kind: "image" },
  { id: "bmp", name: "BMP Image", ext: ["bmp"], mime: "image/bmp", role: "Viewer", own: false, kind: "image" },
  { id: "avif", name: "AVIF Image", ext: ["avif"], mime: "image/avif", role: "Viewer", own: false, kind: "image" },
  { id: "tiff", name: "TIFF Image", ext: ["tif", "tiff"], mime: "image/tiff", role: "Viewer", own: false, kind: "import" },
  { id: "ico", name: "Windows Icon", ext: ["ico", "cur"], mime: "image/vnd.microsoft.icon", role: "Viewer", own: false, kind: "import" },
  { id: "ora", name: "OpenRaster Image", ext: ["ora"], mime: "image/openraster", role: "Editor", own: false, kind: "import" },
  { id: "kra", name: "Krita Document", ext: ["kra"], mime: "application/x-krita", role: "Viewer", own: false, kind: "import" },
  { id: "gpl", name: "GIMP Palette", ext: ["gpl"], mime: "application/x-gimp-palette", role: "Viewer", own: false, kind: "import" },
  { id: "ase", name: "Adobe Swatch Exchange", ext: ["ase"], mime: "application/vnd.adobe.ase", role: "Viewer", own: false, kind: "import" },
  { id: "aco", name: "Photoshop Swatches", ext: ["aco"], mime: "application/vnd.adobe.aco", role: "Viewer", own: false, kind: "import" },
  { id: "pdf", name: "PDF Document", ext: ["pdf"], mime: "application/pdf", role: "Viewer", own: false, kind: "import" },
  { id: "ai", name: "Illustrator Artwork", ext: ["ai"], mime: "application/vnd.adobe.illustrator", role: "Viewer", own: false, kind: "foreign" },
  { id: "afdesign", name: "Affinity Designer Document", ext: ["afdesign"], mime: "application/x-affinity-designer", role: "Viewer", own: false, kind: "foreign" },
  { id: "afphoto", name: "Affinity Photo Document", ext: ["afphoto"], mime: "application/x-affinity-photo", role: "Viewer", own: false, kind: "foreign" },
  { id: "afpub", name: "Affinity Publisher Document", ext: ["afpub"], mime: "application/x-affinity-publisher", role: "Viewer", own: false, kind: "foreign" },
  { id: "docx", name: "Word Document", ext: ["docx"], mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", role: "Editor", own: false, kind: "office" },
  { id: "odt", name: "OpenDocument Text", ext: ["odt"], mime: "application/vnd.oasis.opendocument.text", role: "Editor", own: false, kind: "office" },
  { id: "rtf", name: "Rich Text Document", ext: ["rtf"], mime: "application/rtf", role: "Editor", own: false, kind: "office" },
  { id: "markdown", name: "Markdown Document", ext: ["md", "markdown"], mime: "text/markdown", role: "Editor", own: false, kind: "code" },
  { id: "tex", name: "LaTeX Document", ext: ["tex", "latex"], mime: "text/x-tex", role: "Viewer", own: false, kind: "code" },
  { id: "html", name: "HTML Document", ext: ["html", "htm"], mime: "text/html", role: "Editor", own: false, kind: "code" },
  { id: "css", name: "CSS Stylesheet", ext: ["css"], mime: "text/css", role: "Editor", own: false, kind: "code" },
  { id: "js", name: "JavaScript File", ext: ["js", "mjs"], mime: "text/javascript", role: "Editor", own: false, kind: "code" },
  { id: "json", name: "JSON File", ext: ["json"], mime: "application/json", role: "Editor", own: false, kind: "code" },
  { id: "txt", name: "Text File", ext: ["txt"], mime: "text/plain", role: "Viewer", own: false, kind: "code" },
  { id: "csv", name: "CSV File", ext: ["csv"], mime: "text/csv", role: "Viewer", own: false, kind: "code" },
];

/** Every extension OpenFini registers, in table order (lower case, no dot). */
export function allExtensions() {
  return FILE_TYPES.flatMap((t) => t.ext);
}

/** Extensions OpenFini owns (it becomes their default handler when installed). */
export function ownedExtensions() {
  return FILE_TYPES.filter((t) => t.own).flatMap((t) => t.ext);
}

/** The type of a file name, or null. */
export function typeOfName(name) {
  const m = /\.([^./\\]+)$/.exec(String(name || ""));
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return FILE_TYPES.find((t) => t.ext.includes(ext)) || null;
}

/** The PWA `file_handlers[].accept` map: MIME type -> dotted extensions. */
export function manifestAccept() {
  /** @type {Record<string, string[]>} */
  const accept = {};
  for (const t of FILE_TYPES) accept[t.mime] = t.ext.map((e) => `.${e}`);
  return accept;
}

/**
 * The `bundle.fileAssociations` entries for tauri.conf.json (macOS, Linux). Windows only gets the owned types
 * there; the other types are registered as "Open with" candidates by src-tauri/windows/open-with.nsh.
 */
export function tauriAssociations({ windows = false } = {}) {
  return FILE_TYPES.filter((t) => !windows || t.own).map((t) => ({
    ext: t.ext,
    // On Windows the association name is the registry ProgId; elsewhere it is the display name.
    name: windows ? `OpenFini.${t.id[0].toUpperCase()}${t.id.slice(1)}` : t.name,
    mimeType: t.mime,
    role: t.role,
    rank: t.own ? "Owner" : "Alternate",
  }));
}

/**
 * Summary used by Settings and the Vibe tool: what OpenFini can open, grouped by what happens on open.
 * @returns {{ id: string, name: string, extensions: string[], opens: string, owned: boolean }[]}
 */
export function describeSupportedTypes() {
  const OPENS = {
    document: "Opens as an OpenFini document.",
    image: "Opens as an image document.",
    import: "Converted on open (layers, pages and text are kept where the format allows).",
    code: "Opens in the Code studio.",
    office: "Opens in the Office Studio (word processor).",
    foreign: "Explains how to export the file into an open format first.",
    extension: "Extension package.",
  };
  return FILE_TYPES.map((t) => ({ id: t.id, name: t.name, extensions: t.ext.map((e) => `.${e}`), opens: OPENS[t.kind], owned: t.own }));
}

/** The command that opens the operating system's default-apps settings, per OS (or null). */
export function defaultAppsSettingsUrl(os) {
  return os === "windows" ? "ms-settings:defaultapps" : null;
}

/** Plain instructions for choosing OpenFini as the default app, per OS. */
export function defaultAppsInstructions(os) {
  switch (os) {
    case "windows":
      return "Right-click a file, choose Open with, then Choose another app, pick OpenFini and tick Always. Or open Settings, Apps, Default apps, search for OpenFini and assign the types.";
    case "macos":
      return "Select a file in Finder, press Command-I, choose OpenFini under Open with and click Change All.";
    case "linux":
      return "Right-click a file in your file manager, choose Properties, Open With, select OpenFini and set it as default (or run xdg-mime default openfini.desktop <mime type>).";
    default:
      return "Install OpenFini as an app (browser menu, Install), then use your system's Open with menu. Chromium based browsers offer OpenFini for the registered file types.";
  }
}
