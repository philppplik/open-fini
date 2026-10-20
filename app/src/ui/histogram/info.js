// Info panel: position and color (hex, RGB, HSL, HSB, Lab) of the composite under the pointer, the foreground /
// background colors and two samples pinned with the Color Picker (click = sample 1, Alt-click = sample 2).
import { h } from "../../core/util.js";
import { buildPageDL } from "../../engine/dl.js";
import { colorInfo, deltaE } from "../../engine/pixel/color-info.js";
import { parseColor } from "../../core/color.js";
import { renderItems } from "./source.js";
import { selectField } from "../controls.js";

const f0 = (v) => Math.round(v);

export function createInfoPanel(app) {
  let pos = null; // {x, y, page}
  let hoverC = null;
  const pinned = [null, null];
  let timer = 0;
  const sizeOf = () => parseInt(app.prefs.infoSample || "1", 10);

  const swatch = (c) => h("span.of-info__sw", { style: { background: c ? c.hex : "transparent" }, "aria-hidden": "true" });
  const row = (label, c, extra) =>
    h("div.of-info__row", { role: "group", "aria-label": label }, swatch(c), h("div.of-info__col", h("div.of-info__title", label, extra ? h("span.of-info__extra", extra) : null),
      c ? h("div.of-info__vals", h("span", `RGB ${c.r}, ${c.g}, ${c.b}`), h("span", c.hex.toUpperCase()), h("span", `HSL ${f0(c.hsl[0])}°, ${f0(c.hsl[1])}%, ${f0(c.hsl[2])}%`), h("span", `HSB ${f0(c.hsb[0])}°, ${f0(c.hsb[1])}%, ${f0(c.hsb[2])}%`), h("span", `Lab ${f0(c.lab[0])}, ${f0(c.lab[1])}, ${f0(c.lab[2])}`), c.a < 255 ? h("span", `Alpha ${Math.round((c.a / 255) * 100)}%`) : null) : h("div.of-hint", "—")));

  const body = h("div.of-info__body");
  const sample = selectField({ label: "Sample", value: String(sizeOf()), options: [{ value: "1", label: "Point sample" }, { value: "3", label: "3 × 3 average" }, { value: "5", label: "5 × 5 average" }, { value: "11", label: "11 × 11 average" }], onChange: (v) => app.setPref("infoSample", v) });
  const el = h("div.of-panel.of-info", h("div.of-info__top", sample.el), body);

  function colorOf(hex) {
    const c = parseColor(hex);
    return c ? colorInfo(c.r, c.g, c.b, 255) : null;
  }

  function render() {
    const fg = colorOf(app.style.primary);
    const bg = colorOf(app.style.secondary);
    const where = pos ? `X ${f0(pos.x)}  Y ${f0(pos.y)}` : "";
    body.replaceChildren(
      row("Under the pointer", hoverC, where),
      row("Sample 1", pinned[0] && pinned[0].c, pinned[0] ? `X ${f0(pinned[0].x)}  Y ${f0(pinned[0].y)}` : "click with the Color Picker"),
      row("Sample 2", pinned[1] && pinned[1].c, pinned[1] ? `X ${f0(pinned[1].x)}  Y ${f0(pinned[1].y)}${pinned[0] ? `  ΔE ${deltaE(pinned[0].c, pinned[1].c).toFixed(1)}` : ""}` : "Alt-click with the Color Picker"),
      row("Foreground", fg),
      row("Background", bg),
    );
  }

  /** Average color of a size x size square around a page pixel, or null outside the page / on transparent pixels. */
  function sampleAt(x, y, page, size = sizeOf()) {
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= page.w || py >= page.h) return null;
    const half = Math.floor(size / 2);
    const img = renderItems(page, buildPageDL(app.doc, page).items, { scale: 1, bg: page.bg, crop: { x: px - half, y: py - half, w: size, h: size }, width: size, height: size });
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const al = img.data[i + 3];
      r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al; a += al;
    }
    if (!a) return null;
    return colorInfo(r / a, g / a, b / a, a / (size * size));
  }

  app.on("pointer", (e) => {
    if (!el.isConnected || !e.page) return;
    pos = { x: e.x, y: e.y };
    clearTimeout(timer);
    timer = setTimeout(() => {
      hoverC = app.doc ? sampleAt(e.x, e.y, e.page) : null;
      render();
    }, 30);
  });
  app.on("colors", () => el.isConnected && render());
  app.on("eyedropper", (s) => {
    const page = app.page;
    const c = page && sampleAt(s.x, s.y, page);
    if (!c) return;
    pinned[s.secondary ? 1 : 0] = { x: s.x, y: s.y, c };
    if (el.isConnected) render();
  });
  app.on("doc", () => {
    pinned[0] = pinned[1] = null;
    hoverC = null;
    pos = null;
    render();
  });
  render();
  return { el, show: render };
}
