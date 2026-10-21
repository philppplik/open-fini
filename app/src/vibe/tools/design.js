// OpenFini tools for documents, layers and vector artwork (Vector and Layout studios; also useful in Pixel).
import { tool, S, toPaint, nodeInfo, nodesById, requireDoc, nodeText, countNodes } from "./helpers.js";
import { createNode, solid, defaultStroke } from "../../core/nodes.js";
import { mul, invert, translate, scale as scaleM, rotateAbout } from "../../core/math.js";
import { worldMatrix } from "../../core/nodes.js";
import { pageBounds, toLocal } from "../../core/transform.js";
import { addNodes } from "../../core/ops.js";
import * as ops from "../../core/ops.js";
import { addTextNode } from "../../core/text-ops.js";
import { applyCharFormat, applyParaFormat } from "../../studios/tools/text.js";
import { storyFromPlain } from "../../engine/layout/text-model.js";
import { svgDToPath, linePath } from "../../engine/vector/path.js";
import { placeSvg, exportRaster } from "../../core/io.js";
import { Doc } from "../../core/doc.js";

const STUDIOS = ["vector", "pixel", "layout", "code"];

/** Resolves the container for new nodes: a group id, or the active page root. */
function parentFor(app, parentId) {
  if (!parentId) return app.page.root;
  const [p] = nodesById(app, [parentId]);
  if (!p.children) throw new Error(`Layer “${parentId}” is not a group and cannot contain layers.`);
  return p;
}

/** Local matrix that puts a node's origin at page-space (x, y) inside `parent`. */
function placement(parent, x, y) {
  const [lx, ly] = toLocal(parent, x, y);
  return translate(lx, ly);
}

function shapeNode(type, a) {
  const common = {};
  if (a.name) common.name = a.name;
  if (a.opacity != null) common.opacity = a.opacity;
  if (type === "line") {
    const x1 = a.x2 ?? (a.x ?? 0) + (a.w ?? 100);
    const y1 = a.y2 ?? (a.y ?? 0) + (a.h ?? 0);
    const x0 = a.x ?? 0;
    const y0 = a.y ?? 0;
    return createNode("path", { ...common, name: a.name || "Line", path: linePath(x0 - Math.min(x0, x1), y0 - Math.min(y0, y1), x1 - Math.min(x0, x1), y1 - Math.min(y0, y1)), fill: null, stroke: defaultStroke(a.stroke ?? "#111111", a.strokeWidth ?? 2), _lineAt: [Math.min(x0, x1), Math.min(y0, y1)] });
  }
  const w = a.w ?? 100;
  const h = a.h ?? 100;
  const n = createNode(type, { ...common, w, h });
  if (type === "rect" && a.radius) n.r = [a.radius, a.radius, a.radius, a.radius];
  if (type === "polygon" && a.sides) n.sides = Math.max(3, Math.round(a.sides));
  if (type === "star" && a.points) n.points = Math.max(3, Math.round(a.points));
  return n;
}

