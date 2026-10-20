// PWA helpers: service worker registration with a safe update flow, and the
// "install app" prompt. Both do nothing inside the Tauri desktop shell.

/**
 * Whether a service worker can and should be used here: a secure origin
 * (https or localhost), a browser that supports it, and not the desktop shell
 * (the app is already bundled inside the binary there).
 * @returns {boolean}
 */
export function isServiceWorkerSupported() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  if (window.__TAURI_INTERNALS__) return false;
  return window.isSecureContext && /^https?:$/.test(window.location.protocol);
}

/**
 * @typedef {Object} RegisterOptions
 * @property {(applyUpdate: () => void, registration: ServiceWorkerRegistration) => void} [onUpdate]
 *   A new version finished downloading and waits in the background. Call
 *   `applyUpdate()` (for example from an "Update" button) to switch to it; the
 *   page reloads once the new version took over. Nothing changes until you do.
 * @property {() => void} [onOfflineReady]
 *   The very first install finished: the app now works offline.
 * @property {string} [scriptUrl]            Default "sw.js", resolved against the page.
 * @property {number} [checkIntervalMs]      How often to look for updates. Default one hour; 0 disables.
 */

/**
 * Registers the service worker and wires up the update flow.
 *
 * Updates never interrupt editing: a new worker installs silently, then waits
 * until the page asks for it through `applyUpdate`.
 *
 * @param {RegisterOptions} [options]
 * @returns {Promise<{ registration: ServiceWorkerRegistration, checkForUpdate: () => Promise<void>, applyUpdate: () => void } | null>}
 *   null when service workers are unavailable (desktop shell, insecure origin, old browser).
 */
export async function registerServiceWorker({
  onUpdate,
  onOfflineReady,
  scriptUrl = "sw.js",
  checkIntervalMs = 60 * 60 * 1000,
} = {}) {
  if (!isServiceWorkerSupported()) return null;

  let registration;
  try {
    // The default scope is the folder of the script, i.e. the whole app.
    registration = await navigator.serviceWorker.register(new URL(scriptUrl, document.baseURI), {
      updateViaCache: "none",
    });
  } catch (err) {
    console.warn("OpenFini: service worker registration failed", err);
    return null;
  }

  let reloading = false;
  const applyUpdate = () => {
    const waiting = registration.waiting;
    if (!waiting) return;
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      },
      { once: true },
    );
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  const announceUpdate = () => {
    // Without a controller this is the first install, not an update.
    if (registration.waiting && navigator.serviceWorker.controller) onUpdate?.(applyUpdate, registration);
  };

  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state !== "installed") return;
      if (navigator.serviceWorker.controller) announceUpdate();
      else onOfflineReady?.();
    });
  });
  // A worker may already be waiting from an earlier visit.
  announceUpdate();

  const checkForUpdate = async () => {
    try {
      await registration.update();
    } catch {
      // Offline or the server is unreachable: try again next time.
    }
  };
  if (checkIntervalMs > 0) {
    setInterval(checkForUpdate, checkIntervalMs);
    window.addEventListener("online", checkForUpdate);
  }

  return { registration, checkForUpdate, applyUpdate };
}

/**
 * Whether the app currently runs as an installed PWA (standalone window).
 * @returns {boolean}
 */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches === true || window.navigator.standalone === true;
}

/**
 * Captures the browser's install prompt so the UI can offer an "Install" button
 * at a moment of its choosing. Create it early (at startup): the browser fires
 * `beforeinstallprompt` only once, soon after load.
 *
 * @param {{ onChange?: (canInstall: boolean) => void }} [options]
 * @returns {{ readonly canInstall: boolean, prompt: () => Promise<'accepted' | 'dismissed' | 'unavailable'>, dispose: () => void }}
 */
export function createInstallPrompt({ onChange } = {}) {
  /** @type {any} */
  let deferred = null;

  const onBeforeInstall = (event) => {
    event.preventDefault();
    deferred = event;
    onChange?.(true);
  };
  const onInstalled = () => {
    deferred = null;
    onChange?.(false);
  };

  if (typeof window !== "undefined" && !window.__TAURI_INTERNALS__) {
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
  }

  return {
    get canInstall() {
      return deferred !== null;
    },
    async prompt() {
      if (!deferred) return "unavailable";
      const event = deferred;
      deferred = null; // a prompt event can be used only once
      onChange?.(false);
      await event.prompt();
      const { outcome } = await event.userChoice;
      return outcome;
    },
    dispose() {
      if (typeof window === "undefined") return;
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    },
  };
}

/** Cache that sw.js fills when another app shares files with OpenFini (Web Share Target). */
export const SHARE_CACHE = "ofshare-v1";

/**
 * Takes the files stored for one share (see sw.js) out of the cache and returns them as platform files.
 * The cache entries are deleted, so a reload does not open them again.
 * @param {string} id the `share` value of the launch URL
 * @returns {Promise<{ name: string, bytes: Uint8Array, mime: string }[]>}
 */
export async function takeSharedFiles(id) {
  if (typeof caches === "undefined" || !/^[a-z0-9]+$/i.test(String(id))) return [];
  const cache = await caches.open(SHARE_CACHE);
  const marker = `/share-files/${id}/`;
  const entries = [];
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    const at = path.indexOf(marker);
    if (at < 0) continue;
    const [index, ...name] = path.slice(at + marker.length).split("/");
    entries.push({ request, index: Number(index) || 0, name: decodeURIComponent(name.join("/")) || "shared-file" });
  }
  entries.sort((x, y) => x.index - y.index);
  const files = [];
  for (const entry of entries) {
    const response = await cache.match(entry.request);
    if (response) {
      files.push({ name: entry.name, bytes: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get("content-type") || "application/octet-stream" });
    }
    await cache.delete(entry.request);
  }
  return files;
}
