// Menubar and context menus, rendered from the command registry with Shoelace menus.
import { h, prettyShortcut, empty } from "../core/util.js";

const DESIGN = ["vector", "pixel", "layout"];

/** '-' = separator, string = command id, {label,items} = submenu, {dynamic:'name'} = built at open time. */
export const MENUS = [
  {
    label: "File",
    items: ["file.new", "file.open", "file.openFolder", { label: "Open Recent", dynamic: "recent" }, "-", "file.save", "file.saveAs", "file.saveAll", "-", "file.export", { label: "Quick Export", items: ["file.exportPNG", "file.exportJPG", "file.exportWEBP", "file.exportSVG", "file.exportPDF"] }, "-", "file.place", "file.insertPdf", "file.extractPages", "file.importReport", "file.docSetup", "-", "file.close"],
  },
  {
    label: "Edit",
    studios: DESIGN,
    items: ["edit.undo", "edit.redo", "-", "edit.cut", "edit.copy", "edit.paste", "edit.pasteInPlace", "edit.duplicate", "edit.delete", "-", "edit.selectAll", "edit.deselect", "-", "edit.preferences"],
  },
  {
    label: "Layer",
    studios: DESIGN,
    items: ["layer.newPixel", "layer.newGroup", { label: "New Adjustment", dynamic: "adjustments" }, { label: "New Live Filter", dynamic: "livefilters" }, "layer.addMask", "-", "edit.duplicate", "layer.delete", "-", "layer.mergeDown", "layer.rasterize", "layer.flatten", "-", "arrange.lock", "arrange.hide"],
  },
  {
    label: "Arrange",
    studios: DESIGN,
    items: [
      "arrange.front", "arrange.forward", "arrange.backward", "arrange.back", "-", "arrange.group", "arrange.ungroup", "-",
      { label: "Align", items: ["align.left", "align.centerH", "align.right", "-", "align.top", "align.centerV", "align.bottom", "-", "distribute.h", "distribute.v"] },
      { label: "Flip & Rotate", items: ["arrange.flipH", "arrange.flipV", "-", "arrange.rotateCW", "arrange.rotateCCW"] },
    ],
  },
  { label: "Shape", studios: DESIGN, items: ["shape.convert", "shape.expandStroke", "-", "bool.union", "bool.subtract", "bool.intersect", "bool.xor", "bool.divide", "-", "shape.trace"] },
  {
    label: "Select",
    studios: DESIGN,
    items: ["select.all", "select.none", "select.reselect", "select.invert", "-", "select.feather", "select.grow", "select.shrink", "select.border", "select.smooth", "-", "select.colorRange", "-", "select.toLayer", "select.toMask", "select.toPath"],
  },
  { label: "Filter", studios: DESIGN, items: [{ dynamic: "filters" }] },
  {
    label: "Text",
    studios: DESIGN,
    items: ["text.insertPageNumber", "text.insertPageCount", "text.insertDate", "-", "layout.linkFrames", "layout.unlinkFrames", "layout.addFlowFrame", "layout.autoflow", "-", "layout.insertTable", "layout.insertChart", "layout.toc", "layout.dataMerge"],
  },
  {
    label: "Table",
    studios: ["layout"],
    items: ["layout.insertTable", "layout.insertChart", "layout.importTable", "-", "table.rowAbove", "table.rowBelow", "table.colLeft", "table.colRight", "table.deleteRows", "table.deleteCols", "-", "table.merge", "table.split", "table.distributeCols", "table.distributeRows", "table.fit", "-", "table.sortAsc", "table.sortDesc", "-", "table.exportCSV", "table.flow", "-", "chart.editData", "chart.gallery"],
  },
  {
    label: "Document",
    studios: DESIGN,
    items: ["doc.resize", "doc.canvasSize", "doc.cropToContent", "-", "doc.addPage", "doc.deletePage", "doc.addMaster", "-", "doc.flipH", "doc.flipV", "doc.rotate90"],
  },
  {
    label: "View",
    studios: DESIGN,
    items: ["view.zoomIn", "view.zoomOut", "view.zoom100", "view.fit", "view.fitAll", "view.fitSelection", "-", "view.rulers", "view.grid", "view.guides", "view.snapping", "view.snapGrid", "view.clipContent", "-", "view.clipShadows", "view.clipHighlights", "-", "view.theme", "view.lowPower"],
  },
  // ---- Code studio
  {
    label: "Edit",
    studios: ["code"],
    items: ["code.undo", "code.redo", "-", "code.cut", "code.copy", "code.paste", "code.duplicateElement", "code.deleteElement", "-", "code.find", "code.findInFiles", "code.gotoLine", "-", "code.format", "code.toggleComment", "-", "edit.preferences"],
  },
  {
    label: "Insert",
    studios: ["code"],
    items: [{ dynamic: "elements" }, "-", "code.newFile", "code.upload", "code.importFolder"],
  },
  {
    label: "View",
    studios: ["code"],
    items: ["code.viewDesign", "code.viewSplit", "code.viewCode", "-", "code.toggleSidebar", "code.toggleBottom", "code.previewMode", "code.reload", "-", { label: "Breakpoint", items: ["code.bp.desktop-2xl", "code.bp.desktop-xl", "code.bp.desktop", "code.bp.tablet", "code.bp.mobile-landscape", "code.bp.mobile-portrait"] }, "code.zoomFit", "code.zoomIn", "code.zoomOut", "code.zoom100", "-", "code.wordWrap", "code.spacingGuides", "-", "view.theme", "view.lowPower"],
  },
  {
    label: "Go",
    studios: ["code"],
    items: ["code.quickOpen", "code.gotoElement", "code.gotoLine", "-", "code.showExplorer", "code.showAdd", "code.showNavigator", "code.showAssets", "-", "code.problems", "code.console", "-", "code.palette"],
  },
  {
    label: "Edit",
    studios: ["vibe"],
    items: ["vibe.newChat", "vibe.undoRun", "vibe.stop", "-", "edit.preferences"],
  },
  {
    label: "View",
    studios: ["vibe"],
    items: ["vibe.tabCanvas", "vibe.tabActivity", "vibe.tabModels", "vibe.tabTools", "vibe.tabSkills", "vibe.tabKnowledge", "-", "view.theme"],
  },
  { label: "Studio", items: ["studio.vector", "studio.pixel", "studio.layout", "studio.code", "studio.vibe", "-", "ext.manage", { label: "Extension Commands", dynamic: "extCommands" }] },
  { label: "Help", items: ["help.palette", "help.tour", "help.studioTour", "help.whatsThis", "-", "help.shortcuts", "help.whatsNew", "help.docs", "help.issues", "help.troubleshoot", "help.security", "-", "help.about"] },
];

