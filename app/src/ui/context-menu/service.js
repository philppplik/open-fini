// Context menu service: decides the menu from WHERE and WHAT was right-clicked.
//
// Providers describe menu sections for a kind of target. When a context menu is requested the service collects every
// matching provider (highest priority first), joins their sections with separators and shows the result with
// `showContextMenu` (ui/menus.js). See docs/context-menus.md.
import { showContextMenu, closeContextMenu } from "../menus.js";
import { log } from "../../core/log.js";

/**
 * Target kinds. A kind is a plain string; providers match on it (or on anything else in the context).
 * @typedef {"canvas-empty"|"canvas-layers"|"canvas-text"|"table"|"chart"|"table-cell"|"text-field"|"code-editor"|"web-element"|"explorer-file"|"explorer-folder"|"layers-row"|"doc-tab"|"editor-tab"|"history-item"|"asset-item"|"navigator"|"panel-header"|"vibe-message"|"vibe-tool-card"|"status-bar"|"ruler"|"welcome-recent"|string} ContextKind
 */
export const KINDS = [
  "canvas-empty", "canvas-layers", "canvas-text", "table", "table-cell", "chart", "text-field", "code-editor", "web-element", "explorer-file", "explorer-folder", "layers-row", "doc-tab", "editor-tab",
  "history-item", "asset-item", "navigator", "panel-header", "vibe-message", "vibe-tool-card", "status-bar", "ruler", "welcome-recent",
];

/**
 * @typedef {object} ContextCtx
 * @property {import("../../core/app.js").App} app
 * @property {string} studio
 * @property {ContextKind} kind
 * @property {number} x client coordinates
 * @property {number} y
 * @property {Event} [event] the originating DOM event
 * @property {Element} [target] element that was clicked
 * @property {any} [selection] what is selected: layers for canvas kinds, the selected string for text kinds
 * @property {object} [data] kind specific data (node, path, doc, view, ...)
 * @property {Array} [base] items the owner of the clicked widget contributes (shown first)
 */

/**
 * @typedef {object} ContextProvider
 * @property {string} id unique id (registering the same id again replaces the provider)
 * @property {(ctx: ContextCtx) => boolean} matches
 * @property {(ctx: ContextCtx) => Array<string|object>|null|undefined} items menu items: command ids, "-", or
 *   {label, run, icon, shortcut, disabled, hidden, checked, items, id}. An empty result hides the section.
 * @property {number} [priority] higher comes first (default 0). Core sections use 100 (owner items), 50 (kind
 *   specific), 10 (generic), -10 (extensions) and -20 (AI).
 * @property {boolean} [exclusive] when it matches, providers with a lower priority are skipped
 */

/** @type {ContextProvider[]} */
const providers = [];

/** Registers a provider. Returns a function that removes it again. */
export function registerContextProvider(p) {
  if (!p || typeof p.id !== "string" || typeof p.matches !== "function" || typeof p.items !== "function") throw new TypeError("A context provider needs {id, matches(ctx), items(ctx)}.");
  const rec = { priority: 0, ...p };
  const i = providers.findIndex((x) => x.id === rec.id);
  if (i >= 0) providers.splice(i, 1, rec);
  else providers.push(rec);
  return () => {
    const k = providers.indexOf(rec);
    if (k >= 0) providers.splice(k, 1);
  };
}

export const listContextProviders = () => providers.map((p) => ({ id: p.id, priority: p.priority }));

/** Matching providers in menu order (priority descending, then registration order). */
export function matchingProviders(ctx) {
  const out = [];
  providers.forEach((p, n) => {
    try {
      if (p.matches(ctx)) out.push({ p, n });
    } catch (err) {
      log.warn("menu", `Context provider ${p.id} failed to match`, err);
    }
  });
  out.sort((a, b) => b.p.priority - a.p.priority || a.n - b.n);
  const res = [];
  for (const { p } of out) {
    res.push(p);
    if (p.exclusive) break;
  }
  return res;
}

const isSep = (x) => x === "-";
function clean(list) {
  const out = [];
  for (const it of list || []) {
    if (!it || it.hidden) continue;
    if (typeof it === "object" && it.items) {
      const items = clean(it.items);
      if (!items.length && !it.dynamic) continue;
      out.push({ ...it, items });
    } else out.push(it);
  }
  while (out.length && isSep(out[0])) out.shift();
  while (out.length && isSep(out[out.length - 1])) out.pop();
  return out.filter((x, i) => !(isSep(x) && isSep(out[i - 1])));
}

