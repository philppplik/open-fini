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
};

export function registerPanel(id, def) {
  PANELS[id] = def;
}
