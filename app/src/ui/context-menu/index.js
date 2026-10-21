// Context menu framework entry point. Usage:
//   import { registerContextProvider, openContextMenu, markContext } from "../context-menu/index.js";
// See docs/context-menus.md.
import { installContextMenus, openContextMenu } from "./service.js";
import { registerBuiltinProviders } from "./providers.js";
import { isTable, isChart } from "../../core/data-nodes.js";
import { pick } from "../../engine/hit.js";

export { registerContextProvider, openContextMenu, resolveContextItems, matchingProviders, listContextProviders, markContext, KINDS } from "./service.js";

/** Registers the built-in providers and installs the global right-click / long-press handling. Call once. */
export function initContextMenus(app) {
  registerBuiltinProviders();
  installContextMenus(app);
  // the canvas (and the layers panel) announce right-clicks as an app event
  app.on("contextmenu", (p) => openCanvasMenu(app, p));
}

/** Right-click on the canvas: selects what is under the pointer (like every design tool), then opens the menu. */
export function openCanvasMenu(app, { x, y, event, layers }) {
  if (!app.doc) return false;
  if (!layers && event && app.context && app.view) {
    const hit = pick(app.context, event.x, event.y, 6 / (app.view.zoom || 1));
    if (hit && !app.isSelected(hit) && !(app.selection || []).some((n) => isAncestor(n, hit))) app.select([hit]);
    else if (!hit && (app.selection || []).length) app.select([]);
  }
  const sel = app.selection || [];
  let kind = "canvas-empty";
  if (sel.length) {
    kind = "canvas-layers";
    if (sel.length === 1 && isTable(sel[0])) kind = "table";
    else if (sel.length === 1 && isChart(sel[0])) kind = "chart";
    else if (sel.every((n) => n.type === "text")) kind = "canvas-text";
  }
  return openContextMenu(app, { kind: layers ? "layers-row" : kind, x, y, selection: sel, data: { canvasEvent: event, layers: !!layers } });
}

function isAncestor(a, n) {
  for (let p = n._parent; p; p = p._parent) if (p === a) return true;
  return false;
}
