// Right dock: two stacked tab areas whose panels depend on the studio.
import { h, empty } from "../core/util.js";
import { STUDIOS } from "../studios/index.js";
import { PANELS } from "./panels/index.js";
import { iconEl } from "./toolbox.js";

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

  function render() {
    const s = STUDIOS[app.studio];
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
  render();
  return {
    el,
    render,
    /** Brings a panel to the front in whichever area owns it. */
    reveal(id) {
      const s = STUDIOS[app.studio];
      if (s.top.includes(id)) active.top = id;
      else if (s.bottom.includes(id)) active.bottom = id;
      else return;
      render();
    },
  };
}

function makeArea() {
  const tabs = h("div.of-dock__tabs", { role: "tablist" });
  const body = h("div.of-dock__body");
  return { el: h("section.of-dock__area", tabs, body), tabs, body };
}
