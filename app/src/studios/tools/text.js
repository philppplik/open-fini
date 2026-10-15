// Text tools with an in-canvas editor. A hidden <textarea> receives keyboard/IME input; caret,
// selection and hit-testing come from the layout engine, so editing works across linked frames.
import { Tool } from "../../core/tool.js";
import { h } from "../../core/util.js";
import { worldMatrix } from "../../core/nodes.js";
import { apply, invert } from "../../core/math.js";
import { getStoryLayout } from "../../engine/dl.js";
import { pick } from "../../engine/hit.js";
import { offsetToCaret, hitTest, selectionRects, moveCaretVertical, lineStart, lineEnd, wordBoundary } from "../../engine/layout/index.js";
import * as T from "../../engine/layout/text-model.js";
import { addTextNode, currentTextStyle } from "../../core/text-ops.js";
import { cssColor } from "../../core/color.js";

const ACCENT = "#8b7cf6";
const isMod = (e) => e.ctrlKey || e.metaKey;

/** The text node(s) a format command should apply to and the active editing session, if any. */
export function textTargets(app) {
  const s = app.textEditor || null;
  if (s) return { session: s, nodes: [s.node] };
  const nodes = app.selection.filter((n) => n.type === "text" && app.doc.stories[n.storyId]);
  return { session: null, nodes };
}

/** Resolved character + paragraph attributes at the caret (or of the first selected text object). */
export function currentFormat(app) {
  const { session, nodes } = textTargets(app);
  const node = nodes[0];
  if (!node) return null;
  const entry = app.doc.stories[node.storyId];
  const defaults = entry.defaults || { char: {}, para: {} };
  const baseChar = { fontFamily: "Inter", fontSize: 24, fontWeight: 400, fontStyle: "normal", color: node.fill?.type === "solid" ? node.fill.color : "#000000", ...(defaults.char || {}) };
  let attrs = {};
  let paraAttrs = {};
  if (session) {
    const from = Math.min(session.caret, session.anchor);
    attrs = { ...T.getAttrsAt(entry.story, from), ...(session.pending || {}) };
    const p = T.paragraphAt(entry.story, from);
    paraAttrs = entry.story.paragraphs[p.index]?.attrs || {};
  } else {
    attrs = T.getAttrsAt(entry.story, 0);
    paraAttrs = entry.story.paragraphs[0]?.attrs || {};
  }
  return { char: { ...baseChar, ...attrs }, para: { align: "left", lineHeight: 1.25, ...(defaults.para || {}), ...paraAttrs }, node, session };
}

/** Applies character attributes to the selection, the caret (pending), or whole selected text objects. */
export function applyCharFormat(app, patch, label = "Text Format") {
  const { session, nodes } = textTargets(app);
  const doc = app.doc;
  if (session) {
    if (session.caret !== session.anchor) {
      const from = Math.min(session.caret, session.anchor);
      const to = Math.max(session.caret, session.anchor);
      doc.setStory(session.node.storyId, T.applyCharAttrs(doc.stories[session.node.storyId].story, from, to, patch), label, { coalesce: `fmt:${Object.keys(patch)}` });
    } else session.pending = { ...(session.pending || {}), ...patch };
    app.emit("textcaret");
    app.requestOverlay();
    return;
  }
  if (!nodes.length) {
    Object.assign(currentTextStyle(app).char, patch);
    return;
  }
  doc.tx(label, () => {
    for (const n of nodes) {
      const entry = doc.stories[n.storyId];
      const len = T.storyLength(entry.story);
      doc.setStory(n.storyId, T.applyCharAttrs(entry.story, 0, len, patch), label, { coalesce: `fmt:${Object.keys(patch)}` });
      doc.setStoryDefaults(n.storyId, { char: { ...(entry.defaults?.char || {}), ...patch }, para: entry.defaults?.para || {} });
    }
  });
}

