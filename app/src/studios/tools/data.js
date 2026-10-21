// Layout-studio tools for data objects: the Table tool (draw a table, click cells, type, Tab / arrows, drag
// borders, copy / paste cells) and the Chart tool (draw a chart from a gallery preset).
import { Tool } from "../../core/tool.js";
import { h } from "../../core/util.js";
import { worldMatrix } from "../../core/nodes.js";
import { apply, rectFromPoints } from "../../core/math.js";
import { toLocal } from "../../core/transform.js";
import { pick } from "../../engine/hit.js";
import { addTableNode, addChartNode, isTable } from "../../core/data-nodes.js";
import * as A from "../../core/table-actions.js";
import { cellAt, cellRect, cellStyle } from "../../engine/layout/table-render.js";
import { originOf, matrixToDelimited, matrixToHtml, parseTextMatrix, parseHtmlTable } from "../../engine/layout/table-model.js";
import { PRESET_IDS, TABLE_PRESETS } from "../../engine/layout/table-styles.js";
import { CHART_PRESETS } from "../../engine/layout/chart-data.js";

const ACCENT = "#8b7cf6";
const isMod = (e) => e.ctrlKey || e.metaKey;

/** Screen-space corners of a local rectangle of a node. */
function screenPoly(app, node, r) {
  const W = worldMatrix(node);
  return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => {
    const [px, py] = apply(W, x, y);
    return app.pageToScreen(px, py, node._page);
  });
}

/** Reads a matrix from the system clipboard (HTML table first, then text). Resolves null when unavailable. */
export async function readClipboardMatrix() {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        if (it.types.includes("text/html")) {
          const m = parseHtmlTable(await (await it.getType("text/html")).text());
          if (m) return m;
        }
      }
    }
  } catch {
    /* permission denied: fall back to plain text */
  }
  try {
    const text = await navigator.clipboard?.readText?.();
    if (text && text.trim()) return parseTextMatrix(text, { delimiter: text.includes("\t") ? "\t" : "auto" });
  } catch {
    /* ignore */
  }
  return null;
}

export class TableTool extends Tool {
  static id = "table";
  static label = "Table";
  static icon = "table";
  static shortcut = "B";
  static studios = ["layout"];
  static options = [
    { key: "rows", label: "Rows", type: "int", min: 1, max: 60, default: 4 },
    { key: "cols", label: "Columns", type: "int", min: 1, max: 20, default: 3 },
    { key: "header", label: "Header row", type: "bool", default: true },
    { key: "style", label: "Style", type: "select", options: PRESET_IDS.map((id) => ({ value: id, label: TABLE_PRESETS[id].name })), default: "clean" },
  ];
  cursor = "crosshair";
  drag = null;
  edit = null;
  hoverEdge = null;

  activate() {
    this.refresh();
    this.off = this.app.on("selection", () => this.refresh());
    this.app.cv?.setCursor("crosshair");
  }
  deactivate() {
    this.off?.();
    this.#end(true);
    this.drag = null;
  }
  cancel() {
    if (this.drag?.kind === "col" || this.drag?.kind === "row") {
      const d = this.drag;
      for (const k of Object.keys(d.before)) d.node[k] = d.before[k];
      this.app.doc.touch(d.node);
      this.app.requestRender();
    }
    this.drag = null;
  }
  refresh() {
    const app = this.app;
    const sel = app.selection;
    const s = app.tableSel;
    if (sel.length === 1 && isTable(sel[0])) {
      const n = sel[0];
      if (!s || s.node !== n) A.setTableSel(app, n, 0, 0, n.rows.length - 1, n.cols.length - 1, true);
    } else if (s && !sel.includes(s.node)) {
      this.#end(true);
      A.setTableSel(app, null);
    }
    if (this.edit && (!this.edit.node._page || app.doc.find(this.edit.node.id) !== this.edit.node)) this.#end(false);
    app.requestOverlay();
  }

  // ------------------------------------------------------------------ hit helpers

