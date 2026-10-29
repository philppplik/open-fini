// Manifest of the Whiteboard app (Office Suite kind "board", docs/office-board.md): plain data for the launcher, file
// routing and the Vibe prompt. The implementation (office/board/app.js) loads on first use.
export const BOARD_APP = {
  kind: "board",
  label: "Whiteboard",
  icon: "easel",
  blurb: "Sketches, sticky notes, diagrams and notebooks: Excalidraw, tldraw",
  order: 40,
  formats: [
    { id: "excalidraw", label: "Excalidraw drawing", ext: ["excalidraw"], mime: "application/vnd.excalidraw+json", read: true, write: true, lossy: true },
    { id: "tldraw", label: "tldraw drawing", ext: ["tldraw"], mime: "application/vnd.tldraw+json", read: true, write: true, lossy: true },
    { id: "png", label: "PNG image (current page)", ext: ["png"], mime: "image/png", write: true },
    { id: "svg", label: "SVG image (current page)", ext: ["svg"], mime: "image/svg+xml", write: true },
    { id: "pdf", label: "PDF (all pages)", ext: ["pdf"], mime: "application/pdf", write: true },
  ],
  templates: [
    { id: "blank", label: "Blank whiteboard", description: "An empty infinite canvas", icon: "easel", category: "Basic" },
    { id: "brainstorm", label: "Brainstorm", description: "A topic in the middle with sticky notes around it", icon: "lightbulb", category: "Business" },
    { id: "kanban", label: "Kanban board", description: "To do, doing and done columns with notes", icon: "layout-three-columns", category: "Business" },
    { id: "flowchart", label: "Flowchart", description: "Start, steps, a decision and connected arrows", icon: "diagram-3", category: "Business" },
    { id: "notebook", label: "Notebook", description: "Pages with lined and squared paper for handwriting", icon: "journal-text", category: "Personal" },
  ],
  aiNote: "The active Office document is a whiteboard (infinite canvas, pages, shapes, sticky notes, text, connectors, freehand ink). Read it with board_describe (element ids, positions, texts, connections) before editing; add content with board_add_shape, board_add_sticky, board_add_text and board_add_connector, change or remove elements with board_update and board_delete, tidy up with board_arrange. Coordinates are canvas pixels, y grows downward. Every call is one undoable step.",
  load: () => import("./app.js"),
};
