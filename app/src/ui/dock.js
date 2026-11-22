// Panel docks around the canvas (ADR 0033, docs/workspaces.md). This start-up module only creates the three dock hosts
// (left, right, bottom) and forwards to the docking engine in ui/docking/, which is loaded right after start-up and
// renders tab groups, splitters, floating panels and the Window menu. Until it is there, calls are queued.
import { h } from "../core/util.js";
import { dockKeyOf } from "../studios/registry.js";

export function createDock(app) {
  const el = h("aside.of-dock", { "aria-label": "Panels" });
  const left = h("aside.of-dockhost.of-dockhost--left", { "aria-label": "Left panels" });
  const bottom = h("section.of-dockhost.of-dockhost--bottom", { "aria-label": "Bottom panels" });
  let engine = null;
  const queue = [];
  const call = (name, ...args) => (engine ? engine[name]?.(...args) : (queue.push([name, args]), undefined));
  app.menuProviders = app.menuProviders || {};
  app.dockKey = () => dockKeyOf(app); // the layout key of the current view (a studio id or "office:board" ...)
  app.menuProviders.dockPanels = () => engine?.panelItems() || [];
  app.menuProviders.workspaces = () => engine?.workspaceItems() || [];
  app.on("revealpanel", (id) => call("reveal", id));

  /** Loads the engine; `layout` is the .of-layout element (the hosts are already inside it). */
  function start(layout) {
    import("./docking/view.js")
      .then((m) => {
        engine = m.createDocking(app, { right: el, left, bottom, layout });
        for (const [name, args] of queue.splice(0)) engine[name]?.(...args);
      })
      .catch((err) => console.error(err));
  }

  return {
    el,
    hosts: [left, bottom],
    start,
    render: () => call("render"),
    /** Brings a panel to the front, opening it when it is closed. */
    reveal: (id) => call("reveal", id),
    hidePanel: (id) => call("close", id),
    showPanel: (id) => call("reveal", id),
    /** Menu entries for a panel (context menu of a panel tab and the group menu). */
    panelMenu: (id) => engine?.panelMenu(id) || [],
    resetPanels: () => call("reset"),
    /** True while a panel is shown (not closed). */
    isOpen: (id) => !!engine?.isOpen(id),
    /** Collapses or expands a dock region ("left", "right", "bottom") to its icon strip; no flag toggles. */
    toggleRegion: (region, collapsed) => call("toggleRegion", region, collapsed),
  };
}