export function designTools(app, ctx) {
  const T = [];

  T.push(
    tool("get_document_info", "Describes the open documents: active studio, pages and sizes, selection, layer count, whether a website project exists.", {}, [], () => {
      const doc = app.doc;
      return {
        studio: app.studio,
        openDocuments: app.docs.map((d) => ({ name: d.name, active: d === doc, pages: d.pages.length })),
        activeDocument: doc
          ? {
              name: doc.name,
              unit: doc.unit,
              dpi: doc.dpi,
              pages: doc.pages.map((p) => ({ id: p.id, name: p.name, width: Math.round(p.w), height: Math.round(p.h), background: p.bg || null, active: p === app.page })),
              layerCount: countNodes(app),
              selection: app.selection.map((n) => n.id),
              websiteProject: doc.web ? { files: doc.web.files.size, entry: doc.web.entry } : null,
            }
          : null,
      };
    }, { readOnly: true }),

    tool("new_document", "Creates a new document and opens it. Pixel documents start with an empty pixel layer; use studio 'code' for websites (then use create_website).", {
      name: S.str("Document name"),
      width: S.num("Width in px", { minimum: 1, maximum: 16000 }),
      height: S.num("Height in px", { minimum: 1, maximum: 16000 }),
      studio: S.str("Studio to start in", { enum: ["vector", "pixel", "layout"] }),
      background: S.str("Background color, or omit for transparent in pixel documents / white otherwise"),
    }, [], (a) => {
      const studio = a.studio || "vector";
      const doc = new Doc({ name: a.name || "Untitled", width: Math.round(a.width || 1080), height: Math.round(a.height || 1080), dpi: 96, studio, bg: a.background || (studio === "pixel" ? null : "#ffffff") });
      doc.history.clear();
      doc.saved = true;
      if (app.studio !== "vibe") app.setStudio(studio); // inside Vibe Studio the Canvas panel shows the result
      app.openDoc(doc);
      return { ok: true, name: doc.name, page: { id: doc.pages[0].id, width: Math.round(doc.pages[0].w), height: Math.round(doc.pages[0].h) } };
    }),

    tool("set_studio", "Switches the visible studio (vector, pixel, layout or code). Tools work in any studio, so this is only needed when the user asks to see a studio. Inside Vibe Studio it has no effect: the Canvas panel already shows the document live.", { studio: S.str("Studio", { enum: STUDIOS }) }, ["studio"], (a) => {
      if (app.studio === "vibe") return { studio: "vibe", note: "The user is in Vibe Studio; the Canvas panel shows the document live and offers buttons to open it in a studio. No switch was made." };
      app.setStudio(a.studio);
      return { studio: app.studio };
    }),

    tool("list_layers", "Lists the layers of a page as a tree with ids, types, names, page-space bounds, fills and text. Call this before editing existing artwork.", {
      pageId: S.str("Page id (default: active page)"),
      depth: S.num("How many group levels to expand (default 3)", { minimum: 0, maximum: 8 }),
    }, [], (a) => {
      const doc = requireDoc(app);
      const page = (a.pageId && doc.page(a.pageId)) || app.page;
      return { page: { id: page.id, name: page.name, width: Math.round(page.w), height: Math.round(page.h) }, layers: page.root.children.map((n) => nodeInfo(app, n, { maxDepth: a.depth ?? 3 })).reverse(), note: "Listed from front (top) to back." };
    }, { readOnly: true }),

    tool("get_selection", "Returns the layers the user currently has selected.", {}, [], () => ({ selection: app.selection.map((n) => nodeInfo(app, n, { maxDepth: 1 })) }), { readOnly: true }),

    tool("select_layers", "Selects layers by id so the user sees what you are working on.", { ids: S.ids() }, ["ids"], (a) => {
      app.select(nodesById(app, a.ids));
      return { selected: a.ids };
    }),

    tool("screenshot", "Renders the active page (or a region) to an image so you can check your work visually. Do this after significant edits.", {
      maxSize: S.num("Longest side in px (default 768, max 1600)", { minimum: 64, maximum: 1600 }),
      x: S.num("Region x"), y: S.num("Region y"), w: S.num("Region width"), h: S.num("Region height"),
    }, [], async (a) => {
      requireDoc(app);
      const page = app.page;
      const area = a.w && a.h ? { x: a.x ?? 0, y: a.y ?? 0, w: a.w, h: a.h } : { x: 0, y: 0, w: page.w, h: page.h };
      const max = a.maxSize || 768;
      const k = Math.min(1, max / Math.max(area.w, area.h));
      const r = await exportRaster(app, { page, format: "png", scale: k, area });
      let bin = "";
      for (let i = 0; i < r.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, r.bytes.subarray(i, i + 0x8000));
      return [{ type: "text", text: `Page “${page.name}” ${Math.round(area.w)}×${Math.round(area.h)} px, shown at ${r.width}×${r.height}.` }, { type: "image", mime: "image/png", data: btoa(bin) }];
    }, { readOnly: true }),

    tool("add_shape", "Adds a rectangle, ellipse, polygon, star or line at page coordinates (x, y = top-left). Returns the new layer id.", {
      type: S.str("Shape type", { enum: ["rect", "ellipse", "polygon", "star", "line"] }),
      x: S.num("Left in page px"), y: S.num("Top in page px"), w: S.num("Width (lines: horizontal extent)"), h: S.num("Height (lines: vertical extent)"),
      x2: S.num("Line end x"), y2: S.num("Line end y"),
      fill: S.color("Fill color or gradient; omit for the default"), stroke: S.str("Stroke color"), strokeWidth: S.num("Stroke width in px", { minimum: 0 }),
      radius: S.num("Corner radius for rect", { minimum: 0 }), sides: S.num("Polygon sides"), points: S.num("Star points"),
      opacity: S.num("0-1", { minimum: 0, maximum: 1 }), name: S.str("Layer name"), parentId: S.str("Group id to add into"),
    }, ["type"], (a) => {
      requireDoc(app);
      const parent = parentFor(app, a.parentId);
      const n = shapeNode(a.type, a);
      if (a.type !== "line") {
        if (a.fill !== undefined) n.fill = toPaint(a.fill);
        else n.fill = solid("#7c6df2");
        if (a.stroke) n.stroke = defaultStroke(a.stroke, a.strokeWidth ?? 2);
      }
      if (a.type === "line") n.m = placement(parent, n._lineAt[0], n._lineAt[1]);
      else n.m = placement(parent, a.x ?? 0, a.y ?? 0);
      delete n._lineAt;
      if (a.opacity != null) n.opacity = a.opacity;
      addNodes(app, n, { parent, label: "AI: Add shape" });
      return { id: n.id, type: n.type, name: n.name };
    }),

    tool("add_text", "Adds a text layer. Use for headlines, labels and body copy. Width makes it a wrapping text frame; omit width for a single-line label.", {
      text: S.str("The text (use \\n for new paragraphs)"),
      x: S.num("Left in page px"), y: S.num("Top in page px"), w: S.num("Frame width in px (wraps)", { minimum: 10 }),
      fontFamily: S.str("Font family, e.g. Inter, Georgia"), fontSize: S.num("Size in px", { minimum: 1 }), fontWeight: S.num("100-900", { minimum: 100, maximum: 900 }),
      color: S.color("Text color"), align: S.str("Alignment", { enum: ["left", "center", "right", "justify"] }), lineHeight: S.num("Line height multiple, e.g. 1.3"),
      name: S.str("Layer name"), parentId: S.str("Group id"),
    }, ["text"], (a) => {
      requireDoc(app);
      const parent = parentFor(app, a.parentId);
      const [lx, ly] = toLocal(parent, a.x ?? 0, a.y ?? 0);
      const node = addTextNode(app, {
        text: a.text, x: lx, y: ly, w: a.w ?? null, parent, label: "AI: Add text",
        defaults: { char: { ...(a.fontFamily && { fontFamily: a.fontFamily }), ...(a.fontSize && { fontSize: a.fontSize }), ...(a.fontWeight && { fontWeight: a.fontWeight }) }, para: { ...(a.align && { align: a.align }), ...(a.lineHeight && { lineHeight: a.lineHeight }) } },
        fill: a.color ? toPaint(a.color) : undefined,
      });
      if (a.name) app.doc.set(node, { name: a.name });
      return { id: node.id, name: node.name };
    }),

    tool("add_path", "Adds a vector path from SVG path data (M, L, C, Q, A, Z — absolute or relative). Coordinates are relative to (x, y).", {
      d: S.str("SVG path data, e.g. 'M0 0 L100 0 L50 80 Z'"), x: S.num("Offset x in page px"), y: S.num("Offset y in page px"),
      fill: S.color("Fill"), stroke: S.str("Stroke color"), strokeWidth: S.num("Stroke width"), name: S.str("Layer name"), parentId: S.str("Group id"),
    }, ["d"], (a) => {
      requireDoc(app);
      const parent = parentFor(app, a.parentId);
      const path = svgDToPath(a.d);
      if (!path.subpaths.length) throw new Error("The path data could not be parsed into any shape.");
      const n = createNode("path", { name: a.name || "Path", path, fill: a.fill === undefined ? solid("#7c6df2") : toPaint(a.fill), stroke: a.stroke ? defaultStroke(a.stroke, a.strokeWidth ?? 2) : null });
      n.m = placement(parent, a.x ?? 0, a.y ?? 0);
      addNodes(app, n, { parent, label: "AI: Add path" });
      return { id: n.id };
    }),

    tool("import_svg", "Imports complete SVG markup as an editable group — the best way to draw complex illustrations, icons and logos.", {
      svg: S.str("A complete <svg>…</svg> document"), x: S.num("Center x (page px)"), y: S.num("Center y (page px)"), name: S.str("Layer name"),
    }, ["svg"], (a) => {
      requireDoc(app);
      if (!/<svg[\s>]/i.test(a.svg)) throw new Error("The markup does not contain an <svg> element.");
      const g = placeSvg(app, a.svg, a.name || "SVG", { x: a.x, y: a.y });
      const sel = app.selection[0];
      return { id: (g?.id || sel?.id) ?? null, note: "Imported as a group; use list_layers to inspect it." };
    }),

    tool("set_style", "Changes appearance of layers: fill, stroke, opacity, blend mode, name, visibility, lock, corner radius, and for text: content, font, size, weight, color, alignment.", {
      ids: S.ids(),
      fill: S.color("Fill color or gradient (text: text color); 'none' removes it"), stroke: S.str("Stroke color or 'none'"), strokeWidth: S.num("Stroke width"),
      opacity: S.num("0-1", { minimum: 0, maximum: 1 }), blend: S.str("Blend mode", { enum: ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"] }),
      name: S.str("New layer name"), visible: S.bool("Show or hide"), locked: S.bool("Lock or unlock"), radius: S.num("Rect corner radius"), alt: S.str("Alt text (description for assistive technology and SVG export)"),
      text: S.str("New text content (text layers)"), fontFamily: S.str("Font family"), fontSize: S.num("Font size px"), fontWeight: S.num("100-900"), italic: S.bool("Italic"),
      align: S.str("Text alignment", { enum: ["left", "center", "right", "justify"] }), lineHeight: S.num("Line height multiple"), tracking: S.num("Letter spacing in 1/1000 em"),
    }, ["ids"], (a) => {
      const nodes = nodesById(app, a.ids);
      const doc = app.doc;
      doc.tx("AI: Style", () => {
        for (const n of nodes) {
          const patch = {};
          if (a.fill !== undefined && ("fill" in n || n.type === "text")) patch.fill = toPaint(a.fill);
          if ((a.stroke !== undefined || a.strokeWidth !== undefined) && "stroke" in n) {
            if (a.stroke === "none") patch.stroke = null;
            else patch.stroke = { ...(n.stroke || defaultStroke(a.stroke || "#000000", a.strokeWidth ?? 1)), ...(a.stroke ? { fill: toPaint(a.stroke) } : {}), ...(a.strokeWidth != null ? { width: a.strokeWidth } : {}) };
          }
          for (const k of ["opacity", "blend", "name", "visible", "locked", "alt"]) if (a[k] !== undefined) patch[k] = a[k];
          if (a.radius != null && n.type === "rect") patch.r = [a.radius, a.radius, a.radius, a.radius];
          if (Object.keys(patch).length) doc.set(n, patch, "AI: Style");
          if (n.type === "text") {
            if (a.text != null) {
              const d = doc.stories[n.storyId].defaults || {};
              doc.setStory(n.storyId, storyFromPlain(a.text, d.char, d.para), "AI: Edit text");
              doc.set(n, { name: a.text.slice(0, 24) });
            }
          }
        }
      });
      const textNodes = nodes.filter((n) => n.type === "text");
      if (textNodes.length) {
        app.select(textNodes);
        const char = {};
        for (const [k, v] of [["fontFamily", a.fontFamily], ["fontSize", a.fontSize], ["fontWeight", a.fontWeight], ["tracking", a.tracking]]) if (v != null) char[k] = v;
        if (a.italic != null) char.fontStyle = a.italic ? "italic" : "normal";
        if (a.fill !== undefined && typeof a.fill === "string") char.color = a.fill.startsWith("#") ? a.fill : undefined;
        if (Object.keys(char).length) applyCharFormat(app, char, "AI: Text format");
        const para = {};
        if (a.align) para.align = a.align;
        if (a.lineHeight) para.lineHeight = a.lineHeight;
        if (Object.keys(para).length) applyParaFormat(app, para, "AI: Paragraph format");
      }
      return { ok: true, updated: nodes.length };
    }),

    tool("transform_layers", "Moves, resizes or rotates layers in page coordinates. Give absolute x/y/w/h (top-left origin) and/or relative dx/dy, and rotation in degrees about the center.", {
      ids: S.ids(), x: S.num("New left"), y: S.num("New top"), w: S.num("New width", { minimum: 0.1 }), h: S.num("New height", { minimum: 0.1 }),
      dx: S.num("Move right by"), dy: S.num("Move down by"), rotate: S.num("Rotate by degrees (clockwise)"), scale: S.num("Uniform scale factor", { minimum: 0.01 }),
    }, ["ids"], (a) => {
      const nodes = nodesById(app, a.ids);
      const doc = app.doc;
      doc.tx("AI: Transform", () => {
        for (const n of nodes) {
          if (n.locked) continue;
          const b = pageBounds(n);
          if (!b || !b.w || !b.h) continue;
          let nw = a.w ?? b.w;
          let nh = a.h ?? b.h;
          if (a.scale) {
            nw = b.w * a.scale;
            nh = b.h * a.scale;
          }
          const nx = (a.x ?? b.x) + (a.dx ?? 0);
          const ny = (a.y ?? b.y) + (a.dy ?? 0);
          let D = mul(translate(nx, ny), mul(scaleM(nw / b.w, nh / b.h), translate(-b.x, -b.y)));
          if (a.rotate) D = mul(rotateAbout((a.rotate * Math.PI) / 180, nx + nw / 2, ny + nh / 2), D);
          const P = n._parent ? worldMatrix(n._parent) : [1, 0, 0, 1, 0, 0];
          const Pi = invert(P);
          if (!Pi) continue;
          doc.set(n, { m: mul(Pi, mul(D, mul(P, n.m))) }, "AI: Transform");
        }
      });
      return { ok: true, layers: nodes.map((n) => nodeInfo(app, n, { maxDepth: 0 })) };
    }),

    tool("group_layers", "Groups layers into a named group; returns the group id.", { ids: S.ids(), name: S.str("Group name") }, ["ids"], (a) => {
      app.select(nodesById(app, a.ids));
      const g = ops.groupSelection(app, { name: a.name });
      return { id: g?.id ?? null };
    }),
    tool("delete_layers", "Deletes layers (undoable).", { ids: S.ids() }, ["ids"], (a) => {
      app.select(nodesById(app, a.ids));
      ops.deleteSelection(app);
      return { deleted: a.ids.length };
    }, { needsApproval: (a) => (a.ids.length > 5 ? `Delete ${a.ids.length} layers?` : false) }),
    tool("duplicate_layers", "Duplicates layers, optionally offsetting the copies.", { ids: S.ids(), offset: S.num("Offset in px for the copies") }, ["ids"], (a) => {
      app.select(nodesById(app, a.ids));
      ops.duplicateSelection(app, { offset: a.offset ?? 0 });
      return { ids: app.selection.map((n) => n.id) };
    }),
    tool("reorder_layers", "Changes stacking order.", { ids: S.ids(), action: S.str("Where to move", { enum: ["front", "forward", "backward", "back"] }) }, ["ids", "action"], (a) => {
      app.select(nodesById(app, a.ids));
      ops.arrange(app, a.action);
      return { ok: true };
    }),
    tool("align_layers", "Aligns layers to each other or to the page.", {
      ids: S.ids(), mode: S.str("Alignment", { enum: ["left", "centerH", "right", "top", "centerV", "bottom"] }), toPage: S.bool("Align to the page instead of to each other"),
    }, ["ids", "mode"], (a) => {
      app.select(nodesById(app, a.ids));
      ops.align(app, a.mode, { toPage: !!a.toPage });
      return { ok: true };
    }),
    tool("boolean_layers", "Combines two or more shapes into one with a boolean operation.", { ids: S.ids(), op: S.str("Operation", { enum: ["union", "subtract", "intersect", "xor"] }) }, ["ids", "op"], (a) => {
      app.select(nodesById(app, a.ids));
      ops.booleanOp(app, a.op);
      return { ok: true, selection: app.selection.map((n) => n.id) };
    }),
    tool("add_page", "Adds a page after the active page (multi-page documents, layouts, slide decks).", { width: S.num("Width px"), height: S.num("Height px"), name: S.str("Page name") }, [], (a) => {
      const doc = requireDoc(app);
      const p = doc.addPage({ ...(a.width && { w: a.width }), ...(a.height && { h: a.height }), ...(a.name && { name: a.name }) }, doc.pages.indexOf(app.page) + 1);
      app.setActivePage(p);
      return { id: p.id, name: p.name };
    }),
    tool("undo", "Undoes the last edit in the document.", {}, [], () => ({ ok: !!app.doc?.undo() || true })),
    tool("redo", "Redoes the last undone edit.", {}, [], () => ({ ok: !!app.doc?.redo() || true })),
  );

  void nodeText;
  void ctx;
  return T;
}
