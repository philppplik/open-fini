// Menubar and context menus, rendered from the command registry with Shoelace menus.
import { h, prettyShortcut, empty } from "../core/util.js";
import { OFFICE_MENUS } from "../studios/office.js";
import { t } from "../i18n/index.js";

// Labels in this table are English source text: extracted by scripts/i18n-extract.mjs and translated with t() at render time.
const DESIGN = ["vector", "pixel", "layout"];

/** '-' = separator, string = command id, {label,items} = submenu, {dynamic:'name'} = built at open time. */
export const MENUS = [
  {
    label: "File",
    items: ["file.new", "window.new", "file.open", "file.openFolder", { label: "Open Recent", dynamic: "recent" }, "-", "file.save", "file.saveAs", "file.saveAll", "-", "file.export", { label: "Quick Export", items: ["file.exportPNG", "file.exportJPG", "file.exportWEBP", "file.exportSVG", "file.exportPDF", "file.exportOra"] }, "-", "file.place", "file.insertPdf", "file.extractPages", "file.importReport", { label: "Swatches", items: ["file.importPalette", "-", "file.exportPalette.gpl", "file.exportPalette.ase", "file.exportPalette.aco"] }, "file.docSetup", "-", "window.popoutStudio", "window.returnToMain", "-", "file.close"],
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
    items: ["view.zoomIn", "view.zoomOut", "view.zoom100", "view.fit", "view.fitAll", "view.fitSelection", "-", "view.rulers", "view.grid", "view.guides", "view.snapping", "view.snapGrid", "view.clipContent", "-", "view.clipShadows", "view.clipHighlights", "-", "view.theme", "view.lowPower", "-", "window.popoutStudio"],
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
    items: ["code.viewDesign", "code.viewSplit", "code.viewCode", "-", "code.toggleSidebar", "code.toggleBottom", "code.previewMode", "code.reload", "code.measure", "-", { label: "Split Layout", items: ["code.layout.codeLeft", "code.layout.codeRight", "code.layout.codeTop", "code.layout.codeBottom", "-", "code.layout.auto"] }, "code.rulers", "code.viewportRotate", { label: "Breakpoint", items: ["code.bp.desktop-2xl", "code.bp.desktop-xl", "code.bp.desktop", "code.bp.tablet", "code.bp.mobile-landscape", "code.bp.mobile-portrait"] }, "code.zoomFit", "code.zoomIn", "code.zoomOut", "code.zoom100", "-", "code.wordWrap", "code.spacingGuides", "-", "view.theme", "view.lowPower"],
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
  ...OFFICE_MENUS,
  { label: "Studio", items: [{ dynamic: "studios" }, "-", "collab.open", "collab.addComment", "collab.saveVersion", "-", "ext.manage", { label: "Extension Commands", dynamic: "extCommands" }] },
  { label: "Help", items: ["help.palette", "help.tour", "help.studioTour", "help.whatsThis", "-", "help.shortcuts", "help.whatsNew", "help.docs", "help.issues", "help.troubleshoot", "help.security", "-", "help.about"] },
];

function itemFor(app, cmdId) {
  const c = app.commands.get(cmdId);
  if (!c) return null;
  const type = c.checked ? "checkbox" : undefined;
  const el = h("sl-menu-item", { value: cmdId, type, disabled: c.enabled ? !c.enabled(app) : false });
  el.dataset.key = cmdId;
  if (c.checked) el.checked = !!c.checked(app);
  const ic = c.icon;
  if (ic) {
    const [lib, name] = ic.includes(":") ? ic.split(":") : [undefined, ic];
    el.append(h("sl-icon", { slot: "prefix", name, library: lib === "of" ? "of" : undefined }));
  }
  el.append(c.label); // already translated (App.registerCommand)
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
        const parent = h("sl-menu-item", t(it.label));
        const sm = h("sl-menu", { slot: "submenu" });
        fill(app, sm, sub);
        parent.append(sm);
        push(parent);
      } else fill(app, menu, sub);
      continue;
    }
    if (it.hidden) continue;
    if (it.items) {
      const parent = h("sl-menu-item", { disabled: !!it.disabled }, t(it.label));
      if (it.icon) parent.prepend(h("sl-icon", { slot: "prefix", name: it.icon }));
      const sm = h("sl-menu", { slot: "submenu" });
      fill(app, sm, it.items);
      trimSeparators(sm);
      if (!sm.children.length) continue;
      parent.append(sm);
      push(parent);
    } else if (it.run) {
      // ad-hoc item: {label, run, disabled, checked, icon, shortcut, hidden, id, title}
      const el = h("sl-menu-item", { type: it.checked !== undefined ? "checkbox" : undefined, disabled: !!it.disabled }, t(it.label));
      if (it.checked !== undefined) el.checked = !!it.checked;
      if (it.icon) el.prepend(h("sl-icon", { slot: "prefix", name: it.icon }));
      if (it.shortcut) el.append(h("span", { slot: "suffix", class: "of-kbd" }, prettyShortcut(it.shortcut)));
      if (it.title) el.title = it.title;
      if (it.id) el.dataset.key = it.id;
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
    const trigger = h("button.of-menubtn", { type: "button", slot: "trigger", role: "menuitem" }, t(m.label));
    trigger.dataset.src = m.label;
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
  app.on("locale", () => {
    for (const b of bar.querySelectorAll(".of-menubtn")) b.textContent = t(b.dataset.src);
  });
  app.on("studio", syncStudio);
  app.on("menuschanged", syncStudio);
  syncStudio();
  return bar;
}

