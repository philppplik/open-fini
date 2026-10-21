// Settings ▸ Appearance: the theme gallery. Swatch cards with a live mini-preview of the app chrome, grouped, arranged
// as an ARIA radio group (arrow keys move and select, Home/End jump). Applies without reload through the prefs.
import { h } from "../core/util.js";
import { listThemes, resolveVars, onThemesChanged } from "./themes.js";
import { isDark, accentOverride } from "./appearance.js";

function card(app, theme, dark, selected) {
  const v = resolveVars(theme, dark ? "dark" : "light", { accent: accentOverride(app.prefs) });
  const style = {
    "--t-app": v["--of-bg-app"], "--t-bar": v["--of-bg-bar"], "--t-panel": v["--of-bg-panel"], "--t-raised": v["--of-bg-raised"],
    "--t-canvas": v["--of-bg-canvas"], "--t-border": v["--of-border"], "--t-text": v["--of-text"], "--t-dim": v["--of-text-dim"], "--t-accent": v["--of-accent"],
  };
  const pv = h("div.of-theme__pv", { "aria-hidden": "true" },
    h("div.pv-bar", h("b"), h("b"), h("b")),
    h("div.pv-tools", h("b"), h("b"), h("b")),
    h("div.pv-canvas", h("div.pv-page", h("b"))),
    h("div.pv-dock", h("b"), h("b"), h("b")));
  for (const [k, val] of Object.entries(style)) pv.style.setProperty(k, val); // custom properties need setProperty
  const b = h("button.of-theme", { type: "button", role: "radio", "aria-checked": String(selected), tabindex: selected ? "0" : "-1", "data-theme-id": theme.id, "aria-label": `${theme.name}. ${theme.description}` },
    pv,
    h("span.of-theme__name", theme.name, h("sl-icon", { name: "check-circle-fill" })),
    h("span.of-theme__desc", theme.description));
  return b;
}

/** Builds the gallery element. It re-renders itself when the mode, accent or the registered themes change. */
export function themeGallery(app) {
  const root = h("div.of-themes", { role: "radiogroup", "aria-label": "Color theme" });
  function render() {
    const dark = isDark(app.prefs);
    const current = app.prefs.themeId || "default";
    root.replaceChildren();
    const groups = new Map();
    for (const t of listThemes()) {
      if (!groups.has(t.group)) groups.set(t.group, []);
      groups.get(t.group).push(t);
    }
    const exists = listThemes().some((t) => t.id === current);
    for (const [name, list] of groups) {
      root.append(h("div.of-themes__group", h("h4", name), h("div.of-themes__grid", list.map((t) => card(app, t, dark, t.id === (exists ? current : "default"))))));
    }
  }
  const choose = (id) => app.setPref("themeId", id);
  root.addEventListener("click", (e) => {
    const b = e.target.closest?.(".of-theme");
    if (b) choose(b.dataset.themeId);
  });
  root.addEventListener("keydown", (e) => {
    const cards = [...root.querySelectorAll(".of-theme")];
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % cards.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + cards.length) % cards.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = cards.length - 1;
    if (n < 0) return;
    e.preventDefault();
    choose(cards[n].dataset.themeId); // re-renders; restore focus on the new card
    root.querySelector(`[data-theme-id="${cards[n].dataset.themeId}"]`)?.focus();
  });
  render();
  const offs = [
    app.on("prefs", (key) => {
      if (!root.isConnected) return offs.forEach((f) => f());
      if (["theme", "themeId", "accent", "accentCustom", "highContrast", "*"].includes(key)) {
        const hadFocus = root.contains(document.activeElement);
        render();
        if (hadFocus) root.querySelector('[aria-checked="true"]')?.focus();
      }
    }),
    onThemesChanged(() => root.isConnected && render()),
  ];
  return root;
}
