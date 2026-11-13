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

    tool("board_add_table", "Adds a real table to the whiteboard (rows × columns of text; first row as a bold header by default). Returns its id. Watch out: one string per cell, at most 200 rows × 30 columns; long cell text is cut with … on the board, so keep cells short; a merged range shows the text of its top-left cell; change cells later with board_edit_table.", {
      rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Rows of cell texts, first row = header" },
      merges: { type: "array", items: { type: "string" }, description: "Merged cell ranges in A1 notation, e.g. [\"A1:C1\"]" },
      bold: { type: "array", items: { type: "string" }, description: "Cells in bold, e.g. [\"A5\", \"B5\"]" },
      header: S.bool("First row is a header (default true)"),
      x: S.num("Left edge"), y: S.num("Top edge"), w: S.num("Width (default 140 per column)"), h: S.num("Height (default 40 per row)"),
      fontSize: S.num("Font size (default 16)"), fill: S.str(`Header color (${COLORS})`), page: S.str("Page id (default: current page)"),
    }, ["rows", "x", "y"], async (a) => {
      const { M, page, commit, model } = await board(app);
      if (!Array.isArray(a.rows) || !a.rows.length) throw new Error("rows must be a non-empty array of rows.");
      const cols = Math.max(...a.rows.map((r) => (Array.isArray(r) ? r.length : 0)), 1);
      const el = M.makeElement("table", { page: page(a.page), x: a.x, y: a.y, w: a.w || cols * 140, h: a.h || a.rows.length * 40, rows: a.rows, header: a.header !== false, fontSize: a.fontSize, merges: a.merges, styles: Object.fromEntries((a.bold || []).map((k) => [k, { bold: true }])), ...(hex(a.fill) ? { fill: hex(a.fill) } : {}) });
      commit("Add Table", M.addElements(model(), [el]));
      return { ok: true, id: el.id, rows: el.rows.length, columns: el.rows[0].length, merges: el.merges || [] };
    }),

    tool("board_edit_table", "Edits a whiteboard table: set cells, replace all rows, add a row or column, merge or unmerge cells, set bold cells. Watch out: rows and columns are 0-based; merges and bold use A1 names (A1 = row 0, column 0); the table keeps its size, so resize with board_update (h) after adding rows.", {
      merges: { type: "array", items: { type: "string" }, description: "Replace the merged ranges, e.g. [\"A1:C1\"] ([] unmerges all)" },
      bold: { type: "array", items: { type: "string" }, description: "Replace the bold cells, e.g. [\"A5\"]" },
      id: S.str("Table element id"),
      cells: { type: "array", items: { type: "object", properties: { row: { type: "number" }, col: { type: "number" }, text: { type: "string" } }, required: ["row", "col", "text"] }, description: "Cells to set" },
      rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Replace every row" },
      addRow: S.bool("Append an empty row"), addColumn: S.bool("Append an empty column"),
    }, ["id"], async (a) => {
      const { M, commit, model } = await board(app);
      const el = model().elements[a.id];
      if (el?.type !== "table") throw new Error(`"${a.id}" is not a table. Call board_describe.`);
      let rows = a.rows || el.rows.map((r) => r.slice());
      for (const c of a.cells || []) {
        while (rows.length <= c.row) rows.push(rows[0].map(() => ""));
        while (rows[0].length <= c.col) rows = rows.map((r) => [...r, ""]);
        rows[c.row][c.col] = String(c.text);
      }
      if (a.addRow) rows.push(rows[0].map(() => ""));
      if (a.addColumn) rows = rows.map((r) => [...r, ""]);
      const h = a.addRow ? el.h + el.h / el.rows.length : el.h;
      const w = a.addColumn ? el.w + el.w / el.rows[0].length : el.w;
      const patch = { rows, w, h };
      if (Array.isArray(a.merges)) patch.merges = a.merges;
      if (Array.isArray(a.bold)) patch.styles = { ...Object.fromEntries(Object.entries(el.styles || {}).map(([k, s]) => [k, { ...s, bold: false }])), ...Object.fromEntries(a.bold.map((k) => [String(k).toUpperCase(), { ...(el.styles?.[String(k).toUpperCase()] || {}), bold: true }])) };
      commit("Edit Table", M.updateElements(model(), { [el.id]: patch }));
      const next = model().elements[el.id];
      return { ok: true, rows: rows.length, columns: rows[0].length, merges: next?.merges || [] };
    }),

    tool("board_add_chart", "Adds a chart (column, bar, line, area, pie, donut, scatter, radar …) to the whiteboard from data you give or from a range of an OPEN spreadsheet. Returns its id. Watch out: with data, categories and every series must have the same length; with a spreadsheet, the first row holds the series names and the first column the categories; the chart is a snapshot.", {
      type: S.str("Chart type", { enum: ["column", "stacked-column", "bar", "line", "area", "pie", "donut", "scatter", "radar"] }),
      title: S.str("Chart title"),
      categories: { type: "array", items: { type: "string" }, description: "Category labels (x axis or slices)" },
      series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } }, color: { type: "string" } }, required: ["values"] }, description: "Data series" },
      spreadsheet: S.str("Instead of data: name of an open spreadsheet"), range: S.str("A1 range in that spreadsheet"), sheet: S.str("Sheet name"),
      x: S.num("Left edge"), y: S.num("Top edge"), w: S.num("Width (default 480)"), h: S.num("Height (default 320)"), page: S.str("Page id"),
    }, ["x", "y"], async (a) => {
      const { M, page, commit, model } = await board(app);
      let chart;
      if (a.spreadsheet) chart = (await (await import("../../office/slides/sheet-link.js")).chartFromSheet(app, { spreadsheet: a.spreadsheet, sheet: a.sheet, range: a.range, type: a.type || "column", title: a.title || "" })).chart;
      else {
        if (!Array.isArray(a.series) || !a.series.length) throw new Error("Pass series (with values) and categories, or spreadsheet and range.");
        chart = { type: a.type || "column", title: a.title || "", data: { categories: a.categories || [], series: a.series } };
      }
      const el = M.makeElement("chart", { page: page(a.page), x: a.x, y: a.y, w: a.w || 480, h: a.h || 320, chart });
      commit("Add Chart", M.addElements(model(), [el]));
      return { ok: true, id: el.id, type: el.chart.type, categories: el.chart.data.categories.length, series: el.chart.data.series.map((s) => s.name) };
    }),

    tool("board_add_plot", "Adds a coordinate system to the whiteboard: axes with ticks and grid, graphs of functions y = f(x) (e.g. \"x^2 - 3x + 2\", \"sin(x)\", \"2x + 1\", \"1/x\", \"sqrt(x)\", \"e^(-x^2)\"), parametric curves (\"(cos(t), 2 sin(t))\", optional range \"(t, t^2) t = -2..2\"; t from 0 to 2pi by default), implicit curves (\"x^2 + y^2 = 9\", \"x = 3\"), labeled points and line segments, in math coordinates. Returns its id. Watch out: use * or implicit multiplication (2x; write x*y, not xy), ^ for powers and ln/log for logarithms; pick x/y ranges that show the interesting part (roots, vertex, intersections); verify points by computing them with calculate.", {
      functions: { type: "array", items: { type: "object", properties: { expr: { type: "string" }, color: { type: "string" }, label: { type: "string" } }, required: ["expr"] }, description: "Graphs y = f(x), parametric curves (x(t), y(t)) or implicit curves F(x, y) = 0" },
      points: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, label: { type: "string" }, color: { type: "string" } }, required: ["x", "y"] }, description: "Points to mark" },
      segments: { type: "array", items: { type: "object", properties: { from: { type: "array", items: { type: "number" } }, to: { type: "array", items: { type: "number" } }, color: { type: "string" } }, required: ["from", "to"] }, description: "Line segments (vectors, triangles, tangents)" },
      xMin: S.num("Smallest x (default -10)"), xMax: S.num("Largest x (default 10)"), yMin: S.num("Smallest y (default -10)"), yMax: S.num("Largest y (default 10)"),
      xLabel: S.str("x axis label"), yLabel: S.str("y axis label"), grid: S.bool("Grid lines (default true)"),
      x: S.num("Left edge on the board"), y: S.num("Top edge on the board"), w: S.num("Width (default 480)"), h: S.num("Height (default 360)"), page: S.str("Page id"),
    }, ["x", "y"], async (a) => {
      const { M, page, commit, model } = await board(app);
      const { parseCurve } = await import("../../office/board/objects.js");
      for (const f of a.functions || []) parseCurve(f.expr); // readable error before anything is added
      const el = M.makeElement("plot", { page: page(a.page), x: a.x, y: a.y, w: a.w || 480, h: a.h || 360, functions: a.functions, points: a.points, segments: a.segments, xMin: a.xMin, xMax: a.xMax, yMin: a.yMin, yMax: a.yMax, grid: a.grid, axisLabels: { x: a.xLabel ?? "x", y: a.yLabel ?? "y" } });
      commit("Add Graph", M.addElements(model(), [el]));
      return { ok: true, id: el.id, functions: el.functions.length, points: el.points.length, range: { x: [el.xMin, el.xMax], y: [el.yMin, el.yMax] } };
    }),

    tool("board_add_math", "Adds a typeset math formula to the whiteboard from TeX-like input: \\frac{a}{b}, \\sqrt{x}, x^{2}, x_{i}, Greek letters (\\alpha, \\pi …), \\sum, \\int, \\infty, \\le, \\ge, \\ne, \\approx, \\pm, \\cdot, \\to, stretched \\left( … \\right) delimiters and the environments matrix, pmatrix, bmatrix, Bmatrix, vmatrix, Vmatrix, cases and aligned (cells separated by &, rows by \\\\). Returns its id. Watch out: group with braces (x^{10}, not x^10); one formula per element.", {
      tex: S.str("Formula, e.g. x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"),
      x: S.num("Left edge"), y: S.num("Top edge"), fontSize: S.num("Size (default 28)"), color: S.str(`Color (${COLORS})`), page: S.str("Page id"),
    }, ["tex", "x", "y"], async (a) => {
      const { M, A, page, commit, model } = await board(app);
      const { mathSize } = await import("../../office/board/objects.js");
      const size = a.fontSize || 28;
      const box = mathSize(a.tex, size, (t, s, it) => A.measureText(t, s, "serif"));
      const el = M.makeElement("math", { page: page(a.page), x: a.x, y: a.y, w: box.w, h: box.h, tex: a.tex, fontSize: size, ...(hex(a.color) ? { stroke: hex(a.color) } : {}) });
      commit("Add Formula", M.addElements(model(), [el]));
      return { ok: true, id: el.id, w: el.w, h: el.h };
    }),

    tool("board_add_subboard", "Adds a sub-board: a new page with its own canvas plus a card on the current page that opens it on double-click (zoom into a topic, details of a step, one board per chapter). Returns the card id and the new page id; add content to that page by passing it as page to the other board_ tools. Watch out: the new page is not shown until the user opens the card or you call board_page goto.", {
      name: S.str("Name of the sub-board"), x: S.num("Card left edge"), y: S.num("Card top edge"), w: S.num("Card width (default 240)"), h: S.num("Card height (default 140)"),
      paper: S.str("Paper of the new page", { enum: ["plain", "dots", "grid", "lines"] }), page: S.str("Page id for the card (default: current page)"),
    }, ["name", "x", "y"], async (a) => {
      const { M, page, commit, model } = await board(app);
      const here = page(a.page);
      const r = M.addPage(model(), { name: a.name, paper: a.paper || "plain", after: here });
      const card = M.makeElement("portal", { page: here, x: a.x, y: a.y, w: a.w || 240, h: a.h || 140, target: r.page, name: a.name });
      commit("Add Sub-board", M.addElements(r.model, [card]));
      return { ok: true, id: card.id, page: r.page };
    }),

    tool("board_add_diagram", "Draws a complete diagram from structured items, laid out and connected: mindmap (title in the center, branches and their children around it), tree (org chart, decision tree, hierarchy), timeline (dated steps along a line), cycle (steps in a loop) or matrix (2 × 2 quadrants with notes). Returns the new ids. Watch out: keep item texts short (under 6 words); children are one level deeper (max 3 levels); use board_arrange or board_update afterward rather than re-creating the diagram.", {
      kind: S.str("Diagram kind", { enum: ["mindmap", "tree", "timeline", "cycle", "matrix"] }),
      title: S.str("Center topic, root or heading"),
      items: { type: "array", items: { type: "object", properties: { text: { type: "string" }, children: { type: "array", items: { type: "object", properties: { text: { type: "string" }, children: { type: "array", items: { type: "object" } } } } } }, required: ["text"] }, description: "Items with optional children" },
      x: S.num("Left edge (default 0)"), y: S.num("Top edge (default 0)"), style: S.str("hand-drawn (default) or clean", { enum: ["hand-drawn", "clean"] }), page: S.str("Page id"),
    }, ["kind", "items"], async (a) => {
      const { M, page, commit, model } = await board(app);
      const { buildDiagram } = await import("../../office/board/diagrams.js");
      const r = buildDiagram(a.kind, { title: a.title || "", items: a.items, page: page(a.page), at: [a.x || 0, a.y || 0], style: { rough: a.style === "clean" ? 0 : 1 } });
      commit("Add Diagram", M.addElements(model(), r.elements));
      return { ok: true, kind: a.kind, ids: r.elements.map((e) => e.id), ...r.ids };
    }),

    tool("board_draw", "Draws a free graphic from points: a polyline or closed polygon (straight or smoothed), for icons, outlines, arrows along a path, geometric figures or annotations. Returns its id. Watch out: points are absolute board coordinates [[x, y], …]; at least 2 points; use board_add_plot for anything in math coordinates.", {
      points: { type: "array", items: { type: "array", items: { type: "number" } }, description: "Points [[x, y], …]" },
      closed: S.bool("Close the shape (back to the first point)"), smooth: S.bool("Smooth curve through the points"),
      arrow: S.bool("Arrow head at the end"), stroke: S.str(`Line color (${COLORS})`), width: S.num("Line width (default 2)"), style: S.str("hand-drawn or clean (default)", { enum: ["hand-drawn", "clean"] }), page: S.str("Page id"),
    }, ["points"], async (a) => {
      const { M, page, commit, model } = await board(app);
      const pts = (a.points || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, 2000).map((p) => [p[0], p[1]]);
      if (pts.length < 2) throw new Error("Give at least two points [[x, y], …].");
      if (a.closed) pts.push(pts[0]);
      const el = M.makeElement(a.arrow ? "arrow" : "line", { page: page(a.page), points: pts, curve: !!a.smooth, width: a.width || 2, rough: a.style === "hand-drawn" ? 1 : 0, heads: { start: "none", end: a.arrow ? "arrow" : "none" }, ...(hex(a.stroke) ? { stroke: hex(a.stroke) } : {}) });
      commit("Draw", M.addElements(model(), [el]));
      return { ok: true, id: el.id };
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

    // comments (docs/office-board.md ▸ Comments): the document's comment threads with whiteboard anchors. Replies and
    // resolving use the general reply_comment and resolve_comment tools (same thread ids).
    tool("board_list_comments", "Lists the comment threads of the active whiteboard with what each points at: the element (id, type, text, bounds; the pin follows it when it moves) or a point on a page, plus status, author and messages. Reply with reply_comment, resolve with resolve_comment.", {
      status: S.str("Which threads (default open)", { enum: ["open", "resolved", "all"] }),
      page: S.str("Only threads on this page id"),
    }, [], async (a) => {
      const { doc, model } = await board(app);
      const c = (await import("../../ui/collab/comments-host.js")).getComments(app);
      const C = await import("../../office/board/comments.js");
      const threads = C.filterBoardThreads(c.threads(doc), { status: a.status || "open", page: a.page || null, model: model() });
      return {
        count: threads.length,
        threads: threads.slice(0, 100).map((th) => ({
          id: th.id,
          status: th.resolved ? "resolved" : "open",
          author: th.nick || "Unknown author",
          ...(th.ai ? { ai: true } : {}),
          createdAt: new Date(th.ts).toISOString(),
          target: C.describeBoardAnchor(th.anchor, model()) || { board: "document" },
          messages: th.messages.filter((m) => !m.deleted).slice(0, 20).map((m) => ({ id: m.id, author: m.nick || "Unknown author", text: m.text, at: new Date(m.ts).toISOString() })),
        })),
      };
    }, { readOnly: true }),

    tool("board_add_comment", "Adds a comment to the active whiteboard: on an element (element_id; the pin follows the element, optionally at x, y on it) or at a point of a page (x, y). Comments are saved in the document and shared with the room when the user is in one.", {
      text: S.str("The comment text (plain text; @Name mentions a room member)"),
      element_id: S.str("Element id from board_describe to attach the comment to"),
      x: S.num("Board x of the pin (default: the element's top right corner)"),
      y: S.num("Board y of the pin"),
      page: S.str("Page id for a point comment (default: the current page)"),
    }, ["text"], async (a) => {
      const { doc, model, page } = await board(app);
      const C = await import("../../office/board/comments.js");
      const el = a.element_id ? model().elements[a.element_id] : null;
      if (a.element_id && !el) throw new Error(`There is no element “${a.element_id}”. Call board_describe for the current ids.`);
      const pt = Number.isFinite(a.x) && Number.isFinite(a.y) ? { x: a.x, y: a.y } : null;
      if (!el && !pt) throw new Error("Give element_id, or x and y for a comment on the board.");
      const anchor = el ? C.elementAnchor(el, pt) : C.pointAnchor(page(a.page), pt);
      const c = (await import("../../ui/collab/comments-host.js")).getComments(app);
      const th = c.addThread(doc, anchor, a.text, { nick: "Vibe (AI)", color: "#7c6df2", ai: true });
      return { added: th.id, target: C.describeBoardAnchor(anchor, model()), shared: !!app.collab?.session && app.collab.session.state === "open" };
    }, { needsApproval: (a) => (app.collab?.session?.state === "open" ? `Add the comment “${String(a.text).slice(0, 80)}” (it is shared with the room)?` : false) }),
  ];
}