export function applyParaFormat(app, patch, label = "Paragraph Format") {
  const { session, nodes } = textTargets(app);
  const doc = app.doc;
  if (session) {
    const from = Math.min(session.caret, session.anchor);
    const to = Math.max(session.caret, session.anchor);
    doc.setStory(session.node.storyId, T.applyParaAttrs(doc.stories[session.node.storyId].story, from, to, patch), label, { coalesce: `pfmt:${Object.keys(patch)}` });
    return;
  }
  if (!nodes.length) {
    Object.assign(currentTextStyle(app).para, patch);
    return;
  }
  doc.tx(label, () => {
    for (const n of nodes) {
      const entry = doc.stories[n.storyId];
      const len = T.storyLength(entry.story);
      doc.setStory(n.storyId, T.applyParaAttrs(entry.story, 0, len, patch), label, { coalesce: `pfmt:${Object.keys(patch)}` });
      doc.setStoryDefaults(n.storyId, { char: entry.defaults?.char || {}, para: { ...(entry.defaults?.para || {}), ...patch } });
    }
  });
}

export class TextTool extends Tool {
  static id = "text";
  static label = "Artistic Text";
  static icon = "type";
  static shortcut = "T";
  static studios = ["vector", "pixel", "layout"];
  static group = "text";
  cursor = "text";
  frameMode = false;

  s = null; // editing session
  pending = null; // click position waiting for the first character
  blink = true;
  blinkTimer = 0;
  input = null;

  // ------------------------------------------------------------------ lifecycle

  activate() {
    this.#ensureInput();
    this.app.cv?.setCursor("text");
    this.blinkTimer = setInterval(() => {
      this.blink = !this.blink;
      if (this.s || this.pending) this.app.requestOverlay();
    }, 530);
    // a selected text object can be edited right away
    const sel = this.app.selection;
    if (sel.length === 1 && sel[0].type === "text") this.edit(sel[0]);
  }

  deactivate() {
    clearInterval(this.blinkTimer);
    this.end();
    this.input?.blur();
  }

  cancel() {
    this.createDrag = null;
    this.dragSel = false;
  }

  refresh() {
    if (this.s) {
      const len = this.#len();
      this.s.caret = Math.min(this.s.caret, len);
      this.s.anchor = Math.min(this.s.anchor, len);
    }
    this.app.requestOverlay();
  }

