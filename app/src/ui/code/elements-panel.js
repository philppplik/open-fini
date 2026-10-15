// "Add" pane: the element and section catalog. Click inserts at the selection, dragging drops onto the canvas.
import { h, empty } from "../../core/util.js";
import { ELEMENT_CATEGORIES } from "../../engine/web/index.js";
import { fuzzyScore } from "./util.js";

export function createElementsPanel(ws) {
  const search = h("input.of-side__search", { type: "search", placeholder: "Search elements…", spellcheck: false, "aria-label": "Search elements" });
  const body = h("div.of-add");
  const head = h("div.of-side__head", h("span.of-side__title", "Add elements"));
  const hint = h("div.of-side__foot", "Click to insert after the selection, or drag onto the canvas.");
  const el = h("div.of-side__pane.of-addpane", head, h("div.of-side__searchrow", search), body, hint);

  function tile(def) {
    const t = h("button.of-addtile", { type: "button", title: def.description, "data-id": def.id }, h("sl-icon", { name: def.icon || "square" }), h("span", def.label));
    t.addEventListener("pointerdown", (ev) => startDrag(ev, def, t));
    t.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ws.insertElement(def);
      }
    });
    return t;
  }

  function render() {
    empty(body);
    const q = search.value.trim();
    for (const cat of ELEMENT_CATEGORIES) {
      const items = q ? cat.items.filter((i) => fuzzyScore(q, `${i.label} ${cat.label} ${i.id}`) >= 0) : cat.items;
      if (!items.length) continue;
      body.append(h("details.of-addcat", { open: true }, h("summary", cat.label), h("div.of-addgrid", items.map(tile))));
    }
    if (!body.children.length) body.append(h("div.of-empty", `No elements match “${q}”.`));
  }
  search.addEventListener("input", render);
  search.addEventListener("keydown", (e) => e.stopPropagation());

  // pointer-based drag so the drop can be tracked across the preview iframe
  function startDrag(ev, def, tileEl) {
    if (ev.button !== 0) return;
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    let dragging = false;
    let target = null;
    let probing = false;
    let ghost = null;
    tileEl.setPointerCapture?.(ev.pointerId);
    const move = async (m) => {
      if (!dragging && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) > 6) {
        dragging = true;
        ghost = h("div.of-addghost", h("sl-icon", { name: def.icon || "square" }), def.label);
        document.body.append(ghost);
        if (ws.view === "code") ws.setView("split");
      }
      if (!dragging) return;
      ghost.style.left = `${m.clientX + 12}px`;
      ghost.style.top = `${m.clientY + 8}px`;
      if (probing) return;
      probing = true;
      try {
        target = await ws.preview.dropProbe(m.clientX, m.clientY);
      } finally {
        probing = false;
      }
    };
    const up = (u) => {
      tileEl.removeEventListener("pointermove", move);
      tileEl.removeEventListener("pointerup", up);
      tileEl.removeEventListener("pointercancel", up);
      ghost?.remove();
      ws.preview.dropEnd();
      if (!dragging) return ws.insertElement(def);
      if (ws.preview.toFrame(u.clientX, u.clientY) && target) ws.insertElement(def, target.parentId, target.index);
    };
    tileEl.addEventListener("pointermove", move);
    tileEl.addEventListener("pointerup", up);
    tileEl.addEventListener("pointercancel", up);
  }

  render();
  return { el, render, show: () => search.focus() };
}