function itemFor(app, cmdId) {
  const c = app.commands.get(cmdId);
  if (!c) return null;
  const type = c.checked ? "checkbox" : undefined;
  const el = h("sl-menu-item", { value: cmdId, type, disabled: c.enabled ? !c.enabled(app) : false });
  if (c.checked) el.checked = !!c.checked(app);
  const ic = c.icon;
  if (ic) {
    const [lib, name] = ic.includes(":") ? ic.split(":") : [undefined, ic];
    el.append(h("sl-icon", { slot: "prefix", name, library: lib === "of" ? "of" : undefined }));
  }
  el.append(c.label);
  const sc = c.shortcut;
  if (sc) el.append(h("span", { slot: "suffix", class: "of-kbd" }, prettyShortcut(sc)));
  return el;
}

function fill(app, menu, items) {
  let lastSep = true;
  const push = (el) => {
    menu.append(el);
    lastSep = false;
  };
  for (const it of items) {
    if (it === "-") {
      if (!lastSep) {
        menu.append(h("sl-divider"));
        lastSep = true;
      }
      continue;
    }
    if (typeof it === "string") {
      const el = itemFor(app, it);
      if (el) push(el);
      continue;
    }
    if (it.dynamic) {
      const provider = app.menuProviders?.[it.dynamic];
      const sub = provider ? provider(app) : [];
      if (!sub.length) continue;
      if (it.label) {
        const parent = h("sl-menu-item", it.label);
        const sm = h("sl-menu", { slot: "submenu" });
        fill(app, sm, sub);
        parent.append(sm);
        push(parent);
      } else fill(app, menu, sub);
      continue;
    }
    if (it.items) {
      const parent = h("sl-menu-item", it.label);
      const sm = h("sl-menu", { slot: "submenu" });
      fill(app, sm, it.items);
      if (!sm.children.length) continue;
      parent.append(sm);
      push(parent);
    } else if (it.run) {
      // ad-hoc item: {label, run, disabled, checked, icon}
      const el = h("sl-menu-item", { type: it.checked !== undefined ? "checkbox" : undefined, disabled: !!it.disabled }, it.label);
      if (it.checked !== undefined) el.checked = !!it.checked;
      if (it.icon) el.prepend(h("sl-icon", { slot: "prefix", name: it.icon }));
      el.addEventListener("click", () => it.run());
      el._run = it.run;
      push(el);
    }
  }
}

