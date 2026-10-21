import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerTheme, unregisterTheme, listThemes, getTheme, validateTheme, resolveVars, applyTheme, contrast, composite, readableOn, ensureContrast, SURFACES, THEME_VARS, DEFAULT_VARS, onThemesChanged } from "../../app/src/ui/themes.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODES = ["dark", "light"];
const min = (v, fg, bgs = SURFACES) => Math.min(...bgs.map((b) => contrast(v[fg], v[b])));

test("ships the default theme plus at least ten more, all with a light and a dark variant", () => {
  const all = listThemes();
  assert.ok(all.length >= 11, `only ${all.length} themes`);
  assert.equal(all[0].id, "default");
  assert.equal(new Set(all.map((t) => t.id)).size, all.length);
  for (const t of all) {
    assert.ok(t.name && t.group && t.description, t.id);
    for (const m of MODES) assert.ok(Object.keys(t[m].vars).length >= 3, `${t.id} ${m}`);
  }
});

test("contrast: text, dim text, faint text, accent and status colors pass in every theme variant", () => {
  for (const t of listThemes()) {
    for (const m of MODES) {
      for (const hc of [false, true]) {
        const v = resolveVars(t, m, { highContrast: hc });
        const id = `${t.id}/${m}${hc ? "/hc" : ""}`;
        assert.ok(min(v, "--of-text") >= (hc ? 7 : 4.5), `${id} text ${min(v, "--of-text").toFixed(2)}`);
        assert.ok(min(v, "--of-text-dim") >= (hc ? 7 : 4.5), `${id} text-dim ${min(v, "--of-text-dim").toFixed(2)}`);
        assert.ok(min(v, "--of-text-faint") >= (hc ? 4.5 : 3), `${id} text-faint ${min(v, "--of-text-faint").toFixed(2)}`);
        assert.ok(min(v, "--of-accent") >= 3, `${id} accent on surfaces ${min(v, "--of-accent").toFixed(2)}`);
        assert.ok(contrast(v["--of-on-accent"], v["--of-accent"]) >= 4.5, `${id} on-accent`);
        assert.ok(contrast(v["--of-on-accent"], v["--of-accent-strong"]) >= 4.5, `${id} on-accent hover`);
        for (const k of ["--of-danger", "--of-ok"]) assert.ok(min(v, k, ["--of-bg-bar", "--of-bg-panel", "--of-bg-raised"]) >= 4.5, `${id} ${k}`);
        // selected rows: text over the translucent accent
        for (const s of ["--of-bg-panel", "--of-bg-raised"]) assert.ok(contrast(v["--of-text"], composite(v["--of-accent-soft"], v[s])) >= 4.5, `${id} text on selected row (${s})`);
        // code editor
        const ed = v["--of-editor-bg"];
        assert.ok(contrast(v["--of-text"], ed) >= 4.5, `${id} editor text`);
        for (const k of Object.keys(THEME_VARS).filter((x) => x.startsWith("--of-syn-"))) {
          const need = k === "--of-syn-comment" || k === "--of-syn-punct" ? 3 : 4.5;
          assert.ok(contrast(v[k], ed) >= need, `${id} ${k} ${contrast(v[k], ed).toFixed(2)}`);
        }
        if (hc || t.contrast === "high") assert.ok(contrast(v["--of-border"], v["--of-bg-input"]) >= 3, `${id} border`);
      }
    }
  }
});

test("the high-contrast theme is AAA for text", () => {
  for (const m of MODES) assert.ok(min(resolveVars("contrast", m), "--of-text") >= 7);
});

test("colors: contrast, composite, readableOn, ensureContrast", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrast("#777777", "#777777"), 1);
  assert.equal(composite("rgba(255, 0, 0, 0.5)", "#000000"), "#800000");
  assert.equal(readableOn("#ffffff"), "#111218");
  assert.equal(readableOn("#000000"), "#ffffff");
  assert.ok(contrast(ensureContrast("#777777", "#808080", 4.5, -1), "#808080") >= 4.5);
});

test("registry: register, list, replace rules, unregister, change events", () => {
  const def = { id: "test-extension", name: "Test", group: "Extensions", light: { vars: { "--of-bg-app": "#fafafa", "--of-accent": "#aa3300" } }, dark: { vars: { "--of-bg-app": "#101010", "--of-accent": "#ff8844" } } };
  let events = 0;
  const off = onThemesChanged(() => events++);
  const unregister = registerTheme(def);
  assert.ok(getTheme("test-extension"));
  assert.ok(listThemes().some((t) => t.id === "test-extension"));
  assert.throws(() => registerTheme(def), /already registered/);
  let unregister2;
  assert.doesNotThrow(() => (unregister2 = registerTheme(def, { replace: true })));
  unregister();
  assert.ok(getTheme("test-extension"), "a stale unregister handle does not remove the replacement");
  assert.throws(() => registerTheme({ ...def, id: "slate" }), /built-in/);
  assert.equal(unregisterTheme("slate"), false);
  const v = resolveVars("test-extension", "dark");
  assert.equal(v["--of-bg-app"], "#101010");
  assert.equal(v["--of-bg-panel"], DEFAULT_VARS.dark["--of-bg-panel"], "missing variables fall back to the default theme");
  unregister2();
  assert.equal(getTheme("test-extension"), null);
  assert.ok(events >= 3);
  off();
  assert.equal(resolveVars("nope", "dark")["--of-bg-app"], resolveVars("default", "dark")["--of-bg-app"], "unknown id falls back to default");
});

