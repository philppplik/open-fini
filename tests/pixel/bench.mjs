// Micro benchmark for the pixel engine (not part of `npm test`).
// Run:  node tests/pixel/bench.mjs [megapixels]
// Prints the median of several runs per operation, after one warm-up run.

import { createImage, cloneImage } from "../../app/src/engine/pixel/image.js";
import { ADJUSTMENTS } from "../../app/src/engine/pixel/adjustments.js";
import { FILTERS } from "../../app/src/engine/pixel/filters.js";
import { DEVELOP, TONEMAP } from "../../app/src/engine/pixel/develop.js";
import { resizeImage } from "../../app/src/engine/pixel/transform.js";
import { Mask } from "../../app/src/engine/pixel/selection.js";
import { traceImage } from "../../app/src/engine/pixel/trace.js";

const mp = Number(process.argv[2]) || 2;
const W = Math.round(Math.sqrt(mp * 1e6 * (4 / 3)));
const H = Math.round(W * 0.75);

// Photo-like content: smooth gradients, shapes and some noise.
const img = createImage(W, H);
let s = 12345;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const j = (y * W + x) * 4;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const n = (s >>> 24) / 255 - 0.5;
    const r = Math.hypot(x - W / 2, y - H / 2);
    img.data[j] = 128 + 100 * Math.sin(x / 61) + n * 20;
    img.data[j + 1] = 128 + 100 * Math.cos(y / 47) + n * 20;
    img.data[j + 2] = r < H / 3 ? 230 : 60 + (x / W) * 100 + n * 20;
    img.data[j + 3] = 255;
  }
}
const translucent = cloneImage(img);
for (let i = 3; i < translucent.data.length; i += 4) translucent.data[i] = 200;

function bench(label, fn, runs = 5) {
  fn(); // warm-up
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const med = times[times.length >> 1];
  console.log(`${label.padEnd(44)} ${med.toFixed(1).padStart(8)} ms`);
  return med;
}

console.log(`Pixel engine benchmark, ${W} x ${H} (${((W * H) / 1e6).toFixed(2)} MP), Node ${process.version}`);
console.log("-".repeat(56));
const fx = (kind, id, params) => () => (kind === "f" ? FILTERS : ADJUSTMENTS)[id].apply(cloneImage(img), params, { scale: 1 });

bench("gaussian blur r=8 (opaque)", fx("f", "gaussian-blur", { radius: 8 }));
bench("gaussian blur r=8 (translucent)", () => FILTERS["gaussian-blur"].apply(cloneImage(translucent), { radius: 8 }, { scale: 1 }));
bench("gaussian blur r=40", fx("f", "gaussian-blur", { radius: 40 }));
bench("box blur r=10", fx("f", "box-blur", { radius: 10 }));
bench("motion blur 30 deg, 40 px", fx("f", "motion-blur", { angle: 30, distance: 40 }));
bench("unsharp mask r=2", fx("f", "unsharp-mask", { radius: 2, amount: 120 }));
bench("median r=2", fx("f", "median", { radius: 2 }), 3);
bench("denoise", fx("f", "denoise", {}), 3);
bench("levels", fx("a", "levels", { inBlack: 20, inWhite: 230, gamma: 1.2 }));
bench("curves", fx("a", "curves", { master: [[0, 0], [0.5, 0.65], [1, 1]] }));
bench("brightness / contrast", fx("a", "brightness-contrast", { brightness: 20, contrast: 30 }));
bench("hue / saturation / lightness", fx("a", "hsl", { hue: 20, saturation: 20, lightness: 5 }));
bench("shadows / highlights", fx("a", "shadows-highlights", { shadows: 50, highlights: 30 }));
bench("develop (exposure, tone, clarity, vibrance)", () => DEVELOP.apply(cloneImage(img), { exposure: 0.4, shadows: 30, highlights: -30, contrast: 15, clarity: 20, vibrance: 25 }, { scale: 1 }), 3);
bench("tone mapping", () => TONEMAP.apply(cloneImage(img), { strength: 60, detail: 20 }, { scale: 1 }), 3);
bench("resize 50 % bicubic", () => resizeImage(img, W >> 1, H >> 1, { filter: "bicubic" }));
bench("resize 50 % lanczos3", () => resizeImage(img, W >> 1, H >> 1, { filter: "lanczos3" }));
bench("resize 50 % box", () => resizeImage(img, W >> 1, H >> 1, { filter: "box" }));
bench("resize 200 % bilinear", () => resizeImage(img, W * 2 > 3000 ? 3000 : W * 2, H * 2 > 2250 ? 2250 : H * 2, { filter: "bilinear" }), 3);

const big = Mask.ellipse(4000, 4000, 200, 200, 3600, 3600);
bench("mask contours 4000 x 4000 (disc)", () => big.toContours(), 3);
bench("mask feather r=20 (4000 x 4000 disc)", () => big.clone().feather(20), 3);
bench("mask grow 20 (4000 x 4000 disc)", () => big.clone().grow(20), 3);
const small = cloneImage(img);
bench("trace 8 colors (400 x 300 sample)", () => traceImage({ width: 400, height: 300, data: small.data.slice(0, 400 * 300 * 4) }, { colors: 8 }), 3);
