// Desktop implementation of the platform bridge (Tauri v2, system WebView).
//
// No npm package is needed: tauri.conf.json sets app.withGlobalTauri, so the
// core API and the plugin APIs are injected as window.__TAURI__.*
//   .core.invoke  .event.listen  .window.getCurrentWindow  .path
//   .dialog (plugin-dialog)  .fs (plugin-fs)  .opener (plugin-opener)
//   .clipboardManager (plugin-clipboard-manager)
// The Rust side lives in src-tauri/src/lib.rs.
import {
  basename,
  detectDesktopOs,
  dirname,
  isSafeExternalUrl,
  mimeFromName,
  normalizeFilters,
  rgbaToPngBlob,
  toPngBlob,
  toUint8Array,
} from "./common.js";
import { platform as web } from "./web.js";
import { createOpenBuffer, normalizeOpenItems, pathName } from "./open-paths.js";

/** @typedef {import("./index.js").PlatformFile} PlatformFile */

/** Emitted by src-tauri/src/lib.rs when the OS asks us to open files. */
const OPEN_FILES_EVENT = "openfini://open-files";

/** Folder of the last save, so the next save dialog starts there. */
let lastDirectory = "";

function api() {
  const tauri = window.__TAURI__;
  if (!tauri) {
    throw new Error("window.__TAURI__ is missing. Set app.withGlobalTauri to true in src-tauri/tauri.conf.json.");
  }
  return tauri;
}

/** Plugin errors arrive as plain strings; give them a stack and some context. */
function asError(err, action) {
  if (err instanceof Error) return err;
  return new Error(`${action}: ${typeof err === "string" ? err : JSON.stringify(err)}`);
}

function toDialogFilters(filters) {
  const normalized = normalizeFilters(filters);
  return normalized.length > 0 ? normalized : undefined;
}

/** @param {string} path @returns {Promise<PlatformFile>} */
async function readPath(path) {
  try {
    const bytes = await api().fs.readFile(path);
    const name = basename(path);
    return { name, path, bytes, mime: mimeFromName(name) };
  } catch (err) {
    throw asError(err, `Could not read ${path}`);
  }
}

/** Reads several paths; unreadable ones are reported and skipped. */
async function readPaths(paths) {
  const files = [];
  for (const path of paths) {
    try {
      files.push(await readPath(path));
    } catch (err) {
      console.warn("OpenFini:", err);
    }
  }
  return files;
}

async function writePath(path, bytes) {
  try {
    await api().fs.writeFile(path, await toUint8Array(bytes));
  } catch (err) {
    throw asError(err, `Could not write ${path}`);
  }
  lastDirectory = dirname(path) || lastDirectory;
  return { name: basename(path), path };
}

async function defaultSavePath(suggestedName) {
  try {
    const { path } = api();
    const directory = lastDirectory || (await path.pictureDir());
    return await path.join(directory, suggestedName);
  } catch {
    return suggestedName;
  }
}

// --- "open with" delivery -------------------------------------------------
// One native listener feeds a buffer; every onOpenFiles() subscriber gets the files, and files that arrive while
// nobody listens are kept until the next subscriber (see open-paths.js). The first subscription also fetches the
// files that arrived before the UI was ready (the file that launched the app).
const openBuffer = createOpenBuffer();
let openFilesStart = null;

/** Tells the UI that files from the OS are being read (see open-router.js). */
function announce(detail) {
  if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("openfini:open-progress", { detail }));
}

/** Reads the paths the OS handed us and delivers them. Announces the work as a DOM event so the UI can show progress. */
async function receivePaths(rawPaths) {
  const items = normalizeOpenItems(rawPaths);
  if (items.length === 0) return;
  announce({ phase: "start", count: items.length, names: items.map((i) => basename(i.path)) });
  try {
    // Folders are delivered as { isDir: true, name, path } without bytes; the router reads them (readFolder below).
    const delivered = [];
    for (const item of items) {
      if (item.isDir) delivered.push({ isDir: true, name: pathName(item.path), path: item.path });
      else delivered.push(...(await readPaths([item.path])));
    }
    openBuffer.deliver(delivered);
  } finally {
    announce({ phase: "end", count: items.length });
  }
}

