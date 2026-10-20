// Settings > Defaults for new things: new-document presets per studio, export defaults and the default text style.
import { h } from "../../core/util.js";
import { button, numField } from "../controls.js";
import { STUDIOS } from "../../studios/index.js";

const DOC_STUDIOS = ["vector", "pixel", "layout"];
/** What the New Document dialog uses when nothing is customized (ui/dialogs.js). */
export const BUILTIN_DOC = { width: 1920, height: 1080, unit: "px", dpi: 96, bg: "#ffffff", transparent: false };
export const BUILTIN_EXPORT = { format: "png", scale: 1, quality: 0.9, transparent: false };
export const BUILTIN_TEXT = { fontFamily: "Inter", fontSize: 48, fontWeight: 400, lineHeight: 1.25, align: "left" };

const row = (label, hint, ...ctl) => h("div.of-set__row", h("div", h("div.of-set__label", label), hint ? h("div.of-set__hint", hint) : null), h("div.of-set__ctl", ...ctl));

export function defaultsPane(app) {
  const root = h("div.of-cz");
  let studio = DOC_STUDIOS.includes(app.studio) ? app.studio : "vector";

  const select = (value, options, onChange, label) => {
    const s = h("select", { "aria-label": label });
    for (const [v, l] of options) s.append(h("option", { value: String(v) }, l));
    s.value = String(value);
    s.addEventListener("change", () => onChange(s.value));
    return s;
  };

  /** Merges a field into pref[key] (or pref[key][sub]) and removes it when it equals the built-in value. */
  function patch(key, sub, field, value, builtin) {
    const all = JSON.parse(JSON.stringify(app.prefs[key] || {}));
    const target = sub ? (all[sub] ||= {}) : all;
    if (value === builtin[field]) delete target[field];
    else target[field] = value;
    if (sub && !Object.keys(target).length) delete all[sub];
    app.setPref(key, all);
  }

  function docGroup() {
    const cur = { ...BUILTIN_DOC, ...(app.prefs.newDocDefaults || {})[studio] };
    const tabs = h("div.of-seg", { role: "group", "aria-label": "Studio" });
    for (const s of DOC_STUDIOS) {
      const b = h("button.of-seg__btn", { type: "button", "aria-pressed": String(s === studio) }, STUDIOS[s].label);
      b.addEventListener("click", () => ((studio = s), render()));
      tabs.append(b);
    }
    const set = (f, v) => patch("newDocDefaults", studio, f, v, BUILTIN_DOC);
    const bg = h("input.of-set__color", { type: "color", value: cur.bg, "aria-label": "Background color" });
    bg.addEventListener("change", () => set("bg", bg.value));
    const transparent = h("sl-switch", { size: "small", "aria-label": "Transparent background" });
    transparent.checked = cur.transparent;
    transparent.addEventListener("sl-change", () => set("transparent", transparent.checked));
    const customized = !!(app.prefs.newDocDefaults || {})[studio];
    return h(
      "section.of-set__group",
      h("h3", "New documents"),
      h("div.of-cz__bar", h("span.of-kb__lbl", "Studio"), tabs, h("span.of-kb__spacer"), customized ? button("Use the built-in defaults", () => { const all = { ...(app.prefs.newDocDefaults || {}) }; delete all[studio]; app.setPref("newDocDefaults", all); render(); }) : null),
      row("Size", "The size the New Document dialog starts with.", numField({ value: cur.width, min: 1, max: 100000, precision: 2, wide: true, onChange: (v) => set("width", v) }).el, h("span", "×"), numField({ value: cur.height, min: 1, max: 100000, precision: 2, wide: true, onChange: (v) => set("height", v) }).el),
      row("Unit", "Also the unit of the size fields.", select(cur.unit, ["px", "mm", "cm", "in", "pt"].map((u) => [u, u]), (v) => set("unit", v), "Unit")),
      row("Resolution", "Pixels per inch, used for print units and export.", numField({ value: cur.dpi, min: 36, max: 1200, precision: 0, unit: "dpi", wide: true, onChange: (v) => set("dpi", Math.round(v)) }).el),
      row("Background", null, bg, transparent, h("span.of-set__hint", "transparent")),
    );
  }

  function exportGroup() {
    const cur = { ...BUILTIN_EXPORT, ...(app.prefs.exportDefaults || {}) };
    const set = (f, v) => patch("exportDefaults", undefined, f, v, BUILTIN_EXPORT);
    const transparent = h("sl-switch", { size: "small", "aria-label": "Transparent background" });
    transparent.checked = cur.transparent;
    transparent.addEventListener("sl-change", () => set("transparent", transparent.checked));
    return h(
      "section.of-set__group",
      h("h3", "Export"),
      row("Format", "Preselected in the Export dialog.", select(cur.format, [["png", "PNG"], ["jpg", "JPEG"], ["webp", "WebP"], ["svg", "SVG"], ["pdf", "PDF"]], (v) => set("format", v), "Export format")),
      row("Scale", null, select(cur.scale, [0.5, 1, 2, 3, 4].map((v) => [v, `${v}×`]), (v) => set("scale", Number(v)), "Export scale")),
      row("Quality", "For JPEG and WebP.", numField({ value: Math.round(cur.quality * 100), min: 1, max: 100, precision: 0, unit: "%", wide: true, onChange: (v) => set("quality", Math.round(v) / 100) }).el),
      row("Transparent background", null, transparent),
    );
  }

  function textGroup() {
    const cur = { ...BUILTIN_TEXT, ...(app.prefs.textDefaults || {}) };
    const set = (f, v) => patch("textDefaults", undefined, f, v, BUILTIN_TEXT);
    const fam = h("sl-input", { size: "small", value: cur.fontFamily, "aria-label": "Font family" });
    fam.addEventListener("sl-change", () => {
      const v = fam.value.trim();
      if (/^[\w .'-]{1,60}$/.test(v)) set("fontFamily", v);
      else app.toast("Enter a font family name (letters, digits, spaces).", "warning", 2000);
    });
    return h(
      "section.of-set__group",
      h("h3", "Text"),
      row("Font family", `Used for new text. ${app.fonts.size ? `Fonts you added: ${[...app.fonts.keys()].join(", ")}.` : "Type any installed font or one you added in the Type panel."}`, fam),
      row("Size", null, numField({ value: cur.fontSize, min: 4, max: 999, precision: 0, unit: "px", wide: true, onChange: (v) => set("fontSize", Math.round(v)) }).el),
      row("Weight", null, select(cur.fontWeight, [300, 400, 500, 600, 700, 800].map((w) => [w, String(w)]), (v) => set("fontWeight", Number(v)), "Font weight")),
      row("Line height", null, numField({ value: cur.lineHeight, min: 0.5, max: 4, step: 0.05, precision: 2, wide: true, onChange: (v) => set("lineHeight", Math.round(v * 100) / 100) }).el),
      row("Alignment", null, select(cur.align, [["left", "Left"], ["center", "Center"], ["right", "Right"], ["justify", "Justify"]], (v) => set("align", v), "Text alignment")),
      h("div.of-cz__bar", h("span.of-kb__spacer"), button("Reset text defaults", () => { app.setPref("textDefaults", {}); render(); })),
    );
  }

  function render() {
    root.replaceChildren(docGroup(), exportGroup(), textGroup());
  }
  render();
  return root;
}