  #tableAt(e) {
    const hit = pick(this.app.context, e.x, e.y, 6 / this.app.view.zoom, { deep: true });
    return hit && isTable(hit) ? hit : null;
  }

  #edgeAt(node, lx, ly) {
    const tl = node._tl;
    if (!tl) return null;
    const tol = 5 / this.app.view.zoom;
    if (lx < -tol || ly < -tol || lx > tl.w + tol || ly > tl.h + tol) return null;
    let best = null;
    tl.colX.forEach((x, i) => {
      if (i === 0) return;
      const d = Math.abs(lx - x);
      if (d <= tol && (!best || d < best.d)) best = { kind: "col", idx: i - 1, d };
    });
    if (best) return best;
    tl.rowY.forEach((y, i) => {
      if (i === 0) return;
      const d = Math.abs(ly - y);
      if (d <= tol && (!best || d < best.d)) best = { kind: "row", idx: i - 1, d };
    });
    return best;
  }

  hover(e) {
    const app = this.app;
    const node = this.#tableAt(e);
    let cursor = "crosshair";
    let edge = null;
    if (node) {
      const [lx, ly] = toLocal(node, e.x, e.y);
      edge = this.#edgeAt(node, lx, ly);
      cursor = edge ? (edge.kind === "col" ? "col-resize" : "row-resize") : "cell";
      if (edge) edge.node = node;
    }
    if (JSON.stringify(edge && [edge.node.id, edge.kind, edge.idx]) !== JSON.stringify(this.hoverEdge && [this.hoverEdge.node.id, this.hoverEdge.kind, this.hoverEdge.idx])) {
      this.hoverEdge = edge;
      app.requestOverlay();
    }
    this.cursor = cursor;
    app.cv?.setCursor(cursor);
  }

  // ------------------------------------------------------------------ pointer

  pointerDown(e) {
    const app = this.app;
    this.#commit();
    const node = this.#tableAt(e);
    if (!node) {
      A.setTableSel(app, null);
      this.drag = { kind: "create", x0: e.x, y0: e.y, x1: e.x, y1: e.y, sx: e.sx, sy: e.sy, moved: false, page: e.page };
      return;
    }
    if (!app.isSelected(node) || app.selection.length !== 1) app.select([node]);
    if (!node._tl) return;
    const [lx, ly] = toLocal(node, e.x, e.y);
    const edge = this.#edgeAt(node, lx, ly);
    if (edge && !node.locked) {
      const before = app.doc.snapshot(node, ["cols", "rows"]);
      this.drag = { kind: edge.kind, node, idx: edge.idx, start: edge.kind === "col" ? lx : ly, before, startSize: edge.kind === "col" ? node.cols[edge.idx] : node._tl.rowHeights[edge.idx], startNext: edge.kind === "col" ? node.cols[edge.idx + 1] : node.rows[edge.idx + 1], startRows: node._tl.rowHeights.slice() };
      return;
    }
    const cell = cellAt(node._tl, lx, ly, 1e9);
    const o = originOf(node, cell.r, cell.c);
    const s = app.tableSel;
    if (e.shift && s && s.node === node && !s.all) A.setTableSel(app, node, s.ar, s.ac, o.r, o.c);
    else A.setTableSel(app, node, o.r, o.c);
    this.drag = { kind: "select", node };
  }

  pointerMove(e) {
    const app = this.app;
    const d = this.drag;
    if (!d) return;
    if (d.kind === "create") {
      d.x1 = e.x;
      d.y1 = e.y;
      if (Math.hypot(e.sx - d.sx, e.sy - d.sy) > 4) d.moved = true;
      app.requestOverlay();
    } else if (d.kind === "select") {
      const [lx, ly] = toLocal(d.node, e.x, e.y);
      const cell = cellAt(d.node._tl, lx, ly, 1e9);
      const o = originOf(d.node, cell.r, cell.c);
      const s = app.tableSel;
      if (s && (s.fr !== o.r || s.fc !== o.c)) A.setTableSel(app, d.node, s.ar, s.ac, o.r, o.c);
    } else if (d.kind === "col" || d.kind === "row") {
      const [lx, ly] = toLocal(d.node, e.x, e.y);
      const delta = (d.kind === "col" ? lx : ly) - d.start;
      if (d.kind === "col") {
        let w = Math.max(14, d.startSize + delta);
        if (e.shift && d.idx + 1 < d.node.cols.length) {
          w = Math.min(w, d.startSize + d.startNext - 14);
          d.node.cols[d.idx + 1] = d.startNext - (w - d.startSize);
        }
        d.node.cols[d.idx] = w;
      } else {
        d.node.rows = d.startRows.slice();
        d.node.rows[d.idx] = Math.max(14, d.startSize + delta);
      }
      app.doc.touch(d.node);
      app.status(d.kind === "col" ? `Column width ${d.node.cols[d.idx].toFixed(1)}` : `Row height ${d.node.rows[d.idx].toFixed(1)}`);
      app.requestRender();
    }
  }

  pointerUp(e) {
    const app = this.app;
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === "col" || d.kind === "row") {
      app.doc.recordSet(d.node, d.before, d.kind === "col" ? "Resize Column" : "Resize Row");
      app.status("");
      app.requestRender();
    } else if (d.kind === "create") {
      const o = app.toolOptions("table");
      const page = d.page || app.page;
      const r = d.moved ? rectFromPoints(d.x0, d.y0, d.x1, d.y1) : { x: d.x0, y: d.y0, w: Math.min(480, page.w - 80), h: 0 };
      if (d.moved && (r.w < 20 || r.h < 14)) return;
      const rows = Math.round(o.rows) || 4;
      const node = addTableNode(app, { rows, cols: Math.round(o.cols) || 3, headerRows: o.header ? 1 : 0, style: o.style || "clean", x: r.x, y: r.y, width: r.w, rowHeight: d.moved ? Math.max(20, r.h / rows) : 34 });
      app.select([node]);
      A.setTableSel(app, node, o.header && rows > 1 ? 1 : 0, 0);
      app.requestRender();
      app.emit("revealpanel", "data");
    }
    app.requestOverlay();
  }

  doubleClick(e) {
    const node = this.#tableAt(e);
    if (!node || !node._tl) return;
    const [lx, ly] = toLocal(node, e.x, e.y);
    if (this.#edgeAt(node, lx, ly)) return;
    const cell = cellAt(node._tl, lx, ly, 1e9);
    const o = originOf(node, cell.r, cell.c);
    this.app.select([node]);
    A.setTableSel(this.app, node, o.r, o.c);
    this.#begin();
  }

  /** Starts editing the focused cell (used by the Move tool's double-click and the panel). */
  editCell(node, r, c) {
    this.app.select([node]);
    A.setTableSel(this.app, node, r, c);
    this.#begin();
  }

  // ------------------------------------------------------------------ keyboard

  keyDown(ev) {
    const app = this.app;
    const s = app.tableSel;
    if (!s || s.all || !A.activeTable(app)) return false;
    const node = s.node;
    const R = node.rows.length;
    const C = node.cols.length;
    const cl = (v, hi) => Math.max(0, Math.min(hi, v));
    const move = (dr, dc, extend) => {
      const fr = cl(s.fr + dr, R - 1);
      const fc = cl(s.fc + dc, C - 1);
      const o = originOf(node, fr, fc);
      if (extend) A.setTableSel(app, node, s.ar, s.ac, o.r, o.c);
      else A.setTableSel(app, node, o.r, o.c);
    };
    // step over merged cells in the direction of travel
    const span = (r, c) => {
      const o = originOf(node, r, c);
      const cell = node.cells[o.r][o.c];
      return { r: o.r, c: o.c, rs: cell.rs || 1, cs: cell.cs || 1 };
    };
    switch (ev.key) {
      case "ArrowLeft": move(0, -1, ev.shiftKey); return true;
      case "ArrowRight": {
        const sp = span(s.fr, s.fc);
        move(0, sp.c + sp.cs - s.fc, ev.shiftKey);
        return true;
      }
      case "ArrowUp": move(-1, 0, ev.shiftKey); return true;
      case "ArrowDown": {
        const sp = span(s.fr, s.fc);
        move(sp.r + sp.rs - s.fr, 0, ev.shiftKey);
        return true;
      }
      case "Tab": {
        if (ev.shiftKey) {
          if (s.fc > 0) move(0, -1);
          else if (s.fr > 0) A.setTableSel(app, node, s.fr - 1, C - 1);
        } else {
          const sp = span(s.fr, s.fc);
          if (sp.c + sp.cs < C) move(0, sp.c + sp.cs - s.fc);
          else if (s.fr + 1 < R) A.setTableSel(app, node, span(s.fr + 1, 0).r, 0);
          else {
            A.insertRow(app, true);
            A.setTableSel(app, node, R, 0);
          }
        }
        return true;
      }
      case "Enter":
      case "F2":
        this.#begin();
        return true;
      case "Delete":
      case "Backspace":
        A.clearSelection(app);
        return true;
      case "Escape":
        A.setTableSel(app, node, s.ar, s.ac, s.ar, s.ac, true);
        return true;
      default:
    }
    if (ev.key.length === 1 && !isMod(ev) && !ev.altKey) {
      this.#begin({ text: ev.key });
      return true;
    }
    return false;
  }

  deleteSelected() {
    const s = this.app.tableSel;
    if (!s || s.all || !A.activeTable(this.app)) return false;
    A.clearSelection(this.app);
    return true;
  }

  // ------------------------------------------------------------------ clipboard

  copy() {
    const app = this.app;
    const s = app.tableSel;
    if (!s || s.all || !A.activeTable(app)) return false;
    const m = A.selectionMatrix(app);
    app.cellClip = m;
    const text = matrixToDelimited(m, "\t");
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([matrixToHtml(m)], { type: "text/html" }) })]).catch(() => navigator.clipboard.writeText(text).catch(() => {}));
      } else navigator.clipboard?.writeText(text).catch(() => {});
    } catch {
      /* clipboard unavailable: the internal cell clipboard still works */
    }
    app.status(`Copied ${m.length} × ${m[0]?.length || 0} cells.`);
    return true;
  }
  cut() {
    if (!this.copy()) return false;
    A.clearSelection(this.app);
    return true;
  }
  paste() {
    const app = this.app;
    const s = app.tableSel;
    if (!s || s.all || !A.activeTable(app)) return false;
    (async () => {
      let m = await readClipboardMatrix();
      if (!m || (m.length === 1 && m[0].length === 1 && app.cellClip && app.cellClip.length > 1)) m = app.cellClip || m;
      if (!m) return app.toast("The clipboard has no table data. Copy cells from a spreadsheet or another table first.", "warning");
      A.pasteIntoSelection(app, m);
    })();
    return true;
  }

  // ------------------------------------------------------------------ cell editor

  #cellInfo() {
    const s = this.app.tableSel;
    if (!s || !A.activeTable(this.app)) return null;
    const node = s.node;
    const o = originOf(node, Math.min(s.fr, node.rows.length - 1), Math.min(s.fc, node.cols.length - 1));
    return { node, r: o.r, c: o.c };
  }

  #begin({ text } = {}) {
    this.#commit();
    const info = this.#cellInfo();
    if (!info || info.node.locked) return;
    const { node, r, c } = info;
    const app = this.app;
    const ta = h("textarea.of-celledit", { spellcheck: false, rows: 1, autocapitalize: "off", "aria-label": `Cell ${String.fromCharCode(65 + (c % 26))}${r + 1}`, tabIndex: -1 });
    app.cv.stage.append(ta);
    this.edit = { node, r, c, ta, before: app.doc.snapshot(node, ["cells"]) };
    ta.value = text ?? node.cells[r][c].v;
    ta.addEventListener("input", () => {
      node.cells[r][c].v = ta.value;
      app.doc.touch(node);
      app.requestRender();
      requestAnimationFrame(() => this.#place());
    });
    ta.addEventListener("keydown", (ev) => this.#editKey(ev));
    ta.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    this.#place();
    ta.focus({ preventScroll: true });
    if (text == null) ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  #editKey(ev) {
    const app = this.app;
    const e = this.edit;
    if (!e) return;
    const mod = isMod(ev);
    if (mod && !["a", "c", "v", "x", "z", "y"].includes(ev.key.toLowerCase())) {
      if (app.handleShortcut?.(ev)) ev.preventDefault();
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      this.#end(false);
    } else if (ev.key === "Enter" && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      this.#commit();
      const s = app.tableSel;
      if (s) {
        const sp = originOf(e.node, e.r, e.c);
        const rs = e.node.cells[sp.r][sp.c].rs || 1;
        if (e.r + rs < e.node.rows.length) A.setTableSel(app, e.node, e.r + rs, e.c);
      }
      app.cv?.stage?.focus?.({ preventScroll: true });
    } else if (ev.key === "Enter" && ev.altKey) {
      ev.preventDefault();
      const ta = ev.target;
      ta.setRangeText("\n", ta.selectionStart, ta.selectionEnd, "end");
      ta.dispatchEvent(new Event("input"));
    } else if (ev.key === "Tab") {
      ev.preventDefault();
      this.#commit();
      this.keyDown({ key: "Tab", shiftKey: ev.shiftKey, ctrlKey: false, metaKey: false, altKey: false });
    }
  }

  #place() {
    const e = this.edit;
    if (!e) return;
    const { node, r, c, ta } = e;
    if (!node._tl || !node._page) return;
    const rect = cellRect(node._tl, node, r, c);
    const W = worldMatrix(node);
    const at = (x, y) => {
      const [px, py] = apply(W, x, y);
      return this.app.pageToScreen(px, py, node._page);
    };
    const [sx, sy] = at(rect.x, rect.y);
    const [ax, ay] = at(rect.x + 1, rect.y);
    const [bx, by] = at(rect.x, rect.y + 1);
    const st = cellStyle(node, r, c);
    Object.assign(ta.style, {
      position: "absolute", left: "0", top: "0", margin: "0", transformOrigin: "0 0", boxSizing: "border-box", resize: "none", overflow: "hidden",
      width: `${rect.w}px`, height: `${rect.h}px`, transform: `matrix(${ax - sx}, ${ay - sy}, ${bx - sx}, ${by - sy}, ${sx}, ${sy})`,
      font: `${st.italic ? "italic " : ""}${st.weight} ${st.size}px ${st.family}, sans-serif`, lineHeight: String(st.lineHeight), color: st.color,
      padding: `${st.padY}px ${st.padX}px`, background: st.fill || "#ffffff", border: "0", outline: `${2 / this.app.view.zoom}px solid ${ACCENT}`, zIndex: "5",
      textAlign: st.align || "left",
    });
  }

  #commit() {
    const e = this.edit;
    if (!e) return;
    this.edit = null;
    e.ta.remove();
    const doc = this.app.doc;
    if (doc && doc.find(e.node.id) === e.node) {
      doc.recordSet(e.node, e.before, "Edit Cell");
      this.app.emit("tablesel");
    }
    this.app.requestRender();
  }

  #end(commit) {
    const e = this.edit;
    if (!e) return;
    if (commit) return this.#commit();
    this.edit = null;
    e.ta.remove();
    for (const k of Object.keys(e.before)) e.node[k] = JSON.parse(JSON.stringify(e.before[k]));
    this.app.doc?.touch(e.node);
    this.app.requestRender();
    this.app.requestOverlay();
  }

  // ------------------------------------------------------------------ overlay

  overlay(ctx) {
    const app = this.app;
    this.#place();
    const d = this.drag;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = "rgba(139,124,246,0.14)";
    ctx.lineWidth = 1;
    if (d?.kind === "create" && d.moved) {
      const [x0, y0] = app.pageToScreen(d.x0, d.y0, d.page);
      const [x1, y1] = app.pageToScreen(d.x1, d.y1, d.page);
      const o = app.toolOptions("table");
      const x = Math.min(x0, x1);
      const y = Math.min(y0, y1);
      const w = Math.abs(x1 - x0);
      const hh = Math.abs(y1 - y0);
      ctx.strokeRect(x + 0.5, y + 0.5, w, hh);
      ctx.beginPath();
      for (let i = 1; i < o.cols; i++) (ctx.moveTo(x + (w * i) / o.cols, y), ctx.lineTo(x + (w * i) / o.cols, y + hh));
      for (let i = 1; i < o.rows; i++) (ctx.moveTo(x, y + (hh * i) / o.rows), ctx.lineTo(x + w, y + (hh * i) / o.rows));
      ctx.setLineDash([3, 3]);
      ctx.stroke();
    }
    const s = app.tableSel;
    const node = s && A.activeTable(app);
    if (node && node._tl && node._page) {
      if (!s.all) {
        const r = A.selRect(app, node);
        const x0 = node._tl.colX[r.c0];
        const y0 = node._tl.rowY[r.r0];
        const poly = screenPoly(app, node, { x: x0, y: y0, w: node._tl.colX[r.c1 + 1] - x0, h: node._tl.rowY[r.r1 + 1] - y0 });
        ctx.beginPath();
        poly.forEach((p, i) => ctx[i ? "lineTo" : "moveTo"](p[0], p[1]));
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const he = this.hoverEdge;
      if (he && he.node === node) {
        const tl = node._tl;
        const r = he.kind === "col" ? { x: tl.colX[he.idx + 1] - 1, y: 0, w: 2, h: tl.h } : { x: 0, y: tl.rowY[he.idx + 1] - 1, w: tl.w, h: 2 };
        const poly = screenPoly(app, node, r);
        ctx.fillStyle = ACCENT;
        ctx.beginPath();
        poly.forEach((p, i) => ctx[i ? "lineTo" : "moveTo"](p[0], p[1]));
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

export class ChartTool extends Tool {
  static id = "chart";
  static label = "Chart";
  static icon = "bar-chart";
  static shortcut = "H";
  static studios = ["layout"];
  static options = [{ key: "preset", label: "Type", type: "select", options: CHART_PRESETS.map((p) => ({ value: p.id, label: p.name })), default: "column" }];
  cursor = "crosshair";
  drag = null;

  activate() {
    this.app.cv?.setCursor("crosshair");
  }
  cancel() {
    this.drag = null;
  }
  pointerDown(e) {
    this.drag = { x0: e.x, y0: e.y, x1: e.x, y1: e.y, sx: e.sx, sy: e.sy, moved: false, page: e.page };
  }
  pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    d.x1 = e.x;
    d.y1 = e.y;
    if (Math.hypot(e.sx - d.sx, e.sy - d.sy) > 4) d.moved = true;
    this.app.requestOverlay();
  }
  pointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const app = this.app;
    const preset = app.toolOptions("chart").preset || "column";
    let r = d.moved ? rectFromPoints(d.x0, d.y0, d.x1, d.y1) : null;
    if (r && (r.w < 40 || r.h < 24)) r = null;
    const node = addChartNode(app, { preset, ...(r ? { x: r.x, y: r.y, w: r.w, h: r.h } : { x: d.x0, y: d.y0 }) });
    app.setTool("move");
    app.select([node]);
    app.emit("revealpanel", "data");
    app.status("Chart inserted. Double-click it to edit its data.");
    app.requestOverlay();
  }
  overlay(ctx) {
    const d = this.drag;
    if (!d || !d.moved) return;
    const app = this.app;
    const [x0, y0] = app.pageToScreen(d.x0, d.y0, d.page);
    const [x1, y1] = app.pageToScreen(d.x1, d.y1, d.page);
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.restore();
  }
}

export const DATA_TOOLS = [TableTool, ChartTool];
