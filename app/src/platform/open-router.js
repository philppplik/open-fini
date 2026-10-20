// Routes files the operating system hands to OpenFini ("Open with", file association, launch arguments, a second
// launch, the PWA file handler and share target) into the app. Everything goes through app.openFile(), so every
// format the app can open works the same from the OS as from File > Open.
import { platform } from "./index.js";
import { typeOfName } from "./file-types.js";
import { LARGE_FILE_BYTES, samePath } from "./open-paths.js";

let busy = 0; // files currently being opened (progress text belongs to them)
const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB`;

/** Opens one file received from the OS. Never throws: problems become toasts. */
async function openOne(app, file) {
  const type = typeOfName(file.name);

  // Opening a file that is already open in a tab only brings that tab forward.
  const existing = file.path && app.docs?.find((d) => samePath(d.path, file.path));
  if (existing) {
    app.activateDoc(existing);
    return;
  }

  if (type?.kind === "extension") {
    if (typeof app.installExtensionFile === "function") return app.installExtensionFile(file);
    app.toast(`“${file.name}” is an OpenFini extension package. This version cannot install extensions from a file yet.`, "warning", 6000);
    return;
  }

  const large = file.bytes.length >= LARGE_FILE_BYTES;
  busy++;
  app.status(large ? `Opening ${file.name} (${mb(file.bytes.length)})…` : `Opening ${file.name}…`);
  try {
    await app.openFile(file);
  } catch (err) {
    // Text and code files that no other importer claimed open as a small website project in the Code studio.
    if (type?.kind === "code") {
      try {
        const { openFolderEntries } = await import("../ui/open-folder.js");
        const stem = file.name.replace(/\.[^.]+$/, "") || "Website";
        await openFolderEntries(app, [{ path: file.name, file: new File([file.bytes], file.name, { type: file.mime }) }], stem);
        return;
      } catch {
        // fall through to the original message
      }
    }
    app.toast(err?.message || `Could not open ${file.name}.`, "danger", 6000);
  } finally {
    busy--;
    app.status("");
  }
}

/** Opens several received files one after the other. */
export async function routeOpenedFiles(app, files) {
  for (const file of files) await openOne(app, file);
}

/**
 * Subscribes to files from the OS and shows progress while large files are read. Call once at start-up.
 * @returns {Promise<() => void>} unsubscribe
 */
export async function installOpenWith(app) {
  const onProgress = (event) => {
    const { phase, count, names } = event.detail || {};
    if (phase === "start") app.status(count === 1 ? `Reading ${names?.[0] ?? "file"}…` : `Reading ${count} files…`);
    else if (busy === 0) app.status("");
  };
  window.addEventListener("openfini:open-progress", onProgress);
  const unsubscribe = await platform.onOpenFiles?.((files) => routeOpenedFiles(app, files));
  return () => {
    window.removeEventListener("openfini:open-progress", onProgress);
    unsubscribe?.();
  };
}
