// Text tool and in-place text editing of the Proto Studio (T; docs/concepts/proto-studio.md §4.1, §5.2). A click
// starts a text that grows with its content (autoSize "width"), a drag one with a fixed width that wraps. Editing
// happens in the layer's own element inside its shadow root (contenteditable, plain text; paste is plain text): what
// you type is laid out exactly as the result. Escape, Ctrl/Cmd+Enter or a click elsewhere ends editing. A new text is
// previewed while you type and created as ONE undo step when you finish (nothing when it stays empty); editing an
// existing text is one step that keeps the styles of the runs you did not touch; an emptied text is deleted.
import { t } from "../../i18n/index.js";
import { DEFAULT_TEXT_STYLE } from "../../engine/proto/schema.js";
import { ancestors } from "../../engine/proto/tree.js";
import { newId } from "../../engine/proto/ids.js";
import * as E from "./edit.js";
import { placement } from "./draw.js";
import { outline } from "./common.js";

/** The layer name a text gets from its content (the first line, at most 40 characters). */
export const nameFromText = (text) => (String(text).split("\n").find((l) => l.trim()) || "").trim().slice(0, 40) || "Text";

export function createTextTool(ws) {
  let st = null;
  return {
    id: "text",
    cursor: "text",
    down({ e, stage: p, world: w }) {
      if (ws.readOnly || e.button !== 0) return false;
      st = { p0: p, w0: w, w1: w };
      return true;
    },
    move({ world: w }) {
      if (!st) return;
      st.w1 = w;
      ws.requestDraw();
    },
    hover() {
      ws.setHover(null);
    },
    up({ stage: p }) {
      const s = st;
      st = null;
      if (!s) return;
      const drag = Math.hypot(p.x - s.p0.x, p.y - s.p0.y) > 4;
      const x0 = drag ? Math.min(s.w0.x, s.w1.x) : s.w0.x;
      const y0 = drag ? Math.min(s.w0.y, s.w1.y) : s.w0.y - 12; // a click puts the first line's middle at the pointer
      const where = placement(ws, { x: x0 + 0.5, y: y0 + 0.5 });
      const pb = where.parent != null ? ws.box(where.parent) || { x: 0, y: 0 } : { x: 0, y: 0 };
      const model = ws.model();
      const fields = {
        name: "Text",
        w: drag ? { mode: "fixed", value: Math.max(8, Math.round(Math.abs(s.w1.x - s.w0.x))) } : { mode: "hug" },
        h: { mode: "hug" },
        text: { runs: [{ t: "", s: {} }], style: { ...DEFAULT_TEXT_STYLE, lineHeight: { pct: 150 } }, autoSize: drag ? "height" : "width", maxLines: null },
      };
      if (!where.flow) Object.assign(fields, { x: Math.round(x0 - pb.x), y: Math.round(y0 - pb.y) });
      const op = { op: "node.create", type: "text", id: newId("n", model.nodes), page: ws.page, parent: where.parent, fields };
      if (where.index !== undefined) op.index = where.index;
      ws.tools.set("move");
      startTextEdit(ws, op.id, { create: op });
    },
    draw(ctx, s) {
      if (!st) return;
      const r = { x: Math.min(st.w0.x, st.w1.x), y: Math.min(st.w0.y, st.w1.y), w: Math.abs(st.w1.x - st.w0.x), h: Math.abs(st.w1.y - st.w0.y) };
      if (r.w * s.cam.zoom > 4) outline(ctx, s.cam, r, s.accent || "#0d99ff", { dash: true });
    },
    deactivate() {
      st = null;
    },
  };
}

/**
 * Edits the text of layer `id` in place. `create`: the node.create operation of a new text, previewed until editing
 * ends. Returns false when the layer is not on screen.
 */
export function startTextEdit(ws, id, { create = null } = {}) {
  if (ws.editing) ws.editing.finish();
  let model = ws.model();
  if (create) {
    const res = ws.preview(create);
    if (!res) return false;
    model = res.model;
  }
  const node = model.nodes[id];
  const el = ws.view.elementOf(id);
  if (!node || !el) {
    if (create) ws.preview(null);
    return false;
  }
  const root = [id, ...ancestors(model, id)].pop();
  const before = E.plainText(node);
  el.setAttribute("contenteditable", "plaintext-only");
  if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
  el.setAttribute("spellcheck", "false");
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-multiline", "true");
  el.setAttribute("aria-label", t("Text"));
  const keep = el.getAttribute("style") || "";
  Object.assign(el.style, { pointerEvents: "auto", userSelect: "text", webkitUserSelect: "text", cursor: "text", outline: "none", minWidth: "2px", minHeight: "1em" });
  if (create) el.textContent = "";

  const stop = (e) => e.stopPropagation();
  const onKey = (e) => {
    e.stopPropagation(); // the app's single-key shortcuts must not fire while typing
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      finish();
    }
  };
  const onPaste = (e) => {
    if (el.getAttribute("contenteditable") === "plaintext-only") return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
  };
  const onInput = () => ws.view.remeasure(root);
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    el.removeEventListener("keydown", onKey);
    el.removeEventListener("keyup", stop);
    el.removeEventListener("keypress", stop);
    el.removeEventListener("blur", finish);
    el.removeEventListener("paste", onPaste);
    el.removeEventListener("input", onInput);
    let text = el.innerText ?? el.textContent ?? "";
    text = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
    for (const a of ["contenteditable", "spellcheck", "role", "aria-multiline", "aria-label"]) el.removeAttribute(a);
    el.setAttribute("style", keep);
    ws.setEditing(null);
    if (create) {
      ws.preview(null);
      if (!text.trim()) return;
      const op = { ...create, fields: { ...create.fields, name: nameFromText(text), text: { ...create.fields.text, runs: [{ t: text, s: {} }] } } };
      const res = ws.apply(op, t("Add text"));
      if (res) ws.select([id]);
      return;
    }
    ws.view.invalidate(root);
    const cur = ws.model();
    const n = cur.nodes[id];
    if (!n) return;
    if (!text.length) {
      ws.apply({ op: "node.delete", ids: [id] }, t("Delete layers"));
      return;
    }
    const op = E.editText(cur, id, text);
    if (!op) return;
    // a layer named after its text keeps following it
    if (n.name === nameFromText(before) || n.name === "Text") op.set.name = nameFromText(text);
    ws.apply(op, t("Edit text"));
  }
  el.addEventListener("keydown", onKey);
  el.addEventListener("keyup", stop);
  el.addEventListener("keypress", stop);
  el.addEventListener("blur", finish);
  el.addEventListener("paste", onPaste);
  el.addEventListener("input", onInput);
  ws.setEditing({ id, el, root, finish, creating: !!create });
  el.focus({ preventScroll: true });
  try {
    const sel = el.getRootNode().getSelection?.() || window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* selecting the text is a convenience */
  }
  return true;
}
