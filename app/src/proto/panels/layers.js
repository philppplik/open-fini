// The Layers panel of the Proto Studio (docs/concepts/proto-studio.md §5.3): the tree of the current page, top of
// the list = in front. Virtualized (only the rows in view exist, so pages with tens of thousands of layers stay
// fast), with search, rename (double-click, F2 or Enter), show/hide and lock/unlock buttons, drag to reorder and to
// move layers into other frames (they keep their places on the canvas), and full keyboard use (a roving tabindex on
// ARIA tree rows: arrows, Home/End, Shift+arrows to extend, Left/Right to close/open, Delete). Every change is one
// operation through the workspace (one undo step).
//
//   createLayersPanel(ws) → { el, render(force?) }
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { indexOf, pageKey, ancestors, isInside } from "../../engine/proto/tree.js";
import { isContainer } from "../../engine/proto/schema.js";
import * as E from "../tools/edit.js";

export const ICONS = { frame: "hash", rect: "square", ellipse: "circle", line: "slash-lg", vector: "bezier2", text: "fonts", image: "image", instance: "diamond", component: "grid", componentSet: "grid-3x3-gap", slot: "box" };
export const TYPE_LABELS = { frame: N_("Frame"), rect: N_("Rectangle"), ellipse: N_("Ellipse"), line: N_("Line"), vector: N_("Vector"), text: N_("Text"), image: N_("Image"), instance: N_("Instance"), component: N_("Component"), componentSet: N_("Component set"), slot: N_("Slot") };
const ROW_H = 26;
const OVERSCAN = 8;

/**
 * The visible rows of a page's tree: [{ id, depth, kids, setsize, pos }] (front-most first). With a `filter`, rows
 * whose name contains it and their ancestors, all open. Pure.
 */
export function layerRows(model, page, open, filter = "") {
  const ix = indexOf(model);
  const rows = [];
  const q = filter.trim().toLowerCase();
  let keep = null;
  if (q) {
    keep = new Set();
    for (const n of Object.values(model.nodes)) {
      if (n.page !== page || !String(n.name || "").toLowerCase().includes(q)) continue;
      keep.add(n.id);
      for (const a of ancestors(model, n.id)) keep.add(a);
    }
  }
  const visit = (key, depth) => {
    const ids = ix.get(key).filter((id) => !keep || keep.has(id));
    for (let i = ids.length - 1; i >= 0; i--) {
      const n = model.nodes[ids[i]];
      if (!n) continue;
      const kids = ix.get(n.id).length;
      rows.push({ id: n.id, depth, kids, setsize: ids.length, pos: ids.length - i });
      if (kids && (keep || open.has(n.id))) visit(n.id, depth + 1);
    }
  };
  visit(pageKey(page), 0);
  return rows;
}

