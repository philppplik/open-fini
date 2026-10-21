// Settings > Studios: choose which studios the header shows (at most five) and in what order.
// Every other registered studio stays reachable from the header's "More" menu and the Studio menu.
import { h } from "../core/util.js";
import { iconEl } from "./toolbox.js";
import { STUDIOS, studioIds, studioIconSpec, toggleVisibleStudio, moveVisibleStudio, reorderVisibleStudio, MAX_VISIBLE_STUDIOS, DEFAULT_VISIBLE_STUDIOS } from "../studios/registry.js";

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
      say(error);
      if (error) cb.checked = on; // refused: keep the box as it was
      else save(next);
    });
    const up = h("button.of-studiopick__move", { type: "button", "aria-label": `Move ${s.label} left`, title: "Move left", disabled: !on || index === 0 }, iconEl("chevron-up"));
    const down = h("button.of-studiopick__move", { type: "button", "aria-label": `Move ${s.label} right`, title: "Move right", disabled: !on || index === visible.length - 1 }, iconEl("chevron-down"));
    up.addEventListener("click", () => save(moveVisibleStudio(app.visibleStudios, id, -1)));
    down.addEventListener("click", () => save(moveVisibleStudio(app.visibleStudios, id, 1)));
    const el = h(
      "li.of-studiopick__row",
      { draggable: on, "data-id": id, class: on ? "" : "is-hidden" },
      h("span.of-studiopick__grip", { "aria-hidden": "true" }, iconEl(on ? "grip-vertical" : "dash")),
      h("label.of-studiopick__label", { for: `of-sp-${id}` }, iconEl(studioIconSpec(s)), h("span", h("strong", s.label), h("small", { id: `of-sp-d-${id}` }, on ? `Header position ${index + 1} · Alt+${index + 1}` : s.blurb || "In the More menu"))),
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
      h("p.of-studiopick__count", `${visible.length} of ${MAX_VISIBLE_STUDIOS} shown in the header`),
      h("ul.of-studiopick__list", { "aria-label": "Studios in the header" }, visible.map((id, i) => row(id, i, visible))),
      hidden.length ? h("h4.of-studiopick__sub", "In the More menu") : null,
      hidden.length ? h("ul.of-studiopick__list", { "aria-label": "Studios in the More menu" }, hidden.map((id) => row(id, -1, visible))) : null,
      message,
      h("p.of-set__hint", `The header shows at most ${MAX_VISIBLE_STUDIOS} studios so it stays readable. Studios in the More menu are one click away and still appear in the Studio menu and the command palette. Alt+1 to Alt+${visible.length} jump to the shown studios in this order. Drag a shown studio to reorder it, or use the arrow buttons.`),
    );
    const reset = h("sl-button", { size: "small" }, "Reset to default");
    reset.addEventListener("click", () => {
      say("");
      save([...DEFAULT_VISIBLE_STUDIOS]);
    });
    root.append(reset);
  }
  render();
  return root;
}
