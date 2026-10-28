import test from "node:test";
import assert from "node:assert/strict";
import { SURFACE_STYLES, STYLE_DEFS, blend, glassFill, stressBackdrops, minAlpha, fxState, glassSettings, resolveGlass, resolveTint, effectiveBackdrop, MIN_SCRIM } from "../../app/src/ui/glass.js";
import { seaPalette, hexToHsl } from "../../app/src/ui/sea-glass.js";
import { listThemes, resolveVars, contrast } from "../../app/src/ui/themes.js";

const MODES = ["dark", "light"];
const STYLES = SURFACE_STYLES.filter((s) => s !== "solid");

test("blend and glassFill are plain alpha math", () => {
  assert.equal(blend("#ffffff", "#000000", 0.5), "#808080");
  assert.equal(blend("#ff0000", "#0000ff", 1), "#ff0000");
  assert.equal(blend("#ff0000", "#0000ff", 0), "#0000ff");
  assert.equal(glassFill("#ffffff", "#000000", { alpha: 1 }), "#ffffff");
  const tinted = glassFill("#000000", "#000000", { alpha: 1, tint: "#ffffff", tintAmount: 50 });
  assert.equal(tinted, "#808080");
});

test("worst-case backdrops: text and dim text stay AA at the lowest fill opacity, in every theme, mode and style", () => {
  for (const t of listThemes()) {
    for (const m of MODES) {
      const v = resolveVars(t, m);
      for (const style of STYLES) {
        // the user asks for the most transparent setting; the floor still holds
        const g = resolveGlass(v, { surfaceStyle: style, glassTransparency: 50 }, { supported: true });
        assert.ok(g.on);
        assert.ok(g.alpha >= minAlpha(v, style), `${t.id}/${m}/${style}`);
        const tint = resolveTint(style, m === "dark", v, {}) ?? null;
        for (const bd of stressBackdrops(v, MIN_SCRIM)) {
          for (const s of ["--of-bg-bar", "--of-bg-panel", "--of-bg-raised"]) {
            const fill = glassFill(v[s], bd, { alpha: g.alpha, tint, tintAmount: STYLE_DEFS[style].tintAmount });
            for (const k of ["--of-text", "--of-text-dim"]) assert.ok(contrast(g.vars[k] || v[k], fill) >= 4.5, `${t.id}/${m}/${style} ${k} on ${s} over ${bd}: ${contrast(v[k], fill).toFixed(2)}`);
          }
          // the code editor: higher opacity, text and syntax colors
          const ed = glassFill(v["--of-editor-bg"], bd, { alpha: g.alphaEditor }); // the editor is never tinted
          assert.ok(contrast(v["--of-text"], ed) >= 4.5, `${t.id}/${m}/${style} editor text`);
          for (const k of Object.keys(v).filter((x) => x.startsWith("--of-syn-"))) {
            const need = k === "--of-syn-comment" || k === "--of-syn-punct" ? 3 : 4.5;
            assert.ok(contrast(v[k], ed) >= need, `${t.id}/${m}/${style} editor ${k}`);
          }
        }
        assert.ok(g.alphaEditor >= g.alpha);
        assert.ok(Number(g.vars["--of-glass-alpha-strong"]) >= g.alpha, `${t.id}/${m}/${style} menus/dialogs are never more transparent than the panels`);
      }
    }
  }
});

test("a lower transparency request never goes below the floor, a higher fill opacity is kept", () => {
  const v = resolveVars("default", "dark");
  const floor = minAlpha(v, "glass");
  assert.ok(floor >= 0.5 && floor <= 1);
  assert.equal(resolveGlass(v, { surfaceStyle: "glass", glassTransparency: 0 }, {}).alpha, 1);
  assert.ok(resolveGlass(v, { surfaceStyle: "glass", glassTransparency: 50 }, {}).alpha >= floor);
});

