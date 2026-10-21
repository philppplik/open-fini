// Settings ▸ Appearance ▸ Surface style: four live preview cards (an ARIA radio group, arrow keys move and select),
// the Blur / Transparency / Dim sliders, the background layer choices and the user's own image.
// Everything is a normal preference (surfaceStyle, glassBlur, glassTransparency, glassBackdrop, glassDim, glassAnimate);
// the image lives in kv storage only (ui/glass-dom.js). The visual result is app/styles/glass.css.
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import { sliderField, switchField, button } from "./controls.js";
import { SURFACE_STYLES, STYLE_DEFS, BACKDROPS, glassSettings, effectiveBackdrop, fxState } from "./glass.js";
import { glassEnv, hasGlassImage, glassImageName, onGlassImageChange, setGlassImage, clearGlassImage } from "./glass-dom.js";
import { getTheme } from "./themes.js";
import { isDark } from "./appearance.js";

const NAMES = { solid: () => t("Solid"), glass: () => t("Glass"), liquid: () => t("Liquid glass"), sea: () => t("Sea glass") };
const DESCS = {
  solid: () => t("Opaque panels. The default and the fastest look."),
  glass: () => t("Frosted glass: blurred, translucent panels with a thin light edge."),
  liquid: () => t("Thick, refractive glass with bevelled edges and a soft specular sheen."),
  sea: () => t("Muted green-teal, matte and softly grained, like weathered sea glass."),
};
const BD_NAMES = { auto: () => t("Automatic"), aurora: () => t("Aurora"), ocean: () => t("Ocean"), dusk: () => t("Dusk"), seaglass: () => t("Sea glass"), mono: () => t("Mono"), accent: () => t("Accent"), image: () => t("My image") };
const REASONS = {
  "low-power": () => t("Blur is off because Low-power mode is on. Panels are drawn opaque with the same tint."),
  "high-contrast": () => t("Blur is off because High contrast is on (or your system asks for more contrast). Panels are drawn opaque."),
  "reduced-transparency": () => t("Blur is off because your system asks for reduced transparency. Panels are drawn opaque."),
  unsupported: () => t("This browser cannot blur what is behind a panel, so panels are drawn opaque."),
};

const swatch = (bg) => {
  const i = h("i");
  i.style.setProperty("--bd", bg); // custom properties need setProperty
  return i;
};

function card(style, dark, selected, accentless) {
  const def = STYLE_DEFS[style];
  const alpha = style === "solid" ? 1 : 1 - def.transparency / 100;
  const tint = def.tint ? (dark ? def.tint.dark : def.tint.light) : "transparent";
  const pv = h("div.of-surface__pv", { "aria-hidden": "true" }, h("i"), h("i"), h("i"));
  const set = (k, v) => pv.style.setProperty(k, v);
  set("--sp-bg", "var(--of-bg-app)");
  set("--sp-mesh", style === "solid" ? "none" : `var(--of-glass-mesh-${def.backdrop})`);
  set("--sp-fill", `color-mix(in srgb, color-mix(in srgb, var(--of-bg-panel), ${tint} ${def.tintAmount}%) ${Math.round(alpha * 100)}%, transparent)`);
  set("--sp-edge", style === "solid" ? "var(--of-border)" : dark ? "rgba(255,255,255,.28)" : "rgba(255,255,255,.8)");
  set("--sp-blur", `${Math.round(def.blur / 3)}px`);
  set("--sp-r", style === "liquid" ? "6px" : style === "sea" ? "5px" : "3px");
  set("--sp-shadow", style === "liquid" ? "inset 0 1px 0 rgba(255,255,255,.55), inset 0 -1px 0 rgba(0,0,0,.2)" : "none");
  set("--sp-canvas", "var(--of-bg-canvas)");
  void accentless;
  return h("button.of-surface", { type: "button", role: "radio", "aria-checked": String(selected), tabindex: selected ? "0" : "-1", "data-surface-id": style, "aria-label": `${NAMES[style]()}. ${DESCS[style]()}` },
    pv, h("span.of-surface__name", NAMES[style](), h("sl-icon", { name: "check-circle-fill" })), h("span.of-surface__desc", DESCS[style]()));
}

