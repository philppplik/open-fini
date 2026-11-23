// ICO writer (round trip through the reader) and the TGA reader.
import test from "node:test";
import assert from "node:assert/strict";
import { encodeIco, icoFromImage, resizeRgba, ICO_SIZES } from "../../app/src/engine/export/ico.js";
import { readIco } from "../../app/src/engine/formats/ico.js";
import { readTga } from "../../app/src/engine/formats/tga.js";
import { encodePng } from "../../app/src/engine/export/png.js";

const solid = (w, h, rgba) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width: w, height: h, data };
};

test("an ICO written from an image holds every standard size up to the image size and reads back", () => {
  const ico = icoFromImage(solid(64, 64, [255, 0, 0, 255]));
  const r = readIco(ico);
  assert.equal(r.cursor, false);
  assert.deepEqual(r.images.map((i) => i.width).sort((a, b) => a - b), [16, 24, 32, 48, 64]);
  assert.ok(r.images.every((i) => i.png && i.width === i.height));
});

test("256 px is stored as 0 in the directory and read back as 256; sizes can be chosen", () => {
  const ico = icoFromImage(solid(300, 300, [0, 0, 255, 255]), { sizes: [256, 16] });
  assert.equal(ico[6], 16); // the directory is sorted ascending
  assert.equal(ico[22], 0); // 256 px
  const r = readIco(ico);
  assert.deepEqual(r.images.map((i) => i.width), [256, 16]);
  assert.deepEqual(ICO_SIZES, [16, 24, 32, 48, 64, 128, 256]);
});

test("non-square images are centered on a transparent square; tiny images keep their size", () => {
  const r = readIco(icoFromImage(solid(32, 16, [0, 255, 0, 255])));
  assert.deepEqual(r.images.map((i) => i.width).sort((a, b) => a - b), [16, 24, 32]);
  assert.equal(readIco(icoFromImage(solid(10, 10, [1, 2, 3, 255]))).images[0].width, 10);
});

test("encodeIco validates its input", () => {
  assert.throws(() => encodeIco([]), /1 to 256/);
  assert.throws(() => encodeIco([{ width: 300, height: 300, png: encodePng(solid(1, 1, [0, 0, 0, 0])) }]), /1 to 256 pixels/);
});

test("resizing averages premultiplied colors (no dark fringes from transparent pixels)", () => {
  const img = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]) };
  const out = resizeRgba(img, 1, 1);
  assert.deepEqual([...out.data], [255, 0, 0, 128]);
});

function tga({ type = 2, depth = 24, w = 2, h = 2, desc = 0, pixels, map = null }) {
  const head = new Uint8Array(18);
  head[2] = type;
  head[12] = w;
  head[14] = h;
  head[16] = depth;
  head[17] = desc;
  if (map) {
    head[1] = 1;
    head[5] = map.length / 3;
    head[7] = 24;
  }
  const parts = [head, ...(map ? [Uint8Array.from(map)] : []), Uint8Array.from(pixels)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
}

test("TGA: raw 24-bit bottom-up, BGR order", () => {
  // bottom row first: blue, green / top row: red, white
  const r = readTga(tga({ pixels: [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255] }));
  assert.equal(r.width, 2);
  assert.deepEqual([...r.rgba.subarray(0, 8)], [255, 0, 0, 255, 255, 255, 255, 255]); // top row
  assert.deepEqual([...r.rgba.subarray(8, 16)], [0, 0, 255, 255, 0, 255, 0, 255]); // bottom row
});

test("TGA: RLE 32-bit top-down with alpha, grayscale and color-mapped", () => {
  const rle = readTga(tga({ type: 10, depth: 32, desc: 0x28, pixels: [0x83, 10, 20, 30, 128] }));
  assert.deepEqual([...rle.rgba.subarray(0, 4)], [30, 20, 10, 128]);
  assert.deepEqual([...rle.rgba.subarray(12, 16)], [30, 20, 10, 128]);
  const gray = readTga(tga({ type: 3, depth: 8, w: 1, h: 1, pixels: [77] }));
  assert.deepEqual([...gray.rgba], [77, 77, 77, 255]);
  const mapped = readTga(tga({ type: 1, depth: 8, w: 1, h: 1, map: [0, 0, 0, 1, 2, 3], pixels: [1] }));
  assert.deepEqual([...mapped.rgba], [3, 2, 1, 255]);
});

test("TGA: truncated and invalid files", () => {
  const short = readTga(tga({ pixels: [1, 2, 3] }));
  assert.equal(short.warnings.length, 1);
  assert.throws(() => readTga(new Uint8Array(5)), /not a TGA/);
  assert.throws(() => readTga(tga({ type: 7, pixels: [] })), /not supported/);
  assert.throws(() => readTga(tga({ w: 0, pixels: [] })), /size is invalid/);
});
