// Type panel: character and paragraph formatting for the text being edited or the selected text objects.
import { h, empty, frameScheduler } from "../../core/util.js";
import { currentFormat, applyCharFormat, applyParaFormat } from "../../studios/tools/text.js";
import { currentTextStyle } from "../../core/text-ops.js";
import { listFontFamilies, registerFont, ensureFont } from "../../core/fonts.js";
import { colorField, iconButton, numField, section, segmented, selectField, button } from "../controls.js";
import { toHex6 } from "../../core/color.js";
import { kvSet } from "../../core/storage.js";

const WEIGHTS = [
  { value: "100", label: "Thin" }, { value: "200", label: "Extra Light" }, { value: "300", label: "Light" }, { value: "400", label: "Regular" },
  { value: "500", label: "Medium" }, { value: "600", label: "Semibold" }, { value: "700", label: "Bold" }, { value: "800", label: "Extra Bold" }, { value: "900", label: "Black" },
];

export function createTypePanel(app) {
  const el = h("div.of-panel.of-type");
  let fontNames = [];

  const fmt = () => currentFormat(app);
  const char = (patch) => applyCharFormat(app, patch);
  const para = (patch) => applyParaFormat(app, patch);

  async function loadFonts(request = false) {
    fontNames = await listFontFamilies({ request });
    for (const f of app.fonts.keys()) if (!fontNames.includes(f)) fontNames.push(f);
    build();
  }

  function build() {
    empty(el);
    const f = fmt();
    const c = f?.char || currentTextStyle(app).char;
    const p = f?.para || currentTextStyle(app).para;
    // Shoelace option values cannot contain spaces: encode them as underscores and decode on change
    const enc = (s) => String(s).replace(/ /g, "_");
    const dec = (s) => String(s).replace(/_/g, " ");
    const fam = h("sl-select", { value: enc(c.fontFamily || "Inter"), size: "small", hoist: true, "aria-label": "Font family", class: "of-fontsel" });
    const names = fontNames.length ? fontNames : ["Inter", "Arial", "Georgia", "Times New Roman", "Courier New"];
    for (const n of names.includes(c.fontFamily) ? names : [c.fontFamily, ...names]) {
      const o = h("sl-option", { value: enc(n) }, h("span", { style: { fontFamily: `"${n}", sans-serif` } }, n));
      fam.append(o);
    }
    fam.addEventListener("sl-change", async () => {
      const family = dec(fam.value);
      await ensureFont(family, c.fontWeight || 400, c.fontStyle || "normal");
      char({ fontFamily: family });
      app.requestRender();
    });
    const weight = selectField({ label: "", value: String(c.fontWeight || 400), options: WEIGHTS, onChange: (v) => char({ fontWeight: Number(v) }) });
    const size = numField({ label: "Size", value: c.fontSize || 24, min: 1, max: 2000, step: 1, unit: "px", precision: 1, wide: true, onChange: (v) => char({ fontSize: v }) });
    // independent on/off toggles (not an exclusive choice)
    const state = { italic: c.fontStyle === "italic", underline: !!c.underline, strike: !!c.strike };
    const toggleDefs = [
      { key: "italic", label: "Italic", text: "I" },
      { key: "underline", label: "Underline", text: "U" },
      { key: "strike", label: "Strikethrough", text: "S" },
    ];
    const toggles = h(
      "div.of-seg",
      toggleDefs.map((d) => {
        const b = h("button.of-seg__btn", { type: "button", "data-tip": d.label, "aria-label": d.label, "aria-pressed": String(state[d.key]) }, d.text);
        b.addEventListener("click", () => {
          state[d.key] = !state[d.key];
          b.setAttribute("aria-pressed", String(state[d.key]));
          char(d.key === "italic" ? { fontStyle: state.italic ? "italic" : "normal" } : { [d.key]: state[d.key] });
        });
        return b;
      }),
    );
    const color = colorField({ value: toHex6(c.color || "#000000"), alpha: false, label: "Color", onInput: (v) => char({ color: toHex6(v) }), onChange: (v) => char({ color: toHex6(v) }) });
    const tracking = numField({ label: "Tracking", value: c.tracking || 0, min: -500, max: 2000, step: 5, precision: 0, wide: true, onChange: (v) => char({ tracking: v }) });
    const shift = numField({ label: "Baseline", value: c.baselineShift || 0, min: -500, max: 500, step: 1, unit: "px", precision: 1, wide: true, onChange: (v) => char({ baselineShift: v }) });
    const caps = selectField({ label: "", value: c.caps || "none", options: [{ value: "none", label: "Normal case" }, { value: "upper", label: "ALL CAPS" }, { value: "small", label: "Small caps" }], onChange: (v) => char({ caps: v }) });

    const align = segmented(
      [
        { value: "left", label: "Align left", icon: "text-left" },
        { value: "center", label: "Align center", icon: "text-center" },
        { value: "right", label: "Align right", icon: "text-right" },
        { value: "justify", label: "Justify", icon: "justify" },
      ],
      p.align || "left",
      (v) => para({ align: v }),
    );
    const lh = numField({ label: "Line height", value: p.lineHeight || 1.25, min: 0.5, max: 5, step: 0.05, precision: 2, wide: true, onChange: (v) => para({ lineHeight: v }) });
    const sb = numField({ label: "Space before", value: p.spaceBefore || 0, min: 0, max: 500, unit: "px", precision: 1, onChange: (v) => para({ spaceBefore: v }) });
    const sa = numField({ label: "Space after", value: p.spaceAfter || 0, min: 0, max: 500, unit: "px", precision: 1, onChange: (v) => para({ spaceAfter: v }) });
    const i1 = numField({ label: "First line", value: p.indentFirst || 0, min: -500, max: 500, unit: "px", precision: 1, onChange: (v) => para({ indentFirst: v }) });
    const il = numField({ label: "Left", value: p.indentLeft || 0, min: 0, max: 1000, unit: "px", precision: 1, onChange: (v) => para({ indentLeft: v }) });
    const ir = numField({ label: "Right", value: p.indentRight || 0, min: 0, max: 1000, unit: "px", precision: 1, onChange: (v) => para({ indentRight: v }) });
    const bullet = selectField({
      label: "List",
      value: p.bullet?.kind || "none",
      options: [{ value: "none", label: "No list" }, { value: "bullet", label: "Bullets" }, { value: "number", label: "Numbers" }, { value: "alpha", label: "Letters" }, { value: "roman", label: "Roman numerals" }],
      onChange: (v) => para({ bullet: v === "none" ? null : { kind: v, indent: 24 } }),
    });
    const hyph = selectField({ label: "Hyphenation", value: p.hyphenate ? "on" : "off", options: [{ value: "off", label: "Off" }, { value: "on", label: "On" }], onChange: (v) => para({ hyphenate: v === "on" }) });
    const drop = numField({ label: "Drop cap", value: p.dropCap?.lines || 0, min: 0, max: 8, step: 1, precision: 0, unit: "lines", wide: true, onChange: (v) => para({ dropCap: v >= 2 ? { lines: Math.round(v), chars: 1 } : null }) });

    const addFont = button("Add font file…", async () => {
      const input = h("input", { type: "file", accept: ".ttf,.otf,.woff,.woff2,.ttc,.otc", style: { display: "none" } });
      document.body.append(input);
      input.addEventListener("change", async () => {
        const file = input.files[0];
        input.remove();
        if (!file) return;
        try {
          let bytes = new Uint8Array(await file.arrayBuffer());
          const { unwrapFont } = await import("../../engine/formats/fontwrap.js");
          const wrapped = unwrapFont(bytes); // WOFF -> TTF/OTF, collections -> first font; WOFF2 stays as is
          bytes = wrapped.fonts[0];
          if (wrapped.note) app.toast(wrapped.note, "primary", 6000);
          const name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]?(Regular|Bold|Italic)$/i, "");
          await registerFont(name, bytes.buffer.slice(0));
          app.fonts.set(name, bytes);
          kvSet("fonts", [...app.fonts]); // user fonts persist on this device
          await loadFonts();
          char({ fontFamily: name });
          app.toast(`Added font “${name}”.`, "success");
        } catch (err) {
          app.toast(`That font could not be loaded: ${err.message}`, "danger");
        }
      });
      input.click();
    });
    const localFonts = window.queryLocalFonts ? button("Use installed fonts…", () => loadFonts(true)) : null;

    el.append(
      section("Character", h("div.of-form", fam, h("div.of-row", weight.el, size.el), h("div.of-row", toggles, color.el), h("div.of-row", tracking.el, shift.el), caps.el, h("div.of-row", addFont, localFonts))),
      section("Paragraph", h("div.of-form", align.el, h("div.of-row", lh.el), h("div.of-row", sb.el, sa.el), h("div.of-row", i1.el, il.el, ir.el), bullet.el, hyph.el, drop.el)),
    );
  }

  let sig = "";
  const refresh = () => {
    const f = fmt();
    const s = JSON.stringify([f?.char, f?.para, f?.node?.id]);
    if (s === sig) return;
    sig = s;
    build();
  };
  const sched = frameScheduler(refresh);
  for (const ev of ["selection", "docchange", "textcaret", "doc", "studio"]) app.on(ev, sched);
  loadFonts();
  return { el, show: () => { sig = ""; refresh(); } };
}

export { iconButton };
