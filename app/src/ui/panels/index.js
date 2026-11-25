// Panel registry. Each panel: { title, icon, create(app) → {el, show?()} }.
import { createLayersPanel } from "./layers.js";
import { createAppearancePanel } from "./appearance.js";
import { createTransformPanel } from "./transform.js";
import { createColorPanel } from "./color.js";
import { createHistoryPanel, createNavigatorPanel } from "./history.js";
import { createTypePanel } from "./type.js";
import { createBrushPanel, createAdjustmentsPanel } from "./pixel.js";
import { createPagesPanel, createStylesPanel } from "./layout.js";

import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";

/** A panel whose module is loaded on first use (keeps the Code studio out of the startup bundle). */
const lazyPanel = (loader) => (app) => {
  const el = h("div.of-panel.of-panel--loading", h("sl-spinner"));
  let inst = null;
  loader()
    .then((create) => {
      inst = create(app);
      el.replaceChildren(inst.el);
      el.classList.remove("of-panel--loading");
      inst.show?.();
    })
    .catch((err) => el.replaceChildren(h("div.of-empty", `This panel could not be loaded: ${err.message}`)));
  return { el, show: () => inst?.show?.() };
};

/**
 * A panel whose content belongs to the current document or app instance of its studio (Code workspace, Scene editor,
 * Office apps, Vibe): the studio publishes it with setPanelSlot() (./slots.js) and the panel just shows the latest.
 */
const EMPTY_TEXT = {
  "scene-media": N_("Import video, audio or pictures to fill the media bin."),
  "scene-effects": N_("Select a clip on the timeline to add effects."),
  "scene-inspector": N_("Select a clip to edit its properties."),
  "proto-pages": N_("Open a Proto design to see its pages."),
  "proto-layers": N_("Open a Proto design to see its layers."),
  "proto-inspector": N_("Select a layer to see its properties."),
  "proto-assets": N_("Open a Proto design to see its components and styles."),
  "proto-variables": N_("Open a Proto design to see its variables."),
  "doc-outline": N_("Add headings to the document to build an outline."),
  "doc-styles": N_("Open a document to manage its paragraph styles."),
  "slides-thumbs": N_("Add a slide to see it here."),
  "board-comments": N_("Select an object and add a comment to start a thread."),
  "board-outline": N_("Draw something on the board to list its objects here."),
  "board-properties": N_("Select an object to edit its properties."),
  "board-library": N_("Save a selection as a component to reuse it here."),
  "vibe-chats": N_("Start a chat from the message box to see it here."),
  "vibe-canvas": N_("Ask Vibe to make something and its preview shows up here."),
  "vibe-activity": N_("Tool calls and agent steps appear here while Vibe works."),
};

const slotPanel = (id) => (app) => {
  const el = h("div.of-panel.of-panel--slot");
  const mount = () => {
    const c = app.panelSlots?.get(id);
    if (!c) el.replaceChildren(h("div.of-empty", EMPTY_TEXT[id] ? t(EMPTY_TEXT[id]) : t("Nothing to show here yet.")));
    else if (c.el.parentNode !== el) el.replaceChildren(c.el);
    return c;
  };
  app.on("panelslot", (pid) => pid === id && mount()?.show?.());
  mount();
  return { el, show: () => mount()?.show?.() };
};

