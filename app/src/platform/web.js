// Browser / PWA implementation of the platform bridge.
//
// Uses the File System Access API where it exists (Chromium) and falls back to
// <input type="file"> and download links everywhere else (Safari, Firefox).
import { isSafeExternalUrl, mimeFromName, normalizeFilters, toBlob, toPngBlob } from "./common.js";
import { createOpenBuffer } from "./open-paths.js";
import { takeSharedFiles } from "./pwa.js";

/** @typedef {import("./index.js").PlatformFile} PlatformFile */

const isAbort = (err) => err?.name === "AbortError";

/**
 * Builds the `types` option of showOpenFilePicker/showSaveFilePicker.
 * Extensions are grouped by MIME type because the API keys them by MIME.
 */
function pickerTypes(filters) {
  const types = [];
  for (const filter of normalizeFilters(filters)) {
    /** @type {Record<string, string[]>} */
    const accept = {};
    for (const ext of filter.extensions) {
      // The API only accepts short, simple extensions.
      if (!/^[a-z0-9]{1,15}$/.test(ext)) continue;
      (accept[mimeFromName(`x.${ext}`)] ??= []).push(`.${ext}`);
    }
    if (Object.keys(accept).length > 0) types.push({ description: filter.name, accept });
  }
  return types;
}

/** @param {File} file @returns {Promise<PlatformFile>} */
async function readFile(file) {
  return {
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    mime: file.type || mimeFromName(file.name),
  };
}

/** Opens the classic file chooser. Resolves with [] when the user cancels. */
function chooseWithInput(filters, multiple) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = Boolean(multiple);
    const extensions = normalizeFilters(filters).flatMap((f) => f.extensions);
    if (extensions.length > 0) input.accept = extensions.map((e) => `.${e}`).join(",");
    input.style.display = "none";
    const done = (files) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => done([]));
    document.body.append(input);
    input.click();
  });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Files opened from outside: the PWA file handler (launchQueue) and the share target (?share=<id>, filled by sw.js).
// A buffer keeps them until the app subscribes.
const launchBuffer = createOpenBuffer();
let launchConsumerInstalled = false;

function installLaunchConsumer() {
  if (launchConsumerInstalled || typeof window === "undefined") return;
  launchConsumerInstalled = true;
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async (params) => {
      const handles = params.files ?? [];
      if (handles.length === 0) return;
      try {
        launchBuffer.deliver(await Promise.all(handles.map(async (handle) => readFile(await handle.getFile()))));
      } catch (err) {
        console.warn("OpenFini: could not read launched files", err);
      }
    });
  }
  const shareId = new URLSearchParams(window.location.search).get("share");
  if (shareId) {
    const url = new URL(window.location.href);
    url.searchParams.delete("share");
    window.history.replaceState(null, "", url);
    takeSharedFiles(shareId)
      .then((files) => launchBuffer.deliver(files))
      .catch((err) => console.warn("OpenFini: could not read shared files", err));
  }
}

/** @type {import("./index.js").Platform} */
export const platform = {
  isDesktop: false,
  os: "web",

  async openFiles({ accept = [], multiple = false } = {}) {
    if (typeof window.showOpenFilePicker === "function") {
      try {
        const types = pickerTypes(accept);
        const handles = await window.showOpenFilePicker({
          multiple: Boolean(multiple),
          ...(types.length > 0 ? { types } : {}),
        });
        return await Promise.all(handles.map(async (handle) => readFile(await handle.getFile())));
      } catch (err) {
        if (isAbort(err)) return [];
        // Anything else (SecurityError in iframes, ...): use the classic chooser.
      }
    }
    const files = await chooseWithInput(accept, multiple);
    return Promise.all(files.map(readFile));
  },

  async saveFile({ suggestedName = "Untitled", bytes, mime, filters = [] } = {}) {
    const blob = toBlob(bytes, mime || mimeFromName(suggestedName));
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const types = pickerTypes(filters);
        const handle = await window.showSaveFilePicker({
          suggestedName,
          ...(types.length > 0 ? { types } : {}),
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { name: handle.name };
      } catch (err) {
        if (isAbort(err)) return null;
        // No user activation, sandboxed frame, ...: fall through to a download.
      }
    }
    downloadBlob(blob, suggestedName);
    return { name: suggestedName };
  },

  async saveFileTo() {
    throw new Error("saveFileTo() is only available in the desktop app.");
  },

  async setTitle(title) {
    document.title = String(title);
  },

  async openExternal(url) {
    if (!isSafeExternalUrl(url)) throw new Error(`Refusing to open ${url}`);
    window.open(url, "_blank", "noopener,noreferrer");
  },

  async onOpenFiles(callback) {
    const unsubscribe = launchBuffer.subscribe(callback);
    installLaunchConsumer();
    return unsubscribe;
  },

  async clipboardReadImage() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) return await item.getType(type);
      }
    } catch (err) {
      console.warn("OpenFini: clipboard image read failed", err);
    }
    return null;
  },

  async clipboardWriteImage(blob) {
    const png = await toPngBlob(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  },

  async quit() {
    window.close();
  },
};

// Exposed for unit tests only.
export { pickerTypes as _pickerTypes };
