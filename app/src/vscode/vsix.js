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
// - The archive is never unpacked as a whole: zip-index.js reads the central directory and inflates only the files
//   OpenFini uses (package.json, package.nls*.json, README/LICENSE/CHANGELOG, theme, snippet, grammar and
//   language-configuration files, JSON next to themes (for `include`), the browser entry, the icon and, for web
//   extensions, the web assets their views and webviews load), in small chunks, so a 500 MB package costs little memory.
// - Entry counts, per-file and total sizes and the compression ratio are capped (zip bombs); an entry that inflates
//   past its declared size aborts. Web assets have their own budget and are skipped (not refused) once it is full.
// - `files` keys are relative to the `extension/` folder of the package.
import { safePath } from "../extensions/zip.js";
import { parseJsonc } from "./jsonc.js";
import { localizePackage, normalizePackage, referencedFiles, resolveEntry, isWebAsset } from "./manifest.js";
import { readZipIndex, readZipEntry } from "./zip-index.js";

/**
 * Package limits. Packages up to 512 MB are accepted (language packs and extensions that bundle tools are large); what
 * is unpacked stays small: at most 32 MB per file and 96 MB in total, plus up to 24 MB of web assets for webviews.
 */
export const VSIX_LIMITS = { maxPackageBytes: 512 * 1024 * 1024, maxEntries: 50_000, maxFileBytes: 32 * 1024 * 1024, maxTotalBytes: 96 * 1024 * 1024, maxRatio: 400, maxAssetBytes: 24 * 1024 * 1024 };
const ROOT = "extension/";
const DOCS = /^(readme|license|licence|license\.txt|changelog)(\.(md|txt|markdown))?$/i;
const dec = new TextDecoder();

export const isZip = (b) => b instanceof Uint8Array && b.length >= 22 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);

export function readText(files, path) {
  const b = path && files[path];
  return b ? dec.decode(b).replace(/^﻿/, "") : null;
}

/** Central directory of the package with every name checked (one unsafe name rejects the package). */
function indexOf(bytes, limits) {
  let entries;
  try {
    entries = readZipIndex(bytes, { maxEntries: limits.maxEntries });
  } catch (err) {
    if (/more than|not supported/.test(err.message)) throw err;
    throw new Error("This is not a valid .vsix package (it could not be unzipped).");
  }
  const out = [];
  for (const e of entries) {
    if (e.name.endsWith("/")) continue;
    const path = safePath(e.name);
    if (!path) throw new Error(`The package contains an unsafe path: “${String(e.name).slice(0, 120)}”.`);
    out.push({ ...e, path });
  }
  return out;
}

/**
 * Inflates selected entries of the extension folder.
 * @param {(p: string) => boolean} want required files (limits throw)
 * @param {((p: string) => boolean) | null} soft optional files (web assets): skipped once their budget is used up
 * @param {{ total: number, assets: number }} budget bytes unpacked so far (shared by both passes)
 */
function extract(bytes, index, want, limits, soft, budget) {
  const out = {};
  for (const e of index) {
    if (!e.path.startsWith(ROOT)) continue;
    const rel = e.path.slice(ROOT.length);
    const required = want(rel);
    if (!required && !soft?.(rel)) continue;
    if (!required && (e.size > limits.maxFileBytes || budget.assets + e.size > limits.maxAssetBytes)) continue;
    if (e.size > limits.maxFileBytes) throw new Error(`“${e.path}” is larger than ${limits.maxFileBytes / 1048576} MB when unpacked.`);
    if (e.size > 1024 * 1024 && e.csize > 0 && e.size / e.csize > limits.maxRatio) throw new Error(`“${e.path}” is compressed suspiciously well (possible zip bomb).`);
    if (required && budget.total + e.size > limits.maxTotalBytes) throw new Error(`The package is larger than ${limits.maxTotalBytes / 1048576} MB when unpacked.`);
    let data;
    try {
      data = readZipEntry(bytes, e, { maxBytes: limits.maxFileBytes });
    } catch (err) {
      if (/zip bomb|larger than|encrypted|compression method/.test(err.message)) throw err;
      throw new Error("The package is damaged or larger than its headers say (possible zip bomb).");
    }
    if (required) budget.total += data.length;
    else budget.assets += data.length;
    out[rel] = data;
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
  const index = indexOf(bytes, L);
  const budget = { total: 0, assets: 0 };
  const first = extract(bytes, index, (p) => p === "package.json" || /^package\.nls(\.[\w-]{1,20})?\.json$/.test(p) || DOCS.test(p), L, null, budget);
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
  const extNames = new Set(index.filter((e) => e.path.startsWith(ROOT)).map((e) => e.path.slice(ROOT.length)));
  const wanted = referencedFiles(m);
  const themeDirs = new Set(m.contributes.themes.map((t) => t.path.split("/").slice(0, -1).join("/")));
  const wantSecond = (p) => !(p in first) && (wanted.has(p) || (p.endsWith(".json") && themeDirs.has(p.split("/").slice(0, -1).join("/"))));
  // web extensions: the scripts, styles, images and fonts their webviews load (never node_modules or Node code)
  const asset = m.browser ? (p) => !(p in first) && isWebAsset(p) : null;
  const second = extract(bytes, index, wantSecond, L, asset, budget);
  const files = { ...first, ...second };
  if (m.browser) m.browser = resolveEntry(m.browser, extNames) || m.browser;
  return { pkg, manifest: m, files, names: [...extNames].slice(0, 5000), nls: nls.length };
}
