// Application shell: assembles header, tabs, context bar, toolbox, canvas, dock and status bar.
import { h } from "../core/util.js";
import { CanvasView } from "./canvas-view.js";
import { createMenubar, showContextMenu, buildMenu } from "./menus.js";
import { createToolbox, iconEl } from "./toolbox.js";
import { createContextBar } from "./contextbar.js";
import { createDock } from "./dock.js";
import { createStatusBar } from "./statusbar.js";
import { createDocTabs } from "./tabs.js";
import { iconButton } from "./controls.js";
import { STUDIOS, listStudios, onStudioRegistered, studioIconSpec } from "../studios/registry.js";
import { createStudioBar } from "./studio-bar.js";
import { installTitleBar } from "./titlebar.js";
import { applyAppearance } from "./appearance.js";
import { newDocumentDialog, preferencesDialog, aboutDialog, shortcutsDialog, colorDialog } from "./dialogs.js";

export function applyTheme(app) {
  applyAppearance(app); // theme, accent, density, scale and the accessibility preferences
}

export function createShell(app, root) {
  const cv = new CanvasView(app);
  app.cv = cv;

  // ---- header: brand, menus, studio switcher, quick actions
  // The brand opens the application menu: settings, save all, shortcuts, about …
  const brandBtn = h("button.of-brand", { type: "button", slot: "trigger", "aria-label": "OpenFini menu", "aria-haspopup": "menu" }, h("img", { src: "./icons/mark.svg", alt: "", width: 22, height: 22 }), h("span", "OpenFini"), h("sl-icon.of-brand__caret", { name: "chevron-down" }));
  const brand = h("sl-dropdown.of-brandmenu", { distance: 4, hoist: true }, brandBtn);
  brand.addEventListener("sl-show", (e) => {
    if (e.target !== brand) return;
    for (const c of [...brand.children]) if (c.tagName === "SL-MENU") c.remove();
    brand.append(buildMenu(app, ["help.about", "-", "edit.preferences", "file.saveAll", "file.openFolder", "-", "file.lock", "-", "help.palette", "help.shortcuts", "help.tour", "help.docs", "help.issues", "help.troubleshoot"]));
  });
  const studioBar = createStudioBar(app); // max five studios + a More menu (ui/studio-bar.js)
  const undo = iconButton({ icon: "arrow-counterclockwise", label: "Undo", shortcut: "Mod+Z", onClick: () => app.run("edit.undo") });
  const redo = iconButton({ icon: "arrow-clockwise", label: "Redo", shortcut: "Mod+Shift+Z", onClick: () => app.run("edit.redo") });
  const theme = iconButton({ icon: "circle-half", label: "Toggle light / dark", onClick: () => app.run("view.theme") });
  const dockToggle = iconButton({ icon: "layout-sidebar-inset-reverse", label: "Show / hide panels", cls: "of-dock-toggle", onClick: () => root.classList.toggle("dock-open") });
  // Export is a popup (formats, slices, website) available from every studio — not a studio of its own.
  const exportBtn = h("button.of-export-btn", { type: "button", "data-tip": "Export… (formats, slices, website)", "data-shortcut": "Mod+Shift+E", "aria-label": "Export" }, iconEl("box-arrow-up"), h("span", "Export"));
  exportBtn.addEventListener("click", () => app.run("file.export"));
  const header = h("header.of-header", brand, createMenubar(app), studioBar.el, h("div.of-header__actions", undo, redo, theme, exportBtn, dockToggle));

  installTitleBar(app, header); // desktop app: the header is the window's title bar

  const tabs = createDocTabs(app);
  const context = createContextBar(app);
  const toolbox = createToolbox(app);
  const dock = createDock(app);
  const status = createStatusBar(app);
  const welcome = createWelcome(app);

  // Code studio: its sidebar and workbench are mounted lazily (the module is loaded the first time it is needed)
  const codeSide = h("div.of-codeside-host");
  const codeMain = h("div.of-codearea");
  const canvasArea = h("main.of-canvasarea", cv.el, codeMain, welcome.el);
  const layout = h("div.of-layout", header, tabs.el, context.el, toolbox.el, codeSide, canvasArea, dock.el, status.el);
  root.append(layout);
  app.dock = dock;

  // Vibe Studio (the AI workspace) is also loaded on first use; it does not need an open document
  const vibeArea = h("div.of-vibearea");
  canvasArea.append(vibeArea);
  let vibeMod = null;
  let vibeMounted = false;
  async function syncVibe() {
    if (app.studio !== "vibe") return;
    vibeMod ||= import("./vibe/workspace.js");
    try {
      const mod = await vibeMod;
      const v = mod.vibeStudio(app);
      if (!vibeMounted) {
        vibeArea.replaceChildren(v.el);
        vibeMounted = true;
      }
      v.activate();
    } catch (err) {
      console.error(err);
      app.toast(`Vibe Studio could not be loaded: ${err.message}`, "danger", 6000);
    }
  }
  app.on("studio", syncVibe);

  let codeModule = null;
  let mountedCode = null;
  async function syncCode() {
    if (app.studio !== "code" || !app.doc) return;
    codeModule ||= import("./code/workspace.js");
    const doc = app.doc;
    let mod;
    try {
      mod = await codeModule;
    } catch (err) {
      console.error(err);
      app.toast(`The Code studio could not be loaded: ${err.message}`, "danger", 6000);
      return;
    }
    if (app.studio !== "code" || app.doc !== doc) return;
    const ws = mod.workspaceFor(app, doc);
    if (mountedCode !== ws) {
      codeSide.replaceChildren(ws.side);
      codeMain.replaceChildren(ws.main);
      mountedCode = ws;
      ws.on("built", () => {
        if (mountedCode !== ws) return;
        codeSide.replaceChildren(ws.side);
        codeMain.replaceChildren(ws.main);
        app.emit("contextbar");
        app.emit("codeui", ws);
      });
    }
    app.codeUI = ws;
    ws.activate();
    app.emit("contextbar");
    app.emit("codeui", ws);
  }
  app.on("studio", syncCode);
  app.on("doc", syncCode);
  let knownDocs = new Set();
  app.on("docs", () => {
    for (const d of knownDocs) if (!app.docs.includes(d)) codeModule?.then((m) => m.disposeWorkspace(d));
    knownDocs = new Set(app.docs);
    if (!app.docs.length) {
      app.codeUI = null;
      mountedCode = null;
      codeSide.replaceChildren();
      codeMain.replaceChildren();
    }
  });

  function sync() {
    studioBar.sync();
    undo.disabled = !app.isEnabled("edit.undo");
    redo.disabled = !app.isEnabled("edit.redo");
    exportBtn.disabled = !app.isEnabled("file.export");
    welcome.el.classList.toggle("hidden", !!app.doc || app.studio === "vibe");
    layout.classList.toggle("no-doc", !app.doc);
    layout.dataset.studio = app.studio;
    const d = app.doc;
    document.title = d ? `${d.saved ? "" : "• "}${d.name} — OpenFini` : "OpenFini";
  }
  for (const ev of ["studio", "doc", "docs", "docchange", "saved"]) app.on(ev, sync);
  sync();

  app.on("toast", ({ message, variant, duration, action }) => {
    const icon = { primary: "info-circle", success: "check2-circle", warning: "exclamation-triangle", danger: "exclamation-octagon", neutral: "gear" }[variant] || "info-circle";
    const a = h("sl-alert", { variant, closable: true, duration }, h("sl-icon", { slot: "icon", name: icon }), message);
    if (action?.run) {
      const b = h("button.of-toast-action", { type: "button" }, action.label || "Details");
      b.addEventListener("click", () => {
        a.hide?.();
        action.run();
      });
      a.append(" ", b);
    }
    document.body.append(a);
    // <sl-alert> is registered lazily by the Shoelace autoloader; toast() exists once it is defined
    customElements.whenDefined("sl-alert").then(() => a.toast());
  });

  app.on("dialog", (d) => {
    switch (d.id) {
      case "new":
      {
        // each studio decides what "New" means: a canvas dialog (default), its own start dialog (Code: website
        // templates), or just opening the studio (workspace studios such as Vibe)
        const target = STUDIOS[d.studio || app.studio];
        if (target?.newDocument) return target.newDocument(app, d);
        if (d.studio && target?.workspace) return app.setStudio(d.studio);
        return newDocumentDialog(app, d);
      }
      case "preferences":
        return preferencesDialog(app, d.section);
      case "about":
        return aboutDialog(app);
      case "shortcuts":
        return shortcutsDialog(app);
      case "color":
        return colorDialog(app, d.which);
      default:
        app.emit(`dialog:${d.id}`, d);
    }
  });

  app.on("contextmenu", ({ x, y, layers, event }) => {
    if (!app.doc) return;
    const items = [
      "edit.cut", "edit.copy", "edit.paste", "edit.pasteInPlace", "edit.duplicate", "edit.delete", "-",
      "arrange.group", "arrange.ungroup", "-",
      { label: "Arrange", items: ["arrange.front", "arrange.forward", "arrange.backward", "arrange.back"] },
      { label: "Align", items: ["align.left", "align.centerH", "align.right", "-", "align.top", "align.centerV", "align.bottom"] },
      "-", "shape.convert", "shape.expandStroke", "-", "arrange.lock", "arrange.hide",
    ];
    if (layers) items.push("-", "layer.addMask", "layer.rasterize", "layer.mergeDown");
    const ai = app.aiQuick?.canvasAiItems(app) || [];
    if (ai.length) items.push("-", { label: "AI", icon: "stars", items: ai });
    items.push(...(app.extMenuItems?.("context:canvas", app.studio) || []));
    // table / chart specific items (commands/data.js)
    for (const p of app.contextItemProviders || []) {
      const extra = p(app, event);
      if (extra?.length) items.unshift(...extra, "-");
    }
    showContextMenu(app, x, y, items);
  });

  return { cv, toolbox, dock, context, status, welcome, sync };
}

