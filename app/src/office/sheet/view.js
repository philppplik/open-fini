// Spreadsheet app UI (Office Suite ▸ Spreadsheet, docs/office-sheet.md): ribbon, formula bar, a canvas grid with
// virtualized rows/columns (toolkit/virtual.js axes, so a million rows cost nothing), frozen panes, headers,
// selection, in-cell editor, fill handle, column/row resizing, charts drawn into the grid, filter buttons and sheet
// tabs. Every model change goes through commitOffice (one undo step each). The instance returned by mountSheet is
// `app.officeUI` while the document is active; commands (commands/office-sheet.js) call its methods.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { commitOffice } from "../../core/office.js";
import { officeItemAnchor } from "../../collab/anchors.js";
import { ribbon, button, formulaBar, colorPicker, fontControls, numberFormatMenu, zoomControl, officeContextMenu } from "../toolkit/ui.js";
import { createAxis } from "../toolkit/virtual.js";
import { colName, parseRange, formatRange, normRange, parseRef } from "../toolkit/selection.js";
import { toDelimited, parseDelimited, rowsToHtml } from "../toolkit/clipboard.js";
import { fmtToCode } from "./numfmt-code.js";
import * as M from "./model.js";
import { rcKey, keyRC, compareValues, MAX_ROWS, MAX_COLS } from "./formula.js";
import { cellLook, cfStatsFor, chartItems, FONT } from "./render.js";
import { calcFor } from "./app.js";

const HH = 22; // column header height
const CLIP_MIME = "application/x-openfini-sheet";
let cssLoaded = false;
let commandsReady = null;

function loadCss() {
  if (cssLoaded || typeof document === "undefined") return;
  cssLoaded = true;
  document.head.append(h("link", { rel: "stylesheet", href: new URL("styles/office-sheet.css", document.baseURI).href }));
}

export async function mountSheet(host, doc, app) {
  loadCss();
  commandsReady ||= import("../../commands/office-sheet.js").then((m) => m.registerSheetCommands(app));
  await commandsReady;
  return new SheetView(host, doc, app);
}

let clipboard = null; // { text, block, from, sid, cut, range }

export class SheetView {
  constructor(host, doc, app) {
    this.kind = "sheet";
    this.doc = doc;
    this.app = app;
    this.sid = doc.office.model.active;
    this.sel = { r: 0, c: 0 };
    this.anchor = { r: 0, c: 0 };
    this.range = { r0: 0, c0: 0, r1: 0, c1: 0 };
    this.zoom = 1;
    this.chartSel = null;
    this.editing = null;
    this.charts = new Map();
    this.version = 0;
    this.build(host);
    this.off = doc.office.on("change", (info) => this.onModel(info));
    this.onModel({});
  }

  // ---------------------------------------------------------------------------------------------------- model

  get model() {
    return this.doc.office.model;
  }
  get sheet() {
    return M.sheetById(this.model, this.sid) || M.activeSheet(this.model);
  }
  get calc() {
    return calcFor(this.doc);
  }

  commit(label, next, opts = {}) {
    if (!next || next === this.model) return;
    const sel = { sid: this.sid, r: this.sel.r, c: this.sel.c };
    commitOffice(this.doc, t(label), next, { sel, selBefore: sel, ...opts });
  }

  onModel(info) {
    this.version++;
    if (!M.sheetById(this.model, this.sid)) this.sid = this.model.active;
    if (info?.sel?.sid && (info.origin === "undo" || info.origin === "redo") && M.sheetById(this.model, info.sel.sid)) {
      this.sid = info.sel.sid;
      this.select(info.sel.r, info.sel.c, false, false);
    }
    calcFor(this.doc); // bring the engine up to date
    this.layout();
    this.renderTabs();
    this.syncBar();
    this.paint();
    this.app.emit("officestatus");
  }

  /** Axes for the current sheet (sizes, hidden and filtered rows). */
  layout() {
    const s = this.sheet;
    const ext = M.extentOf(s);
    const rowCount = Math.min(MAX_ROWS, Math.max(this.rowsWanted || 0, 1000, ext.rows + 200, this.sel.r + 50));
    const colCount = Math.min(MAX_COLS, Math.max(this.colsWanted || 0, 26, ext.cols + 10, this.sel.c + 10));
    const sizes = { ...s.rows };
    this.hidden = M.filteredRows(s, (r, c) => cellLook(s, this.calc, r, c).text);
    for (const r of this.hidden) sizes[r] = 0;
    this.rows = createAxis({ count: rowCount, size: M.DEFAULT_ROW, sizes });
    this.cols = createAxis({ count: colCount, size: M.DEFAULT_COL, sizes: s.cols });
    this.HW = Math.max(40, 12 + String(rowCount).length * 8);
    this.fr = Math.min(s.freeze?.r || 0, rowCount - 1);
    this.fc = Math.min(s.freeze?.c || 0, colCount - 1);
    this.sizer.style.width = `${(this.HW + this.cols.total) * this.zoom}px`;
    this.sizer.style.height = `${(HH + this.rows.total) * this.zoom}px`;
  }

  // ---------------------------------------------------------------------------------------------------- DOM

