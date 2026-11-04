// Responsive shell header (lazy, loaded right after the first frame). A ResizeObserver measures the real header: when it
// overflows, things are shed in a fixed order (core/header-plan.js) so the window controls never leave the screen:
//   1 brand name "OpenFini" -> "oFini"   2 studio names -> icons   3 header actions (into the "…" menu)
//   4 studio tabs -> active studio + "…"  5 menubar menus (into the "…" menu)   6 brand text -> logo only
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { fitSteps } from "../core/header-plan.js";
import { buildMenu } from "./menus.js";

export function installHeaderFit(app, header, { studioBar }) {
  const brandText = header.querySelector(".of-brand > span:not(.of-brand__logo)");
  const menubar = header.querySelector(".of-menubar");
  const actions = header.querySelector(".of-header__actions");
  const wc = header.querySelector(".of-wc");
  if (!brandText || !menubar || !actions || !studioBar) return;

  const more = h("button.of-menubtn.of-overflow__btn", { type: "button", slot: "trigger", "aria-haspopup": "menu", "aria-label": t("More"), "data-tip": t("More") }, h("sl-icon", { name: "three-dots" }));
  const dd = h("sl-dropdown.of-overflow", { distance: 4, placement: "bottom-end", hoist: true, hidden: true }, more);
  header.insertBefore(dd, actions);
  const hid = (el, on) => el.classList.toggle("is-fit-hidden", on);
  const hiddenMenus = () => [...menubar.children].filter((m) => m.classList.contains("is-fit-hidden") && !m.classList.contains("hidden"));
  const hiddenActions = () => [...actions.children].filter((b) => b.classList.contains("is-fit-hidden") && b.dataset.cmd);

  dd.addEventListener("sl-show", (e) => {
    if (e.target !== dd) return;
    for (const c of [...dd.children]) if (c.tagName === "SL-MENU") c.remove();
    const items = hiddenActions().map((b) => b.dataset.cmd);
    if (items.length) items.push("-");
    for (const m of hiddenMenus()) {
      const all = app.extMenuItems ? m._entry.items.concat(app.extMenuItems(m._entry.label, app.studio)) : m._entry.items;
      items.push({ label: m._entry.label, items: app.customize ? app.customize.filterMenu(all) : all });
    }
    dd.append(buildMenu(app, items));
  });

  const ops = () => {
    const list = [
      { set: (on) => (brandText.textContent = on ? "oFini" : "OpenFini") },
      { set: (on) => header.classList.toggle("fit-icons", on) },
    ];
    // header actions: the panels toggle stays; the rightmost go first
    const acts = [...actions.children].filter((b) => b.dataset.cmd && !b.hidden).reverse();
    for (const b of acts) list.push({ set: (on) => hid(b, on) });
    list.push({ set: (on) => studioBar.setCollapsed(on) });
    const menus = [...menubar.children].filter((m) => !m.classList.contains("hidden")).reverse();
    for (const m of menus) list.push({ set: (on) => hid(m, on) });
    list.push({ set: (on) => header.classList.toggle("fit-logo", on) });
    return list;
  };

  const syncMore = () => (dd.hidden = !(hiddenActions().length || hiddenMenus().length));
  // overflow: the header's content is wider than the header, or the controls are not fully inside the window
  const overflows = () => {
    syncMore();
    if (header.scrollWidth > header.clientWidth + 1) return true;
    return !!wc && wc.getBoundingClientRect().right > document.documentElement.clientWidth + 1;
  };

  let level = 0;
  let queued = 0;
  const run = () => {
    queued = 0;
    level = fitSteps(ops(), overflows, level);
    syncMore();
  };
  const schedule = () => {
    if (!queued) queued = requestAnimationFrame(run);
  };
  new ResizeObserver(schedule).observe(header);
  new MutationObserver(schedule).observe(actions, { childList: true });
  for (const ev of ["studio", "doc", "menuschanged", "locale", "prefs", "quickactions"]) app.on(ev, schedule);
  schedule();
}
