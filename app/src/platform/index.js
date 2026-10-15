// Platform bridge: one object that hides the difference between the browser /
// PWA and the Tauri desktop shell. The rest of the app only imports this file.
//
//   import { platform } from "./platform/index.js";
//   const files = await platform.openFiles({ accept: [{ description: "Images", extensions: ["png", "jpg"] }] });
//
// Choice is made once, at import time: Tauri injects window.__TAURI_INTERNALS__
// into every page it serves, browsers do not.
import { platform as tauriPlatform } from "./tauri.js";
import { platform as webPlatform } from "./web.js";

/**
 * A file read from disk (or from the browser file chooser).
 * @typedef {Object} PlatformFile
 * @property {string} name        File name without folders.
 * @property {string} [path]      Absolute path. Desktop only; browsers never expose paths.
 * @property {Uint8Array} bytes   File content.
 * @property {string} mime        MIME type (from the file or guessed from the extension).
 */

/**
 * @typedef {Object} FileFilter
 * @property {string} [description] Name shown in the dialog, e.g. "Images".
 * @property {string[]} extensions  With or without leading dot, e.g. ["png", ".jpg"].
 */

/**
 * @typedef {Object} Platform
 * @property {boolean} isDesktop
 *   True inside the Tauri shell.
 * @property {'windows' | 'macos' | 'linux' | 'web'} os
 * @property {(options?: { accept?: FileFilter[], multiple?: boolean }) => Promise<PlatformFile[]>} openFiles
 *   Shows the open dialog. Resolves with [] when the user cancels.
 * @property {(options: { suggestedName?: string, bytes: Uint8Array | Blob, mime?: string, filters?: { name?: string, description?: string, extensions: string[] }[] }) => Promise<{ name: string, path?: string } | null>} saveFile
 *   Shows the save dialog (browsers without the File System Access API download
 *   the file instead). Resolves with null when the user cancels.
 * @property {(path: string, bytes: Uint8Array | Blob) => Promise<{ name: string, path: string }>} saveFileTo
 *   Writes to a known path without a dialog. Desktop only: the web version throws.
 * @property {(title: string) => Promise<void>} setTitle
 * @property {(url: string) => Promise<void>} openExternal
 *   Opens http(s) and mailto links in the default application.
 * @property {(callback: (files: PlatformFile[]) => void) => Promise<() => void>} onOpenFiles
 *   Files opened through the OS: file association, launch arguments, a second
 *   launch, "open with", drop on the Dock icon; in the PWA the launchQueue.
 *   Resolves with an unsubscribe function once the subscription is active.
 * @property {() => Promise<Blob | null>} clipboardReadImage
 *   An image from the system clipboard as a Blob, or null.
 * @property {(blob: Blob) => Promise<void>} clipboardWriteImage
 * @property {() => Promise<void>} quit
 */

const inTauri = typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

/** @type {Platform} */
export const platform = inTauri ? tauriPlatform : webPlatform;

export default platform;