function trimSeparators(menu) {
  const kids = [...menu.children];
  while (kids.length && kids[kids.length - 1].tagName === "SL-DIVIDER") kids.pop().remove();
  while (menu.firstElementChild?.tagName === "SL-DIVIDER") menu.firstElementChild.remove();
}

export function buildMenu(app, items) {
  const menu = h("sl-menu");
  fill(app, menu, items);
  trimSeparators(menu);
  menu.addEventListener("sl-select", (e) => {
    const item = e.detail.item;
    if (item._run) return;
    if (item.value) app.run(item.value);
  });
  return menu;
}

/** Top menubar. */
export function createMenubar(app) {
  const bar = h("nav.of-menubar", { role: "menubar" });
  const dropdowns = [];
  let openDd = null;
  for (const m of MENUS) {
    const trigger = h("button.of-menubtn", { type: "button", slot: "trigger", role: "menuitem" }, m.label);
    const dd = h("sl-dropdown", { distance: 2, hoist: true }, trigger);
    // The menu is rebuilt on every open so enabled/checked states are always current.
    dd.append(h("sl-menu"));
    dd.addEventListener("sl-show", (e) => {
      if (e.target !== dd) return;
      openDd = dd;
      for (const c of [...dd.children]) if (c.tagName === "SL-MENU") c.remove();
      const all = app.extMenuItems ? m.items.concat(app.extMenuItems(m.label, app.studio)) : m.items;
      dd.append(buildMenu(app, app.customize ? app.customize.filterMenu(all) : all)); // hidden items: Settings > Toolbox and menus
    });
    dd.addEventListener("sl-after-hide", (e) => {
      if (e.target !== dd) return;
      if (openDd === dd) openDd = null;
    });
    trigger.addEventListener("pointerenter", () => {
      if (openDd && openDd !== dd) {
        openDd.hide();
        dd.show();
      }
    });
    dd.dataset.studios = m.studios ? m.studios.join(" ") : "";
    dd.dataset.menu = m.label;
    dropdowns.push(dd);
    bar.append(dd);
  }
  const syncStudio = () => {
    for (const dd of dropdowns) {
      const list = dd.dataset.studios;
      dd.classList.toggle("hidden", (!!list && !list.split(" ").includes(app.studio)) || !!app.customize?.isMenuHidden(dd.dataset.menu));
    }
  };
  app.on("studio", syncStudio);
  app.on("menuschanged", syncStudio);
  syncStudio();
  return bar;
}

/** Floating context menu at client coordinates. */
let ctxHost = null;
export function showContextMenu(app, x, y, items) {
  if (!ctxHost) {
    ctxHost = h("div.of-ctxmenu");
    document.body.append(ctxHost);
    const close = () => ctxHost.classList.remove("open");
    document.addEventListener("pointerdown", (e) => {
      if (!ctxHost.contains(e.target)) close();
    }, true);
    window.addEventListener("blur", close);
    document.addEventListener("keydown", (e) => e.key === "Escape" && close());
    ctxHost._close = close;
  }
  empty(ctxHost);
  const menu = buildMenu(app, items);
  menu.addEventListener("sl-select", () => ctxHost._close());
  ctxHost.append(menu);
  ctxHost.classList.add("open");
  const w = 230;
  ctxHost.style.left = `${Math.min(x, innerWidth - w - 8)}px`;
  ctxHost.style.top = `${Math.min(y, innerHeight - 40)}px`;
  requestAnimationFrame(() => {
    const r = ctxHost.getBoundingClientRect();
    if (r.bottom > innerHeight - 8) ctxHost.style.top = `${Math.max(8, innerHeight - r.height - 8)}px`;
  });
}
