// Application shell: assembles header, tabs, context bar, toolbox, canvas, dock and status bar.
import { h } from "../core/util.js";
import { CanvasView } from "./canvas-view.js";
import { createMenubar, showContextMenu } from "./menus.js";
import { createToolbox, iconEl } from "./toolbox.js";
import { createContextBar } from "./contextbar.js";
import { createDock } from "./dock.js";
import { createStatusBar } from "./statusbar.js";
import { createDocTabs } from "./tabs.js";
import { iconButton } from "./controls.js";
import { STUDIOS } from "../studios/index.js";
import { STUDIO_ORDER } from "../core/app.js";
import { newDocumentDialog, preferencesDialog, aboutDialog, shortcutsDialog, colorDialog } from "./dialogs.js";

export function applyTheme(app) {
  const t = app.prefs.theme;
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("sl-theme-dark", dark);
  root.classList.toggle("sl-theme-light", !dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1d1e22" : "#f6f6f8");
}

export function createShell(app, root) {
  const cv = new CanvasView(app);
  app.cv = cv;

  // ---- header: brand, menus, studio switcher, quick actions
  const brand = h("div.of-brand", h("img", { src: "./icons/icon.svg", alt: "", width: 22, height: 22 }), h("span", "OpenFini"));
  const studioBtns = STUDIO_ORDER.map((id) => {
    const s = STUDIOS[id];
    const b = h("button.of-studio", { type: "button", "data-studio": id, "data-tip": `${s.label} Studio — ${s.blurb}`, "data-shortcut": `Alt+${STUDIO_ORDER.indexOf(id) + 1}`, "aria-pressed": "false" }, iconEl(`of:${s.icon}`), h("span", s.label));
    b.addEventListener("click", () => app.setStudio(id));
    return b;
  });
  const studioSwitch = h("div.of-studios", { role: "tablist", "aria-label": "Studios" }, studioBtns);
  const undo = iconButton({ icon: "arrow-counterclockwise", label: "Undo", shortcut: "Mod+Z", onClick: () => app.run("edit.undo") });
  const redo = iconButton({ icon: "arrow-clockwise", label: "Redo", shortcut: "Mod+Shift+Z", onClick: () => app.run("edit.redo") });
  const theme = iconButton({ icon: "circle-half", label: "Toggle light / dark", onClick: () => app.run("view.theme") });
  const dockToggle = iconButton({ icon: "layout-sidebar-inset-reverse", label: "Show / hide panels", cls: "of-dock-toggle", onClick: () => root.classList.toggle("dock-open") });
  // Export is a popup (formats, slices, website) available from every studio — not a studio of its own.
  const exportBtn = h("button.of-export-btn", { type: "button", "data-tip": "Export… (formats, slices, website)", "data-shortcut": "Mod+Shift+E", "aria-label": "Export" }, iconEl("box-arrow-up"), h("span", "Export"));
  exportBtn.addEventListener("click", () => app.run("file.export"));
  const header = h("header.of-header", brand, createMenubar(app), studioSwitch, h("div.of-header__actions", undo, redo, theme, exportBtn, dockToggle));

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
    for (const b of studioBtns) {
      const on = b.dataset.studio === app.studio;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    undo.disabled = !app.isEnabled("edit.undo");
    redo.disabled = !app.isEnabled("edit.redo");
    exportBtn.disabled = !app.isEnabled("file.export");
    welcome.el.classList.toggle("hidden", !!app.doc);
    layout.classList.toggle("no-doc", !app.doc);
    layout.dataset.studio = app.studio;
    const d = app.doc;
    document.title = d ? `${d.saved ? "" : "• "}${d.name} — OpenFini` : "OpenFini";
  }
  for (const ev of ["studio", "doc", "docs", "docchange", "saved"]) app.on(ev, sync);
  sync();

  app.on("toast", ({ message, variant, duration }) => {
    const icon = { primary: "info-circle", success: "check2-circle", warning: "exclamation-triangle", danger: "exclamation-octagon", neutral: "gear" }[variant] || "info-circle";
    const a = h("sl-alert", { variant, closable: true, duration }, h("sl-icon", { slot: "icon", name: icon }), message);
    document.body.append(a);
    // <sl-alert> is registered lazily by the Shoelace autoloader; toast() exists once it is defined
    customElements.whenDefined("sl-alert").then(() => a.toast());
  });

  app.on("dialog", (d) => {
    switch (d.id) {
      case "new":
        if ((d.studio || app.studio) === "code") return import("./code/start.js").then((m) => m.newWebsiteDialog(app));
        return newDocumentDialog(app, d);
      case "preferences":
        return preferencesDialog(app);
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

  app.on("contextmenu", ({ x, y, layers }) => {
    if (!app.doc) return;
    const items = [
      "edit.cut", "edit.copy", "edit.paste", "edit.pasteInPlace", "edit.duplicate", "edit.delete", "-",
      "arrange.group", "arrange.ungroup", "-",
      { label: "Arrange", items: ["arrange.front", "arrange.forward", "arrange.backward", "arrange.back"] },
      { label: "Align", items: ["align.left", "align.centerH", "align.right", "-", "align.top", "align.centerV", "align.bottom"] },
      "-", "shape.convert", "shape.expandStroke", "-", "arrange.lock", "arrange.hide",
    ];
    if (layers) items.push("-", "layer.addMask", "layer.rasterize", "layer.mergeDown");
    showContextMenu(app, x, y, items);
  });

  return { cv, toolbox, dock, context, status, welcome, sync };
}

function createWelcome(app) {
  const recent = h("div.of-welcome__recent");
  const card = (studio, text) => {
    const s = STUDIOS[studio];
    const b = h("button.of-welcome__card", { type: "button" }, h("span.of-welcome__icon", iconEl(`of:${s.icon}`)), h("strong", `${s.label} Studio`), h("span", text));
    b.addEventListener("click", () => app.emit("dialog", { id: "new", studio }));
    return b;
  };
  const el = h(
    "div.of-welcome",
    h("div.of-welcome__inner",
      h("img", { src: "./icons/icon.svg", alt: "", width: 84, height: 84 }),
      h("h1", "OpenFini"),
      h("p", "Design, code and publish — in one lightweight app."),
      h("div.of-welcome__cards", card("vector", "Curves, shapes, type and effects"), card("pixel", "Photo editing, painting and retouching"), card("layout", "Pages, text flow, styles and print"), card("code", "HTML, CSS and JavaScript with a visual designer")),
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