test("effects switch off (opaque, same tint) in low power, high contrast, reduced transparency and without backdrop-filter", () => {
  assert.deepEqual(fxState("solid", {}), { on: false, reason: "solid" });
  assert.equal(fxState("glass", {}).on, true);
  assert.equal(fxState("glass", { lowPower: true }).reason, "low-power");
  assert.equal(fxState("glass", { highContrast: true }).reason, "high-contrast");
  assert.equal(fxState("glass", { contrastMore: true }).reason, "high-contrast");
  assert.equal(fxState("glass", { reducedTransparency: true }).reason, "reduced-transparency");
  assert.equal(fxState("glass", { supported: false }).reason, "unsupported");
  const v = resolveVars("default", "dark");
  const off = resolveGlass(v, { surfaceStyle: "sea" }, { lowPower: true });
  assert.equal(off.on, false);
  assert.equal(off.vars["--of-glass-alpha"], "1");
  assert.equal(off.vars["--of-glass-blur"], "0px");
  assert.notEqual(off.vars["--of-glass-tint"], "transparent", "sea glass keeps its tint");
  assert.deepEqual(resolveGlass(v, { surfaceStyle: "solid" }, {}).vars, {});
});

test("settings are clamped and fall back to the style defaults", () => {
  assert.equal(glassSettings({}).style, "solid");
  assert.equal(glassSettings({ surfaceStyle: "nope" }).style, "solid");
  const s = glassSettings({ surfaceStyle: "liquid", glassBlur: 999, glassTransparency: -5, glassDim: 500, glassBackdrop: "x" });
  assert.deepEqual([s.blur, s.transparency, s.dim, s.backdrop], [40, 0, 80, "auto"]);
  assert.equal(glassSettings({ surfaceStyle: "glass", glassBlur: null }).blur, STYLE_DEFS.glass.blur);
  assert.equal(effectiveBackdrop(glassSettings({ surfaceStyle: "sea" }), false), "seaglass");
  assert.equal(effectiveBackdrop(glassSettings({ surfaceStyle: "sea", glassBackdrop: "image" }), false), "seaglass");
  assert.equal(effectiveBackdrop(glassSettings({ surfaceStyle: "sea", glassBackdrop: "image" }), true), "image");
  assert.equal(effectiveBackdrop(glassSettings({ surfaceStyle: "glass", glassBackdrop: "dusk" }), true), "dusk");
});

test("glass.css is scoped to the surface attribute and never blurs the document canvas", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../../app/styles/glass.css", import.meta.url), "utf8");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.trim()).filter(Boolean);
  for (const r of rules) {
    const [sel, body] = r.split("{");
    if (!body || /^@/.test(sel.trim())) continue;
    for (const s of sel.split(",").map((x) => x.trim())) {
      const m = body.match(/backdrop-filter\s*:\s*([^;]+)/);
      if (m && m[1].trim() !== "none") assert.ok(!/canvasarea|\.cv\b/.test(s), `blur on the canvas: ${s}`);
    }
  }
  assert.ok(/\.of-canvasarea[^{]*\{[^}]*backdrop-filter: none/.test(css), "canvas area explicitly unblurred");
  assert.ok(css.includes("prefers-reduced-transparency") && css.includes("prefers-contrast: more") && css.includes("@supports not"), "fallbacks present");
});

test("glass never puts a backdrop-filter on an <sl-menu> or an ancestor of a submenu (it would clip the submenu popups)", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../../app/styles/glass.css", import.meta.url), "utf8");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.trim()).filter(Boolean);
  for (const r of rules) {
    const [sel, body] = r.split("{");
    if (!body || /^@/.test(sel.trim())) continue;
    const m = body.match(/backdrop-filter\s*:\s*([^;]+)/);
    if (!m || m[1].trim() === "none") continue;
    for (const s of sel.split(",").map((x) => x.trim())) {
      assert.ok(!/(^|[\s>])sl-menu($|[\s:.[])/.test(s), `backdrop-filter on a menu: ${s}`);
      if (/sl-dropdown::part\(panel\)|\.of-ctxmenu/.test(s)) assert.ok(/::before$/.test(s), `backdrop-filter on a menu frame instead of its ::before: ${s}`);
    }
  }
});

