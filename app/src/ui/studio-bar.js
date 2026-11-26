// Header studio switcher: the studios the user picked (Settings > Studios), plus a "More" menu with every other
// registered studio so none is unreachable. A narrow header sheds the rightmost picked studios into that menu one by
// one (ui/header-fit.js calls setShed), never the active one. Opening a studio from "More" shows it
// there temporarily: the More button turns into that studio's button until another studio is chosen.
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { iconEl } from "./toolbox.js";
import { buildMenu } from "./menus.js";
import { markContext } from "./context-menu/index.js";
import { STUDIOS, onStudioRegistered, studioIconSpec } from "../studios/registry.js";

export function createStudioBar(app) {
  const el = h("div.of-studios", { role: "tablist", "aria-label": t("Studios") });
  /** @type {Map<string, HTMLButtonElement>} */
  let buttons = new Map();
  let moreBtn = null;
  let shed = 0; // narrow header: this many of the picked studios (rightmost first, not the active one) live in "More"
  const shedIds = () => (shed > 0 ? app.visibleStudios.filter((id) => id !== app.studio).slice(-shed) : []);

  function tip(s) {
    const name = t("{studio} Studio", { studio: s.label });
    return s.blurb ? `${name} — ${t(s.blurb)}` : name;
  }

  function render() {
    el.replaceChildren();
    buttons = new Map();
    moreBtn = null;
    app.visibleStudios.forEach((id, i) => {
      const s = STUDIOS[id];
      const b = h("button.of-studio", { type: "button", "data-studio": id, "data-tip": tip(s), "data-shortcut": `Alt+${i + 1}`, "aria-pressed": "false" }, iconEl(studioIconSpec(s)), h("span", s.label));
      markContext(b, "studio-button", { studio: id });
      b.addEventListener("click", () => app.setStudio(id, { user: true }));
      buttons.set(id, b);
      el.append(b);
    });
    el.append(createMore());
    sync();
  }

  function createMore() {
    moreBtn = h("button.of-studio.of-studio--more", { type: "button", slot: "trigger", "data-tip": t("More studios"), "aria-haspopup": "menu", "aria-pressed": "false" });
    const dd = h("sl-dropdown.of-studios__more", { distance: 6, hoist: true }, moreBtn);
    dd.dataset.empty = app.moreStudios.length ? "" : "1";
    dd.addEventListener("sl-show", (e) => {
      if (e.target !== dd) return;
      for (const c of [...dd.children]) if (c.tagName === "SL-MENU") c.remove();
      const order = app.visibleStudios;
      const shown = shedIds().sort((a, b) => order.indexOf(a) - order.indexOf(b));
      dd.append(buildMenu(app, [...shown, ...app.moreStudios].map((id) => `studio.${id}`).concat(["-", "studio.choose"])));
    });
    return dd;
  }

  function applyShed() {
    const gone = new Set(shedIds());
    for (const [id, b] of buttons) b.classList.toggle("is-fit-hidden", gone.has(id));
    el.classList.toggle("is-collapsed", gone.size > 0);
  }

  function sync() {
    applyShed();
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
    moreBtn.replaceChildren(iconEl(hidden ? studioIconSpec(hidden) : "three-dots"), h("span", hidden ? hidden.label : t("More")), h("sl-icon.of-studio__caret", { name: "chevron-down" }));
  }

  /** Moves `n` studios out of the header into "More" (0 = all shown). Returns how many can be shed at most. */
  function setShed(n) {
    shed = Math.max(0, Math.min(n | 0, maxShed()));
    applyShed();
  }
  const maxShed = () => app.visibleStudios.filter((id) => id !== app.studio).length;

  app.on("studio", sync);
  app.on("locale", () => {
    el.setAttribute("aria-label", t("Studios"));
    render();
  });
  app.on("prefs", (key) => (key === "visibleStudios" || key === "*") && render());
  onStudioRegistered(render);
  render();
  return { el, sync, render, setShed, maxShed, shedCount: () => shed };
}
