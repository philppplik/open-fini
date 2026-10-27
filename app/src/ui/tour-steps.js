// Tour definitions (pure data). `target` is a CSS selector for the real UI the coach mark points at.
// `when`: "doc" = only when a document is open, "nodoc" = only on the start page. Steps whose target is not on screen
// are skipped. tests/ui/tour-steps.test.js checks the structure; the selectors are verified in the browser.

export const PLACEMENTS = ["top", "bottom", "left", "right", "center"];

export const TOURS = {
  welcome: {
    title: "Welcome to OpenFini",
    steps: [
      { id: "brand", target: ".of-brand", placement: "bottom", title: "Welcome to OpenFini", body: "A lightweight creative suite that runs on your device. This one-minute tour shows where things are. Use the arrow keys to move and Esc to leave." },
      { id: "studios", target: ".of-studios", placement: "bottom", title: "Five studios, one document", body: "Vector for illustration, Pixel for photos, Layout for pages, Code for websites and Vibe for building with an AI assistant. Switching studios never changes your document. Alt+1 to Alt+5 jump between them." },
      { id: "start", target: ".of-welcome__cards", placement: "top", when: "nodoc", title: "Start something", body: "Pick a studio to create a document, press Ctrl+O to open a file, or drop an image or SVG anywhere on the window." },
      { id: "toolbox", target: ".of-toolbox", placement: "right", when: "doc", title: "Tools", body: "Pick a tool here, or press its letter. A small triangle marks a group of related tools: press and hold, or right-click, to see them." },
      { id: "canvas", target: ".of-canvasarea", placement: "center", when: "doc", title: "The canvas", body: "Scroll to pan, Ctrl+scroll to zoom, hold Space to drag. Right-click an object for a menu of what you can do with it." },
      { id: "panels", target: ".of-dock", placement: "left", when: "doc", title: "Panels", body: "Layers, color, history and more for the studio you are in. The tabs at the top of each area switch panels." },
      { id: "export", target: ".of-export-btn", placement: "bottom", title: "Export", body: "Save the page, a selection, slices or a whole website as PNG, JPEG, WebP, SVG, PDF and more." },
      { id: "vibe", target: ".of-studio[data-studio=\"vibe\"]", placement: "bottom", title: "Vibe Studio", body: "Describe what you want and the assistant builds it with the same tools you have. It is off until you turn on AI features and add your own connection; nothing is sent anywhere before that." },
      { id: "palette", target: ".of-menubar", placement: "bottom", title: "Find anything", body: "Press Ctrl+K (Cmd+K on macOS) or F1 to search every command. Shift+F1 turns on What's this?, then click anything to learn what it does." },
      { id: "settings", target: ".of-brand", placement: "bottom", title: "Make it yours", body: "Open the OpenFini menu, then Settings, for color themes, accent colors, density, accessibility options and more. You can repeat this tour from Help, Take the tour." },
    ],
  },
  vector: {
    title: "Vector studio",
    steps: [
      { id: "tools", target: ".of-toolbox", placement: "right", title: "Draw with shapes and paths", body: "Rectangle, ellipse, polygon and star make shapes. The Pen draws curves point by point; the Node tool reshapes them afterwards." },
      { id: "context", target: ".of-contextbar", placement: "bottom", title: "Options follow your selection", body: "This bar shows the options of the active tool or of what you selected: size, position, alignment and more." },
      { id: "canvas", target: ".of-canvasarea", placement: "center", title: "Everything stays sharp", body: "Vector artwork scales to any size. Drag to move, use the handles to resize and rotate, hold Shift to constrain." },
      { id: "panels", target: ".of-dock", placement: "left", title: "Appearance and layers", body: "Set fills, strokes, effects and text here. The Layers panel below lists every object; drag to reorder." },
    ],
  },
  pixel: {
    title: "Pixel studio",
    steps: [
      { id: "tools", target: ".of-toolbox", placement: "right", title: "Select, paint and retouch", body: "Selection tools, brush, eraser, clone and healing tools, dodge and burn. Press B for the brush; [ and ] change its size." },
      { id: "colors", target: ".of-chips", placement: "right", title: "Foreground and background", body: "Click a chip to choose a color. X swaps them, D resets to black and white." },
      { id: "panels", target: ".of-dock", placement: "left", title: "Adjust without destroying", body: "Adjustments are layers: change or remove them any time. The Brush panel tunes your paint tools." },
      { id: "layers", target: ".of-dock__area:last-child", placement: "left", title: "Layers, masks and history", body: "Add pixel layers and masks here. History lets you step back to any earlier state." },
    ],
  },
  layout: {
    title: "Layout studio",
    steps: [
      { id: "tools", target: ".of-toolbox", placement: "right", title: "Frames for text and pictures", body: "Text frames hold body copy and can be linked so text flows from one to the next. Image frames crop pictures without changing them." },
      { id: "canvas", target: ".of-canvasarea", placement: "center", title: "Pages", body: "Work on one or many pages. Rulers and guides help align things; hold Space to pan." },
      { id: "pages", target: ".of-dock", placement: "left", title: "Pages, layers and styles", body: "Master pages repeat on every page, and text styles update every place they are used." },
    ],
  },
  code: {
    title: "Code studio",
    steps: [
      { id: "side", target: ".of-codeside-host", placement: "right", title: "Your project", body: "Files, elements to drag into the page, the page outline and assets. Ctrl+P jumps to any file." },
      { id: "editor", target: ".of-split__code", placement: "right", title: "The code", body: "HTML, CSS and JavaScript with completion and problem checking. Switch between Design, Split and Code views in the toolbar." },
      { id: "preview", target: ".of-split__preview", placement: "left", title: "Live preview you can edit", body: "Click an element to select it, drag to move it, and edit its style in the panel at the right. Changes are written back to your code." },
      { id: "style", target: ".of-dock", placement: "left", title: "Style and settings", body: "CSS properties of the selected element, grouped by topic, plus its attributes." },
    ],
  },
  vibe: {
    title: "Vibe Studio",
    steps: [
      { id: "chat", target: ".of-vibe", placement: "center", title: "Describe it, then refine it", body: "Tell the assistant what to build or change. It works in your open document with the same tools you have, and every run can be undone." },
      { id: "side", target: ".of-vside__tabs", placement: "left", title: "Canvas and Activity", body: "Canvas shows the document live with its layers and what the AI touched; Activity lists every step with undo. Models, tools, skills and knowledge live in Settings ▸ Artificial intelligence." },
    ],
  },
};

/** Structural problems of a tour table (empty array = valid). */
export function validateTours(tours) {
  const errors = [];
  for (const [key, tour] of Object.entries(tours)) {
    if (!tour.title) errors.push(`${key}: missing title`);
    if (!Array.isArray(tour.steps) || !tour.steps.length) errors.push(`${key}: no steps`);
    const ids = new Set();
    for (const s of tour.steps || []) {
      const at = `${key}/${s.id}`;
      if (!s.id || ids.has(s.id)) errors.push(`${at}: id missing or duplicate`);
      ids.add(s.id);
      if (!s.title || s.title.length > 60) errors.push(`${at}: title missing or too long`);
      if (!s.body || s.body.length > 320) errors.push(`${at}: body missing or too long`);
      if (!s.target || typeof s.target !== "string") errors.push(`${at}: target selector missing`);
      if (!PLACEMENTS.includes(s.placement)) errors.push(`${at}: bad placement`);
      if (s.when && !["doc", "nodoc"].includes(s.when)) errors.push(`${at}: bad "when"`);
    }
  }
  return errors;
}
