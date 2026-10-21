import test from "node:test";
import assert from "node:assert/strict";
import { SURFACE_STYLES, STYLE_DEFS, blend, glassFill, stressBackdrops, minAlpha, fxState, glassSettings, resolveGlass, effectiveBackdrop, MIN_SCRIM } from "../../app/src/ui/glass.js";
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
        const tint = STYLE_DEFS[style].tint?.[m] ?? null;
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
