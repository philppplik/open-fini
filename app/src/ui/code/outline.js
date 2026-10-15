// Navigator: the element tree of the page being edited. Click to select, drag to reorder or nest.
import { h, empty, debounce } from "../../core/util.js";
import { classList, getAttr } from "../../engine/web/index.js";
import { iconButton } from "../controls.js";

const TAG_ICONS = {
  body: "window",
  head: "gear",
  header: "layout-text-window",
  footer: "layout-text-window-reverse",
  nav: "compass",
  main: "layout-wtf",
  section: "view-stacked",
  article: "file-earmark-text",
  aside: "layout-sidebar-inset",
  div: "square",
  span: "fonts",
  p: "text-paragraph",
  h1: "type-h1",
  h2: "type-h2",
  h3: "type-h3",
  h4: "type-h3",
  h5: "type-h3",
  h6: "type-h3",
  a: "link-45deg",
  img: "image",
  picture: "image",
  svg: "bezier2",
  ul: "list-ul",
  ol: "list-ol",
  li: "dot",
  button: "hand-index",
  form: "input-cursor-text",
  input: "input-cursor",
  textarea: "textarea-t",
  select: "menu-button-wide",
  label: "tag",
  video: "play-btn",
  audio: "music-note-beamed",
  iframe: "window-stack",
  table: "table",
  hr: "dash-lg",
  script: "filetype-js",
  style: "filetype-css",
  link: "link",
  meta: "info-circle",
  title: "fonts",
};
const VOID_NO_CHILDREN = new Set(["img", "input", "br", "hr", "meta", "link", "source", "track", "wbr", "area", "base", "col", "embed", "param", "svg"]);

