// The Assets panel of the Proto Studio (docs/concepts/proto-studio.md §5.3, task T6; dock id "proto-assets"): the
// components and component sets of the design with previews, the styles, and a search field. Drag a component onto the
// canvas (or press Enter on it) to insert an instance; the buttons above the list create a component from the selection
// or combine selected components as variants; a style click applies it to the selection. Previews are drawn from the
// layout solver (proto/ai-render.js, approximate like the assistant's screenshots) and cached per component revision.
// Every change is one operation through the workspace (one undo step).
//
//   createAssetsPanel(ws) → { el, render(force?) }
import { h } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import * as P from "./model.js";
import { menuPopover } from "./binding.js";
import { paintList, paintCanvas } from "../ai-render.js";
import { placement } from "../tools/draw.js";
import { indexOf } from "../../engine/proto/tree.js";
import { promptDialog, confirmDialog } from "../../ui/dialogs.js";

export const DRAG_TYPE = "application/x-openfini-proto-component";
const THUMB = 56;
const KIND_LABELS = { fill: N_("Color styles"), text: N_("Text styles"), effect: N_("Effect styles"), grid: N_("Grid styles") };
const SLOT_OF = { fill: "fill", text: "text", effect: "effect", grid: "grid" };

export function createAssetsPanel(ws) {
  const el = h("div.of-proto-assets", { role: "region", "aria-label": t("Assets") });
  const search = h("input.of-proto-assets__search", { type: "search", placeholder: t("Search assets"), "aria-label": t("Search assets"), spellcheck: false });
  const actions = h("div.of-proto-assets__actions");
  const list = h("div.of-proto-assets__list");
  el.append(h("div.of-proto-assets__bar", search), actions, list);
  const thumbs = new WeakMap(); // preview node → { key, url }
  let key = null;

  search.addEventListener("input", () => render(true));
  search.addEventListener("keydown", (e) => e.stopPropagation());

  const btn = (icon, label, onClick, { disabled = false, fld } = {}) => {
    const b = h("button.of-proto-design__tbtn", { type: "button", disabled, dataset: { field: fld || "" } }, h("sl-icon", { name: icon }), h("span", label));
    b.addEventListener("click", onClick);
    return b;
  };

  /** A preview of a component: the solver's display list painted into a small canvas, cached by the layers it shows. */
  function preview(m, id) {
    const n = m.nodes[id];
    if (!n) return h("span.of-proto-assets__thumb");
    const k = revisionKey(m, id);
    const hit = thumbs.get(n);
    let url = hit?.key === k ? hit.url : null;
    if (!url) {
      try {
        const lst = paintList(m, id);
        const scale = Math.min(THUMB / Math.max(1, lst.w), THUMB / Math.max(1, lst.h), 2) * (window.devicePixelRatio || 1);
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.ceil(lst.w * scale));
        c.height = Math.max(1, Math.ceil(lst.h * scale));
        paintCanvas(c.getContext("2d"), lst, { scale });
        url = c.toDataURL("image/png");
      } catch {
        url = "";
      }
      thumbs.set(n, { key: k, url });
    }
    return h("span.of-proto-assets__thumb", { "aria-hidden": "true" }, url ? h("img", { src: url, alt: "" }) : h("sl-icon", { name: "grid" }));
  }

  /** Identity of the layers a preview shows (the component and its subtree), so an unchanged component keeps its image. */
  function revisionKey(m, id) {
    const parts = [m.vars, m.styles];
    const ix = indexOf(m);
    const stack = [id];
    while (stack.length && parts.length < 2000) {
      const x = stack.pop();
      parts.push(m.nodes[x]);
      // instances inside show other components: their identity counts too
      if (m.nodes[x]?.type === "instance") parts.push(m.nodes[m.nodes[x].of]);
      stack.push(...ix.get(x));
    }
    return parts;
  }
  const sameKey = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

  function insertAtView(id) {
    const m = ws.model();
    const sel = ws.selection.map((x) => m.nodes[x]).filter(Boolean);
    const target = sel.length === 1 && ["frame", "component"].includes(sel[0].type) ? sel[0].id : null;
    let op;
    if (target) op = P.insertInstanceOp(m, id, { page: ws.page, parent: target, x: 0, y: 0 });
    else {
      const r = ws.view.stage.getBoundingClientRect();
      const c = ws.toWorld(r.width / 2, r.height / 2);
      op = P.insertInstanceOp(m, id, { page: ws.page, x: c.x, y: c.y });
    }
    const res = ws.apply(op, t("Insert instance"));
    if (res?.ids?.[0]) ws.select([res.ids[0]]);
  }

  function componentRow(m, a) {
    const row = h(
      "div.of-proto-assets__item",
      { role: "listitem", tabIndex: 0, draggable: !ws.readOnly, "aria-label": t("{name}: drag to the canvas or press Enter to insert", { name: a.name }), dataset: { id: a.id } },
      preview(m, a.preview || a.id),
      h("span.of-proto-assets__name", a.name, a.variants ? h("small", t("{n} variants", { n: a.variants })) : null, a.page !== ws.page ? h("small", a.pageName) : null),
    );
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(DRAG_TYPE, a.id);
      e.dataTransfer.setData("text/plain", a.name);
      e.dataTransfer.effectAllowed = "copy";
    });
    row.addEventListener("dblclick", () => insertAtView(a.id));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        insertAtView(a.id);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...list.querySelectorAll(".of-proto-assets__item")];
        items[items.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
      }
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      menuPopover({ x: e.clientX, y: e.clientY }, [
        { label: t("Insert instance"), icon: "plus-lg", run: () => insertAtView(a.id), disabled: ws.readOnly },
        { label: t("Go to main component"), icon: "box-arrow-up-right", run: () => ws.goTo(a.id) },
        { label: t("Swap selected instances"), icon: "arrow-left-right", disabled: ws.readOnly || !ws.selection.some((x) => ws.model().nodes[x]?.type === "instance"), run: () => swapSelection(a.id) },
      ], { label: a.name });
    });
    return row;
  }

  function swapSelection(of) {
    const m = ws.model();
    const ops = ws.selection.filter((x) => m.nodes[x]?.type === "instance").map((id) => ({ op: "instance.swap", id, of }));
    if (ops.length) ws.apply(ops.length === 1 ? ops[0] : { op: "batch", ops }, t("Swap instance"));
  }

  function styleRow(s) {
    const sw = s.kind === "fill" ? h("span.of-proto-swatch", { style: `--of-sw:${swatchOf(s.value)}` }) : h("sl-icon", { name: s.kind === "text" ? "type" : s.kind === "effect" ? "layers-half" : "grid-3x3" });
    const row = h("button.of-proto-assets__style", { type: "button", "aria-label": t("Apply the style {name} to the selection", { name: s.name }), dataset: { id: s.id } }, sw, h("span.of-proto-assets__name", s.name));
    row.addEventListener("click", () => {
      if (!ws.selection.length || ws.readOnly) return ws.app?.toast?.(t("Select layers to apply the style to."), "primary", 2000);
      ws.apply(P.applyStyleOp(ws.selection, SLOT_OF[s.kind], s.id), t("Apply style"));
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      menuPopover({ x: e.clientX, y: e.clientY }, [
        { label: t("Rename style…"), icon: "input-cursor-text", disabled: ws.readOnly, run: () => renameStyle(s) },
        { label: t("Update style from selection"), icon: "arrow-repeat", disabled: ws.readOnly || ws.selection.length !== 1, run: () => {
          const op = P.updateStyleFromOp(ws.model(), s.id, ws.selection[0]);
          if (op) ws.apply(op, t("Update style"));
          else ws.app?.toast?.(t("The selected layer has no values of this kind."), "warning", 3000);
        } },
        "-",
        { label: t("Delete style"), icon: "trash", danger: true, disabled: ws.readOnly, run: () => deleteStyle(s) },
      ], { label: s.name });
    });
    return row;
  }

  async function renameStyle(s) {
    const name = await promptDialog({ title: t("Rename style"), label: t("Name"), value: s.name, ok: t("Rename") });
    if (name?.trim() && name.trim() !== s.name) ws.apply({ op: "style.update", id: s.id, set: { name: name.trim().slice(0, 256) } }, t("Rename style"));
  }
  async function deleteStyle(s) {
    const ok = await confirmDialog({ title: t("Delete style"), message: t("Layers that use “{name}” keep its values.", { name: s.name }), ok: t("Delete"), danger: true });
    if (ok) ws.apply({ op: "style.delete", ids: [s.id], detach: true }, t("Delete style"));
  }

  function render(force = false) {
    const m = ws.model();
    const k = [m.nodes, m.styles, m.vars, ws.page, ws.selection.join(","), ws.readOnly, search.value];
    if (!force && sameKey(key, k)) return;
    key = k;
    const ids = ws.selection.filter((x) => m.nodes[x]);
    const kinds = ids.length === 1 ? P.styleKindsOf(m.nodes[ids[0]]) : [];
    actions.replaceChildren(
      btn("grid", t("Create component"), () => {
        const res = ws.apply(P.componentOp(ws.model(), ws.selection), t("Create component"));
        if (res?.ids?.[0]) ws.select([res.ids[0]]);
      }, { disabled: ws.readOnly || !P.canCreateComponent(m, ids), fld: "create-component" }),
      btn("collection", t("Combine as variants"), () => {
        const res = ws.apply(P.combineOp(ws.model(), ws.selection), t("Combine as variants"));
        if (res?.ids?.[0]) ws.select([res.ids[0]]);
      }, { disabled: ws.readOnly || !P.canCombine(m, ids), fld: "combine" }),
      btn("palette2", t("New style"), (e) => menuPopover(e.currentTarget, ["fill", "text", "effect", "grid"].map((kind) => ({ label: t(KIND_LABELS[kind]), disabled: !kinds.includes(kind), run: () => newStyle(kind) })), { label: t("New style") }), { disabled: ws.readOnly || !kinds.length, fld: "new-style" }),
    );
    const { components, styles } = P.assetList(m, { query: search.value, page: ws.page });
    const parts = [h("h3.of-proto-assets__head", t("Components"))];
    if (components.length) parts.push(h("div.of-proto-assets__grid", { role: "list", "aria-label": t("Components") }, ...components.map((a) => componentRow(m, a))));
    else parts.push(h("p.of-proto-assets__empty", search.value ? t("No components match.") : t("No components yet. Select a frame and choose Create component.")));
    for (const kind of ["fill", "text", "effect", "grid"]) {
      const of = styles.filter((s) => s.kind === kind);
      if (!of.length) continue;
      parts.push(h("h3.of-proto-assets__head", t(KIND_LABELS[kind])), h("div.of-proto-assets__styles", ...of.map(styleRow)));
    }
    if (!styles.length && !search.value) parts.push(h("h3.of-proto-assets__head", t("Styles")), h("p.of-proto-assets__empty", t("No styles yet. Select a layer and choose New style.")));
    const focus = list.contains(document.activeElement) ? document.activeElement.dataset?.id : null;
    list.replaceChildren(...parts);
    if (focus) list.querySelector(`[data-id="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
  }

  async function newStyle(kind) {
    const id = ws.selection[0];
    const m = ws.model();
    const names = Object.values(m.styles || {}).map((s) => s.name);
    const name = await promptDialog({ title: t("New style"), label: t("Name"), value: P.uniqueName(names, t(KIND_LABELS[kind]).replace(/s$/, "")), ok: t("Create") });
    if (!name?.trim()) return;
    const op = P.styleFromSelectionOp(ws.model(), id, kind, name.trim().slice(0, 256));
    if (op) ws.apply(op, t("Create style"));
  }

  // drop a component on the canvas: an instance where it lands (into the frame under the pointer, in its flow)
  const stage = ws.view.stage;
  stage.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types?.includes(DRAG_TYPE) || ws.readOnly) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  stage.addEventListener("drop", (e) => {
    const id = e.dataTransfer?.getData(DRAG_TYPE);
    if (!id || ws.readOnly) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const w = ws.toWorld(e.clientX - r.left, e.clientY - r.top);
    const where = placement(ws, w);
    const m = ws.model();
    const op = P.insertInstanceOp(m, id, { page: ws.page, parent: where.parent, ...(where.flow ? { index: where.index } : { x: where.at.x, y: where.at.y }) });
    const res = ws.apply(op, t("Insert instance"));
    if (res?.ids?.[0]) {
      ws.select([res.ids[0]]);
      stage.focus({ preventScroll: true });
    }
  });

  render(true);
  return { el, render };
}

function swatchOf(value) {
  const f = Array.isArray(value) ? value.find((x) => x?.type === "solid" && typeof x.color === "string") : null;
  if (f) return f.color;
  const g = Array.isArray(value) ? value.find((x) => Array.isArray(x?.stops)) : null;
  return typeof g?.stops?.[0]?.color === "string" ? g.stops[0].color : "transparent";
}
