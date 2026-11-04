// Vibe tools of the Whiteboard app (Office Suite kind "board", docs/office-board.md ▸ Vibe). Static tools that check
// the active document's kind at run time; every change is one undoable commitOffice step ("Vibe: …"). The model and
// its pure operations live in office/board/model.js; the implementation is loaded on first use.
import { tool, S } from "./helpers.js";

const COLORS = "CSS hex color, e.g. #1e1e1e";
const ids = (d) => ({ type: "array", items: { type: "string" }, description: d, minItems: 1 });

async function board(app) {
  const doc = app.doc;
  if (doc?.office?.kind !== "board") throw new Error("The active document is not a whiteboard. Use office_new with kind \"board\" or switch to a whiteboard document first.");
  const [{ loadOfficeApp }, M, { commitOffice }] = await Promise.all([import("../../office/index.js"), import("../../office/board/model.js"), import("../../core/office.js")]);
  await loadOfficeApp("board");
  const A = await import("../../office/board/app.js");
  A.ensureBoard(doc.office);
  const ui = app.officeUI?.doc === doc && app.officeUI.kind === "board" ? app.officeUI : null;
  const page = (p) => (p && doc.office.model.pages.some((x) => x.id === p) ? p : ui?.page || doc.office.view.boardPage || M.sortedPages(doc.office.model)[0].id);
  const commit = (label, next) => {
    commitOffice(doc, `Vibe: ${label}`, next);
    return next;
  };
  return { doc, M, A, ui, page, commit, model: () => doc.office.model };
}

const hex = (c) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : undefined);
const style = (a) => {
  const o = {};
  if (hex(a.stroke)) o.stroke = hex(a.stroke);
  if (a.fill === "none") o.fill = null;
  else if (hex(a.fill)) o.fill = hex(a.fill);
  if (a.style === "clean") o.rough = 0;
  if (a.style === "hand-drawn") o.rough = 1;
  return o;
};

