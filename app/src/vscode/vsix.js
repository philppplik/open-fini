// .vsix packages (a ZIP with extension/package.json): defensive, selective unpacking. Pure (no DOM).
//
// Public API
//   isZip(bytes)                          true for a ZIP local/end-of-central-directory signature
//   unpackVsix(bytes, limits?)            -> { pkg, manifest, files, names, nls }  (throws one readable Error)
//   readText(files, path)                 UTF-8 text of an unpacked file, or null
//   VSIX_LIMITS
//
// Invariants
// - Every entry name is checked with the extension system's safePath (no "..", no absolute paths, no drive letters);
//   one unsafe name rejects the whole package.
// - Only the files OpenFini uses are decompressed (package.json, package.nls*.json, README/LICENSE/CHANGELOG, theme,
//   snippet and language-configuration files, JSON next to themes (for `include`), the browser entry and the icon), so
//   a huge package costs little. Entry counts, per-file and total sizes and the compression ratio are capped (zip bombs).
// - `files` keys are relative to the `extension/` folder of the package.
import { unzipSync, strFromU8 } from "../../vendor/fflate/fflate.js";
import { safePath } from "../extensions/zip.js";
import { parseJsonc } from "./jsonc.js";
import { localizePackage, normalizePackage, referencedFiles, resolveEntry } from "./manifest.js";

export const VSIX_LIMITS = { maxPackageBytes: 64 * 1024 * 1024, maxEntries: 20_000, maxFileBytes: 16 * 1024 * 1024, maxTotalBytes: 48 * 1024 * 1024, maxRatio: 400 };
const ROOT = "extension/";
const DOCS = /^(readme|license|licence|license\.txt|changelog)(\.(md|txt|markdown))?$/i;
const dec = new TextDecoder();

export const isZip = (b) => b instanceof Uint8Array && b.length >= 22 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);

export function readText(files, path) {
  const b = path && files[path];
  return b ? dec.decode(b).replace(/^﻿/, "") : null;
}

function extract(bytes, want, limits, seen) {
  let total = 0;
  let count = 0;
  let raw;
  try {
    raw = unzipSync(bytes, {
      filter(f) {
        if (++count > limits.maxEntries) throw new Error(`The package has more than ${limits.maxEntries} entries.`);
        if (f.name.endsWith("/")) return false;
        const path = safePath(f.name);
        if (!path) throw new Error(`The package contains an unsafe path: “${String(f.name).slice(0, 120)}”.`);
        seen?.add(path);
        if (!path.startsWith(ROOT) || !want(path.slice(ROOT.length))) return false;
        if (f.originalSize > limits.maxFileBytes) throw new Error(`“${path}” is larger than ${limits.maxFileBytes / 1048576} MB when unpacked.`);
        if (f.originalSize > 1024 * 1024 && f.size > 0 && f.originalSize / f.size > limits.maxRatio) throw new Error(`“${path}” is compressed suspiciously well (possible zip bomb).`);
        total += f.originalSize;
        if (total > limits.maxTotalBytes) throw new Error(`The package is larger than ${limits.maxTotalBytes / 1048576} MB when unpacked.`);
        return true;
      },
    });
  } catch (err) {
    if (/unsafe path|more than|larger than|zip bomb/.test(err.message)) throw err;
    throw new Error("This is not a valid .vsix package (it could not be unzipped).");
  }
  const out = {};
  let real = 0;
  for (const [name, data] of Object.entries(raw)) {
    const path = safePath(name);
    if (!path) continue;
    real += data.length;
    if (data.length > limits.maxFileBytes || real > limits.maxTotalBytes) throw new Error("The package is larger than its headers say (possible zip bomb).");
    out[path.slice(ROOT.length)] = data;
  }
  return out;
}

/**
 * Unpacks the parts of a .vsix OpenFini uses and validates its manifest.
 * @param {Uint8Array} bytes
 * @param {{locale?: string, limits?: Partial<typeof VSIX_LIMITS>}} [o]
 */
export function unpackVsix(bytes, { locale = "en", limits = {} } = {}) {
  const L = { ...VSIX_LIMITS, ...limits };
  if (!isZip(bytes)) throw new Error("This is not a .vsix package (it is not a ZIP file).");
  if (bytes.length > L.maxPackageBytes) throw new Error(`The package is larger than ${L.maxPackageBytes / 1048576} MB.`);
  const names = new Set();
  const first = extract(bytes, (p) => p === "package.json" || /^package\.nls(\.[\w-]{1,20})?\.json$/.test(p) || DOCS.test(p), L, names);
  const pkgText = readText(first, "package.json");
  if (!pkgText) throw new Error("The package has no extension/package.json: it is not a VS Code extension.");
  let raw;
  try {
    raw = parseJsonc(pkgText);
  } catch (err) {
    throw new Error(`extension/package.json is not valid JSON: ${err.message}`);
  }
  const lang = String(locale || "en").toLowerCase();
  const nlsOf = (p) => {
    try {
      const t = readText(first, p);
      return t ? parseJsonc(t) : null;
    } catch {
      return null;
    }
  };
  const nls = [nlsOf(`package.nls.${lang}.json`), nlsOf(`package.nls.${lang.split("-")[0]}.json`), nlsOf("package.nls.json")].filter(Boolean);
  const pkg = localizePackage(raw, ...nls);
  const norm = normalizePackage(pkg);
  if (!norm.ok) throw new Error(`This VS Code extension cannot be installed:\n${norm.errors.map((e) => `• ${e}`).join("\n")}`);
  const m = norm.manifest;
  const extNames = new Set([...names].filter((n) => n.startsWith(ROOT)).map((n) => n.slice(ROOT.length)));
  const wanted = referencedFiles(m);
  const themeDirs = new Set(m.contributes.themes.map((t) => t.path.split("/").slice(0, -1).join("/")));
  const second = extract(bytes, (p) => wanted.has(p) || (p.endsWith(".json") && themeDirs.has(p.split("/").slice(0, -1).join("/"))), L, null);
  const files = { ...first, ...second };
  if (m.browser) m.browser = resolveEntry(m.browser, extNames) || m.browser;
  return { pkg, manifest: m, files, names: [...extNames].slice(0, 5000), nls: nls.length };
}