export function createLayersPanel(ws) {
  const search = h("input.of-proto-layers__search", { type: "search", placeholder: t("Search layers"), "aria-label": t("Search layers"), spellcheck: false });
  const spacer = h("div.of-proto-layers__spacer");
  const marker = h("div.of-proto-layers__drop", { hidden: true });
  const list = h("div.of-proto-layers__list", { role: "tree", "aria-label": t("Layers"), "aria-multiselectable": "true" }, spacer, marker);
  const empty = h("div.of-empty.of-proto-layers__empty", { hidden: true }, t("This page is empty. Draw a frame with the Frame tool (F) or add one from the Insert menu."));
  const el = h("div.of-proto-layers", search, list, empty);
  const open = new Set();
  let rows = [];
  let key = null;
  let focusId = null;
  let anchor = null;
  let renaming = null;
  let drag = null;
  let suppressClick = false;
  let raf = 0;

  const model = () => ws.model();
  const nodeOf = (id) => model().nodes[id];
  const run = (op, label) => op && ws.apply(op, label);

  // ------------------------------------------------------------------------------------------- render
  function render(force = false) {
    const m = model();
    const sel = ws.selection;
    for (const id of sel) for (const a of ancestors(m, id)) open.add(a);
    const k = [ws.page, m.nodes, sel.join(","), [...open].join(","), search.value];
    if (!force && key && k.every((v, i) => v === key[i])) return;
    key = k;
    rows = layerRows(m, ws.page, open, search.value);
    spacer.style.height = `${rows.length * ROW_H}px`;
    empty.hidden = rows.length > 0 || !!search.value;
    // reveal the (last) selected row
    const last = sel[sel.length - 1];
    if (last && document.activeElement?.closest?.(".of-proto-layers") == null) {
      const i = rows.findIndex((r) => r.id === last);
      if (i >= 0) revealRow(i);
      focusId = last;
    }
    paint();
  }

  function revealRow(i) {
    const top = i * ROW_H;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_H > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW_H - list.clientHeight;
  }

  function paint() {
    const m = model();
    const sel = new Set(ws.selection);
    const h0 = list.clientHeight || 600;
    const start = Math.max(0, Math.floor(list.scrollTop / ROW_H) - OVERSCAN);
    const end = Math.min(rows.length, Math.ceil((list.scrollTop + h0) / ROW_H) + OVERSCAN);
    const hadFocus = list.contains(document.activeElement) && document.activeElement.classList.contains("of-proto-layers__row");
    const els = [];
    const tabbable = rows.some((r) => r.id === focusId) ? focusId : rows[0]?.id;
    for (let i = start; i < end; i++) els.push(row(m, rows[i], i, sel.has(rows[i].id), rows[i].id === tabbable));
    spacer.replaceChildren(...els);
    if (hadFocus) spacer.querySelector(`[data-id="${CSS.escape(focusId || "")}"]`)?.focus({ preventScroll: true });
  }

  function row(m, r, i, selected, tabbable) {
    const n = m.nodes[r.id];
    const isOpen = open.has(r.id) || !!search.value;
    const twisty = r.kids
      ? h("button.of-proto-layers__twisty", { type: "button", tabIndex: -1, "aria-hidden": "true", dataset: { act: "twisty" } }, h("sl-icon", { name: isOpen ? "chevron-down" : "chevron-right" }))
      : h("span.of-proto-layers__twisty");
    const name =
      renaming === r.id
        ? renameInput(n)
        : h("span.of-proto-layers__name", n.name || t(TYPE_LABELS[n.type] || "Layer"));
    const hidden = n.visible === false;
    const flag = (act, on, icon, label) => h("button.of-proto-layers__flag", { type: "button", tabIndex: -1, class: on ? "is-on" : "", "aria-label": label, "data-tip": label, dataset: { act } }, h("sl-icon", { name: icon }));
    const el = h(
      "div.of-proto-layers__row",
      {
        role: "treeitem",
        tabIndex: tabbable ? 0 : -1,
        "aria-level": String(r.depth + 1),
        "aria-setsize": String(r.setsize),
        "aria-posinset": String(r.pos),
        "aria-selected": String(selected),
        ...(r.kids ? { "aria-expanded": String(isOpen) } : {}),
        style: { top: `${i * ROW_H}px`, paddingLeft: `${4 + r.depth * 14}px` },
        dataset: { id: r.id, i: String(i) },
      },
      twisty,
      h("sl-icon.of-proto-layers__icon", { name: ICONS[n.type] || "square" }),
      name,
      flag("lock", n.locked, n.locked ? "lock" : "unlock", n.locked ? t("Unlock") : t("Lock")),
      flag("eye", hidden, hidden ? "eye-slash" : "eye", hidden ? t("Show") : t("Hide")),
    );
    if (selected) el.classList.add("is-selected");
    if (hidden) el.classList.add("is-hidden");
    if (n.locked) el.classList.add("is-locked");
    return el;
  }

  function renameInput(n) {
    const input = h("input.of-proto-layers__rename", { type: "text", value: n.name || "", "aria-label": t("Layer name"), spellcheck: false });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      renaming = null;
      const v = input.value.trim();
      if (commit && v && v !== n.name) run({ op: "node.update", id: n.id, set: { name: v.slice(0, 256) } }, t("Rename layer"));
      render(true);
      spacer.querySelector(`[data-id="${CSS.escape(n.id)}"]`)?.focus({ preventScroll: true });
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return input;
  }

  /** Starts renaming a layer (F2, Enter, a double click, Object ▸ Rename). */
  function rename(id) {
    if (ws.readOnly || !nodeOf(id)) return;
    for (const a of ancestors(model(), id)) open.add(a);
    renaming = id;
    render(true);
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) revealRow(i);
    paint();
  }

  // ------------------------------------------------------------------------------------------- input
  const rowOf = (e) => e.target.closest?.(".of-proto-layers__row");
  function toggle(id) {
    if (open.has(id)) open.delete(id);
    else open.add(id);
    render(true);
  }
  function toggleField(id, f) {
    const n = nodeOf(id);
    if (!n || ws.readOnly) return;
    const ids = ws.selection.includes(id) ? ws.selection : [id];
    if (f === "visible") run(E.setFields(model(), ids, { visible: n.visible === false }), n.visible === false ? t("Show layers") : t("Hide layers"));
    else run(E.setFields(model(), ids, { locked: !n.locked }), n.locked ? t("Unlock layers") : t("Lock layers"));
  }
  function selectRange(id) {
    const a = rows.findIndex((r) => r.id === (anchor || id));
    const b = rows.findIndex((r) => r.id === id);
    if (a < 0 || b < 0) return ws.select([id]);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    ws.select(rows.slice(lo, hi + 1).map((r) => r.id));
  }

  list.addEventListener("click", (e) => {
    if (suppressClick) return void (suppressClick = false);
    const r = rowOf(e);
    if (!r || e.target.closest(".of-proto-layers__rename")) return;
    const id = r.dataset.id;
    const act = e.target.closest("[data-act]")?.dataset.act;
    focusId = id;
    if (act === "twisty") return toggle(id);
    if (act === "eye") return toggleField(id, "visible");
    if (act === "lock") return toggleField(id, "locked");
    if (e.shiftKey) selectRange(id);
    else if (e.ctrlKey || e.metaKey) ws.select([id], { toggle: true });
    else ws.select([id]);
    if (!e.shiftKey) anchor = id;
    r.focus({ preventScroll: true });
  });
  list.addEventListener("dblclick", (e) => {
    const r = rowOf(e);
    if (!r || e.target.closest("[data-act]")) return;
    if (e.target.closest(".of-proto-layers__name")) rename(r.dataset.id);
    else ws.zoomToSelection();
  });
  list.addEventListener("scroll", () => {
    if (!raf) raf = requestAnimationFrame(() => ((raf = 0), paint()));
  });
  search.addEventListener("input", () => render(true));
  search.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      spacer.querySelector(".of-proto-layers__row")?.focus();
    }
  });

  list.addEventListener("keydown", (e) => {
    const r = rowOf(e);
    if (!r || e.target.closest(".of-proto-layers__rename")) return;
    const i = rows.findIndex((x) => x.id === r.dataset.id);
    const cur = rows[i];
    const go = (j, extend = false) => {
      const k = Math.max(0, Math.min(rows.length - 1, j));
      const next = rows[k];
      if (!next) return;
      focusId = next.id;
      if (extend) selectRange(next.id);
      else {
        anchor = next.id;
        ws.select([next.id]);
      }
      revealRow(k);
      paint();
      spacer.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.focus({ preventScroll: true });
    };
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        go(i + 1, e.shiftKey);
        break;
      case "ArrowUp":
        go(i - 1, e.shiftKey);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(rows.length - 1);
        break;
      case "ArrowRight":
        if (cur.kids && !open.has(cur.id)) toggle(cur.id);
        else if (cur.kids) go(i + 1);
        break;
      case "ArrowLeft":
        if (cur.kids && open.has(cur.id)) toggle(cur.id);
        else {
          const p = nodeOf(cur.id)?.parent;
          const j = rows.findIndex((x) => x.id === p);
          if (j >= 0) go(j);
        }
        break;
      case "F2":
      case "Enter":
        rename(cur.id);
        break;
      case "Delete":
      case "Backspace":
        ws.deleteSelection();
        break;
      case " ":
        ws.select([cur.id], { toggle: true });
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // drag to reorder and reparent
  list.addEventListener("pointerdown", (e) => {
    const r = rowOf(e);
    if (!r || e.button !== 0 || e.target.closest("[data-act]") || e.target.closest(".of-proto-layers__rename") || ws.readOnly) return;
    drag = { id: r.dataset.id, y0: e.clientY, active: false, pointer: e.pointerId, target: null };
  });
  list.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientY - drag.y0) < 4) return;
      drag.active = true;
      if (!ws.selection.includes(drag.id)) ws.select([drag.id]);
      drag.ids = ws.selection.slice();
      list.setPointerCapture(e.pointerId);
      list.classList.add("is-dragging");
    }
    drag.target = dropTarget(e);
    showMarker(drag.target);
  });
  const endDrag = (e) => {
    const d = drag;
    drag = null;
    marker.hidden = true;
    list.classList.remove("is-dragging");
    if (!d?.active) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    if (list.hasPointerCapture?.(e.pointerId)) list.releasePointerCapture(e.pointerId);
    if (!d.target || e.type === "pointercancel") return;
    const m = model();
    const tg = d.target;
    const ref = m.nodes[tg.id];
    if (!ref) return;
    let op;
    if (tg.where === "inside") op = E.reparent(m, d.ids, ref.id, { page: ref.page }, ws.box);
    // above a row = in front of it = after it in the model's order
    else op = E.reparent(m, d.ids, ref.parent ?? null, { page: ref.page, [tg.where === "above" ? "after" : "before"]: ref.id }, ws.box);
    if (op) {
      if (tg.where === "inside") open.add(ref.id);
      ws.apply(op, t("Move layers"));
    }
  };
  list.addEventListener("pointerup", endDrag);
  list.addEventListener("pointercancel", endDrag);

  function dropTarget(e) {
    const rect = list.getBoundingClientRect();
    const y = e.clientY - rect.top + list.scrollTop;
    const i = Math.max(0, Math.min(rows.length - 1, Math.floor(y / ROW_H)));
    const r = rows[i];
    if (!r) return null;
    const m = model();
    const n = m.nodes[r.id];
    // never into or next to itself, never into its own subtree
    if (drag.ids.some((id) => id === r.id || isInside(m, r.id, id))) return null;
    const f = (y - i * ROW_H) / ROW_H;
    const container = isContainer(n.type) && n.type !== "instance" && n.type !== "componentSet";
    let where = f < 0.3 ? "above" : f > 0.7 ? "below" : container ? "inside" : f < 0.5 ? "above" : "below";
    // below an open container's row is its first child's place: drop inside instead
    if (where === "below" && r.kids && open.has(r.id) && container) where = "inside";
    return { id: r.id, i, where, depth: r.depth };
  }

  function showMarker(tg) {
    if (!tg) return void (marker.hidden = true);
    marker.hidden = false;
    marker.classList.toggle("is-inside", tg.where === "inside");
    const top = tg.i * ROW_H;
    if (tg.where === "inside") Object.assign(marker.style, { top: `${top}px`, height: `${ROW_H}px`, left: `${4 + tg.depth * 14}px` });
    else Object.assign(marker.style, { top: `${tg.where === "above" ? top - 1 : top + ROW_H - 1}px`, height: "2px", left: `${4 + tg.depth * 14}px` });
  }

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => paint()) : null;
  ro?.observe(list);

  return { el, render, rename, focusSearch: () => search.focus() };
}
