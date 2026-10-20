#!/usr/bin/env node
// Packs an extension folder into a .ofext file (a ZIP).
//
//   node sdk/pack.mjs path/to/my-extension [out.ofext]
//
// Uses fflate from ../app/vendor/fflate when it is next to this file (inside the OpenFini repository) and a
// tiny store-only ZIP writer otherwise, so the SDK works on its own. Dependency-free.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKIP = /(^|\/)(\.git|node_modules|\.DS_Store|Thumbs\.db)(\/|$)|\.ofext$/;

/** CRC-32 of a byte array. */
export function crc32(bytes) {
  let c;
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c = (crc ^ bytes[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

/** Store-only (uncompressed) ZIP writer. `files` maps paths to Uint8Array. */
export function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)]);
    parts.push(local, nameBytes, data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const count = Object.keys(files).length;
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(count), ...u16(count), ...u32(cdSize), ...u32(offset), 0, 0]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of all) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

/** Reads a folder into { "relative/path": Uint8Array } (manifest first). */
export function readFolder(dir) {
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const rel = relative(dir, full).split(sep).join("/");
      if (SKIP.test(rel)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else files[rel] = new Uint8Array(readFileSync(full));
    }
  };
  walk(dir);
  const ordered = {};
  if (files["openfini-extension.json"]) ordered["openfini-extension.json"] = files["openfini-extension.json"];
  for (const k of Object.keys(files).sort()) ordered[k] = files[k];
  return ordered;
}

/** Zips a folder; returns { bytes, manifest }. */
export async function packFolder(dir) {
  const files = readFolder(dir);
  if (!files["openfini-extension.json"]) throw new Error(`${dir} has no openfini-extension.json`);
  const manifest = JSON.parse(new TextDecoder().decode(files["openfini-extension.json"]));
  if (!manifest.id || !manifest.version) throw new Error("openfini-extension.json needs an id and a version");
  let bytes;
  try {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const { zipSync } = await import(pathToFileURL(join(here, "..", "app", "vendor", "fflate", "fflate.js")).href);
    const entries = {};
    for (const [k, v] of Object.entries(files)) entries[k] = [v, { level: v.length < 64 ? 0 : 6, mtime: 1577836800000 }];
    bytes = zipSync(entries);
  } catch {
    bytes = zipStore(files);
  }
  return { bytes, manifest, count: Object.keys(files).length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [dir, out] = process.argv.slice(2);
  if (!dir) {
    console.error("Usage: node sdk/pack.mjs <extension folder> [out.ofext]");
    process.exit(1);
  }
  try {
    const { bytes, manifest, count } = await packFolder(resolve(dir));
    const target = resolve(out || `${manifest.id}-${manifest.version}.ofext`);
    writeFileSync(target, bytes);
    console.log(`Packed ${count} files into ${target} (${bytes.length} bytes, ${basename(dir)})`);
  } catch (err) {
    console.error(`pack: ${err.message}`);
    process.exit(1);
  }
}
