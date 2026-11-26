// Variable binding UI of the Proto Studio (docs/concepts/proto-studio.md §5.3, task T6): the small popover the Design
// panel, the Variables panel (aliases) and the Assets panel share, the variable picker in it, and the bind button and
// bound-value chip of a Design panel field. Picking a variable is ONE operation (node.bind for every selected layer,
// one undo step); "Detach" writes the variable's current value back into the field.
//
//   openPopover(anchor, content, { label, onClose }) → { el, close }        anchored, closes on Escape / outside click
//   openVariablePicker(ws, anchor, { path?, type?, current?, exclude?, title?, onPick(varId|null) }) → popover
//   bindable(ws, { ids, path, label, widget, type? }) → element            the field with its bind button, or the chip
//   menuPopover(anchor, items, { label }) → popover                        a list of actions ({ label, icon?, run, danger? })
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import * as P from "./model.js";

let open = null;

/** A popover next to `anchor` (an element or a { x, y } client point). Only one is open at a time. */
export function openPopover(anchor, content, { label = "", onClose = null, cls = "" } = {}) {
  open?.close(false);
  const el = h(`div.of-proto-pop${cls ? `.${cls}` : ""}`, { role: "dialog", "aria-label": label, tabIndex: -1 }, content);
  document.body.append(el);
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = Math.min(r.left, vw - w - 8);
  let top = r.bottom + 4;
  if (top + hgt > vh - 8) top = Math.max(8, r.top - hgt - 4);
  if (left < 8) left = 8;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  const opener = document.activeElement;
  const outside = (e) => {
    if (!el.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) api.close(false);
  };
  const key = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      api.close(true);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
  el.addEventListener("keydown", key);
  const api = {
    el,
    close(restore = true) {
      if (open !== api) return;
      open = null;
      document.removeEventListener("pointerdown", outside, true);
      el.remove();
      onClose?.();
      if (restore && opener?.isConnected) opener.focus?.({ preventScroll: true });
    },
  };
  open = api;
  return api;
}

/** Arrow keys move between the options of a list; Enter picks (the browser's click on a focused button). */
function listKeys(list) {
  list.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const opts = [...list.querySelectorAll("button:not(:disabled)")];
    const i = opts.indexOf(document.activeElement);
    const next = opts[(i + (e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length] || opts[0];
    next?.focus();
    e.preventDefault();
  });
}

/** A small action menu. */
export function menuPopover(anchor, items, { label = "" } = {}) {
  const list = h("div.of-proto-pop__list", { role: "menu" });
  let pop = null;
  for (const it of items.filter(Boolean)) {
    if (it === "-") {
      list.append(h("div.of-proto-pop__sep", { role: "separator" }));
      continue;
    }
    const b = h(`button.of-proto-pop__item${it.danger ? ".is-danger" : ""}`, { type: "button", role: "menuitem", disabled: !!it.disabled }, it.icon ? h("sl-icon", { name: it.icon }) : h("span.of-proto-pop__noicon"), h("span", it.label));
    b.addEventListener("click", () => {
      pop.close(true);
      it.run();
    });
    list.append(b);
  }
  listKeys(list);
  pop = openPopover(anchor, list, { label });
  list.querySelector("button:not(:disabled)")?.focus();
  return pop;
}

const swatch = (type, value) => {
  if (type === "color" && typeof value === "string") return h("span.of-proto-swatch", { style: `--of-sw:${value}` });
  const icon = type === "number" ? "123" : type === "bool" ? "check-square" : "type";
  return h("sl-icon.of-proto-pop__ticon", { name: icon });
};

/**
 * The variable picker: variables of the field's type grouped by collection, a search field, and "Detach" when the
 * field is bound. Variables outside their scopes are listed disabled with a note (the engine refuses them too).
 */
