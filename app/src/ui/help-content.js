// One-line explanations used by tooltips (second line) and by the "What's this?" mode (Shift+F1).
// Pure data plus a resolver; loaded on demand.

export const TOOL_HELP = {
  move: "Select, move, scale and rotate layers. Drag a box to select several; hold Shift to add to the selection.",
  node: "Edit the points and handles of a path. Click a point to select it; drag handles to reshape curves.",
  pen: "Draw precise paths: click for corners, click and drag for smooth curves. Click the first point to close.",
  pencil: "Draw freehand and let OpenFini smooth the stroke into a clean path.",
  rect: "Draw rectangles and squares (hold Shift). Drag the corner handles to round them.",
  ellipse: "Draw ellipses and circles (hold Shift for a circle).",
  polygon: "Draw regular polygons. Change the number of sides in the context bar.",
  star: "Draw stars. Change the points and inner radius in the context bar.",
  shapes: "Insert ready-made shapes such as arrows, speech bubbles and hearts.",
  line: "Draw straight lines. Hold Shift to snap to 15 degree steps.",
  text: "Click the canvas and type. Artistic text stays a single line you can scale like a shape.",
  "frame-text": "Drag a text frame for body copy that wraps, flows between linked frames and hyphenates.",
  "image-frame": "Drag a frame and place a picture in it. The picture can be panned and scaled inside the frame.",
  gradient: "Drag across a shape to fill it with a gradient; edit stops on the canvas or in the Appearance panel.",
  fill: "Click to fill a shape or, in Pixel, a region of similar color.",
  eyedropper: "Click anywhere to pick a color. Alt-click picks the background color.",
  crop: "Crop the image. Drag the handles, drag outside the box to straighten, press O to cycle composition guides and Enter to apply.",
  "perspective-crop": "Drag the four corners onto the corners of a tilted rectangle, then press Enter to straighten it.",
  "magic-eraser": "Click to erase every pixel of a similar color from the layer. Tolerance and contiguous are in the context bar.",
  slice: "Draw export slices around parts of the page to export them as separate files.",
  hand: "Pan the canvas. Hold Space with any tool for a temporary hand.",
  zoom: "Click to zoom in, Alt-click to zoom out, or drag to zoom into an area.",
  marquee: "Select a rectangular area of pixels. Hold Shift for a square.",
  "marquee-ellipse": "Select an elliptical area of pixels. Hold Shift for a circle.",
  lasso: "Draw a freehand selection around anything.",
  "poly-lasso": "Click to make a selection with straight edges; double-click to close it.",
  wand: "Click to select all neighboring pixels of a similar color. Tolerance is in the context bar.",
  "color-range": "Select every pixel in the image that matches a sampled color.",
  brush: "Paint with a soft or hard brush. [ and ] change the size; pen pressure is supported.",
  "pixel-pencil": "Draw hard-edged pixels with no anti-aliasing, for pixel art.",
  eraser: "Erase pixels from the active pixel layer.",
  clone: "Alt-click a source area, then paint to copy it somewhere else.",
  heal: "Like Clone Stamp, but blends texture into the surrounding light and color.",
  "spot-heal": "Click or paint over a blemish and it is repaired from the surroundings.",
  redeye: "Click an eye with red-eye to restore a natural pupil.",
  smudge: "Drag to smear pixels as if the paint were wet.",
  blur: "Paint to soften an area locally.",
  sharpen: "Paint to bring out detail locally.",
  dodge: "Paint to lighten areas of the image.",
  burn: "Paint to darken areas of the image.",
  sponge: "Paint to increase or decrease color saturation locally.",
  liquify: "Push, pull and twirl pixels to reshape them.",
};

export const PANEL_HELP = {
  Layers: "Every object in the document, top to bottom. Drag to reorder; click the eye or lock to hide or protect a layer.",
  Appearance: "Fill, stroke, opacity, blend mode and effects of the selected object.",
  Transform: "Exact position, size, rotation and skew of the selection.",
  Color: "Pick colors with sliders or the spectrum; swatches keep favorites.",
  History: "Every step you took. Click a step to go back to it; your later steps stay until you do something new.",
  Navigator: "A small overview of the page. Drag the box to move around the canvas.",
  Type: "Font, size, spacing and alignment of the selected text.",
  Brush: "Size, hardness, opacity and flow of the paint tools.",
  Adjust: "Non-destructive adjustments such as curves, levels and hue/saturation.",
  Histogram: "The distribution of tones in the image, for judging exposure.",
  Style: "CSS properties of the selected element, grouped by topic.",
  Settings: "Attributes, links and element-specific options of the selected element.",
  Pages: "All pages and master pages; drag to reorder, double-click to open.",
  Styles: "Reusable text styles: change one style and every use updates.",
};

