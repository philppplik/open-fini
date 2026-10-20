// Built-in context menu providers. Each one describes a section of the menu for a kind of target; the service joins
// the sections of every matching provider. See docs/context-menus.md for the priority bands.
import { registerContextProvider } from "./service.js";

const CANVAS_KINDS = new Set(["canvas-empty", "canvas-layers", "canvas-text", "table", "table-cell", "chart"]);
export const isCanvasKind = (ctx) => CANVAS_KINDS.has(ctx.kind);

/** Extension menu group for a kind of target (`context:<group>` in an extension manifest). */
export function extensionGroup(kind) {
  if (CANVAS_KINDS.has(kind)) return "canvas";
  if (kind === "code-editor") return "code";
  if (kind === "explorer-file" || kind === "explorer-folder") return "explorer";
  if (kind === "layers-row") return "layers";
  if (kind === "text-field") return "text";
  return null;
}

const copyText = async (app, text, what = "Copied.") => {
  try {
    await navigator.clipboard.writeText(text);
    app.toast?.(what, "success", 1400);
  } catch {
    app.toast?.("The browser blocked clipboard access.", "warning", 3000);
  }
};

// ------------------------------------------------------------------------------------------ text fields

function fieldItems(ctx) {
  const { field, readOnly } = ctx.data;
  const sel = ctx.selection || "";
  const isInput = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement;
  const has = sel.length > 0;
  const exec = (cmd) => () => {
    field.focus();
    document.execCommand(cmd);
  };
  const insert = (text) => {
    field.focus();
    if (!document.execCommand("insertText", false, text) && isInput) {
      field.setRangeText(text, field.selectionStart ?? 0, field.selectionEnd ?? 0, "end");
      field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
  };
  const replace = (fn) => async () => {
    const out = await fn(sel);
    if (out != null && out !== sel) insert(out);
  };
  const tf = (id) => replace(async (s) => (await import("../../engine/web/texttools.js")).TRANSFORM_BY_ID.get(id).apply(s));
  const items = [
    { label: "Undo", icon: "arrow-counterclockwise", disabled: readOnly, run: exec("undo"), hidden: readOnly },
    { label: "Redo", icon: "arrow-clockwise", disabled: readOnly, run: exec("redo"), hidden: readOnly },
    readOnly ? null : "-",
    { label: "Cut", icon: "scissors", shortcut: "Mod+X", disabled: readOnly || !has, run: exec("cut"), hidden: readOnly },
    { label: "Copy", icon: "clipboard", shortcut: "Mod+C", disabled: !has, run: () => (document.execCommand("copy") || copyText(ctx.app, sel)) },
    {
      label: "Paste", icon: "clipboard-plus", shortcut: "Mod+V", hidden: readOnly, run: async () => {
        try {
          insert(await navigator.clipboard.readText());
        } catch {
          ctx.app.toast?.("Allow clipboard access in your browser, or press Ctrl+V.", "warning", 3500);
        }
      },
    },
    { label: "Select all", shortcut: "Mod+A", run: () => (field.focus(), isInput ? field.select() : document.execCommand("selectAll")) },
  ].filter(Boolean);
  if (has && !readOnly) {
    items.push("-", {
      label: "Transform", icon: "type", items: [
        { label: "UPPER CASE", run: tf("upperCase") }, { label: "lower case", run: tf("lowerCase") }, { label: "Title Case", run: tf("titleCase") }, "-",
        { label: "Trim whitespace", run: tf("trimLines") }, { label: "Normalize whitespace", run: tf("normalizeWhitespace") }, "-",
        { label: "Encode as HTML entities", run: tf("encodeEntitiesNamed") }, { label: "Decode HTML entities", run: tf("decodeEntities") },
      ],
    });
  }
  if (isInput && field.type !== "password" && ctx.app.prefs?.spellHint !== false) {
    // Browsers expose their spell-check suggestions only in the native menu; keep it reachable.
    items.push("-", { label: "Hold Shift and right-click for the browser menu", disabled: true, run() {} });
  }
  return items;
}

// ------------------------------------------------------------------------------------------ canvas

function canvasEditItems(ctx) {
  const { app } = ctx;
  const empty = ctx.kind === "canvas-empty";
  if (empty) {
    return [
      "edit.paste", "edit.pasteInPlace", "-", "edit.selectAll", "-",
      { label: "View", icon: "zoom-in", items: ["view.fit", "view.fitAll", "view.zoom100", "view.zoomIn", "view.zoomOut", "-", "view.rulers", "view.grid", "view.guides", "view.snapping"] },
      app.doc ? { label: "Add page", icon: "file-earmark-plus", run: () => app.run("doc.addPage") } : null,
    ];
  }
  const items = [
    "edit.cut", "edit.copy", "edit.paste", "edit.pasteInPlace", "edit.duplicate", "edit.delete", "-",
    "arrange.group", "arrange.ungroup", "-",
    { label: "Arrange", items: ["arrange.front", "arrange.forward", "arrange.backward", "arrange.back"] },
    { label: "Align", items: ["align.left", "align.centerH", "align.right", "-", "align.top", "align.centerV", "align.bottom"] },
    "-", "shape.convert", "shape.expandStroke", "-", "arrange.lock", "arrange.hide",
  ];
  if (ctx.kind === "layers-row") items.push("-", "layer.addMask", "layer.rasterize", "layer.mergeDown");
  return items;
}

/** Applies a text transform to the runs of the selected text layers (keeps run formatting). */
async function transformTextLayers(app, fn, label) {
  const doc = app.doc;
  const targets = (app.selection || []).filter((n) => n.type === "text" && n.storyId && doc.stories[n.storyId]);
  if (!targets.length) return;
  doc.tx(label, () => {
    for (const n of targets) {
      const story = doc.stories[n.storyId].story;
      const paragraphs = story.paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, text: fn(r.text) })) }));
      doc.setStory(n.storyId, { ...story, paragraphs }, label);
    }
  });
}

