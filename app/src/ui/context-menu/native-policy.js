// Native (OS / webview) context menu policy. Pure: no DOM globals, works on duck-typed nodes, so it is unit-tested in Node.
//
// OpenFini is an app, not a web page: a right-click on its chrome must never open the webview's own menu ("Back", "Reload",
// "Inspect", "Save image as" ...). The global handler in service.js calls `preventDefault()` for every right-click that
// no OpenFini menu handled, EXCEPT where this policy says the native menu may show:
//   * website previews (an <iframe>, the user's own page: it keeps the browser menu),
//   * Shift + right-click in editable text (spell checker, "Inspect" for developers),
//   * elements that opt in with a `data-native-menu` attribute (or live inside one).
// Public API: shouldAllowNativeContextMenu(target, event), isTextEntry(el).
// See docs/context-menus.md.

const NO_TEXT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"]);

const tag = (el) => String(el?.tagName || "").toUpperCase();
const isElement = (el) => !!el && typeof el === "object" && typeof el.tagName === "string";

/** True when `el` is an editable text control (input with a text type, textarea, contenteditable). */
export function isTextEntry(el) {
  if (!isElement(el)) return false;
  const t = tag(el);
  if (t === "TEXTAREA") return true;
  if (t === "INPUT") return !NO_TEXT_TYPES.has(String(el.type || "text").toLowerCase());
  return el.isContentEditable === true;
}

const closest = (el, sel) => (typeof el?.closest === "function" ? el.closest(sel) : null);

/**
 * Whether the browser's own context menu may open for a right-click on `target`.
 * @param {any} target the event target (an element or a node inside one)
 * @param {{shiftKey?: boolean, composedPath?: () => any[]}} [event]
 * @returns {boolean}
 */
export function shouldAllowNativeContextMenu(target, event = {}) {
  let path = [];
  try {
    path = typeof event.composedPath === "function" ? event.composedPath() : [];
  } catch {
    path = [];
  }
  const chain = [...path.filter(isElement), ...(isElement(target) ? [target] : [])];
  if (!chain.length) return false;
  for (const el of chain) {
    if (tag(el) === "IFRAME") return true; // website previews keep the browser menu
    if (closest(el, "[data-native-menu]")) return true;
  }
  if (event.shiftKey && chain.some(isTextEntry)) return true;
  return false;
}