/** Builds the surface style block for the Appearance section. It re-renders itself when the preferences change. */
export function surfaceGallery(app) {
  const root = h("div.of-surface-block");
  let busy = false;

  const set = (key, value) => app.setPref(key, value);

  function build() {
    const p = app.prefs;
    const dark = isDark(p);
    const s = glassSettings(p);
    const cur = s.style;
    const optedOut = getTheme(p.themeId || "default")?.surface === "none";
    const recommended = getTheme(p.themeId || "default")?.surface;

    const cards = h("div.of-surfaces", { role: "radiogroup", "aria-label": t("Surface style") }, SURFACE_STYLES.map((id) => card(id, dark, id === cur)));
    cards.addEventListener("click", (e) => {
      const b = e.target.closest?.(".of-surface");
      if (b) set("surfaceStyle", b.dataset.surfaceId);
    });
    cards.addEventListener("keydown", (e) => {
      const all = [...cards.querySelectorAll(".of-surface")];
      const i = all.indexOf(document.activeElement);
      if (i < 0) return;
      let n = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % all.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + all.length) % all.length;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = all.length - 1;
      if (n < 0) return;
      e.preventDefault();
      const id = all[n].dataset.surfaceId;
      set("surfaceStyle", id);
      root.querySelector(`[data-surface-id="${id}"]`)?.focus();
    });

    const parts = [cards];
    const note = (text) => h("div.of-surface-note", { role: "note" }, text);
    if (optedOut) parts.push(note(t("The current color theme turns surface styles off.")));
    else if (recommended && recommended !== "none" && recommended !== cur) parts.push(note(t("The current color theme looks best with “{style}”.", { style: NAMES[recommended]?.() || recommended })));

    if (cur !== "solid" && !optedOut) {
      const fx = fxState(cur, glassEnv(app));
      if (!fx.on) parts.push(note(REASONS[fx.reason]?.() || ""));
      const ctl = h("div.of-surface-ctl");
      const slider = (label, key, value, min, max, unit) => sliderField({ label, value, min, max, step: 1, unit, onChange: (v) => { busy = true; set(key, Math.round(v)); busy = false; } }).el;
      ctl.append(
        slider(t("Blur"), "glassBlur", s.blur, 0, 40, "px"),
        slider(t("Transparency"), "glassTransparency", s.transparency, 0, 50, "%"),
        slider(t("Dim"), "glassDim", s.dim, 0, 80, "%"),
        switchField({ label: t("Slowly move the background"), value: s.animate, onChange: (v) => set("glassAnimate", v) }).el,
      );
      parts.push(ctl);

      // background layer: presets, accent gradient, own image
      const shown = effectiveBackdrop(s, hasGlassImage());
      const choices = h("div.of-bdchoices", { role: "radiogroup", "aria-label": t("Background layer") });
      for (const b of BACKDROPS) {
        if (b.id === "image" && !hasGlassImage()) continue;
        const id = b.id === "auto" ? STYLE_DEFS[cur].backdrop : b.id;
        const sel = s.backdrop === b.id || (s.backdrop === "image" && !hasGlassImage() && b.id === "auto");
        const el = h("button.of-bdchoice", { type: "button", role: "radio", "aria-checked": String(sel), tabindex: sel ? "0" : "-1", "data-bd": b.id, "aria-label": BD_NAMES[b.id]() },
          swatch(b.id === "image" ? "var(--of-glass-mesh-image)" : `var(--of-glass-mesh-${id})`), h("span", BD_NAMES[b.id]()));
        el.addEventListener("click", () => set("glassBackdrop", b.id));
        el.addEventListener("keydown", (e) => {
          const all = [...choices.querySelectorAll(".of-bdchoice")];
          const i = all.indexOf(el);
          const n = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % all.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + all.length) % all.length : -1;
          if (n < 0) return;
          e.preventDefault();
          set("glassBackdrop", all[n].dataset.bd);
          root.querySelector(`[data-bd="${all[n].dataset.bd}"]`)?.focus();
        });
        choices.append(el);
      }
      const file = h("input", { type: "file", accept: "image/*", hidden: true, "aria-hidden": "true" });
      file.addEventListener("change", async () => {
        const f = file.files?.[0];
        file.value = "";
        if (!f) return;
        try {
          await setGlassImage(f);
          set("glassBackdrop", "image");
          app.toast(t("Background image set. It stays on this device."), "success");
        } catch (err) {
          app.toast(err?.message ? t(err.message) : t("Could not use that image."), "danger", 5000);
        }
      });
      const actions = h("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" },
        button(t("Choose image…"), () => file.click(), { icon: "image" }),
        hasGlassImage() ? button(t("Remove image"), async () => { await clearGlassImage(); if (app.prefs.glassBackdrop === "image") set("glassBackdrop", "auto"); }, { icon: "trash" }) : null,
        h("span.of-surface-note", hasGlassImage() ? t("{name}: scaled to 1920 px or less and stored only on this device. It is never exported with a profile.", { name: glassImageName() }) : t("Optional. Stored only on this device, never exported with a profile.")),
        file);
      parts.push(h("div.of-set__label", t("Background layer")), choices, actions);
      void shown;
    }
    root.replaceChildren(...parts);
  }

  build();
  const offs = [
    app.on("prefs", (key) => {
      if (!root.isConnected) return offs.forEach((f) => f());
      if (busy) return;
      if (/^(surfaceStyle|glass|theme|themeId|accent|highContrast|lowPower|\*)/.test(String(key))) {
        const had = root.contains(document.activeElement);
        const focusKey = document.activeElement?.dataset?.surfaceId || document.activeElement?.dataset?.bd;
        build();
        if (had && focusKey) root.querySelector(`[data-surface-id="${focusKey}"], [data-bd="${focusKey}"]`)?.focus();
      }
    }),
    onGlassImageChange(() => root.isConnected && build()),
  ];
  return root;
}