export const STUDIO_HELP = {
  vector: "Draw logos, icons and illustrations from curves, shapes and type. Everything stays sharp at any size.",
  pixel: "Edit photos and paint with layers, selections, masks and adjustments.",
  layout: "Set pages with text frames that flow, styles, master pages and print output.",
  code: "Build a website with an HTML, CSS and JavaScript editor and a visual designer on a live preview.",
  vibe: "Describe what you want and an AI assistant builds it with the same tools you have. Needs an AI connection you add yourself.",
};

/** Areas of the interface: [selector, title, text]. The first match walking up from the clicked element wins. */
export const AREA_HELP = [
  [".of-brand", "Application menu", "Settings, Save All, keyboard shortcuts, documentation and the About box."],
  [".of-menubar", "Menu bar", "Every command of the current studio, with its shortcut. Press Ctrl+K to search them all."],
  [".of-studios", "Studio switcher", "Switch between Vector, Pixel, Layout, Code and Vibe. The document is the same in every studio. Alt+1 to Alt+5."],
  [".of-export-btn", "Export", "Save the page, a selection, slices or a whole website as PNG, JPEG, WebP, SVG, PDF and more."],
  [".of-doctabs", "Documents", "Your open documents. Click to switch, the dot marks unsaved changes, the plus makes a new one."],
  [".of-contextbar", "Context bar", "Options for the active tool or the selected object."],
  [".of-toolbox", "Toolbox", "Pick a tool. A small triangle marks a group: press and hold or right-click to see the others."],
  [".of-dock", "Panels", "Layers, color, history and more for the current studio. Click a tab to switch panels."],
  [".of-status", "Status bar", "Zoom, cursor position and messages."],
  [".of-welcome", "Start page", "Create a document in any studio, open a file, or drop one onto the window."],
  [".of-codeside-host", "Code studio sidebar", "Explorer, elements to insert, the page outline and assets."],
  [".of-vibe", "Vibe Studio", "Chat with the assistant on the left; canvas, models, tools and skills on the right."],
  [".of-canvasarea", "Canvas", "Your page. Scroll to pan, Ctrl+scroll to zoom, hold Space to drag. Right-click for more commands."],
];

/** What's this? for an element: {title, text, shortcut?} or null. */
export function describeElement(el, app) {
  if (!el?.closest) return null;
  const tool = el.closest("[data-tool]");
  if (tool) {
    const id = tool.dataset.tool;
    const C = app?.toolClasses?.get(id);
    return { title: C?.label || id, text: TOOL_HELP[id] || "A tool for the current studio.", shortcut: C?.shortcut };
  }
  const studio = el.closest(".of-studio[data-studio]");
  if (studio) return { title: `${studio.textContent.trim()} Studio`, text: STUDIO_HELP[studio.dataset.studio], shortcut: studio.getAttribute("data-shortcut") };
  const tab = el.closest(".of-dock__tab");
  if (tab) {
    const name = tab.getAttribute("aria-label");
    return { title: `${name} panel`, text: PANEL_HELP[name] || "A panel of the current studio." };
  }
  const own = el.closest("[data-help]");
  if (own) return { title: own.getAttribute("data-help-title") || own.getAttribute("aria-label") || "", text: own.getAttribute("data-help") };
  const tip = el.closest("[data-tip]");
  for (const [sel, title, text] of AREA_HELP) {
    const hit = el.closest(sel);
    if (hit) {
      if (tip && tip !== hit && hit.contains(tip)) return { title: tip.getAttribute("aria-label") || tip.getAttribute("data-tip"), text: `Part of the ${title.toLowerCase()}. ${text}`, shortcut: tip.getAttribute("data-shortcut") };
      return { title, text };
    }
  }
  if (tip) return { title: tip.getAttribute("data-tip"), text: "", shortcut: tip.getAttribute("data-shortcut") };
  return null;
}

/** Second tooltip line for tools, panels and studios (null elsewhere). */
export function tipDescription(el) {
  const tool = el.closest?.("[data-tool]");
  if (tool) return TOOL_HELP[tool.dataset.tool] || null;
  const tab = el.closest?.(".of-dock__tab");
  if (tab) return PANEL_HELP[tab.getAttribute("aria-label")] || null;
  return el.getAttribute?.("data-tip-desc") || null;
}
