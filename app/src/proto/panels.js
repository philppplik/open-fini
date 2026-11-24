// Dockable panels of the Proto Studio in T3: a basic Layers tree and a minimal Inspector. They are slot panels
// (ui/panels/slots.js): the workspace publishes their elements, the docking engine places them. The full Layers,
// Pages and Design panels (rename, reorder, lock, every field of the schema) come with T4.
//
//   createLayersPanel(ws) → { el, render() }      tree of the current page; click selects, Shift/Ctrl-click adds
//   createInspector(ws) → { el, render() }        name, type, position and size of the selection (read-only)
import { h } from "../core/util.js";
import { t, N_ } from "../i18n/index.js";
import { indexOf, pageKey, ancestors } from "../engine/proto/tree.js";
import { unionRect } from "./geometry.js";

const ICONS = { frame: "hash", rect: "square", ellipse: "circle", line: "slash-lg", vector: "bezier2", text: "fonts", image: "image", instance: "diamond", component: "grid", componentSet: "grid-3x3-gap", slot: "box" };
const TYPE_LABELS = { frame: N_("Frame"), rect: N_("Rectangle"), ellipse: N_("Ellipse"), line: N_("Line"), vector: N_("Vector"), text: N_("Text"), image: N_("Image"), instance: N_("Instance"), component: N_("Component"), componentSet: N_("Component set"), slot: N_("Slot") };
/** Rows rendered at most (the full, virtualized tree comes with T4). */
const MAX_ROWS = 2000;

export function createLayersPanel(ws) {
  const list = h("div.of-proto-layers__list", { role: "tree", "aria-label": t("Layers"), "aria-multiselectable": "true" });
  const el = h("div.of-proto-layers", list);
  const open = new Set();
  let key = "";

  const toggle = (id) => {
    if (open.has(id)) open.delete(id);
    else open.add(id);
    render(true);
  };

  function row(n, depth, hasKids, selected) {
    const twisty = hasKids
      ? h("button.of-proto-layers__twisty", { type: "button", tabIndex: -1, "aria-label": open.has(n.id) ? t("Collapse") : t("Expand") }, h("sl-icon", { name: open.has(n.id) ? "chevron-down" : "chevron-right" }))
      : h("span.of-proto-layers__twisty");
    const r = h(
      "div.of-proto-layers__row",
      { role: "treeitem", tabIndex: selected ? 0 : -1, "aria-level": String(depth + 1), "aria-selected": String(selected), ...(hasKids ? { "aria-expanded": String(open.has(n.id)) } : {}), style: { paddingLeft: `${4 + depth * 14}px` }, dataset: { id: n.id } },
      twisty,
      h("sl-icon", { name: ICONS[n.type] || "square" }),
      h("span.of-proto-layers__name", n.name || t(TYPE_LABELS[n.type] || "Layer")),
      n.visible === false ? h("sl-icon.of-proto-layers__flag", { name: "eye-slash", label: t("Hidden") }) : null,
      n.locked ? h("sl-icon.of-proto-layers__flag", { name: "lock", label: t("Locked") }) : null,
    );
    if (selected) r.classList.add("is-selected");
    return r;
  }

  list.addEventListener("click", (e) => {
    const r = e.target.closest(".of-proto-layers__row");
    if (!r) return;
    const id = r.dataset.id;
    if (e.target.closest(".of-proto-layers__twisty") && e.target.closest("button")) return toggle(id);
    ws.select([id], { toggle: e.ctrlKey || e.metaKey, add: e.shiftKey });
  });
  list.addEventListener("dblclick", (e) => {
    const r = e.target.closest(".of-proto-layers__row");
    if (r) ws.zoomToSelection();
  });
  list.addEventListener("keydown", (e) => {
    const r = e.target.closest(".of-proto-layers__row");
    if (!r) return;
    const rows = [...list.querySelectorAll(".of-proto-layers__row")];
    const i = rows.indexOf(r);
    const go = (j) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (next) ws.select([next.dataset.id]), next.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "ArrowRight" && !open.has(r.dataset.id)) toggle(r.dataset.id);
    else if (e.key === "ArrowLeft" && open.has(r.dataset.id)) toggle(r.dataset.id);
    else return;
    e.preventDefault();
  });

  function render(force = false) {
    const m = ws.model();
    const page = ws.page;
    const sel = new Set(ws.selection);
    // selected layers are revealed: their ancestors open
    for (const id of sel) for (const a of ancestors(m, id)) open.add(a);
    const k = [page, m.nodes, [...sel].join(","), [...open].join(",")];
    if (!force && key && key[0] === k[0] && key[1] === k[1] && key[2] === k[2] && key[3] === k[3]) return;
    key = k;
    const ix = indexOf(m);
    const rows = [];
    // top of the list = top of the z order (as in every design tool): children in reverse order
    const visit = (ids, depth) => {
      for (let i = ids.length - 1; i >= 0 && rows.length < MAX_ROWS; i--) {
        const n = m.nodes[ids[i]];
        if (!n) continue;
        const kids = ix.get(n.id);
        rows.push(row(n, depth, kids.length > 0, sel.has(n.id)));
        if (kids.length && open.has(n.id)) visit(kids, depth + 1);
      }
    };
    visit(ix.get(pageKey(page)), 0);
    if (!rows.length) rows.push(h("div.of-empty", t("This page is empty. Add a frame from the Insert menu.")));
    list.replaceChildren(...rows);
    list.querySelector(".is-selected")?.scrollIntoView?.({ block: "nearest" });
  }

  return { el, render: () => render() };
}

export function createInspector(ws) {
  const el = h("div.of-proto-inspector");
  let key = null;
  const field = (label, value) => h("div.of-proto-inspector__row", h("span", label), h("output", value));
  function render() {
    const m = ws.model();
    const sel = ws.selection;
    const boxes = sel.map((id) => ws.view.geo.get(id)).filter(Boolean);
    const k = [m.nodes, sel.join(","), boxes.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join(";")].join("|");
    if (k === key) return;
    key = k;
    if (!sel.length) {
      el.replaceChildren(h("p.of-empty", t("Select a layer to see its properties.")), h("p.of-proto-inspector__note", t("Editing properties comes with the Design panel in a later update of this preview.")));
      return;
    }
    const u = unionRect(boxes);
    const fmt = (v) => (u ? String(Math.round(v * 100) / 100) : "–");
    const rows = [];
    if (sel.length === 1) {
      const n = m.nodes[sel[0]];
      rows.push(field(t("Name"), n?.name || ""), field(t("Type"), t(TYPE_LABELS[n?.type] || "Layer")));
    } else rows.push(field(t("Selection"), t("{n} layers", { n: sel.length })));
    rows.push(field("X", fmt(u?.x)), field("Y", fmt(u?.y)), field(t("Width"), fmt(u?.w)), field(t("Height"), fmt(u?.h)));
    el.replaceChildren(h("div.of-proto-inspector__grid", ...rows), h("p.of-proto-inspector__note", t("Editing properties comes with the Design panel in a later update of this preview.")));
  }
  return { el, render };
}
