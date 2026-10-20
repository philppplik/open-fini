// Right dock: two stacked tab areas whose panels depend on the studio.
import { h, empty } from "../core/util.js";
import { STUDIOS } from "../studios/index.js";
import { PANELS } from "./panels/index.js";
import { iconEl } from "./toolbox.js";
import { markContext } from "./context-menu/index.js";

export function createDock(app) {
  const topArea = makeArea();
  const bottomArea = makeArea();
  const split = h("div.of-dock__split", { role: "separator", "aria-orientation": "horizontal" });
  const el = h("aside.of-dock", { "aria-label": "Panels" }, topArea.el, split, bottomArea.el);
  const instances = new Map(); // panel id → {el, update}
  const active = { top: null, bottom: null };

  function panelInstance(id) {
    if (!instances.has(id)) {
      const def = PANELS[id];
      instances.set(id, def ? def.create(app) : { el: h("div", "Missing panel") });
    }
    return instances.get(id);
  }

  function renderArea(area, ids, key) {
    const list = ids.filter((id) => PANELS[id]);
    if (!list.includes(active[key])) active[key] = list[0] || null;
    empty(area.tabs);
    empty(area.body);
    for (const id of list) {
      const def = PANELS[id];
      const b = h("button.of-dock__tab", { type: "button", class: id === active[key] ? "active" : "", "data-tip": def.title, "aria-label": def.title }, iconEl(def.icon), h("span", def.title));
      markContext(b, "panel-header", { id, title: def.title });
      b.addEventListener("click", () => {
        active[key] = id;
        renderArea(area, ids, key);
      });
      area.tabs.append(b);
    }
    if (active[key]) {
      const inst = panelInstance(active[key]);
      area.body.append(inst.el);
      inst.show?.();
    }
    area.el.classList.toggle("hidden", !list.length);
  }

  // Panel layout tweaks made through the panel tabs' context menu (hide, move). They last for the session.
  const hiddenIds = new Set(); // `${studio}:${panel id}`
  const movedIds = new Map(); // `${studio}:${panel id}` -> "top" | "bottom"
  const keyOf = (id) => `${app.studio}:${id}`;
  function lay() {
    const s = STUDIOS[app.studio];
    const top = [];
    const bottom = [];
    for (const [list, area] of [[s.top, "top"], [s.bottom, "bottom"]]) {
      for (const id of list) {
        if (hiddenIds.has(keyOf(id))) continue;
        ((movedIds.get(keyOf(id)) || area) === "top" ? top : bottom).push(id);
      }
    }
    return { top, bottom };
  }

  function render() {
    const s = lay();
    renderArea(topArea, s.top, "top");
    renderArea(bottomArea, s.bottom, "bottom");
    split.classList.toggle("hidden", !s.top.length || !s.bottom.length);
  }

  // vertical splitter between the two areas
  split.addEventListener("pointerdown", (e) => {
    split.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const mv = (ev) => {
      const frac = Math.min(0.8, Math.max(0.2, (ev.clientY - r.top) / r.height));
      topArea.el.style.flex = `${frac} 1 0`;
      bottomArea.el.style.flex = `${1 - frac} 1 0`;
    };
    const up = () => {
      split.removeEventListener("pointermove", mv);
      split.removeEventListener("pointerup", up);
    };
    split.addEventListener("pointermove", mv);
    split.addEventListener("pointerup", up);
  });

  app.on("studio", render);
  app.on("revealpanel", (id) => {
    hiddenIds.delete(keyOf(id));
    const s = lay();
    if (s.top.includes(id)) active.top = id;
    else if (s.bottom.includes(id)) active.bottom = id;
    else return;
    render();
  });
  render();
  return {
    el,
    render,
    /** Brings a panel to the front in whichever area owns it. */
    reveal(id) {
      hiddenIds.delete(keyOf(id));
      const s = lay();
      if (s.top.includes(id)) active.top = id;
      else if (s.bottom.includes(id)) active.bottom = id;
      else return;
      render();
    },
    hidePanel(id) {
      hiddenIds.add(keyOf(id));
      render();
    },
    showPanel(id) {
      hiddenIds.delete(keyOf(id));
      this.reveal(id);
    },
    /** Moves a panel to the other area (top <-> bottom). */
    movePanel(id) {
      const s = lay();
      movedIds.set(keyOf(id), s.top.includes(id) ? "bottom" : "top");
      active[s.top.includes(id) ? "bottom" : "top"] = id;
      render();
    },
    visibleCount: () => lay().top.length + lay().bottom.length,
    canMove: (id) => lay().top.includes(id) || lay().bottom.includes(id),
    hiddenPanels: () => [...STUDIOS[app.studio].top, ...STUDIOS[app.studio].bottom].filter((id) => hiddenIds.has(keyOf(id)) && PANELS[id]).map((id) => ({ id, title: PANELS[id].title })),
    isCustomized: () => [...hiddenIds, ...movedIds.keys()].some((k) => k.startsWith(`${app.studio}:`)),
    resetPanels() {
      for (const k of [...hiddenIds]) if (k.startsWith(`${app.studio}:`)) hiddenIds.delete(k);
      for (const k of [...movedIds.keys()]) if (k.startsWith(`${app.studio}:`)) movedIds.delete(k);
      render();
    },
  };
}

function makeArea() {
  const tabs = h("div.of-dock__tabs", { role: "tablist" });
  const body = h("div.of-dock__body");
  return { el: h("section.of-dock__area", tabs, body), tabs, body };
}
