// Applies the customization preferences to the document: fonts, corner radius, animation speed, canvas colors,
// pointer size, dock side and width, and the default text style. Called from ui/appearance.js on start-up and on
// every preference change (after the theme, so these overrides win).

export const FONT_STACKS = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};
export const RADIUS = { sharp: ["0px", "0px"], round: ["12px", "9px"] };
export const BASE_FONT_PX = 13;

/** The CSS font stack for the preferences (null = keep the theme's Inter stack). */
export function fontStack(p) {
  if (p.uiFont === "custom") {
    const fam = String(p.uiFontCustom || "").trim();
    return /^[\w .'-]{1,60}$/.test(fam) ? `"${fam.replace(/"/g, "")}", ${FONT_STACKS.system}` : null;
  }
  return FONT_STACKS[p.uiFont] || null;
}

export function applyCustomization(app) {
  const p = app.prefs;
  const root = document.documentElement;
  const set = (name, value) => (value == null ? root.style.removeProperty(name) : root.style.setProperty(name, value));

  // typography
  set("--of-font", fontStack(p));
  const size = Math.max(11, Math.min(18, Number(p.uiFontSize) || BASE_FONT_PX));
  set("--of-fs", size === BASE_FONT_PX ? null : String(size / BASE_FONT_PX));
  root.classList.toggle("of-fs-custom", size !== BASE_FONT_PX);

  // corner radius
  const r = RADIUS[p.uiRadius];
  set("--of-radius", r ? r[0] : null);
  set("--of-radius-sm", r ? r[1] : null);
  root.classList.toggle("of-radius-sharp", p.uiRadius === "sharp");

  // animation speed (reduced motion still wins: its class overrides the durations)
  for (const s of ["off", "slow", "fast"]) root.classList.toggle(`of-anim-${s}`, p.animSpeed === s);

  // canvas background; the checkerboard, grid, guide and selection colors are read by ui/canvas-view.js
  set("--of-bg-canvas", /^#[0-9a-f]{6}$/i.test(p.canvasBg || "") ? p.canvasBg : null);

  // pointer size
  root.classList.toggle("of-cursor-large", p.cursorSize === "large" || p.cursorSize === "xlarge");
  app.cv?.updateCursor?.();

  // dock side and width of the current studio
  const lay = (p.layout || {})[app.studio] || {};
  const layout = document.querySelector(".of-layout");
  if (layout) layout.dataset.dock = lay.side === "left" ? "left" : "right";
  set("--of-dock-w", Number.isFinite(lay.width) ? `${lay.width}px` : null);

  // default text style for new text: applied when the setting changes (and once at start-up), so the Type panel can still adjust it
  const td = p.textDefaults || {};
  const sig = JSON.stringify(td);
  if (sig !== app._textDefaultsSig) {
    const first = app._textDefaultsSig === undefined;
    app._textDefaultsSig = sig;
    if (!first || Object.keys(td).length) {
      const style = (app.textStyle ||= { char: { fontFamily: "Inter", fontSize: 48, fontWeight: 400, fontStyle: "normal" }, para: { align: "left", lineHeight: 1.25 } });
      Object.assign(style.char, { fontFamily: td.fontFamily ?? "Inter", fontSize: td.fontSize ?? 48, fontWeight: td.fontWeight ?? 400 });
      Object.assign(style.para, { align: td.align ?? "left", lineHeight: td.lineHeight ?? 1.25 });
    }
  }
}