  build(host) {
    const doCmd = (id) => () => this.app.run(id);
    const fmt = (patch) => () => this.setStyle(patch);
    this.fonts = fontControls({ onFamily: (font) => this.setStyle({ font }), onSize: (size) => this.setStyle({ size }) });
    this.textColor = colorPicker({ label: "Text color", value: "#000000", onPick: (color) => this.setStyle({ color }) });
    this.fillColor = colorPicker({ label: "Fill color", value: null, allowNone: true, onPick: (fill) => this.setStyle({ fill }) });
    this.zoomCtl = zoomControl({ value: 1, min: 0.5, max: 3, onChange: (z) => this.setZoom(z) });
    const toggles = {
      b: button({ text: "B", label: "Bold", onClick: () => this.toggle("b"), toggle: true, shortcut: "Ctrl+B" }),
      i: button({ icon: "type-italic", label: "Italic", onClick: () => this.toggle("i"), toggle: true, shortcut: "Ctrl+I" }),
      u: button({ icon: "type-underline", label: "Underline", onClick: () => this.toggle("u"), toggle: true, shortcut: "Ctrl+U" }),
      st: button({ icon: "type-strikethrough", label: "Strikethrough", onClick: () => this.toggle("st"), toggle: true }),
    };
    this.toggles = toggles;
    toggles.b.style.fontWeight = "700";
    this.ribbon = ribbon([
      { id: "clipboard", label: "Clipboard", items: [button({ icon: "scissors", label: "Cut", onClick: doCmd("sheet.cut") }), button({ icon: "files", label: "Copy", onClick: doCmd("sheet.copy") }), button({ icon: "clipboard", label: "Paste", onClick: doCmd("sheet.paste") })] },
      { id: "font", label: "Font", items: [this.fonts.el, toggles.b, toggles.i, toggles.u, toggles.st, this.textColor.el, this.fillColor.el, button({ icon: "border", label: "Borders", onClick: doCmd("sheet.bordersAll") })] },
      { id: "align", label: "Alignment", items: [button({ icon: "text-left", label: "Align left", onClick: fmt({ ha: "left" }) }), button({ icon: "text-center", label: "Center", onClick: fmt({ ha: "center" }) }), button({ icon: "text-right", label: "Align right", onClick: fmt({ ha: "right" }) }), button({ icon: "text-wrap", label: "Wrap text", onClick: () => this.toggle("wrap") }), button({ icon: "arrows-angle-contract", label: "Merge cells", onClick: doCmd("sheet.merge") })] },
      { id: "number", label: "Number", items: [numberFormatMenu({ onPick: (f) => this.setStyle({ nf: f.type === "general" ? null : fmtToCode(f) }) }), button({ icon: "percent", label: "Percent", onClick: fmt({ nf: "0%" }) }), button({ icon: "currency-dollar", label: "Currency", onClick: fmt({ nf: '"$"#,##0.00' }) }), button({ text: ".0", label: "More decimals", onClick: () => this.decimals(1) }), button({ text: ".00→.0", label: "Fewer decimals", onClick: () => this.decimals(-1) })] },
      { id: "cells", label: "Cells", items: [button({ icon: "plus-square", label: "Insert row above", onClick: doCmd("sheet.insertRowAbove") }), button({ icon: "trash", label: "Delete rows", onClick: doCmd("sheet.deleteRows") }), button({ icon: "plus-square-dotted", label: "Insert column left", onClick: doCmd("sheet.insertColLeft") }), button({ icon: "trash3", label: "Delete columns", onClick: doCmd("sheet.deleteCols") })] },
      { id: "data", label: "Data", items: [button({ icon: "arrow-down-up", label: "Sort ascending", onClick: doCmd("sheet.sortAsc") }), button({ icon: "filter", label: "Filter", onClick: doCmd("sheet.filter") }), button({ icon: "pin-angle", label: "Freeze panes", onClick: doCmd("sheet.freeze") }), button({ icon: "hash", label: "Insert function", onClick: () => this.insertFunction() })] },
      { id: "insert", label: "Insert", items: [button({ icon: "bar-chart", label: "Insert chart", onClick: doCmd("sheet.insertChart") }), button({ icon: "droplet-half", label: "Conditional formatting", onClick: doCmd("sheet.conditional") })] },
      { id: "zoom", label: "Zoom", items: [this.zoomCtl.el] },
    ]);
    this.bar = formulaBar({ onCommit: (text, { move }) => this.commitInput(text, move), onRefCommit: (ref) => this.goTo(ref) });
    this.canvas = h("canvas.of-sheet__canvas", { "aria-hidden": "true" });
    this.sizer = h("div.of-sheet__sizer");
    this.scroller = h("div.of-sheet__scroller", { tabindex: "0", role: "grid", "aria-label": t("Spreadsheet grid"), "aria-roledescription": t("spreadsheet") }, this.sizer);
    this.editor = h("textarea.of-sheet__editor", { spellcheck: "false", "aria-label": t("Cell editor"), rows: "1" });
    this.live = h("div.of-sheet__live", { "aria-live": "polite", role: "status" });
    this.gridEl = h("div.of-sheet__grid", this.canvas, this.scroller, this.editor, this.live);
    this.tabs = h("div.of-sheet__tabs", { role: "tablist", "aria-label": t("Sheets") });
    this.el = h("div.of-sheet", this.ribbon, this.bar.el, this.gridEl, this.tabs);
    host.replaceChildren(this.el);
    this.bindEvents();
    this.ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.paint()) : null;
    this.ro?.observe(this.gridEl);
  }

  renderTabs() {
    const add = h("button.of-sheet__tab-add", { type: "button", "aria-label": t("Add sheet"), title: t("Add sheet") }, h("sl-icon", { name: "plus-lg" }));
    add.addEventListener("click", () => this.addSheet());
    const tabs = this.model.sheets.map((s, i) => {
      const b = h("button.of-sheet__tab", { type: "button", role: "tab", "aria-selected": String(s.id === this.sid), draggable: "true", title: t("Double-click to rename") }, s.name);
      b.addEventListener("click", () => this.showSheet(s.id));
      b.addEventListener("dblclick", () => this.renameSheet(s.id));
      b.addEventListener("contextmenu", (e) => (this.showSheet(s.id), officeContextMenu(this.app, e, "office-sheet", { doc: this.doc, view: this, tab: true })));
      b.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/x-sheet", s.id));
      b.addEventListener("dragover", (e) => e.preventDefault());
      b.addEventListener("drop", (e) => {
        const id = e.dataTransfer?.getData("text/x-sheet");
        if (id && id !== s.id) this.commit("Move Sheet", M.moveSheet(this.model, id, i));
      });
      return b;
    });
    this.tabs.replaceChildren(add, ...tabs);
  }

  // ---------------------------------------------------------------------------------------------------- geometry

  get vw() {
    return this.gridEl.clientWidth / this.zoom;
  }
  get vh() {
    return this.gridEl.clientHeight / this.zoom;
  }
  get sx() {
    return this.scroller.scrollLeft / this.zoom;
  }
  get sy() {
    return this.scroller.scrollTop / this.zoom;
  }
  colX(c) {
    const fw = this.cols.offsetOf(this.fc);
    return c < this.fc ? this.HW + this.cols.offsetOf(c) : this.HW + fw + this.cols.offsetOf(c) - fw - this.sx;
  }
  rowY(r) {
    const fh = this.rows.offsetOf(this.fr);
    return r < this.fr ? HH + this.rows.offsetOf(r) : HH + fh + this.rows.offsetOf(r) - fh - this.sy;
  }
  colAt(x) {
    const fw = this.cols.offsetOf(this.fc);
    const px = x - this.HW;
    return px < fw ? this.cols.indexAt(px) : this.cols.indexAt(px + this.sx);
  }
  rowAt(y) {
    const fh = this.rows.offsetOf(this.fr);
    const py = y - HH;
    return py < fh ? this.rows.indexAt(py) : this.rows.indexAt(py + this.sy);
  }
  /** Visible index ranges: frozen part [0, f) and the scrolled part from `start`. */
  visible(axis, f, scroll, view, header) {
    const fsize = axis.offsetOf(f);
    const start = axis.indexAt(fsize + scroll);
    const end = Math.min(axis.count, axis.indexAt(fsize + scroll + Math.max(0, view - header - fsize)) + 1);
    return { frozen: [0, f], scroll: [Math.max(f, start), end] };
  }
  cellRect(r, c) {
    const g = M.mergeAt(this.sheet, r, c);
    const r0 = g ? g.r0 : r;
    const c0 = g ? g.c0 : c;
    const r1 = g ? g.r1 : r;
    const c1 = g ? g.c1 : c;
    return { x: this.colX(c0), y: this.rowY(r0), w: this.cols.offsetOf(c1 + 1) - this.cols.offsetOf(c0), h: this.rows.offsetOf(r1 + 1) - this.rows.offsetOf(r0) };
  }
  chartRect(ch) {
    return { x: this.colX(ch.c), y: this.rowY(ch.r), w: ch.w, h: ch.h };
  }

  // ---------------------------------------------------------------------------------------------------- painting

  paint() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      try {
        this.draw();
      } catch (err) {
        console.error(err);
      }
    });
  }

  draw() {
    const cv = this.canvas;
    const W = this.gridEl.clientWidth;
    const H = this.gridEl.clientHeight;
    if (!W || !H) return;
    const dpr = globalThis.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
    }
    const ctx = cv.getContext("2d");
    const z = this.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
    const css = getComputedStyle(this.el);
    const C = {
      bg: css.getPropertyValue("--of-sheet-bg").trim() || "#ffffff",
      grid: css.getPropertyValue("--of-sheet-grid").trim() || "#e2e3e6",
      head: css.getPropertyValue("--of-sheet-head").trim() || "#f3f4f6",
      headText: css.getPropertyValue("--of-sheet-head-text").trim() || "#4b5563",
      text: css.getPropertyValue("--of-sheet-text").trim() || "#111827",
      accent: css.getPropertyValue("--of-accent").trim() || "#2563eb",
    };
    const vw = W / z;
    const vh = H / z;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, vw, vh);
    const s = this.sheet;
    const calc = this.calc;
    const stats = cfStatsFor(s, calc);
    const R = this.visible(this.rows, this.fr, this.sy, vh, HH);
    const Cc = this.visible(this.cols, this.fc, this.sx, vw, this.HW);
    const fw = this.cols.offsetOf(this.fc);
    const fh = this.rows.offsetOf(this.fr);
    const quads = [
      [R.frozen, Cc.frozen, this.HW, HH, fw, fh],
      [R.frozen, Cc.scroll, this.HW + fw, HH, vw, fh],
      [R.scroll, Cc.frozen, this.HW, HH + fh, fw, vh],
      [R.scroll, Cc.scroll, this.HW + fw, HH + fh, vw, vh],
    ];
    for (const [[ra, rb], [ca, cb], x0, y0, w0, h0] of quads) {
      if (ra >= rb || ca >= cb) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, w0 === vw ? vw - x0 : w0, h0 === vh ? vh - y0 : h0);
      ctx.clip();
      this.drawCells(ctx, s, calc, stats, ra, rb, ca, cb, C);
      this.drawCharts(ctx, s, calc);
      this.drawSelection(ctx, C);
      ctx.restore();
    }
    // freeze lines
    ctx.fillStyle = "#9aa3ae";
    if (this.fr) ctx.fillRect(0, HH + fh - 1, vw, 1.5);
    if (this.fc) ctx.fillRect(this.HW + fw - 1, 0, 1.5, vh);
    this.drawHeaders(ctx, R, Cc, C, vw, vh);
    this.placeEditor();
  }

  drawCells(ctx, s, calc, stats, ra, rb, ca, cb, C) {
    const merges = s.merges.map(parseRange).filter(Boolean);
    const covered = (r, c) => merges.find((g) => r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1);
    const cols = [];
    for (let c = ca; c < cb; c++) if (this.cols.sizeOf(c)) cols.push(c);
    // fills and grid lines
    ctx.lineWidth = 1;
    for (let r = ra; r < rb; r++) {
      const rh = this.rows.sizeOf(r);
      if (!rh) continue;
      const y = this.rowY(r);
      for (const c of cols) {
        const mg = merges.length ? covered(r, c) : null;
        if (mg && !(r === Math.max(ra, mg.r0) && c === Math.max(ca, mg.c0))) continue; // drawn once, from its first visible cell
        const rc = mg ? { r: mg.r0, c: mg.c0 } : { r, c };
        const box = mg ? this.cellRect(rc.r, rc.c) : { x: this.colX(c), y, w: this.cols.sizeOf(c), h: rh };
        const look = cellLook(s, calc, rc.r, rc.c, stats);
        if (look.fill) {
          ctx.fillStyle = look.fill;
          ctx.fillRect(box.x, box.y, box.w, box.h);
        }
        ctx.strokeStyle = C.grid;
        ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
        if (look.fill) {
          ctx.fillStyle = look.fill;
          ctx.fillRect(box.x + 1, box.y + 1, box.w - 1, box.h - 1);
        }
        const bd = look.style?.bd;
        if (bd) {
          const line = (col, x, y2, w, hh) => ((ctx.fillStyle = col), ctx.fillRect(x, y2, w, hh));
          if (bd.t) line(bd.t, box.x, box.y, box.w + 1, 1);
          if (bd.b) line(bd.b, box.x, box.y + box.h, box.w + 1, 1);
          if (bd.l) line(bd.l, box.x, box.y, 1, box.h + 1);
          if (bd.r) line(bd.r, box.x + box.w, box.y, 1, box.h + 1);
        }
        if (look.text) this.drawText(ctx, s, look, rc.r, rc.c, box, C, cb);
      }
    }
    // filter buttons
    if (s.filter) {
      const g = parseRange(s.filter.range);
      if (g && g.r0 >= ra && g.r0 < rb) {
        for (let c = Math.max(g.c0, ca); c <= Math.min(g.c1, cb - 1); c++) {
          const x = this.colX(c) + this.cols.sizeOf(c) - 16;
          const y = this.rowY(g.r0) + this.rows.sizeOf(g.r0) - 17;
          const on = s.filter.hide?.[c - g.c0]?.length;
          ctx.fillStyle = on ? C.accent : "#ffffff";
          ctx.strokeStyle = "#8b93a0";
          ctx.fillRect(x, y, 14, 14);
          ctx.strokeRect(x + 0.5, y + 0.5, 13, 13);
          ctx.fillStyle = on ? "#ffffff" : "#4b5563";
          ctx.beginPath();
          ctx.moveTo(x + 3.5, y + 5);
          ctx.lineTo(x + 10.5, y + 5);
          ctx.lineTo(x + 7, y + 10);
          ctx.fill();
        }
      }
    }
  }

  drawText(ctx, s, look, r, c, box, C, cb) {
    const st = look.style || {};
    const size = ((st.size || 11) * 96) / 72;
    ctx.font = `${st.i ? "italic " : ""}${st.b ? "700 " : ""}${size}px ${st.font ? `"${st.font}", ` : ""}${FONT}`;
    ctx.fillStyle = look.color || C.text;
    let room = box.w - 6;
    let text = look.text;
    let tw = ctx.measureText(text).width;
    if (look.align === "left" && !st.wrap && tw > room) {
      for (let k = c + 1; k < Math.min(cb + 20, c + 30) && tw > room; k++) {
        const n = s.cells[rcKey(r, k)];
        if (n?.v !== undefined || n?.f !== undefined) break;
        room += this.cols.sizeOf(k);
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x + 1, box.y, Math.max(box.w, room + 6) - 2, box.h);
    ctx.clip();
    if (st.wrap) {
      const lines = [];
      let cur = "";
      for (const word of String(text).split(/(\s+)/)) {
        if (ctx.measureText(cur + word).width > room && cur.trim()) {
          lines.push(cur.trim());
          cur = word.trimStart();
        } else cur += word;
      }
      if (cur.trim()) lines.push(cur.trim());
      const lh = size * 1.2;
      let y = st.va === "top" ? box.y + size + 2 : st.va === "middle" ? box.y + (box.h - lh * lines.length) / 2 + size : box.y + box.h - 5 - lh * (lines.length - 1);
      for (const ln of lines) {
        const w = ctx.measureText(ln).width;
        ctx.fillText(ln, look.align === "right" ? box.x + box.w - 3 - w : look.align === "center" ? box.x + (box.w - w) / 2 : box.x + 3, y);
        y += lh;
      }
    } else {
      if (typeof look.value === "number" && !look.error && tw > room) {
        text = "#".repeat(Math.max(1, Math.floor(room / ctx.measureText("#").width)));
        tw = ctx.measureText(text).width;
      }
      const x = look.align === "right" ? box.x + box.w - 3 - tw : look.align === "center" ? box.x + (box.w - tw) / 2 : box.x + 3;
      const y = st.va === "top" ? box.y + size + 2 : st.va === "middle" ? box.y + box.h / 2 + size * 0.35 : box.y + box.h - 5;
      ctx.fillText(text, x, y);
      if (st.u || st.st) {
        ctx.fillRect(x, st.u ? y + 2 : y - size * 0.3, tw, 1);
        if (st.u && st.st) ctx.fillRect(x, y - size * 0.3, tw, 1);
      }
    }
    ctx.restore();
  }

  drawCharts(ctx, s, calc) {
    for (const ch of s.charts) {
      const b = this.chartRect(ch);
      if (b.x > this.vw || b.y > this.vh || b.x + b.w < 0 || b.y + b.h < 0) continue;
      const img = this.chartImage(s, ch, calc);
      if (img) ctx.drawImage(img, b.x, b.y, ch.w, ch.h);
      if (this.chartSel === ch.id) {
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = "#2563eb";
        ctx.fillRect(b.x + b.w - 6, b.y + b.h - 6, 10, 10);
        ctx.lineWidth = 1;
      }
    }
  }

  chartImage(s, ch, calc) {
    const key = `${this.version}|${JSON.stringify(ch)}|${this.zoom}`;
    const hit = this.charts.get(ch.id);
    if (hit?.key === key) return hit.canvas;
    if (!this.chartLib) {
      this.chartLib = Promise.all([import("../../core/fonts.js"), import("../../engine/backends/canvas.js")]).then(([f, c]) => {
        this.chartLib = { measurer: f.measurer, renderToCanvas: c.renderToCanvas };
        this.paint();
      });
      return hit?.canvas || null;
    }
    if (this.chartLib instanceof Promise) return hit?.canvas || null;
    try {
      const items = chartItems(this.model, s, ch, calc, this.chartLib.measurer, 0, 0);
      const scale = (globalThis.devicePixelRatio || 1) * this.zoom;
      const canvas = this.chartLib.renderToCanvas({ width: ch.w, height: ch.h, items }, { scale, width: Math.round(ch.w * scale), height: Math.round(ch.h * scale), bg: "#ffffff" });
      this.charts.set(ch.id, { key, canvas });
      return canvas;
    } catch {
      return null;
    }
  }

  drawSelection(ctx, C) {
    const g = this.range;
    const x0 = this.colX(g.c0);
    const y0 = this.rowY(g.r0);
    const x1 = this.colX(g.c1) + this.cols.sizeOf(g.c1);
    const y1 = this.rowY(g.r1) + this.rows.sizeOf(g.r1);
    const multi = g.r0 !== g.r1 || g.c0 !== g.c1;
    if (multi) {
      ctx.fillStyle = "rgba(37, 99, 235, 0.10)";
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    const a = this.cellRect(this.sel.r, this.sel.c);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(multi ? x0 : a.x, multi ? y0 : a.y, multi ? x1 - x0 : a.w, multi ? y1 - y0 : a.h);
    if (multi) {
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x + 1.5, a.y + 1.5, a.w - 3, a.h - 3);
    }
    ctx.lineWidth = 1;
    // fill handle
    const hx = multi ? x1 : a.x + a.w;
    const hy = multi ? y1 : a.y + a.h;
    ctx.fillStyle = C.accent;
    ctx.fillRect(hx - 3, hy - 3, 6, 6);
    if (this.fillPreview) {
      const p = this.fillPreview;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(this.colX(p.c0), this.rowY(p.r0), this.colX(p.c1) + this.cols.sizeOf(p.c1) - this.colX(p.c0), this.rowY(p.r1) + this.rows.sizeOf(p.r1) - this.rowY(p.r0));
      ctx.setLineDash([]);
    }
    if (clipboard?.sid === this.sid && clipboard.range && clipboard.doc === this.doc) {
      const p = clipboard.range;
      ctx.setLineDash([5, 3]);
      ctx.strokeStyle = C.accent;
      ctx.strokeRect(this.colX(p.c0) + 1, this.rowY(p.r0) + 1, this.colX(p.c1) + this.cols.sizeOf(p.c1) - this.colX(p.c0) - 2, this.rowY(p.r1) + this.rows.sizeOf(p.r1) - this.rowY(p.r0) - 2);
      ctx.setLineDash([]);
    }
  }

  drawHeaders(ctx, R, Cc, C, vw, vh) {
    const g = this.range;
    ctx.font = `12px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillStyle = C.head;
    ctx.fillRect(0, 0, vw, HH);
    ctx.fillRect(0, 0, this.HW, vh);
    const fw = this.cols.offsetOf(this.fc);
    const fh = this.rows.offsetOf(this.fr);
    for (const [[a, b], clipX] of [[Cc.frozen, this.HW], [Cc.scroll, this.HW + fw]]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipX, 0, vw - clipX, HH);
      ctx.clip();
      for (let c = a; c < b; c++) {
        const w = this.cols.sizeOf(c);
        if (!w) continue;
        const x = this.colX(c);
        const on = c >= g.c0 && c <= g.c1;
        if (on) {
          ctx.fillStyle = "rgba(37, 99, 235, 0.16)";
          ctx.fillRect(x, 0, w, HH);
        }
        ctx.fillStyle = C.grid;
        ctx.fillRect(x + w - 0.5, 0, 1, HH);
        ctx.fillStyle = on ? C.accent : C.headText;
        ctx.textAlign = "center";
        ctx.fillText(colName(c), x + w / 2, HH / 2 + 1);
      }
      ctx.restore();
    }
    for (const [[a, b], clipY] of [[R.frozen, HH], [R.scroll, HH + fh]]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, clipY, this.HW, vh - clipY);
      ctx.clip();
      for (let r = a; r < b; r++) {
        const hgt = this.rows.sizeOf(r);
        if (!hgt) continue;
        const y = this.rowY(r);
        const on = r >= g.r0 && r <= g.r1;
        if (on) {
          ctx.fillStyle = "rgba(37, 99, 235, 0.16)";
          ctx.fillRect(0, y, this.HW, hgt);
        }
        ctx.fillStyle = C.grid;
        ctx.fillRect(0, y + hgt - 0.5, this.HW, 1);
        ctx.fillStyle = on ? C.accent : C.headText;
        ctx.textAlign = "center";
        ctx.fillText(String(r + 1), this.HW / 2, y + hgt / 2 + 1);
      }
      ctx.restore();
    }
    ctx.fillStyle = C.grid;
    ctx.fillRect(0, HH - 1, vw, 1);
    ctx.fillRect(this.HW - 1, 0, 1, vh);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  // ---------------------------------------------------------------------------------------------------- selection

  select(r, c, extend = false, scroll = true) {
    r = Math.max(0, Math.min(MAX_ROWS - 1, r));
    c = Math.max(0, Math.min(MAX_COLS - 1, c));
    if (!extend) this.anchor = { r, c };
    this.sel = { r, c };
    let g = normRange({ r0: this.anchor.r, c0: this.anchor.c, r1: r, c1: c });
    // grow the range over merged cells it touches
    for (let pass = 0; pass < 3; pass++)
      for (const m of this.sheet.merges) {
        const x = parseRange(m);
        if (x && M.overlaps(x, g)) g = { r0: Math.min(g.r0, x.r0), c0: Math.min(g.c0, x.c0), r1: Math.max(g.r1, x.r1), c1: Math.max(g.c1, x.c1) };
      }
    this.range = g;
    this.chartSel = null;
    if (r + 50 > this.rows.count || c + 10 > this.cols.count) {
      this.rowsWanted = r + 200;
      this.colsWanted = c + 20;
      this.layout();
    }
    if (scroll) this.scrollIntoView(r, c);
    this.syncBar();
    this.paint();
    this.app.emit("officestatus");
  }

  scrollIntoView(r, c) {
    const el = this.scroller;
    const z = this.zoom;
    if (r >= this.fr) {
      const top = this.rows.offsetOf(r) - this.rows.offsetOf(this.fr);
      const room = this.vh - HH - this.rows.offsetOf(this.fr);
      if (top < this.sy) el.scrollTop = top * z;
      else if (top + this.rows.sizeOf(r) > this.sy + room) el.scrollTop = (top + this.rows.sizeOf(r) - room) * z;
    }
    if (c >= this.fc) {
      const left = this.cols.offsetOf(c) - this.cols.offsetOf(this.fc);
      const room = this.vw - this.HW - this.cols.offsetOf(this.fc);
      if (left < this.sx) el.scrollLeft = left * z;
      else if (left + this.cols.sizeOf(c) > this.sx + room) el.scrollLeft = (left + this.cols.sizeOf(c) - room) * z;
    }
  }

  get a1() {
    return rcKey(this.sel.r, this.sel.c);
  }

  syncBar() {
    if (!this.bar) return;
    const g = this.range;
    this.bar.setRef(g.r0 === g.r1 && g.c0 === g.c1 ? this.a1 : formatRange(g));
    const cell = this.sheet.cells[this.a1];
    if (document.activeElement !== this.bar.input) this.bar.setValue(M.editText(cell));
    const s = cell?.s || {};
    for (const [k, b] of Object.entries(this.toggles)) b.setAttribute("aria-pressed", String(!!s[k]));
    this.fonts.set({ family: s.font || "Calibri", size: s.size || 11 });
    const look = cellLook(this.sheet, this.calc, this.sel.r, this.sel.c);
    this.live.textContent = `${this.a1}: ${look.text || t("empty")}${cell?.f ? ` (=${cell.f})` : ""}`;
  }

  goTo(ref) {
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(ref);
    if (m) {
      const s = M.sheetByName(this.model, (m[1] ?? m[2]).replace(/''/g, "'"));
      if (s) this.showSheet(s.id);
      ref = m[3];
    }
    const g = parseRange(ref.replace(/\$/g, "").toUpperCase());
    if (!g) return this.app.toast(t("“{ref}” is not a cell reference.", { ref }), "warning");
    this.anchor = { r: g.r0, c: g.c0 };
    this.select(g.r1, g.c1, true);
    this.focus();
  }

  showSheet(sid) {
    if (!M.sheetById(this.model, sid)) return;
    this.stopEdit(true);
    this.sid = sid;
    this.doc.office.model = { ...this.model, active: sid }; // the active tab is view state: no undo step
    this.scroller.scrollTop = 0;
    this.scroller.scrollLeft = 0;
    this.rowsWanted = 0;
    this.colsWanted = 0;
    this.layout();
    this.renderTabs();
    this.select(0, 0, false, false);
  }

  focus() {
    this.scroller.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------------------------------- editing

  startEdit(initial = null) {
    const cell = this.sheet.cells[this.a1];
    this.editing = { r: this.sel.r, c: this.sel.c, sid: this.sid };
    this.editor.value = initial ?? M.editText(cell);
    this.editor.classList.add("is-on");
    this.placeEditor();
    this.editor.focus();
    const n = this.editor.value.length;
    this.editor.setSelectionRange(n, n);
  }

  placeEditor() {
    if (!this.editing) return;
    const b = this.cellRect(this.editing.r, this.editing.c);
    const z = this.zoom;
    const st = this.sheet.cells[rcKey(this.editing.r, this.editing.c)]?.s || {};
    Object.assign(this.editor.style, { left: `${b.x * z}px`, top: `${b.y * z}px`, minWidth: `${b.w * z}px`, height: `${Math.max(b.h, 22) * z}px`, fontSize: `${(((st.size || 11) * 96) / 72) * z}px`, fontWeight: st.b ? "700" : "400" });
  }

  stopEdit(commit, move = null) {
    if (!this.editing) return;
    const ed = this.editing;
    this.editing = null;
    this.editor.classList.remove("is-on");
    if (commit && ed.sid === this.sid) {
      const text = this.editor.value;
      const a1 = rcKey(ed.r, ed.c);
      if (text !== M.editText(this.sheet.cells[a1])) this.commit("Edit Cell", M.inputCell(this.model, this.sid, a1, text));
    }
    this.focus();
    if (move) this.move(move);
  }

  commitInput(text, move) {
    if (text !== M.editText(this.sheet.cells[this.a1])) this.commit("Edit Cell", M.inputCell(this.model, this.sid, this.a1, text));
    this.focus();
    this.move(move);
  }

  move(dir, extend = false, jump = false) {
    if (!dir) return;
    const d = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[dir];
    let { r, c } = this.sel;
    const g = M.mergeAt(this.sheet, r, c);
    if (g && !extend) {
      if (dir === "down") r = g.r1;
      if (dir === "right") c = g.c1;
    }
    if (jump) {
      const filled = (rr, cc) => {
        const x = this.sheet.cells[rcKey(rr, cc)];
        return x && (x.v !== undefined || x.f !== undefined);
      };
      const lim = dir === "down" ? Math.max(M.extentOf(this.sheet).rows, r + 1) : dir === "right" ? Math.max(M.extentOf(this.sheet).cols, c + 1) : 0;
      let nr = r + d[0];
      let nc = c + d[1];
      const inside = () => nr >= 0 && nc >= 0 && (dir === "down" ? nr < lim : dir === "right" ? nc < lim : true);
      if (filled(r, c) && inside() && filled(nr, nc)) {
        while (inside() && filled(nr + d[0], nc + d[1])) (nr += d[0]), (nc += d[1]);
      } else while (inside() && !filled(nr, nc)) (nr += d[0]), (nc += d[1]);
      r = Math.max(0, Math.min(nr, dir === "down" ? lim - 1 : nr));
      c = Math.max(0, Math.min(nc, dir === "right" ? lim - 1 : nc));
    } else {
      do {
        r += d[0];
        c += d[1];
      } while (r > 0 && d[0] && this.rows.sizeOf(r) === 0 && r < this.rows.count - 1);
    }
    this.select(r, c, extend);
  }

  // ---------------------------------------------------------------------------------------------------- events

  bindEvents() {
    const sc = this.scroller;
    sc.addEventListener("scroll", () => {
      const nearEnd = sc.scrollTop + sc.clientHeight > sc.scrollHeight - 400;
      const nearRight = sc.scrollLeft + sc.clientWidth > sc.scrollWidth - 300;
      if ((nearEnd && this.rows.count < MAX_ROWS) || (nearRight && this.cols.count < MAX_COLS)) {
        if (nearEnd) this.rowsWanted = this.rows.count + 500;
        if (nearRight) this.colsWanted = this.cols.count + 10;
        this.layout();
      }
      this.paint();
    }, { passive: true });
    sc.addEventListener("pointerdown", (e) => this.pointerDown(e));
    sc.addEventListener("pointermove", (e) => this.pointerMove(e));
    sc.addEventListener("pointerup", (e) => this.pointerUp(e));
    sc.addEventListener("dblclick", (e) => this.dblClick(e));
    sc.addEventListener("keydown", (e) => this.keyDown(e));
    sc.addEventListener("contextmenu", (e) => {
      const p = this.point(e);
      if (p.y > HH && p.x > this.HW) {
        const r = this.rowAt(p.y);
        const c = this.colAt(p.x);
        if (r < this.range.r0 || r > this.range.r1 || c < this.range.c0 || c > this.range.c1) this.select(r, c, false, false);
      }
      officeContextMenu(this.app, e, "office-sheet", { doc: this.doc, view: this });
    });
    sc.addEventListener("copy", (e) => this.onCopy(e, false));
    sc.addEventListener("cut", (e) => this.onCopy(e, true));
    sc.addEventListener("paste", (e) => this.onPaste(e));
    sc.addEventListener("wheel", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });
    const ed = this.editor;
    ed.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.altKey) (e.preventDefault(), this.stopEdit(true, e.shiftKey ? "up" : "down"));
      else if (e.key === "Enter" && e.altKey) {
        e.preventDefault();
        const p = ed.selectionStart;
        ed.setRangeText("\n", p, ed.selectionEnd, "end");
      } else if (e.key === "Tab") (e.preventDefault(), this.stopEdit(true, e.shiftKey ? "left" : "right"));
      else if (e.key === "Escape") (e.preventDefault(), this.stopEdit(false));
    });
    ed.addEventListener("input", () => this.bar.setValue(ed.value));
    ed.addEventListener("blur", () => setTimeout(() => this.editing && document.activeElement !== ed && !this.pointing && this.stopEdit(true), 0));
  }

  point(e) {
    const b = this.gridEl.getBoundingClientRect();
    return { x: (e.clientX - b.left) / this.zoom, y: (e.clientY - b.top) / this.zoom };
  }

  hit(p) {
    const s = this.sheet;
    for (let i = s.charts.length - 1; i >= 0; i--) {
      const ch = s.charts[i];
      const b = this.chartRect(ch);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h && p.x > this.HW && p.y > HH) return { kind: "chart", ch, resize: p.x > b.x + b.w - 12 && p.y > b.y + b.h - 12 };
    }
    if (p.y < HH && p.x < this.HW) return { kind: "corner" };
    if (p.y < HH) {
      const c = this.colAt(p.x);
      const right = this.colX(c) + this.cols.sizeOf(c);
      const left = this.colX(c);
      if (Math.abs(p.x - right) < 5) return { kind: "colEdge", c };
      if (Math.abs(p.x - left) < 5 && c > 0) return { kind: "colEdge", c: c - 1 };
      return { kind: "colHead", c };
    }
    if (p.x < this.HW) {
      const r = this.rowAt(p.y);
      const bottom = this.rowY(r) + this.rows.sizeOf(r);
      if (Math.abs(p.y - bottom) < 4) return { kind: "rowEdge", r };
      if (Math.abs(p.y - this.rowY(r)) < 4 && r > 0) return { kind: "rowEdge", r: r - 1 };
      return { kind: "rowHead", r };
    }
    const g = this.range;
    const hx = this.colX(g.c1) + this.cols.sizeOf(g.c1);
    const hy = this.rowY(g.r1) + this.rows.sizeOf(g.r1);
    if (Math.abs(p.x - hx) < 5 && Math.abs(p.y - hy) < 5) return { kind: "fill" };
    const r = this.rowAt(p.y);
    const c = this.colAt(p.x);
    if (s.filter) {
      const f = parseRange(s.filter.range);
      if (f && r === f.r0 && c >= f.c0 && c <= f.c1 && p.x > this.colX(c) + this.cols.sizeOf(c) - 17 && p.y > this.rowY(r) + this.rows.sizeOf(r) - 18) return { kind: "filter", c, r };
    }
    return { kind: "cell", r, c };
  }

  pointerDown(e) {
    if (e.button !== 0) return;
    const p = this.point(e);
    if (p.x > this.gridEl.clientWidth / this.zoom - 16 || p.y > this.gridEl.clientHeight / this.zoom - 16) return; // scrollbars
    const hit = this.hit(p);
    // formula point mode: clicking a cell while typing a formula inserts its reference
    if (this.editing && hit.kind === "cell" && /^=.*[(,+\-*/^&=<>:]\s*$|^=$/.test(this.editor.value)) {
      e.preventDefault();
      const ref = hit.r === this.editing.r && hit.c === this.editing.c ? "" : rcKey(hit.r, hit.c);
      this.editor.setRangeText(ref, this.editor.selectionStart, this.editor.selectionEnd, "end");
      this.bar.setValue(this.editor.value);
      this.pointing = true;
      setTimeout(() => ((this.pointing = false), this.editor.focus()), 0);
      return;
    }
    if (this.editing) this.stopEdit(true);
    this.focus();
    e.preventDefault();
    this.scroller.setPointerCapture?.(e.pointerId);
    this.drag = { hit, start: p, moved: false };
    switch (hit.kind) {
      case "corner":
        this.anchor = { r: 0, c: 0 };
        this.select(this.rows.count - 1, this.cols.count - 1, true, false);
        this.range = { r0: 0, c0: 0, r1: MAX_ROWS - 1, c1: MAX_COLS - 1 };
        this.sel = { r: 0, c: 0 };
        this.syncBar();
        break;
      case "colHead":
        if (e.shiftKey) this.selectCols(this.anchor.c, hit.c);
        else this.selectCols(hit.c, hit.c);
        break;
      case "rowHead":
        if (e.shiftKey) this.selectRows(this.anchor.r, hit.r);
        else this.selectRows(hit.r, hit.r);
        break;
      case "colEdge":
        this.drag.size = this.cols.sizeOf(hit.c);
        break;
      case "rowEdge":
        this.drag.size = this.rows.sizeOf(hit.r);
        break;
      case "chart":
        this.chartSel = hit.ch.id;
        this.drag.orig = { ...hit.ch };
        this.paint();
        break;
      case "filter":
        this.drag = null;
        this.filterMenu(hit.c);
        break;
      case "cell":
        this.select(hit.r, hit.c, e.shiftKey);
        break;
    }
  }

  selectCols(a, b) {
    this.anchor = { r: 0, c: a };
    this.sel = { r: 0, c: b };
    this.range = { r0: 0, c0: Math.min(a, b), r1: MAX_ROWS - 1, c1: Math.max(a, b) };
    this.chartSel = null;
    this.syncBar();
    this.paint();
  }

  selectRows(a, b) {
    this.anchor = { r: a, c: 0 };
    this.sel = { r: b, c: 0 };
    this.range = { r0: Math.min(a, b), c0: 0, r1: Math.max(a, b), c1: MAX_COLS - 1 };
    this.chartSel = null;
    this.syncBar();
    this.paint();
  }

  pointerMove(e) {
    const p = this.point(e);
    if (!this.drag) {
      const hit = this.hit(p);
      this.scroller.style.cursor = hit.kind === "colEdge" ? "col-resize" : hit.kind === "rowEdge" ? "row-resize" : hit.kind === "fill" ? "crosshair" : hit.kind === "chart" ? (hit.resize ? "nwse-resize" : "move") : hit.kind === "filter" ? "pointer" : "cell";
      return;
    }
    const d = this.drag;
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const k = d.hit.kind;
    if (k === "cell") this.select(this.rowAt(Math.max(HH + 1, p.y)), this.colAt(Math.max(this.HW + 1, p.x)), true);
    else if (k === "colHead") this.selectCols(this.anchor.c, this.colAt(Math.max(this.HW + 1, p.x)));
    else if (k === "rowHead") this.selectRows(this.anchor.r, this.rowAt(Math.max(HH + 1, p.y)));
    else if (k === "colEdge") {
      this.cols.setSize(d.hit.c, Math.max(4, d.size + dx));
      this.paint();
    } else if (k === "rowEdge") {
      this.rows.setSize(d.hit.r, Math.max(4, d.size + dy));
      this.paint();
    } else if (k === "fill") {
      const r = this.rowAt(p.y);
      const c = this.colAt(p.x);
      const g = this.range;
      const vertical = Math.abs(r - (r > g.r1 ? g.r1 : g.r0)) * 20 >= Math.abs(c - (c > g.c1 ? g.c1 : g.c0)) * 60;
      this.fillPreview = vertical ? { r0: Math.min(g.r0, r), r1: Math.max(g.r1, r), c0: g.c0, c1: g.c1 } : { r0: g.r0, r1: g.r1, c0: Math.min(g.c0, c), c1: Math.max(g.c1, c) };
      this.paint();
    } else if (k === "chart") {
      const s = this.sheet;
      const ch = s.charts.find((x) => x.id === d.orig.id);
      if (!ch) return;
      if (d.hit.resize) d.next = { ...d.orig, w: Math.max(160, d.orig.w + dx), h: Math.max(120, d.orig.h + dy) };
      else {
        const x = this.colX(d.orig.c) + dx;
        const y = this.rowY(d.orig.r) + dy;
        d.next = { ...d.orig, c: Math.max(0, this.colAt(Math.max(this.HW + 1, x + 4))), r: Math.max(0, this.rowAt(Math.max(HH + 1, y + 4))) };
      }
      this.previewChart = d.next;
      this.doc.office.model = M.updateSheet(this.model, this.sid, (sh) => ({ ...sh, charts: sh.charts.map((x) => (x.id === ch.id ? d.next : x)) })); // preview; committed on release
      this.paint();
    }
  }

  pointerUp(e) {
    const d = this.drag;
    this.drag = null;
    this.scroller.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    const k = d.hit.kind;
    if (k === "colEdge" && d.moved) {
      const c = d.hit.c;
      const cols = c >= this.range.c0 && c <= this.range.c1 && this.range.r1 >= MAX_ROWS - 1 ? range(this.range.c0, this.range.c1) : [c];
      this.commit("Column Width", M.setSize(this.model, this.sid, "col", cols, this.cols.sizeOf(c)));
    } else if (k === "rowEdge" && d.moved) {
      const r = d.hit.r;
      const rows = r >= this.range.r0 && r <= this.range.r1 && this.range.c1 >= MAX_COLS - 1 ? range(this.range.r0, this.range.r1) : [r];
      this.commit("Row Height", M.setSize(this.model, this.sid, "row", rows, this.rows.sizeOf(r)));
    } else if (k === "fill" && this.fillPreview) {
      const target = this.fillPreview;
      this.fillPreview = null;
      const src = this.range;
      this.commit("Fill", M.fillRange(this.model, this.sid, src, target));
      this.anchor = { r: target.r0, c: target.c0 };
      this.select(target.r1, target.c1, true, false);
    } else if (k === "chart" && d.next) {
      const before = M.updateSheet(this.model, this.sid, (sh) => ({ ...sh, charts: sh.charts.map((x) => (x.id === d.orig.id ? d.orig : x)) }));
      const after = this.model;
      this.doc.office.model = before;
      this.commit(d.hit.resize ? "Resize Chart" : "Move Chart", after);
    }
    this.paint();
  }

  dblClick(e) {
    const hit = this.hit(this.point(e));
    if (hit.kind === "colEdge") this.autofit("col", hit.c);
    else if (hit.kind === "rowEdge") this.commit("Row Height", M.setSize(this.model, this.sid, "row", [hit.r], null));
    else if (hit.kind === "chart") this.chartDialog(hit.ch);
    else if (hit.kind === "cell") this.startEdit();
  }

  keyDown(e) {
    if (e.target !== this.scroller) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    if (this.chartSel && (key === "Delete" || key === "Backspace")) {
      e.preventDefault();
      return this.deleteChart(this.chartSel);
    }
    if (arrows[key]) {
      e.preventDefault();
      return this.move(arrows[key], e.shiftKey, mod);
    }
    if (mod && (key === "c" || key === "x" || key === "v" || key === "C" || key === "X" || key === "V")) {
      e.stopPropagation(); // the copy / cut / paste events do the work (no clipboard permission needed)
      return;
    }
    const handled = () => (e.preventDefault(), e.stopPropagation());
    if (mod && !e.altKey) {
      const k = key.toLowerCase();
      if (k === "b" || k === "i" || k === "u") return handled(), this.toggle(k);
      if (k === "5") return handled(), this.toggle("st");
      if (k === "a") return handled(), this.selectAll();
      if (k === "d") return handled(), this.fill("down");
      if (k === "r") return handled(), this.fill("right");
      if (k === "f") return handled(), this.findDialog();
      if (k === "h") return handled(), this.findDialog(true);
      if (key === "Home") return handled(), this.select(0, 0, e.shiftKey);
      if (key === "End") {
        const ext = M.extentOf(this.sheet);
        return handled(), this.select(Math.max(0, ext.rows - 1), Math.max(0, ext.cols - 1), e.shiftKey);
      }
      if (key === ";") return handled(), this.commit("Insert Date", M.inputCell(this.model, this.sid, this.a1, new Date().toISOString().slice(0, 10)));
      return;
    }
    switch (key) {
      case "Enter":
        handled();
        return this.move(e.shiftKey ? "up" : "down");
      case "Tab":
        handled();
        return this.move(e.shiftKey ? "left" : "right");
      case "F2":
        handled();
        return this.startEdit();
      case "Delete":
      case "Backspace":
        handled();
        return this.clear();
      case "Escape":
        if (clipboard) {
          clipboard.range = null;
          this.paint();
        }
        return;
      case "Home":
        handled();
        return this.select(this.sel.r, 0, e.shiftKey);
      case "PageDown":
      case "PageUp": {
        handled();
        const n = Math.max(1, Math.floor((this.vh - HH) / M.DEFAULT_ROW) - 1);
        return this.select(Math.max(0, this.sel.r + (key === "PageDown" ? n : -n)), this.sel.c, e.shiftKey);
      }
    }
    if (key.length === 1 && !e.altKey) {
      handled();
      this.startEdit(key);
    }
  }

  // ---------------------------------------------------------------------------------------------------- clipboard

  /** Cells of the selection as a block (formulas and styles) plus TSV of the displayed values. */
  selectionBlock() {
    const g = this.clampRange(this.range);
    const block = [];
    const text = [];
    const s = this.sheet;
    for (let r = g.r0; r <= g.r1; r++) {
      if (this.hidden.has(r)) continue;
      const row = [];
      const trow = [];
      for (let c = g.c0; c <= g.c1; c++) {
        row.push(s.cells[rcKey(r, c)] || null);
        trow.push(cellLook(s, this.calc, r, c).text);
      }
      block.push(row);
      text.push(trow);
    }
    return { block, text: toDelimited(text, "\t"), html: rowsToHtml(text), g };
  }

  clampRange(g) {
    const ext = M.extentOf(this.sheet);
    return { r0: g.r0, c0: g.c0, r1: g.r1 >= MAX_ROWS - 1 ? Math.max(g.r0, ext.rows - 1) : g.r1, c1: g.c1 >= MAX_COLS - 1 ? Math.max(g.c0, ext.cols - 1) : g.c1 };
  }

  onCopy(e, cut) {
    const { block, text, html, g } = this.selectionBlock();
    e.preventDefault();
    e.clipboardData?.setData("text/plain", text);
    e.clipboardData?.setData("text/html", html);
    clipboard = { text, block, from: { r: g.r0, c: g.c0 }, sid: this.sid, doc: this.doc, cut, range: g };
    this.paint();
  }

  async copy(cut = false) {
    const { block, text, html, g } = this.selectionBlock();
    clipboard = { text, block, from: { r: g.r0, c: g.c0 }, sid: this.sid, doc: this.doc, cut, range: g };
    const { writeClipboard } = await import("../toolkit/clipboard.js");
    await writeClipboard({ text, html });
    this.paint();
  }

  onPaste(e) {
    e.preventDefault();
    this.pasteText(e.clipboardData?.getData("text/plain") ?? "");
  }

  async paste(values = false) {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      if (!clipboard) return this.app.toast(t("Use Ctrl+V to paste (the browser blocked clipboard access)."), "warning", 3500);
      text = clipboard.text;
    }
    this.pasteText(text, values);
  }

  pasteText(text, values = false) {
    const at = { r: this.range.r0, c: this.range.c0 };
    let next = this.model;
    const internal = clipboard && clipboard.text.replace(/\r\n/g, "\n") === String(text).replace(/\r\n/g, "\n");
    let h0;
    let w0;
    if (internal) {
      const cb = clipboard;
      h0 = cb.block.length;
      w0 = cb.block[0]?.length || 0;
      if (cb.cut && cb.doc === this.doc && M.sheetById(next, cb.sid)) next = M.clearRange(next, cb.sid, cb.range, { all: true });
      next = M.pasteBlock(next, this.sid, at.r, at.c, cb.block, { from: cb.from, values });
      if (cb.cut) clipboard = null;
    } else {
      const rows = parseDelimited(String(text).replace(/\r?\n$/, ""), "\t");
      h0 = rows.length;
      w0 = Math.max(0, ...rows.map((r) => r.length));
      const updates = {};
      rows.forEach((row, i) =>
        row.forEach((val, j) => {
          const k = rcKey(at.r + i, at.c + j);
          const p = M.parseInput(val);
          updates[k] = p ? { ...(p.f !== undefined ? { f: p.f } : { v: p.v }), ...(p.nf ? { s: { ...(this.sheet.cells[k]?.s || {}), nf: p.nf } } : {}) } : null;
        }));
      next = M.setCells(next, this.sid, updates);
    }
    this.commit(values ? "Paste Values" : "Paste", next);
    if (h0 && w0) {
      this.anchor = { r: at.r, c: at.c };
      this.select(at.r + h0 - 1, at.c + w0 - 1, true, false);
    }
  }

  // ---------------------------------------------------------------------------------------------------- actions (commands call these)

  selectAll() {
    const ext = M.extentOf(this.sheet);
    this.anchor = { r: 0, c: 0 };
    this.select(Math.max(0, ext.rows - 1), Math.max(0, ext.cols - 1), true, false);
  }

  clear(all = false) {
    this.commit(all ? "Clear All" : "Clear Contents", M.clearRange(this.model, this.sid, this.range, { all }));
  }

  clearFormats() {
    this.commit("Clear Formats", M.updateSheet(this.model, this.sid, (s) => {
      const cells = { ...s.cells };
      for (const [, , k] of M.rangeCells(s, this.range)) {
        const c = cells[k];
        if (!c?.s) continue;
        const { s: _s, ...rest } = c;
        if (rest.v === undefined && rest.f === undefined) delete cells[k];
        else cells[k] = rest;
      }
      return { ...s, cells };
    }));
  }

  setStyle(patch, label = "Format Cells") {
    this.commit(label, M.applyStyle(this.model, this.sid, this.range, patch));
    this.focus();
  }

  toggle(prop) {
    const on = !!this.sheet.cells[this.a1]?.s?.[prop];
    this.setStyle({ [prop]: on ? null : true });
  }

  decimals(delta) {
    const look = cellLook(this.sheet, this.calc, this.sel.r, this.sel.c);
    const code = look.style?.nf || "General";
    const base = code === "General" ? (typeof look.value === "number" ? `0${String(look.value).includes(".") ? `.${"0".repeat(Math.min(10, String(look.value).split(".")[1].length))}` : ""}` : "0") : code;
    const m = /0(?:\.(0+))?/.exec(base);
    if (!m) return;
    const want = Math.max(0, Math.min(10, (m[1] || "").length + delta));
    this.setStyle({ nf: base.replace(/0(?:\.0+)?/g, `0${want ? `.${"0".repeat(want)}` : ""}`) });
  }

  borders(kind) {
    const g = this.clampRange(this.range);
    const col = "#000000";
    let next = this.model;
    if (kind === "none") next = M.applyStyle(next, this.sid, g, { bd: null });
    else if (kind === "all") next = M.applyStyle(next, this.sid, g, { bd: { t: col, r: col, b: col, l: col } });
    else {
      next = M.updateSheet(next, this.sid, (s) => {
        const cells = { ...s.cells };
        for (let r = g.r0; r <= g.r1; r++)
          for (let c = g.c0; c <= g.c1; c++) {
            const k = rcKey(r, c);
            const bd = { ...(cells[k]?.s?.bd || {}) };
            if (kind === "outer" || kind === "top") if (r === g.r0) bd.t = col;
            if (kind === "outer" || kind === "bottom") if (r === g.r1) bd.b = col;
            if (kind === "outer") {
              if (c === g.c0) bd.l = col;
              if (c === g.c1) bd.r = col;
            }
            if (Object.keys(bd).length) cells[k] = { ...(cells[k] || {}), s: { ...(cells[k]?.s || {}), bd } };
          }
        return { ...s, cells };
      });
    }
    this.commit("Borders", next);
  }

  merge(on = true) {
    this.commit(on ? "Merge Cells" : "Unmerge Cells", on ? M.mergeRange(this.model, this.sid, this.range) : M.unmergeRange(this.model, this.sid, this.range));
  }

  insert(axis, after = false) {
    const g = this.range;
    const n = axis === "row" ? Math.min(1000, g.r1 >= MAX_ROWS - 1 ? 1 : g.r1 - g.r0 + 1) : Math.min(100, g.c1 >= MAX_COLS - 1 ? 1 : g.c1 - g.c0 + 1);
    const at = axis === "row" ? (after ? g.r1 + 1 : g.r0) : after ? g.c1 + 1 : g.c0;
    this.commit(axis === "row" ? "Insert Rows" : "Insert Columns", M.shiftAxis(this.model, this.sid, axis, at, n));
  }

  remove(axis) {
    const g = this.clampRange(this.range);
    const at = axis === "row" ? g.r0 : g.c0;
    const n = axis === "row" ? g.r1 - g.r0 + 1 : g.c1 - g.c0 + 1;
    this.commit(axis === "row" ? "Delete Rows" : "Delete Columns", M.shiftAxis(this.model, this.sid, axis, at, -n));
    this.select(this.range.r0, this.range.c0, false, false);
  }

  fill(dir) {
    const g = this.clampRange(this.range);
    if (dir === "down" && g.r1 > g.r0) this.commit("Fill Down", M.fillRange(this.model, this.sid, { ...g, r1: g.r0 }, g));
    else if (dir === "right" && g.c1 > g.c0) this.commit("Fill Right", M.fillRange(this.model, this.sid, { ...g, c1: g.c0 }, g));
  }

  autofit(axis, c) {
    const s = this.sheet;
    const ctx = this.canvas.getContext("2d");
    let w = 24;
    const ext = Math.min(M.extentOf(s).rows, 5000);
    for (let r = 0; r < ext; r++) {
      const look = cellLook(s, this.calc, r, c);
      if (!look.text) continue;
      const st = look.style || {};
      ctx.font = `${st.i ? "italic " : ""}${st.b ? "700 " : ""}${((st.size || 11) * 96) / 72}px ${FONT}`;
      w = Math.max(w, ctx.measureText(look.text).width + 12);
    }
    this.commit("Column Width", M.setSize(this.model, this.sid, "col", [c], Math.min(600, Math.ceil(w))));
  }

  async sizePrompt(axis) {
    const { promptDialog } = await import("../toolkit/ui.js");
    const cur = axis === "col" ? this.cols.sizeOf(this.sel.c) : this.rows.sizeOf(this.sel.r);
    const v = await promptDialog({ title: axis === "col" ? t("Column width") : t("Row height"), label: "Size in pixels", value: String(cur), type: "number" });
    const px = Number(v);
    if (!v || !Number.isFinite(px) || px < 0) return;
    const g = this.clampRange(this.range);
    this.commit(axis === "col" ? "Column Width" : "Row Height", M.setSize(this.model, this.sid, axis, axis === "col" ? range(g.c0, g.c1) : range(g.r0, g.r1), px));
  }

  sort(asc) {
    let g = this.clampRange(this.range);
    const s = this.sheet;
    let header = false;
    if (s.filter && (g.r0 === g.r1 || g.r1 - g.r0 < 1)) {
      const f = parseRange(s.filter.range);
      if (f && this.sel.c >= f.c0 && this.sel.c <= f.c1) (g = f), (header = true);
    } else if (g.r0 === g.r1 && g.c0 === g.c1) {
      // a single cell sorts its current region (the used block around it, first row as header when it is text)
      g = M.currentRegion(s, this.sel.r, this.sel.c);
      header = typeof this.calc.get(this.sid, g.r0, this.sel.c) === "string" && typeof this.calc.get(this.sid, g.r0 + 1, this.sel.c) !== "string";
    }
    const calc = this.calc;
    this.commit(asc ? "Sort Ascending" : "Sort Descending", M.sortRange(this.model, this.sid, g, this.sel.c, { asc, header, valueOf: (r, c) => calc.get(this.sid, r, c), compare: compareValues }));
  }

  toggleFilter() {
    const s = this.sheet;
    if (s.filter) return this.commit("Remove Filter", M.updateSheet(this.model, this.sid, (x) => ({ ...x, filter: null })));
    let g = this.clampRange(this.range);
    if (g.r0 === g.r1) {
      g = M.currentRegion(s, this.sel.r, this.sel.c);
      if (g.r0 === g.r1) return this.app.toast(t("Select a table with a header row first."), "warning");
    }
    this.commit("Filter", M.updateSheet(this.model, this.sid, (x) => ({ ...x, filter: { range: formatRange(g), hide: {} } })));
  }

  freeze(kind = "selection") {
    const fr = kind === "none" ? null : kind === "row" ? { r: 1, c: 0 } : kind === "col" ? { r: 0, c: 1 } : { r: this.sel.r, c: this.sel.c };
    const cur = this.sheet.freeze;
    const next = kind === "selection" && cur ? null : fr && (fr.r || fr.c) ? fr : null;
    this.commit(next ? "Freeze Panes" : "Unfreeze Panes", M.updateSheet(this.model, this.sid, (s) => ({ ...s, freeze: next })));
  }

  setZoom(z) {
    const zz = Math.max(0.5, Math.min(3, Math.round(z * 20) / 20));
    if (zz === this.zoom) return;
    const sx = this.sx;
    const sy = this.sy;
    this.zoom = zz;
    this.zoomCtl.set(zz);
    this.layout();
    this.scroller.scrollLeft = sx * zz;
    this.scroller.scrollTop = sy * zz;
    this.paint();
  }

  // ---------------------------------------------------------------------------------------------------- sheets

  addSheet() {
    this.commit("Add Sheet", M.addSheet(this.model, { after: this.sid }));
    this.showSheet(this.model.active);
  }

  async renameSheet(sid = this.sid) {
    const { promptDialog } = await import("../toolkit/ui.js");
    const s = M.sheetById(this.model, sid);
    const name = await promptDialog({ title: t("Rename sheet"), label: "Sheet name", value: s.name });
    if (!name || name === s.name) return;
    try {
      this.commit("Rename Sheet", M.renameSheet(this.model, sid, name.trim()));
    } catch (err) {
      this.app.toast(t(err.message), "warning", 4000);
    }
  }

  async deleteSheet(sid = this.sid) {
    if (this.model.sheets.length <= 1) return this.app.toast(t("A workbook needs at least one sheet."), "warning");
    const { confirmDialog } = await import("../toolkit/ui.js");
    const s = M.sheetById(this.model, sid);
    if (Object.keys(s.cells).length && !(await confirmDialog({ title: t("Delete sheet"), message: t("Delete “{name}”? Formulas that use it will show #REF!.", { name: s.name }), ok: t("Delete"), danger: true }))) return;
    this.commit("Delete Sheet", M.deleteSheet(this.model, sid));
    this.showSheet(this.model.active);
  }

  duplicateSheet() {
    this.commit("Duplicate Sheet", M.duplicateSheet(this.model, this.sid));
    this.showSheet(this.model.active);
  }

  // ---------------------------------------------------------------------------------------------------- dialogs (sheet/dialogs.js)

  insertFunction() {
    return import("./dialogs.js").then((m) => m.functionDialog(this));
  }
  chartDialog(chart = null) {
    return import("./dialogs.js").then((m) => m.chartDialog(this, chart));
  }
  conditionalDialog() {
    return import("./dialogs.js").then((m) => m.conditionalDialog(this));
  }
  filterMenu(c) {
    return import("./dialogs.js").then((m) => m.filterDialog(this, c));
  }
  findDialog(replace = false) {
    return import("./dialogs.js").then((m) => m.findDialog(this, replace));
  }
  numberFormatDialog() {
    return import("./dialogs.js").then((m) => m.numberFormatDialog(this));
  }

  deleteChart(id) {
    this.chartSel = null;
    this.commit("Delete Chart", M.updateSheet(this.model, this.sid, (s) => ({ ...s, charts: s.charts.filter((c) => c.id !== id) })));
  }

  // ---------------------------------------------------------------------------------------------------- suite instance contract

  activate() {
    this.layout();
    this.paint();
    requestAnimationFrame(() => this.focus());
  }

  deactivate() {
    this.stopEdit(true);
  }

  destroy() {
    this.off?.();
    this.ro?.disconnect();
    this.ribbon.destroy?.();
    cancelAnimationFrame(this.frame);
    this.el.remove();
  }

  statusText() {
    const g = this.clampRange(this.range);
    const cells = (g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1);
    if (cells < 2 || cells > 200000) return `${this.sheet.name} · ${this.a1}`;
    let sum = 0;
    let n = 0;
    let count = 0;
    for (let r = g.r0; r <= g.r1; r++)
      for (let c = g.c0; c <= g.c1; c++) {
        const v = this.calc.get(this.sid, r, c);
        if (v != null && v !== "") count++;
        if (typeof v === "number") (sum += v), n++;
      }
    const f = (x) => String(Number(x.toPrecision(12)));
    return n ? t("Sum: {sum} · Average: {avg} · Count: {count}", { sum: f(sum), avg: f(sum / n), count }) : t("Count: {count}", { count });
  }

  commentAnchor() {
    return officeItemAnchor({ item: `cell:${this.sid}!${this.a1}`, label: `${this.sheet.name}!${this.a1}` });
  }

  revealAnchor(anchor) {
    const m = /^cell:(.+)!([A-Z]{1,3}\d+)$/.exec(anchor?.item || "");
    if (!m) return;
    if (m[1] !== this.sid) this.showSheet(m[1]);
    const ref = parseRef(m[2]);
    if (ref) this.select(ref.r, ref.c);
  }
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export { keyRC };
