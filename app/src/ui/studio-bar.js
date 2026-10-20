// Header studio switcher: at most five studios side by side (the user's choice, see Settings > Studios), plus a
// "More" menu with every other registered studio so none is unreachable. Opening a studio from "More" shows it
// there temporarily: the More button turns into that studio's button until another studio is chosen.
import { h } from "../core/util.js";
import { iconEl } from "./toolbox.js";
import { buildMenu } from "./menus.js";
import { markContext } from "./context-menu/index.js";
import { STUDIOS, onStudioRegistered, studioIconSpec } from "../studios/registry.js";

export function createStudioBar(app) {
  const el = h("div.of-studios", { role: "tablist", "aria-label": "Studios" });
  /** @type {Map<string, HTMLButtonElement>} */
  let buttons = new Map();
  let moreBtn = null;

  function tip(s) {
    return `${s.label} Studio${s.blurb ? ` — ${s.blurb}` : ""}`;
  }

  function render() {
    el.replaceChildren();
    buttons = new Map();
    moreBtn = null;
    app.visibleStudios.forEach((id, i) => {
      const s = STUDIOS[id];
      const b = h("button.of-studio", { type: "button", "data-studio": id, "data-tip": tip(s), "data-shortcut": `Alt+${i + 1}`, "aria-pressed": "false" }, iconEl(studioIconSpec(s)), h("span", s.label));
      markContext(b, "studio-button", { studio: id });
      b.addEventListener("click", () => app.setStudio(id));
      buttons.set(id, b);
      el.append(b);
    });
    if (app.moreStudios.length) el.append(createMore());
    sync();
  }

  function createMore() {
    moreBtn = h("button.of-studio.of-studio--more", { type: "button", slot: "trigger", "data-tip": "More studios", "aria-haspopup": "menu", "aria-pressed": "false" });
    const dd = h("sl-dropdown.of-studios__more", { distance: 6, hoist: true }, moreBtn);
    dd.addEventListener("sl-show", (e) => {
      if (e.target !== dd) return;
      for (const c of [...dd.children]) if (c.tagName === "SL-MENU") c.remove();
      dd.append(buildMenu(app, [...app.moreStudios.map((id) => `studio.${id}`), "-", "studio.choose"]));
    });
    return dd;
  }

  function sync() {
    for (const [id, b] of buttons) {
      const on = id === app.studio;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    if (!moreBtn) return;
    // a studio that is not in the header (opened from More) takes the place of the "More" label while it is open
    const hidden = !buttons.has(app.studio) && STUDIOS[app.studio] ? STUDIOS[app.studio] : null;
    moreBtn.classList.toggle("active", !!hidden);
    moreBtn.setAttribute("aria-pressed", String(!!hidden));
    moreBtn.replaceChildren(iconEl(hidden ? studioIconSpec(hidden) : "three-dots"), h("span", hidden ? hidden.label : "More"), h("sl-icon.of-studio__caret", { name: "chevron-down" }));
  }

  app.on("studio", sync);
  app.on("prefs", (key) => (key === "visibleStudios" || key === "*") && render());
  onStudioRegistered(render);
  render();
  return { el, sync, render };
}