/** The items a context menu for `ctx` would show (also used by tests and the Vibe tools). */
export function resolveContextItems(ctx) {
  const sections = [];
  if (ctx.base?.length) sections.push(clean(ctx.base));
  for (const p of matchingProviders(ctx)) {
    let items;
    try {
      items = clean(p.items(ctx));
    } catch (err) {
      log.warn("menu", `Context provider ${p.id} failed`, err);
      continue;
    }
    if (items.length) sections.push(items);
  }
  const flat = [];
  for (const s of sections.filter((x) => x.length)) {
    if (flat.length) flat.push("-");
    flat.push(...s);
  }
  return clean(flat);
}

/** Builds and shows the context menu for a target. Returns false when no provider has anything to show. */
export function openContextMenu(app, partial) {
  const ctx = { app, studio: app.studio, x: 0, y: 0, ...partial };
  const items = resolveContextItems(ctx);
  if (!items.length) return false;
  showContextMenu(app, ctx.x, ctx.y, items, { label: menuLabel(ctx.kind), lastKey: ctx.kind });
  return true;
}

const LABELS = { "canvas-empty": "Canvas", "canvas-layers": "Selection", "canvas-text": "Text layer", "text-field": "Text", "code-editor": "Editor", "layers-row": "Layer", "doc-tab": "Document tab", "editor-tab": "File tab", "panel-header": "Panel" };
const menuLabel = (kind) => `${LABELS[kind] || String(kind).replace(/-/g, " ")} context menu`;

// ------------------------------------------------------------------------------------------ DOM targets

/** Marks an element as a context menu target: `markContext(tab, "doc-tab", { doc })`. */
export function markContext(el, kind, data) {
  el.dataset.ctx = kind;
  el.__ctx = data;
  return el;
}

const NO_TEXT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"]);

/** The editable text control inside an event path (works through Shoelace shadow roots), or null. */
export function textFieldIn(path) {
  for (const el of path) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.classList?.contains("cm-editor") || el.closest?.(".cm-editor")) return null; // CodeMirror has its own menu
    if (el instanceof HTMLTextAreaElement) return el;
    if (el instanceof HTMLInputElement) return NO_TEXT_TYPES.has(el.type) ? null : el;
    if (el.isContentEditable && el.getAttribute("contenteditable") !== "false") return el;
  }
  return null;
}

/** Selected text of an input, textarea or contenteditable. */
export function selectedTextOf(field) {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
  return String(window.getSelection?.() || "");
}

let installed = false;
let pressTimer = 0;

/** Installs the global right-click and long-press listeners (once). */
export function installContextMenus(app) {
  if (installed) return;
  installed = true;

  const handle = (e, { x, y, touch = false }) => {
    if (e.defaultPrevented && !touch) return; // a widget with its own explicit menu already handled it
    const path = e.composedPath?.() || [e.target];
    const field = textFieldIn(path);
    // Shift + right-click keeps the browser's own menu (spell checker, "Inspect") in text inputs
    if (field && e.shiftKey && !touch) return;
    const marked = path.find((el) => el instanceof HTMLElement && el.dataset?.ctx);
    let partial = null;
    if (field) partial = { kind: "text-field", target: field, selection: selectedTextOf(field), data: { field, readOnly: field.readOnly || field.disabled || (field.isContentEditable === false && !(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) } };
    else if (marked) partial = { kind: marked.dataset.ctx, target: marked, data: marked.__ctx || {} };
    if (!partial) return;
    if (!openContextMenu(app, { ...partial, x, y, event: e })) return;
    e.preventDefault();
  };

  document.addEventListener("contextmenu", (e) => handle(e, { x: e.clientX, y: e.clientY }));

  // touch long-press (about half a second without moving) behaves like a right-click
  let start = null;
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || !e.isPrimary) return;
    start = { x: e.clientX, y: e.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      const target = document.elementFromPoint(start.x, start.y) || e.target;
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y, composed: true });
      target.dispatchEvent(ev); // widgets with their own handler and the global handler both see it
    }, 520);
  }, true);
  const cancel = () => clearTimeout(pressTimer);
  document.addEventListener("pointerup", cancel, true);
  document.addEventListener("pointercancel", cancel, true);
  document.addEventListener("pointermove", (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  }, true);
  document.addEventListener("scroll", (e) => {
    if (!(e.target instanceof Element && e.target.closest(".of-ctxmenu"))) closeContextMenu(false);
  }, true);
}
