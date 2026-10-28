// Chat bubble preferences: validation, schema, and the contrast guarantees for text and action icons on every preset.
import test from "node:test";
import assert from "node:assert/strict";
import { BUBBLE_DEFAULTS, BUBBLE_PRESETS, BUBBLE_SHAPES, isValidBubbles, normalizeBubbles, resolveBubbleColors, bubbleStyle } from "../../app/src/customize/bubbles.js";
import { validateSetting, customizationDefaults } from "../../app/src/customize/schema.js";
import { contrast } from "../../app/src/ui/themes.js";

const ENVS = [
  { dark: true, panel: "#2a2b31", text: "#e9eaf0", accent: "#7c6df2" },
  { dark: false, panel: "#f1f1f4", text: "#1a1c24", accent: "#4f46e5" },
  { dark: false, panel: "#ffffff", text: "#111218", accent: "#f5d90a" }, // a light accent: the hard case for white text
  { dark: true, panel: "#101014", text: "#ffffff", accent: "#1d4ed8", highContrast: true },
  { dark: true, panel: "#0b3d3a", text: "#d9fffb", accent: "#2dd4bf" }, // sea-glass like panel
];

test("defaults are valid, null means defaults, junk falls back field by field", () => {
  assert.equal(isValidBubbles(null), true);
  assert.equal(isValidBubbles({}), true);
  assert.equal(isValidBubbles({ shape: "thought", radius: 12 }), true);
  assert.equal(isValidBubbles({ shape: "blob" }), false);
  assert.equal(isValidBubbles({ radius: 99 }), false);
  assert.equal(isValidBubbles({ userBg: "red" }), false);
  assert.equal(isValidBubbles({ extra: 1 }), false);
  assert.equal(isValidBubbles([]), false);
  assert.deepEqual(normalizeBubbles(null), BUBBLE_DEFAULTS);
  const n = normalizeBubbles({ shape: "pill", radius: "big", fontSize: 18, userBg: "nope" });
  assert.equal(n.shape, "pill");
  assert.equal(n.radius, BUBBLE_DEFAULTS.radius);
  assert.equal(n.fontSize, 18);
  assert.equal(n.userBg, "");
});

test("the schema knows chatBubbles (profiles carry it) and defaults it to null", () => {
  assert.equal(customizationDefaults().chatBubbles, null);
  assert.equal(validateSetting("chatBubbles", { shape: "speech", tail: false }).ok, true);
  assert.equal(validateSetting("chatBubbles", { shape: "x" }).ok, false);
  assert.equal(validateSetting("chatBubbles", null).ok, true);
});

test("text and action icons reach 4.5:1 on every preset, shape, theme and in high contrast", () => {
  for (const env of ENVS) {
    for (const preset of BUBBLE_PRESETS) {
      for (const assistantBubble of [false, true]) {
        const base = { preset, assistantBubble, userBg: "#facc15", aiBg: "#1e3a8a", userFg: "#ffffff", aiFg: "#000000" };
        for (const shape of BUBBLE_SHAPES) {
          const c = resolveBubbleColors({ ...base, shape }, env);
          for (const role of ["user", "ai"]) {
            const x = c[role];
            const label = `${preset}/${shape}/${role}/${env.panel}${env.highContrast ? "/hc" : ""}`;
            assert.ok(contrast(x.fg, x.surface) >= 4.5, `text ${label} ${contrast(x.fg, x.surface).toFixed(2)}`);
            assert.ok(contrast(x.icon, x.surface) >= 4.5, `icon ${label} ${contrast(x.icon, x.surface).toFixed(2)}`);
            assert.ok(contrast(x.iconHover, x.iconHoverBg) >= 4.5, `icon hover ${label}`);
            assert.ok(contrast(x.focus, x.surface) >= 3, `focus ${label}`);
          }
        }
      }
    }
  }
});

test("a custom text color without enough contrast is adjusted and reported", () => {
  const c = resolveBubbleColors({ preset: "custom", userBg: "#ffee00", userFg: "#ffffff" }, ENVS[1]);
  assert.equal(c.warnings.length, 1);
  assert.equal(c.warnings[0].role, "user");
  assert.equal(c.warnings[0].from, "#ffffff");
  assert.ok(contrast(c.user.fg, "#ffee00") >= 4.5);
  assert.ok(c.warnings[0].ratio < 4.5);
  // a good color is left alone
  const ok = resolveBubbleColors({ preset: "custom", userBg: "#0b1f6b", userFg: "#ffffff" }, ENVS[1]);
  assert.equal(ok.warnings.length, 0);
  assert.equal(ok.user.fg, "#ffffff");
});

test("bubbleStyle returns variables and the classes of the chosen shape, tail and density", () => {
  const s = bubbleStyle({ shape: "speech", tail: true, tailSide: "left", assistantBubble: true, density: "spacious", avatars: false, width: "wide", fontSize: 16 }, ENVS[0]);
  assert.ok(s.classes.includes("of-bub--speech") && s.classes.includes("of-bub--tail") && s.classes.includes("of-bub--tail-left"));
  assert.ok(s.classes.includes("of-bub--ai") && s.classes.includes("of-bub--noavatar") && s.classes.includes("of-bub--spacious"));
  assert.equal(s.vars["--of-bub-max"], "96%");
  assert.equal(s.vars["--of-chat-fs"], "16px");
  assert.match(s.vars["--of-bub-user-bg"], /^#[0-9a-f]{6}$/);
  const none = bubbleStyle({ shape: "rounded", tail: true }, ENVS[0]);
  assert.ok(!none.classes.includes("of-bub--tail"), "rounded bubbles have no tail");
  assert.equal(bubbleStyle({ shape: "flat", assistantBubble: true }, ENVS[0]).classes.includes("of-bub--ai"), false);
  assert.equal(bubbleStyle({ shape: "square" }, ENVS[0]).vars["--of-bub-radius"], "0px");
});