  #ensureInput() {
    if (this.input?.isConnected) return;
    const ta = h("textarea.of-textinput", { autocapitalize: "off", autocomplete: "off", spellcheck: false, rows: 1, "aria-label": "Text input", tabIndex: -1 });
    Object.assign(ta.style, { position: "absolute", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", padding: "0", border: "0", resize: "none", pointerEvents: "none", userSelect: "text" });
    this.app.cv.stage.append(ta);
    this.input = ta;
    ta.addEventListener("keydown", (e) => this.#keydown(e));
    ta.addEventListener("input", (e) => this.#input(e));
    ta.addEventListener("compositionstart", () => {
      this.#deleteSelection();
      this.comp = { start: this.s ? this.s.caret : 0, len: 0 };
    });
    ta.addEventListener("compositionend", () => {
      this.comp = null;
      ta.value = "";
    });
    ta.addEventListener("copy", (e) => this.#copy(e, false));
    ta.addEventListener("cut", (e) => this.#copy(e, true));
    ta.addEventListener("paste", (e) => this.#paste(e));
    ta.addEventListener("blur", () => {
      // keep the session while the user interacts with panels; it ends on tool change or canvas click
    });
  }

  // ------------------------------------------------------------------ session

  get doc() {
    return this.app.doc;
  }
  #entry() {
    return this.doc.stories[this.s.node.storyId];
  }
  #len() {
    return T.storyLength(this.#entry().story);
  }

  /** Starts editing `node`. `e` positions the caret at the pointer; otherwise the caret goes to the end. */
  edit(node, e) {
    this.end(true);
    const entry = this.doc.stories[node.storyId];
    if (!entry) return;
    this.s = { node, caret: 0, anchor: 0, goalX: null, pending: null };
    this.pending = null;
    this.app.textEditor = this.s;
    this.app.select([node]);
    const len = T.storyLength(entry.story);
    const off = e ? this.#offsetAt(e) : len;
    this.s.caret = this.s.anchor = off ?? len;
    this.#focus();
    this.app.emit("textcaret");
    this.app.requestOverlay();
  }

  end(keepSelection = false) {
    const s = this.s;
    if (s) {
      this.s = null;
      this.app.textEditor = null;
      const entry = this.doc?.stories[s.node.storyId];
      if (entry && T.plainText(entry.story) === "" && s.node._page && this.doc.find(s.node.id) === s.node && s.node.mode === "artistic") {
        this.doc.remove(s.node);
        if (!keepSelection) this.app.clearSelection();
      }
    }
    this.pending = null;
    this.comp = null;
    this.app.emit("textcaret");
    this.app.requestOverlay();
  }

  #focus() {
    this.#ensureInput();
    this.input.value = "";
    this.input.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ geometry helpers

  #layout(node = this.s?.node) {
    return node ? getStoryLayout(this.doc, node) : null;
  }

  /** Story offset under a tool event, hit-testing the story's frame at the pointer. */
  #offsetAt(e, node = this.s?.node) {
    const lay = this.#layout(node);
    if (!lay) return null;
    // test every frame of the chain, preferring the one containing the pointer
    let best = null;
    lay.frames.forEach((f, i) => {
      const inv = invert(worldMatrix(f));
      if (!inv) return;
      const [lx, ly] = apply(inv, e.x, e.y);
      const w = f.w ?? lay.result.artisticWidth ?? 0;
      const hh = f.h ?? lay.result.frames[i]?.usedHeight ?? 0;
      const inside = lx >= -4 && ly >= -4 && lx <= w + 4 && ly <= hh + 4;
      const d = inside ? 0 : Math.hypot(Math.max(0, -lx, lx - w), Math.max(0, -ly, ly - hh));
      if (!best || d < best.d) best = { i, lx, ly, d };
    });
    return best ? hitTest(lay.result, best.i, best.lx, best.ly) : null;
  }

  // ------------------------------------------------------------------ pointer

  pointerDown(e) {
    const app = this.app;
    this.#ensureInput();
    // click inside the node being edited: move the caret / start a selection
    if (this.s) {
      const hit = pick(app.context, e.x, e.y, 4 / app.view.zoom, { deep: true });
      const inChain = hit && hit.type === "text" && hit.storyId === this.s.node.storyId;
      if (inChain) {
        const off = this.#offsetAt(e, hit);
        if (off != null) {
          if (e.detail >= 3) {
            const p = T.paragraphAt(this.#entry().story, off);
            this.s.anchor = p.start;
            this.s.caret = p.end;
          } else if (e.detail === 2) {
            const r = T.wordRange(this.#entry().story, off);
            this.s.anchor = r.from ?? r.start ?? off;
            this.s.caret = r.to ?? r.end ?? off;
          } else {
            this.s.caret = off;
            if (!e.shift) this.s.anchor = off;
          }
          this.s.node = hit;
          app.textEditor = this.s;
          this.s.goalX = null;
          this.s.pending = null;
          this.dragSel = true;
          this.#focus();
          app.emit("textcaret");
          app.requestOverlay();
          return;
        }
      }
    }
    const hit = pick(app.context, e.x, e.y, 4 / app.view.zoom, { deep: true });
    if (hit && hit.type === "text" && !hit.locked) {
      this.edit(hit, e);
      this.dragSel = true;
      return;
    }
    // empty canvas: finish editing and start a new text object
    this.end();
    app.clearSelection();
    this.createDrag = { x0: e.x, y0: e.y, x1: e.x, y1: e.y, sx: e.sx, sy: e.sy, page: e.page };
  }

  pointerMove(e) {
    if (this.createDrag) {
      this.createDrag.x1 = e.x;
      this.createDrag.y1 = e.y;
      this.app.requestOverlay();
    } else if (this.dragSel && this.s) {
      const off = this.#offsetAt(e);
      if (off != null) {
        this.s.caret = off;
        this.app.emit("textcaret");
        this.app.requestOverlay();
      }
    }
  }

  pointerUp(e) {
    if (this.createDrag) {
      const d = this.createDrag;
      this.createDrag = null;
      const dragged = Math.hypot(e.sx - d.sx, e.sy - d.sy) > 8;
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0);
      const hh = Math.abs(d.y1 - d.y0);
      if (dragged || this.frameMode) this.pending = { x: dragged ? x : d.x0, y: dragged ? y : d.y0, w: dragged ? Math.max(w, 24) : 320, h: dragged ? Math.max(hh, 24) : 160, frame: true };
      else this.pending = { x: d.x0, y: d.y0 - currentTextStyle(this.app).char.fontSize * 0.9, w: null, h: null, frame: false };
      this.#focus();
    }
    this.dragSel = false;
    this.app.requestOverlay();
  }

  doubleClick() {
    // word / paragraph selection is handled through the click count in pointerDown
  }

  // ------------------------------------------------------------------ keyboard & input

  #keydown(e) {
    if (e.isComposing) return;
    const app = this.app;
    const mod = isMod(e);
    const s = this.s;
    const key = e.key;
    const story = s ? this.#entry().story : null;

    if (key === "Escape") {
      e.preventDefault();
      this.end(true);
      app.setTool("move");
      return;
    }
    if (mod && !e.altKey) {
      const k = key.toLowerCase();
      if (k === "a" && s) {
        e.preventDefault();
        s.anchor = 0;
        s.caret = this.#len();
        return this.#moved();
      }
      if ((k === "b" || k === "i" || k === "u") && (s || this.pending)) {
        e.preventDefault();
        const f = currentFormat(app)?.char || currentTextStyle(app).char;
        if (k === "b") applyCharFormat(app, { fontWeight: (f.fontWeight || 400) >= 600 ? 400 : 700 });
        else if (k === "i") applyCharFormat(app, { fontStyle: f.fontStyle === "italic" ? "normal" : "italic" });
        else applyCharFormat(app, { underline: !f.underline });
        app.emit("textcaret");
        return;
      }
      if (["c", "x", "v"].includes(k)) return; // native clipboard events
      if (k === "z" || k === "y" || !["a", "b", "i", "u"].includes(k)) {
        if (app.handleShortcut?.(e)) {
          e.preventDefault();
          requestAnimationFrame(() => this.refresh());
        }
        return;
      }
    }
    if (!s) {
      if (key === "Enter" || key === "Tab") e.preventDefault();
      return;
    }
    const len = this.#len();
    const sel = s.caret !== s.anchor;
    const move = (to, keepGoal = false) => {
      s.caret = Math.max(0, Math.min(len, to));
      if (!e.shiftKey) s.anchor = s.caret;
      if (!keepGoal) s.goalX = null;
      this.#moved();
    };
    switch (key) {
      case "ArrowLeft":
        e.preventDefault();
        if (sel && !e.shiftKey) move(Math.min(s.caret, s.anchor));
        else move(mod ? wordBoundary(story, s.caret, -1) : s.caret - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (sel && !e.shiftKey) move(Math.max(s.caret, s.anchor));
        else move(mod ? wordBoundary(story, s.caret, 1) : s.caret + 1);
        break;
      case "ArrowUp":
      case "ArrowDown": {
        e.preventDefault();
        const lay = this.#layout();
        if (!lay) break;
        const r = moveCaretVertical(lay.result, s.caret, key === "ArrowUp" ? -1 : 1, s.goalX);
        s.goalX = r.goalX;
        move(r.offset, true);
        break;
      }
      case "Home": {
        e.preventDefault();
        const lay = this.#layout();
        move(mod ? 0 : lay ? lineStart(lay.result, s.caret) : 0);
        break;
      }
      case "End": {
        e.preventDefault();
        const lay = this.#layout();
        move(mod ? len : lay ? lineEnd(lay.result, s.caret) : len);
        break;
      }
      case "Backspace":
      case "Delete": {
        e.preventDefault();
        if (sel) return this.#deleteSelection();
        const from = key === "Backspace" ? (mod ? wordBoundary(story, s.caret, -1) : s.caret - 1) : s.caret;
        const to = key === "Backspace" ? s.caret : mod ? wordBoundary(story, s.caret, 1) : s.caret + 1;
        if (from < 0 || to > len || from === to) return;
        this.#commit(T.deleteRange(story, from, to), from, from);
        break;
      }
      case "Enter":
        e.preventDefault();
        this.#insert("\n");
        break;
      case "Tab":
        e.preventDefault();
        this.#insert("\t");
        break;
    }
  }

  #input(e) {
    const ta = this.input;
    if (e.isComposing) {
      // live composition preview: replace the composing range
      if (!this.s && !this.pending) return;
      const text = e.data ?? ta.value;
      if (!this.s) {
        this.#insert(text);
        this.comp = { start: this.s.caret - text.length, len: text.length };
        return;
      }
      const comp = this.comp || (this.comp = { start: this.s.caret, len: 0 });
      const story = this.#entry().story;
      const next = T.insertText(T.deleteRange(story, comp.start, comp.start + comp.len), comp.start, text, this.s.pending ? { ...this.s.pending } : undefined);
      comp.len = text.length;
      this.#commit(next, comp.start + text.length, comp.start + text.length);
      return;
    }
    const text = e.data ?? ta.value;
    ta.value = "";
    if (text) this.#insert(text);
  }

  #deleteSelection() {
    const s = this.s;
    if (!s || s.caret === s.anchor) return;
    const from = Math.min(s.caret, s.anchor);
    const to = Math.max(s.caret, s.anchor);
    this.#commit(T.deleteRange(this.#entry().story, from, to), from, from);
  }

  #insert(text) {
    text = T.normalizeInputText ? T.normalizeInputText(text) : text;
    if (!text) return;
    if (!this.s && this.pending) {
      const p = this.pending;
      this.pending = null;
      const style = currentTextStyle(this.app);
      const node = addTextNode(this.app, { text: "", x: p.x, y: p.y, w: p.w, h: p.h, label: "Add Text", defaults: { char: { ...style.char }, para: { ...style.para } } });
      this.edit(node);
    }
    const s = this.s;
    if (!s) return;
    let story = this.#entry().story;
    let at = Math.min(s.caret, s.anchor);
    if (s.caret !== s.anchor) {
      story = T.deleteRange(story, at, Math.max(s.caret, s.anchor));
    }
    const next = T.insertText(story, at, text, s.pending ? { ...T.getAttrsAt(story, at), ...s.pending } : undefined);
    at += text.length;
    this.#commit(next, at, at);
  }

  #commit(story, caret, anchor) {
    const s = this.s;
    this.doc.setStory(s.node.storyId, story, "Edit Text", { coalesce: `type:${s.node.storyId}` });
    s.caret = caret;
    s.anchor = anchor;
    s.goalX = null;
    this.#moved(true);
  }

