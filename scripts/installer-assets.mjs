// Regenerates the binary installer artwork from the SVG sources in src-tauri/installer/.
//
//   npm run installer:assets
//
// Inputs   src-tauri/installer/sidebar.svg          164x314  NSIS welcome / finish page sidebar
//          src-tauri/installer/header.svg           150x57   NSIS page header
//          src-tauri/installer/dmg-background.svg   660x400  macOS DMG window background
// Outputs  sidebar.bmp, header.bmp                  24-bit uncompressed BMP (what NSIS MUI2 requires)
//          dmg-background.png, dmg-background@2x.png
//
// Rasterization uses Microsoft Edge or Google Chrome in headless mode (installed on every Windows
// machine and on most developer machines; set OPENFINI_BROWSER to a browser executable to override).
// Chromium renders SVG text and gradients faithfully, which resvg (used by `tauri icon`) does not do
// for system fonts. PNG decoding and BMP/PNG encoding are done here with node:zlib, so no npm packages
// are needed. The outputs are committed: the release workflow does not run this script.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "src-tauri", "installer");

/** name, source svg, logical size, scale, output file, format */
export const ASSETS = [
  { svg: "sidebar.svg", w: 164, h: 314, scale: 1, out: "sidebar.bmp", format: "bmp" },
  { svg: "header.svg", w: 150, h: 57, scale: 1, out: "header.bmp", format: "bmp" },
  { svg: "dmg-background.svg", w: 660, h: 400, scale: 1, out: "dmg-background.png", format: "png" },
  { svg: "dmg-background.svg", w: 660, h: 400, scale: 2, out: "dmg-background@2x.png", format: "png" },
];

// ---------------------------------------------------------------- PNG decode / encode

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG (depth ${bitDepth}, type ${colorType}, interlace ${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = line[x * bpp]; out[o + 1] = line[x * bpp + 1]; out[o + 2] = line[x * bpp + 2];
      out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 8-bit RGB PNG (alpha dropped: the artwork is opaque). */
export function encodePng({ width, height, rgba }) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const o = y * (width * 3 + 1);
    raw[o] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      raw[o + 1 + x * 3] = rgba[s]; raw[o + 2 + x * 3] = rgba[s + 1]; raw[o + 3 + x * 3] = rgba[s + 2];
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 24-bit uncompressed BMP, bottom-up rows padded to 4 bytes (the format NSIS expects). */
export function encodeBmp({ width, height, rgba }) {
  const rowSize = (width * 3 + 3) & ~3;
  const size = 54 + rowSize * height;
  const buf = Buffer.alloc(size);
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * height, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const o = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      buf[o + x * 3] = rgba[s + 2]; buf[o + x * 3 + 1] = rgba[s + 1]; buf[o + x * 3 + 2] = rgba[s];
    }
  }
  return buf;
}

export function crop({ width, rgba }, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) rgba.copy(out, y * w * 4, y * width * 4, y * width * 4 + w * 4);
  return { width: w, height: h, rgba: out };
}

// ---------------------------------------------------------------- browser

function findBrowser() {
  const env = process.env.OPENFINI_BROWSER;
  if (env) return env;
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge",
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("No Edge/Chrome found. Set OPENFINI_BROWSER to a Chromium-based browser executable.");
  return found;
}

async function rasterize(browser, work, asset) {
  const svgUrl = pathToFileURL(join(dir, asset.svg)).href;
  const page = join(work, `${asset.out}.html`);
  const shot = join(work, `${asset.out}.shot.png`);
  // The SVG sits in a larger page and is cropped afterwards: headless windows have a minimum size.
  await writeFile(
    page,
    `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff"><img src="${svgUrl}" width="${asset.w}" height="${asset.h}" style="display:block">`,
  );
  const res = spawnSync(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--allow-file-access-from-files",
    `--user-data-dir=${join(work, "profile")}`,
    `--force-device-scale-factor=${asset.scale}`,
    "--window-size=1200,900", "--virtual-time-budget=2000",
    `--screenshot=${shot}`, pathToFileURL(page).href,
  ], { encoding: "utf8", timeout: 60000 });
  // Edge can hand off to a helper process and exit before the file is written: wait for it.
  for (let i = 0; i < 100 && !existsSync(shot); i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  if (!existsSync(shot)) throw new Error(`browser produced no screenshot for ${asset.out}\n${res.stdout}\n${res.stderr}`);
  const img = decodePng(await readFile(shot));
  const w = asset.w * asset.scale, h = asset.h * asset.scale;
  if (img.width < w || img.height < h) throw new Error(`screenshot too small for ${asset.out}: ${img.width}x${img.height}`);
  return crop(img, w, h);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const browser = findBrowser();
  await mkdir(dir, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "openfini-installer-"));
  try {
    for (const asset of ASSETS) {
      const img = await rasterize(browser, work, asset);
      const data = asset.format === "bmp" ? encodeBmp(img) : encodePng(img);
      await writeFile(join(dir, asset.out), data);
      console.log(`installer-assets: src-tauri/installer/${asset.out} ${img.width}x${img.height} (${data.length} B)`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
