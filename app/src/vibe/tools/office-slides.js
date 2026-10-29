// Vibe tools of the Presentation app (Office Suite kind "slides", docs/office-slides.md ▸ Vibe). They work on the
// active deck and refuse other documents; every edit is one undoable step (commitOffice "Vibe: …"). Slides are
// addressed by 1-based number (as the user sees them) or by id; elements by placeholder role or id from
// slides_describe. Creating decks is office_new (kind "slides"), exporting is office_export.
import { tool, S } from "./helpers.js";
import { commitOffice } from "../../core/office.js";
import * as M from "../../office/slides/model.js";

const LAYOUT_IDS = M.LAYOUTS.map((l) => l.id);
const PH = ["title", "subtitle", "body", "body2"];

export function slidesTools(app, ctx = {}) {
  const deckDoc = () => {
    const d = app.doc;
    if (d?.office?.kind !== "slides") throw new Error("The active document is not a presentation. Create one with office_new (kind slides) or switch to one (office_list_documents).");
    if (d.office.model?.version !== M.SLIDES_VERSION || d.office.model._raw) d.office.model = M.normalizeDeck(d.office.model);
    return d;
  };
  const slideOf = (deck, ref) => {
    const s = typeof ref === "number" || /^\d+$/.test(String(ref ?? "")) ? deck.slides[Number(ref) - 1] : M.slideById(deck, String(ref ?? ""));
    if (!s) throw new Error(`There is no slide ${ref}; the deck has ${deck.slides.length} slides (numbered from 1).`);
    return s;
  };
  const commit = (doc, label, next) => {
    commitOffice(doc, `Vibe: ${label}`, next);
    app.officeUI?.refresh?.();
  };
  const num = (deck, id) => M.slideIndex(deck, id) + 1;
  const slideArg = S.str("Slide number (1-based) or slide id");
  const box = { x: S.num("Left in px (the slide is size.w × size.h, usually 960 × 540)"), y: S.num("Top in px"), w: S.num("Width in px"), h: S.num("Height in px") };

  return [
    tool("slides_describe", "Describes the active presentation: size, theme, and per slide its number, id, layout, title, elements (id, type, placeholder, box [x, y, w, h], text) and speaker notes. Call this before editing.", { slide: S.str("Only this slide (number or id); default all") }, [], ({ slide } = {}) => {
      const deck = deckDoc().office.model;
      const d = M.describeDeck(deck, { full: true });
      if (slide != null) d.slides = d.slides.filter((s) => s.id === slideOf(deck, slide).id);
      return { ...d, layouts: LAYOUT_IDS, themes: M.THEMES.map((t) => t.id) };
    }, { readOnly: true }),

    tool("slides_add_slide", "Adds a slide with a layout and optional placeholder texts. Body text: one bullet per line.", {
      layout: S.str("Layout", { enum: LAYOUT_IDS }),
      after: S.str("Insert after this slide (number or id); default at the end"),
      title: S.str("Title text"), subtitle: S.str("Subtitle text (title and section layouts)"), body: S.str("Body text; lines become bullets"), body2: S.str("Right column text (two-content layout)"),
    }, [], ({ layout = "title-content", after, title, subtitle, body, body2 } = {}) => {
      const doc = deckDoc();
      const deck = doc.office.model;
      const r = M.addSlide(deck, { layout, after: after != null ? slideOf(deck, after).id : null, text: { title, subtitle, body, body2 } });
      commit(doc, "Add Slide", r.deck);
      return { ok: true, slide: num(r.deck, r.id), id: r.id };
    }),

    tool("slides_delete", "Deletes slides from the active presentation (at least one slide always remains).", { slides: { type: "array", items: { type: "string" }, minItems: 1, description: "Slide numbers or ids" } }, ["slides"], ({ slides }) => {
      const doc = deckDoc();
      const deck = doc.office.model;
      const ids = slides.map((r) => slideOf(deck, r).id);
      commit(doc, "Delete Slides", M.deleteSlides(deck, ids));
      return { ok: true, deleted: ids.length, slideCount: doc.office.model.slides.length };
    }),

    tool("slides_set_text", "Sets the text of a placeholder (title, subtitle, body, body2) or of an element by id. Missing placeholders are added in the layout position.", {
      slide: slideArg, placeholder: S.str("Placeholder role", { enum: PH }), element: S.str("Element id from slides_describe (instead of placeholder)"), text: S.str("New text; \\n separates paragraphs"),
    }, ["slide", "text"], ({ slide, placeholder, element, text }) => {
      const doc = deckDoc();
      let deck = doc.office.model;
      const s = slideOf(deck, slide);
      let el = element ? s.elements.find((e) => e.id === element) : s.elements.find((e) => e.ph === (placeholder || "title"));
      if (element && !el) throw new Error(`Slide ${num(deck, s.id)} has no element ${element}.`);
      if (el && typeof el.text !== "string") throw new Error(`Element ${el.id} is a ${el.type} and has no text.`);
      if (!el) {
        const role = placeholder || "title";
        const proto = M.layoutElements(M.LAYOUTS.find((l) => l.ph.some((p) => p[0] === role))?.id || "title-content", deck.size).find((e) => e.ph === role) || { type: "text", x: 60, y: 60, w: 400, h: 80 };
        const r = M.addElement(deck, s.id, { ...proto, ph: role, text });
        commit(doc, "Set Text", r.deck);
        return { ok: true, element: r.id, added: true };
      }
      deck = M.updateElements(deck, s.id, [el.id], { text });
      commit(doc, "Set Text", deck);
      return { ok: true, element: el.id };
    }),

    tool("slides_add_shape", "Adds a shape or a text box to a slide. shape \"textbox\" makes a text box without outline.", {
      slide: slideArg, shape: S.str("Shape", { enum: ["textbox", ...M.SHAPES] }), ...box,
      fill: S.str("Fill color #rrggbb (none for transparent)"), stroke: S.str("Outline color #rrggbb"), text: S.str("Text inside"),
      size: S.num("Font size in points"), color: S.str("Text color #rrggbb"), bold: S.bool("Bold text"), align: S.str("Text alignment", { enum: ["left", "center", "right"] }), rotation: S.num("Rotation in degrees, clockwise"),
    }, ["slide", "shape"], (a) => {
      const doc = deckDoc();
      const deck = doc.office.model;
      const s = slideOf(deck, a.slide);
      const isText = a.shape === "textbox";
      const style = Object.fromEntries(Object.entries({ size: a.size, color: a.color, bold: a.bold, align: a.align ?? (isText ? undefined : "center"), valign: isText ? undefined : "middle" }).filter(([, v]) => v !== undefined));
      const r = M.addElement(deck, s.id, { type: isText ? "text" : "shape", shape: isText ? undefined : a.shape, x: a.x ?? deck.size.w / 2 - 100, y: a.y ?? deck.size.h / 2 - 60, w: a.w ?? 200, h: a.h ?? (a.shape === "line" ? 0 : 120), rot: a.rotation || 0, fill: a.fill === "none" ? null : a.fill ?? (isText ? null : deck.theme.accent), stroke: a.stroke ?? (isText ? null : undefined), text: a.text || "", style });
      commit(doc, isText ? "Add Text Box" : "Add Shape", r.deck);
      return { ok: true, element: r.id };
    }),

    tool("slides_add_image", "Adds a picture to a slide from a file attached in this chat (attachment name) or a data: URI (PNG, JPEG, GIF, SVG, WebP).", {
      slide: slideArg, attachment: S.str("Name of an attached image"), data_uri: S.str("data:image/...;base64,... image"), ...box,
    }, ["slide"], async (a) => {
      const doc = deckDoc();
      let bytes = null;
      let name = "image";
      if (a.attachment) {
        const f = (ctx.attachments?.() || []).find((x) => x.name === a.attachment) || (ctx.attachments?.() || []).find((x) => x.name.toLowerCase().includes(String(a.attachment).toLowerCase()));
        if (!f) throw new Error(`No attached file matches "${a.attachment}". Use list_attachments.`);
        bytes = new Uint8Array(await f.file.arrayBuffer());
        name = f.name;
      } else if (a.data_uri) {
        const m = /^data:[^;,]+;base64,(.+)$/s.exec(a.data_uri);
        if (!m) throw new Error("data_uri must be a base64 data: URI.");
        bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
      } else throw new Error("Pass attachment or data_uri.");
      const { sniffImage, imageSize } = await import("../../engine/office/media.js");
      const mime = sniffImage(bytes, name);
      if (!mime) throw new Error("That is not a PNG, JPEG, GIF, SVG or WebP image.");
      const deck = doc.office.model;
      const s = slideOf(deck, a.slide);
      const sz = imageSize(bytes, mime) || { w: 400, h: 300 };
      const fit = Math.min(1, (deck.size.w * 0.6) / (sz.w || 1), (deck.size.h * 0.6) / (sz.h || 1));
      const w = a.w ?? Math.round((sz.w || 400) * fit);
      const h = a.h ?? Math.round((sz.h || 300) * (a.w ? a.w / (sz.w || 1) : fit));
      const media = M.addMedia(deck, { bytes, mime, name, w: sz.w, h: sz.h });
      const r = M.addElement(media.deck, s.id, { type: "image", media: media.id, x: a.x ?? Math.round((deck.size.w - w) / 2), y: a.y ?? Math.round((deck.size.h - h) / 2), w, h });
      commit(doc, "Add Image", r.deck);
      return { ok: true, element: r.id };
    }),

    tool("slides_apply_layout", "Applies a layout to a slide: placeholders move to the layout's boxes and keep their text; other elements stay.", { slide: slideArg, layout: S.str("Layout", { enum: LAYOUT_IDS }) }, ["slide", "layout"], ({ slide, layout }) => {
      const doc = deckDoc();
      const deck = doc.office.model;
      commit(doc, "Apply Layout", M.applyLayout(deck, slideOf(deck, slide).id, layout));
      return { ok: true };
    }),

    tool("slides_apply_theme", "Applies a theme (background, text and accent colors, heading and body fonts) to the whole deck. Optional overrides change single colors or fonts.", {
      theme: S.str("Theme", { enum: M.THEMES.map((t) => t.id) }), bg: S.str("Background color #rrggbb"), text: S.str("Text color #rrggbb"), accent: S.str("Accent color #rrggbb"), heading: S.str("Heading font"), body: S.str("Body font"),
    }, ["theme"], ({ theme, ...over }) => {
      const doc = deckDoc();
      commit(doc, "Apply Theme", M.applyTheme(doc.office.model, theme, Object.fromEntries(Object.entries(over).filter(([, v]) => v))));
      return { ok: true, theme };
    }),

    tool("slides_reorder", "Moves a slide to a new position (1-based).", { slide: slideArg, to: S.num("New position, 1-based", { minimum: 1 }) }, ["slide", "to"], ({ slide, to }) => {
      const doc = deckDoc();
      const deck = doc.office.model;
      const s = slideOf(deck, slide);
      commit(doc, "Move Slide", M.moveSlides(deck, [s.id], Math.round(to) - 1));
      return { ok: true, slide: num(doc.office.model, s.id) };
    }),

    tool("slides_set_notes", "Sets the speaker notes of a slide (shown in presenter view).", { slide: slideArg, notes: S.str("Notes text") }, ["slide", "notes"], ({ slide, notes }) => {
      const doc = deckDoc();
      const deck = doc.office.model;
      commit(doc, "Speaker Notes", M.updateSlide(deck, slideOf(deck, slide).id, { notes }));
      return { ok: true };
    }),

    tool("slides_set_transition", "Sets the transition into a slide (none, fade or slide) and its duration.", { slide: slideArg, type: S.str("Transition", { enum: M.TRANSITIONS }), duration: S.num("Seconds (0.1 – 5)") }, ["slide", "type"], ({ slide, type, duration = 0.5 }) => {
      const doc = deckDoc();
      const deck = doc.office.model;
      commit(doc, "Transition", M.updateSlide(deck, slideOf(deck, slide).id, { transition: { type, duration } }));
      return { ok: true };
    }),
  ];
}
