import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pixel from "../../app/src/engine/pixel/index.js";
import { ADJUSTMENTS } from "../../app/src/engine/pixel/adjustments.js";
import { FILTERS } from "../../app/src/engine/pixel/filters.js";
import { DEVELOP, TONEMAP } from "../../app/src/engine/pixel/develop.js";
import { noise, maxDiff } from "./_util.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pixelDir = path.join(here, "..", "..", "app", "src", "engine", "pixel");

test("index re-exports every module", () => {
  const expected = [
    "createImage", "cloneImage", "copyRegion", "blit", "fillImage", "cropImage", "flipImage", "lerpWithMask", "premultiplyInPlace", "unpremultiplyInPlace", "clamp", "lerp",
    "ADJUSTMENTS", "applyAdjustment", "buildLevelsLUT", "buildCurveLUT",
    "FILTERS", "applyFilter",
    "Mask", "magicWand", "colorRange", "rectMask", "ellipseMask",
    "floodFill", "fillMask",
    "makeBrushFalloff", "smudgeDab", "blurDab", "sharpenDab", "dodgeBurnDab", "spongeDab", "cloneDab", "healPatch", "spotHeal", "inpaintMask", "removeRedEye",
    "Liquify",
    "histogram", "stats", "autoLevels", "autoContrast", "autoColor", "averageColor",
    "DEVELOP", "TONEMAP",
    "quantizeColors", "traceImage",
    "resizeImage", "affineWarp", "perspectiveWarp", "rotateImage",
    "listEffects", "getEffect",
  ];
  for (const name of expected) assert.ok(name in pixel, "missing export " + name);
});

test("listEffects covers adjustments, filters and the develop modules", () => {
  const list = pixel.listEffects();
  const kinds = new Set(list.map((e) => e.kind));
  assert.deepEqual([...kinds].sort(), ["adjustment", "develop", "filter"]);
  assert.equal(list.filter((e) => e.kind === "adjustment").length, Object.keys(ADJUSTMENTS).length);
  assert.equal(list.filter((e) => e.kind === "filter").length, Object.keys(FILTERS).length);
  assert.deepEqual(list.filter((e) => e.kind === "develop").map((e) => e.id).sort(), ["develop", "tone-mapping"]);
  const seen = new Set();
  for (const e of list) {
    assert.ok(e.id && e.label && e.category, JSON.stringify(e));
    assert.equal(e.group, e.kind);
    const key = e.kind + ":" + e.id;
    assert.ok(!seen.has(key), "duplicate " + key);
    seen.add(key);
  }
});

test("getEffect resolves (kind, id) pairs as the host uses them", () => {
  assert.equal(pixel.getEffect("filter", "gaussian-blur"), FILTERS["gaussian-blur"]);
  assert.equal(pixel.getEffect("adjustment", "levels"), ADJUSTMENTS.levels);
  assert.equal(pixel.getEffect("develop", "develop"), DEVELOP);
  assert.equal(pixel.getEffect("develop", "tone-mapping"), TONEMAP);
  for (const e of pixel.listEffects()) {
    const mod = pixel.getEffect(e.group, e.id);
    assert.ok(mod, `${e.group}/${e.id}`);
    assert.equal(mod.id, e.id);
    assert.equal(typeof mod.apply, "function");
  }
  assert.equal(pixel.getEffect("filter", "levels"), null);
  assert.equal(pixel.getEffect("adjustment", "gaussian-blur"), null);
  assert.equal(pixel.getEffect("nonsense", "levels"), null);
  assert.equal(pixel.getEffect("filter", "constructor"), null);
  assert.equal(pixel.getEffect("filter", "__proto__"), null);
});

test("every registered effect applies with its defaults and keeps the image size", () => {
  for (const e of pixel.listEffects()) {
    const mod = pixel.getEffect(e.kind, e.id);
    const img = noise(24, 18, 3, false);
    const out = mod.apply(img, { ...mod.defaults }, { scale: 1 });
    assert.equal(out.width, 24, e.id);
    assert.equal(out.height, 18, e.id);
    assert.equal(out.data.length, 24 * 18 * 4, e.id);
    // partial params and a missing ctx are fine too
    const out2 = mod.apply(noise(24, 18, 3, false), {}, undefined);
    assert.equal(out2.width, 24, e.id);
    assert.equal(maxDiff(out, out2) >= 0, true);
  }
});

test("effects do not depend on the caller's params object and tolerate preview scales", () => {
  for (const e of pixel.listEffects()) {
    const mod = pixel.getEffect(e.kind, e.id);
    const params = JSON.parse(JSON.stringify(mod.defaults));
    const before = JSON.stringify(params);
    mod.apply(noise(20, 20, 2), params, { scale: 0.25 });
    assert.equal(JSON.stringify(params), before, e.id + " mutated its params");
    const small = mod.apply(noise(6, 5, 2), params, { scale: 0.1 });
    assert.equal(small.width, 6);
  }
});

test("pixel engine sources are pure: no DOM, Canvas, ImageData or window access, ES modules only", () => {
  const files = fs.readdirSync(pixelDir).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 12);
  const banned = /\b(document|window|navigator|OffscreenCanvas|HTMLCanvasElement|HTMLImageElement|ImageData|ImageBitmap|createImageBitmap|requestAnimationFrame|localStorage|require|module\.exports|process)\b/;
  for (const f of files) {
    let src = fs.readFileSync(path.join(pixelDir, f), "utf8");
    src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:])\/\/.*$/gm, "$1");
    assert.equal(banned.test(src), false, `${f} uses a forbidden global: ${(src.match(banned) || [])[0]}`);
    // no imports of anything outside the pixel directory except relative siblings
    for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) assert.ok(m[1].startsWith("./"), `${f} imports ${m[1]}`);
  }
});

test("all user-facing control labels are plain ASCII US English strings", () => {
  for (const e of pixel.listEffects()) {
    const mod = pixel.getEffect(e.kind, e.id);
    assert.ok(/^[\x20-\x7e]+$/.test(mod.label), mod.label);
    for (const c of mod.controls) {
      assert.ok(/^[\x20-\x7e]+$/.test(c.label), `${e.id}.${c.key}: ${c.label}`);
      if (c.options) for (const o of c.options) assert.ok(/^[\x20-\x7e]+$/.test(o.label), o.label);
    }
  }
});
