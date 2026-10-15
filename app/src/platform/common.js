// Helpers shared by the web and the Tauri implementation of the platform bridge.
// Pure functions only: nothing here touches the DOM at import time.

/**
 * @typedef {Object} FileTypeFilter
 * @property {string} [description]   Human readable name, e.g. "Images".
 * @property {string[]} extensions    Extensions with or without the leading dot.
 */

/** Extension (lower case, no dot) -> MIME type. */
const MIME_BY_EXTENSION = {
  ofini: "application/x-openfini",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  json: "application/json",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

/**
 * Lower-cases an extension and strips the leading dot.
 * @param {string} ext
 * @returns {string}
 */
export function normalizeExtension(ext) {
  return String(ext).trim().replace(/^\./, "").toLowerCase();
}

/**
 * Last path segment of a Windows or POSIX path (or a URL path).
 * @param {string} path
 * @returns {string}
 */
export function basename(path) {
  const parts = String(path).split(/[\\/]/);
  return parts[parts.length - 1] || String(path);
}

/**
 * Directory part of a Windows or POSIX path, or "" when there is none.
 * @param {string} path
 * @returns {string}
 */
export function dirname(path) {
  const text = String(path);
  const index = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  return index > 0 ? text.slice(0, index) : "";
}

/**
 * Extension (lower case, no dot) of a file name, or "".
 * @param {string} name
 * @returns {string}
 */
export function extensionOf(name) {
  const base = basename(name);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * MIME type for a file name (by extension), or "application/octet-stream".
 * @param {string} name
 * @returns {string}
 */
export function mimeFromName(name) {
  return MIME_BY_EXTENSION[extensionOf(name)] || "application/octet-stream";
}

/**
 * Normalizes `accept`/`filters` input: drops empty entries, strips dots.
 * @param {FileTypeFilter[] | undefined} filters
 * @returns {{ name: string, extensions: string[] }[]}
 */
export function normalizeFilters(filters) {
  if (!Array.isArray(filters)) return [];
  const result = [];
  for (const filter of filters) {
    const extensions = (filter?.extensions ?? []).map(normalizeExtension).filter(Boolean);
    if (extensions.length === 0) continue;
    result.push({ name: String(filter.description ?? filter.name ?? extensions.join(", ")), extensions });
  }
  return result;
}

/**
 * Copies any binary input into a `Uint8Array`.
 * @param {Uint8Array | ArrayBuffer | ArrayBufferView | Blob} data
 * @returns {Promise<Uint8Array>}
 */
export async function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== "undefined" && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  throw new TypeError("Expected a Uint8Array, ArrayBuffer or Blob.");
}

/**
 * Wraps binary input in a `Blob`.
 * @param {Uint8Array | ArrayBuffer | Blob} data
 * @param {string} [mime]
 * @returns {Blob}
 */
export function toBlob(data, mime) {
  if (typeof Blob !== "undefined" && data instanceof Blob) return data;
  return new Blob([data], { type: mime || "application/octet-stream" });
}

/**
 * Whether a URL may be opened in the user's default browser/mail app.
 * Only web and mail links are allowed; `javascript:`, `file:` etc. are not.
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeExternalUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

/**
 * Draws raw RGBA pixels (straight alpha) onto a canvas and encodes a PNG.
 * @param {Uint8Array | Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Blob>}
 */
export async function rgbaToPngBlob(rgba, width, height) {
  const clamped = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const imageData = new ImageData(clamped, width, height);
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed."))), "image/png");
  });
}

/**
 * Re-encodes any image Blob the browser can decode as PNG (PNG input is returned unchanged).
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
export async function toPngBlob(blob) {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      return await canvas.convertToBlob({ type: "image/png" });
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("PNG encoding failed."))), "image/png");
    });
  } finally {
    bitmap.close?.();
  }
}

/**
 * Guesses the OS from the user agent (used inside the desktop shell).
 * @returns {'windows' | 'macos' | 'linux'}
 */
export function detectDesktopOs() {
  const ua = typeof navigator === "undefined" ? "" : `${navigator.userAgent} ${navigator.platform ?? ""}`;
  if (/Windows|Win32|Win64/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X|MacIntel|MacPPC/i.test(ua)) return "macos";
  return "linux";
}
