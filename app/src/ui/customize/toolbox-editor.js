// Settings > Toolbox and menus: per-studio tool visibility, order and grouping; hidden menus and menu items;
// the quick actions of the header. Everything hidden stays reachable from the command palette (Ctrl+K).
import { h } from "../../core/util.js";
import { button } from "../controls.js";
import { iconEl } from "../toolbox.js";
import { STUDIOS, toolboxFor } from "../../studios/index.js";
import { MENUS } from "../menus.js";
import { editorRows, moveKey, moveKeyBefore, setToolVisible, setUngrouped, menuCommandIds } from "../../customize/toolbox-model.js";
import { QUICK_ACTIONS } from "../../customize/schema.js";
import { BUILTIN_LABELS } from "./quick-actions.js";

const TOOL_STUDIOS = ["vector", "pixel", "layout"];

export function toolboxEditor(app) {
  const cz = app.customize;
  let studio = TOOL_STUDIOS.includes(app.studio) ? app.studio : "vector";
  const root = h("div.of-cz");

  const checkbox = (checked, label, onChange) => {
    const cb = h("input", { type: "checkbox", "aria-label": label });
    cb.checked = checked;
    cb.addEventListener("change", () => onChange(cb.checked));
    return cb;
  };

  // ---------------------------------------------------------------- tools
  function toolsGroup() {
    const entries = toolboxFor(studio);
    const cfg = cz.toolboxConfig(studio);
    const rows = editorRows(entries, cfg, (id) => app.toolClasses.has(id));
    const keys = rows.map((r) => r.key);
    const tabs = h("div.of-seg", { role: "group", "aria-label": "Studio" });
    for (const s of TOOL_STUDIOS) {
      const b = h("button.of-seg__btn", { type: "button", "aria-pressed": String(s === studio) }, STUDIOS[s].label);
      b.addEventListener("click", () => ((studio = s), render()));
      tabs.append(b);
    }
    const list = h("ul.of-cz__list", { "aria-label": `Tools of the ${STUDIOS[studio].label} studio` });
    let dragKey = null;
    rows.forEach((r, i) => {
      const names = r.ids.map((id) => {
        const C = app.toolClasses.get(id);
        const cb = checkbox(!r.hidden.includes(id), `Show ${C.label}`, (v) => cz.setToolboxConfig(studio, setToolVisible(cz.toolboxConfig(studio), id, v)));
        return h("label.of-cz__tool", cb, iconEl(C.icon), h("span", C.label), C.shortcut ? h("kbd", C.shortcut) : null);
      });
      const li = h("li.of-cz__item", { draggable: "true", "data-key": r.key });
      const up = h("button.of-cz__move", { type: "button", "aria-label": `Move ${r.ids[0]} up`, disabled: i === 0, onclick: () => cz.setToolboxConfig(studio, { ...cz.toolboxConfig(studio), order: moveKey(keys, cfg.order || [], r.key, -1) }) }, iconEl("chevron-up"));
      const down = h("button.of-cz__move", { type: "button", "aria-label": `Move ${r.ids[0]} down`, disabled: i === rows.length - 1, onclick: () => cz.setToolboxConfig(studio, { ...cz.toolboxConfig(studio), order: moveKey(keys, cfg.order || [], r.key, 1) }) }, iconEl("chevron-down"));
      li.append(...[h("span.of-cz__grip", { "aria-hidden": "true" }, iconEl("list")), h("div.of-cz__names", ...names), r.canUngroup ? button("Show separately", () => cz.setToolboxConfig(studio, setUngrouped(cz.toolboxConfig(studio), r.origin, true)), { cls: "of-cz__small" }) : null, r.ungrouped ? button("Group again", () => cz.setToolboxConfig(studio, setUngrouped(cz.toolboxConfig(studio), r.origin, false)), { cls: "of-cz__small" }) : null, up, down].filter(Boolean));
      li.addEventListener("dragstart", (e) => {
        dragKey = r.key;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", r.key);
      });
      li.addEventListener("dragover", (e) => {
        if (dragKey) {
          e.preventDefault();
          li.classList.add("over");
        }
      });
      li.addEventListener("dragleave", () => li.classList.remove("over"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        li.classList.remove("over");
        if (dragKey && dragKey !== r.key) cz.setToolboxConfig(studio, { ...cz.toolboxConfig(studio), order: moveKeyBefore(keys, cfg.order || [], dragKey, r.key) });
        dragKey = null;
      });
      list.append(li);
    });
    const hiddenCount = rows.reduce((n, r) => n + r.hidden.length, 0);
    return h(
      "section.of-set__group",
      h("h3", "Tools"),
      h("p.of-set__hint", "Untick a tool to hide it from the toolbox, drag rows or use the arrows to reorder. A hidden tool keeps its shortcut and stays available in the command palette as “Tool: …”. Groups open with a long press or right-click on the button."),
      h("div.of-cz__bar", tabs, h("span.of-kb__spacer"), hiddenCount || Object.keys(cfg).length ? button("Reset this toolbox", () => cz.setToolboxConfig(studio, {})) : null),
      list,
    );
  }

  // ---------------------------------------------------------------- menus
  function menusGroup() {
    const hidden = { menus: app.prefs.menus?.menus || [], items: app.prefs.menus?.items || [] };
    const labels = [...new Set(MENUS.map((m) => m.label))];
    const out = h("section.of-set__group", h("h3", "Menus"), h("p.of-set__hint", "Hide whole menus or single menu items. Hidden commands remain in the command palette and keep their shortcuts."));
    const save = (menus) => cz.setMenus({ menus: menus.menus || [], items: menus.items || [] });
    for (const label of labels) {
      const parts = MENUS.filter((m) => m.label === label);
      const ids = [...new Set(parts.flatMap((m) => menuCommandIds(m.items)))].filter((id) => app.commands.has(id));
      const shownMenu = !(hidden.menus || []).includes(label);
      const where = [...new Set(parts.flatMap((m) => m.studios || ["all studios"]))].map((s) => STUDIOS[s]?.label || s).join(", ");
      const det = h("details.of-cz__menu");
      det.append(h("summary", checkbox(shownMenu, `Show the ${label} menu`, (v) => save({ ...hidden, menus: v ? hidden.menus.filter((x) => x !== label) : [...hidden.menus, label] })), h("span.of-cz__menuname", label), h("small", where)));
      const inner = h("div.of-cz__cmds");
      for (const id of ids) {
        const c = app.commands.get(id);
        inner.append(h("label.of-cz__cmd", checkbox(!(hidden.items || []).includes(id), `Show ${c.label}`, (v) => save({ ...hidden, items: v ? hidden.items.filter((x) => x !== id) : [...hidden.items, id] })), h("span", c.label), c.shortcut ? h("kbd", c.shortcut) : null));
      }
      det.append(inner);
      out.append(det);
    }
    const n = (hidden.menus || []).length + (hidden.items || []).length;
    if (n) out.append(h("div.of-cz__bar", button(`Show everything again (${n} hidden)`, () => save({ menus: [], items: [] }))));
    return out;
  }

  // ---------------------------------------------------------------- quick actions
  function quickGroup() {
    const cur = Array.isArray(app.prefs.quickActions) ? app.prefs.quickActions : [];
    const set = (list) => cz.setQuickActions(list);
    const all = [...QUICK_ACTIONS.filter((id) => !cur.includes(id)).map((id) => ({ id, off: true })), ...[]];
    const list = h("ul.of-cz__list", { "aria-label": "Quick actions in the header" });
    const label = (id) => BUILTIN_LABELS[id] || app.commands.get(id)?.label || id;
    cur.forEach((id, i) => {
      const li = h("li.of-cz__item");
      li.append(
        h("div.of-cz__names", h("span", label(id)), QUICK_ACTIONS.includes(id) ? null : h("small", id)),
        h("button.of-cz__move", { type: "button", "aria-label": `Move ${label(id)} left`, disabled: i === 0, onclick: () => { const n = cur.slice(); n.splice(i - 1, 0, n.splice(i, 1)[0]); set(n); render(); } }, iconEl("chevron-up")),
        h("button.of-cz__move", { type: "button", "aria-label": `Move ${label(id)} right`, disabled: i === cur.length - 1, onclick: () => { const n = cur.slice(); n.splice(i + 1, 0, n.splice(i, 1)[0]); set(n); render(); } }, iconEl("chevron-down")),
        button("Remove", () => { set(cur.filter((x) => x !== id)); render(); }, { cls: "of-cz__small" }),
      );
      list.append(li);
    });
    if (!cur.length) list.append(h("li.of-cz__item", h("span.of-set__hint", "No quick actions are shown.")));
    const add = h("select", { "aria-label": "Add a quick action" }, h("option", { value: "" }, "Add a button…"));
    const builtinOff = all.map((x) => x.id);
    if (builtinOff.length) add.append(h("optgroup", { label: "Built-in" }, ...builtinOff.map((id) => h("option", { value: id }, BUILTIN_LABELS[id]))));
    const cmds = [...app.commands.values()].filter((c) => c.label && c.icon && !cur.includes(c.id) && !c.id.startsWith("tool.select.")).sort((a, b) => a.label.localeCompare(b.label));
    add.append(h("optgroup", { label: "Any command with an icon" }, ...cmds.map((c) => h("option", { value: c.id }, c.label))));
    add.addEventListener("change", () => {
      if (add.value) {
        set([...cur, add.value]);
        render();
      }
    });
    return h("section.of-set__group", h("h3", "Quick actions in the header"), h("p.of-set__hint", "The buttons at the right of the header. Add any command that has an icon, remove what you do not use, and reorder."), list, h("div.of-cz__bar", add, h("span.of-kb__spacer"), button("Reset quick actions", () => { cz.resetKeys(["quickActions"]); app.emit("quickactions"); render(); })));
  }

  function render() {
    root.replaceChildren(toolsGroup(), menusGroup(), quickGroup());
  }
  const offs = [];
  for (const ev of ["toolboxchanged", "menuschanged", "quickactions"]) offs.push(app.on(ev, () => (document.body.contains(root) ? render() : offs.forEach((o) => o()))));
  app.on("studio", () => document.body.contains(root) && TOOL_STUDIOS.includes(app.studio) && studio !== app.studio && ((studio = app.studio), render()));
  render();
  return root;
}