export const PANELS = {
  layers: { title: "Layers", icon: "layers", create: createLayersPanel },
  appearance: { title: "Appearance", icon: "palette", create: createAppearancePanel },
  transform: { title: "Transform", icon: "bounding-box", create: createTransformPanel },
  color: { title: "Color", icon: "droplet-half", create: createColorPanel },
  history: { title: "History", icon: "clock-history", create: createHistoryPanel },
  navigator: { title: "Navigator", icon: "compass", create: createNavigatorPanel },
  type: { title: "Type", icon: "type", create: createTypePanel },
  brush: { title: "Brush", icon: "brush", create: createBrushPanel },
  adjustments: { title: "Adjust", icon: "sliders", create: createAdjustmentsPanel },
  histogram: { title: "Histogram", icon: "bar-chart", create: lazyPanel(() => import("../histogram/panel.js").then((m) => m.createHistogramPanel)) },
  info: { title: "Info", icon: "info-circle", create: lazyPanel(() => import("../histogram/info.js").then((m) => m.createInfoPanel)) },
  style: { title: "Style", icon: "palette2", create: lazyPanel(() => import("../code/style-panel.js").then((m) => m.createStylePanel)) },
  element: { title: "Settings", icon: "sliders2", create: lazyPanel(() => import("../code/element-panel.js").then((m) => m.createElementPanel)) },
  data: { title: "Data", icon: "table", create: lazyPanel(() => import("../data/panel.js").then((m) => m.createDataPanel)) },
  pages: { title: "Pages", icon: "files", create: createPagesPanel },
  styles: { title: "Styles", icon: "fonts", create: createStylesPanel },
  comments: { title: "Comments", icon: "chat-quote", create: lazyPanel(() => import("./comments.js").then((m) => m.createCommentsPanel)) },
  // Code studio: left sidebar and bottom panels (ui/code/workspace.js, ui/code/bottom.js)
  "code-explorer": { title: "Explorer", icon: "files", create: slotPanel("code-explorer") },
  "code-add": { title: "Add", icon: "plus-square", create: slotPanel("code-add") },
  "code-navigator": { title: "Navigator", icon: "diagram-3", create: slotPanel("code-navigator") },
  "code-search": { title: "Search", icon: "search", create: slotPanel("code-search") },
  "code-git": { title: "Source Control", icon: "signpost-split", create: slotPanel("code-git") },
  "code-assets": { title: "Assets", icon: "images", create: slotPanel("code-assets") },
  "code-libs": { title: "Libraries", icon: "stack", create: slotPanel("code-libs") },
  "code-problems": { title: "Problems", icon: "exclamation-triangle", create: slotPanel("code-problems") },
  "code-console": { title: "Console", icon: "terminal", create: slotPanel("code-console") },
  "code-terminal": { title: "Terminal", icon: "terminal-fill", create: slotPanel("code-terminal") },
  // Scene Studio (scene/view.js)
  "scene-media": { title: "Media", icon: "film", create: slotPanel("scene-media") },
  "scene-effects": { title: "Effects", icon: "stars", create: slotPanel("scene-effects") },
  "scene-inspector": { title: "Inspector", icon: "sliders", create: slotPanel("scene-inspector") },
  // Proto Studio (proto/panels/: pages.js, layers.js, design.js, assets.js, variables.js)
  "proto-pages": { title: "Pages", icon: "files", create: slotPanel("proto-pages") },
  "proto-layers": { title: "Layers", icon: "layers", create: slotPanel("proto-layers") },
  "proto-inspector": { title: "Design", icon: "sliders", create: slotPanel("proto-inspector") },
  "proto-assets": { title: "Assets", icon: "grid", create: slotPanel("proto-assets") },
  "proto-variables": { title: "Variables", icon: "hexagon", create: slotPanel("proto-variables") },
  // Office apps (ui/office/workspace.js, office/slides/view.js, office/board/sidebar.js)
  "doc-outline": { title: "Outline", icon: "list-nested", create: slotPanel("doc-outline") },
  "doc-styles": { title: "Styles", icon: "fonts", create: slotPanel("doc-styles") },
  "slides-thumbs": { title: "Slides", icon: "images", create: slotPanel("slides-thumbs") },
  "board-comments": { title: "Comments", icon: "chat-quote", create: slotPanel("board-comments") },
  "board-outline": { title: "Outline", icon: "layers", create: slotPanel("board-outline") },
  "board-properties": { title: "Properties", icon: "sliders", create: slotPanel("board-properties") },
  "board-library": { title: "Library", icon: "grid", create: slotPanel("board-library") },
  // Vibe Studio (ui/vibe/workspace.js)
  "vibe-chats": { title: "Chats", icon: "chat-left-text", create: slotPanel("vibe-chats") },
  "vibe-canvas": { title: "Canvas", icon: "window", create: slotPanel("vibe-canvas") },
  "vibe-activity": { title: "Activity", icon: "list-check", create: slotPanel("vibe-activity") },
};

export function registerPanel(id, def) {
  PANELS[id] = def;
}