function startOpenFiles() {
  openFilesStart ??= (async () => {
    const { event, core } = api();
    await event.listen(OPEN_FILES_EVENT, (e) => receivePaths(e.payload));
    // Registering first and asking second means no file can slip through.
    await receivePaths(await core.invoke("take_launch_files"));
  })().catch((err) => {
    openFilesStart = null;
    throw err;
  });
  return openFilesStart;
}

/** @type {import("./index.js").Platform} */
export const platform = {
  isDesktop: true,
  os: detectDesktopOs(),

  async openFiles({ accept = [], multiple = false } = {}) {
    let picked;
    try {
      picked = await api().dialog.open({ multiple: Boolean(multiple), directory: false, filters: toDialogFilters(accept) });
    } catch (err) {
      throw asError(err, "Could not open the file dialog");
    }
    if (picked == null) return [];
    const paths = Array.isArray(picked) ? picked : [picked];
    const files = await Promise.all(paths.map(readPath));
    if (paths.length > 0) lastDirectory = dirname(paths[0]) || lastDirectory;
    return files;
  },

  /** Native folder picker; the chosen folder is added to the fs scope by the dialog plugin. Resolves with a path or null. */
  async pickFolder({ defaultPath } = {}) {
    try {
      const picked = await api().dialog.open({ directory: true, multiple: false, defaultPath: defaultPath || undefined });
      return typeof picked === "string" ? picked : null;
    } catch (err) {
      throw asError(err, "Could not open the folder dialog");
    }
  },

  /**
   * Reads a folder into memory with ignore rules and caps (folder-scan.js).
   * @returns {Promise<{ name: string, files: { path: string, bytes: Uint8Array }[], stats: object }>}
   */
  async readFolder(path, options = {}) {
    const { fs } = api();
    const { scanFolder } = await import("./folder-scan.js");
    try {
      return await scanFolder({ readDir: (p) => fs.readDir(p), stat: (p) => fs.stat(p), readFile: (p) => fs.readFile(p) }, path, options);
    } catch (err) {
      throw asError(err, `Could not read ${path}`);
    }
  },

  async saveFile({ suggestedName = "Untitled", bytes, bytesFor, filters = [] } = {}) {
    let path;
    try {
      path = await api().dialog.save({
        defaultPath: await defaultSavePath(suggestedName),
        filters: toDialogFilters(filters),
      });
    } catch (err) {
      throw asError(err, "Could not open the save dialog");
    }
    if (!path) return null;
    return writePath(path, bytesFor ? await bytesFor(basename(path)) : bytes);
  },

  async saveFileTo(path, bytes) {
    return writePath(path, bytes);
  },

  async setTitle(title) {
    const text = String(title);
    document.title = text;
    try {
      await api().window.getCurrentWindow().setTitle(text);
    } catch (err) {
      console.warn("OpenFini: could not set the window title", err);
    }
  },

  async openExternal(url) {
    if (!isSafeExternalUrl(url)) throw new Error(`Refusing to open ${url}`);
    try {
      await api().opener.openUrl(url);
    } catch (err) {
      throw asError(err, `Could not open ${url}`);
    }
  },

  async onOpenFiles(callback) {
    const unsubscribe = openBuffer.subscribe(callback);
    await startOpenFiles();
    return unsubscribe;
  },

  async clipboardReadImage() {
    try {
      const image = await api().clipboardManager.readImage();
      const [rgba, size] = await Promise.all([image.rgba(), image.size()]);
      return await rgbaToPngBlob(rgba, size.width, size.height);
    } catch {
      // Most often there simply is no image on the clipboard.
      return null;
    }
  },

  async clipboardWriteImage(blob) {
    try {
      const png = await toPngBlob(blob);
      await api().clipboardManager.writeImage(await toUint8Array(png));
    } catch (err) {
      console.warn("OpenFini: native clipboard write failed, using the WebView clipboard", err);
      await web.clipboardWriteImage(blob);
    }
  },

  async quit() {
    try {
      await api().core.invoke("quit_app");
    } catch {
      window.close();
    }
  },
};