/** Floating context menu at client coordinates. */
let ctxHost = null;
const LAST_KEY = "openfini.ctx.last";
function readLast() {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || "{}");
  } catch {
    return {};
  }
}

/** Closes the floating context menu, if one is open. */
export function closeContextMenu(restoreFocus = true) {
  if (!ctxHost?.classList.contains("open")) return;
  ctxHost.classList.remove("open");
  const back = ctxHost._returnTo;
  ctxHost._returnTo = null;
  ctxHost._onClose?.();
  ctxHost._onClose = null;
  if (restoreFocus && back?.isConnected) back.focus?.({ preventScroll: true });
}
export const isContextMenuOpen = () => !!ctxHost?.classList.contains("open");

/**
 * Floating context menu at client coordinates. It keeps to the viewport, scrolls when taller than the window,
 * supports the keyboard (arrows, Home/End, Enter, Escape, type-ahead) and returns focus when it closes.
 * @param {object} [opts]
 * @param {string} [opts.label] accessible name of the menu
 * @param {string} [opts.lastKey] remembers the chosen item under this key and marks it as "last used" next time
 * @param {() => void} [opts.onClose]
 */
export function showContextMenu(app, x, y, items, opts = {}) {
  if (!ctxHost) {
    ctxHost = h("div.of-ctxmenu");
    document.body.append(ctxHost);
    document.addEventListener("pointerdown", (e) => {
      if (!ctxHost.contains(e.target)) closeContextMenu(false);
    }, true);
    window.addEventListener("blur", () => closeContextMenu(false));
    window.addEventListener("resize", () => closeContextMenu(false));
    ctxHost.addEventListener("contextmenu", (e) => e.preventDefault());
    ctxHost.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu(true);
      }
    });
    document.addEventListener("keydown", (e) => e.key === "Escape" && closeContextMenu(true));
  }
  closeContextMenu(false);
  empty(ctxHost);
  const menu = buildMenu(app, items);
  menu.setAttribute("aria-label", opts.label ? t(opts.label) : t("Context menu"));
  const last = opts.lastKey ? readLast()[opts.lastKey] : null;
  if (last && menu.querySelectorAll("sl-menu-item").length > 5) {
    const mark = [...menu.querySelectorAll("sl-menu-item")].find((el) => el.dataset.key === last && !el.querySelector("sl-menu"));
    if (mark) {
      mark.classList.add("of-ctx-last");
      mark.append(h("span", { slot: "suffix", class: "of-ctx-lastbadge", "aria-label": t("last used") }, t("last")));
    }
  }
  menu.addEventListener("sl-select", (e) => {
    const key = e.detail.item?.dataset?.key || e.detail.item?.value;
    if (opts.lastKey && key) {
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), [opts.lastKey]: key }));
      } catch {
        /* storage may be unavailable */
      }
    }
    closeContextMenu(true);
  });
  ctxHost._returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  ctxHost._onClose = opts.onClose || null;
  ctxHost.append(menu);
  ctxHost.style.left = `${Math.max(8, Math.min(x, innerWidth - 240))}px`;
  ctxHost.style.top = `${Math.max(8, Math.min(y, innerHeight - 60))}px`;
  ctxHost.style.setProperty("--of-ctx-max", `${innerHeight - 16}px`);
  ctxHost.classList.add("open");
  requestAnimationFrame(() => {
    const r = ctxHost.getBoundingClientRect();
    let left = Math.max(8, Math.min(x, innerWidth - r.width - 8));
    let top = y;
    if (top + r.height > innerHeight - 8) top = y - r.height >= 8 && y > innerHeight / 2 ? y - r.height : innerHeight - r.height - 8;
    ctxHost.style.left = `${left}px`;
    ctxHost.style.top = `${Math.max(8, top)}px`;
    customElements.whenDefined("sl-menu-item").then(() => {
      const first = menu.querySelector("sl-menu-item:not([disabled])");
      if (first && ctxHost.classList.contains("open")) {
        menu.setCurrentItem?.(first);
        first.focus({ preventScroll: true });
      }
    });
  });
}
