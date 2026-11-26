// Settings > Studios: choose which studios the header shows (any number, at least one) and in what order.
// Every other registered studio stays reachable from the header's "More" menu and the Studio menu.
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { iconEl } from "./toolbox.js";
import { STUDIOS, studioIds, studioIconSpec, toggleVisibleStudio, moveVisibleStudio, reorderVisibleStudio, DEFAULT_VISIBLE_STUDIOS } from "../studios/registry.js";

export function studiosSettings(app) {
  const root = h("div.of-studiopick");
  const message = h("p.of-studiopick__msg", { role: "status", "aria-live": "polite" });
  let dragId = null;

  const save = (list) => {
    app.setVisibleStudios(list);
    render();
  };
  const say = (text) => {
    message.textContent = text || "";
    message.classList.toggle("is-warning", !!text);
  };

  function row(id, index, visible) {
    const s = STUDIOS[id];
    const on = visible.includes(id);
    const cb = h("input", { type: "checkbox", id: `of-sp-${id}`, checked: on, "aria-describedby": `of-sp-d-${id}` });
    cb.addEventListener("change", () => {
      const { visible: next, error } = toggleVisibleStudio(app.visibleStudios, id);
      say(error ? t(error) : "");
      if (error) cb.checked = on; // refused: keep the box as it was
      else save(next);
    });
    const up = h("button.of-studiopick__move", { type: "button", "aria-label": t("Move {studio} left", { studio: s.label }), title: t("Move left"), disabled: !on || index === 0 }, iconEl("chevron-up"));
    const down = h("button.of-studiopick__move", { type: "button", "aria-label": t("Move {studio} right", { studio: s.label }), title: t("Move right"), disabled: !on || index === visible.length - 1 }, iconEl("chevron-down"));
    up.addEventListener("click", () => save(moveVisibleStudio(app.visibleStudios, id, -1)));
    down.addEventListener("click", () => save(moveVisibleStudio(app.visibleStudios, id, 1)));
    const el = h(
      "li.of-studiopick__row",
      { draggable: on, "data-id": id, class: on ? "" : "is-hidden" },
      h("span.of-studiopick__grip", { "aria-hidden": "true" }, iconEl(on ? "grip-vertical" : "dash")),
      h("label.of-studiopick__label", { for: `of-sp-${id}` }, iconEl(studioIconSpec(s)), h("span", h("strong", s.label), h("small", { id: `of-sp-d-${id}` }, on ? (index < 9 ? t("Header position {n} · Alt+{n}", { n: index + 1 }) : t("Header position {n}", { n: index + 1 })) : s.blurb ? t(s.blurb) : t("In the More menu")))),
      on ? h("span.of-studiopick__order", up, down) : null,
      h("span.of-studiopick__check", cb),
    );
    if (on) {
      el.addEventListener("dragstart", (e) => {
        dragId = id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
      });
      el.addEventListener("dragend", () => (dragId = null));
      el.addEventListener("dragover", (e) => {
        if (dragId && dragId !== id && app.visibleStudios.includes(dragId)) e.preventDefault();
      });
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragId) save(reorderVisibleStudio(app.visibleStudios, dragId, id));
      });
    }
    return el;
  }

  function render() {
    const visible = app.visibleStudios;
    const hidden = studioIds().filter((id) => !visible.includes(id));
    root.replaceChildren(
      h("p.of-studiopick__count", t("{shown} of {total} shown in the header", { shown: visible.length, total: studioIds().length })),
      h("ul.of-studiopick__list", { "aria-label": t("Studios in the header") }, visible.map((id, i) => row(id, i, visible))),
      hidden.length ? h("h4.of-studiopick__sub", t("In the More menu")) : null,
      hidden.length ? h("ul.of-studiopick__list", { "aria-label": t("Studios in the More menu") }, hidden.map((id) => row(id, -1, visible))) : null,
      message,
      h("p.of-set__hint", t("Show as many studios as you like. When the window is too narrow for all of them, the rightmost ones move into the More menu automatically. Hidden studios stay one click away in the More menu, in File and the Studio menu and in the command palette, and a file of a hidden studio still opens in its studio. Alt+1 to Alt+{n} jump to the shown studios in this order. Drag a shown studio to reorder it, or use the arrow buttons.", { n: Math.min(visible.length, 9) })),
    );
    const reset = h("sl-button", { size: "small" }, t("Reset to default"));
    reset.addEventListener("click", () => {
      say("");
      save([...DEFAULT_VISIBLE_STUDIOS]);
    });
    const all = h("sl-button", { size: "small", disabled: !hidden.length }, t("Show all studios"));
    all.addEventListener("click", () => {
      say("");
      save([...visible, ...hidden]);
    });
    root.append(h("div.of-studiopick__actions", all, reset));
  }
  render();
  return root;
}