const ACCENT_PRESETS = ["#3b82f6", "#0d9488", "#16a34a", "#ea580c", "#db2777", "#dc2626", "#4f46e5", "#0ea5e9", "#06b6d4", "#059669", "#65a30d", "#d97706", "#e11d48", "#c026d3", "#9333ea", "#92400e", "#64748b", "#3f3f46", "#ffd60a", "#0b2fb5"];

test("sea palette: hue follows the accent, lightness is fixed per mode, saturation is clamped", () => {
  for (const accent of [...ACCENT_PRESETS, "#000000", "#ffffff", "#808080"]) {
    for (const dark of [true, false]) {
      const p = seaPalette(accent, dark, { mode: "accent" });
      const a = hexToHsl(accent);
      const t = hexToHsl(p.tint);
      if (a.s > 0.1) assert.ok(Math.min(Math.abs(t.h - a.h), 360 - Math.abs(t.h - a.h)) < 8, `hue ${accent}: ${t.h} vs ${a.h}`);
      assert.ok(Math.abs(t.l - (dark ? 0.24 : 0.72)) < 0.03, `lightness ${accent}`);
      assert.ok(t.s <= 0.55);
      for (const v of Object.values(p.vars)) assert.ok(/^#[0-9a-f]{6}$/i.test(v) || /^0\.\d+$/.test(v), v);
    }
  }
  assert.equal(seaPalette("#ff0000", true, { mode: "teal" }).tint, "#1b5a54");
  assert.equal(seaPalette("#ff0000", false, { mode: "teal" }).tint, "#86cfbd");
  const c = hexToHsl(seaPalette("#ff0000", true, { mode: "custom", hue: 210 }).tint);
  assert.ok(Math.abs(c.h - 210) < 3);
  assert.equal(seaPalette("#3b82f6", true, { mode: "custom", hue: 999 }).tint, seaPalette("#3b82f6", true, { mode: "custom", hue: 359 }).tint, "hue is clamped");
});

test("sea glass keeps AA text for every accent preset, theme and mode, in all tint modes, at the most transparent setting", () => {
  for (const t of listThemes()) {
    for (const m of MODES) {
      for (const accent of [null, ...ACCENT_PRESETS]) {
        const v = resolveVars(t, m, accent ? { accent } : {});
        for (const prefs of [{ seaTint: "accent" }, { seaTint: "teal" }, { seaTint: "custom", seaHue: 40 }, { seaTint: "custom", seaHue: 300 }]) {
          const g = resolveGlass(v, { surfaceStyle: "sea", glassTransparency: 50, ...prefs }, { supported: true });
          const tint = resolveTint("sea", m === "dark", v, glassSettings({ surfaceStyle: "sea", ...prefs }));
          assert.equal(g.vars["--of-glass-tint"], tint);
          for (const bd of stressBackdrops(v, MIN_SCRIM)) {
            for (const s of ["--of-bg-bar", "--of-bg-panel", "--of-bg-raised"]) {
              const fill = glassFill(v[s], bd, { alpha: g.alpha, tint, tintAmount: STYLE_DEFS.sea.tintAmount });
              for (const k of ["--of-text", "--of-text-dim"]) assert.ok(contrast(g.vars[k] || v[k], fill) >= 4.5, `${t.id}/${m}/${accent}/${JSON.stringify(prefs)} ${k} on ${s}`);
            }
          }
        }
      }
    }
  }
});

test("sea and liquid settings are clamped with sane defaults", () => {
  const d = glassSettings({ surfaceStyle: "sea" });
  assert.deepEqual([d.seaTint, d.seaHue, d.refraction, d.bevel, d.specular, d.dispersion], ["accent", 174, 60, 16, 60, 20]);
  const x = glassSettings({ surfaceStyle: "liquid", seaTint: "bogus", seaHue: 9999, glassRefraction: 500, glassBevel: 1, glassSpecular: -3, glassDispersion: "x" });
  assert.deepEqual([x.seaTint, x.seaHue, x.refraction, x.bevel, x.specular, x.dispersion], ["accent", 359, 100, 4, 0, 20]);
});
