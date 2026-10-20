// Layers panel: tree of the active page with drag & drop, visibility/lock toggles and layer controls.
import { h, empty, frameScheduler } from "../../core/util.js";
import { emptyHint } from "../empty-hint.js";
import { BLEND_MODES } from "../../core/effects.js";
import { reparent, setProp, topLevelSelection } from "../../core/ops.js";
import { iconButton, selectField, sliderField } from "../controls.js";
import { showContextMenu } from "../menus.js";
import { openContextMenu } from "../context-menu/index.js";
import { cssColor } from "../../core/color.js";

const TYPE_ICON = {
  group: "folder", rect: "square", ellipse: "circle", polygon: "pentagon", star: "star", path: "bezier2",
  text: "fonts", image: "image", pixel: "grid-3x3", adjust: "sliders",
};

export function createLayersPanel(app) {
  const list = h("div.of-layers__list", { role: "tree", "aria-label": "Layers" });
  const blend = selectField({ label: "", value: "normal", options: BLEND_MODES, onChange: (v) => setProp(app, "blend", v, "Blend Mode"), cls: "of-layers__blend" });
  const opacity = sliderField({ label: "", value: 100, min: 0, max: 100, step: 1, unit: "%", onInput: (v) => applyOpacity(v), onChange: (v) => applyOpacity(v), cls: "of-layers__opacity" });
  const applyOpacity = (v) => setProp(app, "opacity", v / 100, "Opacity");

  const footer = h(
    "div.of-layers__footer",
    iconButton({ icon: "plus-square-dotted", label: "New pixel layer", onClick: () => app.run("layer.newPixel") }),
    iconButton({ icon: "folder-plus", label: "New group", onClick: () => app.run("layer.newGroup") }),
    iconButton({ icon: "circle-half", label: "Add mask", onClick: () => app.run("layer.addMask") }),
    iconButton({ icon: "sliders", label: "Add adjustment", onClick: (e, b) => {
      const r = b.getBoundingClientRect();
      const items = app.menuProviders?.adjustments?.(app) || [];
      showContextMenu(app, r.left, r.top - 8, items);
    } }),
    h("span.grow"),
    iconButton({ icon: "trash3", label: "Delete", onClick: () => app.run("edit.delete") }),
  );
  const el = h("div.of-layers", h("div.of-layers__head", blend.el, opacity.el), list, footer);

  let dragNode = null;
  let lastClicked = null;

  const thumbCache = new WeakMap();

  function thumb(node) {
    if (node.type === "pixel") {
      const src = app.doc.pixels.get(node.id);
      if (src) {
        let c = thumbCache.get(node);
        if (!c) {
          c = h("canvas.of-thumb", { width: 28, height: 28 });
          thumbCache.set(node, c);
        }
        const ctx = c.getContext("2d");
        ctx.clearRect(0, 0, 28, 28);
        const s = Math.min(28 / src.width, 28 / src.height);
        ctx.drawImage(src, (28 - src.width * s) / 2, (28 - src.height * s) / 2, src.width * s, src.height * s);
        return c;
      }
    }
    const ic = h("sl-icon", { name: TYPE_ICON[node.type] || "square" });
    if (node.type !== "group" && node.fill?.type === "solid") ic.style.color = cssColor(node.fill.color, 1);
    return h("span.of-thumb.icon", ic);
  }

  /** Mask chip: click to paint on the mask instead of the layer (click again to go back). */
  function maskBadge(node) {
    const editing = app.isSelected(node) && app.state?.maskTarget;
    const b = h("button.of-layer__mask", { type: "button", class: editing ? "active" : "", "data-tip": editing ? "Editing mask — click to edit the layer" : "Click to edit the layer mask", "aria-label": "Edit layer mask" }, h("sl-icon", { name: "circle-half" }));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!app.isSelected(node)) app.select([node]);
      app.state.maskTarget = !app.state.maskTarget;
      app.emit("selection");
    });
    return b;
  }

  function row(node, depth) {
    const isSel = app.isSelected(node);
    const hasKids = node.children && node.children.length > 0;
    const open = node._open ?? node.type === "group";
    const name = h("span.of-layer__name", node.name);
    const twist = h("button.of-layer__twist", { type: "button", class: hasKids ? (open ? "open" : "") : "empty", tabIndex: -1, "aria-label": open ? "Collapse" : "Expand" }, h("sl-icon", { name: "chevron-right" }));
    const eye = h("button.of-layer__toggle", { type: "button", "aria-label": node.visible ? "Hide" : "Show", class: node.visible ? "" : "off" }, h("sl-icon", { name: node.visible ? "eye" : "eye-slash" }));
    const lock = h("button.of-layer__toggle", { type: "button", "aria-label": node.locked ? "Unlock" : "Lock", class: node.locked ? "on" : "off" }, h("sl-icon", { name: node.locked ? "lock-fill" : "unlock" }));
    const r = h(
      "div.of-layer",
      {
        role: "treeitem", "aria-selected": String(isSel), "aria-level": depth + 1, draggable: !node.locked,
        class: [isSel ? "selected" : "", node.visible ? "" : "hidden", node.locked ? "locked" : ""].join(" ").trim(),
        style: { "--depth": depth },
      },
      twist,
      thumb(node),
      name,
      node.mask ? maskBadge(node) : null,
      node.fx?.length ? h("sl-icon.of-layer__badge", { name: "stars", title: "Effects" }) : null,
      eye,
      lock,
    );
    twist.addEventListener("click", (e) => {
      e.stopPropagation();
      node._open = !open;
      render();
    });
    eye.addEventListener("click", (e) => {
      e.stopPropagation();
      app.doc.set(node, { visible: !node.visible }, node.visible ? "Hide" : "Show");
    });
    lock.addEventListener("click", (e) => {
      e.stopPropagation();
      app.doc.set(node, { locked: !node.locked }, node.locked ? "Unlock" : "Lock");
    });
    r.addEventListener("click", (e) => {
      if (e.shiftKey && lastClicked && lastClicked._parent === node._parent) {
        const sib = node._parent.children;
        const a = sib.indexOf(lastClicked);
        const b = sib.indexOf(node);
        app.select(sib.slice(Math.min(a, b), Math.max(a, b) + 1));
      } else if (e.ctrlKey || e.metaKey) app.select([node], { toggle: true });
      else app.select([node]);
      lastClicked = node;
    });
    r.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      rename(node, name);
    });
    r.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!app.isSelected(node)) app.select([node]);
      openContextMenu(app, { kind: "layers-row", x: e.clientX, y: e.clientY, selection: app.selection, event: e, data: { node, rename: () => rename(node, name), layers: true } });
    });
    // drag and drop
    r.addEventListener("dragstart", (e) => {
      dragNode = node;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", node.id);
      if (!app.isSelected(node)) app.select([node]);
    });
    r.addEventListener("dragend", () => {
      dragNode = null;
      list.querySelectorAll(".drop-before,.drop-after,.drop-into").forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-into"));
    });
    r.addEventListener("dragover", (e) => {
      if (!dragNode) return;
      const bad = isDescendant(node, dragNode) || node === dragNode;
      if (bad) return;
      e.preventDefault();
      const box = r.getBoundingClientRect();
      const y = (e.clientY - box.top) / box.height;
      r.classList.remove("drop-before", "drop-after", "drop-into");
      r.classList.add(y < 0.28 ? "drop-before" : y > 0.72 ? "drop-after" : "drop-into");
    });
    r.addEventListener("dragleave", () => r.classList.remove("drop-before", "drop-after", "drop-into"));
    r.addEventListener("drop", (e) => {
      e.preventDefault();
      const zone = r.classList.contains("drop-before") ? "before" : r.classList.contains("drop-after") ? "after" : "into";
      r.classList.remove("drop-before", "drop-after", "drop-into");
      if (dragNode && dragNode !== node && !isDescendant(node, dragNode)) dropOn(node, zone);
    });
    return r;
  }

  function isDescendant(node, ancestor) {
    for (let n = node; n; n = n._parent) if (n === ancestor) return true;
    return false;
  }

  function dropOn(target, zone) {
    const doc = app.doc;
    const moving = topLevelSelection(app).includes(dragNode) ? topLevelSelection(app) : [dragNode];
    doc.tx("Arrange Layers", () => {
      // list shows topmost first → "before" in the UI = higher z-index = after in children
      const ordered = moving.slice().sort((a, b) => a._parent.children.indexOf(a) - b._parent.children.indexOf(b));
      if (zone === "into") {
        for (const n of ordered) if (!isDescendant(target, n)) reparent(doc, n, target, target.children?.length ?? 0);
        if (target.children) target._open = true;
      } else {
        const parent = target._parent;
        let idx = parent.children.indexOf(target) + (zone === "before" ? 1 : 0);
        for (const n of ordered) {
          if (isDescendant(parent, n)) continue;
          const cur = n._parent === parent ? parent.children.indexOf(n) : -1;
          reparent(doc, n, parent, idx);
          if (cur >= 0 && cur < idx) idx--;
          idx++;
        }
      }
    });
  }

  function rename(node, nameEl) {
    const input = h("input.of-layer__rename", { value: node.name, spellcheck: false });
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const done = (ok) => {
      if (ok && input.value.trim()) app.doc.set(node, { name: input.value.trim() }, "Rename Layer");
      render();
    };
    input.addEventListener("blur", () => done(true));
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") done(true);
      if (e.key === "Escape") done(false);
    });
  }

  function walkRows(container, depth, out) {
    for (let i = container.children.length - 1; i >= 0; i--) {
      const n = container.children[i];
      out.push(row(n, depth));
      const open = n._open ?? n.type === "group";
      if (n.children?.length && open) walkRows(n, depth + 1, out);
    }
  }

  function render() {
    const doc = app.doc;
    empty(list);
    if (!doc) return;
    const rows = [];
    const page = app.page;
    if (app.state?.group) rows.push(h("div.of-layers__crumb", h("button.of-btn", { onclick: () => app.exitGroup() }, "← ", app.state.group.name)));
    walkRows(page.root, 0, rows);
    if (!rows.length) rows.push(emptyHint(app, { icon: "layers", title: "No layers yet", text: "Draw a shape, type some text or drop an image on the canvas. Each object appears here.", plain: "No layers yet. Draw a shape or add a layer." }));
    list.append(...rows);
    syncControls();
  }

  function syncControls() {
    const n = app.activeNode;
    blend.select.disabled = !n;
    if (n) {
      blend.set(n.blend || "normal");
      opacity.set(Math.round(n.opacity * 100));
    }
  }

  const schedule = frameScheduler(render);
  app.on("selection", schedule);
  app.on("doc", schedule);
  app.on("page", schedule);
  app.on("context", schedule);
  app.on("docchange", (ev) => {
    if (ev.structure || ev.history || ev.label?.match?.(/Rename|Hide|Show|Lock|Unlock|Add Mask|Effect|Blend|Opacity/)) schedule();
    else if (ev.nodes && [...ev.nodes].some((n) => n.type === "pixel")) schedule();
    else syncControls();
  });
  render();
  return { el, show: render };
}