function createWelcome(app) {
  const recent = h("div.of-welcome__recent");
  // one card per registered studio (a studio registered later adds its card)
  const card = (s) => {
    const b = h("button.of-welcome__card", { type: "button" }, h("span.of-welcome__icon", iconEl(studioIconSpec(s))), h("strong", `${s.label} Studio`), h("span", s.blurb));
    b.addEventListener("click", () => app.emit("dialog", { id: "new", studio: s.id }));
    return b;
  };
  const cards = h("div.of-welcome__cards", listStudios().map(card));
  onStudioRegistered(() => cards.replaceChildren(...listStudios().map(card)));
  const el = h(
    "div.of-welcome",
    h("div.of-welcome__inner",
      h("img", { src: "./icons/icon.svg", alt: "", width: 84, height: 84 }),
      h("h1", "OpenFini"),
      h("p", "Design, code and publish — in one lightweight app."),
      cards,
      h("div.of-welcome__actions",
        h("sl-button", { variant: "primary", onclick: () => app.run("file.new") }, h("sl-icon", { slot: "prefix", name: "plus-lg" }), "New Document"),
        h("sl-button", { onclick: () => app.run("file.open") }, h("sl-icon", { slot: "prefix", name: "folder2-open" }), "Open…")),
      recent,
      h("p.of-hint", "Tip: drop an image or SVG anywhere to start. Everything stays on your device."),
    ),
  );
  app.on("recents", (list) => {
    recent.replaceChildren();
    if (!list?.length) return;
    recent.append(h("h3", "Recent"), ...list.slice(0, 6).map((r) => h("button.of-welcome__recent-item", { type: "button", onclick: () => app.run("file.openRecent", r) }, h("sl-icon", { name: "file-earmark-image" }), h("span", r.name), h("small", new Date(r.time).toLocaleDateString("en-US")))));
  });
  return { el };
}
