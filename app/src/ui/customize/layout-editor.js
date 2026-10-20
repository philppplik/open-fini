// Settings > Layout and workspaces: panel visibility, dock side and width, and named workspaces per studio.
import { h } from "../../core/util.js";
import { button, numField } from "../controls.js";
import { STUDIOS } from "../../studios/index.js";
import { PANELS } from "../panels/index.js";

const LAYOUT_STUDIOS = ["vector", "pixel", "layout", "code"];

export function layoutEditor(app) {
  const cz = app.customize;
  let studio = LAYOUT_STUDIOS.includes(app.studio) ? app.studio : "vector";
  const root = h("div.of-cz");

  function panelsGroup() {
    const lay = cz.layout(studio);
    const { top, bottom } = cz.panelIds(studio);
    const ids = [...top, ...bottom];
    const out = h("section.of-set__group", h("h3", "Panels"));
    if (!ids.length) return out.appendChild(h("p.of-set__hint", "This studio has no side panels.")), out;
    out.append(h("p.of-set__hint", "Untick a panel to hide it in this studio. If you hide all of them the dock disappears and the canvas grows."));
    const grid = h("div.of-cz__checks");
    for (const id of ids) {
      const title = PANELS[id]?.title || id;
      const cb = h("input", { type: "checkbox", "aria-label": `Show the ${title} panel` });
      cb.checked = !lay.hidden.includes(id);
      cb.addEventListener("change", () => cz.setLayout(studio, { ...cz.layout(studio), hidden: cb.checked ? cz.layout(studio).hidden.filter((x) => x !== id) : [...cz.layout(studio).hidden, id] }));
      grid.append(h("label.of-cz__check", cb, h("span", title)));
    }
    out.append(grid);
    return out;
  }

  function dockGroup() {
    const lay = cz.layout(studio);
    const side = h("div.of-seg", { role: "group", "aria-label": "Dock side" });
    for (const [v, label] of [["left", "Left"], ["right", "Right"]]) {
      const b = h("button.of-seg__btn", { type: "button", "aria-pressed": String(lay.side === v) }, label);
      b.addEventListener("click", () => cz.setLayout(studio, { ...cz.layout(studio), side: v }));
      side.append(b);
    }
    const width = numField({ value: lay.width ?? 304, min: 220, max: 560, step: 4, precision: 0, unit: "px", wide: true, onChange: (v) => cz.setLayout(studio, { ...cz.layout(studio), width: Math.round(v) }) });
    return h(
      "section.of-set__group",
      h("h3", "Dock"),
      h("div.of-set__row", h("div", h("div.of-set__label", "Dock side"), h("div.of-set__hint", "Which side of the canvas the panels sit on. On narrow windows the dock always slides in from the right.")), h("div.of-set__ctl", side)),
      h("div.of-set__row", h("div", h("div.of-set__label", "Dock width"), h("div.of-set__hint", "The default is 304 px.")), h("div.of-set__ctl", width.el, lay.width !== null ? button("Default", () => cz.setLayout(studio, { ...cz.layout(studio), width: null })) : null)),
    );
  }

  function workspacesGroup() {
    const active = cz.activeWorkspace(studio);
    const out = h("section.of-set__group", h("h3", "Workspaces"), h("p.of-set__hint", "A workspace remembers which panels are shown and where the dock sits. Switch instantly, or save your own."));
    const list = h("ul.of-cz__list", { "aria-label": `Workspaces of the ${STUDIOS[studio].label} studio` });
    for (const w of cz.workspaces(studio)) {
      const isActive = w.name === active;
      list.append(
        h(
          "li.of-cz__item",
          { class: isActive ? "active" : "" },
          h("div.of-cz__names", h("span", w.name, isActive ? h("small", " (current)") : null), h("small", w.description)),
          button(isActive ? "Applied" : "Apply", () => cz.applyWorkspace(studio, w.name), { cls: "of-cz__small" }),
          w.builtin ? null : button("Delete", () => cz.deleteWorkspace(studio, w.name), { cls: "of-cz__small" }),
        ),
      );
    }
    const name = h("input.of-set__search", { type: "text", placeholder: "Workspace name", "aria-label": "Name for the new workspace", maxlength: 40 });
    name.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") save.click();
    });
    const save = button("Save current layout", () => {
      const n = cz.saveWorkspace(studio, name.value);
      if (!n) app.toast("Enter a name for the workspace.", "warning", 1800);
      else app.toast(`Workspace “${n}” saved.`, "success", 1600);
    });
    out.append(list, h("div.of-cz__bar", name, save, h("span.of-kb__spacer"), button("Reset layout of this studio", () => cz.resetLayout(studio))));
    return out;
  }

  function render() {
    const tabs = h("div.of-seg", { role: "group", "aria-label": "Studio" });
    for (const s of LAYOUT_STUDIOS) {
      const b = h("button.of-seg__btn", { type: "button", "aria-pressed": String(s === studio) }, STUDIOS[s].label);
      b.addEventListener("click", () => ((studio = s), render()));
      tabs.append(b);
    }
    root.replaceChildren(h("div.of-cz__bar", h("span.of-kb__lbl", "Studio"), tabs), workspacesGroup(), panelsGroup(), dockGroup());
  }
  const offs = [];
  offs.push(app.on("layout", () => (document.body.contains(root) ? render() : offs.forEach((o) => o()))));
  render();
  return root;
}