function textLayerItems(ctx) {
  const { app } = ctx;
  if (!(app.selection || []).some((n) => n.type === "text")) return [];
  const t = (label, make) => ({ label, run: async () => transformTextLayers(app, await make(), `Transform text: ${label}`) });
  const tt = async () => await import("../../engine/web/texttools.js");
  return [{
    label: "Transform text", icon: "type", items: [
      t("UPPER CASE", async () => (s) => s.toUpperCase()),
      t("lower case", async () => (s) => s.toLowerCase()),
      t("Title Case", async () => (await tt()).toTitle),
      "-",
      t("Trim spaces", async () => (s) => s.replace(/[ \t]+$/gm, "").replace(/^[ \t]+/gm, "")),
      t("Normalize spaces", async () => (await tt()).normalizeSpaces),
    ],
  }];
}

// ------------------------------------------------------------------------------------------ registration

let registered = false;
/** Registers the built-in providers (idempotent). */
export function registerBuiltinProviders() {
  if (registered) return;
  registered = true;

  registerContextProvider({
    id: "core.text-field",
    priority: 50,
    matches: (c) => c.kind === "text-field",
    items: fieldItems,
  });

  // table and chart items from commands/data.js (app.contextItemProviders), shown first on the canvas
  registerContextProvider({
    id: "core.canvas.legacy",
    priority: 100,
    matches: isCanvasKind,
    items: (c) => {
      const out = [];
      for (const p of c.app.contextItemProviders || []) {
        const extra = p(c.app, c.data?.canvasEvent);
        if (extra?.length) out.unshift(...extra, "-");
      }
      return out;
    },
  });

  registerContextProvider({
    id: "core.canvas",
    priority: 50,
    matches: (c) => isCanvasKind(c) || c.kind === "layers-row",
    items: canvasEditItems,
  });

  registerContextProvider({
    id: "core.layers-row",
    priority: 60,
    matches: (c) => c.kind === "layers-row",
    items: (c) => [
      { label: "Rename", icon: "pencil", shortcut: "F2", run: () => c.data.rename?.() },
      { label: "Copy layer name", icon: "clipboard", run: () => copyText(c.app, c.data.node?.name || c.data.node?.type || "", "Layer name copied.") },
    ],
  });

  registerContextProvider({
    id: "core.text-layer",
    priority: 40,
    matches: (c) => c.kind === "canvas-text" || c.kind === "layers-row",
    items: textLayerItems,
  });

  registerContextProvider({
    id: "core.doc-tab",
    priority: 50,
    matches: (c) => c.kind === "doc-tab",
    items: (c) => {
      const { app } = c;
      const doc = c.data.doc;
      const others = app.docs.filter((d) => d !== doc);
      const closeAll = async (list) => {
        for (const d of list) await app.run("file.close", d);
      };
      return [
        { label: "Save", icon: "save", disabled: doc.saved, run: () => (app.activateDoc(doc), app.run("file.save")) },
        { label: "Save as…", icon: "save2", run: () => (app.activateDoc(doc), app.run("file.saveAs")) },
        { label: "Export…", icon: "box-arrow-up", run: () => (app.activateDoc(doc), app.run("file.export")) },
        "-",
        { label: "Close", icon: "x-lg", shortcut: "Mod+W", run: () => app.run("file.close", doc) },
        { label: "Close others", disabled: !others.length, run: () => closeAll(others) },
        { label: "Close all", run: () => closeAll(app.docs.slice()) },
        "-",
        { label: "Copy name", icon: "clipboard", run: () => copyText(app, doc.name, "Name copied.") },
      ];
    },
  });

  registerContextProvider({
    id: "core.history-item",
    priority: 50,
    matches: (c) => c.kind === "history-item",
    items: (c) => [
      { label: "Go back to this step", icon: "arrow-counterclockwise", run: () => c.data.go?.() },
      { label: "Copy step name", icon: "clipboard", run: () => copyText(c.app, c.data.label || "", "Step name copied.") },
      "-",
      { label: "Clear history", icon: "trash3", disabled: !c.app.doc?.history.entries.length, run: () => c.app.doc?.history.clear() },
    ],
  });

  registerContextProvider({
    id: "core.navigator",
    priority: 50,
    matches: (c) => c.kind === "navigator",
    items: () => ["view.fit", "view.fitAll", "view.zoom100", "view.zoomIn", "view.zoomOut", "-", "view.rulers", "view.grid"],
  });

  registerContextProvider({
    id: "core.asset-item",
    priority: 10,
    matches: (c) => c.kind === "asset-item" && c.data.path,
    items: (c) => ["-", { label: "Copy file name", icon: "clipboard", run: () => copyText(c.app, c.data.path.split("/").pop(), "File name copied.") }],
  });

  registerContextProvider({
    id: "core.panel-header",
    priority: 50,
    matches: (c) => c.kind === "panel-header",
    items: (c) => {
      const dock = c.app.dock;
      const { id, title } = c.data;
      const hidden = dock?.hiddenPanels?.() || [];
      return [
        { label: `Hide “${title}”`, icon: "eye-slash", disabled: dock.visibleCount?.() <= 1, run: () => dock.hidePanel(id) },
        { label: "Move to the other area", icon: "arrow-down-up", run: () => dock.movePanel(id), disabled: !dock.canMove?.(id) },
        "-",
        { label: "Show panel", icon: "layout-sidebar-inset-reverse", items: hidden.map((p) => ({ label: p.title, run: () => dock.showPanel(p.id) })), hidden: !hidden.length },
        { label: "Reset panel layout", icon: "arrow-counterclockwise", run: () => dock.resetPanels(), disabled: !dock.isCustomized?.() },
      ];
    },
  });

  registerContextProvider({
    id: "core.status-bar",
    priority: 50,
    matches: (c) => c.kind === "status-bar",
    items: () => ["view.fit", "view.fitAll", "view.zoom100", "view.zoomIn", "view.zoomOut", "-", "view.lowPower", "view.theme"],
  });

  registerContextProvider({
    id: "core.ruler",
    priority: 50,
    matches: (c) => c.kind === "ruler" && c.data.cv,
    items: (c) => {
      const { cv, axis } = c.data;
      const { app } = c;
      const page = app.page;
      const e = c.event ? cv.makeEvent(c.event) : null;
      const pos = e ? Math.round((axis === "v" ? e.x : e.y) * 100) / 100 : 0;
      const guides = page?.guides || { h: [], v: [] };
      const set = (g, label) => app.doc.set(page, { guides: g }, label);
      return [
        { label: `Add ${axis === "v" ? "vertical" : "horizontal"} guide here (${Math.round(pos)} px)`, icon: "plus-lg", disabled: !page || !e, run: () => set({ ...guides, [axis]: [...guides[axis], pos] }, "Guide") },
        { label: `Clear ${axis === "v" ? "vertical" : "horizontal"} guides`, disabled: !guides[axis]?.length, run: () => set({ ...guides, [axis]: [] }, "Clear Guides") },
        { label: "Clear all guides", disabled: !guides.h?.length && !guides.v?.length, run: () => set({ h: [], v: [] }, "Clear Guides") },
        "-", "view.guides", "view.snapping", "view.rulers",
      ];
    },
  });

  registerContextProvider({
    id: "core.welcome-recent",
    priority: 50,
    matches: (c) => c.kind === "welcome-recent",
    items: (c) => [
      { label: "Open", icon: "folder2-open", run: () => c.app.run("file.openRecent", c.data.recent) },
      { label: "Copy name", icon: "clipboard", run: () => copyText(c.app, c.data.recent.name, "Name copied.") },
      "-",
      { label: "Remove from recent files", icon: "x-circle", run: async () => c.app.emit("recents", await (await import("../../core/storage.js")).removeRecent(c.data.recent.id)) },
    ],
  });

  // Extensions: `contributes.menus` entries for context:<group> (see docs/extensions.md)
  registerContextProvider({
    id: "core.extensions",
    priority: -10,
    matches: (c) => !!extensionGroup(c.kind) && !!c.app.extMenuItems,
    items: (c) => c.app.extMenuItems(`context:${extensionGroup(c.kind)}`, c.studio) || [],
  });

  // AI quick actions: gated by Settings > Artificial intelligence (the helpers return nothing while it is off)
  registerContextProvider({
    id: "core.ai.canvas",
    priority: -20,
    matches: (c) => (isCanvasKind(c) || c.kind === "layers-row") && !!c.app.prefs.aiEnabled,
    items: (c) => {
      const ai = c.app.aiQuick?.canvasAiItems(c.app) || [];
      return ai.length ? [{ label: "AI", icon: "stars", items: ai }] : [];
    },
  });
}
