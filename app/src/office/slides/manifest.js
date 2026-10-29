// Manifest of the Presentation app (Office Suite kind "slides"): plain data for the launcher, file routing and the
// Vibe prompt. The implementation (office/slides/app.js) loads on first use. Guide: docs/office-slides.md.
// Legacy .ppt is deliberately not listed: it keeps the "convert first" guidance dialog.
export const SLIDES_APP = {
  kind: "slides",
  label: "Presentation",
  icon: "easel",
  blurb: "Slide decks to present: PowerPoint, OpenDocument, PDF",
  order: 30,
  formats: [
    { id: "pptx", label: "PowerPoint presentation", ext: ["pptx", "ppsx"], mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", read: true, write: true, lossy: true },
    { id: "potx", label: "PowerPoint template", ext: ["potx"], read: true, template: true },
    { id: "odp", label: "OpenDocument presentation", ext: ["odp"], mime: "application/vnd.oasis.opendocument.presentation", read: true, write: true, lossy: true },
    { id: "fodp", label: "Flat OpenDocument presentation", ext: ["fodp"], read: true },
    { id: "otp", label: "OpenDocument presentation template", ext: ["otp"], read: true, template: true },
    { id: "pdf", label: "PDF", ext: ["pdf"], mime: "application/pdf", write: true },
    { id: "png", label: "PNG images (one per slide, zipped)", ext: ["zip"], mime: "application/zip", write: true },
  ],
  templates: [
    { id: "blank", label: "Blank presentation", description: "One title slide", icon: "easel", category: "Basic" },
    { id: "pitch", label: "Pitch deck", description: "Problem, solution, market, model, traction, team and the ask", icon: "lightbulb", category: "Business" },
    { id: "report", label: "Report", description: "Summary, results, highlights, a numbers table and next steps", icon: "bar-chart", category: "Business" },
  ],
  aiNote: "The active Office document is a presentation (slides with placeholders, text boxes, shapes, images and tables; speaker notes per slide). Read it with slides_describe before editing; use the slides_ tools (slides_add_slide, slides_set_text, slides_add_shape, slides_add_image, slides_apply_layout, slides_apply_theme, slides_reorder, slides_set_notes, slides_delete). Slides are numbered from 1. Every call is one undoable step.",
  load: () => import("./app.js"),
};