export function openVariablePicker(ws, anchor, { path = null, type = undefined, current = null, exclude = null, title = "", onPick }) {
  const search = h("input.of-proto-pop__search", { type: "search", placeholder: t("Search variables"), "aria-label": t("Search variables"), spellcheck: false });
  const list = h("div.of-proto-pop__list", { role: "listbox", "aria-label": t("Variables") });
  let pop = null;
  const pick = (id) => {
    pop.close(true);
    onPick(id);
  };
  const fill = () => {
    list.replaceChildren();
    const groups = P.bindCandidates(ws.model(), path, { query: search.value, type, exclude });
    if (current) {
      const d = h("button.of-proto-pop__item", { type: "button", role: "option" }, h("sl-icon", { name: "scissors" }), h("span", t("Detach variable")));
      d.addEventListener("click", () => pick(null));
      list.append(d, h("div.of-proto-pop__sep", { role: "separator" }));
    }
    if (!groups.length) list.append(h("p.of-proto-pop__empty", search.value ? t("No variables match.") : t("No variables of this type yet. Create them in the Variables panel.")));
    for (const g of groups) {
      list.append(h("div.of-proto-pop__group", { role: "presentation" }, g.collName));
      for (const it of g.items) {
        const b = h(`button.of-proto-pop__item${it.id === current ? ".is-current" : ""}`, { type: "button", role: "option", "aria-selected": String(it.id === current), disabled: !it.allowed, title: it.allowed ? "" : t("Its scopes do not include this field") }, swatch(it.type, it.value), h("span.of-proto-pop__name", it.name), h("span.of-proto-pop__val", P.formatValue(it.type, it.value)));
        b.addEventListener("click", () => pick(it.id));
        list.append(b);
      }
    }
  };
  search.addEventListener("input", fill);
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list.querySelector("button:not(:disabled)")?.focus();
    }
  });
  listKeys(list);
  fill();
  const head = title ? h("div.of-proto-pop__title", title) : null;
  pop = openPopover(anchor, h("div.of-proto-pop__body", head, search, list), { label: title || t("Variables"), cls: "of-proto-pop--vars" });
  search.focus();
  return pop;
}

/**
 * A Design panel field that can take a variable: the widget with a small bind button, or, when every selected layer
 * is bound at `path`, a chip with the variable's name (click: pick another) and a detach button.
 */
export function bindable(ws, { ids, path, label, widget, type = undefined }) {
  const m = ws.model();
  const { var: v, mixed } = P.commonBinding(m, ids, path);
  const bind = (varId) => {
    const op = P.bindOp(ws.model(), ids, path, varId);
    if (op) ws.apply(op, varId ? t("Bind variable") : t("Detach variable"));
  };
  const openPicker = (anchor) => openVariablePicker(ws, anchor, { path, type, current: v, title: label, onPick: bind });
  if (v) {
    const item = m.vars?.items?.[v];
    const chip = h("button.of-proto-bound", { type: "button", "aria-label": t("{field}: variable {name}. Change", { field: label, name: item?.name || "?" }), "data-tip": t("Bound to a variable"), dataset: { field: `${path}:bound` } }, swatch(item?.type, P.boundValue(m, v, ids[0])), h("span", item?.name || t("Missing variable")));
    chip.addEventListener("click", () => openPicker(chip));
    const det = h("button.of-proto-design__ibtn", { type: "button", "aria-label": t("Detach variable"), "data-tip": t("Detach variable"), dataset: { field: `${path}:detach` } }, h("sl-icon", { name: "scissors" }));
    det.addEventListener("click", () => bind(null));
    return h("div.of-proto-bindf.is-bound", chip, det);
  }
  const b = h(`button.of-proto-design__ibtn.of-proto-bindbtn${mixed ? ".is-mixed" : ""}`, { type: "button", "aria-label": t("Bind {field} to a variable", { field: label }), "data-tip": mixed ? t("Mixed bindings") : t("Bind to a variable"), "aria-haspopup": "dialog", dataset: { field: `${path}:bind` } }, h("sl-icon", { name: "hexagon" }));
  b.addEventListener("click", () => openPicker(b));
  return h("div.of-proto-bindf", widget, b);
}