export function officeBoardTools(app) {
  return [
    tool("board_describe", "Describes the active whiteboard: pages, element counts and every element (id, type, page, x, y, w, h, text, connector from/to, group, frame), plus the current page and selection. Call it before editing.", {
      page: S.str("Only this page id (default: all pages)"),
      limit: S.num("Maximum number of elements to list (default 200)"),
    }, [], async ({ page, limit = 200 }) => {
      const { M, ui, model } = await board(app);
      return { ...M.describeBoard(model(), { page: page || null, limit: Math.max(1, Math.min(1000, limit)) }), currentPage: ui?.page || null, selection: ui?.selection || [] };
    }, { readOnly: true }),

    tool("board_add_shape", "Adds a rectangle, ellipse, diamond or frame (a named area that groups what is inside) to the whiteboard, optionally with a text label. Returns its id.", {
      shape: S.str("rect, ellipse, diamond or frame", { enum: ["rect", "ellipse", "diamond", "frame"] }),
      x: S.num("Left edge in canvas pixels"),
      y: S.num("Top edge in canvas pixels"),
      w: S.num("Width (default 180)"),
      h: S.num("Height (default 100)"),
      text: S.str("Label inside the shape, or the frame's name"),
      fill: S.str(`Fill color (${COLORS}) or "none"`),
      stroke: S.str(`Outline color (${COLORS})`),
      style: S.str("hand-drawn (default) or clean", { enum: ["hand-drawn", "clean"] }),
      page: S.str("Page id (default: the current page)"),
    }, ["shape", "x", "y"], async (a) => {
      const { M, page, commit, model } = await board(app);
      const props = { page: page(a.page), x: a.x, y: a.y, w: a.w || (a.shape === "frame" ? 480 : 180), h: a.h || (a.shape === "frame" ? 320 : 100), ...style(a) };
      if (a.shape === "frame") props.name = a.text || "Frame";
      else if (a.text) props.text = a.text;
      const el = M.makeElement(a.shape, props);
      let next = M.addElements(model(), [el]);
      next = a.shape === "frame" ? M.assignFrames(next, M.pageElements(next, el.page).map((e) => e.id)) : M.assignFrames(next, [el.id]);
      commit(a.shape === "frame" ? "Add Frame" : "Add Shape", next);
      return { ok: true, id: el.id };
    }),

    tool("board_add_sticky", "Adds a sticky note with text to the whiteboard. Returns its id.", {
      text: S.str("Text on the note"),
      x: S.num("Left edge in canvas pixels"),
      y: S.num("Top edge in canvas pixels"),
      color: S.str("Paper color: yellow, pink, green, blue, orange, violet or a hex color"),
      size: S.num("Edge length (default 200)"),
      page: S.str("Page id (default: the current page)"),
    }, ["text", "x", "y"], async (a) => {
      const { M, page, commit, model } = await board(app);
      const named = { yellow: 0, pink: 1, green: 2, blue: 3, orange: 4, violet: 5 };
      const fill = hex(a.color) || M.STICKY_COLORS[named[a.color] ?? 0];
      const el = M.makeElement("sticky", { page: page(a.page), x: a.x, y: a.y, w: a.size || 200, h: a.size || 200, text: a.text, fill });
      commit("Add Sticky Note", M.assignFrames(M.addElements(model(), [el]), [el.id]));
      return { ok: true, id: el.id };
    }),

    tool("board_add_text", "Adds free text to the whiteboard. Returns its id.", {
      text: S.str("The text (new lines allowed)"),
      x: S.num("Left edge in canvas pixels"),
      y: S.num("Top edge in canvas pixels"),
      fontSize: S.num("Font size in pixels (default 24)"),
      font: S.str("hand (handwritten, default), sans, serif or mono", { enum: ["hand", "sans", "serif", "mono"] }),
      color: S.str(`Text color (${COLORS})`),
      page: S.str("Page id (default: the current page)"),
    }, ["text", "x", "y"], async (a) => {
      const { M, A, page, commit, model } = await board(app);
      const fontSize = Math.max(6, Math.min(400, a.fontSize || 24));
      const font = a.font || "hand";
      const el = M.makeElement("text", { page: page(a.page), x: a.x, y: a.y, text: a.text, fontSize, font, stroke: hex(a.color) || "#1e1e1e", ...M.textBox(a.text, fontSize, (s, z) => A.measureText(s, z, font)) });
      commit("Add Text", M.assignFrames(M.addElements(model(), [el]), [el.id]));
      return { ok: true, id: el.id };
    }),

    tool("board_add_connector", "Connects two elements with an arrow or line that follows them when they move (from/to are element ids from board_describe), or draws a free arrow between two points. Returns its id.", {
      from: S.str("Start element id"),
      to: S.str("End element id"),
      kind: S.str("arrow (default) or line", { enum: ["arrow", "line"] }),
      label: S.str("Text on the connector"),
      x1: S.num("Start x when there is no start element"),
      y1: S.num("Start y when there is no start element"),
      x2: S.num("End x when there is no end element"),
      y2: S.num("End y when there is no end element"),
      stroke: S.str(`Line color (${COLORS})`),
    }, [], async (a) => {
      const { M, page, commit, model } = await board(app);
      const m = model();
      const s = a.from ? m.elements[a.from] : null;
      const e = a.to ? m.elements[a.to] : null;
      if (a.from && !s) throw new Error(`No element "${a.from}". Call board_describe for the ids.`);
      if (a.to && !e) throw new Error(`No element "${a.to}". Call board_describe for the ids.`);
      const p1 = s ? M.center(s) : [a.x1, a.y1];
      const p2 = e ? M.center(e) : [a.x2, a.y2];
      if (![...p1, ...p2].every(Number.isFinite)) throw new Error("Give from/to element ids or x1, y1, x2, y2.");
      const el = M.makeElement(a.kind || "arrow", { page: s?.page || e?.page || page(), points: [p1, p2], start: s ? { id: s.id } : null, end: e ? { id: e.id } : null, ...(a.label ? { text: a.label } : {}), ...style(a) });
      commit("Connect", M.addElements(m, [el]));
      return { ok: true, id: el.id };
    }),

    tool("board_update", "Changes elements of the whiteboard: text, colors, position, size, rotation, lock or hand-drawn style. Only the given properties change.", {
      ids: ids("Element ids from board_describe"),
      text: S.str("New text (labels, notes, text; the name of a frame)"),
      x: S.num("New left edge"),
      y: S.num("New top edge"),
      w: S.num("New width"),
      h: S.num("New height"),
      angle: S.num("Rotation in degrees"),
      fill: S.str(`Fill color (${COLORS}) or "none"`),
      stroke: S.str(`Stroke or text color (${COLORS})`),
      style: S.str("hand-drawn or clean", { enum: ["hand-drawn", "clean"] }),
      locked: S.bool("Lock (true) or unlock (false)"),
    }, ["ids"], async (a) => {
      const { M, A, commit, model } = await board(app);
      const m = model();
      const missing = a.ids.filter((id) => !m.elements[id]);
      if (missing.length) throw new Error(`Unknown element ids: ${missing.join(", ")}. Call board_describe.`);
      const patches = {};
      for (const id of a.ids) {
        const el = m.elements[id];
        let p = { ...style(a) };
        if (typeof a.text === "string") Object.assign(p, el.type === "frame" ? { name: a.text } : { text: a.text });
        if (el.type === "text" && typeof a.text === "string") Object.assign(p, M.textBox(a.text, el.fontSize, (s, z) => A.measureText(s, z, el.font)));
        if (typeof a.locked === "boolean") p.locked = a.locked;
        if (Number.isFinite(a.angle)) p.angle = (a.angle * Math.PI) / 180;
        if ([a.x, a.y, a.w, a.h].some(Number.isFinite)) p = { ...p, ...M.resizeElement(el, { x: a.x ?? el.x, y: a.y ?? el.y, w: a.w ?? el.w, h: a.h ?? el.h }), ...p };
        if (el.type === "sticky" && "fill" in p && !p.fill) delete p.fill;
        patches[id] = p;
      }
      commit("Update", M.updateElements(m, patches));
      return { ok: true, updated: a.ids.length };
    }),

    tool("board_delete", "Deletes elements from the whiteboard (connectors to them stay where they are).", { ids: ids("Element ids from board_describe") }, ["ids"], async ({ ids: list }) => {
      const { M, commit, model } = await board(app);
      const n = list.filter((id) => model().elements[id]).length;
      commit("Delete", M.removeElements(model(), list));
      return { ok: true, deleted: n };
    }),

    tool("board_arrange", "Tidies up whiteboard elements: layout grid, row, column or flow (a flowchart along the connectors), align (left, center, right, top, middle, bottom), distribute (horizontal, vertical), group or ungroup, or z-order (front, back).", {
      ids: { type: "array", items: { type: "string" }, description: "Element ids (default: every shape, note and text on the current page)" },
      layout: S.str("grid, row, column or flow", { enum: ["grid", "row", "column", "flow"] }),
      align: S.str("left, center, right, top, middle or bottom", { enum: ["left", "center", "right", "top", "middle", "bottom"] }),
      distribute: S.str("horizontal or vertical", { enum: ["horizontal", "vertical"] }),
      group: S.bool("true groups the elements, false ungroups them"),
      order: S.str("front or back", { enum: ["front", "back"] }),
      gap: S.num("Space between elements for layouts (default 40)"),
    }, [], async (a) => {
      const { M, page, commit, model } = await board(app);
      let m = model();
      const list = a.ids?.length ? a.ids.filter((id) => m.elements[id]) : M.pageElements(m, page()).filter((e) => !M.LINEAR.includes(e.type) && !M.INK.includes(e.type) && e.type !== "frame").map((e) => e.id);
      if (!list.length) throw new Error("No elements to arrange.");
      if (a.layout) m = M.arrangeElements(m, list, { layout: a.layout, gap: a.gap ?? 40 });
      if (a.align) m = M.alignElements(m, list, a.align);
      if (a.distribute) m = M.distributeElements(m, list, a.distribute);
      if (a.group === true) m = M.groupElements(m, list);
      if (a.group === false) m = M.ungroupElements(m, list);
      if (a.order) m = M.reorderElements(m, list, a.order);
      commit("Arrange", m);
      return { ok: true, arranged: list.length };
    }),

    tool("board_page", "Manages whiteboard pages (notebook style): add, rename, delete, go to, or set the paper (plain, dots, grid, lines).", {
      action: S.str("add, rename, delete, goto or paper", { enum: ["add", "rename", "delete", "goto", "paper"] }),
      page: S.str("Page id (default: the current page)"),
      name: S.str("Name for add / rename"),
      paper: S.str("plain, dots, grid or lines", { enum: ["plain", "dots", "grid", "lines"] }),
    }, ["action"], async (a) => {
      const { M, ui, page, commit, model, doc } = await board(app);
      const id = page(a.page);
      if (a.action === "add") {
        const r = M.addPage(model(), { name: a.name, paper: a.paper, after: id });
        commit("Add Page", r.model);
        if (ui) ui.gotoPage(r.page);
        else doc.office.view.boardPage = r.page;
        return { ok: true, page: r.page };
      }
      if (a.action === "rename") commit("Rename Page", M.updatePage(model(), id, { name: String(a.name || "Page").slice(0, 120) }));
      else if (a.action === "delete") {
        if (model().pages.length < 2) throw new Error("A whiteboard keeps at least one page.");
        commit("Delete Page", M.removePage(model(), id));
      } else if (a.action === "paper") commit("Page Paper", M.updatePage(model(), id, { paper: a.paper || "plain" }));
      else if (ui) ui.gotoPage(id);
      else doc.office.view.boardPage = id;
      return { ok: true, page: id };
    }),

    tool("board_import", "Adds the content of an Excalidraw (.excalidraw JSON) or tldraw (.tldraw JSON) drawing to the current whiteboard page. To open such a file as its own document use open_attachment.", {
      format: S.str("excalidraw or tldraw", { enum: ["excalidraw", "tldraw"] }),
      json: S.str("The file content (JSON text)"),
      x: S.num("Left edge for the imported content (default: keeps its coordinates)"),
      y: S.num("Top edge for the imported content"),
    }, ["format", "json"], async (a) => {
      const { M, page, commit, model } = await board(app);
      const F = await import("../../office/board/formats.js");
      const src = a.format === "tldraw" ? F.readTldraw(F.parseJson(new TextEncoder().encode(a.json))) : F.readExcalidraw(F.parseJson(new TextEncoder().encode(a.json)));
      const els = Object.values(src.elements).sort(M.byZ);
      const box = M.unionBounds(els) || { x: 0, y: 0 };
      const dx = Number.isFinite(a.x) ? a.x - box.x : 0;
      const dy = Number.isFinite(a.y) ? a.y - box.y : 0;
      const p = page();
      const m = model();
      const next = M.addElements({ ...m, media: { ...m.media, ...src.media } }, els.map((e) => ({ ...e, page: p, z: "", x: e.x + dx, y: e.y + dy })));
      commit("Import Drawing", next);
      return { ok: true, added: els.length };
    }),

    tool("board_export", "Returns the whiteboard as Excalidraw or tldraw JSON, or the current page as SVG text (to inspect or hand to another tool; office_export saves files).", {
      format: S.str("excalidraw, tldraw or svg", { enum: ["excalidraw", "tldraw", "svg"] }),
    }, ["format"], async ({ format }) => {
      const { A, doc } = await board(app);
      const out = await A.default.save(doc.office.model, format, { title: doc.name, doc });
      const text = new TextDecoder().decode(out.bytes);
      return { format, notes: out.notes || [], length: text.length, content: text.length > 120000 ? `${text.slice(0, 120000)}…` : text };
    }, { readOnly: true }),
  ];
}