export function createOutline(ws) {
  const expanded = new Set(); // element paths ("0.1.3") the user collapsed/expanded explicitly
  const collapsed = new Set(["head"]);
  let showHead = false;
  const list = h("div.of-tree.of-outline", { role: "tree", tabindex: "0", "aria-label": "Page elements" });
  const head = h(
    "div.of-side__head",
    h("span.of-side__title", "Navigator"),
    h("div.of-side__actions",
      iconButton({ icon: "chevron-bar-expand", label: "Expand all", onClick: () => {
        collapsed.clear();
        expanded.clear();
        render(true);
      } }),
      iconButton({ icon: "chevron-bar-contract", label: "Collapse all", onClick: () => {
        const p = ws.model.html(ws.page);
        for (const e of p?.elements || []) if (e.children.some((c) => c.type === "element")) collapsed.add(keyOf(e));
        render();
      } }),
      iconButton({ icon: "eye", label: "Show <head> elements", onClick: (e, b) => {
        showHead = !showHead;
        b.classList.toggle("active", showHead);
        render();
      } })),
  );
  const foot = h("div.of-side__foot", "Drag rows to reorder or nest elements.");
  const el = h("div.of-side__pane.of-outlinepane", head, list, foot);

  const keyOf = (e) => {
    const path = [];
    for (let n = e; n; n = n.parent) path.unshift(n.parent ? n.parent.children.filter((c) => c.type === "element").indexOf(n) : 0);
    return `${e.tag}:${path.join(".")}`;
  };
  const isCollapsed = (e) => collapsed.has(keyOf(e)) || (e.tag === "head" && !showHead && !expanded.has(keyOf(e)));

  function label(e) {
    const classes = classList(e);
    const id = getAttr(e, "id");
    let text = "";
    const t = e.children.find((c) => c.type === "text" && c.text.trim());
    if (t && !["script", "style"].includes(e.tag)) text = t.text.trim().replace(/\s+/g, " ").slice(0, 28);
    return h(
      "span.of-tree__name",
      h("span.of-tag", e.tag),
      id ? h("span.of-tagid", `#${id}`) : null,
      classes.length ? h("span.of-tagcls", `.${classes.slice(0, 2).join(".")}${classes.length > 2 ? "…" : ""}`) : null,
      text ? h("span.of-tagtext", text) : null,
    );
  }

  let rows = [];
  function render() {
    empty(list);
    rows = [];
    const file = ws.page;
    const parsed = file ? ws.model.html(file) : null;
    if (!parsed) {
      list.append(h("div.of-empty", "Select an HTML page to see its elements."));
      return;
    }
    const roots = parsed.children.filter((c) => c.type === "element");
    const walk = (nodes, depth) => {
      for (const e of nodes) {
        if (e.type !== "element") continue;
        if (e.tag === "html") {
          walk(e.children, depth);
          continue;
        }
        if (e.tag === "head" && !showHead) continue;
        const kids = e.tag === "svg" ? [] : e.children.filter((c) => c.type === "element"); // the insides of an inline SVG are not page structure
        const open = kids.length && !isCollapsed(e);
        const row = makeRow(e, depth, kids.length > 0, !!open);
        list.append(row);
        rows.push({ el: e, row, depth });
        if (open) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
    if (!rows.length) list.append(h("div.of-empty", "This page has no elements yet. Add one from the Add panel."));
    paintState();
  }

  function makeRow(e, depth, hasKids, open) {
    const icon = h("sl-icon.of-fileicon.of-tagicon", { name: TAG_ICONS[e.tag] || "code" });
    const chev = hasKids ? h("sl-icon.of-tree__chev", { name: open ? "chevron-down" : "chevron-right" }) : h("span.of-tree__chev");
    const r = h("div.of-tree__row", { role: "treeitem", "data-id": e.id, style: { paddingLeft: `${6 + depth * 14}px` }, "aria-expanded": hasKids ? String(open) : undefined }, chev, icon, label(e));
    chev.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    chev.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const k = keyOf(e);
      if (isCollapsed(e)) {
        collapsed.delete(k);
        expanded.add(k);
      } else {
        collapsed.add(k);
        expanded.delete(k);
      }
      render();
    });
    r.addEventListener("pointerenter", () => ws.preview.hover(e.id));
    r.addEventListener("pointerleave", () => ws.preview.hover(null));
    r.addEventListener("dblclick", () => ws.revealInCode(e.id));
    r.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ws.elementMenu(e.id, ev.clientX, ev.clientY);
    });
    wireDrag(r, e);
    return r;
  }

  // ---------------------------------------------------------------- drag & drop reordering (pointer based)
  function wireDrag(r, e) {
    r.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || e.tag === "body" || e.tag === "head") {
        if (ev.button === 0) ws.selectElement(e.id, { scroll: true });
        return;
      }
      const x0 = ev.clientX;
      const y0 = ev.clientY;
      let dragging = false;
      let target = null;
      const indicator = h("div.of-tree__drop");
      const ghost = h("div.of-tree__ghost", e.tag);
      const move = (m) => {
        if (!dragging && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) > 5) {
          dragging = true;
          list.append(indicator);
          document.body.append(ghost);
          r.classList.add("dragging");
        }
        if (!dragging) return;
        ghost.style.left = `${m.clientX + 10}px`;
        ghost.style.top = `${m.clientY + 6}px`;
        target = locate(m.clientX, m.clientY, e);
        placeIndicator(indicator, target);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        indicator.remove();
        ghost.remove();
        r.classList.remove("dragging");
        if (!dragging) {
          ws.selectElement(e.id, { scroll: true });
          return;
        }
        if (target) ws.moveElement(e.id, target.parentId, target.index);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  /** Where would `moving` land when dropped at the pointer? → { parentId, index, row, where } */
  function locate(x, y, moving) {
    const hit = rows.find((o) => {
      const b = o.row.getBoundingClientRect();
      return y >= b.top && y <= b.bottom;
    });
    if (!hit) return null;
    const el = hit.el;
    // dropping onto the dragged element or inside it is not possible
    for (let n = el; n; n = n.parent) if (n === moving) return null;
    const b = hit.row.getBoundingClientRect();
    const f = (y - b.top) / b.height;
    const canHold = !VOID_NO_CHILDREN.has(el.tag);
    const kids = (n) => n.children.filter((c) => c.type === "element" && c !== moving);
    if (f > 0.28 && f < 0.72 && canHold) return { parentId: el.id, index: kids(el).length, row: hit.row, where: "inside" };
    const parent = el.parent;
    const sibs = parent ? kids(parent) : ws.model.html(ws.page).children.filter((c) => c.type === "element" && c.tag !== "html");
    const i = sibs.indexOf(el);
    if (el.tag === "body") return null;
    return { parentId: parent && parent.tag !== "html" ? parent.id : null, index: f <= 0.5 ? i : i + 1, row: hit.row, where: f <= 0.5 ? "before" : "after" };
  }
  function placeIndicator(ind, t) {
    if (!t) {
      ind.style.display = "none";
      return;
    }
    const lr = list.getBoundingClientRect();
    const b = t.row.getBoundingClientRect();
    ind.style.display = "block";
    ind.className = `of-tree__drop ${t.where}`;
    ind.style.left = `${b.left - lr.left + list.scrollLeft + 6}px`;
    ind.style.width = `${b.width - 8}px`;
    ind.style.top = `${(t.where === "after" ? b.bottom : b.top) - lr.top + list.scrollTop}px`;
    ind.style.height = t.where === "inside" ? `${b.height}px` : "2px";
    if (t.where === "inside") ind.style.top = `${b.top - lr.top + list.scrollTop}px`;
  }

  // ---------------------------------------------------------------- state painting
  function paintState() {
    const sel = ws.selection?.id;
    for (const { el: e, row } of rows) {
      row.classList.toggle("selected", e.id === sel);
      row.classList.toggle("hover", e.id === ws.hoverId && e.id !== sel);
    }
  }
  function revealSelected() {
    const sel = ws.selection;
    if (!sel) return;
    const cur = ws.current();
    if (!cur) return;
    // expand ancestors of the selection
    let changed = false;
    for (let n = cur.el.parent; n; n = n.parent) {
      const k = keyOf(n);
      if (collapsed.has(k)) {
        collapsed.delete(k);
        changed = true;
      }
    }
    if (changed) render();
    else paintState();
    list.querySelector(`[data-id="${sel.id}"]`)?.scrollIntoView({ block: "nearest" });
  }

  const sched = debounce(() => render(), 120); // typing re-renders the tree at most ~8 times per second
  ws.on("project", sched);
  ws.on("swap", sched);
  ws.on("page", () => render());
  ws.on("selection", revealSelected);
  ws.on("hover", paintState);
  list.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") ws.selectSibling(1);
    else if (e.key === "ArrowUp") ws.selectSibling(-1);
    else if (e.key === "ArrowLeft") ws.selectParent();
    else if (e.key === "ArrowRight") ws.selectChild();
    else if (e.key === "Delete" || e.key === "Backspace") ws.deleteSelected();
    else return;
    e.preventDefault();
  });
  render();
  return { el, render, show: render };
}