  #moved(edited = false) {
    this.blink = true;
    this.app.emit("textcaret");
    this.app.requestOverlay();
    if (edited) this.app.requestRender();
    this.s.pending = edited ? this.s.pending : null;
  }

  #copy(e, cut) {
    const s = this.s;
    if (!s || s.caret === s.anchor) return;
    e.preventDefault();
    const from = Math.min(s.caret, s.anchor);
    const to = Math.max(s.caret, s.anchor);
    const entry = this.#entry();
    const slice = T.sliceStory(entry.story, from, to);
    e.clipboardData.setData("text/plain", T.plainText(slice));
    e.clipboardData.setData("text/html", T.storyToHTML(slice, this.doc.styles));
    e.clipboardData.setData("application/x-openfini-story", JSON.stringify(T.storyToJSON(slice)));
    if (cut) this.#deleteSelection();
  }

  #paste(e) {
    e.preventDefault();
    const cd = e.clipboardData;
    const rich = cd.getData("application/x-openfini-story");
    if (rich && this.s) {
      try {
        const other = T.storyFromJSON(JSON.parse(rich));
        let story = this.#entry().story;
        let at = Math.min(this.s.caret, this.s.anchor);
        if (this.s.caret !== this.s.anchor) story = T.deleteRange(story, at, Math.max(this.s.caret, this.s.anchor));
        const next = T.insertStory(story, at, other);
        const added = T.storyLength(next) - T.storyLength(story);
        return this.#commit(next, at + added, at + added);
      } catch {
        /* fall back to plain text */
      }
    }
    const text = cd.getData("text/plain");
    if (text) this.#insert(text);
  }

  // ------------------------------------------------------------------ overlay

  overlay(ctx) {
    const app = this.app;
    const view = app.view;
    ctx.save();
    if (this.createDrag) {
      const d = this.createDrag;
      const [x0, y0] = app.pageToScreen(d.x0, d.y0, d.page);
      const [x1, y1] = app.pageToScreen(d.x1, d.y1, d.page);
      ctx.strokeStyle = ACCENT;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    if (this.pending && this.blink) {
      const p = this.pending;
      const [sx, sy] = app.pageToScreen(p.x, p.y);
      const size = currentTextStyle(app).char.fontSize * view.zoom;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      if (p.frame) ctx.strokeRect(sx + 0.5, sy + 0.5, p.w * view.zoom, p.h * view.zoom);
      ctx.beginPath();
      ctx.moveTo(sx + 1, sy + 2);
      ctx.lineTo(sx + 1, sy + size * 1.1);
      ctx.stroke();
    }
    const s = this.s;
    if (s) {
      const lay = this.#layout();
      if (lay) {
        // frame outlines
        for (const f of lay.frames) {
          const b = f._bounds;
          if (!b) continue;
          const W = worldMatrix(f);
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].forEach(([x, y], i) => {
            const [px, py] = apply(W, x, y);
            const [qx, qy] = app.pageToScreen(px, py, f._page);
            ctx[i ? "lineTo" : "moveTo"](qx, qy);
          });
          ctx.closePath();
          ctx.stroke();
        }
        const toScreen = (frameIdx, x, y) => {
          const f = lay.frames[frameIdx] || s.node;
          const [px, py] = apply(worldMatrix(f), x, y);
          return app.pageToScreen(px, py, f._page);
        };
        if (s.caret !== s.anchor) {
          const rects = selectionRects(lay.result, Math.min(s.caret, s.anchor), Math.max(s.caret, s.anchor));
          ctx.fillStyle = "rgba(139,124,246,0.32)";
          for (const r of rects) {
            const f = lay.frames[r.frame] || s.node;
            const W = worldMatrix(f);
            const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => {
              const [px, py] = apply(W, x, y);
              return app.pageToScreen(px, py, f._page);
            });
            ctx.beginPath();
            pts.forEach((p, i) => ctx[i ? "lineTo" : "moveTo"](p[0], p[1]));
            ctx.closePath();
            ctx.fill();
          }
        }
        const c = offsetToCaret(lay.result, s.caret);
        if (c && this.blink) {
          const a = toScreen(c.frame, c.x, c.y);
          const b = toScreen(c.frame, c.x, c.y + c.height);
          ctx.strokeStyle = "#111";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}

export class FrameTextTool extends TextTool {
  static id = "frame-text";
  static label = "Text Frame";
  static icon = "of:frame-text";
  static shortcut = "T";
  static studios = ["layout"];
  static group = "text";
  frameMode = true;
}

export { cssColor };
