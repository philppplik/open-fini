// Native UI for the views of VS Code web extensions (vscode/host.js): tree views as OpenFini tree rows and webviews
// (panels and webview views) as sandboxed frames, both inside dockable panels of the Code studio. Lazy: loaded when
// such a panel is first shown.
//
// Public API
//   createTreeView({ title, load, onClick, onSelect, onRefresh })   -> { el, refresh(), update(meta), setState(text) }
//   createWebviewFrame({ onMessage, onState, onLink })               -> { el, setHtml(srcdoc), post(msg), destroy() }
import { h, empty } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { iconButton } from "../controls.js";
import { codiconName } from "../../vscode/codicons.js";

const iconEl = (icon) => {
  if (!icon) return h("span.of-tree__chev");
  if (icon.theme) {
    const name = codiconName(icon.theme);
    return name ? h("sl-icon.of-fileicon", { name }) : h("span.of-tree__chev");
  }
  if (icon.src) return h("img.of-fileicon.of-vsxview__img", { src: icon.src, alt: "" });
  return h("span.of-tree__chev");
};

/**
 * A tree view: rows load their children on expand; a click runs the item's command.
 * @param {{ title: string, load: (parent: string|null) => Promise<object[]>, onClick: (item: object) => void, onSelect?: (item: object) => void, onRefresh?: () => void, iconSrc?: (icon: object) => object }} o
 */
export function createTreeView(o) {
  const list = h("div.of-tree.of-vsxview__tree", { role: "tree", tabindex: "0", "aria-label": o.title });
  const msg = h("div.of-vsxview__msg", { hidden: true });
  const desc = h("span.of-vsxview__desc");
  const head = h("div.of-side__head", h("span.of-side__title", o.title, desc), h("div.of-side__actions", iconButton({ icon: "arrow-clockwise", label: "Refresh", onClick: () => refresh() })));
  const el = h("div.of-side__pane.of-vsxview", head, msg, list);
  const open = new Set(); // expanded handles survive a refresh while the provider returns the same structure
  let gen = 0;
  let selected = null;

  function row(item, depth) {
    const expandable = item.collapsible > 0;
    const isOpen = open.has(item.handle) || (item.collapsible === 2 && !open.has(`!${item.handle}`));
    const r = h(
      "div.of-tree__row",
      { role: "treeitem", tabindex: "-1", class: item.handle === selected ? "selected" : "", style: { paddingLeft: `${8 + depth * 14}px` }, title: item.tooltip || item.label, "aria-expanded": expandable ? String(isOpen) : undefined },
      expandable ? h("sl-icon.of-tree__chev", { name: isOpen ? "chevron-down" : "chevron-right" }) : h("span.of-tree__chev"),
      iconEl(o.iconSrc ? o.iconSrc(item.icon) : item.icon),
      h("span.of-tree__name", item.label, item.description ? h("span.of-vsxview__rowdesc", item.description) : null),
    );
    const kids = h("div", { role: "group", hidden: !(expandable && isOpen) });
    const toggle = () => {
      const now = kids.hidden;
      kids.hidden = !now;
      if (now) {
        open.add(item.handle);
        open.delete(`!${item.handle}`);
        if (!kids.childElementCount) fill(kids, item.handle, depth + 1);
      } else {
        open.delete(item.handle);
        open.add(`!${item.handle}`);
      }
      r.setAttribute("aria-expanded", String(now));
      r.querySelector(".of-tree__chev")?.setAttribute?.("name", now ? "chevron-down" : "chevron-right");
    };
    // the chevron always expands or collapses, even when the row has a command (like VS Code's twistie)
    r.firstChild.addEventListener("click", (e) => {
      if (!expandable) return;
      e.stopPropagation();
      toggle();
    });
    r.addEventListener("click", () => {
      selected = item.handle;
      for (const x of list.querySelectorAll(".of-tree__row.selected")) x.classList.remove("selected");
      r.classList.add("selected");
      o.onSelect?.(item);
      if (item.command) o.onClick(item);
      else if (expandable) toggle();
    });
    r.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        r.click();
      } else if ((e.key === "ArrowRight" && kids.hidden) || (e.key === "ArrowLeft" && !kids.hidden)) {
        if (expandable) toggle();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const rows = [...list.querySelectorAll(".of-tree__row")].filter((x) => x.offsetParent !== null);
        rows[rows.indexOf(r) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
        e.preventDefault();
      }
    });
    if (expandable && isOpen) fill(kids, item.handle, depth + 1);
    return [r, kids];
  }

  async function fill(box, parent, depth) {
    const mine = gen;
    let items;
    try {
      items = await o.load(parent);
    } catch (err) {
      if (mine === gen) box.replaceChildren(h("div.of-empty", err?.message || t("This view could not be loaded.")));
      return;
    }
    if (mine !== gen) return;
    empty(box);
    for (const it of items) box.append(...row(it, depth));
    if (!parent && !items.length) box.append(h("div.of-empty", t("Nothing to show here yet.")));
  }

  function refresh() {
    gen++;
    o.onRefresh?.();
    return fill(list, null, 0);
  }

  return {
    el,
    refresh,
    /** title, description, message from TreeView properties */
    update(meta = {}) {
      if (meta.title) head.querySelector(".of-side__title").firstChild.textContent = meta.title;
      desc.textContent = meta.description ? ` · ${meta.description}` : "";
      msg.hidden = !meta.message;
      msg.textContent = meta.message || "";
    },
    setState(text) {
      gen++;
      list.replaceChildren(h("div.of-empty", text));
    },
  };
}

/**
 * The frame of one webview. `setHtml` replaces its document (the state from setState() is kept by the caller).
 * @param {{ title?: string, onMessage: (m: unknown) => void, onState: (s: unknown) => void, onLink: (url: string) => void }} o
 */
export function createWebviewFrame(o) {
  const frame = h("iframe.of-vsxview__frame", { sandbox: "allow-scripts allow-forms allow-modals", referrerpolicy: "no-referrer", title: o.title || t("Extension view") });
  const el = h("div.of-vsxview.of-vsxview--webview", frame);
  const onMsg = (e) => {
    if (e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.vsxw !== 1) return;
    if (d.t === "msg") o.onMessage(d.d);
    else if (d.t === "state") o.onState(d.d);
    else if (d.t === "link" && typeof d.d === "string") o.onLink(d.d);
  };
  window.addEventListener("message", onMsg);
  // messages posted while a document is still loading are delivered once it has loaded (VS Code queues them too)
  let ready = false;
  const queue = [];
  frame.addEventListener("load", () => {
    ready = true;
    for (const m of queue.splice(0)) frame.contentWindow?.postMessage(m, "*");
  });
  return {
    el,
    setHtml(srcdoc) {
      ready = false;
      frame.srcdoc = srcdoc;
    },
    post(message) {
      if (ready) frame.contentWindow?.postMessage(message, "*");
      else if (queue.length < 200) queue.push(message);
    },
    destroy() {
      window.removeEventListener("message", onMsg);
      frame.remove();
    },
  };
}
