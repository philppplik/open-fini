// Scene Studio effects browser (docs/scene-studio.md ▸ Effects browser): every effect, transition and animation
// preset in one searchable, categorized list with favorites. Drag an item onto a clip in the timeline, or
// double-click (Enter) to apply it to the selected clips.
//
//   createBrowser(ui) → { el, focusSearch() }      `ui` = the workspace (scene/view.js)
// Items are strings: "fx:<effect type>", "tr:<in|out>:<transition>", "anim:<in|out>:<preset>" (scene/actions.js ▸
// applyBrowserItem). Favorites are a per-device convenience kept in localStorage.
import { h } from "../core/util.js";
import { t, N_ } from "../i18n/index.js";
import { EFFECTS } from "./effects.js";
import { TRANSITION_TYPES } from "./model.js";
import { CLIP_ANIMATIONS } from "./motion.js";

export const ANIM_PRESET_LABEL = {
  fade: N_("Fade"),
  "slide-from-left": N_("Slide from left"),
  "slide-from-right": N_("Slide from right"),
  "slide-from-top": N_("Slide from top"),
  "slide-from-bottom": N_("Slide from bottom"),
  zoom: N_("Zoom"),
  pop: N_("Pop"),
  spin: N_("Spin"),
  blur: N_("Blur"),
  "ken-burns": N_("Ken Burns"),
  shake: N_("Shake"),
  pulse: N_("Pulse"),
  float: N_("Float"),
};
const TR_LABEL = { fade: N_("Fade"), dissolve: N_("Cross dissolve"), "dip-black": N_("Dip to black"), "dip-white": N_("Dip to white"), "slide-left": N_("Slide left"), "slide-right": N_("Slide right"), "slide-up": N_("Slide up"), "slide-down": N_("Slide down"), "wipe-left": N_("Wipe left"), "wipe-right": N_("Wipe right"), "wipe-up": N_("Wipe up"), "wipe-down": N_("Wipe down"), zoom: N_("Zoom"), blur: N_("Blur") };
const GROUP_LABEL = { Color: N_("Color"), Keying: N_("Keying"), Blur: N_("Blur"), Stylize: N_("Stylize"), Audio: N_("Audio"), Other: N_("Other") };
const CONTINUOUS = ["ken-burns", "shake", "pulse", "float"];
const FAV_KEY = "ofini.scene.favorites";

function loadFavs() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function saveFavs(set) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
  } catch {
    /* private mode: favorites last for this session */
  }
}

/** Every browser item: { id, label, group, icon, hint }. */
export function browserItems() {
  const out = [];
  for (const [type, d] of Object.entries(EFFECTS)) out.push({ id: `fx:${type}`, label: t(d.label), group: t(GROUP_LABEL[d.group] || d.group || "Other"), section: "effects", icon: d.stage === "audio" ? "music-note-beamed" : "stars", hint: d.stage === "audio" ? t("Audio clips") : t("Picture clips") });
  for (const edge of ["in", "out"]) for (const x of TRANSITION_TYPES) out.push({ id: `tr:${edge}:${x}`, label: t(TR_LABEL[x] || x), group: edge === "in" ? t("Transitions at the start") : t("Transitions at the end"), section: "transitions", icon: "intersect" });
  for (const p of CLIP_ANIMATIONS) {
    if (CONTINUOUS.includes(p)) out.push({ id: `anim:in:${p}`, label: t(ANIM_PRESET_LABEL[p]), group: t("Continuous animation"), section: "animations", icon: "arrow-repeat" });
    else for (const edge of ["in", "out"]) out.push({ id: `anim:${edge}:${p}`, label: t(ANIM_PRESET_LABEL[p]), group: edge === "in" ? t("Animate in") : t("Animate out"), section: "animations", icon: "magic" });
  }
  return out;
}

export function createBrowser(ui) {
  const favs = loadFavs();
  const search = h("input.of-scene-insp__text.of-scene-fxb__search", { type: "search", placeholder: t("Search effects, transitions, animations"), "aria-label": t("Search effects") });
  const list = h("div.of-scene-fxb__list", { role: "list", "aria-label": t("Effects") });
  const el = h("div.of-scene-fxb", search, list);
  const closed = new Set();

  const apply = (id) => {
    const ids = ui.selection();
    if (!ids.length) return ui.toast(t("Select clips first, or drag the item onto a clip."));
    for (const c of ids) ui.applyBrowserItem(id, c);
  };

  function row(it) {
    const star = h("button.of-scene-insp__x", { type: "button", title: favs.has(it.id) ? t("Remove from favorites") : t("Add to favorites"), "aria-label": t("Favorite"), "aria-pressed": String(favs.has(it.id)) }, h("sl-icon", { name: favs.has(it.id) ? "star-fill" : "star" }));
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      if (favs.has(it.id)) favs.delete(it.id);
      else favs.add(it.id);
      saveFavs(favs);
      render();
    });
    const el2 = h("div.of-scene-fxb__item", { role: "listitem", draggable: "true", tabindex: "0", title: t("Drag onto a clip, or double-click to apply to the selected clips") }, h("sl-icon", { name: it.icon }), h("span", it.label), star);
    el2.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(it.section === "effects" ? "application/x-ofini-scene-effect" : "application/x-ofini-scene-preset", it.id);
      e.dataTransfer.effectAllowed = "copy";
    });
    el2.addEventListener("dblclick", () => apply(it.id));
    el2.addEventListener("keydown", (e) => {
      if (e.key === "Enter") apply(it.id);
    });
    return el2;
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const items = browserItems().filter((it) => !q || `${it.label} ${it.group}`.toLowerCase().includes(q));
    const byGroup = new Map();
    const fav = items.filter((it) => favs.has(it.id));
    if (fav.length) byGroup.set(t("Favorites"), fav);
    for (const it of items) {
      if (!byGroup.has(it.group)) byGroup.set(it.group, []);
      byGroup.get(it.group).push(it);
    }
    list.replaceChildren(
      ...(items.length
        ? [...byGroup].map(([g, its]) => {
            const open = q || !closed.has(g);
            const head = h("button.of-scene-fxb__group", { type: "button", "aria-expanded": String(!!open) }, h("sl-icon", { name: open ? "chevron-down" : "chevron-right" }), h("span", g), h("i", String(its.length)));
            head.addEventListener("click", () => {
              if (closed.has(g)) closed.delete(g);
              else closed.add(g);
              render();
            });
            return h("div.of-scene-fxb__sec", head, ...(open ? its.map(row) : []));
          })
        : [h("p.of-scene-bin__empty", t("Nothing matches “{q}”.", { q: search.value }))]),
    );
  }
  search.addEventListener("input", render);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      search.value = "";
      render();
    }
  });
  render();
  return { el, focusSearch: () => search.focus() };
}