test("validateTheme rejects unsafe or incomplete themes", () => {
  const ok = { id: "a", name: "A", light: { vars: {} }, dark: { vars: {} } };
  assert.deepEqual(validateTheme(ok), []);
  assert.ok(validateTheme({ ...ok, light: undefined }).length, "light is required");
  assert.ok(validateTheme({ ...ok, id: "Bad Id" }).length);
  assert.ok(validateTheme({ ...ok, dark: { vars: { "color": "red" } } }).length, "only --of-* and --sl-* variables");
  assert.ok(validateTheme({ ...ok, dark: { vars: { "--of-bg-app": "url(http://evil)" } } }).length, "no url()");
  assert.ok(validateTheme({ ...ok, dark: { vars: { "--of-bg-app": "red; } body { display:none" } } }).length, "no declaration injection");
  assert.ok(validateTheme({ ...ok, accent: "red" }).length);
});

test("a user accent overrides the theme accent and keeps text readable", () => {
  for (const m of MODES) {
    const v = resolveVars("ocean", m, { accent: "#ea580c" });
    assert.equal(v["--of-accent"], "#ea580c");
    assert.ok(contrast(v["--of-on-accent"], v["--of-accent"]) >= 4.5);
  }
});

test("applyTheme writes variables and removes stale ones", () => {
  const style = new Map();
  const root = { style: { setProperty: (k, v) => style.set(k, v), removeProperty: (k) => style.delete(k) }, dataset: {} };
  applyTheme("slate", "dark", { root });
  assert.equal(root.dataset.ofTheme, "slate");
  assert.ok(style.has("--sl-color-neutral-500"), "tinted themes remap Shoelace neutrals");
  applyTheme("default", "light", { root });
  assert.equal(root.dataset.ofMode, "light");
  assert.ok(!style.has("--sl-color-neutral-500"), "the default theme leaves Shoelace's own neutrals");
});

test("the default theme matches the CSS defaults in theme.css and code.css", () => {
  const css = readFileSync(join(root, "app/styles/theme.css"), "utf8") + readFileSync(join(root, "app/styles/code.css"), "utf8");
  const block = (sel) => {
    const out = {};
    for (const m of css.matchAll(new RegExp(String.raw`(?:^|\n)${sel.replace(/[.]/g, String.raw`\.`)}\s*\{([^}]*)\}`, "g"))) for (const d of m[1].matchAll(/(--of-[a-z-]+):\s*([^;]+);/g)) out[d[1]] = d[2].trim().toLowerCase();
    return out;
  };
  const norm = (s) => s.toLowerCase().replace(/\s+/g, "");
  for (const [mode, sel] of [["dark", ":root"], ["light", ":root.sl-theme-light"]]) {
    const css = block(sel);
    for (const [k, v] of Object.entries(DEFAULT_VARS[mode])) if (k in css) assert.equal(norm(css[k]), norm(v), `${mode} ${k}`);
  }
});

test("surface styles: the optional `surface` field is validated and kept, and glass variants keep AA text on every theme", async () => {
  const ok = { id: "s", name: "S", light: { vars: {} }, dark: { vars: {} } };
  for (const surface of ["none", "solid", "glass", "liquid", "sea"]) assert.deepEqual(validateTheme({ ...ok, surface }), [], surface);
  assert.ok(validateTheme({ ...ok, surface: "frosty" }).length);
  const off = registerTheme({ ...ok, id: "surface-test", surface: "none" });
  assert.equal(getTheme("surface-test").surface, "none");
  off();
  assert.equal(getTheme("slate").surface, null, "built-in themes do not opt out");
  const { resolveGlass, glassFill, stressBackdrops, STYLE_DEFS } = await import("../../app/src/ui/glass.js");
  for (const t of listThemes()) {
    for (const m of MODES) {
      const v = resolveVars(t, m);
      for (const style of ["glass", "liquid", "sea"]) {
        const g = resolveGlass(v, { surfaceStyle: style, glassTransparency: 50 }, {});
        for (const bd of stressBackdrops(v)) {
          const fill = glassFill(v["--of-bg-panel"], bd, { alpha: g.alpha, tint: STYLE_DEFS[style].tint?.[m], tintAmount: STYLE_DEFS[style].tintAmount });
          assert.ok(contrast(g.vars["--of-text"], fill) >= 4.5, `${t.id}/${m}/${style} text over ${bd}`);
        }
      }
    }
  }
});
