import test from "node:test";
import assert from "node:assert/strict";
import { assetEditTarget } from "../../app/src/ui/code/asset-edit.js";

test("raster images open in the Pixel studio, SVG in the Vector studio", () => {
  assert.deepEqual(assetEditTarget("assets/logo.png"), { studio: "pixel", format: "png", mime: "image/png" });
  assert.equal(assetEditTarget("img/photo.JPG").format, "jpeg");
  assert.equal(assetEditTarget("a.jpeg").studio, "pixel");
  assert.equal(assetEditTarget("a.webp").format, "webp");
  assert.equal(assetEditTarget("icons/menu.svg").studio, "vector");
});

test("formats without a faithful round trip are not offered", () => {
  for (const p of ["anim.gif", "x.bmp", "x.avif", "favicon.ico", "index.html", "style.css", "font.woff2", "clip.mp4", "noext", "", null]) assert.equal(assetEditTarget(p), null, String(p));
});
