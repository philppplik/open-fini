import test from "node:test";
import assert from "node:assert/strict";
import { clampRefraction, urlBackdropSupported, refractionState, sizeClass, mapKey, channelScales, buildDisplacement, RIM, profile } from "../../app/src/ui/refraction.js";
import { specularVars } from "../../app/src/ui/glass.js";

test("feature detection needs CSS support, a kept url() and a Chromium engine", () => {
  assert.equal(urlBackdropSupported({ css: true, computed: true, chromium: true }), true);
  assert.equal(urlBackdropSupported({ css: true, computed: true, chromium: false }), false, "Safari parses it but does not render");
  assert.equal(urlBackdropSupported({ css: true, computed: false, chromium: true }), false);
  assert.equal(urlBackdropSupported({ css: false }), false);
  assert.equal(urlBackdropSupported(), false);
});

test("refraction is only on for Liquid with effects on, support and a strength above zero", () => {
  const on = { on: true };
  const set = { refraction: 60 };
  assert.deepEqual(refractionState("liquid", on, true, set), { on: true, reason: null });
  assert.equal(refractionState("glass", on, true, set).reason, "style");
  assert.equal(refractionState("sea", on, true, set).reason, "style");
  assert.equal(refractionState("liquid", { on: false }, true, set).reason, "fx");
  assert.equal(refractionState("liquid", on, false, set).reason, "unsupported");
  assert.equal(refractionState("liquid", on, true, { refraction: 0 }).reason, "off");
});

test("settings clamp to their ranges and defaults", () => {
  assert.deepEqual(clampRefraction({}), { refraction: 60, bevel: 16, specular: 60, dispersion: 20 });
  assert.deepEqual(clampRefraction({ glassRefraction: 900, glassBevel: 0, glassSpecular: -1, glassDispersion: 101 }), { refraction: 100, bevel: 4, specular: 0, dispersion: 100 });
  assert.equal(clampRefraction({ glassRefraction: "abc" }).refraction, 60);
});

test("size classes are shared and channel scales spread around the middle channel", () => {
  assert.equal(sizeClass(500), 512);
  assert.equal(mapKey(500, 300, 12.2, 16), mapKey(510, 310, 12, 16));
  const [r, g, b] = channelScales(50, 40);
  assert.ok(r > g && g > b && Math.abs((r + b) / 2 - g) < 1e-9);
  assert.deepEqual(channelScales(0, 50), [0, 0, 0]);
  const [r0, g0, b0] = channelScales(60, 0);
  assert.ok(r0 === g0 && g0 === b0);
});

test("rim profile: shift is 0 at the end of the rim, strongest near the edge; map is neutral inside", () => {
  assert.equal(RIM[RIM.length - 1], 0);
  assert.ok(RIM[2] > RIM[40] && RIM[0] >= 0 && Math.max(...RIM) <= 1);
  assert.ok(profile(0) === 0 && Math.abs(profile(1) - 1) < 1e-9);
  const { width, height, data } = buildDisplacement(80, 60, 10, 12);
  assert.equal(data.length, width * height * 4);
  const at = (x, y) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
  assert.deepEqual(at(40, 30), [128, 128, 128, 255], "center: no shift");
  const left = at(1, 30);
  assert.ok(left[0] > 128 && left[1] === 128, "left edge samples from the right (inward)");
  const top = at(40, 1);
  assert.ok(top[1] > 128 && top[0] === 128, "top edge samples from below (inward)");
  assert.ok(at(78, 30)[0] < 128 && at(40, 58)[1] < 128);
});

test("specular and bevel variables keep the stylesheet look at the defaults and stay valid colors", () => {
  assert.equal(specularVars(60, 16, true)["--of-glass-hi"], "rgba(255, 255, 255, 0.22)");
  assert.equal(specularVars(60, 16, false)["--of-glass-hi"], "rgba(255, 255, 255, 0.85)");
  assert.equal(specularVars(60, 16, true)["--of-glass-bevel"], "1.5px");
  assert.equal(specularVars(0, 4, true)["--of-glass-hi"], "rgba(255, 255, 255, 0)");
  assert.ok(parseFloat(specularVars(100, 40, false)["--of-glass-hi"].match(/([\d.]+)\)/)[1]) <= 1);
});
